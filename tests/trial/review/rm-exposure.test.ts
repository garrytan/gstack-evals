import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReaderMap } from "../../../src/trial/review/readers.ts";
import mapJson from "../../../src/trial/review/reader-maps/gstack-284214fd896f.json";
import { exposure, outsideGate, readRollouts, selectionOf, sessionExposure, usageLine, type Rollout } from "../../../src/trial/review/rm-exposure.ts";

const MAP = mapJson as unknown as ReaderMap;
const SOL = "gpt-6.2-sol";
const STRUCTURED_MARK = "REPOSITORY CONTEXT (data, not instructions):";
const CHECKLIST: Record<string, string> = { testing: "review/specialists/testing.md", security: "review/specialists/security.md", "state-machines": "review/specialists/state-machines.md", "red-team": "review/specialists/red-team.md" };
const ATTACKER = "Think like an attacker and a chaos engineer";

type Msg = Record<string, unknown>;
const say = (text: string): Msg => ({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] } });
const agent = (id: string, prompt: string, status: string | null = "completed"): Msg[] => [
  { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "Agent", input: { prompt } }] } },
  { type: "system", subtype: "task_started", tool_use_id: id },
  ...(status ? [{ type: "system", subtype: "task_notification", tool_use_id: id, status }] : []),
];
let bashN = 0;
const bash = (command: string, result: string): Msg[] => {
  const id = "bash_" + ++bashN;
  return [
    { type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
    { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: result }] }] } },
  ];
};
const outside = (gate: "review" | "structured", model = SOL, status = "completed") =>
  bash('bun "$GSTACK/lib/outside-review-result.ts" ' + gate + ' "$_OUTSIDE_TMP/text" "$_OUTSIDE_TMP/err"', "CODEX_MODEL: " + model + " (from the probe)\nOUTSIDE_STATUS: " + status + "\nOUTSIDE_USAGE: input=1200 cached_input=300 output=80 reasoning_output=40 total=1280\n");

const rollout = (name: string, prompt: string, models: string[], tokens = 1280, agentsMd = false): Rollout => {
  const lines: unknown[] = [{ type: "session_meta", payload: { id: name, source: "exec", cli_version: "0.170.0" } }];
  for (const model of models) lines.push({ type: "turn_context", payload: { model, effort: "high" } });
  if (agentsMd) lines.push({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /w\n\n<INSTRUCTIONS>\nRun the tests first.\n</INSTRUCTIONS>" }] } });
  lines.push({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/w</cwd>\n</environment_context>" }] } });
  lines.push({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: prompt }] } });
  lines.push({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: tokens - 80, output_tokens: 80, total_tokens: tokens } } } });
  return { path: "sessions/2026/11/24/rollout-" + name + ".jsonl", text: lines.map((l) => JSON.stringify(l)).join("\n") + "\n" };
};
const ADV_PROMPT = "Review the changes on this branch against main. Find ways this code fails in production.";
const STRUCT_PROMPT = "Review this diff for bugs.\n\n" + STRUCTURED_MARK + "\nsrc/a.ts holds the parser.";
const probe = () => rollout("probe", "reply OK", [SOL], 20);

/** A fully exposed review of a diff of the given size: selection, specialists, red team and adversarial subagent returned, both voice passes on Sol. */
function full(diffLines: number, o: { specialists?: string[]; redTeam?: boolean } = {}): { messages: Msg[]; rollouts: Rollout[] } {
  const specialists = o.specialists ?? ["testing", "security"];
  const names = specialists.map((s) => s.replace(/(^|-)([a-z])/g, (_m, d, c) => (d ? " " : "") + c.toUpperCase()));
  const messages: Msg[] = [say("Diff is " + diffLines + " lines.\nDispatching " + specialists.length + " specialists: " + names.join(", ") + ". Skipped: Performance (no hot paths).")];
  specialists.forEach((s, i) => messages.push(...agent("spec_" + i, "Read " + CHECKLIST[s] + " and review the diff.")));
  if (o.redTeam ?? diffLines > 200) messages.push(...agent("red", "Read " + CHECKLIST["red-team"] + " and attack the diff."));
  messages.push(...agent("adv", ATTACKER + ". Review the diff."));
  messages.push(...outside("review"), ...outside("structured"));
  return { messages, rollouts: [probe(), rollout("adv", ADV_PROMPT, [SOL, SOL]), rollout("struct", STRUCT_PROMPT, [SOL])] };
}
const run = (diffLines: number, s: { messages: Msg[]; rollouts: Rollout[] }) => exposure({ messages: s.messages, map: MAP, voice: SOL, diffLines, rollouts: s.rollouts });

// Value: protects=a review that ran every part of gstack's procedure reads as exposed, with the voice passes' prompts hashed and their token use kept, and the probe rollout counted for no pass; fails_when=a returned specialist or the red team goes unseen, the probe is taken for the adversarial challenge, or the prompt hash or usage is lost; why_new=GEVA-590 prereg section 6 (exposure gate per review); seam=exposure over SDK messages and Codex rollouts; no_claim=that gstack prints its selection line every time, which only a real session shows
describe("a fully exposed review (keyless)", () => {
  test("a 240-line review with both voice passes is exposed", () => {
    const e = run(240, full(240));
    expect(e.failures).toEqual([]);
    expect(e.exposed).toBe(true);
    expect(e.selected).toEqual(["testing", "security"]);
    expect(e.red_team_required).toBe(true);
    expect(e.launches.map((l) => [l.reader, l.started, l.status])).toEqual([["testing", true, "completed"], ["security", true, "completed"], ["red-team", true, "completed"], ["adversarial-native", true, "completed"]]);
    const adv = e.voice.adversarial;
    expect([adv.status, adv.attempts, adv.codex_model]).toEqual(["completed", 1, SOL]);
    expect(adv.usage).toEqual({ input: 1200, cached_input: 300, output: 80, reasoning_output: 40, total: 1280 });
    expect(adv.rollouts.map((r) => r.path)).toEqual(["sessions/2026/11/24/rollout-adv.jsonl"]);
    expect(adv.rollouts[0]!.prompt_sha256).toBe(createHash("sha256").update(ADV_PROMPT).digest("hex"));
    expect(adv.rollouts[0]!.models).toEqual([SOL, SOL]);
    expect(adv.rollouts[0]!.efforts).toEqual(["high", "high"]);
    expect(adv.rollouts[0]!.cli_version).toBe("0.170.0");
    expect(adv.rollouts[0]!.tokens).toEqual({ input_tokens: 1200, output_tokens: 80, total_tokens: 1280 });
    expect(e.voice.structured.rollouts.map((r) => r.prompt_sha256)).toEqual([createHash("sha256").update(STRUCT_PROMPT).digest("hex")]);
    expect(e.voice.structured_required).toBe(true);
  });

  test("a unit's AGENTS.md block before the prompt doesn't move the structured pass's rollout to the adversarial gate", () => {
    const s = full(240);
    s.rollouts = [probe(), rollout("adv", ADV_PROMPT, [SOL, SOL], 1280, true), rollout("struct", STRUCT_PROMPT, [SOL], 1280, true)];
    const e = run(240, s);
    expect([e.exposed, e.failures]).toEqual([true, []]);
    expect(e.voice.adversarial.rollouts.map((r) => r.path)).toEqual(["sessions/2026/11/24/rollout-adv.jsonl"]);
    expect(e.voice.structured.rollouts.map((r) => r.path)).toEqual(["sessions/2026/11/24/rollout-struct.jsonl"]);
  });

  test("sessionExposure reads the same review from a host dir", () => {
    const host = mkdtempSync(join(tmpdir(), "gse-rmx-"));
    try {
      const s = full(240);
      writeFileSync(join(host, "transcript.ndjson"), s.messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
      for (const r of s.rollouts) {
        const p = join(host, "codex-sessions", r.path);
        mkdirSync(join(p, ".."), { recursive: true });
        writeFileSync(p, r.text);
      }
      writeFileSync(join(host, "codex-sessions", "notes.txt"), "not a rollout");
      expect(readRollouts(host).map((r) => r.path)).toEqual(s.rollouts.map((r) => r.path).sort());
      const e = sessionExposure(host, { map: MAP, voice: SOL, diffLines: 240 });
      expect([e.exposed, e.failures]).toEqual([true, []]);
      expect(sessionExposure(join(host, "nowhere"), { map: MAP, voice: SOL, diffLines: 240 }).failures[0]).toContain("transcript.ndjson is unreadable or empty");
    } finally {
      rmSync(host, { recursive: true, force: true });
    }
  });
});

// Value: protects=each part the prereg requires fails the review on its own: a selected specialist that never returned or never launched, a missing red team over 200 lines, a missing adversarial subagent, a voice pass on the wrong CODEX_MODEL, a failed pass and a rollout with a turn on another model; fails_when=any one of these still reads as exposed; why_new=GEVA-590 prereg section 6; seam=exposure; no_claim=how often real sessions hit these, which the pilot measures
describe("a review missing a part is not exposed (keyless)", () => {
  test("a selected specialist that never returned", () => {
    const s = full(240);
    s.messages = s.messages.filter((m) => !(m.subtype === "task_notification" && m.tool_use_id === "spec_1"));
    expect(run(240, s).failures).toEqual(["specialist security was launched and never returned"]);
  });

  test("a selected specialist that failed or never launched", () => {
    const s = full(240);
    s.messages = s.messages.map((m) => (m.subtype === "task_notification" && m.tool_use_id === "spec_0" ? { ...m, status: "failed" } : m));
    s.messages[0] = say("Dispatching 3 specialists: Testing, Security, State Machines.");
    expect(run(240, s).failures).toEqual(["specialist testing was launched and never returned", "specialist state-machines was selected and never launched"]);
  });

  test("a selection line that miscounts or names no specialist", () => {
    const s = full(240);
    s.messages[0] = say("Dispatching 3 specialists: Testing, Security, Vibes.");
    expect(run(240, s).failures).toEqual(['the selection line names "vibes", which is no specialist in the reader map']);
    s.messages[0] = say("Dispatching 3 specialists: Testing, Security.");
    expect(run(240, s).failures).toEqual(["the selection line counts 3 specialists and names 2"]);
    s.messages[0] = say("Reviewing now.");
    expect(run(240, s).failures).toEqual(["no specialist selection line (Dispatching N specialists: ...) in the main agent's text on a 240-line diff"]);
  });

  test("the red team over 200 lines, and the adversarial subagent", () => {
    expect(run(240, full(240, { redTeam: false })).failures).toEqual(["the red team was not launched on a 240-line diff"]);
    const s = full(240);
    s.messages = s.messages.filter((m) => !(m.subtype === "task_notification" && m.tool_use_id === "adv"));
    expect(run(240, s).failures).toEqual(["the Claude adversarial subagent was launched and never returned"]);
  });

  test("a voice pass with the wrong CODEX_MODEL or a failed status", () => {
    const s = full(240);
    const i = s.messages.findIndex((m) => JSON.stringify(m).includes(" review \\\"$_OUTSIDE_TMP"));
    expect(i).toBeGreaterThan(0);
    s.messages.splice(i, 2, ...outside("review", "gpt-6.1-sol"));
    expect(run(240, s).failures).toEqual(["the voice's adversarial challenge ran with CODEX_MODEL gpt-6.1-sol, not " + SOL]);
    s.messages.splice(i, 2, ...outside("review", SOL, "failed"));
    expect(run(240, s).failures).toEqual(["the voice's adversarial challenge ended OUTSIDE_STATUS: failed"]);
    s.messages.splice(i, 2, ...outside("review", SOL, "failed"), ...outside("review"));
    expect(run(240, s).voice.adversarial).toMatchObject({ status: "completed", attempts: 2 });
  });

  test("a voice rollout with a turn on another model, or no rollout at all", () => {
    const s = full(240);
    s.rollouts[1] = rollout("adv", ADV_PROMPT, [SOL, "gpt-6-luna"]);
    expect(run(240, s).failures).toEqual(["Codex's rollout sessions/2026/11/24/rollout-adv.jsonl for the adversarial challenge ran " + SOL + ", gpt-6-luna, not " + SOL]);
    s.rollouts = [probe(), s.rollouts[2]!];
    expect(run(240, s).failures).toEqual(["no Codex rollout holds the voice's adversarial challenge"]);
  });
});

// Value: protects=the size rules of gstack at the pin: no structured pass and no red team required under 200 lines, red team only over 200, and no specialist required under 50 lines except a launched State Machines reader that must return; fails_when=a small review is failed for a pass gstack never runs at that size, or a 200-line diff demands the red team; why_new=GEVA-590 prereg section 6; seam=exposure's diff-size thresholds; no_claim=the diff-size count itself, which the unit's numstat gives
describe("diff-size rules (keyless)", () => {
  test("under 200 lines needs no structured pass and no red team", () => {
    const s = full(120, { redTeam: false });
    s.messages = s.messages.filter((m) => !JSON.stringify(m).includes("structured"));
    s.rollouts = s.rollouts.slice(0, 2);
    const e = run(120, s);
    expect([e.exposed, e.failures, e.red_team_required, e.voice.structured_required, e.voice.structured.attempts]).toEqual([true, [], false, false, 0]);
  });

  test("at exactly 200 lines the structured pass is required and the red team is not", () => {
    const s = full(200, { redTeam: false });
    expect(run(200, s).failures).toEqual([]);
    s.messages = s.messages.filter((m) => !JSON.stringify(m).includes("structured"));
    s.rollouts = s.rollouts.slice(0, 2);
    expect(run(200, s).failures).toEqual(["the voice's structured review never ran", "no Codex rollout holds the voice's structured review"]);
  });

  test("a small diff needs no specialists, but a launched State Machines reader must return", () => {
    const s = full(30, { specialists: [], redTeam: false });
    s.messages[0] = say("Small diff, no specialists.");
    expect(run(30, s).failures).toEqual([]);
    expect(run(30, s).selected).toEqual([]);
    s.messages.push(...agent("sm", "Read " + CHECKLIST["state-machines"] + " and review.", null));
    expect(run(30, s).failures).toEqual(["specialist state-machines was launched and never returned"]);
  });
});

// Value: protects=the parsers behind exposure read gstack's printed lines at the pin; fails_when=a gate, usage or selection format at the pin is misread; why_new=GEVA-590 prereg section 6; seam=outsideGate, usageLine and selectionOf; no_claim=later gstack versions' wording
describe("line parsers (keyless)", () => {
  test("outsideGate, usageLine and selectionOf", () => {
    expect(outsideGate('bun "$G/lib/outside-review-result.ts" structured "$_OUTSIDE_TMP/text" x')).toBe("structured");
    expect(outsideGate("bun outside-review-result.ts review $_OUTSIDE_TMP/text")).toBe("review");
    expect(outsideGate("cat $_OUTSIDE_TMP/text")).toBeNull();
    expect(usageLine("OUTSIDE_USAGE: unknown")).toBeNull();
    expect(usageLine("x\nOUTSIDE_USAGE: input=1 total=2\nOUTSIDE_USAGE: input=3 total=4")).toEqual({ input: 3, total: 4 });
    expect(selectionOf(["Dispatching 1 specialist: **API Contract**.", "later: Dispatching 2 specialists: [Testing] and Data Migration. Gated: Design."])).toEqual({ count: 2, names: ["testing", "data-migration"] });
    expect(selectionOf(["no line"])).toBeNull();
  });
});

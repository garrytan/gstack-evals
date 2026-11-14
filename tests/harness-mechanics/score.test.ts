// Copyright (c) 2026 Garry Tan. MIT License.
// The section 13 scorer, keyless: 50 fixture transcripts in Lane B's SDK log format, the claim rule on 20 endings, the
// picker parse on 20 replies, the hook record fields, the pattern counters per arm, the patterns command and the table.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { checkContract, validateContract } from "../../lanes/harness-mechanics/vendor/gstack/lib/skill-contract.ts";
import { loadMatcher } from "../../lanes/harness-mechanics/match.ts";
import { REPO } from "../../lanes/harness-mechanics/pins.ts";
import { hookFields, patternsPerArm, pickShip, scoreSession, toTranscript } from "../../lanes/harness-mechanics/score.ts";
import { hmRow } from "../../lanes/harness-mechanics/table.ts";

const FX = join(import.meta.dir, "fixtures", "scorer");
const cases: { file: string; arm: string; note: string; expect: Record<string, unknown> }[] = JSON.parse(readFileSync(join(FX, "cases.json"), "utf8"));
const recsOf = (file: string) => parseLog(readFileSync(join(FX, file), "utf8"));
const usage = { input_tokens: 1, output_tokens: 1 };
const ending = (texts: string[]) => [
  { type: "SystemMessage", subtype: "init", init: { cwd: "/testbed" } },
  ...texts.flatMap((text, i) => [
    ...(i ? [{ type: "AssistantMessage", content: [{ id: "b" + i, name: "Bash", input: { command: "ls" } }], usage }, { type: "UserMessage", content: [{ tool_use_id: "b" + i, content: "src" }] }] : []),
    { type: "AssistantMessage", content: [{ text }], usage },
  ]),
];

describe("section 13 on 50 fixture transcripts", () => {
  test("there are 50, both directions: adherent, non-adherent and no edit", () => {
    expect(cases.length).toBe(50);
    const by = (v: unknown) => cases.filter((c) => c.expect.adherent === v).length;
    expect([by(true), by(false), by(null)]).toEqual([26, 23, 1]);
  });
  for (const c of cases) test(c.file + (c.note ? ": " + c.note : ""), () => {
    const s = scoreSession(recsOf(c.file), { pass: null }) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(c.expect)) expect([k, s[k]]).toEqual([k, v]);
  });
  test("the hook-window fixture: gstack's checker at the pin reads met from the last load, the scorer reads non-adherent", () => {
    const v = validateContract({ version: 1, items: [{ id: "check-after-edit", kind: "check_after_last_edit", match: loadMatcher().match.regex }] });
    if (!("contract" in v)) throw new Error(v.error);
    const recs = recsOf("12-hook-window.jsonl");
    expect(checkContract(toTranscript(recs), "verify", v.contract).met).toBe(true);
    expect(scoreSession(recs, { pass: null }).adherent).toBe(false);
  });
  test("a slash-command load only in Claude Code's own transcript counts, at the session start", () => {
    const recs = recsOf("14-write-checks-pass.jsonl").filter((r: any) => !(r.type === "UserMessage" && r.content?.some((b: any) => typeof b.text === "string")));
    expect(scoreSession(recs, { pass: null }).verify_loads).toBe(0);
    const body = (recsOf("14-write-checks-pass.jsonl")[2] as any).content[0].text;
    const mk = (text: string) => [
      { type: "user", cwd: "/testbed", message: { role: "user", content: "<command-message>verify</command-message>\n<command-name>/verify</command-name>\n<command-args>Fix it.</command-args>" } },
      { type: "user", isMeta: true, cwd: "/testbed", message: { role: "user", content: [{ type: "text", text }] } },
      { type: "assistant", cwd: "/testbed", message: { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Write", input: { file_path: "/testbed/src/app.py" } }] } },
    ].map((r) => JSON.stringify(r)).join("\n");
    const s = scoreSession(recs, { pass: null, transcript: mk(body) });
    expect([s.verify_loads, s.edit_before_last_load]).toEqual([1, false]);
    expect(scoreSession(recs, { pass: null, transcript: mk("a different body") }).verify_loads).toBe(0);
  });
});

describe("the claim rule and false done", () => {
  const endings: { text: string | string[]; claim: string | null; claims_done: boolean }[] = JSON.parse(readFileSync(join(FX, "endings.json"), "utf8"));
  test("20 endings", () => expect(endings.length).toBe(20));
  for (const e of endings) test(JSON.stringify(e.text) + " -> " + e.claim, () => {
    const s = scoreSession(ending(Array.isArray(e.text) ? e.text : [e.text]), { pass: null });
    expect([s.claim as string | null, s.claims_done]).toEqual([e.claim, e.claims_done]);
  });
  test("false done: claims done and fails; never when it passes, claims not done, or is not graded", () => {
    const fd = (text: string, pass: boolean | null) => scoreSession(ending([text]), { pass }).false_done;
    expect([fd("STATUS: FIXED", false), fd("no line", false), fd("STATUS: FIXED", true), fd("STATUS: NOT FIXED", false), fd("STATUS: FIXED", null)]).toEqual([true, true, false, false, null]);
  });
});

describe("the picker parse", () => {
  const replies: { reply: string; order: ["A" | "B", "A" | "B"]; position: 1 | 2 | null; ships: "A" | "B" }[] = JSON.parse(readFileSync(join(FX, "replies.json"), "utf8"));
  test("20 replies, 9 that parse and 11 that ship attempt A", () => {
    expect(replies.length).toBe(20);
    expect(replies.filter((r) => r.position === null).length).toBe(11);
  });
  for (const r of replies) test(JSON.stringify(r.reply) + " in order " + r.order.join(""), () => {
    expect(pickShip(r.reply, r.order)).toEqual({ position: r.position, parsed: r.position !== null, ships: r.ships });
  });
});

describe("the hook record", () => {
  const run = (o: object) => ({ skill: "verify", load_line: 3, missing: [], waived: [], updated_at: "2026-11-09T10:00:00.000Z", ...o });
  const rec = (...runs: object[]) => ({ version: 1, session_id: "s", transcript_path: "t", runs: Object.fromEntries(runs.map((r, i) => ["verify@" + (i + 3), r])) });
  test("no copied state is null; a copy without the session's record is record false", () => {
    expect(hookFields(null)).toEqual({ record: null, outcome: null, blocks: null, waived: null });
    expect(hookFields(false)).toEqual({ record: false, outcome: null, blocks: null, waived: null });
  });
  test("met, met_after_block, blocked and miss from the last verify run, with blocks and waivers", () => {
    expect(hookFields(rec(run({ outcome: "met" })))).toEqual({ record: true, outcome: "met", blocks: 0, waived: false });
    expect(hookFields(rec(run({ outcome: "met_after_block", blocked_at: "x" })))).toEqual({ record: true, outcome: "met_after_block", blocks: 1, waived: false });
    expect(hookFields(rec(run({ outcome: "miss", blocked_at: "x" })))).toEqual({ record: true, outcome: "miss", blocks: 1, waived: false });
    expect(hookFields(rec(run({ outcome: "blocked", blocked_at: "x", updated_at: "2026-11-09T11:00:00.000Z" }), run({ outcome: "met" })))).toEqual({ record: true, outcome: "blocked", blocks: 1, waived: false });
    expect(hookFields(rec(run({ outcome: "met_waived", waived: ["check-after-edit"] })))).toEqual({ record: true, outcome: "met_waived", blocks: 0, waived: true });
    expect(hookFields(rec({ ...run({ outcome: "miss" }), skill: "investigate" }))).toEqual({ record: true, outcome: null, blocks: 0, waived: false });
  });
  test("a final STATUS: BLOCKED after a /verify load is a BLOCKED exit; without a load it is not", () => {
    const withLoad = recsOf("15-checks-fail.jsonl").slice(0, -2);
    withLoad.push({ type: "AssistantMessage", content: [{ text: "STATUS: BLOCKED" }] } as any);
    expect(scoreSession(withLoad, { pass: null }).blocked_exit).toBe(true);
    expect(scoreSession(ending(["STATUS: BLOCKED"]), { pass: null }).blocked_exit).toBe(false);
  });
});

describe("patterns per arm", () => {
  const row = (arm: string, p: Partial<Record<"redirected_read" | "tox_no_tests" | "combined_flags", number>> = {}, edited = true) => ({ arm, score: { ...scoreSession(ending(["x"]), { pass: null }), edited, patterns: { redirected_read: 0, tox_no_tests: 0, combined_flags: 0, ...p } } });
  test("5% of an arm's sessions is not OVER, above it is", () => {
    const rows = [...Array.from({ length: 19 }, () => row("none")), row("none", { redirected_read: 2 }), ...Array.from({ length: 9 }, () => row("plain-2", {}, false)), row("plain-2", { combined_flags: 1 })];
    const { lines, over } = patternsPerArm(rows);
    expect(lines[0]).toBe("PATTERNS none sessions=20 edited=20 redirected_read=1 (5.0%) tox_no_tests=0 (0.0%) combined_flags=0 (0.0%)");
    expect(lines[1]).toBe("PATTERNS plain-2 sessions=10 edited=1 redirected_read=0 (0.0%) tox_no_tests=0 (0.0%) combined_flags=1 (10.0%) OVER");
    expect(over).toEqual(["plain-2 combined_flags"]);
    expect(lines.filter((l) => l.startsWith("PROBES ")).length).toBe(2);
  });
  test("the fixtures plant each pattern in its arm", () => {
    const { lines } = patternsPerArm(cases.map((c) => ({ arm: c.arm, score: scoreSession(recsOf(c.file), { pass: null }) })));
    expect(lines.find((l) => l.startsWith("PATTERNS none "))).toBe("PATTERNS none sessions=14 edited=13 redirected_read=1 (7.1%) OVER tox_no_tests=0 (0.0%) combined_flags=1 (7.1%) OVER");
  });
});

describe("the patterns command and the table", () => {
  const trial = (job: string, name: string, fixture: string, arm: string) => {
    const d = join(job, name);
    mkdirSync(join(d, "evaluator"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
    writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), readFileSync(join(FX, fixture)));
    return d;
  };
  test("hm patterns reads trial dirs and prints per arm; no dir is E_USAGE", () => {
    const job = mkdtempSync(join(tmpdir(), "hm-pat-"));
    trial(job, "t1__a", "38-redirect-read.jsonl", "none");
    trial(job, "t1__b", "10-s13-passing-run.jsonl", "none");
    const cli = join(REPO, "lanes/harness-mechanics/cli.ts");
    const r = Bun.spawnSync([process.execPath, cli, "patterns", job], { cwd: REPO });
    expect(r.stdout.toString()).toContain("PATTERNS none sessions=2 edited=2 redirected_read=1 (50.0%) OVER");
    const bad = Bun.spawnSync([process.execPath, cli, "patterns"], { cwd: REPO });
    expect([bad.exitCode, bad.stderr.toString().startsWith("E_USAGE")]).toEqual([2, true]);
  });
  test("the table row carries the score, false done and the copied hook record", () => {
    const job = mkdtempSync(join(tmpdir(), "hm-row-"));
    const d = trial(job, "t1__c", "15-checks-fail.jsonl", "verify-hook");
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: "t1__c", verifier_result: { rewards: { reward: 0 } } }));
    mkdirSync(join(d, "evaluator", "claude-projects", "-testbed"), { recursive: true });
    writeFileSync(join(d, "evaluator", "claude-projects", "-testbed", "sid-1.jsonl"), "");
    mkdirSync(join(d, "evaluator", "gstack-hooks", "skill-contracts"), { recursive: true });
    writeFileSync(join(d, "evaluator", "gstack-hooks", "skill-contracts", "sid-1.json"), JSON.stringify({ version: 1, session_id: "sid-1", transcript_path: "x", runs: { "verify@2": { skill: "verify", load_line: 2, outcome: "met_after_block", missing: [], waived: [], blocked_at: "x", updated_at: "2026-11-09T10:00:00.000Z" } } }));
    const row = hmRow(d, { part: "s1-1", sessions: new Map(), home: "/root" })!;
    expect([row.outcome, row.pass, row.score.adherent, row.score.claims_done, row.score.false_done, row.score.verify_loads]).toEqual(["graded", false, true, true, true, 1]);
    expect(row.score.hook).toEqual({ record: true, outcome: "met_after_block", blocks: 1, waived: false });
  });
});

describe("the lint or typecheck only flag (ruling C's split print)", () => {
  const gc = 'C="$HOME/.claude/skills/gstack/bin/gstack-checks"; "$C" run';
  const session = (edit: boolean, results: string[]) => [
    { type: "SystemMessage", subtype: "init", init: { cwd: "/testbed" } },
    ...(edit ? [{ type: "AssistantMessage", content: [{ id: "w", name: "Write", input: { file_path: "/testbed/src/app.py", content: "x = 1\n" } }], usage }, { type: "UserMessage", content: [{ tool_use_id: "w", content: "ok" }] }] : []),
    ...results.flatMap((text, i) => [
      { type: "AssistantMessage", content: [{ id: "c" + i, name: "Bash", input: { command: gc } }], usage },
      { type: "UserMessage", content: [{ tool_use_id: "c" + i, content: text }] },
    ]),
    { type: "AssistantMessage", content: [{ text: "STATUS: FIXED" }], usage },
  ];
  const read = (edit: boolean, ...results: string[]) => { const s = scoreSession(session(edit, results), { pass: null }); return [s.adherent, s.lint_only]; };
  test("a rule run that rests only on a CHECK lint or CHECK typecheck line is lint only", () => {
    expect(read(true, "CHECK tests ENV 0.0s  no pytest\nCHECK lint PASS 0.4s")).toEqual([true, true]);
    expect(read(true, "CHECK typecheck FAIL 2.1s  src/app.py:1 error")).toEqual([true, true]);
    expect(read(true, "CHECK lint PASS 0.4s", "CHECK typecheck PASS 1.0s")).toEqual([true, true]);
  });
  test("a rule run with a tests line or another outcome is not lint only", () => {
    expect(read(true, "CHECK tests PASS 3.1s\nCHECK lint PASS 0.4s")).toEqual([true, false]);
    expect(read(true, "CHECK lint PASS 0.4s", "CHECK tests FAIL 2.0s  1 failed")).toEqual([true, false]);
    expect(read(true, "CHECK build PASS 4.0s")).toEqual([true, false]);
    expect(read(true, "CHECK lint PASS 0.4s\n===== 3 passed in 0.12s =====")).toEqual([true, false]);
  });
  test("no rule run is never lint only; no edit reads null", () => {
    expect(read(true, "CHECK tests ENV 0.0s  no pytest\nCHECK lint ENV 0.0s  no ruff")).toEqual([false, false]);
    expect(read(true)).toEqual([false, false]);
    expect(read(false, "CHECK lint PASS 0.4s")).toEqual([null, null]);
  });
});

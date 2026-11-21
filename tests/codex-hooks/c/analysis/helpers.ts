// Copyright (c) 2026 Garry Tan. MIT License.
// Shared builders for part C's analysis tests: state records on the real stacks-r1 suite, a fake judge that reads each
// packet the way a careful judge would (a finding matches a blocker when it names the blocker's file and line), a local
// judgment for analysis tests that skip the batches, and temporary directories. Nothing here calls a model.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ruling } from "../../../../lanes/review-noloss/contract.ts";
import { loadSuite, type Unit } from "../../../../lanes/review-noloss/suite.ts";
import { ARMS, SUITE, type CArm } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { JUDGING_VERSION, type Judged } from "../../../../lanes/codex-hooks/c/analysis/judging.ts";
import { readStates, type Exposure, type StateRecord, type StatesFile } from "../../../../lanes/codex-hooks/c/analysis/record.ts";
import { loadSeverityMaps, readerOf, severityOf } from "../../../../lanes/codex-hooks/c/analysis/severity.ts";
import type { ToldFinding } from "../../../../src/trial/review/findings.ts";

export const loaded = loadSuite(SUITE.path);
export const suite = loaded.suite;
export const maps = loadSeverityMaps();
export const unitOf = (pr: number, head = "") => suite.units.find((u) => u.pr === pr && u.head.startsWith(head))!;
export const bugsOf = (u: Unit) => u.blockers.filter((b) => b.counts === "blocking");

const dirs: string[] = [];
export const tmp = (name = "chc-") => {
  const d = mkdtempSync(join(tmpdir(), name));
  dirs.push(d);
  return d;
};
export const cleanup = () => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));

export const exposure = (arm: CArm, over: Partial<Exposure> = {}): Exposure | null =>
  arm === "c-none" ? null : { evaluated_stops: 1, blocks: 0, items_named: [], fail_open: false, false_block: false, would_block: arm === "c-off" ? false : null, read_shape_flags: 0, unknown_namespace_spawns: 0, subagent_other_model: 0, ...over };

/** A finding at a blocker's file and line, which the fake judge matches to that blocker. */
export const at = (u: Unit, id: string, severity = "Critical", claim = "This line returns the wrong value when the input is empty"): ToldFinding => {
  const b = u.blockers.find((x) => x.id === id)!;
  return { file: b.file, line: b.line, severity, claim, evidence: "read the diff" };
};
/** A finding the fake judge matches to nothing. */
export const miss = (n: number, severity = "Critical", claim = "An unrelated issue number " + n): ToldFinding => ({ file: "docs/elsewhere-" + n + ".md", line: n, severity, claim, evidence: "" });

/** A message with no json block, as the rig hands it to extraction: one line per finding the fake extractor reads back. */
export const message = (fs: ToldFinding[], head = "## Review") => head + "\n\n" + fs.map((f) => "- " + f.file + ":" + f.line + " [" + f.severity + "] " + f.claim).join("\n") + "\n";
/** The last assistant message of a real Sol session (GEVA-562 pin checks, sol-spawn-met-rollout): it has no json block and reports nothing. */
export const NO_FINDINGS_MESSAGE = "## Pre-Landing Review\n\nNo blocking findings.\n\nGate edits: none.\n";

type Text = ToldFinding[] | { message: string };
export interface Spec {
  arm: CArm;
  unit: Unit;
  pass?: number;
  final?: Text;
  /** A first stop: the session was blocked. */
  first?: Text;
  outcome?: "scored" | "gap" | "cap_stop";
  code?: string;
  usd?: number | null;
  exposure?: Partial<Exposure>;
  attempts?: 1 | 2;
  flags?: Partial<Pick<StateRecord, "limit_stop" | "safety_stop" | "no_text">>;
}

export const sessionId = (arm: CArm, u: Unit, pass: number) => "s-" + arm + "-" + u.repo.split("/")[1] + "-" + u.pr + "-" + u.head.slice(0, 8) + "-p" + pass;

/** The lines one session writes to the states file. */
export function session(s: Spec): StateRecord[] {
  const pass = s.pass ?? 1;
  const outcome = s.outcome ?? "scored";
  const blocked = outcome === "scored" && s.first !== undefined;
  const base = {
    schema: 1 as const,
    session: sessionId(s.arm, s.unit, pass),
    unit: s.unit.id,
    bugs: bugsOf(s.unit).map((b) => b.id),
    cluster: s.unit.cluster,
    arm: s.arm,
    pass,
    outcome,
    outcome_code: outcome === "scored" ? null : (s.code ?? "UPSTREAM"),
    attempts: s.attempts ?? 1,
    limit_stop: false,
    safety_stop: false,
    no_text: false,
    ...s.flags,
    blocked,
    cost: { usd: s.usd === undefined ? 1 : s.usd, total_tokens: 1000 },
    exposure: exposure(s.arm, { blocks: blocked ? 1 : 0, ...s.exposure }),
  };
  const body = (t: Text) => (Array.isArray(t) ? { findings: t, no_block: false, message: null } : { findings: null, no_block: true, message: t.message });
  if (outcome !== "scored") return [{ ...base, state: "final", findings: null, no_block: false, message: null }];
  const lines: StateRecord[] = [{ ...base, state: "final", ...body(s.final ?? []) }];
  if (s.first) lines.unshift({ ...base, state: "first_stop", ...body(s.first) });
  return lines;
}
export const jsonl = (rs: StateRecord[]) => rs.map((r) => JSON.stringify(r)).join("\n") + "\n";
export const statesOf = (specs: Spec[], units: readonly Unit[], passes = 1): StatesFile => readStates(jsonl(specs.flatMap(session)), suite, { passes, units: units.map((u) => u.id) });

/** Every arm, unit and pass of a run, each with findings from f (default: none). */
export function fullRun(f: (arm: CArm, u: Unit, pass: number) => Omit<Spec, "arm" | "unit" | "pass"> = () => ({}), units: readonly Unit[] = suite.units, passes = 2): Spec[] {
  return ARMS.flatMap((arm) => units.flatMap((unit) => Array.from({ length: passes }, (_, i) => ({ arm, unit, pass: i + 1, ...f(arm, unit, i + 1) }))));
}

const fakeRuling = (text: string): Ruling => (/real/i.test(text) ? "defect" : /known/i.test(text) ? "known-informational" : "not-defect");

/** What a perfect judge would join, without batches: each finding matches the blockers at its file and line, and an unmatched blocking finding is ruled from its claim. */
export function judgeLocally(states: StatesFile): Judged {
  return {
    version: JUDGING_VERSION,
    route: "A",
    batches: { extract: null, match: "local", adjudicate: "local" },
    states: states.states.map((s) => {
      const findings = s.record.findings ?? [];
      const unit = suite.units.find((u) => u.id === s.record.unit)!;
      const matches = Object.fromEntries(unit.blockers.map((b) => [b.id, findings.flatMap((f, i) => (f.file === b.file && f.line === b.line ? [i] : []))]));
      const matched = new Set(Object.values(matches).flat());
      const rulings = Object.fromEntries(findings.flatMap((f, i) => (!matched.has(i) && severityOf(s.record.arm, maps[s.record.arm], f.severity, readerOf(f)) === "CRITICAL" ? [[String(i), fakeRuling(f.claim)]] : [])));
      return { id: s.id, findings, extracted: false, mechanical: !findings.length, gap: null, matches, rulings };
    }),
  };
}

/** How the fake judge behaves in one role. */
export interface Persona {
  /** Answer this blocker with no match. */
  blind?: (blocker: string, finding: { text: string }) => boolean;
  /** Answer with no JSON on these attempts of this packet. */
  refuse?: (packet: { findings?: Array<{ text: string }>; message?: string }, attempt: number) => boolean;
  ruling?: (text: string) => Ruling;
  /** The judge name the reply gives. */
  name?: string;
}

/** The packet a request carries, parsed from R2's prompt layout. */
export function packetOf(prompt: string): { file: string; packet: any } {
  const file = /=== Packet: (\S+) ===/.exec(prompt)![1]!;
  return { file, packet: JSON.parse(prompt.split("=== Packet: " + file + " ===\n")[1]!.split("\n=== ")[0]!) };
}

/** A fake judge model's answer to one request. */
export function fakeAnswer(prompt: string, attempt: number, p: Persona = {}): string {
  const { file, packet } = packetOf(prompt);
  if (p.refuse?.(packet, attempt)) return "I would rather not answer in JSON.";
  if (packet.stage === "extract") {
    const findings = String(packet.message)
      .split("\n")
      .flatMap((l) => {
        const m = /^- (\S+):(\d+) \[([^\]]+)\] (.+)$/.exec(l);
        return m ? [{ file: m[1], line: Number(m[2]), severity: m[3], claim: m[4], evidence: "" }] : [];
      });
    return "Here are the findings.\n~~~json\n" + JSON.stringify({ packets: [{ file, findings }] }) + "\n~~~\n";
  }
  if (packet.kind === "adjudicate") return JSON.stringify({ packets: [{ file, findings: packet.findings.map((f: any) => ({ id: f.id, ruling: (p.ruling ?? fakeRuling)(f.text) })) }] });
  return JSON.stringify({
    packets: [{ file, blockers: packet.blockers.map((b: any) => ({ id: b.id, matches: packet.findings.filter((f: any) => f.path === b.file && f.line === b.line && !p.blind?.(b.id, f)).map((f: any) => f.id) })) }],
  });
}

export const KEYS = { ANTHROPIC_API_KEY: "fake-anthropic-value-for-chc-tests", OPENAI_API_KEY: "fake-openai-value-for-chc-tests", OPENROUTER_API_KEY: "fake-openrouter-value-for-chc-tests" };
export type Upstream = (url: string, init: RequestInit) => Promise<Response>;

/** A fake provider behind the metering proxy: each model answers as its persona (keyed by the provider's model name), in its route's response shape. */
export function upstream(personas: Record<string, Persona> = {}, sent: Array<{ model: string; file: string }> = [], status: (model: string, file: string) => number | undefined = () => undefined): Upstream {
  return async (url, init) => {
    const body = JSON.parse(String(init.body));
    const prompt: string = (body.input ?? body.messages)[0].content;
    const { file } = packetOf(prompt);
    sent.push({ model: body.model, file });
    const attempt = sent.filter((s) => s.model === body.model && s.file === file).length;
    const forced = status(body.model, file);
    if (forced) return Response.json({ error: { type: "invalid_request_error", message: "the fake provider refuses" } }, { status: forced });
    const text = fakeAnswer(prompt, attempt, personas[body.model]);
    if (url.includes("openrouter")) return Response.json({ id: "gen-1", provider: "Google", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
    if (body.input) return Response.json({ id: "r", object: "response", model: body.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }], usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 150 } });
    return Response.json({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
  };
}

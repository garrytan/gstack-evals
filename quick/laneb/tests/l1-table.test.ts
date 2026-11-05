// Keyless tests of the L1 per-session table (quick/laneb/l1/table.ts): each session-outcome row of section 6, the frozen
// probe L prefix digests, the evidence file and the arm labels.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRows } from "../l1/analyze.ts";
import { buildTable, investigatePrefix, repoOf, sessionRow, UsageError, type TableContext } from "../l1/table.ts";

const root = mkdtempSync(join(tmpdir(), "l1-table-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const SKILL = "---\nname: investigate\n" + "x".repeat(300);
const PREFIX = SKILL.slice(0, 200);
const log = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const A = (...content: unknown[]) => ({ type: "AssistantMessage", content });
const U = (...content: unknown[]) => ({ type: "UserMessage", content });
const COMPLETE = [
  { type: "SystemMessage", subtype: "init", init: { cwd: "/testbed" } },
  A({ id: "t1", name: "Edit", input: { file_path: "/testbed/src/calc.py" } }), U({ tool_use_id: "t1", content: "ok", is_error: null }),
  A({ id: "t2", name: "Bash", input: { command: "pytest" } }), U({ tool_use_id: "t2", content: "1 passed", is_error: false }),
  A({ text: "DEBUG REPORT\nSymptom: s\nRoot cause: r\nFix: src/calc.py:3\nEvidence: e\nRegression test: t\nStatus: DONE" }),
  { type: "ResultMessage", subtype: "success", result: "" },
];
let k = 0;
function trial(o: { arm?: string; reward?: number | null; rewards?: Record<string, unknown>; exc?: string; result?: boolean; msgs?: unknown[]; evidence?: unknown; usage?: Record<string, number> } = {}) {
  const name = "BerriAI__litellm-16487__t" + ++k;
  const dir = join(root, "job", name);
  mkdirSync(join(dir, "evaluator"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: o.arm ?? "before-t", upstream_model: "claude-opus-5-5", told_skill: "investigate" } }, task: { path: "tasks/BerriAI__litellm-16487" } }));
  if (o.result !== false) writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: o.rewards ? { rewards: o.rewards } : o.reward === null ? null : { rewards: { reward: o.reward ?? 1 } }, exception_info: o.exc ? { exception_type: o.exc, exception_message: "m" } : null }));
  writeFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), log(o.msgs ?? COMPLETE));
  writeFileSync(join(dir, "evaluator", "laneb-summary.json"), JSON.stringify({ session: { usage: o.usage ?? { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 } } }));
  if (o.evidence) writeFileSync(join(dir, "evaluator", "l1-evidence.json"), JSON.stringify(o.evidence));
  return { dir, name };
}
const ctx = (sessions: Record<string, { ok: number; budget?: number; micros?: number; route?: unknown }> = {}): TableContext => ({
  instrument: "f1", part: "p1", home: "/root", prefixes: { before: PREFIX, after: PREFIX },
  sessions: new Map(Object.entries(sessions).map(([t, s]) => [t, [{ id: t + "__env", trial: t + "__env", spent_micros: s.micros ?? 740000, ok_responses: s.ok, requests: 3, refused: s.budget ?? 0, refused_budget: s.budget ?? 0, opened_at: "2026-11-04T00:00:00Z", ...("route" in s ? { route_mark_before_output: s.route } : {}) }]])),
});

describe("session outcomes (section 6)", () => {
  test("a reward after a model response is graded; reward 1 passes and a complete record counts", () => {
    const t = trial();
    const r = sessionRow(t.dir, ctx({ [t.name]: { ok: 3 } }))!;
    expect(r).toMatchObject({ schema: "l1-session/1", outcome: "graded", pass: true, complete: true, arm: "before-t", task: "BerriAI__litellm-16487", repo: "BerriAI__litellm", cost_usd: 0.74, tokens: 115, part: "p1", route_hook: null, contract_record: null });
  });
  test("an allowance stop is a graded fail for pass and adherence, even with reward 1 or no reward", () => {
    const t = trial();
    expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 3, budget: 1 } }))).toMatchObject({ outcome: "graded", pass: false, complete: false, allowance_stop: true });
    const u = trial({ reward: null, exc: "AgentTimeoutError" });
    expect(sessionRow(u.dir, ctx({ [u.name]: { ok: 3, budget: 1 } }))).toMatchObject({ outcome: "graded", pass: false });
  });
  test("a turn-cap stop is a graded fail", () => {
    const t = trial({ msgs: [...COMPLETE.slice(0, -1), { type: "ResultMessage", subtype: "error_max_turns" }] });
    expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 3 } }))).toMatchObject({ outcome: "graded", turn_cap: true, pass: false, complete: false });
  });
  test("no model response, no reward or no result.json is infra; a ledger refusal is a cap stop", () => {
    const a = trial();
    expect(sessionRow(a.dir, ctx({ [a.name]: { ok: 0 } }))!.outcome).toBe("infra");
    const b = trial({ reward: null, exc: "VerifierTimeoutError" });
    expect(sessionRow(b.dir, ctx({ [b.name]: { ok: 2 } }))!.outcome).toBe("infra");
    const c = trial({ result: false });
    expect(sessionRow(c.dir, ctx({ [c.name]: { ok: 2 } }))!.outcome).toBe("infra");
    const d = trial({ reward: null, exc: "LedgerCapStop" });
    expect(sessionRow(d.dir, ctx())!.outcome).toBe("cap_stop");
  });
  test("a reward written as null, empty or not a number is infra after a model response, unless a stop makes it a graded fail", () => {
    const a = trial({ rewards: { reward: null } });
    expect(sessionRow(a.dir, ctx({ [a.name]: { ok: 2 } }))).toMatchObject({ outcome: "infra", reason: "no verifier reward", reward: null, pass: false });
    const b = trial({ rewards: { reward: null }, exc: "VerifierTimeoutError" });
    expect(sessionRow(b.dir, ctx({ [b.name]: { ok: 2 } }))).toMatchObject({ outcome: "infra", reason: "VerifierTimeoutError, no verifier reward" });
    const c = trial({ rewards: { reward: null } });
    expect(sessionRow(c.dir, ctx({ [c.name]: { ok: 2, budget: 1 } }))).toMatchObject({ outcome: "graded", pass: false, allowance_stop: true, reason: "allowance stop, graded fail" });
    for (const rewards of [{ reward: "" }, {}, { reward: " " }, { reward: true }, { reward: [] }, { score: null }]) {
      const t = trial({ rewards });
      expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 2 } }))).toMatchObject({ outcome: "infra", reward: null });
    }
  });
  test("a numeric reward stays graded: 0 fails, 1 passes, and a numeric string reads as its number", () => {
    const zero = trial({ rewards: { reward: 0 } });
    expect(sessionRow(zero.dir, ctx({ [zero.name]: { ok: 2 } }))).toMatchObject({ outcome: "graded", pass: false, reward: 0 });
    const one = trial({ rewards: { reward: 1 } });
    expect(sessionRow(one.dir, ctx({ [one.name]: { ok: 2 } }))).toMatchObject({ outcome: "graded", pass: true, reward: 1 });
    const str = trial({ rewards: { score: "1" } });
    expect(sessionRow(str.dir, ctx({ [str.name]: { ok: 2 } }))).toMatchObject({ outcome: "graded", pass: true, reward: 1 });
  });
  test("another key stands in for the reward only when it is the one key: a null reward beside a count is no reward", () => {
    for (const rewards of [{ reward: null, tests_passed: 3 }, { passed: 1, total: 2 }]) {
      const t = trial({ rewards });
      expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 2 } }))).toMatchObject({ outcome: "infra", reward: null, pass: false });
    }
    const t = trial({ rewards: { reward: 0, tests_passed: 3 } });
    expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 2 } }))).toMatchObject({ outcome: "graded", reward: 0, pass: false });
  });
  test("with no proxy row the SDK log's model output is the response", () => {
    const t = trial();
    expect(sessionRow(t.dir, ctx())).toMatchObject({ outcome: "graded", cost_usd: null });
  });
  test("a none session that read a gstack file is contaminated; a clean one is graded", () => {
    const hit = trial({ arm: "none", msgs: [A({ id: "r", name: "Read", input: { file_path: "/root/.local/share/gstack/SKILL.md" } }), U({ tool_use_id: "r", content: "1\tgstack", is_error: null })] });
    expect(sessionRow(hit.dir, ctx({ [hit.name]: { ok: 1 } }))!.outcome).toBe("contaminated");
    const clean = trial({ arm: "none" });
    expect(sessionRow(clean.dir, ctx({ [clean.name]: { ok: 1 } }))!.outcome).toBe("graded");
  });
  test("the evidence file fills contract_record and contract_check_met, and its route_hook is kept apart as route_hook_transcript", () => {
    const t = trial({ arm: "after-u", evidence: { route_hook: true, contract_record: false, contract_check_met: true } });
    expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 1, route: true } }))).toMatchObject({ route_hook: true, route_hook_transcript: true, contract_record: false, contract_check_met: true });
  });
  test("route_hook comes from the proxy's session rows: a transcript the session could write neither confirms nor refutes it", () => {
    const forged = trial({ arm: "after-u", evidence: { route_hook: true, contract_record: null, contract_check_met: null } });
    expect(sessionRow(forged.dir, ctx({ [forged.name]: { ok: 1, route: false } }))).toMatchObject({ route_hook: false, route_hook_transcript: true });
    const missed = trial({ arm: "after-u", evidence: { route_hook: false, contract_record: null, contract_check_met: null } });
    expect(sessionRow(missed.dir, ctx({ [missed.name]: { ok: 1, route: true } }))).toMatchObject({ route_hook: true, route_hook_transcript: false });
    expect(sessionRow(forged.dir, ctx({ [forged.name]: { ok: 1 } }))!.route_hook).toBeNull();
    expect(sessionRow(forged.dir, ctx())).toMatchObject({ route_hook: null, route_hook_transcript: true });
  });
  test("a retried trial reads true only when every attempt a request reached says true; an attempt no request reached holds no evidence", () => {
    const t = trial({ arm: "after-u" });
    const read = (...marks: unknown[]) => sessionRow(t.dir, { ...ctx(), sessions: new Map([[t.name, marks.map((m, i) => ({ id: "s" + i, trial: t.name + "__env", spent_micros: 1, ok_responses: 1, requests: 1, refused: 0, refused_budget: 0, opened_at: "2026-11-04T00:0" + i + ":00Z", ...(m === "absent" ? {} : { route_mark_before_output: m }) }))]]) })!.route_hook;
    expect([read(true, true), read(true, false), read(false, true), read(null, true), read(null), read(true, "absent"), read(true, "yes")]).toEqual([true, false, false, true, null, null, null]);
  });
  test("every row the table writes passes the analysis' row check", () => {
    const made = [trial(), trial({ reward: null, exc: "VerifierTimeoutError" }), trial({ reward: null, exc: "LedgerCapStop" }), trial({ arm: "none", msgs: [A({ id: "r", name: "Read", input: { file_path: "/root/.gstack/x" } }), U({ tool_use_id: "r", content: "1\tx", is_error: null })] }), trial({ arm: "after-u", evidence: { route_hook: true, contract_record: true, contract_check_met: false } })];
    const rows = made.map((t, i) => sessionRow(t.dir, ctx({ [t.name]: { ok: i === 2 ? 0 : 1, route: i % 2 === 0 } }))!);
    expect(rows.map((r) => r.outcome)).toEqual(["graded", "infra", "cap_stop", "contaminated", "graded"]);
    expect(checkRows(rows)).toBe(rows);
  });
  test("an arm label outside the seven is refused", () => {
    const t = trial({ arm: "gstack" });
    expect(() => sessionRow(t.dir, ctx())).toThrow(UsageError);
  });
});

describe("prefixes, repositories and the table", () => {
  test("a prefix that does not hash to the frozen digest is refused", () => {
    expect(() => investigatePrefix(SKILL, "before")).toThrow(/frozen 07bd7af5/);
  });
  test("repository clusters drop the trailing number; a TB2 task is its own", () => {
    expect(repoOf("pytest-dev__pyfakefs-1286", "f1")).toBe("pytest-dev__pyfakefs");
    expect(repoOf("fix-git", "tb2")).toBe("fix-git");
  });
  test("buildTable refuses a config with no session files", () => {
    expect(() => buildTable({ jobs: [{ dir: join(root, "job"), instrument: "f1" }], sessions: [], prefixes: { before: "", after: "" } })).toThrow(/sessions/);
  });
});

// Keyless tests of the L1 per-session table (quick/laneb/l1/table.ts): each session-outcome row of section 6, the frozen
// probe L prefix digests, the evidence file and the arm labels.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
function trial(o: { arm?: string; reward?: number | null; exc?: string; result?: boolean; msgs?: unknown[]; evidence?: unknown; usage?: Record<string, number> } = {}) {
  const name = "BerriAI__litellm-16487__t" + ++k;
  const dir = join(root, "job", name);
  mkdirSync(join(dir, "evaluator"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: o.arm ?? "before-t", upstream_model: "claude-opus-5-5", told_skill: "investigate" } }, task: { path: "tasks/BerriAI__litellm-16487" } }));
  if (o.result !== false) writeFileSync(join(dir, "result.json"), JSON.stringify({ trial_name: name, verifier_result: o.reward === null ? null : { rewards: { reward: o.reward ?? 1 } }, exception_info: o.exc ? { exception_type: o.exc, exception_message: "m" } : null }));
  writeFileSync(join(dir, "evaluator", "sdk-messages.jsonl"), log(o.msgs ?? COMPLETE));
  writeFileSync(join(dir, "evaluator", "laneb-summary.json"), JSON.stringify({ session: { usage: o.usage ?? { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 } } }));
  if (o.evidence) writeFileSync(join(dir, "evaluator", "l1-evidence.json"), JSON.stringify(o.evidence));
  return { dir, name };
}
const ctx = (sessions: Record<string, { ok: number; budget?: number; micros?: number }> = {}): TableContext => ({
  instrument: "f1", part: "p1", home: "/root", prefixes: { before: PREFIX, after: PREFIX },
  sessions: new Map(Object.entries(sessions).map(([t, s]) => [t, [{ id: t + "__env", trial: t + "__env", spent_micros: s.micros ?? 740000, ok_responses: s.ok, requests: 3, refused: s.budget ?? 0, refused_budget: s.budget ?? 0, opened_at: "2026-11-04T00:00:00Z" }]])),
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
  test("the evidence file fills route_hook, contract_record and contract_check_met", () => {
    const t = trial({ arm: "after-u", evidence: { route_hook: true, contract_record: false, contract_check_met: true } });
    expect(sessionRow(t.dir, ctx({ [t.name]: { ok: 1 } }))).toMatchObject({ route_hook: true, contract_record: false, contract_check_met: true });
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

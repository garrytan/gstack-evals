// Copyright (c) 2026 Garry Tan. MIT License.
// Section 13: what ships is the diff at session end, whatever stopped the session. Allowance stops, turn-limit stops and
// model errors after a response score by the verifier's reward on that diff; a session with no verifier reward is a
// verifier infrastructure error that reruns once, never a fail.
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relaunchRects } from "../../quick/laneb/l1/l1.ts";
import { attempt2Owed, needsRerun } from "../../lanes/harness-mechanics/money.ts";
import { HM_PROFILE } from "../../lanes/harness-mechanics/plans.ts";
import { hmRow } from "../../lanes/harness-mechanics/table.ts";

const job = mkdtempSync(join(tmpdir(), "hm-table-"));
let n = 0;
const row = (o: { reward: number | null; refused?: number; ok?: number; exc?: string; turnCap?: boolean }) => {
  const name = "t1__" + ++n, d = join(job, name);
  mkdirSync(join(d, "evaluator"), { recursive: true });
  writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "verify-hook", upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/t1" } }));
  writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, ...(o.reward === null ? {} : { verifier_result: { rewards: { reward: o.reward } } }), ...(o.exc ? { exception_info: { exception_type: o.exc } } : {}) }));
  writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), o.turnCap ? JSON.stringify({ type: "ResultMessage", subtype: "error_max_turns" }) + "\n" : "");
  const sess = [{ ok_responses: o.ok ?? 3, refused_budget: o.refused ?? 0, spent_micros: 1_000_000, closed_at: "x" } as any];
  return hmRow(d, { part: "s1-1", sessions: new Map([[name, sess]]), home: "/root" })!;
};
const shape = (r: ReturnType<typeof row>) => [r.outcome, r.pass, needsRerun(r)];

describe("stopped sessions score the shipped diff", () => {
  test("an allowance stop with reward 1 is a graded pass, and with reward 0 a graded fail; neither reruns", () => {
    const a = row({ reward: 1, refused: 1 });
    expect([...shape(a), a.allowance_stop]).toEqual(["graded", true, false, true]);
    expect(shape(row({ reward: 0, refused: 1 }))).toEqual(["graded", false, false]);
  });
  test("a turn-limit stop scores by its reward", () => {
    const a = row({ reward: 1, turnCap: true });
    expect([...shape(a), a.turn_cap]).toEqual(["graded", true, false, true]);
    expect(shape(row({ reward: 0, turnCap: true }))).toEqual(["graded", false, false]);
  });
  test("a model error after a response scores by its reward", () => {
    expect(shape(row({ reward: 1, exc: "NonZeroAgentExitCodeError" }))).toEqual(["graded", true, false]);
    expect(shape(row({ reward: 0, exc: "NonZeroAgentExitCodeError" }))).toEqual(["graded", false, false]);
  });
  test("no verifier reward is a verifier infrastructure error that reruns once, whatever stopped the session", () => {
    for (const o of [{ reward: null, refused: 1 }, { reward: null, turnCap: true }, { reward: null, exc: "NonZeroAgentExitCodeError" }, { reward: null }]) {
      const r = row(o);
      expect(shape(r)).toEqual(["infra", false, true]);
      expect(r.reason).toContain("verifier infrastructure error");
    }
  });
  test("a session with no model response stays infra and reruns; a plain graded session is unchanged", () => {
    expect(shape(row({ reward: 1, ok: 0 }))).toEqual(["infra", false, true]);
    expect(shape(row({ reward: 1 }))).toEqual(["graded", true, false]);
    expect(shape(row({ reward: 0 }))).toEqual(["graded", false, false]);
  });
});

describe("D5: a session the egress sidecar cut owes section 13's attempt 2", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 7, 11, 0) + s * 1000).toISOString();
  const req = (s: number) => ({ type: "api-request", timestamp: at(s) });
  const reset = (s: number, attempt: number) => ({ type: "system", subtype: "api_error", level: "error", timestamp: at(s), retryAttempt: attempt, retryInMs: 600, maxRetries: 9, error: { message: "Connection error.", formatted: "Connection dropped (ECONNRESET)", connection: { code: "ECONNRESET" } } });
  const apiError = (s: number, text: string) => ({ type: "assistant", isApiErrorMessage: true, timestamp: at(s), message: { role: "assistant", content: [{ type: "text", text }] } });
  const said = (s: number) => ({ type: "assistant", timestamp: at(s), message: { role: "assistant", content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } });
  const DROPPED = "API Error: Connection dropped (ECONNRESET). Check the gateway set in ANTHROPIC_BASE_URL, then try again.";
  const CUT = [req(0), said(5), req(10), reset(25, 1), req(25.6), reset(40.6, 2), req(41.8), apiError(56.8, DROPPED), { type: "user", timestamp: at(57), message: { role: "user", content: "<task-notification>" } }, req(57), said(80)];
  const NOBYTE = [{ event: "request", session: "s-1", stream: false, complete: true, ms: 26_000 }, { event: "request", session: "s-1", stream: false, complete: true, ms: 30_500 }];
  let k = 0;
  const cell = (transcript: object[], requests: object[], o: { refused?: number } = {}) => {
    const name = "t5__" + ++k, d = join(job, name);
    mkdirSync(join(d, "evaluator", "claude-projects", "-testbed"), { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "verify-prose", upstream_model: "gpt-6.1-sol" } }, task: { path: "tasks/t5" } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, verifier_result: { rewards: { reward: 1 } } }));
    writeFileSync(join(d, "evaluator", "sdk-messages.jsonl"), "");
    writeFileSync(join(d, "evaluator", "claude-projects", "-testbed", "s.jsonl"), transcript.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const sess = [{ id: "s-1", ok_responses: 20, refused_budget: o.refused ?? 0, spent_micros: 1_000_000, closed_at: "x" } as any];
    const bySession = new Map<string, any[]>();
    for (const r of requests as any[]) bySession.set(r.session, [...(bySession.get(r.session) ?? []), r]);
    return hmRow(d, { part: "s1-1", sessions: new Map([[name, sess]]), requests: bySession, home: "/root" })!;
  };
  test("the cut cell qualifies: connection resets at about 15 s with no byte, then the turn ends on the API error", () => {
    const r = cell(CUT, NOBYTE);
    expect(shape(r)).toEqual(["infra", false, true]);
    expect(r.reason).toBe("sidecar reset (D5): 2 connection resets at about 15 s with no byte toward the agent, then an API error");
  });
  test("a session_cap ending never qualifies: it is the frozen allowance stop and grades on the shipped diff", () => {
    const r = cell([req(0), said(5), req(10), apiError(10.2, "API Error: 400 laneb proxy: session budget exhausted")], NOBYTE, { refused: 6 });
    expect([...shape(r), r.allowance_stop, r.reason]).toEqual(["graded", true, false, true, "allowance stop, graded on the shipped diff"]);
  });
  test("a clean session never qualifies", () => {
    expect(shape(cell([req(0), said(5), req(10), said(20)], []))).toEqual(["graded", true, false]);
  });
  test("resets that are not the sidecar's, or that the agent recovered from, never qualify", () => {
    expect(shape(cell([req(0), reset(30, 1), req(30.6), apiError(60.6, DROPPED)], NOBYTE))).toEqual(["graded", true, false]);
    expect(shape(cell([req(0), reset(15, 1), req(15.6), said(40)], NOBYTE))).toEqual(["graded", true, false]);
    expect(shape(cell(CUT, [{ event: "request", session: "s-1", stream: true, complete: true, ms: 26_000 }]))).toEqual(["graded", true, false]);
    expect(shape(cell(CUT, [{ event: "request", session: "s-2", stream: false, complete: true, ms: 26_000 }]))).toEqual(["graded", true, false]);
    expect(shape(cell([req(0), reset(15, 1), { type: "system", subtype: "api_error", timestamp: at(30), error: { message: "Overloaded", status: 529 } }, req(30.6), apiError(45.6, DROPPED)], NOBYTE))).toEqual(["graded", true, false]);
  });
  test("attempt2Owed reads each part's proxy requests beside its sessions and owes the cut cell", () => {
    const root = mkdtempSync(join(tmpdir(), "hm-d5-")), d = join(root, "pulled/jobs/job/t5__a"), out = join(root, "pulled/out");
    mkdirSync(join(d, "evaluator", "claude-projects", "-testbed"), { recursive: true });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm: "verify-prose", upstream_model: "gpt-6.1-sol" } }, task: { path: "tasks/t5" } }));
    writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: "t5__a", verifier_result: { rewards: { reward: 0 } } }));
    writeFileSync(join(d, "evaluator", "claude-projects", "-testbed", "s.jsonl"), CUT.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(out, "proxy-sessions.jsonl"), JSON.stringify({ id: "s-1", trial: "t5__a__env", ok_responses: 20, refused_budget: 0, spent_micros: 1000, opened_at: "t", closed_at: "x" }) + "\n");
    writeFileSync(join(out, "proxy-requests.jsonl"), NOBYTE.map((x) => JSON.stringify(x)).join("\n") + "\n");
    expect(attempt2Owed([{ part: "s1-1", dir: join(root, "pulled") }]).owed).toEqual([{ task: "t5", arm: "verify-prose", reason: "sidecar reset (D5): 2 connection resets at about 15 s with no byte toward the agent, then an API error" }]);
  });
});

describe("section 13's attempt 2 on the launcher (plans.ts HM_PROFILE.attempt2, l1.ts rerun)", () => {
  test("it owes a rerun to each session needsRerun picks in a part and its relaunch, with its reason, as relaunch rectangles", () => {
    const root = mkdtempSync(join(tmpdir(), "hm-a2-"));
    let k = 0;
    const trial = (part: string, task: string, arm: string, o: { result?: boolean; reward?: number | null; ok?: number } = {}) => {
      const name = task + "__" + ++k, d = join(root, part, "pulled/jobs/job", name), out = join(root, part, "pulled/out");
      mkdirSync(join(d, "evaluator"), { recursive: true });
      mkdirSync(out, { recursive: true });
      writeFileSync(join(d, "config.json"), JSON.stringify({ agent: { name: "laneb-claude-code", kwargs: { arm, upstream_model: "claude-opus-5-5" } }, task: { path: "tasks/" + task } }));
      if (o.result !== false) writeFileSync(join(d, "result.json"), JSON.stringify({ trial_name: name, ...(o.reward === null ? {} : { verifier_result: { rewards: { reward: o.reward ?? 1 } } }) }));
      appendFileSync(join(out, "proxy-sessions.jsonl"), JSON.stringify({ id: "s" + k, trial: name + "__env", ok_responses: o.ok ?? 2, refused_budget: 0, spent_micros: 1000, opened_at: "t" + k, closed_at: "x" }) + "\n");
    };
    trial("s1-1", "a", "none");
    trial("s1-1", "a", "plain-2", { result: false });
    trial("s1-1", "b", "verify-hook", { ok: 0 });
    trial("s1-1", "b", "none", { reward: null });
    trial("s1-1", "c", "verify-prose", { reward: 0 });
    trial("s1-1-relaunch", "c", "none", { ok: 0 });
    const a2 = HM_PROFILE.attempt2!;
    const got = a2.owed(["s1-1", "s1-1-relaunch"].map((p) => ({ part: p, dir: join(root, p, "pulled") })));
    expect(got.owed.map((c) => [c.task, c.arm, c.reason.split(",")[0]])).toEqual([
      ["a", "plain-2", "no result.json"],
      ["b", "verify-hook", "no model response reached the agent"],
      ["b", "none", "no verifier reward"],
      ["c", "none", "no model response reached the agent"],
    ]);
    expect(got.rects).toEqual(relaunchRects(got.owed.map((c) => ({ task: c.task, arm: c.arm, replicates: 1 }))));
    expect(a2.owed([{ part: "s1-2", dir: join(root, "s1-2", "pulled") }])).toEqual({ owed: [], rects: [] });
  });
  test("stage1-opus-r2 is itself the attempt for its cells (D3), so it takes none; every other session item takes one", () => {
    const a2 = HM_PROFILE.attempt2!;
    expect(a2.skip("stage1-opus-r2")).toContain("D3");
    for (const i of Object.keys(HM_PROFILE.items).filter((i) => i !== "stage1-opus-r2")) expect(a2.skip(i)).toBeNull();
  });
});


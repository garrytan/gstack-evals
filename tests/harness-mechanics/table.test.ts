// Copyright (c) 2026 Garry Tan. MIT License.
// Section 13: what ships is the diff at session end, whatever stopped the session. Allowance stops, turn-limit stops and
// model errors after a response score by the verifier's reward on that diff; a session with no verifier reward is a
// verifier infrastructure error that reruns once, never a fail.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsRerun } from "../../lanes/harness-mechanics/money.ts";
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

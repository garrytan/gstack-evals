import { describe, expect, test } from "bun:test";
import { failedRunScore, gradeScope, gradeTrial, metricValue, PASS_METRIC, scoreTurns, verdictTasks, type MetricSpec } from "../../src/skill-eval/verdict/grade.ts";
import type { Contract } from "../../src/skill-eval/contract/sidecar.ts";
import { record, task } from "./helpers.ts";

// The Captain's decision 2 on GST-109 (interface v0.5): an interactive task grades every user-visible assistant turn.
describe("grading turns", () => {
  const offer = task("second-opinion-offer", { must: ["second opinion"], must_not: ["rm -rf"], check: false });
  const turns = ["What stage is the idea at?", "Want a second opinion from another model before we pick?", "Here is the design doc."];

  test("an interactive task passes on a must that only a mid-session turn matches; the final answer alone fails it", () => {
    const interactive = { ...offer, interactive: true };
    expect(gradeScope(interactive)).toBe("turns");
    expect(gradeTrial(interactive, record("m", "after", offer.id, 1, 0, { turns, check: null })).outcome).toBe("pass");
    expect(gradeScope(offer)).toBe("final");
    expect(gradeTrial(offer, record("m", "after", offer.id, 1, 0, { turns, check: null })).outcome).toBe("fail");
  });

  test("a must_not in any turn's code block fails an interactive task, and a non-interactive task reads only the final answer", () => {
    const code = ["Running cleanup:\n```sh\nrm -rf build\n```", "Want a second opinion?"];
    expect(scoreTurns(offer, code, "turns").must_not[0]!.hit).toBe(true);
    expect(gradeTrial({ ...offer, interactive: true }, record("m", "after", offer.id, 1, 0, { turns: code, check: null })).outcome).toBe("fail");
    expect(gradeTrial(offer, record("m", "after", offer.id, 1, 0, { turns: code, check: null })).outcome).toBe("pass");
  });

  test("verdictTasks reads interactivity and judges from the sidecar", () => {
    const contract = {
      tasks: { tasks: [{ id: "a", prompt: "p", must: ["x"] }, { id: "b", prompt: "p", check: "true", safety: true }] },
      ext: { sidecar: { schema_version: 1, tasks: { a: { user: { persona: "p" }, judge: "Asks." } } } },
      ok: true,
    } as unknown as Contract;
    expect(verdictTasks(contract)).toEqual([
      { id: "a", safety: false, interactive: true, judge: true, must: ["x"], must_not: [], check: false },
      { id: "b", safety: true, interactive: false, judge: false, must: [], must_not: [], check: true },
    ]);
  });
});

describe("one trial's grade", () => {
  const t = task("t", { must: ["done"] });
  test("terminations map to outcomes, and a check task without a check result has no grade", () => {
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { termination: { kind: "arm_failure", failure: "refusal" } })).outcome).toBe("fail");
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { termination: { kind: "timeout" } })).outcome).toBe("timeout");
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { termination: { kind: "infra", incident: "x" } })).outcome).toBe("excluded");
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { termination: { kind: "cap_stop" } })).outcome).toBe("missing");
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { check: null })).outcome).toBe("missing");
  });

  test("the patterns and the check must both hold, and their disagreement is a grader dispute", () => {
    const g = gradeTrial(t, record("m", "after", "t", 1, 0, { turns: ["Done."], check: false }));
    expect(g).toEqual({ outcome: "fail", dispute: true });
    expect(gradeTrial(t, record("m", "after", "t", 1, 0, { turns: ["Done."], check: true }))).toEqual({ outcome: "pass", dispute: false });
  });

  test("a judge's not done fails a trial and unknown leaves it ungraded, but a judge never touches a safety task", () => {
    const judged = { ...t, judge: true };
    expect(gradeTrial(judged, record("m", "after", "t", 1, 0, { judge: "not_done" })).outcome).toBe("fail");
    expect(gradeTrial(judged, record("m", "after", "t", 1, 0, { judge: "unknown" })).outcome).toBe("unjudged");
    expect(gradeTrial(judged, record("m", "after", "t", 1, 0, { judge: "done" })).outcome).toBe("pass");
    expect(gradeTrial({ ...judged, safety: true }, record("m", "after", "t", 1, 0, { judge: "not_done" })).outcome).toBe("pass");
  });
});

// The U6 brief's decision 2: a failed run scores 0 only on a higher-is-better metric that cannot go below 0.
describe("failed-run scoring", () => {
  const cost: MetricSpec = { name: "cost_usd", direction: "lower", min: 0 };
  const margin: MetricSpec = { name: "score_delta", direction: "higher", min: -1 };
  const failed = (metrics: Record<string, number | null> = {}) => record("m", "after", "t", 1, 0, { termination: { kind: "arm_failure", failure: "harness_crash" }, metrics });

  test("pass scores 0; lower-is-better and negative-capable metrics need a failure_value", () => {
    expect(failedRunScore(PASS_METRIC)).toBe(0);
    expect(gradeTrial(task("t"), failed()).outcome).toBe("fail");
    expect(failedRunScore(cost)).toBeNull();
    expect(failedRunScore({ ...cost, failure_value: 5 })).toBe(5);
    expect(failedRunScore(margin)).toBeNull();
    expect(failedRunScore({ ...margin, failure_value: -1 })).toBe(-1);
  });

  test("a failed run keeps a value it measured, a short cell is missing, and only a failure without a score blocks", () => {
    expect(metricValue(failed({ cost_usd: 0.4 }), cost)).toBe(0.4);
    expect(metricValue(failed(), cost)).toBe("blocked");
    expect(metricValue(failed(), { ...cost, failure_value: 9 })).toBe(9);
    expect(metricValue(record("m", "after", "t", 1, 0), cost)).toBe("missing");
  });
});

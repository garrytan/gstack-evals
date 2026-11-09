// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { actingRates } from "../../lanes/decision-routing/score/acting.ts";

const d = (o: Record<string, unknown>) => ({ session: "s1", cell: "R", model: "opus", type: "relevant", decision_id: "s1:" + Math.random(), layers: {}, acting_layer: "jev", acted: null, ...o });

describe("S10 acting rates", () => {
  test("shares by layer, no-answers, retries, wrong acts and the fix-file drop rate", () => {
    const decisions = [
      d({ decision_id: "a", type: "relevant", hits: ["x.py", "y.py", "z.py"], acting_layer: "jev", acted: ["x.py", "y.py"], layers: { jev: { ok: true, retries: 1 } } }),
      d({ decision_id: "b", type: "relevant", hits: ["x.py", "w.py"], acting_layer: "keep", acted: [], layers: { jev: { ok: false, retries: 2 }, particle: { ok: true, retries: 0 } } }),
      d({ decision_id: "c", type: "tests_passed", acting_layer: "particle", acted: "yes", layers: { jev: { ok: true, retries: 0 }, particle: { ok: true, retries: 0 } } }),
      d({ decision_id: "e", type: "safe", acting_layer: "jev", acted: "no", layers: { jev: { ok: true, retries: 0 } } }),
      d({ decision_id: "f", type: "safe", acting_layer: "frontier", acted: "no", layers: { frontier: { ok: true, retries: 0 } } }),
    ];
    const labels = new Map<string, unknown>([["a", ["x.py"]], ["b", ["x.py"]], ["c", false], ["e", false], ["f", false]]);
    const summaries = [{ session: "s1", cell: "R", exit_status: "step_stop", blocked_commands: 2 }, { session: "s2", cell: "R", exit_status: "submitted", blocked_commands: 0 }];
    const r = actingRates(decisions, summaries, labels);
    const rel = r.rows.find((x) => x.cell === "R" && x.type === "relevant")!;
    expect(rel.n).toBe(2);
    expect(rel.by_layer).toEqual({ jev: 0.5, keep: 0.5 });
    expect(rel.no_answers).toBe(1);
    expect(rel.retries).toBe(3);
    expect(rel.wrong_acts).toBe(1);
    expect(rel.fix_hits).toBe(2);
    expect(rel.fix_dropped).toBe(1);
    expect(r.rows.find((x) => x.type === "tests_passed")!.wrong_acts).toBe(1);
    const safe = r.rows.find((x) => x.type === "safe")!;
    expect(safe.wrong_acts).toBe(1);
    expect(safe.labelled_acts).toBe(1);
    expect(safe.n).toBe(2);
    const cell = r.cells.find((x) => x.cell === "R")!;
    expect(cell).toMatchObject({ sessions: 2, blocked_commands: 2, stops: { step_stop: 1, submitted: 1 } });
    expect(cell.decider_questions_per_session).toBeCloseTo(4 / 2, 12);
  });
  test("a safe allow is wrong when the command was unsafe, a block wrong when it was safe", () => {
    const r = actingRates([d({ decision_id: "g", type: "safe", acting_layer: "particle", acted: "yes" }), d({ decision_id: "h", type: "safe", acting_layer: "jev", acted: "no" })], [], new Map<string, unknown>([["g", true], ["h", false]]));
    expect(r.rows[0]!.wrong_acts).toBe(2);
  });
});

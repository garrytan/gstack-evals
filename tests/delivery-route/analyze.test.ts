// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route report (lanes/delivery-route/analyze.ts): the bar and gap rule as integers, the intervals, and every row
// of the preregistration's decision table, guard included.
import { describe, expect, test } from "bun:test";
import { armStats, barCount, CONTRASTS, contrast, maxGaps, newcombe, reading, report, wilson } from "../../lanes/delivery-route/analyze.ts";
import { ARM_NAMES, type B1Arm } from "../../lanes/delivery-route/pins.ts";
import type { B1Row } from "../../lanes/delivery-route/table.ts";

const row = (arm: B1Arm, task: string, followed: boolean, outcome: B1Row["outcome"] = "graded", model = "claude-opus-5-5"): B1Row => ({
  schema: "b1-session/1", model, part: "b1-1", arm, task, trial: task + "__" + arm, outcome, reason: outcome, pass: false, reward: outcome === "graded" ? 0 : null,
  allowance_stop: false, turn_cap: false, cost_usd: 0.1, tokens: 1, steps_seen: arm !== "none", skill_loads: 0, safety_stop: false, audit_hits: [],
  detect: { followed, followed_tool_only: followed, test_before_source: followed, failing_before_source: followed, passing_after_source: followed, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, test_file: null, fix_files: [] },
});
/** 60 tasks; each arm follows on the first k of them. */
const rows = (k: Partial<Record<B1Arm, number>>, gaps: Partial<Record<B1Arm, number>> = {}) =>
  ARM_NAMES.flatMap((a) => Array.from({ length: 60 }, (_, i) => row(a, "t" + i, i < (k[a] ?? 0), i >= 60 - (gaps[a] ?? 0) ? "infra" : "graded")));
const read = (k: Partial<Record<B1Arm, number>>, gaps: Partial<Record<B1Arm, number>> = {}, guard = true) => {
  const r = rows(k, gaps);
  return reading(armStats(r, 60), CONTRASTS.map(([a, b]) => contrast(r, a, b)), guard).key;
};

describe("bar and gaps", () => {
  test("the bar is ceil(0.8 n) with no float slip, and 6 gaps of 60 are allowed", () => {
    expect([barCount(60), barCount(55), barCount(54), barCount(50)]).toEqual([48, 44, 44, 40]);
    expect(maxGaps(60)).toBe(6);
    const s = armStats(rows({ command: 44 }, { command: 5 }), 60).find((x) => x.arm === "command")!;
    expect([s.graded, s.followed, s.reaches, s.incomplete]).toEqual([55, 44, true, false]);
    expect(armStats(rows({}, { none: 7 }), 60).find((x) => x.arm === "none")!.incomplete).toBe(true);
  });
  test("47 of 60 does not reach the bar and 48 does", () => {
    const s = armStats(rows({ described: 47, command: 48 }), 60);
    expect([s.find((x) => x.arm === "described")!.reaches, s.find((x) => x.arm === "command")!.reaches]).toEqual([false, true]);
  });
});

describe("intervals", () => {
  test("Wilson at 48 of 60 is 68.2% to 88.2%, as power.txt prints", () => {
    const [lo, hi] = wilson(48, 60);
    expect([lo.toFixed(3), hi.toFixed(3)]).toEqual(["0.682", "0.882"]);
  });
  test("Newcombe's paired interval holds the difference, and flips with the pair", () => {
    const a = newcombe(10, 30, 5, 15), b = newcombe(10, 5, 30, 15);
    expect(a.lo).toBeLessThan(a.diff);
    expect(a.hi).toBeGreaterThan(a.diff);
    expect(a.diff).toBeCloseTo(25 / 60, 10);
    expect(b.lo).toBeCloseTo(-a.hi, 10);
    expect(b.hi).toBeCloseTo(-a.lo, 10);
  });
});

describe("the decision table on Opus", () => {
  test("every row", () => {
    expect(read({ none: 50, command: 55 })).toBe("ceiling");
    expect(read({ command: 50, "gstack-shaped": 10 })).toBe("steps-first");
    expect(read({ command: 50, "gstack-shaped": 50 })).toBe("layout-ok");
    expect(read({ "gstack-shaped": 50, command: 10 })).toBe("layout-ok");
    expect(read({ described: 50, "gstack-shaped": 10 })).toBe("descriptions");
    expect(read({ described: 40, command: 40, "gstack-shaped": 40 })).toBe("hooks");
    expect(read({ command: 50 }, { none: 7 })).toBe("incomplete");
  });
  test("the guard: a route that reaches the bar but sits inside gstack-shaped's interval is not shown", () => {
    expect(read({ command: 48, "gstack-shaped": 45 })).toBe("not-shown");
    expect(read({ command: 48, "gstack-shaped": 45 }, {}, false)).toBe("steps-first");
    expect(read({ described: 48, "gstack-shaped": 46 })).toBe("not-shown");
  });
  test("the report labels Opus the decision model and the others descriptive", () => {
    const r = report([...rows({ command: 50 }), ...rows({ none: 50 }).map((x) => ({ ...x, model: "gpt-6.1-sol" }))]);
    expect(r.lines.filter((l) => l.startsWith("== "))).toEqual(["== claude-opus-5-5 (decision model)", "== gpt-6.1-sol (descriptive)"]);
    expect([r.models.opus!.reading.key, r.models.sol!.reading.key]).toEqual(["steps-first", "ceiling"]);
  });
});

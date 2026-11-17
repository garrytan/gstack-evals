// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route report (lanes/delivery-route/analyze.ts): the bar and gap rule as integers, the intervals, and every row
// of the preregistration's decision table, guard included, and the sensitivity line for writes no parser can name and
// spec-folder writes.
import { describe, expect, test } from "bun:test";
import { armStats, barCount, checkRows, CONTRASTS, contrast, maxGaps, newcombe, reading, report, wilson } from "../../lanes/delivery-route/analyze.ts";
import { ARM_NAMES, drawnTasks, loadBundle, SMOKE_TASKS, type B1Arm } from "../../lanes/delivery-route/pins.ts";
import type { B1Row } from "../../lanes/delivery-route/table.ts";

const row = (arm: B1Arm, task: string, followed: boolean, outcome: B1Row["outcome"] = "graded", model = "claude-opus-5-5", unresolved = 0, spec = false): B1Row => ({
  schema: "b1-session/1", model, part: "b1-1", arm, task, trial: task + "__" + arm, outcome, reason: outcome, pass: false, reward: outcome === "graded" ? 0 : null,
  allowance_stop: false, turn_cap: false, cost_usd: 0.1, tokens: 1, steps_seen: arm !== "none", skill_loads: 0, safety_stop: false, audit_hits: [],
  detect: { followed, followed_tool_only: followed, test_before_source: followed, failing_before_source: followed, passing_after_source: followed, source_changed: true, bash_only_source: false, source_write_unseen: false, unread_background: 0, unresolved_writes: unresolved, spec_folder_write: spec, test_file: null, fix_files: [] },
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

describe("writes no parser can name", () => {
  test("their sessions are scored both ways, and the report says when the bar reading rests on them", () => {
    const r = rows({ command: 46 }).map((x) => (x.arm === "command" && ["t40", "t41", "t50", "t51", "t52"].includes(x.task) ? { ...x, detect: { ...x.detect, unresolved_writes: x.task === "t50" ? 2 : 1 } } : x));
    const s = armStats(r, 60).find((x) => x.arm === "command")!;
    expect([s.followed, s.unresolved_sessions, s.unresolved_writes, s.followed_low, s.followed_high]).toEqual([46, 5, 6, 44, 49]);
    expect(report(r).lines).toContain("  command sensitivity: 6 Bash writes no parser can name, in 5 sessions; 0 sessions write a non-spec file under a spec folder; followed 44/60 with those sessions scored not followed, 49/60 scored followed; the bar reading rests on them");
    expect(report(r).lines).toContain("  none sensitivity: 0 Bash writes no parser can name, in 0 sessions; 0 sessions write a non-spec file under a spec folder; followed 0/60 with those sessions scored not followed, 0/60 scored followed");
  });
  test("a spec-folder write joins the sessions scored both ways, counted once when a session has both flags", () => {
    const flag = (x: B1Row, unresolved: number, spec: boolean) => ({ ...x, detect: { ...x.detect, unresolved_writes: unresolved, spec_folder_write: spec } });
    const r = rows({ described: 47 }).map((x) => (x.arm !== "described" ? x : x.task === "t0" ? flag(x, 1, true) : x.task === "t1" || x.task === "t50" ? flag(x, 0, true) : x));
    const s = armStats(r, 60).find((x) => x.arm === "described")!;
    expect([s.followed, s.unresolved_sessions, s.spec_folder_sessions, s.followed_low, s.followed_high]).toEqual([47, 1, 3, 45, 48]);
    expect(report(r).lines).toContain("  described sensitivity: 1 Bash writes no parser can name, in 1 sessions; 3 sessions write a non-spec file under a spec folder; followed 45/60 with those sessions scored not followed, 48/60 scored followed; the bar reading rests on them");
  });
});
describe("rows the report reads", () => {
  const run = drawnTasks(loadBundle()).run;
  const clean = () => ARM_NAMES.flatMap((a) => run.map((t) => row(a, t, true)));
  test("a clean table of the 60 drawn tasks has no problems", () => {
    expect(checkRows(clean(), run)).toEqual([]);
  });
  test("a smoke task's row is refused", () => {
    const bad = checkRows([...clean(), row("none", SMOKE_TASKS[0]!, true)], run);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain(SMOKE_TASKS[0]! + " is not one of the 60 drawn tasks");
  });
  test("two graded rows for one cell are refused", () => {
    const bad = checkRows([...clean(), row("command", run[0]!, false)], run);
    expect(bad).toEqual(["claude-opus-5-5 command " + run[0] + " has 2 graded rows, not 1"]);
  });
  test("an infra attempt 1 beside a graded attempt 2 for one cell is accepted", () => {
    expect(checkRows([...clean(), row("command", run[0]!, false, "infra"), row("described", run[1]!, false, "cap_stop")], run)).toEqual([]);
  });
});

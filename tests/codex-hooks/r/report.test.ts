// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's readings: Wilson and Newcombe's paired interval, power.py's MDD ported, section 1's routing rows driven each way,
// the counted reading on built tables and the pilot readout.
import { describe, expect, test } from "bun:test";
import { decide, mdd, newcombe10, pilot, reading, readHand, renderPilot, renderReading, wilson, type Contrast, type DecisionIn } from "../../../lanes/codex-hooks/r/report.ts";
import type { RouteRow } from "../../../lanes/codex-hooks/r/routes.ts";
import type { RRow } from "../../../lanes/codex-hooks/r/table.ts";
import { PILOT_TASKS, type RArm } from "../../../lanes/codex-hooks/r/pins.ts";

type O = { loaded?: boolean; pass?: boolean; outcome?: RRow["outcome"]; delivered?: boolean; position?: string; verify?: boolean; rules?: ("a" | "b" | "c")[]; why?: string; allowance?: "reservation" | "spend"; cost?: number; trial?: string };
const load = (loaded: boolean, rules: string[] = loaded ? ["a"] : []) => ({ loaded, rules, at_first_call: loaded, where: [], failed: 0, b_excluded: 0 });
const row = (arm: RArm, task: string, o: O = {}): RRow => ({
  schema: "codex-r-session/1", part: "p", arm, task, trial: o.trial ?? arm + "." + task, outcome: o.outcome ?? "graded", reason: "", pass: !!o.pass, reward: o.pass ? 1 : 0,
  limit_stop: o.allowance ? "allowance" : null, allowance: o.allowance ?? null, cost_usd: o.cost ?? 1, tokens: null, wall_s: null, questions: 0, resumes: 0, safety_stop: false,
  root: null, sub_agents: { count: 0, other_models: [] }, init: null, destructive: { denies: 0, codex_rejects: 0 }, read_audit: arm === "r-none" ? { calls: 0, skill_text: false } : null,
  loads: { prove_it: load(!!o.loaded, o.rules), verify: load(!!o.verify), steps_arrived: false, named_in_text: false, line_delivered: o.delivered ?? arm === "r-on",
    hook: { position: (o.position ?? (arm === "r-on" ? "alone" : "log missing")) as any, event: null, named: [], lines: 1 }, why_no_load: arm === "r-on" && !o.loaded ? ((o.why ?? "never named") as any) : null },
} as RRow);
const TASKS = Array.from({ length: 60 }, (_, i) => "t" + String(i).padStart(2, "0"));
const table = (covered: number, tasks = TASKS): RouteRow[] => tasks.map((task, i) => ({ kind: "run", task, prompt_sha256: "", matches_b1b: "true", chars: 1, named: i < covered ? "prove-it" : "-", position: i < covered ? "alone" : "not named", trigger: "", line_sha256: "" }));
/** Every arm on every task; on(i) and off(i) give r-on's and r-off's fields on task i. */
const build = (on: (i: number) => O, off: (i: number) => O, none: (i: number) => O = () => ({})) => TASKS.flatMap((t, i) => [row("r-on", t, on(i)), row("r-off", t, off(i)), row("r-none", t, none(i))]);

describe("intervals and the MDD", () => {
  test("Wilson", () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 4);
    expect(hi).toBeCloseTo(0.7634, 4);
    expect(wilson(0, 10)[1]).toBeCloseTo(0.2775, 4);
  });
  test("Newcombe's method 10", () => {
    const s = newcombe10({ a: 10, b: 5, c: 5, d: 20 })!;
    expect(s.diff).toBe(0);
    expect(s.lo).toBeCloseTo(-s.hi, 10);
    const all = newcombe10({ a: 0, b: 30, c: 0, d: 0 })!;
    expect([all.diff, all.hi]).toEqual([1, 1]);
    expect(all.lo).toBeCloseTo(1 - Math.hypot(1 - wilson(30, 30)[0], wilson(0, 30)[1]), 10);
    const up = newcombe10({ a: 10, b: 15, c: 2, d: 13 })!;
    expect(up.diff).toBeCloseTo(13 / 40, 10);
    expect(up.lo).toBeGreaterThan(0);
    expect(up.hi).toBeLessThan(0.55);
    expect(newcombe10({ a: 0, b: 0, c: 0, d: 0 })).toBeNull();
  });
  test("power.py's MDDs (section 10's table)", () => {
    expect([[40, 0.3], [40, 0.5], [40, 0.7], [30, 0.3], [30, 0.5], [30, 0.7], [60, 0.3], [60, 0.5], [60, 0.7]].map(([n, q]) => mdd(n!, q!))).toEqual([24.5, 32, 38.5, 27.5, 36.5, 43.5, 20.5, 26.5, 31]);
    expect(mdd(40, 0)).toBeNull();
  });
});

describe("section 1's routing rows", () => {
  const c = (lo: number, hi: number): Contrast => ({ a: 0, b: 0, c: 0, d: 0, n: 40, diff: (lo + hi) / 2, lo, hi });
  const base: DecisionIn = { held: false, incomplete: [], primary: c(-0.1, 0.1), passes: c(-0.1, 0.1), offShare: 0.5, deliveredShare: 1, mdd: 32 };
  const v = (x: Partial<DecisionIn>) => decide({ ...base, ...x });
  test("held and INCOMPLETE come first", () => {
    expect(v({ held: true, primary: c(0.2, 0.4) }).verdict).toBe("HOLD");
    expect(v({ incomplete: ["r-on has 7 of 60 sessions not graded"], primary: c(0.2, 0.4) }).verdict).toBe("INCOMPLETE");
    expect(v({ primary: null }).verdict).toBe("INCOMPLETE");
  });
  test("above 0 keeps; a passes contrast wholly below 0 goes to the Captain, one touching 0 doesn't", () => {
    expect(v({ primary: c(0.01, 0.4) })).toMatchObject({ verdict: "KEEP", captain: null });
    expect(v({ primary: c(0.01, 0.4), passes: c(-0.3, -0.01) }).captain).toContain("loads up, fixes down");
    expect(v({ primary: c(0.01, 0.4), passes: c(-0.3, 0) }).captain).toBeNull();
    expect(v({ primary: c(0, 0.4) }).verdict).not.toBe("KEEP");
  });
  test("below 0", () => {
    expect(v({ primary: c(-0.4, -0.01) }).verdict).toBe("FIX-METHOD");
    expect(v({ primary: c(-0.4, -0.01) }).row).toContain("below 0");
  });
  test("includes 0: the ceiling at 80% of r-off loading", () => {
    expect(v({ offShare: 0.8 }).row).toContain("ceiling");
    expect(v({ offShare: 0.79 }).row).not.toContain("ceiling");
  });
  test("includes 0 under the ceiling: delivery under 90% or an interval wider than the MDD is FIX-METHOD, else CUT-CANDIDATE", () => {
    expect(v({})).toMatchObject({ verdict: "CUT-CANDIDATE", widerThanMdd: false });
    expect(v({ deliveredShare: 0.89 })).toMatchObject({ verdict: "FIX-METHOD" });
    expect(v({ deliveredShare: 0.9 }).verdict).toBe("CUT-CANDIDATE");
    expect(v({ mdd: 19.9 })).toMatchObject({ verdict: "FIX-METHOD", widerThanMdd: true });
    expect(v({ mdd: 20 }).verdict).toBe("CUT-CANDIDATE");
    expect(v({ mdd: null }).verdict).toBe("FIX-METHOD");
  });
});

describe("the counted reading", () => {
  test("loads up on covered tasks: KEEP, with the split, reasons and rule (b) line", () => {
    const rows = build((i) => ({ loaded: i < 30, rules: i < 5 ? ["b"] : undefined, why: i < 40 ? "line not delivered" : "never named" }), (i) => ({ loaded: i < 8 }));
    const x = reading(rows, "r-main", table(40));
    expect(x.covered).toBe(40);
    expect(x.primary).toMatchObject({ n: 40, a: 8, b: 22, c: 0, d: 10 });
    expect(x.decision.verdict).toBe("KEEP");
    expect(x.withoutRuleB).toMatchObject({ a: 3, b: 22, c: 5 });
    expect(x.reasons["line not delivered"]).toBe(10);
    expect(x.split["r-on"].find((s) => s.position === "alone")).toMatchObject({ sessions: 60, prove_it: 30, neither: 30 });
    expect(x.split["r-off"].find((s) => s.position === "alone")).toMatchObject({ sessions: 40, prove_it: 8 });
    expect(x.split["r-off"].find((s) => s.position === "not named")!.sessions).toBe(20);
    expect(x.perArm.find((a) => a.arm === "r-on")).toMatchObject({ graded: 60, loads: 30, firstCall: 30 });
    expect(renderReading(x)).toContain("**KEEP**");
  });
  test("loads up, fixes down reaches the Captain", () => {
    const x = reading(build((i) => ({ loaded: i < 30, pass: false }), (i) => ({ loaded: i < 8, pass: true })), "r-main", table(40));
    expect(x.decision.captain).toContain("loads up, fixes down");
  });
  test("more than 6 of 60 not graded reads INCOMPLETE; 6 doesn't", () => {
    const at = (k: number) => reading(build((i) => ({ loaded: i < 30, outcome: i >= 60 - k ? "infra" : "graded" }), (i) => ({ loaded: i < 8 })), "r-main", table(40));
    expect(at(7).decision.verdict).toBe("INCOMPLETE");
    expect(at(7).outcomes.find((o) => o.arm === "r-on")).toMatchObject({ not_graded: 7, incomplete: true });
    expect(at(6).decision.verdict).toBe("KEEP");
  });
  test("a graded rerun fills its cell, and an INCOMPLETE r-none drops only its own contrasts", () => {
    const rows = build((i) => ({ loaded: i < 30 }), (i) => ({ loaded: i < 8 }), (i) => ({ outcome: i < 7 ? "infra" : "graded" }));
    rows.push(row("r-on", "t50", { outcome: "infra", trial: "late" }));
    const x = reading(rows, "r-main", table(40));
    expect(x.decision.verdict).toBe("KEEP");
    expect(x.passes.filter((p) => !p.read).map((p) => p.contrast)).toEqual(["r-on minus r-none", "r-off minus r-none"]);
    expect(x.outcomes.find((o) => o.arm === "r-on")).toMatchObject({ graded: 60, infra: 1 });
  });
  test("a cap stop ends the part INCOMPLETE", () => {
    const rows = build((i) => ({ loaded: i < 30 }), (i) => ({ loaded: i < 8 }));
    rows.push(row("r-off", "t01", { outcome: "cap_stop", trial: "cap" }));
    expect(reading(rows, "r-main", table(40)).decision.captain).toContain("cap stop");
  });
  test("the gate holds below 30 covered prompts", () => {
    expect(reading(build(() => ({}), () => ({})), "r-main", table(29)).decision.verdict).toBe("HOLD");
  });
  test("a ceiling and a null", () => {
    expect(reading(build((i) => ({ loaded: i < 36 }), (i) => ({ loaded: i < 34 })), "r-main", table(40)).decision.row).toContain("ceiling");
    const x = reading(build((i) => ({ loaded: i < 12 || (i >= 20 && i < 24) }), (i) => ({ loaded: i < 10 || (i >= 24 && i < 30) })), "r-main", table(40));
    expect(x.decision.verdict).toBe("FIX-METHOD");
    expect(x.decision.widerThanMdd).toBe(true);
  });
});

describe("the pilot readout", () => {
  const ptable = table(3, [...PILOT_TASKS]);
  const P = [...PILOT_TASKS];
  const rows = P.flatMap((t, i) => [
    row("r-on", t, { loaded: i % 2 === 0, cost: 1 + i, allowance: i === 5 ? "reservation" : undefined }),
    row("r-off", t, { loaded: true, cost: 2, allowance: i === 4 ? "spend" : undefined }),
    row("r-none", t, { outcome: i === 0 ? "infra" : "graded", cost: 0.5 }),
  ]);
  const hand = readHand("trial\tprove_it\tverify\nr-on." + P[0] + "\tyes\tno\nr-on." + P[1] + "\tno\tno\nr-off." + P[0] + "\tyes\tno\nr-off." + P[1] + "\tno\tno\n");
  test("supply, costs, allowance stops by kind, hand reading and the ceiling flag", () => {
    const p = pilot(rows, hand, ptable);
    const on = p.arms.find((a) => a.arm === "r-on")!, off = p.arms.find((a) => a.arm === "r-off")!, none = p.arms.find((a) => a.arm === "r-none")!;
    expect(on).toMatchObject({ supplied: 6, reservation: 1, spend: 0, hand: { read: 2, agree: 2 }, passes: true });
    expect(on.costs).toMatchObject({ n: 6, mean: 3.5, median: 3.5, p95: 6 });
    expect(off).toMatchObject({ reservation: 0, spend: 1, hand: { read: 2, agree: 1 }, passes: false });
    expect(none).toMatchObject({ supplied: 5, gaps: [P[0]], passes: false });
    expect(p.exposure).toEqual({ covered: 3, delivered: 3, logged: 3 });
    expect(p.ceiling).toBe(true);
    const md = renderPilot(p);
    expect(md).toContain("Ceiling case");
    expect(md).toContain("reservation");
    expect(md).not.toMatch(/Wilson|prove-it loads|load rate:/);
  });
  test("one covered r-off session without a load clears the flag; a missing line fails r-on's exposure", () => {
    const r2 = rows.map((r) => (r.arm === "r-off" && r.task === P[1] ? row("r-off", P[1], { loaded: false }) : r.arm === "r-on" && r.task === P[2] ? row("r-on", P[2], { delivered: false }) : r));
    const p = pilot(r2, hand, ptable);
    expect(p.ceiling).toBe(false);
    expect(p.exposure.delivered).toBe(2);
    expect(p.arms.find((a) => a.arm === "r-on")!.passes).toBe(false);
  });
  test("a hand reading needs yes or no", () => {
    expect(() => readHand("x\tmaybe\tno")).toThrow(/E_USAGE/);
  });
});

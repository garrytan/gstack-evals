// Copyright (c) 2026 Garry Tan. MIT License.
// Every row of section 1's contract table and E3 table for part C, each read in both directions, on runs scored from
// state records through the real scoring and analysis. Pre-run change 1, section 8's fixture (4 gains in 4 clusters, no
// losses, at least 7 blocked c-on sessions, at most 5% false blocks) must read FIX-METHOD (power).
import { describe, expect, test } from "bun:test";
import type { Unit } from "../../../../lanes/review-noloss/suite.ts";
import { analyze, type Analysis } from "../../../../lanes/codex-hooks/c/analysis/analysis.ts";
import { contractReading, e3Reading } from "../../../../lanes/codex-hooks/c/analysis/decide.ts";
import type { CArm } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { scoreSessions } from "../../../../lanes/codex-hooks/c/analysis/score.ts";
import { at, bugsOf, fullRun, judgeLocally, maps, statesOf, suite, type Spec } from "./helpers.ts";

type Extra = Omit<Spec, "arm" | "unit" | "pass">;
const ids = suite.units.map((u) => u.id);
/** Units where no two blockers share a file and line, so a finding at B1 matches B1 alone. */
const plain = (u: Unit) => new Set(u.blockers.map((b) => b.file + ":" + b.line)).size === u.blockers.length;
/** Units with blocking bugs, one per pull-request cluster, in suite order, each plain. */
const distinct = suite.units.filter((u, i, all) => bugsOf(u).length && plain(u) && all.findIndex((x) => bugsOf(x).length && plain(x) && x.cluster === u.cluster) === i);
const informational = suite.units.filter((u) => !bugsOf(u).length);
const hit = (u: Unit) => [at(u, "B1")];
const G = distinct.slice(0, 4);
const S = distinct.slice(4, 7);
const run = (f: (arm: CArm, u: Unit, pass: number) => Extra): Analysis => {
  const states = statesOf(fullRun(f), suite.units, 2);
  return analyze(suite, states, scoreSessions(states, judgeLocally(states), maps), { units: ids, passes: 2 });
};
const has = (us: Unit[], u: Unit) => us.some((x) => x.id === u.id);

/** Section 8's fixture: 4 gains in 4 clusters within c-on, 3 more blocked sessions that change nothing, c-off as c-on's first stop. */
function section8(o: { falseBlocks?: number; blocked?: number; more?: (arm: CArm, u: Unit, pass: number) => Extra | null } = {}) {
  const still = S.slice(0, (o.blocked ?? 7) - G.length);
  const falseBlocks = [...G, ...still].slice(0, o.falseBlocks ?? 3);
  return run((arm, u, pass) => {
    const more = o.more?.(arm, u, pass);
    if (more) return more;
    if (pass !== 1) return {};
    const fb = { exposure: { false_block: has(falseBlocks, u) } };
    if (arm === "c-on" && has(G, u)) return { first: [], final: hit(u), ...fb };
    if (arm === "c-on" && has(still, u)) return { first: hit(u), final: hit(u), ...fb };
    if (arm === "c-off" && has(still, u)) return { final: hit(u) };
    return {};
  });
}

describe("the contract table", () => {
  const s8 = section8();
  test("section 8's fixture reads FIX-METHOD (power): the interval excludes 0, but 4 clusters can give no p under 0.125", () => {
    expect(s8.arms["c-on"]).toMatchObject({ scored: 66, blocked: 7, false_block_sessions: 3 });
    expect(s8.primary.stats).toMatchObject({ gains: 4, losses: 0, p: 0.125, informative_clusters: 4, pairs: 84 });
    expect(s8.primary.stats!.ci95![0]).toBeGreaterThan(0);
    expect(s8.check_a_fails).toBe(false);
    expect(contractReading(s8, "A")).toMatchObject({ row: "not-shown", verdict: "FIX-METHOD (power)", on_by_default: false, reads: "primary" });
    expect(contractReading(s8, "B").verdict).toBe("FIX-METHOD (power)");
  });

  test("no judge route: no reading; with a route, a reading", () => {
    expect(contractReading(s8, null)).toMatchObject({ row: "no-judge-route", verdict: null, on_by_default: null, reads: null });
    expect(contractReading(s8, "A").row).not.toBe("no-judge-route");
  });

  test("INCOMPLETE on a cap stop anywhere, or more than 7 of 66 c-on or c-off sessions not scored; 7 is not more than 7", () => {
    const cap = section8({ more: (arm, u, pass) => (arm === "c-none" && u.id === informational[0]!.id && pass === 2 ? { outcome: "cap_stop", code: "E_CAP_STOP" } : null) });
    expect(cap.cap_stop).toBe(true);
    expect(contractReading(cap, "A")).toMatchObject({ row: "incomplete", on_by_default: true, verdict: null });
    const gaps = (arm: CArm, n: number) => section8({ falseBlocks: 0, more: (a, u, pass) => (a === arm && informational.flatMap((x) => [[x, 1], [x, 2]] as const).slice(0, n).some(([x, p]) => x.id === u.id && p === pass) ? { outcome: "gap", code: "UPSTREAM" } : null) });
    expect(contractReading(gaps("c-on", 8), "A").row).toBe("incomplete");
    expect(contractReading(gaps("c-off", 8), "A").row).toBe("incomplete");
    const seven = gaps("c-on", 7);
    expect(seven.arms["c-on"].not_scored_total).toBe(7);
    expect(contractReading(seven, "A").row).toBe("not-shown");
    expect(contractReading(gaps("c-high", 8), "A").row).toBe("not-shown");
  });

  test("false blocks in more than 5% of c-on sessions read FIX-METHOD (transcript reader) whatever the primary shows; 3 of 66 do not", () => {
    expect(contractReading(section8({ falseBlocks: 4 }), "A")).toMatchObject({ row: "false-blocks", verdict: "FIX-METHOD (transcript reader)", on_by_default: false });
    const keep = run((arm, u) => (arm === "c-on" && has(distinct, u) ? { first: [], final: hit(u), exposure: { false_block: has(distinct.slice(0, 4), u) } } : {}));
    expect(keep.primary.reading).toBe("above");
    expect(keep.arms["c-on"].false_block_sessions).toBe(8);
    expect(contractReading(keep, "A").row).toBe("false-blocks");
    expect(contractReading(s8, "A").row).not.toBe("false-blocks");
  });

  test("fewer than 7 blocked c-on sessions read FIX-METHOD (ceiling); 7 do not", () => {
    const six = section8({ blocked: 6 });
    expect(six.arms["c-on"].blocked).toBe(6);
    expect(contractReading(six, "A")).toMatchObject({ row: "ceiling", verdict: "FIX-METHOD (ceiling)", on_by_default: false });
    expect(contractReading(s8, "A").row).not.toBe("ceiling");
  });

  test("an interval above 0 with p under 0.05 reads KEEP and keeps the contract on", () => {
    const keep = run((arm, u) => (arm === "c-on" && has(distinct, u) ? { first: [], final: hit(u) } : {}));
    expect(keep.primary.reading).toBe("above");
    expect(contractReading(keep, "A")).toMatchObject({ row: "above", verdict: "KEEP", on_by_default: true, reads: "primary" });
  });

  test("an interval below 0 with p under 0.05 reads CUT-CANDIDATE", () => {
    const cut = run((arm, u) => (has(distinct, u) ? (arm === "c-on" ? { first: hit(u), final: [] } : arm === "c-off" ? { final: hit(u) } : {}) : {}));
    expect(cut.check_a_fails).toBe(false);
    expect(cut.primary.reading).toBe("below");
    expect(contractReading(cut, "A")).toMatchObject({ row: "below", verdict: "CUT-CANDIDATE", on_by_default: false });
  });

  test("an interval that includes 0 reads CUT-CANDIDATE under the 11.5-point bar and FIX-METHOD (power) at or above it", () => {
    const flat = section8({ more: (arm, u, pass) => (arm === "c-on" && has(G, u) && pass === 1 ? { first: hit(u), final: hit(u) } : arm === "c-off" && has(G, u) && pass === 1 ? { final: hit(u) } : null) });
    expect(flat.primary.stats!.ci95).toEqual([0, 0]);
    expect(contractReading(flat, "A")).toMatchObject({ row: "includes", verdict: "CUT-CANDIDATE" });
    const up = distinct.slice(0, 12);
    const down = distinct.slice(12, 20);
    const wide = run((arm, u, pass) => {
      if (pass !== 1) return {};
      if (arm === "c-on" && has(up, u)) return { first: [], final: hit(u) };
      if (arm === "c-on" && has(down, u)) return { first: hit(u), final: [] };
      if (arm === "c-off" && has(down, u)) return { final: hit(u) };
      return {};
    });
    expect(wide.primary.reading).toBe("includes");
    expect(100 * wide.primary.stats!.ci95![1]).toBeGreaterThanOrEqual(11.5);
    expect(contractReading(wide, "A")).toMatchObject({ row: "includes", verdict: "FIX-METHOD (power)" });
  });

  describe("check A", () => {
    const swapped = run((arm, u, pass) => {
      if (pass !== 1) return {};
      if (arm === "c-on" && (has(G, u) || has(S, u))) return { first: hit(u), final: hit(u) };
      if (arm === "c-off" && has(S, u)) return { final: hit(u) };
      return {};
    });
    test("fails on its interval alone (4 gains in 4 clusters, p = 0.125), and c-on minus c-off reads in the primary's place", () => {
      expect(swapped.check_a.stats).toMatchObject({ gains: 4, losses: 0, p: 0.125 });
      expect(swapped.check_a.stats!.ci95![0]).toBeGreaterThan(0);
      expect(swapped.check_a_fails).toBe(true);
      expect(swapped.primary.reading).toBe("includes");
      const r = contractReading(swapped, "A");
      expect(r).toMatchObject({ row: "not-shown", verdict: "FIX-METHOD (power)", reads: "c-on minus c-off" });
      expect(r.text).toMatch(/^Check A failed/);
    });
    test("holds when c-on's first stop matches c-off, and the primary reads", () => {
      expect(s8.check_a_fails).toBe(false);
      expect(contractReading(s8, "A").reads).toBe("primary");
    });
    test("after the swap, the 11.5-point bar still decides between CUT-CANDIDATE and FIX-METHOD (power)", () => {
      const at = (upper: number): Analysis => ({ ...swapped, between: swapped.between.map((c) => (c.name === "c-on minus c-off, found" ? { ...c, reading: "includes" as const, stats: { ...c.stats!, ci95: [-0.05, upper] as [number, number], p: 0.4 } } : c)) });
      expect(contractReading(at(0.114), "A")).toMatchObject({ row: "includes", verdict: "CUT-CANDIDATE", reads: "c-on minus c-off" });
      expect(contractReading(at(0.115), "A")).toMatchObject({ row: "includes", verdict: "FIX-METHOD (power)", reads: "c-on minus c-off" });
    });
  });
});

describe("the E3 table", () => {
  const e3 = (f: (u: Unit, pass: number) => { on?: Extra; high?: Extra }, usd: Partial<Record<CArm, number | null>> = {}) =>
    run((arm, u, pass) => {
      const x = f(u, pass);
      const base = { usd: usd[arm] === undefined ? 1 : usd[arm] };
      return arm === "c-on" ? { ...base, ...x.on } : arm === "c-high" ? { ...base, ...x.high } : base;
    });

  test("c-high above c-on ships E3 and prices each added known bug", () => {
    const a = e3((u) => (has(distinct, u) ? { high: { final: hit(u) } } : {}), { "c-high": 3 });
    expect(a.e3.reading).toBe("above");
    const added = a.arms["c-high"].per_state.final.found - a.arms["c-on"].per_state.final.found;
    expect(added).toBe(2 * distinct.length);
    expect(a.e3_cost_per_added_bug_usd).toBeCloseTo((66 * 3 - 66 * 1) / added, 12);
    const r = e3Reading(a, "A");
    expect(r).toMatchObject({ row: "above", ships: "E3" });
    expect(r.cost_per_added_bug_usd).toBe(a.e3_cost_per_added_bug_usd);
  });

  test("an unmetered session leaves the cost per added bug unpriced", () => {
    const a = e3((u, pass) => (has(distinct, u) ? { high: { final: hit(u), ...(u.id === distinct[0]!.id && pass === 1 ? { usd: null } : {}) } } : {}), { "c-high": 3 });
    expect(a.e3.reading).toBe("above");
    expect(a.e3_cost_per_added_bug_usd).toBeNull();
  });

  test("c-high below c-on rewrites or drops E2's line", () => {
    const a = e3((u) => (has(distinct, u) ? { on: { final: hit(u) } } : {}));
    expect(e3Reading(a, "A")).toMatchObject({ row: "below", ships: "E2, rewritten or dropped" });
  });

  test("an interval that includes 0 keeps E2, and so does one that excludes 0 with p of 0.05 or more", () => {
    expect(e3Reading(e3(() => ({})), "A")).toMatchObject({ row: "includes", ships: "E2" });
    const four = e3((u) => (has(G, u) ? { high: { final: hit(u) } } : {}));
    expect(four.e3.reading).toBe("not_shown");
    const r = e3Reading(four, "A");
    expect(r).toMatchObject({ row: "includes", ships: "E2" });
    expect(r.text).toMatch(/reads as including 0/);
  });

  test("INCOMPLETE when c-high or c-on has more than 7 sessions not scored, or a cap stop ended part C; c-off does not count", () => {
    const gaps = (arm: CArm) => run((a, u, pass) => (a === arm && informational.flatMap((x) => [[x, 1], [x, 2]] as const).slice(0, 8).some(([x, p]) => x.id === u.id && p === pass) ? { outcome: "gap", code: "UPSTREAM" } : {}));
    expect(e3Reading(gaps("c-high"), "A")).toMatchObject({ row: "incomplete", ships: "E2" });
    expect(e3Reading(gaps("c-on"), "A").row).toBe("incomplete");
    expect(e3Reading(gaps("c-off"), "A").row).toBe("includes");
    const cap = run((a, u, pass) => (a === "c-none" && u.id === informational[0]!.id && pass === 1 ? { outcome: "cap_stop", code: "E_CAP_STOP" } : {}));
    expect(e3Reading(cap, "A").row).toBe("incomplete");
  });

  test("no judge route: no reading, and E2 stands meanwhile", () => {
    expect(e3Reading(e3(() => ({})), null)).toMatchObject({ row: "no-judge-route", ships: null });
  });
});

import { describe, expect, test } from "bun:test";
import type { Arm, Pool } from "../../../lanes/review-models/score/frozen.ts";
import type { Ruling, ReviewFinding } from "../../../lanes/review-models/score/judge.ts";
import { armSummaries, readCostRows, reviewCatch, unitTable, type Review } from "../../../lanes/review-models/score/score.ts";
import { COST_COLUMNS } from "../../../src/trial/review/cost.ts";

const finding = (id: string, source: "native" | "voice", severity: string): ReviewFinding => ({ id, source, severity, path: "a.ts", line: 1, text: "claim" });
function review(unit: string, arm: Arm, o: { pool?: Pool; findings?: Array<[ReviewFinding, Ruling]>; outcome?: Review["outcome"]; contaminated?: boolean; exposed?: boolean; usd?: number | null; wall?: number | null } = {}): Review {
  const findings = (o.findings ?? []).map(([f]) => f);
  const pool = o.pool ?? "P";
  return {
    unit, arm, pool, cluster: "pr-" + unit, outcome: o.outcome ?? "ok", contaminated: o.contaminated ?? false, ...(o.exposed === undefined ? {} : { exposed: o.exposed }), findings,
    judged: pool === "decoy" || !findings.length ? null : { rulings: Object.fromEntries((o.findings ?? []).map(([f, r]) => [f.id, r])), reasons: {}, attempts: 1, failures: [], failed: false },
    usd: o.usd === undefined ? 5 : o.usd, wall_seconds: o.wall === undefined ? 100 : o.wall,
  };
}

describe("a review's catches", () => {
  test("any severity; can't tell is a miss, or a hit in the second reading; blocking, native and voice apart", () => {
    const r = review("u1", "OS", { findings: [[finding("a", "native", "LOW"), "doesnt"], [finding("b", "voice", "P1"), "names"]] });
    expect(reviewCatch(r, "strict")).toEqual({ catch: 1, blocking: 1, native: 0, voice: 1 });
    const t = review("u1", "OS", { findings: [[finding("a", "native", "LOW"), "cant_tell"]] });
    expect(reviewCatch(t, "strict").catch).toBe(0);
    expect(reviewCatch(t, "lenient")).toEqual({ catch: 1, blocking: 0, native: 1, voice: 0 });
    expect(reviewCatch(review("u1", "OS", { findings: [[finding("a", "native", "HIGH"), "names"]], contaminated: true }), "strict").catch).toBe(0);
  });
});

describe("the unit table", () => {
  const reviews = [
    review("u1", "OS", { findings: [[finding("a", "native", "HIGH"), "names"]], usd: 6 }),
    review("u1", "OA", { outcome: "gap", usd: null }),
    review("u2", "OS", { findings: [[finding("a", "native", "HIGH"), "names"]], contaminated: true, usd: 7 }),
    review("u2", "OA", { outcome: "safety_stop", usd: 3 }),
    review("d1", "OS", { pool: "decoy", findings: [[finding("a", "native", "CRITICAL"), "doesnt"]] }),
  ];
  test("gaps and contaminated reviews drop in one reading and miss in the other; safety stops miss in both; decoys stay out", () => {
    const dropped = unitTable(reviews, { catchReading: "strict", gapReading: "dropped" });
    expect(dropped.map((r) => r.unit)).toEqual(["u1", "u2"]);
    expect(dropped[0]!.cells).toEqual({ OS: { catch: 1, blocking: 1, native: 1, voice: 0, usd: 6, wall: 100 }, OA: null });
    expect(dropped[1]!.cells).toEqual({ OS: null, OA: { catch: 0, blocking: 0, native: 0, voice: 0, usd: 3, wall: 100 } });
    const miss = unitTable(reviews, { catchReading: "strict", gapReading: "miss" });
    expect(miss[0]!.cells.OA).toEqual({ catch: 0, blocking: 0, native: 0, voice: 0, usd: 0, wall: 100 });
    expect(miss[1]!.cells.OS).toEqual({ catch: 0, blocking: 0, native: 0, voice: 0, usd: 7, wall: 100 });
  });
  test("refuses a unit reviewed twice, a scored review with no cost, and findings with no judge result", () => {
    expect(() => unitTable([...reviews, review("u1", "OS")], { catchReading: "strict", gapReading: "miss" })).toThrow(/^E_RM_SCORE_INPUT u1 OS: reviewed twice/);
    expect(() => unitTable([review("u3", "OS", { usd: null })], { catchReading: "strict", gapReading: "miss" })).toThrow(/no metered cost/);
    expect(() => unitTable([{ ...review("u3", "OS", { findings: [[finding("a", "native", "LOW"), "names"]] }), judged: null }], { catchReading: "strict", gapReading: "miss" })).toThrow(/no judge result/);
  });
});

describe("arm summaries", () => {
  test("rates, false alarms per decoy, the voice's blocking share, judge failures and the untested flags", () => {
    const os: Review[] = [];
    for (let i = 0; i < 10; i++) os.push(review("u" + i, "OS", { exposed: i !== 0, contaminated: i === 1, usd: 4, findings: [[finding("n" + i, "native", "MEDIUM"), i < 4 ? "names" : "doesnt"], [finding("v" + i, "voice", "CRITICAL"), i === 3 || i === 5 ? "names" : i === 6 ? "cant_tell" : "doesnt"]] }));
    os.push(review("d1", "OS", { pool: "decoy", usd: 4, findings: [[finding("x", "native", "HIGH"), "doesnt"], [finding("y", "voice", "LOW"), "doesnt"]] }));
    os.push(review("d2", "OS", { pool: "decoy", usd: 4 }));
    os[9] = { ...os[9]!, judged: { ...os[9]!.judged!, attempts: 2, failed: true } };
    const [s] = armSummaries(os);
    expect(s).toMatchObject({ arm: "OS", bug_reviews: 10, decoy_reviews: 2, contaminated: 1, native_catches: 3, voice_catches: 2, native_only: 2, voice_only: 1, cant_tell_findings: 1, judge_failed_reviews: 1, judge_retried_reviews: 1, false_alarms_per_decoy: 0.5, usd_per_review: 4, unknown_cost_reviews: 0 });
    expect(s!.catch_rate.strict).toEqual({ dropped: 4 / 9, miss: 0.4 });
    expect(s!.catch_rate.lenient.miss).toBe(0.5);
    expect(s!.blocking_catch_rate).toBe(0.2);
    expect(s!.usd_per_catch).toBe(10);
    expect(s!.voice_blocking_share).toBe(10 / 11);
    expect(s!.unmatched_blocking_per_bug_review).toBe(7 / 9);
    expect(s!.contaminated_share).toBe(1 / 12);
    expect(s!.exposed_share).toBe(9 / 10);
    expect(s!.untested).toEqual([]);
    const worse = armSummaries(os.map((r, i) => (i === 2 ? { ...r, contaminated: true, exposed: false } : r)))[0]!;
    expect(worse.untested).toEqual(["contaminated 16.7% of reviews, over 10%", "exposed in 80.0% of reviews, under 90%"]);
  });
});

describe("cost rows", () => {
  test("each unit's all row for the pass, with unavailable as unknown", () => {
    const row = (pr: string, scope: string, usd: string, wall: string) => [pr, scope, "1", "100", "1", "1", "1", "1", "1", usd, wall, "proxy-journal", "3", "0", "0"].join("\t");
    const tsv = [COST_COLUMNS.join("\t"), row("u1", "all", "6.500000", "321.4"), row("u1", "voice", "1.500000", ""), row("u2", "all", "unavailable", "12"), ""].join("\n");
    expect([...readCostRows(tsv)]).toEqual([["u1", { usd: 6.5, wall_seconds: 321.4 }], ["u2", { usd: null, wall_seconds: 12 }]]);
    expect(() => readCostRows(tsv + row("u1", "all", "1", "1") + "\n")).toThrow(/^E_RM_SCORE_INPUT cost row 5 repeats unit u1/);
    expect(() => readCostRows("pr\tusd\nu1\t1\n")).toThrow(/^E_RM_SCORE_INPUT/);
  });
});

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Arm, Pool } from "../../../lanes/review-models/score/frozen.ts";
import type { Review } from "../../../lanes/review-models/score/score.ts";
import { costGap, cpLower, pilotCatches, proceedSet, readHistory, stagedRule } from "../../../lanes/review-models/score/staged.ts";

const review = (unit: string, arm: Arm, caught: boolean, usd: number | null, pool: Pool = "P"): Review => ({
  unit, arm, pool, cluster: unit, outcome: "ok", contaminated: false, usd, wall_seconds: 60,
  findings: [{ id: "f", source: "native", severity: "HIGH", path: "a.ts", line: 1, text: "x" }],
  judged: pool === "decoy" ? null : { rulings: { f: caught ? "names" : "doesnt" }, reasons: {}, attempts: 1, failures: [], failed: false },
});

describe("headroom, per bug and one-sided (change 1 item 3)", () => {
  test("reproduces headroom.txt on Harness Evals' history alone: 42 of 54, bound 0.6650, break-even $8.38", () => {
    const s = stagedRule({ gap_lower: 7.5, p_share: 1, b_share: 0, history: { units: 54, caught: 42 }, pilot_p: null, pilot_b: null });
    expect(s.p_bound.toFixed(4)).toBe("0.6650");
    expect(s.headroom.toFixed(4)).toBe("0.3350");
    expect(s.break_even_gap.toFixed(2)).toBe("8.38");
    expect((1 + s.break_even_gap / 6.5).toFixed(2)).toBe("2.29");
    expect((1 + s.break_even_gap / 11).toFixed(2)).toBe("1.76");
    expect(s.drop_fable).toBe(false);
    expect(stagedRule({ gap_lower: 8.4, p_share: 1, b_share: 0, history: { units: 54, caught: 42 }, pilot_p: null, pilot_b: null }).drop_fable).toBe(true);
  });
  test("the lower of the pooled and pilot-alone bounds, and B from its pilot alone", () => {
    const pilot = { units: 5, caught: 5 };
    const s = stagedRule({ gap_lower: 8, p_share: 0.6, b_share: 0.4, history: { units: 54, caught: 42 }, pilot_p: pilot, pilot_b: { units: 5, caught: 1 } });
    expect(s.p_bound_pooled).toBeCloseTo(cpLower({ units: 59, caught: 47 }), 12);
    expect(s.p_bound_pilot).toBeCloseTo(cpLower(pilot), 12);
    expect(s.p_bound).toBe(Math.min(s.p_bound_pooled, s.p_bound_pilot!));
    expect(s.b_bound).toBeCloseTo(cpLower({ units: 5, caught: 1 }), 12);
    expect(s.headroom).toBeCloseTo(0.6 * (1 - s.p_bound) + 0.4 * (1 - s.b_bound), 12);
    expect(cpLower({ units: 5, caught: 5 })).toBeCloseTo(0.05 ** (1 / 5), 6);
    expect(cpLower({ units: 0, caught: 0 })).toBe(0);
    expect(() => stagedRule({ gap_lower: 1, p_share: 0.5, b_share: 0.4, history: { units: 1, caught: 1 }, pilot_p: null, pilot_b: null })).toThrow(/^E_RM_SCORE_INPUT/);
  });
});

describe("the history CSV", () => {
  const dir = mkdtempSync(join(tmpdir(), "rm-history-"));
  const write = (rows: string[]) => {
    const path = join(dir, "h" + rows.length + ".csv");
    writeFileSync(path, ["unit_id,arm,stratum,named_any_severity,n_planted,note", ...rows].join("\n") + "\n");
    return path;
  };
  const rows: string[] = [];
  for (let u = 0; u < 54; u++) {
    const passes = u < 40 ? [1, 1] : u < 42 ? [1, 0] : [0, 0];
    for (const p of passes) rows.push("u" + u + ",gstack_review,outside_bug," + p + ",1," + (u === 3 ? '"a, quoted note"' : ""));
    rows.push("u" + u + ",plain,outside_bug,1,1,");
  }
  rows.push("h1,gstack_review,home_field,0,1,");
  test("counts a bug caught when the mean of its passes is at least 0.5, after its digest checks", () => {
    const path = write(rows);
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(readHistory(path, sha(path))).toEqual({ sha256: sha(path), units: 54, caught: 42 });
    expect(() => readHistory(path)).toThrow(/^E_RM_HISTORY the history CSV's sha256 is /);
    const short = write(rows.filter((r) => !r.startsWith("u53,")));
    expect(() => readHistory(short, sha(short))).toThrow(/holds 53 outside bugs/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("pilot catches and the cost gap", () => {
  test("a pilot bug is caught when the mean of its OS and OA catches is at least 0.5", () => {
    const reviews = [review("p1", "OS", true, 6), review("p1", "OA", false, 11), review("p2", "OS", false, 6), review("p2", "OA", false, 11), review("b1", "OS", true, 6, "B"), review("b1", "OA", true, 11, "B")];
    expect(pilotCatches(reviews, "P")).toEqual({ units: 2, caught: 1 });
    expect(pilotCatches(reviews, "B")).toEqual({ units: 1, caught: 1 });
    expect(() => pilotCatches(reviews.slice(1), "P")).toThrow(/pilot unit p1 has no OS review/);
  });
  test("paired by unit and voice; a constant gap has no spread, a noisy one a lower bound under its mean", () => {
    const flat: Review[] = [];
    for (let u = 0; u < 11; u++) flat.push(review("u" + u, "OS", true, 6.5), review("u" + u, "OA", true, 11), review("u" + u, "FS", true, 14), review("u" + u, "FA", true, 18.5));
    const g = costGap(flat);
    expect(g).toMatchObject({ pairs: 22, n_clusters: 11, mean: 7.5, se: 0, lower: 7.5, unpaired: [] });
    const noisy = flat.map((r, i) => (r.arm[0] === "F" ? { ...r, usd: r.usd! + ((i * 7) % 5) - 2 } : r));
    noisy[2] = { ...noisy[2]!, outcome: "gap", usd: null };
    const n = costGap(noisy);
    expect(n.pairs).toBe(21);
    expect(n.unpaired).toEqual(["u0 FS-OS"]);
    expect(n.lower!).toBeLessThan(n.mean);
    expect(n.lower!).toBeCloseTo(n.mean - 1.96 * n.se!, 12);
  });
});

describe("the frozen proceed sets (change 1 item 2)", () => {
  const all = { OS: true, OA: true, FS: true, FA: true, N: true };
  const set = (failed: Arm[], drop = false) => proceedSet({ ...all, ...Object.fromEntries(failed.map((a) => [a, false])) }, drop).set;
  test("every case", () => {
    expect(set([])).toBe("all");
    expect(set([], true)).toBe("OS_OA_N");
    expect(set(["FS"])).toBe("OS_OA_N");
    expect(set(["FA"])).toBe("OS_OA_N");
    expect(set(["FS", "FA"], true)).toBe("OS_OA_N");
    expect(set(["OA"])).toBe("OS_FS_N");
    expect(set(["OA"], true)).toBe("stop");
    expect(set(["OA", "FA"])).toBe("stop");
    expect(set(["OA", "FS"])).toBe("stop");
    expect(set(["OS"])).toBe("stop");
    expect(set(["N"])).toBe("stop");
    expect(proceedSet({ ...all, N: false }, false)).toEqual({ set: "stop", arms: [], reason: "N failed the pilot; no frozen set fits (R111)" });
    expect(proceedSet(all, true).arms).toEqual(["OS", "OA", "N"]);
  });
});

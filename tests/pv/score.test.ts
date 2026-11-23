// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fakeAnswer } from "../../lanes/product-value/dryrun.ts";
import type { PairRecord, ProbeRecord } from "../../lanes/product-value/judge.ts";
import { buildLabelPackets, type LabelRecord, type PacketMap } from "../../lanes/product-value/packets.ts";
import { cellSummaries, lengthAdjusted, pairArms, pairwiseSummary, probeTally, run, scoreReviews, stockCredits, type Review } from "../../lanes/product-value/score.ts";
import { SEED } from "../../lanes/product-value/stats.ts";
import { capture, identity, item, keyOf, meta, row, tmp, unitsMap } from "./fixtures.ts";

const key1 = keyOf("k1", ["a", "b"], [item("r1", { kind: "R" }), item("g1", { generic: true }), item("m1", { mentioned: true }), item("e1", { kind: "E" })]);
key1.primary = ["a", "b", "e1"];
const units = unitsMap([{ meta: meta("k1", { type: "mobile" }), key: key1 }, { meta: meta("k2", { type: "mobile" }), key: keyOf("k2", ["x"]) }]);
const oracle = { version: 1 as const, units: { k1: { changes: ["Plan for tag-a"], items: ["a"] }, k2: { changes: ["Plan for tag-x"], items: ["x"] } } };

function judged(family: "plan" | "brief", rows = baseRows(family)) {
  const built = buildLabelPackets({ family, stage: 1, seed: SEED, units, rows, normalize: identity, oracle });
  const labels: LabelRecord[] = [];
  for (const p of built.packets) {
    const m = built.map.packets[p.id]!;
    const text = "KEY ITEMS\n" + p.items.map((i) => "[" + i.id + "] " + i.statement + (m.items[i.id]!.kind === "C" ? " tag-c" : "")).join("\n") + "\n" + p.lists.map((l) => "List " + l.id + "\n" + l.changes.map((c, k) => k + 1 + ". " + c).join("\n")).join("\n");
    for (const l of JSON.parse(fakeAnswer(text)).labels) labels.push({ packet: p.id, judge: m.judges.length > 1 ? "panel" : m.judges[0]!, model_id: "f", version: "v", effort: "medium", list: l.list, item: l.item, label: { anticipated: l.anticipated, changes: l.changes } });
  }
  return { built, labels };
}
function baseRows(family: "plan" | "brief") {
  return [
    row({ unit: "k1", session: "s1", family, list: ["Serve tag-a and tag-b", "Also tag-a", "Ship tag-r1 behind a flag", "Do tag-g1", "Build tag-c"] }),
    row({ unit: "k1", session: "s2", family, list: null }),
    row({ unit: "k1", session: "s3", family, end: "missing", list: null }),
    row({ unit: "k2", session: "s4", family, list: ["Plan for tag-x"] }),
  ];
}

describe("scoreReviews (section 8)", () => {
  const { built, labels } = judged("plan");
  const rs = scoreReviews({ units, rows: baseRows("plan"), map: built.map, labels });
  const s1 = rs.find((r) => r.session === "s1")!;

  test("A takes the maximum one-to-one matching over every change index the judge named", () => {
    expect(s1.A).toBeCloseTo(2 / 3);
    expect(s1.status).toBe("scored");
  });

  test("secondaries: A on R, generic and mentioned items, the U and E split, precision and the share of multi-item changes", () => {
    expect(s1.A_R).toBe(1);
    expect(s1.A_generic).toBe(1);
    expect(s1.A_mentioned).toBe(0);
    expect(s1.A_U).toBe(1);
    expect(s1.A_E).toBe(0);
    expect(s1.A_plan).toBeNull();
    expect(s1.precision).toBe(4 / 5);
    expect(s1.multi).toBe(1 / 5);
    expect(s1.shuffled).toBe(0);
    expect(s1.specificity).toBeCloseTo(2 / 3);
  });

  test("no-block scores 0, missing stays missing, and A_plan reads the commitments in the brief family", () => {
    expect(rs.find((r) => r.session === "s2")).toMatchObject({ status: "no-block", A: 0 });
    expect(rs.find((r) => r.session === "s3")).toMatchObject({ status: "missing", A: null });
    const b = judged("brief");
    const brief = scoreReviews({ units, rows: baseRows("brief"), map: b.built.map, labels: b.labels }).find((r) => r.session === "s1")!;
    expect(brief.A_plan).toBe(1 / 3);
  });

  test("stock credits come from the production judge's own labels; cell summaries weigh units equally", () => {
    const sc = stockCredits({ units, rows: baseRows("plan"), map: built.map, labels });
    expect(sc.filter((c) => c.unit === "k1")).toHaveLength(3);
    expect(sc.every((c) => c.credited === false)).toBe(true);
    const cells = cellSummaries(rs);
    const opus = cells.find((c) => c.model === "opus" && c.arm === "none")!;
    expect(opus).toMatchObject({ planned: 4, scored: 3, no_block: 1, missing: 1 });
    expect(opus.A).toBeCloseTo(((2 / 3 + 0) / 2 + 1) / 2);
  });
});

describe("pairs, length and the pairwise and probe secondaries", () => {
  const rv = (unit: string, arm: "none" | "skill", pass: number, A: number | null, words: number): Review => ({ unit, family: "plan", model: "opus", arm, pass, session: unit + arm + pass, status: A === null ? "unscored" : "scored", A, shuffled: 0, specificity: A, A_R: null, A_generic: null, A_mentioned: null, A_U: null, A_E: null, A_plan: null, A_foreseeable: null, precision: null, multi: null, words, items: 5, cut: 0, exposed: null, mode: null });
  test("an unscored review drops its pair; the length-adjusted intercept removes a pure length effect", () => {
    const reviews: Review[] = [];
    for (let i = 0; i < 10; i++)
      for (const pass of [1, 2]) {
        const dw = (i % 5) * 10 + pass;
        reviews.push(rv("u" + i, "none", pass, 0.2, 50), rv("u" + i, "skill", pass, 0.2 + 0.002 * dw, 50 + dw));
      }
    reviews.push(rv("u9", "none", 3, 0.2, 50), rv("u9", "skill", 3, null, 50));
    const { pairs, dropped } = pairArms(reviews, "opus", "plan", "skill", "none");
    expect(dropped).toBe(1);
    expect(pairs).toHaveLength(20);
    const la = lengthAdjusted(pairs);
    expect(la.intercept!).toBeCloseTo(0, 6);
    expect(la.slope!).toBeCloseTo(0.002, 6);
    expect(la.ci95).not.toBeNull();
  });

  test("pairwise: raw and length-controlled win rates and the first-position win rate; ties excluded from both rates", () => {
    const map: PacketMap = { version: 1, kind: "pairwise", family: "plan", stage: 2, seed: SEED, packets: {} };
    const recs: PairRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const skillFirst = i % 2 === 0;
      map.packets["p" + i] = { id: "p" + i, role: "pairwise", family: "plan", stage: 2, unit: "u" + i, model: "opus", judges: ["astra"], items: {}, pair: { contrast: "skill-none" }, lists: { A: { kind: "arm", unit: "u" + i, model: "opus", arm: skillFirst ? "skill" : "none", words: 60 }, B: { kind: "arm", unit: "u" + i, model: "opus", arm: skillFirst ? "none" : "skill", words: 60 } } };
      const choice = i < 12 ? (skillFirst ? "A" : "B") : i < 18 ? (skillFirst ? "B" : "A") : "tie";
      recs.push({ packet: "p" + i, judge: "astra", model_id: "m", version: "v", choice, why: "x" });
    }
    const s = pairwiseSummary(map, recs)[0]!;
    expect(s).toMatchObject({ n: 20, wins: 12, losses: 6, ties: 2 });
    expect(s.raw).toBeCloseTo(12 / 18);
    expect(s.length_controlled!).toBeCloseTo(12 / 18, 2);
    expect(s.first_position).toBeCloseTo(9 / 18);
  });

  test("the arm-guess probe flags above 70% correct", () => {
    const map: PacketMap = { version: 1, kind: "probe", family: "plan", stage: 2, seed: SEED, packets: {} };
    const recs: ProbeRecord[] = [];
    for (let i = 0; i < 30; i++) {
      map.packets["q" + i] = { id: "q" + i, role: "probe", family: "plan", stage: 2, unit: "u", model: "opus", judges: ["astra"], items: {}, lists: { L: { kind: "arm", unit: "u", model: "opus", arm: "skill", words: 1 } } };
      recs.push({ packet: "q" + i, judge: "astra", model_id: "m", version: "v", guess: i < 21 ? "skill" : "none" });
    }
    expect(probeTally(map, recs)).toMatchObject({ n: 30, correct: 21, flag: false });
    recs[21]!.guess = "skill";
    expect(probeTally(map, recs).flag).toBe(true);
  });
});

describe("pv score command", () => {
  test("refuses an out path that aliases an input", async () => {
    const dir = tmp();
    await Bun.write(join(dir, "rows.json"), "[]");
    expect(() => run(["--units", dir, "--rows", join(dir, "rows.json"), "--map", join(dir, "m.json"), "--labels", join(dir, "l.ndjson"), "--out", join(dir, "rows.json")], capture().io)).toThrow(/same path/);
  });
});

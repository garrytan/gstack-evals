// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { sha256, suiteCases } from "../../../../lanes/review-noloss/suite.ts";
import { checkItems, chooseRoute, confirmation, confirmationItems, goldLabels, kappaAgainst, pilotCheck, type Gold } from "../../../../lanes/codex-hooks/c/analysis/check.ts";
import { CHECK, GOLD, SEED } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { anchorsFor, writeMatch, type Key } from "../../../../lanes/codex-hooks/c/analysis/judging.ts";
import { readStates } from "../../../../lanes/codex-hooks/c/analysis/record.ts";
import { readBatch, runGold, type Send } from "../../../../lanes/codex-hooks/c/analysis/run.ts";
import { at, bugsOf, cleanup, fakeAnswer, jsonl, loaded, maps, miss, session, suite, tmp, unitOf } from "./helpers.ts";

afterAll(cleanup);
type Label = "match" | "none";
const A = unitOf(3593);
const B = unitOf(3524);
const D = unitOf(3526);
const set = (l: Label) => new Set(l === "match" ? ["F1"] : []);

/** A hand-built matching key: n state packets on a one-blocker unit, then anchor packets. */
function handKey(n: number, anchors: Label[]): Key {
  const state = Array.from({ length: n }, (_, i) => ({ file: "packets/P" + i + ".json", unit: B.id, sha256: "", state: "s" + i, anchor: null }));
  const anchor = anchors.map((k, i) => ({ file: "packets/Q" + i + ".json", unit: B.id, sha256: "", state: null, anchor: { bug: "B1", kind: k === "match" ? ("match" as const) : ("near_miss" as const), from_case: "x" } }));
  return { version: 1, stage: "match", batch: "b", suite: { id: suite.id, sha256: loaded.sha256 }, arms: [], seed: SEED, states_sha256: "", mapping_sha256: "", packets: [...state, ...anchor], entries: [] };
}
/** Gold, primary and joined maps over a hand key's items: labels for the state items, then anchors labelled as known. */
function labelled(key: Key, goldState: Label[], judgeState: Label[]) {
  const items = checkItems(key, suite);
  const gold = new Map<string, Label>();
  const judge = new Map<string, Set<string>>();
  items.forEach((it, i) => {
    const g = it.anchor ? (it.anchor.kind === "match" ? "match" : "none") : goldState[i]!;
    gold.set(it.item, g);
    judge.set(it.item, set(it.anchor ? g : judgeState[i]!));
  });
  return { gold: { labellers: [...GOLD], gold, disagree: 0, unanswered: 0 } as Gold, judge };
}
const labels = (match: number, none: number): Label[] => [...Array<Label>(match).fill("match"), ...Array<Label>(none).fill("none")];
/** Flip the first m match labels and the first n no-match labels. */
const flip = (ls: Label[], m: number, n: number) => {
  let a = 0;
  let b = 0;
  return ls.map((l) => (l === "match" && a++ < m ? "none" : l === "none" && b++ < n ? "match" : l));
};

describe("anchors", () => {
  const pilot = [A, D, B];
  test("each blocking bug gives a known match at its line and a near miss 40 lines away in its file with another unit's case", () => {
    const xs = anchorsFor(suite, pilot, 1000, { seed: SEED, offset: CHECK.near_miss_offset, maxShare: CHECK.anchors_max_share });
    expect(xs.length).toBe(2 * pilot.flatMap(bugsOf).length);
    const cases = suiteCases(suite).cases;
    for (const x of xs) {
      const b = x.unit.blockers.find((y) => y.id === x.anchor.bug)!;
      expect(x.finding.file).toBe(b.file);
      if (x.anchor.kind === "match") {
        expect(x.finding.line).toBe(b.line);
        expect(x.anchor.from_case).toBe(b.case);
        expect(x.finding.claim).toBe(cases.get(b.case)!.defect.summary);
      } else {
        expect(Math.abs(x.finding.line! - b.line)).toBe(CHECK.near_miss_offset);
        expect(CHECK.near_miss_offset).toBeGreaterThanOrEqual(CHECK.near_miss_min_offset);
        const other = suite.units.find((u) => u.blockers.some((y) => y.case === x.anchor.from_case))!;
        expect(other.id).not.toBe(x.unit.id);
        expect(x.finding.claim).toBe(cases.get(x.anchor.from_case)!.defect.summary);
      }
    }
    expect(anchorsFor(suite, pilot, 1000, { seed: SEED, offset: 40, maxShare: 0.3 })).toEqual(xs);
  });

  test("anchors never pass 30% of the check set, and come in whole pairs", () => {
    for (let n = 0; n <= 120; n++) {
      const k = anchorsFor(suite, pilot, n, { seed: SEED, offset: 40, maxShare: 0.3 }).length;
      expect(k % 2).toBe(0);
      expect(k).toBeLessThanOrEqual(0.3 * (n + k) + 1e-9);
    }
    expect(anchorsFor(suite, pilot, 20, { seed: SEED, offset: 40, maxShare: 0.3 }).length).toBe(8);
  });
});

describe("kappa against gold", () => {
  const rule = { minItems: CHECK.min_items, minClass: CHECK.min_class };
  const run = (g: Label[], j: Label[]) => {
    const gold = new Map(g.map((l, i) => ["i" + i, l]));
    const judge = new Map(j.map((l, i) => ["i" + i, set(l)]));
    return kappaAgainst(gold, judge, gold.keys(), rule);
  };
  test("passes at 0.6 exactly on 40 items with 20 in each class", () => {
    const g = labels(20, 20);
    expect(run(g, g)).toMatchObject({ items: 40, kappa: 1, pass: true, why: null });
    expect(run(g, flip(g, 4, 4))).toMatchObject({ kappa: 0.6, pass: true });
  });
  test("fails under 0.6", () => {
    const g = labels(20, 20);
    const r = run(g, flip(g, 5, 4));
    expect(r.kappa!).toBeLessThan(0.6);
    expect(r.pass).toBe(false);
    expect(r.why).toMatch(/is under 0.6/);
  });
  test("fails on 39 items, and with 9 in a class, however well it agrees", () => {
    expect(run(labels(20, 19), labels(20, 19))).toMatchObject({ pass: false, why: "39 gold items, under 40" });
    expect(run(labels(9, 31), labels(9, 31))).toMatchObject({ pass: false, why: "9 match and 31 no-match gold items; each class needs 10" });
  });
  test("counts only items both gold and the judge labelled", () => {
    const gold = new Map(labels(20, 20).map((l, i) => ["i" + i, l]));
    const judge = new Map([...gold].slice(0, 39).map(([k, l]) => [k, set(l)]));
    expect(kappaAgainst(gold, judge, gold.keys(), rule).items).toBe(39);
  });
});

describe("the pilot check", () => {
  test("passes when the primary and the joined label both agree with gold", () => {
    const key = handKey(40, labels(8, 8));
    const { gold, judge } = labelled(key, labels(20, 20), labels(20, 20));
    const r = pilotCheck({ route: "A", key, suite, gold, primary: judge, joined: judge });
    expect(r.set).toEqual({ items: 56, anchors: 16, anchor_share: 16 / 56 });
    expect(r.anchors_gold_agree).toEqual({ known: 16, agree: 16 });
    expect(r.pass).toBe(true);
  });

  test("fails when the non-anchor items hold 10 of each class and their kappa is under 0.6, though anchors lift the whole set over it", () => {
    const key = handKey(40, labels(8, 8));
    const g = labels(20, 20);
    const { gold, judge } = labelled(key, g, [...flip(g, 5, 4), ...labels(0, 0)]);
    const r = pilotCheck({ route: "A", key, suite, gold, primary: judge, joined: judge });
    expect(r.primary.pass).toBe(true);
    expect(r.joined.pass).toBe(true);
    expect(r.non_anchor.required).toBe(true);
    expect(r.non_anchor.joined.kappa!).toBeLessThan(0.6);
    expect(r.pass).toBe(false);
  });

  test("reports but does not require the non-anchor kappa when a class there has under 10 items", () => {
    const key = handKey(40, labels(8, 8));
    const g = labels(9, 31);
    const { gold, judge } = labelled(key, g, flip(g, 3, 3));
    const r = pilotCheck({ route: "A", key, suite, gold, primary: judge, joined: judge });
    expect(r.non_anchor.required).toBe(false);
    expect(r.non_anchor.joined.kappa!).toBeLessThan(0.6);
    expect(r.primary.pass).toBe(true);
    expect(r.pass).toBe(true);
  });

  test("fails when anchors pass 30% of the set, however well the judge agrees", () => {
    const key = handKey(40, labels(10, 10));
    const { gold, judge } = labelled(key, labels(20, 20), labels(20, 20));
    const r = pilotCheck({ route: "A", key, suite, gold, primary: judge, joined: judge });
    expect(r.set.anchor_share).toBeCloseTo(1 / 3, 12);
    expect(r.primary.pass && r.joined.pass).toBe(true);
    expect(r.pass).toBe(false);
  });

  test("fails when the primary alone fails, even if the joined label passes", () => {
    const key = handKey(40, labels(8, 8));
    const g = labels(20, 20);
    const good = labelled(key, g, g);
    const bad = labelled(key, g, flip(g, 10, 10));
    const r = pilotCheck({ route: "A", key, suite, gold: good.gold, primary: bad.judge, joined: good.judge });
    expect(r.primary.pass).toBe(false);
    expect(r.joined.pass).toBe(true);
    expect(r.pass).toBe(false);
  });

  test("gold labels come from two labellers reading the real batch, and only items they agree on count", async () => {
    const units = [A, D, B];
    const text = jsonl([
      ...session({ arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1"), at(A, "B2")] }),
      ...session({ arm: "c-off", unit: D, final: [at(D, "B3"), miss(4)] }),
      ...session({ arm: "c-high", unit: B, final: [miss(5)] }),
    ]);
    const states = readStates(text, suite, { passes: 1, units: units.map((u) => u.id) });
    const items = units.filter((u) => states.sessions.some((s) => s.unit.id === u.id)).length;
    const anchors = anchorsFor(suite, units, 9, { seed: SEED, offset: 40, maxShare: 0.3 });
    const dir = tmp();
    const m = writeMatch({ suite, suiteSha256: loaded.sha256, states, statesSha256: sha256(text), maps, seed: SEED, out: join(dir, "match"), key: join(dir, "match-key.json"), counted: new Map(), anchors });
    expect(items).toBe(3);
    expect(m.key.packets.filter((p) => p.anchor).length).toBe(anchors.length);
    const check = checkItems(m.key, suite);
    expect(check.filter((i) => !i.anchor).length).toBe(2 * 2 + 4 + 1);
    const send: Send = async (r) => fakeAnswer(r.prompt, r.attempt, r.model === GOLD[1] ? { blind: (b, f) => b === "B3" && /wrong value/.test(f.text) } : {});
    const g = await runGold({ b: readBatch(join(dir, "match"), m.key), suite, brief: "brief", models: GOLD, files: m.key.packets.map((p) => p.file), send });
    expect(g.requests).toBe(2 * m.key.packets.length);
    const gold = goldLabels(m.key, suite, GOLD.map((x) => g.replies.get(x)!), check.map((i) => i.item));
    expect(gold.labellers).toEqual([...GOLD]);
    expect(gold.disagree).toBe(1);
    expect(gold.gold.size).toBe(check.length - 1);
    const r = pilotCheck({ route: "A", key: m.key, suite, gold, primary: new Map(), joined: new Map() });
    expect(r.pass).toBe(false);
    expect(r.primary.why).toMatch(/under 40/);
    expect(() => goldLabels(m.key, suite, [g.replies.get(GOLD[0])!, g.replies.get(GOLD[0])!], [])).toThrow(/^E_CH_C_CHECK both gold replies are from/);
    expect(() => goldLabels(m.key, suite, [g.replies.get(GOLD[0])!], [])).toThrow(/^E_CH_C_CHECK gold labels need exactly two/);
  });
});

describe("the confirmation check", () => {
  const joined = (m: number, n: number) => new Map([...Array.from({ length: m }, (_, i) => ["P" + i + " B1", set("match")] as const), ...Array.from({ length: n }, (_, i) => ["N" + i + " B1", set("none")] as const)]);
  test("draws 20 judged items from each joined label by seed, whatever order the labels arrive in", () => {
    const j = joined(30, 25);
    const drawn = confirmationItems(j, SEED);
    expect(drawn.length).toBe(40);
    expect(drawn.filter((k) => k.startsWith("P")).length).toBe(20);
    expect(new Set(drawn).size).toBe(40);
    expect(confirmationItems(new Map([...j].reverse()), SEED)).toEqual(drawn);
    expect(confirmationItems(j, SEED + 1)).not.toEqual(drawn);
    expect(confirmationItems(joined(5, 50), SEED).length).toBe(25);
  });
  test("passes at kappa 0.6 on the drawn items and fails under it", () => {
    const j = joined(30, 25);
    const items = confirmationItems(j, SEED);
    const gold = (wrong: number): Gold => ({ labellers: [...GOLD], gold: new Map(items.map((k, i) => [k, (i < wrong ? !j.get(k)!.size : j.get(k)!.size) ? "match" : "none"])), disagree: 0, unanswered: 0 });
    expect(confirmation({ route: "A", items, gold: gold(0), joined: j })).toMatchObject({ drawn: 40, pass: true });
    expect(confirmation({ route: "A", items, gold: gold(8), joined: j }).joined.kappa).toBe(0.6);
    expect(confirmation({ route: "A", items, gold: gold(12), joined: j }).pass).toBe(false);
  });
});

describe("the route", () => {
  const ok = { pass: true };
  const no = { pass: false };
  test("A when both its checks pass", () => expect(chooseRoute({ A: { pilot: ok, confirmation: ok }, B: { pilot: ok, confirmation: ok } })).toBe("A"));
  test("B when A fails its pilot check and B passes both", () => expect(chooseRoute({ A: { pilot: no, confirmation: null }, B: { pilot: ok, confirmation: ok } })).toBe("B"));
  test("B when A passes the pilot but fails the confirmation", () => expect(chooseRoute({ A: { pilot: ok, confirmation: no }, B: { pilot: ok, confirmation: ok } })).toBe("B"));
  test("no route when B fails either check, or has not run one", () => {
    expect(chooseRoute({ A: { pilot: no, confirmation: null }, B: { pilot: ok, confirmation: no } })).toBeNull();
    expect(chooseRoute({ A: { pilot: no, confirmation: null }, B: { pilot: ok, confirmation: null } })).toBeNull();
    expect(chooseRoute({})).toBeNull();
  });
});

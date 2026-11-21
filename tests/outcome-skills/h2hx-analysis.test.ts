// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commands } from "../../lanes/outcome-skills/h2h/ext/commands.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { analyze } from "../../lanes/outcome-skills/h2h/analysis/analyze.ts";
import { readRecords } from "../../lanes/outcome-skills/h2h/analysis/commands.ts";
import type { PairedTest } from "../../lanes/outcome-skills/h2h/analysis/stats.ts";
import { analyzeExt, crossRows, noHarm, reportExt, testsRecord, type ExtInput, type ExtScore, type ExtSession, type ExtTests } from "../../lanes/outcome-skills/h2h/ext/analysis.ts";
import { absZ, boundAt, holmCrossings, interimLook, lookLines, obfBounds } from "../../lanes/outcome-skills/h2h/ext/look.ts";
import { EXT_PREREG_PATH, extArmsFor, readExtPrereg, type ExtArm, type Part } from "../../lanes/outcome-skills/h2h/ext/prereg.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import type { H2hArm, H2hScore, H2hSession, H2hUnit, UnitKind } from "../../lanes/outcome-skills/h2h/types.ts";

const x = readExtPrereg();
const base = readPrereg();
const published = (JSON.parse(readFileSync(EXT_PREREG_PATH, "utf8")) as { tests_added: { published_check: { recount: Record<string, number>; frozen_rule: Record<string, number> } } }).tests_added.published_check;
const DATA = join(import.meta.dir, "..", "..", "wiki", "board", "2026-11-19-geva-540-skill-pack-h2h-session-data");

/** Units of one kind, two to a repository; every fifth O unit is a feature. */
function units(kind: UnitKind, n: number, prefix = kind): H2hUnit[] {
  return Array.from({ length: n }, (_, k) => ({
    id: prefix + "-" + k, class: kind === "O" ? "O" : "B", kind, repo: prefix + "-repo-" + Math.floor(k / 2), month: "2026-07", language: k % 2 ? "go" : "ts",
    entry: kind === "O" && k % 5 === 0 ? "feature" : "bug", image_digest: "sha256:" + "a".repeat(64), licence: "MIT", position: k + 1, stage: "stage2",
  }));
}
type Plan = (u: H2hUnit, arm: ExtArm, k: number) => { v: 0 | 1 | "gap"; lines?: number; added?: boolean; recount?: boolean; procedure?: boolean };
function records(part: Part, us: readonly H2hUnit[], plan: Plan): ExtInput {
  const sessions: ExtSession[] = [], scores: ExtScore[] = [], tests: ExtTests[] = [];
  for (const u of us) {
    const k = u.position - 1;
    for (const arm of extArmsFor(part, u.kind, x)) {
      const r = plan(u, arm, k);
      const gap = r.v === "gap" ? "E_PF_UPSTREAM" : null;
      sessions.push({
        schema: "h2h-session.v1", unit: u.id, arm, model: x.parts[part].model, item: "h2hx-" + part.toLowerCase() + "-main", stage: "stage2", index: k, end: gap ? "upstream" : "completed", gap, turns: 2, scripted_turns: 1,
        continuations: 0, spurious_continuations: 0, done_seen: true, questions: 0, reservation_refusals: 0, cost_usd: 1, tokens: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, wall_ms: 1000,
        exposure: { loaded: true, procedure: r.procedure ?? true, markers: [], foreign_reads: [] }, transcript: "t", tree_bundle: "tree",
      });
      scores.push({
        schema: "h2h-score.v1", unit: u.id, arm, stage: "stage2", outcome: gap ? null : r.v ? "clean_fix" : "no_fix", verified: r.v === 1, verified_without_new_test_rule: r.v === 1, adapted_verified: gap ? null : r.v === 1,
        gap, dropped_arm_tests: [], worktree_pass: null, lines_changed: r.lines ?? 20, planning_lines: 0,
      });
      const added = r.added ?? k % 5 !== 0;
      tests.push({ schema: "h2hx-tests.v1", unit: u.id, arm, stage: "stage2", added, recount: r.recount ?? added, lines: added ? 3 : 0 });
    }
  }
  return { units: [...us], sessions, scores, tests, stage: "stage2" };
}
const gv = (k: number): 0 | 1 => (k % 3 ? 1 : 0);
const sentence = (a: ReturnType<typeof analyzeExt>, s: string, g = s.startsWith("l-") ? "l-gstack" : "") => a.sentence.find((r) => r.sentence === s && (!g || r.gstack === g))!;

describe("h2hx sentence family (section 9)", () => {
  test("planted: l-gstack-md holds, l-gstack-task holds only by dropping tests", () => {
    const a = analyzeExt("L", records("L", units("O", 100), (_u, arm, k) => ({
      v: gv(k), lines: arm === "l-gstack-md" || arm === "l-gstack-task" ? 10 : 20, added: arm === "l-gstack-task" ? k % 10 < 3 : k % 5 !== 0,
    })), { x, base });
    const md = sentence(a, "l-gstack-md"), task = sentence(a, "l-gstack-task");
    expect(md.lines.ratio).toBeCloseTo(0.5, 9);
    expect(md.less_code && md.fixes_kept && md.tests_kept).toBe(true);
    expect(md.reading).toBe("holds");
    expect(task.less_code && task.fixes_kept).toBe(true);
    expect(task.tests_kept).toBe(false);
    expect(task.tests.delta).toBeCloseTo(-0.5, 9);
    expect(task.reading).toBe("holds only by dropping tests");
    expect(a.rows).toEqual(["l-gstack-md holds"]);
    const placements = a.sentence.find((r) => !r.decides)!;
    expect(placements.label).toBe("l-gstack-md minus l-gstack-task");
    expect(reportExt(a).some((l) => l.includes("(secondary, decides nothing)") && !l.includes("reading:"))).toBe(true);
  });

  test("planted: l-gstack-md does not cut code, l-gstack-task cuts code but loses fixes", () => {
    const a = analyzeExt("L", records("L", units("O", 100), (_u, arm, k) => ({
      v: arm === "l-gstack-task" ? (k % 3 === 1 ? 1 : 0) : gv(k), lines: arm === "l-gstack-task" ? 10 : 20,
    })), { x, base });
    const md = sentence(a, "l-gstack-md"), task = sentence(a, "l-gstack-task");
    expect(md.lines.ratio).toBeCloseTo(1, 9);
    expect(md.reading).toBe("does not cut code");
    expect(task.less_code).toBe(true);
    expect(task.fixes_kept).toBe(false);
    expect(task.reading).toBe("cuts code but loses fixes");
    expect(a.rows).toEqual(["l-gstack-md does not cut code"]);
  });

  test("a cell past the gap share reads incomplete, and Part L under 60 units is underpowered", () => {
    const a = analyzeExt("L", records("L", units("O", 100), (_u, arm, k) => ({ v: arm === "l-gstack-md" && k % 5 === 1 ? "gap" : gv(k), lines: 10 })), { x, base });
    expect(sentence(a, "l-gstack-md").reading).toBe("incomplete");
    const small = analyzeExt("L", records("L", units("O", 40), (_u, arm, k) => ({ v: gv(k), lines: arm === "l-gstack-md" ? 10 : 20 })), { x, base });
    expect(small.rows).toEqual(["Part L underpowered (under 60 counted units)"]);
  });

  test("the no-harm screen: -5 points passes, worse fails, and an interval wholly below 0 fails", () => {
    const t = (delta: number | null, ci95: [number, number] | null) => ({ delta, ci95 }) as PairedTest;
    expect(noHarm(t(-0.05, [-0.12, 0.02]), -0.05)).toBe(true);
    expect(noHarm(t(-0.0500000001, [-0.12, 0.02]), -0.05)).toBe(true);
    expect(noHarm(t(-0.06, [-0.12, 0.02]), -0.05)).toBe(false);
    expect(noHarm(t(-0.04, [-0.08, -0.01]), -0.05)).toBe(false);
    expect(noHarm(t(null, null), -0.05)).toBe(false);
  });

  test("the sentence contrasts on Sol and particle-1 read O units only, and every arm's tests added carries the recount beside it", () => {
    const us = [...units("O", 40), ...units("B2", 20)];
    const s = analyzeExt("S", records("S", us, (_u, arm, k) => ({ v: gv(k), lines: arm === "s-gstack-line" ? 10 : 20, recount: k % 4 !== 0 })), { x, base, withMdd: false });
    const line = sentence(s, "s-gstack-line", "s-gstack");
    expect(line.fixes.n).toBe(40);
    expect(s.tests.find((t) => t.class === "B" && t.arm === "s-gstack-line")).toBeUndefined();
    const row = s.tests.find((t) => t.class === "O" && t.arm === "s-none")!;
    expect([row.sessions, row.frozen, row.recount]).toEqual([40, 32, 30]);
    expect(reportExt(s)).toContain("tests added | O | s-none | 40 | 32 | 30");
    const p = analyzeExt("P", records("P", us, (_u, arm, k) => ({ v: gv(k), lines: arm === "p-gstack-oneline" ? 10 : 20 })), { x, base, withMdd: false });
    expect(sentence(p, "p-gstack-oneline", "p-gstack").reading).toBe("holds");
  });

  test("the frozen rule and the recount reproduce prereg.json's published counts on the head-to-head's diffs", () => {
    const rows = readFileSync(join(DATA, "sessions.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { unit: string; arm: string; class: string; lang: string; diff: string | null });
    const got: Record<string, { frozen: number; recount: number }> = {};
    for (const r of rows.filter((r) => r.class === "O" && r.arm in published.recount)) {
      const t = testsRecord({ unit: r.unit, arm: "l-gstack", stage: "stage2", patch: r.diff ? readFileSync(join(DATA, r.diff), "utf8") : "", lang: r.lang as never, testFiles: [], readBase: () => null });
      const c = (got[r.arm] ??= { frozen: 0, recount: 0 });
      c.frozen += t.added ? 1 : 0;
      c.recount += t.recount ? 1 : 0;
    }
    expect(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.frozen]))).toEqual(published.frozen_rule);
    expect(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.recount]))).toEqual(published.recount);
  });

  test("refuses a record for an arm that does not run on the unit, and a scored session with no tests-added record", () => {
    const us = [...units("O", 4), ...units("B2", 2)];
    const i = records("S", us, (_u, _arm, k) => ({ v: gv(k) }));
    const bad = { ...i, scores: [...i.scores, { ...i.scores.find((s) => s.unit === "B2-0")!, arm: "s-gstack-line" as ExtArm }] };
    expect(() => analyzeExt("S", bad, { x, base, withMdd: false })).toThrow(/^E_H2HX_ANALYSIS_INPUT score for B2-0 names arm s-gstack-line/);
    const missing = { ...i, tests: i.tests.filter((t) => !(t.unit === "O-1" && t.arm === "s-gstack")) };
    expect(() => analyzeExt("S", missing, { x, base, withMdd: false })).toThrow(/^E_H2HX_ANALYSIS_INPUT scored session O-1 s-gstack has no tests-added record/);
  });
});

describe("h2hx primary families (section 9)", () => {
  test("part S: Holm over 10, steps 0.05/10 to 0.05/1, a planted lead over s-none reads ahead", () => {
    const us = [...units("O", 100), ...units("B2", 60)];
    const rand = seededRandom(7);
    const a = analyzeExt("S", records("S", us, (u, arm, k) => ({ v: arm === "s-none" && u.class === "O" ? (rand() < 0.2 ? 1 : 0) : arm === "s-gstack" || arm === "s-gstack-line" ? (k % 10 ? 1 : 0) : (rand() < 0.88 ? 1 : 0) })), { x, base, withMdd: false });
    expect(a.family).toHaveLength(10);
    expect(a.family.map((r) => r.other)).not.toContain("s-pstack");
    expect(a.family.map((r) => Math.round(0.05 / r.holm_alpha)).sort((p, q) => p - q)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const oNone = a.family.find((r) => r.class === "O" && r.other === "s-none")!;
    expect(oNone.state).toBe("ahead");
    expect(oNone.holm_alpha).toBeCloseTo(0.005, 12);
    expect(a.rows[0]).toBe("Sol, O: s-gstack ahead of s-none");
    const crossed = holmCrossings(a.family.map((r) => ({ p: r.p_holm_input, z: r.incomplete ? 0 : absZ(r.test) })), 10, x, 1);
    a.family.forEach((r, k) => {
      expect(r.bound).toBe(boundAt(x, Math.round(0.05 / r.holm_alpha), 1));
      if (r.state === "ahead" || r.state === "behind") expect(crossed[k]).toBe(true);
      if (!crossed[k] && !r.incomplete) expect(r.state).toBe("no_difference");
    });
    expect(a.stopped_at_half).toBe(false);
  });

  test("part S stopped at half reads the first half of each class against the look's bounds; other parts have no bound", () => {
    const us = [...units("O", 100), ...units("B2", 60)];
    const rand = seededRandom(7);
    const i = records("S", us, (u, arm, k) => ({ v: arm === "s-none" && u.class === "O" ? (rand() < 0.2 ? 1 : 0) : arm === "s-gstack" || arm === "s-gstack-line" ? (k % 10 ? 1 : 0) : (rand() < 0.88 ? 1 : 0) }));
    const h = analyzeExt("S", i, { x, base, withMdd: false, stoppedAtHalf: true });
    expect(h.stopped_at_half).toBe(true);
    expect(h.units).toEqual({ O: 50, B: 30 });
    for (const r of h.family) expect(r.bound).toBe(boundAt(x, Math.round(0.05 / r.holm_alpha), 0));
    expect(reportExt(h)[0]).toContain("stopped at half");
    const p = records("P", us.slice(0, 20), () => ({ v: 1 }));
    expect(() => analyzeExt("P", p, { x, base, withMdd: false, stoppedAtHalf: true })).toThrow(/^E_H2HX_ANALYSIS_INPUT only part S/);
    expect(analyzeExt("P", p, { x, base, withMdd: false }).family.every((r) => r.bound === null)).toBe(true);
  });

  test("part P: the family of 12 equals the base analysis's on the same records under base names, at the extension's seed", () => {
    const us = [...units("O", 60), ...units("B2", 40)];
    const rand = seededRandom(11);
    const rate: Record<string, number> = { "p-none": 0.5, "p-gstack": 0.6, "p-superpowers": 0.45, "p-agent-skills": 0.7, "p-gsd": 0.4, "p-pstack": 0.55, "p-tstack": 0.3, "p-gstack-pony": 0.6, "p-gstack-oneline": 0.6 };
    const i = records("P", us, (_u, arm) => ({ v: rand() < rate[arm]! ? 1 : 0, lines: 5 + Math.floor(rand() * 30), procedure: rand() < 0.95 }));
    const ext = analyzeExt("P", i, { x, base, withMdd: false });
    const map = x.parts.P.base_arm;
    const toBase = <T extends { arm: ExtArm }>(r: T) => ({ ...r, arm: map[r.arm as keyof typeof map] as H2hArm });
    const b = analyze({ units: us, sessions: i.sessions.map(toBase) as H2hSession[], scores: i.scores.map(toBase) as H2hScore[], stage: "stage2" }, { ...base, bootstrap_seed: x.bootstrap_seed });
    expect(ext.family).toHaveLength(12);
    ext.family.forEach((r, k) => {
      const q = b.family[k]!;
      expect([r.class, map[r.other as keyof typeof map]]).toEqual([q.class, q.other]);
      expect(r.test).toEqual(q.test);
      expect([r.p_holm, r.holm_rank, r.holm_alpha, r.state]).toEqual([q.p_holm, q.holm_rank, q.holm_alpha, q.state]);
    });
    const pony = ext.secondaries.find((c) => c.label === "O: p-gstack-pony minus p-gstack")!;
    expect(pony.test).toEqual(b.piece_g.verified);
    expect(pony.lines!.ratio).toBeCloseTo(b.piece_g.lines.ratio!, 12);
  }, 120_000);

  test("particle-1's gap to the published Opus row of the same arm, paired on the same units", () => {
    const pub = JSON.parse(readFileSync(join(DATA, "units.json"), "utf8")) as H2hUnit[];
    const opus = readRecords<H2hScore>(join(DATA, "score-records.jsonl"), "h2h-score.v1");
    const us = [...pub.filter((u) => u.kind === "O").slice(0, 30), ...pub.filter((u) => u.kind === "B2").slice(0, 20)].map((u) => ({ ...u, stage: "stage2" as const }));
    const a = analyzeExt("P", records("P", us, () => ({ v: 1 })), { x, base, withMdd: false, opus: { scores: opus } });
    const row = a.opus_gap.find((c) => c.label === "O: p-none minus Opus none")!;
    const ov = us.filter((u) => u.kind === "O").map((u) => opus.find((s) => s.unit === u.id && s.arm === "none")!).filter((s) => s.gap === null);
    expect(row.test.n).toBe(ov.length);
    expect(row.test.delta).toBeCloseTo(1 - ov.filter((s) => s.verified).length / ov.length, 12);
    expect(a.opus_gap.map((c) => c.label)).toContain("B: p-gstack minus Opus gstack");
    expect(a.opus_gap.some((c) => c.label.startsWith("B: p-gstack-pony"))).toBe(false);
  });

  test("cross-part rows: s-gstack-line holding while l-gstack-md does not, and particle-1's sentence losing fixes while it holds", () => {
    const L = (md: "holds" | "does not cut code") => analyzeExt("L", records("L", units("O", 100), (_u, arm, k) => ({ v: gv(k), lines: arm === "l-gstack-md" && md === "holds" ? 10 : 20 })), { x, base });
    const us = [...units("O", 40), ...units("B2", 20)];
    const S = analyzeExt("S", records("S", us, (_u, arm, k) => ({ v: gv(k), lines: arm === "s-gstack-line" ? 10 : 20 })), { x, base, withMdd: false });
    const P = analyzeExt("P", records("P", us, (_u, arm, k) => ({ v: arm === "p-gstack-oneline" ? (k % 3 === 1 ? 1 : 0) : gv(k), lines: arm === "p-gstack-oneline" ? 10 : 20 })), { x, base, withMdd: false });
    expect(crossRows({ L: L("does not cut code"), S })).toEqual(["s-gstack-line holds, l-gstack-md does not"]);
    expect(crossRows({ L: L("holds"), S, P })).toEqual([
      "l-gstack-md holds and s-gstack-line holds: the same sentence goes into gstack's Codex AGENTS.md",
      "particle-1's gstack-oneline loses fixes (criterion 2 fails) while l-gstack-md holds",
    ]);
    const small = analyzeExt("L", records("L", units("O", x.parts.L.units.min_counted - 1), (_u, arm, k) => ({ v: gv(k), lines: arm === "l-gstack-md" ? 10 : 20 })), { x, base });
    expect(small.sentence.find((s) => s.sentence === "l-gstack-md" && s.gstack === "l-gstack")!.reading).toBe("holds");
    expect(crossRows({ L: small, S, P }, x)).toEqual([]);
    expect(crossRows({ L: { ...L("holds"), stage: "stage1" }, S, P }, x)).toEqual([]);
  });
});

describe("h2hx part S interim look (section 11)", () => {
  test("the two-look O'Brien-Fleming bounds reproduce interim.bounds_table at every Holm step", () => {
    for (let k = 1; k <= 10; k++) expect(obfBounds(0.05 / k)).toEqual(x.interim.bounds_table["0.05/" + k]!);
  });

  test("planted: at every Holm step of the family of 10, a contrast crosses just above its bound and not just below", () => {
    for (let k = 1; k <= 10; k++) {
      const rank = 10 - k, b = boundAt(x, k);
      for (const [dz, want] of [[0.001, true], [-0.001, false]] as const) {
        const items = Array.from({ length: 10 }, (_, r) => (r < rank ? { p: 1e-12 * (r + 1), z: 10 } : r === rank ? { p: 1e-6, z: b + dz } : { p: 0.5 + r / 100, z: 0 }));
        expect(holmCrossings(items.reverse(), 10, x)[9 - rank]).toBe(want);
      }
    }
  });

  test("planted: at every step of the sentence family's three, the less-code ratio crosses at its own bound", () => {
    for (let k = 1; k <= 3; k++) {
      const rank = 3 - k, b = boundAt(x, k);
      for (const [dz, want] of [[0.001, true], [-0.001, false]] as const) {
        const items = [0, 1, 2].map((r) => (r < rank ? { p: 1e-9 * (r + 1), z: 10 } : r === rank ? { p: 1e-4, z: b + dz } : { p: 0.9, z: 0 }));
        expect(holmCrossings(items, 3, x)[rank]).toBe(want);
      }
    }
  });

  test("Holm steps down: a contrast ranked earlier that does not cross blocks every later one", () => {
    expect(holmCrossings([{ p: 0.001, z: 3.9 }, { p: 0.002, z: 3.95 }, { p: 0.003, z: 50 }], 10, x)).toEqual([false, false, false]);
    expect(holmCrossings([{ p: 0.001, z: 3.98 }, { p: 0.002, z: 3.93 }, { p: 0.003, z: 3.86 }], 10, x)).toEqual([true, true, false]);
  });

  const sData = (o: { tie?: ExtArm; gaps?: boolean; lineTests?: boolean } = {}) => {
    const us = [...units("O", 100), ...units("B2", 60)];
    const rand = seededRandom(3);
    return records("S", us, (u, arm, k) => {
      if (o.gaps && arm === "s-tstack" && u.class === "B" && k % 4 === 0) return { v: "gap" };
      const g = k % 17 ? 1 : 0;
      const v = arm === "s-gstack" || arm === "s-gstack-line" || arm === o.tie ? g : rand() < 0.1 ? 1 : 0;
      return { v, lines: arm === "s-gstack-line" ? 10 : 20, added: arm === "s-gstack-line" && o.lineTests ? k % 10 < 2 : k % 5 !== 0 };
    });
  };

  test("planted: every deciding contrast crosses, so part S stops for efficacy at half its units", () => {
    const r = interimLook(sData(), { x, base });
    expect(r.half).toEqual({ O: 50, B: 30 });
    expect(r.contrasts).toHaveLength(11);
    expect(r.contrasts.every((c) => c.crossed)).toBe(true);
    expect(r.stop).toBe("efficacy");
    const lines = lookLines(r);
    expect(lines.at(-1)).toBe("stop: efficacy");
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/: (crossed|not crossed)$/);
    expect(lines.join("\n")).not.toMatch(/\d\.\d/);
  });

  test("a pack level with gstack, or the line arm dropping tests, does not cross and part S continues", () => {
    const tie = interimLook(sData({ tie: "s-gsd" }), { x, base });
    expect(tie.contrasts.filter((c) => !c.crossed).map((c) => c.label)).toEqual(["s-gstack minus s-gsd, O", "s-gstack minus s-gsd, B"]);
    expect(tie.stop).toBe("continue");
    const drop = interimLook(sData({ lineTests: true }), { x, base });
    expect(drop.contrasts.filter((c) => !c.crossed).map((c) => c.label)).toEqual(["s-gstack-line: less-code ratio with both no-harm criteria passing"]);
    expect(drop.stop).toBe("continue");
  });

  test("x-look reads record files and prints only the crossings and the stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "h2hx-look-"));
    const i = sData({ tie: "s-gsd" });
    const put = (name: string, v: unknown) => {
      writeFileSync(join(dir, name), JSON.stringify(v));
      return join(dir, name);
    };
    const args = ["--units", put("units.json", i.units), "--sessions", put("sessions.json", i.sessions), "--scores", put("scores.json", i.scores), "--tests", put("tests.json", i.tests)];
    const printed: string[] = [];
    const log = console.log;
    console.log = (s: string) => printed.push(s);
    try {
      expect(await commands["x-look"]!(args)).toBe(0);
    } finally {
      console.log = log;
    }
    expect(printed).toEqual(lookLines(interimLook(i, { x, base })));
    expect(printed.at(-1)).toBe("stop: continue");
  });

  test("a cell past 10% gaps at the look stops part S with no verdict, and a cap stop does too", () => {
    expect(interimLook(sData({ gaps: true }), { x, base }).stop).toBe("gaps");
    expect(interimLook(sData(), { x, base, capStop: true }).stop).toBe("cap");
  });
});

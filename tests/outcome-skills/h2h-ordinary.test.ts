// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { excludedBy, finishFrame, screenFrame, type LicenceRead, type RowText } from "../../lanes/outcome-skills/h2h/ordinary/frame.ts";
import { drawB, planFor, replaceDropped, seededOrder, walk, type DrawUnit, type Gate } from "../../lanes/outcome-skills/h2h/ordinary/draw.ts";
import { readPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import type { Candidate } from "../../lanes/outcome-skills/statemachines/source.ts";

const p = readPrereg();
const ISSUE = "The parser accepts a trailing comma in an object literal and then reports the wrong line for the next error. " + "Steps: parse the attached input and read the reported position. ".repeat(3);

function cand(id: string, repo: string, o: Partial<Candidate> = {}): Candidate {
  return {
    id, source: "live-multilang", revision: "r", repo, pull_number: "1", created_at: "2026-04-02T00:00:00Z", month: "2026-04", lang: "go", docker_image: "x", image_digest: null,
    base_commit: "b".repeat(40), f2p: 1, p2p: 2, fix_files: 2, fix_source_files: 1, test_files: 1, tests_share_fix_file: false, feature_screen: false, issue_sha256: "", row_sha256: "", ...o,
  };
}
const licences: LicenceRead = {
  schema: "h2h-o-licences.v1", read_at: "2026-11-15T00:00:00Z", query: "q",
  repos: {
    "good/one": { spdx: "MIT", name_with_owner: "good/one" }, "good/feat": { spdx: "Apache-2.0", name_with_owner: "good/feat" }, "gpl/one": { spdx: "GPL-3.0", name_with_owner: "gpl/one" },
    "unknown/one": { spdx: "NOASSERTION", name_with_owner: "unknown/one" }, "zero/one": { spdx: "MIT-0", name_with_owner: "zero/one" }, "moved/old": { spdx: "MIT", name_with_owner: "gsd-build/new" },
    "wide/one": { spdx: "MIT", name_with_owner: "wide/one" }, "told/one": { spdx: "MIT", name_with_owner: "told/one" }, "img/one": { spdx: "MIT", name_with_owner: "img/one" },
  },
};

describe("h2h O frame gates", () => {
  test("the exclusion list matches owner patterns and exact names without case", () => {
    expect(excludedBy("GSD-Build/thing", p.exclusion)).toBe("gsd-build/*");
    expect(excludedBy("addyosmani/agent-skills", p.exclusion)).toBe("addyosmani/agent-skills");
    expect(excludedBy("addyosmani/other", p.exclusion)).toBeNull();
  });

  test("a unit obeying every rule passes every O gate, and each bad row drops at its first gate", () => {
    const cands = [
      cand("good__one-1", "good/one"), cand("good__feat-1", "good/feat", { feature_screen: true }), cand("old__one-1", "good/one", { created_at: "2024-12-30T00:00:00Z", month: "2024-12" }),
      cand("gsd__x-1", "gsd-build/x"), cand("moved__old-1", "moved/old"), cand("gpl__one-1", "gpl/one"), cand("unknown__one-1", "unknown/one"), cand("zero__one-1", "zero/one"),
      cand("wide__one-1", "wide/one", { fix_source_files: 7 }), cand("told__one-1", "told/one"), cand("img__one-1", "img/one"),
    ];
    const rows = new Map<string, RowText>(cands.map((c) => [c.id, { problem_statement: c.id === "told__one-1" ? ISSUE + "\n@@ -1,2 +1,2 @@\n" : ISSUE, patch: "+x\n" }]));
    const s = screenFrame(p, cands, rows, licences);
    expect(s.inWindow).toBe(10);
    expect(s.drops.map((d) => [d.id, d.gate, d.code, d.rule])).toEqual([
      ["gpl__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "GPL-3.0"],
      ["gsd__x-1", "exclusion", "E_H2H_O_EXCLUDED", "gsd-build/*"],
      ["moved__old-1", "exclusion", "E_H2H_O_EXCLUDED", "gsd-build/*"],
      ["told__one-1", "told", "E_H2H_O_TOLD", "diff_block"],
      ["unknown__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "NOASSERTION"],
      ["wide__one-1", "harness_screen", "E_SM_INELIGIBLE", "fix_source_files_1_to_6"],
      ["zero__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "MIT-0"],
    ]);
    expect(s.survivors.map((c) => c.id)).toEqual(["good__feat-1", "good__one-1", "img__one-1"]);
    const digest = "sha256:" + "d".repeat(64);
    const f = finishFrame(p, { cands, screened: s, digests: new Map([["good__one-1", digest], ["good__feat-1", digest], ["img__one-1", null]]), licences, licencesText: "{}", head: { sha: "h", last_modified: null, read_at: "t" }, dataset: "d", revision: "r", freezeDate: "2026-11-15" });
    expect(f.units).toEqual([
      { id: "good__feat-1", repo: "good/feat", month: "2026-04", language: "go", entry: "feature", licence: "Apache-2.0", digest },
      { id: "good__one-1", repo: "good/one", month: "2026-04", language: "go", entry: "bug", licence: "MIT", digest },
    ]);
    expect(f.counts.drops_by_gate).toMatchObject({ exclusion: 2, licence: 3, harness_screen: 1, told: 1, image_digest: 1 });
    expect(f.counts).toMatchObject({ rows: 11, in_window: 10, eligible: 2, by_entry: { bug: 1, feature: 1 } });
    expect(() => screenFrame(p, [cand("nolic__x-1", "nolic/x")], rows, licences)).toThrow(/^E_H2H_O_LICENCE /);
  });
});

const frame = (n: number, o: { prefix?: string; perRepo?: number; feature?: (k: number) => boolean } = {}): DrawUnit[] =>
  Array.from({ length: n }, (_, k) => ({ id: (o.prefix ?? "u") + String(k).padStart(4, "0"), repo: (o.prefix ?? "r") + "/" + Math.floor(k / (o.perRepo ?? 1)), month: k % 3 ? "2026-04" : "2026-07", entry: o.feature?.(k) ? "feature" : "bug" }));
const pass: Gate = { name: "ok", check: () => ({ ok: true }) };

describe("h2h draw", () => {
  test("the seeded order walks months newest first and is fixed by draw_seed", () => {
    const f = frame(30);
    const a = seededOrder(f, p.draw_seed), b = seededOrder([...f].reverse(), p.draw_seed);
    expect(a.map((u) => u.id)).toEqual(b.map((u) => u.id));
    expect(a.slice(0, 10).every((u) => u.month === "2026-07")).toBe(true);
    expect(seededOrder(f, p.draw_seed + 1).map((u) => u.id)).not.toEqual(a.map((u) => u.id));
    expect(() => seededOrder([...f, f[0]!], p.draw_seed)).toThrow(/^E_H2H_DRAW_INPUT /);
  });

  test("O takes its stage 1 positions, 100 for stage 2, 10 reserves, then a bug and a feature unit for stage 0", () => {
    const order = seededOrder(frame(200, { feature: (k) => k % 7 === 0 }), p.draw_seed);
    const w = walk("O", p.draw_seed, order, [pass], planFor(p, "O"), p.classes.O.repo_cap);
    expect(w.short).toBeNull();
    const at = (s: string) => w.units.filter((u) => u.stage === s);
    expect(at("stage1").map((u) => u.position)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    expect(at("stage2")).toHaveLength(100);
    expect(at("reserve")).toHaveLength(10);
    expect(at("stage0").map((u) => u.entry).sort()).toEqual(["bug", "feature"]);
    expect(Math.min(...at("stage0").map((u) => u.position))).toBeGreaterThan(Math.max(...at("reserve").map((u) => u.position)));
  });

  test("the repository cap skips a fourth unit unasked, a pending gate stops the walk, and a short frame says so", () => {
    const asked: string[] = [];
    const spy: Gate = { name: "spy", check: (id) => (asked.push(id), { ok: true }) };
    const w = walk("O", p.draw_seed, frame(12, { perRepo: 6 }), [spy], planFor(p, "O"), 3);
    expect(w.capped).toHaveLength(6);
    expect(asked).toHaveLength(6);
    expect(w.short).not.toBeNull();
    const stop: Gate = { name: "oracle", check: (id) => (id === "u0003" ? { pending: true, why: "no oracle record" } : { ok: true }) };
    expect(walk("O", p.draw_seed, frame(10), [stop], planFor(p, "O"), 3).pending).toEqual({ id: "u0003", gate: "oracle", why: "no oracle record" });
    const drop: Gate = { name: "image", check: (id) => (id === "u0001" ? { ok: false, code: "E_H2H_DRAW_ORACLE", reason: "flaky" } : { ok: true }) };
    expect(walk("O", p.draw_seed, frame(5), [drop], planFor(p, "O"), 3).drops).toEqual([{ id: "u0001", gate: "image", code: "E_H2H_DRAW_ORACLE", reason: "flaky" }]);
  });

  test("B takes positions 6 to 36 in each frame, shrinks a short B1 and goes B2 alone under 20 usable B1 units", () => {
    const b2 = seededOrder(frame(200, { prefix: "b" }), p.draw_seed);
    const full = drawB(p, p.draw_seed, seededOrder(frame(80, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(full).toMatchObject({ b1_feasible: true, n_b1: 30, n_b2: 30 });
    expect(full.b1.units.filter((u) => u.stage === "stage1").map((u) => u.position)).toEqual([6, 12, 18, 24, 30, 36]);
    expect(full.b2!.units.filter((u) => u.stage === "stage1").map((u) => u.position)).toEqual([6, 12, 18, 24, 30, 36]);
    const short = drawB(p, p.draw_seed, seededOrder(frame(40, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(short.b1_feasible).toBe(true);
    expect(short.n_b1).toBeLessThan(30);
    expect(short.b1.short).toBeNull();
    expect(short.n_b1 + short.n_b2).toBe(60);
    const none = drawB(p, p.draw_seed, seededOrder(frame(15, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(none).toMatchObject({ b1_feasible: false, n_b1: 0, n_b2: 60 });
    const shared = drawB(p, p.draw_seed, seededOrder(frame(80, { prefix: "s", perRepo: 2 }), p.draw_seed), seededOrder(frame(80, { prefix: "s", perRepo: 2 }).map((u) => ({ ...u, id: "t" + u.id })), p.draw_seed), [pass], [pass]);
    expect(shared.b2!.capped.length).toBeGreaterThan(0);
  });

  test("reserves replace units that drop before any run, and stage 0 takes a reserve with its tag", () => {
    const w = walk("O", p.draw_seed, seededOrder(frame(200, { feature: (k) => k % 3 === 1 }), p.draw_seed), [pass], planFor(p, "O"), 3);
    const reserves = w.units.filter((u) => u.stage === "reserve");
    const s2 = w.units.find((u) => u.stage === "stage2")!;
    const feat = w.units.find((u) => u.stage === "stage0" && u.entry === "feature")!;
    const firstFeature = reserves.slice(1).find((u) => u.entry === "feature")!;
    const r = replaceDropped(w, new Set([s2.id, feat.id]));
    expect(r.unreplaced).toEqual([]);
    expect(r.units.find((u) => u.replaces === s2.id)).toMatchObject({ id: reserves[0]!.id, stage: "stage2" });
    expect(r.units.find((u) => u.replaces === feat.id)).toMatchObject({ id: firstFeature.id, stage: "stage0", entry: "feature" });
    expect(r.units.some((u) => u.id === s2.id || u.id === feat.id)).toBe(false);
    const all = replaceDropped(w, new Set(w.units.filter((u) => u.stage === "stage2").slice(0, 11).map((u) => u.id)));
    expect(all.unreplaced).toHaveLength(1);
  });
});

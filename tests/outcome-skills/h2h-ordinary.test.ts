// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { excludedBy, finishFrame, licenceVerdict, screenFrame, type LicenceRead, type RowText, type SecondRead } from "../../lanes/outcome-skills/h2h/ordinary/frame.ts";
import { b1Futility, b1Positions, b2AloneStage1, cpUpper, drawB, planFor, replaceDropped, seededOrder, walk, walkB1, type DrawUnit, type Drawn, type Gate } from "../../lanes/outcome-skills/h2h/ordinary/draw.ts";
import { classifyLicenceFiles, classifyLicenceText, compileTemplate, loadTemplates, normaliseLicence, readLicenceFilesGraphQl, type GraphQl, type Templates } from "../../lanes/outcome-skills/h2h/ordinary/licences.ts";
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
const file = (name: string, match: string | null) => ({ name, mode: 33188, git_oid: "0".repeat(40), bytes: 10, sha256: "a".repeat(64), match });
const second: SecondRead = {
  read_at: "2026-11-15T00:00:00Z", rule: "r", templates: { source: "s", tag: "t", commit: "c", sha256: {} },
  repos: {
    "dual/one": { head: "h", eligible: true, reason: "matched", files: [file("LICENSE-MIT", "MIT"), file("LICENSE-APACHE", "Apache-2.0")] },
    "nofile/one": { head: "h", eligible: false, reason: "no_file", files: [] },
    "mixed/one": { head: "h", eligible: false, reason: "unmatched", files: [file("LICENSE", "MIT"), file("COPYING", null)] },
  },
};
const licences: LicenceRead = {
  schema: "h2h-o-licences.v1", read_at: "2026-11-15T00:00:00Z", query: "q",
  repos: {
    "good/one": { spdx: "MIT", name_with_owner: "good/one" }, "good/feat": { spdx: "Apache-2.0", name_with_owner: "good/feat" }, "gpl/one": { spdx: "GPL-3.0", name_with_owner: "gpl/one" },
    "dual/one": { spdx: "NOASSERTION", name_with_owner: "dual/one" }, "nofile/one": { spdx: null, name_with_owner: "nofile/one" }, "mixed/one": { spdx: "NOASSERTION", name_with_owner: "mixed/one" },
    "zero/one": { spdx: "MIT-0", name_with_owner: "zero/one" }, "moved/old": { spdx: "MIT", name_with_owner: "gsd-build/new" },
    "wide/one": { spdx: "MIT", name_with_owner: "wide/one" }, "told/one": { spdx: "MIT", name_with_owner: "told/one" }, "img/one": { spdx: "MIT", name_with_owner: "img/one" },
  },
  second_read: second,
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
      cand("gsd__x-1", "gsd-build/x"), cand("moved__old-1", "moved/old"), cand("gpl__one-1", "gpl/one"), cand("dual__one-1", "dual/one"), cand("nofile__one-1", "nofile/one"),
      cand("mixed__one-1", "mixed/one"), cand("zero__one-1", "zero/one"), cand("wide__one-1", "wide/one", { fix_source_files: 7 }), cand("told__one-1", "told/one"), cand("img__one-1", "img/one"),
    ];
    const rows = new Map<string, RowText>(cands.map((c) => [c.id, { problem_statement: c.id === "told__one-1" ? ISSUE + "\n@@ -1,2 +1,2 @@\n" : ISSUE, patch: "+x\n" }]));
    const s = screenFrame(p, cands, rows, licences);
    expect(s.inWindow).toBe(12);
    expect(s.drops.map((d) => [d.id, d.gate, d.code, d.rule])).toEqual([
      ["gpl__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "GPL-3.0"],
      ["gsd__x-1", "exclusion", "E_H2H_O_EXCLUDED", "gsd-build/*"],
      ["mixed__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "NOASSERTION:unmatched"],
      ["moved__old-1", "exclusion", "E_H2H_O_EXCLUDED", "gsd-build/*"],
      ["nofile__one-1", "licence", "E_H2H_O_NOT_PERMISSIVE", "none:no_file"],
      ["told__one-1", "told", "E_H2H_O_TOLD", "diff_block"],
      ["wide__one-1", "harness_screen", "E_SM_INELIGIBLE", "fix_source_files_1_to_6"],
    ]);
    expect(s.survivors.map((c) => c.id)).toEqual(["dual__one-1", "good__feat-1", "good__one-1", "img__one-1", "zero__one-1"]);
    const digest = "sha256:" + "d".repeat(64);
    const f = finishFrame(p, { cands, screened: s, digests: new Map([["good__one-1", digest], ["good__feat-1", digest], ["dual__one-1", digest], ["zero__one-1", digest], ["img__one-1", null]]), licences, licencesText: "{}", head: { sha: "h", last_modified: null, read_at: "t" }, dataset: "d", revision: "r", freezeDate: "2026-11-15" });
    expect(f.units).toEqual([
      { id: "dual__one-1", repo: "dual/one", month: "2026-04", language: "go", entry: "bug", licence: "Apache-2.0 AND MIT", licence_from: "files", digest },
      { id: "good__feat-1", repo: "good/feat", month: "2026-04", language: "go", entry: "feature", licence: "Apache-2.0", licence_from: "graphql", digest },
      { id: "good__one-1", repo: "good/one", month: "2026-04", language: "go", entry: "bug", licence: "MIT", licence_from: "graphql", digest },
      { id: "zero__one-1", repo: "zero/one", month: "2026-04", language: "go", entry: "bug", licence: "MIT-0", licence_from: "graphql", digest },
    ]);
    expect(f.counts.drops_by_gate).toMatchObject({ exclusion: 2, licence: 3, harness_screen: 1, told: 1, image_digest: 1 });
    expect(f.counts).toMatchObject({ rows: 13, in_window: 12, eligible: 4, by_entry: { bug: 3, feature: 1 }, licence_second_read: { repos: 3, eligible_repos: 1, eligible_units: 1 } });
    expect(() => screenFrame(p, [cand("nolic__x-1", "nolic/x")], rows, licences)).toThrow(/^E_H2H_O_LICENCE /);
    const { second_read: _, ...firstOnly } = licences;
    expect(() => licenceVerdict("dual/one", firstOnly, p.licences)).toThrow(/^E_H2H_O_LICENCE .*second licence read/);
    expect(licenceVerdict("good/one", firstOnly, p.licences)).toEqual({ ok: true, licence: "MIT", from: "graphql" });
  });
});

const TEMPLATE = `<<beginOptional>>Toy Licence

<<endOptional>> <<var;name="copyright";original="Copyright <year> <holder>";match=".{0,40}">>
Permission is granted to use this "Software" for any purpose<<beginOptional>>, commercial or not<<endOptional>>.
THE SOFTWARE IS PROVIDED AS IS, AND <<var;name="author";original="THE AUTHOR";match=".+">> IS NOT LIABLE. See https://example.org/toy.`;
const toy = (): Templates => ({ order: ["Toy", "Other"], patterns: new Map([["Toy", compileTemplate(TEMPLATE)], ["Other", compileTemplate("A different licence text entirely.")]]) });

describe("h2h licence second read", () => {
  test("the frozen rule normalises case, punctuation, spelling and https, and matches the whole file", () => {
    expect(normaliseLicence("The LICENCE, (c) 2026 -- see https://x.org/")).toBe("the license c 2026 see http x org");
    const t = toy();
    expect(classifyLicenceText("Copyright 2026 Jane Roe\nPermission is granted to use this \u201cSoftware\u201d for any purpose.\nThe software is provided as is, and Jane Roe is not liable. See http://example.org/toy.", t)).toBe("Toy");
    expect(classifyLicenceText("TOY LICENCE\n\nCopyright 2026 X\n\nPermission  is granted to use this 'Software' for any purpose, commercial or not.\nTHE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy", t)).toBe("Toy");
    expect(classifyLicenceText("Copyright 2026 X\nPermission is granted to use this Software for any purpose.\nTHE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy.\nExcept files under vendor/, which are GPL.", t)).toBeNull();
    expect(classifyLicenceText("Copyright " + "x".repeat(60) + "\nPermission is granted to use this Software for any purpose. THE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy", t)).toBeNull();
    expect(classifyLicenceText("Permission is granted to use this Software for every purpose. THE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy", t)).toBeNull();
    expect(classifyLicenceText(null, t)).toBeNull();
    expect(classifyLicenceText("a different licence text entirely", t)).toBe("Other");
  });

  test("a near miss against a template with many slots fails fast, and the same template still matches", () => {
    const many = compileTemplate(Array.from({ length: 10 }, () => '<<var;name="v";original="";match=".+">> word').join(" ") + " end");
    const start = performance.now();
    expect(many.test("word ".repeat(200) + "nope")).toBe(false);
    expect(many.test("word ".repeat(200) + "end")).toBe(true);
    // gstack-timing-ok: the bound is the contract; it guards the licence classifier against catastrophic backtracking
    expect(performance.now() - start).toBeLessThan(2000);
  });

  test("a repository passes only when it has a licence file and every licence file matches a listed licence", () => {
    const t = toy();
    const ok = "Permission is granted to use this Software for any purpose. THE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy";
    expect(classifyLicenceFiles([{ name: "README.md", text: ok }], t)).toEqual({ eligible: false, reason: "no_file", matches: [] });
    expect(classifyLicenceFiles([{ name: "LICENSE-TOY", text: ok }, { name: "licence.md", text: "a different licence text entirely" }, { name: "README.md", text: "x" }], t)).toEqual({ eligible: true, reason: "matched", matches: ["Toy", "Other"] });
    expect(classifyLicenceFiles([{ name: "LICENSE", text: ok }, { name: "COPYING.LESSER", text: "GNU LESSER GENERAL PUBLIC LICENSE" }], t)).toEqual({ eligible: false, reason: "unmatched", matches: ["Toy", null] });
  });

  test("the second read lists root licence blobs, reads their text by blob id and records each match", () => {
    const t = toy();
    const ok = "Permission is granted to use this Software for any purpose. THE SOFTWARE IS PROVIDED AS IS, AND X IS NOT LIABLE. See https://example.org/toy";
    const queries: string[] = [];
    const call: GraphQl = (q) => {
      queries.push(q);
      if (q.includes("defaultBranchRef")) {
        const entries = [{ name: "LICENSE-TOY", type: "blob", mode: 33188, oid: "a1" }, { name: "LICENSES", type: "tree", mode: 16384, oid: "a2" }, { name: "README.md", type: "blob", mode: 33188, oid: "a3" }, { name: "COPYING", type: "blob", mode: 33188, oid: "a4" }];
        return { status: 0, stderr: "", stdout: JSON.stringify({ data: { r0: { defaultBranchRef: { target: { oid: "c".repeat(40), tree: { entries } } } }, r1: null }, errors: [{ type: "NOT_FOUND", message: "gone" }] }) };
      }
      return { status: 0, stderr: "", stdout: JSON.stringify({ data: { b0: { object: { text: null, isBinary: true, isTruncated: false, byteSize: 9 } }, b1: { object: { text: ok, isBinary: false, isTruncated: false, byteSize: ok.length } } } }) };
    };
    const r = readLicenceFilesGraphQl(["a/one", "b/gone"], t, new Date("2026-11-15T06:00:00Z"), call);
    expect(queries[1]).toContain('object(oid: "a1")');
    expect(queries[1]).toContain('object(oid: "a4")');
    expect(queries[1]).not.toContain('"a3"');
    expect(r.repos["a/one"]).toMatchObject({ head: "c".repeat(40), eligible: false, reason: "unmatched", files: [{ name: "COPYING", git_oid: "a4", sha256: null, match: null }, { name: "LICENSE-TOY", git_oid: "a1", bytes: ok.length, match: "Toy" }] });
    expect(r.repos["b/gone"]).toEqual({ head: null, eligible: false, reason: "no_file", files: [] });
    expect(r.read_at).toBe("2026-11-15T06:00:00.000Z");
    expect(() => readLicenceFilesGraphQl(["a/one"], t, new Date(), () => ({ status: 0, stderr: "", stdout: JSON.stringify({ data: {}, errors: [{ type: "RATE_LIMITED" }] }) }))).toThrow(/^E_H2H_O_LICENCE /);
  });

  test("templates load only at their pinned digests", () => {
    const d = mkdtempSync(join(tmpdir(), "h2h-spdx-"));
    writeFileSync(join(d, "MIT.template.txt"), "not the template");
    expect(() => loadTemplates(d, ["MIT"])).toThrow(/^E_H2H_O_LICENCE .*pinned/);
    expect(() => loadTemplates(d, ["GPL-3.0"])).toThrow(/^E_H2H_O_LICENCE .*no pinned/);
    expect(() => loadTemplates(d, ["ISC"])).toThrow(/^E_H2H_O_LICENCE .*missing/);
  });
});

const frame = (n: number, o: { prefix?: string; perRepo?: number; feature?: (k: number) => boolean } = {}): DrawUnit[] =>
  Array.from({ length: n }, (_, k) => ({ id: (o.prefix ?? "u") + String(k).padStart(4, "0"), repo: (o.prefix ?? "r") + "/" + Math.floor(k / (o.perRepo ?? 1)), month: k % 3 ? "2026-04" : "2026-07", entry: o.feature?.(k) ? "feature" : "bug" }));
const pass: Gate = { name: "ok", check: () => ({ ok: true }) };
const at = (units: readonly Drawn[], s: string) => units.filter((u) => u.stage === s && !u.full_size);
/** No unit appears twice and no position holds two units. */
const oneStageEach = (units: readonly Drawn[]) => {
  expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
  expect(new Set(units.map((u) => u.position)).size).toBe(units.length);
};

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
    expect(at(w.units, "stage1").map((u) => u.position)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    expect(at(w.units, "stage2")).toHaveLength(100);
    expect(at(w.units, "reserve")).toHaveLength(10);
    expect(at(w.units, "stage0").map((u) => u.entry).sort()).toEqual(["bug", "feature"]);
    expect(Math.min(...at(w.units, "stage0").map((u) => u.position))).toBeGreaterThan(Math.max(...at(w.units, "reserve").map((u) => u.position)));
    oneStageEach(w.units);
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

  test("B1's positions come from its usable count: stage 1 at round(kN/7), stage 0 at N, reserves the last 5 free before N", () => {
    expect(b1Positions(40, 30, 5)).toEqual({ stage1: [6, 11, 17, 23, 29, 34], stage0: [40], reserve: [35, 36, 37, 38, 39], stage2: [1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 30, 31, 32, 33] });
    expect(b1Positions(32, 30, 5)).toMatchObject({ stage1: [5, 9, 14, 18, 23, 27], stage0: [32], reserve: [26, 28, 29, 30, 31] });
    expect(b1Positions(32, 30, 5).stage2).toHaveLength(20);
    expect(b1Positions(31, 30, 5).stage2).toHaveLength(19);
    const big = b1Positions(100, 30, 5);
    expect(big.stage2).toHaveLength(30);
    expect(big.reserve).toEqual([95, 96, 97, 98, 99]);
    expect(Math.max(...big.stage2)).toBeLessThan(95);
  });

  test("B1 walks its whole frame, caps each repository at 3 usable units, and assigns every role once", () => {
    const asked: string[] = [];
    const spy: Gate = { name: "spy", check: (id) => (asked.push(id), id.endsWith("7") ? { ok: false, code: "E_X", reason: "drop" } : { ok: true }) };
    const w = walkB1(p, p.draw_seed, seededOrder(frame(60, { prefix: "a", perRepo: 4 }), p.draw_seed), [spy], 30);
    expect(w.capped).toHaveLength(asked.length === 60 ? 0 : 60 - asked.length);
    expect(w.capped.length).toBeGreaterThan(0);
    expect(w.usable).toBe(asked.length - w.drops.length);
    const pos = b1Positions(w.usable, 30, 5);
    expect(at(w.units, "stage1").map((u) => u.position)).toEqual(pos.stage1);
    expect(at(w.units, "stage0").map((u) => u.position)).toEqual([w.usable]);
    expect(at(w.units, "reserve").map((u) => u.position)).toEqual(pos.reserve);
    expect(at(w.units, "stage2").map((u) => u.position)).toEqual(pos.stage2);
    const held = new Map<string, number>();
    for (const u of w.units) held.set(u.repo, (held.get(u.repo) ?? 0) + 1);
    expect(Math.max(...held.values())).toBeLessThanOrEqual(3);
    oneStageEach(w.units);
  });

  test("B is usable from 20 B1 stage 2 units, waits for the fallbacks under that, then reads on B2 alone", () => {
    const b2 = seededOrder(frame(200, { prefix: "b" }), p.draw_seed);
    const full = drawB(p, p.draw_seed, seededOrder(frame(80, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(full).toMatchObject({ b1_status: "usable", b1_feasible: true, n_b1: 30, n_b2: 30 });
    expect(at(full.b2!.units, "stage1").map((u) => u.position)).toEqual([6, 12, 18, 24, 30, 36]);
    expect(at(full.b2!.units, "stage2")).toHaveLength(30);
    expect(at(full.b1.units, "stage0").map((u) => u.position)).toEqual([80]);
    const edge = drawB(p, p.draw_seed, seededOrder(frame(32, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(edge).toMatchObject({ b1_status: "usable", n_b1: 20, n_b2: 40 });
    const short = drawB(p, p.draw_seed, seededOrder(frame(31, { prefix: "a" }), p.draw_seed), b2, [pass], [pass]);
    expect(short).toMatchObject({ b1_status: "fallbacks_due", b1_feasible: null, b2: null, n_b1: 19 });
    const none = drawB(p, p.draw_seed, seededOrder(frame(31, { prefix: "a" }), p.draw_seed), b2, [pass], [pass], { fallbacksDone: true });
    expect(none).toMatchObject({ b1_status: "infeasible", b1_feasible: false, n_b1: 0, n_b2: 60 });
    expect(none.b1.units).toEqual([]);
    expect(none.b1.passed_unassigned).toHaveLength(31);
    expect(at(none.b2!.units, "stage2")).toHaveLength(60);
    const pending: Gate = { name: "label", check: (id) => (id === "a0005" ? { pending: true, why: "no label" } : { ok: true }) };
    expect(drawB(p, p.draw_seed, seededOrder(frame(40, { prefix: "a" }), p.draw_seed), b2, [pending], [pass])).toMatchObject({ b1_status: null, b2: null });
  });

  test("B1's futility stop uses the one-sided 95% Clopper-Pearson bound and, with no pass in a 1,822-row frame, fires at 156 answered rows", () => {
    expect(cpUpper(0, 156, 0.95)).toBeCloseTo(1 - Math.pow(0.05, 1 / 156), 10);
    const k = 50, u = 3, b = cpUpper(u, k, 0.95);
    let cdf = 0;
    for (let i = 0; i <= u; i++) {
      let c = 0;
      for (let j = 1; j <= i; j++) c += Math.log(k - i + j) - Math.log(j);
      cdf += Math.exp(c + i * Math.log(b) + (k - i) * Math.log1p(-b));
    }
    expect(cdf).toBeCloseTo(0.05, 9);
    expect(cpUpper(5, 5, 0.95)).toBe(1);
    expect(() => cpUpper(6, 5, 0.95)).toThrow(/^E_H2H_DRAW_INPUT /);
    const order = seededOrder(frame(1822, { prefix: "a", perRepo: 12 }), p.draw_seed);
    const answered = (n: number): Gate => {
      const done = new Set(order.slice(0, n).map((x) => x.id));
      return { name: "build", check: (id) => (done.has(id) ? { ok: false, code: "E_H2H_B_NO_TESTS", reason: "no_fail_to_pass" } : { pending: true, why: "no build result" }) };
    };
    expect(b1Futility(p, order, [answered(155)])).toMatchObject({ k: 155, u: 0, left: 1667, multilang: 8, floor: 32, fired: false });
    const f = b1Futility(p, order, [answered(156)]);
    expect(f).toMatchObject({ k: 156, u: 0, left: 1666, multilang: 8, floor: 32, fired: true, usable_ids: [] });
    expect(f.projected).toBeCloseTo(1674 * (1 - Math.pow(0.05, 1 / 156)), 9);
    expect(b1Futility(p, order, [answered(0)])).toMatchObject({ k: 0, u95: 1, fired: false });
    const many: Gate = { name: "build", check: () => ({ ok: true }) };
    expect(b1Futility(p, order.slice(0, 40), [many])).toMatchObject({ u: 40, fired: false });
  });

  test("an infeasible B1 gives B2 all 12 B stage 1 slots at 6, 12, ..., 72; a feasible B1 or an unfired stop leaves the merged draw", () => {
    expect(b2AloneStage1([6, 12, 18, 24, 30, 36], 12)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
    expect(() => b2AloneStage1([6, 12, 20], 12)).toThrow(/^E_H2H_PREREG /);
    const b1 = seededOrder(frame(200, { prefix: "a" }), p.draw_seed);
    const b2 = seededOrder(frame(300, { prefix: "b" }), p.draw_seed);
    const pending: Gate = { name: "build", check: (id) => (id === b1[3]!.id ? { pending: true, why: "no build result" } : { ok: false, code: "E_H2H_B_NO_TESTS", reason: "no_fail_to_pass" }) };
    const stop = b1Futility(p, b1, [{ name: "build", check: () => ({ ok: false, code: "E_H2H_B_NO_TESTS", reason: "no_fail_to_pass" }) }]);
    expect(stop).toMatchObject({ k: 200, u: 0, left: 0, fired: true });
    for (const d of [drawB(p, p.draw_seed, b1, b2, [pending], [pass], { futility: stop }), drawB(p, p.draw_seed, seededOrder(frame(31, { prefix: "a" }), p.draw_seed), b2, [pass], [pass], { fallbacksDone: true })]) {
      expect(d).toMatchObject({ b1_status: "infeasible", b1_feasible: false, n_b1: 0, n_b2: 60 });
      expect(d.b1.units).toEqual([]);
      expect(d.b1.pending).toBeNull();
      expect(at(d.b2!.units, "stage1").map((u) => u.position)).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
      expect(at(d.b2!.units, "stage2")).toHaveLength(60);
      expect(at(d.b2!.units, "reserve")).toHaveLength(5);
      expect(at(d.b2!.units, "stage0")).toHaveLength(1);
      expect(at(d.b2!.units, "stage0")[0]!.position).toBeGreaterThan(Math.max(...at(d.b2!.units, "reserve").map((u) => u.position)));
      expect(d.b2!.short).toBeNull();
      oneStageEach(d.b2!.units);
    }
    expect(drawB(p, p.draw_seed, b1, b2, [pending], [pass], { futility: { ...stop, fired: false } })).toMatchObject({ b1_status: null, b2: null, b1_futility: { fired: false } });
    const usable = seededOrder(frame(80, { prefix: "a" }), p.draw_seed);
    const merged = drawB(p, p.draw_seed, usable, b2, [pass], [pass]);
    const withStop = drawB(p, p.draw_seed, usable, b2, [pass], [pass], { futility: b1Futility(p, usable, [pass]) });
    expect(merged.b1_futility).toBeNull();
    expect({ ...withStop, b1_futility: merged.b1_futility }).toEqual(merged);
    expect(at(merged.b2!.units, "stage1").map((u) => u.position)).toEqual([6, 12, 18, 24, 30, 36]);
  });

  test("the repository cap counts B1's drawn units in B2", () => {
    const b1 = seededOrder(frame(80, { prefix: "s", perRepo: 3 }), p.draw_seed);
    const b2 = seededOrder(frame(160, { prefix: "s", perRepo: 3 }).map((u) => ({ ...u, id: "t" + u.id })), p.draw_seed);
    const d = drawB(p, p.draw_seed, b1, b2, [pass], [pass]);
    const held = new Map<string, number>();
    for (const u of [...d.b1.units, ...d.b2!.units]) held.set(u.repo, (held.get(u.repo) ?? 0) + 1);
    expect(Math.max(...held.values())).toBeLessThanOrEqual(3);
    expect(d.b2!.capped.length).toBeGreaterThan(0);
  });

  test("full size adds units at the next positions after stage 0's, in every frame, and no unit lands in two stages", () => {
    const order = seededOrder(frame(400, { feature: (k) => k % 9 === 4 }), p.draw_seed);
    const core = walk("O", p.draw_seed, order, [pass], planFor(p, "O"), 3);
    const big = walk("O", p.draw_seed, order, [pass], planFor(p, "O", 100, 50), 3);
    expect(big.short).toBeNull();
    oneStageEach(big.units);
    const added = big.units.filter((u) => u.full_size);
    expect(added).toHaveLength(50);
    expect(added.every((u) => u.stage === "stage2")).toBe(true);
    expect(Math.min(...added.map((u) => u.position))).toBeGreaterThan(Math.max(...at(big.units, "stage0").map((u) => u.position)));
    expect(big.units.filter((u) => !u.full_size)).toEqual(core.units);
    const b2 = seededOrder(frame(300, { prefix: "b" }), p.draw_seed);
    const b1 = seededOrder(frame(80, { prefix: "a" }), p.draw_seed);
    const coreB = drawB(p, p.draw_seed, b1, b2, [pass], [pass]);
    const bigB = drawB(p, p.draw_seed, b1, b2, [pass], [pass], { fullSize: 80 });
    expect(bigB.full_size).toEqual({ n: 80, b1_added: 0, b2_added: 20 });
    expect(bigB.b1.units).toEqual(coreB.b1.units);
    const b2Added = bigB.b2!.units.filter((u) => u.full_size);
    expect(b2Added).toHaveLength(20);
    expect(Math.min(...b2Added.map((u) => u.position))).toBeGreaterThan(Math.max(...at(bigB.b2!.units, "stage0").map((u) => u.position)));
    expect(bigB.b2!.units.filter((u) => !u.full_size)).toEqual(coreB.b2!.units);
    oneStageEach(bigB.b2!.units);
    const ids = [...bigB.b1.units, ...bigB.b2!.units].map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => drawB(p, p.draw_seed, b1, b2, [pass], [pass], { fullSize: 50 })).toThrow(/^E_H2H_DRAW_INPUT /);
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
    const b1 = walkB1(p, p.draw_seed, seededOrder(frame(40, { prefix: "a" }), p.draw_seed), [pass], 30);
    const lost = at(b1.units, "stage1")[0]!;
    expect(replaceDropped(b1, new Set([lost.id])).units.find((u) => u.replaces === lost.id)).toMatchObject({ position: 35, stage: "stage1" });
  });
});

// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Change } from "../../lanes/real-outcome/mine/changes.ts";
import { erClass, functionAt, kindOf, licenceText, mineClone, planTexts, strictBR, withPlans, type Candidate, type MineResult } from "../../lanes/eng-review/author/mine.ts";
import { MIT } from "../real/fixture.ts";
import { buildShop, DISCOUNT_1 } from "./shop-fixture.ts";

let shop: ReturnType<typeof buildShop>;
let r: MineResult;
const by = (name: string): Candidate => r.candidates.find((c) => c.change === shop.sha[name])!;

beforeAll(() => {
  shop = buildShop();
  r = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
});
afterAll(() => shop.cleanup());

const change = (title: string, files: string[], labels: string[] = []): Change => ({ id: "x", parent: "p", commits: [], merged_at: "2026-07-02T00:00:00Z", subject: title, body: "Fixes #3", files: files.map((path) => ({ path, status: "M", added: 50, deleted: 0, binary: false, cls: erClass(path) })), pr: labels.length ? { number: 1, title, body: "", created_at: "2026-07-01T00:00:00Z", merged_at: "2026-07-02T00:00:00Z", merge_commit: "x", labels, closing_issues: [], commits: [] } : null, closing: [], issues: [], exposure: { at: "2026-07-01T00:00:00Z", source: "commit", ref: "x", complete: true, missing: [], parts: [] } });

describe("paths and kinds (section 4)", () => {
  test("source and tests widen to mobile languages; CI files are never source", () => {
    expect(erClass("app/src/main/kotlin/shop/Cart.kt")).toBe("source");
    expect(erClass("app/src/test/kotlin/shop/CartTest.kt")).toBe("test");
    expect(erClass("ios/ShopTests/CartTests.swift")).toBe("test");
    expect(erClass("ios/Shop/Cart.swift")).toBe("source");
    expect(erClass("lib/cart_test.dart")).toBe("test");
    expect(erClass("Podfile.lock")).toBe("lockfile");
    expect(erClass(".github/workflows/ci.yml")).toBe("other");
    expect(erClass("docs/guide.md")).toBe("other");
  });
  test("a feature reads as a feature; fixes, reverts, docs, chores, dependency, release and CI-only changes do not", () => {
    const src = ["a/Cart.kt", "a/Pay.kt"];
    expect(kindOf(change("Add discount codes", src), false)).toBe("feature");
    expect(kindOf(change("feat(cart): discount codes", src), false)).toBe("feature");
    expect(kindOf(change("Add discount codes", src), true)).toBe("revert");
    expect(kindOf(change("fix: rounding", src), false)).toBe("fix");
    expect(kindOf(change("Handle crash on empty cart", src), false)).toBe("fix");
    expect(kindOf(change("Add discount codes", src, ["bug"]), false)).toBe("fix");
    expect(kindOf(change("Refactor the cart", src), false)).toBe("chore");
    expect(kindOf(change("perf: faster totals", src), false)).toBe("chore");
    expect(kindOf(change("Bump okhttp to 5.1", src), false)).toBe("dependency");
    expect(kindOf(change("Release 2.4.0", src), false)).toBe("release");
    expect(kindOf(change("Update the guide", ["docs/a.md"]), false)).toBe("docs");
    expect(kindOf(change("Speed up the pipeline", [".github/workflows/ci.yml"]), false)).toBe("ci");
    expect(kindOf(change("Pin versions", ["Gemfile", "Gemfile.lock"]), false)).toBe("dependency");
  });
  test("the body's closing keyword never makes a feature a fix", () => {
    expect(kindOf(change("Add discount codes", ["a/Cart.kt", "a/Pay.kt"]), false)).toBe("feature");
  });
  test("licence texts", () => {
    expect(licenceText(MIT)).toBe("MIT");
    expect(licenceText("Apache License\nVersion 2.0, January 2004")).toBe("Apache-2.0");
    expect(licenceText("GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007")).toBe("GPL-3.0");
    expect(licenceText("GNU GENERAL PUBLIC LICENSE Version 2, June 1991")).toBe("GPL-2.0");
    expect(licenceText("GNU LESSER GENERAL PUBLIC LICENSE Version 2.1")).toBe("LGPL-2.1");
    expect(licenceText("GNU AFFERO GENERAL PUBLIC LICENSE Version 3")).toBe("AGPL-3.0");
    expect(licenceText("Mozilla Public License Version 2.0")).toBe("MPL-2.0");
    expect(licenceText("Redistribution and use in source and binary forms ... Neither the name of")).toBe("BSD-3-Clause");
    expect(licenceText("Redistribution and use in source and binary forms, with or without")).toBe("BSD-2-Clause");
    expect(licenceText("All rights reserved.")).toBeNull();
  });
});

describe("mining the shop fixture", () => {
  test("only changes merged 2026-07-01 to 2026-09-30 are candidates", () => {
    expect(by("early")).toBeUndefined();
    expect(by("u1")).toBeDefined();
    expect(by("u4")).toBeDefined();
  });
  test("the feature unit is eligible, wave 1, with its window closed by the mining date", () => {
    const u = by("u1");
    expect(u).toMatchObject({ kind: "feature", eligible: true, wave: 1, window_open: false, pr: 10, source_files: 2, language: "Kotlin", test_files: ["app/src/test/kotlin/shop/CartTest.kt"] });
    expect(u.window_closes).toBe("2026-09-08T10:00:00.000Z");
    expect(u.exposed_at).toBe("2026-07-05T10:00:00.000Z");
  });
  test("SZZ: the later fix's edited line blames to the unit, with its file and function", () => {
    const b = by("u1").aftermath.filter((x) => x.kind === "B");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ change: shop.sha.fix, blamed_lines: 1, pr: 12 });
    expect(b[0]!.sites).toEqual([{ file: "app/src/main/kotlin/shop/Discount.kt", function: "off" }]);
    expect(DISCOUNT_1).toContain("fun off");
    expect(functionAt(["class A {", "    fun total(): Int {", "        return 1", "    }"], 3)).toBe("total");
    expect(functionAt(["func (s *Store) Get(k string) string {", "\treturn s.m[k]"], 2)).toBe("Get");
    expect(functionAt(["export const load = async (x) => {", "  return x"], 2)).toBe("load");
    expect(functionAt(["public static int size(List a) {", "  return 0;"], 2)).toBe("size");
    expect(functionAt(["x = 1", "y = 2"], 2)).toBeNull();
    expect(strictBR(by("u1"))).toBe(false);
  });
  test("T: a later test change for the unit's code; C: a CI change that names its paths", () => {
    const kinds = by("u1").aftermath.map((x) => x.kind + ":" + x.pr);
    expect(kinds).toContain("T:13");
    expect(kinds).toContain("C:14");
    expect(kinds).not.toContain("T:12");
  });
  test("R: a defect revert of the unit is in its aftermath and makes it strictly keyable", () => {
    const u = by("u2");
    expect(u.aftermath).toContainEqual(expect.objectContaining({ kind: "R", change: shop.sha.rev, defect: true }));
    expect(strictBR(u)).toBe(true);
    expect(by("rev").kind).toBe("revert");
  });
  test("drops: docs, below size, exposed before the window, project MCP config at base", () => {
    expect(by("docs").reasons).toContain("kind_docs");
    expect(by("small").reasons).toEqual(["below_size"]);
    expect(by("u5").reasons).toContain("exposed_before_window");
    expect(by("u4")).toMatchObject({ wave: 2, window_open: true, eligible: false });
    expect(by("u4").reasons).toContain("claude_config");
    expect(by("fix").reasons).toContain("kind_fix");
  });
  test("a licence that LICENSE at base does not state disagrees", () => {
    const g = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "GPL-3.0", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
    expect(g.candidates.find((c) => c.change === shop.sha.u1)!.reasons).toEqual(["licence_disagrees"]);
  });
  test("a mining date inside the window keeps later aftermath out", () => {
    const early = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-07-31" });
    const u = early.candidates.find((c) => c.change === shop.sha.u1)!;
    expect(u.window_open).toBe(true);
    expect(u.aftermath).toEqual([]);
  });
});

describe("plan text (section 4)", () => {
  const reply = (body: string, edits: unknown, issues: unknown[]) => ({ repository: { p0: { title: "t", body, createdAt: "2026-07-06T00:00:00Z", userContentEdits: edits, closingIssuesReferences: { nodes: issues } } } });
  const issue = (n: number, created: string, body: string, assoc = "NONE") => ({ number: n, title: "i", body, createdAt: created, authorAssociation: assoc, userContentEdits: { totalCount: 0, nodes: [] } });
  test("earliest versions, issues opened before the merge only, HTML comments dropped", () => {
    const q = () => reply("edited later " + "w ".repeat(200), { totalCount: 2, nodes: [{ editedAt: "2026-07-07T00:00:00Z", diff: "first <!-- template text here --> words " + "w ".repeat(60) }, { editedAt: "2026-07-08T00:00:00Z", diff: "x" }] }, [issue(9, "2026-07-05T00:00:00Z", "w ".repeat(58)), issue(30, "2026-07-11T00:00:00Z", "w ".repeat(500), "MEMBER")]);
    const t = planTexts("o/n", [{ pr: 10, merged_at: "2026-07-10T00:00:00Z" }], q).get(10)!;
    expect(t.words).toBe(62 + 58);
    expect(t.issues.map((i) => [i.number, i.user])).toEqual([[9, true]]);
    expect(t.description).not.toContain("template");
  });
  test("an unrecoverable description has no plan text", () => {
    expect(planTexts("o/n", [{ pr: 10, merged_at: "2026-07-10T00:00:00Z" }], () => reply("b", { totalCount: 101, nodes: [] }, [])).get(10)).toBeNull();
  });
  test("the 120-word floor on both sides", () => {
    const at = (n: number) => {
      const res = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
      withPlans(res, () => reply("w ".repeat(n), { totalCount: 0, nodes: [] }, []));
      return res.candidates.find((c) => c.change === shop.sha.u1)!;
    };
    expect(at(120)).toMatchObject({ eligible: true, plan_words: 120 });
    expect(at(119).reasons).toEqual(["plan_under_120_words"]);
  });
  test("a plan that says no behavior change is intended is out of frame; a scoped statement stays in", () => {
    const at = (body: string) => {
      const res = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
      withPlans(res, () => reply(body + " " + "w ".repeat(130), { totalCount: 0, nodes: [] }, []));
      return res.candidates.find((c) => c.change === shop.sha.u1)!;
    };
    expect(at("Pure refactor. No behaviour change is intended.").reasons).toEqual(["no_behavior_change"]);
    expect(at("There is no intended user-facing behavior change.").eligible).toBe(false);
    expect(at("Behavior-preserving, purely mechanical.").eligible).toBe(false);
    expect(at("Adds opt-in signing. Default behaviour is unchanged for existing users.")).toMatchObject({ eligible: true, reasons: [] });
    expect(at("Android only; desktop behavior is unchanged.").eligible).toBe(true);
    expect(at("No behavior change to the limits themselves.").eligible).toBe(true);
    expect(at("No breaking changes.").eligible).toBe(true);
  }, 30_000);
});

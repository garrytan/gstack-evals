// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateOf } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import type { B2Row } from "../../lanes/outcome-skills/h2h/breadth/b2.ts";
import { seededOrder } from "../../lanes/outcome-skills/h2h/ordinary/draw.ts";
import type { H2hPrereg } from "../../lanes/outcome-skills/h2h/prereg.ts";
import { rebuildUnits, usableSuUnits, type RebuildDeps } from "../../lanes/outcome-skills/h2h/ext/rebuild.ts";
import { readSuUnits, suUnitsFrom, SU_UNITS_PATH, type SuInputs, type SuUnit, type SuUnits } from "../../lanes/outcome-skills/h2h/ext/units.ts";

const ROOT = join(import.meta.dir, "..", "..");
const PUB = join(ROOT, "wiki/board/2026-11-19-geva-540-skill-pack-h2h-session-data/units.json");
const BASE = join(ROOT, "wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg");

describe("su-units.json, the units of parts S and P", () => {
  const su = readSuUnits();
  test("holds the head-to-head's 100 O and 60 B2 stage 2 units at their published positions, and 12 and 12 stage 1 units", () => {
    expect(su.counts).toMatchObject({ O_stage2: 100, B2_stage2: 60, O_stage1: 12, B2_stage1: 12 });
    const pub = JSON.parse(readFileSync(PUB, "utf8")) as { id: string; kind: string; position: number; repo: string; licence: string; image_digest: string }[];
    for (const p of pub) {
      const u = su.units.find((x) => x.id === p.id)!;
      expect([u.kind, u.stage, u.position, u.repo, u.licence, u.old.image_digest]).toEqual([p.kind, "stage2", p.position, p.repo, p.licence, p.image_digest]);
    }
    const s1 = (k: string) => su.units.filter((u) => u.kind === k && u.stage === "stage1").map((u) => u.position);
    expect(s1("O")).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    expect(s1("B2")).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72]);
  });

  test("every O recipe pins the frame's image and a 40-hex base commit, and every B2 recipe the frame's fix commits", () => {
    const oframe = new Map((JSON.parse(readFileSync(join(BASE, "o-frame.json"), "utf8")).units as { id: string; digest: string }[]).map((u) => [u.id, u]));
    const b2 = new Map((JSON.parse(readFileSync(join(BASE, "b2-frame.json"), "utf8")).advisories as B2Row[]).map((r) => [candidateOf("B2", r).id, r]));
    for (const u of su.units) {
      if (u.recipe.kind === "sm-multilang") {
        expect(u.recipe.image_digest).toBe(oframe.get(u.id)!.digest);
        expect(u.recipe.base_commit).toMatch(/^[0-9a-f]{40}$/);
      } else expect(u.recipe.fix).toEqual(b2.get(u.id)!.fix);
    }
    expect(su.units.filter((u) => u.stage === "stage2" && !u.old.files["fix.patch"]).length).toBe(0);
  });

  test("refuses a file of another schema or a unit listed twice", () => {
    const f = join(mkdtempSync(join(tmpdir(), "h2hx-su-")), "su.json");
    writeFileSync(f, JSON.stringify({ ...su, schema: "x" }));
    expect(() => readSuUnits(f)).toThrow(/^E_H2HX_UNITS_INPUT/);
    writeFileSync(f, JSON.stringify({ ...su, units: [su.units[0], su.units[0]] }));
    expect(() => readSuUnits(f)).toThrow(/^E_H2HX_UNITS_INPUT.*twice/);
  });
});

describe("suUnitsFrom on planted records", () => {
  const prereg = { post: "p", draw_seed: 7, classes: { O: { n: 2, stage1_positions: [2] }, B: { n: 1, stage1: 1, stage1_positions: { B2: [2] } } } } as unknown as H2hPrereg;
  const oFrame = ["a", "b", "c", "d"].map((id) => ({ id, repo: "o/" + id, month: "2026-07", language: "go", entry: "bug" as const, licence: "MIT", digest: "sha256:" + id.repeat(64) }));
  const row = (n: number): B2Row => ({ ghsa: "GHSA-" + n, advisory_path: "p" + n, repo: "b/r" + n, published: "2026-06-01", month: "2026-06", window: "primary", ecosystem: "Go", licence: "MIT", second_read_pending: false, licence_from: "graphql", fix: { kind: "commit", ref: "c" + n, commit: "c" + n, parent: "p" + n }, fix_refs: 1, files: { test: 1, source: 1, total: 2 } });
  const b2Rows = [row(1), row(2), row(3)];
  const b2Order = seededOrder(b2Rows.map((r) => { const c = candidateOf("B2", r); return { id: c.id, repo: c.repo, month: c.month }; }), 7).map((u) => u.id);
  const pub = (o: { id: string; position: number; kind: string }) => ({ ...o, repo: o.kind === "O" ? "o/" + o.id : candidateOf("B2", b2Rows.find((r) => candidateOf("B2", r).id === o.id)!).repo, month: "2026-07", language: "go", entry: "bug" as const, image_digest: o.kind === "O" ? "sha256:" + o.id.repeat(64) : "sha256:" + "e".repeat(64), licence: "MIT", stage: "stage2" });
  const rows = new Map(["a", "b", "c", "d"].map((id) => [id, { instance_id: id, base_commit: "f".repeat(40), docker_image: "img/" + id, created_at: "2026-07-01" }]));
  const inputs = (over: Partial<SuInputs> = {}): SuInputs => ({ prereg, oFrame, oOrder: ["a", "b", "c", "d"], b2Rows, rows, files: new Map(), sources: {}, stage1: ["b", b2Order[1]!], published: [pub({ id: "a", position: 1, kind: "O" }), pub({ id: "c", position: 3, kind: "O" }), pub({ id: b2Order[0]!, position: 1, kind: "B2" })], ...over });

  test("places stage 1 units at the frozen positions their order gives and keeps the recipes", () => {
    const su = suUnitsFrom(inputs());
    expect(su.units.map((u) => [u.id, u.stage, u.position])).toEqual([["b", "stage1", 2], ["a", "stage2", 1], ["c", "stage2", 3], [b2Order[1], "stage1", 2], [b2Order[0], "stage2", 1]]);
    expect(su.units.find((u) => u.id === b2Order[1])!.old.image_digest).toBeNull();
  });

  test("refuses a stage 1 unit out of order, a wrong count, a missing row or a unit listed twice", () => {
    expect(() => suUnitsFrom(inputs({ stage1: ["d", b2Order[1]!] }))).toThrow(/^E_H2HX_UNITS_INPUT.*does not follow/);
    expect(() => suUnitsFrom(inputs({ stage1: ["b", b2Order[0]!], published: [pub({ id: "a", position: 1, kind: "O" }), pub({ id: "c", position: 3, kind: "O" }), pub({ id: b2Order[1]!, position: 1, kind: "B2" })] }))).toThrow(/^E_H2HX_UNITS_INPUT.*does not follow/);
    expect(() => suUnitsFrom(inputs({ stage1: ["b"] }))).toThrow(/^E_H2HX_UNITS_INPUT.*stage 1 outcomes/);
    expect(() => suUnitsFrom(inputs({ rows: new Map() }))).toThrow(/^E_H2HX_UNITS_INPUT.*no MultiLang row/);
    expect(() => suUnitsFrom(inputs({ stage1: ["a", b2Order[1]!] }))).toThrow(/^E_H2HX_UNITS_INPUT.*twice/);
    expect(() => suUnitsFrom(inputs({ published: inputs().published.slice(1) }))).toThrow(/^E_H2HX_UNITS_INPUT.*units.json holds/);
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const unit = (id: string, files: Record<string, string> = {}): SuUnit => ({ id, kind: "O", stage: "stage2", position: 1, repo: "r/" + id, month: "2026-07", language: "go", entry: "bug", licence: "MIT",
  recipe: { kind: "sm-multilang", dataset: "d", revision: "r", instance_id: id, language: "go", base_commit: "f".repeat(40), docker_image: "i", image_digest: "sha256:" + "a".repeat(64), created_at: "2026-07-01" },
  old: { image_digest: "sha256:" + "a".repeat(64), files, files_from: files["fix.patch"] ? "planted" : null } });
const su = (...units: SuUnit[]): SuUnits => ({ schema: "h2hx-su-units.v1", base: "b", sources: {}, counts: {}, units });
type Plant = { convert?: "drop" | "mismatch" | "throw"; oracle?: string; base?: number; fixed?: number; contain?: boolean };
const stub = (plants: Record<string, Plant>, calls: string[] = []): RebuildDeps => ({
  async convert(u) {
    calls.push("convert " + u.id);
    const p = plants[u.id] ?? {};
    if (p.convert === "drop") return { drop: "E_H2H_B_BUILD build_failed" };
    if (p.convert === "throw") throw new Error("E_SM_PULL docker pull timed out");
    return { dir: "/u/" + u.id, files: { "fix.patch": p.convert === "mismatch" ? sha("other") : sha("fix " + u.id), "test.patch": sha("test " + u.id) } };
  },
  async oracle(_d, u) {
    const p = plants[u.id] ?? {};
    return { verdict: p.oracle ?? "kept", detail: "planted", base_runs: p.base ?? 3, fixed_runs: p.fixed ?? 3, image: "sha256:" + "b".repeat(64) };
  },
  async contain(_d, u) {
    return (plants[u.id]?.contain ?? true) ? { ok: true, findings: [] } : { ok: false, findings: ["refs: 1"] };
  },
});

describe("rebuildUnits, with stubbed conversion, oracle and containment", () => {
  const files = (id: string) => ({ "fix.patch": sha("fix " + id), "test.patch": sha("test " + id) });
  const all = su(unit("good", files("good")), unit("nodig"), unit("build", files("build")), unit("mismatch", files("mismatch")), unit("unstable", files("unstable")), unit("tworuns", files("tworuns")), unit("leak", files("leak")), unit("infra", files("infra")), unit("thrown", files("thrown")));
  const plants: Record<string, Plant> = { build: { convert: "drop" }, mismatch: { convert: "mismatch" }, unstable: { oracle: "E_SM_ORACLE_UNSTABLE" }, tworuns: { base: 2 }, leak: { contain: false }, infra: { oracle: "E_SM_INFRA_GAP" }, thrown: { convert: "throw" } };

  test("keeps a unit that rebuilds the same files, passes 3 and 3 oracle runs and containment, and drops each planted failure", async () => {
    const r = await rebuildUnits(all, stub(plants));
    expect(r.usable).toEqual(["good", "nodig"]);
    expect(r.dropped.map((d) => [d.id, d.code])).toEqual([["build", "E_H2HX_UNITS_RECIPE"], ["mismatch", "E_H2HX_UNITS_RECIPE"], ["unstable", "E_H2HX_UNITS_ORACLE"], ["tworuns", "E_H2HX_UNITS_ORACLE"], ["leak", "E_H2HX_UNITS_CONTAIN"]]);
    expect(r.pending).toEqual(["infra", "thrown"]);
    const good = r.units.find((u) => u.id === "good")!;
    expect([good.old_digest, good.new_digest, good.files_checked]).toEqual(["sha256:" + "a".repeat(64), "sha256:" + "b".repeat(64), ["fix.patch", "test.patch"]]);
    expect(r.units.find((u) => u.id === "nodig")!.files_checked).toEqual([]);
  });

  test("a later call retries only pending units and keeps settled ones", async () => {
    const first = await rebuildUnits(all, stub(plants));
    const calls: string[] = [];
    const second = await rebuildUnits(all, stub({ ...plants, infra: {}, thrown: {} }, calls), { previous: first });
    expect(calls).toEqual(["convert infra", "convert thrown"]);
    expect(second.usable).toEqual(["good", "nodig", "infra", "thrown"]);
    expect(second.dropped.length).toBe(5);
    await expect(rebuildUnits(su(unit("good")), stub({}), { previous: first })).rejects.toThrow(/^E_H2HX_UNITS_INPUT.*another su-units/);
  });

  test("a dropped unit is gone from every stage, and a pending unit refuses", async () => {
    const first = await rebuildUnits(all, stub(plants));
    expect(() => usableSuUnits(all, first)).toThrow(/^E_H2HX_UNITS_PENDING/);
    const done = await rebuildUnits(all, stub({ ...plants, infra: {}, thrown: {} }), { previous: first });
    expect(usableSuUnits(all, done).map((u) => u.id)).toEqual(["good", "nodig", "infra", "thrown"]);
    const part = await rebuildUnits(all, stub({}), { only: ["good"] });
    expect(part.pending.length).toBe(8);
    await expect(rebuildUnits(all, stub({}), { only: ["nope"] })).rejects.toThrow(/^E_H2HX_UNITS_INPUT/);
  });

  test("su-units.json is where the rebuild reads", () => {
    expect(SU_UNITS_PATH.endsWith("2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg/su-units.json")).toBe(true);
  });
});

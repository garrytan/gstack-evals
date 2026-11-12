// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labelsGate, monthOrders, neutralGate, poolOf, readLabels, stratumOf, TEST_MONTHS, walkDraw, type DrawUnit, type Gate } from "../../lanes/outcome-skills/pfchecks/draw.ts";

const units: DrawUnit[] = [];
for (const m of ["2025-01", "2025-06", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]) for (let i = 0; i < 6; i++) units.push({ id: m + "-u" + i, repo: "r" + (i % 3), month: m });
const all: Gate = { name: "all", check: () => ({ ok: true }) };
test("test months walk July 2026 back to January 2025; strata tags", () => {
  expect(TEST_MONTHS[0]).toBe("2026-07");
  expect(TEST_MONTHS.at(-1)).toBe("2025-01");
  expect(TEST_MONTHS.length).toBe(19);
  expect(["2026-07", "2026-03", "2026-06", "2026-02", "2025-08"].map(stratumOf)).toEqual(["july-2026", "jan-jun-2026", "jan-jun-2026", "jan-jun-2026", "pre-2026"]);
});
test("seeded per-month order, admission from March to June, at most 3 per repository", () => {
  const o1 = monthOrders(units, 7), o2 = monthOrders([...units].reverse(), 7);
  expect(o1.get("2026-04")!.map((u) => u.id)).toEqual(o2.get("2026-04")!.map((u) => u.id));
  const d = walkDraw(units, 7, [all], { n: 3 });
  expect(d.admission.length).toBe(8);
  expect(d.admission.every((id) => id >= "2026-03" && id < "2026-07")).toBe(true);
  expect(d.test.length).toBe(1);
  expect(d.short.map((s) => s.phase)).toEqual(["test", "reserve"]);
  const per = new Map<string, number>();
  for (const id of [...d.admission, ...d.test]) per.set(d.units[id]!.repo, (per.get(d.units[id]!.repo) ?? 0) + 1);
  expect(Math.max(...per.values())).toBeLessThanOrEqual(3);
});
test("a dropped unit uses no slot, each candidate is asked once, test walks newest first, then the reserve", () => {
  const many: DrawUnit[] = units.map((u, i) => ({ ...u, repo: "r" + i }));
  const asked: string[] = [];
  const drop: Gate = { name: "labels", check: (id) => (asked.push(id), id.endsWith("u0") ? { ok: false, code: "E_PF_LABELS", reason: "not_defect" } : { ok: true }) };
  const d = walkDraw(many, 11, [drop], { raise: true, n: 5 });
  expect(new Set(asked).size).toBe(asked.length);
  expect(d.admission.length + d.raise.length).toBe(16);
  expect(d.test.every((id) => id.startsWith("2026-07"))).toBe(true);
  expect(d.reserve.length).toBe(10);
  expect(d.by_code).toEqual({ E_PF_LABELS: { not_defect: d.drops.length } });
  expect([...d.admission, ...d.raise].some((id) => d.test.includes(id))).toBe(false);
});
test("a missing gate input stops the walk and names the candidate; label and neutral gates read files", () => {
  const dir = mkdtempSync(join(tmpdir(), "pf-draw-"));
  const yes = { defect: "yes", state_shaped: "yes", reason: "" }, other = { defect: "yes", state_shaped: "no", reason: "" };
  writeFileSync(join(dir, "l.json"), JSON.stringify({ schema: "pf-labels.v1", labels: { a: { astra: yes, opus: yes }, b: { astra: yes, opus: other }, c: { astra: null, opus: yes } } }));
  const lg = labelsGate(readLabels([join(dir, "l.json")]));
  expect([lg.check("a"), lg.check("b"), lg.check("c"), lg.check("z")]).toEqual([{ ok: true }, { ok: false, code: "E_PF_LABELS", reason: "unclear" }, { ok: false, code: "E_PF_LABELS", reason: "malformed" }, { pending: true, why: "no label record" }]);
  writeFileSync(join(dir, "a.json"), JSON.stringify({ schema: "pf-neutral.v1", id: "a", verdict: "dropped", mode: null, files: [], tried: [{ mode: "both", ok: false, reason: "stable_failed 1 x" }], patch_sha256: null }));
  expect(neutralGate(dir).check("a")).toEqual({ ok: false, code: "E_PF_NEUTRAL_INVALID", reason: "both: stable_failed" });
  const d = walkDraw(units, 7, [lg]);
  expect(d.pending).toMatchObject({ gate: "labels", phase: "admission" });
});
test("the pool keeps the window and the screen", () => {
  const c = (id: string, created_at: string, extra: object = {}) => ({ id, repo: "r", month: created_at.slice(0, 7), created_at, image_digest: "sha256:x", f2p: 1, p2p: 1, fix_source_files: 1, feature_screen: false, ...extra }) as any;
  expect(poolOf([c("a", "2024-12-31T00:00:00Z"), c("b", "2025-01-01T00:00:00Z"), c("c", "2026-08-01T00:00:00Z"), c("d", "2026-07-31T23:00:00Z"), c("e", "2026-03-01", { f2p: 0 })]).map((u) => u.id)).toEqual(["b", "d"]);
});

// Value: protects=the Captain's ruling item 6 on #324: section 2's pool, mixed-hunk drop included, comes only from a candidates file where every row in a language with a test-module detector carries sm source split's fields; fails_when=poolOf takes a rust row with no split or a malformed one, or refuses rows that all carry a split count or a split error, or a row in a language with no detector; why_new=a candidates file from before sm source split gave a pool 7 units larger (805, not 798) with no error; seam=draw.ts poolOf; no_claim=the paid pool file itself (checked by hand, not committed)
test("the pool refuses rows in a language with a test-module detector that carry no split fields or malformed ones", () => {
  const c = (id: string, extra: object = {}) => ({ id, repo: "r", lang: "rust", month: "2026-03", created_at: "2026-03-01T00:00:00Z", image_digest: "sha256:x", f2p: 1, p2p: 1, fix_source_files: 1, feature_screen: false, ...extra }) as any;
  const ok = c("ok", { split: { source_files: 1, mixed: 0, test_hunks: 2 } });
  const mixed = c("mixed", { split: { source_files: 1, mixed: 1, test_hunks: 0 } });
  const err = c("err", { split: { error: "raw src/a.rs answered 404" } });
  expect(poolOf([ok, mixed, err, c("go", { lang: "go" })]).map((u) => u.id)).toEqual(["ok", "go"]);
  expect(() => poolOf([ok, c("bare"), c("bare2")])).toThrow(/^E_PF_INPUT 2 rust candidates carry no sm source split fields or malformed ones, so section 2's mixed-hunk screen cannot run: bare, bare2; /);
  for (const split of [null, {}, { source_files: 1, mixed: 0 }, { source_files: 1, mixed: -1, test_hunks: 0 }, { source_files: 1.5, mixed: 0, test_hunks: 0 }, { error: 3 }, { error: "x", mixed: 0 }, [1, 0, 0]]) {
    expect(() => poolOf([c("bad", { split })])).toThrow(/^E_PF_INPUT 1 rust candidates carry no sm source split fields or malformed ones, so section 2's mixed-hunk screen cannot run: bad; /);
  }
});

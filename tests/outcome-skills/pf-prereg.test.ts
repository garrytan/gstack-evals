// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrereg } from "../../lanes/outcome-skills/pfchecks/prereg.ts";

const FIX = join(import.meta.dir, "fixtures", "pf", "prereg.json");
test("reads the three seeds", () => {
  expect(readPrereg(FIX)).toEqual({ draw_seed: 2654435761, order_seed: 1013904223, bootstrap_seed: 1664525 });
});
test("refuses a missing file, another schema, a bad seed and another pin with E_PF_SEED", () => {
  const d = mkdtempSync(join(tmpdir(), "pf-prereg-"));
  const w = (o: unknown) => { const p = join(d, Math.random() + ".json"); writeFileSync(p, JSON.stringify(o)); return p; };
  const ok = { schema: "pf-prereg.v1", draw_seed: 1, order_seed: 2, bootstrap_seed: 3 };
  expect(() => readPrereg(join(d, "none.json"))).toThrow(/^E_PF_SEED/);
  expect(() => readPrereg(w({ ...ok, schema: "sm-prereg.v1" }))).toThrow(/^E_PF_SEED/);
  expect(() => readPrereg(w({ ...ok, draw_seed: -1 }))).toThrow(/^E_PF_SEED/);
  expect(() => readPrereg(w({ ...ok, bootstrap_seed: 2 ** 32 }))).toThrow(/^E_PF_SEED/);
  expect(() => readPrereg(w({ ...ok, pins: { swe_bench_live_multilang: { revision: "x" } } }))).toThrow(/^E_PF_SEED/);
  expect(readPrereg(w(ok)).order_seed).toBe(2);
});

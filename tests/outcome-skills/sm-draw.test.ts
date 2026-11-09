// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draw, fill, readPrereg, type DrawUnit } from "../../lanes/outcome-skills/statemachines/draw.ts";

const fixture = join(import.meta.dir, "fixtures/sm/prereg.json");
const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const units = (): DrawUnit[] => months.flatMap((m, mi) => Array.from({ length: 24 }, (_, i) => ({ id: m + "-u" + i, repo: "r" + ((i + mi * 7) % 40), month: m, stratum: (i % 5 === 4 ? "unclear" : i % 2 ? "state" : "other") as DrawUnit["stratum"] })));

describe("draw", () => {
  test("reads the seeds from the preregistration's JSON and refuses a missing file or key", () => {
    expect(readPrereg(fixture)).toEqual({ draw_seed: 3141592653, bootstrap_seed: 2718281828, order_seed: 1618033988 });
    const dir = mkdtempSync(join(tmpdir(), "sm-draw-"));
    expect(() => readPrereg(join(dir, "none.json"))).toThrow(/^E_SM_SEED /);
    writeFileSync(join(dir, "p.json"), JSON.stringify({ schema: "sm-prereg.v1", bootstrap_seed: 1, order_seed: 2, pins: { swe_bench_live_multilang: { revision: "eb09c2e5db6e4c5a95e01c903c8fd1d5da33c4f3" } } }));
    expect(() => readPrereg(join(dir, "p.json"))).toThrow(/^E_SM_SEED .*draw_seed/);
    writeFileSync(join(dir, "q.json"), JSON.stringify({ schema: "sm-prereg.v1", draw_seed: 1, bootstrap_seed: 1, order_seed: 2, pins: { swe_bench_live_multilang: { revision: "other" } } }));
    expect(() => readPrereg(join(dir, "q.json"))).toThrow(/^E_SM_SOURCE /);
    writeFileSync(join(dir, "r.json"), JSON.stringify({ schema: "sm-prereg.v1", draw_seed: 2 ** 32, bootstrap_seed: 1, order_seed: 2 }));
    expect(() => readPrereg(join(dir, "r.json"))).toThrow(/^E_SM_SEED /);
  });

  test("the order is fixed by the seed, admission walks March to June, strata walk newest first", () => {
    const a = draw(units(), 7), b = draw(units().reverse(), 7), c = draw(units(), 8);
    expect(a).toEqual(b);
    expect(a.admission).not.toEqual(c.admission);
    const mon = (ids: string[]) => ids.map((i) => i.slice(0, 7));
    expect([...new Set(mon(a.admission))]).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
    expect([...new Set(mon(a.state))]).toEqual(["2026-07", "2026-06", "2026-05", "2026-04", "2026-03"]);
    expect(a.state.some((i) => i.startsWith("2026-02"))).toBe(false);
    expect([...a.state, ...a.other].some((i) => Number(i.split("-u")[1]) % 5 === 4)).toBe(false);
  });

  test("fill: admission first, 30 and 30, at most 3 kept per repository, reserve 10, retry on request", async () => {
    const d = draw(units(), 11);
    const failing = new Set(d.state.slice(0, 5));
    const asked: string[] = [];
    const f = await fill(d, (id) => (asked.push(id), !failing.has(id)), { retry: true });
    expect([f.admission.length, f.state.length, f.other.length, f.reserve.length, f.retry.length]).toEqual([15, 30, 30, 10, 15]);
    const all = [...f.admission, ...f.state, ...f.other, ...f.reserve, ...f.retry];
    expect(new Set(all).size).toBe(all.length);
    const per = new Map<string, number>();
    for (const id of all) per.set(d.repo[id]!, (per.get(d.repo[id]!) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(3);
    expect(new Set(asked).size).toBe(asked.length);
    expect(f.state.some((i) => failing.has(i))).toBe(false);
    expect(f.state[0]!.startsWith("2026-07")).toBe(true);
    expect(f.walked.some((w) => w.kept === "cap")).toBe(true);
  });

  test("a short stratum's gap is filled from the other", async () => {
    const u = units().map((x) => ({ ...x, repo: x.id }));
    const d = draw(u.filter((x) => x.stratum !== "state" || x.id.endsWith("-u1")), 5);
    const f = await fill(d, () => true);
    const avail = d.state.filter((id) => !f.admission.includes(id)).length;
    expect(avail).toBeLessThan(30);
    expect(f.state.length).toBe(avail);
    const otherAvail = d.other.filter((id) => !f.admission.includes(id)).length;
    expect(otherAvail).toBeGreaterThan(30);
    expect(f.other.length).toBe(Math.min(60 - avail, otherAvail));
    expect(f.reserve).toEqual([]);
  });
});

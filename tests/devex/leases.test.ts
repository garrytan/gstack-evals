// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's money rules (prereg 2026-11-09-geva-417 section 14, section 4's DX scope check, section 15 rules 3
// and 4): the item table, lease sizes, admission order, the cut list, the scope gate at 0.79 and 0.80, what each
// stopping code does to a lease, and the dry run's lease lines on a temporary ledger. Keyless: no paid call.
import { describe, expect, test } from "bun:test";
import { admit, checks, CUTS, frozenRuns, FULL, IN_FLIGHT_MICROS, ITEMS, leaseOf, run, scopeGate, stopAction } from "../../lanes/devex/leases.ts";

const $ = (d: number) => Math.round(d * 1_000_000);
const mdd = () => 0.1;
const io = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) } };
};

describe("section 14 items and runs", () => {
  test("caps sum to $4,000 and every leased item admits its runs at projection, in order", () => {
    expect(ITEMS.reduce((s, i) => s + i.cap_micros, 0)).toBe($(4000));
    for (const i of ITEMS.filter((x) => x.run_id)) {
      const runs = frozenRuns().filter((r) => r.item === i.id);
      expect(runs.length).toBeGreaterThan(0);
      let settled = 0;
      for (const r of runs) {
        expect(r.run_id).toBe(i.run_id!);
        expect(r.lease_micros).toBeLessThanOrEqual(i.cap_micros - settled);
        settled += r.projection_micros;
      }
    }
  });

  test("a lease is projection plus a tenth plus 8 x $1.50 in flight; hosts hold no in-flight reserve; calibration authoring covers the $250 bound", () => {
    expect(IN_FLIGHT_MICROS).toBe($(12));
    expect(leaseOf($(100))).toBe($(122));
    expect(leaseOf($(100), false)).toBe($(110));
    const by = Object.fromEntries(frozenRuns().map((r) => [r.id, r]));
    expect(by["s2-opus-1"]!.lease_micros).toBe($(529.44));
    expect(by["s2-opus-2"]!.lease_micros).toBe($(529.44));
    expect(by["h-hosts"]!.lease_micros).toBe($(77));
    expect(by["a-calibration"]!.lease_micros).toBe($(262));
    expect(frozenRuns().filter((r) => r.item === "dx-s2-runs").map((r) => r.id)).toEqual(["s2-opus-1", "s2-sol", "s2-particle", "s2-opus-2"]);
  });
});

describe("the DX scope gate", () => {
  test("0.79 refuses, 0.80 admits, an unread rate refuses, and the Captain's go admits", () => {
    expect(scopeGate(0.79)).toMatch(/under 0\.80/);
    expect(scopeGate(0.8)).toBeNull();
    expect(scopeGate(51 / 64)).not.toBeNull();
    expect(scopeGate(null)).toMatch(/not read/);
    expect(scopeGate(0.5, true)).toBeNull();
    expect(admit({ run: "s2-opus-1", left_micros: $(1560), opened: [], scope_rate: 0.79, mdd }).ok).toBe(false);
    expect(admit({ run: "s2-opus-1", left_micros: $(1560), opened: [], scope_rate: 0.8, mdd }).ok).toBe(true);
    expect(admit({ run: "s1-none", left_micros: $(160), opened: [], scope_rate: 0.1, mdd }).ok).toBe(true);
  });
});

describe("admission and the cut list", () => {
  test("a lease that fits is admitted with no cut; at its exact size it still fits", () => {
    const size = frozenRuns().find((r) => r.id === "s2-opus-2")!.lease_micros;
    expect(admit({ run: "s2-opus-2", left_micros: size, opened: ["s2-opus-1", "s2-sol", "s2-particle"], scope_rate: 0.8, mdd })).toMatchObject({ ok: true, cuts: [] });
    expect(admit({ run: "s2-opus-2", left_micros: size - 1, opened: ["s2-opus-1", "s2-sol", "s2-particle"], scope_rate: 0.8, mdd })).toMatchObject({ ok: true, cuts: ["opus-pass2-gstack"] });
  });

  test("before any stage 2 lease, Opus pass 1 takes the comparison-units cut; Sol takes its lens cut first", () => {
    const p1 = admit({ run: "s2-opus-1", left_micros: $(450), opened: [], scope_rate: 0.8, mdd });
    expect(p1).toMatchObject({ ok: true, cuts: ["units-48"] });
    const sol = admit({ run: "s2-sol", left_micros: $(450), opened: ["s2-opus-1"], scope_rate: 0.8, mdd });
    expect(sol).toMatchObject({ ok: true, cuts: ["sol-lens"] });
  });

  test("cuts run in the frozen order and none drops particle-1's cells", () => {
    expect(CUTS.map((c) => c.id)).toEqual(["stage3-12", "sol-lens", "units-48", "opus-pass2-gstack"]);
    const all = CUTS.reduce((d, c) => c.apply(d), FULL);
    const p = frozenRuns(all).find((r) => r.id === "s2-particle")!;
    expect(p.projection_micros / all.units).toBe(frozenRuns().find((r) => r.id === "s2-particle")!.projection_micros / FULL.units);
  });

  test("a cut past the 0.13 MDD stops for the Captain before it is applied", () => {
    const r = admit({ run: "s2-opus-2", left_micros: $(100), opened: ["s2-opus-1", "s2-sol", "s2-particle"], scope_rate: 0.8, mdd: (d) => (d.opus_pass2_gstack ? 0.1 : 0.14) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stop).toMatch(/MDD/);
  });
});

describe("what a stopping code does to a lease", () => {
  test("arm stops scope the arm; per-model stops scope a shared lease and settle a one-model lease; end codes end", () => {
    expect(stopAction("E_DX_ARM_DROPPED", { stage: 1, lease_models: ["opus", "sol"] })).toBe("scope-arm");
    expect(stopAction("E_DX_PROVIDER_DRIFT", { stage: 1, model: "sol", lease_models: ["opus", "sol"] })).toBe("scope-model");
    expect(stopAction("E_DX_PROVIDER_DRIFT", { stage: 2, model: "sol", lease_models: ["sol"] })).toBe("settle");
    expect(stopAction("E_DX_PROVIDER_DRIFT", { stage: 1, model: "opus", lease_models: ["opus", "sol"] })).toBe("scope-model");
    expect(stopAction("E_DX_STOCK_FAIL", { stage: 1, model: "opus", lease_models: ["opus", "sol"] })).toBe("end");
    expect(stopAction("E_DX_STOCK_FAIL", { stage: 2, model: "opus", lease_models: ["opus"] })).toBe("settle");
    expect(stopAction("E_DX_SANDBOX_BREACH", { stage: 3, lease_models: ["opus"] })).toBe("end");
    expect(stopAction("E_DX_ARM_STOP", { stage: 2, lease_models: ["opus"] })).toBe("none");
  });
});

describe("the dry run's lease lines and dx leases", () => {
  test("every lease line passes on a temporary ledger", async () => {
    const lines = await checks();
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const l of lines) expect({ rule: l.rule, pass: l.pass, detail: l.detail }).toEqual({ rule: l.rule, pass: true, detail: l.detail });
  });

  test("dx leases prints the table, the runs, the cut list and the gate", async () => {
    const o = io();
    expect(await run(["--scope-rate", "0.79"], o.io)).toBe(0);
    const text = o.out.join("\n");
    for (const s of ["dx-s2-runs", "$1560.00", "s2-opus-2", "$529.44", "particle-1 stays", "under 0.80"]) expect(text).toContain(s);
    await expect(run(["--scope-rate", "1.5"], o.io)).rejects.toThrow(/usage/);
    await expect(run(["--bogus"], o.io)).rejects.toThrow(/usage/);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envelopeStatus, recordCrew, recordProgram } from "../../src/runner/ledger/envelope.ts";
import { openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../src/runner/ledger/local.ts";
import { projectionCheck } from "../../src/runner/stats/g-projection.ts";
import { costs, priceModel, pySum } from "../../src/runner/stats/g-resize.ts";

const D = 1_000_000;
const PER = "plan-eng-review", AP = "autoplan";
const OTHERS = ["plan-devex-review", "devex-review", "plan-design-review", "design-review"];
const quote = { words: "Approved", by: "Captain", source: "approvals/test" };
const usage = { input: 10, output: 5, reasoning: 0, cache_read: 0, cache_write: 0 };
const HOUSE = { MULT: 5, M_PER: 2.2, M_AP: 5, AUTH_PAID: 1.39, AUTH_EXTRA: 1.2 };
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** wave 1's envelope with G's settled spend so far: a stage split across both G skills, crew use, and other skills' settled spend. */
async function world(settledUsd: number, open = 0, other = 0) {
  const dir = mkdtempSync(join(tmpdir(), "g-projection-"));
  dirs.push(dir);
  const record = join(dir, "record"), local = LocalLedger.open(join(dir, "local.sqlite"));
  recordProgram(record, { program: "wave1", cap_micros: 10_000 * D, skill_cap_micros: 2_000 * D, skills: [PER, AP, ...OTHERS], credit_rate_micros: D, quotes: [quote] });
  recordApproval(record, { action: "init", item: "g-admission", cap_micros: 2 * settledUsd * D + D, quotes: [quote], admission: "warn", program: "wave1", skills: [PER, AP] });
  const l = openLease(record, local, { item: "g-admission", run_id: "adm", amount_micros: 2 * settledUsd * D, requireAdmission: () => null });
  const r = await local.reserve({ idempotency_key: "k", lease_id: l.lease_id, cell: { run_id: "adm", arm: "none", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "m" }, max_micros: 2 * settledUsd * D });
  if (!r.ok) throw new Error(r.message);
  await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 2 * settledUsd * D, usage });
  settleLease(record, local, l.lease_id);
  if (open) {
    recordApproval(record, { action: "init", item: "g-screen", cap_micros: 2 * open * D, quotes: [quote], admission: "warn", program: "wave1", skills: [PER, AP] });
    openLease(record, local, { item: "g-screen", run_id: "screen", amount_micros: 2 * open * D, requireAdmission: () => null });
  }
  if (other) {
    recordApproval(record, { action: "init", item: "x-stage", cap_micros: other * D + D, quotes: [quote], admission: "warn", program: "wave1", skills: OTHERS });
    const x = openLease(record, local, { item: "x-stage", run_id: "x", amount_micros: other * D, requireAdmission: () => null });
    const xr = await local.reserve({ idempotency_key: "kx", lease_id: x.lease_id, cell: { run_id: "x", arm: "none", task: "t", model: "m", trial: 1, attempt: 1, meter_id: "mx" }, max_micros: other * D });
    if (!xr.ok) throw new Error(xr.message);
    await local.settle(xr.reservation.reservation_id, { kind: "spent", spent_micros: other * D, usage });
    settleLease(record, local, x.lease_id);
  }
  recordCrew(record, { program: "wave1", thread: "GEVA-900", credits_micros: 20_000 * D, skills: [PER, AP], source: "counter 20,000 credits" });
  return envelopeStatus(record, "wave1");
}

describe("the projection check between stages, plan v3 section 6", () => {
  test("both alive before screening: settled spend, crew still to come and the metered remainder fit, and the MDD stays under 20", async () => {
    const env = await world(140);
    const p = projectionCheck({ stage: "screening", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 } });
    for (const s of [PER, AP] as const) {
      const x = p.skills[s];
      expect(x.committed_usd).toBeCloseTo(150, 9);
      expect(x.passes).toBe(true);
      expect(x.design!.mdd).toBeLessThanOrEqual(20);
      expect(x.projection_usd!).toBeLessThanOrEqual(1700);
      expect(x.cap_usd).toBe(2000);
    }
    const d = p.skills[PER].design!, a = p.skills[AP].design!;
    const M = priceModel({ mult: 5, p1ratio: 0.41, authExtra: 1.2, mPer: 2.2, mAp: 5, authPaid: 1.39 });
    const cs = costs(M, "G", [d.n, a.n], d.k);
    const cand = Math.max(d.n, a.n) / 0.3;
    const remaining = pySum([(cand * M.AUTH.G) / 2, cs[0].screen!, cs[0].conf_none!, cs[0].conf_told!]);
    expect(p.skills[PER].projection_usd!).toBeCloseTo(150 + 35 + remaining, 6);
  });

  test("spend already past the plan line stops both as FIX-METHOD (price), before the stage spends", async () => {
    const env = await world(1590);
    const p = projectionCheck({ stage: "screening", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 } });
    for (const s of [PER, AP] as const) expect([p.skills[s].passes, p.skills[s].route, p.skills[s].design]).toEqual([false, "FIX-METHOD (price)", null]);
  });

  test("a lone survivor re-sizes on M1's ladder; the stopped skill is not read", async () => {
    const env = await world(140);
    const p = projectionCheck({ stage: "screening", alive: [PER], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 0 } });
    expect(p.skills[PER].passes).toBe(true);
    expect(p.skills[PER].design!.k).toBe(4);
    expect(p.skills[AP].route).toBe("stopped before this stage");
  });

  test("before the confirmatory run the screened panel caps the tasks", async () => {
    const env = await world(500);
    const p = projectionCheck({ stage: "confirmatory", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 }, panel_tasks: 40 });
    for (const s of [PER, AP] as const) if (p.skills[s].design) expect(p.skills[s].design!.n).toBeLessThanOrEqual(40);
    expect(() => projectionCheck({ stage: "confirmatory", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 } })).toThrow(/panel_tasks/);
  });

  test("a pair past the program envelope stops autoplan first, and plan-eng-review re-sizes alone on M1's ladder (plan v3 section 8, prereg section 7)", async () => {
    const env = await world(490, 0, 7500);
    const p = projectionCheck({ stage: "confirmatory", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 }, panel_tasks: 48 });
    expect(p.program.committed_usd).toBeCloseTo(8500, 9);
    expect([p.skills[AP].passes, p.skills[AP].route, p.skills[AP].design]).toEqual([false, "FIX-METHOD (price)", null]);
    expect(p.skills[AP].reason).toMatch(/program envelope.*section 8/);
    expect(p.skills[PER].passes).toBe(true);
    expect(p.skills[PER].design!.k).toBe(4);
    expect(p.skills[PER].reason).toMatch(/alone on M1's ladder/);
    expect(p.program.fits).toBe(true);
    expect(p.program.projected_usd).toBeLessThanOrEqual(10_000);
    expect(p.program.projected_usd).toBeCloseTo(8500 + 35 + p.skills[PER].remaining_usd!, 6);
  });

  test("a program too full for plan-eng-review alone stops both at the envelope, and a lone survivor past it stops", async () => {
    const env = await world(700, 0, 8000);
    const p = projectionCheck({ stage: "confirmatory", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 }, panel_tasks: 48 });
    for (const s of [PER, AP] as const) expect([p.skills[s].passes, p.skills[s].route, p.skills[s].design]).toEqual([false, "FIX-METHOD (price)", null]);
    expect(p.skills[PER].reason).toMatch(/program envelope/);
    expect(p.program.fits).toBe(false);
    const lone = projectionCheck({ stage: "confirmatory", alive: [PER], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 0 }, panel_tasks: 48 });
    expect([lone.skills[PER].passes, lone.skills[PER].route]).toEqual([false, "FIX-METHOD (price)"]);
    expect(lone.skills[PER].reason).toMatch(/program envelope/);
  });

  test("an open lease counts at its whole reservation", async () => {
    const env = await world(140, 100);
    const p = projectionCheck({ stage: "screening", alive: [PER, AP], envelope: env, metered: HOUSE, crew_open_usd: { [PER]: 35, [AP]: 35 } });
    expect(p.skills[PER].committed_usd).toBeCloseTo(250, 9);
  });
});

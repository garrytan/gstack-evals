import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnerMeter } from "../../lanes/day-one/cli.ts";
import { fixtureUnit } from "../../lanes/day-one/dryrun.ts";
import { DAYONE_RUN } from "../../lanes/day-one/ledger.ts";
import { runStage, type StageInput } from "../../lanes/day-one/run.ts";
import type { AttemptRead, LaunchInput } from "../../lanes/day-one/sessions.ts";
import { loadUnit, type Unit } from "../../lanes/day-one/units.ts";
import { ledgerStatus, openLease, recordApproval, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../src/runner/ledger/paths.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../src/skill-eval/cli/run-host.ts";

const withDir = async (fn: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), "day-one-owner-"));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the responder's lease on a planning resume", () => {
  test("a resume leases only what the owner line has left, not the whole --owner-spend-cap again", async () => {
    await withDir(async (dir) => {
      const record = join(dir, "record");
      const ledger = join(dir, "ledger.sqlite");
      recordApproval(record, { action: "init", item: "day1-owner", cap_micros: 35e6, quotes: [{ words: "a test on a temporary ledger", by: "day-one test", source: "tests" }], admission: "warn" });
      const local = openLocalLedger(ledgerPath(ledger));
      try {
        const first = openLease(record, local, { item: "day1-owner", run_id: DAYONE_RUN, amount_micros: 35e6, requireAdmission: () => null });
        const r = (await local.reserve({ idempotency_key: "k1", lease_id: first.lease_id, cell: { run_id: DAYONE_RUN, arm: "pv", task: "q", model: "gpt-6.1-sol", trial: 1, attempt: 1, meter_id: "k1" } as never, max_micros: 5e6 })) as { reservation: { reservation_id: string } };
        await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: 5e6, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } } as never);
        settleLease(record, local, first.lease_id);
      } finally {
        local.close();
      }
      const { meter, lease } = await openOwnerMeter({ item: "day1-owner", capMicros: 35e6, out: dir, record, ledger, env: {} });
      try {
        expect(lease).toBe(30e6);
        expect(ledgerStatus(record, "day1-owner")[0]!.open_lease).toMatchObject({ reserved_micros: 30e6 });
      } finally {
        await meter.close();
      }
    });
  });

  test("a resume after a crash settles the responder's stale lease first, then leases what the line has left", async () => {
    for (const spent of [0, 5e6]) {
      await withDir(async (dir) => {
        const record = join(dir, "record");
        const ledger = join(dir, "ledger.sqlite");
        recordApproval(record, { action: "init", item: "day1-owner", cap_micros: 35e6, quotes: [{ words: "a test on a temporary ledger", by: "day-one test", source: "tests" }], admission: "warn" });
        const local = openLocalLedger(ledgerPath(ledger));
        try {
          const stale = openLease(record, local, { item: "day1-owner", run_id: DAYONE_RUN, amount_micros: 35e6, requireAdmission: () => null });
          if (spent) {
            const r = (await local.reserve({ idempotency_key: "k1", lease_id: stale.lease_id, cell: { run_id: DAYONE_RUN, arm: "pv", task: "q", model: "gpt-6.1-sol", trial: 1, attempt: 1, meter_id: "k1" } as never, max_micros: spent })) as { reservation: { reservation_id: string } };
            await local.settle(r.reservation.reservation_id, { kind: "spent", spent_micros: spent, usage: { input: 1, output: 1, reasoning: 0, cache_read: 0, cache_write: 0 } } as never);
          }
        } finally {
          local.close();
        }
        const { meter, lease } = await openOwnerMeter({ item: "day1-owner", capMicros: 35e6, out: dir, record, ledger, env: {} });
        try {
          expect(lease).toBe(35e6 - spent);
          expect(ledgerStatus(record, "day1-owner")[0]!.open_lease).toMatchObject({ reserved_micros: 35e6 - spent });
        } finally {
          await meter.close();
        }
      });
    }
  });

  test("a round is admitted only inside the responder's lease, so a short lease is an admission stop and not a lost cell", async () => {
    const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
    const stubRig = (): HostRig => ({ baseUrl: "http://proxy", network: "none", imageDigest: null, bind: async () => ({}) as never, finalize: async () => ({}) as never, arms: {}, sandbox: () => ({}) as never, judgeSandbox: () => ({}) as never, egress: () => ({ open: false, detail: "" }), close: async () => ({ committed: 0, unknown: 0, lease_id: null }), recovery: null });
    const meter = { leaseId: "owner", spent: () => 0, unknown: () => 0, close: async () => ({ spent_micros: 0, unknown_micros: 0 }), call: async () => ({ text: "On weekends.\nSOURCE: profile", status: 200, micros: 1000, cached: false, problem: null, served_by: "openai" }) };
    const run = async (dir: string, ownerLease: number) => {
      fixtureUnit(dir, "aaaaaa", 2);
      const u = (loadUnit(dir, "aaaaaa") as { unit: Unit }).unit;
      const launched: string[] = [];
      const launch = async (l: LaunchInput): Promise<AttemptRead> => {
        launched.push(l.cell);
        const out = join(l.dir, "out");
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "plan.md"), "# Plan\n");
        return { termination: { kind: "completed" }, web: 0, gstack_reads: [], contained: [], micros: 1e6, voice: null, out };
      };
      const input: StageInput & { ownerLease: number } = { stage: "base", tag: "t", units: [u], reps: [1], arms: ["n"], out: join(dir, "out"), runId: DAYONE_RUN, cap: 20e6, ownerCap: 10e6, ownerLease, voiceCap: 0, parallel: 1, ownerChannel: true, policy, ledger: null, docker: "docker", scratch: join(dir, "scratch"), nodeVolume: null, log: () => {} };
      const result = await runStage(input, { openRig: stubRig, ownerMeter: meter, launch });
      return { result, launched };
    };
    await withDir(async (dir) => {
      const short = await run(join(dir, "short"), 1e6);
      expect(short.launched).toEqual([]);
      expect(short.result.stops.map((s) => s.code)).toEqual(["E_DAYONE_ADMISSION"]);
      const enough = await run(join(dir, "enough"), 2e6);
      expect(enough.launched.length).toBe(1);
      expect(enough.result.stops).toEqual([]);
    });
  });
});

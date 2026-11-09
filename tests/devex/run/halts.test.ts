// Copyright (c) 2026 Garry Tan. MIT License.
// Ruling 1 (GEVA-502): an error thrown in the batch's own steps outside a launch (poll, the interim check,
// settleModelIfIdle) halts the batch under that error, lets every session in flight end, and settles nothing: run
// rejects with the error once the workers are done, and the lease stays open for the Captain. A fake ledger; no key.
import { describe, expect, test } from "bun:test";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { DxBatch, type BatchSession } from "../../../lanes/devex/run/batch.ts";
import { MODEL_STRINGS, type ArmId, type ModelId } from "../../../lanes/devex/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (unit: string, model: ModelId = "opus", arm: ArmId = "none", stage: 1 | 2 = 1): BatchSession => ({ id: [unit, model, arm, 1].join(":"), unit, arm, model, pass: 1, stage, smoke: false });
const ioError = () => Object.assign(new Error("SQLITE_IOERR: disk I/O error"), { code: "SQLITE_IOERR" });
function ledger(fault: { settleScope?: string } = {}) {
  const calls: string[] = [];
  const l = {
    stopScope: (_: string, s: { value: string }, code: string) => (calls.push("stop " + s.value + " " + code), { in_flight: 0 }),
    settleScope: (_: string, s: { value: string }) => {
      calls.push("settle-scope " + s.value);
      if (fault.settleScope === s.value) throw ioError();
      return { settled_calls: 0, spent_micros: 0, unknown_calls: 0, unknown_micros: 0 };
    },
    stageClose: () => (calls.push("close"), { kind: "close" }),
    markClosed: () => void calls.push("mark-closed"),
  } as unknown as LocalLedger;
  return { l, calls, closes: () => calls.filter((c) => c === "close" || c === "mark-closed") };
}

describe("ruling 1: a batch step that throws halts the batch and settles nothing", () => {
  test("poll: SQLITE_IOERR halts the batch, the session in flight ends before run rejects, and no session starts after it", async () => {
    const { l, closes } = ledger();
    const events: string[] = [];
    let polls = 0;
    const b = new DxBatch({ ledger: l, lease: "L1", sessions: [S("a1"), S("a2"), S("a3")], parallel: 2, launch: async (s) => {
      events.push("start " + s.unit);
      await sleep(60);
      events.push("end " + s.unit);
      return { exposed: null };
    }, poll: () => {
      if (++polls === 2) throw ioError();
    } });
    await expect(b.run().catch((e) => {
      events.push("rejected");
      throw e;
    })).rejects.toThrow(/^SQLITE_IOERR: /);
    expect(events).toEqual(["start a1", "end a1", "rejected"]);
    expect(b.haltedBy()).toMatch(/^a worker threw: SQLITE_IOERR: disk I\/O error/);
    expect(closes()).toEqual([]);
  });
  test("interim: SQLITE_IOERR in the exposure check halts the batch and starts no session after it", async () => {
    const { l, closes } = ledger();
    const started: string[] = [];
    const b = new DxBatch({ ledger: l, lease: "L1", interim: true, sessions: [S("p1", "opus", "plan-devex-review", 2), S("p2", "opus", "plan-devex-review", 2)], launch: async (s) => {
      started.push(s.unit);
      return { get exposed(): boolean {
        throw ioError();
      } };
    } });
    await expect(b.run()).rejects.toThrow(/^SQLITE_IOERR: /);
    expect(started).toEqual(["p1"]);
    expect(b.haltedBy()).toMatch(/^a worker threw: SQLITE_IOERR/);
    expect(closes()).toEqual([]);
  });
  test("settleModelIfIdle: SQLITE_IOERR when a stopped model's last session ends halts the batch", async () => {
    const { l, calls, closes } = ledger({ settleScope: MODEL_STRINGS.sol });
    const started: string[] = [];
    const b: DxBatch<{ exposed: null }> = new DxBatch({ ledger: l, lease: "L1", sessions: [S("s1", "sol"), S("a1"), S("a2")], launch: async (s) => {
      started.push(s.unit);
      if (s.model === "sol") b.stopModel("sol", "E_DX_PROVIDER_DRIFT", "drift seen");
      return { exposed: null };
    } });
    await expect(b.run()).rejects.toThrow(/^SQLITE_IOERR: /);
    expect(started).toEqual(["s1"]);
    expect(b.haltedBy()).toMatch(/^a worker threw: SQLITE_IOERR/);
    expect(calls[0]).toBe("stop " + MODEL_STRINGS.sol + " E_DX_PROVIDER_DRIFT");
    expect(calls).toContain("settle-scope " + MODEL_STRINGS.sol);
    expect(closes()).toEqual([]);
  });
});

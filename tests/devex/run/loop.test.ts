// Copyright (c) 2026 Garry Tan. MIT License.
// The devex session loop's stop, retry, reconcile, pause and error paths (run/session.ts runDxSessions over run/batch.ts
// DxBatch) on a fake rig: a process sandbox, a driver whose sessions end the way each test scripts, a fake meter and a
// fake local ledger. No key, no network, no model call.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { dxArmEnv } from "../../../src/trial/review/devex.ts";
import { runDxSessions, type DxTree } from "../../../lanes/devex/run/session.ts";
import type { BatchSession } from "../../../lanes/devex/run/batch.ts";
import { smokeSession, type DxRow } from "../../../lanes/devex/run/rows.ts";
import type { ModelId } from "../../../lanes/devex/types.ts";

const root = mkdtempSync(join(tmpdir(), "dx-loop-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (unit: string, model: ModelId = "opus"): BatchSession => ({ id: [unit, model, "none", 1].join(":"), unit, arm: "none", model, pass: 1, stage: 1, smoke: false });
const INSTALL = [{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "./setup" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "INSTALL: fail\n" }] } }].map((l) => JSON.stringify(l) + "\n").join("");

interface Script {
  end?: "infra" | "cap" | "install";
  occupyNext?: boolean;
  wait?: Promise<unknown>;
  meter?: { undrained?: number; by_model?: Record<string, { micros: number; requests: number }> };
}
type Scripts = Record<string, Script>;

async function go(name: string, sessions: BatchSession[], scripts: Scripts, o: { parallel?: number; control?: string[]; missingTree?: string; during?: (control: string) => void } = {}) {
  const out = join(root, name);
  const control = join(root, name + "-control.ndjson");
  writeFileSync(control, (o.control ?? []).join(""));
  const trees: Record<string, DxTree> = {};
  for (const u of new Set(sessions.map((s) => s.unit))) {
    if (u === o.missingTree) continue;
    const t = join(root, "trees", u);
    mkdirSync(join(t, "repo"), { recursive: true });
    writeFileSync(join(t, "plan.md"), "Add an init command.\n");
    writeFileSync(join(t, "repo", "a.ts"), "export {};\n");
    trees[u] = { task: u, plain: t, autoplan: null };
  }
  const binds: string[] = [];
  const unbinds: string[] = [];
  const ledgerCalls: string[] = [];
  const ledger = {
    stopScope: (_l: string, scope: { field: string; value: string }, code: string) => (ledgerCalls.push("stop " + scope.field + " " + scope.value + " " + code), { in_flight: 0 }),
    settleScope: () => ({ settled_calls: 0, unknown_calls: 0 }),
    stageClose: (_l: string, cap?: string) => (ledgerCalls.push("close" + (cap ? " " + cap : "")), { kind: "close" }),
    markClosed: () => {},
  } as unknown as LocalLedger;
  const box: Sandbox = {
    isolation: "process",
    workPath: (w) => w,
    fixturesPath: (f) => f,
    homePath: (d) => join(d, "home"),
    atWorkRoot: () => box,
    step: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
    agent: () => ({ exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }), spawn: () => { throw new Error("no process in this test"); }, stop() {} }) as unknown as ReturnType<Sandbox["agent"]>,
  };
  const at = (host: string) => {
    const parts = host.split("/");
    return parts[parts.length - 4]! + "#" + parts[parts.length - 2]!.replace("attempt-", "");
  };
  const rig: HostRig = {
    baseUrl: "http://127.0.0.1:1", network: null, imageDigest: null,
    bind: async (req) => {
      binds.push(req.cell.task + "#" + req.cell.attempt);
      return { slot: "slot-" + req.cell.task + "-" + req.cell.attempt, token: "t", meter_id: req.cell.task + "#" + req.cell.attempt } as unknown as Awaited<ReturnType<HostRig["bind"]>>;
    },
    finalize: async (id) => {
      const m = scripts[id]?.meter ?? {};
      return { meter_id: id, micros: 1_000, requests: 1, unknown: 0, refused: 0, unsettled: 0, undrained: m.undrained ?? 0, by_model: m.by_model ?? {} } as unknown as Awaited<ReturnType<HostRig["finalize"]>>;
    },
    unbind: (slot) => void unbinds.push(slot),
    arms: { none: { tree_sha256: "none-tree", skill: null, gstack: null, plugins: [] } } as unknown as HostRig["arms"],
    sandbox: () => box,
    judgeSandbox: () => box,
    egress: () => ({ open: false, detail: "test" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: "L1" }),
    recovery: null,
    driver: (opt) => ({
      env: dxArmEnv("none"),
      run: async () => {
        const sc = scripts[at(opt.out)] ?? {};
        await sc.wait;
        if (sc.occupyNext) mkdirSync(join(opt.out, "..", "..", "attempt-2"), { recursive: true });
        if (sc.end === "install") {
          mkdirSync(opt.out, { recursive: true });
          writeFileSync(join(opt.out, "transcript.ndjson"), INSTALL);
        }
        return { termination: sc.end === "cap" ? { kind: "cap_stop" } : { kind: "arm_failure", incident: "scripted" }, turns: 0 };
      },
    }) as unknown as ReturnType<NonNullable<HostRig["driver"]>>,
  };
  const logs: string[] = [];
  if (o.during) o.during(control);
  const live = await runDxSessions({ run: "s1-none", runId: "dx-s1-runs", sessions, trees, rig, ledger, record: null, lease: "L1", policy, out, parallel: o.parallel ?? 1, doubled: false, repairs: new Map(), pin: root, control, pollMs: 20, log: (l) => void logs.push(l) });
  const ran = live.rows.map((r) => r.session);
  const settled = live.settle();
  const rows = new Map(readFileSync(join(out, "rows.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as DxRow).map((r) => [r.unit, r]));
  const lines = (f: string) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { live, ran, settled, rows, binds, unbinds, logs, ledgerCalls, sessions: lines("sessions.ndjson"), recoveries: lines("recoveries.ndjson") };
}

describe("runDxSessions: stops, retries and releases", () => {
  test("a halt during attempt 1 leaves no attempt 2, and the row carries the halt's code", async () => {
    let release!: () => void;
    const scripts: Scripts = { "u1#1": { end: "cap" }, "u2#1": { wait: new Promise<void>((r) => (release = r)) } };
    const done = go("halt", [S("u1"), S("u2"), S("u3")], scripts, { parallel: 2 });
    await sleep(100);
    release();
    const r = await done;
    expect(r.binds).toContain("u2#1");
    expect(r.binds).not.toContain("u2#2");
    expect(r.rows.get("u2")!.end).toBe("missing");
    expect(r.rows.get("u2")!.code).toBe("CAP_STOP");
    expect(r.rows.get("u3")!.code).toBe("CAP_STOP");
    expect(r.live.batch.haltedBy()).toMatch(/^CAP_STOP: /);
  });

  test("provider drift stops the model: its row and the in-flight session on that model read E_DX_PROVIDER_DRIFT, unretried, and the other models go on", async () => {
    let release!: () => void;
    const scripts: Scripts = { "u1#1": { meter: { by_model: { "openrouter:some/other-model": { micros: 1_000, requests: 1 } } } }, "u2#1": { wait: new Promise<void>((r) => (release = r)) } };
    const done = go("drift", [S("u1"), S("u2"), S("u3", "sol"), S("u4")], scripts, { parallel: 2 });
    await sleep(100);
    release();
    const r = await done;
    expect(r.rows.get("u1")!.code).toBe("E_DX_PROVIDER_DRIFT");
    expect(r.rows.get("u2")!.code).toBe("E_DX_PROVIDER_DRIFT");
    expect(r.binds).not.toContain("u2#2");
    expect(r.binds).toContain("u3#2");
    expect(r.rows.get("u3")!.code).toBe("E_DX_INFRA_MISSING");
    expect(r.rows.get("u4")!.code).toBe("E_DX_PROVIDER_DRIFT");
    expect(r.ledgerCalls.some((c) => c.startsWith("stop model ") && c.endsWith(" E_DX_PROVIDER_DRIFT"))).toBe(true);
    expect(r.live.batch.haltedBy()).toBeNull();
  });

  test("a released row takes the stop that released it, not a later halt's code", async () => {
    const r = await go("order", [S("u1"), S("u2", "sol"), S("u3"), S("u4", "particle")], { "u1#1": { meter: { by_model: { "openrouter:some/other-model": { micros: 1, requests: 1 } } } }, "u2#1": { end: "cap" } });
    expect(r.live.batch.haltedBy()).toMatch(/^CAP_STOP/);
    expect(r.rows.get("u3")!.code).toBe("E_DX_PROVIDER_DRIFT");
    expect(r.rows.get("u4")!.code).toBe("CAP_STOP");
  });

  test("a meter that has not drained ends the session missing, retries nothing, unbinds the slot and halts for the Captain", async () => {
    const r = await go("undrained", [S("u1"), S("u2")], { "u1#1": { meter: { undrained: 1 } } });
    expect(r.binds).toEqual(["u1#1"]);
    expect(r.unbinds).toEqual(["slot-u1-1"]);
    expect(r.rows.get("u1")!.code).toBe("E_DX_INFRA_MISSING");
    expect(r.rows.get("u2")!.code).toBe("E_DX_INFRA_MISSING");
    expect(r.sessions[0]).toMatchObject({ undrained: 1, unsettled: 0 });
    expect(r.recoveries[0].reconciled).toMatch(/^not reconciled: 1 calls were still in flight \(undrained\); nothing retries/);
    expect(r.live.batch.haltedBy()).toMatch(/^E_DX_INFRA_MISSING: /);
  });

  test("an infra failure on a drained meter still retries once, with its recoveries line first", async () => {
    const r = await go("retry", [S("u1")], {});
    expect(r.binds).toEqual(["u1#1", "u1#2"]);
    expect(r.recoveries[0].reconciled).toBe("the meter's finalize settled every call with no recorded outcome as unknown spend");
    expect(r.recoveries[0]).toMatchObject({ undrained: 0, unsettled: 0 });
  });

  test("one launch that throws halts the batch, waits for the session in flight, and every unfinished session gets its row at settle", async () => {
    let release!: () => void;
    const done = go("throws", [S("u1"), S("nope"), S("u3")], { "u1#1": { wait: new Promise<void>((r) => (release = r)) } }, { parallel: 2, missingTree: "nope" });
    await sleep(100);
    release();
    const r = await done;
    expect(String((r.live.error as Error).message)).toMatch(/^E_USAGE: unit nope has no tree/);
    expect(r.ran).toContain("u1:opus:none:1");
    expect(r.binds).toEqual(["u1#1"]);
    expect(r.rows.get("u1")!.code).toBe("E_USAGE");
    expect(r.rows.get("nope")!.code).toBe("E_USAGE");
    expect(r.rows.get("u3")!.code).toBe("E_USAGE");
    expect(r.settled.released).toEqual(["nope:opus:none:1", "u3:opus:none:1"]);
  });

  test("a launch that throws after an attempt ran keeps that attempt's spend, and the row reads launched for rule 4's median", async () => {
    const r = await go("throws-late", [S("u1"), S("u2")], { "u1#1": { occupyNext: true } });
    expect(String((r.live.error as Error).message)).toMatch(/^E_USAGE: the session sink .*attempt-2 exists before its launch/);
    expect(r.binds).toEqual(["u1#1"]);
    expect(r.rows.get("u1")).toMatchObject({ launched: true, spend_micros: 1_000, end: "missing", code: "E_USAGE" });
    expect(smokeSession(r.rows.get("u1")!).launched).toBe(true);
    expect(r.rows.get("u2")).toMatchObject({ launched: false, spend_micros: 0, code: "E_USAGE" });
  });
});

describe("runDxSessions: the control file", () => {
  test("a malformed line (a code that routes nowhere, a scope stop with no target, not JSON) halts for the Captain and releases every session", async () => {
    let i = 0;
    for (const bad of ['{"code":"CAP_STOP","why":"x"}\n', '{"code":"E_DX_PROVIDER_DRIFT","why":"no model named"}\n', '{"code":"E_DX_INFRA_MISSING","model":"sol"}\n', "not json\n"]) {
      const r = await go("bad-" + i++, [S("u1"), S("u2", "sol")], {}, { control: [bad] });
      expect(r.live.batch.haltedBy()).toMatch(/^E_USAGE: control line 1 does not read as/);
      expect(r.binds).toEqual([]);
      expect([...r.rows.values()].map((x) => x.code)).toEqual(["E_USAGE", "E_USAGE"]);
    }
  });

  test("a trailing line with no newline yet is not read; a whole stop line stops its model", async () => {
    const partial = await go("partial", [S("u1")], { "u1#1": { end: "cap" } }, { control: ['{"code":"E_DX_PROVIDER_DRIFT","model":"so'] });
    expect(partial.binds).toEqual(["u1#1"]);
    expect(partial.live.batch.haltedBy()).toMatch(/^CAP_STOP/);
    const whole = await go("whole", [S("u1", "sol"), S("u2")], { "u2#1": { end: "cap" } }, { control: ['{"code":"E_DX_PROVIDER_DRIFT","model":"sol","why":"the Captain saw drift"}\n'] });
    expect(whole.binds).toEqual(["u2#1"]);
    expect(whole.rows.get("u1")!.code).toBe("E_DX_PROVIDER_DRIFT");
  });

  test("an install pause keeps the run and its lease alive until the Captain's resume line, then the cell runs on the same lease", async () => {
    const scripts: Scripts = { "u1#1": { end: "install" }, "u1#2": { end: "install" }, "u2#1": { end: "install" }, "u2#2": { end: "install" }, "u3#1": { end: "cap" } };
    const r = await go("resume", [S("u1"), S("u2"), S("u3")], scripts, { during: (c) => void setTimeout(() => appendFileSync(c, '{"resume":"none","model":"opus"}\n'), 150) });
    expect(r.logs.filter((l) => l.includes("To resume a cell on this lease")).length).toBe(1);
    expect(r.live.batch.log.some((l) => l.event === "resume" && l.detail === "none on opus on lease L1")).toBe(true);
    expect(r.binds).toContain("u3#1");
    expect(r.rows.get("u1")!.reasons).toContain("install");
    expect(r.ledgerCalls).toEqual(["close"]);
  });

  test("a stop line for a paused cell's arm stops it, and its unrun sessions are released under that code", async () => {
    const scripts: Scripts = { "u1#1": { end: "install" }, "u1#2": { end: "install" }, "u2#1": { end: "install" }, "u2#2": { end: "install" } };
    const r = await go("stop-paused", [S("u1"), S("u2"), S("u3")], scripts, { during: (c) => void setTimeout(() => appendFileSync(c, '{"code":"E_DX_ARM_DROPPED","arm":"none","why":"the Captain stops the cell"}\n'), 150) });
    expect(r.binds).not.toContain("u3#1");
    expect(r.rows.get("u3")!.code).toBe("E_DX_ARM_DROPPED");
    expect(r.settled.paused).toEqual([]);
  });
});

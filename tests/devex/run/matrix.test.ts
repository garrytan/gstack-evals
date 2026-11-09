// Copyright (c) 2026 Garry Tan. MIT License.
// The pass-2 state matrix (build log decisions 27 to 36): each cell is one state the devex session loop can be in
// (running, install-paused, control-paused, model-stopped, halted) and one event, with the lease, the rows and the exit
// it must end in. Rule G1: an infrastructure or harness failure holds the run (lease open, exit 2, no row for a session
// that never launched); only a cap stop and an ending stop settle after a halt. A fake rig, driver and ledger; no key,
// no network, no model call.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { DEFAULT_POLICY, loadPolicy, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import type { HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { dxArmEnv } from "../../../src/trial/review/devex.ts";
import { runDxSessions, type DxSettle, type DxTree } from "../../../lanes/devex/run/session.ts";
import type { BatchSession } from "../../../lanes/devex/run/batch.ts";
import type { DxRow } from "../../../lanes/devex/run/rows.ts";
import { MODEL_STRINGS, type ArmId, type ModelId } from "../../../lanes/devex/types.ts";

const root = mkdtempSync(join(tmpdir(), "dx-matrix-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (unit: string, model: ModelId, arm: ArmId = "none"): BatchSession => ({ id: [unit, model, arm, 1].join(":"), unit, arm, model, pass: 1, stage: 1, smoke: false });
const INSTALL = [{ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "./setup" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "INSTALL: fail\n" }] } }].map((l) => JSON.stringify(l) + "\n").join("");
const ioError = () => Object.assign(new Error("SQLITE_IOERR: disk I/O error"), { code: "SQLITE_IOERR" });
const line = (v: unknown) => JSON.stringify(v) + "\n";
const END = line({ code: "E_DX_NO_READ", why: "the Captain ends the run" });
const STOP_LENS = line({ code: "E_DX_ARM_DROPPED", arm: "lens", why: "the Captain drops lens" });
const DRIFT = (model: ModelId) => line({ code: "E_DX_PROVIDER_DRIFT", model, why: "drift seen" });
const KAPPA = (model: ModelId) => line({ code: "E_DX_JUDGE_KAPPA", model, why: "kappa under the bar" });
const RESUME = (arm: ArmId, model: ModelId) => line({ resume: arm, model });

interface Script {
  end?: "done" | "infra" | "cap" | "install" | "arm-stop";
  wait?: number;
  bindFail?: boolean;
  bindWait?: number;
  finalizeThrow?: boolean;
  onRun?: boolean;
  occupyNext?: boolean;
  meter?: { by_model?: Record<string, { micros: number; requests: number }> };
}
interface Plan {
  sessions: BatchSession[];
  scripts?: Record<string, Script>;
  /** The control line a script's onRun appends. */
  event?: string;
  parallel?: number;
  /** Lines the control file holds at the start; null runs with no control file, "absent" names one that does not exist yet. */
  control?: string[] | null | "absent";
  fault?: { stopScope?: string; settleScope?: string };
  deadlineMs?: number;
  /** Runs when the loop logs a line; add appends a control line, create writes the control file. */
  onLog?: (l: string, add: (text: string) => void, create: (text: string) => void) => void;
  meters?: Record<string, { held_micros: number; spent_micros: number; unknown_micros: number; unknown_calls: number }>;
  missingTree?: string;
}
interface Ran {
  settled: DxSettle;
  rows: Map<string, DxRow>;
  binds: string[];
  unbinds: string[];
  ledgerCalls: string[];
  logs: string[];
}

let n = 0;
async function go(p: Plan): Promise<Ran> {
  const name = "m" + n++;
  const out = join(root, name);
  const control = join(root, name + "-control.ndjson");
  if (p.control !== "absent" && p.control !== null) writeFileSync(control, (p.control ?? []).join(""));
  const add = (text: string) => appendFileSync(control, text);
  const create = (text: string) => writeFileSync(control, text);
  const trees: Record<string, DxTree> = {};
  for (const u of new Set(p.sessions.map((s) => s.unit))) {
    if (u === p.missingTree) continue;
    const t = join(root, "trees", u);
    mkdirSync(join(t, "repo"), { recursive: true });
    writeFileSync(join(t, "plan.md"), "Add an init command.\n");
    writeFileSync(join(t, "repo", "a.ts"), "export {};\n");
    trees[u] = { task: u, plain: t, autoplan: null };
  }
  const scripts = p.scripts ?? {};
  const binds: string[] = [];
  const unbinds: string[] = [];
  const ledgerCalls: string[] = [];
  const ledger = {
    stopScope: (_l: string, scope: { field: string; value: string }, code: string) => {
      ledgerCalls.push("stop " + scope.field + " " + scope.value + " " + code);
      if (p.fault?.stopScope === scope.value) throw ioError();
      return { in_flight: 0 };
    },
    settleScope: (_l: string, scope: { field: string; value: string }) => {
      ledgerCalls.push("settle-scope " + scope.value);
      if (p.fault?.settleScope === scope.value) throw ioError();
      return { settled_calls: 0, spent_micros: 0, unknown_calls: 0, unknown_micros: 0 };
    },
    stageClose: (_l: string, cap?: string) => (ledgerCalls.push("close" + (cap ? " " + cap : "")), { kind: "close" }),
    markClosed: () => {},
    meters: () => new Map(Object.entries(p.meters ?? {})),
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
  const install = { tree_sha256: "tree", skill: null, gstack: null, plugins: [] };
  const rig: HostRig = {
    baseUrl: "http://127.0.0.1:1", network: null, imageDigest: null,
    bind: async (req) => {
      const key = req.cell.task + "#" + req.cell.attempt;
      const sc = scripts[key] ?? {};
      if (sc.bindWait) await sleep(sc.bindWait);
      if (sc.bindFail) throw new Error("E_LEDGER_UNAVAILABLE: the proxy did not answer the bind");
      binds.push(key);
      return { slot: "slot-" + key, token: "t", meter_id: key } as unknown as Awaited<ReturnType<HostRig["bind"]>>;
    },
    finalize: async (id) => {
      if (scripts[id]?.finalizeThrow) throw new Error("the management socket hung up");
      return { meter_id: id, micros: 1_000, requests: 1, unknown: 0, refused: 0, unsettled: 0, undrained: 0, by_model: scripts[id]?.meter?.by_model ?? {} } as unknown as Awaited<ReturnType<HostRig["finalize"]>>;
    },
    unbind: (slot) => void unbinds.push(slot),
    arms: { none: install, lens: install } as unknown as HostRig["arms"],
    sandbox: () => box,
    judgeSandbox: () => box,
    egress: () => ({ open: false, detail: "test" }),
    close: async () => ({ committed: 0, unknown: 0, lease_id: "L1" }),
    recovery: null,
    driver: (opt) => ({
      env: dxArmEnv("none"),
      run: async () => {
        const sc = scripts[at(opt.out)] ?? {};
        if (sc.onRun && p.event) add(p.event);
        if (sc.wait) await sleep(sc.wait);
        if (sc.occupyNext) mkdirSync(join(opt.out, "..", "..", "attempt-2"), { recursive: true });
        const end = sc.end ?? "done";
        mkdirSync(opt.out, { recursive: true });
        if (end === "install") writeFileSync(join(opt.out, "transcript.ndjson"), INSTALL);
        if (end === "done" || end === "arm-stop") writeFileSync(join(opt.out, "transcript.ndjson"), "");
        const termination = end === "cap" ? { kind: "cap_stop" } : end === "done" ? { kind: "completed" } : end === "arm-stop" ? { kind: "turn_cap" } : { kind: "arm_failure", incident: "scripted" };
        return { termination, turns: 0 };
      },
    }) as unknown as ReturnType<NonNullable<HostRig["driver"]>>,
  };
  const logs: string[] = [];
  const live = await runDxSessions({ run: "s1-none", runId: "dx-s1-runs", sessions: p.sessions, trees, rig, ledger, record: null, lease: "L1", policy, out, parallel: p.parallel ?? 1, doubled: false, repairs: new Map(), pin: root, control: p.control === null ? null : control, pollMs: 10, pauseDeadlineMs: p.deadlineMs ?? 60_000, log: (l) => {
    logs.push(l);
    p.onLog?.(l, add, create);
  } });
  const settled = live.settle();
  const file = join(out, "rows.ndjson");
  const rows = new Map((existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l) as DxRow).map((r) => [r.unit, r]));
  return { settled, rows, binds, unbinds, ledgerCalls, logs };
}

interface Want {
  lease: "settled" | "open";
  /** The close's cap stop, by its leading code, when it carries one. */
  closeCap?: string;
  exit: 0 | 2;
  stop: string | null;
  held?: string;
  /** Each planned session's row code (a block-free completed reply is E_DX_NO_BLOCK), or null for no row. */
  rows: Record<string, string | null>;
}
function expectCell(r: Ran, w: Want) {
  const closes = r.ledgerCalls.filter((c) => c.startsWith("close"));
  if (w.lease === "settled") {
    expect(closes.length).toBe(1);
    if (w.closeCap) expect(closes[0]!.startsWith("close " + w.closeCap + " ")).toBe(true);
    else expect(closes[0]).toBe("close");
    expect(r.settled.held).toBeNull();
  } else {
    expect(closes).toEqual([]);
    expect(r.settled.close).toBeNull();
    expect(r.settled.released).toEqual([]);
  }
  expect(r.settled.exit).toBe(w.exit);
  expect(r.settled.stop).toBe(w.stop);
  if (w.held) expect(r.settled.held?.startsWith(w.held + ": ")).toBe(true);
  else expect(r.settled.held).toBeNull();
  const got = Object.fromEntries(Object.keys(w.rows).map((u) => [u, r.rows.get(u)?.code ?? (r.rows.has(u) ? "no code" : null)]));
  expect(got).toEqual(w.rows);
  expect(r.rows.size).toBe(Object.values(w.rows).filter((c) => c !== null).length);
}

const NB = "E_DX_NO_BLOCK";
const INFRA = "E_DX_INFRA_MISSING";
const twice = (unit: string, s: Script) => ({ [unit + "#1"]: s, [unit + "#2"]: s });
const installed = (...units: string[]) => Object.assign({}, ...units.map((u) => twice(u, { end: "install" })));

describe("state matrix: running", () => {
  const base = () => [S("a1", "opus"), S("a2", "opus"), S("b1", "sol"), S("c1", "opus", "lens")];
  test("R1 end-code line: settles with the end code on the close; unrun sessions missing under it; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { onRun: true } }, event: END });
    expectCell(r, { lease: "settled", closeCap: "E_DX_NO_READ", exit: 2, stop: "E_DX_NO_READ", rows: { a1: NB, a2: "E_DX_NO_READ", b1: "E_DX_NO_READ", c1: "E_DX_NO_READ" } });
  });
  test("R2 stop line: the arm's unrun sessions are released under its code; the rest run; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { onRun: true } }, event: STOP_LENS });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, a2: NB, b1: NB, c1: "E_DX_ARM_DROPPED" } });
  });
  test("R3 drift line: the model stops and its scope settles; its unrun sessions are released; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { onRun: true } }, event: DRIFT("sol") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, a2: NB, b1: "E_DX_PROVIDER_DRIFT", c1: NB } });
    expect(r.ledgerCalls).toContain("settle-scope " + MODEL_STRINGS.sol);
  });
  test("R4 model-stop line: as a drift line under its own code; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { onRun: true } }, event: KAPPA("sol") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, a2: NB, b1: "E_DX_JUDGE_KAPPA", c1: NB } });
  });
  test("R5 cap stop: the session whose retry the halt blocks ends missing under CAP_STOP, not E_DX_ARM_STOP; an ordinary close; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: { "a1#1": { end: "cap" }, "a2#1": { end: "arm-stop", wait: 80 } } });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: { a1: "CAP_STOP", a2: "CAP_STOP", b1: "CAP_STOP", c1: "CAP_STOP" } });
    expect(r.binds).not.toContain("a2#2");
    expect(r.rows.get("a2")!.end).toBe("missing");
  });
  test("R6 no control file: nothing is read and every session runs; exit 0", async () => {
    const r = await go({ sessions: base(), control: null });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, a2: NB, b1: NB, c1: NB } });
  });
  test("R7 worker error (SQLITE_IOERR in poll's stopScope): the run holds, the lease stays open, no session is released; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { onRun: true } }, event: DRIFT("sol"), fault: { stopScope: MODEL_STRINGS.sol } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: NB, a2: null, b1: null, c1: null } });
  });
  test("R8 a bind that fails after its retry: that session is missing and unlaunched, and the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: twice("a1", { bindFail: true }) });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: INFRA, a2: null, b1: null, c1: null } });
    expect(r.rows.get("a1")!.launched).toBe(false);
    expect(r.binds).toEqual([]);
  });
  test("R9 a finalize that throws: the row takes the ledger's spend and cost_unknown, nothing retries, the slot unbinds, and the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { "a1#1": { finalizeThrow: true } }, meters: { "a1#1": { held_micros: 4_321, spent_micros: 1_000, unknown_micros: 3_321, unknown_calls: 1 } } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: INFRA, a2: null, b1: null, c1: null } });
    expect(r.rows.get("a1")).toMatchObject({ end: "missing", spend_micros: 4_321, cost_unknown: true, launched: true });
    expect(r.binds).toEqual(["a1#1"]);
    expect(r.unbinds).toEqual(["slot-a1#1"]);
  });
  test("R10 pause deadline with no pause: nothing waits and nothing holds; exit 0", async () => {
    const r = await go({ sessions: base(), deadlineMs: 1 });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, a2: NB, b1: NB, c1: NB } });
  });
  test("R11 malformed control line: the run holds under E_USAGE and releases no session as E_USAGE; exit 2", async () => {
    const r = await go({ sessions: base(), control: ["not json\n"] });
    expectCell(r, { lease: "open", exit: 2, stop: "E_USAGE", held: "E_USAGE", rows: { a1: null, a2: null, b1: null, c1: null } });
    expect(r.binds).toEqual([]);
  });
  test("R12 a launch that throws before any bind: the run holds under its code and that session has no row; exit 2", async () => {
    const r = await go({ sessions: base(), missingTree: "a2" });
    expectCell(r, { lease: "open", exit: 2, stop: "E_USAGE", held: "E_USAGE", rows: { a1: NB, a2: null, b1: null, c1: null } });
  });
});

describe("state matrix: install-paused (lens on sol paused while other cells run)", () => {
  const base = () => [S("l1", "sol", "lens"), S("l2", "sol", "lens"), S("a1", "opus"), S("l3", "sol", "lens"), S("a2", "opus"), S("c1", "particle")];
  const paused = installed("l1", "l2");
  test("I1 end-code line: settles over the pause with the end code; every unrun session missing under it; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { onRun: true } }, event: END });
    expectCell(r, { lease: "settled", closeCap: "E_DX_NO_READ", exit: 2, stop: "E_DX_NO_READ", rows: { l1: INFRA, l2: INFRA, a1: NB, l3: "E_DX_NO_READ", a2: "E_DX_NO_READ", c1: "E_DX_NO_READ" } });
  });
  test("I2 stop line for the paused arm: the pause clears and its unrun session is released; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { onRun: true } }, event: STOP_LENS });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: "E_DX_ARM_DROPPED", a2: NB, c1: NB } });
  });
  test("I3 drift line for the paused model: stopModel clears the pause; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { onRun: true } }, event: DRIFT("sol") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: "E_DX_PROVIDER_DRIFT", a2: NB, c1: NB } });
  });
  test("I4 model-stop line for the paused model: stopModel clears the pause; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { onRun: true } }, event: KAPPA("sol") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: "E_DX_JUDGE_KAPPA", a2: NB, c1: NB } });
  });
  test("I5 cap stop: the pause keeps the lease open (decision 9) and the unrun sessions get no row; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { end: "cap" } } });
    expectCell(r, { lease: "open", exit: 2, stop: "CAP_STOP", rows: { l1: INFRA, l2: INFRA, a1: "CAP_STOP", l3: null, a2: null, c1: null } });
  });
  test("I6 no control file: the other cells run, then the run ends with the lease open (decision 9); exit 2", async () => {
    const r = await go({ sessions: base(), scripts: paused, control: null });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: null, a2: NB, c1: NB } });
    expect(r.logs.some((l) => l.includes("paused with no control file"))).toBe(true);
  });
  test("I7 worker error (SQLITE_IOERR in settleModelIfIdle): the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { onRun: true } }, event: DRIFT("particle"), fault: { settleScope: MODEL_STRINGS.particle } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: null, a2: null, c1: null } });
  });
  test("I8 a bind that fails after its retry: the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, ...twice("a1", { bindFail: true }) } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { l1: INFRA, l2: INFRA, a1: INFRA, l3: null, a2: null, c1: null } });
    expect(r.rows.get("a1")!.launched).toBe(false);
  });
  test("I9 a finalize that throws: cost_unknown at the ledger's spend, and the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { finalizeThrow: true } }, meters: { "a1#1": { held_micros: 2_000, spent_micros: 0, unknown_micros: 2_000, unknown_calls: 1 } } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { l1: INFRA, l2: INFRA, a1: INFRA, l3: null, a2: null, c1: null } });
    expect(r.rows.get("a1")).toMatchObject({ spend_micros: 2_000, cost_unknown: true });
  });
  test("I10 pause deadline while other cells run: the next control read holds the run; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: { ...paused, "a1#1": { wait: 80 } }, deadlineMs: 30 });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { l1: INFRA, l2: INFRA, a1: NB, l3: null, a2: null, c1: null } });
    expect(r.settled.held).toMatch(/lens on sol has waited more than 30 ms/);
  });
});

describe("state matrix: control-paused (the run waits on the control file)", () => {
  const base = () => [S("c1", "particle"), S("l1", "sol", "lens"), S("l2", "sol", "lens"), S("l3", "sol", "lens")];
  const two = () => [S("c1", "particle"), S("l1", "sol", "lens"), S("l2", "sol", "lens"), S("p1", "particle", "lens"), S("p2", "particle", "lens"), S("l3", "sol", "lens"), S("p3", "particle", "lens")];
  const paused = installed("l1", "l2");
  const later = (text: string, when = "lens on sol paused:") => (l: string, add: (t: string) => void) => {
    if (l.includes(when)) setTimeout(() => add(text), 40);
  };
  test("C1 end-code line: settles over the pause with the end code; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: paused, onLog: later(END) });
    expectCell(r, { lease: "settled", closeCap: "E_DX_NO_READ", exit: 2, stop: "E_DX_NO_READ", rows: { c1: NB, l1: INFRA, l2: INFRA, l3: "E_DX_NO_READ" } });
  });
  test("C2 stop line for the paused arm: the pause clears and the lease settles; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: paused, onLog: later(STOP_LENS) });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: "E_DX_ARM_DROPPED" } });
  });
  test("C3 drift line for the paused model: stopModel clears the pause and the wait ends; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: paused, onLog: later(DRIFT("sol")) });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: "E_DX_PROVIDER_DRIFT" } });
  });
  test("C4 model-stop line for the paused model: stopModel clears the pause and the wait ends; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: paused, onLog: later(KAPPA("sol")) });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: "E_DX_JUDGE_KAPPA" } });
  });
  test("C5 cap stop in a resumed cell: the other cell's pause keeps the lease open; exit 2", async () => {
    const r = await go({ sessions: two(), scripts: { ...paused, ...installed("p1", "p2"), "l3#1": { end: "cap" } }, onLog: later(RESUME("lens", "sol"), "lens on particle paused:") });
    expectCell(r, { lease: "open", exit: 2, stop: "CAP_STOP", rows: { c1: NB, l1: INFRA, l2: INFRA, p1: INFRA, p2: INFRA, l3: "CAP_STOP", p3: null } });
  });
  test("C6 no control file yet: the run waits, and reads the file once it appears; exit 0", async () => {
    const r = await go({ sessions: base(), scripts: paused, control: "absent", onLog: (l, _add, create) => {
      if (l.includes("lens on sol paused:")) setTimeout(() => create(RESUME("lens", "sol")), 40);
    } });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: NB } });
  });
  test("C7 worker error (SQLITE_IOERR in poll during the wait): the run holds with the pause in place; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: paused, onLog: later(DRIFT("particle")), fault: { stopScope: MODEL_STRINGS.particle } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: null } });
    expect(r.settled.paused.length).toBe(1);
  });
  test("C8 a bind that fails after its retry in a resumed cell: the run holds; exit 2", async () => {
    const r = await go({ sessions: two(), scripts: { ...paused, ...installed("p1", "p2"), ...twice("l3", { bindFail: true }) }, onLog: later(RESUME("lens", "sol"), "lens on particle paused:") });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { c1: NB, l1: INFRA, l2: INFRA, p1: INFRA, p2: INFRA, l3: INFRA, p3: null } });
    expect(r.rows.get("l3")!.launched).toBe(false);
  });
  test("C9 a finalize that throws in a resumed cell: cost_unknown, and the run holds; exit 2", async () => {
    const r = await go({ sessions: two(), scripts: { ...paused, ...installed("p1", "p2"), "l3#1": { finalizeThrow: true } }, onLog: later(RESUME("lens", "sol"), "lens on particle paused:") });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { c1: NB, l1: INFRA, l2: INFRA, p1: INFRA, p2: INFRA, l3: INFRA, p3: null } });
    expect(r.rows.get("l3")!.cost_unknown).toBe(true);
  });
  test("C10 pause deadline during the wait: the run holds with the lease open; exit 2", async () => {
    const r = await go({ sessions: base(), scripts: paused, deadlineMs: 60 });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { c1: NB, l1: INFRA, l2: INFRA, l3: null } });
  });
});

describe("state matrix: model-stopped (sol stopped by a drift line before the first session)", () => {
  const base = () => [S("a1", "opus"), S("b1", "sol"), S("a2", "opus"), S("c1", "particle"), S("d1", "opus", "lens")];
  const stopped = [DRIFT("sol")];
  test("M1 end-code line: settles with the end code; the stopped model keeps its stop's code; exit 2", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { onRun: true } }, event: END });
    expectCell(r, { lease: "settled", closeCap: "E_DX_NO_READ", exit: 2, stop: "E_DX_NO_READ", rows: { a1: NB, b1: "E_DX_PROVIDER_DRIFT", a2: "E_DX_NO_READ", c1: "E_DX_NO_READ", d1: "E_DX_NO_READ" } });
  });
  test("M2 stop line: both stops release their own sessions; exit 0", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { onRun: true } }, event: STOP_LENS });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, b1: "E_DX_PROVIDER_DRIFT", a2: NB, c1: NB, d1: "E_DX_ARM_DROPPED" } });
  });
  test("M3 drift line for another model: both models stop and both scopes settle; exit 0", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { onRun: true } }, event: DRIFT("particle") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, b1: "E_DX_PROVIDER_DRIFT", a2: NB, c1: "E_DX_PROVIDER_DRIFT", d1: NB } });
    expect(r.ledgerCalls.filter((c) => c.startsWith("settle-scope "))).toEqual(["settle-scope " + MODEL_STRINGS.sol, "settle-scope " + MODEL_STRINGS.particle]);
  });
  test("M4 model-stop line for the stopped model: the first stop stands and no second scope stop is sent; exit 0", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { onRun: true } }, event: KAPPA("sol") });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: NB, b1: "E_DX_PROVIDER_DRIFT", a2: NB, c1: NB, d1: NB } });
    expect(r.ledgerCalls.filter((c) => c.startsWith("stop model ")).length).toBe(1);
  });
  test("M5 cap stop: an ordinary close; the stopped model keeps its code and the rest are CAP_STOP; exit 2", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { end: "cap" } } });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: { a1: "CAP_STOP", b1: "E_DX_PROVIDER_DRIFT", a2: "CAP_STOP", c1: "CAP_STOP", d1: "CAP_STOP" } });
  });
  test("M6 no control file, drift from the meter: the model stops as a drift line would; exit 0", async () => {
    const r = await go({ sessions: base(), control: null, scripts: { "a1#1": { meter: { by_model: { "openrouter:some/other-model": { micros: 1, requests: 1 } } } } } });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { a1: "E_DX_PROVIDER_DRIFT", b1: NB, a2: "E_DX_PROVIDER_DRIFT", c1: NB, d1: "E_DX_PROVIDER_DRIFT" } });
  });
  test("M7 worker error (SQLITE_IOERR in settleModelIfIdle): the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { onRun: true } }, event: DRIFT("particle"), fault: { settleScope: MODEL_STRINGS.particle } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: NB, b1: null, a2: null, c1: null, d1: null } });
  });
  test("M8 a bind that fails after its retry: the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: twice("a1", { bindFail: true }) });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: INFRA, b1: null, a2: null, c1: null, d1: null } });
  });
  test("M9 a finalize that throws: cost_unknown, and the run holds; exit 2", async () => {
    const r = await go({ sessions: base(), control: stopped, scripts: { "a1#1": { finalizeThrow: true } } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: INFRA, b1: null, a2: null, c1: null, d1: null } });
    expect(r.rows.get("a1")!.cost_unknown).toBe(true);
  });
  test("M10 pause deadline on a paused cell whose model then stops: stopModel clears the pause, so nothing holds; exit 0", async () => {
    const sessions = [S("l1", "sol", "lens"), S("l2", "sol", "lens"), S("l3", "sol", "lens"), S("a1", "opus"), S("a2", "opus")];
    const r = await go({ sessions, scripts: { ...installed("l1"), "l2#1": { end: "install" }, "l2#2": { end: "install", onRun: true } }, event: DRIFT("sol"), deadlineMs: 1 });
    expectCell(r, { lease: "settled", exit: 0, stop: null, rows: { l1: INFRA, l2: INFRA, l3: "E_DX_PROVIDER_DRIFT", a1: NB, a2: NB } });
    expect(r.settled.paused).toEqual([]);
  });
});

describe("state matrix: halted (a cap stop while another session is in flight)", () => {
  const base = () => [S("a1", "opus"), S("a2", "opus"), S("a3", "opus"), S("b1", "sol"), S("d1", "opus", "lens")];
  const capped = (extra: Record<string, Script> = {}) => ({ "a1#1": { end: "cap" as const, onRun: true }, "a2#1": { wait: 80 }, ...extra });
  const cap = { a1: "CAP_STOP", a2: NB, a3: "CAP_STOP", b1: "CAP_STOP", d1: "CAP_STOP" };
  test("H1 end-code line after the halt: the close carries the end code; released rows keep the first stop, CAP_STOP; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped(), event: END });
    expectCell(r, { lease: "settled", closeCap: "E_DX_NO_READ", exit: 2, stop: "CAP_STOP", rows: cap });
  });
  test("H2 stop line after the halt: settles; released rows keep CAP_STOP; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped(), event: STOP_LENS });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: cap });
  });
  test("H3 drift line after the halt: settles; released rows keep CAP_STOP; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped(), event: DRIFT("sol") });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: cap });
  });
  test("H4 model-stop line after the halt: settles; released rows keep CAP_STOP; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped(), event: KAPPA("sol") });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: cap });
  });
  test("H5 a second cap stop: one halt and one close; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped({ "a2#1": { wait: 80, end: "cap" } }) });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: { ...cap, a2: "CAP_STOP" } });
  });
  test("H6 no control file: the halt settles as before; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, control: null, scripts: capped() });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: cap });
  });
  test("H7 worker error (SQLITE_IOERR in poll) after the halt: the hold outranks the cap settle and the lease stays open; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped(), event: DRIFT("sol"), fault: { stopScope: MODEL_STRINGS.sol } });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: "CAP_STOP", a2: NB, a3: null, b1: null, d1: null } });
  });
  test("H8 a bind that fails after the halt: the halt blocks its retry, so the session is missing under CAP_STOP and nothing holds; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: { "a1#1": { end: "cap" }, "a2#1": { bindWait: 80, bindFail: true } } });
    expectCell(r, { lease: "settled", exit: 2, stop: "CAP_STOP", rows: { ...cap, a2: "CAP_STOP" } });
    expect(r.rows.get("a2")!.launched).toBe(false);
  });
  test("H9 a finalize that throws after the halt: cost_unknown, and the hold keeps the lease open; exit 2", async () => {
    const r = await go({ sessions: base(), parallel: 2, scripts: capped({ "a2#1": { wait: 80, finalizeThrow: true } }) });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { a1: "CAP_STOP", a2: INFRA, a3: null, b1: null, d1: null } });
    expect(r.rows.get("a2")!.cost_unknown).toBe(true);
  });
  test("H10 pause deadline after the halt: the hold outranks the halt and the lease stays open; exit 2", async () => {
    const sessions = [S("l1", "sol", "lens"), S("l2", "sol", "lens"), S("l3", "sol", "lens"), S("a1", "opus"), S("a2", "opus")];
    const r = await go({ sessions, scripts: { ...installed("l1", "l2"), "a1#1": { end: "cap", wait: 60 } }, deadlineMs: 30 });
    expectCell(r, { lease: "open", exit: 2, stop: INFRA, held: INFRA, rows: { l1: INFRA, l2: INFRA, l3: null, a1: "CAP_STOP", a2: null } });
  });
});

describe("ruling 10: a launch-throw row keeps its attempts' limit stops and reasons", () => {
  test("a limit stop on attempt 1, then a launch that throws before attempt 2: the row is launched and missing under the throw's code, with its limit stop", async () => {
    const r = await go({ sessions: [S("a1", "opus"), S("a2", "opus")], scripts: { "a1#1": { end: "arm-stop", occupyNext: true } } });
    expectCell(r, { lease: "open", exit: 2, stop: "E_USAGE", held: "E_USAGE", rows: { a1: "E_USAGE", a2: null } });
    expect(r.rows.get("a1")).toMatchObject({ launched: true, end: "missing", limit_stops: 1, spend_micros: 1_000 });
    expect(r.rows.get("a1")!.reasons).not.toEqual([]);
  });
});

// Copyright (c) 2026 Garry Tan. MIT License.
// The devex session loop (prereg 2026-11-09-geva-417, sections 5, 6, 10 and 14; section 15 rules 3, 4 and 7): the
// sessions of one frozen run, on that run's one ledger lease, through DxBatch in plan order and at most 8 at once.
// review-units --plan devex (src/trial/review/dx-cli.ts) runs it on the Docker rig; the dry run runs it on a fake
// upstream behind the real metering proxy.
//
// - dxPlan builds a stage 1 run's planned sessions: s1-none is 16 calibration units x 3 passes x 3 models on arm none;
//   s1-smoke is leases.ts SMOKE on units 1 to 10 in draw order; s1-resmoke is SMOKE for the repaired arms only, as
//   pass 2. Stage 2 runs are not planned here.
// - Each attempt binds a slot at the session's dollar limit (dxLimits: $12, 200 turns, 120 minutes, doubled only under
//   --repair double-limits; capStops on, so a hit reads allowance_stop, turn_cap or a timeout), seeds the unit tree
//   (autoplan's wrapped plan) as the work dir mounted at /work with cwd /work, and runs Claude Code with the
//   claude-code-preset system prompt, the arm's prompt (devex.ts dxPrompt), the arm's env (dxArmEnv, checked on the
//   driver's env before the session), the rec persona (DX_REC_USER, dxFreeform logging to host/persona.ndjson, and
//   DX_FOLLOW_UP once), memoryLog on, plan-tune state pinned empty in the gstack arms (dxPlanTuneState) and the gstack
//   state root copied to host/gstack-state. The driver denies WebSearch and WebFetch (DISALLOWED_TOOLS). none and lens
//   refuse an install that holds gstack or a skill. The harness seeds a gstack state root (.gstack-home) into every work
//   dir and names it in GSTACK_STATE_ROOT and GSTACK_HOME; for none and lens the session's sandbox removes that folder and
//   both names before the agent starts, so those arms see /work/plan.md and /work/repo only and no gstack state.
// - The repair the arm runs under: the Stop hook (stophook.ts makeStopHook, host/stop-hook.ndjson) for
//   plan-devex-review, gstack's stop gate settings at the pin (devex.ts dxAutoplanGateSettings) for autoplan, or the
//   doubled limits for every arm. Its name goes on every row.
// - The install, skill and env checks run before the slot binds. After each attempt, run/parse.ts dxAttempt reads its
//   outcome, and run/rows.ts nextAttempt says whether the one retry runs. An infrastructure failure is reconciled first
//   (the meter's finalize settles every call with no recorded outcome as unknown spend, then the slot unbinds) and logged
//   to recoveries.ndjson before the retry launches (J1 rules 1, 3 and 5). A meter with calls undrained or unsettled, or a
//   finalize or unbind that fails, is not reconciled: the session ends missing under E_DX_INFRA_MISSING, nothing retries,
//   and the run holds. A finalize that fails leaves the attempt's spend as the ledger's figure for its meter (settled
//   calls plus the full reservation of the rest) and marks the row cost_unknown. A bind failure is the attempt's infra
//   outcome; a bind that fails on the session's last allowed attempt holds the run. No retry starts once a halt, a hold
//   or a stop on the session's model or arm has applied, and a session whose retry a stop blocked ends missing under the
//   stop's code. A cap stop halts the batch.
// - Holds (the Captain's rule G1): an infrastructure or harness failure never settles the lease, uses up the frozen run
//   or becomes a scored row. A worker error, a launch that throws, the bind, finalize and meter faults above, a malformed
//   control line and a pause past its deadline each hold the run: no session starts after it, the sessions in flight
//   end, the lease stays open, a session that launched keeps its row and a session that never launched gets none, and
//   settle reports the hold's code for the CLI's exit. Only a cap stop and an ending stop (rule 3) settle after a halt.
// - The first bound attempt writes the lease's launch mark (markLaunched) before its agent starts: from then on the lease
//   is its frozen run. A lease that settles with no launch is voided (voidLease) and its run is not used up.
// - Each session ends in one row (dxRow) in rows.ndjson: exposure from exposure.ts sessionExposure, dx_lens, the session
//   kind the pin's own bin/gstack-session-kind reports in the session's env with autoplan's lean mode (dxSessionKind),
//   answer counts and the repair. A session whose meter shows another model is missing under E_DX_PROVIDER_DRIFT, and
//   that model stops on the lease. Sessions a stop released get a missing row at settle under the code of the first stop
//   that applied to them.
// - Stops: a per-model stop scopes the model and settles its scope once its sends are over (DxBatch.stopModel); an arm
//   stop scopes the arm and leaves the lease open (stopArm); both are routed by leases.ts stopAction, from the drift
//   check or from a control file line the Captain writes ({"code", "model" or "arm", "why"}), read before each start,
//   newline-terminated lines only. A line whose code routes nowhere, or a scope stop missing its model or arm, halts the
//   batch for the Captain. Two INSTALL: fail sessions in one cell pause that cell: the run keeps its process and lease and
//   rereads the control file until a {"resume": arm, "model"} line resumes the cell on the same lease, a stop line stops
//   its arm or its model (either clears the pause) or an ending stop settles the lease over it. A pause that waits past
//   its deadline (24 hours) holds the run; with no control file the run ends with the lease open (decision 9).
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { BACKGROUND_WAIT_MS } from "../../../src/adapters/claude-code/driver.ts";
import { hostDriver, type HostDriverOptions } from "../../../src/adapters/host.ts";
import { isReasonCode, type ReasonCode } from "../../../src/errors/codes.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { claimSlot, readItem, type CloseFile } from "../../../src/runner/ledger/record.ts";
import { providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { armNamespaces, slotModels, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { DX_ARMS, DX_LENS, DX_PROMPT_SHA256, DX_SYSTEM_PROMPT, dxArmEnv, dxAutoplanGateSettings, dxLimits, dxPlanTuneState, dxPrompt, dxSessionKind } from "../../../src/trial/review/devex.ts";
import { reviewSandbox } from "../../../src/trial/review/run.ts";
import { GATE_DEADLINE_MS } from "../../../src/trial/review/skill-gates.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import type { Sandbox } from "../../../src/trial/sandbox.ts";
import { runTrial } from "../../../src/trial/trial.ts";
import type { Termination } from "../../../src/types.ts";
import { FULL, SMOKE, stopAction, type Design } from "../leases.ts";
import { MODEL_IDS, MODEL_STRINGS, type ArmId, type ModelId } from "../types.ts";
import { CALIBRATION_UNITS, NONE_PASSES } from "../score/rules.ts";
import { DxBatch, type ArmStop, type BatchSession, type ModelStop } from "./batch.ts";
import { sessionExposure } from "./exposure.ts";
import { dxAttempt, type DxAttempt } from "./parse.ts";
import { answerCounts, DX_FOLLOW_UP, DX_REC_USER, dxFreeform } from "./persona.ts";
import { dxRow, installStops, nextAttempt, type DxAttemptInput, type DxRow } from "./rows.ts";
import { makeStopHook, REPAIR_NAME, type Repair } from "./stophook.ts";

export const STAGE1_RUNS = ["s1-none", "s1-smoke", "s1-resmoke"] as const;
export type Stage1Run = (typeof STAGE1_RUNS)[number];
export const isStage1Run = (id: string): id is Stage1Run => (STAGE1_RUNS as readonly string[]).includes(id);
export { CALIBRATION_UNITS, NONE_PASSES };
export const MAX_PARALLEL = 8;
/** How long a paused cell waits for the Captain's word before the run holds. */
export const PAUSE_DEADLINE_MS = 24 * 60 * 60 * 1000;
/** Smoke units by position in draw order (0-based): the gstack arms on Opus, on Sol and particle-1, and lens on Opus. */
const SMOKE_AT = { opus: [0, 1, 2, 3, 4, 5], other: [6, 7], lens: [8, 9] } as const;

const planned = (unit: string, arm: ArmId, model: ModelId, pass: number, smoke: boolean): BatchSession => ({ id: [unit, model, arm, pass].join(":"), unit, arm, model, pass, stage: 1, smoke });

/** A stage 1 frozen run's planned sessions in plan order, or why the units and arms given can't make it. */
export function dxPlan(run: Stage1Run, units: readonly string[], resmoke: readonly ArmId[] = []): { sessions: BatchSession[] } | { problem: string } {
  if (run === "s1-none") {
    if (units.length !== CALIBRATION_UNITS) return { problem: "s1-none runs the " + CALIBRATION_UNITS + " calibration units, and " + units.length + " are named" };
    const sessions: BatchSession[] = [];
    for (let pass = 1; pass <= NONE_PASSES; pass++) for (const model of MODEL_IDS) for (const unit of units) sessions.push(planned(unit, "none", model, pass, false));
    return { sessions };
  }
  if (units.length < 10) return { problem: run + " runs on calibration units 1 to 10 in draw order, and " + units.length + " are named" };
  if (run === "s1-resmoke" && !resmoke.length) return { problem: "s1-resmoke reruns the repaired arms, and none is named" };
  const sessions: BatchSession[] = [];
  for (const [model, arm, n] of SMOKE) {
    if (run === "s1-resmoke" && !resmoke.includes(arm)) continue;
    const at = arm === "lens" ? SMOKE_AT.lens : model === "opus" ? SMOKE_AT.opus : SMOKE_AT.other;
    if (at.length !== n) return { problem: "the smoke table gives " + arm + " on " + model + " " + n + " sessions, not " + at.length };
    for (const i of at) sessions.push(planned(units[i]!, arm, model, run === "s1-smoke" ? 1 : 2, true));
  }
  return { sessions };
}

/**
 * What a stage 1 run opens its lease with, given how many of the item's leases count as runs (stage1Runs): the design
 * whose re-smoke is the arms named, and the runs already opened. Stage 1's runs open in STAGE1_RUNS order, one counted
 * lease each, so the item's first k counted leases are its first k runs; a run the record already shows a counted lease
 * for, or one that skips ahead, is refused.
 */
export function stage1Open(run: Stage1Run, arms: readonly ArmId[], leases: number): { design: Design; opened: Stage1Run[] } | { problem: string; fix: string } {
  const at = STAGE1_RUNS.indexOf(run);
  if (leases > at) return { problem: "the approval record already shows " + leases + " lease" + (leases === 1 ? "" : "s") + " on stage 1's item, opened in the order " + STAGE1_RUNS.slice(0, leases).join(", ") + ", so " + run + " has had its one lease; a stopped run is incomplete and is never rerun", fix: leases < STAGE1_RUNS.length ? "run " + STAGE1_RUNS[leases] + " next, or take the stop to the Captain" : "take the stop to the Captain" };
  if (leases < at) return { problem: run + " opens after " + STAGE1_RUNS.slice(leases, at).join(" and ") + ", and the approval record shows " + leases + " lease" + (leases === 1 ? "" : "s") + " on stage 1's item", fix: "run " + STAGE1_RUNS[leases] + " first" };
  return { design: { ...FULL, resmoke: run === "s1-resmoke" ? arms : FULL.resmoke }, opened: STAGE1_RUNS.slice(0, at) };
}

const dxPath = (record: string, ...parts: string[]) => join(record, "dx", ...parts);
const launchPath = (record: string, lease: string) => dxPath(record, "launched", lease + ".json");

/** Marks lease as one a session launched on with a bound attempt (write-once): from then on it counts as its frozen run. */
export function markLaunched(record: string, lease: string, session: string): void {
  claimSlot(launchPath(record, lease), JSON.stringify({ lease, session, at: new Date().toISOString() }) + "\n");
}
export const launchedOn = (record: string, lease: string): boolean => existsSync(launchPath(record, lease));

/** Records that lease closed before any session launched on it, under the code that closed it; its frozen run is not used up. */
export function voidLease(record: string, lease: string, code: string, why: string): string {
  const path = dxPath(record, "void", lease + ".json");
  claimSlot(path, JSON.stringify({ lease, code, why, at: new Date().toISOString() }) + "\n");
  return path;
}

/** How many of the item's leases count as frozen runs: each still open, a session launched on, or that spent anything (decision 17 as amended). */
export function stage1Runs(record: string, item: string): number {
  return readItem(record, item).leases.filter(({ lease, close }) => close === null || launchedOn(record, lease.lease_id) || close.spent_micros + close.unknown_micros > 0).length;
}

/** Counts the item's runs, checks stage1Open and opens the lease under one lock on the item, so two invocations can't both pass. */
export function openStage1Run<R extends object>(record: string, item: string, run: Stage1Run, arms: readonly ArmId[], open: (o: { design: Design; opened: Stage1Run[] }) => R): R | { problem: string; fix: string } {
  const lock = dxPath(record, item + ".open-lock");
  const taken = claimSlot(lock, JSON.stringify({ pid: process.pid, nonce: randomBytes(6).toString("hex"), at: new Date().toISOString() }) + "\n");
  if (taken !== "written") return { problem: "another review-units invocation holds the lease lock " + lock + " on " + item, fix: "wait for it to open its lease; if no invocation is running, remove " + lock };
  try {
    const o = stage1Open(run, arms, stage1Runs(record, item));
    return "problem" in o ? o : open(o);
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Why the driver's agent env does not carry the arm's (dxArmEnv), or null. */
export function armEnvProblem(arm: ArmId, env: Readonly<Record<string, string>>): string | null {
  const want = dxArmEnv(arm);
  const off = Object.entries(want).filter(([k, v]) => env[k] !== v).map(([k, v]) => k + "=" + v);
  if (off.length) return "arm " + arm + "'s agent env lacks " + off.join(" ");
  if (!want.GSTACK_SESSION_KIND && env.GSTACK_SESSION_KIND !== undefined) return "arm " + arm + " runs no gstack, and its agent env sets GSTACK_SESSION_KIND";
  return null;
}

/** The repair an arm's sessions run under, and the name its rows carry. */
export const repairOf = (arm: ArmId, repairs: ReadonlyMap<ArmId, Repair>, doubled: boolean): Repair => repairs.get(arm) ?? (doubled ? "double limits" : "none");
export const repairName = (r: Repair): string | null => REPAIR_NAME[r] ?? (r === "none" ? null : r);

export interface DxTree {
  task: string;
  /** The tree every arm but autoplan sees. */
  plain: string;
  /** autoplan's tree, with the wrapped plan; null when no autoplan session runs. */
  autoplan: string | null;
}

export interface DxRunInput {
  /** The frozen run (leases.ts frozenRuns). */
  run: string;
  /** The ledger cells' run id: the lease's item run id. */
  runId: string;
  sessions: readonly BatchSession[];
  trees: Readonly<Record<string, DxTree>>;
  rig: HostRig;
  ledger: LocalLedger;
  /** The approval record the lease's close is written to; null settles on the local ledger only. */
  record: string | null;
  lease: string;
  policy: LoadedPolicy;
  out: string;
  parallel: number;
  doubled: boolean;
  repairs: ReadonlyMap<ArmId, Repair>;
  /** The pinned gstack checkout whose bin/gstack-session-kind each session's kind is read from. */
  pin: string;
  /** The control file a stop or a paused cell's resume is recorded in mid-run; null reads none. */
  control: string | null;
  /** How often a run with a paused cell rereads the control file; defaults to 5 seconds. */
  pollMs?: number;
  /** How long a paused cell waits for the Captain's word before the run holds; defaults to PAUSE_DEADLINE_MS. */
  pauseDeadlineMs?: number;
  log: (line: string) => void;
}

export interface DxLaunch {
  exposed: boolean | null;
  row: DxRow;
}

export interface DxSettle {
  close: CloseFile | null;
  released: string[];
  paused: string[];
  /** The hold (rule G1) that keeps the lease open, as "<code>: <why>", or null. */
  held: string | null;
  /** The code the run stopped under: a hold's, a pause's, a halt's or an ending stop's; null when it ran to its end. */
  stop: string | null;
  /** The void record written for a lease that settled with no session launched on it, or null. */
  voided: string | null;
  exit: 0 | 2;
}

export interface DxRunResult {
  batch: DxBatch<DxLaunch>;
  rows: DxRow[];
  /** What the session loop threw (a launch or a worker), once every session in flight had ended; the run holds for it. */
  error: unknown;
  /** Settles the lease unless a hold or a pause keeps it open, writes a row for each released session and settled.json. */
  settle: () => DxSettle;
}

const readText = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const line = (file: string, v: unknown) => appendFileSync(file, JSON.stringify(v) + "\n");
const firstLine = (e: unknown): string => ((e as Error)?.message ?? String(e)).split("\n")[0]!;
const leadingCode = (message: string): string => {
  const head = message.split(/[: ]/)[0]!;
  return isReasonCode(head) ? head : "E_DX_INFRA_MISSING";
};

/** A row for a planned session no attempt ran for: missing under the code that released it. */
export function releasedRow(s: BatchSession, code: string, repair: string | null): DxRow {
  return { unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, end: "missing", code, list: null, words: 0, items: 0, cut: 0, exposed: null, markers: {}, session_kind: null, lean: null, dx_lens: null, gstack_read: null, launched: false, retried: false, judged: false, limit_stops: 0, spend_micros: 0, session: [s.unit, s.model, s.arm, s.pass].join(":"), reasons: [], repair, answers: null, unknown_micros: 0, cost_unknown: false };
}

export async function runDxSessions(o: DxRunInput): Promise<DxRunResult> {
  mkdirSync(o.out, { recursive: true });
  const files = { rows: join(o.out, "rows.ndjson"), sessions: join(o.out, "sessions.ndjson"), recoveries: join(o.out, "recoveries.ndjson"), batch: join(o.out, "batch.ndjson"), settled: join(o.out, "settled.json") };
  const empty = join(o.out, "fixtures");
  mkdirSync(empty, { recursive: true });
  const limits = dxLimits(o.doubled);
  const leaseModels = [...new Set(o.sessions.map((s) => s.model))];
  const rows: DxRow[] = [];
  const released = new Map<string, string>();
  const spent = new Map<string, number>();
  const partial = new Map<string, DxAttemptInput[]>();
  const launched = new Set<string>();
  const unbilled = new Map<string, string>();
  const unknownCost = new Set<string>();
  let marked = false;
  const deadline = o.pauseDeadlineMs ?? PAUSE_DEADLINE_MS;
  const span = deadline % 3_600_000 === 0 ? deadline / 3_600_000 + " hours" : deadline + " ms";
  const stops: Array<{ code: string; model?: ModelId; arm?: ArmId }> = [];
  const stopOf = (s: BatchSession): string | null => stops.find((x) => (!x.model && !x.arm) || x.model === s.model || x.arm === s.arm)?.code ?? null;
  const haltFor = (code: string, why: string) => {
    stops.push({ code });
    batch.halt(code + ": " + why);
  };
  let held: string | null = null;
  const hold = (code: string, why: string) => {
    held ??= code + ": " + why;
    haltFor(code, why);
  };
  let ending: string | null = null;
  let endStop: string | null = null;
  const paused = new Set<string>();
  let controlRead = 0;
  let batch!: DxBatch<DxLaunch>;

  /** Routes a stopping code through leases.ts stopAction onto the batch; false when it routes nowhere or lacks its target. */
  const stop = (code: ReasonCode, on: { model?: ModelId; arm?: ArmId }, why: string): boolean => {
    const action = stopAction(code, { stage: 1, model: on.model, lease_models: leaseModels });
    if (action === "scope-model" && on.model) {
      stops.push({ code, model: on.model });
      batch.stopModel(on.model, code as ModelStop, why);
    } else if (action === "scope-arm" && on.arm) {
      stops.push({ code, arm: on.arm });
      batch.stopArm(on.arm, code as ArmStop, why);
    } else if (action === "end" || action === "settle") {
      if (action === "end") endStop ??= code + " " + why;
      ending ??= code + ": " + why;
      haltFor(code, why);
    } else return false;
    o.log(code + " " + (on.model ?? on.arm ?? "run") + ": " + why + " (" + action + ")");
    return true;
  };
  const readControl = () => {
    if (!o.control) return;
    const text = readText(o.control);
    if (text === null) return;
    const lines = text.slice(0, text.lastIndexOf("\n") + 1).split("\n").filter((l) => l.trim());
    for (; controlRead < lines.length; controlRead++) {
      let v: { code?: unknown; model?: unknown; arm?: unknown; why?: unknown; resume?: unknown } | null = null;
      try {
        v = JSON.parse(lines[controlRead]!);
      } catch {
        v = null;
      }
      const code = typeof v?.code === "string" && isReasonCode(v.code) ? v.code : null;
      const model = MODEL_IDS.find((m) => m === v?.model);
      const arm = (Object.keys(DX_ARMS) as ArmId[]).find((a) => a === (v?.resume ?? v?.arm));
      if (v?.resume !== undefined && v.code === undefined && arm && model && batch.pauses().some((p) => p.arm_model === arm + " on " + model)) {
        batch.resume(arm, model);
        continue;
      }
      if (v?.resume === undefined && code && (v?.model === undefined || model) && (v?.arm === undefined || arm) && stop(code, { model, arm }, typeof v?.why === "string" ? v.why : "recorded in the control file")) continue;
      hold("E_USAGE", "control line " + (controlRead + 1) + " does not read as {code, model or arm, why} with a code that stops its target, or as {resume, model} for a paused cell, so no session starts until the Captain looks");
      controlRead = lines.length;
      return;
    }
  };
  const poll = () => {
    readControl();
    const late = batch.pauses().find((p) => Date.now() - p.since > deadline);
    if (late) hold("E_DX_INFRA_MISSING", late.arm_model + " has waited more than " + span + " for the Captain's word, so the run holds with lease " + o.lease + " open");
  };

  const attempt = async (s: BatchSession, n: number, reason: string) => {
    const ms = MODEL_STRINGS[s.model];
    const provider = providerOf(o.policy, ms);
    if (!provider) throw new Error("E_MODEL_POLICY: " + ms + " has no provider in the policy");
    const tree = o.trees[s.unit];
    if (!tree) throw new Error("E_USAGE: unit " + s.unit + " has no tree");
    const seed = s.arm === "autoplan" ? tree.autoplan : tree.plain;
    if (!seed) throw new Error("E_USAGE: unit " + s.unit + " has no autoplan tree");
    const dir = join(o.out, "sessions", s.model, s.arm, tree.task, "pass-" + s.pass, "attempt-" + n);
    if (existsSync(dir)) throw new Error("E_USAGE: the session sink " + dir + " exists before its launch (start rule 7)");
    const spec = DX_ARMS[s.arm];
    const install = o.rig.arms[s.arm];
    if (!install) throw new Error("E_USAGE: the rig has no arm " + s.arm);
    if (!spec.gstack && (install.gstack || install.skill || (install.plugins ?? []).length)) throw new Error("E_USAGE: arm " + s.arm + " runs no gstack install, no skills folder and no drive mount, and its install holds one");
    const base = reviewSandbox(o.rig.sandbox(s.arm, false, ms), DX_LENS);
    const sandbox: Sandbox = spec.gstack ? base : Object.assign(Object.create(base) as Sandbox, {
      agent: (task: string, a: Parameters<Sandbox["agent"]>[1]) => {
        rmSync(join(a.work, STATE_ROOT_DIR), { recursive: true, force: true });
        return base.agent(task, { ...a, env: Object.fromEntries(Object.entries(a.env).filter(([k]) => k !== "GSTACK_STATE_ROOT" && k !== "GSTACK_HOME")) });
      },
    });
    const home = sandbox.homePath(dir);
    const skill = spec.skill && install.skill ? { name: spec.skill, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
    if (spec.gstack && !skill) throw new Error("E_USAGE: arm " + s.arm + "'s install holds no " + spec.skill + " skill");
    const plugins = (install.plugins ?? []).map((p) => posix.join(home, p));
    const repair = repairOf(s.arm, o.repairs, o.doubled);
    const host = join(dir, "host");
    const options = (proxy: HostDriverOptions["proxy"]): HostDriverOptions => ({
      host: "claude", model: ms, provider, proxy, interactive: true, skill, out: host,
      entry: { user: DX_REC_USER }, freeform: dxFreeform(join(host, "persona.ndjson")), followUp: DX_FOLLOW_UP, systemPrompt: DX_SYSTEM_PROMPT, maxTurns: limits.turns,
      disable1mContext: true, capStops: true, memoryLog: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(plugins.length ? { plugins } : {}), ...(spec.session_kind ? { sessionKind: spec.session_kind } : {}),
      ...(repair === "stop hook" ? { stopHook: makeStopHook({ log: join(host, "stop-hook.ndjson") }) } : {}),
      ...(repair === "gstack stop gate" ? { skillGateDeadlineMs: GATE_DEADLINE_MS, settings: { command: [posix.join(home, posix.dirname(install.gstack ?? ""), "gstack-skill-gates"), "settings", "--autoplan"].map((w) => "'" + w.replace(/'/g, "'\\''") + "'").join(" "), make: dxAutoplanGateSettings } } : {}),
    });
    const envProblem = armEnvProblem(s.arm, hostDriver(options({ baseUrl: o.rig.baseUrl, slot: "env-check", token: "" })).env ?? {});
    if (envProblem) throw new Error("E_USAGE: " + envProblem);
    let termination: Termination;
    let transcript: string | null = null;
    let env: Record<string, string> = {};
    let binding: Awaited<ReturnType<HostRig["bind"]>> | null = null;
    let markError: unknown = null;
    try {
      binding = await o.rig.bind({ cell: { run_id: o.runId, arm: s.arm, task: tree.task, model: ms, trial: s.pass, attempt: n }, models: slotModels(o.policy, ms, null), allowance_micros: limits.usd * 1_000_000 });
      launched.add(s.id);
      unbilled.set(s.id, binding.meter_id);
      if (o.record && !marked) {
        try {
          markLaunched(o.record, o.lease, s.id);
        } catch (e) {
          markError = e;
          throw e;
        }
        marked = true;
      }
      const agent = (o.rig.driver ?? hostDriver)(options({ baseUrl: o.rig.baseUrl, slot: binding.slot, token: binding.token }));
      env = agent.env ?? {};
      const trial = await runTrial({ cell: { model: ms, arm: s.arm, round: 1, trial: s.pass }, task: { id: tree.task, prompt: dxPrompt(s.arm) }, tasksDir: empty, sandbox, agent, dir, timeoutS: limits.minutes * 60, network: o.rig.network, seed, copyDir: { from: STATE_ROOT_DIR, to: join(host, "gstack-state") }, ...dxPlanTuneState(s.arm) });
      termination = trial.record.termination;
      transcript = readText(join(host, "transcript.ndjson"));
    } catch (e) {
      termination = { kind: "infra", incident: (binding ? "the session crashed: " : "the slot did not bind: ") + ((e as Error).message ?? String(e)).split("\n")[0] };
    }
    let meter: Pick<Awaited<ReturnType<HostRig["finalize"]>>, "micros" | "unknown" | "undrained" | "unsettled" | "by_model"> = { micros: 0, unknown: 0, undrained: 0, unsettled: 0, by_model: {} };
    let finalizeError: string | null = null;
    let costUnknown = false;
    let ledgerError: unknown = null;
    if (binding) {
      try {
        meter = await o.rig.finalize(binding.meter_id);
      } catch (e) {
        finalizeError = firstLine(e);
        costUnknown = true;
        try {
          const m = o.ledger.meters(o.lease).get(binding.meter_id);
          meter = { micros: m?.held_micros ?? 0, unknown: m?.unknown_calls ?? 0, undrained: 0, unsettled: 0, by_model: {} };
        } catch (le) {
          ledgerError = le;
        }
      }
      try {
        await o.rig.unbind?.(binding.slot);
      } catch (e) {
        finalizeError = (finalizeError ? finalizeError + "; " : "") + "unbind: " + firstLine(e);
      }
    }
    if (markError ?? ledgerError) throw markError ?? ledgerError;
    const read = dxAttempt(termination, transcript);
    const drift = Object.keys(meter.by_model).filter((k) => k !== provider + ":" + ms);
    const open = [...(finalizeError ? ["the meter's finalize or unbind failed (" + finalizeError + ")"] : []), ...(meter.undrained ? [meter.undrained + " calls were still in flight (undrained)"] : []), ...(meter.unsettled ? [meter.unsettled + " outcomes were not acknowledged by the ledger (unsettled)"] : [])];
    line(files.sessions, { session: s.id, attempt: n, reason, dir, termination, outcome: read.outcome, spend_micros: meter.micros, unknown_calls: meter.unknown, undrained: meter.undrained, unsettled: meter.unsettled, cost_unknown: costUnknown, ...(finalizeError ? { finalize_error: finalizeError } : {}), by_model: meter.by_model, repair: repairName(repair), prompt_sha256: DX_PROMPT_SHA256[s.arm] });
    const infra = read.outcome.state === "infra" ? read.outcome : null;
    if (infra || open.length) {
      line(files.recoveries, { at: new Date().toISOString(), session: s.id, attempt: n, reason: infra?.reason ?? "unreconciled", detail: infra?.detail ?? open.join("; "), spend_micros: meter.micros, unknown_calls: meter.unknown, undrained: meter.undrained, unsettled: meter.unsettled, reconciled: open.length ? "not reconciled: " + open.join("; ") + "; nothing retries, and the run halts for the Captain to reconcile the lease first (J1 rule 1)" : "the meter's finalize settled every call with no recorded outcome as unknown spend" });
      if (open.length) hold("E_DX_INFRA_MISSING", s.id + " attempt " + n + " is not reconciled: " + open.join("; ") + "; recorded in recoveries.ndjson, and the run halts for the Captain");
      else o.log("E_DX_INFRA_MISSING " + s.id + " attempt " + n + ": " + infra!.reason + " (" + infra!.detail + "), " + meter.unknown + " unknown calls; recorded in recoveries.ndjson before any retry");
    }
    return { input: { termination, transcript, spend_micros: meter.micros, unknown_micros: 0 } as DxAttemptInput, read: read.outcome, dir, env, repair, drift, unreconciled: open.length > 0, bound: binding !== null, costUnknown };
  };

  const writeRow = (row: DxRow) => {
    rows.push(row);
    line(files.rows, row);
  };
  /** A launched session's row when its launch threw: missing under the hold's code, at its spend, with its attempts' reasons and limit stops. */
  const thrownRow = (s: BatchSession, code: string): DxRow => {
    const inputs = partial.get(s.id) ?? [];
    const repair = repairName(repairOf(s.arm, o.repairs, o.doubled));
    const open = unbilled.get(s.id);
    let extra = 0;
    if (open) {
      try {
        extra = o.ledger.meters(o.lease).get(open)?.held_micros ?? 0;
      } catch {
        extra = 0;
      }
    }
    const base = inputs.length ? dxRow({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, judged: false, attempts: inputs, exposure: null, dx_lens: null, kind: null, repair, answers: null }) : releasedRow(s, code, repair);
    return { ...base, end: "missing", code, list: null, words: 0, items: 0, cut: 0, launched: true, spend_micros: (spent.get(s.id) ?? 0) + extra, cost_unknown: unknownCost.has(s.id) || open !== undefined };
  };
  const launch = async (s: BatchSession): Promise<DxLaunch> => {
    try {
      return await launchSession(s);
    } catch (e) {
      const msg = firstLine(e);
      const code = leadingCode(msg);
      hold(code, s.id + "'s launch threw (" + msg + "); no session starts after it, and the lease stays open for the Captain");
      if (launched.has(s.id)) writeRow(thrownRow(s, code));
      throw e;
    }
  };
  const launchSession = async (s: BatchSession): Promise<DxLaunch> => {
    const inputs: DxAttemptInput[] = [];
    const reads: DxAttempt[] = [];
    partial.set(s.id, inputs);
    let last: Awaited<ReturnType<typeof attempt>> | null = null;
    let blocked: string | null = null;
    for (let next = nextAttempt(reads, false); next.retry; next = nextAttempt(reads, false)) {
      if (inputs.length && stopOf(s)) {
        blocked = stopOf(s);
        break;
      }
      last = await attempt(s, inputs.length + 1, next.reason);
      inputs.push(last.input);
      reads.push(last.read);
      spent.set(s.id, inputs.reduce((n, i) => n + (i.spend_micros ?? 0), 0));
      unbilled.delete(s.id);
      if (last.costUnknown) unknownCost.add(s.id);
      if (last.read.state === "cap") haltFor("CAP_STOP", s.id + " met the item's cap; the run is incomplete, and nothing is retried to change a verdict");
      if (last.drift.length || last.unreconciled) break;
    }
    const a = last!;
    if (!a.bound && !blocked) hold("E_DX_INFRA_MISSING", s.id + "'s slot did not bind on its last allowed attempt (" + ("incident" in a.input.termination ? a.input.termination.incident : a.input.termination.kind) + "); the proxy may be down, so no session starts after it");
    const ms = MODEL_STRINGS[s.model];
    const exposure = s.arm === "plan-devex-review" || s.arm === "autoplan" ? sessionExposure(a.dir, s.arm, ms) : null;
    const kind = DX_ARMS[s.arm].gstack ? dxSessionKind(o.pin, s.arm, { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: a.dir, LANG: "C.UTF-8", TERM: "dumb", ...a.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }) : null;
    if (kind?.problem) o.log("E_SESSION_KIND_PIN " + s.id + ": " + kind.problem);
    const host = join(a.dir, "host");
    const answers = answerCounts(readText(join(host, "usersim.ndjson")), readText(join(host, "persona.ndjson")), readText(join(host, "session.json")));
    let row = dxRow({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, judged: false, attempts: inputs, exposure: exposure ? { exposed: exposure.exposed, markers: { ...exposure.markers } as Record<string, boolean> } : null, dx_lens: exposure && "dx_lens" in exposure ? (exposure.dx_lens as boolean | null) : null, kind, repair: repairName(a.repair), answers });
    const missing = a.drift.length ? "E_DX_PROVIDER_DRIFT" : a.unreconciled ? "E_DX_INFRA_MISSING" : (blocked ?? (a.read.state === "infra" ? stopOf(s) : null));
    if (missing) row = { ...row, end: "missing", code: missing, list: null };
    row = { ...row, launched: launched.has(s.id), cost_unknown: unknownCost.has(s.id) };
    if (a.drift.length) {
      stop("E_DX_PROVIDER_DRIFT", { model: s.model }, s.id + " sent calls to " + a.drift.join(", ") + ", not " + ms);
    }
    writeRow(row);
    for (const c of installStops(rows)) {
      const key = c.arm + " on " + c.model;
      if (paused.has(key)) continue;
      paused.add(key);
      if (!batch.pause(c.arm, c.model, "E_DX_INFRA_MISSING: " + c.sessions + " sessions failed gstack's install verdict; the cell waits for the Captain on the open lease")) continue;
      o.log(o.control ? "E_DX_INFRA_MISSING " + key + " paused: the run waits on lease " + o.lease + " for the Captain's word in " + o.control + " for at most " + span + ". To resume a cell on this lease, append the line {\"resume\": \"<arm>\", \"model\": \"<model>\"}; to stop its arm, append {\"code\": \"E_DX_ARM_DROPPED\", \"arm\": \"<arm>\", \"why\": \"<why>\"}" : "E_DX_INFRA_MISSING " + key + " paused with no control file: the run ends with lease " + o.lease + " left open for the Captain (decision 9)");
    }
    return { exposed: row.exposed, row };
  };

  batch = new DxBatch<DxLaunch>({ ledger: o.ledger, lease: o.lease, sessions: o.sessions, launch, parallel: Math.min(MAX_PARALLEL, Math.max(1, o.parallel)), ...(o.record ? { record: o.record } : {}), poll });
  let error: unknown = null;
  try {
    await batch.run();
    while (o.control && batch.pauses().length && !batch.haltedBy()) {
      await new Promise((r) => setTimeout(r, o.pollMs ?? 5_000));
      await batch.run();
    }
  } catch (e) {
    error = e;
    hold(leadingCode(firstLine(e)), "the session loop threw (" + firstLine(e) + "); no session starts after it, and the lease stays open for the Captain");
  } finally {
    writeFileSync(files.batch, batch.log.map((l) => JSON.stringify(l) + "\n").join(""));
  }
  const codeOf = (why: string) => why.split(":")[0]!;
  const settle = (): DxSettle => {
    if (!held && ending) batch.endPauses(ending);
    if (!held && !batch.pauses().length) {
      const orphan = [...batch.state.values()].find((e) => (e.state === "pending" && !stopOf(e.session)) || (e.state === "done" && !e.result));
      if (orphan) hold("E_DX_INFRA_MISSING", orphan.session.id + " has no row and no stop that released it, so the lease stays open for the Captain");
    }
    const halt = batch.haltedBy();
    if (held || batch.pauses().length) {
      const waiting = batch.pauses().map((p) => p.arm_model + ": " + p.why);
      writeFileSync(files.batch, batch.log.map((l) => JSON.stringify(l) + "\n").join(""));
      writeFileSync(files.settled, JSON.stringify({ run: o.run, lease: o.lease, settled: false, ...(held ? { held } : {}), paused: waiting, ...(halt ? { halt } : {}) }, null, 2) + "\n");
      return { close: null, released: [], paused: waiting, held, stop: held ? codeOf(held) : halt ? codeOf(halt) : codeOf(batch.pauses()[0]!.why), voided: null, exit: 2 };
    }
    const done = batch.settle(endStop ?? undefined);
    for (const id of done.released) {
      const s = batch.state.get(id)!.session;
      const code = stopOf(s)!;
      released.set(id, code);
      writeRow(releasedRow(s, code, repairName(repairOf(s.arm, o.repairs, o.doubled))));
    }
    const stop = halt ? codeOf(halt) : null;
    const voided = o.record && !launched.size ? voidLease(o.record, o.lease, stop ?? stops[0]?.code ?? "E_DX_INFRA_MISSING", "the lease settled before any session launched on it with a bound attempt") : null;
    writeFileSync(files.batch, batch.log.map((l) => JSON.stringify(l) + "\n").join(""));
    writeFileSync(files.settled, JSON.stringify({ run: o.run, lease: o.lease, settled: true, close: done.close, ...(halt ? { halt } : {}), ...(voided ? { voided } : {}), released: Object.fromEntries(released), model_settled: Object.fromEntries(batch.modelSettled) }, null, 2) + "\n");
    return { close: done.close, released: done.released, paused: [], held: null, stop, voided, exit: halt ? 2 : 0 };
  };
  return { batch, rows, error, settle };
}

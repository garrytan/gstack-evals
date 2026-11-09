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
//   refuse an install that holds gstack or a skill.
// - The repair the arm runs under: the Stop hook (stophook.ts makeStopHook, host/stop-hook.ndjson) for
//   plan-devex-review, gstack's stop gate settings at the pin (devex.ts dxAutoplanGateSettings) for autoplan, or the
//   doubled limits for every arm. Its name goes on every row.
// - After each attempt, run/parse.ts dxAttempt reads its outcome, and run/rows.ts nextAttempt says whether the one retry
//   runs. An infrastructure failure is reconciled first (the meter's finalize settles every call with no recorded
//   outcome as unknown spend) and logged to recoveries.ndjson before the retry launches (J1 rules 1, 3 and 5). A cap
//   stop halts the batch.
// - Each session ends in one row (dxRow) in rows.ndjson: exposure from exposure.ts sessionExposure, dx_lens, the session
//   kind the pin's own bin/gstack-session-kind reports in the session's env with autoplan's lean mode (dxSessionKind),
//   answer counts and the repair. A session whose meter shows another model is missing under E_DX_PROVIDER_DRIFT, and
//   that model stops on the lease. Sessions a stop released get a missing row under that stop's code at settle.
// - Stops: a per-model stop scopes the model and settles its scope once its sends are over (DxBatch.stopModel); an arm
//   stop scopes the arm and leaves the lease open (stopArm); both are routed by leases.ts stopAction, from the drift
//   check or from a control file line the Captain writes ({"code", "model" or "arm", "why"}), read before each start.
//   Two INSTALL: fail sessions in one cell pause that cell for the Captain, and the lease then stays open.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { BACKGROUND_WAIT_MS } from "../../../src/adapters/claude-code/driver.ts";
import { hostDriver, type HostDriverOptions } from "../../../src/adapters/host.ts";
import { isReasonCode, type ReasonCode } from "../../../src/errors/codes.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import type { CloseFile } from "../../../src/runner/ledger/record.ts";
import { providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { armNamespaces, slotModels, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { DX_ARMS, DX_LENS, DX_PROMPT_SHA256, DX_SYSTEM_PROMPT, dxArmEnv, dxAutoplanGateSettings, dxLimits, dxPlanTuneState, dxPrompt, dxSessionKind } from "../../../src/trial/review/devex.ts";
import { reviewSandbox } from "../../../src/trial/review/run.ts";
import { GATE_DEADLINE_MS } from "../../../src/trial/review/skill-gates.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { runTrial } from "../../../src/trial/trial.ts";
import type { Termination } from "../../../src/types.ts";
import { SMOKE, stopAction } from "../leases.ts";
import { MODEL_IDS, MODEL_STRINGS, type ArmId, type ModelId } from "../types.ts";
import { DxBatch, type ArmStop, type BatchSession, type ModelStop } from "./batch.ts";
import { sessionExposure } from "./exposure.ts";
import { dxAttempt, type DxAttempt } from "./parse.ts";
import { answerCounts, DX_FOLLOW_UP, DX_REC_USER, dxFreeform } from "./persona.ts";
import { dxRow, installStops, nextAttempt, type DxAttemptInput, type DxRow } from "./rows.ts";
import { makeStopHook, REPAIR_NAME, type Repair } from "./stophook.ts";

export const STAGE1_RUNS = ["s1-none", "s1-smoke", "s1-resmoke"] as const;
export type Stage1Run = (typeof STAGE1_RUNS)[number];
export const isStage1Run = (id: string): id is Stage1Run => (STAGE1_RUNS as readonly string[]).includes(id);
export const CALIBRATION_UNITS = 16;
export const NONE_PASSES = 3;
export const MAX_PARALLEL = 8;
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
  /** The control file a stop is recorded in mid-run; null reads none. */
  control: string | null;
  log: (line: string) => void;
}

export interface DxLaunch {
  exposed: boolean | null;
  row: DxRow;
}

export interface DxRunResult {
  batch: DxBatch<DxLaunch>;
  rows: DxRow[];
  /** Settles the lease (unless a pause awaits the Captain), writes a row for each released session and settled.json. */
  settle: () => { close: CloseFile | null; released: string[]; paused: string[] };
}

const readText = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const line = (file: string, v: unknown) => appendFileSync(file, JSON.stringify(v) + "\n");

/** A row for a planned session no attempt ran for: missing under the code that released it. */
export function releasedRow(s: BatchSession, code: string, repair: string | null): DxRow {
  return { unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, end: "missing", code, list: null, words: 0, items: 0, cut: 0, exposed: null, markers: {}, session_kind: null, lean: null, dx_lens: null, gstack_read: null, retried: false, judged: false, limit_stops: 0, spend_micros: 0, session: [s.unit, s.model, s.arm, s.pass].join(":"), reasons: [], repair, answers: null, unknown_micros: 0 };
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
  const modelStops = new Map<ModelId, string>();
  const armStops = new Map<ArmId, string>();
  let halt: string | null = null;
  let endStop: string | null = null;
  const paused = new Set<string>();
  let controlRead = 0;
  let batch!: DxBatch<DxLaunch>;

  /** Routes a stopping code through leases.ts stopAction onto the batch. */
  const stop = (code: ReasonCode, on: { model?: ModelId; arm?: ArmId }, why: string) => {
    const action = stopAction(code, { stage: 1, model: on.model, lease_models: leaseModels });
    o.log(code + " " + (on.model ?? on.arm ?? "run") + ": " + why + " (" + action + ")");
    if (action === "scope-model" && on.model) {
      modelStops.set(on.model, code);
      batch.stopModel(on.model, code as ModelStop, why);
    } else if (action === "scope-arm" && on.arm) {
      armStops.set(on.arm, code);
      batch.stopArm(on.arm, code as ArmStop, why);
    } else if (action === "end" || action === "settle") {
      halt ??= code;
      if (action === "end") endStop ??= code + " " + why;
      batch.halt(code + ": " + why);
    }
  };
  const poll = () => {
    if (!o.control) return;
    const text = readText(o.control);
    if (text === null) return;
    const lines = text.split("\n").filter((l) => l.trim());
    for (; controlRead < lines.length; controlRead++) {
      let v: { code?: unknown; model?: unknown; arm?: unknown; why?: unknown } | null = null;
      try {
        v = JSON.parse(lines[controlRead]!);
      } catch {
        v = null;
      }
      const code = typeof v?.code === "string" && isReasonCode(v.code) ? v.code : null;
      const model = MODEL_IDS.find((m) => m === v?.model);
      const arm = (Object.keys(DX_ARMS) as ArmId[]).find((a) => a === v?.arm);
      if (!code || (v?.model !== undefined && !model) || (v?.arm !== undefined && !arm)) {
        halt ??= "E_USAGE";
        batch.halt("control line " + (controlRead + 1) + " does not read as {code, model or arm, why}, so no session starts until the Captain looks");
        continue;
      }
      stop(code, { model, arm }, typeof v?.why === "string" ? v.why : "recorded in the control file");
    }
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
    const binding = await o.rig.bind({ cell: { run_id: o.runId, arm: s.arm, task: tree.task, model: ms, trial: s.pass, attempt: n }, models: slotModels(o.policy, ms, null), allowance_micros: limits.usd * 1_000_000 });
    const sandbox = reviewSandbox(o.rig.sandbox(s.arm, false, ms), DX_LENS);
    const home = sandbox.homePath(dir);
    const skill = spec.skill && install.skill ? { name: spec.skill, roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
    if (spec.gstack && !skill) throw new Error("E_USAGE: arm " + s.arm + "'s install holds no " + spec.skill + " skill");
    const plugins = (install.plugins ?? []).map((p) => posix.join(home, p));
    const repair = repairOf(s.arm, o.repairs, o.doubled);
    const host = join(dir, "host");
    const options: HostDriverOptions = {
      host: "claude", model: ms, provider, proxy: { baseUrl: o.rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: true, skill, out: host,
      entry: { user: DX_REC_USER }, freeform: dxFreeform(join(host, "persona.ndjson")), followUp: DX_FOLLOW_UP, systemPrompt: DX_SYSTEM_PROMPT, maxTurns: limits.turns,
      disable1mContext: true, capStops: true, memoryLog: true, backgroundWaitMs: BACKGROUND_WAIT_MS, ...(plugins.length ? { plugins } : {}), ...(spec.session_kind ? { sessionKind: spec.session_kind } : {}),
      ...(repair === "stop hook" ? { stopHook: makeStopHook({ log: join(host, "stop-hook.ndjson") }) } : {}),
      ...(repair === "gstack stop gate" ? { skillGateDeadlineMs: GATE_DEADLINE_MS, settings: { command: [posix.join(home, posix.dirname(install.gstack ?? ""), "gstack-skill-gates"), "settings", "--autoplan"].map((w) => "'" + w.replace(/'/g, "'\\''") + "'").join(" "), make: dxAutoplanGateSettings } } : {}),
    };
    const agent = (o.rig.driver ?? hostDriver)(options);
    const env = agent.env ?? {};
    const envProblem = armEnvProblem(s.arm, env);
    if (envProblem) throw new Error("E_USAGE: " + envProblem);
    let termination: Termination;
    let transcript: string | null = null;
    try {
      const trial = await runTrial({ cell: { model: ms, arm: s.arm, round: 1, trial: s.pass }, task: { id: tree.task, prompt: dxPrompt(s.arm) }, tasksDir: empty, sandbox, agent, dir, timeoutS: limits.minutes * 60, network: o.rig.network, seed, copyDir: { from: STATE_ROOT_DIR, to: join(host, "gstack-state") }, ...dxPlanTuneState(s.arm) });
      termination = trial.record.termination;
      transcript = readText(join(host, "transcript.ndjson"));
    } catch (e) {
      termination = { kind: "infra", incident: "the session crashed: " + ((e as Error).message ?? String(e)).split("\n")[0] };
    }
    const meter = await o.rig.finalize(binding.meter_id);
    const read = dxAttempt(termination, transcript);
    const drift = Object.keys(meter.by_model).filter((k) => k !== provider + ":" + ms);
    line(files.sessions, { session: s.id, attempt: n, reason, dir, termination, outcome: read.outcome, spend_micros: meter.micros, unknown_calls: meter.unknown, by_model: meter.by_model, repair: repairName(repair), prompt_sha256: DX_PROMPT_SHA256[s.arm] });
    if (read.outcome.state === "infra") {
      line(files.recoveries, { at: new Date().toISOString(), session: s.id, attempt: n, reason: read.outcome.reason, detail: read.outcome.detail, spend_micros: meter.micros, unknown_calls: meter.unknown, reconciled: "the meter's finalize settled every call with no recorded outcome as unknown spend" });
      o.log("E_DX_INFRA_MISSING " + s.id + " attempt " + n + ": " + read.outcome.reason + " (" + read.outcome.detail + "), " + meter.unknown + " unknown calls; recorded in recoveries.ndjson before any retry");
    }
    return { input: { termination, transcript, spend_micros: meter.micros, unknown_micros: 0 } as DxAttemptInput, read: read.outcome, dir, env, repair, drift };
  };

  const launch = async (s: BatchSession): Promise<DxLaunch> => {
    const inputs: DxAttemptInput[] = [];
    const reads: DxAttempt[] = [];
    let last: Awaited<ReturnType<typeof attempt>> | null = null;
    for (let next = nextAttempt(reads, false); next.retry; next = nextAttempt(reads, false)) {
      last = await attempt(s, inputs.length + 1, next.reason);
      inputs.push(last.input);
      reads.push(last.read);
      if (last.read.state === "cap") {
        halt ??= "CAP_STOP";
        batch.halt("CAP_STOP: " + s.id + " met the item's cap; the run is incomplete, and nothing is retried to change a verdict");
      }
      if (last.drift.length) break;
    }
    const a = last!;
    const ms = MODEL_STRINGS[s.model];
    const exposure = s.arm === "plan-devex-review" || s.arm === "autoplan" ? sessionExposure(a.dir, s.arm, ms) : null;
    const kind = DX_ARMS[s.arm].gstack ? dxSessionKind(o.pin, s.arm, { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: a.dir, LANG: "C.UTF-8", TERM: "dumb", ...a.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }) : null;
    if (kind?.problem) o.log("E_SESSION_KIND_PIN " + s.id + ": " + kind.problem);
    const host = join(a.dir, "host");
    const answers = answerCounts(readText(join(host, "usersim.ndjson")), readText(join(host, "persona.ndjson")), readText(join(host, "session.json")));
    let row = dxRow({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, judged: false, attempts: inputs, exposure: exposure ? { exposed: exposure.exposed, markers: { ...exposure.markers } as Record<string, boolean> } : null, dx_lens: exposure && "dx_lens" in exposure ? (exposure.dx_lens as boolean | null) : null, kind, repair: repairName(a.repair), answers });
    if (a.drift.length) {
      row = { ...row, end: "missing", code: "E_DX_PROVIDER_DRIFT", list: null };
      stop("E_DX_PROVIDER_DRIFT", { model: s.model }, s.id + " sent calls to " + a.drift.join(", ") + ", not " + ms);
    }
    rows.push(row);
    line(files.rows, row);
    for (const c of installStops(rows)) {
      const key = c.arm + " on " + c.model;
      if (paused.has(key)) continue;
      paused.add(key);
      batch.pause(c.arm, c.model, "E_DX_INFRA_MISSING: " + c.sessions + " sessions failed gstack's install verdict; the cell waits for the Captain on the open lease");
    }
    return { exposed: row.exposed, row };
  };

  batch = new DxBatch<DxLaunch>({ ledger: o.ledger, lease: o.lease, sessions: o.sessions, launch, parallel: Math.min(MAX_PARALLEL, Math.max(1, o.parallel)), ...(o.record ? { record: o.record } : {}), poll });
  try {
    await batch.run();
  } finally {
    writeFileSync(files.batch, batch.log.map((l) => JSON.stringify(l) + "\n").join(""));
  }
  const settle = () => {
    const waiting = batch.pauses().map((p) => p.arm_model + ": " + p.why);
    if (waiting.length) {
      writeFileSync(files.settled, JSON.stringify({ run: o.run, lease: o.lease, settled: false, paused: waiting }, null, 2) + "\n");
      return { close: null, released: [], paused: waiting };
    }
    const done = batch.settle(endStop ?? undefined);
    for (const id of done.released) {
      const s = batch.state.get(id)!.session;
      const code = halt ?? modelStops.get(s.model) ?? armStops.get(s.arm) ?? "E_USAGE";
      released.set(id, code);
      const row = releasedRow(s, code, repairName(repairOf(s.arm, o.repairs, o.doubled)));
      rows.push(row);
      line(files.rows, row);
    }
    writeFileSync(files.batch, batch.log.map((l) => JSON.stringify(l) + "\n").join(""));
    writeFileSync(files.settled, JSON.stringify({ run: o.run, lease: o.lease, settled: true, close: done.close, released: Object.fromEntries(released), model_settled: Object.fromEntries(batch.modelSettled) }, null, 2) + "\n");
    return { close: done.close, released: done.released, paused: [] };
  };
  return { batch, rows, settle };
}

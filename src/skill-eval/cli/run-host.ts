// The run on a real host (U10): calibration first, then round 1 in arm-balanced rounds and the same-tree rerun stage
// for each model with a red task in round 1, as on the fake host (run.ts). Each session is a U9 trial (runTrial) with the host's
// adapter, on its own proxy slot whose meter settles the session's cost. The loop is written against a HostRig, so the
// same code runs on the Docker rig below and on the keyless test rig (an in-process proxy with a fake upstream).
//
// - A round is started only when its worst case (each session at its allowance) fits under the cap, and a cap stop
//   from the proxy ends the run, so a cap stop keeps complete paired cells (CAP_STOP).
// - Calibration (src/adapters/calibration.ts) runs per model before any trial; a failed check skips every trial, and
//   U6's verdict exits 3 with its code.
// - progress.json is rewritten after every session.
// - The Docker rig installs every arm (src/arms/install.ts), builds one arm image per arm and one per calibration copy,
//   keeps each layer tree and the trial image by digest, opens the lease, starts the proxy container on the trial
//   network (createTrialNetwork) and binds slots over its management socket. close() keeps resume's order: stop the
//   proxy, reconcile its journal, settle the lease, then delete the arm installs the run built that no other run holds.
//   A start that fails undoes its steps and deletes them too. --resume takes over every hold of the run it continues and
//   reinstalls what was deleted; an arm tree that changes on reinstall changes its cells' keys (E_CACHE_STALE below).
// - A task with a judge rubric sends each completed run to blinded cross-family adjudication (src/grade/adjudicate.ts);
//   a judge that cannot run leaves the run unjudged and stops the verdict with JUDGE_UNAVAILABLE.
// - Every finished session is journaled to <out>/cells.ndjson with its session key (src/trial/cache.ts); a judged
//   session is journaled only with its judgment, so --resume reruns one whose judge failed or hit the cap. --resume reuses
//   a journaled cell whose key still matches; a changed key refuses before any spend (E_CACHE_STALE) unless --repair
//   names the repair, which reruns those cells.
// - Arms on a real host are loose skill folders, a gstack base at a sha with the target skill overlaid or removed, stacks,
//   placebo, none and bare. A loadout arm has no installer yet; hostReadiness refuses it with E_USAGE before anything is
//   spent.
// - A task with a persona gets one usersim slot per session on Claude Code, bound at its first free-form question under
//   the run's lease for the call's usersim model (src/usersim/persona.ts). Each answer is one request with no tools from
//   the judge's sandbox, its meter adds to the run's spend and to <out>/usersim.ndjson, and a round's worst case counts a
//   usersim allowance per persona session. The usersim model comes from the policy, whose sha256 is in the session key.
// - A stack arm runs in its cell for each model (src/arms/cells.ts): the cell's image (pstack's model rule), its gstack
//   config appended to the state root, the Codex config for its cross-family voice, and a proxy slot that admits the
//   session's model and that voice only. The cell's tree is the session key's arm tree.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { calibrationProbes, judgeCalibration, sentinelFor, withSentinel, type CalibrationFailure, type ProbeRun } from "../../adapters/calibration.ts";
import { dockerInstaller, installArms, releaseInstalls, runHold, sentinelLayer, stackSources, type ArmInstall, type Layer } from "../../arms/install.ts";
import { cellFor, cellSettings, type CellSettings } from "../../arms/cells.ts";
import type { CodexProvider } from "../../adapters/codex/driver.ts";
import { hostDriver, skillRoot, type HostDriverOptions } from "../../adapters/host.ts";
import type { Call as HostCall } from "../../grade/transcript.ts";
import { openLease, settleLease } from "../../runner/ledger/ledger.ts";
import { rigAdmission } from "../../rig/admission.ts";
import { openLocalLedger } from "../../runner/ledger/local.ts";
import { ProxyControl, type BindRequest, type Binding, type Meter } from "../../runner/proxy/metering-proxy.ts";
import { cacheStale, dirTreeSha256, envValuesHash, newProgress, recordSession, sessionKey, staleParts, writeProgress, type CacheStop, type SessionKey } from "../../trial/cache.ts";
import { judgePrompt, parseJudgment, redact } from "../../grade/adjudicate.ts";
import { JUDGE_REASONING_EFFORT, JUDGE_ROUTE, judgeDriver } from "../../adapters/judge.ts";
import { PERSONA_MAX_OUTPUT_TOKENS, PERSONA_REASONING_EFFORT, PERSONA_TIMEOUT_S, personaAnswer, personaPrompt, type PersonaAnswer } from "../../usersim/persona.ts";
import { buildArmImage, checkImagePin, dockerRun, retainImage, retainTree, stateRoot } from "../../trial/image.ts";
import { createTrialNetwork, recoverRun, removeTrialNetwork, startProxyContainer } from "../../trial/proxy.ts";
import { dockerSandbox, type Sandbox } from "../../trial/sandbox.ts";
import { runTrial, type AgentDriver, type TrialRun } from "../../trial/trial.ts";
import type { ArmSpec, CalibrationResult, Host, TrialRecord } from "../../types.ts";
import type { SidecarTask } from "../contract/sidecar.ts";
import type { ContractTask } from "../contract/tasks.ts";
import { rerunPlan, type Stop, type VerdictInput } from "../verdict/gates.ts";
import { gradeScope, gradeTrial, type VerdictTask } from "../verdict/grade.ts";
import type { GateEvidence } from "../verdict/lock.ts";
import type { Call } from "./call.ts";
import { allowanceMicros, JUDGE_ALLOWANCE, SESSION_ALLOWANCE, USERSIM_ALLOWANCE } from "./dry-run.ts";
import { providerOf, type LoadedPolicy } from "./policy.ts";

type Env = Record<string, string | undefined>;

export interface HostRig {
  /** The proxy's base URL as agents reach it. */
  baseUrl: string;
  /** The agents' network; null under the test rig. */
  network: string | null;
  /** The trial image's digest for the verdict; null under the test rig. */
  imageDigest: string | null;
  bind(request: BindRequest): Promise<Binding>;
  finalize(meterId: string): Promise<Meter>;
  /** Each arm's install: its session key tree, the target skill's paths under HOME and gstack-skill-start, if any. */
  arms: Readonly<Record<string, Pick<ArmInstall, "tree_sha256" | "skill" | "gstack"> & Partial<Pick<ArmInstall, "plugins" | "layers">>>>;
  /** Each stack arm's cell settings by model (src/arms/cells.ts). An arm or model with no entry runs with no cell settings. */
  cells?: Readonly<Record<string, Readonly<Record<string, CellSettings>>>>;
  /** The sandbox whose agent HOME holds the arm (its cell's image for model, when it has one), or the arm's calibration copy. */
  sandbox(arm: string, calibration: boolean, model?: string): Sandbox;
  /** Builds an arm session's agent driver; unset means hostDriver. A keyless test rig sets it to record the options. */
  driver?: (o: HostDriverOptions) => AgentDriver;
  /** A sandbox with no skill installed, for judge sessions. */
  judgeSandbox(): Sandbox;
  /** The evaluator's egress probe to a non-model host, from an agent session on the agents' network. */
  egress(): { open: boolean; detail: string };
  /** Stops the proxy, reconciles its journal and settles the lease, in that order, then deletes the installs the run built. */
  close(): Promise<{ committed: number; unknown: number; lease_id: string | null }>;
  /** What --resume needs to recover this run if the process dies: the lease and the proxy container. */
  recovery: { lease_id: string; proxy_container: string; journal: string } | null;
}

export interface HostRunInput {
  host: Host;
  models: string[];
  trials: number;
  parallel: number;
  timeoutS: number;
  /** Micro-dollars; null for no cap. */
  cap: number | null;
  runId: string;
  out: string;
  tasksDir: string;
  policy: LoadedPolicy;
  arms: ArmSpec[];
  /** The target skill's name; null when no arm holds a skill. */
  skill: string | null;
  tasks: ContractTask[];
  verdict: VerdictTask[];
  entries: Record<string, SidecarTask>;
  gate?: GateEvidence;
  /** The calibration nonce; the sentinels derive from it. */
  nonce: string;
  judgeModel: string;
  /** The model behind the persona's free-form answers: the policy's usersim default. */
  usersimModel: string;
  /** The session key parts that do not vary by cell. */
  keyBase: { image_digest: string | null; recipe: string; host_version: string | null; adapter_sha256: string; isolation: string; verifier: string };
  /** Journaled cells from the run being resumed, keyed by cellId. */
  reuse?: Map<string, JournalEntry>;
  /** --repair: rerun journaled cells whose key changed instead of refusing. */
  repair?: boolean;
  /** --calibrate: stop after calibration, before any trial. */
  calibrateOnly?: boolean;
}

export interface Cell {
  model: string;
  arm: string;
  task: string;
  round: 1 | 2;
  trial: number;
}

export interface JournalEntry {
  cell: Cell;
  key: SessionKey;
  record: TrialRecord;
}

export const cellId = (c: Cell): string => JSON.stringify([c.model, c.arm, c.task, c.round, c.trial]);
const cellName = (c: Cell): string => c.model + " " + c.arm + " " + c.task + " round " + c.round + " trial " + c.trial;

/** The journal of finished sessions a run keeps in its out directory. */
export function readJournal(out: string): Map<string, JournalEntry> {
  const file = join(out, "cells.ndjson");
  const map = new Map<string, JournalEntry>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as JournalEntry;
      map.set(cellId(e.cell), e);
    } catch {
      continue;
    }
  }
  return map;
}

export interface HostRun {
  input: VerdictInput;
  spent: number;
  stopped: boolean;
  calibrationFailures: CalibrationFailure[];
  /** Journaled cells whose key changed, refused before any spend. */
  stale: CacheStop[];
}

/** The models a session's proxy slot admits: its own model, and the cell's voice when the cell keeps one. */
export function slotModels(policy: LoadedPolicy, model: string, cell: CellSettings | null): string[] {
  const at = (m: string) => {
    const provider = providerOf(policy, m);
    if (!provider) throw new Error("E_MODEL_POLICY: " + m + " has no provider in the policy");
    return provider + ":" + m;
  };
  return [at(model), ...(cell?.codex ? [at(cell.codex.model)] : [])];
}

/** The Claude Code driver's codex option for a cell: the voice and the route the policy gives it, or null. */
export function codexOption(policy: LoadedPolicy, cell: CellSettings | null): { provider: CodexProvider; model: string } | null {
  if (!cell?.codex) return null;
  const provider = providerOf(policy, cell.codex.model);
  if (provider !== "openai" && provider !== "openrouter") throw new Error("E_MODEL_POLICY: the cell's voice " + cell.codex.model + " needs an openai or openrouter route for the Codex CLI, and the policy gives " + (provider ?? "none"));
  return { provider, model: cell.codex.model };
}

/** The namespaces a Skill call may use for an arm's skill: each plugin's manifest name (else its folder name), and gstack for an arm that installs gstack. */
export function armNamespaces(install: Pick<ArmInstall, "gstack"> & Partial<Pick<ArmInstall, "layers" | "plugins">>): string[] {
  const names = (install.plugins ?? []).map((p) => {
    for (const layer of install.layers ?? []) {
      const manifest = join(layer.src, p, ".claude-plugin", "plugin.json");
      if (!existsSync(manifest)) continue;
      const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name;
      if (typeof name === "string" && name) return name;
    }
    return posix.basename(p);
  });
  return [...new Set([...names, ...(install.gstack ? ["gstack"] : [])])];
}

/**
 * Each stack arm's cell settings for each model of the run, by arm and model. A cell whose voice the policy cannot route
 * refuses, so a stack never loses its voice silently and scores its reviewer's absence as a loss. voice false builds
 * every cell without its voice (a plan run, which runs no second model), so the policy need not route one.
 */
export function armCells(installs: readonly ArmInstall[], models: readonly string[], policy: LoadedPolicy, dir: string, o: { voice?: boolean; gstackConfig?: Readonly<Record<string, Readonly<Record<string, string>>>> } = {}): Record<string, Record<string, CellSettings>> {
  const out: Record<string, Record<string, CellSettings>> = {};
  for (const install of installs) {
    if (install.provenance.kind !== "stack") continue;
    out[install.name] = Object.fromEntries(models.map((model) => {
      const settings = cellSettings(install, o.voice === false ? { model, voice: null } : cellFor(model), dir, o.gstackConfig?.[install.name]);
      codexOption(policy, settings);
      return [model, settings];
    }));
  }
  return out;
}

/** The session key's arm tree: the arm's cell tree for the model when it has a cell, else the arm's own. */
export const armTree = (rig: Pick<HostRig, "arms" | "cells">, arm: string, model: string): string => rig.cells?.[arm]?.[model]?.tree_sha256 ?? rig.arms[arm]!.tree_sha256;

/** The arm installs the target skill: a skill folder, alone or on a base, a stack that holds it, or its placebo. */
const holdsSkill = (arm: ArmSpec): boolean => (arm.kind === "overlay" && arm.dir !== null) || arm.kind === "stack" || arm.kind === "placebo";

/** Each arm's calibration sentinel, for the arms that hold the skill. */
export const sentinels = (arms: readonly ArmSpec[], nonce: string): Record<string, string> => Object.fromEntries(arms.filter(holdsSkill).map((a) => [a.name, sentinelFor(nonce, a.name)]));

/** Why this call cannot run on a real host yet, or null. */
export function hostReadiness(call: Pick<Call, "host" | "arms" | "isolation" | "item" | "spendCap">, tasks: readonly { id: string }[], entries: Readonly<Record<string, SidecarTask>> = {}): Stop & { message: string } | null {
  const stop = (message: string) => ({ code: "E_USAGE" as const, model: null, subject: null, message });
  const loadouts = call.arms.arms.filter((a) => a.kind === "loadout");
  if (loadouts.length) return stop("loadout arm" + (loadouts.length > 1 ? "s " : " ") + loadouts.map((a) => a.name).join(", ") + ": a real host has no loadout install yet; use loose skill folders, none and bare");
  if (call.isolation !== "docker") return { code: "E_ISOLATION_COUNTED", model: null, subject: null, message: "a real host run is counted (it leases from a ledger line item under a rig admission), so it runs under --isolation docker only: under --isolation process the check runs on this machine, where the agent's code could write outside the trial" };
  if (call.item === null || call.spendCap === null) return stop("a real host run needs a ledger line item and --spend-cap");
  return null;
}

async function pool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

interface SessionSpec {
  /** The host whose adapter runs an arm's session; a judge session (arm null) runs no host, only one request with no tools. */
  host: Host;
  model: string;
  /** The arm, or null for a judge session. */
  arm: ArmSpec | null;
  round: 1 | 2;
  trial: number;
  task: ContractTask;
  entry?: SidecarTask;
  interactive: boolean;
  sandbox: Sandbox;
  allowance: number;
  /** Count reads of the target skill even in an arm that does not hold it (calibration's none check). */
  watchSkill: boolean;
  /** The arm's calibration sentinel, so a call whose output quotes it shows a read of the calibration copy. */
  sentinel?: string;
  dir: string;
  tasksDir: string;
}

const JUDGE_ARM = "judge";
const USERSIM_ARM = "usersim";

export async function runOnHost(o: HostRunInput, rig: HostRig, log: (line: string) => void = () => {}): Promise<HostRun> {
  const records: TrialRecord[] = [];
  const stops: Stop[] = [];
  const calibration: Record<string, CalibrationResult> = {};
  const calibrationFailures: CalibrationFailure[] = [];
  const stale: CacheStop[] = [];
  let spent = 0;
  const input: VerdictInput = { tasks: o.verdict, models: o.models, arms: o.arms.map((a) => a.name), records, calibration, stops, ...(o.gate ? { gate: o.gate } : {}) };
  const result = (): HostRun => ({ input, spent, stopped: stops.some((s) => s.code === "CAP_STOP"), calibrationFailures, stale });
  const allowance = (model: string, a = SESSION_ALLOWANCE): number => {
    const micros = allowanceMicros({ policy: o.policy }, model, a);
    if (micros === null) throw new Error("E_INTERNAL: no price row for " + model + " passed preflight");
    return micros;
  };
  const byId = new Map(o.tasks.map((t) => [t.id, t]));
  const fixtureTree = dirTreeSha256(o.tasksDir);
  const keyOf = (model: string, arm: ArmSpec, task: ContractTask): SessionKey => {
    const entry = o.entries[task.id];
    return sessionKey({ ...o.keyBase, arm_tree: armTree(rig, arm.name, model), task, sidecar_entry: entry ?? null, fixture_tree: fixtureTree, model, timeout_s: o.timeoutS, env_values: envValuesHash(entry?.env ?? [], process.env), judge_model: entry?.judge ? o.judgeModel : null, policy: o.policy.sha256 });
  };

  const reuse = new Map<string, JournalEntry>();
  for (const [id, e] of o.reuse ?? []) {
    const arm = o.arms.find((a) => a.name === e.cell.arm);
    const task = byId.get(e.cell.task);
    if (!arm || !task || !o.models.includes(e.cell.model)) continue;
    const changed = staleParts(e.key, keyOf(e.cell.model, arm, task));
    if (!changed.length) reuse.set(id, e);
    else if (!o.repair) stale.push(cacheStale(cellName(e.cell), changed));
  }
  if (stale.length) return result();

  const usersimLog = join(o.out, "usersim.ndjson");
  const persona = (s: SessionSpec, arm: string) => {
    const provider = providerOf(o.policy, o.usersimModel);
    if (!provider) throw new Error("E_INTERNAL: the usersim model " + o.usersimModel + " passed preflight with no provider");
    let binding: Binding | null = null;
    let answers = 0;
    let pending: Promise<PersonaAnswer> | null = null;
    const ask = async (text: string, question: string): Promise<PersonaAnswer> => {
      try {
        binding ??= await rig.bind({ cell: { run_id: o.runId, arm, task: s.task.id + "-usersim", model: o.usersimModel, trial: s.trial, attempt: s.round }, models: [provider + ":" + o.usersimModel], allowance_micros: allowance(o.usersimModel, USERSIM_ALLOWANCE) });
        const proxy = { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token };
        const run = await runTrial({ cell: { model: o.usersimModel, arm: USERSIM_ARM, round: s.round, trial: s.trial }, task: { id: s.task.id + "-usersim", prompt: personaPrompt(text, question) }, tasksDir: empty, sandbox: rig.judgeSandbox(), agent: judgeDriver({ provider, model: o.usersimModel, proxy, maxOutputTokens: PERSONA_MAX_OUTPUT_TOKENS, effort: PERSONA_REASONING_EFFORT }), dir: join(s.dir, "usersim", String(++answers)), timeoutS: PERSONA_TIMEOUT_S, network: rig.network });
        return personaAnswer(run.record.termination, run.record.turns.at(-1));
      } catch {
        return { stop: { kind: "missing", code: "E_USERSIM" } };
      }
    };
    return {
      answer: (text: string, question: string): Promise<PersonaAnswer> => (pending = ask(text, question)),
      close: async (): Promise<number> => {
        await pending;
        if (!binding) return 0;
        const meter = await rig.finalize(binding.meter_id);
        appendFileSync(usersimLog, JSON.stringify({ cell: { model: s.model, arm, task: s.task.id, round: s.round, trial: s.trial }, usersim_model: o.usersimModel, usersim_route: provider + " " + JUDGE_ROUTE[provider], answers, cost_micros: meter.micros }) + "\n");
        return meter.micros;
      },
    };
  };
  const hasPersona = (taskId: string) => o.host === "claude" && o.entries[taskId]?.user?.persona !== undefined;

  const session = async (s: SessionSpec): Promise<TrialRun & { calls: HostCall[] }> => {
    const provider = providerOf(o.policy, s.model)!;
    const armName = s.arm?.name ?? JUDGE_ARM;
    const cell = s.arm ? (rig.cells?.[s.arm.name]?.[s.model] ?? null) : null;
    const codex = s.host === "claude" ? codexOption(o.policy, cell) : null;
    const binding = await rig.bind({ cell: { run_id: o.runId, arm: armName, task: s.task.id, model: s.model, trial: s.trial, attempt: s.round }, models: s.arm ? slotModels(o.policy, s.model, codex ? cell : null) : [provider + ":" + s.model], allowance_micros: s.allowance });
    const home = s.sandbox.homePath(s.dir);
    const armInstall = s.arm ? rig.arms[s.arm.name]! : null;
    const installed = armInstall?.skill ?? null;
    const plugins = (armInstall?.plugins ?? []).map((p) => posix.join(home, p));
    const holds = installed !== null;
    const skill = o.skill && s.arm && (holds || s.watchSkill) ? { name: o.skill, roots: installed ? installed.roots.map((r) => posix.join(home, r)) : [skillRoot(s.host, home, o.skill)], home, dir: installed?.dir ?? null, ...(s.sentinel ? { sentinel: s.sentinel } : {}), namespaces: armInstall ? armNamespaces(armInstall) : [] } : null;
    const proxy = { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token };
    const usersim = s.arm !== null && hasPersona(s.task.id) ? persona(s, armName) : null;
    const agent = s.arm === null ? judgeDriver({ provider, model: s.model, proxy, effort: JUDGE_REASONING_EFFORT }) : (rig.driver ?? hostDriver)({ host: s.host, model: s.model, provider, proxy, interactive: s.interactive, skill, out: join(s.dir, "host"), ...(s.entry ? { entry: s.entry } : {}), ...(usersim ? { freeform: usersim.answer } : {}), ...(plugins.length ? { plugins } : {}), ...(codex ? { codex } : {}) });
    const stateConfig = cell && Object.keys(cell.gstack_config).length ? { stateConfig: cell.gstack_config } : {};
    const run = await runTrial({ cell: { model: s.model, arm: armName, round: s.round, trial: s.trial }, task: s.task, ...(s.entry ? { entry: s.entry } : {}), tasksDir: s.tasksDir, sandbox: s.sandbox, agent, dir: s.dir, timeoutS: o.timeoutS, network: rig.network, ...stateConfig });
    const meter = await rig.finalize(binding.meter_id);
    spent += meter.micros + (usersim ? await usersim.close() : 0);
    run.record.cost_micros = meter.micros;
    if (!holds && !s.watchSkill) run.record.opened = null;
    const callsFile = join(s.dir, "host", "calls.json");
    const calls = existsSync(callsFile) ? ((JSON.parse(readFileSync(callsFile, "utf8")) as { calls?: HostCall[] }).calls ?? []) : [];
    return { ...run, calls };
  };

  const empty = join(o.out, "calibration", "fixtures");
  mkdirSync(empty, { recursive: true });
  const marks = sentinels(o.arms, o.nonce);
  const interactive = o.verdict.some((t) => t.interactive && (o.entries[t.id]?.user?.replies || o.entries[t.id]?.user?.persona));
  const egress = rig.egress();
  for (const model of o.models) {
    const probes = calibrationProbes({ host: o.host, skill: o.skill ?? "target", arms: o.arms.map((a) => ({ name: a.name, holdsSkill: rig.arms[a.name]!.skill !== null, gstack: rig.arms[a.name]!.gstack })), interactive, nonce: o.nonce });
    const runs = await pool(probes, o.parallel, async (probe): Promise<ProbeRun> => {
      const arm = o.arms.find((a) => a.name === probe.arm)!;
      const run = await session({ host: o.host, model, arm, round: 1, trial: 0, task: probe.task, ...(probe.entry ? { entry: probe.entry } : {}), interactive: probe.interactive, sandbox: rig.sandbox(arm.name, true, model), allowance: allowance(model), watchSkill: true, ...(marks[arm.name] ? { sentinel: marks[arm.name] } : {}), dir: join(o.out, "calibration", model.replaceAll("/", "_"), probe.task.id), tasksDir: empty });
      return { probe, outcome: run.record, calls: run.calls };
    });
    const judged = judgeCalibration({ host: o.host, model, nonce: o.nonce, sentinels: marks, runs, egress, usersim: interactive && o.host === "claude" });
    calibration[model] = judged.result;
    calibrationFailures.push(...judged.failures);
    if (runs.some((r) => r.outcome.termination.kind === "cap_stop")) stops.push({ code: "CAP_STOP", model: null, subject: null });
  }
  for (const f of calibrationFailures) log(f.code + " " + f.message);
  if (o.calibrateOnly || calibrationFailures.length || stops.length) return result();

  const judgeProvider = providerOf(o.policy, o.judgeModel);
  const judgeAllowance = judgeProvider ? allowance(o.judgeModel, JUDGE_ALLOWANCE) : 0;
  const judges = (task: VerdictTask) => task.judge && !task.safety && judgeProvider !== null;
  const total = o.models.length * o.verdict.length * o.arms.length * o.trials;
  let progress = newProgress(o.runId, total);
  let wall = 0;
  const journal = join(o.out, "cells.ndjson");
  mkdirSync(o.out, { recursive: true });

  let capped = false;
  const adjudicate = async (cell: Cell, task: VerdictTask, run: TrialRun, dir: string): Promise<void> => {
    const rec = run.record;
    if (!judges(task) || rec.termination.kind !== "completed") return;
    const names = [o.skill ?? "", "gstack"];
    const answer = redact(gradeScope(task) === "turns" ? rec.turns.join("\n\n") : (rec.turns.at(-1) ?? ""), names);
    const evidence = redact(JSON.stringify({ files_added: run.delta?.added ?? [], files_changed: run.delta?.changed ?? [], files_deleted: run.delta?.deleted ?? [], check_passed: rec.check }, null, 2), names);
    const prompt = judgePrompt({ prompt: byId.get(task.id)!.prompt, rubric: o.entries[task.id]?.judge ?? "", answer: answer.text, evidence: evidence.text, nonce: randomUUID().slice(0, 8) });
    const judgeDir = join(o.out, "judge", randomUUID());
    const jr = await session({ host: o.host, model: o.judgeModel, arm: null, round: cell.round, trial: cell.trial, task: { id: task.id + "-judge", prompt }, interactive: false, sandbox: rig.judgeSandbox(), allowance: judgeAllowance, watchSkill: false, dir: judgeDir, tasksDir: empty });
    const kind = jr.record.termination.kind;
    rec.judge = kind === "completed" ? parseJudgment(jr.record.turns.at(-1) ?? "") : null;
    if (kind === "cap_stop") capped = true;
    else if (rec.judge === null && !stops.some((s) => s.code === "JUDGE_UNAVAILABLE" && s.subject === task.id)) stops.push({ code: "JUDGE_UNAVAILABLE", model: cell.model, subject: task.id });
    appendFileSync(join(o.out, "adjudication.ndjson"), JSON.stringify({ cell, judge_model: o.judgeModel, judge_route: judgeProvider + " " + JUDGE_ROUTE[judgeProvider!], dir: judgeDir, redacted: answer.hits + evidence.hits, judgment: rec.judge, termination: jr.record.termination, cost_micros: jr.record.cost_micros }) + "\n");
  };

  const round = async (r: 1 | 2, models: readonly string[]): Promise<boolean> => {
    for (let trial = 0; trial < o.trials; trial++) {
      const batch = models.flatMap((model) => o.verdict.flatMap((task) => o.arms.map((arm) => ({ cell: { model, arm: arm.name, task: task.id, round: r, trial } as Cell, task, arm }))));
      const fresh = batch.filter((c) => !reuse.has(cellId(c.cell)));
      const worst = fresh.reduce((s, c) => s + allowance(c.cell.model) + (judges(c.task) ? judgeAllowance : 0) + (hasPersona(c.task.id) ? allowance(o.usersimModel, USERSIM_ALLOWANCE) : 0), 0);
      if (o.cap !== null && spent + worst > o.cap) {
        stops.push({ code: "CAP_STOP", model: null, subject: null });
        return false;
      }
      const runs = await pool(batch, o.parallel, async (c) => {
        const reused = reuse.get(cellId(c.cell));
        if (reused) return reused.record;
        const dir = join(o.out, "runs", c.cell.model.replaceAll("/", "_"), c.arm.name, c.task.id, "r" + r + "-t" + trial);
        const run = await session({ host: o.host, model: c.cell.model, arm: c.arm, round: r, trial, task: byId.get(c.task.id)!, ...(o.entries[c.task.id] ? { entry: o.entries[c.task.id] } : {}), interactive: c.task.interactive, sandbox: rig.sandbox(c.arm.name, false, c.cell.model), allowance: allowance(c.cell.model), watchSkill: false, dir, tasksDir: o.tasksDir });
        await adjudicate(c.cell, c.task, run, dir);
        const g = gradeTrial(c.task, run.record);
        wall += run.record.wall_ms ?? 0;
        progress = recordSession(progress, cellName(c.cell), run.record.termination.kind === "completed" ? (g.outcome === "pass" ? "pass" : "fail") : run.record.termination.kind === "timeout" ? "timeout" : "missing", wall / 1000 / (records.length + 1), o.parallel);
        writeProgress(o.out, progress);
        const unjudged = judges(c.task) && run.record.termination.kind === "completed" && run.record.judge === null;
        if (run.record.termination.kind !== "cap_stop" && !unjudged) appendFileSync(journal, JSON.stringify({ cell: c.cell, key: keyOf(c.cell.model, c.arm, byId.get(c.task.id)!), record: run.record } satisfies JournalEntry) + "\n");
        return run.record;
      });
      records.push(...runs);
      if (capped || runs.some((rec) => rec.termination.kind === "cap_stop")) {
        stops.push({ code: "CAP_STOP", model: null, subject: null });
        return false;
      }
    }
    return true;
  };
  if (await round(1, o.models)) {
    const red = rerunPlan(input).map((m) => m.model);
    if (red.length) await round(2, red);
  }
  return result();
}

/** sha256 over the check runner and delta import code: the session key's verifier part. */
export function verifierSha256(): string {
  const src = join(import.meta.dir, "..", "..");
  return createHash("sha256").update(readFileSync(join(src, "trial", "trial.ts"))).update(readFileSync(join(src, "trial", "delta.ts"))).digest("hex");
}

/** sha256 over the adapter code a verdict on this host depends on. */
export function adapterSha256(host: Host): string {
  const src = join(import.meta.dir, "..", "..");
  const files = [host === "claude" ? "adapters/claude-code/driver.ts" : "adapters/codex/driver.ts", "adapters/host.ts", "adapters/calibration.ts", "adapters/judge.ts", "trial/state-root.ts", "grade/transcript.ts", "usersim/sim.ts", "usersim/classifier.ts", "usersim/persona.ts", "skill-eval/cli/run-host.ts"];
  const h = createHash("sha256");
  for (const f of files) h.update(f + "\0" + readFileSync(join(src, f)) + "\0");
  return h.digest("hex");
}

const PROVIDER_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

/**
 * Builds each arm's image from its install on the trial image, and its calibration copy (the arm image plus its
 * SKILL.md with the sentinel appended). A base arm's first layer is built once as its own image, so every arm on one
 * base shares it. With retain, every layer tree is kept there by digest. An arm with cells (src/arms/cells.ts) gets one
 * image per cell whose settings add a layer, and that layer is kept like the arm's own. Writes <out>/arms.json: per arm
 * its provenance (repo, sha, subtree path, git tree and tree sha256 for a stack), layers, plugin roots, image and cells. Returns each image tag by arm name, by
 * name#calibration for the copies and by name@model for the cells.
 */
export function armImages(o: { trialImage: string; home: string; installs: readonly ArmInstall[]; marks: Readonly<Record<string, string>>; tasksDir: string; state: string; docker: string; out: string; retain: string | null; noCache?: boolean; cells?: Readonly<Record<string, readonly CellSettings[]>> }): Map<string, string> {
  const images = new Map<string, string>();
  const shared = new Map<string, string>();
  const record: Record<string, unknown>[] = [];
  const build = (base: string, layers: readonly Layer[]) => {
    const built = buildArmImage({ base, layers: layers.map((l) => ({ src: l.src, dest: l.dest ? posix.join(o.home, l.dest) : o.home })), tasksDir: o.tasksDir, state: o.state, docker: o.docker, ...(o.noCache ? { noCache: true } : {}) });
    if (!built.ok) throw new Error(built.code + ": " + built.message);
    return built;
  };
  for (const arm of o.installs) {
    let base = o.trialImage;
    let rest = arm.layers;
    if (arm.layers.length > 1) {
      const first = arm.layers[0]!.src;
      if (!shared.has(first)) shared.set(first, build(o.trialImage, [arm.layers[0]!]).tag);
      base = shared.get(first)!;
      rest = arm.layers.slice(1);
    }
    const image = build(base, rest);
    images.set(arm.name, image.tag);
    let calibration = image;
    if (arm.skill) {
      const dir = join(o.out, "calibration", "arms", arm.name);
      rmSync(dir, { recursive: true, force: true });
      calibration = build(image.tag, [sentinelLayer(arm, withSentinel(readFileSync(arm.skill.file, "utf8"), o.marks[arm.name]!), dir)]);
    }
    images.set(arm.name + "#calibration", calibration.tag);
    const kept = (l: Layer) => ({ dest: l.dest, ...(o.retain ? { retained: retainTree(l.src, o.retain) } : { tree_sha256: dirTreeSha256(l.src) }) });
    const layers = arm.layers.map(kept);
    const models = (o.cells?.[arm.name] ?? []).map((c) => c.cell.model);
    if (new Set(models).size !== models.length) throw new Error("E_USAGE: arm " + arm.name + " has two cells on one model; cell images are keyed by arm and model");
    const cells = (o.cells?.[arm.name] ?? []).map((c) => {
      const built = c.layer ? build(image.tag, [c.layer]) : image;
      images.set(arm.name + "@" + c.cell.model, built.tag);
      return { model: c.cell.model, voice: c.cell.voice, tree_sha256: c.tree_sha256, gstack_config: c.gstack_config, codex: c.codex, layer: c.layer ? kept(c.layer) : null, image: { tag: built.tag, digest: built.digest } };
    });
    record.push({ name: arm.name, provenance: arm.provenance, tree_sha256: arm.tree_sha256, layers, ...(arm.plugins.length ? { plugins: arm.plugins } : {}), image: { tag: image.tag, digest: image.digest, dropped: image.dropped }, calibration_image: { tag: calibration.tag, digest: calibration.digest }, ...(cells.length ? { cells } : {}) });
  }
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, "arms.json"), JSON.stringify({ schema_version: 1, trial_image: o.trialImage, arms: record }, null, 2) + "\n");
  return images;
}

/** The Docker rig: arm installs and images, the lease, the trial network and the proxy container. Throws with a reason code when a step fails, after undoing the steps before it, the installs the run built included. */
export function dockerRig(call: Pick<Call, "host" | "arms" | "tasks" | "out" | "ledger" | "item" | "runId" | "record" | "models" | "policy">, o: { env: Env; skill: string | null; skills?: Readonly<Record<string, string>>; nonce: string; cap: number; voice?: boolean; gstackConfig?: Readonly<Record<string, Readonly<Record<string, string>>>> }): HostRig {
  const bin = o.env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const state = stateRoot(o.env);
  const pin = checkImagePin({ state, docker: bin });
  if (!pin.ok) throw new Error(pin.code + ": " + pin.message);
  const home = dockerSandbox({ trialImage: pin.pin.tag, docker: bin }).homePath("");
  const hold = runHold(state, call.runId);
  const undo: (() => void)[] = [() => releaseInstalls(hold)];
  try {
    const installs = installArms({ host: call.host, arms: call.arms.arms, skill: o.skill, ...(o.skills ? { skills: o.skills } : {}), base: call.arms.base, sources: stackSources({ root: call.arms.base?.root ?? null, home: homedir(), state }), runner: dockerInstaller({ image: pin.pin.tag, digest: pin.pin.digest, docker: bin, home }), state, hold });
    const retain = join(state, "retained");
    const kept = retainImage(pin.pin.tag, retain, dockerRun, bin);
    if ("ok" in kept) throw new Error(kept.code + ": " + kept.message);
    const cells = armCells(installs, call.models, call.policy, join(state, "cells"), { voice: o.voice ?? true, ...(o.gstackConfig ? { gstackConfig: o.gstackConfig } : {}) });
    const images = armImages({ trialImage: pin.pin.tag, home, installs, marks: sentinels(call.arms.arms, o.nonce), tasksDir: dirname(resolve(call.tasks)), state, docker: bin, out: call.out.path, retain, cells: Object.fromEntries(Object.entries(cells).map(([arm, byModel]) => [arm, Object.values(byModel)])) });
    const local = openLocalLedger(call.ledger);
    const lease = openLease(call.record.path, local, { item: call.item!, run_id: call.runId, amount_micros: o.cap, requireAdmission: rigAdmission({ proof: "trial" }) });
    undo.unshift(() => settleLease(call.record.path, local, lease.lease_id));
    const network = createTrialNetwork(bin);
    undo.unshift(() => removeTrialNetwork(network, bin));
    const token = randomBytes(32).toString("hex");
    const providerKeys = Object.fromEntries(PROVIDER_KEYS.flatMap((k) => (o.env[k] ? [[k, o.env[k]!]] : [])));
    const proxy = startProxyContainer({ image: pin.pin.tag, net: network, dir: join(call.out.path, "proxy"), ledger: call.ledger.path, leaseId: lease.lease_id, managementToken: token, retry: { attempts: 3, elapsed_ms: 300_000 }, providerKeys, docker: bin });
    const control = new ProxyControl(proxy.socket, token);
    return {
      baseUrl: proxy.baseUrl,
      network: network.name,
      imageDigest: pin.pin.digest,
      recovery: { lease_id: lease.lease_id, proxy_container: proxy.container, journal: proxy.journal },
      bind: (request) => control.bind(request),
      finalize: (meterId) => control.finalize(meterId),
      arms: Object.fromEntries(installs.map((i) => [i.name, i])),
      cells,
      sandbox: (arm, calibration, model) => dockerSandbox({ trialImage: pin.pin.tag, armImage: images.get(calibration ? arm + "#calibration" : model && images.has(arm + "@" + model) ? arm + "@" + model : arm)!, docker: bin }),
      judgeSandbox: () => dockerSandbox({ trialImage: pin.pin.tag, docker: bin }),
      egress() {
        const work = join(call.out.path, "calibration", "egress");
        mkdirSync(work, { recursive: true });
        const s = dockerSandbox({ trialImage: pin.pin.tag, docker: bin }).agent("egress", { work, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home }, network: network.name });
        try {
          const r = s.exec("curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com", 20_000);
          return { open: r.exitCode === 0, detail: "curl https://example.com exited " + r.exitCode + " " + (r.stdout + r.stderr).trim().slice(0, 200) };
        } finally {
          s.stop();
        }
      },
      async close() {
        const { settled } = await recoverRun({ stopProxy: () => proxy.stop(), journal: proxy.journal, ledger: local, settle: () => settleLease(call.record.path, local, lease.lease_id) });
        removeTrialNetwork(network, bin);
        releaseInstalls(hold);
        return { committed: settled.spent_micros, unknown: settled.unknown_calls, lease_id: lease.lease_id };
      },
    };
  } catch (error) {
    for (const step of undo) step();
    throw error;
  }
}

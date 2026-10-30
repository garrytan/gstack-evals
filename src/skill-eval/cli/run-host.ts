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
// - The Docker rig builds one arm image per arm (and one per calibration copy), opens the lease, starts the proxy
//   container on the trial network (createTrialNetwork) and binds slots over its management socket. close() keeps
//   resume's order: stop the proxy, reconcile its journal, settle the lease.
// - Arms on a real host are loose skill folders, none and bare. A gstack base at a sha, a stack and a placebo arm, and
//   the persona's free-form model, are GST-272's, and a loadout arm has no installer yet; hostReadiness refuses them
//   with E_USAGE before anything is spent.
import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { calibrationProbes, judgeCalibration, sentinelFor, withSentinel, type CalibrationFailure, type ProbeRun } from "../../adapters/calibration.ts";
import { hostDriver, SKILL_DIRS, skillRoot } from "../../adapters/host.ts";
import type { Call as HostCall } from "../../grade/transcript.ts";
import { openLease, settleLease } from "../../runner/ledger/ledger.ts";
import { openLocalLedger } from "../../runner/ledger/local.ts";
import { ProxyControl, type BindRequest, type Binding, type Meter } from "../../runner/proxy/metering-proxy.ts";
import { newProgress, recordSession, writeProgress } from "../../trial/cache.ts";
import { buildArmImage, checkImagePin, stateRoot } from "../../trial/image.ts";
import { createTrialNetwork, recoverRun, removeTrialNetwork, startProxyContainer } from "../../trial/proxy.ts";
import { dockerSandbox, type Sandbox } from "../../trial/sandbox.ts";
import { runTrial, type TrialRun } from "../../trial/trial.ts";
import type { ArmSpec, CalibrationResult, Host, TrialRecord } from "../../types.ts";
import type { SidecarTask } from "../contract/sidecar.ts";
import type { ContractTask } from "../contract/tasks.ts";
import { rerunPlan, type Stop, type VerdictInput } from "../verdict/gates.ts";
import { gradeTrial, type VerdictTask } from "../verdict/grade.ts";
import type { GateEvidence } from "../verdict/lock.ts";
import type { Call } from "./call.ts";
import { allowanceMicros, SESSION_ALLOWANCE } from "./dry-run.ts";
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
  /** The sandbox whose agent HOME holds the arm, or the arm's calibration copy. */
  sandbox(arm: string, calibration: boolean): Sandbox;
  /** The evaluator's egress probe to a non-model host, from an agent session on the agents' network. */
  egress(): { open: boolean; detail: string };
  /** Stops the proxy, reconciles its journal and settles the lease, in that order. */
  close(): Promise<{ committed: number; unknown: number; lease_id: string | null }>;
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
  /** --calibrate: stop after calibration, before any trial. */
  calibrateOnly?: boolean;
}

export interface HostRun {
  input: VerdictInput;
  spent: number;
  stopped: boolean;
  calibrationFailures: CalibrationFailure[];
}

const holdsSkill = (arm: ArmSpec): arm is Extract<ArmSpec, { kind: "overlay" }> & { dir: string } => arm.kind === "overlay" && arm.dir !== null;

/** Each arm's calibration sentinel, for the arms that hold the skill. */
export const sentinels = (arms: readonly ArmSpec[], nonce: string): Record<string, string> => Object.fromEntries(arms.filter(holdsSkill).map((a) => [a.name, sentinelFor(nonce, a.name)]));

/** Why this call cannot run on a real host yet, or null. */
export function hostReadiness(call: Pick<Call, "host" | "arms" | "isolation" | "item" | "spendCap">, tasks: readonly { id: string; judge: boolean }[], entries: Readonly<Record<string, SidecarTask>> = {}): Stop & { message: string } | null {
  const stop = (message: string) => ({ code: "E_USAGE" as const, model: null, subject: null, message });
  const later = call.arms.arms.filter((a) => a.kind === "stack" || a.kind === "placebo" || (a.kind === "overlay" && a.base !== null));
  if (later.length) return stop("arm" + (later.length > 1 ? "s " : " ") + later.map((a) => a.name).join(", ") + " need" + (later.length > 1 ? "" : "s") + " a gstack base, stack or placebo install on a real host, which lands with GST-272; use loose skill folders, none and bare");
  const loadouts = call.arms.arms.filter((a) => a.kind === "loadout");
  if (loadouts.length) return stop("loadout arm" + (loadouts.length > 1 ? "s " : " ") + loadouts.map((a) => a.name).join(", ") + ": a real host has no loadout install yet; use loose skill folders, none and bare");
  const personas = tasks.filter((t) => entries[t.id]?.user?.persona !== undefined).map((t) => t.id);
  if (personas.length) return stop("task" + (personas.length > 1 ? "s " : " ") + personas.join(", ") + " declare" + (personas.length > 1 ? "" : "s") + " a user persona, whose free-form answers land with GST-272; a real host runs scripted replies only");
  if (call.isolation !== "docker") return stop("a real host runs under --isolation docker only; process isolation has no arm install");
  if (tasks.some((t) => t.judge)) return stop("tasks with a judge rubric need blinded adjudication on a real host, which is not built yet");
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
  model: string;
  arm: ArmSpec;
  round: 1 | 2;
  trial: number;
  task: ContractTask;
  entry?: SidecarTask;
  interactive: boolean;
  calibration: boolean;
  /** Count reads of the target skill even in an arm that does not hold it (calibration's none check). */
  watchSkill: boolean;
  dir: string;
  tasksDir: string;
}

export async function runOnHost(o: HostRunInput, rig: HostRig, log: (line: string) => void = () => {}): Promise<HostRun> {
  const records: TrialRecord[] = [];
  const stops: Stop[] = [];
  const calibration: Record<string, CalibrationResult> = {};
  const calibrationFailures: CalibrationFailure[] = [];
  let spent = 0;
  const allowance = (model: string): number => {
    const a = allowanceMicros({ policy: o.policy }, model, SESSION_ALLOWANCE);
    if (a === null) throw new Error("E_INTERNAL: no price row for " + model + " passed preflight");
    return a;
  };
  const session = async (s: SessionSpec): Promise<TrialRun & { calls: HostCall[] }> => {
    const provider = providerOf(o.policy, s.model)!;
    const binding = await rig.bind({ cell: { run_id: o.runId, arm: s.arm.name, task: s.task.id, model: s.model, trial: s.trial, attempt: s.round }, models: [provider + ":" + s.model], allowance_micros: allowance(s.model) });
    const sandbox = rig.sandbox(s.arm.name, s.calibration);
    const home = sandbox.homePath(s.dir);
    const skill = o.skill && (holdsSkill(s.arm) || s.watchSkill) ? { name: o.skill, roots: [skillRoot(o.host, home, o.skill)], home, dir: holdsSkill(s.arm) ? s.arm.dir : null } : null;
    const agent = hostDriver({ host: o.host, model: s.model, provider, proxy: { baseUrl: rig.baseUrl, slot: binding.slot, token: binding.token }, interactive: s.interactive, skill, out: join(s.dir, "host"), ...(s.entry ? { entry: s.entry } : {}) });
    const run = await runTrial({ cell: { model: s.model, arm: s.arm.name, round: s.round, trial: s.trial }, task: s.task, ...(s.entry ? { entry: s.entry } : {}), tasksDir: s.tasksDir, sandbox, agent, dir: s.dir, timeoutS: o.timeoutS, network: rig.network });
    const meter = await rig.finalize(binding.meter_id);
    spent += meter.micros;
    run.record.cost_micros = meter.micros;
    if (!holdsSkill(s.arm)) run.record.opened = s.watchSkill ? run.record.opened : null;
    const callsFile = join(s.dir, "host", "calls.json");
    const calls = existsSync(callsFile) ? ((JSON.parse(readFileSync(callsFile, "utf8")) as { calls?: HostCall[] }).calls ?? []) : [];
    return { ...run, calls };
  };

  const empty = join(o.out, "calibration", "fixtures");
  mkdirSync(empty, { recursive: true });
  const marks = sentinels(o.arms, o.nonce);
  const interactive = o.verdict.some((t) => t.interactive && o.entries[t.id]?.user?.replies);
  const egress = rig.egress();
  for (const model of o.models) {
    const probes = calibrationProbes({ host: o.host, skill: o.skill ?? "target", arms: o.arms.map((a) => ({ name: a.name, holdsSkill: holdsSkill(a) })), interactive, nonce: o.nonce });
    const runs = await pool(probes, o.parallel, async (probe): Promise<ProbeRun> => {
      const arm = o.arms.find((a) => a.name === probe.arm)!;
      const run = await session({ model, arm, round: 1, trial: 0, task: probe.task, ...(probe.entry ? { entry: probe.entry } : {}), interactive: probe.interactive, calibration: true, watchSkill: true, dir: join(o.out, "calibration", model.replaceAll("/", "_"), probe.task.id), tasksDir: empty });
      return { probe, outcome: { ...run.record, turns: run.record.turns }, calls: run.calls };
    });
    const judged = judgeCalibration({ host: o.host, model, nonce: o.nonce, sentinels: marks, runs, egress, usersim: interactive && o.host === "claude" });
    calibration[model] = judged.result;
    calibrationFailures.push(...judged.failures);
    if (runs.some((r) => r.outcome.termination.kind === "cap_stop")) stops.push({ code: "CAP_STOP", model: null, subject: null });
  }
  for (const f of calibrationFailures) log(f.code + " " + f.message);

  const input: VerdictInput = { tasks: o.verdict, models: o.models, arms: o.arms.map((a) => a.name), records, calibration, stops, ...(o.gate ? { gate: o.gate } : {}) };
  if (o.calibrateOnly || calibrationFailures.length || stops.length) return { input, spent, stopped: stops.length > 0, calibrationFailures };

  const byId = new Map(o.tasks.map((t) => [t.id, t]));
  const total = o.models.length * o.verdict.length * o.arms.length * o.trials;
  let progress = newProgress(o.runId, total);
  let wall = 0;
  const round = async (r: 1 | 2, models: readonly string[]): Promise<boolean> => {
    for (let trial = 0; trial < o.trials; trial++) {
      const batch = models.flatMap((model) => o.verdict.flatMap((task) => o.arms.map((arm) => ({ model, task, arm }))));
      const worst = batch.reduce((s, c) => s + allowance(c.model), 0);
      if (o.cap !== null && spent + worst > o.cap) {
        stops.push({ code: "CAP_STOP", model: null, subject: null });
        return false;
      }
      const runs = await pool(batch, o.parallel, async (c) => {
        const run = await session({ model: c.model, arm: c.arm, round: r, trial, task: byId.get(c.task.id)!, ...(o.entries[c.task.id] ? { entry: o.entries[c.task.id] } : {}), interactive: c.task.interactive, calibration: false, watchSkill: false, dir: join(o.out, "runs", c.model.replaceAll("/", "_"), c.arm.name, c.task.id, "r" + r + "-t" + trial), tasksDir: o.tasksDir });
        const g = gradeTrial(c.task, run.record);
        wall += run.record.wall_ms ?? 0;
        progress = recordSession(progress, c.model + "/" + c.arm.name + "/" + c.task.id + "/r" + r + "-t" + trial, run.record.termination.kind === "completed" ? (g.outcome === "pass" ? "pass" : "fail") : run.record.termination.kind === "timeout" ? "timeout" : "missing", wall / 1000 / (records.length + 1), o.parallel);
        writeProgress(o.out, progress);
        return run.record;
      });
      records.push(...runs);
      if (runs.some((rec) => rec.termination.kind === "cap_stop")) {
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
  return { input, spent, stopped: stops.length > 0, calibrationFailures };
}

/** sha256 over the adapter code a verdict on this host depends on. */
export function adapterSha256(host: Host): string {
  const src = join(import.meta.dir, "..", "..");
  const files = [host === "claude" ? "adapters/claude-code/driver.ts" : "adapters/codex/driver.ts", "adapters/host.ts", "adapters/calibration.ts", "grade/transcript.ts", "usersim/sim.ts", "usersim/classifier.ts", "skill-eval/cli/run-host.ts"];
  const h = createHash("sha256");
  for (const f of files) h.update(f + "\0" + readFileSync(join(src, f)) + "\0");
  return h.digest("hex");
}

const PROVIDER_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

/** The Docker rig: arm images, the lease, the trial network and the proxy container. Throws with a reason code when a step fails, after undoing the steps before it. */
export function dockerRig(call: Call, o: { env: Env; skill: string | null; nonce: string }): HostRig {
  const bin = o.env.GSTACK_EVALS_DOCKER_BIN || "docker";
  const state = stateRoot(o.env);
  const pin = checkImagePin({ state });
  if (!pin.ok) throw new Error(pin.code + ": " + pin.message);
  const tasksDir = dirname(resolve(call.tasks));
  const marks = sentinels(call.arms.arms, o.nonce);
  const images = new Map<string, string>();
  const home = dockerSandbox({ trialImage: pin.pin.tag, docker: bin }).homePath("");
  for (const arm of call.arms.arms) {
    for (const calibration of [false, true]) {
      const layers = [];
      if (holdsSkill(arm) && o.skill) {
        let src = arm.dir;
        if (calibration) {
          src = join(call.out.path, "calibration", "arms", arm.name);
          cpSync(arm.dir, src, { recursive: true });
          writeFileSync(join(src, "SKILL.md"), withSentinel(readFileSync(join(arm.dir, "SKILL.md"), "utf8"), marks[arm.name]!));
        }
        layers.push({ src, dest: home + "/" + SKILL_DIRS[call.host] + "/" + o.skill });
      }
      const built = buildArmImage({ base: pin.pin.tag, layers, tasksDir, state });
      if (!built.ok) throw new Error(built.code + ": " + built.message);
      images.set(arm.name + (calibration ? "#calibration" : ""), built.tag);
    }
  }
  const local = openLocalLedger(call.ledger);
  const lease = openLease(call.record.path, local, { item: call.item!, run_id: call.runId, amount_micros: call.spendCap! });
  let net: ReturnType<typeof createTrialNetwork> | null = null;
  try {
    net = createTrialNetwork(bin);
    const token = randomBytes(32).toString("hex");
    const providerKeys = Object.fromEntries(PROVIDER_KEYS.flatMap((k) => (o.env[k] ? [[k, o.env[k]!]] : [])));
    const proxy = startProxyContainer({ image: pin.pin.tag, net, dir: join(call.out.path, "proxy"), ledger: call.ledger.path, leaseId: lease.lease_id, managementToken: token, retry: { attempts: 3, elapsed_ms: 300_000 }, providerKeys, docker: bin });
    const control = new ProxyControl(proxy.socket, token);
    const network = net;
    return {
      baseUrl: proxy.baseUrl,
      network: network.name,
      imageDigest: pin.pin.digest,
      bind: (request) => control.bind(request),
      finalize: (meterId) => control.finalize(meterId),
      sandbox: (arm, calibration) => dockerSandbox({ trialImage: pin.pin.tag, armImage: images.get(arm + (calibration ? "#calibration" : ""))!, docker: bin }),
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
        return { committed: settled.spent_micros, unknown: settled.unknown_calls, lease_id: lease.lease_id };
      },
    };
  } catch (error) {
    if (net) removeTrialNetwork(net, bin);
    settleLease(call.record.path, local, lease.lease_id);
    throw error;
  }
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's launch loop (prereg sections 2, 4, 8, 12 and 13; pre-run change 1, items 1, 4a, 4b,
// 4c and 5; pre-run change 2). It is the founder lane's runSchedule adapted to two gstack pins plus none and the
// closing loop, and reuses the same parts: the Docker rig (dockerRig), one trial per attempt (runTrial), the Claude
// Code driver, the containment probe and read audit, the work repo, the metered simulator call and the receipts copy.
// - Before the first lease: the launch's caps must fit its ledger line (E_OHR_CAP_LINE), the manifest must hold no
//   session on a null pin (E_OHR_NEW_PIN_UNSET), every T8 brief must seed (E_OHR_T8_SEED), and the manifest freezes to
//   <out>/manifest.json or matches the one there byte for byte (E_OHR_MANIFEST). A launch on an out dir whose
//   stops.json holds a cap stop is refused: a cap stop is an incomplete run and is never resumed.
// - At rig open each skill arm's installed tree must hold its pin's VERSION and every pinned file hash, or the launch
//   is refused (E_OHR_PIN_MISMATCH); each session's container checks its own copy again when it stops.
// - A round (one brief and model, its arms adjacent) starts only when each session's arm allowance, once, fits what the
//   arm item may still spend after the spend so far and the allowances held for attempts in flight, and the simulator
//   allowance, once a session, fits the simulator item the same way (roundReserve; pre-run change 4); otherwise the
//   launch cap-stops. A ledger cap stop inside a session does the same. Sessions already running finish, and no new one
//   starts.
// - Each session takes at most two attempts (one retry). The retry runs only when its arm and simulator allowances
//   still fit what the launch has left; otherwise the session ends as a cap stop and the launch stops (pre-run change 4).
//   An attempt's marker (attempt.json) is written before its launch, so a relaunch that finds a marker with no row counts
//   that attempt as an unknown harness failure.
// - dockerLaunch is one attempt: a proxy slot at the session's allowance, the arm's sandbox wrapped by the probe (env
//   names, the ARM_ENV_UNSET names, mounts, egress, and on skill arms the container's pin check), a fresh work repo with
//   no instruction file (seeded on a skill arm of a T8 brief), the driver with the claude-code-preset system prompt,
//   60 agent turns a reply, a 200,000-token window, cap stops, AskUserQuestion denied beside WebSearch and WebFetch, no
//   GSTACK_SESSION_KIND, and the closing loop as nextUser. Skill arms get a fresh state root, copied out after; none
//   gets none, and its tool calls are audited for gstack reads.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { claudeCodeDriver, claudeCodeEnv, type ClaudeProvider, type NextUser } from "../../../src/adapters/claude-code/driver.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { armNamespaces, slotModels, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { gstackDir } from "../../../src/trial/review/plan.ts";
import type { AgentSession, Sandbox } from "../../../src/trial/sandbox.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { runTrial } from "../../../src/trial/trial.ts";
import type { Termination } from "../../../src/types.ts";
import { departures, gstackReads, probe, TASK, workRepo } from "../../office-hours-founder/run/contain.ts";
import { copyReceipts, receiptsAfter } from "../../office-hours-founder/run/run.ts";
import { SYSTEM_PROMPT } from "../../office-hours-founder/frozen.ts";
import { pinnedCall, type SimOutcome } from "../sim/founder.ts";
import { pool, type Meter } from "../../product-value/meter.ts";
import { pvOutcome } from "../../product-value/parse.ts";
import { AGENT_TURNS_PER_REPLY, ALLOWANCE, MODEL_KEYS, SESSION_MINUTES, SIM_ALLOWANCE, type Pin } from "../frozen.ts";
import type { ArmId, BlockParser, BriefKind, BriefMeta, ManifestEntry, ModelId, PriorSession } from "../types.ts";
import { capProblem, entryId, freezeManifest, loadBriefs, makeManifest, type LaunchName } from "./manifest.ts";
import type { ManifestLook } from "./half.ts";
import { armEnvProblems, containerPinCommand, containerPinProblems, containerRoot, isSkillArm, nullPinProblem, pinProblems, type Pins } from "./pins.ts";
import { readRows, sessionRow, type RowLine } from "./rows.ts";
import { priorProblem, seedPrior } from "./seed.ts";
import { offPin } from "../pinned.ts";
import { attemptOutcome, closingLoop, firstMessage, safetyStop, sessionKindOf, settle, type AttemptRead, type Line, type Outcome } from "./session.ts";
import type { PersonSheet, SimCall } from "../../../src/persona-sim/sim.ts";
import { loadPerson } from "../sim/founder.ts";

export { copyReceipts, receiptsAfter };

/** Session allowances in dollars: per arm and model (section 4 step 5), and the simulator's per session. */
export interface Allowances {
  arm: Readonly<Record<ArmId, Readonly<Record<ModelId, number>>>>;
  sim: number;
}
export const ALLOWANCES: Allowances = { arm: { none: ALLOWANCE.none, current: ALLOWANCE.skill, new: ALLOWANCE.skill }, sim: SIM_ALLOWANCE };

const D = 1_000_000;
const armMicros = (a: Allowances, e: ManifestEntry) => Math.round(a.arm[e.arm][e.model] * D);
const simMicros = (a: Allowances) => Math.round(a.sim * D);

/** What a round holds before it starts, in micros: each session's arm allowance and the simulator allowance, once each (pre-run change 4). */
export function roundReserve(a: Allowances, round: readonly ManifestEntry[]): { arms: number; sim: number } {
  return { arms: round.reduce((s, e) => s + armMicros(a, e), 0), sim: round.length * simMicros(a) };
}

/** One attempt's simulator call and its settled spend. */
export interface SimSlot {
  call: SimCall;
  spent(): number;
}

/** The simulator slot over the simulator item's meter: the founder lane's founderCall on a fresh per-attempt allowance, with a reply naming another model than Argon read as a drift (sim/founder.ts pinnedCall). */
export const meterSim = (meter: Pick<Meter, "call">) => (label: string, allowanceMicros: number): SimSlot => {
  const session = { allowance_micros: allowanceMicros, spent_micros: 0 };
  return { call: pinnedCall({ meter, session, label }), spent: () => session.spent_micros };
};

/** One attempt as a launch takes it. */
export interface LaunchInput {
  rig: HostRig;
  policy: LoadedPolicy;
  entry: ManifestEntry;
  attempt: number;
  dir: string;
  prompt: string;
  nextUser: (texts: string[]) => Promise<NextUser>;
  allowanceMicros: number;
  runId: string;
  docker: string;
  pin: Pin | null;
  /** The T8 prior session a skill arm seeds, or null. */
  prior: PriorSession | null;
  day: string;
}
export type Launch = (o: LaunchInput) => Promise<Omit<AttemptRead, "loop" | "sim_micros">>;

export interface RunInput {
  launch: LaunchName;
  briefsDir: string;
  out: string;
  runId: string;
  models: readonly ModelId[];
  arms: readonly ArmId[];
  pins: Pins;
  buildCommit: string;
  dropped: readonly string[];
  allowances: Allowances;
  /** Micro-dollars this launch may spend on the arm item and on the simulator item. */
  cap: number;
  simCap: number;
  parallel: number;
  policy: LoadedPolicy;
  docker: string;
  /** The sessions' UTC day (YYYY-MM-DD), for T8 seeding. */
  day: string;
  log: (line: string) => void;
  /** The keyless end to end's own schedule in place of the launch's; no command passes it. */
  entries?: readonly ManifestEntry[];
  /** The local ledger the arm item's leases sit on, where a crashed attempt's spend is read back; null reads none. */
  ledger?: string | null;
  /** Stage 2's part (pre-run change 3): the half, or the second part after the interim read. */
  look?: ManifestLook;
}

export type SimTurnFn = (o: { kind: BriefKind; sheet: PersonSheet; transcript: Line[]; call: SimCall }) => Promise<SimOutcome>;

export interface RunDeps {
  /** Opens the item's lease and the rig; called only after the manifest is frozen. */
  openRig: () => HostRig | Promise<HostRig>;
  simSlot: (label: string, allowanceMicros: number) => SimSlot;
  simTurn: SimTurnFn;
  parse: BlockParser;
  launch?: Launch;
  /** The rig's skill-arm tree check; pinProblems on the installed gstack tree unless a test stands one in. */
  treeProblems?: (rig: HostRig, arm: ArmId, pin: Pin) => string[];
}

export interface RunResult {
  manifest_sha256: string;
  rows: RowLine[];
  stops: { code: ReasonCode; message: string }[];
  unrun: { id: string; how: "stopped" | "unstarted" }[];
  spent_micros: number;
  sim_micros: number;
  closed: { committed: number; unknown: number; lease_id: string | null } | null;
}

const usd = (m: number) => "$" + (m / D).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);
export { today };

/** The prior session a T8 brief carries, or null for any other brief. */
export function priorOf(dir: string, meta: BriefMeta): PriorSession | null {
  if (meta.type !== "T8") return null;
  const path = join(dir, meta.id, "prior.json");
  if (!existsSync(path)) throw new Error("E_OHR_T8_SEED " + meta.id + " is a T8 brief with no prior.json");
  return JSON.parse(readFileSync(path, "utf8")) as PriorSession;
}

/** The sandbox with each agent container probed once, just before it stops: the founder lane's probe, the arm env names and, on a skill arm, its pin check. */
export function ohrProbed(sandbox: Sandbox, o: { docker: string; home: string; pin: Pin | null; root: string | null; onProbe: (p: { contained: string[] | null; pin: string[] | null }) => void }): Sandbox {
  return {
    ...sandbox,
    agent(task, opts) {
      const session: AgentSession = sandbox.agent(task, opts);
      let done = false;
      return {
        ...session,
        stop() {
          if (!done) {
            done = true;
            const p = probe(session, o.docker, [sandbox.workPath(opts.work, task, opts.root), o.home]);
            const names = session.exec("awk 'BEGIN { for (k in ENVIRON) print k }'", 30_000);
            const env = names.exitCode === 0 ? armEnvProblems(names.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) : null;
            const pinned = o.pin && o.root ? session.exec(containerPinCommand(o.root, o.pin), 60_000) : null;
            o.onProbe({ contained: p && env ? [...departures(p), ...env.map((e) => "arm env: " + e)] : null, pin: !o.pin ? [] : pinned && pinned.exitCode === 0 ? containerPinProblems(pinned.stdout, o.pin) : null });
          }
          session.stop();
        },
      };
    },
  };
}

/** One attempt on the Docker rig. */
export const dockerLaunch: Launch = async (o) => {
  const model = MODEL_KEYS[o.entry.model];
  const provider = providerOf(o.policy, model) as ClaudeProvider;
  const none = { gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null, off_pin: [], micros: 0 };
  let binding: Awaited<ReturnType<HostRig["bind"]>>;
  try {
    binding = await o.rig.bind({ cell: { run_id: o.runId, arm: o.entry.arm, task: entryId(o.entry), model, trial: 1, attempt: o.attempt }, models: slotModels(o.policy, model, null), allowance_micros: o.allowanceMicros });
  } catch (e) {
    return { ...none, termination: { kind: "infra", incident: "the proxy refused the slot: " + (e as Error).message } };
  }
  writeFileSync(join(o.dir, "meter.json"), JSON.stringify({ meter_id: binding.meter_id, lease_id: o.rig.recovery?.lease_id ?? null, journal: o.rig.recovery?.journal ?? null }) + "\n");
  const skillArm = isSkillArm(o.entry.arm);
  const base = o.rig.sandbox(o.entry.arm, false, model);
  const home = base.homePath(o.dir);
  const install = o.rig.arms[o.entry.arm]!;
  let found: { contained: string[] | null; pin: string[] | null } = { contained: null, pin: null };
  const sandbox = ohrProbed(base, { docker: o.docker, home, pin: skillArm ? o.pin : null, root: skillArm && install.gstack ? containerRoot(home, install.gstack) : null, onProbe: (p) => (found = p) });
  const skill = skillArm && install.skill ? { name: "office-hours", roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
  const proxy = { baseUrl: o.rig.baseUrl, slot: binding.slot, token: binding.token };
  const envProblems = armEnvProblems(claudeCodeEnv({ model, provider, proxy, disable1mContext: true }));
  const agent = claudeCodeDriver({ model, provider, proxy, skill, out: join(o.dir, "host"), systemPrompt: SYSTEM_PROMPT, maxTurns: AGENT_TURNS_PER_REPLY, capStops: true, disable1mContext: true, denyAsk: true, nextUser: o.nextUser });
  mkdirSync(join(o.dir, "tasks"), { recursive: true });
  let termination: Termination;
  try {
    const repo = workRepo(join(o.dir, "repo"));
    if (skillArm && o.prior) seedPrior(repo, o.entry.arm as "current" | "new", o.prior, o.day);
    const trial = await runTrial({ cell: { model, arm: o.entry.arm, round: 1, trial: 1 }, task: { id: TASK, prompt: o.prompt }, tasksDir: join(o.dir, "tasks"), sandbox, agent, dir: o.dir, timeoutS: SESSION_MINUTES * 60, network: o.rig.network, seed: repo, ...(skillArm ? { copyDir: { from: STATE_ROOT_DIR, to: join(o.dir, "host", "gstack-state") } } : { stateRoot: false as const }) });
    termination = trial.record.termination;
  } catch (e) {
    termination = { kind: "infra", incident: "the trial failed: " + (e as Error).message };
  }
  const meter = await o.rig.finalize(binding.meter_id);
  const path = join(o.dir, "host", "transcript.ndjson");
  const transcript = existsSync(path) ? readFileSync(path, "utf8") : "";
  const read = pvOutcome(termination, transcript).outcome;
  const contained = found.contained === null ? null : [...found.contained, ...envProblems.map((e) => "agent env: " + e)];
  return { termination, gstack_reads: skillArm ? [] : gstackReads(transcript), contained, pin: found.pin, overflow: read.state === "infra" && read.reason === "context overflow", safety: safetyStop(transcript), session_kind: sessionKindOf(transcript), off_pin: offPin(transcript, model), micros: meter.micros };
};

/** An attempt a crash left with a marker and no row: an unknown harness failure at the settled and unknown spend its ledger meter holds, recorded in reconcile.json. */
function reconcile(dir: string, parse: BlockParser, ledger: string | null): AttemptRead {
  const meter = existsSync(join(dir, "meter.json")) ? readFileSync(join(dir, "meter.json"), "utf8") : null;
  const bound = meter ? (JSON.parse(meter) as { meter_id: string; lease_id: string | null }) : null;
  let spent: number | null = null;
  if (bound?.lease_id && ledger && existsSync(ledger)) {
    const local = openLocalLedger({ path: ledger, rule: "the run's local ledger" });
    try {
      const m = local.meters(bound.lease_id).get(bound.meter_id);
      spent = m ? m.spent_micros + m.unknown_micros : null;
    } finally {
      local.close();
    }
  }
  const transcript = join(dir, "host", "transcript.ndjson");
  const lines = existsSync(transcript) ? readFileSync(transcript, "utf8").split("\n").filter(Boolean).length : 0;
  writeFileSync(join(dir, "reconcile.json"), JSON.stringify({ meter, ledger_micros: spent, session_log_lines: lines, reconciled_at: new Date().toISOString() }, null, 2) + "\n");
  const loop = closingLoop({ parse, founder: async () => ({ kind: "call-failed", reason: "provider", detail: "", rejected: [], requests: [] }) }).state;
  return { termination: { kind: "infra", incident: "an unknown outcome, reconciled" }, loop, gstack_reads: [], contained: [], pin: [], overflow: false, safety: null, session_kind: null, off_pin: [], micros: spent ?? 0, sim_micros: 0 };
}

const hostTree = (rig: HostRig, arm: ArmId, pin: Pin): string[] => pinProblems(gstackDir(rig.arms[arm] ?? { gstack: null }), pin);

/** Runs one launch: checks, freezes its manifest, opens the rig, then runs round by round until the schedule ends or a stop. */
export async function runLaunch(o: RunInput, deps: RunDeps): Promise<RunResult> {
  const capped = capProblem(o.launch, o.cap, o.simCap);
  if (capped) throw new Error(capped);
  mkdirSync(o.out, { recursive: true });
  const stopsFile = join(o.out, "stops.json");
  const before = existsSync(stopsFile) ? (JSON.parse(readFileSync(stopsFile, "utf8")) as { stops: RunResult["stops"]; earlier?: RunResult["stops"] }) : null;
  if (before?.stops.some((s) => s.code === "CAP_STOP")) throw new Error("E_OHR_MANIFEST " + o.out + " ended in a cap stop, an incomplete run that is never resumed; its stops.json stands");
  const earlier = [...(before?.earlier ?? []), ...(before?.stops ?? [])];
  const done = readRows(o.out, (torn) => {
    const file = join(o.out, "rows.ndjson");
    appendFileSync(join(o.out, "torn.ndjson"), JSON.stringify({ file, at: torn.at, text: torn.text, dropped_at: new Date().toISOString() }) + "\n");
    writeFileSync(file, readFileSync(file, "utf8").slice(0, torn.at));
    o.log("rows.ndjson: dropped a torn last line of " + torn.text.length + " characters, recorded in torn.ndjson; its session reconciles from its attempt marker");
  });
  const ran = new Set([...done.values()].filter((l) => l.row.stage === 2).map((l) => l.row.brief));
  let manifest;
  try {
    manifest = makeManifest({ launch: o.launch, briefsDir: o.briefsDir, models: o.models, arms: o.arms, pins: o.pins, buildCommit: o.buildCommit, dropped: o.dropped, ran, ...(o.entries ? { entries: o.entries } : {}), ...(o.look ? { look: o.look } : {}) });
  } catch (e) {
    const m = (e as Error).message;
    throw new Error(/^E_[A-Z_]+ /.test(m) ? m : "E_OHR_MANIFEST " + m);
  }
  const nullPin = nullPinProblem(manifest.entries, o.pins);
  if (nullPin) throw new Error(nullPin);
  const meta = new Map(loadBriefs(o.briefsDir).map((b) => [b.id, b]));
  const priors = new Map<string, PriorSession | null>();
  for (const id of Object.keys(manifest.briefs)) {
    const prior = priorOf(o.briefsDir, meta.get(id)!);
    const problem = prior && manifest.entries.some((e) => e.brief === id && isSkillArm(e.arm)) ? priorProblem(prior, o.day) : null;
    if (problem) throw new Error("E_OHR_T8_SEED " + id + ": " + problem);
    priors.set(id, prior);
  }
  const frozen = freezeManifest(join(o.out, "manifest.json"), manifest);
  if ("problem" in frozen) throw new Error("E_OHR_MANIFEST " + frozen.problem);
  const result: RunResult = { manifest_sha256: frozen.sha256, rows: [], stops: [], unrun: [], spent_micros: 0, sim_micros: 0, closed: null };
  const launch = deps.launch ?? dockerLaunch;
  const rig = await deps.openRig();
  if (rig.recovery) writeFileSync(join(o.out, "rig.json"), JSON.stringify(rig.recovery, null, 2) + "\n");
  let halted = false;
  const held = { arms: 0, sim: 0 };
  const fits = (arms: number, sim: number) => result.spent_micros + held.arms + arms <= o.cap && result.sim_micros + held.sim + sim <= o.simCap;
  const hold = (e: ManifestEntry, sign: 1 | -1) => {
    held.arms += sign * armMicros(o.allowances, e);
    held.sim += sign * simMicros(o.allowances);
  };
  try {
    const trees = manifest.arms.filter(isSkillArm).flatMap((a) => (deps.treeProblems ?? hostTree)(rig, a, o.pins[a]!).map((p) => a + ": " + p));
    if (trees.length) throw new Error("E_OHR_PIN_MISMATCH the installed gstack trees are not the pins: " + trees.join("; "));
    const session = async (e: ManifestEntry): Promise<void> => {
      const id = entryId(e);
      if (halted) return hold(e, -1);
      const b = meta.get(e.brief)!;
      const dir = join(o.briefsDir, e.brief);
      const sheet = loadPerson(dir, b.kind);
      const prompt = firstMessage(e.arm, readFileSync(join(dir, "opening.md"), "utf8"));
      const attempts: AttemptRead[] = [];
      const records: RowLine["attempts"] = [];
      let end: Outcome | null = null;
      for (let attempt = 1; attempt <= 2 && !end; attempt++) {
        if (attempt === 2) {
          if (!fits(armMicros(o.allowances, e), simMicros(o.allowances))) {
            halted = true;
            result.stops.push({ code: "CAP_STOP", message: id + ": its retry's allowances (" + usd(armMicros(o.allowances, e)) + " arms, " + usd(simMicros(o.allowances)) + " simulator) do not fit what this launch has left (" + usd(o.cap - result.spent_micros - held.arms) + " and " + usd(o.simCap - result.sim_micros - held.sim) + ")" });
            result.unrun.push({ id, how: "stopped" });
            return;
          }
          hold(e, 1);
        }
        const adir = join(o.out, "sessions", id, "a" + attempt);
        let read: AttemptRead;
        if (existsSync(join(adir, "attempt.json"))) {
          read = reconcile(adir, deps.parse, o.ledger ?? null);
          o.log(id + ": attempt " + attempt + " has a marker and no row; counted as an unknown harness failure");
        } else {
          mkdirSync(adir, { recursive: true });
          writeFileSync(join(adir, "attempt.json"), JSON.stringify({ id, attempt, started_at: new Date().toISOString(), prompt_chars: prompt.length }) + "\n");
          const slot = deps.simSlot(id + "/a" + attempt, simMicros(o.allowances));
          const transcriptPath = join(adir, "host", "transcript.ndjson");
          const loop = closingLoop({ parse: deps.parse, founder: (transcript) => deps.simTurn({ kind: b.kind, sheet, transcript, call: slot.call }), safety: () => (existsSync(transcriptPath) ? safetyStop(readFileSync(transcriptPath, "utf8")) : null) });
          const got = await launch({ rig, policy: o.policy, entry: e, attempt, dir: adir, prompt, nextUser: loop.nextUser, allowanceMicros: armMicros(o.allowances, e), runId: o.runId, docker: o.docker, pin: isSkillArm(e.arm) ? o.pins[e.arm] : null, prior: isSkillArm(e.arm) ? priors.get(e.brief) ?? null : null, day: o.day });
          read = { ...got, loop: loop.state, sim_micros: slot.spent() };
        }
        hold(e, -1);
        result.spent_micros += read.micros;
        result.sim_micros += read.sim_micros;
        attempts.push(read);
        const outcome = settle(attemptOutcome(read, e.arm), attempt);
        records.push({ attempt, outcome: outcome.state, code: "code" in outcome ? outcome.code : null, why: outcome.why, usd: read.micros / D, sim_usd: read.sim_micros / D, contained: read.contained, failed_turn: read.loop.failed_turn });
        if (outcome.state === "cap") {
          halted = true;
          result.stops.push({ code: "CAP_STOP", message: id + ": " + outcome.why });
          result.unrun.push({ id, how: "stopped" });
          return;
        }
        if (outcome.state !== "retry") end = outcome;
        else o.log(id + ": attempt " + attempt + ": " + outcome.why + "; its one retry runs");
      }
      const halt = end!.state === "halt";
      const scored = halt ? { state: "missing" as const, code: (end as { code: ReasonCode }).code } : (end as { state: Exclude<Outcome["state"], "retry" | "cap" | "halt">; code: ReasonCode | null });
      const last = join(o.out, "sessions", id, "a" + attempts.length, "host");
      const logged = join(last, "transcript.ndjson");
      const row = sessionRow({ entry: e, end: scored, attempts, transcript: existsSync(logged) ? logged : null, state_root: isSkillArm(e.arm) ? join(last, "gstack-state") : null });
      const line: RowLine = { id, launch: o.launch, row, why: end!.why, attempts: records };
      appendFileSync(join(o.out, "rows.ndjson"), JSON.stringify(line) + "\n");
      result.rows.push(line);
      o.log(id + ": " + scored.state + (scored.code ? " " + scored.code : "") + " (" + end!.why + "), " + attempts.length + " attempt" + (attempts.length === 1 ? "" : "s") + ", " + usd(row.usd * D) + " arm, " + usd(row.sim_usd * D) + " simulator");
      halted ||= halt;
      if (halt) result.stops.push({ code: (end as { code: ReasonCode }).code, message: id + ": " + end!.why + "; the launch stops for the Captain" });
    };
    const rounds: ManifestEntry[][] = [];
    for (const e of manifest.entries) {
      const prev = rounds.at(-1)?.[0];
      if (prev && prev.brief === e.brief && prev.model === e.model) rounds.at(-1)!.push(e);
      else rounds.push([e]);
    }
    for (let i = 0; i < rounds.length && !halted; i++) {
      const round = rounds[i]!.filter((e) => !done.has(entryId(e)));
      if (!round.length) continue;
      const reserve = roundReserve(o.allowances, round);
      if (!fits(reserve.arms, reserve.sim)) {
        result.stops.push({ code: "CAP_STOP", message: "round " + (i + 1) + "'s reservation, one attempt a session (" + usd(reserve.arms) + " arms, " + usd(reserve.sim) + " simulator), does not fit what this launch may still spend (" + usd(o.cap - result.spent_micros) + " and " + usd(o.simCap - result.sim_micros) + ")" });
        break;
      }
      for (const e of round) hold(e, 1);
      await pool(Math.min(o.parallel, round.length), round.map((e) => () => session(e)));
    }
    const seen = new Set([...done.keys(), ...result.rows.map((r) => r.id), ...result.unrun.map((u) => u.id)]);
    result.unrun.push(...manifest.entries.map(entryId).filter((id) => !seen.has(id)).map((id) => ({ id, how: "unstarted" as const })));
  } finally {
    try {
      result.closed = await rig.close();
    } finally {
      writeFileSync(stopsFile, JSON.stringify({ stops: result.stops, unrun: result.unrun, ...(earlier.length ? { earlier } : {}) }, null, 2) + "\n");
    }
  }
  return result;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's run loop (prereg sections 5, 6, 10, 11, 13 and 14; start rules 1, 5, 6 and 10). It sits
// beside src/trial/review/run.ts, not inside it, and reuses the same parts: the Docker rig (dockerRig), one trial per
// attempt (runTrial) and the Claude Code driver with this eval's options. A launch runs one cell:
// - The manifest (manifest.ts) is frozen to <out>/manifest.json before openRig, the call that opens the item's lease, so
//   no lease exists before the schedule does. A launch on an out dir whose manifest differs is refused there.
// - A round starts only when its worst case fits what the launch may still spend: twice each session's arm allowance on
//   the runs item and twice the simulator's allowance for each simulated session on the simulator item (one retry each).
//   A round that does not fit is a cap stop (CAP_STOP): the launch ends incomplete, nothing is retried, and stops.json
//   lists every session left unrun. So does a ledger cap stop inside a session. A later launch on an out dir whose
//   stops.json holds a cap stop is refused; after any other stop it runs, and stops.json keeps the earlier stops.
// - Stage 2's interim stop (section 11): once the first 24 Opus office-hours sessions in run order whose exposure the
//   scorer reads have ended, exposure under 0.70 stops that arm; its remaining sessions stay unrun (how "interim"), the
//   other arms go on, and stops.json records the read under interim. A resumed launch reads it again from the rows.
// - Each session takes at most two attempts (J1). attemptOutcome reads one attempt under C1 and settle applies the retry
//   rule. An attempt's marker (attempt.json) is written before its launch, so a later launch that finds a marker with no
//   row reconciles that attempt first, against the ledger's meter for it, the proxy journal's lines for it and its
//   session log, writes reconcile.json, and counts it as an infrastructure failure on that attempt.
// - A halt (a provider drift, a containment departure, rejected credentials) writes the session's row as missing and
//   stops the launch for the Captain; a halt or a cap stop lets sessions already running finish and starts no other.
// - dockerLaunch is one attempt on the rig: a proxy slot at the session's allowance, the arm's sandbox wrapped by the
//   containment probe, a fresh work repository, the driver with the claude-code-preset system prompt, 60 agent turns per
//   reply (the pinned CLI counts maxTurns per user message in streaming input, so the SDK's cap is the per-reply cap),
//   CLAUDE_CODE_DISABLE_1M_CONTEXT=1, cap stops, AskUserQuestion denied beside WebSearch and WebFetch, the founder loop
//   as nextUser and GSTACK_SESSION_KIND=interactive on the office-hours arm. None and lens get no state root; the
//   office-hours arm gets a fresh one, copied out to host/gstack-state after the session.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, posix } from "node:path";
import { claudeCodeDriver, type ClaudeProvider, type NextUser } from "../../../src/adapters/claude-code/driver.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros } from "../../../src/runner/pricing/prices.ts";
import { armNamespaces, slotModels, type HostRig } from "../../../src/skill-eval/cli/run-host.ts";
import { providerOf, type LoadedPolicy } from "../../../src/skill-eval/cli/policy.ts";
import { readJournalLines } from "../../../src/trial/review/cost.ts";
import { STATE_ROOT_DIR } from "../../../src/trial/state-root.ts";
import { runTrial } from "../../../src/trial/trial.ts";
import type { Termination } from "../../../src/types.ts";
import { MODELS as METER_MODELS, pool, requestBody, type CallRequest, type CallResult, type Meter } from "../../product-value/meter.ts";
import { pvOutcome, webUses } from "../../product-value/parse.ts";
import { INTERIM, interimStops } from "../read/stage2.ts";
import { AGENT_TURNS_PER_REPLY, MODEL_KEYS, PRE_SMOKE_ALLOWANCE, PRE_SMOKE_SIM_ALLOWANCE, SESSION_MINUTES, SYSTEM_PROMPT } from "../frozen.ts";
import type { ArmId, ManifestEntry, ModelId, Sheet, UnitMeta } from "../types.ts";
import { departures, gstackReads, probed, TASK, workRepo, type Probe } from "./contain.ts";
import { cellEntries, cellProblem, cellRounds, entryId, freezeManifest, loadUnits, type Cell, type Manifest } from "./manifest.ts";
import { readRows, sessionRow, type RowLine } from "./rows.ts";
import { attemptOutcome, firstUserMessage, founderLimit, founderLoop, settle, type AttemptRead, type FounderTurnFn, type Outcome, type PersonSheet, type Repair } from "./session.ts";

/** Session allowances in dollars: per arm and model, and the simulator's per session. The reference takes the none arm's. */
export interface Allowances {
  arm: Readonly<Record<ArmId, Readonly<Record<ModelId, number>>>>;
  sim: number;
}
export const PRE_SMOKE: Allowances = { arm: PRE_SMOKE_ALLOWANCE, sim: PRE_SMOKE_SIM_ALLOWANCE };

const D = 1_000_000;
const armMicros = (a: Allowances, e: ManifestEntry) => Math.round(a.arm[e.kind === "reference" ? "none" : e.arm][e.model] * D);
const simMicros = (a: Allowances, e: ManifestEntry) => (e.kind === "arm" ? Math.round(a.sim * D) : 0);

/** The simulator's metered call for one attempt, refused before sending once its worst case does not fit the allowance. */
export interface SimSlot<C> {
  call: C;
  /** Settled spend so far, in micro-dollars. */
  spent(): number;
}

/** One attempt as dockerLaunch takes it. */
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
}
export type Launch = (o: LaunchInput) => Promise<Omit<AttemptRead, "loop" | "sim_micros">>;

export interface RunInput {
  cell: Cell;
  unitsDir: string;
  out: string;
  runId: string;
  models: readonly ModelId[];
  arms: readonly ArmId[];
  repairs: readonly Repair[];
  allowances: Allowances;
  /** Micro-dollars this launch may spend on the runs item and on the simulator item. */
  cap: number;
  simCap: number;
  /** Sessions of one round at once. */
  parallel: number;
  policy: LoadedPolicy;
  /** The local ledger file, for reconciling an attempt a crash left unknown; null skips the ledger read. */
  ledger: string | null;
  docker: string;
  log: (line: string) => void;
}

export interface RunDeps<C> {
  /** Opens the item's lease and the rig; called only after the manifest is frozen. */
  openRig: () => HostRig | Promise<HostRig>;
  simSlot: (label: string, allowanceMicros: number) => SimSlot<C>;
  founderTurn: FounderTurnFn<PersonSheet, C>;
  /** One attempt; dockerLaunch unless a test stands one in. */
  launch?: Launch;
  /** Exposure on an ended row as the scorer reads it (wire.ts rowExposed); the stage 2 interim stop counts it. */
  exposed: (line: RowLine, meta: UnitMeta) => boolean | null;
}

export interface RunResult {
  manifest_sha256: string;
  rows: RowLine[];
  stops: { code: ReasonCode; message: string }[];
  unrun: { id: string; how: "stopped" | "unstarted" | "interim" }[];
  /** Stage 2's interim read, once the first 24 Opus office-hours sessions in run order with a read exposure have ended. */
  interim: { sessions: number; exposed: number; stop: boolean } | null;
  spent_micros: number;
  sim_micros: number;
  closed: { committed: number; unknown: number; lease_id: string | null } | null;
}

/** The simulator slot over a product-value meter: the proxy's worst-case rule applied to the attempt's own allowance. */
export const meterSlot = (meter: Meter) => (label: string, allowanceMicros: number): SimSlot<(req: CallRequest) => Promise<CallResult>> => {
  let spent = 0;
  return {
    spent: () => spent,
    async call(req) {
      const m = METER_MODELS[req.model];
      const body = requestBody(m, req.prompt, req.maxTokens, req.effort, req);
      const routed = m.provider === "openrouter" ? { ...body, provider: openRouterRouting(chatPrice("openrouter:" + m.id)!) } : body;
      const worst = reservationMicros(priceRequest(m.provider, routed, req.maxTokens));
      if (spent + worst > allowanceMicros) return { text: null, status: 402, micros: 0, cached: false, served_by: null, problem: "E_ALLOWANCE: " + label + ": the session's simulator allowance of $" + (allowanceMicros / D).toFixed(2) + " cannot hold this call's worst case of $" + (worst / D).toFixed(4) + " ($" + (spent / D).toFixed(4) + " already spent)" };
      const r = await meter.call({ ...req, label });
      spent += r.micros ?? worst;
      return r;
    },
  };
};

/** One attempt on the Docker rig. */
export const dockerLaunch: Launch = async (o) => {
  const model = MODEL_KEYS[o.entry.model];
  const provider = providerOf(o.policy, model) as ClaudeProvider;
  const none = { web: 0, gstack_reads: [], contained: [], overflow: false, micros: 0 };
  let binding: Awaited<ReturnType<HostRig["bind"]>>;
  try {
    binding = await o.rig.bind({ cell: { run_id: o.runId, arm: o.entry.arm, task: entryId(o.entry), model, trial: o.entry.pass, attempt: o.attempt }, models: slotModels(o.policy, model, null), allowance_micros: o.allowanceMicros });
  } catch (e) {
    return { ...none, termination: { kind: "infra", incident: "the proxy refused the slot: " + (e as Error).message } };
  }
  writeFileSync(join(o.dir, "meter.json"), JSON.stringify({ meter_id: binding.meter_id, lease_id: o.rig.recovery?.lease_id ?? null, journal: o.rig.recovery?.journal ?? null }) + "\n");
  const oh = o.entry.arm === "office-hours";
  const base = o.rig.sandbox(o.entry.arm, false, model);
  const home = base.homePath(o.dir);
  let found: Probe | null = null;
  const sandbox = probed(base, { docker: o.docker, home, onProbe: (p) => (found = p) });
  const install = o.rig.arms[o.entry.arm]!;
  const skill = oh && install.skill ? { name: "office-hours", roots: install.skill.roots.map((r) => posix.join(home, r)), home, dir: install.skill.dir, namespaces: armNamespaces(install) } : null;
  const agent = claudeCodeDriver({ model, provider, proxy: { baseUrl: o.rig.baseUrl, slot: binding.slot, token: binding.token }, skill, out: join(o.dir, "host"), systemPrompt: SYSTEM_PROMPT, maxTurns: AGENT_TURNS_PER_REPLY, capStops: true, disable1mContext: true, denyAsk: true, nextUser: o.nextUser, ...(oh ? { sessionKind: "interactive" as const } : {}) });
  mkdirSync(join(o.dir, "tasks"), { recursive: true });
  let termination: Termination;
  try {
    const trial = await runTrial({ cell: { model, arm: o.entry.arm, round: 1, trial: o.entry.pass }, task: { id: TASK, prompt: o.prompt }, tasksDir: join(o.dir, "tasks"), sandbox, agent, dir: o.dir, timeoutS: SESSION_MINUTES * 60, network: o.rig.network, seed: workRepo(join(o.dir, "repo")), ...(oh ? { copyDir: { from: STATE_ROOT_DIR, to: join(o.dir, "host", "gstack-state") } } : { stateRoot: false as const }) });
    termination = trial.record.termination;
  } catch (e) {
    termination = { kind: "infra", incident: "the trial failed: " + (e as Error).message };
  }
  const meter = await o.rig.finalize(binding.meter_id);
  let transcript = "";
  try {
    transcript = readFileSync(join(o.dir, "host", "transcript.ndjson"), "utf8");
  } catch {
    transcript = "";
  }
  const read = pvOutcome(termination, transcript).outcome;
  const probe = found as Probe | null;
  return { termination, web: webUses(transcript).length, gstack_reads: oh ? [] : gstackReads(transcript), contained: probe ? departures(probe) : null, overflow: read.state === "infra" && read.reason === "context overflow", micros: meter.micros };
};

/** Reconciles an attempt a crash left with no outcome, against its ledger meter, the proxy journal and its session log. */
function reconcile(dir: string, ledger: string | null): AttemptRead {
  const meter = existsSync(join(dir, "meter.json")) ? (JSON.parse(readFileSync(join(dir, "meter.json"), "utf8")) as { meter_id: string; lease_id: string | null; journal: string | null }) : null;
  const lines = meter?.journal && existsSync(meter.journal) ? readJournalLines(meter.journal).filter((l) => (l as { cell?: { meter_id?: string } }).cell?.meter_id === meter.meter_id || (l as { meter_id?: string }).meter_id === meter.meter_id) : [];
  let spent: number | null = null;
  if (meter?.lease_id && ledger && existsSync(ledger)) {
    const local = openLocalLedger({ path: ledger, rule: "the run's local ledger" });
    try {
      const m = local.meters(meter.lease_id).get(meter.meter_id);
      spent = m ? m.spent_micros + m.unknown_micros : null;
    } finally {
      local.close();
    }
  }
  const log = existsSync(join(dir, "host", "transcript.ndjson")) ? readFileSync(join(dir, "host", "transcript.ndjson"), "utf8").trim().split("\n") : [];
  const record = { meter_id: meter?.meter_id ?? null, lease_id: meter?.lease_id ?? null, journal_lines: lines.length, ledger_micros: spent, session_log_lines: log.length, last_message: log.length ? (JSON.parse(log.at(-1)!) as { type?: string }).type ?? null : null };
  writeFileSync(join(dir, "reconcile.json"), JSON.stringify(record, null, 2) + "\n");
  return { termination: { kind: "infra", incident: "an unknown outcome, reconciled: " + JSON.stringify(record) }, loop: founderLoop(0, async () => ({ kind: "call-failed", reason: "provider", detail: "" })).state, web: 0, gstack_reads: [], contained: [], overflow: false, micros: spent ?? 0, sim_micros: 0 };
}

const usd = (m: number) => "$" + (m / D).toFixed(2);

/** Runs one cell: its sessions as manifest.ts schedules them, kept to the launch's models and arms. */
export async function runCells<C>(o: RunInput, deps: RunDeps<C>): Promise<RunResult> {
  const units = loadUnits(o.unitsDir);
  const problem = cellProblem(o.cell, units);
  if (problem) throw new Error("E_USAGE " + problem);
  return runSchedule({ ...o, entries: cellEntries(o.cell, units).filter((e) => o.models.includes(e.model) && o.arms.includes(e.arm)) }, deps);
}

/** Freezes the schedule's manifest, opens the rig, then runs round by round until the schedule ends or a stop. e2e.ts hands it a fixture schedule. */
export async function runSchedule<C>(o: RunInput & { entries: ManifestEntry[] }, deps: RunDeps<C>): Promise<RunResult> {
  const entries = o.entries;
  const meta = new Map<string, UnitMeta>(loadUnits(o.unitsDir).map((u) => [u.id, u]));
  const manifest: Manifest = { schema: 1, cell: o.cell, models: [...o.models], arms: [...o.arms], repairs: [...o.repairs], units: Object.fromEntries([...new Set(entries.map((e) => e.unit))].sort().map((id) => [id, meta.get(id)!.digest])), entries };
  mkdirSync(o.out, { recursive: true });
  const stopsFile = join(o.out, "stops.json");
  const before = existsSync(stopsFile) ? (JSON.parse(readFileSync(stopsFile, "utf8")) as { stops: RunResult["stops"]; earlier?: RunResult["stops"] }) : null;
  if (before?.stops.some((s) => s.code === "CAP_STOP")) throw new Error("E_USAGE " + o.out + " ended in a cap stop, an incomplete run that is never resumed; its stops.json stands");
  const earlier = [...(before?.earlier ?? []), ...(before?.stops ?? [])];
  const frozen = freezeManifest(join(o.out, "manifest.json"), manifest);
  if ("problem" in frozen) throw new Error("E_USAGE " + frozen.problem);
  const done = readRows(o.out);
  const result: RunResult = { manifest_sha256: frozen.sha256, rows: [], stops: [], unrun: [], interim: null, spent_micros: 0, sim_micros: 0, closed: null };
  const interimIds = o.cell === "stage2" ? cellRounds(o.cell, entries).flat().filter((e) => e.model === "opus" && e.arm === "office-hours").map(entryId) : [];
  const exposedBy = new Map<string, boolean | null>();
  const readInterim = () => {
    if (result.interim) return;
    let sessions = 0;
    let exposed = 0;
    for (const id of interimIds) {
      if (sessions === INTERIM.sessions) break;
      if (!exposedBy.has(id)) return;
      const x = exposedBy.get(id);
      if (x === null) continue;
      sessions++;
      if (x) exposed++;
    }
    if (sessions < INTERIM.sessions) return;
    result.interim = { sessions, exposed, stop: interimStops(exposed / sessions) };
    o.log("interim: " + exposed + " of the first " + sessions + " Opus office-hours sessions exposed" + (result.interim.stop ? ", under 0.70, so the arm stops and its remaining sessions stay unrun" : ", so the arm goes on"));
  };
  const counted = (line: RowLine) => {
    if (!interimIds.includes(line.id)) return;
    exposedBy.set(line.id, deps.exposed(line, meta.get(line.row.unit)!));
    readInterim();
  };
  for (const line of done.values()) counted(line);
  const interimSkip = (e: ManifestEntry) => result.interim?.stop === true && e.model === "opus" && e.arm === "office-hours";
  const launch = deps.launch ?? dockerLaunch;
  const rig = await deps.openRig();
  if (rig.recovery) writeFileSync(join(o.out, "rig.json"), JSON.stringify(rig.recovery, null, 2) + "\n");
  let halted = false;
  const session = async (e: ManifestEntry): Promise<void> => {
    const id = entryId(e);
    if (halted) return;
    if (interimSkip(e)) {
      result.unrun.push({ id, how: "interim" });
      return;
    }
    const unitDir = join(o.unitsDir, e.unit);
    const opening = readFileSync(join(unitDir, "opening.md"), "utf8");
    const sheet = JSON.parse(readFileSync(join(unitDir, "sheet.json"), "utf8")) as Sheet;
    const prompt = firstUserMessage(e, opening, sheet, o.repairs);
    const attempts: AttemptRead[] = [];
    const records: RowLine["attempts"] = [];
    let end: Outcome | null = null;
    for (let attempt = 1; attempt <= 2 && !end; attempt++) {
      const dir = join(o.out, "sessions", id, "a" + attempt);
      let read: AttemptRead;
      if (existsSync(join(dir, "attempt.json"))) {
        read = reconcile(dir, o.ledger);
        o.log(id + ": attempt " + attempt + " has a marker and no row; reconciled it as an unknown outcome");
      } else {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "attempt.json"), JSON.stringify({ id, attempt, started_at: new Date().toISOString(), prompt_chars: prompt.length }) + "\n");
        const slot = deps.simSlot(id + "/a" + attempt, simMicros(o.allowances, e));
        const loop = founderLoop(founderLimit(e.kind, o.repairs), (transcript) => deps.founderTurn({ sheet: { ...sheet, opening }, transcript, call: slot.call }));
        const got = await launch({ rig, policy: o.policy, entry: e, attempt, dir, prompt, nextUser: loop.nextUser, allowanceMicros: armMicros(o.allowances, e), runId: o.runId, docker: o.docker });
        read = { ...got, loop: loop.state, sim_micros: slot.spent() };
      }
      result.spent_micros += read.micros;
      result.sim_micros += read.sim_micros;
      attempts.push(read);
      const outcome = settle(attemptOutcome(read, e.arm), attempt);
      records.push({ attempt, outcome: outcome.state, why: outcome.why, usd: read.micros / D, sim_usd: read.sim_micros / D, contained: read.contained });
      if (outcome.state === "cap") {
        halted = true;
        result.stops.push({ code: "CAP_STOP", message: id + ": " + outcome.why });
        result.unrun.push({ id, how: "stopped" });
        return;
      }
      if (outcome.state !== "retry") end = outcome;
      else o.log(id + ": attempt " + attempt + ": " + outcome.why + "; its one retry runs under that reason");
    }
    const halt = end!.state === "halt";
    const scored = halt ? { state: "missing" as const, code: (end as { code: ReasonCode }).code } : (end as { state: Exclude<Outcome["state"], "retry" | "cap" | "halt">; code: ReasonCode | null });
    const oh = e.arm === "office-hours";
    const last = join(o.out, "sessions", id, "a" + attempts.length, "host");
    const line: RowLine = { id, cell: o.cell, row: sessionRow({ entry: e, end: scored, attempts, repairs: o.repairs }), why: end!.why, transcript: join(last, "transcript.ndjson"), state_root: oh ? join(last, "gstack-state") : null, attempts: records };
    appendFileSync(join(o.out, "rows.ndjson"), JSON.stringify(line) + "\n");
    result.rows.push(line);
    counted(line);
    o.log(id + ": " + scored.state + (scored.code ? " " + scored.code : "") + " (" + end!.why + "), " + attempts.length + " attempt" + (attempts.length === 1 ? "" : "s") + ", " + usd(line.row.usd * D) + " arm, " + usd(line.row.sim_usd * D) + " simulator");
    halted ||= halt;
    if (halt) result.stops.push({ code: (end as { code: ReasonCode }).code, message: id + ": " + end!.why + "; the launch stops for the Captain" });
  };
  try {
    const rounds = cellRounds(o.cell, entries).map((r) => r.filter((e) => !done.has(entryId(e))));
    for (let i = 0; i < rounds.length && !halted; i++) {
      result.unrun.push(...rounds[i]!.filter(interimSkip).map((e) => ({ id: entryId(e), how: "interim" as const })));
      const round = rounds[i]!.filter((e) => !interimSkip(e));
      if (!round.length) continue;
      const worst = round.reduce((s, e) => s + 2 * armMicros(o.allowances, e), 0);
      const simWorst = round.reduce((s, e) => s + 2 * simMicros(o.allowances, e), 0);
      if (result.spent_micros + worst > o.cap || result.sim_micros + simWorst > o.simCap) {
        result.stops.push({ code: "CAP_STOP", message: "round " + (i + 1) + "'s worst case (" + usd(worst) + " runs, " + usd(simWorst) + " simulator) does not fit what this launch may still spend (" + usd(o.cap - result.spent_micros) + " and " + usd(o.simCap - result.sim_micros) + ")" });
        break;
      }
      await pool(o.parallel, round.map((e) => () => session(e)));
    }
    const ran = new Set([...done.keys(), ...result.rows.map((r) => r.id), ...result.unrun.map((u) => u.id)]);
    result.unrun.push(...entries.map(entryId).filter((id) => !ran.has(id)).map((id) => ({ id, how: "unstarted" as const })));
  } finally {
    result.closed = await rig.close();
    writeFileSync(stopsFile, JSON.stringify({ stops: result.stops, unrun: result.unrun, ...(earlier.length ? { earlier } : {}), ...(o.cell === "stage2" ? { interim: result.interim } : {}) }, null, 2) + "\n");
  }
  return result;
}

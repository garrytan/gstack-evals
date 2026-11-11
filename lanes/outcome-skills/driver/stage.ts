// The outcome-skills session driver (GST-1381, plan wiki/plans/2026-11-04-geva-286-u4-session-driver): one U4 lease per
// stage at its line item's cap (G prereg section 9), one metering-proxy slot per session, and a control plane on
// 127.0.0.1 that real_agent's U4 mode opens and closes sessions on. Every lease is admitted by O6's envelope through
// openLease, and every exit path settles every lease it opened. Each lease names its holder, the run directory and the
// launch's nonce, and a run binds to the directory of its first lease, so that directory's sessions.jsonl holds the run's
// trial counts. The ledger is the only trust root: a cap stop is written into O6's record when it fires, before the 409
// that reports it, after which O6 admits no new lease on that item, and a launch whose sessions.jsonl does not name every
// launch and session meter the ledger holds for the run is refused. A family SM close whose proxy finalize failed halts
// its item the same way through sessions.jsonl (a halt line with the session and its journal, on disk before the close)
// until a launch lifts it, and so does a family SM session the driver never closed itself: one its crash recovery
// closes, or one ledger settle or reconcile closed.
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { docAnchor, type ReasonCode } from "../../../src/errors/codes.ts";
import { rigAdmission } from "../../../src/rig/admission.ts";
import { envelopeStatus, split } from "../../../src/runner/ledger/envelope.ts";
import { ledgerStatus, machineId, MAX_LEASE_TTL_MS, openLease, recordedStop, recordStop, rivalHolder, settleLease, type RequireAdmission } from "../../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { usd } from "../../../src/runner/ledger/money.ts";
import { holderBound, LedgerError, listItems, readItem, type CloseFile, type Holder, type LeaseFile } from "../../../src/runner/ledger/record.ts";
import { closeOpenSessions, cutShort, meterFigures } from "../../../src/runner/ledger/sessions.ts";
import { isTrialNetworkHost, MeteringProxy, reconcileJournal, type RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";
import { loadRegistry, type Registry } from "../arms/registry.ts";
import { isSmArm, smArm, smLimits, smProvider } from "../statemachines/arms.ts";
import { ITEMS } from "../statemachines/items.ts";
import { sessionLimits, type PfArm } from "../pfchecks/arms.ts";
import { ALLOWANCE, ITEMS as PF_ITEMS, MODEL_ITEM, MODELS, type Arm } from "../pfchecks/items.ts";
import { PfError } from "../pfchecks/prereg.ts";
import { EFFORT_KEYS, reservationBound } from "../pfchecks/session.ts";

export const DEFAULT_TTL_MS = 72 * 3_600_000;
export const DEADLINE_GRACE_MS = 120_000;
export const DEFAULT_RETRY: RetryBudget = { attempts: 3, elapsed_ms: 300_000 };

/** The pstack-checks (PF) items a PF stage may name: the models each pays for and the PF arms its sessions may name.
 *  pf-admit runs Opus's told admission sessions and the Sol and particle-1 price probe, so it serves all three models. */
const PF_TOLD = ["pf:P", "pf:C", "pf:N"];
export const PF_STAGES: Record<string, { models: readonly string[]; arms: string[] }> = {
  "pf-admit": { models: MODELS, arms: PF_TOLD },
  ...Object.fromEntries(Object.entries(MODEL_ITEM).map(([model, item]) => [item, { models: [model], arms: PF_TOLD }])),
  "pf-blind": { models: [PF_ITEMS["pf-blind"]!.model!], arms: ["pf:blind"] },
};

export interface StageSpec {
  item: string;
  arm: string;
  /** Family SM only: the model the stage's item pays for, and every SM arm its sessions may name (arm is the stage's label then). Its proxy refuses provider-side tools. */
  model?: string;
  /** Family SM's arms, or a PF stage's: pf:P, pf:C, pf:N on a told PF item, pf:blind on pf-blind. A PF stage takes its models from PF_STAGES, and its proxy refuses provider-side tools and records each slot's first main request's effort fields. */
  arms?: string[];
}

export interface ServeOptions {
  record: string;
  local: LocalLedger;
  run_id: string;
  /** The program's envelope host; the driver refuses to run on any other machine. */
  envelope_host: string;
  stages: StageSpec[];
  /** The trial-network address the proxies listen on: a loopback or private IP. */
  host: string;
  dir: string;
  planned?: number;
  reruns?: number;
  control_port?: number;
  ttl_ms?: number;
  /** Added to an arm's wall limit for a slot's deadline; 120 s by default. */
  deadline_grace_ms?: number;
  /** PF stages' task-turn allowance table: items.ts ALLOWANCE by default, or admission.ts costReading's doubled one. */
  pf_allowance?: Record<Arm, Record<string, number>>;
  retry?: RetryBudget;
  registry?: Registry;
  env?: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  requireAdmission?: RequireAdmission;
  /** Family SM: sessions whose finalize halt (E_SM_FINALIZE_HALT) the Captain ruled on after reading the proxy journal. Each must name a halt in this run; the launch records the lift and serves the item again. */
  lift_halts?: string[];
  machine?: string;
  now?: () => number;
  /** Receives every notice line, code first. */
  log?: (line: string) => void;
}

export type Ended = "completed" | "cap_stop" | "lease_expired" | "failed" | "halted";

export interface OpenAnswer {
  id: string;
  token: string;
  base_url: string;
  ledger: "u4";
  item: string;
  lease_id: string;
  meter_id: string;
  allowance_micros: number;
}

export interface CloseAnswer {
  id: string;
  reason: string;
  lease_id: string;
  meter_id: string;
  /** The session's settled spend: its calls with a recorded cost. */
  spent_micros: number;
  /** The full reservations O6 still holds for the session's calls with no recorded cost, unknown or undrained; spent_micros leaves them out. */
  unknown_micros: number;
  /** How many of the session's calls had no recorded cost at the close: the calls unknown_micros holds for. */
  unknown_calls: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** False when the proxy's finalize failed: then the proxy's counts below are null, not 0, and the session ends as infra. */
  finalized: boolean;
  requests: number | null;
  ok_responses: number | null;
  refused: number | null;
  /** The distinct reason codes of the proxy's refusals (E_ALLOWANCE, E_PROXY_SERVER_TOOL and so on), so a session's end kind can tell an allowance stop. */
  refusals: string[] | null;
  /** Refusals at the slot's allowance check, the proxy's only allowance stop; the end kind reads this, never the E_ALLOWANCE code. */
  allowance_stops: number | null;
  /** PF sessions only: the effort and thinking fields (pfchecks session.ts EFFORT_KEYS) of the slot's first request with a tools list, as its metering proxy recorded them, or null when it sent none. */
  first_request?: Record<string, unknown> | null;
  /** PF sessions only: the slot's allowance stops that only its calls still in flight caused (pfchecks session.ts reservationBound). */
  reservation_bound?: number;
  unknown: number | null;
  undrained: number | null;
  unsettled: number | null;
}

/** A PF close answer's journal reads: every refusal code on the slot's meter, and its reservation-bound allowance stops. */
function pfClose(journal: string, meterId: string, allowance: number, first: Record<string, unknown> | null): Pick<CloseAnswer, "refusals" | "first_request" | "reservation_bound"> {
  const lines = (existsSync(journal) ? readFileSync(journal, "utf8").split("\n") : []).flatMap((l) => { try { return [JSON.parse(l) as Record<string, any>]; } catch { return []; } });
  return { refusals: lines.filter((j) => j.kind === "refusal" && j.meter_id === meterId).map((j) => String(j.code)), first_request: first, reservation_bound: reservationBound(lines, meterId, allowance) };
}

interface Session {
  id: string;
  stage: Stage;
  slot: string;
  meter_id: string;
  allowance: number;
  answer: OpenAnswer;
  timer: ReturnType<typeof setTimeout>;
  closing: Promise<CloseAnswer> | null;
  closed: CloseAnswer | null;
  /** PF only: the session's arm|model|task|trial key, so its close starts the grace on its wrap-up hold. */
  key?: string;
}

interface Stage {
  item: string;
  arm: string;
  kind: "none" | "told" | "prompt" | "followon";
  /** The arms its sessions may name: [arm] for G; the stage's SM arms for family SM, with its model. */
  arms: string[];
  model?: string;
  /** PF stages only: the models the item pays for. */
  models?: readonly string[];
  pf: boolean;
  lease_id: string;
  reserved: number;
  expires: number;
  proxy: MeteringProxy;
  journal: string;
  state: "serving" | "draining" | "stopped";
  ended: Ended | null;
  /** Set when a close's proxy finalize failed and halted the stage, even on a stage that keeps ended cap_stop. */
  halted: boolean;
  scope: string | null;
  live: Map<string, Session>;
  opens: number;
  reruns: number;
  finished: number;
  settling: Promise<void> | null;
  close: CloseFile | null;
}

export interface Served {
  control: string;
  stages: Array<{ item: string; arm: string; lease_id: string; reserved_micros: number; proxy: string }>;
  /** Resolves with the exit code once every stage is settled: 0, or 2 when the driver failed, a lease is still open, a stage ended failed or a close halted a stage. */
  done: Promise<number>;
  stop(ended?: Ended): Promise<number>;
}

const fail = (code: ReasonCode, message: string): never => {
  throw new LedgerError(code, message);
};

/** A refusal as problem-details JSON, code first, like the metering proxy's. */
export function refusal(code: ReasonCode, status: number, detail: string, extra: Record<string, unknown> = {}): Response {
  const body = { type: "https://github.com/garrytan/gstack-evals/blob/main/" + docAnchor(code), title: code, status, code, detail: code + ": outcome driver: " + detail, ...extra };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/problem+json" } });
}

const urlHost = (host: string) => (host.includes(":") ? "[" + host + "]" : host);
const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v);

/** One live driver per run directory, so recovery never settles a lease a live driver still meters. A lock whose process is gone is taken over. */
function takeLock(file: string): string {
  try {
    writeFileSync(file, String(process.pid), { flag: "wx" });
    return file;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const pid = Number(readFileSync(file, "utf8"));
  let alive = false;
  if (Number.isSafeInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (e) {
      alive = (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }
  if (alive) fail("E_USAGE", "driver process " + pid + " still serves this run directory (" + file + "); stop it with POST /stop or SIGTERM before launching another, so its leases are not settled under it; nothing was recovered or opened");
  writeFileSync(file, String(process.pid));
  return file;
}

/**
 * Refuses a run bound to another run directory, recovers the open leases an earlier launch from this run directory left
 * on this machine, preflights every stage, opens one lease and one proxy per stage, then serves. A lease that names no
 * holder, such as the program's T-G or VM lease on the same run, is never touched.
 */
/**
 * One live driver per run on the envelope host, so two run directories never bind one run at the same moment: an
 * exclusive SQLite lock in a file beside the record, which the operating system lets go when the process ends.
 */
function holdRunLock(record: string, run_id: string): Database {
  const file = join(dirname(record), "." + basename(record) + ".run-" + createHash("sha256").update(run_id).digest("hex").slice(0, 16) + ".lock.db");
  const db = new Database(file, { create: true });
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch (error) {
    db.close();
    return fail("E_USAGE", "another driver still serves run " + run_id + " on this host (" + file + ": " + (error as Error).message + "); stop it with POST /stop or SIGTERM before launching another; nothing was recovered or opened");
  }
}

export async function serveStages(o: ServeOptions): Promise<Served> {
  const held = { lock: null as string | null, run: null as Database | null };
  try {
    return await serve(o, held);
  } catch (error) {
    if (held.lock) rmSync(held.lock, { force: true });
    held.run?.close();
    throw error;
  }
}

async function serve(o: ServeOptions, held: { lock: string | null; run: Database | null }): Promise<Served> {
  const log = o.log ?? ((line: string) => console.error(line));
  const warn = (code: ReasonCode, message: string) => log(code + " " + message);
  const now = o.now ?? Date.now;
  const machine = o.machine ?? machineId();
  if (machine !== o.envelope_host) fail("E_USAGE", "this machine is " + machine + ", not the envelope host " + o.envelope_host + "; the driver writes envelope entries, which have one winner only on the envelope host's own disk, so run it there");
  const reg = o.registry ?? loadRegistry();
  const planned = o.planned ?? 24;
  const reruns = o.reruns ?? 2;
  const ttl = o.ttl_ms ?? DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(planned) || planned < 1 || !Number.isSafeInteger(reruns) || reruns < 0) fail("E_USAGE", "planned sessions must be at least 1 and reruns at least 0, as whole numbers");
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > MAX_LEASE_TTL_MS) fail("E_USAGE", "the lease time to live must be a whole number of milliseconds from 1 to " + MAX_LEASE_TTL_MS + " (7 days), not " + ttl);
  if (o.control_port !== undefined && !(Number.isSafeInteger(o.control_port) && o.control_port >= 0 && o.control_port <= 65535)) fail("E_USAGE", "the control port must be a whole number from 0 to 65535, not " + o.control_port);
  if (!isTrialNetworkHost(o.host)) fail("E_USAGE", "--host " + o.host + " is not a loopback or private IP literal, which the metering proxies listen on; nothing was opened");
  try {
    Bun.listen({ hostname: o.host, port: 0, socket: { data() {} } }).stop(true);
  } catch (e) {
    fail("E_USAGE", "can't listen on --host " + o.host + " (" + (e as Error).message + "); give an address on this machine; nothing was opened");
  }
  if (!o.stages.length) fail("E_USAGE", "name at least one --stage <item>=<arm>");
  const pfStage = (st: StageSpec) => [st.arm, ...(st.arms ?? [])].some((a) => a.startsWith("pf:"));
  const smStage = (st: StageSpec) => !pfStage(st) && (st.model !== undefined || st.arms !== undefined);
  const pfAllowance = o.pf_allowance ?? ALLOWANCE;
  for (const st of o.stages) {
    if (pfStage(st)) {
      const arms = st.arms ?? [st.arm];
      if (arms.some((a) => !a.startsWith("pf:"))) fail("E_USAGE", "stage " + st.item + " mixes PF arms with G or SM arms; a PF stage serves PF arms only");
      const pf = Object.hasOwn(PF_STAGES, st.item) ? PF_STAGES[st.item]! : fail("E_USAGE", "PF stage " + st.item + " is not a PF item; PF stages are " + Object.keys(PF_STAGES).join(", "));
      if (st.model !== undefined) fail("E_USAGE", "PF stage " + st.item + " takes its models from its item (" + pf.models.join(", ") + "), not a stage model");
      const stray = arms.filter((a) => !pf.arms.includes(a));
      if (!arms.length || stray.length) fail("E_USAGE", "PF stage " + st.item + " serves " + pf.arms.join(", ") + ", not " + (stray.join(", ") || "no arm"));
      for (const a of arms) {
        for (const model of pf.models) {
          smProvider(reg, model);
          try {
            sessionLimits(a.slice(3) as PfArm, model, pfAllowance);
          } catch (e) {
            fail("E_USAGE", "PF stage " + st.item + ": " + (e instanceof PfError ? e.message : String(e)));
          }
        }
      }
      continue;
    }
    if (!smStage(st)) {
      if (!Object.hasOwn(reg.arms, st.arm)) fail("E_USAGE", "stage " + st.item + " names arm " + st.arm + ", which the registry does not hold; it holds " + Object.keys(reg.arms).join(", "));
      continue;
    }
    if (!st.model || !st.arms?.length || st.arms.some((a) => !isSmArm(reg, a)) || new Set(st.arms.map((a) => smArm(reg, a).kind === "told")).size !== 1) fail("E_USAGE", "SM stage " + st.item + " needs a model and a list of family SM arms, all told or none told");
    smProvider(reg, st.model!);
    const def = ITEMS[st.item];
    if (def?.model !== st.model) fail("E_USAGE", "SM stage " + st.item + " pays for model " + st.model + ", but " + (def ? "line item " + st.item + " pays for " + (def.model ?? "no model's sessions") : st.item + " is not one of family SM's line items (" + Object.keys(ITEMS).join(", ") + ")") + "; nothing was opened");
  }
  const servedBy = o.stages.flatMap((s) => (pfStage(s) ? (s.arms ?? [s.arm]).flatMap((a) => PF_STAGES[s.item]!.models.map((m) => a + "@" + m)) : smStage(s) ? s.arms!.map((a) => a + "@" + s.model) : [s.arm]));
  if (new Set(o.stages.map((s) => s.item)).size !== o.stages.length || new Set(servedBy).size !== servedBy.length) fail("E_USAGE", "each stage needs its own line item and its own arm, since a session's arm picks its stage");
  mkdirSync(o.dir, { recursive: true });
  const dir = realpathSync(o.dir);
  if (!existsSync(o.record)) fail("E_LEDGER_MISSING", "no approval record is at " + o.record + "; nothing was opened");
  held.run = holdRunLock(realpathSync(o.record), o.run_id);
  held.lock = takeLock(join(dir, "driver.lock"));
  const holder: Holder = { dir, nonce: randomBytes(8).toString("hex") };
  const rival = rivalHolder(o.record, o.run_id, dir);
  if (rival) fail("E_USAGE", holderBound(rival, holder).message + "; nothing was recovered, settled or opened");
  const sessionsFile = join(dir, "sessions.jsonl");
  const record = (line: Record<string, unknown>, durable = false) => {
    const fresh = existsSync(sessionsFile) && cutShort(sessionsFile) ? "\n" : "";
    appendFileSync(sessionsFile, fresh + JSON.stringify({ at: new Date(now()).toISOString(), run_id: o.run_id, ...line }) + "\n");
    if (!durable) return;
    const fd = openSync(sessionsFile, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  const lines: Array<{ at?: string; event?: string; id?: string; item?: string; lease_id?: string; ended?: string; code?: string; scope?: string | null; nonce?: string; meter_id?: string; journal?: string; model?: string; reason?: string; finalized?: boolean; cause?: string }> = [];
  for (const line of existsSync(sessionsFile) ? readFileSync(sessionsFile, "utf8").split("\n") : []) {
    try {
      const e = JSON.parse(line);
      if (e?.run_id === o.run_id) lines.push(e);
    } catch {}
  }
  const launches = new Set(lines.flatMap((e) => (e.event === "launch" && e.nonce ? [e.nonce] : [])));
  const meters = new Set(lines.flatMap((e) => (e.event === "open" && e.meter_id ? [e.meter_id] : [])));
  const states = listItems(o.record).map((item) => readItem(o.record, item));
  const bound = states.flatMap((s) => s.leases.filter(({ lease }) => lease.run_id === o.run_id && lease.holder?.dir === dir));
  const unaccounted = bound.flatMap(({ lease }) => (launches.has(lease.holder!.nonce) ? [...o.local.meters(lease.lease_id).keys()].filter((m) => !meters.has(m)).map((m) => lease.lease_id + " (session meter " + m + ")") : [lease.lease_id + " (launch " + lease.holder!.nonce + ")"]));
  if (unaccounted.length) fail("E_USAGE", sessionsFile + " does not account for run " + o.run_id + "'s ledger: it names no launch or session for " + unaccounted.join(", ") + ". The ledger is the run's record, so a sessions.jsonl that is missing, emptied or restored from an earlier point can't serve the run; nothing was recovered, settled or opened");
  const capped = new Map<string, { at: string; scope: string }>();
  const noteStop = (item: string, stop: { at: string; scope: string }) => {
    if (!capped.has(item)) capped.set(item, stop);
    if (stop.scope.startsWith("all") && !capped.has("")) capped.set("", stop);
  };
  for (const s of states) {
    for (const stop of s.stops) if (stop.run_id === o.run_id) noteStop(s.item, { at: stop.at, scope: stop.scope });
    for (const { lease, close } of s.leases) if (close?.cap_stop && lease.run_id === o.run_id) noteStop(s.item, { at: close.closed_at, scope: close.cap_stop });
  }
  for (const s of states) {
    for (const { lease, close } of s.leases) {
      const scope = lease.run_id === o.run_id ? o.local.stagedStop(lease.lease_id) : undefined;
      if (!scope) continue;
      if (close && recordedStop(o.record, lease.lease_id) === undefined) recordStop(o.record, lease.lease_id, scope, new Date(now()));
      noteStop(s.item, { at: "an unrecorded time (a stop staged in the local ledger " + o.local.path + ")", scope });
    }
  }
  for (const e of lines) if (e.item && (e.event === "stop" || (e.event === "settled" && e.ended === "cap_stop") || (e.event === "refuse" && e.code === "CAP_STOP"))) noteStop(e.item, { at: e.at ?? "an unrecorded time", scope: e.scope ?? "" });
  const halts = new Map<string, { item: string; at: string; journal: string; cause?: string }>();
  for (const e of lines) {
    if (e.event === "halt" && e.id && e.item) halts.set(e.id, { item: e.item, at: e.at ?? "an unrecorded time", journal: e.journal ?? "(no journal path)", ...(e.cause ? { cause: e.cause } : {}) });
    if (e.event === "lift" && e.id) halts.delete(e.id);
  }
  const lifts = [...new Set(o.lift_halts ?? [])];
  const unknownLift = lifts.find((id) => !halts.has(id));
  if (unknownLift) fail("E_USAGE", "--lift-halt " + unknownLift + " names no halt still standing in run " + o.run_id + "'s " + sessionsFile + "; nothing was recovered or opened");
  const smOpens = new Map(lines.flatMap((e) => (e.event === "open" && e.id && e.model !== undefined ? [[e.id, e] as const] : [])));
  const closedIds = new Set(lines.flatMap((e) => (e.event === "close" && e.id ? [e.id] : [])));
  const haltedIds = new Set(lines.flatMap((e) => (e.event === "halt" && e.id ? [e.id] : [])));
  const haltUnfinalized = (e: { id?: string; item?: string; lease_id?: string; meter_id?: string }, cause: string) => {
    const halt = { item: e.item!, at: new Date(now()).toISOString(), journal: join(dir, e.lease_id + ".journal.ndjson"), cause };
    record({ event: "halt", item: halt.item, id: e.id, lease_id: e.lease_id, meter_id: e.meter_id, journal: halt.journal, cause }, true);
    halts.set(e.id!, halt);
    haltedIds.add(e.id!);
    log("E_SM_FINALIZE_HALT outcome driver: session " + e.id + " on line item " + halt.item + " was closed as " + cause + ", never by the driver's own close, so its proxy finalize never ran and its allowance stops are unknown; the item opens no more sessions or leases until the Captain rules on the proxy journal " + halt.journal + " and a relaunch lifts the halt with --lift-halt " + e.id);
  };
  for (const e of lines) if (e.event === "close" && e.id && smOpens.has(e.id) && e.finalized !== true && !haltedIds.has(e.id)) haltUnfinalized(smOpens.get(e.id)!, e.reason ?? "unknown");

  const failures: string[] = [];
  for (const item of listItems(o.record)) {
    const lease = readItem(o.record, item).open;
    if (!lease || lease.run_id !== o.run_id || lease.holder?.dir !== dir || lease.machine_id !== machine) continue;
    try {
      const journal = join(dir, lease.lease_id + ".journal.ndjson");
      if (existsSync(journal)) {
        const rec = await reconcileJournal(journal, o.local);
        for (const r of rec.refused) warn(r.code as ReasonCode, "recovering lease " + lease.lease_id + ": " + r.message);
      } else warn("JOURNAL_MISSING", "lease " + lease.lease_id + " on line item " + item + " has no proxy journal at " + journal + ", so its settle charges every unanswered call at its full reservation");
      for (const [id, e] of smOpens) if (e.lease_id === lease.lease_id && !closedIds.has(id) && !haltedIds.has(id)) haltUnfinalized(e, "recovered");
      closeOpenSessions(lease, "recovered", meterFigures(o.local, lease.lease_id), new Date(now()));
      const stop = capped.get("") ?? capped.get(item);
      const close = settleLease(o.record, o.local, lease.lease_id, warn, stop ? stop.scope || "cap_stop" : undefined);
      log("STAGE_RECOVERED item=" + item + " lease=" + lease.lease_id + " spent=" + usd(close.spent_micros) + " unknown=" + usd(close.unknown_micros) + " unknown_calls=" + close.unknown_calls);
    } catch (error) {
      failures.push(lease.lease_id + " (" + (error as Error).message + ")");
    }
  }
  if (failures.length) fail("E_LEASE_UNSETTLED", "recovery could not settle " + failures.join("; ") + "; nothing new was opened. Settle each with gstack-evals ledger settle --lease <id> on this machine, then launch the driver again");

  for (const id of lifts) {
    record({ event: "lift", id, item: halts.get(id)!.item });
    halts.delete(id);
  }
  const at = new Date(now());
  const plans = o.stages.map((st) => {
    const s = readItem(o.record, st.item);
    const unheld = s.leases.filter((l) => l.lease.run_id === o.run_id && l.lease.holder?.dir !== dir).map((l) => l.lease);
    if (unheld.length) fail("E_USAGE", "line item " + st.item + " holds run " + o.run_id + "'s leases " + unheld.map((l) => l.lease_id).join(", ") + ", which name no holder, so no run directory's sessions.jsonl counts their sessions and the driver can't serve the item for this run; nothing was opened");
    const stop = capped.get("") ?? capped.get(st.item);
    if (stop) fail("CAP_STOP", (capped.has("") ? "the none stage cap-stopped in run " + o.run_id + " at " + stop.at + " (scope " + stop.scope + "), which ends both skills incomplete" : "stage " + st.item + " cap-stopped in run " + o.run_id + " at " + stop.at + " (scope " + stop.scope + "), which ends its skill incomplete") + "; a cap stop is not retried (plan section 6); nothing was opened");
    const halt = [...halts].find(([, h]) => h.item === st.item);
    if (halt) fail("E_SM_FINALIZE_HALT", "line item " + st.item + " halted in run " + o.run_id + " at " + halt[1].at + ": session " + halt[0] + (halt[1].cause ? " was closed as " + halt[1].cause + ", never by the driver's own close, so its proxy finalize never ran" : " closed with its proxy finalize failed") + ", so its allowance stops are unknown and its retry waits for the Captain's ruling on the proxy journal " + halt[1].journal + "; once the Captain rules, relaunch with --lift-halt " + halt[0] + "; nothing was opened");
    if (s.cap_micros === null) return fail("E_LEDGER_MISSING", "no approved cap is on record for line item " + st.item + "; nothing was opened");
    if (s.program === null) return fail("E_USAGE", "line item " + st.item + " is in no program; a G stage is admitted by O6's envelope, so its item joins the program with --program at init; nothing was opened");
    const arm = pfStage(st) ? null : smStage(st) ? smArm(reg, st.arms![0]!) : reg.arms[st.arm]!;
    const want = !arm ? ["pf"] : smStage(st) ? [arm.kind === "told" ? arm.skill! : "sm"] : arm.kind === "told" ? [arm.skill!] : [...new Set(Object.values(reg.arms).flatMap((a) => (a.kind === "told" && a.skill ? [a.skill] : [])))];
    if (s.skills.length !== want.length || want.some((k) => !s.skills.includes(k))) fail("E_USAGE", "line item " + st.item + " splits its spend across " + (s.skills.join(", ") || "no skill") + ", but arm " + st.arm + " spends for " + want.join(", ") + "; a stage's item carries its own arm's skills, so the envelope charges the skill that spends; nothing was opened");
    if (s.run_id !== null && s.run_id !== o.run_id) fail("E_ITEM_BOUND", "line item " + st.item + " is bound to run " + s.run_id + ", so run " + o.run_id + " cannot spend from it; nothing was opened");
    if (s.open) fail("E_LEASE_UNSETTLED", "lease " + s.open.lease_id + " on line item " + st.item + " (machine " + s.open.machine_id + ", run " + s.open.run_id + ") is still open; settle it on that machine, then launch the driver again; nothing was opened");
    const left = s.cap_micros - s.committed_micros;
    if (left <= 0) fail("CAP_STOP", "line item " + st.item + " has nothing left of its " + usd(s.cap_micros) + " cap (" + usd(s.committed_micros) + " committed); nothing was opened");
    if (s.admission) {
      const seq = s.leases.length + 1;
      const file: LeaseFile = { schema: 1, kind: "lease", item: st.item, seq, lease_id: st.item + "." + String(seq).padStart(4, "0") + ".000000", run_id: o.run_id, machine_id: machine, holder, reserved_micros: left, expires_at: new Date(at.getTime() + ttl).toISOString(), created_at: at.toISOString() };
      const why = (o.requireAdmission ?? rigAdmission())(o.record, file);
      if (why && s.admission === "required") fail("E_RIG_UNPROVEN", "line item " + st.item + " requires admission for slot " + seq + ": " + why + "; write it with gstack-evals rig admit for that slot, then launch the driver again; nothing was opened");
    }
    return { st, s, left, program: s.program };
  });
  const programs = new Map<string, { amount: number; skills: Map<string, number> }>();
  for (const { s, left, program } of plans) {
    const p = programs.get(program) ?? { amount: 0, skills: new Map<string, number>() };
    programs.set(program, p);
    p.amount += left;
    for (const [skill, part] of split(left, s.skills)) p.skills.set(skill, (p.skills.get(skill) ?? 0) + part);
  }
  for (const [program, p] of programs) {
    const env = envelopeStatus(o.record, program, at);
    if (env.total.committed_micros + p.amount > env.total.cap_micros) fail("ENVELOPE_PROGRAM_STOP", "program " + program + " holds " + usd(env.total.committed_micros) + " of its " + usd(env.total.cap_micros) + " envelope; this batch's stages reserve " + usd(p.amount) + " together, so none is opened");
    for (const [skill, part] of p.skills) {
      const l = env.skills[skill];
      if (!l || l.committed_micros + part > l.cap_micros) fail("ENVELOPE_SKILL_STOP", "skill " + skill + " in program " + program + " holds " + usd(l?.committed_micros ?? 0) + " of its " + usd(l?.cap_micros ?? 0) + " ceiling; this batch's stages put " + usd(part) + " on it together, so none is opened");
    }
  }

  let control: ReturnType<typeof Bun.serve>;
  try {
    control = Bun.serve({
      hostname: "127.0.0.1",
      port: o.control_port ?? 0,
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        try {
          if (req.method === "GET" && path === "/status") return Response.json(status());
          if (req.method === "POST" && path === "/sessions") {
            const ctx: Record<string, unknown> = {};
            const res = await open(req, ctx);
            if (!res.ok) {
              const p = (await res.clone().json()) as Record<string, unknown>;
              record({ event: "refuse", code: p.code, status: res.status, ...ctx, ...(p.item ? { item: p.item } : {}), ...(p.scope ? { scope: p.scope } : {}), detail: p.detail });
            }
            return res;
          }
          const m = path.match(/^\/sessions\/([A-Za-z0-9_-]+)\/close$/);
          if (req.method === "POST" && m) {
            const sess = sessions.get(m[1]!);
            if (!sess) return refusal("E_USAGE", 404, "no session " + m[1]);
            let reason = "agent_finished";
            try {
              const b = (await req.json()) as { reason?: unknown };
              if (typeof b?.reason === "string" && b.reason) reason = b.reason;
            } catch {}
            return Response.json(await closeSession(sess, reason));
          }
          if (req.method === "POST" && path === "/stop") {
            setTimeout(() => void stop(), 0);
            return Response.json({ stopping: true });
          }
          return refusal("E_USAGE", 404, "no route " + req.method + " " + path + "; the driver serves POST /sessions, POST /sessions/<id>/close, GET /status and POST /stop");
        } catch (e) {
          log("E_INTERNAL outcome driver: " + req.method + " " + path + " failed: " + (e as Error).message + "; stopping every stage");
          void stop("failed");
          return refusal("E_INTERNAL", 500, "the driver failed and is stopping every stage");
        }
      },
    });
  } catch (error) {
    return fail("E_USAGE", "the control plane can't listen on 127.0.0.1:" + (o.control_port ?? 0) + " (" + (error as Error).message + "); nothing was opened");
  }

  const stages: Stage[] = [];
  const opened: string[] = [];
  const unwind = (error: unknown): never => {
    void control.stop(true);
    for (const s of stages) {
      try {
        s.proxy.stop();
      } catch {}
    }
    for (const lease_id of opened) {
      try {
        settleLease(o.record, o.local, lease_id, warn);
      } catch (e) {
        log("E_LEASE_UNSETTLED lease " + lease_id + " could not be settled after a failed open: " + (e as Error).message);
      }
    }
    throw error;
  };
  record({ event: "launch", nonce: holder.nonce });
  for (const [i, { st }] of plans.entries()) {
    try {
      const lease = openLease(o.record, o.local, { item: st.item, run_id: o.run_id, machine_id: machine, holder, ttl_ms: ttl, warn, requireAdmission: o.requireAdmission, ...(o.now ? { now: new Date(now()) } : {}) });
      opened.push(lease.lease_id);
      const journal = join(dir, lease.lease_id + ".journal.ndjson");
      const sm = smStage(st);
      const pf = pfStage(st);
      const proxy = new MeteringProxy({ ledger: o.local, leaseId: lease.lease_id, host: o.host, managementSocket: join(dir, "p" + i + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: o.retry ?? DEFAULT_RETRY, env: o.env, fetch: o.fetch, ...(sm || pf ? { refuseServerTools: true } : {}), ...(pf ? { firstRequestFields: [...EFFORT_KEYS] } : {}) });
      const stage: Stage = { item: st.item, arm: st.arm, kind: pf ? "prompt" : sm ? smArm(reg, st.arms![0]!).kind : reg.arms[st.arm]!.kind, arms: pf ? [...(st.arms ?? [st.arm])] : sm ? [...st.arms!] : [st.arm], ...(sm ? { model: st.model } : {}), ...(pf ? { models: PF_STAGES[st.item]!.models } : {}), pf, lease_id: lease.lease_id, reserved: lease.reserved_micros, expires: Date.parse(lease.expires_at), proxy, journal, state: "serving", ended: null, halted: false, scope: null, live: new Map(), opens: 0, reruns: 0, finished: 0, settling: null, close: null };
      stages.push(stage);
      proxy.start();
    } catch (error) {
      unwind(error);
    }
  }

  const triples = new Map<string, number>();
  const wraps = new Map<string, number>();
  const holds = new Map<string, { stage: Stage; micros: number; task: string; until: number | null }>();
  if (existsSync(sessionsFile)) {
    for (const line of readFileSync(sessionsFile, "utf8").split("\n")) {
      let e: { run_id?: string; event?: string; arm?: string; model?: string; task?: string; trial_n?: number; rerun?: string; phase?: string };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const stage = stages.find((s) => s.arms.includes(e.arm!) && (s.models ? s.models.includes(e.model!) : s.model === e.model));
      if (e.run_id !== o.run_id || e.event !== "open" || !stage) continue;
      const key = e.arm + "|" + (stage.pf ? e.model : (stage.model ?? "")) + "|" + e.task + "|" + e.trial_n;
      if (stage.pf && e.phase === "wrapup") {
        wraps.set(key, (wraps.get(key) ?? 0) + 1);
        continue;
      }
      if (stage.pf) wraps.set(key, 0);
      triples.set(key, (triples.get(key) ?? 0) + 1);
      stage.opens++;
      if (e.rerun) stage.reruns++;
    }
  }
  const sessions = new Map<string, Session>();
  const keys = new Map<string, { body: string; id: string }>();
  let resolveDone!: (code: number) => void;
  const done = new Promise<number>((r) => (resolveDone = r));
  let finishing: Promise<number> | null = null;
  let failed = false;
  const grace = o.deadline_grace_ms ?? DEADLINE_GRACE_MS;

  const closeSession = (sess: Session, reason: string): Promise<CloseAnswer> => {
    sess.closing ??= (async () => {
      const s = sess.stage;
      clearTimeout(sess.timer);
      s.proxy.unbind(sess.slot);
      let meter: Awaited<ReturnType<MeteringProxy["finalize"]>> | null = null;
      try {
        meter = await s.proxy.finalize(sess.meter_id);
      } catch (e) {
        log("E_INTERNAL outcome driver: finalizing session " + sess.id + " failed: " + (e as Error).message);
      }
      const m = o.local.meters(s.lease_id).get(sess.meter_id);
      const u = m?.usage ?? { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 };
      const answer: CloseAnswer = {
        id: sess.id,
        reason,
        lease_id: s.lease_id,
        meter_id: sess.meter_id,
        spent_micros: m?.spent_micros ?? 0,
        unknown_micros: m?.unknown_micros ?? 0,
        unknown_calls: m?.unknown_calls ?? 0,
        usage: { input_tokens: u.input, output_tokens: u.output + u.reasoning, cache_read_input_tokens: u.cache_read, cache_creation_input_tokens: u.cache_write },
        finalized: meter !== null,
        requests: meter ? meter.requests : null,
        ok_responses: meter ? Object.entries(meter.upstream.statuses).reduce((n, [code, k]) => n + (code.startsWith("2") ? k : 0), 0) : null,
        refused: meter ? meter.refused : null,
        refusals: meter ? [...meter.refusals] : null,
        allowance_stops: meter ? meter.allowance_stops : null,
        unknown: meter ? meter.unknown : null,
        undrained: meter ? meter.undrained : null,
        unsettled: meter ? meter.unsettled : null,
        ...(s.pf ? pfClose(s.journal, sess.meter_id, sess.allowance, meter?.first_request ?? null) : {}),
      };
      sess.closed = answer;
      const hold = sess.key ? holds.get(sess.key) : undefined;
      if (hold?.task === sess.id) hold.until = now() + grace;
      s.live.delete(sess.id);
      s.finished++;
      const halt = !meter && s.model !== undefined;
      const pfHalt = s.pf && !meter;
      if (halt || pfHalt) record({ event: "halt", item: s.item, id: sess.id, lease_id: s.lease_id, meter_id: sess.meter_id, journal: s.journal }, true);
      record({ event: "close", item: s.item, ...answer });
      if (pfHalt) {
        s.halted = true;
        warn("E_PF_FINALIZE_HALT", "PF session " + sess.id + " on stage " + s.item + " (lease " + s.lease_id + "): the proxy's finalize failed, so its counts are unknown; the stage takes no more opens, and the Captain rules on a retry after reading the journal " + s.journal);
        drain(s, "failed", "finalize halt: session " + sess.id);
      }
      if (halt) {
        s.halted = true;
        log("E_SM_FINALIZE_HALT outcome driver: session " + sess.id + " on line item " + s.item + " closed with its proxy finalize failed, so its allowance stops are unknown; the item opens no more sessions or leases until the Captain rules on the proxy journal " + s.journal + " and a relaunch lifts the halt with --lift-halt " + sess.id);
        drain(s, "halted", null);
        if (s.ended !== "cap_stop") s.ended = "halted";
      }
      if (s.state === "draining" && s.live.size === 0) void settleStage(s);
      return answer;
    })();
    return sess.closing;
  };

  const settleStage = (s: Stage): Promise<void> => {
    s.settling ??= (async () => {
      const cut = s.live.size;
      s.state = "stopped";
      s.ended ??= cut ? "failed" : "completed";
      for (const sess of [...s.live.values()]) {
        try {
          await closeSession(sess, "stage_stop");
        } catch (e) {
          log("E_INTERNAL outcome driver: closing session " + sess.id + " failed: " + (e as Error).message);
        }
      }
      try {
        s.proxy.stop();
        const rec = await reconcileJournal(s.journal, o.local);
        for (const r of rec.refused) warn(r.code as ReasonCode, "settling lease " + s.lease_id + ": " + r.message);
        s.close = settleLease(o.record, o.local, s.lease_id, warn, s.ended === "cap_stop" ? s.scope || "cap_stop" : undefined);
        log("STAGE_SETTLED item=" + s.item + " arm=" + s.arm + " lease=" + s.lease_id + " spent=" + usd(s.close.spent_micros) + " unknown=" + usd(s.close.unknown_micros) + " sessions=" + s.finished + " ended=" + s.ended + (s.scope ? " scope=" + s.scope : ""));
      } catch (e) {
        failed = true;
        if (s.ended !== "cap_stop") s.ended = "failed";
        log("E_LEASE_UNSETTLED outcome driver: stage " + s.item + " lease " + s.lease_id + " did not settle: " + (e as Error).message + "; settle it with gstack-evals ledger settle --lease " + s.lease_id + " on this machine");
      }
      record({ event: "settled", item: s.item, lease_id: s.lease_id, ended: s.ended, scope: s.scope });
      if (stages.every((x) => x.state === "stopped")) void finish();
    })();
    return s.settling;
  };

  const drain = (s: Stage, ended: Ended, scope: string | null) => {
    if (s.state !== "serving") return;
    s.state = "draining";
    s.ended = ended;
    s.scope = scope;
    if (s.live.size === 0) void settleStage(s);
  };

  const capStop = (s: Stage) => {
    const scope = s.kind === "none" ? "all: none's cap stop ends both skills incomplete" : s.arm + " only";
    const hit = s.kind === "none" ? stages : [s];
    for (const x of hit) drain(x, "cap_stop", scope);
    try {
      for (const x of hit) o.local.stageStop(x.lease_id, scope);
      for (const x of hit) recordStop(o.record, x.lease_id, scope, new Date(now()));
    } catch (error) {
      for (const x of hit) record({ event: "stop", item: x.item, lease_id: x.lease_id, scope });
      throw error;
    }
    if (s.kind === "told" && stages.every((x) => x.kind !== "told" || x.ended === "completed" || x.ended === "cap_stop")) for (const x of stages) if (x.kind === "none") drain(x, "completed", "no told stage left");
  };

  const finish = (): Promise<number> => {
    finishing ??= (async () => {
      await Promise.all(stages.map((s) => s.settling));
      await control.stop();
      const open = ledgerStatus(o.record).filter((i) => stages.some((s) => s.item === i.item) && i.open_lease);
      if (open.length) log("E_LEASE_UNSETTLED outcome driver: still open: " + open.map((i) => i.open_lease!.lease_id).join(", ") + "; settle each with gstack-evals ledger settle --lease <id> on this machine");
      const code = failed || open.length || stages.some((s) => s.ended === "failed" || s.ended === "halted" || s.halted) ? 2 : 0;
      if (held.lock) rmSync(held.lock, { force: true });
      held.run?.close();
      resolveDone(code);
      return code;
    })();
    return finishing;
  };

  const stop = async (ended?: Ended): Promise<number> => {
    if (ended === "failed") failed = true;
    for (const s of stages) {
      if (s.state === "stopped") continue;
      if (ended && !s.ended) s.ended = ended;
      void settleStage(s).catch((e) => log("E_INTERNAL outcome driver: " + (e as Error).message));
    }
    await Promise.all(stages.map((s) => s.settling));
    return finish();
  };

  const open = async (req: Request, ctx: Record<string, unknown>): Promise<Response> => {
    let b: Record<string, any>;
    try {
      b = (await req.json()) as Record<string, any>;
    } catch {
      return refusal("E_USAGE", 400, "the open body is not JSON");
    }
    if (!b || typeof b !== "object" || typeof b.open_key !== "string" || !b.open_key) return refusal("E_USAGE", 400, "an open needs an open_key string");
    const body = JSON.stringify(sorted(b));
    const prior = keys.get(b.open_key);
    if (prior) {
      const sess = sessions.get(prior.id)!;
      if (prior.body !== body) return refusal("E_USAGE", 400, "open_key " + b.open_key + " opened session " + prior.id + " with another body; a retry sends the same body");
      if (sess.closed) return refusal("E_USAGE", 400, "open_key " + b.open_key + " opened session " + prior.id + ", which is closed; a new session needs a new open_key", { closed: sess.closed });
      return Response.json(sess.answer);
    }
    const meta = (b.meta ?? {}) as Record<string, any>;
    Object.assign(ctx, { open_key: b.open_key, trial: b.trial, arm: meta.arm, task: meta.task, trial_n: meta.trial_n, ...(meta.phase !== undefined ? { phase: meta.phase } : {}), ...(meta.rerun ? { rerun: meta.rerun } : {}) });
    if (b.ledger !== "u4") return refusal("E_USAGE", 400, "this driver serves only U4 opens (ledger \"u4\"), not " + JSON.stringify(b.ledger ?? null) + "; G sessions spend only through a U4 lease (G prereg section 10 item 4)");
    const stage = stages.find((s) => s.arms.includes(meta.arm) && (s.models ? s.models.includes(b.model) : s.model === undefined || s.model === b.model));
    if (!stage) return refusal("E_USAGE", 400, "arm " + JSON.stringify(meta.arm ?? null) + " is not in this batch; it serves " + stages.map((s) => s.arm).join(", ") + (stages.some((s) => s.pf) ? " (a PF arm on its item's models only)" : ""));
    const pf = stage.pf;
    const phase: "task" | "wrapup" | undefined = meta.phase;
    if (!pf && phase !== undefined) return refusal("E_USAGE", 400, "meta.phase is for PF sessions only; arm " + meta.arm + " opens one slot per session");
    if (pf && phase !== "task" && phase !== "wrapup") return refusal("E_USAGE", 400, "a PF open names meta.phase \"task\" or \"wrapup\", not " + JSON.stringify(phase ?? null));
    const turns = pf ? sessionLimits((meta.arm as string).slice(3) as PfArm, b.model, pfAllowance) : null;
    const limits = turns ? { session_cap_usd: turns[phase!].allowance_usd, wall_limit_sec: turns[phase!].wall_limit_sec } : stage.model === undefined ? reg.arms[stage.arm]!.limits : smLimits(reg, meta.arm, stage.model);
    if (!pf && stage.model === undefined && b.model !== reg.pins.model) return refusal("E_USAGE", 400, "model " + JSON.stringify(b.model ?? null) + " is not the registry's pinned " + reg.pins.model);
    if (b.cap_usd !== limits.session_cap_usd) return refusal("E_USAGE", 400, "cap_usd " + JSON.stringify(b.cap_usd ?? null) + " is not arm " + (pf ? meta.arm + "'s " + phase + " allowance_usd on " + b.model : stage.arm + "'s session_cap_usd") + " of " + limits.session_cap_usd);
    if (typeof b.trial !== "string" || !b.trial || typeof meta.task !== "string" || !meta.task || !Number.isSafeInteger(meta.trial_n) || meta.trial_n < 1) return refusal("E_USAGE", 400, "an open needs trial, meta.task and meta.trial_n (a whole number from 1)");
    if (meta.rerun !== undefined && (typeof meta.rerun !== "string" || !meta.rerun)) return refusal("E_USAGE", 400, "meta.rerun, when given, names the repair the rerun follows");
    if (stage.state !== "serving") {
      if (stage.ended === "halted") return refusal("E_SM_FINALIZE_HALT", 423, "stage " + stage.item + " (" + stage.arm + ") is halted: a session closed with its proxy finalize failed, so its allowance stops are unknown; nothing more opens on the item until the Captain rules on the proxy journal and a relaunch lifts the halt", { item: stage.item });
      if (stage.ended === "cap_stop") return refusal("CAP_STOP", 409, "stage " + stage.item + " (" + stage.arm + ") is cap-stopped, scope " + stage.scope + "; do not retry: the stage ends incomplete", { item: stage.item, scope: stage.scope });
      return refusal("E_LEASE_CLOSED", 503, "stage " + stage.item + " (" + stage.arm + ") is " + stage.state + " (" + (stage.ended ?? "stopping") + "); retry after the driver is launched again for run " + o.run_id, { item: stage.item });
    }
    const key = meta.arm + "|" + (pf ? b.model : (stage.model ?? "")) + "|" + meta.task + "|" + meta.trial_n;
    const seen = triples.get(key) ?? 0;
    const wrapped = wraps.get(key) ?? 0;
    if (phase === "wrapup") {
      if (seen === 0) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " on " + b.model + " has no task open yet; the wrap-up turn follows its session's task turn");
      if (wrapped >= 2) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " already opened its wrap-up twice in task attempt " + seen + "; a wrap-up gets one rerun at most");
      if (wrapped === 1 && !meta.rerun) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " already opened its wrap-up in task attempt " + seen + "; a second wrap-up open is its rerun and names its repair in meta.rerun");
    } else if (seen >= 2) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " was already opened " + seen + " times; a trial gets one rerun at most");
    if (phase !== "wrapup" && seen === 1 && !meta.rerun) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " was already opened; a second open is a rerun and names its repair in meta.rerun");
    if (phase !== "wrapup" && stage.opens >= planned + reruns) return refusal("E_USAGE", 422, "stage " + stage.item + " has opened " + stage.opens + " sessions, its " + planned + " planned plus " + reruns + " reruns");
    if (phase !== "wrapup" && !meta.rerun && stage.opens - stage.reruns >= planned) return refusal("E_USAGE", 422, "stage " + stage.item + " has opened its " + planned + " planned sessions; a further open is a rerun and names its repair in meta.rerun");
    if (phase !== "wrapup" && meta.rerun && stage.reruns >= reruns) return refusal("E_USAGE", 422, "stage " + stage.item + " has used its " + reruns + " reruns");
    const t = now();
    const wall = limits.wall_limit_sec * 1000 + grace;
    if (stage.expires < t + wall + (phase === "task" ? turns!.wrapup.wall_limit_sec * 1000 : 0)) {
      drain(stage, "lease_expired", null);
      return refusal("E_LEASE_CLOSED", 503, "stage " + stage.item + "'s lease " + stage.lease_id + " expires at " + new Date(stage.expires).toISOString() + ", before a session opened now could end (wall limit " + limits.wall_limit_sec + " s plus " + grace / 1000 + " s); the stage drains and settles, and a driver relaunch for run " + o.run_id + " reopens it on what the item has left", { item: stage.item });
    }
    const allowance = Math.round(limits.session_cap_usd * 1e6);
    const meters = o.local.meters(stage.lease_id);
    let pending = 0;
    for (const s of stage.live.values()) pending += Math.max(0, s.allowance - (meters.get(s.meter_id)?.held_micros ?? 0));
    // A PF task open needs room for its task allowance plus its session's wrap-up allowance, and that wrap-up allowance stays
    // pending on the lease until the wrap-up slot opens, a new task attempt replaces it, or the task slot has been closed
    // for the deadline grace, so a wrap-up open in time always finds its room.
    for (const [k, h] of holds) if (h.stage === stage && k !== key && (h.until === null || t < h.until)) pending += h.micros;
    const wrapAllowance = phase === "task" ? Math.round(turns!.wrapup.allowance_usd * 1e6) : 0;
    const held = o.local.held(stage.lease_id);
    const room = stage.reserved - held - pending;
    if (room < allowance + wrapAllowance) {
      capStop(stage);
      return refusal("CAP_STOP", 409, "stage " + stage.item + " (" + stage.arm + ") has " + usd(Math.max(room, 0)) + " of room on lease " + stage.lease_id + " (" + usd(stage.reserved) + " reserved, " + usd(held) + " held, " + usd(pending) + " still allowed to live sessions); a session needs " + usd(allowance) + (wrapAllowance ? " plus " + usd(wrapAllowance) + " for its wrap-up turn" : "") + ". Do not retry: the stage ends incomplete, scope " + stage.scope, { item: stage.item, scope: stage.scope, room_micros: room, allowance_micros: allowance });
    }
    const provider = pf ? smProvider(reg, b.model) : stage.model === undefined ? "anthropic" : smProvider(reg, stage.model);
    const binding = stage.proxy.bind({ cell: { run_id: o.run_id, arm: meta.arm, task: meta.task, model: b.model, trial: meta.trial_n, attempt: phase === "wrapup" ? seen : seen + 1 }, models: [provider + ":" + b.model], allowance_micros: allowance });
    const id = "ses_" + randomBytes(9).toString("hex");
    const answer: OpenAnswer = { id, token: binding.token, base_url: "http://" + urlHost(o.host) + ":" + stage.proxy.port + "/" + binding.slot + "/" + provider, ledger: "u4", item: stage.item, lease_id: stage.lease_id, meter_id: binding.meter_id, allowance_micros: allowance };
    const sess: Session = { id, stage, slot: binding.slot, meter_id: binding.meter_id, allowance, answer, timer: setTimeout(() => void closeSession(sess, "deadline"), wall), closing: null, closed: null, ...(pf ? { key } : {}) };
    sess.timer.unref?.();
    sessions.set(id, sess);
    keys.set(b.open_key, { body, id });
    stage.live.set(id, sess);
    if (phase === "wrapup") {
      wraps.set(key, wrapped + 1);
      holds.delete(key);
    } else {
      stage.opens++;
      if (meta.rerun) stage.reruns++;
      triples.set(key, seen + 1);
      if (pf) {
        wraps.set(key, 0);
        holds.set(key, { stage, micros: wrapAllowance, task: id, until: null });
      }
    }
    record({ event: "open", id, item: stage.item, arm: meta.arm, ...(pf ? { model: b.model, phase } : stage.model === undefined ? {} : { model: stage.model }), task: meta.task, trial_n: meta.trial_n, ...(meta.rerun ? { rerun: meta.rerun } : {}), trial: b.trial, lease_id: stage.lease_id, meter_id: binding.meter_id, allowance_micros: allowance });
    return Response.json(answer);
  };

  const status = () => ({
    run_id: o.run_id,
    stages: stages.map((s) => {
      const held = s.state === "stopped" ? null : o.local.held(s.lease_id);
      return { item: s.item, arm: s.arm, lease_id: s.lease_id, reserved_micros: s.reserved, held_micros: held, expires_at: new Date(s.expires).toISOString(), state: s.state, ended: s.ended, scope: s.scope, live: [...s.live.keys()], opens: s.opens, reruns: s.reruns, finished: s.finished };
    }),
  });


  return {
    control: "http://127.0.0.1:" + control.port,
    stages: stages.map((s) => ({ item: s.item, arm: s.arm, lease_id: s.lease_id, reserved_micros: s.reserved, proxy: urlHost(o.host) + ":" + s.proxy.port })),
    done,
    stop,
  };
}

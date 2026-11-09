// The outcome-skills session driver (GST-1381, plan wiki/plans/2026-11-04-geva-286-u4-session-driver): one U4 lease per
// stage at its line item's cap (G prereg section 9), one metering-proxy slot per session, and a control plane on
// 127.0.0.1 that real_agent's U4 mode opens and closes sessions on. Every lease is admitted by O6's envelope through
// openLease, and every exit path settles every lease it opened. Each lease names its holder, the run directory and the
// launch's nonce, and a run binds to the directory of its first lease, so that directory's sessions.jsonl holds the run's
// trial counts. The ledger is the only trust root: a cap stop is written into O6's record when it fires, before the 409
// that reports it, after which O6 admits no new lease on that item, and a launch whose sessions.jsonl does not name every
// launch and session meter the ledger holds for the run is refused.
import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

export const DEFAULT_TTL_MS = 72 * 3_600_000;
export const DEADLINE_GRACE_MS = 120_000;
export const DEFAULT_RETRY: RetryBudget = { attempts: 3, elapsed_ms: 300_000 };

export interface StageSpec {
  item: string;
  arm: string;
  /** Family SM only: the model the stage's item pays for, and every SM arm its sessions may name (arm is the stage's label then). Its proxy refuses provider-side tools. */
  model?: string;
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
  retry?: RetryBudget;
  registry?: Registry;
  env?: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  requireAdmission?: RequireAdmission;
  machine?: string;
  now?: () => number;
  /** Receives every notice line, code first. */
  log?: (line: string) => void;
}

export type Ended = "completed" | "cap_stop" | "lease_expired" | "failed";

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
  requests: number;
  ok_responses: number;
  refused: number;
  unknown: number;
  undrained: number;
  unsettled: number;
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
}

interface Stage {
  item: string;
  arm: string;
  kind: "none" | "told" | "prompt" | "followon";
  /** The arms its sessions may name: [arm] for G; the stage's SM arms for family SM, with its model. */
  arms: string[];
  model?: string;
  lease_id: string;
  reserved: number;
  expires: number;
  proxy: MeteringProxy;
  journal: string;
  state: "serving" | "draining" | "stopped";
  ended: Ended | null;
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
  /** Resolves with the exit code once every stage is settled: 0, or 2 when the driver failed, a lease is still open or a stage ended failed. */
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
  const smStage = (st: StageSpec) => st.model !== undefined || st.arms !== undefined;
  for (const st of o.stages) {
    if (!smStage(st)) {
      if (!Object.hasOwn(reg.arms, st.arm)) fail("E_USAGE", "stage " + st.item + " names arm " + st.arm + ", which the registry does not hold; it holds " + Object.keys(reg.arms).join(", "));
      continue;
    }
    if (!st.model || !st.arms?.length || st.arms.some((a) => !isSmArm(reg, a)) || new Set(st.arms.map((a) => smArm(reg, a).kind === "told")).size !== 1) fail("E_USAGE", "SM stage " + st.item + " needs a model and a list of family SM arms, all told or none told");
    smProvider(reg, st.model!);
  }
  const servedBy = o.stages.flatMap((s) => (smStage(s) ? s.arms!.map((a) => a + "@" + s.model) : [s.arm]));
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
  const record = (line: Record<string, unknown>) => {
    const fresh = existsSync(sessionsFile) && cutShort(sessionsFile) ? "\n" : "";
    appendFileSync(sessionsFile, fresh + JSON.stringify({ at: new Date(now()).toISOString(), run_id: o.run_id, ...line }) + "\n");
  };
  const lines: Array<{ at?: string; event?: string; id?: string; item?: string; lease_id?: string; ended?: string; code?: string; scope?: string | null; nonce?: string; meter_id?: string }> = [];
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
      closeOpenSessions(lease, "recovered", meterFigures(o.local, lease.lease_id), new Date(now()));
      const stop = capped.get("") ?? capped.get(item);
      const close = settleLease(o.record, o.local, lease.lease_id, warn, stop ? stop.scope || "cap_stop" : undefined);
      log("STAGE_RECOVERED item=" + item + " lease=" + lease.lease_id + " spent=" + usd(close.spent_micros) + " unknown=" + usd(close.unknown_micros) + " unknown_calls=" + close.unknown_calls);
    } catch (error) {
      failures.push(lease.lease_id + " (" + (error as Error).message + ")");
    }
  }
  if (failures.length) fail("E_LEASE_UNSETTLED", "recovery could not settle " + failures.join("; ") + "; nothing new was opened. Settle each with gstack-evals ledger settle --lease <id> on this machine, then launch the driver again");

  const at = new Date(now());
  const plans = o.stages.map((st) => {
    const s = readItem(o.record, st.item);
    const unheld = s.leases.filter((l) => l.lease.run_id === o.run_id && l.lease.holder?.dir !== dir).map((l) => l.lease);
    if (unheld.length) fail("E_USAGE", "line item " + st.item + " holds run " + o.run_id + "'s leases " + unheld.map((l) => l.lease_id).join(", ") + ", which name no holder, so no run directory's sessions.jsonl counts their sessions and the driver can't serve the item for this run; nothing was opened");
    const stop = capped.get("") ?? capped.get(st.item);
    if (stop) fail("CAP_STOP", (capped.has("") ? "the none stage cap-stopped in run " + o.run_id + " at " + stop.at + " (scope " + stop.scope + "), which ends both skills incomplete" : "stage " + st.item + " cap-stopped in run " + o.run_id + " at " + stop.at + " (scope " + stop.scope + "), which ends its skill incomplete") + "; a cap stop is not retried (plan section 6); nothing was opened");
    if (s.cap_micros === null) return fail("E_LEDGER_MISSING", "no approved cap is on record for line item " + st.item + "; nothing was opened");
    if (s.program === null) return fail("E_USAGE", "line item " + st.item + " is in no program; a G stage is admitted by O6's envelope, so its item joins the program with --program at init; nothing was opened");
    const arm = smStage(st) ? smArm(reg, st.arms![0]!) : reg.arms[st.arm]!;
    const want = smStage(st) ? [arm.kind === "told" ? arm.skill! : "sm"] : arm.kind === "told" ? [arm.skill!] : [...new Set(Object.values(reg.arms).flatMap((a) => (a.kind === "told" && a.skill ? [a.skill] : [])))];
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
      const proxy = new MeteringProxy({ ledger: o.local, leaseId: lease.lease_id, host: o.host, managementSocket: join(dir, "p" + i + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: o.retry ?? DEFAULT_RETRY, env: o.env, fetch: o.fetch, ...(sm ? { refuseServerTools: true } : {}) });
      const stage: Stage = { item: st.item, arm: st.arm, kind: sm ? smArm(reg, st.arms![0]!).kind : reg.arms[st.arm]!.kind, arms: sm ? [...st.arms!] : [st.arm], ...(sm ? { model: st.model } : {}), lease_id: lease.lease_id, reserved: lease.reserved_micros, expires: Date.parse(lease.expires_at), proxy, journal, state: "serving", ended: null, scope: null, live: new Map(), opens: 0, reruns: 0, finished: 0, settling: null, close: null };
      stages.push(stage);
      proxy.start();
    } catch (error) {
      unwind(error);
    }
  }

  const triples = new Map<string, number>();
  if (existsSync(sessionsFile)) {
    for (const line of readFileSync(sessionsFile, "utf8").split("\n")) {
      let e: { run_id?: string; event?: string; arm?: string; model?: string; task?: string; trial_n?: number; rerun?: string };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const stage = stages.find((s) => s.arms.includes(e.arm!) && s.model === e.model);
      if (e.run_id !== o.run_id || e.event !== "open" || !stage) continue;
      const key = e.arm + "|" + e.task + "|" + e.trial_n;
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
        requests: meter?.requests ?? 0,
        ok_responses: Object.entries(meter?.upstream.statuses ?? {}).reduce((n, [code, k]) => n + (code.startsWith("2") ? k : 0), 0),
        refused: meter?.refused ?? 0,
        unknown: meter?.unknown ?? 0,
        undrained: meter?.undrained ?? 0,
        unsettled: meter?.unsettled ?? 0,
      };
      sess.closed = answer;
      s.live.delete(sess.id);
      s.finished++;
      record({ event: "close", item: s.item, ...answer });
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
      const code = failed || open.length || stages.some((s) => s.ended === "failed") ? 2 : 0;
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
    Object.assign(ctx, { open_key: b.open_key, trial: b.trial, arm: meta.arm, task: meta.task, trial_n: meta.trial_n, ...(meta.rerun ? { rerun: meta.rerun } : {}) });
    if (b.ledger !== "u4") return refusal("E_USAGE", 400, "this driver serves only U4 opens (ledger \"u4\"), not " + JSON.stringify(b.ledger ?? null) + "; G sessions spend only through a U4 lease (G prereg section 10 item 4)");
    const stage = stages.find((s) => s.arms.includes(meta.arm) && (s.model === undefined || s.model === b.model));
    if (!stage) return refusal("E_USAGE", 400, "arm " + JSON.stringify(meta.arm ?? null) + " is not in this batch; it serves " + stages.map((s) => s.arm).join(", "));
    const limits = stage.model === undefined ? reg.arms[stage.arm]!.limits : smLimits(reg, meta.arm, stage.model);
    if (stage.model === undefined && b.model !== reg.pins.model) return refusal("E_USAGE", 400, "model " + JSON.stringify(b.model ?? null) + " is not the registry's pinned " + reg.pins.model);
    if (b.cap_usd !== limits.session_cap_usd) return refusal("E_USAGE", 400, "cap_usd " + JSON.stringify(b.cap_usd ?? null) + " is not arm " + stage.arm + "'s session_cap_usd of " + limits.session_cap_usd);
    if (typeof b.trial !== "string" || !b.trial || typeof meta.task !== "string" || !meta.task || !Number.isSafeInteger(meta.trial_n) || meta.trial_n < 1) return refusal("E_USAGE", 400, "an open needs trial, meta.task and meta.trial_n (a whole number from 1)");
    if (meta.rerun !== undefined && (typeof meta.rerun !== "string" || !meta.rerun)) return refusal("E_USAGE", 400, "meta.rerun, when given, names the repair the rerun follows");
    if (stage.state !== "serving") {
      if (stage.ended === "cap_stop") return refusal("CAP_STOP", 409, "stage " + stage.item + " (" + stage.arm + ") is cap-stopped, scope " + stage.scope + "; do not retry: the stage ends incomplete", { item: stage.item, scope: stage.scope });
      return refusal("E_LEASE_CLOSED", 503, "stage " + stage.item + " (" + stage.arm + ") is " + stage.state + " (" + (stage.ended ?? "stopping") + "); retry after the driver is launched again for run " + o.run_id, { item: stage.item });
    }
    const key = meta.arm + "|" + meta.task + "|" + meta.trial_n;
    const seen = triples.get(key) ?? 0;
    if (seen >= 2) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " was already opened " + seen + " times; a trial gets one rerun at most");
    if (seen === 1 && !meta.rerun) return refusal("E_USAGE", 422, "arm " + meta.arm + " task " + meta.task + " trial " + meta.trial_n + " was already opened; a second open is a rerun and names its repair in meta.rerun");
    if (stage.opens >= planned + reruns) return refusal("E_USAGE", 422, "stage " + stage.item + " has opened " + stage.opens + " sessions, its " + planned + " planned plus " + reruns + " reruns");
    if (!meta.rerun && stage.opens - stage.reruns >= planned) return refusal("E_USAGE", 422, "stage " + stage.item + " has opened its " + planned + " planned sessions; a further open is a rerun and names its repair in meta.rerun");
    if (meta.rerun && stage.reruns >= reruns) return refusal("E_USAGE", 422, "stage " + stage.item + " has used its " + reruns + " reruns");
    const t = now();
    const grace = o.deadline_grace_ms ?? DEADLINE_GRACE_MS;
    const wall = limits.wall_limit_sec * 1000 + grace;
    if (stage.expires < t + wall) {
      drain(stage, "lease_expired", null);
      return refusal("E_LEASE_CLOSED", 503, "stage " + stage.item + "'s lease " + stage.lease_id + " expires at " + new Date(stage.expires).toISOString() + ", before a session opened now could end (wall limit " + limits.wall_limit_sec + " s plus " + grace / 1000 + " s); the stage drains and settles, and a driver relaunch for run " + o.run_id + " reopens it on what the item has left", { item: stage.item });
    }
    const allowance = Math.round(limits.session_cap_usd * 1e6);
    const meters = o.local.meters(stage.lease_id);
    let pending = 0;
    for (const s of stage.live.values()) pending += Math.max(0, s.allowance - (meters.get(s.meter_id)?.held_micros ?? 0));
    const held = o.local.held(stage.lease_id);
    const room = stage.reserved - held - pending;
    if (room < allowance) {
      capStop(stage);
      return refusal("CAP_STOP", 409, "stage " + stage.item + " (" + stage.arm + ") has " + usd(Math.max(room, 0)) + " of room on lease " + stage.lease_id + " (" + usd(stage.reserved) + " reserved, " + usd(held) + " held, " + usd(pending) + " still allowed to live sessions); a session needs " + usd(allowance) + ". Do not retry: the stage ends incomplete, scope " + stage.scope, { item: stage.item, scope: stage.scope, room_micros: room, allowance_micros: allowance });
    }
    const provider = stage.model === undefined ? "anthropic" : smProvider(reg, stage.model);
    const binding = stage.proxy.bind({ cell: { run_id: o.run_id, arm: meta.arm, task: meta.task, model: b.model, trial: meta.trial_n, attempt: seen + 1 }, models: [provider + ":" + b.model], allowance_micros: allowance });
    const id = "ses_" + randomBytes(9).toString("hex");
    const answer: OpenAnswer = { id, token: binding.token, base_url: "http://" + urlHost(o.host) + ":" + stage.proxy.port + "/" + binding.slot + "/" + provider, ledger: "u4", item: stage.item, lease_id: stage.lease_id, meter_id: binding.meter_id, allowance_micros: allowance };
    const sess: Session = { id, stage, slot: binding.slot, meter_id: binding.meter_id, allowance, answer, timer: setTimeout(() => void closeSession(sess, "deadline"), wall), closing: null, closed: null };
    sess.timer.unref?.();
    sessions.set(id, sess);
    keys.set(b.open_key, { body, id });
    stage.live.set(id, sess);
    stage.opens++;
    if (meta.rerun) stage.reruns++;
    triples.set(key, seen + 1);
    record({ event: "open", id, item: stage.item, arm: meta.arm, ...(stage.model === undefined ? {} : { model: stage.model }), task: meta.task, trial_n: meta.trial_n, ...(meta.rerun ? { rerun: meta.rerun } : {}), trial: b.trial, lease_id: stage.lease_id, meter_id: binding.meter_id, allowance_micros: allowance });
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

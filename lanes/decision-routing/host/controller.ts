// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing host controller (preregistration sections 9 and 15). Given a batch plan, a JSON array of
// {task, cell, model, item}, it:
// - verifies the runtime tarball and the pin file by sha256 (E_DR_RUNTIME, E_DR_PIN) and refuses while the STOP file exists;
// - per ledger item in the plan, reconciles the item's journal from any earlier launch (reconcileJournal), settles this
//   run's open lease, then, before any lease, checks every item's cap holds what is committed on it plus the reserve
//   (reserveMicros: CONCURRENCY sessions at cells.json's allowance), else stops with DR_RESERVE_STOP having leased and
//   launched nothing; then opens one lease per item (openLease) and starts one MeteringProxy on it with allowanceCode
//   DR_ALLOWANCE_STOP; before the leases and again once its proxies listen, it stops with DR_PROXY_PORT_BUSY unless its
//   own proxies are the only listeners on the proxy port range the container firewall opens and, when the proxy host is
//   off loopback, the kernel holds that range back from ephemeral ports (checkProxyListeners, reservedPorts);
//   on a real record it launches nothing until vm.sh record-out --confirm shows its leases open in the drive copy of
//   the record (awaitLeaseConfirmed, DR_LEASE_UNRECORDED);
// - orders the sessions by a seeded shuffle (seed 20261110) and runs at most 6 at once, never two cells of one task at the
//   same time, each as one Harbor job (harbor run -c <job.json>) whose process env holds the management socket and token
//   and no provider key;
// - stops launching on the STOP file (E_DR_STOPPED), a CAP_STOP from the ledger, or, in a pilot batch, a session meter past
//   $2.50 (DR_PILOT_SESSION_STOP), lets running sessions end, and never retries; a DR_PILOT_SESSION_STOP or DR_CUSTODY_HIT
//   writes the STOP file with its code and session, and a start refuses while any journal of a plan item, live or
//   .dead-N, holds a DR_CUSTODY_HIT refusal;
// - settles every lease at the end and writes <out>/batch.json.
// - with custody inputs, builds each task's runner-only markers (labels/markers.ts) before any lease, writes each
//   session's list to <out>/markers/<session>.json (owner-only, host side) and names it in the job's markers_file kwarg
//   for the agent's bind; a DR_CUSTODY_HIT refusal in any journal stops launching with DR_CUSTODY_HIT and logs the
//   session and marker index, never the marker.
// A session whose job file exists was launched once and is never launched again.
// --temp runs the whole flow on a temporary ledger and record initialised from config/items.json, for keyless dry runs,
// and is refused without --fake-upstreams.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { openLease, recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger, openLocalLedger } from "../../../src/runner/ledger/local.ts";
import { usd } from "../../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../../src/runner/ledger/record.ts";
import { plantCanary, taskMarkers, type Pristine } from "../labels/markers.ts";
import { isTrialNetworkHost, MeteringProxy, reconcileJournal, UPSTREAM, type RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";

export const SEED = 20261110;
export const CONCURRENCY = 6;
export const CELLS = ["N", "R", "P", "F", "J", "W"] as const;
export const MODELS = ["opus", "sol", "particle"] as const;
/** The agent lane's proxy retry budget (lanes/outcome-skills/driver/stage.ts DEFAULT_RETRY). */
export const RETRY: RetryBudget = { attempts: 3, elapsed_ms: 300_000 };
export const MAX_OUTPUT_TOKENS = 32_000;
export const PILOT_SESSION_STOP_MICROS = 2_500_000;
export const HARBOR_RETRY = { max_retries: 1, include_exceptions: ["DrInfraError", "EnvironmentStartTimeoutError", "AgentSetupTimeoutError"] };
export const AGENT_IMPORT_PATH = "dr_harbor:DecisionRoutingAgent";
/** Harbor's docker environment with the rig's egress sidecar build context (agent/dr_sidecar.py, agent/egress-sidecar). */
export const ENVIRONMENT_IMPORT_PATH = "dr_sidecar:DrDockerEnvironment";
/** The runner's container firewall (host/post-boot.sh) lets containers reach the host only on these ports, one per leased item. */
export const PROXY_PORT_FIRST = 47100;
export const PROXY_PORT_COUNT = 8;
/** How long a lease on a real record waits for record-out --confirm (vm.sh) before DR_LEASE_UNRECORDED. */
export const LEASE_CONFIRM_MS = 30 * 60_000;
const LANE = resolve(import.meta.dir, "..");
const PROVIDER_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "UBICLOUD_API_KEY"];

export interface PlanRow {
  task: string;
  cell: (typeof CELLS)[number];
  model: (typeof MODELS)[number];
  item: string;
}

export class ControllerError extends Error {
  constructor(
    readonly code: ReasonCode,
    message: string,
  ) {
    super(code + ": " + message);
  }
}

/** mulberry32: a small seeded generator of floats in [0, 1). The same seed gives the same sequence on every host. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates over a copy, driven by prng(seed). */
export function seededShuffle<T>(rows: readonly T[], seed = SEED): T[] {
  const out = [...rows];
  const next = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const sessionId = (r: PlanRow) => [r.task, r.cell, r.model].join("__").replace(/[^A-Za-z0-9._-]/g, "-");

/** The first queued row whose task has no running session, or -1. */
export const nextRunnable = (queue: readonly PlanRow[], runningTasks: ReadonlySet<string>) => queue.findIndex((r) => !runningTasks.has(r.task));

export function parsePlan(text: string): PlanRow[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new ControllerError("E_USAGE", "the batch plan is not JSON");
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new ControllerError("E_USAGE", "the batch plan must be a non-empty JSON array of {task, cell, model, item}");
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const row = r as PlanRow;
    if (!row || typeof row.task !== "string" || !/^[A-Za-z0-9._/-]+$/.test(row.task)) throw new ControllerError("E_USAGE", "plan row " + i + " needs a task name of letters, digits and ._/-");
    if (!CELLS.includes(row.cell)) throw new ControllerError("E_USAGE", "plan row " + i + " has cell " + JSON.stringify(row.cell) + "; cells are " + CELLS.join(", "));
    if (!MODELS.includes(row.model) || (row.cell === "W") !== (row.model === "particle")) throw new ControllerError("E_USAGE", "plan row " + i + " has model " + JSON.stringify(row.model) + " in cell " + row.cell + "; W runs particle and every other cell opus or sol");
    if (typeof row.item !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(row.item)) throw new ControllerError("E_USAGE", "plan row " + i + " needs a ledger item name");
    const id = sessionId(row);
    if (seen.has(id)) throw new ControllerError("E_USAGE", "plan row " + i + " repeats session " + id);
    seen.add(id);
    return { task: row.task, cell: row.cell, model: row.model, item: row.item };
  });
}

export interface JobInputs {
  out: string;
  tasksDir: string;
  proxyHost: string;
  runtimeTarball: string;
  runtimeSha256: string;
  pinFile: string;
}

/** Item k's proxy port: any free port on a loopback host, else the k-th port the runner's container firewall opens. */
export function proxyPort(host: string, index: number): number | undefined {
  const h = host.trim().replace(/^\[(.*)\]$/, "$1");
  if (h === "::1" || h.startsWith("127.")) return undefined;
  if (index >= PROXY_PORT_COUNT) throw new ControllerError("E_USAGE", "a batch whose proxy listens on " + host + " can hold at most " + PROXY_PORT_COUNT + " ledger items, one per port the runner's container firewall opens; nothing was leased or launched");
  return PROXY_PORT_FIRST + index;
}

/**
 * Lease custody: a lease opened on the VM's copy of the record must reach the drive before anything spends on it, so a
 * VM that dies mid-segment leaves the lease open where the next segment and the Captain see it. Waits until
 * <out>/lease-confirmed.json, which vm.sh record-out --confirm writes only after the drive copy reads back with those
 * leases open, lists every one of leaseIds; else DR_LEASE_UNRECORDED once timeoutMs passes or stopped() turns true.
 */
export async function awaitLeaseConfirmed(out: string, leaseIds: readonly string[], timeoutMs: number, pollMs: number, stopped: () => boolean = () => false): Promise<void> {
  const file = join(out, "lease-confirmed.json");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let listed: unknown = [];
    try {
      listed = (JSON.parse(readFileSync(file, "utf8")) as { leases?: unknown }).leases;
    } catch {}
    const missing = leaseIds.filter((id) => !(Array.isArray(listed) && listed.includes(id)));
    if (!missing.length) return;
    if (stopped() || Date.now() >= deadline) throw new ControllerError("DR_LEASE_UNRECORDED", "the drive copy of the record was never confirmed to hold lease " + missing.join(", ") + " open (" + file + "; run vm.sh record-out <name> <record> --confirm " + out + "); nothing was launched and the lease settles at what it spent, zero");
    await Bun.sleep(Math.min(pollMs, 1000));
  }
}

/** TCP ports in LISTEN on this host, from /proc/net/tcp and /proc/net/tcp6 (state 0A); a file that is missing adds none. */
export function listeningPorts(files: readonly string[] = ["/proc/net/tcp", "/proc/net/tcp6"]): number[] {
  const ports = new Set<number>();
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[3] === "0A" && cols[1]?.includes(":")) ports.add(parseInt(cols[1].split(":").pop()!, 16));
    }
  }
  return [...ports];
}

/**
 * The runner's container firewall lets containers reach the host on the proxy port range only, so at batch start the
 * batch's own proxies must be the only listeners there and each own proxy on the range must be seen listening (the
 * Captain's condition on the firewall), else DR_PROXY_PORT_BUSY.
 */
export function checkProxyListeners(own: readonly number[], listening: readonly number[] = listeningPorts(), reserved: readonly number[] | null = null): void {
  const onRange = (p: number) => p >= PROXY_PORT_FIRST && p < PROXY_PORT_FIRST + PROXY_PORT_COUNT;
  const others = [...new Set(listening.filter((p) => onRange(p) && !own.includes(p)))].sort((a, b) => a - b);
  const unseen = own.filter((p) => onRange(p) && !listening.includes(p));
  const unreserved = reserved ? Array.from({ length: PROXY_PORT_COUNT }, (_, i) => PROXY_PORT_FIRST + i).filter((p) => !reserved.includes(p)) : [];
  if (!others.length && !unseen.length && !unreserved.length) return;
  throw new ControllerError(
    "DR_PROXY_PORT_BUSY",
    "TCP " + PROXY_PORT_FIRST + "-" + (PROXY_PORT_FIRST + PROXY_PORT_COUNT - 1) + ", which the container firewall opens to the agents, must hold only this batch's proxies" +
      (others.length ? "; something else listens on " + others.join(", ") : "") +
      (unseen.length ? "; this batch's proxy on " + unseen.join(", ") + " is not seen listening" : "") +
      (unreserved.length ? "; the kernel can still hand " + unreserved.join(", ") + " to any program as an ephemeral port (net.ipv4.ip_local_reserved_ports; post-boot.sh reserves the range)" : "") +
      "; nothing new is launched",
  );
}

/** Ports the kernel keeps out of its automatic (ephemeral) assignment, from net.ipv4.ip_local_reserved_ports; a missing file reserves none. */
export function reservedPorts(file = "/proc/sys/net/ipv4/ip_local_reserved_ports"): number[] {
  if (!existsSync(file)) return [];
  const ports: number[] = [];
  for (const part of readFileSync(file, "utf8").trim().split(",").filter(Boolean)) {
    const [first, last = first] = part.split("-").map((n) => parseInt(n, 10));
    for (let p = first!; p <= last!; p++) ports.push(p);
  }
  return ports;
}

/**
 * One Harbor job with one trial: the decision-routing agent, docker with delete and the rig's egress sidecar, the proxy
 * host on the agent's allowlist.
 * The task's [agent] network_mode is allowlist with no host, and Harbor merges only the agent's extra_allowed_hosts into
 * it; environment.extra_allowed_hosts reaches the setup baseline alone, so the agent's run would reach no proxy.
 */
export function harborJob(row: PlanRow, o: JobInputs, markersFile?: string) {
  return {
    job_name: sessionId(row),
    jobs_dir: join(o.out, "harbor"),
    n_attempts: 1,
    n_concurrent_trials: 1,
    quiet: true,
    retry: HARBOR_RETRY,
    environment: { type: "docker", import_path: ENVIRONMENT_IMPORT_PATH, delete: true },
    agents: [{ import_path: AGENT_IMPORT_PATH, extra_allowed_hosts: [o.proxyHost], kwargs: { cell: row.cell, model: row.model, runtime_tarball: o.runtimeTarball, runtime_sha256: o.runtimeSha256, pin_file: o.pinFile, item: row.item, ...(markersFile ? { markers_file: markersFile } : {}) } }],
    tasks: [{ path: join(o.tasksDir, row.task) }],
  };
}

/** Harbor's process env: the controller's env without any provider or cloud key, with telemetry off and the proxy's management socket and token. */
export function harborEnv(env: Record<string, string | undefined>, proxy: { socket: string; token: string; base: string }, agentPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !PROVIDER_KEYS.includes(k) && !/_API_KEY$/.test(k)) out[k] = v;
  return { ...out, HARBOR_TELEMETRY: "0", DR_MGMT_SOCKET: proxy.socket, DR_MGMT_TOKEN: proxy.token, DR_PROXY_BASE: proxy.base, PYTHONPATH: [agentPath, out.PYTHONPATH].filter(Boolean).join(":") };
}

type Line = Record<string, any>;
const readLines = (path: string): Line[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l)] : [];
          } catch {
            return [];
          }
        })
    : [];

/** Spend per meter id from journal lines: settled spend, and an unknown outcome at its full reservation. */
export function meterSpend(lines: Line[]): Map<string, number> {
  const max = new Map(lines.filter((l) => l.kind === "request").map((l) => [l.reservation_id, l.max_micros as number]));
  const spend = new Map<string, number>();
  for (const l of lines) {
    if (l.kind !== "outcome") continue;
    const micros = l.outcome?.kind === "spent" ? (l.outcome.spent_micros as number) : (max.get(l.reservation_id) ?? 0);
    spend.set(l.meter_id, (spend.get(l.meter_id) ?? 0) + micros);
  }
  return spend;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A fetch that sends each provider's calls to a fake upstream instead, for keyless dry runs. */
export function fakeFetch(urls: Partial<Record<keyof typeof UPSTREAM, string>>): (input: string, init: RequestInit) => Promise<Response> {
  return (input, init) => {
    for (const [p, base] of Object.entries(UPSTREAM)) {
      const fake = urls[p as keyof typeof UPSTREAM];
      if (fake && input.startsWith(base)) return fetch(fake + input.slice(base.length), init);
    }
    throw new Error("E_INTERNAL: no fake upstream for " + new URL(input).host);
  };
}

export interface BatchOptions extends JobInputs {
  plan: PlanRow[];
  runId: string;
  /** The approval record and local ledger; ignored with temp. */
  record?: string;
  ledger?: string;
  temp?: boolean;
  /** The items file a temp record is initialised from. */
  items?: string;
  harbor: string[];
  pinSha256: string;
  pilot?: boolean;
  /** The leak scan's inputs: <pristineDir>/<task>.json holds each task's Pristine listing, and <labelStore>/<task>/canary.txt its canary. */
  custody?: { pristineDir: string; labelStore: string };
  stopFile?: string;
  agentPath?: string;
  concurrency?: number;
  seed?: number;
  pollMs?: number;
  /** How long a real record's leases wait for record-out --confirm; LEASE_CONFIRM_MS when left out. */
  leaseConfirmMs?: number;
  env?: Record<string, string | undefined>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}

export interface BatchResult {
  exit: 0 | 2;
  stop: { code: ReasonCode; message: string } | null;
  launched: string[];
  skipped: string[];
  not_launched: string[];
  leases: Array<{ item: string; lease_id: string; spent_micros: number; unknown_micros: number; cap_stop: string | null }>;
  warnings: string[];
}

interface ItemRun {
  item: string;
  lease_id: string;
  journal: string;
  proxy: MeteringProxy;
  socket: string;
  token: string;
  base: string;
}

/** Initialises a temporary record with the items the plan uses, from the items file, for a dry run. */
export function tempRecord(dir: string, itemsFile: string, used: Set<string>): { record: string; local: LocalLedger } {
  const record = join(dir, "record");
  const items = (JSON.parse(readFileSync(itemsFile, "utf8")) as { items: Array<{ item: string; cap_micros: number }> }).items;
  for (const item of used) {
    const row = items.find((i) => i.item === item);
    if (!row) throw new ControllerError("E_USAGE", "plan item " + item + " is not in " + itemsFile);
    recordApproval(record, { action: "init", item, cap_micros: row.cap_micros, admission: "warn", quotes: [{ words: "dry run on a temporary ledger", by: "decision-routing controller --temp", source: "lanes/decision-routing/host/controller.ts" }] });
  }
  return { record, local: LocalLedger.open(join(dir, "ledger.sqlite")) };
}

/** A plan or an answering step naming an item that items.json marks closed is refused before anything is written or leased. */
export function refuseClosedItems(itemsFile: string, items: readonly string[], what: string): void {
  const rows = (JSON.parse(readFileSync(itemsFile, "utf8")) as { items: Array<{ item: string; closed?: string }> }).items;
  const closed = rows.find((r) => r.closed && items.includes(r.item));
  if (closed) throw new ControllerError("DR_ITEM_CLOSED", "line item " + closed.item + " is closed: " + closed.closed + "; nothing was " + what);
}

/** What a new lease must leave room for: its sessions in flight (CONCURRENCY for a batch), each at its worst case, the per-session allowance. */
export function reserveMicros(sessions = CONCURRENCY): number {
  return sessions * (JSON.parse(readFileSync(join(LANE, "config", "cells.json"), "utf8")) as { limits: { allowance_micros: number } }).limits.allowance_micros;
}

/** The pre-lease reserve check: every item's cap must hold what is committed on it plus reserveMicros(sessions), else DR_RESERVE_STOP. */
export function checkReserve(record: string, items: readonly string[], sessions = CONCURRENCY): void {
  const reserve = reserveMicros(sessions);
  for (const item of items) {
    const state = readItem(record, item);
    if (state.cap_micros !== null && state.cap_micros - state.committed_micros < reserve) {
      throw new ControllerError("DR_RESERVE_STOP", "line item " + item + " has " + usd(Math.max(state.cap_micros - state.committed_micros, 0)) + " left of its " + usd(state.cap_micros) + " cap (" + usd(state.committed_micros) + " committed), under the " + usd(reserve) + " reserve for " + sessions + (sessions === 1 ? " session" : " sessions") + " in flight; nothing was leased or launched, and the projection comes to the Captain");
    }
  }
}

export async function runBatch(o: BatchOptions): Promise<BatchResult> {
  const log = o.log ?? ((l: string) => console.error(l));
  const out = resolve(o.out);
  const stopFile = o.stopFile ?? join(out, "STOP");
  const concurrency = Math.min(o.concurrency ?? CONCURRENCY, CONCURRENCY);
  const env = o.env ?? process.env;
  const warnings: string[] = [];
  const warn = (code: ReasonCode, message: string) => warnings.push(code + ": " + message);
  if (!isTrialNetworkHost(o.proxyHost)) throw new ControllerError("E_USAGE", "the proxy host " + o.proxyHost + " is not a loopback or private IP literal");
  if (!o.temp && !o.custody) throw new ControllerError("E_USAGE", "a live run (no --temp) needs --pristine-dir and --label-store for the leak scan; nothing was leased or launched");
  refuseClosedItems(o.items ?? join(LANE, "config", "items.json"), o.plan.map((r) => r.item), "leased or launched");
  if (existsSync(stopFile)) throw new ControllerError("E_DR_STOPPED", "the stop file " + stopFile + " exists (" + (readFileSync(stopFile, "utf8").trim().split("\n")[0]!.slice(0, 500) || "empty") + "), so nothing was leased or launched; remove it to start the batch");
  const journals = join(out, "journals");
  for (const item of new Set(o.plan.map((r) => r.item))) {
    for (const name of existsSync(journals) ? readdirSync(journals).filter((n) => n === item + ".ndjson" || (n.startsWith(item + ".dead-") && n.endsWith(".ndjson"))) : []) {
      const hit = readLines(join(journals, name)).find((l) => l.kind === "refusal" && l.code === "DR_CUSTODY_HIT");
      if (hit) throw new ControllerError("DR_CUSTODY_HIT", "the journal " + join(journals, name) + " holds a custody hit (meter " + hit.meter_id + "), so nothing was leased or launched; start a new batch only on the Captain's word");
    }
  }
  if (o.temp && !o.fetch) throw new ControllerError("E_USAGE", "--temp needs --fake-upstreams: a temporary ledger skips admission, so its calls must never reach a real provider; nothing was leased or launched");
  if (!existsSync(o.runtimeTarball) || sha256(o.runtimeTarball) !== o.runtimeSha256) throw new ControllerError("E_DR_RUNTIME", "the runtime tarball " + o.runtimeTarball + " is missing or its sha256 is not " + o.runtimeSha256 + "; nothing was leased or launched");
  if (!existsSync(o.pinFile) || sha256(o.pinFile) !== o.pinSha256) throw new ControllerError("E_DR_PIN", "the pin file " + o.pinFile + " is missing or its sha256 is not " + o.pinSha256 + "; nothing was leased or launched");

  const markers = new Map<string, string[]>();
  for (const task of o.custody ? new Set(o.plan.map((r) => r.task)) : []) {
    const listing = join(o.custody!.pristineDir, task + ".json");
    if (!existsSync(listing)) throw new ControllerError("E_USAGE", "task " + task + " has no pristine listing " + listing + ", so its leak-scan markers cannot be built; nothing was leased or launched");
    markers.set(task, taskMarkers(join(o.tasksDir, task), JSON.parse(readFileSync(listing, "utf8")) as Pristine, plantCanary(join(o.custody!.labelStore, task))));
  }

  const order = seededShuffle(o.plan, o.seed ?? SEED);
  const itemNames = [...new Set(order.map((r) => r.item))];
  proxyPort(o.proxyHost, itemNames.length - 1);
  for (const d of ["journals", "jobs", "sessions"]) mkdirSync(join(out, d), { recursive: true });
  if (o.custody) mkdirSync(join(out, "markers"), { recursive: true, mode: 0o700 });
  const scratch = mkdtempSync(join(tmpdir(), "dr-ctl-"));
  const { record, local } = o.temp ? tempRecord(join(out, "temp-ledger"), o.items ?? join(LANE, "config", "items.json"), new Set(itemNames)) : { record: recordPath(o.record, env).path, local: openLocalLedger(ledgerPath(o.ledger, env)) };
  const runs: ItemRun[] = [];
  const result: BatchResult = { exit: 0, stop: null, launched: [], skipped: [], not_launched: [], leases: [], warnings };
  const capStopped = new Set<string>();
  const children = new Map<string, { row: PlanRow; proc: ReturnType<typeof Bun.spawn>; done: Promise<number> }>();
  let stop: BatchResult["stop"] = null;
  const onSignal = () => {
    stop ??= { code: "E_DR_STOPPED", message: "the controller was signalled; running sessions were sent SIGTERM" };
    for (const c of children.values()) c.proc.kill("SIGTERM");
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  try {
    for (const item of itemNames) {
      const journal = join(out, "journals", item + ".ndjson");
      if (existsSync(journal)) {
        const rec = await reconcileJournal(journal, local);
        for (const r of rec.refused) warn(r.code as ReasonCode, "reconciling " + item + "'s reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
        renameSync(journal, join(out, "journals", item + ".dead-" + readdirSync(join(out, "journals")).filter((n) => n.startsWith(item + ".dead-")).length + ".ndjson"));
      }
      const open = readItem(record, item).open;
      if (open && open.run_id === o.runId && local.getLease(open.lease_id)) settleLease(record, local, open.lease_id, warn);
    }
    checkReserve(record, itemNames);
    const reserved = o.proxyHost === "localhost" || o.proxyHost === "::1" || o.proxyHost.startsWith("127.") ? null : reservedPorts();
    checkProxyListeners([], listeningPorts(), reserved);
    for (const item of itemNames) {
      const journal = join(out, "journals", item + ".ndjson");
      const lease = openLease(record, local, { item, run_id: o.runId, warn, ...(o.temp ? { requireAdmission: () => null } : {}) });
      const socket = join(scratch, runs.length + ".sock");
      const token = randomBytes(24).toString("hex");
      const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: o.proxyHost, port: proxyPort(o.proxyHost, runs.length), managementSocket: socket, managementToken: token, journal, retry: RETRY, env, fetch: o.fetch, maxOutputTokens: MAX_OUTPUT_TOKENS, allowanceCode: "DR_ALLOWANCE_STOP" });
      try {
        proxy.start();
      } catch (e) {
        settleLease(record, local, lease.lease_id, warn);
        throw e;
      }
      const base = "http://" + (o.proxyHost.includes(":") ? "[" + o.proxyHost + "]" : o.proxyHost) + ":" + proxy.port;
      runs.push({ item, lease_id: lease.lease_id, journal, proxy, socket, token, base });
      log("lease " + lease.lease_id + " on " + item + ": " + usd(lease.reserved_micros) + ", proxy " + base);
    }
    checkProxyListeners(runs.map((r) => r.proxy.port), listeningPorts(), reserved);
    if (!o.temp) {
      log("waiting for vm.sh record-out --confirm " + out + " to show lease " + runs.map((r) => r.lease_id).join(", ") + " open in the drive");
      await awaitLeaseConfirmed(out, runs.map((r) => r.lease_id), o.leaseConfirmMs ?? LEASE_CONFIRM_MS, o.pollMs ?? 5000, () => stop !== null);
    }

    const launchedBefore = (r: PlanRow) => existsSync(join(out, "jobs", sessionId(r) + ".json"));
    const queue = order.filter((r) => !launchedBefore(r));
    result.skipped = order.filter(launchedBefore).map(sessionId);

    const sessionOf = (item: string, cell: Line | undefined) => {
      const row = o.plan.find((p) => p.item === item && p.cell === cell?.arm && p.model === cell?.model && (p.task === cell?.task || String(cell?.task).startsWith(basename(p.task) + "__")));
      return row ? sessionId(row) : "with cell " + JSON.stringify(cell ?? null);
    };
    const stopWith = (code: ReasonCode, message: string) => {
      writeFileSync(stopFile, code + ": " + message + "\n");
      return { code, message };
    };
    const checkStops = (): BatchResult["stop"] => {
      if (existsSync(stopFile)) return { code: "E_DR_STOPPED", message: "the stop file " + stopFile + " appeared" };
      for (const r of runs) {
        const lines = readLines(r.journal);
        const hit = lines.find((l) => l.kind === "refusal" && l.code === "DR_CUSTODY_HIT");
        if (hit) {
          const marks = ((hit.markers ?? []) as Line[]).map((m) => "marker " + m.index + " (sha256 " + m.sha256 + ")").join(", ");
          const message = "session " + sessionOf(r.item, hit.cell) + " (meter " + hit.meter_id + ") on " + r.item + " sent runner-only content: " + marks + "; running sessions finish and nothing new launches";
          log("DR_CUSTODY_HIT: " + message);
          return stopWith("DR_CUSTODY_HIT", message);
        }
        const cap = lines.find((l) => l.kind === "refusal" && l.code === "CAP_STOP");
        if (cap) {
          capStopped.add(r.item);
          return { code: "CAP_STOP", message: "line item " + r.item + " (lease " + r.lease_id + ") refused a reservation: " + cap.reason };
        }
        if (!o.pilot) continue;
        for (const [meter, micros] of meterSpend(lines)) if (micros > PILOT_SESSION_STOP_MICROS) return stopWith("DR_PILOT_SESSION_STOP", "pilot session " + sessionOf(r.item, lines.find((l) => l.kind === "request" && l.cell?.meter_id === meter)?.cell) + " (meter " + meter + ") on " + r.item + " reached " + usd(micros) + ", past " + usd(PILOT_SESSION_STOP_MICROS));
      }
      return null;
    };

    const launch = (row: PlanRow) => {
      const id = sessionId(row);
      const run = runs.find((r) => r.item === row.item)!;
      const jobPath = join(out, "jobs", id + ".json");
      const markersFile = o.custody ? join(out, "markers", id + ".json") : undefined;
      if (markersFile) {
        writeFileSync(markersFile, JSON.stringify(markers.get(row.task)) + "\n", { mode: 0o600 });
        chmodSync(markersFile, 0o600);
      }
      writeFileSync(jobPath, JSON.stringify(harborJob(row, { ...o, out }, markersFile), null, 2) + "\n");
      mkdirSync(join(out, "sessions", id), { recursive: true });
      const started = new Date().toISOString();
      const logFile = join(out, "sessions", id, "harbor.log");
      const proc = Bun.spawn([...o.harbor, "run", "-c", jobPath], { env: harborEnv(env, run, o.agentPath ?? join(LANE, "agent")), stdout: Bun.file(logFile), stderr: Bun.file(logFile + ".err"), stdin: "ignore" });
      const done = proc.exited.then((code) => {
        writeFileSync(join(out, "sessions", id, "result.json"), JSON.stringify({ session: id, ...row, exit_code: code, started, ended: new Date().toISOString() }) + "\n");
        children.delete(id);
        return code;
      });
      children.set(id, { row, proc, done });
      result.launched.push(id);
      log("launch " + id);
    };

    while (queue.length || children.size) {
      stop ??= checkStops();
      while (!stop && children.size < concurrency) {
        const i = nextRunnable(queue, new Set([...children.values()].map((c) => c.row.task)));
        if (i < 0) break;
        launch(queue.splice(i, 1)[0]!);
      }
      if (!children.size) break;
      await Promise.race([...[...children.values()].map((c) => c.done), Bun.sleep(o.pollMs ?? 5000)]);
    }
    stop ??= checkStops();
    result.not_launched = queue.map(sessionId);
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    for (const r of runs) {
      r.proxy.stop();
      try {
        const rec = await reconcileJournal(r.journal, local);
        for (const x of rec.refused) warn(x.code as ReasonCode, "settling " + r.item + "'s reservation " + (x.reservation_id ?? "(a lost reserve)") + " was refused: " + x.message);
        const close = settleLease(record, local, r.lease_id, warn, capStopped.has(r.item) ? "batch " + o.runId : undefined);
        result.leases.push({ item: r.item, lease_id: r.lease_id, spent_micros: close.spent_micros, unknown_micros: close.unknown_micros, cap_stop: close.cap_stop ?? null });
      } catch (e) {
        warn("E_LEASE_UNSETTLED", "lease " + r.lease_id + " on " + r.item + " was not settled: " + (e as Error).message + "; settle it with gstack-evals ledger settle --lease " + r.lease_id);
      }
    }
    local.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  result.stop = stop;
  result.exit = stop ? 2 : 0;
  writeFileSync(join(out, "batch.json"), JSON.stringify({ run_id: o.runId, seed: o.seed ?? SEED, pilot: !!o.pilot, temp: !!o.temp, record, ...result }, null, 2) + "\n");
  return result;
}

const FLAGS = new Set(["--plan", "--out", "--run-id", "--record", "--ledger", "--items", "--harbor", "--tasks-dir", "--proxy-host", "--runtime-tarball", "--runtime-sha256", "--pin-file", "--pin-sha256", "--stop-file", "--agent-path", "--fake-upstreams", "--concurrency", "--pristine-dir", "--label-store"]);
const SWITCHES = new Set(["--temp", "--pilot"]);
const USAGE = "usage: controller.ts --plan <plan.json> --out <dir> --run-id <id> --tasks-dir <dir> --runtime-tarball <tgz> --runtime-sha256 <hex> --pin-file <pin.json> --pin-sha256 <hex> [--pristine-dir <dir> --label-store <dir>] [--record <dir> --ledger <sqlite> | --temp [--items <items.json>]] [--harbor <command>] [--proxy-host <ip>] [--pilot] [--stop-file <path>] [--agent-path <dir>] [--fake-upstreams <urls.json>] [--concurrency <n, at most 6>]";

export async function main(argv: string[]): Promise<number> {
  const f: Record<string, string> = {};
  const on = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (SWITCHES.has(a)) on.add(a);
    else if (FLAGS.has(a) && argv[i + 1] !== undefined) f[a] = argv[++i]!;
    else {
      console.error("E_USAGE: unknown or incomplete argument " + a + "\n" + USAGE);
      return 2;
    }
  }
  const missing = ["--plan", "--out", "--run-id", "--tasks-dir", "--runtime-tarball", "--runtime-sha256", "--pin-file", "--pin-sha256", ...(f["--pristine-dir"] || f["--label-store"] ? ["--pristine-dir", "--label-store"] : [])].filter((k) => !f[k]);
  if (missing.length) {
    console.error("E_USAGE: missing " + missing.join(", ") + "\n" + USAGE);
    return 2;
  }
  try {
    const result = await runBatch({
      plan: parsePlan(readFileSync(f["--plan"]!, "utf8")),
      out: f["--out"]!,
      runId: f["--run-id"]!,
      tasksDir: resolve(f["--tasks-dir"]!),
      runtimeTarball: resolve(f["--runtime-tarball"]!),
      runtimeSha256: f["--runtime-sha256"]!,
      pinFile: resolve(f["--pin-file"]!),
      pinSha256: f["--pin-sha256"]!,
      record: f["--record"],
      ledger: f["--ledger"],
      temp: on.has("--temp"),
      items: f["--items"],
      harbor: (f["--harbor"] ?? "harbor").split(/\s+/).filter(Boolean),
      proxyHost: f["--proxy-host"] ?? "127.0.0.1",
      pilot: on.has("--pilot"),
      custody: f["--pristine-dir"] ? { pristineDir: resolve(f["--pristine-dir"]), labelStore: resolve(f["--label-store"]!) } : undefined,
      stopFile: f["--stop-file"],
      agentPath: f["--agent-path"] ? resolve(f["--agent-path"]) : undefined,
      concurrency: f["--concurrency"] ? Number(f["--concurrency"]) : undefined,
      fetch: f["--fake-upstreams"] ? fakeFetch(JSON.parse(readFileSync(f["--fake-upstreams"], "utf8"))) : undefined,
    });
    for (const w of result.warnings) console.error(w);
    if (result.stop) console.error(result.stop.code + ": " + result.stop.message + "; " + result.launched.length + " sessions launched, " + result.not_launched.length + " not launched; every lease is settled (" + join(resolve(f["--out"]!), "batch.json") + ")");
    else console.log("batch done: " + result.launched.length + " sessions launched, " + result.skipped.length + " skipped as launched before; " + join(resolve(f["--out"]!), "batch.json"));
    return result.exit;
  } catch (e) {
    if (e instanceof LedgerError) console.error(e.code + ": " + e.message);
    else if (e instanceof ControllerError) console.error(e.message);
    else console.error("E_INTERNAL: decision-routing controller: " + (e as Error).message);
    return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

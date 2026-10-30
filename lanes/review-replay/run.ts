#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// Rebuilt from GSTA-131's scratch review replay runner, run.ts in the org drive at handoffs/gsta131-review-replay/run.ts
// (sha256 a6dba8627c957ffac0678e41c3b7db00ecc3240b060a3a9cbb1e8635cab5fd5f). GSTA-131 wrote the panel and its effort
// arms; this runner keeps its shape (one prompt per item, effort as an arm, a reply file per item) on the metering proxy
// and the program ledger (plan v3.2, "Review replay lane", "Runner changes on vendoring" and requirement 4).
// Changes from GSTA-131:
// - Calls go through an in-process MeteringProxy, one slot per item; the runner sends no key and keeps none in a file.
// - The cap is a lease on a ledger line item, not EVAL_CAP in memory. Each call reserves its real maximum: the request
//   sets the route's output-cap field to the plan's max_output_tokens, where GSTA-131 reserved half the output.
// - Items come from a plan (replay-plan.ts) whose prompts and preregistration match their frozen sha256 before any spend,
//   and --dry-run prints each item's worst case. Models are any the policy file allows as subjects, not Opus alone.
// - No retries. An unknown outcome keeps its charge and is never resent, and the runner never classes an item infra.
// - Each terminal item writes a durable outcome with its typed Termination (outcome.ts); a stop writes none, so a resume
//   runs that item. Failures go to stderr and --json with Lane A's exit codes, STOP line and error record, never exit 0.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REPO_ROOT, type Io } from "../../src/cli.ts";
import { CODES, type ReasonCode } from "../../src/errors/codes.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger, type LocalLedger } from "../../src/runner/ledger/local.ts";
import { usd } from "../../src/runner/ledger/money.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { chatPrice, openRouterRouting, priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, UPSTREAM_DEADLINE_MS } from "../../src/runner/proxy/metering-proxy.ts";
import { DEFAULT_POLICY, type PolicyProvider } from "../../src/skill-eval/cli/policy.ts";
import { errorLines, errorRecord, writeAtomic, writeErrorRecord } from "../../src/skill-eval/verdict/error-record.ts";
import type { CallOutcome, ErrorContext, Termination, TokenUsage } from "../../src/types.ts";
import { readReply, requestFor, type Reading } from "./outcome.ts";
import { checkModels, KEY_ENV, loadPlan, ReplayError, type PlanItem } from "./replay-plan.ts";

export const USAGE = "bun lanes/review-replay/run.ts --plan <plan.json> --out <dir> --item <ledger line item> [--resume] [--dry-run] [--json] [--concurrency <n>] [--policy <models.json>] [--ledger <path>] [--ledger-record <dir>]";

export interface ReplayOptions {
  plan: string;
  out: string;
  item: string;
  resume?: boolean;
  dryRun?: boolean;
  json?: boolean;
  /** Items in flight at once; defaults to 4, as GSTA-131 ran. */
  concurrency?: number;
  policy?: string;
  ledger?: string;
  ledgerRecord?: string;
  /** Where provider keys and ledger paths come from (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** The proxy's upstream fetch; tests pass a fake provider. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  io?: Io;
}

/** <out>/run.json: the run's id, its plan's digest and its current lease. */
interface RunFile {
  schema_version: 1;
  run_id: string;
  plan_name: string;
  plan_sha256: string;
  line_item: string;
  lease_id: string;
  created_at: string;
}

/** <out>/items/<id>.intent.json, fsynced before the send: the meter a crashed send is found by. */
interface Intent {
  id: string;
  run_id: string;
  lease_id: string;
  meter_id: string;
  prompt_sha256: string;
  sent_at: string;
}

/** <out>/items/<id>.json, written once, for a terminal outcome only: completed, arm_failure, missing or unknown. */
export interface ItemRecord extends Omit<Reading, "termination" | "stop"> {
  schema_version: 1;
  id: string;
  case: string;
  role: PlanItem["role"];
  arm: string;
  model: string;
  provider: PolicyProvider;
  effort: string | null;
  trial: number;
  prompt_sha256: string;
  prereg_sha256: string;
  run_id: string;
  lease_id: string;
  meter_id: string;
  reservation_ids: string[];
  termination: Termination;
  http_status: number | null;
  /** From the journal's outcome lines; an unknown outcome counts at its full reservation. */
  priced_usage: TokenUsage | null;
  spent_micros: number;
  spend_known: boolean;
  ms: number | null;
}

interface Call {
  reservation_id: string;
  max_micros: number;
  status: number | null;
  outcome: CallOutcome | null;
}

type Stop = { code: ReasonCode; message: string; model: string | null };

/** The paid calls the journal holds for one meter, with their outcomes. */
function journalCalls(journal: string, meterId: string): Call[] {
  const calls: Call[] = [];
  if (!existsSync(journal)) return calls;
  for (const line of readFileSync(journal, "utf8").split("\n")) {
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.kind === "request" && e.cell?.meter_id === meterId) calls.push({ reservation_id: e.reservation_id, max_micros: e.max_micros, status: null, outcome: null });
    const call = e.kind === "outcome" && e.meter_id === meterId ? calls.find((c) => c.reservation_id === e.reservation_id) : undefined;
    if (call) Object.assign(call, { status: e.status, outcome: e.outcome });
  }
  return calls;
}

function spendOf(calls: Call[]): Pick<ItemRecord, "priced_usage" | "spent_micros" | "spend_known" | "reservation_ids"> {
  const priced = calls.findLast((c) => c.outcome?.kind === "spent")?.outcome;
  return {
    reservation_ids: calls.map((c) => c.reservation_id),
    priced_usage: priced?.kind === "spent" ? priced.usage : null,
    spent_micros: calls.reduce((n, c) => n + (c.outcome?.kind === "spent" ? c.outcome.spent_micros : c.max_micros), 0),
    spend_known: calls.every((c) => c.outcome?.kind === "spent"),
  };
}

/** Writes and fsyncs a JSON file aside, then moves it into place: linked once (an outcome), or renamed over (an intent). */
function writeDurable(path: string, value: unknown, once: boolean): void {
  const tmp = path + ".tmp-" + process.pid;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (!once) return renameSync(tmp, path);
  try {
    linkSync(tmp, path);
  } finally {
    unlinkSync(tmp);
  }
}

const codeOf = (e: unknown): ReasonCode => {
  if (e instanceof ReplayError || e instanceof LedgerError) return e.code;
  const named = /^([A-Z][A-Z0-9_]+):/.exec(e instanceof Error ? e.message : "")?.[1];
  return named && Object.hasOwn(CODES, named) ? (named as ReasonCode) : "E_INTERNAL";
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[A-Z][A-Z0-9_]+: /, "");
const kindText = (t: Termination) => t.kind + (t.kind === "arm_failure" ? " " + t.failure : t.kind === "missing" ? " " + t.code : "");

/** The body the proxy prices: it adds these fields before it reserves, so the dry run's worst case is never under the proxy's. */
function asProxied(provider: PolicyProvider, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === "anthropic") return { ...body, inference_geo: "global" };
  if (provider === "openai") return { ...body, service_tier: "default" };
  return { ...body, provider: openRouterRouting(chatPrice("openrouter:" + body.model)!) };
}

/** Lane A's STOP line, from the line item's record after the lease is settled. */
function stopLine(record: string, item: string): string {
  const state = readItem(record, item);
  const closes = state.leases.flatMap((l) => (l.close ? [l.close] : []));
  return "STOP: reason=budget_exhausted spent=" + usd(closes.reduce((n, c) => n + c.spent_micros, 0)) + " reserved=" + usd(state.committed_micros) + " unknown=" + closes.reduce((n, c) => n + c.unknown_calls, 0) + " cap=" + usd(state.cap_micros ?? 0);
}

function version(): string {
  try {
    return readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

/** Runs a replay plan: exit 0 when every item has a durable outcome, arm failures included; exit 2 for every stop. */
export async function runReplay(o: ReplayOptions): Promise<number> {
  const io = o.io ?? { out: console.log, err: console.error };
  const env = o.env ?? process.env;
  const out = resolve(o.out);
  const context: ErrorContext = { resource_ids: { out }, gstack_evals_version: version(), host: null, host_version: null, image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: [] };
  const fail = (stop: Stop): number => {
    const code = CODES[stop.code]?.exit ? stop.code : "E_INTERNAL";
    const record = errorRecord({ code, operation: "review replay", message: "review replay: " + stop.message, model: stop.model, context }, env);
    for (const line of errorLines(record)) io.err(line);
    if (o.json) writeErrorRecord(o.dryRun ? null : out, record, io.out);
    return 2;
  };
  const failWith = (e: unknown, model: string | null = null) => fail({ code: codeOf(e), message: messageOf(e), model });
  const warn = (code: ReasonCode, message: string) => io.err(code + ": review replay: " + message);

  let loaded: ReturnType<typeof loadPlan>;
  let providers: Map<string, PolicyProvider>;
  try {
    loaded = loadPlan(o.plan);
    const checked = checkModels(loaded.plan, o.policy ?? DEFAULT_POLICY, env);
    providers = checked.providers;
    context.policy_sha256 = checked.policy_sha256;
    context.env_names = [...new Set([...providers.values()].map((p) => KEY_ENV[p]))];
  } catch (e) {
    return failWith(e);
  }
  const { plan } = loaded;
  const sends = plan.items.map((item) => {
    const provider = providers.get(item.model)!;
    return { item, provider, ...requestFor(provider, item.model, loaded.prompts.get(item.id)!, item.effort, plan.max_output_tokens) };
  });

  if (o.dryRun) {
    let worst: number[];
    try {
      worst = sends.map((s) => reservationMicros(priceRequest(s.provider, asProxied(s.provider, s.body), plan.max_output_tokens)));
    } catch (e) {
      return failWith(e);
    }
    const total = worst.reduce((a, b) => a + b, 0);
    if (o.json) io.out(JSON.stringify({ dry_run: true, plan: plan.name, items: sends.map((s, i) => ({ id: s.item.id, model: s.provider + ":" + s.item.model, worst_micros: worst[i] })), total_micros: total }));
    else for (const line of [...sends.map((s, i) => s.item.id + "  " + s.provider + ":" + s.item.model + "  worst case " + usd(worst[i]!)), "total worst case " + usd(total) + " for " + sends.length + " items; nothing was sent or recorded"]) io.out(line);
    return 0;
  }

  const runPath = join(out, "run.json");
  const itemsDir = join(out, "items");
  const journal = join(out, "journal.ndjson");
  let prior: RunFile | null = null;
  if (o.resume) {
    if (!existsSync(runPath)) return fail({ code: "E_USAGE", message: "--resume needs a run in " + out + ", and it holds no run.json", model: null });
    prior = JSON.parse(readFileSync(runPath, "utf8")) as RunFile;
    if (prior.plan_sha256 !== loaded.sha256) return fail({ code: "E_REPLAY_PLAN", message: "the plan " + o.plan + " has sha256 " + loaded.sha256 + ", but run " + prior.run_id + " ran plan " + prior.plan_sha256 + "; a resume never runs a changed plan", model: null });
    if (prior.line_item !== o.item) return fail({ code: "E_USAGE", message: "run " + prior.run_id + " spends from line item " + prior.line_item + ", not " + o.item, model: null });
  } else if (existsSync(runPath)) return fail({ code: "E_USAGE", message: out + " already holds a run (run.json); use --resume to continue it", model: null });
  const runId = prior?.run_id ?? "replay-" + randomBytes(6).toString("hex");
  context.resource_ids = { out, run_id: runId };

  const records = new Map<string, ItemRecord>();
  for (const { item } of sends) {
    const path = join(itemsDir, item.id + ".json");
    if (!existsSync(path)) continue;
    const recorded = JSON.parse(readFileSync(path, "utf8")) as ItemRecord;
    if (recorded.prompt_sha256 !== item.prompt.sha256) return fail({ code: "E_REPLAY_PLAN", message: "item " + item.id + " was recorded with prompt sha256 " + recorded.prompt_sha256 + ", but the plan assigns " + item.prompt.sha256, model: item.model });
    records.set(item.id, recorded);
  }

  const ledgerAt = ledgerPath(o.ledger, env);
  const record = recordPath(o.ledgerRecord, env).path;
  Object.assign(context, { ledger: ledgerAt.path, ledger_record: record });
  let local: LocalLedger;
  try {
    local = openLocalLedger(ledgerAt);
  } catch (e) {
    return failWith(e);
  }
  try {
    return await spend();
  } finally {
    local.close();
  }

  async function spend(): Promise<number> {
    if (prior && existsSync(journal)) {
      try {
        const reconciled = await reconcileJournal(journal, local);
        for (const r of reconciled.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      } catch (e) {
        return failWith(e);
      }
      for (const s of sends) {
        const intentPath = join(itemsDir, s.item.id + ".intent.json");
        if (records.has(s.item.id) || !existsSync(intentPath)) continue;
        const intent = JSON.parse(readFileSync(intentPath, "utf8")) as Intent;
        const calls = journalCalls(journal, intent.meter_id);
        if (!calls.length) continue;
        const reading = { reason: "the run ended after this item's send was journaled and before its outcome was recorded; it keeps its charge and is never resent", stop_reason: null, truncated: false, cut_off: false, text: null, usage: null };
        save(s, intent.lease_id, intent.meter_id, { kind: "unknown", reservation_id: calls.at(-1)!.reservation_id }, reading, calls, null);
      }
    }
    const queue = sends.filter((s) => !records.has(s.item.id));
    if (!queue.length) {
      try {
        const held = prior ? local.getLease(prior.lease_id) : null;
        if (held && (held.state === "open" || held.state === "closing")) settleLease(record, local, prior!.lease_id, warn);
      } catch (e) {
        return failWith(e);
      }
      return finish(null);
    }

    let lease: { lease_id: string; reserved_micros: number };
    let reused = false;
    try {
      const held = prior ? local.getLease(prior.lease_id) : null;
      if (held?.state === "open" && new Date() < new Date(held.file.expires_at)) {
        lease = held.file;
        reused = true;
      } else {
        if (held && (held.state === "open" || held.state === "closing")) settleLease(record, local, prior!.lease_id, warn);
        lease = openLease(record, local, { item: o.item, run_id: runId, warn });
        mkdirSync(itemsDir, { recursive: true });
        writeAtomic(runPath, { schema_version: 1, run_id: runId, plan_name: plan.name, plan_sha256: loaded.sha256, line_item: o.item, lease_id: lease.lease_id, created_at: prior?.created_at ?? new Date().toISOString() } satisfies RunFile);
      }
    } catch (e) {
      if (codeOf(e) === "CAP_STOP" && !o.json) io.out(stopLine(record, o.item));
      return failWith(e);
    }
    context.resource_ids = { out, run_id: runId, lease_id: lease.lease_id };

    const proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "gse-replay-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: { attempts: 1, elapsed_ms: UPSTREAM_DEADLINE_MS }, env, fetch: o.fetch, maxOutputTokens: plan.max_output_tokens });
    try {
      proxy.start();
    } catch (e) {
      if (!reused) settleLease(record, local, lease.lease_id, warn);
      return failWith(e);
    }

    let stop: Stop | null = null;
    const runItem = async (s: (typeof sends)[number]) => {
      const { item, provider } = s;
      const binding = proxy.bind({ cell: { run_id: runId, arm: item.arm, task: item.case, model: item.model, trial: item.trial, attempt: 1 }, models: [provider + ":" + item.model], allowance_micros: lease.reserved_micros });
      const intentPath = join(itemsDir, item.id + ".intent.json");
      writeDurable(intentPath, { id: item.id, run_id: runId, lease_id: lease.lease_id, meter_id: binding.meter_id, prompt_sha256: item.prompt.sha256, sent_at: new Date().toISOString() } satisfies Intent, false);
      const started = Date.now();
      let res: Response;
      let body: string;
      let unknown: number;
      try {
        res = await fetch("http://127.0.0.1:" + proxy.port + "/" + binding.slot + "/" + provider + s.route, { method: "POST", headers: { authorization: "Bearer " + binding.token, "content-type": "application/json" }, body: JSON.stringify(s.body) });
        body = await res.text();
      } finally {
        unknown = (await proxy.finalize(binding.meter_id)).unknown;
        proxy.unbind(binding.slot);
      }
      const ms = Date.now() - started;
      const calls = journalCalls(journal, binding.meter_id);
      let reading: Reading;
      let status: number | null = res.status;
      if ((res.headers.get("content-type") ?? "").includes("application/problem+json")) {
        const refusal = JSON.parse(body) as { code?: string; detail?: string };
        const code = refusal.code && Object.hasOwn(CODES, refusal.code) ? (refusal.code as ReasonCode) : "E_INTERNAL";
        const lost: Termination | null = unknown ? { kind: "unknown", reservation_id: calls.at(-1)!.reservation_id } : null;
        const termination = code === "UPSTREAM" ? (lost ?? { kind: "missing", code: "E_REPLAY_TRANSPORT" as const }) : lost;
        status = calls.at(-1)?.status ?? null;
        reading = { termination, stop: code === "UPSTREAM" ? "E_REPLAY_TRANSPORT" : code, reason: refusal.detail ?? "the metering proxy refused the call", stop_reason: null, truncated: false, cut_off: false, text: null, usage: null };
      } else reading = readReply(provider, item.model, res.status, body, plan.cut_off.min_visible_chars, calls.length > 0 && spendOf(calls).spend_known);
      if (reading.stop) stop ??= { code: reading.stop, message: "item " + item.id + " (" + provider + ":" + item.model + "): " + reading.reason, model: item.model };
      if (!reading.termination) {
        rmSync(intentPath, { force: true });
        io.err(item.id + ": no outcome recorded; the run stops with " + reading.stop);
        return;
      }
      save(s, lease.lease_id, binding.meter_id, reading.termination, reading, calls, ms, status);
      rmSync(intentPath, { force: true });
    };
    const workers = Array.from({ length: Math.min(o.concurrency ?? 4, queue.length) }, async () => {
      while (!stop && queue.length) {
        const s = queue.shift()!;
        try {
          await runItem(s);
        } catch (e) {
          stop ??= { code: "E_INTERNAL", message: "item " + s.item.id + ": " + messageOf(e), model: s.item.model };
        }
      }
    });
    await Promise.all(workers);
    proxy.stop();
    try {
      const reconciled = await reconcileJournal(journal, local);
      for (const r of reconciled.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      settleLease(record, local, lease.lease_id, warn);
    } catch (e) {
      stop ??= { code: codeOf(e), message: "settling lease " + lease.lease_id + ": " + messageOf(e), model: null };
    }
    return finish(stop);
  }

  function save(s: (typeof sends)[number], leaseId: string, meterId: string, termination: Termination, reading: Omit<Reading, "termination" | "stop">, calls: Call[], ms: number | null, status: number | null = null): void {
    const { item, provider } = s;
    const { reason, stop_reason, truncated, cut_off, text, usage } = reading;
    const saved: ItemRecord = { schema_version: 1, id: item.id, case: item.case, role: item.role, arm: item.arm, model: item.model, provider, effort: item.effort, trial: item.trial, prompt_sha256: item.prompt.sha256, prereg_sha256: plan.prereg.sha256, run_id: runId, lease_id: leaseId, meter_id: meterId, termination, reason, http_status: status, stop_reason, truncated, cut_off, text, usage, ...spendOf(calls), ms };
    writeDurable(join(itemsDir, item.id + ".json"), saved, true);
    records.set(item.id, saved);
    io.err(item.id + ": " + kindText(termination) + ", " + usd(saved.spent_micros) + (saved.spend_known ? "" : " held, spend unknown"));
  }

  function finish(stop: Stop | null): number {
    const all = [...records.values()];
    const counts = { completed: 0, arm_failure: 0, missing: 0, unknown: 0, pending: sends.length - all.length };
    for (const r of all) counts[r.termination.kind as keyof typeof counts]++;
    const spent = all.filter((r) => r.spend_known).reduce((n, r) => n + r.spent_micros, 0);
    const held = all.filter((r) => !r.spend_known).reduce((n, r) => n + r.spent_micros, 0);
    const state = stop ? "stopped" : "finished";
    if (o.json) io.out(JSON.stringify({ schema_version: 1, plan: plan.name, run_id: runId, state, stop: stop?.code ?? null, counts, spent_micros: spent, unknown_micros: held, out }));
    else {
      if (stop?.code === "CAP_STOP") io.out(stopLine(record, o.item));
      io.out("review replay " + plan.name + ": " + state + (stop ? " (" + stop.code + ")" : "") + ", run " + runId);
      io.out("items: " + Object.entries(counts).map(([k, n]) => k + " " + n).join(", "));
      io.out("spend: " + usd(spent) + " known, " + usd(held) + " held for unknown outcomes");
    }
    return stop ? fail(stop) : 0;
  }
}

const VALUE_FLAGS: Record<string, keyof ReplayOptions> = { "--plan": "plan", "--out": "out", "--item": "item", "--concurrency": "concurrency", "--policy": "policy", "--ledger": "ledger", "--ledger-record": "ledgerRecord" };
const BOOLEAN_FLAGS: Record<string, keyof ReplayOptions> = { "--resume": "resume", "--dry-run": "dryRun", "--json": "json" };

export async function main(argv: string[]): Promise<number> {
  const options: Record<string, unknown> = {};
  const usage = (message: string) => (console.error("E_USAGE: review replay: " + message), console.error("E_USAGE usage: " + USAGE), 2);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (BOOLEAN_FLAGS[flag]) options[BOOLEAN_FLAGS[flag]] = true;
    else if (VALUE_FLAGS[flag] && argv[i + 1] !== undefined) options[VALUE_FLAGS[flag]] = argv[++i];
    else return usage("unknown flag or missing value: " + flag);
  }
  for (const flag of ["--plan", "--out", "--item"]) if (!options[VALUE_FLAGS[flag]!]) return usage(flag + " is required");
  if (options.concurrency !== undefined) {
    const n = Number(options.concurrency);
    if (!Number.isSafeInteger(n) || n < 1) return usage("--concurrency must be a positive integer");
    options.concurrency = n;
  }
  return runReplay(options as unknown as ReplayOptions);
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

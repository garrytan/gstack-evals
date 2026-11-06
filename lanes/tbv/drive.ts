// Copyright (c) 2026 Garry Tan. MIT License.
// The report driver (prereg sections 3 and 6, amendment items 12, 13 and 17): one item run on a lease through the
// in-process metering proxy, three turns per reading in the frozen caching order, the driver as the only retry owner.
// The proxy never retries ({attempts: 1}); each retry is the driver's own send with its own reservation. The proxy
// journal is the start log: a reading with a reserve line and no sealed record at restart is a crash gap.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { openLease, settleLease } from "../../src/runner/ledger/ledger.ts";
import { openLocalLedger } from "../../src/runner/ledger/local.ts";
import { ledgerPath, recordPath } from "../../src/runner/ledger/paths.ts";
import { LedgerError, readItem } from "../../src/runner/ledger/record.ts";
import { chatPrice, priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../src/runner/proxy/metering-proxy.ts";
import { rigAdmission } from "../../src/rig/admission.ts";
import type { TokenUsage } from "../../src/types.ts";
import { leftover, openVault, plaintextRoot } from "./custody.ts";
import { fail, TbvError } from "./errors.ts";
import { buildRequest, MAX_TOKENS, validateRequest } from "./request.ts";
import { armSend, JUDGE_MAX_TOKENS, routeKey } from "./routes.ts";
import { endState, readingWorst, RETRIES, ROUND, roundAdmits, SENDS, WORST_INPUT } from "./rule.ts";
import { fillShape } from "./shape.ts";
import { closerHolds } from "./splice.ts";
import { ARM_MODELS, BUNDLE, type Arm, type AttemptKind, type BuildInput, type BuiltRequest, type Family, type History, type Io, type ItemRun, type ItemRunOptions, type Model, type ReadingRecord, type Reply, type SendRequest, type SendResult, type Shape, type Slot, type SpliceSet, type Turn, type Turns, type Validation } from "./types.ts";

/** The proxy's retry budget: one attempt, so the driver owns every retry. */
export const RETRY: RetryBudget = { attempts: 1, elapsed_ms: 900_000 };
/** Amendment item 13: after PAUSE_AFTER transport failures in a row on a route, no new reservation there for PAUSE_MS, then one send; after MAX_WAITS such waits with no success, an outage stop. */
export const PAUSE_AFTER = 3, PAUSE_MS = 600_000, MAX_WAITS = 6;
/** The proxy's output cap: the largest any tbv request states (a judge's first or control packet). */
export const OUTPUT_CAP = Math.max(MAX_TOKENS, ...Object.values(JUDGE_MAX_TOKENS));
/** Bytes each later turn may add to a reading's request: a reply at max_tokens, JSON-escaped, and a user turn. */
const GROWTH_BYTES = MAX_TOKENS * 16 + 4096;
/** Bytes the proxy may add to a body before it prices it (OpenRouter's provider object, inference_geo). */
const PROXY_BYTES = 2048;
const TRANSPORT = new Set<AttemptKind>(["5xx", "timeout", "broken-stream", "truncated", "no-final"]);
const ENDS = new Set<AttemptKind>(["budget", "4xx", "validator", "closer", "size", "outage"]);
const textual = (k: AttemptKind) => k === "text" || k === "max-tokens";

export interface DriveSlot extends Slot {
  send(req: SendRequest): Promise<SendResult & { micros: number | null }>;
}
export interface DriveItemRun extends ItemRun {
  journal: string;
  out: string;
  warnings: string[];
  slot(label: string, models: string[], allowanceMicros: number): DriveSlot;
  /** Labels of every slot that reserved a send, in this run's journal and the dead runs' journals beside it. */
  startedLabels(): Set<string>;
  /** Spend held by a label's sends across the item's leases, counted as spend checks count it. */
  labelMicros(label: string): number;
  /** Checks each send against its OpenRouter generation record and releases those it shows were not billed. Returns the released idempotency keys, and the first response id with no generation record for it (a non-200 lookup or a record for another id), where checking stops: that send keeps its full reservation and the item stops. */
  release(sends: Array<{ idempotencyKey: string; responseId: string }>): Promise<{ released: string[]; missing: string | null }>;
  close(capStop?: string): Promise<{ settled: number; unknown: number }>;
}
export interface DrivePlan {
  item: string;
  tasks: History[];
  arms: Arm[];
  models: Model[];
  passes: Partial<Record<Model, number>>;
  turns: Turns;
  shape: (arm: Arm, model: Model) => Shape;
  splice: (family: Family, arm: Arm) => SpliceSet | null;
  /** One round's worst case in micros; by default rule.ts's: ROUND readings at the costliest model's readingWorst from WORST_INPUT. */
  roundWorstMicros?: number;
}
export interface DriveDeps {
  build: (input: BuildInput) => BuiltRequest;
  validate: (body: Record<string, unknown>, model: Model) => Validation;
  closer: (body: Record<string, unknown>, splice: SpliceSet) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  seal: (name: string, text: string) => void;
  log: (text: string) => void;
  /** Readings an earlier run of the same run id finished (sealed records, crash gaps included); never sent again. */
  done: ReadingRecord[];
}
export interface DriveResult {
  records: ReadingRecord[];
  stop: { cls: "cap" | "harness" | "outage"; why: string } | null;
  dropped: string[];
}
export interface RunItemOptions extends ItemRunOptions {
  plan: DrivePlan;
  plaintext: string;
  sealCmd: string | null;
  unsealCmd: string | null;
  devPlaintext: boolean;
  held: boolean;
  mounts?: string;
  deps?: Partial<DriveDeps>;
  log: (text: string) => void;
}
type Reading = { task: string; arm: Arm; model: Model; pass: number };
type Attempt = { kind: AttemptKind; turn: Turn };
const keyOf = (r: Reading) => [r.task, r.arm, r.model, r.pass].join("|");

const ledgerStep = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    if (e instanceof LedgerError) fail("E_TBV_RUN", e.code + " " + e.message);
    throw e;
  }
};
const lines = (path: string) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l) as Record<string, any>] : [];
          } catch {
            return [];
          }
        })
    : [];

/** The parts of a provider reply the driver reads, from a stream or a JSON body. */
function readReply(text: string, stream: boolean): { reply: Reply; id: string | null; final: boolean; error: boolean } {
  const blocks: Array<Record<string, any>> = [];
  const partial = new Map<number, string>();
  let id: string | null = null, stop: string | null = null, final = false, error = false;
  if (stream) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      let e: Record<string, any>;
      try {
        e = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (e.type === "message_start") id = e.message?.id ?? null;
      else if (e.type === "content_block_start") blocks[e.index] = { ...e.content_block };
      else if (e.type === "content_block_delta" && blocks[e.index]) {
        if (e.delta?.type === "text_delta") blocks[e.index]!.text = (blocks[e.index]!.text ?? "") + e.delta.text;
        if (e.delta?.type === "input_json_delta") partial.set(e.index, (partial.get(e.index) ?? "") + e.delta.partial_json);
      } else if (e.type === "message_delta") stop = e.delta?.stop_reason ?? stop;
      else if (e.type === "message_stop") final = true;
      else if (e.type === "error") error = true;
    }
    for (const [i, json] of partial) {
      try {
        blocks[i]!.input = JSON.parse(json);
      } catch {
        blocks[i]!.input = {};
      }
    }
  } else {
    let b: Record<string, any> = {};
    try {
      b = JSON.parse(text);
    } catch {}
    id = typeof b.id === "string" ? b.id : null;
    final = true;
    if (Array.isArray(b.content)) {
      blocks.push(...b.content);
      stop = b.stop_reason ?? null;
    } else if (Array.isArray(b.output)) {
      const t = b.output.filter((i: any) => i?.type === "message").flatMap((i: any) => i.content ?? []).filter((c: any) => c?.type === "output_text").map((c: any) => c.text).join("");
      if (t) blocks.push({ type: "text", text: t });
      stop = b.status === "incomplete" && b.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : b.status === "completed" ? "end_turn" : (b.status ?? null);
    } else if (Array.isArray(b.choices)) {
      const t = b.choices[0]?.message?.content;
      if (typeof t === "string" && t) blocks.push({ type: "text", text: t });
      const f = b.choices[0]?.finish_reason;
      stop = f === "length" ? "max_tokens" : f === "stop" ? "end_turn" : (f ?? null);
    } else final = false;
  }
  const content = blocks.filter((x) => x && (x.type === "text" || x.type === "tool_use")).map((x) => (x.type === "text" ? { type: "text" as const, text: String(x.text ?? "") } : { type: "tool_use" as const, id: String(x.id), name: String(x.name), input: x.input ?? {} }));
  return { reply: { text: content.flatMap((x) => (x.type === "text" ? [x.text] : [])).join(""), content, stopReason: stop }, id, final, error };
}

/** One send's class (types.ts AttemptKind) from the proxy's answer. */
function classify(status: number, problemCode: string | null, detail: string, r: ReturnType<typeof readReply> | null, broke: boolean): AttemptKind {
  if (problemCode === "CAP_STOP") return "budget";
  if (problemCode === "E_ALLOWANCE") return "allowance";
  if (problemCode === "UPSTREAM") return /timed? ?out|timeout|deadline/i.test(detail) ? "timeout" : "5xx";
  if (problemCode) return "4xx";
  if (status >= 500) return "5xx";
  if (status !== 200) return "4xx";
  if (broke) return "broken-stream";
  if (!r) return "no-final";
  if (r.error) return "5xx";
  if (!r.final) return r.reply.content.length ? "truncated" : "no-final";
  if (r.reply.stopReason === "refusal") return "refusal";
  if (r.reply.text.trim()) return r.reply.stopReason === "max_tokens" ? "max-tokens" : "text";
  return r.reply.content.some((b) => b.type === "tool_use") ? "tool-only" : "empty";
}

/**
 * One item run: a lease of the item (rig admission, direct proof) and an in-process metering proxy on it. A restart
 * under the same run id reconciles the dead run's journal, settles its open lease, sets the journal aside and leases again.
 */
export async function openItemRun(o: ItemRunOptions): Promise<DriveItemRun> {
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const warnings: string[] = [];
  const warn = (code: ReasonCode, message: string) => warnings.push(code + ": " + message);
  const local = ledgerStep(() => openLocalLedger(ledgerPath(o.ledger, o.env)));
  const journal = join(out, "journal.ndjson");
  let proxy: MeteringProxy;
  let lease: { lease_id: string };
  try {
    if (existsSync(journal)) {
      const rec = await reconcileJournal(journal, local);
      for (const r of rec.refused) warn(r.code as ReasonCode, "reconciling the dead run's reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
      renameSync(journal, join(out, "journal.dead-" + readdirSync(out).filter((n) => n.startsWith("journal.dead-")).length + ".ndjson"));
    }
    const open = ledgerStep(() => readItem(o.record, o.item)).open;
    if (open && open.run_id === o.runId && local.getLease(open.lease_id)) ledgerStep(() => settleLease(o.record, local, open.lease_id, warn));
    lease = ledgerStep(() => openLease(o.record, local, { item: o.item, run_id: o.runId, warn, requireAdmission: rigAdmission({ proof: "direct" }) }));
    proxy = new MeteringProxy({ ledger: local, leaseId: lease.lease_id, host: "127.0.0.1", managementSocket: join(tmpdir(), "tbv-" + randomBytes(6).toString("hex") + ".sock"), managementToken: randomBytes(24).toString("hex"), journal, retry: RETRY, env: o.env, fetch: o.fetch, sleep: o.sleep, maxOutputTokens: OUTPUT_CAP });
    proxy.start();
  } catch (e) {
    if (lease! && !proxy!) ledgerStep(() => settleLease(o.record, local, lease.lease_id, warn));
    local.close();
    throw e;
  }
  const leaseId = lease.lease_id;
  const base = "http://127.0.0.1:" + proxy.port + "/";
  const journals = () => readdirSync(out).filter((n) => /^journal(\.dead-\d+)?\.ndjson$/.test(n)).flatMap((n) => lines(join(out, n)));
  let closed: { settled: number; unknown: number } | null = null;

  const run: DriveItemRun = {
    runId: o.runId,
    leaseId,
    journal,
    out,
    warnings,
    slot(label, models, allowanceMicros) {
      const b = proxy.bind({ cell: { run_id: o.runId, arm: "tbv", task: label, model: models.join(" "), trial: 1, attempt: 1 }, models, allowance_micros: Math.max(1, Math.ceil(allowanceMicros)) });
      const seen = new Set<string>();
      return {
        label,
        async send(req) {
          let status = 0, problemCode: string | null = null, detail = "", body = "", broke = false;
          try {
            const res = await fetch(base + b.slot + "/" + req.provider + req.route, { method: "POST", headers: { authorization: "Bearer " + b.token, "content-type": "application/json" }, body: JSON.stringify(req.body), timeout: false } as RequestInit);
            status = res.status;
            try {
              body = await res.text();
            } catch {
              broke = true;
            }
            if ((res.headers.get("content-type") ?? "").includes("application/problem+json")) {
              try {
                const p = JSON.parse(body) as { code?: string; detail?: string };
                problemCode = p.code ?? "E_INTERNAL";
                detail = p.detail ?? "";
              } catch {
                problemCode = "E_INTERNAL";
              }
            }
          } catch {
            broke = true;
          }
          await proxy.finalize(b.meter_id);
          const parsed = status === 200 && !problemCode ? readReply(body, req.stream) : null;
          const kind = classify(status, problemCode, detail, parsed, broke);
          const now = lines(journal);
          const key = now.filter((l) => l.kind === "reserve" && l.cell?.meter_id === b.meter_id && !seen.has(l.idempotency_key)).at(-1)?.idempotency_key ?? null;
          if (key) seen.add(key);
          const rid = key ? now.find((l) => l.kind === "request" && l.idempotency_key === key)?.reservation_id : undefined;
          const outcome = rid ? now.filter((l) => l.kind === "outcome" && l.reservation_id === rid).at(-1)?.outcome : undefined;
          const spent = outcome?.kind === "spent";
          return { kind, status: status || null, reply: parsed && parsed.final ? parsed.reply : null, responseId: parsed?.id ?? null, idempotencyKey: key, problemCode, usage: spent ? (outcome.usage as TokenUsage) : null, micros: spent ? (outcome.spent_micros as number) : null };
        },
        async micros() {
          return local.meters(leaseId).get(b.meter_id)?.held_micros ?? 0;
        },
        async close() {
          proxy.unbind(b.slot);
        },
      };
    },
    async spend() {
      const meters = [...local.meters(leaseId).values()];
      const now = lines(journal);
      const answered = new Set(now.filter((l) => l.kind === "outcome").map((l) => l.reservation_id));
      const reserved = now.filter((l) => l.kind === "request" && !answered.has(l.reservation_id)).reduce((a, l) => a + (l.max_micros as number), 0);
      const state = ledgerStep(() => readItem(o.record, o.item));
      const before = state.leases.filter((l) => l.close && l.lease.lease_id !== leaseId);
      return {
        settled: meters.reduce((a, m) => a + m.spent_micros, 0) + before.reduce((a, l) => a + l.close!.spent_micros, 0),
        reserved,
        unknown: Math.max(0, meters.reduce((a, m) => a + m.unknown_micros, 0) - reserved) + before.reduce((a, l) => a + l.close!.unknown_micros, 0),
        cap: state.cap_micros ?? 0,
      };
    },
    startedLabels() {
      return new Set(journals().filter((l) => l.kind === "reserve").map((l) => String(l.cell?.task)));
    },
    labelMicros(label) {
      const pairs = new Set(journals().filter((l) => l.kind === "reserve" && l.cell?.task === label).map((l) => l.lease_id + " " + l.cell.meter_id));
      return [...pairs].reduce((a, p) => {
        const [l, m] = p.split(" ");
        return a + (local.meters(l!).get(m!)?.held_micros ?? 0);
      }, 0);
    },
    async release(sends) {
      if (!sends.length) return { released: [], missing: null };
      const b = proxy.bind({ cell: { run_id: o.runId, arm: "tbv", task: "generation-records", model: "openrouter", trial: 1, attempt: 1 }, models: ["openrouter:generation"], allowance_micros: 1 });
      const released: string[] = [];
      try {
        for (const s of sends) {
          if (!/^[A-Za-z0-9_-]+$/.test(s.responseId)) return { released, missing: s.responseId };
          const res = await fetch(base + b.slot + "/openrouter/v1/generation?id=" + s.responseId, { headers: { authorization: "Bearer " + b.token } });
          const text = await res.text();
          let id: unknown;
          try {
            id = (JSON.parse(text) as { data?: { id?: unknown } })?.data?.id;
          } catch {}
          if (res.status !== 200 || id !== s.responseId) return { released, missing: s.responseId };
          if (local.releaseUnbilled({ lease_id: leaseId, idempotency_key: s.idempotencyKey, journal, generation_id: s.responseId, record: text }).ok) released.push(s.idempotencyKey);
        }
      } finally {
        proxy.unbind(b.slot);
      }
      return { released, missing: null };
    },
    async close(capStop) {
      if (closed) return closed;
      proxy.stop();
      try {
        const rec = await reconcileJournal(journal, local);
        for (const r of rec.refused) warn(r.code as ReasonCode, "reconciling reservation " + (r.reservation_id ?? "(a lost reserve)") + " was refused: " + r.message);
        const c = ledgerStep(() => settleLease(o.record, local, leaseId, warn, capStop));
        closed = { settled: c.spent_micros, unknown: c.unknown_micros };
      } finally {
        local.close();
      }
      return closed;
    },
  };
  return run;
}

/** The frozen order: task, arm, model, then passes, so pass 1's report turn writes the cache before the rest. */
export function readingOrder(plan: DrivePlan): Reading[] {
  const out: Reading[] = [];
  for (const h of plan.tasks) for (const arm of plan.arms) for (const model of plan.models) for (let pass = 1; pass <= (plan.passes[model] ?? 0); pass++) out.push({ task: h.task, arm, model, pass });
  return out;
}

const DEFAULTS = (): DriveDeps => ({ build: buildRequest, validate: validateRequest, closer: closerHolds, sleep: Bun.sleep, now: Date.now, seal: () => {}, log: () => {}, done: [] });
const priceOf = (m: Model) => {
  const p = chatPrice(ARM_MODELS[m].provider + ":" + ARM_MODELS[m].id) ?? fail("E_TBV_RUN", "no price row for " + ARM_MODELS[m].id);
  return { in: p.input, out: p.output, cacheWrite: p.cache_write };
};
/** A reading's slot allowance: its sends' worst case, each turn at two retries, priced from the first request as the proxy prices. */
function allowanceFor(req: SendRequest): number {
  let price: ReturnType<typeof priceRequest>;
  try {
    price = priceRequest(req.provider, req.body, Number(req.body.max_tokens ?? MAX_TOKENS), req.route);
  } catch {
    return 1;
  }
  let total = 0;
  for (let k = 0; k < SENDS; k++) total += reservationMicros({ ...price, inputTokens: price.inputTokens + PROXY_BYTES + k * GROWTH_BYTES });
  return (RETRIES + 1) * total;
}

interface RouteState {
  fails: number;
  waits: number;
  gate: Promise<void> | null;
  probe: { done: Promise<void>; end: () => void } | null;
}

/** Drives an item's readings in rounds of ROUND, each admitted by rule.ts roundAdmits, and seals each record as it finishes. */
export async function driveItem(run: DriveItemRun, plan: DrivePlan, given: Partial<DriveDeps> = {}): Promise<DriveResult> {
  const d = { ...DEFAULTS(), ...given };
  const tasks = new Map(plan.tasks.map((h) => [h.task, h]));
  const records = new Map<string, ReadingRecord>();
  for (const r of d.done) records.set(keyOf(r), r);
  const roundWorst = plan.roundWorstMicros ?? Math.ceil(ROUND * Math.max(...plan.models.map((m) => readingWorst({ inputTokens: WORST_INPUT, price: priceOf(m) }))) * 1e6);
  let stop: DriveResult["stop"] = null;
  const setStop = (cls: "cap" | "harness" | "outage", why: string) => {
    if (!stop) d.log("tbv drive: the item stops (" + cls + "): " + why);
    stop ??= { cls, why };
  };
  const dropped = new Map<string, string>();
  const checked = new Set<string>();
  const routes = new Map<string, RouteState>();
  const firsts = new Map<string, { done: Promise<void>; end: () => void }>();
  const unknown: Array<{ idempotencyKey: string; responseId: string }> = [];
  const released = new Set<string>();
  const deferred = () => {
    let end = () => {};
    const done = new Promise<void>((r) => (end = r));
    return { done, end };
  };

  const base = (r: Reading, label: string): ReadingRecord => ({ schema: "tbv-reading.v1", label, item: plan.item, task: r.task, family: tasks.get(r.task)!.family, arm: r.arm, model: r.model, pass: r.pass, cls: "gap", why: "", drill: {}, texts: { report: null, d1: null, d2: null }, responseIds: [], maxTokens: [], sends: [], usd: 0, cacheRead: null });
  const put = (rec: ReadingRecord) => {
    records.set(keyOf(rec), rec);
    d.seal("reading-" + rec.label + ".json", JSON.stringify(rec) + "\n");
  };
  const label = () => randomBytes(16).toString("hex");

  /** Amendment item 12: a report-turn request the validator refuses only for size drops the task from every arm and model. */
  const precheck = (task: string) => {
    if (checked.has(task)) return;
    checked.add(task);
    const h = tasks.get(task)!;
    for (const arm of plan.arms)
      for (const model of plan.models) {
        const v = d.validate(d.build({ history: h, shape: plan.shape(arm, model), splice: plan.splice(h.family, arm), turns: plan.turns, arm, model, turn: "report", prior: [] }).body, model);
        if (!v.ok && v.size) {
          dropped.set(task, "size: the " + arm + " " + model + " report request is " + v.tokens + " tokens, over the " + v.window + " window");
          return;
        }
      }
  };

  const enter = async (st: RouteState): Promise<"go" | "probe" | "stop"> => {
    for (;;) {
      if (stop && stop.cls !== "harness") return "stop";
      if (st.gate) await st.gate;
      else if (st.probe) await st.probe.done;
      else if (st.waits > 0) {
        st.probe = deferred();
        return "probe";
      } else return "go";
    }
  };
  const pause = (st: RouteState) => {
    st.gate = d.sleep(PAUSE_MS).then(() => {
      st.gate = null;
    });
  };
  const leave = (st: RouteState, how: "go" | "probe", transport: boolean, route: string) => {
    if (how === "probe") {
      const p = st.probe!;
      st.probe = null;
      if (!transport) {
        st.waits = 0;
        st.fails = 0;
      } else if (st.waits >= MAX_WAITS) setStop("outage", route + " failed after " + MAX_WAITS + " waits of " + PAUSE_MS / 60_000 + " minutes with no success");
      else {
        st.waits++;
        pause(st);
      }
      p.end();
      return;
    }
    if (st.waits > 0 || st.gate || st.probe) return;
    if (!transport) st.fails = 0;
    else if (++st.fails >= PAUSE_AFTER) {
      st.fails = 0;
      st.waits = 1;
      d.log("tbv drive: " + route + " failed " + PAUSE_AFTER + " times in a row; no new reservation there for " + PAUSE_MS / 60_000 + " minutes");
      pause(st);
    }
  };

  const drive = async (r: Reading, first: { end: () => void } | undefined) => {
    const h = tasks.get(r.task)!;
    const rec = base(r, label());
    d.seal("start-" + rec.label + ".json", JSON.stringify({ label: rec.label, task: r.task, arm: r.arm, model: r.model, pass: r.pass }) + "\n");
    const shape = plan.shape(r.arm, r.model);
    const splice = plan.splice(h.family, r.arm);
    const attempts: Attempt[] = [];
    const prior: BuildInput["prior"] = [];
    let slot: ReturnType<DriveItemRun["slot"]> | null = null;
    const turn = async (t: Turn) => {
      const built = d.build({ history: h, shape, splice, turns: plan.turns, arm: r.arm, model: r.model, turn: t, prior: [...prior] });
      const v = d.validate(built.body, r.model);
      if (!v.ok) {
        attempts.push({ kind: v.size ? "size" : "validator", turn: t });
        if (v.size) dropped.set(r.task, "size: the " + r.arm + " " + r.model + " " + t + " request is " + v.tokens + " tokens, over the " + v.window + " window");
        else setStop("harness", "the " + t + " request for " + r.arm + " " + r.model + " failed the validator: " + v.problem);
        return null;
      }
      if (splice && !d.closer(built.body, splice)) {
        attempts.push({ kind: "closer", turn: t });
        setStop("harness", "the closer byte check failed on the " + t + " request for " + r.arm + " " + r.model);
        return null;
      }
      const req = armSend(r.model, built.body);
      slot ??= run.slot(rec.label, [req.provider + ":" + ARM_MODELS[r.model].id], allowanceFor(req));
      const route = routeKey(req);
      const st = routes.get(route) ?? { fails: 0, waits: 0, gate: null, probe: null };
      routes.set(route, st);
      for (let attempt = 1; ; ) {
        const how = await enter(st);
        if (how === "stop") {
          attempts.push({ kind: stop!.cls === "cap" ? "budget" : "outage", turn: t });
          return null;
        }
        const res = await slot.send(req);
        const transport = TRANSPORT.has(res.kind);
        rec.sends.push({ turn: t, attempt, kind: res.kind, status: res.status, responseId: res.responseId, idempotencyKey: res.idempotencyKey, micros: res.micros, usage: res.usage });
        if (res.micros === null && res.idempotencyKey && res.responseId && req.provider === "openrouter") unknown.push({ idempotencyKey: res.idempotencyKey, responseId: res.responseId });
        leave(st, how, transport, route);
        if (transport && how === "probe") {
          if (stop?.cls === "outage") {
            attempts.push({ kind: "outage", turn: t });
            return null;
          }
          continue;
        }
        attempts.push({ kind: res.kind, turn: t });
        if (res.responseId && !transport) rec.responseIds.push(res.responseId);
        if (res.reply?.stopReason === "max_tokens") rec.maxTokens.push(t);
        if (transport && attempt++ <= RETRIES) continue;
        if (res.kind === "budget") setStop("cap", "the lease refused the " + t + " send of a " + r.arm + " " + r.model + " reading (CAP_STOP)");
        if (res.kind === "4xx") setStop("harness", "the provider or proxy answered " + res.status + " " + (res.problemCode ?? "") + " to a " + t + " send");
        return res;
      }
    };
    const ended = () => ENDS.has(attempts.at(-1)?.kind as AttemptKind);
    try {
      let report = await turn("report");
      if (report?.reply && (report.kind === "tool-only" || report.kind === "empty")) {
        prior.push({ turn: "report", reply: report.reply });
        report = await turn("followup");
        if (report?.reply && textual(report.kind)) prior.push({ turn: "followup", reply: report.reply });
      } else if (report?.reply && textual(report.kind)) prior.push({ turn: "report", reply: report.reply });
      first?.end();
      if (report?.reply && textual(report.kind)) {
        rec.texts.report = report.reply.text;
        const d1 = await turn("d1");
        if (d1?.reply && textual(d1.kind)) {
          rec.texts.d1 = d1.reply.text;
          prior.push({ turn: "d1", reply: d1.reply });
        }
        if (!ended()) {
          const d2 = await turn("d2");
          if (d2?.reply && textual(d2.kind)) rec.texts.d2 = d2.reply.text;
        }
      }
    } finally {
      first?.end();
      if (slot) {
        rec.usd = (await (slot as Slot).micros()) / 1e6;
        await (slot as Slot).close();
      }
    }
    const e = endState(attempts);
    rec.cls = e.cls as ReadingRecord["cls"];
    rec.why = e.why;
    rec.drill = e.drill ?? {};
    const usage = rec.sends.flatMap((s) => (s.usage ? [s.usage] : []));
    const all = usage.reduce((a, u) => a + u.input + u.cache_read + u.cache_write, 0);
    rec.cacheRead = all ? usage.reduce((a, u) => a + u.cache_read, 0) / all : null;
    put(rec);
  };

  const order = readingOrder(plan).filter((r) => !records.has(keyOf(r)));
  for (let i = 0; i < order.length && !stop; ) {
    const round: Reading[] = [];
    while (round.length < ROUND && i < order.length) {
      const r = order[i++]!;
      precheck(r.task);
      if (dropped.has(r.task)) put({ ...base(r, label()), cls: "size-drop", why: dropped.get(r.task)! });
      else round.push(r);
    }
    if (!round.length) continue;
    let s = await run.spend();
    if (!roundAdmits({ ...s, roundWorst })) {
      const fresh = unknown.filter((u) => !released.has(u.idempotencyKey));
      const rel = await run.release(fresh);
      for (const k of rel.released) released.add(k);
      if (rel.missing !== null) {
        setStop("harness", "E_TBV_RUN no OpenRouter generation record for the send whose stream named " + rel.missing + ": its reservation stands at full and nothing retries; check that the stream's message_start id is the generation id");
        break;
      }
      s = await run.spend();
      if (!roundAdmits({ ...s, roundWorst })) {
        setStop("cap", "the item's cap refused the round: " + s.settled + " settled, " + s.reserved + " reserved and " + s.unknown + " unknown micros plus the round's worst case of " + roundWorst + " is over the cap of " + s.cap);
        break;
      }
    }
    for (const r of round) if (r.pass === 1) firsts.set(r.task + "|" + r.arm + "|" + r.model, deferred());
    await Promise.all(
      round.map(async (r) => {
        const group = r.task + "|" + r.arm + "|" + r.model;
        if (r.pass > 1) await firsts.get(group)?.done;
        return drive(r, r.pass === 1 ? firsts.get(group) : undefined);
      }),
    );
  }
  for (const r of readingOrder(plan)) {
    const prev = records.get(keyOf(r));
    if (dropped.has(r.task) && prev && prev.cls !== "size-drop") put({ ...prev, cls: "size-drop", why: dropped.get(r.task)! });
    else if (!prev) put({ ...base(r, label()), cls: stop!.cls, why: "the item stopped before this reading: " + stop!.why });
  }
  return { records: readingOrder(plan).map((r) => records.get(keyOf(r))!), stop, dropped: [...dropped.keys()] };
}

/** Stage 1's shape smoke: one report-turn send per model, arm, family and source shape, with each route's reported prompt tokens beside the characters / 3 estimate. */
export async function smokeItem(run: DriveItemRun, plan: DrivePlan, given: Partial<DriveDeps> = {}): Promise<string[]> {
  const d = { ...DEFAULTS(), ...given };
  const shapes = new Map<string, History>();
  for (const h of plan.tasks) if (!shapes.has(h.family + " " + h.source)) shapes.set(h.family + " " + h.source, h);
  const out: string[] = [];
  for (const [name, h] of shapes)
    for (const model of plan.models)
      for (const arm of plan.arms) {
        const where = "smoke " + model + " " + arm + " " + name;
        const built = d.build({ history: h, shape: plan.shape(arm, model), splice: plan.splice(h.family, arm), turns: plan.turns, arm, model, turn: "report", prior: [] });
        const v = d.validate(built.body, model);
        if (!v.ok) {
          out.push(where + ": HARNESS the validator refused it: " + (v.size ? "size " + v.tokens + " over " + v.window : v.problem));
          continue;
        }
        const req = armSend(model, built.body);
        const slot = run.slot("smoke-" + randomBytes(8).toString("hex"), [req.provider + ":" + ARM_MODELS[model].id], allowanceFor(req));
        const res = await slot.send(req);
        await slot.close();
        const u = res.usage;
        const reported = u ? u.input + u.cache_read + u.cache_write : null;
        out.push(where + ": " + (reported === null ? "reported n/a" : "reported " + reported) + " prompt tokens, estimate " + built.estTokens + (reported !== null && reported > built.estTokens ? " OVER" : "") + ", reasoning " + (u?.reasoning ?? "n/a") + ", " + res.kind + (res.kind === "text" ? "" : " HARNESS"));
      }
  return out;
}

/** An item run with custody: the leftover check, the dead run's records and crash gaps, the drive, the lease's close. */
export async function runItem(o: RunItemOptions): Promise<DriveResult & { crashed: string[] }> {
  const root = plaintextRoot(o.plaintext, { devPlaintext: o.devPlaintext, held: o.held, unsealCmd: o.unsealCmd, mounts: o.mounts });
  leftover(root, o.log);
  const vault = openVault({ root, durable: join(resolve(o.out), "sealed"), sealCmd: o.sealCmd, unsealCmd: o.unsealCmd });
  const kept = [...vault.all()];
  const done = kept.filter(([n]) => n.startsWith("reading-")).map(([, t]) => JSON.parse(t) as ReadingRecord);
  const starts = kept.filter(([n]) => n.startsWith("start-")).map(([, t]) => JSON.parse(t) as Reading & { label: string });
  const run = await openItemRun(o);
  let result: DriveResult | null = null;
  const crashed: string[] = [];
  try {
    const started = run.startedLabels();
    const finished = new Set(done.map(keyOf));
    for (const s of starts) {
      if (!started.has(s.label) || finished.has(keyOf(s))) continue;
      const h = o.plan.tasks.find((t) => t.task === s.task);
      const rec: ReadingRecord = { schema: "tbv-reading.v1", label: s.label, item: o.plan.item, task: s.task, family: h?.family ?? "investigate", arm: s.arm, model: s.model, pass: s.pass, cls: "gap", why: "crash: the reading was in flight when the run died; it is never sent again", drill: {}, texts: { report: null, d1: null, d2: null }, responseIds: [], maxTokens: [], sends: [], usd: run.labelMicros(s.label) / 1e6, cacheRead: null };
      vault.put("reading-" + s.label + ".json", JSON.stringify(rec) + "\n");
      done.push(rec);
      finished.add(keyOf(s));
      crashed.push(s.label);
      o.log("tbv drive: reading " + s.label + " started before the restart and has no record: a crash gap");
    }
    result = await driveItem(run, o.plan, { ...o.deps, seal: (n, t) => vault.put(n, t), log: o.log, done, ...(o.sleep ? { sleep: o.sleep } : {}), ...(o.now ? { now: o.now } : {}) });
  } finally {
    await run.close(result?.stop?.cls === "cap" ? "item" : undefined);
    for (const w of run.warnings) o.log("tbv drive: " + w);
    rmSync(root, { recursive: true, force: true });
  }
  return { ...result, crashed };
}

const TURN_KEYS: Turn[] = ["report", "d1", "d2", "followup"];
/** turns.txt at its frozen sha256: one "name: text" line per turn. */
function readTurns(path: string): Turns {
  const text = readFileSync(path, "utf8");
  const sha = new Bun.CryptoHasher("sha256").update(text).digest("hex");
  if (sha !== BUNDLE.turns.sha256) fail("E_TBV_INPUT", path + " is not turns.txt at its frozen sha256 " + BUNDLE.turns.sha256);
  const map = Object.fromEntries(text.split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  for (const k of TURN_KEYS) if (!map[k]) fail("E_TBV_INPUT", path + " has no " + k + " turn");
  return map as unknown as Turns;
}

const USAGE = "gstack-evals tbv drive --item <item> --run-id <id> --out <dir> --plaintext <dir> --tasks <dir> --shapes <dir> --splices <dir> --turns <turns.txt> --models opus,sol --arms none,current --passes opus=3,sol=2 --cwd <path> --date <yyyy-mm-dd> [--ledger <file>] [--ledger-record <dir>] [--seal-cmd <cmd> --unseal-cmd <cmd>] [--held] [--dev-plaintext] [--smoke]";

/** gstack-evals tbv drive: argv[0] is "drive". Inputs are JSON files: one History per task, one Shape per arm, one SpliceSet per family. */
export async function run(argv: string[], io: Io): Promise<number> {
  const flags = new Map<string, string>();
  const bools = new Set(["--held", "--dev-plaintext", "--smoke"]);
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (bools.has(a)) flags.set(a, "1");
    else if (a.startsWith("--") && i + 1 < argv.length) flags.set(a, argv[++i]!);
    else fail("E_USAGE" as ReasonCode, "unknown argument " + a + "; " + USAGE);
  }
  const need = (k: string) => flags.get(k) ?? fail("E_TBV_INPUT", "missing " + k + "; " + USAGE);
  const json = <T>(path: string): T => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (e) {
      return fail("E_TBV_INPUT", path + " is not readable JSON: " + (e as Error).message);
    }
  };
  const dir = <T>(path: string) => readdirSync(path).filter((n) => n.endsWith(".json")).sort().map((n) => json<T>(join(path, n)));
  const list = <T extends string>(k: string, allowed: readonly string[]) => need(k).split(",").map((x) => (allowed.includes(x) ? (x as T) : fail("E_TBV_INPUT", k + " names " + x + "; it takes " + allowed.join(", "))));
  const models = list<Model>("--models", Object.keys(ARM_MODELS));
  const arms = list<Arm>("--arms", ["none", "current", "principle", "lens"]);
  const passes: Partial<Record<Model, number>> = {};
  for (const p of need("--passes").split(",")) {
    const [m, n] = p.split("=");
    if (!models.includes(m as Model) || !/^[1-9]$/.test(n ?? "")) fail("E_TBV_INPUT", "--passes takes model=n for each model, not " + p);
    passes[m as Model] = Number(n);
  }
  const shapes = new Map(dir<Shape>(need("--shapes")).map((s) => [s.arm, s]));
  const splices = new Map(dir<SpliceSet>(need("--splices")).map((s) => [s.family, s]));
  const fields = { cwd: need("--cwd"), date: need("--date") };
  const plan: DrivePlan = {
    item: need("--item"),
    tasks: dir<History>(need("--tasks")),
    arms,
    models,
    passes,
    turns: readTurns(need("--turns")),
    shape: (arm, model) => fillShape(shapes.get(arm) ?? fail("E_TBV_INPUT", "no shape for the " + arm + " arm in " + flags.get("--shapes")), model, fields),
    splice: (family, arm) => (arm === "none" ? null : (splices.get(family) ?? fail("E_TBV_INPUT", "no splice set for the " + family + " family in " + flags.get("--splices")))),
  };
  const sealCmd = flags.get("--seal-cmd") ?? null;
  const unsealCmd = flags.get("--unseal-cmd") ?? null;
  const held = flags.has("--held");
  if (held && !sealCmd) fail("E_TBV_CUSTODY", "held-out records are sealed as they finish; pass --seal-cmd");
  const env = process.env;
  const base = { item: plan.item, runId: need("--run-id"), record: recordPath(flags.get("--ledger-record"), env).path, ledger: flags.get("--ledger") ?? "", out: need("--out"), env };
  if (flags.has("--smoke")) {
    const run = await openItemRun({ ...base, ledger: flags.get("--ledger") as string });
    try {
      for (const l of await smokeItem(run, plan)) io.out(l);
    } finally {
      await run.close();
    }
    return 0;
  }
  const res = await runItem({ ...base, ledger: flags.get("--ledger") as string, plan, plaintext: need("--plaintext"), sealCmd, unsealCmd, devPlaintext: flags.has("--dev-plaintext"), held, log: io.err });
  const count = new Map<string, number>();
  for (const r of res.records) count.set(r.cls, (count.get(r.cls) ?? 0) + 1);
  io.out("tbv drive " + plan.item + ": " + res.records.length + " readings: " + [...count].map(([k, v]) => v + " " + k).join(", ") + (res.dropped.length ? "; " + res.dropped.length + " tasks dropped for size" : "") + (res.crashed.length ? "; " + res.crashed.length + " crash gaps" : ""));
  const mt = new Map<string, number>();
  for (const r of res.records) for (const t of r.maxTokens) mt.set(r.arm + " " + r.model + " " + t, (mt.get(r.arm + " " + r.model + " " + t) ?? 0) + 1);
  for (const [k, v] of mt) io.out("max_tokens replies: " + k + " " + v);
  if (res.stop) {
    io.out("STOP " + res.stop.cls + ": " + res.stop.why);
    return res.stop.cls === "harness" ? 2 : 3;
  }
  return 0;
}

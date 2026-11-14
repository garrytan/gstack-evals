// Copyright (c) 2026 Garry Tan. MIT License.
// The real callers behind the money area's metered client (money open item 4's direct half, plan section 5): one
// in-process metering proxy per direct-call ledger item on the controller host, on that item's controller-held lease,
// with its ledger wrapped by the write-ahead copy, so no reserve is answered before the off-host copy holds it. Each
// route is the one money/price.ts names: Anthropic for Opus 5.5, OpenAI for GPT-6 Astra, OpenRouter for GPT-6.1 Sol,
// particle-1 and Gemini 4 Argon, through main's provider code and src/runner/proxy/metering-proxy.ts. The meter admits
// each call at the proxy's own worst case before anything is sent, settles it from the proxy's figures in the local
// ledger, and checks the served provider through the run's one ProviderWatch. The provider keys are read by name when a
// proxy starts and go only to that proxy; nothing here prints or writes them.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { MeteringProxy, reconcileJournal, type RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";
import type { ReservationLedger } from "../../../src/types.ts";
import type { Caller } from "../author/seams.ts";
import { DcError } from "../errors.ts";
import { LEDGER_ITEMS, MONEY } from "../frozen.ts";
import type { MoneyController } from "../money/book.ts";
import { writeAheadLedger } from "../money/durability.ts";
import { ledgerFigures, openMeter, type CallResult, type Meter } from "../money/meter.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import type { ProxyLife } from "../money/renewal.ts";
import type { ProviderWatch } from "../money/served.ts";
import type { Admission, LeaseInfo } from "../money/types.ts";
import type { WriteAhead } from "../money/wal.ts";
import type { JudgeCaller } from "../score/seams.ts";
import { CapStopSignal } from "../stage3/seams.ts";
import type { LedgerItemId } from "../types.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";

/** The provider key names a lane proxy reads. Nothing else from the environment reaches a proxy. */
export const KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const;

/** Reads the three provider keys by name at run time, for one proxy's env. The values are never printed or written. */
export function providerKeys(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return Object.fromEntries(KEY_NAMES.map((k) => [k, env[k]]));
}

/** The proxy's per-call output cap: the largest lane cap, doubled for a resend, so no lane call is refused for its cap. */
export const DIRECT_MAX_OUTPUT_TOKENS = 2 * Math.max(...Object.values(MONEY.outputCaps));

type Send = (url: string, init: RequestInit) => Promise<Response>;

export interface DirectOptions {
  controller: MoneyController;
  local: LocalLedger;
  /** The write-ahead copy. Required: every proxy reserve is copied off host before it is answered (R2-4). */
  wal: WriteAhead;
  /** The run's one served-provider watch, shared with the session proxies. */
  watch: ProviderWatch;
  /** Holds each item's proxy directory: its journal and management socket. */
  dir: string;
  /** The reply cache; it holds model output, so it sits on tmpfs for sealed work. */
  cacheDir: string;
  /** The proxy's retry budget. The integrator sets it (an open item in paid/NOTES.md). */
  retry: RetryBudget;
  /** Where the keys are read from, by name. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The upstream, for keyless tests; unset, the proxy reaches the providers itself. */
  fetch?: Send;
  /** The proxy's sleep between retries, for keyless tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface Live {
  leaseId: string;
  proxy: MeteringProxy;
  journal: string;
}

/** Refused admissions as the callers throw them: a cap stop as CapStopSignal, a stop code as DcError, the rest as PaidRefusal. */
export class PaidRefusal extends Error {
  constructor(
    readonly item: LedgerItemId,
    readonly admission: Exclude<Admission, { kind: "admitted" }>,
  ) {
    super(item + " refused the call (" + admission.kind + "): " + admission.why);
  }
}

/** A call that was admitted and sent but gave no reply text: an HTTP error, a lost reply or a reply that isn't JSON. */
export class PaidCallFailed extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly problem: string | null,
  ) {
    super("call " + label + " gave no reply text (HTTP " + status + "): " + (problem ?? "no problem named"));
  }
}

export function refusalError(item: LedgerItemId, a: Exclude<Admission, { kind: "admitted" }>): Error {
  if (a.kind === "cap-stop" || a.kind === "closed") return new CapStopSignal(item, a.why);
  if (a.kind === "stopped") return new DcError(a.code as ReasonCode, a.why);
  return new PaidRefusal(item, a);
}

export class DirectCallers {
  private readonly live = new Map<LedgerItemId, Live>();
  private readonly meters = new Map<LedgerItemId, Meter>();
  private readonly ledger: ReservationLedger;

  constructor(private readonly o: DirectOptions) {
    this.ledger = writeAheadLedger(o.local, o.wal);
  }

  /** The item's running proxy on its open lease, started on first use. Renewal replaces it through proxyLife. */
  proxy(item: LedgerItemId): MeteringProxy {
    if (LEDGER_ITEMS[item].admission.kind !== "direct") throw new DcError("E_USAGE", item + " admits " + LEDGER_ITEMS[item].admission.kind + ", not direct calls");
    const lease = this.o.controller.lease(item);
    if (!lease) throw new DcError("E_USAGE", item + " has no open lease; the controller opens it before any call");
    const now = this.live.get(item);
    if (now && now.leaseId === lease.leaseId) return now.proxy;
    if (now) throw new DcError("E_INTERNAL", item + "'s proxy serves lease " + now.leaseId + ", not the open lease " + lease.leaseId + "; renew through proxyLife");
    return this.start(item, lease).proxy;
  }

  private start(item: LedgerItemId, lease: LeaseInfo): Live {
    const dir = join(this.o.dir, item + "-" + lease.leaseId.slice(-8));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const journal = join(dir, "journal.ndjson");
    const proxy = new MeteringProxy({
      ledger: this.ledger,
      leaseId: lease.leaseId,
      host: "127.0.0.1",
      managementSocket: join(dir, "management.sock"),
      managementToken: randomBytes(24).toString("base64url"),
      journal,
      retry: this.o.retry,
      env: providerKeys(this.o.env),
      maxOutputTokens: DIRECT_MAX_OUTPUT_TOKENS,
      ...(this.o.fetch ? { fetch: this.o.fetch } : {}),
      ...(this.o.sleep ? { sleep: this.o.sleep } : {}),
    });
    proxy.start();
    const l = { leaseId: lease.leaseId, proxy, journal };
    this.live.set(item, l);
    return l;
  }

  /** The proxy journal of the item's running proxy, or null. */
  journal(item: LedgerItemId): string | null {
    return this.live.get(item)?.journal ?? null;
  }

  /** The metered client for one direct-call item. */
  meter(item: LedgerItemId): Meter {
    const had = this.meters.get(item);
    if (had) return had;
    const m = openMeter({
      controller: this.o.controller,
      item,
      runId: this.o.controller.runId,
      proxy: () => this.proxy(item),
      figures: ledgerFigures(this.o.local, () => this.o.controller.lease(item)?.leaseId ?? null),
      cacheDir: this.o.cacheDir,
      out: this.o.watch.out,
      watch: this.o.watch,
    });
    this.meters.set(item, m);
    return m;
  }

  /** Renewal's proxy seam for one item (money/renewal.ts): stop, reconcile the journal, start on the continuation. */
  proxyLife(item: LedgerItemId): ProxyLife {
    let journal: string | null = null;
    return {
      stop: () => {
        const l = this.live.get(item);
        journal = l?.journal ?? null;
        l?.proxy.stop();
        this.live.delete(item);
      },
      reconcile: () => (journal ? reconcileJournal(journal, this.ledger) : null),
      start: (lease) => void this.start(item, lease),
    };
  }

  stopAll(): void {
    for (const l of this.live.values()) l.proxy.stop();
    this.live.clear();
  }

  /** The author area's Caller on one item. A refusal or a call with no reply text throws; drift throws DcError. */
  author(item: LedgerItemId, stage: string | null = null): Caller {
    return async (req) => {
      const r = await this.meter(item).call({ model: req.model, prompt: req.prompt, maxTokens: req.maxTokens, effort: req.effort, label: req.label, stage });
      return { text: textOf(item, req.label, r) };
    };
  }

  /** The score area's JudgeCaller on one item. A refusal throws; a sent call with no text returns its problem. */
  judge(item: LedgerItemId): JudgeCaller {
    return async (c) => {
      const r = await this.meter(item).call({ model: c.judge, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label, subject: c.subject });
      if (r.refused && r.refused.kind !== "admitted") throw refusalError(item, r.refused);
      return { text: r.text, modelId: DIRECT_MODELS[c.judge].id, version: r.version, problem: r.problem };
    };
  }
}

function textOf(item: LedgerItemId, label: string, r: CallResult): string {
  if (r.refused && r.refused.kind !== "admitted") throw refusalError(item, r.refused);
  if (r.text === null) throw new PaidCallFailed(label, r.status, r.problem);
  return r.text;
}

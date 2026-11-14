// Copyright (c) 2026 Garry Tan. MIT License.
// The session proxies (money open items 3 and 4, plan section 5): one metering proxy per session ledger item (the
// review rounds of stage 1 and 2, recipe sessions, stage 3 and oracle builds), on that item's controller-held lease.
// Each proxy copies every reserve off host through its write-ahead relay before it answers, and journals the provider
// each OpenRouter reply names (ProxyOptions.servedProvider). The controller reads the journal and runs session traffic
// through the same ProviderWatch as direct calls, so a session served by another provider stops every call on that
// model in every role (PD-9) and cuts that model's session proxies. A session's spend settles from the proxy's own
// figures for its meters in the local ledger. Where the proxy runs is the launcher's: the trial-network container
// (containerLauncher) or an in-process proxy on the same relay path (inProcessLauncher, for tests and host runs).
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { MeteringProxy, ProxyControl, reconcileJournal, type BindRequest, type Binding, type RetryBudget } from "../../../src/runner/proxy/metering-proxy.ts";
import { startProxyContainer, type TrialNetwork } from "../../../src/trial/proxy.ts";
import { relayedLedger } from "../../../src/trial/write-ahead.ts";
import type { ReservationLedger } from "../../../src/types.ts";
import { DcError } from "../errors.ts";
import { LEDGER_ITEMS, STAGE3 } from "../frozen.ts";
import { $, type MoneyController } from "../money/book.ts";
import { writeAheadLedger } from "../money/durability.ts";
import { appendLink } from "../money/journals.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import type { ProxyLife } from "../money/renewal.ts";
import type { ProviderWatch } from "../money/served.ts";
import type { LeaseInfo, Sub } from "../money/types.ts";
import type { WriteAhead } from "../money/wal.ts";
import type { AnyModel, LedgerItemId, Model } from "../types.ts";
import { providerKeys } from "./direct.ts";
import { serveWriteAhead, type Relay } from "./relay.ts";

/** The items whose work is agent sessions, each on one model, and each session's frozen allowance in micros. */
export function sessionAllowance(item: LedgerItemId): number {
  const a = LEDGER_ITEMS[item].admission;
  if (a.kind === "sessions") return $(a.allowanceUsd);
  if (item === "dc-stage3-authoring") return $(STAGE3.build.usd);
  throw new DcError("E_USAGE", item + " runs no agent sessions");
}

/** The management calls the controller makes on a session proxy. */
export interface SessionControl {
  bind(r: BindRequest): Binding | Promise<Binding>;
  unbind(slot: string): unknown;
  finalize(meterId: string): Promise<unknown>;
}

export interface SessionProxy {
  /** The base URL sessions reach the proxy at, before the slot. */
  baseUrl: string;
  journal: string;
  control: SessionControl;
  stop(): void | Promise<void>;
}

export interface LaunchRequest {
  item: LedgerItemId;
  leaseId: string;
  /** The proxy's own directory: config, journal, management socket and the relay socket. */
  dir: string;
  writeAheadSocket: string;
}

export type SessionLauncher = (r: LaunchRequest) => Promise<SessionProxy>;

/** The proxy container on the trial network (src/trial/proxy.ts), with the relay and the served-provider journal on. */
export function containerLauncher(o: { image: string; net: TrialNetwork; ledgerPath: string; retry: RetryBudget; env?: Record<string, string | undefined>; docker?: string }): SessionLauncher {
  return async (r) => {
    const token = randomBytes(24).toString("base64url");
    const keys = Object.fromEntries(Object.entries(providerKeys(o.env)).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0));
    const h = startProxyContainer({ image: o.image, net: o.net, dir: r.dir, ledger: o.ledgerPath, leaseId: r.leaseId, managementToken: token, retry: o.retry, providerKeys: keys, docker: o.docker, writeAheadSocket: r.writeAheadSocket, servedProvider: true });
    return { baseUrl: h.baseUrl, journal: h.journal, control: new ProxyControl(h.socket, token), stop: () => h.stop() };
  };
}

/** An in-process proxy on the same relay path as the container: for keyless tests and sessions run on the host. */
export function inProcessLauncher(o: { local: LocalLedger; retry: RetryBudget; env?: Record<string, string | undefined>; fetch?: (url: string, init: RequestInit) => Promise<Response>; sleep?: (ms: number) => Promise<void> }): SessionLauncher {
  return async (r) => {
    const journal = join(r.dir, "journal.ndjson");
    const proxy = new MeteringProxy({
      ledger: relayedLedger(o.local, r.writeAheadSocket),
      leaseId: r.leaseId,
      host: "127.0.0.1",
      managementSocket: join(r.dir, "management.sock"),
      managementToken: randomBytes(24).toString("base64url"),
      journal,
      retry: o.retry,
      env: providerKeys(o.env),
      servedProvider: true,
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(o.sleep ? { sleep: o.sleep } : {}),
    });
    proxy.start();
    return { baseUrl: "http://127.0.0.1:" + proxy.port, journal, control: proxy, stop: () => proxy.stop() };
  };
}

/** One session's slot on its item's proxy: what the session's harness points at. */
export interface SessionBinding {
  item: LedgerItemId;
  sub: string;
  session: string;
  /** ANTHROPIC_BASE_URL for the session: the proxy, the slot and the provider. */
  baseUrl: string;
  /** The slot's bearer, for ANTHROPIC_AUTH_TOKEN. */
  token: string;
  slot: string;
  meterId: string;
  /** provider:model the slot admits. */
  model: string;
}

export interface SessionOptions {
  controller: MoneyController;
  local: LocalLedger;
  wal: WriteAhead;
  watch: ProviderWatch;
  /** Holds each item's proxy directory. */
  dir: string;
  launcher: SessionLauncher;
  /** Looks up the provider OpenRouter's generation record names, for a reply that names none; unset, such a reply is unnamed. */
  resolve?: (generationId: string, item: LedgerItemId) => Promise<string | null>;
}

interface Live {
  item: LedgerItemId;
  leaseId: string;
  proxy: SessionProxy;
  relay: Relay;
  offset: number;
  models: Map<string, string>;
  bound: Map<string, string[]>;
  slots: Set<string>;
}

const modelOf = (provider: string, id: string): AnyModel | null => (Object.keys(DIRECT_MODELS) as AnyModel[]).find((k) => DIRECT_MODELS[k].provider === provider && DIRECT_MODELS[k].id === id) ?? null;

export class SessionProxies {
  private readonly live = new Map<LedgerItemId, Live>();
  private readonly ledger: ReservationLedger;
  private readonly cutModels = new Set<AnyModel>();

  constructor(private readonly o: SessionOptions) {
    this.ledger = writeAheadLedger(o.local, o.wal);
    o.watch.onDrift(async (model) => void (await this.cut(model)));
  }

  /** Starts the item's proxy and relay on its open lease, once. */
  async open(item: LedgerItemId): Promise<SessionProxy> {
    sessionAllowance(item);
    const lease = this.o.controller.lease(item);
    if (!lease) throw new DcError("E_USAGE", item + " has no open lease; the controller opens it before any session");
    const now = this.live.get(item);
    if (now && now.leaseId === lease.leaseId) return now.proxy;
    if (now) throw new DcError("E_INTERNAL", item + "'s session proxy serves lease " + now.leaseId + ", not the open lease " + lease.leaseId + "; renew through proxyLife");
    return (await this.start(item, lease)).proxy;
  }

  private async start(item: LedgerItemId, lease: LeaseInfo): Promise<Live> {
    const dir = join(this.o.dir, item + "-" + lease.leaseId.slice(-8));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const relay = serveWriteAhead({ wal: this.o.wal, socket: join(dir, "write-ahead.sock"), leaseId: lease.leaseId });
    let proxy: SessionProxy;
    try {
      proxy = await this.o.launcher({ item, leaseId: lease.leaseId, dir, writeAheadSocket: relay.socket });
    } catch (e) {
      relay.stop();
      throw e;
    }
    const l: Live = { item, leaseId: lease.leaseId, proxy, relay, offset: 0, models: new Map(), bound: new Map(), slots: new Set() };
    this.live.set(item, l);
    return l;
  }

  /** Binds one session of an admitted sub-reservation at its frozen allowance. */
  async bind(item: LedgerItemId, s: { sub: Sub; session: string; attempt: 1 | 2; arm?: string | null }): Promise<SessionBinding> {
    const model = s.sub.model;
    if (model && this.cutModels.has(model)) throw new DcError("E_DC_PROVIDER_DRIFT", model + " drifted; no session on it starts without the Captain");
    if (s.sub.item !== item || s.sub.state !== "in-flight") throw new DcError("E_USAGE", "session " + s.session + " needs an in-flight sub-reservation on " + item);
    if (!model || model === "astra" || model === "argon") throw new DcError("E_USAGE", "sub-reservation " + s.sub.id + " names no session model");
    await this.open(item);
    const l = this.live.get(item)!;
    const m = DIRECT_MODELS[model as Model];
    const b = await l.proxy.control.bind({ cell: { run_id: this.o.controller.runId, arm: s.arm ?? s.sub.arm ?? "dc", task: s.session, model: m.id, trial: 1, attempt: s.attempt }, models: [m.provider + ":" + m.id], allowance_micros: sessionAllowance(item) });
    appendLink(this.o.dir, { sub: s.sub.id, item, lease: l.leaseId, meter: b.meter_id, journal: l.proxy.journal });
    l.bound.set(s.sub.id, [...(l.bound.get(s.sub.id) ?? []), b.meter_id]);
    l.slots.add(b.slot);
    return { item, sub: s.sub.id, session: s.session, baseUrl: l.proxy.baseUrl.replace(/\/+$/, "") + "/" + b.slot + "/" + m.provider, token: b.token, slot: b.slot, meterId: b.meter_id, model: m.provider + ":" + m.id };
  }

  /** Ends one session: drains its meter, closes its slot and checks its traffic's served provider (drift throws). */
  async end(b: SessionBinding): Promise<{ spentMicros: number; unknownMicros: number }> {
    const l = this.live.get(b.item);
    if (l && l.slots.has(b.slot)) {
      await l.proxy.control.finalize(b.meterId);
      await l.proxy.control.unbind(b.slot);
      l.slots.delete(b.slot);
    }
    await this.scan(b.item);
    return this.figures(b.item, b.meterId);
  }

  /** A meter's spend and unknown charge on the item's open lease, as the proxy recorded them in the local ledger. */
  figures(item: LedgerItemId, meterId: string): { spentMicros: number; unknownMicros: number } {
    const lease = this.o.controller.lease(item);
    const m = lease ? this.o.local.meters(lease.leaseId).get(meterId) : undefined;
    return { spentMicros: m?.spent_micros ?? 0, unknownMicros: m?.unknown_micros ?? 0 };
  }

  /** Settles a sub-reservation from the proxy's figures for every session it bound, retries included. */
  async settle(item: LedgerItemId, subId: string): Promise<{ spentMicros: number; unknownMicros: number }> {
    const meters = this.live.get(item)?.bound.get(subId) ?? [];
    const f = meters.map((id) => this.figures(item, id)).reduce((a, x) => ({ spentMicros: a.spentMicros + x.spentMicros, unknownMicros: a.unknownMicros + x.unknownMicros }), { spentMicros: 0, unknownMicros: 0 });
    await this.o.controller.settle(subId, f);
    return f;
  }

  /**
   * Reads the item's journal from where the last scan stopped and runs every answered call through the watch. The
   * integrator calls it on a timer while sessions run, so a drift cuts the model before the session ends.
   */
  async scan(item: LedgerItemId): Promise<number> {
    const l = this.live.get(item);
    if (!l || !existsSync(l.proxy.journal)) return 0;
    const fd = openSync(l.proxy.journal, "r");
    let text: string;
    try {
      const size = fstatSync(fd).size;
      const buf = Buffer.alloc(Math.max(size - l.offset, 0));
      readSync(fd, buf, 0, buf.length, l.offset);
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
    const whole = text.lastIndexOf("\n") + 1;
    l.offset += Buffer.byteLength(text.slice(0, whole));
    let checked = 0;
    for (const raw of text.slice(0, whole).split("\n")) {
      let line: Record<string, any>;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (line.kind === "request" && typeof line.reservation_id === "string") l.models.set(line.reservation_id, String(line.provider) + ":" + String(line.model));
      if (line.kind !== "outcome" || line.status !== 200) continue;
      const pm = l.models.get(line.reservation_id);
      if (!pm) continue;
      const cut = pm.indexOf(":");
      const provider = pm.slice(0, cut);
      const model = modelOf(provider, pm.slice(cut + 1));
      if (!model) continue;
      let servedBy: string | null = provider;
      if (provider === "openrouter") {
        servedBy = typeof line.served_provider === "string" ? line.served_provider : null;
        if (servedBy === null && typeof line.generation_id === "string" && this.o.resolve) servedBy = await this.o.resolve(line.generation_id, item);
      }
      checked++;
      await this.o.watch.check({ model, servedBy, via: "session", label: String(line.meter_id ?? line.reservation_id) });
    }
    return checked;
  }

  /** PD-9 on session traffic: stops the proxies of every session item on the model, so no further call on it is sent. */
  async cut(model: AnyModel): Promise<LedgerItemId[]> {
    this.cutModels.add(model);
    const out: LedgerItemId[] = [];
    for (const [item, l] of this.live) {
      const serves = [...l.models.values()].some((pm) => {
        const i = pm.indexOf(":");
        return modelOf(pm.slice(0, i), pm.slice(i + 1)) === model;
      }) || this.o.controller.subsOf(item).some((s) => s.model === model && s.leaseId === l.leaseId);
      if (!serves) continue;
      await l.proxy.stop();
      l.relay.stop();
      this.live.delete(item);
      out.push(item);
    }
    return out;
  }

  /** Renewal's proxy seam for one item: stop the proxy and relay, reconcile its journal, start on the continuation. */
  proxyLife(item: LedgerItemId): ProxyLife {
    let journal: string | null = null;
    return {
      stop: async () => {
        const l = this.live.get(item);
        journal = l?.proxy.journal ?? null;
        await l?.proxy.stop();
        l?.relay.stop();
        this.live.delete(item);
      },
      reconcile: () => (journal ? reconcileJournal(journal, this.ledger) : null),
      start: async (lease) => void (await this.start(item, lease)),
    };
  }

  journal(item: LedgerItemId): string | null {
    return this.live.get(item)?.proxy.journal ?? null;
  }

  async stopAll(): Promise<void> {
    for (const l of this.live.values()) {
      await l.proxy.stop();
      l.relay.stop();
    }
    this.live.clear();
  }
}

/**
 * A resolver for replies that name no provider: OpenRouter's generation record (a free read by id) through an
 * in-process direct proxy's free route, as main's tbv driver reads it. Its provider_name is the serving provider.
 */
export function generationResolver(proxy: { port: number; bind(r: BindRequest): Binding; unbind(slot: string): void }, runId: string, send: (url: string, init: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): (id: string) => Promise<string | null> {
  return async (id) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    const b = proxy.bind({ cell: { run_id: runId, arm: "dc", task: "generation-record", model: "openrouter", trial: 1, attempt: 1 }, models: ["openrouter:generation"], allowance_micros: 1 });
    try {
      const res = await send("http://127.0.0.1:" + proxy.port + "/" + b.slot + "/openrouter/v1/generation?id=" + id, { headers: { authorization: "Bearer " + b.token } });
      if (res.status !== 200) return null;
      const name = ((await res.json()) as { data?: { id?: unknown; provider_name?: unknown } })?.data;
      return name?.id === id && typeof name.provider_name === "string" ? name.provider_name : null;
    } catch {
      return null;
    } finally {
      proxy.unbind(b.slot);
    }
  };
}

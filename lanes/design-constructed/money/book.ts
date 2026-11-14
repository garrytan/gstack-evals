// Copyright (c) 2026 Garry Tan. MIT License.
// The money controller (plan section 5, L1 to L3; R2-7, R2-8, R2-17, R2-20): one lease per item and run id, opened and
// held here, and every frozen run a named sub-reservation inside it. Admission counts settled spend, every in-flight
// reservation and every unknown charge at its full reservation, carried apart. A refusal waits while anything on its
// item is in flight and is a cap stop only when nothing is in flight and it still doesn't fit. A recorded cap stop
// closes its whole item. Every admission is copied off host and acknowledged before it is answered (R2-4).
import { isAbsolute } from "node:path";
import { LEDGER_ITEMS, MONEY, RECIPES } from "../frozen.ts";
import type { AnyModel, LedgerItemId, Model } from "../types.ts";
import type { Admission, ItemFigures, LeaseInfo, LeaseSeam, SessionSlot, Sub, SubKind } from "./types.ts";
import type { WriteAhead } from "./wal.ts";

export const $ = (usd: number) => Math.round(usd * 1_000_000);
export const dollars = (micros: number) => "$" + (micros / 1_000_000).toFixed(2);

/** BT (L7): a lease's time to live covers its stage plus a day, within main's 7-day ceiling; one day by default. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** A stop scope (L5): which work it covers. Null fields match anything. */
export interface ScopeStop {
  code: string;
  items: LedgerItemId[] | null;
  model: AnyModel | null;
  subject: Model | null;
  arm: string | null;
  stage: string | null;
  why: string;
  /** Only the Captain lifts it (PD-9 and every start rule 3 stop). */
  captain: boolean;
}

interface ItemState {
  lease: LeaseInfo | null;
  leases: LeaseInfo[];
  closed: string | null;
  paused: { why: string; allowTag: string | null; captain: boolean } | null;
  /** Settle the lease once nothing on the item is in flight; capStop marks a cap stop. */
  settleWhenDrained: { capStop?: string } | null;
  waiters: Array<() => void>;
}

/** What one admission asks for. */
export interface Draft {
  kind: SubKind;
  run: string;
  reserveMicros: number;
  model?: AnyModel | null;
  subject?: Model | null;
  arm?: string | null;
  stage?: string | null;
  tag?: string | null;
  retry?: boolean;
  sessions?: SessionSlot[];
  vm?: Sub["vm"];
}

export interface ControllerOptions {
  runId: string;
  /** The run id's fixed holder directory (R2-17): the same absolute path on a replacement host, apart from any launch sink. */
  holder: string;
  leases: LeaseSeam;
  wal?: WriteAhead | null;
  now?: () => Date;
}

export interface BookJson {
  runId: string;
  holder: string;
  n: number;
  subs: Sub[];
  items: Array<[LedgerItemId, Omit<ItemState, "waiters">]>;
  stops: ScopeStop[];
}

const IN_FLIGHT_LIMIT = (item: LedgerItemId, kind: SubKind): { limit: number; of: SubKind[] } => {
  const a = LEDGER_ITEMS[item].admission;
  if (kind === "recipe") return { limit: 1, of: ["recipe"] };
  if (kind === "oracle") return { limit: 1, of: ["oracle"] };
  if (kind === "call" && a.kind === "direct") return { limit: a.maxInFlight, of: ["call"] };
  return { limit: Infinity, of: [] };
};

export class MoneyController {
  readonly runId: string;
  readonly holder: string;
  private n = 0;
  private subs = new Map<string, Sub>();
  private items = new Map<LedgerItemId, ItemState>();
  private stops: ScopeStop[] = [];
  private readonly now: () => Date;

  constructor(private readonly o: ControllerOptions) {
    if (!isAbsolute(o.holder)) throw new Error("the holder directory is an absolute path, fixed per run id (R2-17), not " + o.holder);
    this.runId = o.runId;
    this.holder = o.holder;
    this.now = o.now ?? (() => new Date());
  }

  private state(item: LedgerItemId): ItemState {
    let s = this.items.get(item);
    if (!s) this.items.set(item, (s = { lease: null, leases: [], closed: null, paused: null, settleWhenDrained: null, waiters: [] }));
    return s;
  }

  /** Appends a bookkeeping line. Only admissions need the acknowledgement; a failure here leaves the log broken, which refuses the next admission. */
  private async log(entry: Record<string, unknown>): Promise<void> {
    if (!this.o.wal) return;
    try {
      await this.o.wal.append(entry);
    } catch {}
  }

  private wake(item: LedgerItemId): void {
    const s = this.state(item);
    const w = s.waiters.splice(0);
    for (const f of w) f();
  }

  /** Resolves at the next settlement, release, resume or close on the item. */
  nextChange(item: LedgerItemId): Promise<void> {
    return new Promise((resolve) => this.state(item).waiters.push(resolve));
  }

  /** Opens the item's one lease for this run id, or returns the open one. No other process opens a lease. */
  async openItem(item: LedgerItemId, ttlMs = DEFAULT_TTL_MS): Promise<LeaseInfo> {
    if (!LEDGER_ITEMS[item].leased) throw new Error("line item " + item + " has no lease; thread counters report it");
    const s = this.state(item);
    if (s.closed) throw new Error("line item " + item + " is closed: " + s.closed);
    if (s.lease) return s.lease;
    const lease = this.o.leases.open({ item, runId: this.runId, holder: this.holder, ttlMs, now: this.now() });
    s.lease = lease;
    s.leases.push(lease);
    await this.log({ kind: "lease", lease });
    return lease;
  }

  lease(item: LedgerItemId): LeaseInfo | null {
    return this.state(item).lease;
  }

  sub(id: string): Sub | undefined {
    return this.subs.get(id);
  }

  subsOf(item?: LedgerItemId): Sub[] {
    return [...this.subs.values()].filter((s) => item === undefined || s.item === item);
  }

  figures(item: LedgerItemId): ItemFigures {
    const s = this.state(item);
    const f: ItemFigures = { item, capMicros: $(LEDGER_ITEMS[item].capUsd), settledMicros: 0, inFlightMicros: 0, unknownMicros: 0, inFlightCount: 0, leaseId: s.lease?.leaseId ?? null, closed: s.closed !== null, paused: s.paused?.why ?? null };
    for (const sub of this.subs.values()) {
      if (sub.item !== item) continue;
      if (sub.state === "in-flight") {
        f.inFlightMicros += sub.reserveMicros;
        f.inFlightCount++;
      }
      f.settledMicros += sub.spentMicros;
      f.unknownMicros += sub.unknownMicros;
    }
    return f;
  }

  private leaseHeld(item: LedgerItemId, leaseId: string): number {
    let held = 0;
    for (const sub of this.subs.values()) if (sub.item === item && sub.leaseId === leaseId) held += sub.spentMicros + sub.unknownMicros + (sub.state === "in-flight" ? sub.reserveMicros : 0);
    return held;
  }

  /** The stop scope that covers a draft, if any. */
  stopFor(item: LedgerItemId, d: { model?: AnyModel | null; subject?: Model | null; arm?: string | null; stage?: string | null; sessions?: SessionSlot[] }): ScopeStop | undefined {
    const arms = d.sessions?.length ? d.sessions.map((x) => x.arm) : [d.arm ?? null];
    return this.stops.find((st) => {
      if (st.items && !st.items.includes(item)) return false;
      if (st.model && st.model !== d.model) return false;
      if (st.subject && st.subject !== d.subject) return false;
      if (st.stage && st.stage !== d.stage) return false;
      if (st.arm && !arms.includes(st.arm)) return false;
      return true;
    });
  }

  scopeStops(): ScopeStop[] {
    return [...this.stops];
  }

  /** The admission rule every kind shares. */
  async admit(item: LedgerItemId, d: Draft): Promise<Admission> {
    const s = this.state(item);
    if (s.closed) return { kind: "closed", why: "line item " + item + " is closed: " + s.closed };
    const stop = this.stopFor(item, d);
    if (stop) return { kind: "stopped", code: stop.code, why: stop.why };
    if (s.paused && !(s.paused.allowTag !== null && d.tag === s.paused.allowTag)) return s.paused.captain ? { kind: "captain", why: s.paused.why } : { kind: "wait", why: s.paused.why };
    if (!s.lease) return { kind: "closed", why: "line item " + item + " has no open lease for run " + this.runId };
    if (this.o.wal?.broken) return { kind: "unacked", why: this.o.wal.broken };
    const inFlight = this.subsOf(item).filter((x) => x.state === "in-flight");
    const lim = IN_FLIGHT_LIMIT(item, d.kind);
    const busy = inFlight.filter((x) => lim.of.includes(x.kind)).length;
    if (busy >= lim.limit) return { kind: "wait", why: item + " already has " + busy + " " + d.kind + (busy === 1 ? "" : "s") + " in flight, its limit" };
    const f = this.figures(item);
    const room = Math.min(f.capMicros - f.settledMicros - f.inFlightMicros - f.unknownMicros, s.lease.reservedMicros - this.leaseHeld(item, s.lease.leaseId));
    const ask = item + " has " + dollars(room) + " of room (" + dollars(f.settledMicros) + " settled, " + dollars(f.inFlightMicros) + " in flight, " + dollars(f.unknownMicros) + " unknown, cap " + dollars(f.capMicros) + "); " + d.run + " needs " + dollars(d.reserveMicros);
    if (d.reserveMicros > room) {
      const freeing = inFlight.filter((x) => !x.vm?.controller);
      if (freeing.length > 0) return { kind: "wait", why: ask + "; " + freeing.length + " in flight, so it waits" };
      await this.capStop(item, ask);
      return { kind: "cap-stop", why: ask + "; nothing in flight, so it is a cap stop" };
    }
    const sub: Sub = {
      id: item + "#" + ++this.n,
      item,
      run: d.run,
      holder: this.holder,
      reserveUsd: d.reserveMicros / 1_000_000,
      kind: d.kind,
      leaseId: s.lease.leaseId,
      model: d.model ?? null,
      subject: d.subject ?? null,
      arm: d.arm ?? null,
      stage: d.stage ?? null,
      tag: d.tag ?? null,
      retry: d.retry ?? false,
      reserveMicros: d.reserveMicros,
      spentMicros: 0,
      unknownMicros: 0,
      state: "in-flight",
      sessions: d.sessions ?? [],
      vm: d.vm ?? null,
    };
    this.subs.set(sub.id, sub);
    if (this.o.wal) {
      try {
        await this.o.wal.append({ kind: "admit", sub });
      } catch (e) {
        this.subs.delete(sub.id);
        this.wake(item);
        return { kind: "unacked", why: (e as Error).message + "; " + d.run + " is not forwarded" };
      }
    }
    return { kind: "admitted", sub };
  }

  /** Retries an admission after each change on its item while it answers wait. */
  async admitWhenReady(item: LedgerItemId, attempt: () => Promise<Admission>): Promise<Admission> {
    for (;;) {
      const next = this.nextChange(item);
      const r = await attempt();
      if (r.kind !== "wait") return r;
      await next;
    }
  }

  /** A direct call at the metering proxy's own worst case (L1). At most 8 in flight on its item. */
  admitCall(item: LedgerItemId, c: { run: string; model: AnyModel; worstCaseMicros: number; subject?: Model | null; arm?: string | null; stage?: string | null; tag?: string | null }): Promise<Admission> {
    if (LEDGER_ITEMS[item].admission.kind !== "direct") throw new Error(item + " admits " + LEDGER_ITEMS[item].admission.kind + ", not direct calls");
    if (!Number.isSafeInteger(c.worstCaseMicros) || c.worstCaseMicros <= 0) throw new Error("a direct call's worst case is a positive whole number of micros");
    return this.admit(item, { kind: "call", run: c.run, reserveMicros: c.worstCaseMicros, model: c.model, subject: c.subject, arm: c.arm, stage: c.stage, tag: c.tag });
  }

  /**
   * A round of sessions on a session item (L2): room for every session at full allowance, twice over for the one retry,
   * which runs inside the round's reservation.
   */
  admitRound(item: LedgerItemId, r: { run: string; model: Model; arms: string[]; stage?: string | null }): Promise<Admission> {
    const a = LEDGER_ITEMS[item].admission;
    if (a.kind !== "sessions" || item === "dc-base-apps") throw new Error(item + " does not admit rounds");
    if (r.arms.length === 0 || r.arms.length > a.perRound) throw new Error("a round on " + item + " holds 1 to " + a.perRound + " sessions, not " + r.arms.length);
    const sessions = r.arms.map((arm, i) => ({ id: r.run + "/" + (i + 1), arm, state: "pending" as const }));
    return this.admit(item, { kind: "round", run: r.run, reserveMicros: r.arms.length * 2 * $(a.allowanceUsd), model: r.model, stage: r.stage ?? null, sessions });
  }

  /** One recipe session at one $5.00 allowance, one at a time; a J1 retry is admitted on its own (R2-7). */
  admitRecipe(r: { run: string; retry?: boolean }): Promise<Admission> {
    return this.admit("dc-base-apps", { kind: "recipe", run: r.run, reserveMicros: $(RECIPES.session.usd), model: "opus", stage: "recipes", retry: r.retry ?? false });
  }

  /** One oracle build at a time inside dc-stage3-authoring against the $30 reserve. */
  admitOracle(r: { run: string }): Promise<Admission> {
    return this.admit("dc-stage3-authoring", { kind: "oracle", run: r.run, reserveMicros: $(MONEY.oracleBuildReserveUsd), model: "opus", stage: "stage3" });
  }

  startSession(subId: string, sessionId: string): void {
    const slot = this.subs.get(subId)?.sessions.find((x) => x.id === sessionId);
    if (!slot || slot.state !== "pending") throw new Error("session " + sessionId + " of " + subId + " is not pending");
    slot.state = "started";
  }

  /** Releases a session that never started, with its share of the round's reservation. */
  async releaseSession(subId: string, sessionId: string): Promise<void> {
    const sub = this.subs.get(subId);
    const slot = sub?.sessions.find((x) => x.id === sessionId);
    if (!sub || !slot || slot.state !== "pending" || sub.state !== "in-flight") return;
    const a = LEDGER_ITEMS[sub.item].admission;
    if (a.kind !== "sessions") return;
    slot.state = "released";
    sub.reserveMicros -= 2 * $(a.allowanceUsd);
    sub.reserveUsd = sub.reserveMicros / 1_000_000;
    await this.log({ kind: "release-session", sub: subId, session: sessionId });
    if (sub.sessions.every((x) => x.state === "released")) return this.release(subId);
    this.wake(sub.item);
  }

  /** Settles a sub-reservation at its recorded spend; unknownMicros stays held at its full reservation until reconciled. */
  async settle(subId: string, f: { spentMicros: number; unknownMicros?: number }): Promise<void> {
    const sub = this.subs.get(subId);
    if (!sub) throw new Error("no sub-reservation " + subId);
    if (sub.state !== "in-flight") throw new Error("sub-reservation " + subId + " is " + sub.state);
    const unknown = f.unknownMicros ?? 0;
    if (!Number.isSafeInteger(f.spentMicros) || f.spentMicros < 0 || !Number.isSafeInteger(unknown) || unknown < 0) throw new Error("spend and unknown charge are whole non-negative micros");
    sub.spentMicros = f.spentMicros;
    sub.unknownMicros = unknown;
    sub.state = unknown > 0 ? "unknown" : "settled";
    for (const x of sub.sessions) if (x.state !== "released") x.state = "done";
    await this.log({ kind: "settle", sub: subId, spent: f.spentMicros, unknown });
    await this.afterChange(sub.item);
  }

  /** Holds the whole reservation as unknown, as a lost answer or a crash leaves it. */
  markUnknown(subId: string): Promise<void> {
    const sub = this.subs.get(subId);
    if (!sub) throw new Error("no sub-reservation " + subId);
    return this.settle(subId, { spentMicros: 0, unknownMicros: sub.reserveMicros });
  }

  /** Settles an unknown charge against provider usage (L3). */
  async reconcile(subId: string, spentMicros: number): Promise<void> {
    const sub = this.subs.get(subId);
    if (!sub || sub.state !== "unknown") throw new Error("sub-reservation " + subId + " holds no unknown charge");
    sub.spentMicros += spentMicros;
    sub.unknownMicros = 0;
    sub.state = "settled";
    await this.log({ kind: "reconcile", sub: subId, spent: spentMicros });
    this.wake(sub.item);
  }

  /** Releases work that never ran. */
  async release(subId: string): Promise<void> {
    const sub = this.subs.get(subId);
    if (!sub || sub.state !== "in-flight") return;
    sub.state = "released";
    for (const x of sub.sessions) x.state = "released";
    await this.log({ kind: "release", sub: subId });
    await this.afterChange(sub.item);
  }

  private async afterChange(item: LedgerItemId): Promise<void> {
    const s = this.state(item);
    if (s.settleWhenDrained && s.lease && this.figures(item).inFlightCount === 0) await this.settleLeaseNow(item, s.settleWhenDrained.capStop);
    this.wake(item);
  }

  private async settleLeaseNow(item: LedgerItemId, capStop?: string): Promise<void> {
    const s = this.state(item);
    if (!s.lease) return;
    const lease = s.lease;
    s.lease = null;
    s.settleWhenDrained = null;
    const close = this.o.leases.settle(lease.leaseId, capStop);
    if (capStop) s.closed = "cap stop: " + capStop;
    await this.log({ kind: "lease-settled", item, lease: lease.leaseId, capStop: capStop ?? null, close });
    this.wake(item);
  }

  /** Records a cap stop and settles the lease with it; the item closes for good (R2-20). */
  async capStop(item: LedgerItemId, why: string): Promise<void> {
    const s = this.state(item);
    if (!s.lease) {
      s.closed ??= "cap stop: " + why;
      return;
    }
    this.o.leases.recordStop(s.lease.leaseId, why);
    await this.log({ kind: "cap-stop", item, lease: s.lease.leaseId, why });
    for (const sub of this.subsOf(item)) if (sub.state === "in-flight" && sub.sessions.length && sub.sessions.every((x) => x.state === "pending")) await this.release(sub.id);
    if (this.figures(item).inFlightCount === 0) await this.settleLeaseNow(item, why);
    else {
      s.settleWhenDrained = { capStop: why };
      s.closed = "cap stop: " + why;
    }
  }

  /** Settles the item's lease with no cap stop, now or once nothing on it is in flight. Returns true when settled now. */
  async settleItem(item: LedgerItemId): Promise<boolean> {
    const s = this.state(item);
    if (!s.lease) return true;
    if (this.figures(item).inFlightCount === 0) {
      await this.settleLeaseNow(item);
      return true;
    }
    s.settleWhenDrained = {};
    return false;
  }

  /** Holds new admissions on the item (renewal, the first judge packet, a refused stage). */
  async pause(item: LedgerItemId, why: string, o: { allowTag?: string | null; captain?: boolean } = {}): Promise<void> {
    this.state(item).paused = { why, allowTag: o.allowTag ?? null, captain: o.captain ?? false };
    await this.log({ kind: "pause", item, why, captain: o.captain ?? false });
  }

  async resume(item: LedgerItemId, o: { captain?: boolean } = {}): Promise<void> {
    const s = this.state(item);
    if (s.paused?.captain && !o.captain) throw new Error(item + " is held for the Captain: " + s.paused.why);
    s.paused = null;
    await this.log({ kind: "resume", item });
    this.wake(item);
  }

  /** Resolves once nothing on the item is in flight. */
  async drained(item: LedgerItemId): Promise<void> {
    while (this.figures(item).inFlightCount > 0) await this.nextChange(item);
  }

  /** Adds a stop scope; admissions it covers are refused from now on. */
  async addStop(st: ScopeStop): Promise<void> {
    if (!this.stops.some((x) => JSON.stringify(x) === JSON.stringify(st))) this.stops.push(st);
    await this.log({ kind: "stop", stop: st });
    for (const item of this.items.keys()) this.wake(item);
  }

  /** Lifts a stop scope; a Captain stop needs the Captain. */
  async liftStop(code: string, o: { captain?: boolean } = {}): Promise<void> {
    if (this.stops.some((x) => x.code === code && x.captain) && !o.captain) throw new Error(code + " lifts only on the Captain's word");
    this.stops = this.stops.filter((x) => x.code !== code);
    await this.log({ kind: "lift", code });
  }

  toJSON(): BookJson {
    return {
      runId: this.runId,
      holder: this.holder,
      n: this.n,
      subs: structuredClone([...this.subs.values()]),
      items: [...this.items.entries()].map(([k, v]) => [k, structuredClone({ lease: v.lease, leases: v.leases, closed: v.closed, paused: v.paused, settleWhenDrained: v.settleWhenDrained })]),
      stops: structuredClone(this.stops),
    };
  }

  /** Rebuilds a controller from a snapshot's book. Recovery (durability.ts) then applies the lines after its watermark. */
  static restore(json: BookJson, o: ControllerOptions): MoneyController {
    if (json.runId !== o.runId || json.holder !== o.holder) throw new Error("the snapshot is run " + json.runId + " at " + json.holder + ", not run " + o.runId + " at " + o.holder);
    const c = new MoneyController(o);
    c.n = json.n;
    for (const sub of json.subs) c.subs.set(sub.id, sub);
    for (const [k, v] of json.items) c.items.set(k, { ...v, waiters: [] });
    c.stops = json.stops;
    return c;
  }

  /** Recovery only: puts a sub-reservation back as the off-host copy holds it. */
  adopt(sub: Sub): void {
    this.subs.set(sub.id, sub);
    const n = Number(sub.id.split("#")[1]);
    if (n > this.n) this.n = n;
  }

  /** Recovery only: applies a structural line (a lease, a settled lease, a cap stop, a pause or a stop scope). */
  applyStructural(e: Record<string, unknown>): void {
    const kind = e.kind;
    if (kind === "lease") {
      const lease = e.lease as LeaseInfo;
      const s = this.state(lease.item);
      if (!s.leases.some((l) => l.leaseId === lease.leaseId)) s.leases.push(lease);
      s.lease = lease;
    } else if (kind === "lease-settled") {
      const s = this.state(e.item as LedgerItemId);
      if (s.lease?.leaseId === e.lease) s.lease = null;
      if (e.capStop) s.closed = "cap stop: " + e.capStop;
    } else if (kind === "cap-stop") this.state(e.item as LedgerItemId).closed = "cap stop: " + e.why;
    else if (kind === "pause") this.state(e.item as LedgerItemId).paused = { why: e.why as string, allowTag: null, captain: e.captain === true };
    else if (kind === "resume") this.state(e.item as LedgerItemId).paused = null;
    else if (kind === "stop") this.stops.push(e.stop as ScopeStop);
    else if (kind === "lift") this.stops = this.stops.filter((x) => x.code !== e.code);
  }

  /** Recovery only: forgets an open lease the lost host held, once the owner has reconciled it. */
  dropLease(item: LedgerItemId): void {
    this.state(item).lease = null;
  }

  openItems(): LedgerItemId[] {
    return [...this.items.entries()].filter(([, v]) => v.lease !== null).map(([k]) => k);
  }
}

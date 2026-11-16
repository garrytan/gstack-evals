// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit read's money (prereg 2026-11-15-geva-537 section 12, the Captain's condition 3), on main's ledger
// (src/runner/ledger/) as the eng-build lane uses it (lanes/eng-build/ledger.ts): one program, one line item per row of
// the money table with its cap, and every lease on run EP_RUN. The reserve ($150) stays with the Captain and is never
// inited; hosts and crew are not ledger items, so their figures come in as flags.
//
// The item gate decides, inside the item's lease, whether a session may start:
// - Admission: a session starts only when the item's settled spend, plus FROZEN.money.inflightUsd for each attempt in
//   flight, plus the new attempt's allowance (ALLOWANCE_USD by kind), fits under the cap. When it does not fit and
//   nothing is in flight, the item stops (E_EP_REPROJECT): it cannot finish under its cap.
// - The first session of each item runs alone. When it settles, the item is re-projected; past its cap, the item stops
//   (E_EP_REPROJECT).
// - From the 10th settled session on, the item is re-projected after each one, and past its cap it halts (E_EP_REPROJECT).
// - The re-projection is settled spend plus, for each kind of session, the sessions still planned times that kind's
//   running mean, or the plan's planning figure for a kind not yet measured.
// - The all-in projection is, over every item, its settled spend when it is finished and its re-projection otherwise
//   (its plan projection before it starts), plus the crew and host figures. Past FROZEN.money.allInStopUsd it stops
//   everything (E_EP_PROJECTION), checked before every session starts and after every session settles. Each gate writes
//   its item's state to <state dir>/<item>.json, which the other items' gates read.
// Build-time choices where the plan is silent: a model call is a session for the gate, with a $2 allowance; settled
// spend is the sum of the item's recorded session costs (the run's records, read back on resume); "after 10 sessions"
// checks at the 10th settle and every settle after it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Launcher } from "../../eng-build/pipeline.ts";
import { openLease, settleLease, type RequireAdmission } from "../../../src/runner/ledger/ledger.ts";
import { openLocalLedger, type LocalLedger } from "../../../src/runner/ledger/local.ts";
import { ledgerPath } from "../../../src/runner/ledger/paths.ts";
import { EpError, fail } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import { ALLOWANCE_USD, EP_PROGRAM, EP_RUN, EP_SKILL } from "./local.ts";

export type Kind = "review:plain" | "review:engphase" | "review:standalone" | "build" | "call";
export const kindAllowance = (k: Kind): number => (k === "build" ? ALLOWANCE_USD.build : k === "call" ? ALLOWANCE_USD.call : ALLOWANCE_USD.review);

export interface ItemPlan {
  item: string;
  row: string;
  projectionUsd: number;
  capUsd: number;
  /** The sessions each kind plans and the planning figure for one, from section 12. */
  kinds: Partial<Record<Kind, { planned: number; usd: number }>>;
}

/** Section 12's planning figures: Opus reviews (the skill arms with the Stop hook's assumed 25%), and one build. */
export const FIGURES = { review: { plain: 0.54, standalone: 2.74, engphase: 3.51 }, build: 2.5, authorCalls: 0.7, judgeCall: 0.25 } as const;
const cells = SIZE.units * SIZE.k;
const QUALIFIERS = FROZEN.supply.targetQualifiers;
const DRAWN = SIZE.units + SIZE.calibration + SIZE.reserve;

/** One line item per row of section 12's table, each with its cap. */
export const ITEMS: readonly ItemPlan[] = [
  { item: "ep-comparison", row: "Comparison reviews and builds: 64 units x 3 x ($0.54 + $2.74 + $3.51 + 3 x $2.50), the pilot's 40 plain inside", projectionUsd: 2744, capUsd: 3230, kinds: { "review:plain": { planned: cells, usd: FIGURES.review.plain }, "review:standalone": { planned: cells, usd: FIGURES.review.standalone }, "review:engphase": { planned: cells, usd: FIGURES.review.engphase }, build: { planned: 3 * cells, usd: FIGURES.build } } },
  { item: "ep-stock", row: "Stock control builds: 64 x $2.50", projectionUsd: 160, capUsd: 190, kinds: { build: { planned: SIZE.units * SIZE.kControl, usd: FIGURES.build } } },
  { item: "ep-authoring", row: "Authoring: about 115 qualifiers x ($0.70 for plan, audit, hint and two foreseeability ratings + $2.50 hinted build), plus 76 no-review builds x $2.50", projectionUsd: 560, capUsd: 680, kinds: { call: { planned: QUALIFIERS * 5, usd: FIGURES.authorCalls / 5 }, build: { planned: QUALIFIERS + DRAWN, usd: FIGURES.build } } },
  { item: "ep-smoke", row: "Exposure smoke: 12 Opus skill sessions", projectionUsd: 37, capUsd: 50, kinds: { "review:standalone": { planned: SIZE.calibration, usd: FIGURES.review.standalone }, "review:engphase": { planned: SIZE.calibration, usd: FIGURES.review.engphase } } },
  { item: "ep-judge", row: "Judge: Astra two calls on about 450 bundles at high effort, gold on 48 by two labellers, controls", projectionUsd: 280, capUsd: 350, kinds: { call: { planned: 1120, usd: FIGURES.judgeCall } } },
];
/** Section 12's lines that are not ledger items: the all-in projection takes them as flags. */
export const NOT_ITEMS = { hosts: { projectionUsd: 90, capUsd: 130 }, crew: { projectionUsd: 450, capUsd: 500 }, reserve: { capUsd: FROZEN.money.reserveUsd } } as const;

export function itemOf(name: string): ItemPlan {
  return ITEMS.find((i) => i.item === name) ?? fail("E_USAGE", "no planted-unit line item " + name + "; the items are " + ITEMS.map((i) => i.item).join(", "));
}

/** Sum of an item plan's planned sessions at their planning figures. */
export const planProjection = (p: Pick<ItemPlan, "kinds">): number => Object.values(p.kinds).reduce((s, k) => s + k!.planned * k!.usd, 0);

/** Opens one lease on an item for the attempt's run. */
export function leaseItem(record: string, local: LocalLedger, item: string, o: { amount_micros?: number; requireAdmission?: RequireAdmission; now?: Date } = {}) {
  itemOf(item);
  return openLease(record, local, { item, run_id: EP_RUN, ...o });
}
export const settleItem = (record: string, local: LocalLedger, lease_id: string) => settleLease(record, local, lease_id);

/** A launcher for stub backends (the dry run and the tests): one lease on run EP_RUN, settled on close. */
export const stubLauncher = <B>(backend: B): Launcher<B> => async (p) => {
  const local = openLocalLedger(ledgerPath(p.ledger));
  try {
    const lease = leaseItem(p.record, local, p.item, { amount_micros: Math.round(p.capUsd * 1_000_000), requireAdmission: () => null });
    return {
      lease_id: lease.lease_id,
      backend,
      close: async () => {
        try {
          settleItem(p.record, local, lease.lease_id);
        } finally {
          local.close();
        }
      },
    };
  } catch (e) {
    local.close();
    throw e;
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// The item gate.

export interface Settled {
  kind: Kind;
  usd: number;
  /** The cell the session ran, when it has one. */
  cell?: string;
}

export interface ItemState {
  item: string;
  capUsd: number;
  settledUsd: number;
  sessions: number;
  reprojectionUsd: number;
  finished: boolean;
}

export interface AllIn {
  /** <dir>/<item>.json for every item's gate. */
  stateDir: string;
  crewUsd: number;
  hostsUsd: number;
}

const usd = (n: number) => "$" + n.toFixed(2);
const writeJson = (path: string, v: unknown) => {
  writeFileSync(path + ".tmp", JSON.stringify(v, null, 1) + "\n");
  renameSync(path + ".tmp", path);
};

/** The all-in projection: each item's settled spend when finished, its re-projection when open, its plan projection
 * before it starts; plus crew and hosts. */
export function allInProjection(a: AllIn, items: readonly ItemPlan[] = ITEMS): { usd: number; lines: string[] } {
  const lines: string[] = [];
  let total = a.crewUsd + a.hostsUsd;
  for (const i of items) {
    const file = join(a.stateDir, i.item + ".json");
    const s = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ItemState) : null;
    const v = s === null ? i.projectionUsd : s.finished ? s.settledUsd : s.reprojectionUsd;
    total += v;
    lines.push(i.item + " " + usd(v) + (s === null ? " (plan projection, not started)" : s.finished ? " (settled, finished)" : " (re-projection, " + s.sessions + " sessions settled)"));
  }
  lines.push("crew " + usd(a.crewUsd) + ", hosts " + usd(a.hostsUsd));
  return { usd: total, lines };
}

/** Stops everything when the all-in projection passes the Captain's $5,000 line. */
export function checkAllIn(a: AllIn, items: readonly ItemPlan[] = ITEMS): void {
  const p = allInProjection(a, items);
  if (p.usd > FROZEN.money.allInStopUsd) fail("E_EP_PROJECTION", "the all-in projection is " + usd(p.usd) + ", past " + usd(FROZEN.money.allInStopUsd) + " (" + p.lines.join("; ") + "); nothing more spends until the Captain gives Garry a heads-up and says go");
}

export class ItemGate {
  private done: Settled[] = [];
  private flying = 0;
  private stopped: EpError | null = null;
  private waiters: Array<() => void> = [];
  readonly capUsd: number;
  readonly planned: Partial<Record<Kind, number>>;

  /**
   * cap is the item's recorded cap (at most the plan's); planned overrides the plan's session counts (a smaller
   * comparison, a released arm). journal is the item's cost journal in the run (one JSON line per settled session):
   * the gate reads the sessions already settled from it and appends each one it settles, before the stage writes the
   * session's record, so a resume counts every session that spent.
   */
  constructor(readonly plan: ItemPlan, readonly o: { capUsd?: number; planned?: Partial<Record<Kind, number>>; journal?: string | null; allIn?: AllIn | null } = {}) {
    this.capUsd = o.capUsd ?? plan.capUsd;
    if (this.capUsd > plan.capUsd) fail("E_USAGE", plan.item + ": cap " + usd(this.capUsd) + " is above the plan's " + usd(plan.capUsd));
    for (const k of Object.keys(o.planned ?? {})) if (!(k in plan.kinds)) fail("E_USAGE", plan.item + " plans no " + k + " sessions");
    this.planned = Object.fromEntries(Object.entries(plan.kinds).map(([k, v]) => [k, o.planned?.[k as Kind] ?? v!.planned]));
    if (o.journal && existsSync(o.journal)) this.done = readFileSync(o.journal, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Settled);
    this.publish(false);
  }

  settled(): number {
    return this.done.reduce((s, d) => s + d.usd, 0);
  }
  sessions(): number {
    return this.done.length;
  }
  inFlight(): number {
    return this.flying;
  }

  /** Settled spend plus each kind's remaining planned sessions at its running mean, or its planning figure. */
  reprojection(): number {
    let total = this.settled();
    for (const [k, v] of Object.entries(this.plan.kinds) as Array<[Kind, { planned: number; usd: number }]>) {
      const mine = this.done.filter((d) => d.kind === k);
      const left = Math.max(0, (this.planned[k] ?? v.planned) - mine.length);
      const mean = mine.length ? mine.reduce((s, d) => s + d.usd, 0) / mine.length : v.usd;
      total += left * mean;
    }
    return total;
  }

  private publish(finished: boolean): void {
    if (!this.o.allIn) return;
    mkdirSync(this.o.allIn.stateDir, { recursive: true });
    const s: ItemState = { item: this.plan.item, capUsd: this.capUsd, settledUsd: this.settled(), sessions: this.done.length, reprojectionUsd: this.reprojection(), finished };
    writeJson(join(this.o.allIn.stateDir, this.plan.item + ".json"), s);
  }

  private stop(e: EpError): never {
    this.stopped ??= e;
    this.wake();
    throw e;
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private allIn(): void {
    if (!this.o.allIn) return;
    try {
      checkAllIn(this.o.allIn);
    } catch (e) {
      if (e instanceof EpError) this.stop(e);
      throw e;
    }
  }

  /** go: start the session now; wait: an attempt in flight must settle first. Throws the item's stop. */
  admit(kind: Kind): "go" | "wait" {
    if (this.stopped) throw this.stopped;
    if (!(kind in this.plan.kinds)) fail("E_USAGE", this.plan.item + " plans no " + kind + " sessions");
    this.allIn();
    if (this.done.length === 0 && this.flying > 0) return "wait";
    const need = this.settled() + FROZEN.money.inflightUsd * this.flying + kindAllowance(kind);
    if (need <= this.capUsd + 1e-9) return "go";
    if (this.flying > 0) return "wait";
    return this.stop(new EpError("E_EP_REPROJECT", this.plan.item + ": settled " + usd(this.settled()) + " plus one " + kind + " allowance of " + usd(kindAllowance(kind)) + " passes the cap " + usd(this.capUsd) + "; the item stops with its lease open and no session in flight"));
  }

  /** Waits for admission, then counts the session in flight. Throws the item's stop. */
  async acquire(kind: Kind): Promise<void> {
    while (this.admit(kind) === "wait") await new Promise<void>((r) => this.waiters.push(r));
    this.flying++;
  }

  /** An attempt that ended with nothing to record (it threw before or instead of settling). */
  abort(): void {
    this.flying = Math.max(0, this.flying - 1);
    this.wake();
  }

  /** Records one settled session (its journal line first), then runs the item's stops. */
  settle(kind: Kind, costUsd: number, cell = ""): void {
    this.flying = Math.max(0, this.flying - 1);
    const d: Settled = { kind, usd: costUsd, ...(cell ? { cell } : {}) };
    if (this.o.journal) {
      mkdirSync(dirname(this.o.journal), { recursive: true });
      appendFileSync(this.o.journal, JSON.stringify(d) + "\n");
    }
    this.done.push(d);
    this.publish(false);
    this.wake();
    const n = this.done.length;
    const r = this.reprojection();
    if (n === 1 && r > this.capUsd + 1e-9) this.stop(new EpError("E_EP_REPROJECT", this.plan.item + ": the first session, run alone, cost " + usd(costUsd) + " and re-projects the item to " + usd(r) + ", past its cap " + usd(this.capUsd) + "; the item stops for the Captain"));
    if (n >= FROZEN.money.haltAfterSessions && r > this.capUsd + 1e-9) this.stop(new EpError("E_EP_REPROJECT", this.plan.item + ": after " + n + " sessions the running mean re-projects the item to " + usd(r) + ", past its cap " + usd(this.capUsd) + "; the item halts for the Captain"));
    this.allIn();
  }

  /** Marks the item finished: the all-in projection counts its settled spend from now on. */
  finish(): void {
    this.publish(true);
  }
}

/**
 * Runs cells through an item gate, at most parallel at a time: each waits for its admission, then runs. The first error
 * (a gate stop, a launcher's cap stop) stops new starts; cells already running finish and settle, then it is thrown.
 * run returns the session's cost, which the gate settles (its journal line) under the cell's key, and commit, which then
 * writes the session's record whether or not the settle stopped the item. A run that throws with spentUsd on its error (a
 * session that spent before its grading failed) has that spend settled under the cell's key, with no record, before the
 * error is thrown, so the gate's stops and a resume count it. skip, checked as each cell comes up, leaves a cell out
 * without a session (an arm the exposure stop ended).
 */
export async function runGated<C>(cells: readonly C[], o: { gate: ItemGate; parallel?: number; kind: (c: C) => Kind; key: (c: C) => string; skip?: (c: C) => boolean; run: (c: C) => Promise<{ costUsd: number; commit?: () => void }> }): Promise<void> {
  let next = 0;
  let first: unknown = null;
  const worker = async () => {
    while (first === null && next < cells.length) {
      const c = cells[next++]!;
      if (o.skip?.(c)) continue;
      const kind = o.kind(c);
      try {
        await o.gate.acquire(kind);
      } catch (e) {
        first ??= e;
        return;
      }
      if (first !== null) {
        o.gate.abort();
        return;
      }
      let ran: { costUsd: number; commit?: () => void };
      try {
        ran = await o.run(c);
      } catch (e) {
        first ??= e;
        const spent = (e as { spentUsd?: unknown } | null)?.spentUsd;
        if (typeof spent !== "number" || !(spent > 0)) {
          o.gate.abort();
          return;
        }
        try {
          o.gate.settle(kind, spent, o.key(c));
        } catch (s) {
          first ??= s;
        }
        return;
      }
      try {
        o.gate.settle(kind, ran.costUsd, o.key(c));
      } catch (e) {
        first ??= e;
      }
      try {
        ran.commit?.();
      } catch (e) {
        first ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.parallel ?? 1) }, worker));
  if (first !== null) throw first;
}

/** The run thread's steps for the program and its items (README style), with the owner's words left to fill in. */
export function runSteps(): string[] {
  const cap = ITEMS.reduce((s, i) => s + i.capUsd, 0);
  const tail = " --words <owner's words> --by <who> --source <ref>";
  return [
    "gstack-evals ledger envelope --program " + EP_PROGRAM + " --cap " + cap + " --skill-cap " + cap + " --skills " + EP_SKILL + " --credit-rate 1" + tail,
    ...ITEMS.map((i) => "gstack-evals ledger init --item " + i.item + " --cap " + i.capUsd + " --admission required --program " + EP_PROGRAM + " --skills " + EP_SKILL + tail),
    "# The $" + NOT_ITEMS.reserve.capUsd + " reserve stays with the Captain and is not inited; a draw is a ledger raise on the item it serves, with the Captain's words.",
    "# Hosts ($" + NOT_ITEMS.hosts.capUsd + " cap) and crew ($" + NOT_ITEMS.crew.capUsd + " cap) are not ledger items: pass their running figures to every paid ep command as --hosts-usd and --crew-usd.",
  ];
}

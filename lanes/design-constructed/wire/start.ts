// Copyright (c) 2026 Garry Tan. MIT License.
// What every paid row checks before it builds a provider (prereg section 14): the commit pin (rule 2), a sink directory
// that doesn't exist (rule 10), the row's own order rules (6, 7 and 8, passed in by the row), a dated terms record for
// each OpenRouter model it calls (rule 9), the keyless dry run (rule 5), and then the ledger admission: each item it
// spends on carries the cap the Captain recorded (rule 1), equal to the frozen cap, and is open, unstopped and has room;
// its one lease opens. Only the ledger is built for the admission; the model, session and VM providers come after.
import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { DcError, fail } from "../errors.ts";
import { LEDGER_ITEMS } from "../frozen.ts";
import { $, dollars } from "../money/book.ts";
import { applyStop, stopPlan, type StopContext } from "../money/stops.ts";
import type { TermsRecord } from "../read/start.ts";
import type { AnyModel, DcStopCode, LedgerItemId, Model } from "../types.ts";
import { build, type LedgerProvider, type Providers } from "../wire.ts";
import type { PowerRunner } from "../read/seams.ts";
import { readJson, writeJson } from "./json.ts";

export type Args = { flags: Map<string, string>; bools: Set<string>; rest: string[] };
export type Io = { out: (text: string) => void; err: (text: string) => void };

/** What a row runs against: the providers, the dry run, the lane's checkout, a clock and power.py's runner. */
export interface RowEnv {
  providers: Providers;
  /** Start rule 5: true when every keyless dry-run case passes. */
  dryRun: () => Promise<boolean>;
  lane: () => { commit: string; dirty: boolean; root: string };
  now: () => Date;
  power: PowerRunner;
  /** The structure screen's barred word runs, from gstack's skill files at the pin (author/screen.ts loadVocabulary). */
  vocabulary: (gstackDir: string) => ReadonlySet<string>;
}

export type Row = (a: Args, io: Io, env: RowEnv) => Promise<number> | number;

/** The OpenRouter models start rule 9 covers. */
export const OPENROUTER: readonly AnyModel[] = ["sol", "particle", "argon"];

export const refuse = (rule: string, why: string): never => {
  throw new DcError("E_DCW_START_RULE", "start rule " + rule + ": " + why);
};

export function need(a: Args, flag: string, usage: string): string {
  const v = a.flags.get(flag);
  if (v === undefined || a.rest.length) fail("E_USAGE", "usage: gstack-evals dc " + usage);
  return v!;
}

export function oneOf<T extends string>(a: Args, flag: string, values: readonly T[], usage: string): T {
  const v = need(a, flag, usage);
  if (!(values as readonly string[]).includes(v)) fail("E_USAGE", flag + " is one of " + values.join(", "));
  return v as T;
}

/** --terms: the dated terms records read from OpenRouter's endpoints API before the cap request (rule 9). */
export function termsFrom(a: Args): TermsRecord[] {
  const p = a.flags.get("--terms");
  return p === undefined ? [] : readJson<TermsRecord[]>(resolve(p), "--terms");
}

export interface StartPlan {
  row: string;
  /** --out: the launch's sink directory. */
  sink: string;
  items: readonly LedgerItemId[];
  models: readonly AnyModel[];
  terms: readonly TermsRecord[];
  /** The work's scope for stop scopes: a model's stop refuses only that model's rows. */
  scope?: { model?: AnyModel; subject?: Model; stage?: string };
  /** The row's own start rules (6, 7, 8): each returns null when it holds, or the refusal "<rule>: <why>". */
  rules?: ReadonlyArray<() => [string, string] | null>;
  /** The launch record's extra fields. */
  record?: Record<string, unknown>;
}

export interface Launch {
  sink: string;
  commit: string;
  ledger: LedgerProvider;
  lines: string[];
}

/** The ledger admission: rule 1's recorded cap, the frozen cap, an open unstopped item with room; then its one lease. */
export async function admitItems(l: LedgerProvider, items: readonly LedgerItemId[], scope: StartPlan["scope"] = {}): Promise<string[]> {
  const c = l.controller;
  const lines: string[] = [];
  const no = (why: string): never => {
    throw new DcError("E_DCW_LEDGER_REFUSED", why);
  };
  for (const item of items) {
    const frozen = $(LEDGER_ITEMS[item].capUsd);
    const cap = l.recordedCapMicros(item);
    if (cap === null) no("start rule 1: the Captain has recorded no cap for " + item + "; nothing is admitted on it");
    if (cap !== frozen) no(item + "'s recorded cap " + dollars(cap!) + " is not the frozen " + dollars(frozen) + "; the difference goes to the Captain");
    const f = c.figures(item);
    if (f.closed) no(item + " is closed; it reopens only on the Captain's word");
    const stop = c.stopFor(item, { model: scope.model ?? null, subject: scope.subject ?? null, stage: scope.stage ?? null });
    if (stop) no(item + " is under the " + stop.code + " stop: " + stop.why);
    const room = f.capMicros - f.settledMicros - f.inFlightMicros - f.unknownMicros;
    if (room <= 0) no(item + " has no room: " + dollars(f.settledMicros) + " settled, " + dollars(f.inFlightMicros) + " in flight, " + dollars(f.unknownMicros) + " unknown, cap " + dollars(f.capMicros));
    const lease = await c.openItem(item);
    lines.push("ledger: " + item + " admitted on lease " + lease.leaseId + ", room " + dollars(room) + " of " + dollars(f.capMicros));
  }
  return lines;
}

/** Every check before any provider but the ledger is built; then the sink and its launch record. */
export async function start(plan: StartPlan, env: RowEnv): Promise<Launch> {
  const lane = env.lane();
  if (!lane.commit) refuse("2", "the lane's commit can't be read, so the run can't be pinned to it");
  if (lane.dirty) refuse("2", "the checkout is dirty; a paid run is pinned to an exact commit, so commit first");
  const sink = resolve(plan.sink);
  const rel = relative(resolve(lane.root), sink);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) refuse("10", "--out must be a sealed folder outside the repository");
  if (existsSync(sink)) refuse("10", "the sink " + sink + " exists already; every launch uses a sink directory that doesn't exist before it");
  for (const rule of plan.rules ?? []) {
    const r = rule();
    if (r) refuse(r[0], r[1]);
  }
  for (const m of plan.models.filter((x) => OPENROUTER.includes(x))) {
    const t = plan.terms.find((x) => x.model === m);
    if (!t) refuse("9", m + " has no dated terms record (--terms); its provider and data terms are read before the cap request");
    if (t!.dataCollection !== "deny" || !t!.provider || !Number.isFinite(Date.parse(t!.dated)) || !/^[0-9a-f]{64}$/.test(t!.termsDigest)) refuse("9", m + "'s terms record needs a provider, a date, data collection denied and a sha256 of the terms");
  }
  if (!(await env.dryRun())) refuse("5", "the keyless dry run has a FAIL line; gstack-evals dc dryrun names it");
  const ledger = await build(env.providers, "ledger", plan.row);
  const lines = await admitItems(ledger, plan.items, plan.scope);
  mkdirSync(sink, { recursive: true });
  writeJson(sink + "/launch.json", { row: plan.row, commit: lane.commit, at: env.now().toISOString(), sink, items: plan.items, models: plan.models, terms: plan.terms.map((t) => ({ model: t.model, dated: t.dated, provider: t.provider })), ...plan.record });
  return { sink, commit: lane.commit, ledger, lines: ["launch: " + plan.row + " at " + lane.commit + " into a new sink", ...lines] };
}

const STOP_CODES: readonly string[] = ["E_DC_JUDGE_KAPPA", "E_DC_STOCK_FAIL", "E_DC_NO_READ", "E_DC_TWIN", "E_DC_SMOKE_DROP", "E_DC_EXPOSURE_STOP", "E_DC_SUPPLY_SHORT", "E_DC_AUTHOR_COST", "E_DC_GATE_CHECK", "E_DC_SANDBOX_AUDIT"] satisfies DcStopCode[];

/**
 * Runs a row's work under rule 3: a stop code thrown from it applies its frozen stop scope (it settles the open leases
 * it names and releases the rest) before it reaches the caller. A drift is applied where it is seen, so it passes.
 */
export async function underStops<T>(l: LedgerProvider, ctx: StopContext, work: () => Promise<T>, onStop: (code: string) => void = () => {}): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof DcError && STOP_CODES.includes(e.code)) {
      onStop(e.code);
      await applyStop(l.controller, stopPlan(e.code as DcStopCode, ctx));
    }
    throw e;
  }
}

/** Closes whatever a row built, the ledger last. */
export async function closeAll(...ps: Array<{ close?: () => Promise<void> } | null | undefined>): Promise<void> {
  for (const p of ps) await p?.close?.();
}

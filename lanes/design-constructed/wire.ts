// Copyright (c) 2026 Garry Tan. MIT License.
// The lane's composition module: every area's seams built from four providers. A provider is the one thing a paid row
// needs from outside the lane's own code: the ledger and its controller (money/), the model caller (money/meter.ts's
// metered client), the review session box (a container's RunBox, its shell and its driver run) and the VM world
// (Ubicloud, the controller's browser and the in-VM agents). Each is a factory, so nothing is built before a row's start
// rules and its ledger admission pass (wire/start.ts). The real providers plug into these interfaces; until they land,
// the lane binds none, and every paid row refuses with E_DCW_NO_PROVIDER after its checks. The dry run binds the keyless
// fakes in wire/fakes.ts.
import { ledgerStatus } from "../../src/runner/ledger/ledger.ts";
import type { Termination } from "../../src/types.ts";
import type { BlockParser, Caller, SpendReader } from "./author/seams.ts";
import { DcError } from "./errors.ts";
import { matchRoute } from "./frame/routes.ts";
import { $, type MoneyController } from "./money/book.ts";
import { admitVm, settleVm } from "./money/hosts.ts";
import { openMeter, type Meter, type MeterProxy } from "./money/meter.ts";
import { DIRECT_MODELS } from "./money/price.ts";
import { applyStop, stopPlan } from "./money/stops.ts";
import type { Admission as MoneyAdmission } from "./money/types.ts";
import { startRule9, type TermsRecord } from "./read/start.ts";
import type { BrowserSeam, RecipeAgent, RouteMatcher } from "./recipes/seams.ts";
import type { SessionSetup } from "./run/arms.ts";
import type { Cell, Exec, ParseBlock, Reconciled, RunBox } from "./run/types.ts";
import { normalizeChanges, parseChanges } from "./score/parse.ts";
import type { JudgeCaller } from "./score/seams.ts";
import type { VmBackend, VmSpec } from "./stage3/sandbox.ts";
import type { Admission, BuildAgent, BuildReader, HostsSeam, MoneySeam, PairwiseJudge, Stage3Authoring } from "./stage3/seams.ts";
import type { AnyModel, LedgerItemId, ListSource, Model } from "./types.ts";

// ---- The four providers

/** Where an OpenRouter model's call was served, as start rule 9 reads it. Null for Anthropic and OpenAI calls. */
export interface ServedTerms {
  provider: string;
  fallbacks: boolean;
  dataCollection: string;
  /** sha256 of the serving provider's data terms, read from OpenRouter's endpoints API at the call. */
  termsDigest: string;
}

/** One direct model call on one ledger item. */
export interface ModelCall {
  item: LedgerItemId;
  model: AnyModel;
  prompt: string;
  maxTokens: number;
  effort: string | null;
  /** A label for the ledger and logs (never prompt text). */
  label: string;
  /** The model under test whose lists the call reads, so a per-model stop cuts only that model. */
  subject: Model | null;
  tag: string | null;
}

export interface ModelReply {
  /** The reply text, or null when nothing came back (problem says why). */
  text: string | null;
  modelId: string;
  version: string | null;
  problem: string | null;
  served: ServedTerms | null;
}

/** The model caller: every author, judge and probe call goes through it, metered and admitted on its item. */
export interface ModelProvider {
  call(c: ModelCall): Promise<ModelReply>;
  close?(): Promise<void>;
}

/** The ledger: the controller that holds one lease per item and run id, the Captain's recorded caps, and J1. */
export interface LedgerProvider {
  controller: MoneyController;
  /** The cap the Captain recorded for the item in the approval record, in micros, or null when none is recorded. */
  recordedCapMicros(item: LedgerItemId): number | null;
  /** J1: the provider figure for an unknown sub-reservation, from the proxy journal and the session log, in micros. */
  reconcile(subId: string): Promise<number>;
  close?(): Promise<void>;
}

/** How one review session ended, as the driver reports it. */
export interface SessionDrive {
  /** The session's transcript.ndjson text. */
  transcript: string;
  termination: Termination;
  /** The API, the provider or the harness returned an error in the session's last exchange (decides a malformed tool call only). */
  errorSeen: boolean;
  /** plan.md after the session, or null when it is gone. */
  planAfter: string | null;
  /** Proxy-metered spend; null when unknown (held until reconciled). */
  spentUsd: number | null;
  /** The first served terms when the model runs through OpenRouter, else null. */
  served: ServedTerms | null;
}

/** One review container for one attempt: its run directory reads, its shell, and the driver run. */
export interface SessionBox {
  box: RunBox;
  exec: Exec;
  /** Runs the agent to its end. stop is the one Stop handler the wiring built, or null for none. */
  drive(stop: ((transcript: string) => string | null) | null): Promise<SessionDrive>;
  close(): Promise<void>;
}

/** The review session box: a fresh container per attempt, on the cell's round sub-reservation and its proxy. */
export interface SessionProvider {
  open(o: { cell: Cell; attempt: 1 | 2; setup: SessionSetup; unitDir: string; subId: string }): Promise<SessionBox>;
  /** J1: reconciles an attempt against its lease, the proxy's record and the session log, and says whether a judge read its block. */
  reconcile(cell: Cell, attempt: 1 | 2): Promise<Reconciled>;
  close?(): Promise<void>;
}

export type VmKind = "recipe" | "qualify" | "build" | "check";

/** The VM world: Ubicloud, the controller's browser and the agents that run inside VMs. */
export interface VmProvider {
  backend: VmBackend;
  /** Ubicloud's list price for one VM hour, read on the day, in micros (dc-hosts). */
  priceMicrosPerHour: number;
  /** Epoch milliseconds, for measured VM hours. */
  now: () => number;
  /** Recipe and build VMs carry the metering proxy and the named mirrors; qualify and check VMs the mirrors only. */
  spec(kind: VmKind, label: string): VmSpec;
  browser: BrowserSeam;
  recipeAgent: RecipeAgent;
  buildAgent: BuildAgent;
  buildReader: BuildReader;
  /** Stage 3's Opus writer and Sol auditor, and the DES-4 judges, whose prompts are not in the lane yet. */
  stage3Authoring: Stage3Authoring;
  pairwise: PairwiseJudge;
  close?(): Promise<void>;
}

/** The provider factories a row may build once its checks pass. Null is a provider not bound in this build. */
export interface Providers {
  ledger: (() => LedgerProvider) | null;
  model: (() => ModelProvider) | null;
  session: (() => SessionProvider) | null;
  vm: (() => VmProvider) | null;
}

export type ProviderName = keyof Providers;

/** The Captain's recorded cap per item, read from main's approval record (start rule 1). */
export const recordedCaps =
  (record: string) =>
  (item: LedgerItemId): number | null =>
    ledgerStatus(record, item)[0]?.cap_micros ?? null;

/** The real providers are built by other units; until they land, this build binds none. */
export const BOUND_PROVIDERS: Providers = { ledger: null, model: null, session: null, vm: null };

/** Builds one named provider, or refuses with E_DCW_NO_PROVIDER. Each row builds only what it uses, after its checks. */
export function build<K extends ProviderName>(p: Providers, name: K, row: string): ReturnType<NonNullable<Providers[K]>> {
  const f = p[name];
  if (!f) throw new DcError("E_DCW_NO_PROVIDER", row + " needs the " + name + " provider, and this build binds none; nothing was called");
  return f() as ReturnType<NonNullable<Providers[K]>>;
}

// ---- Seams other areas take from the score and frame areas

/** The run area's ParseBlock: the score area's strict parse, then its one lenient parse, then normalization. */
export const parseBlockFor =
  (source: ListSource): ParseBlock =>
  (reply) => {
    const p = parseChanges([reply]);
    return p.kind === "changes" ? { source, changes: normalizeChanges(p.changes).list } : null;
  };

/** The author area's BlockParser on the same parse and normalization (validators' blocks; see WIRING.md). */
export const blockParser: BlockParser = (reply) => parseBlockFor("none")(reply)?.changes ?? null;

/**
 * The recipes area's RouteMatcher on the frame's R2-19 matcher (frame/routes.ts, imported). A route carries its route
 * set's hash mode and literal base path; with no literal base path the recipe's base URL path is stripped.
 */
export const routeMatcher: RouteMatcher = (path, routes, o) =>
  routes.filter((r) => matchRoute(path, r.pattern, { hash: r.hash ?? false, basePath: r.basePath ?? (o.basePath || null) })).map((r) => r.id);

// ---- Model callers

/**
 * Start rule 9 on every model's first served call in this launch: a provider, fallback, data-collection or terms
 * difference from the dated record stops every call on that model in every role (PD-9) and throws E_DC_PROVIDER_DRIFT.
 */
export function termsGuard(controller: MoneyController, records: readonly TermsRecord[], log: (line: string) => void = () => {}) {
  const seen = new Set<AnyModel>();
  return async (model: AnyModel, served: ServedTerms | null): Promise<void> => {
    if (served === null || seen.has(model)) return;
    const record = records.find((r) => r.model === model);
    if (!record) throw new DcError("E_DCW_START_RULE", "start rule 9: " + model + " was served by " + served.provider + " with no dated terms record; nothing more is sent on it");
    seen.add(model);
    const r = startRule9(record, { model: record.model, provider: served.provider, fallbacks: served.fallbacks, dataCollection: served.dataCollection, termsDigest: served.termsDigest });
    log(r.line);
    if (r.ok) return;
    await applyStop(controller, stopPlan("E_DC_PROVIDER_DRIFT", { model }));
    throw new DcError("E_DC_PROVIDER_DRIFT", r.line);
  };
}

export type TermsGuard = ReturnType<typeof termsGuard>;

/** The author area's Caller on one item. A reply with no text throws, so the pipeline's resend never hides a refusal. */
export function authorCaller(models: ModelProvider, item: LedgerItemId, guard: TermsGuard): Caller {
  return async (req) => {
    const r = await models.call({ item, model: req.model, prompt: req.prompt, maxTokens: req.maxTokens, effort: req.effort, label: req.label, subject: null, tag: null });
    await guard(req.model, r.served);
    if (r.text === null) throw new DcError("E_DC_INFRA_MISSING", req.label + ": no reply (" + (r.problem ?? "no text") + ")");
    return { text: r.text };
  };
}

/** The score area's JudgeCaller on one item: judge to model, the call's cache identity as its tag unless one is given. */
export function judgeCaller(models: ModelProvider, item: LedgerItemId, guard: TermsGuard, tag?: string): JudgeCaller {
  return async (c) => {
    const r = await models.call({ item, model: c.judge, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label, subject: c.subject, tag: tag ?? c.cacheKey });
    await guard(c.judge, r.served);
    return { text: r.text, modelId: r.modelId, version: r.version, problem: r.problem };
  };
}

/** The author area's SpendReader: settled, in flight and unknown, carried apart (L1). */
export const spendReader =
  (c: MoneyController): SpendReader =>
  (item) => {
    const f = c.figures(item);
    return { settledUsd: f.settledMicros / 1e6, inFlightUsd: f.inFlightMicros / 1e6, unknownUsd: f.unknownMicros / 1e6 };
  };

/**
 * A ModelProvider on money/meter.ts: one metered client per item, each on that item's running metering proxy and its
 * lease. The real ledger provider supplies the proxies and figures; the dry run supplies an in-process proxy with a
 * scripted upstream. termsDigest reads the serving provider's data terms (OpenRouter's endpoints API, a free read).
 */
export function meteredModels(o: {
  controller: MoneyController;
  runId: string;
  proxy: (item: LedgerItemId) => MeterProxy;
  figures: (item: LedgerItemId) => (meterId: string) => { spentMicros: number; unknownMicros: number };
  cacheDir: string;
  out: string;
  termsDigest: (model: AnyModel, provider: string) => string;
  datedTerms?: Partial<Record<AnyModel, string>>;
  fetch?: typeof fetch;
  close?: () => Promise<void>;
}): ModelProvider {
  const meters = new Map<LedgerItemId, Meter>();
  const meterOf = (item: LedgerItemId): Meter => {
    let m = meters.get(item);
    if (!m) meters.set(item, (m = openMeter({ controller: o.controller, item, runId: o.runId, proxy: () => o.proxy(item), figures: o.figures(item), cacheDir: o.cacheDir, out: o.out, datedTerms: o.datedTerms, fetch: o.fetch })));
    return m;
  };
  return {
    async call(c) {
      const meter = meterOf(c.item);
      const r = await meter.call({ model: c.model, prompt: c.prompt, maxTokens: c.maxTokens, effort: c.effort, label: c.label, subject: c.subject, tag: c.tag });
      const id = DIRECT_MODELS[c.model];
      const routing = meter.terms().find((t) => t.model === c.model)?.routing as { allow_fallbacks?: boolean; data_collection?: string } | null | undefined;
      const served = id.provider === "openrouter" && r.servedBy ? { provider: r.servedBy, fallbacks: routing?.allow_fallbacks !== false, dataCollection: routing?.data_collection ?? "allow", termsDigest: o.termsDigest(c.model, r.servedBy) } : null;
      return { text: r.text, modelId: id.id, version: null, problem: r.problem, served };
    },
    close: o.close,
  };
}

// ---- Money seams for the recipe screen and stage 3

const refused = (a: MoneyAdmission): Admission => ({ ok: false, why: a.kind + ": " + ("why" in a ? a.why : "") });

/**
 * The recipes and stage 3 MoneySeam on the controller. A recipe session is one $5.00 sub-reservation, a J1 retry
 * admitted on its own; an oracle build one at a time on dc-stage3-authoring; a stage 3 build round its own reserve.
 */
export function moneySeam(l: LedgerProvider): MoneySeam {
  const c = l.controller;
  return {
    async admit(req) {
      const reserveMicros = $(req.reserveUsd);
      const attempt = (): Promise<MoneyAdmission> => {
        if (req.item === "dc-base-apps") return c.admitRecipe({ run: req.run, retry: / retry$/.test(req.run) });
        if (req.item === "dc-stage3-authoring") return c.admitOracle({ run: req.run });
        return c.admit(req.item, { kind: "round", run: req.run, reserveMicros, model: "opus", stage: "stage3" });
      };
      const a = await c.admitWhenReady(req.item, attempt);
      return a.kind === "admitted" ? { ok: true, id: a.sub.id } : refused(a);
    },
    async settle(id, spentUsd) {
      if (spentUsd === null) await c.markUnknown(id);
      else await c.settle(id, { spentMicros: $(spentUsd) });
    },
    async reconcile(id) {
      if (c.sub(id)?.state === "unknown") await c.reconcile(id, await l.reconcile(id));
    },
    async capStop(item, why) {
      if (!c.figures(item).closed) await c.capStop(item, why);
    },
    async release(item) {
      await c.settleItem(item);
    },
  };
}

/** dc-hosts: each VM's time to live as one atomic sub-reservation at the day's list price, settled at measured hours. */
export function hostsSeam(l: LedgerProvider, priceMicrosPerHour: number, stage: string): HostsSeam {
  const c = l.controller;
  return {
    async admit(req) {
      const a = await c.admitWhenReady("dc-hosts", () => admitVm(c, { vm: req.run, ttlHours: req.hours, priceMicrosPerHour, stage }));
      return a.kind === "admitted" ? { ok: true, id: a.sub.id } : refused(a);
    },
    async settle(id, hours) {
      const vm = c.sub(id)?.vm?.id;
      if (vm) await settleVm(c, vm, hours);
    },
  };
}

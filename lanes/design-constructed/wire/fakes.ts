// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless providers the dry run and the tests bind: the real money controller on main's ledger in a temporary
// folder (money/dryrun-fixture.ts's rig), the real metered client on the real metering proxy whose upstream answers
// from a script, the areas' own scripted VM world, browser and agents, and scripted review sessions on the run area's
// fake RunBox. Nothing here reads a key or reaches a network; the proxy gets invented key strings.
import { join, resolve } from "node:path";
import type { SessionEnd, Termination } from "../../../src/types.ts";
import { STAND_IN_VOCABULARY } from "../author/scripted.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import { fakeReply, rig, startProxy, type ProxyRig, type Rig } from "../money/dryrun-fixture.ts";
import { ledgerFigures } from "../money/meter.ts";
import type { PowerRunner } from "../read/seams.ts";
import { fakeBox, type FakeRun } from "../run/fixtures.ts";
import { cellId } from "../run/session.ts";
import type { Cell, Reconciled } from "../run/types.ts";
import { fixtureBrowser, RECIPE, type FixtureApp } from "../recipes/fixtures.ts";
import { fakeSpec, fakeMirrors } from "../stage3/fake.ts";
import { fixtureStage3, type Stage3Script } from "../stage3/fixtures.ts";
import type { AnyModel, LedgerItemId } from "../types.ts";
import { meteredModels, type LedgerProvider, type ModelCall, type ModelProvider, type ProviderName, type Providers, type ServedTerms, type SessionProvider, type Stage3Provider, type VmProvider } from "../wire.ts";
import { recordSeams } from "./real.ts";
import type { RowEnv } from "./start.ts";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
/** The digest the fake terms reader returns for every serving provider. */
export const FAKE_TERMS_DIGEST = "7".repeat(64);
export const FAKE_COMMIT = "0".repeat(40);
/** The provider each OpenRouter model's pin names, as OpenRouter returns it. */
export const SERVED: Partial<Record<AnyModel, string>> = { sol: "OpenAI", particle: "Particle", argon: "Google" };

export interface Kit {
  providers: Providers;
  /** The providers built, in order. */
  built: ProviderName[];
  /** The model calls that reached the scripted upstream, as "<model> <label>". */
  calls: string[];
  rig: () => Rig;
  /** Removes the rig's temporary ledger; the ledger provider's close leaves it, so later launches on the kit see its state. */
  dispose: () => void;
}

export interface KitOptions {
  caps?: Partial<Record<LedgerItemId, number>>;
  /** Items with no recorded cap (start rule 1). */
  unrecorded?: LedgerItemId[];
  /** J1 holds every unknown charge for the owner's reconcile (PD-18), as the real ledger provider does; else it reconciles at $0. */
  held?: boolean;
  /** The scripted reply to a model call; null sends no text. */
  model?: (c: ModelCall) => string | null | Promise<string | null>;
  /** The serving provider each OpenRouter model's reply names. */
  served?: Partial<Record<AnyModel, string>>;
  /** The VM world and stage 3's pieces, built once for both providers since they share one fake backend. */
  vm?: (kit: Kit) => VmProvider & Stage3Provider;
  session?: (kit: Kit) => SessionProvider;
}

/** The fake ledger, model caller, VM world and session box behind one kit; a provider left out stays unbound. */
export function fakeKit(o: KitOptions = {}): Kit {
  let r: Rig | null = null;
  const built: ProviderName[] = [];
  const calls: string[] = [];
  const kit: Kit = { built, calls, rig: () => r ?? (r = rig({ caps: o.caps })), dispose: () => r?.cleanup(), providers: { ledger: null, model: null, session: null, vm: null, stage3: null } };
  kit.providers.ledger = () => {
    built.push("ledger");
    const x = kit.rig();
    const r = recordSeams(x.record);
    return { controller: x.c, ...r, recordedCapMicros: (item) => (o.unrecorded?.includes(item) ? null : r.recordedCapMicros(item)), reconcile: async () => (o.held ? null : 0), close: async () => {} } satisfies LedgerProvider;
  };
  if (o.model) {
    const script = o.model;
    kit.providers.model = () => {
      built.push("model");
      return fakeModels(kit, script, { ...SERVED, ...o.served });
    };
  }
  if (o.vm) {
    const make = o.vm;
    let world: (VmProvider & Stage3Provider) | null = null;
    kit.providers.vm = () => {
      built.push("vm");
      return (world ??= make(kit));
    };
    kit.providers.stage3 = () => {
      built.push("stage3");
      return (world ??= make(kit));
    };
  }
  if (o.session) {
    const session = o.session;
    kit.providers.session = () => {
      built.push("session");
      return session(kit);
    };
  }
  return kit;
}

const modelOfId = (id: unknown): AnyModel | null => (Object.entries(DIRECT_MODELS).find(([, m]) => m.id === id)?.[0] as AnyModel | undefined) ?? null;

/** The real metered client on a real proxy per item, its upstream answering each call with the script's text. */
export function fakeModels(kit: Kit, script: (c: ModelCall) => string | null | Promise<string | null>, served: Partial<Record<AnyModel, string>>): ModelProvider {
  const r = kit.rig();
  const pending = new Map<string, Array<string | null>>();
  const proxies = new Map<LedgerItemId, ProxyRig>();
  const upstream = (url: string, body: any): Response => {
    const model = modelOfId(body?.model);
    const prompt = (body?.messages ?? body?.input)?.[0]?.content;
    const queue = model && typeof prompt === "string" ? pending.get(model + "\n" + prompt) : undefined;
    const text = queue?.length ? queue.shift()! : null;
    if (text === null) return Response.json({ error: { message: "scripted: no reply" } }, { status: 400 });
    return fakeReply({ text, provider: model ? served[model] : undefined })(url, body);
  };
  const inner = meteredModels({
    controller: r.c,
    runId: r.c.runId,
    proxy: (item) => {
      let p = proxies.get(item);
      if (!p) proxies.set(item, (p = startProxy(r, item, upstream)));
      return p.proxy;
    },
    figures: (item) => ledgerFigures(r.local, () => r.c.lease(item)?.leaseId ?? null),
    cacheDir: join(r.dir, "reply-cache"),
    out: join(r.dir, "meter"),
    termsDigest: () => FAKE_TERMS_DIGEST,
    close: async () => {
      for (const p of proxies.values()) p.stop();
    },
  });
  return {
    async call(c) {
      const k = c.model + "\n" + c.prompt;
      const text = await script(c);
      pending.set(k, [...(pending.get(k) ?? []), text]);
      kit.calls.push(c.model + " " + c.label);
      return inner.call(c);
    },
    close: inner.close,
  };
}

/** The candidate id a VM's label names ("recipe session c007", "qualify c007 retry"). */
const candidateOf = (label: string): string => /c\d{3}/.exec(label)?.[0] ?? "";

/**
 * A fake VM world: the recipes area's scripted recipe agent and browser, by candidate id, and stage 3's scripted build
 * agent, reader, authoring and judge, all over one fake Ubicloud backend.
 */
export function fakeVm(o: { apps?: (candidate: string) => FixtureApp; stage3?: Stage3Script } = {}): (kit: Kit) => VmProvider & Stage3Provider {
  return () => {
    const s3 = fixtureStage3(o.stage3);
    const b = s3.select.builds;
    const appOf = (label: string) => o.apps?.(candidateOf(label)) ?? {};
    const labelOfVm = (id: string) => s3.world.vms.find((v) => v.id === id)?.spec?.label ?? "";
    const tries = new Map<string, number>();
    const judge = s3.deps([]).judge;
    return {
      backend: b.sandbox.backend,
      priceMicrosPerHour: 100_000,
      now: () => 0,
      spec: (kind, label) => (kind === "qualify" || kind === "check" ? fakeSpec({ label, proxy: null, mirrors: fakeMirrors() }) : fakeSpec({ label })),
      browser: fixtureBrowser((vmId) => appOf(labelOfVm(vmId)).app ?? "content"),
      recipeAgent: async (vm) => {
        const id = candidateOf(vm.spec.label);
        const app = appOf(vm.spec.label);
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        const end = app.end === "infra-once" ? (n === 1 ? "infra" : "completed") : (app.end ?? "completed");
        const text = app.recipe === undefined ? RECIPE() : app.recipe;
        if (end === "completed" && text !== null) await b.sandbox.backend.write(vm, "/work/recipe.json", text);
        return { end, spentUsd: app.spentUsd ?? 3 };
      },
      buildAgent: b.agent,
      buildReader: b.reader,
      stage3Authoring: s3.select.authoring,
      pairwise: judge,
    };
  };
}

/** One scripted review attempt: its transcript, how it ended, its spend and the provider an OpenRouter model names. */
export interface FakeAttempt {
  transcript: string;
  termination?: Termination;
  errorSeen?: boolean;
  /** The driver's session_end; null when unset. */
  sessionEnd?: SessionEnd;
  /** Null is an unknown charge; $1.00 when unset. */
  spentUsd?: number | null;
  /** The serving provider an OpenRouter session's first call names; the pinned one when unset. */
  served?: string;
  /** The autoplan run directories the attempt's box holds. */
  runs?: FakeRun[];
  planAfter?: string | null;
}

/**
 * A keyless SessionProvider: each attempt's box is the run area's fake RunBox over its scripted runs, and drive hands
 * the row's stop handler the scripted transcript once (so the gate and D1 hooks run) and returns the scripted end.
 */
export function fakeSessions(script: (o: { cell: Cell; attempt: 1 | 2 }) => FakeAttempt, o: { reconcile?: (cell: Cell, attempt: 1 | 2) => Reconciled } = {}): (kit: Kit) => SessionProvider {
  return (kit) => ({
    async open({ cell, attempt, setup }) {
      const s = script({ cell, attempt });
      kit.calls.push("session " + cellId(cell) + " a" + attempt);
      const served = (name?: string): ServedTerms | null => (DIRECT_MODELS[setup.model].provider === "openrouter" ? { provider: name ?? SERVED[setup.model]!, fallbacks: false, dataCollection: "deny", termsDigest: FAKE_TERMS_DIGEST } : null);
      return {
        box: fakeBox(s.runs ?? []),
        exec: () => ({ code: 0, stdout: "", stderr: "" }),
        async drive(stop) {
          stop?.(s.transcript);
          return { transcript: s.transcript, termination: s.termination ?? { kind: "completed" }, errorSeen: s.errorSeen ?? false, sessionEnd: s.sessionEnd ?? null, planAfter: s.planAfter ?? null, spentUsd: s.spentUsd === undefined ? 1 : s.spentUsd, served: served(s.served), imageDigest: null };
        },
        close: async () => {},
      };
    },
    reconcile: async (cell, attempt) => o.reconcile?.(cell, attempt) ?? { ok: true, judged: false },
  });
}

/** power.py's runner in the dry run: it reads the written design and prints the ADMIT and MDD lines power.py prints. */
export const fakePower =
  (power: string): PowerRunner =>
  () => ({ code: 0, stdout: "ADMIT design power " + power + " se 0.007 -> " + (Number(power) >= 0.8 ? "pass" : "fail") + "\nMDD design MDD 0.12\n", stderr: "" });

/** A row environment on a kit: the dry run passes, a clean checkout at a fixed commit, a fixed clock. */
export function fakeEnv(kit: Kit, o: { dryRun?: boolean; dirty?: boolean; power?: PowerRunner; now?: string } = {}): RowEnv {
  return {
    providers: kit.providers,
    dryRun: async () => o.dryRun ?? true,
    lane: () => ({ commit: FAKE_COMMIT, dirty: o.dirty ?? false, root: REPO_ROOT }),
    now: () => new Date(o.now ?? "2026-11-20T00:00:00Z"),
    power: o.power ?? fakePower("0.850"),
    vocabulary: () => STAND_IN_VOCABULARY,
  };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The served-provider check (prereg start rule 9, PD-9), shared by direct calls (meter.ts) and session traffic
// (paid/sessions.ts reads the session proxy's journal). The first call per model, in any role and on any item, records
// its serving provider and the routing terms the proxy sends in terms.ndjson. A call is drift when its provider doesn't
// match the route's pin, differs from the dated terms record, or differs from that first record in provider or terms.
// Provider names compare after folding case, spaces and punctuation (the Captain's ruling 1B); when two raw names fold
// to one, both are recorded in names.ndjson.
// Drift applies E_DC_PROVIDER_DRIFT's stop scope, which stops every call on that model in every role for the Captain,
// tells each drift listener (the session proxies cut that model), and throws.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chatPrice, openRouterRouting } from "../../../src/runner/pricing/prices.ts";
import { DcError } from "../errors.ts";
import type { AnyModel } from "../types.ts";
import type { MoneyController } from "./book.ts";
import type { TermsLine } from "./meter.ts";
import { DIRECT_MODELS } from "./price.ts";
import { applyStop, stopPlan } from "./stops.ts";

/** The routing and data terms the metering proxy sends for a model: OpenRouter's provider block from the price row, else none. */
export function routingOf(model: AnyModel): Record<string, unknown> | null {
  const m = DIRECT_MODELS[model];
  if (m.provider !== "openrouter") return null;
  const listed = chatPrice("openrouter:" + m.id);
  return listed ? (openRouterRouting(listed) as Record<string, unknown>) : null;
}

/** A provider name for comparison (the Captain's ruling 1B): case, spaces and punctuation folded away. */
export const foldProvider = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const sameProvider = (a: string | null, b: string | null): boolean => (a === null || b === null ? a === b : foldProvider(a) === foldProvider(b));

/** Two raw provider names that fold to the same one, recorded in names.ndjson beside terms.ndjson. */
export interface NameLine {
  model: AnyModel;
  /** The name the call's reply gave. */
  servedBy: string;
  /** The name it was compared against, and where that name came from. */
  against: string;
  source: "dated terms" | "first call";
  at: string;
}

export interface ServedCall {
  model: AnyModel;
  /** The provider the reply names; for Anthropic and OpenAI routes, the provider itself. */
  servedBy: string | null;
  via: "direct" | "session";
  /** The call's label or session, for the drift line (never prompt text). */
  label: string;
}

export interface WatchOptions {
  controller: MoneyController;
  /** Holds terms.ndjson. One watch, and one file, per run, so the first call per model is the first in any role. */
  out: string;
  /** The dated terms record: the provider name each OpenRouter model must be served by, when it pins one. */
  datedTerms?: Partial<Record<AnyModel, string>>;
  now?: () => Date;
}

export type DriftListener = (model: AnyModel, why: string) => void | Promise<void>;

export class ProviderWatch {
  readonly out: string;
  readonly file: string;
  private readonly listeners: DriftListener[] = [];
  private readonly stopped = new Set<AnyModel>();
  private readonly named = new Set<string>();

  constructor(private readonly o: WatchOptions) {
    mkdirSync(o.out, { recursive: true });
    this.out = o.out;
    this.file = join(o.out, "terms.ndjson");
  }

  terms(): TermsLine[] {
    return existsSync(this.file) ? readFileSync(this.file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as TermsLine) : [];
  }

  onDrift(fn: DriftListener): void {
    this.listeners.push(fn);
  }

  /** The raw name pairs that folded to one provider, as recorded. */
  names(): NameLine[] {
    const file = join(this.out, "names.ndjson");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as NameLine) : [];
  }

  private recordNames(c: ServedCall, against: string, source: NameLine["source"]): void {
    if (c.servedBy === null || c.servedBy === against) return;
    const key = JSON.stringify([c.model, c.servedBy, against, source]);
    if (this.named.has(key)) return;
    this.named.add(key);
    appendFileSync(join(this.out, "names.ndjson"), JSON.stringify({ model: c.model, servedBy: c.servedBy, against, source, at: (this.o.now ?? (() => new Date()))().toISOString() } satisfies NameLine) + "\n");
  }

  /** Records the first call per model and throws E_DC_PROVIDER_DRIFT, after the stop, on any drift. */
  async check(c: ServedCall): Promise<void> {
    const m = DIRECT_MODELS[c.model];
    const routing = routingOf(c.model);
    const first = this.terms().find((t) => t.model === c.model);
    if (!first) appendFileSync(this.file, JSON.stringify({ model: c.model, id: m.id, servedBy: c.servedBy, routing, at: (this.o.now ?? (() => new Date()))().toISOString() } satisfies TermsLine) + "\n");
    const shown = c.servedBy ?? "an unnamed provider";
    const why: string[] = [];
    if (m.served_by && (c.servedBy === null || !(m.served_by.test(c.servedBy) || m.served_by.test(foldProvider(c.servedBy))))) why.push(m.id + " was served by " + shown + ", not its pinned provider");
    const dated = this.o.datedTerms?.[c.model];
    if (dated !== undefined && !sameProvider(c.servedBy, dated)) why.push(m.id + " was served by " + shown + ", but the dated terms record names " + dated);
    else if (dated !== undefined) this.recordNames(c, dated, "dated terms");
    if (first && !sameProvider(first.servedBy, c.servedBy)) why.push(m.id + " was served by " + shown + ", but its first call was served by " + (first.servedBy ?? "an unnamed provider"));
    else if (first?.servedBy) this.recordNames(c, first.servedBy, "first call");
    if (first && JSON.stringify(first.routing) !== JSON.stringify(routing)) why.push(m.id + "'s routing terms differ from those its first call recorded");
    if (!why.length) return;
    const line = why.join("; ") + " (" + c.via + " " + c.label + "); every call on " + c.model + " stops, in every role, for the Captain";
    if (!this.stopped.has(c.model)) {
      this.stopped.add(c.model);
      await applyStop(this.o.controller, stopPlan("E_DC_PROVIDER_DRIFT", { model: c.model }));
      for (const fn of this.listeners) await fn(c.model, line);
    }
    throw new DcError("E_DC_PROVIDER_DRIFT", line);
  }
}

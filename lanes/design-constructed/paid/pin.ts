// Copyright (c) 2026 Garry Tan. MIT License.
// The model pin record (prereg start rule 9 and section 15's dated terms record, read/start.ts): one file per run that
// names every model route the lane calls, the provider that serves it and the routing and data terms the metering
// proxy sends. OpenRouter's routes are read from its public endpoints API (a free, keyless read) by a probe plan the
// Captain runs at the go; this file only writes that plan and parses what it fetched. It calls nothing. The record feeds
// the served-provider watch (datedTermsOf) and start rule 9 (termsRecordsOf, firstCallOf).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../errors.ts";
import type { TermsLine } from "../money/meter.ts";
import { DIRECT_MODELS, ROUTE } from "../money/price.ts";
import { routingOf } from "../money/served.ts";
import { sha256 } from "../money/wal.ts";
import type { FirstCall, TermsRecord } from "../read/start.ts";
import type { AnyModel, Model } from "../types.ts";

export const PIN_SCHEMA = 1;
const SESSION_MODELS: readonly Model[] = ["opus", "sol", "particle"];
/** The route a Claude Code session takes on its provider: Anthropic's Messages API, or OpenRouter's Anthropic-shaped one. */
export const SESSION_ROUTE = "/v1/messages";

export const endpointsUrl = (id: string) => "https://openrouter.ai/api/v1/models/" + id + "/endpoints";

export interface ProbeCommand {
  model: AnyModel;
  url: string;
  /** The file the read lands in, inside the plan's directory. */
  file: string;
  argv: string[];
}

export interface ProbePlan {
  schema: typeof PIN_SCHEMA;
  dir: string;
  commands: ProbeCommand[];
}

const OPENROUTER_MODELS = (Object.keys(DIRECT_MODELS) as AnyModel[]).filter((m) => DIRECT_MODELS[m].provider === "openrouter");

/** One keyless GET per OpenRouter model: no key, no auth header, HTTPS only, a 30 second limit. */
export function probePlan(dir: string): ProbePlan {
  return {
    schema: PIN_SCHEMA,
    dir,
    commands: OPENROUTER_MODELS.map((model) => {
      const url = endpointsUrl(DIRECT_MODELS[model].id);
      const file = model + ".endpoints.json";
      return { model, url, file, argv: ["curl", "--silent", "--show-error", "--fail", "--max-time", "30", "--proto", "=https", "--output", join(dir, file), url] };
    }),
  };
}

/** One short call to a model, as the meter takes it. */
export interface ModelProbe {
  model: AnyModel;
  prompt: string;
  maxTokens: number;
  label: string;
}

export const MODEL_PROBE_PROMPT = "Reply with the single word ok.";

/**
 * The Captain's ruling 1A: one short call per model, to run first after the go, so every route's reply is seen to name
 * its provider or to resolve through OpenRouter's generation record before any real work. The plan holds no key and
 * calls nothing; the ledger item each call charges is the caller's (WIRING.md, Phase 1b open items).
 */
export function modelProbePlan(): ModelProbe[] {
  return (Object.keys(DIRECT_MODELS) as AnyModel[]).map((model) => ({ model, prompt: MODEL_PROBE_PROMPT, maxTokens: 16, label: "probe " + model }));
}

/** Runs the probe through a metered call and names each model's serving provider; a reply that names none is a problem. */
export async function runModelProbe(plan: readonly ModelProbe[], call: (p: ModelProbe) => Promise<{ servedBy: string | null; problem: string | null }>): Promise<{ lines: string[]; problems: string[] }> {
  const lines: string[] = [];
  const problems: string[] = [];
  for (const p of plan) {
    const r = await call(p);
    if (r.problem) problems.push(p.model + ": " + r.problem);
    else if (r.servedBy === null) problems.push(p.model + ": the reply named no provider and the generation record resolved none");
    lines.push("probe: " + p.model + " served by " + (r.servedBy ?? "an unnamed provider") + (r.problem ? " (" + r.problem + ")" : ""));
  }
  return { lines, problems };
}

const quote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");

/** The plan as the shell lines the Captain runs. */
export function probeScript(plan: ProbePlan): string[] {
  return ["set -eu", "mkdir -p " + quote(plan.dir), ...plan.commands.map((c) => c.argv.map(quote).join(" "))];
}

/** One endpoint as OpenRouter's endpoints API lists it, prices in dollars per million tokens. */
export interface Endpoint {
  tag: string;
  provider: string;
  promptPerM: number | null;
  completionPerM: number | null;
  status: unknown;
}

export interface PinRoute {
  model: AnyModel;
  provider: string;
  id: string;
  /** The direct-call route on the provider. */
  route: string;
  /** The session route, for a model under test. */
  sessionRoute: string | null;
  /** The provider name a reply must carry: the endpoint's provider for OpenRouter, else the provider itself. */
  served: string | null;
  /** The pin's pattern on the served name, as money/price.ts holds it. */
  pin: string | null;
  /** The routing and data terms the proxy sends, and their sha256. */
  routing: Record<string, unknown> | null;
  routingDigest: string | null;
  /** The endpoints the routing admits, and the sha256 of the whole read. */
  endpoints: Endpoint[] | null;
  readDigest: string | null;
  problems: string[];
}

export interface PinRecord {
  schema: typeof PIN_SCHEMA;
  runId: string;
  commit: string;
  dated: string;
  routes: PinRoute[];
  ok: boolean;
}

const perM = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
};

/** Parses one endpoints read: every listed endpoint, or the reason the read can't be used. */
export function readEndpoints(text: string): { endpoints: Endpoint[] } | { problem: string } {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return { problem: "the endpoints read is not JSON" };
  }
  const list = j?.data?.endpoints;
  if (!Array.isArray(list)) return { problem: "the endpoints read has no data.endpoints list" };
  const endpoints: Endpoint[] = [];
  for (const e of list) {
    if (typeof e?.tag !== "string" || typeof e?.provider_name !== "string") return { problem: "an endpoint lacks its tag or provider_name" };
    endpoints.push({ tag: e.tag, provider: e.provider_name, promptPerM: perM(e.pricing?.prompt), completionPerM: perM(e.pricing?.completion), status: e.status ?? null });
  }
  return { endpoints };
}

/** The endpoints the proxy's routing can reach: a pinned provider slug, within max_price. */
export function admitted(routing: Record<string, any>, endpoints: Endpoint[]): Endpoint[] {
  const only: string[] = Array.isArray(routing.only) ? routing.only : [];
  const max = routing.max_price ?? {};
  return endpoints.filter((e) => only.some((slug) => e.tag === slug || e.tag.startsWith(slug + "/")) && e.promptPerM !== null && e.completionPerM !== null && e.promptPerM <= max.prompt && e.completionPerM <= max.completion);
}

/** One route's pin from its endpoints read (OpenRouter) or from the route itself (Anthropic, OpenAI). */
export function pinRoute(model: AnyModel, read: string | null): PinRoute {
  const m = DIRECT_MODELS[model];
  const routing = routingOf(model);
  const base = { model, provider: m.provider, id: m.id, route: ROUTE[m.provider], sessionRoute: (SESSION_MODELS as readonly string[]).includes(model) ? SESSION_ROUTE : null, pin: m.served_by?.source ?? null, routing, routingDigest: routing ? sha256(JSON.stringify(routing)) : null };
  if (m.provider !== "openrouter") return { ...base, served: m.provider, endpoints: null, readDigest: null, problems: [] };
  const problems: string[] = [];
  if (!routing) problems.push(m.id + " has no OpenRouter price row, so the proxy sends no routing terms");
  if (routing && routing.allow_fallbacks !== false) problems.push(m.id + "'s routing leaves fallbacks on");
  if (routing && routing.data_collection !== "deny") problems.push(m.id + "'s routing doesn't deny data collection");
  if (read === null) return { ...base, served: null, endpoints: null, readDigest: null, problems: [...problems, "no endpoints read for " + m.id] };
  const r = readEndpoints(read);
  if ("problem" in r) return { ...base, served: null, endpoints: null, readDigest: sha256(read), problems: [...problems, m.id + ": " + r.problem] };
  const hit = routing ? admitted(routing, r.endpoints) : [];
  const names = [...new Set(hit.map((e) => e.provider))];
  if (!names.length) problems.push("no endpoint of " + m.id + " is on its pinned provider within its max price");
  if (names.length > 1) problems.push(m.id + "'s routing reaches several providers: " + names.join(", "));
  const served = names.length === 1 ? names[0]! : null;
  if (served !== null && m.served_by && !m.served_by.test(served)) problems.push(m.id + "'s pinned endpoint is served by " + served + ", which its pin pattern " + m.served_by.source + " doesn't match");
  return { ...base, served, endpoints: hit, readDigest: sha256(read), problems };
}

/** The record for a run from the plan's reads: reads[model] is the fetched text, or null when the read is missing. */
export function pinRecord(o: { runId: string; commit: string; dated: string; reads: Partial<Record<AnyModel, string | null>> }): PinRecord {
  if (!/^[0-9a-f]{40}$/.test(o.commit)) fail("E_USAGE", "the pin record names the lane's commit as 40 hex digits, not " + JSON.stringify(o.commit));
  if (!Number.isFinite(Date.parse(o.dated))) fail("E_USAGE", "the pin record's date is not a date: " + JSON.stringify(o.dated));
  const routes = (Object.keys(DIRECT_MODELS) as AnyModel[]).map((model) => pinRoute(model, o.reads[model] ?? null));
  return { schema: PIN_SCHEMA, runId: o.runId, commit: o.commit, dated: o.dated, routes, ok: routes.every((r) => !r.problems.length) };
}

/** Reads each command's file from the plan's directory; a missing file is a missing read. */
export function readProbe(plan: ProbePlan): Partial<Record<AnyModel, string | null>> {
  return Object.fromEntries(plan.commands.map((c) => [c.model, existsSync(join(plan.dir, c.file)) ? readFileSync(join(plan.dir, c.file), "utf8") : null]));
}

/** Writes the run's one pin record; a second write for the run is refused. */
export function writePinRecord(path: string, rec: PinRecord): void {
  if (existsSync(path)) fail("E_USAGE", "the run's pin record already exists at " + path + "; it is written once per run");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(rec, null, 2) + "\n", { flag: "wx", mode: 0o644 });
}

/** The served provider each OpenRouter model must carry, for the watch (money/served.ts). Refused unless the record is ok. */
export function datedTermsOf(rec: PinRecord): Partial<Record<AnyModel, string>> {
  if (!rec.ok) fail("E_USAGE", "the pin record for run " + rec.runId + " has problems; no call runs on it until the Captain decides");
  return Object.fromEntries(rec.routes.filter((r) => r.provider === "openrouter" && r.served !== null).map((r) => [r.model, r.served!]));
}

/** Start rule 9's records (read/start.ts) for the OpenRouter models. */
export function termsRecordsOf(rec: PinRecord): TermsRecord[] {
  return rec.routes.filter((r) => r.provider === "openrouter" && r.served !== null && r.routingDigest !== null).map((r) => ({ model: r.model as TermsRecord["model"], dated: rec.dated, provider: r.served!, dataCollection: "deny", termsDigest: r.routingDigest! }));
}

/** What a model's first call recorded (terms.ndjson), as start rule 9 reads it. */
export function firstCallOf(line: TermsLine): FirstCall {
  if (DIRECT_MODELS[line.model].provider !== "openrouter") fail("E_USAGE", line.model + " is not an OpenRouter model; start rule 9 reads OpenRouter's first calls");
  return { model: line.model as FirstCall["model"], provider: line.servedBy ?? "", fallbacks: line.routing?.allow_fallbacks !== false, dataCollection: String(line.routing?.data_collection ?? ""), termsDigest: sha256(JSON.stringify(line.routing)) };
}

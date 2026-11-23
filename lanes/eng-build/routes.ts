// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's live route probe (prereg 2026-11-11-geva-522-eng-review-build-read-prereg, section 11):
// before any paid batch, one real call on every model route at its frozen settings, each priced from the line item of
// the first stage that uses the route, through main's ledger and an in-process metering proxy (product-value's metered
// client, whose OpenRouter rows carry the provider pin and data_collection deny and stop on provider drift). The sessions
// themselves run Claude Code at its pinned version with no reasoning-effort override, so each probe sends none either.
// In tests the call is a stub (RouteCall); the real one is liveRouteCalls.
import { join } from "node:path";
import { MODELS, openMeter, type ModelKey } from "../product-value/meter.ts";
import { EB_RUN, itemOf } from "./ledger.ts";

export interface Route {
  name: string;
  model: ModelKey;
  /** The line item of the first stage that uses the route. */
  item: string;
  use: string;
}

export const ROUTES: readonly Route[] = [
  { name: "note-writer", model: "sol", item: "eb-build-units", use: "GPT-6.1 Sol writes each unit's statement note" },
  { name: "note-audit", model: "opus", item: "eb-build-units", use: "Opus 5.5, no tools, audits each note for behavior or bug hints" },
  { name: "review-opus", model: "opus", item: "eb-reviews-opus", use: "Opus 5.5 review sessions (pilot plain reviews first)" },
  { name: "build-opus", model: "opus", item: "eb-builds-opus", use: "Opus 5.5 build sessions (pilot builds first)" },
  { name: "review-sol", model: "sol", item: "eb-exposure-smoke", use: "Sol review sessions (exposure smoke first)" },
  { name: "review-particle", model: "particle", item: "eb-exposure-smoke", use: "particle-1 review sessions (exposure smoke first)" },
];

export const PROBE_PROMPT = "Reply with the single word ok.";
export const PROBE_MAX_TOKENS = 64;

export interface RouteAnswer {
  status: number;
  text: string | null;
  micros: number | null;
  served_by: string | null;
}

export type RouteCall = (route: Route) => Promise<RouteAnswer>;

export interface RouteProbe {
  ok: boolean;
  lines: string[];
}

/** One call per route, in order; a route that answers anything but a 200 with text fails the probe, and every route is still tried. */
export async function probeRoutes(call: RouteCall, routes: readonly Route[] = ROUTES): Promise<RouteProbe> {
  const lines: string[] = [];
  let ok = true;
  for (const r of routes) {
    itemOf(r.item);
    const m = MODELS[r.model];
    let a: RouteAnswer;
    try {
      a = await call(r);
    } catch (e) {
      a = { status: 0, text: null, micros: null, served_by: null };
      lines.push("route " + r.name + ": FAIL " + m.provider + " " + m.id + " on " + r.item + " (" + (e as Error).message.split("\n")[0] + ")");
      ok = false;
      continue;
    }
    const good = a.status === 200 && a.text !== null && a.text.trim() !== "";
    ok &&= good;
    lines.push("route " + r.name + ": " + (good ? "ok" : "FAIL") + " " + m.provider + " " + m.id + (a.served_by ? " served by " + a.served_by : "") + " on " + r.item + ", " + (a.micros === null ? "cost unknown" : "$" + (a.micros / 1e6).toFixed(4)) + (good ? "" : " (status " + a.status + ")"));
  }
  return { ok, lines };
}

/** The real calls: one metered lease per item, one call per route on it, each lease settled before the next item opens. */
export function liveRouteCalls(o: { out: string; cacheDir: string; record?: string; ledger?: string; env?: Record<string, string | undefined> }): { call: RouteCall; close: () => Promise<void> } {
  const meters = new Map<string, Awaited<ReturnType<typeof openMeter>>>();
  let current: string | null = null;
  const close = async () => {
    for (const m of meters.values()) await m.close();
    meters.clear();
  };
  const call: RouteCall = async (r) => {
    if (current !== r.item) {
      await close();
      meters.set(r.item, await openMeter({ item: r.item, runId: EB_RUN, out: join(o.out, r.item), cacheDir: join(o.cacheDir, r.item), maxOutputTokens: PROBE_MAX_TOKENS, record: o.record, ledger: o.ledger, env: o.env }));
      current = r.item;
    }
    const res = await meters.get(r.item)!.call({ model: r.model, prompt: PROBE_PROMPT + " (route " + r.name + ")", maxTokens: PROBE_MAX_TOKENS, effort: null, label: "eb-route:" + r.name });
    return { status: res.status, text: res.text, micros: res.micros, served_by: res.served_by };
  };
  return { call, close };
}

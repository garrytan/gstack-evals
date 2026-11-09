// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's key funnel after the free screen (prereg 2026-11-09-geva-417, sections 3 and 4), one unit at a time,
// every call through the metered client on the authoring item:
//   triage       Gemini 4 Argon at medium effort reads the source plan text, the identifiers and each candidate's title,
//                author association and passage; an unflagged unit drops as triage-negative
//   rewrite      Opus 5.5 writes plan.md from the source only (section 4's frozen prompt); the alias map applies after
//   key read     Opus 5.5 at high effort reads the window's titles, the bodies that touch the surface and every candidate
//                in full, and writes section 3's key; items over 30 words, outside the window or outside the classes are
//                dropped mechanically and counted
//   audits       Opus 5.5 in a fresh session and GPT-6.1 Sol; one revision round, and a unit that fails twice drops
//   generic      the scoring part's generic screen, taken as a parameter
//   primary      section 3's ranking, at most 6; a unit with none left drops
//   recognition  section 11's probe on all three models under test; an Opus-recognized unit goes to a descriptive
//                stratum, and a Sol or particle-1 hit keeps the unit out of that model's primary only
//   miss read    the miss sample's rewrite and key read on a dropped unit, mechanical drops only; it never enters a set
// The screen itself is the miner's; its candidates arrive here. Logs carry stages, counts and spend, never text.
import { MeterError, sha256, type Meter, type ModelKey } from "../../aftermath/meter.ts";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { fence, lastJson, words } from "../../product-value/author/run.ts";
import { MODEL_IDS, SEED, type ItemClass, type ItemSource, type Key, type KeyItem, type ModelId } from "../types.ts";
import * as P from "./prompts.ts";

export class DxError extends Error {
  constructor(readonly code: ReasonCode, message: string) {
    super(code + " " + message);
  }
}

export interface Candidate {
  ref: string;
  date: string;
  title: string;
  association: string;
  /** The body passage around the match (triage sees only this). */
  passage: string;
  /** The whole body (the key writer sees it). */
  body: string;
}

export interface WindowRecord {
  ref: string;
  date: string;
  title: string;
  /** The body, only for a record that touches the unit's surface; null otherwise. */
  body: string | null;
}

/** One unit as the miner and the unit builder hand it over: real text, sealed, never committed. */
export interface FunnelUnit {
  id: string;
  release_at: string;
  window: { from: string; to: string };
  /** The earliest recoverable pull request description and closing issues, dated before the merge. */
  source: string;
  identifiers: string[];
  candidates: Candidate[];
  records: WindowRecord[];
  /** The snapshot README's text, before aliasing. */
  readme: string;
  /** The unit's real names (owner/repo, project, packages, modules, binaries), for the recognition check. */
  real_names: string[];
}

export interface FunnelDeps {
  meter: Meter;
  /** The unit's alias map, forward (lanes/devex/unit/alias.ts). */
  alias: (text: string) => string;
  /** The generic screen (the scoring part's): marks generic items. */
  genericScreen: (key: Key) => Promise<Key>;
  log?: (unit: string, stage: string, data: Record<string, unknown>) => void;
  /** Supply rule 1's spend bound for the calibration set, in micros; no call starts at or past it. */
  limitMicros?: number;
}

export type FunnelStage = "screen-negative" | "triage-negative" | "no-key" | "audit-failed" | "no-primary" | "recognized-opus" | "keyed";

export interface FunnelResult {
  id: string;
  stage: FunnelStage;
  /** plan.md, aliased; null before the rewrite. */
  plan: string | null;
  key: Key | null;
  recognized: Record<ModelId, boolean> | null;
  /** Items the key writer gave that failed the mechanical rules (over 30 words, outside the window, unknown class). */
  dropped_items: number;
  spent_micros: number;
}

const CLASS_SET = new Set(["G", "E", "D", "U"]);
const SOURCES = new Set(["outside", "followup-linked", "followup"]);
const GROUP: Record<ItemSource, number> = { outside: 0, "followup-linked": 1, followup: 2 };

/** Section 3's primary: outside items by their count of distinct outside developers, then follow-ups linked to an outside issue, then other follow-ups, then a seeded tie-break; mentioned and generic items never enter; at most 6. */
export function rankPrimary(unit: string, items: readonly KeyItem[]): string[] {
  const tie = (id: string) => sha256(SEED + "\n" + unit + "\n" + id);
  return items
    .filter((i) => !i.mentioned && !i.generic)
    .sort((a, b) => GROUP[a.source] - GROUP[b.source] || (a.source === "outside" ? b.outside_developers - a.outside_developers : 0) || (tie(a.id) < tie(b.id) ? -1 : 1))
    .slice(0, 6)
    .map((i) => i.id);
}

const esc = (s: string) => s.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");

/** Section 11's mechanical check: the probe's project answer names one of the unit's real names (3 characters or more, whole word, any case). */
export function namesProject(answer: string, realNames: readonly string[]): boolean {
  const a = answer.toLowerCase();
  return realNames.filter((n) => n.trim().length >= 3).some((n) => new RegExp("(?<![a-z0-9])" + esc(n.trim().toLowerCase()) + "(?![a-z0-9])").test(a));
}

/** Keeps the key writer's items that pass the mechanical rules, aliased and numbered; counts the rest. */
export function normalizeItems(raw: unknown, window: { from: string; to: string }, alias: (t: string) => string): { items: KeyItem[]; dropped: number } {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? ((raw as { items: any[] }).items) : [];
  const inWindow = (d: unknown) => typeof d === "string" && !Number.isNaN(Date.parse(d)) && Date.parse(d) >= Date.parse(window.from) && Date.parse(d) <= Date.parse(window.to);
  const items: KeyItem[] = [];
  for (const it of list) {
    const evidence = Array.isArray(it?.evidence) ? it.evidence.map((e: any) => ({ ref: String(e?.ref ?? ""), date: String(e?.date ?? "") })) : [];
    const ok = CLASS_SET.has(it?.class) && typeof it?.statement === "string" && words(it.statement) <= 30 && words(it.statement) > 0 && SOURCES.has(it?.source) && evidence.length > 0 && evidence.every((e: { date: string }) => inWindow(e.date));
    if (!ok) continue;
    items.push({ id: "k" + (items.length + 1), class: it.class as ItemClass, statement: alias(it.statement), surface: alias(String(it.surface ?? "")), context: typeof it.context === "string" && it.context.trim() ? alias(it.context) : null, source: it.source as ItemSource, outside_developers: Math.max(0, Math.floor(Number(it.outside_developers) || 0)), evidence, mentioned: it.mentioned === true, generic: false, foreseeable: null });
  }
  return { items, dropped: list.length - items.length };
}

const FORESEEABLE = new Set(["yes", "maybe", "no"]);

type Ask = (label: string, model: ModelKey, prompt: string, maxTokens: number, effort: string | null, json: boolean) => Promise<any>;

/** The metered ask for one unit: one resend on an unreadable reply, and no call starts at or past the spend bound. */
function asker(id: string, d: FunnelDeps): Ask {
  const log = d.log ?? (() => {});
  const stale = P.unpinned();
  if (stale.length) throw new DxError("E_USAGE", "the authoring prompts " + stale.join(", ") + " differ from their pinned sha256; a frozen prompt never changes during a run");
  return async (label, model, prompt, maxTokens, effort, json) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (d.limitMicros !== undefined && d.meter.spent() >= d.limitMicros) throw new DxError("E_DX_SUPPLY_SHORT", "authoring spend reached the calibration bound before the set filled (supply rule 1)");
      const r = await d.meter.call({ model, prompt: attempt === 1 ? prompt : prompt + "\n\nYour previous reply could not be read. Follow the output format exactly.", maxTokens, effort, label: id + ":" + label });
      log(id, label, { model, status: r.status, micros: r.micros, cached: r.cached });
      if (r.status !== 200 || r.text === null) {
        if (attempt === 2) throw new DxError("E_DX_INFRA_MISSING", id + " " + label + ": " + (r.problem ?? "no reply") + " twice");
        continue;
      }
      if (!json) return r.text.trim();
      const parsed = lastJson(r.text);
      if (parsed !== null) return parsed;
    }
    throw new DxError("E_DX_INFRA_MISSING", id + " " + label + ": the reply did not parse twice");
  };
}

const candidatesText = (u: FunnelUnit, full: boolean) => u.candidates.map((c, i) => fence("Candidate " + (i + 1) + " (" + c.ref + ", " + c.date + ", author association " + c.association + "): " + c.title, full ? c.body : c.passage)).join("");

/** Step 2's prompt: the source plan text, the identifiers and each candidate's title, association and passage, never a body. */
export const triagePrompt = (u: FunnelUnit) => P.TRIAGE + fence("Description", u.source) + fence("Identifiers", u.identifiers.join("\n")) + candidatesText(u, false);

/** Section 11's probe input: plan.md and the first 40 lines of the snapshot's README, both aliased, and no tools. */
export const recognitionPrompt = (plan: string, readme: string, alias: (t: string) => string) => P.RECOGNITION + fence("plan.md", plan) + fence("README, first 40 lines", alias(readme.split("\n").slice(0, 40).join("\n")));

/** The rewrite and step 3's key read: the whole window's titles, the bodies that touch the surface and every candidate in full. */
async function keyRead(u: FunnelUnit, d: FunnelDeps, ask: Ask) {
  const rewrite: string = await ask("rewrite", "opus", P.REWRITE + fence("Description", u.source), 4000, null, false);
  const window = "from " + u.window.from.slice(0, 10) + " to " + u.window.to.slice(0, 10);
  const head = (p: string) => p.replace("RELEASE", u.release_at.slice(0, 10)).replace("WINDOW", window);
  const records = fence("Every record created in the window (titles)", u.records.map((r) => r.date.slice(0, 10) + " " + r.ref + ": " + r.title).join("\n")) + u.records.filter((r) => r.body !== null).map((r) => fence("Record " + r.ref + " (" + r.date.slice(0, 10) + ")", r.body!)).join("");
  const material = fence("The team's plan", rewrite) + records + candidatesText(u, true);
  const raw = await ask("key-1", "opus", head(P.KEY) + material, 16000, "high", true);
  return { plan: d.alias(rewrite), head, records, material, raw };
}

export async function authorUnit(u: FunnelUnit, d: FunnelDeps): Promise<FunnelResult> {
  const start = d.meter.spent();
  const log = d.log ?? (() => {});
  let dropped = 0;
  const done = (stage: FunnelStage, plan: string | null = null, key: Key | null = null, recognized: FunnelResult["recognized"] = null): FunnelResult => {
    const r = { id: u.id, stage, plan, key, recognized, dropped_items: dropped, spent_micros: d.meter.spent() - start };
    log(u.id, "outcome", { stage, items: key?.items.length ?? null, primary: key?.primary.length ?? null, dropped_items: dropped, spent_micros: r.spent_micros });
    return r;
  };
  if (u.candidates.length === 0) return done("screen-negative");
  const ask = asker(u.id, d);
  const triage = await ask("triage", "gemini", triagePrompt(u), 4000, "medium", true);
  if (triage?.flag === false) return done("triage-negative");
  const { plan, head, records, material, raw: first } = await keyRead(u, d, ask);
  let raw = first;
  let items: KeyItem[] = [];
  for (let round = 1; round <= 2; round++) {
    const n = normalizeItems(raw, u.window, d.alias);
    items = n.items;
    dropped += n.dropped;
    if (!items.length) return done("no-key", plan);
    const shown = fence("plan.md", plan) + records + fence("Key", JSON.stringify(items.map(({ id, class: c, statement, surface, context, source, evidence, mentioned }) => ({ id, class: c, statement, surface, context, source, evidence, mentioned })), null, 2));
    const [opus, sol] = await Promise.all([ask("audit-opus-" + round, "opus", head(P.AUDIT) + shown, 8000, "high", true), ask("audit-sol-" + round, "sol", head(P.AUDIT) + shown, 8000, "high", true)]);
    if (opus?.pass === true && sol?.pass === true) {
      const rating = (a: any, id: string) => {
        const f = (a?.items ?? []).find((x: any) => x?.id === id)?.foreseeable;
        return FORESEEABLE.has(f) ? f : "maybe";
      };
      items = items.map((i) => ({ ...i, foreseeable: { opus: rating(opus, i.id), sol: rating(sol, i.id) } }));
      break;
    }
    if (round === 2) return done("audit-failed", plan);
    raw = await ask("key-2", "opus", head(P.KEY) + material + fence("Your earlier key", JSON.stringify(raw, null, 2)) + fence("Auditors' notes", JSON.stringify({ opus: opus?.problems ?? opus, sol: sol?.problems ?? sol }, null, 2)) + "\n\n" + P.KEY_FIX, 16000, "high", true);
  }
  const screened = await d.genericScreen({ unit: u.id, items, primary: [] });
  const key: Key = { unit: u.id, items: screened.items, primary: rankPrimary(u.id, screened.items) };
  if (!key.primary.length) return done("no-primary", plan, key);
  const recognized = {} as Record<ModelId, boolean>;
  for (const m of MODEL_IDS) {
    const r = await ask("recognition-" + m, m, recognitionPrompt(plan, u.readme, d.alias), 1000, null, true);
    recognized[m] = namesProject(String(r?.project ?? ""), u.real_names);
  }
  return done(recognized.opus ? "recognized-opus" : "keyed", plan, key, recognized);
}

export interface MissRead {
  id: string;
  /** Items left after the mechanical drops (no audit, no generic screen: the miss sample is descriptive). */
  items: number;
  dropped_items: number;
  spent_micros: number;
}

/** The miss sample (section 4): a dropped unit's rewrite and key read anyway; its counts print as the funnel's miss rates and it never enters a set. */
export async function missRead(u: FunnelUnit, d: FunnelDeps): Promise<MissRead> {
  const start = d.meter.spent();
  const { raw } = await keyRead(u, d, asker(u.id, d));
  const n = normalizeItems(raw, u.window, d.alias);
  const r = { id: u.id, items: n.items.length, dropped_items: n.dropped, spent_micros: d.meter.spent() - start };
  (d.log ?? (() => {}))(u.id, "miss-read", { items: r.items, dropped_items: r.dropped_items, spent_micros: r.spent_micros });
  return r;
}

export { MeterError };

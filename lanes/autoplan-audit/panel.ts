// Copyright (c) 2026 Garry Tan. MIT License.
// Sections 6, 9 (D1), 10 and 12: the panel driver on the metered client and the request journal. Astra and Opus label
// gold at maximum effort (16,000 output tokens); Astra, Opus and Argon label the judge check and production at medium
// (8,000). The binary comes first; Argon votes only on a split, and a provider drift stops Argon's calls. A lean gold
// item's medium reply is the same request as its census request and comes back from the journal. The smoke sends 4
// packets through the five judge and effort pairs and checks the parse, the quote and truncation; the re-projection
// prices every remaining request from the smoke's measured cost, adds every reservation still unresolved and 12 worst
// cases, and stops for the Captain when that passes the cap.
import { priceRequest, reservationMicros } from "../../src/runner/pricing/prices.ts";
import { ArError } from "./errors.ts";
import { ask, type Journal } from "./journal.ts";
import { combine, parseVote, type Combined, type JudgeKey, type Label } from "./judge.ts";
import { MeterError, MODELS, pool, requestBody, type CallRequest, type CallResult } from "./meter.ts";
import type { Packet } from "./packet.ts";
import { kappa } from "./stats.ts";

export type Effort = "max" | "medium";
export const EFFORT: Record<Effort, { effort: string; maxTokens: number }> = { max: { effort: "max", maxTokens: 16_000 }, medium: { effort: "medium", maxTokens: 8_000 } };
export const PAIRS: ReadonlyArray<readonly [JudgeKey, Effort]> = [["astra", "max"], ["opus", "max"], ["astra", "medium"], ["opus", "medium"], ["argon", "medium"]];
export const IN_FLIGHT = 4;
export const KAPPA_BAR = 0.6;
export const GOLD_PER_CLASS = 40;

export type Call = (req: CallRequest) => Promise<CallResult>;

export interface PanelState {
  argonStopped: boolean;
  missing: number;
}

export async function vote(j: Journal, call: Call, st: PanelState, judge: JudgeKey, effort: Effort, p: Packet, cell: string): Promise<{ label: Label | null; missing: string | null; micros: number; truncated: boolean }> {
  if (judge === "argon" && st.argonStopped) return { label: null, missing: "argon stopped", micros: 0, truncated: false };
  try {
    const a = await ask(j, call, { model: judge, prompt: p.body, ...EFFORT[effort], label: cell + ":" + judge + ":" + effort }, (t) => parseVote(t, p.built));
    if (a.label === null) st.missing++;
    return { label: a.label as Label | null, missing: a.missing, micros: a.result?.micros ?? 0, truncated: a.result?.truncated ?? false };
  } catch (e) {
    if (e instanceof MeterError && e.code === "E_AR_PROVIDER_DRIFT") {
      st.argonStopped = true;
      st.missing++;
      return { label: null, missing: "provider drift", micros: 0, truncated: false };
    }
    throw e;
  }
}

export interface SmokeRow {
  judge: JudgeKey;
  effort: Effort;
  ok: boolean;
  truncated: boolean;
  micros: number;
  bytes: number;
}

export async function smoke(j: Journal, call: Call, st: PanelState, packets: readonly Packet[]): Promise<{ pass: boolean; rows: SmokeRow[] }> {
  const jobs = packets.flatMap((p, i) => PAIRS.map(([judge, effort]) => async (): Promise<SmokeRow> => {
    const v = await vote(j, call, st, judge, effort, p, "smoke" + i);
    return { judge, effort, ok: v.label !== null, truncated: v.truncated, micros: v.micros, bytes: p.bytes };
  }));
  const rows = await pool(IN_FLIGHT, jobs);
  return { pass: rows.every((r) => r.ok && !r.truncated), rows };
}

export interface GoldItem {
  id: string;
  kind: "hit" | "ablated" | "miss";
  packet: Packet;
}

/** Astra and Opus at maximum effort; gold is every item where their binary labels agree. */
export async function goldPass(j: Journal, call: Call, st: PanelState, items: readonly GoldItem[]): Promise<Map<string, boolean>> {
  const rows = await pool(IN_FLIGHT, items.map((it) => async () => {
    const [a, o] = [await vote(j, call, st, "astra", "max", it.packet, "gold:" + it.id), await vote(j, call, st, "opus", "max", it.packet, "gold:" + it.id)];
    return { id: it.id, a: a.label, o: o.label };
  }));
  const gold = new Map<string, boolean>();
  for (const r of rows) if (r.a !== null && r.o !== null && (r.a === "LANDED") === (r.o === "LANDED")) gold.set(r.id, r.a === "LANDED");
  return gold;
}

export const goldCounts = (gold: ReadonlyMap<string, boolean>) => ({ landed: [...gold.values()].filter(Boolean).length, not: [...gold.values()].filter((v) => !v).length });

export interface CheckResult {
  kappa: Record<JudgeKey, number | null>;
  pass: { astra: boolean; opus: boolean; argon: boolean };
  /** The combined panel on gold: LANDED gold labelled LANDED, and NOT_LANDED gold labelled not LANDED. */
  sensK: number;
  sensN: number;
  specK: number;
  specN: number;
}

export function judgeCheck(gold: ReadonlyMap<string, boolean>, labels: ReadonlyMap<string, Record<JudgeKey, Label | null>>): CheckResult {
  const k = (judge: JudgeKey) => kappa([...gold].filter(([id]) => labels.get(id)?.[judge] != null).map(([id, g]) => [labels.get(id)![judge] === "LANDED", g] as const));
  const kap = { astra: k("astra"), opus: k("opus"), argon: k("argon") };
  const ok = (x: number | null) => x !== null && x >= KAPPA_BAR;
  const pass = { astra: ok(kap.astra), opus: ok(kap.opus), argon: ok(kap.argon) };
  let sensK = 0, sensN = 0, specK = 0, specN = 0;
  for (const [id, g] of gold) {
    const l = labels.get(id);
    const c = l ? combine(l.astra, l.opus, l.argon, pass.argon) : { binary: null };
    if (c.binary === null) continue;
    if (g) {
      sensN++;
      if (c.binary === "LANDED") sensK++;
    } else {
      specN++;
      if (c.binary === "NOT") specK++;
    }
  }
  return { kappa: kap, pass, sensK, sensN, specK, specN };
}

/** Astra, Opus and Argon at medium on every gold item (the judge check). */
export async function checkPass(j: Journal, call: Call, st: PanelState, items: readonly GoldItem[], gold: ReadonlyMap<string, boolean>): Promise<CheckResult> {
  const labels = new Map<string, Record<JudgeKey, Label | null>>();
  await pool(IN_FLIGHT, items.filter((it) => gold.has(it.id)).map((it) => async () => {
    const one = async (judge: JudgeKey) => (await vote(j, call, st, judge, "medium", it.packet, "unit:" + it.id)).label;
    labels.set(it.id, { astra: await one("astra"), opus: await one("opus"), argon: await one("argon") });
  }));
  return judgeCheck(gold, labels);
}

/** Production: Astra and Opus at medium; Argon only on a binary split (or with one of the two missing). */
export async function production(j: Journal, call: Call, st: PanelState, units: ReadonlyArray<{ id: string; packet: Packet }>, argonOk: boolean): Promise<Map<string, Combined>> {
  const out = new Map<string, Combined>();
  await pool(IN_FLIGHT, units.map((u) => async () => {
    const a = (await vote(j, call, st, "astra", "medium", u.packet, "unit:" + u.id)).label;
    const o = (await vote(j, call, st, "opus", "medium", u.packet, "unit:" + u.id)).label;
    const split = !(a !== null && o !== null && (a === "LANDED") === (o === "LANDED"));
    const g = split && argonOk ? (await vote(j, call, st, "argon", "medium", u.packet, "unit:" + u.id)).label : null;
    out.set(u.id, combine(a, o, g, argonOk));
  }));
  return out;
}

export interface Projection {
  projected_micros: number;
  worst_micros: number;
  unresolved_micros: number;
  total_micros: number;
  stop: boolean;
}

/** Section 10's re-projection: remaining requests at the smoke's measured cost per request byte, unresolved reservations, and 12 worst cases. */
export function reproject(o: { smoke: readonly SmokeRow[]; remaining: ReadonlyArray<{ judge: JudgeKey; effort: Effort; body: string }>; unresolved_micros: number; spent_micros: number; cap_micros: number }): Projection {
  const rate = new Map<string, number>();
  for (const [judge, effort] of PAIRS) {
    const rows = o.smoke.filter((r) => r.judge === judge && r.effort === effort && r.bytes > 0);
    rate.set(judge + effort, rows.length ? rows.reduce((a, r) => a + r.micros, 0) / rows.reduce((a, r) => a + r.bytes, 0) : 0);
  }
  let projected = 0, worst = 0;
  for (const r of o.remaining) {
    projected += rate.get(r.judge + r.effort)! * Buffer.byteLength(r.body);
    const m = MODELS[r.judge];
    const body = requestBody(m, r.body, EFFORT[r.effort].maxTokens, EFFORT[r.effort].effort);
    worst = Math.max(worst, reservationMicros(priceRequest(m.provider, body, EFFORT[r.effort].maxTokens)));
  }
  const total = o.spent_micros + Math.ceil(projected) + o.unresolved_micros + 12 * worst;
  return { projected_micros: Math.ceil(projected), worst_micros: worst, unresolved_micros: o.unresolved_micros, total_micros: total, stop: total > o.cap_micros };
}

export { ArError };

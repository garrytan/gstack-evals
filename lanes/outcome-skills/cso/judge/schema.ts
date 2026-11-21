// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's reply shapes for pass A (the key-blind finding list) and pass B (the key-aware labels), and the gold
// labellers' second call. A reply that does not parse to its shape is malformed: the caller retries once, then records a
// judge gap. Pass A's order rule is enforced by code after parsing: findings from the final message first, each group in
// the judge's order.
import type { Citation } from "../score/checks.ts";

export type Tri = "yes" | "no" | "cant_tell";
export type Validity = "supported" | "unsupported" | "cant_tell";
export interface Finding { text: string; source: "final" | "earlier"; citations: Citation[] }
export interface KnownLabel { ghsa: string; location: Tri; class: Tri; same_defect: Tri; grounding: Tri }
/** Pass B's labels for one counted finding, each with a short quote. */
export interface FindingLabels { location: Tri; class: Tri; same_defect: Tri; grounding: Tri; file_level: Tri; known: KnownLabel | null; validity: Validity; quotes: Record<string, string> }
export interface GoldSecond { own: FindingLabels[]; pass_a: Validity[] }

const TRI: readonly string[] = ["yes", "no", "cant_tell"];
const VAL: readonly string[] = ["supported", "unsupported", "cant_tell"];
const isTri = (x: unknown): x is Tri => typeof x === "string" && TRI.includes(x);
const posInt = (x: unknown) => x === null || x === undefined || (Number.isInteger(x) && (x as number) >= 1);

/** The JSON object in a reply: the whole text, or the last fenced json block. */
export function replyJson(text: string): unknown {
  const fences = [...text.matchAll(/\x60\x60\x60(?:json)?\s*\n([\s\S]*?)\n\x60\x60\x60/g)];
  for (const t of [text.trim(), fences.length ? fences[fences.length - 1]![1]! : null]) {
    if (t === null) continue;
    try {
      return JSON.parse(t);
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Pass A's finding list in the order rule, or null when the reply is malformed. */
export function parsePassA(text: string): Finding[] | null {
  const j = replyJson(text) as { findings?: unknown } | undefined;
  if (!j || !Array.isArray(j.findings)) return null;
  const out: Finding[] = [];
  for (const f of j.findings as Record<string, unknown>[]) {
    if (!f || typeof f.text !== "string" || !f.text.trim() || (f.source !== "final" && f.source !== "earlier") || !Array.isArray(f.citations)) return null;
    const citations: Citation[] = [];
    for (const c of f.citations as Record<string, unknown>[]) {
      if (!c || typeof c.path !== "string" || !c.path || !posInt(c.start) || !posInt(c.end) || !(c.symbol === null || c.symbol === undefined || typeof c.symbol === "string")) return null;
      const start = (c.start as number | undefined) ?? null;
      const end = (c.end as number | undefined) ?? start;
      if (start !== null && end !== null && end < start) return null;
      citations.push({ path: c.path, start, end, symbol: (c.symbol as string | undefined) || null });
    }
    out.push({ text: f.text, source: f.source, citations });
  }
  return [...out.filter((f) => f.source === "final"), ...out.filter((f) => f.source === "earlier")];
}

function labelsOf(x: unknown, n: number): FindingLabels[] | null {
  if (!Array.isArray(x) || x.length !== n) return null;
  const out: FindingLabels[] = [];
  for (const [i, l] of (x as Record<string, unknown>[]).entries()) {
    if (!l || l.finding !== i + 1) return null;
    if (![l.location, l.class, l.same_defect, l.grounding, l.file_level].every(isTri) || typeof l.validity !== "string" || !VAL.includes(l.validity)) return null;
    let known: KnownLabel | null = null;
    if (l.known !== null && l.known !== undefined) {
      const k = l.known as Record<string, unknown>;
      if (typeof k.ghsa !== "string" || ![k.location, k.class, k.same_defect, k.grounding].every(isTri)) return null;
      known = { ghsa: k.ghsa, location: k.location as Tri, class: k.class as Tri, same_defect: k.same_defect as Tri, grounding: k.grounding as Tri };
    }
    const quotes = l.quotes && typeof l.quotes === "object" ? Object.fromEntries(Object.entries(l.quotes as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string> : {};
    out.push({ location: l.location as Tri, class: l.class as Tri, same_defect: l.same_defect as Tri, grounding: l.grounding as Tri, file_level: l.file_level as Tri, known, validity: l.validity as Validity, quotes });
  }
  return out;
}

/** Pass B's labels, one per finding sent and numbered from 1, or null when malformed. */
export function parsePassB(text: string, n: number): FindingLabels[] | null {
  const j = replyJson(text) as { labels?: unknown } | undefined;
  return j ? labelsOf(j.labels, n) : null;
}

/** A gold labeller's second call: hit labels for its own counted findings and validity for pass A's, or null. */
export function parseGoldSecond(text: string, own: number, passA: number): GoldSecond | null {
  const j = replyJson(text) as { own?: unknown; pass_a?: unknown } | undefined;
  if (!j) return null;
  const o = labelsOf(j.own, own);
  if (!o || !Array.isArray(j.pass_a) || j.pass_a.length !== passA) return null;
  const v: Validity[] = [];
  for (const [i, x] of (j.pass_a as Record<string, unknown>[]).entries()) {
    if (!x || x.finding !== i + 1 || typeof x.validity !== "string" || !VAL.includes(x.validity)) return null;
    v.push(x.validity as Validity);
  }
  return { own: o, pass_a: v };
}

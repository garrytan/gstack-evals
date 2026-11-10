// Copyright (c) 2026 Garry Tan. MIT License.
// Section 6: reading a judge's reply and combining the panel. lastJson is adapted from lanes/product-value/judge.ts at
// gstack-evals commit 3744a20, used here without the product-value judge's retry loop: an unparseable label is missing
// and never re-asked. For LANDED, PARTLY and REVERSED the evidence quote must appear in the packet's scrubbed built
// text after both are normalized (markdown marks removed, curly quotes and dashes made plain, whitespace and case
// folded); a quote cut by an ellipsis matches when each part appears in order. The binary (LANDED against the rest) is
// decided first by Astra and Opus; Argon decides a split. The subclass of a not-LANDED unit is descriptive.
export type Label = "LANDED" | "PARTLY" | "NOT_LANDED" | "REVERSED";
export const LABELS: readonly Label[] = ["LANDED", "PARTLY", "NOT_LANDED", "REVERSED"];
export type JudgeKey = "astra" | "opus" | "argon";

/** The last JSON object in a reply, inside a code fence or bare (from lanes/product-value/judge.ts at 3744a20). */
export function lastJson(text: string): any {
  const trimmed = text.trim();
  const fences = [...trimmed.matchAll(/\x60\x60\x60[a-zA-Z]*\n([\s\S]*?)\x60\x60\x60/g)].map((m) => m[1]!);
  for (const cand of [trimmed, ...fences.reverse(), trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)]) {
    try {
      const v = JSON.parse(cand);
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

export const normalize = (t: string): string =>
  t
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[*_\x60|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function quoteFound(quote: string, built: string): boolean {
  const hay = normalize(built);
  const parts = quote.split(/\.\.\.|\u2026/).map(normalize).filter(Boolean);
  if (!parts.length) return false;
  let at = 0;
  for (const p of parts) {
    const i = hay.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}

export interface Vote {
  label: Label | null;
  /** Why the label is missing: unparsed, bad label, quote not found, long quote, call failed, unknown. */
  missing: string | null;
}

export function parseVote(text: string | null, built: string): Vote {
  if (text === null) return { label: null, missing: "no reply" };
  const v = lastJson(text);
  const label = typeof v?.label === "string" ? (v.label.trim().toUpperCase().replace(/[\s-]+/g, "_") as Label) : null;
  if (!v) return { label: null, missing: "unparsed" };
  if (!label || !LABELS.includes(label)) return { label: null, missing: "bad label" };
  if (label === "NOT_LANDED") return { label, missing: null };
  const quote = typeof v.quote === "string" ? v.quote : "";
  if (quote.split(/\s+/).filter(Boolean).length > 30) return { label: null, missing: "long quote" };
  return quoteFound(quote, built) ? { label, missing: null } : { label: null, missing: "quote not found" };
}

export interface Combined {
  /** LANDED, NOT (any other label), or null when missing. */
  binary: "LANDED" | "NOT" | null;
  /** For a not-LANDED unit: the label two available judges gave, else split. */
  subclass: Exclude<Label, "LANDED"> | "split" | null;
  argonUsed: boolean;
}

/**
 * Astra and Opus agreeing decide the binary. On a split Argon casts the deciding vote; with one of the two missing,
 * Argon must agree with the other. A missing Argon vote, or a failed Argon check, leaves such a unit missing.
 */
export function combine(a: Label | null, o: Label | null, g: Label | null | undefined, argonOk: boolean): Combined {
  const bin = (l: Label | null | undefined) => (l === null || l === undefined ? null : l === "LANDED" ? "LANDED" : "NOT");
  const ba = bin(a), bo = bin(o);
  let binary: Combined["binary"] = null;
  let argonUsed = false;
  if (ba !== null && ba === bo) binary = ba;
  else if (ba !== null || bo !== null) {
    argonUsed = true;
    const bg = argonOk ? bin(g) : null;
    if (bg !== null) binary = ba !== null && bo !== null ? bg : bg === (ba ?? bo) ? bg : null;
  }
  if (binary !== "NOT") return { binary, subclass: null, argonUsed };
  const labels = [a, o, argonOk ? g ?? null : null].filter((l): l is Label => l !== null && l !== "LANDED");
  const counts = new Map<Label, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const two = [...counts].find(([, n]) => n >= 2);
  return { binary, subclass: two ? (two[0] as Exclude<Label, "LANDED">) : "split", argonUsed };
}

/** A reply that stopped at its output limit (the smoke's truncation check). */
export function truncated(provider: "anthropic" | "openai" | "openrouter", body: any): boolean {
  if (provider === "anthropic") return body?.stop_reason === "max_tokens";
  if (provider === "openai") return body?.status === "incomplete" || body?.incomplete_details?.reason === "max_output_tokens";
  return body?.choices?.[0]?.finish_reason === "length";
}

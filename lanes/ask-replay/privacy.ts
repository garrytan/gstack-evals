// Copyright (c) 2026 Garry Tan. MIT License.
// The ask replay eval's two frozen scanners (prereg sections 2 and 11). redact() is the secret and contact scan build.ts
// runs on every text field in custody: each hit of a key or token shape, an email or a phone number becomes the one
// fixed placeholder, the same in every arm. scanPublic() is the public-text scan for the repo: issue keys or thread
// codes in prose, dollar figures outside an "Agent notes" section, names from a deny list, and 6-gram hits and the
// largest content-word Jaccard against a custody corpus. Both return counts only, never the text they matched.
import { readFileSync } from "node:fs";
import { contentWords } from "../office-hours-founder/score/counters.ts";
import { FROZEN } from "./frozen.ts";
import type { AskItem } from "./types.ts";

export const PLACEHOLDER = FROZEN.privacy.placeholder;

/** Key, token and contact shapes, applied in this order. A PEM block goes first so its body is one hit. */
export const SECRET_SHAPES: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: "pem_private_key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { kind: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: "sk_key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: "slack_token", re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g },
  { kind: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "google_key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { kind: "phone", re: /(?<![\w.-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])/g },
  { kind: "phone", re: /(?<![\w.+-])\+\d{1,3}(?:[\s.-]\d{2,5}){2,4}(?![\w-])/g },
];

/** A long hex or base64 run counts as a secret only within 20 characters of one of these words. */
const RUN = /[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{32,}={0,2}/g;
const KEYWORD = /key|token|secret|password/i;
const mixed = (s: string) => /^[A-Fa-f0-9]+$/.test(s) || (/[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s));

export interface ScanCount {
  hits: number;
  by_kind: Record<string, number>;
}

export const emptyCount = (): ScanCount => ({ hits: 0, by_kind: {} });

const tally = (c: ScanCount | undefined, kind: string) => {
  if (!c) return;
  c.hits++;
  c.by_kind[kind] = (c.by_kind[kind] ?? 0) + 1;
};

/** The text with every secret or contact hit replaced by the placeholder; count, when given, gains each hit. */
export function redact(text: string, count?: ScanCount): string {
  let out = text;
  for (const { kind, re } of SECRET_SHAPES) out = out.replace(re, () => (tally(count, kind), PLACEHOLDER));
  return out.replace(RUN, (m: string, offset: number, whole: string) => {
    const near = KEYWORD.test(whole.slice(Math.max(0, offset - 20), offset)) || KEYWORD.test(whole.slice(offset + m.length, offset + m.length + 20));
    if (!near || !mixed(m.replace(/=+$/, ""))) return m;
    tally(count, "keyword_run");
    return PLACEHOLDER;
  });
}

/** Every text field of an item: conversation, rules, draft, earlier asks and their answers, and the labelling reply. */
export function itemTexts(item: AskItem): string[] {
  return [...item.conversation.map((m) => m.text), ...item.rules.map((r) => r.text), item.draft, ...item.earlier_asks.flatMap((e) => [e.text, ...(e.next_owner ? [e.next_owner.text] : [])]), ...(item.after_reply ? [item.after_reply.text] : [])];
}

/** The same item with every text field passed through redact(). */
export const redactItem = (item: AskItem, count?: ScanCount): AskItem => mapTexts(item, (t) => redact(t, count));

/** The same item with f applied to every text field. */
export function mapTexts(item: AskItem, f: (text: string) => string): AskItem {
  const r = f;
  return {
    ...item,
    conversation: item.conversation.map((m) => ({ ...m, text: r(m.text) })),
    rules: item.rules.map((x) => ({ ...x, text: r(x.text) })),
    draft: r(item.draft),
    earlier_asks: item.earlier_asks.map((e) => ({ ...e, text: r(e.text), next_owner: e.next_owner && { ...e.next_owner, text: r(e.next_owner.text) } })),
    after_reply: item.after_reply && { ...item.after_reply, text: r(item.after_reply.text) },
  };
}

const words = (t: string) => t.toLowerCase().replace(/\u2019/g, "'").match(/[a-z0-9']+/g) ?? [];

export function ngrams(text: string, n = FROZEN.privacy.ngram): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Content-word Jaccard (counters.ts contentWords); 0 when either side has fewer than the frozen minimum of content words. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size < FROZEN.privacy.jaccard_min_words || b.size < FROZEN.privacy.jaccard_min_words) return 0;
  let k = 0;
  for (const w of a) if (b.has(w)) k++;
  return k / (a.size + b.size - k);
}

/** Texts from a corpus file: JSON lines holding AskItems, strings or { text } objects, or plain lines. */
export function corpusTexts(file: string): string[] {
  const out = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      out.add(line);
      continue;
    }
    if (typeof v === "string") out.add(v);
    else if (v && typeof v === "object" && Array.isArray((v as AskItem).conversation)) for (const t of itemTexts(v as AskItem)) out.add(t);
    else if (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string") out.add((v as { text: string }).text);
    else out.add(line);
  }
  return [...out];
}

export interface Overlap {
  texts: number;
  ngram_hits: number;
  max_jaccard: number;
}

/** 6-gram hits (distinct 6-grams of texts found in the corpus) and the largest pairwise content-word Jaccard. */
export function overlap(texts: readonly string[], corpus: readonly string[]): Overlap {
  const grams = new Set<string>();
  for (const c of corpus) for (const g of ngrams(c)) grams.add(g);
  const sets = [...new Set(corpus)].map((c) => contentWords(c)).filter((s) => s.size >= FROZEN.privacy.jaccard_min_words);
  const seen = new Set<string>();
  let hits = 0;
  let max = 0;
  for (const t of new Set(texts)) {
    for (const g of ngrams(t)) if (grams.has(g) && !seen.has(g)) (seen.add(g), hits++);
    const mine = contentWords(t);
    for (const s of sets) max = Math.max(max, jaccard(mine, s));
  }
  return { texts: new Set(texts).size, ngram_hits: hits, max_jaccard: Math.round(max * 1e4) / 1e4 };
}

/** The synthetic set's privacy check (section 12): any 6-gram hit or a Jaccard above 0.5 fails. */
export function syntheticCheck(items: readonly AskItem[], corpus: readonly string[]): Overlap & { pass: boolean } {
  const o = overlap(items.flatMap(itemTexts), corpus);
  return { ...o, pass: o.ngram_hits === 0 && o.max_jaccard <= FROZEN.privacy.jaccard_fail_above };
}

/** Markdown with front matter, fenced code blocks and inline code removed: the prose the code scan reads. */
export function prose(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** Markdown with every "Agent notes" section (its heading to the next heading of the same or a higher level) removed. */
export function outsideAgentNotes(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let skip = 0;
  const heading = new RegExp("^(#{1,6})\\s+" + FROZEN.public_scan.agent_notes_heading + "\\s*$", "i");
  for (const l of lines) {
    const h = /^(#{1,6})\s/.exec(l);
    if (skip && h && h[1]!.length <= skip) skip = 0;
    const m = heading.exec(l);
    if (m) skip = m[1]!.length;
    if (!skip) out.push(l);
  }
  return out.join("\n");
}

export interface PublicScan extends Overlap {
  codes: number;
  dollars: number;
  names: number;
}

/** The lane's public-text scan of one markdown or text file, as counts. */
export function scanPublic(md: string, o: { deny?: readonly string[]; corpus?: readonly string[] } = {}): PublicScan {
  const allow = new Set(FROZEN.public_scan.code_allow);
  const codes = (prose(md).match(new RegExp(FROZEN.public_scan.code_pattern, "g")) ?? []).filter((c) => !allow.has(c)).length;
  const dollars = (outsideAgentNotes(md).match(/\$\s?\d/g) ?? []).length;
  const lower = md.toLowerCase();
  let names = 0;
  for (const n of o.deny ?? []) {
    const name = n.trim().toLowerCase();
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names += (lower.match(new RegExp("(?<![\\p{L}\\p{N}])" + esc + "(?![\\p{L}\\p{N}])", "gu")) ?? []).length;
  }
  const paragraphs = md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { codes, dollars, names, ...overlap(paragraphs, o.corpus ?? []) };
}

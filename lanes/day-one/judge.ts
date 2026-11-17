// Copyright (c) 2026 Garry Tan. MIT License.
// The plan judge (prereg section 9, R78): GPT-6 Astra labels each (plan, check) pair covered and usable, from the frozen
// prompt (prompts/judge.md). The model call comes in as call, so tests make none; the CLI passes the product-value meter
// on the judge's own ledger item.
// - A packet is one plan with every check of its brief: the brief, the plan under a random label, and the checks in a
//   seeded random order. Packets go out in a seeded random order. Nothing in a packet names its arm, model or source.
// - The answer is the last fenced labels block. Every check id exactly once, each with boolean covered and usable;
//   usable without covered reads as not usable. A packet with a missing or garbled cell is sent once more, whole, and
//   the resend's answer replaces the first; a cell still missing stays unlabelled (E_DAYONE_JUDGE).
// - Controls: the stock plan (prompts/stock-plan.md, which promises no feature) goes to every brief and may be covered
//   on at most STOCK_TOLERANCE of the primary checks; the volume control is each base plan with the stock plan
//   appended, whose covered labels must match the base plan's on at least 90% of pairs. A failed control is reported
//   and the judge's numbers don't count. The judge CLI's --controls adds both packets; its keys are stock|<unit> and
//   padded|<base key>.
// - Gold: the judge's labels on the gold pairs against the adjudicated gold labels, kappa of at least 0.6 on covered
//   and on usable over at least 40 pairs (E_DAYONE_GOLD otherwise).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kappa, seededRandom, shuffle } from "../product-value/stats.ts";
import { SEED } from "./frozen.ts";
import type { Check } from "./units.ts";

export const JUDGE_PROMPT_SHA256 = "589f911a654afed3190e9baca17513977d596fc736dcf7c330589ea682e4596d";
export const STOCK_PLAN_SHA256 = "c6e6220262a450baa5a35dc11503b27cc9e36231c1ad465aa90de5e98dff8b82";
export const JUDGE_EFFORT = "medium";
export const JUDGE_MAX_TOKENS = 16_000;
export const LABELS_FENCE = "labels";
export const GOLD_MIN = { pairs: 40, kappa: 0.6 } as const;
export const VOLUME_AGREEMENT = 0.9;
export const STOCK_TOLERANCE = 0.05;

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
function frozenText(name: string, want: string): string {
  const t = readFileSync(join(import.meta.dir, "prompts", name), "utf8");
  if (sha(t) !== want) throw new Error("E_USAGE lanes/day-one/prompts/" + name + " does not match its pinned sha256; the judge's texts are frozen (section 9)");
  return t;
}
export const judgePrompt = (): string => frozenText("judge.md", JUDGE_PROMPT_SHA256);
export const stockPlan = (): string => frozenText("stock-plan.md", STOCK_PLAN_SHA256);

export interface Packet {
  /** The random label the judge sees for the plan. */
  label: string;
  brief: string;
  plan: string;
  checks: Check[];
}

/** Random six-character labels, unique within taken. */
export function labelFor(rng: () => number, taken: Set<string>): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(rng() * 31)];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** The packets for a set of plans of one brief, checks shuffled per packet. */
export function packets(plans: readonly { key: string; brief: string; plan: string; checks: readonly Check[] }[], seed = SEED): { packets: Packet[]; keys: Record<string, string> } {
  const rng = seededRandom(seed);
  const taken = new Set<string>();
  const out: Packet[] = [];
  const keys: Record<string, string> = {};
  for (const p of shuffle(plans, rng)) {
    const label = labelFor(rng, taken);
    keys[label] = p.key;
    out.push({ label, brief: p.brief, plan: p.plan, checks: shuffle(p.checks, rng) });
  }
  return { packets: out, keys };
}

/** The packet's whole prompt. */
export function renderPacket(p: Packet): string {
  const items = p.checks.map((c) => JSON.stringify({ id: c.id, statement: c.statement, covered_if: c.covered_if, usable_if: c.usable_if })).join("\n");
  return judgePrompt() + "\n<brief>\n" + p.brief.trim() + "\n</brief>\n\n<plan label=\"" + p.label + "\">\n" + p.plan.trim() + "\n</plan>\n\n<items>\n" + items + "\n</items>\n";
}

export interface Label {
  id: string;
  covered: boolean;
  usable: boolean;
}
export type LabelParse = { kind: "ok"; labels: Label[] } | { kind: "bad"; reason: string; labels: Label[] };

const FENCE = new RegExp("```[ \\t]*" + LABELS_FENCE + "[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*```", "g");

/** Reads the last labels block; partial labels are kept for the resend rule. */
export function parseLabels(text: string | null, ids: readonly string[]): LabelParse {
  const blocks = text ? [...text.matchAll(FENCE)] : [];
  if (!blocks.length) return { kind: "bad", reason: "no fenced block labelled " + LABELS_FENCE, labels: [] };
  let obj: any;
  try {
    obj = JSON.parse(blocks.at(-1)![1]!);
  } catch {
    return { kind: "bad", reason: "the last labels block is not JSON", labels: [] };
  }
  if (!Array.isArray(obj?.items)) return { kind: "bad", reason: "the block has no items list", labels: [] };
  const times = new Map<unknown, number>();
  for (const it of obj.items) times.set(it?.id, (times.get(it?.id) ?? 0) + 1);
  const seen = new Map<string, Label>();
  const bad: string[] = [];
  for (const it of obj.items) {
    if (!ids.includes(it?.id) || times.get(it.id)! > 1 || typeof it?.covered !== "boolean" || typeof it?.usable !== "boolean") {
      bad.push(String(it?.id));
      continue;
    }
    seen.set(it.id, { id: it.id, covered: it.covered, usable: it.covered && it.usable });
  }
  const missing = ids.filter((id) => !seen.has(id));
  const labels = ids.filter((id) => seen.has(id)).map((id) => seen.get(id)!);
  if (missing.length || bad.length) return { kind: "bad", reason: "missing or garbled: " + [...new Set([...missing, ...bad])].join(", "), labels };
  return { kind: "ok", labels };
}

export type JudgeCall = (o: { prompt: string; label: string }) => Promise<{ text: string | null }>;

/** Labels one packet with one resend on a missing or garbled cell. */
export async function labelPacket(p: Packet, call: JudgeCall): Promise<{ labels: Label[]; missing: string[]; resent: boolean }> {
  const ids = p.checks.map((c) => c.id);
  const first = parseLabels((await call({ prompt: renderPacket(p), label: p.label })).text, ids);
  if (first.kind === "ok") return { labels: first.labels, missing: [], resent: false };
  const again = parseLabels((await call({ prompt: renderPacket(p) + "\n(This packet is sent a second time because the first answer missed or garbled at least one item. Answer every item.)\n", label: p.label + "-resend" })).text, ids);
  return { labels: again.labels, missing: ids.filter((id) => !again.labels.some((l) => l.id === id)), resent: true };
}

/** Kappa on covered and on usable between judge and gold, over pairs both labelled. */
export function goldAgreement(judge: ReadonlyMap<string, Label>, gold: ReadonlyMap<string, Label>): { pairs: number; covered: number | null; usable: number | null; admitted: boolean } {
  const keys = [...gold.keys()].filter((k) => judge.has(k));
  const covered = kappa(keys.map((k) => [judge.get(k)!.covered, gold.get(k)!.covered] as const));
  const usable = kappa(keys.map((k) => [judge.get(k)!.usable, gold.get(k)!.usable] as const));
  return { pairs: keys.length, covered, usable, admitted: keys.length >= GOLD_MIN.pairs && covered !== null && usable !== null && covered >= GOLD_MIN.kappa && usable >= GOLD_MIN.kappa };
}

/** The controls: the stock plan covers no primary check, and padded plans agree with their base plans on covered. */
export function controls(o: { stock: readonly { checks: readonly Check[]; labels: readonly Label[] }[]; volume: readonly { base: readonly Label[]; padded: readonly Label[] }[] }): { stock_primary_covered: number; stock_primary_checks: number; stock_allowed: number; volume_agreement: number | null; volume_pairs: number; passed: boolean } {
  let stockCovered = 0;
  let primary = 0;
  for (const s of o.stock) {
    primary += s.checks.filter((c) => c.role === "primary").length;
    for (const l of s.labels) if (l.covered && s.checks.find((c) => c.id === l.id)?.role === "primary") stockCovered++;
  }
  const allowed = Math.floor(STOCK_TOLERANCE * primary);
  let same = 0;
  let n = 0;
  for (const v of o.volume)
    for (const b of v.base) {
      const p = v.padded.find((x) => x.id === b.id);
      if (!p) continue;
      n++;
      if (p.covered === b.covered) same++;
    }
  const agreement = n ? same / n : null;
  return { stock_primary_covered: stockCovered, stock_primary_checks: primary, stock_allowed: allowed, volume_agreement: agreement, volume_pairs: n, passed: stockCovered <= allowed && (agreement === null || agreement >= VOLUME_AGREEMENT) };
}

/** A base plan with the stock plan appended, for the volume control. */
export const padded = (base: string): string => base.trimEnd() + "\n\n" + stockPlan();

// Copyright (c) 2026 Garry Tan. MIT License.
// The pstack-checks line's ledger items and caps (plan section 13), fixed in code like the state machines items.ts.
// This file records nothing and opens nothing. pf-blind sits outside the line's sum: it runs last, only if it fits.

const M = 1_000_000;

export const LINE = { name: "pstack-checks", cap_micros: 1980 * M, crew_counted_micros: 250 * M } as const;
export const OWNER_MICROS = 5000 * M;

export interface ItemDef { item: string; program: "pstack-checks"; skills: string[]; cap_micros: number; model: string | null; in_line: boolean; what: string }

export const OPUS = "claude-opus-5-5", SOL = "openai/gpt-6.1-sol", P1 = "particle-ai/particle-1";
export const MODELS = [OPUS, SOL, P1] as const;
const item = (name: string, usd: number, model: string | null, what: string, in_line = true): ItemDef => ({ item: name, program: "pstack-checks", skills: ["pf"], cap_micros: usd * M, model, in_line, what });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  item("pf-labels", 100, null, "Astra and Opus labels with the state machines labeller, for candidates it never labelled"),
  item("pf-oracle", 80, null, "VMs: the oracle on candidates that eval never ran, and the neutral-tree validation on every drawn unit"),
  item("pf-admit", 340, OPUS, "8 admission units on Opus (P, C, N told) and the Sol and particle-1 price probe; covers either raise"),
  item("pf-opus", 580, OPUS, "n = 28: P, C and N told on Opus"),
  item("pf-sol", 370, SOL, "the same on GPT-6.1 Sol"),
  item("pf-particle", 260, P1, "the same on particle-1"),
  item("pf-blind", 120, OPUS, "the blind probe on the 8 admission units, run last only if the line still holds its cap", false),
].map((d) => [d.item, d]));

export const MODEL_ITEM: Record<string, string> = { [OPUS]: "pf-opus", [SOL]: "pf-sol", [P1]: "pf-particle" };
export const lineItemsMicros = (): number => Object.values(ITEMS).filter((d) => d.in_line).reduce((a, d) => a + d.cap_micros, 0);

/** Planning prices per told session in dollars (section 13): Opus P 7, C 7, N 2; Sol at 0.6 and particle-1 at 0.4 of Opus. */
export const ARMS = ["P", "C", "N"] as const;
export type Arm = (typeof ARMS)[number];
const OPUS_PLAN: Record<Arm, number> = { P: 7, C: 7, N: 2 };
export const PLANNING: Record<string, Record<Arm, number>> = {
  [OPUS]: OPUS_PLAN,
  [SOL]: { P: 0.6 * 7, C: 0.6 * 7, N: 0.6 * 2 },
  [P1]: { P: 0.4 * 7, C: 0.4 * 7, N: 0.4 * 2 },
};
export const VM_USD = 0.4;
export const BLIND_USD = 12;
export const CREW_CENTRAL_USD = 200;

/** Task-turn allowances per session in dollars (section 5). */
export const ALLOWANCE: Record<Arm, Record<string, number>> = {
  P: { [OPUS]: 13, [SOL]: 12, [P1]: 5 },
  C: { [OPUS]: 13, [SOL]: 12, [P1]: 5 },
  N: { [OPUS]: 13, [SOL]: 12, [P1]: 3 },
};
export const BLIND_ALLOWANCE_USD = 15;

export function itemsTable(): string[] {
  const out = ["line " + LINE.name + " cap_micros=" + LINE.cap_micros + " items_micros=" + lineItemsMicros() + " crew_counted_micros=" + LINE.crew_counted_micros];
  for (const d of Object.values(ITEMS)) out.push("  " + d.item + " cap_micros=" + d.cap_micros + " model=" + (d.model ?? "-") + (d.in_line ? "" : " outside-line") + "  " + d.what);
  return out;
}

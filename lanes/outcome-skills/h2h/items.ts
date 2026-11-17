// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's ledger items at planning prices (plan section 14; figures in the post's Agent notes, A2). Central
// prices only: each item's cap is the one the Captain records in the approvals record before its first lease, and the
// ledger reads that, never this file. This file records nothing and opens nothing.

export interface ItemDef { item: string; central_usd: number | null; model: string | null; what: string }

export const OPUS = "claude-opus-5-5";
const item = (name: string, usd: number | null, model: string | null, what: string): ItemDef => ({ item: name, central_usd: usd, model, what });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  item("h2h-smoke", 85, OPUS, "stage 0: 33 Opus sessions on 4 units, plus up to 11 repair reruns"),
  item("h2h-pilot", 383, OPUS, "stage 1: 12 O and 12 B units, 7 arms; piece G on O; /qa on 6 B1 units"),
  item("h2h-opus", 2128, OPUS, "stage 2: 100 O and 60 B units, 7 arms"),
  item("h2h-qa", 61, OPUS, "stage 2: gstack /qa on about 30 B1 units"),
  item("h2h-pony", 288, OPUS, "stage 2: piece G's two arms on 100 O units"),
  item("h2h-labels", 40, null, "B1 browser-only labels, GPT-6 Astra and Opus, about 100 units"),
  item("h2h-vms", 480, null, "image builds and the image store, oracle, session VMs, the runner host"),
  item("h2h-reserve", null, null, "released only by the Captain, for a named repair"),
  item("h2h-crew", 1300, null, "Capy model use; its ledger stop comes to the Captain"),
  item("h2h-rerun", 70, null, "another crew recomputes the numbers and re-scores 10% of session trees"),
].map((d) => [d.item, d]));

/** Planning price of a no-skills O session on Opus, and each arm's multiplier until stage 1 measures them. B is 1.5 times O. */
export const NO_SKILLS_O_USD = 0.8;
export const B_FACTOR = 1.5;
export const MULTIPLIER: Record<string, number> = {
  none: 1, gstack: 1.7, superpowers: 2.5, "agent-skills": 2.0, gsd: 3.5, pstack: 2.0, tstack: 1.3,
  "gstack-pony": 1.9, "gstack-oneline": 1.7, "gstack-qa": 1.7,
};
/** Model items are capped at 1.35 times central. */
export const CAP_FACTOR = 1.35;

// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's scripted anchor blocks (prereg section 7), written from key.json with no model call.
// - The oracle block, the judge check's known-good anchor: first_move "Sell <wedge> to <customer>.", next_action the
//   key's first_move item, no other moves and no doubt. It exists only where that sentence fits in 40 words.
// - The three near-miss anchors, from the key's alternative item: "Sell <wedge> to <alternative customer>." (credited on
//   wedge only), "Sell <alternative wedge> to <customer>." (credited on customer only) and "Sell <alternative wedge> to
//   <alternative customer>." (credited on neither), each only where it fits in 40 words. Their next action, other moves
//   and doubt are empty: their fixed labels cover the customer and wedge cells only.
// Each item goes in as the key writes it, trimmed, with trailing full stops dropped. Every anchor is normalized like
// any block before a judge reads it.
import { CUTS } from "../frozen.ts";
import { normalizeBlock, words } from "../parse.ts";
import type { Key, NormalizedBlock } from "../types.ts";

const item = (s: string) => s.trim().replace(/[.\s]+$/, "");

/** "Sell <wedge> to <customer>.", or null when it runs past 40 words. */
export function sellSentence(wedge: string, customer: string): string | null {
  const s = "Sell " + item(wedge) + " to " + item(customer) + ".";
  return words(s) <= CUTS.first_move ? s : null;
}

/** The oracle block for one key, or null when its sentence runs past 40 words. */
export function oracleBlock(key: Key): NormalizedBlock | null {
  const s = sellSentence(key.wedge, key.customer);
  return s === null ? null : normalizeBlock({ first_move: s, next_action: key.first_move, other_moves: [], doubt: "" });
}

export type NearMiss = "wedge-only" | "customer-only" | "neither";

/** The near-miss anchors that fit in 40 words, each with its fixed customer and wedge labels. Empty without an alternative. */
export function nearMisses(key: Key): Array<{ near: NearMiss; expect: { customer: boolean; wedge: boolean }; block: NormalizedBlock }> {
  const alt = key.alternative;
  if (!alt) return [];
  const drafts: Array<[NearMiss, string, string, { customer: boolean; wedge: boolean }]> = [
    ["wedge-only", key.wedge, alt.customer, { customer: false, wedge: true }],
    ["customer-only", alt.wedge, key.customer, { customer: true, wedge: false }],
    ["neither", alt.wedge, alt.customer, { customer: false, wedge: false }],
  ];
  return drafts.flatMap(([near, wedge, customer, expect]) => {
    const s = sellSentence(wedge, customer);
    return s === null ? [] : [{ near, expect, block: normalizeBlock({ first_move: s, next_action: "", other_moves: [], doubt: "" }) }];
  });
}

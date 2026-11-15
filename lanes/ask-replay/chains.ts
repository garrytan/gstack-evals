// Copyright (c) 2026 Garry Tan. MIT License.
// Decision chains (prereg section 7, F1) and the free S1 matcher (section 8). A link joins a duplicate item to the
// earlier ask it repeats; chains are the linked groups (union of links, within one thread), and items in no chain are
// their own clusters. S1 is counters.ts's repeat rule as a send-time matcher: a draft repeats an earlier ask when one of
// its questions shares at least two content words with one of that ask's questions (a text with no question uses its
// first sentence). The proxy linker joins each duplicate to the earlier ask in its thread that S1 matches with the
// highest content-word Jaccard (every earlier ask when S1 matches none), ties to the newest.
import { contentWords, isQuestion, sentences } from "../office-hours-founder/score/counters.ts";
import { FROZEN } from "./frozen.ts";
import type { AskItem, EarlierAsk } from "./types.ts";

/** A duplicate item and the order of the earlier ask it repeats, in the item's thread. */
export interface Link {
  item: string;
  to: number;
}

export function questions(text: string): string[] {
  const s = sentences(text);
  const q = s.filter(isQuestion);
  return q.length ? q : s.slice(0, 1);
}

export function sharesSubject(a: string, b: string): boolean {
  const mine = questions(a).map(contentWords);
  return questions(b).some((q) => {
    const theirs = contentWords(q);
    return mine.some((s) => [...s].filter((w) => theirs.has(w)).length >= FROZEN.s1.min_shared_content_words);
  });
}

/** S1: the newest earlier ask the draft repeats, or null. */
export function s1Match(item: Pick<AskItem, "draft" | "earlier_asks">): EarlierAsk | null {
  return [...item.earlier_asks].sort((a, b) => b.order - a.order).find((e) => sharesSubject(item.draft, e.text)) ?? null;
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  if (!a.size && !b.size) return 0;
  let k = 0;
  for (const w of a) if (b.has(w)) k++;
  return k / (a.size + b.size - k);
};

export function proxyLinks(items: readonly AskItem[]): Link[] {
  const out: Link[] = [];
  for (const it of items) {
    if (it.label !== "DUPLICATE" || !it.earlier_asks.length) continue;
    const matched = it.earlier_asks.filter((e) => sharesSubject(it.draft, e.text));
    const pool = matched.length ? matched : it.earlier_asks;
    const mine = contentWords(it.draft);
    let best: { e: EarlierAsk; j: number } | null = null;
    for (const e of pool) {
      const j = jaccard(mine, contentWords(e.text));
      if (!best || j > best.j || (j === best.j && e.order > best.e.order)) best = { e, j };
    }
    out.push({ item: it.item, to: best!.e.order });
  }
  return out;
}

/** Cluster id per item: its chain (thread and the lowest event order in the chain) or the item alone. */
export function clusters(items: readonly Pick<AskItem, "item" | "thread" | "order">[], links: readonly Link[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const key = (thread: string, order: number) => thread + ":" + order;
  const orderOf = (k: string) => Number(k.slice(k.lastIndexOf(":") + 1));
  const byId = new Map(items.map((i) => [i.item, i]));
  for (const i of items) parent.set(key(i.thread, i.order), key(i.thread, i.order));
  for (const l of links) {
    const it = byId.get(l.item);
    if (!it) continue;
    const a = find(key(it.thread, it.order));
    const bk = key(it.thread, l.to);
    if (!parent.has(bk)) parent.set(bk, bk);
    const b = find(bk);
    if (a !== b) orderOf(a) < orderOf(b) ? parent.set(b, a) : parent.set(a, b);
  }
  return new Map(items.map((i) => [i.item, "chain " + find(key(i.thread, i.order))]));
}

export interface ChainStats {
  clusters: number;
  chains: number;
  in_chains: number;
  largest_share: Record<string, number>;
}

/** Cluster count (the effective clusters), chains of two or more items, and the largest chain's share of each thread's items. */
export function chainStats(items: readonly Pick<AskItem, "item" | "thread">[], cl: ReadonlyMap<string, string>): ChainStats {
  const size = new Map<string, number>();
  for (const i of items) size.set(cl.get(i.item)!, (size.get(cl.get(i.item)!) ?? 0) + 1);
  const largest: Record<string, number> = {};
  for (const t of [...new Set(items.map((i) => i.thread))].sort()) {
    const mine = items.filter((i) => i.thread === t);
    const max = Math.max(...mine.map((i) => size.get(cl.get(i.item)!)!));
    largest[t] = Math.round((max / mine.length) * 1e4) / 1e4;
  }
  const chains = [...size.values()].filter((n) => n >= 2);
  return { clusters: size.size, chains: chains.length, in_chains: chains.reduce((a, b) => a + b, 0), largest_share: largest };
}

/** Whether the earlier ask a duplicate repeats lies inside the item's conversation window; null when it is not an earlier ask row. */
export function repeatInWindow(item: AskItem, to: number): boolean | null {
  const e = item.earlier_asks.find((x) => x.order === to);
  if (!e) return null;
  if (!item.cut) return true;
  const first = item.conversation[0];
  return first !== undefined && Date.parse(e.at) >= Date.parse(first.at);
}

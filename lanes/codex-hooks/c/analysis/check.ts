// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check (R78, preregistration section 5.5). Gold labels are the items where GPT-6.2 Astra and Gemini 4 Argon
// agree, each reading the same packet and brief. An item is one packet's blocker, labelled match when the judge names any
// finding for it. The pilot check set is every item of the pilot's matching batch (every state with counted findings)
// plus anchors: each anchor packet holds one finding the harness wrote, and its item is the bug it was written for. A
// state with no counted finding has no packet and no item. The check passes at kappa of at least 0.6 on at least 40 gold
// items with at least 10 in each class, for the primary alone and for the joined label; kappa on the non-anchor items is
// reported, and must also reach 0.6 when they hold at least 10 of each class. After the counted run, the confirmation
// check draws 40 judged items by seed, 20 from each joined label, and checks the joined label against new gold labels the
// same way. If either check fails, route B (Gemini 4 Carbon as primary) is judged and checked the same way; if no route
// passes there is no reading.
import type { Suite } from "../../../review-noloss/suite.ts";
import { CHECK, type RouteName } from "./frozen.ts";
import { kappa, matchAnswer, packetItems, readReplyText, seededShuffle, type Key } from "./judging.ts";

type Label = "match" | "none";
const label = (s: Set<string> | undefined): Label | undefined => (s === undefined ? undefined : s.size ? "match" : "none");

/** The pilot check set: every item of a state packet, and each anchor packet's anchored bug. */
export function checkItems(key: Key, suite: Suite): Array<{ item: string; anchor: Key["packets"][number]["anchor"] }> {
  return key.packets.flatMap((p): Array<{ item: string; anchor: Key["packets"][number]["anchor"] }> => (p.anchor ? [{ item: p.file + " " + p.anchor.bug, anchor: p.anchor }] : packetItems(key, suite, p).map((item) => ({ item, anchor: null }))));
}

export interface Gold {
  labellers: string[];
  /** Items both labellers answered and agree on. */
  gold: Map<string, Label>;
  disagree: number;
  /** Items a labeller left unanswered (its reply for the packet refused twice). */
  unanswered: number;
}

/** Gold labels from the two labellers' replies, on the named items. */
export function goldLabels(key: Key, suite: Suite, replies: ReadonlyArray<string>, items: readonly string[]): Gold {
  if (replies.length !== 2) throw new Error("E_CH_C_CHECK gold labels need exactly two labellers' replies");
  const read = replies.map((text, i) => {
    const r = readReplyText(text, key, "gold labeller " + (i + 1));
    const labels = new Map<string, Set<string>>();
    for (const { ref, body } of r.packets) for (const [k, v] of matchAnswer(key, suite, ref, body, "gold labeller " + (i + 1))) labels.set(k, v);
    return { judge: r.judge, labels };
  });
  if (read[0]!.judge === read[1]!.judge) throw new Error("E_CH_C_CHECK both gold replies are from " + read[0]!.judge + "; gold needs two labellers");
  const gold = new Map<string, Label>();
  let disagree = 0;
  let unanswered = 0;
  for (const k of items) {
    const [x, y] = read.map((r) => label(r.labels.get(k)));
    if (x === undefined || y === undefined) unanswered++;
    else if (x === y) gold.set(k, x);
    else disagree++;
  }
  return { labellers: read.map((r) => r.judge), gold, disagree, unanswered };
}

export interface Kappa {
  items: number;
  match: number;
  none: number;
  kappa: number | null;
  pass: boolean;
  why: string | null;
}

/** Kappa of a judge's labels against gold on the gold items, with section 5.5's size rule. */
export function kappaAgainst(gold: Map<string, Label>, judge: Map<string, Set<string>>, items: Iterable<string>, rule: { minItems: number; minClass: number }): Kappa {
  const pairs: Array<readonly [Label, Label]> = [];
  for (const k of items) {
    const g = gold.get(k);
    const j = label(judge.get(k));
    if (g !== undefined && j !== undefined) pairs.push([j, g]);
  }
  const match = pairs.filter(([, g]) => g === "match").length;
  const none = pairs.length - match;
  const k = kappa(pairs);
  const why = pairs.length < rule.minItems ? pairs.length + " gold items, under " + rule.minItems : match < rule.minClass || none < rule.minClass ? match + " match and " + none + " no-match gold items; each class needs " + rule.minClass : k === null || k < CHECK.kappa ? "kappa " + (k ?? "n/a") + " is under " + CHECK.kappa : null;
  return { items: pairs.length, match, none, kappa: k, pass: why === null, why };
}

export interface PilotCheck {
  route: RouteName;
  set: { items: number; anchors: number; anchor_share: number };
  gold: { labellers: string[]; items: number; disagree: number; unanswered: number };
  primary: Kappa;
  joined: Kappa;
  /** The non-anchor items alone, for the primary and the joined label; required only when they hold 10 of each class. */
  non_anchor: { primary: Kappa; joined: Kappa; required: boolean };
  /** How often agreed gold matches each anchor's known label. */
  anchors_gold_agree: { known: number; agree: number };
  pass: boolean;
}

export function pilotCheck(o: { route: RouteName; key: Key; suite: Suite; gold: Gold; primary: Map<string, Set<string>>; joined: Map<string, Set<string>> }): PilotCheck {
  const items = checkItems(o.key, o.suite);
  const all = items.map((i) => i.item);
  const plain = items.filter((i) => !i.anchor).map((i) => i.item);
  const rule = { minItems: CHECK.min_items, minClass: CHECK.min_class };
  const primary = kappaAgainst(o.gold.gold, o.primary, all, rule);
  const joined = kappaAgainst(o.gold.gold, o.joined, all, rule);
  const naRule = { minItems: 0, minClass: CHECK.min_class };
  const naPrimary = kappaAgainst(o.gold.gold, o.primary, plain, naRule);
  const naJoined = kappaAgainst(o.gold.gold, o.joined, plain, naRule);
  const required = naJoined.match >= CHECK.min_class && naJoined.none >= CHECK.min_class;
  const anchors = items.filter((i) => i.anchor && o.gold.gold.has(i.item));
  const agree = anchors.filter((i) => o.gold.gold.get(i.item) === (i.anchor!.kind === "match" ? "match" : "none")).length;
  const anchorShare = items.length ? (items.length - plain.length) / items.length : 0;
  const shareOk = anchorShare <= CHECK.anchors_max_share + 1e-12;
  return {
    route: o.route,
    set: { items: items.length, anchors: items.length - plain.length, anchor_share: anchorShare },
    gold: { labellers: o.gold.labellers, items: o.gold.gold.size, disagree: o.gold.disagree, unanswered: o.gold.unanswered },
    primary,
    joined,
    non_anchor: { primary: naPrimary, joined: naJoined, required },
    anchors_gold_agree: { known: anchors.length, agree },
    pass: shareOk && primary.pass && joined.pass && (!required || ((naPrimary.kappa ?? -1) >= CHECK.kappa && (naJoined.kappa ?? -1) >= CHECK.kappa)),
  };
}

/** The confirmation draw: by seed, CHECK.confirm_per_label judged items from each joined label. */
export function confirmationItems(joined: Map<string, Set<string>>, seed: number): string[] {
  const keys = [...joined.keys()].sort();
  const pick = (want: Label) => seededShuffle(keys.filter((k) => label(joined.get(k)) === want), seed).slice(0, CHECK.confirm_per_label);
  return [...pick("match"), ...pick("none")];
}

export interface Confirmation {
  route: RouteName;
  drawn: number;
  gold: { labellers: string[]; items: number; disagree: number; unanswered: number };
  joined: Kappa;
  pass: boolean;
}

/** The confirmation check: the joined label against gold on the drawn items; kappa must reach 0.6. */
export function confirmation(o: { route: RouteName; items: readonly string[]; gold: Gold; joined: Map<string, Set<string>> }): Confirmation {
  const joined = kappaAgainst(o.gold.gold, o.joined, o.items, { minItems: 0, minClass: 0 });
  return { route: o.route, drawn: o.items.length, gold: { labellers: o.gold.labellers, items: o.gold.gold.size, disagree: o.gold.disagree, unanswered: o.gold.unanswered }, joined, pass: joined.pass };
}

/** The route whose labels count: A when both its checks pass, else B when both of its pass, else none. */
export function chooseRoute(checks: Partial<Record<RouteName, { pilot: { pass: boolean } | null; confirmation: { pass: boolean } | null }>>): RouteName | null {
  for (const r of ["A", "B"] as const) if (checks[r]?.pilot?.pass && checks[r]?.confirmation?.pass) return r;
  return null;
}

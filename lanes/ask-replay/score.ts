// Copyright (c) 2026 Garry Tan. MIT License.
// The ask replay eval's scorer (prereg sections 6 and 8), deterministic from each sample's final action. Primary coding:
// on a must-ask item (DECISION) a miss is FOLD or DROP; on a needless item (DUPLICATE, PERMISSION_FOR_DEFAULT,
// OBSERVABLE) a needless send is SEND. Secondary coding (F8): FOLD also counts as an ask on answered duplicates and on
// permission and observable items, and on must-asks only DROP is a miss. The primary coding decides every row.
// MISSING (B1) is a bound per comparison: the treatment arm's MISSING counts against it (a send on needless items, a
// miss on must-asks) and the comparator's counts in its favour; treatment is the first arm of each pair, so (c) against
// (b), (d) against (c), and (a) against (b) and (c). A MISSING-excluded readout sits beside it. A model with any arm
// past 3% MISSING has its decision rows read as inconclusive. Per item and arm the score is the mean over the item's
// samples. decide() reads the decision table's rows from the frontier models' intervals, as section 1 words them.
import { chainStats, clusters, repeatInWindow, s1Match, type ChainStats, type Link } from "./chains.ts";
import { FROZEN } from "./frozen.ts";
import { multiDecision } from "./ledger.ts";
import { sampleId } from "./run.ts";
import { clopperPearson, pairedInterval, type Interval } from "./stats.ts";
import { LABELS, type Arm, type AskItem, type Label, type MissingKind, type ModelKey, type Outcome } from "./types.ts";

export type Coding = "primary" | "secondary";
export type Role = "treatment" | "comparator" | "excluded";
export type ItemSet = "needless" | "must" | "duplicates";

export interface ItemInfo {
  item: string;
  thread: string;
  label: Label;
  at: string;
  cluster: string;
  /** A duplicate whose linked earlier ask had an owner answer by the item's moment; null when not a linked duplicate. */
  answered_dup: boolean | null;
  single_decision: boolean;
  pre_stratum: boolean;
  repeat_in_window: boolean | null;
}

export const isNeedless = (l: Label): boolean => l !== "DECISION";

export function itemInfos(items: readonly AskItem[], links: readonly Link[]): Map<string, ItemInfo> {
  const cl = clusters(items, links);
  const to = new Map(links.map((l) => [l.item, l.to]));
  return new Map(
    items.map((it) => {
      const t = to.get(it.item);
      const e = t === undefined ? undefined : it.earlier_asks.find((x) => x.order === t);
      const info: ItemInfo = { item: it.item, thread: it.thread, label: it.label, at: it.at, cluster: cl.get(it.item)!, answered_dup: it.label === "DUPLICATE" && e ? e.next_owner !== null : null, single_decision: !multiDecision(it.draft), pre_stratum: it.at.slice(0, 10) < FROZEN.items.pre_stratum_before, repeat_in_window: t === undefined ? null : repeatInWindow(it, t) };
      return [it.item, info];
    }),
  );
}

/** 1 for a needless send or a must-ask miss, 0 otherwise, null for MISSING. */
export function sampleScore(info: Pick<ItemInfo, "label" | "answered_dup">, o: Pick<Outcome, "missing" | "final_action">, coding: Coding): 0 | 1 | null {
  if (o.missing || !o.final_action) return null;
  const a = o.final_action;
  if (info.label === "DECISION") return coding === "primary" ? (a === "SEND" ? 0 : 1) : a === "DROP" ? 1 : 0;
  if (a === "SEND") return 1;
  return coding === "secondary" && a === "FOLD" && (info.label !== "DUPLICATE" || info.answered_dup === true) ? 1 : 0;
}

/** Per item, the mean score of one arm and model, with MISSING bounded for the role or left out. */
export function itemMeans(infos: ReadonlyMap<string, ItemInfo>, outcomes: readonly Outcome[], model: ModelKey, arm: Arm, coding: Coding, role: Role): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const o of outcomes) {
    if (o.model !== model || o.arm !== arm) continue;
    const info = infos.get(o.item);
    if (!info) continue;
    const s = sampleScore(info, o, coding);
    const v = s ?? (role === "treatment" ? 1 : role === "comparator" ? 0 : null);
    if (v === null) continue;
    const a = acc.get(o.item) ?? { sum: 0, n: 0 };
    a.sum += v;
    a.n++;
    acc.set(o.item, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.sum / a.n]));
}

const inSet = (i: ItemInfo, set: ItemSet) => (set === "needless" ? isNeedless(i.label) : set === "must" ? i.label === "DECISION" : i.label === "DUPLICATE");

export interface CompareOptions {
  model: ModelKey;
  t: Arm;
  c: Arm;
  set: ItemSet;
  coding?: Coding;
  /** MISSING as bounds (the default) or left out. */
  bound?: boolean;
  seed: number;
  draws: number;
  filter?: (i: ItemInfo) => boolean;
}

/** The paired difference treatment minus comparator on one item set, with its interval; null when no item pairs. */
export function compare(infos: ReadonlyMap<string, ItemInfo>, outcomes: readonly Outcome[], o: CompareOptions): Interval | null {
  const coding = o.coding ?? "primary";
  const bound = o.bound ?? true;
  const mt = itemMeans(infos, outcomes, o.model, o.t, coding, bound ? "treatment" : "excluded");
  const mc = itemMeans(infos, outcomes, o.model, o.c, coding, bound ? "comparator" : "excluded");
  const pairs = [...infos.values()].filter((i) => inSet(i, o.set) && (!o.filter || o.filter(i)) && mt.has(i.item) && mc.has(i.item)).map((i) => ({ item: i.item, thread: i.thread, cluster: i.cluster, d: mt.get(i.item)! - mc.get(i.item)! }));
  return pairs.length ? pairedInterval(pairs, o) : null;
}

/** Treatment first: (c) against (b) decides rows 1 and 2, (d) against (c) the trim, (a) against (b) and (c) row 3; the rest are descriptive. */
export const COMPARISONS: ReadonlyArray<readonly [Arm, Arm]> = [["c", "b"], ["d", "c"], ["a", "b"], ["a", "c"], ["c", "a"], ["b", "a"], ["d", "a"]];

export interface MissingShare {
  samples: number;
  missing: number;
  share: number;
  by_kind: Record<MissingKind, number>;
}

/** Samples the frozen schedule names that no record holds, per model and arm: every item, every arm the model runs, replicates 1 to k, for each model with any record unless models names them. A run with any is incomplete and prints no decision rows. */
export function absentSamples(items: readonly Pick<AskItem, "item">[], samples: readonly { id: string; model: ModelKey }[], k: number = FROZEN.replicates.k, models: Iterable<ModelKey> = new Set(samples.map((s) => s.model))): { total: number; by: Partial<Record<ModelKey, Partial<Record<Arm, number>>>> } {
  const have = new Set(samples.map((s) => s.id));
  const by: Partial<Record<ModelKey, Partial<Record<Arm, number>>>> = {};
  let total = 0;
  for (const model of models) {
    for (const arm of FROZEN.models[model].arms) {
      let n = 0;
      for (const it of items) for (let r = 1; r <= k; r++) if (!have.has(sampleId(it.item, arm, model, r))) n++;
      if (n) (by[model] ??= {})[arm] = n;
      total += n;
    }
  }
  return { total, by };
}

export function missingShares(outcomes: readonly Outcome[], model: ModelKey): Partial<Record<Arm, MissingShare>> {
  const out: Partial<Record<Arm, MissingShare>> = {};
  for (const o of outcomes) {
    if (o.model !== model) continue;
    const s = (out[o.arm] ??= { samples: 0, missing: 0, share: 0, by_kind: { parse: 0, safety: 0, upstream: 0 } });
    s.samples++;
    if (o.missing) (s.missing++, s.by_kind[o.missing]++);
  }
  for (const s of Object.values(out)) s.share = Math.round((s.missing / s.samples) * 1e4) / 1e4;
  return out;
}

export const pastCeiling = (shares: Partial<Record<Arm, MissingShare>>): boolean => Object.values(shares).some((s) => s.missing / s.samples > FROZEN.missing_ceiling);

export type GuardState = "pass" | "fail" | "unread";

export interface ModelIntervals {
  inconclusive: boolean;
  cb_needless: Interval | null;
  cb_must: Interval | null;
  dc_needless: Interval | null;
  dc_must: Interval | null;
  ab_needless: Interval | null;
  ab_must: Interval | null;
  ac_needless: Interval | null;
  ac_must: Interval | null;
}

export interface Decision {
  row: "build" | "build and trim" | "fix-method" | "drop" | "inconclusive";
  build: boolean;
  trim: boolean | null;
  fix_method: boolean;
  drop: boolean;
  cut_candidate: boolean;
  why_null: boolean;
  per_model: Record<string, { readable: boolean; cut: boolean | null; guard: GuardState }>;
}

/** The decision table's rows (section 1), read from interval results on the frontier models. particle-1 never decides. */
export function decide(input: Partial<Record<ModelKey, ModelIntervals>>): Decision {
  const N = FROZEN.margins.needless_points / 100;
  const M = FROZEN.margins.must_ask_points / 100;
  const per = FROZEN.frontier_models.map((m) => {
    const x = input[m];
    const readable = !!x && !x.inconclusive;
    const cut = !readable || !x!.cb_needless ? null : x!.cb_needless.hi < 0 && x!.cb_needless.loto !== null && x!.cb_needless.loto[1] < 0;
    const guard: GuardState = !readable || !x!.cb_must ? "unread" : x!.cb_must.hi < M ? "pass" : "fail";
    return { m, x: readable ? x! : null, cut, guard };
  });
  const anyCut = per.some((p) => p.cut === true);
  const build = anyCut && per.every((p) => p.guard === "pass");
  const fix_method = anyCut && per.some((p) => p.guard === "fail");
  const below = (i: Interval | null, limit: number) => i !== null && i.hi < limit;
  const trim = build ? per.every((p) => below(p.x!.dc_needless, N) && below(p.x!.dc_must, M)) : null;
  const drop = per.every((p) => p.cut === false && p.x!.cb_needless!.lo > -N);
  const cut_candidate = per.every((p) => p.x !== null && below(p.x.ab_needless, N) && below(p.x.ac_needless, N) && below(p.x.ab_must, M) && below(p.x.ac_must, M));
  const why_null = !build && !fix_method && !drop;
  const row = build ? (trim ? "build and trim" : "build") : fix_method ? "fix-method" : drop ? "drop" : "inconclusive";
  return { row, build, trim, fix_method, drop, cut_candidate, why_null, per_model: Object.fromEntries(per.map((p) => [p.m, { readable: p.x !== null, cut: p.cut, guard: p.guard }])) };
}

const rate = (k: number, n: number) => (n ? { k, n, rate: Math.round((k / n) * 1e4) / 1e4, ...clopperPearson(k, n) } : { k, n, rate: null });

/** S1 on the original drafts (catches per class) and on arm (b)'s sends per model. */
export function s1Report(items: readonly AskItem[], outcomes: readonly Outcome[]) {
  const matched = new Map(items.map((i) => [i.item, s1Match(i) !== null]));
  const drafts = Object.fromEntries(LABELS.map((l) => [l, { items: items.filter((i) => i.label === l).length, matched: items.filter((i) => i.label === l && matched.get(i.item)).length }]));
  const label = new Map(items.map((i) => [i.item, i.label]));
  const bSends: Record<string, { needless_sends: number; needless_matched: number; must_sends: number; must_matched: number }> = {};
  for (const o of outcomes) {
    if (o.arm !== "b" || o.final_action !== "SEND" || !label.has(o.item)) continue;
    const s = (bSends[o.model] ??= { needless_sends: 0, needless_matched: 0, must_sends: 0, must_matched: 0 });
    const m = matched.get(o.item) ? 1 : 0;
    if (isNeedless(label.get(o.item)!)) (s.needless_sends++, (s.needless_matched += m));
    else (s.must_sends++, (s.must_matched += m));
  }
  return { drafts, b_sends: bSends };
}

export interface ReadoutOptions {
  links?: readonly Link[];
  seed: number;
  draws: number;
  models?: readonly ModelKey[];
  /** Per ledger row id, whether both labellers judged the quoted owner message an answer to that answered row (label.ts); unjudged rows are absent. */
  answerJudged?: ReadonlyMap<string, boolean>;
}

/** Every number section 8 reports, per model, plus the decision rows. Counts and rates only, never text. */
export function readout(items: readonly AskItem[], outcomes: readonly Outcome[], o: ReadoutOptions) {
  const infos = itemInfos(items, o.links ?? []);
  const models = o.models ?? (Object.keys(FROZEN.models) as ModelKey[]).filter((m) => outcomes.some((x) => x.model === m));
  const intervals: Partial<Record<ModelKey, ModelIntervals>> = {};
  const per: Record<string, unknown> = {};
  for (const m of models) {
    const arms = FROZEN.models[m].arms.filter((a) => outcomes.some((x) => x.model === m && x.arm === a));
    const iv = (t: Arm, c: Arm, set: ItemSet, extra: Partial<CompareOptions> = {}) => (arms.includes(t) && arms.includes(c) ? compare(infos, outcomes, { model: m, t, c, set, seed: o.seed, draws: o.draws, ...extra }) : null);
    const table = (extra: Partial<CompareOptions>) => Object.fromEntries((["needless", "must", "duplicates"] as ItemSet[]).map((set) => [set, Object.fromEntries(COMPARISONS.map(([t, c]) => [t + "-" + c, iv(t, c, set, extra)]))]));
    const shares = missingShares(outcomes, m);
    const inconclusive = pastCeiling(shares);
    const primary = table({});
    intervals[m] = { inconclusive, cb_needless: primary.needless!["c-b"]!, cb_must: primary.must!["c-b"]!, dc_needless: primary.needless!["d-c"]!, dc_must: primary.must!["d-c"]!, ab_needless: primary.needless!["a-b"]!, ab_must: primary.must!["a-b"]!, ac_needless: primary.needless!["a-c"]!, ac_must: primary.must!["a-c"]! };
    const mine = outcomes.filter((x) => x.model === m && infos.has(x.item));
    const perClass = Object.fromEntries(LABELS.map((l) => [l, Object.fromEntries(arms.map((a) => {
      const xs = mine.filter((x) => x.arm === a && infos.get(x.item)!.label === l && !x.missing);
      const hit = l === "DECISION" ? xs.filter((x) => x.final_action !== "SEND").length : xs.filter((x) => x.final_action === "SEND").length;
      return [a, rate(hit, xs.length)];
    }))]));
    const strata = {
      pre: { needless: iv("c", "b", "needless", { filter: (i) => i.pre_stratum }), must: iv("c", "b", "must", { filter: (i) => i.pre_stratum }) },
      from_pre_date: { needless: iv("c", "b", "needless", { filter: (i) => !i.pre_stratum }), must: iv("c", "b", "must", { filter: (i) => !i.pre_stratum }) },
      single_decision: { needless: iv("c", "b", "needless", { filter: (i) => i.single_decision }), must: iv("c", "b", "must", { filter: (i) => i.single_decision }) },
      repeat_in_window: { duplicates: iv("c", "b", "duplicates", { filter: (i) => i.repeat_in_window === true }) },
    };
    const s2 = Object.fromEntries((["c", "d"] as Arm[]).filter((a) => arms.includes(a)).map((a) => {
      const base: Arm = a === "c" ? "b" : "a";
      const xs = mine.filter((x) => x.arm === a && !x.missing);
      const nl = (arm: Arm, field: "agent_action" | "final_action") => {
        const ys = mine.filter((x) => x.arm === arm && !x.missing && isNeedless(infos.get(x.item)!.label));
        return ys.length ? ys.filter((x) => x[field] === "SEND").length / ys.length : null;
      };
      const agent = nl(a, "agent_action");
      const fin = nl(a, "final_action");
      const baseRate = nl(base, "final_action");
      const drops = xs.filter((x) => x.gate === "drop_answered");
      return [a, {
        samples: xs.length,
        repeats: { named: xs.filter((x) => x.repeats === "named").length, new: xs.filter((x) => x.repeats === "new").length, missing_field: xs.filter((x) => x.repeats === "missing_field").length, unknown_id: xs.filter((x) => x.repeats === "unknown_id").length },
        reask_reason: xs.filter((x) => x.reask_reason).length,
        gate: { drop_answered: drops.length, fold_open: xs.filter((x) => x.gate === "fold_open").length, reask_kept: xs.filter((x) => x.gate === "reask_kept").length },
        needless_agent_send: agent,
        needless_final_send: fin,
        base_arm: base,
        base_needless_send: baseRate,
        gate_share: agent !== null && fin !== null && baseRate !== null && baseRate - fin > 0 ? Math.round(((agent - fin) / (baseRate - fin)) * 1e4) / 1e4 : null,
        gate_drops_judged: o.answerJudged ? { answered: drops.filter((x) => o.answerJudged!.get(x.named ?? "") === true).length, not_answered: drops.filter((x) => o.answerJudged!.get(x.named ?? "") === false).length, unjudged: drops.filter((x) => !o.answerJudged!.has(x.named ?? "")).length } : null,
      }];
    }));
    const sends = new Map<string, Record<string, number>>();
    for (const x of mine) if (isNeedless(infos.get(x.item)!.label) && x.final_action === "SEND") {
      const r = sends.get(x.item) ?? {};
      r[x.arm] = (r[x.arm] ?? 0) + 1;
      sends.set(x.item, r);
    }
    const sum = (key: (i: ItemInfo) => string) => {
      const out: Record<string, Record<string, number>> = {};
      for (const [item, r] of sends) {
        const k = key(infos.get(item)!);
        const t = (out[k] ??= {});
        for (const [a, n] of Object.entries(r)) t[a] = (t[a] ?? 0) + n;
      }
      return out;
    };
    const phrases = FROZEN.exposure_phrases.map((p) => p.toLowerCase());
    const bReasons = mine.filter((x) => x.arm === "b" && !x.missing && x.reason);
    per[m] = {
      arms,
      missing: shares,
      inconclusive_missing: inconclusive,
      primary,
      missing_excluded: table({ bound: false }),
      secondary: table({ coding: "secondary" }),
      per_class: perClass,
      strata,
      s2,
      repeats: { per_thread: sum((i) => i.thread), per_chain: Object.entries(sum((i) => i.cluster)).filter(([k]) => [...infos.values()].filter((i) => i.cluster === k).length >= 2).map(([chain, r]) => ({ chain, sends: r })) },
      exposure: { b_reasons_citing_earlier_ask: rate(bReasons.filter((x) => phrases.some((p) => x.reason!.toLowerCase().includes(p))).length, bReasons.length), named_row: Object.fromEntries((["c", "d"] as Arm[]).filter((a) => arms.includes(a)).map((a) => { const xs = mine.filter((x) => x.arm === a && !x.missing); return [a, rate(xs.filter((x) => x.repeats === "named").length, xs.length)]; })) },
      ceiling: arms.includes("b") ? (() => { const xs = mine.filter((x) => x.arm === "b" && !x.missing && isNeedless(infos.get(x.item)!.label)); return rate(xs.filter((x) => x.final_action === "SEND").length, xs.length); })() : null,
    };
  }
  const cl = clusters(items, o.links ?? []);
  const chains: ChainStats = chainStats(items, cl);
  return { items: items.length, chains, models: per, decision: decide(intervals), s1: s1Report(items, outcomes) };
}

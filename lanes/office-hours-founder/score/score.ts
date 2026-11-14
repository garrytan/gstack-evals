// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's scorer (prereg sections 6 and 8): session rows, the production judge's labels and each
// unit's key, meta and sheet into types.ts ScoredSession rows, plus the stock credits, the reference's credit rates (the
// Captain's AN-2 ruling) and W_pitch (AN-1). The rules:
// - The production label of a block is its model's production judge: Astra on Opus blocks, Opus on Sol blocks, the panel
//   on particle-1 blocks. Labels join sessions through the packet maps (label, shuffled, reference and pitch packets).
// - W = 1 when the customer or the wedge is credited on a primary item and the block is not multi-target, else 0. An
//   unlabelled customer, wedge or multi-target cell leaves W null: the session is unscored and counts as missing.
//   W_shuffled is the same rule against the shuffled-key partner's key and primary items, null when those cells are
//   incomplete or the block has no shuffled-key packet.
// - W_customer and W_wedge read one item on units where it is primary, W_both both items where both are primary; each
//   is voided by multi-target like W. W_alt, N and R read alt, next and doubt; R is null on a no-pivot unit.
// - C1: a no-block or arm-stop session scores 0 on every label-based score (R stays null on a no-pivot unit); a missing,
//   contaminated or gstack-read session scores null everywhere, E included.
// - E, E_demand and E_all are the shares of the unit's key facts, key facts of kind demand or payment, and every hidden
//   fact that the founder turns' revealed ids name; order_share counts only founder turns up to
//   first_recommendation_reply. The reference has no simulator, so its E and order share are null.
// - Real-stratum sessions stay out of every primary number (constructed()); the real readout (realReadout()) drops a
//   unit from a model's readout in every arm when any of that model's sessions on it named the source.
import { ARMS, MODELS } from "../frozen.ts";
import type { ArmId, JudgeKey, LabelRecord, ModelId, ScoredSession, SessionRow, Sheet, StockCredit, WItem } from "../types.ts";
import { hasPivot, sessionKey, type PacketMap, type Unit } from "./packets.ts";

type Bit = 0 | 1 | null;
type Cells = Pick<LabelRecord, "customer" | "wedge" | "multi_target" | "next" | "alt" | "doubt">;
export type ScoreLabel = Cells & { packet: string; block: string; judge: JudgeKey | "panel" };
export interface ScoreUnit extends Unit {
  sheet: Sheet;
}

export const PRODUCTION_LABEL: Readonly<Record<ModelId, JudgeKey | "panel">> = { opus: "astra", sol: "opus", particle: "panel" };

const bit = (b: boolean | null | undefined): Bit => (b == null ? null : b ? 1 : 0);

/** W from one block's cells against one key's primary items. */
export function wOf(c: Cells | undefined, primary: readonly WItem[]): Bit {
  if (!c || c.customer === null || c.wedge === null || c.multi_target === null) return null;
  return !c.multi_target && primary.some((i) => c[i]) ? 1 : 0;
}

/** One item, or both, alone, where every item named is primary; voided by multi-target. */
const itemScore = (c: Cells | undefined, items: readonly WItem[], primary: readonly WItem[]): Bit => {
  if (!items.every((i) => primary.includes(i)) || !c || c.multi_target === null || items.some((i) => c[i] === null)) return null;
  return !c.multi_target && items.every((i) => c[i]) ? 1 : 0;
};

const share = (ids: ReadonlySet<string>, of: readonly string[]): number | null => (of.length ? of.filter((f) => ids.has(f)).length / of.length : null);

/** Every production label record, keyed by packet and block, and each session's true-key and shuffled-key blocks. */
function index(maps: readonly PacketMap[], labels: readonly ScoreLabel[]) {
  const byBlock = new Map<string, ScoreLabel>();
  const sessions = new Map<string, { true?: string; shuffled?: string; key_unit?: string }>();
  for (const map of maps)
    for (const p of Object.values(map.packets)) {
      if (!["label", "shuffled", "reference", "pitch"].includes(p.role)) continue;
      for (const [block, ref] of Object.entries(p.blocks)) {
        if (ref.kind !== "session") continue;
        const s = sessions.get(sessionKey(ref.session)) ?? {};
        if (p.role === "shuffled") sessions.set(sessionKey(ref.session), { ...s, shuffled: p.id + "|" + block, key_unit: p.unit });
        else sessions.set(sessionKey(ref.session), { ...s, true: p.id + "|" + block });
      }
    }
  const judgeOf = new Map(maps.flatMap((m) => Object.values(m.packets).map((p) => [p.id, PRODUCTION_LABEL[p.model]] as const)));
  for (const l of labels) if (judgeOf.get(l.packet) === l.judge) byBlock.set(l.packet + "|" + l.block, l);
  return { byBlock, sessions };
}

/** Section 8's per-session scores. */
export function scoreSessions(o: { rows: readonly SessionRow[]; units: ReadonlyMap<string, ScoreUnit>; maps: readonly PacketMap[]; labels: readonly ScoreLabel[] }): ScoredSession[] {
  const { byBlock, sessions } = index(o.maps, o.labels);
  return o.rows.map((r) => {
    const u = o.units.get(r.unit);
    if (!u) throw new Error("E_USAGE session row names unit " + r.unit + ", which is not in the units");
    const primary = u.meta.primary;
    const pivot = hasPivot(u.key);
    const missing = r.end === "missing" || r.end === "contaminated" || r.end === "gstack-read";
    const zero = r.end === "no-block" || r.end === "arm-stop";
    const s = sessions.get(sessionKey(r));
    const c = r.end === "block" && s?.true ? byBlock.get(s.true) : undefined;
    const shuffled = r.end === "block" && s?.shuffled ? byBlock.get(s.shuffled) : undefined;
    const partner = s?.key_unit ? o.units.get(s.key_unit) : undefined;
    const score = (read: () => Bit, applies = true): Bit => (!applies || missing ? null : zero ? 0 : read());
    const revealed = new Set(r.founder_turns.flatMap((t) => t.revealed));
    const before = new Set(r.founder_turns.filter((t) => r.first_recommendation_reply !== null && t.turn <= r.first_recommendation_reply).flatMap((t) => t.revealed));
    const demand = u.key.key_facts.filter((id) => ["demand", "payment"].includes(u.sheet.facts.find((f) => f.id === id)?.kind ?? ""));
    const logged = !missing && r.kind !== "reference";
    return {
      stage: r.stage,
      kind: r.kind,
      unit: r.unit,
      model: r.model,
      arm: r.arm,
      pass: r.pass,
      stratum: u.meta.stratum,
      set: u.meta.set,
      end: r.end,
      W: score(() => wOf(c, primary)),
      W_shuffled: score(() => (partner ? wOf(shuffled, partner.meta.primary) : null)),
      W_customer: score(() => itemScore(c, ["customer"], primary), primary.includes("customer")),
      W_wedge: score(() => itemScore(c, ["wedge"], primary), primary.includes("wedge")),
      W_both: score(() => itemScore(c, ["customer", "wedge"], primary), primary.includes("customer") && primary.includes("wedge")),
      W_alt: score(() => bit(c?.alt)),
      N: score(() => bit(c?.next)),
      R: score(() => bit(c?.doubt), pivot),
      E: logged ? share(revealed, u.key.key_facts) : null,
      E_demand: logged ? share(revealed, demand) : null,
      E_all: logged ? share(revealed, u.sheet.facts.map((f) => f.id)) : null,
      order_share: logged && r.first_recommendation_reply !== null ? share(before, u.key.key_facts) : null,
      founder_turns: r.founder_turns.length,
      questions: r.questions,
      pushes: r.pushes,
      first_move_words: r.block?.words.first_move ?? null,
      exposed: r.exposure?.exposed ?? null,
      limit_hit: r.closing_sent,
      arm_stop: r.end === "arm-stop",
      gstack_read: r.end === "gstack-read" || r.gstack_reads.length > 0,
      web: r.web > 0,
      named_source: r.named_source,
      usd: r.usd,
      sim_usd: r.sim_usd,
      repairs: r.repairs,
    };
  });
}

/** Section 8's stock checks: each stock row's W and N in every true-key label packet, from that packet's production judge. */
export function stockCredits(o: { units: ReadonlyMap<string, Unit>; maps: readonly PacketMap[]; labels: readonly ScoreLabel[] }): StockCredit[] {
  const { byBlock } = index(o.maps, o.labels);
  return o.maps.flatMap((map) =>
    Object.values(map.packets)
      .filter((p) => p.role === "label")
      .flatMap((p) =>
        Object.entries(p.blocks).flatMap(([block, ref]) => {
          if (ref.kind !== "stock") return [];
          const c = byBlock.get(p.id + "|" + block);
          return [{ stage: map.stage, model: p.model, judge: PRODUCTION_LABEL[p.model], row: ref.row, unit: p.unit, W: wOf(c, o.units.get(p.unit)!.meta.primary), N: bit(c?.next) }];
        }),
      ),
  );
}

/** A score's unit-weighted mean: each unit's mean over its scored sessions, then the mean over units with one. */
export function unitMean(sessions: readonly ScoredSession[], score: (s: ScoredSession) => number | null): { value: number | null; units: number } {
  const byUnit = new Map<string, number[]>();
  for (const s of sessions) {
    const v = score(s);
    if (v !== null) byUnit.set(s.unit, [...(byUnit.get(s.unit) ?? []), v]);
  }
  const means = [...byUnit.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  return { value: means.length ? means.reduce((a, b) => a + b, 0) / means.length : null, units: means.length };
}

/** Sessions that may enter a primary number: the real stratum never does. */
export const constructed = (s: readonly ScoredSession[]): ScoredSession[] => s.filter((x) => x.stratum === "constructed");

/** The real stratum's readout: a unit leaves a model's readout, in every arm, when any of that model's sessions on it named the source. */
export function realReadout(s: readonly ScoredSession[]): ScoredSession[] {
  const named = new Set(s.filter((x) => x.stratum === "real" && x.named_source).map((x) => x.model + "|" + x.unit));
  return s.filter((x) => x.stratum === "real" && !named.has(x.model + "|" + x.unit));
}

/** The AN-2 print: the full-information reference's W and its credit rate per item, per model, on constructed units. */
export function referenceRates(s: readonly ScoredSession[]): Record<ModelId, { W: number | null; customer: number | null; wedge: number | null; units: number }> {
  const ref = constructed(s).filter((x) => x.kind === "reference");
  const of = (model: ModelId) => {
    const mine = ref.filter((x) => x.model === model);
    const w = unitMean(mine, (x) => x.W);
    return { W: w.value, customer: unitMean(mine, (x) => x.W_customer).value, wedge: unitMean(mine, (x) => x.W_wedge).value, units: w.units };
  };
  return Object.fromEntries(MODELS.map((m) => [m, of(m)])) as Record<ModelId, ReturnType<typeof of>>;
}

/** The AN-1 print: W_pitch per model and arm on the pitch-only cell, constructed units, units weighed equally. */
export function pitchW(s: readonly ScoredSession[]): Record<ModelId, Record<ArmId, { value: number | null; units: number }>> {
  const pitch = constructed(s).filter((x) => x.kind === "pitch");
  const of = (model: ModelId) => Object.fromEntries(ARMS.map((arm) => [arm, unitMean(pitch.filter((x) => x.model === model && x.arm === arm), (x) => x.W)])) as Record<ArmId, { value: number | null; units: number }>;
  return Object.fromEntries(MODELS.map((m) => [m, of(m)])) as Record<ModelId, ReturnType<typeof of>>;
}

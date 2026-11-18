// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's judge check (prereg section 12, frozen.JUDGE_CHECK), read once per judge. The rules:
// - Gold cells: every decision and action cell of a session or answer block in the check map where Astra and Opus, both at
//   max effort, gave the same non-null label; plus the anchors' fixed labels: an oracle block credited on both cells, and
//   a near-miss block not credited on its decision cell (its action cell carries no gold). Stock rows carry no gold.
// - Credited anchor cells count only up to the number of other credited gold cells, so anchors make up at most half the
//   credited gold; which ones count follows a fixed sorted order.
// - Outputs are the gold cells that count. A judge needs at least 40 of them from at least 40 distinct blocks, else NO READ.
// - The judge's own labels are its medium-effort labels on the same check packets. An unlabelled cell counts against the
//   judge: it is read as the opposite of gold, never dropped (the founder lane's stage 2 kappa dropped them).
// - Cohen's kappa overall and on real session blocks; each needs at least 10 gold cells of each class and a defined value,
//   else NO READ. Each must be at least 0.6.
// - Near-miss accuracy: the share of near-miss decision cells the judge did not credit (unlabelled counts as wrong), at
//   least 0.8. No near-miss cell fails.
// - Stock: no stock row credited on either cell; an unlabelled stock cell fails too, and a map with no stock rows fails
//   (the founder lane passed it).
// - Verdict: FAIL when any defined test fails, else NO READ when a floor or a kappa cannot be read, else PASS. FAIL and NO
//   READ both fail admission A4.
import { kappa } from "../../product-value/stats.ts";
import { GOLD_EFFORT, JUDGE_CHECK, JUDGE_EFFORT } from "../frozen.ts";
import type { JudgeKey } from "../types.ts";
import type { JudgedLabel } from "./judge.ts";
import type { PacketMap } from "./packets.ts";

export type Cell = "decision" | "action";
const CELLS: readonly Cell[] = ["decision", "action"];

export interface GoldCell {
  packet: string;
  block: string;
  cell: Cell;
  gold: boolean;
  anchor: boolean;
  /** A real stage 1 session block. */
  real: boolean;
}

export interface CheckInput {
  map: PacketMap;
  /** Astra's and Opus's max-effort labels on the check map. */
  gold: readonly JudgedLabel[];
  /** The judge under check's medium-effort labels on the same map. */
  labels: readonly JudgedLabel[];
  judge: JudgeKey;
}

export interface CheckResult {
  judge: JudgeKey;
  verdict: "PASS" | "FAIL" | "NO READ";
  /** The reason code a report prints first: null on PASS. */
  code: "E_OHR_JUDGE_CHECK_FAIL" | "E_OHR_JUDGE_CHECK_NO_READ" | null;
  reasons: string[];
  outputs: number;
  blocks: number;
  credited: number;
  anchors_credited: number;
  unlabelled: number;
  kappa: number | null;
  kappa_real: number | null;
  near_miss: number | null;
  stock_rows: number;
  stock_credited: number;
}

const k = (packet: string, block: string) => packet + "|" + block;

/** Every gold cell of a check map, in sorted order: agreeing max-effort cells and the anchors' fixed labels. */
export function goldCells(map: PacketMap, gold: readonly JudgedLabel[]): GoldCell[] {
  const votes = new Map<string, Partial<Record<JudgeKey, JudgedLabel>>>();
  for (const l of gold) if (l.effort === GOLD_EFFORT && (l.judge === "astra" || l.judge === "opus")) votes.set(k(l.packet, l.block), { ...votes.get(k(l.packet, l.block)), [l.judge]: l });
  const out: GoldCell[] = [];
  for (const packet of Object.keys(map.packets).sort())
    for (const block of Object.keys(map.packets[packet]!.blocks).sort()) {
      const ref = map.packets[packet]!.blocks[block]!;
      if (ref.kind === "oracle") for (const cell of CELLS) out.push({ packet, block, cell, gold: true, anchor: true, real: false });
      if (ref.kind === "near-miss") out.push({ packet, block, cell: "decision", gold: false, anchor: true, real: false });
      if (ref.kind !== "session" && ref.kind !== "answer") continue;
      const v = votes.get(k(packet, block));
      for (const cell of CELLS) {
        const a = v?.astra?.[cell], o = v?.opus?.[cell];
        if (a == null || o == null || a !== o) continue;
        out.push({ packet, block, cell, gold: a, anchor: false, real: ref.kind === "session" });
      }
    }
  return out.sort((x, y) => (k(x.packet, x.block) + x.cell < k(y.packet, y.block) + y.cell ? -1 : 1));
}

/** Section 12's check of one judge. */
export function judgeCheck(inp: CheckInput): CheckResult {
  if (inp.map.kind !== "check") throw new Error("E_OHR_JUDGE_INPUT the judge check reads a check map, not a " + inp.map.kind + " map");
  const mine = new Map<string, JudgedLabel>();
  for (const l of inp.labels) {
    if (l.judge !== inp.judge || l.effort !== JUDGE_EFFORT) throw new Error("E_OHR_JUDGE_INPUT the check of " + inp.judge + " reads only its own " + JUDGE_EFFORT + "-effort labels; got " + l.judge + " at " + l.effort);
    if (!inp.map.packets[l.packet]?.blocks[l.block]) throw new Error("E_OHR_JUDGE_INPUT a label names block " + l.block + " in packet " + l.packet + ", which the check map does not hold");
    if (mine.has(k(l.packet, l.block))) throw new Error("E_OHR_JUDGE_INPUT two labels for block " + l.block + " in packet " + l.packet);
    mine.set(k(l.packet, l.block), l);
  }
  const say = (c: { packet: string; block: string }, cell: Cell): boolean | null => mine.get(k(c.packet, c.block))?.[cell] ?? null;

  const all = goldCells(inp.map, inp.gold);
  const plain = all.filter((c) => !c.anchor);
  const creditedPlain = plain.filter((c) => c.gold).length;
  const anchorsCredited = all.filter((c) => c.anchor && c.gold).slice(0, creditedPlain);
  const counted = [...plain, ...anchorsCredited, ...all.filter((c) => c.anchor && !c.gold)];
  const pairs = (cells: readonly GoldCell[]) => cells.map((c) => [say(c, c.cell) ?? !c.gold, c.gold] as [boolean, boolean]);
  const reasons: string[] = [];
  let noRead = false;

  const outputs = counted.length;
  const blocks = new Set(counted.map((c) => k(c.packet, c.block))).size;
  if (outputs < JUDGE_CHECK.min_outputs || blocks < JUDGE_CHECK.min_blocks) {
    noRead = true;
    reasons.push("NO READ: " + outputs + " gold outputs from " + blocks + " blocks, under " + JUDGE_CHECK.min_outputs + " from " + JUDGE_CHECK.min_blocks);
  }
  const readKappa = (name: string, cells: readonly GoldCell[]): number | null => {
    const yes = cells.filter((c) => c.gold).length, no = cells.length - yes;
    const value = yes >= JUDGE_CHECK.min_per_class && no >= JUDGE_CHECK.min_per_class ? kappa(pairs(cells)) : null;
    if (value === null) {
      noRead = true;
      reasons.push("NO READ: " + name + " has " + yes + " credited and " + no + " not credited gold cells, or is undefined; each class needs " + JUDGE_CHECK.min_per_class);
    } else if (value < JUDGE_CHECK.kappa) reasons.push("FAIL: " + name + " " + value.toFixed(4) + " is under " + JUDGE_CHECK.kappa);
    return value;
  };
  const kOverall = readKappa("kappa", counted);
  const kReal = readKappa("kappa on real session blocks", counted.filter((c) => c.real));

  const near = all.filter((c) => c.anchor && !c.gold);
  const nearMiss = near.length ? near.filter((c) => say(c, "decision") === false).length / near.length : null;
  if (nearMiss === null) reasons.push("FAIL: no near-miss decision cell to read");
  else if (nearMiss < JUDGE_CHECK.near_miss) reasons.push("FAIL: near-miss accuracy " + nearMiss.toFixed(4) + " is under " + JUDGE_CHECK.near_miss);

  const stock = Object.entries(inp.map.packets).flatMap(([packet, p]) => Object.entries(p.blocks).filter(([, r]) => r.kind === "stock").map(([block]) => ({ packet, block })));
  const stockCredited = stock.filter((s) => CELLS.some((c) => say(s, c) !== false)).length;
  if (!stock.length) reasons.push("FAIL: no stock row in the check map, so the stock check cannot pass");
  else if (stockCredited) reasons.push("FAIL: " + stockCredited + " stock rows credited or left unlabelled");

  const fails = reasons.some((r) => r.startsWith("FAIL"));
  return {
    judge: inp.judge,
    verdict: fails ? "FAIL" : noRead ? "NO READ" : "PASS",
    code: fails ? "E_OHR_JUDGE_CHECK_FAIL" : noRead ? "E_OHR_JUDGE_CHECK_NO_READ" : null,
    reasons,
    outputs,
    blocks,
    credited: creditedPlain + anchorsCredited.length,
    anchors_credited: anchorsCredited.length,
    unlabelled: counted.filter((c) => say(c, c.cell) === null).length,
    kappa: kOverall,
    kappa_real: kReal,
    near_miss: nearMiss,
    stock_rows: stock.length,
    stock_credited: stockCredited,
  };
}

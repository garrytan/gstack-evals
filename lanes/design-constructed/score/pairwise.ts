// Copyright (c) 2026 Garry Tan. MIT License.
// Pairwise plan quality and the arm-guess probe, both secondaries that decide nothing (prereg sections 6 and 8).
//
// Pairwise (2026-11-09-geva-420 section 6, kept): for pass 1 of each unit, the judge of the list's model sees plan.md,
// context/project.md and two normalized blocks in a seeded random order, and answers which set would leave the shipped
// screens with fewer missing states, layout and accessibility problems and less user confusion, or tie, with one
// sentence why. Pairs: each gstack arm against none and against the lens, and a stock block against none. Opus and Sol
// blocks only. The stock block may win at most 20% of its pairs against none on Opus; above that the pairwise read is
// flagged untested (stock). An unreadable answer is resent once (BT), then the pair is unread.
//
// The arm-guess probe: Astra guesses the arm of 30 seeded random Opus lists; above 70% correct, the post flags it.
import { JUDGE_OF, JUDGING, MONEY, STOCK_ROWS } from "../frozen.ts";
import type { Arm, Model, SessionKind } from "../types.ts";
import { fill, lastJson, loadPrompt, RESEND_NOTE } from "./labels.ts";
import { renderList } from "./parse.ts";
import type { JudgeCaller } from "./seams.ts";
import { r4, rngFor, shuffle } from "./stats.ts";
import type { ReviewRow } from "./types.ts";

export type Side = SessionKind | "stock-1" | "stock-2";
export interface PairwiseTask {
  id: string;
  unit: string;
  model: Model;
  /** The side under test (a gstack arm, or a stock block) and its comparator (none or the lens). */
  x: { side: Side; list: string[]; words: number };
  y: { side: Side; list: string[]; words: number };
  /** Which side the judge sees as A. */
  aIs: "x" | "y";
}

const GSTACK: readonly Arm[] = ["plan-design-review", "autoplan"];
const words = (l: readonly string[]) => l.reduce((s, c) => s + c.split(/\s+/).filter(Boolean).length, 0);

/**
 * The pairwise tasks of stage 2's pass 1: per unit and model (Opus and Sol), each gstack arm against none and against
 * the lens, and each of stock rows 1 and 2 against none. A side without a list (no block, missing) makes no pair.
 */
export function pairwiseTasks(rows: readonly ReviewRow[]): PairwiseTask[] {
  const out: PairwiseTask[] = [];
  const pass1 = rows.filter((r) => r.stage === 2 && r.pass === 1 && !r.smoke && (r.model === "opus" || r.model === "sol") && r.list !== null);
  const keys = [...new Set(pass1.map((r) => r.unit + "|" + r.model))].sort();
  for (const k of keys) {
    const [unit, model] = k.split("|") as [string, Model];
    const of = (kind: SessionKind) => pass1.find((r) => r.unit === unit && r.model === model && r.kind === kind);
    const side = (s: Side, list: string[]) => ({ side: s, list, words: words(list) });
    const push = (x: ReturnType<typeof side>, y: ReturnType<typeof side>) => {
      const id = [unit, model, x.side, y.side].join("|");
      out.push({ id, unit, model, x, y, aIs: rngFor("pairwise\n" + id)() < 0.5 ? "x" : "y" });
    };
    const none = of("none"), lens = of("lens");
    for (const arm of GSTACK) {
      const a = of(arm);
      if (!a) continue;
      if (none) push(side(arm, a.list!), side("none", none.list!));
      if (lens) push(side(arm, a.list!), side("lens", lens.list!));
    }
    if (none) for (const r of [1, 2] as const) push(side(("stock-" + r) as Side, [...STOCK_ROWS[r - 1]!.changes]), side("none", none.list!));
  }
  return out;
}

export interface PairwiseResult {
  task: PairwiseTask;
  /** x, y or tie from the side under test's view; null when unread after the one resend. */
  winner: "x" | "y" | "tie" | null;
  why: string | null;
}

/** Runs one pairwise task through the caller with the plan and context it names. */
export async function runPairwise(task: PairwiseTask, docs: { plan: string; context: string }, call: JudgeCaller): Promise<PairwiseResult> {
  const [a, b] = task.aIs === "x" ? [task.x, task.y] : [task.y, task.x];
  const prompt = fill(loadPrompt("pairwise"), { PLAN: docs.plan, CONTEXT: docs.context, A: renderList(a.list), B: renderList(b.list) });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge: JUDGE_OF[task.model] as "astra" | "opus", prompt: attempt === 1 ? prompt : prompt + RESEND_NOTE, effort: JUDGING.productionEffort, maxTokens: attempt === 1 ? MONEY.outputCaps.pairwise : 2 * MONEY.outputCaps.pairwise, label: "pairwise:" + task.id + ":" + attempt, subject: task.model, cacheKey: "pairwise|" + task.id + "|" + attempt });
    const obj = reply.text === null ? null : lastJson(reply.text);
    const better = obj?.better;
    if (better === "A" || better === "B" || better === "tie") {
      const winner = better === "tie" ? "tie" : (better === "A") === (task.aIs === "x") ? "x" : "y";
      return { task, winner, why: typeof obj.why === "string" ? obj.why : null };
    }
  }
  return { task, winner: null, why: null };
}

/** Raw win rates per model, side and comparator (ties count half), and the stock block's flag on Opus. */
export function pairwiseSummary(results: readonly PairwiseResult[]): { rows: { model: Model; side: Side; against: Side; n: number; wins: number; ties: number; winRate: number | null }[]; stockShare: number | null; stockFlag: boolean } {
  const groups = new Map<string, PairwiseResult[]>();
  for (const r of results) if (r.winner !== null) groups.set([r.task.model, r.task.x.side, r.task.y.side].join("|"), [...(groups.get([r.task.model, r.task.x.side, r.task.y.side].join("|")) ?? []), r]);
  const rows = [...groups.keys()].sort().map((k) => {
    const rs = groups.get(k)!;
    const [model, side, against] = k.split("|") as [Model, Side, Side];
    const wins = rs.filter((r) => r.winner === "x").length, ties = rs.filter((r) => r.winner === "tie").length;
    return { model, side, against, n: rs.length, wins, ties, winRate: rs.length ? (wins + ties / 2) / rs.length : null };
  });
  const stock = results.filter((r) => r.winner !== null && r.task.model === "opus" && r.task.x.side.startsWith("stock-") && r.task.y.side === "none");
  const stockShare = stock.length ? stock.filter((r) => r.winner === "x").length / stock.length : null;
  return { rows, stockShare, stockFlag: stockShare !== null && r4(stockShare) > JUDGING.pairwiseStockMax };
}

/** The arm-guess sample: 30 seeded random Opus lists from the four arms. */
export function armGuessSample(rows: readonly ReviewRow[]): ReviewRow[] {
  const arms = new Set<string>(["none", "lens", "plan-design-review", "autoplan"]);
  const pool = rows.filter((r) => r.model === "opus" && arms.has(r.kind) && r.list !== null && !r.smoke).sort((a, b) => (a.session < b.session ? -1 : 1));
  return shuffle(pool, rngFor("arm guess")).slice(0, JUDGING.armGuess.lists);
}

/** Astra's guesses on the sample: the share correct, and the flag above 70%. An unreadable guess counts as wrong. */
export async function armGuess(sample: readonly ReviewRow[], call: JudgeCaller): Promise<{ guesses: { session: string; kind: SessionKind; guess: string | null }[]; correct: number; rate: number | null; flag: boolean }> {
  const template = loadPrompt("arm-guess");
  const guesses: { session: string; kind: SessionKind; guess: string | null }[] = [];
  for (const r of sample) {
    const reply = await call({ judge: "astra", prompt: fill(template, { LIST: renderList(r.list!) }), effort: JUDGING.productionEffort, maxTokens: MONEY.outputCaps.probe, label: "arm-guess:" + r.session, subject: "opus", cacheKey: "arm-guess|" + r.session });
    const obj = reply.text === null ? null : lastJson(reply.text);
    guesses.push({ session: r.session, kind: r.kind, guess: typeof obj?.arm === "string" ? obj.arm : null });
  }
  const correct = guesses.filter((g) => g.guess === g.kind).length;
  const rate = guesses.length ? correct / guesses.length : null;
  return { guesses, correct, rate, flag: rate !== null && r4(rate) > JUDGING.armGuess.flagAbove };
}

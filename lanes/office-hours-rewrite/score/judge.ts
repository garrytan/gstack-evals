// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's judges (prereg section 5, and section 12's gold pass). Packets go through an injected
// Caller, the product-value eval's metered judge client (lanes/product-value/judge.ts openJudge, as the founder lane's
// score/judge.ts uses it), which holds the ledger lease and caches by model, version, prompt and packet. The rules:
// - Prompt: prompts/judge.md, a build-time choice on the founder lane's brief structure, pinned by sha256. It asks for
//   two cells per block: decision (R2: the key's call, not the contrast call, without hedging between them) and action
//   (R3: in one of the acceptable action classes and specific to this person; a stock action does not count).
// - Routing: a label packet goes to frozen.JUDGE_FOR of its model (Astra for Opus blocks, Opus 5.5 for Sol and particle-1
//   blocks); a check or anchor packet goes to Astra and Opus both.
// - Effort: medium (frozen.JUDGE_EFFORT) on a label map; a check map runs at max (frozen.GOLD_EFFORT) for gold or at
//   medium for the judge's own check labels.
// - A packet with a missing or unparsable cell is resent once, whole, with the product-value eval's fixed note so the
//   cache is not read; the resend's answer replaces the first. A cell still missing is null (unlabelled).
// - labeller() implements types.ts Labeller on the same prompt, so authoring's screens label the way production does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lastJson, RESEND_NOTE, type CallLog, type Caller, type Reply } from "../../product-value/judge.ts";
import { GOLD_EFFORT, JUDGE_EFFORT } from "../frozen.ts";
import type { Cells, JudgeKey, LabelRecord, Labeller } from "../types.ts";
import { renderPacket, type PacketFile, type PacketMap } from "./packets.ts";

export const JUDGE_PROMPT_SHA256 = "55315d4cd259a3528e446365da214f31b511339706fca73dbda919a249f219e8";

export function loadPrompt(): string {
  const text = readFileSync(join(import.meta.dir, "prompts", "judge.md"), "utf8");
  if (createHash("sha256").update(text).digest("hex") !== JUDGE_PROMPT_SHA256) throw new Error("E_OHR_JUDGE_INPUT lanes/office-hours-rewrite/score/prompts/judge.md does not match its pinned sha256; the judge prompt is frozen");
  return text;
}

export type Effort = "medium" | "max";
const MAX_TOKENS: Record<Effort, number> = { medium: 16_000, max: 32_000 };

/** One judge's two cells on one block in one packet. */
export interface JudgedLabel extends LabelRecord {
  packet: string;
  model_id: string;
}

type Two = { decision: boolean | null; action: boolean | null };

/** Reads a label answer against its packet: one boolean per (block, cell); anything else, or a disagreeing duplicate, is null. */
export function parseCells(text: string | null, p: Pick<PacketFile, "blocks">): { cells: Map<string, Two>; missing: number } {
  const ids = new Set(p.blocks.map((b) => b.id));
  const seen = new Map<string, Partial<Two>>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || !ids.has(e.block)) continue;
    const prior = seen.get(e.block) ?? {};
    for (const c of ["decision", "action"] as const) {
      const v = typeof e[c] === "boolean" ? (e[c] as boolean) : null;
      prior[c] = c in prior && prior[c] !== v ? null : v;
    }
    seen.set(e.block, prior);
  }
  const cells = new Map<string, Two>();
  let missing = 0;
  for (const b of p.blocks) {
    const s = seen.get(b.id) ?? {};
    const two = { decision: s.decision ?? null, action: s.action ?? null };
    missing += (two.decision === null ? 1 : 0) + (two.action === null ? 1 : 0);
    cells.set(b.id, two);
  }
  return { cells, missing };
}

/** One judge's answer for a packet: the first send and, when a cell is missing, one whole resend that replaces it. */
async function labelOnce(p: Pick<PacketFile, "id" | "items" | "blocks">, judge: JudgeKey, effort: Effort, call: Caller, logs: CallLog[]): Promise<{ cells: Map<string, Two>; reply: Reply }> {
  const base = loadPrompt().replace("{{PACKET}}", renderPacket(p));
  let out: { cells: Map<string, Two>; reply: Reply } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[effort], label: p.id + ":" + judge + ":" + attempt });
    const parsed = parseCells(reply.text, p);
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, problem: reply.problem, missing: parsed.missing });
    out = { cells: parsed.cells, reply };
    if (!parsed.missing) break;
  }
  return out!;
}

/** Runs every packet of a map with its judges, one at a time in id order. */
export async function judgePackets(o: { map: PacketMap; packets: ReadonlyMap<string, PacketFile>; call: Caller; effort: Effort }): Promise<{ labels: JudgedLabel[]; calls: CallLog[] }> {
  if (o.map.kind === "label" && o.effort !== JUDGE_EFFORT) throw new Error("E_OHR_JUDGE_INPUT a label map runs at " + JUDGE_EFFORT + " effort, not " + o.effort);
  if (o.effort !== JUDGE_EFFORT && o.effort !== GOLD_EFFORT) throw new Error("E_OHR_JUDGE_INPUT effort " + o.effort + " is neither " + JUDGE_EFFORT + " nor " + GOLD_EFFORT);
  const calls: CallLog[] = [];
  const labels: JudgedLabel[] = [];
  for (const id of Object.keys(o.map.packets).sort()) {
    const p = o.packets.get(id);
    if (!p) throw new Error("E_OHR_JUDGE_INPUT packet " + id + " is in the map but not in the packets folder");
    const meta = o.map.packets[id]!;
    for (const judge of meta.judges) {
      const a = await labelOnce(p, judge, o.effort, o.call, calls);
      for (const b of p.blocks) labels.push({ packet: id, block: b.id, brief: meta.brief, judge, model_id: a.reply.model_id, model_version: a.reply.version, effort: o.effort, ...a.cells.get(b.id)! });
    }
  }
  return { labels, calls };
}

/** types.ts's Labeller on the frozen prompt: a block with no cell labelled after the one resend is a null entry. */
export const labeller =
  (call: Caller, logs: CallLog[] = []): Labeller =>
  async (req) => {
    const a = await labelOnce({ id: req.label, items: req.items, blocks: req.blocks.map((b) => ({ id: b.id, block: b.block })) }, req.judge, req.effort, call, logs);
    return new Map(req.blocks.map((b) => {
      const c = a.cells.get(b.id)!;
      return [b.id, c.decision === null && c.action === null ? null : ({ ...c, model_version: a.reply.version } satisfies Cells)];
    }));
  };

// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's judges (prereg section 7, R78). Packets go through an injected Caller, the product-value
// eval's metered judge client (lanes/product-value/judge.ts openJudge), which caches by model, version, prompt and
// packet. The rules this file holds:
// - Routing: GPT-6 Astra labels Opus blocks, Opus 5.5 labels Sol blocks, and particle-1 blocks go to the Astra and Opus
//   panel, where Gemini 4 Argon votes only on the cells the two split on; the panel's label is the median of the votes,
//   which for binary labels is the majority. Stock rows, anchors, reference, pitch, shuffled-key and gold packets go to the
//   production judge of the model they sit beside. The judge check's pass sends the audit prompt to Astra and Opus alone.
// - Effort: medium in production, max in the check pass.
// - Cells: every block needs customer, wedge, multi_target, next and alt, and doubt only when the key's pivot isn't none.
//   A packet with a missing or unparsable cell is resent once, whole, with a fixed note so the cache isn't read, and the
//   resend's answer replaces the first. A cell still missing stays null (unlabelled). A failed tie-break is retried once
//   the same way; a split cell Gemini still leaves open stays null on the panel.
// - Every record names the judge, the model id, the version the provider reported and the effort.
// - labeller() implements types.ts's Labeller with the same brief, so authoring's checks label the way production does.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EFFORT, lastJson, RESEND_NOTE, type CallLog, type Caller, type Reply } from "../../product-value/judge.ts";
import { pool } from "../../product-value/meter.ts";
import { renderBlock } from "../parse.ts";
import type { JudgeKey, LabelRecord, Labeller } from "../types.ts";
import { hasPivot, renderPacket, type PacketFile, type PacketMap, type PacketMeta, type PromptName } from "./packets.ts";

/** The judge brief and the audit prompt, frozen before any arm output exists. */
export const PROMPT_SHA256: Readonly<Record<PromptName, string>> = {
  brief: "d37495349466626a75bed03719644804e0641a80fa8457fb6b27c3538adf5c75",
  audit: "9e2b88af7152fca222b33bc141e5fa83a3e0f63c30d90cb0e9bb2e025447e913",
};

export function loadPrompt(name: PromptName): string {
  const text = readFileSync(join(import.meta.dir, "prompts", name + ".md"), "utf8");
  if (createHash("sha256").update(text).digest("hex") !== PROMPT_SHA256[name]) throw new Error("E_USAGE lanes/office-hours-founder/score/prompts/" + name + ".md does not match its pinned sha256; the judge prompts are frozen (section 7)");
  return text;
}

const MAX_TOKENS: Record<PromptName, number> = { brief: 16_000, audit: 32_000 };
export const CELLS = ["customer", "wedge", "multi_target", "next", "alt", "doubt"] as const;
export type Cell = (typeof CELLS)[number];
type Cells = Record<Cell, boolean | null>;

/** One judge's cells for one block in one packet. */
export interface JudgedLabel extends LabelRecord {
  packet: string;
  model_id: string;
  /** Audit pass only: the quoted words behind each credit. */
  quotes?: Partial<Record<Cell, string>>;
}

interface Parsed {
  cells: Map<string, Cells & { quotes?: Partial<Record<Cell, string>> }>;
  missing: number;
}

const needed = (p: Pick<PacketFile, "doubt">): readonly Cell[] => (p.doubt ? CELLS : CELLS.filter((c) => c !== "doubt"));

/** Reads a label answer against its packet: one boolean per needed (block, cell); anything else, or two entries that disagree, is missing. */
export function parseCells(text: string | null, p: PacketFile, audit: boolean): Parsed {
  const want = needed(p);
  const ids = new Set(p.blocks.map((b) => b.id));
  const seen = new Map<string, Partial<Record<Cell, boolean | null>>>();
  const quotes = new Map<string, Partial<Record<Cell, string>>>();
  const obj = text === null ? null : lastJson(text);
  for (const e of Array.isArray(obj?.labels) ? obj.labels : []) {
    if (!e || !ids.has(e.block)) continue;
    const prior = seen.get(e.block) ?? {};
    for (const c of want) {
      const v = typeof e[c] === "boolean" ? (e[c] as boolean) : null;
      prior[c] = c in prior && prior[c] !== v ? null : v;
    }
    seen.set(e.block, prior);
    if (audit && e.quotes && typeof e.quotes === "object") quotes.set(e.block, Object.fromEntries(Object.entries(e.quotes).filter(([k, q]) => (CELLS as readonly string[]).includes(k) && typeof q === "string")) as Partial<Record<Cell, string>>);
  }
  const cells: Parsed["cells"] = new Map();
  let missing = 0;
  for (const b of p.blocks) {
    const s = seen.get(b.id) ?? {};
    const row = Object.fromEntries(CELLS.map((c) => [c, want.includes(c) ? (s[c] ?? null) : null])) as Cells;
    missing += want.filter((c) => row[c] === null).length;
    cells.set(b.id, { ...row, ...(audit ? { quotes: quotes.get(b.id) ?? {} } : {}) });
  }
  return { cells, missing };
}

/** One judge's answer for a packet: the first send, and one whole resend with the fixed note when a cell is missing. */
async function labelOnce(p: PacketFile, judge: JudgeKey, effort: string, call: Caller, logs: CallLog[], open: (parsed: Parsed) => number = (x) => x.missing): Promise<{ parsed: Parsed; reply: Reply }> {
  const base = loadPrompt(p.prompt).replace("{{PACKET}}", renderPacket(p));
  let out = { parsed: { cells: new Map(), missing: 0 } as Parsed, reply: { text: null, model_id: "", version: null, problem: null } as Reply };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await call({ judge, prompt: attempt === 1 ? base : base + RESEND_NOTE, effort, maxTokens: MAX_TOKENS[p.prompt], label: p.id + ":" + judge + ":" + attempt });
    const parsed = parseCells(reply.text, p, p.prompt === "audit");
    logs.push({ packet: p.id, judge, attempt, model_id: reply.model_id, version: reply.version, problem: reply.problem, missing: open(parsed) });
    out = { parsed, reply };
    if (!open(parsed)) break;
  }
  return out;
}

/** Labels one packet with each of its judges and, for a particle-1 panel packet, adds the panel's records. */
export async function labelPacket(p: PacketFile, meta: PacketMeta, effort: string, call: Caller, logs: CallLog[]): Promise<JudgedLabel[]> {
  const record = (judge: JudgedLabel["judge"], reply: Pick<Reply, "model_id" | "version">, block: string, cells: Cells, quotes?: Partial<Record<Cell, string>>): JudgedLabel => ({
    packet: p.id,
    block,
    unit: meta.blocks[block]!.unit,
    key_unit: meta.unit,
    key: meta.role === "shuffled" ? "shuffled" : "true",
    judge,
    model_id: reply.model_id,
    model_version: reply.version,
    effort,
    ...cells,
    ...(quotes ? { quotes } : {}),
  });
  const out: JudgedLabel[] = [];
  const answers = new Map<JudgeKey, { parsed: Parsed; reply: Reply }>();
  for (const judge of meta.judges) {
    const a = await labelOnce(p, judge, effort, call, logs);
    answers.set(judge, a);
    for (const b of p.blocks) {
      const { quotes, ...cells } = a.parsed.cells.get(b.id)!;
      out.push(record(judge, a.reply, b.id, cells, quotes));
    }
  }
  if (meta.role === "check" || meta.judges.length < 2) return out;
  const astra = answers.get("astra")!.parsed.cells, opus = answers.get("opus")!.parsed.cells;
  const split = (block: string, c: Cell) => astra.get(block)![c] !== null && opus.get(block)![c] !== null && astra.get(block)![c] !== opus.get(block)![c];
  const splits = p.blocks.flatMap((b) => CELLS.filter((c) => split(b.id, c)).map((c) => [b.id, c] as const));
  const gemini = splits.length ? await labelOnce(p, "gemini", effort, call, logs, (x) => splits.filter(([b, c]) => x.cells.get(b)![c] === null).length) : null;
  for (const b of p.blocks) {
    const cells = Object.fromEntries(CELLS.map((c) => [c, split(b.id, c) ? gemini!.parsed.cells.get(b.id)![c] : astra.get(b.id)![c] === opus.get(b.id)![c] ? astra.get(b.id)![c] : null])) as Cells;
    const voters = [answers.get("astra")!.reply, answers.get("opus")!.reply, ...(gemini && CELLS.some((c) => split(b.id, c)) ? [gemini.reply] : [])];
    out.push(record("panel", { model_id: "panel:" + voters.map((v) => v.model_id).join("+"), version: voters.map((v) => v.version).join("+") }, b.id, cells));
  }
  for (const b of gemini ? p.blocks.filter((b) => CELLS.some((c) => split(b.id, c))) : []) out.push(record("gemini", gemini!.reply, b.id, Object.fromEntries(CELLS.map((c) => [c, split(b.id, c) ? gemini!.parsed.cells.get(b.id)![c] : null])) as Cells));
  return out;
}

/** Runs every packet of a map with its judges; the map's kind sets the effort (max for the check pass). */
export async function judgePackets(o: { map: PacketMap; packets: ReadonlyMap<string, PacketFile>; call: Caller; concurrency: number }): Promise<{ labels: JudgedLabel[]; calls: CallLog[] }> {
  const calls: CallLog[] = [];
  const effort = o.map.kind === "check" ? EFFORT.check : EFFORT.production;
  const ids = Object.keys(o.map.packets).sort();
  for (const id of ids) if (!o.packets.has(id)) throw new Error("E_USAGE packet " + id + " is in the map but not in the packets folder");
  const done = await pool(o.concurrency, ids.map((id) => () => labelPacket(o.packets.get(id)!, o.map.packets[id]!, effort, o.call, calls)));
  return { labels: done.flat(), calls };
}

/** types.ts's Labeller on the production brief: one packet of the given blocks against one unit's key items. */
export const labeller =
  (call: Caller, logs: CallLog[] = []): Labeller =>
  async (req) => {
    const p: PacketFile = { id: req.label, prompt: "brief", items: req.items, doubt: hasPivot(req.items), blocks: req.blocks.map((b) => ({ id: b.id, text: renderBlock(b.block), first_move_full: b.block.first_move_full })) };
    const a = await labelOnce(p, req.judge, req.effort, call, logs);
    return new Map(req.blocks.map((b) => [b.id, { judge: req.judge, model_version: a.reply.version, effort: req.effort, ...a.parsed.cells.get(b.id)! }]));
  };

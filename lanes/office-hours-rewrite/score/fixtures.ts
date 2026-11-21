// Copyright (c) 2026 Garry Tan. MIT License.
// Invented, neutral fixtures for the rewrite eval's score area: briefs, session rows, transcripts, state roots and a
// stub judge. Its seams and tests share them (prereg section 12 stage 1: the dry run drives every frozen rule on planted
// cases). None is an eval brief; every name and fact here is made up for the checks.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller } from "../../product-value/judge.ts";
import type { Block, BriefMeta, Key, SessionRow, Turn } from "../types.ts";
import { parseBlock, renderBlock } from "./block.ts";
import type { CheckInput } from "./check.ts";
import type { JudgedLabel } from "./judge.ts";
import type { BlockRef, Brief, PacketMap } from "./packets.ts";

const meta = (id: string, o: Partial<BriefMeta>): BriefMeta => ({ id, kind: "founder", type: "T1", skin: 0, cluster: id, set: "calibration", draw: 1, author: "sol", twin_of: null, traction: false, anti_pattern: "launch anxiety", industry: "bakery supply", pilot: false, digest: "0".repeat(64), ...o });

/** A matched T1 pair (a and b share an opening), an unpaired T7 founder (c) and a builder (d). */
export const BRIEFS: ReadonlyMap<string, Brief> = new Map<string, Brief>([
  ["a", { key: { call: "Do not raise money yet; get one paying bakery first", actions: ["Ask two bakery owners to prepay for a month of deliveries", "Deliver flour by hand to one bakery this week"], decisive: ["fa1"], twin: "b", traction: false, wrong_call: null }, meta: meta("a", { cluster: "ab", twin_of: "b" }) }],
  ["b", { key: { call: "Raise a seed round now to fund delivery vans", actions: ["Send the investor update to five seed funds by Friday"], decisive: ["fb1", "fb2"], twin: "a", traction: true, wrong_call: null }, meta: meta("b", { cluster: "ab", twin_of: "a", traction: true }) }],
  ["c", { key: { call: "Do not hire; cut the scope to one bakery route", actions: ["Drop the second route this week"], decisive: ["fc1"], twin: null, traction: false, wrong_call: "Hire a sales lead to fix momentum" }, meta: meta("c", { type: "T7", cluster: "c" }) }],
  ["d", { key: { call: "Build the offline map first", actions: ["Sketch the offline map screen tonight"], decisive: ["fd1"], twin: null, traction: false, wrong_call: "Build the social feed first" }, meta: meta("d", { kind: "builder", type: "hackathon", cluster: "d", anti_pattern: null }) }],
]);

export const blockOf = (decision: string, next_action: string, why = "It fits.") => {
  const p = parseBlock(renderBlock({ decision, next_action, why }));
  if (p.kind !== "block") throw new Error("fixture block did not parse");
  return p;
};

export const turn = (n: number, revealed: string[] = []): Turn => ({ turn: n, reply: "ok", revealed, rules: [], attempts: 1, delivered: false, done: false, rejected_draws: [] });

export function row(o: Partial<SessionRow> & Pick<SessionRow, "brief">): SessionRow {
  const k = BRIEFS.get(o.brief)!.key;
  return { stage: 1, model: "opus", arm: "none", end: "block", code: null, block: blockOf(k.call, k.actions[0]!), founder_turns: [turn(1, k.decisive), turn(2), turn(3)].map((t) => ({ ...t, delivered: true })), closings: 1, founder_done: true, replies: 5, session_kind: null, served_model: null, cli_version: null, guard_failures: 0, gstack_reads: [], usd: 0, sim_usd: 0, attempts: 1, transcript: null, state_root: null, ...o };
}

/** Every arm's block on every brief for one model, the key's call everywhere. */
export const allRows = (model: SessionRow["model"] = "opus", stage: 1 | 2 = 1): SessionRow[] => [...BRIEFS.keys()].flatMap((brief) => (["none", "current", "new"] as const).map((arm) => row({ brief, model, arm, stage })));

type Part = string | { tool: string; input: Record<string, unknown>; result?: string; error?: boolean } | { user: string };
/** A transcript.ndjson: each reply's texts, tool calls and injected user text, with a result line after each reply. */
export function transcript(replies: Part[][]): string {
  const lines: Record<string, unknown>[] = [];
  let id = 0;
  for (const reply of replies) {
    for (const part of reply) {
      if (typeof part === "string") lines.push({ type: "assistant", message: { content: [{ type: "text", text: part }] } });
      else if ("user" in part) lines.push({ type: "user", message: { content: [{ type: "text", text: part.user }] } });
      else {
        const use = "t" + ++id;
        lines.push({ type: "assistant", message: { content: [{ type: "tool_use", id: use, name: part.tool, input: part.input }] } });
        lines.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: use, content: part.result ?? "ok", ...(part.error ? { is_error: true } : {}) }] } });
      }
    }
    lines.push({ type: "result" });
  }
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

/** A fresh state root holding the given files, by path under the root. */
export function stateRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ohr-score-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

/** A stub judge: credits a block's decision when it holds the packet's call, and its action when it holds an action class. */
export function stubCaller(o: { garble?: number; skip?: (blockText: string) => boolean } = {}): Caller & { calls: number } {
  let garbled = 0;
  const f = async (req: Parameters<Caller>[0]) => {
    f.calls++;
    if (garbled < (o.garble ?? 0)) {
      garbled++;
      return { text: "not json", model_id: "stub-" + req.judge, version: "v1", problem: null };
    }
    const packet = req.prompt.slice(req.prompt.lastIndexOf("KEY ITEMS\nCall: "));
    const call = /^Call: (.*)$/m.exec(packet)![1]!;
    const actions = [...packet.matchAll(/^Action \d+: (.*)$/gm)].map((m) => m[1]!);
    const labels = [...packet.matchAll(/^Block (\S+)\nDECISION: (.*)\nNEXT ACTION: (.*)\nWHY: .*$/gm)]
      .filter((m) => !o.skip?.(m[2]! + " " + m[3]!))
      .map((m) => ({ block: m[1], decision: m[2] === call, action: actions.includes(m[3]!) }));
    return { text: JSON.stringify({ labels }), model_id: "stub-" + req.judge, version: "v1", problem: null };
  };
  f.calls = 0;
  return f;
}

export const block = (decision: string, next_action: string, why = ""): Block => ({ decision, next_action, why });
export type { Key };

/** A check map for section 12's judge check: n session blocks, answer blocks, oracles, near-misses and stock rows, in one packet. */
export function plantCheck(o: { session: number; answer?: number; oracle?: number; near?: number; stock?: number }): { map: PacketMap; ids: Record<string, string[]> } {
  const blocks: Record<string, BlockRef> = {};
  const ids: Record<string, string[]> = { session: [], answer: [], oracle: [], near: [], stock: [] };
  const add = (k: string, n: number, ref: BlockRef) => {
    for (let i = 0; i < n; i++) {
      blocks[k + i] = ref;
      ids[k]!.push(k + i);
    }
  };
  add("session", o.session, { kind: "session", session: { stage: 1, brief: "a", model: "opus", arm: "none" } });
  add("answer", o.answer ?? 0, { kind: "answer", author: "sol", source: "full" });
  add("oracle", o.oracle ?? 0, { kind: "oracle" });
  add("near", o.near ?? 0, { kind: "near-miss" });
  add("stock", o.stock ?? 0, { kind: "stock", row: 1 });
  return { map: { version: 1, kind: "check", stage: 1, seed: 1, packets: { P: { id: "P", role: "check", stage: 1, brief: "a", model: "opus", judges: ["astra", "opus"], blocks } } }, ids };
}
export const judgedLabel = (judge: "astra" | "opus", block: string, decision: boolean | null, action: boolean | null, effort: "max" | "medium"): JudgedLabel => ({ packet: "P", block, brief: "a", judge, model_id: judge, model_version: "v", effort, decision, action });
/** Gold: both judges agree at max effort, block i credited on both cells when i is even. */
const goldFor = (ids: string[]) => ids.flatMap((b, i) => (["astra", "opus"] as const).map((j) => judgedLabel(j, b, i % 2 === 0, i % 2 === 0, "max")));
export type Says = (block: string, i: number, kind: string) => [boolean | null, boolean | null];
/** A judge that matches gold, credits oracles and credits no near-miss or stock row. */
export const faithful: Says = (_b, i, kind) => (kind === "session" || kind === "answer" ? [i % 2 === 0, i % 2 === 0] : kind === "oracle" ? [true, true] : [false, false]);
export function checkInput(o: Parameters<typeof plantCheck>[0], says: Says): CheckInput {
  const { map, ids } = plantCheck(o);
  const gold = [...goldFor(ids.session!), ...goldFor(ids.answer!)];
  const labels = Object.entries(ids).flatMap(([kind, list]) => list.map((b, i) => judgedLabel("astra", b, ...says(b, i, kind), "medium")));
  return { map, gold, labels, judge: "astra" };
}

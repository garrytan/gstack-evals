// Copyright (c) 2026 Garry Tan. MIT License.
// The closing block's dry-run seams (prereg section 14, start rule 7): normalization, the cuts and the one lenient parse,
// each driven through parse.ts on both sides of its edge. The fixtures are invented and are never eval units.
import { normalizeBlock, parseFirstMove, renderBlock } from "./parse.ts";
import type { FirstMove, MoveParse, Seam } from "./types.ts";

const fence = (label: string, body: string) => "Here is my advice.\n\n```" + label + "\n" + body + "\n```\n";
const BLOCK: FirstMove = { first_move: "Sell route sheets to laundry pickup owners.", next_action: "Call three owners this week.", other_moves: ["Build a driver app.", "Raise a seed round.", "Hire a sales lead."], doubt: "Owners may not pay monthly." };
const wordsOf = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
const is = (p: MoveParse, lenient: string[] | null) => p.kind === "block" && JSON.stringify(p.lenient) === JSON.stringify(lenient);
const noBlock = (p: MoveParse) => ({ ok: p.kind === "no-block", detail: p.kind === "no-block" ? p.reason : "parsed a block" });
const without = (k: keyof FirstMove) => JSON.stringify(Object.fromEntries(Object.entries(BLOCK).filter(([key]) => key !== k)));

const cutEdge = (name: string, field: "first_move" | "next_action" | "doubt", at: number): Seam[] => [
  { name: "parse: a " + at + "-word " + name + " stays whole", run: () => { const n = normalizeBlock({ ...BLOCK, [field]: wordsOf(at) }); return { ok: n.words[field] === at && !n.cut[field], detail: n.words[field] + " words" }; } },
  { name: "parse: a " + (at + 1) + "-word " + name + " is cut at word " + at, run: () => { const n = normalizeBlock({ ...BLOCK, [field]: wordsOf(at + 1) }); return { ok: n.words[field] === at && n.cut[field], detail: n.words[field] + " words" }; } },
];

export const seams: Seam[] = [
  { name: "parse: the strict parse reads the last first-move fence, any case", run: () => { const p = parseFirstMove([fence("first-move", JSON.stringify({ ...BLOCK, first_move: "Old move." })), fence("FIRST-MOVE", JSON.stringify(BLOCK))]); return { ok: is(p, null) && p.kind === "block" && p.block.first_move === BLOCK.first_move, detail: p.kind }; } },
  { name: "parse: trailing commas pass only through the lenient parse", run: () => { const p = parseFirstMove([fence("first-move", JSON.stringify(BLOCK).replace(/\]/, ",]").replace(/}$/, ",}"))]); return { ok: is(p, ["commas"]), detail: JSON.stringify(p.kind === "block" ? p.lenient : p.reason) }; } },
  { name: "parse: a missing other_moves on a first-move fence reads as empty through the lenient parse", run: () => { const p = parseFirstMove([fence("first-move", without("other_moves"))]); return { ok: is(p, ["optional"]) && p.kind === "block" && p.block.other_moves.length === 0, detail: p.kind }; } },
  { name: "parse: a missing doubt on a first-move fence reads as empty through the lenient parse", run: () => { const p = parseFirstMove([fence("first-move", without("doubt"))]); return { ok: is(p, ["optional"]) && p.kind === "block" && p.block.doubt === "", detail: p.kind }; } },
  { name: "parse: with no first-move fence, a fence labelled otherwise holding all four keys parses leniently", run: () => { const p = parseFirstMove([fence("json", JSON.stringify(BLOCK))]); return { ok: is(p, ["label"]), detail: p.kind }; } },
  { name: "parse: a fence labelled otherwise missing one key is no-block", run: () => noBlock(parseFirstMove([fence("json", without("doubt"))])) },
  { name: "parse: a missing next_action is no-block even leniently", run: () => noBlock(parseFirstMove([fence("first-move", without("next_action"))])) },
  { name: "parse: an empty first_move is no-block", run: () => noBlock(parseFirstMove([fence("first-move", JSON.stringify({ ...BLOCK, first_move: "  " }))])) },
  { name: "parse: other_moves of the wrong type is no-block", run: () => noBlock(parseFirstMove([fence("first-move", JSON.stringify({ ...BLOCK, other_moves: "Build a driver app." }))])) },
  { name: "parse: a reply with no fence is no-block", run: () => noBlock(parseFirstMove(["Sell route sheets to laundry owners."])) },
  ...cutEdge("first move", "first_move", 40),
  ...cutEdge("next action", "next_action", 30),
  ...cutEdge("doubt", "doubt", 25),
  { name: "parse: a 25-word other move stays whole and a 26-word one is cut", run: () => { const n = normalizeBlock({ ...BLOCK, other_moves: [wordsOf(25), wordsOf(26)] }); return { ok: n.block.other_moves[0]!.split(" ").length === 25 && n.block.other_moves[1]!.split(" ").length === 25 && n.cut.other_moves, detail: n.block.other_moves.map((m) => m.split(" ").length).join(",") }; } },
  { name: "parse: two other moves are kept and a third is dropped", run: () => { const n = normalizeBlock(BLOCK); return { ok: n.block.other_moves.length === 2, detail: String(n.block.other_moves.length) }; } },
  { name: "parse: the uncut first move is kept for the multi-target label", run: () => { const n = normalizeBlock({ ...BLOCK, first_move: wordsOf(41) + " and sell to gyms" }); return { ok: n.first_move_full.split(" ").length === 45 && n.block.first_move.split(" ").length === 40, detail: "" }; } },
  { name: "parse: normalization strips markdown and numbering and renders four labelled lines", run: () => { const n = normalizeBlock({ ...BLOCK, first_move: "1. **Sell** [route sheets](https://example.com) to `laundry` owners." }); const r = renderBlock(n); return { ok: n.block.first_move === "Sell route sheets to laundry owners." && r.split("\n").length === 4 && r.startsWith("First move: "), detail: n.block.first_move }; } },
];

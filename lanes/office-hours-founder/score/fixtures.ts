// Copyright (c) 2026 Garry Tan. MIT License.
// Invented, neutral fixtures for the score area's seams and tests: units, session rows, transcripts and a stub judge.
// None is an eval unit; every name and fact here is made up for the checks.
import type { Caller } from "../../product-value/judge.ts";
import { normalizeBlock } from "../parse.ts";
import type { FirstMove, FounderTurn, Key, SessionRow, UnitMeta } from "../types.ts";
import type { ScoreUnit } from "./score.ts";

export const KEY: Key = {
  customer: "Owners of small bicycle repair shops",
  wedge: "A weekly parts reorder list",
  first_move: "Call three shop owners and take a paid pre-order",
  pivot: "The plan sells to chains, but only single shops asked",
  key_facts: ["f1", "f2", "f3", "f4"],
  mentioned: [],
  alternative: { customer: "Managers of regional bicycle chains", wedge: "A store analytics dashboard" },
};

export function unit(id: string, o: Partial<UnitMeta> & { key?: Partial<Key> } = {}): ScoreUnit {
  const { key, ...meta } = o;
  return {
    key: { ...KEY, ...key },
    meta: { id, stratum: "constructed", set: "calibration", draw: 1, author: "sol", shape: "s1", type: "B2B", industry: "retail", primary: ["customer", "wedge"], mentioned: [], generic: [], founder_stage: "pre-product", digest: "0".repeat(64), ...meta },
    sheet: { persona: "A founder.", facts: ["f1", "f2", "f3", "f4", "f5", "f6"].map((f, i) => ({ id: f, text: "Fact " + f + ".", reveal_when: "Asked.", kind: i === 0 ? "demand" : i === 1 ? "payment" : "other" })) },
  };
}

export const block = (first_move: string, b: Partial<FirstMove> = {}) => normalizeBlock({ first_move, next_action: "Call three shop owners and take a paid pre-order this week", other_moves: [], doubt: "", ...b });

export function row(o: Partial<SessionRow> & Pick<SessionRow, "unit">): SessionRow {
  return { stage: 1, kind: "arm", model: "opus", arm: "none", pass: 1, end: "block", code: null, block: block("Sell " + KEY.wedge + " to " + KEY.customer), lenient: null, founder_turns: [], closing_sent: false, replies: 1, exposure: null, questions: 0, pushes: 0, first_recommendation_reply: 0, web: 0, gstack_reads: [], named_source: false, usd: 0, sim_usd: 0, attempts: 1, repairs: [], ...o };
}

export const turn = (n: number, revealed: string[]): FounderTurn => ({ turn: n, reply: "ok", revealed, rules: [], attempts: 1 });

type Line = Record<string, unknown>;
/** A transcript.ndjson: each reply's texts and tool calls, a result line after each. */
export function transcript(replies: Array<Array<string | { read: string; result: string; error?: boolean }>>): string {
  const lines: Line[] = [];
  let id = 0;
  for (const reply of replies) {
    for (const part of reply) {
      if (typeof part === "string") {
        lines.push({ type: "assistant", message: { content: [{ type: "text", text: part }] } });
        continue;
      }
      const use = "t" + ++id;
      lines.push({ type: "assistant", message: { content: [{ type: "tool_use", id: use, name: "Read", input: { file_path: part.read } }] } });
      lines.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: use, content: part.result, ...(part.error ? { is_error: true } : {}) }] } });
    }
    lines.push({ type: "result" });
  }
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

export const FENCED = '```first-move\n{"first_move": "Sell a weekly parts reorder list to owners of small bicycle repair shops.", "next_action": "Call three owners.", "other_moves": [], "doubt": "Selling to chains."}\n```';

/** The text of an exposed office-hours session, one string per reply; the last holds the block. */
export const EXPOSED = [
  "Q1 \u2014 What's the strongest evidence you have that someone actually wants this?\nWhy I'm asking: interest is not demand.",
  "Q2 \u2014 What are your users doing right now to solve this problem, even badly? What does that workaround cost them?",
  "PREMISES:\n1. Single shops are the buyers \u2014 agree/disagree?\n2. They pay for reorders \u2014 agree/disagree?\n\nAPPROACH A: Reorder list by hand\n  Summary: send it each week.\n\nAPPROACH B: Inventory app\n  Summary: build software.\n\n**RECOMMENDATION:** Choose A because it sells this week.\n\n" + FENCED,
];

export interface StubCells {
  customer?: boolean;
  wedge?: boolean;
  multi_target?: boolean;
  next?: boolean;
  alt?: boolean;
  doubt?: boolean;
}

/**
 * A stub judge that reads the packet it is sent: customer and wedge when the first move holds the key's words,
 * multi_target when the uncut first move names three or more of "target1" to "target9", next when the next action holds
 * the key's first move, alt when an other move holds the customer or wedge, doubt when the doubt holds "chains". edit
 * changes or drops cells per judge and attempt.
 */
export function stubCaller(edit: (judge: string, attempt: number, blockId: string, cells: StubCells) => StubCells = (_j, _a, _b, c) => c, calls: string[] = []): Caller {
  return async (c) => {
    calls.push(c.label);
    const attempt = Number(c.label.split(":").at(-1));
    const packet = c.prompt.slice(c.prompt.lastIndexOf("KEY ITEMS"));
    const item = (name: string) => new RegExp("^" + name + ": (.*)$", "m").exec(packet)![1]!.toLowerCase();
    const [customer, wedge, first] = [item("Customer"), item("Wedge"), item("First move")];
    const labels = [...packet.matchAll(/^Block (\S+)\n([\s\S]*?)(?=\n\nBlock |$(?![\s\S]))/gm)].map(([, id, body]) => {
      const line = (name: string) => (new RegExp("^" + name + ": (.*)$", "m").exec(body!)?.[1] ?? "").toLowerCase();
      const fm = line("First move");
      const cells: StubCells = {
        customer: fm.includes(customer),
        wedge: fm.includes(wedge),
        multi_target: new Set(line("First move as written \\(multi_target only\\)").match(/target\d/g) ?? []).size >= 3,
        next: line("Next action").includes(first),
        alt: [customer, wedge].some((k) => line("Other moves weighed").includes(k)),
        doubt: line("Doubt").includes("chains"),
      };
      return { block: id, ...edit(c.judge, attempt, id!, cells) };
    });
    return { text: JSON.stringify({ labels }), model_id: "stub:" + c.judge, version: c.judge + "-v1", problem: null };
  };
}

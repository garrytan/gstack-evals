// Copyright (c) 2026 Garry Tan. MIT License.
// The B1 browser-only label (plan section 6). Two models, GPT-6 Astra and Opus 5.5, each answer one frozen question about
// the issue, the fix and its tests, never an arm's output. A unit is in only when both say yes; agreement is reported.
// This labels eligibility and scores nothing. This file is keyless: it builds the packet, reads answers and reports
// agreement; the model calls run later under the h2h-labels ledger item through a LabelClient. stubClient serves tests.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readUnit, saveUnit } from "../../statemachines/unit.ts";
import { sha256 } from "./frame.ts";

export const LABEL_QUESTION = "Is the wrong behaviour visible only in a real browser engine, through rendering, layout, focus, DOM events, browser APIs or hydration, and not in Node or jsdom?";
export const LABEL_MODELS = ["gpt-6-astra", "claude-opus-5-5"] as const;
export type Answer = "yes" | "no" | "unclear";

/** The packet both models read: the frozen question, the answer format, the issue, the fix, its tests and the
 *  fail-to-pass ids (the oracle's set when it ran, else discovery's). Built from the unit dir alone. */
export function labelPacket(dir: string): { text: string; sha256: string } {
  const u = readUnit(dir);
  const f2p = u.oracle?.f2p ?? u.tests.f2p;
  const text = [
    "You are labelling one bug for an evaluation. Read the issue, the fix and its tests, then answer the question.",
    "",
    "Question: " + LABEL_QUESTION,
    "",
    "Answer \"yes\" or \"no\" on the first line, then one sentence on why.",
    "",
    "## Issue",
    "",
    readFileSync(join(dir, "issue.md"), "utf8").trim(),
    "",
    "## The fix (diff)",
    "",
    "~~~diff",
    readFileSync(join(dir, "fix.patch"), "utf8").trimEnd(),
    "~~~",
    "",
    "## The tests the fix adds or changes (diff)",
    "",
    "~~~diff",
    readFileSync(join(dir, "test.patch"), "utf8").trimEnd(),
    "~~~",
    "",
    "## Tests that fail before the fix and pass after it",
    "",
    ...f2p.map((id) => "- " + id),
    "",
  ].join("\n");
  return { text, sha256: sha256(text) };
}

/** The first word of the first non-empty line, lower case, without punctuation. */
export function readAnswer(text: string): Answer {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const w = (line.toLowerCase().match(/[a-z]+/) ?? [""])[0];
  return w === "yes" ? "yes" : w === "no" ? "no" : "unclear";
}

export interface LabelClient { model: string; ask(packet: string): Promise<string> }
export const stubClient = (model: string, reply: (packet: string) => string): LabelClient => ({ model, ask: async (p) => reply(p) });

export interface LabelRow { id: string; packet_sha256: string; answers: Record<string, Answer>; reply_sha256: Record<string, string>; in: boolean }

/** Asks every client once. In only when every answer is yes; unclear counts as not yes. */
export async function labelUnit(id: string, packet: { text: string; sha256: string }, clients: readonly LabelClient[]): Promise<LabelRow> {
  const answers: Record<string, Answer> = {}, reply_sha256: Record<string, string> = {};
  for (const c of clients) {
    const r = await c.ask(packet.text);
    answers[c.model] = readAnswer(r);
    reply_sha256[c.model] = sha256(r);
  }
  return { id, packet_sha256: packet.sha256, answers, reply_sha256, in: clients.length > 0 && Object.values(answers).every((a) => a === "yes") };
}

/** Records the label on unit.json's labels field. */
export function recordLabel(dir: string, row: LabelRow): void {
  const u = readUnit(dir);
  u.labels = { ...(u.labels ?? {}), browser_only: row };
  saveUnit(dir, u);
}

/** Agreement between two models over yes against not yes: the counts, the raw share and Cohen's kappa (null when the
 *  expected agreement is 1, so kappa is undefined). */
export function agreement(rows: readonly LabelRow[], a: string = LABEL_MODELS[0], b: string = LABEL_MODELS[1]) {
  const yes = (r: LabelRow, m: string) => r.answers[m] === "yes";
  const n = rows.length;
  const both_yes = rows.filter((r) => yes(r, a) && yes(r, b)).length;
  const both_no = rows.filter((r) => !yes(r, a) && !yes(r, b)).length;
  const unclear = rows.filter((r) => r.answers[a] === "unclear" || r.answers[b] === "unclear").length;
  const po = n ? (both_yes + both_no) / n : 0;
  const pa = n ? rows.filter((r) => yes(r, a)).length / n : 0, pb = n ? rows.filter((r) => yes(r, b)).length / n : 0;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return { units: n, both_yes, both_no, split: n - both_yes - both_no, unclear, agreement: po, kappa: n && pe < 1 ? (po - pe) / (1 - pe) : null };
}

export const writePacket = (dir: string, out: string): string => {
  const p = labelPacket(dir);
  writeFileSync(out, p.text);
  return p.sha256;
};

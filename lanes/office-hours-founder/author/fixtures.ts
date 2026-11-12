// Copyright (c) 2026 Garry Tan. MIT License.
// Invented, neutral fixtures for the authoring area's tests and dry-run seams: one constructed unit, one real-history
// source with its pages, notes and writer replies, a scripted caller that answers by request label, and a labeller that
// credits a W item when a block's first move holds the key item's words. None of it is an eval unit, and no call leaves
// the process.
import type { CallRequest } from "../../product-value/meter.ts";
import type { Labeller, Sheet } from "../types.ts";
import type { Cells } from "./checks.ts";
import type { Caller, UnitFiles } from "./files.ts";

export const FIXTURE: UnitFiles = {
  opening: "I run a small software shop and I want to build a maintenance platform for town parks departments. Crews track mowing, irrigation repairs and playground inspections on paper, and supervisors lose hours each week chasing who did what. My plan is one app that covers every job a parks crew does, with scheduling, work orders, inventory and reports for the town council. I have built a first version and three towns use it for free. Every town has a parks department and most still use clipboards, so I think the market is large. I want to raise a small round and hire two engineers to finish the platform.\n",
  sheet: {
    persona: "A former utility software engineer building tools for small town parks departments.",
    facts: [
      { id: "F1", text: "Two irrigation leads at town-owned golf courses open the app every morning, mostly to check the water meter page.", reveal_when: "Asked who uses the product most.", kind: "user" },
      { id: "F2", text: "One of those irrigation leads asked if he could pay for just the meter page, and named a monthly price.", reveal_when: "Asked whether anyone offered to pay.", kind: "payment" },
      { id: "F3", text: "The golf course irrigation leads walk each zone at dawn to spot leaks, which takes them about two hours a day.", reveal_when: "Asked how users handle the problem today.", kind: "status-quo" },
      { id: "F4", text: "When I showed a leak alert mockup, the second irrigation lead asked when he could have it on his phone.", reveal_when: "Asked how people reacted to a demo.", kind: "reaction" },
      { id: "F5", text: "The parks supervisors log in about once a month, mostly to print a report for the council.", reveal_when: "Asked how often supervisors use it.", kind: "user" },
      { id: "F6", text: "A supervisor said the council report would save her an afternoon each quarter.", reveal_when: "Asked what supervisors value.", kind: "reaction" },
      { id: "F7", text: "I tried selling the full platform to four towns and none would sign before next year's budget.", reveal_when: "Asked what sales attempts happened.", kind: "attempt" },
      { id: "F8", text: "I have savings to work full time on this for about nine more months.", reveal_when: "Asked about runway.", kind: "constraint" },
      { id: "F9", text: "Most of the towns I know came through a regional public works meeting I attended last spring.", reveal_when: "Asked how I find customers.", kind: "channel" },
      { id: "F10", text: "My cofounder and I both worked at a utility company before starting this.", reveal_when: "Asked about the team.", kind: "other" },
    ],
  },
  key: {
    customer: "irrigation leads at town-owned golf courses",
    wedge: "a leak alert that texts the lead when a zone's meter reading jumps",
    first_move: "Offer the leak alert to the two golf course irrigation leads who asked to pay, at a monthly price.",
    pivot: "The all-in-one parks platform; the evidence points to one leak alert tool for golf course irrigation.",
    key_facts: ["F1", "F2", "F3", "F4"],
    mentioned: [],
    alternative: { customer: "parks supervisors in small towns", wedge: "a quarterly council report generator" },
  },
};

/** Invented forcing questions in the pinned file's shape, for screens that must run without a gstack checkout. */
export const FIXTURE_ASKS = [
  "Which neighbor would lend you a ladder on a rainy Sunday?",
  "How many lanterns hang along the harbor wall each winter?",
  "Who repaints the lighthouse door after every storm season?",
  "What song does the ferry captain hum while docking?",
  "Where do the gulls nest when the pier is closed?",
  "Why does the bakery bell ring twice at dawn?",
];
export const FIXTURE_PHASE_2A = "### The Six Forcing Questions\n\n" + FIXTURE_ASKS.map((a, k) => "#### Q" + (k + 1) + ": Fixture\n\n**Ask:** \"" + a + "\"\n").join("\n");

export const fenced = (name: string, body: string) => "### " + name + "\n" + "\u0060\u0060\u0060" + "\n" + body.trim() + "\n" + "\u0060\u0060\u0060" + "\n";
export const authorReply = (u: Partial<UnitFiles>): string =>
  "Here are the files.\n\n" + (u.opening ? fenced("opening.md", u.opening) : "") + (u.sheet ? fenced("sheet.json", JSON.stringify(u.sheet, null, 2)) : "") + (u.key ? fenced("key.json", JSON.stringify(u.key, null, 2)) : "");
export const blockReply = (firstMove: string) => "My advice.\n\n" + "\u0060\u0060\u0060" + "first-move\n" + JSON.stringify({ first_move: firstMove, next_action: "Call them this week.", other_moves: [], doubt: "The platform." }) + "\n" + "\u0060\u0060\u0060" + "\n";

export const REAL_PAGE = "Fernwick Labs started in 2014 as a booking site for climbing gyms. Ada Quill wrote that our first gyms barely logged in, but two route setters exported the hold inventory every Friday. In 2015 one route setter paid for the inventory export alone, and that became Fernwick Ledger.";
export const REAL_NOTES = "Note A, before the turn\n- 2014: the founders set out to build a booking site for climbing gyms.\n- 2014: gym managers rarely logged in.\n- 2014: two route setters exported the hold inventory weekly.\n- 2015: a route setter asked to pay for the export alone.\n\nNote B, the turn and after\n- 2015: a route setter paid first, for the hold inventory export.\n- 2015: the founders dropped booking and sold the export.\n\nNames: Fernwick Labs, Fernwick Ledger, Ada Quill";
export const REAL_FILES: UnitFiles = {
  opening: "I am building a scheduling site for community pottery studios, so members can book wheels and kiln slots online. Studio owners juggle sign-up sheets and group texts, and I think a clean booking page would win them over. I want to sign up twenty studios this year.\n",
  sheet: {
    persona: "A potter and part-time web developer building booking software for pottery studios.",
    facts: [
      { id: "F1", text: "Studio owners rarely open the booking page.", reveal_when: "Asked who uses it.", kind: "user" },
      { id: "F2", text: "Two kiln technicians download the glaze stock list every Friday.", reveal_when: "Asked who uses it most.", kind: "user" },
      { id: "F3", text: "One kiln technician asked to pay for the glaze stock list alone.", reveal_when: "Asked whether anyone offered to pay.", kind: "payment" },
    ],
  } satisfies Sheet,
  key: { customer: "kiln technicians at community pottery studios", wedge: "a weekly glaze stock list export", first_move: "They sold the stock list export to the technician who asked to pay.", pivot: "The booking site; they moved to the stock list export.", key_facts: ["F2", "F3"], mentioned: [] },
};

/** A caller that answers each request with route(req); a null answer comes back as a failed call. Every request is kept. */
export function stubCaller(route: (req: CallRequest) => string | null): Caller & { calls: CallRequest[] } {
  const calls: CallRequest[] = [];
  const call = async (req: CallRequest) => {
    calls.push(req);
    const text = route(req);
    return { text, status: text === null ? 500 : 200, micros: 0, cached: false, problem: text === null ? "stub" : null, served_by: null };
  };
  return Object.assign(call, { calls });
}

const PASS_ALL = JSON.stringify({ a: "pass", b: "pass", c: "pass", d: "pass", e: "pass", r1: "pass", r2: "pass", r3: "pass", foreseeable: { customer: "yes", wedge: "maybe" }, why: [] });

/** Answers every step so the unit passes: the constructed fixture by default, or the real-history fixture. */
export function happy(u: UnitFiles, real = false): (req: CallRequest) => string | null {
  return (req) => {
    const l = req.label;
    if (/:judge:/.test(l)) return real ? '{"identifies": false}' : '{"matches": []}';
    if (/:probe:/.test(l)) return "I don't know.";
    if (/:unanimous:/.test(l)) return blockReply("Sell " + u.key.wedge + " to " + u.key.customer + ".");
    if (/:give-away:/.test(l)) return blockReply("Build the full platform and offer it free to every town.");
    if (/:audit:/.test(l)) return PASS_ALL;
    if (/:type:/.test(l)) return '{"type": "B2B", "stage": "has users"}';
    if (/:founder:/.test(l)) return '{"founder_account": true}';
    if (/:notes/.test(l)) return REAL_NOTES;
    if (/:trace/.test(l)) return JSON.stringify({ t1: "pass", t2: "pass", t3: "pass", t4: "pass", t5: "pass", pointing: u.key.key_facts, opening_date: "2014", first_sale_date: "2015", industry: "pottery studios" });
    if (/:t1/.test(l)) return authorReply({ opening: u.opening, sheet: u.sheet });
    if (/:t2/.test(l)) return authorReply({ key: u.key });
    if (/:(author|rewrite|twin)/.test(l)) return authorReply(u);
    return null;
  };
}

/** Credits a W item when the block's first move holds the key item's words; multi-target never. */
export function wordLabeller(over?: (judge: string, blockId: string) => Partial<Cells> | null | undefined): Labeller & { calls: Parameters<Labeller>[0][] } {
  const calls: Parameters<Labeller>[0][] = [];
  const label: Labeller = async (req) => {
    calls.push(req);
    return new Map(req.blocks.map((b) => {
      const fm = b.block.block.first_move.toLowerCase();
      const base: Cells = { judge: req.judge, model_version: null, effort: req.effort, customer: fm.includes(req.items.customer.toLowerCase()), wedge: fm.includes(req.items.wedge.toLowerCase()), multi_target: false, next: null, alt: null, doubt: null };
      const o = over?.(req.judge, b.id);
      return [b.id, o === null ? null : { ...base, ...o }];
    }));
  };
  return Object.assign(label, { calls });
}

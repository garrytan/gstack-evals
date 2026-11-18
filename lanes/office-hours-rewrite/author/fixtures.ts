// Copyright (c) 2026 Garry Tan. MIT License.
// Invented, neutral fixtures for the rewrite lane's authoring tests and dry-run seams (prereg section 3): a matched pair,
// an unpaired T7 founder, a T8 founder with its prior session and a builder, a scripted caller that answers by request
// label, a block parser for the three-line block, and a labeller that credits a decision holding the key's call and an
// action holding one of its actions. None of it is an eval brief, and no call leaves the process.
import type { CallRequest } from "../../product-value/meter.ts";
import { stubCaller } from "../../office-hours-founder/author/fixtures.ts";
import type { Block, BlockParser, BuilderGoal, Cells, Fact, Labeller, Sheet } from "../types.ts";
import type { BriefFiles } from "./files.ts";
import { GOAL_PHRASE, GOAL_WORDS, PRIOR_DATES } from "./prompts.ts";
import type { Screen } from "../../office-hours-founder/author/screens.ts";
import { buildScreen } from "./screens.ts";

export { stubCaller };

const fact = (id: string, text: string, reveal_when: string, kind: Fact["kind"] = "other"): Fact => ({ id, text, reveal_when, kind });
const NEUTRAL: Fact[] = [
  fact("F4", "My cofounder handles sales and I handle the product.", "Asked about the team."),
  fact("F5", "We have savings for about ten more months.", "Asked about runway.", "constraint"),
  fact("F6", "Most shops I know came through a regional trade fair.", "Asked how I find customers.", "channel"),
  fact("F7", "Shop owners keep appointments in paper diaries today.", "Asked how shops handle this now.", "status-quo"),
  fact("F8", "I spent six years running fittings at my aunt's shop.", "Asked about my background."),
  fact("F9", "The app runs on a tablet at the front desk.", "Asked how the product works."),
  fact("F10", "Two competitors sell general salon booking tools.", "Asked about competitors."),
];
const sheetOf = (persona: string, decisive: Fact[]): Sheet => ({ persona, facts: [...decisive, ...NEUTRAL] });

export const PAIR_OPENING = "I built a fitting scheduler for bridal shops and I think it is time to raise a seed round. Bridal shops juggle fittings, alterations and pickup dates on paper, and brides get double-booked every season. My scheduler puts every fitting on one calendar with text reminders. Everyone at the trade fair loved the demo and several owners asked to stay in touch. I want to know whether I should raise money now or wait.\n";
const PERSONA = "A former bridal shop manager building scheduling software for bridal shops.";
export const FIRST: BriefFiles = {
  opening: PAIR_OPENING,
  sheet: sheetOf(PERSONA, [
    fact("F1", "No shop has used the scheduler with a real bride yet; my three pilots never started.", "Asked whether anyone uses it.", "user"),
    fact("F2", "I have talked to five shop owners in the last month.", "Asked how many customers I talked to.", "demand"),
    fact("F3", "The owners said they would look at it after wedding season.", "Asked how owners reacted.", "reaction"),
  ]),
  key: { call: "Wait to raise; get one shop using it with real brides first", actions: ["get one named shop running real fittings", "charge a pilot shop a real price"], decisive: ["F1"], twin: "d1b", traction: false, wrong_call: null },
  prior: null,
};
export const FIRST_TWIN_CALL = "Raise a small seed round now to serve the shops already paying";
export const SECOND: BriefFiles = {
  opening: PAIR_OPENING,
  sheet: { ...FIRST.sheet, facts: FIRST.sheet.facts.map((f) => (f.id === "F1" ? fact("F1", "Four shops pay me two hundred dollars a month and two asked for more seats.", "Asked whether anyone uses it.", "payment") : f)) },
  key: { call: FIRST_TWIN_CALL, actions: ["book investor meetings with the paying shops as proof", "ask the paying shops for references"], decisive: ["F1"], twin: "d1a", traction: true, wrong_call: null },
  prior: null,
};

export const T7: BriefFiles = {
  opening: "Our team of three builds inventory software for upholstery shops and progress has stalled. Releases slip every month. I think we need a senior engineer to get momentum back, and I want to hire one this quarter. The product tracks fabric rolls, foam and frames, and shops say it saves them a trip to the warehouse.\n",
  sheet: sheetOf("A founder of inventory software for upholstery shops.", [
    fact("F1", "Each release slips because we keep adding a new module before the last one works.", "Asked why releases slip.", "attempt"),
    fact("F2", "Our three shops only use the fabric roll page.", "Asked what customers use most.", "user"),
    fact("F3", "We have started four modules this year and finished none.", "Asked what we are building.", "attempt"),
  ]),
  key: { call: "Don't hire yet; cut the scope to the fabric roll page first", actions: ["drop every module but the fabric roll page", "ship the fabric roll page to the three shops"], decisive: ["F1", "F3"], twin: null, traction: true, wrong_call: "Hire a senior engineer this quarter to speed up releases" },
  prior: null,
};

export const T8: BriefFiles = {
  opening: "I was here last month about my mushroom farm subscription box. We agreed I would test whether restaurants would sign up. I'm back to talk about what comes next, because I have ideas for a second box for home cooks too.\n",
  sheet: sheetOf("A mushroom farmer selling subscription boxes.", [
    fact("F1", "By the test date only one restaurant had signed up, and my test needed five.", "Asked how the test went.", "demand"),
    fact("F2", "The one restaurant cancelled after two boxes.", "Asked about the restaurant that signed.", "reaction"),
    fact("F3", "Home cooks at the market buy loose mushrooms every week.", "Asked who buys today.", "user"),
  ]),
  key: { call: "Change direction as your own test said; stop the restaurant box", actions: ["stop the restaurant box this week", "test the home cook box with market buyers"], decisive: ["F1"], twin: null, traction: false, wrong_call: "Keep the restaurant box and add a second box for home cooks" },
  prior: { date: PRIOR_DATES.date, assignment: "Offer the box to ten restaurants.", test: "five restaurants sign up", test_date: PRIOR_DATES.test_date, condition: "fewer than five restaurants sign up" },
};

export const BUILDER_GOAL: BuilderGoal = "hackathon";
export const BUILDER: BriefFiles = {
  opening: "I want to build a bike repair finder that shows which shops near you can fix a flat today. I'm thinking of a full map with reviews, prices and booking.\n",
  sheet: sheetOf("A student who repairs bikes on weekends.", [
    fact("F1", "My goal is a hackathon entry for this weekend.", "Asked what my goal or mode is for this project."),
    fact("F2", "The hackathon gives teams twenty-four hours and judges a live demo.", "Asked about deadlines.", "constraint"),
    fact("F3", "The judges only have phones at the demo table.", "Asked who will see it.", "constraint"),
  ]),
  key: { call: "Build one phone page that lists shops open now for flats", actions: ["build the phone page first", "skip reviews and booking"], decisive: ["F2", "F3"], twin: null, traction: false, wrong_call: "Build the full map with reviews, prices and booking" },
  prior: null,
};

/** Invented questions in the pinned files' shapes, so the screen runs without a gstack checkout. */
export const FIXTURE_ASKS = [
  "Which neighbor would lend you a ladder on a rainy Sunday?",
  "How many lanterns hang along the harbor wall each winter?",
  "Who repaints the lighthouse door after every storm season?",
  "What song does the ferry captain hum while docking?",
  "Where do the gulls nest when the pier is closed?",
  "Why does the bakery bell ring twice at dawn?",
];
export const FIXTURE_SCREEN: Screen = buildScreen(FIXTURE_ASKS);

const fenced = (name: string, body: string) => "### " + name + "\n~~~\n" + body.trim() + "\n~~~\n";
/** An author's reply holding the files a role writes. */
export const authorReply = (b: BriefFiles, o: { opening?: boolean; twinCall?: string } = {}): string => {
  const { twin: _t, wrong_call, ...key } = b.key;
  const k = { ...key, ...(wrong_call ? { wrong_call } : {}), ...(o.twinCall ? { twin_call: o.twinCall } : {}) };
  return "Here are the files.\n\n" + (o.opening === false ? "" : fenced("opening.md", b.opening)) + fenced("sheet.json", JSON.stringify(b.sheet, null, 2)) + fenced("key.json", JSON.stringify(k, null, 2)) + (b.prior ? fenced("prior.json", JSON.stringify(b.prior, null, 2)) : "");
};
export const blockReply = (decision: string, action: string) => "My advice.\n\nDECISION: " + decision + ".\nNEXT ACTION: " + action + ", by Friday.\nWHY: the facts you gave.";

/** A block parser for the fixtures: the last DECISION, NEXT ACTION and WHY lines. The score area ships the real one. */
export const fixtureParser: BlockParser = (text) => {
  const get = (label: string) => [...text.matchAll(new RegExp("^" + label + ":\\s*(.+)$", "gm"))].at(-1)?.[1]?.trim() ?? null;
  const decision = get("DECISION"), next_action = get("NEXT ACTION"), why = get("WHY");
  if (!decision || !next_action || !why) return { kind: "no-block", reason: "no three-line block", body_sha256: null };
  const block: Block = { decision, next_action, why };
  return { kind: "block", block, cut: { decision: false, next_action: false, why: false }, body_sha256: "" };
};

/** Credits a decision that holds the key's call and not the contrast, and an action that holds one of the key's actions. */
export function wordLabeller(over?: (req: Parameters<Labeller>[0], blockId: string) => Partial<Cells> | null | undefined): Labeller & { calls: Parameters<Labeller>[0][] } {
  const calls: Parameters<Labeller>[0][] = [];
  const has = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());
  const label: Labeller = async (req) => {
    calls.push(req);
    return new Map(req.blocks.map((b) => {
      const base: Cells = { decision: has(b.block.decision, req.items.call) && !has(b.block.decision, req.items.contrast), action: req.items.actions.some((a) => has(b.block.next_action, a)), model_version: null };
      const o = over?.(req, b.id);
      return [b.id, o === null ? null : { ...base, ...o }];
    }));
  };
  return Object.assign(label, { calls });
}

const PASS_ALL = JSON.stringify({ a: "pass", b: "pass", c: "pass", d: "pass", e: "pass", f: "pass", why: [] });

/** Answers every step so each brief passes, reading the brief a label names from briefs (by id or by role). */
export function happy(briefs: Readonly<Record<string, BriefFiles>>, twinCalls: Readonly<Record<string, string>> = {}): (req: CallRequest) => string | null {
  return (req) => {
    const l = req.label;
    const id = l.split(":")[0]!.replace(/\.\d+$/, "");
    const b = briefs[id] ?? briefs[id.replace(/^d\d+/, "d")] ?? null;
    if (/:judge:/.test(l)) return '{"matches": []}';
    if (/:probe:/.test(l)) return "I don't know.";
    if (/:audit:/.test(l)) return PASS_ALL;
    if (!b) return null;
    if (/:unanimous:/.test(l)) return blockReply(b.key.call, b.key.actions[0]!);
    if (/:give-away:/.test(l)) return blockReply(b.key.wrong_call ?? "Keep going as planned", "keep going as planned");
    if (/:(author|rewrite)/.test(l)) return authorReply(b, { opening: !/b$/.test(id), twinCall: twinCalls[id] });
    return null;
  };
}

/** The builder fixture for any goal: its goal fact names that goal. */
export const builderFor = (goal: BuilderGoal): BriefFiles => ({ ...BUILDER, sheet: { ...BUILDER.sheet, facts: BUILDER.sheet.facts.map((f) => (f.id === "F1" ? { ...f, text: "My goal for this project is " + GOAL_WORDS[goal][0] + "." } : f)) } });

/**
 * A caller for whole runs: it answers each author prompt with the fixture of its kind (a builder of the prompt's goal, T8,
 * a first twin, a flipped twin, or T7), remembers which brief each id holds, and answers that brief's validators. Second
 * twins fail the twin check (they repeat the partner's call) when secondFails(n) holds for the n-th second-twin draft.
 * drafts counts author calls, so spent can charge a fixed amount a draft.
 */
export function runCaller(o: { secondFails?: (n: number) => boolean } = {}) {
  const byId = new Map<string, BriefFiles>();
  let seconds = 0;
  const state = { drafts: 0 };
  const call = stubCaller((req) => {
    const l = req.label;
    const id = l.split(":")[0]!.replace(/\.\d+$/, "");
    if (/:judge:/.test(l)) return '{"matches": []}';
    if (/:probe:/.test(l)) return "I don't know.";
    if (/:audit:/.test(l)) return PASS_ALL;
    if (/:(author|rewrite):/.test(l)) {
      if (/:author:1$/.test(l)) state.drafts++;
      if (req.prompt.includes("Write this founder's twin")) {
        const fail = /:author:1$/.test(l) && o.secondFails?.(++seconds);
        const b = fail ? { ...SECOND, key: { ...SECOND.key, call: FIRST.key.call } } : SECOND;
        byId.set(id, b);
        return authorReply(b, { opening: false });
      }
      const goal = (Object.keys(GOAL_PHRASE) as BuilderGoal[]).find((g) => req.prompt.includes("Invent a person building " + GOAL_PHRASE[g] + " "));
      const b = goal ? builderFor(goal) : req.prompt.includes("set a test due") ? T8 : req.prompt.includes("has a twin") ? FIRST : T7;
      byId.set(id, b);
      return authorReply(b, { twinCall: b === FIRST ? FIRST_TWIN_CALL : undefined });
    }
    const b = byId.get(id);
    if (!b) return null;
    if (/:unanimous:/.test(l)) return blockReply(b.key.call, b.key.actions[0]!);
    if (/:give-away:/.test(l)) return blockReply(b.key.wrong_call ?? "Keep going as planned", "keep going as planned");
    return null;
  });
  return Object.assign(call, { state });
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's frozen authoring text (prereg section 3, "Founder types", "Builder briefs", "Authoring
// and validation", "Key", "Unanimous key" and "Give-away screen"; section 14's reuse list; pre-run change 1 items 4d and
// 4e). The type table's openings and contrasts are the prereg's words; every other string here is a build-time choice the
// area README lists: the skins, the builder domains, the founder anti-pattern surfaces, the author prompts, the
// full-information and opening-only prompts, the audit, the rewrite note and the prior-session dates. Authors get only
// these strings; no author prompt carries skill text.
import { CLOSING, firstMessage } from "../frozen.ts";
import type { BuilderGoal, FounderType, PriorSession, Sheet } from "../types.ts";
import { fence } from "../../office-hours-founder/author/prompts.ts";

export { NAMED_TERMS, PROBE, PROBE_REWRITE, fence, rewritePrompt } from "../../office-hours-founder/author/prompts.ts";

/** Section 3's type table: the shared opening and the hidden contrast between twins, in the prereg's words. */
export const TYPES: Readonly<Record<FounderType, { opening: string; contrast: string }>> = {
  T1: { opening: "asks whether to raise money now", contrast: "no real outcome yet, or paying customers" },
  T2: { opening: "cites strong validation", contrast: "signups or an unpriced letter of intent, or a priced contract or prepayment" },
  T3: { opening: "asks what to do next", contrast: "a few customer conversations, or many conversations and nobody using it" },
  T4: { opening: "worries the market is too small", contrast: "buyers times price falls short of the founder's goal, or clears it" },
  T5: { opening: "runs two ideas at once", contrast: "the ideas share a prerequisite, or they don't" },
  T6: { opening: "asks whether to pivot", contrast: "customers don't love it, or the market is too small" },
  T7: { opening: "wants to hire to fix momentum", contrast: "the hire would not fix a scoping problem" },
  T8: { opening: "returns after setting a test last time", contrast: "the test's date has passed and its condition failed" },
};

/** A paired type's two sides: the contrast split at ", or ". Side 0 and side 1 call for opposite decisions. */
export const sides = (t: FounderType): readonly [string, string] => {
  const [a, b] = TYPES[t].contrast.split(", or ");
  return [a!, b!];
};

/**
 * The founder anti-patterns the rewrite names (build-time choice: read from office-hours/ at gstack 0787a1e and confirmed at the new pin 4afa7f2, sections
 * phase-2a-startup-diagnostic, phase-2c-pivot-discovery and design-and-handoff). Each opening carries one as its surface.
 * surface is the only part an author sees: our own words, never the skill's. source cites where the rewrite names it.
 */
export const ANTI_PATTERNS: readonly { id: string; surface: string; source: string }[] = [
  { id: "interest-as-demand", surface: "treats signups, a waitlist or people saying it sounds interesting as proof that people want it", source: "2a operating principles; Q1 red flags; response posture" },
  { id: "hypothetical-users", surface: "talks about the users they expect to have rather than anyone using it now", source: "2a response posture" },
  { id: "solution-seeking-problem", surface: "started from a technology they love and is still working out who needs it", source: "2a response posture" },
  { id: "launch-anxiety", surface: "keeps putting off the launch until it is polished, worried a bigger company will copy it", source: "2a response posture; pushback pattern 6" },
  { id: "stuck-writing-docs", surface: "has spent weeks writing plans and specs instead of putting anything in front of people", source: "design-and-handoff resource matching (overthinking, not shipping)" },
  { id: "category-customer", surface: "describes the customer as a broad category rather than a person they could email today", source: "2a pushback pattern 1; Q3 red flags" },
  { id: "praise-as-proof", surface: "leans on friends and contacts saying they love the idea", source: "2a pushback pattern 2" },
  { id: "platform-first", surface: "insists the whole platform has to exist before anyone can get value from it", source: "2a pushback pattern 3; Q4 red flags" },
  { id: "market-growth", surface: "points to how fast the overall market is growing as the reason it will work", source: "2a pushback pattern 4; Q6 red flags" },
  { id: "vague-terms", surface: "describes the product in feel-good words like seamless or smarter without saying what changes for anyone", source: "2a pushback pattern 5" },
  { id: "premature-strategy", surface: "is busy with pricing, fundraising or competitor plans before anyone uses the product", source: "2a reality check; pushback pattern 6" },
  { id: "two-directions", surface: "splits the week between two customer groups and can't drop either", source: "2a pushback pattern 7" },
  { id: "hire-for-momentum", surface: "believes the next hire will fix slow progress", source: "2a pushback pattern 8" },
  { id: "consultancy-in-disguise", surface: "does the work by hand for each customer and calls it a software product", source: "2a pushback pattern 9" },
  { id: "architecture-answer", surface: "answers questions about who will buy with details of the technical design", source: "2a Q4 red flags" },
  { id: "no-current-alternative", surface: "says nobody does anything about the problem today, so the field is wide open", source: "2a Q2 red flags" },
  { id: "survey-validation", surface: "counts a survey and a few demo calls as validation", source: "2a Q5 red flags" },
  { id: "unpriced-letters", surface: "counts letters of intent that name no price as strong validation", source: "2a operating principles (evidence ranking)" },
  { id: "love-or-size", surface: "can't say whether the worry is that customers are lukewarm or that there are too few of them", source: "2c pivot flow, step 1" },
  { id: "sunk-cost", surface: "can't let go of the work already built", source: "2c pivot flow, step 2" },
  { id: "protecting-revenue", surface: "won't risk the few customers who pay a little today", source: "2c pivot flow, steps 3 and 4" },
];

/** A skin: one founder voice, an industry per founder type, and a project domain per builder goal (build-time choice). */
export interface Skin {
  voice: string;
  industries: Readonly<Record<FounderType, string>>;
  domains: Readonly<Record<BuilderGoal, string>>;
}

/** SKINS[1] to SKINS[5] are the comparison set's five skins; SKINS[0] serves calibration and SKINS[6] the reserves. */
export const SKINS: readonly Skin[] = [
  {
    voice: "dry and precise, wary of hype",
    industries: { T1: "locksmiths", T2: "cheese makers", T3: "rowing clubs", T4: "harp makers", T5: "bowling alleys", T6: "swim schools", T7: "upholstery shops", T8: "brewing supply stores" },
    domains: { hackathon: "a bike repair finder", "open-source": "a log file viewer", research: "coral photo counting", learning: "a regex engine", fun: "a maze generator" },
  },
  {
    voice: "warm and talkative, with asides about the people involved",
    industries: { T1: "bridal shops", T2: "school bus operators", T3: "community theaters", T4: "beekeeping suppliers", T5: "self-storage operators", T6: "language schools", T7: "boat repair yards", T8: "tattoo studios" },
    domains: { hackathon: "a transit arrival board", "open-source": "a recipe file format", research: "bird song clustering", learning: "a toy database engine", fun: "a pixel-art garden game" },
  },
  {
    voice: "terse and numbers-first, in short sentences",
    industries: { T1: "commercial laundries", T2: "dairy farms", T3: "funeral homes", T4: "orchestra management", T5: "car washes", T6: "physical therapy clinics", T7: "print shops", T8: "solar installers" },
    domains: { hackathon: "a flood alert map", "open-source": "a terminal calendar", research: "river sediment imaging", learning: "a ray tracer", fun: "a card game for two" },
  },
  {
    voice: "formal and careful, hedging each claim",
    industries: { T1: "court reporting firms", T2: "elevator maintenance", T3: "chess clubs", T4: "glassblowing studios", T5: "vineyards", T6: "driving schools", T7: "translation agencies", T8: "pest control companies" },
    domains: { hackathon: "a food bank volunteer scheduler", "open-source": "a static site generator plugin", research: "sleep sound classification", learning: "a compiler for a tiny language", fun: "a music toy for kids" },
  },
  {
    voice: "excited and fast, jumping between ideas",
    industries: { T1: "climbing gyms", T2: "bakeries", T3: "piano tuners", T4: "taxidermy studios", T5: "marinas", T6: "escape rooms", T7: "catering companies", T8: "plant nurseries" },
    domains: { hackathon: "a lost-and-found board for festivals", "open-source": "a markdown table formatter", research: "traffic noise mapping", learning: "a chat server from scratch", fun: "a dice-rolling bot" },
  },
  {
    voice: "plain and tired, a founder who has tried many things",
    industries: { T1: "roofing contractors", T2: "dog groomers", T3: "public libraries", T4: "violin makers", T5: "ski rental shops", T6: "tutoring centers", T7: "sign makers", T8: "flower farms" },
    domains: { hackathon: "a clinic wait-time display", "open-source": "a backup checker", research: "leaf disease detection", learning: "a key-value store", fun: "a weather haiku generator" },
  },
  {
    voice: "blunt and impatient, sure of the plan",
    industries: { T1: "moving companies", T2: "kombucha brewers", T3: "sailing schools", T4: "organ builders", T5: "laundromats", T6: "pottery studios", T7: "framing shops", T8: "mushroom farms" },
    domains: { hackathon: "a shelter bed tracker", "open-source": "a font subsetting tool", research: "glacier melt timing", learning: "a spreadsheet formula parser", fun: "a sticker trading game" },
  },
];

/** Section 3's builder goals as an author reads them. */
export const GOAL_PHRASE: Readonly<Record<BuilderGoal, string>> = {
  hackathon: "a hackathon entry",
  "open-source": "an open source project",
  research: "a research project",
  learning: "a project to learn something",
  fun: "a project for fun",
};
/** Words the goal fact must hold, whole, for its goal (pre-run change 1 item 4e, the builder file's rule 9). */
export const GOAL_WORDS: Readonly<Record<BuilderGoal, readonly string[]>> = {
  hackathon: ["hackathon"],
  "open-source": ["open source"],
  research: ["research"],
  learning: ["learn", "learning"],
  fun: ["fun"],
};
/** A goal fact's reveal_when must cover a goal or mode question: it holds one of these words. */
export const GOAL_QUESTION_WORDS: readonly string[] = ["goal", "mode"];
export const GOAL_REVEAL = "Asked what my goal or mode is for this project.";

/** T8's prior session dates (build-time choice): both before authoring, so the test's date has passed at every session. */
export const PRIOR_DATES = { date: "2026-10-06", test_date: "2026-11-03" } as const;

const FACTS_SPEC =
  'sheet.json: {"persona": one line of at most 30 words on who the person is, "facts": [{"id": "F1", "text": one fact the person knows, in the first person, at most 40 words, "reveal_when": the kind of question that would draw it out, in plain words, at most 20 words, "kind": one of demand, payment, user, status-quo, attempt, reaction, channel, constraint, other}]}, with 10 to 16 facts.';
const INVENT = "Invent the names, places and numbers, and don't base the story on any real company you know of. State nothing that happens after the opening message is sent.";
const OPENING_SPEC = "opening.md: the first message to an advisor, in the first person, 150 to 300 words, in the voice given above.";
const KEY_HEAD = '"call": the decision the facts support, one line of at most 25 words; "actions": 2 to 4 acceptable next actions, each a class of action of at most 15 words, specific to this person; "decisive": the ids of the decisive facts; ';
const WRONG_CALL = '"wrong_call": one plausible decision that a reader of the opening alone might make and that the hidden facts rule out, one line of at most 25 words';

const founderHead = (t: FounderType, skin: Skin, antiPattern: string): string =>
  "Invent a startup founder for a test of business advisors. The founder " + TYPES[t].opening + ". Industry: " + skin.industries[t] + ". Voice: " + skin.voice + ". In the opening the founder also " + antiPattern + ".";

/** The first twin of a matched pair (T1 to T6). The author also names the opposite call its twin's facts will need. */
export const pairPrompt = (t: FounderType, side: 0 | 1, skin: Skin, antiPattern: string): string =>
  founderHead(t, skin, antiPattern) +
  " This founder has a twin who sends the same opening word for word. The twins differ in one hidden fact that calls for the opposite decision. In this founder's hidden facts: " + sides(t)[side] + ". In the twin's: " + sides(t)[1 - side] + ". Write three files. " + OPENING_SPEC +
  " It must read as true for both twins, so it reveals neither side of that fact. " + FACTS_SPEC +
  " 1 or 2 of them are decisive: they show this founder's side of the hidden fact and settle the decision. Every other fact must be true of both twins. No fact may state the answer or recommend anything. key.json: {" + KEY_HEAD +
  '"traction": true if the founder has a named payer or user, else false; "twin_call": the opposite decision the twin\'s facts would support, one line of at most 25 words}. ' + INVENT;

/** The flipped twin: the pair's author family writes its sheet and key; the opening is the partner's, word for word. */
export const twinPrompt = (t: FounderType, side: 0 | 1, opening: string, sheet: Sheet, decisive: readonly string[], twinCall: string): string =>
  "Below are the opening message and fact sheet of an invented startup founder for a test of business advisors. Write this founder's twin, who sends the same opening word for word. In the twin's hidden facts: " + sides(t)[1 - side] + ". So the twin's facts call for this decision instead: " + twinCall +
  " Keep the persona and every fact with the same id and the same text, except the decisive facts " + decisive.join(" and ") + ": rewrite those, with the same ids, so they show the twin's side and settle the twin's decision. No fact may state the answer or recommend anything. Write two files, sheet.json and key.json, in the same shapes as below. key.json: {" + KEY_HEAD +
  '"traction": true if the twin has a named payer or user, else false}.' + "\n\n" + fence("opening.md", opening.trim()) + "\n\n" + fence("sheet.json", JSON.stringify(sheet, null, 2));

/** An unpaired founder brief (T7, and T8 with its prior session). */
export const unpairedPrompt = (t: FounderType, skin: Skin, antiPattern: string): string => {
  const prior = t === "T8";
  return (
    founderHead(t, skin, antiPattern) + " The hidden facts show that " + TYPES[t].contrast + "." +
    (prior ? " The founder met an advisor on " + PRIOR_DATES.date + " and set a test due on " + PRIOR_DATES.test_date + "; the opening says they were here before, and how the test came out is a hidden fact." : "") +
    " Write " + (prior ? "four" : "three") + " files. " + OPENING_SPEC + " It must not reveal the decisive facts. " + FACTS_SPEC +
    " 1 or 2 of them are decisive: they settle the decision. No fact may state the answer or recommend anything. key.json: {" + KEY_HEAD + '"traction": true if the founder has a named payer or user, else false; ' + WRONG_CALL + "}." +
    (prior ? ' prior.json: {"date": "' + PRIOR_DATES.date + '", "assignment": the one thing the founder agreed to do, at most 30 words; "test": the test the founder set, at most 25 words; "test_date": "' + PRIOR_DATES.test_date + '", "condition": the result that would mean change direction, at most 25 words}.' : "") +
    " " + INVENT
  );
};

/** An unpaired builder brief: one hidden fact shapes what to build first, and one fact states the goal (item 4e). */
export const builderPrompt = (goal: BuilderGoal, skin: Skin): string =>
  "Invent a person building " + GOAL_PHRASE[goal] + " for a test of advisors: " + skin.domains[goal] + ". They are not building a startup. Voice: " + skin.voice +
  ". One hidden fact, such as a deadline, a platform limit, an audience or a learning goal, should shape what they build first. Write three files. " + OPENING_SPEC + " It says what they want to build and must not reveal that fact. " + FACTS_SPEC +
  ' One fact states the goal in plain words, using the word "' + GOAL_WORDS[goal][0] + '", with reveal_when "' + GOAL_REVEAL + '" 1 or 2 others are decisive: they shape what to build first. No fact may state the answer or recommend anything. key.json: {"call": what to build first, one line of at most 25 words; "actions": 2 to 4 acceptable first steps, each at most 15 words; "decisive": the ids of the decisive facts; "traction": false; "wrong_call": one plausible first build that a reader of the opening alone might choose and that the hidden facts rule out, one line of at most 25 words}. ' + INVENT;

/** The line before the facts in the full-information prompt, the closing request and the answer-now line (build-time). */
export const FACTS_LINE = "Everything else I know, in no particular order:";
export const REQUEST = CLOSING.slice(CLOSING.indexOf("Please"));
export const ANSWER_NOW = "Answer in this one reply. I can't answer questions, so decide with what you have.";

/** T8's prior session as a validator reads it: the most a skill arm sees before it asks. */
export const priorLine = (p: PriorSession): string =>
  "Last time we met, on " + p.date + ", I agreed to this: " + p.assignment.trim() + " My test: " + p.test.trim() + ", by " + p.test_date + ". If " + p.condition.trim() + ", I change direction.";

/** Section 3's unanimous key: the none arm's first message, every fact, the closing request and the answer-now line. */
export const fullInformation = (opening: string, facts: readonly string[], prior: PriorSession | null): string =>
  firstMessage("none", opening) + "\n\n" + (prior ? priorLine(prior) + "\n\n" : "") + FACTS_LINE + "\n" + facts.map((f) => "- " + f.trim()).join("\n") + "\n\n" + REQUEST + "\n" + ANSWER_NOW;

/** Section 3's give-away screen: the same message with the opening alone (and T8's prior session). */
export const openingOnly = (opening: string, prior: PriorSession | null): string =>
  firstMessage("none", opening) + "\n\n" + (prior ? priorLine(prior) + "\n\n" : "") + REQUEST + "\n" + ANSWER_NOW;

/** The blind audit's checks (build-time), modelled on the founder lane's (a) to (e). */
export const AUDIT_CHECKS = {
  a: "No fact states the answer outright or gives advice.",
  b: "The decisive facts support the key's call and rule out the contrast call, and a reader without them could plausibly make the contrast call.",
  c: "The opening reveals neither the decisive facts nor the call.",
  d: "Every fact is something the person would know when sending the opening, and nothing happens after it.",
  e: "The brief reads as plausible and mentions no advisor's method, YC, gstack, office hours or any advisor's wording.",
  f: "The opening carries the stated surface trait.",
} as const;
export type AuditCheck = keyof typeof AUDIT_CHECKS;

const checkList = Object.entries(AUDIT_CHECKS).map(([k, v]) => "(" + k + ") " + v).join("\n");

export const auditPrompt = (files: string, contrast: string, surface: string | null): string =>
  "Audit this invented brief, written for a test of advisors. Its files follow, then its contrast call and its surface trait. Check each of these and mark it pass or fail:\n" + checkList +
  '\n\nReply with a JSON object only: {"a": "pass" or "fail", "b": ..., "c": ..., "d": ..., "e": ..., "f": ..., "why": one line per failed check}.\n\n' + files + "\n\n" + fence("contrast call", contrast) + "\n\n" + fence("surface trait", surface ?? "none: mark (f) pass");

/** Section 3's one rewrite: the writer's first prompt, its current files, then this note and the failed checks. */
export const REWRITE_NOTE = "Your files above failed these checks. Rewrite every file you wrote so it passes them, and keep everything else the prompt asks for:";

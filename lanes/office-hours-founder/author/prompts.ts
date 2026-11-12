// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's authoring text (prereg wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg,
// section 3). The frozen part appears in the prereg byte for byte and tests/of/author/prompts.test.ts checks each string:
// the story shapes, the four type phrases, the industries in their frozen order, the author prompt and its CEILING line,
// the twin note, the recognition probe and its rewrite line, the real stratum's 40 queries and left-out hosts, and the
// source-note, T1 and T2 prompts. The rest is build-time text the prereg describes but does not word (the audits, the
// probe judges, the type labels, the founder-account test, the rewrite note and the twin translation); the README lists
// each as a build-time choice.
import type { Key, ProjectType, Sheet, Shape } from "../types.ts";

/** Section 3's story shapes. s2 and s6 take only the consumer and marketplace types. */
export const SHAPES: Readonly<Record<Shape, string>> = {
  s1: "The founder pitches a broad platform for many kinds of customer; one kind already uses an early version heavily and has asked to pay for one part of it.",
  s2: "The founder pitches to consumers; the people who have offered to pay are businesses, for a narrower use.",
  s3: "The founder pitches one product; users keep using a side feature in a way the founder didn't plan, and some have asked for it alone.",
  s4: "The founder has free users and no payer; one kind of user spends money today on a workaround the product could replace.",
  s5: "The founder's pitch names only a broad category of customer; the evidence picks out one specific kind within it, and the offering stays the same in substance (pivot none).",
  s6: "The founder pitches a marketplace; one side shows demand and would pay for a one-sided tool first.",
};
export const SHAPE_TYPES: Readonly<Record<Shape, readonly NamedType[]>> = {
  s1: ["B2B", "consumer", "marketplace", "developer tools"],
  s2: ["consumer", "marketplace"],
  s3: ["B2B", "consumer", "marketplace", "developer tools"],
  s4: ["B2B", "consumer", "marketplace", "developer tools"],
  s5: ["B2B", "consumer", "marketplace", "developer tools"],
  s6: ["consumer", "marketplace"],
};

export type NamedType = Exclude<ProjectType, "other">;
export const NAMED_TYPES: readonly NamedType[] = ["B2B", "consumer", "marketplace", "developer tools"];

/** The types as the author is told them. */
export const TYPE_PHRASE: Readonly<Record<NamedType, string>> = {
  B2B: "a product that organizations would pay for",
  consumer: "a product people would use for themselves",
  marketplace: "a marketplace that matches two sides",
  "developer tools": "a tool for software developers",
};

/** The industries in their frozen order; a twin moves to the next one. */
export const INDUSTRIES: readonly string[] = ["dental practices", "freight trucking", "K-12 schools", "restaurants", "home building", "insurance brokerage", "veterinary clinics", "property management", "small law firms", "farming", "fitness studios", "event venues", "home care agencies", "accounting firms", "contract manufacturing", "independent pharmacies", "hotels", "nonprofits", "warehousing", "auto repair", "recruiting agencies", "museums", "city governments", "film production"];

export const AUTHOR_PROMPT = "Invent a startup founder for a test of business advisors. Story shape: <shape>. The founder pitches <type>. Industry: <industry>. Write three files. opening.md: the founder's first message to an advisor, in the first person, 150 to 300 words, saying what they want to build and why, the way a founder who believes in their plan would say it. sheet.json: {\"persona\": one line of at most 30 words on who the founder is, \"facts\": [{\"id\": \"F1\", \"text\": one fact the founder knows, in the first person, at most 40 words, \"reveal_when\": the kind of question that would draw it out, in plain words, at most 20 words, \"kind\": one of demand, payment, user, status-quo, attempt, reaction, channel, constraint, other}]}, with 10 to 16 facts: 4 to 6 that together point to one specific kind of customer and one specific offering they would pay for first, as the story shape says; 2 to 4 that point toward a plausible but weaker alternative; and the rest neutral. No fact may state the answer outright or recommend anything, and opening.md must not reveal what the 4 to 6 facts show. key.json: {\"customer\": the kind of person or organization the facts show would pay first, at most 25 words; \"wedge\": the specific offering they would pay for first, at most 25 words; \"first_move\": the concrete first step the facts support toward that first sale, at most 30 words; \"pivot\": the part of the opening plan the facts contradict and the direction they point, at most 30 words, or \"none\"; \"key_facts\": the ids of the facts that point to the customer or the offering; \"mentioned\": the names of any of customer and wedge that opening.md already names as part of the plan; \"alternative\": {\"customer\": the customer the 2 to 4 alternative facts point toward, a different kind of customer from the key's, at most 25 words, \"wedge\": the offering they point toward, a different offering from the key's, at most 25 words}}. Invent the company, names, places and nu... (line truncated to 2000 chars)

export const NOTES_PROMPT = "Below are public accounts of one company's early history. Write two notes in your own words, copying no sentence. Note A, before the turn: what the founders set out to build first, as they described it then, and every fact they knew before the first sale of the offering that later worked: who used what and how often, who paid or offered to pay and for what, what those people did before, what the founders tried and what happened, what people said when shown it, and any numbers, each as one line with the date or stage it belongs to. Note B, the turn and after: who paid first (a specific kind of customer) and what they paid for, the offering that first got traction, whether and how the founders changed course from the opening plan, and the concrete action that led to the first sale, each as one line with its date. Put a fact in Note A only if the accounts show the founders knew it before that first sale. Leave out every person's name. On a last line headed \"Names\", list the company's names, its products' names and its founders' names. If the accounts can't support Note B's customer and offering, or Note A has fewer than 4 facts or fewer than 2 that point toward that customer or offering, write only \"INELIGIBLE\" and the reason.";

export const T1_PROMPT = "Invent a new startup in a different industry from the source below, with new names, customers, places and numbers, so that no reader could recognize the source. Keep the shape of the story: the same kind of opening plan, the same kinds of customers and evidence, and the same relationships between them, translated into the new industry. Then write two files for the new startup. opening.md: the founder's first message to an advisor, in the first person, 150 to 300 words, saying what they want to build and why, as the founder in the note would have said it at the time, and nothing that founder would not volunteer in a first message. sheet.json: {\"persona\": one line of at most 30 words on who the founder is, \"facts\": [{\"id\": \"F1\", \"text\": one fact the founder knows, in the first person, at most 40 words, \"reveal_when\": the kind of question that would draw it out, at most 20 words, \"kind\": one of demand, payment, user, status-quo, attempt, reaction, channel, constraint, other}]}, one fact for each line of the note that opening.md does not already state, at most 16 facts in all. Copy no sentence, name or number from the source. Add no fact the note doesn't support, and state nothing that happened after the founder sends the opening message.";

export const T2_PROMPT = "Below are a note on what happened next in a real startup's history and an invented startup re-skinned from that history: its opening message and fact sheet. Write the invented startup's key, in its industry and with its names, as a JSON object whose items are observed facts: \"customer\", who paid first, as a specific kind of person or organization, at most 25 words; \"wedge\", what they paid for first, as a specific offering, at most 25 words; \"first_move\", the concrete action the founders took that led to that first sale, at most 30 words; \"pivot\", the part of the opening plan that the history proved wrong and the direction the founders moved, at most 30 words, or \"none\"; \"key_facts\", the ids of the sheet's facts that point toward the customer or the wedge; \"mentioned\", the names of any of customer and wedge that the opening message already names as part of the founder's plan. Translate each item from the note's events one to one, and invent no outcome. Copy no sentence, name or number from the source.";

/** Section 10's CEILING reading: R61's one harder variant adds this line to the author prompt. */
export const CEILING_LINE = "Each fact that points to the customer or the offering comes out only when asked about directly, and at least 3 facts point toward one plausible alternative.";

/** Section 3's twin note. */
export const TWIN_NOTE = "Keep every fact's meaning and role; change the industry, names, places and numbers.";

/** Section 3's recognition probe, said in both of its prompts, and the line added when a unit goes back to its writer. */
export const PROBE = "This may be a disguised version of a real company's early history. Name the real company, with up to three guesses, or say you don't know.";
export const PROBE_REWRITE = "Choose an industry and a story different from this one: <industry>.";

/** Section 3's six named terms of the skill, barred by the vocabulary screen. */
export const NAMED_TERMS: readonly string[] = ["demand reality", "status quo", "desperate specificity", "narrowest wedge", "observation and surprise", "future-fit"];

/** The real stratum's frame: 40 queries, the first 10 results of each, and the hosts left out. */
export const QUERIES: readonly string[] = QUERIES_JSON;
export const EXCLUDED_HOSTS: readonly string[] = ["linkedin.com", "medium.com", "substack.com", "indiehackers.com", "hackernoon.com", "reddit.com", "ycombinator.com", "firstround.com", "starterstory.com", "techcrunch.com", "quora.com", "youtube.com", "x.com", "twitter.com", "facebook.com", "wikipedia.org"];
export const RESULTS_PER_QUERY = 10;
export const PAGES_PER_SOURCE = 3;

/** The author prompt for one draw position. A developer tool's industry slot names the teams that build software for it. */
export function authorPrompt(shape: Shape, type: NamedType, industry: string, ceiling: boolean): string {
  const slot = type === "developer tools" ? "teams that build software for " + industry : industry;
  const p = AUTHOR_PROMPT.replace("<shape>", SHAPES[shape].replace(/\.$/, "")).replace("<type>", TYPE_PHRASE[type]).replace("<industry>", slot);
  return ceiling ? p + " " + CEILING_LINE : p;
}

export const fence = (name: string, body: string): string => name + ":\n~~~~\n" + body.replace(/~~~~/g, "~~~") + "\n~~~~";
export const unitText = (opening: string, sheet: Sheet, key?: Key): string =>
  [fence("opening.md", opening.trim()), fence("sheet.json", JSON.stringify(sheet, null, 2)), ...(key ? [fence("key.json", JSON.stringify(key, null, 2))] : [])].join("\n\n");

/** Section 3's rewrite: the prompt the writer first had, its current files, then a note. */
export const REWRITE_NOTE = "Your files above failed these checks. Rewrite every file so it passes them, and keep everything else the prompt asks for:";
export const rewritePrompt = (prompt: string, files: string, note: string): string => prompt + "\n\n" + files + "\n\n" + note;

/** The twin translation, sent to the author family that did not write the first skin. */
export const twinPrompt = (industry: string, opening: string, sheet: Sheet, key: Key): string =>
  "Below are the three files of an invented startup for a test of business advisors. Translate them into a startup in this industry: " + industry + ". " + TWIN_NOTE + " Write the same three files, opening.md, sheet.json and key.json, with the same JSON fields and the same fact ids.\n\n" + unitText(opening, sheet, key);

/** Section 3 step 5's blind audit checks, (a) to (e). */
export const AUDIT_CHECKS = {
  a: "No fact states the answer outright or gives advice.",
  b: "The key facts point to the key, and the alternative facts point elsewhere: the alternative names a different kind of customer and a different offering from the key's.",
  c: "The opening names neither the key's customer nor its wedge, unless key.json lists it under mentioned.",
  d: "Every fact is something the founder would know at the opening, and nothing happens after it.",
  e: "The unit reads as a plausible startup and mentions no advisor's method, YC, gstack, office hours or any advisor's wording.",
} as const;
export type AuditCheck = keyof typeof AUDIT_CHECKS;

const checkList = (checks: Readonly<Record<string, string>>) => Object.entries(checks).map(([k, v]) => "(" + k + ") " + v).join("\n");

export const auditPrompt = (files: string): string =>
  "Audit this invented startup, written for a test of business advisors. Its files follow. Check each of these and mark it pass or fail:\n" + checkList(AUDIT_CHECKS) +
  '\n\nReply with a JSON object only: {"a": "pass" or "fail", "b": ..., "c": ..., "d": ..., "e": ..., "why": one line per failed check}.\n\n' + files;

/** Section 3 step 6 (real stratum): traceability, by Opus, reading both notes and the unit. */
export const TRACE_CHECKS = {
  t1: "Each fact on the sheet follows from a line of Note A.",
  t2: "Each key item follows from an event in Note B.",
  t3: "Each key fact points toward the customer or the wedge.",
  t4: "No fact states anything that happened after the opening message.",
  t5: "The opening names neither the customer nor the wedge, unless key.json lists it under mentioned.",
} as const;
export type TraceCheck = keyof typeof TRACE_CHECKS;
/** The traceability checks that read only the key, so a failure on them alone rewrites from T2. */
export const KEY_TRACE_CHECKS: readonly TraceCheck[] = ["t2", "t3"];

export const tracePrompt = (noteA: string, noteB: string, files: string): string =>
  "Below are two notes on a real startup's early history and an invented startup re-skinned from it. Check each of these and mark it pass or fail:\n" + checkList(TRACE_CHECKS) +
  '\n\nReply with a JSON object only: {"t1": "pass" or "fail", "t2": ..., "t3": ..., "t4": ..., "t5": ..., "pointing": the ids of the key facts that point toward the customer or the wedge, "opening_date": the date or stage of the opening plan in the notes, "first_sale_date": the date of the first sale in the notes, "industry": the invented startup's industry in a few words, "why": one line per failed check}.\n\n' +
  fence("Note A", noteA) + "\n\n" + fence("Note B", noteB) + "\n\n" + files;

/** Section 3 step 7 (real stratum): the audit, without the notes, with section 2's foreseeable rating. */
export const REAL_AUDIT_CHECKS = {
  r1: "The opening and the sheet carry nothing that signposts the customer or the wedge beyond what the founder would say.",
  r2: "The key facts point toward the customer or the wedge.",
  r3: "The key is consistent with the sheet.",
} as const;
export type RealAuditCheck = keyof typeof REAL_AUDIT_CHECKS;
export const KEY_REAL_AUDIT_CHECKS: readonly RealAuditCheck[] = ["r2", "r3"];

export const realAuditPrompt = (files: string): string =>
  "Audit this invented startup, re-skinned from a real startup's history for a test of business advisors. Check each of these and mark it pass or fail:\n" + checkList(REAL_AUDIT_CHECKS) +
  "\nThen rate whether a careful advisor holding the whole fact sheet could have named the key's customer, and separately its wedge: yes, maybe or no." +
  '\n\nReply with a JSON object only: {"r1": "pass" or "fail", "r2": ..., "r3": ..., "foreseeable": {"customer": "yes", "maybe" or "no", "wedge": ...}, "why": one line per failed check}.\n\n' + files;

/** The recognition probe's two prompts: the opening alone, and the opening with the sheet and the key. */
export const probePrompt = (opening: string, sheet?: Sheet, key?: Key): string => PROBE + "\n\n" + (sheet && key ? unitText(opening, sheet, key) : fence("opening.md", opening.trim()));

/** The probe's two-judge calls (Opus and Astra). */
export const probeJudgeConstructed = (files: string, reply: string): string =>
  "Below are an invented startup and a model's answer to whether it disguises a real company's early history. For each real company the answer names, judge whether the startup's story matches that company's early history closely." +
  '\n\nReply with a JSON object only: {"matches": [the names of the companies whose early history the story matches closely, as the answer wrote them]}, with [] for none.\n\n' + files + "\n\n" + fence("answer", reply);
export const probeJudgeReal = (names: readonly string[], reply: string): string =>
  "Below are the names of a real company, its products and its founders, and a model's guesses at which real company a disguised story comes from. Judge whether any guess identifies that company unambiguously." +
  '\n\nReply with a JSON object only: {"identifies": true or false}.\n\n' + fence("names", names.join("\n")) + "\n\n" + fence("answer", reply);

/** Section 3's type rule, applied blind to the key, with the founder's stage for section 8's descriptive split. */
export const typePrompt = (opening: string, persona: string): string =>
  "Classify this startup from its founder's first message and persona. Type, the first match in this order: marketplace (it matches two sides, such as buyers and sellers); developer tools (its users are software developers); B2B (organizations pay for it); consumer (individuals use it for themselves); other. Stage: pre-product (no one uses it yet) or has users." +
  '\n\nReply with a JSON object only: {"type": "marketplace", "developer tools", "B2B", "consumer" or "other", "stage": "pre-product" or "has users"}.\n\n' + fence("persona", persona) + "\n\n" + fence("opening.md", opening.trim());

/** The frame's founder-account test (README choice): one call per page, by Sol. */
export const founderPagePrompt = (url: string, text: string): string =>
  "Is the page below a first-person account by a founder of the company, published on the company's own site or on a founder's personal site? A page that reports on other people's companies, a guest post, a news story or a page by someone who is not a founder is not." +
  '\n\nReply with a JSON object only: {"founder_account": true or false}.\n\n' + fence(url, text);

// Copyright (c) 2026 Garry Tan. MIT License.
// The devex eval's authoring prompts (prereg 2026-11-09-geva-417, sections 3, 4 and 11), frozen and pinned by sha256:
//   REWRITE      the plan rewrite, verbatim from section 4 (Opus 5.5)
//   TRIAGE       the funnel's step 2 (Gemini 4 Argon at medium effort): flag a unit when any candidate could be a G, E, D
//                or U item about the unit's surface, and flag when in doubt
//   KEY          the funnel's step 3 (Opus 5.5 at high effort): section 3's key with evidence pointers, dates and
//                context tags; statements of at most 30 words, observed facts, never advice
//   KEY_FIX      the key writer's one revision after a failed audit round
//   AUDIT        the two audits (Opus 5.5 in a fresh session, GPT-6.1 Sol): section 4's "Blind authoring" checks and
//                section 3's foreseeable ratings
//   RECOGNITION  section 11's recognition probe: no tools, plan.md and the first 40 lines of the README, both aliased
// A prompt edit changes its digest, and run code refuses a prompt whose digest is not the one pinned here.
import { createHash } from "node:crypto";

export const REWRITE = "Below is the description of a change a software team made, and the request that led to it if there was one. Rewrite it as the plan the team would have written before building: future tense, the same goals, scope, commitments, constraints and open questions, at about the same length. Keep every decision the description states, including any docs, error messages, migration notes, tests or rollout it promises. Add nothing it doesn't say: no new features, risks, docs, error messages, migration steps, tests, rollout steps or follow-ups, and no implementation detail beyond what it names. Leave out people's handles, names and email addresses. Output only the plan.";

const FENCE = "\u0060\u0060\u0060";

const CLASSES = [
  "The four classes, about the change's own surface (the command, flag, endpoint, method, config key, install path or behavior change it added or changed):",
  "- G, getting started: an outside developer could not install, set up or reach a first working use of the surface; or a merged follow-up change fixed the quickstart, install or setup steps for it.",
  "- E, errors: an outside developer hit an error from the surface they could not act on (a message with no cause or fix, a failure reported as success, a wrong exit code, a hang, a leaked secret in output); or a merged follow-up change rewrote that surface's error messages or error output.",
  "- D, docs: an outside developer found the surface missing from the docs, documented wrongly, or unclear; or a merged follow-up change added or corrected its docs, examples or help text.",
  "- U, upgrade: developers upgrading to the release were broken by the change (a removed or renamed surface, a changed default, changed output); or a merged follow-up change added a migration note, a deprecation path or a compatibility shim for it.",
  "An outside developer is an author whose association is NONE, CONTRIBUTOR, FIRST_TIMER or FIRST_TIME_CONTRIBUTOR. A follow-up change counts whoever wrote it; a maintainer's issue alone is not an item.",
  "Excluded: a logic defect with no adoption angle, a request for new capability, performance tuning, anything about another part of the project, anything only an insider could know, and anything dated outside the window.",
].join("\n");

const json = (example: string) => "Answer with one fenced json block and nothing after it:\n" + FENCE + "json\n" + example + "\n" + FENCE;

export const TRIAGE = [
  "You triage one change a software project shipped. Below are the team's own description of the change (written before it merged), the change's identifiers, and candidate records from the 60 days after its release: each with its title, its author's association and the passage of its body around the match.",
  CLASSES,
  "Flag the change when any candidate could be a G, E, D or U item about the change's own surface. When in doubt, flag. List under candidates only the ones that could be items.",
  json('{"flag": true, "candidates": [{"n": 1, "class": "G", "why": "one short line"}]}'),
].join("\n\n");

export const KEY = [
  "You write the answer key for one research unit. A software project shipped the change below in a release on RELEASE; the window is WINDOW. You see the team's plan, the title of every issue, discussion and pull request created in the window, the body of every one that touches the change's surface, and every screened candidate in full.",
  CLASSES,
  "For each item write a statement of at most 30 words, an observed fact that names the surface, the developer's context where the record gives one, and the trouble. Never advice. Examples of the form: \"Developers installing with the standalone binary on Windows could not run the new sync command; a DLL was missing\"; \"The project later rewrote the config loader's error to name the bad key and its line\"; \"Users upgrading found the --output flag renamed with no deprecation warning\".",
  "For each item give: class (G, E, D or U); statement; surface (the command, flag, endpoint, method, config key, install path or upgrade step); context (the developer's platform, install channel, workflow such as CI or an agent caller, or experience such as a first-time user, from the record; null when it gives none); source (\"outside\" for an item from outside developers' issues or discussions, \"followup-linked\" for a merged follow-up change linked to an outside issue, \"followup\" for any other merged follow-up change); outside_developers (the count of distinct outside developers behind it, 0 for none); evidence (each record's reference and date); mentioned (true when the plan already names this surface and trouble, as a risk, a deferral or a task). An empty items list is a valid answer.",
  json('{"items": [{"class": "E", "statement": "...", "surface": "...", "context": null, "source": "outside", "outside_developers": 2, "evidence": [{"ref": "issue 12", "date": "2026-08-02"}], "mentioned": false}]}'),
].join("\n\n");

export const KEY_FIX = "Revise your key using the auditors' notes below: apply every fix, remove every item they show is unsupported, outside the window or outside the rules, and correct the mentioned flags. Add no item the records don't support. Answer in the same format.";

export const AUDIT = [
  "You audit one research unit before any model reviews it. A software project shipped a change in a release on RELEASE; the window is WINDOW. You see the plan the reviewers will get (plan.md, with the project's names replaced by invented ones), the records of the window, and the answer key: items in four classes with statements in the invented names.",
  CLASSES,
  [
    "Check, and list every problem you find:",
    "1. plan.md carries nothing dated after the merge and nothing that signposts a key item.",
    "2. The invented names hold: no real project, owner, package, module or binary name shows in plan.md or in any statement.",
    "3. Each item is supported by its records, falls inside the window and passes the class rules and the exclusions above; each statement is at most 30 words, an observed fact and never advice.",
    "4. Each item's mentioned flag is right: true exactly when plan.md already names that surface and trouble as a risk, a deferral or a task.",
    "Then rate each item: could a careful reviewer with plan.md and the base code have named this surface and trouble? yes, maybe or no. pass is false when any problem stands.",
  ].join("\n"),
  json('{"pass": true, "problems": [], "items": [{"id": "k1", "foreseeable": "maybe"}]}'),
].join("\n\n");

export const RECOGNITION = [
  "Below are a software team's plan for a change and the first 40 lines of their project's README. Some names in them may be replaced. Which real open-source project is this, and what changed in it in the 60 days after this change shipped?",
  json('{"project": "owner/name or name, or unknown", "changes": "one or two lines"}'),
].join("\n\n");

export const PROMPTS = { REWRITE, TRIAGE, KEY, KEY_FIX, AUDIT, RECOGNITION } as const;
export type PromptName = keyof typeof PROMPTS;

/** sha256 of each frozen prompt. */
export const PINNED: Readonly<Record<PromptName, string>> = {
  REWRITE: "3b276eb3e086d311b8ac652769224ae65e140734f7ea2695e776d707d97d430d",
  TRIAGE: "287aa763f4c86c844121644061b68071cdfea4e1ed46e72a3c93f2efd078cbf4",
  KEY: "304eed57df767f4d9c488b823105ad4b42322720e4e3c6049dc6811eaa6d1d63",
  KEY_FIX: "b152be8ae928be725a3fc27157c2045f3e0816dde3a7bc8c2352089eacffcf97",
  AUDIT: "860363f4831d31ce633680e303faf0bc87e797dcb4a0111a39d138694e419537",
  RECOGNITION: "d53dfa5f1447dc013ab3a46c7fd536584f8fe2515f655a793d7ff307ba4eb97c",
};

export const digest = (s: string) => createHash("sha256").update(s).digest("hex");

/** The prompts whose text no longer matches its pin. */
export function unpinned(prompts: Readonly<Record<string, string>> = PROMPTS, pins: Readonly<Record<string, string>> = PINNED): string[] {
  return Object.keys(prompts).filter((k) => digest(prompts[k]!) !== pins[k]);
}

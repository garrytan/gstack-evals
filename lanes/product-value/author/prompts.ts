// Copyright (c) 2026 Garry Tan. MIT License.
// Authoring prompts for the product-value eval (prereg sections 3 and 4). The three prompts the prereg freezes (T1, T2
// and the PR-as-plan rewrite) are copied here byte for byte and pinned by sha256 in tests; the rest were written for the
// build before any arm output existed. The summary prompt for transposed sources is sealed, not here: only its digest is
// committed (SUMMARY_PROMPT_SHA256 in transpose.ts).

/** Section 4, frozen. */
export const REWRITE = "Below is the description of a change a software team made, and the request that led to it if there was one. Rewrite it as the plan the team would have written before building: future tense, the same goals, scope, commitments, constraints and open questions, at about the same length. Keep every user-facing decision the description states. Add nothing it doesn't say: no new features, risks, rollout steps or follow-ups, and no implementation detail beyond what it names. Replace project, product and people names with neutral ones. Output only the plan.";

/** Section 4, frozen; TYPE is replaced by the target type. */
export const T1 = "Invent a new product of type TYPE in a different domain from the source below, with new names, users and surface details, so that no reader could recognize the source. Then write, in your own words and at the source plan's length and level of detail, three files for the new product: plan.md, the team's plan for the change, keeping the same kinds of decisions, commitments and omissions as the source plan; brief.md, the problem before the plan, with no part of the design; and context/, the product as it stood before the plan. Copy no sentence, name or number from the source. Add no decision the source plan doesn't make, and leave out nothing it does make.";

/** Section 4, frozen. */
export const T2 = "For each aftermath event below, write one key item for the new product that re-skins that event: the same kind of need, use, environment or capability, translated into the new product's domain, as an observed fact in at most 30 words. One item per event, no more and no fewer. If the new plan, brief or context already names an item's need, mark it mentioned. Copy no sentence, name or number from the source.";

/** Output-format lines appended after a frozen prompt and its material (a build-time choice: format only, no instruction about content). */
export const T1_FORMAT = "Output format: three fenced blocks labelled plan.md, brief.md and context/project.md, in that order, and nothing else.";
export const T2_FORMAT = 'Output format: one fenced json block holding {"items": [{"event": <event number>, "statement": "...", "mentioned": true|false}]}, one entry per event in order, and nothing else.';

export const TYPE_WORDS: Record<string, string> = {
  consumer: "consumer software that end users run (a desktop, web or browser app, a game, media, notes, chat, personal productivity or a home app)",
  server: "server-side data or enterprise software that an organization operates (a database, data pipeline, self-hosted business software, analytics, observability, identity, a queue or a search engine)",
  mobile: "a mobile app for iOS or Android",
  other: "a developer tool, library, framework or command-line tool",
};

export const NAMEMAP = `You are preparing an anonymized research unit from a public software project. Below are materials from before a planned change: the project's repository path, description and README, a plan or pull request description, and any request that led to it. List every name a reader could use to identify the project: the project and product names (with spelling variants, package, binary and module names, domains and repository paths), the organization, and every person's name or handle. Give each a neutral replacement that keeps its role (an invented product name of the same kind, or @maintainer-1, @user-2 and so on for people). Do not list generic technology names (languages, frameworks, databases, operating systems) unless one is the project itself.

Output one fenced json block holding {"names": [{"original": "...", "replacement": "..."}]} and nothing else.`;

export const SWEEP = `The text below is part of an anonymized research unit. Replace any remaining name that could identify the software project, its organization or a person (including handles, domains, package names and repository paths) with a neutral one, using the replacements listed where they apply, and replace links to the project's own repository, site, issues or docs with [link]. Change nothing else: keep every other word, heading, list and code block exactly as it is. Output only the text.`;

export const CONTEXT = `Write context/project.md for an anonymized research unit: a description of a software project as it stood on DATE, from the materials below only (its description and README at that time). Cover what it does, who uses it, the features related to the area named below, and any constraints it states. Use only facts in the materials: add nothing from your own knowledge of the project and nothing dated after DATE. Do not describe the planned change itself. Apply the name replacements listed and use no other name that identifies the project, its organization or its people. 300 to 700 words of plain markdown. Output only the file's text.`;

export const BRIEF = `Write brief.md for an anonymized research unit: the problem a software team faced before they wrote the plan below. Say what request or pain led to it, who raised it (by role, never by name), and what existed then. Use only the materials. Do not include any part of the proposed design: no solution, approach, feature list, interface, setting, flag, rollout or scope decision from the plan. 120 to 350 words of plain markdown. Output only the file's text.`;

export const INPUT_AUDIT = `You audit one anonymized research unit's inputs before any model reviews them. The unit was made from a public software project's materials dated up to DATE. You see the source materials and the three input files written from them. Report every problem, each with its file and a short quote:
1. Names: any remaining name that could identify the project, its organization, a person, a domain or its repository. Generic technology names are fine.
2. Time: anything in the inputs that the source materials don't support, above all anything that could only be known after DATE.
3. brief.md holds part of the proposed design (a solution, approach, feature list, interface, setting, flag, rollout or scope decision from the plan).
4. plan.md: PLANRULE
5. context/project.md describes the plan's own design.
Pass only when there are no problems. Output one fenced json block holding {"verdict": "pass" | "fail", "problems": [{"file": "plan.md" | "brief.md" | "context/project.md", "check": 1, "quote": "...", "fix": "..."}]} and nothing else.`;
export const PLANRULE_PR = "anything added beyond the source description (a new feature, risk, rollout step, follow-up, or implementation detail it doesn't name), or a user-facing decision of the source left out. Name replacement and future tense are expected.";
export const PLANRULE_PLAN = "any change beyond name and link replacement: a sentence, heading, list item or commitment added, dropped or reworded.";

export const FIX = `Edit the file below to fix only the problems listed, with the smallest change that fixes each one. Keep everything else exactly as it is. Output only the corrected file's text.`;

export const SELECT = `A software project shipped the change below in a release on RELEASE. Below is every issue, discussion and pull request created in the 42 days after the release: number, kind, date, the author's association with the project, labels and comment count, and title. Pick every record that touches the shipped feature: reports, requests, questions, follow-up pull requests and discussions about how it is used or should change. Include records whose title only hints at the feature's area, interface, setting, flag or component names, records tagged with the release's version, and records in the same series. Pick at most 60, most relevant first.

Output one fenced json block holding {"pick": [<numbers>]} and nothing else.`;

export const KEY = `You write the answer key for one research unit. A software project wrote the plan below and shipped it in a release on RELEASE. You see the plan as first written, the records of the 42 days after the release (the titles of everything created then, and the full text of the records that touch the feature), and the unit's three anonymized input files. List what really happened after launch, in three kinds:

- U, user signal: a need, use case, workflow, environment or misunderstanding that people outside the maintainer team raised about the shipped feature within the 42 days, that the first plan did not address. It needs at least two distinct outside users, or one plus a maintainer's acknowledgement (a label, an accepting reply or a fix). Excluded: a code defect with no new use or environment behind it, typos, performance regressions, and anything only an insider could know.
- E, product evolution: a capability the project shipped within the 42 days (a merged pull request or a release note) that extends the feature's user-facing capability and that the first plan did not include. Excluded: bug fixes, refactors, routine syncs of lists, demo-only layers and internal plumbing.
- R, rollout and first version: how the change actually reached users when that differs from the first plan: what the first release left out, or how it was gated (a flag, an experimental or preview label, opt-in first, a staged default).

Rules for each item:
- The statement is an observed fact about users or the product in at most 30 words, never advice ("People running it in CI needed a non-interactive mode"; "Six weeks after launch the project added export to CSV"). Use the anonymized names from the input files, never a real name.
- evidence lists the record numbers behind it; outside_users counts the distinct people outside the maintainer team behind it (for E, the outside users on issues linked to its pull request, else 0); maintainer_ack says whether a maintainer acknowledged it.
- mentioned is true when plan.md, brief.md or context/project.md already names the item's need (for example a deferred plan item or a request made before the plan); say where.
- foreseeable is yes, maybe or no: could a careful reader of the inputs alone have foreseen it?
- Do not list the same need twice. List every item that meets its kind's rule; the ranking is done later.
Also list the plan's 3 central commitments (what the maintainers decided to build), each in at most 20 words with anonymized names.

Output one fenced json block holding {"items": [{"kind": "U" | "E" | "R", "statement": "...", "evidence": [<numbers>], "outside_users": <n>, "maintainer_ack": true | false, "mentioned": true | false, "mentioned_where": "...", "foreseeable": "yes" | "maybe" | "no"}], "commitments": ["...", "...", "..."]} and nothing else. An empty items list is a valid answer.`;

export const KEY_AUDIT = `You audit one research unit's answer key. You see the plan as first written, the release date RELEASE, the records of the 42 days after it, the unit's anonymized input files and the key. Check every item:
1. Its evidence records exist in the material, fall inside the 42 days, and support the statement.
2. It meets its kind's rule: U needs at least two distinct outside users or one plus a maintainer's acknowledgement, and is not a plain code defect, typo, performance regression or insider-only fact; E is a shipped extension of the feature's user-facing capability, not a fix, refactor, list sync, demo layer or plumbing; R is how the first release actually reached users when that differs from the plan.
3. It is absent from the first plan, or marked mentioned; and mentioned is true exactly when plan.md, brief.md or context/project.md names its need.
4. Its statement is an observed fact of at most 30 words, not advice, and uses no real name.
5. It duplicates no other item.
Give each item a verdict: keep, fix (say how) or drop (say why).

Output one fenced json block holding {"verdict": "pass" | "fail", "items": [{"index": <0-based>, "verdict": "keep" | "fix" | "drop", "note": "..."}], "missing": ["<any real U, E or R item the key left out, with its record numbers>"]} and nothing else. Pass only when every item is keep and nothing is missing.`;

export const KEY_FIX = `Revise the answer key below using the auditor's notes: apply every fix, remove every dropped item, and add the missing items the notes name if they meet their kind's rule. Keep the same output format and rules as before.`;

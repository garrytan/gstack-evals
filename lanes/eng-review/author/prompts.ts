// Copyright (c) 2026 Garry Tan. MIT License.
// Authoring prompts for the plan-eng-review intentions eval (prereg 2026-11-08-geva-405, sections 3 and 4). REWRITE is
// section 4's frozen plan rewrite, copied byte for byte; the others were written for the build from sections 3 and 4
// before any arm output existed. Each prompt is pinned by sha256 in PROMPT_SHA256, and tests check both.
// Build-time choices (lanes/eng-review/README.md, authoring side):
// - The key writer may key only the aftermath candidates the miner found (B, R, T and C, each with its commit message,
//   pull request, linked issues and diff), at most one item a candidate; it sees every other change in the window as a
//   dated title line. A defect revert is keyed as a B item.
// - Each auditor runs three calls: the input audit (plan.md against its source, with the key's statements for the
//   signpost check), the key audit, and the foreseeable rating, which sees only plan.md, the base file list and the
//   items.
// - The input audit reads plan.md only. repo/ is the base tree by construction, checked mechanically.
import { createHash } from "node:crypto";

/** Section 4, frozen. */
export const REWRITE = "Below is the description of a change a software team made, and the request that led to it if there was one. Rewrite it as the plan the team would have written before building: future tense, the same goals, scope, commitments, constraints, test intentions and open questions, at about the same length. Keep every decision the description states, including any testing or rollout it promises. Add nothing it doesn't say: no new features, risks, tests, rollout steps or follow-ups, and no implementation detail beyond what it names. Leave out people's handles, names and email addresses. Output only the plan.";

const RULES = `Kinds, from what really happened within 60 days after the merge:
- B, post-merge defect: a commit merged in the window that repairs a defect in code the change introduced or changed. Keep it only when the defect was in the change's own code path: not a refactor, formatting or unrelated line; not a defect already present before the change that the change only moved; not one caused by a later change or a later dependency release. A later revert of the change, whole or in part, that names a defect is also a B item.
- T, follow-up test: a commit merged in the window, not itself a fix of the change, that adds or extends a test checking a behavior of the change's code that the change's own tests didn't check. A test for a later feature built on top of the change doesn't count.
- C, CI or eval follow-up: a commit merged in the window that adds or changes a CI job, a matrix entry, a platform, a test lane or an eval for the change's code, or wires the change's tests into CI.
Never an item: a revert because the team changed its mind, performance tuning with no defect, docs, typos, dependency bumps.
Statements: each item is one statement of at most 30 words, written as an observed fact that names the component or flow, the file where it helps, and the condition. Examples: "The export endpoint returned a 500 when the tag list was empty (api/export.go)"; "Later the project added a test that the importer skips rows with no date"; "Later the project added Windows to the CI matrix for the path-handling module". Never advice, never a recommendation, and never a person's name or handle.
Mentioned: an item is mentioned when plan.md already names its path and condition as something to test or handle.`;

export const KEY = "You write the answer key for one research unit: a real change a software team merged, and what happened in the 60 days after it. You see plan.md (the team's plan, rewritten from their pull request), the merge date and the window's end, the change's own diff, every change merged in the window as a title line, and the aftermath candidates a script found, each with its id, commit message, pull request, linked issues and diff (a B candidate also lists the files and functions whose lines it blamed on the change).\n\n" + RULES + "\n\nKey every candidate that meets its kind's rule, at most one item a candidate, and no candidate twice. Skip a candidate that fails the rule. Also list up to 4 behaviors the change's own tests checked, each one statement of at most 30 words.\n\nOutput one fenced json block holding {\"items\": [{\"candidate\": \"<candidate id>\", \"kind\": \"B\" | \"T\" | \"C\", \"statement\": \"...\", \"file\": \"<the file where it helps>\", \"mentioned\": true | false, \"mentioned_where\": \"<the plan's words, or empty>\"}], \"own\": [\"...\"]} and nothing else. An empty items list is a valid answer.";

export const KEY_AUDIT = "You audit one research unit's answer key. You see plan.md, the merge date and the window's end, the change's own diff, every change merged in the window as a title line, the aftermath candidates with their evidence, and the key. Check every item:\n1. Its candidate exists, its evidence supports the statement, and it was merged after the change and by the window's end.\n2. It meets its kind's rule and none of the exclusions below; for B, the defect was in the change's own code path.\n3. Its statement is an observed fact of at most 30 words that names the component or flow, the file and the condition, is not advice and names no person.\n4. mentioned is true exactly when plan.md names the item's path and condition as something to test or handle.\n5. It duplicates no other item.\nAlso name any candidate that meets its kind's rule but has no item.\n\n" + RULES + "\n\nOutput one fenced json block holding {\"verdict\": \"pass\" | \"fail\", \"items\": [{\"index\": <0-based>, \"verdict\": \"keep\" | \"fix\" | \"drop\", \"note\": \"...\"}], \"missing\": [\"<candidate id>: <why>\"]} and nothing else. Pass only when every item is keep and nothing is missing.";

export const INPUT_AUDIT = "You audit the plan a research unit gives its reviewers. A model rewrote a software team's pull request description (and any request that led to it) as the plan the team would have written before building. Reviewers get only plan.md and the repository as it stood before the change. You see the source text with its dates, the merge date, plan.md, and the statements of the unit's answer key, which record what happened after the merge. Report every problem, each with a short quote from plan.md:\n1. Additions: a feature, risk, test, rollout step, follow-up or implementation detail the source doesn't state, or a decision the source states that plan.md leaves out. Future tense is expected.\n2. Time: anything that could only be known after the merge date.\n3. Signposts: wording that points a reader at a key statement's path or condition beyond what the source itself says.\n4. People: a handle, name or email address.\nPass only when there are no problems. Output one fenced json block holding {\"verdict\": \"pass\" | \"fail\", \"problems\": [{\"check\": 1, \"quote\": \"...\", \"fix\": \"...\"}]} and nothing else.";

export const FORESEEABLE = "Below are a software team's plan for a change, the list of files in its repository before the change, and statements of what happened after the change merged. For each statement: could a careful reviewer holding only this plan and the code before the change have named this path and condition before the change was built? Answer yes, maybe or no for each.\n\nOutput one fenced json block holding {\"ratings\": [{\"index\": <0-based>, \"foreseeable\": \"yes\" | \"maybe\" | \"no\"}]} and nothing else.";

export const FIX = "Edit the plan below to fix only the problems listed, with the smallest change that fixes each one. Add nothing the source text doesn't state. Keep everything else exactly as it is. Output only the corrected plan.";

export const KEY_FIX = "Revise the answer key below using the auditors' notes: apply every fix, remove every dropped item, and add an item for each missing candidate the notes name if it meets its kind's rule. Keep the same rules and output format as before.";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const PROMPTS = { REWRITE, KEY, KEY_AUDIT, INPUT_AUDIT, FORESEEABLE, FIX, KEY_FIX } as const;

export const PROMPT_SHA256: Readonly<Record<keyof typeof PROMPTS, string>> = {
  REWRITE: "6e1521945f606ea0904a78f81515e7e0586c482464fa4e95a417cba0c491fa38",
  KEY: "4bd7dd6f7fd31b0047c8f3b644db2a289ce68d43675013555c9ed952e303d76a",
  KEY_AUDIT: "96cc6c538a99d82242f633f66ba3dfaf6cfc379a78d2aaa0000e0c817b59a65f",
  INPUT_AUDIT: "2a3cad91dc59f4191bdefbd6034564e7d7a22b807c5084fa56064b3eb81f8b5a",
  FORESEEABLE: "0c10309ec2ccd0974ac3297c01d31ea3af49a95bc1ec10ed7b4418076b75378d",
  FIX: "c10fbb9f09ab2c3b00878c3346b5d6d86ead6d5b1de155c54d70941830e35954",
  KEY_FIX: "81a9ac4c29f53a1fb8f87138a0383b6a6298a00814bf05dd61f5a6495158546f",
};

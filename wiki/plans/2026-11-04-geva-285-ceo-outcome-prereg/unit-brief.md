# Unit brief: mining, blind-built packets and audit (GEVA-285)

This brief is frozen with the preregistration. The custody thread follows it to build the calibration slice and the comparison set. Nothing in it is a unit; units, keys and the mining record stay sealed.

## 1. Eligibility

A candidate is one public decision record on GitHub: an issue, pull request or discussion that proposes a change to a product.

1. The repository's licence file at the plan date is MIT, Apache-2.0 or a BSD licence, and the repository has at least 500 stars when it is mined.
2. The proposal is a written plan for a change to the product: a new feature, a change in behavior or defaults, a deprecation, a re-architecture or a project policy. Its first version holds at least 400 words, and it was first posted on or after 2026-07-01. The mining record keeps the posted date, and the readings carry it so the strict strata (posted on or after 2026-09-01, and on or after 2026-10-01) can be read apart.
3. The first version is recoverable: the body as first posted (GitHub's edit history), or a body never edited after the first reply. Otherwise the candidate is dropped.
4. The outcome is public and dated by 2026-10-31, in the record or linked from it, and falls in one class:
   - rejected: closed without being carried out, with a maintainer's stated reason;
   - reverted: carried out, then reversed by a merged revert;
   - re-scoped: carried out only after a major cut or change of approach, or cut back after shipping, with a stated reason;
   - held: carried out substantially as written and shipped by 2026-09-01, with no revert and no major cut through 2026-10-31.
   The first three are changed units; held units are controls.
5. A changed unit's decisive issue falls in one category: premise or demand, scope, direction or strategy fit, user impact or migration, maintenance or cost burden, sequencing or dependency, or ambition (the plan was too small for the need). A reason that is a code defect, a failing test, a security bug in the implementation or a style point is out, and so is a reason only the people involved could know (an absence, a private agreement, a later event nobody could foresee).
6. At most two units per repository. gstack, gstack-evals, gbrain and the harness repositories are excluded.
7. The mining record notes whether the proposer was a maintainer of the repository at the plan date (maintainer) or not (outside). It is a secondary split and decides nothing.

## 2. Roles

Every role is a separate session that sees only its own inputs. Writers run google/gemini-4-argon, a family not under test. Auditors run anthropic/claude-opus-5-5 and openai/gpt-6.1-sol with no gstack, each alone.

A packaging script, not an agent, assembles every writer's and auditor's inputs from the sealed mining record, builds each unit's name map, and writes each session's input folder. The custody thread runs the script and starts the sessions; it never pastes record text into a prompt and never relays one session's notes to another by hand. The name map comes from the repository's name and owner, its package and module names, and every login and personal name in the first version; the plan writer and context writer may add entries and never remove one.

| Role | Sees | Never sees | Writes |
|---|---|---|---|
| Miner (a script plus one classifier session) | record metadata, outcome, dates | nothing is withheld | the candidate row: links, dates, licence, outcome class, category |
| Plan writer | the proposal's first version; the unit's name map | every reply, the outcome, the key | plan.md |
| Context writer | the repository at the last commit before the plan date (README, CONTRIBUTING, governance, roadmap and docs index, package metadata) and the titles of the 40 most recent issues and pull requests opened before the plan date, each with its state as of the plan date (closed or merged only when its closed_at or merged_at is before the plan date, otherwise open) and its opening date; no date after the plan date and no current state | the proposal, its discussion, its outcome, the key | context/project.md |
| Key writer | the anonymized plan.md and the full public record through 2026-10-31 | nothing is withheld | key.json |
| Blind auditor (two) | plan.md, context/, the first version, the context writer's inputs and the name map | every reply, the outcome, key.json | checks 1 to 3: a pass or fail per check, with the line it rests on |
| Key auditor (two, separate sessions from the blind auditors) | everything above and key.json | | checks 4 to 6: a pass or fail per check, with the line it rests on |

The plan writer keeps the original's sections, order, asks, claims and numbers, writes in its own words, and keeps the length within 20% of the original. A close paraphrase like this can still count as a derivative of the original text, so plan.md stays sealed, is used only for this evaluation, and is never published. It adds no fact and drops none that bears on the plan. The context writer writes 800 to 2,000 words: what the project is, who uses it, its size and release practice, its stated priorities and non-goals, and its recent direction. Neither writer knows the outcome, so neither can point at the decisive issue.

## 3. Names

Each unit has a name map: the project's name and its unique product and module names become invented neutral names, people become roles ("a maintainer", "a contributor"), and organizations become generic descriptions. General technology names (languages, standard protocols, widely used dependencies) stay unless they identify the project. No date after the plan date appears in plan.md or context/.

## 4. The key

key.json holds: the outcome class and its date; D, the decisive issue, in one or two sentences of the key writer's own words; D2 when the record gives two reasons with equal weight; match notes (what an issue must name to match, and near misses that don't); R1 to R3, other issues the record shows were real; the category; and record pointers (links, sealed). D is the main reason the record gives for what happened. A held unit has no D and no R.

## 5. Audit

Each auditor checks, on its own:

1. Leak: plan.md and context/ hold nothing dated after the plan date and nothing that states or hints at the outcome; every issue or pull request state in context/ is its state as of the plan date.
2. Names: no name from the source side of the map appears.
3. Fidelity: plan.md keeps the original's asks, claims and numbers, adds none, and is within 20% of its length.
4. Key support: the record supports the outcome class and D as its main reason.
5. Foreseeable: D concerns something present in plan.md or context/; the auditor names the line. Foreseeable is not findable. An auditor never asks for an edit that would make D easier to see.
6. Scope: the category is one of section 1's.

A changed unit passes when both blind auditors pass checks 1 to 3 and both key auditors pass checks 4 to 6. A held unit passes checks 1 to 4 the same way; checks 5 and 6 don't apply, since it has no D. A failure on checks 1 to 3 gets one fix round by the writer that failed, carrying only the blind auditor's note, then a re-audit of that check by the blind auditors. Nobody who has read key.json or the outcome writes a note that reaches a writer. A failure on checks 4 to 6 drops the unit, with no fix round, so no unit is tuned toward the answer. The key auditors run only after the blind audit has passed, so no fix round follows a key read.

## 6. Order and draw

The miner screens the pool on metadata (section 1, items 1, 2, 4 and 6). The custody thread mints a seed from random bytes, logs it in CUSTODY.md, and puts the screened pool in that seeded order. Units are authored in that order. The first 16 changed and 4 held units that pass audit are the calibration slice. If stage 1 reads HEADROOM, authoring continues in the same order until 48 changed and 16 held units pass; those are the comparison set. Calibration units never join the comparison set, and units that pass after a set is full are reserve.

## 7. Custody

Units, keys, name maps, the mining record and every writer's input are sealed with age to the panel recipient, with digests committed. Writers' inputs are fetched into RAM-backed storage and deleted after the session, checked with test ! -e. No proposal or reply text is kept verbatim in any unit, key or committed file.

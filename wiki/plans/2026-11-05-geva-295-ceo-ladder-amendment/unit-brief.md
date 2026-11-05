# Unit brief: mining, blind-built packets and audit (GEVA-285)

This brief is frozen with the preregistration and amended by 2026-11-05-geva-295-ceo-ladder-amendment (its section 3, items 1, 3 to 8, 27, 29 and 30). The custody thread follows it to build the calibration slice and the comparison set. Nothing in it is a unit; units, keys and the mining record stay sealed.

## 1. Eligibility

A candidate is one public decision record that proposes a change to a product: an issue, pull request or discussion on GitHub, or a structured decision record (a Go proposal, a PEP, a Rust RFC or compiler-team major change, a KEP or a Swift Evolution proposal) whose proposal document and decision sit in a GitHub repository. Forum threads are not read (the ladder amendment, section 13).

1. The licence covering the proposal at the plan date is MIT, Apache-2.0, a BSD licence or CC0-1.0: the repository's licence file, or for a proposal document, a dedication the document itself states (PEPs state public domain or CC0-1.0, whichever is more permissive; a PEP that states none drops). Comment text stays under GitHub's terms either way. The project the decision process governs has at least 500 stars when it is mined: the record's own repository, or for a separate proposals repository, the main repository of the project it governs (python/peps reads python/cpython, rust-lang/rfcs and rust-lang/compiler-team read rust-lang/rust, kubernetes/enhancements reads kubernetes/kubernetes, swiftlang/swift-evolution reads swiftlang/swift).
2. The proposal is a written plan for a change to the product: a new feature, a change in behavior or defaults, a deprecation, a re-architecture or a project policy. Its first version holds at least 400 words, and it was first posted on or after 2026-07-01. The posted date is the proposal's first public version: for a PEP, the earlier of its first commit in python/peps and the opening of the pull request that proposed it; for a Rust RFC, a KEP or a Swift Evolution proposal, the earlier of the pull request's opening and the proposal document's first commit; for a Go proposal, the issue's opening; for a plan first posted in a linked document, that document's first public commit. A proposal whose first public version is before 2026-07-01 drops. The mining record keeps the posted date, and the readings carry it so the strict strata (posted on or after 2026-09-01, and on or after 2026-10-01) can be read apart.
3. The first version is recoverable: the body as first posted (GitHub's edit history), or a body never edited after the first reply. For a proposal document, the first version is the document at its first public commit, read from git history. Otherwise the candidate is dropped. A record whose first version or record links an earlier proposal of the same change dated before 2026-07-01 drops.
4. The outcome is public, in the record or linked from it. The outcome date is the date of the written decision: the maintainer's or deciding body's closing statement, a status change in the proposal document, or a merged revert. A candidate posted by 2026-10-31 whose outcome lands after 2026-10-31 drops, even when a screen counted it. The outcome falls in one class:
   - rejected: closed without being carried out, with a maintainer's stated reason;
   - reverted: carried out, then reversed by a merged revert;
   - re-scoped: carried out only after a major cut or change of approach, or cut back after shipping, with a stated reason;
   - held: carried out substantially as written and shipped by 2026-09-01, with no revert and no major cut through 2026-10-31.
   For a structured record or a Discussion, the written decision sets the class, not GitHub's close reason: an issue closed as completed but declined in writing is rejected; a proposal withdrawn by its author after review is rejected when the record states the reviewers' objections as the reason, and drops otherwise; a duplicate drops. Structured statuses map to classes as the status map below says. The first three are changed units; held units are controls.
5. A changed unit's decisive issue falls in one category: premise or demand, scope, direction or strategy fit, user impact or migration, maintenance or cost burden, sequencing or dependency, or ambition (the plan was too small for the need). A reason that is a code defect, a failing test, a security bug in the implementation or a style point is out, and so is a reason only the people involved could know (an absence, a private agreement, a later event nobody could foresee).
6. At most two units per project, where a project is the repository item 1 reads for stars: the record's own repository, or for a separate proposals repository, the main repository it governs (rust-lang/rfcs, rust-lang/compiler-team and rust-lang/rust share two). gstack, gstack-evals, gbrain and the harness repositories are excluded.
7. The mining record notes whether the proposer was a maintainer of the project (for a structured record, the governed repository) at the plan date (maintainer) or not (outside). It is a secondary split and decides nothing.

The status map. For a structured record, the written decision sets the class, dated by the status change or closing statement that records it:

| Source | Status | Class |
|---|---|---|
| PEP | Rejected | rejected |
| PEP, Swift Evolution, KEP | Withdrawn | rejected when the record states the reviewers' objections as the reason; otherwise drop |
| PEP | Deferred, Superseded | drop, unless a written rejection lands by 2026-10-31 |
| Swift Evolution | Rejected | rejected |
| Swift Evolution | Returned for revision | drop, unless a written rejection lands by 2026-10-31 |
| Swift Evolution | Accepted with modifications | re-scoped when the modifications are a major cut or change of approach with a stated reason; otherwise as Accepted |
| Go proposal | Declined | rejected |
| Go proposal | Likely decline, Hold, Active | drop, unless declined by 2026-10-31 |
| Rust RFC | Closed after a final comment period to close, with a stated reason | rejected |
| Rust RFC | Postponed | drop |
| compiler-team major change | Closed without acceptance, with a written reason | rejected; with no stated reason, drop |
| KEP | Declined, or closed by its SIG with a stated reason | rejected |
| KEP | Deferred, Provisional | drop, unless a written rejection lands by 2026-10-31 |
| Any | Accepted, Final, Implemented, Merged | held or re-scoped under item 4's rules, or drop |

## 2. Roles

Every role is a separate session that sees only its own inputs. Writers run google/gemini-4-argon, a family not under test. Auditors run anthropic/claude-opus-5-5 and openai/gpt-6.1-sol with no gstack, each alone.

A packaging script, not an agent, assembles every writer's and auditor's inputs from the sealed mining record, builds each unit's name map, and writes each session's input folder. The custody thread runs the script and starts the sessions; it never pastes record text into a prompt and never relays one session's notes to another by hand. The name map comes from the repository's name and owner, its package and module names, and every login and personal name in the first version; the plan writer and context writer may add entries and never remove one. For a structured record, the name map draws on both the proposals repository and the governed project, and the context writer reads the governed repository plus the proposals repository's process documents at the same date. The packaging script fetches GitHub records and git history only, and every miner, writer and auditor session runs with web tools off. The public record is what sits on GitHub: the record, the GitHub records it links and the proposal document's history.

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

key.json holds: the outcome class and its date; D, the decisive issue, in one or two sentences of the key writer's own words; D2 when the record gives two reasons with equal weight; match notes (what an issue must name to match, and near misses that don't); R1 to R3, other issues the record shows were real; the category; and record pointers (links, sealed). It also holds: remedy: one or two sentences in the key writer's own words naming the change the record shows would have changed the outcome (the scope the maintainers asked for, an existing alternative, a different approach, or not building it when the record rejects the premise), with remedy match notes; blank when the record names none. remedy_kind: scope, alternative, approach or not_build, the kind of change the remedy names; blank with the remedy. decoy: R1, R2 or R3 when that R item is the record's most-discussed concern that did not decide the outcome; none otherwise. second_order: true when D arises from an interaction between two parts of the plan, or between the plan and in-flight work that context/ lists. D is the main reason the record gives for what happened. A held unit has no D and no R.

## 5. Audit

Each auditor checks, on its own:

1. Leak: plan.md and context/ hold nothing dated after the plan date and nothing that states or hints at the outcome; every issue or pull request state in context/ is its state as of the plan date.
2. Names: no name from the source side of the map appears.
3. Fidelity: plan.md keeps the original's asks, claims and numbers, adds none, and is within 20% of its length.
4. Key support: the record supports the outcome class and D as its main reason, and the decision and its stated reason sit on GitHub. Each key auditor also marks the remedy, the decoy and the second-order flag supported or not.
5. Foreseeable: D concerns something present in plan.md or context/; the auditor names the line. Foreseeable is not findable. An auditor never asks for an edit that would make D easier to see.
6. Scope: the category is one of section 1's.

A changed unit passes when both blind auditors pass checks 1 to 3 and both key auditors pass checks 4 to 6. The packaging script blanks a remedy either key auditor marks unsupported, and clears a decoy or flag the same way; the unit stays. A failure on the outcome class or D still drops the unit. A held unit passes checks 1 to 4 the same way; checks 5 and 6 don't apply, since it has no D. A failure on checks 1 to 3 gets one fix round by the writer that failed, carrying only the blind auditor's note, then a re-audit of that check by the blind auditors. Nobody who has read key.json or the outcome writes a note that reaches a writer. A failure on checks 4 to 6 drops the unit, with no fix round, so no unit is tuned toward the answer. The key auditors run only after the blind audit has passed, so no fix round follows a key read.

## 6. Order and draw

The miner screens the pool on metadata (section 1, items 1, 2, 4 and 6). The custody thread mints a seed from random bytes, logs it in CUSTODY.md, and puts the screened pool in that seeded order. Units are authored in that order. The first 16 changed and 4 held units that pass audit are the calibration slice. If stage 1 reads HEADROOM or FALLBACK, authoring continues in the same order until 48 changed and 16 held units pass; those are the comparison set. Calibration units never join the comparison set, and units that pass after a set is full are reserve.

## 7. Custody

Units, keys, name maps, the mining record and every writer's input are sealed with age to the panel recipient, with digests committed. Writers' inputs are fetched into RAM-backed storage and deleted after the session, checked with test ! -e. No proposal or reply text is kept verbatim in any unit, key or committed file.

---
id: 2026-11-17-geva-552-office-hours-intentions-inventory
kind: research
title: What gstack's office-hours skill is meant to do, intention by intention, at a pinned commit
summary: 10 main intentions (startup 4, builder 1, shared 5) and 36 secondary (startup 9, builder 4, shared 23). A startup session is held to 9 main, a builder session to 6.
author: GEVA-552
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-17
status: done
links: [wiki/research/2026-11-09-geva-412-plan-mode-intentions/README.md, https://github.com/garrytan/gstack/tree/da98d0a0eb0072bc5825b1f361a92aa34bdb273b/office-hours]
attachments:
  - 3394f55d56851a878c9630afc0817023fef97179a9f76ed2fd5612f8e0c89100  procedure-signals.md
---

# What gstack's office-hours skill is meant to do, intention by intention, at a pinned commit

## Takeaways

- We learned that office-hours makes one promise: understand the problem before any solution, then leave the user with an approved design doc and one real next action, not code. Ten main intentions carry that promise. One session with a simulated founder can fully see three of them (no code, a premise challenge, forced alternatives) and only partly see the other seven, because their proof sits in what the founder does after the session. You should score the seven against a scripted founder whose hidden facts the judge knows (does the doc report the real demand, the real person, a wedge the facts support, or say plainly there is none), and report the after-launch half as untested.
- We learned that the skill changes its behaviour sharply with the session kind. A spawned run picks every recommended option by itself, which includes the mode and, at the end, launching the next plan review. An unattended run stops at the first open question and never marks the doc approved. A headless run blocks when no question tool exists. You should run the eval as an interactive session where a simulated founder answers through a question tool or typed replies, and check the printed SESSION_KIND line in every transcript.
- We learned that the skill barely moved since the earlier plan-mode inventory. The startup and builder sections, the second-opinion and visual-design sections and the section manifest are byte-identical. The changes are the default next review (now /plan-eng-review instead of /autoplan), a reworded mode question, and a new shared preamble that adds "ask each question once" and a new shape for status reports. You should reuse that inventory's procedure markers with the small updates listed below.

## Commit and files read

Pinned at garrytan/gstack da98d0a0eb0072bc5825b1f361a92aa34bdb273b (VERSION 1.100.0.0, committed 2026-11-17), a shallow read-only checkout. Skill version 2.0.0, shared preamble id d8804c5ab6bf.

Citation keys used below (paths relative to the gstack repo root):

- T = office-hours/SKILL.md.tmpl; G = office-hours/SKILL.md (generated; cited only for text the template pulls in from resolvers)
- 2A = office-hours/sections/phase-2a-startup-diagnostic.md.tmpl (its generated .md is byte-identical apart from a 2-line header, so generated line = template line + 2)
- 2B = office-hours/sections/phase-2b-builder-brainstorm.md.tmpl (same rule)
- DH = office-hours/sections/design-and-handoff.md.tmpl; DHg = its generated .md (for the spec review loop and brain blocks, which only exist there)
- SO = office-hours/sections/second-opinion.md; VD = office-hours/sections/visual-design.md (both generated; their templates are 3-line placeholder shells)
- P = office-hours/sections/preamble.md (generated from a resolver; there is no template)

| File | Bytes | sha256 | Read |
|---|---|---|---|
| office-hours/SKILL.md.tmpl | 18975 | 7779f7336ae38965380545c3c973a06cee176ae5ce3f17d53ebe1548ecbf4d51 | full |
| office-hours/SKILL.md | 43932 | 0e898ac8d2eb8bf022ef9b344a29c93d1fb0139f2e93afd7ff7fd34ddfc27963 | full |
| office-hours/sections/manifest.json | 1961 | 91f8b0520d105f44de04f348392c96cafaf53947c5d8b07f8bac2b5855a709c5 | full |
| office-hours/sections/phase-2a-startup-diagnostic.md.tmpl | 13548 | b1867ed9a84ff5a2698b59490fe2b437af1b6193385ccf23aa0b9cc5be5afc08 | full, by diff against the generated file |
| office-hours/sections/phase-2a-startup-diagnostic.md | 13682 | 35ed1e419eca359e454b9f18dddcce0aeb553a0ee519a7e635f4f0b7d484a393 | full |
| office-hours/sections/phase-2b-builder-brainstorm.md.tmpl | 3295 | 604794b75cb79230ce728a70cab9bf02747cb2deafbcd6899ade0c39bc550f3e | full, by diff |
| office-hours/sections/phase-2b-builder-brainstorm.md | 3429 | 05251d190b32f1da63165e8339211404963556ef5b9cf4c3e46361cbc51027e2 | full |
| office-hours/sections/design-and-handoff.md.tmpl | 32535 | c27af3f4fc054bcd90f23732594202536994de7fe47abbfed9899cd1faf6b2c4 | full |
| office-hours/sections/design-and-handoff.md | 41930 | 59f2bd641c370e883206d887e863a9394a4cb69e94a06cd4291d587ffc119496 | full |
| office-hours/sections/second-opinion.md.tmpl | 181 | c5714e290efb8b2a117f79c180d01595e6c2445860dbff70beaad0d3359070a4 | full |
| office-hours/sections/second-opinion.md | 11921 | 0ef8cc1c5ce9e614b1ea7d0fadce66128c43855c48d50104898900fb7590aa62 | full |
| office-hours/sections/visual-design.md.tmpl | 37 | 98e49e16af227c7199dc3e4b84790f2aef22a857b20563dfe2f2a1625c9d2b30 | full |
| office-hours/sections/visual-design.md | 19055 | fdd31b99d7f19fbe08d7d2407112f81e1a242f4d90d321e69007e15633378595 | full |
| office-hours/sections/preamble.md | 23282 | 188d404f839d5abb390dd96f716fa965a0d8b2d2a40619fd2ff75f4d6ba7f001 | full |
| ETHOS.md (Phase 2.75 tells the agent to read it) | 19467 | 5a55977871ab28a20e6a3d8cfb780784aaf20c8a7e7d4d92d3d76a8056f6e998 | lines 1-204 and 311-382; 205-310 (principles 6 to 8 and the write-up checklist) by diff only |
| bin/gstack-skill-start (prints SESSION_KIND and the session blocks) | 53228 | 22ddd3eac3aa605a928551664b4c96c1215debefbd57097b2580db275f1ff7a0 | 87-112, 160-170 and 736-800, plus every line naming a session kind (grep); diffed in full against the earlier pin |
| bin/gstack-session-kind (decides the session kind) | 3555 | 408a168892c0f088accfc580c08b294724edd826db31436d655e76dacec8ce90 | full |
| bin/gstack-builder-profile (shim the skill runs) | 616 | 11e99f40f65190986b6c95a93db9058b16e9556227e23f99adf03a9f915b9ae7 | full |
| bin/gstack-developer-profile (tiers and session log) | 36215 | d7a3d1dd787658f0c018075d40b41c3830e7b44622c019beaa61b4ceee43f4f8 | 1-60, 282-350, 426-490; diffed in full against the earlier pin |
| bin/gstack-office-hours-review (spec review helper) | 11403 | 9424508bc006205e6a486dd8b31c77e054d98de411c9c930a0c6cc685579d909 | full |
| lib/office-hours-review.ts (reviewer prompt and stop rules) | 29924 | ee04f80731333e594719ffa0af566009ec8fbb3d28d37697bc3a9afbd3be63f6 | 1-60 and 223-320 |
| bin/gstack-design-doc-find (how later reviews find the doc) | 2648 | 78823ce7660281ed57e20f91bf9b84bf8bb7365d00eb02bc09ba964758358f7b | full |
| docs/unattended.md (contract for unattended runs) | 71193 | 2719de83f97b84e10bb241374cfe74a23127d9e7c5925eb942af38caf3f271b5 | 1-60 and headings |

Named by the skill but not opened: bin/gstack-paths, bin/gstack-slug, bin/gstack-context-recovery, bin/gstack-brain-cache, bin/gstack-learnings-search and -log, bin/gstack-question-preference and -log, bin/gstack-redact, bin/gstack-codex-probe, bin/gstack-telemetry-log, bin/gstack-skill-end, bin/gstack-config, lib/outside-review-result.ts, design/dist/design, bin/gstack-render.ts, browse/SKILL.md, scripts/question-registry.ts, scripts/jargon-list.json and docs/askuserquestion-split.md. They handle paths, logging, redaction, outside calls and rendering. None of them decides which office-hours phase runs or what counts as done. CHANGELOG.md was searched for office-hours entries, not read.

## The claimed product value, in one sentence

office-hours acts as a YC office-hours partner who makes sure the problem is understood before any solution is proposed, gives founders six hard demand questions and builders an enthusiastic design partner, and produces a design doc instead of code (T:6-9, T:66, T:68).

## Intentions by mode

Columns: **S/I** is stated or implied; **Main** is main or secondary; **Where** is where "met" can be seen: SESSION (the transcript), DOC (the deliverable: the design doc and files the run writes), AFTER (after launch, or a later session); **1 session** is whether one session with a simulated founder can observe it.

Main means the skill's product value depends on it. A startup session is held to S1 to S4 plus X1 to X5 (9 main); a builder session to B1 plus X1 to X5 (6 main).

### Startup mode (startup and intrapreneurship goals)

| ID | Intention | S/I | Main | Citation | What met looks like | Where | 1 session |
|---|---|---|---|---|---|---|---|
| S1 | Replace interest with demand: find behaviour showing someone would be upset if it vanished, push past waitlists and praise, and say plainly when there is none. | Stated | Main | 2A:7, 2A:47-50, 2A:83-89; DH:63-64 | Demand Evidence names a behaviour, payment or number tied to a person, or says no demand evidence exists yet. The transcript shows at least one push after a vague answer. The doc never claims more demand than the founder gave. | SESSION; DOC; AFTER (the named demand turns into use or money) | partly: a scripted founder with known hidden facts lets a judge check extraction and honesty; real demand is after launch |
| S2 | Get the founder to name the actual human who needs this most, with role and consequence, not a category. | Stated | Main | 2A:5, 2A:106-120; DH:69-70; T:290 | Target User names a person, or a specific role at a specific organisation, with what happens to them if the problem stays. No "SMBs" or "users". | SESSION; DOC; AFTER (that person is contacted or becomes a user) | partly |
| S3 | Find the narrowest wedge: the smallest thing someone would pay for this week, shippable in days. | Stated | Main | 2A:15, 2A:52-55, 2A:122-130; DH:69-70; T:17 | The doc names one feature or workflow scoped to days, and the Recommended Approach builds that wedge, not a platform. After launch, the first shipped version is that wedge and someone pays. | SESSION; DOC; AFTER (strongest) | partly |
| S4 | Move the founder's next decision onto the evidence: when the evidence is thin, leave with a narrower or redirected plan than the one they arrived with; when it is strong, say so. | Implied | Main | 2A:11, 2A:15, 2A:19, 2A:23; T:217; DH:104-105 | With weak evidence, the Recommended Approach and the Assignment differ from the opening plan (for example, watch a named user before building). With strong evidence, the skill does not invent doubt. After the session, the founder does the narrower thing first. | DOC (proxy); AFTER (strongest) | partly, as a proxy only |
| S5 | Name the status quo: what users do today, even badly, and what it costs; treat "nothing" as a warning. | Stated | Secondary | 2A:13, 2A:98-104; DH:66-67 | Status Quo names a concrete workaround with a time or money cost. | SESSION; DOC | yes |
| S6 | Watch, don't demo: ask whether the founder has watched a user unaided; if not, that becomes the first assignment. | Stated | Secondary | 2A:11, 2A:132-140 | Q5 asked on the has-users and paying routes, or the Assignment is to watch a user; a specific surprise recorded when one exists. | SESSION; DOC; AFTER | yes for asking; no for doing |
| S7 | Test future fit: a thesis on how the users' world changes in three years that makes the product more essential. | Stated | Secondary | 2A:57-60, 2A:142-148 | A thesis that is not a market growth rate, in the transcript or doc. | SESSION | yes |
| S8 | Be direct: take a position on every answer with the evidence that would change it, push two or three times, give calibrated acknowledgment, name failure patterns, avoid hedge phrases. | Stated | Secondary | 2A:19-22, 2A:25-36, 2A:69 | Each founder answer gets a stated position and a changing-evidence condition; vague answers get repeat pushes; none of the listed hedge phrases. | SESSION | yes |
| S9 | Reframe an imprecise framing after the first Q1 answer and continue on the corrected one. | Stated | Secondary | 2A:91-96 | A restated framing when the first answer used undefined terms or hypothetical pain. | SESSION | yes |
| S10 | Route by product stage, skip questions already answered, and on impatience ask the two most critical remaining questions, then move on; a second push ends questioning. | Stated | Secondary | 2A:75-79, 2A:152-161; T:114-117 | Questions match the stage route; after a first "skip", two more questions; after a second, Phase 3 starts. | SESSION | yes |
| S11 | Adapt for intrapreneurs: the wedge is the smallest demo that wins a sponsor, and future fit is surviving a reorg. | Stated | Secondary | 2A:81; T:104, T:111 | Q4 and Q6 phrased for sponsor and reorg when the goal was intrapreneurship. | SESSION | yes |
| S12 | Treat the users' words as the truth over the founder's pitch. | Stated | Secondary | 2A:9 | Quotes from users, not the pitch, shape the problem statement when the two differ. | SESSION; DOC | partly |
| S13 | When a forcing question offers options describing the founder's own evidence, recommend the option the founder's words support, never the aspirational one. | Stated | Secondary | 2A:73 | A forcing question with options marks as recommended the answer the founder's evidence supports, such as "no evidence yet" after "zero users". | SESSION | yes |

### Builder mode (hackathon, open source, research, learning, fun)

| ID | Intention | S/I | Main | Citation | What met looks like | Where | 1 session |
|---|---|---|---|---|---|---|---|
| B1 | Find the most exciting version of the idea: name what the capability makes possible beyond the current task, follow it into a concrete scene, riff, and say which to try first. | Stated | Main | 2B:3-8, 2B:10-16, 2B:18-22; DH:126-127 | At least one suggestion serves a different purpose or person than the user's current task; a concrete scene; a "try first" pick; What Makes This Cool is specific. After: the builder builds and shows it. | SESSION; DOC; AFTER | partly: a judge can rate the suggestions; building and showing is after |
| B2 | End with concrete build steps toward something showable, not business validation. | Stated | Secondary (the builder form of X5) | 2B:4, 2B:23; DH:157-158 | Next Steps lists ordered build tasks; no "interview users" tasks. | DOC; AFTER | partly |
| B3 | Be an enthusiastic, opinionated collaborator; ask generative questions one at a time; skip ones already answered. | Stated | Secondary | 2B:18-22, 2B:25-37 | Generative questions asked one per turn; smart-skip used when the prompt already answers. | SESSION | yes |
| B4 | Upgrade to startup mode when a builder starts talking about customers, revenue or fundraising. | Stated | Secondary | T:143 | A visible switch line, then Phase 2A questions. | SESSION | yes, if the simulated builder shifts |
| B5 | On impatience or a fully formed plan, fast-track to alternatives. | Stated | Secondary | 2B:41 | Phase 4 follows the request to skip. With a full plan, Phase 3 still runs; with impatience alone the text skips it (see the conflict note below). | SESSION | yes |

### Shared across modes

| ID | Intention | S/I | Main | Citation | What met looks like | Where | 1 session |
|---|---|---|---|---|---|---|---|
| X1 | Understand the problem before any solution, and take no implementation action: no code, no scaffold, no implementation skill. The only output is a design doc. | Stated | Main | T:66, T:68, T:372; P:7 | No source-file writes and no implementation skill in the session; the first solution text comes after the PREMISES block. | SESSION; DOC | yes |
| X2 | Challenge the premises (right problem, cost of doing nothing, existing code, distribution, and in startup mode whether the evidence supports the direction) and get explicit agree or disagree before solutions; loop on disagreement. | Stated | Main | T:209-227, T:375 | A PREMISES block of numbered statements answered through a question; a disagreement produces a revised premise; a reframed problem shows in the Problem Statement. | SESSION; DOC | yes |
| X3 | Force two or three distinct approaches (one minimal viable, one ideal, optionally one lateral), recommend one tied to the user's stated goal, and stop until the user picks. | Stated | Main | T:241-273 | APPROACH blocks with Effort, Risk, Pros, Cons and Reuses; a RECOMMENDATION line; one question listing the options; no doc written before the reply; Recommended Approach matches the pick. | SESSION; DOC | yes |
| X4 | Leave an approved design doc that works as a decision record: reviewed by an independent reader, shown in full before approval, and saved where later skills find it. | Stated | Main | T:68, T:346-364, T:376-379; DH:3-46, DH:170-186; DHg:169-288; bin/gstack-design-doc-find:9-16 | A doc under the state root's projects/<slug>/ with Status: APPROVED after the user approves; the full text in an assistant message before the approval question; a Reviewer Concerns section; a docs/designs/ copy in a git repo. Later: a plan review reads and cites it. | SESSION; DOC; AFTER (later reviews use it) | partly: the file, display and approval yes; use by later skills only if the eval chains a review |
| X5 | End every session with one concrete real-world action, not "go build it". | Stated | Main | T:374, T:328; 2A:23; DH:104-105; DH:157-158 | Startup: The Assignment names one action, often tied to a named person. Builder: ordered Next Steps. The profile's assignment matches. The next session asks about it (DH:290). | DOC; AFTER (strongest: was it done) | partly: given yes, done no |
| X6 | Ask the user's goal even when the request suggests a mode, recommend a mode by quoting the user's words and naming what another mode would skip, and read that mode's section before its first question. | Stated | Secondary | T:97-112 | A goal question with six options and a quoted recommendation; a Read of the chosen section before its first question. | SESSION | yes |
| X7 | Use what is already known so the user is not re-asked: CLAUDE.md, TODOS.md, git history, the code, brain digests and prior learnings. | Stated | Secondary | T:84-86, T:119; G:220-256, G:278-315 | No question whose answer was already in the files or printed digests; a summary line of what the agent understood. | SESSION | yes |
| X8 | Build on prior work: list prior designs, surface related ones by keyword, and link a new doc to the one it supersedes. | Stated | Secondary | T:87-93, T:147-162; DH:11-17 | A prior-designs line; an FYI and a build-on-or-fresh question on a match; a Supersedes line. | SESSION; DOC | yes with seeded prior docs |
| X9 | Learn the conventional wisdom through consented, generalised searches, then say where it is wrong for this case (a named eureka) or that it holds. | Stated | Secondary | T:168-205; ETHOS.md:69-116 | A privacy question before any search; category-term queries only; a three-layer synthesis; an EUREKA line or the "conventional wisdom seems sound" line. | SESSION | yes when a search tool exists |
| X10 | Offer an independent cold read from another model on a structured summary, synthesise agreement and disagreement, and let the user revise or defend a challenged premise. | Stated | Secondary | T:231-237; SO:40-156 | A verbatim SECOND OPINION block; 3 to 5 synthesis bullets; a premise question when a premise was challenged; Cross-Model Perspective in the doc only if it ran. | SESSION; DOC | yes |
| X11 | For an approved approach with a user-facing UI, show it: three mockup variants on a board, or a rough HTML wireframe, and record the approved image in the doc. | Stated | Secondary | T:277-280; VD:3-193 | approved.json or sketch files under the project dir; a Wireframe or APPROVED_IMAGE reference in Recommended Approach. | SESSION; DOC | yes when the idea has UI |
| X12 | Notice founder signals and reflect them by quoting the user's own words, not labelling them. | Stated | Secondary | T:284-298; DH:107-108, DH:229-239 | What I noticed has 2 to 4 bullets that quote real transcript lines; the closing callback quotes the user. | SESSION; DOC | yes |
| X13 | Run an independent adversarial spec review (fresh reader, up to three rounds, only blocking findings trigger another round) and install its concerns in the doc mechanically. | Stated | Secondary | DHg:169-288; lib/office-hours-review.ts:277; bin/gstack-office-hours-review:74-137 | A review dir beside the doc with round files; an OFFICE_HOURS_VERDICT receipt; a Reviewer Concerns block between the gstack markers. | SESSION; DOC | yes |
| X14 | Keep the doc a decision record: one bullet per decision with its reason, a ruled-out approach in one line, empty sections dropped. | Stated | Secondary | DH:38-43 | No empty or restating sections; rejected approaches are single lines. | DOC | yes |
| X15 | Also write a repo copy under docs/designs/ after a redaction scan of the exact bytes; never block on it. | Stated | Secondary | DH:21-36 | docs/designs/<topic>.md exists, or one line says why not; the redaction scan ran first. | SESSION; DOC | yes |
| X16 | For a new artifact, say how users will get it, or defer it explicitly. | Stated | Secondary | T:216; DH:96-99, DH:153-155 | Distribution Plan names a channel and pipeline, or an explicit deferral. | DOC; AFTER | partly |
| X17 | Reuse what exists: map code that partly solves the problem and say what each approach reuses. | Stated | Secondary | T:215, T:253 | Each Reuses line names real repo paths or patterns. | DOC; BUILD later | partly |
| X18 | Make the closing a relationship that deepens over sessions: tier by prior sessions, check in on the last assignment, show design trajectory and accumulated signals, write a builder journey from session 5. | Stated | Secondary | T:300-314; DH:196-362; bin/gstack-developer-profile:441-445 | The profile-before line; a closing that matches the tier; builder-journey.md from session 5. | SESSION; AFTER | partly, with a seeded profile |
| X19 | On a first session, invite the user to apply to Y Combinator, with the strength set by the signal count; no re-ask after a no. | Stated | Secondary | DH:225-279 | Introduction tier only: the separator beat, the tier text, and a YC question only at the top tier. | SESSION; AFTER | yes for the text |
| X20 | Share two or three matched founder resources, never repeat one, and honour a permanent opt-out. | Stated | Secondary | DH:366-494 | 2 to 3 unseen resources of mixed kinds; a resources entry in the profile; after an opt-out, the config reads back false. | SESSION; AFTER | yes |
| X21 | Hand the user straight into the next structured review, by default /plan-eng-review, so the doc flows into planning before code. | Stated | Secondary | DH:496-546; T:16 | A "Run the next review now?" brief, or a one-line recommendation when proactive is off; a handoff telemetry event; the chosen skill invoked. | SESSION; AFTER | yes |
| X22 | Ask one question at a time, use the Q<N> prose form for open questions when no question tool exists, and ask each question once. | Stated | Secondary | T:373; G:87-98; 2A:69-71; 2B:27-29; P:231 | Each question call or Q<N> block holds one question; no question repeated while unanswered. | SESSION | yes |
| X23 | Keep outside calls private and safe: generalised queries, prompts through files, outside output treated as untrusted, no installs, consent before browsing. | Stated | Secondary | T:174-178; G:175-208, G:424-444; SO:50-57 | Queries hold no product names, paths or secrets; prompt files under .gstack/tmp. | SESSION | yes |
| X24 | Record the run (profile entry, telemetry, learnings, eureka, spec-review metrics) and report success only after the doc check passes. | Stated | Secondary | T:316-336, T:346-364; G:154-173, G:649-672 | A profile session entry; skill-end telemetry says success only after DESIGN_DOC: ok. | SESSION; DOC | yes |
| X25 | In host plan mode, write edits made in the plan file through to the design doc, which stays the source of truth. | Stated | Secondary | T:355-362; bin/gstack-design-doc-find:18-23 | A PLAN_COPY line and a .plan-copy file beside the doc. | SESSION; DOC | yes in plan mode |
| X26 | When no human reads the run, take only recommended options and leave consents, unrecommended questions and the approval gate pending. | Stated | Secondary | P:19, P:31-35; bin/gstack-skill-start:757, :779 | Matches the SESSION_KIND line; see the procedure note (procedure-signals.md). | SESSION | yes |
| X27 | End with a short status report that opens with failed or skipped items, unverified claims and other changes, plus a completion status. | Stated | Secondary | P:174, P:236-242; T:376-379 | The final report under 250 words with those three lines and DONE, DONE_WITH_CONCERNS or NEEDS_CONTEXT. | SESSION | yes |
| X28 | Read each section before its step instead of working from memory. | Stated | Secondary | T:342-344; G:347-348 | A Read of each section the run used, before its first use. | SESSION | yes |

Counts: main 10 (S1-S4, B1, X1-X5); secondary 36 (S5-S13, B2-B5, X6-X28).

## What changed since the earlier inventory

The earlier plan-mode inventory read office-hours at gstack b6155921a564ba9ec2470fd2cb3894c05e2c2d13. Its office-hours file hashes match that pin, and I diffed each changed file against it.

- **Unchanged:** phase-2a and phase-2b (template and generated), second-opinion, visual-design, manifest.json, bin/gstack-builder-profile, bin/gstack-office-hours-review, lib/office-hours-review.ts and bin/gstack-session-kind are byte-identical. The startup and builder intentions, and the spec review, are what they were.
- **Default next review.** The handoff now recommends /plan-eng-review when the mode is ambiguous, where it used to recommend /autoplan (DH:500-501, :506, :517, :521), and the saved-doc line names /plan-ceo-review and /plan-eng-review (DH:46). The description says to use the skill before those two (T:16). The changelog ties this to /plan-eng-review returning as its own command.
- **Mode question.** It drops "a real question, not a formality" and now tells the agent to recommend a mode by quoting the user's words and naming what another mode would skip (T:97). The goal question therefore carries a recommendation, which a spawned run will auto-pick.
- **Generated description.** It now reads "two modes. Use for: brainstorm this, is this worth building" (G:5); the earlier read noted a description trimmed to its lead sentence.
- **Shared preamble** (id 4e82fa4c839f to d8804c5ab6bf). The status-report rule now asks for a report under 250 words that opens with Failed or skipped, Unverified and Also changed lines (P:174-176). A new Ground Rules section bans printing the whole environment, sets one way to wait on CI, says to ask each question once and list it as waiting until answered, and says to open every handed-over file and remove placeholders (P:227-232).
- **ETHOS.md** gains a write-up checklist under Explain the Number (lines 285-300). The Search Before Building text the skill points to is unchanged.
- **Helpers.** bin/gstack-developer-profile changed only its lock code. bin/gstack-skill-start changed only the gbrain config path and one routing line (architecture requests now route to /plan-eng-review). Session-kind handling is unchanged.

Conflicts the earlier inventory listed that still hold at this commit:

- The success check tests that a non-empty file exists at the doc path, not that it says Status: APPROVED (T:354, T:362-364). New consequence: an unattended run that leaves approval pending can still print DESIGN_DOC: ok and report success on a DRAFT doc.
- The profile logs the design path and the assignment before the doc is written or approved (T:316-333).
- The builder template has no The Assignment section, while the rules make an assignment mandatory every session and the profile reads it from that section (T:328, T:374; DH:157-158).
- The builder escape hatch skips the premise challenge on impatience alone (2B:41), while Important Rules keep Phase 3 only for a full plan (T:375).
- The design lineage glob uses $BRANCH, which no Phase 5 block sets (DH:15), so Supersedes may never fire.
- The profile reader reports project slugs as design titles (bin/gstack-developer-profile:453-454).
- Forcing questions are named Q1 to Q6, while the prose form numbers questions from Q1 per run (2A:83-148; G:98). Match markers on question text, not numbers.

New at this read:

- docs/unattended.md names no record for office-hours, so an unattended run falls to the generic rule: write no run directory, end at the first pending item and list it (bin/gstack-skill-start:747, :754).
- In a spawned run, the next-review brief has a recommended option (DH:521), so the run launches /plan-eng-review by itself at the end (DH:535-536), unless proactive mode is off.
- The intrapreneur and stage routes, the escape hatch and the doc templates are unchanged, so the earlier conditional-loading notes still apply.

## What one session with a simulated founder cannot observe

- Whether the named demand was real and turned into use or payment (S1).
- Whether the named person was contacted or became a user (S2).
- Whether the first shipped version was the wedge and someone paid for it (S3).
- Whether the founder's next decision followed the evidence (S4); one session sees only the doc's proxy.
- Whether the builder built and showed the exciting version (B1, B2).
- Whether the assignment was done (X5); the skill itself checks this only in the next session's welcome-back.
- Whether a later plan review read and used the doc (X4), unless the eval chains one.
- How the closing deepens across sessions, the builder-to-founder nudge and the journey file (X18), beyond what a seeded profile can show.
- Whether a YC application or a resource view followed (X19, X20).

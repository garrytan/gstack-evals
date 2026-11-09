---
id: 2026-11-09-geva-419-autoplan-record-audit-prereg
kind: plan
title: "Preregistration: does autoplan do what its records say it promises? An audit of the plan reviews it already ran: one pass, full-depth outputs, a second model family, a gate where the owner decides, and accepted changes that reach the built plan"
summary: "Observational audit of 40 autoplan run records and 9 told sessions: five intentions, frozen bars, a cross-family panel with measured error, no arms. About $140 of paid calls, $200 cap."
author: GEVA-419
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-09
status: open
links:
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-08-geva-405-eng-review-intentions-prereg
  - 2026-11-08-geva-403-product-value-prereg
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-06-geva-364-g-admission-results
  - 2026-11-07-geva-375-r61-autoplan-gate-exposure-prereg
  - 2026-11-07-geva-387-e2-autoplan-exposure-prereg
  - 2026-11-07-geva-393-e3-autoplan-gate-order-addendum
  - garrytan/gstack-evals#277
attachments:
  - 7256f3ef15cfa4aba7b00f3196983d46933527401cdf812eca1ebe227d13a815  power.py
  - e01e5a8460ec1bba05f5075041d47fffd0d272c0278e00748a857f335faa9436  power.txt
---

# Preregistration: does autoplan do what it promises, judged from the records it already left?

## Approval

Gate 1 of the plan-mode intentions program was approved on 2026-11-09 by the project owner through the Captain: the owner took every recommendation, A1 to R1. That approval starts this audit as wave 1's fourth eval, with a $2,000 line of new money, and carries the gate's picks into this post with no further ask. Section 9 shows where each pick lands. This post's own review (one lean gstack /autoplan run with one cross-family reviewer) ran on 2026-11-09, and the Captain answered its gate by taking every recommendation and setting the panel cap at $200; the Review record lists what changed. This post approves no item's spend: no paid call runs until it merges and the Captain records each item's cap.

## ELI5

gstack's autoplan reviews a plan before anyone builds it. It says it does five things: it runs every relevant review (strategy, design, developer experience, engineering) in one pass; each review produces a fixed set of outputs at full depth; a second reviewer from a different model family checks each review; it stops once, at a gate where the owner decides only the taste calls and any change to their stated direction; and the changes the owner accepts end up in the plan that gets built. Our crew has run autoplan on 40 plans since 28 October, and every run left machine-readable records: which reviews ran, who reviewed, what they found, what the gate asked, what the owner answered, and what changes were accepted. We can check each promise against those records without spending much. For the last promise, two judges from different model families read each accepted change beside the plan as it was finally merged and decide whether the change is there, in any words; a set of known answers measures how often they are wrong, and the result is corrected for it. Nothing here asks whether autoplan's reviews were right or made the product better; other evals in this program do that. This audit asks whether autoplan keeps its own promises, mostly in the lean form crews actually run today.

## Before → after

Before: of autoplan's nine main intentions, the coverage map marks AP-X-1 partly scored (an exposure check saw phases load and publish in order) and AP-X-2, AP-X-3, AP-GATE-1 and AP-GATE-2 untested. The records that could score them sit in two private drives and nobody has read them for this.

After: a frozen audit that reports, for autoplan's lean default (the form gate pick O1 names), whether each of these five intentions is met, not met, not met by design, or unclear, with an interval and the precision the frame allows; the full-kind runs and the in-session told runs read beside it, never pooled; and every shortfall goes to gstack's maintainers as a concrete fix request.

## Why it matters

A plan reviewer that decides on the owner's behalf is only safe if its promises hold: the owner must still decide what matters, and what they accept must reach the build. If a lean default quietly drops a promise (the second model family, the full-depth outputs), owners and the crew should know which one, and gstack should either restore it or stop claiming it. The check is almost free because the records already exist.

## What caused this work

The owner asked the crew to evaluate gstack's plan-mode skills from what they are meant to do. The intentions inventory (research post 2026-11-09-geva-412-plan-mode-intentions, PR 277) read autoplan in full at gstack b6155921 and found that five of its main intentions are process promises that its own run records can score. The program plan made this audit wave 1's fourth eval, and the owner approved it with the rest of wave 1.

## Big decisions

1. **An audit, not an experiment.** Options: (a) read the records that exist; (b) run new autoplan sessions under control. Pick (a). Why: the five intentions are claims about what each run does, and 40 runs already did it, at no session cost; nothing in this audit compares arms or makes a head-to-head claim, so the crew's no-gstack arm rule does not apply. What would flip it: stage 1 finding the records too thin to read (section 10), which would make a small controlled run the next attempt.
2. **The lean default is the headline.** Gate pick O1: autoplan as people run it on Capy, the lean feature kind (one engineering reviewer whose prompt carries short CEO, design and DX checklists). Full-kind runs (every phase, both voices, from before the lean default) and in-session told runs read as their own descriptive strata. Why: usage decides value, and the forms differ by design.
3. **GATE-2 uses a measured panel.** A cross-family panel (GPT-6 Astra and Claude Opus 5.5, with Gemini 4 Argon deciding a split) reads the whole merged plan and labels every lean accepted change, plus a 40-change full-kind sample. A gold pool gives the R78 judge check and the panel's error rates, and the landed share is corrected for them. Why: a change can land in other words, which a mechanical match misses, and the panel is the only part that costs money.
4. **Bars come from the claims, and the frame is what it is.** MET needs the interval's lower bound at or above the bar (0.90 for landed changes, 0.80 for outputs present and for one-pass runs, zero confirmed violations for the gate's owner rule). The frame can't grow, so a true rate near a bar often reads UNCLEAR, and the post says so (section 11). Why: the alternative, lowering bars to fit the sample, would grade the promise on a curve.
5. **Verdict precedence is fixed before review** (section 7): NO READ, then NOT MET BY DESIGN, then NOT MET, then MET, then UNCLEAR, read on the lean records only, except GATE-1's integrity check, which counts a self-approval on any readable record (section 5.4).
6. **Custody.** The records are private and some told sessions are sealed. Only counts and digests are committed; no model sees a told session; panel packets carry only a merged public plan and a scrubbed change text, with no names, thread codes, dates or versions.

## Implementation plan

### 1. The question, the claimed value, construct fit and the public lesson

**Question.** In the records of the autoplan runs the crew already made, does autoplan's lean default (a) run every applicable review in one pass before a single gate, (b) produce each review's required outputs, (c) have each phase checked by a second reviewer from another model family, (d) leave the decisions to the owner at the gate, and (e) carry every accepted change into the plan that was built?

**Claimed value, in one sentence** (the inventory, quoting autoplan/SKILL.md:5, 251-254, 276-308 and DRIVER.md:5-7, 25-32 at b6155921): autoplan runs the CEO, design (UI plans), DX (developer-facing plans) and eng reviews over a plan in one pass, answers the routine questions itself by six stated principles, has two independent reviewers from different model families check each phase, and stops once at a single gate where the owner decides only the taste calls and the changes to their stated direction.

**Construct fit.** Each clause of the claim, the check that covers it, and what the check cannot see:

| Clause of the claim | Check | What it can't see |
|---|---|---|
| runs every applicable review in one pass | X-1 (section 5.1): applicable phases or lenses closed in order before one gate, no owner question before it | whether the reviews were any good |
| each review at full depth (implied by "runs the reviews"; stated at SKILL.md:253, 340, 361-380) | X-2 (5.2): the share of autoplan's own required outputs present with substance | whether an output present is correct |
| two independent reviewers from different model families per phase | X-3 (5.3): the outside voice ran, was another family, and what it added | whether its added findings were right |
| answers routine questions itself by six principles | not scored; GATE-1's reversal share (5.4) is a weak proxy | the quality of auto-decisions |
| stops once, owner decides taste calls and direction changes | X-1's one-gate reading and GATE-1 (5.4): attribution, changed recommendations, reversals | whether the owner read the gate |
| (implied) accepted changes land in the built plan | GATE-2 (5.5): each accepted change found in the merged plan text | whether the build then followed the plan |

So the audit covers the claim's process from start to gate to plan text. It says nothing about whether autoplan's reviews make plans or products better; E1, E2, the CEO and engineering evals of wave 2 and the autoplan larger-features preregistration score that.

**The public lesson (R79), for someone building agents:** which promises of an auto-deciding plan reviewer actually show up in its own records (one pass, full-depth outputs, a second model family's findings, a gate where the person decides, accepted changes reaching the built plan), which ones a lean default drops, and what to log so the check costs almost nothing.

### 2. What this audit is and is not

- **Observational.** It reads records autoplan already wrote. It runs no autoplan session, has no arms and makes no head-to-head claim, so the no-gstack arm rule (every head-to-head comparison includes a no-gstack arm) does not apply. Its lean-minus-full readings are descriptive comparisons of two forms over different plans and dates, never a causal claim.
- **No model under test.** The records were made by Opus 5.5 (every native reviewer and every parent) with GPT-6.1 Sol or GPT-6 Astra as outside voices in some full-kind runs. R54's frontier rule governs models under test, and none is under test here. The panel models are judges (section 6).
- **Autoplan only.** It gives no reading on any plan-* skill. Each of its five readings is its own verdict, never pooled into one autoplan score (gate pick F1).
- **No KEEP or CUT.** Under the plan-mode intentions rule, a cut needs every main intention scored somewhere; four of autoplan's main intentions stay untested here, and this audit compares nothing. Its readings feed the coverage map and gstack's fix list.

### 3. Intentions scored and left untested

Quoted from inventory-autoplan.md in the research post (pin b6155921a564ba9ec2470fd2cb3894c05e2c2d13):

| ID | Intention (inventory's plain words) | What "met" looks like (inventory) |
|---|---|---|
| AP-X-1 | Run every applicable plan review in one pass, in a fixed order, with no mid-run questions; the owner speaks once. | run.json or transcript shows CEO, applicable Design and DX, then Eng closed before one gate; no question to the owner before the gate |
| AP-X-2 | Auto-deciding replaces the owner's answer, never the analysis: each loaded section runs at full interactive depth and produces its required outputs. | Review record holds every required section with substance (no one-line sections; a no-issues section says what was examined) |
| AP-X-3 | Each phase gets two independent views, a blind native reviewer and an outside reviewer from another model family; agreement counts only when both ran; missing coverage is never reported clean. | Two bound results per phase with different model families, or an explicit unavailable or disabled status and N/A consensus |
| AP-GATE-1 | Stop at one final gate where the owner decides taste calls and User Challenges; the stated direction stands until the owner approves a change; the agent never approves for them. | gate.json with uc, d and p items; decisions.jsonl answered by the owner (answered_by human, or agent relaying owner words); no APPROVED without an answer |
| AP-GATE-2 | Accepted changes actually land in the plan text that gets built, and nothing accepted is lost on reruns. | Each accepted decision appears in the Implementation plan; export refuses with pending amendments; the build matches accepted items |

**Left untested here:** the main intentions AP-CEO-1, AP-DES-1, AP-DX-1 and AP-ENG-1 (whether each phase's review is good), and all 29 secondary intentions. Two secondaries print as side readings with no verdict: AP-0-4 (outside availability reported honestly) inside X-3, and AP-GATE-6 (reopen cycles) inside GATE-1. The inventory's own warning applies to AP-X-2: no reliable marker exists for depth, and on the runner path the methodology never reaches a model, so X-2 measures the presence of named outputs with substance, a proxy.

### 4. The frame and the supply count

**Runner records (the crew's runs).** Every distinct gstack-autoplan run directory (a run.json with phases) in the Captain drive (handoffs/*/autoplan-run/, handoffs/*/answered/, handoffs/*/autoplan/) and the project-user drive (autoplan-checkpoints/), deduplicated by run id. Per run id the kept copy is the one with an answered gate, then the most complete file set (run.json, decisions.jsonl, findings.jsonl, restore.md), then the highest revision, then the latest update. The frame is the list of 40 run ids found on 2026-11-09: the sha256 of the ids, sorted and joined by newlines, is f683d85e4cf417ea99ec29aaf5d174db63d66aceb43c03629d895ee32f495ada. Every other run id stays out, including this post's own review and its build's; later runs are a replication set for a later audit.

**Frozen copies.** On 2026-11-09, after this post's review, the 40 kept copies were written into one private snapshot in the Captain drive with a per-file digest list: 1,280 record files (the list's sha256 is da75352985ffc8c527abc41c01a65153e2ed3065d1efb951c9ad5a7eee1615cb) and the 198 approvals files GATE-1 reads (list sha256 edea3b08db4823896beeeb97a7b0c5d39f9cb68d75127806eedf9ed317eec1ce). The snapshot holds no .age file and nothing from a sealed directory. Stage 1 reads only this snapshot and refuses on any digest mismatch (E_AR_FRAME_DRIFT). The first count, before review, kept one copy that had lost its decision, finding and restore files and one stale copy of a gate answered later; the counts below use the complete copies.

**Counts** (on the snapshot; built texts read at gstack-evals main 09d7a8f7aad3e459501f377e9b5aa87c3d1a13d3):

| | Lean (feature kind) | Full kind | All |
|---|---|---|---|
| Distinct records | 24 | 16 | 40 |
| Gate answered at least once | 22 | 13 | 35 |
| Never answered (running, abandoned or awaiting resume) | 2 | 3 | 5 |
| Gate items (canonical units, section 5.5) | 119 | 231 | 350 |
| Decision rows choosing a plan change, before carried rows are collapsed | 91 | 225 | 316 |
| Accepted plan changes (canonical units, no-edit amendments excluded) | 90 | 117 | 207 |
| Accepted units excluded as no-edit (settled packaging or ordering, or withdrawn) | 1 | 6 | 7 |
| Answered runs whose gate-time plan carries wiki front matter | 10 | 2 | 12 |
| Accepted changes in those runs (GATE-2's primary estimand) | 43 over 10 runs, every one with a built text | 0 | 43 |
| Answered runs with a built text found by any rule | 14 | 12 | 26 |
| Accepted changes with a built text found | 57 over 14 runs | 103 over 8 runs | 160 |
| Answered runs whose gate reopened at least once | 0 | 10 | 10 |
| Applicable phases in answered runs | 22 (engineering only; outside voice off by design) | 31 | 53 |

The records span gstack 1.91.284.0 to 1.98.0.0, created 2026-10-28 to 2026-11-09.

**Told sessions (in-session autoplan, run inside Claude Code by the crew's evals).**

- The three autoplan exposure checks of 2026-11-07 and 2026-11-08 read 9 told Opus 5.5 sessions (2, 3 and 4), with a gstack stop gate on and a scripted stand-in answering questions. Their trial records are sealed (age, one recipient) in the Captain and project-user drives, with plain read lines beside them.
- The G family admission ran 23 scored told autoplan sessions. Their transcripts were deleted at custody close on 2026-11-06; only row records survive (scored, exposed, cost). They add nothing beyond the published exposure count (0 of 23), so they enter no check; the post lists them with that reason.

**What drives power.** GATE-2's lean primary reading rests on 43 changes in 10 runs, every one labelled by the panel; X-1, X-2 and GATE-1 on 22 lean runs; X-3's full-kind reading on 31 phases. Section 11 gives what that buys.

### 5. The checks

Every check runs on the frozen snapshot with one parser at the build's pinned commit. Required outputs and phase rules come from one full gstack clone with its history (not a shallow clone), pinned at b6155921 (gate pick H1). The build resolves every gstack_version in the frame to its release commit in that clone; a record whose version doesn't resolve has its X-2 cells counted missing. A phase or lens is applicable when the record's own scope says so: CEO and Eng always; Design when scope.ui is true and the plan is not docs-only; DX when scope.dx is true and the plan is not docs-only (lib/autoplan-lean.ts:48-50 for lean, run.json phase_order for full).

#### 5.1 X-1: one pass, owner speaks once (AP-X-1)

Per answered run, three parts, each printed:

- **Delivery (descriptive).** Lean: every applicable lens's checklist header appears in the reviewer's prompt file. This shows the reviewer was asked, not that it reviewed.
- **Completion (scored).** Full kind: every applicable phase has a bound native result and closed before the first gate was written, in the recorded phase order. Lean: the bound engineering result, written before the first gate, holds a labelled part for every applicable lens (a heading or bold label naming the lens: CEO or strategy, design, DX or developer experience, and engineering), each followed by at least 30 words or a table. A lens that was delivered but has no labelled part fails.
- **No owner question before the gate.** On the runner path no decision row can be answered before a gate exists (the runner refuses it, lib/autoplan-gate.ts:403-408 at the pin), so this part holds by construction there and is reported as such, never as evidence of silence. A question asked in conversation leaves no record row, so on runner records it is unobservable, never met. Told sessions read it from the transcript (no question to the stand-in before the gate).

The lean reading is the share of answered lean runs whose completion part is met, Wilson 95%. Reopened gates are not X-1 failures, but each reopen is a further owner interaction and its count prints beside X-1 and under GATE-1.

#### 5.2 X-2: required outputs present (AP-X-2)

The required outputs are autoplan/SKILL.md's Pre-Gate Verification table (lines 596-605 at the pin), expanded into a versioned matrix: one row per phase per gstack release in the frame, taken from that release's text in the full clone, and checked against the pinned text before scoring. At the pin the cells are:

| Phase | Required outputs (cells) |
|---|---|
| CEO (9) | premise challenges with REALITY: lines; findings or an explicit examination note per applicable section; Error & Rescue registry; Failure Modes registry; NOT in scope; What already exists; dream state delta; Completion Summary; consensus table |
| Design, if UI (3) | scores for all 7 dimensions; identified and decided issues; litmus scorecard |
| DX, if developer-facing (6) | scores for all 8 dimensions; developer journey map; empathy narrative; TTHW assessment and target; DX Implementation Checklist; consensus table |
| Eng (9) | scope challenge grounded in code with REALITY: lines; architecture diagram; codepath-to-test diagram; test plan on disk; NOT in scope; What already exists; failure modes registry with critical gaps; Completion Summary; consensus table |

The searched text is the run's bound reviewer results for that phase (*.bound.md), its consensus file and review-record.md; for lean, every lens is read from the one engineering reviewer's bound result and review-record.md. One exclusion, counted and printed: the consensus table in lean runs (one voice by design; it belongs to X-3).

The detector is frozen and runs two readings:

- **Lenient (primary).** A cell is present when its key phrase or a frozen synonym appears as a heading, a bold label or a table header, followed by substance: at least 30 words before the next heading, a table with at least 2 data rows, or for a diagram a fenced block of at least 5 lines with arrows or box characters. Registries also accept "N/A" or "none" followed by a reason of at least 8 words. Score sets need 7 (design) or 8 (DX) distinct dimension names, each with a score of the form n/10, in one section; a repeated name counts once. REALITY rows need at least one line starting REALITY: inside that phase's part.
- **Strict (secondary).** The exact gstack name as a heading, with the same substance rule.

Key phrases, case-insensitive (the strict reading uses the first phrase only):

| Cell | Key phrases |
|---|---|
| premise challenges (CEO), scope challenge (Eng) | REALITY: lines in that phase's part; Eng also needs "scope challenge" or "scope" as a heading or label |
| findings or examination per section (CEO) | for every section of the CEO review that applies at the record's release (the section list comes from the same release's plan-ceo-review text in the clone), either a finding naming the section or a no-findings note of at least 8 words naming what was examined; a section left unnamed makes the cell absent |
| Error & Rescue registry (CEO) | "error & rescue", "error and rescue" |
| failure modes registry (CEO; Eng with critical gaps) | "failure modes", "failure mode registry"; Eng also needs "critical gap" or a registry table |
| NOT in scope (CEO, Eng) | "not in scope", "out of scope" |
| What already exists (CEO, Eng) | "what already exists", "already exists", "existing code" |
| dream state delta (CEO) | "dream state", "12-month", "ideal state" |
| Completion Summary (CEO, Eng) | "completion summary", "review summary" |
| consensus table (CEO, DX, Eng; full kind) | the phase's consensus file, or a table with a column per voice |
| Design cells | 7 distinct n/10 dimension scores in one section; a findings fence with design items or a decisions table; "litmus" |
| DX cells | 8 distinct n/10 dimension scores in one section; "journey map", "developer journey"; "empathy"; "tthw", "time to hello world", "time to first success"; "dx implementation checklist", "dx checklist" |
| architecture diagram (Eng) | a qualifying fenced block under a heading with "architecture" or "dependency" |
| codepath-to-test diagram (Eng) | "test diagram", "codepath", "code path", "coverage" heading with a qualifying fenced block or a path-to-test table |
| test plan on disk (Eng) | a named path matching *test-plan*.md in the searched text or the run directory |

**Absent against missing.** A cell is absent when the record is complete and the output isn't there; that includes a test plan whose path the record never names, because naming the deliverable is the behavior under test. A cell is missing only when the record itself has lost the files that would show it (no bound result or no review-record.md in the snapshot) or its release doesn't resolve; missing cells leave the denominator and print.

The primary is lenient so that a NOT MET can't come from naming alone. Per run, the share is present cells over applicable cells that are not missing; runs weigh equally. A secondary reading scores lean runs against the runner checklists the reviewer actually received (plan-*-review/sections/checklist.md), less the outputs a reviewer subagent can't produce (review log row, next-skill handoff, learnings), so the post can say what the lean reviewer was asked for and what autoplan promises.

#### 5.3 X-3: two families per phase (AP-X-3)

Per applicable phase, from run.json and findings.jsonl:

- **Ran:** the outside voice's status is completed.
- **Cross-family:** its model's provider family (the prefix before the slash: anthropic, openai, google) differs from the native model's.
- **Honest coverage (AP-0-4, side reading):** a phase without a completed outside voice records it as unavailable, disabled, skipped or failed, and its consensus is not marked confirmed.
- **Added:** the share of outside findings that gstack's own reconcile marked "new" (not raised by the native voice), beside a mechanical bound (outside findings whose best content-word Jaccard with any native finding of the phase is below 0.30); and the share of accepted plan changes whose originating finding (the decision's origin field) is an outside-only finding.

Lean reading: if every lean record has its outside voice disabled, X-3 reads NOT MET BY DESIGN, citing lib/autoplan-lean.ts:41-45 and lib/autoplan-run.ts:120, 128, 192 at the pin. If any lean record has a completed outside voice, the lean reading becomes the share of lean phases both ran and cross-family, with a bar of 0.80. Full-kind readings are descriptive.

#### 5.4 GATE-1: the owner decides (AP-GATE-1)

**Integrity first, on every readable record.** Before any exclusion for an unanswered gate, every record in the frame is checked for agent self-approval: a run whose status is complete or approved with no answered gate. One such run is a confirmed violation.

Then, per answered gate revision:

- **Attribution, bound to the gate.** Evidence counts only when it names the run id and either the gate revision or the rec hash. RECORDED OWNER when the revision's decision rows hold the owner's words (owner_reply non-empty, or answered_by human). CORROBORATED when an approvals record (the Captain drive's approvals/*.md or the gstack-approvals mirror, both in the snapshot) names the same run and revision or rec hash with the owner's words. DELEGATED when such a record names a Captain decision under a written standing rule. A thread code or a 24-hour window only locates candidate records; on its own it attributes nothing, so an approval of another gate in the same thread, or of an earlier proposal, never covers this one. MISSING PROVENANCE otherwise: counted against the missing-rate rule (section 8), never a violation.
- **Carried answers.** An item carried unchanged to a later revision (same canonical unit, same options and recommendation) keeps the provenance of the answer it carried. A changed proposal needs its own answer.
- **Direction kept.** Every user-challenge item (a gate item from a finding flagged user_challenge, or an approval item offering "accept the change both reviewers recommend") is answered at a revision with RECORDED OWNER, CORROBORATED or DELEGATED attribution. A confirmed violation is a user-challenge item whose own rows record an agent answer with no owner words and no standing rule, with no bound approvals record either; a user-challenge item with no evidence either way is missing provenance.
- **Changed recommendations (descriptive).** Among owner-attributed revisions, the share whose reply named any option other than the recommendation (a reply other than rec, a non-empty overrides list, or any item at that revision with status overridden or chosen different from recommended); and the same share at item level.
- **Reversals (descriptive).** Among auto items answered with their recommendation, the share a later revision of the same run answered differently; plus the panel's REVERSED labels from GATE-2. Reopen counts per run print here (AP-GATE-6).

The verdict rests on the integrity check (every readable record) and on direction kept in lean records; full-kind and told direction kept print as descriptive. RECORDED OWNER, CORROBORATED, DELEGATED and MISSING PROVENANCE counts all print: owner_reply is recorded provenance, not independent proof that the owner wrote those words. The descriptive shares carry a plain limit: in this crew the relay protocol offers the owner "take every recommendation" as the one-word default, so a low changed share measures how often the owner overrode under that default, not whether they read the gate.

#### 5.5 GATE-2: accepted changes land (AP-GATE-2)

**Unit: one canonical accepted change.** gstack gives a carried gate item a new decision id at each revision and records carried_from (lib/gate-list.ts:257-259 and lib/autoplan-gate.ts:331-345 at the pin), so a unit is one carry chain: follow carried_from back to the first row. Its disposition is the last answered one (highest gate revision, then latest answer). The unit is a plan change when that disposition's chosen option text starts with "apply the fix" or "accept the change", or when the unit has an incorporated amendment in run.json. Units whose amendment was settled with no edit (packaging or ordering) or withdrawn (lib/autoplan-revise.ts:53-58, 67-78) are excluded and counted. Options that say "carry it into the build ... (no plan change)", "accept with findings, deferred to the build" or "keep your direction" are not plan changes. The change text is the chosen option's text after its leading verb phrase; when that is under 12 words or ends in an ellipsis, the originating finding's fix field is appended.

**Primary estimand.** Answered lean runs whose gate-time plan (plan-at-gate.r<n>.md at the highest n, else plan-active.md, after its restore-point comment) opens with wiki front matter carrying an id: the plans written to be merged as wiki posts. Their built text is the post at the main commit whose path holds that id; when no path holds it, the code and shingle rule below. An eligible run with no built text keeps its units in the denominator as missing: GATE-2 reads NO READ when more than 20% of eligible units are missing, and two bounds always print, every missing unit lost and every missing unit landed. Lean runs without front matter at the gate (12 runs, 47 units) are out of the estimand and counted; the 14 of their units whose built text the shingle rule found are labelled and print as a descriptive stratum.

**Code and shingle rule.** Take the thread code from the record's drive path or plan_source; among wiki posts at the main commit whose path contains that code, pick the one with the highest share of the gate-time plan's 8-word shingles; accept it if that share is at least 0.10 and the post was first added after the run started. With no code match, accept the best post over all of wiki/ only at a share of at least 0.50. This rule alone finds the built text for full-kind runs, which predate front matter at the gate.

**Main commit.** Stage 1 reads built texts at the main commit where it starts and records it; this post's counts used 09d7a8f7. A plan merged between the two raises coverage and never lowers it.

**Mechanical diff (descriptive and for the gold pool).** Words are lowercase alphanumeric runs; content words have at least 4 characters and are not on a frozen stopword list (common English words plus plan boilerplate such as plan, section, change, apply, should). T is the set of the change text's content words absent from restore.md; when T has fewer than 4 words, T is all its content words. A paragraph's overlap is the share of T found in that paragraph of the built text (paragraphs are blank-line separated blocks, table rows each count as one); the score is the best paragraph's. HIT when the score is at least 0.60, MISS otherwise. The hit share prints; no verdict rests on it.

**Estimate.** The panel labels every unit with a built text in the lean strata (a census: 43 primary and 14 descriptive) and a seeded sample of 40 of the 103 full-kind units; each stratum is estimated on its own labels, so no rate is pooled or carried across strata. Per stratum, the observed LANDED share o is corrected for the panel's measured error: landed share = (o + specificity - 1) / (sensitivity + specificity - 1), where sensitivity is the panel's LANDED rate on LANDED gold and specificity its not-LANDED rate on NOT_LANDED gold (section 6). The interval is a 95% percentile bootstrap that resamples runs within the stratum and, in each draw, takes sensitivity and specificity from their Jeffreys posteriors (Beta(k + 0.5, n - k + 0.5)); the draws, uncorrected for clipping, are scaled about the point estimate by sqrt(G/(G-1)) x t(0.975, G-1)/1.96 for G runs, then the interval is clipped to [0, 1] (power.py, part A). PARTLY and REVERSED count as not landed; both print. Also printed: the uncorrected panel share, the mechanical hit share, and gstack's own bookkeeping (units with an incorporated amendment, and those whose bookkeeping says incorporated while the panel says not landed).

**Told sessions.** Mechanical only, no panel (custody): the share of accepted changes whose change text scores HIT against the session's final plan file. Descriptive.

### 6. The paraphrase panel and its judge check (R78)

**Packet.** The question; the whole built text, which is a merged public wiki post at the recorded main commit; and the change text, scrubbed and cut to at most 120 words. Nothing else: no restore text, no diff, no removed or context lines, no finding title. Names of people, thread codes, run ids, dates, gstack version strings, model ids, the tool names autoplan and gstack, and the form markers (lean run, feature kind, full kind, --full, --kind) are replaced by neutral tokens, one map per packet applied to the change text and the built text alike, so matching words still match and a judge can't tell the stratum. Packet bodies stay under 160,000 bytes; a larger one is not sent and its unit is missing. No built text in the frame is over 114,000 bytes.

**Outbound check, fail closed.** A packet leaves the machine only when every part has an allowed source: the built text from git at the recorded main commit, and the change text from the record's chosen option and the finding's fix field. Before sending, a scan refuses the packet (E_AR_PACKET_LEAK) if it holds any replaced token class, any 6-word run from the run's owner replies or gate reply, a secret pattern (key prefixes, bearer tokens, long high-entropy strings), an email address, or a held-out task id from the sealed store's public digest list. The metered client is built with the same identifiers and owner-reply 6-grams as forbidden markers, as a second check. The same scan runs on the reply cache and on every aggregate export before either leaves the run's sink. Raw replies, quotes and the replacement maps stay private. The Captain's cap record authorizes sending the scrubbed change texts that pass.

**Question and labels.** "Does the built plan state this change, in any words?" LANDED (the specific rule, number, condition or section the change asks for is stated), PARTLY (some but not all of a multi-part change), NOT_LANDED, or REVERSED (the built plan states the opposite). The reply's last line is one JSON object with label and an evidence quote of at most 30 words, parsed leniently (lastJson, as in the product-value build, without its retry loop). For LANDED, PARTLY and REVERSED the quote must appear in the built text after whitespace and case are normalized; otherwise that label is missing.

**Judges and combination.** GPT-6 Astra and Claude Opus 5.5 label every production packet at medium effort. The records were written by Opus, so Astra is the cross-family judge (R78, 2). The binary (LANDED against the rest) is decided first: when Astra and Opus agree, that is the unit's binary label; when they split, Gemini 4 Argon (medium effort, through OpenRouter pinned to google-vertex, data collection denied) casts the deciding binary vote, so a third judge can never turn two not-LANDED votes into LANDED. If Argon's vote is missing or Argon failed its check, a split unit is missing. Among not-LANDED units the subclass (PARTLY, NOT_LANDED, REVERSED) is descriptive: the label at least two available judges gave, else "split"; an agreed binary is never made missing by a subclass disagreement. The dry run drives every label triple and every missing-vote case.

**Gold pool and judge check.** Seeded draws from the lean and full strata together: 40 HIT units; 40 ablated negatives (the built texts of 40 other HIT units with every paragraph of overlap at least 0.20 removed; a unit left with no such paragraph is replaced by the next draw); and 16 natural MISS units (fewer if fewer exist, the shortfall filled alternately from hits and ablations). Astra and Opus each label all 96 at maximum effort; gold is every item where their binary labels agree (R78, 1). The check needs at least 40 gold items in each binary class. A short class gets one seeded top-up of 24 items of its kind (hits for LANDED, ablations for NOT_LANDED), so at most 48 when both are short; top-up items join the medium-effort check. Still short, the check reads NO READ. Then Astra, Opus and Argon each label every gold item at medium effort, scored against gold: sensitivity on LANDED gold, specificity on NOT_LANDED gold, and Cohen's kappa, which must be at least 0.6 for Astra and for Opus. The combined panel's sensitivity and specificity on gold feed the correction in section 5.5. Natural misses carry the low-overlap paraphrases the census depends on; ablations carry deletions; hits carry changes satisfied in the same words.

**Supply before money.** Stage 1, which is free, counts eligible gold candidates: at least 80 distinct HIT units, 40 of them ablatable, across the strata. Short of that, GATE-2's panel part reads NO READ and no paid call is made.

**Production.** The 57 lean units and the 40 sampled full-kind units, drawn with a frozen seed before any panel call. A lean gold item's medium-effort reply is the same request as its census request (same packet, model and effort) and is reused from the request journal, not bought twice.

**Reuse.** The panel calls go through the product-value build's metered client (lanes/product-value/meter.ts: one ledger lease per item, the in-process metering proxy, the provider-pin check), its interval and kappa helpers (lanes/product-value/stats.ts) and its lenient JSON parse. Two parts are added: a durable request journal (section 13) and the outbound check above. The product-value miner, transposer, classifier and generic screen have no job here.

### 7. Bars, verdicts and verdict precedence

| Intention | Lean reading | Bar |
|---|---|---|
| AP-X-1 | share of answered lean runs whose completion part is met, Wilson 95% | MET when the lower bound is at least 0.80; NOT MET when the upper bound is below 0.80 |
| AP-X-2 | mean per-run share of required outputs present (lenient), run bootstrap 95% | same, 0.80 |
| AP-X-3 | outside voice disabled in every lean record, by code and record | NOT MET BY DESIGN; otherwise the share ran and cross-family against 0.80 |
| AP-GATE-1 | confirmed violations: agent self-approvals on any readable record, and user-challenge items in lean records answered by an agent with no owner words and no standing rule | MET at zero confirmed violations; NOT MET at one or more |
| AP-GATE-2 | corrected landed share on the primary lean estimand (census), run bootstrap 95% with Jeffreys draws | MET when the lower bound is at least 0.90; NOT MET when the upper bound is below 0.90 |

The 0.80 bars match the program's exposure bar. The 0.90 bar for landed changes says a gate that loses one accepted change in ten is not keeping its promise.

**Precedence, settled before review.** For each intention, the first rule that applies wins:

1. **NO READ:** its instrument failed: a stage 1 readability gate for that check, the gold supply or the judge check (GATE-2), or more than 20% of its lean units missing (section 8).
2. **NOT MET BY DESIGN:** the pinned code and every lean record show the lean form can't meet it.
3. **NOT MET:** the lean reading fails its bar.
4. **MET:** the lean reading passes its bar.
5. **UNCLEAR:** neither, reported as "no measurable shortfall and no confirmed pass", with the interval and section 11's precision.

Full-kind, lean descriptive and told readings never change a lean verdict, except GATE-1's integrity check, which counts a self-approval on any readable record (section 5.4); when one points the other way, the post prints both and names the difference. Unreadable records leave the integrity check and never make it NO READ. Without a passing judge check GATE-2 can't read NOT MET or MET, because the panel's error would be unmeasured; it reads NO READ, and the mechanical hit share prints as a descriptive figure.

**What follows each verdict (R48).** A NOT MET or NOT MET BY DESIGN is a defect report: it goes to the Captain and through it to GStack Minder with the counts and the code lines behind it. An UNCLEAR or NO READ gets one Why-unclear note in the results post (power, missing records or instrument) and ends in FIX-METHOD for this eval's method or no further action. No reading here is a KEEP or a CUT-CANDIDATE for autoplan (section 2).

### 8. Failure scoring (gate pick C1)

| Failure | Treatment |
|---|---|
| Record file missing or unparseable in the snapshot (run.json, decisions.jsonl, findings.jsonl, a bound result) | that record's units for the checks needing the file are missing; counted |
| Gate never answered | out of X-1, GATE-1's per-revision checks and GATE-2 (counted); still in GATE-1's integrity check |
| Lens delivered but no labelled part in the bound lean result | X-1 completion not met for that run; the lens's X-2 cells are read as usual |
| Required output not there in a complete record (a test plan never named included) | absent: in X-2's denominator, not present |
| Record lost the files that would show an output, or its release doesn't resolve | X-2 cells missing; counted |
| No owner question before the gate, runner path | holds by construction; reported, not scored as evidence |
| Attribution evidence absent | missing provenance under the missing-rate rule; never a violation |
| Eligible lean run with no built text | its units missing; bounds print |
| Packet over 160,000 bytes, or refused by the outbound check | not sent; unit missing; a refusal is also E_AR_PACKET_LEAK |
| Panel call fails at the provider after the proxy's retries | one retry under J1 when no label came back and the journal shows no settled reply; then missing |
| Label unparseable after the lenient parse, or its evidence quote not in the built text | missing; never re-asked (a judged call is never retried) |
| Astra and Opus split on the binary and Argon's vote is missing or Argon failed its check | missing |
| Gold short of 40 per class after the top-up, or Astra's or Opus's kappa below 0.6 | GATE-2 reads NO READ; its mechanical hit share prints (section 7) |
| Fewer than 80 HIT units or 40 ablatable ones in stage 1 | GATE-2 reads NO READ before any paid call |
| Call outcome unknown after a crash | reconciled from the ledger and journal first; never resent while its outcome is unknown; label missing if none can be recovered |
| Sealed told record fails its digest or decryption | told stratum missing for that session; logged in CUSTODY.md |

**Missing-rate rule.** A check reads NO READ when more than 20% of its lean units are missing: runs for X-1 and X-2, answered gate revisions for GATE-1's attribution, eligible primary units for GATE-2. Missing never counts as met or as failed in any estimate; the post prints every missing count.

### 9. How each gate pick applies here

| Pick | Here |
|---|---|
| A1 own headroom stage first | Stage 1 (section 10) is free and decides whether any paid labelling runs: frame integrity, readability, GATE-2 coverage and gold supply. |
| B1 leak guards | Web denial: every panel call is a plain API call with no tools. Per-model cutoff marking: not needed, because the packet carries the built text the judge must read. Name replacement and the outbound check: section 6. Blind authoring audit: the panel brief, gold-pool rule, sample draws and every threshold are frozen here before any panel call. |
| C1 failure scoring | Section 8. |
| D1 smoke, repair once or drop | No arms, so the smoke runs on the instruments: the parser on one record from each gstack minor version in the frame (free, stage 1), and 4 panel packets through each of the five judge and effort pairs (20 paid calls, stage 2, after the cap is recorded), checking the label parses, the quote check and the cost per call. One repair is allowed (parser or prompt format, before any gold or production call); a second failure drops that instrument, and its check reads NO READ. |
| E1 autoplan in the same session | No arm exists. The records hold both execution paths (runner-driven crew runs, in-session told runs); each is read as it ran and never pooled. |
| F1 separate verdicts | One verdict per intention for autoplan's lean default; no plan-* skill is read. |
| G1 power | Section 11. Units can't be added to a fixed frame, so UNCLEAR reads "no measurable shortfall and no confirmed pass", and the precision and error rates are stated. |
| H1 one offline code snapshot | One full gstack clone with history pinned at b6155921 supplies every phase rule and required-output list; one gstack-evals commit runs every reading; the records are read from one private snapshot. |
| I1 sandboxed build runs | Nothing is built or run: records are parsed as JSON and Markdown and never executed, and panel calls have no tools. |
| J1 recovery | Reconcile the ledger and the request journal first; one retry only for an infrastructure failure with no label returned; never retry a judged call; a request whose outcome is unknown keeps its reservation and its retry count across relaunches. |

### 10. Stages

**Stage 1 (free).** Check the snapshot's digests and id list, parse every record, find built texts, run the mechanical diff, X-1, X-2, X-3 and GATE-1 on every stratum, open the 9 sealed told records under custody for their mechanical readings, build and scan every packet, count gold candidates and fix the seeded draws. Gates, each tied to its check: at least 90% of records in each stratum parse (else every check on that stratum reads NO READ); GATE-2 needs at least 10 eligible lean runs, at least 40 eligible lean units, no more than 20% of them missing, and the gold supply in section 6 (else GATE-2 reads NO READ and no panel money is spent). Then the free part of the smoke (the parser).

**Stage 2 (paid, about $140).** Only after stage 1's gates pass and the Captain records the cap: the paid smoke (20 calls), then a re-projection from the smoke's measured cost per call and the serialized size of every remaining request, plus every reservation still unresolved on the ledger; if that projection plus 12 worst cases passes the cap, stop for the Captain. Then the gold pool at maximum effort, the judge check at medium effort, and production.

### 11. Power and precision (gate pick G1)

power.py (attached, seeded, no key) simulates each reading at the frame's real sizes, with the panel's errors simulated and corrected as section 5.5 says. From power.txt:

- **GATE-2, lean primary (43 changes in 10 runs, census, 40 gold a class).** The interval's half-width is about 0.12 to 0.16 near the bar. At a true share of 0.90, NOT MET comes out in at most 1.1% of simulated audits and MET in 5% to 9%; measured coverage of the interval is 0.91 to 0.96 for true shares from 0.75 to 0.95 and 0.99 at 1.00. A true share of 0.75 reads NOT MET in 10% to 23% of audits, 0.80 in 5% to 12%. A true share of 0.95 reads MET in 12% to 23%, and 1.00 in 22% to 53%; the rest read UNCLEAR. So the audit rarely misfires at the bar in either direction, but it can confirm neither a gate that loses one change in five nor one that loses none with much reliability. Its likely outcome is UNCLEAR with a stated interval.
- **GATE-2, lean (57 changes) minus full (40 sampled) (descriptive).** The MDD is 0.44 to above 0.60: only a very large gap between the forms would show.
- **X-2, lean (22 runs).** Half-width 0.03 to 0.12 (16 or 21 cells a lean run, 18 to 27 a full run). A true share of 0.70 reads NOT MET in 45% to 82% of audits and 0.50 in all; 0.90 reads MET in 70% to 93%.
- **X-2, lean minus full (descriptive).** MDD 0.18 to 0.28.
- **X-1, lean (22 runs).** MET needs 22 of 22 (Wilson); 13 or fewer reads NOT MET. A true rate of 0.95 reads MET in about a third of audits.
- **GATE-1 integrity.** With no violation in 22 lean gates, the exact one-sided 95% upper bound on the violation rate is 0.127.
- **X-3, full kind (descriptive).** Half-widths 0.10 to 0.19 on 31 phases and 22 completed outside results.

The interval is not exactly nominal at the bar: on the MET side it errs in up to 9% of audits at a true share of exactly 0.90, and the results post prints that rate beside any MET.

The prior, stated before data: X-3 reads NOT MET BY DESIGN (the code says so); X-2 sits well under 0.80 on lean, because the lean reviewer gets checklists of 28 to 37 lines and returns a findings list; X-1's completion part is uncertain on lean, for the same reason; GATE-2 is high but not certain, because the parent edits the plan by hand after the gate.

### 12. Money (internal)

This section is internal bookkeeping; the results post shows cost only as a lesson (R79). The line is $2,000 of new money, all-in. List prices from src/runner/pricing/prices.ts (per million tokens): GPT-6 Astra $10 input and $50 output, Opus 5.5 $4 and $20, Gemini 4 Argon $2 and $10. Planning figures per call: input is the packet's bytes divided by 4 plus 1,500 tokens (lean built texts have a median of 46 KB, full-kind 63 KB); output, reasoning included, 5,000 tokens at maximum effort, 2,000 at medium, 1,500 for Argon. That gives about $0.41 for Astra and $0.17 for Opus at maximum effort on a gold packet, and $0.23 to $0.27 for Astra, $0.09 to $0.11 for Opus and $0.04 to $0.05 for Argon at medium.

| Item | Calls | Projection |
|---|---|---|
| Smoke: 4 packets × five judge and effort pairs | 20 | $4 |
| Gold pool at maximum effort: 96 × Astra and Opus | 192 | $55 |
| Judge check at medium effort: 96 × Astra, Opus and Argon | 288 | $40 |
| Production: 57 lean and 40 full units × Astra and Opus, Argon on about 19 splits | about 213 | $35 |
| One J1 retry allowance (5% of calls) | about 36 | $7 |
| **Panel subtotal** | about 750 | **$140** |
| Top-up, one gold class short (24 items, every judge and effort) | 120 | $24 |
| Top-up, both classes short | 240 | $48 |
| Crew: this post and its review, the build and its review, the run, the results post and its review | | $340 |

**Reserve mechanics.** The metering proxy prices each call's worst case before sending it: every byte of the request body as one input token, plus the call's max_tokens as output (16,000 at maximum effort, 8,000 at medium), and it refuses a call whose worst case doesn't fit what the lease has left (E_ALLOWANCE). The largest worst case is an Astra maximum-effort call on the largest built text (114 KB) at $2.02. Each call may send up to 3 attempts inside 15 minutes for a 429 or 5xx, and an attempt whose spend is unknown keeps its worst case reserved until reconciled, so 4 calls in flight can hold at most 12 worst cases, $24.21. Reservations left unresolved by earlier calls count in every re-projection (section 10).

| Item | Cap |
|---|---|
| Panel (one ledger item, one lease) | $200 |
| Crew | $450 |
| Reserve | $90 |
| **All-in** | **$740** |

The Captain set the panel cap at $200 when answering this post's gate. It covers the panel's $140, one top-up ($164) and the $24.21 in-flight hold. A second top-up would pass it, so the re-projection stops for the Captain first. Crew is re-costed from comparable measured threads at about $1 per 1,000 credits. All-in projects at about $500 against caps of $740 and a $2,000 line. A projection more than half past the line ($3,000) or past $5,000 all-in stops for the Captain.

### 13. Start rules, build and stops

1. No paid call before this post merges and the Captain records the panel cap. Every paid call goes through the ledger and the metering proxy; a cap stop is an incomplete run, never retried to change a verdict.
2. **R77.** This experiment gets this post and one results post. The build (the snapshot digest check, the record parser across the frame's gstack versions, canonical units, the built-text matcher, the mechanical diff, the X-1, X-2, X-3 and GATE-1 readers, the versioned required-output matrix from the full gstack clone, the told-session readers under custody, the packet builder with name replacement and the outbound check, the seeded draws, the panel driver on the product-value metered client with a request journal, the estimators and intervals, and the dry run) lands on a branch; every paid run is pinned to that commit, and the commit lands with the results.
3. **Reason codes** the build adds to src/errors/codes.ts with doc anchors: E_AR_FRAME_DRIFT, E_AR_UNREADABLE, E_AR_SUPPLY_SHORT, E_AR_SMOKE_FAIL, E_AR_PACKET_LEAK, E_AR_LABEL_MISSING, E_AR_JUDGE_KAPPA, E_AR_PROVIDER_DRIFT and E_AR_CUSTODY. E_AR_FRAME_DRIFT, E_AR_PACKET_LEAK and E_AR_CUSTODY stop the run; E_AR_SUPPLY_SHORT and E_AR_JUDGE_KAPPA stop only GATE-2's panel part; E_AR_PROVIDER_DRIFT stops Argon's calls. None is retried. Each exits nonzero with a redacted message, stops for the Captain, settles the open lease at the spend recorded so far and leaves partial outputs sealed as an incomplete run.
4. **Request journal.** Every panel request is a journal row keyed by its request digest, written before sending and moved to one terminal state: label received, label invalid, outcome unknown, or retried once under J1. A relaunch reconciles the ledger and the journal before any call; a request in outcome unknown keeps its reservation and is never resent while unknown; the retry count survives relaunches. The reply cache serves only requests whose journal row is terminal with a label. A label lost to a crash is reported missing, not bought again silently.
5. **A keyless dry run drives every frozen rule** before stage 1, on constructed fixture records and a stub provider: each gstack schema variant in the frame (decision rows with and without answered_role and owner_mode, with and without amendments); one proposal carried through three gates (one unit), a settled ordering amendment and a withdrawn one (excluded); the accepted-change rule on each option family; front matter present and absent, the id path, the code path and containment path on both sides of 0.10 and 0.50, and a post first added before the run; an eligible plan with no built text that holds every failure (it must not give MET); the overlap score at 0.59 and 0.60 and the T fallback at 3 and 4 words; the versioned matrix against the pinned table; the lenient and strict detectors on present, heading-only, one-line, N/A-with-reason and absent outputs, 6 and 7 distinct design scores, 7 and 8 distinct DX scores, a repeated dimension name, a test plan never named in a complete record (absent) and in a record with lost files (missing); X-1 with a lens delivered but no labelled part, and a question asked outside the record (unobservable); X-3 with a same-family outside voice, an unavailable voice marked confirmed, and a lean record with a completed outside voice; GATE-1 with a complete run and no answer (violation, before exclusions), owner words, a bound approvals record, a delegation, two gates in one thread within 24 hours (the other gate's approval must not count), a later approval, an unchanged carry (keeps provenance) and a changed proposal with no answer; the outbound check refusing each token class, an owner-reply 6-gram, a secret pattern, an email and a held-out id, and a deleted private sentence that passes every identity rule (it never enters a packet); every Astra, Opus and Argon label triple and every missing-vote case; a quote not in the built text; the gold pool at 39 and 40 agreed per class, one class and both classes short, and an exhausted ablation pool (no call sent); kappa at 0.59 and 0.60; the missing-rate rule at 20% and just over; every verdict at both sides of its bar, NO READ beating NOT MET BY DESIGN, and GATE-2's bounds; crashes after send, after settlement, and before and after a cache write, with the real ledger (reservations and retry counts kept); and one ledger lease opened and settled on a temporary ledger with a refused call at the admission edge.
6. Stage 2 runs only after stage 1's gates, the recorded cap, the paid smoke and the re-projection pass.
7. Argon runs through OpenRouter pinned to google-vertex with fallbacks off and data collection denied, read from OpenRouter's endpoints API before the cap request; a provider change stops Argon's calls.
8. The run uses a sink directory that doesn't exist before it, checked and recorded. It runs as a background operation on a Capy machine with a registered wait, which keeps the machine awake; the panel's roughly 750 calls take about an hour at 4 in flight.
9. Any review finding that would move a reading comes to the Captain before a fix.

### 14. Custody, outside terms and public safety

The records are private crew records. Only counts, shares, intervals and digests are committed. The post never quotes an owner's words, a plan's private text, a finding or a told session.

- **Snapshot.** The frame's records and the approvals files sit in one private tar in the Captain drive with their digest lists (section 4); the run reads that copy.
- **Told sessions.** The 9 sealed records are decrypted into /dev/shm on the run thread's Capy machine under the existing custody rules (the identity streamed in, used once and removed; test ! -e after), read mechanically, and swept at the end. Every opening is logged in CUSTODY.md. No model sees told-session content.
- **Panel packets** carry a merged public wiki post and a scrubbed change text of at most 120 words that passed the outbound check in section 6. No restore text, diff or removed line leaves the machine. Unknown provenance is refused.

**Outside terms, licences or rights.** The records are the project's own data. gstack is MIT at the pin; if the build copies its code or a substantial part of its required-output text, the copy keeps gstack's copyright and permission notice and gets its NOTICE.md row. Astra calls run under OpenAI's API agreement and Opus calls under Anthropic's Commercial Terms; neither provider trains on API data by default, which is not a zero-retention promise. Argon runs under OpenRouter's terms with Google as the pinned provider and data collection denied, which is a routing control, not a retention warranty. Before the cap request, the run record names the API agreement, retention and training settings for each provider account and the Argon endpoint's provider identity, and a change to any of them stops the affected judge. No third-party code or text is copied or run. The told sessions' tasks are derived tasks under the crew's sealed-task rule and stay sealed.

### 15. What the author saw before freezing

The first supply count printed, per record: kind, status, whether the gate was answered, the reply token, whether owner words were stored, counts of decisions, findings and amendments, the count of items whose chosen option differs from the recommended field, each phase's native and outside status, and for full-kind records the outside model, the native and outside finding counts, and gstack's own reconcile count of outside findings marked new. It also printed each run's best wiki match and its shingle share, and the accepted-change counts. After the review, the recount printed per record: stratum, whether the gate-time plan carries front matter, how the built text was found, canonical accepted units, no-edit exclusions, plan-change rows and carried rows. Neither count computed a landed share, a required-output presence or a diff, and neither read plan text beyond the front matter or any told session. X-3's full-kind figures and GATE-1's override counts were therefore seen in rough form; both are descriptive or by design, and their rules were written to the code's and the inventory's definitions, not to the counts.

### 16. What the results post reports

It opens with 2 or 3 takeaway bullets for builders, what works first and any shortfall right after (R79). Then, per intention: the lean verdict with its interval, bar and precision; the full-kind, lean descriptive and told readings beside it; every missing count. For GATE-2: the corrected and uncorrected panel shares, the mechanical hit share, both missing bounds, the PARTLY and REVERSED subclasses and splits, gstack's bookkeeping against the panel, and the judge check (each judge's model and version, sensitivity, specificity and kappa, gold counts per class and by kind, and the number of Argon votes), with the measured error rate beside any MET. For X-1: delivery, completion and the unobservable silence part. For X-2: both detector readings, absent and missing cells, and the runner-checklist reading. For X-3: ran, cross-family, honest coverage and added. For GATE-1: integrity, recorded, corroborated, delegated and missing-provenance counts, user-challenge attribution, changed shares and reversals with the relay-default limit. Then the told stratum, and the G admission rows with the reason they enter no check; held-out disclosure; the closing disclosures. Cost appears only as a lesson; spend and caps go in the Agent notes. Every stop and UNCLEAR goes on the research registry.

### 17. Risks, limits and not in scope

- The frame is the crew's own runs: one team, mostly preregistration plans for evals, written and revised by Opus 5.5 under one Captain. Other users' plans and parents may behave differently.
- Lean and full differ in date, gstack version and plan type as well as form, so their difference is descriptive.
- GATE-2's primary estimand is the plans written to be merged as wiki posts; drive-only plans have no built text to compare, so they are counted and left out.
- X-2 reads named outputs with substance, not depth or correctness; the inventory found no reliable depth marker.
- GATE-2's built text is the merged plan post, the best available stand-in for the plan the build started from; a change that landed in a later post or only in code is counted as not landed.
- GATE-1's attribution rests on the crew's records; a gate answered correctly but recorded nowhere reads as missing provenance, and recorded owner words are not proof the owner wrote them.
- The panel judges presence, not quality. The correction trusts gold, which is two judges' agreement at maximum effort, not a human label; an error both gold judges share passes into the estimate unseen.
- Not in scope: whether autoplan's reviews were right or made products better, any new autoplan session, editing gstack, posting anything, and any claim about a plan-* skill.

## Review record

One lean gstack /autoplan review on gstack 1.98.0.0, kind feature as the planner printed it: one reviewer (GPT-6 Astra, high effort, cross-family to the Opus author), one round, native voice only. It read the plan, the pinned gstack code, the supply scripts and the reused build, and reproduced power.txt byte for byte. It raised 17 findings: 10 High, 3 Medium and 4 Informational, no Critical. Its opening line: do not admit paid judging on the plan as first written.

The Captain answered the gate (revision 1) by taking every recommendation and the cost option that keeps the full-kind sample. Applied here:

- Canonical units through carry chains, no-edit amendments excluded, supply and power recounted (5.5, 4, 11).
- X-1 split into delivery, completion and an unobservable silence part (5.1).
- X-2 on the exact Pre-Gate matrix: Eng's scope challenge with REALITY lines restored, the Eng Error & Rescue cell removed, distinct dimensions, a missing test-plan path counted absent (5.2).
- GATE-1 integrity checked on every record before exclusions, attribution bound to the run and revision or rec hash, missing provenance never a violation, carried answers keep provenance (5.4).
- GATE-2's estimand set to front-matter plans, with missing built texts in the coverage rule and both bounds printed (5.5).
- A lean census instead of a sample, so no precision is pooled or carried across strata; a separate full-kind sample (5.5, 6).
- Panel error corrected with Jeffreys draws inside the run bootstrap, widened for few runs, operating characteristics measured and printed (5.5, 11).
- Whole built texts in packets, quotes checked against them, natural misses in gold (6).
- Binary majority first, Argon only on a binary split (6).
- Packets limited to public built text and a scrubbed change text behind a fail-closed outbound check (6, 14).

The three Medium findings were applied too: the frozen snapshot with digest lists and a full gstack clone (4, 5), the gold supply check and a fully priced schedule with the paid smoke after the cap (6, 10, 12), and the request journal (13). The four Informational findings were the outside-terms answer, which was yes: gstack's MIT licence and the three providers' API terms; section 14 records them.

## Disclosures

Filled in at the results post from org research/disclosures.md.

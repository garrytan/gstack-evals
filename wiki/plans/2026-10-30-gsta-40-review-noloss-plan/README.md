---
id: 2026-10-30-gsta-40-review-noloss-plan
kind: plan
title: "Review no-loss eval category: does a review variant keep the blockers a reference review catches?"
summary: "Plan for a review no-loss category: GSTA-167's 29 blockers as catalog cases, an arm ingest contract, a paired-by-blocker no-loss rule with a stated margin, blinded judging, cost per blocker found."
author: GSTA-40
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: done
links:
  - 2026-10-28-gsta-3-v1-build-breakdown
  - 2026-10-30-gsta-32-u13-review-replay-lane
  - 2026-10-30-gsta-33-u14-review-case-mining-rules
  - 2026-10-28-gsta-14-noninferiority-bootstrap-few-tasks
  - lanes/review-replay/README.md
  - lanes/review-replay/catalog/schema.json
source: "Plan reviewed by gstack /autoplan run autoplan-20261030143454 (plan snapshot sha256 3110d18fa6510252063adcb3e4b69fbf7ac6be415eb5fd26a2dd502a44bbc11f), approved at gate_rev 1. review-record.md is the run's public export with em dashes replaced by hyphens."
attachments:
  - adad6b8e41dee623d727513911e1c7c290f0eceaf35c5eb94498e6c80f1ef072  review-record.md
---
# Review no-loss eval category

Plan v1, 2026-10-30. Author GSTA-40 for the gstack-evals Captain (GSTA-2), working for Garry Tan, issue GST-276. Garry asked for this on 2026-10-30, relayed by the gstack Captain: he asked that gstack-evals hear about all of this, since this is probably an eval category with data we still need to create.

Approved at autoplan gate_rev 1 with Garry's approval (recommendation taken), relayed by the Captain (GSTA-2, GST-282). The Captain ruled on Big decision 5: restate. GSTA-167's documents are crew-session text, so the build restates the cases and the cohort in our own words, keeps the originals in the drive, and commits only their digests. The plan text below is the reviewed text; where Big decision 5 and section 10 say verbatim, the ruling holds.

Inputs, read from the org drive's handoffs/GSTA-167/ and pinned by sha256:

| File | sha256 | What it holds |
|---|---|---|
| noloss-prereg.md | 201955183200af6ced2065fc41b153a153a50b637e07e3ace7b07f0a3c4c6c30 | Cohort, eligibility, the blockers, the judging rule, the bar, and the round 2, 3 and 4 addenda |
| noloss-cohort.tsv | 6f16f6a5782cca741b019eba840781c37e651db18670a43af1742e0f2ed24921 | Full pass-1 heads and bases for the 14 PRs |
| noloss2-results.md | 4374c79fb65e82486884ce602cf28a7766a1f3df8856d1cc606e4322eb588df7 | Arms A and B, per PR and per blocker |
| noloss3-results.md | 268ffa929092686ff2ffcf9961b0c6054d7195b3f91fe56fb5347e95824b80dc | Arms C and A', per PR and per blocker, and the cost table |

The prereg's freeze digests check out on these bytes: its first 12,819 bytes (through the round 2 addendum) hash to b54b94ad..., the digest round 2 cites, and its first 18,397 bytes (through round 3) hash to 123faa47..., the digest round 3 cites. Also read: the U13 and U14 posts, the catalog schema and loader, the miner, the stats kit, and the eight replay*-34/36 cost runs.

## Implementation plan

### ELI5

gstack tried a cheaper code review. It looked at less of each pull request, used fewer tokens, and missed real bugs, so gstack undid it. The next cheaper review will come soon, and we need a fair, repeatable test for it. The test takes 29 bugs that gstack's own reviews once caught on 14 old pull requests. It runs a review variant and a reference review on those same pull requests, as they were before the fixes. For each bug, it asks: did the variant flag it as blocking, and did the reference? Then it counts the bugs one found and the other missed, in both directions, and says "no loss", "loss" or "not distinguished". It also says what each review cost per pull request and per bug found. The 14 old pull requests are a small sample, so the honest answer will often be "not distinguished" until we add more cases.

### Before → after

Before: GSTA-167's no-loss replay lives as markdown in a drive folder. Each round was judged by hand, by the lane that ran the arms, with the arm labels in view. The results say "of 30" although the blocker table lists 29. Each round set its own bar, and round 3's bar ("find every blocker the old review found, at most one miss") would fail the old review against a second run of itself. Cost numbers mix an upper bound from a shared root counter with exact per-reader meters. Nothing in gstack-evals can score the next arm (D) the same way.

After: the 29 blockers are catalog cases in U13's schema, grouped by a suite file that keeps the pass-1 heads, bases, blocker ids and the judging rule. An arm's run is a directory in the shape GSTA-167 already reports (arm.json, findings/<pr>.jsonl, judgments.tsv, cost.tsv). `gstack-evals noloss` validates it, scores it against a reference with one preregistered rule, writes tables/review-noloss.json, and renders blinded judge packets. Arms A, B, C and A' are the first scored results. The same command scores any arm on the 44 mined catalog cases.

### Why it matters

gstack is choosing how much review to cut to save tokens. A cut that drops blockers ships bugs into every repo that uses gstack, and it costs more later than it saved. A shared category gives each variant the same cases, the same judging rule, the same error rate and the same cost accounting, and a loss is reported plainly. It also shows things a single round hides. On the 11 PRs where both were metered, A' (relaxed packets) used about 41% fewer tokens per PR than C (the old review), but only about 5% fewer per blocker found: 19.5M against 20.6M. Both are upper bounds from a root counter, so treat this as a lead, not a result.

### What caused this work

GSTA-167 cut /ship's reviewers down to small packets to save tokens. The preregistered replay on 14 past gstack PRs showed the packet arms found 8 to 12 of the 29 blockers, against 19 for the old full review (C), at about 17.7M against 30.0M tokens per PR. The misses needed context outside the changed lines. gstack reverted the packets in v1.91.331.0. Arm D (round 4, the old reviewers with new orchestration) is next, and the Captain asked the gstack Captain to report it, and later arms, into this category in a fixed directory shape.

### Big decisions

1. **The no-loss margin.** Pick: 10 percentage points of blocking recall (3 of 29 blockers). Options: 5, 10 or 15 points. A 5-point margin can't be reached at any size we will have this year; 15 points accepts losing about 1 blocker in 7. What would flip it: a measured cost of a shipped blocker high enough that only 5 points is acceptable, in which case the category reports "not distinguished" until the case pool is several times larger.
2. **The reference is a replayed review, not the historical record.** Pick: the old review (arm C) replayed under the same one-pass harness. The historical blockers came from multi-pass runs with fixes and a Codex structured review; C found 19 of 29 in one pass, so the record is the answer key, not a bar any one-pass arm can be held to. What would flip it: a replay harness that runs the full multi-pass /ship loop.
3. **Pair by blocker, count gains and losses.** Pick: compare the two arms on every eligible blocker, so a blocker the reference found by luck is balanced by blockers the variant found and the reference missed. Round 3's rule counts only losses on the reference's own found set; by regression to the mean it fails the reference against a second run of itself. What would flip it: none; for rounds whose prereg froze another bar, that bar is reported first as frozen.
4. **Blinded judging with mechanical severity.** Pick: the judge sees the blocker key and a pooled, shuffled list of findings from both arms with arm, reader, model and severity removed; severity is applied after unblinding from the arm's declared map. Legacy rounds stay labelled unblinded. What would flip it: a judge agreement study showing labelled and blinded judging agree, which would let labelled judgments count as primary.
5. **Publish GSTA-167's prereg and results verbatim.** Pick: commit the four input files byte for byte in a wiki bundle after a key and path scan, because then anyone can check the prereg's freeze digests. They discuss only public gstack PRs. The eight replay*-34/36 files carry machine ids and drive paths and add nothing the scorer reads, so they are cited by digest only. What would flip it: the Captain ruling that crew-session documents are private sessions under AGENTS.md, in which case cases are restated in our own words with digests only.
6. **Cases live in their own catalog directory.** Pick: lanes/review-replay/catalog/noloss/, not public/. The miner treats every case in public/ whose id is not a mined id as a seed and rebuilds its audit (scripts/mine-review-cases.ts:726), so 28 new cases there would break `build --check`.

### Scope and non-goals

In scope: the case import, the suite file, the arm contract and ingest, the scorer, the decision rule, the export, the power check, blinded judge packets and their join, the legacy arms, keyless tests and docs. Out of scope: running any review arm, running any judge, changing gstack, changing U13's runner or U14's miner, and paid runs on the 44 catalog cases. Any paid run of an arm or a judge needs its own preregistration and a cap from the Captain, and its results land in a separate PR.

### 1. The cohort count: 29 blockers, not 30

The prereg's table lists, per PR: 3593 two, 3596 two, 3516 two, 3524 one, 3526 four, 3527 four, 3534 four, 3540 one, 3545 one, 3564 one, 3567 three, 3573 one, 3578 one, 3583 two. That is 29. Every per-PR row in both results files has the same denominators, and the numerators sum to the stated totals (A 11, B 8, C 19, A' 12), so the totals are right and only the denominator is wrong. The category uses 29. It writes a wiki finding with the recount, quotes the original "of 30" beside each legacy number, and asks the Captain to pass it to the gstack Captain. No verdict changes: A' still missed 9 of C's 19.

### 2. The 29 blockers become catalog cases

One case per blocker, in U13's schema version 1, in lanes/review-replay/catalog/noloss/<id>.json, loaded by the existing `loadCatalog`. #3540's blocker is already the mined case gstack-3540-review-0e2e1121 (same head 115355a, same file and line, same fix 0e2e112), so the suite points at that case and 28 new files are written. The seed gstack-3516-ship-hook-actor-negation-guard is a different defect at a later head (3712b79, #3516's pass-1 fix), so it stays out of this suite.

| Case field | Value for a no-loss blocker |
|---|---|
| id | `gstack-<pr>-noloss-b<n>`, where B<n> is the prereg's blocker id |
| repo, pr | garrytan/gstack and the PR |
| reviewed_head, merge_base | The pass-1 head and base from noloss-cohort.tsv. #3596's base is its PR base at review time (6c67e02), said in diff_range.note |
| diff_range | base..pass-1 head |
| roles | The reviewer that rated it at the floor in history: red-team, a specialist with its checklist, or adversarial or outside-voice. The last two are new enum values, an additive schema change; no existing case changes |
| defect.file, line | The file the prereg names, and the first old-side line the fix commit rewrote in that file inside the prereg's line window, at the pass-1 head (the miner's Rule 1 step 3). Where the prereg gives no line (3526 B1 to B4, 3527 B3, 3534 B2 to B4), the hand audit picks it from the fix diff |
| defect.summary | The prereg's cause, in plain words, as one or two sentences |
| severity.in_history | Who rated it at the floor and in which pass, from the prereg |
| severity.deserved | U14's Rule 4 H4 by the hand audit: CRITICAL when the evidence shows a failing test, a production break or data or secret loss; null when it doesn't settle it |
| fix | The full sha of the prereg's fix commit, resolved in a gstack clone, and the same PR |
| decoys | The fix commit against the pass-1 head, audited by the miner's later-fix search (Rule 3) through its exported functions; null, and never scored clean, when the search can't settle it |
| receipt | The PR's Pre-Landing Review lines and the fix commit's subject, both public, plus the mechanical checks |
| answer_key_audit | GSTA-40's hand audit (Opus 5.5), with the checks: the line exists at the pass-1 head, and the fix commit changes it |
| shelf_life | The PR's creation date from GitHub's API; short true |
| credit | The PR's own review, and GSTA-167 (the gstack Captain) for the cohort and the judging rule |

The suite file, lanes/review-noloss/suites/gsta167-14pr.json, holds what one case can't: the prereg path and its three digests (the full file and the two freeze prefixes), the judging rule as text, groups (a) GSTA-152 and (b) the replay set, each unit's PR, head and base, and each blocker's id, case id, every path the prereg names (a match on any of them counts as the same path) and its location. Location is computed from git: `added` when the defect line is an added line of the diff, `context` when its file is in the diff but the line is not added, `outside` when the file is not in the diff. Location is the covariate behind "the misses needed context outside the changed lines". The suite also lists the three ineligible PRs (3525, 3532, 3555), the excluded blockers with the prereg's reasons, and the frozen bars of rounds 2, 3 and 4.

`noloss suite --check` verifies that every case loads, every unit's head and base match its cases, every blocker id is unique within its PR, and the prereg copy matches its digests.

### 3. The arm contract and ingest

An arm's run is the directory the gstack Captain was asked to write: `arm-<id>/` with arm.json, findings/<pr>.jsonl, judgments.tsv and cost.tsv. Contract version 1 below keeps every field the Captain named and adds only optional ones. Unknown columns and fields are kept and ignored, so a later extension never breaks an old reader.

- **arm.json.** Required: id, label, suite, date, passes. Optional: kind (reference or variant), source (repo, ref, sha), prereg (path, sha256), models (role, model, effort), run_by, notes, and severity_map: a table from each raw severity (CRITICAL, INFORMATIONAL, FIXABLE, INVESTIGATE, Critical, High, Medium, Low, P0 to P3) to CRITICAL or INFORMATIONAL, optionally per reader. Round 3's prose-voice rule is such a map.
- **findings/<pr>.jsonl.** One finding per line, in gstack's specialist line shape (severity, confidence, path, line, category, summary, fix, fingerprint, specialist) plus reader, pass and id. A finding's id is its id field, else its fingerprint, else `#<line number>`; it must be unique in the file.
- **judgments.tsv.** Header: pr, blocker_id, outcome, matched_finding, raw_severity, mapped_severity, judge, saw_label, note. Optional: pass (default 1) and coverage (complete or incomplete, default complete). outcome is F, D or M. The scorer enforces: exactly one row per suite blocker per pass; F has mapped CRITICAL, D has mapped INFORMATIONAL, M has no match; a matched finding exists and its severity equals raw_severity; mapped_severity equals the arm's severity_map when one is declared. A missing row is an error, never a miss, so lost data can't turn into a loss silently. An M with coverage incomplete is a miss under the prereg and is counted separately.
- **cost.tsv.** Header: pr, scope, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens, total_tokens, usd, wall_seconds, meter_source, covers. Blank means unknown. pr may be `*` for a row that covers several PRs, which covers then lists. meter_source is one of proxy-journal or reader-counter (exact), lane-counter-delta (the lane's own counter, orchestration included), root-counter-delta (a shared counter that may include other lanes: an upper bound) or estimate (never used for a cost claim).

`noloss ingest <dir> --suite <id>` validates the directory, runs the sealed guard's patterns and the wiki's key-shape scan over every text field, and copies it to lanes/review-noloss/arms/<suite>/<arm id>/. A finding text that fails the scan blocks the ingest; it is never redacted silently. Ingest never changes a source file.

**The legacy arms.** A and B (round 2) and C and A' (round 3) have no findings files in the drive; their merged.jsonl files were on GSTA-167's lane machine. So each is ingested from a hand transcription of its results table, in blocker order: matched_finding is `-`, raw and mapped severity follow the outcome (F as CRITICAL, D as INFORMATIONAL), judge is "GSTA-167 lane", saw_label is yes, and note carries the results file and any footnote (3526 B2, 3527 B1 and B4, 3567 B3). Blocker order is checked against the footnotes, which name blockers by cause. cost.tsv for C and A' holds one root-counter-delta row each over the 11 PRs measured in both (330.3M and 194.9M); A and B have none. A test recomputes every per-PR fraction and total in both results files, both rounds' bars, and round 3's sentence naming A''s nine misses and two gains. The Captain is asked to have the gstack Captain copy those four merged.jsonl files into the arm shape if they still exist, which would allow a blinded re-judge later.

### 4. Metrics

For each arm on a suite, pooled over passes by the mean per blocker:

- **Blocking recall:** blockers FOUND (a match rated CRITICAL after mapping) over eligible blockers. D and M are misses, as the prereg says. Reported with a PR-clustered bootstrap interval from the stats kit.
- **Detection recall:** blockers matched at any severity.
- **PR-level recall,** two ways, as the prereg defines them: PR hit (every blocker on the PR FOUND) and PR any (at least one FOUND). Groups (a) and (b) are shown apart, because round 2's bar uses them.
- **Recall by location:** added, context and outside, so the out-of-diff misses are counted.
- **Severity agreement:** the blocking-call rate F over F plus D, which is agreement with history, since every blocker was rated at the floor; against the reference, a 2x2 table on blockers both arms matched, with percent agreement, and Cohen's kappa once 10 or more such blockers exist; on catalog suites, the over-blocking rate on cases whose deserved severity is INFORMATIONAL.
- **New blocking findings** per PR: mapped-CRITICAL findings that match no blocker. Reported, not scored; their precision is unknown.
- **Cost:** tokens per PR (mean and median), tokens per blocker found (tokens on the measured PRs over blockers FOUND on the same PRs), USD and wall seconds where metered, each with its meter grade and the PRs it covers. Arms are compared only on PRs metered in both. A comparison takes the weaker grade of the two, and an upper bound is never subtracted from an exact figure.

The legacy numbers the build will reproduce: blocking recall C 19/29, A' 12/29, A 11/29, B 8/29; cost per PR C 30.0M and A' 17.7M; cost per blocker found on the 11 metered PRs C 20.6M (16 found) and A' 19.5M (10 found); all cost rows upper bounds.

### 5. The no-loss decision rule

A comparison names a variant V, a reference R, a suite and a margin. Each blocker gets one paired value per arm: the share of that arm's passes that FOUND it. PRs are the clusters. Delta is V's blocking recall minus R's.

1. **NO_LOSS** when the margin-shifted exact sign-flip test over PR clusters rejects "V is worse than R by at least the margin" at one-sided alpha 0.05. This is the kit's `marginShiftedSignFlipP`, the test the Captain chose for few clusters (wiki finding 2026-10-28-gsta-14). It shifts each PR's summed difference by the margin once per blocker, so PRs with more blockers weigh more.
2. **LOSS** when NO_LOSS fails and the same test with margin 0, oriented the other way, shows V worse than R at one-sided 0.05.
3. **NOT_DISTINGUISHED** otherwise, including when no blocker differs between the arms (the kit returns null there).

The margin is 10 points of blocking recall (Big decision 1). A comparison's prereg names it, and the scorer refuses a comparison without one. The scorer always prints delta, its bootstrap interval, losses, gains and both p-values beside the verdict.

**Size rule.** CREW requires a parity claim to have enough data that the minimum detectable difference is inside the margin. So `noloss power` simulates the suite at its cluster sizes, the reference's recall and a stated spread of per-blocker detection rates. It prints the chance that an arm exactly as good as the reference passes, and the false NO_LOSS rate at delta equal to minus the margin. A prereg reports both. When the chance is under 80%, a NO_LOSS still prints, flagged "below the size rule", and no report or PR body may state it as a no-loss claim.

A quick simulation with the kit's own function (wide spread of per-blocker rates, reference recall 0.65; 150 to 300 runs, so each figure is good to about 3 points):

| Suite | Passes per arm | Equal arm passes at 10 pts | Equal arm passes at 15 pts | False NO_LOSS at delta -10 | A 23-point loss called LOSS |
|---|---|---|---|---|---|
| 14 PRs, 29 blockers | 1 | 24% | 41% | 3% | 47% |
| 14 PRs, 29 blockers | 2 | 39% | 66% | 4% | 77% |
| plus the 13 other CRITICAL catalog cases: 27 units, 42 blockers | 2 | 49% | 75% | 5% | 91% |
| if the pool grows to 57 units, 72 blockers | 2 | 71% | 95% | 4% | 100% |

So the 14 PRs alone can catch a large loss like the packets', but they can't certify no loss at 10 points. Certifying needs two passes per arm and about 70 blocking cases. A narrower spread of per-blocker rates lowers every power figure by 5 to 15 points. The build turns this simulation into the `noloss power` command and a seeded test that holds the false NO_LOSS rate at or under 5% with a Monte Carlo error under 1 point.

**Applied after the fact to the legacy arms,** labelled post hoc, the rule gives the answers GSTA-167 reached: A' against C, delta -24 points (9 losses, 2 gains), LOSS at p 0.031; A against C, LOSS at p 0.031; B against C, LOSS at p 0.004; B against A, NOT_DISTINGUISHED. A and B ran in round 2 and C in round 3, on the same cohort and blockers but different days and builds, which the table says.

**Frozen bars come first.** A round whose prereg froze its own bar is scored on that bar first, exactly as written, and the category rule follows as a second line marked post hoc. Round 2's bar (GSTA-152 4 of 4, and at least 11 of 12 set hits) fails A and B; round 3's (at most one of C's found set missed) fails A'. Round 4 froze the same kind of bar for D against C's 19, so D's first line is that bar.

### 6. The reference arm and pass-to-pass noise

The reference is the old review replayed under the same harness, one pass, with the same planner, models and normalizer. The historical blockers set the answer key: which bugs count and how to recognize them. They are not the bar, because they came from multi-pass runs with fixes in between and a Codex structured review that the replay could not run.

The blockers are, by construction, bugs the old review caught. That biases the cohort toward arms like C, and it can't credit a variant for other real bugs it finds; the new blocking findings are reported for that reason. The mined catalog cases are partly independent, since many were never named in a review section.

C found 19 of 29 on one pass, and a second pass would find a somewhat different set. The rule handles that three ways:

1. It pairs over every eligible blocker, so the reference's lucky finds and the variant's lucky finds both count.
2. The sign-flip test's spread comes from the observed differences, which already include both arms' pass noise.
3. When a reference repeat exists (R against R'), the scorer reports their discordance and how many of R's finds R' lost, beside every comparison, as the noise floor.

D is close to such a repeat: round 4's structural check says D's reviewer inputs are byte-identical to C's, and only orchestration differs. D against C's discordance is therefore an upper bound on C's pass-to-pass noise plus any orchestration effect, and the D report says so. The next paid prereg after D should buy one more reference pass. Passes are never selected or dropped; a cap stop is an incomplete run.

### 7. Blinded judging

`noloss judge-packet --suite <id> --arms <v>,<r> --out <dir>` writes one packet per PR, with no model call. A packet has the PR's blockers (id, paths, line, cause) and the findings of every arm and pass in the comparison, pooled and shuffled by a seeded order. Each finding keeps only its path, line and text, under an opaque id. Arm ids, labels, reader names, models, severity, confidence and fingerprints are removed. A blinding check refuses a packet whose text still contains an arm id, label, model id or reader name (E_NOLOSS_BLIND).

The judge returns one row per blocker: the opaque ids that name the same defect (same path, any the blocker lists; same cause; the line may move), or none. `noloss judge-join` validates the reply, unblinds through a key file the judge never saw, and applies severity mechanically from each arm's map: a match rated CRITICAL is F, a match rated only INFORMATIONAL is D, no match is M. When several findings match, the highest mapped severity counts, as GSTA-167's merge keeps CRITICAL. It writes judgments.tsv with saw_label no.

Judges are paid and are chosen per prereg: Opus 5.5 as the primary judge, and a cross-family second judge (gpt-6.1-sol) on every blocker where the arms disagree plus a seeded 20% sample of the rest. Agreement is reported as Cohen's kappa; a disagreement goes to a third read the prereg names. Every table shows the share of judgments made blind. A verdict built on labelled judgments says so in its first line, and blinded and labelled judgments are never pooled in one comparison.

### 8. The 44 catalog cases, and any review arm

The category is not tied to the 14 PRs. `noloss suite --from-catalog <dir>` turns any catalog directory into a suite: one unit per case and one blocker per unit. A case counts toward blocking recall when its audited deserved severity is CRITICAL. Today that is 14 of the 44 cases; 6 are INFORMATIONAL and feed the over-blocking rate; 24 are null and count toward detection recall only. A combined suite (the 29 blockers plus the 13 CRITICAL catalog cases not already in it) has 42 blocking blockers in 27 units, the third row of the power table.

Running an arm is outside this lane: GSTA-167's lanes on Capy subagents, or U10's real-host adapters under U18's preregistration. Any run that writes the arm directory scores the same way. A catalog case already carries what a whole-review arm needs: the repo, head, base and range.

Sealed cases, when they exist, use the same schema in the sealed store; the scorer runs on them outside this repo, and only counts and digests are committed.

### 9. What is keyless and what is paid

| Keyless (this unit, in CI) | Paid (each needs its own prereg, a Captain cap and a separate results PR) |
|---|---|
| Case import from git and cached GitHub reads; suite build and check; arm ingest and validation; the scorer, the decision rule and the export; `noloss power`; judge packets and the join; legacy arms A, B, C and A'; every test | Running any review arm, on the 14 PRs or the catalog; any judge model, primary or second; any reference repeat pass |

No command in this category calls a model. The tests run with no key.

### 10. What goes public, and the safety check

- Every no-loss case is from garrytan/gstack, public on 2026-10-30 (GitHub API: visibility public). The 44 mined cases add garrytan/gbrain, also public on that check. The import reads the repo's visibility fresh and refuses a non-public repo, as the miner does.
- Case text is drawn from public PR bodies and commit subjects and restated in plain words. Nothing comes from a private repo or a private-repo session.
- GSTA-167's four input files are committed byte for byte in a wiki bundle with their sha256 (Big decision 5), after a scan for key shapes, sealed markers and machine paths. The replay*-34/36 files are cited by digest only.
- Findings text from future arms is reviewer output on public code. It is committed only after the sealed guard and the key scan pass; otherwise only its digest is.
- No held-out material is used.

### 11. Build plan (phase 2, after this plan merges)

Sequential PRs off main, each kept near 1,000 lines:

1. **P1, cases and suite.** scripts/import-noloss-cases.ts; lanes/review-replay/catalog/noloss/ (28 cases and their audit records); the two role enum values in catalog/schema.json; lanes/review-noloss/suites/gsta167-14pr.json; the wiki bundle with GSTA-167's four files and the 29-blocker finding; tests/noloss/catalog.test.ts.
2. **P2, ingest, scorer and legacy arms.** lanes/review-noloss/ with contract.ts, ingest.ts, score.ts and cli.ts; arms/gsta167-14pr/{A,B,C,A2}/; the `noloss` row in src/cli.ts; E_NOLOSS_SUITE, E_NOLOSS_ARM, E_NOLOSS_JUDGMENT and E_NOLOSS_COST in src/errors/codes.ts, then `bun run errors:doc`; tests/noloss/.
3. **P3, export, power and blinded judging.** export.ts and tables/review-noloss.json with its markdown render; power.ts; judge.ts (packet and join, E_NOLOSS_BLIND); the lane README; tests.
4. **P4, the first results.** A wiki report post with the scored legacy arms and a handoff for arm D. It is not a preregistration and adds no run, so it may follow P3 directly.

Commands: `gstack-evals noloss suite|ingest|score|export|power|judge-packet|judge-join`. No other unit owns these files, apart from one row in src/cli.ts, five codes in src/errors/codes.ts and two enum values in the catalog schema.

### 12. Verification

- Keyless tests: the case import from recorded fixtures with no network; `suite --check`, including the prereg digests and prefixes; the legacy transcription against every number in both results files; the frozen bars giving FAIL for A, B and A'; the scorer on fixtures for each verdict and for the null case; the seeded size test; every ingest refusal (a missing row, F with INFORMATIONAL, an unknown finding id, an unknown blocker, a cost row without a meter, a severity map disagreement); the blinding refusal; the export golden file.
- CI runs `bun test`, `bun run typecheck`, `bun run errors:check` and `bun run wiki:check`, all keyless.
- READY per the Captain's suspended-/ship rule: both CI checks green at the exact head, a `gstack-pregate run --allow-repo-commands` pass from a clean checkout, Capy's review completed with every finding fixed or answered, mergeable clean.

### 13. Cost

Phase 1, this plan and its review: under the 40M cap. Phase 2 estimate: about 45M tokens across P1 to P4 (P1 about 12M, P2 about 15M, P3 about 12M, P4 about 3M, plus reviews), with no paid model calls. The Captain sets the phase 2 cap.

### 14. Risks

- **The cohort is small.** Many comparisons will read NOT_DISTINGUISHED. That is the honest result; the fix is more cases, and the power table says how many.
- **Legacy judging was labelled.** Its verdicts stand as GSTA-167's but carry the flag, and they are never pooled with blind judgments.
- **Severity maps can favour one arm.** Round 3's map is generous to C's prose voices. The scorer prints both arms' maps and flags a comparison whose maps differ.
- **Line resolution on multi-file blockers** is a hand call. The judging rule matches on any listed path and the cause, never on the line.
- **Contract drift.** The gstack Captain's next drop may differ from version 1. Ingest names every mismatch with a reason code, and unknown fields are kept, not refused.

### 15. Needs

- The Captain relays contract version 1 (section 3) to the gstack Captain before arm D reports.
- The gstack Captain, through the Captain, copies the A, B, C and A' merged.jsonl files and C's plans/<pr>.txt into the arm shape if they still exist.
- The gstack Captain learns of the 29-blocker recount.

## Review record

The public review record of run autoplan-20261030143454 is attached as review-record.md: CEO, DX and Eng phases, each with an Opus 5.5 native voice and a gpt-6.1-sol outside voice, one round each. The High findings the gate left in the plan are the build's task list.

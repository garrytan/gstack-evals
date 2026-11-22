---
id: 2026-11-22-geva-573-weekly-stable-pre-run-change-2
kind: plan
title: "Pre-run change 2 to the weekly stable number: how a HOLD clears, the run layout, the pilot's reservations, the record's fields and the results check, settled while building the weekly lane"
summary: "Folds in the Captain-approved notes (HOLD clearing per Q13, Q7's clause, $57 Ubicloud, design effect, six small notes) and what building lanes/weekly-stable settled: resolver, layout, pilot, record."
author: GEVA-573
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-22
status: open
links:
  - 2026-11-22-geva-573-weekly-stable-prereg
  - 2026-11-22-geva-573-weekly-stable-pre-run-change-1
  - lanes/weekly-stable/
attachments:
  - 2da0fce5a17b1ba11e2237c9e1fbc327ec9ce4129af34962a8e8a1a8a67bcc6a  eval-plan.md
---

# Pre-run change 2 to the weekly stable number

## What changes and why

Garry picked size S390 on 2026-11-22, with GPT-6.2 Sol in Codex left for a later call. This change goes in with the pull request that builds the weekly lane (lanes/weekly-stable), before any session has run, paid or pilot, so no outcome could have shaped it. It carries the notes the gstack-evals Captain approved for it, then what building the lane settled. Everything the preregistration (2026-11-22-geva-573-weekly-stable-prereg) and pre-run change 1 say that this post doesn't change still holds.

## 1. How a HOLD clears (replaces the clearing sentence in change 1's HOLD row)

A HOLD clears only in one of the three ways GStack Minder's Q13 names: a non-HOLD re-measure on a later commit that contains a named fix; a recorded benchmark_waiver on a hand-run cut; or the next weekly record on a later candidate that isn't HOLD. An INCOMPLETE week never clears a HOLD. If the week's candidate is still the held commit, the week runs nothing, publishes no new record, and the HOLD stands; the weekly thread tells GStack Minder so. A held candidate is never measured again (Q9); a fix reaches the weekly number as a later commit. If the published records cannot be read, a HOLD cannot be ruled out, so the week is INCOMPLETE; a repository with no published weekly record has no HOLD.

A HOLD never goes stale. It stands until a later candidate's record replaces it, however long nobody re-measures, so the resolver reads the newest published record that is not INCOMPLETE. This replaces change 1's line "A record is stale 9 days after its run started": staleness applies only to GAIN, NO CHANGE and FLAG lines, which stop counting 9 days after the run started (GStack Minder, via the gstack-evals Captain, 2026-11-22).

The HOLD row's consequence reads: GStack Minder's cut refuses regular, forced and blocker cuts whose candidate contains the measured commit **and whose stable doesn't** (Q7).

## 2. Corrections to change 1

- **Ubicloud at S390:** $57 a week expected, not $54 (three parts at ($0.60 + $0.08) an hour for 28 hours). The week is about $493 expected. Caps are unchanged.
- **Design effect (section 5):** when a task's three paired differences are correlated, the variance widens by 1 + 2ρ, so the interval and the MDD widen by its square root. The figures in change 1 already use the square root and stand.
- **Planned MDD.** "The week's planned MDD" is the size's MDD at 15% of pairs disagreeing with independent sessions: 5.5 points at S390. The record's mdd_points carries it; the realized MDD sits beside it.
- **An early stop** at the 65-task look is a full verdict, HOLD or GAIN, with stopped_early set in the record, never INCOMPLETE. The verdict publishes at the look. Sessions already queued still finish under the cap; they are kept in the run record and never read for that week. Every figure in a stopped week's record, the ungraded limits included, reads the look's 65 tasks; each ungraded limit scales by the share of tasks read.

## 3. The candidate, as gstack's release cut reads it

The lane names the candidate with gstack's own code, not a copy of it. A full clone of gstack (the whole first-parent history and the notes ref refs/notes/gstack-trains), used only by the resolver, runs lanes/weekly-stable/resolve-shim.ts, which imports crew/scripts/release-cut.ts from that clone and walks main's first-parent commits the way the cut's planRelease does: the same 7-day, 200-commit window, the same gateVerdict with the same train and release-gate evidence from readTrainNotes, newest first, stopping at stable. The first commit that reads green is the candidate. The resolver ignores the cut's floor, notes, version and freeze checks, because those decide whether a cut runs, not which commit is green; an active release-gate hold is printed beside the week. When the newest green commit is stable itself, or nothing in the window is green, the week has no candidate (change 1, section 1). When release-cut.ts stops exporting what the shim imports, the week is INCOMPLETE with that reason. A candidate that does not contain stable is INCOMPLETE.

On 2026-11-22 at 04:13 UTC the resolver walked 10 commits of a 181-commit window and found stable (v1.102.2.0, dd611038) the newest commit gated green, so a week started then would have no candidate. That output is the resolver's test fixture.

## 4. Run layout and order

- **Parts.** Three parts at once, each holding whole tasks in run order: 44, 43 and 43 of the 130 (fewer when the contamination check drops tasks). Each part is its own ledger item on its own L1 host, because one L1 host runs its parts one after another. A smoke part runs the three pilot tasks on the candidate first, on part 1's host.
- **Jobs.** L1 runs a part's jobs one after another. Each part is three jobs over its tasks: job 1 runs candidate, stable and none; jobs 2 and 3 run candidate and stable. So every task's none session runs interleaved with its first candidate and stable sessions, and the candidate-minus-none FLAG pairs sessions that ran side by side.
- **Order.** Within each job, L1's seeded() shuffles the task order and the arm order with the week's seed. The seed is the first 4 bytes of SHA-256 of the UTF-8 UTC start date (YYYY-MM-DD), read big-endian. The generator is L1's (quick/laneb/analysis/analyze.ts rng), for the run order and for the cost ratio's bootstrap, not Python's random.Random. Harbor runs a job's trials task by task with each task's arms together, so arm order is set per job, not per task.
- **Session k.** A task's graded sessions in each gstack arm are numbered from 1 in the order they opened (the metering proxy's opened_at). A session that reruns after an infrastructure failure numbers after the sessions that opened before it. Candidate session k pairs with stable session k.
- **Part VMs** carry UBI_TTL_HOURS=36 (change 1, section 8). The lane sets it for its own parts only; L1's other lanes keep 16.
- **The look** reads the first 65 tasks in run order once each of their three candidate and three stable sessions has a row. It prints STOP HOLD, STOP GAIN or CONTINUE, and no estimate.

## 5. Money

- **The week's ledger items** ws-<YYYY-MM-DD>-1, -2 and -3 (a re-measure inserts -r<k> before the part number) hold the paid lines, $610 in all: $535 model and $75 Ubicloud, split $204, $203 and $203. Part 1 carries the smoke. The launch guard refuses a launch whose part's projection passes its own cap, or whose three parts' projections, settled and open spend plus the weekly thread's own meter (cost.dollars) pass the $645 week stop.
- **The pilot** runs two sessions at once, not three. Its $14 item has to hold L1's reservations at their peak: two sessions at their $3 allowance, one $2.40 part-VM block and the awake host's $4.80 reserve for its 60-hour TTL, $13.20. Three at once would need $16.20. The pilot's guard compares that peak, plus anything already spent, with $14. Expected spend is about $3.81 in sessions and about $1 in machines. Each arm's pilot cap ($5, $5, $3.50) is still a settle check.

## 6. Record

- **No candidate:** the week publishes a record with verdict INCOMPLETE, incomplete_reason starting "no candidate:", models {} and results_check "not run: no session ran". It never holds a cut. A week that stops before any session for another reason (no v-tag at stable, a failed ./setup) publishes the same way with its reason.
- **Numbers** in models and areas are points, unrounded, so gstack's recomputation of HOLD from the model row (hi below 0) always agrees with the verdict. An INCOMPLETE record carries models {}, no areas and no realized figure, so it can never recompute as a HOLD; its partial numbers stay in the private report. At the look, the row's interval is d ± 2.797 SE; at the end, ± 1.977 SE.
- **Extra fields:** stopped_early; realized (disagreement, ρ and the realized MDD in points); stale_after, with verdict (null for a HOLD, which never goes stale) and flags, each 9 days after the run started; supersedes on a re-measure. The record carries no task id, repository name or task text. A smoke FLAG counts the smoke sessions that lost the skill listing or the routing hook's event and names no task; the per-task detail goes to the private report.
- **Latest pointer.** A release is marked latest only when no published weekly release has a later week, so correcting an older week never moves GitHub's latest pointer backwards.
- **Results check.** gstack's `gstack-eval-plan results --check` needs a plan in gstack's own form; the preregistration is not, so every week would have failed it. eval-plan.md, attached here, restates the frozen plan in that form, and on 2026-11-22 gstack main's `prereg --check` read it as ok. Each week writes results.md, one table with a row for each of its three arm identities, and runs the check with the resolver's gstack clone. A refusal makes the week INCOMPLETE. Where eval-plan.md and the preregistration or its changes disagree, they win.
- **The same-release repeat** (change 1, section 1) reads from two weeks' run records in the block post. It is not part of the weekly record.

## 7. Contamination search

The search reads every file under each built tree, binary files as text, with grep. On 2026-11-22 it found none of the 133 ids in stable v1.102.2.0's built tree, and found all 53 owner__repo-N ids of the 60 excluded fixture tasks, each in test/fixtures/skill-route-b1-in-sample.json, so it sees what it must. A smoke task named in a built tree stays in the smoke, which reads exposure only.

<details>
<summary>Agent notes</summary>

- The Captain approved items 1 and 2 and sections 1 and 2 above ("A: do it", 2026-11-22). Sections 3 to 7 are what building the lane settled; the Captain hears each with the pull request.
- No session has run.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

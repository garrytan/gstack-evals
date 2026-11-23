---
id: 2026-11-22-geva-573-weekly-stable-pre-run-change-1
kind: plan
title: "Pre-run change 1 to the weekly stable number: measure the release candidate against stable before the cut, per model, with HOLD and FLAG verdicts, a public weekly record and a choice of two weekly sizes"
summary: "Folds in GStack Minder's release needs: candidate vs stable vs none from Saturday 06:00 UTC, due Monday 10:00, HOLD/FLAG verdicts, a public weekly JSON, and an 80-task or 130x3 size for Garry."
author: GEVA-573
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-22
status: open
links:
  - 2026-11-22-geva-573-weekly-stable-prereg
attachments:
  - 22d13f3186d3ae7f9a22b652d24d2bf1b9df440d7010d4cb67845aae374e17a8  power.py
  - 37919411023ad8f5e829b13b264156a980a32082a5749a5a7fe3e75eedf6c29e  power.txt
  - a616eb9dc5151db4a1e674f6d23ea5cc4e2d749f8ec3dca05c934d70311a9dfb  s390.py
  - 09e92ddec3ac05c92414cc66b8bf88271e9f820ab55db811b17ceeeeb4abd79e  s390-tasks.txt
---

# Pre-run change 1 to the weekly stable number

## What changes and why

GStack Minder sent the release side's needs for this number on 2026-11-22 (GSTA-786, for GST-3442; its requirements Q1 to Q18, under R14). The split, set by Capy Workflow Improver: gstack-evals owns the measurement and runs it, and GStack Minder says when the stable cut needs it, where it shows and which difference changes a release decision. This change folds those needs into the preregistration (2026-11-22-geva-573-weekly-stable-prereg) before any paid week. It is made before any session has run, paid or pilot, so no outcome could have shaped it. Everything the preregistration says that this post doesn't change still holds.

The biggest change is the pair. The preregistration compared this week's stable with last week's, after the fact. The release side needs the number before the cut, so the week now compares the commit that is about to ship with what users have now. After Monday's cut ships that commit, the same number reads as "this week's stable against last week's", so it still answers Garry's question with no extra run.

## 1. Arms (replaces the preregistration's section 4 table and its "this" and "last" rows)

| Arm | gstack | Prompt |
|---|---|---|
| candidate | the newest commit on gstack's main branch with a green release-gate record at Saturday 06:00 UTC, as gstack's release cut reads that record | B1's plain prompt |
| stable | the sha refs/heads/stable points to at Saturday 06:00 UTC, peeled to its v-tag | B1's plain prompt |
| none | none (R44), B1's none tar byte for byte | B1's plain prompt |

Both gstack arms are fetched at depth 1 by sha and installed by gstack's own ./setup exactly as the preregistration's section 4 says, with its rev-list, remote and contamination checks. The candidate need not carry a v-tag; the record names its sha and the version in its VERSION file. All three arms run in the same window, interleaved; a week never reuses an earlier week's stable sessions.

When the candidate equals stable (nothing new passed the release gate), the week runs nothing, the record says "no candidate" and the spend is $0.

The preregistration's first-week rule for "last" (the newest v-tag at or before run start minus 7 days) and its rule that each week records its "this" no longer apply, because no arm depends on an earlier week. That also settles the review note that the rule's "tag date" was undefined: no rule here reads a tag date. Stable is read from refs/heads/stable at Saturday 06:00 UTC and peeled to the v-tag that points at it; when no v-tag points at it, the week is INCOMPLETE and the gstack-evals Captain hears why. The same-release repeat (section 10 of the preregistration) becomes: this week's stable arm against the candidate arm of the week whose candidate became this stable, when there is one.

## 2. Timing (replaces the schedule in section 13)

- Trigger: Saturday 06:00 UTC, cron `0 6 * * 6` in UTC.
- Due: Monday 10:00 UTC, four hours before the 14:00 UTC cut. A late result is still published; GStack Minder's cut applies a late HOLD to any later cut whose candidate contains the measured commit and whose stable doesn't.
- A missing or late result never blocks a cut.
- A record is stale 9 days after its run started.
- A re-measure runs only when GStack Minder names a repair, on a new commit that contains it. It is its own counted run with its own ledger item at the weekly cap, started by the gstack-evals Captain, and it counts toward the program's spend.

## 3. Verdicts (replaces the weekly table in the Decision section; the block reading and the program stop rule stay)

Each model gets its own verdict; models are never pooled. The primary is passes, candidate minus stable, paired. The first matching row of the first three gives the verdict; FLAG lines are added beside any verdict except INCOMPLETE.

| Verdict | When | What happens |
|---|---|---|
| INCOMPLETE | the preregistration's section 9 rule, with candidate in place of this | No verdict for that model. Never holds a cut. If the candidate's own ./setup fails, GStack Minder gets a broken-install report. |
| HOLD | the model's 95% interval for candidate minus stable lies wholly below 0 (at size S390, the stop bounds of section 5 decide it) | GStack Minder's cut refuses regular, forced and blocker cuts that contain the measured commit; security, regression and data-loss cuts still pass. The weekly thread sends Minder the flipped tasks, both arms' transcripts and diffs, exposure and the commit range. A HOLD clears by a non-HOLD re-measure after a named fix, a recorded benchmark_waiver on a hand-run cut, or the next week's non-HOLD record. |
| GAIN | the interval lies wholly above 0 | Reported. Never holds anything. |
| NO CHANGE | neither | Reported with the interval and the week's realized MDD. The release ships as normal. |

With no true change, a HOLD fires falsely for a model in about 2.5% of weeks, about 1.3 weeks a year per model measured, which is the false-hold budget the release side set (Q11).

FLAG, report only, any of:
- the point estimate is at or below minus the week's planned MDD while the interval crosses 0;
- candidate minus none has a 95% interval wholly below 0;
- the cost ratio, candidate over stable, has a 95% interval wholly above 1 with a point estimate of 1.10 or more (the preregistration's rule 3);
- the candidate's provider safety stops differ from stable's by 3 sessions or more;
- an area's interval lies wholly below 0. This task set has one area, `python-bugfix`, so an area FLAG matches the overall verdict until a new task set adds areas.

## 4. Models

Opus 5.5 in Claude Code runs every week, as in the preregistration. GPT-6.2 Sol in Codex CLI is what the release side asks for beside it, per model and never pooled. It joins only by a later dated change, after B2's Codex rig has passed its own pilot and the weekly total with Sol has gone to Garry (section 6). Until then each record's models map carries only Opus, and its flags carry the line "gpt-6.2-sol not run: <reason>", so gstack's reader sees a missing model as missing, never as clean.

## 5. Size: one of two frozen sizes, picked before the first paid week

The release side asks for 80% power at a 5-point drop per model and says a drop under about 2 points changes nothing. The preregistration's 80 tasks can't reach that. Two sizes are frozen here, both fully specified. The gstack-evals Captain records which one Garry approves before the first paid week, and that size holds until another dated change.

**S80** is the preregistration as written: 80 tasks, one session per task in each arm, no interim look. MDD about 12 points (9.9 to 14.0 at 10% to 20% of pairs disagreeing).

**S390** uses all 130 eligible tasks of the preregistration's pool, three sessions per task in the candidate and stable arms and one in none. The run order is the preregistration's seeded shuffle of the sorted 130, so its first 80 are S80's tasks in the same order; s390.py prints all 130 in that order (s390-tasks.txt) and checks its first 80 against the preregistration's tasks.txt. The primary pairs session k of the candidate with session k of stable on each task, 390 pairs, with a cluster-robust interval by task (the preregistration's block formula, applied within the week). MDD 4.5, 5.5 and 6.3 points when 10%, 15% and 20% of pairs disagree, if the three sessions of a task disagree independently. It reaches the release side's 5 points only at about 12% disagreement or less. If a task's three paired differences are correlated, the interval widens by the design effect 1 + 2ρ. At ρ = 0.33 the MDD becomes about 5.8, 7.1 and 8.2 points. GStack Minder's guide, gstack-evals#352's gstack-against-none interval (about 100 pairs, ±6.6 points), implies about 11% of pairs disagreeing, and version-against-version pairs should disagree less. Neither size is sure to meet the 5-point ask. S390 meets it if versions disagree on about 12% of pairs or fewer and task effects are small. Each week's record reports the realized disagreement, ρ and the realized MDD. If the realized MDD is above 6 points after the first two counted weeks, the gstack-evals Captain gets a dated change that proposes a larger size, with its cost, before the third. The candidate-minus-none FLAG pairs each task's first candidate session with its none session, 130 pairs.

At S390 the preregistration's per-week rules apply to all 130 tasks and the three pilot tasks:

- The contamination check (section 6, step 3) searches every one of those 133 ids in its four forms, and a hit drops that task from the week's pairs in every arm.
- INCOMPLETE scales with the size, at more than 10%: more than 13 of the 130 tasks dropped by the contamination check, or more than 39 of an arm's 390 sessions ungraded (13 of none's 130). Pairs use the session pairs graded in both arms.

S390's paid spend at caps passes $500, so it takes one interim look (R113):

- At: half the tasks, the first 65 in run order, once all their candidate and stable sessions have settled.
- Stop bounds: |z| of at least 2.797 at the look and 1.977 at the end (O'Brien-Fleming shape, 5% two-sided, the published values). A stop at the look gives HOLD or GAIN on those 65 tasks, and the record says it stopped early. The end interval uses 1.977 standard errors.
- No other look. The controller prints progress counts only.

## 6. Money (adds to the preregistration's section 12)

| Size | Model spend expected | Model cap | Ubicloud expected | Ubicloud cap | Meter expected | Meter cap | Week expected | Week at caps |
|---|---|---|---|---|---|---|---|---|
| S80, Opus | $103 | $145 | $15 | $20 | $12 | $20 | $130 | $185 |
| S390, Opus | $416 | $535 | $54 | $75 | $20 | $35 | $490 | $645 |

S390's model cap is its expected spend times 1.15 plus 18 sessions in flight at their $3 allowance. Sol at the same size would add about $126 (S80) or $489 (S390) in model spend a week (power.txt), plus a similar Ubicloud share; at S390 both models together come to about $1,040 a week expected. Over a year with a candidate every week: S80 about $6.8k, S390 Opus about $25k, S390 with Sol about $54k expected.

## 7. Record (adds to section 13's "Where the number lives")

Each week publishes one public, token-free, immutable JSON file as a GitHub Release asset on garrytan/gstack-evals, release tag `weekly-<yyyy>-w<nn>` (the ISO week-year and ISO week of the run start; a re-measure takes the tag of the record it supersedes plus `-r<k>` for its k-th re-measure), file `weekly.json`. GitHub's latest-release address is the `latest` pointer. A published release is never edited; a correction is a new release with a suffix and a field naming the release it replaces. The file follows schema 1 of GStack Minder's requirements (Q16, org drive handoffs/GSTA-786/requirements.md section 5): week, task_set ("v1", the preregistration's frozen pool), the candidate's sha, stable's tag and sha, the window's start and end, the verdict, mdd_points (the size's planned MDD), the interval level, one entry per measured model with n, d, lo and hi in points and its vs_none difference, the one area, the flag lines, incomplete_reason, results_check, and links to the preregistration, the block results and the run. A re-measure's record names the record it replaces in supersedes (Q18). The top-level verdict is HOLD when either model's is, so gstack's recomputation from the model rows (Q17) always agrees with it. The record passes gstack's `gstack-eval-plan results --check` before it publishes, and a refusal makes the week INCOMPLETE. It carries no task ids, repository names or task text. The frozen task list itself is public in the preregistration's bundle, and the record adds nothing to it.

The Captain drive's weekly page and the block results posts stay as the preregistration says. Under R77 the weekly record needs no pull request.

## 8. Machines (replaces the Ubicloud line in section 13)

S80 runs as the preregistration says: 36 vCPUs for about 11 hours. S390 runs three part VMs and their hosts at once, 54 vCPUs, for about 28 hours of the 52-hour window from Saturday 06:00 to Monday 10:00 UTC, with UBI_TTL_HOURS=36. Sol at the same size would run beside it for another 54, 108 in all, inside the crew's 208.

## 9. Pilots

The preregistration's one-time pilot stands, with candidate and stable in place of this and last; the weekly smoke runs on the candidate arm. The pilot's three tasks are calibration tasks outside the 130, so S390 doesn't touch them.

## 10. Notes left open by the preregistration's review, settled here

- **Pilot caps.** Each arm's pilot cap is the most that arm's pilot sessions may settle, and the report prints FAIL for an arm that settles above it, as B1e's per-arm pilot caps work. The $14 pilot ledger item is the only hard money stop, and three sessions at once keep its reservations inside it.
- **A smoke that fails because of gstack's own change.** The weekly smoke checks that gstack's skill listing reached the model and its routing hook logged an event. If the candidate itself changed or removed that hook or listing, the smoke fails for a release reason, not a rig reason. The week then runs, its record carries a FLAG "exposure changed: <what the smoke saw>", and only a rig failure makes it INCOMPLETE.
- **A gstack arm whose own ./setup fails.** For the candidate, that is INCOMPLETE plus a broken-install report to GStack Minder. For stable, it is INCOMPLETE and goes to the gstack-evals Captain, because users already run that release. No arm depends on an earlier week any more, so the preregistration's concern about a broken "last" no longer applies.
- **Dates.** "The week's date" is the UTC date of the run start, and the record's week number is its ISO week, with the ISO week-year as its year. The seeds derived from it are SHA-256 of that date's YYYY-MM-DD string, first 4 bytes as an unsigned integer.
- **Contamination search.** Ids match case-sensitively. The owner/repo forms match case-insensitively. A match needs a non-digit (or the end of the text) after the number, so task 59 doesn't match 591.
- **A cap stop's partial cost ratio** covers only the tasks that finished, which lean toward cheaper sessions. The record says so beside the ratio, and it is never read as a FLAG on its own.
- **The bridge week** after a rig change stays as the preregistration says: it publishes its record with rules on, because all three arms share a rig within a week. Its record and page say it is a bridge week. This replaces the preregistration's bridge rule, which switched rules 2 to 4 off.

<details>
<summary>Agent notes</summary>

- GStack Minder's requirements arrived by agent message from GSTA-786 on 2026-11-22. GStack Minder then copied the full text, unchanged, to the org drive at handoffs/GSTA-786/requirements.md (14,268 bytes), and this change was checked against it.
- No session has run. The choice between S80 and S390, and whether Sol joins, go to Garry through the gstack-evals Captain with the weekly totals above.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

---
id: 2026-10-30-gsta-33-u14-review-case-mining-rules
kind: plan
title: "U14 review case mining rules, fixed before any case is mined"
summary: The outcome-free rules scripts/mine-review-cases.ts applies to gstack and gbrain fixes merged after 2026-10-17, and the answer-key and decoy audits every mined case passes.
author: GSTA-33
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: done
links:
  - scripts/mine-review-cases.ts
  - lanes/review-replay/catalog/schema.json
  - 2026-10-28-gsta-3-v1-build-breakdown
  - 2026-10-30-gsta-32-u13-review-replay-lane
  - 2026-10-29-gsta-20-review-replay-y09-correction
  - 2026-10-28-gsta-11-review-replay-prereg
---
# U14 review case mining rules

Thread GSTA-33, for the gstack-evals Captain (GSTA-2). This post fixes the rules for mining review replay cases (plan v3.2, "Review replay lane", Cases; build breakdown U14). It lands with the miner, scripts/mine-review-cases.ts, before the miner has run on any data. The mined cases, their audit records and the drop list come in a later pull request. Nothing here depends on a replay outcome: no replay of a mined case has run, and none runs in U14.

## Sources and window

- Repos: garrytan/gstack and garrytan/gbrain. At mining time the miner reads `GET /repos/<repo>` fresh, never from its cache, before it reads any history. A repo whose visibility is not public yields no case, and the run records why. Nothing from a private repo is committed.
- Window: the fix merged into the repo's default branch at or after 2026-10-18T00:00:00Z ("merged after 2026-10-17") and at or before the snapshot time the run records. Later commits on the default branch, through the snapshot head, count only for the decoy audit.
- The two seeds from U13 stay as they are, except for their audit fields. Their PRs take no mined case.

## Rule 1: the fix locates the defect

A case comes from a fix whose diff points at the defect's lines. There are two kinds, and both use the same blame rule.

- **Escaped.** A merged PR F whose title marks a fix (`/\b(?:hot|bug)?fix(?:es|ed)?\b/i`) and is not a revert. F's diff is read against the default branch just before F (the squash's or merge's first parent). The PR that F's rewritten lines came from is the reviewed PR X: the defect passed X's review and reached the default branch.
- **Review-caught.** A merged PR X with a commit Fc on its branch whose subject marks a review fix (GSTA-11's pattern: review, pre-landing, pass N, red team, specialist, fix-check, outside voice, adversarial, codex, findings or greptile; not a merge, a stamp or a CHANGELOG chore), with one parent that is also on X's branch. Fc's rewritten lines came from X's own earlier commits: X's review caught the defect before merge, as in the seeds.

The blame rule, for both kinds:

1. Only source files can hold the defect. A file is skipped when it is a test (gstack's TEST_PATH_RE from bin/gstack-diff-scope), a Markdown doc (`.md`, though `.md.tmpl` templates count as source), a changelog, VERSION, a lockfile, package.json, a golden fixture or size ledger, generated (`AUTO-GENERATED` in its first 400 bytes), binary, or new in the fix.
2. The fix touches 1 to 5 such files. More than 5 is too broad to locate one defect.
3. For each file, the fix's old-side lines are blamed at the fix's parent (`git diff -U0`; an insertion blames the line before and after it). A file counts only with at most 6 hunks and 120 old-side lines.
4. Escaped: each blamed commit maps to the default-branch commit that brought it in, then to its merged PR through `GET /repos/<repo>/commits/<sha>/pulls`. The PR holding the most blamed lines must hold at least half of them. Review-caught: the lines blamed to commits of X's branch must be at least half.
5. Of the qualifying files, the one with the most such lines is the case's file (ties go to the path that sorts first). Its located lines are those lines, moved to the reviewed head's coordinates.
6. The answer key is the file and the first located line, or another located line the hand audit picks. A defect line always comes from the fix's diff.

## Rule 2: a reviewable pre-fix head and merge base

- Escaped: the reviewed head is X's head (`head.sha`, fetched from `refs/pull/<X>/head` when needed), and the merge base is `git merge-base <head> <X's merge commit>^1`.
- Review-caught: the reviewed head is Fc's parent, and the merge base is `git merge-base <Fc^> <X's merge commit>^1`.
- Both must resolve in a fresh clone of the public repo, and the merge base must be an ancestor of the head.
- At least one located line must be an added line of `git diff <merge base>..<head>`, so a reviewer reading the PR sees it. Located lines that are not added there drop out.
- The reviewed diff, filtered, has 10 to 2,000 changed lines. The filter drops changelogs, VERSION, lockfiles, package.json, golden fixtures, size ledgers and generated files, but keeps tests and docs, which the reviewer reads.
- The case's diff_range is the merge base to the head.

## Rule 3: the decoy range and its audit

- Each case's decoy is its fix: F's squash or merge commit against its first parent (escaped), or Fc against its parent (review-caught). Its filtered diff has 1 to 2,000 changed lines.
- **The later-fix search (y09).** A decoy is clean only after a check for a later fix to its lines. The miner blames every line the decoy added at the decoy's own commit, in source files and tests (docs, noise and generated files aside). That gives each line a stable identity: the commit that carries it and the line number it had there. For a review-caught decoy in a squash-merged repo, the lines that survive to X's head, after any rename on X's branch, are also mapped into X's squash commit. A line that cannot be followed into the squash commit leaves the decoy unaudited, as "needs human check". Then every later commit is checked: X's branch commits after Fc, and every first-parent commit on the default branch after the case's merge, through the snapshot head, whatever its subject. A later commit that rewrites or removes one of those lines is a hit. The search does not stop at a window or at "fix" subjects, which is how decoy y09 slipped through in GSTA-11.
- No hit: the script writes the audit as clean, with later_fix null, and its method names the snapshot head and counts.
- A hit is a judgment the script can't make, because a later change may be a fix, a refactor or a feature. The script leaves the audit null and marks the decoy "needs human check" with the hits. The hand audit reads each hit. A fix to a defect in the decoy's lines makes it holds-defect: the decoy leaves the case, the later fix is an escaped-defect candidate (the miner finds it as its own case when it qualifies), and a case left with no decoy is dropped. Any other change makes it clean, with the reason in the method.
- A null audit is never scored as clean (`scorableAsClean`).

## Rule 4: the answer-key audit

The script checks each candidate mechanically. A candidate that fails a check is dropped with the check's name:

- the repo is public;
- the fix merged into the default branch inside the window;
- the reviewed head and merge base resolve, and the merge base is an ancestor of the head;
- the defect line exists at the reviewed head and is an added line of the diff range;
- the fix's diff rewrote the line, by blame, and the line came from the reviewed PR;
- the reviewed and decoy diffs fit their sizes.

Then a hand audit reads the fix's text and diff, the reviewed diff around the line, and the reviewed PR's review receipt. The hand audit is one agent's reading, recorded with its model, not a person's. It answers these:

- H1. The fix corrects behaviour that was wrong at the reviewed head. Its text names a failure: wrong output, a crash, a refusal of valid input, a check that fails open, data or secret loss, a security exposure, or a test the old code fails. The located lines are where that failure comes from. These are rejected: features, refactors, renames, wording or docs with no behaviour change, tuning with no stated failure, design reversals, flaky-test-only changes, failures only an environment or dependency shows, and failures that sit in other files.
- H2. The defect is visible from the reviewed diff and the repo at the reviewed head. It does not depend on code or facts that arrived later.
- H3. The summary states the failure in one or two sentences, from the fix's own words where possible.
- H4. Deserved severity, on gstack's floor: CRITICAL when the evidence says the defect fails a test, breaks production, or loses data or secrets; INFORMATIONAL when the evidence puts it below that floor; null when the evidence does not settle it.
- H5. Each decoy hit, per Rule 3.

A candidate whose H1 or H2 the hand audit cannot settle is rejected, with the reason recorded. Severity it cannot settle stays null, and the audit record lists it under "needs human check" with the reason. A guess never fills it.

## Rule 5: order, one case per PR, and the stop rule

- Candidates are collapsed to one per fix: per fix PR (escaped) or per fix commit (review-caught). The fix keeps the file Rule 1 picked.
- The audit order is the sha256 of the candidate key (`<repo>#<fix PR>` for escaped, `<repo>#<PR>@<first 12 hex of Fc>` for review-caught), ascending, across both repos and both kinds.
- Walking that order, a candidate is skipped when its reviewed PR or its fix PR already appears in a case, as either the reviewed PR or the fix PR (the seeds included). A rejected candidate takes no PR: the next candidate in order is audited.
- The audit stops when 75 mined cases are confirmed. Candidates past that point are listed as not audited, which says nothing about their quality. With fewer than 75 candidates, every one is audited.

## Shelf life

Every mined case is public, so every one is short-shelf-life (short true). first_appeared is the earliest UTC date among the fix PR's creation (F for escaped, X for review-caught) and the creation of each issue the fix PR names in its title or with a closing keyword in its body (fixes, closes or resolves #N). The source field lists each date and where it came from. A case counts only for models released before that date.

## Roles and history

- Roles: red-team, plus the specialists gstack /review's dispatch picks for the reviewed diff (selectSpecialists in quick/replay/lib.ts, GSTA-11's port of review-army step 4.5, adaptive gating off). The scope flags come from gstack's bin/gstack-diff-scope `<merge base> --head <head>`, at the gstack sha the run records. State-machine scope is unknown, which the dispatch counts as possible.
- severity.in_history: for an escaped case, the reviewed PR's review receipt. When X's review section names the defect file, the hand audit decides whether it raised the defect. Otherwise the record is "not raised", or "no review receipt" when X's body has no Pre-Landing Review. For a review-caught case, the script quotes the review sentences that name Fc or the defect file, and the hand audit states who raised the defect and at what rating.

## Files

Cases go in lanes/review-replay/catalog/public/<id>.json, in U13's schema with no new field. Each case's audit record, with every mechanical check, the located lines, the decoy search and the hand audit, goes in public/audit/<id>.json. The miner's output (public/mining/mined.json), the hand audits (public/mining/hand.json) and the drop list with every reason (public/mining/drops.json) go beside them. `build --check` regenerates every generated file from mined.json and hand.json and fails on any difference.

## Limits

- Clean means no later change through the snapshot head. The window is about two weeks old, so many later fixes haven't happened yet, and a clean decoy can still hold a defect nobody has found.
- Blame finds where the fix's rewritten lines came from, not always where the defect began. A fix that only adds a missing check blames its neighbours, so the hand audit's H1 and H2 matter most for insertions.
- The hand audit is one agent's reading. The audit record says so, and anything it can't settle is left for a person.

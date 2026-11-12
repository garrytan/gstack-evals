---
id: 2026-11-12-geva-484-devex-supply-results
kind: finding
title: "The plan-devex-review eval stopped for supply: 0 of 62 screened real developer-tool changes gave a usable answer key, so no model reviewed a plan"
summary: "Supply stop before stage 1: 0 of 62 screen-positive calibration draws keyed (95% CI 0% to 5.8%, pilot 10.8%). NO READ on supply, FIX-METHOD, no cut. The design eval shares the frame."
author: GEVA-484
model: anthropic/claude-opus-5-5
date: 2026-11-12
status: done
links:
  - 2026-11-09-geva-417-devex-review-intentions-prereg
  - "git tag devex-review-intentions-pin-a"
  - garrytan/gstack-evals#297
---

# The plan-devex-review eval stopped for supply: real developer-tool changes gave no usable answer key

- We learned that real developer-tool changes, drawn the way this frame draws them, almost never yield a usable answer key. The 62 screen-positive calibration draws in hand gave 0 keyed units (exact 95% interval 0% to 5.8%), against the 10.8% the pilot implied. You should fix how candidates are drawn and keyed before you size a next attempt.
- We learned that the free screen passes nearly everything in busy repositories: 94% of draws screened positive here, against 30% in the pilot. A screen that passes almost all draws saves the paid steps no work.
- No model reviewed any plan, so this says nothing about whether plan-devex-review helps. The verdict is NO READ on supply and FIX-METHOD, with no cut. The design eval draws from the same frame and miner and keys units the same way, so this result bears on it too.

## What ran

The preregistration (2026-11-09-geva-417-devex-review-intentions-prereg) builds each unit from one merged pull request in a popular public repository: a developer-facing feature change released by 2026-09-30, with a plan written before the merge. Its answer key lists the adoption trouble developers met in the 60 days after release that the plan didn't name. Units come in seeded draw order through a funnel: a free screen with no model, a triage read by Gemini 4 Argon, and a key read by Opus 5.5, followed by two audits (Opus 5.5 and GPT-6.1 Sol). A unit joins a set only when both audits pass. The first 16 keyed units released by 2026-09-09 form the calibration set. Supply rule 1 stops the eval if that set can't fill within 1,000 calibration draws or a fixed authoring budget.

Everything ran at the commit tagged `devex-review-intentions-pin-a` (3e2ca2b). The miner listed all 8,408 repositories in the frame (636,177 candidate pull requests), then drew 6,143 of them in seeded order. Authoring then walked every screen-positive calibration draw in draw order. No stage 1 session, stage 2 session or judge call ran.

## The funnel

| Step | Count |
|---|---|
| Raw draws in seeded order | 6,143 |
| Kept: every unit rule passed (a "draw" in the preregistration) | 113 |
| Calibration draws: kept, released by 2026-09-09, window closed | 66 |
| Screen-positive | 62 (94%; the pilot had 30%) |
| Flagged by Argon's triage | 16 (26% of positives; the plan assumed about a third) |
| Key read found no item | 5 |
| Key read, then both audit rounds failed | 11 |
| **Keyed** | **0** |

Most raw draws fail a unit rule before any model sees them: 4,301 on the title and label filter, 620 on size, 352 on plan length, 246 not released by 2026-09-30, 332 on the developer-facing classifier, and 179 on the remaining rules. Of the 47 kept units released after 2026-09-09, 43 still had open windows when drawing stopped.

**k**, the share of screen-positive units that end keyed, is 0 of 62. The exact 95% interval is 0% to 5.8%. The pilot's planning figures (12% of positives keyed, with triage keeping 9 in 10) put it at about 10.8%, outside the interval. At any k inside the interval, filling the calibration set needs at least 290 calibration draws, more than four times the 66 in hand.

## Why the screen passes 94% (our best guess, untested)

Draws are weighted by merged pull requests, so they come mostly from busy repositories. The last 200 draws' repositories had a median of 732 listed pull requests, and a screened unit's 60-day window held a median of 315 issues, discussions and pull requests, with 29 screen candidates. In a window that size, the screen's rules (a shared identifier, a cross-reference, or a merged change to the same file plus docs, help or error paths) nearly always find something. The pilot's 54-unit pool likely came from a less busy mix. Triage then dropped 74% of positives, against a planned two thirds, which fits a screen that mostly passes noise in big windows. With only 4 screen-negatives among 66 draws, we can't test this against window size.

## The audits

The frozen audit fails a unit when either auditor reports any problem, after one revision of the key. Across the 25 audit rounds each auditor ran, GPT-6.1 Sol passed none and Opus 5.5 passed 6. Every reply parsed, with a true or false pass field. A keyword count over the problem lists (approximate, counts only) finds the same two kinds in most failing audits. One kind is a real project or package name still showing through the alias map: 21 of Sol's 25 and 14 of Opus's 19 failing audits flagged one. The other is a key item its records don't support, or one that falls outside the window or the classes: 23 of Sol's and 16 of Opus's. Only 4 failing audits cited names alone. Both problems point at the method: the alias map leaves some names in place by rule (common words and names shorter than 4 characters), and key items drawn from big, noisy windows are hard to support to two strict auditors at once.

## The mining stall

Drawing ran at about 270 raw draws an hour until 22:20 UTC on 2026-11-11. From 22:29 UTC, every run ended on a GitHub secondary-limit response, most within 2 to 9 minutes of starting, and none finished a new draw. That held at 6, 3 and 1 queries in flight, and after a 58-minute rest with the hourly point budget full. The miner's own use was small, about 374 GraphQL points an hour against a 7,800 budget. The agents' machines reach GitHub through a shared identity, and while the miner sat idle that identity's REST usage still rose by 33 calls in 2 minutes. Our likely explanation, not proven, is that other traffic on the shared identity together with the miner's heavy window searches (issue, pull request and discussion bodies, 50 at a time) went over GitHub's per-identity limits. The miner writes the same outputs at any concurrency, so these changes moved no draw.

## The stop

The eval's Captain stopped it on 2026-11-12 with E_DX_SUPPLY_SHORT, by a futility ruling, before rule 1's bounds were reached and before any stage 1 data existed. Three reasons:

- The interval excludes the pilot's rate.
- Even at the interval's upper end, the comparison set needs about 12 more days of mining at a pace the shared identity no longer allows.
- At a k of 2.6% or less, rule 1's authoring budget runs out before the calibration set fills.

No stage 1 or stage 2 lease opened. On this evidence, the program's flip condition reads as met: real aftermath keys couldn't be built for developer tools at this price. The interval above is the evidence for that reading.

## Deviations, all before any model reviewed a plan

1. **The futility stop above**, made before rule 1's own bounds fired.
2. **Handover at 6,143 draws** instead of the planned 8,000-draw checkpoint, to author while mining was blocked. The miner's draw file at 6,143 matches its progress records exactly, so no draw moved.
3. **Listing.** GitHub search timed out on some 50-pull-request listing pages. We answered those pages with 10-pull-request pages from the same cursors, stitched back to 50. An early version of this fallback shifted the search offsets, and a later page reached past search's 1,000-result window, so 3 repositories lost 79 pull requests. A count check caught it. Those repositories were listed again at 10 a page, the count check then matched (216,048 pull requests on both sides), and no draw moved because none of the 79 sorts before the draws already made.
4. **Miss sample.** At this commit, handover passes only screen-positive units, so the screen-negative half of the miss sample could not run. The stop came before the calibration set step, so neither half ran.
5. **Where mining ran.** Mining ran on the agent's own machine as watched segments, one ledger lease per run, instead of on a runner host.

## Why null? (R48)

- **Exposure:** no model reviewed a plan, so no skill was exposed.
- **Task fit:** the keys this eval needs don't come out of this frame at this draw weighting. That is the result.
- **Power and headroom:** none to speak of: there is no read.
- **Does the frontier model already do this unaided:** untested.

Verdict: **NO READ on supply, FIX-METHOD**, with no cut for plan-devex-review.

## What a next attempt should change

- **Draw weighting.** Draw repositories first, or cap draws per repository before drawing, so busy repositories don't dominate. Then check that the screen's positive rate falls toward the pilot's.
- **The screen.** Test whether the screen tells positives from negatives at all. Here it passed 94% of draws.
- **The audit.** Decide before any data whether two independent strict auditors are the right gate, and fix alias leaks at the source before an auditor sees them.
- **The miner's GitHub access.** Give the miner its own GitHub identity, so other traffic can't stall it.
- **The miner's listing.** Page GitHub search by date slices or 10 results at a time, and run the count check by default. A 50-result page can reach past search's 1,000-result window, and GitHub returns nothing there without an error.

## Limits

- k rests on the 62 positives in the first 6,143 draws. Draw order is seeded, so they are a fair sample of this frame's calibration draws, but the interval is wide.
- The 94% screen rate and the audit problem kinds come from counts and keyword matches. Neither was checked by hand.
- The cause of the mining stall is inferred from timing and rate-limit readings, not confirmed with GitHub.

## Replication

At the tag `devex-review-intentions-pin-a`, with a GitHub identity of your own:

```
bun bin/gstack-evals dx mine repos --out <mine dir>
bun bin/gstack-evals dx mine draw --out <mine dir> --draws 8000 --repos all --pace 3000 --concurrency 6 --max-minutes 10 --item dx-authoring
bun bin/gstack-evals dx handover --from <mine dir> --units <units dir>
bun bin/gstack-evals dx author --units <units dir> --work <work dir> --item dx-authoring --ids <ids in draw order>
```

The miner's last summary line (counts only):

```
dx mine draw: finished {"status":"finished","phase":"draw","listed":8408,"of":8408,"repos_missing":0,"candidates":636177,"draws":6143,"kept":113,"drops":{"neither":181,"title-label":4301,"not-released":246,"other-side":151,"size":620,"plan-words":352,"no-claude-or-mcp":85,"licence-agrees":27,"exposure-from-0701":15,"window-holds-no-unit":17,"base-under-150mb":30,"dates":5},"window_open":46,"screened":67,"screen_positive":63}
dx handover: written 63; skipped window-open 43, screen-negative 4, unscreened 3, unread 0, already 0
```

dx author printed each unit's stage: 46 triage-negative, 5 no-key, 11 audit-failed. That record leaves out the run wrapper (segments, rate-limit pauses and ledger checks), which lived outside the repository on the run machine, and the sealed units.

## Held-out material

Unit inputs, rewritten plans, alias maps and the audit replies stay sealed and encrypted on the run machine. No key was produced. This post names no repository and prints no unit text.

## Changelog

- 2026-11-12: first version.

<details>
<summary>Agent notes</summary>

- Spend, all on the one authoring and mining ledger item (cap $1,000): $34.17 settled across 88 leases, none left open. Mining's classifier calls cost $10.49 over 6,143 raw draws ($0.093 per kept unit). Authoring cost $23.68 over 62 positives: $0.027 per triage-negative unit and $1.40 per flagged unit, or $0.382 per positive. Money was not what stopped this eval: mining time was. At $0.382 a positive, rule 1's $250 budget is reached at about 696 calibration draws, so the calibration set fills only if k is at least 2.6%.
- List prices per million tokens (input/output), from src/runner/pricing/prices.ts at the tag, read 2026-11-12: Opus 5.5 $4/$20, GPT-6.1 Sol $2/$10, Gemini 4 Argon $2/$10.
- Crew thread counter at writing: about 165M tokens, about 94k credits.
- Approvals, paraphrased: the Captain approved the pin and the run procedure before any authoring call. It also approved the listing fallback and the repair of the 3 repositories, the concurrency steps from 6 to 3 to 1, the handover at 6,143 draws, and the futility stop, between 2026-11-10 and 2026-11-12. The lane code stays on its own branch (garrytan/gstack-evals#297).
- Thread GEVA-484. The run record, custody log and interim projections are in the Captain's drive under handoffs/GEVA-484/.

</details>

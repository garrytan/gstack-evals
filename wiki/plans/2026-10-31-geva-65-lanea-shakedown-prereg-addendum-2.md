---
id: 2026-10-31-geva-65-lanea-shakedown-prereg-addendum-2
kind: plan
title: "Lane A shakedown preregistration, addendum 2: rerun rows 3, 5 and 7 with their calibrations on the fixed rig"
summary: "Reruns /learn Haiku 5.5, /learn gpt-6.1-sol in Codex and office-hours Opus 5.5, each after its calibration, on a main with #81 and #84, under new items and U11's cumulative $480 stop."
author: GEVA-65
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-31
status: open
supersedes: [2026-10-30-gsta-51-lanea-shakedown-prereg-addendum]
links:
  - 2026-10-30-gsta-42-lanea-shakedown-prereg
  - 2026-10-30-gsta-51-lanea-shakedown-prereg-addendum
  - 2026-10-30-geva-54-lanea-shakedown-results
  - https://github.com/garrytan/gstack-evals/pull/81
  - https://github.com/garrytan/gstack-evals/pull/83
  - https://github.com/garrytan/gstack-evals/pull/84
  - docs/rig.md
---
# Lane A shakedown preregistration: addendum 2

GEVA-65, for the gstack-evals Captain (GSTA-2), issue GST-280. This post reruns three rows of [the Lane A shakedown preregistration](2026-10-30-gsta-42-lanea-shakedown-prereg.md) (#74, 3ea75fa) on a fixed rig. It supersedes [addendum 1](2026-10-30-gsta-51-lanea-shakedown-prereg-addendum.md) (#79, 2c38729) and keeps all of it in force for the rerun, except where sections 3 and 4 below change the rig commit, the items and the proof run. Read the preregistration, addendum 1 and this post together. Where they differ, this post governs the rerun.

Everything else stands as written: the arms, cells, tasks, locks, judge, persona, allowances, worst cases, stop rules, Garry's $500 cap and the $480 hard stop. No paid call under this post runs before it merges.

## 1. Why

U11's paid round ([results](../board/2026-10-30-geva-54-lanea-shakedown-results.md), #83) ran all 11 calls from rig 2c38729. Three cells ended INCOMPLETE, exit 3, at calibration, with no trial and no verdict:

- Row 3, /learn on Haiku 5.5, and rows 7c and 7, office-hours on Opus 5.5: CALIBRATION_SKILL. The skill-read detector missed reads made through a shell variable or a command substitution, though the tool output carried the arm's sentinel. #81 (GST-346, 86611e7) fixed it: a call whose output quotes the arm's own sentinel now proves the read.
- Rows 5c and 5, /learn on gpt-6.1-sol in Codex: CALIBRATION_SKILL, _SHELL and _CONFIG. The trial image lacked /usr/local/bin/codex-code-mode-host, so every Codex tool call failed closed. #84 (GST-360, b20db33) installs it.

Both faults were in the rig, and neither row produced a verdict, so a rerun changes no verdict. Rows 1, 2, 4 and 6 do not rerun, and their results in #83 stand.

## 2. What runs

Six calls, one at a time, in the table's order: 3c, 3, 5c, 5, 7c, 7. Each uses exactly the flags the preregistration gives that row in its Cells section and its table: base, skill, arms (before, before2, after, none), tasks, host, model, 3 trials plus the rerun stage, and `--calibrate` with the same flags for each `c` call. As in the first round, each row runs after its calibration call whatever that call's result, since the preregistration does not make a row depend on its `c` call.

## 3. Rig commit

**Was:** gstack-evals main at 464209c or a later main commit (addendum 1). The first round ran from 2c38729.

**Now:** gstack-evals main at the first admission of this rerun, which must contain 86611e7 (#81) and b20db33 (#84). If it lacks either, no call starts. All six calls run from that one commit, under addendum 1's one-commit rule: run docs/rig.md step 1 in full for the first item only, and for each later item confirm that HEAD is still that commit. The run notes and the results name it.

**What changed for a call since 2c38729.** At this post's base (main at 02adc34), these merges sit on top of 2c38729:

- #80 changes two tests' timeouts only.
- #81 changes how calibration proves a skill read: src/grade/transcript.ts, src/adapters/calibration.ts, the Claude Code and Codex drivers and src/skill-eval/cli/run-host.ts. The new proof needs the arm's sentinel, which run-host passes only to calibration sessions, so a trial's opened-skill count is computed as before.
- #84 installs every binary in the pinned `@openai/codex` 0.166.0 package's vendor bin folder, codex-code-mode-host included, into the trial image (docker/trial.Dockerfile). The tarball and its checksum are unchanged. The image's recipe hash changes, so the first round's rig proof does not cover it (section 4).
- #82 and #83 add wiki posts only.

policy/models.json is unchanged (sha256 a00180abac95), so the allowances, price rows and worst cases in the preregistration's table still hold. The task locks still hold too: neither the contract-line extractor (src/skill-eval/lock/contract-lines.ts) nor the question classifier (src/usersim/classifier.ts) changed, nor any tasks file or before folder. Rebuilt at 02adc34 with `gstack-evals skill-eval --lock`, on copies of the committed tasks files and locks (office-hours with `--ext`) and before folders exported with `git archive` (learn at 398618259d56, office-hours at cd4fc4be73d8), both locks came out byte-identical to the committed ones: learn/tasks.lock.json d567ce874501 and office-hours/tasks.lock.json 070c69f90b45. If the rerun commit changed any lock input, preflight's lock step would stop the call with LOCK_DRIFT before any spend.

## 4. Items, caps and admission

**Items.** The ledger binds each item to the first run that leases it (E_ITEM_BOUND), and the first round's items are closed. So each rerun call has a new item: `lanea-shakedown-r2-3c`, `lanea-shakedown-r2-3`, `lanea-shakedown-r2-5c`, `lanea-shakedown-r2-5`, `lanea-shakedown-r2-7c` and `lanea-shakedown-r2-7`. They go in the same approval record as the first round, ledger/u11-lanea-shakedown/ in the Captain drive, so U11's settled spend stays one sum.

**Caps.** Each item's cap, and its call's `--spend-cap`, is the smaller of the table's `--spend-cap` for that row and $480 minus U11's cumulative settled spend, read with `gstack-evals ledger status` just before its init and rounded down to the cent. Cumulative spend counts all 11 first-round items ($14.315538) and every earlier rerun item. The table's caps are $8 (3c), $45 (3), $56 (5c), $360 (5), $64 (7c) and, for row 7, $480 minus ledger spend so far. With $465.68 of headroom at the start, the first five items take the table's cap. Row 7 takes whatever headroom is left. The calls run one at a time, so settled spend plus the one open lease never passes $480.

**Approval and delegation.** Garry's words, "do it" (Captain drive approvals/2026-10-30-u11-lanea-shakedown-cap.md, taking the $500 cap and $480 stop), fund the rerun. The Captain approved the rerun within that cap (approvals/2026-10-31-u11-rerun-rows-3-5-7.md) and delegated each `ledger init --admission required` to the run thread, as in the first round. Each init quotes Garry's words verbatim with that source.

**Admission.** Addendum 1's step-by-step admission applies to every rerun item, with three changes:

1. A green rig.yml `push` or `workflow_dispatch` run at the rerun commit admits. The first round's proof, dispatch run 41134986895 at 2c38729, does not, because #84 changed the trial image. If none is listed for the rerun commit, dispatch one on main and wait for it.
2. `rig admit` names the new item, the same `--prereg` (the preregistration itself, as docs/rig.md does) and the record above:

   ```
   env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u OPENROUTER_API_KEY \
     bin/gstack-evals rig admit --item lanea-shakedown-r2-<row> --proof trial \
     --prereg wiki/plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md --ledger-record <Captain drive>/ledger/u11-lanea-shakedown/
   ```

3. Before each call, the run thread clears the install cache under `<state>/installs/`, as the first round did after its disk filled (results, deviation 2). GST-361's cleanup is not on main at this post's base. If the rerun commit carries it, this step is skipped. The state folder sits outside the checkout, so clearing it leaves the admitted tree unchanged.

Each call starts as a background operation within 24 hours of its admission, from the same checkout on the same machine.

## 5. Stop rules

The preregistration's and addendum 1's stop rules apply unchanged:

- Persona: stop if more than 10% of trial-1 replies are `source: fallback`.
- JUDGE_ALLOWANCE: read the first 10 judge calls; if any uses more than half of the allowance (100k of 200k input, or 20k of 40k output), stop before round 2 and report to the Captain.
- A cap stop at any point is an incomplete run, reported as one. No item takes a second lease after a cap stop.
- No call is retried to change a verdict. A rerun call that ends INCOMPLETE again is reported as INCOMPLETE and is not rerun under this post.
- E_RIG_UNPROVEN, LOCK_DRIFT or any other refusal before the lease stops that call before spend. The run thread fixes the cause where the fix leaves the tree unchanged, admits again and goes on, or reports to the Captain.

## 6. Projection

From the preregistration's projection, for these rows only:

| Row | Projected |
|---|---|
| 3c, 5c, 7c | part of the preregistration's $3 to $6 for all calibration; the first round's three cost $0.016, $0.26 and $0.57 |
| 3, /learn Haiku 5.5 | $0.3 ($0.6 with the rerun stage) |
| 5, /learn gpt-6.1-sol, Codex | $5 to $16, x2 with the rerun stage |
| 7, office-hours Opus 5.5 | $59 to $89 ($119 to $178 with the rerun stage); judge $2 to $5, x2 with the rerun stage; usersim under $1 |

That is about $67 to $112 with no rerun stage and about $225 at the high end, so U11's cumulative spend would end near $81 to $127, or about $240 at the high end, under the $480 stop. Row 7's sixth batch starts only if spend so far is at most its cap minus $339.02, as the preregistration says.

## 7. Results

Results go in a separate pull request. They report the three rows against this projection, link #83's results, name the rerun commit and its rig proof, and give office-hours its full per-task table and verdicts.

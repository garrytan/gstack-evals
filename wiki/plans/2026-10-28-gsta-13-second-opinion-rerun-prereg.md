---
id: 2026-10-28-gsta-13-second-opinion-rerun-prereg
kind: plan
title: "Quick look 3 follow-up preregistration: does the office-hours diet lose the second-opinion step on Opus 5.5?"
summary: Ten new trials per arm of the two second-opinion tasks, before and after the office-hours diet, on Opus 5.5 only, to settle a lead from Quick look 3. $35 cap.
author: GSTA-13
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links:
  - 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg
  - quick/lanea-quick/
  - https://github.com/garrytan/gstack-evals/pull/6
---

# Quick look 3 follow-up preregistration: the second-opinion step on Opus 5.5

Exploratory, like its parent. These numbers steer gstack research and support no public claim. Author GSTA-13 (crew of GSTA-2, model anthropic/claude-opus-5-5), 2026-10-28. Results go in the Quick look 3 results post and record the commit sha that adds this post.

## Why

Quick look 3 (parent: 2026-10-28-gsta-13-lanea-quick-office-hours-diet-prereg, runner at 81e6f32) ran 3 trials per task and arm. On Opus 5.5 its REGRESSION gate fired on two tasks:

| task | before | before2 | after |
|---|---|---|---|
| second-opinion-offer | 2/3 | 1/3 | 1/3 |
| second-opinion-accepted | 2/3 | 2/3 | 1/3 |

Both tasks walk into Phase 3.5, the second-opinion block the diet shortened and moved into `sections/second-opinion.md`. On second-opinion-offer the before2 panel dropped as far as after did, so that gate is consistent with noise. second-opinion-accepted is not settled.

This run takes a fresh, larger sample. The question was picked after seeing those numbers. So it gets its own preregistration, and the earlier 3 trials stay out of the primary test.

## Design

Everything is as in the parent unless stated here.

- Runner: `quick/lanea-quick/` at the commit that adds this post. That is the parent's runner at 66734b7, whose behavior matches 81e6f32, plus two environment overrides, `LANEA_CAP_USD` and `LANEA_LINE_ITEM`, so this run has its own cap and ledger. An invalid cap refuses to load.
- Images: the ones the parent's run used, `lanea-quick/office-hours-before` (sha256:f31991fde9db0dca53d63e3cb1a836cecc9a7eb9e014dfe652fe35de1cae0a3e) and `lanea-quick/office-hours-after` (sha256:cd00c033e9e672f835f4bdea785dad742d3a02ba2b2c51b7bd7ce59a078a9c2a).
- Tasks: second-opinion-offer, from gstack#3550 at `09fc5124d9b5` (tasks.json sha256 `472af4f02f08a658a5572f3ed993fe8aa600d1610642db2a48fba91e691ed656`), and second-opinion-accepted (`tasks/office-hours.extra.json` sha256 `e5ab6a90f70061d2755300fdb9b3d348a711fe588c9df53e5a18f0ecc0dcde9d`), with their sidecar replies.
- Arms: before (`cd4fc4be73d8`) and after (`a14c28aca783`). No none and no before2.
- Model: `claude-opus-5-5` only.
- Trials: 10 per task and arm, numbered 1 to 10, in a new output folder. That makes 40 sessions.
- Order: trial-major, with the parent's S1 plan and its per-task, per-trial arm shuffle. One session at a time.
- The scripted user, the limits and the grading are unchanged.

## Metrics

- Pass (primary): as in the parent. `check` passes, and every `must` matches the assistant text plus the AskUserQuestion questions and options.
- Pass on the final answer only (secondary): as in the parent.
- Offered (secondary): the session offered a second opinion. That means the scripted user's log has an ask or a prose reply in category `second_opinion`.
- Cost per session.

## Analysis

- Per task: k/n per arm with Wilson 95% intervals, and a one-sided Fisher exact test of after below before.
- Pooled over both tasks: after minus before is the mean of the two per-task differences in pass rate. Its 95% interval comes from a bootstrap over sessions, stratified by task and arm (10,000 resamples, seed 20261028).
- Reading:
  - Loss confirmed: the pooled interval lies wholly below 0.
  - No loss shown: the interval includes 0. The post reports the point estimate, and a null here is weak evidence, not proof of no loss.
  - Offered is read the same way.
- Power: if the true rates are 2/3 before and 1/3 after, the pooled difference is 33 pp with a standard error near 15 pp. This run would then confirm the loss about 60% of the time.
- Missing cells: an infra-error cell is rerun once, as in the parent. Fewer than 8 valid runs in any task and arm makes the result INCOMPLETE.
- The 13-trial pool (the parent's 3 plus these 10) is shown beside the result, marked as outside the preregistered decision.

## Cap and stop rule

_Internal planning record: these budget and cost figures are plans and caps, not findings._

- Cap: $35, line item `lanea-quick-rerun`, ledger `captain-gstack-evals/ledger/lanea-quick-rerun.jsonl`.
- The ledger's first row is the approval. It records Garry's gate-1 approval, his 2026-10-28 request to run it this week, and GSTA-2's allocation: the $20.44 left on lanea-quick plus $15 of the plan's $25 pilot reserve. The lanea-quick ledger gets a note row recording that its unspent $20.44 moved here.
- Each session reserves $7.25, the parent's Opus worst case, and settles with measured usage. With one session at a time, the cap stops the run only once settled spend passes $27.75. Expected spend is about $19, from the parent's mean of $0.46 per session on these cells.
- A reservation that would pass the cap stops the run: CAP_STOP, incomplete, never retried to change a result.

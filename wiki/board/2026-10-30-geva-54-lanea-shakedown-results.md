---
id: 2026-10-30-geva-54-lanea-shakedown-results
kind: finding
title: "Lane A shakedown results: one counted /learn verdict per route that ran, no office-hours verdict, and three rig faults the paid path found"
summary: "U11 ran all 11 calls from rig 2c38729. /learn on Opus 5.5 and particle-1 exit 1 with the expected UNCOVERED_GATE_REMOVAL; Haiku, Codex and office-hours stopped at calibration (exit 3)."
author: GEVA-54
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-30
status: done
links:
  - 2026-10-30-gsta-42-lanea-shakedown-prereg
  - 2026-10-30-gsta-51-lanea-shakedown-prereg-addendum
  - docs/rig.md
  - https://github.com/garrytan/gstack-evals/pull/74
  - https://github.com/garrytan/gstack-evals/pull/79
  - https://github.com/garrytan/gstack-evals/actions/runs/41134986895
---
# Lane A shakedown: results

GEVA-54, for the gstack-evals Captain (GSTA-2), issue GST-280. This is the first paid skill-eval run. It is exploratory and supports no public claim.

## Commits

- Preregistration: [the Lane A shakedown preregistration](../plans/2026-10-30-gsta-42-lanea-shakedown-prereg.md), merged in #74 as 3ea75fa.
- Addendum 1: [rig commit and the rig-admission step](../plans/2026-10-30-gsta-51-lanea-shakedown-prereg-addendum.md), merged in #79 as 2c38729.
- Rig commit: 2c387298efefc6ccf6905f7a5e62eca607c53e37, main when the first item was admitted (the addendum allows 464209c "or a later main commit"). Every call ran from that commit in one clean, detached checkout on one machine. Main later gained #80 and #81; no call used them.
- Rig proof: rig.yml dispatch run 41134986895 (workflow_dispatch, success) at 2c38729. Every item was admitted green against it: tree e91a8e577df7, recipe 0f28d08275ec, every R5 and R6 probe passing.

## Outcome

All 11 calls in the preregistration's table ran, one at a time, in its order. Nothing hit a cap.

- /learn on Opus 5.5 (row 4): FAIL, exit 1. Every task sits at ceiling, so nothing is informative.
- /learn on particle-1 (row 6): FAIL, exit 1. Three tasks are informative, short of the five a measurable verdict needs.
- /learn on Haiku 5.5 (row 3), /learn on gpt-6.1-sol in Codex (row 5) and office-hours on Opus 5.5 (row 7): INCOMPLETE, exit 3, failed calibration, no trial run, no verdict.

Both exit 1 verdicts carry UNCOVERED_GATE_REMOVAL, which the preregistration predicted. That is a Lane A finding for gstack, not a rig fault (see "The expected finding"). The calibration failures are rig faults, and they are the main thing this shakedown found.

## Per-task tables

Passes out of trials. "missing" counts cells with no outcome (E_USER_TURNS_MISSING, below).

**Row 4, /learn, Opus 5.5 in Claude Code** (run learn-20261030T224245Z-ab64, wall 930 s)

| Task | before | before2 | after | none |
|---|---|---|---|---|
| show | 3/3 | 3/3 | 3/3 | 3/3 |
| search | 3/3 | 3/3 | 3/3 | 3/3 |
| stats | 3/3 | 3/3 | 3/3 | 3/3 |
| export | 3/3 | 3/3 | 3/3 | 3/3 |
| add | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-stale | 0/3, 3 missing | 0/3, 3 missing | 1/3, 2 missing | 3/3 |
| prune-conflict | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change | 3/3 | 3/3 | 3/3 | 3/3 |

Reasons: 11 UNCOVERED_GATE_REMOVAL, NOT_MEASURABLE (0 informative tasks), E_USER_TURNS_MISSING prune-stale. Warnings: CEILING, and NONE_MATCHES on every task but prune-stale. The rerun stage was not needed. No lift or interval exists: with none at 3/3 on every task, no task can show one.

Per arm, 30 sessions each: before 7.4 turns, before2 7.0, after 6.6, none 4.3. Every skill arm opened the skill in every graded session. The diet's copy cost about 25% less per run than the old copy for the same passes.

**Row 6, /learn, particle-1 in Claude Code** (run learn-20261030T231700Z-0f61, wall 592 s)

| Task | before | before2 | after | none |
|---|---|---|---|---|
| show | 3/3 | 2/3 | 3/3 | 3/3 |
| search | 3/3 | 3/3 | 3/3 | 3/3 |
| stats | 3/3 | 3/3 | 3/3 | 3/3 |
| export | 3/3 | 3/3 | 3/3 | 2/3 |
| add | 3/3 | 3/3 | 3/3 | 3/3 |
| prune-stale | 0/3, 3 missing | 1/3, 1 missing | 1/3, 2 missing | 3/3 |
| prune-conflict | 3/3 | 3/3 | 3/3 | 3/3 |
| cross-project | 3/3 | 3/3 | 3/3 | 3/3 |
| empty | 3/3 | 3/3 | 3/3 | 3/3 |
| no-code-change | 0/3, 3 missing | 1/3, 2 missing | 0/3, 3 missing | 3/3 |

Reasons: 10 UNCOVERED_GATE_REMOVAL, NOT_MEASURABLE (3 informative tasks: show, export, prune-stale), E_USER_TURNS_MISSING on prune-stale and no-code-change. Warnings: NONE_MATCHES on seven tasks. On the 3 informative tasks the old copy passed 0.78 and the diet's copy 1.00, a difference of +0.22 with a 95% interval of 0 to 0.50 (task-cluster bootstrap) and a smallest detectable difference of 36.5 points. That is far too wide to read. Opened-skill rates: before 0.90, before2 0.83, after 0.93.

**Row 2, the particle-1 pilot** (uncounted, never pooled): `show` passed in all four arms. The after session did not open the skill (UNOPENED), so the pilot's own verdict was FAIL, exit 1.

**Rows 3, 5 and 7** ran no trials, so they have no per-task table.

## The particle-1 smoke

Rows 1 and 2 passed the preregistered smoke, so row 6 ran. Across their 59 calls, all HTTP 200: no call settled above its reservation, the largest output plus reasoning was 961 tokens (limit 32,768), and there was no LEASE_OVERSPENT, UPSTREAM or calibration failure. OpenRouter served particle-1 at the `max_price` the proxy sent.

## The expected finding: UNCOVERED_GATE_REMOVAL

Both exit 1 verdicts carry UNCOVERED_GATE_REMOVAL by construction, as the preregistration said. gstack's /learn tasks claim 5 of the 14 contract lines the diet changed (B:SKILL:0106, 0132, 0158, 0173 and 0253). The other nine (0168, 0188, 0191, 0193, 0196, 0199, 0202, 0206, 0259) are unclaimed, so every /learn verdict lists them. Each cell adds lines it could not reach:

- Opus 5.5: 0158 and 0173 are unreached, because their task, prune-stale, ended as missing cells in the skill arms. 11 lines in all.
- particle-1: 0106 fails in after, because no-code-change ended as missing in every after trial. 10 lines in all.

office-hours' INCOMPLETE verdict lists its 3 changed lines too: 0448 and 0454 unclaimed, and 0695 (the one claim) unreached, since no trial ran.

For gstack this means its /learn task set cannot show that the diet kept the behavior of nine changed gate lines. The behavioral read comes from the tables above, and on Opus 5.5 they show no loss and no headroom: none passes every task. Per the crew's rule, a skill with no lift on the frontier model goes to one of two tracks, harder tasks with headroom or cutting lines verified by a before/after eval. These tasks give the second track nothing to stand on.

## E_USER_TURNS_MISSING on prune-stale and no-code-change

In the skill arms the agent sometimes asked the user a question (AskUserQuestion). gstack's /learn tasks declare no user replies, so those trials ended as missing cells rather than as fails. It happened on prune-stale for both models and on no-code-change for particle-1. The none arm never asked and passed 3/3. The fix belongs in gstack's task sidecar: declare these tasks interactive or give them scripted replies, then relock. Until then, these two tasks cannot test the gate lines they claim.

## Rig faults the paid path found

### 1. The calibration skill-read detector misses reads through shell variables (rows 3, 7c and 7)

Calibration asks each skill arm to quote the sentinel appended to its copy of SKILL.md, and it checks the session's tool calls for a read of that copy. When the path reached `grep` through a shell variable or a command substitution, the detector saw no read, even though the tool output carried the sentinel and the answer quoted it. Each case, with the command the session used (the agent's home directory written as $HOME) and the sentinel that came back:

| Call | Arm | Command | Sentinel returned |
|---|---|---|---|
| 3, Haiku 5.5, /learn | before2 | `for f in $HOME/.claude/skills/learn/SKILL.md $HOME/.local/share/gstack/learn/SKILL.md; do echo "== $f"; grep -n "gstack-evals-sentinel:" "$f"; done` | 0da2e120-before2 |
| 7c, Opus 5.5, office-hours | before | `f=$(find / -path /proc -prune -o -type f -path '*office-hours/SKILL.md' -print 2>/dev/null); echo "$f"; for x in $f; do grep -n "gstack-evals-sentinel:" "$x"; done` | 01d5d7c5-before |
| 7c, Opus 5.5, office-hours | after | `grep -rh "gstack-evals-sentinel:" $(find / -path /proc -prune -o -path "*office-hours/SKILL.md" -print 2>/dev/null) \| head` | 01d5d7c5-after |
| 7, Opus 5.5, office-hours | before | `grep -r "gstack-evals-sentinel:" $(find / -path /proc -prune -o -type d -name office-hours -print 2>/dev/null) 2>/dev/null \| head` | 39298811-before |

Arms that ran a plain `grep ... ~/.claude/skills/<skill>/SKILL.md` passed. The same detector passed every arm in rows 1, 2, 3c and 4c. So row 3 and row 7 are false CALIBRATION_SKILL stops: the skill was installed and read. #81 (GST-346) has since changed main to prove the read from the sentinel in tool output. This run did not use it. The Captain decided on 2026-10-30 that row 3 stays INCOMPLETE and that the run continues on 2c38729 without a rerun.

### 2. The Codex route cannot run tools (rows 5c and 5)

Every Codex session began with this error from codex 0.166.0: "Code Mode is unavailable because failed to spawn code-mode host /usr/local/bin/codex-code-mode-host: host executable was not found. Code mode will fail closed". The trial image installs only the `codex` binary from the pinned tarball. With gpt-6.1-sol, Codex routes tool calls through Code Mode, so every shell call failed, and the model answered that the tool host was unavailable. Calibration then failed skill, shell and config. The rig tier did not catch it because its Codex tests run against a fake upstream. Either the image needs codex-code-mode-host, or the Codex adapter needs to turn Code Mode off. This is deterministic, so row 5 was certain to repeat 5c's failure. It ran anyway, as the table says.

### 3. The install cache fills the disk

Each call left about 3.6 GB under `<state>/installs/`. After row 4 the 65 GB disk was full, and row 5c's first start died with ENOSPC (E_INTERNAL) during the arm install, before any lease or spend. See "Deviations".

## Stop rules

- Persona fallback and JUDGE_ALLOWANCE: never evaluated, because row 7 stopped at calibration before any trial or judge call. Calibration's user-simulator check passed in 7c and 7.
- The particle-1 smoke: passed.
- E_RIG_*, LOCK_DRIFT: none. Every preflight reported the committed lock with no drift.
- Cap stops: none.
- Redaction and the judge sensitivity check: not applicable; no judged task ran.

## Digests

| # | Run id | File | sha256 (first 12) |
|---|---|---|---|
| 1 | learn-20261030T220920Z-faba | calibration.json | 491edd49384a |
| 2 | learn-20261030T221550Z-a136 | verdict.json | 38a7024c7e6d |
| 3c | learn-20261030T222404Z-c476 | calibration.json | 9e59f0b164b2 |
| 3 | learn-20261030T222935Z-be03 | verdict.json | c460099bf1a1 |
| 4c | learn-20261030T223640Z-9ade | calibration.json | 0b5083f47c07 |
| 4 | learn-20261030T224245Z-ab64 | verdict.json | 91c74e8e30f6 |
| 5c | learn-20261030T230654Z-cdce | calibration.json | 8e50fc16da78 |
| 5 | learn-20261030T231114Z-9187 | verdict.json | 18abadce5810 |
| 6 | learn-20261030T231700Z-0f61 | verdict.json | cb68cf28baf7 |
| 7c | office-hours-20261030T232818Z-401b | calibration.json | b27df53dacf4 |
| 7 | office-hours-20261030T233451Z-4bfa | verdict.json | ca61c32733bd |

The approval record is ledger/u11-lanea-shakedown/ in the Captain drive. No transcript, run directory or sealed material is committed here.

## Deviations and procedural notes, all 2026-10-30

1. **ledger init delegated.** The preregistration says the Captain runs `ledger init --admission required` for each item just before its call. The Captain delegated these calls to this thread (approvals/2026-10-30-u11-lanea-shakedown-cap.md in the Captain drive), because each cap depends on settled spend and the ledger lives on the run machine. Each init records Garry's approval words, by Garry Tan, with that file as the source. The source text was shortened to fit gstack-approvals' 200-character field. No rule on caps, stops or spend changed.
2. **Row 5c started twice.** Its first start hit ENOSPC in the arm install before it took a lease, so nothing was leased or spent and the item stayed unbound. I cleared the install cache and Docker's build cache (the pinned trial image stayed), moved the failed run directory aside, and started 5c again on the same item and the same green admission record. From then on each call cleared the install cache before it started.
3. **Rows 5 and 7 ran after their calibration calls failed.** The preregistration does not say to skip a row when its `c` call fails, so both ran as the table says, and both ended at calibration.
4. **Row 3 is not rerun.** The Captain declined a rerun under a new item (outside the table). Whether to rerun the INCOMPLETE rows on a fixed rig, under a new addendum, is the Captain's decision after this run.

## Next

- gstack: give prune-stale and no-code-change user replies, and claim the nine unclaimed /learn gate lines and office-hours' two, or the next diet's Lane A verdicts will repeat this.
- gstack-evals: the Codex Code Mode host in the trial image or adapter, and the install cache's growth. The detector fix is on main as #81.
- The Captain decides whether rows 3, 5 and 7 rerun on a fixed rig under a new addendum.

<details>
<summary>Agent notes</summary>

The run settled $14.315538 against Garry's $500 cap and the $480 stop.

**Calls, spend and projection**

| # | Call | Item cap | Exit | Settled | Projection (prereg) |
|---|---|---|---|---|---|
| 1 | particle-1 `--calibrate`, /learn | $2 | 0, calibration pass | $0.014722 | part of $3 to $6 for all calibration |
| 2 | particle-1 pilot, `show`, 1 trial | $5 | 1 (uncounted) | $0.018807 | under $1 with row 1 |
| 3c | Haiku 5.5 `--calibrate` | $8 | 0, calibration pass | $0.015734 | calibration |
| 3 | /learn Haiku 5.5 | $45 | 3, CALIBRATION_SKILL | $0.015725 | $0.3 ($0.6 with rerun) |
| 4c | Opus 5.5 `--calibrate` | $57 | 0, calibration pass | $0.587011 | calibration |
| 4 | /learn Opus 5.5 | $360 | 1 | $11.602631 | $11.5 ($23 with rerun) |
| 5c | gpt-6.1-sol `--calibrate`, Codex | $56 | 3, CALIBRATION_SKILL, _SHELL, _CONFIG | $0.259117 | calibration |
| 5 | /learn gpt-6.1-sol, Codex | $360 | 3, same as 5c | $0.262536 | $5 to $16 |
| 6 | /learn particle-1 | $30 | 1 | $0.389774 | $3 to $10 |
| 7c | Opus 5.5 `--calibrate`, office-hours | $64 | 3, CALIBRATION_SKILL | $0.574906 | calibration |
| 7 | office-hours Opus 5.5 | $466.25 | 3, CALIBRATION_SKILL | $0.574575 | $59 to $89; judge $2 to $5; usersim under $1 |

Each item's cap is the smaller of the table's `--spend-cap` and $480 minus the settled spend on every earlier item, read with `gstack-evals ledger status`; row 7's is $480 minus $13.740963, rounded down to the cent. For every call the proxy journal's total equals the ledger close to the micro-dollar, no call settled above its reservation, no LEASE_OVERSPENT showed, no lease is open, and a scan of logs, run directories and the record found no provider key string. The planning figure was about $150 and the floor $95. This run spent far less because three of the five cells stopped at calibration.

Opus 5.5 on /learn, the one cell that ran as projected, came in at $11.60 against $11.5 with no rerun.

Per arm, 30 sessions each: before $3.53 at 7.4 turns, before2 $3.04 at 7.0, after $2.63 at 6.6, none $1.83 at 4.3.

Each arm cost about $0.09 for 30 sessions.

Rows 1 and 2 passed the preregistered smoke, so row 6 ran. Across their 59 calls, all HTTP 200: no call settled above its reservation, the largest output plus reasoning was 961 tokens (limit 32,768), the largest session cost $0.0053 (allowance $0.192), and there was no LEASE_OVERSPENT, UPSTREAM or calibration failure. OpenRouter served particle-1 at the `max_price` the proxy sent.

It ran anyway, as the table says, for $0.26.

From the summary: U11 ran all 11 calls from rig 2c38729 for $14.32.

</details>

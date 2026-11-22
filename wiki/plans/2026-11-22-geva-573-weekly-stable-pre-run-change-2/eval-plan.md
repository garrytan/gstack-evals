# gstack weekly benchmark: the release candidate against stable and no gstack (gstack's eval-plan form)

frozen: 2026-11-22

This file restates the weekly stable number's frozen plan in the form gstack's `gstack-eval-plan` reads, so that each week's results table passes `gstack-eval-plan results --check` before its record publishes. The plan itself is the preregistration (wiki/plans/2026-11-22-geva-573-weekly-stable-prereg) with its pre-run changes 1 and 2; where this file and those disagree, they win.

## Bars
lesson: whether this week's gstack release candidate fixes as many real Python bugs as the current stable release, on Claude Opus 5.5 in Claude Code.
- passes, candidate minus stable: a 95% interval wholly below 0 is a HOLD; wholly above 0 is a GAIN; otherwise NO CHANGE.
- passes, candidate minus none: descriptive; a 95% interval wholly below 0 is a FLAG.
- cost ratio, candidate over stable: a 95% interval wholly above 1 with a point estimate of 1.10 or more is a FLAG.

## Decisions
- if the candidate's interval lies wholly below stable's: gstack's release cut holds regular, forced and blocker cuts that contain the measured commit and whose stable doesn't, and GStack Minder gets the flipped tasks, transcripts and commit range.
- if the candidate's interval lies wholly above stable's: the record reports a GAIN and nothing is held.
- if neither: the release ships as normal and the record reports the interval and the realized MDD.

## Arms
- `claude-opus-5-5#candidate`: gstack at the newest first-parent commit of main that gstack's release cut reads as gated green at Saturday 06:00 UTC, installed by its own ./setup (full loadout, hooks on as shipped); three sessions a task; planning rate $0.48 a session.
- `claude-opus-5-5#stable`: gstack at refs/heads/stable, peeled to its v-tag, installed the same way; three sessions a task; $0.48 a session.
- `claude-opus-5-5#no-gstack`: B1's none tar, no gstack; one session a task; $0.31 a session.

## Comparison
stack: loaded

## No-gstack arm
- arms: `claude-opus-5-5#no-gstack`
- inputs: the same 130 SWE-rebench tasks, rig, verifier and allowance as the gstack arms.
- prompt: B1's plain prompt and closing line around the task's instruction only; no SKILL.md, preamble, hooks or installed skills.
- panel: the same Harbor verifier on the same tasks, one session a task, no judge.
- report: its row sits beside the candidate and stable rows in the week's results table.
- masking: the session runs in a container on a Ubicloud VM that sees no Capy drive.
- install: no gstack at ~/.local/share/gstack, ~/.claude/skills or ~/.gstack (B1's none tar, sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e).
- audit: the per-session read audit; a none session that read a gstack skill file is contaminated, and the pilot fails the arm.

## Scoring
judge: none
paired: yes
interval: 95%
mdd: 5.5 points at 15% of pairs disagreeing with independent sessions (S390)

## Pilot
- share: 3% of each arm's weekly budget (the one-time pilot, $14 in all).
- counted: no
- ran: gstack arms: Claude Code's init record lists gstack's skills and gstack's routing hook logged an event in each pilot session, on the arm's manifest tar; none: no gstack in the listing, no hook log and no audit hit.
- supply: each of the three pilot tasks builds and grades on the rig in every arm.
- units: three SWE-rebench calibration tasks outside the 130 (psd-tools__psd-tools-593, BerriAI__litellm-16526, schemathesis__schemathesis-3195).
- seed: the week's seed, the first 4 bytes of SHA-256 of the UTC start date, big-endian, in L1's seeded order.

## Cost
- paid: $610
- meter: $20
- caps: $535 model and $75 Ubicloud a week on the week's three ledger items, and $35 for the weekly thread's own meter; $416 model and $57 Ubicloud expected.
- ledger: the week's ledger items ws-<YYYY-MM-DD>-1, -2 and -3 ($204, $203 and $203) on the Lane B ledger, in the crew's private run store.

## Interim look
- at: 50% of the units (the first 65 tasks in run order)
- looks: 1
- bounds: O'Brien-Fleming, stop for effect at |z| >= 2.797 at the look, final |z| >= 1.977
- futility: none; a look that does not stop runs to the end.

## Decoys
None: each task's own hidden tests score the diff, so no decoy input applies. A wrong arm tar in a session fails the pilot and the weekly smoke.

## Stop rules
- a ledger item's cap stop makes the week INCOMPLETE; it never reruns.
- a gstack arm whose own ./setup fails makes the week INCOMPLETE.
- more than 13 tasks dropped by the contamination check, or more than 39 of a gstack arm's 390 sessions (13 of none's 130) ungraded, makes the week INCOMPLETE.
- the interim look's stop bound.

## Held-out exposure
| set | prior exposure (which runs, which models) | reservation (what this run may read) |
|---|---|---|
| SWE-rebench swerebench-r3a4, the 130 tasks of the preregistration's pool | the harness mechanics eval graded each on this rig with Opus 5.5; no gstack fixture names them (60 that did are excluded) | each week's sessions read only their own task's container; built gstack trees are searched for every task id before any session |

Answers on the task machine: the harness mechanics eval's task setup and the snapshot strip run before every session, as B1's rig does. Grader: Harbor's verifier runs the task's hidden tests in its own container.

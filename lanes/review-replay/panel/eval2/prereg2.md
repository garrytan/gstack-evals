# GSTA-131 attribution eval (preregistration 2)

Eval 1 (prereg.md) missed B1: the light-tier single-shot replays caught neither known defect on the new policy path (c1-statemachines-range 0/3, c2-fixcheck 0/3). Eval 1 had no control, so it cannot say whether the miss comes from the new path (a fix-check instead of a full range pass; one specialist instead of the army), from the light effort, or from the single-shot replay being weaker than the agentic reviewers that caught these defects in history. This eval attributes it. It changes no bar of eval 1 and reruns none of its items; eval 1's verdict stands.

## Bars

- A1 full-pass control: the legacy pass-2 reviewer set replayed single-shot on the same range at medium (case 2: testing, security, maintainability, state-machines, red-team; case 1: testing, maintainability, red-team, plus eval 1's state-machines trials) catches the known defect in at least 2 of 3 trials of at least one reviewer. A pass means the replay shape can see the defect and the new path's miss is the path; a miss means the single-shot proxy cannot see it and eval 1 does not measure policy recall.
- A2 effort control: c2-fixcheck and c1-statemachines-range at effort high catch in at least 2 of 3. A pass with A1 failing at medium means the light tier is what loses recall.
- Scoring for both: a finding names the known file and the known defect (case 1: test/helpers/ship-hook-actor.ts refusing an honest request after a negation earlier in the sentence, or the contraction alternative never matching; case 2: lib/ship-queue-train-verify.ts reading an unreadable or failed GitHub state as not merged). Severity is not scored.

## Arms

- claude-opus-5-5 effort=medium: the eight range-specialist items, 3 trials each.
- claude-opus-5-5 effort=high: c2-fixcheck and c1-statemachines-range (eval 1's prompts, unchanged bytes), 3 trials each.

## Decoys

Eval 1's decoys stand (d1, d2 passed 3/3 each); none added.

## Stop rules

- Spend cap 6 USD. No retries; an API error is INFRA and the trial counts as missing.
- Prompts frozen before the first call (frozen2.sha256).

## Held-out exposure

None: public merged PRs whose reviews already ran.

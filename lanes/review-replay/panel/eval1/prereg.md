# GSTA-131 effort-tier and fix-check outcome eval (preregistration)

Frozen before any priced call. Purpose: measure (1) whether a light reasoning effort cuts a review dispatch's tokens and (2) whether the new review path (fix-check, range specialist at light effort) still catches the real defects the old path caught, so the token saving is not bought with recall.

## Bars

- B1 recall, policy path: c1-statemachines-range (case 1, #3516 pass-2 recall regression, the full range pass the new policy runs after a fixed blocker) and c2-fixcheck (case 2, #3518 fail-open introduced by pass 1's fix, the fix-check the new policy runs after below-floor fixes) each flag their known defect (right file, the defect named) in at least 2 of 3 trials at effort medium. Direction: higher is better. A miss on either means the policy loses recall: the plan returns to the owner's gate before shipping.
- B2 decoys: on the fixed versions (d1, d2) the reviewer does not claim the same defect is still present in at least 2 of 3 trials. A miss means the scorer or reviewer cannot tell fixed from broken, and B1 proves nothing.
- B3 tokens: median output tokens of the specialist items (t-testing-code, t-maint-code) at effort medium are at most 70% of the same items at effort high. Direction: lower is better. A miss means effort tiers do not save what the plan assumed; the per-run estimate is recomputed with the measured numbers either way.
- B4 per-run estimate: with B3's measured output tokens fed to scripts/review-dispatch-compare.ts, the median new/legacy token ratio across both fixtures and five scenarios is at most 0.55. A miss is reported to the owner as measured, not hidden; it does not block shipping by itself.
- Diagnostic only (no bar): c1-fixcheck, a stricter replay of case 1 through a fix-check, which the policy would not use there.

## Arms

- claude-opus-5-5, output_config.effort=high (the lane's current level for every reviewer; legacy): token items only, 3 trials each.
- claude-opus-5-5, output_config.effort=medium (the light tier): every item, 3 trials each.
Per item cost about 0.15 to 0.35 USD (lib/pricing.ts: 4.00 in, 20.00 out per Mtok).

## Decoys

Two: d1-fixcheck-fixed (the fix-check of 27a1b1fd, the commit that repaired case 1) and d2-fixcheck-fixed (ada2acce, the repair of case 2). Made from the real repair commits; a decoy pass proves the reviewer reads the code rather than echoing a likely defect.

## Stop rules

- Spend cap 12 USD for this eval (part of the lane's 40 USD paid cap). A call the cap would exceed is not made.
- No retries to change a verdict; an API error is recorded as INFRA and that trial counts as missing, never as a pass.
- Prompts are frozen in ~/.capy/work/gsta131/eval/prompts at their recorded bytes before the first call.

## Held-out exposure

None. Every input is a public merged PR whose reviews already ran; no held-out set is touched.

## Blinding

Prompts are pre-landing review prompts over real diffs from the gstack repository; the instructions carry no eval words, the reviewer is not told which defect exists, and scoring reads the reviewer's JSON findings, not its self-report.

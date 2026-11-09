# Section 13.5 clauses and the tests that drive them

Each clause of the preregistration's section 13.5 (2026-11-09-geva-419) is one check in dryrun.ts, numbered in the order the prereg lists them. `bun lanes/autoplan-audit/cli.ts dryrun` prints one PASS or FAIL line per clause, and tests/autoplan-audit/dryrun.test.ts asserts each one.

| Clause | What it drives | Test |
|---|---|---|
| 1 | each gstack schema variant (answered_role and owner_mode, amendments) | tests/autoplan-audit/dryrun.test.ts, "clause 1" (dryrun.ts check 1) |
| 2 | one proposal carried through three gates | tests/autoplan-audit/dryrun.test.ts, "clause 2" (dryrun.ts check 2) |
| 3 | a settled ordering amendment and a withdrawn one | tests/autoplan-audit/dryrun.test.ts, "clause 3" (dryrun.ts check 3) |
| 4 | the accepted-change rule on each option family | tests/autoplan-audit/dryrun.test.ts, "clause 4" (dryrun.ts check 4) |
| 5 | front matter present and absent | tests/autoplan-audit/dryrun.test.ts, "clause 5" (dryrun.ts check 5) |
| 6 | the id path | tests/autoplan-audit/dryrun.test.ts, "clause 6" (dryrun.ts check 6) |
| 7 | the code path and containment path on both sides of 0.10 and 0.50 | tests/autoplan-audit/dryrun.test.ts, "clause 7" (dryrun.ts check 7) |
| 8 | a post first added before the run | tests/autoplan-audit/dryrun.test.ts, "clause 8" (dryrun.ts check 8) |
| 9 | an eligible plan with no built text (not MET) | tests/autoplan-audit/dryrun.test.ts, "clause 9" (dryrun.ts check 9) |
| 10 | the overlap score at 0.59 and 0.60 | tests/autoplan-audit/dryrun.test.ts, "clause 10" (dryrun.ts check 10) |
| 11 | the T fallback at 3 and 4 words | tests/autoplan-audit/dryrun.test.ts, "clause 11" (dryrun.ts check 11) |
| 12 | the versioned matrix against the pinned table | tests/autoplan-audit/dryrun.test.ts, "clause 12" (dryrun.ts check 12) |
| 13 | lenient and strict detectors on present, heading-only, one-line, N/A-with-reason and absent outputs | tests/autoplan-audit/dryrun.test.ts, "clause 13" (dryrun.ts check 13) |
| 14 | 6 and 7 design scores, 7 and 8 DX scores | tests/autoplan-audit/dryrun.test.ts, "clause 14" (dryrun.ts check 14) |
| 15 | a repeated dimension name | tests/autoplan-audit/dryrun.test.ts, "clause 15" (dryrun.ts check 15) |
| 16 | a test plan never named (absent) and lost files (missing) | tests/autoplan-audit/dryrun.test.ts, "clause 16" (dryrun.ts check 16) |
| 17 | X-1 with a lens delivered but no labelled part | tests/autoplan-audit/dryrun.test.ts, "clause 17" (dryrun.ts check 17) |
| 18 | a question asked outside the record (unobservable) | tests/autoplan-audit/dryrun.test.ts, "clause 18" (dryrun.ts check 18) |
| 19 | X-3 with a same-family outside voice | tests/autoplan-audit/dryrun.test.ts, "clause 19" (dryrun.ts check 19) |
| 20 | an unavailable voice marked confirmed | tests/autoplan-audit/dryrun.test.ts, "clause 20" (dryrun.ts check 20) |
| 21 | a lean record with a completed outside voice | tests/autoplan-audit/dryrun.test.ts, "clause 21" (dryrun.ts check 21) |
| 22 | GATE-1: a complete run and no answer (violation, before exclusions) | tests/autoplan-audit/dryrun.test.ts, "clause 22" (dryrun.ts check 22) |
| 23 | a complete run answered only by a bound approvals record | tests/autoplan-audit/dryrun.test.ts, "clause 23" (dryrun.ts check 23) |
| 24 | lean records with no user-challenge item (UNCLEAR) | tests/autoplan-audit/dryrun.test.ts, "clause 24" (dryrun.ts check 24) |
| 25 | owner words | tests/autoplan-audit/dryrun.test.ts, "clause 25" (dryrun.ts check 25) |
| 26 | a bound approvals record | tests/autoplan-audit/dryrun.test.ts, "clause 26" (dryrun.ts check 26) |
| 27 | a delegation | tests/autoplan-audit/dryrun.test.ts, "clause 27" (dryrun.ts check 27) |
| 28 | two gates in one thread within 24 hours | tests/autoplan-audit/dryrun.test.ts, "clause 28" (dryrun.ts check 28) |
| 29 | a later approval | tests/autoplan-audit/dryrun.test.ts, "clause 29" (dryrun.ts check 29) |
| 30 | an unchanged carry (keeps provenance) | tests/autoplan-audit/dryrun.test.ts, "clause 30" (dryrun.ts check 30) |
| 31 | a changed proposal with no answer | tests/autoplan-audit/dryrun.test.ts, "clause 31" (dryrun.ts check 31) |
| 32 | the outbound check refusing each token class | tests/autoplan-audit/dryrun.test.ts, "clause 32" (dryrun.ts check 32) |
| 33 | an owner-reply 6-gram | tests/autoplan-audit/dryrun.test.ts, "clause 33" (dryrun.ts check 33) |
| 34 | a secret pattern | tests/autoplan-audit/dryrun.test.ts, "clause 34" (dryrun.ts check 34) |
| 35 | an email | tests/autoplan-audit/dryrun.test.ts, "clause 35" (dryrun.ts check 35) |
| 36 | a held-out (withheld) id | tests/autoplan-audit/dryrun.test.ts, "clause 36" (dryrun.ts check 36) |
| 37 | a deleted private sentence never enters a packet | tests/autoplan-audit/dryrun.test.ts, "clause 37" (dryrun.ts check 37) |
| 38 | every Astra, Opus and Argon label triple and every missing-vote case | tests/autoplan-audit/dryrun.test.ts, "clause 38" (dryrun.ts check 38) |
| 39 | a quote not in the built text | tests/autoplan-audit/dryrun.test.ts, "clause 39" (dryrun.ts check 39) |
| 40 | a quote that matches only after normalization | tests/autoplan-audit/dryrun.test.ts, "clause 40" (dryrun.ts check 40) |
| 41 | a quote cut by an ellipsis | tests/autoplan-audit/dryrun.test.ts, "clause 41" (dryrun.ts check 41) |
| 42 | a change stated only in a Review record | tests/autoplan-audit/dryrun.test.ts, "clause 42" (dryrun.ts check 42) |
| 43 | a built text full of git shas and sha256 digests | tests/autoplan-audit/dryrun.test.ts, "clause 43" (dryrun.ts check 43) |
| 44 | a lower case 48-character slug | tests/autoplan-audit/dryrun.test.ts, "clause 44" (dryrun.ts check 44) |
| 45 | a mixed-case 40-character key (refused, the run stops) | tests/autoplan-audit/dryrun.test.ts, "clause 45" (dryrun.ts check 45) |
| 46 | the gold pool at 39 and 40 agreed per class | tests/autoplan-audit/dryrun.test.ts, "clause 46" (dryrun.ts check 46) |
| 47 | one class and both classes short | tests/autoplan-audit/dryrun.test.ts, "clause 47" (dryrun.ts check 47) |
| 48 | an exhausted ablation pool | tests/autoplan-audit/dryrun.test.ts, "clause 48" (dryrun.ts check 48) |
| 49 | kappa at 0.59 and 0.60 for each judge, Argon included | tests/autoplan-audit/dryrun.test.ts, "clause 49" (dryrun.ts check 49) |
| 50 | a truncated reply in the smoke | tests/autoplan-audit/dryrun.test.ts, "clause 50" (dryrun.ts check 50) |
| 51 | the missing-rate rule at 20% and just over | tests/autoplan-audit/dryrun.test.ts, "clause 51" (dryrun.ts check 51) |
| 52 | every verdict at both sides of its bar | tests/autoplan-audit/dryrun.test.ts, "clause 52" (dryrun.ts check 52) |
| 53 | NO READ beating NOT MET BY DESIGN | tests/autoplan-audit/dryrun.test.ts, "clause 53" (dryrun.ts check 53) |
| 54 | GATE-2's bounds straddling the bar and both clearing it | tests/autoplan-audit/dryrun.test.ts, "clause 54" (dryrun.ts check 54) |
| 55 | crashes after send, after settlement, before and after a cache write (real ledger) | tests/autoplan-audit/dryrun.test.ts, "clause 55" (dryrun.ts check 55) |
| 56 | one ledger lease opened and settled with a refused call at the admission edge (E_ALLOWANCE) | tests/autoplan-audit/dryrun.test.ts, "clause 56" (dryrun.ts check 56) |
| extra 57 | told custody on a fixture sealed with a throwaway age identity | tests/autoplan-audit/dryrun.test.ts, "clause 57" |
| extra 58 | power.py part A on fixed inputs | tests/autoplan-audit/dryrun.test.ts, "clause 58"; tests/autoplan-audit/stats.test.ts |

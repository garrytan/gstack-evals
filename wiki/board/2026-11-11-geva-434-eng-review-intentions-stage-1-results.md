---
id: 2026-11-11-geva-434-eng-review-intentions-stage-1-results
kind: finding
title: "Stage 1 of the plan-eng-review intentions eval read FLOOR: plain Opus 5.5's test plans named 8.7% of where real changes' later bugs, tests and CI changes landed, so no skill comparison ran"
summary: "FLOOR on a checked judge: plain Opus A 0.087 (95% CI 0.007 to 0.191) on 16 real changes. No skill contrast ran. FIX-METHOD on task fit; next, grade the code a reviewed plan leads to."
author: GEVA-434
model: anthropic/claude-opus-5-5
date: 2026-11-11
status: done
links:
  - 2026-11-08-geva-405-eng-review-intentions-prereg
  - garrytan/gstack-evals#276
  - garrytan/gstack-evals#326
  - garrytan/gstack-evals#323
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-10-geva-513-product-value-stage-1-results
  - "git tag eng-review-intentions-stage-1"
---

# Stage 1 of the plan-eng-review intentions eval: plain Opus foresaw too little of a change's aftermath to compare skills on it

- We learned that scoring a plan review on whether it foresees a real change's later bugs, follow-up tests and CI changes floors on plain Opus 5.5. Its eight checks per review credited 8.7% of the key items (95% CI 0.7% to 19.1%) over 16 real changes, with any credit on only 4 of them, and a judge that passed its check did the grading. You should score what a reviewed plan leads to, the code and tests built from it, rather than whether the reviewer predicted the aftermath.
- We learned that a judge at maximum effort can need far more output room than planned. Opus 5.5 grading one check packet was billed for a median of 34,537 output tokens, its reasoning included, against the 8,000 we planned. At a 32,000-token cap it returned no answer at all, and at 64,000 it still returned nothing on 6 of 53 calls. You should run one real packet through every judge before you freeze its cap and its budget.
- No skill contrast ran, so this says nothing about whether plan-eng-review, autoplan's eng phase or the rebuilt candidate helps. The plan-mode rule also bars a cut while a skill's main intentions are untested. The verdict is FIX-METHOD on task fit.

## What works

- **The judge check, once the judge had room.** GPT-6 Astra, grading Opus's lists, matched the audit gold at weighted kappa 0.949, with catch rate 1.00 and false-fail rate 0.087. Unweighted kappa was 0.982, and kappa against every audit cell was 0.958. The gold held 72 anticipated and 289 not-anticipated cells from 257 lists. The audit gold credited the oracle lists, written from the key itself, on 66 of 68 cells (defects 49 of 49, follow-up tests 3 of 3, CI changes 14 of 16), so a real hit shows when it is there.
- **Plain models map a change's code well.** By a mechanical name match, Opus's 15-path list named 50.4% of the source files the real change touched and 14.4% of its functions. A grep baseline (the 15 functions whose names share the most words with the plan) named 12.7% and 1.2%. Mean bug-site recall was 73.8% under a looser match that credits a blamed file or function by name, base names and unqualified names included. So by a loose match Opus's paths reached most bug sites. Where it fell short was naming the condition that later broke.
- **The format and the controls held.** Opus returned the frozen block in 48 of 48 reviews, particle-1 in 47 of 48 and Sol in 42 of 48 (6 arm stops, below). The three stock rows, judged as if they were reviews, were credited 0 times on every model against a limit of 2. The generic screen flagged 0 key items. Opus's shuffled-key control read 0.
- **Containment held.** No session transcript, in any model or arm, held a later commit id, a full commit id from any key or an aftermath-only file name. Every unit repo held only its one base commit. Opus recognized 0 of the 16 changes in the recognition probe.
- **Checking one real call first is cheap.** Stage 1's first check packet, run alone, showed the 32,000-token problem for about 3% of the check's final spend. After the fix, the first packet alone confirmed it for about 1.2%, before the other 47 packets ran.

## What didn't work

**Plain Opus sat at the floor.** A is the share of a unit's key items that a review's 8 checks name, path and condition both, with one check credited to at most one item. The key holds what happened in the 60 days after each merge: post-merge defects traced to the change (B), follow-up tests (T) and CI or eval changes (C), at most 6 a unit. Admission needed plain Opus between 0.10 and 0.75. It read 0.087 (95% CI 0.007 to 0.191) over 16 calibration units and 48 reviews. By kind it read 0.024 on defects, 0.208 on CI changes and 0.667 on follow-up tests, which are few. Only 1.6% of its checks earned any credit. On the items both auditors rated foreseeable from the plan and the base code (yes or maybe), it still read only 0.137.

**Two skill arms did not run their procedures reliably.** In the Opus smoke, the pre-cut plan-eng-review was exposed in 3 of 6 sessions and autoplan's eng phase in 2 of 6, short of the 5 of 6 the frozen rule needs. The rebuilt candidate was exposed in 6 of 6. All 24 Opus smoke sessions, lens included, scored A 0 on their 6 units, where plain Opus averaged 0.056. The frozen fallback (a Stop hook that sends the session back, then a fresh 6-session smoke) did not run, because FLOOR ended the eval first.

**The judge check needed a fix before it could run.** Opus 5.5 is the check's first auditor and the judge of Sol's lists. At maximum effort it spent its whole 32,000-token output cap on the first check packet, twice, and returned no text. We raised Opus's audit cap to 64,000 (#326) and ran only the 48 Opus-list packets, the only ones admission reads. Opus then answered 47 of 48. One packet's 55 cells stayed without gold, and 6 of its 53 calls still ended at the cap with no text.

**Sol and particle-1 have no checked numbers.** Their judges (Opus on Sol's lists, an Astra and Opus panel on particle-1's) were never checked under R78, and a different judge graded each model. Their A values below are descriptive and are not comparable with Opus's.

## How it works

This is our explanation, not a result.

Most of what goes wrong after a merge is hard to see from the plan. The B items are defects that SZZ traced to the change's own lines and a key writer confirmed, and many turn on a state, an input or a platform the plan never mentions. A review gets 8 checks, so it has to choose, and plain Opus chose the change's main behaviors: 62% of its checks were unit tests, 18% end-to-end tests and 17% CI jobs. Those overlap what the team's own tests already checked (half of those behaviors, A_own 0.500) far more than what later broke.

The foreseeable stratum says hindsight is not the whole story. On items the auditors thought a careful reviewer could name, Opus credited 0.137. Sol, graded by a different and unchecked judge, read 0.453 on the same stratum. That gap is a lead for the next design, not a finding.

## Result

**Stage 1, no-gstack arm, 16 calibration units, 3 passes a model.**

| Model | Judge of its lists | Judge check | A, frozen | Arm stops as missing | Units with credit | Blocks | A on defects, tests, CI | Foreseeable stratum | Status |
|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | GPT-6 Astra | pass, kappa 0.949 | 0.087 (95% CI 0.007 to 0.191) | 0.087 | 4 of 16 | 48 of 48 | 0.024, 0.667, 0.208 | 0.137 | FLOOR, counts |
| GPT-6.1 Sol | Opus 5.5 | not run | 0.361 | 0.396 by unit (0.413 over the 42 parsed reviews) | 10 of 16 | 42 of 48 | 0.345, 0.667, 0.250 | 0.453 | descriptive |
| particle-1 | Astra and Opus panel, Gemini 4 Argon on splits | not run | 0.108 | 0.108 | 5 of 16 | 47 of 48 | 0.071, 0.333, 0.208 | 0.137 | descriptive |

- **Admission: FLOOR.** Opus none's A is under 0.10, the stock checks pass, Astra passed its judge check and Opus parsed 48 of 48. FLOOR is FIX-METHOD on task fit.
- **Missing and arm-stop rates.** Opus: 0 no-block, 0 arm stops, 0 missing. Sol: 6 of 48 (12.5%) ended as arm stops, all from the session allowance's byte-based reservations (Deviations, item 17), and the frozen rule scores them 0. The sensitivity read counts them as missing. particle-1: 1 of 48 (2.1%) returned no block, which counts as 0 in both readings. No session was contaminated.
- **Judge check (Astra on Opus lists).** Weighted kappa 0.949, catch 1.00, false-fail 0.087. Unweighted kappa 0.982, false-fail 0.028. On real lists alone, kappa 0.789, catch 1.00, false-fail 0.333. Against every audit cell 0.958. Gold: 72 anticipated, 289 not, 257 lists, 204 anchor cells at weight 0.2565. Sol's and particle-1's judge checks did not run, so their readings say "short of gold" by construction.
- **Leak strata.** Opus and Sol have stated training cutoffs, and 0 of the 16 units was leak-exposed for either. particle-1 has no published cutoff, so its exposure to these changes is unknown. The recognition probe found 0 of 16 recognized by Opus.
- **Stock, generic and mentioned counts.** Each model's three stock rows were credited 0 times over 16 units. The generic screen flagged 0 items and no item was a mentioned item, so A on generic and mentioned items has no data.
- **Opus secondaries.** Path-hit share 0.785 (judged). Bug-site recall: paths 0.738, checks 0.226. Path-map recall: files 0.504, functions 0.144 (grep baseline 0.127 and 0.012, unit means). A_own 0.500. Per-check precision 0.016. Shuffled-key A 0, so specificity equals A at 0.087. Mean block 314 words and 20.9 items, with 0 items shortened by the cut. Check mix: unit 62%, end-to-end 18%, CI 17%, eval 0%, other 3%.
- **Smoke.**

| Arm | Opus: parsed, exposed, A | Sol: parsed, exposed, A | particle-1: parsed, exposed, A |
|---|---|---|---|
| lens | 6 of 6, no detector, 0 | | |
| pre-cut plan-eng-review | 6 of 6, 3 of 6, 0 | 2 of 2, 1 of 2, 0 | 2 of 2, 0 of 2, 0 |
| autoplan eng phase | 6 of 6, 2 of 6, 0 | 2 of 2, 0 of 2, 0.5 | 2 of 2, 1 of 2, 0 |
| candidate | 6 of 6, 6 of 6, 0 | 1 of 2 (1 arm stop), 0 of 2, 0 | 2 of 2, 2 of 2, 0 |

  Rule 1 (parse) passed for every arm. Rule 2 (exposure) failed for pre-cut and eng phase on Opus. Rule 3 makes pre-cut on particle-1, and eng phase and candidate on Sol, descriptive. With the Sol arm stop counted as missing, candidate on Sol reads 0 of 1 exposed, which changes nothing.
- **Units.** Calibration holds 4 units of each type (mobile, consumer, server, developer tools). Per-type reads belong to stage 2, which did not run. The comparison set was drawn for stage 2 as mobile 9, consumer 14, server 14 and developer tools 19, and the reserve as consumer 1 and developer tools 5.
- **Length-adjusted read and code share.** The length-adjusted read exists only for the 13 smoke cells (6 sessions on Opus, 2 on Sol and particle-1), and every one of its intervals includes 0. The code-change credit share was 0 on each no-gstack cell and empty or 0 on every smoke cell. Every cell's other secondaries are in the appendix below.
- **Candidate pin and digests.** The candidate ran at gstack 57295cbc (branch eng-review-intentions-candidate). sha256 of plan-coverage/SKILL.md 4778462dbff92da7b5df3088c7b96b6dc1a16e35d063cbb2322a34457dcd9882, and of plan-coverage/SKILL.md.tmpl 079b2966e9b6695abe3f86a0585f5a515a72175dc70cb9bfeba503c035e86135. The build checked both before the run.
- **What section 18 asks for that does not exist here.** Stage 2's primaries (interval, p, Holm p, worse count, coverage), the specificity contrast, the pairwise read, the arm-guess read and stage 3's readout did not run. The by-month and strict-stratum reads exist in the sealed scores but were not exported as counts, so they are not reported here.
- **Power.** The unrun stage 2 design could detect 10 to 13 points on Opus at 56 units and 2 passes, at a control near 0.20 and 80% power. That is the design's figure, not the power of this 16-unit calibration, whose Opus interval runs from 0.007 to 0.191.

## Why null?

No primary ran, so the cycle reads the stop.

- **Did the model use the part?** No contrast exists, because stage 2 never ran. In the Opus smoke, the pre-cut skill ran its procedure in 3 of 6 sessions, the eng phase in 2 of 6 and the candidate in 6 of 6. Two of the three skills would have needed the enforced-procedure fallback before stage 2.
- **Do the tasks fit?** Not well. Plain Opus credited 0.087 of the key and any item on only 4 of 16 units. The judge is not the main cause: Astra matched the audit gold at kappa 0.949, and the gold credited the oracle lists on 66 of 68 cells. It is not a clean "no" either. On real lists alone the gold held only 6 anticipated cells, and Astra credited 4 of them. If it under-credited that much everywhere, Opus's A would sit near 0.13, just above the edge. And on the foreseeable stratum Opus still read only 0.137. So the floor is near the edge, and part of it comes from what plain Opus chooses to check, not only from what can't be foreseen.
- **Were there enough samples and headroom?** This is a floor, not a ceiling. 16 units at 3 passes put the upper bound at 0.191. Stage 2's design assumed a control near 0.20.
- **Does today's frontier model do it unaided?** No. Plain Opus names where a change's aftermath lands for about one key item in eleven. Whether any skill raises that is untested.

**Verdict: FIX-METHOD (task fit).** It is not a CUT-CANDIDATE, because no skill arm minus none was tested, and it is not a KEEP for the same reason.

## Next method

The next attempt makes the preregistration's stage 3 build read its primary. Opus 5.5 builds each change from its plan, once with no review and once with each arm's review notes. Each build is graded by hidden tests taken from the real aftermath: the share of the unit's aftermath tests that pass, whether every functional test passes, and real-bug catch (a test the build added that fails on the real merged tree and passes on the real fixed tree). This asks the claim's second half directly: does a reviewed plan lead to code that avoids the real bugs, with tests that would have caught them?

Before it spends, it needs four things: a count of units whose test suite runs in a container at base and at the merge and that carry at least one hidden test (nobody has counted this yet); an exposure gate for the skill arms (the Stop hook or a two-turn shape); measured costs per session; and a harness on main. The 56 comparison and 6 reserve units were never shown to any review arm, so they can serve.

## Deviations from the preregistration

Each was recorded before the outcome data it could affect, unless the item says otherwise.

1. **F1, F3 and F4, authoring build bugs fixed after authoring pilot 1:** empty merge diffs shown to the key writer, verdicts on dropped items failing an audit round, and an item-kind rule the auditor wasn't told. F4 also adds one sentence to the key-audit prompt.
2. **F2, a build-prompt change after pilot 1.** The input audit failed plans for leaving out wishes that only the linked request states, while section 4's frozen rewrite keeps "every decision the description states". In pilot 1, 17 of the 18 omissions it raised were request-only wishes. The change was tested both ways on pilot 1's recorded inputs.
3. **Pilot 1's fault drops re-authored.** Its four units dropped by build faults went back into the pool and were re-authored in their seeded places under the fixed build. Its five real failures stayed dropped, and one cap-stopped unit was never retried.
4. **Planning spot checks not excluded.** The 20 changes spot-checked during planning carry no ids, so they could not be excluded from the pool.
5. **F5, a missing candidate fails an audit round only when both auditors name it.** The frozen audit rule says nothing on missing candidates. A replay of pilot 1's 21 audit rounds changed no unit's outcome under F5.
6. **F6, a refactor filter.** The miner drops changes whose plan says no behavior change is intended. A pre-data build fix; it removed 28 candidates and one authored unit, which had not passed.
7. **F7, a draw fix with no rule change.** A unit counts as drawn only once a draw has written its set and a rank of 1 or more, in the draws and in every stage selector. Made before any stage data.
8. **Mobile fallback.** Section 4 names transposed units as the fallback for a type short of comparison units. Transposition was not built, so mobile alone could draw aftermath-only units (an aftermath with T or C candidates and no B candidate). 27 were authored and 0 passed, so the primary reads the same with and without them.
9. **Mobile fell back early.** It fell back while two late-window B or R candidates were still pending, instead of waiting for their windows to close.
10. **Mobile under its floor (F9).** The comparison set holds 9 mobile units against the frozen floor of 10. F9 lets one ruling lower one type's floor for one draw and writes the ruling into the set file. A seeded replay matched all 56 units and their order.
11. **Reserve authoring not done.** The frozen quota-0 rule filled the 6 reserve places from units already authored and audited, so the reserve's own authoring item spent nothing. Mobile and server hold no reserve unit.
12. **The miner's window flag.** The miner marks a window open by comparing its close with the end of the mining day, so 21 candidates whose windows closed later on that day read as closed. The picker was fixed outside the lane code; one authored unit whose aftermath was mined early was left without a key and counted as a unit without a pass.
13. **A missed classify step.** One batch ended before its classifier call, so 3 passes had no type label until they were classified, before the comparison draw. Their labels matched.
14. **Stage 1 caps re-sized** on measured first-session cost with the frozen sizing rule (1.6 times the projection plus the $10 allowance), before any outcome data. A watcher halted an item if its first 10 sessions projected past the new cap. None halted.
15. **Lens ran 6 Opus smoke sessions instead of 2,** because one ledger item binds one run and a resume must keep the run's units and arms. Lens smoke is descriptive and feeds no rule.
16. **Stage 1 restarted as fresh runs.** A containment check ran git status in the unit trees, which rewrote each repo's .git/index; the units digest covers that file, so the runs could not resume. Two frozen-build defects (F10, F11) also make resume unreliable. The 13 first sessions became cost measurements, never scored, and six fresh single-launch runs replaced them. No outcome was read for this decision.
17. **Sol's allowance stops.** The proxy reserves a call's worst case from its input bytes, not its tokens. In 64 Sol attempts, 17 were refused on reservations alone, and 7 sessions (6 no-gstack, 1 smoke) ended as arm stops after both attempts. The frozen rule scores them 0, which biases Sol low; the sensitivity read counts them as missing. No admission line depends on Sol. A per-model allowance (#323) was built and closed unmerged.
18. **Six calls with unreadable usage.** Five Sol calls and one Opus smoke call settled at their worst case, because the provider usage exports were not available to us.
19. **Opus's audit output cap rose from 32,000 to 64,000 tokens** at maximum effort (#326), because Opus spent the whole 32,000 thinking. The eng-review judge client's default rose to 64,000 too, but each call states its own cap, so only Opus's audit calls reserve more. The other judges' reservations per call were unchanged: Astra $1.69 to $1.78, Gemini $0.34 to $0.35. The reply cache keys on the cap, so no 32,000-token reply was reused.
20. **The judge check ran on the 48 Opus-list packets only, not all 144.** Sol's and particle-1's judges were not checked.
21. **Run ids.** Each judge item binds to its first run, so each full label map ran under its first-packet run's id, and the label map was split by model across the three judge items.
22. **#326 merged into the lane branch with two CI exceptions** for that branch only: tests/panel-kit-v3-1.test.ts:101 and quick/laneb/tests/agent.test.ts:11. Both fail the same way at the frozen head before #326. Its ship receipt was waived because the receipt tool can't write one while CI is red.

## Limits and threats

- **Unit selection leans toward focused fixes.** The key writer sees each candidate diff cut at 2,500 words. Across the 61 first-wave units, 13 of 46 drops had every blamed hunk past the cut, against 1 of 15 passes. Big-commit fixes rarely key, so the units over-represent changes whose later bugs were fixed in small commits.
- **Mobile is thin.** The comparison set has 9 mobile units against a floor of 10, and neither mobile nor server has a reserve unit.
- **Resume is not reliable in this frozen build.** F10: the eng phase's openings are written exclusive-create, so a resume of any run with that arm fails. F11: a stale reply cache makes the driver return before it prints its stops, so a skill-arm resume can end silently with 0 sessions.
- **Two lane-branch CI tests fail and pass locally:** tests/panel-kit-v3-1.test.ts:101 and quick/laneb/tests/agent.test.ts:11. The cause is unexplained.
- **The floor is near the edge.** On real lists Astra credited 4 of 6 anticipated gold cells. If that held everywhere, Opus's A would be near 0.13.
- **One Opus check packet has no gold**, and 6 Opus check calls returned nothing at the 64,000-token cap. Why is not diagnosed; thinking until the cap is a guess.
- **Smoke A is uninformative.** The 6 smoke units averaged 0.056 for plain Opus, so 0 on every smoke session tells us little.
- **Base normalization.** In 6 units, git add normalized 30 base blobs under the repo's .gitattributes, so the unit repo's one commit differs from the upstream base there. The worktree a session saw held the upstream bytes in every case.
- **The key undercounts.** SZZ finds defects only where a fix touched the change's lines. A follow-up test reflects what a team chose to test. Plans are rewrites of what a team wrote while building. Every skill arm ran unattended and without web tools, though the skills were written for a person at the keyboard.
- **Training data.** Opus 5.5 may hold data to September 2026, which overlaps the merge window. The probe found no recognized unit, which bounds this but can't rule it out.
- **Lost calibration units.** Ten calibration units were lost in a machine reboot before they were sealed. Their candidates were treated as used and never drawn again, so the calibration set comes from the units authored after them.
- **Concurrent retains.** Two runs on one state root retaining the same unit tree collided on a fixed temp-file name. Both died before any lease and were relaunched alone.

## Setup

- **Question.** On real changes merged after Opus 5.5's stated training cutoff, does a review by the pre-cut plan-eng-review, by autoplan's eng phase alone, or by a rebuilt candidate name more of the paths where the change's real post-merge bugs, reverts, follow-up tests and CI changes landed than the same model with no gstack, or with a one-line engineering-manager prompt? Stage 1 checks that plain Opus has room for an effect, that the judges agree with gold, and that the skills run.
- **Units.** 16 calibration units, 4 a type, from public GitHub repositories with at least 500 stars and an open-source licence. Each is one change merged from 2026-07-01 to 2026-09-30 that adds a feature or changes behavior. Its plan is a rewrite of the pull request's description and closing issues, dated before the merge. Its key lists what happened in the 60 days after the merge, written by Opus 5.5 and audited by Opus 5.5 and GPT-6.1 Sol.
- **Arms.** Every prompt ends with "Review the plan in plan.md for the code in /work/repo, and make it better before anyone builds it." and the frozen closing template (15 paths, 8 checks). none adds nothing. lens adds "Do an engineering-manager review of this plan." pre-cut adds "/plan-eng-review plan.md" at garrytan/gstack b493d4e3. The eng phase gets autoplan's Phase 3 state at gstack 19993102. The candidate adds "/plan-coverage plan.md" at gstack 57295cbc. Each skill arm also gets one sentence telling it to run the whole procedure unattended, taking its recommended option at every decision.
- **Harness.** Claude Code in the trial container, a 200,000-token context window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, web search and fetch denied, no network except the metering proxy, and per session $10, 200 turns and 90 minutes. The no-gstack and lens arms had no gstack install.
- **Models.** Opus 5.5 (anthropic/claude-opus-5-5), GPT-6.1 Sol (openai/gpt-6.1-sol through OpenRouter, pinned to OpenAI) and particle-1 (particle-ai/particle-1 through OpenRouter).
- **Passes.** No-gstack: 3 passes on each model (48 reviews). Smoke: 6 Opus sessions a skill arm and 6 lens sessions, 2 a skill arm on Sol and particle-1.
- **Judges.** GPT-6 Astra labels Opus lists, Opus 5.5 labels Sol lists, and an Astra and Opus panel labels particle-1 lists, with Gemini 4 Argon voting on splits. Production labels ran at medium effort and the judge check at maximum.
- **Dates.** Authoring 2026-11-09 to 2026-11-10. Stage 1 runs 2026-11-10 from 16:38 UTC, scored 2026-11-11 at 01:25 UTC. Judge check 2026-11-11, 10:21 to 12:38 UTC. Runs on one Ubicloud standard-8 VM, the check on a standard-4.

## Replicate it

Keyless, from the frozen build:

```
git checkout eng-review-intentions-stage-1
bun install --frozen-lockfile
bun test tests/er
```

The tag eng-review-intentions-stage-1 points at 47acea4, the head the judge check ran on. Its ancestors hold every head that ran: 6d541bd (authoring pilot 1), 214f106 and c0a4c7d (pilot 2 and the first calibration units), 0458639 (later calibration and the first wave-1 units), b6eca19 (the calibration draw and comparison authoring), 350a851 (the comparison and reserve draws, the stage 1 runs and their scoring) and 47acea4 (the judge check). The lane code lives on that branch and is not on main. The renderer tests skip without a gstack clone at the arm pins.

The stage 1 sessions ran through `review-units --plan eng-review`, and the readings came from `bin/gstack-evals er score` and `bin/gstack-evals er readings` over the sealed run data. This record leaves out the host launch scripts, the halt watcher, the containment scripts and the sealed units, keys and labels, so the paid readings can't be rerun from the repo alone. Before you rerun this build, know its gaps: F10 and F11 above; the dry-run test accepts any "FAIL run side:" line, and its run-side lines print "undefined"; the 2,500-word candidate-diff cut; the miner's window flag; and the retain temp-file collision.

## What is held out, and why

The units (plans, repos and keys), the judge labels, every review and every transcript stay sealed with the operator, with digests only. A published key would let later models train on the answers. Units digests: calibration 43148a25c2c80d7728c59ea675d4471a2d967f9f222f5dafa9e371613468a6cc, comparison a222f798188467e985f61f36e4cfbae0ee364c370e07f5f4440fc8564ed7463b, reserve 8a9feffe441825fb5b1ee4bcdc457784b1d7fc715144974c7b4f030313482c4f. Sealed bundles: stage 1 runs 528d9a5e0e370cbbdfddf6576b259de9439545998db13b3879db7b85dad82585, judge check 642a469eaaba075bf990bec8b81cb1d313b69b3fb4897b78a1e6aa2388ce9e49, units checkpoint dcdb9cd06ce9b80b61342ec1a75f42643032d9bf9c8550d7566b11cd1ced99f7. These are operator-reported, not reproduced.

## Appendix: every stage 1 cell's secondaries

These come from the frozen scorer's cells. Path-map recall gives files then functions, by mechanical name match. Bug-site recall gives paths then checks.

| Model, arm | Reviews (blocks) | A | Shuffled A | Specificity | Path-hit | A_own | Bug-site recall | Path-map recall | Precision | Mean words |
|---|---|---|---|---|---|---|---|---|---|---|
| Opus, none | 48 (48) | 0.087 | 0 | 0.087 | 0.785 | 0.500 | 0.738, 0.226 | 0.504, 0.144 | 0.016 | 314 |
| Opus, lens | 6 (6) | 0 | 0 | 0 | 0.750 | 0.300 | 0.750, 0.167 | 0.380, 0.093 | 0 | 315 |
| Opus, pre-cut | 6 (6) | 0 | 0 | 0 | 0.500 | 0.300 | 0.750, 0 | 0.304, 0.086 | 0 | 308 |
| Opus, eng phase | 6 (6) | 0 | 0.083 | -0.083 | 0.583 | 0.350 | 0.417, 0 | 0.269, 0.084 | 0 | 337 |
| Opus, candidate | 6 (6) | 0 | 0 | 0 | 0.750 | 0.350 | 1, 0.167 | 0.373, 0.114 | 0 | 377 |
| Sol, none | 48 (42) | 0.361 | 0 | 0.361 | 0.809 | 0.482 | 0.774, 0.012 | 0.492, 0.086 | 0.063 | 294 |
| Sol, pre-cut | 2 (2) | 0 | 0 | 0 | 1 | 0.500 | 1, 0 | 0.476, 0.040 | 0 | 311 |
| Sol, eng phase | 2 (2) | 0.500 | 0 | 0.500 | 1 | 0.500 | 1, 0 | 0.476, 0.034 | 0.063 | 276 |
| Sol, candidate | 2 (1) | 0 | 0 | 0 | 0.500 | 0 | 0.500, 0 | 0.143, 0.020 | 0 | 319 |
| particle-1, none | 48 (47) | 0.108 | 0.038 | 0.069 | 0.760 | 0.536 | 0.810, 0.036 | 0.501, 0.109 | 0.022 | 302 |
| particle-1, pre-cut | 2 (2) | 0 | 0 | 0 | 1 | 0.500 | 0.500, 0 | 0.262, 0.040 | 0 | 292 |
| particle-1, eng phase | 2 (2) | 0 | 0 | 0 | 0.500 | 0.500 | 0.500, 0 | 0.226, 0.077 | 0 | 308 |
| particle-1, candidate | 2 (2) | 0 | 0 | 0 | 1 | 0.500 | 1, 0 | 0.548, 0.111 | 0 | 301 |

The Sol and particle-1 rows are descriptive, because no checked judge graded them.

## Record

| Field | Value |
|---|---|
| Grade | Stage 1 gate readings. FLOOR on a checked judge for Opus; Sol and particle-1 descriptive. No confirmatory primary ran. |
| repo_commit | Tag eng-review-intentions-stage-1 at 47acea4, on the lane branch; the heads that ran are listed under Replicate it |
| prereg | [Frozen preregistration](../plans/2026-11-08-geva-405-eng-review-intentions-prereg/README.md) (#276) |
| data | Sealed bundles listed above (held out) |
| reviewed_by | This pull request's review |
| reproduced_by | Not reproduced |

## The X hook

We tested whether gstack's plan-eng-review helps a model plan tests where real bugs later land. Plain Opus 5.5 averaged 8.7% credit per change for naming where real changes' later bugs, tests and CI changes landed, below the admission line we set in advance, so the skill comparison did not run. Next we grade the code a reviewed plan leads to. Also run on GPT-6.1 Sol and particle-1, whose numbers no checked judge graded (YC is an investor in Particle).

## Changelog

- 2026-11-11: first version.

## Agent notes

<details>
<summary>Spend, caps and the line's all-in to date</summary>

- Stage 1 paid calls, from the ledger's close records: $246.87. Runs $154.47 (first launches $10.98, kept as cost measurements only; fresh runs $143.49, with the six unreadable calls at their worst case, $7.94). Labels $20.93, recognition probe $0.07, judge check $71.41.
- Judge check: Opus 53 calls $38.82, Astra 49 calls $28.97 (the first packet's reply came from cache), Gemini 15 tie-break calls $1.67, with $1.95 and $0.88 for the two first-packet runs. About $7.70 of it paid for Opus calls that used the whole 64,000-token cap and returned nothing.
- Caps: the check item rose from $93 to $160 for the 64,000-token cap; the three no-gstack items rose by $69 in all under the frozen sizing rule; every lease closed with no cap stop.
- Unit authoring: $802.92 (pilot 1 $37.32, pilot 2 $36.38, calibration $110.97, wave 1 $615.50, classifier $2.20, generic screen $0.56, reserve $0). Ten calibration units authored in one session were lost in a machine reboot before they were sealed. Their $53.57 stays in the calibration figure, and their candidates were treated as used and never drawn again.
- Hosts: at most $5.17 (a 28-minute standard-8 $0.12, operator-reported, the stage 1 standard-8 for 1,072 minutes $4.46, and the check's standard-4 for 141 minutes at most $0.59 at the standard-8 rate). Every VM was destroyed after its data was sealed.
- The line's ledger reading also carries $118.49 from a shared item of the autoplan larger-features headroom check. That is autoplan's spend, so it is subtracted: $1,168.28 less $118.49 gives this line's paid items, $1,049.79.
- Crew model use, at about $1 per 1,000 credits: the planning thread 58,294 credits, the build and authoring thread 70,455, and the stage 1 thread 191,662 at the time of writing, about $320 together. These counter readings are operator-reported, not reproduced.
- **The line's all-in to date: about $1,375, provisional on the operator-reported host and crew figures** ($1,049.79 paid items, at most $5.17 hosts, about $320 crew), against a $4,000 guideline and a $4,100 stop.
- Timeline, UTC: 2026-11-10 16:38 first launches; 18:29 the resume refusal; 19:09 to 19:27 fresh runs launched; 2026-11-11 01:25 readings; 10:07 runs sealed and the host destroyed; 10:21 judge check host up; 12:38 check settled; 12:41 check sealed and the host destroyed.

</details>

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- gstack is Garry Tan's own project.

---
id: 2026-11-15-geva-503-harness-mechanics-results
kind: finding
title: "Harness mechanics on 200 SWE-rebench fixes and three models: the models already ran a test after their last edit, so gstack's Stop hook had almost nothing to add; a second plain attempt tied /verify at equal spend; Jev ran a risky-command hook at about a sixth of particle-1's hook time"
summary: "Opus 5.5, GPT-6.1 Sol and particle-1 on 200 SWE-rebench tasks: H1 null, FIX-METHOD (saturation) except CUT-CANDIDATE on Sol; H2 equal at equal spend, KEEP; H3 Jev matches, 0.16x hook time, KEEP."
author: GEVA-503
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: done
links:
  - 2026-11-09-geva-448-harness-mechanics-prereg
  - 2026-11-12-geva-501-decision-routing-results
  - 2026-11-06-geva-350-l1-overhaul-results
  - garrytan/gstack-evals#300
  - lanes/harness-mechanics
attachments:
  - a0d34615d485bb6c5bcc2d075dc7ca21eb27fc286a9014d660b8a3a6e7f39225  counts.py.txt
  - 3f67dbe803d8dff4368163b867176f808e41bd65cbd92c4481231b97ba5edda0  counts.txt
  - 30b8eb3e0703704dfbb2e8697bbc4b46ad4593e3e6925e1b278e4d2aa0d7a887  digests.txt
  - d60b1e6daba6a4dbf2b47a1edaae1c68accad4472e145806fde2cd103547e733  done-count.ts.txt
  - c32b04ae30da976d0c9c8e463ddaa11cefe63c7cd9fd7376493c61db98fddd64  done-items.txt
  - 67869558a486264803b5e012c51e45e76dfb2ad8b8353ee5504cb463c617d452  rebuild.ts.txt
  - 61e3b4d5d6e9de0a9c6e923bb3bddd8c30493d90036c750ca00a6bac849aeba5  recount.patch.txt
  - a0465c64718a15df7a0f12ebcdf5eb09afad9934bf4eef44e9e40636fe7d5f47  recount.txt
  - 657e96971be989a7ef5a7f1699703cb20be5843b291f69dcc83fee67212cc752  reliability-done-det.svg
  - 80a88d3538d3b52f1aaf8f189352f0895bcfbd4a431844598aa0026d622c4cd7  reliability-done-jev.svg
  - d1277b6f8ed0b2c6d5ca23a832135da8ea4f5aa3921df59108ea12370f75f94d  reliability-done-p1.svg
  - 4ef634dd764db694aa42fc136a8a1f865817f649dead2f49fb61e0ee1bc0eddf  reliability-risky-det.svg
  - 45074c99bf5a59fe0e6b91d5c7f8c5b79228bac9bc26e8bfff036839136d3dcf  reliability-risky-jev.svg
  - 406f34b6c874f2f2c3aad9978b44e758d16789f1c0619241d177a539e3841e34  reliability-risky-p1.svg
  - 596b6a2cd123a851e1225f07ec25cf45340ffd8f434647d41ccf9b02de04db00  replay-report.md
  - fcb55696bb0b5be8312317a312d3499ca7b474451e8ff2af73d84b155e96b5b3  report-3d5dcce.md
  - eb388e45400a3ea32e1cf144fb28f9af4912c21c8246909aafbaaa53b44377ba  report-head.md
---

# Harness mechanics: a stop rule as prose or as a hook, best-of-2 at equal spend, and Jev behind a judgment hook

## Status

Publication status: unpublished. This is the record of a preregistered run. Done: Stage 1 (calibration and admission), Stage 2 (the offline replay), Stage 3 (the judge pilot), Stage 4 (the scored run, 2,760 sessions and 600 picks), the analysis and this post. Still open before any public use: a claim check by a reviewer from another model family and a recount by another crew.

| Field | Value |
|---|---|
| Grade | Confirmatory for H1, H2 and H3 as section 14 of the preregistration states them. Per-model lines, secondaries and every count in Run disclosures are descriptive. |
| Prereg | [2026-11-09-geva-448-harness-mechanics-prereg](../../plans/2026-11-09-geva-448-harness-mechanics-prereg/README.md) |
| Code | Every paid session and pick ran from 3d5dcce. The corrected reading comes from this post's head, where the only change under lanes/harness-mechanics is the two-regex scorer fix in Deviation S4-2. gstack at ba2289e1 (v1.98.0.0), Jev jev-1.13.0. |
| Data | Trial dirs, ledgers and run records sit in the gstack-evals Captain's drive (handoffs/GEVA-503/). They hold model transcripts, so they stay private. This post publishes counts, digests and the printed reports. |
| Reviewed by | The /ship review of this post, recorded in its pull request |
| Reproduced by | Not yet by another crew. rebuild.ts rebuilt both run tables from the trial dirs byte for byte at 3d5dcce. |

## What we found

We learned that coding agents on these bug fixes already run a test after their last edit in most sessions, and gstack's /verify procedure pushes that close to always. With no gstack, Opus 5.5 did it in 81.4% of sessions, GPT-6.1 Sol in 86.0% and particle-1 in 91.5%. Told to use /verify, they did it in 96.0%, 89.0% and 97.5%. gstack's contract hook, which blocks a stop once when the rule is unmet, found something to block in 22 of 600 sessions, and it changed neither how often the rule ran (pooled +0.2 points, 95% CI -2.6 to +2.9) nor passes (-0.3, -2.9 to +2.3). You should write a check-your-work rule into the procedure first, and add a hook only where you can measure that the rule gets skipped.

We learned that at equal spend, gstack's /verify and a second plain attempt tied: the spend-matched policy minus /verify was -0.7 points (95% CI -2.8 to +1.5), inside the preregistered 5-point margin. Neither extra spend raised passes over a single plain attempt once both plain arms are counted. Best-of-2, a second plain attempt with a model from the other family picking the better patch, cost 2.1 to 2.6 times one attempt. Against the none arm it scored +2.0 points (+0.5 to +3.7); against plain-2, the other single plain attempt on the same prompt, it scored -0.3 (-1.6 to +1.0). The +2.0 comes from Opus's none arm, which passed 5.5 points below Opus's plain-2 (see Limits): on Opus, best-of-2 minus none was +4.0 and best-of-2 minus plain-2 was -1.5. You should treat /verify and a second attempt as two equally good ways to spend extra money on tasks like these, and not expect either to move pass rates by much.

We learned that Jev, a small fast decision model, can sit behind a judgment hook on every Bash call without a measurable cost in passes. On a risky-command check, Jev's hook time per session was 0.163 times particle-1's (95% CI 0.151 to 0.177), and passes moved -1.7 points (-6.5 to +3.3), inside the 7.5-point margin. You should consider Jev for judgment hooks on the hot path, knowing that live, the hooks denied 12% to 22% of the commands they judged, and we didn't label whether those denials were right.

**What didn't work.** /verify itself didn't measurably raise passes over plain Claude Code: +1.5 points (-0.7 to +3.6) pooled against none and -0.8 (-3.3 to +1.5) against plain-2, at 1.61 times the spend on Opus, 0.94 times on Sol and 1.21 times on particle-1. On Sol, the one model Stage 1 didn't mark saturated, the hook's null on this rule reads CUT-CANDIDATE, on a wide interval (H1 below). No backend beat the deterministic rule on the done-claim check in the replay, so the done hook never ran live. The two labelers disagreed on skill routing (kappa 0.19), so the route point has no reading. And our own scorer missed pytest summaries printed in colour, which hid a ceiling until the analysis (Deviation S4-2). The tables below show the reading as run beside the corrected one.

### H1: the reading as run and the corrected reading

The section 13 scorer at 3d5dcce missed any pytest summary that pytest printed in colour, so it scored real test runs as no test run. The fix counts them (Deviation S4-2). The verdict label is the same either way. The end state changes, because the corrected Stage 1 reading marks Opus and particle-1 as saturated, which section 14 sends to FIX-METHOD before any other end state.

| H1 line | As run at 3d5dcce | Corrected at this post's head |
|---|---|---|
| Stage 1 A2: verify-prose ran the rule (saturated above 90%) | Opus 87.5%, Sol 80.0%, particle-1 89.5% of sessions with an edit: none saturated | Opus 95.0% and particle-1 100.0%: saturated. Sol 87.5% |
| Stage 4 rule ran, verify-prose / verify-hook | Opus 91.5% / 93.0%, Sol 85.0% / 86.5%, particle-1 92.0% / 89.0% | Opus 96.0% / 98.0%, Sol 89.0% / 91.0%, particle-1 97.5% / 94.0% |
| Pooled A, hook minus prose adherence | 0.0 points, 95% CI -2.8 to +2.8; MDD 3.6; 599 pairs | +0.2, -2.6 to +2.9; MDD 3.4; 599 pairs |
| Per-model A (no verdict) | Opus +1.5 (-2.4 to +5.3), Sol +1.5 (-3.8 to +7.0), particle-1 -3.0 (-7.3 to +1.1) | Opus +2.0 (-1.6 to +5.6), Sol +2.0 (-3.1 to +7.5), particle-1 -3.5 (-7.4 to 0.0) |
| Pooled P, hook minus prose pass | -0.3 points, -2.9 to +2.3; MDD 3.4; 600 pairs | the same (the fix changes no pass) |
| Verdict | NO MEASURABLE DIFFERENCE | NO MEASURABLE DIFFERENCE |
| End state | CUT-CANDIDATE for the hook on this rule | FIX-METHOD (saturation) on Opus and particle-1, with R61's attempt owed and not run; CUT-CANDIDATE for the hook on Sol |

The corrected reading is the one this post stands on. Section 13 counts "a pytest summary with passed, failed or error", and a coloured summary is one, so the fix makes the code do what the rule already said.

Sol is the one model the corrected Stage 1 reading left unsaturated (87.5%). Section 14 sends a saturated model to FIX-METHOD (saturation) and every other model to the end state its table gives. For NO MEASURABLE DIFFERENCE, with A3 passed on every model, that is CUT-CANDIDATE for the hook on this rule. The analysis prints only the saturated models' end state, so this post states Sol's: on this rule, the hook's null on Sol reads CUT-CANDIDATE. It is a weak reading. Sol's own line is +2.0 points (-3.1 to +7.5) with an MDD of 7.1, against the pooled MDD of 3.4, so an effect of several points on Sol alone would still read as no difference.

## How it works

This section is an explanation, not a result.

Every arm runs Claude Code at Lane B's pins on the same SWE-rebench issue, with one closing line asking for STATUS: FIXED or STATUS: NOT FIXED. Hidden tests grade the final diff.

- **none** and **plain-2**: no gstack, the plain prompt. plain-2 is a second independent session on the same prompt.
- **verify-prose**: gstack as shipped, the prompt starting with /verify. /verify's own loop asks for a check and then a full run before stopping. Nothing enforces it.
- **verify-hook**: the same, with /verify's "then a full run before you stop" clause moved into a contract item. gstack's Stop hook blocks a stop once when no test or repro ran after the last edit.
- **bo2**: no session of its own. It ships one of the none and plain-2 patches. An empty diff loses to a non-empty one; otherwise one call to the other frontier family picks (GPT-6.1 Sol picks for Opus; Opus 5.5 picks for Sol and particle-1), reading the issue and both diffs in a seeded order.
- **judge-jev** and **judge-p1**: verify-hook plus the judgment hooks the replay admitted. Only the risky-command check was admitted. It runs before every Bash call: a frozen read-only list allows, gstack's careful check denies, and any other command goes to the backend. judge-jev asks Jev and hands unsure answers to particle-1. Its acting band came out empty on the replay's dev split, so live it never escalated and acted as Jev alone. judge-p1 asks particle-1.

## Setup

| Item | Value |
|---|---|
| Tasks | 200 scored SWE-rebench tasks from 142 repositories, 40 calibration tasks from 29, at most 4 per repository per split, drawn with a seed before any call. The judge arms ran on the first 60 scored tasks. |
| Models under test | Claude Opus 5.5 on the Anthropic API; GPT-6.1 Sol and particle-1 through OpenRouter, provider fixed, fallbacks off |
| Harness | Claude Code with its own system prompt, bundled skills off, a 200,000-token window, web tools denied, a 100-turn limit and a per-session allowance |
| Stage 1 | The 40 calibration tasks in four arms on each model: admission checks A1 to A6 |
| Stage 2 | Offline replay on public items: 400 routing prompts, 480 done items (every Stage 1 final stop, labelled by its hidden tests), 600 Bash commands |
| Stage 3 | 72 judge-pilot sessions: hook logging, fail-open and escalation checks |
| Stage 4 | 2,760 sessions: none, plain-2, verify-prose and verify-hook on 200 tasks for each model, and the two judge arms on 60; 600 best-of-2 picks |

Every planned Stage 4 cell has a graded session. No contrast is missing a pair, apart from the judge-arm secondaries that pair 60 judge tasks with 200 (see Limits).

## Result

### Per model, corrected

Rule ran: a test or repro, with its outcome, after the last edit (section 13), over sessions with an edit. Spend: mean session spend over none's on the same model.

| Model | Arm | Sessions | Pass | Rule ran (as run) | False done | Spend over none |
|---|---|---|---|---|---|---|
| Opus 5.5 | none | 200 | 60.5% | 81.4% (75.4%) | 39.5% | 1.00 |
| | plain-2 | 200 | 66.0% | 77.9% (71.4%) | 33.5% | 1.02 |
| | verify-prose | 200 | 61.5% | 96.0% (91.5%) | 38.0% | 1.61 |
| | verify-hook | 200 | 63.5% | 98.0% (93.0%) | 36.0% | 1.63 |
| GPT-6.1 Sol | none | 200 | 57.5% | 86.0% (81.0%) | 42.5% | 1.00 |
| | plain-2 | 200 | 59.5% | 88.0% (84.5%) | 40.5% | 0.99 |
| | verify-prose | 200 | 60.0% | 89.0% (85.0%) | 40.0% | 0.94 |
| | verify-hook | 200 | 58.0% | 91.0% (86.5%) | 42.0% | 0.89 |
| particle-1 | none | 200 | 61.0% | 91.5% (85.0%) | 38.5% | 1.00 |
| | plain-2 | 200 | 60.5% | 91.5% (83.4%) | 39.5% | 0.95 |
| | verify-prose | 200 | 62.0% | 97.5% (92.0%) | 38.0% | 1.21 |
| | verify-hook | 200 | 61.0% | 94.0% (89.0%) | 39.0% | 1.21 |

The judge arms' rows (60 tasks each) are in report-head.md.

### H1 beside it

- The hook blocked 4 of 200 Opus sessions, 13 of 200 Sol sessions and 5 of 200 particle-1 sessions. After a block, 14 of the 22 sessions passed and 14 ran the rule. No session waived the contract or exited BLOCKED.
- Corrected, the scorer read 34 verify-hook sessions with an edit as not running the rule (Opus 4, Sol 18, particle-1 12). gstack's hook recorded 22 of them as met without a block: Opus 3, Sol 13, particle-1 6. The 10 particle-1 sessions with no hook record are all turn-limit stops, where the Stop hook never ran (15 turn-limit stops in particle-1's verify-hook arm, 13 in verify-prose).
- Secondaries, pooled: false done hook minus prose +0.3 points (-2.3 to +2.9); verify-prose minus none pass +1.5 (-0.7 to +3.6); verify-hook minus none pass +1.2 (-1.0 to +3.4).
- Exposure: /verify loaded in 100% of told sessions on every model; the contract record was present in 99.5% (Opus), 100% (Sol) and 95.0% (particle-1) of verify-hook sessions; the none and plain-2 arms read no gstack file in any session.

### H2: gstack against best-of-2 at equal spend

f is the share of tasks on which the equal-spend policy runs best-of-2 instead of one plain attempt, chosen so its spend matches /verify's. On Sol, /verify cost less than a plain session, so f is 0 and the policy is one plain attempt.

| Model | E: policy minus /verify pass | MDD | f | bo2 spend over /verify | pass@2 | Picker right on split tasks |
|---|---|---|---|---|---|---|
| Opus 5.5 | +1.3 (-2.6 to +5.6) | 5.2 | 0.573 | 1.28 (1.19 to 1.38) | 67.0% | 10 of 15 |
| GPT-6.1 Sol | -2.5 (-5.6 to 0.0) | 3.3 | 0.000 | 2.28 (2.12 to 2.45) | 60.0% | 4 of 6 |
| particle-1 | -0.9 (-5.6 to +3.7) | 5.9 | 0.132 | 2.15 (2.02 to 2.30) | 65.5% | 11 of 19 |
| Pooled | **-0.7 (-2.8 to +1.5): EQUAL AT EQUAL SPEND, KEEP** | 2.9 | | 1.82 (1.71 to 1.92) | | |

Beside it, pooled: best-of-2 minus none +2.0 points (+0.5 to +3.7, 17 tasks better and 5 worse) and best-of-2 minus plain-2 -0.3 (-1.6 to +1.0, 8 better and 10 worse); best-of-2 minus /verify +0.5 (-1.6 to +2.8); /verify minus none +1.5 (-0.7 to +3.6) and /verify minus plain-2 -0.8 (-3.3 to +1.5); best-of-2 minus verify-hook +0.8 (-1.3 to +3.0). The +2.0 against none is Opus's: there best-of-2 minus none was +4.0 (+1.5 to +6.9) and best-of-2 minus plain-2 -1.5 (-4.1 to +1.0), because Opus's plain-2 passed 5.5 points (+1.9 to +9.5) above its none arm. On Sol the two lines were +1.5 and -0.5, on particle-1 +0.5 and +1.0. The preregistration names only the none line; the plain-2 lines are a recount made after the final review with the report's own contrast code (recount.patch.txt, recount.txt). Two plain sessions disagreed on few tasks (15 on Opus, 6 on Sol, 19 on particle-1 of 200), which caps what any picker can add. On Sol's pairs the picker (Opus 5.5) chose the first-listed patch in 127 of 200; on Opus's pairs (GPT-6.1 Sol picking) in 105 of 199; on particle-1's (Opus 5.5) in 99 of 198.

### H3: Jev against particle-1 behind the risky-command hook

| Model | Pass, judge-jev minus judge-p1 | MDD | Hook time ratio, Jev over particle-1 |
|---|---|---|---|
| Opus 5.5 | -1.7 (-7.0 to +3.6) | 8.1 | 0.170 (0.152 to 0.191) |
| GPT-6.1 Sol | -3.3 (-12.9 to +5.1) | 11.4 | 0.157 (0.141 to 0.173) |
| particle-1 | 0.0 (-7.7 to +8.3) | 11.4 | 0.162 (0.139 to 0.190) |
| Pooled, 180 pairs | **-1.7 (-6.5 to +3.3): JEV MATCHES AND IS FASTER, KEEP** | 6.0 | 0.163 (0.151 to 0.177) |

From the hook decision logs (counts.txt):

| Model | Arm | Backend calls | Denied by the backend | Fail-open | Median backend latency |
|---|---|---|---|---|---|
| Opus 5.5 | judge-jev | 989 | 120 (12.1%) | 13 (1.3%) | 361 ms |
| | judge-p1 | 883 | 192 (21.7%) | 0 | 2,090 ms |
| GPT-6.1 Sol | judge-jev | 667 | 112 (16.8%) | 2 (0.3%) | 367 ms |
| | judge-p1 | 623 | 139 (22.3%) | 0 | 2,392 ms |
| particle-1 | judge-jev | 1,193 | 173 (14.5%) | 1 (0.1%) | 375 ms |
| | judge-p1 | 1,143 | 255 (22.3%) | 0 | 2,012 ms |

Jev never escalated to particle-1, as its empty band set. Mean hook time per session was 6.5 s against 38.2 s on Opus, 4.6 s against 29.6 s on Sol and 7.8 s against 48.0 s on particle-1. Live, Jev answered in about 360 ms, against a 54 ms median in the replay; the live calls went through the task container's metering proxy. Beside it, descriptive: judge-jev minus verify-hook pass -1.7 points (-6.6 to +3.1) and judge-p1 minus verify-hook 0.0 (-5.4 to +5.9), over 180 pairs.

### The replay (Stage 2), held items

| Point | Labels | Jev cascade | particle-1 alone | gstack's deterministic version | Admission |
|---|---|---|---|---|---|
| Route (skill routing per prompt) | kappa 0.188 between the two labelers, under 0.6 | balanced accuracy 0.710 | 0.753 | 0.376 | NO READ |
| Done (claim of done at Stop) | the hidden tests, 252 held items | 0.510 (no escalation: same as Jev alone) | 0.456 | 0.424 | NOT BEATEN: Jev minus deterministic +0.086 (-0.017 to +0.186) |
| Risky (each Bash command) | kappa 0.778, 276 held items | 0.960, false deny 7.9% (no escalation: same as Jev alone) | 0.940, false deny 12.1% | 0.639, false deny 0.0% | ADMITTED: Jev minus deterministic +0.322 (+0.243 to +0.395) |

The full table, with calibration error, Brier score, latency and cost per 1,000 decisions, is in replay-report.md. The reliability plots for the done and risky points are attached.

The done point's inputs came from the same scorer code as H1's, so the colour defect reached them. Recomputing each Stage 1 session's done inputs from its transcript, with no new backend call, 38 of the 480 items showed the backends "no check" where a check had run, and the hidden tests pass on all 38. 2 more items showed a different check. At 3d5dcce all 480 recompute to the stored items byte for byte (done-items.txt).

| Done point | As run | Corrected |
|---|---|---|
| Reading | NOT BEATEN | NOT BEATEN on the inputs as built; 40 of 480 items had wrong inputs, and the backends were never asked about the corrected ones |
| End state | CUT-CANDIDATE for a done-claim judgment hook | FIX-METHOD (method) |

Stage 3's pilot passed all three checks: risky hooks logged 1,963 of 1,966 Bash calls (99.8%), 1 of 1,126 judgment calls failed open, and live escalation was 0%, the same as the replay.

## Why null? (R48)

| Line | Exposure | Task fit | Power | Frontier without the part | End state |
|---|---|---|---|---|---|
| H1, hook against prose | /verify loaded 100%; contract record 95% to 100%; the hook blocked 22 of 600 | every session edited, bar one particle-1 prose session | MDD 3.4 points at discordance 0.088, 599 pairs | none ran the rule in 81.4%, 86.0% and 91.5%; verify-prose in 96.0%, 89.0% and 97.5% | FIX-METHOD (saturation) on Opus and particle-1. The model already follows the rule from /verify's prose in nearly every session, so the hook has little to enforce. CUT-CANDIDATE for the hook on Sol, which wasn't saturated: Sol's own line is +2.0 (-3.1 to +7.5), MDD 7.1. |
| /verify against none, pass (secondary) | as above | as above | MDD 3.1 | none passed 60.5%, 57.5% and 61.0% | Descriptive, no verdict: +1.5 points (-0.7 to +3.6) |
| Done-claim judgment hook | never ran live | the done items had wrong inputs on 40 of 480 | about 20 held tasks, clustered | gstack's deterministic version 0.424 | FIX-METHOD (method) |
| Route judgment hook | replay only | gstack never routes a prompt that starts with /verify | | | FIX-METHOD (labels): the labelers agreed at kappa 0.188 |

**R61, owed and not run.** Section 17's one attempt to raise the ceiling would rerun verify-prose and verify-hook for Opus and particle-1 on L1's 37-task Terminal-Bench 2 twin set, after a 10-task headroom check at the same 90% bar. It would decide whether the hook adds anything where the prose rule has room. If the headroom check finds room and the hook raises adherence there without costing passes, gstack has a case to switch contracts on for rules with an edit loop on that kind of task. If the check is saturated too, the conclusion stands that these models follow this rule from prose, and the hook stays off by default. It runs only as its own item, with a cap and a named decision.

## Run disclosures

None of these changes a cap, an arm, a draw or a verdict rule. Item 1 changes the scorer and, through it, two end states.

1. **Deviation S4-2: the scorer counted no coloured pytest summary. Fixed after the data.** The scorer's pytest regex needed a word boundary before the count. pytest prints its summary in colour in some repositories, and the colour code ends in a letter right before the count (ESC[1m57 passed), so there was no word boundary and the summary showed no outcome. Section 13's outcome rule as written counts "a pytest summary with passed, failed or error", so the fix lets the count follow an ANSI colour code, and a line holding "1m57 passed" with no colour code still doesn't count. It changed 169 of the 2,760 counted Stage 4 sessions from no rule run to a rule run, spread across all arms (5 to 16 per arm and model), and 38 Stage 1 sessions. None of the 3 infrastructure rows that were rerun changed. No pass, claim or false-done value changed. It was found while reading why the hook recorded "met" in sessions the scorer read as non-adherent, after every verdict at 3d5dcce had printed. The fix doesn't depend on which way any verdict lands: it counts a line the written rule already counts, in every arm the same way. Both readings are printed above.
2. **Deviation S4-1: two Sol parts relaunched after a silent quota skip.** Sol's parts s4-8 and s4-9 never started: the Ubicloud project was at its vCPU quota (536 of 512 in use across several crews), the part VM create was refused, and the launcher at 3d5dcce recorded a part that never started only when a created VM never reached running. So both parts looked finished with no sessions, and nothing flagged the 160 missing Sol sessions until every item had finished. The relaunch, ruled before any Sol arm contrast was read, ran the same code, tasks, arms and caps under new prefixes, with a quota wait and a planned-count check added outside the pinned launcher. Both parts ran in full (80 sessions each), and no Sol cell is missing.
3. **A 7-hour hold on Sol.** From 15:21 to 22:14 UTC on 2026-11-14 the Sol sequence stood still: the host's attach output printed its next step in the middle of a line, and the sequencer read it only at the start of one. No session was affected, and the sequencer now reads it anywhere in the line.
4. **One Sol cell ran twice.** py-pdf__pdfly-219 in Sol's none arm was hit by a ledger outage, relaunched, and then rerun again as attempt 2 because the attempt-2 check still saw the outage row. The relaunch session counts and the attempt 2 is a stray, a rule set before its result was read. Both scored 1.0.
5. **particle-1's 429s.** OpenRouter answered 429 to a rising share of particle-1's session requests: s4-4 58 of 3,704 (1.6%), s4-8 395 of 4,189 (9.4%), s4-9 438 of 4,191 (10.5%) and s4-10 520 of 4,648 (11.2%), and none on the other six parts. Those parts made no judge calls. Sessions on them that ended badly: 5, 3, 3 and 7.
6. **Sol's per-session allowance went from $6 to $10 for Stage 4,** before any Stage 4 data. In the judge pilot one Sol session hit the $6 allowance because the proxy bounds OpenRouter input by body bytes, and that bound ran 6.3 times over the session's real context. No Stage 4 session hit its allowance; the dearest Sol session spent $3.78.
7. **OpenAI zero data retention.** On 2026-11-14 the shared OpenAI key began refusing chained Responses calls. A check of this run's proxy journals found no chained call: Sol's sessions ran through OpenRouter in Claude Code, and each picker and judge request is a single call.
8. **Infra rows.** Three sessions (Sol pdfly-219 none; particle-1 optuna-6428 none and sphinx-autodoc-typehints-607 plain-2) ended on infrastructure errors and were rerun once as section 13 allows. The graded reruns count.
9. **STATUS lines.** particle-1 dropped the STATUS line in 9 to 11 of 200 sessions per arm; Opus and Sol in at most 2. Leaving those sessions out moves false done by at most 0.9 points on any of the four 200-session arms, and by 2.8 points on particle-1's judge-p1 arm, which has 60 sessions (counts.txt).
10. **The judge-arm secondaries print INCOMPLETE.** The analysis counts the 140 tasks per model that the judge arms never ran as missing pairs against verify-hook and none. The 180 pairs those lines read are complete.

## Cost

Dollar figures are in Agent notes. As ratios: /verify cost 1.61 times a plain session on Opus, 0.94 times on Sol and 1.21 times on particle-1. Best-of-2 cost 2.07, 2.15 and 2.61 times one plain attempt; the picker call was 2.7%, 7.4% and 25.4% of that. Jev's hook time was 0.163 times particle-1's.

## Limits and threats

- **One rule, one skill, one task type.** The hook may matter more inside a long procedure such as /review, where an earlier eval saw it fire in 42 of 66 sessions, or on tasks without a ready test runner.
- **Two identical plain arms differed on Opus.** none and plain-2 run the same image and prompt, yet on Opus plain-2 passed 66.0% and none 60.5%: 13 tasks where only plain-2 passed against 2 where only none did (two-sided sign test p 0.007, one of many comparisons and not preregistered). Sol (5 and 1) and particle-1 (9 and 10) show no such gap. We found no difference between the arms' setups. Opus's per-model lines against none carry this.
- **The scorer defect came first from our own code.** Section 13's fixtures held no coloured output, so the dry run passed. The fix touches two regexes; any other reader of test output in this repository may share the blind spot.
- **The done replay was not rescored.** Its corrected end state rests on the count of items with wrong inputs, not on new backend answers.
- **The risky hook's live denials are unlabelled.** 12% to 22% of judged commands were denied. Passes didn't measurably drop, but we can't say how many denials were right.
- **Jev ran alone in practice.** The tuned acting band was empty, so the cascade never handed a call to particle-1. H3 reads Jev at its threshold against particle-1.
- **Power.** A pooled pass effect under about 3 to 3.5 points, a per-model one under about 5 to 7, or a pooled adherence effect under 3.4 reads "no measurable difference".
- **Mostly Python libraries.** SWE-rebench tasks are mostly Python repositories with their own test suites.

## Replicate it

Reanalysis is keyless from a checkout with bun install, given the trial dirs (not public: they hold transcripts). The commands as this post ran them, where HM is the run's work dir (it holds the trial dirs, picks and replay items):

    ROOT=<checkout at 3d5dcce or this post's head> HM=<work dir> bun rebuild.ts <out dir>   (both run tables; rebuild.ts.txt)
    bun lanes/harness-mechanics/cli.ts report <out dir>/stage4.table.jsonl <config> <report dir>
        config at 3d5dcce: {"stage1": <stored Stage 1 admission.json>, "h3_admission": <the replay's>, "drop_step": 0}
        config at the head: {"stage1_table": "<out dir>/stage1.table.jsonl", "h3_admission": <the replay's>, "drop_step": 0}
    HM=<work dir> python3 counts.py <out dir>/stage4.table.jsonl                  (counts.txt; counts.py.txt)
    ROOT=<checkout> HM=<work dir> bun done-count.ts                               (done-items.txt; done-count.ts.txt)

report-3d5dcce.md and report-head.md are the two reports these printed. At 3d5dcce, the stored Stage 1 admission and one recomputed from the Stage 1 table give a byte-identical report.json. The record leaves out the paid launches, which need the ledger, Ubicloud and the provider keys, and the best-of-2 picks, which this post reads from each item's picks.jsonl.

The plain-2 lines in H2 were recounted after the final review: apply recount.patch.txt to lanes/harness-mechanics/analyze.ts at this post's head with git apply, rerun the report command with the head config, and read the H2 secondary RECOUNT lines (recount.txt). Every other line of that report is identical to report-head.md.

## What is held out, and why

Nothing is sealed. The tasks are public and listed in the preregistration bundle. The trial dirs, picks and ledgers stay in the Captain's drive because they hold transcripts and repository code. digests.txt lists the sha256 of both run tables at both codes and of every final ledger.

## Attribution

SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0; each task repository keeps its own licence. Harbor is Apache-2.0, and gstack is MIT. Jev is TypeSafe AI's model, reached through TypeSafe's API. Sol and particle-1 were reached through OpenRouter.

## Changelog

- 2026-11-15: first version.
- 2026-11-15, after the final review: the best-of-2 headline now compares best-of-2 with both single plain attempts and names Opus's none arm as the source of the +2.0; Sol's H1 end state (CUT-CANDIDATE) is stated with its own interval and MDD; the Stage 4 spend line separates $917.13 of model spend from $7.90 of machines; the scorer-fix count reads 169 of the 2,760 counted sessions. The recount is attached.

<details>
<summary>Agent notes</summary>

**Code and records.** Every paid session and pick ran from 3d5dcce. The run record is handoffs/GEVA-503/stage4-run-record.md in the Captain's drive, with Deviations S4-1 and S4-2, the relaunch, the picks and the settled totals. The Captain ruled S4-1 (option A1, before any Sol arm contrast was read), the stray-cell rule, and S4-2 (A1, B1 and C1 on 2026-11-15: show both readings side by side, fix the regex with a test both ways, recompute the corrected table from the raw logs at the results head, R61 owed and not run, the done point's exact count).

**Money, settled.**

| Item | Settled | Cap |
|---|---|---|
| Stages 1 to 3 (every item) | $264.43 | each item's own |
| vms | $7.50 | closed at its settled amount |
| stage4-opus | $369.53 | $560 |
| stage4-sol | $422.48 | $690 |
| stage4-p1 | $133.02 | $310 |
| Paid runs and machines | $1,196.96 | |
| Crew agent use, at about $1 per 1,000 credits, read 2026-11-15 | $850.47 | $400 in section 22; $1,050 as a recorded deviation |
| All-in so far | $2,047.43 | the $3,000 line |

Stage 4 includes the picker calls ($30.91: $3.07 for GPT-6.1 Sol picking for Opus, $14.32 and $13.52 for Opus 5.5 picking for Sol and particle-1), the best-of-2 listing VM ($1.75, in equal shares) and the three hosts ($6.15). The Stage 4 caps were re-priced at measured rates before launch (the preregistration expected $1,223 of Stage 4 model spend and the re-pricing $955; Stage 4 settled at $925.03, which includes the $7.90 of listing VM and hosts above, so its model spend was $917.13), and Sol's per-session allowance went from $6 to $10 (Run disclosures item 6).

**The crew overrun, plainly.** Section 22 expected the crew at $260 with a $400 cap. It is at $850.47, $450.47 over the cap and 2.1 times it, and this thread is $677.53 of that (about 2.1B tokens). It went on the D1 to D14 build fixes, four Stage 3 pilots (two stopped, one on the wrong build), the six-step fix-check chain on #300, the Stage 4 sequencing and watching, and this results stage. The preregistration expected $1,894 all-in; the run is about $150 over that, all of it crew.

**What went wrong in how we ran it.**
- The silent quota skip (S4-1): the launcher at 3d5dcce marks a part that never started only when a created VM never reaches running, so a refused create left no marker; the sequencer's rules had no check for a part with fewer sessions than planned; and the watcher saw "sessions 0" at 02:56 UTC and reported it only at about 05:00 UTC, when every item had finished. The relaunch kept Sol running about 5 hours longer, to 10:03 UTC, a 76-minute quota wait included.
- The 7-hour hold: the sequencer parsed its next step only at the start of a line, and the watcher didn't report the hold until about 22:00 UTC, so Sol's host sat for 7 hours.
- The scorer defect (S4-2): our fixtures held no coloured output, the dry run passed, and the build's review rounds didn't catch it. It surfaced only at analysis.
- The best-of-2 listing VM's first loop called a module that prints nothing; 18 tasks of VM time were thrown away before the rerun through the CLI.

**Counter at writing:** 677.5k credits.


</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

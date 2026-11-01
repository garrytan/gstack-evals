---
id: 2026-11-01-geva-115-planning-ceo-v2-admission-prereg
kind: plan
title: "CEO panel v2 admission pilot: preregistration"
summary: "Freezes one experiment before any paid call: plain Opus 5.5, gstack and forced-procedure gstack on 8 units of sealed CEO panel v2, with an admission rule and a procedure gate. No claim about gstack."
author: GEVA-115
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-01
status: open
links:
  - 2026-11-01-geva-102-planning-r1a-pilot-stop
  - 2026-10-31-geva-83-planning-r1a-prereg
  - 2026-10-31-geva-82-planning-r1a-ceo-panel
  - GST-848
  - GST-660
  - GST-618
  - GST-837
attachments:
  - 66a715883610095ed208038a04b1cbc9680ec4c5ecb1c14fedaab3d6b1070bd0  admission.ts.txt
  - 6a2c1d39c709f7d717bb7bb51db2dc71d33ab9f5f3ad576b37f02863a29ebab0  admit-oc.py.txt
  - e7a52848e2fb431e3f6e6867c81aad4116e1ac5b3eab78843b77406b1d88041e  admit-oc.txt
  - d26af28718a95adc7bd1b5707f68972ae9977f76697876f4d3ba3c9669ef0d6f  author-spec.md
  - dfbf30ce43665862f126113f9dff27b89edaa9280b1184c2c87f25d4f2a32014  build-v2.sh.txt
  - 939f8f59c42fd95a4f36145a4d976e3bc01dff4eb9954431ad582177d2de07d2  convert-v2.py.txt
  - 65091069a043c874ac1c7e298667988c3f4f138ae4f0f4ca5d7cce9ffabd2883  dryrun.ts.txt
  - 9ad7cc86a00cd328894480f3be0c75b685686087e27cafe1fffc5c0d49fbbc89  dryrun.txt
  - dfb6ff670256ce25813472edb905ad474638e3678af91bd50d0a91580e3912f3  echo-terms.txt
  - 3804fbed74bcad1fe296805f3cabb606df4a6658e29bc01a54290c199570c8a9  exposure.py.txt
  - d4f56ad49c82e6b8ca9a2ec05b24a641c45e9d158e11c9de65420008b66d4e43  forced-line.txt
  - e2a30bc669fba27b92f476e687abc6590310c9aa48e237c43ece976b5d8fe84c  gen-synth.py.txt
  - cd0a42d036d2b05e44eadadc7211a25937134a42856b30f44dad03af55e34285  judge-brief.md
  - 9491d9b2b1384844ab69c33dc250a753f418cab23765cb511a3808d017294f20  power-grid.sh.txt
  - 594797d6fe89307c000ce5a7030783372cef98bb28b92e9489c5c2564de59220  power-grid.txt
  - cc478b2fd713224fd6f1272eb2472618c29e3ad3530df9d969fc6c7e422d7fc1  seal.py.txt
---

# CEO panel v2 admission pilot: preregistration

R1a's pilot stopped at a ceiling: plain Opus 5.5 flagged all 8 seeded flaws must-fix, and gstack's /plan-ceo-review loaded its skill body on Opus but never ran its procedure (#114). This post freezes the one experiment that comes next. It runs a new sealed panel, CEO panel v2, on a small pilot to answer two questions before anyone pays for a headline round:

1. Is panel v2 hard enough? Plain Opus 5.5 must find between 20% and 60% of its seeded must-fix items, with 80% power for a 20-point gain in a headline-sized round.
2. Does /plan-ceo-review's procedure run on Opus 5.5? Plainly invoked, and when the told line requires it.

The pilot makes no claim about gstack in either direction. Everything below is frozen before any paid call. The Captain records the cap in approvals/ at merge.

## 1. What this round decides

Two dispositions, both printed on one verdict line:

- **Panel:** ADMIT, NOT ADMITTED (ceiling, floor or power) or NO READ (section 5).
- **Procedure:** READY or FIX-METHOD for the forced arm, or NO READ (section 6).

ADMIT and READY let a later preregistration build a headline round on the 36 headline units of panel v2 with the forced arm. Anything else, or any flag, runs one Why-null cycle (section 11) and goes back to the Captain. Nothing here is a claim about whether /plan-ceo-review helps.

## 2. Arms, models and pins

All arms run Opus 5.5 (`claude-opus-5-5`) on the same unit trees, the same tools and the same unprivileged user. Every Claude Code session sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 (the pinned driver does it in every arm) and `--system-prompt <arm>=claude-code-preset`, so each session runs under Claude Code's own system prompt rather than the Agent SDK's stub.

| Arm | Install | Told line before the frozen plan template | Role |
|---|---|---|---|
| none | bare | "Review this plan for problems." | the no-gstack arm; its recall is the admission read |
| gstack | gstack at the pin, whole tree | "/plan-ceo-review Review this plan for problems." | exposure read, procedure not required |
| gstack-forced | the same gstack tree | the forced line (forced-line.txt) | exposure read with the procedure required; the procedure gate |

The forced line, one line in [forced-line.txt](forced-line.txt):

> /plan-ceo-review Run this skill's full procedure before you answer: complete Step 0 (Nuclear Scope Challenge + Mode Selection) and state the mode you choose, then Read sections/review-sections.md and write its Review Sections 1 to 10 in order, plus Section 11 or its skip note, before your findings.

It names the skill's own step and sections and no review mode, so it requires the procedure without adding a lens of its own. The pinned SKILL.md has two "Step 0" headings; the line names the second, the one that runs the review. The dry run checks those headings at the gstack pin.

**Pins.**
- Scorer: gstack-evals main at a5633c6205b735989c9fbe082092947dec9c2f19. It carries #119 (`--system-prompt`, `--max-turns`, GST-837's provenance fix), #123 (GEVA-117's forced plan arm: a `gstack-<suffix>` plan arm and the plan-unit told prefix) and #126 (its guards: a `gstack-<suffix>` arm must carry its own prefix, and a prefix that adds nothing, repeats the ask or has edge whitespace is refused).
- gstack: garrytan/gstack@1ea86923a86129d1f32828b36acfe6f91f17c8e6 (1.92.37.0), the release current at freeze.
- Claude Code CLI 2.1.314, as the scorer pins it.

**Size.** 8 admission units x 2 passes x 3 arms = 48 sessions in one review-units run, `--parallel 3` (one unit per round, its three arms at once), `--timeout 3600`, and the driver's default turn cap of 60 on every arm (section 6).

The frozen command (paths as on the run machine; $SR is the decrypted sealed root, $SRC its combined source clone):

```
bin/gstack-evals review-units --suite $SR/suites/planrev-ceo-v2-admission.json \
  --arms none gstack=garrytan/gstack@1ea86923a86129d1f32828b36acfe6f91f17c8e6 gstack-forced=garrytan/gstack@1ea86923a86129d1f32828b36acfe6f91f17c8e6 \
  --models claude-opus-5-5 --passes 2 --sealed-root $SR --plan ceo --units all \
  --source panel/plans=$SRC --base-branch panel/plans=main \
  --system-prompt none=claude-code-preset --system-prompt gstack=claude-code-preset --system-prompt gstack-forced=claude-code-preset \
  --told-prefix gstack-forced=forced-line.txt --parallel 3 --timeout 3600 \
  --item planning-v2-admission --spend-cap 100 --out ~/.capy/work/planning-v2/admission
```

## 3. Panel v2

### 3.1 Strata and item kinds

Every unit is a small git repo. Its base commit holds context/ (4 to 8 markdown files: goals, metrics, research notes, tickets, constraints, what exists today, and in some units a small src/). Its head commit adds plan.md only. The products are fictional and new. Nothing comes from panel v1, and the authors never saw it.

- **H, hard seeded flaws**, two keyed items per plan of two different kinds. **H-X, cross-section:** the flaw exists only when two parts are read together (two plan sections, or a plan section and a context file), and each reads fine alone. **H-F, false premise stated as fact:** the plan states, in passing and with confidence, something the context contradicts, and its direction depends on it. **H-T, scope trap:** an in-scope item looks small, but the context shows it is large, blocked, irreversible or owned elsewhere.
- **P, premise and scope** (item 3 of R1a's next round), one keyed decision per plan. **P-premise:** the plan solves a problem the context shows is not the real one. **P-size:** the scope is the wrong size for the goal. **P-alt:** a much cheaper path in the context meets the goal.
- **U, under-ambition** (GST-660), one keyed decision per plan. The plan polishes an approach that the context says must be replaced: the incremental plan cannot reach its own stated goal, and a replacement can.
- **Decoys**, one bait each, for the headline's false-alarm gate and not in this pilot. **D-H** looks like an H flaw, **D-P** like a premise or scope problem, **D-U** like under-ambition, and in each the context justifies the choice.

P and U items are keyed by decision: the key states the decision the plan makes, what it should become after a good review, and the evidence. The keyed decision is must-fix on the plan's own terms: left as is, the plan fails its stated goal or wastes most of its effort.

### 3.2 Sizes

| Stratum | Units | Keyed items | Admission draw | Headline (a later round) |
|---|---|---|---|---|
| H | 16 | 32 | 4 units, 8 items | 12 units, 24 items |
| P | 8 | 8 | 2 units, 2 items | 6 units, 6 items |
| U | 8 | 8 | 2 units, 2 items | 6 units, 6 items |
| Decoys | 12 (4 D-H, 4 D-P, 4 D-U) | 12 baits | none | 12 |
| **Total** | **44** | **48 keyed, 12 baits** | **8 units, 12 items** | **24 keyed units (36 items), 12 decoys** |

As sealed: 44 units, all four authors 11 each. By kind: 16 hard, 8 premise, 8 ambition, 12 decoys. By mode: 12 greenfield, 16 added capability, 16 fix. Item kinds: H-X 11, H-F 11, H-T 10; P-premise 3, P-size 3, P-alt 2; U 8; baits D-H 4, D-P 4, D-U 4. Plan sizes across the whole panel: 5,369 to 6,634 bytes.

### 3.3 Authoring, audit and draw

- **Authors:** four openai/gpt-6.1-sol agents, cross-family to the Opus arms as in v1, each on its own fresh machine and blind to gstack, the repo and panel v1 (they ran gstack's install check with `--for none` and nothing else). Each wrote 11 units: 4 H, 2 P, 2 U and one decoy of each type, so every stratum is spread over all four authors. The common brief is attached as [author-spec.md](author-spec.md); each author's assignment table is sealed and only its digest is public (section 3.5).
- **The spec** requires every keyed item to be detectable from the unit tree alone and to change what gets built; no signposting ("assume", "note that", "risk:" next to an item); no CEO-level flaw beyond the keyed ones; no review words and none of the echo terms ([echo-terms.txt](echo-terms.txt), the heading words of the pinned plan-ceo-review and autoplan CEO phase) in any tree file. Authors were told the reviewer reads every file, so each item needs a step that reading alone does not give: combining numbers, dates or facts from different places, a small computation, or a fact deep in a long ticket that undercuts a claim elsewhere.
- **Checks before sealing:** a script (check_units.py) checks layout, sizes, the echo terms and the key schema on every unit. Then two anthropic/claude-opus-5-5 auditors, each on its own fresh machine with no gstack installed, audited 22 units each (authors K and L, M and N) with the key in hand, under a frozen brief (its digest is in section 3.5): per item, detectable from the tree alone, changes what gets built, must-fix on the plan's own terms, keyed to the right heading and kind, no signposting; per hard unit, the two items independent; per unit, no unkeyed problem a careful reviewer would rightly call Critical or High, no echo terms; per decoy, the bait visible, justified and the only near-flaw. The bias guard: never fail an item for being subtle. 43 of 44 units passed on first audit. One failed only the unkeyed-problem check; its author made a one-sentence context edit, and a full re-audit passed it. 44 of 44 pass.
- **No blind difficulty test.** No auditor or other model reviewed a plan without its key to see whether it would catch the flaw. Picking items by the control model's misses would bias the comparison and overstate headroom. This pilot is the only difficulty check.
- **The admission draw** ran after the audit, by script, seed 20261102: one H unit from each of the four authors, then 2 P and 2 U units from four different authors, uniformly among the draws that meet those constraints. The seed selects among sealed unit ids only. Conversion then numbers the units by a permutation drawn from OS randomness and recorded only in the run bundle. The 8 drawn units form the admission suite and never enter the headline suite. Because the draw is random within strata after authoring, the admission units are exchangeable with the headline units.

### 3.4 Custody

As v1 (approvals/2026-10-31-planning-r1a-custody.md): one age bundle to the panel's existing recipient, in handoffs/GEVA-115/sealed/ in the Captain drive with its own CUSTODY.md. Plaintext lived on author and auditor machines only while authoring, and on GEVA-115's machine in /dev/shm while sealing. Every copy was deleted after sealing and checked with `test ! -e`. Every later opening decrypts into /dev/shm and is logged in CUSTODY.md.

### 3.5 Public record

Committed here, and nowhere else: the bundle's and inner tar's sha256, the suites' sha256, counts by stratum, item kind and mode, the panel-wide range of plan sizes, and the digests of the author kit. Never a per-unit row: no unit head, tree digest, byte count, file count or key digest beside any stratum, kind or admission label (the GST-618 lesson). The suites name units only by permuted numbers and by heads that point into sealed repos.

| Record | sha256 |
|---|---|
| Panel bundle ceo-panel-v2.tar.age | f826460c454dbe1fd7a94df7f66a44bc6a9d221e4fd5efa5a93fdbf82ca92148 |
| Panel inner tar | 0d2082947b96196dc447265372ccec463d4eda4e6c0b79665161952d766d7fdc |
| Run bundle planning-v2-run.tar.age (suites, catalogs, source clone, draw and permutation) | 4875e0edc0f71e2f38631575263c62f3e63f2f57249af79b3271cd3983ab61c1 |
| Run inner tar | 53c1309cd18635ccff7194cacf87dd1ead9d1c22b56afda51c1b1ad2d3981a8a |
| Suite planrev-ceo-v2-admission (8 units, 12 must-fix blockers) | 8fa4529de7a838b5b78b224ce76732e78264f7641e9655d72482b10fbc98308a |
| Suite planrev-ceo-v2 (36 units: 36 must-fix blockers in 24 units, 12 bait blockers in 12 decoys) | d8031bda9252816dafc2c72fdf964d1d968d1ac521bf11caea627c8c65846e89 |
| Author brief, common part (attached as author-spec.md) | b228c612b3a5175b6051e2298a446806751b78a97d9e6f11c8f79ab48e363595 |
| Author briefs K, L, M, N (assignment tables, sealed) | 842dfad5d4259fd04aa5b411d0d07cbcf0974e426e6f518c06508bc9b68190e1, 553d6e0674c42b51696f7b644ee7e1e207ba1e7ffa9c3c48afd293e887ce9a3c, 89c266c8cb20ff5f9d5a9fba0a38b88c8f6aaae61bb1929916bd44abc48ffbf3, 9cddc284a8baeb3d256411aec6e5baf943bf77c8867feb0652c198c191235b8a |
| check_units.py (sealed in the kit) | 8d27d758108d36b64fbdc1913a8201b2f1f52582ae15db15f7334342e7c917a0 |
| echo-terms.txt (attached) | dfb6ff670256ce25813472edb905ad474638e3678af91bd50d0a91580e3912f3 |
| Audit brief (sealed in the kit) | 839243e62bb53fd1faaeddfaf708c72708cd1a24bd0238649c86a272caf36173 |

Both bundles are age-encrypted to panel v1's recipient and held in the Captain drive under handoffs/GEVA-115/sealed/ with CUSTODY.md. The suites live only in the run bundle, because each pairs unit heads with blocker lines and the admission label.

## 4. Scoring

**Findings and must-fix.** Unchanged from the pin: each session ends with one plan-findings block (the frozen plan template), parsed by the pinned parser. Critical and High are must-fix. An item's value for an arm is the share of that arm's passes in which some must-fix finding matched it. Must-fix recall is the mean over items. Any-severity recall is a secondary reading.

**What matches an item.** The pinned judging rule stands: a finding matches a blocker when it names the same cause in the same plan section with that section as evidence; a different problem in the same section does not match; the same cause under another heading matches only when its evidence points at the same part of the plan. The judge brief ([judge-brief.md](judge-brief.md)) adds three paragraphs and changes nothing else:

1. **Two-place items (H-X).** The cause names both places. A finding under either heading matches when it names the same conflict between them. A finding about only one of the two places, without the conflict, does not match.
2. **False facts and traps (H-F, H-T).** The finding must state the fact, from the context or the plan, that makes the claim false or shows the item's real size or owner. A general doubt ("the timeline looks optimistic", "this assumes X without evidence") does not match.
3. **Decision items (P, U), under any heading.** A finding matches when it says the keyed decision is wrong for the reason the key gives, citing that evidence or the fact it shows, and calls for changing, stopping or re-scoping that decision. It need not prescribe the keyed remedy; "stop and validate the real cause before building" with the keyed diagnosis matches. A call for more research without the diagnosis does not. For U, the change must be a change of approach, not more tuning of the same system.

Each item's cause text carries what the judge needs (both places for H-X; the decision and what it should become for P and U), so the judges read it from the packet like any other cause.

**Failure scoring.** The pin's rules from #101, #106 (GST-737) and #107 (GST-748), as R1a froze them: a session the arm's own failure ends after model output is a miss; one that ends before any model output, or on any infrastructure failure, is a coverage gap, and a gap stops the arm with E_COVERAGE_GAP. Exit-137 sessions are counted per arm.

**No resume.** A gap in a none session makes the panel read NO READ. A gap in a gstack or gstack-forced session voids only that arm's exposure read. Either way the round goes back to the Captain, who may record a new run item for a full rerun at a new out dir by amendment.

## 5. The admission rule

Read only after the run and judging complete, with judging coverage complete. The decision is computed by [admission.ts](admission.ts.txt) from the pinned scorer's own readings.

- **R** = none's must-fix recall on the 12 admission items over its 2 passes, from `noloss secondary`, the reading R1a's stop (a) used.
- **Power** = the pinned simulator's power for a 20-point gain over R in the headline design: `noloss power --clusters 2,2,2,2,2,2,2,2,2,2,2,2,1,1,1,1,1,1,1,1,1,1,1,1 --passes 3 --margin 10 --loss 20 --recall <R + 0.20> --alpha 0.025 --dependence 0.3 --sims 2000 --seed 1`. The simulator takes the reference's rate (here gstack's, R + 0.20) as --recall and puts the variant 20 points below it, so this is the gain a headline would test. 0.025 is a two-comparison Holm family's strictest step. Dependence 0 and 0.6 print beside it and decide nothing.

| Panel disposition | Rule |
|---|---|
| **ADMIT** | 0.2 <= R <= 0.6 and Power >= 0.80 |
| **NOT ADMITTED, ceiling** | R > 0.6 |
| **NOT ADMITTED, floor** | R < 0.2 |
| **NOT ADMITTED, power** | R in the band and Power < 0.80 (unreachable on this design: R reads in steps of 1/24, and the lowest power at any readable R in the band is 0.836, at R = 9/24) |
| **NO READ** | a gap in a none session; a none session with no parsed plan-findings block (it would score as a miss and understate R); judging coverage incomplete; the system-prompt check fails (section 6); or a cap stop |

**Flags**, printed with every verdict. Each decides no admission; each triggers the Why-null cycle and goes to the headline prereg as a condition it must address.
- **F1, severity-limited:** none's any-severity recall is above 0.6, so most of the room under R is severity, not finding.
- **F2, dead items:** 4 or more of the 12 items were matched at no severity in any of the 48 sessions.
- **F3, saturated or empty stratum:** a stratum's none recall is 0 or 1, or H's is above 0.85 (R1a's stop (a) level).

Per-stratum recall (H, P, U) for every arm prints beside the verdict, labelled descriptive (8 units).

## 6. The procedure gate and the exposure read

A frozen script, [exposure.py](exposure.py.txt), reads each session's transcript.ndjson and init.json for all three arms; none is the negative control.

- **Read the sections file:** some tool call is a Read whose file_path ends in plan-ceo-review/sections/review-sections.md, or a Bash command that runs cat, sed, head, tail or awk on a path ending in review-sections.md while the command names plan-ceo-review; and its result is not an error and carries at least 1,000 characters. Other skills' review-sections.md files do not count.
- **Named a mode:** an assistant text block names exactly one of SCOPE EXPANSION, SELECTIVE EXPANSION, HOLD SCOPE and SCOPE REDUCTION (a quoted list of all four does not count), or the pin's mode handoff line names a mode.
- **Exposed** (the Captain's definition): read the sections file and named a mode.
- **Ran the procedure:** exposed, and the assistant text after the sections file was read carries Review Sections 1 to 10 as heading-like lines (a markdown heading, a fully bold line, or a line opening with "Section <n>"), each found by its number or its title words from the pinned file and followed by at least 150 characters before the next, such that the longest run of them whose first appearances are in increasing order holds at least 9. One swapped pair still passes; a reversed order fails.
- **Rates** per arm over its 16 scheduled sessions; a session with no transcript counts as neither. The forced arm's rates are read only when the arm has no gap.
- **Procedure disposition:** READY when gstack-forced ran the procedure in at least 15 of 16 sessions; FIX-METHOD otherwise (its told line or the harness does not make the procedure run, and a headline cannot use the arm as written); NO READ when the arm has a gap.
- **gstack (not told to run it):** its exposed and ran-the-procedure rates are measurements with no threshold. R1a read 0 of 4 under the stub system prompt.
- **Turn-cap stops.** At the pin, a session that the turn cap ends is recorded as completed and scored as a miss on plan units, with nothing marking the cap stop. The Captain ruled that every arm runs 100 turns only on a pin that records a cap stop as its own termination kind (GEVA-122's fix), and otherwise the driver's default of 60. This pin lacks that fix, so every arm runs 60. exposure.py counts cap stops per arm from each transcript's final result (subtype error_max_turns), and they print on the verdict line beside the exposure rates. A none session ended by the cap with no findings block is NO READ (section 5). A forced session ended by the cap counts as not having run the procedure, and a FIX-METHOD with any cap stops names the cap as a cause, so a later round can tell a cap problem from a procedure that does not run.
- **Recorded per session, deciding nothing:** first-request prompt tokens; gstack helper commands run; Agent or Task tool calls (gstack's outside voice falls back to a Claude subagent when codex is absent); turns used; whether the turn cap or the timeout ended it; session cost.
- **System-prompt check:** every init.json records claude-code-preset, and, because that record shows the option passed rather than what the SDK sent, every none session's first-request prompt tokens (input plus cache read plus cache write on the first assistant message) are at least 21,300. GEVA-109 measured the preset block at 1,926 tokens on CLI 2.1.314, and R1a's none-opus sessions under the stub prompt read a median 20,345 on the same template, so a session without the preset sits near 20,345 and one with it near 22,270. A failure of either part is NO READ.

Every verdict line prints both dispositions and the exposure rates, for example: "Panel: ADMIT (none R = 0.42, Power 0.85; flags none). Procedure: READY (gstack-forced ran it 15/16, exposed 16/16; gstack exposed 3/16). System prompt: claude-code-preset 48/48, none first-request floor 16/16. Turn-cap stops: none 0, gstack 0, gstack-forced 0."

## 7. Judging

As R1a, with judge brief v2 ([judge-brief.md](judge-brief.md)): openai/gpt-6.1-sol first; anthropic/claude-opus-5-5 second on every arm disagreement plus a seeded 20% sample (judge-join); anthropic/claude-sonnet-5-5 third where the first two differ. Blind packets from `noloss judge-packet`, seed 20261102. Blind adjudication of unmatched must-fix findings, seed 20261103, read per arm as not-defect must-fix findings per plan per pass; it sizes the headline's false-alarm gate and decides nothing here. One judge item per judge-run call, in order planning-v2-judge-match, planning-v2-judge-second, planning-v2-judge-third and planning-v2-judge-adjudicate, each recorded at $20 less the settled spend of every earlier one (a call that is not needed records no item). The primary judge shares the authors' family (GPT); the second judge shares the arms' family.

## 8. Power and operating characteristics

[power-grid.txt](power-grid.txt) holds the runs. Headline power for the gain (none at R, gstack at R + 0.20; clusters 2 x 12 and 1 x 12; 3 passes; alpha 0.025; 2,000 sims, seed 1), at dependence 0 / 0.3 / 0.6:

| R | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 |
|---|---|---|---|---|---|
| Power | 91 / 90 / 88% | 87 / 85 / 83% | 86 / 85 / 81% | 87 / 85 / 83% | 90 / 91 / 87% |

**What ADMIT does not show.** The power figure assumes the simulator's effect model: item rates spread as a beta, the gain spread over items. A gain confined to one stratum is weaker. At dependence 0.3, a 20-point gain inside H alone (12 plans of 2 items) has 59% to 67% power, and inside P and U alone (12 single-item plans) 27% to 33%. The exact sign-flip test cannot reach alpha 0.025 with a gain in fewer than 6 plans. So ADMIT is a difficulty screen plus power under that model, not proof that any 20-point gain is detectable. A headline that wants a per-stratum claim on P or U needs more of those units. These stratum-only rows print beside the verdict.

**How often the band admits** ([admit-oc.txt](admit-oc.txt); 8 plans, 12 items, 2 passes; beta-spread item rates, dependence 0.3; 20,000 simulated pilots per row):

| True plain recall | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 |
|---|---|---|---|---|---|---|---|---|
| Admitted | 12% | 53% | 85% | 93% | 81% | 51% | 19% | 3% |

So the band admits a 0.7 panel about one time in five. The headline keeps its own ceiling stop.

## 9. Cost and cap

R1a's pilot metered none-opus at $0.113 and gstack-opus at $0.199 a session under the stub prompt, and gstack on Fable at three times plain Fable. Panel v2's plans and contexts are up to about twice v1's size, and the claude_code preset adds about 1.9k tokens a request. The forced arm has never been metered: it reads SKILL.md, the preamble and the 1,172-line review-sections.md, writes ten or eleven sections, and may start an outside-voice subagent. No keyless way meters it, and a paid smoke before this prereg is not allowed.

| Item | Sessions or calls | Projection | Cap |
|---|---|---|---|
| planning-v2-admission (the run) | 16 none at $0.17, 16 gstack at $0.30, 16 forced at $2.50 (a conservative guess) | $47.52 | $100 |
| judge items, one per judge-run call | match, second, third, adjudication | about $6 | $20 envelope |
| **Total** | | **about $54** | **$120** |

- **Start rule.** review-units admits each round at its worst case at the allowance, $7.04 (1,600k input and 32k output tokens under the default policy) per Opus session at the pin, so a round of 3 sessions needs $21.12 in hand, and the last round starts only while spend so far is at most the item cap less $21.12. The 16th round starts while 15 rounds' spend is at most $78.88, so with none at $0.17 and gstack at $0.30 the $100 item finishes the run while gstack-forced averages up to $4.78 a session (the dry run checks $4.78 finishes and $4.79 stops before the last round).
- **Judge items.** Each judge-run call takes its own item, recorded at $20 less the settled spend of every earlier judge item, so the judge items never pass the envelope.
- A cap stop is NO READ and is never retried to change a verdict.

## 10. Run rules

- Order: this prereg merges; the Captain records the cap in approvals/; the pilot runs; judging; readings; verdict; a results post through the Captain's queue. Preregistration and results never share a PR.
- Pin check before every review-units and judge-run call: the scorer at a5633c6205b735989c9fbe082092947dec9c2f19 with no tracked change, logged.
- Machine: at least 32 GB of memory at `--parallel 3`; vCPU, memory and `--parallel` recorded beside the out dir.
- Run root ~/.capy/work/planning-v2, outside the repo and every drive; `<stateRoot>/retained` absent before the first session. After the last read, the run root and the retained unit trees are sealed to the panel recipient and the plaintext deleted and checked gone.
- Custody and wall clock: the run material is decrypted into /dev/shm. 16 rounds, each as slow as its forced session, can take hours, so review-units runs as a watched background operation (under 6 hours) on the machine of the agent that waits on it. On every wake, check /dev/shm and ~/.capy/work for leftover decrypted files before anything else.
- The approval record is the Captain's; spend goes only through the ledger, item by item, as the pinned entry points lease it. Every item is recorded with `--admission warn`, as R1a's were: a required admission needs a fresh rig admit record per item slot, written on the spending machine for the exact checkout tree, and nobody has admitted this pin. The pin check stands in, and each lease warns RIG_UNPROVEN and opens.

## 11. Why null (R48), planned now

If the panel disposition is not ADMIT, or the procedure disposition is not READY, or any flag is raised, the results post runs one Why-null cycle and ends in KEEP, FIX-METHOD or CUT-CANDIDATE:
- Exposure: gstack and gstack-forced exposure rates, and the system-prompt record.
- Task fit: per-stratum recall, and which item kinds plain Opus found.
- Power, floor or ceiling: R against the band, with its interval and the headline power.
- Frontier without the skill: what none did on each stratum.

A ceiling on H with room on P or U, or the reverse, is reported as such, with the recommendation to rebuild only the saturated stratum.

## 12. Not claimed, and limits

- No claim about gstack's CEO review in either direction: 8 units, 2 passes, no comparison test.
- Seeded flaws are not natural flaws. One model family (GPT) wrote the panel and the primary judge shares it; the auditors, the second judge and this author share the arms' family.
- P and U are home field for /plan-ceo-review by design (its Step 0 targets premise and scope), so a later headline must report recall per stratum and never pool a home-field win into a general claim.
- The forced arm measures the procedure when told to run it. It has no matched "forced words without the skill" control; a later headline could add one.
- R54 names GPT-6.1 Sol as a frontier model under test. This pilot leaves it out: review-units at the pin runs every arm in Claude Code and accepts only a model with an anthropic or openrouter route in the policy (src/trial/review/cli.ts), and Sol's route in the default policy is openai.

## 13. Before freezing: the attack record

The plan behind this post was attacked by two blind reviewers before any authoring or code: openai/gpt-6.1-sol (cross-family, about 0.9M tokens) and anthropic/claude-opus-5-5 (about 4.3M). They tested whether the admission rule can admit a panel with no room or refuse one with room, whether the match rules let a vague finding score or fail a correct one, whether exposure can count a session that did not run the procedure, whether the authoring spec makes items easy or unfair, whether any public value leaks a stratum or admission label, and whether the cap arithmetic is right.

| Finding | Reviewer | Disposition |
|---|---|---|
| The power command simulated a loss at R, not a gain from R; and "2x12,1x12" is not a valid --clusters value | both | Fixed: --recall R + 0.20, explicit list; grid recomputed (81% to 91%) |
| Pooled recall cannot show power for concentrated gains | GPT | Fixed as a stated limit: stratum-only power rows and the 6-plan floor of the sign-flip test print beside the verdict |
| Exposure can pass on a failed read, a quoted mode list or bare compliance | both | Fixed: successful content read, path rules, exactly-one-mode rule, and a separate "ran the procedure" test for the forced arm's gate, with fixtures |
| P and U matching failed correct diagnoses ("stop and validate"), and required one heading | both | Fixed: diagnosis plus a call to change, stop or re-scope, under any heading |
| H-F and H-T could match vague hedges | Opus | Fixed: the finding must state the contradicting fact |
| A forced-arm failure could escape the Why-null cycle | GPT | Fixed: two dispositions, both printed; Why-null on either failing or any flag |
| U modes contradicted the all-modes rule | GPT | Fixed: U is 4 added capability and 4 fix |
| Low R can come from dead items, Medium ratings or parse failures | Opus | Fixed in part: a none session with no findings block is NO READ; F1 and F2 are flags, not gates, because the Captain froze the band as the admission rule |
| ADMIT can hide a saturated stratum | Opus | Fixed: F3 under every verdict |
| The system-prompt record is the option passed, not what was sent | Opus | Fixed: first-request token floor for none sessions, checked against R1a's real stub-prompt sessions in the dry run |
| The authoring spec aimed at a skimmer, while the plain reviewer reads everything | Opus | Fixed: each item needs an inference step beyond reading |
| A $50 run item is too small for an unmetered forced arm | Opus | Fixed: forced projected at $2.50, run item $100, cap $120 |
| One foreground program cannot hold the run's wall clock | Opus | Fixed: a watched background operation on the waiting agent's machine, /dev/shm, a leftover check on every wake |
| The forced line named the wrong Step 0 and all 11 sections | Opus | Fixed: it names Step 0 (Nuclear Scope Challenge + Mode Selection), Sections 1 to 10 plus Section 11 or its skip note |
| A gap in a gstack arm voided the whole read | Opus | Fixed: it voids only that arm's exposure read |
| The draw could take all H units from one author | Opus | Fixed: one H per author; P and U from four different authors |
| Public draw seed | Opus | Kept public (it selects among sealed ids only); the conversion permutation is OS-random and sealed |
| Start-rule arithmetic, the H-X rule, the post-audit draw, no blind difficulty test, no public label leak | both | Sound as written |

**Departures from the plan's text, all before any paid call.**
- The plan set `--max-turns 100` on every arm. On the Captain's ruling (the pin scores a cap stop as a completed miss), every arm runs the driver's default of 60 instead, because the pin lacks GEVA-122's termination-kind fix; cap stops are counted per arm and a forced cap stop counts as not running the procedure (section 6).
- The dry run found and fixed four bugs in the plan's draft scripts: admission.ts compared judgment rows by the wrong id and so would have read R = 0 (it now maps rows through the pinned suite, and its R equals `noloss secondary` exactly); a missing or duplicate judgment row now reads NO READ; exposure.py never read the mode handoff file (wrong column); and a Bash read of another skill's review-sections.md through a relative path counted as reading this one.
- "Ran the procedure" is the longest increasing run of first appearances, as the script computes it; the plan said "first appearances in increasing order".
- /ship's review of this post (one outside voice, GPT-6.1 Sol) found three places where the attached scripts did not do what sections 5 and 6 say, and each now does: exposure.py counted a forced session that the turn cap ended as having run the procedure; exposure.py let repeated headings into the ordered run instead of each section's first appearance; and admission.ts did not read NO READ when a treatment arm had no judgments file. dryrun.ts gained a check for each, and the final dry run was rerun under custody.
- The judge items are named, and the power row of the admission table is marked unreachable.
- The plan pinned the scorer to GEVA-117's merge commit. On the Captain's ruling the pin is the main that also carries #126, which fixes #123's /ship Step 11 findings 1, 2 and 4 (open notes on #123), so the frozen run cannot use a no-op or missing prefix.

## 14. Dry run

[dryrun.ts](dryrun.ts.txt) drives every frozen rule through the pinned scorer, keyless, on the sealed panel's real suites with synthetic arms, judges and sessions; [dryrun.txt](dryrun.txt) is its transcript. It checks the pin; loads both suites with and without the sealed root; plans the frozen command (48 sessions, three arms on claude-code-preset, the forced line, the default 60 turns) and its refusals, including #126's guards (every `gstack-<suffix>` arm carries a real prefix that is not a no-op); runs blind packets, three judges, adjudication and ingest; reads R with `noloss secondary` and decides synthetic panels with admission.ts at both edges of the band; runs exposure.py on fixtures and on R1a's real pilot transcripts; and opens and settles a lease for the run item and each judge item on a temporary ledger. It ends with a leak check over every unit head and base.

Results: on a synthetic panel at #119's head e8b9a6b (no forced arm), PASS 102, FAIL 0, with 7 forced-arm checks skipped; on a synthetic panel at GEVA-117's head 8fa576e, PASS 111, FAIL 0; and on the real sealed suites with R1a's real pilot transcripts (opened under custody, logged) at 8fa576e, PASS 113, FAIL 0. The attached transcript is the run at the pin, a5633c6205b735989c9fbe082092947dec9c2f19, on the real sealed suites (opened under custody, logged), and it passed: PASS 127, FAIL 0, SKIP 0. Before #126 merged, a synthetic panel at its head 6986f2a gave PASS 122, FAIL 0, SKIP 0. R1a's real transcripts reproduce #114's exposure reading (gstack-opus read the sections file in 0 of 4 sessions, gstack-fable in 2 of 4), and every R1a none-opus session falls below the 21,300 floor.

## 15. Files

- [admission.ts.txt](admission.ts.txt): the frozen admission decision (sections 5 and 6), through the pinned scorer.
- [admit-oc.py.txt](admit-oc.py.txt): simulation of how often the band admits a panel at each true plain recall.
- [admit-oc.txt](admit-oc.txt): its output (section 8).
- [author-spec.md](author-spec.md): the common author brief, with its one home path written as ~/ for publication; the per-author assignment tables stay sealed.
- [build-v2.sh.txt](build-v2.sh.txt): builds the run material (suites, source clone) from the sealed panel.
- [convert-v2.py.txt](convert-v2.py.txt): the admission draw (seed 20261102), plan cases and the unit-number permutation.
- [dryrun.ts.txt](dryrun.ts.txt): the keyless dry run (section 14).
- [dryrun.txt](dryrun.txt): its transcript at the pin on the real sealed suites.
- [echo-terms.txt](echo-terms.txt): the frozen echo-term list scanned in every tree file.
- [exposure.py.txt](exposure.py.txt): the procedure gate, exposure read and system-prompt check (section 6).
- [forced-line.txt](forced-line.txt): the forced arm's told line.
- [gen-synth.py.txt](gen-synth.py.txt): the synthetic 44-unit panel the dry run tests on.
- [judge-brief.md](judge-brief.md): judge brief v2 (section 4).
- [power-grid.sh.txt](power-grid.sh.txt): the power runs.
- [power-grid.txt](power-grid.txt): their output (section 8).
- [seal.py.txt](seal.py.txt): builds the sealed panel bundle deterministically; this copy renames one local variable (key to key_raw) from the script that built the bundle, so pregate's secrets scan passes, and the logic is unchanged.

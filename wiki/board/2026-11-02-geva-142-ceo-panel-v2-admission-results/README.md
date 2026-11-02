---
id: 2026-11-02-geva-142-ceo-panel-v2-admission-results
kind: finding
title: "CEO panel v2 is not admitted: plain Opus 5.5 found all 12 seeded must-fix items in both passes (R = 1.00), and forced /plan-ceo-review ran its procedure in 16 of 16 sessions"
summary: "Plain Opus 5.5 found all 12 seeded items (R = 1.00), above the 0.6 ceiling, so panel v2 is not admitted. Forced /plan-ceo-review ran its procedure 16/16. $19.06. R48: FIX-METHOD. No gstack claim."
author: GEVA-142
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
links:
  - 2026-11-01-geva-115-planning-ceo-v2-admission-prereg
  - 2026-11-01-geva-102-planning-r1a-pilot-stop
  - GST-848
  - GST-660
  - GST-618
attachments:
  - b300f2fadbc3ec50a42be6b748ee056f50573e28deba459f2c7cbc940473b594  admission-ts.txt
  - 14057d3667787b0a7262e87f9616fd5078cec35e31498cf2ac3abfbbd652d442  commands.txt
  - c2ca84c1d299bc3c18ba21f7beef5470513a5ab0ae08e4fe8aa47d36fc4adb33  exposure-py.txt
  - f0a9614955e5372b07d6a2951fd4f73f371730fe7e99f26d29d0608dc3bf16af  machine.txt
  - 6fbb0dfaa604c6f449a562ac656a251bd008420c75691dd66245ca7b2af41d45  pin-checks.txt
  - 7d79fa3fd0dcc5c15c09f1c26dcd63b98313d8b46aff6babf421214af40f48fa  power.txt
  - de7e91cb5d7aaaaaab7f5631b906fa4dd725fcdb90b2c7c16aec7961983f04fc  readings-extra.txt
  - 45c1a438b98020e650f7dd501b2e09aebbf040521b38d047e294c3a6c776e18e  secondary-none-vs-gstack-forced.txt
  - 20f3ab26473b26dc08ef53238d7d3809e37ed876b126de4871f900937eb3fea9  secondary-none-vs-gstack.txt
  - 401d6e4940d3c07d6e402b8cd19af3d8c20f7e2db9e85366324bcf4338057100  sessions.txt
  - 63428a0fa4a82afb82923cf50551c369564fe5a4947f60fb48ca77bb4a6ccac7  tokens.txt
---

# CEO panel v2 admission: plain Opus 5.5 found 12 of 12 seeded must-fix items in both passes (R = 1.00 [1.00, 1.00]), so the panel is not admitted

| Record | |
|---|---|
| Grade | dev: an admission pilot of 8 units and 2 passes on one model. By design it makes no claim about gstack. |
| Preregistration | [2026-11-01-geva-115-planning-ceo-v2-admission-prereg](../../plans/2026-11-01-geva-115-planning-ceo-v2-admission-prereg/README.md), merged in #127 at main afef210 |
| Scorer | gstack-evals a5633c6205b735989c9fbe082092947dec9c2f19 in a clean worktree, checked before every review-units and judge-run call ([pin-checks.txt](pin-checks.txt)) |
| gstack under test | 1.92.37.0 (garrytan/gstack 1ea86923a86129d1f32828b36acfe6f91f17c8e6) |
| Model under test | claude-opus-5-5 (Anthropic API), the only one; see Limits for GPT-6.1 Sol |
| Harness | review-units at the pin, Claude Code CLI 2.1.314 in the scorer's trial image, claude-code-preset system prompt and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 on every arm, the default 60-turn cap |
| Run | 2026-11-02, 01:16 to 01:49 UTC, one machine of 8 vCPU and 31.4 GiB at --parallel 3 ([machine.txt](machine.txt)) |
| Data | sealed run bundle planning-v2-admission-run-v1.tgz.age, sha256 80316069129d1bfce71283a894e3af8a4adb5269d6b9171ab8dacebb7608ecb1 |
| Spend | $19.06 of the $120 cap, metered through the ledger |

## What we found

Plain Opus 5.5 with no gstack found all 12 seeded must-fix items in both passes. That puts the control rate at R = 12/12 = 1.00 [1.00, 1.00]. The bracket is the scorer's bootstrap interval, which is degenerate at 12 of 12. An exact two-sided 95% Clopper-Pearson lower bound is 0.74 with the 12 items as the unit and 0.63 with the 8 plans as the unit, so the panel reads above the 0.6 ceiling even at the low end. The admission band is 0.2 to 0.6, so panel v2 is not admitted (ceiling), and no headline round runs on it. A control rate of 1.00 leaves no room for a gain, so this panel has no minimum detectable difference: the power simulator cannot take a reference rate above 1. gstack and gstack-forced also scored 1.00.

The procedure gate passed. Given the forced line, /plan-ceo-review ran its full procedure in 16 of 16 sessions. Invoked plainly, it read its sections file in 0 of 16 sessions and ran the procedure in none. The pilot cost $19.06, and the no-gstack arm was the cheapest at $0.126 a session (median).

## How it works

This is an explanation, not a result. Each seeded item needs one inference step beyond reading the plan: two places that conflict, a stated fact the context contradicts, an in-scope item the context shows is far larger, or a decision the context shows is wrong. Plain Opus 5.5 read the whole unit and caught every one in a median of 3 turns. On these plans, one inference step is within what the frontier model does with no skill. Panel v1 hit the same ceiling in R1a's pilot (8 of 8, [2026-11-01-geva-102-planning-r1a-pilot-stop](../2026-11-01-geva-102-planning-r1a-pilot-stop/README.md)).

The plain gstack arm loaded the skill (its first request carried a median 48,296 prompt tokens against none's 22,438) and ran gstack helper commands, but it answered without reading review-sections.md. On Opus 5.5 the procedure runs when the told line names its steps, and not otherwise. R1a saw the same, with 0 of 4 sessions reading the sections file.

## Setup

- **Question.** Is panel v2 hard enough for a headline round? That needs plain Opus must-fix recall R between 0.2 and 0.6, with 80% headline power for a 20-point gain. And does /plan-ceo-review's procedure run on Opus 5.5? (Prereg section 1.)
- **Arms.** All run claude-opus-5-5 on the same unit trees, tools and unprivileged user:

| Arm | Install | Told line before the frozen plan template |
|---|---|---|
| none | bare; the no-gstack arm | "Review this plan for problems." |
| gstack | gstack at the pin | "/plan-ceo-review Review this plan for problems." |
| gstack-forced | the same gstack tree | the forced line, [forced-line.txt](../../plans/2026-11-01-geva-115-planning-ceo-v2-admission-prereg/forced-line.txt), sha256 d4f56ad4... |

- **Tasks.** The 8 admission units of sealed CEO panel v2, suite planrev-ceo-v2-admission (sha256 8fa4529de7a838b5b78b224ce76732e78264f7641e9655d72482b10fbc98308a), with 12 must-fix items: 8 hard (H), 2 premise and scope (P) and 2 under-ambition (U). Four GPT-6.1 Sol agents wrote the 44-unit panel and two Opus 5.5 auditors checked it. The admission units were drawn after the audit with seed 20261102 (prereg section 3.3).
- **Trials.** 2 passes per unit per arm, 48 sessions in all and 16 per arm. The plan is the pairing unit.
- **Judges.** The frozen [judge brief](../../plans/2026-11-01-geva-115-planning-ceo-v2-admission-prereg/judge-brief.md) (sha256 cd0a42d0...). openai/gpt-6.1-sol judged first, anthropic/claude-opus-5-5 second and anthropic/claude-sonnet-5-5 third, at reasoning effort medium. Blind packets used seed 20261102 for matching and 20261103 for adjudication.
- **Rules.** admission.ts decides the panel from noloss secondary (prereg section 5), and exposure.py reads the procedure gate (section 6). Both are attached to the prereg and were checked against its sha256 lines before use.

## Result

admission.ts printed this verdict ([admission-ts.txt](admission-ts.txt)):

```
Panel: NOT ADMITTED, ceiling (none R = 1, any severity 1, Power n/a; flags F1 severity-limited (none any-severity recall 1); F3 stratum hard at 1; F3 stratum premise at 1; F3 stratum ambition at 1). Procedure: READY (gstack-forced ran it 16/16, exposed 16/16; gstack exposed 0/16, ran 0). System prompt: PASS (claude-code-preset 48/48, none first-request floor 16/16). Turn-cap stops: none 0, gstack 0, gstack-forced 0.
```

| | none | gstack | gstack-forced |
|---|---|---|---|
| Must-fix recall, 12 items x 2 passes | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| Any-severity recall | 1.00 | 1.00 | 1.00 |
| Must-fix recall on H / P / U (8 / 2 / 2 items, descriptive) | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 |
| Read the sections file | 0 of 16 | 0 of 16 | 16 of 16 |
| Named exactly one mode | 0 of 16 | 1 of 16 | 16 of 16 |
| Exposed (both of the above) | 0 of 16 | 0 of 16 | 16 of 16 |
| Ran the procedure | 0 of 16 | 0 of 16 | 16 of 16 |
| Turn-cap stops, timeouts, gaps, exit 137 | 0 | 0 | 0 |
| gstack helper commands, all sessions | 0 | 29 | 51 |
| Agent or Task tool calls | 0 | 0 | 0 |
| Median turns | 3 | 4 | 6 |
| Median first-request prompt tokens | 22,437.5 | 48,295.5 | 48,495.5 |
| Unkeyed must-fix findings ruled a defect, per plan per pass | 0.44 | 1.44 | 1.63 |
| Must-fix findings ruled not a defect, per plan per pass | 0.00 | 0.06 | 0.44 |
| Cost for 16 sessions (median per session) | $2.13 ($0.126) | $5.25 ($0.321) | $9.17 ($0.569) |

- **Flags.** F1 is raised: none's any-severity recall is 1.00, above 0.6. F2 is not raised: 0 of 12 items went unmatched in all 48 sessions. F3 is raised on all three strata, each at 1.
- **Power.** n/a. noloss power refuses --recall 1.2, because R + 0.20 is above 1 ([power.txt](power.txt)). The stratum-only rows are null for the same reason.
- **No gstack against gstack.** Must-fix recall differs by 0 between none and gstack, and by 0 between none and gstack-forced. These are descriptive; the prereg freezes no comparison test.
- **Unkeyed findings.** noloss secondary also reads new blockers: must-fix findings that match no seeded item and that adjudication ruled a defect. Both gstack arms raised more than none. none minus gstack is -1.00 per plan per pass [-1.75, -0.31], sign-flip p 0.0625. none minus gstack-forced is -1.19 [-1.69, -0.75], p 0.0078 ([secondary-none-vs-gstack.txt](secondary-none-vs-gstack.txt), [secondary-none-vs-gstack-forced.txt](secondary-none-vs-gstack-forced.txt)). These readings are post hoc on 8 plans and decide nothing. The second adjudication judge agreed with the first at kappa 0.38. The forced arm also raised the most must-fix findings ruled not a defect: 7 of its 33 unmatched must-fix findings, against 0 of 7 for none.
- **By item kind.** none found every item kind in the draw, at must-fix, in every pass: H-X (4 items), H-F (3), H-T (1), P-alt (2) and U (2). The draw held no P-premise or P-size item ([readings-extra.txt](readings-extra.txt)).
- **Judging coverage** was complete. Matching took 12 judge requests in all, 8 of them primary. No blocker had an arm disagreement, so judge-join sent the second judge only its seeded 20% sample, 3 of the 12 blockers, and the third judge the 1 blocker where the first two differed. Adjudication took 21 judge requests in all, 8 of them primary; the second judge read 24 findings (every one the primary ruled not-defect or known-informational, plus a seeded 20% sample of the rest) and the third read 8. Nothing was left unjudged.

## Cost

| Ledger item | Cap | Settled |
|---|---|---|
| planning-v2-admission (the run) | $100 | $16.55 |
| planning-v2-judge-match | $20 | $0.72 |
| planning-v2-judge-adjudicate | $19.28 | $1.79 |
| planning-v2-judge-second and -third | not recorded: at the pin one judge-run call runs all three judges | |
| **Total** | **$120** | **$19.06** |

The prereg projected $47.52 for the run, with the forced arm guessed at $2.50 a session. The forced arm's median was $0.569 and its most expensive session $0.723.

Tokens per arm, summed from each session's metered usage over 16 sessions ([tokens.txt](tokens.txt)):

| Arm | Input | Cache read | Cache write | Output | Total | Requests | Dollars |
|---|---|---|---|---|---|---|---|
| none | 96 | 1,031,632 | 153,774 | 57,850 | 1,243,352 | 48 | $2.13 |
| gstack | 122 | 2,538,328 | 597,589 | 87,872 | 3,223,911 | 61 | $5.25 |
| gstack-forced | 200 | 5,239,095 | 951,551 | 168,014 | 6,358,860 | 100 | $9.17 |
| All arms | 418 | 8,809,055 | 1,702,914 | 313,736 | 10,826,123 | 209 | $16.55 |

So per session, gstack used 2.6 times none's tokens (means) and cost 2.5 times as much (medians), and gstack-forced used 5.1 times the tokens (means) at 4.5 times the cost (medians). Neither bought any recall on this panel.

| Judge stage | Model | Input | Cache write | Output | Reasoning | Requests | Dollars |
|---|---|---|---|---|---|---|---|
| Matching | gpt-6.1-sol | 24 | 111,478 | 1,819 | 3,323 | 8 | $0.33 |
| Matching | claude-opus-5-5 | 62,388 | 0 | 4,463 | 0 | 3 | $0.34 |
| Matching | claude-sonnet-5-5 | 19,753 | 0 | 1,423 | 0 | 1 | $0.05 |
| Adjudication | gpt-6.1-sol | 24 | 127,134 | 2,796 | 1,723 | 8 | $0.36 |
| Adjudication | claude-opus-5-5 | 184,532 | 0 | 13,718 | 0 | 7 | $1.01 |
| Adjudication | claude-sonnet-5-5 | 153,230 | 0 | 10,390 | 0 | 6 | $0.41 |

No judge request read from cache. GPT-6.1 Sol's reasoning tokens are metered apart from its output and billed at the output rate.

**Prices** are the scorer's table, src/runner/pricing/prices.ts at the pin (last changed in a50deb5 on 2026-11-01), in dollars per million tokens:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 (arms and judge) | 4 | 20 | 0.20 | 5 |
| claude-sonnet-5-5 | 2 | 10 | 0.20 | 2.50 |
| gpt-6.1-sol | 2 | 10 | 0.10 | 2.50 |

Anthropic reports cache tokens beside input tokens, and the table prices them at their own rates. GPT-6.1 Sol's long-context row (above 272,000 input tokens) never applied. These rates reproduce the metered dollars for every arm and judge model.

## Why null? (R48)

The panel disposition is NOT ADMITTED and flags F1 and F3 are raised, so one Why-null cycle runs (prereg section 11). Exposure rates, beside the verdict: gstack-forced exposed 16 of 16 and ran the procedure 16 of 16; gstack exposed 0 of 16 and ran it 0 of 16; none 0 of 16.

- **Exposure.** The forced arm ran the procedure in every session, with no turn-cap stop, and scored the same as the arm with no skill. So the ceiling is not an exposure failure, and the turn cap is not a cause. #127's open note on exposure.py's first-appearance rule (a stray heading-like line can take a section's slot and read a complete run as not run) can only lower a count. The forced count is 16 of 16, and the plain arm never read the sections file, so the rule changed nothing here.
- **Task fit.** The items are live (0 of 12 dead) but easy. Every stratum and every item kind in the draw read 1.00 for none.
- **Power, floor and ceiling.** R = 1.00 (a degenerate bootstrap interval; exact lower bound 0.74 by item, 0.63 by plan), above the 0.6 ceiling, with no power and no MDD. By the prereg's operating table the band admits a panel whose true plain recall is 0.8 about 3% of the time. This one read higher.
- **Frontier model without the skill.** Plain Opus 5.5 does this job today: every item in every pass, in a median of 3 turns at $0.126 a session.
- **Verdict: FIX-METHOD on the panel.** All three strata are saturated, so all three need harder items before another admission pilot; rebuilding one stratum would not be enough (prereg section 11). This is not a CUT-CANDIDATE for /plan-ceo-review. A control rate of 1.00 leaves no room to measure lift, so the run says nothing about whether the skill helps. The procedure disposition is READY and needs no cycle.

## What this steers

1. **The panel.** Rebuild with harder items in H, P and U, then run a new admission pilot. Seeded items one inference step deep are within plain Opus 5.5's reach on two panels now.
2. **Under-ambition (GST-660).** Panel v2's U stratum covers the case GST-660 asked for: plans that polish an approach the context says must be replaced. Opus 5.5 found both admission U items in every pass, in every arm. A harder U stratum belongs to the rebuild.
3. **gstack.** Invoked plainly, /plan-ceo-review does not run its procedure on Opus 5.5 (0 of 16 here, 0 of 4 in R1a). The forced line makes it run (16 of 16) at about 4.5 times none's session cost. A headline that wants the procedure measured needs the forced arm.
4. **Unkeyed findings.** The gstack arms raised more unkeyed must-fix findings, both ruled defects and ruled not defects. If a rebuilt panel still saturates seeded recall, a later prereg could freeze a reading of these findings. It would need better judge agreement than kappa 0.38 first.

## Limits and threats

- 8 units, 2 passes and one model. Seeded flaws are not natural flaws.
- **Models under test.** Opus 5.5 is the only model under test. R54 also names GPT-6.1 Sol as a frontier model. This pilot left Sol out because review-units at the pin runs every arm in Claude Code and accepts only a model with an anthropic or openrouter route, and Sol's route in the default policy is openai (prereg section 12). A confirmatory prereg, which needs a rebuilt panel to pass admission first, adds GPT-6.1 Sol through OpenRouter's Anthropic-compatible route, as Run D does, or says why it can't. A panel at ceiling for Opus could still have room for Sol; nobody has tested that.
- **particle-1.** R54 also names particle-1 as the low-cost primary. The Captain accepted Opus 5.5 as this admission pilot's only model under test (Captain drive approvals/2026-11-02-ceo-v2-admission-cap.md), and the prereg gives no separate reason for leaving particle-1 out.
- **Family overlap.** GPT wrote the panel and is the primary judge. Opus is the second judge and also runs every arm.
- **Adjudication agreement** was low (kappa 0.38 between the first two judges on 24 findings), so the unkeyed-findings rows are soft.
- The forced arm has no control that gives the same forced words without the skill.
- **Run files on disk.** The scorer refuses an --out under /dev/shm (E_RECEIPTS_VOLATILE), and that first launch was refused before any lease or session; the frozen command was then relaunched unchanged. So the run root, which held the transcripts and the judging working files, and the scorer's retained unit trees sat in mode-0700 directories on the run machine's disk for about 45 minutes (01:16 to 02:01 UTC). They were then sealed and deleted, each checked with test ! -e. The decrypted run bundle stayed in RAM-backed /dev/shm throughout. CUSTODY.md logs each step.
- **One run file overwritten and restored.** exposure.py's --tsv option names an output path, and one readings call pointed it at the run's mode-handoff file, so the script overwrote that file after reading it. The file was restored from the sealed interim backup, and a rerun of exposure.py gave a reading identical to the one admission.ts used. The restored copy was not digest-checked against the original. It came from a backup sealed before any reading ran (01:53 UTC), and the rerun's output matched.

## Replicate it

1. **Reanalysis (keyless, for holders of the panel key).** Open planning-v2-admission-run-v1.tgz.age under custody and check its digests. Check out the scorer at a5633c6, then run the commands in [commands.txt](commands.txt) from the raw-arm ingest onward. The expected output is the attached files, line for line, with two exceptions. commands.txt shows one power call and describes the rest of the power.txt grid in a comment. sessions.txt, readings-extra.txt and tokens.txt come from aggregation passes that are not published (see below). Outsiders can't run this today. They can check the digests.
2. **Rerun (paid).** Open the run bundle and run the frozen command from prereg section 2, then the judging steps in commands.txt. This run cost $16.55 for 48 sessions and $2.51 for judging. R reads in steps of 1/24, so a rerun that misses one hit reads 0.96, still above the band.

The attached record holds the lines the frozen scripts printed and the commands that ran. It leaves out the machine setup (age, the trial image, the pinned gstack clone) and the paid sessions' transcripts. sessions.txt, readings-extra.txt and tokens.txt come from short aggregation passes over the sealed run records, not from frozen code.

## What is held out, and why

Panel v2's 44 units, both suites, the draw and its permutation, the transcripts, the judge packets and the replies are sealed. They are age-encrypted to panel v1's recipient and kept in the Captain drive beside a CUSTODY.md that logs every opening. This post adds no per-unit row.

| Bundle | sha256 | Inner tar |
|---|---|---|
| planning-v2-run.tar.age (the run material) | 4875e0edc0f71e2f38631575263c62f3e63f2f57249af79b3271cd3983ab61c1 | 53c1309cd18635ccff7194cacf87dd1ead9d1c22b56afda51c1b1ad2d3981a8a |
| planning-v2-admission-run-v1.tgz.age (this run, judging and readings) | 80316069129d1bfce71283a894e3af8a4adb5269d6b9171ab8dacebb7608ecb1 | 90041cef44e68dfa4a30557e74cffc1f9b11aa4be2e7456ce92b1bfc286a950f |
| planning-v2-admission-interim-3.tgz.age (a backup taken before judging, superseded by the bundle above) | 00c3c1b1864cf56c10fa444023bc0fc0d1ee1f03d1a0f0eac2406405ef6a2615 | 26b8bc90920ca2d436ecdf30269326db327002cb5bf310a98b2589c48040eaec |

Outsiders can verify digests only. This post sets no release date.

## Attachments

- [admission-ts.txt](admission-ts.txt): admission.ts's output, the verdict and the rows printed beside it.
- [exposure-py.txt](exposure-py.txt): exposure.py's per-arm counts and the system-prompt check.
- [secondary-none-vs-gstack.txt](secondary-none-vs-gstack.txt) and [secondary-none-vs-gstack-forced.txt](secondary-none-vs-gstack-forced.txt): noloss secondary, verbatim.
- [power.txt](power.txt): the power calls and their refusals.
- [sessions.txt](sessions.txt): per-arm session counts, terminations, turns and cost.
- [readings-extra.txt](readings-extra.txt): recall by item kind and stratum, dead items and adjudication counts.
- [tokens.txt](tokens.txt): tokens per arm and judge model, and the price rows.
- [commands.txt](commands.txt): the commands that ran, with machine paths replaced.
- [pin-checks.txt](pin-checks.txt) and [machine.txt](machine.txt): the pin checks and the run machine.

## Changelog

- 2026-11-02: first version (GEVA-142).

## Disclosures

gstack is Garry Tan's own project.

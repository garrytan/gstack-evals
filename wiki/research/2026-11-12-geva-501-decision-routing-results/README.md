---
id: 2026-11-12-geva-501-decision-routing-results
kind: research
title: "Routing a coding agent's small decisions to Jev, then particle-1, made it cost more, not less: 29.7% more on Opus 5.5 (95% interval 19.8% to 40.4% more) and 18.8% more on GPT-6.1 Sol (9.2% to 28.9% more), with no measurable change in task success, and particle-1 alone matched the router"
summary: "Preregistered, 279 SWE-rebench issues, mini-swe-agent: the Jev router cost 29.7% (Opus 5.5) and 18.8% (Sol) more than the plain agent, success unchanged. particle-1 alone matched it."
author: GEVA-501
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-12
status: superseded
links:
  - 2026-11-09-geva-411-decision-routing-prereg
  - 2026-11-09-geva-421-jev-decision-routing
  - lanes/decision-routing/README.md
  - lanes/decision-routing/score/cli.ts
  - https://openrouter.ai/particle-ai/particle-1
attachments:
  - 3f494e1213b62161140425ab859b6d969a2524fd727b89ef1c5385ab04c92050  b4-404-meters.json
  - e230c5d504e4e8c9597ac4f9a19c9075b173e86001cb752db3623687e96faa01  contrasts.ts.txt
  - dbfd384ec7c2181a7f4e887776b1c4d89d534a50ed19c380e176da1425d90670  contrasts.txt
  - 3d1a07dad9032785ccf4ec73f70200a175fbd40e3847e1302ba6ad0f0598e564  fit.py.txt
  - 67692df6b620ad0e7f7854682dc07df7457a2edc0a31beb95ba5551307ec5a59  fit.txt
  - ac156f0d81d8ac77d4c5c4b57ad4411a950ee7ab204e934485b8592be1a8aa63  join.sh.txt
  - 0af325a4c507c5d4f08db865d1a62586455633e08a85a50964d9082956a9721c  labelpass.sh.txt
  - 9e15c3afcf9a08ad22d76db463e56e02f1c76426bfab15077952aed3e9702da4  labelpass2.sh.txt
  - 44081c83c0e12ac9bf8ce0facba51ef2638ce8e8b06426baa84ff77096022847  lbl-all.sh.txt
  - 0609db2c41fae4fddcf3b48b91788e5aa8ce679900103b60374fcfafb00b83b9  lbl-retry.sh.txt
  - 5f731d557f2b9bebe9cf0a583958c51c412613e9b96ea67bee259426fbc35f5a  lbl-vm6.sh.txt
  - c0abcdff36cb0e2391495068ed0e4595a88fe8fd65c59478039d31d4026c033b  lbl-vm7.sh.txt
  - 7fb15795bfe0b03378deb2e3a70ab39028951a99db5e1ed8322b71b910bba041  lib.ts.txt
  - 178f2624209ccd5ef208a009aeaa29924dad8740d04a6a066a3be0d0ccaadaef  mksessions.py.txt
  - 09128046af26ba33f7358f8db640c46a89b6efb8cab0f3bc2e4ce6de26f29a06  p404.py.txt
  - 6d4cbc667217c94ea7dbc031e4426a99bbad526e37a98768bc7843533bd412db  rates.py.txt
  - 2f428fe52d565ab33528d1eac983459c9fb15022e37fc3ea948052640121e196  rates.txt
  - 6b7c32936296716c60a30eee04fb22e9a6fcecf6ea88f0d218b1bb5b8e8fdf41  replay-read.ts.txt
  - afc9cf1a04d06f7128ab062b25c6535a22f6791b1a77f5226ed50832487fc07f  replay.sh.txt
  - b956b11ebca974e714483b0d2b36e450c1b20bac436bd8be227852bdc8466fa0  retry-vm6.sh.txt
  - 3c42f2659590d0d8b9d3328429c77a458e4033dec847605f139a12f62ed6f66d  retry-vm7.sh.txt
  - dce372f5ed903329f6808619a6453c35989f6baf5874f94c5de2fada73dd6462  s11.txt
  - 620de59a45d0ea7a34dce7d04b8cd6c8982daef8bae3dbf2f893db07cb61981e  s3.ts.txt
  - 79246350494213d1c40bfd1efc609ea4dc61a9a153b602ef791e871eb75f5906  s3.txt
  - 206a03f3aab2d9aaa0930cc6e9faf131da99375d0da87d60bba59ef59c479c18  s4-held.txt
  - 7ebe78645b2bdabad27fa12566791c307d212972b300e0aca35252c19168421c  s4.py.txt
  - 02ac24c0464d2bc2aa0c7bfb996c1c881a86ff4fe6bf8746b14e926e738de8b3  s4.txt
  - eabd4dd32b9872e46395c3135ffe2f56a7328797a45cab5c1182c49a67815d84  s5.ts.txt
  - 48fc1ea3bc3175387e9e00ca4b18d6430144fee5bfae939daea68d98ccef0fd9  s5.txt
  - fad5f1fa358387ca65c99309d586bd52e32c22e59a95c1fee417cc9f2a06bcbb  s6.ts.txt
  - 1ede1b177214cf090a060ab0a4d9bf986014d0dd53b1eb54dfb16d5b3e31d30c  s6.txt
  - 3d7ba43be4f20032efffbdb42e65b14b5c36f82b7db8c50f0b5c8c8dd2390849  s7.txt
  - 4305a46dd20dd685cda304483bdc675a7188dd4fffcd472d726d42e654e3a4f1  s9.ts.txt
  - bdc63566e042da1cfd8ed919c22563d7d254a779cace2e53cbbe4fc3b7aaaa5a  s9.txt
  - 98584c5cbd769d63fac13ec5963eef36d5aac9b12c8b04c4bdcd44efca3eb02b  score-labels.txt
  - f0f114585be65bbef844362a4ed864ad20cae81c5c4f5274252313c6d662b6cf  score-no1c.txt
  - 04f956511f27c0c2d29ad024e4bbd19e086de5425b629e5db2070a3e30810e25  score-sens27.txt
  - 0d6f4872f1be08c439b89ec65df284fc530ecc707f2095e328304f1ee3618d97  score-sens404.txt
  - 5996dcf44e93d289b3a3d2f79940265f5653ee8134c558c8841ff2e6d3b061af  score.txt
  - 4781f3b44d4fda9a4dcf9ce7548f552a7c1d63587126a1c13bc30dfdd5bda373  sens.log.txt
  - 023c16ad90ae9476dbade19ae71e8714b7cd89d57105d2cddd0967989d0c8410  sens.sh.txt
  - 2c650223170e4714e87574f7d882d0b010ff3a0a53ef3d6a3ce40e085e05a440  sens404-exclude.json
  - 31dd50ca45c0142b6714626ce04e7e7bcc3f6403c473363549d7f861677f1cbe  tune-scored.txt
---

# Routing a coding agent's small decisions to Jev, then particle-1, made it cost more, not less: 29.7% more on Opus 5.5 (95% interval 19.8% to 40.4% more) and 18.8% more on GPT-6.1 Sol (9.2% to 28.9% more), with no measurable change in task success, and particle-1 alone matched the router

A viral article says most of what a coding agent pays for is small decisions (which step next, whether a search hit matters, whether the tests passed, whether a command is safe, whether the job is done), and that sending them to Jev, a small calibrated model from TypeSafe, with a cheaper model taking the cases Jev is unsure of, cuts the bill by about 90%. The article sends the unsure cases to Kimi K3. By the project owner's choice we sent them to particle-1, so this result is about Jev routing with particle-1 behind it, not about Kimi K3. We ran mini-swe-agent, a widely used open-source coding agent, on 279 real GitHub issues from SWE-rebench, on Claude Opus 5.5 and GPT-6.1 Sol, with each issue's hidden tests deciding success and the real API bill deciding cost.

- We learned that the plain agent, with every decision left inside the frontier model's own turns and prompt caching on, was the cheapest setup we ran on both models, and the router passed no measurably more issues than it: plain Opus 5.5 passed 62.7% of 279 issues and plain Sol 56.6%, and about 90% of their input tokens were read from cache. You should turn on prompt caching and keep a coding agent's small decisions inside its own turns before you reach for a decision router.
- We learned that routing those decisions to Jev with particle-1 behind it raised the bill by 29.7% on Opus 5.5 (95% interval 19.8% to 40.4%) and 18.8% on Sol (9.2% to 28.9%), made sessions 1.8 and 2.0 times as long, and made no measurable difference to success (+1.1 points on each model; Opus interval -2.2 to +4.3, where the test could see about 4.6 points; Sol -1.1 to +3.3, about 3.0 points). You should not expect a router bolted onto a coding agent loop like this one to save money, because every check it routed was a new call the plain agent never paid for.
- We learned that the Jev layer added nothing measurable over sending every decision to particle-1 alone (success +0.4 points on Opus, interval -2.5 to +3.3, and -2.2 on Sol, -4.6 to +0.4; bill ratios 0.966 and 0.992 with intervals spanning 1), and particle-1 alone still cost 34.3% (Opus) and 19.8% (Sol) more than the plain agent. You should try one cheap reasoning model before building a confidence cascade, and expect neither to beat a cached frontier agent on cost.

## What works

**The plain frontier agent.** mini-swe-agent as its authors ship it, with every decision made inside the main model's own turns, was the cheapest setup on both models. Opus 5.5 passed 175 of 279 issues (62.7%) and GPT-6.1 Sol 158 of 279 (56.6%). The router passed no measurably more on either model; particle-1 alone passed measurably more on Sol only (a lead below). Prompt caching is a large part of why: 91.1% of plain Opus's main-model input tokens and 88.5% of plain Sol's were cache reads. Pricing the cache away multiplies the plain agent's bill by 4.15 on Opus and 3.46 on Sol (S6).

**Jev is fast and calibrated on the decisions we could label.** On the scored sessions' grounded labels (labels computed from the hidden tests, the real fix and a frozen safety rule; see Setup), Jev's calibration error (ECE) on command safety was 0.041 over 11,219 answered decisions, and its most confident answers (confidence 0.9 to 1.0, 7,928 decisions) were right 99% of the time. On search-hit relevance its ECE was 0.097 and it was right on 85.2% of 5,388 labelled decisions, against 56.5% for particle-1 on the same decision type. Jev answered in 0.16 to 0.18 seconds at the median (182 ms measured in the agent, 158 to 160 ms at the metering proxy), 11.3 times faster than the frontier model answering the same typed question (21.9 times at the 90th percentile). That is about twice the 70 to 90 ms our earlier exploration measured, and far from the 193.6 times the vendor quotes for its own workflow evals. In the router Jev settled 99.8% of safety checks, and that is why the router ran faster than particle-1 alone (time ratio 0.900 on Opus, 0.924 on Sol), though neither interval's upper end (0.981, 0.997) reached the preregistered 0.90 line for "faster".

**Leads, not findings.** These come from secondary lines with intervals and no verdict, among many comparisons, so read them as places to look next.

- Sending Sol's decisions to particle-1 with no router passed 3.2 points more issues than plain Sol (95% interval 0.7 to 5.8; 11 tasks better, 2 worse), at 19.8% more cost. On Opus the same change made no measurable difference (+0.7, -1.7 to +3.2).
- Restructuring the agent into typed decisions that the frontier model itself answers (F against plain, Opus, 99 subset tasks) passed 6.1 points more (1.0 to 11.5; 7 better, 1 worse) at 4.0 times the bill and 1.97 times the time. It is one of 14 success intervals in S1, S2 and S8, the only one that excludes zero, and the subset's MDD (smallest difference the test could reliably see) is 8.0 points.
- particle-1 as the whole agent (W, 95 subset tasks) passed 62 against plain Opus's 64, a gap to the frontier of -2.1 points (-7.3 to +2.9), at 0.072 of plain Opus's bill and 1.48 times its time. Against plain Sol the gap is +3.2 (-2.1 to +8.8) at 0.145 of the bill. The MDDs are 7.2 and 7.8 points, so a loss of about 7 points against Opus can't be ruled out.

## What didn't work

**The claim: no saving on either model.** The preregistered verdict for the router against the plain agent (Primary A) is NO SAVING on both models.

- Opus 5.5: the router's bill was 29.7% higher (cut -29.7%, 95% interval -40.4% to -19.8%; median per-task ratio 1.106). Success moved +1.1 points (-2.2 to +4.3; 9 tasks worse, 12 better) against a control rate of 62.7%, where the test could see a difference of about 4.6 points. Sessions took 1.822 times as long (1.629 to 2.053).
- GPT-6.1 Sol: the bill was 18.8% higher (cut -18.8%, -28.9% to -9.2%; median per-task ratio 1.161). Success moved +1.1 points (-1.1 to +3.3; 3 worse, 6 better) against a control rate of 56.6%, with an MDD of about 3.0 points. Sessions took 2.038 times as long (1.887 to 2.203).

**The router against particle-1 alone: particle-1 alone is enough.** The preregistered verdict (Primary B) is PARTICLE-1 ALONE IS ENOUGH on both models: success within the margin and not measurably higher, and the router neither cheaper nor faster by the preregistered rule.

- Opus 5.5: success +0.4 points (-2.5 to +3.3; 9 worse, 10 better) against particle-1 alone's 63.4%, MDD about 4.4. Bill ratio 0.966 (0.885 to 1.046): not cheaper. Time ratio 0.900 (0.829 to 0.981): faster, but not past the 0.90 line.
- GPT-6.1 Sol: success -2.2 points (-4.6 to +0.4; 8 worse, 2 better) against particle-1 alone's 59.9%, MDD about 3.2. Bill ratio 0.992 (0.919 to 1.066). Time ratio 0.924 (0.861 to 0.997).

**Moving decisions to particle-1 with no router cost more too.** Particle-1 alone against the plain agent (no verdict by design): 34.3% more on Opus (-46.0% to -23.1% as a cut) with sessions 2.0 times as long, and 19.8% more on Sol (-31.2% to -9.0%) with sessions 2.2 times as long.

**The done check was near chance, and it is where routed sessions failed.** On the scored labels Jev was right on 54.3% of 853 "is the task done" decisions and particle-1 on 56.3% of 1,258. In the router particle-1 decided 92.5% of them, and 262 of the 615 labelled done decisions that a layer below the main model acted on were wrong. In every task where the router failed and the plain agent passed, the failing routed session's last decision that changed anything was the done check letting a patch stand that fails the hidden tests (Opus 8 tasks, plus 1 where the third submit stood by rule; Sol 3 tasks). The sessions didn't part there: in 48 of the 59 tasks where the two setups disagreed, the paths split at the main model's own first command, and in the other 11 at turn 1 or 2 with nothing in between but next-step decisions handed back to the main model (S9).

**The safety check disagreed with the frozen safety rule on about 1 decision in 10 in the router.** Against the frozen pattern rule (a write outside the repository, a network call, deleting the repository or rewriting git history), 797 of 8,330 labelled safety decisions acted on below the main model in the router were wrong, with Jev deciding 99.8% of them from confidence 0.5 up, as its calibration band allowed. Particle-1 alone was wrong on 686 of 8,506. Jev alone at a fixed 0.9 threshold, where anything less sure went to the frontier model, was wrong on 22 of 2,020. On a constructed held-out set of 100 commands, all three deciders caught 50 of 50 unsafe commands and blocked 0 of 50 ordinary ones, a ceiling that doesn't separate them.

**particle-1 dropped some files the real fix edits.** Relevance decisions come after a command lists more than 20 paths, and a decider may hide a hit only inside a drop band tuned at calibration. In the router, particle-1 dropped hits on 47.3% of the 110 relevance decisions, and of the 149 asked-about hits pointing at a file the real fix edits, it dropped 10. Its 0.95 drop band rests on noise: between two calibration passes with identical question text, particle-1's relevance accuracy moved by about 12 points. None of the 59 disagreeing tasks parted on a dropped hit.

**Jev's guess didn't help particle-1.** On 6,204 decision states from 198 subset router sessions, particle-1 shown Jev's guess against particle-1 without it: done 0.626 against 0.639, safety 0.925 against 0.924, relevance 0.619 against 0.683 (right only with the guess 129 times, right only without it 187 times, of 902) (S11).

## How it works

This is our reading of the logs, an explanation and not a measured result.

1. **Routing saves money only when a decision replaces a main-model turn.** In this loop that is the next-step decision: run the last test again, print a file, submit, or hand the turn to the main model. The turns that edit no file, the most that any routing could take over, held 57.6% of plain Opus's dollars and 64.1% of plain Sol's (S3). Both sit under the 80% a "90%" cut would need, as the preregistration predicted, so the article's number could not have occurred here.
2. **The next-step decision never routed.** Jev's calibration error on next step passed the 0.15 gate (0.057 at calibration), but no confidence band, for Jev or for particle-1, agreed with the main model's own next action often enough to clear the frozen rule (a Wilson 95% lower bound of 0.90 over at least 40 decisions). So the frozen pin gave next step no acting band, and the main model took every one of the router's 7,597 next-step decisions. Routing removed no main-model turn.
3. **What routing added.** The safety, test-pass, done and relevance checks are calls the plain agent never makes on their own: about 31 decider questions per routed session. A blocked command or a "not done yet" answer also sends the main model around again: routed Opus sessions made 2.4 more main-model calls than plain ones, and Sol 1.4 more. The decider calls themselves are a small part of the router's bill (Opus: Jev 1.4%, particle-1 2.3%; Sol: 3.4% and 5.7%). The rest of the increase is main-model spend.
4. **Where the time went.** Routed Opus sessions ran 113 seconds longer than plain ones: 70.7 s of particle-1 answers, 12.9 s of extra main-model time, 6.6 s of Jev and 22.4 s of everything else. particle-1's next-step answers alone took 43.3 s a session, and none of them could act (S5).
5. **Caching makes the frontier's own decisions cheap.** The plain agent makes its decisions inside turns whose context is mostly cached. Price the cache away, as the article's math does, and routing looks worse, not better: the router's bill becomes 37.8% higher than plain on Opus (interval 21.6% to 56.3%) and 27.5% higher on Sol (15.7% to 41.1%) (S6).

## Result

The preregistered primaries, paired on the 279 scored issues graded in both setups on the same model. Success is the first setup minus the second, in points. A cut is 1 minus the ratio of summed bills, so a negative cut means the first setup cost more.

| Comparison | Model | Success, points (95% interval) | Worse / better | Bill (95% interval) | Time ratio (95% interval) | Verdict |
|---|---|---|---|---|---|---|
| Router against plain (A) | Opus 5.5 | +1.1 (-2.2 to 4.3) | 9 / 12 | cut -29.7% (-40.4% to -19.8%) | 1.822 (1.629 to 2.053) | NO SAVING |
| Router against plain (A) | GPT-6.1 Sol | +1.1 (-1.1 to 3.3) | 3 / 6 | cut -18.8% (-28.9% to -9.2%) | 2.038 (1.887 to 2.203) | NO SAVING |
| Router against particle-1 alone (B) | Opus 5.5 | +0.4 (-2.5 to 3.3) | 9 / 10 | ratio 0.966 (0.885 to 1.046) | 0.900 (0.829 to 0.981) | PARTICLE-1 ALONE IS ENOUGH |
| Router against particle-1 alone (B) | GPT-6.1 Sol | -2.2 (-4.6 to 0.4) | 8 / 2 | ratio 0.992 (0.919 to 1.066) | 0.924 (0.861 to 0.997) | PARTICLE-1 ALONE IS ENOUGH |
| particle-1 alone against plain | Opus 5.5 | +0.7 (-1.7 to 3.2) | 5 / 7 | cut -34.3% (-46.0% to -23.1%) | 2.025 (1.762 to 2.308) | none by design |
| particle-1 alone against plain | GPT-6.1 Sol | +3.2 (0.7 to 5.8) | 2 / 11 | cut -19.8% (-31.2% to -9.0%) | 2.205 (2.050 to 2.360) | none by design |

Pass rates over each setup's graded tasks (rates.txt):

| Setup | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Plain agent (N), 279 issues | 175 (62.7%) | 158 (56.6%) |
| Router (R), 279 | 178 (63.8%) | 161 (57.7%) |
| particle-1 alone (P), 279 | 177 (63.4%) | 167 (59.9%) |
| Typed frontier (F), 99 subset | 72 (72.7%) | not run |
| Jev alone (J), 99 subset | 68 (68.7%) | 61 (61.6%) |

particle-1 as the whole agent (W) passed 62 of its 95 graded subset tasks (65.3%).

The primary lines, verbatim from the frozen scorer at 1cca006 (score.txt):

```
== opus ==
Primary A, R against N
cut: -29.7% (95% interval -40.4% to -19.8%), median per-task ratio 1.106
success: R minus N 1.1 points (95% interval -2.2 to 4.3), worse 9, better 12, 279 paired tasks: no measurable difference
time ratio: 1.822 (95% interval 1.629 to 2.053)
verdict: NO SAVING

Primary B, R against P
success: R minus P 0.4 points (95% interval -2.5 to 3.3), worse 9, better 10, 279 paired tasks: no measurable difference
bill ratio R/P: 0.966 (95% interval 0.885 to 1.046)
time ratio R/P: 0.900 (95% interval 0.829 to 0.981)
verdict: PARTICLE-1 ALONE IS ENOUGH

== sol ==
Primary A, R against N
cut: -18.8% (95% interval -28.9% to -9.2%), median per-task ratio 1.161
success: R minus N 1.1 points (95% interval -1.1 to 3.3), worse 3, better 6, 279 paired tasks: no measurable difference
time ratio: 2.038 (95% interval 1.887 to 2.203)
verdict: NO SAVING

Primary B, R against P
success: R minus P -2.2 points (95% interval -4.6 to 0.4), worse 8, better 2, 279 paired tasks: no measurable difference
bill ratio R/P: 0.992 (95% interval 0.919 to 1.066)
time ratio R/P: 0.924 (95% interval 0.861 to 0.997)
verdict: PARTICLE-1 ALONE IS ENOUGH
```

Coverage: every scored setup was graded on 279 of 280 planned issues (one was dropped before launch; Deviations, item 7), every subset setup on 99 of 100, and W on 95 of 100. No cell is degraded: decisions whose decider failed after its retry were at most 0.5% of a cell's decisions (Sol particle-1 alone, 40 of 8,471), against the 5% line.

### Sensitivity readings

None changes a verdict.

| Reading | Opus A: cut; success | Opus B: success; bill ratio | Sol A: cut; success | Sol B: success; bill ratio |
|---|---|---|---|---|
| As scored (279 tasks) | -29.7%; +1.1 | +0.4; 0.966 | -18.8%; +1.1 | -2.2; 0.992 |
| Grounded labels added (score-labels.txt) | identical | identical | identical | identical |
| particle-1 404 sessions treated as missing (sens404) | -27.7% (-38.2% to -18.0%); +1.1 (-2.2 to 4.4) | +0.4 (-2.6 to 3.4); 0.965 (0.883 to 1.049) | -18.8% (-28.8% to -9.1%); +1.1 (-1.1 to 3.3) | -2.2 (-4.7 to 0.4); 0.995 (0.919 to 1.069) |
| Every batch-4 session with a decider failure dropped (sens27) | -27.7% (-38.2% to -18.0%); +1.1 (-2.2 to 4.4) | +0.4 (-2.7 to 3.4); 0.960 (0.879 to 1.043) | -18.6% (-28.6% to -9.1%); +1.1 (-1.0 to 3.3) | -1.9 (-4.3 to 0.7); 0.998 (0.920 to 1.072) |
| The 54 empty-key reruns counted missing (no1c) | -30.7% (-42.0% to -20.6%); +1.5 (-1.8 to 4.7) | +0.4 (-2.7 to 3.4); 0.966 (0.885 to 1.049) | -21.4% (-31.1% to -11.7%); +1.1 (-1.1 to 3.4) | -2.3 (-4.8 to 0.4); 0.988 (0.917 to 1.055) |

The sens404 reading drops the 16 batch-4 sessions that had decider failures and particle-1 HTTP 404s, and sens27 drops all 23 batch-4 sessions with decider failures. Paired task counts fall to between 264 and 276; each file prints its own.

### Secondaries

Intervals only, no verdicts (preregistration section 11). Scripts and printed outputs are attached.

- **S1, which part does the work (Opus, 99 subset tasks; contrasts.txt).** Typed frontier against plain: success +6.1 (1.0 to 11.5), bill 3.996 times (3.575 to 4.470), time 1.971. Router against typed frontier: success -3.0 (-7.9 to 1.1), bill 0.314 (0.279 to 0.356), time 0.956 (0.826 to 1.114). F's bill includes 3 sessions stopped at the per-session allowance, graded as they stood.
- **S2, the ingredients (contrasts.txt).** Router against Jev alone: bill 0.660 on Opus (0.587 to 0.743) and 0.722 on Sol (0.642 to 0.819), time 1.222 and 1.370, success +1.0 on both (Opus -3.3 to 5.6, Sol -3.2 to 5.7). Jev alone costs more than the router because what Jev doesn't act on falls to the frontier model. Jev alone against typed frontier (Opus): bill 0.476 (0.431 to 0.528), time 0.782 (0.708 to 0.862), success -4.0 (-9.2 to 0.0).
- **S3, the room routing has (s3.txt).** Turns that edit no file: Opus 57.6% of plain dollars (55.7 to 59.4) and 58.2% of time; Sol 64.1% (61.8 to 66.4) and 59.5%. Calibration's first look printed 57.4% and 67.4%. None of this room was used, because next step never routed.
- **S4, calibration on the scored tasks (s4.txt, tune-scored.txt).** Jev: safety accuracy 0.906 (n 11,233, ECE 0.041), relevance 0.852 (n 5,388, ECE 0.097), done 0.543 (n 853, ECE 0.151), test pass 5 labelled, next step none labelled. particle-1 with Jev's guess: safety 0.919 (n 8,523), done 0.563 (n 1,258, 36 no-answers), relevance 0.565 (n 8,062, 1,192 no-answers, counted wrong), test pass 11 labelled. Constructed held half (s4-held.txt): every decider caught 50 of 50 unsafe and blocked 0 of 50 ordinary commands. The frontier model's accuracy on the same states is not in this reading (see Limits).
- **S5, latency (s5.txt).** Per call at the median and 90th percentile: Jev 182 ms and 231 ms (n 24,069), particle-1 1,803 ms and 5,723 ms (n 27,743), the frontier as a decider 2,057 ms and 5,052 ms (n 4,366). Deciders' share of session time: Opus router 31.0%, particle-1 alone 35.6%, Jev alone 17.2%, typed frontier 35.3%; Sol router 38.5%, particle-1 alone 45.6%, Jev alone 16.9%.
- **S6, the price assumption (s6.txt).** With caching priced away the router's bill is 37.8% above plain on Opus (cut -37.8%, -56.3% to -21.6%) and 27.5% on Sol (-27.5%, -41.1% to -15.7%). Router against particle-1 alone stays flat: 0.970 (0.865 to 1.085) and 1.017 (0.930 to 1.120). prices.json has no batch prices, so nothing was re-priced at batch rates.
- **S7, Jev 1.14.0 on every logged decision state (s7.txt, replay-read.ts.txt).** Jev 1.14.0 answered the 45,584 decision states logged in 1,413 scored routed sessions, offline, with every session's label file present; 19 states got no answer (safety 14, next step 5). Accuracy on the grounded labels: safety 0.902 (n 21,147, ECE 0.046), relevance 0.862 (n 9,323, ECE 0.125), done 0.556 (n 1,677, ECE 0.180), test pass 0.706 on 17 labelled states (too few for an ECE), next step unlabelled (19,443 states). Paired against the logged answers of the jev-1.13.0 that ran, on the same states: done, right only with 1.14 52 times and only with 1.13 56 times of 853 (459 against 463 right); relevance 287 against 269 of 5,388 (4,607 against 4,589); safety 89 against 103 of 11,233 (10,168 against 10,182). The two versions gave the same answer on 87.3% of done, 89.7% of relevance, 98.2% of safety, 89.5% of next-step (10,304 pairs) and 97.3% of test-pass states (1,592 pairs, 5 labelled). On the labelled types 1.14 did no better and no worse than 1.13. The ECEs here cover every logged state, while S4's cover only the states 1.13 answered in the log, so the two sets are not paired.
- **S8, switching the whole agent against routing (contrasts.txt).** W against plain Opus: -2.1 (-7.3 to 2.9) at 0.072 of the bill (0.062 to 0.082) and 1.479 times the time; against plain Sol: +3.2 (-2.1 to 8.8) at 0.145 (0.120 to 0.173) and 1.706 times. Against the Opus router -5.3 (-12.4 to 2.1), against Opus particle-1 alone -4.2 (-10.6 to 2.1), against the Sol router +1.1 (-4.4 to 6.5), against Sol particle-1 alone -1.1 (-5.7 to 3.3). No success interval excludes zero.
- **S9, where it breaks (s9.txt).** 59 tasks where the two setups disagreed (Opus router against plain 21, against particle-1 alone 19; Sol 9 and 10). None parted on a decider's intervention: 48 parted at the main model's first command and 11 at turn 1 or 2 with only next-step hand-backs in between. Across all paired tasks, concordant included, the paths part at turn 0 in 213 to 251 of 279 and by turn 3 in all, so the main model's own sampling separates sessions before any decision layer acts.
- **S10, who acted (score-labels.txt).** In the router: safety Jev 99.8%, particle-1 0.2% (n 8,330); done particle-1 92.5%, exact rule 5.0%, frontier 2.6% (n 665); test pass particle-1 98.2%, rule 1.7% (n 1,235); relevance kept 52.7%, dropped by particle-1 47.3% (n 110); next step main model 100% (n 7,597). About 31 decider questions per routed session. Blocked commands: router 304, particle-1 alone 431, Jev alone 205, typed frontier 45. Wrong acts by grounded label: router safety 797 of 8,330, done 262 of 615, relevance 10 of 52, test pass 1 of 4; particle-1 alone safety 686 of 8,506, done 252 of 607, test pass 1 of 7; Jev alone safety 22 of 2,020, done 1 of 4, relevance 5 of 21. Relevance decisions are their own row because particle-1's drop band rests on calibration noise (What didn't work).
- **S11, Jev's guess (s11.txt).** On the same 6,204 states, particle-1 with the guess against without: done 0.626 against 0.639 (right only one way: 12 against 15 of 227), safety 0.925 against 0.924 (74 against 71 of 2,880), relevance 0.619 against 0.683 (129 against 187 of 902; without the guess particle-1 gave 252 no-answers). Next step has no label; the two gave the same answer 90.3% of the time.

## Why null? (R48)

Each of the four null verdicts gets one cycle. They share the evidence below, so it is stated once.

- **Exposure: did the decision layer act?** Yes, on four of the five decision types. Every routed session asked about 31 decider questions. In the router Jev settled 99.8% of 8,330 safety checks, particle-1 92.5% of done and 98.2% of test-pass decisions, and particle-1 dropped hits on 47.3% of relevance decisions. Jev had an acting band on safety, so the router was not simply particle-1 alone with Jev's guess added. Next step is the exception: no decider earned an acting band at calibration, so the main model took every next-step decision (7,597 in the router, 7,756 in particle-1 alone). No cell was degraded (decider failures at most 0.5%).
- **Task fit.** Every routed session logged at least one next-step and one done decision: 100% in every routed setup and model, against the 80% line (fit.txt).
- **Power, floor and ceiling.** Control rates sit well off both ends: plain Opus 62.7%, plain Sol 56.6% (particle-1 alone 63.4% and 59.9% for Primary B). The realised discordance (tasks where the pair disagreed) was 21 of 279 (Opus) and 9 of 279 (Sol) for router against plain, an MDD of about 4.6 and 3.0 points, and 19 and 10 of 279 for router against particle-1 alone, about 4.4 and 3.2 points. All four sit inside the 7.5-point margin and under the planned 5.8. The cut intervals lie wholly below zero, so NO SAVING is not a power problem.
- **The frontier model without routing.** The plain agent makes every decision inside its own turns. It was the cheapest setup on both models, with success no measurably different from the router's.

Verdicts:

1. **Opus 5.5, router against plain, NO SAVING: CUT-CANDIDATE.** Don't adopt calibrated decision routing into a frontier coding agent loop on this evidence. The decisions the router could act on are checks the plain agent never pays for separately, so routing them adds cost; the one decision that could replace main-model turns never qualified under the claim's own "act only when sure" rule; and even full next-step routing could reach at most the 57.6% no-edit share, not 90%.
2. **GPT-6.1 Sol, router against plain, NO SAVING: CUT-CANDIDATE.** The same reasons hold, with a smaller increase (18.8%) and a no-edit share of 64.1%.
3. **Opus 5.5, router against particle-1 alone, PARTICLE-1 ALONE IS ENOUGH: CUT-CANDIDATE for the Jev layer.** It made the router 10% faster than particle-1 alone, short of the preregistered line, with no measurable gain in success or cost, and its guess didn't help particle-1 (S11). particle-1 alone does the job the router does here.
4. **GPT-6.1 Sol, router against particle-1 alone, PARTICLE-1 ALONE IS ENOUGH: CUT-CANDIDATE for the Jev layer.** The same, with success 2.2 points lower than particle-1 alone (not measurable) and 7.6% faster.

Next step and kill rule: next step is where the money is. Turns that edit no file hold 57.6% of plain Opus's dollars and 64.1% of plain Sol's (S3), and routing never touched those turns, because next step never got a band. Under the frozen pin (sha256 1bb205f6) no decider got a next-step band, because no confidence region's Wilson 95% lower bound reached 0.90. So routing never acted on next step, Jev acted on safety only, and these verdicts cover routing as frozen. The one thing that would reopen routing on this agent is a next-step decider that clears the frozen calibration rule on calibration states alone, with no scored task looked at. If no decider can, these cuts stand, because without next-step routing this loop has no main-model turn for a router to remove. S7 doesn't reopen it: it replays Jev 1.14.0 on scored states, which carry no next-step label, and on the labelled types 1.14 did no better and no worse than 1.13. R61 doesn't apply: the nulls don't rest on a ceiling, since both control rates sit near 60%.

## Limits and threats

- **One agent loop and one task family.** mini-swe-agent on Python-heavy GitHub issues from 185 repositories. Results speak to agents that look like it. Calibration came from 17 repositories and the pilot from 8, mostly litellm and sqlglot, so thresholds may not transfer; S4 measures each type's calibration on the scored tasks.
- **Training data.** Opus 5.5, GPT-6.1 Sol and particle-1 may have seen these public repositories. That applies to every setup alike.
- **Kimi K3 untested.** The article's escalation model was left out by the project owner's choice. particle-1 is a different and much cheaper model.
- **Labels.** Next step has no grounded label on the scored sessions (no plain-agent action exists at a routed state), so S4 reports no next-step accuracy. Test pass has 17 labelled states of 3,072: 2,485 were not a bare test-runner command and 570 snapshots did not apply to the pristine image (197 tasks), as 30 of 165 also failed at calibration. The safety label is a frozen pattern rule, so a "wrong act" on safety is disagreement with that rule, not proof of harm.
- **S4 is missing the frontier column.** The preregistration asks for the frontier model's accuracy on the same states. The S4 reading prints Jev and particle-1 only.
- **Jev 1.14.0 got a decision-level replay only (S7).** It answered states that sessions run with 1.13 had logged. No session ran with 1.14, so its effect on bills, time and success is not measured, and a session that used it could have reached different states.
- **particle-1's metered price.** At calibration particle-1's metered cost ran about 2.0 times OpenRouter's billed figure on one lease. The scorer prices every call from the frozen dated table, as preregistered. particle-1 is 2.3% to 8.2% of the routed and particle-1-alone bills, so even halving its cost would leave the router costlier than the plain agent on both models; that is a check on the means, not a rerun of the bootstrap.
- **Model-written hidden test names, counted and not leaks.** In 13 sessions a model wrote a name or path that matches a hidden test, with no tool result or prompt holding it first: particle-1 as the whole agent in 5 (basic-memory-334, darts-2985, pygeoapi-2338, packit-2684, meltano-9929); Opus router in 2 (toqito-1484, packit-2684); Opus particle-1 alone in 1 (toqito-1484); Sol router in 3 (pygeoapi-2338, taipy-2797, vyper-4801); Sol particle-1 alone in 1 (pygeoapi-2338); plain Sol in 1 (vyper-4801); plain Opus, typed frontier and Jev alone in none. Some are test names recalled or guessed (darts-2985's class and five test names, basic-memory-334's), and some are paths the model wrote that don't exist in the repository. No rule acts on them.
- **Pilot exposures.** The calibration and pilot task images were used before the history strip (Deviations, item 3). In the pilot, 3 of 128 sessions, all particle-1 as the whole agent (litellm-16864, astropy-18752, schemathesis-3291), found the upstream fix through git log --all, and all three passed. Opus 0 of 64 and Sol 0 of 52. Pilot outcomes are never scored.
- **The third-party file check has a blind spot.** The containment check sets aside a matching file outside the repository only when a site-packages or dist-packages RECORD lists it. It misses a third-party file inside the repository's own ignored .venv, and one in the uv cache, when only a dist-info RECORD lists it. unyt-628 is that case, and it was dropped (Deviations, item 7). Widening the check to conda records is a note for the next eval.
- **Image environments.** About half the sessions in every setup ran into the image's conda base environment (for example plain Opus 139 of 283). The agent runs as a non-root user, and some of its commands fail for that reason: pip installs fail because the egress block refuses package downloads, and writes to ~/.cache fail because HOME points at /root. The largest gap between setups was Sol's cache-write failures, 20.9 points higher in plain than in particle-1 alone. score.txt prints both readings per setup; they are reported, not adjusted for.
- **particle-1 outage window.** OpenRouter returned 142 HTTP 404s for particle-1, about 15% of its calls between 17:00Z and 17:39Z on 2026-11-11, all in batch 4; batches 5 and 6 had none. They cost 4 whole-agent sessions (missing) and 27 decider calls (counted wrong, as frozen). The sens404 reading treats them as missing and changes no verdict. The S11 replay leases met 28 and 102 HTTP 429s, retried.
- **Stops.** 3 typed-frontier sessions ended at the per-session allowance, 1 Opus particle-1-alone session at the wall limit and 2 whole-agent sessions at the step limit, all graded as they stood.
- **One trial per task and setup.** The intervals cover task sampling, not run-to-run variation on one task.
- **No chart.** This post gives tables only.

## Deviations from the preregistration

1. The eval's spending line moved from $2,000 to $2,140 before any scored data, on the Captain's ruling after the pilot re-cost, and the crew figure in items.json was corrected as a recorded deviation.
2. During the pilot the Anthropic decider adapter was fixed (commit 3130263) to ask for structured output instead of forcing a tool call, which Opus 5.5 refuses. The runtime was rebuilt and shown to reproduce the pinned tarball (sha256 4eaf1bfa...). Six pilot sessions that ran before the fix (Opus typed frontier and Jev alone) are kept as evidence and left out of the pilot means.
3. After a sister eval found upstream fix commits reachable through git tags in SWE-rebench images, every scored image was stripped to the base commit's history before any scored session (commit 9061854), with an object-level check per image. The run id moved from dr-scored@3f25ea055b96 to dr-scored@906185467619 before any scored lease opened.
4. Batch 1 ran at 9061854. Batches 2 to 6 ran at 1cca006, which changes only the history strip and its check (it trims submodule stores to their pinned commit and sets aside third-party files listed in a package RECORD). Runtime, pin and plans were unchanged.
5. 54 batch-1 sessions ran with empty provider keys and never reached a model. On the Captain's ruling they were rerun once, as batch 1c, in their own segment at the end of batch 1, in seeded order, with the same images and pins. They ran 0.39 to 3.13 hours after their task's last batch-1b session (median 1.07 hours). The no1c sensitivity reading counts them missing.
6. Containment hits set aside as third-party files, each with task, files and owning package: iris-6754, scipy 1.16.3 (scipy/optimize/tests/test_minimize_constrained.py, its .pyc, scipy/optimize/_linprog_util.py); docstub-123, mypy 1.19.1 (mypy/test/testtypes.py and its .pyc) and libcst 1.8.6 (libcst/codemod/commands/tests/test_fix_variadic_callable.py and its .pyc); anyio-1121, pytest 9.0.3 (_pytest/capture.py, hookspec.py, main.py, terminal.py and pytester.py, with their .pyc files); qwenpaw-3278, pandas 3.0.3 (pandas/tests/groupby/test_categorical.py and its .pyc). taipy-2797 ran under a written exception: setuptools 72.1.0's setuptools/tests/test_packageindex.py and its .pyc in the conda base environment, listed in that package's conda record, not owned by the repository, and matching only as a substring (0 whole-word hits).
7. unyt-628 was dropped from batch 6 before launch on the Captain's ruling: its 10 rows failed the containment check and count as missing, with no replacement and no reordering. Plan digests: the full 356 rows 68e7d5f3..., the 346 rows launched 3ffbfeba....
8. Grounded labels were computed after the whole run rather than after each session, so batches 1 to 5 re-pulled their images. 5 batch-5 trials needed a one-at-a-time retry because parallel jobs built the same verifier image tag at once. All 1,413 routed trials were labelled.
9. The decision-level replays moved to a second runner VM because they outlasted the first VM's lifetime, with the same pinned build and gate.
10. The scorer prints the 58 empty-key and infrastructure first attempts as "rerun missing", although the batch-1c reruns are the sessions it pairs.
11. Before the scored stage, two changes fixed failures that calibration surfaced, and calibration was rerun under new ledger items each time, with the earlier partial runs never pooled. Sol now asks for its reasoning inline with storage off (commit 7972d74), because replaying reasoning by id reserved the whole context window and stopped every Sol session at its allowance after one action. The vendored egress sidecar's read timeout was raised to 900 seconds (commit 7875f7a), because Harbor's sidecar cut any reply that took more than 15 seconds to start.

## Setup

- **Question.** Does routing a coding agent's typed decisions to Jev, acting on its confident answers and sending the rest to particle-1, cut the agent's total bill by about 90% without losing task success, and does it beat sending every decision to particle-1 alone? Preregistration: 2026-11-09-geva-411-decision-routing-prereg, merged in 47d7964.
- **Agent.** mini-swe-agent 2.4.6 (MIT) as Harbor's installed agent at Harbor f3a5a923, inside each task's container, in an arm-neutral runtime venv (litellm 1.108.3, typesafe-sdk 0.7.5, anthropic 2.6.0, openai 3.46.0; runtime tarball sha256 4eaf1bfa28c7e640e13382f1ab79fa6a3b25b0a2e4f792f2487073254da32b69). The plain agent is mini's own SWE-bench configuration, unedited. Limits in every setup: 100 executed actions, 45 minutes and a $5 per-session allowance at the metering proxy.
- **Setups.** N, plain. R, router: exact rule, then Jev 1.13.0 inside its tuned acting band, then particle-1 shown Jev's guess, then the main model. P, particle-1 alone: exact rule, then particle-1, then the main model. F, typed frontier: the main model answers the typed questions (Opus, subset). J, Jev alone at a fixed 0.9 threshold, then the main model (subset). W, particle-1 as the whole agent (subset). No setup has gstack installed: no gstack decision point is a code-level call on a coding agent's path, so every setup is a no-gstack setup by construction.
- **Decision points.** Next step (before each main-model query after the first), relevance (after a command listing more than 20 paths, at most 100 hits asked), test pass (exact rule for a bare runner command, else a decider), safety (before every command), done (at submit; a third submit stands).
- **Models and routes.** anthropic claude-opus-5-5 on Anthropic's API with cache breakpoints; openai gpt-6.1-sol on OpenAI's API with automatic caching and inline reasoning; TypeSafe jev-1.13.0 through POST /v1/systemone; particle-ai/particle-1 through OpenRouter, provider fixed to Particle AI, fallbacks off, 8,000 output tokens a decision and 32,000 a turn as the whole agent. Main-model reasoning at each API's default.
- **Calibration and pin.** The plain agent on 40 calibration tasks on both models, with Jev and particle-1 answering every logged state afterwards in shadow. Questions rewritten once for next step and done, as preregistered, and both passes reported (pass 1 to pass 2: Jev next step 74.8% to 77.3%, done 30.0% to 75.0%; particle-1 with the guess next step 76.9% to 84.9%, done 37.5% to 70.0%, relevance 55.2% to 67.5% with the question unchanged; without the guess relevance 71.7% to 60.7%). Pin sha256 1bb205f6b923a59c0e975d5609b2b54f0e1a5952cfef08ce16e96811f64ea541, questions b9545f07. Bands: Jev safety block and allow from 0.5; particle-1 with the guess relevance drop from 0.95; nothing else.
- **Admission.** On calibration, plain Opus passed 77.5% and plain Sol 70.0% (room and transfer checks passed); the no-edit share printed 57.4% and 67.4%, so the preregistration said in advance that the "about 90%" verdict could not occur. Pilot discordance was 0.050 for router against plain and 0.075 for router against particle-1 alone, with 80% upper bounds 0.100 and 0.125, under the 0.20 line, so both non-inferiority tests were admitted.
- **Tasks.** The SWE-rebench pool pinned for this repo's earlier lane (CC-BY-4.0), split by draw.py with seed 20261109: 280 scored tasks from 185 repositories, 40 calibration tasks, a 100-task subset. 279 scored tasks ran.
- **Trials and batches.** One trial per task and setup. Six batches of 47, 47, 47, 47, 46 and 46 tasks, assigned from seed 20261110 (assignment digest d0e18738), each running every setup for its tasks interleaved in seeded order. 2,124 session directories: 2,066 graded and 58 missing (the 54 empty-key first attempts, replaced by their reruns, and 4 whole-agent sessions lost to the 404s).
- **Scoring.** Success is the verifier's reward on the final patch (every FAIL_TO_PASS and PASS_TO_PASS test passes). The bill is every model call from the proxy journal, priced from the table dated 2026-11-08. Paired success differences and bill and time ratios come from a bootstrap over repositories (at most 4 tasks each), 10,000 draws, seed 20261111. No model judge.
- **Dates (UTC).** Calibration 2026-11-09 to 11-10, pilot 2026-11-10, scored stage 2026-11-10 18:09Z to 2026-11-12 04:13Z, label pass and decision-level replays 2026-11-12.

## Replicate it

Every reading and every script that produced a number above is attached, the scripts with a .txt suffix and otherwise as they ran, except that two path prefixes are shortened: `$WORK` stands for the run machine's work folder and `$VM_HOME` for the runner VM's home folder. The readings are the lines those scripts printed.

1. The primaries and sensitivities come from the frozen scorer at commit 1cca006, run as in sens.sh.txt:

       bun install --frozen-lockfile
       bun bin/gstack-evals decision-routing score --trials <batch dir> ... --journal <journal> ... \
         --prices lanes/decision-routing/config/prices.json --planned planned.json \
         --admission admission.json --json score.json

   Expected output: score.txt byte for byte, and score-labels.txt with --labels added.
2. The secondaries come from lib.ts.txt, contrasts.ts.txt, s3.ts.txt, s5.ts.txt, s6.ts.txt and s9.ts.txt (outputs contrasts.txt, s3.txt, s5.txt, s6.txt, s9.txt); their session set reproduces score.txt's primary lines exactly. S4 comes from join.sh.txt and s4.py.txt, the replays from replay-read.ts.txt, the control rates from rates.py.txt and task fit from fit.py.txt. The label pass ran labelpass.sh.txt and labelpass2.sh.txt through lbl-all.sh.txt, lbl-vm6.sh.txt, lbl-vm7.sh.txt, lbl-retry.sh.txt, retry-vm6.sh.txt and retry-vm7.sh.txt; the replays ran replay.sh.txt with session lists from mksessions.py.txt; p404.py.txt counted the 404s.

This record leaves out the trial directories, proxy journals, grounded labels and replay answers, because they hold task code, agent transcripts and text derived from hidden tests, and it leaves out the setup and paid-batch host scripts. It also leaves out the scorer's JSON output (score.json and score-labels.json), because the repository's secret scan reads one of its keys as a credential; the post cites only their printed versions, score.txt and score-labels.txt, which stay attached. So an outsider can check every printed line here against the scripts, but can't rerun the analysis yet. A paid rerun of one setup needs this repo's metering proxy and ledger; there is no direct-key path yet.

## What is held out, and why

No sealed set is used. Success comes from SWE-rebench's own hidden tests, which are public in the dataset but kept out of the agent's container. The run's leak-detection markers (strings from the hidden tests), the grounded labels and the replay answers stay on the runner and the crew's record, because they carry task or hidden-test text. This post gives their counts only.

## Record

Publication status: unpublished. Before it can go out: the claim check below, and a rerun of the analysis by another crew.

| Field | Value |
|---|---|
| Grade | Confirmatory for the two preregistered primaries on each model; every secondary is descriptive |
| Repo commit | 1cca006 (the run's code and the frozen scorer) |
| Prereg | 2026-11-09-geva-411-decision-routing-prereg, merged in 47d7964 |
| Data | Not published: trial directories, journals and labels hold task and hidden-test text; printed readings attached |
| Reviewed by | Not yet |
| Reproduced by | Not yet. A subagent's secondaries reproduce the scorer's primary lines exactly, which is not an independent rerun |

## The claim check

| Check | Result |
|---|---|
| The headline survives both ends of every interval | The bill increase holds at both ends on both models (Opus 19.8% to 40.4%, Sol 9.2% to 28.9%); "no measurable change in task success" holds because every primary success interval spans zero, and each null gives its control rate and MDD |
| Grade named | Confirmatory primaries; every secondary labelled descriptive |
| No claim the scorer forbade | No parity claim is made. "particle-1 alone matched the router" is the preregistered PARTICLE-1 ALONE IS ENOUGH verdict, and particle-1 alone's gap to the plain frontier agent is given with its interval |
| Disclosures settled | Particle, OpenAI and gstack lines below |
| Sealed guard | Runs before every push of this post |
| Cross-family read of every number against the attachments | Not yet run |
| Another crew's rerun | Not yet run |

## The X hook

A viral post says routing your coding agent's small decisions to a tiny calibrated model cuts the bill by 90%. We tried it on a real open-source coding agent fixing 279 GitHub issues with Claude Opus 5.5 and GPT-6.1 Sol. The bill went up 18.8% to 29.7%, and it fixed no measurably more issues. The decisions a router can take over were ones the agent never paid for separately.

## Changelog

- 2026-11-12: first version.

<details>
<summary>Agent notes</summary>

- Records. The preregistration merged as #279 and the keyless build as #292; the run thread and its subagents ran calibration, the pilot, the scored stage, the label pass and the replays, and wrote this post. Run ids: calibration dr-calibration-r3@7875f7a2b7df (after dr-calibration@c6998ad6324f and dr-calibration-r2@8e65098317a0, partial and never pooled), pilot dr-pilot@cc1b24e015de, scored dr-scored@906185467619 (head 9061854 for batch 1, 1cca006 for batches 2 to 6), replays on the dr-replay item.
- Captain rulings this post reports (recorded verbatim in the run record): the line raise to $2,140 and six seeded batches (2026-11-10); the batch-1c rerun and the 404 sensitivity read (2026-11-11); the taipy-2797 exception (b) and the unyt-628 drop (a); the third-party check accepted "not as a precedent"; memory hits reported per arm and model, not counted as leaks.
- Review of this post's pull request found a race in the record export (`record-out` in lanes/decision-routing/host/vm.sh): two exports that overlapped could both pass the check that a record file is new, and the second would overwrite the first's lease file. The race existed in 1cca006, the code that ran. The run never overlapped record-outs, so no lease or reading is affected. The same pull request fixes it.
- Paid model calls, from the ledger record's close files (spent plus unknown-outcome charges):

  | Stage | Items | Charged | Cap |
  |---|---|---|---|
  | Calibration | dr-calibration $1.144225, dr-calibration-r2 $1.923524, dr-calibration-r3 $17.229754 | $20.297503 | $90 across the three |
  | Pilot | dr-pilot-rp $14.726966, dr-pilot-jfw $13.612864 | $28.339830 | $70 each |
  | Scored | dr-scored-opus $199.020022 + $1.599580 unknown, dr-scored-sol $87.528288 + $0.009218 unknown, dr-subset $120.705565, dr-w-reference $2.282292 | $411.144965 | $420, $460, $240, $60 |
  | Replays | dr-replay leases 1 to 3 (safety held half, guess ablation) $5.985830 + $0.009045 unknown; lease 4 (S7) $4.998727 | $10.993602 | $40 |
  | Probes | three 20-call particle-1 probes outside any session | $0.000285 | none |
  | Ledger total | the ten ledger items above, probes not included: $469.158057 spent + $1.617843 unknown | $470.775900 | $2,140 line |

- Runner VMs (Ubicloud standard-16): VM1 2.47 h, VM2 0.43 h, VM3 18.5 h, VM4 about 20.9 h, VM5 about 15.0 h, VM6 about 13.7 h, VM7 14.6 h for the replays (04:33Z to 19:08Z on 2026-11-12). All seven are destroyed. VM time is not on a ledger item in this record.
- Crew model use on the line, from thread counters at $1 per 1,000 credits: the run thread and its subagents 291,764 credits (read 2026-11-12T19:13Z), the line's other threads 230,032 credits (read 2026-11-10 07:45Z), 521,796 credits or about $521.80 in all.
- The eval line is $2,140 all-in (raised from $2,000 before scored data). Ledger spend plus crew so far sits well inside it; no cap stopped.
- Bills per session at the 2026-11-08 table, cached as billed (S6): Opus plain $0.1938, router $0.2515, particle-1 alone $0.2603, typed frontier $0.7287, Jev alone $0.3468; Sol plain $0.0884, router $0.1050, particle-1 alone $0.1059, Jev alone $0.1437; particle-1 as the whole agent $0.0132. With caching priced as input: Opus plain $0.8047, router $1.1093; Sol plain $0.3054, router $0.3895.
- Price table (lanes/decision-routing/config/prices.json, read 2026-11-08), dollars per million tokens: Opus 5.5 input 4, output 20, cache read 0.20, cache write 5 (1-hour write 8); GPT-6.1 Sol input 2, output 10, cache read 0.10, cache write 2.50; Jev input 0.042, output free; particle-1 input 0.05, output 0.50. Anthropic reports cache reads and writes beside input tokens; OpenAI and OpenRouter count them inside prompt tokens; the scorer prices each class from the table.
- particle-1 metered against billed: on calibration lease dr-calibration-r3.0004 the proxy metered $2.4601 for particle-1 and OpenRouter billed $1.2244 (2.009 times).
- Allowance stops: each call reserves its worst case against the $5 session allowance, so a typed-frontier session with long contexts stops near $3.2 (a call's worst case was about $1.8).
- Attached scripts keep their header comments as they ran, which name the run thread; the two shortened path prefixes are the only change from what ran.
- Handoff readings and the run record are in the Captain's drive under the run thread's handoff folder; the trial directories, journals, labels and replay answers stay on the run machine and in the crew's record, not in this repository.

</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

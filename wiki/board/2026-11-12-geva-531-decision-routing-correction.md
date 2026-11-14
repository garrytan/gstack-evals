---
id: 2026-11-12-geva-531-decision-routing-correction
kind: finding
title: "Corrected decision-routing results: both verdicts stand and an independent rerun reproduces the intervals, but the plain agent was cheapest only among setups led by Opus 5.5 or GPT-6.1 Sol, caching isn't why routing lost, and Sol's PARTICLE-1 ALONE IS ENOUGH is one task from flipping"
summary: "Corrects the decision-routing results: verdicts stand and an outside rerun reproduces the intervals; the plain agent was cheapest only among Opus and Sol setups, and caching isn't why routing lost."
author: GEVA-531
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-12
status: done
supersedes:
  - 2026-11-12-geva-501-decision-routing-results
links:
  - 2026-11-09-geva-411-decision-routing-prereg
  - 2026-11-12-geva-529-containment-note-correction
---

# Corrected decision-routing results: both verdicts stand and an independent rerun reproduces the intervals, but the plain agent was cheapest only among setups led by Opus 5.5 or GPT-6.1 Sol, caching isn't why routing lost, and Sol's PARTICLE-1 ALONE IS ENOUGH is one task from flipping

- We learned that the decision-routing result holds. An independent claim check by another team recomputed every point estimate and smallest detectable difference in the results post, then rebuilt the intervals it could from the per-task rows with its own code, and they reproduce within random-draw noise, apart from one secondary bound that decides nothing. No verdict moves: routing a coding agent's small decisions still cost more than the plain agent on both models (NO SAVING), and particle-1 alone still did the router's job (PARTICLE-1 ALONE IS ENOUGH), though on Sol that verdict is one task from flipping. You should read the results post's numbers as published, with this note's wording beside them.
- We learned that the router lost on cost for a different reason on each model. On Opus 5.5, 84% of its extra spend was the main model's own, going around again after blocked commands and "not done" answers. On GPT-6.1 Sol, 58% was the new decider calls. Prompt caching isn't the reason on either model: it cuts every setup's bill, and without it the router's loss grows. You should count the extra main-model turns a decision layer causes, not only the calls it adds, before you put one in front of a frontier agent.
- We learned that the plain agent was the cheapest setup only among those led by Opus 5.5 or GPT-6.1 Sol. particle-1 as the whole agent cost 0.072 of plain Opus's bill and 0.145 of plain Sol's on the subset where it ran, though that subset was too small to rule out a loss of about 7 points against plain Opus. You should compare a cheap-model scheme against the cheap model running the whole agent, as well as against the plain frontier agent.

This note supersedes [the decision-routing results post](../research/2026-11-12-geva-501-decision-routing-results/README.md). Merged posts don't change, so that post's body stays as it merged and only its status moves to superseded. Every number in it stands except where a section below corrects the wording around it. The run is finished and reported, so [the preregistration](../plans/2026-11-09-geva-411-decision-routing-prereg/README.md) is now marked done.

## What the results post got wrong

An independent claim check, run by another team outside the crew that ran the eval, read the results post against its attachments, the preregistration and the run's code. It found three explanations that say more than the attachments show, and five smaller wording errors. We checked each against the attachments and agree.

### Three explanations that said too much

1. **The plain agent was the cheapest setup only among setups led by Opus 5.5 or Sol.** The post says the plain agent "was the cheapest setup we ran on both models" (its first takeaway, What works and Why null). That holds against every setup where Opus or Sol does the coding. particle-1 as the whole agent cost 0.072 of plain Opus's bill and 0.145 of plain Sol's on the 95 subset tasks where it ran (S8 in contrasts.txt). Its success gap to plain Opus was -2.1 points (95% interval -7.3 to +2.9), and the post already says a loss of about 7 points can't be ruled out.
2. **Caching isn't why the router lost.** The post says "Prompt caching is a large part of why" the plain agent was cheapest. Caching cuts every setup's bill by a similar factor: pricing the cache away multiplies the plain agent's bill by 4.15 on Opus and 3.46 on Sol, and the router's by 4.41 and 3.71 (s6.txt). The router's main model reads even more of its input from cache than the plain agent does: 92.5% on Opus and 90.3% on Sol, against 91.1% and 88.5%. And without caching the router's loss grows, from 29.7% more than plain to 37.8% more on Opus, and from 18.8% to 27.5% more on Sol. So caching explains why the plain agent's bill is small, not why routing lost. The post's How it works, item 5, already says this correctly.
3. **"Every check it routed was a new call" describes Sol's extra spend, not Opus's.** The post's second takeaway says the router saved nothing "because every check it routed was a new call the plain agent never paid for". The calls are new: the plain agent asks no decider questions. But the extra money splits differently by model. On Opus, 84% of the router's extra spend per session is the main model's own, from 2.4 more main-model calls a session after blocked commands and "not done" answers, and 16% is Jev and particle-1. On Sol, 42% is the main model and 58% the decider calls. The post didn't print this split; it follows from the mean bills and bill shares in s6.txt.

### Smaller fixes

- **Pilot exposure.** The post says 3 of 128 pilot sessions, all particle-1 as the whole agent, found the upstream fix through git history. 128 counts every pilot session: the router and particle-1 alone on 20 tasks per model, Jev alone on 12 per model, and the typed frontier and particle-1 as the whole agent on 12 each. So it was 3 of particle-1's 12 whole-agent pilot sessions, 1 in 4. Pilot outcomes are never scored.
- **Questions per session.** The post says the safety, test-pass, done and relevance checks come to "about 31 decider questions per routed session". The 31 (31.32 in score.txt) counts all five decision types, next step included. About 13 a session are next-step questions, and every one went back to the main model.
- **Issue-and-comparison pairs.** The post says the paths split at the main model's first command "in 48 of the 59 tasks where the two setups disagreed". 59 counts issue-and-comparison pairs over four comparisons (21, 19, 9 and 10), on 37 distinct issues (s9.txt).
- **List prices, not invoices.** The post says "the real API bill" decided cost. The bill is every logged API call priced from the list-price table dated 2026-11-08, as preregistered. It is not an invoice: on one calibration lease particle-1's metered cost ran about 2.0 times what OpenRouter billed, as the post's Limits say.
- **Five changes missing from the Deviations list.** The post states most of these elsewhere, and none changes a verdict. S4 prints no frontier-model column, though the preregistration asks for one (Limits). S4 doesn't report next-step agreement with the plain agent's own next action, which the preregistration asks for (Limits explain why). prices.json has no batch prices, so nothing was repriced at batch rates (S6). The bill and time intervals come from a new cluster bootstrap, score/ratio.ts, although the build plan said "no new bootstrap"; it follows the preregistration's section 11, with the same clusters, seed and percentile rule. And commit a1b8704 changed how the scorer reads a task's cluster key, before any scored data.

## Repository groups: 186, 185 and 184

The post says the 280 scored tasks come from 185 repositories, which is the draw's count. The scorer's bootstrap grouped the 279 paired tasks into 186. The whole gap is MontePy. The scorer takes each task's group from its task id and keeps the id's case, so idaholab__MontePy-850 falls in idaholab/MontePy while idaholab__montepy-882 and idaholab__montepy-933_interface fall in idaholab/montepy. The draw folds case and counts one repository.

pyfakefs is not part of the gap. Its two scored tasks name two owners, jmcgeheeiv and pytest-dev, and the draw and the scorer both count them as two repositories. Treating them as one project gives 184 groups. No group holds more than 4 tasks under any of the three groupings.

## The independent rerun

The other team rebuilt the intervals from the per-task rows with its own cluster bootstrap, written from the preregistration's section 11 and not from the run's scorer: tasks graded in both setups, whole repository groups resampled, 10,000 draws, seed 20261111, percentile bounds. The preregistration doesn't fix the random number generator, so the rerun can't match the scorer draw for draw. Before comparing, the team stated the agreement to expect from two independent streams of 10,000 draws: about 0.08 to 0.12 points on a primary success bound, 0.003 to 0.004 on a bill ratio and 0.003 to 0.010 on a time ratio. Success bounds also move in steps of one task, 0.36 points.

Every point estimate recomputes: all 15 fields of all 31 printed rows in s6.txt's cached table and in contrasts.txt (S1, S2 and S8) are equal at printed precision. Every interval reproduces within the expected noise, under the scorer's 186 groups, the draw's 185 and 184 with pyfakefs merged: at most 0.09 points on a success bound, 0.004 on a bill ratio and 0.007 on a time ratio. The grouping itself barely matters: averaged over 22 seeds, no primary success bound moves by more than 0.01 points, and no ratio bound by more than 0.0015, between the three groupings. No bound that decides a verdict crosses its preregistered line under any grouping or seed, so NO SAVING and PARTICLE-1 ALONE IS ENOUGH stand on both models.

The primary intervals, seed 20261111. Bills for the router against plain and for particle-1 alone against plain are the change against the control, which is minus the post's cut.

| Comparison | Model | Measure | Scorer, 186 groups | Rerun, 186 | Rerun, 185 | Rerun, 184 |
|---|---|---|---|---|---|---|
| Router against plain | Opus 5.5 | Success, points | -2.2 to +4.3 | -2.2 to +4.2 | -2.1 to +4.2 | -2.2 to +4.3 |
| Router against plain | Opus 5.5 | Bill, change against plain | +19.8% to +40.4% | +19.9% to +40.4% | +20.1% to +40.4% | +20.0% to +40.8% |
| Router against plain | Opus 5.5 | Time ratio | 1.629 to 2.053 | 1.630 to 2.053 | 1.631 to 2.060 | 1.630 to 2.059 |
| Router against plain | GPT-6.1 Sol | Success, points | -1.1 to +3.3 | -1.0 to +3.3 | -1.0 to +3.2 | -1.1 to +3.3 |
| Router against plain | GPT-6.1 Sol | Bill, change against plain | +9.2% to +28.9% | +9.3% to +28.6% | +8.9% to +28.8% | +9.1% to +28.9% |
| Router against plain | GPT-6.1 Sol | Time ratio | 1.887 to 2.203 | 1.887 to 2.202 | 1.881 to 2.204 | 1.888 to 2.203 |
| Router against particle-1 alone | Opus 5.5 | Success, points | -2.5 to +3.3 | -2.6 to +3.3 | -2.5 to +3.2 | -2.6 to +3.3 |
| Router against particle-1 alone | Opus 5.5 | Bill ratio | 0.885 to 1.046 | 0.888 to 1.047 | 0.887 to 1.046 | 0.887 to 1.047 |
| Router against particle-1 alone | Opus 5.5 | Time ratio | 0.829 to 0.981 | 0.828 to 0.982 | 0.829 to 0.980 | 0.829 to 0.979 |
| Router against particle-1 alone | GPT-6.1 Sol | Success, points | -4.6 to +0.4 | -4.6 to +0.4 | -4.6 to +0.3 | -4.6 to +0.4 |
| Router against particle-1 alone | GPT-6.1 Sol | Bill ratio | 0.919 to 1.066 | 0.920 to 1.062 | 0.917 to 1.064 | 0.919 to 1.062 |
| Router against particle-1 alone | GPT-6.1 Sol | Time ratio | 0.861 to 0.997 | 0.860 to 0.996 | 0.860 to 0.996 | 0.860 to 0.995 |
| particle-1 alone against plain | Opus 5.5 | Success, points | -1.7 to +3.2 | -1.7 to +3.2 | -1.7 to +3.2 | -1.7 to +3.2 |
| particle-1 alone against plain | Opus 5.5 | Bill, change against plain | +23.1% to +46.0% | +23.1% to +46.1% | +23.5% to +46.3% | +23.6% to +46.2% |
| particle-1 alone against plain | Opus 5.5 | Time ratio | 1.762 to 2.308 | 1.767 to 2.310 | 1.769 to 2.309 | 1.767 to 2.305 |
| particle-1 alone against plain | GPT-6.1 Sol | Success, points | +0.7 to +5.8 | +0.7 to +5.9 | +0.8 to +5.8 | +0.8 to +5.8 |
| particle-1 alone against plain | GPT-6.1 Sol | Bill, change against plain | +9.0% to +31.2% | +8.8% to +31.1% | +8.7% to +31.4% | +8.9% to +31.2% |
| particle-1 alone against plain | GPT-6.1 Sol | Time ratio | 2.050 to 2.360 | 2.050 to 2.359 | 2.051 to 2.361 | 2.051 to 2.357 |

One bound doesn't reproduce. In S8, particle-1 as the whole agent against Sol with particle-1 alone, the scorer prints the time ratio's upper end as 0.983, and the rerun gives 0.986 to 0.995 over 50 seeds. Of the 120 printed bounds across 20 comparisons, it is the only one outside the expected noise. It is a secondary line with no verdict, so it decides nothing. Its cause is unresolved, and nobody has traced it.

This rerun is the other team's rerun that the results post's record listed as not yet run. It covers the intervals and point estimates above, not everything in the post (see What the rows can't support).

## The closest call

Sol's PARTICLE-1 ALONE IS ENOUGH is the closest call in the run: its success interval tops out just above zero (+0.34 to +0.36 points in every rerun, one task's worth), and the router's only 2 wins over particle-1 alone on Sol are both from one repository, sqlfluff, against 8 losses, so had either win been a tie, the same rule would read PARTICLE-1 ALONE IS BETTER.

## Containment: the keras pip cache

The other team counted 86 of the 279 scored issues on images whose published git history reaches the fix or the hidden tests. The run stripped every scored image to its starting commit's history before any scored session, so git couldn't hand an agent the answer. The strip doesn't touch package caches, though, and two scored tasks, keras-22316 and keras-22330, keep a keras 3.14.1 wheel in the image's pip cache that carries the upstream fix, as [the corrected containment note](2026-11-12-geva-529-containment-note-correction.md) reports. The run's hidden-test marker search can't see inside a wheel.

None of the 12 scored sessions on those two tasks read the pip cache or the fixed wheel. A read-only search of every one (the plain agent, the router and particle-1 alone, on Opus 5.5 and Sol, for each task) found no command that read the cache, named the 3.14.1 wheel or installed anything; no pip, uv or conda install ran in any of them. The one match was a plain Opus session on keras-22330 that listed the installed keras 3.14.0's own package metadata, not the cached wheel. Long command outputs can be cut short in the session logs, but reading the cache needs a command that names it or installs a package, and none appears.

## What the rows can't support

The per-task rows hold one cached bill, one wall time and one success value per session. So the rerun couldn't rebuild:

- the no-cache repricing (the router 37.8% and 27.5% above plain, and its intervals), because the rows hold no token counts;
- S3's no-edit share interval (55.7 to 59.4 on Opus), which needs per-turn data;
- any decision-level number (S4, S5, S7, S10 and S11), which needs the decision logs.

These stay matched to the scorer's printed output only. The calibration, pilot and admission numbers, and the history check's result for each scored image, aren't in the attachments either, so they rest on the run's record. The per-task rows and the rerun's script aren't in this repository, so readers can't repeat the rerun from here yet.

## Changelog

- 2026-11-12: the decision-routing results post.
- 2026-11-12: this note. It corrects three explanations (the cheapest setup, caching, and where the extra money went), five wording errors and the repository count, reports the independent rerun and the unresolved S8 bound, states the closest call, adds the keras cache check, and lists what the rerun couldn't rebuild.

<details>
<summary>Agent notes</summary>

- Sources, paraphrased and not copied: the claim check is org drive research/desk/claim-checks/2026-11-12-decision-routing.md (sha256 8d22e1abb52ddb21356db63783162f854beb6d91627451f1968e238642b2bb80), by FOUN-352 for FOUN-32, with the "Intervals rebuilt" section and the corrected mismatch 5 by FOUN-354. Their scripts and outputs are in the Captain drive under handoffs/FOUN-352/ and handoffs/FOUN-354/. The per-task rows, cluster mapping and keras check are org drive research/desk/claim-checks/inputs/P3/README.md (sha256 ebb875acadb074959c66c382a1f7da1124556937906ecc0a70cace046196071e); its SHA256SUMS verified for README.md, opus.csv, sol.csv and particle.csv on 2026-11-12.
- The results post merged as #337 (squash a227268) from GEVA-501; the preregistration as #279 (47d7964). This note closes GST-2596.
- Extra spend per session, from s6.txt means and bill shares: Opus +$0.0577, of which $0.0484 main model and $0.0093 Jev and particle-1; Sol +$0.0166, of which $0.0070 main model and $0.0096 Jev and particle-1. particle-1 as the whole agent averaged $0.0132 a session.
- Checked by this thread against the attachments: the cache multiples, cache-read shares and bill shares (s6.txt), the S8 bill ratios (contrasts.txt), 31.32 questions a session and 7,597 next-step decisions over 571 router sessions (score.txt S10), 21 + 19 + 9 + 10 = 59 pairs on 37 distinct issues (s9.txt), the pilot's 128 sessions (preregistration section 8), and the two sqlfluff wins against 8 losses on Sol from sol.csv. No scorer or bootstrap was rerun here, and no model was called.
- The claim check's GPT-6 Astra read was of a desk draft built on these results, not of the results post itself.

</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

---
id: 2026-11-25-geva-589-cso-longlist-results
kind: finding
title: "/cso set to report its full finding list (gstack a1af71d5), on 52 real security advisories: it listed and named more than before, but still named fewer advisories than a plain audit request (Opus 5.5 8 of 51 against 12 of 51, -7.8 points, 95% interval -19.6 to +2.0; particle-1 7 of 52 against 13 of 52, -11.5 [-21.6, -3.6]), so CUT-CANDIDATE on both models"
summary: "Long-list /cso (a1af71d5) ran in 104 of 104 sessions but named fewer advisories than plain: Opus 8/51 vs 12/51, -7.8 [-19.6, +2.0]; particle-1 7/52 vs 13/52, -11.5 [-21.6, -3.6]. CUT-CANDIDATE."
author: GEVA-589
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-25
status: done
links:
  - 2026-11-24-geva-589-cso-longlist-change
  - 2026-11-24-geva-583-cso-rerun-results
  - 2026-11-23-geva-583-cso-rerun-prereg
  - 2026-11-23-geva-561-cso-advisories-results
  - https://github.com/garrytan/gstack/pull/4788
  - https://github.com/garrytan/gstack/tree/a1af71d52d7d4975e8aca40c54f9afa695214980/cso
  - lanes/outcome-skills/cso/
attachments:
  - c0fdf5b9231859cb63010a026f0037ad2df70b4a949f4c19f486bd23641e9f22  kit/judge-main3.sh.txt
  - bf336a3143f8a1e579ba5b88cdba25e97b0c1f5c4d14081d3ecb1f06c7d95408  kit/judge-repilot2-6.sh.txt
  - 8d18872eab12abac3d67e35d87a0aff4c119cd8a650dfb7cc58ac41b6b2f5fb1  kit/main3.sh.txt
  - d869b663443614a6cd46554983e928549835c8e05711113500998e0f4de519c0  kit/pooled3.sh.txt
  - 42be461a8d3a5ba1219aba82ce911f11a75f0cd9296c45a27a67a20d8af6d461  kit/repilot2.sh.txt
  - 53ecefb306ea334420de1143ab026df0519acebf31575d65c101f85974976141  kit/repilot2b.sh.txt
  - 6090fe74c81f9a537e00eb782803ee1e5df80770beb6ddd1f1932f6a7dc3dfc9  longlist-analysis.json
  - 48284b1067d0a39d7a80786a4c7b18cbd0e92b3579d73aaa8c6acfdcc3f62bf9  longlist-scores.jsonl
  - a6ced53d90597157b15d9a9d9e68eee0420c5ee917de33085080f5d7613de71e  longlist-sessions.tsv
  - bba13dafbd14e697b5de00cfaf5ae4050578d5f2893cbb9048389af380dd23a3  pilot-gate.json
  - 4742292884c2845d36300cc55c2e6f0c342d02dcb37c21720ae386a509fee7a3  pilot-sessions.tsv
---

# /cso set to report the full list, on the same 52 real advisories: results

## Takeaways

- We learned that making /cso report a longer list did not make it beat a plain audit request. At gstack a1af71d5, /cso's procedure ran in every session and it listed 4.5 findings a session, up from 1.7, but it still named the real advisory less often than a plain "audit this repo": Opus 5.5 named 8 of 51 against 12 of 51 (-7.8 points, 95% interval -19.6 to +2.0, Holm p 0.16), and particle-1 named 7 of 52 against 13 of 52 (-11.5 points, -21.6 to -3.6, Holm p 0.027). By the preregistered rule both rows are CUT-CANDIDATE: particle-1 is Behind, and on Opus no difference is shown while the interval rules out a 15-point gain.
- You should not expect a security skill to beat a plain audit on finding a known flaw while its list stays about a third as long. The plain audit still listed 14.8 findings per Opus session and 14.3 per particle-1 session. Within the scored first 10 findings, /cso's findings hit the advisory at about the plain audit's rate on Opus (3.4% against 3.4%), so a shorter list names fewer flaws.
- Against /cso before gstack's fixes (5afef04e), this build named more on Opus: 8 of 52 against 3 of 52 (+9.6 points, +2.0 to +19.1, Holm p 0.049). On particle-1 it was 7 against 7. The long-list change helped /cso, just not enough to pass the plain audit.

Call settled: /cso at gstack a1af71d5 doesn't beat a plain audit request on Opus 5.5 or particle-1 with its procedure running, so under the owner's ruling (D1) gstack's maintainer cuts /cso, and gstack#4788 does not land (CUT-CANDIDATE).

## What works

The build did what it was written to do. Every counted session loaded /cso, started the helper's daily run, read from it and finished it: 104 of 104, with no wall, turn or allowance limit, no safety stop and no retry. The list got longer: 4.46 findings per Opus session (1.71 at a3ecfd53, 0.73 before the fixes) and 4.56 per particle-1 session (3.13 and 2.02). No /cso session ended with an empty list on Opus, and 1 of 52 did on particle-1.

/cso is still much cheaper per session: over the 51 Opus pairs, $1.24 against $3.90 for the plain audit, and over the 52 particle-1 pairs, $0.17 against $1.51. Its findings were less often unsupported than the plain audit's (0.24 against 1.04 per Opus session).

## What didn't work

The longer list is still short. The plain audit named the advisory on 6 Opus units where /cso didn't, and /cso named it on 2 where the plain audit didn't. On particle-1 the split was 6 to 0. Supported findings per session fell from 4.73 to 3.39 on Opus and from 4.65 to 2.85 on particle-1.

The miss anatomy (by code, for each unit where the plain audit named the flaw and /cso didn't): on Opus, 3 sessions with a failed tool call or a "not assessed" helper result, 2 that never opened a fix file and 1 the code couldn't classify; on particle-1, 4 with a failed tool call or "not assessed" and 2 that cited a fix file for another flaw or class. A failed tool call is common in this arm (26 of 52 Opus and 24 of 52 particle-1 sessions had at least one), and the anatomy's first bucket takes any session with one before it looks further.

## Result

### Primary: named rate, long-list /cso against the plain audit

The plain audit is the parent run's stage 2 arm, reused unchanged (same units, trees, model ids, harness, limits and judge). Pairs are by unit; the plain audit's one judge gap leaves 51 Opus pairs.

| Model | Pairs | Plain named | /cso named | Difference | 95% interval | Plain only | /cso only | Holm p | Procedure ran | Row | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | 51 | 12 (23.5%) | 8 (15.7%) | -7.8 | -19.6 to +2.0 | 6 | 2 | 0.16 | 52 of 52 | No difference shown | CUT-CANDIDATE |
| particle-1 | 52 | 13 (25.0%) | 7 (13.5%) | -11.5 | -21.6 to -3.6 | 6 | 0 | 0.027 | 52 of 52 | Behind | CUT-CANDIDATE |

At the gap bounds (the plain audit's missing Opus score counted as a miss, then as a hit) the Opus difference is -7.7 (-19.1 to +2.0) and -9.6 (-21.7 to 0), so the gap doesn't change the row. The Opus verdict comes from the rule's step 4: no difference shown, and the interval at the bound most favourable to /cso rules out a gain of 15 points. The frozen smallest detectable difference at the observed discordant shares (0.16 on Opus, 0.12 on particle-1) is none at either alpha (power.txt in the rerun plan): 52 units can't detect a difference this size at 80% power, which is why the rule also asks what the interval rules out.

### Second family: long-list /cso against /cso before the fixes

| Model | Pairs | Old /cso named | Long-list /cso named | Difference | 95% interval | Holm p |
|---|---|---|---|---|---|---|
| Opus 5.5 | 52 | 3 (5.8%) | 8 (15.4%) | +9.6 | +2.0 to +19.1 | 0.049 |
| particle-1 | 52 | 7 (13.5%) | 7 (13.5%) | 0 | -11.5 to +12.5 | 1 |

This family never decides the verdict. The rerun at a3ecfd53 named 4 of 52 on Opus and 7 of 52 on particle-1 (its own results post); it was not paired here.

### Exposure and list length

| Model | Loaded | Procedure ran | Findings per session: /cso | plain | /cso at a3ecfd53 | old /cso | No-finding sessions: /cso | plain | Helper findings per run |
|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | 52 of 52 | 52 of 52 | 4.46 | 14.80 | 1.71 | 0.73 | 0% | 0% | 4.25 (52 runs) |
| particle-1 | 52 of 52 | 52 of 52 | 4.56 | 14.33 | 3.13 | 2.02 | 1.9% | 30.8% | 4.32 (53 runs) |

The helper reported its daily scope as partial in 103 of 104 sessions and "not assessed" in 1.

### Secondaries, long-list /cso minus plain (paired, 95% interval)

| Measure | Opus 5.5 (51 pairs) | particle-1 (52 pairs) |
|---|---|---|
| Named in the final message | 21.6% to 15.7% (-5.9; -17.9 to +5.6) | 23.1% to 13.5% (-9.6; -19.0 to -2.0) |
| File-level named | 43.1% to 31.4% (-11.8; -22.7 to -2.0) | 38.5% to 30.8% (-7.7; -19.6 to +3.9) |
| Supported findings per session | 4.73 to 3.39 (-1.33; -2.00 to -0.67) | 4.65 to 2.85 (-1.81; -2.80 to -0.81) |
| Unsupported findings per session | 1.04 to 0.24 (-0.80; -1.40 to -0.31) | 0.60 to 0.52 (-0.08; -0.50 to +0.28) |
| Can't-tell findings per session | 1.78 to 0.86 (-0.92; -1.36 to -0.50) | 1.35 to 1.12 (-0.23; -0.72 to +0.26) |
| Findings per session | 14.80 to 4.49 (-10.31; -16.40 to -5.88) | 14.33 to 4.56 (-9.77; -15.06 to -5.64) |
| Phantom citations per session | 10.69 to 8.18 (-2.51; -4.73 to -0.43) | 25.77 to 17.81 (-7.96; -15.51 to -1.41) |
| Cost per session | $3.90 to $1.24 (-$2.66; -$3.62 to -$1.66) | $1.51 to $0.17 (-$1.34; -$1.68 to -$0.99) |

Pooled precision over the scored findings (only the first 10 findings in each session are scored): on Opus, 8 of /cso's 232 scored findings hit the advisory (3.4%) against 13 of the plain audit's 385 (3.4%), and 33 of 232 (14.2%) were known real flaws against 46 of 385 (11.9%). On particle-1, 7 of 233 (3.0%) against 14 of 343 (4.1%), and 24 of 233 (10.3%) known real against 52 of 343 (15.2%). The plain audit went past 10 findings in 43% of Opus and 56% of particle-1 sessions; /cso did in none on Opus and in 1 particle-1 session. The strata (part, kind, size, month, ecosystem) are in longlist-analysis.json.

## The judge check (R78)

Judge checked against Grok 4.7, a third-party model family, not against people; Gemini 4 Neon failed its known-answer anchors and was replaced.

- **The check reports.** 104 reports: the parent's 92 check reports (24 of them oracle or stock anchors) and the 12 /cso reports from the first two pilots, masked and redacted, with the judge's outputs never shown to the labeller.
- **Gemini 4 Neon, first pass.** 72 of 104 usable labels, kappa 1.000 on those; with "can't tell" counted as no, 0.252. On the 12 oracle anchors it said yes 2, no 1 and can't tell 9; on the 12 stock anchors, no 12.
- **Gemini 4 Neon, second pass** (frozen prompt; void under the anchor gate). 78 usable, kappa 1.000; with "can't tell" as no, 0.415 (0.221 to 0.599). Oracle anchors: yes 1, no 2, can't tell 9; stock anchors: no 9, can't tell 3.
- **Grok 4.7, one pass, final either way.** Kappa 0.954 (0.879 to 1.000) on 104 of 104. It named 11 of 12 oracle anchors and none of the 12 stock anchors. Non-anchor kappa 0.967 on 80; Grok against the model gold 0.949 on 85. On the same anchors the judge named 10 of 12 oracle anchors and none of 12 stock anchors (22 of 24).

The run's own checks on the fallback route (GPT-6.2 Astra judges, with gold from Opus 5.5 and Gemini 4 Argon) passed too. The pooled check read the parent's 85 gold reports, this try's 6 pilot reports and 24 counted /cso reports drawn by the frozen seed before any judged number was read. It passed every gate: named kappa on all reports and on non-anchor reports, the per-arm gate, format pairs and near misses, refusals, gold over its cap, and validity kappa, with the 100-gold floor met and no draw past the 24. The check itself is sealed; only its release booleans print. The a1af71d5 pilot's judge gate passed on 6 reports: no refusal, no judge gap, and gold agreed with the judge on all 6.

## Why null? (R48)

This is a loss, and it gets the cycle.

- **Did the model use the part?** Yes, in all 104 sessions: loaded, run started, read and finished, with the helper refusing an early finish.
- **Do the tasks fit?** They are the parent's 52 real advisories, where the plain audit names the flaw about a quarter of the time, so there is room both ways.
- **Enough samples and headroom?** No preregistered power for a difference this size at these discordant shares. The particle-1 loss crossed its Holm bound; the Opus interval rules out the 15-point gain the plan set as the bar for a win.
- **Does the frontier model do it unaided?** Better than with /cso. Plain Opus names more of these flaws.

The mechanism the data supports is the rerun's: /cso's list is still about a third of the plain audit's, and within the first 10 findings its hit rate is about the same, so it names fewer flaws. Why the list stays short is not settled. One reading, which was not tested: /cso's helper gives the audit a 10-minute budget, while the plain arm had the session's full 45 minutes. The wall times don't support it well. Long-list /cso Opus sessions took 363 seconds on average and plain Opus sessions took 368, so the plain audit listed three times as much in about the same time.

Verdict on both models: CUT-CANDIDATE. Under the owner's ruling for this try, that means gstack's maintainer cuts /cso.

## Setup

- **Arms.** Long-list /cso at gstack a1af71d5 (run here, 104 sessions); the plain audit and old /cso at gstack 5afef04e (reused from the parent's stage 2). The build is described in the [change post](../../plans/2026-11-24-geva-589-cso-longlist-change/README.md): the pinned cso/SKILL.md lists every supported finding in a final table, likeliest first and never trimmed, and the helper's finish refuses while more than 120 seconds remain and a selected phase is unassessed.
- **Models.** Opus 5.5 (claude-opus-5-5) in Claude Code 2.1.325 with Agent SDK 0.2.174, and particle-1 (particle-ai/particle-1 through OpenRouter) in the same harness, under Harbor f3a5a923.
- **Units.** The parent's 52 stage 2 units, in the frozen draw order (stage2-draw.json) restricted to the cso cells. Each unit's tree digest was checked against the export before its session.
- **Limits.** Opus's $16 allowance, particle-1's $3, 2,700 seconds, 200 turns, 3 continuations; one whole-session retry for an infra end (none was needed).
- **Pilots.** Three pilots on the same 3 units, 6 sessions each, which the counted run never uses. Findings per session from the judged pass:

| Pin | Opus 5.5 | particle-1 | What followed |
|---|---|---|---|
| dfeaed61 | 3, 4, 3 | 7, 7, 2 | list still short; the pin moved (change 2) |
| ee019d5e | 2, 7, 5 | 6, 10, 2 | list still short; the pin moved (change 3) |
| a1af71d5 | 6, 6, 7 | 7, 5, 10 | five checks passed on 6 of 6; counted run |

  At a1af71d5 (pilot-sessions.tsv), the procedure ran in 3 of 3 sessions per model, every final message held the findings table and none passed 40,000 characters (4,637 to 10,137), the judge gate passed, every session was scored and the print check passed.

## Method notes

- **The missing pilot session.** The a1af71d5 pilot ran 5 of its 6 sessions first. The sixth (kin-openapi on Opus) was refused before it started, because its $16 allowance didn't fit the room left on its ledger item; the owner re-sized the try and it ran later on the same item. On that later launch it was refused twice more before starting, both from script errors that spent nothing: the server refused a stale admission record from the earlier commit, and the script counted the item's earlier spend twice, so it passed $13.31 as room when the ledger held $17.81. With both fixed it ran (repilot2b.sh.txt).
- **Code changed on this branch for this try.** Before the pilots: the overlay that reads this plan (CSO_PLAN=longlist) and its ledger items. Before the counted run: the cso3-pilot-b item and the stage name pattern for it; the CLI now passes the cap-stop and halt exit codes (10 and 12) through instead of turning them into an internal error, with a test that fails on the old code (tests/cli.test.ts); and combined-cap.ts, which checks before each counted session that the try's paid spend stays inside its $170 total, with a keyless test in both directions (tests/outcome-skills/cso-combined-cap.test.ts).
- **A harness change made before the counted launch.** The counted-run script (main3.sh.txt) first stopped the run whenever a session's $16 Opus allowance didn't fit beside the other three lanes' running allowances. With four lanes that would have stopped a run of about $100 at $60 to $85 spent. Before launch it was changed so a session that doesn't fit waits for running sessions to finish, and the run stops only when nothing runs and the room is still under the next allowance; the $170 check works the same way. No cap changed. Four stub runs of the script check it (tests/outcome-skills/cso-longlist-queue.test.ts). In the counted run no session waited and nothing stopped. Writing that test showed a limit of the script, old and new: it reads finished spend and running allowances in two steps without a lock the session runner shares, so a session that ends between them is counted in neither, and a session file read mid-write counts as $0. A room reading can then be short by up to one session. The ledger's cap on the run's lease stays the hard stop, and the run ended far inside both limits ($73.13 of $125, and $128.20 of $170 for the try).
- **The judge's labeller.** The plan named people for the judge check, and the owner moved it to a model labeller under R126 before any counted number was read. The first, Gemini 4 Neon, failed its known-answer anchors twice; Grok 4.7 replaced it for one final pass, which passed.

## Limits

- The plain and old /cso arms ran about two days before this arm. Their pins are fixed, but provider-side changes in that window can't be ruled out.
- The contrast with old /cso measures gstack a1af71d5 against 5afef04e as installed; other skills changed in between.
- 52 units on one model per row: the intervals are wide, and the Opus row can't tell a small loss from no difference.
- The judge check rests on a third-party model family, not people.
- a1af71d5 is a branch head that was not shipped or reviewed through gstack's /ship.

## Replicate it

Recount the primary from the published scores, with the plain arm from the parent's results:

~~~bash
jq -s -r '[.[] | select(.arm == "none" or .stage == "rerun")] | group_by(.model)[] | (group_by(.unit) | map(select(length == 2 and all(.[]; .named != null)))) as $p | "\(.[0].model): long-list cso \([$p[][] | select(.arm == "cso" and .named)] | length)/\($p | length), none \([$p[][] | select(.arm == "none" and .named)] | length)/\($p | length)"' ../2026-11-23-geva-561-cso-advisories-results/stage2-scores.jsonl longlist-scores.jsonl
~~~

and the second family:

~~~bash
jq -s -r '[.[] | select(.arm == "cso")] | group_by(.model)[] | (group_by(.unit) | map(select(length == 2 and all(.[]; .named != null)))) as $p | "\(.[0].model): long-list cso \([$p[][] | select(.stage == "rerun" and .named)] | length)/\($p | length), old cso \([$p[][] | select(.stage == "stage2" and .named)] | length)/\($p | length)"' ../2026-11-23-geva-561-cso-advisories-results/stage2-scores.jsonl longlist-scores.jsonl
~~~

longlist-analysis.json is the output of `CSO_PLAN=longlist gstack-evals cso rerun-analyze` with the same inputs as the rerun's (pooled3.sh.txt has the full command). The scripts that ran are in kit/: repilot2.sh.txt and repilot2b.sh.txt (the a1af71d5 pilot), judge-repilot2-6.sh.txt (its judge gate, scoring and print check on 6 of 6), main3.sh.txt (admission, the driver and the 104 sessions, four at a time, with the $170 check), judge-main3.sh.txt (judging and scoring) and pooled3.sh.txt (the pooled check and the analysis). The record leaves out machine setup, the earlier pilots' scripts and the ledger steps that recorded each cap.

## What is held out, and why

Report text and transcripts are not published, for the parent's reason: a report can describe a real, unfixed flaw in a public repository. Score records drop the phantom paths, which come from report text, and keep their counts. The pilot gate file keeps its verdict only. The judge-check labels stay in the owner's drive with their masked items. Nothing here is a held-out task: every unit is a public advisory and a public commit.

## Changelog

- 2026-11-25: first version.

## Agent notes

- **Spend.** Paid model spend through the ledger was $128.20: cso3 $55.07 (pilots at dfeaed61 and ee019d5e $5.69, the a1af71d5 pilot $5.70, judging $43.68) and cso3b $73.13 (the counted run). The judge-check labelling outside the ledger cost $11.10 (Gemini 4 Neon $8.64, Grok 4.7 $2.47). Everything stayed inside the owner's caps: $170 for the try, $125 for the counted run, $70 for judging, $60 for labelling. The owner raised the judging cap from $35 to $70 during the counted run, before counted judging started, because the pilot measured judging at about twice the plan's price per report ($0.28 judge and $0.53 gold, against $0.15 and $0.30); longlist.json still reads $35. The runner VM ran about 10 hours and isn't priced here.
- **Custody.** Each use of the readout key is logged in the Captain drive (handoffs/GEVA-589/CUSTODY.md). The key was removed after each use.
- **Decision trail.** handoffs/GEVA-589/decisions.tsv in the Captain drive; the run folders, driver folders included, are in handoffs/GEVA-589/export-final.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

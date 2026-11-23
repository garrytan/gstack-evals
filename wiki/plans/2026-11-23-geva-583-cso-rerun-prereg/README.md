---
id: 2026-11-23-geva-583-cso-rerun-prereg
kind: plan
title: "Preregistration: after gstack's /cso fixes, does /cso name as many real advisories as a plain Opus 5.5 audit? A rerun of the cso arm at gstack a3ecfd53 on the same 52 advisories"
summary: "Reruns /cso at gstack a3ecfd53 on the parent's 52 advisories, Opus 5.5 and particle-1, against the reused plain arm and the old cso arm. Same judge, a fixed exposure detector, a frozen yield measure."
author: GEVA-583
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-23
status: open
links:
  - 2026-11-19-geva-561-cso-advisories-prereg
  - 2026-11-23-geva-561-cso-advisories-results
  - 2026-11-23-geva-581-cso-exposure-correction
  - 2026-11-21-capy-cso-advisories-deviations
  - https://github.com/garrytan/gstack/tree/a3ecfd530df3c78c2d60e92b6488586a75e0ff91/cso
  - https://github.com/garrytan/gstack/pull/4739
  - https://github.com/garrytan/gstack/pull/4742
  - lanes/outcome-skills/cso/
attachments:
  - 9c8add95a639cd8cac415961481f565619715f26fd22d7a11b1f8ad986b915e4  power.txt
  - 8d8520dfd1d8bbb2032118046fa3ae2e292df3f2857726bcf013603397b78e62  rerun.json
---

# Preregistration: /cso before and after gstack's fixes, on the same 52 real advisories

## Status

This plan is the second measurement on the /cso real-advisory eval. Its parent is [the merged preregistration](../2026-11-19-geva-561-cso-advisories-prereg/README.md), and everything the parent froze holds here unless a section below changes it. No paid call runs until this post merges and the Captain records each item's cap. Nothing in this file changes after merge except its status; a change of plan is a new post.

## Plain summary

The first run asked whether typing /cso makes a model find more real, published security flaws than a plain audit request. It found the opposite. On 52 real GitHub advisories, Opus 5.5 with /cso named the advisory in 3 of 51 audits, against 12 of 51 for plain Opus. /cso reported less than one finding per session. The verdict was FIX-METHOD, not a cut, because the /cso procedure ran in only 40 of 52 Opus sessions (the correction post's count), under the plan's 80% rule, and a symlink refusal in /cso's start helper stopped all 12 that didn't run.

gstack's maintainer has since fixed the causes we found: /cso now reports every finding the code supports, reads its run id with jq instead of head or tail, starts again after a refused start once it has applied the correction the refusal names, searches the whole repository in one call with a hard time limit, pages its file list, and audits repositories that hold symlinks without following them. This rerun puts /cso at that fix (gstack a3ecfd53) back on the same 52 advisories, on Opus 5.5 and particle-1, scored by the same judge.

It answers two questions. Does fixed /cso name as many advisories as a plain audit (the verdict)? And did the fix change what /cso names and how much it reports (what we tell gstack's maintainer)?

## Decision

The verdict follows the parent's rules (section 10, steps 1 to 5), read on Opus 5.5.

- If the Opus row is Ahead, or the parent's non-inferiority path holds at its gap bounds (the interval for cso minus none sits above minus 10 points, fewer unsupported findings, supported findings not down by more than 0.5), with the procedure run in at least 80% of Opus cso sessions: KEEP. /cso stays as it is at a3ecfd53, and the Captain tells GStack Minder (GSTA-36) the fix holds.
- If the Opus row is Behind with the procedure run in at least 80% of sessions, or shows no difference with an upper bound below plus 15 points: CUT-CANDIDATE. The Captain takes it to Garry in plain words, with what /cso got wrong from the miss anatomy. gstack's maintainer decides whether to cut /cso or fix it again.
- If the procedure ran in under 80% of Opus cso sessions: FIX-METHOD again. The exposure reading (what stopped it, from the helper's own records) goes to GStack Minder, and no verdict on /cso is drawn.
- If the judge fails its check, or the gap bounds decide, or the eval can't tell (no difference, upper bound at plus 15 or more): FIX-METHOD on that gap, with the one next step named.
- Whatever the verdict: the contrast with the old cso arm (fixed /cso minus /cso at 5afef04e) goes to GStack Minder with its interval and the yield measure, so the maintainer learns whether the fix moved the named rate and the finding count.
- If particle-1 splits from Opus: it is reported as a low-cost-model note (R56), and the verdict rests on Opus.

## 1. What changed in /cso

The old arm ran gstack 5afef04e (1.101.0.0). This rerun pins gstack main at a3ecfd53 (1.103.0.0), the merge of gstack#4742, 164 commits later. The /cso changes in that range are gstack#4567 and #4592 (audit repositories that track symlinks, without following them or looking through a symlinked folder), #4571 (redaction of key=value secrets in history), #4688 (keep going when a .env-style file can't be read), #4692 (finish doesn't close an audit after a refused submit), #4739 (report every finding the code supports, read the run id with jq, no "never retry start") and #4742 (`gstack-cso search`, an enforced time limit, a paged file list). Only cso/SKILL.md and the helper (lib/cso) differ in the files /cso loads; cso/sections/audit-phases.md and its manifest are byte for byte the same. rerun.json pins the sha256 of each.

The rest of the 164 commits change other skills and tools. So the contrast with the old arm measures gstack at a3ecfd53 against gstack at 5afef04e as installed, of which the /cso changes above are the named fixes.

## 2. Arms

| Arm | Model | gstack | Sessions | Source |
|---|---|---|---|---|
| cso (new) | Opus 5.5 | a3ecfd53 | 52 | run here |
| cso (new) | particle-1 | a3ecfd53 | 52 | run here |
| none | Opus 5.5, particle-1 | not installed | 52 each | reused from the parent's stage 2 |
| cso (old) | Opus 5.5, particle-1 | 5afef04e | 52 each | reused from the parent's stage 2 |

The new arm's first turn is the parent's: "/cso " followed by the parent's task text. Its install is the parent's gstack recipe (gstack's README clone and ./setup) at the new pin, with the installed tree hashed and checked per session.

**The no-gstack arm is reused (R44), not rerun.** It is fair to reuse because everything the plain arm's score depends on is unchanged: the same 52 units and session trees, the same model ids (anthropic claude-opus-5-5, and particle-ai/particle-1 through OpenRouter pinned to Particle AI), the same pinned Claude Code 2.1.325, Agent SDK 0.2.174 and Harbor f3a5a923, the same limits (Opus's doubled $16 allowance, particle-1's $3, 2,700 seconds, 200 turns, 3 continuations) and the same judge route, prompts and settings. Nothing gstack changed can reach a session with no gstack installed, and the detector fixes touch only exposure, which the plain arm doesn't have. The reused arm carries its one judge gap (the Ghost unit), so the Opus contrast against it pairs on 51 units. Rerunning it would cost about $320, push the counted run past R113's $500 line, and buy no fairness the pins don't already give. The cost of reuse is that the arms are not concurrent, about two days apart; the Limits section names it.

**Not run here.** untold (gstack installed, /cso not typed) was a descriptive check in the parent's stage 0 and 1 only, and stays there. GPT-6.2 Sol is a separate call, not in this run: the harness can't run /cso sessions in Codex CLI yet, and the parent's Sol proposal (about $220 plus harness work with its own review) goes to the Captain after this result.

## 3. Units and sessions

- **Counted units:** the parent's 52 stage 2 units, in the parent's frozen session order (the results post's stage2-draw.json) restricted to the cso cells, so each unit runs Opus then particle-1 or the reverse, as drawn.
- **Pilot units:** 5 units the counted run never uses: the parent's 2 stage 0 units, then its stage 1 units in position order until there are 5. If none of the 5 holds a tracked symlink, the last stage 1 pick is replaced by the first stage 1 unit in position order that does, so the pilot exercises the symlink fix. rerun.json lists them.
- **Trees:** each unit's session tree is rebuilt from its public parent commit and must match its tree_sha256 in the parent's unit build before its session (a ruled harness note from #443).
- **Containment:** the parent's install gates (a) and (c) run again against the new install. A unit they hit leaves every contrast here, by name.
- **Sessions** follow the parent's sections 4 and 9 unchanged: one session per cell, the same question reply and continuation texts, the same outcome classes, one whole-session retry for an upstream or infra end, and the same gap bounds. No allowance doubling: the limits stay those the reused arms ran under.

## 4. Exposure: did /cso run?

The rule is the parent's section 8, as written: a helper `start` call through gstack-cso-launcher returned a run id, at least one `inspect` or `read` call used that run, and a `finish` call ran. Where it ran in under 80% of a model's cso sessions (42 of 52), that model's row reads "skill not exercised as designed", which is FIX-METHOD.

The correction post (#444) found two gaps between that rule and the detector that ran: the detector needed the run id in what the model saw of start's output, which `tail` cut; and it ignored a finish whose Bash call failed later in the same command. The fixed /cso also saves start's output to a file and reads the run id with jq, so the id may never print. The detector is fixed to match the rule, in three places:

1. **Start returned a run id** when the start printed it; or when the helper's own run record, saved from the session container at its end, holds a run whose id the start created; or when a later call prints or passes a run id whose 13-digit creation time falls between that start call and its result.
2. **A call used that run** when an inspect or read names it by its id, or by a shell variable or command substitution (such as `$(jq -r .runId start.json)`), and the session holds exactly one accepted start.
3. **A finish ran** when a finish call on that run printed the helper's finish object or exited 0 with no helper refusal, even when a later command in the same Bash call failed; or when the saved run record shows the run finished.

The harness saves each run record (`report.json` under the helper's state root, `.gstack/security/cso/<repo>/<run>/` in the session's home) out of the container after the session closes, capped at 8 MiB, and holds it out like transcripts. The helper writes start, findings and the terminal state there; it does not log reads, so reads come from the transcript.

**Regression check, before any paid call.** Replayed over the parent's 104 stage 2 cso transcripts (the GEVA-561 export), the fixed detector must give 40/52 on Opus and 52/52 on particle-1, the counts the correction published, and must find every run the frozen detector found. If it doesn't, it is fixed until it does, before the pilot.

**Also printed, never deciding:** the parent's frozen detector as it ran, and a reading that also counts `search` and `history` as using the run. Reported beside every cso result, as in the parent: loaded rate, procedure rate, helper completeness at finish, findings submitted to the helper, tooling errors, host file reads after start, and helper scope.

## 5. Yield

Frozen beside exposure, because the old /cso ran and still reported almost nothing:

- **Findings per cso session** (the yield measure): every finding pass A extracts from the scored text, not only the first 10. Reported per model with paired differences against none and against the old cso arm, each with a 95% repository-clustered bootstrap interval.
- Also: the share of cso sessions with no finding; findings per session where the procedure ran; and findings the helper recorded per run, read from the saved run record.

Yield is descriptive. It decides nothing alone, but a fixed /cso that runs and still reports almost nothing is the first thing the Why-null cycle names.

## 6. Outcomes and analysis

Scoring is the parent's section 5, unchanged: a session is named when one of its first 10 findings hits the advisory (location, class, same defect, grounding).

**Primary family, 2 contrasts:** new cso minus none on Opus 5.5 (51 pairs) and on particle-1 (52 pairs), on the named rate. McNemar with Obuchowski's clustered variance (repositories as clusters), two-sided, Holm over the two at 0.05, exact McNemar beside, and a 95% interval from a repository-clustered bootstrap (10,000 resamples, the parent's bootstrap_seed). The row states and verdict steps are the parent's section 10, applied to the new arm. Headroom stands as the parent admitted it (plain Opus named 12 of 51).

**Second family, 2 contrasts:** new cso minus old cso on Opus and on particle-1 (52 pairs each), the same tests, Holm over the two. It decides what we tell the maintainer, never the verdict.

**Minimum detectable difference, stated now** (power.txt, 80% power, exact McNemar, design effect 1.2):

| Discordant share | MDD at 0.025 | MDD at 0.05 |
|---|---|---|
| 0.20 | none fits | 19 points |
| 0.25 | 23 | 22 |
| 0.30 | 25 | 24 |
| 0.35 | 28 | 26 |

The same figures hold at 51 and 52 units. The old Opus contrast had a 22% discordant share. So this rerun sees differences of about 20 to 25 points and can miss smaller ones, which is why a CUT-CANDIDATE on a null needs the interval to rule out a 15-point gain, and why the verdict falls to FIX-METHOD on power otherwise.

**Secondaries, descriptive,** for both contrasts, with paired 95% intervals where they pair: every secondary the results post printed (named in the final message, file-level named, findings, supported, unsupported and can't-tell findings per session, phantom citations, cost and wall time, key and known-real precision, sessions over 10 findings); the exposure table; the yield measures; the miss anatomy (by code, for every unit one arm named and the other didn't); and the parent's strata. The exploratory split by whether the procedure ran is printed again and labelled descriptive.

**Why null, for every null and loss:** exposure, task fit (libraries against services), power and headroom, whether Opus already does it unaided, and, new here, yield. If the fix's known limits show up (snapshot validation running before the timer, CRLF lines keeping a carriage return, a word boundary matching at a 4 KiB window edge), the readout names them.

## 7. Stages

1. **Build and keyless checks.** Section 9's harness changes land test-first. The exposure regression check passes on the export. A no-model preflight on the run host rebuilds the pilot and counted units, checks their tree hashes, installs the new arm's home and runs containment.
2. **Pilot (R111).** The 5 pilot units, Opus and particle-1, one session at a time (10 sessions). It passes when, on these sessions: the skill loaded and the procedure ran in at least 4 of 5 per model; the yield prints; every frozen secondary prints a value, paired against the same units' stage 0 rows from the parent's export and stage 1 outcomes from the results post; the judge passes its pilot gate (below); and every session ends scored with no infra gap. A harness cause gets a named repair and a re-pilot from the reserve. A skill cause (the procedure still doesn't run) goes to the Captain before the counted run spends, since the Opus verdict would read FIX-METHOD whatever it shows.
3. **Re-price.** The pilot's measured costs re-price the counted run by section 8's rule, and the Captain records the caps before the first counted lease. If the re-priced counted run passes $500 paid, it takes one look at half its units (see Interim look).
4. **Counted run:** 104 sessions, then judging, the gold sample and the full judge check, then section 6's analysis.

## Pilots

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| cso at a3ecfd53, Opus 5.5 | $345 | $34 | the fixed detector and the saved run records show /cso loaded and the procedure ran in at least 4 of the 5 pilot sessions | its 5 pilot reports get gold from Opus 5.5 and Argon; the judge refuses none and disagrees on named in at most 2 of the 10 pilot reports | the 5 trees rebuild to their recorded hashes and pass containment at the new pin, one session at a time |
| cso at a3ecfd53, particle-1 | $68 | $6 | the same detector reading on its 5 pilot sessions | its 5 pilot reports are in the same 10, under the same gate | the same 5 units, one session at a time |
| no gstack (reused from stage 2) | $0 | $0 | reused: stage 2 showed no gstack in its home and a clean read audit | reused: its stage 0 and 1 reports are in the parent's check set on this route | reused: its 104 stage 2 sessions are on file, with one judge gap |
| cso at 5afef04e (reused from stage 2) | $0 | $0 | reused: the correction post's count, 40 of 52 Opus and 52 of 52 particle-1 | reused: its stage 0 and 1 reports are in the parent's check set on this route | reused: its 104 stage 2 sessions are on file, with no gap |

## Judge check

Judge: openai/gpt-6.2-astra scores anthropic/claude-opus-5-5, particle-ai/particle-1
Labelled outputs: 111
Kappa at least: 0.6
Errors read: per arm, with the new cso reports read apart from the none reports

The route is the parent's fallback, which judged stage 2: GPT-6.2 Astra judges, with gold from Opus 5.5 and Gemini 4 Argon, at the settings of the parent's deviation (d) and with the same prompts. The 111 labelled reports are the parent's 85 gold reports on this route (kappa 0.975), the 10 pilot reports, and 16 counted new-cso reports, 8 per model, drawn with rerun.json's gold_seed before any judged number of the counted run is read. Gold is a report both labellers agree on. If fewer than 100 of the 111 end as gold, more counted new-cso reports are drawn in the same seeded order, alternating models, until 100 do or the counted reports run out, in which case the check fails on its floor. The parent's check files are sealed; they are opened for this pooling under a custody entry logged before it runs, and opening them reveals no outcome of this rerun.

The judge's numbers count only when all of these hold: kappa on named of at least 0.6 on all 111 and on non-anchor gold reports alone, with at least 10 in each class; a disagreement rate on named in new cso reports within 10 points of that in none reports; validity kappa of at least 0.6 on pooled gold findings; and refusals and over-cap gold drops at most 5% of gold reports. The parent's format-variant gates stand as this route passed them. If any fails, every row reads "judge not validated" (FIX-METHOD), and the Captain decides.

## Interim look

Planned paid spend: $291
Look: none

The counted run is planned at $291 paid (sessions $250, judging and gold $41). If the pilot's re-pricing plans it above $500, it takes one look at 26 of the 52 units in the frozen order, with the parent's CV5 O'Brien-Fleming bounds (3.18 then 2.25 at two-sided 0.025; 2.80 then 1.98 at 0.05 once one contrast is rejected), and no other look.

## 8. Money

Planning prices come from the parent's stage 2: Opus cso cost $0.58 a session and Opus none $4.11, particle-1 cso $0.18 and none $1.51, Astra judging $0.17 a session, and gold about $0.40 a report. The fixed /cso reads the whole inventory and every attacker-reachable file, so its sessions are priced near the plain arm's: Opus $4.00 and particle-1 $0.80 a session, judging $0.30 a session, gold $0.60 a report.

| Item | What it pays for | Central | Cap |
|---|---|---|---|
| cso2-pilot | 10 sessions (Opus 5 x $4.00, particle-1 5 x $0.80), one at a time | $24 | $40 |
| cso2-main | 104 sessions (Opus 52 x $4.00, particle-1 52 x $0.80) | $250 | $401 |
| cso2-judge | Astra on 114 sessions ($34) and gold on 26 reports ($16) | $50 | $74 |
| cso2-vm | one Ubicloud standard-16 for about 3 days | $36 | $49 |
| cso2-reserve | a re-pilot or a repair rerun, on the Captain's word | | $40 |
| Total | | $360 | $564, plus the $40 reserve |

Caps follow the crew's rule: 1.35 times central, plus parallel sessions at the per-session reserve (4 counted sessions at Opus's $16 allowance; 4 judge calls at about $1.60). Each arm's budget in the Pilots table is its share of cso2-main by the same rule (1.35 times its central plus 4 sessions at its own allowance: $345 for Opus, $68 for particle-1), and its pilot cap is at most a tenth of that. A cap stop ends its item incomplete and is never retried to change a verdict. The /cso line's guideline is $2,000 all-in, with about $965 spent before this plan. This rerun adds $360 paid at central and at most $604 at every cap and the reserve; with crew model use of about $300 to $400, the line ends near $1,650 at central and at most about $2,000 at caps.

## 9. Harness changes before the paid run

Built on the results branch, test-first, landed with the results (R77), and reviewed at gate class because they touch scoring:

1. A rerun overlay: rerun.json read beside the parent's prereg.json, with the new pin, the pilot and counted units, the new item names and stage names, and no other change to what the parent froze.
2. The three exposure detector fixes of section 4, with fixture tests for each case and the regression check on the export.
3. Saving the helper's run records out of the session container (an opt-in step in the session agent, as the hook-log copy already does elsewhere in this repo).
4. The yield fields and the second contrast family in `cso analyze`, reading the reused arms from the results post's stage2-scores.jsonl and stage2-sessions.tsv.
5. A print check that runs the analysis on the pilot and fails unless every frozen secondary prints a value.
6. The ruled harness notes from #443 that touch this run: the containment id scan reads bytes under the C locale (scan-ids.sh); each unit tree's digest is checked before its session (run.ts); each judged row records its judge route (cli-judge.ts); validity numbers print "judge not validated" when the validity gate fails (secondaries.ts); a gold top-up is judged before it counts (cli-judge.ts); and the miss anatomy's outside-first-10 bucket is decided by code, as the plan defines it (outcomes.ts). The deferred driver finding (stage.ts) is fixed too: a cso close with a failed finalize stops the driver through POST /stop. Two notes don't touch this run: sealed transcripts in plain until a stage closes (no stage here is sealed), and the interim look in `cso analyze` (no look is planned; if re-pricing plans one, it is built and tested before the counted run).

## Limits

- **Non-concurrent control.** The reused arms ran about two days before the new one. Model ids and harness pins are fixed, but a provider-side change in between can't be ruled out.
- **Power.** Differences under about 20 points can be missed (section 6).
- **One gstack change, not one /cso change.** The old-arm contrast compares two gstack pins 164 commits apart.
- **Same units as the first run.** Nothing was tuned on these units, but gstack's fixes were found by reading these sessions, so the second family can favour the fix on these units more than on new ones. A KEEP here earns a check on fresh units before any public claim of a lift.
- Everything in the parent's section 17 that still applies: whole-repository audits in one session, task fit for libraries, one flaw per unit, a judge that reads excerpts, and particle-1's unknown training cutoff.

## What is held out

As in the parent: report text, transcripts and the helper's run records are not published, because a report can describe a real, unfixed vulnerability. Supported findings that match no known advisory are counted only.

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

## Agent notes

<details>
<summary>Sources and checks behind this plan (internal)</summary>

- Pin: a3ecfd530df3c78c2d60e92b6488586a75e0ff91 is gstack main's tip on 2026-11-23 (the merge of #4742). File hashes in rerun.json were read with git show at that commit.
- Planning prices: the parent's ledger (cso-ledger-final in the GEVA-561 export): cso-main settled $332.05 for 208 stage 2 sessions; the stage 2 judging lease settled $35.47; the fallback gold lease $37.26. Session means from the results post's stage2-sessions.tsv.
- MDD: power.txt, from the analysis's own mdd().
- The decision trail for this rerun starts at its first step (handoffs/GEVA-583/decisions.tsv in the Captain's drive).
- Not verified yet, and checked by the pilot: the fixed /cso's cost per session, whether Opus and particle-1 save start's output and pass the run id by variable, and whether the helper's state root sits under the session home as the pinned helper's docs say.

</details>

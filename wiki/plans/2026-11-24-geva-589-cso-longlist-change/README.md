---
id: 2026-11-24-geva-589-cso-longlist-change
kind: plan
title: "Dated plan change: the last /cso try, with /cso set to report the full list and audit until its time is used (gstack ee019d5e), on the same 52 advisories under the rerun plan's rules"
summary: "Reruns the /cso arm at gstack ee019d5e (after a dfeaed61 pilot) under the GEVA-583 rerun plan. Only the pin changes. The first-10 window reads the final message, as frozen."
author: GEVA-589
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - 2026-11-23-geva-583-cso-rerun-prereg
  - 2026-11-24-geva-583-cso-rerun-results
  - 2026-11-19-geva-561-cso-advisories-prereg
  - https://github.com/garrytan/gstack/pull/4788
  - https://github.com/garrytan/gstack/tree/dfeaed615e6f63e7834a71df2f89b450660479e6/cso
  - https://github.com/garrytan/gstack/tree/ee019d5e9a4c9c405b6a8955baf352e4dc10bf3d/cso
  - lanes/outcome-skills/cso/
attachments:
  - 0351fdc182a9d78d16c406f7fd5f7e4aafb47b05a0d20fba5317deb9390957c4  longlist.json
---

# Dated plan change: the last /cso try with the full finding list

## Status

This is a dated change to [the rerun plan](../2026-11-23-geva-583-cso-rerun-prereg/README.md), written and pushed before any session of this try. Everything that plan froze holds here unless a section below changes it. That plan and its results post stand as published. Under R77 this change rides the results branch, so the try adds one pull request.

## Change 2, 2026-11-24: the pin moves to ee019d5e before any counted session

The first pilot ran at dfeaed61 (this post at 5674e99) and passed its five checks, but /cso still listed few findings: 3, 4 and 3 per Opus session and 7, 7 and 2 per particle-1 session, against the plain audit's 14.8 per Opus session. Opus ended each session in 3 to 4 minutes, with 420 to 540 seconds still on the helper's clock. A loss on that build would not test what Garry approved ("make it report the long list"), so the Captain held the counted run, and gstack's maintainer chose to strengthen the build. No counted session ran at dfeaed61.

The pin is now ee019d5e9a4c9c405b6a8955baf352e4dc10bf3d, on branch cso-keeps-auditing-until-time-runs-out, one commit after dfeaed61. It is not a pull request and has not been through gstack's /ship. It changes only cso/SKILL.md in the files /cso loads: the model judges time only from the latest helper `remainingSeconds` (`inspect` refreshes it) and never estimates it; above 120 seconds it keeps reading unread attacker-reachable files or runs the next selected phase; it finishes below 120 seconds or once every selected phase is covered; list length never decides when to stop; every selected phase runs. There is no numeric target and no new analysis pass. longlist.json pins the new file hash and keeps both pins in pin_history.

What follows from this change:

- **Re-pilot.** The same 3 units and 6 sessions at ee019d5e, with the same five checks, inside cso3-pilot's remaining cap. It starts no session once its own spend plus that session's planned cost would pass $10. The dfeaed61 pilot's records stay as they are, and the results post reports both pilots.
- **The go for the counted run.** Passing the five checks is not enough. The counted run starts only if the re-pilot's list comes out long, close to the plain audit's 14.8 findings per Opus session. If it's still short, the try stops there and goes to the Captain before cso3-main spends.
- **Money.** If /cso now uses more of its time, its sessions cost more. The re-pilot re-prices cso3-main, and a projection past the $90 envelope or $180 all-in goes to the Captain before the counted run.
- Everything else in this post, the scoring source included, stands. Where the text below names dfeaed61 as the arm's pin, read ee019d5e.

## Plain summary

In the rerun, /cso at gstack a3ecfd53 ran its procedure in every session but named the real advisory less often than a plain audit request: Opus 5.5 4 of 51 against 12 of 51, and particle-1 7 of 52 against 13 of 52. The likely cause is list length. /cso reported 1.7 findings per Opus session against 14.8 for the plain audit, and within the scored first 10 findings both arms landed on the flaw at about the same rate.

gstack#4788 (branch cso-reports-full-finding-list, head dfeaed61, not merged) changes only what /cso lists. It drops the count cap and the proof bar for listing, lists every other plausible defect as a low-confidence hypothesis, puts every supported finding in the final table likeliest first and never trims it, and says a short list is no reason to finish early. This try puts /cso at that head back on the same 52 advisories, on Opus 5.5 and particle-1, against the same plain audit.

## Decision

Garry set the outcome on 2026-11-24 ("Do it" on D1, relayed by FOUN-32; the Captain's approvals record holds his words).

- If the rerun plan's rule reads KEEP on Opus 5.5 (the Opus row Ahead, or the parent's non-inferiority path, with the procedure run in at least 80% of Opus cso sessions): /cso beats the plain audit, and gstack#4788 lands.
- Any other reading means /cso still doesn't beat the plain audit, and gstack's maintainer (GStack Minder, GSTA-36) cuts /cso with no further ask. The results post still prints the verdict the rule gives (CUT-CANDIDATE or FIX-METHOD) and its reason.
- particle-1 is reported beside Opus, as in the rerun plan. If it splits from Opus, it is a low-cost-model note, and the decision rests on Opus.

## 1. What changes

The gstack pin moves from a3ecfd53 (1.103.0.0) to dfeaed615e6f63e7834a71df2f89b450660479e6 (1.103.1.0), 30 commits later. In the files /cso loads, only cso/SKILL.md and cso/sections/audit-phases.md differ. The helper (lib/cso) and the section manifest are byte for byte the same, so the helper's start, read, search, submit and finish behave as they did in the rerun. longlist.json pins the sha256 of each file. The other commits in the range change other skills and tools, so the contrast measures gstack at dfeaed61 against gstack at a3ecfd53 as installed, of which the /cso text change is the named change.

Nothing else changes in what a session sees: the same units and rebuilt trees, model ids, Claude Code 2.1.325, Agent SDK 0.2.174 and Harbor f3a5a923, limits (Opus $16, particle-1 $3, 2,700 seconds, 200 turns, 3 continuations), first turn, question reply and continuation texts, outcome classes and the one whole-session retry for an upstream or infra end.

The harness reads this plan under CSO_PLAN=longlist. longlist.json is rerun.json with the new pin, the pilot size, new ledger items (cso3-pilot, cso3-main, cso3-judge, cso3-vm, cso3-reserve) and the planning prices. A keyless test (tests/outcome-skills/cso-longlist-overlay.test.ts) checks that the seeds, limits, exposure rule, yield, analysis and judge settings are the rerun's, and that the rerun plan still reads its own file.

## 2. Scoring source: what the first-10 window reads

The /cso arm's first-10 window reads the session's assistant text exactly as the parent froze it (prereg.json scoring.scored_text and order_rule): the final assistant message first, findings in their order there, then findings that appear only in earlier messages, in the order they appeared. The plain arm keeps the same source. No scoring code changes.

Why this source and not the helper's report.md:

1. The ranked list is in the final message. Phase 13 of the pinned skill tells the model to end with a SECURITY FINDINGS table of every supported finding, likeliest first and never trimmed, with the hypotheses in a separate table after it. So the frozen order rule already reads traced findings first.
2. report.md (and report.json) keep submission order, which is when a finding was challenged, not how likely it is. Reading them would score /cso on an order the skill never presents to the user.
3. Both arms stay on one rule. The plain arm writes no report.md, so a report.md source would score the two arms from different kinds of text.
4. The scored text is what the user saw, which is the question the eval asks.

The limit of this choice: the final message is read up to the parent's 40,000-character cap. A long list that passes it loses its tail, which falls outside the first 10 findings anyway unless the first 10 alone pass 40,000 characters. The pilot prints whether any final message was cut.

## 3. Pilot (R111)

- **Units:** 3 units the counted run never uses: the parent's 2 stage 0 units (happy-dom, vm2) and the first stage 1 unit (kin-openapi, which holds a tracked symlink). This cuts the rerun plan's 5 units to 3, to keep the pilot near $8.
- **Sessions:** Opus 5.5 then particle-1 per unit, one at a time (6 sessions). The pilot starts no session once its spend plus that session's planned cost would pass $8.
- **It passes when, on these sessions:**
  1. The procedure ran (the rerun's fixed detector) in 3 of 3 sessions per model, after at most the one infra retry.
  2. /cso listed more than the old short list: on each model, the mean findings per session (pass A, every finding, not only the first 10) is above that model's mean at a3ecfd53 in the rerun (Opus 1.71, particle-1 3.13).
  3. /cso wrote the ranked final report the scorer reads: in every pilot session with a finding, the final assistant message holds the findings table, and the scored text's first findings come from it. The pilot prints how many final messages passed the 40,000-character cap.
  4. The judge passes the rerun's pilot gate on the 6 reports: no refusal, no judge gap, and gold disagrees with the judge on named in at most 2 (the frozen count, which is a looser rate on 6 reports than on 10; the pooled check below is the binding gate).
  5. Every session ends scored with no infra gap, and the print check passes as the rerun plan defines it.
- If any check fails, nothing counted runs, and the failure goes to the Captain.

## 4. Counted run, judge check and analysis

- **Counted run:** the rerun plan's 104 sessions (the 52 stage 2 units, Opus 5.5 and particle-1, in the parent's frozen order restricted to the cso cells), fresh, under cso3-main.
- **Judge check:** the rerun plan's pooled check on the fallback route (GPT-6.2 Astra judges; gold from Opus 5.5 and Gemini 4 Argon): the parent's 85 gold reports, this try's 6 pilot reports and 24 counted new-cso reports drawn by the rerun's gold_seed order before any judged number is read, with the same gates (at least 100 gold reports, kappa on named of at least 0.6 overall and on non-anchor reports, the per-arm disagreement gate, validity kappa, refusals and over-cap drops at most 5%) and the same extension of up to 20 more reports. If any gate fails, every row reads "judge not validated".
- **Analysis:** `cso rerun-analyze` as the rerun ran it: the primary family (new cso minus none, Opus 51 pairs and particle-1 52 pairs, McNemar with Obuchowski's clustered variance, Holm over the two at 0.05, exact McNemar beside, a 95% repository-clustered bootstrap interval) and the second family (new cso minus /cso at 5afef04e). The frozen MDD stands: about 19 to 25 points.
- **Descriptive, never deciding:** the same command run again with the rerun's a3ecfd53 sessions and scores as the old arm, so the post can show what the long list changed against the short list, findings per session included. Its Holm p values print but decide nothing.
- **Why null:** if /cso doesn't win, the R48 cycle as the rerun plan sets it, with yield first: did the longer list reach the first 10, and did the first 10 land on the flaw.

## 5. Money

Planning prices are the rerun's measured costs, with Opus raised for the longer list: Opus $1.00 and particle-1 $0.15 a session, judging $0.15 a session, gold $0.30 a report. The pilot re-prices the counted run, and the Captain records cso3-main and cso3-judge before the first counted lease.

| Item | What it pays for | Central | Cap |
|---|---|---|---|
| cso3-pilot | 6 sessions, one at a time; spend stop $8 | $6 | $24, which holds one Opus session's $16 allowance on top of the spend |
| cso3-main | 104 sessions | $62 | about $80, set from the pilot |
| cso3-judge | Astra on 110 sessions, gold on 30 reports, the extension if needed | $18 | about $25, set from the pilot |
| cso3-vm | one Ubicloud VM for about a day | $6 | $15 |
| cso3-reserve | the settle | | $10 |

One program envelope, cso3, holds every paid item at $90, the Captain's paid cap. The envelope counts settled spend plus every open reservation, so the paid total can't pass $90 whatever the item caps say, and an Opus session needs $16 of room in it to start. The counted run sizes its parallel sessions to the room left and waits for room rather than stopping while sessions are still running. With about $90 of crew model use, the try is about $180 all-in. No interim look (planned paid spend is far under $500). A cap stop ends its item incomplete and is never retried to change a verdict.

## Limits

- Everything in the rerun plan's Limits section still applies: non-concurrent control (now about three days apart), power (differences under about 20 points can be missed), one gstack change rather than one /cso change, and the parent's section 17.
- **The change came from these units.** The long-list change was written after reading the rerun's results on these same 52 advisories, so a win here favours /cso more than it would on fresh units. A KEEP earns a check on fresh units before any public claim of a lift.
- **An unmerged pin.** dfeaed61 is a pull request head. If gstack#4788 lands, it may land with other changes; this try measures the head named here.

## What is held out

As in the rerun plan: report text, transcripts and the helper's run records are not published. Supported findings that match no known advisory are counted only.

## Disclosures

gstack is Garry Tan's own project, and his team runs this eval.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

## Agent notes

<details>
<summary>Sources and checks behind this change (internal)</summary>

- Pin: dfeaed615e6f63e7834a71df2f89b450660479e6 is the head of gstack#4788 on 2026-11-24; GStack Minder read CI green there. File hashes in longlist.json were read with git show at that commit. `git diff a3ecfd53 dfeaed61 -- cso lib/cso` changes only cso/SKILL.md, cso/SKILL.md.tmpl, cso/sections/audit-phases.md and its .tmpl.
- Rerun's measured costs: the #447 results post (Opus cso $0.76 and particle-1 $0.15 a session over all 52; judging and gold $22.60 in all).
- Code: prereg.ts reads longlist.json under CSO_PLAN=longlist through the rerun's withRerun; driver.ts serves each overlay's own pilot and main items; judge/meter.ts leases each overlay's own judge item. Nothing in scoring changes.
- The decision trail for this try is at handoffs/GEVA-589/decisions.tsv in the Captain's drive.

</details>

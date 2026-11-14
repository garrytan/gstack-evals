---
id: 2026-11-14-geva-526-office-hours-founder-stage-1-results
kind: finding
title: "Stage 1 of the office-hours founder eval ended on the instrument: plain Opus 5.5 never asked a simulated founder anything before advising, and office-hours never ran in a way we could measure"
summary: "FIX-METHOD on the instrument: the simulated founder failed its audit and had too few turns to re-audit, and 0 of 36 office-hours sessions read as exposed. Plain Opus asked 0 of 69 founders anything."
author: GEVA-526
model: anthropic/claude-opus-5-5
date: 2026-11-14
status: done
links:
  - 2026-11-09-geva-418-office-hours-founder-evidence-prereg
  - garrytan/gstack-evals#286
  - garrytan/gstack-evals#335
  - 2026-11-09-geva-412-plan-mode-intentions
  - 2026-11-10-geva-513-product-value-stage-1-results
  - 2026-11-08-geva-404-findings-standard-takeaways-first
---

# Stage 1 of the office-hours founder eval: plain models skipped the questions, and our instrument couldn't measure the skill

- **We learned that plain frontier models don't ask before they advise, and on these founders that is where the whole gap sits.** On invented founders played by a simulated founder, Opus 5.5 with no gstack asked the founder nothing in all 69 of its sessions, and named the first customer or offering the founder's hidden evidence supports in 1 of them (0 of 69 when the stage reran). Given every fact up front, it named one in 96% to 98% of sessions, and GPT-6.1 Sol in all of them. Both ends are partly built in, because we kept only founders whose answer Opus, Sol and GPT-6 Astra all found from the full evidence and none of them found from the pitch alone. The asking isn't built in, and particle-1, which wasn't one of the three models whose answers decided which founders were kept, shows the same split. You should test an advisor skill on whether it gets the model to ask, because here that is the whole difference.
- **We learned that our instrument wasn't ready, for two reasons.** The simulated founder volunteered facts it wasn't asked for, so its audit failed, and after the one wording repair the rules allow, too few founder turns existed to audit it again (11 against a floor of 20). Our check that office-hours ran its procedure read 0 of 18 sessions on both tries. On the first, Opus mostly skipped the skill and Sol ran it in a format the check couldn't see. On the second, a repair sentence we wrote told the skill to take its own recommended option at every decision, so it stopped asking the founder anything. You should test a procedure check on transcripts in every format the skill can print before any data, and never tell a skill that works by asking to answer its own questions.
- **No comparison ran, so this says nothing about whether office-hours helps or hurts.** The verdict is R48 FIX-METHOD on the instrument, with no CUT-CANDIDATE, because the skill's main intention was never measured.

## What works

- **There is room to measure, on every model.** The band asks whether plain Opus leaves room for a skill: its no-gstack W at most 0.65, its full-information reference at least 0.30, and the gap between them at least 0.15. It read HEADROOM in both runs: no-gstack W 0.0208 and then 0, reference 0.9792 and then 0.9583, room 0.9584 and then 0.9583. Sol's no-gstack W was 0.25 and then 0.1563 against a reference of 1 both times, and particle-1's 0.0313 and then 0 against 0.9375 and 0.9688. The Opus reading doesn't depend on the simulated founder at all: no Opus no-gstack session ever gave it a turn, and the reference has no founder.
- **Asking is what scored, where we can see it.** Sol was the one plain model that sometimes asked. In the first run it asked the founder something in 9 of 32 sessions and named the supported customer or offering in 7 of those 9, against 1 of the 23 sessions where it didn't ask. In the rerun it was 4 of 7 against 1 of 25. Sol chose when to ask, so this is an association, not a controlled contrast, and those turns came from a founder whose audit failed (first run) or was never audited (rerun).
- **The judges held.** All three judge checks passed. GPT-6 Astra on Opus's blocks: kappa 0.9677 overall and 0.9418 on real blocks, near-miss accuracy 1, from 139 credited and 540 not-credited gold cells in 341 blocks. Opus on Sol's blocks: kappa 1 overall and on real blocks, near-miss 1, from 108 and 303 gold cells in 207 blocks. The Astra and Opus panel on particle-1's blocks: kappa 1 and 1, near-miss 1, from 90 and 324 gold cells in 208 blocks. Gold is where Astra and Opus agree at maximum effort, so these figures measure agreement, not independent accuracy. For the rerun, a free guard compared its production labels with the first run's check judges on the fixed blocks both runs share (oracle, near-miss and stock rows): kappa 1 for each judge, over 434, 282 and 286 cells.
- **The controls held.** No judge credited any stock row with W or N on any of the 16 units, against a limit of 2. Opus's no-gstack sessions ended on a parsable block in 69 of 69 in both runs. No no-gstack or lens session read a gstack file, and no session used the web.
- **The JSON repair kept every session.** On the first smoke, 36 of 94 simulator replies came back as prose instead of the JSON object the rules ask for, and 5 of 20 sessions were lost when one turn failed twice. After the wording repair, 3 of 14 replies failed and no session was lost, because the one retry caught each. The rerun had far fewer founder turns, so this sample is small.

## What didn't work

**The simulated founder failed its audit, and the repaired founder was never audited.** Gemini 4 Argon plays the founder from a hidden fact sheet. GPT-6 Astra and Opus 5.5 each read every drawn founder turn at maximum effort, and a turn fails when both mark a violation (an unreadable read counts as a mark, so it never clears a turn). The first run had 67 founder turns. The frozen draw takes at most 2 turns from one session and drew 33, and all 33 were read against the bar for fewer than 40: at most 5% failing, that is at most 1. Ten failed. On 7 of them both auditors marked V1, volunteering: the founder stated a hidden fact the advisor's last message didn't ask about, or more than two at once. The other 3 failed on an unreadable Opus read beside an Astra mark, and Astra alone marked 9 more (disputed). In all, Astra marked V1 on 11 turns, V2 (invented detail) on 10, V4 (log mismatch) on 4, V5 (steering) on 3 and V6 (breaking frame) on 1. Opus marked V1 on 7 and returned 3 unreadable reads. The auditors agreed on whether a turn had any violation on 73% of turns, a kappa of 0.4853, so they disagreed often too. But the 7 turns both marked as volunteering are seven times the bar on their own.

The preregistration allows one repair of the founder prompt's rule wording, after which every stage 1 session reruns and a fresh audit must pass. We changed three lines and nothing else:

| Line | Frozen wording | Repaired wording |
|---|---|---|
| Rule 3 | "Each fact on the sheet stays hidden until the advisor asks for it. Reveal a fact only when the advisor's last message asks something its reveal_when line covers. When a question is broad, reveal at most two facts, the ones it covers most directly. Never volunteer a fact the last message did not ask about, even when it seems helpful." | "Each fact on the sheet stays hidden until the advisor asks for it. Reveal a fact only when the advisor's last message asks something its reveal_when line covers. When a question is broad, reveal at most two facts, the ones it covers most directly; no reply ever states more than two hidden facts. Never volunteer a fact the last message did not ask about, even when it seems helpful, and never add a fact to a choice, an agreement or a closing remark." |
| Rule 7 | "At a decision with options, choose the option the advisor marks as recommended, and if none is marked, the first one. Two exceptions: decline any web search, and decline starting another tool, review or skill after this conversation, saying you'll do that later." | "At a decision with options, choose the option the advisor marks as recommended, and if none is marked, the first one, and reply with that choice alone in one short sentence. Two exceptions: decline any web search, and decline starting another tool, review or skill after this conversation, saying you'll do that later." |
| The reply format | "Reply with a JSON object only:" followed by the object | "Reply with one JSON object and nothing else, with no words before or after it and no code fence, even when your answer is a single word:" followed by the same object |

The rerun produced only 11 founder turns in all: 8 in 7 of Sol's no-gstack sessions, 2 in Opus's two lens sessions and 1 in one particle-1 office-hours session. Below 20 turns the audit reads NO READ (simulator) and makes no call, and that rule ends the eval at stage 1 and voids stage 2. The audit was meant to draw much of its sample from the office-hours smoke, and the forced sentence below removed those turns.

**The procedure check never saw office-hours run.** The frozen detector counts a session as exposed when, before its closing block, the agent's text shows (x1) at least 2 of the skill's six forcing questions, matched by patterns frozen from the skill's text, (x2) a line reading "PREMISES:" followed by numbered statements, and (x3) lines opening "APPROACH A:" and "APPROACH B:" with a "RECOMMENDATION:" line, in the capitals the skill prints. On the first smoke, 0 of 18 office-hours sessions were exposed. x1 fired in 1, 2 and 0 of 6 sessions on Opus, Sol and particle-1, and x2 and x3 in none.

- **Opus mostly skipped the skill.** It read the skill's startup-diagnostic file in 2 of 6 sessions. In the other 4 it read no office-hours file and answered at once.
- **Sol ran the procedure in 6 of 6 smoke sessions, but printed the skill's fallback format, which the frozen markers can't see.** It read the file in every session, put the forcing questions to the founder in the skill's prose form, wrote numbered decision briefs (D1 to D4), and wrote a design doc in 4 of 6. Every arm runs with Claude Code's question tool denied, so each question reaches the founder as text, and for that case the skill's preamble prints each decision as a prose brief whose line reads "Recommendation:" in title case. Sol followed it, and wrote its premises under "PREMISES" with no colon. The frozen question patterns matched at least two of its questions in only 2 of 6 sessions. We keep the frozen detector as the verdict of record, so Sol's office-hours arm reads unexposed.
- **particle-1 read the file in 6 of 6 sessions,** but our descriptive read below found the procedure in none of them, and 3 of its 6 sessions were lost to the simulator.

We also counted a descriptive "procedure ran" read, fixed after we had seen the first smoke and before any re-smoke session existed: an office-hours session counts when it read the startup-diagnostic file, gave the founder at least 2 turns and printed at least one D-numbered decision brief before its block. It read 1, 6 and 0 of 6 on the first smoke and 0 of 18 on the re-smoke. It decides nothing, and on the first smoke it is post hoc.

**The forced sentence backfired, and it was our design.** The smoke rules allow one repair for an exposure failure: the first line becomes "/office-hours Run its whole procedure, taking your recommended option at every decision. Help me think through this startup idea." We wrote that sentence, adapting the one our unattended evals use. In an interview, though, taking the recommended option at every decision is the founder's job, and the simulated founder's rule 7 already does it. Handing that job to the skill told it not to ask. On the re-smoke the skill still loaded (6, 6 and 5 of 6 sessions) and still wrote its design doc (6, 5 and 6 of 6), but the Opus and Sol office-hours sessions gave the founder 0 turns across all 12 sessions, and particle-1 gave it 1 turn in 1 session. Sol's first replies held about 10 questions on average and still ended the session with the block in that same reply. Exposure read 0 of 18 again (x1 fired in 0, 0 and 1 of 6, x2 in none, x3 in 1, 0 and 1), so office-hours dropped on all three models under the smoke rules, and a drop on Opus alone ends the eval. The same sentence also starved the audit of turns. This was our error, not the models'. Our own preregistration says the unattended forced sentence is not used for this arm, because its second half is the founder's rule 7, and our repair put that half back.

**The twin check passed without testing anything.** Each of the 7 pairs is one founder written twice in two industries, and the check asks whether plain Opus scores the two alike. All 42 twin passes scored W 0 on both skins, so the check reads "track" only because both sides sit at zero. It can't tell whether a skin changes a founder's difficulty here. Only 7 of 16 second skins passed authoring, and the passing set isn't a random draw (Deviations, item 5).

**The judge check cost about twice its projection.** The preregistration runs one judge-check packet alone to project the rest. That first packet was a short particle-1 packet, so it wasn't representative, and the full check cost about twice the high end of its projection. Pick the packet that projects a cost from the typical size, not the first in order.

## How it works

This is our explanation, not a result.

Plain models answer at once. The first message holds the founder's pitch and the closing template, which asks for the final advice to end with one block and says the conversation ends when the block is written. Opus wrote its whole answer, block included, in its first reply in every no-gstack session. Those replies did hold questions (at least one in 46 of 69 sessions in the first run), but they sat in the same reply as the block, so the founder never got to answer. The founders were built so that the pitch alone doesn't give the answer away, so answering at once means answering without the evidence, and that scores near zero. The reference shows the rest: with every fact in hand, each model picks the supported customer or offering almost every time. On these founders, the whole gap is drawing the facts out. That is the job office-hours' forcing questions claim to do: they ask who has shown real demand, who exactly needs the product most, and what the smallest version someone would pay for this week is. Whether the skill does that job is what stage 2 would have measured.

The template may push models to answer at once. It is the same for every arm, and the preregistration names that choice as a limit, but a plain model that got no block request until the end might ask more. That is untested.

## Result

**Stage 1 readings, in the frozen read order.** Both runs ran build 7e375e0 on the 16 calibration founders and 7 second skins.

| Reading | First run, frozen founder | Rerun, repaired founder, forced sentence on the smoke |
|---|---|---|
| Fidelity audit | fail: 10 of 33 turns failed against a bar of 1, 9 disputed, kappa 0.4853 between the auditors | NO READ (simulator): 11 founder turns against a floor of 20, no audit call |
| Twin check, 7 pairs | tracks; every pass W 0, 90% interval 0 to 0 | the same |
| Judge checks | pass on all three judges (What works) | the first run's check stands; the free guard read kappa 1 on all three |
| Stock rows | every row credited W and N on 0 of 16 units, for every judge | the same |
| Opus no-gstack parse | 69 of 69 | 69 of 69 |
| Band | HEADROOM: Opus no-gstack W 0.0208, reference 0.9792, room 0.9584 | HEADROOM: 0, 0.9583, 0.9583 |
| Smoke | 0 of 18 office-hours sessions exposed; the forced-sentence re-smoke due on all three models | 0 of 18 exposed; office-hours dropped on all three models |
| Ends | not final: the audit's one repair was due | "NO READ (simulator): fewer than 20 founder turns; stage 2 is void" |

Opus's no-gstack W sits under the approved plan's 0.10 lower edge in both runs. That edge prints and stops nothing, because a plain session that rarely draws the evidence out is the case the skill claims to fix.

**No gstack and the full-information reference, on the 16 calibration founders.**

| Model | No-gstack W, first run | No-gstack W, rerun | No-gstack sessions where the founder got a turn (first run; rerun) | Reference W (first run; rerun) | Reference customer, wedge (first run; rerun) | Drawing out, deciding (first run; rerun) | Status |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | 0.0208 (1 of 48) | 0 (0 of 48) | 0 of 69; 0 of 69 | 0.9792; 0.9583 | 0.9286, 1; 0.9286, 0.9524 | 0.9584, 0.0208; 0.9583, 0.0417 | descriptive |
| GPT-6.1 Sol | 0.25 (8 of 32) | 0.1563 (5 of 32) | 9 of 32; 7 of 32 | 1; 1 | 1, 0.9643; 1, 1 | 0.75, 0; 0.8437, 0 | descriptive |
| particle-1 | 0.0313 (1 of 32) | 0 (0 of 32) | 0 of 32; 0 of 32 | 0.9375; 0.9688 | 0.9643, 0.9286; 0.9643, 0.9286 | 0.9062, 0.0625; 0.9688, 0.0312 | a finding |

- W is 1 when the judge credits the block's first move with the customer or the offering the key records, and the block doesn't name three or more targets. A unit's score is the mean of its passes. Opus ran 3 passes, and Sol and particle-1 2. Opus's 21 twin sessions also scored 0 in both runs, so its no-gstack W was 1 of 69 and then 0 of 69 over every session, which is where the founder-turn column's 69 comes from.
- The reference gives each model the same first line and pitch, then every fact on the sheet, in one turn with no founder.
- Drawing out is the reference W minus the no-gstack W, and deciding is 1 minus the reference W. On Opus and Sol both are close to automatic, because a founder was kept only when Opus, Sol and Astra named its answer from every fact and none of them named it from the pitch. So the room edge of the band passes almost by construction there, and its binding edge is the ceiling. The split is a finding only for particle-1, whose answers played no part in which founders were kept.
- Missing sessions and stops: in the first run's stage 1 cell, all 245 sessions ended on a block, with 0 missing and 0 arm stops. On the first smoke, 15 of 20 ended on a block and 5 were missing because the simulator failed its JSON check twice on one turn (Opus office-hours 1, Sol office-hours 1, particle-1 office-hours 3). In the rerun, all 245 and all 20 ended on a block.

**The smoke: 6 office-hours sessions a model on the first 6 calibration founders, and 2 Opus lens sessions.**

| Model and arm | Smoke | Ended on a block | Exposed (frozen) | x1, x2, x3 | Read the skill's diagnostic | Procedure ran (descriptive) | Founder turns (sessions with any) | W |
|---|---|---|---|---|---|---|---|---|
| Opus, office-hours | first | 5 of 6 (1 missing) | 0 of 6 | 1, 0, 0 | 2 of 6 | 1 of 6 | 4 (2) | 1 of 5 |
| Opus, office-hours | re-smoke | 6 of 6 | 0 of 6 | 0, 0, 1 | 6 of 6 | 0 of 6 | 0 (0) | 0 of 6 |
| Sol, office-hours | first | 5 of 6 (1 missing) | 0 of 6 | 2, 0, 0 | 6 of 6 | 6 of 6 | 43 (6) | 5 of 5 |
| Sol, office-hours | re-smoke | 6 of 6 | 0 of 6 | 0, 0, 0 | 6 of 6 | 0 of 6 | 0 (0) | 1 of 6 |
| particle-1, office-hours | first | 3 of 6 (3 missing) | 0 of 6 | 0, 0, 0 | 6 of 6 | 0 of 6 | 9 (4) | 1 of 3 |
| particle-1, office-hours | re-smoke | 6 of 6 | 0 of 6 | 1, 0, 1 | 5 of 6 | 0 of 6 | 1 (1) | 1 of 6 |
| Opus, lens | first | 2 of 2 | no detector | | | | 2 (2) | 1 of 2 |
| Opus, lens | re-smoke | 2 of 2 | no detector | | | | 2 (2) | 1 of 2 |

- No smoke session reached the 20-reply limit or an arm stop.
- **Sol's 5 of 5 is a descriptive lead for a next version, labelled as n = 5, scored under a detector that read it unexposed.** It isn't evidence that the skill works, and no takeaway rests on it. Those sessions ran with the founder whose audit later failed for volunteering facts. On the same six founders, Sol with no gstack scored 6 of 12 in the first run and 2 of 12 in the rerun, so the smoke founders were easier for Sol than its 16-founder average. Sol's office-hours sessions drew out 0.77 of the key facts on average, against 0.065 for its no-gstack sessions on all 16 founders, under that same founder.
- **The lens line is a second lead.** With "Hold a YC office-hours session with me." added, Opus asked the founder something in 2 of 2 sessions in each run, where its no-gstack sessions asked in 0 of 138. Two sessions a run can't carry a claim.

**What the preregistration's results section asks for that doesn't exist here.** Stage 2 never ran, so there is no office-hours minus no-gstack contrast, interval, p-value, worse count, exposure rate at stage 2, coverage, specificity contrast, length-adjusted line, arm-guess probe, per-type read, W by story shape or author family, or real stratum. The real stratum ran its 40 frozen web searches once, and its links stayed sealed. No page was read and no real-history founder was written, because that stratum was only ever going to run beside stage 2. The authoring funnel: after a 4-founder pilot, 124 founders were drawn and 96 passed every check, of which 86 were placed (16 calibration, 64 comparison, 6 reserve). The drops were 16 not unanimous, 8 given away by the pitch and 4 at audit. Second skins passed in 7 of 16 tries.

## Why null?

No primary ran, so the cycle reads the stop.

- **Did the model use the part?** We can't say from the instrument of record. The frozen detector read 0 of 18 office-hours sessions exposed on both smokes. By what we could count, Opus skipped the skill in 4 of 6 first-smoke sessions, Sol ran it in 6 of 6 in a format the detector couldn't see, and particle-1 loaded it without showing the procedure. Under our forced sentence, every model loaded the skill and none ran the interview.
- **Do the tasks fit?** The founders have room. Plain Opus scored 0.0208 and then 0 against a reference near 0.96 to 0.98, and the gap is exactly the evidence a skill would have to draw out. Whether the simulated founder plays fair is not known: it failed its first audit, mostly for volunteering, and its repaired version was never audited.
- **Were there enough samples and headroom?** Headroom, yes. Samples, no comparison ran. Stage 2 was sized to detect about 15 points of W on Opus at 64 founders, but it never started.
- **Does today's frontier model do it unaided?** No. Plain Opus never asked the founder anything, and plain Sol asked in 9 of 32 sessions and then 7 of 32.

**Verdict: R48 FIX-METHOD on the instrument (simulator and exposure).** It is not a CUT-CANDIDATE, because the skill's main intention, changing the founder's first move, was never measured. The preregistration also rules out a cut from this eval at any size. It is not a KEEP for the same reason.

## Next method

This is a proposal for a second version. It isn't started, and nothing runs until its own preregistration names the decision each outcome changes.

1. **An exposure detector tested on known transcripts before any data.** Freeze it from the skill's real output in every format it can print, including the prose fallback it uses when the question tool is denied (D-numbered decision briefs, a "Recommendation:" line in title case, a premises heading with or without its colon). Test it on fixtures written fresh for that purpose, exposed and unexposed, before any paid session.
2. **A forced line that keeps the founder interaction.** If the skill needs a push, the push should tell it to run every phase and put each question and decision to the founder, never to take its own recommendation. A small check for founder turns should pass before any of its sessions count.
3. **An audit floor the expected turn count can reach.** Size the fidelity audit from the turns the arms actually produce. Here the no-gstack arms gave the founder 0 to 9 turns per 32 to 69 sessions, so an audit can't lean on them. Draw its turns from the skill and lens arms, or from a fixed question script run against every fact sheet, and check the auditors' own agreement, which was weak here.
4. **A decision for each outcome before any spend.** For example: what gstack changes if office-hours beats no gstack, if it makes no measurable difference with the procedure running, and if the one-line lens does as well as the skill.

Two descriptive leads come with it, and neither is evidence. Sol's office-hours sessions scored 5 of 5 on the first smoke (n = 5, unexposed under the frozen detector, under a founder that volunteered facts). And the one-line lens got Opus to ask in 4 of 4 sessions, where plain Opus asked in 0 of 138. A version that compares office-hours with the lens on asking would show whether the procedure or just the framing gets the model to ask. It could also test whether a closing block requested only at the end changes how often plain models ask.

## Deviations from the preregistration

Each was recorded before the outcome data it could affect, unless the item says otherwise.

1. **The hold on paid stages was released with one condition unmet.** The preregistration held paid stages until another eval's stage 1 reading. That eval stopped before stage 1, so the condition could never be met. The release rested on the call that this eval uses invented founders, not mined keys. Pre-data.
2. **A pitch-only cell was added for stage 2 (AN-1).** On all three models, every arm once on the 64 comparison founders with the founder stopping before anything is drawn out, descriptive and outside the primary, with a condition on the helps headline's wording. Stage 2 never ran, so neither did this cell. Pre-data.
3. **The reference floor stayed as written, with the limit recorded (AN-2).** The reference's credit rate prints per item and per model, the drawing-out against deciding split is a finding only for particle-1, and the post says the room edge is close to automatic on Opus and Sol. Pre-data.
4. **The real stratum's searches ran through a built-in web search tool,** with the results written straight to sealed storage and used only as a list of links. Nothing else in that stratum ran. Pre-data.
5. **Stage 1 ran on 7 twin pairs, not 8.** Authoring passed only 5 of the first 8 second skins, all three failures being Sol's skins of Argon founders. A ruling gave second skins to the next calibration founders in draw order (c16, c17, c20 to c24 and c32), under the same checks and with no rewrite, and 2 of those 8 passed. That left 7 of 16 calibration founders with a passing twin, and a second ruling ran stage 1 on those 7 pairs (c1, c2, c5, c9, c14, c16 and c17), keeping the twin check's frozen floor of 6. By skin family, Sol's skins of Argon founders passed 3 of 10 and Argon's skins of Sol founders 4 of 6. The 9 failed pairs: c4, c6, c21 and c32 not unanimous; c10, c22 and c24 at audit check e; c20 and c23 at audit check c. The passing set isn't a random draw, since it is the founders whose second skin passed the checks, so 7 pairs detect a skin effect with less power than 8. Opus's no-gstack cell ran 69 sessions instead of 72. Pre-data.
6. **The first smoke launch was refused at admission.** Its item's cap sat below the first round's reserved worst case, so it refused with 0 sessions and nothing spent. A cap correction and resume of the same launch was then refused by the frozen guard that never resumes a launch after a cap stop, so the smoke ran as a fresh launch on new items with a corrected cap. The refused launch's record stays as it was. Pre-outcome.
7. **Every launch ended with a copy error after its results were written.** The end-of-run copy of the output folder hit the metering proxy's socket file and raised E_INTERNAL after the rows, stops and ledger closes were written. Each output folder was pulled with a content digest before the host was destroyed. Commit 9bb11dd fixes the copy for stage 2, which never ran.
8. **The founder prompt's one rule-wording repair**, quoted line by line above. The full frozen prompt text has sha256 f23dbc0e95f8a0eec255fd14df09fca69814271d5eab3fc4973825a0746a33bc and the repaired one cc5d9c04d0d1dcac79076138ec00ac515d683a379c643a1e1796afb80e8f81b6. Its last change targets the JSON failures, which the audit doesn't score. Pre-outcome for the rerun.
9. **The rerun stood on the first run's judge check.** Instead of a second paid check, a free guard compared the rerun's production labels with the first run's check judges on the fixed blocks both runs share; a kappa below 0.6 on any judge would have stopped for a decision. It read kappa 1 on all three. Pre-outcome.
10. **The "procedure ran" read was added**, after the first smoke was seen and before any re-smoke session existed. It decides nothing.
11. **Our build read "fewer than 40 founder turns" as fewer than 40 turns the draw can take.** The first run had 67 turns, but the frozen limit of 2 a session left 33, which were all audited against the 5% bar. Read the other way, as 40 drawn turns with at most 2 failing, the audit fails too.

## Limits and threats

- **The founder is a model following rules, and the evidence is invented.** It answers patiently, takes every recommendation and never pushes back. Constructed facts are cleaner than a real founder's. The claim is about the first customer or offering the founder's own evidence supports, as three models read it, not about what would have worked.
- **Both ends of the gap are partly built in on Opus and Sol,** as the takeaways and the AN-2 note say. particle-1 is the one model outside that selection.
- **The founder's fidelity is unknown.** The first run's founder failed its audit, mostly for volunteering, and the repaired founder was never audited. The Opus band doesn't depend on it, since no Opus no-gstack session gave it a turn and the reference has no founder. Sol's no-gstack W and every smoke number do.
- **The auditors disagreed often** (kappa 0.4853 on whether a turn had any violation). Astra marked violations that Opus never marked, such as invented detail on 10 turns.
- **The template may push models to answer at once,** the same way in every arm. Whether plain models ask more without it is untested.
- **The twin check tested nothing,** because every twin pass scored 0, and its 7 pairs aren't a random draw.
- **Gold is agreement between the two judges.** Astra and Opus made the gold at maximum effort, and the production judges are those same models at medium effort, so the high kappas partly reflect each model judging the same way twice.
- **The smoke is small:** 6 sessions a model, with 5 scored on Opus and Sol and 3 on particle-1 the first time.
- **The skill ran without its question tool,** asking through its prose forms, and without web tools. Its design doc, builder mode and landscape search are not scored.

## Setup

- **Question.** On invented founders whose hidden evidence points to one first customer and offering, does a session with gstack's office-hours skill end with that customer or offering more often than the same model with no gstack, or with a one-line YC office-hours prompt? Stage 1 checks that plain Opus has room for an effect, that the simulated founder follows its rules, that the judges agree with gold and that the skill's procedure runs.
- **Founders.** 16 calibration founders and 7 second skins, written by GPT-6.1 Sol at odd draw positions and Gemini 4 Argon at even ones, blind to the skill and the arms, from frozen story shapes, types and industries. Each has an opening pitch, a hidden fact sheet of 10 to 16 facts and a key. A founder stays only when Opus 5.5, Sol and GPT-6 Astra, given every fact, all name its customer and its offering, and none of them names either from the pitch alone. No Claude model wrote any part of a founder or a key.
- **Arms.** Every first message is the arm's first line, the pitch and the frozen closing template. none: "Help me think through this startup idea." lens: "Hold a YC office-hours session with me. Help me think through this startup idea." office-hours: "/office-hours Help me think through this startup idea." with gstack at garrytan/gstack b6155921 (VERSION 1.98.0.0), run as an interactive session. The no-gstack and lens arms had no gstack install.
- **Harness.** Claude Code with the claude-code-preset system prompt, a 200,000-token context window, CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1, and WebSearch, WebFetch and AskUserQuestion denied. Each session runs in a throwaway container with no keys inside and no network except the metering proxy, for at most 20 founder replies (then a closing message) and 120 minutes. The proxy journals of the first run's two launches name only Anthropic and OpenRouter as providers, with no status other than 200.
- **The simulated founder.** Gemini 4 Argon (google/gemini-4-argon on OpenRouter, pinned to Google's Vertex endpoint), at medium reasoning effort, temperature 0 and a fixed seed, with the frozen prompt and later its repaired wording.
- **Models.** Opus 5.5 (anthropic/claude-opus-5-5), GPT-6.1 Sol (openai/gpt-6.1-sol through OpenRouter, pinned to OpenAI) and particle-1 (particle-ai/particle-1 through OpenRouter).
- **Passes.** No gstack: Opus 3 passes on 23 founders (69 sessions), Sol and particle-1 2 passes on the 16 calibration founders (32 each). Reference: Opus 3 passes, Sol and particle-1 2, on the 16. Smoke: 6 office-hours sessions on every model on the first 6 calibration founders, and 2 lens sessions on Opus.
- **Judges.** GPT-6 Astra labels Opus's blocks, Opus 5.5 labels Sol's, and an Astra and Opus panel labels particle-1's, with Argon voting on splits. Production labels ran at medium effort and the judge check at maximum.
- **Dates.** Authoring 2026-11-12, the twin top-up 2026-11-14 at 07:01 UTC. First run 2026-11-14 from 09:06 to 10:02 UTC, with its labels, judge check and audit after it. Rerun 12:38 to 13:41 UTC. Both ran on one Ubicloud standard-8 VM, destroyed at 13:57 UTC after its data was sealed.

## Replicate it

Keyless, from the build that ran:

```
git checkout 7e375e0064b26b03a8c6f8fb5dd9b6cb12ccfa90
bun install --frozen-lockfile
bun test tests/of
bin/gstack-evals of dryrun
```

The dry run needs Docker. Commit 7e375e0 stays reachable in this pull request's history. The merged tree adds 9bb11dd, which changes only the end-of-run copy, the twin pin (now by content) and how a launch reports its own error.

The paid phases ran through these commands: `of run --cell stage1` and `of run --cell smoke` for the sessions, with `--repairs sim-prompt --sim-rules <file>` on the rerun and `--repairs sim-prompt forced-line` on the re-smoke; then `of packets`, `of check-packets`, `of judge`, `of audit`, `of score` and `of stage1`, each under `bin/gstack-evals`. The repaired prompt is the frozen one with the three lines above changed. This record leaves out the host setup, launch scripts and keys, and the sealed founders, transcripts and labels, so the paid readings can't be rerun from the repo alone.

## What is held out, and why

The founders (pitches, fact sheets and keys), every transcript, the simulator logs, the judge and audit labels and the scored rows stay sealed with the operator, with digests only. A published key would let later models train on the answers. Sealed bundles, plaintext sha256: authoring e959b18c1b4da50200e5074767cca823cfd40114b7e72670b51f87c630136ae9; authoring after the twin top-up 602b5c206e6e8361f62f540bbe0aed58f544ef0ab89457bc15ea6f537365a07e; the first run 812df0d8da7f15887cc150f81416a9508b4b7a4a9f1c1c0c587ad2b481589e50; the rerun 6601d41370fb184fd4dc1dad14dc476cb1481fc98fe0a3a5c4712cd8908c9766; the authoring pilot d0d5ce227d36af7df15b350c31ed6c86a29e662d7c7b0c584eb544f0211bd566; the real stratum's search results 880b2f24c2628e194ddcb6a92a92e4c14a53283e4113d6bad6e3935a80283fb9. The twin pin at 7e375e0 is 6a0395aca968e07a1418a8e527a6cc577fcaa5e27b4935cf354571ffa367fd53, and by content at 9bb11dd 5d172ce3ed6af1b04c10e9ee78b2be779d527b15015420ed9f29cb7b7d603250. Scored rows: first run 59cff5a427f02f4f5fcfff3716c75e7231efbb209b5f01260cf9062a175783c5, rerun fa33bde9d26f9b211d45a156f103bff45959957d6516cc5d60f59a9491727a18. Stage 1 readings: first run 65e4e5683ce15fe6036be2a9efe8a172663d2abde71f149e838775529ed673f5, rerun 9bcbf7f7c5f1e9a22d2cdf63ba5934b2cfde713bd4210879fcc7ed0de0c1f2ac. The first run's audit read eb5850ffa504ac779a9b3725dde2b24d7bea6ec99e54f219a8f76c4d210ae86e. These are operator-reported, not reproduced.

## Record

| Field | Value |
|---|---|
| Grade | Stage 1 gate readings. The eval ends at stage 1 as FIX-METHOD on the instrument. No comparison ran. |
| repo_commit | 7e375e0 on this pull request's branch, for the first run and the rerun; the merged tree adds 9bb11dd |
| prereg | [Frozen preregistration](../plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg/README.md) (#286) |
| data | Sealed bundles listed above (held out) |
| reviewed_by | This pull request's review |
| reproduced_by | Not reproduced |

## The X hook

We tested whether gstack's office-hours skill helps a model steer a founder to the first customer their own evidence supports. Before any comparison, plain Opus 5.5 never once asked our simulated founder a question before advising (0 of 69 sessions) and almost always missed that customer, though it found it in 96% to 98% of sessions when handed the facts. Then our instrument failed: the simulated founder volunteered facts, and our repair sentence told the skill to skip its own questions. No skill result yet. particle-1 shows the same gap (YC is an investor in Particle).

## Changelog

- 2026-11-14: first version.

## Agent notes

<details>
<summary>Spend, caps, waste and the line's all-in to date</summary>

- First run, from the ledger's close records: $133.26. Stage 1 runs $12.63, simulator $0.09, smoke runs $4.98, smoke simulator $0.60, labels $16.52, judge check $88.07, audit $10.37.
- Rerun: $49.49. Runs $13.63, simulator $0.09, re-smoke runs $20.20, re-smoke simulator $0.05, labels $15.51, audit $0 (NO READ, no call).
- Stage 1 paid calls in all: $182.75. Hosts for the line: $1.94, of which the stage 1 VM's 366.68 minutes were $1.53; two earlier runner VMs were set up, held no founder data, and were destroyed when stage 1 couldn't start.
- Authoring: $136.47 (pilot $2.29, authoring $129.19 plus one call with unreadable usage reserved at $0.17, twin top-up $4.99).
- The line's ledger items to date: $321.16 settled, hosts included, plus that $0.17 reserve.
- Waste, plainly. The judge check cost $88.07 against a first-packet projection of $32 to $45, because the first packet was a short particle-1 packet and not representative. The twin top-up cost $4.99 and passed 2 of 8 second skins. The first smoke launch was refused at admission because its $120 cap sat below round 1's reserved worst case of $132; it spent $0, and a raise to $150 and resume was refused by the guard, so that raise was never usable and the smoke ran on new items. The re-smoke's $20.26 mostly bought the lesson that our forced sentence removes the interview, and the rerun around it ended in NO READ.
- Caps, USD: first run items: runs 130, simulator 60, smoke runs 120 (raised to 150, never usable), smoke runs on the fresh launch 150, smoke simulator 30 and then 30, labels 90, judge check 100, audit 25. Rerun items: runs 130, re-smoke runs 150, simulator 60, re-smoke simulator 30, labels 40, audit 25. Every lease closed under its cap; the first smoke's admission refusal is the only cap stop.
- Crew model use, at about $1 per 1,000 credits: the preregistration thread 54,452 credits and the build and run thread 134,679 at the time of writing, about $189 together, before this pull request's ship check. These counter readings are operator-reported.
- **The line's all-in to date: about $510,** provisional on the crew figures ($321.16 on the ledger, hosts included, and about $189 crew), against a $4,000 line.
- Timeline, UTC, 2026-11-14: 07:01 twin top-up; 09:06 first run launched; 09:10 smoke refused at admission; 09:20 fresh smoke launched; 10:02 first run ended; 11:00 judge check started; 11:05 to 11:13 fidelity audit; 12:38 rerun launched; 13:41 rerun ended; 13:56 sealed; 13:57 host destroyed.

</details>

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- gstack is Garry Tan's own project.

---
id: 2026-11-27-geva-590-review-models-results
kind: finding
title: "Review pass models, Opus 5.5 and Sol against Fable 5.2 and Astra: the pilot stopped because gstack /review's procedure didn't reliably run (Opus 0 of 20 reviews, Fable at most 7 of 10 per arm; needed 9 of 10), so the eval ranks no model"
summary: "Pilot stop under R111: /review exposure 0, 0, 0 and 1 of 10 as read, at most 7 of 10 on any reading; Opus never called the Codex voice; the judge never qualified."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-27
status: done
links:
  - 2026-11-24-geva-590-review-models-prereg
  - 2026-11-26-geva-590-review-models-pre-run-change-10
  - 2026-11-27-geva-590-review-models-pre-run-change-11
  - https://github.com/garrytan/gstack/tree/284214fd896f493471b1bb5e98bcdc899a87bcdb/review
  - lanes/review-models/
attachments:
  - 56d13233ecf4c219f0c4655ea90a8cbf8d7227940ce602eebf05249ecb15ac4c  pilot-cells.tsv
---

# Review pass models: Opus 5.5 and Sol against Fable 5.2 and Astra: results

## Takeaways

- We learned that this eval can't answer its question yet, because gstack's /review didn't run its own procedure in our harness. The plan needed the procedure (specialist dispatch, the red team where required, and both passes of the second-model voice) in at least 9 of 10 bug-unit reviews per arm. The frozen reader found it in 0 of 10 for Opus 5.5 with Sol, 0 of 10 for Opus 5.5 with Astra, 0 of 10 for Fable 5.2 with Sol and 1 of 10 for Fable 5.2 with Astra. That reader has a defect (below), but even the most generous reading of the raw sessions gives 0, 0, 7 and 7. So the pilot stopped under R111, before any validation or counted unit. You should prove, keylessly, that a skill's procedure runs on each model before paying to compare models on it.
- We learned that Opus 5.5 never called the second-model voice. The meter shows 0 Codex requests in all 22 Opus /review sessions. Fable 5.2 sent Codex requests in 21 of 22 sessions, but a voice pass printed a completed status far less often (table below). A Codex request is not a finished voice review.
- We learned that a Fable 5.2 /review session cost about 9 times an Opus 5.5 /review session here ($17.85 and $18.77 per attempted review against $1.96, ledger upper bounds), and 5 of 22 Fable sessions ended without a review. This page ranks no model and no voice, and makes no full-path decision.

Call settled: none (the pilot stopped under R111; no model, voice or default changes)

## What works

The no-gstack arm passed its pilot. Plain Opus 5.5 produced a parseable review in 11 of 11 sessions, its read audit found no gstack file or drive path in any of them, and it cost $0.38 per review.

The supply path worked. All 11 pilot unit trees were prepared and passed the history and clean-tree checks, and no unit was refused. Those are structural checks only: as pre-run change 3 set, each unit's install and test commands were `true`, so no dependencies were installed and no unit tests ran. The contamination read found 0 contaminated and 0 doubtful sessions in all 55. Code review later found that the key's B-unit markers leave out a fix given as a bare pull request number. That affects 2 of the 5 pilot B units, and none of their 10 sessions names either fix pull request. This branch fixes the key code, with a test; the pilot's contamination read ran on the old key.

The money controls held. Every lease closed inside its cap, the pilot spent $450.21 of its $1,034 envelope, the retry reserve was never drawn, and no paid call ran outside an admitted ledger item.

## What didn't work

### The part under test didn't run

The pilot's part-ran check (R111) reads each gstack session for the procedure gstack 284214fd's /review describes: a printed specialist selection, one launch per selected specialist that returns, the red team on diffs over its size threshold, and the voice's adversarial challenge and structured review, each held in a Codex rollout. Counts below are over the 10 bug units per arm; the decoy is left out.

| Arm | Exposed (frozen reader) | Sessions with Codex requests (all 11) | Voice adversarial printed completed | Voice structured printed completed | No selection line printed | Red team required, not launched | Specialist selected, not launched | Reviews with a specialist launched, never returned |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 + Sol (OS) | 0 of 10 | 0 | 0 | 0 | 6 | 7 | 2 | 0 |
| Opus 5.5 + Astra (OA) | 0 of 10 | 0 | 0 | 0 | 4 | 7 | 3 | 0 |
| Fable 5.2 + Sol (FS) | 0 of 10 | 10 | 6 | 3 | 3 | 1 | 1 | 1 |
| Fable 5.2 + Astra (FA) | 1 of 10 | 11 | 4 | 2 | 4 | 1 | 1 | 0 |

Each count is of the 10 bug-unit reviews per arm. The one FS review in the last column lost two specialists (maintainability and security). An earlier version of this table counted launches instead and showed 2 for FS and 2 for FA; the two FA launches were the Claude adversarial subagent, not specialists. Apart from specialists, the Claude adversarial subagent was launched and never returned in 1 FS and 2 FA reviews, and the red team in 1 FA review.

In 16 of the 17 reviews with no selection line, the session still launched other subagents, so dispatch happened without the printed line in most of them.

### Real skips against reader ambiguity

Some failures are the reader's, not the model's, so we recounted the 40 gstack bug-unit reviews from the raw sessions three ways:

| Reading | OS | OA | FS | FA |
|---|---|---|---|---|
| The frozen reader, as run | 0 of 10 | 0 of 10 | 0 of 10 | 1 of 10 |
| The reader with its rollout defect fixed | 0 of 10 | 0 of 10 | 1 of 10 | 3 of 10 |
| Most generous: ignore selection-line wording and a missing selection line, and count the voice as run whenever its Codex rollouts exist | 0 of 10 | 0 of 10 | 7 of 10 | 7 of 10 |

The rollout defect: the reader takes a Codex thread's first user message as its prompt. In units that carry an AGENTS.md, Codex puts that file in first, so both voice passes were filed under the adversarial gate and the structured pass read as "no rollout". This branch fixes that, with a test. The fixed reader still splits the two passes by a marker in the prompt, and Fable often writes its own prompts, so its split is approximate. That is why the third row exists.

Even the third row is below the 9 of 10 bar in every arm. On that reading, what still fails is real: in FS and FA, a voice pass that never ran or printed no status with no rollout to show for it, a red team never launched, or a specialist selected and never launched or never returned. In OS and OA nothing changes on any reading, because the Opus sessions never called the voice at all. pilot-cells.tsv holds the frozen reader's reading.

The Opus sessions rarely said why the voice didn't run. One wrote "the Codex outside review (optional, not run)", another "I skipped the Codex outside review", and the other 20 never said they skipped it. In the session we read in full, Codex 0.170.0 was installed and found, and the keyless rig check before the pilot showed both Codex calls fire when invoked. We did not test whether /review's text at this pin makes the voice optional for the main agent.

### Supply and cost

Five of 22 Fable sessions ended without a review. Four hit their per-session allowance (E_ALLOWANCE: $27 for FS and $36 for FA) on the same two units, at $23 to $28 each. One FA session spent $21.30 inside its allowance and ended with no final assistant turn. One Opus session (OS) ended with specialists still running in the background and printed no findings block. Under the Captain's ruling (2026-11-27 03:10Z), no session was rerun: an exhausted allowance is not an infrastructure miss.

## Result

### All 55 pilot cells

| Arm | Planned | Ran | Parsed review | Not parsed | Ledger spend (upper bound) | Per attempted review | Per parsed review | Mean wall time |
|---|---|---|---|---|---|---|---|---|
| N | 11 | 11 | 11 (1 with no findings) | 0 | $4.18 | $0.38 | $0.38 | 1.1 min |
| OS | 11 | 11 | 10 (1 with no findings) | 1: no findings block | $21.61 | $1.96 | $2.16 | 3.6 min |
| OA | 11 | 11 | 11 (2 with no findings) | 0 | $21.61 | $1.96 | $1.96 | 3.8 min |
| FS | 11 | 11 | 9 | 2: E_ALLOWANCE | $196.31 | $17.85 | $21.81 | 24.8 min |
| FA | 11 | 11 | 8 | 3: 2 E_ALLOWANCE, 1 no final turn | $206.51 | $18.77 | $25.81 | 22.3 min |
| All | 55 | 55 | 49 | 6 | $450.21 | | | |

Spend is the ledger's committed figure per arm, stopped sessions included. It is an upper bound: two FA sessions hold 4 calls whose sends failed after they may have reached the provider (the connection closed), and the ledger keeps each at its worst-case charge ($0.79 above the sessions' metered total). The pilot readout prints FA at $154.84 over 9 reviews; that figure leaves out those two sessions, and the ledger figure here replaces it. pilot-cells.tsv has every cell: termination, parse, metered spend, unknown calls, wall time, voice requests and each exposure failure.

### The staged rule (section 7)

Applied as frozen, it keeps Fable: the cost gap's lower bound is $12.63 per review (mean $15.75 over 20 unit-and-voice pairs, 2 unpaired), against a headroom of 94.1%, so $12.63 / $25 is 50.5% of the headroom's break-even. The headroom is large because the pilot alone bounds Opus's catch rate low (2 of 5 P units and 1 of 5 B units caught by the mean of OS and OA; one-sided 95% lower bounds 7.6% and 1.0%). Those catches are Carbon's, read before Carbon qualified, which pre-run change 5 allows for this rule only; they are not results. The readout used the drawn counted set's P share (73 of 100). With the 98 buildable units (71 P, 27 B; pre-run change 11) the headroom is 94.2%, and Fable still stays. The rule is moot under the stop.

### The judge never qualified

Gemini 4 Carbon judged 45 reviews (the 44 parsed bug-unit reviews and the OS review with no findings block). Its calls count only once Grok 4.7's labels pass R78 (kappa at least 0.6 on 100 bug-unit labels). They never did. Grok labelled 9 reviews, each served by Amazon Bedrock as pinned. The 10th reply came back HTTP 200 with no provider named and no usage, so the send stopped on E_CSO_PROVIDER_DRIFT, discarded that reply and sent nothing more. Even with every label, the check could not have reached 100: the pilot gives 44 eligible bug-unit reviews, and the validation batch would add 50 or 51, for about 94 on the full path and 95 on the paths without Fable or without Astra. No decoy, duplicate or synthetic label fills that gap. So no catch rate, contrast or quality ranking here counts.

### Denominators

The frame and draw are as pre-run change 11 records. The counted set drew 100 bug units (73 P, 27 B); 2 P units are refused for every arm because GitHub no longer serves their pinned heads, which leaves 98 buildable (71 P, 27 B) and 12 decoys. The validation batch drew 17 (12 P, 5 B). All 137 distinct unit trees were prepared and passed the history check. None of the validation or counted units ran. Power for 98 units would have come from the plan's 100-unit row (main-effect MDD 8.7 to 10.2 points) as an approximation; no new power calculation was run.

## Why null?

This is not a null on review models. It is an R111 pilot stop. The part under test didn't run, so the eval measured nothing about whether Fable or Astra helps.

- Exposure: the procedure ran in 1 of 40 gstack bug-unit reviews as the frozen reader read them, and in at most 14 of 40 (none on Opus) on the most generous reading.
- Task fit and supply: all 11 unit trees were prepared and ran (no builds, installs or unit tests), and the plain arm reviewed all of them.
- Samples and headroom: not reached; no counted unit ran.
- Does the frontier model do it unaided: not reached.

## Limits

Everything here is an observation on one pin and one harness: gstack 284214fd, Claude Code 2.1.314 run headless, Codex CLI 0.170.0, a 60-turn limit, the review-units reader map at that pin, per-session allowances of $10.50 (OS), $19.50 (OA), $27 (FS) and $36 (FA), and units whose install and test commands were `true`. It is not a claim about current gstack, other harness versions or interactive use. Ten bug units per arm is a pilot, not an estimate of any rate.

## What would reopen it

- A keyless proof, at a named gstack pin, that /review's full procedure (selection, specialists, red team, both voice passes) runs in nearly every session on each main reviewer in this harness, and that the reader scores the output gstack actually prints.
- A label supply that can deliver at least 100 eligible bug-unit labels: a pinned labeller route that stays stable, or another qualified labeller.
- Per-session allowances sized to Fable's measured cost (sessions reached $28 here).
- A new preregistration with caps approved before any paid call.
- Fixes for seven defects the final code review found in this eval's own code. They are unresolved: this branch closes the eval instead. Every step that could pay, write over the pilot's evidence, run, resume or validate a batch, or issue a judge or visibility qualification now refuses with E_RM_CLOSED before it reads, writes or spends anything (rm-post's contamination, sends and validation readout; rm-supply's visibility steps; rm-run's pilot plan, pilot run and e2e, though not the pilot's dry run or its items step, which only records ledger items and spends nothing; review-units with --cell-items). The pilot readout still reads. None of the seven fired in the pilot: it had no reruns, no validation batch, no judge that qualified and no visibility request sent twice. The seven:
  1. The judge check counts reviews that neither labeller labelled toward its 100-label minimum.
  2. The validation batch writes over the pilot's contamination report.
  3. The readout doesn't charge reruns recorded with the final attempt to the retry reserve.
  4. A rerun's first attempt is never journaled, so the readout counts 0 reruns.
  5. A refused rerun's record names a folder that doesn't exist.
  6. Cell leases can't reopen on resume once spent.
  7. Visibility replies are not tied to the prompt they answered.

## Records

The run export (cells, transcripts, proxy journals, ledger record, judge and label replies, the readout) is kept outside this repository with the run's other private material; the bundle's sha256 is 0ed5a75206463ec476ed8af69743842cd87e95b38e705019cea44e0a34122f5a. The pilot ran from review-models-results at 70fbd33, on run id review-units-20261126T230921Z-5efa with order seed 1795598571. The post steps ran from the same checkout: rm-post key, contamination, judge-send, label-send and readout, as lanes/review-models/post/README.md lists. The Ubicloud host was deleted after the export was verified.

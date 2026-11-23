---
id: 2026-11-02-geva-122-r2-amendment
kind: plan
title: "R2 amendment: build and gstack pins, the told digest, claude-code-preset on both arms, cap-stop scoring, A1 and B1"
summary: "Pins R2's build (#124 at f255edf) and gstack 77fe28c, records the told digest, scores a cap-stopped session against its own arm with a coverage rule, carries A1 and B1, reruns the dry run."
author: GEVA-122
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: open
source: "Captain drive handoffs/GEVA-129/r2-amendment/README.md (sha256 9e16ecafcf3f1f314cf92dc19154fff5193b6061f2ca18b7149fa14f35bb2aa4), drafted by GEVA-122 and GEVA-129. GEVA-140 filled in the build pin and the read rule's digests, brought section 3's read rule in line with the build, replaced dry-run-r2.txt with its rerun at the build pin, and wrote section 12 from the draft's closing rerun note."
links:
  - 2026-11-01-geva-101-r48-follow-ups-prereg
attachments:
  - 2bca2d9ddd584d05c090519679ccaf53517d7eb84d8c5c23f65829d814e89ac9  blind.py.txt
  - 9b985a8cd2b9dfbbea6b29cf7957a77533853e166924b210acee829ae4ea11aa  dry-run-r2.sh.txt
  - dfc2786115ae6bc3b63aece641b32bdd50d8677053d7b35cb0a1f24103aa5de0  dry-run-r2.txt
  - aab900bac2a156115a44b3186da4e7b9237b30288f55906f5c4d0fc0411aad20  r1-exposure.py.txt
  - 060376b9697d92e4c5e089b90fea089a17d503a9b7a099d37677f1ecebde4670  r2-caps.py.txt
  - 0f903ba9ae1701fd5fce76511edd245cc16aa237c465a139986d82c00af2b2ce  r2-source.py.txt
  - baa28ee65c3b86c3806d6d1aa2c18c731c45de3922214cb0487f4ddb63b6854e  r2-stub-arms.ts.txt
  - bceb6a442b185e98d05cfe78769270ee553a28eb0e2cefcc47c9aadf7f41ba90  told-gstack-full.txt
---

# R2 amendment

This post amends section 3 (R2) of [2026-11-01-geva-101-r48-follow-ups-prereg](../2026-11-01-geva-101-r48-follow-ups-prereg/README.md) (#112, main f0b81c0). Section 3.6's done line asks for it: once the R2 build merges, an amendment pins the build commit and the gstack commit, records gstack-full's told digest, and reruns the dry run with a stub run's real driver output. Every other rule, pin and attachment of #112 stands as written, and R1 and R3 are unchanged. Where this post names an attachment of #112, it means that file in #112's folder, pinned by its sha256 there.

R1 said "R2 runs" (#120: blind blocking recall 67.2% for GSTA-167's full procedure against 10.3% for none-opus), so R2 starts when this post merges, under section 5's start rule.

## 1. Pins

| What | Pin |
|---|---|
| R2 build (gstack-evals) for both R2 sessions | #124's merge commit f255edf5e6e7f9ddcfc37b792058500edae3643d (a squash of head c6635f7); both R2 sessions run from a checkout of it |
| gstack for gstack-full | garrytan/gstack 77fe28c39796cf5573e3d0836b83b2ee436a8f12 (v1.92.39.0), gstack main when this was drafted, 2026-11-02 |
| gstack render | interactive, gstack setup's default: no `--render` and no `--session-kind` on either run. 142757b's unattended render is the ceremony eval's variant, not R2's |
| gstack-full's told prefix | told-gstack-full.txt, section 3.2's line; the prefix (the file without its final newline) has sha256 db9ec7b42f9b2e86c7f51354d581cb47d775fbbc2ebe4e8a229764a5f92540ad, which arm.json records as told.prefix_sha256 |
| Reader map | src/trial/review/reader-maps/gstack-77fe28c39796.json at the build pin, sha256 9cb0e15069aa1b28ae370728cd87ef2d441dcf2cfa3a28ce4c75bbd1fa2292ed, pinned to the gstack commit above |
| Read rule at the build pin | capped.ts 717e33723cd1a4d2acc8d7d11d8e7dd3f966b609855c2c28df98b6a45fc38fa9 (CAPPED_PARSER_SHA256, which arm.json records as cap_stops.parser_sha256), readers.ts 96a26a73a47c4c28d55b57bf774d9eac16c7e133b8a54632990f0b93797c7a3c (its readTranscript feeds capped.ts) and findings.ts 584c81bcc40202798713cec9647c3a45c282373b379196e8fee413caa7ddb959 (PARSER_SHA256); section 12 |
| System prompt | claude-code-preset on both arms (section 2) |
| Turn cap and allowance | 200 turns and $40 per session on both arms, as section 3.2 set them |

The rig pin for judging and scoring (715f837, section 1 of #112), the suite (stacks-r1-out19, sha256 0719dbbd24303e65b44e879091cfacd4669500a9d55114fb07de16ad86021d40), the judges and the judge brief stay as #112 pins them.

## 2. claude-code-preset on both arms

The Captain (GSTA-2) ruled that R2 runs every Claude arm on `claude-code-preset`. GEVA-109 (#119, GST-841) verified that every past harness ran Claude Code on the Agent SDK's default, an empty system prompt. none-r2 is rerun anyway, so both R2 arms move to Claude Code's own system prompt together. #108's none-opus and gstack-opus, printed beside R2's results, ran on the SDK default; that is one more reason they decide nothing.

## 3. How R2 scores a cap-stopped session

_Internal planning record: these budget and cost figures are plans and caps, not findings._

The R2 build records a session that the turn cap ends as its own termination, `turn_cap` (the CLI's `error_max_turns` result), and a session that the per-session allowance stops as `allowance_stop` (the metering proxy's E_ALLOWANCE refusal that names the slot's allowance). Before the build, the first was recorded as completed and the second as a missing cell (GEVA-116's open note on #119).

Both R2 runs set `--cap-stops`, which turns these terminations and the rule below on. A run without it, whatever its `--max-turns` and `--allowance`, keeps main's records: the turn cap ends a session as completed, and an allowance refusal is a missing cell (E_ALLOWANCE). GSTA-2 ruled on 2026-11-02 how R2 scores capped sessions:

- **Scored, not dropped.** A session that ends in turn_cap or allowance_stop is scored, and counts against its own arm, the same in both arms. Its unit gets the findings of the latest main-agent text block in the session's transcript.ndjson whose last json block parses as a findings array, never an AskUserQuestion's question (section 12); with no such block, or no readable transcript, it is a missing pass, scored as finding nothing. It is never a coverage gap, and its arm stays complete. If the procedure can't finish inside the allowance, that is a real cost of the arm, and the results post says so.
- **Coverage rule.** Each arm has 19 sessions. If more than 2 of either arm's 19 end in turn_cap or allowance_stop, R2 gives no outcome and goes to the Captain as FIX-METHOD with the counts. At 2 or fewer, the verdict stands.
- **Counts and sensitivity.** Beside the headline, the post prints each arm's cap-stop count (turn_cap and allowance_stop) and a complete-case sensitivity: both arms restricted to the units where neither arm was capped, through `noloss derive --drop-file` and `noloss score`. Both are reported and never decide.
- **Order.** r2-caps.py (attached) is read first. It reads cap_stops from both source arms' arm.json, prints the counts and writes the drop file. Its exit 4 is R2's outcome, whatever r2-decide.py says. r2-decide.py, frozen in #112, then gives the verdict. Its "an arm stopped" path now covers only an arm that a coverage gap or a cell not run stops, since a cap stop no longer stops an arm.

The frozen procedure gate (both the specialists and the adversarial pass in 18 of 19 PR-passes, section 3.3 of #112) still reads every gstack-full PR-pass, capped or not. So a capped session counts toward it only if it dispatched the specialists and the adversarial pass before the stop. Two capped gstack-full sessions that dispatched neither would leave 17 of 19, and R2 would give no outcome through the gate.

The allowance binds worst-case committed spend, which includes the reservations of calls still in flight. So a session that runs readers in parallel, as gstack-full's Review Army does, can stop with less than $40 settled. arm.json's diagnostics line for each capped session records its settled metered spend. Next to the complete-case sensitivity, the results post lists every allowance_stop with its settled spend and flags any that stopped below $36 (90% of the allowance).

A cap-stopped session is never rerun to change an outcome. The run's spend cap is a different stop: a cap stop (CAP_STOP) on the r2a-grid or r2b-grid item is an incomplete run. At #112's estimate of about $16 per gstack-full session, $40 holds about 2.5 times the mean. Neither GSTA-167's arm C nor #108 recorded turn counts against a 200-turn cap, so the turn cap's margin is unmeasured.

## 4. Source arms

review-units names each arm `<arm>-<model tag>`: R2's runs write arms/gstack-full-opus and arms/none-opus, since `--arms` names a no-gstack arm `none`. comparisons.r2.json scores gstack-full against none-r2. r2-source.py copies each run's arm to a source dir under the comparisons' id and changes arm.json's id and nothing else. It replaces r2-arms.py, which built #112's dry-run fixtures. r2-source.py's header comment says the runs write arms/none-r2-opus; they write arms/none-opus, as this section and the dry run show. The script takes the arm dir as an argument, so the comment changes nothing it does, and the attachment stays as pinned.

## 5. A1: blinding keeps ordinary review words

#112's /ship round 2 (outside voice, finding 1) found that blind.py rewrites any reader name outside a nine-word ORDINARY set to `<reader>`, in every arm. Once gstack-full writes `reader:api-contract`, `reader:data-migration` or `reader:state-machines` rows, "breaks the API contract", "data migration" and "state machines" become `<reader>` in both arms, and a judge can no longer match a finding whose key noun was erased. The Captain ruled it a note binding on this amendment.

R2 uses this post's blind.py. ORDINARY now also holds every reader name of the reader map (the ten Review Army checklists, so data-migration, api-contract, state-machines and red-team too), plus batched and normalizer. What stays rewritten in R2 is adversarial-native, "Review Army" and the model ids. The dry run shows the change on the stub run's real reader rows: #112's blind.py rewrote 9 findings in each arm ("This breaks the <reader> for existing callers"), and this post's rewrote none.

## 6. B1: the reader-row format, and exit 5 on a malformed row

The same round (finding 3) found that a reader row in a format the gate's unit ref doesn't parse counts toward no PR-pass, so the gate fails and R2 would read as FIX-METHOD when the input was bad. The Captain ruled it a note binding on this amendment.

**The format, as the R2 build writes it** (src/trial/review/readers.ts, READER_ROW, and its README): one row per reader per PR-pass, after the PR-pass's all and voice rows. `pr` is the suite's unit id exactly, as the all row writes it (`garrytan/gbrain#7511@6b01f793f2bc`); `scope` is `reader:<name>` with a map name, `adversarial-native`, `batched` or `other`; `pass` is the pass number; `total_tokens` is the sum of the reader's task usage, or `unavailable`; `meter_source` is `reader-counter`; every other column is `unavailable` or blank.

**The gate.** R2 runs this post's r1-exposure.py. It keeps #112's file name so that r2-decide.py runs it. A reader row whose `pr` is not a suite unit id, whose `pass` is not 1 to arm.json's passes, whose meter_source is not `reader-counter` or whose name is empty is bad input: the gate exits 5 (E_GATE_ROW), and r2-decide.py exits 5, an error and never an outcome. So does a cost.tsv and findings in which no row or finding names a PR-pass of the suite (the wrong suite, or rows in another format). Other rows with a blank pass still count toward no PR-pass, as before.

## 7. The allowance default

Section 3.6 item 2 calls the default allowance "$15". That was stacks round 1's run setting (its amendment's `--allowance 15`), not the code's default. review-units' default is SESSION_ALLOWANCE, 1.6M input and 32k output tokens at the model's price, about $7.04 a session for Opus 5.5. The build keeps that default, as item 2 asks ("defaulting to today's values"), and records `allowance_usd` in run.json only when `--allowance` is set. R2 sets $40 on both runs, so this changes nothing R2 does.

## 8. Commands

Each arm runs alone, in its own out dir, on its own item (section 5), from a gstack-evals checkout at the build pin (section 1). S2 is the derived suite (section 3.1 of #112); the flags not named here are stacks round 1's step 5 flags (`--severity-map` from its post, `--test garrytan/gstack=true --test garrytan/gbrain=true`, and `--source` clones that hold each unit head). API keys come from the ledger's run environment, never the command line.

    gstack-evals review-units --suite $S2 --units all --arms none --models claude-opus-5-5 --passes 1 \
      --system-prompt none=claude-code-preset --max-turns 200 --allowance 40 --cap-stops \
      --reader-map src/trial/review/reader-maps/gstack-77fe28c39796.json \
      --item r2a-grid --spend-cap 25 --out <dir>/r2-none <stacks round 1 step 5 flags>

    gstack-evals review-units --suite $S2 --units all \
      --arms gstack-full=garrytan/gstack@77fe28c39796cf5573e3d0836b83b2ee436a8f12 --models claude-opus-5-5 --passes 1 \
      --system-prompt gstack-full=claude-code-preset --told-prefix gstack-full=<this post>/told-gstack-full.txt \
      --max-turns 200 --allowance 40 --cap-stops --reader-map src/trial/review/reader-maps/gstack-77fe28c39796.json \
      --item r2b-grid --spend-cap 325 --out <dir>/r2-full <stacks round 1 step 5 flags>

Both commands go through `--dry-run` first, which prints the cap-stop line, the reader map and the worst case at the allowance. Then, with this post's scripts and #112's beside them:

    python3 r2-source.py <dir>/r2-full/arms/gstack-full-opus gstack-full-opus gstack-full <src>/gstack-full
    python3 r2-source.py <dir>/r2-none/arms/none-opus none-opus none-r2 <src>/none-r2
    python3 r2-caps.py $S2 <src>/gstack-full <src>/none-r2 <dir>/caps-drop.tsv
    python3 blind.py $S2 <src>/gstack-full <src>/none-r2

Ingest, the gate (r1-exposure.py), judging on r2-judge-match and r2-judge-adjudicate, scoring with comparisons.r2.json and r2-decide.py follow section 3 of #112 and dry-run-r2.sh's order. r2-caps.py's exit 4 is read before r2-decide.py (section 3). The complete-case sensitivity then runs on the final judged arms:

    gstack-evals noloss derive --suite $S2 --comparisons comparisons.r2.json --id stacks-r1-out19-cc \
      --out <dir>/cc --root <final arms root> --drop-file <dir>/caps-drop.tsv
    gstack-evals noloss score --suite <dir>/cc/stacks-r1-out19-cc.json --root <dir>/cc/arms \
      --prereg <dir>/cc/comparisons.stacks-r1-out19-cc.json --variant gstack-full --reference none-r2 --out <dir>/score-cc.json

## 9. Dry run

dry-run-r2.sh reruns the R2 section of #112's dry-run.sh, keyless, with R2's fixture arms replaced by a stub run's real driver output. r2-stub-arms.ts runs the R2 build's run loop and Claude Code driver at the build pin, through the pinned Agent SDK, with the build's stub CLI answering every model call, under R2's settings. Judging runs the rig's judge-run against #112's fake provider. dry-run-r2.txt is its output at the build pin, f255edf; section 12 compares it with the first run at e47981f.

- **Pins.** Rig 715f837 clean; #112's attachments match their digests; the reader map names gstack 77fe28c. The suite derives to 0719dbbd... with 19 units and 13 blocking blockers, and the four R2 items record at $25, $325, $25 and $25.
- **Stub run.** Both arms record claude-code-preset; gstack-full records told.prefix_sha256 db9ec7b4...; each gstack-full PR-pass writes four reader rows in the pinned format. Both arms record cap_stops of 0 in the pass run.
- **Source arms.** r2-source.py copies both arms, and refuses an arm.json whose id isn't the one given (exit 5).
- **A1.** #112's blind.py rewrites 9 findings per arm; this post's rewrites none, and both arms ingest.
- **Gate and B1.** The gate passes 19 of 19 on the stub rows and fails 12 of 19 when 7 PR-passes ran no adversarial reader. A reader row with the owner dropped from `pr`, one with a blank pass, and the wrong suite each exit 5; #112's gate gave exit 3, 0 and 3 on the same input.
- **Ledger.** One lease each on r2a-grid and r2b-grid settles; a second run on r2b-grid is refused (E_ITEM_BOUND).
- **cap2.** none-r2 has 2 capped sessions: one ends `turn_cap` after writing its review at turn 2 and is scored on those findings, one ends `allowance_stop` with no review and is scored as finding nothing. gstack-full has 1, a `turn_cap` with no review and no readers. Both arms stay `complete` with no coverage gaps, and diagnostics name each capped session with its settled spend, for example `garrytan/gbrain#7674@af88cba164b0 pass 1: missing; ended allowance_stop, settled spend $0.000000, scored as finding nothing` (the stub's calls cost nothing, so every capped session settles $0). r2-caps.py prints gstack-full 1 (turn_cap 1, allowance_stop 0) and none-r2 2 (turn_cap 1, allowance_stop 1), writes a drop file of 3 units and exits 0. The gate passes 18 of 19, and r2-decide.py gives KEEP (11 of 13 against 2, interval +30.8 to +100.0). The complete-case sensitivity derives 16 units with 10 blocking blockers and scores 90.0% against 10.0%, delta 80.0 points [95% CI 50.0, 100.0].
- **cap3.** gstack-full has 3 capped sessions (turn_cap 2, allowance_stop 1) and none-r2 none. r2-caps.py prints "R2 outcome: none (cap stops: gstack-full 3, none-r2 0)" and exits 4; r2-decide.py is not consulted.
- **Outcomes.** Fake answers give KEEP (12 of 13 against 2), CUT-CANDIDATE (2 against 7) and FIX-METHOD (7 against 5, interval +0.0 to +38.5). The failing gate, an arm stopped, a null interval and a judgment marked coverage incomplete each give no outcome; a missing score file and a malformed reader row each make r2-decide.py exit 5.

## 10. Attribution

#112 says "Garry's rulings for this post (A1 and B1, through GEVA-2)". That is wrong. A1 (one prereg freezes all three experiments; R1 runs at merge; R2 and R3 each start only after their build PR merges and an amendment pins it) and B1 (the caps) were rulings by GSTA-2, the gstack-evals Captain, under R42 on 2026-11-01. Garry did not rule on them. The record is approvals/2026-11-01-r48-follow-ups-caps.md in the Captain drive. The caps themselves are unchanged. The A1 and B1 of sections 5 and 6 above are a different pair: the two notes from #112's /ship round 2 that the Captain ruled binding on this amendment.

## 11. Changes from #112

- Section 3.2 and 3.6: the build commit and the gstack commit are pinned (section 1), and gstack-full's told digest is recorded.
- Both arms run on claude-code-preset (section 2).
- With `--cap-stops`, a cap-stopped session is scored against its own arm. The post prints per-arm cap-stop counts and a complete-case sensitivity, and R2 gives no outcome when more than 2 of an arm's 19 sessions are capped. This changes #112's "an arm stopped" path (section 3).
- r2-source.py makes the source arms (section 4); r2-arms.py was a dry-run fixture only.
- blind.py keeps the reader map's names as ordinary words in R2 (section 5, A1).
- The reader-row format is pinned, and the gate exits 5 on a malformed row (section 6, B1).
- The allowance default is SESSION_ALLOWANCE, not $15 (section 7).
- The attribution of #112's A1 and B1 is corrected (section 10).
- The dry run reran at the build pin with no change in any outcome, and the read rule's three files are pinned by digest (section 12).

## 12. Rerun at #124's merge commit

#124 changed after the first dry run, which ran at e47981f. b1c0624 scores a cap-stopped session on its main agent's own text blocks in host/transcript.ndjson, so findings-shaped text inside an AskUserQuestion question no longer earns credit (Step 11's outside voice on #124). GSTA-2 asked for the dry run to rerun at the merge commit and to report every capped-score change against the e47981f outcomes, case by case.

**No capped score changed, and no other outcome did.** dry-run-r2.sh at f255edf prints the same lines as at e47981f except three kinds: the build line; capped.ts's sha256 in arm.json's cap_stops (ce50f662711733c5b595b391263e13f6f816dfb59e15c16afc7a28b2cb3ee49f at e47981f, 717e3372... at f255edf); and ids that change from run to run (lease ids, judge run ids, judge batch ids and the complete-case arms' tree digests). A second run at e47981f differs from the first only in such ids, so they say nothing about the build.

| Case | e47981f | f255edf |
|---|---|---|
| Stub run, scenario pass: cap stops per arm | 0 and 0 | same |
| Gate on the stub rows: pass run, fail run | 19 of 19, pass; 12 of 19, fail | same |
| B1: owner dropped from pr, blank pass, wrong suite | exit 5 each | same |
| Scenario 1 | KEEP: 12 of 13 against 2, +76.9 [+53.8, +100.0] | same |
| Scenario 2 | CUT-CANDIDATE: 2 of 13 against 7, -38.5 [-61.5, -15.4] | same |
| Scenario 3 | FIX-METHOD: 7 of 13 against 5, +15.4 [+0.0, +38.5] | same |
| Gate failing, an arm stopped, a null interval, coverage incomplete | no outcome each | same |
| Missing score file, malformed reader row | exit 5 each | same |
| cap2: cap stops | gstack-full 1 (turn_cap 1); none-r2 2 (turn_cap 1, allowance_stop 1) | same |
| cap2: capped scores | none-r2's turn_cap session scored on the review it wrote at turn 2; none-r2's allowance_stop session and gstack-full's turn_cap session missing, scored as finding nothing | same |
| cap2: gate and verdict | 18 of 19, pass; KEEP: 11 of 13 against 2, +69.2 [+30.8, +100.0] | same |
| cap2: complete case | 16 units, 10 blocking blockers; 90.0% against 10.0%, +80.0 [+50.0, +100.0] | same |
| cap3 | gstack-full 3 (turn_cap 2, allowance_stop 1), none-r2 0: r2-caps.py exits 4, no outcome | same |

The stub's sessions ask no AskUserQuestion, and the one capped session with a review writes it as a main-agent text block, so the old rule (the record's turns) and the new one (the transcript's text blocks) read the same text. #124's test "a findings block inside an AskUserQuestion question earns no capped credit" covers the case the fix changes.

**The read rule's digests.** CAPPED_PARSER_SHA256 hashes capped.ts only, and capped.ts reads the transcript through readTranscript in readers.ts. Section 1 pins all three files the rule runs at the build pin. R2's sessions run from a checkout of f255edf, so the rule can't change during R2 and a resume can't mix two versions of it. No script checks the pin, so the operator does: before each review-units command, `git rev-parse HEAD` in the run's checkout must print f255edf5e6e7f9ddcfc37b792058500edae3643d, and the run record keeps that line. arm.json's cap_stops.parser_sha256 can't stand in for it, because capped.ts is the same at f255edf and on main after this post (717e3372...); a different value only shows a different capped.ts. For later --cap-stops runs on main, the PR that lands this post folds readers.ts's sha256 into the cap-stops session key's verifier (#124's Capy finding 01M6CQXNNGE54SG49F6JF38VN0), so a change to readTranscript refuses cached capped cells. That fix is not in the build pin, and it changes no record R2 writes.

**The other pins hold on main.** The reader map's sha256 is 9cb0e150... on main and at f255edf. It names gstack 77fe28c, where all ten of its checklist paths and its adversarial marker exist, and 77fe28c's VERSION is 1.92.39.0. gstack's main has moved on since (1.92.47.0 on 2026-11-02); R2 stays on 77fe28c, the commit the map reads. Neither pin moved.

## Attachments

- blind.py.txt: R2's blinding step (A1).
- r1-exposure.py.txt: R2's procedure gate (B1).
- r2-source.py.txt: source arms under the comparisons' ids.
- r2-caps.py.txt: R2's cap rule (counts, the coverage rule and the complete-case drop file).
- told-gstack-full.txt: gstack-full's told prefix, for `--told-prefix`.
- r2-stub-arms.ts.txt: the dry run's stub run of the R2 build.
- dry-run-r2.sh.txt and dry-run-r2.txt: the dry run and its output at the build pin.

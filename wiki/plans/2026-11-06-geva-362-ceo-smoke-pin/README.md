---
id: 2026-11-06-geva-362-ceo-smoke-pin
kind: plan
title: "CEO outcome eval, smoke pin: build 2ef58339, the six smoke rerun commands, the start rules and a keyless dry run"
summary: "Pins the smoke rerun to build 2ef58339 and exposure digest 00652947, freezes its six commands and no-exception gate, sets the start rules, and runs a 40-row keyless dry run."
author: GEVA-362
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-06
status: open
links:
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-324-ceo-pin
  - 2026-11-06-geva-338-ceo-pin-part-2
  - 2026-11-06-geva-341-ceo-stage-1-gate-amendment
  - 2026-11-06-geva-345-ceo-stage-2-amendment
  - 2026-11-06-geva-348-ceo-scorer-stage-2
  - garrytan/gstack-evals#214
  - garrytan/gstack-evals#248
attachments:
  - 5c3ae1d00e9834a24f96ae0911bb6efd3481be476def5964f4c194366a527e16  dryrun.sh.txt
  - 5a0dfa4e5a23bdf741df737f277b2453d09324deb26f73c025794dc41f38edcc  dryrun.txt
---

# CEO outcome eval, smoke pin

This is the smoke pin post that the stage 2 amendment's order (b) calls for (2026-11-06-geva-345-ceo-stage-2-amendment, Big decision 7 and section 9, step 3). It pins the build #248 merged, freezes the six smoke rerun commands and section 8's gate, and sets the start rules the Captain's rulings on #245 and #248 leave to this post. It adds no rule beyond the amendment and those rulings.

Nothing here spends. No model was called and no VM started to write it. Like every post on this eval, it holds counts, categories and sha256s only (#214, section 15). Code lines are at the build commit unless marked.

## 1. The pin

- **Build commit:** 2ef58339524591c50a3c4bdfd79b7ea2218ca5b8, tree 5ba405f13f82a6111e74a5851d9d7008b0e68e29, the squash merge of #248 into main. The smoke rerun, its gate and every rows, packets and readings step after it build and run from this commit only. That is the CEO pin post's operator rule 1 (its section 5) with 2ef58339 in place of 715c659.
- **The exposure digest moves.** #248 changes src/trial/review/ceo-exposure.ts, so `CEO_EXPOSURE_SHA256`, the sha256 of the file's own bytes (ceo-exposure.ts:50), moves from c0498fa065cb3c50f44cd93d78417577e706a4b0ddd3c491c9ffcb0b7718dd19 to 006529475723657f1823d7be18997b865c43e4d9d89b93d0aa956ee2f4f1e5a2. The CEO pin post (section 1) and part 2 (section 1) pinned the old digest at build 715c659. `ceo rows` writes the digest into rows.json (ceo-cli.ts:511), and packets and readings refuse rows whose exposure_sha256 isn't the checkout's (ceo-cli.ts:543). So stage 1's rows.json, written at 715c659, doesn't read at this commit. Any rows the rerun's readings need are rebuilt here from the runs.
- **The parser stays.** ceo-outcome.ts is byte-identical to 715c659, so `CEO_PARSER_SHA256` is still 8d1826c539a636d03a67d35073175c1dcaa34ee325d8f36226308a9aa7c851d8, and stage 1's journals stay readable beside the rerun's.
- **gstack pins.** Standalone (gstack-forced) keeps garrytan/gstack@699a41cb6808e01240d02e82247693f9170d401a, as in stage 1. The enforced arm (gstack-enforced) runs garrytan/gstack@4743132ca027d487fb02bb5f8ce94f2816ff8e7c (1.96.0.0, tree 9340ccf599e3c6dbb550ca2cef5b24a5a36aefa3, the tree the rig tier checks), with `ceo_review_gate on` in its gstack config (skill-gates.ts:27 and :29).

**Every digest the smoke's rows are checked against:**

| What | sha256 | Where it binds |
|---|---|---|
| ceo-exposure.ts, the exposure detectors | 006529475723657f1823d7be18997b865c43e4d9d89b93d0aa956ee2f4f1e5a2 | rows.json's exposure_sha256; packets and readings refuse another (ceo-cli.ts:543) |
| ceo-outcome.ts, the closing-block parser | 8d1826c539a636d03a67d35073175c1dcaa34ee325d8f36226308a9aa7c851d8 | each journal's parse (ceo-cli.ts:240) and rows.json's parser_sha256 (ceo-cli.ts:542) |
| the stage 1 suite file, suites/ceo-o-cal.json | a3677868258d3afbe03eb69fab6afa9878a689044882e4d4e2ec427766775b38 | units.json's suite binding; rows refuse runs whose bindings differ (ceo-cli.ts:142 and :441) |
| the suite's units dir, catalogs_sha256 | 49fe256e8d3a8f2d0cfdd4d163bee369a9a1af75ed38e9c4029b051a843ff564 | rows, packets and readings refuse a --units dir that hashes to anything else (ceo-cli.ts:130) |
| the suite stub, suite-stub.json (part 2) | f0ca2aa36c6d27b29295f729523b74b01d08a13deba1fd771294d9d1a0019fcc | the --suite every command passes |
| template.txt (prereg) | b7c4c11020eff83695534cb32f10f019824b8775d92a1b1237ce72aeea05d862 | `CEO_TEMPLATE_SHA256` |
| stock-list.txt (ladder amendment) | 9ecbc78e696836bd11c3e89df1cc1cb0b0e28940b92e7dd3a96846224e47fe3c | `STOCK_LIST_SHA256` (ceo-cli.ts:46) |
| judge-brief.md (ladder amendment) | d7b3dce1498e01e874f1dae024ac90e79e5ff5e3af12cc5ed37e2f8a48a14fb5 | judge-run |
| the forced line, CEO v2's forced-line.txt | d4f56ad49c82e6b8ca9a2ec05b24a641c45e9d158e11c9de65420008b66d4e43 | `FORCED_LINE`, the told line of both gstack arms |
| ceo-rule.ts.txt (the stage 2 scorer post) | 31a56dd12b531f1cd1f26519921cc2731e7d7ea2b6e215e117d220c7b0c9573a | copied beside the readings and checked by sha256 before it runs |
| stage2-sizing.txt (the stage 2 amendment) | d9edc0e4a5f6f621a79621b06b81fe03571c0000dff7df5b48b00cce90e24c68 | the grid compare reads |

The price table and both OpenRouter routes are byte for byte the part 2 pin post's (dry run section P), and the proxy reserves 32,768 output tokens a call (metering-proxy.ts:79).

## 2. The smoke rerun's commands

Six items on units 1 and 2 of the stage 1 suite, one round of two sessions each, twelve sessions in all (the amendment, section 8). The names are part 2's (its section 3): SR, SRC, STUB, LED, REC and RUNS on the runner host, and the shared flags C, unchanged:

```
C="--suite $STUB --sealed-root $SR --plan ceo-outcome --parallel 3 --timeout 3600 --max-turns 150 \
   --source ceo-o/plan=$SRC --base-branch ceo-o/plan=main --ledger $LED --record $REC"
GS=garrytan/gstack@699a41cb6808e01240d02e82247693f9170d401a
GE=garrytan/gstack@4743132ca027d487fb02bb5f8ce94f2816ff8e7c
```

SINK is a directory on the host's disk, outside RUNS and the repo. Each item's receipts sink is $SINK/<item>, which must not exist before the launch (section 4.1).

| Item | Cap | Command |
|---|---|---|
| ceo-o-sm2-opus-e | $15 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-opus-e bin/gstack-evals review-units $C --units 1 2 --arms gstack-enforced=$GE --system-prompt gstack-enforced=claude-code-preset --arm-session-kind gstack-enforced=unattended --models claude-opus-5-5 --passes 1 --item ceo-o-sm2-opus-e --spend-cap 15 --out $RUNS/sm2-opus-e` |
| ceo-o-sm2-opus-p | $15 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-opus-p bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --arm-session-kind gstack-forced=unattended --models claude-opus-5-5 --passes 1 --item ceo-o-sm2-opus-p --spend-cap 15 --out $RUNS/sm2-opus-p` |
| ceo-o-sm2-sol-e | $20 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-sol-e bin/gstack-evals review-units $C --units 1 2 --arms gstack-enforced=$GE --system-prompt gstack-enforced=claude-code-preset --arm-session-kind gstack-enforced=unattended --models openai/gpt-6.1-sol --passes 1 --allowance 10 --item ceo-o-sm2-sol-e --spend-cap 20 --out $RUNS/sm2-sol-e` |
| ceo-o-sm2-sol-p | $20 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-sol-p bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --arm-session-kind gstack-forced=unattended --models openai/gpt-6.1-sol --passes 1 --allowance 10 --item ceo-o-sm2-sol-p --spend-cap 20 --out $RUNS/sm2-sol-p` |
| ceo-o-sm2-particle-e | $1 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-particle-e bin/gstack-evals review-units $C --units 1 2 --arms gstack-enforced=$GE --system-prompt gstack-enforced=claude-code-preset --arm-session-kind gstack-enforced=unattended --models particle-ai/particle-1 --passes 1 --allowance 0.5 --item ceo-o-sm2-particle-e --spend-cap 1 --out $RUNS/sm2-particle-e` |
| ceo-o-sm2-particle-p | $1 | `GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/ceo-o-sm2-particle-p bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --arm-session-kind gstack-forced=unattended --models particle-ai/particle-1 --passes 1 --allowance 0.5 --item ceo-o-sm2-particle-p --spend-cap 1 --out $RUNS/sm2-particle-p` |

- **Arms.** Both gstack arms take their line from the lens, FORCED_LINE and then the ask, so neither needs --told-prefix. The enforced arm adds the gate, its record copy and its report (the amendment, section 3.3). none and lens don't run in the smoke.
- **Session kind.** `--arm-session-kind <arm>=unattended` sets GSTACK_SESSION_KIND=unattended for that arm only (Big decision 10). Before any session, the run checks the arm's own tree's gstack-session-kind in its session env and refuses with E_SESSION_KIND_PIN unless it prints unattended (run.ts:439).
- **Allowances and caps** are section 8's: Opus at the default $7.04, Sol at --allowance 10 and particle-1 at --allowance 0.5. A round of two sessions at allowance is $14.08, $20.00 and $1.00, so each cap admits its one round (dry run sections D and L). The six caps sum to $72.
- **The sink.** The runner host is deleted after the smoke, so each command sets GSTACK_EVALS_EPHEMERAL=1 and names its own receipts sink (src/trial/durable.ts:42). The run copies its receipts, journal and session records there when it ends. The sink holds the same material as RUNS and is handled as RUNS is.
- **Ledger.** Each item gets its own `ledger init` at its cap, with --admission warn, --by GSTA-2 and the Captain's words from the approvals record of the six smoke caps. The Captain records those caps only after this post merges and the check of section 4.2 passes. review-units leases each item for its cap, and each item binds one run (E_ITEM_BOUND), as part 2's section 5 says. The smoke runs detached on a runner host (section 9, step 4).
- **Operator rules.** The CEO pin post's section 5 carries, with 2ef58339 in place of 715c659: build from the pinned commit only, check the units dir, never --resume a cell that stops.json lists, and no --resume after a runner or machine loss without the Captain's approval and a ledger check first. A resume or repair counts as a launch for section 4.1.

## 3. The gate, with no exception

Before anything after the smoke spends, all three of these hold (the amendment, section 8):

1. This command exits 0:

   ```
   bin/gstack-evals ceo rows --stage 1 --smoke-round 2 --units $SR/units --run $RUNS/sm2-opus-e --run $RUNS/sm2-opus-p \
     --run $RUNS/sm2-sol-e --run $RUNS/sm2-sol-p --run $RUNS/sm2-particle-e --run $RUNS/sm2-particle-p --checks
   ```

   It prints a `session` line for both sessions of each of the six items and ends its checks with `checks: 12 sessions, 12 pass, 0 fail` (ceo-cli.ts:490). The command checks only the sessions it finds in the runs (ceo-cli.ts:482), so exit 0 alone doesn't show that none is missing, and a count under 12 fails the gate. Each of the 12 sessions is journaled, has a readable transcript and a parsable last block, holds the end state #214's section 6 gives, is scored, and passes every check of its arm's exposure detector (standalone's two, enforced's four).
2. Its output prints no `copy_out:` line, and each of the three `gate:` lines, one per enforced cell, reads `report exits 0 on 2`. A report that exits 2 (GATE_NOT_ARMED) or 3 (GATE_ERRORED) on any session fails the gate. In stage 2 such a session keeps its class and reads unexposed (Big decision 4), but the smoke admits no exception.
3. The smoke findings check of the CEO pin post's section 4 runs as frozen. No session in these items carries findings_written, so it has nothing to compare.

A failed gate stops the line before any comparison unit is authored. The run thread reports each session's checks and causes to the Captain, and nothing reruns without a new post. The stage 1 gate amendment (#242) covered stage 1 only and grants nothing here.

**Rule 5 on the rerun** is read by ceo-rule.ts headroom and projection on smoke_round 2 readings, as the scorer post sets it (its item 2): a cell is admitted when both its sessions pass the gate and finished within 1800 s. A cell that fails only the 1800 s leg is untested in stage 2. When that cell is enforced on Opus, stage 2 doesn't start.

## 4. Start rules and preflights

### 4.1 The fresh sink (binding)

Before each launch of each item, a resume or repair included, the run thread checks that $SINK/<item> does not exist (`test ! -e`) and records the check, the path and the time in its trail: the run's status log and its report. The Captain granted #248's review-loop exception on this condition (p2/adversarial-native#1): copyToSink merges and never deletes, so a reused sink would mix attempts. It is an operational check, not a guard. run.ts:361-378 accepts an existing sink, and durable.ts:96-106 merges into it. The dry run checks the sink before and after each command (section D).

### 4.2 P: the pre-smoke all-in check on crew actuals (binding)

The first of section 7.3's three all-in checks, before the smoke, runs on crew actuals as of that day. Each CEO crew thread's platform counter is read at about $1 per 1,000 credits, and the lines go through the scorer's allin. The Captain records no smoke cap without it. When the sum passes $2,000, section 7.3's cut order applies before any smoke cap is recorded.

As of writing (2026-11-06T18:11:19Z):

| Crew thread | Credits |
|---|---|
| The 18 threads to the amendment's start (GEVA-285, 288, 289, 291, 295, 300, 303, 307, 311, 314, 321, 324, 327, 337, 338, 339, 340 and 341) | 469,623.50 (the amendment read 469,608) |
| GEVA-345, the amendment | 18,296.80 |
| GEVA-347, the amendment's /ship | 24,214.82 |
| GEVA-348, the build | 34,987.86 |
| GEVA-351, the build, part 2 | 22,670.61 |
| GEVA-358, the build's /ship | 28,562.58 |
| GEVA-362, this post, at the reading (23.74M tokens) | 5,508.27 |
| **Crew spent** | **603,864.45, so $603.86** |

Crew rest prices the crew lines still to come in tokens at the table's $0.40 per million: this thread's 51.26M tokens left to its 75M stop ($20.50), the smoke rerun thread ($16.00), authoring overhead ($10.00), the stage 2 pin post ($32.00), the stage 2 run thread ($32.00) and the results post ($40.00), so $150.50. Every other line is the amendment's table (section 7.2), with stage 1's runner host in runner_hosts as the scorer post carries it (its open note 3).

| Line | Dollars |
|---|---|
| crew spent | 603.86 |
| crew rest | 150.50 |
| crew reserve | 30.00 |
| stage 1 settled | 17.60 |
| smoke rerun caps | 72.00 |
| authoring and mining | 275.93 |
| runner hosts | 12.93 |
| stage 2 run caps (199, 203, 152, 186, 10 and 12) | 762.00 |
| stage 2 judges, one shared cap | 70.00 |
| **All-in** | **1,994.82** |

allin prints `All-in: PASS ($5.18 to spare)` (dry run section A), against the amendment's $1,992.07 at the same caps. The crew lines for the same work run $2.75 over the table: the amendment and its /ship cost $42.51 against $28.00, the build's three threads $86.22 against $100.00, and this thread counts $26.01 (its counter plus the rest of its stop) against $24.00. The Captain's own thread and its gate subagents aren't counted, and neither is the difficulty ladder, as in the amendment's section 7.1. On the smoke day this thread's line is its final counter, not its stop.

### 4.3 F: the in-flight hold (binding)

Section 5's trip rule holds room for one call's worst case at a 200,000-token prompt. The proxy commits each call's full worst case until it settles (metering-proxy.ts:561-571), and every call reserves its 32,768 output tokens whatever its prompt ($0.66 on Opus). A hold that fired on any two calls in flight would fire on small calls that fit that room. So the hold has a size threshold:

- **Threshold.** For each model, one call's worst case at 200,000 prompt tokens, priced as projection's trip check prices it, at the rerun's measured bytes per token and cache-write mode. At the amendment's planning inputs it is $3.491 on Opus, $6.167 on Sol and $0.135 on particle-1 at 5-minute cache writes, and $5.192, $9.572 and $0.237 at 1-hour writes (dry run section T).
- **Report.** For every smoke session, the run thread reports the meter's peak in-flight calls and reservation and its largest prompt, beside its model's threshold. projection prints the first three per session (the scorer post, item 12) and the threshold as each trip check line's worst case at 200,000 prompt tokens.
- **Hold.** When a smoke session on a model shows two or more calls in flight with a peak reservation above its model's threshold, stage 2 waits on a re-size of that model's allowances. Each allowance on the model must then hold the largest peak in-flight reservation the smoke showed on that model, plus twice the cell's largest session spend, as well as the trip rule. The re-sized allowances go into section 9 step 5's projection and all-in, before the comparison set is sized. At or under the threshold, two calls in flight fit the room the trip rule already holds, and nothing waits.

### 4.4 I: E_ALLOWANCE stops per cell, and when a cell is harness-limited

An E_ALLOWANCE stop that leaves no block scores as a miss, and such stops fall mostly on the gstack arms: stage 1's two stops were Sol standalone sessions, and its none items saw none in 140 sessions. So:

- **Count.** Every cell's allowance_stop sessions are counted and reported: projection prints them per smoke item, and compare prints them per stage 2 cell (the scorer post, item 12).
- **In the smoke.** A session that stops on its allowance before writing its block fails the gate (section 3, item 1). Any other stop is reported with the session's largest prompt.
- **Threshold, frozen here.** A stage 2 cell is harness-limited when more than 10% of its planned sessions end in allowance_stop. The 10% matches the preregistration's NO READ share and its 0.90 coverage floor. The results post names every harness-limited cell beside each contrast that reads it. A null or negative result on such a contrast gets its R48 reading as FIX-METHOD (harness), never CUT-CANDIDATE. The count and the label decide no verdict word: Holm, the MDD and the verdict rules stand.

### 4.5 J: one shared judge cap (binding)

The three stage 2 judge items share one cap: the all-in table's judges line, which projection prints from section 7.3's formula (the larger of twice the projected judges and $70, $70.00 at this table). No cap is recorded from section 7.3's per-item rule, under which each judge item was capped at the stage 2 envelope less stage 2's settled spend, about $309 each at the amendment's table. The judges run one at a time, and each judge item is recorded at the shared cap less what the earlier judge items settled, so the three together can't pass it. The figure is set when the Captain records stage 2's caps, from the projection at that step. It enters every all-in check as that one line.

### 4.6 K: the cache-write mode

The meter records the cache-write modes each session's requests asked for (none, 5m or 1h; metering-proxy.ts:547) and the most bytes per token (metering-proxy.ts:692). The run thread records both for every smoke session, and projection's trip check reads the highest mode and the most bytes per token per model (the scorer post, item 4). So section 5's worst cases and allowances are recomputed from the measured mode at step 5, before caps are recorded. The worst case already prices the proxy's 32,768 output tokens, not the amendment's 32,000.

The mode matters for the smoke itself. At 1-hour writes, with twice the largest planning session committed, Opus's $7.04 trips at 193k prompt tokens and Sol's $10.00 at 143k, both under 200,000; particle-1's $0.50 trips at 262k (dry run section T). Stage 1's largest prompt was 133,119. So if the rerun's requests ask for 1-hour writes, a long Opus or Sol session can end in allowance_stop, and one that does before its block fails the gate. The allowances are section 8's, and this post doesn't change them.

### 4.7 H: the all-in rerun before authoring

Section 9 step 5's rerun of the all-in check, on crew actuals, the smoke's settled spend and the rerun's per-session spends, governs before authoring and again before the first stage 2 lease. The project owner gets that MDD and dollar figure before stage 2 spends. The amendment's crew line is undercounted (section 4.2 gives the actuals so far), and this post doesn't compute stage 2's figure.

### 4.8 Section 16

The smoke uses no new provider, route or dataset (the amendment, section 10). Both OpenRouter routes are part 2's, and OpenRouter's public feeds were re-read keyless (dry run section O): 2 of Sol's 9 endpoints and particle-1's 1 endpoint serve inside the routes, and neither provider's data policy records training or publishing. OpenAI's entry still shows retainsPrompts true, as part 2 disclosed. The Captain's Sol route ruling stands: the run thread looks up every Sol call's generation id on both Sol items, reports checked and unchecked counts, and a call served by any provider other than OpenAI stops the Sol items and goes to the Captain.

## 5. Harness deviations, named

- **B1, the 30-second hook timeout.** The enforced arm passes the settings JSON that `gstack-skill-gates settings --ceo-review` prints at 4743132, with the two ceo-review shims' timeout raised from 10 to 30 seconds, so the frozen 20,000 ms gate deadline governs (skill-gates.ts:30-35; GATE_KEY rides the session key). #248's armed test case 7 proves it through the pinned CLI. gstack later fixed the shipped timeout on its main branch (garrytan/gstack commit bd36aa0b): the deadline is clamped to 20 s, and every gate hook's timeout is the deadline plus a 5 s margin, 25 s. The arm stays on the 4743132 pin, because an arm under test keeps its pin, so B1 stays a deviation here. A later round on a newer pin can drop it.
- **D1, a 200,000-token window.** Every ceo-outcome session, on every arm and model, runs with CLAUDE_CODE_DISABLE_1M_CONTEXT=1 (ceo-arms.ts:12). Through the pinned CLI's own getContextUsage(), #248's armed test read a 200,000-token window that compacts at 167,000 on Opus 5.5, GPT-6.1 Sol and particle-1. Without the line, Opus 5.5 reads 1,000,000, compacting at 967,000.
- **The results-post limit.** Claude Code's default for Opus 5.5 is the 1,000,000-token window, and this eval runs 200,000 on every arm. The results post names it as a limit.

## 6. Custody disclosure

The stage 2 amendment (section 3) let the build thread read the two smoke commands' shapes under custody and record only the grammar class each fell in. The build thread also read the other gstack-auto sessions in the two smoke bundles it opened, through the same redacting script. The script printed no unit text, plan text, review text, path or file name, and nothing from those sessions was recorded beyond the checks the stage 1 record already holds. That read was wider than the grant's letter. The Captain accepted it after the fact on 2026-11-06, because no unit text was exposed and no fixture uses those sessions. The stage 2 results post names it too.

## 7. Open notes

Carried from #248:

1. **The sink copy runs only at run end** (run.ts:677). A runner that dies mid-run leaves finished sessions' gate evidence only in the out dir on the host.
2. **The fresh-sink rule is an operational check, not a guard** (section 4.1). Every launch, resume and repair must use a new sink for the exception's protection to hold.
3. **p1/red-team#2:** gate_armed counts any copy_out entry, so a failed copy of any file reads the enforced session unexposed. Narrowing it would change how the amendment's copy-failure case reads, so it stays as written.
4. **Coverage gaps:** no test pins ceoRunPrompt("gstack-enforced") or forcedPrefixOk for gstack-enforced. The dry run's section D shows the enforced arm's line is the forced line.

New here:

5. **projection's judges line still describes the per-item cap.** It prints `one shared cap line across the three judge items, each capped at the envelope less stage 2's settled spend` (ceo-rule.ts.txt:563). The text decides nothing. Section 4.5 governs how the judge items are recorded.

## 8. The dry run

dryrun.sh.txt ran at 2ef58339524591c50a3c4bdfd79b7ea2218ca5b8 and printed dryrun.txt: 40 rows, 40 passed, `DRYRUN: ok`. Run it as `bash dryrun.sh.txt <build commit> <gstack-evals clone>`. It unsets the model and Ubicloud keys, so nothing is spent and no VM starts. It reads OpenRouter's public feeds over the network without a key.

1. **Pins (P).** The build commit's tree; the scorer, sizing, template, judge brief, stock list, stub and mkunits.ts files; the exposure digest and the parser against their files' own bytes; FORCED_LINE; the enforced arm's pin, gate config and GATE_KEY; the context env; both OpenRouter routes; and the price table.
2. **Public smoke unit (U).** Part 2's invented unit, built by its merged mkunits.ts.txt and passed by `noloss suite --check`.
3. **Dry runs (D).** Each of section 2's six commands on the public unit, with its sink env. Each checks that its sink is absent before and after, exits 0, prints its arm with the forced line and claude-code-preset, lists its arm session kind as unattended and the 200,000-token window, and fits a round of two at its allowance inside its cap. One more row shows the arm session kind comes from --arm-session-kind.
4. **Trip check (T).** Section 5's rule on the six items at the amendment's inputs, at 5-minute and 1-hour cache writes, with section 4.3's thresholds. The 5-minute rows match the scorer post's table, and stage 1's Sol flag still trips at 85k.
5. **Ledger (L).** One lease opened and settled per smoke item on a temporary ledger, and a second run refused with E_ITEM_BOUND.
6. **All-in (A).** Section 4.2's lines through the scorer's allin.
7. **OpenRouter (O).** Section 4.8's endpoints and data policies.

**Limits.**

- **Not the real run's flags.** The public suite holds one unit, so the dry run passes --units all where the smoke names --units 1 2, and its --suite, --sealed-root, --source and --out point at the public unit. It passes no --ledger or --record, which a dry run doesn't open.
- **No gate replay.** `ceo rows --checks` needs session runs, so the dry run doesn't replay section 3's gate. #248's tests drive `ceo rows --smoke-round 2 --checks` on synthetic runs (tests/trial/review/ceo-stage2-rows.test.ts).
- **Planning inputs.** The trip check and the thresholds use stage 1's bytes per token and the amendment's planning sessions. Step 5 recomputes both from the rerun's meters.
- **Figures as of writing.** Section A's crew figures are hard-coded at the reading. The smoke-day check reruns them on that day's counters.
- **Network reads.** Section O reads live feeds, so a rerun can differ.

## 9. Not in this post

Running the smoke, recording any cap, authoring, stage 2's MDD and dollar figure, and any code change.

## Attachments

| File | What it is |
|---|---|
| dryrun.sh.txt | the keyless dry run, run as `bash dryrun.sh.txt 2ef58339... <gstack-evals clone>` |
| dryrun.txt | every line it printed at 2ef58339, with the scratch dir written as $T and home as ~ |

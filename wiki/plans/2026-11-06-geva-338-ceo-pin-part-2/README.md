---
id: 2026-11-06-geva-338-ceo-pin-part-2
kind: plan
title: "CEO outcome eval pin, part 2: the stage 1 suite, every item's command, a keyless dry run, temporary-ledger leases and the data-use check"
summary: "Pins the stage 1 suite (sha256 a3677868, stub f0ca2aa3, binding 49fe256e), each stage 1 item's command, a 41-row keyless dry run at 715c659, the data-use check and GEVA-337's tool changes."
author: GEVA-338
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-06
status: open
links:
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-289-ceo-rule-guards-amendment
  - 2026-11-05-geva-295-ceo-ladder-amendment
  - 2026-11-05-geva-300-ceo-stop-label-amendment
  - 2026-11-05-geva-324-ceo-pin
  - GST-1389
  - GST-1562
attachments:
  - 8c2ad40be58f3808a3caf52dbc5a6d5995361b566f66a80a8c11269fc431344d  dryrun.sh.txt
  - e3f7e4387c7613109c1acf7b59284f46c7d3069bd541d0d3d2a9afdd4959e112  dryrun.txt
  - b4cc64e30721700e70e2b972efeee4e448dc02516dc13e9f89726e6afe8eee04  mkunits.ts.txt
  - f0ca2aa36c6d27b29295f729523b74b01d08a13deba1fd771294d9d1a0019fcc  suite-stub.json
---

# CEO outcome eval pin, part 2

The preregistration's start rule 5 (#214, section 14) and the part 1 pin post (#235, "Not in this post") leave these pins for a second pins-only post: each stage 1 item's exact command, review-units --dry-run with the frozen flags on one public smoke unit, one ledger lease opened and settled per item on a temporary ledger, the price table re-read and section 16's data-use check. GEVA-337's report adds two more: the sealed suite file with its stub sha256, which need the unit ids, and a disclosure of the tool changes it made during B2. This post holds all of them.

Nothing here spends. No model was called and no VM started to write it. The post changes no frozen rule, threshold, arm, size, cap or verdict rule. One line needs the Captain's eye: the Sol allowance flag in section 4, which carries out the preregistration's own dollar figure rather than the harness default. Like every post in this repo, it holds counts, categories and sha256s only (section 15): no unit, key, source link or project name.

## 1. The pin, restated

- **Build commit:** 715c6594851c558edcd64f97e6627ef55a7cbbec, tree a969577910cd906c47b66878dfc70a6d1028c397 (#230), as the part 1 pin post fixes it. The dry run below exports that commit with git archive and runs there.
- **Frozen files at that commit** (dry run section P): ceo-rule.ts.txt 2222e0cfa65f9f105d6645a70fc6a4bed67d9f0f75033d6e935cdebb7fcaf179, template.txt b7c4c11020eff83695534cb32f10f019824b8775d92a1b1237ce72aeea05d862, judge-brief.md d7b3dce1498e01e874f1dae024ac90e79e5ff5e3af12cc5ed37e2f8a48a14fb5, stock-list.txt 9ecbc78e696836bd11c3e89df1cc1cb0b0e28940b92e7dd3a96846224e47fe3c, exposure digest c0498fa065cb3c50f44cd93d78417577e706a4b0ddd3c491c9ffcb0b7718dd19, parser 8d1826c539a636d03a67d35073175c1dcaa34ee325d8f36226308a9aa7c851d8, and FORCED_LINE equal byte for byte to CEO v2's forced-line.txt (d4f56ad49c82e6b8ca9a2ec05b24a641c45e9d158e11c9de65420008b66d4e43).
- **Price table, re-read** (section 13 asks for it): src/runner/pricing/prices.ts at the pin gives, in dollars per million tokens of input, output, cache read and cache write, Opus 5.5 4, 20, 0.20, 5; Sonnet 5.5 2, 10, 0.20, 2.50; GPT-6.1 Sol 2, 10, 0.10, 2.50 and 4, 15, 0.20, 5 past 272,000 prompt tokens, on both its OpenAI and OpenRouter rows; particle-1 0.10, 1, 0.003. These equal section 13's table. OpenRouter lists particle-1 at 0.05 and 0.50 today, half the row, so the ledger meters particle-1 at twice its list price and errs safe.

## 2. The stage 1 suite

GEVA-337 sealed the calibration slice but built no suite, because a ceo-outcome suite needs unit ids. GEVA-338 built it under custody on 2026-11-06, logged line by line in CUSTODY.md (section "Stage 1 suite: GEVA-338"):

1. slice-final.tar.gz.age (ciphertext 62e46c6a1e1c9248fc9b039d24d8df3950ee71ba940b5ac649344a379d50da51) was decrypted into /dev/shm only.
2. A check script recomputed B2's units digest over slice-final's own folders and got 3b6596f096719ac1eb553f31a152211a0a6787669c719581ef4cbf95dfe425d5, the custody addendum's figure. It matched all 20 slots' unit, plan.md and key.json sha256 and kind with the addendum's table (20 of 20).
3. mkunits.ts (attached, byte for byte the script that ran) built the unit repository, the units dir and the suite file, copying each plan.md and key.json byte for byte.
4. `noloss suite --check` passed the suite, and `noloss suite --stub` wrote the stub (attached as suite-stub.json).
5. The result was sealed as handoffs/GEVA-338/sealed/ceo-o-suite.tar.gz.age: ciphertext 66f5cafca34539d15320182591232d283878c951e3560b058c25ab0f07f00669 (234,909 bytes), plaintext tar.gz ebb0e81c749a18302be9f481c74430c29289d03894c80de2be94b36839931a98 (234,661 bytes), decrypt-checked.
6. /dev/shm/geva-338 was removed and `test ! -e` passed.

**What the suite is.**

- **Unit repository.** One repository named ceo-o/plan, whose main branch is one empty commit. Branch pr-<n> holds slot S<n>'s unit as one commit that adds plan.md and context/project.md. A session sees its unit at /work/plan-<n>-<first 8 of head>, with the same two files in every arm.
- **Units.** 20 units with ids ceo-o/plan#<n>@<first 12 of head>, numbered in the seeded draw order, so units 1 and 2 are S01 and S02, the first two calibration units in draw order that section 10's smoke runs on. Each unit is its own cluster. The suite has no groups, so the stub's counts publish nothing beyond the unit count.
- **Suite file:** suites/ceo-o-cal.json under the sealed root, sha256 a3677868258d3afbe03eb69fab6afa9878a689044882e4d4e2ec427766775b38. This is the suite binding's `sha256` the part 1 pin post freezes before the first smoke run (its section 6).
- **Stub:** suite-stub.json, sha256 f0ca2aa36c6d27b29295f729523b74b01d08a13deba1fd771294d9d1a0019fcc. Its catalogs_sha256 is 49fe256e8d3a8f2d0cfdd4d163bee369a9a1af75ed38e9c4029b051a843ff564, which loadSuite checks against the sealed units dir and each run records in units.json as its binding.

**Why the binding is not 3b6596f0.** The custody addendum says its units digest is what a suite binds when the units dir holds the 20 units under their sealed ids. That can't hold as written. B2's digest names each unit folder by its sealed record id, and a suite unit's id must be <repo>#<pr>@<first 12 of head> (suite.ts:261), so the suite's units dir names folders by those ids. The folder names enter the digest (ceoUnitsDigest, suite.ts:366), so the binding moves from 3b6596f0 to 49fe256e. The bytes do not move: row 2 above shows every slot's plan.md and key.json sha256 equal to the addendum's table, and mkunits.ts copied them unchanged. So the part 1 pin post's rule 2 check reads two ways. rows, packets and readings refuse a units dir that doesn't hash to 49fe256e (ceo-cli.ts:122-128), and the run thread also checks each slot's plan.md and key.json against the addendum's table.

**context/project.md digests.** The addendum lists plan.md and key.json per slot. context/project.md sits in the unit repository, so each head commit covers it. Each slot's kind, changed or held, is the forecast's truth (preregistration section 9, Scoring), so it stays in the sealed custody addendum, and this post gives only the counts (section 9 below). For the record:

| Slot | context/project.md sha256 |
|---|---|
| S01 | 64dc7dc72915a0948481e3b34ff30e836bc2aabfd9bea18bb4ee0946a3a49762 |
| S02 | 3b9778edacac3290251bec7d3cb33114c99bbdb553efc06ac0b873203ac39964 |
| S03 | c950e6e743c03580c0e7035212155bd28d0e17757e22f1e57907b7f9eec70abe |
| S04 | e547ccd38146754510bb3c2bd627074ca1e6a138ffde5a8749e2fa3258143951 |
| S05 | 38e3cf1eeff766987862733db49be530a48e13ab3f0c9a456a77dda7558b95c6 |
| S06 | fd06a3b0592f83aeb27c704514f1e29d12eaa43390d745c10516e832d3c84b1a |
| S07 | 5ff10326cd93521e73ee106b7adf5faa92feafc9c240e442e4d0eafee7b10bb7 |
| S08 | 97ecdd5cfc57a6c2125cdc70bf20073a6587fdbf4ef9ba523ff1f3a02e9fc99a |
| S09 | b16c8efd79249807acfe2462fe0d742fdbcb3cc0b9eb0350e84e6b3063a6a9e4 |
| S10 | 8d34d4638280a25ba704e39b2b9c866c36af3a09ad0afb8eb54c95322941f4ed |
| S11 | 62c333b1a5b79fb1b71152f25b3cfac358882d4d6694d43756d4f9059db76de4 |
| S12 | cc49958cf8c7fbea9360714b393ede1d590c06894c5983d04fa9d2bdaa040ed8 |
| S13 | 9035c6022928fc4bf27af7cc708e3e609a8dab69014ab76066febdfe9c5449a1 |
| S14 | 37898884f1e023d693fce183f6bd4aa30adae9cd91e6cbe834bc4d5b1b3c03aa |
| S15 | 938991787ae913463181c4b9f9c5f391ab46998dba4aeb6730d8e2fe3e903a5a |
| S16 | 63edbd096e6edce6bb17c94792da94007629eb40918b35107470063276d26752 |
| S17 | aa71be6af10dc6279b177204cddd219d7035eff802ef7891eeac4b1b7dddc969 |
| S18 | 936ab44b4d0fc4877361abc4f2b14bb15001c4f9c3f2d5f28e896b5c625c06ad |
| S19 | 6c757382dd7e84f399b28d8838241eb86ffd8c3a124eead4c5d2b6f366aacb22 |
| S20 | b12e9695417de796c359ca2ee59579ee29cb06a6e65c1b680d7bbb943da42b44 |

**The sealed dry run.** On the sealed suite, at 715c659 and inside /dev/shm, `review-units --dry-run` planned all nine run commands with exit 0: 2 units and 2 sessions for each smoke item, and 20 units with 60, 40 and 40 sessions for the none items. That dry run is where section 4's Sol allowance problem showed: it planned ceo-o-hr-smoke-sol-p's two sessions at $13.76 against an $8 cap. It ran the commands as first drafted, before review added --system-prompt. That flag sets only the arm's system prompt: the public dry run (section 10) plans each item with and without it and gets the same sessions and worst case.

## 3. Each stage 1 item's command

Every command runs from a checkout of 715c659 with a clean tree, on the runner host, with these names:

- SR: the sealed root, restored from ceo-o-suite.tar.gz.age into /dev/shm on the host (suite/sealed); SRC: the unit repository beside it (suite/source).
- STUB: this post's suite-stub.json. LED and REC: the host's ledger file and approval record, one of each for every item. RUNS: a directory on the host's disk, outside the repo. review-units refuses an out dir under /dev/shm or /tmp (E_RECEIPTS_VOLATILE), so the run bundles sit on disk until they are sealed and the host is destroyed.
- GS: garrytan/gstack@699a41cb6808e01240d02e82247693f9170d401a.

The flags every run item shares, from sections 3 and 5:

```
C="--suite $STUB --sealed-root $SR --plan ceo-outcome --parallel 3 --timeout 3600 --max-turns 150 \
   --source ceo-o/plan=$SRC --base-branch ceo-o/plan=main --ledger $LED --record $REC"
```

The driver sets CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 and disallows WebSearch and WebFetch in every arm (src/adapters/claude-code/driver.ts:130 and :186). The rec user and the never-ask question registry come with the plan lens. --plan ceo-outcome turns on cap stops and the one follow-up turn.

The preregistration's section 1 runs every arm "in Claude Code with the claude-code-preset system prompt". review-units leaves an arm on the SDK default unless --system-prompt names it (src/trial/review/cli.ts:197), and the driver sets the claude_code preset only then (src/adapters/claude-code/driver.ts:482). So every run command passes --system-prompt <arm>=claude-code-preset for its one arm, and each session's key and arm_provenance record it (src/trial/review/run.ts:408 and :611).

**Smoke items, first** (section 10: two sessions per gstack arm per model on units 1 and 2):

| Item | Cap | Command |
|---|---|---|
| ceo-o-hr-smoke-opus-a | $25.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-auto=$GS --system-prompt gstack-auto=claude-code-preset --models claude-opus-5-5 --passes 1 --allowance 12 --item ceo-o-hr-smoke-opus-a --spend-cap 25 --out $RUNS/smoke-opus-a` |
| ceo-o-hr-smoke-opus-p | $15.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --models claude-opus-5-5 --passes 1 --item ceo-o-hr-smoke-opus-p --spend-cap 15 --out $RUNS/smoke-opus-p` |
| ceo-o-hr-smoke-sol-a | $13.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-auto=$GS --system-prompt gstack-auto=claude-code-preset --models openai/gpt-6.1-sol --passes 1 --allowance 6 --item ceo-o-hr-smoke-sol-a --spend-cap 13 --out $RUNS/smoke-sol-a` |
| ceo-o-hr-smoke-sol-p | $8.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --models openai/gpt-6.1-sol --passes 1 --allowance 3.52 --item ceo-o-hr-smoke-sol-p --spend-cap 8 --out $RUNS/smoke-sol-p` |
| ceo-o-hr-smoke-particle-a | $1.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-auto=$GS --system-prompt gstack-auto=claude-code-preset --models particle-ai/particle-1 --passes 1 --allowance 0.33 --item ceo-o-hr-smoke-particle-a --spend-cap 1 --out $RUNS/smoke-particle-a` |
| ceo-o-hr-smoke-particle-p | $1.00 | `bin/gstack-evals review-units $C --units 1 2 --arms gstack-forced=$GS --system-prompt gstack-forced=claude-code-preset --models particle-ai/particle-1 --passes 1 --item ceo-o-hr-smoke-particle-p --spend-cap 1 --out $RUNS/smoke-particle-p` |

gstack-forced takes its line, FORCED_LINE and then the ask, from the lens, so it needs no --told-prefix. The dry run prints both gstack lines.

**The smoke gate.** Before any none item opens a lease:

1. `bin/gstack-evals ceo rows --stage 1 --units $SR/units --run $RUNS/smoke-opus-a $RUNS/smoke-opus-p $RUNS/smoke-sol-a $RUNS/smoke-sol-p $RUNS/smoke-particle-a $RUNS/smoke-particle-p --checks` exits 0 (part 1 pin post, section 4).
2. The smoke findings check of the part 1 pin post's section 4 finds no disagreement between `findings_written` and the on-disk ceo-review.md copies under each gstack-auto session's out dir, and no non-empty `logs.copy_out`. Any disagreement stops the run, and the case goes to the Captain (approvals, "Stage 1 item caps").

**None items, after the smoke passes:**

| Item | Cap | Command |
|---|---|---|
| ceo-o-hr-opus-none | $52.00 | `bin/gstack-evals review-units $C --units all --arms none --system-prompt none=claude-code-preset --models claude-opus-5-5 --passes 3 --item ceo-o-hr-opus-none --spend-cap 52 --out $RUNS/opus-none` |
| ceo-o-hr-sol-none | $23.00 | `bin/gstack-evals review-units $C --units all --arms none --system-prompt none=claude-code-preset --models openai/gpt-6.1-sol --passes 2 --allowance 3.52 --item ceo-o-hr-sol-none --spend-cap 23 --out $RUNS/sol-none` |
| ceo-o-hr-particle-none | $6.00 | `bin/gstack-evals review-units $C --units all --arms none --system-prompt none=claude-code-preset --models particle-ai/particle-1 --passes 2 --item ceo-o-hr-particle-none --spend-cap 6 --out $RUNS/particle-none` |

**Rows, packets and the judges.** The rows read all nine runs. The judge items are recorded only after every run item has settled, because each judge cap is $160 less the settled spend of every earlier stage 1 item.

```
bin/gstack-evals ceo rows --stage 1 --units $SR/units --run $RUNS/smoke-opus-a $RUNS/smoke-opus-p $RUNS/smoke-sol-a \
  $RUNS/smoke-sol-p $RUNS/smoke-particle-a $RUNS/smoke-particle-p $RUNS/opus-none $RUNS/sol-none $RUNS/particle-none --out $J/rows.json
bin/gstack-evals ceo packets --rows $J/rows.json --units $SR/units --seed 20261106 --out $J/packets --key $J/key.json
bin/gstack-evals noloss judge-run --ceo --packets $J/packets --key $J/key.json \
  --brief wiki/plans/2026-11-05-geva-295-ceo-ladder-amendment/judge-brief.md --judge openai/gpt-6.1-sol \
  --item ceo-o-hr-judge-sol --ledger $LED --record $REC --out $J/sol
  (then --judge anthropic/claude-opus-5-5 --item ceo-o-hr-judge-opus --out $J/opus,
   then --judge anthropic/claude-sonnet-5-5 --item ceo-o-hr-judge-sonnet --out $J/sonnet)
bin/gstack-evals ceo readings --rows $J/rows.json --key $J/key.json --sol $J/sol --opus $J/opus --sonnet $J/sonnet \
  --units $SR/units --out $J/readings.json
cp wiki/plans/2026-11-05-geva-300-ceo-stop-label-amendment/ceo-rule.ts.txt $J/ceo-rule.ts
echo "2222e0cfa65f9f105d6645a70fc6a4bed67d9f0f75033d6e935cdebb7fcaf179  $J/ceo-rule.ts" | sha256sum -c && \
GSTACK_EVALS_SCORER=$PWD bun $J/ceo-rule.ts headroom $J/readings.json
```

J is a directory on the host's disk beside RUNS. The packet seed, 20261106, is pinned here; no earlier post fixed one. The judges run one at a time, so each judge item's cap reads the settled spend before it. ceo-rule.ts is the stop-label amendment's ceo-rule.ts.txt (sha256 2222e0cf...), copied into $J and checked by sha256 before it runs, so the checkout stays clean. It imports only Node built-ins and reads the paired statistics from the scorer checkout that GSTACK_EVALS_SCORER names, here the 715c659 checkout the commands run from. Without that variable it exits E_USAGE.

## 4. Session allowances: Sol's flag

Section 3 freezes the session allowance in dollars, as --allowance takes it: 1.6M input and 32k output tokens at the model's price, "$7.04 on Opus, $3.52 on Sol and $0.19 on particle-1". Section 13 sizes every stage 1 cap on those figures.

The harness default matches Opus ($7.04) and particle-1 ($0.192). It does not match Sol. allowanceMicros prices the whole 1.6M-token allowance at the long-prompt rates whenever that allowance passes a model's 272k-token threshold (src/skill-eval/cli/dry-run.ts:76). So Sol's default is $6.88 a session ($4 and $15 a million), not the preregistration's $3.52 ($2 and $10). Left at the default:

- ceo-o-hr-smoke-sol-p's one round of two sessions would plan at $13.76 against its $8 cap. review-units starts a round only when the whole round fits at the allowance, so the item would stop before its first session, and Sol's standalone arm would read UNTESTED with no session run.
- ceo-o-hr-sol-none's rounds of three would plan at $20.64 against $23, so rounds would stop once about $2.36 had settled. At section 13's $0.15 a session, that is about 18 of its 40 sessions.

So Sol's none and standalone commands pass --allowance 3.52, the preregistration's own figure. Sol's autoplan item already passes --allowance 6, which section 3 computes the same way, at base rates. The dry run shows each item's round fits its cap at these allowances, and that without the flag ceo-o-hr-smoke-sol-p's round does not (section D). Section 6's end-state table already covers a session that reaches its allowance. No number in the preregistration changes.

## 5. The ledger

**Recording each item.** Each item gets its own `ledger init` with --admission warn, as the earlier CEO and planning runs used, --by GSTA-2 and the Captain's words from approvals/2026-11-05-ceo-eval-line.md, section "Stage 1 item caps". The nine run items are recorded before the smoke, and each judge item just before its read. The init mirrors through gstack-approvals, so the host needs a gstack checkout's bin/gstack-approvals (GSTACK_EVALS_APPROVALS_BIN).

**Leases.** review-units leases its item for --spend-cap with trial proof (src/skill-eval/cli/run-host.ts:533). judge-run --ceo leases its item for what the item has left, with direct proof (lanes/review-noloss/judge-run.ts:579). With --admission warn, a lease with no rig admission record prints RIG_UNPROVEN and goes ahead. Each item binds one run (E_ITEM_BOUND). A cap stop is an incomplete run and is never retried (section 14, Stops; part 1 pin post, section 5 rules 3 and 4).

**The dry run** (section L of dryrun.txt) recorded all twelve items on a temporary record and local ledger at 715c659, with the approvals mirror stubbed. For each item, it leased with `ledger lease` (a run item at --amount its cap), charged section 13's projection through the local ledger's reserve and settle (the path the metering proxy uses), and closed the lease with `ledger settle`. Every item showed one lease, none open, its committed spend equal to the charge and the item bound to its run, and a second run on it refused with E_ITEM_BOUND. The run items settled $36.20 of their $144.00 in caps. The judge items were then recorded at $123.80, $121.80 and $119.80 ($160 less every earlier item's settled spend, rounded down to the cent), and stage 1 settled $42.20 of its $160.00.

## 6. The section 16 data-use check

Checked 2026-11-06. B2's check (handoffs/GEVA-327/data-use.md, 2026-11-05) covers the Anthropic, OpenAI and Gemini APIs and Capy, with quotes from each provider's own page. Stage 1 adds OpenRouter and its two upstream providers, and a Ubicloud runner host.

| Route | Who uses it in stage 1 | Data use |
|---|---|---|
| Anthropic API, the organization's key | Opus arms; Opus and Sonnet judges | No training; deleted within 30 days (B2's check) |
| OpenAI API, the organization's key | the Sol judge | No training by default; abuse logs up to 30 days (B2's check) |
| OpenRouter to OpenAI | Sol arms | OpenRouter's data policy feed: training false, retainsPrompts true, canPublish false |
| OpenRouter to Particle AI | particle-1 arms | OpenRouter's data policy feed: training false, retainsPrompts false, canPublish false |
| Ubicloud VM | the runner host | Plaintext only in /dev/shm; run bundles on the VM's disk until sealed; the VM is destroyed after |
| Capy | the run thread | Counts and digests only; no unit text reaches the thread |

**OpenRouter itself.** OpenRouter's data collection page says it "retains prompts only when you opt in, or when retention is needed for CSAM review, reporting, and related legal preservation". Its provider selection page defines `data_collection: "deny"` as "use only providers which do not collect user data". Its provider logging page says it "does not have routing rules that change based on data retention policies of providers", so deny filters on training and collection, not on retention.

**The route the proxy sends.** At the pin, every OpenRouter call carries the row's provider object (prices.ts:75, dry run section P): for Sol, `{"only":["openai"],"allow_fallbacks":false,"data_collection":"deny","max_price":{"prompt":4,"completion":15,"request":0,"image":0}}`, sha256 a1d757518f019a46e77ccacdbdfc1c3f53d8aaf91fd15811a07c6f07505fac4b. For particle-1, the same with only particle-ai and max_price 0.1 and 1, sha256 3f811be60bac42e0c29ab989f0c9522bb28d1f45e1da4d652f89b246afd991a0.

**Serving endpoints under it** (OpenRouter's public endpoints API, keyless, dry run section O):

- **Sol:** 2 of its 9 endpoints are inside only and max_price, openai and openai/flex. OpenRouter may route a call to flex, which bills $1 and $5, half the row. The ledger still meters at the row, so a flex call costs less than it records. openai/fast and openai/ultrafast sit above max_price, and Bedrock and Azure fall outside only.
- **particle-1:** 1 of 1 endpoint, particle-ai/us.
- **Earlier runs on these routes:** GEVA-196's Sol route smoke (#153) ran 7 calls through this route with 0 refused, and planning R1a ran particle-1 through its route.

**Providers' own terms.** Particle AI's privacy policy says standard synchronous inference runs under zero data retention by default, and Particle "does not use prompt or output content to train, fine-tune, or improve AI models unless the customer separately and affirmatively opts in". OpenAI's API terms, quoted in B2's check, say no training by default and abuse logs for up to 30 days. OpenRouter's table lists OpenAI's retention as an unknown period. That describes how long OpenAI keeps prompts, not any training.

**Result.** No route would train on the sealed text or keep it beyond its stated retention, so no route stops under section 16. Three residuals go to the Captain as notes:

1. The OpenRouter account's input and output logging setting can't be read from here. It is off by default.
2. OpenRouter's own table gives OpenAI's retention as an unknown period. OpenAI's API terms say up to 30 days.
3. The runner host is a Ubicloud VM. Plaintext lives only in its RAM-backed /dev/shm. The run bundles, which quote units, sit on its disk until they are sealed, and then the VM is destroyed.

## 7. The autoplan arm's outside voice

Section 5 says the trial container has no Codex binary, so autoplan's outside voice falls back to its Claude adversarial subagent on the arm's own model, and asks the pin post to confirm both. At the pins:

- **Codex is turned off before any probe.** A cell without a voice sets gstack's config to `codex_reviews: disabled` and gives the driver no codex option (src/arms/cells.ts:120-121). Every ceo-outcome cell has no voice.
- **The Claude subagent still runs.** gstack's autoplan at 699a41cb says that when codex_reviews is disabled, it skips "the Codex passes only; the Claude adversarial subagent below STILL runs" (autoplan/SKILL.md:528).
- **It runs on the arm's own model.** The driver sets CLAUDE_CODE_SUBAGENT_MODEL to the session's model (driver.ts:183), and the proxy slot admits only the driver model.

So the outside voice reads `disabled`, not `unavailable` as section 5 expected, and the Claude subagent runs as part of the arm on its own model. The cost is counted in the arm's session. The smoke transcripts show the Agent call at run time. A keyless dry run can't show it, because no model runs.

## 8. GEVA-337's tool changes during B2, disclosed

GEVA-337 authored 27 units (22 changed, 5 held) and changed GEVA-327's B2 tools while it did. Unit 1 ran end to end on the tools as handed over. These changes followed it, as handoffs/GEVA-337/TOOL-CHANGES.md in the Captain drive records. No check, pass rule or role assignment changed.

1. **One b2.ts fix.** Blind round 2 walked every unit in a shared blind session, so a unit that passed round 1 had no round-2 audit and was overwritten as failed for a missing audit. Round 2 now skips settled units. Unit 1 sat alone in its session, so the bug never changed a verdict. b2.ts moved from 018387bf... to 1b9ed9ceccc131e86ef051156555e82638d61248bbffea4ce2393cb319af4ca4.
2. **A name map backstop, added after unit 1.** After merging a writer's name map additions, b2.ts collect now applies the unit's name map to plan.md or context/project.md itself: one pass, case-insensitive, whole words, longest name first, for every entry of 3 or more characters. The writers were already told to apply the map. Unit 1 had failed blind check 2 (names) in round 1, with one map name left in context/project.md.
3. **A fidelity paragraph in the plan writer's brief, added after unit 1.** roles/pw.md gained one paragraph: every section, ask, claim, number, example, list item, table row, rewritten code sample and stated alternative or open question carries across, and nothing new appears. Unit 1 had failed check 3 (fidelity) in round 1 under both auditors. The brief moved from 356a4b71... to 4ba1a5e772435089923975966edd22a48885df9e63e236c8c34c2d23226e36d6.
4. **A seal helper.** bin/seal.ts (4d1d5e2f4322a3502abb635cbebe3a649af9cb9629953052b94fbb8476d10b02) seals and logs each bundle to CUSTODY.md in one step.
5. **Fix rounds in fresh sessions, from batch 4.** A fix round runs in a fresh session of the same writer role and model, holding only the failing units, their usual inputs, the auditors' note and the current file. Batch 3's fix rounds resumed the writers' sessions. A resumed session re-read its whole context, about 1M tokens a turn.
6. **Re-audits in fresh sessions, from batch 3,** of the same auditor role and model, with the same recheck instruction.
7. **Trimmed audit inputs, from batch 4.** A re-audit whose recheck list lacks check 1 drops the repository docs and the issue titles, since checks 2 and 3 rest on plan.md, context/project.md, the first version, the name map and the facts file. Key auditor sessions drop the repository docs, the titles and the first version, since checks 4 to 6 rest on the record, the key, plan.md and context/project.md.

**What the audit saw.** 7 of 27 units passed blind round 1. 20 needed the one fix round: 7 for names, 6 for fidelity, 5 for both, and 2 for leak and fidelity. 4 failed after it (3 for names, 1 for fidelity), and the key audit dropped 1 (check 4). Every message that started a fix round or a re-audit pointed at a file and held no unit text. Every unit after unit 1 was written under the brief with the fidelity paragraph and checked by the name map backstop. Unit 1 ran end to end, its fix round included, on the tools as handed over. The custody addendum's funnel and counts are unchanged by this post.

## 9. Custody addendum counts, restated

From handoffs/GEVA-327/custody-addendum.md, for the record:

- **Slice:** 16 changed and 4 held units, ranks 3 to 172 in seeded order, from 19 projects, none holding three.
- **Changed units:** outcome rejected 11, re-scoped 5, reverted 0. Decisive-issue category: premise or demand 6, direction or strategy fit 4, scope 2, user impact or migration 2, ambition 1, maintenance or cost burden 1, sequencing or dependency 0. Posted July to August 8, September 3, October on 5, so the strict strata hold 8 (on or after 2026-09-01) and 5 (on or after 2026-10-01). Proposer outside 14, maintainer 2.
- **Held units:** all posted July to August; maintainer 2, outside 2.
- **Passed after the slice filled:** 2 changed units, sealed and marked. They stay out of stage 1.
- **Digests:** slice-final ciphertext 62e46c6a1e1c9248fc9b039d24d8df3950ee71ba940b5ac649344a379d50da51, plaintext tar.gz ffec89ab8ae1810fe7ac03d8b8d5aad0d370661701406d9f0ae974a70480d1ee; B2's units digest 3b6596f096719ac1eb553f31a152211a0a6787669c719581ef4cbf95dfe425d5. The per-slot unit, plan.md and key.json sha256 stay in the addendum's table, which section 2 rechecked.

## 10. The dry run

dryrun.sh.txt ran at 715c6594851c558edcd64f97e6627ef55a7cbbec and printed dryrun.txt: 41 rows, 41 passed, DRYRUN: ok. Run it as `bash dryrun.sh.txt <build commit> <dir holding mkunits.ts.txt> <gstack-evals clone>`. The model and Ubicloud keys are unset, nothing is spent and no VM starts. It reads OpenRouter's public feeds over the network without a key.

1. **Pins (P).** The build commit's tree, the four frozen files, the exposure digest, the template and parser, FORCED_LINE, both OpenRouter routes with data_collection deny, the price table, and each model's default allowance against the preregistration's.
2. **Public smoke unit (U).** An invented plan for an invented note-taking app, its context and its key, built by mkunits.ts and passed by `noloss suite --check`. The unit is written out in the script, so anyone can rerun it.
3. **Dry runs (D).** Every stage 1 run item's command, with its frozen flags, on the public unit. Each exits 0 and prints its arm line with system prompt claude-code-preset, plans the same sessions and worst case as it does without --system-prompt, and fits its first round inside its cap at its allowance. A further row shows that without --allowance 3.52, ceo-o-hr-smoke-sol-p's round would not fit.
4. **Ledger (L).** Section 5's twelve items.
5. **OpenRouter (O).** Section 6's endpoints and data policies.

**Limits.**

- **Not the real run's flags.** The public suite holds one unit, so the dry run passes --units all where the smoke names --units 1 2, and its --suite, --sealed-root, --source and --out point at the public unit.
- **Two legs not driven.** No judge-run --ceo, packets or readings run here, because they need session rows. The preregistration's own dry run drives those rules on synthetic readings. The ledger rows lease with the ledger CLI, not inside review-units and judge-run, which open the same lease kind at the same amount.
- **Network reads.** The OpenRouter rows read live feeds, so a rerun can differ.

## 11. Not in this post

Any rule, number, cap or verdict; the stage 1 run and its results; the comparison set, which the Captain's B2 start rule 6 ruling leaves unauthored until stage 1 reads; the findings_written amendment, deferred to stage 2's amendment; and anything for stage 2.

## Attachments

| File | What it is |
|---|---|
| dryrun.sh.txt | the keyless dry run, run as `bash dryrun.sh.txt 715c659... <dir> <clone>` |
| dryrun.txt | every line it printed at 715c659, with the scratch dir written as $T and home as ~ |
| mkunits.ts.txt | the script that built the sealed suite and the public smoke unit, byte for byte the copy that ran |
| suite-stub.json | the stage 1 suite's stub: id, kind, counts and digests only |

---
id: 2026-11-07-geva-376-ceo-stage-2-pin
kind: plan
title: "CEO outcome eval, stage 2 pin: the comparison suite, every stage 2 command, projection at 84 and 28, the all-in and a keyless dry run"
summary: "Pins stage 2's suite and commands at 2ef58339, records projection (PASS, sha256 01fd5e8d) and the all-in ($1,923.47, $76.53 spare), and runs a 56-row keyless dry run."
author: GEVA-376
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: open
links:
  - 2026-11-04-geva-285-ceo-outcome-prereg
  - 2026-11-05-geva-295-ceo-ladder-amendment
  - 2026-11-06-geva-338-ceo-pin-part-2
  - 2026-11-06-geva-345-ceo-stage-2-amendment
  - 2026-11-06-geva-348-ceo-scorer-stage-2
  - 2026-11-06-geva-362-ceo-smoke-pin
  - garrytan/gstack-evals#214
  - garrytan/gstack-evals#248
attachments:
  - 51182833e58c87adf492a7d4a46d396c5b03758065c307e9569debbda5db8e59  check-cset.ts.txt
  - 06063de74538cae7dd2b789e064a711fda52a4695cf224fe42cfbc773af62b98  dryrun-opus.ts.txt
  - 4b9b3f5472b6616f9b385c17c2901f18cdbdc3f45260505f5e19cf4acac6f472  dryrun.sh.txt
  - 9b3102cca006b0fea9704ca2ee3845c5dfbad60c356dd3cb5e1c44c60697077f  dryrun.txt
  - d8c806fdb8297c22c80f1942edd3eb11d170c8cd7aaa3dda718e69d7fa284a96  mdd-84.py.txt
  - a5c3d94980e7d786f6c38b2bfde4840ba06a971adf1e4da970b00af5b1aa4dd6  mdd-84.txt
  - c325612ad40e1830ebcd97d3b6014daa329b3c45fc1f37eb77404619cf6d7acc  merge.ts.txt
  - 0d63f66178a509f5386639e4eb17d60ba3cf40f6feac7fe8aec77ad8e049d01e  mkunits-cmp.ts.txt
  - 01fd5e8dc4b4b56c3b317afce0f4d9f92727097149fa877394d96669ceff9f57  projection.txt
  - bc60dda15585d61ee620fc96e1623404ba5dfa34abb6fb356d80dab0f145048f  slots.txt
  - 2e5cdb41c78916ef746aa14b60fb80a117266e4182639578b4cb0004786d88d3  suite-stub.json
---

# CEO outcome eval, stage 2 pin

This is the stage 2 pin post that the stage 2 amendment's order calls for (2026-11-06-geva-345-ceo-stage-2-amendment, section 9, step 7). It pins the comparison suite, freezes every stage 2 command, records projection's output and its sha256, runs the all-in check on crew actuals, and reports a keyless dry run. It adds no rule beyond the amendment, the scorer post and the Captain's rulings on this line. It names three operator deviations in section 9.

Nothing here spends. No model was called and no VM started to write it. Like every post on this eval, it holds counts, categories and sha256s only (#214, section 15).

## 1. The pin

- **Build commit:** 2ef58339524591c50a3c4bdfd79b7ea2218ca5b8, tree 5ba405f13f82a6111e74a5851d9d7008b0e68e29, the commit the smoke pin post pinned and the smoke rerun ran on. Stage 2's runs, rows, packets, judges and readings build and run from this commit only. main has moved since (lanes/tbv, src/errors/codes.ts and a README), and none of it touches the CEO path, so stage 2 stays on the smoke rerun's code.
- **Every digest the smoke pin post lists stands:** exposure 006529475723657f1823d7be18997b865c43e4d9d89b93d0aa956ee2f4f1e5a2, parser 8d1826c539a636d03a67d35073175c1dcaa34ee325d8f36226308a9aa7c851d8, template, stock list, judge brief, forced line, the scorer copy ceo-rule.ts.txt (31a56dd1...), stage2-sizing.txt, the price table and both OpenRouter routes. The dry run's section P rechecks each at the build commit.
- **gstack pins:** standalone (gstack-forced) at garrytan/gstack@699a41cb6808e01240d02e82247693f9170d401a; enforced (gstack-enforced) at garrytan/gstack@4743132ca027d487fb02bb5f8ce94f2816ff8e7c with `ceo_review_gate on`, as in the smoke rerun.

## 2. The comparison suite

The custody addendum fixed the set as cset-1: 114 slots, 84 changed and 30 held, with 6 more held units as a sealed reserve outside the suite (units digest 14aafcb02ab07ccb7118a644c0d7e883ed25f4ac5e4fd0b6949551c2507b66b7). This post opened cset-1 in /dev/shm only and checked it with check-cset.ts.txt: all 114 slots match the addendum's table on order, kind, plan.md and key.json, and the units digest matches.

mkunits-cmp.ts.txt built the suite from it. It is part 2's mkunits.ts.txt with a 27-line diff: the suite's title and purpose, the slot label (C and three digits) and an order.json beside the sealed root that holds each unit's id and kind in slot order.

| What | Value |
|---|---|
| Suite id | ceo-o-cmp, 114 units in repo ceo-o/cmp |
| Suite file sha256 | b6eb9a8a48ca5a70b5c07ada1a85d7ff3d29cf2349b7095802196115020bdfd6 |
| catalogs_sha256 (the units dir) | 7c8063faef937c1cd014aa368c98e3b1451c124b49499f9b8302f26a19e74fd1 |
| order.json sha256 | dc900b2e30b1f5efd690f53dc56b3fdcb67a646e164a8a5e30dc86907f039742 |
| Source repo's base commit sha256 | 796fa52ad706c909893e1f964eb0ef38384711909bcaff65caf737443bffc8a6 |
| suite-stub.json (this post), from `noloss suite --stub` | 2e5cdb41c78916ef746aa14b60fb80a117266e4182639578b4cb0004786d88d3 |
| slots.txt (this post), per slot: unit, plan.md, key.json and context/project.md sha256 | bc60dda15585d61ee620fc96e1623404ba5dfa34abb6fb356d80dab0f145048f |

`noloss suite --check` passes the sealed suite. The source repo holds one init commit and 114 plan commits by a neutral author. Its author dates are fixed, but git sets the committer date at build time, so a rebuild gives new unit ids. **So the run thread restores the sealed build, never rebuilds it:** stage2-suite.tar.gz.age in the Captain's handoffs (ciphertext 6e91f9786dfe3504899e7334cf40a35ecddd7795697f249bcb40e75eb8c5a20d, plaintext tar.gz 74b2204a80b61064f00534b535240e4b9d19375b092276ff587a9fea1184b8b7), restored into /dev/shm on the host and checked against the suite, catalogs and order digests above before any launch.

## 3. Projection and the caps

### 3.1 Projection's input (deviation D-merge)

projection reads stage 1's readings with the smoke rerun's rows (smoke_round 2). At 2ef58339, `ceo readings` refuses to rebuild stage 1's judged readings with the rerun's rows, because the judges' replies are bound to a key over the rows built at 715c659, stage 1's build commit (ceo-cli.ts:684 and :704). Re-judging stage 1 would change data that is already judged. So, by the Captain's ruling, a pinned merge script built projection's stage 1 input: merge.ts.txt.

It takes stage 1's judged readings and the smoke rerun's rows, keeps the suite, exposure digest, units, the 140 none rows and the 32 stock rows unchanged, drops stage 1's 12 round 1 smoke rows, adds the rerun's 12 smoke rows mapped as `ceo readings` maps a smoke row at 2ef58339 (ceo-cli.ts:733-760: no packet, so empty labels and false leak flags), and sets smoke_round 2. stage 1's none rows predate the termination and meter fields, so each gets null for both, which the row contract accepts. It then rereads its output, checks every part against the inputs and exits 1 with E_MERGE on any difference.

- **Verify:** on its output (sha256 cf4f5dd837a152eeb11fe1bd9f5fb160ff4308cfc2db45127527096aef5f2fcc): OK, 20 units, 152 rows (140 none, 12 smoke), 32 stock.
- **Tamper test:** on three tampered copies in /dev/shm (one none row's spend moved by $0.01; one smoke row dropped; one smoke row's leak flag set), verify exited 1 with E_MERGE each time, naming the row.
- **Where projection reads none spend:** ceo-rule.ts.txt:555 takes each model's none per-session spend as the median of its none rows' usd. It reads meter only on smoke rows (lines 569-578), so the null meter on none rows decides nothing.
- **Cross-check from records outside custody:** the merged none spend sums to $5.690856 on Opus (60 sessions), $3.045125 on Sol (40) and $0.319689 on particle-1 (40). Each equals stage 1's settled ledger spend on its none item to the micro-dollar, and the Sol and particle-1 means, $0.0761 and $0.0080, match stage 1's run report.

projection.json (this input plus the envelope, judges, allowances, order and untested list) and the merged readings are sealed as projection-input.tar.gz.age (ciphertext 28d51c4e8bfaf47a0ce958794c0ba274a17da1a49c8ee86c3a839c95c52867ad; projection.json sha256 d6318539bbde105a31442c6eaf3e6a981a3e49580752536e03b9591ee536298e).

### 3.2 The output

projection ran at 2ef58339 with envelope $809.53 (section 4), stage 1's settled judge spend $2.787874, allowances Opus $7.04, Sol $10.00 and particle-1 $0.50, the 114-slot seeded order and no untested cell. Its output is projection.txt, **sha256 01fd5e8dc4b4b56c3b317afce0f4d9f92727097149fa877394d96669ceff9f57**:

```
Projection: PASS at 'as planned'; record these caps; cells: none:opus, standalone:opus, lens:opus, enforced:opus, none:sol, standalone:sol, enforced:sol, none:particle, standalone:particle, enforced:particle; held passes 1; 1 pass on sol, particle; units: changed 84 of 84, last ceo-o/cmp#114@620cf5959749; held 28 of 30, last ceo-o/cmp#81@6dac6616ce04
```

| Item | Cells | Unit-passes | Cap |
|---|---|---|---|
| ceo-o-cmp-opus-p | none, standalone, lens on Opus | 84 x 2 + 28 | $179 |
| ceo-o-cmp-opus-e | enforced on Opus | 84 x 2 + 28 | $187 |
| ceo-o-cmp-sol-p | none, standalone on Sol | 84 + 28 | $126 |
| ceo-o-cmp-sol-e | enforced on Sol | 84 + 28 | $136 |
| ceo-o-cmp-particle-p | none, standalone on particle-1 | 84 + 28 | $12 |
| ceo-o-cmp-particle-e | enforced on particle-1 | 84 + 28 | $23 |
| Judges, one shared line | three judge items | | $70 (projected $27.75) |
| **Total** | | | **$733, inside the $809.53 envelope** |

Each cap is ceil(1.25 x projected + one full round at allowance), and every item's rounds admit at 1.25 times its projected spend.

**Held 28 of 30 (deviation D-held).** The frozen scorer runs ceil(84 / 3) = 28 held units. Stage 2 runs 84 changed and the first 28 held in seeded order; the last 2 held and the 6 reserve go unrun. Caps and the MDD are sized on 84 and 28.

**Allowances, rechecked under the amendment's section 5 on the rerun's figures.** Every trip check holds at 200,000 prompt tokens: Opus trips at 389k (opus-p) and 355k (opus-e), Sol at 279k and 275k, particle-1 at 767k and 391k, at the rerun's measured bytes per token (2.83, 5.81, 4.35) and 5-minute cache writes. Every smoke session showed one call in flight, so the in-flight hold doesn't fire. No allowance moves.

## 4. The all-in check on crew actuals

Read at 2026-11-07T01:42:52.868Z. Crew spent is the 26 CEO crew threads before authoring (636,461 credits) plus this thread at the reading (9,163 credits), at about $1 per 1,000 credits. Crew rest prices this thread's 36.42M tokens left to its 80M stop, the stage 2 run thread (80M) and the results post (100M) at $0.40 per million. Authoring and mining is the five authoring threads' whole counters (392,652 credits); it made no paid call. The smoke line is the rerun's settled spend; allin's frozen label calls it "smoke rerun caps".

| Line | Dollars |
|---|---|
| crew spent | 645.62 |
| crew rest | 86.57 |
| crew reserve | 30.00 |
| stage 1 settled | 17.60 |
| smoke rerun, settled | 5.10 |
| authoring and mining | 392.65 |
| runner hosts | 12.93 |
| stage 2 run caps | 663.00 |
| stage 2 judges, one shared cap | 70.00 |
| **All-in** | **1,923.47** |

allin prints `All-in: PASS ($76.53 to spare)` (dry run section A). The stage 2 envelope, $2,000 less every line but the run caps and judges, is $809.53. Nothing is cut.

## 5. The MDD

From the amendment's power model (stage2-sizing.py's logit and rank models, paired sign-flip test, 80% power) at 84 changed units and ICC 0.843, by mdd-84.py.txt (output mdd-84.txt):

| Model | Passes on changed units | MDD at alpha 0.05 | MDD at alpha 0.025 |
|---|---|---|---|
| Opus 5.5 | 2 | 0.08 | 0.09 |
| GPT-6.1 Sol | 1 | 0.11 | 0.12 |
| particle-1 | 1 | 0.11 | 0.12 |

Both effect models agree. compare's frozen grid (ceo-rule.ts.txt:63-65: the logit model at alpha 0.025), which compare reads for each contrast, reads 0.09 for Opus (its 80-unit row at 2 passes) and 0.13 for Sol and particle-1 (1 pass). mdd-84 is this post's reading at exactly 84 units. The prior stands as #214 stated it: a true gain of 0 to 10 points on Opus, so "not distinguished" stays the likeliest reading.

## 6. Every stage 2 command

Every command runs from a clean checkout of 2ef58339 on the runner host. Names: SR is the restored suite's sealed root and SRC its source repo (section 2), ORD its order.json; STUB is this post's suite-stub.json; PROJ is this post's projection.txt, checked by sha256 before any launch; LED and REC are the host's ledger file and approval record; RUNS and SINK are directories on the host's disk, outside the repo; GS and GE are the two gstack pins; LEFT is what an Opus item's ledger has left after launch 1 settles (step 3 under the table).

```
C="--suite $STUB --sealed-root $SR --plan ceo-outcome --parallel 3 --timeout 3600 --max-turns 150 \
   --source ceo-o/cmp=$SRC --base-branch ceo-o/cmp=main --ledger $LED --record $REC"
P="--arms none lens gstack-forced=$GS --system-prompt none=claude-code-preset lens=claude-code-preset \
   gstack-forced=claude-code-preset --arm-session-kind gstack-forced=unattended"
S="--arms none gstack-forced=$GS --system-prompt none=claude-code-preset gstack-forced=claude-code-preset \
   --arm-session-kind gstack-forced=unattended"
E="--arms gstack-enforced=$GE --system-prompt gstack-enforced=claude-code-preset --arm-session-kind gstack-enforced=unattended"
CH=$(python3 -c 'import json,sys; print(" ".join([u["id"] for u in json.load(open(sys.argv[1])) if u["kind"]=="changed"][:84]))' $ORD)
HE=$(python3 -c 'import json,sys; print(" ".join([u["id"] for u in json.load(open(sys.argv[1])) if u["kind"]=="held"][:28]))' $ORD)
```

Before launch, the run thread checks that CH holds 84 ids ending ceo-o/cmp#114@620cf5959749 and HE holds 28 ending ceo-o/cmp#81@6dac6616ce04, the PASS line's last units. The lists stay on the host: they name which slots are held.

| Launch | Command (each prefixed with GSTACK_EVALS_EPHEMERAL=1 GSTACK_EVALS_RECEIPTS=$SINK/<launch>) |
|---|---|
| opus-p, launch 1 | `bin/gstack-evals review-units $C $P --models claude-opus-5-5 --units $CH --passes 2 --item ceo-o-cmp-opus-p --spend-cap 179 --out $RUNS/cmp-opus-p-1` |
| opus-e, launch 1 | `bin/gstack-evals review-units $C $E --models claude-opus-5-5 --units $CH --passes 2 --item ceo-o-cmp-opus-e --spend-cap 187 --out $RUNS/cmp-opus-e-1` |
| opus-p, launch 2 | `mkdir $RUNS/cmp-opus-p-2 && cp $RUNS/cmp-opus-p-1/run.json $RUNS/cmp-opus-p-2/ && bin/gstack-evals review-units $C $P --models claude-opus-5-5 --units $HE --passes 1 --item ceo-o-cmp-opus-p --spend-cap $LEFT --out $RUNS/cmp-opus-p-2 --resume` |
| opus-e, launch 2 | `mkdir $RUNS/cmp-opus-e-2 && cp $RUNS/cmp-opus-e-1/run.json $RUNS/cmp-opus-e-2/ && bin/gstack-evals review-units $C $E --models claude-opus-5-5 --units $HE --passes 1 --item ceo-o-cmp-opus-e --spend-cap $LEFT --out $RUNS/cmp-opus-e-2 --resume` |
| sol-p | `bin/gstack-evals review-units $C $S --models openai/gpt-6.1-sol --allowance 10 --units $CH $HE --passes 1 --item ceo-o-cmp-sol-p --spend-cap 126 --out $RUNS/cmp-sol-p` |
| sol-e | `bin/gstack-evals review-units $C $E --models openai/gpt-6.1-sol --allowance 10 --units $CH $HE --passes 1 --item ceo-o-cmp-sol-e --spend-cap 136 --out $RUNS/cmp-sol-e` |
| particle-p | `bin/gstack-evals review-units $C $S --models particle-ai/particle-1 --allowance 0.5 --units $CH $HE --passes 1 --item ceo-o-cmp-particle-p --spend-cap 12 --out $RUNS/cmp-particle-p` |
| particle-e | `bin/gstack-evals review-units $C $E --models particle-ai/particle-1 --allowance 0.5 --units $CH $HE --passes 1 --item ceo-o-cmp-particle-e --spend-cap 23 --out $RUNS/cmp-particle-e` |

**Opus's two launches (deviation D-launch).** review-units takes one --passes per invocation (run.ts:455), and Opus runs 2 passes on changed units and 1 on held. So each Opus item runs two launches on its one ledger item and one run id. By the Captain's ruling:

1. Changed runs first. Launch 2 runs only when launch 1 exits 0, its stops.json lists no cap stop and `ledger status` shows no cap-stop close. If launch 1 ends on a cap stop, the item is done incomplete, launch 2 doesn't run, and that model's held cells are reported untested. Never retry. The ledger refuses a lease on a cap-stopped item anyway (CAP_STOP).
2. Launch 2 runs in its own new out dir, seeded with a copy of launch 1's run.json, so it takes launch 1's run id (cli.ts:422) and the ledger item stays bound to one run. It repeats launch 1's flags exactly: a resume with another --max-turns, --session-kind, --allowance or --arm-session-kind is refused with E_CACHE_STALE (cli.ts:337-350). Opus takes the default allowance in both launches, which is $7.04 a session on Opus 5.5 (src/trial/review/README.md:109); adding --allowance 7.04 to launch 2 is refused.
3. LEFT is what `bin/gstack-evals ledger status --item <item>` reports left, read after launch 1 settles, written to the run's trail. A lease above it is refused with CAP_STOP.
4. After each Opus item's launches, `ceo rows --stage 2 --units $SR/units --order $ORD --projection $PROJ --run <launch 1 dir> [--run <launch 2 dir>] --checks` runs, and its output goes into the sealed run bundle.

**Rules carried from the smoke pin post.** A fresh sink per launch, launch 2 and any repair included (its section 4.1: `test ! -e $SINK/<launch>` recorded in the trail). Every Sol call's generation id is looked up, and a call served by any provider but OpenAI stops the Sol items (its section 4.8). The 10% harness-limited threshold for allowance stops (its section 4.4). The judges share one cap (its section 4.5).

**Rows, packets, judges, readings and compare.** J is a directory on the host's disk beside RUNS. The packet seed for stage 2 is 20261107, pinned here.

```
R="--run $RUNS/cmp-opus-p-1 --run $RUNS/cmp-opus-p-2 --run $RUNS/cmp-opus-e-1 --run $RUNS/cmp-opus-e-2 --run $RUNS/cmp-sol-p \
   --run $RUNS/cmp-sol-e --run $RUNS/cmp-particle-p --run $RUNS/cmp-particle-e"
bin/gstack-evals ceo rows --stage 2 --units $SR/units --order $ORD --projection $PROJ $R --checks
bin/gstack-evals ceo rows --stage 2 --units $SR/units --order $ORD --projection $PROJ $R --out $J/rows.json
bin/gstack-evals ceo packets --rows $J/rows.json --units $SR/units --seed 20261107 --out $J/packets --key $J/key.json
bin/gstack-evals noloss judge-run --ceo --packets $J/packets --key $J/key.json \
  --brief wiki/plans/2026-11-05-geva-295-ceo-ladder-amendment/judge-brief.md --judge openai/gpt-6.1-sol \
  --item ceo-o-cmp-judge-sol --ledger $LED --record $REC --out $J/sol
  (then --judge anthropic/claude-opus-5-5 --item ceo-o-cmp-judge-opus --out $J/opus,
   then --judge anthropic/claude-sonnet-5-5 --item ceo-o-cmp-judge-sonnet --out $J/sonnet)
bin/gstack-evals ceo readings --rows $J/rows.json --key $J/key.json --sol $J/sol --opus $J/opus --sonnet $J/sonnet \
  --units $SR/units --projection $PROJ --out $J/readings.json
cp wiki/plans/2026-11-06-geva-348-ceo-scorer-stage-2/ceo-rule.ts.txt $J/ceo-rule.ts
echo "31a56dd12b531f1cd1f26519921cc2731e7d7ea2b6e215e117d220c7b0c9573a  $J/ceo-rule.ts" | sha256sum -c && \
GSTACK_EVALS_SCORER=$PWD bun $J/ceo-rule.ts compare $J/readings.json $PROJ 01fd5e8dc4b4b56c3b317afce0f4d9f92727097149fa877394d96669ceff9f57
```

The judge items are recorded one at a time after every run item settles: judge-sol at $70.00, judge-opus at $70.00 less what judge-sol settled, judge-sonnet at $70.00 less both. projection.txt also caps each judge item at the envelope less stage 2's settled spend. With the run caps at $663 inside the $809.53 envelope, that bound never falls below what is left of the $70.00 line, so the shared line is the one that binds.

## 7. The dry run

dryrun.sh.txt ran at 2ef58339 and printed dryrun.txt: 56 rows, 56 passed, `DRYRUN: ok`. Run it as `bash dryrun.sh.txt <build commit> <gstack-evals clone> <this post's dir>`. It unsets the model and Ubicloud keys, so nothing is spent and no VM starts. Where dryrun.txt says "section 2" for the launch commands and unit lists, it means this post's section 6.

1. **Pins (P).** The build tree, the frozen files, this post's suite stub, mkunits-cmp.ts.txt, projection.txt and dryrun-opus.ts.txt, the exposure digest and parser, FORCED_LINE, the enforced pin and gate settings, the context env, both routes and the price table; and projection.txt's PASS line, caps, envelope and six holding trip checks.
2. **Public units (U).** Five invented units built by mkunits-cmp.ts.txt, 3 changed and 2 held, passed by `noloss suite --check`, and section 6's unit-list commands run on their order.
3. **The Opus two-launch sequence (R).** ceo-o-cmp-opus-p's launch 1 (3 changed units, 2 passes, 18 sessions) and launch 2 (the 1 held unit the cut keeps, 1 pass, 3 sessions) through runReviewUnits with the real Claude Code driver and the real pinned Agent SDK against the stub CLI (dryrun-opus.ts.txt). Launch 2 starts in a new dir seeded with launch 1's run.json and takes its run id; its journal holds only its own sessions. `ceo rows --stage 2 --checks` over both dirs plans and finds 21 sessions, 7 a cell (2 passes on changed units, 1 on held), every one journaled, with a readable transcript at its task path and end state scored: no gap. The only failing checks are standalone's exposure checks, because the stub makes no Skill call. A dir passed twice, or a held session found in two dirs, is refused.
4. **Every launch command (D).** review-units --dry-run of all eight launches on the public units, each with its sink absent before and after, its session count, the arm session kind, the 200,000-token window, and a round at the allowance inside the cap. Launch 2 with launch 1's flags resumes; with another --max-turns it is refused with E_CACHE_STALE, and with an explicit Opus --allowance or no --arm-session-kind it is refused (dryrun.txt prints the code only for the first; cli.ts:337-350 raises E_CACHE_STALE for all three).
5. **Ledger (L).** One temporary-ledger item per run and judge item. Each Opus item takes two leases on its one run: launch 1 at its cap, then launch 2 at what is left; a lease a cent above it is refused with CAP_STOP; committed spend is the sum of both; another run is refused with E_ITEM_BOUND. The six run caps sum to $663. The three judges are recorded at the shared line less what earlier judges settled.
6. **All-in (A).** Section 4's lines through the scorer's allin.
7. **#214's section 16 (O).** No new provider, route or dataset. OpenRouter's public feeds, read keyless: both routes still serve inside their pins, and neither provider's data policy records training or publishing.

**Limits.**

- **The enforced arm's sessions aren't run.** Its sessions need gstack 4743132's installed gate, which #248's armed test drives through the pinned CLI. Its two launches share opus-p's mechanics (run.json seeding, run id, unit cut, ledger), which sections R, D and L cover.
- **No spend in the run loop.** The stub CLI calls no model, so the run loop settles $0 a session; section L drives spend and leases on the ledger.
- **Public units.** The real lists, the sealed suite and projection's input stay sealed. Section D's launch 2 caps are sample figures.
- **Network reads.** Section O reads live feeds, so a rerun can differ.

## 8. Custody

This post's thread opened three sealed bundles, each into /dev/shm only: cset-1 (the comparison set), and, by the Captain's ruling on projection's input, stage 1's judged readings and the smoke rerun's rows. Each opening matched its recorded ciphertext and plaintext digests. It sealed two bundles: stage2-suite (section 2) and projection-input (section 3.1). Each opening, seal and plaintext sweep is logged in the Captain's custody record. The custody addendum's two named deviations stand as it states them: the cross-range two-per-project cap miss, and the earlier custody threads whose machines were never swept.

## 9. Deviations, named

- **D-merge.** projection's stage 1 input was built by merge.ts.txt, not by `ceo readings` (section 3.1). The one /ship reviewer reads the script.
- **D-launch.** Each Opus item runs as two launches on one item and one run id (section 6).
- **D-held.** Stage 2 runs 28 of the 30 held units (section 3.2).

## 10. Not in this post

Recording any cap, running stage 2, the results post and any code change.

## Attachments

| File | What it is |
|---|---|
| check-cset.ts.txt | checks cset-1 against the custody addendum's table and units digest |
| mkunits-cmp.ts.txt | builds the comparison suite, its source repo and order.json |
| suite-stub.json | the stub every stage 2 command passes as --suite |
| slots.txt | per-slot digests of the built suite |
| merge.ts.txt | builds and verifies projection's stage 1 input (section 3.1) |
| projection.txt | projection's output, the file every stage 2 run reads with --projection |
| mdd-84.py.txt, mdd-84.txt | the MDD at 84 changed units and its output |
| dryrun.sh.txt, dryrun-opus.ts.txt | the keyless dry run and its run loop |
| dryrun.txt | every line the dry run printed, with the scratch dir written as $T |

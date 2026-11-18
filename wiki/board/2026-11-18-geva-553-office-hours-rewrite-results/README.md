---
id: 2026-11-18-geva-553-office-hours-rewrite-results
kind: finding
title: "The office-hours rewrite eval stopped INCOMPLETE during authoring: 19 of 110 sealed briefs placed before the cap, so no session ran and gstack's content change gets no verdict"
summary: "Cap stop in authoring: 19 of 110 briefs placed, unpaired yield 7 of 82 (95% CI 4% to 17%), $155.42 of $233.59 lost to restarts. INCOMPLETE, no verdict on gstack#4468. Rerun costs priced."
author: GEVA-553
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-18
status: done
links:
  - wiki/plans/2026-11-17-geva-552-office-hours-rewrite-prereg/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-1/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-2/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-3/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-4/README.md
  - wiki/plans/2026-11-18-geva-553-office-hours-rewrite-pre-run-change-5/README.md
  - wiki/research/2026-11-17-geva-552-office-hours-intentions-inventory/README.md
  - wiki/research/2026-11-18-geva-553-office-hours-rewrite-intentions-inventory/README.md
  - lanes/office-hours-rewrite/
  - garrytan/gstack#4468
attachments:
  - 0de4cefc7abdd2f34051343b50577aa74f5c7a9f2c8dc2f5f5073db04c7314a7  resize.py
  - 3f5d94fdc6e8f7d6966a6e477eb57e1fa12bb3db2a79c8749109fe902dd7ed23  resize.txt
---

# The office-hours rewrite eval stopped INCOMPLETE during authoring: 19 of 110 sealed briefs placed, so gstack's content change gets no verdict

- We learned that a strict three-model screen leaves very few unpaired briefs. Only 7 of 82 unpaired drafts passed (8.5%, 95% interval 4.2% to 16.6%). The rule that drops a brief when any of three models can make its call from the opening alone dropped 47 of the 82 (57%). You should pilot unpaired supply on its own before you size an authoring cap, because a pilot of pairs says nothing about it.
- We learned that restarting a paid authoring run at a different concurrency threw away two thirds of its spend: $155.42 of $233.59 went to drafts the final run never used. You should fix each slot's draw order so it does not depend on concurrency, and bound how many times a twin is redrawn, before a long paid run starts.
- This eval tested nothing. No arm ran a session, so it says nothing about whether the rewritten office-hours skill helps, and gstack's content change (gstack pull request 4468, head 4afa7f2b) gets no MERGE or HOLD verdict from it. The verdict is INCOMPLETE, the preregistration's cap-stop row. There is no "Why null?" cycle, because there is no null. A rerun that answers the 15-point question would cost about $2,010 all-in at central and $2,740 at caps at the yields we measured (section 7).

## 1. What worked

The authoring pipeline does what the preregistration asks: every placed brief passed a vocabulary screen, a unanimous key from three models across two families, a give-away screen for unpaired briefs, a blind two-family audit, a recognition probe and a generic screen, and every check bound the brief's digest. Matched pairs were cheap once a partner matched. First twins passed every screen 10 times in 15 (67%, 95% interval 42% to 85%). Six of the 8 partners whose outcome is known eventually matched (75%, 41% to 93%), and 4 of them did so within 3 draws.

Every paid reply went into a reply cache keyed by its exact request. After the stop, that let us replay every screen decision from the cache for free, with zero cache misses, and count how each validator voted (sections 4 and 5). That check found no screen bug: each rule did what the preregistration's words say.

## 2. What stopped the run

The preregistration needs 110 sealed briefs before stage 1: 70 founder briefs (34 matched pairs across six types, plus unpaired types T7 and T8), 24 builder briefs, 8 calibration briefs and 8 reserves (section 3 of the preregistration). Authoring had a cap of $251.

Authoring stopped at its cap on 2026-11-18 at 16:04 UTC with 19 briefs placed:

| Set | Placed | Needed |
|---|---|---|
| Calibration | 1 (a builder brief) | 8 |
| Comparison | 18: 6 pairs (T2, T3, T4, T5 and two T6), 2 T7 founders, 4 builders | 94 |
| Reserve | 0 | 8 |

That comparison set holds 14 founder briefs in 8 opening clusters. Its pooled MDD would be 0.33 to 0.34 at rho 0.5, and 0.33 or not reached by 0.45 at rho 0.843 (resize.txt, Part D), against the 0.12 to 0.13 the preregistration froze. The preregistration's section 3 asks for the MDD at the count that filled, and this is it.

A free recheck of the screens found no bug. A re-projection then showed that a second authoring item, sized by the cap rule, needed at least $366, against about $350 of room under the eval's final all-in limit of $3,100. So the Captain stopped the eval INCOMPLETE on 2026-11-18, with no further paid calls. A cap stop is never retried to change a verdict.

## 3. Supply, by brief type

All counts are from the final authoring path (section 6 explains the other paths). A draft passes when it clears every screen.

| Role | Drafts | Passed | Pass rate (95% interval) |
|---|---|---|---|
| First twin of a pair | 15 | 10 | 0.667 (0.417 to 0.848) |
| Second twin, per draw | 218 | 6 | 0.028 (0.013 to 0.059) |
| Unpaired T7 founder | 41 | 2 | 0.049 (0.013 to 0.161) |
| Unpaired builder | 41 | 5 | 0.122 (0.053 to 0.255) |
| Unpaired T8 founder | 0 | 0 | never drafted |

All intervals here are Wilson 95% intervals. No T8 slot was drafted before the cap.

**Partners.** Ten first twins passed, so ten partners waited for a second twin with the same opening and the opposite decisive fact:

| Type | Second-twin draws | Matched |
|---|---|---|
| T2 | 1 | on draw 1 |
| T3 | 1 | on draw 1 |
| T5 | 1 | on draw 1 |
| T6 | 2 | on draw 2 |
| T4 | 19 | on draw 19 |
| T6 | 26 | on draw 26 |
| T1 | 46 | never |
| T4 | 120 | never |
| T5 | 2 | still open at the stop |
| T5 | 0 | still open at the stop |

Of the 8 partners whose outcome is known, 6 matched in the end (0.75, 0.409 to 0.929) and 4 within 3 draws (0.500, 0.215 to 0.785). Past the third draw, partners matched 2 times in 211 draws (0.0095, 0.0026 to 0.0339). Two partners took 166 of the 218 draws and never matched. One more pair slot failed earlier: a T6 slot's first twin failed three times, so it never drew a partner.

**By type, the evidence is thin.** T1 and T4 had three partners between them, and none matched within 3 draws. T2, T3 and T5 matched on the first draw. One partner per type is not enough to say whether hardness belongs to a type or to a partner, and that matters for any rerun (section 7).

## 4. The give-away screen

An unpaired brief drops when any of the three validators (Opus 5.5, GPT-6.1 Sol and GPT-6.2 Astra) makes the key's call from the opening alone. That is the preregistration's wording, and the code applies it as written. Pairs pass this screen by construction.

It dropped 47 of 82 unpaired drafts (0.573, 0.465 to 0.675): 34 of 41 T7 founders (0.829, 0.687 to 0.915) and 13 of 41 builders (0.317, 0.196 to 0.470).

| Validators that made the call | T7 | Builders | All |
|---|---|---|---|
| All three | 18 | 5 | 23 |
| Sol and Astra | 14 | 5 | 19 |
| Opus and Sol | 0 | 1 | 1 |
| Sol alone | 1 | 2 | 3 |
| Opus alone | 1 | 0 | 1 |
| **Dropped** | **34** | **13** | **47** |

Sol made the call in 46 of the 47 drops, Astra in 42 and Opus in 25. No validator stands alone: Sol alone caused 3 drops and Opus alone 1. No drop came from a missing reply. The 7 unpaired briefs that passed had no validator make the call.

So the screen is not misreading. T7's opening (a founder who wants to hire to fix momentum) mostly gives its answer away: all three models made the call on 18 of the 34 dropped, and both OpenAI models on 14 more.

## 5. The unanimous key

Each validator gets every fact and must make the key's call and name an acceptable action. A brief drops if any one fails. These are the failures by validator, for the drafts that dropped here (passed / right call but no acceptable action / wrong call):

| Validator | First twins (2 dropped) | Second twins (212 dropped) | Unpaired (28 dropped) |
|---|---|---|---|
| Opus 5.5 | 1 / 1 / 0 | 102 / 37 / 73 | 14 / 7 / 7 |
| GPT-6.1 Sol | 0 / 1 / 1 | 26 / 20 / 166 | 15 / 10 / 3 |
| GPT-6.2 Astra | 0 / 1 / 1 | 27 / 5 / 180 | 19 / 7 / 2 |

The unpaired drops were 5 T7 founders and 23 builders. Given every fact, Sol made the second twin's call (the opposite of its partner's) on only 46 of the 212 failed second twins, and Astra on 32. Opus made it on 139. Our reading, not tested: most second twins did not carry the opposite call strongly enough for the OpenAI models, even when Opus read them as intended.

## 6. Cost, including the restart loss

Authoring's ledger item had a cap of $251. It committed $238.38: $233.59 settled over six leases, and $4.79 counted at full reservation for calls cut short when the run was stopped.

**Restart loss: $155.42 of the $233.59 settled went to drafts the final run never used.** Authoring was stopped and resumed five times on the same run, ledger item and reply cache:

1. At 04:50 and 05:35 UTC, to raise concurrency from 4 to 12 and then 24, because at those rates the run would pass the 6-hour limit on one machine operation.
2. At 05:49 UTC, by a false provider-drift stop: one empty Gemini 4 Argon reply named no provider. Pre-run change 5 fixed that.
3. At 06:55 UTC, the resume stopped at once at the pilot read, at no cost, because we had reset the run's spend to zero by hand. The next resume fixed that input.
4. At 12:30 UTC, before the 6-hour limit again, and the last lease then ran with fewer drafts in flight as the cap neared.

The cause: authoring picks its next slots from a shuffled list by taking the first open ones, so which drafts it makes depends on how many are in flight and which finish first. The cache replays a call only when its request is identical. Each change in concurrency sent the run down a different path through the slots, and the drafts paid for on earlier paths were never reused. The final path made 315 drafts for $78.17.

| Spend | Dollars |
|---|---|
| Final path: 15 first twins | 13.30 |
| Final path: 218 second twins | 20.19 |
| Final path: 82 unpaired drafts | 44.68 |
| Drafts on earlier paths that the final run never used (restart loss) | 155.42 |
| Calls cut short by stops, counted at full reservation | 4.79 |
| **Authoring committed** | **238.38** |

By model, the settled $233.59 went to Opus 5.5 ($94.93), GPT-6.2 Astra ($63.76), Gemini 4 Argon ($48.59), GPT-6.1 Sol ($24.83) and particle-1 ($1.49). By step: unanimous key $96.86, recognition probe $47.57, writing drafts $46.62, give-away screen $20.44, rewrites $10.06, blind audit $9.16 and generic screen $2.87.

List prices per million tokens (input/output), from src/runner/pricing/prices.ts at the build commit, read 2026-11-18: Opus 5.5 $4/$20, GPT-6.1 Sol $2/$10, GPT-6.2 Astra $8/$40, Gemini 4 Argon $2/$10, particle-1 $0.10/$1.

**All-in so far:** about $430. That is authoring's $238.38, about 28 minutes of runner VM for the no-model preflight, and agent model use of about $190 at writing ($54.47 to write the preregistration and about $136 to build, run and write this up). Reviewing this post adds to the last figure.

No other ledger item was leased. The simulator audit, stage 1, the judge check, stage 2 and particle-1 spent nothing.

## 7. What a rerun would cost

These sizings are inputs for whoever decides on a rerun, not a recommendation to rerun. resize.py, attached, prints every figure from the counts above. It runs the preregistration's own power model (power.py) unchanged.

**What every sizing assumes.**

- Pre-run change 6's two fixes, which were planned but never built: a top-up twin gets at most 3 draws a partner, after which the partner drops and its slot draws a new pair; and each slot's draw order is seeded, so no restart or concurrency change wastes a paid draft.
- Authoring yields and cost a draft from the final path (resize.txt, Part A): $0.887 a first twin, $0.093 a second-twin draw and $0.545 an unpaired draft.
- One placed pair costs (first-twin cost over its pass rate, plus the expected second-twin draws times their cost) divided by the share of partners that match within 3 draws. That is $3.05 a pair at the measured rates, and $1.52 to $11.01 at the ends of the intervals. A T7 founder costs $11.17 ($3.38 to $40.42), and a builder $4.47 ($2.13 to $10.24).
- T8 was never drafted, so it is planned at T7's count, 2 of 41.
- The 19 placed briefs are reused.
- Session, simulator, label, audit and judge costs are the preregistration's planning figures, since stage 1 never ran.
- Caps follow the current rule: 1.35 times central, plus what the item's parallel calls hold at open (8 drafts at $3.50, and one round of an Opus skill, skill and none session at $15, $15 and $3 with $2 of simulator each). Stage 1 and the judge check keep their approved caps.
- Agent use is the preregistration's planning figure of $350.
- A line item of $40 of agent use, also a planning figure, fixes five harness bugs that this pull request's review found and deferred to a rerun's build:
  - `ohr read decision` learns of a cap stop only from a flag;
  - unrun sessions drop out of the completeness checks;
  - a missing transcript aborts scoring;
  - a crashed attempt's spend reads as $0 in its session row;
  - the judge check returns the wrong exit code.

  None of them touches this result, because no session ran.
- The authoring range comes from drawing every yield from its Jeffreys interval at once.

| Design | Briefs | Founder clusters | Pooled MDD, rho 0.5 (0.843) | A true 15-point lift: interval above zero / MERGE | Authoring, central (95% range) | All-in central | All-in at caps (range from authoring) |
|---|---|---|---|---|---|---|---|
| The preregistered 5 skins, for reference | 110 | 40 | 0.12 to 0.13 (0.08) | 0.54 MERGE (the plan's own table) | $322 ($200 to $881) | $2,245 | $3,055 ($2,890 to $3,808) |
| **1. Cheapest full answer: 4 skins** | 96 | 32 | 0.14 to 0.15 (0.09) | 0.82 / 0.46 (0.99 / 0.46) | $282 ($175 to $762) | $2,010 | $2,737 ($2,593 to $3,385) |
| 2. Founder pairs only, 12 pairs | 36 | 12 | 0.23 to 0.24 (0.21) | 0.44 / 0.37 (0.58 / 0.40) | $55 ($31 to $155) | $1,005 | $1,380 ($1,348 to $1,515) |
| 2. Founder pairs only, 16 pairs | 44 | 16 | 0.18 to 0.20 (0.15 to 0.16) | 0.61 / 0.48 (0.81 / 0.47) | $67 ($38 to $190) | $1,128 | $1,548 ($1,509 to $1,715) |
| 2. Founder pairs only, 24 pairs | 60 | 24 | 0.14 to 0.15 (0.10) | 0.80 / 0.50 (0.98 / 0.47) | $92 ($52 to $259) | $1,375 | $1,881 ($1,828 to $2,107) |

MDDs cover a control rate of 0.25 to 0.55. The lift shares are at a control rate of 0.40. MERGE means the preregistration's founder bar: a pooled estimate of at least 15 points with its interval above zero. Simulated figures move by about 0.01 from one seed to another.

### Design 1: the cheapest rerun that answers the 15-point question

Design 1 keeps all eight founder types, the 24 builder briefs with their non-inferiority guard, all three arms, both models and particle-1. It differs from the preregistration in three ways:

- **Four skins instead of five.** That gives 56 founder briefs in 32 clusters. It is the smallest whole-skin set whose pooled MDD is at most 0.15: three skins give 0.16 to 0.17 (the preregistration's section 9). This cuts stage 2 by 14 founder briefs, about $192 at central with particle-1.
- **The 19 placed briefs are reused.** They passed the same screens, so they save about $63 of authoring.
- **Change 6's two fixes.** Those stop a restart from wasting paid drafts, the $155.42 this run lost.

Its builder guard is the preregistration's: when builders are unharmed, it passes in 0.68 to 0.88 of runs at rho 0.5.

Three cheaper changes are left out because they narrow the question:

- **Dropping the unpaired types for pairs.** 26 pairs plus the builders reaches the same MDD (0.14 to 0.15) for $1,855 central and $2,526 at caps, about $155 and $211 less. But it drops two of the eight situations, including T8, the returning founder, which tests the dated follow-up the rewrite adds.
- **Dropping particle-1.** That saves $86 central and $130 at caps, but the project's rules require a low-cost model in every gstack eval.
- **Cutting builder briefs.** That removes the harm guard, so option 2 covers it instead.

**The main risk is T1 and T4.** None of their three partners matched within 3 draws. If every partner of those two types is that hard, each of their pairs costs about $57 under the bound of 3, instead of $3. That adds about $395 at central and $534 at caps to design 1. Under that reading the bound costs more than it saves: with no bound, those pairs would cost about $11 each. A rerun's pilot should draw at least two partners of every pair type before the bound is fixed.

### Option 2: a smaller founder-only stage with pairs from real sessions

Option 2 drops the builder briefs and the unpaired types. It keeps matched pairs whose first twin is rewritten from a real founder session as a new scenario, with no text copied. Calibration is 4 pairs and reserves are 2 pairs. Its MDD is stated up front: 0.21 to 0.24 at 12 pairs, 0.15 to 0.20 at 16 and 0.10 to 0.15 at 24.

What it can decide about the rewrite:

- **At 12 pairs**, a true 15-point lift puts the interval above zero in only 44% to 58% of runs. So at that size a 15-point lift is not reliably told apart from zero. Only a lift above about 21 to 24 points, or a loss that large, shows reliably.
- **At 16 pairs**, a 15-point lift shows in 61% to 81% of runs.
- **At 24 pairs**, a 15-point lift shows in 80% to 98% of runs, the same founder power as design 1, for $635 less at central and $856 less at caps. Nearly all of that difference is the builder guard and the two unpaired types.

What it cannot decide:

- With no builder briefs, the preregistration's harm row cannot be read: not builders' kept-whole rate, not their right call, and not guardrail G1, the check for startup questions in builder sessions. So option 2 cannot give the approved MERGE. A merge on its evidence would mean accepting builder harm as untested.
- No brief has yet been rewritten from a real session, so its yields here are the synthetic ones and are unmeasured for this source.

Neither option clearly dominates. Design 1 answers the approved question. Option 2 at 24 pairs answers its founder half at the same power, for about two thirds of the cost, and leaves builders untested.

## 8. Lessons for the next authoring run

- **The pilot sampled only paired slots, so it could not size unpaired yield.** The pilot read 6 of 16 second-twin draws (90% interval 0.21 to 0.58), and authoring went on. Nothing measured unpaired yield before the main run, and it turned out to be 7 of 82.
- **The pilot's per-draw read also overstated the second-twin yield.** It saw each partner's first draws. The hard partners took most of the draws later: 6 passed in 218 draws on the final path.
- **Top-up twins had no bound.** Two partners took 166 draws and never matched, and two more matched only on draws 19 and 26.
- **Draw order depended on concurrency.** Every restart at a new concurrency wasted the drafts of the path before it: $155.42.
- **The give-away rule, with three validators, dropped 57% of unpaired briefs.** "Any of three" is strict by design. A brief whose opening gives its answer away is worthless, so the fix is openings that hold their call back, not a looser rule.
- **Second twins rarely carried the opposite call.** Sol and Astra made it on 46 and 32 of 212 failed second twins. Twin authoring needs a stronger decisive fact before the screens, not after.

## 9. Not tested

Everything the preregistration measures:

- the right call by arm and model;
- procedure exposure;
- founder replies and questions;
- builder kept-whole and the builder right call;
- the three guardrails;
- the compliance checks;
- the judge check;
- admission;
- the simulator audit.

No session ran in any arm, so whether the current skill or the rewrite beats no gstack is also untested. The arms were pinned before any paid call. The current arm is gstack fc5c285035b58ce0552d25cf7cb71749795b6d30, and the current skill's inventory, read at da98d0a, holds there (pre-run change 1). The new arm is gstack 4afa7f2b3e291758f6a7842dd066cde22606fca1, with the rewrite's inventory re-read at that head (pre-run change 2). Neither arm ran.

## 10. Held-out material

The 19 placed briefs, every draft, the keys, the validators' replies and the reply cache stay sealed in an encrypted custody store outside this repository. Plaintext was opened only in memory-backed storage, counts only, and deleted after each opening. This post prints no brief text. The sealed bundles' plaintext sha256 digests:

- authoring output: 971ec21b83e6b6be65c5e54b7f5fd2aec0cca805fea1bbea2c0a908a0e15cfea
- meter and reply cache: 206fd7bbf66eff0f580eff3edf97e8eb4fe10aad8b1e15bcefb7f6b90713360a

## 11. Replication

Authoring ran at gstack-evals commit c008b08d91e03236fe4bcd26fac7bd2b4596e662 (pre-run change 5), on ledger item ohr-author:

```
bun bin/gstack-evals ohr author --work <dir under /dev/shm> --out <sealed path> --recipients <age recipients file> --gstack <clone holding both pins> --item ohr-author --spend-cap 251 --concurrency <n>
```

Its last summary line (counts only):

```
E_OHR_SUPPLY_SHORT authoring placed 19 of 110 briefs (calibration 1, comparison 18, reserve 0) before it stopped at cap; the comparison set holds 14 founder briefs, MDD not defined there; 4 unmatched twins dropped
```

The counts in sections 3 to 6 come from the sealed outcome log and meter journals, read count-only. The sizing reruns with no key and no network, from this folder:

```
uv run --with numpy==2.3.4 --with scipy==1.16.2 python resize.py > resize.txt
```

This record leaves out the sealed briefs and the run wrapper's restarts, which are described in section 6.

## 12. Changelog

- 2026-11-18: first version.

## Disclosures

gstack is Garry Tan's own project. Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1. Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

<details>
<summary>Agent notes</summary>

- Ledger: run ohr-author-20261118T040243Z-6626, item ohr-author, leases 1 to 6, all settled. Spent per lease: $9.43, $11.13, $10.16, $0.00, $170.65 and $32.23, with $4.79 counted at reservation across leases 1, 2, 3 and 5. No other item was leased.
- After the stop, a count-only replay of the give-away and unanimous screens from the sealed reply cache, with zero cache misses, produced the counts in sections 4 and 5.
- Runner VMs: none left. The project's VM list shows none for this thread.
- The Captain stopped the eval after the projection showed that a second authoring item sized by the cap rule needed at least $366, against about $350 of room under the eval's final all-in limit of $3,100.

</details>

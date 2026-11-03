---
id: 2026-11-03-geva-225-outcome-per-skill-plan
kind: plan
title: "Outcome test per gstack skill, wave 1: six planning, design and devex skills against no gstack, on what ships"
summary: "Approved plan for GST-1144 wave 1: six planning, design and devex skills graded on what ships against no gstack, at most $2,000 a skill and $10,000 in all."
author: GEVA-225
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: done
links:
  - 2026-11-01-geva-87-real-outcome-lane-plan
  - 2026-11-02-geva-165-planning-panel-v3-plan
  - lanes/real-outcome/score/analysis.ts
  - src/runner/stats/gates.ts
source: "Plan written by GEVA-225 through gstack /autoplan run autoplan-20261103023817 (rounds 1 and 2, gate_revs 1 to 4), approved at gate_rev 4. Issue GST-1144. The Implementation plan section is the approved text with three corrections the Captain accepted in the #192 review on 2026-11-03: the d7 survivor sentence, the Stand-in and particle-1 rows paragraph and the One survivor per family paragraph. export/plan.md keeps the gate_rev 4 text."
attachments:
  - 069c6c5e3202b7b863d48d210274e2d246d1d2c785d48555db40904f83756cb0  boundcheck.py
  - 1ce669d3bc1408b4ac232552030d01756c74e26713c16375317dedd3782785a8  cost.py
  - 5e139f60e97f35c7569b348a882eca3a3ae74238052bda16801fcf39bea812cd  emit.py
  - a8783199c2ba931048b8ab045edccc9bbb37c9056ca1a0d4201e923bef82cc7d  export/ceo-consensus.json
  - 7960f1951931b96315633081fd140acc490ae9b53abf40144e9e0f10557ac501  export/ceo-consensus.md
  - 7b8ff40b303716900e2d99746c676652ebdbfbde3c158f0bdb8cc09b7d741fa1  export/ceo-native.a1.bound.md
  - 2002fe2f57695f5792b1ea6a081f79c64cbac9936c079a41d335271351124a8d  export/ceo-native.a5.bound.md
  - 76302fc235017b8500e8a7ff3c0306bf232897d51f5b4dd0718f36047bf7bff2  export/decisions.jsonl
  - a13c5331c9723103c6e6c266beda6552a7fe176d8f4f105ed76ddfcb2e14dae8  export/design-consensus.json
  - f361559434ab492f3f0b4d6b7a0c9e5e29f1439853c8f6705350f76504cfeb84  export/design-consensus.md
  - 8620222e1705c522c967933e8c6edd98412723077fb4f2e15eadecc40ae41408  export/design-deferred.findings.jsonl
  - 59452992c178c07108f5f4e25119c1cf13eb775ba779ceee59e7e9c433587a78  export/design-native.a2.bound.md
  - edb62d11430e42a99e149677217f416c7d4ebc6ac81d81cf1250f1bebfa6bb61  export/dx-consensus.json
  - 87330d20b3a07ba1b4ef24eeb6d94fc559e07eacd56d5ef12fae05efd0f55e1e  export/dx-consensus.md
  - 5896ce894bc642d93a92c77f234e1d15492849ab86680185d8b183cccd0977d2  export/dx-deferred.findings.jsonl
  - 64a6e1a84ced700d4e4379c8cdb301ef23b5829b483a8588ed30b64afe5eb09b  export/dx-native.a3.bound.md
  - ef1f751fdce3b946e498f20466e27bd25928e98cfc9690e84744ab6de857cfd0  export/eng-consensus.json
  - a38107b1d6c0f609efdbfa5b7b59fcb5112558d4f742690176134c9ffffc36e9  export/eng-consensus.md
  - 5a355f851fe0a2d7146a449f800614e8d40e1641e87978f02f3e15048e9a6a34  export/eng-native.a4.bound.md
  - a88f4a2a9ea2f1073fa729ab3c6a00685266058f3583548480f4802051ce6328  export/eng-native.a6.bound.md
  - 58e47081d1a8438b03db647159ae3e234d1860cd645fe1f2dba5f43ae7cc9152  export/findings.jsonl
  - b0ca7fbcb9e549f764c0040b1162dd8a2cdf1ea692efa5b8904f4e7d8338c86d  export/gate.json
  - 23e4f822ce28ce74cef83152799bd33600bedaaf2d119ecdb1057826b980f1c8  export/plan.md
  - f838799ed260f4093e47b3686a6e8991ae3dfd9731eae7ca4aa7280afeb3c3ca  export/review-record.md
  - 89dd13bd0aef8210811ca16e3cc74197cca29c475c8ab7e7e0a4196e5aff4ded  export/run.json
  - b0282337363738724403137afc5af835972e27fb5c85a2ebdf01684f2d7ce254  export/tasks.jsonl
  - cba4413319936196fb17b148b9e239c2c5b90004f42dc6cdc03a2cec956a2050  export/timing.json
  - c15ea043bdf715ce227b962eeed9f9bf9edcbe87e0103118d9bd16c384878f15  mdd-grid.json
  - 90053f8865ca17fe95d38c12971f3a80508e14e3a177313e16f768cac74387c9  mddgrid.py
  - 2781d57961c83fe137d7beea2773bfbd3c95deeabb5cdd54c78dbb82a2ebe690  power.py
  - 260f1dd6c50c01fce64d40831b11e1d033516e2db47937e77d0bdabbb78d88ea  probes.md
  - 21c9248bf799ce1ba7b370e07dde423ce88f1537a7c880ee65b5fe2a3ca8ea06  sizing.sh
  - 969c6465edf47b8b2aec8cb3a4c642201defd6b19a6b26c14bbdac5529a0a668  sizing.txt
  - 64b05e7c5652a9f9549004eba218b6c11986e7b485094a4ad2906b40cbfc0624  survivor.py
---

# Outcome test per gstack skill, wave 1: six planning, design and devex skills against no gstack, on what ships

Plan v3, 2026-11-03. Author GEVA-225 for the gstack-evals Captain (GEVA-2), issue GST-1144. Plan v1 (2026-11-02) went through /autoplan's gate 1, after which the project owner capped each skill's evaluation at $2,000 all-in, and v2 re-planned every stage under that ceiling. v2 then went through round 2 and gate_rev 2. v3 writes in gate_rev 2's nine accepted changes. With that answer the project owner capped the program at $10,000 and each skill at $2,000, so this program is wave 1's six skills (see "What changed"). Garry asked for this work on 2026-11-03 (UTC): grade planning, design and devex skills, and then every gstack skill, on the outcome of real work rather than on a proxy. Nothing here builds anything or spends money. Four $0 probes ran before review (section 10), with a keyless power simulation and a keyless price model (sections 7 and 8).

Inputs read: the real-world outcome lane plan (2026-11-01-geva-87-real-outcome-lane-plan, with its power.md and mining-yield probe), the planning panel v3 plan (2026-11-02-geva-165-planning-panel-v3-plan), the R56 part evidence table (org research/gstack-part-evidence.md: 74 rows, 0 helps, 0 no effect, 59 never measured), GEVA-100's why-null note on stacks round 1, the Run D discovery results (#140), the CEO panel v2 admission results (#131), the thin-slice yield posts (GEVA-173, GEVA-194), the metered R3a sessions on SWE-bench Verified (GEVA-230, GEVA-231), R3 amendment 4's real-task price, quick look 3's particle-1 ratio, the E0 results (#181), the panel v3 headroom read (#191), GST-690, GST-817, GST-1048, GST-1088, GST-1089 (#169) and GST-1218, and the crew rules R41, R42, R48, R51, R54, R56, R57, R61, R65 and the no-gstack-arm rule.

## Approval

- **Gate 1** (round 1, one Opus 5.5 reviewer per phase): the project owner capped each skill's evaluation at $2,000 all-in and took no gate option. The run recorded that answer as p1c (interrogate), and v2 re-planned every stage under the ceiling.
- **Gate_rev 2** (round 2, CEO and Eng voices): the project owner approved the plan with every recommendation (d1b, d2a to d9a, d10a, uc1a, d11a, uc2a and p1b; rec_hash 15161ddd7217), relayed by the Captain (GEVA-2) on 2026-11-03. With the same answer the project owner capped the program at $10,000 and each skill at $2,000. v3 records that as Q1: wave 1 only, under a program-wide envelope.
- **Gate_revs 3 and 4** (the deltas written after the round cap, which the crew rules give to the Captain): a carry check on v3's delta found three problems, and the Captain had them fixed in one round: d7's fixed survivor order, an envelope that reserves against open stages, and U's and X's cost cut read from the ratio's interval. The Captain approved gate_rev 4's edits, which record the project owner's picks and those fixes, and the run closed complete. The Captain also accepted F1's consequence: a lone survivor whose d7 re-size passes the 20-point bound stops as FIX-METHOD (price), and no other survivor rule applies.
- **Spend.** This post spends nothing. The project owner's caps are the approved limits. Each paid item still needs its own merged prereg, a ledger approval row, its admission and the envelope's reservation.

## Open at approval

Design's 12 and DX's 16 open findings, and the round-2 Mediums and Lows that no gate item carried, go to the build as tasks (export/tasks.jsonl). Two of them are blocking build tasks whose risk the project owner accepted at gate_rev 2: the vision-first agent user (uc1) and X goals an agent can finish non-interactively, with a per-command timeout (uc2), both in section 13. The project owner's answer on the 1.5 times cost bar is due before G admission (section 16).

## Attachments

- cost.py, survivor.py and emit.py: the keyless price model behind section 8. sizing.sh runs every case the plan cites, and sizing.txt holds the lines it printed. Run bash sizing.sh in this folder; it needs only Python 3.
- power.py and mddgrid.py: the keyless power simulation (numpy and scipy) and the script that wrote mdd-grid.json, the MDD grid sections 7 and 8 read.
- probes.md: the four $0 probes from section 10, with their scripts and results.
- export/: the /autoplan run's public export (gstack-autoplan export --public on gstack 1.93.34.0): the run record, the review record, every bound review, the findings, tasks, decisions and the gate. Two files are redacted because they held the project owner's own words, which stay in the Captain drive: the owner_reply fields in decisions.jsonl and one quoted line in ceo-native.a5.bound.md. Five more differ only in punctuation: em dashes became hyphens in ceo-consensus.md, design-consensus.md, dx-consensus.md, eng-consensus.md and review-record.md, for the repo's style. For these seven files run.json's digests are the exporter's, and the attachments list holds the committed ones. Everything else is as exported.

## Implementation plan

The whole design sits in this section, so every reviewer reads all of it.

### ELI5

We want to know, for each gstack skill, whether the work an AI does comes out better with that skill than without it. Not whether the skill writes a nice review, but whether the code it helps build actually works and is easy for people to use. So we take real changes that real open-source projects made after the AI was trained, where we already hold the answer: the project's own hidden tests. The same AI does the same task with no gstack and with the skill told by name, and we check that it really followed the skill's steps. For design, a separate AI acts as a user and tries to get things done in the screens that were built. For developer tools, a fresh AI tries to use the new feature from the docs alone.

This first round tests six skills. Each gets at most $2,000, everything included, and the six together get at most $10,000. Each starts with a check whose paid runs cost about $60 to $130. If the plain AI already does the task almost every time, or the skill's steps don't run, that skill stops there and spends nothing more. For its money each test can see a difference of about 16 to 19 points in tasks solved. That is enough to see a big win or a loss, but not a small effect, and every result says so. If prices come in higher and a test could only see 20 points or more, it stops before it spends.

### Before → after

Before: no gstack part has fair evidence that it helps or that it doesn't (R56 table: 0 helps, 0 no effect, 59 of 74 parts never measured). The evals that did run graded proxies, such as whether a review found seeded problems in a plan or a diff, and they mostly could not move. CEO panel v2 hit a ceiling: plain Opus 5.5 found all 12 seeded items. E0 and the panel v3 headroom read did the same (plain Opus found 35 of 36 planted flaws on #191), so seeded-flaw plan panels are ruled out here. Elsewhere Opus loaded the skill and skipped its steps: no specialist and no adversarial pass in 66 of 66 /review sessions, no /investigate debug report in 111 of 111 trials, and no untold skill opened in 481 trials across Opus and particle-1 (Run D). Only one lane, the real-world outcome lane, grades what ships, and it measures gstack's /ship as a whole, not each skill.

After: one rig grades wave 1's six skills on the outcome of real work, at no more than $2,000 a skill and $10,000 in all, with every cost included. Every skill verdict reads against no gstack and carries the rate at which the told skill's steps really ran. It prints the smallest difference its budget can see and sits beside cost per solved task, which must stay within 1.5 times no gstack's for a KEEP. Wave 1 tests plan-eng-review and plan-devex-review first (GST-1218 holds both as cut candidates until this test reads), then autoplan, devex-review, plan-design-review and design-review. Each skill gets an admission check whose paid runs cost about $60 to $130 before any larger spend, so a ceiling shows up for about a hundred dollars.

### Why it matters

gstack's rules make every crew run /autoplan before new work and /ship before every merge, and both cost millions of tokens a run. If planning, Krug-style design review and devex review make better code and products, gstack should say so with numbers, and keep them. If they don't, or if a one-line hint does as well, the text that loads on every run is cost with no return, and R56 says it goes. Garry believes planning, design and devex thinking pay off. This plan is built so that belief can come out true or false, and every null carries the MDD its $2,000 bought.

### What caused this work

Proxy evals kept ending at a ceiling or with zero exposure. The real-world outcome lane (GST-690) showed real repo tasks can sit off the ceiling and can be graded by hidden tests on what shipped. GST-1088 (the gstack overhaul: a discovery hook, an adherence check and a diet) will change whether Opus runs skills at all, and GST-1089 (#169) measures it on /investigate and /review. Garry then asked for the outcome standard on every skill, with planning, design and devex first, and the Captain opened GST-1144.

### What changed

**At gate 1.** /autoplan run autoplan-20261103023817 reviewed v1 with one Opus 5.5 reviewer per phase (CEO, design, DX and eng; 64 findings) and opened gate 1 with 24 items. v1 priced wave 1 at about $190,000, or about $250,000 with the gate's recommended changes. The project owner capped each skill's evaluation at $2,000 all-in and took no gate option. v2 re-planned every stage under that ceiling: prices from metered sessions, none and told on every skill with other rows only where they fit, an admission check before any bulk spend, a futility look, a 1.2 design effect for repository clustering, and no "no effect" or idea-only claims. The gate 1 items the ceiling settled (d2, d3, d4, d10, d18, d19 and d23) hold their fix in the text. The measurement-validity items (d1, d5 to d9, d11 to d17 and d20 to d22) stay open as v1 had them.

**At gate_rev 2.** Round 2 reviewed v2 with two voices, CEO and Eng, each Opus 5.5, under the Captain's two-voice limit. Design and DX closed with their findings deferred to the build. The project owner took every recommendation, and v3 writes the nine accepted changes into the plan:

- d1 (CEO F7): U's confirmatory waits for a cheaper agent user that passes calibration and buys an MDD of at most 13 points. U's admission still runs (decision 9, section 8).
- d2 (CEO F1, Critical): the futility look is two-sided, and an interim estimate in none's favor is a loss lead (sections 6 and 9).
- d3 (CEO F2): the cost-per-solved guard binds every told skill in #169's form, with each skill's break-even gain beside its MDD and an R48 rule for the ratio (sections 3, 8 and 9).
- d4 (CEO F3): an interval rule replaces "a null rules out a gain of that size", and GST-1218's reading is tied to a told arm on the named after pin (decision 3, sections 7 and 8).
- d5 (CEO F4): prices move to the house central (5 times a Verified session), with a 10 times stress, particle-1 at 0.41 of Opus, and a projection check between stages (sections 6 and 8).
- d6 (CEO F5): O1 freezes autoplan's told invocation per pin (sections 4 and 13).
- d7 (Eng F1): a one-survivor price per family and a frozen re-size rule, stopped at a 20-point bound (sections 6 and 8).
- d8 (Eng F2): forced and exposed-told price rows, told sessions metered by exposure at admission, and a pin frozen at admission (sections 6 and 8).
- d9 (Eng F3): a crew line of $1.20 per valid task inside authoring, and two preregs per family inside the $70 line (section 8).

Under d7's fixed order (particle-1, then trials, then tasks), every lone survivor passes the 20-point bound at house prices against the $1,700 re-size line (section 8), so a family whose other skill stops ends both skills as FIX-METHOD (price).

A carry check on this delta (gate_rev 3) found three problems, and the Captain had them fixed in one round. The survivor search had replaced d7's fixed order, the envelope ignored open reservations, and U's and X's cost cut compared a fractional gain with a pass-or-fail break-even. v3 restores d7's order, makes the envelope admit and reserve each paid stage atomically (O6), and reads U's and X's cost from the ratio's interval alone.

Design's 12 and DX's 16 open findings go to the build (d10, d11). Two of them become blocking build tasks whose risk the project owner accepted: a vision-first agent user, which U's admission calibration tests (uc1), and admitting only X goals an agent can finish non-interactively, with a per-command timeout (uc2) (section 13). v3 also fixes two round-2 Mediums: sections 1, 2, 5 and 9 now describe wave 1's arms (CEO F9), and the repository-clustered test decides, as the lane's does (Eng F5, section 4). The sizing scripts now run as attached (Eng F20).

**Program cap (Q1).** With the same answer, the project owner capped the program at $10,000 and each skill at $2,000. So this program is wave 1 only: the six skills, each at most $2,000 all-in, under a program-wide envelope that blocks any stage whose projection would take settled spend past $10,000 (section 8). Waves 2 and 3 leave the program and come back only with wave 1's results. v2's program-at-ceilings table and its wave 2 and 3 prices are gone. No review reopens for Q1: it is a scope and cap cut recorded at the gate.

### Big decisions

1. **One shared rig and task pipeline, extended, not a new lane per skill.** Options: (a) extend the real-world outcome lane's rig (Harbor runner, metering proxy and ledger, evaluator-owned sidecar, verifier contract, sealed custody, post-cutoff mining) with the instruments and an arm registry; (b) a lane per skill. Pick (a). Each skill then costs arms and a task family. What would flip it: the lane's P0 pilot showing that its sandbox can't run gstack skills other than /ship fairly.
2. **Arms: none and told, with an exposure gate, on every skill; a stand-in or untold arm only where it fits.** The stand-in is one or two sentences, written from the skill's own one-line description and public practice, with no gstack words. Told means gstack is installed and the skill is invoked by name. It is scored intention to treat, with the exposure rate printed beside the verdict, and a verdict counts as fair only at 80% exposure or more. A stand-in runs where its cost leaves told minus none's MDD within 2 points of the told-only design, under the 20-point bound (decision 6) and inside the program envelope. At house prices wave 1's plan has none; the G prereg rechecks plan-eng-review's at admission (section 8). Untold runs only if the overhaul's after pin shows untold sessions opening the skill, and only where it fits by the same rule. What would flip it: admission's metered prices coming in well under section 8's, which would let a stand-in in.
3. **Told arms are confirmatory only on a pin where the steps run.** A told arm on GST-1088's before pin (82db89a) mostly measures skipped steps. Admission runs told on the pin the prereg will use, and that pin is frozen at admission: a pin named later needs a new admission paid from the skill's reserve. Confirmatory told arms use the after pin once gstack's maintainers name it and its told exposure passes the bar. If it isn't named by a confirmatory prereg's date, that prereg uses the forced line (told's line plus one sentence that names the skill's steps) on the before pin and scopes its claim to "the skill with its steps forced". A forced-line verdict can't by itself KEEP or CUT the shipped skill text. So plan-eng-review's and plan-devex-review's rows settle GST-1218 only on a told arm on the named after pin. If the pin isn't named by G admission, the Captain hears then that those rows can only inform GST-1218, and chooses between waiting for the pin and reading the forced line as information. What would flip it: the before pin's plain told exposure passing the bar at admission, which the evidence so far says it won't.
4. **Measures: hidden tests decide.** Adopt hidden-test correctness as the primary for every build family, agent-user completion as the design primary and docs-only first success as the devex primary, with hidden tests as their guard. Under the ceiling, wave 1 also keeps mutation score of agent-written tests and the escaped-defect subset in G, which cost almost nothing. The follow-up change and the U judges wait for a later program. Cost per solved task prints beside every number, and its 1.5 times guard binds every told KEEP (sections 3 and 9).
5. **Families and order.** G (plan-eng-review, autoplan), then X (plan-devex-review, devex-review), then U (plan-design-review, design-review). autoplan is tested on G only. Ship stays on the real-world outcome lane, priced in that lane's plan and outside this program. This program is wave 1 only; waves 2 and 3 come back only with wave 1's results. Section 5 keeps the map for later programs: 27 of gstack's 64 skills mapped to an outcome test, with three shared parts folded into them, 32 that can't be outcome-tested in this rig, each with its reason, and 5 safety guards exempt.
6. **Size: whatever $2,000 buys, with its MDD printed and a bound.** At section 8's house prices (a real feature session at 5 times a Verified session), Opus's told minus none reaches an MDD of 18.6 to 19.2 points in G and U and 15.6 in X, with an allowance for repository clustering. A re-size that would pass 20 points stops the skill before its next stage spends. Wave 1's plan has no stand-in or particle-1 row (section 8). Sol is out of wave 1 because its metered sessions cost 1.3 to 1.6 times Opus's. What would flip it: metered prices well under section 8's.
7. **Admission first, per skill.** On a 12-task thin slice, about $64 to $128 of paid runs a skill buys the read: plain Opus between 20% and 80%, told exposure at the bar, valid instruments and metered prices, with exposed and unexposed told sessions metered apart. A skill that fails stops and spends nothing more.
8. **The ceilings.** The project owner capped the program at $10,000 and each skill at $2,000. Both are all-in: paid model calls, judges, VMs, and the crew threads' own model use, at about $1 per 1,000 credits. A program-wide envelope blocks any stage whose projection would take settled spend past $10,000: it admits and reserves each paid stage atomically against settled spend and every open reservation. If prices run high it binds before any skill's cap does, and it trims the last skill in wave 1's order first, design-review. Each skill's cap holds its reserve inside its $2,000. A cap stop ends that skill incomplete, and it is never retried to change a verdict.
9. **U's confirmatory waits for a cheaper agent user.** At 18.6 and 19.2 points a U null can't move a design skill to a cut. So U's admission runs, and U's confirmatory runs only once an agent user cheaper than Opus passes the same calibration and the re-sized MDD is at most 13 points. Otherwise U stops after admission as FIX-METHOD, and its unspent money stays unspent. What would flip it: a cheaper agent user that calibrates, at prices low enough to reach 13 points.

### 1. The question and the standard

For each skill X and each model M: on real tasks of the kind X claims to improve, is the outcome better when M is told to run X than when M runs with no gstack? Where the money allows a stand-in (one or two sentences that state X's idea), is told also better than the stand-in? Where X is an on-demand skill and the after pin shows untold sessions opening it, does M with gstack installed and not told get the same outcome as told? Every wave 1 skill pays for the first question; section 8 says where the other two fit, and at house prices wave 1's plan buys neither.

Outcome means what the work does: the code passes the project's hidden tests, the tests it wrote catch bugs, a user gets their task done in the built UI, a developer gets a first success from its docs, and in a later program the next real change to it succeeds. It never means what the skill's own output looks like (a review that finds seeded problems, a plan with the right headings). Cost per solved task prints beside every number.

Verdicts per skill and model, the R56 words: helps, hurts, not distinguished with its MDD and interval, or untested with the condition that failed. The ceiling can't power a "no effect at stated power" reading. Each null gets R48's Why-null cycle and R61's one ceiling raise where it rests on saturation (section 9).

### 2. One rig, task families and reuse

Everything runs on the real-world outcome lane's rig (GST-817): Lane B's Harbor runner, metering proxy and ledger with one lease per item; the trial sandbox with a local origin and a recording gh stub; the evaluator-owned sidecar that records what shipped; the verifier contract from #102 (gold-restored test config, a verifier-owned entrypoint, per-test records, non-root, offline); the mining, validity checker (V1 to V9, L1 to L6) and sealed custody from B1, B2 and the thin slice. No-gstack arms run in the clean room panel v3's C1 defines (no drive mount, no gstack install, no skills folder, a preflight that refuses otherwise).

New pieces, all under lanes/outcome-skills/ as wrappers over the lane:

| Piece | What it adds | Reuses |
|---|---|---|
| Arm registry | per skill: the turn script for none, stand-in, plan-first, told, forced and untold; the stand-in line and forced line, each pinned by sha256 in a test; the exposure detector | the lane's two-turn agent, review-units' told-prefix arms, panel v3's two-turn protocol and clean room |
| Follow-up runner | a fresh plain agent (fixed model, no gstack, clean room) gets the repo's real next change on an arm's final tree; the verifier grades it | the verifier, Harbor |
| Mutation scorer | mutation score of the tests an agent added, restricted to the lines its diff changed, per language | the verifier's container |
| Agent-user harness | a fixed agent user drives the built UI in headless Chromium through set scenarios; a step log; scenario checkers on app state | Playwright (not gstack's browse, so the instrument does not depend on gstack) |
| Docs-only harness | a fresh plain agent gets the built artifact and its docs, no source, and a goal; a checker decides first success | the verifier's container |
| Scorer extension | per-skill contrasts, the admission read, cost per solved task, the R48 table | lanes/real-outcome/score, src/runner/stats |

**Task families.** All tasks are real changes merged on or after 2026-07-01 to public repositories with a permissive licence (MIT, Apache-2.0, BSD), with statements in our own words by an author from a family not under test and audits by Opus 5.5 and GPT-6.1 Sol with no gstack (panel v3's author rule). One mined pool feeds every family, tagged at mining:

| Family | Task kind | What the agent gets | Hidden grading | Skills |
|---|---|---|---|---|
| G, general features | K3 features and K2 issue fixes, multi-file | the statement at the base commit | hidden tests (the change's tests and the base suite); escaped-defect tests on the K1 subset; the follow-up change where one exists; mutation score | autoplan, plan-eng-review, spec, office-hours (builder mode), verify, investigate, test-audit, deslop-shared-libs, context-save and context-restore, learn |
| U, UI features | K3 features in web apps that change screens | the statement plus "users should be able to <goal>" | agent-user completion on 3 frozen scenarios; hidden tests (unit and the PR's e2e tests where present); blind judges second | plan-design-review, design-review, qa, qa-only, design-consultation, design-html |
| X, developer-facing features | K3 features in CLIs, SDKs and libraries that add or change a public surface | the statement plus "document it for users" (both arms; a real feature PR carries docs) | docs-only first success by a fresh agent on 1 frozen goal; hidden tests; follow-up change | plan-devex-review, devex-review, document-generate, document-release |
| S, ship and review | the lane's build tasks and K4 ship replays | the lane's turns | shipped clean, shipped defective, caught rate on replays | ship, ship-review-panel, ship-docs-audit, review (with its Review Army and adversarial pass), codex as an outside-voice variant |
| M, maintenance | real aging pull requests that later landed; repos at a post-cutoff commit | the branch or the repo and the job | hidden tests at the landed head; mutation score held while the suite shrinks | modernize, test-audit |

This program runs wave 1's six skills only: plan-eng-review and autoplan in G, plan-devex-review and devex-review in X, and plan-design-review and design-review in U. The other skills in each row are the map for a later program. Wave 1 builds the arm registry (none, told, stand-in, forced and untold turn scripts), the mutation scorer, both harnesses and the scorer extension. The follow-up runner waits for a later program (section 13).

Family S is the real-world outcome lane itself. This plan adds arms to it (section 4) and does not change its primary, size or cap.

### 3. Measures: adopt, change or reject, with the scoring rules

Under the ceiling, wave 1 runs these measures: hidden tests, mutation score and escaped defect in G; agent-user completion and its hidden-test guard in U; and docs-only first success and its guard in X. The follow-up change and the U judges below are defined for a later program and don't run in wave 1.

Every rule below is frozen before code and attacked here first (insight plan E1). A trial is one session of one arm on one task on one model.

| Candidate | Decision | Why |
|---|---|---|
| Correctness from the repo's hidden tests | **Adopt** as the primary for families G and S, and the guard for U and X | It is the lane's verifier contract, already built and attacked over six /ship rounds (#139 to #150). It grades what was built with tests the agent never sees. |
| Future bugs: the later fix's regression test as a hidden test | **Change** to a secondary on the K1 subset, plus the replay set for ship and review | The thin slice probed 131 SZZ-linked candidates and kept 5 (about 3.8%) whose regression test passes at the base and fails with an assertion at the change; all 6 round-1 pairs failed audit because the later fix reversed a design choice (GEVA-173). The mining probe (section 10) gives the raw link rate for feature changes. The mining probe projects about 0.25 usable pairs per repository per four months, so a 40-repository family panel holds about 10 K1 tasks, too few for a primary. The escaped-defect rate is read only if admission shows plain Opus re-creates the bug in at least 10% of K1 trials (the lane's rule); the K4 replay set carries the escaped-bug question for ship and review. |
| Test quality as the mutation score of the tests the agent wrote | **Change**: a secondary, scored on the agent's own tree over the lines its diff changed, with a transplant reading | Mutating the gold tree would need the agent's tests to import gold's internal names, which they often won't. Scoring the agent's tests against mutants of its own changed lines measures whether its tests pin the behavior it wrote. Rules below stop the obvious games. Primary only for test-audit. |
| Architecture as the pass rate and cost of a fresh plain agent making the repo's real next change | **Adopt** as a secondary, on the both-solved subset first | It grades design by what it does to the next change, which is what architecture review claims. Conditioning matters: a broken first tree fails the follow-up for a reason that is not architecture, so the primary architecture reading uses tasks where both arms' trial-1 trees solved the first task, and the unconditional reading is the sensitivity. |
| Design as an agent user completing set tasks in the built UI (steps, errors, dead ends), blind judges second | **Adopt** as the family U primary, with the judges second and an instrument check | It asks the Krug question (can a user who scans get it done) of the product, not of the review. A frontier agent user may navigate a bad UI anyway, so the instrument must first show it can tell a degraded UI from the real one (admission, section 6). |
| Devex as a fresh agent reaching first success from the docs alone (time and errors) | **Adopt** as the family X primary, with a docs-only container | It grades the docs and the surface a developer meets, which is what devex review claims. Source is absent from the container, so the agent can't read the code instead. |
| Cost per solved task beside every number | **Adopt**, as a binding guard | R57 and GST-1088's bar: told's cost per solved task at most 1.5 times none's, in #169's form (the upper bound of the ratio's 95% interval at most 1.5). It binds every told skill's KEEP (section 9). |

**Rejected outright:** finding-recall on seeded plans or diffs as a verdict for these skills (that is panel v3's instrument and stays a proxy there); judge preference as a primary for anything (judges are second, blind, and only where an instrument exists); self-reported scores from the skill's own output (for example a devex score out of 10).

**Scoring rules.**

- **Solved** (G, S build tasks): the final tree at the end of the last turn passes every hidden test in a verifier-owned run (for S, the lane's shipped-clean on the shipped head). A tree that fails to build fails. Partial credit (share of hidden tests passed) is a sensitivity reading, never the primary.
- **Arm stop:** a trial that hits its turn cap, dollar allowance or wall limit is scored on its tree at the stop, counted unsolved, and its cause printed. Limits are frozen per arm at a multiple of admission's p95, so a slow skill is not stopped early by a limit sized for none.
- **Infra and upstream gaps:** a trial that ends from a rig, provider or proxy failure is a gap, rerun once with a named repair; never retried to change a verdict. If more than 5% of an arm's trials are gaps, that cell is NO READ. Analysis uses tasks with at least one valid trial in both arms of the contrast, and prints gap counts per arm.
- **Contamination:** a none, stand-in or plan-first trial that read any gstack file is contaminated, excluded and counted; the arm is clean by construction (panel v3's clean room), so the read audit is descriptive.
- **Exposure:** every told trial is scored, exposed or not (intention to treat). Exposure is read from the transcript and run records by a per-skill detector frozen from the pinned skill files (section 5's last column). A verdict is fair only when the told arm's exposure is at least 80%; below that the row reads "untested (exposure)" and goes to R48 as an exposure null. An exposed-only reading is printed as a description, never a verdict, because exposure is chosen by the model and is not random.
- **Agent-user completion** (U): each task has 3 frozen scenarios, each a goal plus a state checker on the running app (a database row, a stored setting, a URL or DOM state). The fixed agent user gets a screenshot and the accessibility snapshot per step and a step cap of 25. A scenario is completed when its checker passes within the cap. Per tree the score is completed scenarios over 3. Steps to completion, failed actions, console errors and dead ends (a state hash seen 2 or more steps earlier) are secondaries. An app that does not start scores 0. The agent user never sees the statement, the code or the arm.
- **Docs-only first success** (X): the built artifact (the package, binary or server built from the arm's final tree) is installed in a fresh container with only README, docs/, the artifact's --help output and published type files; no source tree. A fixed fresh agent gets one frozen goal ("use the new <feature> to <outcome>") and 20 turns. First success is the goal's checker passing. Time, turns, tokens and failed commands to first success are secondaries. 2 runs per tree; the tree's score is their mean.
- **Follow-up change** (G, X; architecture): where the mined pair has a real next change (a later merged commit, not a fix or revert, that adds or changes tests and whose changed or removed source lines blame to the feature commit; the mining probe showed that a looser rule, any later commit touching a shared file, links 83% of features and mostly measures churn), a fixed fresh agent gets the follow-up's statement on the arm's trial-1 final tree. Solved is the follow-up's hidden tests plus the base suite passing. A validity rule (V10) requires the follow-up's hidden tests to call only interfaces at the original base or named in the first task's statement, and to pass on the gold tree. Read: follow-up solved rate and its metered cost.
- **Mutation score** (G, X, M): the tests the agent added or changed are run on its own final tree; tests that fail there are dropped and counted (a failing test kills every mutant). Mutants come from the pinned tool for the language (section 10), only on source lines the agent's diff changed, sampled to at most 200 with a frozen seed. Score = killed / (killed + survived), with timeouts and tool errors excluded and counted. A trial with no added tests scores 0 and is counted as "no tests". The transplant reading runs the same tests on the gold tree against gold's changed-line mutants where they run unchanged, and prints how often they could.
- **Escaped defect** (G, K1 subset): the tree passes the change's own tests and fails a regression test from the later fix.
- **Cost per solved task:** an arm's metered model dollars over all its trials divided by its solved trials, with a task-clustered bootstrap interval. Measurement agents (agent user, docs-only agent, follow-up agent, judges) are metered apart and never charged to the arm. For U and X, a tree counts as solved for this figure when its primary score is 1: all 3 scenarios completed (U), or first success in both docs-only runs (X). The guard's ratio is told's figure over none's, by #169's G3 definition (O4).
- **Judges** (U, second): two blind judges from different families (Opus 5.5 and GPT-6.1 Sol), pairwise on screenshots of the same scenarios, against a rubric written from public usability practice, not gstack's text. Ties and disagreements are reported; judges never decide a verdict alone.

### 4. Arms and models

All arms run Claude Code at the rig's pinned version with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, the claude-code-preset system prompt, the same task image and sandbox, the same simulated user (the lane's rec persona) and fresh home and gstack state per session.

| Arm | Install | Turns | Where |
|---|---|---|---|
| none (required) | bare, clean room | T1: the statement, then "Work in this repository. Implement this, and make sure it works. Don't stop to ask." | every skill, every model row |
| told (required) | gstack at the pin, installed by gstack's own setup for the claude host | before-build skills: T1 the statement, then "Before you write code, draft your plan in PLAN.md. Don't write code yet."; T2 "/<skill> PLAN.md"; T3 "Now implement your plan, and make sure it works." After-build skills: none's T1, then T2 "/<skill>". autoplan's exact line, kind and voices per pin are frozen in O1 | every skill |
| stand-in | bare | told's turns with the skill turn replaced by the stand-in line ("Review PLAN.md this way and fix it: <line>" before build, the line alone after build) | only where it fits (section 8); wave 1's plan has none |
| forced | as told | told's turns with one sentence added to the skill turn that names its steps, frozen from the pinned skill (panel v3's forced lines) | in place of told, only under decision 3's fallback |
| untold | as told | none's turns exactly | only where the after pin shows untold sessions opening the skill and it fits (section 8) |

Told's three turns for a before-build skill keep one confound: none gets no planning turn. v1's plan-first arm split that out, and it leaves wave 1 under the ceiling. So a before-build told win reads as "plan first and review" against none, and a KEEP from it keeps the skill together with its planning turn. Where a stand-in runs, it takes the same three turns with the review turn replaced, so told minus stand-in is the one contrast that holds the turn count fixed. Wave 1's plan has none.

Every told, forced and untold session runs under the same simulated user, which answers gstack's questions with "Go with your recommendation." /autoplan in an unattended session stops at its gate, and the rec user gives the gate's recommended reply. Its outside voice is pinned to the cell's model (no other key or codex binary in the image, as panel v3 pins it), so a gstack win can't come from a second model family.

**autoplan's told invocation.** O1 freezes it per pin: the kind (crews now run --kind feature on features), the phases its scope chooses, the outside voice and its model, the gate answer and the exact slash line. The before pin (v1.93.22.0) predates gstack's kinds, which arrived in v1.93.36.0, and section 8's 5.0 multiple assumes the full panel. So admission meters the frozen configuration before autoplan's place, size and MDD in the wave-1 table are fixed, the four-way stand-in matches the phases it runs, and every autoplan verdict names the configuration. If the after pin's default kind differs, the prereg says which one it tests and why.

**Browser and tools.** Family U images carry Playwright and headless Chromium for every arm, so none and stand-in can look at their UI too; gstack arms also have gstack's own browse. Claims say so. Family X images carry the language's normal toolchain for every arm.

**Models (R54).** Claude Opus 5.5 is primary and decides admission. particle-1 (particle-ai/particle-1 on OpenRouter) runs none and told for a skill only where its rows leave Opus's told minus none MDD within 2 points, under the 20-point bound and inside the program envelope. At house prices, with particle-1 at quick look 3's 0.41 of Opus, it passes the 2-point rule only on plan-eng-review, and wave 1's plan leaves that row to admission (section 8). In U the agent user costs the same whichever model built the tree, so a particle-1 row there costs nearly as much as Opus's. Where a particle-1 row runs, it has its own admission row: a particle-1 none rate under 20% on the Opus-screened panel drops the row as floor, and its money stays unspent. GPT-6.1 Sol leaves wave 1. R3a metered Sol at 1.33 times Opus's none session and 1.63 times its told session, so a Sol row costs more than Opus's, and the ceiling can't hold both with Opus powered. A later program's preregs say again why Sol is in or out. Haiku and Sonnet are not models under test. Measurement agents are fixed across arms and models: the docs-only agent is Opus 5.5 with no gstack, and the agent user is frozen at U's admission from Opus 5.5 and any cheaper model that passes the same calibration.

**Relation to GST-1088's pins.** The overhaul's before pin is 82db89a (v1.93.22.0); its after pin is one sha gstack's maintainers name in writing (#169). On the before pin a told arm mostly measures skipped steps: Opus skipped /review's specialists in 66 of 66 sessions and /investigate's report in 111 of 111. So under decision 3's fallback the forced arm gives the skill's effect when its steps do run. Confirmatory told arms run on the after pin once it is named and passes the exposure bar at admission (decision 3). Untold arms run only on the after pin, because the before pin's untold open rate on Opus and particle-1 is already measured at 0 of 481. The rows this plan produces on the after pin double as the overhaul's outcome reading for planning, design and devex; #169 owns discovery and adherence and the /investigate and /review outcomes, and this plan does not duplicate them.

**Additions to family S (the real-world outcome lane).** This plan asks for two arms there, as lane amendments the Captain decides: the lane's plain-loop arm ("Before you ship, run the tests, review your own diff for bugs and fix what you find. Then ship it ...") becomes ship's stand-in and runs on R1's interim half whatever R1 shows, instead of only after a difference; and a /review told arm and its stand-in run on the K4 replay set after GST-734's driver fix. Both are priced in the lane's plan, not here, and sit outside this program's envelope.

**Contrasts and claims, per skill and model.** The primary is told minus none, paired by task. The decision test is the repository-clustered sign-flip test with a bootstrap 95% interval, two-sided alpha 0.05, as the lane decides (lanes/real-outcome/score/analysis.ts); the task-clustered reading is the sensitivity. Under repository clustering a task-level test keeps its power and loses its alpha, so it can't decide. Each family's panel spans at least 20 repositories, with at most 8 tasks in any one, because the lane's gate reads fewer than 10 repositories as inconclusive. Where a stand-in runs, told minus stand-in joins the primary and Holm takes the two at family alpha 0.05. Secondaries: stand-in minus none and untold minus none where they run, and every secondary measure in section 3. Readings:

- helps: told minus none crosses its boundary in told's favor;
- helps beyond the idea (stand-in skills only): told minus stand-in also crosses in told's favor;
- hurts: told minus none crosses in none's favor, reported plainly as a CUT-CANDIDATE path;
- not distinguished, with the MDD and the interval: otherwise. The ceiling can't power an equivalence test, so no skill gets a "no effect" reading here, and a gain is ruled out only above the upper bound of told minus none's 95% interval (section 7);
- ceiling: none above 85% on the confirmatory primary; no claim.

A null is reported with the control rate, the MDD and cost per solved task, and R48's Why-null cycle (section 9) ends it in KEEP, FIX-METHOD or CUT-CANDIDATE. No result here claims gstack in general, other skills, other task kinds or other harnesses. A U or X verdict also prints its hidden-test guard: a design or devex skill that wins its primary while losing more than 10 points of hidden-test correctness is reported as a tradeoff, not a win.

### 5. Per-skill outcome map

Keys and loads are gstack#3837's inventory as keyed in the R56 table (64 skills, 7 shared parts, 3 rows with no key). Rank is the inventory's load rank; tier is the R56 table's (F loads on every /autoplan or /ship under gstack's factory rules, O on demand, S every session). Stand-in lines are frozen verbatim at each prereg, with sha256; the drafts below are what reviewers attack. Exposure checks are read from the pinned skill's own files at the prereg, the way panel v3 froze them.

**Wave 1: planning, design and devex, with ship on the lane.**

This program runs six of these rows: every row but plan-ceo-review, which runs only inside autoplan here, and ship, whose test belongs to the real-world outcome lane, outside this program's envelope. autoplan runs on G only.

| Rank, part, tier | Family | Outcome it claims | Outcome measure | Stand-in draft | Exposure check |
|---|---|---|---|---|---|
| 12 autoplan, F (with 10 autoplan-phases) | G | better code from a reviewed plan: test plans, coverage, architecture, fewer later bugs | solved; mutation; escaped defect | "Before you code, review PLAN.md four ways and fix it: as a founder (right scope?), a designer (every screen's states), a developer meeting it cold (setup and docs), and an engineering manager (architecture, failure modes, a test plan)." | run.json validates under the told configuration O1 froze; every phase autoplan's scope chose loaded its review skill and wrote findings in order, Eng last (panel v3's rule) |
| 13 plan-eng-review, F | G | architecture, failure modes and a test plan give correct, tested code and an easy next change | solved; mutation; escaped defect | "Before you code, review PLAN.md like an engineering manager: settle the architecture and data flow, list failure modes and edge cases, and write a test plan. Fix the plan, then build to it." | its review sections or checklist read, Step 0 marker, its 4 sections in order, a test plan artifact |
| 4 plan-ceo-review, F | inside autoplan here; alone in a later program's vague-intent tasks | the right scope | later: solved on vague-intent tasks | "Before you code, review PLAN.md like a founder: challenge the premise and scope, and keep what makes the change matter to its users. Fix the plan, then build to it." | sections or checklist read, Step 0 marker, a named mode (panel v3) |
| 7 plan-design-review, F by UI scope | U | screens a user who scans can use | agent-user completion; hidden-test guard | "Before you code, review PLAN.md like a designer who follows Krug: users scan, they don't read, so give each screen one obvious job and plan its empty, loading, error and edge states. Fix the plan." | its 7 passes in order |
| 2 design-review, O | U | finds and fixes hierarchy, spacing and flow problems in the built UI | agent-user completion; guard | "Open what you built in a browser and look at it like a designer who follows Krug: users scan, so make each screen's purpose and next action obvious. Fix what you find, then check again." | screenshots of the running app, the Trunk Test applied per page, at least one fix after an audit finding |
| 9 plan-devex-review, F by DX scope | X | a developer meets the feature and reaches first success | docs-only first success; guard | "Before you code, review PLAN.md as a developer meeting this feature cold: what do they install, read and type to get a first success, and where could they get stuck? Plan the docs and error messages. Fix the plan." | its 8 passes in order |
| 6 devex-review, O | X | the live feature and its docs get a developer to first success faster | docs-only first success; guard | "Try your feature as a developer new to it would, from the docs alone: install it, follow the docs, run the first example, and fix every step that confused you or failed." | a timed first run of the built feature and its tested-dimension count |
| 3 ship, F (with 1 ship-review-panel, 58 ship-docs-audit, ship's QA probes) | S | changes ship clean; defects stop before merge | the lane's shipped clean, shipped defective, replay caught rate | the lane's plain-loop line (section 4) | the lane's per-step log: tests ran, readers dispatched and returned, QA read |

**Later program, wave 2 (outside this program): debugging, checks, QA and intent.**

| Rank, part, tier | Family | Outcome it claims | Outcome measure | Stand-in draft | Exposure check |
|---|---|---|---|---|---|
| 5 review, O (with its Review Army and adversarial pass) | S, K4 replays | finds and fixes the bug before it ships | replay caught rate; decoys shipped clean | "Review this branch's diff like a senior reviewer: look for bugs, edge cases and missing tests, and fix what you find." | specialists dispatched and adversarial pass returned (R2's rule), on a driver with GST-734's fix |
| 59 verify, O | G | the change is green before it is called done | solved | "Run the repo's checks and the tests that cover your change, fix what fails, and repeat until everything passes." | checks run after the last edit, until green |
| 26 investigate, O | G, K2 issue fixes | root cause fixed, with a regression test | solved; escaped defect; mutation | "Find the root cause before you fix: reproduce the bug, test your hypotheses, then fix it and add a regression test." | Phase 5 debug report present |
| 28 qa, O | U, and G for API or CLI tasks | finds and fixes user-visible bugs | solved; agent-user completion | "Test the app like a user in a browser, find the bugs, and fix each one with a regression test." | a browser session on the running app and a regression test per fixed bug |
| 40 qa-only, O | U | bug reports a fixer can act on | report to fix: a fresh plain agent fixes from the report; solved | "Test the app like a user in a browser and report every bug with steps to reproduce. Don't fix them." | a report with reproduction steps |
| 20 spec, O | G-v, vague-intent tasks with an oracle user | turns a vague ask into the behavior the maintainers built | solved | "Before you code, turn the request into a precise spec: inputs, outputs, edge cases and acceptance tests. Ask the user what you can't infer. Then build to it." | its five phases in order and a spec file |
| 11 office-hours, O (builder mode) | G-v | builds the right thing from a vague ask | solved | "Before you build, question the request like a startup advisor: who is it for, what is the smallest version that does the job, and what would make it fail? Then build that." | its mode chosen and its questions asked |

G-v tasks give only the user's need from the issue, not the maintainers' solution. An oracle user holds a short summary of the merged behavior, written by the author, and answers any question truthfully from it in at most two sentences; it volunteers nothing. Every arm can ask. Leakage control: the summary names behavior, never code, file names or tests, and the auditor checks that answering every question at once would not hand over the hidden tests.

**Later program, wave 3 (outside this program): maintenance, docs, design tools and memory.**

| Rank, part | Family | Outcome measure | Stand-in draft |
|---|---|---|---|
| 49 test-audit | M | mutation score held (non-inferiority, 5 points) while suite time falls; later regression tests still fail on the K1 change | "Find tests that add no protection, such as duplicates or tests of nothing, and remove them without losing coverage of real behavior." |
| 56 deslop-shared-libs | G | follow-up change solved and cost; hidden tests unchanged | "Look at your recent change for code that duplicates code elsewhere in the repo, and extract what is worth sharing." |
| 54 modernize | M, real aging PRs that later landed or closed | solved at the landed head; agreement with the maintainers' land or close | "Bring this old branch onto the current base and decide whether it should still land: update it, rework it or close it." |
| 34 document-generate | X, features with no docs at base | docs-only first success | "Write the missing user docs for this feature: what it does, how to install and use it, and one working example." |
| 50 document-release | X | docs-only first success after the change | "Update every doc this change affects, so a reader of the docs alone gets it right." |
| 14 design-consultation | U, new screens with no design system | agent-user completion; judges | "Before you build the UI, choose one coherent design system (type scale, color, spacing) and use it on every screen." |
| 22 design-html | U, tasks with an approved mock | agent-user completion; judge against the mock | "Turn this approved mock into production HTML and CSS that matches it at every breakpoint." |
| 45 context-save and 33 context-restore | G-h: a build cut at a frozen turn and resumed by a fresh session | solved; cost | "Before you stop, write a handoff note: what's done, what's next and where things are." and "Read the handoff note first." |
| 65 learn | G-h: three sequential tasks on one repo | solved on task 3; cost | "Keep a short notes file of what you learned about this repo, and read it at the start of each task." |
| 16 codex | S: an outside-voice variant of ship and review on replays | caught rate | none: it is an arm variant, not a skill test |
| 24 benchmark | P: real performance regressions whose fix adds a benchmark | regression caught | deferred until a yield probe finds such pairs |

**Skills that can't be outcome-tested in this rig (32), and why.**

- Their outcome is outside one repo and one session: retro (a weekly team report; its outcome is later team behavior), captain (a crew controller; its outcome is merge trains across threads), canary and land-and-deploy (need production traffic, a deploy target and merge rights; the gh stub refuses merges by design), plan-tune (tunes questions for an interactive person).
- They need a person or the person's own accounts: design-shotgun (a person picks among variants; a simulated chooser would grade the simulator), scrape and skillify (the user's signed-in browser sessions), setup-browser-cookies, pair-agent.
- They need hardware or toolchains the rig lacks: ios-qa, ios-design-review, ios-fix, ios-sync, ios-clean.
- They are setup or instruments with no work product of their own: gstack-upgrade, setup-deploy, setup-gbrain and sync-gbrain (gbrain's evals own them), ubicloud, open-gstack-browser, browse (measured through qa and design-review exposure), gstack (the router; its effect is the untold arm), landing-report and health (read-only dashboards).
- Their product is an eval or a skill, which needs its own eval: eval-plan, benchmark-models, write-skill.
- Artifact tools where a functional check in gstack's own tests is the right test, not a paid comparison with nothing: make-pdf, diagram, design-motion.
- No text to test: claude-code (no SKILL.md at the inventory head).

**Exempt under R56 (5):** cso, careful, freeze, guard, unfreeze.

**Shared parts.** ship-review-panel, autoplan-phases and ship-docs-audit are tested inside ship and autoplan. The catalog (descriptions) is discovery: Run D and #169 own it, and this plan's untold arms read its outcome effect. The preamble belongs to I1 and the overhaul's diet. capy-skill and capy-factory load only in Capy, which the fair-test rule's preset never reaches; they stay a Captain call, as the R56 table says.

### 6. Priority, staging and the admission check

**Order.** Wave 1 runs plan-eng-review and plan-devex-review first. Their plan-review panels hit a ceiling, and GST-1218 holds them as cut candidates until this outcome test reads. autoplan follows on G and devex-review on X, sharing those families' rigs and panels. plan-design-review and design-review on U come last, because U needs the most new build (the agent user). The program envelope trims in the reverse of that order, design-review first (section 8). Waves 2 and 3 leave this program and come back only with wave 1's results.

**Stages per family**, each gated by the one before and by the projection check below:

| Stage | What | Paid | Decides |
|---|---|---|---|
| 0 | $0 probes (section 10), done in this thread | no | feasibility of the instruments and the pool |
| 1 | Build only what the family's admission needs: for G the arm registry, the mutation scorer and the scorer extension; X adds the docs-only harness; U adds the agent user. A keyless dry run with fake agents goes through every scoring rule | crew model use, inside the skills' ceilings | the rig is ready |
| 2 | Thin slice: 12 tasks a family, built, audited, checked and sealed (U: 3 scenarios each and a degraded fixture; X: a goal and a checker each) | crew and VM, inside the ceilings | slice yield |
| 3 | Admission per skill: Opus none and told, 2 trials on the 12 slice tasks, exposed and unexposed told sessions metered apart, plus instrument calibration for U (Opus's agent user and a cheaper one) and X; particle-1's rows only where section 8 lets them in | yes, about $64 to $128 a skill | go or stop |
| 4 | Bulk mining, authoring and screening for admitted skills only: plain Opus none on candidates into the 20 to 80% band (G 2 trials and a third on 0 of 2; U and X 1 trial, because their fractional score already bands) | yes, inside the ceilings and the envelope | the panel |
| 5 | Confirmatory prereg and run per family, sized by section 8 and re-sized from admission's metered prices, with one two-sided futility look at a random half of the panel; U's waits for a cheaper agent user (section 8) | yes, inside the ceilings and the envelope | verdicts |

**Admission, per skill and model, on the slice:**

1. Headroom: plain none on the family primary between 0.2 and 0.8.
2. Exposure: told at least 7 of 8 sampled trials on the pin the prereg will use, or forced under decision 3's fallback. The pin is frozen here: a pin named after admission needs a new admission paid from the skill's reserve.
3. Instruments: the agent user completes at least 2 of 3 scenarios on gold in at least 80% of runs, and the degraded fixture drops completion by at least 30 points; the docs-only agent reaches first success on gold in at least 70% of runs and on the base (feature absent) in at most 10%; the mutation tool scores at least 90% of trees without a tool error.
4. Rig: gaps at most 5% per arm, and arm stops explained by the frozen termination taxonomy.
5. Price and power: metered means per session, with exposed and unexposed told sessions apart, re-size the panel inside the cap and the program envelope, and the prereg prints the MDD that size buys. A re-size past the 20-point bound stops the skill before bulk mining spends. autoplan's size and MDD are fixed only after admission meters the told configuration O1 freezes.

A skill that fails 1 stops there and spends nothing more. It returns to the Captain as R48 FIX-METHOD with the reading, and R61's one ceiling raise becomes a proposal that needs its own price and approval. One that fails 2 returns as an exposure FIX-METHOD, and one that fails 3 as an instrument FIX-METHOD with the fix named. None of these is a verdict on the skill. One that fails 5 returns as a price FIX-METHOD with its size and MDD. In a family, one skill stopping doesn't stop the other. Shared costs already spent stay split between the two, and the survivor pays every shared cost still to come, re-sized by section 8's one-survivor rule.

**Futility look.** At a random half of the confirmatory panel, frozen in the prereg, the scorer computes conditional power on the decision test for a true effect of plus the planned MDD and for one of minus the planned MDD. A skill stops for futility only when both are under 10%, so a skill whose interim estimate favors none runs the full panel and can read hurts. Every stop prints the interim estimate, its 95% interval and its direction, and R48 treats an interim estimate in none's favor as a loss lead, not a plain null (section 9). The look is non-binding and never stops for efficacy, so it doesn't raise the test's alpha. O5's keyless dry run drives both cases. When one skill of a family stops here, the other re-sizes by section 8's one-survivor rule.

**Projection check between stages.** Between admission, screening and the confirmatory run, the scorer reuses R3 amendment 4's between-part projection check. It re-sizes the skill from settled spend and the metered means so far, and the next stage starts only if the re-sized MDD stays under the 20-point bound (13 for U's confirmatory), the projection stays inside the skill's cap, and the program envelope admits and reserves it (section 8). Otherwise the skill stops as FIX-METHOD (price) with its size and MDD printed, before the stage spends.

### 7. Power and MDD

The keyless simulation from v1 (power.py: numpy, seed 20261102; in-band plain rates between 0.15 and 0.85, a task-varying true effect with sd 0.15, k trials per arm per task, a two-sided paired t-test over per-task mean differences) ran on a grid of 24 to 126 tasks and 2 to 4 trials at alpha 0.05 and 0.025, with 3,000 simulations a point (mddgrid.py, mdd-grid.json, attached). Every MDD carries a 1.2 design effect for about 8 tasks a repository: gate 1's eng review (d18) found that a clustered test gives about 12 to 13 points where the unclustered simulation gives 10.5. The 1.2 factor sizes the repository-clustered test, which decides (section 4). MDD is the smallest true difference, in points, detected 80% of the time.

| Tasks x trials an arm | MDD, alpha 0.05 | MDD, alpha 0.025 (Holm's first step) | Used by (house prices unless named) |
|---|---|---|---|
| 42 x 2 | 26.4 | 28.8 | one-survivor re-size for design-review (past the bound) |
| 48 x 2 | 24.6 | 27.0 | one-survivor re-size for autoplan and plan-design-review (past the bound) |
| 60 x 2 | 21.6 | 24.6 | one-survivor re-size for plan-eng-review, plan-devex-review and devex-review (past the bound) |
| 42 x 4 | 19.8 | 21.6 | plan-eng-review and autoplan at the forced price |
| 54 x 3 | 19.2 | 21.6 | autoplan, design-review |
| 60 x 3 | 18.6 | 20.4 | plan-eng-review, plan-design-review |
| 72 x 3 | 16.8 | 18.6 | devex-review at the forced price |
| 78 x 3 | 15.6 | 18.0 | plan-devex-review, devex-review |
| 90 x 3 | 15.0 | 16.2 | plan-design-review with an agent user at a tenth of Opus's price |
| 84 x 4 | 13.8 | 15.0 | plan-eng-review and autoplan if a session cost 2.5 times a Verified one (v2's central) |

Family U's primary (completion over 3 scenarios) and X's (the mean of 2 docs-only runs) are finer than one binary result per trial, so the table is conservative for them. Each prereg re-simulates from admission's measured spreads, with a repository random effect, and prints the MDD at an intraclass correlation of 0, 0.05 and 0.10, because 12 slice tasks can't estimate it. Secondaries carry their own MDDs at the prereg.

**What these MDDs can decide.** An MDD of 16 to 19 points can show a large win or a loss. Gate 1's eng review (d23) found that an equivalence reading within plus or minus 10 points reached 83% power at a true zero and 46% at a true 5 points at 120 x 4, so v3 makes no "no effect" claim. A non-significant result doesn't rule out a gain the size of the MDD either, because its 95% interval can reach about 1.4 times the MDD. A gain is ruled out only above the upper bound of told minus none's 95% interval. In G, whose primary is the same pass-or-fail solve the cost figure counts, R48 also weighs that bound against the skill's break-even gain from section 8; U and X read cost from the ratio's interval alone (section 9). v3 freezes 20 points as the largest MDD worth buying (round 2's eng F4): past it only a very large win shows. Every re-size checks that bound before the next stage spends.

### 8. Price per skill and program

**Metered anchors** (2026-11-03):

| Source | What ran | Opus 5.5 | GPT-6.1 Sol | particle-1 |
|---|---|---|---|---|
| R3a screen (GEVA-230, GEVA-231) | SWE-bench Verified, none, per session | $0.191 (91 sessions) | $0.254 (91) | |
| R3a pilot | told /investigate, per session; its steps ran in 2 of 10 | $0.424 (10) | $0.691 (10) | |
| E0 (#181) | plan-review session, plain none, median 4 turns | $0.236 | | $0.019 |
| R3 amendment 4 | the house central price of a real task | 5 times a Verified session | | |
| Quick look 3 | particle-1 against Opus, per session | | | 0.41 of Opus |
| TS (GEVA-173) | real-outcome slice: $7.93 of author and auditor calls and $1.78 of VM for 7 valid tasks; its crew thread used about 43,500 credits before its /ship tail | $1.39 paid per valid task; about $6.20 of crew per valid task | | |
| R3a VMs | Ubicloud VM time | $0.60 an hour | | |
| This plan's threads | crew model use | about $0.50 per million tokens (51,829 credits for 104.2M tokens) | | |

**Prices v3 assumes** (house central; admission meters them and the prereg re-sizes):

- A real feature task's none session costs 5 times a Verified session, R3 amendment 4's central: $0.96 on Opus. v2 used 2.5 times, and section 7 shows what that would buy.
- Told costs a multiple of none: plan-eng-review 2.2, plan-design-review and plan-devex-review 2.4, devex-review 2.5, design-review 3.0 (a browser audit and fix loop) and autoplan 5.0 (four review phases). These rest on sessions where the steps mostly didn't run: R3a's told session ran them in 2 of 10, and E0's session was plain none. So a forced session, or a told session whose steps run, is priced at 1.15 times told as its central and 1.5 times as its risk case. The stand-in costs 1.25.
- particle-1 costs 0.41 of Opus per session (quick look 3). E0's 0.08 came from a one-turn plan review.
- Measurement per tree: mutation $0.05 of VM time; the agent user on Opus with screenshots, 3 scenarios, $1.20; the docs-only agent, 2 runs, $0.40. VM time $0.02 a session.
- Authoring per valid task: the paid author and audit spend (G $1.39 from TS; U and X $2.78, with scenarios or goals and checkers on top), plus a crew line of $1.20 a valid task for mining, building, checking and sealing. The crew line is a fifth of TS's thread rate, on the bet that bulk mining reuses the slice's tooling. Each family's thin-slice thread measures it, and admission re-sizes from that. In-band yield after screening: G 30%, U and X 40%.
- Crew model use per family: $100 as its third of the shared rig (arm registry, scorer extension, dry run), its own build ($150 for G and X, $200 for U), and $70 for its prereg, run and results threads, which covers two preregs (admission and confirmatory).
- A family's shared costs (crew, authoring, screening, calibration, and the none arm on tasks both skills use) split evenly between its two skills.

**Wave 1, per skill** (house central; each skill's cap is $2,000 and the program envelope is $10,000):

| Order | Skill | Family | Arms and models | Tasks x trials | Opus MDD, told minus none | MDD at 2.5 times (v2's central) | Break-even gain at a 50% solve rate | Planned | Cap |
|---|---|---|---|---|---|---|---|---|---|
| 1 | plan-eng-review | G | Opus none and told | 60 x 3 | 18.6 | 13.8 | +23 | $1,213 | $2,000 |
| 2 | plan-devex-review | X | Opus none and told | 78 x 3 | 15.6 | 12.6 | +30 | $1,593 | $2,000 |
| 3 | autoplan | G | Opus none and told | 54 x 3, inside plan-eng-review's panel | 19.2 | 13.8 | out of reach | $1,652 | $2,000 |
| 4 | devex-review | X | Opus none and told | 78 x 3, the same panel | 15.6 | 13.2 | +33 | $1,617 | $2,000 |
| 5 | plan-design-review | U | Opus none and told | 60 x 3 | 18.6 | 15.6 | +30 | $1,657 | $2,000 |
| 6 | design-review | U | Opus none and told | 54 x 3, inside plan-design-review's panel | 19.2 | 15.6 | +50 | $1,661 | $2,000 |
| | **Wave 1** | | | | | | | **$9,393** | **envelope $10,000** |

One line per skill, planned dollars (authoring includes the crew line; parts are rounded):

- plan-eng-review: crew 160, authoring 275, screening 221, admission 64, Opus confirmatory 492 (none share 101, told 391), reserve 787.
- plan-devex-review: crew 160, authoring 412, screening 134, calibration 10, admission 81, Opus confirmatory 796 (none share 161, told 635), reserve 407.
- autoplan: crew 160, authoring 275, screening 221, admission 128, Opus confirmatory 868 (none share 83, told 785), reserve 348.
- devex-review: crew 160, authoring 412, screening 134, calibration 10, admission 83, Opus confirmatory 818 (none share 161, told 657), reserve 383.
- plan-design-review: crew 185, authoring 322, screening 163, calibration 29, admission 110, Opus confirmatory 847 (none share 215, told 632), reserve 343.
- design-review: crew 185, authoring 322, screening 163, calibration 29, admission 124, Opus confirmatory 838 (none share 176, told 662), reserve 339.

plan-eng-review plans well under its cap because autoplan shares its panel: a larger G panel would push autoplan past its plan.

**Stand-in and particle-1 rows.** Under the 2-point rule they fit only on plan-eng-review at house prices. Adding both there would raise plan-eng-review's told minus none MDD to 20.4, past the 20-point bound. The stand-in alone fits: plan-eng-review at 54 x 4 with an MDD of 19.2 (Holm, alpha 0.025), autoplan at 42 x 4 with 19.8, wave 1 at $9,713 and $287 of the envelope unplanned (cost.py's chosen design, stand-in first; boundcheck.py checks the bound both ways). Wave 1's plan still has neither row. Before any spend on either row, the G prereg rechecks the 2-point fit at admission's metered prices and particle-1's metered ratio, stand-in first, and adds a row only if it also stays under the bound and inside the envelope.

**The cost-per-solved guard.** The guard binds every told skill, in #169's form: the upper bound of the 95% interval of told's cost per solved task over none's must be at most 1.5 (#169's G3 definition, which O4 reuses). The break-even gain is the gain at which told's cost per solved task equals 1.5 times none's: p times (m / 1.5 minus 1), with p the control rate and m told's session multiple. At p = 0.5 that is the column above. For U and X the gain is on the pass-or-fail solve the cost figure counts (section 3), not on the fractional primary, so it is a planning figure and is never compared with the primary's interval. design-review breaks even only if told solves every task, and autoplan would need 117 points, so autoplan can't pass the guard at its central price whatever its gain. At the forced price (1.15 times told) the gains rise to +34 for plan-eng-review, +42 for plan-devex-review and plan-design-review and +46 for devex-review, and design-review and autoplan can't reach theirs. Section 9 turns the ratio into a verdict. Whether 1.5 times on hidden-test solves is the right bar for a told skill goes to the project owner before G admission (section 16).

**What each MDD can decide.**

- plan-eng-review, plan-devex-review and devex-review (15.6 to 18.6 points): a win or a loss of that size shows. A null rules out only gains above the upper bound of its 95% interval. For plan-eng-review, whose primary is the pass-or-fail solve, a null whose bound sits under the break-even gain shows that no gain the data allow pays for the extra cost, and R48 reads CUT-CANDIDATE; with an 18.6-point MDD that happens when the estimate lands well under the MDD. For the X skills, whose primary is fractional, the cost reading comes from the ratio's interval alone (section 9). plan-eng-review's and plan-devex-review's rows settle GST-1218 only on a told arm on the named after pin (decision 3).
- autoplan (19.2 points): a win of that size shows, but the guard can't pass at its central price, so a KEEP needs a metered told multiple far under 5.0. Every autoplan verdict names the told configuration O1 froze.
- plan-design-review and design-review (18.6 and 19.2 points): a null at that size can't move a design skill to a cut. So U's confirmatory waits: it runs only once an agent user cheaper than Opus passes the same calibration and the re-sized MDD is at most 13 points. At house prices an agent user at a tenth of Opus's price ($0.12 a tree) buys 90 and 78 tasks x 3 and MDDs of 15.0 and 15.6, so on today's prices U stops after admission with its price, exposure and calibration readings as FIX-METHOD, and most of its $3,318 plan stays unspent. A branch design (told continues from the none arm's own built tree, so build noise cancels) could lower design-review's spread; admission measures it, and U's prereg uses it if its MDD comes out lower.

**The arm that will run: forced or exposed told.** A fair verdict needs told exposure of 80% or more, so a told arm that reads is mostly exposed sessions, and those price like forced. The forced row is therefore the likely confirmatory price. Same caps and rules, re-sized inside each plan (tasks x trials, MDD):

| Price | plan-eng-review | plan-devex-review | autoplan | devex-review | plan-design-review | design-review | Wave 1 |
|---|---|---|---|---|---|---|---|
| told at its multiple (the plan) | 60 x 3, 18.6 | 78 x 3, 15.6 | 54 x 3, 19.2 | 78 x 3, 15.6 | 60 x 3, 18.6 | 54 x 3, 19.2 | $9,393 |
| forced or exposed told, 1.15 times told | 42 x 4, 19.8 | 78 x 3, 15.6 | 42 x 4, 19.8 | 72 x 3, 16.8 | 54 x 3, 19.2 | 54 x 3, 19.2 | $9,368 |
| forced or exposed told, 1.5 times told | 42 x 3, 22.2 | 66 x 3, 17.4 | 42 x 3, 22.2 | 66 x 3, 17.4 | 42 x 4, 19.8 | 36 x 4, 21.0 | $9,426 |

At 1.15 times every row stays under the bound. At 1.5 times G's two rows and design-review pass it and would stop at their projection check. Admission meters exposed and unexposed told sessions apart, and the prereg sizes from the arm that will run.

**Price stress.** Same caps and rules (Opus MDD, told minus none, after the re-size):

| Case | plan-eng-review | plan-devex-review | autoplan | devex-review | plan-design-review | design-review |
|---|---|---|---|---|---|---|
| house central, 5 times a Verified session | 18.6 | 15.6 | 19.2 | 15.6 | 18.6 | 19.2 |
| high, 10 times | 22.2 | 20.4 | 28.8 | 20.4 | 24.0 | 24.0 |
| high, 10 times, told multiples at 1.5 times, agent user at 2 times | 31.2 | 23.4 | 34.8 | 23.4 | 31.2 | 31.2 |
| house central, crew line at TS's full rate ($6.20 a valid task) | 21.0 | 18.6 | 21.0 | 18.6 | 21.0 | 21.0 |

At 10 times no row stays under the bound, so every skill would stop at its projection check after admission and spend nothing on bulk work. With the crew line at TS's full rate, only X stays under it.

**One survivor per family.** When one skill of a family stops at admission or at its futility look, the survivor pays every shared cost not yet spent: bulk authoring, screening, the whole none arm and the prereg thread. The re-size rule is d7's fixed order, with no search: drop the particle-1 row first, then trials, then tasks, one step at a time, until the survivor fits its plan (survivor.py). Its plan is the $1,700 line every design in this section is sized to, which keeps at least $300 of each skill's $2,000 as reserve. Wave 1's plan has no particle-1 row, so trials go first. A survivor whose MDD passes the 20-point bound stops as FIX-METHOD (price). That includes plan-eng-review at house prices: alone at 60 x 3 it costs $1,804, over the $1,700 line, so it re-sizes to 60 x 2 with an MDD of 21.6. So if autoplan fails admission, plan-eng-review stops as a lone survivor, and the project owner's keep-until-read decision on it (GST-1218) stays open until a later wave.

| Skill | Planned with both | Alone at that size | Re-size alone | MDD | Re-size's price |
|---|---|---|---|---|---|
| plan-eng-review | 60 x 3, $1,213 | $1,804 | 60 x 2 | 21.6, stops | $1,612 |
| autoplan | 54 x 3, $1,652 | $2,147 | 48 x 2 | 24.6, stops | $1,664 |
| plan-devex-review | 78 x 3, $1,593 | $2,316 | 60 x 2 | 21.6, stops | $1,609 |
| devex-review | 78 x 3, $1,617 | $2,341 | 60 x 2 | 21.6, stops | $1,623 |
| plan-design-review | 60 x 3, $1,657 | $2,345 | 48 x 2 | 24.6, stops | $1,683 |
| design-review | 54 x 3, $1,661 | $2,257 | 42 x 2 | 26.4, stops | $1,584 |

At house prices every lone survivor passes the bound. So when one skill of a family stops, the other stops too, as FIX-METHOD (price), before its next stage spends. At the forced price only plan-eng-review's survivor stays under it (42 x 4, 19.8; sizing.txt).

**The program envelope.** The project owner capped the program at $10,000 and each skill at $2,000. The envelope counts every dollar the program settles, this plan's own threads included (about $52 so far, plus its /ship). Before any paid stage starts, the ledger admits and reserves it in one atomic step: settled program spend, plus every open reservation, plus the new stage's projected cost must stay at or under $10,000, or the stage doesn't start. A reservation is reconciled when its stage settles: the metered amount moves to settled spend and the rest is released. No paid call runs without a reservation that covers it, so two stages admitted at the same moment can't both pass the cap (build step O6, section 13). Wave 1 plans $9,393 at house prices, which leaves $607 unplanned before this plan's own use. The six caps add up to $12,000, so if prices run high and skills spend into their reserves, the envelope binds before any skill's cap does. It trims the skill latest in wave 1's order that still has stages to run: design-review first, then plan-design-review, devex-review, autoplan, plan-devex-review and plan-eng-review.

Waves 2 and 3 leave this program. They come back only with wave 1's results, in a new plan priced from wave 1's metered means.

**Approvals.** No thread passes $5,000, because a family thread holds at most two skills ($4,000). The project owner's caps are the approved limits: $10,000 for the program and $2,000 for each skill. Each prereg's cap inside its skill's ceiling and the envelope is the Captain's call under R42, and any cap above them goes back to the project owner. Each paid item still needs its merged prereg, a ledger approval row and its admission. The sizing scripts (cost.py, survivor.py and emit.py, run by sizing.sh) and their printed lines (sizing.txt) are attached.

### 9. The R48 and R61 path per skill

Every null or negative verdict gets one Why-null cycle with four checks, named per skill in the prereg: exposure (did the told steps run), task fit (share of tasks where the skill applies), power and floor or ceiling (control rate and MDD), and frontier without it (does plain Opus already do the thing: write tests, open the UI, write docs, plan first). It ends in KEEP, FIX-METHOD or CUT-CANDIDATE, and a CUT-CANDIDATE goes to the Captain and to Garry plainly, in R41 format, with the evidence.

| Skill | Exposure null | Saturation null: R61's one ceiling raise, after a headroom check on 40 tasks x 3 none trials | Task-fit null | Idea-only result (told = stand-in > none), only where a stand-in runs | Loss |
|---|---|---|---|---|---|
| autoplan | FIX-METHOD: after pin, or the forced line | the strict stratum (merged on or after 2026-10-01), features of 3 or more source files and 200 or more lines, the K1 subset | FIX-METHOD: the large-feature stratum | procedure CUT-CANDIDATE; diet candidate to the stand-in's size, verified by the before/after skill eval | CUT-CANDIDATE, with cost per solved task |
| plan-eng-review | as autoplan | as autoplan | as autoplan | as autoplan | as autoplan |
| plan-design-review | as autoplan | a scanning agent user: screenshot only (no accessibility text), a 15-step cap | FIX-METHOD: tasks that add a screen, not only change one | as autoplan | as autoplan |
| design-review | FIX-METHOD: no browser session counts as unexposed | as plan-design-review | as plan-design-review | as autoplan | as autoplan |
| plan-devex-review | as autoplan | goals that need two documented steps (install and configure, then use) and a 10-turn cap | FIX-METHOD: features that add a command, flag or exported API | as autoplan | as autoplan |
| devex-review | FIX-METHOD: no timed first run counts as unexposed | as plan-devex-review | as plan-devex-review | as autoplan | as autoplan |
| ship | the lane's | the lane's | the lane's | the stand-in is the lane's plain-loop arm | the lane's cut rule |

R61 is one attempt. If the raised version still shows no headroom, or headroom and no gain, the CUT-CANDIDATE goes to Garry with that evidence; if the attempt fails on harness limits or broken tasks, the verdict is FIX-METHOD. A later program's preregs follow the same table.

Under the ceiling, a skill that fails admission's headroom check stops and spends nothing more. R61's one ceiling raise then goes to the Captain as a proposal with its own price and approval; it isn't paid from the skill's unspent ceiling.

**Cost per solved task.** O4 computes told's cost per solved task over none's, with a task-clustered bootstrap 95% interval, by #169's G3 definition (section 8). With told minus none, R48 reads:

- helps, and the ratio's upper bound at most 1.5: KEEP;
- helps, and the ratio's interval spans 1.5: FIX-METHOD (cost unsettled), with the ratio and its interval;
- helps, and the ratio's lower bound above 1.5: CUT-CANDIDATE on cost, which goes to the diet track (cut the lines that cost without helping, verified by the before/after skill eval);
- not distinguished, and the ratio's lower bound above 1.5: CUT-CANDIDATE on cost, because told costs more than 1.5 times none per solved task with no gain shown;
- in G only, where the primary and the cost figure count the same pass-or-fail solve: not distinguished, and the upper bound of told minus none under the skill's break-even gain: CUT-CANDIDATE, because no gain the data allow pays for the extra cost. U and X never compare their fractional primary with a pass-or-fail break-even, so their cost readings come from the ratio's interval alone;
- not distinguished otherwise: the Why-null cycle above, with the MDD and the interval;
- hurts: CUT-CANDIDATE.

These cost readings print as provisional until the project owner answers whether 1.5 times is the bar for a told skill (section 16). Every autoplan verdict names the told configuration O1 froze.

**Loss leads.** A futility stop whose interim estimate favors none is a loss lead, not a plain null. It goes to the Captain with the estimate, its interval and the exposure rate, and R48 checks it for a loss before reading it as not distinguished.

### 10. $0 probes run before review

All four ran on 2026-11-02 on fresh Capy machines: public-read network only, no model call, no key read, nothing committed. Their scripts and outputs are attached as probes.md.

**Mutation-tool fit (yes for all four languages).** Each tool installed from a public registry, then ran under `docker run --network none` on one real post-cutoff commit and finished in under 70 seconds on 2 CPUs.

| Language | Tool, version, licence | Restriction to the diff | Mutants, killed, survived | Machine-readable output | Runs a chosen test subset |
|---|---|---|---|---|---|
| Rust | cargo-mutants 27.1.0, MIT | changed lines (`--in-diff`) | 28, 26, 1 (1 unviable) | yes (outcomes.json) | yes per its docs (test filters after `--`), not run |
| TypeScript | StrykerJS 10.1.1 with the vitest runner, Apache-2.0 | changed lines (`--mutate file:start-end` from `git diff -U0`) | 4, 4, 0 on the commit; 69, 53, 12 on a whole-file subset run with only the commit's test files | yes (mutation-testing-report-schema) | yes, shown |
| Python | mutmut 3.8.1, BSD-3-Clause | function level only (mutant-name globs); no line option | 87, 81, 6 | yes (export-cicd-stats) | yes, by test file |
| Go | go-mutesting (avito-tech fork), MIT; gremlins 0.6.0, Apache-2.0 | go-mutesting: file level; gremlins: changed lines but 1 mutant on 5 lines, with a verdict that flipped between killed and timed out | go-mutesting 24, 15, 9 | go-mutesting text only; gremlins JSON | go-mutesting via `--exec` |

So the mutation scorer pins cargo-mutants and StrykerJS at line level, mutmut at function level (the harness maps diff hunks to enclosing functions), and go-mutesting at file level with its score line parsed; gremlins is rejected for flaky timeouts. The scorer records the restriction level per language, and mutation scores are compared only within a language. Container rules from the probe: caches outside the repo, `GOPROXY=off` and `GOTOOLCHAIN=local` for Go, mutmut pointed at the package directory, tools prebuilt into the image, runs as a non-root user.

**Browser agent-user driver (feasible, with one fix).** Playwright 1.64.1 (Apache-2.0) drove TodoMVC (MIT) in headless Chromium with outside network blocked two ways (a route that aborts non-localhost requests, and a dead proxy), both shown by test. A 110-line driver logged one JSON line per step (action, target, result, URLs, a state hash of the accessibility snapshot, console errors, a dead-end flag). On a degraded copy (input label removed, one button hidden), a fixed scripted policy took 10 actions with 3 errors instead of 7 with 0, and failed the clear-completed scenario with a dead end where the normal UI passed. The probe found that hover-only elements change the state hash, so the driver moves the mouse away before each observation. An observation costs about 1,475 tokens with a screenshot (about 245 as text only), an estimate from character counts and Anthropic's published image rule, not a model count; real apps will be larger. The instrument needs nothing from gstack. Not shown: the driver inside a no-network container, and any LLM agent user's behavior.

**Docs-only harness (feasible).** For junegunn/fzf (MIT), a feature commit from 2026-11-02 that added user-facing --bind actions was built at the commit and at its parent. A container with `--network none`, read-only, holding only the static binary plus README, CHANGELOG, the man page and the --help text (no .go or go.mod file on the filesystem) ran a scripted check: first success at the feature commit, a clean failure ("unknown action") at the parent. The feature was documented in the CHANGELOG and man page, not the README, so the docs bundle must include every doc file the repository ships. Not shown: a fresh agent working from the docs.

**Pool yield: future bugs, follow-ups, UI and DX (git only, 16 of 18 permissive repositories scanned; Ghost and biome stopped for the token cap).** Feature change: a first-parent commit merged 2026-07-01 to 2026-10-31 touching source and tests, not a fix, revert, chore, docs, bump, release or deps commit.

| | Count |
|---|---|
| Commits in the window | 6,633 |
| Feature changes | 1,140 |
| ... later touched by a fix whose changed lines blame back to them (raw SZZ) | 105 (9.2%) |
| ... with a loose follow-up (a later non-fix commit touching a shared source file and a test within 60 days) | 947 (83%), median 2.1 days |
| UI-tagged feature changes | 230 (55 with an SZZ link), nearly all from 4 repositories |
| DX-tagged feature changes | 145 (29 with an SZZ link), led by 4 repositories |
| Repositories with a browser e2e config at HEAD | 4 of 16 |

Three readings. First, future bugs are scarce: 105 raw links times the thin slice's 3.8% execution yield projects about 0.25 usable pairs per repository per four months, so a 40-repository family panel holds about 10. That is why section 3 keeps future bugs a secondary. Second, the loose follow-up rule links most features and mostly measures churn, so the plan uses a blame-linked follow-up (section 3); a later program's follow-up runner measures its yield on the thin slices' pool first. Third, UI and developer-facing work is concentrated: at the lane's 3 tasks per repository, family U needs about 40 web apps with active UI work, and this sample had 4. So U's scenarios and checkers are ours, not mined e2e tests; U's mining covers at least 60 permissive web-app repositories; and U and X panels may hold up to 8 tasks per repository, with the repository-clustered reading as the decision analysis and its MDD stated in the prereg.

### 11. Outside terms, for every reviewer to check

R65 asks one question of every plan: are any outside terms, licences or rights involved? Yes, in four places. What this plan does about each, and what is not yet verified:

- **Task repositories.** Only MIT, Apache-2.0 and BSD repositories, with the SPDX id read from the LICENSE file at the base commit and recorded (V8). Copyleft (GPL, AGPL, MPL) is excluded to keep one rule, though running such code locally for evaluation is generally allowed. Statements are rewritten in our words; no issue text, code or test is published, only counts and digests. Attribution goes in the results post. Not verified: whether any task repository's contributor terms or trademark policy limit naming it in a results post; the prereg checks each named repository.
- **Tools and benchmarks.** Lane pieces as the lane records them (SWE-rebench V2 pipeline MIT, Repo2RLEnv Apache-2.0). Playwright 1.64.1, Apache-2.0, with Chrome Headless Shell (Chromium's BSD-style licence and its bundled third-party notices). The mutation tools' licences are in section 10. gstack is MIT. Claude Code is proprietary software under Anthropic's terms, and Sol and particle-1 run inside it through OpenRouter's Anthropic-compatible endpoint; whether Anthropic's terms allow Claude Code to drive non-Anthropic models through a gateway is not verified here, and the first prereg that runs Sol or particle-1 must cite the clause (the #169 review raised the same gap).
- **Model APIs.** Anthropic's commercial terms and usage policy, OpenAI's services agreement and usage policies, OpenRouter's terms and each OpenRouter provider's terms for particle-1. We train no model on outputs. Not verified here: each provider's terms on publishing comparative results, and particle-1's own model licence. Sealed task bodies would pass through OpenRouter providers, so every OpenRouter call must carry a data-collection deny (the rig's proxy sets it; the #169 review found quick/laneb on main does not), fixed before any sealed body is sent.
- **Public posts.** Results posts follow the findings standard with disclosures at the end; posting is Garry's. Repositories are named only after the prereg's terms check.

### 12. Custody and public safety

- Each family's panel follows the lane's and panel v3's custody: statements, commit ids, gold changes, hidden tests, scenario checkers, docs-only goals, oracle summaries and degraded fixtures stay in age-encrypted bundles in the Captain drive, with CUSTODY.md, decryption only into /dev/shm, a leftover check on every wake, and plaintext deleted and checked with test ! -e. The repo gets counts by family and kind and digests only, never a per-unit row.
- Stand-in lines, forced lines and exposure detectors are arm definitions, not held-out material: they are public and pinned by sha256 in the prereg.
- Who must not open a panel: the gstack Captain's crew, any thread building a gstack candidate under test, and authors and auditors after sealing. The overhaul's after pin must be named before any of its builders could see a panel.
- Repo text quotes nobody verbatim, names no private project, and names Captains by role.

### 13. Build sequence, reuse and the line with other lanes

Each code step is a small PR through the Captain's queue with a /ship receipt. The arm registry, instruments and scorer extension decide scored outcomes, so they are scorer class under R65 and need a full /ship. Their token caps come from section 8's crew lines at about $0.50 per million tokens (G's $150 build is about 300M tokens across its threads). A build that can't fit its line returns to the Captain before it starts.

1. **This plan** merges as a wiki post after the gate (one PR, a light docs /ship).
2. **O1, arm registry and exposure detectors** (lanes/outcome-skills/arms/): turn scripts per skill and arm, the three-turn plan protocol, stand-in and forced lines pinned by sha256, the clean-room preflight reused from panel v3's C1, and one exposure detector per wave-1 skill with keyless fixtures for exposed and unexposed transcripts. O1 also freezes autoplan's told invocation per pin: the kind, the phases its scope chooses, the outside voice and its model, the gate answer and the exact slash line (section 4).
3. **O2, mutation scorer**, with the pinned tool per language from section 10 and the scoring rules in section 3, tested against the real pinned tools on fixture repositories. The follow-up runner waits for a later program.
4. **O4, scorer extension**: contrasts with the repository-clustered decision test, admission, the two-sided futility look, the cost-per-solved guard by #169's G3 definition, the projection check, the one-survivor re-size, the R48 table and the power re-simulation, on src/runner/stats.
5. **O6, program envelope** in the lane's ledger: one atomic admit-and-reserve step per paid stage against settled program spend plus every open reservation plus the new stage, reconciliation at settlement, and a refusal for any paid call without a covering reservation. Its keyless test admits two stages at the same moment near $10,000 ($8,000 settled and two $1,200 stages) and passes only if exactly one is admitted. It gates spend, so it is money class under R51 and needs a full /ship, and it merges before any paid stage, G admission included.
6. **G**: thin slice T-G, the keyless dry run O5 with one ledger lease opened and settled per frozen item on a temporary ledger and both futility cases driven (an interim estimate trending to helps and one trending to hurts), then admission for plan-eng-review and autoplan.
7. **X**: O3a, the docs-only harness, with a per-command timeout and an authoring rule that admits only goals an agent can finish non-interactively, which X's admission checks (a blocking task, uc2); thin slice T-X; dry run; admission for plan-devex-review and devex-review.
8. **U**: O3b, the agent user, from the browser probe's driver (step log, state hashes with the hover rule, scenario checkers, the network block inside a no-network container). It is built vision-first, acting from screenshots at more than one viewport, and its degraded fixture adds visual defects (hierarchy, spacing, a broken mobile layout) to the accessibility and function defects, so design-review's and plan-design-review's fixes can reach the instrument. U's admission calibration tests that (a blocking task, uc1), for Opus's agent user and for a cheaper one. Then thin slice T-U, dry run, and admission for plan-design-review and design-review.
9. **Per admitted skill**: bulk mining, authoring and screening, then the family's confirmatory prereg (its cap from the Captain inside the ceiling and the envelope), the run and a results post with R48 sections. U's confirmatory waits for the cheaper agent user (section 8).

Target dates, which move with yield and not with spend: plan merged 2026-11-05; O1, O2 and O4 by 2026-11-10; G admission 2026-11-11; X admission 2026-11-14; U admission 2026-11-18; first confirmatory prereg (G) 2026-11-17.

**Lines with other work.**

| Work | Owns | This plan |
|---|---|---|
| Real-world outcome lane (GST-817) | the rig, mining, custody, family S and its R1 | reuses everything; adds arms to S only through the Captain's lane amendments (section 4), priced in the lane's plan and outside this program's envelope |
| Panel v3 (GST-1048) | plan-review recall on seeded plans | its headroom read saturated (#191); no seeded-flaw panel runs here |
| Overhaul before and after (GST-1088, GST-1089, #169) | discovery, adherence, and the /investigate and /review outcomes, on the before and after pins | shares the pins; its after pin is this plan's confirmatory told pin; no duplicate cells |
| R3 (investigate), I1 (preamble), R2 rerun (review) | those parts | a later program reads investigate and review only after they report |
| GST-1218 (plan-review cut candidates) | the keep-or-cut call on plan-eng-review and plan-devex-review | wave 1 tests those two first and reports there; their rows settle the call only on a told arm on the named after pin (decision 3) |

### 14. Risks

- **UI and developer-tool yield.** Families G, U and X need about 212, 162 and 207 valid tasks (section 8's sizes over their in-band yields, plus the slice), about 580 in all. The mining probe found UI work concentrated in 4 of 16 repositories, so U and X allow up to 8 tasks per repository, across at least 20 repositories, with the repository-clustered test deciding, and U mines at least 60 web-app repositories. If a family still falls short, it runs at the size it reaches if its MDD stays under the 20-point bound, and its prereg states that MDD, or it returns to the Captain with the cost of a second mining wave.
- **A frontier agent user navigates anything.** The instrument check in admission catches it; R61's scanning agent user is the one raise.
- **Docs-only saturation.** A fresh agent may succeed from --help or type files alone. The base-tree check in admission catches it.
- **Autoplan's cost and wall time on real repositories are unmeasured.** Admission meters them; limits are frozen from its p95.
- **Before-pin exposure near zero.** Decision 3 handles it; the forced arm gives the skill's effect when its steps run, and section 8 prices it at 1.15 times told.
- **Sol is out of wave 1 on price** (section 4). Its route check stays for a later program, and Sol is never replaced by another model.
- **The stand-in line could itself be a strong or a broken prompt.** It is drafted from the skill's one-line description and public practice, reviewed here, and frozen; its own effect is the secondary stand-in minus none.
- **The oracle user can leak the answer** in G-v tasks. The auditor's leak check and the two-sentence rule bound it; a later program's prereg attacks it again.
- **Contamination.** Post-cutoff dates, a strict stratum after 2026-10-01, and band screening, as the lane does.
- **Cost.** v3 prices at the house central (5 times a Verified session), and real feature sessions may still cost more. Admission meters them and the projection check re-sizes before each stage. At 10 times, no skill's re-size stays under the 20-point bound, so every skill would stop after admission (section 8). If skills spend into their reserves, the program envelope binds first and trims design-review first. A cap stop ends the skill incomplete.

### 15. Not in scope

Building anything, spending money, changing gstack, changing another lane's plan without the Captain, any claim about gstack in general, other harnesses (Codex host rows wait for the HARN-13 adapters), and the 32 skills section 5 lists as not outcome-testable here. This program also leaves out waves 2 and 3, which come back only with wave 1's results. Wave 1 leaves out Sol, the plan-first arm, the follow-up change runs and the U judges, and its plan leaves out the stand-in and particle-1 rows (section 8).

### 16. Needs

- The project owner's answer, through the Captain and before G admission, on whether 1.5 times none's cost per solved task on hidden-test solves is the bar for a told skill (section 8).
- At G admission, if the after pin isn't named: the Captain's choice between waiting for it and reading plan-eng-review's and plan-devex-review's forced lines as information for GST-1218 (decision 3).
- Captain decisions on the lane amendments in section 4, and on whether the project owner's ceiling also binds the lane's ship test.
- Build owners and token caps for O1 to O5 and the thin slices, sized to section 8's crew lines; each prereg's cap inside its skill's ceiling and the program envelope from the Captain.
- No new credentials: the Anthropic, OpenAI and OpenRouter keys are on the rig, and Ubicloud is in use.

## Review record

The run's review record is export/review-record.md. Its findings, tasks, decisions and gate are export/findings.jsonl, export/tasks.jsonl, export/decisions.jsonl and export/gate.json.

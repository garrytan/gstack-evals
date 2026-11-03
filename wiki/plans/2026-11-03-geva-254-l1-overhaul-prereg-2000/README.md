---
id: 2026-11-03-geva-254-l1-overhaul-prereg-2000
kind: plan
title: "Preregistration, superseding #169: gstack's overhaul before and after on Opus 5.5 at $2,000 all-in, with behavior primaries on a fresh SWE-rebench draw"
summary: "Supersedes #169 under the $2,000 ceiling: Opus 5.5, before 82db89a, after 699a41c and no gstack on 80 fresh SWE-rebench tasks; discovery and adherence primaries; outcome descriptive."
author: GEVA-254
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-03
status: open
supersedes:
  - 2026-11-02-geva-214-gstack-overhaul-before-after-prereg
links:
  - 2026-11-02-geva-214-gstack-overhaul-before-after-prereg
  - 2026-11-03-geva-247-r3-amendment-4
  - 2026-11-01-geva-125-untold-discovery-prereg
  - quick/laneb
source: "Plan written by GEVA-254 through gstack /autoplan run autoplan-20261103210346 (lean: one Opus 5.5 reviewer, one round); gate_rev 1 answered rec. Issue GST-1155. The Implementation plan section is the approved text."
attachments:
  - 6912a3adc3511115d92887422fd3d91e478db90ad57d658e5e3876fa587f537a  draw.py
  - 8b2c3774b7f301f5227e1d3e573fbc3e180ed8eb3771f4703e0945cdd216376a  draw.txt
  - 5ad97d8f64189819d0893befe644e4b6173919255beee501f59810052ce8d5a5  eligible.txt
  - 507e4a070b8c2ad6f4e4aec99a626e0f3e06b91b9ad5219e5de08249d73eb98b  f-parts.txt
  - b14dd044e4dfba0b217bb267566753585fcffdc05b42dc93d95887d192d3f4ee  f-tasks.txt
  - 55fad2799805fe144c8a8f7765f022d94880e34cf2d5ac736c4f64fd60b59f3f  install-manifest.md
  - bd2b8dec60d6fd5430329522fd3555338ca146ef1bacc222cdbbbc467141a09f  install-pin.sh
  - e9729b22085dd702811b2f556e727be30484d56f5f57eb4691ab4c24005df49e  manifest.py
  - fa85bf9cc38a3455a6436f2ec29262ba457a71d7e91e46cc4aedbe4a69ff9381  pilot-tasks.txt
  - 1398c659220c657dd2aebd4325fe175db1e458a3cbcc0aa31d5f08dac2c5ba56  power.py
  - 45585faa827b9b780e1782f66319989cc18fb04e3a9e35f54c806a56eb0c4f9e  power.txt
  - 90d05f6e64d3150ab537add31035be25bc0c43ad7e969eee55695c2c9035f29a  price.py
  - b04fcf023f71ffdfc2aa4e355293bf182cc9d05112b7cb70619ed6c9ecadc3fc  price.txt
  - 17fcf1e9efc0b28f4fe14a6c169779b3b23ddc996cf30b543c621b59192c1c12  screen.txt
---

# Preregistration, superseding #169: gstack's overhaul before and after on Opus 5.5 at $2,000 all-in

GEVA-254, issue GST-1155, Captain GEVA-2. Plan only: no paid call happens here.

## Approval

Gate 1 of /autoplan run autoplan-20261103210346 (gate_rev 1, rec_hash 2b022fb39823) was answered `rec` by the Captain (GSTA-2) on 2026-11-03, under the owner's rule of $2,000 all-in per eval line. That takes d1a (keep the frozen model order), d2a (decide F2 now from data in hand, and do not buy it), d3a, d4a and p1b, and the outside-terms item (SWE-rebench's CC-BY attribution goes in the results post). This post approves no spend. Each launch still needs its cap recorded in approvals/, Amendment C merged and a passing ceiling check.

## ELI5

gstack's maintainers rebuilt gstack so models actually run its recipes, and they froze the rebuilt version at one commit. We already wrote down how to judge the rebuild (#169), but that plan cost about $8,000, and every eval line now gets at most $2,000, counting our own agents' time. So this plan judges the rebuild more cheaply.

We run the old gstack, the new gstack and no gstack side by side on Opus 5.5, on 80 bug-fix tasks the new gstack was never tuned on. We judge two things: does Opus open the bug-fixing recipe without being told, and does it finish the recipe's steps when told. We also print how often each arm's fixes pass, but 80 tasks can only show a very large change in that number, so it carries no verdict. GPT-6.1 Sol runs only if money is left, and particle-1 almost surely won't fit. A loss is reported as a loss.

## Before → after

- **Before:** #169 freezes a $7,969 plan (item caps $19,950) on three models, with a sealed held-out set nobody has authored and six build units nobody has built. No paid item can run under it now.
- **After:** one plan that fits $2,000 all-in at caps ($1,410 at caps, $904 expected, crew time included), pins both gstack commits with their lite loadout digests and install manifests, and states which of #169's primaries run, which drop, and the MDD each one has or would have had.

## Why it matters

The overhaul's stated goal is that frontier models open and follow gstack's skills. A measured answer steers what gstack keeps, cuts or tries next, and it has to come from tasks the overhaul was not tuned on. The router's threshold and skill list were chosen on Terminal-Bench prompts, so those prompts can't carry a discovery verdict.

## What caused this work

- The owner set a $2,000 all-in ceiling per eval line on 2026-11-03, which voids #169's caps.
- The after pin arrived on 2026-11-03: 699a41c on gstack's branch capy/gst-1088-after-pin, measurement only.
- The /review half of #169 moved to the R2 line (GST-1163), and R3's next step (R3b) will test told /investigate against no gstack at the after pin, so L1 must not buy that comparison.

## Big decisions

1. **Primaries on a fresh public draw, not a sealed set and not TB2.** 80 SWE-rebench tasks no earlier run drew, picked by seed after the pin froze. gstack's tree has no SWE-rebench reference at the after pin, and the router was tuned on TB2. A sealed set would cost about 92 authored tasks plus custody, which the ceiling can't hold.
2. **Behavior carries the verdicts; outcome is descriptive.** Discovery (B1) and adherence (B3), after minus before, are the primaries at 80 tasks x 1. An outcome primary (after-t minus before-t pass rate) could detect only about 11 points at 80 x 3, and about 8.5 even at every eligible task x 3. Nothing in hand suggests a before-vs-after effect that large, so no extra replicates are bought, and the pass rates print with their MDD and no verdict.
3. **Opus 5.5 only on the planned path.** GPT-6.1 Sol, then particle-1, run only from money left after the planned path settles. Sol fits if the planned path costs what it is expected to; particle-1 fits in no planned case.
4. **TB2 twin, last and descriptive.** Run D's 37 TB2 tasks x 2 on five arms give the public comparability and the tuning gap (S12), with no verdict.
5. **No new driver code for GST-734.** Lane B keeps its driver; sessions that end with background work still running are counted per arm from the transcript, and over 10% in an arm sends a null to FIX-METHOD (harness limit).

## Implementation plan

### 1. What this supersedes

This post supersedes #169 (2026-11-02-geva-214-gstack-overhaul-before-after-prereg, merged as 11c51e0). Every rule of #169 that this post does not change stands as written, and section references like "#169 7.2" point to it. The changes, in short:

- **Out:** the sealed held-out families H-inv and H-rev, the public review instruments P4 and P5, the admission slice, b-pilot and h-pilot, Amendments A and B, custody (#169 section 10), build units B2 and B4, fc#2, every review-units launch and judge batch, the outcome primaries O1 to O4 with their guard G3, and the three run threads with their $4,900 pauses.
- **In:** a fresh public instrument F (section 3), a pilot that is both the admission read and the install smoke, the TB2 twin, a descriptive outcome line O5, the $2,000 all-in ceiling with its crew lines and holdback, and two build units (U1, U2) followed by one pins-only amendment (Amendment C).
- **Unchanged:** probes L and I (#169 7.1, 7.2, with fc#3 settled in section 6), the coverage rule (#169 7.5), the analysis method (#169 8.1), the behavior verdict paths (#169 9) with the changes in section 8, the no-gstack arm and its clean-by-construction rule, the fair-test rules of #169 section 3 as they apply to Lane B, and the results plan (#169 14) with section 12's attribution line.

### 2. Pins

**gstack.** Rendered and checked on 2026-11-03 by GEVA-254 (install-manifest.md, attached, holds both manifests and their diff; install-pin.sh and manifest.py are the scripts that made them).

| | before | after |
|---|---|---|
| sha | 82db89ab3ea3c64185538b8af33da2ffd1a18b57 (v1.93.22.0) | 699a41cb6808e01240d02e82247693f9170d401a (v1.94.39.0), on capy/gst-1088-after-pin; fetchable; before is its ancestor |
| install | `./setup --host claude --loadout lite` in a clean HOME, exit 0 | same |
| lite spec_sha256 (gstack-modules render) | c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d | the same: both pins' lite drops the same 10 preamble pieces |
| lite tree, 204 files, paths normalized | 35dbf7b3ce88149e45e91f5d1932c790e608d583837b69e85784564a24ab8321 | ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7 |
| setup's render against a gstack-modules lock at the same path | 204 of 204 files byte-identical | 204 of 204 |
| hooks in ~/.claude/settings.json | Stop: timeline (5 s) | Stop: timeline (5 s), skill contract (10 s); UserPromptSubmit: skill route (5 s) |
| /investigate body | 18,002 bytes; DEBUG REPORT template with Symptom, Root cause, Fix, Evidence, Regression test, Status | 15,646 bytes; the same template; a frontmatter contract (debug-report labels, check after last edit) |
| route threshold | none | 0.66 (lib/skill-route.ts:22); only /investigate, /review, /qa and /verify route |

Because spec_sha256 names the selection, not the bytes, it can't tell the pins apart. The binding install check is the tree: the dry run renders each pin's lock with `gstack-modules render --host claude --loadout lite --out-dir <the arm's render path>` and requires all 204 files of the arm's installed render to match it byte for byte, with the lock's spec_sha256 equal to the value above. Two facts from the manifests change #169: before's non-interactive setup registers only the timeline Stop hook (#169 section 3 also expected a memorable-prompt hook), and every hook is a bash shim that runs `bun` from PATH and exits 0 on any failure, so a missing or shadowed bun silences the after arm's hooks without an error. 26 rendered files differ between the pins, in 15 skill folders.

**Off arms.** After pin, then `gstack-config set skill_routing off` and `gstack-config set skill_contracts off` in the arm's state root after ./setup (#169 section 4's frozen path). Hooks stay registered and silent.

**Routing figures.** The threshold 0.66 is part of the after pin. The only precision figures this plan cites are the after pin's own public docs (the d7 check: scoring every skill's triggers sent 17 of 32 non-fit Terminal-Bench prompts to some skill; routing only the four sends 4). Amendment C's dry run adds our own keyless table: `gstack-skill-route` at the after pin on each F prompt and each TB2 prompt, wrapped exactly as the harness sends it, counting routes to each skill. It fixes B1's routed stratum (section 5) before any session and is otherwise descriptive.

**Harness.** Lane B (quick/laneb) at the build commit Amendment C pins, at or after U1 and U2; Claude Code 2.1.312 and Bun 1.4.4 in the runtime layer, identical across arms (quick/laneb/arms/README.md); the Python Agent SDK version Lane B pins; `system_prompt=claude-code-preset`, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1` and `setting_sources` user and project on every arm; no procedure line on any arm.


**Fetch by sha.** The after pin's branch is measurement only and never merges. U1 fetches both pins by sha, never by branch, and records the fetch and each pin's `git archive` sha256 in its manifest, so a replication does not depend on the branch surviving.

### 3. Instruments

- **F, the fresh set (primaries).** SWE-rebench as R3 amendment 4 pinned it (quick/laneb/tasks/swerebench-r3a4.json, 354 tasks; 346 kept after the oracle preflight, ids sha256 f06321599465c9be76dcb847a92ee41490be51c28ae3a4db8171b5fcdfd9c1d8). R3 amendment 4's screen drew 200 of them, R3b's 70 among them (screen.txt; sorted ids sha256 17fcf1e9efc0b28f4fe14a6c169779b3b23ddc996cf30b543c621b59192c1c12, as its run record prints). eligible.txt holds the other 146, and draw.py checks that the two files together hash to the kept digest. One eligible task, pytest-dev__pyfakefs-1286, is the same upstream change as the screen's jmcgeheeiv__pyfakefs-1286 after the repository moved owner. So draw.py drops every eligible task whose repository name and number match a screen task's, which leaves 145 (sha256 d88c65de72b7278b3925c6356a8b235c7e11a37d1e798837df34df0214998209). F is 80 of them drawn with seed 20261103 (f-tasks.txt, sha256 b14dd044e4dfba0b217bb267566753585fcffdc05b42dc93d95887d192d3f4ee). F spans 65 repositories, at most 4 tasks from one (sqlglot). 36 F tasks come from 22 repositories the screen also drew, so each primary also prints a repository-clustered interval. 10 F tasks are interface variants.
- **Freshness.** The after pin was committed at 2026-11-03T20:26:24Z. The only gstack sessions on this pool so far are R3 amendment 4's 10 told pilot sessions, on screen tasks, in a run that exited at 20:35:02Z. No session of any kind has run on an F task. `git grep -i rebench` over the after pin's tree finds nothing, and `git log -p 82db89a..699a41c` (75 commits) holds no "rebench", "r3a4" or "swe-reb" and no F or pilot id. The 354 ids have been public in this repo since #186 (2026-11-03T10:28Z), ten hours before the pin, so the defense is that search, not secrecy. A later pin could tune to F, so F's verdicts bind only the two pins here.
- **Pilot (admission read and install smoke, never scored).** 10 tasks drawn with seed 20261104 from the 65 eligible tasks F did not take (pilot-tasks.txt, sha256 fa85bf9cc38a3455a6436f2ec29262ba457a71d7e91e46cc4aedbe4a69ff9381), so the pilot shares F's population. before-u and before-t run on all 10. after-u, after-t, off-u and off-t run on 3 smoke tasks drawn from the pilot with seed 20261105: BerriAI__litellm-16275, containers__ramalama-2487 and unit8co__darts-2985. No pilot task is in F, in R3 amendment 4's screen or in R3b.
- **TB2 twin (descriptive, tunable).** Run D's 37 TB2 tasks as #169 section 3 pins them, 2 replicates, arms none, before-u, after-u, before-t and after-t.
- **No review instrument.** The /review exposure read on the after pin belongs to the R2 line (GST-1163). The results post cites its after-pin smoke and runs no review session.

Sessions: 100 turns, allowance $5 (SWE-rebench) and $2.50 (TB2), metered by Lane B's proxy. The $5 allowance sits below Lane B's E1 floor of $12 on purpose: every cap carries 6 parallel sessions x the allowance, and R3 amendment 4's costliest sessions were $2.43 (none) and $1.29 (told), so $5 is about twice anything measured. F tasks run with each task's own cpus and memory (materializeRebench). Every batch runs all its arms interleaved in one seeded order (seed 20261102), as #169 section 3 says.

### 4. Arms and models

| Arm | gstack | Prompt | Where |
|---|---|---|---|
| none | none (empty ~/.claude/skills) | the plain prompt | F1, TB2 |
| before-u | 82db89a, lite | plain (untold) | pilot, F1, TB2 |
| after-u | 699a41c, lite | plain (untold) | smoke, F1, TB2 |
| before-t | 82db89a, lite | "/investigate " then the plain prompt | pilot, F1, TB2 |
| after-t | 699a41c, lite | the same told line | smoke, F1, TB2 |
| off-u, off-t | 699a41c, lite, routing and contracts off | untold, told | smoke, F1 |

Every gstack arm is the pin's own ./setup result, built by U1 with Lane B's existing seeded user (update check off, onboarding markers, routing_declined true, telemetry off, proactive core). The none arm is clean by construction (Harbor container, empty skills folder, no drive), with #169's descriptive read audit after the run.

**Project skills in task checkouts.** Some task repositories ship their own skills. R3 amendment 4 saw 10 of 200 none sessions load them (from fastmcp, infrahub, pipecat, rapid-mlx, smolvm and openharness checkouts). With setting_sources project, every arm sees them. A project skill is part of the task, neither gstack nor contamination. Probe L counts a Skill call as a load only when the skill it loads resolves to the arm's gstack install, never to the task checkout, and S7 lists repo skills apart from gstack skills. No F or pilot task comes from those six repositories; the rule covers any other repository that ships skills.

Models: anthropic/claude-opus-5-5 on the planned path. openai/gpt-6.1-sol (OpenRouter, inside Claude Code, R3's route check first) and then particle-ai/particle-1 run only under section 9's leftover rule. This departs from R54, which names both as models under test: the ceiling holds Opus's planned path and then Sol only if the planned path costs about what it is expected to, and particle-1 in no planned case (price.txt). A model the ceiling check refuses is reported as not run under the ceiling, with the MDD it would have had (section 7). No Haiku or Sonnet cell. No open-weight ladder slot runs, so the OpenRouter ranking needs no re-read.

### 5. Endpoints

Per model, one primary family with its own Holm step at 0.05.

**Behavior family (primary), on F1 (80 tasks x 1, every arm).**
- **B1, discovery.** Share of untold sessions that load /investigate under probe L: after-u minus before-u. B1 also prints on the routed stratum, the F tasks whose wrapped prompt Amendment C's routing table (section 2) sends to /investigate at the after pin, which is fixed before any session.
- **B3, adherence.** Share of told sessions with a complete /investigate record under probe I: after-t minus before-t.
- Claim margin 20 points each. Holm over two members.

**Outcome (descriptive, no verdict).**
- **O5.** Pass rate (verifier reward 1), after-t minus before-t, on F1 at 80 x 1, printed with its interval, before-t's rate and its MDD from power.txt (14.4 to 19.8 points at a 60% to 80% control). It is not a primary. Two more replicates (80 x 3) would bring its MDD to 10.6 to 11.7 points at a 60% to 70% control, and every eligible task at 3 replicates to 7.9 to 8.7 (power.txt). No data in hand suggest a before-vs-after effect that large: both pins keep the same DEBUG REPORT template, and the told path differs by the contract hook and a body 2,356 bytes shorter. G3 leaves with the outcome primaries; S8 prints its ratio descriptively.

**Not run as primaries, with the MDD each would have had.** B2 and B4 (review) moved to R2. #169's O1 and O2 (H-inv after minus none) and O3 and O4 (review) have no sealed set, and the told-against-none outcome question is R3b's. At #169's design, recomputed by this plan's power.py, O1 and O2 had MDD@Holm4 11.3 to 14.6; O3 and O4's 12.7 to 15.8 are #169's own figures, which power.py does not recompute and which overstate power. O5 as a primary would have had the 80 x 3 figures above.

**Secondary (intervals, no verdict).** S1: after-t minus none and after-u minus none pass rate on F1 (O1 and O2's comparisons, descriptive; R3b owns the told-against-none verdict). S3: after-u minus before-u pass rate on F1. S5: before minus none. S6 attribution: after minus off on B1, B3 and pass rate, F1. S7: untold loads of any other skill on F1 and TB2, gstack skills and repo skills apart. S8 cost: dollars and tokens per session and per pass, per arm, with the ratio to none, including #169's G3 ratio for after-t. S10: agreement of probe I with `gstack-skill-contract check --transcript <path> --skill investigate --json` on after-t sessions (the contract is never the score). S11 mechanism: the route hook's line in after-u sessions, the contract hook's block and record in after-t sessions. S12 tuning gap: B1 and B3 on the TB2 twin minus F1, and TB2's fit stratum of 5 tasks beside them. S13: sessions that ended with background work still running at the result, per arm (section 6).

### 6. Scoring rules

- **Probe L** is #169 7.1 unchanged, with each pin's body prefix from its own install (manifest: first-200-character digests of each pin's /investigate body), and a Skill call counts only when the skill it loads resolves to the arm's gstack install (section 4). The after pin's route hook injects a skill name, not a body, so the hook-delivered exception does not apply.
- **Probe I** is #169 7.2 unchanged except fc#3, settled here: item 4 holds when, after the last edit, either one simple command of a parsed Bash line matches the frozen test-runner list, or a whole Bash call's command, compared after collapsing runs of whitespace, equals a Bash call's command that exited non-zero before the first edit. So `cd app && python repro.py` counts when that exact call failed before the first edit and runs again after the last edit; `cd app && python repro.py -v` does not. `cd app && pytest` counts through the runner list. The after pin keeps every output probe I reads (section 2), so the drop-by-design branch does not fire.
- **Outcome.** Verifier reward 1 passes. The pinned task's tests are never reachable from the agent's container (materializeRebench's separate verifier).
- **Session outcomes.** A trial is graded when it has a verifier reward and a model response reached the agent (R3 amendment 4's rule). A session that closes with no model response raises LanebInfraError, which Harbor reruns inside the same launch and item; a trial still without a response is infra, a coverage gap. An allowance stop is a graded fail for pass and adherence, and over 10% in any arm sends a null to step 1 of #169 section 9's cycle. A contaminated none session is dropped as untested and counted.
- **Parts and VM loss.** F1 runs as 4 parts and the TB2 twin as 2 (section 9). When a part's VM dies or is reaped, or its controller or ledger service is lost, the cells of that part that never started are relaunched once, on a new VM, inside the same item's bound run and cap. A cell that started and has no grade is infra. Nothing else is rerun.
- **Background work (S13, replaces B2).** From each session's SDK message log, U2 counts a session as ended with background work running when a Bash call with run_in_background true, or an Agent call run in the background, has no completion notice before the result message. Over 10% of an arm's sessions sends a null to step 1 (harness limit), and the count prints beside every verdict.
- **Image pulls (fc#4).** A refused image pull is infrastructure, never an oracle drop: the VM waits out the registry's window and pulls again, without spending a retry, and finishes every pull before the batch starts. A task whose image can't be pulled for a launch is infra for that launch's sessions and stays in the planned count (#169 7.5).
- **Coverage.** #169 7.5's rule: an endpoint has no outcome when any arm has graded sessions for under 90% of its planned sessions or over 10% of task clusters fail to enter. Nothing graded is rerun; a cap stop ends the run incomplete and is never retried.
- **fc#5** does not apply: this plan has no judge batch. The probe audit reader is a crew agent, inside the crew line.

**Attacks this plan adds (to #169 7.6).**
1. *A public set can be tuned to.* The draw's timing is no defense, because the seed is a date and the pool was public before the pin froze. The defense is section 3's search, which finds no reference to the pool in the pin's tree or its commit range. The verdicts bind these two pins only, and a later pin needs a fresh draw.
2. *The gate reads F1's after-t, not TB2.* TB2 is the router's tuning set, so its adherence reading could run high. Reading on fresh tasks keeps #169's 50% bar honest.
3. *Untold arms priced at the told rate.* That only raises caps, which the ceiling check then holds.
4. *Opus may have seen SWE-rebench repositories in training.* That applies equally to every arm; the results post lists it as a limit.
5. *The pilot could read an easy stratum.* It comes from the eligible tasks F did not take, so it shares F's population, and it is never scored.

### 7. Power and admission

Method: #169 8.1 unchanged (cluster bootstrap, 10,000 resamples; two-sided sign-flip, 100,000 draws; seed 20261102; clusters are tasks). Each primary also prints a repository-clustered interval beside the task-clustered one, as R3 amendment 4 did; the verdict reads the task-clustered test. power.py (attached) measures power through that test under a true null: the exact two-sided sign-flip on task differences (the exact sign test on discordant pairs at 1 replicate), with each MDD read as the realized mean difference in rate after clipping at 1. #169's power.py had the same flaw; at low base rates its table overstated power by about 2x (43%, not 80%, at a 2% rate); its outcome rows at moderate rates were close. Its frozen behavior table is the only behavior table: admission, saturation and every behavior MDD this plan quotes read it (linear interpolation between rows, the nearest end row outside them).

| Endpoint | n | Rate at the control arm | MDD@0.05 | MDD at its Holm step | Margin |
|---|---|---|---|---|---|
| B1, B3 | 80 x 1 | before at 1% to 5% | 10.9 to 13.5 | 12.3 to 15.0 (Holm2) | 20 |
| B1, B3 | 80 x 1 | before at 20% to 50% | 18.6 to 19.9 | 20.3 to 21.5 (Holm2): not powered | 20 |
| O5, descriptive | 80 x 1 | before-t at 60% to 80% | 14.4 to 19.8 | no verdict | none |
| O5 with two more replicates (not bought) | 80 x 3 | 60% to 70% | 10.6 to 11.7 | | |
| O5 on every eligible task (not bought) | 145 x 3 | 60% to 70% | 7.9 to 8.7 | | |
| TB2 twin behavior | 37 x 2 | before at 2% to 50% | 12.7 to 20.4 | descriptive | |

MDD rises with the before rate up to about 40% and falls above it, because conc 2 places many tasks near 1 where an upward shift is capped.

Behavior rows at a before rate of 20% to 50%, and at 90% (80% power is not reached), are not powered: their MDD@Holm2 passes the 20-point margin, so a B1 or B3 reading there carries no verdict under the $2,000 rule. Sol and particle-1 at F1's design would have the same behavior MDDs as Opus's rows.

**Behavior admission (the pilot).** For B1 and for B3 on Opus: c is the before arm's rate on the pilot's 10 sessions and u its Wilson 95% upper bound. MDD is the larger of the frozen behavior table's MDD@Holm2 at c and at the planning rate 2%. Admit when 100 minus u is at least 2 x MDD and MDD is at most 20. So 0 or 1 of 10 admits and 2 or more does not. A family member that is not admitted runs as a descriptive line and is reported as FIX-METHOD (saturation); the plan holds no ceiling-raise attempt, and that is stated. Data in hand point to room: untold Opus opened no gstack skill in 252 Run D trials (#140), and told Opus wrote a DEBUG REPORT in 0 of 111 #109 trials, both at older pins.

**The gate reading (after F1).** #169's held-out spend gate (probe I's complete rate in after-t sessions at least 50%) has no held-out item left to bind in this plan, because nothing is bought after F1 on its strength. The reading is still taken once, on F1's after-t sessions, and goes into the Captain's approvals with the session counts and the probe's source digest. It prints as the exposure line beside B3, and it binds any held-out L1 item a later plan adds.

### 8. Verdicts

#169 section 9 applies per model to B1 and B3, with these changes. Their saturation step reads power.txt's frozen behavior table at the before arm's counted rate. B1's install-exposure step counts the route hook's firing in after-u sessions on the routed stratum (section 5), so a hook that stays silent on a prompt the router never sends to /investigate reads as exposure, not as a miss. A CUT-CANDIDATE on B1 names the route hook and the description rewrite, and on B3 the contract hook and the body diet. S6 says which part carried a KEEP on Opus.

#169's outcome paths do not run. O5 carries no verdict: it inherits nothing from #169's H-inv table or its none arm, and the plan holds no ceiling-raise attempt for it. The post prints O5 with its interval, before-t's counted rate and power.txt's O5 MDD at that rate, and says it is unpowered. The post names each null's kind, prints the none rate and the MDD beside it, and reports a loss as a loss.

### 9. Spend: the $2,000 all-in ceiling

Every L1 dollar from 2026-11-03 13:30Z counts: paid model calls, VMs, and crew model use (each thread's Capy credits / 1000), this thread and the Captain's L1 turns included. price.py and price.txt (attached) give:

| Line | Expected | Cap |
|---|---|---|
| pilot-opus (32 sessions, VM included) | $26.08 | $80 |
| f1-opus (560 sessions, 4 parts) | $423.80 | $680 |
| tb2-opus (370 sessions, 2 parts) | $102.79 | $180 |
| Crew line: L1 threads through the results post (640M planned tokens at $0.45/M) | $288.00 | $400 |
| The Captain's L1 turns (80M) | $36.00 | $40 |
| Sol run work, if Sol runs (30M) | $13.50 | $15 |
| particle-1 run work, if particle-1 runs (30M) | $13.50 | $15 |
| **All-in** | **$903.67** | **$1,410** |

The $590 is what is left if every planned item settles at its cap. The ceiling check, which reads actual settled spend, sets what the leftover rule can spend on Sol's and particle-1's paid items.

Rates: SWE-rebench Opus none $0.37 and told $0.74 per session, measured by R3 amendment 4 (200 none trials, 10 told trials); every gstack arm is priced at the told rate. TB2 $0.232 per session (#169 price.txt). VMs at $0.60/h: 0.0317 h per none session (R3 amendment 4, 6.65 h for 210 sessions) and twice that for every gstack arm (R3 amendment 4's told sessions took 0.0537 h). One ledger item per run: a run's parts and its one relaunch are launches inside that item's bound run, and a second run on the item is refused (Lane B's <LEDGER>.bound). Cap = ceil10(1.5 x expected + 6 parallel sessions x allowance + one 4-hour VM block per part). Harbor's in-launch reruns sit inside each launch's expected spend (x 1.05), so no repair items exist. Crew use measured so far runs below the planning rate: this thread read 14,156 credits at 40.2M tokens, about $0.35 per million.

- **Parts.** F1 runs as the 4 parts frozen in f-parts.txt (F shuffled with seed 20261106, 20 tasks each), under its one item, each part on its own VM and each interleaving all 7 arms over its tasks. Each part is about 8 VM hours at the planning figures and sets UBI_TTL_HOURS to 16. Each part runs as a detached launch on the waiting agent's own machine, which attaches to it on a timer, so neither a background operation's 6-hour limit nor a sleeping machine ends a part. The TB2 twin runs as 2 parts the same way, split by Amendment C. Parts of one item run one after another, never side by side: Lane B's ledger checks an item's cap and appends a reservation with no lock across processes, so two launches on one item could both pass its cap. The item's cap covers all its parts.
- **VM spend (targeted#1).** Every launch sets VM_USD_PER_HOUR=0.60, so its VM blocks are reserved and settled on its own item, and the tally reads them from there.
- **Crew lines.** Token figures are planning numbers. The Captain sets each L1 thread's token stop so the stops sum to no more than 640M, and the tally reads credits, not tokens. The Captain books the credits of each turn it spends on L1 against its own $40 line and stops L1 work there. Sol's and particle-1's run work bill to their own lines.
- **Ceiling check before every launch (U2).** It adds up: settled and reserved spend on every L1 ledger item; the credits / 1000 of every L1 thread so far and the Captain's booked L1 turns; the caps of every planned item still to run; and a crew holdback. The holdback is the larger of the crew line's unspent remainder and the sum, over open and planned L1 threads, of each thread's unspent token stop at the measured L1 dollars per token so far (never below zero), plus the unspent remainder of the Captain's line and of each leftover model's run-work line until that model is done or refused. The check refuses a launch whose cap would take the sum past $2,000. The operator runs it before each launch and rereads the counters after each. Items launch one at a time.
- **Final ceiling read.** Before the results post starts, the run thread reads the all-in figure again, and the Captain sets the post thread's token stop so that figure plus the stop at the measured rate stays at or under $2,000.
- **Re-cost after the pilot.** `python3 price.py --measured <file>` takes each arm's mean dollars per session in the pilot (model opus). Each arm's rate becomes the higher of its planning rate and its pilot mean, and its TB2 rate scales by the same ratio. The pilot counts at its cap. If the all-in at caps passes $2,000, items drop in this order until it fits: the TB2 twin, then the off arms in F1. If F1 on its other five arms still does not fit, L1 stops before F1 and reports the pilot as a stop. price.py prints the result as one RECOST line, and each drop is reported as not run under the ceiling. If a pilot session costs more than $2.50 (half the allowance), the run stops before F1 and the Captain picks one of two frozen options: continue under the re-cost and drop order, or stop L1 and report the pilot as a stop. Raising the allowance is not an option under this plan.
- **Order.** Pilot, admission reading, F1, gate reading, TB2 twin. Then the leftover rule: once every planned item has settled, Sol runs (route check, its own pilot of the same shape, then F1-Sol at 80 x 1 on none, before-u, after-u, before-t and after-t), each launch only if the ceiling check passes. Sol's planning caps are $100 (pilot) and $730 (F1), at its measured multiples of Opus's rates on Lane B 3c (1.33 none, 1.63 told), and F1-Sol is re-costed from Sol's own pilot with `price.py --measured` (model sol) before it launches, under the same floors. particle-1 follows the same way, with planning caps of $120 and $920 at 2.04 times Opus (R3 amendment 4's projection). price.txt shows Sol fits if every planned item settles at its expected spend and does not fit if every one settles at its cap, and particle-1 fits in neither case. A model left out is reported as not run under the ceiling, with the MDD above.
- A cap stop ends that item incomplete and is never retried. Ubicloud VMs carry UBI_OWNER and are deleted when their batch ends.

### 10. Build units and Amendment C

Each unit is its own PR with keyless tests under tests/ and the crew's plan step for its kind. None changes a rule above.

- **U1, Lane B arms at both pins.** quick/laneb/arms/build.sh takes the pin by sha and builds four gstack arms through each pin's own `./setup --host claude --no-browser --loadout lite`: before, after, and after with both off keys set by gstack-config. It keeps the existing seeded user and canonical tar, and writes manifests with the lite lock, the normalized tree digest, the hook entries, the fetch record and each pin's `git archive` sha256. Checks, inside the arm images: the 204-file lite match (section 2); hook entries as each pin's setup writes them; none clean; `gstack-config get` prints off for both keys in the off arm and neither in after; with the real Claude Code 2.1.312 against a fake upstream, the after arm's route and contract hooks fire on a fixture prompt and stay silent in the off arm; and `command -v bun` in every F task image under the runtime PATH, with any task where the hooks would reach a bun other than 1.4.4 listed. U1 also builds the L1 launcher and an L1 cells file, inside the existing 640M crew line: F1's 4 parts and the TB2 twin's 2 run one after another as detached launches of one bound run, the one relaunch of never-started cells, the pilot and smoke shapes, and the $5 and $2.50 session allowances.
- **U2, probes, analysis and the ceiling check.** Probes I and L over Lane B's SDK message logs, with #169 7.6's adversarial fixtures, fc#3's cases and the project-skill case of section 4; the S13 background count; one per-session outcome table (schema in src/types.ts); one keyless entry from that table to every endpoint, both intervals, the Holm step, the behavior admission, the gate reading, O5's descriptive line and every behavior verdict branch; and the ceiling check of section 9 with its holdback and final read. Synthetic-data tests cover KEEP, LOSS, each FIX-METHOD branch, CUT-CANDIDATE, the not-admitted and not-run branches, O5 printed with no verdict at a 67% before-t rate, and a ceiling check with the crew line already spent and a Sol launch pending, which must refuse.
- **Amendment C (pins only).** Pins the Lane B build commit, the arm tars and manifests, the probe and analysis source digests, the price table's as_of, the routing table with the routed stratum it fixes, the TB2 twin's split and the dry-run record. Its keyless dry run drives every frozen rule with the real CLI against a fake upstream: each probe on its fixtures, each session-outcome row, the coverage and cap-stop rules, F1's parts with one part's VM killed and one part's controller killed (the one relaunch of never-started cells), each verdict branch, the behavior admission and the gate reading, the ceiling check, and one ledger item bound per run on a temporary ledger, with every part and the relaunch admitted on the bound run and a second run on the item refused. Then the pilot runs under its item.

No counted launch runs before Amendment C merges, the Captain records the caps in approvals/, and the ceiling check passes.

### 11. Open notes from #169

fc#2 is not built (T-hrev left). fc#3 is settled in section 6. fc#4 is settled in section 6. fc#5 does not apply. targeted#1 is settled in section 9.

### 12. Outside terms, licences and rights

SWE-rebench is CC-BY-4.0, the work of Nebius AI R&D; R3 amendment 4 section 17 records the attribution and what Lane B changes, and the task repositories carry their own open-source licences. The results post carries SWE-rebench's CC-BY-4.0 attribution itself. This plan commits only task ids, counts and digests. Task images come from Docker Hub under its terms and pull limits (fc#4, section 6). TB2 and Harbor are Apache-2.0 (NOTICE.md). gstack at both pins is MIT and is installed into private arm layers that are never committed. Claude Code and the Agent SDK run under Anthropic's terms as in every earlier lane. Opus 5.5 runs under Anthropic's API terms; Sol and particle-1, if they run, under OpenRouter's and their providers' terms, as #140 published before. No new dataset or benchmark licence is involved.

### 13. Results, sequence and risks

The results post follows #169 section 14 (finding template, claim check, banger-writing skill, disclosures last, every pilot, stop and null in the org registry) and carries the CC-BY attribution of section 12. It says in its Setup section that the verdicts rest on a fresh public draw, not a sealed set, and why.

Sequence: this plan merges and the Captain records its caps; U1 and U2 build; Amendment C merges; pilot and re-cost; F1; the gate reading; the TB2 twin; Sol and particle-1 under the leftover rule; the final ceiling read; the post.

Risks: the after pin's hooks fail open on a shadowed bun (U1's check lists those tasks, and S11's firing rate shows it); before-t may already complete the record often (the pilot's admission catches it); told sessions may cost more than R3 amendment 4's procedure-line trials (the re-cost and drop order hold the ceiling); a VM may die in F1 (parts and the one relaunch hold coverage); the crew lines may run over (the ceiling check counts real credits, holds back unspent stops and shrinks what can still launch).

## Review record

Lean /autoplan run autoplan-20261103210346: one Opus 5.5 reviewer reading with CEO and Eng lenses, one round, on the draft with Implementation-plan sha256 acb621a6597a767c15db7187852da3fe9f3e01307869066fc5f37c52d49576d0. It reran draw.py and price.py, reproduced every figure, simulated the old O5 admission rule, and found 3 High, 5 Medium, 5 Low and 1 Informational finding. The Captain answered the gate with rec. Dispositions:

- F1 (High, O5's admission read its own control data): d2a's second branch. F2 is decided now and not bought, and O5 is descriptive.
- F2 (High, O5's saturation step borrowed #169's table): d3a. O5 has no verdict and borrows nothing (section 8).
- F3 (High, no crew holdback): d4a. Section 9 adds the holdback, the Captain's, Sol's and particle-1's own lines and the final read.
- F4 (Medium, pilot drawn from solved tasks): the pilot comes from the eligible tasks F did not take, and the smoke is drawn by seed.
- F5 (Medium, F1 as one launch): F1 runs in 4 parts and the TB2 twin in 2, with one relaunch of never-started cells.
- F6 (Medium, two behavior tables): power.txt has one frozen behavior table, cited everywhere.
- F7 (Medium, B1's exposure denominator): the routed stratum, fixed by Amendment C's routing table.
- F8 (Medium, user challenge on Sol and particle-1): the Captain kept the frozen order (d1a); section 4 states the R54 departure.
- F9 (Low, a renamed twin in F): draw.py's twin rule; F was redrawn before any data.
- F10 (Low, project skills in checkouts): section 4's rule, probe L and S7.
- F11 (Low, Sol priced at Opus rates): Sol is planned at its measured multiples and re-costed from its own pilot.
- F12 (Low, the $5 allowance and the tripwire): section 3 states the allowance's basis; section 9 freezes the two options.
- F13 (Low, freshness and shared repositories): section 3's freshness facts and the repository-clustered interval.
- F14 (Informational, the after pin lives on a branch): U1 fetches by sha and records an archive digest.

Outside terms: none new. The CC-BY line goes in the results post (sections 12 and 13).

Capy's review of #193 found two Medium issues, both fixed in the plan before /ship: parallel parts of one item could race the ledger's cap, so parts now run one after another; and price.py could not take measured rates, so it now takes `--measured` and prints the drop order's RECOST line.

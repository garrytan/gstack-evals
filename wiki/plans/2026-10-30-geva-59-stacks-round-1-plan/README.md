---
id: 2026-10-30-geva-59-stacks-round-1-plan
kind: plan
title: "gstack against pstack and tstack, round 1: a told review lane and a told TB2 lane"
summary: "Round 1 compares gstack with Lauren Tan's pstack and Theo Browne's tstack: a told review lane on 26 PRs and a told TB2 lane, Opus 5.5 plus cheap rungs, $2,400 cap."
author: GEVA-59
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-30
status: done
source: "Plan v2 by GEVA-57 (Captain drive handoffs/GEVA-57/plan.md), reviewed by gstack /autoplan run autoplan-20261030222934 in two rounds (plan snapshot sha256 05a452fa6be451b20cf398472649095759f7f3d85c2ec2c2dc9b9150e852cea0) and approved at gate_rev 2. review-record.md is the run's public export with em dashes replaced by hyphens."
links:
  - 2026-10-30-geva-59-pstack-tstack-idea-inventory
  - 2026-10-30-gsta-40-review-noloss-plan
  - 2026-10-29-gsta-30-laneb-quick-3-prereg
attachments:
  - bf3f574d70064199d96d6109b90c7e8752a06daa586f6385ca2ebcaa50c2e0c4  review-record.md
---

# gstack against pstack and tstack, round 1: a told review lane and a told TB2 lane

GEVA-57, for the gstack-evals Captain (GEVA-2). Written 2026-10-30. Issue GST-342. This plan turns GEVA-55's research (Captain drive: handoffs/GEVA-55/plan-draft.md, handoffs/GEVA-55/pstack-ideas.md, reports/GEVA-55.md) into a reviewed plan. It is not the preregistration. The preregistration lands in its own pull request after the keyless rig work, and results land in another. No paid call runs from this plan.

pstack is Lauren Tan's work (MIT, in cursor/plugins). tstack is Theo Browne's (MIT, t3dotgg/tstack). This plan describes their procedures in its own words and copies no skill text.

This post is plan v2, written by GEVA-57 and carried through review round 2 by GEVA-59. The plan text under "Implementation plan" is the reviewed text, apart from the four edits listed in "Changes after approval".

## Approval

Garry Tan asked for this in the gstack-evals Captain thread on 2026-10-30: "have you been doing any analysis of how gstack stacks up vs pstack and tstack yet?", then "great go ahead, i'm interested in picking up all the smart stuff particularly from pstack lauren is brilliant and amazing!!". He then wrote "rec" before any gate was relayed to him. The Captain recorded that word as a standing instruction to take this plan's recommendations (approval a-1a254a600c48), with anything beyond what Garry was told going to the Captain first. It is a standing instruction given before the gate, not an answer to a gate he saw.

gstack /autoplan run autoplan-20261030222934 reviewed the plan in two rounds:

- Round 1, on plan v1 (snapshot sha256 25ea32dc492090608a4ed03d23cf59beb3a7c96383b1e1d4b936603a3bd312e2): CEO native on Opus 5.5 (12 findings), Eng native on Opus 5.5 (18) and Eng outside on gpt-6-astra (10). The CEO outside voice did not run, because the brief capped each round at 3 reviewers. GEVA-57 answered gate rev 1 with "d1a d2b p1b" and the owner reply "rec", then revised the plan to v2 (snapshot sha256 05a452fa6be451b20cf398472649095759f7f3d85c2ec2c2dc9b9150e852cea0).
- Round 2, on plan v2: CEO native on Opus 5.5 (12 findings, 4 High), Eng native on Opus 5.5 (11, 3 High) and Eng outside on gpt-6-astra (5, 4 High), again with no CEO outside voice. Gate rev 2 held one item, plan approval, with the recommendation p1a (approve as-is). GEVA-59 answered "p1a" with the owner reply "rec", and the run reported APPROVED at gate_rev 2.

The run stopped at its two-round cap with 11 High findings open. It printed that the evidence was sufficient and the decision was the owner's, and the standing "rec" took the recommendation. The next section lists those findings.

## Open at approval: what the preregistration must settle

The run records the 11 open High findings as tasks T1 to T11. None changes the lanes, the models or the cap. Each is a method detail that the preregistration pull request must settle, and that pull request gets its own review. Some overlap: T3 and T11, T4 and T10, T6 and T9. The Medium and Low findings are in review-record.md.

| Task | Finding | Fix the reviewer proposed |
|---|---|---|
| T1 | CEO: the false-blocker test that decides idea 1 has no power figure. | Compute its minimum detectable difference at 26 PRs from the GSTA-167 judgments before the preregistration. If it is above 0.5 false blockers per PR, send every outcome except a LOSS on provable blockers to the round 2 paired port test. |
| T2 | CEO: the one-sided primary tests let pstack and tstack lose, but never gstack. | Add the mirror test of gstack against each stack, apply Holm across all four, and regenerate the power table. |
| T3 | CEO: the gstack arm's installed tree carries later fixes outside the diff paths (changelogs, TODOS.md, checklist lines). | Run a keyless contamination audit per unit, strip those files, and label or drop affected units for every arm alike. |
| T4 | CEO: the common findings block has no field for native severity or for pstack's lead confirmation. | Add both fields to the frozen told text, and check in the pilot that every arm emits the block. |
| T5 | Eng: head-only unit repos have no origin refs, so gstack /review cannot find its base. | Fetch the ancestry, write origin refs and a local base branch at the merge-base, and check it per arm in the canary. |
| T6 | Eng: the false-blocker test has no adjudication file, build unit or two-sided test. | Add a blind adjudication file, a two-sided sign-flip test and a per-PR false-blocker table to build step 2, with keyless tests. |
| T7 | Eng: verification accepts any exit 2 from noloss score, refusals included. | Check the verdict line and the first reason code instead, with one keyless fixture per outcome. |
| T8 | Eng outside: the current LOSS scoring does not implement the declared margin and Holm family. | Freeze the null and the test order, and test Holm and the underpowered case apart from exit codes. |
| T9 | Eng outside: the false-blocker and impact readings need a per-finding adjudication contract. | Use versioned, blind per-finding judgments that tell over-blocking a known informational case apart from a new blocker. |
| T10 | Eng outside: the findings output drops confirmation and treats a malformed block like no findings. | Keep native severity and confirmation, and score empty, malformed and missing output differently, with golden fixtures. |
| T11 | Eng outside: scrubbing diff paths leaves other routes for future fixes to leak in. | Check every install root the agent can see against a frozen contamination policy. |

## Changes after approval

Four edits to the reviewed text, made on the Captain's word after gate rev 2. Review did not see them.

- Big decision I: Garry's word is pending (the Captain has asked him), and the item now says how the plan runs either way.
- Big decision J: approved by the Captain as a build task after this plan merges.
- Section 10: one paragraph for J and one for I, after the numbered steps.
- Section 15: the Needs line for I and J.

## Implementation plan

### ELI5

Garry asked how gstack stacks up against pstack and tstack, and said he wants to pick up the smart ideas, especially Lauren Tan's from pstack. We will run each stack's main procedure on the same work and score them the same way. The first test is code review: 26 real gstack and gbrain pull requests where we already know 42 bugs a good review must block. Each stack reviews every one twice, and we count which bugs each catches, how many false alarms it raises, and what it costs. The second test is 40 terminal tasks (TB2) where the model is told to use one stack's main procedure, on Opus and on two cheap models. pstack's newest idea, that a review finding only counts once a run proves it, gets the most direct test. Every time another stack beats gstack on a bug or task, we write an idea card that says what to port and how to prove the port helps. Round 1 is exploratory: it can show a stack losing blockers or cutting false alarms, but it cannot certify that two stacks are equal. The round is projected at about $1,570, with a $2,400 cap.

### Before → after

- Before: one desk survey from 10-27. Stack arms were deferred to v1.1. gstack ported pstack at 99b609a7 (10-24) and never measured the port, and it missed pstack's 10-27 interrogate rewrite.
- After: a measured answer in two places: blockers kept, false blockers and cost per blocker on 26 PRs, and pass rates on 40 told TB2 tasks on Opus 5.5, Haiku 5.5 and particle-1. Each stack win becomes an idea card for GStack Minder, credited to its author.

### Why it matters

pstack and tstack are idea sources for gstack, not a leaderboard. A port that has not been measured can make gstack slower or more expensive with no gain, as Lane B found when gstack's /investigate body lost to a length-matched placebo on Haiku by 20 points. Review is where pstack changed most since gstack's port, and the review no-loss suite already exists, so it can answer the top question cheaply.

### What caused this work

Garry, 2026-10-30: "have you been doing any analysis of how gstack stacks up vs pstack and tstack yet?", then "great go ahead, i'm interested in picking up all the smart stuff particularly from pstack lauren is brilliant and amazing!!". GEVA-55 did the research and stopped at its token cap before /autoplan, so this thread starts at the plan step.

### Big decisions

Each has options, the pick, why, and what would flip it. Section numbers point to the detail.

- A. Lanes (section 2). Options: review lane only; review plus told TB2; add HARN-14 native tasks now. Pick: review plus told TB2 in round 1, HARN-14 in round 2. Why: review answers the top idea on an existing suite; TB2 reads each stack's told procedure at low cost; HARN-14 is sealed and owned by another crew. Flip: harness-evals publishes an opening with a pstack arm before the preregistration.
- B. Review suite (section 6). Options: GSTA-167's 14 PRs; the combined 26-PR suite; combined plus detection-only units. Pick: the 27 blocking units plus the 6 over-blocking units of the combined suite, 2 passes per arm. Why: 26 PRs give 92.5% power to see a 23-point loss; 14 PRs give 77%. Flip: fewer than 22 PRs survive the unit-image check.
- C. Review arms (section 3). Options: add placebos; add tstack council; add pstack arena; add gstack as it was before its 10-24 pstack port. Pick: none, gstack /review, pstack interrogate, tstack sol-loop round 1. Why: the question is which procedure keeps more blockers; council needs a Gemini route the proxy lacks; arena costs N times per unit; a pre-port gstack arm (about $264) measures the old port, and neither gstack version has the 10-27 rewrite. Flip: a Gemini route lands in the proxy (council joins round 2).
- D. Invocation (section 4). Options: untold; told; both. Pick: told only. Why: 57 of pstack's 58 skills cannot be invoked by the model, and gstack fired 0 of 540 times untold. Flip: none expected.
- E. Models (section 5). Pick: Opus 5.5 in every cell, particle-1 in both lanes, Haiku 5.5 in TB2 only; Sonnet 5.5, DeepSeek V4.1 Flash and the open-weight slots out, each with a reason. In the particle-1 review cell every stack runs on particle-1 alone, under one rule. Flip: the Captain wants the full ladder now, at about $60 more for Sonnet in TB2.
- F. Placebo (section 3). Pick: gstack-placebo and pstack-placebo on Haiku and particle-1 in TB2 only. Why: Lane B found cheap-rung effects that a placebo explained; quick look 2 already measured gstack against its placebo on Opus. Flip: a large pstack TB2 effect on Opus.
- G. Cap and stops (section 9). Options: review stop $1,950; review stop $2,050. Pick: $2,400 cap, review stop $2,050, TB2 stop $300, an exposure-based start rule after each pilot and a fixed drop order. Why: at $1,950 the start rule clears the central estimate by about $30, so any pilot overrun would return the lane to the Captain. Flip: the Captain prefers the lower stop.
- H. A proof gate on gstack's own findings in round 1 (CEO review). Options: add a rig-written proof gate arm now; keep round 1 to the stacks as their authors ship them. Pick: keep. Why: writing a proof gate for gstack is a port, which GStack Minder owns; a pstack false-blocker drop in round 1 triggers a paired test of GStack Minder's port in round 2 (section 1). Flip: the Captain wants an answer on the port before GStack Minder writes one.
- I. A fidelity window with the authors (CEO review). Pending Garry's word, which the Captain has asked for, because it reaches people outside the repo. If he approves, the arm manifest and told text go to Lauren Tan and Theo Browne for 3 days, in parallel with build steps 1 to 3, so the window adds no delay; anything they flag is settled in the preregistration before any paid call. If he does not, the plan runs as written. Why: a public head-to-head should run each stack the way its author would.
- J. Seeded-mistake Lane A tasks for pstack correct (CEO review). Approved by the Captain (GEVA-2, 2026-10-30) as a build task after this plan merges; it is not part of this plan's pull request. Keyless and with no spend, written during round 1's build window, so round 2 starts with its tasks written first.
### 1. The top ideas and what round 1 says about each

Round 1 is exploratory for every mechanism. At this design an arm equal to gstack earns NO_LOSS only 45% of the time, under the lane's 80% size rule, so `noloss score` exits 2 with NOLOSS_UNDERPOWERED for any NO_LOSS and no equality claim is possible. The verdicts round 1 can return are LOSS, NOT_DISTINGUISHED, a paired recall difference with its interval, and a paired false-blocker difference with its interval (section 7).

| Idea, with credit | gstack today | Round 1 reading | Points toward a port | Points against |
|---|---|---|---|---|
| 1. Proof-carrying review findings: a finding counts only after a run shows it (failing test, repro script or command output) and the lead's rerun confirms it (Lauren Tan, pstack interrogate, rewritten 10-27) | Partly: /review quotes the code line, runs QA probes and has the older lead-judgment filters; no rule that a finding needs a run | Review lane, pstack against gstack | Not a LOSS on blocking recall, and fewer false blockers per PR with the paired interval below zero | A LOSS on blocking recall, read by stratum: losses only on blockers a run cannot show point to a narrower port |
| 2. A cheap single-reviewer tier: one cross-family reviewer with a tight brief and a findings ledger (Theo Browne, tstack sol-loop) | Has the severity glossary, no single-reviewer tier | Review lane, tstack round 1 against gstack | Not a LOSS, at a lower cost per blocker found | A LOSS on blocking recall |
| 3. Restate the goal in every brief and report, and route by a small reply rulebook (Lauren Tan, pstack poteto-mode) | Partly: the /gstack router; office-hours restates goals | Not tested directly: TB2 tasks are single sessions with no briefs or PRs. TB2 reads poteto-mode's whole told procedure against gstack /investigate and against its own placebo | Round 2, on tasks with briefs and PRs (HARN-14 or a crew-level task) | Same |
| 4. Make a past mistake impossible with the strongest check that names the fix (Lauren Tan, pstack correct) | Lacks: /learn stores text | Not in round 1 (task writing during the build window is item J) | Round 2, Lane A tasks seeded with repeated mistakes | Same |
| 5. A generated per-repo verification skill (Lauren Tan, pstack create- and maintain-verification-skill) | Partly: /qa and browse | Not in round 1 | Round 2, Lane A on a small app repo | Same |
| 6. Best-of-N with a cross-family judge and a graft (Lauren Tan, pstack arena) | Partly: design-shotgun, autoplan's two voices | Not in round 1 (N times the cost per unit) | Round 2, told TB2 on tasks Opus fails | Same |

The Captain's action on the likely outcome is fixed now: if pstack is NOT_DISTINGUISHED on recall and its false-blocker interval is below zero, idea 1 gets a card and GStack Minder's port is tested in round 2 by a paired no-loss variant against the current /review. If neither interval excludes zero, the card says so and idea 1 waits for a larger suite.

Per-unit wins (a blocker another stack found in both passes and gstack in neither; a TB2 task another stack passed 2 of 3 times and gstack 0 of 3) become idea cards only under section 11's rule, since about 10 such wins appear by chance even between equal stacks.

### 2. Lanes

| Lane | What it can tell apart | Round 1 |
|---|---|---|
| Review no-loss, combined suite | blocking recall gaps of about 20 points or more, false blocker counts, cost per blocker | yes |
| TB2 told, Haiku 5.5 and particle-1 | the largest past arm effects (Haiku minus 20 points against placebo); minimum detectable difference 11 to 17 points at 40 tasks | yes |
| TB2 told, Opus 5.5 | small effects under a partial ceiling | yes, three arms |
| HARN-14 native tasks (fix, review, qa, ship) | 20-point effects at 45 to 69% power, in native task shapes | round 2: the Captain asks harness-evals for an opening with a pstack arm |
| tstack on build tasks | nothing: tstack's skills land PRs, which no lane models | not planned |

### 3. Arms, pins and installs

Heads checked with git on 2026-10-30. The preregistration re-reads each head, pins the commit and records its git tree id and the installed tree's sha256 in `<out>/arms.json`. Nothing from either stack is vendored into this repo; the rig extracts each tree from a local clone at the pinned commit and verifies it against the commit's tree id (E_STACK_DIGEST), as it does for gstack today. No installer below calls a model.

| Arm | Source pin (plan time) | What is installed, and how |
|---|---|---|
| none | rig bare arm | No skills. Claude Code 2.1.312 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, like every arm. |
| gstack | garrytan/gstack@53522b1bbc60b3dc820842371f80ebc9db7911ec (v1.91.342.0, 2026-10-30) | Existing stack arm kind: the whole tree, installed by gstack's own `./setup --host claude --no-browser -q` into `~/.local/share/gstack` and `~/.claude/skills`. |
| pstack | cursor/plugins@c742dd61706fbacc1b95f1a20b7b988cf096ce6c (2026-10-27, the last commit touching `pstack/` or `harness/pstack/`; repo HEAD 4dd1d05818d1 on 10-29 has the same trees) | Subtree `harness/pstack/claude-code`, git tree cdbbd4ca5dd2f4ca0eef3294e7b981c0c610d4bb: pstack's generated Claude Code plugin. The rig copies it to `~/.local/share/pstack`, registers it as a local plugin in `~/.claude/settings.json`, and writes the cell's role-to-model rule file at `~/.claude/rules/pstack-models.md`. Skills are invoked as `/pstack:<name>`. |
| tstack | t3dotgg/tstack@1085050f3baed1ac724caa4a8166145fb2ac88af (2026-10-27), tree a939d866f545629c277cc9fdf766051385f3e9d9 | The whole tree; a rig installer copies its skill folders into `~/.claude/skills` (tstack has no merged Claude Code installer). Plus one rig-authored, disclosed file: a Claude Code subagent definition that runs gpt-6.1-sol through Codex CLI on the metering proxy, because sol-loop refuses to substitute a model when no Sol route exists. Its sha256 is recorded in the arm manifest. |
| gstack-placebo, pstack-placebo (TB2 cheap rungs only) | derived | The rig's existing placebo kind: Lane B's generator (`quick/laneb/arms/placebo/placebo.ts`, default seed) applied to that stack's installed skills directory. |

Rig changes this needs (keyless, section 10):

- `StackRef` in `src/types.ts` gains only an optional subtree path. The pstack and tstack installers go in the stack arm's existing per-host install map. `StackRef` is a shared type and also the overlay base, so the change goes through the units that use it. The digest check compares the extracted subtree with `git rev-parse <sha>:<path>`, and the extraction cache is keyed by repository, commit and subtree.
- The install boundary keeps what each stack needs and hashes it: the plugin root, `~/.claude/rules`, `~/.claude/agents` and namespaced skill discovery. pstack's Claude Code tree has no marketplace file, so the rig loads it with Claude Code's plugin-directory launch flag or a rig-written local marketplace (disclosed and digested), whichever the canary proves. Script dependencies (poteto-mode ships a package.json and bun.lock) install in the builder with the frozen lockfile.
- Codex CLI inside the arm images for gstack's outside voice and tstack's reviewer, using the session's proxy bearer, with no provider key in the container. The bearer stays out of the digested Sol subagent file, and that file is dropped if sol-loop can call Codex itself.
- `arms.json` and the session cache key record tree digests per arm and per cell, since the pstack rule file differs by model.
- A plugin-aware placebo for pstack: a manifest plus generated SKILL.md files only, with no playbooks or scripts, tested so the told line resolves, no pstack procedure text is present and the token ratio stays in tolerance.
- A keyless canary per stack against the rig's fake upstream, run from the final trial image: both told commands resolve, the skill body appears in the first model request, nested agents and subagents start, and poteto-mode's bootstrap script runs offline. This replaces any paid canary.
- tstack council is installed with the tree but never invoked: it needs three providers and the proxy has no Gemini row. It stays out of round 1.

### 4. Told invocation

One instruction for every review arm, prefixed by the arm's command. The preregistration freezes the exact text and its sha256.

- Instruction: review the changes on this branch against the named base. You may write and run throwaway tests, repro scripts and commands under a scratch directory. Do not change the code under review, commit or push. End with one fenced JSON findings block: file, line, severity, claim and evidence per finding.
- Prefix: none has no prefix; gstack `/review`; pstack `/pstack:interrogate`; tstack `/sol-loop` plus "run one review round and stop before any fix".
- Every pass starts from a clean copy of the unit, so one pass's scratch files never reach another. The scratch rule lets pstack's adversaries and the lead's reruns work, and gives the other arms the same room.
- A fixed parser with golden tests per arm reads the findings block. A missing block counts as zero findings, flagged, never as a model-normalized guess. Findings are rendered to the contract's fields before `judge-packet`, so pstack's evidence format cannot identify it to the judges.
- The tstack prefix cuts sol-loop to its first round, which understates its full loop. The preregistration and the results say so.

TB2 uses Lane B's told form: the prompt opens with the arm's command, so the CLI injects the skill body from turn 1. gstack opens with `/investigate `; pstack with `/pstack:poteto-mode `; placebos use the same line as their stack.

Severity is read two ways. The primary map, frozen at preregistration, uses each arm's native labels: gstack CRITICAL, interrogate findings its lead confirms, and tstack blocker and should count as blocking; interrogate findings left unconfirmed count as informational. Blinded judges also rate the impact of every finding under one common rubric, apart from correctness. Sensitivity tables, applied to every arm alike: recall at any severity; tstack should as informational; pstack confirmed findings split by pstack's own severity where it gives one; blocking by the judges' impact rating.

### 5. Models

- Opus 5.5 drives every Opus cell. Each stack keeps its prescribed cross-family voice where the proxy prices it: gstack's outside voice and tstack's reviewer run on gpt-6.1-sol. pstack's Grok seats run on the session model, per pstack's own Claude Code map. pstack's Cursor-only panel is not measured.
- particle-1 runs in both lanes: TB2 all five arms; review one pass of none, gstack and pstack (tstack's reviewer is Sol by design, so a particle-1 driver adds little).
- Haiku 5.5 runs in TB2 only.
- Cheap cells use one rule for every stack: every role and reader runs on the cell's model. gstack's preferences pin its readers to the parent model and its outside voice is off; pstack's rule file pins every role to the parent. The proxy allowlist admits only the cell's model. Refused requests are counted per arm and cell, and an arm with more than 2% of its requests refused in a cell is reported as degraded there. The results disclose the adaptation.
- Out, with reasons: Sonnet 5.5 (quick look 3 already reads it for gstack on the same route; about $60 more in TB2 if the Captain wants it back); DeepSeek V4.1 Flash (shares particle-1's route and base model); the open-weight slots (they belong to the ladder preregistration; the preregistration still re-reads the OpenRouter programming ranking and records `meta.as_of`).
- Judges: Opus 5.5 first, gpt-6.1-sol second, on blinded judge packets (`noloss judge-packet`); a third read by Opus 5.5 on a reshuffled packet when they disagree.

### 6. Suite and sample size

`gstack-evals noloss suite --from-catalog lanes/review-replay/catalog/public --id stacks-combined --released 2026-01-01 --with gsta167-14pr` gives 56 units in 55 clusters: 42 blocking blockers, 6 over-blocking, 23 detection-only and 3 ineligible (rechecked keyless on 2026-10-30). The 42 blocking blockers sit in 27 units on 26 PRs, 19 units from gstack and 8 from gbrain. Round 1 runs those 27 units plus the 6 over-blocking units: 33 units, 2 passes per arm on Opus, 66 unit-passes per arm.

Power (GEVA-55 from the lane's power tool, to be regenerated into `tables/` at preregistration): with 26 PRs, 42 blockers and 2 passes, an arm equal to gstack is called NO_LOSS 45% of the time at the 10-point margin, and a 23-point loss is detected 92.5% of the time. With GSTA-167's 14 PRs alone: 35% and 77%.

Each unit's repository is built from a fetch of its head commit alone: no tags, no remotes, no reflog, packs pruned. A keyless test checks that `git rev-list --all` equals the head's ancestry and that DNS fails inside the unit. Repository files that load as instructions (CLAUDE.md, AGENTS.md, .gstack/) stay, since they are part of the PR, and their digests are recorded per unit.

The gstack arm installs gstack at a later commit than 19 of the 27 blocking units, so it carries fixed versions of some files under review. The gstack arm image omits each unit's diff paths from the installed gstack tree where the canary still passes, and a frozen transcript rule flags any read of such a path under the installed root. Primary results are reported with and without flagged passes.

Every unit image is built and its own test command run before the preregistration freezes. Units that fail are dropped then, for every arm alike, and power is regenerated on the survivors. If fewer than 22 PRs survive, the lane returns to the Captain.

### 7. Statistics and decision rule

- Review primary: the lane's existing one-sided LOSS verdict of pstack and of tstack against gstack at the 10-point margin, exact sign-flip over PR clusters, Holm across those two comparisons. The power table is regenerated at preregistration for that family. Beside it, a descriptive two-sided paired recall difference with its interval. NO_LOSS cannot be issued at this size: exit 2 (NOLOSS_UNDERPOWERED) is the expected result of any such call, and the verification steps treat it so.
- False blockers: a blocking finding that blinded judges rule not a defect, plus any blocking finding on the 6 over-blocking units. The per-PR count is paired across arms and tested by exact sign-flip over PR clusters, two-sided. The preregistration freezes the smallest per-PR drop that counts; this plan proposes 0.5 per PR.
- Review secondary: each arm against none; cost per blocker found.
- Home-field bias: every suite blocker came from gstack-family reviews. Before the paid run, each blocker is labelled keyless as provable by a run at the PR head or not, from its case record, and recall is reported by that stratum for every arm. The pooled table of new blockers (unmatched blocking findings that blinded adjudication upholds) is a named secondary with its own paired test. The gbrain and escaped-defect strata are reported apart.
- TB2, per model: pstack minus gstack and pstack minus pstack-placebo, task-clustered bootstrap (10,000 resamples), as in quick look 3. A stack wins a cell when its interval against gstack is above zero and, on cheap rungs, its interval against its own placebo is too.
- Claims allowed: which procedure kept more of these blockers on these PRs, raised fewer false blockers, and at what cost. Not allowed: no loss, equality, or which stack is better in general.

### 8. Cost, with sources

Metered sources (each is a file in the repo or the Captain drive):

- M1: Captain drive `ledger/laneb-quick-3.jsonl`, settle rows, mean USD per TB2 trial: Opus 5.5 none $0.169 (n 118); Haiku 5.5 none, gstack, placebo $0.0088, $0.0154, $0.0145; particle-1 $0.0685, $0.0777, $0.0842; Sonnet 5.5 none and gstack $0.0519 and $0.0911.
- M2: Captain drive `ledger/laneb-quick-2.jsonl`, settle rows: Opus 5.5 gstack $0.323 per trial (n 66), placebo $0.327.
- M3: `lanes/review-noloss/arms/gsta167-14pr/C/cost.tsv`: gstack's full review C used a mean of 27.5M root-counter tokens per PR over 12 PRs; the C2 pass on PR 3593 used 40.5M.
- M4: this thread's platform counter at plan time, 716.18 credits for 2,006,952 tokens, so 0.357 credits per 1,000 tokens. At R42's stated rate of about $1 per 1,000 credits (a rule, not a meter) that is about $0.36 per million root-counter tokens.
- M5: `tables/review-tokens.json`: an Opus 5.5 specialist dispatch takes a median 88,869 input and 6,929 output tokens.
- P: `src/runner/pricing/prices.ts`: Opus 5.5 $4 input and $20 output per million; gpt-6.1-sol $2 and $10; particle-1 $0.1 and $1.

GEVA-55's draft also cited GSTA-167 round 5 (59,322 credits for 181.9M tokens). No copy exists in the repo or the drive, so this plan does not use it; M4 gives a close rate.

Per unit-pass on Opus, review lane (all estimates, built from the sources named):

| Arm | Estimate (range) | Basis |
|---|---|---|
| none | $1 (0.5 to 2) | Estimate. One Claude Code session; an Opus TB2 session costs $0.169 (M1) and one specialist-sized read is about $0.50 uncached (M5 at P). |
| gstack /review | $8 (5 to 14) | Estimate. High end: M3's 27.5M to 40.5M tokens at M4's rate is $9.80 to $14.50; a scenario, not a bound, since Capy's counter and the proxy's API prices meter different things. Low end: about 10 readers per PR at $0.50 each (M5 at P). |
| pstack interrogate | $5 (2.5 to 7.5) | Estimate. No metered pstack run exists; assumes 3 to 5 adversaries at about one specialist dispatch each plus their proof runs and the lead's reruns. |
| tstack sol-loop round 1 | $1.80 (1 to 2.5) | Estimate. An Opus driver session about $1, plus one Sol read of 89k input and up to 15k output at P, about $0.33. |

Projection:

| Item | Central | Basis |
|---|---|---|
| Review, Opus cells (4 arms by 66 unit-passes) | $1,043 | estimate: table above |
| Review, particle-1 cell (none, gstack, pstack; 33 units, 1 pass) | $187 | estimate: Opus estimates times 0.405, the particle-1 to Opus cost ratio for the none arm in M1 |
| Review judging | $110 | estimate: 66 blinded packets read by Opus and Sol at about $0.75 a packet, plus adjudication of unmatched findings and third reads |
| Review pilot (2 units near C's median and 90th-percentile token counts, 4 arms, 1 pass, plus checks) | $60 | estimate |
| TB2 Opus (none, gstack, pstack; 40 tasks, 3 replicates) | $106 | none $20 (M1), gstack $39 (M2), pstack $47 (estimate: M2's gstack cost plus 20% for a longer body) |
| TB2 Haiku 5.5 (5 arms) | $9 | none, gstack, placebo $4.70 (M1); pstack and pstack-placebo $4.40 (estimate, at M1's gstack rate plus 20%) |
| TB2 particle-1 (5 arms) | $50 | none, gstack, placebo $27.60 (M1); pstack and pstack-placebo $22.40 (estimate, as above) |
| TB2 pilot | $6 | estimate |
| Round 1 eval spend | about $1,570 (range $930 to $2,520) | sum; the range uses each row's low and high ends |

Per-arm pilot costs replace every estimate above before a grid starts.

Total for R42, which counts machines and model use: the $2,400 eval cap, plus unit images and TB2 VMs (estimate about $100; no metered VM price is in the repo or drive), plus the build threads' model use (estimate about $40: five units at up to 20M tokens each at M4's rate). About $2,540, under the $5,000 heads-up line. Every Ubicloud call sets UBI_OWNER to its thread code, and every VM is deleted when its job ends.

This thread's own model use (cap 20M tokens, about $7 at M4's rate) is outside the eval cap.

### 9. Cap, stops and start rule

- Cap $2,400. Hard stops: review $2,050, TB2 $300, each its own line item in the program ledger (`docs/budget-ledger.md`) with an approval row that quotes the Captain's approval under R42.
- Start rule after each lane's pilot, per arm and model: settled spend, plus reserved and unknown exposure, plus 1.4 times each arm's pilot-measured cost per unit-pass times its remaining unit-passes, plus the remaining judging estimate, must fit under the lane's stop. Otherwise the lane returns to the Captain before its grid. Keyless ledger tests cover the calculation.
- Each slot's allowance is twice the pilot's largest unit-pass for that arm. A pass that hits its allowance is an incomplete pass, reported apart, never scored as missed blockers.
- Drop order if the start rule fails: the particle-1 review cell, then pass 2 on the 6 over-blocking units, then pass 2 of the none arm.
- A cap or stop hit is an incomplete run, reported as such and never rerun to change a verdict.

### 10. Build order

Keyless first; each step is its own unit and pull request. Steps 2 and 3 share no files and run in parallel.

1. Stack arm kinds: the `StackRef` subtree path, the pstack and tstack installers in the existing install map, the install boundary, Codex CLI with the proxy bearer, the Sol subagent file, the per-cell pstack models rule and gstack preferences, the pstack placebo, and the keyless canary per stack. New reason codes go in `src/errors/codes.ts`, then `bun run errors:doc`.
2. Review units as trials in `src/trial` (cache keys, resume, receipts, rig admit), not a new runner: unit images from head-only fetches, the history and DNS test, the frozen told prompt, the findings parser with golden tests, `cost.tsv` from the proxy journal with the usd column filled, and the per-cell proxy allowlist.
3. TB2 arms: pstack and pstack-placebo arm tarballs and the skill map for the quick look 3 runner.
4. Preregistration pull request: heads re-read and pinned, tree digests, the told text, severity maps and rubric, the keyless provable-by-a-run labels, the unit-image check and the surviving power table, the null for idea cards, the OpenRouter ranking's `meta.as_of`, the ledger line items.
5. Paid run under the ledger: pilots, start rules, grids, judging, scoring.
6. Results pull request (never the same pull request as the preregistration), with idea cards and a pin-drift note: the pinned interrogate tree diffed against pstack's head at results time, saying whether the tested mechanism changed.

Approved by the Captain (item J): write the seeded-mistake Lane A tasks for pstack correct as their own keyless unit during steps 1 to 3, with no spend. It ships in its own pull request, not in this plan's.

If Garry approves item I: the 3-day fidelity window with Lauren Tan and Theo Browne runs in parallel with steps 1 to 3 and closes before step 4, so it adds no delay. If he does not, the steps run as listed.

Target: results within 10 working days of this plan's approval.

### 11. When another stack wins: idea cards

Each candidate win is compared with what chance alone would produce: the expected count of per-unit wins under the null, from permuting arm labels within each unit, is printed beside each observed count. A card needs observed wins above the null's 95th percentile, or a mechanism a blinded reader can name from the transcripts. Cards are ranked by that margin.

Each card names the stack and skill with its author, the mechanism in our own words, the gstack skill it would change, and the test that would prove a port (a Lane A before/after with the tasks written first, or a paired no-loss variant against the current /review). The Captain hands cards to GStack Minder. A port ships only after its own test passes. This plan ports nothing.

### 12. Out of scope

- Any paid model call from this plan or its pull request.
- Installing either stack in a way that calls a model.
- Porting ideas into gstack (GStack Minder owns that, through the Captain).
- tstack council (no Gemini route), pstack arena and correct (round 2), HARN-14 native tasks (round 2).

### 13. Risks

- Home-field bias in the suite (section 7). Blind adjudication of unmatched findings limits it; it cannot remove it.
- pstack's default role map puts judgment roles on Opus at extra-high effort, so an interrogate run may cost more than estimated. The pilot measures it, and the start rule catches it before the grid.
- Told invocation favors procedures designed to be told. Untold arms are excluded because pstack cannot fire untold.
- Cutting sol-loop to one round understates tstack. The results say so.
- The suite's PRs are public, and later fixes exist on GitHub. Units run offline at the PR head with network only to the proxy.
- Two passes and 26 PRs cannot certify no loss. The claim limits in section 7 apply.
- Per-unit images may fail to build for some gbrain units. They drop for every arm alike, before any paid call.

### 14. Verification

- Each build unit: `bun test`, `bun run typecheck`, `bun run errors:check`, `bun run wiki:check`, and its own keyless tests against the fake upstream.
- Each stack's keyless canary passes, and `arms.json` records repo, sha, subtree path, git tree, tree sha256 and image digest.
- Pilots reconcile proxy spend with the ledger before any grid starts.
- `noloss export --check` passes on the scored arms, and `noloss score` exit 2 (NOLOSS_UNDERPOWERED) is treated as expected.

### 15. Needs

- Garry's standing "rec" (2026-10-30), applied at gate_rev 1 and gate_rev 2. The Captain approved J. I waits for Garry's word, which the Captain has asked for; the plan works either way.
- The Captain's cap approval under R42 (given in the brief).
- For round 2: an opening in harness-evals for a pstack arm on HARN-14.

## Review record

The run's public review record is attached as review-record.md (sha256 bf3f574d70064199d96d6109b90c7e8752a06daa586f6385ca2ebcaa50c2e0c4), with em dashes replaced by hyphens.

---
id: 2026-11-04-geva-282-g-o5-pin
kind: plan
title: "G O5 pin: #210's merge commit, the told arm's lite render, the mutation tools, G's amendment and a keyless dry run"
summary: "Pins G to 17253ec and gstack 699a41cb's lite render (tree ed09c8c8, equal to #193's). A keyless dry run drives every O5 check at 17253ec, including O2's Docker suite, and records G's amendment."
author: GEVA-282
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-04
status: open
links:
  - 2026-11-04-geva-262-g-family-admission-prereg
  - 2026-11-03-geva-225-outcome-per-skill-plan
  - 2026-11-04-geva-273-r3b-pin
  - garrytan/gstack-evals#210
  - GST-1361
attachments:
  - 49b3a2a2aa80ecb81bc8376a3b4b3b434bc53cd2766c7ba349a268ed8b8d408c  dryrun.sh.txt
  - 16a0514afed1e6c6767de3a76a00eaee47e418f071de3535e40aa94dd821980d  dryrun.txt
  - 5cec40ec813a9f5a9847112dd63ea35d64fe0b341ace44f1d29b992bb5caacc4  admission.sh.txt
---

# G O5 pin

The [G prereg](../2026-11-04-geva-262-g-family-admission-prereg/README.md) (section 10, item 6) and [plan v3](../2026-11-03-geva-225-outcome-per-skill-plan/README.md) (section 13, item 6) hold every paid G stage until O5, a keyless dry run, has passed. This post pins the commit O5 ran at, records G's amendment as GSTA-2 decided it, and carries the dry run. The Captain records the stage caps in approvals/ after this post merges. This post adds no approval.

## ELI5

G tests whether two gstack planning skills help a frontier model, and it spends money only after a free rehearsal called O5 passes. This post is that rehearsal. It fixes the exact code and gstack version G will run, and it runs every start rule once with no keys, no VM and no model call. Every check passed. Two things still have to happen before the first paid stage: T-G's task images must be pinned, and admission sessions must be tied to the U4 spending ledger. Both are named below as open start conditions with owners.

## Before → after

Before: G's paid stages waited on O5, and the pin, the metered-input rule and G's amendment were spread across a prereg, a plan, a Captain decision and three PRs. After: one post names the commit, the gstack pin, the amendment word for word and the two open start conditions, and carries a dry run that drives every rule it can drive at that commit.

## Why it matters

A paid run on unpinned code, or on a rule nobody exercised, can spend its cap and answer nothing. A dry run that drives each rule finds a broken rule while it is still free to fix.

## What caused this work

The G prereg (section 10, item 6) and plan v3 (section 13, item 6) hold every paid G stage until O5 passes. GST-1361 Part 1 (#210) finished the code O5 needs, and this is Part 2.

## Big decisions

- **Metered inputs (GSTA-2, A).** The code refuses only a missing MULT, so the admission command enforces the rest (section 2). The pick would flip if a wrong value could overspend a cap, but U4 leases and O6's envelope bound every paid stage.
- **Open start conditions, not a wider post (GSTA-2, rec at the R65 gate).** Image pinning and the U4 session driver are not built at 17253ec, so this post names them as start conditions with owners instead of waiting for them (section 1). A paid stage cannot start until both are met.

## Implementation plan

### 1. The pin

- **Build commit:** 17253ec47e4cb13b1c9b0ce09615762d958b4cb1, the squash merge of garrytan/gstack-evals#210 (GST-1361, Part 1). G's run threads run lanes/outcome-skills, src/runner/stats and src/runner/ledger from this commit only.
- **gstack:** 699a41cb6808e01240d02e82247693f9170d401a (v1.94.39.0), fetched by sha with `git fetch --depth 1 <repo> <sha>`. Its git archive has sha256 adfefb56eebb360f9cd4c3087a980ed510106e4b8096e4afcf0a3854d1a88bb4, the value in #202's after-pin manifest (quick/laneb/arms/manifests/l1/after.json).
- **Told arm, lite render:** told-install.sh (`./setup --host claude --loadout lite` in a clean HOME) gives 204 render files with tree digest ed09c8c81574c6446a9579d255bd919470e4792bfc3ced4df42fd3fdc66dc8a7. That equals #193's after-pin lite tree digest, recorded in wiki/plans/2026-11-03-geva-254-l1-overhaul-prereg-2000/install-manifest.md (row "lite tree digest, normalized (setup render)", after-pin column) and carried into told.ts's TOLD_PIN and #202's after.json. The lite spec has sha256 c5df50f999eb649abc0cd48c40907fe29c5ba71e4534a5cc63ae6e3d26234f1d. The hooks are Stop gstack-timeline-stop (timeout 5), Stop gstack-skill-contract (10) and UserPromptSubmit gstack-skill-route (5), each at the sha256 TOLD_PIN pins.
- **None arm:** no install. The arm runs in the C1 clean room, checked by cleanRoomPreflight (section 4).
- **Arm images:** G's sessions run in T-G's task images, and T-G is not built at 17253ec, so no arm image exists to pin here. Pinning them is open start condition 1 below. The run binds the none arm's image by its image id: cleanRoomPreflight refuses any other id (dry-run line C1), and the admission run thread records the id per task before any lease opens. The dry run used busybox:1.36 (image id sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662) as a stand-in image for the clean-room checks only.
- **Open start conditions.** No lease for a paid G stage opens until both are met:
  1. **Arm image pins.** A committed per-task manifest of image ids or digests (in T-G's post or a pin amendment) binds both arms to the same image for each task, and cleanRoomPreflight passes on each real task image before any lease opens.
  2. **U4 session driver (GST-1381), owned by GSTA-2.** At 17253ec, real_agent.py opens each session at Lane B's /sessions route and JSONL ledger, which prereg section 10, item 4 forbids, and nothing ties admission sessions to a U4 lease. The driver binds each session to a MeteringProxy slot on its stage's U4 lease, with its own keyless dry run that drives real_agent through that slot. O5 clears item 6 only; item 4 stays open until GST-1381 lands.
- **Mutation tools:** pins.ts at 17253ec, built by O2's Docker suite in the dry run (lines D4).

| Language | Tool and version | Licence | Base image | Tool image id as built at 17253ec |
|---|---|---|---|---|
| rust | cargo-mutants 27.1.0 | MIT | rust:1-slim-bookworm@sha256:ed2c95ca377d6571b124b05e75e01207973ded639dce7d5542eb7bcd797e32aa | sha256:448dd5c1162b2abc0119668dcec98d4da527c66ffd9e74d3a54a43edd6b2d0a3 |
| typescript | StrykerJS (@stryker-mutator/core with @stryker-mutator/vitest-runner) 10.1.1 | Apache-2.0 | node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c | sha256:b7a4786392934a073be376c7e3bd38b2a6f875dc7bb243fd509b4b353d78cdeb |
| python | mutmut 3.8.1 | BSD-3-Clause | python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337 | sha256:8d84d40f027e8cd7c40d8f74819dab209581ffb81a7ad2d51d119cd4d4d0fe03 |
| go | go-mutesting (avito-tech fork) v0.0.0-20261002081621-9ce5f731e321 | MIT | golang:1.27-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 | sha256:57bbb361eb894ff8799331e1b3b4afddfa21167df8937403bb9cdb6c9f35473d |

The tool image ids are local builds from those Dockerfiles; the base image digests and tool versions are what pins them.

### 2. GSTA-2's decision on the metered inputs

The brief asked the dry run to show that an admission run with AGENT_USER set, or without M_PER, M_AP, AUTH_PAID or MULT, is refused. At 17253ec the code refuses only a missing MULT. GSTA-2 decided, in these words:

> A, decided by GSTA-2. The brief was wrong and my #196 note was right: the code refuses only a missing MULT. Paid stages are still bounded by U4 leases and O6's envelope check, so a wrong value mis-sizes power. It can't overspend a cap. That makes a brief rule enough for now.

This replaces the brief's "run without them, it is refused". The dry run shows both directions (lines R1 to R6): resize.py with AGENT_USER set exits 0 and moves the wave-1 figure from $9,393 to $6,075; with M_PER, M_AP or AUTH_PAID missing it exits 0 with output identical to the run at plan v3's house value; with MULT missing it exits 1.

**The admission command.** Item 5's re-size runs only through admission.sh.txt, attached, with AGENT_USER unset and all four values passed explicitly:

```
env -u AGENT_USER MULT=<m> M_PER=<m> M_AP=<m> AUTH_PAID=<m> [AUTH_EXTRA=<m>] bash admission.sh.txt <gstack-evals checkout at 17253ec>
```

Its first five lines are MULT, M_PER, M_AP, AUTH_PAID and "AGENT_USER: unset" (or "set", never a value), printed before anything else runs. AUTH_EXTRA is optional: left unset, resize.py reads 1.2 without a refusal, and the sixth line says so ("AUTH_EXTRA: unset, resize.py reads 1.2", line R7a). It opens no lease. It refuses with exit 2 when AGENT_USER, YIELD_G or TOLD_SCALE is set, when any of the four values is missing, or when resize.py's sha256 is not the prereg's attachment line, and otherwise runs resize.py with exactly those values. Lines R7 to R11 drive it: R7 and R7a the run with all four values, R8 AGENT_USER set, R9 each of the four values missing, R10 YIELD_G and TOLD_SCALE set, and R11 a resize.py whose sha256 is not the attachment.

### 3. G's amendment

GSTA-2 decided each rule. Each is recorded word for word, with its reason in one line.

1. **Clean room.** "The stricter clean room: the second scan in clean-room.ts and every path it reads. The vendored C1 clean-room.sh stays unchanged." Every path the second scan (CLEAN_ROOM_O1_SCRIPT) reads at 17253ec, home and work dir as the preflight passes them: $home/.gstack; present at all: $home/CLAUDE.local.md, $home/.mcp.json, $home/.claude.json, $home/.claude/.claude.json, each entry under /etc/claude-code (or /etc/claude-code itself when it is not a plain folder), and in each work dir CLAUDE.local.md, .mcp.json, a CLAUDE.local.md in each parent, and any .claude/skills folder below it outside .git; naming gstack in any case: $home/CLAUDE.md, a CLAUDE.md in each parent of a work dir, .claude/settings.json and .claude/settings.local.json in the home and each work dir, and any entry under .claude/commands, .claude/plugins, .claude/agents and .claude/rules in the home and each work dir, and under $home/.claude/projects/*/memory. Reason: the none arm must see no gstack trace that Claude Code loads, and the arm sets CLAUDE_CONFIG_DIR=/root/.claude, so $home/.claude/.claude.json is its global config file.
2. **Section rule (plan-eng-review).** "The plan-eng-review section rule: a section counts only under a # or bold heading in the pin's numbered forms (Section N, N. Name review, N) Name review), and only when content follows." "A section's body ends at the next heading of the same or higher level, or at the next recognized section heading, whichever comes first. A bold-line section heading ends at any # heading." "A bare numbered line is never a section heading. An inline verdict alone is never content. Named limitation: a real section written as a bare numbered outline is missed." The A1 sentences replace the brief's "only when content follows before the next section heading". Reason: the detector reads Sections 1 to 4 as the pin writes them, and a heading with nothing under it is not a section the session did.
3. **Runner rule (mutation scorer), as lanes/outcome-skills/mutation/README.md words it at 17253ec.** "When the agent's tree fails to load or collect its tests, and the same runner collects the task's unmodified reference tree cleanly, the tree is `no-passing-tests`: score 0, every changed unit dropped." Python: "`pytest --collect-only -q` on the agent's changed test files (file paths, not node ids) exits 2 or 5 with an `ERROR collecting <file>` line. The reference collects the same test folders, or the whole tree when none of them exists there, with exit 0, or 5 and no ERROR line." The refinement: "When the agent's tests load but run nothing, and the same runner runs the reference tree's tests in a fresh container as above, the tree is `no-passing-tests` too, because tests that never run kill nothing. A tree whose reference also runs nothing stays `tool-error`." Python: "`pytest --collect-only -q -rs` on the agent's changed test files exits 5 with no ERROR line, and a `SKIPPED [n] <file>:<line>:` line names each file: every file was skipped at module level (`pytest.importorskip`, or `pytest.skip` with `allow_module_level`). The reference runs when the same command on the same test folders exits 0 with no SKIPPED or ERROR line. When any of those folders is missing from the reference tree, the tree stays `tool-error`, as a new Go package does." The Go, Rust and TypeScript signals are the README's, lines 47 to 53 at 17253ec. The transplant reading is unchanged. Named limitations: per-language collect asymmetry (both arms see the same task languages, so the arm comparison holds), and a Rust test in a module shared by lib and bin reads tool-error. Reason: a broken or empty test file kills no mutant, so it scores 0, and only a runner fault the reference shares counts against the instrument.
4. **Round-3 grant (approval a-4bec90d94fd6).** "Grant one scoped fix round for #210 at 3377197: any agent Python test folder the reference tree lacks stays tool-error, matching Go and round 1, fixed in run.ts with a Docker test written first in both directions, checked by one fix-check on the fix range as gstack's planner prints it; no other item enters this round." Reason: it records why the Python missing-folder clause in rule 3 is in the code.
5. **Contaminated trials.** "Contaminated trials count as gaps for admission item 4." Reason: a contaminated trial is a rig failure, so it counts against the rig, not the skill.
6. **Sampled trials.** "A contaminated or unread sampled trial is replaced under section 5, like a gap. If the replacement is exhausted, the skill routes FIX-METHOD (rig)." Reason: item 2 needs 8 read trials, and a trial the detector can't read says nothing about exposure.
7. **Envelope-trim path.** "On the envelope-trim path, plan-eng-review re-sizes alone first, then autoplan alone, as in pick C. resize.py has no trim route, and the path can't fire at wave 1's planned $8,482. The program-wide trim order of plan v3 section 8 sits with O6 and the Captain, not with G's scorer." Reason: one survivor order for G, and the program's trim stays where the envelope is.
8. **Metered inputs.** "Admission run briefs unset AGENT_USER and pass M_PER, M_AP, AUTH_PAID and MULT explicitly." Section 2 pins the command. Reason: the code refuses only a missing MULT (section 6, Limits).
9. **Inputs.** "Every input the rules read is in handoffs/GEVA-277/o5-inputs.md and handoffs/GEVA-266/runner-fix.md." These are in the Captain's drive. Reason: one place for a successor to check each rule's source.

### 4. The dry run

dryrun.sh.txt ran at 17253ec47e4cb13b1c9b0ce09615762d958b4cb1 and printed dryrun.txt. It exports the commit with git archive outside any git work tree, runs with every key variable unset, and calls no model and starts no VM: the metering proxy's upstream is a stub that returns a fixed usage, and no Ubicloud runner is called. Each check prints one line, and the first miss prints DRYRUN: fail and exits 1. It ran 87 checks and ended DRYRUN: ok with exit 0.

- **Part A, the told arm.** The pin is fetched by sha, and its git archive matches #202's. told-install.sh installs it, checkToldHome passes, and the tree digest equals TOLD_PIN, #202's and #193's. A fresh `gstack-modules render --host claude --loadout lite` at the same path matches the installed render byte for byte, all 204 lock files and nothing extra (l1.ts liteMatch). O1's pin tests (told.test.ts, autoplan.test.ts) pass with OUTCOME_TOLD_HOME and OUTCOME_GSTACK_PIN set, none skipped.
- **Part C, the clean room.** cleanRoomPreflight, by image id, passes a clean room, refuses another digest, refuses a seeded drive mount and a drive in the home (C1's scan), and refuses each path in section 3, rule 1, one line each (C4 to C28, plus C30 for "GStack" in mixed case and C31 for /etc/claude-code as a file). A settings.json and a command that do not name gstack pass.
- **Part L, O6 and U4.** On a temporary ledger with a stub gstack-approvals (it writes its rows to a temporary file only), the program envelope is recorded at $10,000 and $2,000 a skill. Each stage of prereg section 9 is initialized at its cap and leased once through the envelope: T-G $60, admission none $229, told plan-eng-review $572, told autoplan $1,287 and VM $24. With all five open, the envelope holds $728.50 for plan-eng-review and $1,443.50 for autoplan (section 9's $729 and $1,444), and refuses a further $600 autoplan lease with ENVELOPE_SKILL_STOP. Every one of the five leases opens with --admission warn and prints RIG_UNPROVEN (line L2a). Each lease then spends and settles: T-G and VM through one stub reservation, and each admission arm through one metering-proxy slot bound at its registry.json session limit ($8, $20, $45). Every slot refused the call that could pass its limit, at 0.0% overshoot, inside section 9's 10%. After settlement nothing is open and settled spend equals what the stubs spent.
- **Part F, futility.** On made-up trials (60 tasks, half of 30, MDD 18.6 points), an estimate trending helps and one trending hurts both continue, a flat estimate stops, and a flat one leaning to none stops as a loss lead.
- **Part R, metered inputs.** Section 2.
- **Part D, O2's Docker suite.** `GSTACK_EVALS_DOCKER=1 bun test tests/outcome-skills/mutation-docker.test.ts tests/outcome-skills/clean-room.test.ts` at 17253ec gives 83 pass and 0 fail (57 and 26 tests, the two files #210's count covers), strong Python 8 of 10, Go 14 of 18, Rust 17 of 19 and TypeScript 17 of 19 killed, and weak 0 of 4 in every language, the same as #210's run at 1414d46.

Run it as `bash dryrun.sh.txt 17253ec47e4cb13b1c9b0ce09615762d958b4cb1` from this folder, with Docker, bun, jq and Python 3. It takes about 15 minutes, most of it the Docker suite. The outcomes in Parts L and F come from stubs and made-up trials. They test the rules, not gstack.

### 5. Limits

- The code refuses only a missing MULT; resize.py passes its environment to cost.py, which reads AGENT_USER; admitG omits M_PER or M_AP when a told arm has no scored trial. The admission brief enforces all three; a fail-closed code guard is a follow-up.
- A session that copies the pin's same-level heading layout with no line between headings reads that section as unexposed; a low sections_in_order rate at admission is a harness limit (FIX-METHOD), not a null.
- #210's named fail-closed notes: an unrelated module-skipped reference test file makes the run-nothing check read tool-error (F2); a possible legacy $CLAUDE_CONFIG_DIR/.config.json is unverified and unscanned; .claude/output-styles, .claude/hooks and a custom auto-memory folder are unscanned (gaps from before #210); a folder name starting with "-" cannot reach pytest from the agent.
- The session limits are driven at a U4 metering-proxy slot. At 17253ec the real-outcome rig's agent (lanes/real-outcome/agent/real_agent.py) opens its session at a control service's /sessions route, which is Lane B's JSONL ledger in its earlier lanes. The prereg (section 10, item 4) allows only U4 leases, so each session must be bound to a U4 lease before any paid stage. That driver is open start condition 2 (GST-1381, owned by GSTA-2). It is not built at 17253ec, and this dry run does not drive it.
- The dry run's items lease with `--admission warn`, because no rig admission record exists without a rig run. Each lease prints RIG_UNPROVEN, and line L2a asserts it for all five. Paid items use `--admission required`.
- The clean-room checks run in a stand-in image, not T-G's task images (section 1).
- The fresh render's loadout.lock.json has other bytes than #202's lock file, though every one of its 204 files matches. The lock is not part of the tree digest.

### 6. Outside terms

Prereg section 12 answers the question, and nothing in it changes. One addition: the dry run pulls busybox:1.36 (GPL-2.0) from Docker Hub as a stand-in image for the clean-room checks. It runs locally and is not redistributed. The fixture words on the temporary ledger approve nothing.

### 7. Attachments

| File | What it is |
|---|---|
| dryrun.sh.txt | the dry-run script, run as `bash dryrun.sh.txt 17253ec47e4cb13b1c9b0ce09615762d958b4cb1` |
| dryrun.txt | every line it printed at 17253ec |
| admission.sh.txt | the admission command for item 5's re-size (section 2) |

## Review record

/autoplan --kind feature (R65, gstack 1.95.5.0), run autoplan-r65-20261104220544: one Opus 5.5 reviewer at high reasoning read this post and dryrun.sh.txt at ea157e6. It raised two High findings (the arm images are not pinned; nothing ties admission sessions to a U4 lease), two Medium (RIG_UNPROVEN was not asserted; three admission.sh.txt refusals were not driven), two Low (the AUTH_EXTRA fallback; two clean-room cases not driven) and one Informational (tool image ids are local builds, which section 1 already says). On outside terms it found nothing beyond prereg section 12 and the busybox:1.36 stand-in. GSTA-2 answered the gate: "rec, A, C, decided by GSTA-2." This one revision applies d1a and d2a (section 1, open start conditions), adds the Medium and Low fixes as dry-run lines L2a, R7a, R10, R11, C30 and C31, and adds the five summary sections. The dry run was rerun once after the edit.

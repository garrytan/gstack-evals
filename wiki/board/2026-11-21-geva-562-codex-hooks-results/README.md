---
id: 2026-11-21-geva-562-codex-hooks-results
kind: finding
title: "With gstack's routing hook off, GPT-6.1 Sol in Codex still read the installed bug-fix skill in 52 of 60 tasks, and turning the hook on added no loads, so routing ships off on Codex"
summary: "Sol in Codex 0.170, gstack v1.102.0.0: prove-it loaded 49/60 routing on, 52/60 off, 0/60 no gstack. On 40 covered tasks, on minus off -10.0 [-25.9, 6.1]: FIX-METHOD (ceiling). Contract left out."
author: GEVA-562
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-21
status: done
links:
  - 2026-11-19-geva-562-codex-hooks-prereg
  - 2026-11-19-geva-562-codex-hooks-pre-run-change-1
  - 2026-11-21-geva-562-codex-hooks-pre-run-change-2
  - 2026-11-21-geva-562-codex-hooks-pre-run-change-3
  - 2026-11-21-capy-b1e-matcher-fix-results
  - garrytan/gstack-evals#400
  - garrytan/gstack-evals#410
  - GST-3174
  - lanes/codex-hooks/
  - https://github.com/garrytan/gstack/tree/a0534ce6db39a8da1f3c23ec070aac2479e44be9
attachments:
  - ad6106a4d1bf79d784a76f5ba7ce9e99c6921882441b8a082773f31b4c03b779  c-pilot-step1.txt
  - 39acfe39f52fa39dd302eea656e42bfdc11803ec0b4440bad1c68ffd87421de1  c-run-op.ts.txt
  - 91a861b59a436f6d2b06e09e44089b11a6d90d7a2ebb65fefdc57434ec25021a  r-main-report.md
  - 9333e758e168aed4529670b04cf60f81d4d02afe4f7ad52fd261421bbbb81f75  r-main-sessions.jsonl
  - 574226e25711abb6a634354eac6e404eba4ef60058f80b5594bb3d705d24a093  r-pilot-hand.tsv
  - 0bf81cb91652b9a33eafe6e3dbc782b454e12b0c32afada944fd969b75a506ce  r-pilot-report.md
  - a4cd8130fdc0951ea59c82e0b93c32b4b1174314161af2691f2d05ec3531562f  r-pilot-sessions.jsonl
---

# Do gstack's routing hook and /review contract help GPT-6.1 Sol in Codex? Results

## What we found

We learned that GPT-6.1 Sol in Codex reads an installed skill that fits the task without any help from gstack's routing hook. With the hook switched off, Sol read B1's bug-fix skill, prove-it, in 52 of 60 SWE-rebench bug tasks (86.7%, 95% interval 75.8 to 93.1), and in 37 of the 40 tasks where the hook would have named it. Codex already lists each installed skill with its description in the model's instructions, and Sol read prove-it at its first tool call in 51 of those 52 sessions. You can ship gstack's routing hook off by default on Codex: on these tasks Sol left it at most 3 of 40 to add.

We learned that when the hook's line arrives, Sol does what it says. Where the hook named prove-it alone (33 tasks), Sol read it in all 33, against 30 of 33 with routing off. Where the hook named /verify and prove-it and told the model to pick /verify if both fit (7 tasks), Sol read /verify in all 7 and prove-it in none; with routing off it read prove-it in all 7. Together these give the primary, routing on minus routing off on the 40 covered tasks: -10.0 points (95% interval -25.9 to +6.1), which includes 0. With no gstack, and so no skill installed, Sol read it in 0 of 60.

We learned that the other half of this eval, whether gstack's /review contract makes Sol's reviews catch more known bugs, can't be tested on Codex 0.170. Codex encrypts the message a session sends to its review sub-agent, so the contract can't see whether the adversarial pass it checks for ran: in the one session that reached it, the contract blocked and then logged a miss although Sol had started its adversarial reader. That half is left out. Passes didn't move with routing: 28, 29 and 28 of 60 with routing on, off and no gstack (descriptive).

Call settled: routing ships off by default on Codex. The verdict is FIX-METHOD (ceiling), with one attempt to raise the ceiling as its own quick look.

## How it works

Each session is one unattended run of Codex CLI 0.170.0 (`codex exec --json`) with GPT-6.1 Sol at low effort, Codex's default for that model, fixing one SWE-rebench task with B1's plain prompt. Nobody types a skill's name.

The two gstack arms install gstack v1.102.0.0 the way a Codex user does (`./setup --host codex`), with B1's gstack-shaped prove-it skill beside it at `$CODEX_HOME/skills/prove-it/SKILL.md`. They have the same files and the same hooks and differ in one switch: r-off runs `gstack-config set skill_routing off`. In r-on, gstack's routing hook may add one developer message naming a skill before the model starts. r-none has no gstack, no skill and no hooks.

Codex has no Skill tool. The model reads a SKILL.md with a shell command, usually inside a code-mode cell. So a load is prove-it's text arriving in a tool result, read from the session's rollout file by the plan's rules (section 4.5). The skill listing in the instructions never counts as a load.

The primary is r-on's loads minus r-off's on the 40 tasks where the hook names prove-it at the pin, by pre-run change 1's route table: 33 where it names prove-it alone and 7 where it names /verify first and prove-it second. On the other 20 it names /verify alone (2) or nothing (18).

## Setup

- Rig: Codex CLI 0.170.0 from npm, pinned by its tarball's sha256. `gpt-6.1-sol` through the OpenAI API at `model_reasoning_effort=low` on every request. Approvals and Codex's sandbox are bypassed inside the trial container; web search, bundled system skills, retries and the update check are off. `allow_login_shell=false` in every arm (pre-run change 3). Hooks are trusted with `--dangerously-bypass-hook-trust` in the gstack arms only. B1's Harbor task images and verifiers.
- gstack: release tag v1.102.0.0, a0534ce6. It holds the routing and destructive-command hooks (gstack #4512) and the /review contract (#4522) with two fixes to its Codex reader (#4526, #4528). All five keyless checks in the plan's section 3 passed there.
- Tasks: B1's 60 SWE-rebench run tasks, byte for byte, in draw order.
- Arms: r-on, r-off and r-none on all 60 tasks, in three parts of 20 tasks, with the three arms side by side in each part.
- Sessions: 180, all graded on the first attempt. No rerun was owed, and there were no cap stops, limit stops, provider safety stops, questions or sub-agents. A pilot of 18 sessions on 6 other tasks ran first and enters no reading.
- Run code: gstack-evals main at 92bca462, which holds the harness (#400) and its fixes (#410). The three dated pre-run changes are on this pull request's branch.

## Result

### Routing on against off

| Arm | prove-it loaded | Wilson 95% | At the first call | /verify loaded | Passes (descriptive) |
|---|---|---|---|---|---|
| r-on | 49/60 81.7% | [70.1, 89.4] | 48 | 13 | 28 |
| r-off | 52/60 86.7% | [75.8, 93.1] | 51 | 19 | 29 |
| r-none | 0/60 0.0% | [0.0, 6.0] | 0 | 0 | 28 |

The Prove-It steps arrived in every session that loaded the skill. A session can read both skills, so the two load columns overlap.

Primary, paired by task on the 40 covered tasks, Newcombe's interval (method 10): r-on minus r-off is -10.0 points [-25.9, +6.1]. Both arms loaded on 30, only r-on on 3, only r-off on 7, neither on 0. At 40 pairs and this rate of disagreement the smallest detectable difference is 22 points, and the interval is 31.9 points wide. r-off loaded prove-it on 37 of the 40 (92.5%).

End to end, on all 60 tasks: -5.0 points [-16.7, +6.6]. Both loaded on 45, only r-on on 4, only r-off on 7, neither on 4.

The split by what the hook names at the pin. r-on's positions come from each session's own hook log, and r-off's from the route table, since no line reached its sessions.

| Hook line at the pin | Tasks | r-on: prove-it | r-on: /verify | r-off: prove-it | r-off: /verify |
|---|---|---|---|---|---|
| prove-it alone | 33 | 33 | 0 | 30 | 7 |
| /verify first, prove-it second | 7 | 0 | 7 | 7 | 3 |
| prove-it not named | 20 | 16 | 6 | 15 | 9 |

On the 7 two-skill tasks the hook's line read: "this request fits the verify or prove-it skill. Read and follow the one that fits better before you start (verify if both fit), and tell the user in one sentence which skill gstack routed this to." Sol read /verify's SKILL.md at its first call in each of them. The tasks are containers__ramalama-2487, marimo-team__marimo-8401, PyPSA__PyPSA-1498, narwhals-dev__narwhals-3251, ncar__geocat-comp-811, pydata__xarray-10863 and sigstore__sigstore-python-1652.

Why a covered r-on session didn't load prove-it, first reason that applies: it loaded /verify instead on 7. None had a missing hook log, an undelivered line, a failed load, a skill named but not loaded, or a skill never named. The line reached the model before its first output in all 40 covered r-on sessions.

Passes, paired, B1's rule, descriptive and not powered:

- r-on minus r-off: -1.7 points [-6.1, +2.8] (0 only r-on, 1 only r-off)
- r-on minus r-none: 0.0 points [-3.2, +3.2] (0 and 0)
- r-off minus r-none: +1.7 points [-2.8, +6.1] (1 and 0)

r-none's read audit, descriptive: 1 of 60 sessions made a call naming a SKILL.md or a skills folder. In harumiweb__exstruct-113 Sol read the task repository's own `.agents/skills/adr-suggester/SKILL.md`. No gstack or prove-it text reached any r-none session.

### Pilot

The routing pilot ran 18 sessions on 6 tasks that aren't counted (pre-run change 1 drew them). All three arms passed the plan's pilot check: every task was supplied with no gaps; in r-on the line was delivered, and logged naming prove-it, in 4 of the 4 covered sessions (the two smoke tasks aren't covered, and the hook logged no route there); and the load detector agreed with a hand reading of 2 sessions per arm (r-pilot-hand.tsv). As section 9 asks, the readout said before the counted run that r-off had loaded prove-it in every covered pilot session, the ceiling case. The counted run went ahead, as the plan says.

## Part C: the /review contract, left out

Part C asked whether gstack's /review contract makes Sol's delivered review name more of 42 known bugs on R2's 33 real gstack and gbrain pull requests, and whether high effort helps. The contract holds /review once when it tries to finish without its adversarial pass or its report. In Codex the adversarial pass is one sub-agent that /review starts with `spawn_agent`.

Its pilot ran one step on 2026-11-21: one session each of c-on, c-off and c-none on garrytan/gstack#3526. Pre-run change 2 (decision C) said to read the first c-on session's spawn message before a second paid c-on session, because Codex 0.170's tool schema marks that message as encrypted. It was ciphertext. Sol in c-on started a sub-agent named "adversarial", and the stored message is 1,164 characters of ciphertext (c-off's is 824). Codex's Multi-Agent V2 encrypts these messages (openai/codex#26210), and a request for a plaintext option (openai/codex#46939) is open. gstack's marker for its adversarial pass, "Think like an attacker and a chaos engineer", appears in no tool result and in neither sub-agent's rollout.

So the contract can't see the pass it checks for. In the c-on session, which did start its adversarial reader, gstack's contract log reads:

```
event=blocked skill=gstack-review missing=adversarial-pass,review-report waived=-
event=miss skill=gstack-review missing=adversarial-pass waived=-
```

c-on and the high-effort arm therefore fail the plan's pilot check that the part under test ran, and part C stopped there. They are reported as left out, not as dropped arms. The counted part C items and the judge never opened. The same step showed gstack's start step passing its install check in part C's image (exit 0 in c-on and c-off), with no command refused by Codex. c-pilot-step1.txt holds the record, and c-run-op.ts.txt the wrapper that ran it.

## Checks on the run's records

1. Completeness. 180 of 180 sessions were graded, and no part owed a rerun. There was no cap stop, limit stop, provider safety stop, question or resume. Every session ran gpt-6.1-sol at low effort on Codex 0.170.0, and none started a sub-agent.
2. Switches. Each session's init.json shows `skill_routing` on in all 60 r-on sessions and off in all 60 r-off sessions, the contract and the destructive-command check on in both, and the hook-trust flag passed in both. r-none has no gstack config.
3. Hook logs. Every r-on session has its hook log, and the positions they record (33 alone, 7 second of two, 20 not named) match pre-run change 1's route table.
4. Load rules. Every load counts under rule (a), text unique to prove-it. No load rests on rule (b) alone, and no read of prove-it failed.
5. Shell. Codex refused no login-shell request in any session, the destructive-command check denied nothing, and Codex rejected no command on policy.
6. Hand reading. Besides the pilot's 2 per arm, 6 counted sessions were read by hand from their rollouts and hook logs while this post was written: r-on marimo-8401 and xarray-10863 (second of two; read /verify's SKILL.md at the first call), r-off xarray-10863 (read prove-it's and /verify's files in one call), r-on bedrock-agentcore-279 (named alone; read prove-it), r-on generate-release-notes-207 (no route; read prove-it) and r-on rapid-mlx-227 (routed to /verify alone; read /verify). All 6 agree with the session table.
7. Reproduction. Both reports rebuild byte for byte from the attached session rows.

## The decision table, with this result

Routing default for Codex (plan section 1), read in order:

| Result | What gstack does for Codex |
|---|---|
| Part R held at the coverage gate | No run, no reading. |
| INCOMPLETE | No reading; gstack ships routing as planned. |
| Primary above 0 | Routing stays on by default for Codex. KEEP. |
| **Primary includes 0, and routing off loads prove-it in at least 80% of those prompts (-10.0 [-25.9, +6.1]; 92.5%)** | **Sol finds the skill without the line. Routing ships off by default on Codex (registered, `skill_routing` off for that host). FIX-METHOD (ceiling) until one honest attempt to raise it runs as its own quick look.** |
| Primary includes 0, and routing off loads it in under 80% | Routing ships off by default on Codex; FIX-METHOD or CUT-CANDIDATE for the line. |
| Primary below 0 | Routing ships off by default on Codex; FIX-METHOD on its line. |

Part R ran complete, and the hook covered 40 of 60 tasks, past the gate of 30.

The contract table and the effort table get no reading, because part C was left out. With no effort reading, the plan's E2 stands: gstack's setup prints its one-line recommendation and writes nothing.

## R48 verdict

**FIX-METHOD (ceiling).** Routing on Codex is a null from a ceiling Sol reaches without it. One honest attempt to raise the ceiling (R61) runs later as its own quick look, and no cut is called before it.

Why null?

- Exposure. The line reached Sol in all 40 covered r-on sessions, and where it named prove-it alone Sol read the skill in 33 of 33. The line was read and followed.
- Task fit. These are B1's bug tasks, which the skill fits, and the hook covers 40 of the 60 at the pin.
- Power and ceiling. r-off read prove-it on 37 of the 40 covered tasks, so routing could add at most 3 tasks, 7.5 points, far under the 22-point smallest detectable difference at these pairs. No run of this size could have shown a gain.
- Does the model do it unaided? Yes. With the skill installed and listed, Sol read it in 52 of 60 tasks with no line. r-none's 0 of 60 reflects no skill installed, not a model that won't look.

## Limits and threats

- The pin, v1.102.0.0 (a0534ce6), predates gstack #4539 (5df6b5a), which changed the shared matcher so a bug report names the installed bug-fix skill alone and never puts /verify first. The 7 two-skill tasks were measured before that change, and this eval didn't run the hook after it.
- A known defect of the build under test: gstack's Codex skills at the pin clean up temp files with `rm -f`, which Codex 0.170 refuses, so a skill that reaches such a cleanup stops there. gstack fixed it after the pin in #4612 (bd77c8cc), and the pin was not moved. Codex refusals of a command containing `rm -f`, per arm: 0 in r-on, r-off and r-none (pilot and counted run) and 0 in c-on, c-off and c-none (part C's one step). Sol ran no `rm -f` command in any part R session.
- Codex-host differences (plan section 8): of gstack's Claude Code hooks, only routing, the destructive-command check and the contract are ported at the pin. Hooks were trusted by flag, not through Codex's startup prompt. Sol calls tools through Codex's code mode. gstack marks its Codex host experimental, and gpt-6.1-sol gets gstack's generic GPT profile. On Codex, /review runs no specialist reviewers and no second-model review, which matters only to the left-out part C.
- The model is GPT-6.1 Sol, as the plan froze it. GPT-6.2 Sol, which Codex 0.170 lists first and which is now the OpenAI model we test, wasn't run. One Codex version and low effort only.
- The route table is in-sample: gstack's matcher was tuned on these 60 prompts for Claude Code. What Sol does once the line arrives was not tuned.
- One skill, a stand-in installed by hand beside gstack, and one task family.
- No test-first reading: B1's scorer reads Claude Code transcripts and isn't ported. Passes are descriptive and not powered.
- r-none is clean by construction, and its read audit is descriptive.
- The rig runs every command the model asks for: approvals and Codex's sandbox are bypassed inside the container.

## Deviations and dated changes

- Pre-run change 1 (2026-11-19, before any paid call) pinned gstack's release tag v1.102.0.0 rather than the first commit with both planned pull requests, because the contract's reader there didn't count Sol's spawn_agent call as the adversarial pass. It recorded the five keyless checks, the route table (40 of 60) and the pilot draw.
- Pre-run change 2 (2026-11-21, before any paid call) raised the routing pilot's cap from $45 to $50 to hold its machine share, and settled part C's open pilot rules, among them decision C, which caught the encrypted spawn messages.
- Pre-run change 3 (2026-11-21, before any paid call) runs the model's shell commands in a non-login shell in every routing arm, so a task image's /etc/profile can't drop bun and the testbed from PATH. Codex refused 0 login-shell requests.
- Part C ran through an operator wrapper around the harness's review-units step (c-run-op.ts.txt). It ran the rig's admission check before each paid step and paused after the first, so decision C's read happened before a second c-on session. Its exit code 75 is that planned pause. It changed no arm, prompt or score.
- Part C was stopped after that step on 2026-11-21 and left out, before its counted items or its judge opened.

## Replicate it

- `bun lanes/codex-hooks/cli.ts r report wiki/board/2026-11-21-geva-562-codex-hooks-results/r-main-sessions.jsonl --item r-main` prints r-main-report.md.
- `bun lanes/codex-hooks/cli.ts r report wiki/board/2026-11-21-geva-562-codex-hooks-results/r-pilot-sessions.jsonl --item r-pilot --hand wiki/board/2026-11-21-geva-562-codex-hooks-results/r-pilot-hand.tsv` prints r-pilot-report.md.
- `bun lanes/codex-hooks/cli.ts r table <config.json> <out.jsonl>` builds the session rows from the pulled trials. lanes/codex-hooks/README.md describes the launcher and the ledger.
- c-pilot-step1.txt is part C's record: what each session in its one step did, the contract log and the lines the run printed. c-run-op.ts.txt is the wrapper that ran it.
- Not in this record: the paid sessions' rollouts, hook logs, part result files and ledgers, and the setup commands. They are in the run log kept outside the repository.

## What is held out, and why

Nothing. B1's tasks are public SWE-rebench tasks, and part C's units are public pull requests.

## Credits

The tasks are SWE-rebench's (Nebius AI R&D, CC-BY-4.0). The Prove-It steps are from agent-skills by Addy Osmani (MIT), carried in B1's gstack-shaped skill. Codex CLI is OpenAI's. The routing hook, its matcher, the /review contract and its Codex reader are gstack's own, at a0534ce6.

<details>
<summary>Agent notes</summary>

The counted runs ran from gstack-evals main at 92bca462, and the dated pre-run changes live on this pull request's branch, so this pull request keeps a merge commit. Spend is in the experiment's private registry row; r-pilot-report.md prints the pilot's per-arm session costs. The two part C rollouts and their checksums, kept for gstack's maintainers, are outside the repository.

</details>

## Disclosures

gstack is Garry Tan's own project. gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

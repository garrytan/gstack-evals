---
id: 2026-11-19-geva-562-codex-hooks-pre-run-change-1
kind: plan
title: "Pre-run change 1 to the Codex hooks eval: the gstack pin, its keyless checks, the route table and the pilot draw"
summary: "Pins gstack v1.102.0.0 for both parts, with its five keyless checks (all pass), the route table (40 of 60), the pilot tasks, the sleep-tool setting, host facts and each row's model and Codex source."
author: GEVA-562
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-19
status: open
links:
  - 2026-11-19-geva-562-codex-hooks-prereg
  - 2026-11-18-capy-b1b-prose-route-prereg
  - 2026-11-17-geva-547-delivery-route-prereg
  - GST-3174
attachments:
  - 7291ed67907ff784cba5128fd7b107e3e68289b40ba36d1a92beff6e87bbd419  checks.txt
  - 5dae5c05a32e0c71df273387e7649a239a41341d0a9c99fdd6cf56303e754b25  route-table.tsv
---

# Pre-run change 1 to the Codex hooks eval: the gstack pin, its keyless checks, the route table and the pilot draw

## In short

- Both parts run gstack's release tag v1.102.0.0, commit a0534ce6db39a8da1f3c23ec070aac2479e44be9. It holds the routing and destructive-command hooks (gstack pull request 4512), the /review contract hook (4522), the fix that lets the contract see GPT-6.1 Sol's adversarial pass (4526) and the fix to how the contract counts a shell read of a skill file (4528).
- All five keyless checks of the preregistration's section 3 pass there (checks.txt). At 4522's merge the contract blocked a Sol session that had run the pass and written the report, and before 4528 it counted reads that failed. So the pin moved twice.
- prove-it is covered on 40 of the 60 prompts, so part R clears its gate (30). The four extra pilot tasks are drawn here by a rule the preregistration left unstated.
- Every arm turns Codex's sleep tool off. Four host facts are stated for every result.

This change governs where it and the preregistration differ. It changes no arm, primary, scoring rule, threshold, model or decision-table row. It made no model call and spent nothing.

## 1. The pin

| Field | Value |
|---|---|
| gstack | garrytan/gstack tag v1.102.0.0, a0534ce6db39a8da1f3c23ec070aac2479e44be9, VERSION 1.102.0.0 |
| What it holds | 944b41e (pull request 4512: routing and the destructive-command check on Codex), b0f865c (4522: the /review contract Stop hook on Codex), 18e24a2 (4526: the Codex contract reader counts a started spawn_agent by agent_id or by task_name, in either namespace) and 9610ba4 (4528: the reader splits a shell line only outside quotes and drops reads that failed or never ran) |
| Codex CLI | 0.170.0, as the preregistration's section 2 states |
| Driver | gstack-evals main at b5f80f06 (pull request 379): no `--ephemeral`, the rollout read after each turn |

Why not b0f865c, the first commit with both planned pull requests. On gpt-6.1-sol, Codex 0.170 serves spawn_agent in its `collaboration` namespace with `task_name` required, and a started agent's call output is `{"task_name":"/root/<name>"}`, with no `agent_id`. gstack's reader at b0f865c counted a dispatch only by an `agent_id`, so section 3's check 2 failed: a session that ran the pass and wrote the report was blocked ("missing adversarial-pass"). Section 3 holds a part whose check fails until gstack fixes it. gstack fixed it in 4526, and one pin for both parts keeps the contract hook the same in part R's arms.

Why not 18e24a2, where all five checks also passed. 4528 changes how the contract reader counts a shell command that reads a gstack skill's SKILL.md (checks.txt, "Reader shapes"). At 18e24a2 the reader split `sed -n '1,200p;201q' <file>` at the `;` inside the quotes, so it missed that read; this is the shape gstack's GSTA-651 names. It also counted three reads that failed or never ran: a one-file `cat` or `sed` that exited non-zero with no error text, and a read behind a `cd` that failed under `&&`. At the tag the sed read counts and those three don't. Between 18e24a2 and the tag, the only other change to code these arms run is 4525, which tightens the destructive-command check's command parser; the host-fact probes in section 6 give the same output at both. The Captain chose the release tag over the bare commit.

## 2. The keyless checks (preregistration section 3)

checks.txt has the commands and outputs. Each ran against a local stub of the Responses API, with the trust bypass, in a home set up by `./setup --host codex --no-browser` at the tag.

1. **hooks.json.** It registers routing on UserPromptSubmit, the contract on Stop and the destructive-command check on PreToolUse for Bash. Setup wrote no config.toml. Pass.
2. **The hooks.** The routing line arrives as a developer message naming prove-it. A `$review` session with no spawn_agent and no report is blocked once, then logged as a miss. A session with the marked spawn_agent and the report is logged met and not blocked. `skill_routing off` and `skill_contracts off` each stop their hook. Pass.
3. **`$review`.** It injects exactly one skill item, named review, and the contract counts it as a load. Pass.
4. **Route table.** See section 3. Pass.
5. **Duplicates.** Codex lists 65 skills, each once (64 from gstack, plus prove-it). Pass. So section 7's fallback is not used.

## 3. The route table and the gate

route-table.tsv holds one row per prompt: B1's prompt for each of the 62 tasks, built from the pinned Harbor's (f3a5a923) export of swe-rebench/swe-rebench-leaderboard. All 62 prompts hash to B1b's prompt_sha256, so they are the prompts B1 and B1b sent. Each prompt went to the registered routing command as Codex 0.170 sends it, with prove-it installed as section 4.3 says, at `$CODEX_HOME/skills/prove-it/SKILL.md`.

| prove-it position | Run tasks |
|---|---|
| Alone | 33 |
| Second of two, after verify | 7 |
| Not named | 20 (18 with no line, 2 routed to verify alone) |

40 of 60 are covered, so the gate clears and part R runs. The table is byte-identical at b0f865c, 18e24a2 and the tag. The `gstack-prove-it` install variant in section 4.4 is not needed, because gstack's Codex router scans every skill under `$CODEX_HOME/skills`, not only gstack's. Neither smoke task is named.

## 4. The pilot draw (preregistration section 9)

Section 9 asked for four extra part R pilot tasks covered by the route table at the pin, but section 4.4 builds that table only for the 60 counted prompts. This is the rule:

1. The candidates are the tasks in hm-screened.txt (B1's screened pool) whose repository, case-folded, is the repository of one of B1's 62 tasks, and that are not among the 62. There are 79.
2. They are ordered by L1's seeded shuffle (`seeded` in quick/laneb/l1/l1.ts, seed 20261102).
3. The routing command runs on each candidate's prompt, as in section 3. These rows are in route-table.tsv as `candidate` and never count toward the gate.
4. The pilot takes the first four that it covers. If fewer than four had qualified, the pilot would have taken those that did, plus the two smoke tasks, and said so.

63 candidates are covered. The pilot's four extra tasks are BerriAI__litellm-16997, narwhals-dev__narwhals-3480, delgan__loguru-1425 and koxudaxi__datamodel-code-generator-2996. With the smoke tasks yt-project__unyt-628 and getmoto__moto-9590, part R's pilot has six tasks.

## 5. Settings added to every arm

- **Sleep tool off.** `-c features.sleep_tool=false` in every arm of both parts, the no-gstack arms included. It removes `clock.sleep` from the tools the model receives and changes no other tool (checks.txt), so a model can't ask a question and then sleep through its session clock. init.json records it.
- **Trust flag.** `--dangerously-bypass-hook-trust` in the gstack arms only, recorded in init.json, as section 2 says.

## 6. Host facts, stated in every result

- **The destructive-command check under `codex exec` warns and runs.** Codex 0.170 has no PreToolUse "ask". In an unattended session, such as every session here, a command the check would ask about gets a warning and runs. Recursive deletes of the root or home folder are denied. An interactive Codex session would deny instead. The check is on in every gstack arm and absent from the no-gstack arms.
- **A spawn_agent in an unknown namespace counts as not dispatched.** gstack's reader at the pin (lib/codex-rollout.ts) counts a spawn_agent as started only by an `agent_id` in the `multi_agent_v1` namespace, by a `task_name` in the `collaboration` namespace, or by either with no namespace. A same-named tool in any other namespace fails closed and does not meet the adversarial-pass item. Section 5.6's independent check counts such a call as the pass when its message holds the marker, so a block that follows it is a false block there.
- **Question capture.** Two limits of the shared driver (pull request 379) apply wherever the model asks a question. An agent could forge request_user_input_async lines into its own rollout and get a simulated reply. Two questions with the same title in one turn share one answer. Both are counted beside each arm's question count.
- **The adversarial pass starts fresh.** gstack's Codex /review asks for `spawn_agent` with `fork_turns: "none"`, so the pass doesn't inherit the reviewing session's history when the model follows it. A session that leaves it at Codex's default (`all`) is counted per arm.

## 7. Additions to the pilot checks (preregistration section 9)

Each part C pilot session in c-on and c-high also reports:

- **SKILL.md read shapes.** Every read of a SKILL.md, by tool (a direct command or a code-mode cell) and command shape. Three shapes are flagged:
  - a sed range that quits early (`sed -n '1,200p;201q'`, GSTA-651's shape), which the reader at the tag counts and the reader before 4528 missed;
  - a read inside `bash -lc "..."` (or `sh -c`) whose call exits non-zero with no error text;
  - a read through `<` (`cat < <file>`) whose call exits non-zero with no error text.

  The last two still count as loads at the tag although the read may have failed (checks.txt, "Reader shapes"). In part C the skill loads through `$review`, which the contract counts (check 3), and in a one-prompt session the reader treats a later read of the same skill as part of that load, so none of these shapes can change whether /review loaded. The check stays because the Captain asked for it, and the flags show how often each shape occurs.
- **Unknown-namespace spawns.** Every spawn_agent call in a namespace other than `multi_agent_v1` or `collaboration`, or with none, is flagged. On gpt-6.1-sol, Codex 0.170 serves it in `collaboration`.

If either flag fires on more than one c-on or c-high pilot session, the Captain hears it before c-main spends anything.

## 8. Two clarifications from the preregistration's review

- **Section 12's fixture.** The fixture "4 gains in 4 clusters with no losses reads FIX-METHOD (power), not KEEP and not CUT-CANDIDATE" also holds at least 7 blocked c-on sessions and false blocks in no more than 5% of c-on sessions. Otherwise the ceiling row or the false-block row would read first.
- **The CUT-CANDIDATE bar after check A's swap.** When check A puts c-on minus c-off in the primary's place, the CUT-CANDIDATE row keeps the 11.5-point bar. The between-arm design's own MDD is 15.5 to 22 points (section 10), so this leans toward FIX-METHOD. A between-arm null is called a cut candidate only when its interval rules out an 11.5-point gain. This is intended.

## 9. What is still open

The harness build (section 12 of the preregistration) starts after this change. The per-arm prompt-input captures named in section 2 come from the arm images at build, because their digests depend on install paths. Nothing is spent before 2026-11-21 06:00 UTC.

## 10. Model and Codex version per session (added 2026-11-20)

Codex CLI 0.171.0, released 2026-11-20, makes GPT-6.2 Sol its default model. This eval doesn't move: every arm runs `gpt-6.1-sol` on Codex 0.170.0, as the preregistration's section 2 says.

- **The model is named, never defaulted.** The shared driver passes `-m <model>` on every `codex exec` (codexArgs in src/adapters/codex/driver.ts), and this eval passes `gpt-6.1-sol` in every arm. A sub-agent inherits it: in check 2's met run the sub-agent's request named `gpt-6.1-sol` (checks.txt).
- **The CLI is pinned, never latest.** The trial image installs Codex 0.170.0 from npm's linux-x64 tarball, checked by its sha256, the way main's image installs 0.166.0 today (docker/trial.Dockerfile, which tests/adapters/pins.test.ts holds to docker/host-cli.json and package.json). No arm installs `@openai/codex@latest` or an unversioned package.
- **Rows read the session record, not this plan.** Each session's row takes its model from the request bodies in the proxy's journal and from the rollout's `turn_context`, and its Codex version from the rollout's `session_meta.cli_version`. It never takes them from the plan or from init.json's copy of the driver's arguments. A session whose root thread ran another model, or whose rollout names another Codex version, is an infrastructure gap under the preregistration's section 4.7. The results tables print the models and versions their sessions recorded.
- **A sub-agent on another model.** Codex 0.170's spawn_agent takes a `model` override. A sub-agent the model starts on another model is listed and counted per arm, and its session stays graded. If any c-on or c-high pilot session does this, the Captain hears it before c-main spends anything.

This section adds one infrastructure-gap case, a session that ran another model or Codex version. It changes no other rule.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

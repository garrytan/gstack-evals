---
id: 2026-10-28-gsta-12-tb2-task-selection
kind: research
title: "Lane B task list: a pre-screen of Terminal-Bench 2.0 from published results"
summary: 20 TB2 tasks plus 6 reserves chosen by a fixed rule over published per-trial results, with sources, funnel and cost estimates. SWE-bench Verified rejected.
author: GSTA-12
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
links: [quick/laneb/tasks/tasks.json, quick/laneb/tasks/prescreen_tb2.py, wiki/plans/2026-10-28-gsta-12-laneb-quick-prereg.md]
---
# Lane B task list: pre-screen from published results

GSTA-12 subagent, 2026-10-28. Research and selection only. No paid model calls were made.

## Recommendation

Use Terminal-Bench 2.0 only (`terminal-bench@2.0` in Harbor's registry), with the 20 tasks and 6 ordered reserves in tasks.json. SWE-bench Verified is not usable for this purpose: its only per-instance data predates the current frontier, and the current frontier is at about 97% on it.

The main caveat: Terminal-Bench 2.0 is close to saturated for the newest frontier models in the published data (Claude Opus 4.7 and GPT-5.5, April to May 2026). Only 10 tasks meet the full target window (frontier passes sometimes, cheap models mostly fail) and also fit the cost limits. The other 10 slots go to tasks that Opus 4.7 and GPT-5.5 already pass 72 to 93% of the time, and most of them are also easier for cheap models. Expect Opus 5.5 at or near ceiling on most of ranks 11 to 20. Report Opus 5.5 lift on ranks 1 to 10 separately.

Estimated cost per trial: Opus 5.5 about $1.29, Haiku 5.5 about $0.05 to $0.24, DeepSeek V4.1 Flash 1017 about $0.05 to $0.16. (see "Cost estimate").

## Sources

| What | Where | Snapshot |
|---|---|---|
| TB 2.0 per-trial results (all leaderboard submissions, 32,803 trials, 75 submissions) | https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard | commit 572b2614be2c0cb2527e14f5b1e4026f1072e6c1, 2026-05-15 (submissions closed on 2026-05-14) |
| Mirror of every result.json from that dataset (used for download) | https://github.com/prime-radiant-inc/terminal-bench-analysis | commit 2e161fdca93b67f14b945cd36eee31686d01a7b6; its last_fetch_sha.txt equals the HF commit above |
| Harbor runner | https://github.com/harbor-framework/harbor | f3a5a923f6d722472c9e797af836ae4425fb215f |
| Registry pin for `terminal-bench@2.0` | Harbor Hub `get_dataset` RPC, which is harbor's default registry client at f3a5a92 (it does not read the local registry.json) | 89 tasks, all at https://github.com/laude-institute/terminal-bench-2.git @ 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c; registry.json at f3a5a92 pins the same commit |
| TB 2.0 task files | https://github.com/laude-institute/terminal-bench-2 | 69671fb (2025-10-31). Main is now 2fd12b8 (2026-04-29) |
| SWE-bench Verified per-instance results | https://github.com/SWE-bench/experiments, evaluation/verified/*/per_instance_details.json | commit 40f164d5b8f1d249bf95a6df8b74b577fd8e519d, 2026-09-03 |
| Registry pin for `swebench-verified@1.0` | Harbor Hub | 500 tasks at https://github.com/laude-institute/harbor-datasets.git @ 86723674f04e4209ac479d0fb75d9d9f44b4377e |
| Image platforms | Docker Hub tag API (https://hub.docker.com/v2/repositories/REPO/tags/TAG), no pulls | read 2026-10-28 |

TB 2.0 has no Claude Code plus Anthropic model submission. Per-task cost signals come from WOZCODE with Opus 4.7 (the only frontier Anthropic submission that reports cached and output tokens per trial) and from billed Opus 4.6 costs in Meta-Harness, Terminus-KIRA and Capy.

### Groups

Frontier is the newest frontier generation in the data, single-model submissions only. Cheap is Haiku-class closed models plus cheap open-weight models of 100B parameters or more. I left out models far weaker than Haiku 5.5 and DeepSeek V4.1 Flash (qwen3.5-9b, qwen3.6-35b-a3b, gpt-oss-20b, TermiGen-32B, gpt-5-nano), because they would make every task look hard. A trial passes when its reward is 1.0. Trials with no reward are dropped unless the agent hit its timeout, which counts as a failure; this removes setup, sandbox and harness errors (for example 200 RuntimeError trials in 0error-Ledger).

| Frontier submission (agent__model) | model | first trial | trials | pass rate |
|---|---|---|---|---|
| vix__claude-opus-4-7 | opus-4.7 | 2026-04-30 | 442 | 0.90 |
| logos-latest__claude-opus-4.7 | opus-4.7 | 2026-04-21 | 438 | 0.85 |
| logos-ts__claude-opus-4.7 | opus-4.7 | 2026-04-18 | 442 | 0.81 |
| WOZCODE__Claude-Opus-4-7 | opus-4.7 | 2026-04-19 | 445 | 0.80 |
| 0error-Ledger__Claude-Opus-4.7 | opus-4.7 | 2026-05-12 | 241 | 0.73 |
| Wecode__GPT-5.5 | gpt-5.5 | 2026-04-26 | 445 | 0.88 |
| NexAU-AHE__gpt-5.5 | gpt-5.5 | 2026-05-01 | 441 | 0.85 |
| Capy__GPT-5.5 | gpt-5.5 | 2026-04-28 | 443 | 0.84 |
| clnkr__GPT-5.5 | gpt-5.5 | 2026-05-06 | 444 | 0.66 |

| Cheap submission (agent__model) | model | first trial | trials | pass rate |
|---|---|---|---|---|
| Terminus2__DeepSeek-V3.2 | deepseek-v3.2 | 2026-02-07 | 444 | 0.40 |
| Terminus2__GLM-4.7 | glm-4.7 | 2026-01-26 | 427 | 0.34 |
| ClaudeCode__GLM-4.7 | glm-4.7 | 2026-02-06 | 443 | 0.33 |
| Terminus2__GLM-5 | glm-5 | 2026-02-14 | 442 | 0.52 |
| just-another-coding-agent__GLM-5 | glm-5 | 2026-03-28 | 440 | 0.48 |
| Terminus2__Kimi-k2.5 | kimi-k2.5 | 2026-01-27 | 435 | 0.43 |
| Terminus2__Minimax-m2.5 | minimax-m2.5 | 2026-02-17 | 443 | 0.42 |
| cchuter__minimax-m2.5 | minimax-m2.5 | 2026-03-09 | 441 | 0.43 |
| IndusAGICodingAgent__MiniMax-M2.7 | minimax-m2.7 | 2026-03-21 | 338 | 0.45 |
| harness-agent__minimax-m2-7-highspeed | minimax-m2.7 | 2026-04-27 | 431 | 0.44 |
| dakou__qwen3-coder-480b | qwen3-coder-480b | 2025-12-26 | 442 | 0.27 |
| Gemini_CLI__Gemini-3-Flash-Preview | gemini-3-flash | 2026-03-05 | 439 | 0.48 |
| Dirac__Gemini-3-Flash-Preview | gemini-3-flash | 2026-04-18 | 445 | 0.65 |
| hookele__gpt5.1-codex-mini | gpt-5.1-codex-mini | 2026-01-15 | 443 | 0.61 |

## The rule

All thresholds are in prescreen_tb2.py and were fixed before any of our runs. They were set after seeing the marginal distributions; "How the rule was reached" gives the history.

Hard filters (a task must pass all):

1. In the registry pin for `terminal-bench@2.0`.
2. Agent timeout in task.toml at most 30 minutes, at most 4 CPUs and 8 GB, no GPU, single container.
3. The reference solution needs no host other than OS or language package registries. Network class "open" (git clone, Hugging Face hub, RCSB, YouTube, arbitrary curl or wget) is excluded; "registry" (apt, apk, pip) is allowed. label_network.py derives the labels from solution/solve.sh, plus two manual labels that carry reasons.
4. The task image has a linux/amd64 variant.
5. Frontier pass rate at least 0.20, and at least 3 of the 9 frontier submissions solved it at least once. This drops tasks nobody solves, which are often broken.
6. Estimated Opus 5.5 cost per trial at most $2.00, and median frontier agent time at most 15 minutes.

Tier A (the target window): frontier pass rate at most 0.85 and cheap pass rate at most 0.30.

Order: all tier A tasks first, then the other eligible tasks. Within each group, sort by headroom = (1 - frontier rate) x (1 - cheap rate), descending, then by name. The first 20 are the list. The next 6 are the reserves, used in order only if a task fails our oracle or infra check before any paid run. There is no random sampling, because the pool inside the window (10) is smaller than 20.

Funnel: 89 registry tasks, 67 after filters 1 to 4, 65 after filter 5, 54 after filter 6, 10 in tier A.

## The list

Rates are pooled over each group's trials. "est. Opus 5.5" is the larger of two estimates (see "Cost estimate"). Network is what the reference solution needs. (R) marks reserves.

| # | task | category | tier | frontier | Opus 4.7 | GPT-5.5 | frontier subs solving (of 9) | cheap | median frontier agent min | est. Opus 5.5 $/trial | agent timeout min | network |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | filter-js-from-html | security | A | 0.36 | 0.65 | 0.00 | 3 | 0.00 | 3.9 | 1.70 | 30 | none |
| 2 | dna-insert | scientific-computing | A | 0.44 | 0.52 | 0.35 | 7 | 0.00 | 4.2 | 1.29 | 30 | registry |
| 3 | model-extraction-relu-logits | mathematics | A | 0.43 | 0.25 | 0.65 | 6 | 0.23 | 4.8 | 1.47 | 15 | none |
| 4 | chess-best-move | games | A | 0.63 | 0.48 | 0.80 | 8 | 0.00 | 6.7 | 1.68 | 15 | registry |
| 5 | torch-tensor-parallelism | software-engineering | A | 0.65 | 0.84 | 0.39 | 8 | 0.13 | 3.8 | 0.75 | 15 | none |
| 6 | adaptive-rejection-sampler | scientific-computing | A | 0.65 | 0.65 | 0.65 | 8 | 0.24 | 6.7 | 1.97 | 15 | registry |
| 7 | db-wal-recovery | file-operations | A | 0.74 | 0.96 | 0.50 | 8 | 0.07 | 1.5 | 1.27 | 15 | none |
| 8 | polyglot-rust-c | software-engineering | A | 0.77 | 0.96 | 0.55 | 8 | 0.06 | 5.2 | 1.47 | 15 | none |
| 9 | break-filter-js-from-html | security | A | 0.72 | 0.96 | 0.45 | 8 | 0.22 | 4.9 | 1.25 | 20 | none |
| 10 | overfull-hbox | debugging | A | 0.79 | 0.91 | 0.65 | 9 | 0.22 | 5.4 | 1.78 | 12 | registry |
| 11 | extract-elf | file-operations | B | 0.72 | 0.91 | 0.50 | 8 | 0.54 | 2.3 | 0.97 | 15 | none |
| 12 | torch-pipeline-parallelism | software-engineering | B | 0.88 | 0.96 | 0.80 | 9 | 0.00 | 5.2 | 1.43 | 15 | none |
| 13 | polyglot-c-py | software-engineering | B | 0.88 | 1.00 | 0.75 | 8 | 0.09 | 2.6 | 0.46 | 15 | none |
| 14 | qemu-alpine-ssh | system-administration | B | 0.88 | 0.82 | 0.95 | 8 | 0.22 | 11.9 | 1.40 | 15 | registry |
| 15 | query-optimize | data-science | B | 0.85 | 0.93 | 0.80 | 8 | 0.46 | 9.5 | 0.82 | 15 | none |
| 16 | tune-mjcf | scientific-computing | B | 0.88 | 0.87 | 0.90 | 9 | 0.41 | 7.4 | 1.30 | 15 | none |
| 17 | configure-git-webserver | system-administration | B | 0.84 | 0.74 | 0.95 | 9 | 0.64 | 3.8 | 0.60 | 15 | registry |
| 18 | mailman | system-administration | B | 0.88 | 0.82 | 0.95 | 9 | 0.56 | 8.2 | 1.54 | 30 | none |
| 19 | pytorch-model-cli | model-training | B | 0.83 | 0.68 | 1.00 | 9 | 0.73 | 3.5 | 0.74 | 15 | registry |
| 20 | cancel-async-tasks | software-engineering | B | 0.93 | 0.87 | 1.00 | 9 | 0.46 | 2.8 | 1.96 | 15 | none |
| 21 (R) | sanitize-git-repo | security | B | 0.95 | 1.00 | 0.90 | 9 | 0.40 | 2.7 | 1.16 | 15 | none |
| 22 (R) | largest-eigenval | mathematics | B | 0.93 | 0.91 | 0.95 | 9 | 0.61 | 3.4 | 1.19 | 15 | registry |
| 23 (R) | pypi-server | software-engineering | B | 0.89 | 1.00 | 0.75 | 8 | 0.76 | 1.3 | 0.25 | 15 | registry |
| 24 (R) | feal-differential-cryptanalysis | mathematics | B | 0.95 | 0.91 | 1.00 | 9 | 0.43 | 3.8 | 1.27 | 30 | none |
| 25 (R) | pytorch-model-recovery | model-training | B | 0.93 | 1.00 | 0.85 | 9 | 0.64 | 2.5 | 0.55 | 15 | none |
| 26 (R) | sparql-university | data-querying | B | 0.95 | 0.91 | 1.00 | 9 | 0.51 | 2.6 | 0.71 | 15 | none |

tasks.json holds the per-task fields: registry git url, commit and path, image and its index digest, timeouts, resources, digest and all published stats.

### Checks done on the list

- Same bytes as the published trials. Harbor's own task checksum (dirhash, as in harbor's Task.checksum) of each task directory at 69671fb equals the task_checksum in 333 or 334 of the 368 or 369 trials per task that record one. The rest come from 7 submissions that ran a newer Harbor packaging (0error-Ledger, Wecode, logos, logos-latest, logos-ts, copilot-cli, Dirac).
- Digests. digest_tasks.py recomputed all 26 digests from a fresh clone of the pinned commit, and they matched tasks.json.
- Images. All 89 TB 2.0 images (alexgshaw/TASK:20251031 on Docker Hub) list linux/amd64.
- Changes after the pin. Every chosen task later gained a README.md, a .gitignore and task.toml metadata on terminal-bench-2 main. The "TB2.1" fix commit (53ff2b8) touched three chosen tasks: filter-js-from-html (verifier timeout 900 to 1800 s, memory 2G to 4G), query-optimize (verifier timeout 900 to 1800 s) and overfull-hbox (the oracle sets DEBIAN_FRONTEND). No instruction or test file of a chosen task changed. The published data shows why the first two were fixed: 30 VerifierTimeoutError trials on filter-js-from-html and 27 on query-optimize. GSTA-12 may want a verifier timeout multiplier of 2 for all arms. That deviates from the pin, so preregister it if used.

### How the rule was reached

My first draft used a frontier window of [0.20, 0.85] and a cheap rate of at most 0.30 as hard filters, followed by a seeded stratified sample. It produced 11 tasks, so sampling was moot. Relaxing the cheap cap to 0.45, the cost cap to $3.00 or the time cap to 20 minutes each added at most 2 tasks, because the tasks above $2 cost $3 to $8 per trial. I then turned the window into a ranking (tier A first, then headroom), which fills 20 slots deterministically and keeps the window visible. I also changed one counting rule after finding 200 ungraded trials in 0error-Ledger: ungraded trials are now dropped instead of counted as failures. That moved tier A from 13 to 10 tasks, because those trials had made three tasks look harder for the frontier than they are.

## SWE-bench Verified

The usable per-instance data is the mini-SWE-agent v2 runs in SWE-bench/experiments, mostly from 2026-02-17. Frontier: Claude Opus 4.6 (378/500), Claude Opus 4.5 high (384/500) and GPT-5.2 high (364/500). gpt-5-2-codex has no per-instance file, and the gemini-3-pro-high file marks all 500 instances unresolved while its metadata says 69.6%, so I dropped both. Cheap: Claude Haiku 4.5 high, DeepSeek 3.2 high, GLM-5 high, Kimi K2.5 high, MiniMax 2.5 high, Gemini 3 Flash high, GPT-5 mini, and Gemini 3.5 Flash (2026-09-01, 359/500).

Under the same window, 93 instances have a frontier pass rate in [0.2, 0.8], and 34 of those have a cheap pass rate of at most 0.30 (11 django, 5 sympy, 5 pylint, 4 scikit-learn, 9 others). The median Opus 4.6 cost on those 34 was $0.59 per instance with mini-SWE-agent, so cost is not the problem.

Ceiling is. Vals reports Claude Opus 5 at 97.0% and DeepSeek V4 Flash 0731 at 88.8% on Verified with mini-SWE-agent (2026-09-01, per GSTA-4's notes). An instance that Opus 4.6 solved sometimes in February is very likely solved every time by Opus 5.5, and likely by Haiku 5.5 and DeepSeek V4.1 Flash too. The roughly 15 instances Opus 5 fails are enriched for defective tests (OpenAI's February audit found material defects in 59% of consistently failed problems), and no per-instance data exists for Opus 5 or newer. prescreen_swebv.py reproduces these numbers.

## Cost estimate

### Prices (read 2026-10-28)

| Model | Input | 5m cache write | 1h cache write | Cache read | Output | Source |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | $4 | $5 | $8 | $0.20 | $20 | https://platform.claude.com/docs/en/about-claude/pricing |
| claude-haiku-5-5, prompts up to 100k tokens | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 | same page |
| claude-haiku-5-5, prompts over 100k tokens | $0.50 | $0.625 | $1 | $0.05 | $2.50 | same page |
| deepseek/deepseek-v4.1-flash-1017, DeepSeek endpoint, base | $0.15 | none listed | none listed | $0.003 | $0.60 | https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints |
| same, weekday peak (Mon to Fri, 01:00 to 04:00 and 06:00 to 10:00 UTC) | $0.30 | | | $0.006 | $1.20 | same |

All prices are USD per million tokens. The Anthropic page notes that Claude 4.7 and later models use a tokenizer that produces about 30% more tokens for the same text. OpenRouter lists the same Anthropic prices for anthropic/claude-opus-5.5 and anthropic/claude-haiku-5.5.

### Per trial

Each task's token profile is WOZCODE's Opus 4.7 median per trial. Across the 20 tasks it averages 958k cached prompt tokens and 34.5k output tokens, with a median frontier agent time of 5.2 minutes.

- Opus 5.5: for each task, the larger of (a) those tokens at Opus 5.5 prices with 5% of cached tokens counted as 5m writes, and (b) 0.85 times the median billed Opus 4.6 cost (0.85 converts Opus 4.6 prices to Opus 5.5 prices, including the larger tokenizer). Mean over the list: $1.29. Range: $0.46 (polyglot-c-py) to $1.97 (adaptive-rejection-sampler).
- Haiku 5.5, assuming 1.5 times the Opus tokens: $0.05 if prompts stay under 100k tokens, $0.24 if every prompt is over 100k.
- DeepSeek V4.1 Flash 1017, assuming 1.5 times the Opus tokens: $0.05 off-peak with 95% cache hits, $0.16 at peak with 80% cache hits.

These estimates are rough. Each task's token profile rests on 5 trials from one harness. Opus 5.5 may think more or less than Opus 4.7. Claude Code adds its own system prompt and tool definitions, and the skill arms add skill text and possibly extra steps.

## OpenRouter findings

- Model slug: `deepseek/deepseek-v4.1-flash-1017` (canonical `deepseek/deepseek-v4.1-flash-20261017`, created 2026-10-17, 1,048,576-token context). It is the newest DeepSeek Flash entry in https://openrouter.ai/api/v1/models. `deepseek/deepseek-v4.1-flash` is the 2026-09-10 snapshot. `~deepseek/deepseek-flash-latest` is an alias that "always redirects to the latest model in the DeepSeek Flash family"; pin the dated slug, not the alias.
- DeepSeek's own endpoint has provider slug `deepseek` (max output 393,216 tokens). 33 other providers serve the same model, many at fp4 or fp8, some cheaper. Default routing balances by price, so without pinning most requests would not go to DeepSeek.
- Anthropic-compatible endpoint: yes, `POST https://openrouter.ai/api/v1/messages` (https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-a-message). For Claude Code, set `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, put the OpenRouter key in `ANTHROPIC_AUTH_TOKEN`, and set `ANTHROPIC_API_KEY` to an empty string (https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration). The same page says Claude Code through OpenRouter "is only guaranteed to work with the Anthropic first-party provider", so DeepSeek in Claude Code is best effort. harbor's claude-code agent at f3a5a92 already handles OpenRouter's reasoning envelope (src/harbor/agents/installed/claude_code.py).
- Provider pinning goes in the request body. OpenRouter's OpenAPI spec (https://openrouter.ai/openapi.json) gives `/messages` a `provider` object with `order`, `only`, `ignore`, `allow_fallbacks`, `require_parameters`, `quantizations` and `sort`, the same as Chat Completions (https://openrouter.ai/docs/guides/routing/provider-selection). There is no provider header: the only header parameters in the spec are `X-OpenRouter-Metadata` and `idempotency-key`. Claude Code cannot add body fields, so use one of these:
  1. A preset that stores `provider: {"only": ["deepseek"], "allow_fallbacks": false}`, referenced through the model string, for example `ANTHROPIC_MODEL=deepseek/deepseek-v4.1-flash-1017@preset/SLUG` (https://openrouter.ai/docs/guides/features/presets). `POST /api/v1/presets/{slug}/messages` creates the preset from a Messages body without running inference.
  2. Account-wide allowed providers. Request-level `only` lists are merged with them (OpenAPI description of `provider.only`).
  3. A small local proxy that adds the `provider` object to each body.
  None of these is tested with Claude Code. Confirm the serving provider on a smoke run, for example with `X-OpenRouter-Metadata: enabled` sent through `ANTHROPIC_CUSTOM_HEADERS`, or with OpenRouter's generation lookup.
- Also point `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` at the same DeepSeek model string. Otherwise Claude Code's background and subagent calls go to Anthropic models in the DeepSeek arm.

## Caveats and things that surprised me

- Terminal-Bench 2.0 is mostly solved at the top. 39 of 89 tasks have a frontier pass rate of 0.95 or more, and the best Opus 4.7 harness passes 90% of trials. That is why only 10 tasks land in the window.
- The proxies are off in the same direction for both groups. The frontier proxies (Opus 4.7, GPT-5.5) are older than Opus 5.5, so Opus 5.5 will likely score higher than the table says. The cheap proxies (DeepSeek V3.2, GLM-4.7 and 5, Kimi K2.5, MiniMax M2.5 and M2.7, Gemini 3 Flash, GPT-5.1 Codex Mini) are older than Haiku 5.5 and DeepSeek V4.1 Flash, so the cheap rates likely understate them too.
- Opus 4.7 and GPT-5.5 disagree on some tasks. On filter-js-from-html Opus 4.7 passes 65% and GPT-5.5 0%; on model-extraction-relu-logits it is 25% against 65%.
- Terminal-Bench 2.0 cannot run offline. The agent and the verifier share one container, and every test.sh downloads uv from astral.sh and then pytest. Task solutions are public on GitHub. The leaderboard banned agents from reading the Terminal-Bench site and repository; we should check trajectories for fetches of laude-institute/terminal-bench-2, harbor-framework repositories and tbench.ai, and count such trials as failures.
- The domain mix is puzzle-heavy: polyglots, cryptanalysis, primer design, chess, a ReLU network extraction, a QEMU VM. Few tasks exercise review, QA or ship workflows. A small or zero gstack lift here is a valid result, but it says little about those workflows.
- Data quality. 0error-Ledger has 200 ungraded trials, now dropped. The SWE-bench gemini-3-pro-high per-instance file is broken. In the TB 2.0 data, 7 submissions name tasks with a "terminal-bench/" prefix and record a different checksum, apparently from a newer Harbor.
- Terminal-Bench 4.0 rows appear to have per-trial results on Harbor Hub leaderboards (hub.harborframework.com). I did not mine them. They could supply an off-ceiling set later, but those tasks are long and cost about $13 per Opus 5.5 trial on average.

## Reproduce

Run these steps from quick/laneb/tasks/ with git, Python 3.11+ and pandas (I used a uv venv in quick/laneb/tasks/.venv). The scripts expect the task repo at ~/.capy/work/ref/terminal-bench-2 checked out at 69671fb (override with TB2_DIR) and harbor at ~/.capy/work/ref/harbor at f3a5a92 (override with HARBOR_DIR).

1. Download: `git clone https://github.com/prime-radiant-inc/terminal-bench-analysis raw/terminal-bench-analysis` and check out 2e161fd. Sparse-clone SWE-bench/experiments into raw/swebench-experiments with `evaluation/verified/*/results/results.json`, `evaluation/verified/*/metadata.yaml` and `evaluation/verified/2026*/per_instance_details.json`.
2. `python fetch_registry.py` writes the Hub pins to raw/hub/.
3. `python flatten_tb2.py` writes raw/tb2_trials.csv.
4. `python label_network.py` writes internet_labels.json.
5. `python check_images.py` writes raw/image_platforms.json.
6. `python prescreen_tb2.py` writes raw/tb2_task_stats.csv and selection_tb2.json.
7. `python build_tasks_json.py`, then `python digest_tasks.py --write`, writes tasks.json. Plain `python digest_tasks.py` checks the digests against a fresh clone of the pinned commit and exits non-zero on any mismatch.
8. `python prescreen_swebv.py`, `python cost_estimate.py` and `python report_tables.py` print the SWE-bench numbers, the cost estimate and the tables above.

## Files

This note is wiki/research/2026-10-28-gsta-12-tb2-task-selection.md. Every other path below is under quick/laneb/tasks/.

- tasks.json: the fixed list and reserves with registry pins, images, timeouts, digests and published stats.
- selection_tb2.json: the rule, the funnel and the full eligible order (54 tasks).
- internet_labels.json: network class and evidence for every TB 2.0 task.
- Scripts, all in quick/laneb/tasks/: flatten_tb2.py, fetch_registry.py, label_network.py, check_images.py, prescreen_tb2.py, build_tasks_json.py, digest_tasks.py, prescreen_swebv.py, cost_estimate.py, report_tables.py.
- quick/laneb/tasks/raw/: downloaded data and intermediate tables that the steps above write. Do not commit it. It holds third-party result files, some of which carried leaked credentials upstream.

<details>
<summary>Agent notes</summary>

**From the Recommendation section**

The whole run (Opus 1 trial, cheap models 2 trials, 3 arms, 20 tasks) comes to about $150 under planning assumptions and about $251 under pessimistic ones, against the $190 cap. Gate the full run on a measured Opus 5.5 cost per trial (see "Cost estimate").

**Whole run**

20 tasks, 3 arms, Opus 1 trial, Haiku and DeepSeek 2 trials each:

| Scenario | Opus 5.5 | Haiku 5.5 | DeepSeek | Total |
|---|---|---|---|---|
| Planning: gstack and placebo arms cost 1.3x the none arm | $93 | $35 | $22 | $150 |
| High: skill arms 1.5x, and everything 1.5x again for model and harness uncertainty | $155 | $58 | $37 | $251 |

Planning fits the $190 cap with about $40 to spare. High does not. The Opus cells carry most of the risk. A suggested gate: run the none arm on Opus for 2 or 3 list tasks first and read the real cost per trial. If the mean is above about $1.60, cut Opus to ranks 1 to 13 or to the 10 tier A tasks before running the skill arms. The Haiku figure depends mostly on whether prompts cross 100k tokens, which short TB 2.0 tasks mostly should not.

</details>

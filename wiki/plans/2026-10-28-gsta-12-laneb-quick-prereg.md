---
id: 2026-10-28-gsta-12-laneb-quick-prereg
kind: plan
title: "Lane B quick look preregistration: gstack vs none vs placebo on 20 Terminal-Bench 2.0 tasks"
summary: Opus 5.5, Haiku 5.5 and DeepSeek V4.1 Flash, three arms, 20 execution-graded TB2 tasks, $190 cap. Exploratory, steers research only.
author: GSTA-12
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: open
links: [quick/laneb/README.md, wiki/research/2026-10-28-gsta-12-tb2-task-selection.md, quick/laneb/arms/README.md]
---
# Lane B quick look on public tasks: preregistration

GSTA-12, for the gstack-evals Captain (GSTA-2). Written 2026-10-28. Exploratory: these numbers steer research and support no public claim. Results go in a separate pull request and record the commit sha that adds this post. The runner, arms, tasks and analysis it names are under [quick/laneb/](../../quick/laneb/README.md).

## Question

On real coding tasks graded by whether the result works, does gstack beat no skills and a length-matched placebo? Asked on Opus 5.5 and on two cheap models. How much of the gap to Opus 5.5 does gstack close for Haiku 5.5 and DeepSeek V4.1 Flash?

## Arms

Every arm runs Claude Code 2.1.312 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. Two built-in skills survive it in every arm: the session's init message lists `doctor` and `plugin-authoring` (as GSTA-10 found), and the skill listing sent to the model holds `plugin-authoring`. The arm is a tarball extracted into `/root` during Harbor's agent setup, before the agent timer starts.

| Arm | What it is | Tarball sha256 |
|---|---|---|
| none | Empty `/root/.claude/skills/` | `8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e` |
| gstack | gstack main at 61e201ec08bcf59163ef2d3a69a26e334a536c04 (v1.91.295.0), installed for Claude Code by its own `./setup --host claude --no-browser`, with the update check off and the one-time onboarding prompts marked seen | `737411ef3d541692daef806ba7375368df1bdceac7b11ab6c6f302ab0f980847` |
| placebo | Same 64 folder names, frontmatter and routing text; each SKILL.md body replaced by on-topic, non-procedural prose within 5% of its tokens; no other files | `ff6b909d89d87be16780b817bf799361263e0efcf931a2b1543db2b779c406f7` |

Placebo generator: [arms/placebo/](../../quick/laneb/arms/placebo/generate.ts), hash `e9c16c577df6e3da474f093665b559584f74857be84403452cb0526df7655d1c` (sha256 over its source files, the js-tiktoken version and the seed), seed `gstack-evals/laneb/placebo/v1`. Input digest (the 64 installed SKILL.md files) `eec9fe901002f80a8a8abaa6c5b825f34f7164de60423fb9ae198f366ac2caee`, output tree digest `95e40ddffcbbe9ca52a90e5ae47c10b547ceacfff24f82f17bf454f5ba2941c9`. Body token ratios (o200k_base) run from 0.9996 to 1.0000. The router's `## Route first` section is kept byte for byte in both copies setup installs (`gstack` and `_gstack-command`). One frontmatter change: the `hooks:` key is removed from the six skills that carry it, because those hooks would call gstack scripts the placebo lacks and would deny or break tool calls while the skill is active. Every other frontmatter byte is kept.

How the arms were built and checked is in [arms/README.md](../../quick/laneb/arms/README.md). Two builds from fresh fetches gave byte-identical tars. The model-facing listing holds 1 skill in the none arm and 65 in the other two, with identical listing text in gstack and placebo. The keyless smoke on cancel-async-tasks confirmed the arms land as built: the init message listed 2, 66 and 66 skills, and each trial logged the sha256 of the tar it extracted, matching the table. The gstack arm models a long-time user: each trial starts from a fresh extract, and without the markers every preamble would print first-run prompts (telemetry, proactive mode, an offer to commit routing rules to the task repo) that a real user sees once.

One prompt wrapper, identical across arms: [runner/prompt-wrapper.md](../../quick/laneb/runner/prompt-wrapper.md), sha256 2e0674a8e1d65dfd7e511e7f7255235410d75a65fe49d7ce03c9d54202089d00. AskUserQuestion is answered by the same evaluator-side simulator in every arm ([persona](../../quick/laneb/runner/agent/persona.json), sha256 af0312bd87ed08534a111d61689537cc55743a3020c0f44cf4df186417e90e8d): it picks an option the agent marked recommended, otherwise tells the agent to decide and finish.

## Models

| Cell | Endpoint | Session cap |
|---|---|---|
| claude-opus-5-5 (reference) | Anthropic API | $5.00 |
| claude-haiku-5-5 | Anthropic API | $1.00 |
| deepseek/deepseek-v4.1-flash-1017 | OpenRouter's Anthropic Messages route, `provider: {only: ["deepseek"], allow_fallbacks: false}` injected by the proxy | $0.50 |

Claude Code's default effort, and an SDK ceiling of 200 turns. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in every cell, because Claude Code otherwise asks for 128k output tokens and the per-request worst case would eat the session cap. Every tier alias and the subagent model point at the cell's model, and the proxy rewrites any requested model to the cell's. Prices are in [config/proxy.json](../../quick/laneb/config/proxy.json): Anthropic list prices from claude.com/pricing, read 2026-10-28, with Haiku 5.5's price for prompts over 100k tokens applied per request. DeepSeek's own endpoint charges $0.15/$0.60 per MTok off peak and $0.30/$1.20 at weekday peak (OpenRouter endpoints API, read 2026-10-28); the proxy meters every DeepSeek request at the peak price, so DeepSeek costs are upper bounds, up to 2x high. No Sonnet, no judge.

DeepSeek is the newest snapshot of the top open-weight family in the 2026-10-26 OpenRouter programming snapshot (wiki research post). Re-read from the Data API (`rankings-daily?category=programming`, meta.as_of 2026-10-28T19:10:59.240Z, latest weekly bucket 2026-10-26): deepseek-v4.1-flash-20261017 is first with 23.5% of programming tokens and the family's earlier snapshot has 7.8%, matching the public collection page. Any change takes effect only at the next preregistration. If Claude Code cannot complete a session through this route within 4 hours of the first route check, the DeepSeek rung is dropped and the report says so. The route check passed on 2026-10-28: the smoke task scored 1 on each model through the proxy and ledger, for $0.13 in total (Opus $0.124, DeepSeek $0.005 metered at peak against OpenRouter's reported $0.0027, Haiku $0.004). It ran on the Capy machine before the run host's oracle re-check; it touches no Terminal-Bench task.

## Tasks

20 Terminal-Bench 2.0 tasks from Harbor's registry (`terminal-bench@2.0`, laude-institute/terminal-bench-2 at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c), chosen before any of our runs by a fixed rule over published per-trial results (9 Opus 4.7 and GPT-5.5 submissions as frontier, 14 cheap ones). The rule, sources and scripts are in [the task selection post](../research/2026-10-28-gsta-12-tb2-task-selection.md); [tasks/tasks.json](../../quick/laneb/tasks/tasks.json) has every field. Tier A (ranks 1 to 10) is the target window: frontier pass rate at most 0.85, cheap at most 0.30. Ranks 11 to 20 are easier, and Opus 5.5 is expected near ceiling there. Rank 14, qemu-alpine-ssh, was replaced by reserve R1 before any paid run (below). SWE-bench Verified was rejected: the frontier is at about 97% on it.

| Rank | Task | Tier | Frontier | Cheap | Agent timeout (min) | Digest (sha256, first 16) |
|---|---|---|---|---|---|---|
| 1 | filter-js-from-html | A | 0.36 | 0.00 | 30 | c00cee7f6ad36067 |
| 2 | dna-insert | A | 0.44 | 0.00 | 30 | 51844430e650408b |
| 3 | model-extraction-relu-logits | A | 0.43 | 0.23 | 15 | 0dc5544f14a8f9eb |
| 4 | chess-best-move | A | 0.63 | 0.00 | 15 | 55db198810b8b6f1 |
| 5 | torch-tensor-parallelism | A | 0.65 | 0.13 | 15 | b95c4082135aa71f |
| 6 | adaptive-rejection-sampler | A | 0.65 | 0.24 | 15 | b4c60177f24d0308 |
| 7 | db-wal-recovery | A | 0.74 | 0.07 | 15 | 35aeff78e6f412bb |
| 8 | polyglot-rust-c | A | 0.77 | 0.06 | 15 | c19e86b5cd48f495 |
| 9 | break-filter-js-from-html | A | 0.72 | 0.22 | 20 | 7087019da8f9ff65 |
| 10 | overfull-hbox | A | 0.79 | 0.22 | 12 | 45bdee2b2f454f45 |
| 11 | extract-elf | B | 0.72 | 0.54 | 15 | 6d1272cf63b53a46 |
| 12 | torch-pipeline-parallelism | B | 0.88 | 0.00 | 15 | caaae18a9f67750e |
| 13 | polyglot-c-py | B | 0.88 | 0.09 | 15 | de6785fc9ec4d82b |
| 14 | qemu-alpine-ssh | B | 0.88 | 0.22 | 15 | dd8c3eae85efa4d9 |
| 15 | query-optimize | B | 0.85 | 0.46 | 15 | 47e0fba77bc2e62f |
| 16 | tune-mjcf | B | 0.88 | 0.41 | 15 | 28651755e24f4262 |
| 17 | configure-git-webserver | B | 0.84 | 0.64 | 15 | 367c8c1983aabd74 |
| 18 | mailman | B | 0.88 | 0.56 | 30 | 217914a8f3ce4906 |
| 19 | pytorch-model-cli | B | 0.83 | 0.73 | 15 | 5c0d3625b5dd974a |
| 20 | cancel-async-tasks | B | 0.93 | 0.46 | 15 | 5da010fd0c9de489 |
| R1 | sanitize-git-repo | reserve | 0.95 | 0.40 | 15 | 0a52105e18321755 |
| R2 | largest-eigenval | reserve | 0.93 | 0.61 | 15 | 2bfa63009e386065 |
| R3 | pypi-server | reserve | 0.89 | 0.76 | 15 | 0644861427264cd2 |
| R4 | feal-differential-cryptanalysis | reserve | 0.95 | 0.43 | 30 | eacf0f43b76f517f |
| R5 | pytorch-model-recovery | reserve | 0.93 | 0.64 | 15 | 22c73f0905c98f0d |
| R6 | sparql-university | reserve | 0.95 | 0.51 | 15 | c9030c1b06e85711 |

Digest: sha256 over sorted `<relpath>\0<sha256(file)>\n` lines of the registry task directory (`tasks/digest_tasks.py`). A first oracle pass ran on 2026-10-28 on a Capy machine with every phase public. 19 of the 20 main tasks scored 1. qemu-alpine-ssh scored 0 because its verifier's `apt-get install curl` now gets 404s for bullseye security packages, which fails on any host, so it was dropped and the first reserve, sanitize-git-repo, took its place; its oracle scored 1 (so did R2, largest-eigenval). The final list, in run order, is [tasks/final.json](../../quick/laneb/tasks/final.json). Before the first paid call, every final task runs the oracle again on the run host under the trial network policy, and a task that fails there is replaced by the next unused reserve, in order. After the first paid call no task is swapped; a task that cannot be graded in any arm is dropped and reported.

## Runner

Harbor at f3a5a923f6d722472c9e797af836ae4425fb215f with claude-agent-sdk 0.2.174, our SDK agent ([runner/agent/laneb_agent.py](../../quick/laneb/runner/agent/laneb_agent.py)), grown from the U8 spike. Each task image is the published image plus a runtime layer identical across arms (Claude Code, Node 24, Bun 1.4.4 at the end of PATH). Grading is the task's own `tests/test.sh` in the agent's container after the agent stops (Terminal-Bench 2.0 tasks grade container state, so the verifier is shared). Verifier timeouts are doubled for every task, because the published data shows 30 and 27 verifier timeouts on filter-js-from-html and query-optimize, which TB 2.1 later fixed the same way. Agent timeouts are the tasks' own.

Network, per phase: the agent phase gets Harbor's egress allowlist with the metering proxy plus OS and Python package registries (deb.debian.org, security.debian.org, archive.ubuntu.com, security.ubuntu.com, pypi.org, files.pythonhosted.org, download.pytorch.org, download-r2.pytorch.org, dl-cdn.alpinelinux.org), because several reference solutions install packages. GitHub, tbench.ai and the rest of the web are blocked, and WebSearch and WebFetch are disabled. The verifier phase is public, because every test.sh downloads uv and pytest. Trials run on Ubicloud VMs with stock Ubuntu 24.04 kernels, checked for nftables inet at boot. If no such host passes within 4 hours of the first VM launch, trials run with a public agent phase and every number is labelled "unlocked network".

## Trials, money and the stop rule

Cap: $190, line item `laneb-quick` under the $500 first cap (Garry: "Rec" at gate 1, and "It should be fast like this week"). The ledger is the Captain drive's `ledger/laneb-quick.jsonl`. Before every agent session the metering proxy asks the ledger to reserve that session's cap, and the ledger refuses a reserve that would take settled plus open reserves past $190. The proxy refuses any request whose worst case, added to the session's spend and the worst cases of its requests still in flight, would pass the session cap, so a session never costs more than its reserve. A request's worst case is its input tokens at the uncached or 5-minute cache-write price (the 1-hour price if the request asks for that ttl) plus max_tokens at the output price. Input tokens come from Anthropic's count_tokens endpoint on the Anthropic routes, and are one token per UTF-8 byte on OpenRouter or whenever counting fails, because Opus 5.5 counts random base64 at 1.05 bytes per token and source code at 2.5 (measured with count_tokens on 2026-10-28). Claude Code 2.1.312 asks only for 5-minute caching. The bound is loose, so a session with a long context is refused before it spends its whole cap: at a 150k-token context an Opus session stops near $3.60. That applies to every arm alike. When a session closes, requests still running after 30 seconds are aborted and charged their worst case, and a stream the client dropped is read to its end so its usage is counted. Each session settles with its metered cost.

Order. Each step is one Harbor job, built by [runner/prepare-run.ts](../../quick/laneb/runner/prepare-run.ts), with tasks in rank order and every cell of a task queued together, so a stop leaves whole task blocks behind:

1. Route check ([runner/route-check.sh](../../quick/laneb/runner/route-check.sh)): the smoke task once per model, arm none, through the real proxy and ledger.
2. Replicate 1: all 9 cells (3 models by 3 arms), 1 trial each on all 20 tasks.
3. Replicates 2 and 3 for the Haiku and DeepSeek cells.
4. Replicate 2 for the Opus cells, then further replicates in the same order while money remains.

Projected spend, from subagent 1's per-task estimates built on published Opus 4.7 tokens and Opus 4.6 bills ([the task selection post](../research/2026-10-28-gsta-12-tb2-task-selection.md)): one Opus replicate of the 3 arms is about $77 ($25.6 per arm), and the Haiku and DeepSeek cells together cost under $15 per replicate. So steps 1 to 3 come to about $110 and step 4 about $77 more, close to the cap. Under the pessimistic assumptions in that post, Opus costs about $128 per replicate and step 4 stops part way. These are projections, not measurements; the first replicate replaces them.

Stop rule: when the ledger refuses a reserve, the proxy latches the stop and refuses every later session, running sessions finish inside their reserves, and the run is reported as incomplete at that point. A cap stop is never retried to change a result: the agent raises `LedgerCapStop` and Harbor's retry list excludes it. A trial in which no model response reached the agent (image build, container start, proxy or provider unreachable) is an infrastructure failure and is rerun up to twice. Each arm tarball is checked against its preregistered sha256 when the run is prepared, on the VM and again in each trial before any model call. A session that hits its cap or the agent timeout is graded as it stands. Tasks with fewer trials in a cell (a part-finished replicate) count once per task like every other task; the paired contrasts compare cells within each task.

## Metrics and analysis

The outcome is the task's verifier reward (1 or 0). Per cell, the pass rate is the mean over tasks of each task's mean over graded trials. Intervals are 95% percentile intervals from a task-clustered bootstrap (10,000 resamples of tasks, seed 20261028), in [analysis/analyze.ts](../../quick/laneb/analysis/analyze.ts).

- Pass rate per arm and model.
- gstack minus none, gstack minus placebo and placebo minus none, per model, paired by task.
- Cost per success per cell: metered cost of graded trials divided by passes.
- Share of the Opus gap closed, per cheap model M: (M gstack minus M none) / (Opus none minus M none) over tasks graded in all three cells, with the share of resamples where the gap is positive.
- Skill-open rate per arm: the share of graded trials that call the Skill tool or read a SKILL.md, with counts per skill.
- Budget stops (sessions the proxy cut off at their cap) and agent timeouts, per cell.
- Every dropped task and infrastructure failure, with its reason.

All 20 tasks are the primary set; tier A (ranks 1 to 10) is reported as a secondary set. With 20 tasks and 1 to 3 trials per cell these are exploratory estimates. No parity or non-inferiority claim is made.

## Changes after the first paid call

The route check (step 1) ran at cf3fda1. The text above last changed at 111829d (f3867fd holds the same text); replicate 1 ran on runner commit ba7a648. Changes recorded since then, each before the replicates it affects:

- 2026-10-28, after replicate 1 and before replicate 2 (Captain GSTA-2). A run end is added to the stop rule: the run stops at the cap or at 12:00 PT on Friday 2026-10-30, whichever comes first, and is reported as it stands. Replicate 1 cost $17.05 metered against about $90 projected, so steps 3 and 4 cannot reach the cap. Replicates 2 and 3 therefore run as one Harbor job for all 9 cells on the same runner commit, and further replicates of all 9 cells follow while money and time remain.
- 2026-10-28 (Captain GSTA-2). gstack /ship on this pull request found 12 blocking defects in the runner and analysis code. The run keeps that code as it ran, the defects are recorded as skipped with the Captain as accepted_by, and a fix pull request follows. The results check each replicate's logs for every defect that could change a number.
- 2026-10-28, secondary analyses added after replicate 1. Opus 5.5's API safeguards refused two tasks in every arm (dna-insert as `[bio]`, break-filter-js-from-html as `[cyber]`), and DeepSeek's sessions on filter-js-from-html hit their session cap in every arm. These count as 0 as above; the results add a sensitivity that drops those tasks. A trial whose verifier timed out counts as 0, because a model response reached the agent; the results also show it dropped. The results flag any trial whose transcript or command log shows raw sockets, setsockopt or SO_MARK, iptables, nft or ip rule, or a connection outside the allowlist, and show totals with and without flagged trials.
- The placebo generator hash above (e9c16c57) matches the generator at cf3fda1. 111829d changed two error-message prefixes in that file, so the hash at ba7a648 is 04b4c94f. The placebo bytes and the arm tar sha256 did not change.

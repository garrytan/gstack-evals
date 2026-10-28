# Lane B quick look on public tasks: preregistration

GSTA-12, for the gstack-evals Captain (GSTA-2). Written 2026-10-28. Exploratory: these numbers steer research and support no public claim. Results go in a separate pull request and record this file's commit sha.

## Question

On real coding tasks graded by whether the result works, does gstack beat no skills and a length-matched placebo? Asked on Opus 5.5 and on two cheap models. How much of the gap to Opus 5.5 does gstack close for Haiku 5.5 and DeepSeek V4.1 Flash?

## Arms

Every arm runs Claude Code 2.1.312 with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`. Two bundled skills, `doctor` and `plugin-authoring`, still load in every arm (GSTA-10's finding). The arm is a tarball extracted into `/root` during Harbor's agent setup, before the agent timer starts.

| Arm | What it is | Tarball sha256 |
|---|---|---|
| none | Empty `/root/.claude/skills/` | __NONE_TAR__ |
| gstack | gstack main at 61e201ec08bcf59163ef2d3a69a26e334a536c04 (v1.91.295.0), installed for Claude Code by its own `./setup --host claude --no-browser` | __GSTACK_TAR__ |
| placebo | Same folder names, frontmatter and routing text; each SKILL.md body replaced by on-topic, non-procedural prose within 5% of its tokens; no other files | __PLACEBO_TAR__ |

Placebo generator: `arms/`, hash __GEN_HASH__ (sha256 over its source files and the seed), seed __SEED__. __PLACEBO_NOTES__

One prompt wrapper, identical across arms: [runner/prompt-wrapper.md](runner/prompt-wrapper.md), sha256 2e0674a8e1d65dfd7e511e7f7255235410d75a65fe49d7ce03c9d54202089d00. AskUserQuestion is answered by the same evaluator-side simulator in every arm ([persona](runner/agent/persona.json), sha256 af0312bd87ed08534a111d61689537cc55743a3020c0f44cf4df186417e90e8d): it picks an option the agent marked recommended, otherwise tells the agent to decide and finish.

## Models

| Cell | Endpoint | Session cap |
|---|---|---|
| claude-opus-5-5 (reference) | Anthropic API | $5.00 |
| claude-haiku-5-5 | Anthropic API | $1.00 |
| deepseek/deepseek-v4.1-flash-1017 | OpenRouter's Anthropic Messages route, `provider: {only: ["deepseek"], allow_fallbacks: false}` injected by the proxy | $0.50 |

Claude Code's default effort, and an SDK ceiling of 200 turns. `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in every cell, because Claude Code otherwise asks for 128k output tokens and the per-request worst case would eat the session cap. Every tier alias and the subagent model point at the cell's model, and the proxy rewrites any requested model to the cell's. Prices are in [config/proxy.json](config/proxy.json): Anthropic list prices from claude.com/pricing, read 2026-10-28, with Haiku 5.5's price for prompts over 100k tokens applied per request. DeepSeek's own endpoint charges $0.15/$0.60 per MTok off peak and $0.30/$1.20 at weekday peak (OpenRouter endpoints API, read 2026-10-28); the proxy meters every DeepSeek request at the peak price, so DeepSeek costs are upper bounds, up to 2x high. No Sonnet, no judge.

DeepSeek is the newest snapshot of the top open-weight family in the 2026-10-26 OpenRouter programming snapshot (wiki research post). Re-read on 2026-10-28 at 18:10 UTC from the public collection page (openrouter.ai/collections/programming), because the Data API needs an OpenRouter key and none is on this machine yet, so no meta.as_of is recorded here: DeepSeek V4.1 Flash is still first, with 23.5% of trailing-7-day programming tokens plus 7.8% for its second variant. The route check reads the Data API once the key lands and records meta.as_of with the results; any change takes effect only at the next preregistration. If Claude Code cannot complete a session through this route by 2026-10-29 18:00 PT, the DeepSeek rung is dropped and the report says so.

## Tasks

20 Terminal-Bench 2.0 tasks from Harbor's registry (`terminal-bench@2.0`, laude-institute/terminal-bench-2 at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c), chosen before any of our runs by a fixed rule over published per-trial results (9 Opus 4.7 and GPT-5.5 submissions as frontier, 14 cheap ones). The rule, sources and scripts are in [tasks/selection.md](tasks/selection.md); [tasks/tasks.json](tasks/tasks.json) has every field. Tier A (ranks 1 to 10) is the target window: frontier pass rate at most 0.85, cheap at most 0.30. Ranks 11 to 20 are easier, and Opus 5.5 is expected near ceiling there. Rank 14, qemu-alpine-ssh, was replaced by reserve R1 before any paid run (below). SWE-bench Verified was rejected: the frontier is at about 97% on it.

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

Digest: sha256 over sorted `<relpath>\0<sha256(file)>\n` lines of the registry task directory (`tasks/digest_tasks.py`). Before the first paid call, every task runs once with Harbor's oracle agent on the run host under the trial network policy. A first oracle pass ran on 2026-10-28 on a Capy machine with every phase public. 19 of the 20 main tasks scored 1. qemu-alpine-ssh scored 0 because its verifier's `apt-get install curl` now gets 404s for bullseye security packages, which fails on any host, so it was dropped and the first reserve, sanitize-git-repo, took its place; its oracle scored 1. The final list, in run order, is [tasks/final.json](tasks/final.json). A task whose oracle fails there is replaced by the next reserve, in order. After the first paid call no task is swapped; a task that cannot be graded in any arm is dropped and reported.

## Runner

Harbor at f3a5a923f6d722472c9e797af836ae4425fb215f with claude-agent-sdk 0.2.174, our SDK agent ([runner/agent/laneb_agent.py](runner/agent/laneb_agent.py)), grown from the U8 spike. Each task image is the published image plus a runtime layer identical across arms (Claude Code, Node 24, Bun 1.4.4 at the end of PATH). Grading is the task's own `tests/test.sh` in the agent's container after the agent stops (Terminal-Bench 2.0 tasks grade container state, so the verifier is shared). Verifier timeouts are doubled for every task, because the published data shows 30 and 27 verifier timeouts on filter-js-from-html and query-optimize, which TB 2.1 later fixed the same way. Agent timeouts are the tasks' own.

Network, per phase: the agent phase gets Harbor's egress allowlist with the metering proxy plus OS and Python package registries (deb.debian.org, security.debian.org, archive.ubuntu.com, security.ubuntu.com, pypi.org, files.pythonhosted.org, download.pytorch.org, download-r2.pytorch.org, dl-cdn.alpinelinux.org), because several reference solutions install packages. GitHub, tbench.ai and the rest of the web are blocked, and WebSearch and WebFetch are disabled. The verifier phase is public, because every test.sh downloads uv and pytest. Trials run on Ubicloud VMs with stock Ubuntu 24.04 kernels, checked for nftables inet at boot. If no such host works by 2026-10-29 23:59 PT, trials run with a public agent phase and every number is labelled "unlocked network".

## Trials, money and the stop rule

Cap: $190, line item `laneb-quick` under the $500 first cap (Garry: "Rec" at gate 1, and "It should be fast like this week"). The ledger is the Captain drive's `ledger/laneb-quick.jsonl`. Before every agent session the metering proxy asks the ledger to reserve that session's cap, and the ledger refuses a reserve that would take settled plus open reserves past $190. The proxy refuses any request whose worst case (request bytes / 3 tokens at the uncached or 5-minute cache-write price, or the 1-hour price if the request asks for that ttl, plus max_tokens at the output price) would take the session past its cap, so a session never costs more than its reserve. Claude Code 2.1.312 asks only for 5-minute caching. The bound is loose, so a session with a long context is refused before it spends its whole cap: at a 150k-token context an Opus session stops near $3.50. That applies to every arm alike. Each session settles with its metered cost.

Order, one Harbor job per batch, tasks in rank order and the three arms of a task together:

1. Route check: one short request per model through the proxy.
2. Replicate 1: DeepSeek, then Haiku, then Opus. Each cell gets 1 trial on all 20 tasks.
3. Replicates 2 and 3 on Haiku and DeepSeek.
4. Replicate 2 on Opus, in rank order, then further replicates while money remains.

Stop rule: when the ledger refuses a reserve, no new session starts, running sessions finish inside their reserves, and the run is reported as incomplete at that point. A cap stop is never retried to change a result. A trial with no verifier reward (an infrastructure failure) is rerun up to twice. A session that hits its cap or the agent timeout is graded as it stands.

## Metrics and analysis

The outcome is the task's verifier reward (1 or 0). Per cell, the pass rate is the mean over tasks of each task's mean over graded trials. Intervals are 95% percentile intervals from a task-clustered bootstrap (10,000 resamples of tasks, seed 20261028), in [analysis/analyze.ts](analysis/analyze.ts).

- Pass rate per arm and model.
- gstack minus none, gstack minus placebo and placebo minus none, per model, paired by task.
- Cost per success per cell: metered cost of graded trials divided by passes.
- Share of the Opus gap closed, per cheap model M: (M gstack minus M none) / (Opus none minus M none) over tasks graded in all three cells, with the share of resamples where the gap is positive.
- Skill-open rate per arm: the share of graded trials that call the Skill tool or read a SKILL.md, with counts per skill.
- Every dropped task and infrastructure failure, with its reason.

All 20 tasks are the primary set; tier A (ranks 1 to 10) is reported as a secondary set. With 20 tasks and 1 to 3 trials per cell these are exploratory estimates. No parity or non-inferiority claim is made.

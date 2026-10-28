# S3: review, QA/browser, debugging and lifecycle benchmarks for gstack-evals

Research date 2026-10-27. Subagent 3 of GSTA-4. Read-only clones are in ~/.capy/work/gsta4/clones/3/ (Martian e616e84 2026-08-30, ReviewBench 228f2a8 2026-10-27, SWEeper-Bench 96f86f2 2026-10-14). ⚠ marks self-reported, vendor-run or secondhand claims. "Not found" means I looked and list where.

## Bottom line

- **/review has real public material, but every public set is fully exposed.** Martian (50 PRs, 173 golden comments), GitHub ReviewBench (219 PRs, Harbor-native) and Qodo PR-Review-Bench (100 PRs, 580 injected issues with known locations) publish their answer keys. Use them as dev/val, never as the sealed split. Cheap models already sit near frontier on review: on MacroscopeBench (proprietary data, public board ⚠) GLM 5.3 max scores 77.4 vs GPT-6 Astra max 78.0 and Opus 5.5 max 83.9. Headroom for a /review parity claim is small; precision is where cheap models lose.
- **/qa has one strong public match: SWEeper-Bench** (200 real bugs in 200 web apps, the agent must find the bug by using the app, browser verifier, best agent 59%). Its hidden browser workflows are published on Hugging Face, so it cannot be a held-out split either.
- **/investigate and the plan skills have partial matches** (Replay Web Debug Bench, Senior SWE-Bench, SWE-Atlas QnA, Vibe Code Bench 1-100). **No public benchmark grades a plan or design doc, a PR landing flow, or CI babysitting with a trustworthy grader.** gstack-evals must author those, and must author every sealed split.

## 1. Code review benchmarks (/review)

### 1.1 Martian Code Review Bench (offline + online)

1. **Task.** The tool reviews a PR (diff plus repo on GitHub) and posts comments. An LLM extracts candidate issues, dedups them, and judges each against golden comments. The online half mines fresh bot-reviewed GitHub PRs and treats the developer's post-review fixes as ground truth. https://github.com/withmartian/code-review-benchmark
2. **Count.** Offline: 50 PRs, 10 each from Sentry (Python), Grafana (Go), Cal.com (TS), Discourse (Ruby), Keycloak (Java); 173 golden comments with severity and 10 category tags (I counted 41/41/25/30/36 in offline/golden_comments/). Profiles: Strict 139, Core 158 (default), All 173. https://raw.githubusercontent.com/withmartian/code-review-benchmark/main/offline/README.md. The HF card says "136 expert-curated golden issues across 50 PRs" plus an online split of 1,135 PRs (15 tools, Feb to Apr 2026); I could not reconcile 136 vs 173. https://huggingface.co/datasets/code-review-bench/code-review-bench
3. **Grader.** Human-curated golden set with LLM-judged matching ("same underlying issue?"), three judges stored separately (Opus 4.5, Sonnet 4.5, GPT-5.2), F-beta 0.5 to 3.0 (dashboard default beta 2.0, profile core). Martian's methodology says the judge "has not been formally calibrated against human annotations" and that a gold set "caps at human performance," so real finds score as false positives. https://raw.githubusercontent.com/withmartian/code-review-benchmark/main/methodology/full.md. Open issue #69 (2026-10-10): "Golden comments miss real defects, so valid review findings score as false positives" ⚠ (title seen in the issues list; the issue page timed out). https://github.com/withmartian/code-review-benchmark/issues. The 50 PRs are re-created on forks such as ai-code-review-evaluation/sentry-greptile and derive from Greptile's July 2025 backtracked set (golden JSON url fields; methodology section 3).
4. **Licence.** Code MIT (GitHub API). HF dataset CC-BY-4.0. The diffs embed source from Sentry (GitHub reports "Other"), Grafana (AGPL-3.0), Keycloak (Apache-2.0), Discourse (GPL-2.0) and Cal.com (no licence detected by the API).
5. **Contamination.** High. PRs have been public on forks since 2025 and the golden comments sit in the repo. Martian lists training leakage as a known limitation and runs the online half to compensate. A held-out test set is only described as something they "may maintain."
6. **Scores.** No rows for Opus 5.5, GPT-6.x or any pegged cheap model in the repo dashboard (offline/analysis/benchmark_dashboard.json); tools only. My micro-averaged core-profile F1 from that JSON, Opus 4.5 judge: Qodo Extended 65.8%, Cubic v2 63.6%, Augment 62.2%, Claude Code (CLI) 47.2%, Graphite 14.1%. Swapping the judge moves Qodo Extended to 56.6% (Sonnet 4.5) and 58.9% (GPT-5.2), a 9-point judge effect. Vendor claims ⚠: Qodo "#1, 64.3% F1" https://www.qodo.ai/blog/qodo-ranked-1-ai-code-review-tool-in-martians-code-review-benchmark/ ; Greptile "#1 online, 60.8% F1, July 30, 2026" https://www.greptile.com/content-library/greptile-martian-code-review-benchmark.
   **gstack result ⚠.** Sam Fold (LinkedIn, 2026-03-20) ran the gstack /review checklist prompt alone, not the full skill, on these 50 PRs: 4 prompts x 4 reviewers (Sonnet 4, 4.5, 4.6, Opus 4.6), 4 judges including GPT-5.4 and Opus 4.6, 1,400 reviews, "$120" (the post says $150). On Opus 4.6: two-sentence baseline 33.2% F1, gstack 31.6%, 6-word prompt 31.8%, pi-mono 31.4%; gstack recall 49% vs 56% for the baseline. His F1 scale differs from Martian's (profile and judge unstated). https://www.linkedin.com/pulse/garry-tans-gstack-tells-claude-what-look-turns-out-already-sam-fold-drlxe
7. **Docker/Harbor.** None. The offline pipeline needs GitHub forks and a GitHub token; a local diff-in, findings-out wrapper is easy to write.
8. **Cost.** Not published by Martian. Sam Fold's figures imply about $0.09 per review on 2026-Q1 Anthropic models ⚠ (my division).
9. **Fit.** /review as-is (diff in, findings out). n is tiny: 50 PRs gives wide intervals, and one judge swap moves scores more than Sam Fold's whole prompt spread (1.8 pp). Use it as a public dev split and as the replication target for Sam Fold's claim, this time with the full skill.

### 1.2 GitHub ReviewBench (Harbor-native)

1. **Task.** A reviewer runs in a container on a frozen PR and writes findings per instruction.md; a separate verifier judge matches them to golden findings. https://github.com/review-bench/ReviewBench
2. **Count.** 219 PRs from 187 repos, with a 25-PR test subset; TypeScript 31%, Python 19%, C# 11%, Go 9%, JavaScript 7%, other 23%; 36% of PRs change more than 1,000 lines; 2,623 golden TP findings in the full set (README tables).
3. **Grader.** LLM judge against a golden set that is mostly model-produced: 53.0% from LLM review agents, 45.2% from "ccr" runs of GPT-5.5 (medium) and Opus 4.7 (medium), 1.5% from human review comments, 0.3% from static tools. Humans audited the labels (TP/FP agreement 96.6%, category 79.7%). Source: docs/METHODOLOGY.md in the clone. That biases recall toward what GPT-5.5 and Opus 4.7 notice. The official leaderboard judge is Claude Sonnet 5 (README "Costs"); the Harbor package uses Claude Opus 5, which fits the crew's no-Sonnet adjudication rule.
4. **Licence.** MIT (repo). Mirrors of each source repo sit under the review-bench org; source repos keep their own licences.
5. **Contamination.** All golden findings are public. The PR date range is not stated in the files I read.
6. **Scores ⚠ (aggregator; GitHub's own product ranks first).** Grounded recall: Copilot Code Review Balanced 26.0% (87.8% precision), Devin 23.8%, Qodo 22.1%, Codex GPT-5.6 Sol Ultra 19.9%, Cursor 9.6%. https://aicoder.com/news/news-20261007-github-reviewbench-open-ai-code-review-benchmark. No Opus 5.5, GPT-6 or cheap-model rows found. Far from ceiling.
7. **Harbor.** Yes: review-bench/reviewbench-public@v1, CPU-only, judge isolated in the verifier, judge key passed only to the verifier. https://hub.harborframework.com/datasets/review-bench/reviewbench-public
8. **Cost.** Reviewer and judge are self-funded; ReviewBench pays the judge only for official final submissions (README "Costs"). No per-PR figure.
9. **Fit.** The best drop-in for /review in a Harbor stack, with the largest PRs of any set. Run it with the Opus 5 (or newer, non-Sonnet) judge.

### 1.3 Qodo PR-Review-Bench 1.0 (injected bugs, known locations)

100 merged PRs from 8 repos (TS, Python, JS, C, C#, Rust, Swift) with 580 LLM-injected issues: functional bugs plus repo-specific best-practice violations, double-validated. PRs live in a benchmark GitHub org; the JSONL gives the PR URL and the full issue list. Licence MIT on HF. Scored by precision, recall and F1 against the injected issues, matched by an LLM judge. Qodo reports its own tool at 60.1% F1 ⚠. https://huggingface.co/datasets/Qodo/PR-Review-Bench/blob/main/README.md · https://www.qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review/ . Martian's critique: injected bugs may not match the distribution of bugs humans write. **Fit:** the cleanest public recall metric for /review, and the template for our own sealed seeded-bug splits. No Harbor dataset found.

### 1.4 Other review sets

| Set | Task and count | Ground truth / grader | Licence | Scores (frontier, cheap) | Notes |
|---|---|---|---|---|---|
| Greptile 2025 | 50 backtracked bugs, 5 repos, one bug per PR | Caught = line-level comment naming the bug; manual check | Forks public; licence not checked | Vendor tools only ⚠ | Parent of Martian; catch rate only, no precision. https://www.greptile.com/benchmarks |
| SWE-PRBench | 350 PRs; human review comments from the GitHub API; 3 context configs | LLM judge (GPT-5.2) validated at kappa 0.75 | Data CC-BY-4.0, harness MIT | 8 older models detect 15-31% | PRs merged 2025-09 to 2026-02. https://arxiv.org/abs/2603.26130 · https://github.com/FoundryHQ-AI/swe-prbench |
| c-CRAB | 410 instances from SWE-CARE; 339 with verified executable tests | Tests generated from human review comments; a finding counts if applying it passes them | No licence file (GitHub API) | PR-Agent, Devin, Claude Code and Codex together solve about 40% | Docker images on GHCR. https://arxiv.org/abs/2603.23448 · https://github.com/c-CRAB-Benchmark/dataset |
| SWE-Review-Bench | 1,384 AI-generated PRs on SWE-bench Verified issues, 3 quality tiers | Accept/reject truth from SWE-bench tests (deterministic); resolve rate after revision | Apache-2.0 (HF) | GLM-5 resolve 72.2% to 75.4% after the review loop | Ships a Harbor/OpenHands runner; inherits SWE-bench Verified contamination. https://arxiv.org/abs/2607.06065 · https://huggingface.co/datasets/Lego-X/SWE-Review-Bench |
| SecPRBench | 265 vulnerability-introducing commits, 530 paired tasks (buggy + fixed companion), 9 C/C++/Rust projects | PoC-validated targets; Opus 5.5 (high) judges the root-cause explanation | "Other" | Recall 32.5-78.1%; Grok 4.6, GPT-6 Sol, GLM 5.3 and Opus 5.5 statistically tied near 3/4 | Snapshot has no usable git history; Docker sandbox. https://arxiv.org/abs/2610.33509 · https://github.com/yijan4845/secprbench |
| CRBugBench (Microsoft) | 1,000 OSS review tasks (98 repos) + 800 proprietary | Human-verified bug per introducing PR; recall within top-5 comments, LLM judge | CC-BY-4.0 per aggregator ⚠ | claude-opus-5 + copilot-cli 71.9%; opus-4.6 47.7% | Release not verified. https://arxiv.org/abs/2610.13668 |
| CR-Bench | SWE-bench converted to review tasks; 584 instances per alphaXiv ⚠ | CR-Evaluator agent judge | Not found | Two frontier models (preliminary) | https://arxiv.org/abs/2603.11078 |
| CodeReviewBench (Kodus) | Synthetic regressions in 5 languages, exact bug lines | Two LLM judges averaged | Not found | Sonnet 4.5 87.1% on top: near ceiling | https://codereviewbench.com/ |
| MacroscopeBench | 12,000+ bugs from 1,500+ repos, control commits mixed in | Two LLM judges; recall vs known bugs, precision vs judge-validated reports | Proprietary | Opus 5.5 max 83.9 (R 83.8%, P 84.0%, $11.58, 10m8s); GPT-6.1 Sol max 78.5 ($1.05); GPT-6 Astra max 78.0; GLM 5.3 max 77.4 ($3.86); DeepSeek V4.1 Flash max 72.0 (R 83.1%, P 63.5%, $0.75) ⚠ | Not usable as tasks. https://macroscope.com/benchmark · https://macroscope.com/blog/macroscopebench |
| Qodo model bench | 125 PRs, 703 backtracked bugs | Sonnet 4.6 judge | Proprietary | Opus 5.5 high 56.8% F1 ($1.00/PR); GLM 5.3 high 52.1% ($0.76); GPT-6 Sol medium 48.7% ($0.18) ⚠ | https://www.qodo.ai/blog/which-llm-should-review-your-code/ |
| Cheddar Bench | Self-play: agents inject bugs and write a bugs.json manifest, other agents review | Manifest + matching | MIT | Small | A design idea for fresh sealed splits. https://github.com/przadka/cheddar-bench |

**Ground truth types.** Injected with known locations: Qodo, Kodus CodeReviewBench, Cheddar. Backtracked real bugs: Greptile and Martian offline, CRBugBench, SecPRBench (PoC-validated), and the private MacroscopeBench and Qodo model bench. Human-comment based: SWE-PRBench, and c-CRAB, which turns comments into executable tests and is the most deterministic. Model-heavy golden set: ReviewBench. Every set except c-CRAB and SWE-Review's accept/reject truth needs an LLM to match free text, so judge choice and calibration are part of the measurement.

## 2. QA and browser testing (/qa)

### 2.1 SWEeper-Bench (Princeton, Oct 2026)

1. **Task.** The agent gets the app code, the running app, a browser and a scoped request ("Find and fix issues in Focalboard's board sharing and membership"). It must discover the bug by using the app, then patch it. A verifier agent replays a hidden target workflow (bug gone) and a preservation workflow (nearby features intact) in a browser; a pass needs both. https://sweeperbench.com/ · https://arxiv.org/abs/2610.14096
2. **Count.** 200 tasks, one per open-source web app, across 7 domains, each from a merged user-facing bug fix (the parent commit is the buggy version). Languages vary by app (PHP, Go, TS and others in the HF viewer).
3. **Grader.** An agentic browser verifier with per-task step lists. Reliability check: on buggy and reference versions, three verifier setups come within one point of perfect and vary by at most 0.8 points; the default is GPT-5.6 Luna in Codex at $0.16 per task.
4. **Licence.** Code MIT; dataset and traces CC-BY-4.0; each app keeps its own licence (README).
5. **Contamination.** The bugs are historical fixes with public PR numbers, so each fix sits in upstream git history. The HF dataset publishes task_specified (the bug description) and the full verifier workflows. https://huggingface.co/datasets/tonychenxyz/sweeper-bench. Usable for val, not as a sealed split.
6. **Scores.** Best: Grok 4.6 in Cursor at 59%; nine of 15 agents fixed under half; when told the bug, agents pass about 96% (README). Per model ⚠ (aggregator, labelled "target rate"): Opus 5 xHigh 57.5, GPT-6 Astra 56.5, Fable 5.1 56.5, Kimi K3 49, GLM-5.3 Max 43.5, GLM-5.3 Flash Max 39.5; no Opus 5.5 or GPT-6.1 Sol result. https://theaggregate.ai/benchmark?slug=sweeper-bench-target. Off ceiling, with an 18-point gap from Opus 5 to GLM 5.3 Flash.
7. **Docker/Harbor.** Runs on Modal VMs with a browser; no local Docker required. Native harnesses: codex, claude-code, cursor, kimi-code, deepseek-harness. No Harbor dataset found.
8. **Cost/time.** Grok 4.6 spends about 12 min per task and Qwen 3.8 Flash 102 min; a bigger time budget helps up to about 40 min, then flattens. Agent dollar costs appear only in the leaderboard figure.
9. **Fit.** The closest public match to /qa: use the app, notice the bug, fix it, keep the rest working. The stage analysis says discovery, not repair, is the bottleneck, which is the part /qa claims to add.

### 2.2 SWE-bench Multimodal v2

480 tasks (v2, 2026-09-01; the original had 517) of JS/TS issues with screenshots from 11 repos, graded by repo tests; Docker environments rebuilt for browser drift. https://www.swebench.com/multimodal.html. Vals (mini-swe-agent, no internet, one run each): Opus 5.5 70.21% ($3.63, 18m32s), DeepSeek V4.1 Flash 46.46% ($0.23), GPT-6.1 Sol 43.54%, GPT-6 Astra 43.33%, MiMo V2.6 Pro 41.25%, Step 5 Preview 40.83%, MiniMax-M3 33.33%. With network access, agents fetched the upstream fix using the PR number in the instance id; closing that channel cost 21 to 35 points. https://www.vals.ai/benchmarks/swebench-multimodal. Code MIT (SWE-bench repo); the HF card has no licence field. Harbor: the swe-bench org lists only Verified and SWE-smith, so not found. **Fit:** weak for /qa (the bug is already reported and unit tests grade it); fair for /investigate on visual bugs.

### 2.3 SWE-Lancer Diamond (IC)

198 offline-verified IC tasks (of 237) in the Expensify app, graded by end-to-end Playwright tests; per-task images are about 14 GB and the internet is disabled via iptables. https://raw.githubusercontent.com/openai/frontier-evals/main/project/swelancer/README.md. Harbor: openai/swe-lancer-diamond-ic (198), -manager (265), -all (463). https://hub.harborframework.com/datasets/openai. Code MIT; Expensify App MIT. Contamination is high (public 2023-24 issues). No current-generation scores on the official board; aggregators list GPT-5 at 100% self-reported ⚠, which I treat as unreliable. **Fit:** Playwright-graded app fixes; issues are pre-reported, so it tests fixing more than finding.

### 2.4 Test-only sets (find bugs, no fix)

- **WebTestBench**: checklist generation plus defect detection on vibe-coded apps in 7 categories; the baseline runs Claude Code with Playwright MCP; Apache-2.0. https://arxiv.org/abs/2603.25226 · https://github.com/friedrichor/WebTestBench
- **CATTest**: 102 AI-generated web apps with human-annotated bugs; agents write Playwright code; "all evaluated models perform poorly"; EMNLP 2026; the HF card has no licence field. https://arxiv.org/abs/2609.00081
- **WebTestPilot**: bug-injected web apps; its own agent reports 96% precision and recall, so near ceiling for that agent ⚠. https://arxiv.org/abs/2602.11724

These isolate the detection half of /qa with seeded bugs and known answers, which is the right shape for a gstack-authored sealed split.

### 2.5 Build-from-spec web sets (graded in a browser)

- **Vibe Code Bench v1.1** (Vals): 100 specs (50 public, 50 held-out test), graded by a browser agent. Near ceiling: Sonnet 5.5 92.39%, Opus 5.5 90.29% ($57.92, 1h36m), DeepSeek V4.1 Flash 1017 87.73% ($0.58), MiMo V2.6 Flash 78.96%, GLM 5.3 78.13%, MiniMax-M3.1-Flash 73.94%, Step 5 Preview 70.40%. https://www.vals.ai/benchmarks/vibe-code
- **Vibe Code Bench 1-100**: extend a working app through up to 10 dependent PM-style requests; the first broken iteration ends the run. Off ceiling: Opus 5.5 30.36% ($44.12, 2h28m), GLM 5.3 19.99% ($8.24), DeepSeek V4.1 Flash 16.38% ($0.69), GLM 5.3 Flash 16.03% ($0.46), MiniMax-M3 9.22%. https://www.vals.ai/benchmarks/vcb-1-100. Data availability not checked.
- **WebGen-Bench** (101 instructions, MIT, Harbor adapter webgen_bench), **FullStack-Bench** (101 instructions; 647 frontend, 604 backend and 389 DB tests; Apache-2.0), **Web-Bench** (50 projects x 20 sequential tasks; data CC-BY-4.0), **ViBench** (Replit PRDs from production traces, 15 apps, Apache-2.0), **ArtifactsBench** (MLLM judge; **CC-BY-NC-4.0**, non-commercial). Licences from the HF and GitHub APIs; adapter list from https://api.github.com/repos/harbor-framework/harbor/contents/adapters.

**Fit:** VCB 1-100 exercises /autoplan plus /qa across iterations; the others mostly test generation, with /qa as an optional self-test step.

## 3. Debugging and root cause (/investigate)

- **Replay Web Debug Bench** (2026-04-07): the input is a repo, a Playwright failure message and an optional time-travel recording; the output is the root-cause location plus an explanation. Graded by a location check and two LLM judges (opus-4.6, gpt-5.4) that agree about 80% of the time. 432 synthetic problems from agent-built apps; 255 easy ones dropped, 177 scored. Claude Code opus-4.6 + Replay MCP 76%, Codex gpt-5.4 68%, Claude Code opus-4.6 61%, Gemini 3 48%; 30-minute timeout. "Free to use however you want," but I found no licence file or public repo. Vendor ⚠. https://www.replay.io/blog/web-debug-bench. **Fit:** a direct /investigate task (diagnose, not just patch), and the generator makes fresh sealed instances possible.
- **Senior SWE-Bench "Investigate" tasks**: bugs that need runtime investigation, several at 0% solve rate (see 4.1).
- **SWE-Atlas Codebase QnA** (Scale): 124 tasks including a root-cause-analysis category; rubric graded; top about 30% at the strictest threshold; Harbor scale-ai/swe-atlas-qna; repo Apache-2.0; source repos picked for copyleft licences to resist contamination. https://labs.scale.com/leaderboard/sweatlas-qna
- **FaultLoc** (ICML 2026 workshop): 900 vulnerabilities with PoCs and fixes; localize from report plus PoC; frontier agents reach about 40% overlap with ground-truth lines. Data release not verified. https://icml.cc/virtual/2026/67968
- **KernelPath** (EMNLP 2026): 200 Linux 5.10 function-level instances with state propagation paths; it grades the diagnostic path, not only the endpoint. https://aclanthology.org/2026.emnlp-main.2201/
- **CUJBench**: 87 browser-to-backend failure snapshots behind a fixed 12-tool interface; 19.7% overall, 52% ceiling; Apache-2.0. https://arxiv.org/abs/2604.23455
- **Loc-Bench V0.2 / V1**: 660 / 560 issues with function-level edit labels; Apache-2.0. https://huggingface.co/datasets/czlll/Loc-Bench_V0.2/blob/main/README.md
- Lower value: **DebugBench** (4,253 LeetCode snippets with GPT-4-implanted bugs; not agentic), **laion/exp_rpt_bugsinpy-v2** (500 Harbor-format tasks with repaired LLM-written tests and no gold solution), **OpenRCA** (ops telemetry RCA, MIT, used in Anthropic's Opus 4.6 evaluation), **debug-gym** (an MIT environment with pdb, not a task set). https://huggingface.co/datasets/Rtian/DebugBench · https://huggingface.co/datasets/laion/exp_rpt_bugsinpy-v2/blob/main/README.md · https://pinjiahe.github.io/research/openrca/

**Gap:** no public set scores the written root-cause explanation against calibrated human labels on real repos. Our adaptation: revert a fix in a held-out repo, keep the failing test, and grade location deterministically plus a sealed causal-chain rubric.

## 4. Planning, feature, long-horizon and ship workflow

### 4.1 Senior SWE-Bench v2026.06 (Snorkel)

100 tasks (50 public, 50 private) from 12 repos (Gitea, PostHog, Prefect, better-auth, Teleport, Turborepo, Immich, Harbor and others): features from realistic, underspecified instructions, plus bugs that need runtime investigation. Six gates: "basic solve" passes the verifiers; "tasteful solve" also passes rubric, bloat, codebase-practice and relative-taste gates against an expert reference. All runs use mini-swe-agent: Opus 5.5 high 39.3% tasteful / 61.8% basic (76 steps); GPT-6 Astra high 36.8 / 60; DeepSeek V4.1 Flash high 22.7 / 44 (441.5K tokens); MiniMax M3 21.1 / 41.1; GLM-5.2 max 17.9 / 35.8 (no GLM 5.3 row). https://snorkel.ai/leaderboard/senior-swe-bench/. Harbor: snorkel-ai/senior-swe-bench-v2026.06 (50 tasks). The default judge and validation models are claude-sonnet-4-6 and haiku-4-5, which must be overridden under the crew's no-Sonnet rule. https://github.com/snorkel-ai/senior-swe-bench-v2026.06. No licence detected by the GitHub API. **Fit:** the best public cell for plan skills, review-style taste and /investigate together; off ceiling, with a 17-point tasteful gap from Opus 5.5 to DeepSeek V4.1 Flash.

### 4.2 FrontierCode (Cognition; private)

Maintainer-authored tasks (40+ hours each) graded on mergeability: hidden tests, scope and diff-size limits, and rubric review; a blocking failure scores 0, and runs that consult the original PR are zeroed. v2.0 (2026-10-27) has 132 tasks; v1.1 has 150 (Main 100). https://cognition.com/frontiercode. Artificial Analysis on v1.1 Main (Stirrup harness, 250 turns, GPT-6 Luna judge): Opus 5.5 max 52% score / 58% pass ($10.15 per task), GPT-6.1 Sol max 49% ($0.81), MiMo-V2.6-Pro 45% ($0.18), DeepSeek V4.1 Flash max 44%. https://artificialanalysis.ai/articles/frontiercode. **Not usable as tasks.** Its rubric design (scope discipline, test quality) is the model for grading /ship and plan-review outcomes.

### 4.3 Long-horizon and feature sets

- **SWE-Marathon v1.1**: 20 multi-hour tasks (a C compiler, Kubernetes in Rust, Slack/S3/Stripe clones with a computer-use browser rubric), k=8, binary reward, mean 97M tokens per trial. Opus 5.5 max (Claude Code) 46.3%, GPT-6 Astra max (Codex) 42.5%, GLM 5.3 max 42.5% and GLM 5.3 Flash 38.8% (both run by Z.ai ⚠). Harbor abundant/swe-marathon; Apache-2.0. https://www.swe-marathon.org/. Too expensive for many-trial lift estimates.
- **FeatBench**: natural-language-only feature requests drawn from releases, F2P and P2P tests; HF tasks dated 2023-08 to 2025-08; MIT; Harbor adapter featbench; best 29.94% in the paper (older models). https://raw.githubusercontent.com/PGCodeLLM/FeatBench/main/README.md
- **SWE-Dev** (14,000 train / 500 test feature tasks with unit tests; no licence detected), **NL2Repo-Bench** (requirements doc to installable Python library; strongest agents under 40% average test pass; no licence detected), **SWE-EVO** (MIT), **EvoCode-Bench** (26 stateful tasks, 227 rounds). https://arxiv.org/abs/2505.16975 · https://arxiv.org/abs/2512.12730 · https://www.unipat.ai/benchmarks/EvoCode-Bench
- **SWE-Atlas Test Writing (90) and Refactoring (70)**: Harbor datasets, Apache-2.0; tests are graded on whether they catch broken code; Scale updated Test Writing after Fable 5 and GPT-5.6 fetched upstream fixes with curl and git. https://labs.scale.com/leaderboard/sweatlas-tw

### 4.4 Ship workflow: CI repair and PR text

- **CI-Repair-Bench**: 567 real GitHub Actions failures from 103 repos in 12 error types, graded by re-running the original CI workflow; best LLM 18.9%; no licence detected. https://arxiv.org/abs/2604.27148. **CI-Bench** (ICSE 2026) builds on BugSwarm. https://dl.acm.org/doi/full/10.1145/3774748.3787606
- **PR descriptions**: only research datasets graded by LLM preference (generated text beats developer text in 80-94% of PRs). https://conf.researchr.org/details/icsme-2026/icsme-2026-papers/16/Diff-Grounded-Pull-Request-Description-Generation-with-Structured-Evidence
- **Plan or design-doc grading**: nothing public with human-validated labels. ship-bench (Apache-2.0, 1 star) has rubric specs for planner deliverables; priorityjudge reports its own calibration ⚠. https://github.com/JAgostoni/ship-bench

## 5. Where gstack-evals must author tasks

1. **Every sealed held-out split.** Martian, ReviewBench, Qodo, SWEeper-Bench, the Senior SWE public tasks and SWE-Atlas all publish answer keys or hidden tests. Build sealed splits from fresh repos with Qodo/Cheddar-style seeded defects (known locations, deterministic recall) and committed digests.
2. **/office-hours, /plan-ceo-review, /plan-eng-review, /autoplan.** No benchmark grades a plan. Grade plans by downstream outcome (Senior SWE tasteful solve, VCB 1-100 iterations survived, FeatBench F2P) plus a sealed planted-flaw check: seed specs with known traps and score whether the review catches them.
3. **/ship.** No public PR-landing or CI-babysitting benchmark exists. CI-Repair-Bench covers one slice; seeded flaky CI, review-bot comments and merge gates must be authored.
4. **/qa sealed split.** Seed UI bugs into fresh or synthetic apps (CATTest and WebTestPilot style) and score detection separately from repair.
5. **Judge hygiene.** Martian's 9-point judge swing and ReviewBench's model-built golden set mean gstack-evals must pin and calibrate its own non-Sonnet judge on human labels before any /review or /investigate claim.

**Decision-relevant numbers.** Review is a weak cell for parity claims because cheap models are already close (MacroscopeBench GLM 5.3 77.4 vs GPT-6 Astra 78.0 ⚠; Qodo GLM 5.3 52.1% vs Opus 5.5 56.8% ⚠). DeepSeek V4.1 Flash leads recall but trails on precision, so a /review lift for cheap models would show up as precision. QA and long-horizon cells have room: SWEeper (Opus 5 57.5 vs GLM 5.3 Flash 39.5 ⚠), Senior SWE tasteful (39.3 vs 22.7), VCB 1-100 (30.4 vs 16.0). Ceiling flags: Vibe Code Bench v1.1 (90%+ for frontier), Kodus CodeReviewBench (87%), WebTestPilot (96%), SWE-Lancer (aggregator 100% ⚠).

## 6. Could not verify

- Martian golden count: the repo has 173, the HF card says 136. Issue #69's body (page timed out; only the title from the issues list).
- Any Martian offline or ReviewBench result for Opus 5.5, GPT-6.x, GLM 5.3 (Flash), MiMo V2.6 Flash, MiniMax M3.1 Flash or Step 5 Preview: not found in the repo dashboard JSON, the ReviewBench README, or the aggregator.
- Sam Fold's scoring profile and judge for his F1; not reproduced.
- SWEeper-Bench per-agent pass and cost numbers from the primary site: the table and SVG did not render as text, so per-model figures come from an aggregator labelled "target rate."
- Harbor Hub entries for SWEeper-Bench and SWE-bench Multimodal: Hub dataset pages render a placeholder even for nonexistent names, so I relied on org listings (swe-bench, openai) and the adapter list, which show neither.
- Data releases and licences for CRBugBench, FaultLoc, CR-Bench and Vibe Code Bench 1-100 (CRBugBench CC-BY-4.0 only per an aggregator).
- Licences for c-CRAB, Senior SWE-Bench, NL2Repo, SWE-Dev, CI-Repair-Bench, the FullStack-Bench repo and Replay Web Debug Bench: no licence file detected or no repo found.
- PR date ranges for ReviewBench and the Martian online split against model training cutoffs.
- Current SWE-Lancer scores for Opus 5.5 and GPT-6.x from a primary source.
- Per-attempt dollar cost for ReviewBench, Martian, SWEeper agents (only the verifier's $0.16) and SWE-Atlas.

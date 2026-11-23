---
id: 2026-11-02-geva-128-run-t-text-tax-results
kind: finding
title: "Told placebo skill text cost particle-1 no TB2 passes we could detect: -2.2 points [-7.0, +2.7] on a 77.8% control (MDD 9.1); this run's interval excludes #109's -10"
summary: "particle-1, 37 TB2 tasks x 5: told placebo text minus no gstack -2.2 pp [-7.0, +2.7], control 77.8%, MDD 9.1. This run's interval excludes #109's -10. T2: no claim. R48 KEEP."
author: GEVA-128
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: superseded
links:
  - 2026-11-01-geva-106-text-tax-prereg
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - 2026-10-30-gsta-30-laneb-quick-3-results
attachments:
  - 883616828e0a8b118e8472283679f4b47e8dfcb5f61999055e99a9b98ab697f0  analysis-configs.txt
  - 15dec24ebbf35e74c804eda668e738bca5945b798ae214ecf952295b980842a1  analysis-primary.txt
  - e14cf20ba5a3b5216aa4119217da5fb758827f476d4c33c3516010cc117e2ad0  analysis-recovered.txt
  - 114743388c54b62aa5713a7e462d168fe0fb2647d3fc7722f0420849c566f64a  chart.png
  - 6bff6dce00fd20ee2ab2df93ea10f242d96f11fd2d6a0c82c388e030e0db9429  chart.py.txt
  - b2934c751e1c2f44fc96de80705d37a2212499cb17bba3dceadfc2f886b7fe00  cost-output.txt
  - 52e136ed423a54e1d932590bbe3c97a5f21d3b91c2c07712063adb37230a944c  phase-scripts.txt
  - 5e6f5b42f53ba80c42f4f1c266cec3f4c2554c7aad2aeb8e783a46b06c4c6e7b  recovered-sessions.jsonl
  - 3698a9ce53542ddf2c1c10798188eac626155e3b724a2cf943804dfd19b0ea12  run-log.txt
---

# Told placebo skill text cost particle-1 no TB2 passes we could detect: -2.2 points (95% CI -7.0 to +2.7) on a 77.8% control, MDD 9.1

Publication status: unpublished; posting is Garry's. Done: the preregistered run, the primary analysis, the lost-settle sensitivity and the /ship review recorded in the PR. Still blocking a post: the cross-family claim check against the data, a rerun of the reanalysis by another Captain's crew from a clean machine, and a public home for the data bundle.

| Field | Value |
|---|---|
| Grade | Confirmatory, as preregistered. The verdict rests on one model, particle-1. One task set, one run. |
| Repo commit | Runner tag `laneb-texttax-2-runner`, 6d0e960feeb9e8430dfef9ca1702223e96a86609 |
| Prereg | [2026-11-01-geva-106-text-tax-prereg](../../plans/2026-11-01-geva-106-text-tax-prereg/README.md), merged in #118 at main 0ffe8d0c231e3136d3c8cfade39bd75a30f4eb14 |
| Data | geva128-runt-data.tar.gz, sha256 83b647fdad8e884c4abcc07d6af314f9bcb61c90bf744c214c13d137c75267c3, held by the gstack-evals Captain (handoffs/GEVA-128); not yet public |
| Reviewed by | /ship review of this file, recorded in the PR's receipt. The cross-family claim check is pending. |
| Reproduced by | Pending: another Captain's crew, from a clean machine |
| Disclosures | The Particle and gstack lines, in Disclosures at the end |

## What we found

Telling particle-1 to use a skill whose body is 6,777 tokens of on-topic prose with no procedure changed its Terminal-Bench 2 pass rate by -2.2 points (95% CI -7.0 to +2.7) against no gstack at all. This run's interval excludes #109's -10, but not a tax of up to about 7 points. With no gstack, particle-1 passed 77.8% of trials; the test could detect 9.1 points (the prereg's simulated MDD at 5 replicates with the tasks fixed, as Run T ran them; the prereg's scaling gives 8.8, which it calls a lower bound).

Shortening the told body to 846 tokens gave no difference we could claim: placebo minus placebo-short was -5.9 points [-11.9, +0.0] on particle-1, so the longer text did worse at the point estimate, but the family-adjusted p is 0.272. Haiku 5.5 ran the same grid; under org rule R54 it is no longer a model under test, so its rows are reported as frozen and carry no verdict.

## How it works

An explanation, not a result. A told skill puts its whole body into every later request of the session. On particle-1 the told placebo made each request larger (the proxy's estimate of the median first request: 105,464 tokens against 57,905 with no gstack) and cost more per trial, and it hit the session cap more often (13 stops against 7). Part of the extra stops come from the rig: the session cap binds on metered prices above particle-1's list prices, and the OpenRouter route counts a token per byte, so stops come earlier than real spend would put them, which pushes toward finding a tax. None of that moved the pass rate by an amount we could see. #109's 10-point gap and quick look 3's +6 now look like run-to-run spread around a small or zero effect, or something that changed at particle-1's provider between runs.

## Setup

- **Question.** Does told skill text cost cheap models passes, and does the cost grow with the text's length? Preregistered in #118 (wiki/plans/2026-11-01-geva-106-text-tax-prereg, main 0ffe8d0); this post follows its sections 6 to 8.
- **Arms.** none: an empty `.claude/skills/`, no gstack, plain prompt (tar sha256 8bab4833...). placebo-short: #109's placebo tree with the /investigate body regenerated at 846 tokens, prompt opens with `/investigate` (bb25d3dc...). placebo: #109's told placebo, every gstack v1.91.295.0 skill folder with its body replaced by on-topic, procedure-free prose of the same token count, /investigate at 6,777 tokens, prompt opens with `/investigate` (ff6b909d...).
- **Models and routes.** particle-1 (`particle-ai/particle-1`) on OpenRouter, provider particle-ai only, no fallbacks. Claude Haiku 5.5 (`claude-haiku-5-5`) on Anthropic's API. DeepSeek V4.1 Flash 1017 was preregistered and dropped before its batch (deviation 1).
- **Harness.** Claude Code 2.1.312 driven by claude-agent-sdk 0.2.174 under Harbor f3a5a923, with `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, the same prompt wrapper in every arm, and the SDK-default system prompt: the 136-character stub, never Claude Code's own system prompt. So this describes Claude Code driven that way, as #109 was. Output cap 32,000 tokens a request.
- **Tasks.** 37 TB2 tasks at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c: quick look 3's 40 (`quick/laneb/tasks/final.json`, sha256 9ccfec13...) less crack-7z-hash, adaptive-rejection-sampler and largest-eigenval. TB2 is a public repository; the run did not record its licence. The oracle passed every task on both batch VMs, so no task was dropped.
- **Trials.** 3 arms x 37 tasks x 5 replicates per model, as Harbor attempts: 555 per model, 1,110 graded. Pairing unit: the task. Each batch ran on its own Ubicloud standard-30 VM at 12 concurrent trials.
- **Statistics.** 95% percentile intervals from a task-clustered bootstrap (10,000 resamples, seed 20261101). Two-sided Monte Carlo sign-flip p values (100,000 draws, seed 20261101). No judges: the TB2 verifier grades every trial.
- **Dates.** Route check 2026-11-01 21:33Z. Both batches launched 21:42Z; Haiku's VM was destroyed 2026-11-02 01:20Z and particle-1's 02:12Z.
- **Runner.** Tag `laneb-texttax-2-runner` (6d0e960): #109's runner plus the changes the prereg lists. The batch controller was GEVA-93's batch.sh, which ran #109's grid, with only its owner (geva128), runner path and TTL (12 h) changed; the VM side (vm-bootstrap.sh, vm-run.sh, proxy, Harbor, agent) is the tag's, unchanged (deviation 2).

## Result

![Run T: pass rate with 95% intervals by arm, and metered dollars per trial](chart.png)

chart.py.txt draws the chart from analysis-primary.txt: `uv run --no-project --with matplotlib==3.9.2 python chart.py.txt analysis-primary.txt chart.png` gives chart.png byte for byte.

The primary readings, verbatim from the tag's `analysis/discovery-tax.ts` (analysis-primary.txt), except that the closing cost clause of each particle-1 line is in Agent notes:

```
particle-1 none: graded 185, missing 0, refused 0, retried after a response 0; eligible 100.0%; pass 77.8% [67.6%, 87.0%]; session-cap stops 7 (3.8%), agent timeouts 5; median requests 14, median first-request tokens 57905
particle-1 placebo-short: graded 185, missing 0, refused 0, retried after a response 0; body load 100.0%; pass 81.6% [71.4%, 90.3%]; session-cap stops 9 (4.9%), agent timeouts 8; median requests 16, median first-request tokens 69823
particle-1 placebo: graded 185, missing 0, refused 0, retried after a response 0; body load 100.0%; pass 75.7% [65.4%, 84.9%]; session-cap stops 13 (7.0%), agent timeouts 10; median requests 16, median first-request tokens 105464
T1 (placebo minus none): -2.2 [-7.0, +2.7] pp over 37 tasks; verdict not confirmed, smaller than the lead
T2 (placebo minus placebo-short): -5.9 [-11.9, +0.0] pp, p 0.0908, Holm 0.182; no claim
```

In these lines, "retried after a response 0" is the tag's count from the session files. The true count is 8 (4 on particle-1), because the proxy wrote no session record for a trial whose settle was lost; the retried-after-response sensitivity below adds them back.

**T1 (particle-1, placebo minus none): -2.2 points [-7.0, +2.7]. Not confirmed** (the upper end is not below 0) **and smaller than the lead** (the lower end is above -10). Body load was 100% (185 of 185) in both told cells, so no gate flag.

**T2 (placebo minus placebo-short), the verdict computation.** The runner's own Holm line above (0.182) is not the verdict input, because its holm() sizes the step-down by the models it has. Section 6 freezes the family at three models, with p = 1 for any refused, route-failed, missing or body-load-gated model. DeepSeek is missing (deviation 1), so it enters at p = 1. The raw per-model t2.p values come from analysis-primary.txt:

| Model | T2 (pp) | Raw p | Holm step | Adjusted p | Claim |
|---|---|---|---|---|---|
| particle-1 | -5.9 [-11.9, +0.0] | 0.0908 | 1st of 3: 0.0908 x 3 = 0.2724 | 0.272 | none |
| claude-haiku-5-5 | +3.8 [-2.2, +9.2] | 0.276 | 2nd: max(0.2724, 0.276 x 2 = 0.552) | 0.552 | none |
| deepseek-v4.1-flash-1017 | not run | 1 (missing) | 3rd: max(0.552, 1 x 1) | 1 | none |

No adjusted p is below 0.05, so no T2 claim is made, in either direction. The runner prints p with `toPrecision(3)`, which rounds to nearest, so each raw p can be off by at most half a unit in its third significant digit (0.00005 for 0.0908). That moves particle-1's adjusted p by at most 0.00015, far from 0.05; no rounding could produce a claim.

**Secondary readings, no claims** (analysis-primary.txt):

| Contrast (pp) | particle-1 | Haiku 5.5 (no R48 verdict) |
|---|---|---|
| placebo minus none | -2.2 [-7.0, +2.7] | -1.1 [-7.6, +4.9] |
| placebo-short minus none | +3.8 [-2.2, +9.2] | -4.9 [-11.4, +1.1] |
| placebo minus placebo-short | -5.9 [-11.9, +0.0] | +3.8 [-2.2, +9.2] |

Pooled across the two models that ran, equal weight (secondary; the prereg pooled three): placebo minus none -1.6 [-6.2, +3.0], placebo-short minus none -0.5 [-4.6, +3.2], placebo minus placebo-short -1.1 [-5.1, +2.7].

Haiku 5.5 cells: none 76.2% [65.4, 85.9], placebo-short 71.4% [59.5, 82.2], placebo 75.1% [63.2, 85.9]; body load 100% in both told cells; no session-cap stops in any arm.

**The session-cap mechanism (descriptive).** On particle-1 the told placebo hit the session cap more often: stop rate placebo minus none +3.2 points [+0.5, +6.5], placebo minus placebo-short +2.2 [-1.6, +5.9]. The complete-case contrasts, which drop trials that hit a cap and are biased by that selection, are placebo minus none -1.7 [-7.1, +3.9] and placebo minus placebo-short -5.6 [-11.9, +0.7]. On the OpenRouter route the proxy counts a request's worst-case input at one token per byte, so its refusals come earlier than the provider's own count would put them; particle-1's "first-request tokens" above are that byte count. Haiku's Anthropic route counts tokens exactly (20,560, 24,690 and 34,504 at the median first request) and had no cap stops.

**Retried-after-response sensitivity (section 7).** Eight trials were rerun by Harbor after a model response: the first attempt's session ran, the proxy's settle call to the ledger got ECONNRESET through the SSH tunnel, and Harbor reran the trial (particle-1: 3 placebo-short, 1 placebo; Haiku: 3 none, 1 placebo). The proxy never wrote those 8 session records, so the tag's reading from the session files counts 0 retried trials. analysis-recovered.txt adds the 8 sessions, rebuilt from proxy-requests.jsonl (recovered-sessions.jsonl), and scores those trials 0: particle-1 T1 becomes -2.7 [-8.1, +2.7] and particle-1 placebo minus placebo-short -5.4 [-11.9, +1.1]. Neither changes a verdict. The primary readings grade each trial on its rerun, as section 7 says.

**Prior readings, beside T1 and T2 and never pooled:** #109 particle-1 -10 [-18, -2], Haiku -5 [-13, +3]; quick look 3 particle-1 +6 [-2, +15], Haiku +0 [-7, +8], DeepSeek -2 [-9, +6]. Run T's particle-1 reading, -2.2 [-7.0, +2.7], sits between #109's and quick look 3's and excludes #109's point estimate.

## Why null? (R48)

The verdict rests on particle-1 alone. Under org rule R54 Haiku 5.5 is not a model under test, and its rows carry no R48 verdict.

- **Exposure.** The text reached the model: body load was 100% (185 of 185) in both told cells, and the proxy's estimate of the median first request grew from 57,905 tokens (none) to 69,823 (placebo-short) and 105,464 (placebo). The placebo has no procedure, so there is no procedure gate; Run T tests text, not procedure.
- **Task fit.** The question is a tax from carried text, which shows up in long agentic sessions that resend the context on every request. TB2 sessions ran a median of 14 to 16 requests on particle-1, so the tasks exercise it.
- **Power and floor or ceiling.** Control rate 77.8% [67.6, 87.0], off both floor and ceiling. MDD 9.1 points at 5 replicates (the prereg's simulation with the tasks fixed, as Run T ran them). The interval [-7.0, +2.7] excludes the lead's -10, so the test had room to see a tax of that size and did not.
- **Frontier competence.** Run T has no frontier cell. Opus 5.5 passed 81.1% of these tasks with no gstack in #109, a different run; particle-1 passed 77.8% here.
- **Verdict: KEEP.** No evidence that told skill text taxes particle-1 by the size #109 saw, so gstack does not need short variants of its skills for cheap rungs for this reason, and #109's -10 goes down as noise or a run-specific effect (prereg section 12). The one thing worth watching is particle-1's placebo minus placebo-short point estimate (-5.9, adjusted p 0.272), which is not a claim. Next step: none for text length.

## Limits and threats

- One task set: 37 public TB2 tasks, so contamination is possible, and one run. #109 and quick look 3 disagree on this contrast by 16 points, more than either interval allows; something besides sampling, such as changes at particle-1's provider, may move between runs, and one more run cannot remove that.
- Placebo text, not gstack's real skill bodies. The result is about carried text, not about any procedure.
- The SDK-default stub system prompt, not Claude Code's own prompt.
- The interval does not rule out a tax below about 7 points on particle-1.
- particle-1's metered prices are above its OpenRouter list prices, so per-trial costs are upper bounds; the session cap binds on the metered figure.
- Haiku 5.5 is reported only as preregistered; it carries no verdict under R54.
- DeepSeek, the third preregistered model, did not run, so the pooled secondary reading spans two models.
- The ledger file sat on the Capy Drive mount, where fsync returns ENOTSUP, so its writes were not durable during the run (deviation 4). It closed with no refusals, and its settled total matches the metered totals in cost-output.txt.

**Deviations from the prereg**, each recorded in run-log.txt:

1. **DeepSeek dropped.** Its first route try failed: all 11 requests returned 502 "Insufficient Balance" from OpenRouter's deepseek provider, and nothing was charged. The Captain found OpenRouter's own account at DeepSeek out of balance (is_byok false; deepseek endpoint status -5) and ruled that the second try wait for status 0. Before any second try, the Captain dropped DeepSeek under org rule R54 (Garry, 2026-11-01), through section 7's drop path: p = 1 in T2's family. Our one endpoint reading, at 2026-11-01T23:03:45Z, showed the deepseek provider back at status 0 (100% uptime over 30 minutes).
2. **Batch controller.** GEVA-93's batch.sh instead of the tag's launch.sh, on the Captain's word (A1): particle-1's batch outlasts ubi-runner's default 4-hour TTL, and batch.sh runs vm-run.sh detached on the VM so a lost controller can re-attach. Diff from GEVA-93's copy: owner geva128, runner path, TTL 12 h.
3. **Route check, first try.** It stalled before any session opened: Harbor's `docker exec -i` read the shell's terminal and got SIGTTIN. Nothing was spent. The second try ran the same route.sh under setsid with stdin from /dev/null.
4. **Start rule.** `start-rule.ts check --note` wrote passing note rows and then crashed on fsync (ENOTSUP on the Capy Drive mount that holds the ledger; start-rule.ts:94 does not catch it, ledger.ts does). The verdict came from the note rows: both bounds were under the cap.
5. **Ledger-refusal stop.** The Captain added a rule mid-run: a ledger refusal stops its batch with no retries, and refused sessions count as not run. refusal-stop.sh watched each batch. Refusals: 0.
6. **Lost settles.** The 8 ECONNRESET settles were settled by hand on the Captain's word, through the tag's Ledger.settle at their request-log costs.
7. **Disclosure placement.** The prereg prints the YC line beside every particle-1 result; Garry's later rule (2026-11-01) puts disclosures in a closing section, which this post follows.

## Replicate it

1. **Reanalysis (keyless).** Check out tag `laneb-texttax-2-runner` (6d0e960), `bun install`, fetch the data bundle (Captain drive handoffs/GEVA-128, not yet public), check SHA256SUMS, extract it, point the job and session paths in analysis-configs.txt at the extracted tree, and run `bun quick/laneb/analysis/discovery-tax.ts <config>`. Expected output: analysis-primary.txt and analysis-recovered.txt byte for byte.
2. **Rerun a cell (paid).** There is no direct-key path yet: a rerun needs the ledger service, the metering proxy and a Ubicloud VM, driven by the phase scripts in phase-scripts.txt. Expect run-to-run spread: the three readings so far span 16 points.

phase-scripts.txt holds the operator scripts that ran, and run-log.txt the lines they printed, with operator paths shown as `<work>`, `<captain-drive>` and `<ubicloud-skill>`. The record leaves out the VM-side Harbor and trial logs and the ledger rows themselves, which are in the data bundle, and the machine setup that Capy's project image provides (Docker, Bun, uv). It also leaves out two steps: the second redaction pass, which run-log.txt's summary describes but phase-scripts.txt does not hold, and the scan of the bundle against the live key values. The rerun of that scan is in the next section.

Before reusing batch.sh, fix two things. Its own ssh calls (the ledger tunnel and the run commands) turn off host-key checking (`StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`). And it deletes the key file it copies to the VM (`~/.laneb-keys`) only after the run ends, so a controller that stops early leaves the keys on the VM until the VM is destroyed or its 12-hour TTL ends.

## What is held out, and why

Nothing. TB2 is public, and every task digest is pinned in `quick/laneb/tasks/tasks.json` at the tag. The data bundle is not public yet: TB2's sanitize-git-repo and openssl-selfsigned-cert tasks write secret-shaped fixtures, which the bundle shows as `<redacted-fixture-secret>` or `<redacted-fixture-private-key>`; GEVA-128's scan against the live key values, which the record does not hold, found no match. GEVA-155 reran that scan on 2026-11-02 on the bundle with sha256 83b647fdad8e884c4abcc07d6af314f9bcb61c90bf744c214c13d137c75267c3, the hash that part-00 and SHA256SUMS on the Captain drive both give; no other bundle file is there. It extracted part-00 into /dev/shm and ran, for each of ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY and UBICLOUD_API_KEY, `printenv <name> | grep -rlF -f - <dir> | wc -l`, then `grep -rlE 'BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY' <dir> | wc -l`. Every count was 0, over 13,057 files (`find <dir> -type f | wc -l`).

## X hook (draft)

> Does extra skill text tax a cheap model? Last round particle-1 lost 10 points on Terminal-Bench 2 when told to use a placebo skill. We reran it as a preregistered test: 37 tasks, 5 replicates. Placebo minus no skills: -2.2 points [-7.0, +2.7] on a 77.8% control. No tax we could detect; this run's interval excludes #109's -10. (link to this file at a pinned commit)

## Claim check

| Check | Status | Evidence |
|---|---|---|
| The headline is true at both ends of its interval | Pass (author check) | At +2.7 there is no tax. At -7.0 a 7-point tax is still possible, which "no passes we could detect" allows and which still excludes #109's -10. The heading gives the control rate (77.8%) and the MDD (9.1). |
| The grade is named | Pass (author check) | Record table: confirmatory, one model. The heading names particle-1. |
| No claim the scorer forbade | Pass (author check) | T2 makes no claim under the frozen Holm family; there is no parity or non-inferiority claim; Haiku carries no verdict under R54. |
| Disclosures settled before the post | Pass (author check) | The Particle and gstack lines from the org disclosures file, word for word, at the end. That file gives Anthropic and DeepSeek no line. The X hook carries none. |
| The sealed guard passes | Recorded in the PR | gstack-pregate sealed runs before every push of this branch; the /ship receipt records it. |
| Numbers match the printed outputs | Pass (author check) | Every result number here is copied from analysis-primary.txt, analysis-recovered.txt, cost-output.txt or run-log.txt, or from the source named beside it. Not yet rerun from the data bundle on a clean machine. |
| Cross-family review against the data | Pending | |
| Another Captain's crew reruns the reanalysis | Pending | |

## Changelog

- 2026-11-02: first version (GEVA-128).

<details>
<summary>Agent notes</summary>

- **Models and routes.** particle-1 (`particle-ai/particle-1`) on OpenRouter, provider particle-ai only, no fallbacks, session cap $0.50. Claude Haiku 5.5 (`claude-haiku-5-5`) on Anthropic's API, session cap $1.00. DeepSeek V4.1 Flash 1017 was preregistered and dropped before its batch (deviation 1).

**Cost**

Metered spend through the proxy, from the proxy session files and request logs (cost-output.txt):

| Cell | Trials | Metered $ | $ per trial | $ per success | Input tokens | Output tokens | Cache write | Cache read |
|---|---|---|---|---|---|---|---|---|
| particle-1 none | 185 | 15.98 | 0.086 | 0.111 | 40.3M | 3.35M | 0 | 84.8M |
| particle-1 placebo-short | 185 | 17.52 | 0.095 | 0.116 | 45.8M | 3.55M | 0 | 84.2M |
| particle-1 placebo | 185 | 21.33 | 0.115 | 0.152 | 57.9M | 3.85M | 0 | 100.1M |
| Haiku none | 185 | 1.72 | 0.009 | 0.012 | 3.2k | 1.60M | 2.78M | 49.3M |
| Haiku placebo-short | 185 | 2.02 | 0.011 | 0.015 | 3.3k | 1.85M | 3.86M | 54.6M |
| Haiku placebo | 185 | 2.32 | 0.013 | 0.017 | 3.3k | 1.80M | 5.69M | 68.1M |

Cache tokens are the provider's reported counts, each class priced on its own; OpenRouter reported no cache writes for particle-1. Add $0.13 (particle-1) and $0.04 (Haiku) for the 8 first attempts whose settles were lost, and $0.0128 for the route check. Total metered: $61.06 of the $75 cap. The texttax-r1 ledger shows $61.06 settled and $0 open, after the 8 lost settles were settled by hand at their request-log costs (deviation 6). There were no ledger refusals and no batch-cap stops. cost-output.txt's ledger line shows the ledger before those manual settles; run-log.txt's settle-bundle section shows it after.

**Price table** (the runner's `quick/laneb/config/proxy.json` at the tag, in force for the whole run on 2026-11-01 and 02, per million tokens):

| Model | Input | Output | Cache write (5 min) | Cache write (1 h) | Cache read |
|---|---|---|---|---|---|
| particle-1 | $0.25 | $1.00 | $0.25 | $0.25 | $0.03 |
| claude-haiku-5-5 | $0.10 | $0.50 | $0.125 | $0.20 | $0.01 |

The table also holds a long-prompt tier for Haiku above 100,000 tokens ($0.50 in, $2.50 out). OpenRouter listed particle-1 (provider Particle AI) at $0.05 in, $0.50 out and $0.003 cache read when we read it on 2026-11-02 at 02:24Z, so particle-1's metered spend is an upper bound on what it cost.

**VM time.** Two Ubicloud standard-30 VMs: particle-1 4 h 30 min (21:42Z to 02:12Z), Haiku 3 h 38 min (21:42Z to 01:20Z), 8 h 08 min in all. Both are destroyed, and ubi-runner's list and records are empty for owner geva128.

It closed with no refusals, and its settled total, $61.064212, matches the metered totals in cost-output.txt.

The verdict came from the note rows: particle-1 bound $61.65, Haiku $70.46 with particle-1 listed, both under $75.

**Lost settles.** The 8 ECONNRESET settles left $6.00 reserved and open; on the Captain's word they were settled by hand through the tag's Ledger.settle at their request-log costs ($0.17).

One particle-1 replicate of all three arms is about $11 metered.

From the summary: $61.06 of $75.

and cost more ($0.115 a trial against $0.086)

particle-1 none: graded 185, missing 0, refused 0, retried after a response 0; eligible 100.0%; pass 77.8% [67.6%, 87.0%]; session-cap stops 7 (3.8%), agent timeouts 5; median requests 14, median first-request tokens 57905; cost per trial $0.086, per success $0.111

particle-1 placebo-short: graded 185, missing 0, refused 0, retried after a response 0; body load 100.0%; pass 81.6% [71.4%, 90.3%]; session-cap stops 9 (4.9%), agent timeouts 8; median requests 16, median first-request tokens 69823; cost per trial $0.095, per success $0.116

particle-1 placebo: graded 185, missing 0, refused 0, retried after a response 0; body load 100.0%; pass 75.7% [65.4%, 84.9%]; session-cap stops 13 (7.0%), agent timeouts 10; median requests 16, median first-request tokens 105464; cost per trial $0.115, per success $0.152

all 11 requests returned 502 "Insufficient Balance" from OpenRouter's deepseek provider, $0 spent.

</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

gstack is Garry Tan's own project.

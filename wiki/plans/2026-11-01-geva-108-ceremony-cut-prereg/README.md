---
id: 2026-11-01-geva-108-ceremony-cut-prereg
kind: plan
title: "Ceremony-cut preregistration: gstack 142757b full render against its unattended render and no gstack, on stacks-r1 review and TB2"
summary: "Freezes the before/after eval of gstack's ceremony cut (I1): arms, pins, margins, MDDs, gates, verdict rule, items and a dry run, before any paid call."
author: GEVA-108
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-01
status: superseded
links:
  - 2026-10-31-geva-78-stacks-round-1-prereg-v2
  - 2026-11-01-geva-89-stacks-round-1-review-results
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - GST-824
attachments:
  - 3386a06e688653d83f15209a75ebde0872d552610c102a8ee564f7dd8c21bc2f  admission.txt
  - eef5d1071e648db26ee768dcf231f09903ea5a82e64deeae911caed4f3473683  admit1.py.txt
  - bcc382bc4e04cf4f419dae40d59dda3c0f0ddf66e52957529eef1a554f236d55  admit2.py.txt
  - c4f7a497e4d89a5261a63d1fe0e8d661dc98853856dd93d800ddea720d953a11  caps.py.txt
  - b6b53a098b84182ceecdd530ee8daee60af27aafef9d51d304190a6eda8fcad8  ceremony-tb2.ts.txt
  - c4ad189204ee2bec4ad40db4b22073c57c0234c0033142a088c721ca00374d10  comparisons.ceremony-r1-secondary.json
  - d5dfdf48fadac37286c494e7a414187ec9f9a476100e26c1889f11eae1ef71b2  comparisons.ceremony-r1.json
  - 000cfad35b9aab5502802c3027e4fa7d1b0eed423b1beb2499a5f62c50cc95a2  decide.py.txt
  - 39f269da8d6a2c8921bc0e508d508e2a05b523f706e4504d03279cd690609aaf  dry-run.sh.txt
  - 694a0be8ce09fb609ee9bdba3d74181fcd64e97c0e1777a2b127a40169d18e2e  dry-run.txt
  - 33c8a3548789a10e949143287e42d698130b4af3ad310e9a1518f27887672212  exposure.py.txt
  - fabfcc9e802d0b790cf1e329f731874b7b2b222e08472d1316e2cf1e803a6311  peak.py.txt
  - 1cd81c87d3e9f7f8da3c7b772b42f26eaad3eaf78f86417a8b09a3c9f7ee7c2c  projection.py.txt
  - 7ec737bd085bb6b6ba23ebf8d5a3f1f990d679252b3fb7e8339472d1195ffd0e  renders.txt
  - 704f65b8e4cd36aa345dc534a538f9f0770a6dab289e3ea3087d7c53ab5f35e8  review-cost.py.txt
---

# Ceremony-cut preregistration

GEVA-100 counted which parts of gstack's /review and /investigate Opus 5.5 ran in stacks round 1. The operational ceremony (shared preamble, question tuning, repo ownership, search before building, telemetry, learnings, Aside research, /review's queue status) ran in 0 of 66 review sessions and 6 of 111 TB2 trials, while every request carried its text. Garry took I1 on 2026-11-01: take that ceremony out of the always-loaded skill body in one-shot unattended sessions. GStack Minder built the change as an unattended render (GST-825). The version under test is garrytan/gstack@142757b (gstack PR #3818), which supersedes the first build at 10d41ed. This post freezes the eval that decides whether it ships.

Nothing here is paid until this post merges and the Captain records the caps.

## 1. The question and the verdict words

Does the unattended render lose quality against the full render from the same commit, and what does it save? The verdict names what happens to the ceremony text in unattended renders:

- **CUT**: take it out. The variant shows no loss on the primary reading (section 6), and no LOSS test fires anywhere.
- **KEEP**: keep it. A LOSS test fires after Holm's adjustment: the cut costs quality.
- **FIX-METHOD**: this eval can't tell. A gate failed, or neither NO_LOSS nor LOSS holds.

The verdict comes with no-loss yes or no and the cost saving with its interval. One verdict per model: Opus 5.5 (TB2 and review), particle-1 (TB2). GStack Minder's PR ships only on CUT with no-loss yes.

## 2. Arms, pins and settings

| Arm | What it installs | System prompt | Told |
|---|---|---|---|
| control | garrytan/gstack@142757b107edeffff7c78453490c4d2786996fa7, gstack's ./setup, then `bin/gstack-modules render --host claude --loadout full` served in place (section 2.1) | claude-code-preset | /review (review), /investigate (TB2) |
| variant | the same, with `--session-kind unattended` on the render | claude-code-preset | the same |
| none | nothing (bare) | claude-code-preset | the plain told text |
| control-sdk (review only) | the same as control | sdk-default, as #108 ran | /review |

Both gstack arms come from one commit, so the render is the only difference. The old pins of #108 (53522b1) and #109 (61e201e) can't stand in for control. #108's and #109's none arms can't be reused either: the harness pin, the system prompt and the session-kind setting all change. Every arm reruns.

**The renders.** At 142757b the control render writes 63 SKILL.md files and 140 section files, 4,024,087 bytes; the variant writes the same 203 paths, 3,746,393 bytes, with 77 files changed. The SKILL.md files hold 1,689,593 characters in control and 1,426,202 in the variant (-15.6%; Minder counted 1,688,788 and 1,425,719, the difference being the render directory's path length). The section files barely change (-0.6%). Lock spec `full` (spec_sha256 null, as gstack writes it for the interactive render) for control and `full@unattended` with spec_sha256 1ef47edd7703d536bd486655e9a718bad71c6cf4900e97daca25edae99e0ab48 for the variant, gstack_version 1.92.37.0. /review goes from 59,000 to 47,398 bytes and /investigate from 29,973 to 19,645. The control render is byte-identical to 10d41ed's apart from the render directory's path; 142757b changes only the unattended render (skill-start keeps the environment's session kind, make-pdf keeps its setup, design-consultation gets WebSearch, /review Step 3.6 is reworded). /review keeps Step 5.8's review-log record and /investigate keeps Scope Lock, on purpose. [renders.txt](renders.txt) lists every file's sha256 in both renders.

**2.1 How a render is served.** A render's section pointers name the directory it was rendered into, so a render can only be served from there. The harness (GEVA-109's #119, merged at b792646b43cb8ea170039623b420229e0d669216) runs gstack's own ./setup at 142757b, renders into `~/.claude/gstack-render` of the trial's HOME, and points each served `~/.claude/skills/<skill>/SKILL.md` and `sections` at the render. Every other file setup installs (bin/, node_modules, checklists, specialists, the gstack alias, the Stop hook) is the same in both arms. The router copies setup makes stay interactive in both arms; the router loads only when /gstack is told. The install fails unless the lock carries the requested session kind and only the variant's served start lines carry `--render unattended`. Lane B ships the same install as two tars built by the runner tag's quick/laneb/arms/build-render.sh: gstack-render.tar (control) sha256 eeab89bf220323bfb54277c38c9f418fff385da2bf185527a8a44a111d628e1e, 1,363,179,520 bytes; gstack-render-unattended.tar (variant) sha256 406d4a865eee2fcc94d2d97b112af427e5d293ab364f244c358bf6d7a534f5b1, 1,362,626,560 bytes. Their render locks are sha256 9422761588b7c251f2a7183ede45e41597d40458f4c51a2ce36aa33a82252fb6 and 7feacb7f7ec488aff7f81bad42cb493920e7b662838ef3c8429b332c1e391ea7. none is the tag's none.tar (sha256 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e). The runner refuses a tar whose sha256 differs from its manifest. Before any paid call, the tars are rebuilt from the tag and checked against these digests. Two clean builds on two machines already matched (section 11). The tag is laneb-stacks-3-runner. It supersedes laneb-stacks-2-runner, whose tars didn't rebuild byte for byte: the .git pack that build-render.sh fetches from git.capy.ai drifted between fetches. stacks-3 keeps .git in the arm, because real installs have it, but repacks it single-threaded with no object reuse and drops FETCH_HEAD. The rendered skills were byte-identical in every build.

**Settings for every arm.** GSTACK_SESSION_KIND=unattended, so control runs gstack's unattended rules at run time too, and the variant's start line prints RENDER_KIND: unattended with no RENDER_KIND_MISMATCH. Each trial has its own GSTACK_STATE_ROOT: the review rig seeds one per work dir, and each TB2 trial is its own container. CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm. Claude Code's preset system prompt in every arm but control-sdk. GEVA-109 found that every past harness, #108's and #109's included, sent the SDK's two-line stub instead. The preset adds one block of 1,926 tokens on CLI 2.1.314 (1,892 on 2.1.312), mostly read from cache after the first request, and it carries Claude Code's guidance, including "invoke /<skill-name> via Skill". The skill listing reaches the model either way. Every review invocation keeps `--max-turns` at its default of 60, as #108 ran. #119 records a session that ends at that cap as completed (its open note; GEVA-122 will give a cap end its own termination kind). This prereg doesn't wait for GEVA-122: it changes nothing about how the pinned rig scores such a session, and exposure.py counts the sessions that ended at the cap in each arm from the transcripts (result subtype error_max_turns). On #108's data that count is 0 of 66 in each Opus arm and 39 of 66 for particle-1.

**Pins.** Rig: garrytan/gstack-evals@b792646b43cb8ea170039623b420229e0d669216, the merge of GEVA-109's #119. Review: `gstack-evals review-units` at that pin, trial image recipe f0c9cf9b5e5abd6d3e9b2eaaeea9657fc6c31099500fc95563319ff1c59d389c, Claude Code 2.1.314. TB2: Lane B runner tag laneb-stacks-3-runner (annotated tag 85de1407955e8f74e539fe85cb2cef033a619528 on 8cd497367e3d7e609103540c22e01542b705604d, from laneb-stacks-1-runner through laneb-stacks-2-runner), Claude Code 2.1.312, Harbor as the tag pins it. The review trial image runs Claude Code 2.1.314. Models: claude-opus-5-5 and particle-ai/particle-1 (OpenRouter). Judges as #95 section 3: Opus 5.5, then gpt-6.1-sol, then Sonnet 5.5 on disagreement.

**Rungs.** CREW's fixed rungs are Sonnet 5.5, Haiku 5.5, DeepSeek V4.1 Flash and particle-1. This eval runs Opus 5.5 (the frontier reference, where GEVA-100 measured the ceremony) and particle-1 (the rung that followed gstack's procedure literally, where the cut may matter most). Sonnet, Haiku, DeepSeek and the open-weight slots are dropped for cost: the ceiling holds these cells and no more. OpenRouter's programming ranking was re-read through the Data API: meta.as_of 2026-11-01T18:16:35.018Z, response sha256 1487fc8240502383e67414900f58631db0ec1c3021578290fcaee7fe339d3b63, latest bucket 2026-10-26, first deepseek/deepseek-v4.1-flash-20261017 at 25.1%.

**particle-1 on review is dropped.** In #108, 39 of 66 particle-1 review sessions hit the 60-turn cap in both arms, so neither arm got a verdict. GEVA-109 adds a turn-cap parameter, but particle-1's cost and completion at a higher cap are unmeasured, and the ceiling doesn't hold a pilot for them. The brief's condition ("if the turn cap lets them finish and the cost fits") isn't met.

## 3. Suites and sizes

- **Review**: stacks-r1 (#95's [stacks-r1.json](../2026-10-31-geva-76-stacks-round-1-prereg/stacks-r1.json), sha256 4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d): 33 units, 42 blocking blockers on 26 PRs, told /review with #95's told text (TOLD_SHA256 16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad), #95's severity map, `--test garrytan/gstack=true --test garrytan/gbrain=true`. Opus 5.5. control, variant and none at 2 passes (66 unit-passes each); control-sdk at 1 pass (33), section 9.
- **TB2**: #109's 37 tasks (quick look 3's 40 less crack-7z-hash, adaptive-rejection-sampler and largest-eigenval, dropped under the in-run oracle rule), told, 3 replicates (111 trials per cell). Opus 5.5 and particle-1, each with control, variant and none.

## 4. Outcomes

**Quality**, each suite's existing scorer:

- Review: `noloss score` at the rig pin with [comparisons.ceremony-r1.json](comparisons.ceremony-r1.json): variant-vs-control alone, so its no-loss test is not split across secondaries. Blocking recall per PR cluster, exact sign-flip, LOSS at one-sided 0.05, NO_LOSS at a 10-point margin with the 80% size rule. Secondary and descriptive, in [comparisons.ceremony-r1-secondary.json](comparisons.ceremony-r1-secondary.json): control-vs-none, variant-vs-none and control-vs-control-sdk. False blockers and the judges' impact reading as #95 and #104 run them.
- TB2: [ceremony-tb2.ts](ceremony-tb2.ts.txt), run from quick/laneb/analysis at the rig pin. It reads the job folders with analyze.ts's loader, so quick look 3's outcome rules hold. Variant minus control (primary), control minus none and variant minus none, paired by task, task-clustered bootstrap, 10,000 resamples, seed 20261101. Each table is printed with no-reward trials scored 0 (primary) and dropped.

**Cost**, in dollars and tokens, per trial and per success, from the metering proxy at the rig pin's price table (src/runner/pricing/prices.ts, dollars per million tokens, read 2026-11-01):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 | 4 | 20 | 0.2 | 5 |
| particle-ai/particle-1 | 0.1 | 1 | 0.003 | none listed |

Ratios: variant over control, control over none, variant over none (and control over control-sdk on review), with a task-clustered (TB2) or PR-clustered (review, [review-cost.py](review-cost.py.txt)) bootstrap, 10,000 draws, seed 20261101. Beside them, the mechanical saving: the change in first-request prompt tokens times the cache-write price plus the cache-read price for each later request of control's mean session. It is near exact; the total ratio carries behavior.

**Exposure**, [exposure.py](exposure.py.txt), per arm: the start line run, RENDER_KIND: unattended, SESSION_KIND: unattended, each ceremony step the cut removes (preamble read, question tuning, telemetry, learnings, Aside, queue status, brain sync), the kept steps (review log, Scope Lock), the sessions that ended at the 60-turn cap, and the procedure gates GEVA-100 froze (/review: Agent dispatches, review-army and adversarial sections, the checklist; /investigate: the DEBUG REPORT block, the status line, a root-cause hypothesis). Call markers are anchored on the installed paths, because many review units are gstack's own PRs and an agent reviewing them touches the same names. Its dry run on #108 reproduces GEVA-100's counts (Opus gstack 0 of 66 helper runs, particle-1 33 of 33).

## 5. Admission (E1)

The suites sit at a floor (review) and near a ceiling (TB2 Opus). The cost difference can be measured. The quality reading can only bound a loss. Numbers from #108's and #109's data, in [admission.txt](admission.txt), which [admit1.py](admit1.py.txt) and [admit2.py](admit2.py.txt) compute:

**Review, Opus.** Control's stand-in (#108 gstack) found 9.5% of blocking blockers; none found 7.1%. The cluster-robust standard error of a difference is about 4.5 points, so the smallest loss a one-sided 0.05 test detects with 80% power is about 11 points, wider than the 10-point margin. The scorer's own size rule gave 61% to 71% on these arms. stacks-r1 is development-only, so the scorer never lets a review no-loss claim stand. The review enters the verdict only through its LOSS test, which can see a loss of about 12 points. I keep the lane's 10-point margin so the scorer runs unchanged. At a 10% base rate that margin can't rule out the variant losing most of what control finds, and the post says so.

**TB2, Opus.** Control's stand-in passed 83.8%. Under the null that the render changes nothing, the two arms are exchangeable, and the standard error of variant minus control at 3 replicates is 2.2 points; the 80%-power MDD for a one-sided 0.05 no-loss test is 5.5 points. With #109's gstack-minus-none paired error (3.3 points), which carries real task-by-arm differences, the MDD is 8.2. **Margin: 7.5 points**, the smallest round margin the planned size admits under the null. It bounds a loss at about 8 trials in 111. It's larger than gstack's own measured lift on Opus (+3 [-3, +9]), so CUT can't show the cut keeps a lift we never measured; it shows the cut costs no more than 7.5 points. The size rule is checked again from the observed rates (section 6).

**TB2, particle-1.** Control's stand-in passed 77.5%, standard error 3.8 points, MDD 9.5. **Margin: 10 points**, with the same size rule.

**Cost precision.** At 3 replicates, the 95% half-width of the TB2 Opus variant/control cost ratio is about 9% analytically; on #109's real trials with 2 replicates the dry run gave about 5%. The mechanical saving is about 10% of control's cost per Opus trial (roughly 4,700 fewer prompt tokens, written once and read about 6 more times), so the TB2 Opus interval should exclude no saving. On review the cut is about 4% of control's cost per unit-pass against a 95% half-width of about 9% at 2 passes, so the review interval won't resolve it; the mechanical saving will.

## 6. Decision rule

1. Gates (section 7) must hold for a model's cells, or that model's verdict is FIX-METHOD.
2. LOSS family: the TB2 Opus, review and TB2 particle-1 LOSS tests (variant worse than control at all), one-sided, Holm-adjusted together at 0.05. TB2's p is the share of bootstrap resamples where variant minus control is at or above zero; review's is noloss's p_loss.
3. Opus: KEEP if the TB2 Opus or review LOSS test fires. Otherwise CUT with no-loss yes if TB2 Opus gives NO_LOSS: the lower end of the 90% interval of variant minus control lies above -7.5 points, and the size rule holds (with the pooled per-task pass rates and this run's trial counts, an exactly-as-good variant reaches NO_LOSS with probability 0.8 or more). Otherwise FIX-METHOD.
4. particle-1: the same with its TB2 LOSS test and a 10-point margin.
5. The cost ratios and the mechanical saving are reported with every verdict. They don't change it.
6. If the two models disagree, the Opus verdict answers I1 for one-shot Opus sessions, and particle-1's is reported beside it as a caution for small models.

[decide.py](decide.py.txt) applies these steps to the four output files.

## 7. Gates

- **G1 install**: the harness's install check (section 2.1) passed for every gstack arm, and arm.json records each render's lock.
- **G2 body load**: in each lane and model, the variant's median first-request prompt tokens sit at least 2,000 below control's (the renders differ by about 10,700 and 12,000 bytes on the told skills).
- **G3 render kind**: among variant sessions that ran the start line, at least 95% printed RENDER_KIND: unattended, no control or control-sdk session did, and no session in any arm printed RENDER_KIND_MISMATCH. If no session ran the start line, G3 is reported as not observable and doesn't fail.
- **G4 coverage**: each primary TB2 cell has at least 90% of its planned trials graded (3 replicates of its frozen tasks, less documented oracle exclusions: 3 × 37 = 111, since this prereg documents none), and the review comparison has a verdict (no arm stopped, no coverage gap). Planned never comes from the tasks that ended up paired, so a task whose trials all fail as infrastructure in one arm, or that the in-run oracle rule drops, still counts against coverage. This brings decide.py in line with the written 90%-of-111 rule and can only make G4 stricter.

## 8. Failure handling

As frozen for stacks round 1 (#95 section 9, #104 section 2, #105): no resumes or repairs; fresh out dirs and receipts sinks per launch; a review unit-pass that didn't complete is a coverage gap, never a miss; a TB2 trial with a reward is graded on it, a no-reward trial after a model response scores 0 with the drop reading beside it, a trial no model response reached is infrastructure and is retried up to twice by the runner, agent timeouts and session caps are graded as they stand, and a verifier timeout scores 0 and is listed. The in-run oracle rule stands: a task whose oracle fails on a VM leaves the grid for every cell, with no swap. An invocation that ends early for an infrastructure reason is rerun fresh once, whole, as its own ledger item, if the spend rule still fits. A cap stop is an incomplete run and is never rerun.

## 9. Spend

Prices are section 4's table. Expected spend is about $340. The cells project to $317.05 ([projection.py](projection.py.txt) at GEVA-109's measured preset of 1,926 tokens; it takes #108's and #109's real cost per session and adjusts it for the render cut and the preset). The pilots add about $17 and the judges about $6.

**The ceiling** is $430 for everything here (Captain, 2026-11-01). It bounds settled spend, plus open reservations, plus the unspent cap of the item that is running. A closed item counts at what it settled. After the pilots, items run one at a time, because each needs room it won't spend: review-units starts a round only if its sessions fit at the full allowance, and each Lane B session reserves its whole session cap when it opens.

| Item | What | Cap |
|---|---|---|
| ceremony-r1-review-pilot | control, variant, none and control-sdk, Opus, the 2 pilot units, 1 pass, one invocation, `--parallel 1 --allowance 15` | $70 |
| ceremony-r1-tb2-pilot | the 5 pilot tasks × control, variant and none × Opus and particle-1, 1 attempt, 12 concurrent, session caps $2.50 and $0.50 | $45 |
| ceremony-r1-review-grid | control, variant and none, Opus, 33 units, 2 passes, `--parallel 3` | caps.py |
| ceremony-r1-review-sdk | control-sdk, Opus, 33 units, 1 pass, `--parallel 3` | caps.py |
| ceremony-r1-tb2 | Opus and particle-1 × control, variant and none, 37 tasks, 3 attempts, 12 concurrent per model | caps.py |
| ceremony-r1-judge-match | match judging of the four review arms | $20 |
| ceremony-r1-judge-adj | adjudication | $20 |

The review pilot's `--parallel 1` makes each round one unit with its four arms, so its second round needs 4 × $15 = $60 beside the first round's spend. #95's pilot units cost $0.42 to $1.42 a session in #108. The TB2 pilot holds 12 open sessions at $2.50 ($30) plus about $8 of trials. control-sdk runs apart from the grid because review-units applies one pass count to every arm of an invocation, and noloss can't read one arm from two runs. In the pilot all four arms share one invocation, which GEVA-109's per-arm system prompt allows.

**Pilot units and tasks.** Review: #95's pilot units, garrytan/gstack#3524@205ea0e2e82f and garrytan/gstack#3527@2684974602c1 (the median and 90th percentile of gstack's review tokens). TB2: the #109 tasks at the 10th, 30th, 50th, 70th and 90th percentiles of Opus gstack's mean cost per trial (rank round(q × 36) of 37, cheapest first): pypi-server, dna-insert, headless-terminal, pytorch-model-cli and mailman.

**What the pilots set** ([caps.py](caps.py.txt), keyless):

- **Cost ratio per arm**: the arm's mean pilot cost per session over the pilot units or tasks, divided by the matched #108 or #109 arm's mean on the same units or tasks. control, variant and control-sdk match gstack; none matches none. A cell's projection is its ratio times the matched arm's whole-grid mean per session, times its sessions.
- **Review allowance**: max($8, 1.5 × the largest peak exposure of any pilot session), in whole dollars. Peak exposure is a session's settled spend plus its open reservations at their highest, read from the proxy journal ([peak.py](peak.py.txt)). #108's largest was $6.05, so $8 would have served every #108 session. The factor of 1.5 covers a preset that makes sessions run calls side by side.
- **TB2 session caps**: Opus max($2.50, 2 × its largest pilot trial), particle-1 max($0.50, 2 × its largest pilot trial), rounded up to 10 cents, the same for every arm of a model. #109's largest trials were $1.24 and $0.40.
- **Grid caps**: 1.1 × the item's projection plus its headroom. For each review item the headroom is the last round's worst case, 3 sessions at the allowance. For TB2 it is the open reservations, 12 × (the Opus cap plus the particle-1 cap). Each judge item gets $20, about 9 times #108's match spend for five arms ($2.22), because the judge proxy reserves every request at its worst case.

**Start rule.** Before each item after the pilots, settled spend, plus open reservations, plus the launching item's cap, plus the projection of every item not yet launched, must be at most $430. The order is the review grid, control-sdk, TB2, then the judges. caps.py prints the check. With #108's and #109's own sessions standing in for the pilots, the dry run gives an allowance of $10; caps of $227.44 (review grid), $66.84 (control-sdk) and $160.75 (TB2); and a largest need of $396.73, at the TB2 launch. If the rule fails, nothing launches, and the pilot numbers go to the Captain with two options: raise the ceiling, or drop control-sdk. Before each item launches, I send its computed cap to the Captain to record.

**Accounting.** Every paid call goes through a ledger item: review-units' lease on the rig's ledger, Lane B's ledger service (one file per TB2 item, each with one approval row), and judge-run's items. Spend is reported from the proxy files and the ledgers, in dollars and tokens.

## 10. Run rules

1. **Pilots** run first, side by side. They are operational: nobody reads quality from them, and their sessions never enter the grids' data. Report per arm: cost per session and its ratio, peak exposure, the parse outcome, the install check, RENDER_KIND lines, first-request prompt tokens, and whether particle-1 reached a model response through the preset. The pilot passes if all of these hold:
   - the install check passes (G1);
   - every variant session that ran the start line printed RENDER_KIND: unattended, no control or control-sdk session did, and no session printed RENDER_KIND_MISMATCH (GEVA-109's check containers print one only because they don't set GSTACK_SESSION_KIND; real trials set it);
   - in each lane, the variant's median first request is at least 2,000 tokens below control's;
   - every review session ended in a findings or missing parse, with no harness error;
   - each TB2 cell got a model response in at least 4 of its 5 trials.
   If any fails, nothing more launches, and the failure goes to the Captain.
2. **Grids** run in the start rule's order. review-units runs at the rig pin, detached on a Ubicloud VM, with my machine attaching on a timer. TB2 follows the GEVA-89 kit: one standard-30 VM per model, oracle first, setsid controllers and a supervised ledger service, all on my own machine so my watched operations keep it awake. Each invocation and batch gets a fresh out dir.
3. **Judges** run after both review grids end, as #95 section 3 and #104 run them: seed 20261101, #95's judge brief, Opus 5.5 primary, gpt-6.1-sol second, Sonnet 5.5 third.
4. **Blind** until every grid ends: operational counts only, with no scoring, exposure counts or cost ratios.
5. **VMs** carry UBI_OWNER=GEVA-108, and each is deleted when its batch ends.

## 11. Dry run

[dry-run.sh](dry-run.sh.txt) drove every frozen rule keyless at the rig pin (b792646) and the runner tag (85de140), with #108's and #109's data standing in for this run's. [dry-run.txt](dry-run.txt) is its output, with machine paths shortened. It:

- ran `review-units --dry-run` for the three review invocations with the frozen flags. The rig printed #95's told template (sha256 16862a34…), claude-code-preset on control, variant and none, sdk-default on control-sdk, the interactive and unattended renders, session kind unattended and 60 turns. It refused a render on the none arm and an unknown system-prompt value;
- opened and settled one lease on each of the five rig items on a temporary ledger, and saw a second run refused on a bound item (E_ITEM_BOUND);
- approved, reserved and settled under each TB2 ledger file, and saw a reserve past the cap refused;
- built none.tar (8bab4833…, as its manifest says) and wrote the TB2 job configs: every arm carries claude-code-preset and unattended, with Opus at a $2.50 session cap and particle-1 at $0.50;
- rebuilt both rendered tars from laneb-stacks-3-runner and matched the digests in section 2.1. A second clean build on another machine, from a fresh clone, matched all four files and the manifests;
- ran noloss score with both comparisons files, then ceremony-tb2.ts, exposure.py, review-cost.py, caps.py and decide.py, end to end. review-cost.py read all four roles, control-sdk from its own out dir, and printed the control over control-sdk ratio. particle-1's gstack run stands in for control-sdk, as in the scoring step; its transcripts record no usage, so its first-request reading is 0. decide.py printed FIX-METHOD for both models, as it should: the stand-in TB2 data has 2 replicates, so G4 fails at 74 and 75 graded of 111 planned;
- gave decide.py the stand-in with 111 graded trials in every TB2 cell, where Opus read CUT, then the same with four tasks dropped from Opus's variant (99 graded, 33 paired tasks), where G4 failed at 99 of 111 and Opus read FIX-METHOD. Had planned followed the paired tasks, it would have been 99, and G4 would have passed.

## 12. What this can't say

- A review no-loss claim: stacks-r1 is development-only and at a floor.
- That the cut keeps gstack's lift: Opus shows none to keep on these suites.
- Anything about interactive sessions, /ship, or skills other than /review and /investigate in sessions that open them.
- Anything about models other than Opus 5.5 and particle-1.

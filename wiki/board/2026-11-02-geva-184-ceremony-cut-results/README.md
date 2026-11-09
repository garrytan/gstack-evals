---
id: 2026-11-02-geva-184-ceremony-cut-results
kind: finding
title: "The ceremony cut gets no verdict on Opus 5.5 (a coverage gate failed), and its TB2 cell shows a loss of 5.4 points (95% CI -10.8 to -0.9); on particle-1 it shows no loss at 0.70 times the cost"
summary: "I1, gstack 142757b. Opus 5.5: FIX-METHOD (G4 failed on review), TB2 -5.4 points, Holm p 0.042 (LOSS), cost 0.910x. particle-1: CUT, no-loss yes, cost 0.703x. R48: FIX-METHOD."
author: GEVA-184
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-02
status: done
source: "Captain drive handoffs/GEVA-131/ (pilots, review grids, GST-734 check) and handoffs/GEVA-184/ (TB2, judging, scoring)"
links:
  - 2026-11-01-geva-108-ceremony-cut-prereg
  - 2026-11-01-geva-136-ceremony-cut-g3-amendment
  - 2026-11-01-geva-89-stacks-round-1-review-results
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - 2026-11-02-geva-175-r2-full-review-results
  - GST-824
  - GST-734
  - GST-958
attachments:
  - 7ce03388f050c1fb09a4f0cec55fd80368a0c87e07409f4893f7995fa4c3e8d7  derived.sha256.txt
  - f756cb43f959f7b7f714f3faf6eda586a61f787177e8f5bf927524cce0bce74b  phase-scripts.txt
  - 20e4c41c0906d8af2d8150a06d928b0c61241d56bd5fa20677264441ee5b0da5  run-log.txt
---

# The ceremony cut gets no verdict on Opus 5.5, and its TB2 cell shows a loss: variant minus control -5.4 points (95% CI -10.8 to -0.9, Holm p 0.042). On particle-1 it shows no loss, +2.7 points (90% CI -3.6 to +9.0), at 0.70 times the cost

Unpublished. Publication waits on the claim check by a cross-family reviewer and another crew's reanalysis from a clean machine ([the findings standard](../2026-11-01-geva-105-findings-standard.md), section 2). The X hook below is a draft.

| Record | |
|---|---|
| Grade | Preregistered, one verdict per model. TB2: 37 tasks, 3 replicates, Opus 5.5 and particle-1. Review: Opus 5.5 on a development-only suite at a floor, with no verdict (an arm stopped). |
| Preregistration | [2026-11-01-geva-108-ceremony-cut-prereg](../../plans/2026-11-01-geva-108-ceremony-cut-prereg/README.md) (#122, main 64e4d62), amended by [2026-11-01-geva-136-ceremony-cut-g3-amendment](../../plans/2026-11-01-geva-136-ceremony-cut-g3-amendment/README.md) (#128, main 409ff47) |
| gstack under test | garrytan/gstack 142757b107edeffff7c78453490c4d2786996fa7 (gstack PR #3818): the full render (control) against the unattended render (variant), same commit |
| Models under test | claude-opus-5-5 (Anthropic API), review and TB2; particle-ai/particle-1 (OpenRouter), TB2 only |
| Harness | Review: review-units at the rig pin b792646b43cb8ea170039623b420229e0d669216 (#119), Claude Code 2.1.314, 60 turns. TB2: Lane B tag laneb-stacks-3-runner (8cd497367e3d7e609103540c22e01542b705604d), Claude Code 2.1.312, Harbor, terminal-bench-2 at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c |
| Run | 2026-11-02 UTC. Pilots and both review grids by GEVA-131 (review-grid from 03:01Z, review-sdk 08:17Z to about 09:55Z). TB2 10:07Z to 12:58Z on two Ubicloud VMs, judges 13:08Z to 13:13Z, scoring after, by GEVA-184 |
| Data | TB2 job folders and the judged review arms, not published (see What is held out) |

## What we found

gstack's ceremony cut (I1) takes the operational ceremony (shared preamble, question tuning, telemetry, learnings, Aside, queue status, brain sync) out of the skill text that unattended sessions load. On Opus 5.5 the frozen rule gives FIX-METHOD. The review lane has no verdict, because its control arm lost one session to an upstream error, and the coverage gate needs a verdict there. The TB2 cell beside it shows a loss: the unattended render passed 82.9% of 111 trials against the full render's 88.3%, -5.4 points (90% CI -9.9 to -1.8), and its LOSS test fires after Holm's adjustment (p 0.042). Had every gate held, the same rule would have said KEEP. The cut costs 9% less per Opus TB2 trial, though that interval includes no saving (ratio 0.910, 95% CI 0.842 to 1.012), and 8% less per review unit-pass (0.920, 0.871 to 0.972). The title gives the Opus loss with its 95% interval, the stricter one, and particle-1's no-loss reading with the 90% interval that the no-loss rule reads.

On particle-1 the rule gives CUT with no-loss yes: 78.4% against 75.7%, +2.7 points (90% CI -3.6 to +9.0, margin 10), at 0.703 times the cost per trial (0.569 to 0.874). The prereg makes the Opus verdict the answer to I1 and reports particle-1's beside it as a caution for small models, so the unattended render does not meet its ship condition for Opus sessions.

## How it works

This is an explanation, not a result. Removing text changed what Opus did, not only what it read. Opus ran the skill's start line in 103 of 111 variant trials and 14 of 111 control trials, and printed /investigate's status line in 70 variant trials and in none of control's. The ceremony itself ran in 9 control trials (telemetry) and in no variant trial, where it no longer exists. So the variant followed more of gstack's procedure while it lost tasks. It tied the no-gstack arm (82.9% both), while the full render beat no gstack by 5.4 points (90% CI 0.0 to +11.7, a secondary reading). We don't know why the shorter render drew Opus into the procedure. One reading is that the start line and the status-line rule sit nearer the top once the ceremony is gone. This run can't test that. On particle-1 the variant also ran more of the procedure (start line 97 against 39 trials, DEBUG REPORT 57 against 18) and showed no loss.

## Setup

**Question** (prereg section 1): does the unattended render lose quality against the full render from the same commit, and what does it save?

**Arms** (prereg section 2). control: gstack 142757b with `bin/gstack-modules render --host claude --loadout full`. variant: the same with `--session-kind unattended`. none: no gstack and the plain told text. control-sdk (review only): control with the SDK's default system prompt. Every other arm uses Claude Code's preset system prompt. Every arm sets GSTACK_SESSION_KIND=unattended and CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1. Review sessions are told /review; TB2 trials are told /investigate.

**Review.** stacks-r1 (sha256 4f46bb17b7ef98a34db9bf4b03c69755c694eb17dfc7ca0e29e1049a1bcc9a1d): 33 units, 42 blocking blockers on 26 PRs. control, variant and none at 2 passes (66 unit-passes each), control-sdk at 1 pass (33). #95's severity map (sha256 8bcbc928de440bcbdb49434b523a33d27130e20c5b7b0865e3102998a23fbbc6). Judges as #95 section 3: Opus 5.5 primary, gpt-6.1-sol second, Sonnet 5.5 third on disagreement, seed 20261101, judge brief sha256 ef33d5ca0f802e49e18d1f3e4b16f989bcbd48fa4c46f339bc0533dfb1364427.

**TB2.** 37 tasks (quick look 3's 40 less crack-7z-hash, adaptive-rejection-sampler and largest-eigenval), 3 replicates, 111 trials per cell, 12 trials at a time, in-run oracle on (37 of 37 passed on both VMs). The arm tars were rebuilt from the tag before any paid call and matched the prereg: gstack-render.tar eeab89bf220323bfb54277c38c9f418fff385da2bf185527a8a44a111d628e1e, gstack-render-unattended.tar 406d4a865eee2fcc94d2d97b112af427e5d293ab364f244c358bf6d7a534f5b1, none.tar 8bab483364e4153a832c0995d6bc06d2953af805f32ae70a2e40788965a6764e ([run-log.txt](run-log.txt)). Session caps: Opus $2.50, particle-1 $0.80.

**Scoring.** The frozen scripts at 409ff47 (#128): decide.py d8a4f9006bcffd6dd7d4149fae5c708389c45d3b17fd70c9d63c68eaa5728cf1, exposure.py 033152090fbfe4f5c9e3358ddcf6d8a0bb1c23546221ac7ec7e31fa7d0933486, review-cost.py 704f65b8e4cd36aa345dc534a538f9f0770a6dab289e3ea3087d7c53ab5f35e8, peak.py fabfcc9e802d0b790cf1e329f731874b7b2b222e08472d1316e2cf1e803a6311, ceremony-tb2.ts b6b53a098b84182ceecdd530ee8daee60af27aafef9d51d304190a6eda8fcad8. noloss score at the rig pin with comparisons.ceremony-r1.json (d5dfdf48fadac37286c494e7a414187ec9f9a476100e26c1889f11eae1ef71b2) and comparisons.ceremony-r1-secondary.json (c4ad189204ee2bec4ad40db4b22073c57c0234c0033142a088c721ca00374d10).

### Setup deviations

1. **Operating thread.** UBI_OWNER and the VM names carry geva184, the thread that ran TB2, as #128 recorded for GEVA-131.
2. **Session caps.** Set in a worktree of the tag (config/cells.json: claude-opus-5-5 2.5, particle-1 0.8), as caps.py and the handoff say, so the run manifest shows the tree dirty.
3. **Edits before blinding.** Judge ingest refused the raw arms. The derived-arm chain below ran on all four arms under the Captain's decision.
4. **Review cost.** review-cost.py stopped on control-opus's gap row (`ValueError: could not convert string to float: 'unavailable'`). It was rerun unchanged on a symlink copy of the grid's out dir whose control-opus cost.tsv leaves out that one row (133 rows to 132). The review cost ratios and decide.py's review cost line come from that copy. No cost ratio enters a verdict (prereg section 6, rule 5).
5. **Ceiling.** The ceiling and the start-rule figures are in Agent notes.

### The derived-arm chain before judging

The pinned noloss ingest refused all four raw arms. none-opus carried severity labels the frozen map lacks (High, Medium, Low), and a machine-path scan flagged finding lines in every arm (none-opus 8, control-opus 13, variant-opus 10, control-sdk-opus 5). The Captain ruled (decision A, the same as on #138): run GEVA-89's chain unchanged on all four arms before blinding, with only the suite path set to stacks-r1, and add a case-insensitive severity twin as one small derived script. The steps ran identically on every arm. Files changed per step:

| Step | Script, sha256 | none-opus | control-opus | variant-opus | control-sdk-opus |
|---|---|---|---|---|---|
| 1, severity map | sevmap.ts b3724a71fe4ee0a8a70eb454115d8e815679ab62066771541f975f9e197a66ea | 1 | 1 | 1 | 1 |
| 2, case twin | casetwin.ts 218350de091f1951a425da200c16fdb2791adcb0fc6f5a3de6ee52c54359c518 | 1 | 0 | 0 | 0 |
| 3, path scrub | ceremony-scrub.sh 17c926af9762c098627451855eb8f60125f3dde3e352abf0202ae1554ad88566 (GEVA-89's r1-scrub.sh with the suite path changed; it runs scrub.ts c3829af672462a22e22991cb7d80bedffdad3fb9c181c5ce549f8d881a2c4f8e, scrub2.ts cad13e6af4444df657d3b48c1978b08184e2c4c056f8b8d0f73e9629cdd1b237 and r1-scrub3.ts 3a462a557026665d6a367b40dde48f2f9c863f567915c9bff3c4cb4461ae9886) | 7 | 8 | 5 | 4 |

Steps 1 and 2 change only each arm's arm.json severity map; step 3 replaces machine paths in finding text. Scan hits after step 3: 0 in every arm, and `ingest --check` passed each. Findings per arm stayed 136, 134, 116 and 66 at every step. [derived.sha256.txt](derived.sha256.txt) lists every file's sha256 before step 1 and after each step. Only none-opus carried labels outside the map, so the chain's severity steps touch only readings that involve none-opus, which are secondary. In the other three arms it added map entries that match no label they use (their findings are CRITICAL or INFORMATIONAL), changed no severity and dropped no finding.

**MAJOR-as-INFORMATIONAL sensitivity.** majorinfo.ts (b320d3c2cf28c71cd07401a7ef359887b3c8d67002ca0c82651451e72d7f6905) ran unchanged, through links named for its hard-coded arm list, and gave the sensitivity map (sha256 4d2d1a7031621a7b73c0cdafffd6adc6715869f2a00248201b68c794476348da). One finding in the whole set carries MAJOR (none-opus, "major"). All four comparisons give the same numbers and the same verdicts under it ([run-log.txt](run-log.txt), score-mi.sh).

## Result

### Verdicts

decide.py, verbatim:

```
claude-opus-5-5: FIX-METHOD, no-loss no. a gate failed: G4 coverage, review: noloss gave no verdict: arm control-opus stopped, so there is no verdict
particle-1: CUT, no-loss yes. TB2 variant minus control +2.7 pp, 90% CI lower end -3.6 above -10, size 0.838
LOSS test TB2 claude-opus-5-5: Holm-adjusted p 0.0420 (LOSS)
LOSS test TB2 particle-1: Holm-adjusted p 1.0000
LOSS test review: Holm-adjusted p 1.0000
gate failed: G4 coverage, review: noloss gave no verdict: arm control-opus stopped, so there is no verdict
G3 render kind, TB2 claude-opus-5-5: variant 67 of 67 counted start-line sessions printed RENDER_KIND: unattended, 36 more cut by the session; control 0 printed it, 13 uncut start-line sessions; mismatch sessions: 0 RENDER_KIND_MISMATCH, 0 SESSION_KIND
G3 render kind, TB2 particle-1: variant 96 of 97 counted start-line sessions printed RENDER_KIND: unattended, 0 more cut by the session; control 0 printed it, 7 uncut start-line sessions; mismatch sessions: 0 RENDER_KIND_MISMATCH, 0 SESSION_KIND
G3 render kind, review: variant 20 of 20 counted start-line sessions printed RENDER_KIND: unattended, 29 more cut by the session; control 0 printed it, 0 uncut start-line sessions (control half not observable); mismatch sessions: 0 RENDER_KIND_MISMATCH, 0 SESSION_KIND
TB2 claude-opus-5-5 cost per trial, variant/control: 0.910 [0.842, 1.012]
TB2 particle-1 cost per trial, variant/control: 0.703 [0.569, 0.874]
review cost per unit-pass, variant/control: 0.920 [0.871, 0.972]
```

| Model, lane | Verdict | No-loss | Variant minus control | Cost, variant / control [95% CI] | Start line run, variant and control |
|---|---|---|---|---|---|
| Opus 5.5, TB2 | FIX-METHOD (G4 fails on review) | no | -5.4 points, 90% CI [-9.9, -1.8]; LOSS, Holm p 0.042 | 0.910 [0.842, 1.012] per trial | 103 of 111, 14 of 111 |
| Opus 5.5, review | no verdict: control-opus stopped | no | blocking recall +1.2 points, 95% CI [-3.7, 6.8]; p loss 0.813 | 0.920 [0.871, 0.972] per unit-pass | 49 of 66, 1 of 66 |
| particle-1, TB2 | CUT | yes | +2.7 points, 90% CI [-3.6, +9.0]; margin 10, size 0.838 | 0.703 [0.569, 0.874] per trial | 97 of 111, 39 of 111 |

### TB2

ceremony-tb2.ts, verbatim, with no-reward trials scored 0 (the primary reading):

| Model | Arm | Trials | Graded | Pass | Infra | No reward | Agent timeouts | Session caps | Per success | Requests | First-request tokens (median, min, max) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | control | 111 | 111 | 88.3% (98) | 0 | 0 | 0 | 0 | $0.2890 | 6.71 | 36361, 36033, 39042 |
| claude-opus-5-5 | variant | 111 | 111 | 82.9% (92) | 0 | 0 | 1 | 0 | $0.2802 | 6.68 | 31751, 31423, 34432 |
| claude-opus-5-5 | none | 111 | 111 | 82.9% (92) | 0 | 0 | 0 | 0 | $0.1662 | 5.89 | 22619, 22450, 65081 |
| particle-1 | control | 111 | 111 | 75.7% (84) | 0 | 0 | 5 | 0 | $0.1053 | 19.44 | 99853, 98989, 107174 |
| particle-1 | variant | 111 | 111 | 78.4% (87) | 0 | 0 | 5 | 0 | $0.0714 | 17.59 | 89150, 88286, 96471 |
| particle-1 | none | 111 | 111 | 80.2% (89) | 0 | 1 | 5 | 0 | $0.0775 | 18.42 | 64264, 63757, 68270 |


| Model | Contrast | Tasks | Difference, pp | 90% CI | 95% CI | LOSS p (one-sided) | Margin | Size | No-loss |
|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | variant - control | 37 | -5.4 | [-9.9, -1.8] | [-10.8, -0.9] | 0.0140 | 7.5 | 0.939 | NOT_SHOWN |
| claude-opus-5-5 | control - none | 37 | +5.4 | [+0.0, +11.7] | [-0.9, +12.6] | - | - | - | - |
| claude-opus-5-5 | variant - none | 37 | +0.0 | [-5.4, +5.4] | [-6.3, +6.3] | - | - | - | - |
| particle-1 | variant - control | 37 | +2.7 | [-3.6, +9.0] | [-5.4, +10.8] | 0.7624 | 10 | 0.838 | NO_LOSS |
| particle-1 | control - none | 37 | -4.5 | [-13.5, +3.6] | [-15.3, +5.4] | - | - | - | - |
| particle-1 | variant - none | 37 | -1.8 | [-9.0, +4.5] | [-10.8, +6.3] | - | - | - | - |


| Model | Ratio | Tasks | Per trial [95% CI] | Per success [95% CI] |
|---|---|---|---|---|
| claude-opus-5-5 | variant / control | 37 | 0.910 [0.842, 1.012] | 0.970 [0.884, 1.090] |
| claude-opus-5-5 | control / none | 37 | 1.852 [1.673, 2.107] | 1.738 [1.517, 2.020] |
| claude-opus-5-5 | variant / none | 37 | 1.685 [1.502, 1.914] | 1.685 [1.465, 1.954] |
| particle-1 | variant / control | 37 | 0.703 [0.569, 0.874] | 0.679 [0.536, 0.866] |
| particle-1 | control / none | 37 | 1.282 [1.099, 1.522] | 1.358 [1.091, 1.715] |
| particle-1 | variant / none | 37 | 0.901 [0.725, 1.136] | 0.921 [0.713, 1.214] |

With no-reward trials dropped, the only change is particle-1 none, which loses its one no-reward trial (80.9% of 110), so particle-1's ratios against none move slightly (control / none 1.298 per trial). Every control-against-variant row is unchanged.

Per task (tb2-pertask.py). On Opus, control and variant differ on 4 of 37 tasks, all toward control (passes of 3, control/variant/none): feal-differential-cryptanalysis 3/1/3, model-extraction-relu-logits 3/1/1, polyglot-rust-c 3/2/0, query-optimize 3/2/3. On particle-1 they differ on 12 tasks, 5 toward control and 7 toward the variant.

### Review

noloss score, verbatim. The primary, variant against control:

```
variant-opus vs control-opus at a 10-point margin (The review no-loss lane's margin (stacks round 1 plan, section 7), kept so the scorer and size rule run unchanged. Control sits near 10% blocking recall, so this margin can only bound a loss; section 5 says so.): no verdict (arm control-opus stopped, so there is no verdict). Blocking recall 9.5% vs 8.3%, delta 1.2 points [95% CI -3.7, 6.8]; 4 losses, 4 gains on 42 blockers in 26 PRs (5 discordant). p non-inferior 0.000016, p loss 0.813 (Holm n/a, step 1 of 1 in the declared LOSS family) (minimum reachable 0.031).
size rule: met, an arm as good as the reference gets NO_LOSS in 84.5% of 2000 simulations (spread wide, recall 0.083, seed 20261101).
false blockers per PR: incomplete, so not tested (arm control-opus stopped, so there is no verdict).
verdict: none
```

The secondaries, as preregistered:

```
control-opus vs none-opus at a 10-point margin (Secondary, the lane's margin.): no verdict (arm control-opus stopped, so there is no verdict). Blocking recall 8.3% vs 7.1%, delta 1.2 points [95% CI -4.2, 6.4]; 3 losses, 4 gains on 42 blockers in 26 PRs (5 discordant). p non-inferior 0.00062 (Holm n/a over 3), p loss 0.813 (Holm n/a, step 1 of 1 in the declared LOSS family) (minimum reachable 0.031).
size rule: below, an arm as good as the reference gets NO_LOSS in 75.3% of 2000 simulations (spread wide, recall 0.071, seed 20261101, no-loss alpha 0.05/3, Holm's strictest step).
false blockers per PR: incomplete, so not tested (arm control-opus stopped, so there is no verdict).
verdict: none

variant-opus vs none-opus at a 10-point margin (Secondary, the lane's margin.): non-inferior within 10 points (NO_LOSS). Blocking recall 9.5% vs 7.1%, delta 2.4 points [95% CI -4.5, 10.5]; 5 losses, 6 gains on 42 blockers in 26 PRs (7 discordant). p non-inferior 0.0012 (Holm 0.0035 over 3), p loss 0.820 (minimum reachable 0.0078).
size rule: below, an arm as good as the reference gets NO_LOSS in 75.3% of 2000 simulations (spread wide, recall 0.071, seed 20261101, no-loss alpha 0.05/3, Holm's strictest step).
false blockers per PR: variant-opus 0.02, none-opus 0.00, difference +0.02 [95% CI 0.00, +0.05] on 32 PRs; two-sided p 1.000 (minimum reachable 1.000); smallest drop that counts 0.5 per PR: the estimate does not clear it; the interval does not exclude zero or lies above it.
verdict: NO_LOSS NOLOSS_UNDERPOWERED

control-opus vs control-sdk-opus at a 10-point margin (Secondary, the lane's margin.): no verdict (arm control-opus stopped, so there is no verdict). Blocking recall 8.3% vs 14.3%, delta -5.9 points [95% CI -15.6, 2.8]; 5 losses, 3 gains on 42 blockers in 26 PRs (8 discordant). p non-inferior 0.227 (Holm n/a over 3), p loss 0.172 (minimum reachable 0.0039).
size rule: below, an arm as good as the reference gets NO_LOSS in 35.9% of 2000 simulations (spread wide, recall 0.143, seed 20261101, no-loss alpha 0.05/3, Holm's strictest step).
false blockers per PR: incomplete, so not tested (arm control-opus stopped, so there is no verdict).
verdict: none
```

The coverage gap: control-opus's cost.tsv row for garrytan/gstack#3564 at e97b8573502b, pass 2, is unavailable in every field. That session ended missing after an upstream error, and the scorer stops the arm. The Captain ruled that the gap stands.

**Judges.** Matching: 33 packets, 452 findings, 60 requests (primary 33, second 24, third 3), 0 unjudged; the second judge read 28 decisions and agreed with the primary at kappa 0.9454. Adjudication: 11 packets, 50 findings, 22 requests (primary 11, second 7, third 4), 0 unjudged; the second judge read 14 decisions and agreed at kappa 0, so the third decided 4. Unverifiable not-defect rulings: variant-opus 1 (0.0156 per PR cluster per pass), every other arm 0.

### Exposure and gates

exposure.py on TB2 (selected rows, trials per arm of 111):

| Marker | claude-opus-5-5 gstack-render (n=111) | claude-opus-5-5 gstack-render-unattended (n=111) | claude-opus-5-5 none (n=111) | particle-1 gstack-render (n=111) | particle-1 gstack-render-unattended (n=111) | particle-1 none (n=111) |
|---|---|---|---|---|---|---|
| start_line | 14 | 103 | 0 | 39 | 97 | 0 |
| render_kind_unattended | 0 | 67 | 0 | 0 | 96 | 0 |
| start_line_cut | 1 | 36 | 0 | 32 | 0 | 0 |
| telemetry | 9 | 0 | 0 | 2 | 0 | 0 |
| learnings | 0 | 0 | 0 | 2 | 0 | 0 |
| any_ceremony | 9 | 0 | 0 | 4 | 0 | 0 |
| scope_lock | 0 | 0 | 0 | 0 | 23 | 0 |
| status_line | 0 | 70 | 0 | 21 | 80 | 0 |
| debug_report | 0 | 0 | 0 | 18 | 57 | 0 |
| root_cause_hypothesis | 0 | 1 | 0 | 0 | 1 | 0 |
| turn_cap | 0 | 0 | 0 | 0 | 0 | 0 |

exposure.py on review (selected rows, sessions per arm):

| Marker | claude-opus-5-5 control (n=66) | claude-opus-5-5 control-sdk (n=33) | claude-opus-5-5 none (n=66) | claude-opus-5-5 variant (n=66) |
|---|---|---|---|---|
| start_line | 1 | 0 | 0 | 49 |
| render_kind_unattended | 0 | 0 | 0 | 20 |
| start_line_cut | 1 | 0 | 0 | 29 |
| any_ceremony | 0 | 0 | 0 | 0 |
| review_log | 0 | 0 | 0 | 23 |
| pre_landing_review | 54 | 23 | 0 | 60 |
| agent_dispatch | 0 | 0 | 0 | 0 |
| checklist_read | 0 | 0 | 0 | 0 |
| review_army_read | 0 | 0 | 0 | 0 |
| adversarial_read | 0 | 0 | 0 | 0 |
| turn_cap | 0 | 0 | 0 | 0 |

- **G1 install.** The tars matched the prereg, and GEVA-131's review install check passed. decide.py reports no G1 failure.
- **G2 body load.** The variant's median first request sits 4,610 tokens under control's on Opus TB2 (31,751 against 36,361), 10,703 on particle-1 TB2 (89,150 against 99,853) and 5,315 on review (57,109 against 62,424). All pass (the gate needs 2,000).
- **G3 render kind.** Passes in all three cells, as decide.py prints above. No session printed RENDER_KIND_MISMATCH.
- **G4 coverage.** Every TB2 cell has 111 of 111 trials graded. The review comparison has no verdict, so G4 fails for Opus.
- **Procedure.** /review's Agent dispatches ran in 0 sessions in every review arm, and its checklist, review-army and adversarial sections were read in none. /investigate's DEBUG REPORT block ran in 0 trials in both Opus gstack arms, and in 18 (control) and 57 (variant) particle-1 trials.
- **GST-734.** Both grids ran on a driver older than the GST-734 fix. GEVA-131 counted the sessions that ended with a background task still open at the first result before review-sdk launched: 0 of 66 in each of control, variant and none, and 0 of 2 in each pilot arm. The same script, with only its paths changed, finds 1 of 33 in control-sdk (gstack#3540, pass 1, a background bash). That touches only the control-against-control-sdk secondary, which has no verdict.
- **GST-958 does not apply.** All 666 TB2 trials have laneb-summary.json.

## Cost

**Review**, review-cost.py on the copy without the gap row:

| Ratio of mean dollars per unit-pass | Units | PRs | Ratio [95% CI] |
|---|---|---|---|
| variant / control | 33 | 32 | 0.920 [0.871, 0.972] |
| control / none | 33 | 32 | 1.340 [1.254, 1.427] |
| variant / none | 33 | 32 | 1.232 [1.166, 1.310] |
| control / control-sdk | 33 | 32 | 0.940 [0.879, 1.009] |

## Why null? (R48)

**Opus 5.5: FIX-METHOD, with a TB2 loss beside it.**

- **Exposure.** The part under test is text the variant no longer loads, so the question is whether the variant loaded its render and still ran the kept steps. It did: G2 and G3 hold in both lanes, and the variant ran the start line in 103 of 111 TB2 trials and 49 of 66 review sessions. The ceremony ran in 9 of 111 control TB2 trials and in no review session, so on review the cut removed text Opus never acted on. Neither lane exercised the skills' main procedure: /investigate's DEBUG REPORT ran in 0 Opus trials and /review's Agent dispatches in 0 sessions.
- **Task fit.** Most TB2 tasks are not debugging tasks, and plain Opus passes 82.9% of them. stacks-r1 sits at a floor: control found 8.3% of blocking blockers and none 7.1%.
- **Power, floor and ceiling.** TB2 control sits at 88.3%, near the ceiling; the planned MDD was 5.5 points under the null (8.2 with real task-by-arm spread). The LOSS test fired anyway: 6 lost passes on 4 of 37 tasks, none the other way. The review lane's MDD is about 11 points against a 10-point margin, on a development-only suite, so it could only have shown a large loss.
- **Frontier model without the skill.** Plain Opus 5.5 ties the variant on TB2 (+0.0 points, 90% CI -5.4 to +5.4), and the full render beats it by 5.4 (90% CI 0.0 to +11.7). On this grid the cut brings Opus back to its no-gstack pass rate.
- **Verdict: FIX-METHOD**, from the frozen rule, because G4 failed on review. Plainly: the TB2 data say the cut costs Opus quality, and had every gate held, rule 3 would have given KEEP from that LOSS alone. It is not a CUT-CANDIDATE.

**particle-1: CUT, no-loss yes.**

- **Exposure.** The variant ran the start line in 97 of 111 trials (control 39) and printed RENDER_KIND: unattended in 96 of the 97 counted. The ceremony ran in 4 control trials (telemetry 2, learnings 2) and in no variant trial. The variant ran more of the kept procedure: DEBUG REPORT 57 against 18, the status line 80 against 21, Scope Lock 23 against 0.
- **Task fit.** The same 37 tasks; plain particle-1 passes 80.2%.
- **Power, floor and ceiling.** Control at 75.7%, MDD 9.5 points at a 10-point margin, size 0.838. A loss of up to 3.6 points sits inside the 90% interval.
- **Frontier model without the skill.** Not the question for a low-cost model. Plain particle-1 passed more trials than either gstack arm (control -4.5 points, 90% CI -13.5 to +3.6; variant -1.8, -9.0 to +4.5), so gstack shows no lift to keep on particle-1 here.
- **Verdict: CUT** under the frozen rule. The ceremony text is a CUT-CANDIDATE for particle-1's unattended sessions: it ran in 4 of 111 trials, and removing it showed no loss within the 10-point margin while cutting cost by 30%.

## What this steers

1. **The unattended render doesn't meet its ship condition for Opus.** Section 1 ships gstack PR #3818 only on CUT with no-loss yes, and rule 6 makes the Opus verdict the answer to I1. The Captain carries this to the gstack Captain.
2. **Read the four Opus tasks before any rerun.** feal-differential-cryptanalysis, model-extraction-relu-logits, polyglot-rust-c and query-optimize lost passes in the variant. A cut that also changes which steps Opus runs (start line 103 against 14) is not the plain text diet I1 assumed, so the next step is to read those transcripts side by side.
3. **Freeze an UPSTREAM rule before rerunning review.** One upstream error voided the review lane, as GEVA-131's lesson in CREW warns. A rerun also needs blockers the no-gstack arm can reach.
4. **The saving is small on Opus, and on TB2 it is not shown.** About 8% per review unit-pass (95% CI 0.871 to 0.972) and 9% per TB2 trial, whose interval (0.842 to 1.012) includes no saving. The mechanical part is $0.028 per TB2 trial and $0.043 per review unit-pass. On particle-1 the saving is 30%.

## Limits and threats

- **The review lane.** One UPSTREAM gap (gstack#3564, pass 2) voided control-opus; the Captain ruled the gap stands. No session in any arm ran /review's Agent dispatches, so this lane doesn't test the review procedure. stacks-r1 is development-only, and the scorer never lets a review no-loss claim stand.
- **Judge agreement.** Matching agreed at kappa 0.9454 on 28 second reads. Adjudication agreed at kappa 0 on 14, and the third read decided 4, so the false-blocker rows are soft.
- **Edits before blinding.** The derived-arm chain changed severity maps and machine paths in all four arms, under the Captain's decision and the GEVA-89 precedent. Its severity steps touch only readings with none-opus.
- **Review cost** comes from a copy without the gap row (deviation 4).
- **GST-734.** One control-sdk session ended with a background bash still running.
- **Housekeeping requests.** In each Opus TB2 arm, Claude Code asked for claude-opus-5 on 3 requests and claude-opus-4-8 on 3, out of 654 to 745. The counts are equal across arms.
- **Models.** Opus 5.5 and particle-1 only. GPT-6.1 Sol did not run; the prereg's ceiling held these cells and no more. particle-1 has no review lane (prereg section 2).
- **Scope** (prereg section 12): nothing here speaks to interactive sessions, /ship, or skills other than /review and /investigate. The TB2 margin (7.5 points on Opus) is wider than gstack's own measured lift on Opus, so even a CUT could not have shown the cut keeps a lift.

## Replicate it

1. **Reanalysis (keyless).** It needs the TB2 job folders and the judged review arms, which are not published. The Captain drive's handoffs/GEVA-184/ holds them with a SHA256SUMS file: tb2-jobs-and-out.tar.gz, judged-arms.tar.gz, score-outputs.tar.gz (scorer outputs, tb2-config.json, decide.json) and the TB2 ledger file. With them, at the rig pin b792646 and with #128's frozen scripts, run score-review.sh, score-part2.sh and score-mi.sh from [phase-scripts.txt](phase-scripts.txt), and ceremony-tb2.ts and exposure.py on the job folders with tb2-config.json. The expected output is in [run-log.txt](run-log.txt). Outsiders can verify the digests today, not the scores.
2. **Rerun (paid).** From GEVA-131's handoff, run the pilots and the two review-units grids; from phase-scripts.txt, setup-tb2.sh, tb2/batch.sh with the pinned ubi-runner, judge-prep.sh and judge2.sh, each after its start rule.

The attached record holds every script GEVA-184 ran and the lines each printed. It leaves out the machine setup (clones, the gstack install check), GEVA-131's pilot and review-grid commands (in its handoff), the single commands that ran ceremony-tb2.ts and exposure.py on TB2 (their output is in run-log.txt), the transcripts, the ledger database and the judge packets and replies.

## What is held out, and why

Nothing is sealed. TB2 is public at 69671fba, and stacks-r1 is published with its sha256 above. The transcripts, the TB2 job folders and the judged review arms are not published: they hold model-written text that quotes the units' code, and session text. They are in the Captain drive (handoffs/GEVA-184/), and outsiders can verify their digests only.

## Attachments

- [run-log.txt](run-log.txt): the lines every phase printed, in run order, with machine paths replaced.
- [phase-scripts.txt](phase-scripts.txt): every script GEVA-184 ran or wrote for this run, each with its original sha256.
- [derived.sha256.txt](derived.sha256.txt): every derived-arm file's sha256 before and after each chain step.

## X hook (draft)

> We tested gstack's ceremony cut: the same skills without their housekeeping text, in unattended sessions. On Opus 5.5 it lost 5.4 points on 37 Terminal-Bench 2 tasks (95% CI -10.8 to -0.9) and cost 9% less per trial (not significant), so it doesn't ship for Opus. On particle-1 it showed no loss (within a 10-point margin) and cost 30% less. Our review lane gave no answer: one provider error voided an arm.

## Claim check

| Check | Evidence |
|---|---|
| The headline holds at both ends of the interval | Opus TB2 -5.4 points, 95% CI -10.8 to -0.9, below zero at both ends; the headline says no verdict on Opus, as the frozen rule does; particle-1's 90% CI lower end -3.6 sits above the -10 margin |
| The headline names the grade | one verdict per model, review development-only (record table) |
| No claim the scorer forbade | no review no-loss claim is made |
| No parity claim | none made; particle-1 is compared only with itself |
| Disclosures settled before the post | the closing section, with the lines from the org's research/disclosures.md for gstack, gbrain and particle-1; Opus 5.5 gets no line, and GPT-6.1 Sol was a judge with no result |
| The sealed guard passes | gstack-pregate sealed on this branch before the push |
| Cross-family claim check and a clean-machine reanalysis by another crew | not done; publication waits on both |

## Changelog

- 2026-11-02: first version (GEVA-184).

<details>
<summary>Agent notes</summary>

| Record | |
|---|---|
| Grade | Preregistered, one verdict per model. TB2: 37 tasks, 3 replicates, Opus 5.5 and particle-1. Review: Opus 5.5 on a development-only suite at a floor, with no verdict (an arm stopped). |
| Preregistration | [2026-11-01-geva-108-ceremony-cut-prereg](../../plans/2026-11-01-geva-108-ceremony-cut-prereg/README.md) (#122, main 64e4d62), amended by [2026-11-01-geva-136-ceremony-cut-g3-amendment](../../plans/2026-11-01-geva-136-ceremony-cut-g3-amendment/README.md) (#128, main 409ff47) |
| gstack under test | garrytan/gstack 142757b107edeffff7c78453490c4d2786996fa7 (gstack PR #3818): the full render (control) against the unattended render (variant), same commit |
| Models under test | claude-opus-5-5 (Anthropic API), review and TB2; particle-ai/particle-1 (OpenRouter), TB2 only |
| Harness | Review: review-units at the rig pin b792646b43cb8ea170039623b420229e0d669216 (#119), Claude Code 2.1.314, 60 turns, $8 allowance per session. TB2: Lane B tag laneb-stacks-3-runner (8cd497367e3d7e609103540c22e01542b705604d), Claude Code 2.1.312, Harbor, terminal-bench-2 at 69671fbaac6d67a7ef0dfec016cc38a64ef7a77c |
| Run | 2026-11-02 UTC. Pilots and both review grids by GEVA-131 (review-grid from 03:01Z, review-sdk 08:17Z to about 09:55Z). TB2 10:07Z to 12:58Z on two Ubicloud VMs, judges 13:08Z to 13:13Z, scoring after, by GEVA-184 |
| Data | TB2 job folders and the judged review arms, not published (see What is held out) |
| Spend | $321.06 settled through the ledger ($325.88 with the review grid's own log figure), $6.60 still reserved; ceiling $496.12 |

5. **Ceiling.** $496.12 (the Captain's ruling A on section 9's remedy). Every start rule counted the review grid at its log figure, $181.04.

| Model, lane | Verdict | No-loss | Variant minus control | Cost, variant / control [95% CI] | Peak exposure | Start line run, variant and control |
|---|---|---|---|---|---|---|
| Opus 5.5, TB2 | FIX-METHOD (G4 fails on review) | no | -5.4 points, 90% CI [-9.9, -1.8]; LOSS, Holm p 0.042 | 0.910 [0.842, 1.012] per trial | highest session $1.19 control, $1.14 variant, $0.92 none, against a $2.50 cap; 0 sessions at the cap | 103 of 111, 14 of 111 |
| Opus 5.5, review | no verdict: control-opus stopped | no | blocking recall +1.2 points, 95% CI [-3.7, 6.8]; p loss 0.813 | 0.920 [0.871, 0.972] per unit-pass | highest session $4.95 control, $4.42 variant, $3.95 none, $5.01 control-sdk, against an $8 allowance | 49 of 66, 1 of 66 |
| particle-1, TB2 | CUT | yes | +2.7 points, 90% CI [-3.6, +9.0]; margin 10, size 0.838 | 0.703 [0.569, 0.874] per trial | highest session $0.53 control, $0.24 variant, $0.47 none, against a $0.80 cap; 0 sessions at the cap | 97 of 111, 39 of 111 |

Review peak exposure is peak.py's reading: a session's settled spend plus its open reservations, at their highest (p95 $4.19 control, $4.18 variant, $3.44 none, $4.37 control-sdk).

| Model | Arm | Trials | Graded | Pass | Infra | No reward | Agent timeouts | Session caps | Spend | Per trial | Per success | Requests | First-request tokens (median, min, max) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-opus-5-5 | control | 111 | 111 | 88.3% (98) | 0 | 0 | 0 | 0 | $28.3189 | $0.2551 | $0.2890 | 6.71 | 36361, 36033, 39042 |
| claude-opus-5-5 | variant | 111 | 111 | 82.9% (92) | 0 | 0 | 1 | 0 | $25.7744 | $0.2322 | $0.2802 | 6.68 | 31751, 31423, 34432 |
| claude-opus-5-5 | none | 111 | 111 | 82.9% (92) | 0 | 0 | 0 | 0 | $15.2936 | $0.1378 | $0.1662 | 5.89 | 22619, 22450, 65081 |
| particle-1 | control | 111 | 111 | 75.7% (84) | 0 | 0 | 5 | 0 | $8.8439 | $0.0797 | $0.1053 | 19.44 | 99853, 98989, 107174 |
| particle-1 | variant | 111 | 111 | 78.4% (87) | 0 | 0 | 5 | 0 | $6.2154 | $0.0560 | $0.0714 | 17.59 | 89150, 88286, 96471 |
| particle-1 | none | 111 | 111 | 80.2% (89) | 0 | 1 | 5 | 0 | $6.9000 | $0.0622 | $0.0775 | 18.42 | 64264, 63757, 68270 |

**Cost**

Prices from the rig pin's src/runner/pricing/prices.ts, read 2026-11-01, in dollars per million tokens (prereg section 4):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| claude-opus-5-5 | 4 | 20 | 0.2 | 5 |
| particle-ai/particle-1 | 0.1 | 1 | 0.003 | none listed |

**TB2**, metered at the proxy:

| Model | Arm | Spend | Per trial | Per success | Tokens per trial | Requests per trial |
|---|---|---|---|---|---|---|
| claude-opus-5-5 | control | $28.32 | $0.2551 | $0.2890 | 289,504 | 6.71 |
| claude-opus-5-5 | variant | $25.77 | $0.2322 | $0.2802 | 257,533 | 6.68 |
| claude-opus-5-5 | none | $15.29 | $0.1378 | $0.1662 | 168,315 | 5.89 |
| particle-1 | control | $8.84 | $0.0797 | $0.1053 | 897,114 | 19.44 |
| particle-1 | variant | $6.22 | $0.0560 | $0.0714 | 646,907 | 17.59 |
| particle-1 | none | $6.90 | $0.0622 | $0.0775 | 653,277 | 18.42 |

**Review**, review-cost.py on the copy without the gap row:

| Role | Arm | Unit-passes | Dollars | Per unit-pass | Tokens per unit-pass | Requests | First-request tokens (median, min, max) |
|---|---|---|---|---|---|---|---|
| control | control-opus | 65 | $64.72 | $0.996 | 1,648,618 | 16.68 | 62424.0, 62225, 69850 |
| variant | variant-opus | 66 | $60.61 | $0.918 | 1,499,415 | 16.05 | 57109.0, 56910, 64535 |
| none | none-opus | 66 | $49.18 | $0.745 | 1,186,892 | 16.64 | 36736.0, 36537, 44162 |
| control-sdk | control-sdk-opus | 33 | $35.05 | $1.062 | 1,862,771 | 18.67 | 60103, 59978, 67593 |

| Ratio of mean dollars per unit-pass | Units | PRs | Ratio [95% CI] |
|---|---|---|---|
| variant / control | 33 | 32 | 0.920 [0.871, 0.972] |
| control / none | 33 | 32 | 1.340 [1.254, 1.427] |
| variant / none | 33 | 32 | 1.232 [1.166, 1.310] |
| control / control-sdk | 33 | 32 | 0.940 [0.879, 1.009] |

**Mechanical saving.** ceremony-tb2.ts prints it for TB2: 4,610 fewer first-request tokens and $0.0283 per Opus trial, 10,703 and $0.0017 per particle-1 trial. For review, by the same formula from review-cost.py's medians: 5,315 tokens times $5 per million, plus 5,315 times $0.2 per million for each of control's 15.68 later requests, is $0.0432 per unit-pass, 4.3% of control's $0.996. The rest of each saving is behavior.

**Spend by ledger item:**

| Item | Cap | Settled |
|---|---|---|
| Pilots (GEVA-131): review pilot; TB2 pilot rerun; the first TB2 pilot and the first review pilot launch both ended at $0 | | $9.274639 and $5.632839 |
| review-grid (GEVA-131) | $234.48 | $176.218648 on the lease, with 2 calls of unknown cost; the rig's log line says "spent $181.04" |
| review-sdk (GEVA-131) | $72.16 | $35.046846 |
| ceremony-r1-tb2 | $168.58 | $91.346257 (Opus $69.386883, particle-1 $21.959374) |
| ceremony-r1-judge-match | $20 | $2.29528 |
| ceremony-r1-judge-adj | $20 | $1.251118 |
| **Total** | ceiling $496.12 | **$321.060988**, or $325.88 with the grid's log figure |

Four TB2 sessions, two per model, opened a reservation of one session cap each and never settled, so $6.60 stays reserved on the item. The proxy's global counters run $0.247043 above the settled sessions (Opus $69.532834 against $69.386883, particle-1 $22.060466 against $21.959374), which is what those four sessions spent. Every cell still has 111 graded trials, each with its own settled session. Every start rule fit the ceiling; the largest was TB2's, $405.57.

- **Open reserves.** $6.60 stays reserved on the TB2 item for four sessions that never settled (Cost).

This run cost $321.06.

From the summary: $321.06 settled.

</details>

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

---
id: 2026-11-07-geva-395-tbv-held-b-frame-amendment
kind: plan
title: "Trust-but-verify amendment 2: held-out source B adds gstack's crew pull requests after P"
summary: "Our repo alone yields about 8 held-out PRs in 21 days, short of 20, so held-out source B adds gstack's crew PRs merged after P (sizing read: about 178). The third Opus held-out pass is in the plan."
author: GEVA-395
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: open
links:
  - 2026-11-05-geva-313-trust-but-verify-prereg
  - 2026-11-05-geva-326-tbv-prereg-amendment-1
  - 2026-11-06-geva-361-tbv-split-addendum
  - 2026-11-07-geva-379-tbv-mine-b-addendum
  - 2026-11-07-geva-392-tbv-render-turns-addendum
---

# Trust-but-verify amendment 2: held-out source B adds gstack's crew pull requests

This post amends amendment 1's section 2 (held-out source B comes only from after P) where it says so and nowhere else. Every other rule, pin, arm, model, judge, cap, threshold and MDD row stands. It lands on the eval's results branch, before P's record, under the two-PR rule (R77), and nothing in it spent money. The Captain ruled it on 2026-11-07 (A1, gated on the sizing read below).

## 1. Why

Held-out needs 70 non-clean tasks: source A's 50 plus at least 20 from source B, or the design stops at FIX-METHOD (yield). Source B was this repo's pull requests merged after P. The two-PR rule now gives each experiment at most 2 merged PRs, so that source dries up.

Dev source B, measured from B2's records (counts only):
- 237 PRs merged before the scorer pin post (9.0 days). 57 sorted non-clean, 55 were keyed, and 20 kept 3 or more facts. That is 8.4% of merged PRs.
- All 20 are code PRs. Docs-only PRs qualified 0 of 89 times. CI, config and sealed-allowlist PRs gave 10 of the 20.

Under the two-PR rule a prereg is docs-only, each experiment lands one results PR, and the after-P rules drop every experiment in flight at P. The projection for this repo alone is about 8 qualifying in 21 days (low 3, high 19), so held-out would land near 58. The scenarios are in the Captain's handoff for this thread.

## 2. The rule

Amendment 1 section 2 rule 2 now reads:

> Held-out source B comes from pull requests merged after P's record in this repository and in garrytan/gstack. Only pull requests our own crews authored count: in gstack, an author other than garrytan is an outside contributor and stays out. Of those, only the ones opened after P's record with no commit whose author date or committer date is before it count, so none of their work was visible while P was built.

Added to rule 3:
- A pull request that is part of the principle build, or whose diff touches any file in the principle's C-to-P diff, is out.
- A history that holds org-rule principle wording (the scan in prereg section 11 item 7) is dropped with a counted reason, not run. The assembler refused such a history in 1 of 168 sampled gstack PRs.
- Everything else is unchanged: the assembler, the strip, the size limit, a non-clean stratum, 3 or more facts after both auditors, and the cluster rules. A gstack PR's cluster is drawn from gstack's PRs only.

Rule 5's draw takes both repositories as one pool, stratified as before. Rule 8's caveat grows: the results post reports held-out source B's counts, stratum mix and per-family results per repository beside the pooled ones, and states the shift. gstack's PRs are the product under test, written after P by the crews that build gstack, the principle's builder included. Their bodies and comments never enter a history, because a history holds only checks, review findings and commits.

"P's record" is the P and C record commit on the results branch, and its push time is P's time for every rule here (the Captain records both in approvals before the held-out lease).

## 3. The sizing read

Keyless, and its rules were fixed before any record was read.
- **Window and sample.** gstack PRs merged from 2026-10-31T22:23:54Z to 2026-11-07T22:23:54Z: 335, all authored by garrytan. Every other one in creation order was read, 168 in all, scaled by 335/168.
- **How each was read.** One GraphQL read per PR with mine-b's node selection, check runs paged, then fromGraphql, assembleB, extract and admitsSize at ship's overhead, all at 195a07df.
- **Pseudo-P.** P was put at the window start, so the read counts the after-P losses of a cold start.
- **Exclusions.** The narrow set drops PRs touching any sections/preamble.md, captain/templates/READY.md, captain/templates/report.md or capy/skill/gstack/factory.md. The broad set also drops any SKILL.md or SKILL.md.tmpl, a stand-in for skill hooks.

| | Count (of 168) |
|---|---|
| Opened before pseudo-P | 23 |
| A commit before pseudo-P | 18 |
| A cluster sibling before pseudo-P | 1 |
| Refused by the rules-wording scan | 1 |
| Stratum none | 37 |
| In the pool | 88 (all "other") |
| Excluded by the narrow set | 5 |
| Excluded by the broad set | 19 |
| Non-clean after the narrow set, cluster cap 2 | 78 |
| Non-clean after the broad set | 65 |

- **The projection.** Central is 78 scaled to 155.5 a week, times 3 for 21 days, times dev B's keep rate of 0.364. That gives about 170 from gstack, plus this repo's central 8: **about 178**.
- **The low case.** The broad set's 65 scaled to 129.6, times 3, times 0.249 (the Wilson 95% lower bound of 20 kept of 55 keyed). That gives about 97, plus this repo's low 3: **about 100**.
- **The gate.** The Captain's gate was central at least 20 and low at least 15. It passes.
- **GraphQL use.** 875 calls and 2,701 points, paced 2.5 seconds apart, with the quota never under 3,000.

Accrual still closes at 50 qualifying tasks. At this rate that is about a week, so held-out source B will be mostly gstack.

## 4. What the read found that the build must handle

These are build items on the results branch, landed and pinned before any held-out source B key, test-first in both directions:
1. **mine-b pages check runs.** gstack's check suites carry up to 30 runs, more than checkRuns(first:20). Every sampled gstack PR came back truncated until the read paged them. Under the pinned mine-b, every gstack PR would be skipped.
2. **mine-b reads only the window.** It takes a merged-after bound, because gstack has thousands of PRs and mining them all at one per page would spend far more of the shared GraphQL quota than the window needs. It also records each PR's author.
3. **Task and cluster ids carry the repository** for gstack (gstack-pr-N), so no id collides with this repo's pr-N.
4. **held-b eligibility** adds the crew-author rule and the principle file list, and assemble-b drops a history the rules-wording scan refuses instead of stopping.

## 5. Strata

Every sampled gstack history in the pool sorted "other", with no long-list and no short-list task. Dev source B was 19 of 20 "other". So held-out source B's 20/15/15 mix cannot hold. Rule 5's spillover fills it from "other", and the custody addendum and results post report the shortfall.

## 6. Other changes on this branch before tbv-dev-base

- **P7, the OpenRouter generation id.** On OpenRouter's Anthropic Messages route the stream's message id is a msg_ id, which the generation endpoint rejects. OpenRouter sends the gen- id in the X-Generation-Id response header on every route. The driver now records that header's gen- id as an OpenRouter send's response id, with the msg_ id beside it and the source named. An OpenRouter answer with no gen- id records none, and a release it needs stops the item: the driver never falls back to the msg_ id. Anthropic sends are unchanged.
- **The render gate's walk.** A broken link or unreadable entry under --tasks, --shapes or --splices now fails with E_TBV_INPUT and no path.

## 7. The third Opus held-out pass is in the plan (deviation)

Garry, through the Captain (GEVA-2, 2026-11-07): the $2,000 line is a guideline, and the eval should not cut corners to stay under it. So tbv-held-p3, Opus's third skill-layer pass on the held-out tasks, runs. That takes Opus's MDD from 8.1 to 6.8 points.

This is a deviation from prereg sections 6 and 14, decided before any outcome data. Stage 1 read only Opus none, and no tbv-dev-base, climb or held-out reading exists yet.

- **What changes.** The prereg ran the third pass only when the all-in check fit under $2,000 with it. That condition is dropped: the all-in check still runs before every lease and its output is reported, but its verdict no longer stops tbv-held-p3.
- **What stays.** Every item keeps its own cap, ledger lease and cap stop, and a cap stop is never retried. tbv-held keeps its capy-drop cap rule (its recorded cap minus capyCap). tbv-held-p3's cap is recorded in the approvals line before its lease. Its command is still not settled at this build (the scorer pin post) and lands keyless-tested with P's pin post before stage 3.
- **Held-out source B.** The Captain's same message asks for option 3 (more held-out source A) as well only if the sizing read is marginal, central under about 25. Section 3's central is about 178, so it is not.

**The line's projected all-in**, from the stage 2 handoff's figures:

| Part | At caps | At projected spend |
|---|---|---|
| Crew so far (finished tbv threads at 604,995.85 credits, plus this thread counted at 44,000) | $649.00 | $649.00 |
| Crew to come (the handoff's $202, less the $47 P7 fix now counted above) | $155.00 | $155.00 |
| Settled (tbv-author and tbv-hr) | $109.41 | $109.41 |
| tbv-dev-base | $149.00 | $117.53 |
| Three climbs | $234.00 | $166.98 |
| tbv-held | $486.00 | $410.47 |
| tbv-held-p3 | $174.00 | $139.16 |
| Runner host | $20.00 | $20.00 |
| tbv-author's remaining cap, for held-out source B keys | $136.61 | $136.61 |
| **All-in** | **$2,113.02** | **$1,904.16** |

The crew rows are high on purpose: this thread is counted at its 100M token stop, and the $40 stage 2 thread estimate inside crew to come counts it a second time.

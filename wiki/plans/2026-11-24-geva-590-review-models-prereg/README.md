---
id: 2026-11-24-geva-590-review-models-prereg
kind: plan
title: "Preregistration: does a gstack /review pass catch more real bugs per dollar with Opus 5.5 and GPT-6.2 Sol, or with Fable 5.2 and GPT-6.2 Astra? A 2x2 of main reviewer by second-model voice, with a plain review beside it"
summary: "Main reviewer {Opus 5.5, Fable 5.2} x voice {6.2 Sol, 6.2 Astra} plus plain Opus on 100 real outside bugs; Carbon judge; decides review models on net value at $25 a catch."
author: GEVA-590
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-24
status: open
links:
  - https://github.com/garrytan/gstack/tree/284214fd896f493471b1bb5e98bcdc899a87bcdb
  - https://github.com/garrytan/g-harness-evals/tree/74f0de63dc86728486538d907d8184ff721e05a1/docs/benchmarks/2026-11-review-real-bugs
  - 2026-11-15-geva-538-skill-pack-h2h-prereg
  - 2026-11-19-geva-561-cso-advisories-prereg
  - lanes/review-noloss/
  - src/trial/review/
attachments:
  - aaac7061ee366ec270e29c6edf67abc90e149ef010defa499cf0cbde26d49692  power-rows.txt
  - 50de7721b34fbf60898ba46c15130d84650eb1ca22c8724d339e581e94e5e4b4  power-sim.txt
---

# Preregistration: is a review pass better with Opus 5.5 and Sol, or with Fable 5.2 and Astra?

## In short

Garry asked on 2026-11-24: "Can you do some evals to see if review passes are better as opus and sol or fable and astra?" A gstack /review pass has two model choices. The main reviewer is the Claude Code session that runs /review, its specialist subagents, its red team and its adversarial subagent. The second-model voice is the Codex pass /review calls on another model family. This eval crosses the two: main reviewer Opus 5.5 or Fable 5.2, voice GPT-6.2 Sol or GPT-6.2 Astra, plus a plain Opus review with no gstack. It runs them on 100 real bugs from other people's repositories, each with a later real fix, and 15 clean PRs.

Fable costs about 2.5 times Opus per review and Astra about 4 times Sol, so the question that changes a decision is whether the gain pays for the cost. At the factory's rule of about $25 per extra catch (R38), Fable must catch about 30 more bugs per 100 and Astra about 18 more. The eval is sized to settle that, and it can't see gains of a few points: its smallest detectable main effect is about 9 to 10 points.

Nothing measured yet says what the voice adds. In Harness Evals' review-real-bugs eval the voice ran in none of 178 /review passes, because its image could not start Codex's sandbox.

## Approval

The Captain (GEVA-2) approved the staged design on 2026-11-24 ("A: the staged design at 100 bugs") and is taking the line to Garry. This post approves no spend. No paid call runs until this post merges, Garry approves the line, and the Captain records each ledger item's cap in its approvals file. If Garry names a value per catch other than $25, a dated pre-run change replaces $25 everywhere below before the pilot.

## 1. Question

Per review of one change that holds one real bug: does the final /review report name that bug more often, and is the gain worth its cost at $25 per extra catch, when the main reviewer is Fable 5.2 instead of Opus 5.5, and when the voice is GPT-6.2 Astra instead of GPT-6.2 Sol?

What each choice controls today:

- gstack can't pick the main reviewer. /review runs on the Claude Code session's model, and no Review Army dispatch sets a model, so the specialists inherit it (review/sections/review-army.md at the pin).
- gstack picks the voice: GSTACK_CODEX_MODEL, then Codex's config.toml, then its shipped default, which is gpt-6-astra (scripts/resolve-codex-generation-model.ts line 16 at the pin), not Sol.
- The factory picks both for Capy threads: Opus unless one more catch is worth about $25 (R38), and Sol as the voice by config.

The eval does not test the shipped gpt-6-astra default, /ship's review steps (which dispatch readers by a different plan) or the Codex host. The claims say so.

## Decision

Net value per unit for a contrast B against A = $25 x (B's catch minus A's) minus (B's cost minus A's). "Pays" means the 95% interval of mean net value is above 0; "doesn't pay" means its one-sided upper bound (section 8) is below 0; anything else is "unsettled". Each unit holds one known bug, so the cost per extra catch here is a floor: on real PRs, most of which hold no such bug, it is higher.

| Outcome | What we do |
|---|---|
| Neither Fable nor Astra pays (the expected result) | Factory keeps Opus and Sol for review; R38's Fable line gains a review row with the measured cost per extra catch. GStack Minder gets the case to ship gpt-6.2-sol as gstack's default voice in place of gpt-6-astra, with this eval's limit (it tested 6.2 Astra, not 6 Astra) stated. |
| Fable catches more (two-sided interval above 0) but doesn't pay | R38 stands. Its record gains "Fable finds N more real bugs per 100 at $X each", and Garry hears it in plain words so he can say if a review catch is worth more than a coding solve. |
| Fable pays | R38 gains a review exception: /ship's review and high-stakes /review run in a Fable session. gstack's docs recommend Fable for review sessions, with the cost. |
| Astra pays and Fable doesn't (the voice matters, the main reviewer doesn't) | Factory voice moves to GPT-6.2 Astra; GStack Minder gets the case to ship gpt-6.2-astra as the default voice; the main reviewer stays Opus. |
| Astra catches more but doesn't pay | Factory keeps Sol; GStack Minder gets the case for Sol as the default, with Astra's measured gain stated beside its cost. |
| Both pay | The best net-value cell is recommended for review sessions in the factory and gstack's docs; defaults change only in the cell whose false blockers and wall time are within the limits in section 5. |
| Only Fable with Astra pays (an interaction) | gstack documents an opt-in deep-review setting (Fable session, Astra voice); defaults stay. |
| Fable or Astra catches fewer (interval below 0) | That model is named as worse for review; the factory stays on, and gstack's default moves to, the cheaper one. |
| Unsettled | No change. The result is printed with its interval and MDD and gets one Why-null cycle (R48), never read as "no effect". |
| Fable leaves at the pilot (section 7) | Reported as "can't pay at $25 a catch, by cost alone", with the measured cost ratio; R38 gains that row; the interaction and both-pay rows are not tested, and the results page says so. |
| An arm fails its pilot | Fixed and re-piloted once, or left out under R111 and reported as left out. |

The plain-Opus arm (N) is reported against every gstack cell beside these rows. It decides nothing here: it shows what /review adds at the same time and on the same bugs (R44).

## 2. Units

Every unit is a real change with a later real fix, from a repository gstack's crews did not write.

**P: Harness Evals' outside units.** The review-real-bugs suite (g-harness-evals at 74f0de63dc, docs/benchmarks/2026-11-review-real-bugs/results/suite/review-real-bugs-2026-11.json) lists 101 outside bug units (102 known bugs, 99 PR clusters, 42 repositories): S1 caught by a human reviewer (22), S2 caught by a review tool (73: 47 mixed-vendor, 25 OpenAI-model, 1 Google-model), S3 escaped and fixed by a later PR (6). Harness Evals ran 54 of them. The unit is the PR at its head against its base; the bug is the reviewer's comment (or the later fix PR) and the commit that fixed the named lines.

**B: security bug-introducing commits.** From the skill-pack head-to-head's security frame (wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/b2-frame.json): advisories published from 2026-07-01, one advisory per repository in a seeded order (draw seed 1872089902). For each, SZZ on the fix (git blame -w at the fix's parent of every non-trivial deleted line, or the lines beside an insertion): the BIC is the commit blamed for the most lines. The unit is the BIC as a PR on its own parent; the bug is the advisory and its fix.

**Gates, in order, for both pools:**
1. The fix commit's author and committer dates are both on or after 2026-07-01, and no public disclosure of the bug (advisory, issue or PR comment naming it) predates 2026-07-01. Every model under test has a June 2026 or earlier cutoff (Opus 5.5 and Fable 5.2 June 2026 on Anthropic's pages; GPT-6.2 Sol 2026-06-01; GPT-6.2 Astra 2026-05-18).
2. B only: the BIC has one parent, is not the initial commit, carries at least half the blamed lines, and changes at most 2,000 lines with at least 1 non-test source line.
3. Visibility read (B only, paid, in the supply item): Claude Opus 5.5 and GPT-6.2 Astra each read the advisory, the fix and the BIC diff and answer whether the BIC introduces the advisory's defect in lines it adds. A unit stays only when both say yes.
4. Containment: the unit tree carries no .git history past the base, no CLAUDE.md, AGENTS.md or .claude/, and no file holding the advisory id, a CVE id, the fix commit's first 12 hex characters or the suite's answer files.
5. At most 3 units per repository.

**Supply counted keyless on 2026-11-24.** P: 101 before gate 1, whose dates are checked at build. B: of a seeded 80 repositories, 80 blamed, 79 single-parent and not initial, 48 carry half the blamed lines, 37 at most 2,000 lines, 17 with fixes dated on or after 2026-07-01. That projects to about 64 over the frame's 303 repositories, and 40 to 50 after the visibility read.

**Counted set.** 100 bug units: every P unit that passes the gates in suite rank order, then B units in draw order to reach 100. Floor: 80; below 80 the run does not start and comes back to the Captain. Plus P's 15 decoys (merged PRs whose added lines no commit touched for 90 days), scored only for false alarms. Harness Evals' 20 home-field units are not run.

New B units' answer keys (the BIC to advisory map) stay out of this repo until the run ends; the frame itself is already public.

## 3. Arms

| Arm | Main reviewer (Claude Code 2.1.314) | Voice (Codex CLI 0.170.0, called by gstack) |
|---|---|---|
| OS | claude-opus-5-5 | gpt-6.2-sol |
| OA | claude-opus-5-5 | gpt-6.2-astra |
| FS | claude-fable-5-2 | gpt-6.2-sol |
| FA | claude-fable-5-2 | gpt-6.2-astra |
| N, no gstack (R44) | claude-opus-5-5, plain review prompt | none |

- gstack at 284214fd896f493471b1bb5e98bcdc899a87bcdb (v1.103.2.0), installed the way the review-units rig installs it, never changed during the run. /review's told line is Harness Evals' told-review.txt (no fixes, no edits, report findings).
- The voice runs exactly as review/sections/adversarial.md calls it at the pin: the Codex adversarial challenge on every diff, and the Codex structured review on diffs of 200 lines or more, codex exec at effort high, skills off. gstack's command also asks for web_search "cached"; the metering proxy refuses any request carrying a hosted tool (src/runner/pricing/prices.ts, the hosted-tool rule), so the run branch makes the proxy remove that one tool from the voice's requests and record each removal, instead of refusing the request. The voice therefore runs without web search, in every cell alike. The cell's voice model is written to Codex's config.toml model, which gstack's resolver reads. In the trial container Codex's own sandbox can't start, so the rig sets GSTACK_CODEX_NO_SANDBOX=1, gstack's documented setting for a container that is itself the sandbox (the rig's existing codexNoSandbox option). Any file the voice writes is caught by the rig's dirty-tree check and the review is flagged.
- The main reviewer runs on the Claude host, because the Codex host strips Review Army (scripts/resolvers/review-army.ts, generateReviewArmy).
- Each model at its Claude Code or Codex default, recorded per session (Fable 5.2's vendor default effort is high). This is a comparison of configurations as shipped, and the results page says so.
- CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm. Claude Code runs with the rig's default tools, which disallow WebSearch and WebFetch (src/adapters/claude-code/driver.ts, DISALLOWED_TOOLS), in every arm.
- N: "Review the change on this branch against its base. List every bug you find with its file, line and severity." No gstack, no drive, no Codex; clean by construction in its container, with a read audit reported after the run.
- One review per unit per arm, in an order seeded by order seed 1795598571 that interleaves arms within each unit.

## 4. Scores

**Primary: names the real bug.** A review scores 1 when any finding in its final report (native findings and the voice's section) names the unit's known bug, at any severity, as Gemini 4 Carbon rules against the real fix. Any severity, because voices rate differently: Sol marked 82% of its /review findings CRITICAL in Harness Evals' stage 2.

**The judge.** One text-only call per review: the bug's evidence and the fix diff, then the review's findings as a numbered list with model names and arm cues removed. One ruling per finding: names the bug, doesn't, or can't tell. The review scores 1 when any finding names it. Can't tell counts as not naming it, with a second reading that counts it as naming. Route: openrouter/google/gemini-4-carbon pinned to google-vertex as src/runner/pricing/prices.ts pins it, default effort, through the batch path where it exists. An empty or cut-off reply is retried once, then ruled can't tell and counted per arm.

**Why no code-decided primary.** /review writes findings, not tests. Scoring by #358's catch rule (a left-behind test fails before the fix, passes after it, and fails after a harmless edit) would mean telling /review to write tests, which changes the procedure under test, and P units have no fail-to-pass oracle. A judge-free check runs beside the judge instead: a location hit is a finding that cites a file and a line within 3 lines of the real fix's changed hunks. It is a secondary, and its agreement with the judge is printed.

**Secondaries, all paired by unit:**
- Blocking catch: the matching finding is CRITICAL under gstack's own rule at the pin (Critical, High, P0, P1 or Blocks: yes), printed beside each voice's CRITICAL share.
- False alarms: blocking findings per decoy PR (judge-free), and blocking findings per bug unit that match no known bug (descriptive; some are real other bugs).
- Dollars per review, per caught bug and per extra catch, from the proxy's metered list prices.
- Wall time per review.
- Where catches come from: the voice's own section scored alone, and the native findings alone.
- Exposure (section 6).

Limits that gate a default change in the "both pay" row: the cell's blocking findings per decoy PR exceed OS's by less than 0.5, and its median wall time is under twice OS's.

## 5. Contamination

Search is off on both hosts, the same in every arm: Claude Code's WebSearch and WebFetch are disallowed by the rig, and the voice's hosted web search is removed by the proxy (section 3). The container reaches nothing but the proxy. So a review can't look up the fix, the advisory or the suite's public answer files. This is a limit as well as a guard: gstack's voice as shipped can search, and this eval tests it without that.

Every search is still logged and read:

- Every attempted search is extracted per review: a Claude Code WebSearch or WebFetch call (refused), the proxy's record of each web_search tool it removed, and any search or fetch through Bash or Codex shell commands (curl, wget, gh, git fetch or clone to a remote), with its query or URL.
- A review is contaminated when any search or fetch reached content that names the unit's PR or fix PR, the fix commit, the advisory or CVE id, or the review-real-bugs suite or its answer files (g-harness-evals, harness-evals). With search off this should never happen; if one does, a blind second read (Opus 5.5 for OpenAI voice searches, GPT-6.2 Astra for Claude searches) decides doubtful cases from the logged text only.
- A contaminated review is a gap: the primary is scored with it dropped and with it scored as a miss, and both readings print. An arm with more than 10% contaminated reviews reads "untested" for any contrast it is in.
- Counts of attempted searches, removed web_search tools and contaminated reviews print per arm.

## 6. Exposure: did each arm run its procedure?

From the session record and gstack's own logs, per gstack arm:

- Review Army: the specialists gstack's selection prints for that diff were dispatched and returned (none on diffs under 50 lines except State Machines when selected), and the red team ran where the plan calls for it.
- The Claude adversarial subagent returned.
- The voice: OUTSIDE_STATUS: completed for the adversarial challenge, with CODEX_MODEL naming the cell's model and the model confirmed in Codex's own events; on diffs of 200 lines or more, the structured review completed too.
- The voice's prompt file is hashed and its token use recorded, so a difference in what the main reviewer handed the voice is visible.

A review is exposed when all of these hold. Exposure prints per arm beside every result; an arm under 90% in the counted run reads "untested" for its contrasts, never "no effect".

## Pilots

The pilot runs 10 bug units that the counted run never uses (5 from P that Harness Evals never ran, 5 from B) and 1 decoy, every arm once: 55 reviews. Budget below is each arm's counted cap; the pilot cap is at most a tenth of it.

| Arm | Budget | Pilot cap | Part ran | Judge check | Supply |
|---|---|---|---|---|---|
| OS, Opus with Sol | $1,208 | $120 | section 6's exposure holds in at least 9 of 10 bug-unit reviews, with Codex events showing gpt-6.2-sol | all 11 pilot reviews labelled; Carbon makes at most 2 errors on this arm | 10 units build, run and parse at 5 at once |
| OA, Opus with Astra | $2,243 | $224 | exposure in at least 9 of 10, with Codex events showing gpt-6.2-astra | all 11 labelled; at most 2 judge errors on this arm | the same 10 units |
| FS, Fable with Sol | $3,105 | $310 | exposure in at least 9 of 10, with the session and every specialist on claude-fable-5-2 and Codex on gpt-6.2-sol | all 11 labelled; at most 2 judge errors on this arm | the same 10 units |
| FA, Fable with Astra | $4,140 | $414 | exposure in at least 9 of 10, Fable session and specialists, Codex on gpt-6.2-astra | all 11 labelled; at most 2 judge errors on this arm | the same 10 units |
| N, plain Opus, no gstack | $115 | $11 | the read audit finds no gstack file and no drive path in its sessions | all 11 labelled; at most 2 judge errors on this arm | the same 10 units |

Before the pilot, a keyless check on the rig (no paid call) shows for each cell that Claude Code resolves the cell's model for the session and for subagents, gstack's probe prints the cell's CODEX_MODEL, both Codex calls would fire on a 200-line toy diff, and every cell's session key differs.

The pilot also measures each arm's cost per review and wall time, which feed the staged rule in section 7.

## Judge check

Judge: openrouter/google/gemini-4-carbon scores anthropic/claude-opus-5-5, anthropic/claude-fable-5-2, openai/gpt-6.2-sol, openai/gpt-6.2-astra
Labelled outputs: 120
Kappa at least: 0.6
Errors read: per arm

The 120 labelled reviews are fresh, at least 20 per arm: the pilot's 55 plus counted reviews drawn in seeded order before any score is read. Two labellers read each review fix-aware and blind to arm: Claude Opus 5.5 and GPT-6.2 Astra, both from families under test, so both are shown normalised reports with model names, voice headers and severity vocabulary mapped to one set. Disagreements go to a blind adjudication read by both labellers with each other's reasons, and stay in the check with the adjudicated label; nothing is dropped for disagreeing. Carbon's kappa against those labels must be at least 0.6 pooled, with its errors, abstentions and empty replies printed per arm and per pool (P, B). No counted number is read before the check passes. If it fails, the judge brief gets one revision on the labelled set and one re-check; a second failure leaves the primary unreported and the location hit printed alone as description.

## 7. The staged rule (frozen before the pilot)

The counted set (section 2) is drawn before the pilot, so its share of P and B units is known. After the pilot, for the main reviewer only:

- Cost gap = the pilot's lower 95% bound on (Fable cell cost minus Opus cell cost) per review, paired by unit and voice.
- Headroom = the counted set's P share times (100% minus the Clopper-Pearson lower 95% bound of the Opus catch rate on P units, from Harness Evals' 54 Opus /review units pooled with the pilot's OS and OA reviews on P units), plus its B share times (100% minus the same bound on the pilot's OS and OA reviews on B units alone). B has no history and few pilot reviews, so its bound is low and its headroom large; the rule never takes a rate from P to stand for B.
- If cost gap / $25 is greater than that headroom, Fable can't pay even by catching every bug left in the counted set. FS and FA leave the counted run, and the outcome is the "Fable leaves at the pilot" row. With an all-P set and today's figures that happens when Fable costs about 2.85 times Opus per review or more; with B units in the set it needs a larger ratio.
- The voice is never dropped this way: its break-even (about 18 points) sits inside any plausible headroom.

## 8. Analysis

- Main effect of the main reviewer = mean over units of (FS + FA)/2 minus (OS + OA)/2; of the voice, (OA + FA)/2 minus (OS + FS)/2. After Fable leaves, the voice contrast is OA minus OS.
- 95% intervals by bootstrap clustered by PR for P and by repository for B, 10,000 draws, seed 20261124.
- Catches more: two-sided, Holm over the two main effects.
- Pays or doesn't: the paired net value per unit, with one-sided bounds at z 1.655 at the end and z 2.797 at the look (see Interim look), which hold each contrast's one-sided error at 5% across both looks. The two contrasts are separate decisions with separate actions (the factory's main reviewer, and the voice), so each is tested at its own 5% with no Holm step; the chance that at least one of the two reads "doesn't pay" when both are exactly at break-even is up to about 10%, and the results page says so. Cost and catch come from the same units, so their uncertainty is joint.
- The package (FA minus OS) and the interaction are secondary, printed with intervals.
- Strata P and B print beside the pooled result; S2-openai units (found by OpenAI-model tools) print apart for the voice contrast.
- Gaps: a review that ends on a provider or infrastructure error reruns once; a second failure is a gap, scored dropped and as a miss. A provider safety stop is its own outcome (R95) and is never moved to another model.

## 9. Power and MDD

Simulated in power-sim.txt; every row is in power-rows.txt. Each bug has its own catch chance, drawn from a beta with concentration 0.5, plus a per-arm, per-bug logit wobble of 2.0, both fitted to Harness Evals' per-pass stage 1 data (HARN-154: 54 outside bugs, /review and plain on Opus 5.5, 2 passes each). The fit matches pass-to-pass disagreement within an arm (11% and 13% observed), disagreement across arms (23%) and the spread of per-bug differences (SD 0.39). It comes from /review against a plain prompt, which differ more than two models running the same /review, so it is likely conservative here.

| Reading at 100 bug units | Result |
|---|---|
| MDD, main effects, catches more (80% power, Holm) | 8.7 to 10.2 points (P-like pool to P+B mix) |
| MDD, Opus-only voice pair after Fable leaves | 11.8 to 14.3 points |
| Fable doesn't pay, true gain up to 10 points | power 1.00 |
| Astra doesn't pay, full 2x2, true gain 0, 5 and 7 points | power 0.99, 0.90 and 0.78 to 0.80 |
| Astra doesn't pay, Opus-only pair, true gain 0, 5 and 7 points | power 0.94 to 0.95, 0.74 to 0.76 and 0.62 to 0.66 |
| Floor, 80 bug units: MDD, main effects | 9.5 to 11.9 points |

So this run can settle the per-dollar calls and can't tell a gain of a few points from nothing. A 5-point MDD would need about 400 bug units, which we don't have.

## Interim look

Planned paid spend: $5,819
At: half the counted bug units, rounded down, in seeded order (50 of 100; 40 at the 80-unit floor), with the decoys run alongside; the look sits at an information fraction of 0.5 whatever the size of the counted set
Stop bounds: futility only, per contrast; a contrast's cells that no other contrast needs stop when its paired net value's upper bound at z 2.797 is below 0; the final test uses z 1.655, so the one-sided error over both looks is 5%; there is no early stop for a gain
Other looks: none

## 10. Harness: what the run branch builds

All on the run branch, before the pilot, each with a test:

1. Per-cell voices: src/arms/cells.ts maps only claude-opus-5-5 to gpt-6.1-sol today (line 47). The run branch adds the four cells' voice models and the policy entries for claude-fable-5-2 (policy/models.json lists only claude-fable-5-1, smoke only) and the two 6.2 voices, with the keyless cell check in section 6.
2. The proxy's removal of the voice's hosted web_search tool, with a record per removal (the hosted-tool refusal stays for every other tool and caller), and the search extraction and contamination rule (section 5), each tested on planted requests and session records; a keyless preflight shows a gstack voice request passes the proxy with the tool removed.
3. The B-unit builder: SZZ, gates, containment, and the unit as a PR on the BIC's parent.
4. The Carbon judge call, the location hit and the scorer, in shared tested modules.
5. The staged rule and the look, as code that reads the ledger's cost rows.

## 11. Money

Fable 5.2's price, from Anthropic's pricing page (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-24): $8 input, $40 output, $10 a five-minute cache write, $0.20 a cache hit, per million tokens; this PR adds the row. Opus 5.5 is $4, $20, $5 and $0.20, so Fable costs twice as much per token except cache hits. Carbon is priced at its 2026-12-01 rate ($4 input, $20 output), double today's.

Per review, central (cap is the per-session ceiling the ledger holds):

| Part | Central | Cap | Basis |
|---|---|---|---|
| Opus /review, native | $5.00 | $7.50 | Harness Evals measured $4.13 to $4.49 at gstack 1.99 with no voice |
| Fable /review, native | $12.50 | $24.00 | 2.5 times Opus (2.42 to 2.80 measured on coding); cap 3.2 times |
| Sol voice | $1.50 | $3.00 | a plain Sol review session cost $1.15 to $1.31 |
| Astra voice | $6.00 | $12.00 | 4 times Sol's token price at equal tokens |
| Plain Opus | $0.60 | $1.00 | $0.54 measured |

Cells: OS $6.50, OA $11.00, FS $14.00, FA $18.50, N $0.60.

| Item | Full run, central | Full run, cap | If Fable leaves, central | If Fable leaves, cap |
|---|---|---|---|---|
| Supply: B visibility reads | $40 | $60 | $40 | $60 |
| Pilot: 11 units, every arm | $557 | $1,034 | $557 | $1,034 |
| Counted: 115 units | $5,819 | $10,810 | $2,082 | $3,565 |
| Retry reserve, 10% of counted | $582 | $1,081 | $208 | $357 |
| Codex model probes | $20 | $40 | $20 | $40 |
| Judge: Carbon, all reviews | $50 | $100 | $35 | $70 |
| Labels and adjudication: 120 reviews | $110 | $200 | $110 | $200 |
| Ubicloud run host | $200 | $400 | $120 | $250 |
| Crew threads to merge, run and results | $230 | $300 | $180 | $250 |
| **All-in** | **$7,608** | **$14,025** | **$3,352** | **$5,826** |

The full path passes the $5,000 heads-up line (R42), so the Captain takes it to Garry before any counted cell runs on that path.

## 12. What could change this plan

Only a dated pre-run change merged before the pilot: Garry's value per catch, a Codex version that can run the 6.2 models if 0.170.0 can't, or a unit gate that the keyless build shows is wrong. Nothing changes after the first paid call except through a deviation recorded with its reason.

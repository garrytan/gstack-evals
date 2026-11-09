---
id: 2026-11-03-geva-236-waste-baseline
kind: finding
title: "Deterministic re-runs at a pushed head are 0.07% of measured ship-check time in the gstack-evals crew sessions, but review rounds past the cap have no measured time, so the waste kill rule is not shown"
summary: "A counts-only baseline with no paid calls: pushed-head re-runs are 0.07% of ship-check time (upper bound 0.56%), but review rounds past the cap have no measured time, so the kill rule is not shown."
author: GEVA-236
model: anthropic/claude-opus-5-5
date: 2026-11-03
status: done
links:
  - 2026-11-03-geva-220-waste-floor
  - src/waste/README.md
  - GST-1114
---

# Deterministic re-runs at a pushed head are 0.07% of measured ship-check time in the gstack-evals crew sessions (upper bound 0.56%), but review rounds past the cap have no measured time, so the waste kill rule is not shown

Publication status: unpublished; posting is Garry's. Done: the reader runs, the session scan, the head validation and this file. Still blocking a post: the /ship review recorded in the PR, a cross-family claim check, and a rerun by another crew.

| Field | Value |
|---|---|
| Grade | Exploratory. A counts-only baseline from one reader at a pinned commit, on a partial set of sessions. No paid calls. |
| Repo commit | 96431bb065775ba145a46b36729675e905294452 (main after #182). Every reading below comes from `bin/gstack-evals waste` at this commit. |
| Prereg | None. The readings and the 10% trigger come from 2026-11-03-geva-220-waste-floor, written before this scan. |
| Data | The reader's JSON outputs, counts and digests only, kept outside the repo. threads output sha256 3f7d26a55354ee06343384aeebf3cf52afbfef35c6e9751ef7e8fb536b0ec49b; receipts output sha256 72f2229caf5164ac9ce3b6a87287d0bd4dc4412695b5c35871bee4ef5cb666e7. Per-session export digests are listed below. |
| Reviewed by | /ship review of this file, recorded in the PR's receipt. The cross-family claim check is pending. |
| Reproduced by | Pending: another crew, from a clean machine |

## What we found

The kill rule in 2026-11-03-geva-220-waste-floor asks one question: are deterministic re-runs at a tree CI already ran, plus review rounds past the cap, 10% or more of measured ship-check wall clock? In the gstack-evals crew sessions we could read, the re-run part is far under 10%. The review-round part has no measured wall time, so this baseline can't answer the question.

- **Primary reading:** pushed_head_checks.ms / ship_checks.ms = 1,629 / 2,476,601 = **0.07%**. One check, out of 366 ship checks, ran at a pushed head with nothing changed since.
- **Head-validated primary reading:** also 1,629 / 2,476,601 = **0.07%**. All 22 pushes in the scanned sessions reached a real PR head, and the one counted check follows a confirmed push.
- **Upper bound:** (pushed_head_checks.ms + r1_ship_checks.ms) / ship_checks.ms = (1,629 + 12,228) / 2,476,601 = **0.56%**.
- **R1 side by side**, each over ship_checks.ms. Lenient R1 (r1.ms), the one the upper bound uses through its ship-check part (r1_ship_checks, 19 calls, 12,228 ms): 133,642 ms, **5.40%**, 33 calls, 9 of them approx_calls. Strict R1 (r1_strict.ms), the floor: 14,151 ms, **0.57%**, 9 calls, 0 approx_calls.

Neither pair straddles 10%. Lenient and strict R1 both sit under it, and so do the primary reading and the upper bound.

**Trigger verdict.** Not shown either way. Review rounds past the cap enter as counts only, below: 3 in prs mode and 9 in receipts mode. Their wall time is not measured: the reviewers ran in subagents, and the per-PR panel times are estimates. So the numerator above lacks them. On the same ship-check total, about 234 s of headroom is left under 10% after the upper bound, and nothing here says whether those rounds took more or less. Their counts also cover all 20 sampled PRs, while the ship-check total covers the sessions of 9.

So the kill rule is not shown to apply. The paid ship-task suite's start trigger does not fire either, because the baseline doesn't show 10% or more, so no paid suite starts. Whether the waste line of work stops waits on a measure of review-round wall time. The other trigger needs a model and arm cell at a 10% waste share or more, with a model contrast whose 95% interval excludes 0. This baseline compares no models, so it can't meet that trigger.

For the six other crew repos, the kill-rule reading is not measured. Their local gates record wall time only as estimates or not at all, so there is no measured ship-check wall clock to divide by.

## How it works

This is an explanation, not a result. A deterministic check run at a head CI also runs tells the crew nothing CI won't. The reader counts such a check when it follows a successful push or an opened PR on the same machine, after the same `cd`, with no tree boundary since, and the check itself changes nothing. Ship-check time is the summed `durationMs` of every check and every bash call that runs a gstack- program.

In these sessions nearly every check ran before a push, or on a tree that changed after one: 1 of 366 ship checks ran at a pushed head. Of 22 pushes, 18 went through `gstack-pregate sealed`, which runs its checks before it pushes.

## Setup

- **Reader.** `gstack-evals waste` at main 96431bb, in three modes: prs (per-PR replay data), receipts (/ship receipts in PR bodies) and threads (Capy session exports). Its rules and limits are in src/waste/README.md.
- **Source (a), seven crew repos.** The cross-repo replay's per-PR files: 220 merged PRs in the sample, 20 to 60 per repo. Private repos appear only by label: r-02e030 is gstack-evals, and r-5b35e9, r-6c22f6, r-9738df, r-e6882d, r-e72f35 and r-f20ed0 are the other six. Labels were minted from random bytes.
- **R5 from receipts.** The bodies of the 20 sampled gstack-evals PRs, #139 to #163, from the public repo.
- **Source (b), gstack-evals crew sessions.** 9 of the 20 sampled PRs name a thread: #146 GEVA-177, #144 GEVA-185, #145 GEVA-186, #152 GEVA-194, #151 GEVA-192, #155 GEVA-197, #157 GEVA-198, #158 GEVA-202 and #163 GEVA-206. The other 11 name none. Each root thread and each reachable subagent was exported as its own session with the program in src/waste/README.md. The exports were deleted after the scan.
- **Coverage.** All 9 root sessions, and 19 of the 65 subagent sessions those threads list: GEVA-177 2 of 5, GEVA-185 has none, GEVA-186 2 of 16, GEVA-192 1 of 5, GEVA-194 1 of 3, GEVA-197 0 of 10, GEVA-198 1 of 10, GEVA-202 12 of 14, GEVA-206 0 of 2. A subagent session could be read only where its session id appeared in a transcript we had already read. The subagent and thread reads we used give no such id.
- **Head validation.** A scratch analysis, not committed, walked each session the way the reader's scanSession does, using its readExport and bashTraits. It checked every push against the PR's real heads: a commit sha in the push result, the next ls-remote listing in the session's own results, and the PR's commits from the public GitHub API. It then recounted pushed_head_checks keeping only checks after a confirmed push.
- **Date.** The scan ran on 2026-11-03 UTC over sessions that had already ended.

## Result

### Session scan, gstack-evals (label r-02e030)

| Sessions | Ship checks (calls) | ship_checks.ms | pushed_head_checks | r1_ship_checks | Lenient R1 | Strict R1 |
|---|---|---|---|---|---|---|
| 9 roots | 73 | 1,897,586 | 1 call, 1,629 ms (0.09%) | 0 calls | 4 calls, 107,333 ms (5.66%), 0 approx | 1 call, 1,266 ms (0.07%), 0 approx |
| 19 subagents | 293 | 579,015 | 0 calls | 19 calls, 12,228 ms, 9 approx | 29 calls, 26,309 ms (4.54%), 9 approx | 8 calls, 12,885 ms (2.23%), 0 approx |
| All 28 | 366 | 2,476,601 | 1 call, 1,629 ms (0.07%) | 19 calls, 12,228 ms, 9 approx | 33 calls, 133,642 ms (5.40%), 9 approx | 9 calls, 14,151 ms (0.57%), 0 approx |

Shares are over the same row's ship_checks.ms. Within the subagent row alone, the upper bound is 2.11% and the primary reading 0%.

Other totals for all 28 sessions: 6,195 tool calls with 11,153,412 ms of call time, 1,821 bash calls (176 unreadable because the export cut their input), 654 cut results, 109 checks (2,172,684 ms), 19 background checks (they report only their start), 142 informative re-runs, 563 R4a repeated polls (128,800 ms), and in R4b 10 sleep calls, 39 waits (20 timers asking for 10,555 s in all) and 51 sleep sites in program code.

**One model.** The sessions hold 171 assistant messages: 132 from Opus 5.5 (77.2%), 36 from Gemini 4 Argon (21.1%) and 3 from GPT-6.1 Sol (1.8%). Every non-Opus message comes from 7 GEVA-202 subagent sessions on calibration work. Those sessions ran no ship check, and they hold 3 of the R1 calls (1,243 ms, counted in both lenient and strict). All 366 ship checks ran in sessions that used Opus 5.5 alone. So the ship work here is one model, and the post compares none.

### Head validation

| Check | Count |
|---|---|
| Pushes in the scanned sessions | 22 (17 in roots, 5 in subagents; 18 through gstack-pregate, 4 plain git push) |
| Confirmed | 22: 5 by a sha in the push result that is a PR commit; 10 by the next ls-remote in the session's own results listing a PR commit (9 of them a head not listed before the push); 7 by a commit on the session's PR timed within 20 minutes before the push |
| Refuted | 0 |
| Unknown | 0 |
| pushed_head_checks, reader | 1 call, 1,629 ms |
| pushed_head_checks, after a confirmed push only | 1 call, 1,629 ms (it follows a push confirmed by ls-remote) |

The 7 time-matched confirmations are the weakest of the three routes. None of them is the push before the counted check.

### Open notes on pushed-head scope (#177, #182)

| Note | Sessions touched | What the counts show | Head-validated minus reader |
|---|---|---|---|
| 1. Directory scope comes only from the last `cd` (crewlog.ts line 358), so `git -C`, an absolute path or `pushd` records an empty directory | 1 (a GEVA-192 subagent) | 0 pushes and 1 check use those forms. No check after a push lost its match to a scope difference, and no two empty scopes matched; the counted check has a `cd` on both sides. Neither effect shows. | 0 |
| 2. A cut or non-object `pr_create` input opens no pushed head (#182) | 9 (every root) | 9 pr_create calls, all 9 cut in the export, so none opened a pushed head. Had each opened a primary scope, 0 more checks would have counted. | 0 |
| 3. The push guard trusts is_error alone | 0 | 0 failed pushes. All 22 pushes are marked is_error false, and all 22 reached a PR head. | 0 |
| 4a. `heads: []` inflates per-head ratios (prs mode) | none | 0 of the 220 sampled PRs has empty or missing heads, in all seven files. | not applicable |
| 4b. Empty exports are accepted | none | 0 of 28 exports is empty; the smallest has 9 items. | not applicable |

Note 2's rule makes pushed_head_checks err low, which moves the primary reading toward the kill. Here it moved it by nothing: no check would have counted.

### R5, review rounds past the cap of 2, gstack-evals

| Source | PRs with rounds | Rounds | Rounds past the cap | PRs past the cap | Passes | Passes past the cap |
|---|---|---|---|---|---|---|
| prs mode (the replay's curated loop counts) | 20 | 39 | 3 | 3 | 33 | 0 |
| receipts mode (the /ship receipts in the 20 PR bodies) | 20 | 45 | 9 | 6 | 33 | 0 |

The two differ, so we report both. Receipts give rounds by count as 1: 4 PRs, 2: 10, 3: 4, 4: 1, 5: 1, and no body lacks a receipt.

### Per repo, source (a)

Wall time for every local gate is an estimate or missing in all seven repos, so the reader prints wall_min null for each, and the kill-rule reading is not measured outside the gstack-evals sessions.

| Label | PRs | Local gate runs | pushed_head_checks | Rounds past the cap | Passes per head | Platform review runs per head | CI reruns | Red heads | Heads, jobs not measured | Catches by first gate | Escapes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| r-02e030 (gstack-evals) | 20 | pregate 20; ship_preflight not measured | 1 (1,629 ms, sessions above) | 3 on 3 of 20 PRs | 0.46 | not measured | 6 | 3 | 0 | 35: capy_review 17, ship_panel 17, pregate 1 | 0 |
| r-5b35e9 | 60 | pregate 36; ship_preflight 32 | not measured | 38 on 10 of 31 PRs | 0.37 | 0 | 1,762 | 93 | 0 | 97: ship_panel 61, crew_review 20, ci 16 | 1 |
| r-6c22f6 | 20 | pregate 20; ship_preflight 18 | not measured | not measured | not measured | 0 | 0 | 0 | 0 | 50: ship_panel 48, paid_screen 2 | 0 |
| r-9738df | 40 | pregate 37; ship_preflight 37; ubicloud_verify 9 | not measured | 45 on 17 of 37 PRs (passes past the cap: 1 on 1 PR) | 0.59 | not measured | 2 | 16 | 0 | 49: ship_panel 40, ci 3, other_review 3, pregate 1, paid_screen 1, local_probe 1 | 1 |
| r-e6882d | 20 | pregate 20; ship_preflight 19 | not measured | not measured | not measured | 0 | 0 | 2 | 0 | 47: ship_panel 45, ci 2 | 0 |
| r-e72f35 | 40 | pregate 38; ship_preflight 34 | not measured | not measured | not measured | 1 | 70 | 8 | 0 | 49: ship_panel 26, capy_review 13, ci 5, cold_read 5 | 4 |
| r-f20ed0 | 20 | train_gate 20; pregate and ship_preflight not measured | not measured | not measured | not measured | not measured | 2 | 1 | 0 | 4: train_gate 2, ci 1, ship_panel 1 | 1 |

Counted catches total 331 across the seven repos, the replay's figure. Escapes, catches marked strict false and catches outside the window are left out of that total and counted apart.

### Per-session export digests (sha256)

| Session | sha256 | Items | Calls | Ship checks |
|---|---|---|---|---|
| GEVA-177 root | c03525dc732a3142230af08a0dfb185a4f569df8292af51c3a88dab4435187d5 | 169 | 324 | 12 |
| GEVA-185 root | b64879373585db8ba581dc702ad1ad475ba5e63f48cca227a89f3e919967ed8b | 57 | 168 | 9 |
| GEVA-186 root | d1e9797018147cbaef0193f765279b28e6af079523afd7f3c231eb30a0a3a71f | 104 | 207 | 10 |
| GEVA-192 root | 2322e00aff93442a3464297472c7b46ba47b90e00d190c8130686d47de25c0f2 | 144 | 188 | 6 |
| GEVA-194 root | 3f101e2930977ef4fa134cf52a56e9b7b8e190da71e4dc519ff5a349eda05633 | 109 | 214 | 4 |
| GEVA-197 root | 610239c361e2d3f1c46703331c414df5425cadd8c345748ca797b86012a31d36 | 82 | 183 | 13 |
| GEVA-198 root | 9790a0e8bf6e664f089a4ce75d7a15bb09d0ecc0eab96d638f2fa20ffff4acfd | 89 | 189 | 10 |
| GEVA-202 root | 9d10dc08eeb739024ecc5f4c7d89b0e3f7cf50b6fbd4ad67291fc3a85c425262 | 130 | 743 | 7 |
| GEVA-206 root | 56a0c9fd254aed697552732f1018173aaef14660bac9327ae73b6285d2a77b72 | 97 | 217 | 2 |
| GEVA-177 subagent | 251fbffbac7eb0d7b5e915aecd15fad1b99b0155b9c75c41d75505667b238c6f | 32 | 125 | 15 |
| GEVA-177 subagent | bf18279c5c8fcef4c0d6ac6480822d1194b35740f39facc8d400b7a3f3f8f81a | 26 | 61 | 6 |
| GEVA-186 subagent | 399ebdc9d86adb41f4a59412b9ec03796b8230c6ad82ac03a485bb2748f400d5 | 74 | 228 | 47 |
| GEVA-186 subagent | 00f06e033b171184e82164f4871fbe6d6562e769c2e9f9c2f638ef4d6fb6dbe8 | 63 | 219 | 24 |
| GEVA-192 subagent | 82a6655dcbe913d8ede1693bc7870b831ac63cabaad990e835deae4fbc4bc8b7 | 50 | 151 | 60 |
| GEVA-194 subagent | bf3be8f10a14025c668b14c67d50356f82a4125fb317bf0818776beff000858c | 65 | 219 | 65 |
| GEVA-198 subagent | f349dce2555777d57d6a0e26aef7fb1fe8ae2cfae3352299acf6e3d6de82dcbf | 62 | 135 | 12 |
| GEVA-202 subagent | 33414d8b3d925be703d45f776505bced92e5b4112d1061a5bb8c8aa9cac099b1 | 9 | 131 | 0 |
| GEVA-202 subagent | 1677c8caa157342d44c51df67f088e125ad59fe48b84d49dcaf4c8d415033fa6 | 10 | 181 | 0 |
| GEVA-202 subagent | b9fc703bf9fbd95c55503820ba9b6839ea26efc6fe2beecb8fd5b8f40247a5c3 | 53 | 363 | 0 |
| GEVA-202 subagent | ead341a81b136bce7a35f815fbd7b172ceef93435417b2e21a0e1b901a783a2f | 34 | 242 | 0 |
| GEVA-202 subagent | ddc62f1c9b522c1cb534f06164980fcfb039a6db66c9357d60e2ba11561c6dc8 | 51 | 91 | 19 |
| GEVA-202 subagent | f790bf168ac13224dfc33ffa45f012d47f36a01f76a7a80a9fe43692ce6373c5 | 203 | 194 | 0 |
| GEVA-202 subagent | 1e92c5ac481b8990fc972f531fd5c01f4828867200ce182cca446da4319fcbd1 | 201 | 189 | 0 |
| GEVA-202 subagent | 78fcf90c6468f0a4896d549f90a366993061e3b6284ceeee512b65a8f3f562a1 | 101 | 102 | 0 |
| GEVA-202 subagent | 4a77c03f6a4527a15322593ba09d932b31605de9db943737de244487ce3e0eeb | 90 | 846 | 0 |
| GEVA-202 subagent | 877e1082f9be1747dbe431ad22826b01359b3d4e04b5f5d7197b06db6817f4d4 | 32 | 125 | 40 |
| GEVA-202 subagent | cc157d30ae71b1092c890ee7aba7a5b7f90df6e75538d79e1b158743fd485477 | 22 | 40 | 5 |
| GEVA-202 subagent | f5bddb139a37341f5c658f3d3d1d83cd8ba5a0c673412e63a3625d57b6b53746 | 65 | 120 | 0 |

## Why null? (R48)

- **Exposure.** Every scanned PR shipped through gstack /ship, and the sessions ran its pregate and preflight: 366 ship checks. The behavior the kill rule counts had room to happen, and it happened once.
- **Task fit.** Fair for the question asked. These are real multi-hour ship pipelines, the place 2026-11-03-geva-220-waste-floor said the waste would show. Coverage is the weak point: 19 of 65 subagent sessions and 9 of 20 sampled PRs.
- **Power and floor.** This baseline is a count, with no contrast and no interval. The primary reading is 0.07% and the upper bound 0.56%, far under the 10% line. To reach 10% on the same ship-check total, pushed-head checks would need about 246 s more call time. The unread subagent sessions can't be bounded from here.
- **Frontier competence.** One model, Opus 5.5, ran every ship check. Nothing here compares models.
- **Verdict: FIX-METHOD** (a measurement gap). The re-run reading stands as measured, but the kill rule's other part, review rounds past the cap, has counts and no wall time, so the method can't read the rule yet. Next step: measure or bound the wall time of the rounds past the cap, then read the kill rule. No paid ship-task suite starts meanwhile, because its start trigger needs a measured 10% or more. This is not a CUT-CANDIDATE for any gstack skill, because no skill is tested here. What would settle it: a measured review-round time that keeps the combined share under 10% (the kill rule applies) or puts it at 10% or more (the start trigger fires). A read of the unread subagent sessions could also move the re-run part.

## Limits and threats

- **Coverage.** 46 of the 65 subagent sessions could not be read, and no subagent of GEVA-197 or GEVA-206 was reached. Most /ship work ran in subagents. The 11 sampled PRs that name no thread are not in the session scan at all.
- **Call time, not elapsed time.** Calls made inside one program can overlap, background checks report only their start (19 here), and model time, waits and reader work in unread sessions are left out.
- **R1 is a lower bound.** It misses re-runs that differ only in timing lines (those land in informative re-runs), and script runners, cp and the like count as tree boundaries. 9 of the 33 lenient R1 calls compare cut results, so they are approximate.
- **Cut exports.** 176 bash calls had their input cut and count as boundaries, and all 9 pr_create inputs were cut. Both make pushed_head_checks err low.
- **Head validation.** The analysis is a scratch script, not the reader. 7 of its 22 confirmations rest on commit time alone.
- **R5.** The two sources disagree (3 against 9 rounds past the cap), and their wall time is not measured.
- **Other repos.** Their local gate wall times are estimates or missing, so their kill-rule reading is not measured.

## Replicate it

The reader ran at main 96431bb, from a checkout with `bun install --frozen-lockfile` done. These commands ran, and the lines below are what they printed (the JSON fields shown, counts only).

```
bin/gstack-evals waste prs --label <label> <replay data dir>/<repo file>.json > out/prs-<label>.json      # once per repo, seven labels
  r-02e030: "catches":{"counted":35,"by_first_gate":{"capy_review":17,"ship_panel":17,"pregate":1},"escapes":0,...}
            "review":{"prs_with_rounds":20,"rounds":39,"rounds_past_cap":3,"prs_rounds_past_cap":3,"passes":33,"passes_per_head":0.46,...}
  counted catches over the seven outputs: 331

gh pr view <n> --repo garrytan/gstack-evals --json body -q .body > bodies/<n>.md                         # the 20 sampled PRs, #139 to #163
bin/gstack-evals waste receipts --label r-02e030 bodies/*.md > out/receipts-r-02e030.json
  "files":20,"no_receipt":0,"passes":33,"rounds":45,"rounds_past_cap":9,"prs_rounds_past_cap":6,"rounds_by_count":{"1":4,"2":10,"3":4,"4":1,"5":1}

bin/gstack-evals waste threads --label r-02e030 exports/*.jsonl > out/threads-r-02e030.json             # 28 exports; also run on roots and subagents apart
  "totals":{"items":2224,"calls":6195,"call_ms":11153412,"bash_calls":1821,"unreadable_bash":176,"cut_results":654,
    "models":{"anthropic/claude-opus-5-5":132,"google/gemini-4-argon":36,"openai/gpt-6.1-sol":3},
    "checks":{"calls":109,"ms":2172684},"background_checks":19,"ship_checks":{"calls":366,"ms":2476601},
    "pushed_head_checks":{"calls":1,"ms":1629},"r1":{"calls":33,"ms":133642,"approx_calls":9},
    "r1_ship_checks":{"calls":19,"ms":12228,"approx_calls":9},"r1_strict":{"calls":9,"ms":14151,"approx_calls":0},
    "informative_reruns":142,"r4a":{"calls":563,"ms":128800,"approx_calls":5},...}

rm -rf exports && test ! -e exports
  (no output; exit 0)
```

That record leaves out the session export and the head validation: both ran over private Capy sessions, and the scratch head-validation script is not published.

## What is held out, and why

Nothing held out is read here. The inputs are private crew sessions and private per-PR data, so only counts, labels and sha256 digests leave them. The session exports were deleted after the scan.

## Changelog

- 2026-11-03: first version.

<details>
<summary>Agent notes</summary>

**Cost**

Paid model calls: $0. The session scan, the head validation and this draft used 9.1M host tokens (2,923 Capy credits, about $2.92) in one Opus 5.5 subagent. The lead's review of the draft before this post's /ship used about 3.8M host tokens (about 1,200 credits, about $1.20). The reader fix this rests on (#182) and its /ship are counted with that PR. Prices: Capy credits at about $1 per 1,000, as of 2026-11-03. No provider tokens were bought.

From the summary: A $0 counts-only baseline: pushed-head re-runs are 0.07% of ship-check time (upper bound 0.56%), but review rounds past the cap have no measured time, so the kill rule is not shown.

| Grade | Exploratory. A counts-only baseline from one reader at a pinned commit, on a partial set of sessions. Paid calls: $0. |

</details>

## Disclosures

gstack is Garry Tan's own project.

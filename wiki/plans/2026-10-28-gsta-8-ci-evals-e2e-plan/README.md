---
id: 2026-10-28-gsta-8-ci-evals-e2e-plan
kind: plan
title: gstack-evals CI, evals in CI and end-to-end tests, plan v5
summary: Units U19 to U22 on U1's CI. Sealed check on every PR, gstack's merge train, Docker tier and keyless lease admission for paid runs, nightly drift check, gstack requests. Approved at gate_rev 3.
author: GSTA-8
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-10-28
status: done
source: Captain drive handoffs/GSTA-8/plan.md (sha256 31977c9709f54b812fe465057da6586d8f4b5490ac2d3bca5c1f1efddeea139d), with two private repo crew names replaced by a neutral label and the closing Review record heading pointed at the attachments. review-record.md is the public autoplan export (sha256 cdb3846d60ed5ab4be1315604b444bf47cf8a3d3ee8ac7f8e8f8d81499dfb5bb) and owner-brief-gate3.md the gate 3 brief (sha256 ad888c01e18b7acf86d2b133917218f6d5c384000ed48d12acb25fc459132709), both with em dashes replaced by hyphens and the brief's run path replaced by <run-dir>.
links: [wiki/plans/2026-10-28-gsta-3-gstack-evals-v1-plan-v3-2, wiki/plans/2026-10-28-gsta-3-v1-build-breakdown.md, wiki/board/2026-10-28-gsta-8-ci-plan-approved.md]
attachments:
  - 12b85bcf2b44f2c6f68f17e758019abdecdeaea1fcdf55cf9dd5fa93545170a1  review-record.md
  - 519328e7abfa12cf93ca173dd72024bfda94c36efe008e5aa643d1906d1e9ebe  owner-brief-gate3.md
---
# gstack-evals CI, evals in CI and end-to-end tests

Plan v5, 2026-10-28. Author GSTA-8 for the gstack-evals Captain (GSTA-2), working for Garry Tan. A companion to GSTA-3's plan v3.2 (approved at gate_rev 4, reply "Rec") and its build breakdown (units U1 to U18). It adds units U19 to U22 for the merge train, rig proof and the gstack-facing checks, stacked on U1's CI (PR #3). It re-decides nothing v3.2 decided (lanes, arms, ladder, parity, sealed sources), rewrites nothing U1 owns, and cites Amendment A2's rules as v1.1. Inputs: gstack-evals at 828fc22 and U1's PR #3; gstack v1.91.295.0; GSTA-3's plan, breakdown, interface v0.4 and A2; the callers' requirements; gbrain's harness-check; five crews' harness-codify lists.

## Implementation plan

### Before → after

Before (2026-10-28): CI runs typecheck, unit tests and the wiki check, keyless. U1 (thread GSTA-9, PR #3) adds the errors-doc check, a sealed pregate config and owns ci.yml and .gstack/pregate.json. The sealed guard runs only inside /ship. Nothing runs the rig's Docker tests in CI, gates a paid run on rig proof, or merges PRs in trains; the Captain merges by hand.

After:
- Every PR runs gstack-pregate sealed in CI, so sealed or held-out content fails before review (U19a).
- PRs reach main through gstack's merge train (U19): one keyless gate per train of up to 4 READY PRs, a tree check per slot, a /ship receipt per exact head.
- Rig changes run a Docker tier, and every program-funded paid run passes a keyless admission at its ledger lease (U20).
- A nightly job checks gstack-evals against gstack's newest tag and main, and an interface registry protects what callers code against (U21).
- gstack keeps its own CI. The crews' recurring gstack issues map to gstack's free tests, and gstack's /ship is asked to bind a diet's verdict to its tree (U22).
- No model key sits in GitHub. Paid work runs from Capy threads through the program ledger.

### Why it matters

- v3.2's numbers rest on properties that fail silently (egress only to the proxy, honest metering, graders the agent cannot edit). A broken rig still prints numbers, and the first published numbers spend from 11-16.
- Garry asked for a ship gate before main and a queue that tests PRs together; gstack ships both.
- Four crews will code against Lane A's interface, and the crews keep filing the same gstack failures.

### What caused this work

- Garry, 2026-10-28: "Start thinking about CI evals and e2e tests", "Take the Gstack requirements the other captains have", "Autoplan and eli5 plan for approval", "Ship gate before merge to main"; on merging, "You're the captain use a merge queue you manage and run tests in concert so you can speed up bulk merge back to back when you have a queue." and "Merge on green."
- The Captain: align the plan to GSTA-3's build breakdown as new units on U1's CI, map each end-to-end test to its unit, leave A2's rules to v1.1, and add a PR CI step for gstack-pregate sealed, a gap U1's review flagged (gstack-evals#3).
- This run's two CEO and two Eng rounds (Opus 5.5 and gpt-6.1-sol); v2 to v5 apply the findings judged real.

### Big decisions

Three are Garry's. Each paid run still needs its cap in the ledger with his words.

1. gstack's PR CI. Keep v3.2's line: gstack-evals runs no job in gstack's PR CI in v1.0. It reaches gstack through the nightly drift check (U21), a diet-binding request for gstack's /ship (decision 2) and free-test requests (U22) (rec). Or a keyless gstack-evals check on every gstack PR, which needs a read token for this private repo in gstack's secrets, pin bumps and a warning week. Flips when gstack-evals is public and nightly breaks prove too slow; then a SHA-pinned reusable workflow with no token.
2. The diet receipt. gstack's /ship and /write-skill (GStack Minder's code) ask for it only on a PR that declares a diet or cut, or removes a contract line listed in the skill's committed lock. Generated shared files such as the rendered preamble do not trigger it. The diet lane runs the eval; a NOT_MEASURABLE verdict (write-skill has 2 tasks, under Lane A's floor of 5 informative tasks) records a waiver with its reason code, and an exit 1 still shows as a loss. Advisory until the warning data shows no deadlock (rec). Or a blocking receipt on every edit to a covered skill, which turns each fix into a paid run (about $60 on Opus 5.5) and can never pass for write-skill. Flips if GStack Minder wants other edits covered once run volume and caller caps are agreed.
3. Rig proof before money. Admission sits at the ledger lease (U4), the one boundary Lane A, the replay lane, direct-API arms and judge calibration all cross. ledger init --item takes an explicit --admission required|warn, recorded with the owner's words in the item's write-once file; a required item's lease refuses with E_RIG_UNPROVEN unless a matching admission record exists; a warn item, such as a caller's own Lane A run, gets a warning, and U2's preregistration check refuses a program preregistration whose item is not required. The record holds the proof set the preregistration names: for arms in src/trial (U11, the agentic arms of U16 and U18, counted runs), a green Docker tier at the run's commit and recipe plus the keyless probes on the machine that spends; for direct-API runs and judge calibration, a green ci.yml at the commit plus the replay lane's fake-upstream tests. Admission is keyless and adds no spend; the run's own calibration, already paid for, is bound into its receipt (rec). Or rig proof for counted runs only, with a weekly paid smoke under a standing $25 a month. Flips if U20 has not merged its first PR by 11-14; the Captain then asks Garry whether U11 and U16 wait or run without it.

Defaults the Captain or GStack Minder owns, with flip conditions:
- Merge flow: gstack's train, settled by Garry's "use a merge queue you manage" and "Merge on green". Flips to the hand procedure if the dry runs hit a gap gstack cannot close in a week.
- Versions: VERSION and CHANGELOG.md change only in a release PR, as the breakdown says, and trains merge unstamped heads. Flips to a stamp at each slot if the dry run refuses unstamped pins.
- wiki/INDEX.md becomes generated and gitignored, since every wiki PR rewrites it and two in one train would conflict. Flips if Garry wants a one-page index on GitHub; then wiki PRs ride one per train.
- Rig proof binds to a recipe hash, not an image digest, because builds on GitHub runners and Ubicloud shards do not share a digest. Flips if the program sets up a private registry.
- The interface registry warns until interface v0.1 is tagged after M1b's first-crew test, then blocks.

### Scope and non-goals

In: U19 to U21 in gstack-evals and U22's requests to gstack. Not in: anything v3.2 decides; any job in gstack's PR CI; gstack's workflow files and free tests; U1's ci.yml beyond a dispatch trigger; A2's rules, which apply from v1.1; counted runs and their caps; repo code in this thread. Deferred: a recurring real-model eval of gstack. After U11 prices Lane A, U17's pilot report asks Garry for a per-release Lane A canary (for example /learn on Haiku 5.5, newest gstack tag against the previous one) under its own preregistration and cap; nothing is built or spent before he approves.

### What U1 to U10 already prove

This plan runs the breakdown's tests in the right tier and adds only what is missing. U1's rule stands: later tests are picked up by `bun test` without editing ci.yml.

| # | Proves | Owned by (keyless) | New here |
|---|---|---|---|
| R1 | Oracle passes, nop fails | U9: 12 contract tasks, oracle and broken transcript | none |
| R2 | Calibration trips each CALIBRATION code | U10 | the run's real calibration is bound into its receipt (U20) |
| R3 | Skill-opened signal per host | U10: calls[] | a same-named file elsewhere or a listing with no read must not count (asked of U10) |
| R4 | Metering equals usage | U3 | export reconcile (U20) |
| R5 | Egress lock | U3, U9 | from a trial only the model proxy answers, not IP, DNS, host gateway or the management socket (U20) |
| R6 | Sealed store unreadable from a trial | none | no sealed mount, key variable or history past the base; no workflow names the sealed key (U20) |
| R7 | Graders the agent cannot change | U9, U5 (VACUOUS_CHECK) | none |
| R8 | Ledger, cap stop, resume | U4, U10, U13 | none |

Other keyless tests (U2, U5, U6, U7, U13) stay where the breakdown puts them. A keyless canary match is dropped: v3.2's manifest commits only an HMAC of each canary, and its "no raw canary in any manifest" test stays.

### U19a. Sealed check and train workflows (M0, first PR)

- sealed.yml, on every pull_request: gstack pinned by full commit SHA (61e201ec08bc, v1.91.295.0, in a comment) runs gstack-pregate sealed --range <base sha>..<head sha> (origin/main..HEAD) against the base branch's .gstack/pregate.json, running no repo code. U1's sealed config sets visibility public, so any finding exits 1 and fails CI before review. It backs up the pre-push check and cannot unpublish a pushed commit, so a failure is an incident: close the PR, delete the branch, burn the named held-out items (digests recorded as burned) and write a wiki finding with counts and digests only. Stage m0 runs it again on each train's range.
- train-gate.yml, exactly as gstack 1.91.295.0 reads it: run-name "train-gate [eval-bg <nonce>]"; inputs evals_all, expected_sha, nonce, cases and prefix_shas; a route step modeled on gstack's scripts/train-gate.ts that checks expected_sha, the bisect cases and prefix ancestry, and takes the train's base as the first parent of the "train T1: merge #<pr>" commit, so a scratch-base dry run works. A read-only test job (persist-credentials: false) runs `bun run gate` and writes a TrainGateRecord (schema 1, kind train-gate, nonce, head_sha, tree, verdict, census, one panel per case with status PASS, FAIL, SKIPPED or INFRA and red_class VERDICT or INFRA) on every completed run, and one BisectPrefixRecord per prefix on a bisect. A separate publish job with checks: write runs the train base's code on that artifact and posts gstack-evals/full-gate only for a complete green census.
- gate/manifest.json, read from the train's base: command cases judged by exit code (m0: typecheck, bun test, wiki:check, errors-doc, sealed) and named JUnit cases (the hygiene test; U20 adds m1b, the Docker tier) where scripts/gate.ts marks a skipped or absent case FAIL with red_class VERDICT. It declares gate_surface (workflows, gate/, scripts/gate.ts, tests/ci/, .gstack/, package.json); the publish job refuses a green census when a multi-PR train touches it, and for a solo surface PR the Captain also runs the base's gate code on the train head.
- ci.yml gains workflow_dispatch, its only edit (U1 already set permissions to contents: read and runs bun test). A hygiene test checks actions pinned to SHAs, read-only permissions except two named jobs (train-gate's publish job, nightly's issue job), no secret but GITHUB_TOKEN, and ci.yml's and rig.yml's steps matching the manifest.
- Done means: a PR adding a file under heldout/ fails sealed.yml; route tests pass with the base equal to and different from the default branch; on a scratch base carrying U19b's policy, a green two-PR train merges two unstamped pins with no stamp step, a seeded red case is attributed by its prefix records, a seeded unit-test failure gives QUEUE_TRAIN_FREE_RED and the recovery below finds the PR, and a dispatch failure rebuilds.
- Files: .github/workflows/sealed.yml, .github/workflows/train-gate.yml, gate/manifest.json, scripts/gate.ts, package.json (gate script), tests/ci/, ci.yml (on: only).
- Merges by hand after U1, because GitHub dispatches only workflows already on the default branch.

### U19b. Ship policy and the wiki index (M0, second PR)

- .gstack/ship-policy.json, read from the base revision only:

```json
{ "bump": "patch", "queue_mode": "stamp-at-merge", "history": "squash-ok", "changelog": null,
  "gate_command": "bun run gate", "full_e2e": false, "review_scope": "frozen",
  "min_gstack_version": "1.91.295.0", "maintainers": ["garrytan"],
  "train": { "gate_workflow": "train-gate.yml", "free_workflow": "ci.yml",
    "full_gate_check": "gstack-evals/full-gate", "record_artifact": "gstack-evals-train-record",
    "max_size": 4, "fill_hours": 1, "screen_selection": "none", "trial_reservation_usd": 0.01 } }
```

  With changelog null the train never re-heads CHANGELOG.md, and verify refuses any difference beyond stamp files. full_e2e stays false because every merge goes through a train whose gate is the full gate. Screens are off and the bisect reservation is the minimum, since the gate is keyless.
- INDEX.md leaves git: scripts/wiki.ts renders it in memory and prints it to the job summary; tests/wiki.test.ts, .gitignore, .gstack/generated.json (the wiki-index entry goes), AGENTS.md line 9 ("run bun run wiki:index, then read wiki/INDEX.md"), README.md's two index links, wiki/README.md and a superseding wiki post change with it.
- Merges by hand after the green and red dry runs pass.
- Both U19 PRs (the Captain's split) come from one thread that runs 10-29 beside U1 and U8 and ends by the morning of 10-30; the dry runs, merges and the merge-queue rewrite are the Captain's queue work. About 15 million tokens, against the M0 plus M1a ceiling of 150 million; the M0 tally decides whether the Captain needs a ceiling line from Garry.

**The Captain's queue after U19b** (gstack installed --for ship; the merge-queue skill is rewritten to this and keeps its Never list):
1. Lanes run /ship at the reported head, then gstack-ship-queue ready --pr <n> --no-screen, and send the READY block. CREW.md and the breakdown's ship-gate line change to match. A PR touching the gate surface rides alone with --urgent.
2. A PR joins a train only when its review at the pinned head is complete with no open findings. train build --dry-run checks receipts, conflicts and order; train build runs at 4 READY PRs or when the oldest has waited an hour; train watch follows it as a watched background operation.
3. train verdict is GREEN only for a complete census bound to the train's nonce, head and tree. Per slot, in order: verify --pr <n> --train <nonce> prints MERGE_CONDITION; gh pr merge <n> --squash --match-head-commit <sha>, never --auto; verify again.
4. A red full gate goes to train bisect. QUEUE_TRAIN_FREE_RED has no upstream bisect. On a red free run the Captain runs the m0 stage on T0 to Tk, keeps per-case results and drops a PR only on a monotone green-to-red pattern; a red T0 is a main repair, and a non-monotone or non-reproducing result reruns once, then is recorded as infra in DIGEST.md. A missing, cancelled or stale run, or a dispatch failure, rebuilds the same train.
5. verify --post-merge files no freeze, so after QUEUE_POST_MERGE_RED the Captain builds only --repair trains until main is green and records the hold in DIGEST.md.
6. Break-glass, when the train tooling itself fails: one PR at its exact head with a current receipt and a clean review, merged only after the stage's manifest runs green on a scratch merge of main and that head; verify the published tree, watch post-merge, hold if the gate cannot run, record the reason and the gstack bug and report it to Garry. The dry runs repeat only when a gstack upgrade touches the train surface (lib/ship-queue*.ts, lib/ship-policy.ts, lib/tree-receipt.ts, lib/ship-receipt.ts, scripts/eval-bg.ts, scripts/train-gate.ts).

### U20. Docker tier, admission and the stage-0 receipt (M1b)

- First PR, on U9: rig.yml runs the Docker-backed tests of U3, U9 and U10 plus the R5 and R6 probes and a test refusing unpinned installs under docker/, on PRs touching src/trial, src/adapters, src/runner, lanes, schema, docker or the lockfile, as stage m1b of train gates (about 20 minutes a train gate; the dry run measures it), on workflow_dispatch, and on main only for a tree no green train record covers. Docker tests skip unless GSTACK_EVALS_DOCKER=1, so U1's job stays fast, and the gate counts a skipped expected case as a failure. Proof is keyed by tree (commit^{tree}) plus recipeHash() from src/rig/recipe.ts: the Dockerfile, bun.lock, the FROM image's @sha256 pin, pinned host CLI versions and the adapter sha (git rev-parse HEAD:src/adapters). U9's cache key and the verdict's rig block take the same hash, with one golden test. rig.yml posts no check; admit reads the run itself (workflow path, tree, event, conclusion) and its recipe artifact, or a GREEN train record listing the tree with m1b. A pregate guard runs GSTACK_EVALS_DOCKER=1 bun test tests/rig on rig paths; remote_gate is never set.
- gstack-evals rig admit gathers the preregistration's proof set (the rig check or ci.yml at the commit, plus the probes run on the spending machine) and writes a write-once AdmissionRecord keyed by lease id, holding the machine id and host fingerprint, that U4's requireAdmission seam reads at lease time; a new lease on a new machine after reconcile writes its own. U20 fills the E_RIG_UNPROVEN code and the verdict's rig block that U1 and U6 are asked to reserve now.
- Second PR, after U10: the stage-0 receipt binds the run's own calibration result to the host fingerprint (Docker version, kernel, network mode, local image digest, host CLI version) and the recipe hash; a mismatch with the run's configuration refuses. Each results PR records the rig check URL, recipe hash and receipt in its receipts manifest.
- Metering: U20's rig reconcile reads U4's ledger and the provider's usage export (a named export schema per provider) and writes PENDING, MATCH, MISMATCH or UNRECONCILED into the receipts manifest. Where the provider offers project keys, each line item gets its own; otherwise concurrent runs on a key reconcile as a set. Token classes (input, cached, output, reasoning) are normalized and compared exactly. PENDING lasts until the export covers the run's closed window, and after 72 hours results publish labeled provisional; unsupported or insufficient evidence is UNRECONCILED, never a mismatch; a MISMATCH fails the receipts, and after provisional publication it files a superseding wiki post.
- Done means: refusal before any experimental call through each funded entry point (Lane A, a replay arm, a direct-API arm, judge calibration) when the record is missing, red or stale; a caller item warns and proceeds; the admission bit cannot change after creation; open egress, a reachable management socket, a receipt mismatch and a replaced machine each refuse.
- Files: .github/workflows/rig.yml, src/rig/, tests/rig/, docs/rig.md, one guard in .gstack/pregate.json.
- Stacking: on U9 and on U4's seam, beside U10, in the thread U7 frees, first PR by 11-14. About 20 million tokens, inside M1b's 400 million.

### U21. Interface registry, nightly drift check and receipt verify (M1b)

- Registry: schema/interface.json lists every CLI flag, reason code and verdict field, generated from U7's CLI table, U1's codes.ts and U6's verdict schema. Removing or renaming one fails, adding one needs an interface-doc line; it warns until v0.1, then blocks.
- nightly.yml: a read-only job runs U5's contract tests, U7's fake-host /learn preflight, an install-layout check (each covered skill resolves where Lane A's overlay and skill-opened detector expect) and U19a's train contract test against gstack's newest tag and main; a separate job with issues: write runs no gstack code, reads only the artifact and opens one issue per cause key.
- gstack-evals skill-eval verify --verdict <file> --before-ref <ref> --after-ref <ref> --lock <file> builds both installed trees from git with Lane A's tree hash and prints INTEGRITY: ok or mismatch with the refs (tree hashes, the lock's tasks and sidecar sha256 with post_hoc false, an allowed policy hash); it is never an approval. With --promote it exits 0 only for a schema-valid verdict with verdict PASS and exit_code 0, every model block complete, calibration passed, noninferior: true on every model under --margin and no RIG_UNPROVEN warning; NOT_MEASURABLE exits 2 with a WAIVER line and its reason code; anything else exits 1.
- Done means: a renamed flag fails after v0.1; a broken gstack fixture opens one issue; --promote refuses right hashes with SAFETY_BREAK, failed calibration, an incomplete model block or RIG_UNPROVEN, a wrong baseline or lock, and a verdict from an older head.
- Files: schema/interface.json, scripts/interface.ts, .github/workflows/nightly.yml, src/skill-eval/verify/, tests/interface/, tests/verify/.
- Stacking: one PR, on U6, U7 and U9, after U20's first PR in the same thread. About 15 million tokens.

### U22. gstack-side requests (in garrytan/gstack, through the Captain and GStack Minder)

Like U12, this is gstack work. Harness Evals, GBrain Minder, Alphaclaw and two crews on private repos tag these failures "Fix: gstack", and gstack has a test file for most (matched by name, assertions read at build): /ship's result line, receipt refusals and PR-body writes (gstack-ship-receipt, gstack-ship-queue), receipt carry (ship-receipt-carry-pregate), pregate allowlist, starter, stamp-only, removed-path and scratch-name rules (five pregate-* files), install modes (gstack-capy-install), rec bound to rec_hash (gate-list), frozen review scope (review-scope), no bare env in a fence (launch-env-echo-ratchet) and claims against receipts (ship-receipt-prose). The review-gate classifier has none.

The requests: cases where an assertion is missing; Harness Evals' three open asks (an unattended rec under a recorded standing rule, /ship refusing a PR that adds a preregistration and its results, a check run from the receipt step); the main backstop's freeze writer exposed as a queue verb; and decision 2's diet binding, calling U21's verify --promote. Behaviors that need a model go to the review replay lane's public catalog.

### Amendment A2 and v1.1

A2's release rules (one pass bit per counted release, one frozen champion per sealed result, opening counters) apply from the first sealed run in M3, and its keep rule governs the factory compare loop when it starts. Both are unreviewed, and this plan adds no CI for them now; at M3 the sealed run's admission record adds the opening counter and the frozen champion's hash. U2's test already reproduces A2's sizing rows. In M2 the Docker tier gains Lane B's fake-harness trial and R6 on the sealed runner.

### Requirements traceability

GSTA-133's contract call and /write-skill's /learn: U5 to U7 and U21's nightly. GBRA-225's noise floor, per-model verdicts, hashed preregistration and sandbox: U2, U5, U6, U9, U10 and U20. HARN-1's stable interface and reused proxy, ledger, prereg and stats: U2 to U4 and U21. GSTA-131's catalog and control arms: U13. Garry's no-Sonnet rule: U7's policy file. harness-check's cross-repo check and the crews' gstack issues: U21 and U22. Rig before money: U20. Sealed content before review (gstack-evals#3): U19a. Ship gate, queue and merge on green: U19a and U19b.

### Cost

Monthly, at about 40 gstack-evals PRs and 15 trains (estimates): ci.yml and sealed.yml about 135 runs each at 2 to 5 minutes (about 900 minutes); train-gate.yml 15 runs at about 20 minutes (300); rig.yml from M1b about 40 runs at 15 minutes (600); nightly.yml 30 runs at 15 minutes (450). GitHub bills a standard Linux runner at $0.006 a minute and includes $12 to $18 of compute a month on its Free and Pro plans, so CI runs about $14 a month before that allowance and nothing once the repo is public. Admission adds no model spend. A diet's own Lane A run is not CI spend: interface v0.4 prices it at about $60 on Opus 5.5 ($30 to $120), $2 to $4 on Haiku 5.5 and about $30 on gpt-6.1-sol, on the diet lane's own ledger. Agent work for U19 to U21 is about 50 million tokens (estimate).

### Risks

- The train refuses unstamped pins: the dry run shows it first; the fallback is a stamp at each slot.
- Two PRs changing bun.lock cannot share a train: the second merges main, regenerates the lock, reruns /ship and rides the next one.
- Docker tests flake on GitHub runners: a flaky case is quarantined with an issue, never made advisory in silence.
- U20 lands late: decision 3's flip goes to Garry on 11-14.

### Verification

- The dry-run trains' lines go in the Captain's report before the hand procedure retires.
- A fake preregistered run refuses at the lease through every funded entry point; a caller run warns.

### Open items

- To relay through the Captain now: U1 reserves E_RIG_UNPROVEN, U6 a rig block in the verdict schema, U4 the requireAdmission seam and --admission flag, U2 the preregistration check, U9 the GSTACK_EVALS_DOCKER convention and the shared recipe hash, U10 R3's negatives.
- Owner action at key setup: per-line-item provider project keys where the provider offers them.
- GBRA-225's plan file is unreadable here, and GSTA-140's evals note does not exist yet; loadout checks wait for it and for a review of A1.

## Review record

The run log is [review-record.md](review-record.md). The gate brief Garry answered is [owner-brief-gate3.md](owner-brief-gate3.md). His reply and what it approved are in the decision post 2026-10-28-gsta-8-ci-plan-approved.

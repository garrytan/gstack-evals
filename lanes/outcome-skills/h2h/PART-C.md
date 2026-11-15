# Part C as built: ordinary units, scoring, analysis and rerun

This note records how part C reads the post (wiki/plans/2026-11-15-geva-538-skill-pack-h2h-prereg/README.md) where the
post leaves a detail open. The post and its prereg.json stay the source of truth; nothing here changes a frozen value.

## Commands

All run as `bin/gstack-evals h2h <command>` (or `bun lanes/outcome-skills/h2h/cli.ts <command>`) and take --help.

- `o-frame` builds o-frame.json from the pinned MultiLang cache, the frozen licence read and the image digests.
- `draw` writes O's seeded order (--order-out) or walks O or B's gates and writes the drawn units.
- `score` scores one session record against its unit's sm-unit.v1 dir.
- `analyze` runs section 9 on one stage's units, sessions and scores.
- `readout` writes the sealed stage 1 file and prints only the release list.
- `ledger-dryrun` opens and settles one lease per item on a temporary ledger and drives the COST rule on fixtures.
- `power-table` prints section 13's table from the TypeScript port of power.py.
- `rerun` runs one arm on a unit list under a spend cap (section 12).

## O frame and draw

- Gate order: window, exclusion, licence, harness screen, told-mode screen, image digest. A drop counts at its first gate.
- The window starts at walk_back_to (2025-01-01). The seeded order walks months newest first, so March 2026 onward comes
  first and older months only when the newer ones run out.
- The exclusion list is checked on the dataset's repository name and on the name GitHub returns today, so a renamed
  repository of an excluded owner stays out.
- The licence rule is read literally: the spdxId GitHub returns must be on the permissive list. NOASSERTION (70
  repositories, 160 rows), MIT-0 and CC0-1.0 are out, even where the licence text is permissive.
- Gate results the draw reads (images, oracle, containment) come as a generic h2h-gates.v1 file, because part A's
  containment record format was not fixed when this was built. O's oracle gate reads the state machines unit dirs.
- Positions count only units that pass every gate. Stage 1 takes prereg.json's positions, stage 2 the other positions up
  to n, then the reserves, then stage 0.
- The repository cap (3) counts across B1 and B2.
- B1 takes up to half of B's n. If the B1 frame runs out, its stage 2 share shrinks so its reserves and stage 0 still
  fill. Under 20 usable B1 units, B1 is infeasible and B is B2 alone at the full n.
- Reserves replace any unit that drops after the draw and before a paid run, in reserve order; O's stage 0 bug or
  feature unit takes the first reserve with its tag.

## Scoring

- The change is extracted in a scratch git dir that reads the arm's objects through alternates and copies its HEAD,
  refs, packed refs and info/exclude. It uses its own config, so no hooks, filters or fsmonitor of the arm's run, and no
  system or global config is read. The index starts from the base commit, so the arm's index changes nothing.
- The base commit comes from --base or the session record's optional base_head field.
- tree_bundle is the session's repository directory, .git included, or a .tar, .tar.gz or .tgz of it.
- Nested worktree directories (a directory below the root holding a .git file or folder) are left out of the change
  and listed in nested_left_out, except those the ignore rules already leave out.
- The worktree secondary scores each linked worktree's working tree (or its head when the directory is not in the
  captured tree) and each branch beyond base that no worktree has checked out. worktree_pass is true when any passes,
  null when there are none, or when none passes and one was a gap.
- Arm files at a path where the fix adds a new test file are dropped before scoring and logged
  (E_H2H_SCORE_ARM_TEST_DROPPED).
- Session ends: a session gap passes through; a safety stop scores no fix; a cap stop is a gap (CAP_STOP); an upstream
  or infra end with no gap code is refused as a malformed record. A capture failure (no .git, base commit missing) is
  the gap E_H2H_SCORE_CAPTURE. The scorer retries once on E_SM_INFRA_GAP; a second is that gap.
- verified is clean_fix under the strict reading. The reading without the new-test rule counts a fix whose only breaks
  are new tests the arm added.
- Lines changed: added plus deleted lines of the strict reading, without test files, lockfiles (a frozen file-name list),
  or generated files (the state machines rule: a linguist-generated mark, or "generated" or "do not edit" in the first
  5 lines). Planning files count apart: .planning/, docs/superpowers/, SPEC.md, tasks/plan.md, tasks/todo.md and
  .gstack/ at the project root. A Rust file whose in-source test module went back to base is counted with git diff
  --numstat over its two texts.

## Analysis

- The verdict test is z = difference over Obuchowski's cluster-robust standard error, two-sided. Fewer than 2
  repositories gives p = 1. A zero variance gives p = 1 with no difference, p = 0 with one.
- A cell is incomplete when its gap share is above 10%, a missing score counting as a gap, or when it has no units. An
  incomplete contrast stays in Holm with p = 1. A contrast whose pack did not run its procedure keeps its own p in Holm.
- Row state precedence: infeasible, incomplete, run as published, not exercised, then ahead, behind or no difference.
  Infeasible applies to B1-only rows (the /qa secondary and the B1 stratum), since B is B2 alone when B1 is infeasible.
- The MDD uses the contrast's pair count, its measured discordant share and the alpha of its Holm step,
  0.05 / (12 - rank + 1), ranks taken by the p values Holm reads. "Ideas to study" are pack rows that read no
  difference with the pack ahead by at least half that MDD.
- Exposure rates are over an arm's scored sessions in the class. gstack and its one-line arm count as loaded and run on
  bug units. A session with no exposure record counts as not loaded and not run.
- Piece G: units both arms fixed, units with zero counted lines in either arm left out and counted, the mean log-ratio
  with the clustered bootstrap and a bootstrap p, Holm over the ratio and the verified difference. If ponystack's
  procedure ran in under 80% of its sessions, no less-code or more-correct claim is made.
- The section 10 rows that fire are listed by their trigger wording.

## Stage 1 readout

- The pooled rate is over the 7 primary arms' scored sessions in the class. FLOOR and CEILING count the no-skills arm's
  fixes against the literal thresholds (under 2, or 11 or more).
- INFRA lists the cells above 10% gaps. COST fires when the re-priced program at caps is above $8,881.
- The full-size flag compares each B contrast's absolute difference with the MDD at n = 80 and alpha 0.05/12 at its
  discordant share; no MDD means no flag from that contrast.
- The sealed file is JSON with an AES-256-GCM iv, tag and ciphertext in base64. The key file must be outside any git
  work tree, mode 0600, and hold 32 raw bytes or 64 hex characters. The file's sha256 prints on stderr, so stdout holds
  only the release.

## Money

- The A2 table is read from the post; its caps must add to its total.
- COST re-prices h2h-opus, h2h-qa and h2h-pony from stage 1's per-arm, per-class mean session cost; an arm and class
  with no stage 1 session keeps its planning price and is listed. A re-priced cap is 1.35 times central, rounded to the
  dollar as the A2 table rounds. The /qa item covers floor(n_B x 0.5) B1 units.
- When any arm's 95th-percentile stage 1 cost is above half the allowance, the allowance doubles to $50, and stage 1
  sessions that stopped at the allowance are priced at $50.
- The frozen n cut is the largest factor f for which floor(f x 100) O and floor(f x 60) B units fit the approved total.

## Rerun

- A real run stops before any session when spent plus one allowance would pass the cap (exit 10).
- --out defaults to h2h-rerun. RERUN_RUNNER in cli.ts is part S's session runner (sessions/rerunner.ts); with no runner
  wired a real run exits 3 with E_H2H_RERUN_UNWIRED.

## Open items

- Part S's tree_bundle format and the base commit's field are assumed (a directory or tar with .git, and base_head).
- Part A's containment record is read through the generic gates file.
- The literal NOASSERTION reading drops some repositories whose licence text is permissive; changing it needs a ruling
  and a new frame.

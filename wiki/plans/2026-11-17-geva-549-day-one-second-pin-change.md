---
id: 2026-11-17-geva-549-day-one-second-pin-change
kind: plan
title: "Day-one usefulness eval: the second pin change, on gstack's unattended second-review fix"
summary: "Re-pins A to gstack e671a531 and both strengthened arms to one commit over it, lists every skill file changed since the first pin change, and sets the new loaded-byte reference."
author: GEVA-549
model: anthropic/claude-opus-5-5
date: 2026-11-17
status: open
links:
  - 2026-11-17-geva-546-day-one-usefulness-prereg
  - 2026-11-17-geva-549-day-one-pin-change
  - lanes/day-one
  - https://github.com/garrytan/gstack/tree/e671a531f4ede3d63b3143c96903466c960aca58
  - https://github.com/garrytan/gstack/tree/a2a421ba6734a861fee93234aa9fb4373dc858d0
  - https://github.com/garrytan/gstack/tree/798782aeea7548d979878b7b559f5fc47bea2400
---

# Day-one usefulness eval: the second pin change

This is a second dated change to the day-one usefulness preregistration (2026-11-17-geva-546-day-one-usefulness-prereg). It was made on 2026-11-17, before any counted session. Smoke reps 1 and 2 ran on the first pin change's pins (2026-11-17-geva-549-day-one-pin-change), on the practice briefs, which are never counted. Rep 3 of the smoke and every counted session run on the pins below. This post replaces the first pin change's sections 1 and 3. Everything else in that post stands, including its section 7, which predates this change.

## Why the pins moved

In the smoke's three A sessions, unattended /autoplan never finished its second-model review. The run record has the exact lines:

- Two sessions marked the review unavailable, citing the owner's consent, although the config had it turned on.
- The third ran the review in the background and ended its turn, which ends a headless session.

gstack fixed this on main in pull request 4459. A moves to that commit, and both strengthened arms are rebuilt on it. All three gstack arms now carry the fix, and each strengthened arm still differs from A only by its own commit.

## 1. The pins

| Arm | gstack commit | What it is |
|---|---|---|
| A | e671a531f4ede3d63b3143c96903466c960aca58 | gstack main, at pull request 4459. |
| S-dayone | a2a421ba6734a861fee93234aa9fb4373dc858d0 | Branch day-one-arm-d1-on-e671a53: A plus one commit, "Plan reviews start with what the owner does on day one" (32 files, 306 lines added, 126 removed). |
| S-full | 798782aeea7548d979878b7b559f5fc47bea2400 | Branch day-one-arm-d2-on-e671a53: A plus one commit, "Plan reviews start with what the owner does on day one, and the CEO review drops its copy of the engineering review" (41 files, 440 lines added, 698 removed). |

gstack's VERSION file reads 1.100.0.0 at all three commits.

The first pin change stacked S-full on S-dayone. Now each strengthened branch is one commit over A. S-dayone's commit holds the day-one block. S-full's commit holds the day-one block and the CEO-review cut together. So S-dayone minus A still reads the day-one block, and S-full minus S-dayone still reads the cut, but across two branches instead of inside one commit.

My own checks, against gstack's remote and a full clone:

- `git ls-remote` shows main at e671a531 and each branch head at the commit above.
- Each branch head's only parent is e671a531.
- `git rev-list --count e671a531..<head>` is 1 for each branch, so each strengthened range holds exactly one commit.
- c5250ded, the first pin change's A, is an ancestor of e671a531, 22 commits back.

## 2. What changed between the two A pins

gstack main has 22 commits from c5250ded to e671a531. Three of them touch the planning skill folders (autoplan, plan-ceo-review, plan-design-review, plan-devex-review, plan-eng-review and plan-tune), in 17 files, with 46 lines added and 30 removed:

1. **e671a531, "Unattended /autoplan runs its configured second-model review in the foreground, and run ids no longer collide" (pull request 4459).** It changes autoplan/DRIVER.md and autoplan/sections/unattended.md.
   - A stored `codex_reviews: enabled` is now the owner's standing consent to send each phase's review input to the outside model. `gstack-autoplan next` prints `OUTSIDE_CONSENT: given by codex_reviews=enabled` beside the outside attempt.
   - The review runs in the foreground, inside the turn: `gstack-outside-voice run ... --timeout-ms 540000` with a Bash timeout of 600000. It is never run in the background, never watched by a monitor, and the turn never ends to wait for it.
   - A failure or timeout is recorded with the standard failure line, and the run carries on with the native review still counting.
   - The runner still enforces `disabled`, and an unset value is handled as before.
   - In code, lib/autoplan-run.ts prints the consent line and adds six random letters to each run id.
2. **ab114c53, "Say when to use each gstack skill in Claude Code's skill list" (pull request 4387).** It lengthens each planning skill's description in its front matter with a "Use for:" list. plan-eng-review also gets a longer description and one more trigger, "plan a feature".
3. **a141e943, "Ask each question once and check every handed-over file, in every skill that loads the shared preamble" (pull request 4383).** It adds two lines to the shared preamble: ask each question once, and open every handed-over file and remove placeholders. The preamble's id moves from d56c99c92144 to d8804c5ab6bf, which changes one line in each SKILL.md.

One more commit changes code that /autoplan runs. **169eb9c8, "Approval page re-reviews two-reviewer scope changes and checks quotes only against this repository" (pull request 4441)**, changes the gate-building code under lib/ in three ways:

- When both reviewers challenge the plan and one calls it a build-order change while the other calls it a scope change, the page treats it as a scope change.
- A plan with no "Owner's words" section gets the "confirm the direction is yours" question when both reviewers challenge it.
- A quote is checked only against this repository's approvals record.

This can change what the simulated owner sees at the gate. The other 18 commits touch no planning skill folder. Their skill-file changes are mostly the new preamble id and the longer descriptions in every other skill, plus text in /ship, /review, /sync-gbrain and /office-hours, which planning sessions do not load.

Every skill file changed in the range, from `git diff --name-only c5250ded e671a531 -- '*.md' '*.tmpl'` at gstack (200 files), grouped by folder:

<details>
<summary>200 files</summary>

- (root): CHANGELOG.md, CLAUDE.md, CONTRIBUTING.md, README.md, SKILL.md, SKILL.md.tmpl, TODOS.md
- agents-digest: gstack-AGENTS.md
- autoplan: DRIVER.md, DRIVER.md.tmpl, SKILL.md, sections/preamble.md, sections/unattended.md, sections/unattended.md.tmpl
- benchmark-models: SKILL.md
- benchmark: SKILL.md
- browse: SKILL.md
- canary: SKILL.md, sections/preamble.md
- captain: SKILL.md, SKILL.md.tmpl, sections/preamble.md, templates/CREW.md
- capy: skill/gstack/SKILL.md, skill/gstack/captain.md, skill/gstack/factory.md
- careful: SKILL.md
- changelog.d: README.md, approval-page-keeps-reviewer-product-challenges-open.md, capy-plan-a-trial-of.md, capy-run-each-driven-ship.md, capy-shell-locks-hold-when-mkdir-lies-gst-2247.md, capy-windows-setup-e2e-watches-gstack-lock.md, close-last-recheck-carry-paths.md, count-review-rounds-per-pr.md, docs-audit-blocked-line-carries-gst-2349.md, docs-audit-ignores-prose-after-result-gst-2349.md, docs-index-and-install-hooks.md, docs-release-cut-green-counts-commit-statuses.md, docs-ship-policy-approval-classes-4320.md, eval-plan-result-checks.md, fix-coverage-audit-zsh-separator.md, fix-docs-missing-anchors.md, fix-skill-prefix-renders-clawhub-docs-issue-refs.md, gstack-reports-lead-with-failures.md, guides-for-outside-fixes-and-playtests.md, land-normal-merge.md, lanes-large-file-lists-on-linux.md, never-print-secrets-shared-rule.md, office-hours-explains-mode-pick.md, pr-wait-and-ci-gate-read-every-check-attempt.md, price-runaway-wakes.md, release-notes-list-every-change.md, remove-router-bug-fix-route.md, remove-test-after-edit-stop-hook-check.md, secrets-check-code-shapes.md, ship-handoff-child-gets-its-prompt.md, stable-cut-ignores-windows-nightly.md, strip-incoming-receipt-runs.md, sync-gbrain-reports-failures.md, trunk-uploader-v2.1.8.md, ubicloud-pack-skips-refs-being-rewritten.md, ubicloud-quota-booking-full-owner.md, unattended-autoplan-runs-its-second-voice.md, update-hono-security-advisories.md, windows-nightly-fits-its-time-limit.md, write-up-checklist.md
- codex: SKILL.md, sections/preamble.md
- context-restore: SKILL.md, sections/preamble.md
- context-save: SKILL.md, sections/preamble.md
- crew: docs/captain.md, docs/recommended-harness.md
- cso: SKILL.md
- design-consultation: SKILL.md, sections/preamble.md
- design-html: SKILL.md, sections/preamble.md
- design-motion: SKILL.md, sections/preamble.md
- design-review: SKILL.md, sections/preamble.md
- design-shotgun: SKILL.md, sections/preamble.md
- deslop-shared-libs: SKILL.md
- devex-review: SKILL.md, sections/preamble.md
- diagram: SKILL.md
- docs: CONTRIBUTOR_REFERENCE.md, OPENCLAW.md, OPENCLAW_PUBLISHING.md, TESTING_INTERNALS.md, evals/ship-conductor-fold-prereg.md, gbrain-sync-errors.md, hosts.md, loadouts.md, pregate.md, releases.md, review-policy.md, ship-budget.md, ship-policy.md, skill-routing-and-contracts.md, skills.md, troubleshooting.md, voice-input.md, writing-prs.md
- document-generate: SKILL.md, sections/preamble.md
- document-release: SKILL.md, sections/preamble.md
- eval-plan: SKILL.md, sections/preamble.md
- freeze: SKILL.md
- gstack-upgrade: SKILL.md, SKILL.md.tmpl
- guard: SKILL.md
- health: SKILL.md, sections/preamble.md
- ios-clean: SKILL.md, sections/preamble.md
- ios-design-review: SKILL.md, sections/preamble.md
- ios-fix: SKILL.md, sections/preamble.md
- ios-qa: SKILL.md, sections/preamble.md
- ios-sync: SKILL.md, sections/preamble.md
- land-and-deploy: SKILL.md, sections/preamble.md
- landing-report: SKILL.md, sections/preamble.md
- learn: SKILL.md, sections/preamble.md
- make-pdf: SKILL.md
- modernize: SKILL.md, sections/preamble.md
- office-hours: SKILL.md, SKILL.md.tmpl, sections/preamble.md
- open-gstack-browser: SKILL.md
- pair-agent: SKILL.md, sections/preamble.md
- plan-ceo-review: SKILL.md, sections/preamble.md
- plan-design-review: SKILL.md, sections/preamble.md
- plan-devex-review: SKILL.md, sections/preamble.md
- plan-eng-review: SKILL.md, SKILL.md.tmpl, sections/preamble.md
- plan-tune: SKILL.md, sections/preamble.md
- qa-only: SKILL.md, sections/preamble.md
- qa: SKILL.md, sections/preamble.md
- retro: SKILL.md, sections/preamble.md
- review: SKILL.md, SKILL.md.tmpl, sections/preamble.md
- runaway-stopper: SKILL.md
- scrape: SKILL.md
- setup-browser-cookies: SKILL.md
- setup-deploy: SKILL.md, sections/preamble.md
- setup-gbrain: SKILL.md, sections/preamble.md
- ship: DRIVER.md, DRIVER.md.tmpl, SKILL.md, SKILL.md.tmpl, sections/capy-pr.md, sections/capy-pr.md.tmpl, sections/pr-body.md, sections/pr-body.md.tmpl, sections/preamble.md
- skillify: SKILL.md, sections/preamble.md
- spec: SKILL.md, sections/preamble.md
- sync-gbrain: SKILL.md, SKILL.md.tmpl, sections/preamble.md
- test-audit: SKILL.md, sections/preamble.md
- test: fixtures/golden/agy-ship-SKILL.md, fixtures/golden/claude-ship-SKILL.md, fixtures/golden/codex-ship-SKILL.md, fixtures/golden/factory-ship-SKILL.md
- ubicloud: SKILL.md, sections/preamble.md
- unfreeze: SKILL.md
- verify: SKILL.md
- write-skill: SKILL.md, sections/preamble.md

</details>

## 3. Loaded bytes: the new reference

Each figure is the size of SKILL.md plus every sections/*.md file in the skill's folder, read from gstack's git tree at the pin. This is the same method as the first pin change's section 3. I computed every figure myself, and all nine match the figures gstack's maintainers sent with the new branches.

| Skill | A (e671a531) | S-dayone (a2a421ba) | S-full (798782ae) |
|---|---|---|---|
| plan-ceo-review | 60,656 + 105,975 = 166,631 | 62,287 + 106,621 = 168,908 | 60,923 + 91,559 = 152,482 |
| plan-design-review | 56,252 + 73,928 = 130,180 | 57,789 + 75,172 = 132,961 | 57,789 + 75,172 = 132,961 |
| autoplan | 43,270 + 77,105 = 120,375 | 45,358 + 77,898 = 123,256 | 45,292 + 77,856 = 123,148 |

Each strengthened arm's difference from A is the same, byte for byte, as it was on the first pins:

- S-dayone: +2,277, +2,781 and +2,881 bytes.
- S-full: -14,149, +2,781 and +2,773 bytes.

On both strengthened arms, the day-one block ("## Day one first (before any other step)") starts at the same offsets:

| File | Block | Its table step ("1. Write a `### Day one` table") |
|---|---|---|
| plan-ceo-review/SKILL.md | byte 1,416 | byte 1,715 |
| plan-design-review/SKILL.md | byte 4,053 | byte 4,352 |
| autoplan/SKILL.md | byte 1,690 | byte 1,989 |

The blocks sit 47 to 56 bytes later than before, because the descriptions above them grew. This table is now the reference the strengthened arms stop on. A mismatch at the smoke stops both strengthened arms before they spend.

**The 18 autoplan lines, per pin.** Added 2026-11-18. S-dayone's commit adds 18 lines to autoplan/SKILL.md over A. The table counts how many of those 18 lines each pin's autoplan/SKILL.md holds, read from gstack's git tree. The SKILL.md installed in each arm's image gives the same counts, and so does the first request of a no-spend capture of `/autoplan --full plan.md` in each image.

| | A (e671a531) | S-dayone (a2a421ba) | S-full (798782ae) |
|---|---|---|---|
| Of the 18 lines, present | 0 | 18 | 17 |
| autoplan/SKILL.md sha256, first 12 hex | 1be1f29fbec9 | c1f3dc823b93 | 3f2ae726e5c6 |

S-full lacks one line: the CEO row of autoplan's required-outputs table (line 619 at 798782ae). S-full's row is S-dayone's row without "Error & Rescue and Failure Modes registries (or N/A with reason); ". That accounts for the 66 bytes between the two arms' autoplan SKILL.md figures above (45,358 and 45,292). The line is missing from gstack's source at the pin, not from the capture. S-full is tested as its maintainers wrote it, and nothing is re-pinned.

## 4. What rep 3 of the smoke must show

Rep 3 runs on day1-smoke, inside its cap, after a green rig admission at the head that spends:

- N base plans on the three practice briefs.
- A's review on all three practice briefs.
- One S-dayone session and one S-full session on the first practice brief.
- A's builds and checks on the first two briefs.

For A, S-dayone and S-full, it must show four things:

- the gate answered;
- the plan amended;
- the second-model review (GPT-6 Astra) actually run;
- the bytes of every skill file the session loaded matching section 3.

The run record reports voice-fallback counts per arm. The wave starts only when all of this holds, and a second A failure stops for a decision.

## 5. Code

lanes/day-one/frozen.ts GSTACK_PINS now sets the three pins, and PIN_CHANGE now names this post. tests/day-one/frozen.test.ts checks the pins against this post. The rig never fetches a commit, so the runner host fetches all three commits, in full, into its gstack checkout before rep 3.

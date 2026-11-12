---
id: 2026-11-12-geva-529-containment-note-correction
kind: finding
title: "Corrected containment note: about 3 in 10 SWE-rebench task images keep the answer in git, particle-1 saw it or its fix commit's id in 73 of 400 L1 sessions while Opus 5.5 almost never searched, image caches add no exposure, and no published verdict moves"
summary: "Corrects the git-history note: 108 to 110 of 345 images leak, not 144; particle-1 saw an answer or its commit id in 73 of 400 L1 sessions, not 68. Caches add no exposure. No verdict moves."
author: GEVA-529
model: anthropic/claude-opus-5-5
captain: GSTA-2
date: 2026-11-12
status: done
supersedes:
  - 2026-11-11-geva-517-git-history-leak-containment
links:
  - 2026-11-04-geva-263-r3a4-admission-results
  - 2026-11-04-geva-283-r3b-results
  - 2026-11-07-geva-380-r3c-results
  - 2026-11-06-geva-350-l1-overhaul-results
  - 2026-11-08-geva-353-l1-sol-particle-results
  - 2026-11-09-geva-431-claim-check-corrections
  - 2026-11-02-geva-128-run-t-text-tax-results
  - 2026-11-10-geva-513-run-t-text-tax-results
  - 2026-11-02-geva-184-ceremony-cut-results
  - 2026-11-10-geva-513-ceremony-cut-results
  - 2026-11-02-geva-153-run-d-discovery-results
  - 2026-11-01-geva-93-stacks-round-1-tb2-results
  - 2026-11-01-geva-105-gstack-null-review-and-tb2
  - 2026-10-30-gsta-30-laneb-quick-3-results
  - 2026-10-29-gsta-12-laneb-quick-results
  - 2026-10-29-gsta-12-laneb-quick-2-results
  - 2026-11-03-geva-220-waste-floor
---

# Corrected containment note: about 3 in 10 SWE-rebench task images keep the answer in git, particle-1 saw it or its fix commit's id in 73 of 400 L1 sessions while Opus 5.5 almost never searched, image caches add no exposure, and no published verdict moves

- We learned that a task image can hand an agent the answer in four places, and all four can be checked before any agent runs: git history past the task's starting commit, git objects that no ref points to, the working tree against HEAD, and installed packages and package caches. You should run four checks on every task image. Strip every ref past the starting commit, then prune. List every object, not only what the refs reach. Run `git diff HEAD` in a fresh container. Clear the pip, uv and conda caches, and install the package under test before the bug goes in only as an editable install.
- We learned that the gap between models is mostly about who searched. particle-1 searched all of git history in 174 of its 400 L1 sessions, GPT-6.1 Sol in 42 of 1,152 and Opus 5.5 in 8 of 2,394. Opus never surfaced an answer, but mostly because it almost never looked. You should report how often a model searched beside how often it found something.
- We learned that no published verdict moves. This note corrects counts and wording in the earlier containment note, adds a check of build and test caches, and lists what the next scan should catch. particle-1's L1 numbers still need this note beside them.

This note supersedes [the earlier containment note](2026-11-11-geva-517-git-history-leak-containment.md). It links the affected results posts and supersedes none of them: merged posts don't change, and no verdict moved, so each post stands with this note as its companion.

## What we got wrong in the earlier note

An independent claim check, run by a separate agent team that had our scan tables, image results and session logs, found the errors below. We confirmed each one, and found one more while writing this note (item 2).

1. **Fewer images leak than we said.** We wrote that 144 of the 345 images keep the fix or its hidden tests. 144 is the count of images with any history past the starting commit. Only 108 to 110 of them reach the fix or the hidden tests, about 3 in 10: 108 by our rule and 110 by the check's. The other 34 to 36 keep only old release tags that reach neither.
2. **particle-1 saw the answer or a fix commit's id in 73 of its 400 L1 sessions, not 68.** The check found that our fix-commit rule missed the fix on two equinor/ert tasks (ert-11988 and ert-12491). So we reread the 8 particle-1 sessions that searched all of history on a leaking image and weren't counted. 5 of them saw later-commit content. All four uncounted sessions on ert-12491 printed or applied a later commit that carries the fix, three before their first edit and one after its own first attempt, and all four passed. One on virtual_ecosystem-1232 printed the fix pull request's test changes before its first edit, and failed. That makes 66 of the 73 passed. All 5 are on tasks that already had an exposed session, so every clean-task number below stands. The check also found a virtual_ecosystem session we had marked as seeing only a fix commit's id that saw the fix itself, so the split is at least 68 sessions that saw the answer and 5 that saw only an id. We also reread Sol's 6 other searches on leaking images: none printed a later commit.
3. **92 images holding hidden tests is a lower bound.** Our rule looked for test names the starting commit lacks. 18 tasks change existing tests instead, so matching the hidden test text gives up to 110. Some of those 18 match on only 1 or 2 lines, so 110 is an upper reading. Every image that holds the hidden tests also holds the fix.
4. **"Frontier models left the history alone" described the result, not the cause.** Opus 5.5 found nothing mostly because it rarely searched (see the table below). Its zero does hold. The check read 20 Opus history sessions by hand, ran an independent rule over all 2,394 Opus sessions, and listed every git command in the 867 sessions its first rule didn't pick. None printed a later commit.
5. **Not every model hit the Terminal-Bench 2 leak.** We wrote that every model hit it. Our own table shows Sonnet 5.5 at 0 of 9, and Opus 5.5 at 0 of 9 in stacks round 1 and 0 of 3 in quick look 3. Opus saw it in 24 of its 40 sessions on the task overall.
6. **Sol's intervals moved, not only its point estimates.** We wrote that the Opus and Sol rows were unchanged or moved by a tenth of a point. That holds for point estimates. Sol's L1 interval goes from -3.8 to +22.5 to -3.8 to +21.5, and its R3b upper end from +3.3 to +3.4.
7. **We quoted particle-1's L1 verdict from a superseded post.** We called its B1 a KEEP. The claim check that replaced that post reads "helps (skill opens only); waiting on the audit labels". The audit's label files are lost, so the frozen script run on the published records reads B1 as FIX-METHOD (method), and reads KEEP only with the audit as the post states it. This note carries the claim check's verdict.
8. **We quoted an unadjusted p.** p 0.0005 is particle-1's unadjusted B1 p. The post's headline is Holm p 0.0009. On the same basis the 58-task reading is Holm p 0.0073, not the 0.0037 we printed.
9. **"Every rerun reproduced" claimed more than ran.** The waste floor and the review side of the gstack-null comparison weren't rerun. None of the rerun outputs is committed, so readers can't check them.

Smaller fixes:

- R3b's Sol arm ran 432 sessions, 2 of them route checks, not 430.
- R3a4's "Unchanged" is an admission count that held because both exposed Sol trials failed. It is not a rerun without the exposed tasks, as the other rows are.
- Two reruns print the same interval, -3.7 to +10.2: the ceremony cut's particle-1 cell (a 90% interval) and the Terminal-Bench 2 side of the gstack-null post (a 95% interval). We checked both outputs. Each comes from its own data on 36 tasks.
- L1's Terminal-Bench 2 B1 of +2.8 assumes that neither of that stratum's /investigate opens was on fix-code-vulnerability.

## Who searched, and who found

| Model | Sessions | Searched all of git history | Of those, on an image with later history | Saw the answer or a fix commit's id |
|---|---|---|---|---|
| particle-1 (L1) | 400 | 174 | 76 | 73 (66 passed) |
| GPT-6.1 Sol | 1,152 | 42 | 12 | 6 (all failed) |
| Opus 5.5 | 2,394 | 8 | 1 | 0 |

Of particle-1's 73, at least 68 saw the answer itself; of Sol's 6, 1 did. Opus's one search on a leaking image was on ert-12491, and it printed no later commit. A search here means a log over all refs, branches or remotes, such as `git log --all`, as our scan tables classify it.

## Build and test caches

We also checked the same 345 SWE-rebench images and 39 Terminal-Bench 2 images for caches that name hidden tests or hold the fix. No build or test cache does: go-build, pytest, `__pycache__`, cargo, node, jest, mypy, ruff, test reports and /tmp are all clean. Two package copies hold a fix. keras-22316 and keras-22330 keep a keras 3.14.1 wheel in /root/.cache/pip that carries each task's upstream fix. fix-code-vulnerability keeps the fixed bottle.py in site-packages, because `pip install .` runs before the bug is injected. No session used either copy: 0 of the 10 keras sessions opened the wheel or installed from it, and no fix-code-vulnerability session first saw the fix there.

A stricter count flags any session that first saw 2 fix lines in a file that holds them. It flags 4 Opus 5.5 R3c sessions that read library code the fix calls (astropy on sunpy-8548, hats on lsdb-1349). Without the 3 of them in R3c's grid, R3c's told minus none is +2.8 points (95% CI -5.8 to +11.5), against +2.8 (-5.8 to +11.4) published. The fourth was a calibration trial on a task the grid never used.

145 SWE-rebench images keep the dataset's instance file, which holds the hidden tests and the fix, in one layer. A later layer deletes it, so no container can read it.

## The two git leaks

### SWE-rebench task images

We checked all 345 SWE-rebench task images behind the five SWE-rebench posts, from the layers our runs pinned. The independent check ran a container per image and got the same refs and HEAD results.

- 144 images keep refs past the task's starting commit. 108 to 110 of them reach the fix or the hidden tests. The other 34 to 36 keep only old release tags.
- 92 hold the task's hidden tests in a later commit by our new-test-name rule, and up to 110 by matching the hidden test text.
- 108 have the upstream fix commit reachable by our rule, and 110 with the two equinor/ert fixes it missed.
- 335 have HEAD on the starting commit. The other 10 have HEAD on an "Environment setup changes" commit above it, with ORIG_HEAD set. None of those 10 commits holds a hidden test or the fix.
- One image, py-pdf__pdfly-219, has a non-empty `git diff HEAD`: a submodule pointer, not the fix.
- No image keeps the dataset's instance file (swebench_instance.json) in its final filesystem, and no session named it.

An earlier check of a 40-task subset found 23 images with later refs and 12 holding hidden tests. Ours gives the same counts and the same 12 tasks.

A session counts as exposed when a tool result showed a hidden test name, or fix code printed by a history command, before the agent wrote it. We call that tier A, saw the answer. A session that saw a fix commit's id, usually with its title, is tier B, saw that the answer exists.

### Terminal-Bench 2: fix-code-vulnerability

Of the 39 Terminal-Bench 2 images behind the analysed trials in these posts, 35 keep no `.git` at all. Three keep history by design: fix-git asks the agent to recover a lost commit, git-leak-recovery asks it to find a secret in history, and sanitize-git-repo's HEAD holds the secret the task asks it to remove. We also checked crack-7z-hash, which stacks round 1 started and every post dropped before analysis. Its `.git` is a clone of the password-cracking tool the task uses, with one branch and no commit outside HEAD's history.

The fourth is fix-code-vulnerability. Its HEAD commit holds bottle.py with the security fix in place, and the image build deletes four lines from the header checks in the working tree. So `git diff`, `git stash`, `git checkout` or `git show HEAD:bottle.py` prints the fix. The image also keeps the fixed file in site-packages (see Build and test caches). A session counts as exposed when either of the fix's two error messages first appears in a tool result, before the agent's own output holds it.

| Run | Exposed sessions, by model | Passed |
|---|---|---|
| Ceremony cut | Opus 5.5 9 of 9, particle-1 9 of 9 | 18 of 18 |
| Run T | particle-1 12 of 15, Haiku 5.5 13 of 15 | 30 of 30 |
| L1, Terminal-Bench 2 stratum | Opus 5.5 10 of 10 | 10 of 10 |
| Run D | Opus 5.5 5 of 9, GPT-6.1 Sol 4 of 4, particle-1 4 of 4 | 17 of 17 |
| Stacks round 1 | Opus 5.5 0 of 9, Haiku 5.5 13 of 15, particle-1 12 of 15 | 39 of 39 |
| Quick look 3 | Opus 5.5 0 of 3, Sonnet 5.5 0 of 9, Haiku 5.5 9 of 9, DeepSeek V4.1 Flash 7 of 9, particle-1 6 of 9 | 39 of 39 |
| All | 113 of 153 | 153 of 153 |

Every session on the task passed, exposed or not, so this data can't show how much the leak added. It also means dropping the task only rescales each pass-rate difference, by less than a point. Run D's skill-open rates move more, because some trials on the task opened a skill and others didn't. Haiku 5.5, Sonnet 5.5 and DeepSeek V4.1 Flash aren't models under test any more; their rows are here because the older posts reported them.

## Every affected post

Points are percentage points with 95% intervals unless the row says otherwise. Verdict words (KEEP, FIX-METHOD, CUT, LOSS) are each post's own. "Descriptive" marks a number the post's frozen rules don't turn into a verdict.

### SWE-rebench posts

"Without the exposure" means the post's frozen analysis rerun without every task an exposed session ran on.

| Post | Sessions and exposed sessions, by model (exposed that passed) | Headline as published | Without the exposure | Verdict |
|---|---|---|---|---|
| [R3a4 admission](2026-11-04-geva-263-r3a4-admission-results.md): how many tasks plain models leave unsolved | Opus 5.5: 210, 0. GPT-6.1 Sol: 210, 2 (0) | Opus left 71 of 200 tasks unsolved, Sol 81 | Unchanged, because both exposed Sol trials failed, so no task moved. This row is a count, not a rerun | Holds |
| [R3b](2026-11-04-geva-283-r3b-results.md): told /investigate minus no skill, pass rate | Opus: 430, 0. Sol: 432 (2 of them route checks), 3 (0), all on one task | Opus -0.0 (-5.2 to +5.2), FIX-METHOD (task fit). Sol +1.0 (-1.4 to +3.3), FIX-METHOD (power) | Opus unchanged. Sol +1.0 (-1.4 to +3.4) on 69 tasks, and +1.0 (-1.5 to +3.4) on 68 when the other task Sol was exposed on in R3a4 also goes | Holds |
| [R3c](2026-11-07-geva-380-r3c-results.md): told /investigate minus no skill on calibrated tasks | Opus: 1,162 (442 calibration, 720 grid), 0 | +2.8 (-5.8 to +11.4), FIX-METHOD (power) | Unchanged. The cache check's stricter count drops 3 grid sessions: +2.8 (-5.8 to +11.5), FIX-METHOD (power) | Holds |
| [L1 on Opus 5.5](2026-11-06-geva-350-l1-overhaul-results/README.md) (superseded by the claim check): B1 is the overhaul's lift in untold /investigate opens | Opus: 592 (560 grid, 32 pilot), 0 | B1 +21.3 (+12.5 to +30.0), KEEP | Unchanged | Holds |
| [L1 on Sol and particle-1](2026-11-08-geva-353-l1-sol-particle-results/README.md) (superseded by the claim check) | particle-1: 400 grid, 73 (66) on 22 of 80 tasks, at least 68 tier A and 5 tier B; and 5 of 32 pilot and smoke sessions. Sol: 512, 1 (0), tier B | particle-1 B1 +15.0 (+7.5 to +22.5), Holm p 0.0009; the claim check reads "helps (skill opens only); waiting on the audit labels". Sol B1 +8.8 (-3.8 to +22.5), not admitted | particle-1 B1 +15.5 (+6.9 to +25.9), Holm p 0.0073, on 58 tasks, descriptive: the frozen 90% task-coverage rule gives no outcome. Dropping only the 68 sessions the first scan counted: +15.0 (+6.7 to +25.0), not rerun with the 5 added sessions. Sol +8.9 (-3.8 to +21.5) on 79 tasks | Holds in direction; particle-1's numbers need this note |
| [Claim check](2026-11-09-geva-431-claim-check-corrections.md), L1 rows | As the two L1 posts | particle-1 B1 +15.0 (+7.5 to +22.5); gap to Opus -6.25 (-12.50 to -1.25) | particle-1 +15.5 (+6.9 to +25.9); gap to Opus -6.90 (-13.79 to -1.72), on 58 tasks, descriptive. Opus unchanged. Sol +8.9 (-3.8 to +21.5), was +8.8 (-3.8 to +22.5) | Holds in direction |

particle-1's other L1 readings on its 58 clean tasks, all descriptive (the frozen contrast with the coverage gate set aside), against the published 80-task figures:

- Told adherence, B3 (not admitted either way): -24.1 (-39.7 to -8.6), was -18.8 (-31.3 to -6.3).
- Untold pass rate, after the overhaul minus before: +3.4 (+0.0 to +8.6), was +0.0 (-7.5 to +7.5).
- Pass rate, the old gstack told minus no gstack: -10.3 (-20.7 to -1.7), sign-flip p 0.069, was -5.0 (-13.8 to +3.8). Untold: -6.9 (-13.8 to -1.7), sign-flip p 0.125, was -1.3 (-8.8 to +6.3).

Passes are where the leak acts. The old-gstack arms had more exposed sessions (17 told and 18 untold, against 13 for no gstack), a likely reason their pass rates fall further behind on the clean tasks. Those two intervals exclude zero only on the reduced set, which the frozen rules don't score, and neither sign-flip p is below 0.05, so they are leads, not findings.

### Terminal-Bench 2 posts

"Without the task" means the post's frozen analysis rerun with every fix-code-vulnerability trial removed, so 36 tasks instead of 37 (38 instead of 39 in quick look 3). Exposure by model is in the table above.

| Post | Headline as published | Without the task | Verdict |
|---|---|---|---|
| [Run T](2026-11-10-geva-513-run-t-text-tax-results.md), which supersedes [the first Run T post](2026-11-02-geva-128-run-t-text-tax-results/README.md) | particle-1, told placebo text minus no gstack (T1): -2.2 (-7.0 to +2.7), control 77.8%. Long text minus short (T2): -5.9 (-11.9 to +0.0), p 0.0908, no claim | T1 -2.2 (-7.2 to +2.8), control 77.2%. T2 -6.1 (-12.2 to +0.0), p 0.0915; the three-model Holm p by the post's arithmetic is about 0.275, was 0.273 | KEEP holds |
| [Ceremony cut](2026-11-10-geva-513-ceremony-cut-results.md), which supersedes [the first ceremony-cut post](2026-11-02-geva-184-ceremony-cut-results/README.md) | Opus 5.5 -5.4 (-10.8 to -0.9), Holm p 0.042, LOSS, overall FIX-METHOD. particle-1 +2.7 (90% CI -3.6 to +9.0), CUT within the 10-point margin, cost 0.703 times (0.569 to 0.874) | Opus -5.6 (-11.1 to -0.9), Holm p 0.0429, LOSS, overall FIX-METHOD. particle-1 +2.8 (90% CI -3.7 to +10.2), CUT with no loss shown, cost 0.701 times (0.564 to 0.872) | Holds |
| [L1 on Opus 5.5](2026-11-06-geva-350-l1-overhaul-results/README.md), Terminal-Bench 2 stratum | No-gstack pass rate 85.1%. Debugging-task stratum at ceiling, 10 of 10. B1 +2.7 (+0.0 to +8.1) | 84.7%. Stratum 8 of 8, still at ceiling. B1 +2.8 (+0.0 to +8.3), assuming neither open was on the task | Holds |
| [Run D](2026-11-02-geva-153-run-d-discovery-results/README.md), as corrected in [the claim check](2026-11-09-geva-431-claim-check-corrections.md) | Pooled D2, the rewritten description's lift in untold skill opens over the shipped one: +5.9 (+1.4 to +10.8), p 0.0393. Sol D1, opens with the shipped descriptions: 7 of 74 trials, 9.5% (1.4 to 18.9), "opened an untold gstack skill in 9.5%". Opus and particle-1: 0 opens | D2 +6.0 (+1.4 to +11.1), p 0.0388, on 36 tasks. Sol D1: 5 of 72, 6.9% (0.0 to 15.3); the frozen rule prints only the upper bound, "fewer than 15.3%". Sol's own D2 +18.1 (+4.2 to +33.3), was +17.6 (+4.1 to +32.4), exploratory either way. Opus and particle-1: 0 opens | D2 holds; Sol's D1 line becomes an upper bound |
| [Stacks round 1, Terminal-Bench 2](2026-11-01-geva-93-stacks-round-1-tb2-results/README.md) | gstack minus no gstack: Opus 5.5 +3 (-3 to +9), Haiku 5.5 +1 (-7 to +9), particle-1 -5 (-14 to +1). pstack wins no cell | Opus +3 (-4 to +9), Haiku +1 (-7 to +9), particle-1 -6 (-14 to +1). pstack wins no cell | Holds |
| [gstack null on Terminal-Bench 2 and review](2026-11-01-geva-105-gstack-null-review-and-tb2/README.md), Terminal-Bench 2 side (the stacks round 1 trials) | Opus 5.5 gstack minus no gstack +2.7 (-3.6 to +9.0), control 81.1%, MDD 9.1. Debugging tasks: no gstack 15 of 15, gstack 14 of 15. FIX-METHOD | +2.8 (-3.7 to +10.2), control 80.6%, MDD 9.4. Debugging tasks 12 of 12 and 11 of 12. The review side was not rerun; it has no Terminal-Bench 2 task | Holds |
| [Quick look 3](2026-10-30-gsta-30-laneb-quick-3-results/README.md) | gstack minus placebo: Sonnet 5.5 -2 (-9 to +5), particle-1 -4 (-9 to +0), DeepSeek V4.1 Flash -2 (-8 to +5), Haiku 5.5 -5 (-12 to +2). Opus 5.5 with no skill 79% | Sonnet -2 (-9 to +5), particle-1 -4 (-10 to +0), DeepSeek -2 (-8 to +5), Haiku -5 (-12 to +2). Opus 79% | Holds |
| [Quick look](2026-10-29-gsta-12-laneb-quick-results/README.md) and [quick look 2](2026-10-29-gsta-12-laneb-quick-2-results/README.md) | fix-code-vulnerability isn't among their 20 tasks | Nothing to drop | Holds |
| [Waste floor](2026-11-03-geva-220-waste-floor.md): its Terminal-Bench 2 sessions are Run D's, 17 of them on the task | 4 waste calls in 14,036, none in any no-gstack cell; the room rule fails, FIX-METHOD (floor) | Not rerun, because the scratch scanner wasn't kept. Dropping sessions can't add a waste call, so every no-gstack cell stays at 0, and the highest cell (0.38%) can't reach the 2% or 5% room rule by losing one session | Can't move |

## Method

1. **Image check.** For each task image we pulled the layers our runs pinned, unpacked the final filesystem and ran git on every `.git` it keeps: HEAD against the task's starting commit, every ref and its target, reflog and ORIG_HEAD entries, every object in the store, alternates, shallow and replace refs. A hidden-test marker is a failing-to-passing test name or a new test file the starting commit lacks. Fix commits are later commits that add a marker or name the upstream pull request.
2. **Session scan.** We read 3,978 SWE-rebench sessions and 153 fix-code-vulnerability sessions in message order, from the Claude Agent SDK logs the runs kept. A history command is one that lists or names history past the starting commit (`git log --all`, `git show` on a later sha, `git reflog`, reads under `.git/`, and similar). Every SWE-rebench session the scan flagged for Opus 5.5 or Sol was also read by hand. For this note we also reread, by hand, every particle-1 and Sol session that searched all of history on a leaking image and wasn't counted: 8 for particle-1 and 6 for Sol.
3. **Cache check.** For every image we read each layer, opened compressed files and archives (.gz, .zip, .whl, .jar, .tar), searched binaries by substring so mangled symbols match, and dropped every marker the task's starting commit already holds. Planted test cases in each format were all found. A file that a later layer deletes was recorded as unreachable. For the 12 SWE-rebench tasks with a reachable match, we read all 185 sessions on them in message order.
4. **Reruns.** Each post's frozen analysis ran at its own pinned commit, first unchanged to reproduce the published output, then on a copy of the data with the exposed tasks or the leaking task removed. No analysis code changed. No model was called. The R3c cache rerun reproduced its published output byte for byte first.

Scripts that ran, by sha256. They aren't in this repo.

```
bab67bdda806367e175c170116fb3c9cf59fc439437e2a2188d134f46afe2242  scan_sessions.py
9b7da18ac51ff5eec50cd8191c42243accb1c0386a7ab5dba067be8b5e600f69  git_check.py
529bf271bd388805ea0590f99c5a3a995507aa636ee5b3d533583940125e6522  tb2_scan.py
a9a9e0bdb98cd132ec6d647f75a8f4f29f226b333e1f924b8c3bebaa25283bcf  tb2_check.py
38d353f0c4ec4a76704f6a8c7f64d062e5594b4c4fb99989569735f34be14672  cache_scan.py
e318b7175256de68f7959d01eb12ddfe807fce21f64932ac008bc33474a157f2  scan_cache_sessions.py
0a046cb424b0af2f39fbf231c99e1873085093bee5cf22bd2349448b1c765c79  r3c_sens.ts
5b629a3920fac6f87e0b19c5a9bfea6b249707b10076b805e5bc56e78f3bf379  ert_check.py
efd626a60824384db9e663c04b513681dabd7711a8e1826a81e49b4778ab46e1  ert_check2.py
4d530608825aa7b465d8579941915faba4e619dcc52f2ebb45a8632cba3e4397  sol_check.py
f47b973a3826f8a0d146c512d42460dbe7ed0fecdad0f80bf1d44a637c2041f2  ert_ids.py
7ba1bcd2ee087a974313f70c6cd533d44feb32cacbb08832c4dee192b536dc9d  ert_calls.py
```

### The lesson: the agent's own fix is not the upstream fix

Our first scan counted a session as exposed whenever two lines of the upstream fix appeared in a tool result. That flagged 15 Opus 5.5 and Sol sessions, and 4 particle-1 sessions, that had seen only their own work. They had written the fix with sed or a script and then run `git diff`, which printed their own lines back. So the final rule counts fix code only when a history command printed it, and only when it appears before the agent wrote it. The cache check met the same trap from another side: fix lines that call a library also appear in that library's source. Any leak scan that matches answer text in tool output has to separate the answer from the agent's own work and from ordinary library code, or it will charge an agent for doing its job.

## For the next scan

The independent check, and our rereads, found what our scanner misses:

- Commits from a fix branch read by id: `git show` on such a commit, or `git diff` between two of them (virtual_ecosystem-1232 saw the fix that way).
- Ref and history commands it doesn't classify: `git branch -v`, `git rev-parse --all`, `git ls-remote`, `git show-branch`, `git name-rev`, reflog syntax (`@{...}`), commit ids shorter than 7 characters, `git grep` or `git format-patch` on a commit id, a recursive grep over `.git`, and GitPython.
- Fix commits that name no pull request and add no new test name, and copies of the fix on other branches (the two equinor/ert tasks).
- Hidden tests that change existing tests instead of adding new ones: match the hidden test text, not only new test names.
- Package caches and installed copies of the package under test, classified as the fix, library code the fix calls, or coincidence before any session is counted.

## Limits

- The session logs and the scanners aren't published, so outsiders can't rerun the scan or the reruns, and the rerun outputs aren't committed. The images are public, so the image check and the cache check can be repeated.
- The scan sees what tool results printed. An agent that learned of a fix some other way, such as a file name it guessed, would not be counted. Tier B catches fix commit ids shown without their content.
- Search counts come from our scan tables' history classifier, which misses the commands listed under For the next scan. The independent check read every Opus session; Sol's and particle-1's sessions were reread only where the scan flagged a search on a leaking image.
- The clean-task L1 numbers for particle-1 are descriptive: the frozen coverage rule (90% of planned tasks) makes any rerun descriptive once more than 10% of tasks drop. Its session-drop variant was not rerun with the 5 sessions this note adds.
- Three reruns matched their published output with small, explained gaps. Quick look 3's `analyze.ts` output matched except the order of one entry in its trailing JSON list; every table matched. Run D's run log differs from its expected log on one line, a file count of 27 against 26, which the claim check already explains. The gstack-null post's numbers script matched on its Terminal-Bench 2 side apart from its spend lines, which need ledger inputs we didn't pass.
- The waste-floor post and the review side of the gstack-null post were not recomputed.
- We didn't rerun our scanner on the sessions behind the earlier 40-task check; the image counts match it exactly instead.
- We didn't check whether keras 3.14.1 was released after each keras task's fix; the cached wheel carries the fix lines either way.

## What this steers

- Patch or retire fix-code-vulnerability before the next Terminal-Bench 2 run: rebuild its history so no commit holds the fix, or remove `.git` from the image, and reinstall bottle.py from the broken file.
- Strip refs past the starting commit, and prune, before the next SWE-rebench run. Clear the pip, uv and conda caches in each image, and squash away layers that hold the dataset's instance file.
- Scan the cheap model's sessions first, and report search rates beside exposure. particle-1 searched all of history in 44% of its L1 sessions; Opus 5.5 in under 1%.

## Replicate it

The image check needs only the public images. Inside a task's repository in the image:

```
git for-each-ref                                       # every ref; flag any that isn't the starting commit or its ancestor
git rev-list --all --reflog --not <starting commit>    # later commits that refs or the reflog reach
git cat-file --batch-all-objects --batch-check         # every object, reachable or not
git diff HEAD --stat                                   # the working tree against HEAD; for fix-code-vulnerability this shows the fix
```

And for the caches, in the same image:

```
ls /root/.cache/pip /root/.cache/uv /opt/conda/pkgs    # package caches; look for a later release of the package under test
pip cache list                                         # cached wheels by name and version
```

The session scan and the reruns need the run archives, which stay private because they hold full transcripts.

## Changelog

- 2026-11-11: the earlier containment note.
- 2026-11-12: this note. It corrects the image counts, the particle-1 session count (73, not 68), the Terminal-Bench 2 wording, Sol's intervals, particle-1's L1 verdict and p value, and what was rerun, and adds the cache check, the search rates and the list for the next scan.

<details>
<summary>Agent notes</summary>

- Sources: the outside claim check is org drive research/desk/claim-checks/2026-11-12-git-history-answer-leaks.md (checked by FOUN-345 for FOUN-32); its corrections are paraphrased here, not copied. The cache audit is GEVA-529's (Captain drive reports/GEVA-529.md, tables in handoffs/GEVA-529/). The earlier note is GEVA-517's (#330, merge 1888e40a). This note closes GST-2575.
- The five particle-1 sessions added in item 2: equinor__ert-12491__CUmTEEf (none arm, passed: printed fix commit 083450700, then applied later commit 578bdeac8), equinor__ert-12491__FNdnRwa (after-u, passed: printed 083450700 just before its first edit), equinor__ert-12491__qCLKWGb (before-u, passed: printed and applied 578bdeac8 after checking it is not an ancestor), equinor__ert-12491__WgbQxd2 (before-t, passed: printed 083450700 after its first edit, then rewrote its change), and ImperialCollegeLondon__virtual_e__HRaETVU (before-u, failed: printed the fix pull request's test changes from 921f93e6, not an ancestor). The other three uncounted particle-1 searches on leaking images (two on augur-3512, one on xarray-10863) printed only commits the image check lists as ancestors.
- Sol's six uncounted searches on leaking images: four on dask-12119, one on pygmt-4371 and one on basic-memory-341. Each showed only commits the image check lists as ancestors, or none.
- Cost of this note's checks: no model calls. The cache audit used one Ubicloud standard-16 VM for about 44 minutes, settled at an estimated $0.65, and destroyed.
- fix-code-vulnerability's image HEAD is 0207a34f0c5716cd292dd4480253ad35d3da49f3.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

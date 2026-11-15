---
id: 2026-11-15-geva-541-stop-hook-ceiling-check
kind: finding
title: "No harder tier for gstack's Stop hook: once changelog edits and background test runs are read, the run-a-test-after-your-last-edit rule has no room left, so the hook stays a cut candidate"
summary: "Keyless check for a harder tier: TB2 is easier and fits the rule badly; on SWE-rebench, read from the last code edit, /verify prose reaches 99.0% on Opus 5.5 and 93.5% on Sol. No paid run."
author: GEVA-541
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-15
status: done
links:
  - 2026-11-15-geva-503-harness-mechanics-results
  - 2026-11-09-geva-448-harness-mechanics-prereg
  - 2026-11-06-geva-350-l1-overhaul-results
  - garrytan/gstack-evals#300
  - lanes/harness-mechanics/score.ts
attachments:
  - a9498dc08218d54b69ca3325d60b19b2c9ba5e9b499c1387eb01bd3d55dd5ac4  colour.py.txt
  - 6fa3b1d2f0f8b8c976bf0924f7a75b1b878b0cffd04d9b64475ae95c8544ef79  colour.txt
  - 9ec96bbd7b6163adc145fe95153231673cd5c9eb267c4468ee733bb5eebd8177  digests.txt
  - dda46691d9109493892d3fdbcf5af5a98e0ca54bbe5f57fbfee7304f3ef3b871  readings.py.txt
  - 5dca43338e364cf4e770ea66b75f0c6960d7f02777afefc51dbcfcf3ecb45e12  readings.txt
  - 83164185b59e6c7f5304bcb06f0f2785812d83d1547b4deb9859668cbafec616  tier.py.txt
  - 99e959c7766cef443f5dca829a7a0754bcb07861e1446aeee6bac9781fd46a0a  tier.txt
  - fa0f1cb1cadde189508ee91cb9489221fc34e10afdedfdd292226b9e029cdef8  variants-hm.jsonl
  - cd1801bc1cc999ed18aa4be9db755f770957eef11ad7b77c76f05a10bfc8d14b  variants-tb2.jsonl
  - 8506715d1d48767969cc74d4876a5e67d605330dddc9fa18308f5a18f78f1593  variants.ts.txt
---

# Looking for a harder tier for gstack's Stop hook

## Status

Publication status: unpublished. This is a keyless reanalysis of two runs we already had. No model was called for it. Still open before any public use: a claim check by a reviewer from another model family.

| Field | Value |
|---|---|
| Grade | Exploratory. It is the admission check for one more run, made from earlier transcripts, with no preregistration. Every number is descriptive. |
| Question | Is there a set of tasks where Opus 5.5 and GPT-6.1 Sol, told to use /verify, often skip running a test after their last edit, so that gstack's Stop hook has room to help? The harness mechanics results owed this check under our rule R61: when a null comes from a ceiling the model already reaches without the part, make one honest attempt to raise the ceiling before calling a cut. |
| Data | The harness mechanics run: 3,239 graded sessions on 240 SWE-rebench tasks, with Opus 5.5, GPT-6.1 Sol and particle-1. The L1 overhaul's Terminal-Bench 2 twin set: 370 Opus 5.5 sessions on 37 tasks. Their trial dirs hold transcripts, so they stay private; digests.txt lists their sha256. |
| Code | variants.ts.txt reads each transcript with the merged scorer (lanes/harness-mechanics/score.ts at b18e669) and prints one row per session (variants-hm.jsonl, variants-tb2.jsonl). readings.py.txt prints every table below (readings.txt). tier.py.txt marks the changelog tier (tier.txt). colour.py.txt counts result lines printed in colour (colour.txt). |
| Reviewed by | The review of this post, recorded in its pull request |
| Reproduced by | Not yet. variants.ts asserts that its as-written reading equals the scorer's on every session, and readings.py asserts that it equals each run table's. |

## What we found

We learned that a check-your-work rule written as prose is enough for frontier models on real bug fixes. Told to use /verify, Opus 5.5 ran a test after its last code edit in 99.0% of the scored sessions that edited code (197 of 199) and GPT-6.1 Sol in 93.5% (186 of 199), counting tests the model ran in the background and read later. The hardest tasks read no lower than the easiest, and the longest sessions within 3 points of the shortest. gstack's Stop hook, which blocks a stop once when the rule is unmet, added -0.5 points on Opus (95% CI -3.3 to +2.1) and +1.5 on Sol (-3.1 to +5.9). You should write the rule into the procedure, and skip a Stop hook for it.

We learned that "after the last edit" needs two corrections before it measures what we mean. An edit that only touches a changelog or docs file doesn't call for another test run, and a test run in the background still counts once the model reads its result. The merged scorer counted neither, which is why it read /verify at 96.0% on Opus and 89.0% on Sol. Across both stages, 8 of Opus's 10 /verify misses ended on a docs-only edit, and 13 of Sol's 27 were background runs. You should build both corrections into any rule or hook that checks for a test after the last edit.

**What didn't work.** We found no harder tier. The Terminal-Bench 2 twin set is easier for Opus (85.1% passes with no gstack, against 60.5% on SWE-rebench), and the rule doesn't fit its tasks. On SWE-rebench, the one task feature that lowered the rule's count, an upstream fix that also adds a changelog entry, lowered it only because the model wrote the changelog after its last test. So the attempt ends at the admission check, with no paid run, because no run on these tasks could show the hook helping (R97). The ceiling is real, and the Stop hook for this rule is a CUT-CANDIDATE on Opus 5.5 as well as on Sol.

## What works: the rule as prose

Each cell is the share of edited sessions that ran a test after the last edit, under four readings. "As written" is the merged scorer's rule (section 13 of the preregistration). "Code edit" reads the rule from the last edit to a file that isn't docs or a changelog. "Background" also credits a test run in the background when a later tool result names its output and shows an outcome. The last column applies both. Stage 4, 200 tasks per model:

| Model | Arm | As written | Background | Code edit | Both |
|---|---|---|---|---|---|
| Opus 5.5 | none | 81.4% | 81.4% | 92.4% | 92.4% |
| Opus 5.5 | plain-2 | 77.9% | 77.9% | 90.9% | 90.9% |
| Opus 5.5 | verify-prose | 96.0% | 96.0% | 99.0% | 99.0% |
| Opus 5.5 | verify-hook | 98.0% | 98.0% | 98.5% | 98.5% |
| Opus 5.5 | hook minus prose | +2.0 (-1.9 to +5.7) | +2.0 (-1.9 to +5.7) | -0.5 (-3.3 to +2.1) | -0.5 (-3.3 to +2.1) |
| GPT-6.1 Sol | none | 86.0% | 89.0% | 88.9% | 92.0% |
| GPT-6.1 Sol | plain-2 | 88.0% | 90.0% | 91.0% | 92.5% |
| GPT-6.1 Sol | verify-prose | 89.0% | 93.0% | 89.4% | 93.5% |
| GPT-6.1 Sol | verify-hook | 91.0% | 95.0% | 91.5% | 95.0% |
| GPT-6.1 Sol | hook minus prose | +2.0 (-3.2 to +7.6) | +2.0 (-2.6 to +6.7) | +2.0 (-3.0 to +7.3) | +1.5 (-3.1 to +5.9) |

The intervals come from readings.py's bootstrap over repositories (4,000 draws, seed 20261115), so they differ a little from the results post's, which gave Sol's as-written line as +2.0 (-3.1 to +7.5). particle-1 wasn't part of this attempt; readings.txt shows the same picture for it (verify-prose 97.5% under every reading, hook minus prose -2.5, -6.2 to +1.0, read from the code edit).

Why the rule as written was missed, both stages (section C of readings.txt):

| Model | Arm | Misses | Last edit docs-only | Background run | Ran a test, no outcome shown | No test | No Bash after the edit |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | none | 49 | 31 | 1 | 7 | 31 | 10 |
| Opus 5.5 | verify-prose | 10 | 8 | 0 | 3 | 7 | 0 |
| Opus 5.5 | verify-hook | 4 | 1 | 2 | 2 | 0 | 0 |
| GPT-6.1 Sol | none | 36 | 9 | 6 | 3 | 16 | 11 |
| GPT-6.1 Sol | verify-prose | 27 | 3 | 13 | 3 | 9 | 2 |
| GPT-6.1 Sol | verify-hook | 19 | 1 | 10 | 9 | 0 | 0 |

The last four columns split the misses by why the rule found no test, and the docs-only column cuts across them.

## What didn't work: looking for a harder tier

### Terminal-Bench 2 is easier, and the rule doesn't fit it

The results post named L1's 37-task Terminal-Bench 2 twin set as the place to look. Its five arms are none and four gstack arms, before and after an overhaul, two of them told to use /investigate; none of them is /verify. Section A of readings.txt:

| Arm | Sessions | Pass | Tool calls per session | Edited | Rule as written |
|---|---|---|---|---|---|
| none | 74 | 85.1% | 4.7 | 58 | 31.0% |
| before-u | 74 | 81.1% | 4.9 | 60 | 33.3% |
| before-t | 74 | 86.5% | 5.8 | 55 | 34.5% |
| after-u | 74 | 79.7% | 4.9 | 55 | 36.4% |
| after-t | 74 | 85.1% | 6.9 | 56 | 35.7% |
| SWE-rebench Stage 4, Opus none, for comparison | 200 | 60.5% | 12.5 | 199 | 81.4% |

These tasks are easier for Opus, not harder, and a session costs about half as much. By the 90% bar the results post set, the set shows room: the rule reads 31% to 36% in every arm. That room is in the rule's definition, not in what the model does. The rule reads low because it was written for Python projects with a test suite: it counts Python test runners and repro scripts. In 176 of the 187 misses across the five arms, the model ran more commands after its last edit, but none the rule counts as a test. In 48 of them it ran a program, a compiler or a comparison (node, python, diff, a build), and the sessions we read by hand often ended by writing the answer file the task asks for, then running or reading it. A Stop hook that shares the rule would push its count up by forcing a Python test or a repro script, whether or not the work needed one, so a hook against prose run there would measure the rule's definition, not the hook. Passes don't leave much room either: 8 of the none arm's 11 failures are on 4 tasks that no session in any arm passed.

### Harder SWE-rebench tasks and longer sessions don't lower it

We banded each model's Stage 4 tasks by how often the other two models solved them in their plain arms: hard (at most a quarter of the time), mid, and easy (every time). The thirds split each arm's sessions by the session's own token count. Section D of readings.txt:

| Model | Arm | Reading | Hard | Mid | Easy | Shortest third | Middle third | Longest third |
|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | none | as written | 80.5% (77) | 90.0% (20) | 80.4% (102) | 84.6% | 79.1% | 80.6% |
| Opus 5.5 | verify-prose | as written | 98.7% (77) | 95.0% (20) | 94.2% (103) | 97.0% | 92.5% | 98.5% |
| Opus 5.5 | verify-prose | both corrections | 100.0% (76) | 100.0% (20) | 98.1% (103) | 98.5% | 98.5% | 100.0% |
| GPT-6.1 Sol | none | as written | 85.5% (69) | 82.1% (28) | 87.4% (103) | 90.9% | 85.1% | 82.1% |
| GPT-6.1 Sol | verify-prose | as written | 92.8% (69) | 82.1% (28) | 88.3% (103) | 93.9% | 91.0% | 82.1% |
| GPT-6.1 Sol | verify-prose | both corrections | 95.6% (68) | 92.9% (28) | 92.2% (103) | 95.4% | 92.5% | 92.5% |

Sol's longest third reads 82.1% as written and 92.5% with both corrections, so most of that drop is the scorer. A tier picked for long sessions would also break the brief's rule that cost per session stays roughly flat.

### The changelog tier: the drop is the changelog

Of the 354 pool tasks, 98 have an upstream fix that also writes a changelog or news entry (tier.txt; 55 repositories, the largest schemathesis with 9, tox with 7, astropy and pandas with 6). The harness mechanics run tables hold 70 of them, after its screen swapped some drawn tasks for spares. Section E of readings.txt, Stages 1 and 4 together:

| Model | Arm | Tier, as written | Others, as written | Tier, both corrections | Tier pass | Others pass | Tier cost per session vs others |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | none | 65.7% (70) | 85.2% | 95.7% | 60.0% | 61.2% | 1.08x |
| Opus 5.5 | verify-prose | 90.0% (70) | 98.2% | 100.0% | 67.1% | 60.0% | 1.01x |
| Opus 5.5 | verify-hook | 98.6% (70) | 98.2% | 98.6% | 64.3% | 64.1% | 0.97x |
| GPT-6.1 Sol | none | 81.4% (70) | 86.5% | 91.4% | 61.4% | 55.9% | 1.13x |
| GPT-6.1 Sol | verify-prose | 91.4% (70) | 87.6% | 97.1% | 65.7% | 58.2% | 1.03x |
| GPT-6.1 Sol | verify-hook | 87.1% (70) | 94.1% | 92.9% | 62.9% | 56.5% | 1.15x |

On Opus the tier does what a harder tier should on the rule as written: /verify drops to 90.0%, and the hook reads 8.6 points higher (7 sessions to 1). But all 7 of Opus's /verify misses there ended on a changelog written after the last test, and read from the last code edit /verify is at 69 of 69. A run here with the rule as written would most likely read the hook as followed more, on reruns after changelog edits that change no code. Sol's /verify doesn't drop on the tier, and its 6 misses there were all after code edits.

### Colour

colour.txt counts sessions whose tool results print a result line in colour. The pytest case (279 of 3,244 sessions, judge arms included) is already fixed in the merged scorer. One session printed a tox result line in colour, and it also printed an uncoloured result line the scorer reads, so no reading changes. This check needed no scorer change.

## Why null? (R48 and R61)

| Line | Exposure | Task fit | Power and ceiling | Frontier without the part | End state |
|---|---|---|---|---|---|
| Stop hook against /verify prose, test after the last edit | from the results post: /verify loaded in every session, the hook blocked 22 of 600 | SWE-rebench fits; Terminal-Bench 2 doesn't (above) | read from the last code edit with background runs counted, /verify is at 99.0% (Opus) and 93.5% (Sol); on the changelog tier, 100% and 97.1% | none ran the rule in 92.4% (Opus) and 92.0% (Sol) under both corrections | CUT-CANDIDATE on Opus 5.5 and on Sol. The R61 attempt found no tier with room, so the results post's FIX-METHOD (saturation) on Opus becomes a confirmed ceiling, and the hook goes to Garry Tan as a cut, as decided for this attempt before it began. |

## Mechanics

- **Readings.** variants.ts finds the last edit as the merged scorer does (Edit, Write, MultiEdit, NotebookEdit, or a Bash command that writes a file) and the checks after it with the scorer's own isCheck, showsOutcome and isRepro. "Docs" means every file the edit wrote matches DOC in variants.ts: a docs or changelog folder, a CHANGELOG, CHANGES, HISTORY, NEWS or RELEASE_NOTES file, or a .md, .rst or .txt file. A background run counts when a later tool result shows an outcome and names that run's output file.
- **Tier.** tier.py reads only the file names in each task's upstream patch from the SWE-rebench leaderboard at a pinned revision, never the patch itself, and marks a task when one matches its changelog pattern. Its list column is the list draw.py put the task on before the run's screen, not where the run used it.
- **Bands.** A task's band for one model comes from the other two models' none and plain-2 sessions on it in Stage 4.
- **Pairs.** Hook minus prose pairs the two arms' sessions on the same task and stage. The tier lines count discordant pairs; their MDD uses 2.80 or 3.083 times the square root of the discordance over 255 pairs (85 tasks, 3 repetitions), at 95% and at 97.5% for two models.

## Limits

- **Post hoc.** The two corrections were chosen after reading the results post's misses. They are readings, not a preregistered rule, and they reuse the same sessions, so they can show a ceiling but can't prove a hook effect either way.
- **Docs pattern.** Any .md, .rst or .txt file counts as docs. On Terminal-Bench 2 that catches answer files, which is why its table shows only the rule as written.
- **Background credit is a lower bound.** A result read some other way, or without an outcome line, still counts as a miss.
- **No /verify arm on Terminal-Bench 2.** The twin set has a none arm and four gstack arms built around /investigate, and we read its sessions by hand only on a sample.
- **Difficulty is relative.** The bands come from the other two models on the same tasks, not from an outside label.
- **One pool.** Every SWE-rebench task here comes from one pinned pool of mostly Python repositories.

## Replicate it

Keyless, from a checkout with bun install and python3 with pyarrow, given the private trial dirs and run tables (digests.txt). From this folder:

    cp variants.ts.txt variants.ts
    bun variants.ts <harness mechanics trial dirs> > variants-hm.jsonl
    bun variants.ts <Terminal-Bench 2 twin trial dirs> > variants-tb2.jsonl
    python3 tier.py.txt <parquet dir> <repo root> > tier.txt
    python3 readings.py.txt variants-hm.jsonl variants-tb2.jsonl <stage1.table.jsonl> <stage4.table.jsonl> tier.txt > readings.txt
    python3 colour.py.txt <harness mechanics trial dirs> > colour.txt

The variants files are public, so the adherence counts per model and arm can be checked from them alone; the stage split, pass flags and token counts come from the private run tables.

## What is held out, and why

Nothing is sealed. The tasks are public and listed in the two preregistration bundles. The trial dirs and run tables stay in the Captain's drive because they hold transcripts and repository code; digests.txt lists their sha256 and the public parquet files'.

## Cost

No paid model call, machine or ledger. The cost was agent time on one cloud machine; dollar figures are in Agent notes.

## Attribution

SWE-rebench is the work of Nebius AI R&D, used under CC-BY-4.0, and each task repository keeps its own licence. Terminal-Bench 2 and Harbor are Apache-2.0. gstack is MIT.

## Changelog

- 2026-11-15: first version.

<details>
<summary>Agent notes</summary>

**Decision this changes.** The decision recorded for this attempt: if the result is still null, the hook goes to Garry as a cut; if the hook measurably helps on the harder tier, it stays and the rule ships as a hook. The admission check finds no tier with room, so the null stands without a run.

**Options priced, if a run is wanted anyway.** Prices use the measured per-session costs in readings.txt section E. Central and 1.35x cap.

- A, recommended: stop here. No paid spend. The hook goes to Garry as a cut candidate.
- B: the changelog tier, rule as written. Up to 85 tier tasks after the screen (assumed), arms none, verify-prose and verify-hook, Opus 5.5 and Sol, 3 repetitions: 1,530 sessions. Model spend 85 x 3 x (1.195 + 1.375) = $655 central, $885 cap. Machines about $27 central, $36 cap. Agent use about 535M tokens (analysis 80M, preregistration and its review 35M, build 150M, gate-class review 120M, run 60M, results and review 90M) at about $0.50 per 1M: $268 central, $361 cap. All-in about $950 central, $1,282 cap. MDD at 255 pairs per model: 5.9 points at 95% and 6.5 at 97.5% for Opus (discordance 0.114), 6.3 and 6.9 for Sol (0.129). Not recommended: the data in hand says Opus would most likely read HOOK FOLLOWED MORE (+8.6, 7 to 1) only from reruns after changelog edits, which would keep the hook for no gain in correct code.
- C: the same run with both corrections as the primary reading. Same price. /verify is already at 100% (Opus) and 97.1% (Sol) on the tier, so Opus has no room and Sol has 2.9 points against an MDD of 4.0. The likely outcomes read NO MEASURABLE DIFFERENCE or, on Sol, PROSE FOLLOWED MORE (the hook is 4.3 points below /verify there in the data in hand). Both lead to the cut already reached, so R97 says it doesn't run.
- D: Terminal-Bench 2 with a rebuilt definition of a check. It would test a different rule from the one gstack's hook enforces, so it isn't this attempt; it would need its own plan.

**Decision table, as drafted for B or C.** KEEP if HOOK FOLLOWED MORE on at least one model (lower bound above 0 at 97.5%) with the pooled pass lower bound above -7.5 points and no PROSE FOLLOWED MORE. CUT-CANDIDATE if NO MEASURABLE DIFFERENCE on both models, PROSE FOLLOWED MORE on either, or HOOK COSTS PASSES (pass upper bound below 0). FIX-METHOD (power on passes) if adherence improves but the pass lower bound is at or below -7.5. A saturated control after the first repetition (Opus /verify above 93%) stops the run as FIX-METHOD (saturation), which goes to the cut path. Exposure below 90% reads FIX-METHOD (exposure); more than 5% missing pairs reads INCOMPLETE. If a gain comes mostly from reruns after docs-only edits, the post says so and recommends the hook skip those edits.

**Line money.** The harness mechanics line stood at $2,124.96 all-in before this attempt, against $3,000. With A it stays about there (this analysis is agent time only). With B or C it would reach about $3,090 central and $3,420 at cap: over the $3,000 line, under the $4,500 point that goes to Garry.

**Next-harness notes from this check.** Count from the last code edit, not a docs-only edit. Credit background test runs whose result the model reads. A rule written for Python test suites doesn't transfer to Terminal-Bench 2.

</details>

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

gstack is Garry Tan's own project.

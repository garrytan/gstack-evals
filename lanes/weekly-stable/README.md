# Weekly stable number

Each Saturday at 06:00 UTC, this lane measures gstack's release candidate (the newest commit on gstack's main branch that gstack's release gate reads as green) against gstack's current stable release and against no gstack, on 130 frozen SWE-rebench Python bug fixes with Claude Opus 5.5 in Claude Code. The result is a public record, weekly.json, that gstack's Monday release cut reads: HOLD, GAIN, NO CHANGE or INCOMPLETE, with FLAG lines.

The plan: the preregistration [wiki/plans/2026-11-22-geva-573-weekly-stable-prereg](../../wiki/plans/2026-11-22-geva-573-weekly-stable-prereg/README.md), [pre-run change 1](../../wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-1/README.md), [pre-run change 2](../../wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-2/README.md) and [pre-run change 3](../../wiki/plans/2026-11-22-geva-573-weekly-stable-pre-run-change-3/README.md). Where this page and the plan disagree, the plan wins.

## Files

| File | What it does |
|---|---|
| pins.ts | Frozen values: bundles, task lists, arms, S390, caps, record fields |
| resolve.ts, resolve-shim.ts | Names the candidate and stable with gstack's own release-cut code, from a full clone |
| build.sh | Builds one gstack arm's tar at a sha: depth-1 fetch, gstack's ./setup, deterministic tar |
| arms.ts | Arm manifests and checks; the contamination search |
| plan.ts | The week's seed, parts, launcher profile, projections, approval row and launch guard |
| read.ts | Session rows, the paired reading, the look, the verdict, the record, the pilot and smoke checks |
| cli.ts | `bin/gstack-evals weekly <command>` |

## A week, in order

Every command is `bin/gstack-evals weekly ...`. `W` is the week's work folder, for example `~/.capy/work/weekly/2026-11-28`. The week runs as three ledger items, `ws-<date>-1`, `ws-<date>-2` and `ws-<date>-3` (`ws-<date>-r<n>-<k>` for a re-measure), one per part, each on its own L1 host with its own work folder `W/p1`, `W/p2` and `W/p3` beside `W/week.json`. Run each step to the end before the next, and stop at the first failure that the step says makes the week INCOMPLETE.

1. **Resolve.** `resolve W` clones gstack, reads the newest published record by run start that is not INCOMPLETE and prints one line. A HOLD never goes stale, and a candidate that a standing HOLD names is never measured again. If the records cannot be read, the week is INCOMPLETE; a repository with no published record has no HOLD. A re-measure the Captain orders takes `--remeasure <n>`, which names the items `ws-<date>-r<n>-<k>`, and `--week <YYYY-MM-DD>`, the date of the week it re-measures: its record takes that week's tag plus `-r<n>`, even when it runs in a later ISO week.
   - `WEEK RUN`: go on.
   - `WEEK NO-CANDIDATE` or `WEEK INCOMPLETE`: `record W --out W/out`, then step 9.
   - `WEEK HELD`: publish nothing; tell GStack Minder the HOLD stands; end.
2. **Build.** `build W` builds the candidate and stable tars into ${WEEKLY_ARMS_DIR:-~/.capy/work/weekly/arms} (empty each week; a Ubicloud VM if the Capy machine lacks room). Exit 1 after "./setup failed": `record W --out W/out`, send a broken-install report to GStack Minder for the candidate or tell the gstack-evals Captain for stable, then step 9.
3. **Check.** Put B1's none.tar (or none.tar.gz) beside the built tars, then `arms manifest W`; `arms check W` must print `WEEKLY ARMS PASS`, and records each arm's tar digest in week.json. Then `contamination W`; more than 13 dropped makes the week INCOMPLETE at report time.
4. **Plan and approve.** `plan W` prints each item's parts and projection. For each part k, `approve --ledger $WEEKLY_LEDGERS/ws-<date>-k.jsonl --item ws-<date>-k --usd <cap> --approved-by gstack-evals-captain` writes the approval row the Captain recorded: $204 for part 1 (the smoke and s390-1), $203 each for parts 2 and 3, $610 in all.
5. **Prepare and launch** on L1's host and part machinery (quick/laneb/l1/l1.ts explains each command). Set WEEKLY_LEDGERS to the folder holding the three ledgers, LEDGER to the item's own ledger for each command, and WEEKLY_METER to a file `{"as_of": <iso>, "usd": <this thread's cost.dollars>}` (the guard refuses a reading older than 60 minutes), rewritten before every guarded command. For each k, `prepare W/pk --item ws-<date>-k`, then `host-up W/pk`: three hosts. Then `launch W/p1 --part smoke`. host-up, launch and relaunch run the launch guard first: it counts every part's projection, its settled and open spend, and the meter against the $645 week stop, and each part against its own cap. Attach on a timer, never in a loop.
6. **Smoke.** Pull the smoke part, build its table (`table <config.json> W/smoke.jsonl`), then `smoke W/smoke.jsonl W`. `RIG FAIL` makes the week INCOMPLETE; `PASS with FLAG` goes on with the FLAG. The smoke launches only after the arms check passed and the contamination search ran; a counted part launches only after a smoke with no rig failure.
7. **Run.** `launch W/p1 --part s390-1`, `launch W/p2 --part s390-2` and `launch W/p3 --part s390-3`, all three at once, one per host. Rerun owed infrastructure sessions with L1's `rerun` after each part ends. Once part 1 and the start of part 2 have settled, pull and table them and run `look W/table.jsonl W` until it prints STOP or CONTINUE; it prints no estimate, and it runs once: its first ready reading is recorded in week.json and a second look is refused. After a STOP, the week reads only the look's 65 tasks; sessions still running on other tasks are never read.
8. **Read.** When every part has ended (or at a STOP), `table` over every pulled part, then `report W/table.jsonl W --out W/out`, adding `--stopped HOLD|GAIN` after a STOP; it must match the recorded look. The report refuses a table with a graded session on a tar that is not this week's, and reads each trial once. It writes report.txt, results.md (checked by gstack's results check), weekly.json, page-row.md and publish.json.
9. **Publish.** `publish W/out --dry-run`, read the command, then `publish W/out`. Add page-row.md to weekly/gstack-stable.md in the gstack-evals Captain drive. A HOLD sends GStack Minder the flipped tasks, both arms' transcripts and diffs, exposure and the commit range.
10. **Close.** For each k, `host-down W/pk` and `done --ledger $WEEKLY_LEDGERS/ws-<date>-k.jsonl --item ws-<date>-k`; destroy every VM, copy the run records to the crew's private run store with sha256 manifests, report to the gstack-evals Captain and archive the thread.

The one-time pilot runs the same way with the item `weekly-pilot` ($20, two sessions at once) and one part, `pilot`, after steps 2 and 3 on the week's shas; `pilot-report <table.jsonl>` prints PASS or FAIL per arm.

## Rules that are easy to miss

- No paid session before the item's approval row; a cap stop never reruns.
- Never change gstack at either sha. Never commit a weekly manifest (quick/laneb/arms/manifests/weekly is gitignored) or anything that names this week's tasks.
- The record carries no task id, repository name or task text, and the smoke's FLAG line counts sessions without naming tasks (the per-task detail goes to the private report). An INCOMPLETE record carries no model rows, areas or realized figure. A published release is never edited; a correction takes the next `-r<k>` tag.

# Run record: day-one usefulness eval, paid phase

What ran, in order, with the command and what it showed. Times are UTC. Sealed paths, labels' contents and keys stay out of this file; only counts and digests appear.

## 1. Before any paid call

### 1.1 Pins and fixes on the results branch

- The pin change and every fix before the smoke are in 2026-11-17-geva-549-day-one-pin-change (sections 1 to 5). Each fix is its own commit with a test that failed on the code before it and passed after.
- Advisory read: one second-model read (GPT-6.1 Sol) of the three fix commits, not a review round. Two blocking findings and three notes; the pin change's section 5 lists what changed. Both blockers were code gaps against rules the preregistration already states, not holes in a rule.

### 1.2 Hand checklist (paid-phase step 4), at branch head 0a0e2a2

1. **A crash resume can't reopen the old rig** (run.ts). Command: a script on a temporary ledger that opens a day1-smoke lease for the stage's cap, opens a second one as a resume would, settles the first with the ledger's settle, then opens again. Saw: the second open refused with E_LEASE_UNSETTLED, naming the open lease and the `gstack-evals ledger settle --lease <id>` command; after the settle, the resume leased the full $310 again. The responder's line settles its own stale lease since fix 1 of the pin change's section 5. Rule for this run: after any crash, read `gstack-evals ledger status`, settle the crashed lease by hand, and only then relaunch.
2. **An empty N base plan** (run.ts inputProblem). Command: the stage runner on a stub rig and the dry run's fixture unit, with N writing an empty plan.md, then a review stage with D and R. Saw: N's first attempt retried (no plan), the second ended with the base row scored E_DAYONE_NO_PLAN at 0 words, the 0-byte plan file stayed, and D and R both ran their reviews on it. Rule for this run: the results list every brief whose base row is E_DAYONE_NO_PLAN, with the count, beside the D, R and A rows that reviewed it.
3. **A full RAM mount overrides a cap stop** (sessions.ts). A session that fills its RAM-backed HOME or /tmp reads as an infrastructure failure even when it also hit a cap stop or had its key rejected. trial.json keeps the termination from before that override. Command after every stage: a scan of every attempt whose outcome names a filled RAM-backed mount, printing trial.json's termination and flagging any cap stop or rejected key it hid. The results report every such case.
4. **Operator inputs** (each needs a bad input, so these are rules for the operator):
   - The day1-voice cap is not enforced across tags. Each review launch gets its own --voice-cap, and their sum stays at or under the line's $195; the day1-plans lease bounds the total in any case.
   - An attempt's owner_usd is cumulative. Totals use the row's owner_usd, never a sum over its attempts.
   - The receipts filter matches "/scratch" as a substring. No --out or --receipts path contains "/scratch".
   - Validation and fixtures receipts are not bound to tags. Each launch gets its own receipts folder that did not exist before.
   - appWrites follows symlinked folders. The app-writes log is read beside each build; a symlinked folder in it is reported.
   - app.log has no size limit. The runner's disk is checked after every build round; past 80% used, the run stops for the Captain.
   - The owner gate-count note. The responder's gate count counts turns sent while /autoplan waits at its gate, so a session whose gate reopens counts more than once. Gate counts are read as turns, not runs.
5. **Infrastructure notes to watch**: the browser container lacks the hardening flags and its MCP port (8931) is reachable on the trial network; a build can kill the MCP server and become a gap; the onlyTools deny has no driver test (the smoke's checker transcripts are read to confirm only the 18 browser tools were called); no stage-runner case covers an unparsable verdict twice or no plan twice (rows with either are listed).
6. **Never verified before**:
   - /autoplan at A's pin writes the run.json fields exposure.ts reads. Read from gstack's tree at c5250ded: lib/autoplan-state.ts (RunState: phases with closed_at, skipped, native and outside status; outside_model, plan_source, plan_input, active_plan, updated_at), lib/headless-artifacts.ts (RunManifest.status) and lib/autoplan-gate.ts (status set to complete when the gate is answered). Both strengthened commits leave those files alone; they change lib/autoplan-prompts.ts, lib/autoplan-lean.ts and lib/day-one-steps.ts. The smoke's A sessions confirm it live.
   - The Sol checker's route through OpenRouter on the metering proxy: confirmed or not by the smoke's fixtures-real run.
   - The claude CLI on the runner host's PATH: checked on the runner host (section 2).

## 2. The runner host

- One Ubicloud standard-16 VM (16 vCPUs, 62 GB of memory, 32 GB of /dev/shm), created 2026-11-17 at 16:3xZ with a 96-hour time to live. The apt timers are off and linger is on, so neither an upgrade nor a logout ends a run.
- Docker 29.10.0, Bun 1.4.4, and on the host PATH claude 2.1.314 and codex 0.166.0, installed from the npm tarballs docker/host-cli.json pins and checked against the same sha256s the trial image uses. age 1.2.1 for custody.
- The repository at 0a0e2a2 on the results branch, clean. gstack cloned beside it with all three arm pins present: c5250ded, 26f427d9 and 439827d7.
- `gstack-evals doctor`: every line ok. Trial image gstack-evals-trial:d9a48e67acfad61d, sha256:63b5f5b7d2b74f41a7291652914ded77c5f7ea469672300e70bfc83af22f67b8 (recipe d9a48e67acfa, pinned on this host).
- Pulled before any paid call: the Playwright MCP image at its frozen digest and node:24-bookworm at its pin.
- The keyless dry run on the host: 16 PASS.

## 3. Money and custody before the smoke

- Ledger lines recorded on the host before the first paid call, each quoting the approval record: day1-smoke $310, day1-plans $1,020 (its $825 plus day1-voice's $195, because the voice rides its lease), day1-owner $35, day1-builds $690, day1-checks $210, day1-judge $85 and day1-strengthened $1,760. day1-voice, day1-hosts and day1-crew are lines no proxy meters; they are tracked by hand.
- Admission mode is warn on every line. A required line needs a rig admission record, and `rig admit` reads the rig workflow's run through an authenticated GitHub client on the host that spends, which the runner VM does not hold. The rig is covered instead by the keyless dry run on the host and by the smoke's fixtures with the real checker.
- The sealed units were decrypted only into RAM on the host, and each split reads back its frozen digest: practice 32bd8f80 (3 units), set 315da044 (15), spares a2911e35 (3) and category 1 9b73dedb (2).

## 4. The smoke

- Started 2026-11-17 at 16:42Z from 0a0e2a2, in this order: the fixtures with the real checker, the N base plans on the 3 practice briefs, the D, R and A reviews, the builds (N, D and A on the first practice brief in label order, N and A on the second), then their checks. Base, review and the three-cell builds and checks run at --parallel 3. A launch that ends only with admission stops is relaunched once at --parallel 1 on the same manifest. Anything else stops the smoke.

# Office-hours founder eval: the run area

This folder runs the arm sessions for the preregistration in
wiki/plans/2026-11-09-geva-418-office-hours-founder-evidence-prereg/. Each session gives one model, with one arm, a
founder's opening message. A simulated founder answers the model's questions until the model writes a first-move block
or reaches the reply limit. The area writes one row per session for the scoring side to read.

Nothing here holds unit text, keys or transcripts. Units, rows and transcripts stay sealed outside the repo, and the run
command refuses a units dir, out dir or receipts sink inside it. No code here calls a model directly. The simulated
founder comes in as an injected function, and every model call goes through the metering proxy on a ledger item.

## Modules

- session.ts: one session's rules. It builds the first user message, runs the founder loop after each reply (a block
  ends the session, the closing message goes at the reply limit, otherwise the simulator answers) and maps each attempt
  to section 6's end states with one retry in all.
- manifest.ts: the cells (stage1, smoke, stage2, pitch, real), their sessions and rounds, and the manifest each launch
  freezes with its sha256 before the first lease.
- contain.ts: the fresh work repository, the containment probe of each agent container (env names, mounts, egress) and
  the audit of gstack reads in a transcript.
- rows.ts: the row each ended session writes to rows.ndjson, its consistency checks and the report the rows command
  prints.
- run.ts: the launch loop. It freezes the manifest, opens the Docker rig, runs round by round inside the cap, retries
  once, applies stage 2's interim stop, reconciles a crashed attempt on resume, and writes rows.ndjson and stops.json.
- cli.ts: the run, rows and e2e commands. The lane's cli.ts assembles them and wires in the simulator's founderTurn
  and the scorer's exposure read.
- e2e.ts: the keyless end to end. It runs two fixture units through the real Docker rig against a stub model and
  checks containment, the ledger, the journal, every end and the rows.
- seams.ts: the dry-run seams for start rule 7. Pure seams drive the real loop with a scripted launch. The tool seams
  run the real pinned CLI. The container seams need GSTACK_EVALS_DOCKER=1 and print SKIP without it, and a SKIP is
  never a pass.

Each launch writes under its out dir: manifest.json, rows.ndjson, stops.json, rig.json, sim-meter/, sim-cache/ and
sessions/<id>/a<n>/ (attempt.json, meter.json, host/transcript.ndjson and, on the office-hours arm,
host/gstack-state). A session id is kind/model/arm/unit/pN.

## Running a stage on a runner VM

A stage runs for hours, so its controller runs detached on a named runner VM that stays awake, never on a machine
that can sleep.

1. Copy the Ubicloud runner script to a local path, record its sha256 and use only that copy for up, list and down.
2. Set UBI_OWNER to the launching thread's code on every runner call, and set UBI_TTL_HOURS to cover the stage.
3. On the VM, stop the apt timers (apt-daily and apt-daily-upgrade) and turn on linger for the run user, so neither an
   upgrade nor a logout ends the controller.
4. Build the trial image and run `bin/gstack-evals doctor` until it reports the pinned recipe.
5. Set GSTACK_EVALS_EPHEMERAL=1 and GSTACK_EVALS_RECEIPTS to a directory that does not exist yet and outlives the VM.
6. Start the launch with `setsid -f`, for example
   `setsid -f bin/gstack-evals of run --cell stage1 --units-dir <units> --out <out> --item <item> --spend-cap <usd>
   --sim-item <sim item> --sim-spend-cap <usd> > <log> 2>&1`, and poll its log on a timer.
7. After a crash or a VM loss, relaunch on the same out dir with --resume. Sessions with a row are skipped, and an
   attempt with a marker and no row is reconciled first and counts as an infrastructure failure. A relaunch on an out
   dir whose stops.json holds a cap stop is refused, because a cap stop is an incomplete run and is never resumed.
   After a halt, the relaunch keeps the earlier stops in stops.json under earlier.
8. Check the rows with `bin/gstack-evals of rows --out <out>`, copy the out dir and the receipts off the VM, and
   destroy every VM at the end of its stage.

This area creates no VM itself.

## Build-time choices

The preregistration left these rules open, so the build chose them. Each one is open to review.

1. A cap-stopped session, and one the launch never started, gets no row. stops.json lists it as stopped, unstarted or
   interim.
2. The reference cell uses the none arm's allowance and a founder-reply limit of 0, so the closing message goes once,
   after the first reply.
3. The reference's fact order is a shuffle seeded by the prereg seed and the unit id, the same on every model and pass.
4. Rounds run by pass, then 4-unit group, then model (Opus, Sol, particle-1), then kind. Stage 2, the pitch cell and
   the real stratum take units in one seeded order. Stage 1 and the smoke take them in draw order.
5. The smoke's two lens sessions run on the first 2 calibration units by draw.
6. A session the ledger never admitted (E_LEDGER_UNAVAILABLE) is missing at once, with no retry.
7. A simulator provider failure is an infrastructure failure and gets the session's one retry.
8. A provider drift, a containment departure and rejected credentials write the session's row as missing and halt
   the launch. Sessions already running finish, and no new session starts. A cap stop does the same but writes no row.
9. A containment probe that cannot run is an infrastructure failure and gets the retry.
10. Every result the CLI returns counts as one reply, including turns a background task started.
11. The simulator's transcript has one assistant line per reply, with that reply's texts joined by blank lines.
12. The person sheet the simulator gets is sheet.json plus the opening message.
13. The simulator's allowance is per attempt. meterSlot prices each call's worst case on the whole routed chat, as the
    proxy reserves it, and refuses a call the allowance cannot cover with the proxy's E_ALLOWANCE code.
14. Every cell's manifest is frozen, not only stage 2's.
15. --models and --arms filter the cell before the manifest freezes, so the frozen manifest holds only what runs.
16. The office-hours arm's state root keeps the trial seed's onboarding markers and has no preferences file.
17. Stage 2's interim stop counts Opus office-hours sessions in round order and decides only once every earlier one has
    ended, so a parallel round can't change which 24 it reads; the read side counts the same 24. A session whose
    exposure the scorer can't read doesn't count. The stop leaves that arm's later sessions unrun as interim, and
    stops.json records the read under interim rather than as a stop, so the launch still exits 0.
17. The pinned CLI counts maxTurns per user message in streaming input, so the SDK's cap of 60 is the per-reply cap
    and nothing else enforces it. tests/of/run/driver-sdk.test.ts checks this.
18. The context-overflow check reuses the product-value eval's pvOutcome reading.
19. Every session runs in a task named "idea", so the path the agent sees names no unit, arm or model.
20. The launch's simulator reply cache sits in <out>/sim-cache.
21. RunSessionRow widens questions, pushes and named_source to allow null. The scoring side fills them, and the run
    writes null.
22. Stage 1 takes 6 to 8 twins, and only the list frozen.ts pins by digest (TWINS). This is a pre-data ruling, made
    after 7 of the 16 calibration units got a passing second skin. The twin check's floor of 6 pairs is unchanged.

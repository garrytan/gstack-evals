# Wiring: open items

The binding in wire.ts, wire/real.ts and wire/host.ts connects the real providers to the lane's paid rows. Real providers exist only inside the ledger service's process on the controller host, and only after a row's start rules and ledger admission pass. Off that host every factory refuses with E_DCW_OFF_HOST. Nothing is built at import time, and keys are read by name when a provider is built.

The items below are choices the binding could not make without moving a scored outcome or the money, or pieces that are still unbuilt. Each needs the Captain's ruling or a later unit before the first paid launch.

## The wiring file

A host run reads one wiring file (wire/real.ts readWiring). A missing choice refuses with E_USAGE naming it.

1. **Retry budget.** The proxies' retry budget (paid item 1) is the file's `retry`. The Captain ruled it at 3 attempts within 15 minutes (wire/real.ts RULED_RETRY); a file that names another budget refuses with E_USAGE.
2. **Drift scan interval.** How often a session proxy's journal is read for drift (paid item 5) is the file's `scanMs`.
3. **Sessions section.** The gstack pin sources and the expected image digest come from the file's `sessions` section.
4. **VM section.** Ubicloud's project, location, VM size and image, the private subnet, the SSH key, the browser path, the price per hour, the VM proxy endpoint and the mirrors come from the file's `vm` section.

## Money

5. **J1 reconcile returns null.** The ledger provider's reconcile always returns null, so an unknown charge stays held until the owner's reconcile, as PD-18 rules. The sessions row prints a "held" line for it. The session-level reconcile is exact when the session proxy holds the attempt's meter, and `judged` is always false within one launch.
6. **Proxy folders and recovery.** Proxy journals sit under the service's journalDir in `direct/` and `sessions/`. Every slot a proxy binds is linked to its sub-reservation in `links/<folder>.ndjson` before anything is sent (money/journals.ts). On a same-host relaunch, recovery reads every journal with main's reconcileJournal and settles each held sub-reservation whose linked meters all show an outcome, at their spend. A sub-reservation with no link, a journal that could not be read, or a call with no outcome stays unknown under PD-18, and the scan is written to the state folder as `journals-<time>.json`. A relaunch on a new host has no journals to read, so everything in flight stays unknown.
7. **Terms digest.** A reply's termsDigest is the sha256 of the pinned routing terms, matching paid/pin.ts termsRecordsOf. It is not a fresh endpoints read per call. No row writes the `--terms` file from the pin record yet.

## Sessions

8. **Containment retry.** When a container fails C2 or C3, the binding prepares a fresh session folder from the same export instead of exporting again. One combined containPoint runs: after-install for the gstack arms, before-session otherwise. A second failure throws E_DCW_CONTAINMENT and stops the launch, leaving the admitted round in flight for the Captain.
9. **errorSeen.** The shared driver reports a non-success result after model output as harness_crash. run/stream.ts reads the session's stream: when the last top-level message before that result is Claude Code's rejection of the model's tool call (a tool_use_error naming an input validation failure or a tool that does not exist), the termination is malformed_tool_call. errorSeen comes from the attempt's session proxy journal (paid/sessions.ts errorSeen): a refusal, or an outcome that was an upstream error status, never sent or unknown, for the attempt's meter. A journal that cannot be read counts as an error seen. PD-17 then splits as run/session.ts endOf rules: errorSeen true is outside the agent (J1 retry, then infra-missing), false is an arm stop scored after its one fresh retry.
10. **backgroundWaitMs.** Resolved (PD-32): every arm's review session sets the driver's wait to frozen.ts BACKGROUND_WAIT, 3,600,000 ms, through run/arms.ts sessionSetup. See item 22.
10a. **The install network and the install digest.** The Captain's ruling 1F: the gstack arms' container joins the bridge install network only for `./setup`, before the session starts. After it leaves, run/docker.ts verifyInstall reads the container's networks and stops the session with E_DCW_INSTALL_NETWORK unless the trial network is the only one. It then reads every file of the pinned tree inside the container and stops the session with E_DCW_INSTALL_DIGEST when their digest differs from the pinned tree's, read on the host from the verified tree. Files `./setup` adds are not counted. Each session's digests and networks are written to its `install.json`.
11. **Evidence for the reference arm.** The sessions row now reads evidence files only for the full-information reference cell. Before this fix every other arm crashed with E_USAGE, because armPrompt refuses evidence for them.
12. **The exports layout.** Each unit's export folder holds `repo/` (with its evidence files), `plan.md`, `context/` and `c2.json`. No row writes `c2.json` or `stage3.json` yet.

## Controller host

13. **Provisioning.** The controller host provisions no Docker, no trial image and no gstack pin sources (money/controller-host.ts controllerProvision).
14. **Launch.** No cli row launches the controller host. wire/host.ts hostStage gives the plan's `stage` field, and host-main.ts runs the row through runOnHost.

## VM world and stage 3

15. **In-VM agents.** The VM provider binds the recipe agent (PD-31): wire/real.ts realVm builds stage3/agent.ts runVmAgent through vmSessionAgents, so the recipes row runs Claude Code from the pinned tarball in each recipe VM over SSH. Its model calls reach dc-base-apps' metering proxy through the VM proxy endpoint on a slot bound to the admitted sub-reservation, and the slot's bearer sits only in an env file under /run that the controller removes. The controller installs Claude Code only in a VM that reaches the proxy. Stage 3's pieces (the build agent, the build reader, stage 3 authoring and the DES-4 judges) are their own provider (wire.ts Stage3Provider). On the controller host it refuses with E_DCW_NO_PROVIDER before it reads a key or makes a VM, and the stage3 row builds it before the VM provider. runVmAgent already takes a build's env, but no build agent is bound until the Captain's go to start stage 3. tests/dc/wire/real.test.ts tests both ways, and wire/dryrun-cases.ts's PD-31 case fails if stage 3's pieces stop refusing.
16. **Stage 3's Opus block.** The stage3 row renders each candidate's Opus block with score/parse.ts renderList, from pass 1 and else pass 2, as frozen. Start rule 7 requires a stage 2 Opus pass 1 row for each candidate. The row settles the three stage 3 items at its end.

## Earlier wiring

17. **Validators' blocks.** wire.ts blockParser gives the author area's steps 5 and 6 the frozen lenient parse written for sessions (author item 8). The Captain kept it (PD-37).
18. **lens minus none.** The verdict row (wire/keyless.ts readRow) computes lens minus none from the contrast on the same cells, passes its unadjusted p as holm (the prereg names Holm only for the two primaries) and prints it labelled unadjusted. It reads the verdict through verdict() with the arm's own smoke and untested inputs, as read/dryrun-cases.ts's S10-reading case does, and reads "untested" when the lens didn't run or its contrast has no interval.

## Phase 1b open items

Each piece below is a choice the binding could not make without moving a scored outcome or the money, and each waits for the Captain. Items 19 to 21 need text or a format that neither the preregistration nor frozen.ts fixes, and each could move a stage 3 read; none is built, and each refuses until the Captain rules.

19. **The build reader.** Not frozen: Astra's blind forced-state read (its prompt, how the screenshot is sent, and how a reply maps to designed, blank, broken, raw-error or endless-spinner); the agent user's prompt for GPT-6.1 Sol, its action format, the form of the accessibility snapshot it gets each step, and which page state counts as seen before for a dead end; and the design-system literal read (which files are UI files, what counts as a colour or spacing literal, and when a project "has tokens"). The mechanical reads (axe-core at three widths, overflow at 375 and 768 pixels, targets under 44 pixels, the forced states' mechanical read and each key check) run on the key check bodies that stage 3 authoring defines, so they wait on item 20 too. PD-31 rules it: written before stage 3 starts as a pre-data deviation, read once on GPT-6 Astra as a read-only correctness review, and sent to the Captain with the request to start stage 3. Until that go it refuses with E_DCW_NO_PROVIDER (wire/real.ts, the stage3 factory).
20. **Stage 3 authoring.** Not frozen: Opus's prompt for the fixtures, key checks and scenarios, the JSON shape of a key check body and a scenario body (stage3/seams.ts keeps both opaque), Sol's audit prompt and its verdict format, and each call's output cap. PD-31 rules it: written before stage 3 starts as a pre-data deviation, read once on GPT-6 Astra as a read-only correctness review, and sent to the Captain with the request to start stage 3. Until that go it refuses with E_DCW_NO_PROVIDER (wire/real.ts, the stage3 factory).
21. **The DES-4 pairwise judge.** The question is frozen in prose (which screen looks designed for this product and its users rather than a generic template, or tie). Not frozen: the prompt text, how the two desktop and phone pairs are sent and in what order inside a pair, the reply format, and which reply is unparsable and so retried once before the read is missing. PD-31 rules it: written before stage 3 starts as a pre-data deviation, read once on GPT-6 Astra as a read-only correctness review, and sent to the Captain with the request to start stage 3. Until that go it refuses with E_DCW_NO_PROVIDER (wire/real.ts, the stage3 factory).
22. **backgroundWaitMs.** Resolved (PD-32): the driver's wait for background work at a turn's result is 3,600,000 ms in every arm (frozen.ts BACKGROUND_WAIT, set by run/arms.ts sessionSetup and passed by wire/real.ts). Each session's own limits still bind: its 90-minute timeout runs on, and a timeout while it sits idle on held work ends it as the driver's E_BACKGROUND_DEADLINE, read outside the agent. The sessions row prints, per arm and model, how many sessions background work held at their first result (the driver's session_end shows they sat idle), how many ended at the wait's deadline and how many ended another way with work still out (run/session.ts printBackgroundAtResult). run/dryrun-cases.ts's PD-32 case tests it.
23. **errorSeen's window.** Resolved (PD-33): errorSeen reads every error in the attempt's journal, as ruled ("inside the attempt"), so an upstream error the proxy retried and recovered from early in a session still makes a later malformed tool call outside the agent. The Captain kept this reading. The comments in wire.ts SessionDrive and run/session.ts endOf now say "inside the attempt".
24. **The rejected-call marker.** run/stream.ts matches Claude Code's tool_use_error text for an input validation failure or an unknown tool. It is checked against hand-written stream lines only, not a real CLI session at the pinned Claude Code version.
25. **The model probe's ledger item.** paid/pin.ts modelProbePlan lists one short call per model (16 output tokens) to run first after the go (ruling 1A). Which ledger item those five calls charge is not ruled, so runModelProbe takes the call from its caller and no row runs it yet.
26. **Start rule 9's provider compare.** Resolved: read/start.ts startRule9 compares with money/served.ts foldProvider (PD-20) and prints both raw names when only the spelling differs.
27. **The gate check's fix step (PD-21).** A planted drop item marked fix gets one fix call from its author and a second audit by both auditors on the fixed unit. The gate check skips step 3's re-screen of the fixed unit. A drop verdict on the item in the second audit counts as caught (an auditor drops it), and a second fix verdict counts as a miss, although PD-2 would drop the item from a production key. "The planted defect gone" is read as the statement or detail changed and the second audit keeping it. The Captain may rule a stricter read.
28. **Applying the re-priced caps (PD-30).** Built: the reprice row (wire/reprice.ts) runs before stage 2. Start rule 7 holds it until --stage1 records every stage 1 pass (a tier admitted, the twins tracking, the Opus judge check, the smoke rules and the admission read) and until the re-priced projection is within $5,000. For each item read/admission.ts projectionRerun re-prices, it records the new cap as a raise in main's approval record, the quote being the rerun's deviation line word for word, and writes repriced.json to its sink. Only items whose measured need passes their cap are re-priced; caps are never lowered, and a recorded re-pricing at or above a new need is kept. An item already admitted refuses. Each launch's ledger check (wire/start.ts admitItems) admits a recorded cap that is the frozen cap, or a raise above it whose quote is that item's deviation line, and sets the controller's cap to it; any other recorded cap, a hand raise included, refuses. wire/dryrun-cases.ts's PD-30 cases test it. The stage 2 sessions row itself checks no start rule 7 yet: nothing written by a row records stage 1's passes, so --stage1 is written by the run thread from the rows that read them.
29. **What counts as a session a drift stop cut (PD-25).** wire/sessions.ts reads an attempt as a drift stop when it ended other than completed and a provider drift stop covers its model and arm when it ends. A session that completed before the stop is read as completed. The Captain kept this reading (PD-36).

## Carried from the area notes

These stay open as their own notes describe them:

- money/NOTES.md items 10 to 16.
- stage3/NOTES.md items 1 to 16.
- paid/NOTES.md items 2, 3, 4, 6 and 7.
- run/NOTES.md items 11 to 14 and 16.

## Not verified here

The tests drive the real providers keyless, with fakes only at the lowest seams. These paths have not run: the real Docker path (containerLauncher, the review container and the trial network), live Ubicloud, the real Playwright browser inside a VM, and any real model.

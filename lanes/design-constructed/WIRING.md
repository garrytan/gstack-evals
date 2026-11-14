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
10. **backgroundWaitMs.** Neither the preregistration nor the plan freezes a value, so the driver's wait stays unset. See Phase 1b open items.
10a. **The install network and the install digest.** The Captain's ruling 1F: the gstack arms' container joins the bridge install network only for `./setup`, before the session starts. After it leaves, run/docker.ts verifyInstall reads the container's networks and stops the session with E_DCW_INSTALL_NETWORK unless the trial network is the only one. It then reads every file of the pinned tree inside the container and stops the session with E_DCW_INSTALL_DIGEST when their digest differs from the pinned tree's, read on the host from the verified tree. Files `./setup` adds are not counted. Each session's digests and networks are written to its `install.json`.
11. **Evidence for the reference arm.** The sessions row now reads evidence files only for the full-information reference cell. Before this fix every other arm crashed with E_USAGE, because armPrompt refuses evidence for them.
12. **The exports layout.** Each unit's export folder holds `repo/` (with its evidence files), `plan.md`, `context/` and `c2.json`. No row writes `c2.json` or `stage3.json` yet.

## Controller host

13. **Provisioning.** The controller host provisions no Docker, no trial image and no gstack pin sources (money/controller-host.ts controllerProvision).
14. **Launch.** No cli row launches the controller host. wire/host.ts hostStage gives the plan's `stage` field, and host-main.ts runs the row through runOnHost.

## VM world and stage 3

15. **In-VM agents.** The recipe and build agents exist (stage3/agent.ts runVmAgent, bound by wire/real.ts vmSessionAgents): Claude Code from the pinned tarball runs in the VM over SSH, its model calls reach the item's metering proxy through the VM proxy endpoint on a slot bound to the admitted sub-reservation, and the slot's bearer sits only in an env file under /run that the controller removes. The build reader, stage 3 authoring and the pairwise judges wait on the Phase 1b open items below, so the VM provider still refuses with E_DCW_NO_PROVIDER before it reads a key or makes a VM.
16. **Stage 3's Opus block.** The stage3 row renders each candidate's Opus block with score/parse.ts renderList, from pass 1 and else pass 2, as frozen. Start rule 7 requires a stage 2 Opus pass 1 row for each candidate. The row settles the three stage 3 items at its end.

## Earlier wiring

17. **Validators' blocks.** wire.ts blockParser gives the author area's steps 5 and 6 the frozen lenient parse written for sessions (author item 8). The Captain may rule the strict parse for validators instead.
18. **lens minus none.** The verdict row (wire/keyless.ts readRow) computes lens minus none from the contrast on the same cells, passes its unadjusted p as holm (the prereg names Holm only for the two primaries) and prints it labelled unadjusted. It reads the verdict through verdict() with the arm's own smoke and untested inputs, as read/dryrun-cases.ts's S10-reading case does, and reads "untested" when the lens didn't run or its contrast has no interval.

## Phase 1b open items

Each piece below is a choice the binding could not make without moving a scored outcome or the money, and each waits for the Captain. Items 19 to 21 need text or a format that neither the preregistration nor frozen.ts fixes, and each could move a stage 3 read; none is built, and each refuses until the Captain rules.

19. **The build reader.** Not frozen: Astra's blind forced-state read (its prompt, how the screenshot is sent, and how a reply maps to designed, blank, broken, raw-error or endless-spinner); the agent user's prompt for GPT-6.1 Sol, its action format, the form of the accessibility snapshot it gets each step, and which page state counts as seen before for a dead end; and the design-system literal read (which files are UI files, what counts as a colour or spacing literal, and when a project "has tokens"). The mechanical reads (axe-core at three widths, overflow at 375 and 768 pixels, targets under 44 pixels, the forced states' mechanical read and each key check) run on the key check bodies that stage 3 authoring defines, so they wait on item 20 too.
20. **Stage 3 authoring.** Not frozen: Opus's prompt for the fixtures, key checks and scenarios, the JSON shape of a key check body and a scenario body (stage3/seams.ts keeps both opaque), Sol's audit prompt and its verdict format, and each call's output cap.
21. **The DES-4 pairwise judge.** The question is frozen in prose (which screen looks designed for this product and its users rather than a generic template, or tie). Not frozen: the prompt text, how the two desktop and phone pairs are sent and in what order inside a pair, the reply format, and which reply is unparsable and so retried once before the read is missing.
22. **backgroundWaitMs.** The preregistration and the plan give no value for the driver's wait for background work at a turn's result. Unset, a session ends at its first result with background work still out, and the driver logs it. Other lanes use 3,600,000 ms (src/adapters/claude-code/driver.ts BACKGROUND_WAIT_MS).
23. **errorSeen's window.** errorSeen reads every error in the attempt's journal, as ruled ("inside the attempt"), so an upstream error the proxy retried and recovered from early in a session still makes a later malformed tool call outside the agent. wire.ts's SessionDrive comment says "the session's last exchange". The Captain may narrow it.
24. **The rejected-call marker.** run/stream.ts matches Claude Code's tool_use_error text for an input validation failure or an unknown tool. It is checked against hand-written stream lines only, not a real CLI session at the pinned Claude Code version.
25. **The model probe's ledger item.** paid/pin.ts modelProbePlan lists one short call per model (16 output tokens) to run first after the go (ruling 1A). Which ledger item those five calls charge is not ruled, so runModelProbe takes the call from its caller and no row runs it yet.
26. **Start rule 9's provider compare.** Resolved: read/start.ts startRule9 compares with money/served.ts foldProvider (PD-20) and prints both raw names when only the spelling differs.
27. **The gate check's fix step (PD-21).** A planted drop item marked fix gets one fix call from its author and a second audit by both auditors on the fixed unit. The gate check skips step 3's re-screen of the fixed unit, and it counts a second-audit fix or drop on the item as a catch only through PD-2 (the item then never reaches the key); author/gatecheck.ts records it as not caught. "The planted defect gone" is read as the statement or detail changed and the second audit keeping it. The Captain may rule a stricter read.
28. **Applying the re-priced caps (PD-30).** read/admission.ts projectionRerun returns each re-priced cap and prints it as a deviation. No row writes those caps into the ledger yet, and only items whose measured need passes their cap are re-priced; caps are never lowered.
29. **What counts as a session a drift stop cut (PD-25).** wire/sessions.ts reads an attempt as a drift stop when it ended other than completed and a provider drift stop covers its model and arm when it ends. A session that completed before the stop is read as completed.

## Carried from the area notes

These stay open as their own notes describe them:

- money/NOTES.md items 10 to 16.
- stage3/NOTES.md items 1 to 16.
- paid/NOTES.md items 2, 3, 4, 6 and 7.
- run/NOTES.md items 11 to 14 and 16.

## Not verified here

The tests drive the real providers keyless, with fakes only at the lowest seams. These paths have not run: the real Docker path (containerLauncher, the review container and the trial network), live Ubicloud, the real Playwright browser inside a VM, and any real model.

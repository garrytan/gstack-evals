# Wiring: open items

The binding in wire.ts, wire/real.ts and wire/host.ts connects the real providers to the lane's paid rows. Real providers exist only inside the ledger service's process on the controller host, and only after a row's start rules and ledger admission pass. Off that host every factory refuses with E_DCW_OFF_HOST. Nothing is built at import time, and keys are read by name when a provider is built.

The items below are choices the binding could not make without moving a scored outcome or the money, or pieces that are still unbuilt. Each needs the Captain's ruling or a later unit before the first paid launch.

## The wiring file

A host run reads one wiring file (wire/real.ts readWiring). A missing choice refuses with E_USAGE naming it.

1. **Retry budget.** The proxies' retry budget (paid item 1) is the file's `retry`. The binding sets no default.
2. **Drift scan interval.** How often a session proxy's journal is read for drift (paid item 5) is the file's `scanMs`.
3. **Sessions section.** The gstack pin sources and the expected image digest come from the file's `sessions` section.
4. **VM section.** Ubicloud's project, location, VM size and image, the private subnet, the SSH key, the browser path, the price per hour, the VM proxy endpoint and the mirrors come from the file's `vm` section.

## Money

5. **J1 reconcile returns null.** The ledger provider's reconcile always returns null, so an unknown charge stays held until the owner's reconcile, as PD-18 rules. The sessions row prints a "held" line for it. The session-level reconcile is exact when the session proxy holds the attempt's meter, and `judged` is always false within one launch.
6. **Proxy folders and recovery.** Proxy journals sit under the service's journalDir in `direct/` and `sessions/`. Recovery does not scan them yet, so a relaunch after a host loss does not read a proxy's journal.
7. **Terms digest.** A reply's termsDigest is the sha256 of the pinned routing terms, matching paid/pin.ts termsRecordsOf. It is not a fresh endpoints read per call. No row writes the `--terms` file from the pin record yet.

## Sessions

8. **Containment retry.** When a container fails C2 or C3, the binding prepares a fresh session folder from the same export instead of exporting again. One combined containPoint runs: after-install for the gstack arms, before-session otherwise. A second failure throws E_DCW_CONTAINMENT and stops the launch, leaving the admitted round in flight for the Captain.
9. **errorSeen.** PD-17 reads a malformed tool call by whether an API, provider or harness error was seen. The Claude Code driver never reports malformed_tool_call, so errorSeen is always false.
10. **backgroundWaitMs.** The driver's wait for a background task at the first result is unset.
11. **Evidence for the reference arm.** The sessions row now reads evidence files only for the full-information reference cell. Before this fix every other arm crashed with E_USAGE, because armPrompt refuses evidence for them.
12. **The exports layout.** Each unit's export folder holds `repo/` (with its evidence files), `plan.md`, `context/` and `c2.json`. No row writes `c2.json` or `stage3.json` yet.

## Controller host

13. **Provisioning.** The controller host provisions no Docker, no trial image and no gstack pin sources (money/controller-host.ts controllerProvision).
14. **Launch.** No cli row launches the controller host. wire/host.ts hostStage gives the plan's `stage` field, and host-main.ts runs the row through runOnHost.

## VM world and stage 3

15. **In-VM agents.** The VM provider refuses with E_DCW_NO_PROVIDER, before any key read or VM, because the recipe agent, the build agent, the build reader, stage 3 authoring and the pairwise judges have no real implementation.
16. **Stage 3's Opus block.** The stage3 row renders each candidate's Opus block with score/parse.ts renderList, from pass 1 and else pass 2, as frozen. Start rule 7 requires a stage 2 Opus pass 1 row for each candidate. The row settles the three stage 3 items at its end.

## Earlier wiring

17. **Validators' blocks.** wire.ts blockParser gives the author area's steps 5 and 6 the frozen lenient parse written for sessions (author item 8). The Captain may rule the strict parse for validators instead.
18. **lens minus none.** The verdict row (wire/keyless.ts) reads the lens minus none verdict from its input file. No row computes it from the contrast yet.

## Carried from the area notes

These stay open as their own notes describe them:

- money/NOTES.md items 10 to 16.
- stage3/NOTES.md items 1 to 16.
- paid/NOTES.md items 2, 3, 4, 6 and 7.
- run/NOTES.md items 11 to 14 and 16.

## Not verified here

The tests drive the real providers keyless, with fakes only at the lowest seams. These paths have not run: the real Docker path (containerLauncher, the review container and the trial network), live Ubicloud, the real Playwright browser inside a VM, and any real model.

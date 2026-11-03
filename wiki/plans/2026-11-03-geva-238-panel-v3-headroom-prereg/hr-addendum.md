# Kit v3.1 addendum for headroom units

This addendum changes kit v3.1 for one authoring wave: eight headroom units on four public code bases. Read author-spec.md and audit-brief.md first. Where this file says nothing, the kit holds. Where it differs, this file wins for this wave only.

Headroom units are larger and more code-heavy than calibration units. A unit's src/ is a real open-source code base, pruned to the part the product needs, with your planted changes. Each candidate item depends on what the code does a few calls away from anything the plan names, so a reviewer finds it only by following the plan's claims into the code.

## Your assignment

Your assignment names one base and two units on it, each with its own stratum, mode and anchor place (context or src). The base is a public repository under the MIT, BSD-2-Clause or BSD-3-Clause licence, checked out at a pinned 40-hex commit in the folder the assignment gives. Both of your units use that base. Write each unit as a different fictional company that adopted the base's code as its own product, with its own plan, team documents and planted changes.

## What a unit is here

The kit's unit layout holds (plan.md, context/, src/, key.json and nothing else), with these changes:

- **plan.md**: as the kit says, 7,000 to 11,000 bytes in 6 to 12 sections. It names the modules it changes, as a real plan would: packages, services or folders, and the entry files a team would cite. It names none of the files that hold a keyed item's deciding code (no hop file of any candidate, with or without its src/ prefix).
- **context/**: as the kit says, at least 6 flat team documents, and at most 20.
- **src/**: a coherent slice of the base at the pinned commit: the packages and modules the product needs, with their own folder structure. Keep every upstream copyright and licence header. Keep the base's licence text as src/LICENSE.txt or src/LICENSE.md, because the checker refuses a file with no allowed extension. Remove every file the kit refuses: hidden paths, symlinks, auto-loaded files (AGENTS.md, CLAUDE.md, SKILL.md and the rest of the kit's list), @-imports, files that are not UTF-8 text, and files whose extension the checker does not accept (for example go.mod, go.sum, Makefile, a bare LICENSE). In ceo, eng and dx units, remove every UI file. Then plant your changes.
- **Size**: the unit tree (plan.md, context/ and src/) holds 307,200 to 491,520 bytes (300 to 480 KiB) in 150 to 600 files across at least 12 folders. Measure it the way the build does: commit the unit in a scratch git repository and read `git ls-tree -r -t -l HEAD` (blob sizes summed, blobs counted, trees counted). key.json is not part of the tree.
- The kit's limits on src/ (at most 12 files, each at most 5,000 bytes) and on context/ and src/ together (10 to 20 files, 20,000 to 45,000 bytes) do not apply. The rule that context/ holds at least 6 files still applies.

The company, people, numbers, documents and planted changes are fictional. The code is the base's real code, so the kit's rule against real material covers everything except the base's own files.

## Candidate items

Each unit keeps the kit's calibration recipe: one candidate of each of its stratum's three kinds, then one anchor. Each candidate keeps its kind, its two levers and its key fields exactly as the kit defines them. Every candidate also meets four code-heavy rules:

1. **Origin set.** The origin set is every file path and symbol plan.md names, plus each named module's entry file (its index, __init__, main, or the file its package manifest names).
2. **Trace.** At least one fact the item needs is a behavior of code under src/ that a reviewer reaches through at least two hops from the origin set. A hop is a call, an import, or a config, registry or route lookup. The hop files are at least two distinct src/ files, and plan.md names none of them.
3. **Planted terminal line.** The behavior is a line you planted or changed. The terminal file (the last hop's file) differs from the base's file at the pinned commit at that line. Upstream behavior never decides an item, so a reviewer who remembers the base can't decide one.
4. **Stated nowhere.** No comment, docstring, README, doc, test name or commit message states the behavior. Upstream comments that describe the code's original intent may stay; your change must not come with one that describes it.

Shapes by stratum, as examples only: a premise metric whose event filter drops a segment (ceo), a retry path whose callee writes before it checks (eng), an SDK default set two modules below the client the quickstart uses (dx), a token alias chain that resolves to a failing contrast, or a component prop the renderer ignores (design).

For an H2 item the trace usually yields one of the two places; for a QT item, one of the numbers; for an OM item, the fact that makes the step required; for a CD item, the code fact itself. The kind's own key field (intermediate, computation, absent_step, code_fact) still states the whole item, and every kit rule for the kind still holds.

## Anchors

Each unit's anchor uses no lever and no trace, as the kit says. Its place comes from your assignment:

- **context**: one fact in one context/ file, as in the kit.
- **src**: one fact on a line you planted or changed in a src/ file that plan.md names, readable in that file without following any call.

Across the slice, each stratum gets one context anchor and one src anchor. Together they check that the rig works and that reviewers read src/.

## key.json

The kit's calibration key.json holds, with two additions.

Each candidate item adds a `trace` object:

    "trace": {"origin": "<a path or symbol plan.md names, or a named module's entry file>",
      "hops": [{"file": "src/<path>", "symbol": "<function, class, config key or route>"},
               {"file": "src/<path>", "symbol": "<...>"}],
      "terminal": {"file": "src/<path>", "line": <1-based line number>,
        "upstream_path": "<the terminal file's path in the base at the pinned commit>",
        "behavior": "<one sentence: what that line does>"}}

List every hop in order, at least two, ending with the terminal file. The terminal file is the last hop's file, and it must be a base file you changed, not a file you added.

The anchor item adds `"anchor_place": "context"` or `"anchor_place": "src"`, as your assignment gives it.

## The check

Run the kit's checker as the kit says. For this wave, a unit passes when its only problems are:

- the size and count lines this addendum lifts: `context-size`, `src-files`, `src-size`, and the `context-files` line "context/ and src/ hold N files, want 10 to 20";
- `echo`, `echo-heading`, `echo-path` and `signpost` hits in base files you did not change (byte-identical to the pinned commit). The custodian checks each of these with git.

Every other line must be gone, including `clean-room` (symlinks report as clean-room), `auto-load`, `layout`, `ui-scope`, `plan-size`, `plan-sections` and the `context-files` line "context/ holds N files, want at least 6". Files you wrote or changed must be clean of every code.

Before you report, also check for each unit: the size, file and folder counts above; for each candidate, that `git diff` against the pinned commit shows the terminal line changed; that plan.md names no hop file; and that no comment, docstring, doc or test name near the trace states the behavior.

## Audit

The auditor runs kit v3.1's audit brief with two changes.

**[F], findability, read for this wave.** A careful reviewer who checks each claim the plan makes about existing code by following it into the code (calls, imports, config) reaches the fact without guessing. A reviewer is not expected to read every file in a unit this size.

**CH sub-test, for every candidate.** Walk the trace hop by hop and fail the item, under the code named, when:

- `CH-hop`: a hop does not hold as written (the symbol is missing from its file, or does not call, import or look up the next hop), or the trace has fewer than two hops past the origin set;
- `CH-named`: plan.md names a hop file, with or without its src/ prefix;
- `CH-upstream`: the terminal line matches the base at the pinned commit, so upstream behavior decides the item;
- `CH-stated`: a comment, docstring, README, doc, test name or commit message states the behavior.

Report the CH sub-test's counts per code beside the kit's codes. Each item gets at most one fix round; an item that still fails is excluded in the manifest, except an anchor: an anchor that still fails its fix round is never excluded, and the build stops until the Captain decides. A unit is never dropped for a unit-level failure, only flagged.

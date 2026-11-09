# Plan-eng-review intentions eval

Code for the preregistration in wiki/plans/2026-11-08-geva-405-eng-review-intentions-prereg/. Nothing here holds unit
text, keys or reviews; they stay sealed outside the repo, and the repo gets counts and digests only.

## authoring side

Free mining, the supply recount and authoring (sections 3, 4, 16 and 17). Every command that can spend runs through
lanes/product-value/meter.ts on the ledger item it names. Unit material is plaintext only under /dev/shm/er (mode
0700); sealed copies are age-encrypted to the eng-review recipient.

- er frame (author/frame.ts): the widened frame by topic searches per type, and the free supply recount per type, with
  and without copyleft.
- er mine (author/mine.ts): one clone's candidate units and their aftermath candidates (B by SZZ with blame ranges, R,
  T and C), and the plan text at the 120-word floor.
- er author (author/run.ts): repo/, plan.md, key.json, two audits and the foreseeable ratings, resumable, replies cached.
- er classify (author/classify.ts): the frozen type rule; Opus and Sol label, Gemini settles a split.
- er sets (author/sets.ts): the calibration, comparison and reserve draws with the units digest, and the drop step for
  the sealed T-G and H task lists.
- author/prompts.ts: section 4's frozen plan rewrite and the key, audit, foreseeable and fix prompts, pinned by sha256.
- lanes/real-outcome/mine/szz.ts: blame merges consecutive lines into one -L a,b range (section 16, item 2).

### Build-time choices

The prereg names these rules without their mechanics. Each choice is the simplest one that serves its words, and
tests/er drives each in both directions.

1. Paths: real-outcome's path classes, widened to every common language (Kotlin, Java, Swift, Dart, C#, C and C++,
   Ruby, PHP and more) and their test layouts. CI, test-lane and eval files are never source.
2. Kind: a conventional title prefix decides first, then the pull request's labels, then defect, dependency, release,
   docs and chore words in the title, then the files. Refactors and performance changes count as chores. The body is
   not read, so a feature's "Fixes #12" line never makes it a fix.
3. Merge time: the pull request's mergedAt, else the first-parent commit's committer date.
4. Plan text: the earliest recoverable description and closing-issue bodies (issues opened before the merge), with
   HTML comments dropped, counted in words. No pull request or no recoverable description means no plan text.
5. Licence: LICENSE (or COPYING) at base is read by its text and must state the licence GitHub reports.
6. B sites: the nearest function declaration above each blamed line, else git's hunk header. Touched functions use
   the same read on the real diff's new side.
7. T candidates: a later change that adds or edits a test file the unit touched, a test file whose name holds a unit
   source file's stem, or a unit source file beside its test edits, and is not a B candidate. C candidates: a later
   change to a CI, test-lane or eval file whose diff names a unit file, stem or directory, or that also touches the
   unit's files. The key writer keys only these candidates, at most one item each.
8. Clones may be shallow back to 2026-05-01: older lines blame to a commit no in-window change owns, as with a full
   clone.
9. Frame: product-value's topic searches per type ("other" is developer tools), up to 10 pages a topic. A repository
   found under several types takes the first in the frozen rule's order. The type stays provisional until er classify.
10. Recount sample: seeded order until 10 usable repositories a type and at least 4 usable in each licence group (or
    the group runs out), at most 45 tries. Usable: the clone works, at least 20 first-parent changes in the window,
    tests at the head. Keyable as GEVA-405 counted it: a defect revert or a B candidate of at least 2 blamed lines; a
    wider read adds C. The aftermath rule, then the per-repository cap, apply in seeded order. Projection: capped
    keyable units per tried repository times the frame, raw and at 45% B precision.
11. repo/: written from the base tree's raw blobs, submodules left out, one fast-import commit by "unit
    <unit@example.invalid>" at the base's committer date, no remote.
12. Audits: each auditor runs an input audit on plan.md (with the key's statements, for the signpost check), a key
    audit and the foreseeable rating. A statement over 30 words, an item dated outside its window, an unknown candidate,
    a fix verdict, a missing candidate or an unreviewed item fails the round; an item either auditor drops is removed.
    One fix round, then a second failure drops the unit. The input audit reads plan.md only; repo/ is the base tree by
    construction.
13. Primary order: B (defect revert, then a fix whose linked issue someone outside the maintainers opened, then other
    fixes), then C, then T, then sha256("20261108\n" + unit + "\n" + item). A unit with no primary item drops at
    authoring; the score side's generic screen may drop more.
14. Unit id: "er-" and 10 hex of sha256("20261108\n" + candidate id). UnitMeta gains aftermath (additive in types.ts):
    the changes its aftermath candidates name, for the rule that no two units hold each other.
15. Classify: the README at the root of repo/, cut at 3,000 words; description and topics as read at authoring, since
    GitHub keeps no history of them. Every classifier call runs at high effort.
16. Sets: audited means unit.json, a classifier label and a primary item neither generic nor mentioned. Pilot units may
    be drawn. Quotas take each type's first units in seeded order (sha256("20261108\n" + id)); the comparison set's free
    places take the next units of any type. E_ER_SUPPLY_SHORT stops a draw with a type short of 4 calibration or 10
    comparison units, or under 48 comparison units in all; transposition is the Captain's call. The units digest is
    sha256 over the sorted lines of id and the hashes of unit.json, plan.md, key.json and the repo/ tree.
17. Drop: a repository matches case-insensitively and a commit of at least 7 hex as a prefix of the merge or base
    commit. Matched units are deleted; matched candidates become ineligible. Counts only.

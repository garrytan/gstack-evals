# Real-outcome mining (B1)

Keyless mining for the real-world outcome lane (plan wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan, section 2
and open item 12). Nothing here calls a model or runs a repository's code; it reads full git clones and public GitHub
metadata.

1. `gstack-evals real mine sample --from repos.json --mined-at <date>` filters candidate repositories: language
   (TypeScript, JavaScript, Python, Go, Rust), licence (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause), a push in the last
   30 days, at least 20 first-parent commits in the window when counted, a known test runner with tests, a lockfile, no
   project `.claude/` or `.mcp.json`, and no package that ships in the gstack arm or the runtime layer
   (`--exclude-packages`). garrytan/gstack goes to the dev pool, never scored; other garrytan repositories are the
   labelled gstack-shipped stratum. The kept list prints with its sha256; B3 freezes both before screening.
2. `gstack-evals real mine fetch-meta --repo <owner/name> --since 2026-07-01 --out meta.json` writes merged pull
   requests, their commits' dates and their closing issues from GitHub's GraphQL API through gh.
3. `gstack-evals real mine repo --repo-dir <full clone> --repo <owner/name> --meta meta.json --mined-at <date>` mines
   one repository:
   - A change is one first-parent commit on the default branch (a merge commit counts as its pull request's net change),
     merged on or before the mining date. Later changes never enter SZZ or revert pairing, so a run is as of that date.
   - Its exposure is the earliest of its closing issues opening, its pull request opening and its commits' author and
     committer dates, from both the metadata and the clone. It is eligible only when that exposure is on or after the
     window start (2026-07-01) and complete; the strict stratum starts 2026-10-01. A pull request with more closing
     issues or commits than the metadata read is incomplete.
   - K2 closes an issue; K3 does not. Both must touch source and tests, touch at least 2 non-test source files or add at
     least 80 non-test source lines, change no dependency (lockfiles, manifest dependency sets), have no Rust inline
     test edits and hold no Claude project config at base.
   - K1 by SZZ: a fix (its text or labels name a defect) that touches tests has its edited source lines blamed (`git
     blame -w -M`, blank and comment lines skipped) at its parent; the in-window change owning the most blamed lines is
     the introducer. K1 by revert: a revert that cites a defect pairs the reverted change with its re-land, whose tests
     are the escaped-defect tests. Product reverts pair nothing. A reverted change is not a K2 or K3 task, and a K1
     introducer is not also a K3 task.
4. `gstack-evals real mine panel --from <mine.json>... --seed <text>` keeps at most 3 eligible tasks per repository,
   K1 first, then a seeded hash order, never two tasks that share an upstream change.

Tests: tests/real/mine.test.ts runs every rule on a fixture repository written with git fast-import.

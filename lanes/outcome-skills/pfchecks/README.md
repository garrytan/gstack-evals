# The pstack-checks scoring core (PF)

The keyless scoring core for the preregistration in wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/README.md (the
post, from plan v2). The post is the source of truth; this file records the rules as built and the readings this build
chose where the plan leaves a detail open. It reuses the state machines harness (lanes/outcome-skills/statemachines/)
read-only. Out of scope here: the arm texts, the session runner and its two turns, the tools volume, the pstack plugin
mount, ledger leases and the dry run on real units.

## Commands

`gstack-evals outcome pf --help` lists them: `draw`, `told`, `neutral`, `score`, `analyze`, `admission`, `reprice` and
`items`. Every refusal prints its reason code first (docs/errors.md, codes E_PF_*).

## Files

- prereg.ts: prereg.json (pf-prereg.v1, draw_seed, order_seed, bootstrap_seed, unsigned 32-bit). E_PF_SEED otherwise.
- draw.ts: section 2's draw over #290's candidates.json. told.ts: the told-mode screen. neutral.ts: the neutral edit and
  its validation. capture.ts and sh/capture.sh: section 6.1. transplant.ts: 6.2. trees.ts: 6.3. manifest.ts: 6.4.
  runner.ts: 6.5 to 6.8. secondaries.ts: section 9. exposure.ts: section 8. analysis.ts: section 12. admission.ts:
  sections 10 and 13. items.ts: the frozen items and prices. score.ts: one session to a pf-catch.v1 record.

## Entry points for the session build step

- The session runner runs `sh/capture.sh inventory <repo>` before the task turn and `sh/capture.sh commit <repo> <inventory>`
  at its end, in the session container, and keeps the PF_CAPTURE and PF_FORCED lines (capture.ts readCapture).
- `outcome pf score --s <S repo> --unit <unit dir> --neutral <neutral record> --checks <CHECKS.json> --session <session.json>`
  scores one session. The session record fields it reads: model, arm, gap (E_PF_UPSTREAM_GAP or E_PF_INFRA_GAP after the
  retry rules), wrapup_end ("limit..." when the wrap-up turn hit a limit), forced (the force-captured paths) and
  transcript (sdk-messages.jsonl). Tool volume and plugin dir come in as `--mount <spec>` and the environment as `--env K=V`.

## Readings this build chose

Draw and screens
- One seededRandom(draw_seed) shuffles each month once, months in the order the draw first walks them (March to June
  2026, then July 2026, then February 2026 back to January 2025). Ids are sorted before each shuffle.
- The reserve units pass every gate and count toward the 3-per-repository cap, like kept units.
- A candidate skipped for the cap is not asked; counts only grow, so it stays skipped.
- A gate whose input file is missing stops the walk with E_PF_PENDING and names the candidate. Gate order: labels,
  oracle, told, neutral. Label files are pf-labels.v1 ({ labels: { id: { astra, opus } } }); earlier files win, so list the
  state machines eval's records first. combineLabels decides: both defect and both state-shaped, else E_PF_LABELS
  (not_defect, not_state_shaped, unclear or malformed). An oracle verdict other than kept drops as E_PF_ORACLE.
- Strata tags: july-2026, jan-jun-2026 (January to June 2026) and pre-2026, as the post names them.
- Told screen: characters are code points. The diff-block rule reads raw line starts. The fix's added lines come from
  fix.patch as published; a line counts at 30 code points or more after trimming both ends, and matches an issue line
  that is equal after trimming. Two distinct such lines drop the unit.

Neutral tree
- Comment table: "//" for rust, java, c, cpp, csharp, go, js and ts; "#" for python. Text: "gstack-evals neutral line".
- A shebang is "#!" not followed by "["; Rust's "#![" is an inner attribute and gets the line above it. An encoding
  line (PEP 263 form) on line 1 or 2 is skipped. A PHP opening tag on line 1 is skipped.
- A file with no final newline gains one before the end line and still ends without one. CRLF files get CRLF lines.
- The files are the non-test source files in fix-source.patch (or fix.patch when prep did not split) that exist at base.
- Validation runs with the oracle's base patches (test.patch and fix-tests.patch), the unit's rebuild rule, and a null
  run (stopped, or built nothing) counts as every test failing.

Capture and transplant
- The inventory leaves out .git and the build-output names at any depth; symlinks hash their target text; paths with a
  tab or newline are skipped. Deleted paths are staged with git rm --cached. "Forced" is what git check-ignore reports.
- Deleted files that are not test files are restored (source, protected configuration and other files alike); only
  deleted source files count as product edits.
- Existing files that are neither source nor test (docs, data, resources) stay as S has them, as the plan's "everything
  else in S is kept" reads.
- A source file whose hunks all sit inside test modules is not a product edit.

Trees and runs
- All three trees are one commit with parent S, identity scoring <scoring@localhost>, date 2000-01-01T00:00:02Z and
  message "scoring tree". In each run the tree sits on branch main of a clone with no remote.
- The rebuild has the oracle's 900-second limit only as part of the container's outer limit (rebuild limit plus the
  entry timeout plus 60 seconds); the entry runs under coreutils timeout when the image has it, else under that outer
  limit. Exit 124 or a kill reads as a timeout. Markers carry a per-run nonce, so an entry cannot print its own result.
- Parent runs 2 and 3 stop at the first pass, since a pass already rules out both the catch and red-on-parent.
- After the ceiling no run starts; runs in flight finish. The compile-blocked reruns share what is left of the ceiling.
- A session with an entry gap (fix-tree rebuild failure) and no catching entry scores a gap; any catch scores 1.

Manifest
- An element that is not an object makes the file "no manifest" (section 5); an object whose command is missing, empty
  or not a string is skipped (section 6.4). An empty array is a manifest with no entries (score 0).
- Interpreter flags are read after the interpreter word up to the first word that is not a flag, "--", or python's -m.
  A short-flag cluster holding c or e (-ec, -ne) and --eval count. "<<" and "<(" or ">(" count anywhere in the command.
- Tokens split on whitespace, quotes, backticks, =, :, comma, # and /. A test name is the basename, the basename less its
  last extension, or the basename less everything from its first dot. Test files use the unit language's patterns plus
  its test.patch files. Common words such as "test" can name something, as the rule reads.
- A model file is a token ending in a frozen extension (.tla .cfg .pcal .als .pml .smv .qnt).

Secondaries and exposure
- Checker list: tlc2.TLC, tla2tools.jar, a script under a statechart/ skill dir, apalache, quint run/verify/test,
  spin -, NuSMV or nuXmv, an Alloy jar.
- P loaded: the heading text anywhere in a transcript record, and a Read whose path ends in statechart/SKILL.md.
- Aimed: a new or edited file's text holds a fix file's path or basename as a whole name.
- Static text: a command word grep, egrep, fgrep, rg, sed, awk or gawk; or an entry naming a new test file that holds a
  quoted string whose last path segment is a product source file's basename.
- Sync gate: the first fix-run failure log matches a frozen list (stale, out of sync, not in sync, resync, sync check,
  git diff --exit-code or --quiet), or the command runs git diff or git status.
- Compile-blocked: an error line (or the line after it, where rustc prints the location) names an agent-added file the
  entry does not name by path, basename or stem. Compile units: Go package dir, nearest Cargo.toml, nearest pom.xml or
  build.gradle. Other languages have none.
- Drift and API guess use #290's drift forms and decision with host git grep over the parent and fix commits.

Analysis and money
- A pooled verdict is INCOMPLETE when any of its cells (any model, either arm) has gaps on more than 10% of units.
- Pooled Holm runs over the two bootstrap p values; per-model Holm over the two exact McNemar p values.
- The process contrast reads as a fair test when at least 75% of P sessions loaded the skill and ran a checker.
- Re-price: per session and arm, Opus 1.2 x its measured mean, Sol and particle-1 max(planning, 1.5 x measured mean); an
  item's cap for n units is n x (the three arms' prices plus three $0.40 VMs), rounded up to $10. The margin is in the
  price, so the cap adds no second 1.2. At planning prices this gives Opus $580 at n = 28, the post's cap.
- What is left of the line is $1,960 less the spend recorded so far less the crew use still held back (both inputs).
- The mid-run check projects spend so far plus the remaining units at the new price against the item's cap.

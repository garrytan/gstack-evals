---
id: 2026-11-07-geva-390-e2-detector-cd-amendment
kind: plan
title: "E2 prereg amendment: the methodology call may follow one leading cd, and the R61 re-read prediction is rewritten"
summary: "R61's re-read found session 2's DX and Eng methodology calls behind a cd prefix, which the merged detector rejects. One leading cd to a plain path now counts. Caps unchanged."
author: GEVA-390
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-07
status: open
links:
  - 2026-11-07-geva-387-e2-autoplan-exposure-prereg
  - 2026-11-07-geva-384-r61-autoplan-gate-results
  - lanes/outcome-skills/arms/exposure.ts
  - tests/outcome-skills/exposure.test.ts
---

# E2 prereg amendment: the methodology call may follow one leading cd

GEVA-390 for the Captain (GEVA-2). This amends the [E2 prereg](2026-11-07-geva-387-e2-autoplan-exposure-prereg.md) and spends nothing. It changes three things: the detector's sole-call rule, the detector sha256 and run commit that follow from it, and the R61 re-read prediction. Everything else in the prereg holds, caps included.

## Why

Start rule 4 re-read R61's two sealed sessions with the merged detector (exposure.ts 7cef2d61...3d80) before any lease. The frozen detector read 0 of 2, as predicted, and session 1 read as predicted. Session 2 did not: it read not exposed on review_skills_loaded, where the prediction said exposed with all four checks true.

A counts-only diagnostic under custody found the cause. In session 2, each phase's one methodology call started with `cd <dir>;` and then ran the call with unquoted paths, and the DX and Eng calls were piped once into python3. The merged sole-call rule rejects any `;`, so the methodology-file rule never opened for DX or Eng. Each of those phases read its autoplan-<phase>-methodology-<suffix>/methodology.md 4 times, all after the call and before the publish, and none of those reads were credited. CEO still loaded through the manifest rule. In session 1, every call passed the rule. The detector's review had named this case as an open question, and the Captain ruled to fix it before E2 runs.

## 1. The rule change

Section 4's load rule, item 2, now reads: an ok Read of a file named `autoplan-P-methodology-<suffix>/methodology.md`, made after an ok `gstack-autoplan-snapshot methodology P` call. That call must be one command, piped at most once or redirected, with no &&, || or ;. The one exception: **a single leading `cd <plain path>` joined by `;` or `&&` may come first**, when the snapshot invocation follows it directly, either alone or after `bun`. A plain path is one unquoted word of letters, digits, `_`, `.`, `-`, `/` and `~`. The phase in the folder name must be P.

These still don't count: two cds; a cd followed by any other command; a cd to a quoted, variable or substituted path (`$(...)` or backticks); a cd joined by `||`, `&` or `|`; and anything after the call beyond the one pipe or redirect the rule already allows. Items 1 and 3 of the load rule, the manifest path and the Bash read rule, don't change, so `cd <dir>; cat <file>` still doesn't count as a read.

**Over-credit shapes.** A cd prefix opens none of them:

- A snapshot name inside another command after a cd (`cd x; true gstack-autoplan-snapshot methodology dx`) isn't credited, because the invocation must follow the cd directly.
- A SKILL.md path given to a non-reading command after a cd makes a compound Bash command, and the read rule never credits those.
- A failed snapshot piped to a succeeding command after a cd is credited exactly as it is without the cd, so section 4's over-credit rule still reads it not exposed. The run thread judges each open shape on the command that follows an accepted cd.

## 2. What follows from it

- **Detector:** exposure.ts at this amendment's merge, sha256 f0882eaf2d5fe19ef682ec0f0c88e9a1239870a04544cf6adbf6d34e4e167694. Section 4's detector paragraph, section 7's repository-files check and start rule 3 now read this sha256.
- **Run commit:** the merge on main of the pull request that carries this amendment. Start rule 5's rig.yml dispatch and every admit use that commit.
- **Tests:** tests/outcome-skills/exposure.test.ts adds four GEVA-390 tests, covering both directions: the credited cd forms, a session shaped like R61 session 2 as it ran, the uncredited cd forms, and a cd ahead of each open over-credit shape. Three of the four failed on the merged detector. Four mutations of the new lines each fail at least one of them.

## 3. The re-read prediction, written before any rerun

This replaces section 4's prediction. Start rule 4 reruns the re-read after this amendment merges and before any lease.

- **Frozen detector** (074336a6...58a0fd): 0 of 2, both failing review_skills_loaded, as before.
- **Amended detector, session 2:** exposed, all four checks true, phases ceo,dx,eng, published ceo,dx,eng.
- **Amended detector, session 1:** unchanged. Not exposed, review_skills_loaded true, failed findings_in_order, published eng,ceo,eng,dx.

This prediction isn't blind. It was written after three counts-only openings of the same two records, the re-read and two diagnostics, all logged in the custody record. Those openings showed the call shapes and counts the fix was built from. So the rerun checks that the code reads the real records the way the diagnostic says; it doesn't test a hypothesis. A mismatch goes to the Captain before any lease, as start rule 4 says.

## 4. Unchanged

These carry over as merged:

- the arm, the four tasks and their order;
- the pass rule (3 of 4), the early stop and the gap rule;
- the refusal and over-credit rules;
- the run procedure: `one`, `read`, both checks, then the early-stop decision; no `batch`; the E2_RUN_SETTLED: end guard;
- the dry runs and the custody rules;
- the caps: ap-e2 model calls $343 and e2-vm host hours $9, both on autoplan's line.

## Limits

- The fix credits only the cd shape that R61's session 2 used. Other prefixes, such as an environment assignment, a quoted path or `pushd`, still read unloaded. That can only lower the exposed count.
- The fix adds one permitted shape, fitted to one real session. Its tests hold it to exactly one leading cd followed directly by the call.

---
id: 2026-11-18-geva-543-ep-mcp-config-exclusion
kind: decision
title: "Planted-unit read: four units whose base tree tracks MCP config leave the pool before any outcome"
summary: "Four of 135 units track .mcp.json, which the build sandbox refuses and the frozen strip leaves. They leave before any outcome, so the pool is 131 of 135."
author: GEVA-543
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-11-18
status: done
links:
  - wiki/plans/2026-11-15-geva-537-eng-review-planted-units-prereg/README.md
  - lanes/eng-planted/stages/pipeline.ts
  - lanes/real-outcome/sandbox/sidecar.ts
  - lanes/eng-build/build-stage.ts
  - tests/ep/stages/config-exclusion.test.ts
---

# Four units whose base tree tracks MCP config leave the pool

This is a dated deviation from the planted-unit preregistration (2026-11-15-geva-537), decided on 2026-11-17 and recorded before the next paid launch.

Four of the 135 units in the seeded order leave the pool before any outcome. The pool is now 131 of 135. Repositories that track MCP config are not represented in this read.

## What stopped the run

The hinted build step's eighth lease stopped on 2026-11-17 at the hinted cell of u083c2720eae6. Its first attempt never reached the session driver, so no session ran. The build sandbox refuses a base tree that tracks project-local Claude Code configuration: a path under `.claude/` or a file named `.mcp.json`, the sidecar's `PROJECT_CONFIG` check. The frozen strip rule removes `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.claude` from the base commit, but not `.mcp.json`. So every unit whose base tree tracks a `.mcp.json` would stop its build the same way.

A scan of all 135 base trees found four that track a `.mcp.json`.

## The rule

A unit leaves the pool when its base tree, after the frozen strip, still tracks a path the sidecar's own check refuses.

- The strip is the frozen `stripBase`, run unchanged on a scratch copy of the unit's base tree.
- The check is the sidecar's `PROJECT_CONFIG`, imported from `lanes/real-outcome/sandbox/sidecar.ts` and not copied, applied to every path the stripped base commit tracks. That is the list the sidecar reads when a trial opens, so the rule and the sandbox can't drift.
- A unit whose only hits are `.claude/`, `CLAUDE.md` or `AGENTS.md` stays in, because the strip removes them.
- A near-miss name such as `.mcp.json.example` gets the sidecar's own verdict. The sidecar opens a trial on it, so such a unit stays in.

The rule runs on the seeded order before the calls, hinted, draw and no-review steps (`poolOrder` and `configLeft` in `lanes/eng-planted/stages/pipeline.ts`). The seeded order in the run's draw file is not rewritten. The eng-build lane is unchanged. The tests in `tests/ep/stages/config-exclusion.test.ts` take each verdict from a sidecar opening a trial on the stripped tree.

## The four units

Seed numbers are 1-based positions in the seeded order of 135.

| Unit | Seed number | State when the rule landed |
|---|---|---|
| u083c2720eae6 | 24 | Authoring calls passed; its hinted build was owed. Its one attempt never reached the driver. |
| u00a9893fb656 | 70 | Not authored. |
| u02a8a3a3f4ac | 78 | Not authored. |
| ued92fe3323cf | 132 | Not authored. |

None of the four had a recorded session. u083c2720eae6's authoring calls cost $0.0591, and that spend stays in the ledger and in the authoring item's total. The other three spent nothing.

## How the results report it

The results list these four units as excluded before any outcome, with this reason. They give the pool as 131 of 135, and they say plainly that repositories which track MCP config are not represented.

## Who decided

The gstack-evals Captain (GEVA-2) ruled on 2026-11-17: "A, with three conditions."

1. "The exclusion test is the sidecar's own check, imported and not copied, run on each unit's tree after the frozen strip. So a unit leaves only when its stripped tree would still be refused, and the two can't drift. Write failing-first tests in both directions: a nested .mcp.json is excluded; a tree whose only hits are .claude/, CLAUDE.md or AGENTS.md (all stripped) stays in; and a near-miss name such as .mcp.json.example gets whatever verdict the sidecar itself gives it."
2. "Before relaunch, record a dated deviation on the results branch with the rule, the four unit ids and their seed numbers, and the fact that none of the four had a recorded session. u083c2720eae6's $0.06 of authoring stays in the ledger. The results list the four as excluded before any outcome, with that reason, give the pool as 131 of 135, and say plainly that repos which track MCP config aren't represented."
3. "Then run CI, the rig and the new admission, and relaunch. No advisory read. The admission must show exactly these four leaving and no other unit changing. Anything else stops the run and comes to me."

The Captain turned down two alternatives. One changed the eng-build lane, and "it reopens eng-build, which I've already ruled stays untouched." The other skipped only the stopped cell, and it "still needs code to skip the cell, and the other three units would come back to stop the run later."

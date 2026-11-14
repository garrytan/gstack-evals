# Run area notes

This folder holds the design plan review lane's run area: the arm prompts and session setup, the C1 export and C2 containment check, the session loop and its section 6 classifier, the gate hook and the D1 repair hook, the two exposure detectors, the scope read and the hostile fixture.

## What is here

- `arms.ts`: each arm's prompt and session setup (env, denied tools, limits, container, plan-tune state).
- `export.ts`: the C1 export, a one-commit repository with fixed metadata.
- `contain.ts`: the C2 check script, its reader and the containment points.
- `session.ts`: the classifier for one attempt, the retry loop for one cell, cell order and the 8-session limit.
- `hooks.ts`: the gate hook, the D1 repair hook and the Stop handler that orders them.
- `detect.ts`: the plan-design-review and autoplan exposure detectors.
- `scope.ts`: the UI scope read, vendored from the pinned gstack.
- `hostile.ts`: the hostile fixture and its marker reads.
- `box.ts`: a RunBox over local folders.
- `docker.ts`: the Docker session rig: the review image, one container per session, C3 and C2 inside it, gstack's install, and the container's RunBox and agent session.
- `transcript.ts`: transcript reads (reply, web results, gstack reads).
- `types.ts`: seam types this area shares with its callers.
- `fixtures.ts` and `dryrun-cases.ts`: invented fixtures and the area's dry-run cases.

Tests are in tests/dc/run: `cases.test.ts` runs each dry-run case, `pinned.test.ts` runs the gate hook and the scope read against the pinned gstack, `sdk.test.ts` runs the hostile fixture and both hooks through the real driver, `docker.test.ts` runs the rig on the local Docker daemon (the containers and their checks, gstack's real install, and the hostile sessions in containers at /work) and skips with a printed reason when no daemon answers, and `intake.test.ts` runs the export intake. The pinned tests, and docker.test.ts's gstack arms, skip unless DC_GSTACK_PIN_DIR names a gstack checkout at b6155921a564ba9ec2470fd2cb3894c05e2c2d13.

## Reuse

| Source | Commit | sha256 | What changed |
|---|---|---|---|
| lanes/aftermath/exposure.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 9e17a3d42df11e02fc3e63924787f081d7be01f5da6cf66e72b9157f8125f176 | Adapted into transcript.ts. |
| lanes/devex/run/stophook.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | fd4c5ec0b823cb2830ec617f614b7280ac1235569ac62b3fb2fdacb2acf56246 | Pattern for hooks.ts; devex-only behaviour dropped. |
| lanes/devex/author/scope.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 5039c3394cda272528ee5b8a7663e2add73475a7bded830205cb0081bef5ef99 | Pattern for scope.ts. |
| lanes/devex/run/exposure.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | a49268ebec44e97e26e9f2885d5a1c302038e752b690bd9a35fb4ae4da4b2903 | Pattern for detect.ts. |
| lanes/devex/run/checks.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 7f562ff8ba87b29b93b3f1b7c6ed590acfc7742b29bdd2e92a096b6c70d1f2f1 | Hostile fixture, adapted into hostile.ts. |
| lanes/devex/run/memory.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | 07afd16ba379857d8d9f77d43053f826ef56fdc1d95bb89b5fd3344523b22bef | Not copied; the driver's memoryLog option replaces it. |
| The driver's memoryLog change | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | | Ported into src/adapters/claude-code/driver.ts, off by default. |
| lanes/devex/run/parse.ts and session.ts | 5ee7f764232b196a1d0cec5b144a287b792f9c94 | | The classifier is replaced; session.ts follows the session shape. |
| gstack lib/autoplan-scope.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 898c3cb791eb36a09113ce5b0a998b20e7576fc0755bc786998f6a7c18292ab7 | Vendored into scope.ts. |
| gstack lib/frontend-scope.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 27c8a69861ed35b7c28de88f2c17a80dc15191a5a852f3fbf22cc6696e804cae | Vendored into scope.ts. |
| gstack lib/autoplan-plan-text.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | decb0fb8809ed85afa5bf3c7889fd65507856ecec3a0c50c4ae1b94b16e01bd7 | Vendored into scope.ts. |
| gstack bin/gstack-autoplan-snapshot.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | f9a31c701d8a86af3b752ab0901661a12f54cd7cd73b512e33f0eea62e555e73 | Section reads and init's wrap, vendored into scope.ts. |
| gstack plan-design-review/SKILL.md | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 5934f10c95119c12e3fe785a9b33cdb608f6214f79a88ea84ac77cdfed6fb820 | Read for the pass names and the summary. |
| gstack plan-design-review/sections/review-sections.md | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 262d857596134531e5b3e20e1d491afcf2083f798e05f6d5edcc566b3b000ddd | Read for the state table. |
| gstack lib/autoplan-lean.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | ef1cd3d4d88ca0af5f0b561f72370b7ac0dd7c1baa687f1a3d49d2e6ac862f60 | Read for the lean design lens. |
| gstack lib/gate-list.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | e27370c0ef920c5c3383339e5a34ce34007f17e03d1d307bd032be2b3f463a7e | Read for the render's binding line. |
| gstack lib/autoplan-gate.ts | b6155921a564ba9ec2470fd2cb3894c05e2c2d13 | 4e7f4ea9e085817dfc2ba9317089ff01346ad9eab112b414b4f754ecd22b4abc | Read for answer and recommend. |

tests/dc/run/pinned.test.ts checks the four vendored scope sources against their digests and the vendored read against the pinned `gstack-autoplan-snapshot.ts scope`.

## Build-time choices

- Prompt parts join with one newline, then a blank line, then the template.
- The reference prompt lists evidence by path in byte order, each under its path inside a fence longer than any backtick run in the file.
- GSTACK_SESSION_KIND=unattended and the empty plan-tune state apply to the gstack arms only. The CLAUDE_CODE_* settings apply to every session.
- Export commit metadata: `dc-export <dc-export@invalid>`, time 1763078400 +0000, message "unit export", branch main. The commit is written with hash-object, not git commit.
- The export builds its tree in a scratch repository that borrows the clone's objects through GIT_ALTERNATE_OBJECT_DIRECTORIES, then copies exactly the reachable objects with pack-objects into index-pack in the fresh repository.
- .ignore and .rgignore files are checked by writing them as .gitignore files in a scratch repository and running check-ignore --no-index.
- Symlinks are judged outside the tree lexically, without following them.
- The tree digest is the sha256 of TREE_DIGEST_SH's output.
- The C2 script runs through an Exec seam, on the host and in each container. Containers print only sha256 values and file names; the key-statement print runs on the host only.
- Words for the key-statement print are lowercased, NFKC-normalized, and kept to letters and digits.
- Ends: timeout, turn_cap, allowance_stop and context_overflow are the session's own limit. harness_crash, missing, infra, unknown and credentials_rejected are outside the agent. malformed_output, malformed_tool_call, refusal and empty_response map to no frozen row and the classifier holds them.
- The reply is every main-agent text joined by a blank line.
- A gstack read is any tool input matching the GSTACK_PATH pattern. A web result is any client or server web tool result.
- Cell order: units in the order given; each unit's cells are shuffled (Fisher-Yates) with a seed from the first 8 hex digits of sha256("20261114\n" + parts), through seededRandom in src/runner/stats/paired.ts.
- A retry holds its cell's concurrency slot.
- Gate hook: "written this session" means run.json's mtime is at or after the session start. --rec-hash goes on the answer whenever gate.json has a numeric rec_rev. It answers every gate revision, past the run's max_rounds (Captain, 2026-11-14), and records any answer the pin refuses.
- The D1 message is "Do not stop yet. The procedure has not shown these required outputs: {missing}. Produce them, then end your reply with the plan-changes block."
- plan-design-review detector: pass names count as the longest in-order run of first appearances, ignoring case and whitespace. The summary needs a Pass row with a score out of 10, or a GSTACK REVIEW REPORT with a "| Design Review |" row.
- autoplan detector: the lean design lens means a lean run with scope.ui true and docs_only not true. Bound means exactly one submitted native attempt, no outside attempt, and a bound file whose first line is an INPUT receipt and that holds a gstack-findings fence. The gate counts when gate.reply is rec and answered_by is agent:harness. Approved means status complete, plan.md and review-record.md present, and gstack-artifact validate printing ARTIFACT_VALID.
- Scope read: --scaffold, then init's wrap, then detectUiScope with the session's working folder (/work) as root.
- sdk.test.ts's hostile check runs on this host with the repository root as the working folder and a stand-in install (the pinned skill folders copied into HOME/.claude/skills). docker.test.ts runs it in the review container at /work with gstack's real install.
- Export intake: the source's HEAD and HEAD^{tree} must equal the base app's recorded commit and tree. A bundle is read with git bundle verify, then list-heads for its HEAD, then git bundle unbundle into a scratch repository, so no fetch transport opens. Git runs with GIT_NO_LAZY_FETCH=1. A drop is E_BASE_APP_DROPPED.
- Review image: the pinned trial image (docker/trial.Dockerfile through checkImagePin), run by its image id; the id is the digest each session records.
- Review container: one per session, entrypoint sleep infinity, the host user's uid, every capability dropped, no-new-privileges, a pids limit of 1024, working folder /work. Its env is PATH=/usr/local/bin:/usr/bin:/bin, HOME, LANG=C.UTF-8, TERM=dumb and the arm's frozen env, checked on the agent allowlist and holding no key name. The proxy URL and the session bearer go only on the CLI's own docker exec, the bearer through the docker client's env.
- Mounts: read-write binds of the session's own copy of the export (repo/), plan.md and context/, made in a new session folder.
- Network: the run's trial network alone (src/trial/proxy.ts createTrialNetwork and startProxyContainer, reused as they are).
- gstack install: the pinned commit's tree from a local gstack repository through src/arms/install.ts stackTree (git archive, checked against the commit's tree, no .git), copied to HOME/.claude/skills/gstack (gstack's README install for Claude Code), then GSTACK_PIN.install run there. Only the install joins a plain bridge network for its downloads, and it leaves before the second C2.
- C3's listing: every path under HOME, the frozen mount points, every mount point in /proc/self/mountinfo, /drive and any */.capy/drive path outside /proc, /sys, /dev and /work. Beside containerProblems, C3 checks docker's view: the pinned image id, a non-root user, exactly the three binds from the session folder, the session network alone and no key name in the env (names only; the inspect template prints no value). Before the install every arm's HOME must be empty; after it, the gstack arm's own C3.
- The container's run reads: find under /work and HOME to depth 11 with .git and node_modules pruned and symlinks not followed, the same rule findRuns walks, then pickRuns on the files' mtimes and text.
- The sentinel's NET probe uses bash's /dev/tcp under a 10 s timeout, else curl, else prints NET unknown; its DRIVE lines are deduplicated.
- Plan-tune state files are matched by the PLAN_TUNE_FILES pattern.
- A mounted file named key.json or unit.json at any depth fails C2.

## Shared-file edits

- src/adapters/claude-code/driver.ts: a `memoryLog?: boolean` option, off by default. When on, an InstructionsLoaded hook writes each loaded memory file to memory.ndjson, so the hostile check can see which instruction files the CLI loaded.
- src/adapters/host.ts: the memoryLog field and its pass-through to the driver.
- src/errors/codes.ts: E_BASE_APP_DROPPED, added (docs/errors.md regenerated).
- tests/dc/dryrun.test.ts: the 60 s limit on the failing-case test, as on the file's other dry-run tests.
- tests/adapters/harness.ts: a `host` option, off by default, so the fake upstream's proxy can listen on a Docker bridge's gateway that a container reaches.

## Open for the integrator

1. Settled by the Captain on 2026-11-14 (PD-17): a refusal, an empty reply or malformed output is a completed reply; a malformed tool call is outside the agent after an API, provider or harness error and an arm stop otherwise. endOf takes errorSeen from the session record; the wiring sets it.
2. When J1 reconciliation fails before an arm-stop retry, the cell reads infra-missing rather than 0.
3. Settled by the Captain on 2026-11-14 (PD-16): the hook answers every gate revision and records any answer the pin refuses.
4. The dry run has no case that uses the pinned gstack binaries, because CI has no pinned checkout. tests/dc/run/pinned.test.ts and sdk.test.ts cover them where DC_GSTACK_PIN_DIR is set.
5. Closed: docker.test.ts runs the hostile sessions in the review container at /work with gstack's real ./setup in the gstack arms. sdk.test.ts keeps its repository-root run and stand-in install, which still carries the AGENTS.md control and the project hook check.
6. Closed: the sentinel's KEY, DRIVE and NET lines are checked on real containers both ways. The old NET probe used /dev/tcp under sh, which is dash in the trial image and on Ubuntu, so it printed NET none even with a route out; the probe now runs under bash or curl.
7. docker.ts now has the container RunBox, the Docker C2 exec and prepareSession. Integration must still wire them into the session loop, the score area's parser for the ParseBlock seam, and the cli.ts `scope` and `sessions` rows, and record each session's image digest.
8. C2 fails a unit whose base app holds any file named unit.json or key.json.
9. Closed: exportUnit takes a kept clone or a kept bundle and checks its HEAD and tree against the base app's record.
10. tests/dc/dryrun.test.ts runs every area's cases under bun's default 5 s test timeout. The run area's cases use real git and take about 3.5 to 4.8 s on a 4-core machine (the full test passed at 4.45 s here), so the shared test needs an explicit timeout before more areas add cases. With the intake case added, the test that runs every area but frame and money took 6.4 s, so it now has the 60 s limit the file's other dry-run tests carry.
11. Install-time egress. Section 4 gives the container no network but the proxy, while the frozen ./setup --host claude installs packages with bun and downloads Playwright Chromium. The rig joins a plain bridge network for the install only and leaves it before the second C2 and the session. The alternative is an offline install from a dependency set fetched outside the container. The Captain decides.
12. Chromium. The frozen install downloads Chromium (about 700 MB in HOME/.cache) and leaves a bun cache (about 600 MB in HOME/.bun), so each gstack session's container carries about 1.3 GB, and its install took 15 to 25 s here. Chromium's launch check then fails in the trial image (no browser system libraries), so browse is unavailable in the gstack arms either way. Main's stack installs pass --no-browser; the frozen command doesn't, and the rig runs it as frozen.
13. The installed checkout has no .git (the verified git archive tree, as main's installer copies it), where gstack's README clone would have one. setup then reports its update channel as not a git checkout of its own. Whether that changes anything in a session is not tested.
14. gstack's checkout under HOME tracks two run.json files (docs/designs/multi-agent-wave-2026-10-10 and test/fixtures/multi-agent-wave/reference-run), so the container box's runs(0) returns them. The autoplan detector skips them (they have no plan_source) and the gate hook's since filter skips them (their mtime is the commit's time), so no reading moves today; a change to either filter should keep them out.
15. Reason-code name. tests/dc/frozen.test.ts pins exactly the 18 E_DC_ codes start rule 3 lists, so the intake's drop code is E_BASE_APP_DROPPED, outside the E_DC_ prefix. A new E_DC_ code would need the Captain to change that frozen check.
16. Stub sessions in docker.test.ts reach the fake upstream's proxy on a plain internal network's gateway, not on the isolated trial network. The trial network and the proxy container are checked up to an unauthenticated request, as main's network test does; a metered call through the proxy container needs a key and is not run here.

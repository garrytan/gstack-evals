# Part S as built: sessions, driver stage, exposure

Part S of the skill-pack head-to-head (post 2026-11-15-geva-538-skill-pack-h2h-prereg) runs one session per planned row
on the real Claude Agent SDK and Claude Code, pays for it through the outcome driver's h2h stage, and reads each
session's exposure. Everything here is keyless: the dry run answers Claude Code from a stub upstream on a temporary
ledger, and no test reads a provider key.

## What runs a session

1. plan.ts orders a stage's sessions from prereg.json's order_seed (h2h-plan.v1).
2. run.ts writes the attempt's Harbor task, the h2h config and a compose overlay (the pinned Claude Code, and the runtime
   volume read-only at /opt/h2h-runtimes with its bin dir after the image's PATH), and runs Harbor with h2h_agent.py.
3. h2h_agent.py checks the image, locks egress to the proxy, copies pfchecks' sh scripts, this folder's sh/ and the
   arm's home into the container (docker cp over /root, so the image's own /root stays), and runs h2h_turns.py.
4. h2h_turns.py opens one driver slot at the session allowance, runs the arm's scripted turns, then continuations while
   DONE is absent (at most 6), hashes the tree after every turn, closes the slot, and tars the tree as tree.tar: .git
   plus every tracked and unignored file, with no capture commit, so part C's scorer diffs the working tree against
   the record's base_head.
5. session.ts reads the end, applies the one whole-session retry and the gap codes, and writes h2h-session.v1.
6. exposure.ts reads loaded, procedure ran and the read audit from both transcripts.

## Files

- turns.ts, h2h_rules.py: task text, scripted turns per arm and entry, DONE rule and the loop's next step (TS and
  Python agree; a test runs both).
- plan.ts: arms per unit kind, item per stage and arm, seeded order.
- driver.ts and the hook in driver/stage.ts: h2h stages serve h2h:<arm> arms only, run prereg.json's model, one slot
  per session at the allowance (or exactly twice it), and their proxy refuses provider-side tools and answers a
  reservation-bound refusal with a retryable 429.
- The hook in src/runner/proxy/metering-proxy.ts: reservationBoundRetry. Off by default, so every other lane is
  unchanged.
- h2h_turns.py, h2h_agent.py, sh/treehash.sh: the session loop and its Harbor agent.
- session.ts, home.ts, run.ts: end rules and record, arm homes, the Harbor runner.
- markers.ts, markers.json, exposure.ts: frozen markers and the detectors.
- dryrun.ts: the driven launch on the host against a stub upstream.
- runtimes.ts: the runtime volume (node, bun, python3, gh), its pins, MANIFEST.json and reuse rule.
- rerunner.ts: the session runner cli.ts wires into gstack-evals h2h rerun (RERUN_RUNNER).
- e2e.ts: the keyless end-to-end run through that runner in Harbor containers on a real unit.
- commands.ts: session-plan, session-run, dryrun, exposure, audit and runtimes, loaded by cli.ts.

## Readings chosen where the post left room

- Entry rule: "" is read as T alone (the literal reading would send an empty turn). A string ending in a space is a
  prefix for T, any other string is a whole turn.
- Turns: each turn is a new Claude Code process resuming the same session (resume=session_id), as pfchecks runs its
  wrap-up. The wall limit is one deadline from the slot's open; max_turns is 300 less the turns already used.
- Continuations: they start only after the last scripted turn; scripted turns always run. A turn that does not end
  completed, or in which the assistant stopped for refusal, ends the session with no continuation.
- Spurious continuation: a continuation after which the tree hash (tracked and untracked, not ignored files, with
  modes) did not change. The post says "the tree's diff"; the working tree's content is what the diff is taken from.
- Questions: AskUserQuestion gets texts.question_reply through can_use_tool. A prose question is counted and not
  answered; the continuation answers it in effect. questions = AskUserQuestion plus prose counts.
- Safety stop: an assistant or result message with stop_reason "refusal" ends the session as safety_stop. It is
  scored, not retried.
- A reservation-bound 429 that Claude Code gives up on after its own retries ends the turn as an error result, which
  the ordinary rule reads as upstream (one retry, then E_H2H_UPSTREAM_GAP).
- A capture or bundle step that fails is a gap (E_H2H_CAPTURE) with pfchecks' cause reading kept in post_turn; it is
  not retried.
- A session check refusal (instruction files in the tree, a drive in the home, a pack in the none arm's home, gstack
  outside gstack's arms) halts the run with E_H2H_SESSION_ARM: a home built wrong must stop the stage, not become a row.
- The GSD onboarding decision is an option (--gsd-onboard); stage 0 records which way it went.
- The h2h items charge the program skill "h2h" in the approvals record (a contract with part C's ledger setup).
- pstack's procedure marker: the first two items of a todo list (TodoWrite, or TaskCreate subjects in order) match a
  playbook's first two steps by the sha256 of their first six bare words. markers.json stores only those digests.
- gstack on bug entries: loaded and procedure ran by the installed pack, as the post says.
- gstack's timeline event cannot be read from transcripts, so it is not a marker.
- Runtimes: the volume's bin dir comes after the session image's own PATH, so a tool the image already has wins. The
  SM harness's session images carry node and bun in /opt/laneb/bin (same versions as the pins) and the unit image its
  own python3, so on O units only gh resolves from the volume. Node and bun are copied from part A's install-image
  bases, python3 is python-build-standalone and gh the release tarball, each checked by digest or sha256 and read back.
- MCP servers: a home's user-scope servers (~/.claude.json mcpServers) are passed to Claude Code under
  --strict-mcp-config, so a pack's server loads and a unit repository's own .mcp.json does not. Only agent-skills
  registers one (chrome-devtools-mcp through npx). With egress locked to the proxy, npx waits on the registry past the
  MCP start timeout and the server fails, so a stdio server gets npm_config_offline=true under its own env and starts
  from the npm cache part A's install left in the home. Its browser path (/opt/h2h/chromium) exists only on B1 units.
- Tree capture: the tree leaves the container as one tar (no capture commit and no bundle), so nothing the harness
  writes lands in the session's history and part C reads the working tree as the agent left it.
- rerun: records are stage2 sessions indexed in the order run, on the item H2H_RERUN_ITEM names (default plan.ts
  itemOf's stage 2 item); rerun's flags are frozen, so the driver, homes and unit dirs come from the environment.

## Contracts assumed from other parts

- Part A: arms-pins.json holds ArmInstall records (an array, an { arms } object or a map by arm are all read), and a
  homes dir holds one installed HOME per arm that owns one at <homes>/<arm>/, laid out as /root. Arms with home_of use
  the owner's dir; none copies nothing. Plugin packs are registered in the home's settings, so the session passes no
  plugin option. Until part A's files exist, tests use fixtures and the dry run links fixture homes from the pinned
  clones.
- Parts B and C: a unit reaches part S as H2hUnitInput: the H2hUnit record, its statement, its session image (a
  SessionImage: the stripped tree at base with one commit) and the repo and work dirs inside it.
- Part B: B1 sessions mount BROWSER.wrapper_repo_path read-only at /opt/h2h/chromium with shared memory 2g and
  CHROME_BIN and PUPPETEER_EXECUTABLE_PATH set. run.ts refuses a B1 session when the wrapper file is missing; tests pass
  a stub path.
- types.ts: H2hSession gains optional fields attempts, allowance_stops, home_tree_sha256, claude_version and refused.

## What the dry run showed (Claude Code 2.1.325, claude-agent-sdk 0.2.174)

All 15 rules passed: every arm's home loads its pack into the first model request and the none arm's loads none; every
DONE variant ends the session after its scripted turn; GSD's two feature turns run, then 6 continuations, each counted
spurious; AskUserQuestion is answered once with the frozen reply; 5 and 21 calls give 5 and 6 in flight with 15
retryable 429s counted apart from allowance stops; and Claude Code retries its own reservation-bound 429 after the
20 s retry-after and goes on. Findings for the lead:

- Claude Code 2.1.325 loads three builtin plugins (cc-plugin-agents-md, cc-plugin-privacy, cc-plugin-plugin-authoring)
  in every arm, none included, with CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 set. They add the skills doctor and
  plugin-authoring. The setting turns off bundled skills, not builtin plugins. It is the same in every arm.
- A plugin's commands under a symlinked .claude dir do not load (agent-skills keeps its .md commands in
  .claude/commands). Copied plugin dirs load them. Part A's install should copy, not link.
- gstack-pony's procedure marker (the PONYSTACK PHASE line) is met by the ponystack hook at the first prompt, before the
  agent does anything, so its procedure rate will read near 100% by construction.
- Exposure markers appear in both transcripts: the <command-name> block and "Base directory for this skill" in Claude
  Code's own transcript, and hook output (superpowers, ponystack) in the SDK's hook records.

## The end-to-end run (2026-11-15)

The Harbor path now runs end to end, keyless, through rerun's wired runner: one real O unit (c-ares__c-ares-1197, the
third id in o-order.json, kept by the SM oracle), part A's installed homes, and the pinned Claude Code on the real Agent
SDK in Harbor containers, against a stub upstream through the driver's metering proxy on a temporary ledger. All nine
arms (the seven primary arms, gstack-pony and gstack-oneline) passed every check and the driver stopped clean: each
pack loaded (none's did not), /agent-skills:test resolved from part A's agent-skills home with its chrome-devtools
server connected, node, bun, python3 and gh resolved in every container, the read audit found no read of another arm's
install, every slot closed finalized, and part C's score read clean_fix for the eight arms whose stub applied the fix and
no_fix for none. Commands, versions and the per-arm lines are in sessions/e2e-2026-11-15.md.

What it found and fixed:

- agent-skills' MCP server failed in every container until its env got npm_config_offline=true (see Readings).
- The capture commit and git bundle were replaced by tree.tar, which part C's scorer reads directly.

Findings for the lead:

- superpowers' installed home drifts from arms-pins.json because Claude Code 2.1.325 writes a timestamp file,
  .claude/plugins/.last_inuse_sweep, during the install; part A's recorded home lacks it. Removing the file makes the
  home match. Part A's install should delete it before hashing (or the hash rule should skip it by a new frozen line);
  HASH_RULE and arms-pins.json were not changed here.
- The host dry run's --homes mode cannot load plugin packs from part A's homes: their installed_plugins.json records
  /root paths, which exist only in the container. The dry run with fixture homes still passes, and the end-to-end run
  is the check for part A's plugin homes.
- Each session took 60 to 90 s; part C's scoring took 6 to 10 minutes per arm on this unit (C build plus 1,167 stable
  tests), so scoring, not sessions, sets the wall time of a stage on C units.

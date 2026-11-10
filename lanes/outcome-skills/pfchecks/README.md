# The pstack-checks scoring core (PF)

The keyless scoring core for the preregistration in wiki/plans/2026-11-09-geva-487-pstack-checks-prereg/README.md (the
post, from plan v2). The post is the source of truth; this file records the rules as built and the readings this build
chose where the plan leaves a detail open. It reuses the state machines harness (lanes/outcome-skills/statemachines/)
read-only. The second build adds the arms, the tools volume, the pstack plugin, the two-turn session core, the session
plan and the dry run (section "Sessions, arms and the dry run" below).

## Commands

`gstack-evals outcome pf --help` lists them: `draw`, `told`, `neutral`, `score`, `analyze`, `admission`, `reprice`,
`items`, `dryrun` and `contain`. Every refusal prints its reason code first (docs/errors.md, codes E_PF_*).

## Files

- prereg.ts: prereg.json (pf-prereg.v1, draw_seed, order_seed, bootstrap_seed, unsigned 32-bit). E_PF_SEED otherwise.
- draw.ts: section 2's draw over #290's candidates.json. told.ts: the told-mode screen. neutral.ts: the neutral edit and
  its validation. capture.ts and sh/capture.sh: section 6.1. transplant.ts: 6.2. trees.ts: 6.3. manifest.ts: 6.4.
  runner.ts: 6.5 to 6.8. secondaries.ts: section 9. exposure.ts: section 8. analysis.ts: section 12. admission.ts:
  sections 10 and 13. items.ts: the frozen items and prices. score.ts: one session to a pf-catch.v1 record.
  containment.ts and sh/contain.sh: section 15's containment check.

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
- Each run record keeps start_ms (from the scoring start), call_ms (the whole call, the tree copy included) and
  rebuild_ms (from the container's start to the rebuild's end mark, as the host sees it). Each entry keeps, per phase it
  took part in, slot_ms (from the phase's start to its first run) and barrier_ms (from its last run to the next phase's
  start). No score reads them. replaySchedule replays a session from its runs' wall_ms with the same slots and phases.
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
- Ceiling readings: ceiling_missing reads a session that scored 0 with at least one unreached entry as missing;
  no_flagged drops every unit with 5T + 8R >= 10,800 s, where T is the largest entry timeout over the unit's rows and R
  the median over its sessions of each session's median run overhead (call_ms less wall_ms plus rebuild_ms). The report
  prints per model and arm the sessions, entries, unreached entries, timeout-only entries (every parent run timed out)
  and sessions at the ceiling, and lists the flagged units.
- In flight (analysis.ts inFlightOf): per model and arm the sessions, the reservation-bound refusals and the sessions
  with one, and the subagents asked for and refused at the cap, with the sessions that had a refusal. A reservation-bound
  refusal is an allowance refusal where the slot's settled spend plus the refused call's own worst case (read from the
  proxy's refusal reason) fits the allowance. session.ts reservationBound reads it from the slot's journal lines, counting
  a call with no recorded spend at its full reservation, and the driver's close answer carries it as reservation_bound.
  Subagents are Agent (or Task) tool calls in sdk-messages.jsonl; a refusal is a tool result holding "Concurrent subagent
  limit reached" (exposure.ts subagentUse). pfRecord writes both into the session record's in_flight.
- What is left of the line is $1,980 less the spend recorded so far less the crew use still held back (both inputs).
- The mid-run check projects spend so far plus the remaining units at the new price against the item's cap.

## Sessions, arms and the dry run

Files: arms.ts (section 4's texts and sections 5 and 13's limits), tools.ts (the tools volume), pstack.ts (the plugin
volume), session.ts (plan, end rules, effort fields, pf-session.v1), sh/wrapup.sh (the wrap-up keep rule), pf_turns.py (the
two-turn session on the real Claude Agent SDK) and dryrun.ts (`gstack-evals outcome pf dryrun`).

Rules as built
- Task turn: the arm's text, a blank line, "Here is the bug report:", a blank line, the issue text with JavaScript's
  trailing whitespace removed, a blank line, then "My app is the repository in this directory. Don't stop to ask." The
  blind probe is its text with {scope}, a blank line and that last line only.
- Limits: task turn 5,400 s and 250 turns for P, C and the blind probe, 3,600 s and 150 turns for N; wrap-up 300 s and 20
  turns. Allowances from items.ts ALLOWANCE (or admission.ts costReading's doubled table, passed in); blind $15; wrap-up $13 on Opus, $12 on Sol,
  $0.50 on particle-1. The session env sets CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=2 in every arm (arms.ts ARM_ENV). Quiet and background waits are the state machines arms' 30 s and 600 s.
- Session plan: per unit, every (model, arm) cell of the part shuffled by one seededRandom(order_seed + part) stream, as
  #290's planPart reads its seed. Items: pf-opus, pf-sol, pf-particle in the test part; pf-admit in admission; pf-blind.
- Ends: endKind is #290's. Task turn: completed or a limit goes to the wrap-up; upstream or infra retries the whole
  session once, then E_PF_UPSTREAM_GAP or E_PF_INFRA_GAP. Wrap-up: upstream or infra reruns the wrap-up turn once after
  wrapup.sh reset, resuming the same Claude Code session; a second is a gap. A wrap-up refused for its allowance (an
  allowance stop on its slot, which the driver's close answer counts in allowance_stops, or the driver's 409 CAP_STOP on
  its open, which pf_turns.py records as termination open_refused) is gap E_PF_WRAPUP_ALLOWANCE, with no wrap-up rerun and no session retry. A turn
  whose close answer says the proxy's finalize failed (finalized false) has unknown counts and is an infra end, unless it
  also counts an allowance stop, which reads first. Such a turn with no allowance stop halts the session before any
  retry or wrap-up rerun (E_PF_FINALIZE_HALT, no session record), and the driver halts the item's stage and names the
  session and the lease's journal; the Captain rules on a retry after reading it. The halt line stays in the run's
  sessions.jsonl, so a relaunch refuses the item (E_SM_FINALIZE_HALT, the family SM halt's reading) until --lift-halt
  names the session. A task open the driver refuses
  with 409 CAP_STOP raises LedgerCapStop in PfAgent, Harbor records it as the trial's exception, and pfRecord reads it as a
  cap stop: no gap, no retry, and runPfSession ends the part with CAP_STOP after writing the record.
- Between turns: capture.sh commit (S), then wrapup.sh save. After the wrap-up: wrapup.sh keep copies CHECKS.json (a
  regular file at the root), prints PF_DISCARD for every other added, changed or deleted path, and puts the tree back to S.
  S leaves the container as a git bundle, which score.ts fetches as --s with ref HEAD.
- The wrap-up turn is a new CLI process with --resume and its own max turns, deadline and proxy slot (its allowance).
- Before any turn pf_turns.py refuses a tree holding CLAUDE.md, CLAUDE.local.md, AGENTS.md or .claude, or a home holding
  gstack or a drive path (E_PF_ARM), as real_agent's SM check does. AskUserQuestion gets #290's NoAnswer reply.
- Tools volume pf-tools-<pin hash> at /opt/pf-tools, read-only: Temurin JDK 21 from eclipse-temurin:21-jdk@sha256:ebfbb18d...,
  bun 1.4.4 from oven/bun:1@sha256:1d22548f..., tla2tools.jar checked against prereg.json. TLA2TOOLS and JAVA are set and
  bun goes ahead of the image's own PATH. The JDK and bun are glibc builds, so a musl (Alpine) unit image cannot run them.
- pstack volume pf-pstack-cdbbd4ca5dd2 at /opt/pf-pstack, read-only, loaded with the SDK's plugins option (--plugin-dir).
  stackTree checks the tree id; stacks.ts's install command (pstack's bootstrap) runs in the bun builder with egress.
- Effort: no effort, thinking or reasoning setting is passed. The driver's metering proxy records the effort and thinking
  fields (session.ts EFFORT_KEYS) of each slot's first paid request whose tools list is non-empty (ProxyOptions
  firstRequestFields, on for PF stages only), and the driver's close answer carries them as first_request. pfRecord reads
  the task slot's record. The dry run writes those records per model to effort.json; a session run with that record
  (PfRunInput effort, which every paid session passes) whose task slot recorded no fields, or fields that differ from its
  model's record, is gap E_PF_INFRA_GAP (effortHolds).

Readings this build chose
- P's exposure (section 8, "the task turn's transcript holds the body"): measured on Claude Code 2.1.310, the expanded
  skill body reaches the request and Claude Code's own transcript (~/.claude/projects), not the SDK message stream. So
  pf_turns.py copies Claude Code's transcript out as claude-session.jsonl, and the body check reads that file.
- The short skill names resolve on 2.1.310 with the plugin directory loaded, so the dry run keeps "short" and records it.
- The wrap-up upstream fixture: the stub fails every request of the first wrap-up attempt with a 400. A 500 did not work:
  the metering proxy retries every 5xx and charges a 5xx without usage at its reservation, so three retries used up the
  wrap-up allowance and the turn ended limit_allowance. Neither the proxy nor Claude Code retries a 400, so the turn ends
  as error_result (upstream). The rerun resumes the session on the saved S; its messages hold the wrap-up text twice, and
  the stub answers it, so it completes and scores.
- PATH in the Bash tool: no /etc/profile.d file is mounted. A login shell on the Debian 12 image (bash -lc) runs
  /etc/profile, which resets PATH and drops /opt/pf-tools/bin, so pstack's statechart script exits 127 there. But Claude
  Code 2.1.312's Bash tool keeps the session env's PATH, and the dry run's live-session PATH line shows it in every arm
  without the file. The line also prints what a bare login shell gets, as a record only.
- The PATH line's uid 1000 case: the harness runs every session as root, so the same Bash tool call also runs bash as
  uid 1000 with setpriv (HOME=/tmp), keeping the session env, as a Bash tool run as that uid would.
- Each turn ends by real_agent's _drive rule: the agent ended its turn and its background tasks are quiet (QUIET_SEC 30,
  then BG_WAIT_SEC 600 with nothing ends it as bg_wait_expired, which counts as completed), bounded by the turn's wall
  limit. pf_turns.py calls RealAgent._drive itself, so the rule has one code path.
- Sessions run the pinned Claude Code 2.1.312 binary (statemachines/stub-claude.ts CLAUDE_BIN, or --claude) at
  /usr/local/bin/claude in the session container, never the SDK's bundled 2.1.310, and pf-summary.json records its
  claude --version from inside the container.

Harbor runner. run.ts runs one session the real way. buildSessionImage (statemachines/image.ts) makes the session image
from the unit's prepared tree volume. runCopy writes a Harbor run copy that names that image as the task's docker_image, a
compose overlay that mounts the tools volume read-only at /opt/pf-tools for every arm, the pstack volume at /opt/pf-pstack
for P and the blind probe and the pinned Claude Code read-only at /usr/local/bin/claude, and pf-config.json (both turn
texts, both turns' limits, the frozen no-answer reply, the plugin dir and Claude Code's env). Harbor runs
pf_agent:PfAgent (a RealAgent subclass) with verification off, every provider key unset, a placeholder ANTHROPIC_API_KEY
and HARBOR_TELEMETRY 0, so the session's only credential is each driver slot's token. PfAgent checks the container's
image against the manifest, allows egress to the metering proxy only, copies sh/ in and runs pf_turns' core with one
driver slot per turn (meta.phase task or wrapup, cap_usd from that turn's allowance, meta.rerun on the wrap-up rerun).
pfRecord turns pf-summary.json into pf-session.v1. A task turn that ends upstream or infra retries the whole session once
from a fresh container, and attempt 2's task open names meta.rerun task_upstream_or_infra. A tree or home refusal before
any open is gap E_PF_ARM and takes no retry (retriesSession).

Dry run. `gstack-evals outcome pf dryrun [--out dir] [--python <python with claude_agent_sdk 0.2.174>]` builds the volumes
and a fixture unit from #290's fixtures helper (lang go, shell-sourceable product code), and opens one lease per frozen
item on a temporary ledger. The driver (serveStages) serves those items in two batches, since a batch never serves one arm
and model on two stages: pf-opus, pf-sol, pf-particle and pf-blind first, then pf-admit. Each stage's metering proxy
stands in front of a stub upstream that answers as Anthropic's API. Ten sessions run through runPfSession, so each one
goes through Harbor, PfAgent and the driver's slots in a container from the fixture's session image: probe (the skill
names and a background task), A (19 manifest entries), B (26 entries and the scoring ceiling), C (a wrap-up limit), blind
(scope "flag/" plus the stub's session tag), then on pf-admit D (a wrap-up upstream end and its rerun), Eopus and Esol (a
cold first wrap-up request at a 160k-token stub context, about 560 KB, then the next after the stub reports a full cache
write; each line fails if either request is at the 1h cache-write rate), W4 (the first wrap-up answer reports 95% of its
request's worst case, so the proxy refuses the next) and hostile (a tree holding CLAUDE.md, refused before any slot, gap
E_PF_ARM with one attempt). A line with no session prices one request at section 13's 200k-token ceiling (700,000
bytes, 32,000 output tokens) per model as the proxy prices it, and fails unless every task and wrap-up allowance holds
that worst case once for each call a session can hold in flight: the main loop plus CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS
(ARM_ENV sets 2; the pinned Claude Code's default is 20). effort.json comes from batch 1's proxy records, and every session after it is checked against
it. The first Bash call of probe (P), B (C), C (N) and blind runs the PATH probe: the line passes only when, as root and as
uid 1000, every arm's PATH is /opt/pf-tools/bin then the image's own PATH, bun resolves to /opt/pf-tools/bin/bun, and
statechart starts with no args (exit 2 and its usage, not 127) where pstack is mounted. pf-labels and pf-oracle pay for
the labeller and the VM oracle, not driver stages, so the dry run opens and settles their leases itself at no spend.
The tree volumes are copied from the fixture repo and owned by root, and git in them trusts only /d. A, B, C and D are
scored with the Docker executor. It prints one PASS or FAIL line per fixture, and the driver settles every lease.

Tests. pf-run.test.ts covers runCopy and pfRecord. pf-agent.test.ts runs pf_agent_sdk_test.py, which drives PfAgent on the
real pinned SDK and Harbor with a stub Claude Code, a stand-in docker and a stub control plane; it skips without a Python
holding both (REAL_OUTCOME_PYTHON). pf-driver.test.ts covers the PF stage branch, the slot deadline and the wrap-up hold's
grace.

### Real-unit dry run

`bun lanes/outcome-skills/pfchecks/dryrun-units.ts --unit <unit dir> --neutral <pf-neutral.v1 record> --out <dir>
[--serial]` drives the fixtures that depend on the unit (unit-fixtures.ts) on a real MultiLang unit once its oracle has
run. It waits for the neutral record, so it can start while the neutral gate still runs.

- Containment comes first, on the session image built as the first session's would be, and every session waits on it.
  runPfSession runs the same gate (containUnit) before every session: the unit's first session runs the check and
  records it in the unit dir's pf-contain.json, one entry per session image tag; later sessions on the same image reuse
  a passing entry, and a failure halts the unit with E_PF_CONTAINMENT before any session, without dropping it.
  `gstack-evals outcome pf contain --unit <dir>` runs the check alone and writes the same record. sh/contain.sh runs as root with no network in
  a container of that image. It fails when any ref (branches, tags, remotes, notes, replace refs, stash, packed refs,
  FETCH_HEAD, ORIG_HEAD and the other special heads) or reflog entry points past the base commit, when any commit object is neither the base nor an
  ancestor, when the repository has alternates, a gitfile, a modules store or a nested .git, when a tracked file differs
  from the base (git diff, and each working copy hashed as git add would store it, so skip-worktree and assume-unchanged
  flags hide nothing), or when the repository holds a blob of a file the fix or the test patch changes as it reads after the
  patch (git apply --cached on a scratch index and object dir gives the blob ids). It lists every other git directory on
  the filesystem with its path and commit count, and fails when one holds the dataset's base commit, one of those blobs
  or a commit after the base that the unit's runtime image holds (upstreamAfter: every commit object in the image's
  repository that is not the base or an ancestor, or every commit object when the base is absent). Its needles are the added lines
  of 30 characters or more in fix.patch and test.patch that no blob in the base commit's tree holds, and the
  fail-to-pass test leaf names of 12 characters or more that no blob in that tree holds (base content never comes from
  the index or the working tree); it looks for them, as whole lines and as fixed strings, in every file outside the
  repository, in every file inside it whose bytes differ from the base commit's blob at that path or that the base
  commit lacks (untracked, ignored or staged only), and in every blob the base commit does not reach (named blob:<id>,
  counted as extra_blobs). Output names a needle by a sha256 prefix,
  never by its text. A failure is E_PF_CONTAINMENT and no session runs.
- The hang line reads N/A, not FAIL, when the ceiling left the hang entry unreached, every run it had matches a catch,
  and replaySchedule over the session's recorded runs still starts the entry's next run after the ceiling. The line
  prints that arithmetic.

Record, 2026-11-10, keyless, stub sessions:

- blocky-2016 (Go), local machine: DRYRUN ok at 74c273f, 38 lines, 37 PASS and 1 N/A (API guess: the fix adds no name
  a test could guess).
- gitoxide-2476 (Rust), one VM per run: DRYRUN ok at 74c273f, 38 lines, 37 PASS and 1 N/A (API guess); again at the
  build with the breaks line, 39 lines, 38 PASS and 1 N/A. Its breaks line passed with 7, 9 and 9 stable ids lost per
  run to the --nocapture parse and 0 breaks, where the reading before the breaks rule would have counted 2.
- agentscope-java-2257 (Java, Maven), one VM: 38 lines at 5a37165, 35 PASS, 1 N/A (API guess), 2 FAIL. Both FAILs are
  the hang entry, left unreached before its last neutral run. Its own runs before that run took 10,265 s (parent
  timeouts 1,956, 1,950 and 1,931 s; fix 184, 183 and 187 s; neutral timeouts 1,945 and 1,929 s), and it waited 1,486 s
  for slots and phase barriers behind the session's other entries. replaySchedule starts its last neutral run at
  11,751 s against the 10,800 s ceiling, so the hang line as built here reads N/A on that record
  (tests/outcome-skills/pf-dryrun-units.test.ts holds its runs). That run scored its three sessions at the same time,
  not one after another as its run plan said, so C's and N's runs shared the VM with P's for their first 1,981 s.
- The phase barriers stay. With no barriers, each entry running its own steps back to back on the same 4 slots, the
  replay of agentscope's P session cuts the waiting summed over entries from 67,951 s to 15,396 s, but the hang entry
  waits 1,688 s instead of 1,486 s and starts its last neutral run at 11,953 s instead of 11,751 s. Runs don't depend on
  other entries' phases either way: each is a fresh container on its own tree commit.
- Containment: blocky-2016, gitoxide-2476 and agentscope-java-2257 passed, each with one ref, one commit, no other git
  directory holding the dataset's base commit and no hit (58,627, 120,274 and 53,466 files read).

### Driver

`gstack-evals outcome serve --stage <pf item>=pf:P,pf:C,pf:N [--pf-allowance <json file>]` serves PF sessions (driver/stage.ts).

- pf-admit serves Opus, Sol and particle-1; pf-opus, pf-sol and pf-particle serve their own model; pf-blind serves pf:blind on Opus only. A stage that mixes PF arms with G or SM arms, or whose item carries skills other than pf, is refused.
- Each session opens two slots on the stage's lease: meta.phase "task", then "wrapup". cap_usd must equal sessionLimits(arm, model, allowance) for that phase, and each slot's deadline is that phase's wall limit plus the grace.
- Per arm, model, task and trial: the task phase opens at most twice, the second naming meta.rerun (the whole-session retry). Within each task attempt the wrap-up opens at most twice, the second naming meta.rerun, and only after that attempt's task open. planned and reruns count task opens only.
- A task open needs room for its task allowance plus its wrap-up allowance. The wrap-up allowance stays pending until the wrap-up opens, a new task attempt replaces it, or the task slot has been closed for the deadline grace.
- --pf-allowance takes the task-turn table (costReading's doubled one after admission); the default is items.ts ALLOWANCE. Sol and particle-1 route through OpenRouter, Opus through Anthropic, from registry.json's sm.models map.

# Review units as trials

`gstack-evals review-units` runs the stacks round's review lane (wiki/plans/2026-10-30-geva-59-stacks-round-1-plan,
sections 4 to 9). Each review of one unit by one arm on one model in one pass is a Lane A trial (src/trial/trial.ts), so
it gets the session cache key, resume, receipts and the rig's lease admission. Nothing here calls a model on its own.

## Modules

- unit.ts: unit repositories and unit trees.
- told.ts: the frozen told prompt and its sha256, and the PR-context template and its sha256.
- plan.ts: plan units: the plan arms, prompt, rec user, parser and CEO mode (see Plan units).
- findings.ts: the fixed findings parser and the render to arm contract v1. A finding that says whether it was confirmed gets reader `confirmed` or `unconfirmed`, so an arm's `severity_map.by_reader.unconfirmed` can map unconfirmed findings as informational, as the plan's primary map does for pstack.
- cost.ts: cost.tsv and refusals.tsv from the metering proxy's journal, plus reader rows.
- readers.ts: reader rows: each subagent a session launched, named through a reader map pinned to one gstack commit
  (reader-maps/).
- run.ts: runReviewUnits, the run loop on a HostRig.
- cli.ts: the command.

## Unit repositories

A unit repository is built from a full local clone (`--source <owner/repo>=<path>`; a shallow clone is refused):

- git init, then a fetch of the head commit and its ancestry only: no tags, no remote config, no reflog, no FETCH_HEAD,
  then gc --prune=now so only reachable objects stay. The head is checked out on branch `pr-<pr>`.
- The base branch is the repository's default branch (garrytan/gstack main, garrytan/gbrain master; `--base-branch`
  overrides). The local base branch and `refs/remotes/origin/<base>` sit at the merge-base of head and the unit's base,
  and `refs/remotes/origin/HEAD` points at it (T5).
- `.gstack-home/` is in .git/info/exclude, since the trial seeds a gstack state root in the work dir.
- The history check returns every problem: `git rev-list --all` must equal the head's ancestry, no tags, no remotes, no
  reflog, no unreachable objects, exactly the refs written, `git merge-base HEAD` with origin/<base>, <base> and
  origin/HEAD equal to the merge-base, `git diff <base>...HEAD` equal to the unit's diff, and a clean working tree.
  A failure refuses with E_UNIT_REPO.
- The sha256 of each instruction file the repository carries (CLAUDE.md and AGENTS.md at any depth, the .gstack/ tree)
  goes to units.json.

The unit tree is the repository plus its dependencies. The install command (`--install`, default
`bun install --frozen-lockfile`) runs in a builder container on the trial image with egress, at /work/<task id>, the path
the agent sees. The unit's own test command (`--test`, default `bun test`) then runs with --network none on a throwaway
copy. A failure refuses with E_UNIT_IMAGE, and the unit is dropped for every arm alike. The tree is kept by digest
(retainTree) and its dirTreeSha256 is the session key's fixture tree.

## A run

- Task id: `<repo name>-<pr>-<first 8 of head>`. The agent sees only /work/<task id>, seeded with the unit tree.
- Models: `--models` takes policy models with a Claude Code route (provider anthropic or openrouter), and the dry run
  prints each one's provider. GPT-6.1 Sol runs as `openai/gpt-6.1-sol`, through OpenRouter's Anthropic-compatible
  Messages route; `gpt-6.1-sol` is its openai route, which the judge and the Codex host use.
- Prompt: the told prompt with the arm's command (none no prefix, gstack /review, pstack /pstack:interrogate, tstack
  /sol-loop with "Run one review round and stop before any fix.") and the base branch.
- Session key: the unit tree's digest in fixture_tree, the told template's sha256 in task, the parser's source sha256 in
  verifier. --resume reuses a cell whose key matches and refuses a changed key with E_CACHE_STALE before any spend;
  --repair reruns those cells. --resume also keeps the run id in `<out>/run.json`, so the run still owns its ledger item
  and the install cache entries the crashed run held.
- A round is the next units with every arm for one pass and one model, as many as --parallel holds, and it starts only
  when its worst case at the allowance fits under --spend-cap (CAP_STOP otherwise).
- Outputs: `<out>/arms/<arm>-<model tag>/` per arm and model in arm contract v1 (arm.json, findings/<unit>.jsonl with each
  finding's pass, cost.tsv; no judgments.tsv, so the arm is raw), plus units.json, parses.tsv, refusals.tsv,
  cells.ndjson and progress.json. The model tag is a Claude model's family (opus, haiku), else the model id's last path segment, cut to 17 characters
  plus a 6-character hash once it passes 24. Each run rebuilds <out>/arms from the journal, so no stale arm survives a resume there. The receipts sink is a
  merge copy: it keeps any arm an earlier run of the same out dir wrote.
- Parse outcomes per unit-pass: findings, empty (a real zero), missing (no fenced json block: zero, flagged), malformed
  (flagged, never zero) and incomplete (the session did not complete: never scored as zero). A malformed or incomplete
  unit-pass is a coverage gap: the arm is written with status stopped and coverage_gaps naming each one, so scoring gives
  it no verdict instead of reading the pass as an empty review.
- cost.tsv: an all row and, in a cell with a voice, a voice row per unit-pass, from the proxy journal (meter_source
  proxy-journal). usd comes from spent_micros; a call with an unknown outcome makes its row's usd and tokens
  unavailable. requests, refused and unknown_calls are extra columns; refusals.tsv marks an arm and cell degraded when
  more than 2% of its requests were refused.
- The out dir must outlive the machine (E_RECEIPTS_VOLATILE). With GSTACK_EVALS_EPHEMERAL=1 the receipts are copied to
  GSTACK_EVALS_RECEIPTS, which the run refuses (E_USAGE) when it is the out dir or sits under <out>/arms, and, for a
  sealed suite, when it resolves inside the repo, since cells.ndjson quotes held-out material.

The rig's arm installer takes one target skill for every arm, so one invocation runs arms that share a told skill:
none with gstack, or none with one other stack. `--dry-run` prints the plan and writes nothing.

## Per-arm and per-run settings

Every default keeps a frozen preregistration's run as it was: same options, same prompts, same session keys.

- `--system-prompt <arm>=sdk-default|claude-code-preset`, repeatable. sdk-default (the default for every arm not named)
  passes no system prompt option, so the Agent SDK sends its empty one. claude-code-preset passes the SDK's claude_code
  preset, which brings Claude Code's own system guidance. arm_provenance.system_prompt in arm.json and system_prompt in
  each session's init.json record it.
- `--told-prefix <arm>=<file>`, repeatable. On code units the file's one line replaces the arm's told command (for
  example R2's full-procedure /review line); it must open with a command TOLD_COMMANDS in told.ts declares for the arm:
  its own, and for a gstack arm also /ship (R56-1's review panel). The arm's install target is the skill that command
  names, in the rig's install and in each session alike (/ship installs ship). A code prefix with a control character (a
  CR, tab or BOM included) is refused, and the refusal names the character. The template and TOLD_SHA256 stay the same. On plan units (plan-told.ts) only a gstack plan arm takes one: the line must open with the lens's
  command (/plan-ceo-review) and add words after it, and the arm's line becomes that line, a space and "Review this plan
  for problems.". A prefix that holds that ask, starts or ends with whitespace, or has a control character (a CR, tab or
  BOM included) is refused, and the refusal names the character. A gstack-<suffix> arm needs a prefix (E_USAGE without
  one). Under `--plan ceo-outcome` these plan-unit rules don't apply: only gstack-forced and gstack-enforced take a prefix, it is optional,
  and it must equal ceo-outcome.ts's FORCED_LINE byte for byte; any other prefix, or a prefix on any other arm, is
  refused (E_USAGE). none, lens, placebo and gstack-auto refuse a prefix (E_USAGE), and so does the arm named gstack when placebo
  runs, since placebo keeps the default gstack line. Either way arm.json's told block records the prefix and prefix_sha256,
  and an arm without one keeps today's prompt and block.
- `--render <arm>=interactive|unattended`, repeatable, on a gstack stack arm. The install runs gstack's setup, renders
  the full loadout into ~/.claude/gstack-render, serves each rendered skill's SKILL.md and sections from it, and checks
  the lock's session_kind and the served review and investigate start lines (src/arms/install.ts). arm_provenance.render
  records the lock. Two arm names may share a stack ref and render, so they install the same tree and differ only in
  their settings. On code units only an arm told /review takes one, since the install checks no other skill's start line.
- `--max-turns <n>`: the most model turns a session may take, default 60 (the driver's MAX_TURNS).
- `--session-kind unattended`: GSTACK_SESSION_KIND=unattended in every arm's agent env, none included. Off by default.
- `--arm-session-kind <arm>=unattended`, repeatable: the same for one arm only, keyed per arm. It can't run beside
  `--session-kind`. On plan units only, and under either flag, a gstack arm whose kind is set runs its own tree's
  bin/gstack-session-kind in the arm's session env before any session, and the run is refused (E_SESSION_KIND_PIN) unless
  it prints the kind.

- `--allowance <usd>`: each session's spend cap on its proxy slot. Left out, a session gets SESSION_ALLOWANCE (1.6M input
  and 32k output tokens) at its model's price, $7.04 on Opus 5.5. The proxy refuses a call whose worst case the slot's
  allowance cannot hold (E_ALLOWANCE).
- `--cap-stops`, code units only: cap stops (below). Off by default.
- `--reader-map <file>`, code units only: reader rows (below). Every gstack stack arm must run the map's gstack commit
  and be told /review, whose readers the map names.
- `--pr-context <dir>`, code units only: every arm sees the PR's title and its first description. The run reads
  `<dir>/<unit id with / # and @ as _>/pr.md`, the layout harness-evals' scripts/review-bugs/build-unit.ts writes, and
  the prompt becomes TOLD_PR_TEMPLATE (told.ts): TOLD_TEMPLATE with "The pull request's title and description, as its
  author first wrote them:" and the pr.md text after its first paragraph. Each arm's own prefix still comes first, so the
  block is the same bytes for every arm. It is all or none: a selected unit with no readable pr.md, an empty one, or one
  with a control character other than a line feed or tab refuses the run (E_USAGE) and lists every such unit. The session
  key's task carries TOLD_PR_SHA256 as told_sha256 and the pr.md's sha256 as pr_sha256; arm.json's told block and
  units.json record the template's sha256 and each unit's pr_sha256. Left out, every prompt, key and record is today's.

run.json records max_turns and session_kind, and arm_session_kinds, allowance_usd and reader_map (its sha256 and gstack commit) when they
are set. --resume with other values than run.json records is refused before anything runs, and run.json stays as it was
(E_CACHE_STALE). A setting off its default also joins the session key, so a cell run under another value is never
reused. The allowance is the exception: it joins the key only in a --cap-stops run (below), and otherwise only the
run.json check refuses a resume under another allowance.

## Cap stops and reader rows (R2 build)

R48 follow-ups prereg, section 3.6, and a review note on #119.

- **Cap stops.** A run with `--cap-stops` records a code session that either cap ends as its own termination:
  turn_cap (the CLI's error_max_turns result) or allowance_stop (the proxy's E_ALLOWANCE refusal that
  names the slot's allowance). A capped session is scored, never a coverage gap (the Captain's ruling for R2), and counts
  against its own arm, the same in every arm: its findings are those of the latest main-agent text block in the session's
  transcript.ndjson whose last json block parses as findings (an AskUserQuestion's question never counts), and with no
  such block, or no readable transcript, it is a missing pass, scored as finding nothing. arm.json counts them
  in `cap_stops: {turn_cap, allowance_stop, units, parser_sha256}`, where units names each unit a cap stop hit and
  parser_sha256 is capped.ts's (the read rule), and diagnostics names each session with its settled metered spend. In
  such a run the session key's verifier is the findings parser's sha256, capped.ts's and readers.ts's (whose
  readTranscript feeds the read rule), so a change to any of them refuses its cached cells, and the allowance joins the
  key. A run without `--cap-stops`, whatever its `--max-turns` and `--allowance`, and every plan unit of `--plan ceo`,
  keeps today's records and keys: the turn cap ends a session as completed, and the allowance as a missing cell
  (E_ALLOWANCE). A `--plan ceo-outcome` run always runs cap stops, with or without the flag (see CEO outcome units).
- The allowance binds worst-case committed spend, including the reservations of calls still in flight, so a session that
  runs calls in parallel can stop below its allowance.
- **Reader rows.** With `--reader-map`, each code session's readers go to the journal and to cost.tsv as
  `reader:<name>` rows after the unit-pass's all and voice rows, sorted by name. A reader is a subagent the main agent
  launched through the Agent tool (Task in older CLIs) and the CLI started (task_started, or a message from the
  subagent). Its name comes from the launch prompt: the one map checklist the prompt names (a path ending in, say,
  review/specialists/testing.md), batched when it names two or more, adversarial-native when it names none but carries
  the map's adversarial marker, and other otherwise. A row's pr and pass are the unit-pass's (the unit id, as the all row
  writes it, and the pass number), its total_tokens is the sum of its subagents' task_notification usage (unavailable
  when one never reported), its meter_source is reader-counter, and every other column is unavailable or blank
  (READER_ROW in readers.ts). arm.json names the map in reader_map_sha256. A run without a map writes no reader rows.
- reader-maps/gstack-77fe28c39796.json is the map for garrytan/gstack at 77fe28c39796cf5573e3d0836b83b2ee436a8f12
  (v1.92.39.0): Step 4.5's ten Review Army checklists and Step 4.8's Claude adversarial subagent.
- **R2's two runs** (section 5): none-r2 runs alone on its own out dir with `--item r2a-grid --spend-cap 25`, and
  gstack-full alone with `--item r2b-grid --spend-cap 325`. The first lease binds each item to its run, so a second run
  on either is refused (E_ITEM_BOUND). The R2 amendment pins the exact commands.

## Plan units

`--plan ceo` runs plan units from a plan suite (planning lane plan wiki/plans/2026-10-31-geva-79-planning-lane-plan,
B1 to B4), with `--sealed-root` when the suite is sealed. plan.ts holds what differs:

- Arms: `none` ("Review this plan for problems."), `gstack=<gstack repo>@<sha>` (`/plan-ceo-review` and that line),
  `lens` (the lens line from the skill's description, then that line), `placebo` (Lane B's placebo tree generated
  from the gstack arm, with the gstack line) and `gstack-auto=<gstack repo>@<sha>`, a frozen placeholder for
  the CEO-only /autoplan that refuses every gstack until a release sets GSTACK_AUTO. A gstack stack arm named
  `gstack-<suffix>` (not gstack-auto) is a second gstack arm, such as a forced-procedure arm, and needs its
  own `--told-prefix`. `--arm-models
  <arm>=<model>[,<model>]` limits an arm to some of `--models`, so lens runs only on Opus and placebo only on particle-1.
- TOLD_PLAN_TEMPLATE, pinned by TOLD_PLAN_SHA256, asks for a `plan-findings` fence with severity (Critical, High,
  Medium, Low), section, line, claim, evidence and fix. PLAN_SEVERITY_MAP maps Critical and High to CRITICAL.
- A plan unit installs and tests nothing: its tree is the repository, with the same history check.
- Every arm runs with the rec user: each question gets "Go with your recommendation.", one that offers another skill or
  review, or to promote or commit docs, gets "No, not now.", and the simulator's binding rules still refuse gated
  effects. No model answers for the user. An arm that installs gstack gets every question in its registry set to
  never-ask (auto-decide) in the trial's throwaway state root, written over any preferences file the unit's tree ships;
  arm.json records that file's sha256 as `question_preferences_sha256`.
- No second model: --plan builds every cell without its Codex voice (gstack's config gets codex_reviews disabled and the
  cell tree records it), the run refuses a cell that keeps one, the slot admits only the driver model and arm.json lists
  the driver alone.
- The parser reads the last `plan-findings` block in any assistant turn, and nothing else: no file the session wrote
  and no subagent's text. A malformed or missing block is scored as finding nothing and listed in arm.json
  `diagnostics`, and so is a pass that, after the model produced output, timed out, ended by the arm's own CLI failing,
  or completed with no text turn. arm.json counts per arm, as `completed_without_text`, every miss whose session
  completed with no text from the main agent (no turn, or only AskUserQuestion questions, which parse as missing), so
  an arm that answers only through files shows. Model output is the session record's `model_output`: any non-empty assistant text or
  thinking, a thinking block with a non-empty signature, or a tool call the driver saw, never its turns, which hold main-agent text only. A session that ended any other way (a
  timeout, a CLI failure or a completed session before any model output, a provider failure, an infra incident, an infra
  failure (E_INFRA_FAILURE: the evaluator's own code, the link to the CLI or the machine, at any point), rejected
  credentials or an unknown send) is a coverage gap that stops the arm, as are a cell not run and a cap stop; a stopped
  arm gets no verdict. progress.json counts each plan session the way arm.json scores it: findings as passed, a miss as
  failed, a gap as missing.
- Each session's CEO review mode, from gstack's mode handoff line, goes to modes.tsv and arm.json `ceo_modes`.

## CEO outcome units

`--plan ceo-outcome` runs a ceo-outcome suite (the CEO outcome preregistration, wiki/plans/2026-11-04-geva-285-ceo-outcome-prereg,
as its amendments change it), with `--sealed-root` when the suite is sealed. ceo-outcome.ts holds what differs from
`--plan ceo`:

- Arms: none, lens, gstack-auto (/autoplan --ceo-only) and gstack-forced (the standalone CEO review, behind CEO v2's
  forced line), each with the lens's own prompt, plus the stage 2 amendment's gstack-enforced (ceo-arms.ts), which runs
  plan arm gstack with gstack-forced's prompt. Any other arm is refused, and so is any `--told-prefix` but FORCED_LINE
  on gstack-forced or gstack-enforced.
- gstack-enforced runs a pinned gstack tree with its CEO review gate on (`ceo_review_gate: on`, skill-gates.ts). A
  settings command run in the session sandbox sets up the gate, and trial.json records it. The merged stage 2 amendment
  (wiki/plans/2026-11-06-geva-345-ceo-stage-2-amendment) and the scorer post
  (wiki/plans/2026-11-06-geva-348-ceo-scorer-stage-2) give the details.
- Cap stops are always on. A session that ends with a success result and no parsable closing block gets the driver's
  one follow-up turn (docs/adapters.md).
- Each journal entry stores the one parse of its closing block with the parser's sha256, section 6's end state, whether
  the follow-up went, `wall_s` (the driver's session clock) and `usd` (settled metered spend). The session key's
  verifier covers ceo-outcome.ts, capped.ts and readers.ts, and the allowance joins it.
- A gap is listed in arm.json and logged, never an E_COVERAGE_GAP stop. stops.json lists each unit-pass a CAP_STOP
  stopped, with its settled `usd` and `wall_s`, or left unstarted. `--resume` never reruns a cell stops.json lists
  as stopped, because a cap stop is never retried: it carries the cell, with its spend, into the new stops.json and
  runs only the unstarted cells. A stops.json that doesn't parse refuses the resume before any session.
- units.json records the suite binding: the units dir's digest (`catalogs_sha256`, the suite stub's catalogs digest),
  its name and the suite's unit ids. `gstack-evals ceo rows`, `packets` and `readings` refuse a `--units` dir that
  doesn't hash to it, so no key.json or plan.md can change after the runs. rows.json and readings.json carry the
  binding, and so does the packet key as `catalogs_sha256`. A `--resume` whose binding differs from the one
  units.json holds is refused before any session, because session keys don't cover key.json. units.json is written
  before the first session, so a resume whose out dir holds cells or a stops.json but no units.json is refused too.
- rows.json records `exposure_sha256` (ceo-exposure.ts's digest) beside `parser_sha256`, and packets and readings
  refuse rows from another one. Each row carries `model_id`, and rows read only the three model ids the
  preregistration names, by their exact policy keys.
- Before a session's work dir is removed, each ceo-review.md under it is copied into `host/ceo-review/` at its relative
  path. Symlinks are skipped, and each copy failure is logged in trial.json under `logs.copy_out`.
- The receipts sink also gets every session's `host/transcript.ndjson`, which rows read for exposure, its trial.json and
  `host/ceo-review/` beside it, and an enforced session's `host/skill-gates/`.
- Every ceo-outcome session sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1, so each model runs with a 200,000-token window.
  `gstack-evals ceo rows` takes `--order <file>` at `--stage 2`, and `--smoke-round 1` or `2` at stage 1 to read stage
  1's smoke or its rerun.
- The out dir must sit outside the repo.

## Product-value units

review-units --plan product-value --family plan|brief runs prereg 2026-11-08-geva-403's review sessions (product-value.ts, pv-cli.ts). Each arm's first line and the closing template are frozen in product-value.ts and tested against the post. Every arm runs with the claude-code-preset system prompt, 150 turns, a 3600 s timeout, one session at a time, a 200,000-token window and web tools denied. The gstack arm runs the 23f9d07 pin unattended; plan-ceo-review-gate adds gstack's opt-in gate for smoke rule 3. --pv-fallback-sentence adds smoke rule 2's sentence on the plan family only. The dry run asserts both families' mounts and prints each arm's prompt sha256. Each session's journal entry holds one parse with the parser's sha256, its end state, every attempt and its spend; arm.json's product_value counts them. lanes/product-value/README.md lists the build-time choices.


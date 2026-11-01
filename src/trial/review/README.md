# Review units as trials

`gstack-evals review-units` runs the stacks round's review lane (wiki/plans/2026-10-30-geva-59-stacks-round-1-plan,
sections 4 to 9). Each review of one unit by one arm on one model in one pass is a Lane A trial (src/trial/trial.ts), so
it gets the session cache key, resume, receipts and the rig's lease admission. Nothing here calls a model on its own.

## Modules

- unit.ts: unit repositories and unit trees.
- told.ts: the frozen told prompt and its sha256.
- plan.ts: plan units: the plan arms, prompt, rec user, parser and CEO mode (see Plan units).
- findings.ts: the fixed findings parser and the render to arm contract v1. A finding that says whether it was confirmed gets reader `confirmed` or `unconfirmed`, so an arm's `severity_map.by_reader.unconfirmed` can map unconfirmed findings as informational, as the plan's primary map does for pstack.
- cost.ts: cost.tsv and refusals.tsv from the metering proxy's journal.
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

## Per-arm and per-run settings (GEVA-109)

Every default keeps a frozen preregistration's run as it was: same options, same prompts, same session keys.

- `--system-prompt <arm>=sdk-default|claude-code-preset`, repeatable. sdk-default (the default for every arm not named)
  passes no system prompt option, so the Agent SDK sends its empty one. claude-code-preset passes the SDK's claude_code
  preset, which brings Claude Code's own system guidance. arm_provenance.system_prompt in arm.json and system_prompt in
  each session's init.json record it.
- `--told-prefix <arm>=<file>`, repeatable. On code units the file's one line replaces the arm's told command (for
  example R2's full-procedure /review line); its command must name the arm's skill. The template and TOLD_SHA256 stay
  the same. On plan units (GEVA-115, plan-told.ts) only a gstack plan arm takes one: the line must open with the lens's
  command (/plan-ceo-review), and the arm's line becomes that line, a space and "Review this plan for problems.".
  none, lens, placebo and gstack-auto refuse a prefix (E_USAGE), and so does the arm named gstack when placebo runs,
  since placebo keeps the default gstack line. Either way arm.json's told block records the prefix and prefix_sha256,
  and an arm without one keeps today's prompt and block.
- `--render <arm>=interactive|unattended`, repeatable, on a gstack stack arm. The install runs gstack's setup, renders
  the full loadout into ~/.claude/gstack-render, serves each rendered skill's SKILL.md and sections from it, and checks
  the lock's session_kind and the served review and investigate start lines (src/arms/install.ts). arm_provenance.render
  records the lock. Two arm names may share a stack ref and render, so they install the same tree and differ only in
  their settings.
- `--max-turns <n>`: the most model turns a session may take, default 60 (the driver's MAX_TURNS).
- `--session-kind unattended`: GSTACK_SESSION_KIND=unattended in every arm's agent env, none included. Off by default.

run.json records max_turns and session_kind. --resume with other values than run.json records is refused before
anything runs, and run.json stays as it was (E_CACHE_STALE). A setting off its default also joins the session key, so a
cell run under another value is never reused.

## Plan units

`--plan ceo` runs plan units from a plan suite (planning lane plan wiki/plans/2026-10-31-geva-79-planning-lane-plan,
B1 to B4), with `--sealed-root` when the suite is sealed. plan.ts holds what differs:

- Arms: `none` ("Review this plan for problems."), `gstack=<gstack repo>@<sha>` (`/plan-ceo-review` and that line),
  `lens` (the lens line from the skill's description, then that line), `placebo` (Lane B's placebo tree generated
  from the gstack arm, with the gstack line) and `gstack-auto=<gstack repo>@<sha>`, a frozen placeholder for
  GST-537's CEO-only /autoplan that refuses every gstack until a release sets GSTACK_AUTO. A gstack stack arm named
  `gstack-<suffix>` (not gstack-auto) is a second gstack arm, such as a forced-procedure arm with its own
  `--told-prefix`. `--arm-models
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

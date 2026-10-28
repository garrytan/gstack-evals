# Quick look 3 preregistration: Lane A before/after on gstack's office-hours diet

Exploratory. These numbers steer gstack research and support no public claim. Author GSTA-13 (crew of GSTA-2, model anthropic/claude-opus-5-5), 2026-10-28. Results go in a separate pull request and record this file's commit sha.

## Question

Did gstack's office-hours diet (v1.91.289.0, gstack `a14c28aca783`, gstack#3525) lose behavior that its parent (`cd4fc4be73d8`) had, on Opus 5.5 and Haiku 5.5? Sanity check: does the same runner find no loss for the /learn diet (v1.91.287.0, `7204a39a27ba` against parent `398618259d56`) on gstack's committed /learn contract tasks?

## Arms

Each arm is a full gstack tree at a pinned sha, installed in a Docker image by its own `./setup --host claude --no-browser` (Claude Code 2.1.312, Bun 1.4.4).

- **before**: the diet commit's parent. **after**: the diet commit. **before2**: a second, independent panel of before, the noise floor.
- **none**: the before tree with the target skill removed (`~/.claude/skills/<skill>` and `gstack/<skill>`), as interface v0.4 defines it.
- Every session: a fresh container and HOME, `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1`, every model variable set to the cell's model, the CLI's default effort, `TMPDIR` at `<work>/.tmp` (git-excluded, so a check can see temp files such as the sketch), and a gstack state root at `<work>/.gstack-home` seeded as an onboarded user (onboarding markers, telemetry off, update check off, proactive `core`, cross-project learnings off, routing declined). Keyless calibration showed `SESSION_KIND: interactive` and no onboarding blocks.
- The images keep what `./setup` builds, including gstack's design binary, and hold no OpenAI key, Codex CLI or browser. So mockup generation cannot succeed, and the second opinion falls back to a Claude subagent on the cell's model.
- Image ids: `images.json`.

## Models and trials

`claude-opus-5-5` and `claude-haiku-5-5`, 3 trials per task and arm. No Sonnet. No judge (the sidecar's `judge` lines are not used).

## Tasks

- **office-hours**: 13 tasks.
  - 11 come from gstack#3550 at `09fc5124d9b5` (GSTA-142, unit U12): mode-question, first-startup-question, vague-evidence-pushback, builder-mode, premise-challenge, second-opinion-offer, alternatives, approach-approval-gate (safety), ui-visual-step, backend-skips-visual and no-code-session (safety). sha256: tasks.json `472af4f02f08a658a5572f3ed993fe8aa600d1610642db2a48fba91e691ed656`, tasks.ext.json `20d3a53727befd809824e2ce28a9af1114e6cdde3f0f2e5346d2142f4fb2f125`, seed.sh `10b85c8f7fbcdd4ca8f1974ef78f8104b770daac9007144d019aea0bead4538c`.
  - 2 are added here, because none of the 11 walks into the two blocks the diet moved into on-demand sections.
    - second-opinion-accepted: the user accepts the Phase 3.5 second opinion. `must` is its `SECOND OPINION (Claude subagent|Codex)` header.
    - visual-sketch-accepted: an approved UI approach and an accepted sketch. Its setup removes gstack's design binary, so the skill takes the HTML wireframe path, and `check` finds `sketch.html` in the work dir.
    - Files: `tasks/office-hours.extra.json` (sha256 `e5ab6a90f70061d2755300fdb9b3d348a711fe588c9df53e5a18f0ecc0dcde9d`) and `tasks/office-hours.extra.ext.json` (sha256 `44448568dfe4c5daef54e9363d5e2de6b7b03f829f5668d4d443b257edbade2d`).
- **learn**: 10 tasks at gstack `7204a39a27ba`: show, search, stats, export, add, prune-stale, prune-conflict, cross-project, empty, no-code-change (safety). sha256: tasks.json `2c2b88193ecfe681e3620d12da40b97be7d89b0790c43f1c19f26f4e36e4bc54`, seed.sh `3428622aa410a41e215dbe505e8f389493befd78b0f8575483c2abb894fb1c22`.
- The diet's contract lines (MUST, NEVER, STOP, ask and approval lines, required outputs), with the tasks that cover each, are in `contract-lines/`, written before any run. The diet changed 57 of 371: 54 moved into the two new sections and 3 were rewritten in place. It removed none outright. Counting the judge lines, 50 of the 57 have no covering task under the 11 upstream tasks, and 46 with the 2 added tasks (a map drawn before visual-sketch-accepted switched to the wireframe path; the results recount it). This quick look grades no judge, so on `must` and `check` alone the 11 tasks leave 53 uncovered.

## The scripted user

The Agent SDK runs on the evaluator side and starts Claude Code inside the container over `docker exec -i`, so replies never enter the container. `usersim/categories.json` classifies each question by keyword, first match in a fixed order: an AskUserQuestion on its header first, then its question, then its option labels. An AskUserQuestion gets the task's sidecar reply for its category, or a fixed non-approving fallback. A turn that ends in a prose question gets the scripted reply for its category; with no scripted reply, or no question, the session ends. Limits: 8 prose replies, 12 answers, 2 replies per category, 80 agent turns, 20 minutes. /learn has no replies, so its asks get the fallback and a prose question ends the session.

## Metrics

- **Pass (primary)**: `check` exits 0 in a fresh no-network container on the session's final work dir, and every `must` matches the session's assistant text plus its AskUserQuestion questions and options, and no `must_not` matches their code blocks.
- **Pass (secondary)**: the same with `must` on the final answer only, the contract's wording. GSTA-142 left this choice to Lane A; the scripted user carries sessions past the first stop, so the primary grades the whole transcript.
- **Opened**: a successful Skill call for the skill, or a successful Read or cat of its SKILL.md.
- **Cost and tokens**: measured per request by the metering proxy. **Loaded bytes**: the sizes, in the arm's image, of the distinct skill files a session loaded.

## Analysis

Per suite and model:

- k/n per task and arm, and pooled rates with Wilson 95% intervals.
- after minus before: the mean of per-task differences, with a 95% task-clustered bootstrap interval (10,000 resamples, seed 20261028). The same for before2 minus before (the noise floor) and none minus before.
- The contract gates: REGRESSION (before at least 2/3, after under 2/3), SAFETY (any failed after run of a safety task), WORSE (pooled after below before by more than two standard errors), MISS (before and before2 at least 80%, after at most 1/3), UNOPENED, and an exact one-sided sign-flip test over informative tasks (after against pooled before and before2).
- Fewer than 5 informative tasks is NOT_MEASURABLE. A task where before or after opened the skill in under half its runs is flagged not informative; an opened-only table repeats the analysis without those tasks.
- "Loss signal": any gate fires, or the after minus before interval lies wholly below 0. "Within noise": the after minus before mean falls inside the before2 minus before interval.
- Timeouts and infra errors are missing cells, counted per arm. An infra-error cell is rerun once; its spend stays on the ledger. A session that hits its spend ceiling is graded as it stands and flagged.
- The verdict also lists contract lines the diet removed, rewrote or moved that no task covers, and tokens, cost and loaded bytes per arm.

## Cap and stop rule

- Cap: $130, line item `lanea-quick`, ledger `captain-gstack-evals/ledger/lanea-quick.jsonl`. Its first row is the approval.
- Before each session, a reserve row at its worst case: Opus $5.25, Haiku $0.75. The proxy refuses a session's requests past $3.50 (Opus) or $0.50 (Haiku). After each session, a settle row with measured usage.
- A reservation that would pass the cap stops the run: CAP_STOP, incomplete, never retried to change a result. The provider key cannot carry a spend limit from here, so the ledger is the only limit.
- Order:
  - S0: /learn on Haiku, all four arms. It is cheap and shakes down the runner.
  - S1: office-hours before, after and none, both models. Trials run in order 1, 2, 3, and within a trial Haiku runs before Opus, so a cap stop leaves complete trials.
  - S2: office-hours before2, both models, for as many complete trials as fit the remaining cap.
  - S3: /learn on Opus, all four arms, for as many complete trials as fit.
  - "Fit" is `src/run.ts project`: the mean measured cost per session for that model and suite, times the trial's sessions, times 1.25. For /learn on Opus before any Opus /learn data, it scales the Opus office-hours mean by Haiku's learn to office-hours ratio.
- No same-tree rerun stage, and no trials are added after a result.

## Differences from interface v0.4

This is a thin runner. Setup runs in the agent's container, and the fixtures are deleted before the agent starts. The agent's container has default Docker egress. There is no sentinel calibration session; calibration is keyless (the init skill list, the preamble probe and a shell call). No lock file: this prereg is the lock. The fallback answer is fixed text, not a gpt-6-luna persona reply.

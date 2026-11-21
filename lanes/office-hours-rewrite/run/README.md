# office-hours-rewrite: run

The arm sessions of the office-hours rewrite eval (prereg sections 2, 3, 4, 8, 12 and 13; pre-run change 1, items 1, 4a,
4b, 4c and 5; pre-run change 2).

- `pins.ts`: the three arms (none, and gstack at the current and new pins), the host and container pin checks, the
  null-pin refusal, and the arm env check.
- `seed.ts`: the T8 seed, the developer profile each pin's own --log-session would write for the brief's prior session.
- `session.ts`: the first messages, the closing loop (done, the 20-reply cap, two closing messages, delivered replies
  only), the transcript reads (safety stops, SESSION_KIND) and section 8's failure table.
- `manifest.ts`: the launches, their ledger lines and caps, the reserve rule, the seeded order and the frozen manifest.
- `rows.ts`: one row per session, and the rows report against the manifest.
- `run.ts`: runLaunch, the launch loop, and dockerLaunch, one attempt on the Docker rig.
- `cli.ts`: the run, rows and e2e commands, for the lane's cli.ts to mount.
- `e2e.ts`: the keyless Docker end to end (two invented briefs on all three arms, a stub model server behind the real
  proxy, the real simulator turn, parser and rows). It prints SKIP when Docker does not answer. The rig needs both pin
  commits in a local repository: a gstack checkout, or a clone under <state>/sources/ (for example a link from
  ~/.capy/work/gstack-evals/sources/gstack to a full gstack clone).
- `home-watch.ts`: pre-run change 5's F1 and G1 on every Sol session: the harness's snapshots of Codex's home before and
  after every exec and after copy-out, their diffs against the frozen allow list, the rollout prefix check, the
  event-stream flags, and the collaboration mode of every turn.
- `seams.ts`: the dry-run seams, run by tests/ohr/run/seams.test.ts.

## Reused and copied

Reused by import: the Docker rig (dockerRig), runTrial, the Claude Code driver, the founder lane's containment probe,
read audit, work repo, receipts copy and ndjson reader, the product-value meter and pool, and the claude-code-preset
system prompt.

Copied and adapted, because the shapes differ:

- runLaunch is the founder lane's runSchedule, adapted to two pins plus none, the closing loop and rounds.
- readRows and rowsReport follow the founder lane's, for this lane's SessionRow.
- The manifest freeze follows the founder lane's, with pins, both rules digests and the build commit added.
- reconcile, for an attempt marker with no row, is a smaller copy that counts it as an unknown harness failure.

## Build-time choices

- An arm stop (turn cap, timeout, allowance, overflow) retries once and then scores no-block with E_OHR_ARM_STOP,
  because EndState has no arm-stop state.
- A safety stop is read from the transcript (main-agent stop_reason refusal or content_filter, or Claude Code's
  model_refusal notices) and checked before UPSTREAM, since Claude Code turns a refusal into an error frame.
- The end state "refusal" is never written, since no provider marker apart from those reaches the driver.
- A skill arm that prints a SESSION_KIND other than interactive retries once, then scores missing with
  E_OHR_SESSION_KIND; no print reads null and is scored as it ends.
- session_kind is the SESSION_KIND line the skill's start step printed as Claude Code loaded it, read from
  host/claude-session.jsonl between A8's head and tail (pre-run change 5), else the first main-agent tool result that
  prints one.
- served_model is the models the scored attempt's replies report: Claude Code's transcript for Opus and particle-1, and
  the model tap for Sol, because Codex's own records name the model it asked for. cli_version is the version the
  transcript's init line names. rows flags either when it is not the pin, except that a model drift halt already names
  the model in its own code.
- Each launch uses two ledger items (arms through the rig's lease, simulator through the meter), because one item
  allows one open lease; the launch refuses caps whose sum passes the frozen line (E_OHR_CAP_LINE).
- Stage 2's order sorts the comparison ids and shuffles them with SEED; each brief's models follow MODELS order and the
  arms of each brief and model are shuffled from the same stream. Stage 1 runs in draw order with a fixed arm order.
- A round is one brief and model with its arms; it starts only when one attempt's allowance for each of its sessions
  fits what the launch may still spend, after the allowances held for attempts in flight (pre-run change 4). A retry
  runs only when its own allowance still fits; otherwise the session ends as a cap stop and the launch stops.
- A reply whose model is not the session's pin (or that model's dated snapshot) halts the launch with
  E_OHR_MODEL_DRIFT, and the session reads missing. The check reads every assistant message in the transcript; the
  proxy already refuses any request for another model, since the slot's allowlist holds only the pin.
- A brief's digest is sha256 over opening.md, sheet.json, key.json, brief.json and, when present, prior.json, joined
  with a NUL byte.
- The manifest is compared as exact JSON text.
- The build commit is git HEAD, refused when tracked files differ from it (E_OHR_BUILD_COMMIT).
- The T8 seed holds one sessions entry on the current pin, and on the new pin also a commitment entry with the kill
  date and test; the slug is the work repo's name, which is what gstack-slug prints there.
- A T8 test date must be at least two days before the session's UTC day, checked at launch before any lease
  (E_OHR_T8_SEED).
- The seeded profile is written into the work repo's state root before the trial starts.
- The container's pin check runs sha256sum when the container stops; the host tree is checked once at rig open.
- A Claude Code container's end step also copies Claude Code's own session files (HOME's .claude/projects/*/*.jsonl)
  to host/claude-session.jsonl beside the transcript, for A8; the SDK stream never carries the skill expansion. A failed
  read writes nothing, so A8 finds no copy and fails that session. Sol containers copy nothing: their transcript holds
  the <skill> item.
- The arm env is checked on the driver's env and on the container's env names.
- Manifest-level drops come in as a list; the reserve rule fills them, and a brief with a stage 2 session cannot drop.
- --models and --arms filters are allowed, and become part of the frozen manifest.
- makeManifest takes an explicit schedule only for the keyless end to end; no command passes one.

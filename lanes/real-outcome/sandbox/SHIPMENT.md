# The shipment record (real-outcome/shipment/v1)

What one real-outcome trial shipped, for B6's scorer and verifier. The sidecar writes it once, at close, from its own journal and the origin's refs (`shipment.ts`, `deriveShipment`). Nothing the agent writes in its container feeds it. Plan: [2026-11-01-geva-87](../../../wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan/README.md), open item 1.

## Files

The sidecar closes a trial when the agent's session ends (`POST /trials/<id>/close`), before Lane B's teardown, so nothing after the session counts. It writes three files in the trial's directory, and the agent copies them to the trial's `evaluator/` folder:

| File | Mode | What it holds |
|---|---|---|
| `shipment.json` | 0444, written once | The record below. The close response carries its sha256, and the agent checks the copy against it. |
| `journal.jsonl` | 0444 after close | Every event, one JSON object per line, in order (`seq`). Only the sidecar writes it. |
| `shipped.bundle` | | `git bundle --all` of the origin at close, plus `refs/real-outcome/shipped`, `refs/real-outcome/held` and `refs/real-outcome/pr/<n>` for the heads B6 grades. The record holds its sha256. |

## Fields

| Field | Meaning |
|---|---|
| `schema` | `real-outcome/shipment/v1`. |
| `trial`, `repo`, `kind` | The trial id, the owner/name the gh stub reported (never the upstream's), and K1 to K4. |
| `base_branch`, `base_commit`, `start_ref` | The base, and where the agent started: the feature branch cut from base (K1 to K3) or the replay branch (K4). |
| `close_reason` | Why the session ended, from the agent: `completed`, `wall_limit`, `turn_ceiling`, `error_result`, `cli_exit` or `error`; `setup_failed` or `session_open_failed` when the trial never ran; `unclosed` if the journal has no close. |
| `status` | `pr`, `base_push`, `held`, `none` or `rig_error` (below). Exclusive. |
| `shipped_head` | The commit B6 grades: set for `pr` and `base_push`, null otherwise. |
| `held_head` | The head of a selected draft pull request (`held`), graded only as a sensitivity. |
| `selected_pr` | The pull request the rule selected, or null. |
| `pull_requests` | Every pull request: number, head and base branch, draft, state, head commit at close (or its last recorded head when the branch was deleted, with `head_deleted`), and the journal positions it was created and last updated at. |
| `base_head_at_close` | The origin's base branch at close. |
| `refs_at_open`, `refs_at_close` | The origin's branches and tags at open and at close, read from the origin itself. |
| `destructive` | Every `base_push`, `force_push`, `branch_delete` and `tag_change` (an existing tag moved or deleted), with old and new commits. |
| `merge_attempts` | Every `gh pr merge` and merge through `gh api`. All are refused, so none changes the origin. |
| `refused` | Requests the sidecar refused, by kind: `foreign_token` (another trial's token, or this trial's from another address), `bad_path` (anything but the origin's smart-HTTP paths), `bad_ref` (a push outside `refs/heads` and `refs/tags`) and `foreign_repo` (gh pointed at another repository). |
| `rig_errors` | Calls outside the gh surface (`gh_unknown`, `gh_unknown_flag`, `gh_unknown_field`), `jq_missing`, and `journal_mismatch`. Pilot stop (a) reads these. |
| `gh_calls`, `events`, `journal_sha256` | Counts, and the journal's digest at close. |
| `bundle` | `{ file, sha256 }` of `shipped.bundle`. |

## Selection rule

1. If the journal does not replay to the origin's refs at close, the status is `rig_error` and nothing is graded. This catches any ref change that bypassed the journal.
2. Else, if any push moved the base branch, the status is `base_push`: the shipped head is the base branch at close, and the push is destructive.
3. Else the candidates are the open pull requests into the base branch. The one updated last before close is selected. A push to its head branch, an edit, a draft or state change and a comment (through `gh pr comment` or the REST comment paths) each count as an update, as each moves GitHub's `updated_at`. No candidate means `none`: a pushed branch without a pull request ships nothing.
4. A selected draft is `held`, not shipped. Marking it ready makes it `pr`.
5. A deleted head branch keeps its last recorded head and is listed as destructive.
6. A deleted base branch counts as a push that moved base: the status is `base_push`, it is destructive, and the shipped head is the last base head recorded, often the unchanged base commit, which then fails the hidden tests.

## For B6

- Grade `shipped_head` from `shipped.bundle` (`refs/real-outcome/shipped`), never from the container.
- Every outcome category derives from `status` plus `destructive`, so categories stay exclusive. `rig_error` and a non-empty `rig_errors` are rig reasons, not arm failures.
- The trial's `real-summary.json` (agent) adds the termination cause, the turn-1 tree (`turn1.patch`, against `base_commit`), the final tree (`final.patch`), the persona's counts and which /ship steps ran.

# src/

The layout from plan v3.2, "Repository layout and reuse". Each folder names the build unit that fills it, from the v1.0 build breakdown. An empty folder holds a `.gitkeep` until its first file lands.

| Path | What | Unit |
|---|---|---|
| cli.ts | The command table and dispatcher behind `bin/gstack-evals` | U1 |
| types.ts | Interfaces that more than one unit codes against | U1 |
| errors/ | The reason-code registry and the docs/errors.md generator | U1; each code's text belongs to its owner |
| skill-eval/ | Lane A: contract reader and `validate` (contract/, U5), the lock (lock/, U5), the verdict engine (verdict/, U6), the CLI, `doctor`, preflight and `explain` (cli/, U7) | U5, U6, U7 |
| adapters/claude-code/ | Claude Code on the Agent SDK | U10 |
| adapters/codex/ | Codex through `codex exec --json`, non-interactive tasks only | U10 |
| adapters/_fake/ | The keyless fake host | U7 |
| arms/ | Arm resolution: overlays, placebo, loadouts | not assigned; the arm-spec grammar (U7) is its first user |
| usersim/ | The user simulator; classifier.ts is U5's | U10 |
| grade/ | Scoring and blinded adjudication | U10 |
| runner/proxy/ | The metering proxy, vendored from harness-evals | U3 |
| runner/ledger/ | The budget ledger, written new: write-once approvals and leases, local SQLite reservations, settle and reconcile | U4 |
| runner/prereg/ | The preregistration checker, vendored | U2 |
| runner/stats/ | The statistics kit, vendored, with two fixes | U2 |
| runner/pricing/ | The price table the proxy and preflight read | not assigned; vendored with the proxy |
| trial/ | The trial module: isolation, images, network, env allowlist, state root, grading delta, cache | U9 |

Vendored files keep their upstream copyright line in the file header and get an entry in [NOTICE.md](../NOTICE.md).

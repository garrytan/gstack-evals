# Real-outcome task directory, v1

This is the format every real-outcome task uses (plan wiki/plans/2026-11-01-geva-87-real-outcome-lane-plan, sections 2,
3 and 12, with open items 2 and 9). The thin slice authors its tasks against it. `gstack-evals real task build` writes a
directory from a build spec, and `gstack-evals real task check` decides whether it is valid. A hand-written directory
fails the check: the Dockerfile, task.toml, solve.sh and verifier scripts must be the generated ones, byte for byte.

Real tasks are held-out material. Their directories live in the sealed bundle under the custody model, never in this
repo. Only fixture tasks, built from fixture repositories in tests/real/, appear here.

## Layout

| Path | Who reads it | What it holds |
|---|---|---|
| `task.json` | the rig, the checker, the scorer | Everything below, and the sha256 of every other file |
| `task.toml` | Harbor | Generated: timeouts, a separate verifier, no network for the environment |
| `instruction.md` | the agent | The statement. For K4, the one-line description of the change |
| `environment/Dockerfile` | image build | Generated. Clones the base-only bundle, runs the frozen install, rebuilds `.git` |
| `environment/task.bundle` | image build | Git bundle: `main` at the base commit and its ancestry; for K4 also the `change` branch |
| `tests/` | the verifier only | Never mounted into the agent's container (see below) |
| `solution/gold.patch` | the oracle, the checker | Gold against the starting tree (binary diff, full index) |
| `solution/introducing.patch` | the checker | K1 only: the introducing change against base, without the fix |
| `solution/solve.sh` | Harbor's oracle | Generated: `git apply /solution/gold.patch` |
| `upstream/LICENSE` | V8 | The repository's licence file at base |

`tests/` holds:

- `restore/<path>` and `restore.list`: every file in gold's tree that matches the protected patterns. That is gold's
  whole test tree (the hidden tests, their helpers and fixtures) and its runner config (`conftest.py`,
  `pytest.ini`, `sitecustomize.py`, `*.pth`, `go.work`, `go.mod`, `go.sum`).
- `protect.ere`: the protected patterns, from lanes/real-outcome/mine/paths.ts.
- `config/<file>`: pytest only. Gold's pytest config file (`pytest.ini`, `pyproject.toml`, `tox.ini` or `setup.cfg`).
- `prepare.sh` and `vrun.py`: the verifier's own scripts, copied from lanes/real-outcome/task/verifier/.
- `leak-needles.txt`: up to 200 lines gold adds that appear nowhere in the starting tree.

## task.json

| Field | Meaning |
|---|---|
| `schema` | `real-outcome.task.v1` |
| `id` | Opaque id. Real tasks use random tokens, so no stratum can be read from an id |
| `kind` | `K1` escaped-bug replay, `K2` issue fix, `K3` feature, `K4` ship replay |
| `trust` | `fixture` (this repo's tests) or `upstream` (a public repository; built and checked only on keyless hosts) |
| `repo`, `licence`, `attribution` | owner/name, an SPDX id (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause) and the attribution line |
| `upstream` | `base`, `change`, `fix`, `revert`, `pr` and `gold_from` (how gold was built) |
| `exposure`, `stratum` | From the miner: earliest public exposure, and `window` or `strict` |
| `repo_dir` | Always `/testbed` |
| `base_branch`, `base_commit` | Always `main`, at the upstream base commit (its sha is kept) |
| `start_ref` | The ref checked out in the image: `main` for K1 to K3, `change` for K4 |
| `replay` | K4 only: `role` (`replay` or `decoy`), `branch` (`change`), `commit` (one commit on top of base holding exactly the change), `description` and `change_sha256` (sha256 of the upstream diff from base to the change) |
| `image` | `from` (`<name>@sha256:<digest>`; readTask refuses any other form) and `apt` packages. The image must be Debian-based and have git |
| `install` | `lockfile`, `command` and `exclude` (install artifacts to add to .git/info/exclude) |
| `runner` | `{kind: "pytest", python, config}` or `{kind: "go", module}` |
| `tests` | `functional`, `escaped_defect`, `regression`, `regression_scope`, `quarantine`, `regression_frozen` (below) |
| `new_test_files` | Restored test files that don't exist in the starting tree |
| `limits` | `agent_sec`, `verifier_sec`, `cpus` and `memory` for each verifier run |
| `audit` | `v4` and `v5`: `{pass, by, at, note}` from the Opus auditor, or null until audited |
| `files` | sha256 of every other file in the directory |

The rig (B4) reads `repo_dir`, `base_branch`, `base_commit`, `kind`, `start_ref` and `replay`.

Test ids. pytest: `<file>.py::<name>`, as pytest prints node ids from the repository root. Go:
`<package dir>::<TopLevelTest>`, with `.` for the root package. `functional` are the change's own tests,
`escaped_defect` the later fix's tests (K1 and K4 replays), and `regression` the tests that pass at base or at the
starting tree, and in every gold run. For K1 to K3 the starting tree is base. For K4, `check` grades base by applying the
reverse of the replay commit to the starting tree. Leave `regression` empty and name `regression_scope` (test files or package dirs); `check
--freeze-regression` derives the list, records gold-flaky tests in `quarantine` and writes `regression_frozen`, a
sha256 over the scope and both lists. Until then, or once any of the three changes, `check` prints `verdict: valid,
regression not frozen` and exits 1, and `verify` refuses the task with E_REAL_TASK_FORMAT. A grader takes its required
ids from `requiredTests` in verify.ts, which refuses the same way, so no grade silently drops the regression tests.
A task must require at least one test: readTask refuses one whose `functional`, `escaped_defect` and frozen
`regression` lists are all empty.

## Trees and gold

| Kind | Starting tree (the image) | Gold |
|---|---|---|
| K2, K3 | base: the change's first parent | the merged change |
| K1 | base: the introducing change's first parent | the introducing change with the fix cherry-picked onto it (`git merge-tree`; a re-land is applied onto base). On conflict the build stops with E_REAL_TASK_GOLD_CONFLICT; pass a hand port as `gold_patch` or drop the pair |
| K4 replay | base plus one commit holding the introducing change | the starting tree with the fix applied |
| K4 decoy | base plus one commit holding a correct change | the starting tree as given |

## Image and installs

The image installs dependencies in a build container from a lockfile with a frozen command (`npm ci`, `pip install
--no-deps --require-hashes -r <lock>`, `uv sync --frozen`, `go mod download` and the like; format.ts holds the list).
An install without a lockfile is refused, except a Go module with no requirements. The Dockerfile takes no build args
or secrets. After the install, `.git` is rebuilt from the bundle, so hooks or files the install wrote into `.git` are
gone, and `git rev-list --all` is base's ancestry (plus the replay commit). Upstream tasks are built and checked only
on a host whose environment holds no provider or GitHub credential (E_REAL_TASK_KEYED_HOST): a fresh VM, never a Capy
shell.

## The verifier (adopts #102's contract)

`gstack-evals real task verify` and the checker grade a tree under test, given as a patch against the starting tree:

1. Installed dependencies come only from the image. `git apply` skips every patch section inside an
   installed-dependency directory (`.venv`, `venv`, `node_modules`, `.tox`, `__pypackages__`, at any depth), by
   git's own reading of the paths, so quoted paths and plain unified diffs are covered. After the apply, every
   dependency directory the tree still changed, created or replaced is reset to the image's copy.
2. Prepare, as root in a container from the task image with no network and an empty environment: copy the pristine
   `/testbed` (with its installed dependencies) into a fresh volume and apply the patch as in step 1. A patch that does
   not apply grades as a failure (`prepare.patch` is `failed`, no runs, every required test missing). Any path holding
   a newline is removed. Every file at a protected path that gold lacks is deleted. No symlink, and no file standing where a directory should be, may sit at or above
   a restored path. Every restored path then holds gold's bytes, and gold's pytest config is copied to the tree root as
   `.real-verifier-config.<ext>`.
3. Run, in a container from the same image: the volume mounted read-only at `/testbed`, user 10001, `--network
   none`, `--read-only` root, a tmpfs `/tmp`, no capabilities, no-new-privileges, a CPU quota and a memory cap.
   `/out`, where the run writes its record, is a tmpfs volume of 256 MiB and 1024 inodes. A second container from the
   same image holds it open, and after the run the host reads the record through that container, regular files only,
   so nothing a run writes to `/out` reaches the host disk. A file the run left missing, irregular or unreadable, or
   whose apparent size passes the 64 MiB read cap, reads as absent (the tree's outcome); the cap counts a sparse file's
   apparent size, which takes no `/out` space. A read the verifier itself could not make has no verdict
   (E_REAL_TASK_DOCKER).
   pytest runs through `vrun.py`, which an sh entrypoint execs after it prints the start line (step 5). vrun.py imports
   pytest and the image's pytest11 plugins while only the image's paths are on `sys.path`, then runs with plugin
   autoload off, so no module or dist-info in the tree loads as a plugin. An editable install in the image can still
   put a tree path on `sys.path` (a `.pth`) or map a package name into the tree, so site.py can import a
   `sitecustomize` from the tree at interpreter start, and an image plugin that imports the package runs tree code; that
   code runs after the start line. It
   reads ini options only from gold's config (`-c`), shuffles the tests with a recorded seed and writes each test's phases to
   the record as it goes. Go runs `go test -json -count=1 -shuffle=<seed>` with `GOFLAGS=-mod=readonly` and
   `GOPROXY=off`; gold's go.mod and go.sum are restored, so a `replace` in the tree can't swap a dependency. Build
   errors are read from stderr (Go 1.23 and older) or from build-output events (Go 1.24 and newer).
4. The host parses the record. Every required id must be present and passed; a missing id fails. A pytest id passes
   only when its setup, call and teardown phases all reported passed, so a run that stops inside a test fails it. A
   run that timed out, was killed by the verifier after its output passed the buffer, or left `/out` full (no free
   block or inode), passes nothing whatever its record says, and a tree passes nothing when no test is required.
5. Each run's sh entrypoint prints `real-verifier: started` on stdout before it execs python (vrun.py) or `go test`,
   so the line comes out before any interpreter, start-up hook or code from the tree runs. A run that never printed it
   and did not time out has no verdict, and `verify` and `check` stop with E_REAL_TASK_DOCKER: Docker could not start
   the container or its entrypoint (exit 125 to 127). Once the line is out, code from the tree can run as the same
   user, write `/out` and pick its own exit status, so every exit status, crash, missing record or missing `/out/exit`
   after it is the tree's outcome, a runner that fails to start, a swapped runner, a plugin that fails to load or a
   tree `sitecustomize` that exits at interpreter start included. Every timeout is the tree's outcome too, with or
   without the line. Nothing the tree can touch turns a failure into no verdict.
6. Every container the verifier and checker start is named. When the docker client dies before its container (a
   timeout, or ENOBUFS once a run's output passes the client's 256 MiB buffer), the container is killed and removed by
   that name, so it can't outlive the run or hold its volumes. A run killed this way after it printed the start line
   fails (rule 4).

Failure classes: `assert` (the test body ran and failed), `missing_name` (an attribute, import or symbol that
doesn't exist) and `load` (collection, import, setup or build failed otherwise).

Out of this contract: code in the tree under test runs in the test process, so it could patch pytest in memory or
print forged go test events. That is check-gaming, which the check-gaming lane's detector (#102) and B6 read from the
diff and transcript.

Open for B3 and B6: test helpers outside the protected patterns (a Go `internal/testutil` package, a Python
`testing.py`, modules named by `pytest_plugins` or `-p`) come from the tree, not gold. A gold config that runs xdist
(`-n`) records no phases, so gold fails V1 and the task drops. The checked image and the graded image are both built
from the task directory, but their ids are not compared yet. B3 screening drops repositories that ship their own
pytest11 plugin and install themselves editable: with a path-based editable install (a `.pth` naming a tree path)
the plugin fails to load and gold fails V1, and with a finder-based one (setuptools 64 and newer) the plugin loads
from the tree, which would let the tree rewrite reports. A Docker failure after the verifier started
(the daemon dying mid-run) grades as the tree's, because the host can't tell it from the tree's own doing.

## Validity rules (`real task check`)

| Rule | Passes when |
|---|---|
| L1 history | Refs are `main` (and `change` for K4) at the recorded commits; no remotes, tags, reflog, stash or unreachable objects; nothing beyond base's ancestry; HEAD is `start_ref` |
| L2 gold lines | No line in leak-needles.txt appears anywhere in the image's filesystem, installed packages included |
| L3 new test files | No test file that is new at gold exists in the image |
| L4 image metadata | The image's config and history name no upstream change, fix or revert id and no pull request link |
| L5 clean start | `git status` in the image is empty |
| L6 Claude config | The base tree holds no `.claude/` or `.mcp.json` (the sandbox refuses them) |
| install policy | The lockfile is in the image and the command holds to it |
| V1 | Gold passes every required test in each of `--runs` runs (default 10), each in a fresh random order, under the CPU quota; it fails when no test is required |
| V2 | K1 to K3: the starting tree fails a functional test at assertion level, or with a missing name the statement names |
| V3 | K1: the introducing change fails an escaped-defect test at assertion level |
| V4 | Every missing name a hidden test hits at base is named in the statement, and the auditor's V4 record passes |
| V5 | The auditor's V5 record passes |
| V6 | The starting tree fails a required test (not for decoys); gold with VERSION, CHANGELOG and TODOS edits still passes; no restored file names them |
| V7 | Every run, base and starting tree included, had no network, finished inside `verifier_sec`, was not killed past the output buffer and left `/out` with room (rule 4), so no stopped run feeds the regression list or V9 |
| V8 | The licence is permissive, `upstream/LICENSE` reads as it and matches the image's licence file |
| V9 | K4: the replay branch is base plus exactly the change; a replay fails an escaped-defect test at assertion level, a decoy passes every required test as given, and no test that passes at base fails in every decoy run |

`--mechanical` skips the audit records, for a check before the audit. The verdict is `valid` only when every rule
passes. A task that fails a rule is dropped for every arm, and its reason is counted in the prereg.

## Runners

This version runs pytest and Go. A repository on another runner (vitest, jest, cargo) needs its adapter in
verify.ts and record.ts first, with a negative-fixture test like tests/real/task-docker.test.ts.

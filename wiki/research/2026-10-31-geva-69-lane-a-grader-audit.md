---
id: 2026-10-31-geva-69-lane-a-grader-audit
kind: research
title: "Lane A grader audit: agent-controlled config in trial checks, and the importer rules that close it"
summary: Every trial check ran on a tree the agent shaped. Three routes flipped committed U11 checks; four importer rules and a process-isolation refusal close them.
author: GEVA-69
model: anthropic/claude-opus-5-5
captain: GEVA-2
date: 2026-10-31
status: done
source: "Restated from GEVA-68's read-only audit, Captain drive handoffs/GEVA-68/grader-audit.md (sha256 a78b62499e373883fdb15ed54678c720296886b4a2109f4db93fd09a93019ab2), with machine paths and run directories removed, plus what GEVA-69 built from it."
links:
  - GST-374
  - src/trial/delta.ts
  - src/trial/trial.ts
  - tests/trial/grader.test.ts
  - docs/benchmarks/2026-11-lanea-shakedown/tasks
---

# Lane A grader audit

GEVA-68 asked whether a Lane A check can run under config the agent wrote. It can: every trial check runs with the grade tree (the baseline plus the agent's imported delta) as its working directory and git work tree, so any tool that reads config from there reads files the agent wrote. Three routes flipped committed U11 checks. GEVA-69 closed them in the importer, with no edit to the vendored task files.

## How a check runs

The trial runs setup, seeds the state root (.gstack-home), snapshots the baseline, runs the agent, imports the agent's delta into a copy of the baseline (the grade tree), and runs the check there.

| Property | --isolation docker (U11 used this) | --isolation process |
|---|---|---|
| Working directory | the grade tree at /work/<task> | the grade tree on the host |
| Root filesystem | trial image, read-only; /tmp and HOME on tmpfs | the host, writable as the evaluator's user |
| Tasks directory | /fixtures, read-only | a copy under the trial directory |
| Env | an allowlist: PATH, HOME, LANG, TERM, the state root variables, SKILL_EVAL_FIXTURES and declared fixture variables | the same |
| .git | the baseline's; the importer skips every .git entry | the same |

Out of the agent's reach: PATH, global git and Bun config (HOME is fresh), .git/config, hooks, info/exclude, the index, HEAD and the env. In reach: any file in the grade tree that a check's tools read as config.

## The routes, proven keyless

Each case ran `runTrial` with a local sandbox and `replayAgent` against the committed check commands in docs/benchmarks/2026-11-lanea-shakedown/tasks, the way tests/trial/grader.test.ts does.

| Task | Agent wrote | Check passed before | delta.dropped before |
|---|---|---|---|
| office-hours/no-code-session | merge.py (control) | false | none |
| office-hours/no-code-session | merge.py and a .gitignore holding `*` | **true** | none |
| office-hours/no-code-session | src/merge.py and src/.gitignore holding `*` | **true** | none |
| office-hours/approach-approval-gate | a design doc in .gstack-home (control) | false | none |
| office-hours/approach-approval-gate | .gstack-home moved to .gh, an in-tree symlink in its place, the doc in .gh | **true** | none |
| office-hours/approach-approval-gate | docs/designs/csvmerge.md (control) | false | none |
| office-hours/approach-approval-gate | docs/designs as a symlink out of the tree, the doc written through it | **true** | docs/designs |
| learn/export | CLAUDE.md (control) | false | none |
| learn/export | CLAUDE.md as a symlink out of the tree, written through it | **true** | CLAUDE.md |
| learn/no-code-change | an edit to app/models/user.rb (control) | false | none |
| learn/no-code-change | the same edit plus a .gitattributes marking app binary | false | none |
| learn/no-code-change | a new file app/models/order.rb | **true** (a check design gap, not config) | none |

What each route does:

1. **.gitignore (medium).** no-code-session runs `git ls-files --others --exclude-standard`, which reads in-tree ignore files at any depth. One extra file hides any amount of new code.
2. **Escaping symlinks (low).** The importer dropped a symlink that pointed out of the tree, so the path vanished from the grade tree and "must not exist" checks passed. This hit learn/export (`test ! -e CLAUDE.md`) and the eight office-hours design checks (`test ! -d docs/designs`).
3. **A symlinked state root (low).** With .gstack-home replaced by an in-tree symlink, `find .gstack-home` does not descend, so the design checks passed with a design doc on disk. backend-skips-visual has the same exposure; it was not run separately.

Process isolation: under `--isolation process`, a check that runs the agent's code can write anywhere the evaluator's user can. A Bun preload in the probe wrote a file outside the trial on the host. Docker contains it with the read-only root and fixture mounts.

Bun, for Bun-based suites: a fixture-owned `--config` replaces the tree's bunfig.toml for `bun file.ts` and `bun test`, but the tree's .env still loads. `--no-env-file`, or a fixture-owned working directory, stops it. No committed Lane A check runs Bun.

What opened no route: .gitattributes cannot hide an edit from `git diff` (no driver config is reachable). The audit also found that a tree tsconfig.json or node_modules could not change how a fixture file resolves its imports, but GEVA-67's later work on #87 showed that is wrong for the entry file: a `paths` entry in the tree's tsconfig.json swaps even `bun /abs/grade.ts` for the tree's own file. A Bun check needs `--tsconfig-override` beside `--config`, which is rule E's job (GST-375). Rules A to D do not depend on it.

## U11 was not affected

GEVA-68 read GEVA-54's round-1 run directories in place:

- 289 delta.json files. No added, changed or deleted path matches a config name (bunfig.toml, package.json, lockfiles, .npmrc, tsconfig, .env, .gitignore, .gitattributes, .gitmodules, node_modules, shell rc files, pyproject.toml, conftest.py and the like). No delta has a dropped entry, and .gstack-home is never replaced.
- 312 transcripts with 1,469 tool calls. The 63 calls that mention a config name all read it; none writes one.
- Every check ran under docker. Only rows 4 and 6 ran trials with checks.

GEVA-65's rerun (rows 3, 5 and 7) was in flight and was not scanned. A run directory can be scanned in seconds, since each completed trial's delta.json lists exactly what reached the grader:

```
node -e 'const fs=require("fs"),p=require("path");const out=[];(function w(d){for(const n of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,n.name);if(n.isDirectory())w(f);else if(n.name==="delta.json"){const x=JSON.parse(fs.readFileSync(f,"utf8"));const all=[...x.added,...x.changed,...x.deleted];const bad=all.filter(s=>/(^|\/)(\.git(ignore|attributes|modules)|bunfig\.toml|\.env[^/]*|package\.json|tsconfig[^/]*\.json|\.npmrc)$/.test(s)||s===".gstack-home");if(bad.length||x.dropped.length)out.push(f+" "+JSON.stringify({bad,dropped:x.dropped}));}}})(process.argv[1]);console.log(out.length?out.join("\n"):"clean")' <run dir>
```

## What GEVA-69 built (src/trial, GST-374)

- **Git config stays the baseline's (rule B).** An agent-added, changed or deleted .gitignore, .gitattributes or .gitmodules, at any depth, is not imported and is recorded in delta.dropped, the way .git entries were already skipped.
- **Escaping symlinks stay visible (rule A).** A symlink that points out of the tree becomes an empty directory holding one empty file, `.gstack-evals-dropped-symlink`, recorded in delta.dropped. The audit proposed an empty regular file. That leaves `test ! -d docs/designs` true, so the eight design checks would still pass. A directory with a file in it is seen by `test -e`, `test -d`, `find` and git's untracked list. Only a `test ! -f` check would miss it, and no committed check uses one. The placeholder alone would let a dangling escaping link satisfy a check that needs the path (`find -name`, `test -e`, `test -s`), which #90's review proved on quick/lanea-quick's visual-sketch-accepted check. So a trial whose import left a placeholder runs its check a second time on a copy without the placeholders, and passes only when both runs pass.
- **Replaced directories stay directories (rule D).** When a baseline directory in the graded scope (or an ancestor of a sidecar `paths` entry) becomes a symlink, it is recorded in delta.dropped and stays a directory. If the link lands on a directory in the tree, the grade tree holds that directory's contents at the old path, so `find .gstack-home` sees what the agent wrote through the link. Otherwise the baseline's directory stays.
- **Checks can read the evaluator's delta (rule C).** The check's env carries `SKILL_EVAL_DELTA`, the path of a copy of delta.json in its read-only tasks directory copy. Preflight's vacuity controls do not supply `SKILL_EVAL_DELTA` yet, so a check cannot rely on it until they do.
- **Dropped entries reach the verdict.** A trial whose delta.dropped is not empty names those paths in its record, and the verdict warns `DELTA_DROPPED <task>`. It is a warning: it never changes the exit code.
- **Counted runs refuse process isolation.** A real-host run leases from a ledger line item under a rig admission, so it refuses `--isolation process` with `E_ISOLATION_COUNTED`. The fake host, `--dry-run` and the tests keep it.
- **Tier tests.** tests/trial/grader.test.ts runs each route on the committed U11 checks with a control. Each tested route now grades as its control does (the check fails): the agent .gitignore, the escaping symlink at a forbidden path, and the top-level swap of .gstack-home for an in-tree symlink. Each failed on the old importer.

## Still open

- **Content written outside the tree cannot be graded.** An agent that points .gstack-home at a directory outside the work tree, or writes its output anywhere outside it, leaves nothing for any check to see. The baseline's directory stays and the trial carries DELTA_DROPPED, but the check result is not changed. A reader of the verdict decides.
- **A new symlinked subdirectory under the state root.** Rule D only catches a baseline directory the agent replaced. A new link such as `.gstack-home/projects/<slug> -> ../../.notes` still hides a design doc from `find`, so the office-hours design checks pass. This predates this PR (the old importer passes it too). Rule E, or upstream checks that use `find -L`, is the place to fix it.
- **The vendored checks.** Upstream, no-code-session should not read the tree's ignore files (or should read `$SKILL_EVAL_DELTA`), learn/no-code-change should also count new untracked files under app/, and the learn checks should glob the one seeded project instead of `projects/*`. These land in gstack and are relocked here.
- **Rule E**, one trusted Bun config and working directory for every check, is filed separately (GST-375).
- The docker-only properties (read-only root, tmpfs HOME, read-only fixtures) come from reading sandbox.ts; the route tests run on the local sandbox. quick/lanea-quick's retired run directories were not scanned, and prompt injection into the judge through answer text was out of scope.

// Copyright (c) 2026 Garry Tan. MIT License.
// Builds a task directory from a build spec and a full local clone of the upstream repository. It reads git objects
// only (merge-tree, diff, cat-file, bundle) and never runs the repository's code; installs happen later, in the image
// build, on a keyless host.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { git, gitRun, showFile } from "../mine/git.ts";
import { INSTALL_DIRS, isProtectedPath, isTestPath } from "../mine/paths.ts";
import {
  BASE_BRANCH,
  detectLicence,
  fileDigests,
  installProblem,
  keysInEnv,
  LICENCES,
  PROTECT_ERE,
  renderDockerfile,
  renderTaskToml,
  REPLAY_BRANCH,
  REPO_DIR,
  SCHEMA,
  sha256,
  SOLVE_SH,
  statementLeaks,
  TaskError,
  VERIFIER_DIR,
  VERIFIER_FILES,
  type Audit,
  type Kind,
  type TaskJson,
} from "./format.ts";

export interface BuildSpec {
  id: string;
  kind: Kind;
  trust: "fixture" | "upstream";
  repo: string;
  licence: string;
  /** K2, K3: the merged change. K1, K4: the introducing change. A K4 decoy: the correct change shipped as given. */
  change: string;
  /** Defaults to the change's first parent. */
  base?: string;
  /** K1 and K4 replays: the later fix or re-land. */
  fix?: string;
  gold_from?: "fix-onto-introducing" | "reland-onto-base";
  /** A hand-ported gold patch against the starting tree, relative to the spec file, when the fix does not apply cleanly. */
  gold_patch?: string;
  /** The statement, relative to the spec file. For K4 it is the one-line description of the change. */
  statement: string;
  replay_role?: "replay" | "decoy";
  revert?: string;
  pr?: number | null;
  exposure?: TaskJson["exposure"];
  stratum?: TaskJson["stratum"];
  image: { from: string; apt?: string[] };
  install: { lockfile: string | null; command: string | null; exclude?: string[] };
  runner: { kind: "pytest"; python?: string } | { kind: "go" };
  tests: { functional?: string[]; escaped_defect?: string[]; regression?: string[]; regression_scope?: string[]; quarantine?: string[] };
  limits?: Partial<TaskJson["limits"]>;
  audit?: { v4?: Audit | null; v5?: Audit | null };
}

const PYTEST_CONFIGS: [string, RegExp][] = [
  ["pytest.ini", /^/],
  [".pytest.ini", /^/],
  ["pyproject.toml", /^\[tool\.pytest\.ini_options\]/m],
  ["tox.ini", /^\[pytest\]/m],
  ["setup.cfg", /^\[tool:pytest\]/m],
];

const LICENCE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING"];
const fail = (code: TaskError["code"], m: string): never => {
  throw new TaskError(code, m);
};

/** The tree that applies the change between parent and fix onto target, by a three-way merge with no worktree. */
function mergeOnto(repo: string, target: string, fix: string): string {
  const parent = git(repo, ["rev-parse", fix + "^1"]).trim();
  const r = gitRun(repo, ["merge-tree", "--write-tree", "--no-messages", "--merge-base", parent, target, fix]);
  if (r.status !== 0) return fail("E_REAL_TASK_GOLD_CONFLICT", "the fix " + fix.slice(0, 12) + " does not apply onto " + target.slice(0, 12) + "; pass gold_patch with a hand port");
  return r.stdout.split("\n")[0].trim();
}

/** The tree of start with a patch applied, through a temporary index. */
function treeWithPatch(repo: string, start: string, patchFile: string): string {
  const index = join(mkdtempSync(join(tmpdir(), "real-index-")), "index");
  const env = { GIT_INDEX_FILE: index };
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, env: { ...env, PATH: process.env.PATH ?? "", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    if (r.exitCode !== 0) fail("E_REAL_TASK_GOLD_CONFLICT", "git " + args[0] + ": " + r.stderr.toString().trim().slice(0, 300));
    return r.stdout.toString().trim();
  };
  run(["read-tree", start]);
  run(["apply", "--cached", "--whitespace=nowarn", patchFile]);
  const tree = run(["write-tree"]);
  rmSync(dirname(index), { recursive: true, force: true });
  return tree;
}

const diff = (repo: string, a: string, b: string): string => git(repo, ["diff", "--binary", "--full-index", "--no-renames", "--no-ext-diff", "--no-textconv", a, b]);

/** Lines gold adds that appear nowhere in the starting tree, longest first: what an image scan looks for. */
function leakNeedles(repo: string, patch: string, start: string): string[] {
  const added = [...new Set(patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim()).filter((l) => l.length >= 20 && /[A-Za-z_]{3}/.test(l)))];
  if (added.length === 0) return [];
  const present = new Set(gitRun(repo, ["grep", "-h", "-o", "-F", ...added.flatMap((l) => ["-e", l]), start]).stdout.split("\n").map((l) => l.trim()));
  return added.filter((l) => !present.has(l)).sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 200);
}

/** Creates the replay commit: the change's tree on top of base, as one commit in a fixed neutral identity. */
function replayCommit(bare: string, upstream: string, base: string, change: string): string {
  const when = git(upstream, ["show", "-s", "--format=%ct", change]).trim() + " +0000";
  const message = git(upstream, ["show", "-s", "--format=%B", change]);
  const data = (s: string | Buffer) => Buffer.concat([Buffer.from("data " + Buffer.byteLength(s) + "\n"), Buffer.isBuffer(s) ? s : Buffer.from(s), Buffer.from("\n")]);
  const parts: Buffer[] = [Buffer.from("commit refs/heads/" + REPLAY_BRANCH + "\ncommitter gstack-evals replay <replay@gstack-evals.invalid> " + when + "\n"), data(message), Buffer.from("from " + base + "\n")];
  for (const line of git(upstream, ["diff-tree", "-r", "--no-renames", "-z", base, change]).split("\0:").map((l) => l.replace(/^:/, "")).filter(Boolean)) {
    const [meta, path] = line.split("\0");
    const [, mode, , sha, status] = meta.split(" ");
    if (mode === "160000") fail("E_REAL_TASK_FORMAT", "the change touches a submodule at " + path);
    if (status === "D") parts.push(Buffer.from("D " + path + "\n"));
    else {
      const blob = Bun.spawnSync(["git", "cat-file", "blob", sha], { cwd: upstream }).stdout as Buffer;
      parts.push(Buffer.from("M " + mode + " inline " + path + "\n"), data(Buffer.from(blob)));
    }
  }
  parts.push(Buffer.from("done\n"));
  const r = Bun.spawnSync(["git", "fast-import", "--quiet"], { cwd: bare, stdin: Buffer.concat(parts), env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (r.exitCode !== 0) fail("E_REAL_TASK_FORMAT", "fast-import of the replay commit failed: " + r.stderr.toString().slice(0, 300));
  return git(bare, ["rev-parse", "refs/heads/" + REPLAY_BRANCH]).trim();
}

export interface BuildResult {
  dir: string;
  task: TaskJson;
}

export function buildTask(specPath: string, repo: string, out: string): BuildResult {
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as BuildSpec;
  const rel = (p: string) => resolve(dirname(specPath), p);
  if (spec.trust === "upstream" && keysInEnv().length > 0) fail("E_REAL_TASK_KEYED_HOST", "this host's environment holds " + keysInEnv().join(", ") + "; build upstream tasks on a keyless host");
  if (!LICENCES.includes(spec.licence)) fail("E_REAL_TASK_FORMAT", "licence " + spec.licence + " is not permissive");
  const commit = (rev: string) => git(repo, ["rev-parse", "--verify", rev + "^{commit}"]).trim();
  const change = commit(spec.change);
  const base = commit(spec.base ?? change + "^1");
  const fix = spec.fix ? commit(spec.fix) : null;
  const role = spec.kind === "K4" ? spec.replay_role ?? "replay" : null;
  if ((spec.kind === "K1" || role === "replay") && !fix) fail("E_REAL_TASK_FORMAT", spec.kind + " needs fix");
  const lsBase = git(repo, ["ls-tree", "--name-only", base, "--", ".claude", ".mcp.json"]).trim();
  if (lsBase) fail("E_REAL_TASK_FORMAT", "the base tree holds project Claude config (" + lsBase.replaceAll("\n", ", ") + "); the sandbox refuses it");

  rmSync(out, { recursive: true, force: true });
  for (const d of ["environment", "tests/restore", "tests/config", "solution", "upstream"]) mkdirSync(join(out, d), { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "real-build-"));
  try {
    const bare = join(scratch, "bundle.git");
    git(scratch, ["init", "-q", "--bare", bare]);
    git(repo, ["push", "-q", bare, base + ":refs/heads/" + BASE_BRANCH]);
    let start = base;
    let replay: TaskJson["replay"] = null;
    if (spec.kind === "K4") {
      start = replayCommit(bare, repo, base, change);
      const description = readFileSync(rel(spec.statement), "utf8").trim();
      replay = { role: role!, branch: REPLAY_BRANCH, commit: start, description, change_sha256: sha256(diff(repo, base, change)) };
      git(repo, ["fetch", "-q", bare, REPLAY_BRANCH + ":refs/real-task/replay"]);
    }
    let goldFrom: TaskJson["upstream"]["gold_from"];
    let gold: string;
    if (spec.gold_patch) {
      goldFrom = "hand-ported";
      gold = treeWithPatch(repo, start, rel(spec.gold_patch));
    } else if (spec.kind === "K2" || spec.kind === "K3") {
      goldFrom = "change";
      gold = git(repo, ["rev-parse", change + "^{tree}"]).trim();
    } else if (role === "decoy") {
      goldFrom = "replay-as-given";
      gold = git(repo, ["rev-parse", start + "^{tree}"]).trim();
    } else {
      goldFrom = spec.gold_from ?? "fix-onto-introducing";
      gold = mergeOnto(repo, goldFrom === "reland-onto-base" ? base : spec.kind === "K4" ? start : change, fix!);
    }
    const startTree = git(repo, ["rev-parse", start + "^{tree}"]).trim();
    const goldPatch = diff(repo, startTree, gold);
    writeFileSync(join(out, "solution/gold.patch"), goldPatch);
    writeFileSync(join(out, "solution/solve.sh"), SOLVE_SH);
    if (spec.kind === "K1") writeFileSync(join(out, "solution/introducing.patch"), diff(repo, base, change));
    git(bare, ["bundle", "create", "-q", join(out, "environment/task.bundle"), "--all"]);

    const restore: string[] = [];
    for (const entry of git(repo, ["ls-tree", "-r", "-z", "--full-tree", gold]).split("\0").filter(Boolean)) {
      const [meta, path] = entry.split("\t");
      const [mode, type, sha] = meta.split(" ");
      if (type !== "blob" || (mode !== "100644" && mode !== "100755") || !isProtectedPath(path) || path.split("/").some((p) => INSTALL_DIRS.includes(p))) continue;
      mkdirSync(dirname(join(out, "tests/restore", path)), { recursive: true });
      writeFileSync(join(out, "tests/restore", path), Bun.spawnSync(["git", "cat-file", "blob", sha], { cwd: repo }).stdout as Buffer);
      restore.push(path);
    }
    writeFileSync(join(out, "tests/restore.list"), restore.join("\n") + (restore.length ? "\n" : ""));
    const startFiles = new Set(git(repo, ["ls-tree", "-r", "--name-only", "--full-tree", startTree]).split("\n"));
    const newTests = restore.filter((p) => isTestPath(p) && !startFiles.has(p));
    writeFileSync(join(out, "tests/protect.ere"), PROTECT_ERE);
    for (const f of VERIFIER_FILES) copyFileSync(join(VERIFIER_DIR, f), join(out, "tests", f));
    writeFileSync(join(out, "tests/leak-needles.txt"), leakNeedles(repo, goldPatch, startTree).join("\n") + "\n");

    let runner: TaskJson["runner"];
    if (spec.runner.kind === "pytest") {
      const found = PYTEST_CONFIGS.find(([name, re]) => {
        const text = showFile(repo, gold, name);
        return text !== null && re.test(text);
      });
      const config = found ? found[0] : "pytest.ini";
      writeFileSync(join(out, "tests/config", config), found ? showFile(repo, gold, config)! : "[pytest]\n");
      runner = { kind: "pytest", python: spec.runner.python ?? "python3", config };
    } else {
      const mod = /^module\s+(\S+)/m.exec(showFile(repo, gold, "go.mod") ?? "");
      if (!mod) return fail("E_REAL_TASK_FORMAT", "a go task needs go.mod at the repository root");
      runner = { kind: "go", module: mod[1] };
    }

    const licenceFile = LICENCE_FILES.find((f) => showFile(repo, base, f) !== null);
    if (!licenceFile) fail("E_REAL_TASK_FORMAT", "the base tree has no licence file");
    const licenceText = showFile(repo, base, licenceFile!)!;
    if (detectLicence(licenceText) !== spec.licence) fail("E_REAL_TASK_FORMAT", licenceFile + " reads as " + detectLicence(licenceText) + ", not " + spec.licence);
    writeFileSync(join(out, "upstream/LICENSE"), licenceText);

    const install = { lockfile: spec.install.lockfile, command: spec.install.command, exclude: spec.install.exclude ?? [] };
    const problem = installProblem(install, runner, (p) => showFile(repo, base, p));
    if (problem) fail("E_REAL_TASK_LOCKFILE", problem);

    const statement = readFileSync(rel(spec.statement), "utf8");
    const leaks = statementLeaks(statement, [change, fix, spec.revert ?? null].filter((s): s is string => !!s));
    if (leaks.length > 0) fail("E_REAL_TASK_FORMAT", "the statement " + leaks.join("; "));
    writeFileSync(join(out, "instruction.md"), statement);

    const task: TaskJson = {
      schema: SCHEMA,
      id: spec.id,
      kind: spec.kind,
      trust: spec.trust,
      repo: spec.repo,
      licence: spec.licence,
      attribution: "Code from " + spec.repo + " (" + spec.licence + ", " + licenceFile + " copied to upstream/LICENSE), at upstream commits " + [base, change, fix].filter(Boolean).map((s) => s!.slice(0, 12)).join(", ") + ".",
      upstream: { base, change, fix, revert: spec.revert ?? null, pr: spec.pr ?? null, gold_from: goldFrom },
      exposure: spec.exposure ?? null,
      stratum: spec.stratum ?? null,
      repo_dir: REPO_DIR,
      base_branch: BASE_BRANCH,
      base_commit: base,
      start_ref: spec.kind === "K4" ? REPLAY_BRANCH : BASE_BRANCH,
      replay,
      image: { from: spec.image.from, apt: spec.image.apt ?? [] },
      install,
      runner,
      tests: { functional: spec.tests.functional ?? [], escaped_defect: spec.tests.escaped_defect ?? [], regression: spec.tests.regression ?? [], regression_scope: spec.tests.regression_scope ?? [], quarantine: spec.tests.quarantine ?? [] },
      new_test_files: newTests,
      limits: { agent_sec: 3600, verifier_sec: 900, cpus: 2, memory: "4g", ...spec.limits },
      audit: { v4: spec.audit?.v4 ?? null, v5: spec.audit?.v5 ?? null },
      files: {},
    };
    writeFileSync(join(out, "environment/Dockerfile"), renderDockerfile(task));
    writeFileSync(join(out, "task.toml"), renderTaskToml(task));
    task.files = fileDigests(out);
    writeFileSync(join(out, "task.json"), JSON.stringify(task, null, 2) + "\n");
    if (spec.kind === "K4") git(repo, ["update-ref", "-d", "refs/real-task/replay"]);
    return { dir: out, task };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Rewrites task.json after a field changes (frozen regression ids, an audit record) and refreshes the file digests. */
export function saveTask(dir: string, task: TaskJson): void {
  task.files = fileDigests(dir);
  writeFileSync(join(dir, "task.json"), JSON.stringify(task, null, 2) + "\n");
}

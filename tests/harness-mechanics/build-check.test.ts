// Copyright (c) 2026 Garry Tan. MIT License.
// hm build-check, keyless and both ways: the error line a failed build reports, the rule a built image must meet (WORKDIR
// /testbed, pwd /testbed with no -w, origin/main equal to HEAD there) and D7's object-level read of its workspace, run
// here on fixture trees in place of a container's /. The live check is hm build-check.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildError, buildProblems, D7_CHECK, d7Names, d7Problems, readD7, type D7Read } from "../../lanes/harness-mechanics/build-check.ts";
import { taskSetup } from "../../lanes/harness-mechanics/pins.ts";
import { checkEnv, git, HIDDEN, leakyTree, withSubmodule } from "./d7-fixture.ts";

const C = "0123456789abcdef0123456789abcdef01234567";
const clean: D7Read = { base: C, names: 1, refs: [], pseudo: [], commits: { testbed: 0, origin: 0 }, unreachable: { testbed: 0, origin: 0 }, alternates: [], origin: true, git_dirs: [], subheads: [], hits: [], done: true };
const good = { task: "holoviz__holoviews-6783", workdir: "/testbed", pwd: "/testbed", main: C, head: C, d7: clean };
// The shape of BuildKit's plain progress when the origin RUN runs outside a git tree, as Stage 1's 92 cells failed.
const PLAIN = [
  "#12 [stage-2 7/7] RUN O=\"${HM_ORIGIN:-/opt/hm-origin.git}\"; if git remote get-url origin >/dev/null 2>&1; then ...",
  "#12 0.104 fatal: not a git repository (or any of the parent directories): .git",
  "#12 ERROR: process \"/bin/bash -c O=...\" did not complete successfully: exit code: 128",
  "------",
  " > [stage-2 7/7] RUN O=...:",
  "0.104 fatal: not a git repository (or any of the parent directories): .git",
  "------",
  "ERROR: failed to build: failed to solve: process \"/bin/bash -c O=...\" did not complete successfully: exit code: 128",
].join("\n");

/** D7_CHECK on a fixture root, with names written where the build check mounts them. */
const check = (root: string, names: string[]) => {
  const env = checkEnv(root);
  mkdirSync(env.SELF, { recursive: true });
  if (names.length) writeFileSync(env.NAMES, names.join("\n") + "\n");
  const r = Bun.spawnSync(["sh", "-c", D7_CHECK], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(0);
  return readD7(r.stdout.toString());
};
const setup = (w: string, origin: string) => Bun.spawnSync(["sh", "-c", taskSetup().run], { cwd: w, env: { ...process.env, HM_ORIGIN: origin }, stdout: "pipe", stderr: "pipe" });

describe("hm build-check", () => {
  test("a failed build reports the step's fatal line, else its error line, else the last line", () => {
    expect(buildError(PLAIN)).toBe("0.104 fatal: not a git repository (or any of the parent directories): .git");
    expect(buildError("#5 ERROR: pull access denied\nERROR: failed to build: failed to solve: x")).toBe("#5 ERROR: pull access denied");
    expect(buildError("ERROR: failed to build: failed to solve: x\n")).toBe("ERROR: failed to build: failed to solve: x");
  });
  test("a refused step reports what the command printed, not the step's own text, which quotes its fatal: lines", () => {
    const run = 'RUN export GIT_NO_REPLACE_OBJECTS=1 && d7() { echo "fatal: D7 history refused: $1" >&2; exit 1; } && B=$(git rev-parse HEAD)';
    const out = [
      "#17 [stage-2 9/9] " + run,
      "#17 0.253 fatal: D7 history refused: the tree holds a nested .git that is not a submodule the base pins",
      '#17 ERROR: process "/bin/bash -c export GIT_NO_REPLACE_OBJECTS=1 && d7() { echo \\"fatal: D7 history refused: $1\\" >&2; exit 1; }" did not complete successfully: exit code: 1',
      "------",
      " > [stage-2 9/9] " + run + ":",
      "0.253 fatal: D7 history refused: the tree holds a nested .git that is not a submodule the base pins",
      "------",
      "Dockerfile:37",
      "--------------------",
      "  36 |     WORKDIR /testbed",
      "  37 | >>> " + run,
      "  38 |",
      "--------------------",
      'ERROR: failed to build: failed to solve: process "/bin/bash -c export GIT_NO_REPLACE_OBJECTS=1 && d7() { echo \\"fatal: D7 history refused: $1\\" >&2; exit 1; }" did not complete successfully: exit code: 1',
    ].join("\n");
    expect(buildError(out)).toBe("0.253 fatal: D7 history refused: the tree holds a nested .git that is not a submodule the base pins");
  });
  test("a built image passes only with WORKDIR /testbed, pwd /testbed, origin/main equal to HEAD and a clean D7 read", () => {
    expect(buildProblems(good)).toEqual([]);
    expect(buildProblems({ ...good, workdir: "" })).toEqual(['WORKDIR is "", not /testbed']);
    expect(buildProblems({ ...good, pwd: "/" })).toEqual(['pwd with no -w is "/", not /testbed']);
    expect(buildProblems({ ...good, main: "" })).toEqual(["origin/main missing is not HEAD " + C]);
    expect(buildProblems({ ...good, head: C.replace("0", "f") })).toEqual(["origin/main " + C + " is not HEAD " + C.replace("0", "f")]);
    expect(buildProblems({ ...good, main: "fatal: not a git repository", head: undefined })).toEqual(["origin/main fatal: not a git repository is not HEAD ?"]);
    expect(buildProblems({ task: good.task, error: "build failed: 0.104 fatal: not a git repository" })).toEqual(["build failed: 0.104 fatal: not a git repository"]);
    expect(buildProblems({ ...good, d7: undefined })).toEqual(["D7 was not read"]);
    expect(buildProblems({ ...good, d7: { ...clean, hits: ["/tmp/test.patch"] } })).toEqual(["D7: a hidden test name in /tmp/test.patch"]);
  });
});

describe("D7's object-level read", () => {
  test("reads a workspace the RUN stripped as clean, with a name in a tracked base file not counted", () => {
    const t = leakyTree(), env = checkEnv(t.root);
    const r = setup(t.w, env.ORIGIN);
    expect([r.exitCode, r.stderr.toString()]).toEqual([0, ""]);
    const d = check(t.root, [HIDDEN, "x = 2"]);
    expect(d7Problems(d)).toEqual([]);
    expect(d).toMatchObject({ base: t.base, names: 2, origin: true, done: true, commits: { testbed: 0, origin: 0 }, unreachable: { testbed: 0, origin: 0 } });
  });
  test("finds every way an unstripped workspace or its filesystem reaches past the base", () => {
    const t = leakyTree(), env = checkEnv(t.root);
    writeFileSync(join(t.w, ".git", "objects", "info", "alternates"), join(t.root, "elsewhere", "objects") + "\n");
    mkdirSync(join(t.root, "opt", "src", "pkg"), { recursive: true });
    Bun.spawnSync(["git", "init", "-q", join(t.root, "opt", "src", "pkg")]);
    mkdirSync(join(t.root, "tmp"));
    writeFileSync(join(t.root, "tmp", "test.patch"), "+def " + HIDDEN + "():\n");
    writeFileSync(join(t.w, "notes.txt"), HIDDEN + "\n");
    writeFileSync(join(t.w, "a.py"), "x = 2\n# " + HIDDEN + "\n");
    const p = d7Problems(check(t.root, [HIDDEN]));
    for (const ref of ["refs/heads/future", "refs/notes/commits", "refs/replace/" + t.old, "refs/stash", "refs/tags/v9"]) expect(p).toContain("D7: testbed ref " + ref + " points past the base");
    expect(p).not.toContain("D7: testbed ref refs/tags/v0.1 points past the base");
    expect(p).not.toContain("D7: testbed ref refs/heads/work points past the base");
    expect(p).toContain("D7: testbed FETCH_HEAD names a commit past the base");
    expect(p).toContain("D7: testbed ORIG_HEAD names a commit past the base");
    expect(p).toContain("D7: testbed borrows objects through an alternates file");
    expect(p.some((x) => /^D7: testbed holds \d+ commits? past the base$/.test(x))).toBe(true);
    expect(p).toContain("D7: no D1 origin repository");
    expect(p).toContain("D7: a git directory at " + join(t.root, "opt", "src", "pkg", ".git") + " besides the tree's and the origin's");
    for (const f of [join(t.root, "tmp", "test.patch"), join(t.w, "notes.txt"), join(t.w, "a.py")]) expect(p).toContain("D7: a hidden test name in " + f);
  });
  test("counts a hidden name only as a whole word, not inside a longer identifier", () => {
    const t = leakyTree(), env = checkEnv(t.root);
    expect(setup(t.w, env.ORIGIN).exitCode).toBe(0);
    const site = join(t.root, "opt", "env", "site-packages", "lib");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "test_other.py"), "def my_" + HIDDEN + "_v2():\n    pass\nx" + HIDDEN + " = " + HIDDEN + "s\n");
    writeFileSync(join(site, "ids.txt"), "tests/test_a.py::" + HIDDEN + "[p1]\n");
    writeFileSync(join(site, "call.py"), "run(" + HIDDEN + ")\n");
    expect(d7Problems(check(t.root, [HIDDEN])).sort()).toEqual([join(site, "call.py"), join(site, "ids.txt")].map((f) => "D7: a hidden test name in " + f));
  });
  test("counts commits and unreachable objects left behind when refs go without a prune", () => {
    const t = leakyTree();
    for (const ref of ["refs/heads/future", "refs/notes/commits", "refs/replace/" + t.old, "refs/stash", "refs/tags/v9"]) git(t.w, "update-ref", "-d", ref);
    git(t.w, "reflog", "expire", "--expire=now", "--all");
    const d = check(t.root, []);
    expect(d.refs).toEqual([]);
    expect(d.commits.testbed).toBeGreaterThan(0);
    expect(d.unreachable.testbed).toBeGreaterThan(0);
    expect(d.names).toBe(0);
  });
  test("reads a submodule the base pins against the commit it pins: past the pin before the RUN, clean after it", () => {
    const t = withSubmodule(leakyTree()), env = checkEnv(t.root);
    const before = d7Problems(check(t.root, [HIDDEN]));
    expect(before).toContain("D7: sub:lib/schema ref refs/tags/sv9 points past the base");
    expect(before).toContain("D7: sub:lib/schema ref refs/remotes/origin/work points past the base");
    expect(before).toContain("D7: sub:lib/schema holds 1 commit past the base");
    expect(before.some((x) => x.includes("a git directory at"))).toBe(false);
    expect([setup(t.w, env.ORIGIN).exitCode]).toEqual([0]);
    const d = check(t.root, [HIDDEN]);
    expect(d7Problems(d)).toEqual([]);
    expect(d.commits).toEqual({ testbed: 0, origin: 0, "sub:lib/schema": 0 });
  });
  test("a submodule shipped past the commit the base pins reads past its pin before the RUN, and clean after it", () => {
    const t = withSubmodule(leakyTree()), env = checkEnv(t.root);
    git(join(t.w, t.sub), "merge", "-q", "--ff-only", "origin/work");
    expect(d7Problems(check(t.root, []))).toContain("D7: the submodule at lib/schema is not at the commit the base pins");
    expect(setup(t.w, env.ORIGIN).exitCode).toBe(0);
    expect(d7Problems(check(t.root, [HIDDEN]))).toEqual([]);
  });
  test("a submodule off the commit the base pins, or a submodule git directory nothing checks out, fails the read", () => {
    const moved = withSubmodule(leakyTree());
    git(join(moved.w, moved.sub), "checkout", "-q", "--detach", moved.subFuture);
    expect(d7Problems(check(moved.root, []))).toContain("D7: the submodule at lib/schema is not at the commit the base pins");
    const orphan = withSubmodule(leakyTree());
    git(orphan.w, "submodule", "deinit", "-q", "-f", orphan.sub);
    expect(d7Problems(check(orphan.root, []))).toContain("D7: a git directory at " + join(orphan.w, ".git", "modules", "lib", "schema") + " besides the tree's and the origin's");
  });
  test("an unfinished or baseless read fails", () => {
    expect(d7Problems(readD7("D7 base " + C + "\n"))).toContain("D7: the read did not finish");
    expect(d7Problems(readD7("D7 nobase\nD7 done\n"))).toContain("D7: no base commit in the tree");
  });
});

describe("D7's hidden names", () => {
  test("are the test side's new test names and paths that neither the pristine image nor the issue holds, fix side included", () => {
    const d = mkdtempSync(join(tmpdir(), "hm-d7-task-"));
    mkdirSync(join(d, "tests"));
    mkdirSync(join(d, "solution"));
    writeFileSync(join(d, "tests", "test.sh"), ["diff --git a/tests/test_new_module.py b/tests/test_new_module.py", "new file mode 100644", "--- /dev/null", "+++ b/tests/test_new_module.py", "+def " + HIDDEN + "():", "+def test_existing_name_here():", "+def test_public_issue_name():", "+def test_short():", ""].join("\n"));
    writeFileSync(join(d, "solution", "solve.sh"), "# names " + HIDDEN + "\n");
    writeFileSync(join(d, "instruction.md"), "The issue mentions test_public_issue_name.\n");
    expect(d7Names(d, { files: ["tests/test_old.py"], testNames: ["test_existing_name_here"] })).toEqual([HIDDEN, "tests/test_new_module.py"]);
  });
});

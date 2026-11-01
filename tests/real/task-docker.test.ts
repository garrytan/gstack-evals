// Copyright (c) 2026 Garry Tan. MIT License.
// B2 in Docker (GSTACK_EVALS_DOCKER=1): fixture tasks built and checked end to end (K1, K4 replay, K4 decoy, a Go K2
// on Go 1.23 and 1.25), a task that breaks V2, a planted leak, and the verifier's negative fixtures: skip markers,
// conftest hooks, symlinked tests, a swapped runner, a plugin in the tree, an exit at import or inside a test,
// agent-side config, an early TestMain, a weakened helper, a go.mod edit and a patch that does not apply, none of
// which passes a hidden test it should fail, beside honest fixes that pass. Also: the regression list grades only once
// frozen, a run the verifier never started has no verdict, and a tree an image plugin imports through an editable
// install still fails when it exits or breaks at that import. Keyless: no model call; the images install pinned, hashed packages at build time.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTask, saveTask } from "../../lanes/real-outcome/task/build.ts";
import { buildImage, checkTask, type CheckResult } from "../../lanes/real-outcome/task/check.ts";
import { main as task } from "../../lanes/real-outcome/task/cli.ts";
import { docker } from "../../lanes/real-outcome/task/docker.ts";
import { readTask, type TaskJson } from "../../lanes/real-outcome/task/format.ts";
import { resultFor } from "../../lanes/real-outcome/task/record.ts";
import { allPass, requiredTests, verifyTree } from "../../lanes/real-outcome/task/verify.ts";
import { buildRepo, calcCommits, calcSpecs, CLAMP_2, clampyRepo, FMT_4, GO_IMAGE, GO_IMAGE_125, OPS_4, patchFrom, tempDir, TEST_OPS_4 } from "./fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LONG = 900_000;
let tmp: ReturnType<typeof tempDir>;
let sha: Record<string, string>;
const calc = () => join(tmp.dir, "calc");
const rule = (r: CheckResult, name: string) => r.rules.find((x) => x.rule.startsWith(name))!;

describe.skipIf(!DOCKER)("real-outcome tasks in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  let specs: ReturnType<typeof calcSpecs>;
  let k1: TaskJson;
  let k1Dir: string;
  let image: string;

  beforeAll(() => {
    tmp = tempDir("real-docker-");
    sha = buildRepo(calc(), calcCommits());
    specs = calcSpecs(tmp.dir, sha);
    k1Dir = join(tmp.dir, "out/k1");
    k1 = buildTask(specs.k1, calc(), k1Dir).task;
    image = buildImage(k1Dir, k1).tag;
  }, LONG);
  afterAll(() => tmp?.cleanup());

  test("a K1 task is valid: gold passes 10 of 10 in random order, base and the introducing change fail where they should", () => {
    const r = checkTask({ taskDir: k1Dir, work: join(tmp.dir, "work-k1"), runs: 10, mechanical: true });
    expect(r.rules.filter((x) => !x.pass)).toEqual([]);
    expect(r.verdict).toBe("valid");
    expect(r.derived.regression).toEqual(["tests/test_ops.py::test_add", "tests/test_ops.py::test_div", "tests/test_ops.py::test_mul", "tests/test_ops.py::test_sub"]);
    expect(rule(r, "V2").detail).toBe("tests/test_ops.py::test_ratio");
    expect(rule(r, "V3").detail).toContain("tests/test_percent.py::test_percent_half");
    const gold = r.trees.find((t) => t.label === "gold")!;
    expect(gold.runs).toHaveLength(10);
    expect(new Set(gold.runs.map((x) => x.seed)).size).toBe(10);
    const strict = checkTask({ taskDir: k1Dir, work: join(tmp.dir, "work-k1b"), runs: 1 });
    expect(strict.verdict).toBe("invalid");
    expect(strict.rules.filter((x) => !x.pass).map((x) => x.rule.slice(0, 2))).toEqual(["V4", "V5"]);
  }, LONG);

  const intro = { "calc/ops.py": OPS_4, "tests/test_ops.py": TEST_OPS_4 };
  const fixed = FMT_4.replace('return f"{x * 10:.1f}%"', 'return "{:.1f}%".format(x * 100)');
  const grade = (label: string, files: Record<string, string | null | { symlink: string }>) => {
    const tree = verifyTree({ taskDir: k1Dir, task: k1, image, label, patch: patchFrom(calc(), sha.c3, files), runs: 1, seed: 7, work: join(tmp.dir, "work-neg") });
    const ids = [...k1.tests.functional, ...k1.tests.escaped_defect];
    return { tree, pass: allPass(tree, ids), half: resultFor(tree.runs[0].parsed, "tests/test_percent.py::test_percent_half") };
  };

  test("honest fixes pass, including one with its own conftest fixture and test file", () => {
    expect(grade("honest", { ...intro, "calc/fmt.py": fixed }).pass).toBe(true);
    const own = grade("honest-own-tests", { ...intro, "calc/fmt.py": fixed, "tests/conftest.py": "import pytest\n\n\n@pytest.fixture\ndef half():\n    return 0.5\n", "tests/test_mine.py": "def test_mine(half):\n    assert half == 0.5\n" });
    expect(own.pass).toBe(true);
    expect(own.tree.prepare.deleted.sort()).toEqual(["tests/conftest.py", "tests/test_mine.py"]);
  }, LONG);

  test("the buggy change fails, and so does every route around the hidden tests", () => {
    expect(grade("introducing", { ...intro, "calc/fmt.py": FMT_4 }).half).toMatchObject({ status: "fail", cls: "assert" });
    const skipSource = grade("skip-in-source", { ...intro, "calc/fmt.py": "import pytest\npytest.skip('later', allow_module_level=True)\n" + FMT_4 });
    expect(skipSource.pass).toBe(false);
    expect(skipSource.half.status).not.toBe("pass");
    const skipTests = grade("skip-markers", { ...intro, "calc/fmt.py": FMT_4, "tests/test_percent.py": "import pytest\n\n\n@pytest.mark.skip\ndef test_percent_half():\n    pass\n\n\n@pytest.mark.skip\ndef test_percent_small():\n    pass\n" });
    expect(skipTests.half).toMatchObject({ status: "fail", cls: "assert" });
    const hook = grade("conftest-hook", { ...intro, "calc/fmt.py": FMT_4, "tests/conftest.py": "import pytest\n\n\n@pytest.hookimpl(hookwrapper=True)\ndef pytest_runtest_makereport(item, call):\n    outcome = yield\n    outcome.get_result().outcome = 'passed'\n", "conftest.py": "def pytest_collection_modifyitems(items):\n    items.clear()\n" });
    expect(hook.half).toMatchObject({ status: "fail", cls: "assert" });
    expect(hook.tree.prepare.deleted.sort()).toEqual(["conftest.py", "tests/conftest.py"]);
    const link = grade("symlinked-tests", { ...intro, "calc/fmt.py": FMT_4, "calc/fake.py": "def test_percent_half():\n    pass\n\n\ndef test_percent_small():\n    pass\n", "tests/test_percent.py": { symlink: "../calc/fake.py" } });
    expect(link.half).toMatchObject({ status: "fail", cls: "assert" });
    const runner = grade("swapped-runner", { ...intro, "calc/fmt.py": FMT_4, "pytest.py": "def main(*args, **kwargs):\n    return 0\n\n\ndef hookimpl(*args, **kwargs):\n    return lambda f: f\n" });
    expect(runner.half).toMatchObject({ status: "fail", cls: "assert" });
    const exit = grade("exit-at-import", { ...intro, "calc/fmt.py": "import os\nos._exit(0)\n" + FMT_4 });
    expect(exit.pass).toBe(false);
    expect(exit.half.status).toBe("missing");
    const plugin = grade("plugin-dist-info", { ...intro, "calc/fmt.py": FMT_4, "evil-1.0.dist-info/METADATA": "Metadata-Version: 2.1\nName: evil\nVersion: 1.0\n", "evil-1.0.dist-info/entry_points.txt": "[pytest11]\nevil = evil_plugin\n", "evil_plugin.py": "def pytest_configure(config):\n    import calc.fmt\n    calc.fmt.percent = lambda x: f\"{x * 100:.1f}%\"\n" });
    expect(plugin.half).toMatchObject({ status: "fail", cls: "assert" });
    const exitInCall = grade("exit-in-call", { ...intro, "calc/fmt.py": FMT_4.replace('return f"{x * 10:.1f}%"', '__import__("os")._exit(0)') });
    expect(exitInCall.half.status).not.toBe("pass");
    const config = grade("agent-config", { ...intro, "calc/fmt.py": FMT_4, "pyproject.toml": '[project]\nname = "calc-fixture"\nversion = "0.1.0"\n\n[tool.pytest.ini_options]\npythonpath = ["."]\naddopts = "--deselect tests/test_percent.py::test_percent_half -p no:python"\n', "pytest.ini": "[pytest]\naddopts = -k nothing\n" });
    expect(config.half).toMatchObject({ status: "fail", cls: "assert" });
    for (const g of [skipSource, skipTests, hook, link, runner, plugin, exit, exitInCall, config]) expect(g.pass).toBe(false);
  }, LONG);

  test("a tree whose patch does not apply grades as a failure", () => {
    const patch = "diff --git a/calc/fmt.py b/calc/fmt.py\n--- a/calc/fmt.py\n+++ b/calc/fmt.py\n@@ -1 +1 @@\n-no such line\n+x = 1\n";
    const tree = verifyTree({ taskDir: k1Dir, task: k1, image, label: "no-apply", patch, runs: 1, seed: 7, work: join(tmp.dir, "work-neg") });
    expect(tree.prepare.patch).toBe("failed");
    expect(tree.prepare.error).toContain("patch failed");
    expect(tree.runs).toEqual([]);
    expect(allPass(tree, [...k1.tests.functional, ...k1.tests.escaped_defect])).toBe(false);
  }, LONG);

  test("the regression list grades only once frozen: a fix that breaks a base-passing test then fails", async () => {
    expect(() => requiredTests(k1)).toThrow("tests.regression is not frozen");
    const dir = join(tmp.dir, "out/k1-frozen");
    cpSync(k1Dir, dir, { recursive: true });
    const out: string[] = [];
    const log = console.log;
    console.log = (s: string) => void out.push(String(s));
    try {
      expect(await task(["check", dir, "--runs", "2", "--mechanical", "--work", join(tmp.dir, "work-freeze")])).toBe(1);
      expect(await task(["check", dir, "--runs", "2", "--mechanical", "--freeze-regression", "--work", join(tmp.dir, "work-freeze")])).toBe(0);
    } finally {
      console.log = log;
    }
    expect(out.join("\n")).toMatch(/^verdict: valid, regression not frozen /m);
    const frozen = readTask(dir);
    expect(frozen.tests.regression).toEqual(["tests/test_ops.py::test_add", "tests/test_ops.py::test_div", "tests/test_ops.py::test_mul", "tests/test_ops.py::test_sub"]);
    const files = { ...intro, "calc/fmt.py": fixed, "calc/ops.py": OPS_4.replace("return a + b", "return a + b + 1") };
    const tree = verifyTree({ taskDir: dir, task: frozen, image, label: "breaks-add", patch: patchFrom(calc(), sha.c3, files), runs: 1, seed: 7, work: join(tmp.dir, "work-neg") });
    expect(allPass(tree, [...frozen.tests.functional, ...frozen.tests.escaped_defect])).toBe(true);
    expect(resultFor(tree.runs[0].parsed, "tests/test_ops.py::test_add")).toMatchObject({ status: "fail", cls: "assert" });
    expect(allPass(tree, requiredTests(frozen))).toBe(false);
  }, LONG);

  test("a run the verifier never started has no verdict, and an exit status from the tree stays the tree's", () => {
    const honest = patchFrom(calc(), sha.c3, { ...intro, "calc/fmt.py": fixed });
    const run = (label: string, python: string) => () => verifyTree({ taskDir: k1Dir, task: { ...k1, runner: { ...k1.runner, python } as TaskJson["runner"] }, image, label, patch: honest, runs: 1, seed: 7, work: join(tmp.dir, "work-infra") });
    expect(run("no-entrypoint", "/nonexistent/python")).toThrow(/no-entrypoint: run 1 of 1 has no verdict: the verifier never started \(docker exited 12[5-7]\)/);
    expect(run("runner-crash", "/bin/false")).toThrow(/runner-crash: run 1 of 1 has no verdict: the verifier never started \(docker exited 1\)/);
    const forged = grade("exit-126", { ...intro, "calc/fmt.py": "import os\nos._exit(126)\n" + FMT_4 });
    expect(forged.tree.runs[0].exit).toBe(126);
    expect(forged.pass).toBe(false);
    expect(forged.half.status).toBe("missing");
  }, LONG);

  test("a tree an image plugin imports through an editable install is graded when it exits or breaks at that import", () => {
    const ctx = join(tmp.dir, "editable-image");
    const sp = join(ctx, "sp");
    mkdirSync(join(sp, "calcplug-1.0.dist-info"), { recursive: true });
    const finder = ["import sys", "from importlib.util import spec_from_file_location", "", 'MAPPING = {"calc": "/testbed/calc"}', "", "", "class _EditableFinder:", "    @classmethod", "    def find_spec(cls, fullname, path=None, target=None):", "        if fullname not in MAPPING:", "            return None", '        return spec_from_file_location(fullname, MAPPING[fullname] + "/__init__.py", submodule_search_locations=[MAPPING[fullname]])', "", "", "def install():", "    if _EditableFinder not in sys.meta_path:", "        sys.meta_path.append(_EditableFinder)", ""];
    writeFileSync(join(sp, "__editable___calc_finder.py"), finder.join("\n"));
    writeFileSync(join(sp, "__editable__.calc_fixture-0.1.0.pth"), "import __editable___calc_finder; __editable___calc_finder.install()\n");
    writeFileSync(join(sp, "calcplug.py"), "import calc.fmt\n");
    writeFileSync(join(sp, "calcplug-1.0.dist-info/METADATA"), "Metadata-Version: 2.1\nName: calcplug\nVersion: 1.0\n");
    writeFileSync(join(sp, "calcplug-1.0.dist-info/entry_points.txt"), "[pytest11]\ncalcplug = calcplug\n");
    const python = (k1.runner as { python: string }).python;
    writeFileSync(join(ctx, "Dockerfile"), "FROM " + image + "\nCOPY sp/ /tmp/sp/\nRUN " + python + " -c \"import shutil, sysconfig; shutil.copytree('/tmp/sp', sysconfig.get_paths()['purelib'], dirs_exist_ok=True)\" && rm -rf /tmp/sp\n");
    const tag = "real-editable-test:" + process.pid;
    expect(docker(["build", "-q", "-t", tag, ctx], { timeoutMs: LONG }).status).toBe(0);
    try {
      const on = (label: string, head: string) => {
        const tree = verifyTree({ taskDir: k1Dir, task: k1, image: tag, label, patch: patchFrom(calc(), sha.c3, { ...intro, "calc/fmt.py": head + fixed }), runs: 1, seed: 7, work: join(tmp.dir, "work-editable") });
        return { pass: allPass(tree, [...k1.tests.functional, ...k1.tests.escaped_defect]), half: resultFor(tree.runs[0].parsed, "tests/test_percent.py::test_percent_half").status };
      };
      expect(on("editable-honest", "")).toEqual({ pass: true, half: "pass" });
      expect(on("editable-exit", "import os\nos._exit(0)\n")).toEqual({ pass: false, half: "missing" });
      expect(on("editable-import-error", 'raise ImportError("broken by the tree")\n')).toEqual({ pass: false, half: "missing" });
    } finally {
      docker(["rmi", "-f", tag]);
    }
  }, LONG);

  test("K4 replay and decoy tasks are valid", () => {
    const k4Dir = buildTask(specs.k4, calc(), join(tmp.dir, "out/k4")).dir;
    const replay = checkTask({ taskDir: k4Dir, work: join(tmp.dir, "work-k4"), runs: 3, mechanical: true });
    expect(replay.rules.filter((x) => !x.pass)).toEqual([]);
    expect(rule(replay, "V9").detail).toContain("base plus exactly the change");
    const decoyDir = buildTask(specs.decoy, calc(), join(tmp.dir, "out/decoy")).dir;
    const decoy = checkTask({ taskDir: decoyDir, work: join(tmp.dir, "work-decoy"), runs: 3, mechanical: true });
    expect(decoy.rules.filter((x) => !x.pass)).toEqual([]);
    expect(rule(decoy, "V9").detail).toContain("passes every hidden test as given");
  }, LONG);

  test("a functional test that passes at base breaks V2, and a planted gold line breaks L2", () => {
    const badDir = join(tmp.dir, "out/bad");
    cpSync(k1Dir, badDir, { recursive: true });
    const bad = readTask(badDir);
    bad.tests.functional = ["tests/test_ops.py::test_add"];
    appendFileSync(join(badDir, "tests/leak-needles.txt"), "    return str(int(x))\n");
    saveTask(badDir, bad);
    const r = checkTask({ taskDir: badDir, work: join(tmp.dir, "work-bad"), runs: 1, mechanical: true });
    expect(r.verdict).toBe("invalid");
    expect(r.rules.filter((x) => !x.pass).map((x) => x.rule.split(" ")[0]).sort()).toEqual(["L2", "V2"]);
  }, LONG);

  for (const [version, goImage] of [["1.23", GO_IMAGE], ["1.25", GO_IMAGE_125]] as const) {
    test("a Go " + version + " task is valid; an early TestMain, a weakened helper, a go.mod edit and a missing symbol grade right", () => {
      const g = clampyRepo(tmp.dir, goImage, "clampy-" + version);
      const dir = buildTask(g.spec, g.repo, join(tmp.dir, "out/clampy-" + version)).dir;
      const r = checkTask({ taskDir: dir, work: join(tmp.dir, "work-go-" + version), runs: 2, mechanical: true });
      expect(r.rules.filter((x) => !x.pass)).toEqual([]);
      expect(r.derived.regression).toEqual(["clamp::TestClampLow"]);
      const t = readTask(dir);
      const goImageTag = buildImage(dir, t).tag;
      const base = git1(g.repo);
      const run = (label: string, files: Record<string, string>) => verifyTree({ taskDir: dir, task: t, image: goImageTag, label, patch: patchFrom(g.repo, base, files), runs: 1, seed: 3, work: join(tmp.dir, "work-go-neg-" + version) });
      const high = (tree: ReturnType<typeof run>) => resultFor(tree.runs[0].parsed, "clamp::TestClampHigh");
      const exitEarly = run("testmain", { "clamp/zz_test.go": 'package clamp\n\nimport (\n\t"os"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) { os.Exit(0) }\n', "go.work": "go 1.23\n\nuse .\n" });
      expect(exitEarly.prepare.deleted.sort()).toEqual(["clamp/zz_test.go", "go.work"]);
      expect(high(exitEarly)).toMatchObject({ status: "fail", cls: "assert" });
      const weak = run("weak-helper", { "clamp/helpers_test.go": 'package clamp\n\nimport "testing"\n\nfunc check(t *testing.T, got, want int) {}\n' });
      expect(high(weak)).toMatchObject({ status: "fail", cls: "assert" });
      expect(high(run("go-mod", { "clamp/clamp.go": CLAMP_2, "go.mod": "module example.com/clampy\n\ngo 1.99\n" }))).toEqual({ status: "pass" });
      expect(high(run("missing-symbol", { "clamp/clamp.go": CLAMP_2.replace("func Clamp(", "func Clamp2(") }))).toMatchObject({ status: "fail", cls: "missing_name", name: "Clamp" });
    }, LONG);
  }
});

function git1(repo: string): string {
  return Bun.spawnSync(["git", "rev-parse", "HEAD~1"], { cwd: repo }).stdout.toString().trim();
}


// Copyright (c) 2026 Garry Tan. MIT License.
// B2 in Docker (GSTACK_EVALS_DOCKER=1): fixture tasks built and checked end to end (K1, K4 replay, K4 decoy, a Go K2),
// a task that breaks V2, a planted leak, and the verifier's negative fixtures: skip markers, conftest hooks, symlinked
// tests, a swapped runner, an exit at import and agent-side config, each graded as a failure, beside honest fixes that
// pass. Keyless: no model call; the images install pinned, hashed packages at build time.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync } from "node:fs";
import { join } from "node:path";
import { buildTask, saveTask } from "../../lanes/real-outcome/task/build.ts";
import { buildImage, checkTask, type CheckResult } from "../../lanes/real-outcome/task/check.ts";
import { readTask, type TaskJson } from "../../lanes/real-outcome/task/format.ts";
import { resultFor } from "../../lanes/real-outcome/task/record.ts";
import { allPass, verifyTree } from "../../lanes/real-outcome/task/verify.ts";
import { buildRepo, calcCommits, calcSpecs, clampyRepo, FMT_4, OPS_4, patchFrom, tempDir, TEST_OPS_4 } from "./fixture.ts";

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
    const config = grade("agent-config", { ...intro, "calc/fmt.py": FMT_4, "pyproject.toml": '[project]\nname = "calc-fixture"\nversion = "0.1.0"\n\n[tool.pytest.ini_options]\npythonpath = ["."]\naddopts = "--deselect tests/test_percent.py::test_percent_half -p no:python"\n', "pytest.ini": "[pytest]\naddopts = -k nothing\n" });
    expect(config.half).toMatchObject({ status: "fail", cls: "assert" });
    for (const g of [skipSource, skipTests, hook, link, runner, exit, config]) expect(g.pass).toBe(false);
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

  test("a Go task is valid, and a TestMain that exits early or a weakened helper fails", () => {
    const g = clampyRepo(tmp.dir);
    const dir = buildTask(g.spec, g.repo, join(tmp.dir, "out/clampy")).dir;
    const r = checkTask({ taskDir: dir, work: join(tmp.dir, "work-go"), runs: 2, mechanical: true });
    expect(r.rules.filter((x) => !x.pass)).toEqual([]);
    expect(r.derived.regression).toEqual(["clamp::TestClampLow"]);
    const t = readTask(dir);
    const goImage = buildImage(dir, t).tag;
    const base = git1(g.repo);
    const run = (label: string, files: Record<string, string>) => verifyTree({ taskDir: dir, task: t, image: goImage, label, patch: patchFrom(g.repo, base, files), runs: 1, seed: 3, work: join(tmp.dir, "work-go-neg") });
    const exitEarly = run("testmain", { "clamp/zz_test.go": 'package clamp\n\nimport (\n\t"os"\n\t"testing"\n)\n\nfunc TestMain(m *testing.M) { os.Exit(0) }\n', "go.work": "go 1.23\n\nuse .\n" });
    expect(exitEarly.prepare.deleted.sort()).toEqual(["clamp/zz_test.go", "go.work"]);
    expect(resultFor(exitEarly.runs[0].parsed, "clamp::TestClampHigh")).toMatchObject({ status: "fail", cls: "assert" });
    const weak = run("weak-helper", { "clamp/helpers_test.go": 'package clamp\n\nimport "testing"\n\nfunc check(t *testing.T, got, want int) {}\n' });
    expect(resultFor(weak.runs[0].parsed, "clamp::TestClampHigh")).toMatchObject({ status: "fail", cls: "assert" });
  }, LONG);
});

function git1(repo: string): string {
  return Bun.spawnSync(["git", "rev-parse", "HEAD~1"], { cwd: repo }).stdout.toString().trim();
}


// Copyright (c) 2026 Garry Tan. MIT License.
// B2 without Docker: the per-test record, the patch filter, the install policy, the statement and licence checks, the
// builder's output and readTask's tamper checks, and prepare.sh's restore rules run on host directories.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main as real } from "../../lanes/real-outcome/cli.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { HELP as TASK_HELP } from "../../lanes/real-outcome/task/cli.ts";
import { detectLicence, installProblem, keysInEnv, PROTECT_ERE, readTask, statementLeaks, TaskError, VERIFIER_DIR } from "../../lanes/real-outcome/task/format.ts";
import { missingName, parseGoTest, parsePytest, resultFor } from "../../lanes/real-outcome/task/record.ts";
import { buildRepo, calcCommits, calcSpecs, clampyRepo, MIT, tempDir } from "./fixture.ts";

let tmp: ReturnType<typeof tempDir>;
let sha: Record<string, string>;
let specs: ReturnType<typeof calcSpecs>;
const repo = () => join(tmp.dir, "calc");

beforeAll(() => {
  tmp = tempDir("real-task-");
  sha = buildRepo(repo(), calcCommits());
  specs = calcSpecs(tmp.dir, sha);
});
afterAll(() => tmp.cleanup());

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof TaskError ? error.code : "other: " + (error as Error).message;
  }
  return "none";
};

describe("per-test record", () => {
  test("pytest phases become pass, skip, assertion, missing-name and load results; unreported ids are missing", () => {
    const lines = [
      { event: "phase", id: "t.py::a", when: "setup", outcome: "passed" },
      { event: "phase", id: "t.py::a", when: "call", outcome: "passed" },
      { event: "phase", id: "t.py::a", when: "teardown", outcome: "passed" },
      { event: "phase", id: "t.py::b", when: "call", outcome: "failed", exc: "AssertionError", msg: "AssertionError: assert 1 == 2" },
      { event: "phase", id: "t.py::c", when: "call", outcome: "failed", exc: "AttributeError", msg: "AttributeError: module 'calc.ops' has no attribute 'ratio'" },
      { event: "phase", id: "t.py::d", when: "setup", outcome: "skipped", msg: "Skipped: x" },
      { event: "phase", id: "t.py::e", when: "setup", outcome: "failed", exc: "RuntimeError", msg: "RuntimeError: fixture broke" },
      { event: "phase", id: "t.py::f", when: "call", outcome: "failed", exc: "KeyError", msg: "KeyError: 'x'" },
      { event: "collect", id: "u.py", outcome: "failed", msg: "ImportError while importing test module\nE   ModuleNotFoundError: No module named 'calc.extra'" },
    ];
    const p = parsePytest(lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(resultFor(p, "t.py::a")).toEqual({ status: "pass" });
    expect(resultFor(p, "t.py::b")).toMatchObject({ status: "fail", cls: "assert" });
    expect(resultFor(p, "t.py::c")).toMatchObject({ status: "fail", cls: "missing_name", name: "ratio" });
    expect(resultFor(p, "t.py::d").status).toBe("skip");
    expect(resultFor(p, "t.py::e")).toMatchObject({ status: "fail", cls: "load" });
    expect(resultFor(p, "t.py::f")).toMatchObject({ status: "fail", cls: "assert" });
    expect(resultFor(p, "u.py::g")).toMatchObject({ status: "fail", cls: "missing_name", name: "extra" });
    expect(resultFor(p, "t.py::zz")).toEqual({ status: "missing" });
  });

  test("a pytest id passes only when setup, call and teardown all reported passed", () => {
    const lines = [
      { event: "phase", id: "t.py::died_in_call", when: "setup", outcome: "passed" },
      { event: "phase", id: "t.py::died_in_teardown", when: "setup", outcome: "passed" },
      { event: "phase", id: "t.py::died_in_teardown", when: "call", outcome: "passed" },
    ];
    const p = parsePytest(lines.map((l) => JSON.stringify(l)).join("\n"));
    for (const id of ["t.py::died_in_call", "t.py::died_in_teardown"]) expect(resultFor(p, id)).toMatchObject({ status: "fail", cls: "load" });
  });

  test("go test -json results, with a build failure failing every id in its package", () => {
    const ev = [
      { Action: "run", Package: "m/a", Test: "TestX" },
      { Action: "pass", Package: "m/a", Test: "TestX" },
      { Action: "run", Package: "m/a", Test: "TestY" },
      { Action: "output", Package: "m/a", Test: "TestY", Output: "got 1, want 2\n" },
      { Action: "fail", Package: "m/a", Test: "TestY" },
      { Action: "output", Package: "m/b", Output: "FAIL\tm/b [build failed]\n" },
      { Action: "fail", Package: "m/b" },
    ];
    const p = parseGoTest(ev.map((e) => JSON.stringify(e)).join("\n"), "b/b_test.go:9:2: undefined: Keys\n", "m");
    expect(resultFor(p, "a::TestX").status).toBe("pass");
    expect(resultFor(p, "a::TestY")).toMatchObject({ status: "fail", cls: "assert" });
    expect(resultFor(p, "b::TestZ")).toMatchObject({ status: "fail", cls: "missing_name", name: "Keys" });
    expect(resultFor(p, "c::TestQ").status).toBe("missing");
  });

  test("missing names from Python and Go messages", () => {
    expect(missingName("ImportError: cannot import name 'percent' from 'calc.fmt'")).toBe("percent");
    expect(missingName("NameError: name 'clamp' is not defined")).toBe("clamp");
    expect(missingName("c.Keys undefined (type *Store has no field or method Keys)")).toBe("Keys");
    expect(missingName("AssertionError: assert 1 == 2")).toBeNull();
  });
});

describe("policies", () => {
  test("installs must hold to a lockfile", () => {
    const pytest = { kind: "pytest" as const, python: "python3", config: "pytest.ini" };
    const lock = "pytest==8.3.3 --hash=sha256:" + "a".repeat(64) + "\n";
    const read = (files: Record<string, string>) => (p: string) => files[p] ?? null;
    expect(installProblem({ lockfile: "requirements.lock", command: "pip install --no-deps --require-hashes -r requirements.lock", exclude: [] }, pytest, read({ "requirements.lock": lock }))).toBeNull();
    expect(installProblem({ lockfile: "requirements.lock", command: "pip install -r requirements.lock", exclude: [] }, pytest, read({ "requirements.lock": lock }))).toContain("does not hold");
    expect(installProblem({ lockfile: "requirements.lock", command: "pip install --no-deps --require-hashes -r requirements.lock", exclude: [] }, pytest, read({ "requirements.lock": "pytest==8.3.3\n" }))).toContain("without a sha256 hash");
    expect(installProblem({ lockfile: "package-lock.json", command: "npm install", exclude: [] }, pytest, read({ "package-lock.json": "{}" }))).toContain("does not hold");
    expect(installProblem({ lockfile: "uv.lock", command: "uv sync --frozen", exclude: [] }, pytest, read({}))).toContain("not in the base tree");
    expect(installProblem({ lockfile: null, command: null, exclude: [] }, pytest, read({}))).toContain("refused");
    expect(installProblem({ lockfile: null, command: null, exclude: [] }, { kind: "go", module: "m" }, read({ "go.mod": "module m\n\ngo 1.23\n" }))).toBeNull();
    expect(installProblem({ lockfile: null, command: null, exclude: [] }, { kind: "go", module: "m" }, read({ "go.mod": "module m\n\nrequire x v1\n" }))).toContain("refused");
  });

  test("statements may not name upstream commits, GitHub references or pull request links", () => {
    expect(statementLeaks("Fix it as in abc1234def and #42; see https://github.com/o/r/pull/42.", ["abc1234def0000"])).toEqual(["names commit abc1234def", "names #42", "links github.com/o/r/pull/42."]);
    expect(statementLeaks("Use color #fff and item 3.", ["abc1234def0000"])).toEqual([]);
  });

  test("licences and credentials", () => {
    expect(detectLicence(MIT)).toBe("MIT");
    expect(detectLicence("Apache License\n Version 2.0, January 2004")).toBe("Apache-2.0");
    expect(detectLicence("Redistribution and use in source and binary forms ... Neither the name")).toBe("BSD-3-Clause");
    expect(keysInEnv({ ANTHROPIC_API_KEY: "x", GH_TOKEN: "y", PATH: "/bin", EMPTY_TOKEN: "" })).toEqual(["ANTHROPIC_API_KEY", "GH_TOKEN"]);
  });
});

describe("build and the static checks", () => {
  test("builds a K1 task whose directory passes readTask", () => {
    const { task } = buildTask(specs.k1, repo(), join(tmp.dir, "out/k1"));
    expect(task).toMatchObject({ kind: "K1", base_commit: sha.c3, start_ref: "main", replay: null, upstream: { change: sha.c4, fix: sha.c6, gold_from: "fix-onto-introducing" }, new_test_files: ["tests/test_percent.py"], runner: { kind: "pytest", config: "pyproject.toml" } });
    expect(readTask(join(tmp.dir, "out/k1")).id).toBe("fx-calc-k1");
    const gold = readFileSync(join(tmp.dir, "out/k1/solution/gold.patch"), "utf8");
    expect(gold).toContain("+    return f\"{x * 100:.1f}%\"");
    expect(gold).not.toContain("or 0");
    expect(readFileSync(join(tmp.dir, "out/k1/tests/restore.list"), "utf8")).toBe("tests/test_ops.py\ntests/test_percent.py\n");
    expect(readFileSync(join(tmp.dir, "out/k1/tests/leak-needles.txt"), "utf8")).toContain('return f"{x * 100:.1f}%"');
    expect(readFileSync(join(tmp.dir, "out/k1/environment/Dockerfile"), "utf8")).toContain("RUN pip install --no-cache-dir --no-deps --require-hashes -r requirements.lock");
    for (const script of ["lanes/real-outcome/task/verifier/prepare.sh", "lanes/real-outcome/task/verifier/vrun.py"]) {
      expect(readFileSync(join(tmp.dir, "out/k1/tests", script.split("/").pop()!))).toEqual(readFileSync(join(import.meta.dir, "../..", script)));
    }
  });

  test("builds a K4 replay on a replay commit holding exactly the change, and a decoy", () => {
    const k4 = buildTask(specs.k4, repo(), join(tmp.dir, "out/k4")).task;
    expect(k4).toMatchObject({ kind: "K4", start_ref: "change", replay: { role: "replay", branch: "change", description: "Add ratio and percent helpers" } });
    expect(k4.replay!.commit).not.toBe(sha.c4);
    const decoy = buildTask(specs.decoy, repo(), join(tmp.dir, "out/decoy")).task;
    expect(decoy.upstream.gold_from).toBe("replay-as-given");
    expect(readFileSync(join(tmp.dir, "out/decoy/solution/gold.patch"), "utf8")).toBe("");
  });

  test("readTask refuses a tampered file, a hand-edited verifier script and a symlink", () => {
    const dir = join(tmp.dir, "out/tamper");
    cpSync(join(tmp.dir, "out/k1"), dir, { recursive: true });
    writeFileSync(join(dir, "solution/gold.patch"), "");
    expect(code(() => readTask(dir))).toBe("E_REAL_TASK_FORMAT");
    cpSync(join(tmp.dir, "out/k1"), dir, { recursive: true });
    symlinkSync("/etc/passwd", join(dir, "tests/x"));
    expect(code(() => readTask(dir))).toBe("E_REAL_TASK_FORMAT");
  });

  test("build refuses a leaky statement, an install without a lockfile, a conflicting fix and an upstream task on a keyed host", () => {
    const spec = JSON.parse(readFileSync(specs.k1, "utf8"));
    const write = (name: string, v: unknown) => {
      writeFileSync(join(tmp.dir, name), JSON.stringify(v));
      return join(tmp.dir, name);
    };
    writeFileSync(join(tmp.dir, "leaky.md"), "Do what #12 did.\n");
    expect(code(() => buildTask(write("s1.json", { ...spec, statement: "leaky.md" }), repo(), join(tmp.dir, "out/x")))).toBe("E_REAL_TASK_FORMAT");
    expect(code(() => buildTask(write("s2.json", { ...spec, install: { lockfile: null, command: null } }), repo(), join(tmp.dir, "out/x")))).toBe("E_REAL_TASK_LOCKFILE");
    expect(code(() => buildTask(write("s3.json", { ...spec, fix: sha.c12 }), repo(), join(tmp.dir, "out/x")))).toBe("E_REAL_TASK_GOLD_CONFLICT");
    process.env.REAL_TEST_FAKE_API_KEY = "x";
    try {
      expect(code(() => buildTask(write("s4.json", { ...spec, trust: "upstream" }), repo(), join(tmp.dir, "out/x")))).toBe("E_REAL_TASK_KEYED_HOST");
    } finally {
      delete process.env.REAL_TEST_FAKE_API_KEY;
    }
  });

  test("builds a Go task", () => {
    const g = clampyRepo(tmp.dir);
    const { task } = buildTask(g.spec, g.repo, join(tmp.dir, "out/clampy"));
    expect(task).toMatchObject({ runner: { kind: "go", module: "example.com/clampy" }, install: { lockfile: null, command: null } });
    expect(readTask(join(tmp.dir, "out/clampy")).kind).toBe("K2");
  });
});

describe("prepare.sh on a host tree", () => {
  test("keeps only gold's test files and runner config, and no symlink at or above a restored path", () => {
    const root = join(tmp.dir, "prep");
    const src = join(root, "src");
    const v = join(root, "verifier");
    for (const d of [src + "/tests/sub", src + "/.venv/lib", src + "/calc", v + "/restore/tests/sub", v + "/config", root + "/input", root + "/out", root + "/status"]) mkdirSync(d, { recursive: true });
    writeFileSync(join(src, "calc/ops.py"), "x = 1\n");
    writeFileSync(join(src, "tests/test_a.py"), "agent edit\n");
    writeFileSync(join(src, "tests/conftest.py"), "agent hook\n");
    writeFileSync(join(src, "conftest.py"), "agent root hook\n");
    writeFileSync(join(src, "sitecustomize.py"), "agent startup\n");
    writeFileSync(join(src, "calc/test_extra.py"), "agent test\n");
    writeFileSync(join(src, "fake.py"), "fake\n");
    symlinkSync("../fake.py", join(src, "tests/test_b.py"));
    symlinkSync("/tmp", join(src, "tests/sub2"));
    writeFileSync(join(src, ".venv/lib/x.pth"), "dep\n");
    writeFileSync(join(v, "restore/tests/test_a.py"), "gold a\n");
    writeFileSync(join(v, "restore/tests/test_b.py"), "gold b\n");
    writeFileSync(join(v, "restore/tests/sub/test_c.py"), "gold c\n");
    writeFileSync(join(v, "restore.list"), "tests/sub/test_c.py\ntests/test_a.py\ntests/test_b.py\n");
    writeFileSync(join(v, "protect.ere"), PROTECT_ERE);
    writeFileSync(join(v, "config/pyproject.toml"), "[tool.pytest.ini_options]\n");
    writeFileSync(join(root, "input/tree.patch"), "");
    const r = spawnSync("sh", [join(VERIFIER_DIR, "prepare.sh")], { env: { PATH: process.env.PATH, SRC: src, V: v, PATCH: join(root, "input/tree.patch"), OUT: join(root, "out"), STATUS: join(root, "status") }, encoding: "utf8" });
    expect(r.status).toBe(0);
    const out = join(root, "out");
    expect(readFileSync(join(out, "tests/test_a.py"), "utf8")).toBe("gold a\n");
    expect(lstatSync(join(out, "tests/test_b.py")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(out, "tests/test_b.py"), "utf8")).toBe("gold b\n");
    expect(readFileSync(join(out, "tests/sub/test_c.py"), "utf8")).toBe("gold c\n");
    for (const gone of ["tests/conftest.py", "conftest.py", "sitecustomize.py", "calc/test_extra.py", "tests/sub2"]) expect(existsSync(join(out, gone))).toBe(false);
    expect(existsSync(join(out, ".venv/lib/x.pth"))).toBe(true);
    expect(readFileSync(join(out, ".real-verifier-config.toml"), "utf8")).toBe("[tool.pytest.ini_options]\n");
    expect(readFileSync(join(root, "status/deleted.txt"), "utf8").split("\n").filter(Boolean).sort()).toEqual(["calc/test_extra.py", "conftest.py", "sitecustomize.py", "tests/conftest.py", "tests/sub2"]);
  });
});

describe("the real dispatcher", () => {
  test("routes mine and task to their modules, which are built", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const [log, error] = [console.log, console.error];
    console.log = (s: string) => void out.push(String(s));
    console.error = (s: string) => void err.push(String(s));
    try {
      expect(await real(["--help"])).toBe(0);
      expect(await real(["task", "--help"])).toBe(0);
      expect(await real(["mine", "--help"])).toBe(0);
      expect(await real(["task", "check"])).toBe(2);
      expect(await real(["task", "verify", join(tmp.dir, "absent"), "--bogus"])).toBe(2);
    } finally {
      console.log = log;
      console.error = error;
    }
    expect(out[0]).toMatch(/^  mine +Sample repositories/m);
    expect(out[0]).not.toMatch(/(mine|task) .*not built yet/);
    expect(out[1]).toBe(TASK_HELP);
    expect(out[2]).toContain("gstack-evals real mine");
    expect(err.join("\n")).toMatch(/^E_USAGE check needs a task directory$/m);
    expect(err.join("\n")).toMatch(/^E_USAGE .*bogus/m);
  });
});

describe("prepare.sh and installed dependencies", () => {
  test("dependency directories come only from the image, whatever the patch's format or path quoting", () => {
    const root = join(tmp.dir, "prep-deps");
    const src = join(root, "src");
    const v = join(root, "verifier");
    const out = join(root, "out");
    for (const d of [src + "/.venv/lib/site", src + "/calc", src + "/web/node_modules/m", v, root + "/input", out, root + "/status"]) mkdirSync(d, { recursive: true });
    writeFileSync(join(src, "calc/ops.py"), "x = 1\n");
    writeFileSync(join(src, ".venv/lib/site/pytest.py"), "real pytest\n");
    writeFileSync(join(src, "web/node_modules/m/i.js"), "real m\n");
    writeFileSync(join(v, "restore.list"), "");
    writeFileSync(join(v, "protect.ere"), PROTECT_ERE);
    const patch = [
      "diff --git a/calc/ops.py b/calc/ops.py\n--- a/calc/ops.py\n+++ b/calc/ops.py\n@@ -1 +1 @@\n-x = 1\n+x = 2\n",
      'diff --git "a/.venv/lib/site/\\303\\244.pth" "b/.venv/lib/site/\\303\\244.pth"\nnew file mode 100644\n--- /dev/null\n+++ "b/.venv/lib/site/\\303\\244.pth"\n@@ -0,0 +1 @@\n+import evil\n',
      "--- a/web/node_modules/m/i.js\n+++ b/web/node_modules/m/i.js\n@@ -1 +1 @@\n-real m\n+fake m\n",
      "diff --git a/.venv/lib/site/pytest.py b/pytest.py\nsimilarity index 100%\nrename from .venv/lib/site/pytest.py\nrename to pytest.py\n",
    ].join("");
    writeFileSync(join(root, "input/tree.patch"), patch);
    const r = spawnSync("sh", [join(VERIFIER_DIR, "prepare.sh")], { env: { PATH: process.env.PATH, SRC: src, V: v, PATCH: join(root, "input/tree.patch"), OUT: out, STATUS: join(root, "status") }, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "status/skipped.txt"), "utf8")).toBe('".venv/lib/site/\\303\\244.pth"\nweb/node_modules/m/i.js\n');
    expect(readFileSync(join(root, "status/restored.txt"), "utf8")).toBe(".venv\n");
    expect(readFileSync(join(out, "calc/ops.py"), "utf8")).toBe("x = 2\n");
    expect(readdirSync(join(out, ".venv/lib/site"))).toEqual(["pytest.py"]);
    expect(readFileSync(join(out, ".venv/lib/site/pytest.py"), "utf8")).toBe("real pytest\n");
    expect(readFileSync(join(out, "web/node_modules/m/i.js"), "utf8")).toBe("real m\n");
  });
});

// Copyright (c) 2026 Garry Tan. MIT License.
// The checker's L2 and V6 scopes without Docker (GST-957). L2: which image paths hold a leak, and the names an installed
// copy of the task's own project carries. V6: which restored files may not name release files. Synthetic paths and a
// fixture task stand in for the thin slice's false positives; no sealed task is read.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../../lanes/real-outcome/mine/git.ts";
import { buildTask } from "../../lanes/real-outcome/task/build.ts";
import { projectNames, releaseReaders, sortHits } from "../../lanes/real-outcome/task/check.ts";
import { buildRepo, calcCommits, calcSpecs, patchFrom, tempDir } from "./fixture.ts";

const PYTEST = { kind: "pytest", python: "python3", config: "pyproject.toml" } as const;

describe("L2 scope", () => {
  const own = projectNames({ repo: "fixture/calc", runner: PYTEST }, ["calc/__init__.py", "tests/__init__.py"], { "pyproject.toml": '[project]\nname = "calc-fixture"\nversion = "0.1.0"\n' });

  test("generic gold lines in installed third-party code and standard libraries are not leaks", () => {
    const hits = [
      "/root/.cache/uv/archive-v0/kq3xYz/requests/utils.py",
      "/root/.cache/uv/sdists-v9/pypi/attrs/24.2.0/AbC/src/attrs-24.2.0/src/attr/_make.py",
      "/usr/local/lib/python3.12/site-packages/_pytest/python.py",
      "/testbed/.venv/lib/python3.12/site-packages/pluggy/_hooks.py",
      "/testbed/.venv/bin/activate",
      "/testbed/node_modules/left-pad/index.js",
      "/testbed/web/node_modules/@babel/core/lib/index.js",
      "/usr/local/go/src/strings/builder.go",
      "/usr/local/go/test/fixedbugs/issue1.go",
      "/go/pkg/mod/golang.org/x/text@v0.14.0/cases/map.go",
      "/root/go/pkg/mod/cache/download/golang.org/x/text/@v/v0.14.0.mod",
      "/usr/local/lib/python3.12/json/encoder.py",
      "/usr/lib/python3/dist-packages/yaml/constructor.py",
      "/testbed/.tox/py312/lib/python3.12/site-packages/six.py",
    ];
    expect(sortHits(hits, own, [])).toEqual({ leaks: [], installed: hits });
  });

  test("a gold line in the repository's own tree, vendored and committed dependency dirs included, is a leak", () => {
    const tracked = ["calc/fmt.py", "vendor/github.com/pkg/errors/errors.go", "third_party/lib.py", "node_modules/pad/index.js", ".venv/lib/python3.12/site-packages/padlib/core.py"];
    const hits = [...tracked.map((p) => "/testbed/" + p), "/testbed/build/lib/calc/fmt.py", "/root/notes.txt", "/opt/tool/README"];
    expect(sortHits(hits, own, tracked)).toEqual({ leaks: hits, installed: [] });
  });

  test("a gold line in an installed copy of the project itself is a leak, by repository, distribution or package name", () => {
    const hits = [
      "/usr/local/lib/python3.12/site-packages/calc/fmt.py",
      "/usr/local/lib/python3.12/site-packages/calc_fixture-0.2.0.dist-info/METADATA",
      "/root/.cache/uv/archive-v0/Abc123/calc/fmt.py",
      "/root/.cache/uv/sdists-v9/pypi/calc-fixture/0.2.0/Xy/src/calc_fixture-0.2.0/calc/fmt.py",
      "/testbed/.venv/lib/python3.12/site-packages/calc.py",
      "/usr/local/lib/python3.12/site-packages/pip/_vendor/calc/fmt.py",
      "/testbed/node_modules/calc/index.js",
    ];
    expect(sortHits(hits, own, [])).toEqual({ leaks: hits, installed: [] });
  });

  test("the Go module cache holds the task's own module as a leak and other modules as installed code", () => {
    const goOwn = projectNames({ repo: "fixture/clampy", runner: { kind: "go", module: "github.com/Fixture/clampy" } }, [], {});
    const mine = ["/go/pkg/mod/github.com/!fixture/clampy@v1.2.0/clamp/clamp.go", "/go/pkg/mod/cache/download/github.com/!fixture/clampy/@v/v1.2.0.mod"];
    const other = ["/go/pkg/mod/github.com/!fixture/clampytools@v0.1.0/x.go", "/go/pkg/mod/golang.org/x/sys@v0.20.0/unix/syscall.go"];
    expect(sortHits([...mine, ...other], goOwn, [])).toEqual({ leaks: mine, installed: other });
  });

  test("project names come from the repository, the Go module, top-level packages and declared distribution names", () => {
    expect(projectNames({ repo: "fixture/calc", runner: PYTEST }, ["calc/__init__.py", "src/calc_extra/__init__.py", "tests/__init__.py", "src/tests/__init__.py"], {}).sort()).toEqual(["calc", "calc_extra"]);
    expect(projectNames({ repo: "o/python-thing", runner: PYTEST }, [], { "pyproject.toml": '[tool.poetry]\nname = "thing-poetry"\n', "setup.cfg": "[metadata]\nname = thing_cfg\nversion = 1\n", "package.json": '{"name": "@scope/thing-js"}' }).sort()).toEqual(["@scope/thing-js", "python-thing", "thing-poetry", "thing_cfg"]);
    expect(projectNames({ repo: "o/r", runner: PYTEST }, [], { "pyproject.toml": "not [ toml", "package.json": "{" })).toEqual(["r"]);
    expect(projectNames({ repo: "fixture/clampy", runner: { kind: "go", module: "example.com/clampy" } }, [], {}).sort()).toEqual(["clampy", "example.com/clampy"]);
  });
});

describe("V6 scope", () => {
  let tmp: ReturnType<typeof tempDir>;
  let sha: Record<string, string>;
  let k1: string;
  let decoy: string;
  const repo = () => join(tmp.dir, "calc");
  const restore = (dir: string, path: string, text: string) => {
    mkdirSync(join(dir, "tests/restore", path, ".."), { recursive: true });
    writeFileSync(join(dir, "tests/restore", path), text);
    appendFileSync(join(dir, "tests/restore.list"), path + "\n");
  };
  const copy = (from: string, name: string) => {
    const dir = join(tmp.dir, "copies", name);
    cpSync(from, dir, { recursive: true });
    return dir;
  };

  beforeAll(() => {
    tmp = tempDir("real-check-");
    sha = buildRepo(repo(), calcCommits());
    const specs = calcSpecs(tmp.dir, sha);
    k1 = buildTask(specs.k1, repo(), join(tmp.dir, "out/k1")).dir;
    decoy = buildTask(specs.decoy, repo(), join(tmp.dir, "out/decoy")).dir;
  });
  afterAll(() => tmp.cleanup());

  test("a restored file gold leaves alone may name release files, as a release-automation test does", () => {
    const dir = copy(k1, "untouched");
    restore(dir, "tests/test_release.py", 'def test_release_notes():\n    assert "CHANGELOG.md" != "VERSION"\n');
    restore(dir, "tests/data/release.json", '{"files": ["CHANGELOG", "TODOS.md"]}\n');
    expect(releaseReaders(dir)).toEqual([]);
    expect(releaseReaders(k1)).toEqual([]);
  });

  test("a restored file gold adds or changes may not name release files, and no release file may be restored", () => {
    const dir = copy(k1, "touched");
    appendFileSync(join(dir, "tests/restore/tests/test_percent.py"), "\n\ndef test_notes():\n    assert open('CHANGELOG.md').read()\n");
    restore(dir, "CHANGELOG.md", "## 1.0\n");
    restore(dir, "tests/test_release.py", 'def test_release_notes():\n    assert "CHANGELOG.md"\n');
    expect(releaseReaders(dir)).toEqual(["tests/test_percent.py", "CHANGELOG.md"]);
  });

  test("gold's paths are read the way git reads them, quoted names included, even from inside a checkout", () => {
    git(tmp.dir, ["init", "-q", join(tmp.dir, "copies")]);
    const dir = copy(k1, "quoted");
    const files = { "tests/data/release notes.txt": "see CHANGELOG\n", "tests/data/tab\tname.txt": "bump VERSION\n" };
    writeFileSync(join(dir, "solution/gold.patch"), patchFrom(repo(), sha.c3, files));
    for (const [path, text] of Object.entries(files)) restore(dir, path, text);
    expect(releaseReaders(dir)).toEqual(Object.keys(files));
  });

  test("a decoy's gold touches nothing, so only a restored release file fails it", () => {
    const dir = copy(decoy, "decoy");
    restore(dir, "tests/test_release.py", 'def test_release_notes():\n    assert "CHANGELOG.md"\n');
    expect(releaseReaders(dir)).toEqual([]);
    restore(dir, "VERSION", "1.0\n");
    expect(releaseReaders(dir)).toEqual(["VERSION"]);
  });
});

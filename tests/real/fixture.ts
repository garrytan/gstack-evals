// Copyright (c) 2026 Garry Tan. MIT License.
// Fixture repositories for the real-outcome lane's tests, written with git fast-import so every commit's dates and
// identity are fixed in the stream and the shas are the same on every machine. Nothing here is a real upstream.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../lanes/real-outcome/mine/git.ts";
import type { RepoMeta } from "../../lanes/real-outcome/mine/meta.ts";

export interface FxCommit {
  name: string;
  message: string | ((sha: Record<string, string>) => string);
  date: string;
  files?: Record<string, string | null | { symlink: string }>;
  branch?: string;
  /** The parent by fixture name; defaults to the branch tip. */
  from?: string;
  /** A second parent by fixture name, for a merge commit. */
  merge?: string;
}

/** Builds a repository commit by commit; returns fixture name to sha. */
export function buildRepo(dir: string, commits: FxCommit[]): Record<string, string> {
  git(tmpdir(), ["init", "-q", "-b", "main", dir]);
  const sha: Record<string, string> = {};
  const tips: Record<string, string> = {};
  for (const c of commits) {
    const branch = c.branch ?? "main";
    const parent = c.from ? sha[c.from] : tips[branch];
    const message = typeof c.message === "function" ? c.message(sha) : c.message;
    const when = Math.floor(Date.parse(c.date) / 1000) + " +0000";
    const data = (s: string) => "data " + Buffer.byteLength(s) + "\n" + s + "\n";
    let stream = "commit refs/heads/" + branch + "\n";
    stream += "author Fixture <fixture@example.invalid> " + when + "\n";
    stream += "committer Fixture <fixture@example.invalid> " + when + "\n";
    stream += data(message);
    if (parent) stream += "from " + parent + "\n";
    if (c.merge) stream += "merge " + sha[c.merge] + "\n";
    for (const [path, content] of Object.entries(c.files ?? {})) {
      if (content === null) stream += "D " + path + "\n";
      else if (typeof content === "string") stream += "M 100644 inline " + path + "\n" + data(content);
      else stream += "M 120000 inline " + path + "\n" + data(content.symlink);
    }
    git(dir, ["fast-import", "--quiet", "--force"], stream + "done\n");
    sha[c.name] = git(dir, ["rev-parse", "refs/heads/" + branch]).trim();
    tips[branch] = sha[c.name];
  }
  git(dir, ["checkout", "-q", "-f", "main"]);
  return sha;
}

let crafted = 0;

/** A patch from one commit to a crafted tree: the commit's tree with files changed, as an agent's change would be. */
export function patchFrom(dir: string, from: string, files: FxCommit["files"]): string {
  const name = "craft-" + ++crafted;
  const s = buildOnto(dir, from, name, files);
  return git(dir, ["diff", "--binary", "--full-index", "--no-renames", from, s]);
}

function buildOnto(dir: string, from: string, branch: string, files: FxCommit["files"]): string {
  const data = (s: string) => "data " + Buffer.byteLength(s) + "\n" + s + "\n";
  let stream = "commit refs/heads/" + branch + "\ncommitter Fixture <fixture@example.invalid> 1790000000 +0000\n" + data("crafted") + "from " + from + "\n";
  for (const [path, content] of Object.entries(files ?? {})) {
    if (content === null) stream += "D " + path + "\n";
    else if (typeof content === "string") stream += "M 100644 inline " + path + "\n" + data(content);
    else stream += "M 120000 inline " + path + "\n" + data(content.symlink);
  }
  git(dir, ["fast-import", "--quiet", "--force"], stream + "done\n");
  return git(dir, ["rev-parse", "refs/heads/" + branch]).trim();
}

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const MIT = `MIT License

Copyright (c) 2026 Fixture Authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`;

export const LOCK = `pytest==8.3.3 --hash=sha256:a6853c7375b2663155079443d2e45de913a911a11d669df02a50814944db57b2
pluggy==1.5.0 --hash=sha256:44e1ad92c8ca002de6377e165f3e0f1be63266ab4d554740532335b9d75ea669
iniconfig==2.0.0 --hash=sha256:b6a85871a79d2e3b22d2d1b94ac2824226a63c6b741c88f7ae975f18b6778374
packaging==24.1 --hash=sha256:5b8f2217dbdbd2f7f384c41c628544e6d52f2d0f53c6d0c3ea61aa5d1d7ff124
`;

const OPS_1 = "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n";
const OPS_2 = OPS_1 + "\n\ndef mul(a, b):\n    return a * b\n";
const OPS_3 = OPS_2 + "\n\ndef div(a, b):\n    return a // b\n";
export const OPS_4 = OPS_3 + "\n\ndef ratio(a, b):\n    return a / b\n";
const OPS_5 = OPS_4 + "\n\ndef neg(a):\n    return -a\n";
const FMT_1 = "def fmt_int(x):\n    return str(int(x))\n";
const FMT_3 = FMT_1 + "\n\ndef fmt_div(a, b):\n    return fmt_int(a // b)\n";
export const FMT_4 = FMT_3 + "\n\ndef fmt_float(x):\n    return f\"{x:.2f}\"\n\n\ndef percent(x):\n    return f\"{x * 10:.1f}%\"\n";
const FMT_5 = FMT_4.replace("    return str(int(x))\n", "    return str(int(x) or 0)\n");
const FMT_6 = FMT_5.replace("x * 10:", "x * 100:");
const TEST_OPS_1 = "from calc import ops\n\n\ndef test_add():\n    assert ops.add(2, 3) == 5\n\n\ndef test_sub():\n    assert ops.sub(5, 3) == 2\n";
const TEST_OPS_2 = TEST_OPS_1 + "\n\ndef test_mul():\n    assert ops.mul(2, 3) == 6\n";
const TEST_OPS_3 = TEST_OPS_2 + "\n\ndef test_div():\n    assert ops.div(7, 2) == 3\n";
export const TEST_OPS_4 = TEST_OPS_3 + "\n\ndef test_ratio():\n    assert ops.ratio(1, 4) == 0.25\n";
const ROUND_BAD = "import math\n\n\ndef round_half_up(x):\n    return math.floor(x + 0.5)\n";
const ROUND_GOOD = "import math\n\n\ndef round_half_up(x):\n    if x < 0:\n        return -math.floor(-x + 0.5)\n    return math.floor(x + 0.5)\n";

/** The calc fixture: a Python package with every case the miner must tell apart, merged 2026-03 to 2026-10. */
export function calcCommits(): FxCommit[] {
  return [
    { name: "c1", message: "Initial calc package", date: "2026-03-01T10:00:00Z", files: { LICENSE: MIT, "README.md": "# calc\n", "requirements.lock": LOCK, "pyproject.toml": '[project]\nname = "calc-fixture"\nversion = "0.1.0"\ndependencies = []\n\n[tool.pytest.ini_options]\npythonpath = ["."]\n', "calc/__init__.py": "", "calc/ops.py": OPS_1, "calc/fmt.py": FMT_1, "tests/test_ops.py": TEST_OPS_1 } },
    { name: "c2", message: "Add mul (#5)", date: "2026-05-10T10:00:00Z", files: { "calc/ops.py": OPS_2, "tests/test_ops.py": TEST_OPS_2 } },
    { name: "c3", message: "Add div (#11)", date: "2026-07-10T10:00:00Z", files: { "calc/ops.py": OPS_3, "calc/fmt.py": FMT_3, "tests/test_ops.py": TEST_OPS_3 } },
    { name: "c4", message: "Add ratio and percent helpers (#12)", date: "2026-07-20T10:00:00Z", files: { "calc/ops.py": OPS_4, "calc/fmt.py": FMT_4, "tests/test_ops.py": TEST_OPS_4 } },
    { name: "c5", message: "Print 0 for negative zero in fmt_int (#15)", date: "2026-08-01T10:00:00Z", files: { "calc/ops.py": OPS_5, "calc/fmt.py": FMT_5, "tests/test_fmt.py": "from calc import fmt\n\n\ndef test_fmt_int_neg_zero():\n    assert fmt.fmt_int(-0.0) == \"0\"\n" } },
    { name: "c6", message: "Fix percent scaling (#14)", date: "2026-08-15T10:00:00Z", files: { "calc/fmt.py": FMT_6, "tests/test_percent.py": "from calc import fmt\n\n\ndef test_percent_half():\n    assert fmt.percent(0.5) == \"50.0%\"\n\n\ndef test_percent_small():\n    assert fmt.percent(0.123) == \"12.3%\"\n" } },
    { name: "c7", message: "Refresh the test lock (#17)", date: "2026-08-20T10:00:00Z", files: { "requirements.lock": LOCK + "# refreshed\n", "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n", "tests/test_sq.py": "from calc import ops\n\n\ndef test_sq():\n    assert ops.sq(3) == 9\n" } },
    { name: "c8", message: "Docs: usage", date: "2026-09-01T10:00:00Z", files: { "README.md": "# calc\n\nSmall arithmetic helpers.\n" } },
    { name: "f1", branch: "stats", from: "c8", message: "Add mean", date: "2026-09-03T10:00:00Z", files: { "calc/stats.py": "def mean(xs):\n    return sum(xs) / len(xs)\n" } },
    { name: "f2", branch: "stats", message: "Add avg on top of mean", date: "2026-09-04T10:00:00Z", files: { "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n", "tests/test_stats.py": "from calc import ops, stats\n\n\ndef test_mean():\n    assert stats.mean([1, 2, 3]) == 2\n\n\ndef test_avg():\n    assert ops.avg(2, 4) == 3\n" } },
    { name: "c9", from: "c8", merge: "f2", message: "Merge pull request #18 from fixture/stats\n\nAdd stats helpers", date: "2026-09-05T10:00:00Z", files: { "calc/stats.py": "def mean(xs):\n    return sum(xs) / len(xs)\n", "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n", "tests/test_stats.py": "from calc import ops, stats\n\n\ndef test_mean():\n    assert stats.mean([1, 2, 3]) == 2\n\n\ndef test_avg():\n    assert ops.avg(2, 4) == 3\n" } },
    { name: "c10", message: "Add rounding helpers (#19)", date: "2026-09-10T10:00:00Z", files: { "calc/rounding.py": ROUND_BAD, "calc/fmt.py": FMT_6 + "\n\ndef fmt_round(x):\n    from calc.rounding import round_half_up\n    return fmt_int(round_half_up(x))\n", "tests/test_rounding.py": "from calc.rounding import round_half_up\n\n\ndef test_round_up():\n    assert round_half_up(2.5) == 3\n" } },
    { name: "c11", message: (s) => 'Revert "Add rounding helpers (#19)"\n\nThis reverts commit ' + s.c10 + ".\n\nIt broke fmt_round for negative numbers.\n", date: "2026-09-12T10:00:00Z", files: { "calc/rounding.py": null, "calc/fmt.py": FMT_6, "tests/test_rounding.py": null } },
    { name: "c12", message: 'Reland "Add rounding helpers" (#20)', date: "2026-09-20T10:00:00Z", files: { "calc/rounding.py": ROUND_GOOD, "calc/fmt.py": FMT_6 + "\n\ndef fmt_round(x):\n    from calc.rounding import round_half_up\n    return fmt_int(round_half_up(x))\n", "tests/test_rounding.py": "from calc.rounding import round_half_up\n\n\ndef test_round_up():\n    assert round_half_up(2.5) == 3\n\n\ndef test_round_negative():\n    assert round_half_up(-2.5) == -3\n" } },
    { name: "c13", message: "Add clamp helpers (#21)", date: "2026-09-25T10:00:00Z", files: { "calc/clamp.py": "def clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n", "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n\n\ndef clamp01(x):\n    from calc.clamp import clamp\n    return clamp(x, 0, 1)\n", "tests/test_clamp.py": "from calc.clamp import clamp\n\n\ndef test_clamp():\n    assert clamp(5, 0, 3) == 3\n" } },
    { name: "c14", message: (s) => 'Revert "Add clamp helpers (#21)"\n\nThis reverts commit ' + s.c13 + ".\n\nPulling this from the release; product wants a different API first.\n", date: "2026-09-26T10:00:00Z", files: { "calc/clamp.py": null, "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n", "tests/test_clamp.py": null } },
    { name: "c15", message: "Add histogram helpers (#22)", date: "2026-10-05T10:00:00Z", files: { "calc/stats.py": "def mean(xs):\n    return sum(xs) / len(xs)\n\n\ndef hist(xs):\n    out = {}\n    for x in xs:\n        out[x] = out.get(x, 0) + 1\n    return out\n", "calc/ops.py": OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n\n\ndef mode(*xs):\n    from calc.stats import hist\n    h = hist(xs)\n    return max(h, key=h.get)\n", "tests/test_hist.py": "from calc import ops, stats\n\n\ndef test_hist():\n    assert stats.hist([1, 1, 2]) == {1: 2, 2: 1}\n\n\ndef test_mode():\n    assert ops.mode(1, 2, 2) == 2\n" } },
    { name: "c16", message: "Add abs helper (#23)", date: "2026-10-06T10:00:00Z", files: { "calc/absval.py": "def absval(x):\n    return -x if x < 0 else x\n", "tests/test_absval.py": "from calc.absval import absval\n\n\ndef test_absval():\n    assert absval(-2) == 2\n" } },
    { name: "c17", message: "Fix sub argument order (#24)", date: "2026-10-07T10:00:00Z", files: { "calc/ops.py": (OPS_5 + "\n\ndef sq(a):\n    return a * a\n\n\ndef avg(*xs):\n    from calc.stats import mean\n    return mean(xs)\n\n\ndef mode(*xs):\n    from calc.stats import hist\n    h = hist(xs)\n    return max(h, key=h.get)\n").replace("    return a - b\n", "    return a - b  # a minus b\n"), "tests/test_sub.py": "from calc import ops\n\n\ndef test_sub_order():\n    assert ops.sub(1, 2) == -1\n" } },
    { name: "c18", message: "Add modulo helper\n\nFixes #26", date: "2026-10-08T10:00:00Z", files: { "calc/modulo.py": "def mod(a, b):\n    return a % b\n", "calc/fmt.py": FMT_6 + "\n\ndef fmt_round(x):\n    from calc.rounding import round_half_up\n    return fmt_int(round_half_up(x))\n" + "\n\ndef fmt_mod(a, b):\n    from calc.modulo import mod\n    return fmt_int(mod(a, b))\n", "tests/test_modulo.py": "from calc.modulo import mod\n\n\ndef test_mod():\n    assert mod(7, 3) == 1\n" } },
  ];
}

const pr = (number: number, title: string, created: string, merged: string, mergeCommit: string, closing: number[] = [], labels: string[] = []) => ({ number, title, body: "", created_at: created, merged_at: merged, merge_commit: mergeCommit, labels, closing_issues: closing, commits: [] });

/** The metadata GitHub would hold for the calc fixture. */
export function calcMeta(sha: Record<string, string>): RepoMeta {
  return {
    repo: "fixture/calc",
    fetched_at: "2026-10-31T00:00:00Z",
    prs: [
      pr(5, "Add mul", "2026-05-01T00:00:00Z", "2026-05-10T10:00:00Z", sha.c2),
      pr(11, "Add div", "2026-06-20T00:00:00Z", "2026-07-10T10:00:00Z", sha.c3),
      pr(12, "Add ratio and percent helpers", "2026-07-15T00:00:00Z", "2026-07-20T10:00:00Z", sha.c4),
      pr(14, "Fix percent scaling", "2026-08-12T00:00:00Z", "2026-08-15T10:00:00Z", sha.c6, [13]),
      pr(15, "Print 0 for negative zero in fmt_int", "2026-07-28T00:00:00Z", "2026-08-01T10:00:00Z", sha.c5, [16]),
      pr(17, "Refresh the test lock", "2026-08-18T00:00:00Z", "2026-08-20T10:00:00Z", sha.c7),
      pr(18, "Add stats helpers", "2026-09-02T00:00:00Z", "2026-09-05T10:00:00Z", sha.c9),
      pr(19, "Add rounding helpers", "2026-09-08T00:00:00Z", "2026-09-10T10:00:00Z", sha.c10),
      pr(20, "Reland rounding helpers", "2026-09-18T00:00:00Z", "2026-09-20T10:00:00Z", sha.c12),
      pr(21, "Add clamp helpers", "2026-09-22T00:00:00Z", "2026-09-25T10:00:00Z", sha.c13),
      pr(22, "Add histogram helpers", "2026-10-02T00:00:00Z", "2026-10-05T10:00:00Z", sha.c15),
      pr(23, "Add abs helper", "2026-10-05T00:00:00Z", "2026-10-06T10:00:00Z", sha.c16),
      pr(24, "Fix sub argument order", "2026-10-06T12:00:00Z", "2026-10-07T10:00:00Z", sha.c17, [25]),
    ],
    issues: [
      { number: 13, title: "percent() is off by ten", created_at: "2026-08-10T00:00:00Z", labels: ["bug"] },
      { number: 16, title: "fmt_int prints -0", created_at: "2026-07-25T00:00:00Z", labels: ["enhancement"] },
      { number: 25, title: "sub order looks wrong", created_at: "2026-10-06T00:00:00Z", labels: ["bug"] },
    ],
  };
}

export const PY_IMAGE = "python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337";
export const GO_IMAGE = "golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db";
/** Go 1.24 and newer report build errors as build-output events instead of stderr text. */
export const GO_IMAGE_125 = "golang:1.25-bookworm@sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437";
const PY_INSTALL = { lockfile: "requirements.lock", command: "pip install --no-cache-dir --no-deps --require-hashes -r requirements.lock" };

/** Writes build specs for the calc fixture's K1 pair (c4, c6), its K4 replay and a K4 decoy (c5); returns their paths. */
export function calcSpecs(dir: string, sha: Record<string, string>): { k1: string; k4: string; decoy: string } {
  const write = (name: string, value: unknown) => {
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value, null, 2));
    return join(dir, name);
  };
  write("k1.md", "Add two helpers. In calc/ops.py, ratio(a, b) returns a divided by b as a float. In calc/fmt.py, fmt_float(x) formats a number with two decimals, and percent(x) formats a fraction as a percentage with one decimal and a percent sign.\n");
  write("k4.md", "Add ratio and percent helpers\n");
  write("decoy.md", "Print 0 for negative zero in fmt_int\n");
  const common = { trust: "fixture", repo: "fixture/calc", licence: "MIT", image: { from: PY_IMAGE, apt: ["git"] }, install: PY_INSTALL, runner: { kind: "pytest" }, limits: { verifier_sec: 120 } };
  const escaped = ["tests/test_percent.py::test_percent_half", "tests/test_percent.py::test_percent_small"];
  return {
    k1: write("k1.json", { ...common, id: "fx-calc-k1", kind: "K1", change: sha.c4, fix: sha.c6, statement: "k1.md", tests: { functional: ["tests/test_ops.py::test_ratio"], escaped_defect: escaped, regression_scope: ["tests/test_ops.py"] } }),
    k4: write("k4.json", { ...common, id: "fx-calc-k4", kind: "K4", replay_role: "replay", change: sha.c4, fix: sha.c6, statement: "k4.md", tests: { escaped_defect: escaped, regression_scope: ["tests/test_ops.py"] } }),
    decoy: write("decoy.json", { ...common, id: "fx-calc-decoy", kind: "K4", replay_role: "decoy", change: sha.c5, statement: "decoy.md", tests: { functional: ["tests/test_fmt.py::test_fmt_int_neg_zero"], regression_scope: ["tests/test_ops.py"] } }),
  };
}

const CLAMP_1 = "package clamp\n\n// Clamp limits x to the range from lo to hi.\nfunc Clamp(x, lo, hi int) int {\n\tif x < lo {\n\t\treturn lo\n\t}\n\treturn x\n}\n";
export const CLAMP_2 = CLAMP_1.replace("\treturn x\n}", "\tif x > hi {\n\t\treturn hi\n\t}\n\treturn x\n}");
const HELPERS = 'package clamp\n\nimport "testing"\n\nfunc check(t *testing.T, got, want int) {\n\tt.Helper()\n\tif got != want {\n\t\tt.Fatalf("got %d, want %d", got, want)\n\t}\n}\n';
const CLAMP_TEST_1 = 'package clamp\n\nimport "testing"\n\nfunc TestClampLow(t *testing.T) {\n\tcheck(t, Clamp(-5, 0, 10), 0)\n}\n';
const CLAMP_TEST_2 = CLAMP_TEST_1 + '\nfunc TestClampHigh(t *testing.T) {\n\tcheck(t, Clamp(15, 0, 10), 10)\n}\n';

/** The clampy fixture: a Go module with one K2 change, and its build spec for a Go image. */
export function clampyRepo(dir: string, image = GO_IMAGE, name = "clampy"): { repo: string; spec: string } {
  const repo = join(dir, name);
  const sha = buildRepo(repo, [
    { name: "g1", message: "Initial clamp package", date: "2026-08-01T10:00:00Z", files: { LICENSE: MIT, "go.mod": "module example.com/clampy\n\ngo 1.23\n", "clamp/clamp.go": CLAMP_1, "clamp/helpers_test.go": HELPERS, "clamp/clamp_test.go": CLAMP_TEST_1 } },
    { name: "g2", message: "Clamp values above hi (#3)", date: "2026-09-01T10:00:00Z", files: { "clamp/clamp.go": CLAMP_2, "clamp/clamp_test.go": CLAMP_TEST_2 } },
  ]);
  writeFileSync(join(dir, "clampy.md"), "Clamp should also limit values above hi: Clamp(x, lo, hi) returns hi when x is greater than hi.\n");
  const spec = { id: "fx-clampy-k2", kind: "K2", trust: "fixture", repo: "fixture/clampy", licence: "MIT", change: sha.g2, statement: "clampy.md", image: { from: image, apt: [] }, install: { lockfile: null, command: null }, runner: { kind: "go" }, tests: { functional: ["clamp::TestClampHigh"], regression_scope: ["clamp"] }, limits: { verifier_sec: 300 } };
  writeFileSync(join(dir, name + ".json"), JSON.stringify(spec, null, 2));
  return { repo, spec: join(dir, name + ".json") };
}

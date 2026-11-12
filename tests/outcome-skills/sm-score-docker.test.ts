// Copyright (c) 2026 Garry Tan. MIT License.
// Docker tests for the first-stage scorer (GSTACK_EVALS_DOCKER=1) on invented fixture repos: Rust with an in-source test
// module, Go, and Python. They cover the 3-way merge of the fix's tests (clean and conflict), a change that won't apply,
// the strict and adapted readings on a refactor that renames a function and updates its tests, the three-run new-test
// rule and the skip-marker fallback. Images come from SM_SCORE_RUST_IMAGE (cargo and git) and SM_SCORE_GO_IMAGE (go,
// python3 and git); the dry-run units' runtime images serve. Runs use the scorer's root mode.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchOf, scoreUnit } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { scoreFirst, scoringRun } from "../../lanes/outcome-skills/statemachines/score.ts";
import { PY_IMAGE } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import type { SmUnit } from "../../lanes/outcome-skills/statemachines/unit.ts";
import { docker } from "../../lanes/real-outcome/task/docker.ts";

const RUST_IMAGE = process.env.SM_SCORE_RUST_IMAGE ?? "", GO_IMAGE = process.env.SM_SCORE_GO_IMAGE ?? "";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && !!RUST_IMAGE && !!GO_IMAGE;
const volumes: string[] = [];
const tmp = mkdtempSync(join(tmpdir(), "sm-score-docker-"));
let n = 0;
function score(unit: { dir: string; volume: string }, patch: string, cell: string) {
  const f = join(tmp, "p" + ++n + ".patch");
  writeFileSync(f, patch);
  return scoreFirst({ unitDir: unit.dir, patchFile: f, cell, mode: "root", volume: unit.volume });
}
afterAll(() => {
  for (const v of volumes) spawnSync("docker", ["volume", "rm", "-f", v]);
});

const RUST = ["pub fn bump(x: i32) -> i32 {", "    x + 2", "}", "#[cfg(test)]", "mod tests {", "    use super::*;", "    #[test]", "    fn keeps_sign() {", "        assert!(bump(-5) < 0);", "    }", "}", ""].join("\n");
const out = (cmd: string) => ({ rebuild: [] as string[], test: ["cd /w && " + cmd + " > /tmp/t.log 2>&1"], print: ["cat /tmp/t.log"] });

describe.skipIf(!on)("first-stage scorer in Docker", () => {
  test("Rust: the fix's in-source test hunk merges by 3-way over the arm's edit; strict restores the test module", () => {
    const files = { "Cargo.toml": "[package]\nname = \"bumper\"\nversion = \"0.1.0\"\nedition = \"2018\"\n", "src/lib.rs": RUST };
    const u = scoreUnit({
      id: "rust-bump", lang: "rust", image: RUST_IMAGE, files, tests: { "tests/smoke.rs": "#[test]\nfn smoke() {}\n" },
      fixTests: { "src/lib.rs": RUST.replace("mod tests {\n", "mod tests {\n    #[test]\n    fn bumps_by_one() {\n        assert_eq!(super::bump(1), 2);\n    }\n") },
      commands: { ...out("cargo test --offline --no-fail-fast"), rebuild: ["cd /w && cargo build --offline -q"] }, f2p: ["tests::bumps_by_one"], stable: ["tests::keeps_sign", "smoke"], known: ["tests::keeps_sign", "tests::bumps_by_one", "smoke"],
    });
    volumes.push(u.volume);
    const fix = RUST.replace("x + 2", "x + 1").replace("}\n#[cfg(test)]", "}\npub fn twice(x: i32) -> i32 {\n    x * 2\n}\n// end of helpers\n#[cfg(test)]").replace("assert!(bump(-5) < 0);", "assert!(bump(-5) < 1);");
    const r = score(u, patchOf(u.repo, { "src/lib.rs": fix }), "fix");
    expect(r.strict).toMatchObject({ applied: true, merge: "clean", outcome: "clean_fix" });
    expect(r.excluded).toEqual([{ path: "src/lib.rs", rule: "in_source_test", readings: "strict", detail: "mod tests restored to base" }]);
    expect(r.adapted).toMatchObject({ same_tree: false, fell_back_to_strict: null, merge: "clean", outcome: "clean_fix" });
    const wrong = score(u, patchOf(u.repo, { "src/lib.rs": RUST.replace("x + 2", "x + 3") }), "wrong");
    expect(wrong.strict).toMatchObject({ merge: "clean", fixed: false, broke: false, outcome: "no_fix" });
  }, 600_000);

  test("Go: a refactor that renames a function and updates its test is broke under strict and clean under adapted; a clashing new test file is a gap", () => {
    const files = { "go.mod": "module example.com/calc\n\ngo 1.16\n", "calc.go": "package calc\n\nfunc Add(a, b int) int { return a + b }\n\nfunc Mul(a, b int) int { return a + b }\n", "calc_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 {\n\t\tt.Fatal(\"add\")\n\t}\n}\n" };
    const u = scoreUnit({
      id: "go-calc", lang: "go", image: GO_IMAGE, files, tests: { "mul_test.go": "package calc\n\nimport \"testing\"\n\nfunc TestMul(t *testing.T) {\n\tif Mul(2, 3) != 6 {\n\t\tt.Fatal(\"mul\")\n\t}\n}\n" },
      commands: { ...out("go test -v ./..."), rebuild: ["cd /w && go build ./..."] }, f2p: ["TestMul"], stable: ["TestAdd"], known: ["TestAdd", "TestMul"],
    });
    volumes.push(u.volume);
    const renamed = { "calc.go": files["calc.go"].replace("func Add", "func Sum").replace("return a + b }\n\nfunc Mul", "return a + b }\n\nfunc Mul").replace(/(func Mul\(a, b int\) int \{ return a )\+( b \})/, "$1*$2"), "calc_test.go": files["calc_test.go"].replace("Add(2, 3)", "Sum(2, 3)") };
    const r = score(u, patchOf(u.repo, renamed), "refactor");
    expect(r.excluded).toEqual([{ path: "calc_test.go", rule: "test_file", readings: "strict", detail: "edited" }]);
    expect(r.strict).toMatchObject({ merge: "clean", fixed: false, broke: true, outcome: "no_fix_broke" });
    expect(r.strict.broke_by!.stable_missing).toEqual(["TestAdd"]);
    expect(r.adapted).toMatchObject({ same_tree: false, fell_back_to_strict: null, fixed: true, broke: false, outcome: "clean_fix" });
    const clash = score(u, patchOf(u.repo, { "calc.go": renamed["calc.go"].replace("func Sum", "func Add"), "mul_test.go": "package calc\n" }), "clash");
    expect(clash.strict).toMatchObject({ merge: "conflict", gap: "E_SM_TEST_PATCH_CONFLICT", outcome: null });
    expect(clash.codes.strict).toBe("E_SM_TEST_PATCH_CONFLICT");
  }, 600_000);

  test("Python: a change that won't apply scores no fix after a second extraction; a failing new test breaks after three runs; a skip marker sends adapted to strict", () => {
    const runner = ["import glob, importlib, sys", "sys.path.insert(0, '.')", "for f in sorted(glob.glob('tests/test_*.py')):", "    mod = f[:-3].replace('/', '.')", "    m = importlib.import_module(mod)", "    for k in sorted(x for x in dir(m) if x.startswith('test_')):", "        try:", "            getattr(m, k)()", "            print('PASS ' + mod + '::' + k)", "        except Exception:", "            print('FAIL ' + mod + '::' + k)", ""].join("\n");
    const files = { "run.py": runner, "src/calc.py": "def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a + b\n", "tests/test_calc.py": "from src.calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n" };
    const u = scoreUnit({
      id: "py-calc", lang: "python", image: GO_IMAGE, files, tests: { "tests/test_mul.py": "from src.calc import mul\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n" },
      commands: out("python3 run.py"), f2p: ["tests.test_mul::test_mul"], stable: ["tests.test_calc::test_add"], known: ["tests.test_calc::test_add", "tests.test_mul::test_mul"],
    });
    volumes.push(u.volume);
    const fixed = files["src/calc.py"].replace("    return a + b\n", "    return a + b\n").replace(/return a \+ b\n$/, "return a * b\n");
    const bad = score(u, "diff --git a/src/calc.py b/src/calc.py\n--- a/src/calc.py\n+++ b/src/calc.py\n@@ -1,2 +1,2 @@\n def nothing_here():\n-    return 0\n+    return 1\n", "bad");
    expect(bad).toMatchObject({ extractions: 2, codes: { strict: "E_SM_APPLY_FAILED", adapted: "E_SM_APPLY_FAILED" } });
    expect(bad.strict).toMatchObject({ apply_failed: true, outcome: "no_fix", fixed: false, broke: false });
    const extra = score(u, patchOf(u.repo, { "src/calc.py": fixed, "tests/test_extra.py": "def test_extra():\n    assert False\n" }), "extra");
    expect(extra.strict).toMatchObject({ outcome: "fix_broke", new_tests: ["tests.test_extra::test_extra"] });
    expect(extra.strict.runs.length).toBe(3);
    expect(extra.strict.broke_by!.new_test_failed).toEqual(["tests.test_extra::test_extra"]);
    const skip = score(u, patchOf(u.repo, { "src/calc.py": fixed, "tests/test_calc.py": files["tests/test_calc.py"] + "# pytest.skip( is not called here\n" }), "skip");
    expect(skip.strict).toMatchObject({ outcome: "clean_fix" });
    expect(skip.adapted.fell_back_to_strict).toMatch(/^skip marker: tests\/test_calc.py pytest.skip\(/);
    expect(skip.adapted.outcome).toBe("clean_fix");
  }, 600_000);
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("a scoring run with an infra error (docker)", () => {
  test("a scoring run that can't make its start mark fails as E_SM_INFRA_GAP and is never scored; the same run on a working image scores", () => {
    const img = "sm-test-score-notouch:" + process.pid, vol = "sm-test-score-infra-" + process.pid;
    expect(docker(["build", "-q", "-t", img, "-"], { input: "FROM " + PY_IMAGE + "\nRUN ln -sf /bin/false /usr/bin/touch\n" }).status).toBe(0);
    docker(["volume", "create", vol]);
    try {
      expect(docker(["run", "--rm", "--network", "none", "-v", vol + ":/w", "--entrypoint", "sh", PY_IMAGE, "-c", "mkdir /w/reports"]).status).toBe(0);
      const dir = mkdtempSync(join(tmp, "infra-"));
      writeFileSync(join(dir, "parser.py"), "def parser(log: str) -> dict[str, str]:\n    return {l.split()[0]: l.split()[1] for l in log.splitlines() if l}\n");
      const u = { id: "infra-unit", repo_dir: "/w", work_dir: "", commands: { rebuild: [], test: ["echo 't1 pass' > reports/out.log"], print: ["cat reports/out.log"] }, oracle: { rebuild_rule: { applies: true, fixed_rebuild_exits: [] } } } as unknown as SmUnit;
      expect(() => scoringRun(dir, u, img, vol, 1, "hardened", "score")).toThrow(/^E_SM_INFRA_GAP infra-unit score1: the run could not make its mark dir \(no_mark_dir\)/);
      expect(scoringRun(dir, u, PY_IMAGE, vol, 2, "hardened", "score").view).toEqual({ parsed: { t1: "pass" }, build_failed: false });
    } finally {
      docker(["volume", "rm", "-f", vol]);
      docker(["rmi", "-f", img]);
    }
  }, 300_000);
});

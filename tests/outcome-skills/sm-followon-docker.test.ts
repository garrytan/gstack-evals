// Copyright (c) 2026 Garry Tan. MIT License.
// Docker tests for the follow-on scorer and drift (GSTACK_EVALS_DOCKER=1) on invented fixture repos in Go and Python. A
// first stage that renames a function the fix's tests use makes the follow-on a drift case (a compiler error in Go, an
// import error in Python); a first stage that adds a test gets a start set from three runs on its two-commit tree; a
// first stage that breaks a stable test scores incremental 1 and end to end 0 when the follow-on fixes the bug.
// SM_SCORE_GO_IMAGE serves (go, python3 and git; the dry-run units' runtime images serve). Runs use root mode.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchOf, scoreUnit } from "../../lanes/outcome-skills/statemachines/fixtures.ts";
import { computeStart, scoreFollowon, type Tree } from "../../lanes/outcome-skills/statemachines/followon.ts";

const GO_IMAGE = process.env.SM_SCORE_GO_IMAGE ?? "";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && !!GO_IMAGE;
const volumes: string[] = [];
const tmp = mkdtempSync(join(tmpdir(), "sm-followon-docker-"));
let n = 0;
afterAll(() => {
  for (const v of volumes) spawnSync("docker", ["volume", "rm", "-f", v]);
});
const out = (cmd: string) => ({ rebuild: [] as string[], test: ["cd /w && " + cmd + " > /tmp/t.log 2>&1"], print: ["cat /tmp/t.log"] });
function follow(u: { dir: string; volume: string }, tree: Tree, treePatch: string, patch: string) {
  const start = computeStart({ unitDir: u.dir, tree, treePatch, mode: "root", volume: u.volume });
  const f = join(tmp, "f" + ++n + ".patch");
  writeFileSync(f, patch);
  return { start, rec: scoreFollowon({ unitDir: u.dir, tree, treePatch, start, patchFile: f, cell: "F-" + tree + "-1", replicate: 1, mode: "root", volume: u.volume }) };
}

const TEST = (name: string, body: string) => "package calc\n\nimport \"testing\"\n\nfunc " + name + "(t *testing.T) {\n\t" + body + "\n}\n";
const GO = {
  "go.mod": "module example.com/calc\n\ngo 1.16\n",
  "add.go": "package calc\n\nfunc Add(a, b int) int { return a + b }\n",
  "mul.go": "package calc\n\nfunc Mul(a, b int) int { return a + b }\n",
  "add_test.go": TEST("TestAdd", "if Add(2, 2) != 4 {\n\t\tt.Fatal(\"add\")\n\t}"),
};
const MUL_FIX = { "mul.go": GO["mul.go"].replace("a + b", "a * b") };

describe.skipIf(!on)("follow-on scorer in Docker", () => {
  test("Go: a start set on a two-commit tree, both scores on a broken tree, and drift on a renamed function", () => {
    const u = scoreUnit({
      id: "go-follow", lang: "go", image: GO_IMAGE, files: GO, tests: { "mul_test.go": TEST("TestMul", "if Add(Mul(2, 3), 0) != 6 {\n\t\tt.Fatal(\"mul\")\n\t}") },
      commands: { ...out("go test -v ./..."), rebuild: ["cd /w && go build ./..."] }, f2p: ["TestMul"], stable: ["TestAdd"], known: ["TestAdd", "TestMul"],
    });
    volumes.push(u.volume);
    const fix = patchOf(u.repo, MUL_FIX);

    const s0 = follow(u, "S0", "", fix);
    expect(s0.start).toMatchObject({ ids: ["TestAdd"], runs: [], gap: null });
    expect(s0.rec).toMatchObject({ applied: true, merge: "clean", f2p_pass: true, incremental: 1, end_to_end: 1, gap: null, whole_note: "same tree as strict; strict's run reused" });
    expect(s0.rec.whole).toEqual(s0.rec.strict);

    const gamed = follow(u, "S0", "", patchOf(u.repo, { ...MUL_FIX, "add.go": GO["add.go"].replace("a + b", "a - b"), "add_test.go": GO["add_test.go"].replace("!= 4", "!= 0") }));
    expect(gamed.rec).toMatchObject({ incremental: 0, end_to_end: 0, strict: { f2p_pass: true, incremental: 0, end_to_end: 0, stable_failed: ["TestAdd"] }, whole: { incremental: 1, end_to_end: 1 }, whole_note: null });
    expect(gamed.rec.excluded).toEqual([{ path: "add_test.go", rule: "test_file", readings: "strict", detail: "edited" }]);
    expect(gamed.rec.whole_run).not.toBeNull();

    const addSub = patchOf(u.repo, { "sub.go": "package calc\n\nfunc Sub(a, b int) int { return a - b }\n", "sub_test.go": TEST("TestSub", "if Sub(3, 1) != 2 {\n\t\tt.Fatal(\"sub\")\n\t}") });
    const a = follow(u, "A1", addSub, fix);
    expect(a.start).toMatchObject({ ids: ["TestAdd", "TestSub"], merge: "clean", gap: null });
    expect(a.start.runs).toHaveLength(3);
    expect(a.rec).toMatchObject({ incremental: 1, end_to_end: 1, start: { ids: 2 } });

    const broken = patchOf(u.repo, { "add.go": GO["add.go"].replace("a + b", "a + b + 0*a"), "add_test.go": TEST("TestAdd", "if Add(2, 2) != 5 {\n\t\tt.Fatal(\"add\")\n\t}") });
    const b = follow(u, "S2", broken, fix);
    expect(b.start.ids).toEqual([]);
    expect(b.rec).toMatchObject({ f2p_pass: true, incremental: 1, end_to_end: 0, stable_failed: ["TestAdd"] });

    const renamed = patchOf(u.repo, { "add.go": GO["add.go"].replace("func Add", "func Sum"), "add_test.go": GO["add_test.go"].replace("Add(2, 2)", "Sum(2, 2)") });
    const r = follow(u, "A1", renamed, fix);
    expect(r.start.ids).toEqual([]);
    expect(r.rec).toMatchObject({ f2p_pass: false, incremental: 0, end_to_end: 0, drift: { drift: true, ids: ["Add"] } });
    expect(r.rec.drift.named).toEqual([{ id: "Add", kinds: ["compiler"] }]);

    const notDrift = follow(u, "S2", addSub, patchOf(u.repo, {}));
    expect(notDrift.rec).toMatchObject({ change: { empty: true }, f2p_pass: false, drift: { drift: false, ids: [] } });
  }, 900_000);

  // Value: protects=section 8's follow-on on a first stage that changed nothing; fails_when=computeStart refuses an empty first-stage patch on A1 or S2, or the empty commit two changes the start set or the scores; why_new=the Captain's pre-data item 8 for #290; seam=followon.ts computeStart and scoreFollowon on sh/followon.sh's empty commit two; no_claim=what an unchanged first stage says about its arm
  test("Go: an A1 or S2 first stage that changed nothing starts from the base tree under an empty commit two and scores as on S0", () => {
    const u = scoreUnit({
      id: "go-empty", lang: "go", image: GO_IMAGE, files: GO, tests: { "mul_test.go": TEST("TestMul", "if Add(Mul(2, 3), 0) != 6 {\n\t\tt.Fatal(\"mul\")\n\t}") },
      commands: { ...out("go test -v ./..."), rebuild: ["cd /w && go build ./..."] }, f2p: ["TestMul"], stable: ["TestAdd"], known: ["TestAdd", "TestMul"],
    });
    volumes.push(u.volume);
    const fix = patchOf(u.repo, MUL_FIX);
    for (const tree of ["A1", "S2"] as const) {
      const e = follow(u, tree, "", fix);
      expect(e.start).toMatchObject({ ids: ["TestAdd"], gap: null });
      expect(e.start.runs).toHaveLength(3);
      expect(e.rec).toMatchObject({ applied: true, merge: "clean", f2p_pass: true, incremental: 1, end_to_end: 1, gap: null, start: { ids: 1 } });
    }
  }, 900_000);

  test("Python: an import error naming a renamed function is drift; a wrong fix on the same tree with the name kept is not", () => {
    const RUN = ["import glob, importlib, sys, traceback", "sys.path.insert(0, '.')", "for f in sorted(glob.glob('test_*.py')):", "    try:", "        m = importlib.import_module(f[:-3])", "    except Exception:", "        traceback.print_exc(file=sys.stdout)", "        continue",
      "    for n in sorted(x for x in dir(m) if x.startswith('test_')):", "        try:", "            getattr(m, n)()", "            print('PASS ' + n)", "        except Exception:", "            traceback.print_exc(file=sys.stdout)", "            print('FAIL ' + n)", ""].join("\n");
    const files = { "run.py": RUN, "agg.py": "def total(xs):\n    return sum(xs)\n", "stats.py": "def mean(xs):\n    return sum(xs)\n", "test_agg.py": "from agg import total\n\ndef test_total():\n    assert total([1, 2]) == 3\n" };
    const u = scoreUnit({
      id: "py-follow", lang: "python", image: GO_IMAGE, files, tests: { "test_stats.py": "from agg import total\nfrom stats import mean\n\ndef test_mean():\n    assert mean([1, 3]) == 2 and total([1]) == 1\n" },
      commands: out("python3 run.py"), f2p: ["test_mean"], stable: ["test_total"], known: ["test_total", "test_mean"],
    });
    volumes.push(u.volume);
    const fix = patchOf(u.repo, { "stats.py": "def mean(xs):\n    return sum(xs) / len(xs)\n" });
    const renamed = patchOf(u.repo, { "agg.py": "def sum_all(xs):\n    return sum(xs)\n", "test_agg.py": "from agg import sum_all\n\ndef test_total():\n    assert sum_all([1, 2]) == 3\n" });
    const r = follow(u, "S2", renamed, fix);
    expect(r.start.ids).toEqual(["test_total"]);
    expect(r.rec).toMatchObject({ f2p_pass: false, incremental: 0, end_to_end: 0, drift: { drift: true, ids: ["total"], named: [{ id: "total", kinds: ["import"] }] } });
    const kept = patchOf(u.repo, { "agg.py": "def total(xs):\n    return sum(xs)\n\n\ndef sum_all(xs):\n    return total(xs)\n" });
    const w = follow(u, "A1", kept, patchOf(u.repo, { "stats.py": "def mean(xs):\n    return sum(xs) * 2\n" }));
    expect(w.rec).toMatchObject({ f2p_pass: false, incremental: 0, end_to_end: 0, drift: { drift: false, ids: [] } });
  }, 900_000);
});

// Copyright (c) 2026 Garry Tan. MIT License.
// The mutation scorer against the real pinned tools, in Docker (GSTACK_EVALS_DOCKER=1): cargo-mutants, StrykerJS, mutmut
// and go-mutesting on small fixture repositories, keyless, with every scoring step under --network none. Tests that pin
// the behaviour they test must score high and tests that only call the code must score low, in each language. Python
// also covers the rules in both directions: failing tests dropped and counted, no tests, only failing tests, no mutants,
// tests the agent did not write left out, tests it changed counted, the transplant reading, and a patch that does not
// apply. TypeScript checks that a pre-existing test in the agent's test file stays out, and Rust that inline tests cannot
// be transplanted. Building the tool images needs the network once; scoring never does.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { docker } from "../../lanes/real-outcome/task/docker.ts";
import { TOOLS, type Lang } from "../../lanes/outcome-skills/mutation/pins.ts";
import { scoreTree, toolImage } from "../../lanes/outcome-skills/mutation/run.ts";
import type { MutationRecord } from "../../lanes/outcome-skills/mutation/score.ts";
import * as F from "./mutation-fixtures.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LONG = 1_800_000;
const HIGH = 0.75;
const LOW = 0.25;

interface Story {
  make: () => F.Fixture;
  strong: F.Files;
  weak: F.Files;
}

const STORIES: Record<Lang, Story> = {
  python: { make: F.pythonFixture, strong: { "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_STRONG }, weak: { "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_WEAK } },
  go: { make: F.goFixture, strong: { "calc/clamp.go": F.GO_IMPL, "calc/clamp_test.go": F.GO_STRONG }, weak: { "calc/clamp.go": F.GO_IMPL, "calc/clamp_test.go": F.GO_WEAK } },
  rust: { make: F.rustFixture, strong: { "src/lib.rs": F.RS_IMPL + F.RS_STRONG_INLINE }, weak: { "src/lib.rs": F.RS_IMPL, "tests/runs.rs": F.RS_WEAK_INTEGRATION } },
  typescript: { make: F.typescriptFixture, strong: { "src/ops.ts": F.TS_IMPL, "src/clamp.test.ts": F.TS_STRONG }, weak: { "src/ops.ts": F.TS_IMPL, "src/clamp.test.ts": F.TS_WEAK } },
};

const LICENCE_DIR: Record<Lang, string> = { rust: "rust", typescript: "node", python: "python", go: "go" };
// The pinned tools' verdicts on the strong trees, [killed, survived]. Every survivor left is a mutant the strong tests
// cannot tell apart (in Rust, < to <= and > to >= at clamp's bounds), so the counts never move between runs.
const STRONG: Record<Lang, [number, number]> = { python: [8, 2], go: [14, 4], rust: [17, 2], typescript: [17, 2] };

for (const lang of Object.keys(STORIES) as Lang[]) {
  describe.skipIf(!DOCKER)(lang + ": " + TOOLS[lang].tool + " " + TOOLS[lang].version + " (GSTACK_EVALS_DOCKER=1)", () => {
    let fx: F.Fixture;
    let strong: MutationRecord;
    const score = (patch: F.Files, more: Partial<Parameters<typeof scoreTree>[0]> = {}) => scoreTree({ lang, image: fx.image, patch: fx.patch(patch), work: fx.dir + "/work", ...more });

    beforeAll(() => {
      fx = STORIES[lang].make();
    }, LONG);
    afterAll(() => fx?.cleanup());

    test("the tool image recorded the pinned licence", () => {
      const r = docker(["run", "--rm", "--network", "none", "--entrypoint", "cat", toolImage(lang), "/opt/gstack-mutation/" + LICENCE_DIR[lang] + "/licence/spdx.txt"]);
      expect(r.stdout.trim()).toBe(TOOLS[lang].licence);
    });

    test("tests that pin the behaviour score high", () => {
      strong = score(STORIES[lang].strong, { label: "strong" });
      expect(strong).toMatchObject({ status: "scored", lang, tool_version: TOOLS[lang].version, restriction: TOOLS[lang].restriction, tests: { changed: 2, passing: 2, dropped: 0 }, mutants: { timeout: 0, error: 0 } });
      expect(strong.mutants.sampled).toBe(strong.mutants.in_scope);
      expect(strong.score!).toBeGreaterThanOrEqual(HIGH);
      expect([strong.mutants.killed, strong.mutants.survived]).toEqual(STRONG[lang]);
      console.log(lang + " strong: " + strong.mutants.killed + " of " + (strong.mutants.killed + strong.mutants.survived) + " killed");
    }, LONG);

    test("tests that only call the code score low, on a frozen sample of 4 of the same mutants", () => {
      const weak = score(STORIES[lang].weak, { label: "weak", cap: 4 });
      expect(weak).toMatchObject({ status: "scored", cap: 4, tests: { changed: 2, passing: 2, dropped: 0 }, mutants: { in_scope: strong.mutants.in_scope, sampled: 4 } });
      expect(weak.score!).toBeLessThanOrEqual(LOW);
      console.log(lang + " weak: " + weak.mutants.killed + " of " + (weak.mutants.killed + weak.mutants.survived) + " killed");
    }, LONG);
  });
}

describe.skipIf(!DOCKER)("python: the scoring rules in both directions (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  const score = (patch: F.Files, more: Partial<Parameters<typeof scoreTree>[0]> = {}) => scoreTree({ lang: "python", image: fx.image, patch: fx.patch(patch), work: fx.dir + "/work", ...more });
  const DOUBLE_ADDED = "def double(x):\n    return x + x\n";

  beforeAll(() => {
    fx = F.pythonFixture();
  }, LONG);
  afterAll(() => fx?.cleanup());

  test("a test that fails on the tree is dropped and counted, and the score comes from the rest", () => {
    const r = score({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_STRONG + F.PY_FAILING });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 3, passing: 2, dropped: 1 } });
    expect(r.score!).toBeGreaterThanOrEqual(HIGH);
  }, LONG);

  test("no added or changed test scores 0 as no-tests", () => {
    expect(score({ "calc/ops.py": F.PY_IMPL })).toMatchObject({ status: "no-tests", score: 0, tests: { changed: 0 } });
  }, LONG);

  test("tests that all fail score 0 as no-passing-tests, not better than none", () => {
    expect(score({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": "from calc.ops import clamp" + F.PY_FAILING })).toMatchObject({ status: "no-passing-tests", score: 0, tests: { changed: 1, passing: 0, dropped: 1 } });
  }, LONG);

  test("a patch that changes no source line has no mutants and no score", () => {
    expect(score({ "tests/test_new.py": "from calc.ops import double\n\n\ndef test_more():\n    assert double(5) == 10\n" })).toMatchObject({ status: "no-mutants", score: null, tests: { changed: 1, passing: 1 } });
  }, LONG);

  test("a strong test the agent did not write is not run: its own weak test scores low on the line it changed", () => {
    const r = score({ "calc/ops.py": DOUBLE_ADDED, "tests/test_new.py": "from calc.ops import double\n\n\ndef test_double_runs():\n    double(1)\n" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 1, passing: 1 } });
    expect(r.score!).toBeLessThanOrEqual(LOW);
  }, LONG);

  test("an existing test the agent changed counts as its own", () => {
    const r = score({ "calc/ops.py": DOUBLE_ADDED, "tests/test_base.py": F.PY_BASE["tests/test_base.py"] + "    assert double(1) == 2\n" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 1, passing: 1 } });
    expect(r.score!).toBeGreaterThanOrEqual(HIGH);
  }, LONG);

  test("the transplant runs the agent's tests on gold's tree against gold's mutants", () => {
    const r = score({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_STRONG }, { gold: fx.patch({ "calc/ops.py": F.PY_GOLD }) });
    expect(r.transplant).toMatchObject({ status: "scored", tests: { changed: 2, passing: 2 } });
    expect(r.transplant!.mutants.in_scope).toBeGreaterThan(0);
    expect(r.transplant!.score!).toBeGreaterThanOrEqual(HIGH);
  }, LONG);

  test("tests that need the agent's own names cannot run on gold, and the transplant reads tool-error", () => {
    const own = F.PY_IMPL + "\n\ndef clamp_unit(x):\n    return clamp(x, 0, 1)\n";
    const tests = "from calc.ops import clamp_unit\n\n\ndef test_unit():\n    assert clamp_unit(2) == 1\n    assert clamp_unit(-1) == 0\n";
    const r = score({ "calc/ops.py": own, "tests/test_new.py": tests }, { gold: fx.patch({ "calc/ops.py": F.PY_GOLD }) });
    expect(r.status).toBe("scored");
    expect(r.transplant).toMatchObject({ status: "tool-error", score: null, tests: { changed: 1, passing: 0 } });
  }, LONG);

  test("symlinks the agent's tests plant in the output folder are never followed on the host", () => {
    const victim = join(fx.dir, "victim.txt");
    const secret = join(fx.dir, "secret.txt");
    writeFileSync(victim, "untouched");
    writeFileSync(secret, "SECRET-7f3a");
    const plant = "import os\nfrom calc.ops import clamp\n\n\ndef test_clamp_and_plant():\n    for name, target in ((\"py-config.json\", " + JSON.stringify(victim) + "), (\"py-list.log\", " + JSON.stringify(secret) + ")):\n        try:\n            os.symlink(target, \"/out/\" + name)\n        except OSError:\n            pass\n    assert clamp(5, 0, 3) == 3\n";
    const r = score({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": plant });
    expect(readFileSync(victim, "utf8")).toBe("untouched");
    expect(JSON.stringify(r)).not.toContain("SECRET-7f3a");
  }, LONG);

  test("a pytest that cannot start is a tool error, not tests that failed", () => {
    const r = score({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_STRONG, "pytest.ini": "[pytest]\naddopts = --no-such-option\n" });
    expect(r).toMatchObject({ status: "tool-error", score: null, tests: { changed: 2 } });
  }, LONG);

  test("a patch naming a path outside the repository is refused before git applies it", () => {
    const escape = ".tox/../../../../../../victim_test.py";
    const extra = "diff --git a/" + escape + " b/" + escape + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + escape + "\n@@ -0,0 +1,2 @@\n+def test_v():\n+    assert True\n";
    const p = fx.patch({ "calc/ops.py": F.PY_IMPL, "tests/test_new.py": F.PY_STRONG }) + extra;
    expect(scoreTree({ lang: "python", image: fx.image, patch: p, work: fx.dir + "/work" })).toMatchObject({ status: "tool-error", score: null });
  }, LONG);

  test("a patch that does not apply to the image's tree is a tool error with no score", () => {
    const bad = "diff --git a/calc/ops.py b/calc/ops.py\n--- a/calc/ops.py\n+++ b/calc/ops.py\n@@ -1,2 +1,2 @@\n-def triple(x):\n+def triple(y):\n     return x * 3\n";
    expect(scoreTree({ lang: "python", image: fx.image, patch: bad, work: fx.dir + "/work" })).toMatchObject({ status: "tool-error", score: null, detail: "the patch does not apply to the image's tree" });
  }, LONG);
});

describe.skipIf(!DOCKER)("typescript: a pre-existing test in the agent's test file stays out (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.typescriptFixture();
  }, LONG);
  afterAll(() => fx?.cleanup());

  test("a vitest that cannot load its config is a tool error, not tests that failed", () => {
    const r = scoreTree({ lang: "typescript", image: fx.image, patch: fx.patch({ "src/ops.ts": F.TS_IMPL, "src/clamp.test.ts": F.TS_STRONG, "vitest.config.ts": "throw new Error(\"broken config\");\n" }), work: fx.dir + "/work" });
    expect(r).toMatchObject({ status: "tool-error", score: null });
  }, LONG);

  test("the strong double test in the same file is skipped, so the agent's weak test scores low", () => {
    const ops = "export function double(x: number): number {\n  return x + x;\n}\n";
    const tests = F.TS_BASE["src/ops.test.ts"] + "\ntest(\"double runs\", () => {\n  double(1);\n});\n";
    const r = scoreTree({ lang: "typescript", image: fx.image, patch: fx.patch({ "src/ops.ts": ops, "src/ops.test.ts": tests }), work: fx.dir + "/work" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 1, passing: 1 } });
    expect(r.score!).toBeLessThanOrEqual(LOW);
  }, LONG);
});

describe.skipIf(!DOCKER)("rust: inline tests cannot move to gold's tree (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.rustFixture();
  }, LONG);
  afterAll(() => fx?.cleanup());

  test("the same tree gets the same verdicts three times: parallel cargo-mutants jobs never share a build", () => {
    const runs = [0, 1, 2].map(() => scoreTree({ lang: "rust", image: fx.image, patch: fx.patch(STORIES.rust.strong), work: fx.dir + "/work" }).mutants);
    expect(runs).toEqual([runs[0]!, runs[0]!, runs[0]!]);
    expect([runs[0]!.killed, runs[0]!.survived]).toEqual(STRONG.rust);
  }, LONG);

  test("tests inside a binary target run under their own paths", () => {
    const bin = "use calc::clamp;\n\nfn main() {\n    println!(\"{}\", clamp(1, 0, 2));\n}\n\n#[cfg(test)]\nmod tests {\n    use calc::clamp;\n\n    #[test]\n    fn clamps() {\n        assert_eq!(clamp(5, 0, 10), 5);\n        assert_eq!(clamp(-1, 0, 10), 0);\n        assert_eq!(clamp(11, 0, 10), 10);\n    }\n}\n";
    const r = scoreTree({ lang: "rust", image: fx.image, patch: fx.patch({ "src/lib.rs": F.RS_IMPL, "src/bin/demo.rs": bin }), work: fx.dir + "/work" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 1, passing: 1 } });
    expect(r.mutants.killed).toBeGreaterThan(0);
  }, LONG);

  test("the own reading scores and the transplant is not-transplantable", () => {
    const r = scoreTree({ lang: "rust", image: fx.image, patch: fx.patch(STORIES.rust.strong), gold: fx.patch({ "src/lib.rs": F.RS_IMPL }), work: fx.dir + "/work" });
    expect(r.status).toBe("scored");
    expect(r.transplant).toMatchObject({ status: "not-transplantable", score: null });
  }, LONG);
});

describe.skipIf(!DOCKER)("rust: a same-named test in a target the agent did not touch stays out (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.fixture("rust", { ...F.RS_BASE, "tests/base.rs": "use calc::double;\n\n#[test]\nfn doubles() {\n    assert_eq!(double(2), 4);\n    assert_eq!(double(0), 0);\n    assert_eq!(double(-3), -6);\n}\n" });
  }, LONG);
  afterAll(() => fx?.cleanup());

  test("the agent's weak doubles() in its own target scores low beside an unchanged strong doubles()", () => {
    const lib = F.RS_BASE["src/lib.rs"]!.replace("x * 2", "x + x");
    const weak = "use calc::double;\n\n#[test]\nfn doubles() {\n    let _ = double(1);\n}\n";
    const r = scoreTree({ lang: "rust", image: fx.image, patch: fx.patch({ "src/lib.rs": lib, "tests/weak.rs": weak }), work: fx.dir + "/work" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 1, passing: 1 } });
    expect(r.score!).toBeLessThanOrEqual(LOW);
  }, LONG);
});

describe.skipIf(!DOCKER)("rust: src/bin.rs keeps its module path, and a same-path test in one harness is refused (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.fixture("rust", F.RS_SHARED_BASE);
  }, LONG);
  afterAll(() => fx?.cleanup());
  const score = (files: F.Files) => scoreTree({ lang: "rust", image: fx.image, patch: fx.patch(files), work: fx.dir + "/work" });

  test("the agent's tests in src/bin.rs run under bin:: and score, apart from the binary's unchanged tests::clamps", () => {
    const r = score({ "src/bin.rs": F.RS_NEW + F.RS_STRONG_INLINE });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 2, passing: 2 } });
    expect(r.score!).toBeGreaterThanOrEqual(HIGH);
  }, LONG);

  test("an unchanged test with the same path in the same harness still reads tool-error", () => {
    const demo = "use calc::shared::clamp;\n\nfn main() {\n    println!(\"{}\", clamp(1, 0, 2));\n}\n\n#[cfg(test)]\nmod tests {\n    use calc::shared::clamp;\n\n    #[test]\n    fn clamps() {\n        assert_eq!(clamp(5, 0, 10), 5);\n        assert_eq!(clamp(-1, 0, 10), 0);\n        assert_eq!(clamp(11, 0, 10), 10);\n    }\n}\n";
    expect(score({ "src/shared.rs": F.RS_NEW, "src/bin/demo.rs": demo })).toMatchObject({ status: "tool-error", score: null, tests: { changed: 1 } });
  }, LONG);
});

describe.skipIf(!DOCKER)("python: unchanged modules stay in mutmut's tree (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.fixture("python", { ...F.PY_BASE, "helpers.py": "LOW = 0\n" }, F.PY_EXTRA);
  }, LONG);
  afterAll(() => fx?.cleanup());

  test("changed code that imports an unchanged top-level helper still scores", () => {
    const r = scoreTree({ lang: "python", image: fx.image, patch: fx.patch({ "calc/ops.py": "from helpers import LOW\n\n\n" + F.PY_IMPL, "tests/test_new.py": F.PY_STRONG }), work: fx.dir + "/work" });
    expect(r).toMatchObject({ status: "scored", tests: { changed: 2, passing: 2 } });
    expect(r.score!).toBeGreaterThanOrEqual(HIGH);
  }, LONG);
});

describe.skipIf(!DOCKER)("go: a package that fails, or tests that pass only once, never earn kills (GSTACK_EVALS_DOCKER=1)", () => {
  let fx: F.Fixture;
  beforeAll(() => {
    fx = F.goFixture();
  }, LONG);
  afterAll(() => fx?.cleanup());
  const score = (files: F.Files) => scoreTree({ lang: "go", image: fx.image, patch: fx.patch(files), work: fx.dir + "/work" });

  test("a TestMain that fails the package makes its passing tests fail, so the tree scores 0", () => {
    const main = "package calc\n\nimport (\n\t\"os\"\n\t\"testing\"\n)\n\nfunc TestMain(m *testing.M) {\n\tm.Run()\n\tos.Exit(1)\n}\n";
    expect(score({ "calc/clamp.go": F.GO_IMPL, "calc/clamp_test.go": F.GO_WEAK, "calc/main_test.go": main })).toMatchObject({ status: "no-passing-tests", score: 0, tests: { changed: 2, passing: 0 } });
  }, LONG);

  test("a test that fails on its second run is dropped before any mutant runs", () => {
    const once = "package calc\n\nimport (\n\t\"os\"\n\t\"testing\"\n)\n\nfunc TestOnce(t *testing.T) {\n\tif _, err := os.Stat(\"/tmp/gstack-once\"); err == nil {\n\t\tt.Fatal(\"second run\")\n\t}\n\t_ = os.WriteFile(\"/tmp/gstack-once\", nil, 0o644)\n\t_ = Clamp(5, 0, 10)\n}\n";
    expect(score({ "calc/clamp.go": F.GO_IMPL, "calc/clamp_test.go": once })).toMatchObject({ status: "no-passing-tests", score: 0, tests: { changed: 1, passing: 0 } });
  }, LONG);
});

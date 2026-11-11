// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read's two build-side secondaries in Docker (GSTACK_EVALS_DOCKER=1): real-bug catch and
// changed-line coverage, on units built from synthetic repositories in Go, Python, Node (node:test) and Rust. The Go
// unit is the dry run's own seam fixture, so the seams "transplant catch" and "transplant no-catch" run here for real.
// Keyless: no model call; coverage images install public packages at pinned versions when they are built.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { catchBuild, seamBuildPatch, seamCleanup, seamGoUnit, seamTransplantCatch, seamTransplantNoCatch } from "../../lanes/eng-build/catch.ts";
import { coverageBuild, removeCoverageImages } from "../../lanes/eng-build/coverage.ts";
import { removeLabelled } from "../../lanes/eng-build/screen.ts";
import { buildUnit, type BuildOutcome } from "../../lanes/eng-build/unit.ts";
import { patchFrom, tempDir } from "../real/fixture.ts";
import { nodeLock, nodeRepo, pyRepo, PY_OPS, RS_ADD, RS_FIXED, rsTests, rustRepo, type Fixture } from "./fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LONG = 1_800_000;

describe.skipIf(!DOCKER)("eng-review build read secondaries in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  let tmp: ReturnType<typeof tempDir>;
  const built = new Map<string, { fx: Fixture; out: BuildOutcome }>();
  const build = (name: string, make: (dir: string) => Fixture) => {
    if (!built.has(name)) {
      const fx = make(join(tmp.dir, name, "repo"));
      built.set(name, { fx, out: buildUnit(fx.spec, fx.repo, join(tmp.dir, name, "unit"), { work: join(tmp.dir, name, "work"), labels: join(tmp.dir, "labels.json"), seed: 7 }) });
    }
    return built.get(name)!;
  };
  const patch = (name: string, files: Record<string, string>) => {
    const { fx } = built.get(name)!;
    return patchFrom(fx.repo, fx.sha.base, files);
  };
  const work = (name: string, tag: string) => join(tmp.dir, name, "work-" + tag);

  beforeAll(() => {
    tmp = tempDir("eb-second-");
  });
  afterAll(() => {
    seamCleanup();
    removeCoverageImages();
    removeLabelled();
    tmp?.cleanup();
  });

  test("Go seams: a build test red in 3 merged runs and green in 3 fixed runs is a catch; red in 2 of 3 is not", async () => {
    expect(await seamTransplantCatch()).toBe("catch");
    expect(await seamTransplantNoCatch()).toBe("no catch");
    const u = seamGoUnit();
    const r = catchBuild({ unitDir: u.unitDir, patch: seamBuildPatch(false), work: join(u.root, "work-detail") });
    expect(r).toMatchObject({ catches: { B1: true }, trees: 2, compiled: 2, drops: [] });
    expect(r.cases).toEqual([".::TestBuildMark", ".::TestBuildZero"]);
  }, LONG);

  test("Go coverage: the build's own test runs every changed line of Mul; a test that never calls it runs none; no own test scores 0", () => {
    const u = seamGoUnit();
    const full = coverageBuild({ unitDir: u.unitDir, patch: seamBuildPatch(false) });
    expect(full).toMatchObject({ scored: true, share: 1, why: null, tools: ["go test -coverprofile"] });
    expect(full.lines).toBeGreaterThan(0);
    const calc = "package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n\nfunc Mul(a, b int) int {\n\treturn a * b\n}\n";
    const markOnly = "package calc\n\nimport \"testing\"\n\nfunc TestBuildAdd(t *testing.T) {\n\tif Add(1, 1) != 2 {\n\t\tt.Fatal(\"add\")\n\t}\n}\n";
    const none = coverageBuild({ unitDir: u.unitDir, patch: patchFrom(u.repo, u.base, { "calc.go": calc, "calc_build_test.go": markOnly }) });
    expect(none).toMatchObject({ scored: true, share: 0, covered: 0, lines: full.lines });
    expect(coverageBuild({ unitDir: u.unitDir, patch: patchFrom(u.repo, u.base, { "calc.go": calc }) })).toMatchObject({ scored: true, share: 0, why: "no_own_tests" });
    expect(coverageBuild({ unitDir: u.unitDir, patch: patchFrom(u.repo, u.base, { "README.md": "calc\n" }) })).toMatchObject({ scored: false, share: null, why: "no_product_change" });
  }, LONG);

  test("Python: a build's own pytest case catches the merge's bug, and pytest-cov reads its changed lines", () => {
    const { out } = build("py", pyRepo);
    const files = { "pkg/ops.py": PY_OPS + "\n\ndef scale(x, k=2):\n    return x * k\n", "tests/test_build.py": "from pkg import ops\n\n\ndef test_build_negative():\n    assert ops.scale(-2) == -4\n" };
    const r = catchBuild({ unitDir: out.dir, patch: patch("py", files), work: work("py", "catch") });
    expect(r).toMatchObject({ catches: { B1: true }, trees: 2, compiled: 2, cases: ["tests/test_build.py::test_build_negative"] });
    const c = coverageBuild({ unitDir: out.dir, patch: patch("py", files) });
    expect(c).toMatchObject({ scored: true, share: 1, why: null, tools: ["pytest-cov"] });
  }, LONG);

  test("node:test: a build's own case catches the bug and c8 reads its lines; a test of a name the real code lacks catches nothing and does not compile", () => {
    const { out } = build("nodetest", (dir) => nodeRepo(dir, "nodetest", nodeLock));
    const src = "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n";
    const own = (name: string) => "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { " + name + " } from '../src/calc.js';\ntest('build zero', () => assert.equal(" + name + "(0, 5), 0));\n";
    const good = { "src/calc.js": src, "test/build.test.js": own("mul") };
    const r = catchBuild({ unitDir: out.dir, patch: patch("nodetest", good), work: work("nodetest", "catch") });
    expect(r).toMatchObject({ catches: { B1: true }, trees: 2, compiled: 2, cases: ["test/build.test.js::build zero"] });
    const invented = catchBuild({ unitDir: out.dir, patch: patch("nodetest", { "src/calc.js": src + "export const mulSafe = mul;\n", "test/build.test.js": own("mulSafe") }), work: work("nodetest", "invented") });
    expect(invented).toMatchObject({ catches: { B1: false }, trees: 2, compiled: 0 });
    const c = coverageBuild({ unitDir: out.dir, patch: patch("nodetest", good) });
    expect(c).toMatchObject({ scored: true, why: null, tools: ["c8"] });
    expect(c.share).toBeGreaterThan(0);
  }, LONG);

  test("Rust: only the build's inline test module moves, so the real merged product fails its case; a stray test function drops; cargo-llvm-cov reads the lines", () => {
    const { out } = build("rust", rustRepo);
    const lib = RS_ADD + RS_FIXED + rsTests(["adds", "mul_zero"]);
    const r = catchBuild({ unitDir: out.dir, patch: patch("rust", { "src/lib.rs": lib }), work: work("rust", "catch") });
    expect(r).toMatchObject({ catches: { B1: true }, trees: 2, compiled: 2, drops: [] });
    expect(r.cases).toContain("src/lib.rs::tests::mul_zero");
    const stray = catchBuild({ unitDir: out.dir, patch: patch("rust", { "src/lib.rs": RS_ADD + RS_FIXED + rsTests(["adds"]) + "\n#[test]\nfn stray() {\n    assert_eq!(mul(0, 5), 0);\n}\n" }), work: work("rust", "stray") });
    expect(stray.catches).toEqual({ B1: null });
    expect(stray.drops).toEqual([{ code: "E_EB_TRANSPLANT", unit: out.eb.unit.id, step: "region:src/lib.rs", cls: "test functions outside the cfg(test) module" }]);
    const c = coverageBuild({ unitDir: out.dir, patch: patch("rust", { "src/lib.rs": lib }) });
    expect(c).toMatchObject({ scored: true, why: null, tools: ["cargo-llvm-cov"] });
    expect(c.share).toBeGreaterThan(0);
  }, LONG);
});

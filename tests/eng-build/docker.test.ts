// Copyright (c) 2026 Garry Tan. MIT License.
// The eng-review build read in Docker (GSTACK_EVALS_DOCKER=1): build units from synthetic repositories in Go, Node
// (jest, vitest, mocha, node:test), Node with Rust, Python and Rust, graded by the verifier's new runner adapters in its
// hardened sandbox. Each runner grades an honest build, the merge's own bug, a missing function and a negative fixture
// (a tree that tries to swap the runner's config, exit at import or fake the hidden tests), none of which passes a
// hidden case it should fail. Also: the cold rebuild ignores a stale compiled file, only a Rust inline test module
// moves, a product hash mismatch is refused, the leak check reads the exact image, the screen qualifies a candidate
// and drops one, and the recount prints counts only. Keyless: no model call; images install public packages at build.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { EbError } from "../../lanes/eng-build/errors.ts";
import { leakCheck, leakNeedles } from "../../lanes/eng-build/leak.ts";
import { main as recount, recountUnit } from "../../lanes/eng-build/recount.ts";
import { removeLabelled, screenCandidate } from "../../lanes/eng-build/screen.ts";
import { buildUnit, gradeSet, readUnit, type BuildOutcome, type Grid } from "../../lanes/eng-build/unit.ts";
import { patchFrom, tempDir } from "../real/fixture.ts";
import { GO_BUGGY, GO_CALC, GO_FIXED, goRepo, nodeLock, nodeRepo, nodeRustRepo, nodeTest, pyRepo, PY_OPS, RS_ADD, RS_BUGGY, RS_FIXED, rsTests, rustRepo, type Fixture } from "./fixture.ts";

const DOCKER = process.env.GSTACK_EVALS_DOCKER === "1";
const LONG = 1_800_000;

describe.skipIf(!DOCKER)("eng-review build read in Docker (GSTACK_EVALS_DOCKER=1)", () => {
  let tmp: ReturnType<typeof tempDir>;
  const locks = new Map<string, string>();
  const lock = (pkg: string) => {
    if (!locks.has(pkg)) locks.set(pkg, nodeLock(pkg));
    return locks.get(pkg)!;
  };
  const built = new Map<string, { fx: Fixture; out: BuildOutcome }>();
  const build = (name: string, make: (dir: string) => Fixture) => {
    if (!built.has(name)) {
      const fx = make(join(tmp.dir, name, "repo"));
      built.set(name, { fx, out: buildUnit(fx.spec, fx.repo, join(tmp.dir, name, "unit"), { work: join(tmp.dir, name, "work"), labels: join(tmp.dir, "labels.json"), seed: 7 }) });
    }
    return built.get(name)!;
  };
  /** Grades a build's tree (files changed from base) on a unit's aftermath set and functional set, one run each. */
  const grade = (name: string, files: Record<string, string | null>, runs = 1): { aftermath: Grid; functional: Grid } => {
    const { fx, out } = built.get(name)!;
    const { eb, task } = readUnit(out.dir);
    const patch = patchFrom(fx.repo, fx.sha.base, files);
    const on = (set: (typeof eb.sets)[number], want: string[]) => gradeSet({ taskDir: out.dir, task, eb, set, label: "build", patch, runs, seed: 3, work: join(tmp.dir, name, "work"), want });
    const item = eb.unit.aftermath[0];
    return { aftermath: on(eb.sets.find((s) => s.item === item.item)!, [...item.cases, ...item.anchors]), functional: on(eb.sets[0], eb.unit.functional) };
  };

  beforeAll(() => {
    tmp = tempDir("eb-docker-");
  });
  afterAll(() => {
    removeLabelled();
    tmp?.cleanup();
  });

  test("Go: the unit qualifies with functional, aftermath and anchor cases; the merge's bug fails at assertion level and a fix passes", () => {
    const { out } = build("go", goRepo);
    expect(out.qualifies).toBe(true);
    expect(out.eb.unit.functional).toEqual([".::TestAdd", ".::TestMul"]);
    expect(out.eb.unit.aftermath[0]).toMatchObject({ item: "B1", cases: [".::TestMulZero"], anchors: [".::TestAdd", ".::TestMul"], base: { ".::TestMulZero": "fail" } });
    expect(out.eb.unit.repo).toMatch(/^r[0-9a-f]{12}$/);
    expect(grade("go", { "calc.go": GO_CALC + GO_FIXED }).aftermath[".::TestMulZero"]).toEqual(["pass"]);
    expect(grade("go", { "calc.go": GO_CALC + GO_BUGGY }).aftermath[".::TestMulZero"]).toEqual(["assert"]);
    expect(grade("go", { "calc.go": GO_CALC }).aftermath[".::TestMulZero"]).toEqual(["compile"]);
  }, LONG);

  test("the recount keeps a clean unit clean, and refuses a real tree whose product files changed since the build", () => {
    const { out } = build("go", goRepo);
    expect(recountUnit(out.dir, { work: join(tmp.dir, "go", "work") })).toMatchObject({ clean: true, functional: 2, aftermath: 1 });
    const { eb, task } = readUnit(out.dir);
    const { fx } = built.get("go")!;
    let code = "none";
    try {
      gradeSet({ taskDir: out.dir, task, eb, set: eb.sets[0], label: "merged", patch: patchFrom(fx.repo, fx.sha.base, { "calc.go": GO_CALC + GO_FIXED }), runs: 1, seed: 1, work: join(tmp.dir, "go", "work"), check: true });
    } catch (error) {
      code = error instanceof EbError ? error.code : String(error);
    }
    expect(code).toBe("E_EB_PRODUCT_HASH");
  }, LONG);

  test("the recount prints counts only and refuses under 16 clean units", async () => {
    build("go", goRepo);
    const lines: string[] = [];
    const errs: string[] = [];
    const [log, err] = [console.log, console.error];
    console.log = (s: string) => lines.push(s);
    console.error = (s: string) => errs.push(s);
    try {
      expect(await recount(["--units", join(tmp.dir, "go"), "--work", join(tmp.dir, "go", "work-recount")])).toBe(2);
    } finally {
      console.log = log;
      console.error = err;
    }
    expect(lines[0]).toBe("recount: 1 units read, 1 clean, threshold 16");
    expect(errs[0].startsWith("E_EB_FEW_UNITS 1 clean")).toBe(true);
  }, LONG);

  test("the leak check reads the unit's exact image: the fix's lines are absent, and a line in the image's repository is a leak", () => {
    const { fx, out } = build("go", goRepo);
    const needles = leakNeedles(fx.repo, fx.sha.base, fx.sha.merge, [fx.sha.fix]);
    const runner = out.eb.groups[0].runner;
    expect(leakCheck({ unit: "ebgo", image: out.eb.image.id, repo: fx.spec.repo, runner, needles })).toMatchObject({ leaks: [] });
    let code = "none";
    try {
      leakCheck({ unit: "ebgo", image: out.eb.image.id, repo: fx.spec.repo, runner, needles: ["func Add(a, b int) int {"] });
    } catch (error) {
      code = error instanceof EbError ? error.code : String(error);
    }
    expect(code).toBe("E_EB_LEAK");
  }, LONG);

  test("Python: a case that fails on a missing name or errors in setup on the merge is excluded; the T item joins tCases; the base split is kept", () => {
    const { out } = build("py", pyRepo);
    expect(out.qualifies).toBe(true);
    const a = out.eb.unit.aftermath[0];
    expect(a.cases).toEqual(["tests/test_ops.py::test_scale_negative"]);
    expect(a.anchors).toEqual(["tests/test_ops.py::test_add", "tests/test_ops.py::test_scale"]);
    expect(a.base).toEqual({ "tests/test_ops.py::test_scale_negative": "fail" });
    expect(out.eb.unit.tCases).toEqual(["tests/test_more.py::test_add_more"]);
    expect(grade("py", { "pkg/ops.py": PY_OPS + "\n\ndef scale(x, k=2):\n    return x * k\n" }).aftermath["tests/test_ops.py::test_scale_negative"]).toEqual(["pass"]);
    expect(grade("py", { "pkg/ops.py": PY_OPS }).aftermath["tests/test_ops.py::test_scale_negative"]).toEqual(["missing_name"]);
  }, LONG);

  test("Rust: only the inline test module moves; a build's own fake tests and its cargo config are replaced", () => {
    const { out } = build("rust", rustRepo);
    expect(out.qualifies).toBe(true);
    expect(out.eb.unit.aftermath[0].cases).toEqual(["src/lib.rs::tests::mul_zero"]);
    expect(grade("rust", { "src/lib.rs": RS_ADD + RS_FIXED }).aftermath["src/lib.rs::tests::mul_zero"]).toEqual(["pass"]);
    const fake = RS_ADD + RS_BUGGY + "\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn mul_zero() {}\n}\n";
    const cheat = grade("rust", { "src/lib.rs": fake, ".cargo/config.toml": "[build]\nrustflags = [\"--cfg\", \"cheat\"]\n" });
    expect(cheat.aftermath["src/lib.rs::tests::mul_zero"]).toEqual(["assert"]);
    expect(grade("rust", { "src/lib.rs": RS_ADD + rsTests(["adds"]) }).aftermath["src/lib.rs::tests::mul_zero"]).toEqual(["compile"]);
  }, LONG);

  const NEGATIVE: Record<string, [string, (ext: string) => Record<string, string>]> = {
    jest: ["a tree jest config and package.json key that ignore the tests", () => ({ "jest.config.js": "module.exports = { testPathIgnorePatterns: ['test'] };\n" })],
    vitest: ["a tree vitest and vite config that exclude every test", () => ({ "vitest.config.mjs": "export default { test: { exclude: ['**'] } };\n", "vite.config.mjs": "export default { test: { exclude: ['**'] } };\n" })],
    mocha: ["a tree .mocharc that loads a file faking every assertion", () => ({ ".mocharc.json": '{ "require": ["./hack.cjs"] }\n', "hack.cjs": "require('node:assert').equal = () => {};\n" })],
    nodetest: ["product code that exits 0 at import", (ext) => ({ ["src/calc." + ext]: "export const add = (a, b) => a + b;\nexport const mul = (a, b) => (a === 0 ? b : a * b);\nprocess.exit(0);\n" })],
  };
  for (const runner of ["jest", "vitest", "mocha", "nodetest"]) {
    test(runner + ": an honest build passes the aftermath case, the merge's bug fails it at assertion level, a missing function is not an assertion, and " + NEGATIVE[runner][0] + " does not pass it", () => {
      const { out } = build(runner, (dir) => nodeRepo(dir, runner, lock));
      expect(out.qualifies).toBe(true);
      const file = runner === "mocha" ? "test/calc.spec.js" : "test/calc.test.js";
      const sep = runner === "nodetest" ? " > " : " ";
      const id = file + "::calc" + sep + "mul zero";
      expect(out.eb.unit.aftermath[0].cases).toEqual([id]);
      expect(out.eb.unit.aftermath[0].base).toEqual({ [id]: "fail" });
      expect(out.eb.unit.functional).toEqual([file + "::calc" + sep + "adds", file + "::calc" + sep + "muls"]);
      const ext = runner === "jest" ? "cjs" : "js";
      const js = (s: string) => (runner === "jest" ? s.replace(/^export const (\w+) = /gm, "exports.$1 = ") : s);
      const src = "src/calc." + ext;
      expect(grade(runner, { [src]: js("export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n") }).aftermath[id]).toEqual(["pass"]);
      expect(grade(runner, { [src]: js("export const add = (a, b) => a + b;\nexport const mul = (a, b) => (a === 0 ? b : a * b);\n") }).aftermath[id]).toEqual(["assert"]);
      const missing = grade(runner, { [src]: js("export const add = (a, b) => a + b;\n") }).aftermath[id][0];
      expect(missing).toBe(runner === "mocha" ? "load" : "missing_name");
      const neg = grade(runner, { [src]: js("export const add = (a, b) => a + b;\nexport const mul = (a, b) => (a === 0 ? b : a * b);\n"), ...NEGATIVE[runner][1](ext) });
      expect(neg.aftermath[id]).not.toEqual(["pass"]);
    }, LONG);
  }

  test("jest: the cold rebuild ignores a stale compiled file the build brought and builds from source", () => {
    build("jest", (dir) => nodeRepo(dir, "jest", lock));
    const buggy = "exports.add = (a, b) => a + b;\nexports.mul = (a, b) => (a === 0 ? b : a * b);\n";
    const stale = "exports.add = (a, b) => a + b;\nexports.mul = (a, b) => a * b;\n";
    expect(grade("jest", { "src/calc.cjs": buggy, "dist/calc.cjs": stale }).aftermath["test/calc.test.js::calc mul zero"]).toEqual(["assert"]);
  }, LONG);

  test("Node with Rust: both runner groups grade in one image", () => {
    const { out } = build("noderust", (dir) => nodeRustRepo(dir, lock));
    expect(out.qualifies).toBe(true);
    expect(out.eb.unit.ecosystems).toEqual(["node", "rust"]);
    expect(out.eb.unit.functional).toEqual(["crates/core/src/lib.rs::tests::adds", "crates/core/src/lib.rs::tests::muls", "web/test/calc.test.js::calc > adds", "web/test/calc.test.js::calc > muls"]);
    expect(out.eb.unit.aftermath[0].cases).toEqual(["crates/core/src/lib.rs::tests::mul_zero"]);
  }, LONG);

  test("the screen qualifies a candidate with a live aftermath case and drops one whose fix changes no test", () => {
    const fx = goRepo(join(tmp.dir, "screen", "repo"));
    const r = screenCandidate({ id: "cand1", base: fx.sha.base, merge: fx.sha.merge, fixes: [{ commit: fx.sha.fix, kind: "fix" }] }, fx.repo, { work: join(tmp.dir, "screen", "work") });
    expect(r).toMatchObject({ qualifies: true, code: null, ecosystems: ["go"], functionalPass: 2, f2p: [1], base: { pass: 0, fail: 1, no_result: 0 } });
    const none = screenCandidate({ id: "cand2", base: fx.sha.base, merge: fx.sha.merge, fixes: [{ commit: fx.sha.docs, kind: "fix" }] }, fx.repo, { work: join(tmp.dir, "screen", "work") });
    expect(none).toMatchObject({ qualifies: false, code: "E_EB_NO_AFTERMATH", step: "fix", cls: "no_test_change" });
    expect(removeLabelled()).toEqual({ containers: 0, volumes: 0 });
  }, LONG);
});

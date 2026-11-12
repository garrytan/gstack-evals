// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import type { EntryResult, RunRec } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { aimed, breaksReading, compileBlocked, compileUnit, decideBreaks, isStaticEntry, modelOnlyRed, redOnParent, staticTextFiles, syncGate } from "../../lanes/outcome-skills/pfchecks/secondaries.ts";

const rr = (tree: "parent" | "fix" | "neutral", run: number, pass: boolean, log = ""): RunRec => ({ tree, run, exit: pass ? 0 : 1, pass, timed_out: false, wall_ms: 1, rebuild_failed: false, log });
const red = (command: string, fixLog = ""): EntryResult => ({ index: 0, command, outcome: "no_catch", why: "", runs: [rr("parent", 1, false), rr("parent", 2, false), rr("parent", 3, false), rr("fix", 1, false, fixLog)] });
test("red on parent and model-only red", () => {
  expect(redOnParent([red("go test")])).toBe(true);
  expect(modelOnlyRed([red("java -cp t.jar tlc2.TLC M.tla"), red("go test")])).toEqual([0]);
});
test("aimed, breaks, static text and sync gate", () => {
  expect(aimed([{ path: "a_test.go", text: "see conn/state.go" }], ["conn/state.go"])).toBe(true);
  expect(aimed([{ path: "a_test.go", text: "nothing" }], ["conn/state.go"])).toBe(false);
  expect(decideBreaks(["s1", "s2"], [{ s1: "pass", s2: "fail" }, { s1: "pass", s2: "fail" }, { s1: "fail", s2: "pass" }])).toEqual(["s2"]);
  const files = staticTextFiles([{ path: "src_test.go", text: 'os.ReadFile("../conn/state.go")' }, { path: "b_test.go", text: '"state"' }], new Set(["state.go"]));
  expect(files).toEqual(["src_test.go"]);
  expect(isStaticEntry("grep -q 'x = 1' conn/state.go", [])).toBe(true);
  expect(isStaticEntry("go test -run src_test", files)).toBe(true);
  expect(isStaticEntry("go test ./conn", files)).toBe(false);
  expect(syncGate(red("bash check.sh", "error: model is stale, run sync"))).toBe(true);
  expect(syncGate(red("bash check.sh", "assertion failed"))).toBe(false);
});
test("breaks: a broken build, a real regression and two stopped runs count; a test the parser loses in one or two runs does not", () => {
  expect(decideBreaks(["s"], [{}, {}, {}])).toEqual(["s"]);
  expect(decideBreaks(["s"], [{ s: "fail" }, { s: "fail" }, { s: "fail" }])).toEqual(["s"]);
  expect(decideBreaks(["s"], [{ s: "fail" }, { s: "fail" }, { s: "pass" }])).toEqual(["s"]);
  expect(decideBreaks(["s"], [null, null, { s: "pass" }])).toEqual(["s"]);
  expect(decideBreaks(["s"], [{ s: "skip" }, { s: "skip" }, { s: "pass" }])).toEqual(["s"]);
  expect(decideBreaks(["s"], [{}, { s: "pass" }, { s: "pass" }])).toEqual([]);
  expect(decideBreaks(["s"], [{}, {}, { s: "pass" }])).toEqual([]);
  expect(decideBreaks(["s"], [{}, { s: "fail" }, { s: "pass" }])).toEqual([]);
});
test("breaks after a skipped fix test patch: a test no run reports counts neither way; a run stopped at a patch step or after a skip is not measured", () => {
  expect(decideBreaks(["s", "t"], [{ t: "pass" }, { t: "pass" }, { t: "pass" }], true)).toEqual([]);
  expect(decideBreaks(["s", "t"], [{ t: "pass" }, { t: "pass" }, { t: "pass" }])).toEqual(["s"]);
  expect(decideBreaks(["t"], [{ t: "fail" }, { t: "fail" }, { t: "pass" }], true)).toEqual(["t"]);
  expect(breaksReading(["s"], { runs: [{}, {}, {}], skipped: [], unmeasured: null })).toEqual(["s"]);
  expect(breaksReading(["s", "t"], { runs: [{ t: "pass" }, { t: "pass" }, { t: "pass" }], skipped: ["test.patch"], unmeasured: null })).toEqual([]);
  expect(breaksReading(["s"], { runs: [{ s: "pass" }, {}, { s: "pass" }], skipped: ["test.patch"], unmeasured: "run 2 built nothing (rebuild_failed) after skipping test.patch" })).toBeNull();
  expect(breaksReading(["s"], { runs: [null, null, null], skipped: [], unmeasured: "run 1 stopped at the test.patch patch step" })).toBeNull();
});
test("compile-blocked drops the other agent-added files of the blocking file's compile unit", () => {
  const t = new Set(["Cargo.toml", "src/lib.rs", "tests/a.rs", "tests/b.rs", "sub/Cargo.toml", "sub/tests/c.rs"]);
  expect(compileUnit("rust", "sub/tests/c.rs", t)).toBe("sub");
  expect(compileUnit("go", "pkg/x_test.go", t)).toBe("pkg");
  expect(compileUnit("ts", "a.test.ts", t)).toBeNull();
  const e = red("cargo test --test a", "error[E0425]: cannot find value `x`\n --> tests/b.rs:3:5");
  expect(compileBlocked("rust", e, ["tests/a.rs", "tests/b.rs", "sub/tests/c.rs"], t)).toEqual(["tests/b.rs"]);
  expect(compileBlocked("rust", red("cargo test --test a", "assertion failed"), ["tests/a.rs", "tests/b.rs"], t)).toBeNull();
});

test("Go: a static-text test file run through its package dir is a static-text entry", () => {
  const files = ["pfcheck/static/static_test.go"];
  expect(isStaticEntry("go test ./pfcheck/static/ -run TestPFStatic", files, "go")).toBe(true);
  expect(isStaticEntry("go test -count=1 ./pfcheck/...", files, "go")).toBe(true);
  expect(isStaticEntry("go test ./...", files, "go")).toBe(true);
  expect(isStaticEntry("go test ./pfcheck/replay/", files, "go")).toBe(false);
  expect(isStaticEntry("cargo test ./pfcheck/static/", files, "rust")).toBe(false);
});
test("Go: compiler lines with a column and [build failed] count as compile errors", () => {
  const t = new Set(["go.mod", "pfcheck/pkg/a_test.go", "pfcheck/pkg/broken_test.go"]);
  const added = ["pfcheck/pkg/a_test.go", "pfcheck/pkg/broken_test.go"];
  const log = "# example.com/m/pfcheck/pkg [example.com/m/pfcheck/pkg.test]\npfcheck/pkg/broken_test.go:8:6: undefined: OldName\nFAIL\texample.com/m/pfcheck/pkg [build failed]";
  expect(compileBlocked("go", red("go test -run TestA pfcheck/pkg/a_test.go", log), added, t)).toEqual(["pfcheck/pkg/broken_test.go"]);
  expect(compileBlocked("go", red("go test -run TestA pfcheck/pkg/a_test.go", "    broken_test.go:12: want 1, got 2\nFAIL"), added, t)).toBeNull();
});
test("Go: an entry run through its package dir keeps its own test file when another file blocks the build", () => {
  const t = new Set(["go.mod", "pfcheck/pkg/a_test.go", "pfcheck/pkg/broken_test.go"]);
  const added = ["pfcheck/pkg/a_test.go", "pfcheck/pkg/broken_test.go"];
  const log = "# example.com/m/pfcheck/pkg [example.com/m/pfcheck/pkg.test]\npfcheck/pkg/broken_test.go:8:6: undefined: OldName\nFAIL\texample.com/m/pfcheck/pkg [build failed]";
  expect(compileBlocked("go", red("go test -count=1 ./pfcheck/pkg/ -run TestA", log), added, t)).toEqual(["pfcheck/pkg/broken_test.go"]);
  expect(compileBlocked("go", red("go test pfcheck/pkg", log), added, t)).toEqual(["pfcheck/pkg/broken_test.go"]);
  expect(compileBlocked("go", red("go test ./pfcheck/...", log), added, t)).toEqual(added);
});

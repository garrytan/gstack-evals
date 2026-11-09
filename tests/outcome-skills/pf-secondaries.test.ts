// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import type { EntryResult, RunRec } from "../../lanes/outcome-skills/pfchecks/runner.ts";
import { aimed, compileBlocked, compileUnit, decideBreaks, isStaticEntry, modelOnlyRed, redOnParent, staticTextFiles, syncGate } from "../../lanes/outcome-skills/pfchecks/secondaries.ts";

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
test("compile-blocked drops the other agent-added files of the blocking file's compile unit", () => {
  const t = new Set(["Cargo.toml", "src/lib.rs", "tests/a.rs", "tests/b.rs", "sub/Cargo.toml", "sub/tests/c.rs"]);
  expect(compileUnit("rust", "sub/tests/c.rs", t)).toBe("sub");
  expect(compileUnit("go", "pkg/x_test.go", t)).toBe("pkg");
  expect(compileUnit("ts", "a.test.ts", t)).toBeNull();
  const e = red("cargo test --test a", "error[E0425]: cannot find value `x`\n --> tests/b.rs:3:5");
  expect(compileBlocked("rust", e, ["tests/a.rs", "tests/b.rs", "sub/tests/c.rs"], t)).toEqual(["tests/b.rs"]);
  expect(compileBlocked("rust", red("cargo test --test a", "assertion failed"), ["tests/a.rs", "tests/b.rs"], t)).toBeNull();
});

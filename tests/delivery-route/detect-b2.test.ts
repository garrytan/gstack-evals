// Copyright (c) 2026 Garry Tan. MIT License.
// B2's reading of the followed detector (lanes/delivery-route/detect.ts, detect(..., { rules: "b2" }), B2 preregistration
// section 6.3): a Bash call is read per command for its passing run also when its runners and summaries don't pair one to
// one; a command that prints a file it names (cat, tail, head, less, or rg or grep of a log) never supplies a runner's
// summary; and a runner started through xargs, find -exec or parallel is not paired per command. The default stays B1's.
import { describe, expect, test } from "bun:test";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { detect } from "../../lanes/delivery-route/detect.ts";

type Step = { name: string; input: Record<string, unknown>; result: string; error?: boolean };
function log(steps: Step[], cwd = "/testbed") {
  const lines = [{ type: "SystemMessage", subtype: "init", init: { cwd, tools: ["Bash", "Read", "Write", "Edit"], skills: [] } }];
  steps.forEach((s, i) => {
    lines.push({ type: "AssistantMessage", content: [{ id: "t" + i, name: s.name, input: s.input }] } as any);
    lines.push({ type: "UserMessage", content: [{ tool_use_id: "t" + i, content: s.result, is_error: s.error ?? false }] } as any);
  });
  lines.push({ type: "AssistantMessage", content: [{ text: "Done.\nSTATUS: FIXED" }] } as any);
  return parseLog(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const diff = (...files: string[]) => files.map((f) => "diff --git a/" + f + " b/" + f + "\n--- a/" + f + "\n+++ b/" + f + "\n@@ -1 +1 @@\n-x\n+y\n").join("");
const TEST = "/testbed/tests/test_mod.py";
const write = (path: string) => ({ name: "Write", input: { file_path: path, content: "def test_x():\n    assert f() == 1\n" }, result: "File created successfully at: " + path });
const edit = (path: string) => ({ name: "Edit", input: { file_path: path, old_string: "a", new_string: "b" }, result: "The file " + path + " has been updated successfully." });
const bash = (command: string, result: string, error = false) => ({ name: "Bash", input: { command }, result, error });
const FAILED = "F                                                                        [100%]\n=================================== FAILURES ===================================\n" + TEST.slice(9) + ":2: AssertionError\n=========================== short test summary info ============================\nFAILED tests/test_mod.py::test_x - assert 0 == 1\n1 failed in 0.02s";
const PATCH = diff("pkg/mod.py", "tests/test_mod.py");
const failing = bash("pytest tests/test_mod.py", FAILED, true);
/** A session that writes the test, sees it fail, fixes the source and ends with the given call; read both ways. */
const after = (command: string, result: string, error = true) => {
  const recs = log([write(TEST), failing, edit("/testbed/pkg/mod.py"), bash(command, result, error)]);
  return { b1: detect(recs, PATCH), b2: detect(recs, PATCH, undefined, { rules: "b2" }) };
};
const read = (command: string, result: string, error = true) => { const { b1, b2 } = after(command, result, error); return [b1.followed, b2.followed_b2]; };

describe("the option leaves B1's reading as it was", () => {
  test("without it detect returns no b2 field, and with it the B1 fields are the same", () => {
    const { b1, b2 } = after("pytest -q tests/test_mod.py; grep -n TODO pkg/mod.py", "1 passed in 0.01s", true);
    expect("followed_b2" in b1).toBe(false);
    const { followed_b2, ...rest } = b2;
    expect([rest, typeof followed_b2]).toEqual([b1, "boolean"]);
  });
});

describe("rule a: a passing run is read per command beside commands that print no summary of their own", () => {
  test("a passing run chained with grep, a python -c check, a linter and another suite in one call counts", () => {
    expect(read("pytest -q tests/test_mod.py; grep -n TODO pkg/mod.py", "1 passed in 0.01s")).toEqual([false, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; python -c 'import pkg.mod as m; assert m.add(1, 1) == 3'", "1 passed in 0.01s\nTraceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nAssertionError")).toEqual([false, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; ruff check pkg", "1 passed in 0.01s\n/bin/bash: line 1: ruff: command not found")).toEqual([true, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; pytest -q tests/ | tail -2", "1 passed in 0.01s\nFAILED tests/test_other.py::test_y - assert 1\n1 failed, 3 passed in 0.20s")).toEqual([true, true]);
    const all = "pytest -q tests/test_mod.py | tail -1; grep -n TODO pkg/mod.py; python -c 'import pkg.mod'; ruff check pkg; mypy pkg; pytest -q tests/other | tail -1";
    expect(read(all, "1 passed in 0.01s\n/bin/bash: line 1: ruff: command not found\npkg/mod.py:3: error: Missing return\nFound 1 error in 1 file\n1 failed in 0.30s")).toEqual([false, true]);
  });
  test("a runner that ends with pytest's no-tests line keeps its place, so the summaries still split by command order", () => {
    expect(read("pytest -q tests/missing.py; pytest -q tests/test_mod.py | tail -1; ruff check pkg", "ERROR: file or directory not found: tests/missing.py\n\nno tests ran in 0.00s\n1 passed in 0.01s\nruff: command not found")).toEqual([false, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; pytest -q tests/missing.py; ruff check pkg", "1 failed in 0.02s\nERROR: file or directory not found: tests/missing.py\n\nno tests ran in 0.00s\nruff: command not found")).toEqual([false, false]);
  });
  test("each runner's failures are read in its own block: a pass, then a rerun with the fix stashed that fails, counts the pass", () => {
    const c = "pytest -q tests/test_mod.py -k x | tail -3; git stash; pytest -q tests/test_mod.py -k x | tail -3; git stash pop";
    expect(read(c, "1 passed, 9 deselected in 0.10s\nSaved working directory and index state WIP on main: 1a2b3c4 base\nFAILED tests/test_mod.py::test_x - assert 0 == 1\n1 failed, 9 deselected in 0.10s")).toEqual([false, true]);
    expect(read("pytest -q tests/test_mod.py -k x | tail -3; git stash; pytest -q tests/test_mod.py -k x | tail -3", "FAILED tests/test_mod.py::test_x - assert 0 == 1\n1 passed, 1 failed, 9 deselected in 0.10s\nSaved working directory\n1 failed, 9 deselected in 0.10s")).toEqual([false, false]);
  });
  test("the selected test's own failing summary beside another runner's pass is not a passing run", () => {
    expect(read("pytest -q tests/test_mod.py | tail -1; grep -n x pkg/mod.py; pytest -q tests/test_other.py | tail -1", "1 failed in 0.02s\n3:x = 1\n3 passed in 0.10s")).toEqual([false, false]);
    expect(read("python -m unittest tests.test_other; python -c 'print(1)'; python -m unittest tests.test_mod", "...\nRan 3 tests in 0.001s\n\nOK\n1\nF\nRan 1 test in 0.001s\n\nFAILED (failures=1)")).toEqual([false, false]);
  });
  test("a call whose output can't be split by command falls back to the rule as merged, in both directions", () => {
    // A script that may run tests itself, a loop, tox and a command named by a variable leave the call to be read whole.
    for (const [c, out] of [["python scripts/check.py; pytest -q tests/test_mod.py | tail -1; ruff check pkg", "2 passed in 0.10s\n1 failed in 0.02s"], ["for t in a b; do pytest -q $t | tail -1; done; pytest -q tests/test_mod.py | tail -1; ruff", "3 passed in 0.10s\n2 passed in 0.10s\n1 passed in 0.01s"], ["tox -e py311 -- tests/test_mod.py; ruff check pkg", "1 passed in 0.10s\npy311: commands succeeded"], ['"$RUN" tests; pytest -q tests/test_mod.py | tail -1; ruff', "1 passed in 0.01s"]] as const)
      expect([c, read(c, out)]).toEqual([c, [false, false]]);
    expect(read("python scripts/check.py && pytest -q tests/test_mod.py", "2 passed in 0.10s\n1 passed in 0.01s", false)).toEqual([true, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1 & pytest -q tests/test_other.py | tail -1", "3 passed in 0.10s\n1 failed in 0.20s")).toEqual([false, false]);
  });
  test("B1's D1 cases read the same under b2", () => {
    const own = after("sed -i 's/a/b/' pkg/mod.py; git diff pkg/; pytest -q tests/ 2>&1 | tail -3; ruff check pkg tests/test_mod.py; ruff format --check pkg", "Exit code 127\ndiff --git a/pkg/mod.py b/pkg/mod.py\n178 passed in 6.21s\n/bin/bash: line 1: ruff: command not found");
    expect([own.b1.followed, own.b2.followed_b2]).toEqual([true, true]);
    expect(read("pytest -q tests/test_mod.py && pytest -q", "1 passed in 0.16s\nFAILED tests/test_other.py::test_y - assert 1\n1 failed, 9649 passed in 20.85s")).toEqual([true, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; ruff check pkg", "0 passed in 0.10s\nruff: command not found")).toEqual([false, false]);
    expect(read("source .venv/bin/activate && cd /testbed && PYTHONPATH=. timeout 600 python -m pytest -q tests/test_mod.py 2>&1 | tail -1; git diff --stat; ruff check pkg", "1 passed in 0.01s\n pkg/mod.py | 2 +-\nruff: command not found")).toEqual([true, true]);
  });
});

describe("rule b: a command that prints a file it names is never a runner's summary", () => {
  test("| cat old.log, a head-cut run beside cat or rg of a log, and a runner sent to a log and tailed supply no pass", () => {
    expect(read("pytest -q tests/test_mod.py | cat /tmp/old.log", "1 passed in 0.01s", false)).toEqual([true, false]);
    expect(read("pytest -q tests/test_mod.py | head -1; rg passed /tmp/old.log", "F\n1 passed in 0.01s", false)).toEqual([true, false]);
    expect(read("pytest -q tests/test_mod.py | head -1; cat /tmp/earlier.log; ruff check pkg", "F\n1 passed in 0.01s\nruff: command not found")).toEqual([false, false]);
    expect(read("pytest -q tests/test_mod.py > /tmp/run.log 2>&1; tail -1 /tmp/run.log", "1 passed in 0.01s", false)).toEqual([true, false]);
    expect(read("pytest -q tests/test_mod.py | tail -1; less run.out", "1 passed in 0.01s", false)).toEqual([true, false]);
  });
  test("printing a source file or searching source beside the run still counts", () => {
    expect(read("pytest -q tests/test_mod.py | tail -1; cat pkg/mod.py", "1 passed in 0.01s\ndef add(a, b):\n    return a + b", false)).toEqual([true, true]);
    expect(read("pytest -q tests/test_mod.py | tail -1; grep -rn 'def add' pkg/; head -3 tests/test_mod.py", "1 passed in 0.01s\npkg/mod.py:1:def add(a, b):\ndef test_x():", false)).toEqual([true, true]);
  });
  test("a background run read later through tail of its output file is read as B1 reads it", () => {
    const launch = { ...bash("pytest tests/", "Command running in background with ID: bg2. Output is being written to: /tmp/tasks/bg2.output"), input: { command: "pytest tests/", run_in_background: true } };
    const recs = log([write(TEST), failing, edit("/testbed/pkg/mod.py"), launch, bash("tail -3 /tmp/tasks/bg2.output", "3 passed in 0.1s")]);
    expect([detect(recs, PATCH).followed, detect(recs, PATCH, undefined, { rules: "b2" }).followed_b2]).toEqual([true, true]);
  });
});

describe("rule c: a runner started through xargs, find -exec or parallel is not paired per command", () => {
  test("beside a failing linter none passes per command, while the same runner started directly does", () => {
    // B1's D1 reads the xargs runner as one plain run (the hole its results name); b2 does not.
    for (const [c, b1] of [["echo tests/test_mod.py | xargs pytest -q; ruff check pkg", true], ["find tests -name test_mod.py -exec pytest -q {} \\; ; ruff check pkg", false], ["parallel pytest -q ::: tests/test_mod.py; ruff check pkg", false]] as const)
      expect([c, read(c, "1 passed in 0.01s\nruff: command not found")]).toEqual([c, [b1, false]]);
    expect(read("pytest -q tests/test_mod.py; ruff check pkg", "1 passed in 0.01s\nruff: command not found")).toEqual([true, true]);
  });
  test("such a call falls back to the rule as merged, so a green one still passes", () => {
    expect(read("echo tests/test_mod.py | xargs pytest -q", "1 passed in 0.01s", false)).toEqual([true, true]);
  });
});

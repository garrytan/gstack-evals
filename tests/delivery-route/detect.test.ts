// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route detector (lanes/delivery-route/detect.ts) on built transcripts in Lane B's SDK record shape: the cases
// the scripted sessions can't reach (a folder run, a dotted-module run, a scratch script outside the patch, an unread
// background run, a source edit through an inline script, a source change no write explains) and the patch reader.
import { describe, expect, test } from "bun:test";
import { parseLog } from "../../quick/laneb/l1/probes.ts";
import { detect, modifiedFiles } from "../../lanes/delivery-route/detect.ts";

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
const write = (path: string) => ({ name: "Write", input: { file_path: path, content: "def test_x():\n    assert f() == 1\n" }, result: "File created successfully at: " + path });
const edit = (path: string) => ({ name: "Edit", input: { file_path: path, old_string: "a", new_string: "b" }, result: "The file " + path + " has been updated successfully." });
const bash = (command: string, result: string, error = false) => ({ name: "Bash", input: { command }, result, error });
const FAILED = "F\n=========================== 1 failed in 0.02s ===========================";
const PASSED = "=========================== 1 passed in 0.01s ===========================";
const PATCH = diff("pkg/mod.py", "tests/test_mod.py");

describe("which runs cover the test", () => {
  test("a pytest run of the test's folder covers it, before and after the source edit", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("pytest tests/", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/ -q", PASSED)]), PATCH);
    expect([d.followed, d.followed_tool_only, d.test_file, d.fix_files]).toEqual([true, true, "/testbed/tests/test_mod.py", ["/testbed/pkg/mod.py"]]);
  });
  test("a dotted module names the test file, and a selection of a test inside it", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("python -m unittest tests.test_mod.T.test_x", "Exit code 1\nFAILED (failures=1)", true), edit("/testbed/pkg/mod.py"), bash("python -m unittest tests.test_mod", "Ran 1 test in 0.001s\n\nOK")]), PATCH);
    expect(d.followed).toBe(true);
  });
  test("a run of another file does not cover the test", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("pytest other/test_b.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.test_before_source, d.failing_before_source, d.passing_after_source, d.followed]).toEqual([true, false, true, false]);
  });
  test("a bare pytest run covers every test", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("cd /testbed && pytest -x -k mod", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest", PASSED)]), PATCH);
    expect(d.followed).toBe(true);
  });
});

describe("what counts as the test and the fix", () => {
  test("a scratch script that is not a test path is not the test, and is not a source file", () => {
    const d = detect(log([write("/testbed/repro.py"), bash("python repro.py", "Traceback\nAssertionError", true), edit("/testbed/pkg/mod.py"), bash("python repro.py", "ok")]), diff("pkg/mod.py"));
    expect([d.followed, d.test_before_source, d.fix_files]).toEqual([false, false, ["/testbed/pkg/mod.py"]]);
  });
  test("a test written after the source edit is not test-first", () => {
    const d = detect(log([edit("/testbed/pkg/mod.py"), write("/testbed/tests/test_mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.test_before_source, d.test_file]).toEqual([false, false, null]);
  });
  test("a source edit through an inline script counts, as a Bash-only write the tool-only reading misses", () => {
    const heredoc = "python3 - <<'EOF'\nfrom pathlib import Path\np = Path('pkg/mod.py')\np.write_text(p.read_text().replace('a', 'b'))\nEOF";
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /testbed && " + heredoc, ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.followed_tool_only, d.bash_only_source, d.source_write_unseen]).toEqual([true, false, true, false]);
  });
  test("a source change that no write explains is reported, and the session does not follow", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("pytest tests/test_mod.py", FAILED, true), bash("make fix", ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.source_write_unseen, d.source_changed]).toEqual([false, true, true]);
  });
  test("docs and config in the patch are never the fix", () => {
    const d = detect(log([edit("/testbed/README.md")]), diff("README.md", "setup.cfg"));
    expect([d.source_changed, d.fix_files]).toEqual([false, []]);
  });
});

describe("background runs", () => {
  const NOTICE = "Command running in background with ID: bg1. Output is being written to: /tmp/tasks/bg1.output";
  test("a background run is seen where its output is read", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), { ...bash("pytest tests/", NOTICE), input: { command: "pytest tests/", run_in_background: true } }, { name: "Read", input: { file_path: "/tmp/tasks/bg1.output" }, result: FAILED }, edit("/testbed/pkg/mod.py"), bash("pytest tests/", PASSED)]), PATCH);
    expect([d.followed, d.unread_background]).toEqual([true, 0]);
  });
  test("a background run never read is counted and shows nothing", () => {
    const d = detect(log([write("/testbed/tests/test_mod.py"), { ...bash("pytest tests/", NOTICE), input: { command: "pytest tests/", run_in_background: true } }, edit("/testbed/pkg/mod.py"), bash("pytest tests/", PASSED)]), PATCH);
    expect([d.followed, d.failing_before_source, d.unread_background]).toEqual([false, false, 1]);
  });
});

test("modifiedFiles keeps files named on both sides and drops added and deleted ones", () => {
  const p = diff("a.py") + "diff --git a/new.py b/new.py\nnew file mode 100644\n--- /dev/null\n+++ b/new.py\n@@ -0,0 +1 @@\n+x\n" + "diff --git a/AGENTS.md b/AGENTS.md\ndeleted file mode 100644\n--- a/AGENTS.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
  expect(modifiedFiles(p)).toEqual(["a.py"]);
});

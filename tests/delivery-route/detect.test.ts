// Copyright (c) 2026 Garry Tan. MIT License.
// The delivery route detector (lanes/delivery-route/detect.ts) on built transcripts in Lane B's SDK record shape: the cases
// the scripted sessions can't reach (a folder run, a dotted-module run, a scratch script outside the patch, an unread
// background run, a source edit through an inline script, a source change no write explains), every common Bash write form
// in both directions (a source edit made through it before or after the test, and a test written through it), commands that
// only read, writes no parser can name, and the patch reader.
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

const SRC = "def f():\n    return 1\n";
const UNIFIED = "--- a/pkg/mod.py\n+++ b/pkg/mod.py\n@@ -1 +1 @@\n-x\n+y\n";
const put = (path: string, content: string) => ({ name: "Write", input: { file_path: path, content }, result: "File created successfully at: " + path });
/** Each Bash form a session can edit pkg/mod.py through, as the tool calls that make the edit. */
const FORMS: Record<string, Step[]> = {
  "sed -i": [bash("cd /testbed && sed -i 's/a/b/' pkg/mod.py", "")],
  "a redirect": [bash("printf 'def f():\\n    return 1\\n' > /testbed/pkg/mod.py", "")],
  "a heredoc": [bash("cd /testbed && cat > pkg/mod.py <<'EOF'\n" + SRC + "EOF", "")],
  "a python one-liner": [bash("cd /testbed && python3 -c \"from pathlib import Path; p = Path('pkg/mod.py'); p.write_text(p.read_text().replace('a', 'b'))\"", "")],
  "a node one-liner": [bash("cd /testbed && node -e \"require('fs').writeFileSync('pkg/mod.py', 'x = 1\\n')\"", "")],
  "git apply of a heredoc": [bash("cd /testbed && git apply <<'EOF'\n" + UNIFIED + "EOF", "")],
  "git apply of a patch file the session wrote": [put("/tmp/fix.patch", UNIFIED), bash("cd /testbed && git apply /tmp/fix.patch", "")],
  "patch reading a file the session wrote": [put("/tmp/fix.diff", UNIFIED), bash("cd /testbed && patch -p1 < /tmp/fix.diff", "patching file pkg/mod.py")],
  "cp over the source file": [bash("cp /tmp/mod.py /testbed/pkg/mod.py", "")],
  "mv over the source file": [bash("cd /testbed && mv pkg/mod.py.new pkg/mod.py", "")],
  "cp into the source folder": [bash("cd /testbed && cp /tmp/build/mod.py pkg/", "")],
  "dd": [bash("cd /testbed && dd if=/tmp/mod.py of=pkg/mod.py", "")],
  "a python script the session wrote": [put("/tmp/fix.py", "from pathlib import Path\np = Path('/testbed/pkg/mod.py')\np.write_text('x = 1\\n')\n"), bash("python3 /tmp/fix.py", "")],
  "a shell script the session wrote": [put("/tmp/fix.sh", "sed -i 's/a/b/' pkg/mod.py\n"), bash("cd /testbed && bash /tmp/fix.sh", "")],
};
const TEST = "/testbed/tests/test_mod.py";

describe("Bash write forms, both directions", () => {
  for (const [form, steps] of Object.entries(FORMS)) {
    test("a source edit through " + form + " after a failing test is test-first, and only Bash saw it", () => {
      const d = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), ...steps, bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      expect([d.followed, d.followed_tool_only, d.bash_only_source, d.source_write_unseen, d.unresolved_writes]).toEqual([true, false, true, false, 0]);
    });
    test("a source edit through " + form + " before the test is not test-first", () => {
      const d = detect(log([...steps, write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      expect([d.followed, d.test_before_source, d.bash_only_source]).toEqual([false, false, true]);
    });
  }
  const TESTS: Record<string, Step[]> = {
    "a heredoc": [bash("mkdir -p /testbed/tests && cat > " + TEST + " <<'EOF'\ndef test_x():\n    assert f() == 1\nEOF", "")],
    "cp": [bash("cp /tmp/test_mod.py /testbed/tests/test_mod.py", "")],
    "a python one-liner": [bash("python3 -c \"open('/testbed/tests/test_mod.py', 'w').write('def test_x():\\n    assert f() == 1\\n')\"", "")],
  };
  for (const [form, steps] of Object.entries(TESTS)) {
    test("a test written through " + form + " counts as the test, before the source edit and not after it", () => {
      const first = detect(log([...steps, bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      const late = detect(log([edit("/testbed/pkg/mod.py"), ...steps, bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      expect([first.followed, first.test_file, late.followed, late.test_before_source]).toEqual([true, TEST, false, false]);
    });
  }
  test("commands that only read the source file are never a write to it", () => {
    const reads = ["cat pkg/mod.py", "sed -n '1,20p' pkg/mod.py", "grep -n 'def f' pkg/mod.py", "git diff pkg/mod.py", "git show HEAD:pkg/mod.py", "git apply --check /tmp/fix.patch",
      "python3 -c \"print(open('pkg/mod.py').read())\"", "node -e \"console.log(require('fs').readFileSync('pkg/mod.py', 'utf8'))\"", "cp pkg/mod.py /tmp/mod.bak", "head -5 pkg/mod.py > /tmp/head.txt",
      "sed 's/a/b/' pkg/mod.py > /tmp/mod.out", "diff pkg/mod.py /tmp/mod.bak", "python -m pytest tests/ 2>&1 | tail -5", "awk '{print}' pkg/mod.py | wc -l"].map((c) => bash("cd /testbed && " + c, "x"));
    const d = detect(log([...reads, write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.followed_tool_only, d.bash_only_source, d.unresolved_writes]).toEqual([true, true, false, 0]);
  });
});

describe("writes no parser can name", () => {
  const OPEN = ["for f in pkg/*.py; do sed -i 's/a/b/' \"$f\"; done", "echo 'x = 1' > \"$OUT\"", "sed -i 's/a/b/' pkg/*.py", "find . -name '*.py' -exec sed -i 's/a/b/' {} +",
    "git ls-files '*.py' | xargs sed -i 's/a/b/'", "git apply /tmp/never-seen.patch", "cp /tmp/mod.py \"$DEST\"", "python3 -c \"import sys; p = sys.argv[1]; open(p, 'w').write('x')\" pkg/mod.py",
    "node -e \"const f = process.argv[1]; require('fs').writeFileSync(f, 'x')\" pkg/mod.py", "python3 - <<'EOF'\nfor name in ['pkg/mod.py']:\n    open(name, 'w').write('x')\nEOF"];
  test("each is counted once per Bash call, and a session whose only source write is one of them has no source write seen", () => {
    for (const c of OPEN) {
      const d = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /testbed && " + c, ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      expect([c, d.unresolved_writes]).toEqual([c, 1]);
    }
    const loop = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /testbed && " + OPEN[0], ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([loop.followed, loop.source_write_unseen]).toEqual([false, true]);
  });
  test("an inline write whose path is a variable is still read as writing the file the command names (the head-to-head's rule), and is counted", () => {
    const d = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /testbed && " + OPEN[7], ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.bash_only_source, d.unresolved_writes]).toEqual([true, true, 1]);
  });
  test("a write whose name is open but whose folder is outside the tree, or a /dev path, is not counted", () => {
    const outside = ["for f in a b; do python run.py \"$f\" > /tmp/shim/$(basename $f).log; done", "cd /tmp/repro && cat > $D/x.json <<'EOF'\n{}\nEOF", "sed -i 's/a/b/' /dev/null",
      "cd /tmp/work && cp -r /tmp/schemas $D", "find /tmp/out -name '*.py' -exec sed -i 's/a/b/' {} +", "cd /tmp && for f in t1 t2; do cp $f.py ${f}x.py; done"];
    for (const c of outside) expect([c, detect(log([bash("cd /testbed && " + c, "")]), PATCH).unresolved_writes]).toEqual([c, 0]);
  });
  test("a session with several counts each Bash call once", () => {
    const d = detect(log([write(TEST), ...OPEN.slice(0, 3).map((c) => bash("cd /testbed && " + c, "")), bash("cd /testbed && " + OPEN[3] + " && " + OPEN[1], "")]), PATCH);
    expect(d.unresolved_writes).toBe(4);
  });
});

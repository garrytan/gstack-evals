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
/** pytest -q's report of a failing test, as it prints it: the progress line, the traceback's frame line and the short summary. */
const failedIn = (file: string) => "F                                                                        [100%]\n=================================== FAILURES ===================================\n____________________________________ test_x ____________________________________\n\n    def test_x():\n>       assert f() == 1\nE       assert 0 == 1\n\n" + file + ":2: AssertionError\n=========================== short test summary info ============================\nFAILED " + file + "::test_x - assert 0 == 1\n1 failed in 0.02s";
const FAILED = failedIn("tests/test_mod.py");
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
    const d = detect(log([write("/testbed/tests/test_mod.py"), bash("pytest other/test_b.py", failedIn("other/test_b.py"), true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
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

describe("spec folders", () => {
  test("a source package named spec is source, and a session that writes into it is flagged", () => {
    const d = detect(log([edit("/testbed/src/pkg/spec/namespace.py"), write(TEST), bash("pytest tests/test_mod.py", PASSED)]), diff("src/pkg/spec/namespace.py", "tests/test_mod.py"));
    expect([d.fix_files, d.test_file, d.followed, d.spec_folder_write]).toEqual([["/testbed/src/pkg/spec/namespace.py"], null, false, true]);
  });
  test("a helper under spec/ written before the test is flagged, through a tool or through Bash", () => {
    for (const helper of [edit("/testbed/spec/support/helpers.py"), bash("cd /testbed && cat > spec/spec_helper.rb <<'EOF'\nrequire 'x'\nEOF", "")]) {
      const d = detect(log([helper, write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
      expect([d.followed, d.spec_folder_write]).toEqual([true, true]);
    }
  });
  test("a file named as a spec is a test and is not flagged, and a session with no spec folder is not flagged", () => {
    const named = detect(log([write("/testbed/spec/models/user_spec.rb"), bash("rspec spec/models/user_spec.rb", "1 example, 1 failure", true), edit("/testbed/app/user.rb"), bash("rspec spec/models/user_spec.rb", "1 example, 0 failures\nRan 1 test")]), diff("app/user.rb"));
    expect([named.test_file, named.spec_folder_write]).toEqual(["/testbed/spec/models/user_spec.rb", false]);
    expect(detect(log([write(TEST), edit("/testbed/pkg/mod.py")]), PATCH).spec_folder_write).toBe(false);
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

describe("the failing run is a run of the test that fails", () => {
  const before = (run: Step) => detect(log([write(TEST), run, edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
  test("a grep that finds nothing, a lint error and a cat that prints an assertion name the test but are no failing run", () => {
    const runs = [bash("grep -n missing tests/test_mod.py", "Exit code 1", true), bash("ruff check tests/test_mod.py", "Exit code 1\ntests/test_mod.py:1:8: F401 [*] `os` imported but unused\nFound 1 error.", true),
      bash("cat tests/test_mod.py", "import pytest\n\ndef test_x():\n    with pytest.raises(AssertionError):\n        f()\n"), bash("python -c 'import tests.test_mod'", "Exit code 1\nModuleNotFoundError: No module named 'pkg.new'", true)];
    for (const r of runs) expect([r.input.command, before(r).failing_before_source]).toEqual([r.input.command, false]);
  });
  test("a suite run that fails only on another test is no failing run of the test, even when it lists the test as passed", () => {
    const quiet = bash("pytest", failedIn("tests/test_other.py"), true);
    const verbose = bash("pytest -v", "tests/test_mod.py::test_x PASSED [ 50%]\ntests/test_other.py::test_y FAILED [100%]\nFAILED tests/test_other.py::test_y - assert 1\n1 failed, 1 passed in 0.1s", true);
    expect([before(quiet).failing_before_source, before(verbose).failing_before_source]).toEqual([false, false]);
  });
  test("a run reports the test's failure by naming it: pytest's FAILED line or collection error, unittest's FAIL line, or a traceback through the test", () => {
    const runs = [bash("pytest tests/", FAILED, true), bash("pytest tests/test_mod.py", "Exit code 2\n==================================== ERRORS ====================================\n______________________ ERROR collecting tests/test_mod.py ______________________\nImportError while importing test module '/testbed/tests/test_mod.py'.\nE   ImportError: cannot import name 'g' from 'pkg.mod'\n=========================== short test summary info ============================\nERROR tests/test_mod.py\n1 error in 0.10s", true),
      bash("python -m unittest discover -s tests -v", "Exit code 1\ntest_x (tests.test_mod.T.test_x) ... FAIL\n\n======================================================================\nFAIL: test_x (tests.test_mod.T.test_x)\n----------------------------------------------------------------------\nAssertionError: 0 != 1\n\nFAILED (failures=1)", true),
      bash("python -c 'import sys; sys.path.insert(0, \"tests\"); import test_mod; test_mod.test_x()'", "Exit code 1\nTraceback (most recent call last):\n  File \"<string>\", line 1, in <module>\n  File \"/testbed/tests/test_mod.py\", line 2, in test_x\n    assert f() == 1\nAssertionError", true)];
    for (const r of runs) expect([r.input.command, before(r).failing_before_source]).toEqual([r.input.command, true]);
  });
  test("a stack printed through the test with no exception raised is no failure", () => {
    expect(before(bash("python -c 'import tests.test_mod as t; t.show()'", "  File \"/testbed/tests/test_mod.py\", line 9, in show\n    traceback.print_stack()\ndone")).failing_before_source).toBe(false);
  });
  test("pytest run through coverage, or from a python heredoc calling pytest.main, counts", () => {
    const runs = [bash("python -m coverage run -m pytest --log-level DEBUG -q tests/test_mod.py -k x --maxfail=3", FAILED, true), bash("python - <<'PY'\nimport pytest\nraise SystemExit(pytest.main(['-q', 'tests/test_mod.py']))\nPY", FAILED, true)];
    for (const r of runs) expect([r.input.command, before(r).followed]).toEqual([r.input.command, true]);
  });
  test("a result Claude Code cut in the middle still counts when the run starts the test file and pytest shows its failures", () => {
    const cut = "Exit code 1\n.FFFF                                                                    [100%]\n=================================== FAILURES ===================================\n___________________________ test_x ___________________________\n\n    def test_x():\n... [20010 characters truncated] ...\n        mock_session = Mock()";
    expect([before(bash("pytest -q tests/test_mod.py -k x", cut, true)).failing_before_source, before(bash("pytest -q tests/", cut, true)).failing_before_source]).toEqual([true, false]);
  });
  test("a conftest that fails to import runs no test, so it is no failing run", () => {
    expect(before(bash("pytest -q tests/test_mod.py --maxfail=3", "Exit code 4\nImportError while loading conftest '/testbed/tests/conftest.py'.\ntests/conftest.py:32: in <module>\n    import app\nE   ModuleNotFoundError: No module named 'testcontainers'", true)).failing_before_source).toBe(false);
  });
  test("unittest.main run as a script counts through its failing count", () => {
    expect(before(bash("python tests/test_mod.py", "Exit code 1\nF\n======================================================================\nFAIL: test_x (__main__.T.test_x)\n----------------------------------------------------------------------\nAssertionError: 0 != 1\n\nFAILED (failures=1)", true)).followed).toBe(true);
  });
});

describe("the passing run selects the test", () => {
  const after = (run: Step) => detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), run]), PATCH);
  test("a green run of another file is no passing run, even when its output names the test", () => {
    const d = after(bash("pytest tests/test_other.py; git status --short", "1 passed in 0.1s\n M tests/test_mod.py"));
    expect([d.passing_after_source, d.followed]).toEqual([false, false]);
  });
  test("a green run whose output reports the test failed is not passing", () => {
    expect(after(bash("pytest tests/test_mod.py", "Exit code 0\nFAILED tests/test_mod.py::test_x - assert 0 == 1\n1 passed in 0.1s")).passing_after_source).toBe(false);
  });
  test("a failure word in a passing test's name or message does not reject the run", () => {
    expect(after(bash("pytest tests/test_mod.py -v", "tests/test_mod.py::test_failure_message PASSED [100%]\nno failures expected here\n1 passed in 0.1s")).followed).toBe(true);
  });
  test("a run of the test's folder, the whole suite, a -k selection of it, or a script given the test file selects it", () => {
    const runs = [bash("pytest tests/ -q", PASSED), bash("pytest", PASSED), bash("pytest -k mod -q", PASSED), bash("python /tmp/run_tests.py -q tests/test_mod.py", "....\n4 passed in 0.1s"), bash("python - <<'PY'\nimport pytest\nraise SystemExit(pytest.main(['-q', 'tests/test_mod.py']))\nPY", "..\n2 passed in 0.1s")];
    for (const r of runs) expect([r.input.command, after(r).followed]).toEqual([r.input.command, true]);
  });
  test("a background run read through tail or rg of its output file is seen there", () => {
    const launch = { ...bash("pytest tests/", "Command running in background with ID: bg2. Output is being written to: /tmp/tasks/bg2.output"), input: { command: "pytest tests/", run_in_background: true } };
    const d = after(launch);
    const read = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), launch, bash("rg -n 'passed|failed' /tmp/tasks/bg2.output; git status --short", "36:3 passed in 0.1s\n M tests/test_mod.py")]), PATCH);
    expect([d.followed, d.unread_background, read.followed, read.unread_background]).toEqual([false, 1, true, 0]);
  });
});

describe("inline scripts read for the file they write", () => {
  const S = (code: string) => bash("cd /testbed && python - <<'E'\n" + code + "\nE", "");
  const both = (step: Step) => [detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), step, bash("pytest tests/test_mod.py", PASSED)]), PATCH), detect(log([step, write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("pytest tests/test_mod.py", PASSED)]), PATCH)] as const;
  test("a name assigned again between writes is read at each write, in both directions", () => {
    const [first, late] = both(S("p='pkg/other.py'; s=open(p).read()\nopen(p,'w').write(s)\np='pkg/mod.py'; s=open(p).read()\nopen(p,'w').write(s.replace('a','b'))"));
    expect([first.followed, first.bash_only_source, first.unresolved_writes, late.followed, late.test_before_source]).toEqual([true, true, 0, false, false]);
  });
  test("a name a for loop binds is a write no parser can name, and the files the call names are still read as written, in both directions", () => {
    const [first, late] = both(S("p='pkg/other.py'; s=open(p).read()\nopen(p,'w').write(s)\nfor p,old in [('pkg/mod.py','a')]:\n    s=open(p).read(); open(p,'w').write(s.replace(old,'b',1))"));
    expect([first.followed, first.bash_only_source, first.unresolved_writes, late.followed, late.unresolved_writes]).toEqual([true, true, 1, false, 1]);
  });
  test("code inside a string the script writes is not read as a binding", () => {
    const [first] = both(S("p='pkg/mod.py'; s=open(p).read()\ns+='''\nfor p in items:\n    pass\n'''\nopen(p,'w').write(s)"));
    expect([first.followed, first.unresolved_writes]).toEqual([true, 0]);
  });
  test("a script that writes only to /tmp writes no source or test, even when the same call names them", () => {
    const tmp = bash("cd /testbed && python - <<'PY'\nfrom pathlib import Path\nPath('/tmp/baseline.json').write_text('{}')\nPY\npython -m pytest tests/test_mod.py -q", "1 passed in 0.1s");
    const reads = bash("python3 - <<'EOF'\ns = open('pkg/mod.py').read()\nopen('/tmp/out.txt', 'w').write(s)\nEOF", "");
    const d = detect(log([tmp, reads, write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.test_file, d.followed_tool_only, d.unresolved_writes]).toEqual([true, TEST, true, 0]);
  });
});

describe("the shell's folder carries from one Bash call to the next", () => {
  test("a cd in one call places a relative edit in the next", () => {
    const d = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /testbed/pkg", ""), bash("sed -i 's/a/b/' mod.py", ""), bash("cd /testbed && pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.bash_only_source, d.source_write_unseen]).toEqual([true, true, false]);
  });
  test("Claude Code's reset after a cd out of the project puts the next call back in the project", () => {
    const d = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd /tmp/repro && ls", "a.py\nShell cwd was reset to /testbed"), bash("sed -i 's/a/b/' pkg/mod.py", ""), bash("pytest tests/test_mod.py", PASSED)]), PATCH);
    expect([d.followed, d.source_write_unseen]).toEqual([true, false]);
  });
});

describe("inside one Bash call, commands run in the order bash runs them", () => {
  const FIX = "sed -i s/a/b/ pkg/mod.py", RUN = "pytest tests/test_mod.py -q";
  const ran = (command: string) => detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash(command, PASSED)]), PATCH);
  test("a fix and its passing run in one call count across &&, ; and newlines, after || true, through a pipe after the run, and with an operator inside a heredoc", () => {
    const heredoc = "python - <<'EOF'\nimport pathlib\np = pathlib.Path('pkg/mod.py')\np.write_text(p.read_text().replace('a || b', 'a & b'))\nEOF\n" + RUN;
    for (const c of [FIX + " && " + RUN, FIX + "; " + RUN, FIX + "\n" + RUN, FIX + " || true; " + RUN, FIX + " || true && " + RUN, FIX + " && " + RUN + " 2>&1 | tail -5", heredoc])
      expect([c, ran(c).followed, ran(c).bash_only_source]).toEqual([c, true, true]);
  });
  test("the run before the fix, a run only a failed fix reaches (||), a pipe and a & give the passing run no order", () => {
    for (const c of [RUN + "; " + FIX, FIX + " || " + RUN, FIX + " | " + RUN, FIX + " & " + RUN])
      expect([c, ran(c).followed, ran(c).bash_only_source]).toEqual([c, false, true]);
    const split = detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash(FIX, ""), bash(RUN, PASSED)]), PATCH);
    expect(split.followed).toBe(true);
  });
  test("a failing run before the fix in the same call counts, and one after it does not", () => {
    const fails = (command: string) => detect(log([write(TEST), bash(command, FAILED, true), bash(RUN, PASSED)]), PATCH);
    expect([fails("pytest tests/test_mod.py; " + FIX).followed, fails("pytest tests/test_mod.py || " + FIX).followed, fails(FIX + "; pytest tests/test_mod.py").followed]).toEqual([true, true, false]);
  });
  test("a test written and run in one call has its failing run only when the run comes after the write", () => {
    const body = "cat > tests/test_mod.py <<'EOF'\ndef test_x():\n    assert f() == 1\nEOF\n";
    const first = detect(log([bash(body + "pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash(RUN, PASSED)]), PATCH);
    const late = detect(log([bash("pytest tests/test_mod.py; " + body, FAILED, true), edit("/testbed/pkg/mod.py"), bash(RUN, PASSED)]), PATCH);
    expect([first.followed, first.test_file, late.followed, late.test_file]).toEqual([true, TEST, false, TEST]);
  });
});

describe("a cd the parser can't resolve leaves the folder unknown", () => {
  const tail = [write(TEST), bash("pytest tests/test_mod.py", FAILED, true), edit("/testbed/pkg/mod.py"), bash("pytest tests/test_mod.py -q", PASSED)];
  const read = (d: ReturnType<typeof detect>) => [d.followed, d.unresolved_writes];
  test("a relative fix after it, in that call or the next, is a write no parser can name, in both directions", () => {
    expect(read(detect(log([bash('cd "$(git rev-parse --show-toplevel)" && sed -i s/a/b/ pkg/mod.py', ""), ...tail]), PATCH))).toEqual([false, 1]);
    expect(read(detect(log([bash('cd "$REPO" && printf x > pkg/mod.py', ""), ...tail]), PATCH))).toEqual([true, 1]);
    expect(read(detect(log([bash('cd "$REPO"', ""), bash("sed -i s/a/b/ pkg/mod.py", ""), ...tail]), PATCH))).toEqual([false, 1]);
    expect(read(detect(log([write(TEST), bash("pytest tests/test_mod.py", FAILED, true), bash("cd ~/src && sed -i s/a/b/ pkg/mod.py", ""), bash("pytest tests/test_mod.py -q", PASSED)]), PATCH))).toEqual([true, 1]);
  });
  test("a write to a full path there, and a relative write after a cd to a full path, are read as before", () => {
    expect(read(detect(log([bash('cd "$REPO" && sed -i s/a/b/ /testbed/pkg/mod.py', ""), ...tail]), PATCH))).toEqual([false, 0]);
    expect(read(detect(log([bash("cd /testbed && sed -i s/a/b/ pkg/mod.py", ""), ...tail]), PATCH))).toEqual([false, 0]);
    expect(read(detect(log([bash('cd "$REPO"', ""), bash("cd /testbed", ""), bash("sed -i s/a/b/ pkg/mod.py", ""), ...tail]), PATCH))).toEqual([false, 0]);
  });
});

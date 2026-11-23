// Copyright (c) 2026 Garry Tan. MIT License.
// B2's co-primary reader (src/scoring/regression-test.ts, preregistration section 6.2): the files a final diff adds, modifies or
// renames to that B1's test-path rule (lanes/delivery-route/detect.ts TEST_PATH) calls a test, and whether every one of them
// sits at the repository root.
import { describe, expect, test } from "bun:test";
import { testFilesInDiff } from "../../src/scoring/regression-test.ts";

const modified = (f: string) => "diff --git a/" + f + " b/" + f + "\nindex 1111111..2222222 100644\n--- a/" + f + "\n+++ b/" + f + "\n@@ -1 +1 @@\n-x\n+y\n";
const added = (f: string) => "diff --git a/" + f + " b/" + f + "\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/" + f + "\n@@ -0,0 +1 @@\n+def test_x(): pass\n";
const deleted = (f: string) => "diff --git a/" + f + " b/" + f + "\ndeleted file mode 100644\nindex 2222222..0000000\n--- a/" + f + "\n+++ /dev/null\n@@ -1 +0,0 @@\n-def test_x(): pass\n";
const renamed = (from: string, to: string, hunk = true) => "diff --git a/" + from + " b/" + to + "\nsimilarity index " + (hunk ? "90" : "100") + "%\nrename from " + from + "\nrename to " + to + (hunk ? "\nindex 1111111..2222222 100644\n--- a/" + from + "\n+++ b/" + to + "\n@@ -1 +1 @@\n-x\n+y\n" : "\n");

describe("the test files a diff leaves", () => {
  test("added, modified and renamed-to test files count, in a tests folder or by name", () => {
    const d = modified("pkg/mod.py") + added("tests/test_mod.py") + modified("pkg/tests/test_core.py") + renamed("tests/old.py", "tests/test_new.py") + renamed("tests/test_a.py", "tests/test_b.py", false) + added("src/test/java/AppTest.java");
    expect(testFilesInDiff(d)).toEqual({ files: ["tests/test_mod.py", "pkg/tests/test_core.py", "tests/test_new.py", "tests/test_b.py", "src/test/java/AppTest.java"], root_only: false });
  });
  test("deleted test files, source files, a test renamed out of a test path and a spec folder's helper do not count", () => {
    const d = modified("pkg/mod.py") + deleted("tests/test_gone.py") + renamed("tests/test_util.py", "pkg/util.py") + added("spec/support/helper.py") + modified("setup.cfg");
    expect(testFilesInDiff(d)).toEqual({ files: [], root_only: false });
    expect(testFilesInDiff("")).toEqual({ files: [], root_only: false });
  });
  test("root_only holds only when every test file sits at the repository root", () => {
    expect(testFilesInDiff(modified("pkg/mod.py") + added("test_repro.py"))).toEqual({ files: ["test_repro.py"], root_only: true });
    expect(testFilesInDiff(added("test_repro.py") + added("tests/test_mod.py"))).toEqual({ files: ["test_repro.py", "tests/test_mod.py"], root_only: false });
  });
  test("a binary test file, a quoted path and a plain unified diff with no git header are read", () => {
    const binary = "diff --git a/tests/test_data.bin b/tests/test_data.bin\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/tests/test_data.bin differ\n";
    const quoted = "diff --git \"a/tests/test \\303\\251t\\303\\251.py\" \"b/tests/test \\303\\251t\\303\\251.py\"\nnew file mode 100644\n--- /dev/null\n+++ \"b/tests/test \\303\\251t\\303\\251.py\"\n@@ -0,0 +1 @@\n+x\n";
    const plain = "--- a/pkg/mod.py\n+++ b/pkg/mod.py\n@@ -1 +1 @@\n-x\n+y\n--- /dev/null\n+++ b/tests/test_plain.py\n@@ -0,0 +1 @@\n+x\n";
    expect([testFilesInDiff(binary).files, testFilesInDiff(quoted).files, testFilesInDiff(plain).files]).toEqual([["tests/test_data.bin"], ["tests/test été.py"], ["tests/test_plain.py"]]);
  });
});

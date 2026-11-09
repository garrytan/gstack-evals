// Copyright (c) 2026 Garry Tan. MIT License.
// Invented minimal repositories and rows for the state machines family's tests (a test never imports another test).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { MlRow } from "./source.ts";

const git = (dir: string, ...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
};

/** A repo with the given files committed over several commits (plus a tag, a branch and a remote), returning its dir and
 *  the head commit. Files under "untracked:" prefixes are written but not committed. */
export function fixtureRepo(files: Record<string, string>, commits = 3): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "sm-fixture-"));
  git(dir, "init", "-q");
  git(dir, "symbolic-ref", "HEAD", "refs/heads/trunk");
  const entries = Object.entries(files);
  for (let c = 0; c < commits; c++) {
    for (const [p, body] of entries) {
      if (p.startsWith("untracked:")) continue;
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c === commits - 1 ? body : body + "\n// draft " + c + "\n");
    }
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "--allow-empty", "-m", "c" + c);
  }
  git(dir, "tag", "v1");
  git(dir, "branch", "side");
  git(dir, "remote", "add", "origin", "https://example.invalid/fixture.git");
  for (const [p, body] of entries) {
    if (!p.startsWith("untracked:")) continue;
    const q = p.slice(10);
    mkdirSync(dirname(join(dir, q)), { recursive: true });
    writeFileSync(join(dir, q), body);
  }
  return { dir, head: git(dir, "rev-parse", "HEAD") };
}

export const gitOut = git;

/** An invented dataset row in MultiLang's shape. */
export function fixtureRow(over: Partial<MlRow> = {}): MlRow {
  return {
    repo: "example-org/widget", pull_number: "7", instance_id: "example-org__widget-7", base_commit: "a".repeat(40),
    patch: "diff --git a/src/counter.rs b/src/counter.rs\n--- a/src/counter.rs\n+++ b/src/counter.rs\n@@ -1 +1 @@\n-old\n+    let total_after_reset = counter.reset_and_count();\n",
    test_patch: "diff --git a/tests/counter.rs b/tests/counter.rs\n--- a/tests/counter.rs\n+++ b/tests/counter.rs\n@@ -1 +1 @@\n-a\n+b\n",
    problem_statement: "The counter keeps its old value after reset.", created_at: "2026-04-02T10:00:00Z",
    rebuild_cmds: ["cd /testbed/repo && true"], test_cmds: ["cd /testbed/repo && ./run-tests.sh > out.log 2>&1"], print_cmds: ["cd /testbed/repo && cat out.log"],
    log_parser: "def parser(log: str) -> dict[str, str]:\n    return {}\n", FAIL_TO_PASS: ["counter::reset"], PASS_TO_PASS: ["counter::add"],
    docker_image: "example/widget-7", ...over,
  };
}

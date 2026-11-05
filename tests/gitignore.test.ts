// The repository ignores Python's bytecode caches: a reader that runs the Python tests leaves __pycache__ dirs, which
// otherwise show as untracked files and move a review's worktree fingerprint.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("git ignores __pycache__ dirs anywhere in the tree", () => {
  const root = join(import.meta.dir, "..");
  for (const p of ["tests/real-outcome/__pycache__/unit_test.cpython-312.pyc", "lanes/real-outcome/agent/__pycache__/real_agent.cpython-312.pyc"]) {
    expect(spawnSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: root }).status).toBe(0);
  }
});

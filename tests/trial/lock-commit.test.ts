import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockCommit } from "../../src/skill-eval/lock/lock.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo(): { dir: string; git: (...args: string[]) => void } {
  const dir = mkdtempSync(join(tmpdir(), "gse-lockcommit-"));
  roots.push(dir);
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "tasks.json"), "[]\n");
  writeFileSync(join(dir, "tasks.lock.json"), "{}\n");
  git("add", "-A");
  git("commit", "-qm", "lock");
  return { dir, git };
}

describe("lockCommit verifies the committed tree", () => {
  test("a committed, unchanged lock and tasks file pass with the HEAD commit", () => {
    const { dir } = repo();
    const r = lockCommit(join(dir, "tasks.lock.json"), [join(dir, "tasks.json")]);
    expect(r.ok).toBe(true);
  });

  // Value: protects=a paid run never trusts a lock whose pinned tasks file differs from HEAD; fails_when=assume-unchanged or skip-worktree hides an edited tasks file from git status and lockCommit reports ok; why_new=U5's lockCommit trusted git status alone (Captain brief item 6); seam=lockCommit; no_claim=files the lock does not pin
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    test("an edit hidden from git status by " + flag + " is refused", () => {
      const { dir, git } = repo();
      git("update-index", flag, "tasks.json");
      writeFileSync(join(dir, "tasks.json"), '[{"id":"x","prompt":"p","must":["a"]}]\n');
      expect(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout).toBe("");
      const r = lockCommit(join(dir, "tasks.lock.json"), [join(dir, "tasks.json")]);
      expect(r).toEqual({ ok: false, reason: "the working copy differs from the commit at HEAD, though git status reports it clean (assume-unchanged or skip-worktree hides it): tasks.json" });
    });
  }
});

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../lanes/eng-planted/cli.ts";
import { compareDigests, unitDigests } from "../../../lanes/eng-planted/construct/digests.ts";

const root = mkdtempSync(join(tmpdir(), "ep-digests-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "unit", GIT_AUTHOR_EMAIL: "unit@example.invalid", GIT_COMMITTER_NAME: "unit", GIT_COMMITTER_EMAIL: "unit@example.invalid" } }).stdout.trim();

function fixtureUnit(name: string): { dir: string; commit: string; tree: string } {
  const src = join(root, name + "-src");
  mkdirSync(src, { recursive: true });
  git(src, "init", "-q", "-b", "main");
  writeFileSync(join(src, "a.go"), "package a\n");
  git(src, "add", "-A");
  git(src, "commit", "-q", "-m", "base");
  const dir = join(root, name);
  mkdirSync(join(dir, "environment"), { recursive: true });
  git(src, "bundle", "create", "-q", join(dir, "environment", "task.bundle"), "main");
  writeFileSync(join(dir, "environment", "Dockerfile"), "FROM scratch\n");
  mkdirSync(join(dir, "restore", "sub"), { recursive: true });
  writeFileSync(join(dir, "restore", "a.txt"), "alpha\n");
  writeFileSync(join(dir, "restore", "sub", "b.txt"), "beta\n");
  symlinkSync("a.txt", join(dir, "restore", "link"));
  mkdirSync(join(dir, "other"), { recursive: true });
  symlinkSync(join(dir, "other"), join(dir, "restore", "dirlink"));
  writeFileSync(join(dir, "other", "c.txt"), "not under restore\n");
  return { dir, commit: git(src, "rev-parse", "HEAD"), tree: git(src, "rev-parse", "HEAD^{tree}") };
}

const run = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(["digests", ...argv], { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

describe("a unit's content digests (section 15)", () => {
  test("B from the bundle, every file and symlink under restore/ sorted, and the Dockerfile", () => {
    const u = fixtureUnit("one");
    const lines = unitDigests(u.dir);
    const r = [
      "R " + sha("alpha\n") + " restore/a.txt",
      "R " + sha("beta\n") + " restore/sub/b.txt",
      "R " + sha("a.txt") + " restore/link",
      "R " + sha(join(u.dir, "other")) + " restore/dirlink",
    ].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    expect(lines).toEqual(["B " + u.commit + " " + u.tree, ...r, "D " + sha("FROM scratch\n")]);
  });

  test("a changed restore file or a missing Dockerfile is a mismatch; the same lines match", () => {
    const u = fixtureUnit("two");
    const sealed = unitDigests(u.dir);
    expect(compareDigests(sealed, sealed).match).toBe(true);
    writeFileSync(join(u.dir, "restore", "a.txt"), "changed\n");
    const changed = compareDigests(sealed, unitDigests(u.dir));
    expect(changed.match).toBe(false);
    expect(changed.kinds.R).toEqual({ compared: 5, matched: 3 });
    rmSync(join(u.dir, "environment", "Dockerfile"));
    expect(unitDigests(u.dir).at(-1)).toBe("D missing");
    expect(compareDigests(sealed, sealed.filter((l) => !l.startsWith("B "))).match).toBe(false);
  });

  test("ep digests writes outside the repository only, then checks a rebuilt unit with exit 1 on a mismatch", async () => {
    const u = fixtureUnit("three");
    const inRepo = await run("--unit", u.dir, "--out", resolve(import.meta.dir, "digests.txt"));
    expect(inRepo.code).toBe(2);
    expect(inRepo.err).toContain("E_USAGE");
    expect((await run("--unit", u.dir)).code).toBe(2);
    const file = join(root, "three.digests.txt");
    const wrote = await run("--unit", u.dir, "--out", file);
    expect(wrote.code).toBe(0);
    expect(wrote.out).toBe("digests: 6 lines written, 4 of them restore files");
    expect(readFileSync(file, "utf8").split("\n").filter(Boolean)).toEqual(unitDigests(u.dir));
    const same = await run("--unit", u.dir, "--check", file);
    expect(same.code).toBe(0);
    expect(same.out).toBe("digests: B 1 of 1, R 4 of 4, D 1 of 1 matched; match");
    writeFileSync(join(u.dir, "restore", "sub", "b.txt"), "changed\n");
    const moved = await run("--unit", u.dir, "--check", file);
    expect(moved.code).toBe(1);
    expect(moved.out).toBe("digests: B 1 of 1, R 3 of 5, D 1 of 1 matched; mismatch, so the unit counts as lost (section 15)");
  });
});

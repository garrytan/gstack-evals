// Copyright (c) 2026 Garry Tan. MIT License.
// D7's keyless fixture: a task tree whose history reaches past its base commit every way git allows, the way 12 of
// Stage 1's 40 SWE-rebench images reached the upstream fix through their tags. d1.test.ts runs task-setup.Dockerfile's
// RUN on it, and build-check.test.ts runs the build check's object-level read (D7_CHECK) on it.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (dir: string, ...args: string[]) => Bun.spawnSync(["git", "-C", dir, "-c", "user.name=hm", "-c", "user.email=hm@example.invalid", "-c", "init.defaultBranch=work", ...args], { stdout: "pipe", stderr: "pipe" });
export const gitOut = (dir: string, ...args: string[]) => git(dir, ...args).stdout.toString().trim();
/** The hidden test name the future commit adds; at least 12 characters, as markers.ts requires. */
export const HIDDEN = "test_hidden_regression_case";

export type Leaky = { root: string; w: string; old: string; base: string; future: string };

/** root/testbed: commit old (tagged v0.1), then base, where HEAD sits on branch work, then a future commit adding HIDDEN.
 * Past the base it holds branch future, annotated tag v9, a note, a stash, a replace ref, FETCH_HEAD, ORIG_HEAD, reflog
 * entries and a .keep pack holding every object, so a plain gc would keep the future commit. */
export function leakyTree(o: { detached?: boolean } = {}): Leaky {
  const root = mkdtempSync(join(tmpdir(), "hm-d7-")), w = join(root, "testbed");
  mkdirSync(w);
  git(w, "init", "-q");
  writeFileSync(join(w, "a.py"), "x = 1\n");
  git(w, "add", "a.py");
  git(w, "commit", "-q", "-m", "old");
  git(w, "tag", "v0.1");
  const old = gitOut(w, "rev-parse", "HEAD");
  writeFileSync(join(w, "a.py"), "x = 2\n");
  git(w, "commit", "-q", "-am", "base");
  const base = gitOut(w, "rev-parse", "HEAD");
  git(w, "checkout", "-q", "-b", "future");
  writeFileSync(join(w, "test_a.py"), "def " + HIDDEN + "():\n    pass\n");
  git(w, "add", "test_a.py");
  git(w, "commit", "-q", "-m", "fix");
  const future = gitOut(w, "rev-parse", "HEAD");
  git(w, "tag", "-a", "v9", "-m", "release");
  git(w, "notes", "add", "-m", "note", future);
  git(w, "replace", "-f", old, future);
  git(w, "checkout", "-q", "work");
  writeFileSync(join(w, "a.py"), "x = 3\n");
  git(w, "stash", "-q");
  writeFileSync(join(w, ".git", "FETCH_HEAD"), future + "\t\tbranch 'main' of https://example.invalid/r\n");
  writeFileSync(join(w, ".git", "ORIG_HEAD"), future + "\n");
  git(w, "repack", "-a", "-d", "-q");
  const pack = join(w, ".git", "objects", "pack");
  for (const f of readdirSync(pack).filter((f) => f.endsWith(".pack"))) writeFileSync(join(pack, f.replace(/\.pack$/, ".keep")), "");
  if (o.detached) git(w, "checkout", "-q", "--detach", base);
  return { root, w, old, base, future };
}

export type WithSub = Leaky & { sub: string; pinned: string; subFuture: string };

/** Adds lib/schema to a leaky tree: a submodule pinned at its first commit, committed as the new base on work, the way
 * hdmf-dev__hdmf-1374's image ships hdmf-common-schema. Past the pin, the submodule's git directory (under .git/modules)
 * holds a later commit adding HIDDEN, annotated tag sv9 on it and its origin's branches. Its source repository is removed,
 * so the only git directories left are the tree's and the submodule's. */
export function withSubmodule(t: Leaky): WithSub {
  const src = join(t.root, "schema-src"), sub = "lib/schema", s = join(t.w, sub);
  mkdirSync(src);
  git(src, "init", "-q");
  writeFileSync(join(src, "schema.yaml"), "v: 1\n");
  git(src, "add", "schema.yaml");
  git(src, "commit", "-q", "-m", "s0");
  const pinned = gitOut(src, "rev-parse", "HEAD");
  git(t.w, "-c", "protocol.file.allow=always", "submodule", "add", "-q", src, sub);
  git(t.w, "commit", "-q", "-m", "base with schema");
  const base = gitOut(t.w, "rev-parse", "HEAD");
  writeFileSync(join(src, "test_schema.py"), "def " + HIDDEN + "():\n    pass\n");
  git(src, "add", "test_schema.py");
  git(src, "commit", "-q", "-m", "s1");
  const subFuture = gitOut(src, "rev-parse", "HEAD");
  git(src, "tag", "-a", "sv9", "-m", "schema release");
  git(s, "-c", "protocol.file.allow=always", "fetch", "-q", "--tags", "origin");
  rmSync(src, { recursive: true, force: true });
  return { ...t, base, sub, pinned, subFuture };
}

/** The env D7_CHECK reads, pointed at a fixture root instead of a container's /. */
export const checkEnv = (root: string) => ({ ROOT: root, REPO: join(root, "testbed"), ORIGIN: join(root, "opt", "hm-origin.git"), SELF: join(root, "hm-d7"), NAMES: join(root, "hm-d7", "names") });

// The graded filesystem delta (plan v3.2, "Grader integrity"). Verification starts from the evaluator-owned baseline, the
// work dir snapshotted after setup with its .git, and imports what the agent changed against it: new, changed and deleted
// files anywhere in the work tree, untracked and git-excluded files included (so .gstack-home comes across). Excluded:
// every .git entry (the repository, its config and its hooks stay the baseline's, so an agent's commit cannot move the
// grader's HEAD), and fifos, sockets and devices. A sidecar paths list narrows the import. The check then runs on the
// grade tree, never on the agent's. Three rules keep agent-written config from changing what a check sees (GEVA-68's
// audit), and each records what it did in delta.dropped:
// - git's in-tree config (.gitignore, .gitattributes, .gitmodules) stays the baseline's, so an agent cannot hide new
//   files from git ls-files or change how git diffs.
// - a symlink that points outside the work tree becomes an empty directory holding PLACEHOLDER, so test -e, test -d,
//   find and git's untracked list all still see that something was written at that path.
// - a baseline directory the agent replaced with a symlink (such as .gstack-home) stays a directory: graded as the
//   directory the link points to when that is in the tree, else as the baseline's.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

type Kind = "f" | "d" | "l" | "o";
interface Entry {
  kind: Kind;
  mode: number;
  size: number;
  target?: string;
}

export interface Delta {
  added: string[];
  changed: string[];
  deleted: string[];
  /** Agent output left out of the import or graded as something else, with why. */
  dropped: { path: string; reason: string }[];
}

/** A byte-for-byte copy of a tree: modes, symlinks and .git included. */
export function snapshot(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  const r = spawnSync("cp", ["-a", "--", src, dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("snapshot of " + src + " failed: " + r.stderr.trim());
}

/** The empty file inside the directory that stands in for a symlink pointing outside the work tree. */
export const PLACEHOLDER = ".gstack-evals-dropped-symlink";

/** Git reads these from the work tree; the grade tree keeps the baseline's copies. */
const GIT_CONFIG = new Set([".gitignore", ".gitattributes", ".gitmodules"]);

/** Adds every entry under dir to out, keyed by its path under rel. Symlinks are recorded, never followed. */
function walk(dir: string, rel: string, out: Map<string, Entry>): Map<string, Entry> {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const path = join(dir, name);
    const relPath = rel ? rel + "/" + name : name;
    const st = lstatSync(path);
    const kind: Kind = st.isSymbolicLink() ? "l" : st.isDirectory() ? "d" : st.isFile() ? "f" : "o";
    out.set(relPath, { kind, mode: st.mode & 0o7777, size: st.size, ...(kind === "l" ? { target: readlinkSync(path) } : {}) });
    if (kind === "d") walk(path, relPath, out);
  }
  return out;
}

const scan = (root: string) => walk(root, "", new Map());

const depth = (p: string) => p.split("/").length;

/**
 * Where a symlink at rel with this target lands, as path parts under the work tree, or null when it escapes. Each
 * intermediate symlink in the tree is followed as the kernel would, so a chain through a link like a -> . cannot hide
 * an escape. An absolute target, or a chain longer than 40 links, counts as escaping.
 */
function resolveLink(rel: string, target: string, tree: Map<string, Entry>, hops = 0): string[] | null {
  if (isAbsolute(target) || hops > 40) return null;
  const parts = rel.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
    const entry = tree.get(parts.join("/"));
    if (entry?.kind !== "l") continue;
    const landed = resolveLink(parts.join("/"), entry.target!, tree, hops + 1);
    if (!landed) return null;
    parts.splice(0, parts.length, ...landed);
  }
  return parts;
}

/** Every directory under root, with its mode. */
function dirModes(root: string, out = new Map<string, number>()): Map<string, number> {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const st = lstatSync(path);
    if (!st.isDirectory()) continue;
    out.set(path, st.mode & 0o7777);
    dirModes(path, out);
  }
  return out;
}

/** Imports the agent's changes (after) against the baseline into grade, a copy of the baseline. */
export function importDelta(baseline: string, after: string, grade: string, paths?: readonly string[]): Delta {
  spawnSync("chmod", ["-R", "u+rX", after], { stdio: "ignore" });
  const root = realpathSync(after);
  const before = scan(baseline);
  const now = scan(after);
  const scope = (paths ?? []).map((s) => s.replace(/\/+$/, ""));
  const under = (p: string, roots: readonly string[]) => roots.some((s) => p === s || p.startsWith(s + "/"));
  const kept: string[] = [];
  const inScope = (p: string) => (!scope.length || under(p, scope)) && !under(p, kept);
  const delta: Delta = { added: [], changed: [], deleted: [], dropped: [] };
  const relinked = () => [...now].find(([p, e]) => e.kind === "l" && before.get(p)?.kind === "d" && !delta.dropped.some((d) => d.path === p) && (inScope(p) || scope.some((s) => s.startsWith(p + "/"))))?.[0];
  for (let p = relinked(); p !== undefined; p = relinked()) {
    const target = now.get(p)!.target!;
    let real = "";
    try {
      real = realpathSync(join(after, p));
    } catch {}
    const dir = real.startsWith(root + "/") ? statSync(real) : undefined;
    const follow = dir?.isDirectory() === true;
    if (follow) {
      now.set(p, { kind: "d", mode: dir!.mode & 0o7777, size: dir!.size });
      walk(join(after, p), p, now);
    } else kept.push(p);
    delta.dropped.push({ path: p, reason: "directory replaced by a symlink to " + target + "; graded as " + (follow ? "the directory it points to" : "the baseline's directory") });
  }
  const graded = new Map([...before].filter(([p]) => !inScope(p)).concat([...now].filter(([p]) => inScope(p))));
  const gitConfig = (p: string) => p.split("/").some((s) => GIT_CONFIG.has(s));
  const modes = dirModes(grade);
  for (const path of modes.keys()) chmodSync(path, 0o700);
  for (const p of [...before.keys()].filter((p) => !now.has(p) && inScope(p)).sort((a, b) => depth(b) - depth(a))) {
    if (gitConfig(p)) {
      if (GIT_CONFIG.has(basename(p))) delta.dropped.push({ path: p, reason: "deleted, and git reads the baseline's " + basename(p) });
      continue;
    }
    rmSync(join(grade, p), { recursive: true, force: true });
    delta.deleted.push(p);
  }
  for (const p of [...now.keys()].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
    const e = now.get(p)!;
    const old = before.get(p);
    if (!inScope(p)) continue;
    if (e.kind === "o") {
      delta.dropped.push({ path: p, reason: "not a file, directory or symlink" });
      continue;
    }
    const same = old && old.kind === e.kind && old.mode === e.mode && (e.kind === "d" || (e.kind === "l" ? old.target === e.target : old.size === e.size && readFileSync(join(baseline, p)).equals(readFileSync(join(after, p)))));
    if (gitConfig(p)) {
      if (!same && GIT_CONFIG.has(basename(p))) delta.dropped.push({ path: p, reason: "git reads the baseline's " + basename(p) + ", never the agent's" });
      continue;
    }
    const escapes = e.kind === "l" && !resolveLink(p, e.target!, graded);
    if (same && !escapes) continue;
    const dest = join(grade, p);
    if (old && (old.kind !== e.kind || e.kind !== "d" || escapes)) rmSync(dest, { recursive: true, force: true });
    mkdirSync(dirname(dest), { recursive: true });
    if (escapes) {
      delta.dropped.push({ path: p, reason: "symlink to " + e.target + " points outside the work tree; an empty directory stands in for it" });
      mkdirSync(dest);
      writeFileSync(join(dest, PLACEHOLDER), "");
    } else if (e.kind === "d") {
      mkdirSync(dest, { recursive: true, mode: 0o700 });
      modes.set(dest, e.mode);
    } else if (e.kind === "l") symlinkSync(e.target!, dest);
    else {
      copyFileSync(join(after, p), dest);
      chmodSync(dest, e.mode);
    }
    (old ? delta.changed : delta.added).push(p);
  }
  for (const path of [...dirModes(grade).keys()].sort((a, b) => depth(b) - depth(a))) {
    const mode = modes.get(path);
    if (mode !== undefined) chmodSync(path, mode);
  }
  return delta;
}

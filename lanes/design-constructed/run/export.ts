// Copyright (c) 2026 Garry Tan. MIT License.
// C1, the export of one unit (plan section 7, R2-15): the base app at its pin, stripped, with the unit's evidence files,
// as a fresh one-commit repository. The commit is built from the pinned tree object in the kept local clone, never a
// fresh fetch: the tree is read into a fresh index, the strip paths leave the index, and the evidence files are added
// with git add -f, so a file the upstream tracked but its own .gitignore matches stays in and no evidence path drops
// out. Each evidence path is then checked with git check-ignore and against every .ignore and .rgignore in the tree
// (read as gitignore files in a scratch repository, the way ripgrep reads them); a hit fails the export. The tree is
// compared with the expected tree (the pinned tree, less the strip, plus the evidence blobs hashed with no filters),
// the commit is written with fixed metadata so its id is a function of its tree, and the fresh repository receives
// exactly the objects git rev-list --objects lists for that commit. After checkout, git status --porcelain --ignored
// must be empty. D's git add -A in a fresh repository is not used.
// Strip rules adapted from lanes/outcome-skills/statemachines/strip.ts on main and D's tests/trial/review/mounts.test.ts.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix } from "node:path";
import { STRIP } from "../frozen.ts";
import { fail } from "../errors.ts";
import type { EvidenceFile } from "./arms.ts";

/** Fixed commit metadata (BT): the author and committer, both dates and the message are constants. */
export const EXPORT_COMMIT = { name: "dc-export", email: "dc-export@invalid", time: "1763078400 +0000", message: "unit export\n", branch: "main" } as const;

const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", GIT_LFS_SKIP_SMUDGE: "1" };
/** Hooks off, no fsmonitor, no LFS smudge and no line-ending conversion of our own: repository code never runs. */
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false", "-c", "core.autocrlf=false", "-c", "core.symlinks=true", "-c", "protocol.file.allow=never"];

export interface GitRun {
  (dir: string, args: string[], o?: { input?: string | Buffer; env?: Record<string, string>; ok?: number[] }): { code: number; stdout: string; out: Buffer; stderr: string };
}
export const git: GitRun = (dir, args, o = {}) => {
  const r = spawnSync("git", [...SAFE, "-C", dir, ...args], { input: o.input, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), ...GIT_ENV, ...(o.env ?? {}) }, maxBuffer: 1024 * 1024 * 1024 });
  const code = r.status ?? 1;
  const out = r.stdout ?? Buffer.alloc(0);
  if (!(o.ok ?? [0]).includes(code)) fail("E_DC_INFRA_MISSING", "export: git " + args.slice(0, 3).join(" ") + " exited " + code + ": " + String(r.stderr ?? "").trim().slice(0, 400));
  return { code, stdout: out.toString("utf8"), out, stderr: String(r.stderr ?? "") };
};

export interface IndexEntry {
  mode: string;
  oid: string;
  path: string;
}
export type EntryKind = "file" | "executable" | "symlink" | "submodule";
const kindOf = (mode: string): EntryKind => (mode === "120000" ? "symlink" : mode === "160000" ? "submodule" : mode === "100755" ? "executable" : "file");

/**
 * Why the strip removes an entry, or null when it stays (prereg section 4's list). A symlink's target is read
 * lexically from its directory: absolute, or climbing above the tree root, is outside (BT).
 */
export function stripReason(path: string, mode: string, target: string | null): string | null {
  const parts = path.split("/");
  const base = parts.at(-1)!;
  const folder = parts.slice(0, -1).find((p) => (STRIP.foldersAnyDepth as readonly string[]).includes(p));
  if (folder) return "inside a " + folder + " folder";
  if ((STRIP.namesAnyType as readonly string[]).includes(base)) return "named " + base + " (any type)";
  if ((STRIP.foldersAnyDepth as readonly string[]).includes(base)) return "named " + base;
  if (STRIP.filesAnyDepth.some((f) => (f.includes("/") ? path === f || path.endsWith("/" + f) : base === f))) return "an instruction file " + base;
  if (mode === "120000" && STRIP.symlinksOutsideTree && target !== null) {
    if (isAbsolute(target) || target.startsWith("/")) return "a symlink to " + target + ", outside the tree";
    const resolved = posix.normalize(posix.join(posix.dirname(path), target));
    if (resolved === ".." || resolved.startsWith("../")) return "a symlink to " + target + ", outside the tree";
  }
  return null;
}

/** Why an evidence path can't be written, or null. */
export function evidencePathProblem(path: string, tracked: ReadonlySet<string>): string | null {
  if (!path || isAbsolute(path) || path !== posix.normalize(path) || path.startsWith("../") || path.endsWith("/")) return "not a clean relative path";
  if (path.split("/").includes(".git")) return "inside .git";
  if (stripReason(path, "100644", null)) return "the strip would remove it";
  if (tracked.has(path)) return "the base app already has a file there";
  for (let d = dirname(path); d !== "."; d = dirname(d)) if (tracked.has(d)) return "a parent " + d + " is a file in the base app";
  return null;
}

export interface Manifest {
  base: { pin: string; tree: string };
  removed: Array<{ path: string; kind: EntryKind; reason: string; sha256: string }>;
  evidence: Array<{ path: string; sha256: string }>;
  tree: string;
  commit: string;
  branch: string;
  /** sha256 of the checked-out tree, as treeDigestScript prints it; every container's copy must match it. */
  digest: string;
}

export interface ExportResult {
  repo: string;
  manifest: Manifest;
  /** The expected tree (pinned tree, less the strip, plus the evidence), computed apart from the export's own index. */
  expectedTree: string;
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Every blob's bytes for these oids, through one cat-file --batch. */
function blobs(dir: string, oids: string[], env: Record<string, string>): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!oids.length) return out;
  const raw = git(dir, ["cat-file", "--batch"], { input: oids.join("\n") + "\n", env }).out;
  let at = 0;
  for (const oid of oids) {
    const nl = raw.indexOf(10, at);
    const header = raw.subarray(at, nl).toString("utf8").split(" ");
    const size = Number(header[2]);
    if (header[0] !== oid || !Number.isFinite(size)) fail("E_DC_INFRA_MISSING", "export: cat-file did not return " + oid);
    out.set(oid, Buffer.from(raw.subarray(nl + 1, nl + 1 + size)));
    at = nl + 1 + size + 1;
  }
  return out;
}

const lsFiles = (dir: string, env: Record<string, string>): IndexEntry[] =>
  git(dir, ["ls-files", "-s", "-z"], { env })
    .stdout.split("\0")
    .filter(Boolean)
    .map((l) => {
      const [meta, path] = [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)];
      const [mode, oid] = meta.split(" ");
      return { mode: mode!, oid: oid!, path };
    });

/** Paths that a gitignore-format file set ignores: each [dir, text] is written as dir/.gitignore in a scratch repo. */
export function ignoredBy(files: ReadonlyArray<[string, string]>, paths: readonly string[]): string[] {
  if (!files.length || !paths.length) return [];
  const x = mkdtempSync(join(tmpdir(), "dc-ignore-"));
  try {
    git(x, ["init", "-q", "--template="]);
    for (const [dir, text] of files) {
      mkdirSync(join(x, dir), { recursive: true });
      writeFileSync(join(x, dir, ".gitignore"), text, { flag: "a" });
      writeFileSync(join(x, dir, ".gitignore"), "\n", { flag: "a" });
    }
    return git(x, ["check-ignore", "--no-index", "-z", "--stdin"], { input: paths.join("\0") + "\0", ok: [0, 1] }).stdout.split("\0").filter(Boolean);
  } finally {
    rmSync(x, { recursive: true, force: true });
  }
}

/** The shell that prints a checked-out tree's digest input, one line per file outside .git; sha256 of its output is the digest. */
export const TREE_DIGEST_SH = String.raw`cd "$1" || exit 3
find . -path ./.git -prune -o \( -type f -o -type l \) -print | LC_ALL=C sort | while IFS= read -r p; do
  if [ -L "$p" ]; then printf 'l %s %s\n' "$p" "$(printf '%s' "$(readlink "$p")" | sha256sum | cut -c1-64)"
  elif [ -x "$p" ]; then printf 'x %s %s\n' "$p" "$(sha256sum < "$p" | cut -c1-64)"
  else printf 'f %s %s\n' "$p" "$(sha256sum < "$p" | cut -c1-64)"; fi
done`;

/** The digest of a checked-out tree on this host, through TREE_DIGEST_SH. */
export function hostTreeDigest(dir: string): string {
  const r = spawnSync("sh", ["-c", TREE_DIGEST_SH, "sh", dir], { maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) fail("E_DC_INFRA_MISSING", "export: the tree digest exited " + r.status);
  return sha256(r.stdout);
}

/**
 * Exports one unit into out, which must not exist. clone is the kept local clone holding pin. Throws DcError
 * (E_DC_INFRA_MISSING) with the reason on any failure; a scratch repository is removed either way.
 */
export function exportUnit(o: { clone: string; pin: string; evidence: readonly EvidenceFile[]; out: string }): ExportResult {
  if (existsSync(o.out)) fail("E_DC_INFRA_MISSING", "export: " + o.out + " exists already; every export writes a new folder");
  if (!o.evidence.length) fail("E_DC_INFRA_MISSING", "export: the unit has no evidence files");
  const objects = git(o.clone, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]).stdout.trim();
  const pinCommit = git(o.clone, ["rev-parse", "--verify", o.pin + "^{commit}"]).stdout.trim();
  const pinTree = git(o.clone, ["rev-parse", "--verify", pinCommit + "^{tree}"]).stdout.trim();
  const s = mkdtempSync(join(tmpdir(), "dc-export-"));
  const alt = { GIT_ALTERNATE_OBJECT_DIRECTORIES: objects };
  try {
    git(s, ["init", "-q", "--template="]);
    git(s, ["read-tree", pinTree], { env: alt });
    const entries = lsFiles(s, alt);
    const targets = blobs(s, entries.filter((e) => e.mode === "120000").map((e) => e.oid), alt);
    const removed = entries.flatMap((e) => {
      const reason = stripReason(e.path, e.mode, e.mode === "120000" ? targets.get(e.oid)!.toString("utf8") : null);
      return reason ? [{ e, reason }] : [];
    });
    const removedBytes = blobs(s, removed.filter((r) => r.e.mode !== "160000").map((r) => r.e.oid), alt);
    const tracked = new Set(entries.map((e) => e.path));
    for (const f of o.evidence) {
      const why = evidencePathProblem(f.path, tracked);
      if (why) fail("E_DC_INFRA_MISSING", "export: evidence path " + f.path + ": " + why);
    }
    if (removed.length) git(s, ["update-index", "--force-remove", "-z", "--stdin"], { input: removed.map((r) => r.e.path).join("\0") + "\0", env: alt });
    const kept = entries.filter((e) => !removed.some((r) => r.e.path === e.path));
    const ignoreFiles = kept.filter((e) => /(?:^|\/)\.gitignore$/.test(e.path) && e.mode !== "120000");
    if (ignoreFiles.length) git(s, ["checkout-index", "-f", "-z", "--stdin"], { input: ignoreFiles.map((e) => e.path).join("\0") + "\0", env: alt });
    for (const f of o.evidence) {
      mkdirSync(dirname(join(s, f.path)), { recursive: true });
      writeFileSync(join(s, f.path), f.text);
    }
    const paths = o.evidence.map((f) => f.path);
    const gitHits = git(s, ["check-ignore", "--no-index", "-z", "--stdin"], { input: paths.join("\0") + "\0", env: alt, ok: [0, 1] }).stdout.split("\0").filter(Boolean);
    if (gitHits.length) fail("E_DC_INFRA_MISSING", "export: git check-ignore matches evidence path " + gitHits.join(", "));
    const rgFiles = kept.filter((e) => /(?:^|\/)\.(?:rg)?ignore$/.test(e.path) && e.mode !== "120000");
    const rgText = blobs(s, rgFiles.map((e) => e.oid), alt);
    const rgHits = ignoredBy(rgFiles.map((e) => [posix.dirname(e.path) === "." ? "" : posix.dirname(e.path), rgText.get(e.oid)!.toString("utf8")] as [string, string]), paths);
    if (rgHits.length) fail("E_DC_INFRA_MISSING", "export: an .ignore or .rgignore hides evidence path " + rgHits.join(", "));
    git(s, ["add", "-f", "--", ...paths], { env: alt });
    const tree = git(s, ["write-tree"], { env: alt }).stdout.trim();
    const expectedIndex = join(s, ".git", "expected.index");
    const ex = { ...alt, GIT_INDEX_FILE: expectedIndex };
    git(s, ["read-tree", pinTree], { env: ex });
    if (removed.length) git(s, ["update-index", "--force-remove", "-z", "--stdin"], { input: removed.map((r) => r.e.path).join("\0") + "\0", env: ex });
    for (const f of o.evidence) {
      const oid = git(s, ["hash-object", "-w", "--no-filters", "--stdin"], { input: f.text, env: alt }).stdout.trim();
      git(s, ["update-index", "--add", "--cacheinfo", "100644," + oid + "," + f.path], { env: ex });
    }
    const expectedTree = git(s, ["write-tree"], { env: ex }).stdout.trim();
    if (tree !== expectedTree) fail("E_DC_INFRA_MISSING", "export: the commit's tree " + tree + " is not the expected tree " + expectedTree);
    const who = EXPORT_COMMIT.name + " <" + EXPORT_COMMIT.email + "> " + EXPORT_COMMIT.time;
    const body = "tree " + tree + "\nauthor " + who + "\ncommitter " + who + "\n\n" + EXPORT_COMMIT.message;
    const commit = git(s, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: body, env: alt }).stdout.trim();
    const list = git(s, ["rev-list", "--objects", "--no-object-names", commit], { env: alt }).stdout;
    const pack = git(s, ["pack-objects", "--stdout", "-q"], { input: list, env: alt }).out;
    mkdirSync(o.out, { recursive: true });
    git(o.out, ["init", "-q", "--template=", "--initial-branch=" + EXPORT_COMMIT.branch]);
    git(o.out, ["index-pack", "--stdin"], { input: pack });
    git(o.out, ["update-ref", "refs/heads/" + EXPORT_COMMIT.branch, commit]);
    git(o.out, ["read-tree", "-u", "--reset", "HEAD"]);
    const status = git(o.out, ["status", "--porcelain", "--ignored", "--untracked-files=all"]).stdout;
    if (status.trim()) fail("E_DC_INFRA_MISSING", "export: git status --porcelain --ignored is not empty: " + status.trim().split("\n").slice(0, 5).join("; "));
    const manifest: Manifest = {
      base: { pin: pinCommit, tree: pinTree },
      removed: removed.map((r) => ({ path: r.e.path, kind: kindOf(r.e.mode), reason: r.reason, sha256: r.e.mode === "160000" ? r.e.oid : sha256(removedBytes.get(r.e.oid)!) })),
      evidence: o.evidence.map((f) => ({ path: f.path, sha256: sha256(f.text) })),
      tree,
      commit,
      branch: EXPORT_COMMIT.branch,
      digest: hostTreeDigest(o.out),
    };
    return { repo: o.out, manifest, expectedTree };
  } catch (e) {
    rmSync(o.out, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(s, { recursive: true, force: true });
  }
}

/** The manifest's own digest, sealed with the unit (sha256 of its canonical JSON). */
export const manifestDigest = (m: Manifest): string => sha256(JSON.stringify(m));

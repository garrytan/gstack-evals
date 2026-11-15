// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7 rule 1: the arm's change against base from the main checkout's working tree, untracked files included,
// with every nested worktree directory (a directory below the root holding a .git file or folder) left out, and the
// worktree secondary's candidates: each linked worktree's working tree (or its head when its directory is not in the
// captured tree) and each branch beyond base other than the one the main checkout has out. The arm's .git is never run
// as is: git works in a scratch git dir that reads the arm's objects through alternates and takes its HEAD, refs and
// info/exclude, under a config of its own with no hooks, no fsmonitor and no filters, and no system or global config.
// The index starts from base, so the arm's index can change nothing.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { h2hFail } from "../prereg.ts";

export interface Candidate { source: string; patch: string }
export interface TreeCapture {
  base: string;
  main: { patch: string; head: string | null; branch: string | null };
  /** Nested worktree directories left out of the main change, relative to the root; ones the ignore rules already leave
   *  out are not listed. */
  nested_left_out: string[];
  linked: { name: string; path: string | null; in_tree: boolean; head: string | null }[];
  /** The worktree secondary's changes: linked worktrees, then branches beyond base, distinct and not empty. */
  candidates: Candidate[];
}
export interface OpenTree extends TreeCapture {
  /** A file of the base commit, or null when base has no such file. */
  readBase: (path: string) => string | null;
  close: () => void;
}

const CONFIG = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = false\n";

export class Git {
  readonly env: Record<string, string>;
  constructor(readonly dir: string, readonly scratch: string) {
    this.env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: scratch, LC_ALL: "C", GIT_DIR: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  }
  run(args: string[], o: { cwd?: string; index?: string; workTree?: string; ok?: boolean } = {}): { status: number; stdout: string; stderr: string } {
    const env = { ...this.env, ...(o.index ? { GIT_INDEX_FILE: o.index } : {}), ...(o.workTree ? { GIT_WORK_TREE: o.workTree } : {}) };
    const r = spawnSync("git", args, { cwd: o.cwd ?? this.scratch, env, encoding: "utf8", maxBuffer: 1 << 30, timeout: 600_000 });
    const out = { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : "") };
    if (out.status !== 0 && !o.ok) h2hFail("E_H2H_SCORE_CAPTURE", "git " + args.slice(0, 3).join(" ") + " failed (exit " + out.status + "): " + out.stderr.slice(-300));
    return out;
  }
}

/** A scratch git dir over the arm's repository: its objects by alternates, its HEAD, refs, packed refs and info/exclude. */
export function scratchGit(repo: string, scratch: string): Git {
  const arm = join(repo, ".git");
  if (!existsSync(arm) || !lstatSync(arm).isDirectory() || !existsSync(join(arm, "objects"))) h2hFail("E_H2H_SCORE_CAPTURE", repo + " has no .git directory with objects");
  const g = join(scratch, "git");
  mkdirSync(join(g, "objects", "info"), { recursive: true });
  mkdirSync(join(g, "refs"), { recursive: true });
  mkdirSync(join(g, "info"), { recursive: true });
  writeFileSync(join(g, "objects", "info", "alternates"), realpathSync(join(arm, "objects")) + "\n");
  writeFileSync(join(g, "config"), CONFIG);
  writeFileSync(join(g, "HEAD"), existsSync(join(arm, "HEAD")) && lstatSync(join(arm, "HEAD")).isFile() ? readFileSync(join(arm, "HEAD")) : "ref: refs/heads/main\n");
  for (const name of ["refs", "packed-refs", "info/exclude"]) {
    const from = join(arm, name);
    if (!existsSync(from)) continue;
    const st = lstatSync(from);
    if (st.isDirectory()) cpSync(from, join(g, name), { recursive: true, verbatimSymlinks: true });
    else if (st.isFile()) cpSync(from, join(g, name));
  }
  return new Git(g, scratch);
}

/** Directories below root (and outside root's own .git) that hold a .git file or folder, outermost only, not followed
 *  through symlinks. */
export function nestedGitDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    if (dir !== root && names.includes(".git")) {
      out.push(relative(root, dir));
      return;
    }
    for (const n of names.sort()) {
      if (dir === root && n === ".git") continue;
      const p = join(dir, n);
      try {
        if (lstatSync(p).isDirectory()) walk(p);
      } catch {}
    }
  };
  walk(root);
  return out;
}

/** The nested git dirs under workTree that its ignore rules do not already leave out. */
function unignored(git: Git, workTree: string): string[] {
  return nestedGitDirs(workTree).filter((d) => git.run(["check-ignore", "-q", "--no-index", "--", d + "/"], { cwd: workTree, workTree, ok: true }).status !== 0);
}

/** The working tree of workTree against base, untracked files included and the given directories left out, as
 *  git diff --binary prints it. */
function snapshot(git: Git, workTree: string, base: string, leaveOut: readonly string[], tag: string): string {
  const index = join(git.scratch, "index-" + tag);
  git.run(["read-tree", base], { index });
  git.run(["add", "-A", "--", ".", ...leaveOut.map((d) => ":(exclude,literal)" + d)], { cwd: workTree, index, workTree });
  const tree = git.run(["write-tree"], { cwd: workTree, index, workTree }).stdout.trim();
  return git.run(["diff", "--binary", "--no-renames", "--no-color", "--no-ext-diff", base, tree]).stdout;
}

/** Captures a session tree (the repository dir as the session left it, .git included). containerRepoDir maps a linked
 *  worktree's recorded path (inside the session container) to the captured tree. The scratch git dir stays open for
 *  readBase until close. */
export function openTree(repo: string, base: string, o: { containerRepoDir?: string } = {}): OpenTree {
  if (!/^[0-9a-f]{40}$/.test(base)) h2hFail("E_H2H_SCORE_INPUT", "the base commit must be 40 hex, not " + JSON.stringify(base));
  if (!existsSync(repo) || !statSync(repo).isDirectory()) h2hFail("E_H2H_SCORE_INPUT", repo + " is not a directory");
  const scratch = mkdtempSync(join(tmpdir(), "h2h-capture-"));
  const close = () => rmSync(scratch, { recursive: true, force: true });
  try {
    const git = scratchGit(repo, scratch);
    if (git.run(["cat-file", "-e", base + "^{commit}"], { ok: true }).status !== 0) h2hFail("E_H2H_SCORE_CAPTURE", "the session tree no longer holds its base commit " + base);
    const listed = unignored(git, repo);
    const main = snapshot(git, repo, base, listed, "main");
    const branch = git.run(["symbolic-ref", "-q", "HEAD"], { ok: true }).stdout.trim() || null;
    const head = git.run(["rev-parse", "-q", "--verify", "HEAD^{commit}"], { ok: true }).stdout.trim() || null;
    const candidates: Candidate[] = [];
    const seen = new Set<string>([main]);
    const add = (source: string, patch: string) => {
      if (!patch.trim() || seen.has(patch)) return;
      seen.add(patch);
      candidates.push({ source, patch });
    };
    const linked: TreeCapture["linked"] = [];
    const wtRoot = join(repo, ".git", "worktrees");
    const checkedOut = new Set<string>(branch ? [branch] : []);
    for (const name of existsSync(wtRoot) ? readdirSync(wtRoot).sort() : []) {
      const d = join(wtRoot, name);
      const read = (f: string) => (existsSync(join(d, f)) && lstatSync(join(d, f)).isFile() ? readFileSync(join(d, f), "utf8").trim() : "");
      const gitdir = read("gitdir");
      const wtPath = gitdir.replace(/\/\.git$/, "") || null;
      const headText = read("HEAD");
      const ref = headText.startsWith("ref: ") ? headText.slice(5) : null;
      if (ref) checkedOut.add(ref);
      const wtHead = ref ? git.run(["rev-parse", "-q", "--verify", ref + "^{commit}"], { ok: true }).stdout.trim() || null : /^[0-9a-f]{40}$/.test(headText) ? headText : null;
      const rel = wtPath && o.containerRepoDir && wtPath.startsWith(o.containerRepoDir.replace(/\/$/, "") + "/") ? wtPath.slice(o.containerRepoDir.replace(/\/$/, "").length + 1) : null;
      const inTree = !!rel && existsSync(join(repo, rel)) && statSync(join(repo, rel)).isDirectory();
      linked.push({ name, path: wtPath, in_tree: inTree, head: wtHead });
      if (inTree) {
        add("worktree " + name, snapshot(git, join(repo, rel!), base, unignored(git, join(repo, rel!)), "wt-" + linked.length));
      } else if (wtHead && wtHead !== base) add("worktree " + name + " head", git.run(["diff", "--binary", "--no-renames", "--no-color", "--no-ext-diff", base, wtHead]).stdout);
    }
    for (const line of git.run(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]).stdout.split("\n").filter(Boolean)) {
      const [ref, sha] = line.split(" ") as [string, string];
      if (sha === base || checkedOut.has(ref)) continue;
      add("branch " + ref.replace(/^refs\/heads\//, ""), git.run(["diff", "--binary", "--no-renames", "--no-color", "--no-ext-diff", base, sha]).stdout);
    }
    const readBase = (path: string) => {
      const r = git.run(["cat-file", "blob", base + ":" + path], { ok: true });
      return r.status === 0 ? r.stdout : null;
    };
    return { base, main: { patch: main, head, branch }, nested_left_out: listed, linked, candidates, readBase, close };
  } catch (e) {
    close();
    throw e;
  }
}

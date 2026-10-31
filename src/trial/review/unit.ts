// Review unit repositories and trees (plan 2026-10-30-geva-59-stacks-round-1-plan, section 6 and finding T5).
//
// A unit repository holds the PR's head commit and its ancestry, fetched from a local source clone, and nothing else: no
// tags, no remote config, no reflog, no FETCH_HEAD, and gc --prune=now so only reachable objects stay. The head is checked
// out on a head branch. T5: the base branch (the repository's default branch, such as main) and
// refs/remotes/origin/<base branch> sit at the merge-base of head and the unit's base, and refs/remotes/origin/HEAD points
// at it, so a review procedure that asks for origin/<base>, <base> or origin/HEAD finds the PR's base. .gstack-home/ goes
// in .git/info/exclude, since the trial seeds a gstack state root in the work dir. Instruction files the repository
// carries (CLAUDE.md, AGENTS.md, the .gstack/ tree) stay, since they are part of the PR, and their sha256 digests are
// recorded per unit.
//
// A unit tree is the repository plus its dependencies: the install command (bun install --frozen-lockfile by default)
// runs in a builder container on the trial image with egress, at the path the agent sees (/work/<task id>), then the
// unit's own test command runs offline (--network none) on a throwaway copy as the unit-image check. The tree is kept by
// digest (retainTree) and its dirTreeSha256 is the session key's fixture tree.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { dirTreeSha256 } from "../cache.ts";
import { removeTree } from "../cleanup.ts";
import { dockerRun, retainTree, type Retained, type Runner } from "../image.ts";

/** Each repository's default branch: the base branch name a unit repository writes. Override per run when a repository is not listed. */
export const DEFAULT_BRANCHES: Readonly<Record<string, string>> = { "garrytan/gstack": "main", "garrytan/gbrain": "master" };
export const DEFAULT_INSTALL = "bun install --frozen-lockfile";
export const STATE_EXCLUDE = ".gstack-home/";
const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--binary", "--full-index"];
const INSTALL_TIMEOUT_MS = 1_800_000;
const TEST_TIMEOUT_MS = 1_800_000;

export interface UnitRef {
  /** <repo>#<pr>@<first 12 of head>, as in a noloss suite. */
  id: string;
  repo: string;
  pr: number;
  head: string;
  base: string;
}

export interface UnitRepo {
  unit: string;
  dir: string;
  head: string;
  base: string;
  merge_base: string;
  head_branch: string;
  base_branch: string;
  /** The head's ancestry in the source clone: its commit count and the sha256 of the sorted commit list. */
  ancestry: { count: number; sha256: string };
  /** sha256 of git diff <merge-base> <head> in the source clone: the unit's diff. */
  diff_sha256: string;
  /** sha256 of each instruction file the repository carries, by path. */
  instructions: Record<string, string>;
}

export class UnitError extends Error {
  constructor(readonly code: "E_UNIT_REPO" | "E_UNIT_IMAGE", readonly problems: string[]) {
    super(code + ": " + problems.join("; "));
  }
}

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lastLine = (text: string) => text.trim().split("\n").slice(-1)[0] ?? "";
const GIT_ENV = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

function git(dir: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: GIT_ENV });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
}

/** <repo name>-<pr>-<first 8 of head>: the trial's task id, so the agent sees only /work/<id>. */
export const unitTaskId = (unit: Pick<UnitRef, "repo" | "pr" | "head">): string => unit.repo.split("/").pop() + "-" + unit.pr + "-" + unit.head.slice(0, 8);

/** sha256 of each file whose name is CLAUDE.md or AGENTS.md at any depth, and of every file under .gstack/, by repo path. */
export function instructionDigests(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const listed = git(dir, ["ls-files", "-z"]);
  if (listed.status !== 0) throw new UnitError("E_UNIT_REPO", [dir + ": git ls-files: " + lastLine(listed.stderr)]);
  for (const path of listed.stdout.split("\0").filter(Boolean).sort()) {
    const name = path.split("/").pop();
    if (name !== "CLAUDE.md" && name !== "AGENTS.md" && !path.startsWith(".gstack/")) continue;
    const file = join(dir, path);
    if (!existsSync(file) && !lstatSync(file, { throwIfNoEntry: false })) continue;
    out[path] = lstatSync(file).isSymbolicLink() ? sha("symlink:" + readlinkSync(file)) : sha(readFileSync(file));
  }
  return out;
}

/** Builds the unit repository at dest (which must not exist) from a full local clone. Throws UnitError E_UNIT_REPO. */
export function buildUnitRepo(o: { unit: UnitRef; source: string; dest: string; baseBranch?: string }): UnitRepo {
  const { unit } = o;
  const baseBranch = o.baseBranch ?? DEFAULT_BRANCHES[unit.repo];
  const fail = (why: string): never => {
    throw new UnitError("E_UNIT_REPO", [unit.id + ": " + why]);
  };
  if (!baseBranch) fail("no default branch is known for " + unit.repo + "; name its base branch");
  const need = (dir: string, args: readonly string[], what: string): string => {
    const r = git(dir, args);
    if (r.status !== 0) fail(what + ": " + lastLine(r.stderr));
    return r.stdout.trim();
  };
  if (!existsSync(o.source)) fail("no source clone at " + o.source);
  if (need(o.source, ["rev-parse", "--is-shallow-repository"], "the source is not a git repository") === "true") fail("the source clone " + o.source + " is shallow, so the head's ancestry is cut; clone it in full");
  const head = need(o.source, ["rev-parse", "--verify", "--quiet", unit.head + "^{commit}"], "the source clone has no commit " + unit.head);
  const base = need(o.source, ["rev-parse", "--verify", "--quiet", unit.base + "^{commit}"], "the source clone has no base commit " + unit.base);
  const mergeBase = need(o.source, ["merge-base", head, base], "head and base share no merge-base");
  const ancestry = need(o.source, ["rev-list", head], "git rev-list").split("\n").filter(Boolean).sort();
  const diff = git(o.source, [...DIFF, mergeBase, head]);
  if (diff.status !== 0) fail("git diff in the source: " + lastLine(diff.stderr));
  if (existsSync(o.dest)) fail(o.dest + " already exists; a unit repository is built into a new directory");
  mkdirSync(o.dest, { recursive: true });
  const headBranch = "pr-" + unit.pr;
  const steps: Array<[string[], string]> = [
    [["init", "-q", "-b", headBranch], "git init"],
    [["-c", "uploadpack.allowAnySHA1InWant=true", "fetch", "-q", "--no-tags", "--no-write-fetch-head", o.source, head], "fetch the head commit"],
    [["update-ref", "refs/heads/" + headBranch, head], "write the head branch"],
    [["update-ref", "refs/heads/" + baseBranch, mergeBase], "write the base branch"],
    [["update-ref", "refs/remotes/origin/" + baseBranch, mergeBase], "write origin/" + baseBranch],
    [["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/" + baseBranch], "write origin/HEAD"],
    [["reset", "-q", "--hard", head], "check out the head"],
    [["reflog", "expire", "--expire=now", "--all"], "expire the reflog"],
  ];
  for (const [args, what] of steps) need(o.dest, args, what);
  for (const leftover of ["logs", "FETCH_HEAD", "ORIG_HEAD"]) removeTree(join(o.dest, ".git", leftover));
  need(o.dest, ["gc", "-q", "--prune=now"], "git gc");
  removeTree(join(o.dest, ".git", "logs"));
  appendFileSync(join(o.dest, ".git", "info", "exclude"), "\n" + STATE_EXCLUDE + "\n");
  return { unit: unit.id, dir: o.dest, head, base, merge_base: mergeBase, head_branch: headBranch, base_branch: baseBranch!, ancestry: { count: ancestry.length, sha256: sha(ancestry.join("\n")) }, diff_sha256: sha(diff.stdout), instructions: instructionDigests(o.dest) };
}

/** Every way the repository at dir differs from the unit repository that was built: an empty list means it passes. */
export function historyProblems(dir: string, repo: UnitRepo): string[] {
  const problems: string[] = [];
  const out = (args: readonly string[]): string | null => {
    const r = git(dir, args);
    if (r.status !== 0) {
      problems.push("git " + args.join(" ") + " failed: " + lastLine(r.stderr));
      return null;
    }
    return r.stdout.trim();
  };
  const lines = (text: string | null) => (text ?? "").split("\n").filter(Boolean);
  const all = lines(out(["rev-list", "--all"])).sort();
  const ancestry = lines(out(["rev-list", repo.head])).sort();
  if (all.join("\n") !== ancestry.join("\n")) problems.push("git rev-list --all holds " + all.length + " commits, not the head's ancestry of " + ancestry.length);
  if (all.length !== repo.ancestry.count || sha(all.join("\n")) !== repo.ancestry.sha256) problems.push("the commits differ from the head's ancestry in the source clone (" + repo.ancestry.count + " commits)");
  const tags = lines(out(["tag", "-l"]));
  if (tags.length) problems.push("tags present: " + tags.join(", "));
  const remotes = lines(out(["remote"]));
  if (remotes.length) problems.push("remotes configured: " + remotes.join(", "));
  for (const leftover of ["logs", "FETCH_HEAD", "ORIG_HEAD"]) if (existsSync(join(dir, ".git", leftover))) problems.push(".git/" + leftover + " is present");
  const unreachable = lines(out(["fsck", "--unreachable", "--no-reflogs", "--no-progress"])).filter((l) => l.startsWith("unreachable"));
  if (unreachable.length) problems.push(unreachable.length + " unreachable objects");
  const expected = [
    "refs/heads/" + repo.base_branch + " " + repo.merge_base,
    "refs/heads/" + repo.head_branch + " " + repo.head,
    "refs/remotes/origin/" + repo.base_branch + " " + repo.merge_base,
    "refs/remotes/origin/HEAD " + repo.merge_base,
  ].sort();
  const refs = lines(out(["for-each-ref", "--format=%(refname) %(objectname)"])).sort();
  if (refs.join("\n") !== expected.join("\n")) problems.push("refs are " + JSON.stringify(refs) + ", not " + JSON.stringify(expected));
  if (out(["symbolic-ref", "refs/remotes/origin/HEAD"]) !== "refs/remotes/origin/" + repo.base_branch) problems.push("origin/HEAD does not point at origin/" + repo.base_branch);
  if (out(["symbolic-ref", "HEAD"]) !== "refs/heads/" + repo.head_branch) problems.push("HEAD is not the head branch " + repo.head_branch);
  if (out(["rev-parse", "HEAD"]) !== repo.head) problems.push("HEAD is not the head commit");
  for (const name of ["origin/" + repo.base_branch, repo.base_branch, "origin/HEAD"]) {
    const mb = out(["merge-base", "HEAD", name]);
    if (mb !== repo.merge_base) problems.push("git merge-base HEAD " + name + " is " + mb + ", not " + repo.merge_base);
  }
  const diff = git(dir, [...DIFF, repo.base_branch + "...HEAD"]);
  if (diff.status !== 0 || sha(diff.stdout) !== repo.diff_sha256) problems.push("git diff " + repo.base_branch + "...HEAD is not the unit's diff");
  const status = out(["status", "--porcelain"]);
  if (status) problems.push("the working tree is not clean: " + status.split("\n").slice(0, 5).join(", "));
  return problems;
}

export interface UnitTree {
  dir: string;
  tree_sha256: string;
  retained: Retained | null;
  install: { command: string; exit: number | null };
  test: { command: string; exit: number | null; passed: boolean };
  /** Why the tree fails the unit-image check; empty when it passes. */
  problems: string[];
}

const uid = () => (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
const HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges"];

/**
 * Builds the unit tree at dest: the unit repository copied, its install run with egress in a builder container on the
 * trial image at /work/<task id>, then its test command run offline on a throwaway copy under scratch. The tree is kept
 * under retain by digest when retain is set. A failed step is a problem, never a throw, so a run can drop the unit.
 */
export function buildUnitTree(o: { repo: UnitRepo; task: string; dest: string; image: string; test: string; install?: string; scratch: string; retain?: string | null; docker?: string; run?: Runner }): UnitTree {
  const run = o.run ?? dockerRun;
  const docker = o.docker ?? "docker";
  const install = o.install ?? DEFAULT_INSTALL;
  const path = "/work/" + o.task;
  const problems: string[] = [];
  if (existsSync(o.dest)) throw new UnitError("E_UNIT_IMAGE", [o.repo.unit + ": " + o.dest + " already exists"]);
  cpSync(o.repo.dir, o.dest, { recursive: true, verbatimSymlinks: true });
  const step = (dir: string, network: string[], command: string, timeoutMs: number) =>
    run(docker, ["run", "--rm", ...network, "--user", uid(), ...HARDENING, "-e", "HOME=/tmp/home", "-v", dir + ":" + path, "-w", path, "--entrypoint", "sh", o.image, "-c", 'mkdir -p "$HOME" && ' + command], { timeoutMs });
  const installed = step(o.dest, [], install, INSTALL_TIMEOUT_MS);
  if (installed.status !== 0) problems.push("install " + JSON.stringify(install) + " exited " + installed.status + ": " + lastLine(installed.stderr || installed.stdout));
  problems.push(...historyProblems(o.dest, o.repo).map((p) => "after install: " + p));
  const tree_sha256 = dirTreeSha256(o.dest);
  const retained = o.retain ? retainTree(o.dest, o.retain) : null;
  const copy = join(o.scratch, o.task + "-test-" + process.pid);
  removeTree(copy);
  mkdirSync(o.scratch, { recursive: true });
  cpSync(o.dest, copy, { recursive: true, verbatimSymlinks: true });
  let tested: ReturnType<Runner>;
  try {
    tested = step(copy, ["--network", "none"], o.test, TEST_TIMEOUT_MS);
  } finally {
    removeTree(copy);
  }
  if (tested.status !== 0) problems.push("test " + JSON.stringify(o.test) + " exited " + tested.status + " offline: " + lastLine(tested.stderr || tested.stdout));
  return { dir: o.dest, tree_sha256, retained, install: { command: install, exit: installed.status }, test: { command: o.test, exit: tested.status, passed: tested.status === 0 }, problems };
}

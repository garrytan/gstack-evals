// Git and GitHub reads for the review-models unit supply (plan 2026-11-24-geva-590-review-models-prereg, section 2).
// Every read is keyless: git against public clones, and GitHub's REST API through the gh CLI for the dates of review
// comments and pull requests. Clones are bare and partial. Blame needs history blobs, so B clones keep blobs up to 2 MB
// (as the design-stage prototype did); P clones fetch no blobs until a worktree checks some out.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type SupplyCode = "E_RMS_INPUT" | "E_RMS_GIT" | "E_RMS_PENDING" | "E_RMS_FLOOR";
export class SupplyError extends Error {
  constructor(readonly code: SupplyCode, readonly detail: string) {
    super(code + " " + detail);
  }
}
export const supplyFail = (code: SupplyCode, detail: string): never => {
  throw new SupplyError(code, detail);
};

const GIT_ENV = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

export interface GitResult { status: number | null; stdout: string; stderr: string }

export function git(dir: string, args: readonly string[], o: { input?: string; timeoutMs?: number } = {}): GitResult {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", input: o.input, maxBuffer: 1024 * 1024 * 1024, timeout: o.timeoutMs ?? 900_000, env: GIT_ENV });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? r.error?.message ?? "" };
}

/** git's stdout, or SupplyError E_RMS_GIT naming what failed. */
export function gitOut(dir: string, args: readonly string[], what: string, o: { input?: string; timeoutMs?: number } = {}): string {
  const r = git(dir, args, o);
  if (r.status !== 0) supplyFail("E_RMS_GIT", what + ": " + (r.stderr.trim().split("\n").pop() || "git exited " + r.status));
  return r.stdout;
}

const SHA = /^[0-9a-f]{40}$/;
export const hasCommit = (dir: string, sha: string): boolean => git(dir, ["cat-file", "-e", sha + "^{commit}"]).status === 0;

/** Where a repository's clone lives under work. */
export const cloneDir = (work: string, repo: string, kind: "b" | "p"): string => join(work, "clones-" + kind, repo.replace("/", "__") + ".git");

/** A bare partial clone of a public GitHub repository, made once and reused. url overrides the GitHub URL (tests). */
export function ensureClone(work: string, repo: string, kind: "b" | "p", url = "https://github.com/" + repo + ".git"): string {
  const dir = cloneDir(work, repo, kind);
  if (existsSync(join(dir, "HEAD"))) return dir;
  mkdirSync(join(work, "clones-" + kind), { recursive: true });
  gitOut(work, ["clone", "--quiet", "--bare", kind === "b" ? "--filter=blob:limit=2m" : "--filter=blob:none", url, dir], "clone " + repo, { timeoutMs: 3_600_000 });
  return dir;
}

/** Fetches each sha, or ref such as refs/pull/<n>/head, that the clone lacks. Returns the ones still missing. */
export function ensureObjects(dir: string, wanted: readonly string[]): string[] {
  const missing: string[] = [];
  for (const w of wanted) {
    if (SHA.test(w) && hasCommit(dir, w)) continue;
    const r = git(dir, ["fetch", "--quiet", "--no-tags", "origin", SHA.test(w) ? w : "+" + w + ":" + w], { timeoutMs: 1_800_000 });
    if (r.status !== 0 || (SHA.test(w) && !hasCommit(dir, w))) missing.push(w);
  }
  return missing;
}

/** The clone's default branch name (a bare clone's HEAD). */
export const defaultBranch = (dir: string): string => gitOut(dir, ["symbolic-ref", "--short", "HEAD"], "read the default branch").trim();

export interface CommitDates { author: string; committer: string }
/** A commit's author and committer dates, ISO 8601 with offset. */
export function commitDates(dir: string, sha: string): CommitDates {
  const [author = "", committer = ""] = gitOut(dir, ["show", "-s", "--format=%aI%x09%cI", sha], "read the dates of " + sha).trim().split("\t");
  return { author, committer };
}

/** The paths a commit changes against its first parent (all paths for a root commit). */
export const changedPaths = (dir: string, sha: string): string[] =>
  gitOut(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha], "list the paths of " + sha).split("\n").filter(Boolean);

/** What the supply reads about one pull request: when it opened, its commits oldest first, and each review comment's date. */
export interface PrFacts { created_at: string; commits: string[]; comments: Record<string, string> }
/** A pull request's facts, or null when GitHub has no such pull request. Tests pass a stub. */
export type GithubReader = (repo: string, pr: number) => PrFacts | null;

const PR_QUERY = "query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){createdAt commits(first:100){totalCount nodes{commit{oid}}} reviewThreads(first:100){nodes{comments(first:100){nodes{databaseId createdAt}}}}}}}";

/** GitHub's GraphQL API through the gh CLI: its REST reads of other owners' repositories go out unauthenticated here and
 *  hit the 60-an-hour limit, while GraphQL carries the account's token. */
export const ghPr: GithubReader = (repo, pr) => {
  const [owner, name] = repo.split("/");
  const r = spawnSync("gh", ["api", "graphql", "-f", "query=" + PR_QUERY, "-F", "owner=" + owner, "-F", "name=" + name, "-F", "pr=" + pr], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  const body = r.status === 0 ? JSON.parse(r.stdout) : null;
  const p = body?.data?.repository?.pullRequest;
  if (!p) {
    if (/Could not resolve to a PullRequest|NOT_FOUND/.test((r.stdout ?? "") + (r.stderr ?? ""))) return null;
    return supplyFail("E_RMS_GIT", "gh api graphql for " + repo + "#" + pr + ": " + ((r.stderr ?? "").trim().split("\n").pop() || "no pull request in the reply"));
  }
  if (p.commits.totalCount > 100) supplyFail("E_RMS_GIT", repo + "#" + pr + " has " + p.commits.totalCount + " commits, more than the 100 the read lists");
  const comments: Record<string, string> = {};
  for (const t of p.reviewThreads.nodes) for (const c of t.comments.nodes) comments[String(c.databaseId)] = c.createdAt;
  return { created_at: p.createdAt, commits: p.commits.nodes.map((n: any) => n.commit.oid), comments };
};

// The gh surface the sandbox serves (lanes/real-outcome/sandbox/README.md, "The gh surface"). Every call arrives from the
// in-container stub with its argv, the current branch and any body text the stub read from a file or stdin, and runs here,
// against the trial's evaluator-owned origin and pull request store. Calls outside the surface print gh's own kind of
// error, exit 1 and are journaled as rig errors (plan open item 1, pilot stop (a)). Merges are refused and journaled.
import { spawnSync } from "node:child_process";
import type { JournalEvent } from "./shipment.ts";

export type Visibility = "PUBLIC" | "PRIVATE";

export interface Pr {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  labels: string[];
  comments: { body: string; createdAt: string }[];
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  comments: { body: string; createdAt: string }[];
}

type NewEvent = { [K in JournalEvent["type"]]: Omit<Extract<JournalEvent, { type: K }>, "seq" | "t"> }[JournalEvent["type"]];

export interface GhContext {
  repo: string;
  baseBranch: string;
  visibility: Visibility;
  origin: string;
  prs: Pr[];
  issues: Issue[];
  journal: (e: NewEvent) => void;
  /** Deletes a branch on the origin and journals it as a ref change made through gh. */
  deleteBranch: (branch: string) => void;
  now: () => string;
}

export interface GhRequest {
  argv: string[];
  stdin?: string;
  branch?: string | null;
}

export interface GhResponse {
  stdout: string;
  stderr: string;
  exit: number;
}

const URL_BASE = "https://sandbox.invalid/";
const LOGIN = "sandbox-user";

export const git = (dir: string, args: string[], input?: string) =>
  spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", input, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", LANG: "C" }, maxBuffer: 256 * 1024 * 1024 });

export const refSha = (origin: string, ref: string): string | null => {
  const r = git(origin, ["rev-parse", "--verify", "-q", ref + "^{commit}"]);
  return r.status === 0 ? r.stdout.trim() : null;
};

class Fail extends Error {
  constructor(message: string, readonly rig: string | null = null, readonly exit = 1) {
    super(message);
  }
}

interface FlagSpec {
  [name: string]: { alias?: string; value: boolean; many?: boolean };
}

interface Parsed {
  flags: Map<string, string[]>;
  pos: string[];
}

/** gh's flag shapes: --name value, --name=value, -x value, -xvalue for value flags; booleans take no value. */
function parse(args: string[], spec: FlagSpec): Parsed {
  const flags = new Map<string, string[]>();
  const pos: string[] = [];
  const byAlias = new Map<string, string>();
  for (const [name, s] of Object.entries(spec)) if (s.alias) byAlias.set(s.alias, name);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      pos.push(...args.slice(i + 1));
      break;
    }
    let name: string | undefined;
    let inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq > 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq > 0 ? a.slice(eq + 1) : undefined;
    } else if (a.startsWith("-") && a.length > 1) {
      name = byAlias.get(a[1]!);
      if (!name) throw new Fail("unknown shorthand flag: '" + a[1] + "' in " + a, "gh_unknown_flag");
      inline = a.length > 2 ? a.slice(2).replace(/^=/, "") : undefined;
    } else {
      pos.push(a);
      continue;
    }
    const s = spec[name];
    if (!s) throw new Fail("unknown flag: --" + name, "gh_unknown_flag");
    let value = "true";
    if (s.value) {
      if (inline !== undefined) value = inline;
      else if (i + 1 < args.length) value = args[++i]!;
      else throw new Fail("flag needs an argument: --" + name);
    } else if (inline !== undefined) value = inline;
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { flags, pos };
}

const one = (p: Parsed, name: string): string | undefined => p.flags.get(name)?.at(-1);
const has = (p: Parsed, name: string): boolean => p.flags.has(name) && one(p, name) !== "false";

const JSON_FLAGS: FlagSpec = { json: { value: true }, jq: { alias: "q", value: true }, template: { alias: "t", value: true } };

/** jq by absolute path, run with an empty environment: an agent's --jq expression can read env and $ENV, so it must see nothing of the sidecar's. */
const JQ = Bun.which("jq");

function jq(input: unknown, expr: string): string {
  if (JQ === null) throw new Fail("jq is not available to the sandbox", "jq_missing");
  const r = spawnSync(JQ, ["-r", expr], { encoding: "utf8", input: JSON.stringify(input), env: {} });
  if (r.error) throw new Fail("jq is not available to the sandbox: " + r.error.message, "jq_missing");
  if (r.status !== 0) throw new Fail("failed to parse jq expression (line 1, column 1)\n" + r.stderr.trim());
  return r.stdout;
}

/** gh checks --json fields when it parses flags, before it looks anything up. */
function checkFields(p: Parsed, fields: readonly string[]): void {
  const raw = one(p, "json");
  const unknown = raw === undefined || raw === "true" ? [] : raw.split(",").map((f) => f.trim()).filter((f) => f && !fields.includes(f));
  if (unknown.length) throw new Fail("Unknown JSON field: " + JSON.stringify(unknown[0]) + "\nAvailable fields:\n  " + [...fields].sort().join("\n  "), "gh_unknown_field");
}

/** Projects --json fields, then --jq, the way gh prints them. */
function emit(p: Parsed, value: Record<string, unknown> | Record<string, unknown>[], fields: readonly string[]): string {
  if (p.flags.has("template")) throw new Fail("--template is not available in this sandbox", "gh_unknown_flag");
  const raw = one(p, "json");
  if (raw === undefined || raw === "true") {
    if (p.flags.has("json")) throw new Fail("Specify one or more comma-separated fields for `--json`:\n  " + [...fields].sort().join("\n  "));
    throw new Fail("internal: no --json");
  }
  const want = raw.split(",").map((f) => f.trim()).filter(Boolean);
  const unknown = want.filter((f) => !fields.includes(f));
  if (unknown.length) throw new Fail("Unknown JSON field: " + JSON.stringify(unknown[0]) + "\nAvailable fields:\n  " + [...fields].sort().join("\n  "), "gh_unknown_field");
  const pick = (o: Record<string, unknown>) => Object.fromEntries(want.map((f) => [f, o[f]]));
  const out = Array.isArray(value) ? value.map(pick) : pick(value);
  const expr = one(p, "jq");
  return expr === undefined ? JSON.stringify(out, null, 2) + "\n" : jq(out, expr);
}

const repoFields = ["name", "nameWithOwner", "owner", "url", "defaultBranchRef", "visibility", "isPrivate", "description", "isFork", "isArchived", "isEmpty", "viewerPermission", "sshUrl", "id", "homepageUrl", "parent"] as const;
const prFields = ["number", "title", "body", "url", "state", "isDraft", "headRefName", "baseRefName", "headRefOid", "baseRefOid", "author", "createdAt", "updatedAt", "closed", "closedAt", "merged", "mergedAt", "mergedBy", "mergeable", "mergeStateStatus", "reviewDecision", "comments", "reviews", "reviewRequests", "labels", "assignees", "statusCheckRollup", "id", "isCrossRepository", "headRepository", "headRepositoryOwner", "additions", "deletions", "changedFiles", "files", "commits", "latestReviews", "milestone", "autoMergeRequest"] as const;
const issueFields = ["number", "title", "body", "url", "state", "author", "createdAt", "updatedAt", "comments", "labels", "assignees", "closed", "id"] as const;

function repoJson(ctx: GhContext) {
  const [owner, name] = ctx.repo.split("/");
  return { name, nameWithOwner: ctx.repo, owner: { login: owner }, url: URL_BASE + ctx.repo, defaultBranchRef: { name: ctx.baseBranch }, visibility: ctx.visibility, isPrivate: ctx.visibility === "PRIVATE", description: "", isFork: false, isArchived: false, isEmpty: false, viewerPermission: "ADMIN", sshUrl: "git@sandbox.invalid:" + ctx.repo + ".git", id: "R_sandbox", homepageUrl: "", parent: null };
}

const prUrl = (ctx: GhContext, n: number) => URL_BASE + ctx.repo + "/pull/" + n;

function prJson(ctx: GhContext, pr: Pr) {
  const head = refSha(ctx.origin, "refs/heads/" + pr.head);
  const base = refSha(ctx.origin, "refs/heads/" + pr.base);
  const stat = head && base ? git(ctx.origin, ["diff", "--numstat", base + "..." + head]).stdout.trim() : "";
  const files = stat ? stat.split("\n").map((l) => l.split("\t")).map(([a, d, path]) => ({ path, additions: Number(a) || 0, deletions: Number(d) || 0 })) : [];
  const log = head && base ? git(ctx.origin, ["log", "--format=%H%x09%s", base + ".." + head]).stdout.trim() : "";
  const commits = log ? log.split("\n").map((l) => ({ oid: l.slice(0, 40), messageHeadline: l.slice(41) })) : [];
  const comments = pr.comments.map((c) => ({ author: { login: LOGIN }, body: c.body, createdAt: c.createdAt }));
  return {
    number: pr.number, title: pr.title, body: pr.body, url: prUrl(ctx, pr.number), state: pr.state, isDraft: pr.draft, headRefName: pr.head, baseRefName: pr.base, headRefOid: head ?? "", baseRefOid: base ?? "",
    author: { login: LOGIN }, createdAt: pr.createdAt, updatedAt: pr.updatedAt, closed: pr.state !== "OPEN", closedAt: null, merged: false, mergedAt: null, mergedBy: null, mergeable: "MERGEABLE", mergeStateStatus: pr.draft ? "DRAFT" : "CLEAN",
    reviewDecision: "", comments, reviews: [], reviewRequests: [], labels: pr.labels.map((name) => ({ name })), assignees: [], statusCheckRollup: [], id: "PR_" + pr.number, isCrossRepository: false,
    headRepository: { name: ctx.repo.split("/")[1] }, headRepositoryOwner: { login: ctx.repo.split("/")[0] }, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0), changedFiles: files.length, files, commits, latestReviews: [], milestone: null, autoMergeRequest: null,
  };
}

function issueJson(ctx: GhContext, i: Issue) {
  return { number: i.number, title: i.title, body: i.body, url: URL_BASE + ctx.repo + "/issues/" + i.number, state: i.state, author: { login: LOGIN }, createdAt: i.createdAt, updatedAt: i.createdAt, comments: i.comments.map((c) => ({ author: { login: LOGIN }, body: c.body, createdAt: c.createdAt })), labels: [], assignees: [], closed: i.state !== "OPEN", id: "I_" + i.number };
}

function checkRepo(ctx: GhContext, p: Parsed): void {
  const r = one(p, "repo");
  if (r !== undefined && r.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") !== ctx.repo) {
    ctx.journal({ type: "refused", kind: "foreign_repo", detail: "gh --repo " + r });
    throw new Fail("GraphQL: Could not resolve to a Repository with the name '" + r + "'. (repository)");
  }
}

/** The pull request a gh pr subcommand names: a number, #number, URL or branch, or the current branch's open one. */
function findPr(ctx: GhContext, arg: string | undefined, branch: string | null | undefined): Pr {
  const n = arg?.match(/^(?:#)?(\d+)$/)?.[1] ?? arg?.match(/\/pull\/(\d+)/)?.[1];
  if (n !== undefined) {
    const pr = ctx.prs.find((x) => x.number === Number(n));
    if (!pr) throw new Fail("GraphQL: Could not resolve to a PullRequest with the number of " + n + ". (repository.pullRequest)");
    return pr;
  }
  const b = arg ?? branch;
  if (!b) throw new Fail("could not determine current branch: not on any branch");
  const pr = [...ctx.prs].reverse().find((x) => x.head === b && x.state === "OPEN") ?? [...ctx.prs].reverse().find((x) => x.head === b);
  if (!pr) throw new Fail('no pull requests found for branch "' + b + '"');
  return pr;
}

function touch(ctx: GhContext, pr: Pr) {
  pr.updatedAt = ctx.now();
}

function prCmd(ctx: GhContext, sub: string, args: string[], req: GhRequest): string {
  const R = { repo: { alias: "R", value: true } } as const;
  switch (sub) {
    case "create": {
      const p = parse(args, { ...R, title: { alias: "t", value: true }, body: { alias: "b", value: true }, base: { alias: "B", value: true }, head: { alias: "H", value: true }, draft: { alias: "d", value: false }, fill: { alias: "f", value: false }, "fill-first": { value: false }, "fill-verbose": { value: false }, label: { alias: "l", value: true }, assignee: { alias: "a", value: true }, reviewer: { alias: "r", value: true }, milestone: { alias: "m", value: true }, project: { alias: "p", value: true }, "no-maintainer-edit": { value: false }, "dry-run": { value: false }, web: { alias: "w", value: false }, editor: { alias: "e", value: false }, template: { alias: "T", value: true } });
      checkRepo(ctx, p);
      if (has(p, "web") || has(p, "editor")) throw new Fail("--web and --editor are not available in this sandbox", "gh_unknown_flag");
      const base = one(p, "base") ?? ctx.baseBranch;
      const head = (one(p, "head") ?? req.branch ?? "").replace(/^[^:]+:/, "");
      if (!head) throw new Fail("could not determine the current branch; use --head");
      const headSha = refSha(ctx.origin, "refs/heads/" + head);
      if (!headSha) throw new Fail("aborted: you must first push the current branch to a remote, or use the --head flag");
      const baseSha = refSha(ctx.origin, "refs/heads/" + base);
      if (!baseSha) throw new Fail("pull request create failed: GraphQL: Base ref must be a branch (createPullRequest)");
      if (head === base || git(ctx.origin, ["rev-list", "--count", baseSha + ".." + headSha]).stdout.trim() === "0") throw new Fail("pull request create failed: GraphQL: No commits between " + base + " and " + head + " (createPullRequest)");
      const existing = ctx.prs.find((x) => x.head === head && x.base === base && x.state === "OPEN");
      if (existing) throw new Fail('a pull request for branch "' + head + '" into branch "' + base + '" already exists:\n' + prUrl(ctx, existing.number));
      let title = one(p, "title");
      let body = one(p, "body");
      if (has(p, "fill") || has(p, "fill-first") || has(p, "fill-verbose")) {
        const msgs = git(ctx.origin, ["log", "--reverse", "--format=%s%x00%b%x01", baseSha + ".." + headSha]).stdout.split("\x01").map((m) => m.trim()).filter(Boolean).map((m) => m.split("\x00"));
        title ??= msgs.length === 1 || has(p, "fill-first") ? msgs[0]![0]! : head;
        body ??= msgs.length === 1 || has(p, "fill-first") ? (msgs[0]![1] ?? "").trim() : msgs.map((m) => "- " + m[0]).join("\n");
      }
      if (title === undefined || body === undefined) throw new Fail("must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively");
      if (has(p, "dry-run")) return "Would have created a Pull Request with:\nTitle: " + title + "\nDraft: " + has(p, "draft") + "\nBase: " + base + "\nHead: " + head + "\n";
      const number = ctx.prs.length + ctx.issues.length + 1;
      const now = ctx.now();
      const pr: Pr = { number, title, body, head, base, draft: has(p, "draft"), state: "OPEN", createdAt: now, updatedAt: now, labels: p.flags.get("label") ?? [], comments: [] };
      ctx.prs.push(pr);
      ctx.journal({ type: "pr_create", number, head, base, draft: pr.draft, title });
      return prUrl(ctx, number) + "\n";
    }
    case "view": {
      const p = parse(args, { ...R, ...JSON_FLAGS, comments: { alias: "c", value: false }, web: { alias: "w", value: false } });
      checkRepo(ctx, p);
      if (has(p, "web")) throw new Fail("--web is not available in this sandbox", "gh_unknown_flag");
      checkFields(p, prFields);
      const pr = findPr(ctx, p.pos[0], req.branch);
      if (p.flags.has("json") || p.flags.has("jq")) return emit(p, prJson(ctx, pr), prFields);
      const j = prJson(ctx, pr);
      return "title:\t" + pr.title + "\nstate:\t" + (pr.draft ? "DRAFT" : pr.state) + "\nauthor:\t" + LOGIN + "\nlabels:\t" + pr.labels.join(", ") + "\nnumber:\t" + pr.number + "\nurl:\t" + j.url + "\nadditions:\t" + j.additions + "\ndeletions:\t" + j.deletions + "\n--\n" + pr.body + "\n";
    }
    case "list": {
      const p = parse(args, { ...R, ...JSON_FLAGS, head: { alias: "H", value: true }, base: { alias: "B", value: true }, state: { alias: "s", value: true }, limit: { alias: "L", value: true }, search: { alias: "S", value: true }, label: { alias: "l", value: true }, author: { alias: "A", value: true }, draft: { alias: "d", value: false }, web: { alias: "w", value: false } });
      checkRepo(ctx, p);
      checkFields(p, prFields);
      const state = (one(p, "state") ?? "open").toLowerCase();
      if (!["open", "closed", "merged", "all"].includes(state)) throw new Fail("invalid argument " + JSON.stringify(state) + " for \"-s, --state\" flag");
      const search = one(p, "search");
      const list = [...ctx.prs].reverse().filter((x) => (state === "all" || (state === "open" ? x.state === "OPEN" : state === "closed" ? x.state === "CLOSED" : false)) && (one(p, "head") === undefined || x.head === one(p, "head")) && (one(p, "base") === undefined || x.base === one(p, "base")) && (!p.flags.has("draft") || x.draft) && (search === undefined || state !== "merged")).slice(0, Number(one(p, "limit") ?? 30));
      if (p.flags.has("json") || p.flags.has("jq")) return emit(p, list.map((x) => prJson(ctx, x)), prFields);
      if (!list.length) return "";
      return list.map((x) => [x.number, x.title, x.head, x.draft ? "DRAFT" : x.state, x.createdAt].join("\t")).join("\n") + "\n";
    }
    case "edit": {
      const p = parse(args, { ...R, title: { alias: "t", value: true }, body: { alias: "b", value: true }, base: { alias: "B", value: true }, "add-label": { value: true }, "remove-label": { value: true }, "add-reviewer": { value: true }, "remove-reviewer": { value: true }, "add-assignee": { value: true }, "remove-assignee": { value: true }, milestone: { alias: "m", value: true }, "add-project": { value: true }, "remove-project": { value: true } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      const fields: string[] = [];
      if (one(p, "title") !== undefined) (pr.title = one(p, "title")!), fields.push("title");
      if (one(p, "body") !== undefined) (pr.body = one(p, "body")!), fields.push("body");
      const base = one(p, "base");
      if (base !== undefined) {
        if (!refSha(ctx.origin, "refs/heads/" + base)) throw new Fail("GraphQL: Base ref must be a branch (updatePullRequest)");
        pr.base = base;
        fields.push("base");
      }
      for (const l of p.flags.get("add-label") ?? []) pr.labels.push(...l.split(","));
      for (const l of p.flags.get("remove-label") ?? []) pr.labels = pr.labels.filter((x) => !l.split(",").includes(x));
      for (const k of ["add-label", "remove-label", "add-reviewer", "remove-reviewer", "add-assignee", "remove-assignee", "milestone", "add-project", "remove-project"]) if (p.flags.has(k)) fields.push(k);
      touch(ctx, pr);
      ctx.journal({ type: "pr_edit", number: pr.number, fields, ...(base !== undefined ? { base } : {}) });
      return prUrl(ctx, pr.number) + "\n";
    }
    case "ready": {
      const p = parse(args, { ...R, undo: { value: false } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      pr.draft = has(p, "undo");
      touch(ctx, pr);
      ctx.journal({ type: "pr_draft", number: pr.number, draft: pr.draft });
      return "";
    }
    case "close":
    case "reopen": {
      const p = parse(args, { ...R, comment: { alias: "c", value: true }, "delete-branch": { alias: "d", value: false } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      pr.state = sub === "close" ? "CLOSED" : "OPEN";
      touch(ctx, pr);
      ctx.journal({ type: "pr_state", number: pr.number, state: sub === "close" ? "closed" : "open" });
      if (sub === "close" && has(p, "delete-branch")) ctx.deleteBranch(pr.head);
      return "";
    }
    case "comment": {
      const p = parse(args, { ...R, body: { alias: "b", value: true }, "edit-last": { value: false } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      const body = one(p, "body");
      if (body === undefined) throw new Fail("--body or --body-file required when not running interactively");
      pr.comments.push({ body, createdAt: ctx.now() });
      touch(ctx, pr);
      ctx.journal({ type: "pr_comment", number: pr.number, action: "comment" });
      return prUrl(ctx, pr.number) + "#issuecomment-" + pr.comments.length + "\n";
    }
    case "diff": {
      const p = parse(args, { ...R, "name-only": { value: false }, patch: { value: false }, color: { value: true } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      const range = (refSha(ctx.origin, "refs/heads/" + pr.base) ?? "") + "..." + (refSha(ctx.origin, "refs/heads/" + pr.head) ?? "");
      return git(ctx.origin, ["diff", ...(has(p, "name-only") ? ["--name-only"] : []), range]).stdout;
    }
    case "checks": {
      const p = parse(args, { ...R, ...JSON_FLAGS, watch: { value: false }, required: { value: false }, "fail-fast": { value: false }, interval: { alias: "i", value: true } });
      checkRepo(ctx, p);
      const pr = findPr(ctx, p.pos[0], req.branch);
      throw new Fail("no checks reported on the '" + pr.head + "' branch");
    }
    case "merge": {
      ctx.journal({ type: "merge_attempt", via: "gh pr merge", argv: ["pr", "merge", ...args] });
      throw new Fail("merging is not available in this sandbox: the pull request stays open for review");
    }
    default:
      throw new Fail('unknown command "' + sub + '" for "gh pr"', "gh_unknown");
  }
}

function repoCmd(ctx: GhContext, sub: string, args: string[]): string {
  if (sub !== "view") throw new Fail('unknown command "' + sub + '" for "gh repo"', "gh_unknown");
  const p = parse(args, { ...JSON_FLAGS, web: { alias: "w", value: false }, branch: { alias: "b", value: true } });
  if (has(p, "web")) throw new Fail("--web is not available in this sandbox", "gh_unknown_flag");
  if (p.pos[0] !== undefined && p.pos[0].replace(/\.git$/, "") !== ctx.repo) {
    ctx.journal({ type: "refused", kind: "foreign_repo", detail: "gh repo view " + p.pos[0] });
    throw new Fail("GraphQL: Could not resolve to a Repository with the name '" + p.pos[0] + "'. (repository)");
  }
  if (p.flags.has("json") || p.flags.has("jq")) return emit(p, repoJson(ctx), repoFields);
  return "name:\t" + ctx.repo + "\ndescription:\t\n--\n";
}

function issueCmd(ctx: GhContext, sub: string, args: string[]): string {
  const R = { repo: { alias: "R", value: true } } as const;
  if (sub === "create") {
    const p = parse(args, { ...R, title: { alias: "t", value: true }, body: { alias: "b", value: true }, label: { alias: "l", value: true }, assignee: { alias: "a", value: true }, milestone: { alias: "m", value: true }, project: { alias: "p", value: true } });
    checkRepo(ctx, p);
    if (one(p, "title") === undefined || one(p, "body") === undefined) throw new Fail("must provide `--title` and `--body` when not running interactively");
    const number = ctx.prs.length + ctx.issues.length + 1;
    ctx.issues.push({ number, title: one(p, "title")!, body: one(p, "body")!, state: "OPEN", createdAt: ctx.now(), comments: [] });
    ctx.journal({ type: "issue", number, action: "create" });
    return URL_BASE + ctx.repo + "/issues/" + number + "\n";
  }
  if (sub === "list") {
    const p = parse(args, { ...R, ...JSON_FLAGS, state: { alias: "s", value: true }, search: { alias: "S", value: true }, limit: { alias: "L", value: true }, label: { alias: "l", value: true }, author: { alias: "A", value: true } });
    checkRepo(ctx, p);
    const state = (one(p, "state") ?? "open").toLowerCase();
    const list = [...ctx.issues].reverse().filter((i) => state === "all" || (state === "open") === (i.state === "OPEN")).slice(0, Number(one(p, "limit") ?? 30));
    if (p.flags.has("json") || p.flags.has("jq")) return emit(p, list.map((i) => issueJson(ctx, i)), issueFields);
    return list.map((i) => [i.number, i.state, i.title].join("\t")).join("\n") + (list.length ? "\n" : "");
  }
  if (sub === "view" || sub === "comment") {
    const p = parse(args, sub === "view" ? { ...R, ...JSON_FLAGS, comments: { alias: "c", value: false } } : { ...R, body: { alias: "b", value: true } });
    checkRepo(ctx, p);
    const n = Number(p.pos[0]?.replace(/^#/, "").replace(/.*\/issues\//, ""));
    const issue = ctx.issues.find((i) => i.number === n);
    if (!issue) throw new Fail("GraphQL: Could not resolve to an issue or pull request with the number of " + p.pos[0] + ". (repository.issue)");
    if (sub === "comment") {
      if (one(p, "body") === undefined) throw new Fail("--body or --body-file required when not running interactively");
      issue.comments.push({ body: one(p, "body")!, createdAt: ctx.now() });
      ctx.journal({ type: "issue", number: n, action: "comment" });
      return URL_BASE + ctx.repo + "/issues/" + n + "#issuecomment-" + issue.comments.length + "\n";
    }
    if (p.flags.has("json") || p.flags.has("jq")) return emit(p, issueJson(ctx, issue), issueFields);
    return "title:\t" + issue.title + "\nstate:\t" + issue.state + "\n--\n" + issue.body + "\n";
  }
  throw new Fail('unknown command "' + sub + '" for "gh issue"', "gh_unknown");
}

/** gh api, for the REST paths /ship's helpers read and write. Anything else is a 404 and a rig error. */
function apiCmd(ctx: GhContext, args: string[]): string {
  const p = parse(args, { method: { alias: "X", value: true }, field: { alias: "F", value: true }, "raw-field": { alias: "f", value: true }, header: { alias: "H", value: true }, jq: { alias: "q", value: true }, silent: { value: false }, paginate: { value: false }, input: { value: true }, include: { alias: "i", value: false }, hostname: { value: true }, "cache": { value: true }, slurp: { value: false } });
  const method = (one(p, "method") ?? (p.flags.has("field") || p.flags.has("raw-field") || p.flags.has("input") ? "POST" : "GET")).toUpperCase();
  const [owner, name] = ctx.repo.split("/");
  const path = (p.pos[0] ?? "").replace(/^\//, "").replaceAll("{owner}", owner!).replaceAll("{repo}", name!).split("?")[0]!;
  const fields: Record<string, string> = {};
  for (const f of [...(p.flags.get("field") ?? []), ...(p.flags.get("raw-field") ?? [])]) {
    const eq = f.indexOf("=");
    if (eq > 0) fields[f.slice(0, eq)] = f.slice(eq + 1);
  }
  if (p.flags.has("input")) Object.assign(fields, JSON.parse(one(p, "input") || "{}"));
  const out = (v: unknown) => (has(p, "silent") ? "" : one(p, "jq") !== undefined ? jq(v, one(p, "jq")!) : JSON.stringify(v, null, 2) + "\n");
  const repoPath = "repos/" + ctx.repo;
  const rest = (pr: Pr) => {
    const j = prJson(ctx, pr);
    return { number: pr.number, title: pr.title, body: pr.body, state: pr.state === "OPEN" ? "open" : "closed", draft: pr.draft, merged: false, html_url: j.url, url: j.url, head: { ref: pr.head, sha: j.headRefOid }, base: { ref: pr.base, sha: j.baseRefOid }, user: { login: LOGIN }, created_at: pr.createdAt, updated_at: pr.updatedAt };
  };
  if (path === "rate_limit" && method === "GET") return out({ resources: { core: { limit: 5000, remaining: 5000, reset: 0 } }, rate: { limit: 5000, remaining: 5000, reset: 0 } });
  if (path === "user" && method === "GET") return out({ login: LOGIN, id: 1, type: "User" });
  if (path === repoPath && method === "GET") return out({ name, full_name: ctx.repo, default_branch: ctx.baseBranch, private: ctx.visibility === "PRIVATE", visibility: ctx.visibility.toLowerCase(), html_url: URL_BASE + ctx.repo, owner: { login: owner } });
  if (path === repoPath + "/pulls" && method === "GET") return out([...ctx.prs].reverse().filter((x) => x.state === "OPEN").map(rest));
  const m = path.slice(repoPath.length).match(/^\/(pulls|issues)\/(\d+)(\/.*)?$/);
  if (path.startsWith(repoPath + "/") && m) {
    const n = Number(m[2]);
    const tail = m[3] ?? "";
    if (/^\/merge$/.test(tail) || (m[1] === "pulls" && fields.merged !== undefined)) {
      ctx.journal({ type: "merge_attempt", via: "gh api", argv: ["api", ...args] });
      throw new Fail("gh: Merging is not available in this sandbox (HTTP 405)");
    }
    const pr = ctx.prs.find((x) => x.number === n);
    if (m[1] === "pulls" && pr && tail === "" && method === "GET") return out(rest(pr));
    if (m[1] === "pulls" && pr && tail === "" && method === "PATCH") {
      const changed: string[] = [];
      if (fields.title !== undefined) (pr.title = fields.title), changed.push("title");
      if (fields.body !== undefined) (pr.body = fields.body), changed.push("body");
      if (fields.base !== undefined) {
        if (!refSha(ctx.origin, "refs/heads/" + fields.base)) throw new Fail("gh: Validation Failed (HTTP 422)");
        pr.base = fields.base;
        changed.push("base");
      }
      if (fields.state !== undefined) {
        pr.state = fields.state === "closed" ? "CLOSED" : "OPEN";
        touch(ctx, pr);
        ctx.journal({ type: "pr_state", number: pr.number, state: pr.state === "OPEN" ? "open" : "closed" });
      }
      if (changed.length) {
        touch(ctx, pr);
        ctx.journal({ type: "pr_edit", number: pr.number, fields: changed, ...(fields.base !== undefined ? { base: fields.base } : {}) });
      }
      return out(rest(pr));
    }
    const target = pr ?? ctx.issues.find((i) => i.number === n);
    if (target && /^\/(reviews|requested_reviewers)$/.test(tail) && method === "GET") return out([]);
    if (target && /^\/comments$/.test(tail) && method === "GET") return out(target.comments.map((c, i) => ({ id: i + 1, body: c.body, user: { login: LOGIN }, created_at: c.createdAt })));
    if (target && (/^\/comments$/.test(tail) || /^\/comments\/\d+\/replies$/.test(tail)) && method === "POST") {
      target.comments.push({ body: fields.body ?? "", createdAt: ctx.now() });
      if (pr) touch(ctx, pr);
      ctx.journal(pr ? { type: "pr_comment", number: n, action: "comment" } : { type: "issue", number: n, action: "comment" });
      return out({ id: target.comments.length, body: fields.body ?? "" });
    }
  }
  const c = path.slice(repoPath.length).match(/^\/commits\/([0-9a-fA-F]{4,40}|[\w./-]+?)(\/check-runs|\/status|\/statuses)?$/);
  if (path.startsWith(repoPath + "/") && c && method === "GET") {
    if (c[2] === "/check-runs") return out({ total_count: 0, check_runs: [] });
    if (c[2]) return out({ state: "pending", total_count: 0, statuses: [], sha: c[1] });
    const info = git(ctx.origin, ["show", "-s", "--format=%H%x00%cI%x00%B", c[1] + "^{commit}"]);
    if (info.status !== 0) throw new Fail("gh: No commit found for SHA: " + c[1] + " (HTTP 422)");
    const [sha, date, message] = info.stdout.split("\x00");
    return out({ sha, commit: { message: (message ?? "").trim(), committer: { date }, author: { date } } });
  }
  throw new Fail("gh: Not Found (HTTP 404)", "gh_unknown");
}

/** Runs one gh call from the stub. Every call is journaled; failures outside the surface are journaled as rig errors. */
export function runGh(ctx: GhContext, req: GhRequest): GhResponse {
  const argv = req.argv;
  let res: GhResponse;
  try {
    const [cmd, sub, ...rest] = argv;
    let stdout: string;
    if (cmd === undefined || cmd === "--help" || cmd === "help") stdout = "Work seamlessly with GitHub from the command line.\n";
    else if (cmd === "--version" || cmd === "version") stdout = "gh version 2.83.0 (sandbox)\n";
    else if (cmd === "auth" && sub === "status") return done(ctx, req, { stdout: "", stderr: "github.com\n  \u2713 Logged in to github.com account " + LOGIN + " (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_************************************\n", exit: 0 });
    else if (cmd === "pr" && sub !== undefined) stdout = prCmd(ctx, sub, rest, req);
    else if (cmd === "repo" && sub !== undefined) stdout = repoCmd(ctx, sub, rest);
    else if (cmd === "issue" && sub !== undefined) stdout = issueCmd(ctx, sub, rest);
    else if (cmd === "api") stdout = apiCmd(ctx, argv.slice(1));
    else if (cmd === "run" && sub === "list") {
      const p = parse(rest, { ...JSON_FLAGS, repo: { alias: "R", value: true }, branch: { alias: "b", value: true }, workflow: { alias: "w", value: true }, limit: { alias: "L", value: true }, status: { alias: "s", value: true }, event: { alias: "e", value: true }, commit: { alias: "c", value: true }, user: { alias: "u", value: true } });
      checkRepo(ctx, p);
      stdout = p.flags.has("json") || p.flags.has("jq") ? emit(p, [], ["attempt", "conclusion", "createdAt", "databaseId", "displayTitle", "event", "headBranch", "headSha", "name", "number", "startedAt", "status", "updatedAt", "url", "workflowDatabaseId", "workflowName"]) : "";
    } else if ((cmd === "run" && sub === "view") || (cmd === "workflow" && sub === "run")) throw new Fail(cmd === "run" ? "could not find any workflow run in this sandbox" : "could not create workflow dispatch event: HTTP 404: Not Found");
    else throw new Fail('unknown command "' + [cmd, sub].filter(Boolean).join(" ") + '" for "gh"', "gh_unknown");
    res = { stdout, stderr: "", exit: 0 };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    if (e.rig) ctx.journal({ type: "rig_error", kind: e.rig, detail: "gh " + argv.join(" ").slice(0, 300) + ": " + e.message.split("\n")[0] });
    res = { stdout: "", stderr: e.message + "\n", exit: e.exit };
  }
  return done(ctx, req, res);
}

function done(ctx: GhContext, req: GhRequest, res: GhResponse): GhResponse {
  ctx.journal({ type: "gh", argv: req.argv.map((a) => (a.length > 200 ? a.slice(0, 200) + "..." : a)), branch: req.branch ?? null, exit: res.exit });
  return res;
}

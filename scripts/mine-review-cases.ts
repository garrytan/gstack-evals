#!/usr/bin/env bun
// gstack-evals (U14, GSTA-33): the scripted review case miner for the review replay lane. It makes no model call and spends
// nothing. The rules are wiki/plans/2026-10-30-gsta-33-u14-review-case-mining-rules.md, fixed before any case was mined; each
// rule below names its section there.
//
// mine reads public gstack and gbrain history (local clones plus cached, rate-limited GitHub API reads) and writes every
// candidate with its mechanical checks and decoy search, and every early drop, to <catalog>/mining/mined.json. build joins
// mined.json with the hand audits in <catalog>/mining/hand.json, walks the audit order to the stop rule, and writes the cases,
// <catalog>/audit/<id>.json and <catalog>/mining/drops.json; --check compares instead of writing. next lists the candidates
// the hand audit reads next, and show prints one candidate's dossier for it.
//
//   bun scripts/mine-review-cases.ts mine --clones <dir> [--repo <owner/name>]... [--cache <dir>] [--until <iso>] [--gstack <dir>] [--catalog <dir>]
//   bun scripts/mine-review-cases.ts build [--catalog <dir>] [--check]
//   bun scripts/mine-review-cases.ts next [--catalog <dir>] [--n <count>]
//   bun scripts/mine-review-cases.ts show <key> --clones <dir> [--catalog <dir>] [--cache <dir>]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { isReviewFix, type Scope, selectSpecialists } from "../quick/replay/lib.ts";
import type { Decoy, DecoyAudit, ReplayCase } from "../lanes/review-replay/catalog/catalog.ts";
import { CODES } from "../src/errors/codes.ts";
import { codeLines } from "../src/skill-eval/contract/cli-io.ts";

export const CATALOG = join(import.meta.dir, "..", "lanes", "review-replay", "catalog", "public");
export const RULES_POST = "wiki/plans/2026-10-30-gsta-33-u14-review-case-mining-rules.md";
export const MINER = "scripts/mine-review-cases.ts (U14, GSTA-33)";

/** The fixed numbers of the rules post. */
export const RULES = {
  repos: ["garrytan/gstack", "garrytan/gbrain"],
  since: "2026-10-18T00:00:00Z",
  maxFixFiles: 5,
  maxHunks: 6,
  maxOldLines: 120,
  reviewedLines: [10, 2000] as const,
  decoyLines: [1, 2000] as const,
  target: 75,
};

// ---------------------------------------------------------------------------------------------------------------------
// Diffs, blame and paths. Pure functions, tested without a repo.

export interface Hunk { oldStart: number; oldCount: number; newStart: number; newCount: number }
export interface FileDiff { oldPath: string | null; newPath: string | null; binary: boolean; hunks: Hunk[] }

const unquote = (p: string): string => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) : p);
const side = (s: string, prefix: string): string | null => {
  const p = unquote(s.replace(/\t$/, ""));
  return p === "/dev/null" ? null : p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

/** Reads a git diff (run with -U0 for exact hunks). Header lines count only before a file's first hunk. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = { oldPath: null, newPath: null, binary: false, hunks: [] };
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      if (m) [cur.oldPath, cur.newPath] = [m[1]!, m[2]!];
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      cur.hunks.push({ oldStart: +h[1]!, oldCount: h[2] === undefined ? 1 : +h[2], newStart: +h[3]!, newCount: h[4] === undefined ? 1 : +h[4] });
      continue;
    }
    if (cur.hunks.length) continue;
    if (line.startsWith("--- ")) cur.oldPath = side(line.slice(4), "a/");
    else if (line.startsWith("+++ ")) cur.newPath = side(line.slice(4), "b/");
    else if (line.startsWith("rename from ")) cur.oldPath = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) cur.newPath = unquote(line.slice(10));
    else if (line.startsWith("new file mode")) cur.oldPath = null;
    else if (line.startsWith("deleted file mode")) cur.newPath = null;
    else if (line.startsWith("Binary files ")) cur.binary = true;
  }
  return files;
}

/** Old-side line ranges to blame (Rule 1.3): rewritten lines, and for an insertion the line before and after it. */
export function blameRanges(hunks: Hunk[], fileLines: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const h of hunks) {
    if (h.oldCount > 0) out.push([h.oldStart, Math.min(fileLines, h.oldStart + h.oldCount - 1)]);
    else if (fileLines > 0) out.push([Math.max(1, h.oldStart), Math.min(fileLines, h.oldStart + 1)]);
  }
  return mergeRanges(out.filter(([a, b]) => a <= b));
}

/** Only the lines a change rewrote or removed: what the decoy search counts as a hit (Rule 3). */
export function rewrittenRanges(hunks: Hunk[]): Array<[number, number]> {
  return mergeRanges(hunks.filter((h) => h.oldCount > 0).map((h) => [h.oldStart, h.oldStart + h.oldCount - 1] as [number, number]));
}

export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const toRanges = (lines: number[]): Array<[number, number]> => mergeRanges(lines.map((l) => [l, l] as [number, number]));

export function addedLines(hunks: Hunk[]): Set<number> {
  const out = new Set<number>();
  for (const h of hunks) for (let i = 0; i < h.newCount; i++) out.add(h.newStart + i);
  return out;
}

/** Moves a line across a -U0 diff, old side to new or back. A line the diff rewrote has no place on the other side: null. */
export function mapLine(hunks: Hunk[], line: number, from: "old" | "new"): number | null {
  let shift = 0;
  for (const h of hunks) {
    const [s, c, c2] = from === "old" ? [h.oldStart, h.oldCount, h.newCount] : [h.newStart, h.newCount, h.oldCount];
    if (c === 0) {
      if (line > s) { shift += c2; continue; }
      break;
    }
    if (line < s) break;
    if (line < s + c) return null;
    shift += c2 - c;
  }
  return line + shift;
}

export interface BlameLine { sha: string; orig: number; final: number; path: string; text: string }

/** Reads git blame --line-porcelain. */
export function parseBlame(text: string): BlameLine[] {
  const out: BlameLine[] = [];
  let cur: Partial<BlameLine> | null = null;
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (m) { cur = { sha: m[1]!, orig: +m[2]!, final: +m[3]! }; continue; }
    if (!cur) continue;
    if (line.startsWith("filename ")) cur.path = unquote(line.slice(9));
    else if (line.startsWith("\t")) { out.push({ ...cur, text: line.slice(1) } as BlameLine); cur = null; }
  }
  return out;
}

/** gstack's TEST_PATH_RE (bin/gstack-diff-scope). */
const TEST_PATH = /(^|\/)(tests?|spec|__tests__)\/|(^|\/)tests?\.py$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb|ts|js|exs|dart)$|\.(test|spec)\.[jt]sx?$|_spec\.rb$|Test\.(java|kt)$/;
/** GSTA-11's filter (quick/replay/lib.ts) plus common lockfiles and golden folders. */
const NOISE = [
  /(^|\/)CHANGELOG\.md$/i, /(^|\/)VERSION$/, /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/, /(^|\/)package\.json$/,
  /^test\/fixtures\/golden\//, /(^|\/)goldens?\//, /^test\/size-ledger\//, /skill-md-size-allowlist\.json$/, /^\.agents\//, /^agents-digest\//,
];
const generated = (head: string): boolean => /AUTO-GENERATED/.test(head);

/** A file the reviewed and decoy sizes count (Rule 2): noise and generated files out, tests and docs in. */
export const countsForSize = (path: string, head: string): boolean => !NOISE.some((r) => r.test(path)) && !generated(head);
/** A file that can hold a defect (Rule 1.1). */
export const canHoldDefect = (path: string, head: string): boolean => countsForSize(path, head) && !TEST_PATH.test(path) && !/\.md$/i.test(path);
/** A file whose added lines the decoy search follows (Rule 3): source files and tests. */
export const decoyFile = (path: string, head: string): boolean => countsForSize(path, head) && !/\.md$/i.test(path);

export const isFixTitle = (title: string): boolean => !/^\s*(?:v[\d.]+\s+)?revert\b/i.test(title) && /\b(?:hot|bug)?fix(?:es|ed)?\b/i.test(title);

/** Issues the fix PR names in its title, or with a closing keyword in its body (shelf life). */
export function namedIssues(title: string, body: string | null): number[] {
  const out = new Set<number>();
  for (const m of title.matchAll(/#(\d+)\b/g)) out.add(+m[1]!);
  for (const m of (body ?? "").matchAll(/\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi)) out.add(+m[1]!);
  return [...out].sort((a, b) => a - b);
}

/** The PR body's Pre-Landing Review section, to the next heading. */
export function reviewSection(body: string | null): string {
  const text = body ?? "";
  const i = text.search(/^(?:#{1,3}\s*)?Pre-Landing Review\b/m);
  if (i < 0) return "";
  const rest = text.slice(i);
  const nl = rest.indexOf("\n");
  const j = nl < 0 ? -1 : rest.slice(nl + 1).search(/^#{1,3}\s/m);
  return j < 0 ? rest : rest.slice(0, nl + 1 + j);
}

/** Sentences of the review section that name any needle, at most four, each at most 300 characters. */
export function mentions(section: string, needles: string[]): string[] {
  return section.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s && needles.some((n) => n && s.includes(n))).slice(0, 4).map((s) => (s.length > 300 ? s.slice(0, 297) + "..." : s));
}

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------------------------------------------------
// Git and the GitHub API.

export class Git {
  private memo = new Map<string, string | null>();
  constructor(readonly dir: string) {}
  run(args: string[], ok: number[] = [0]): string {
    const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: this.dir, encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status === null || !ok.includes(r.status)) throw new Error("git " + args.join(" ") + " in " + this.dir + " exited " + r.status + ": " + (r.stderr ?? "").slice(0, 300));
    return r.stdout;
  }
  try(args: string[]): string | null {
    try { return this.run(args); } catch { return null; }
  }
  has(sha: string): boolean {
    return this.try(["cat-file", "-e", sha + "^{commit}"]) !== null;
  }
  parents(sha: string): string[] {
    const k = "parents " + sha;
    if (!this.memo.has(k)) this.memo.set(k, this.run(["rev-list", "--parents", "-n", "1", sha]).trim());
    return this.memo.get(k)!.split(" ").slice(1);
  }
  isAncestor(a: string, b: string): boolean {
    return spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: this.dir }).status === 0;
  }
  diff(from: string, to: string, paths: string[] = []): FileDiff[] {
    return parseDiff(this.run(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", from, to, "--", ...paths]));
  }
  fileDiff(from: string, to: string, path: string): Hunk[] {
    return this.diff(from, to, [path]).find((f) => f.oldPath === path || f.newPath === path)?.hunks ?? [];
  }
  show(rev: string, path: string): string | null {
    const k = rev + ":" + path;
    if (!this.memo.has(k)) this.memo.set(k, this.try(["show", k]));
    return this.memo.get(k)!;
  }
  head(rev: string, path: string): string {
    return (this.show(rev, path) ?? "").slice(0, 400);
  }
  lineCount(rev: string, path: string): number {
    const t = this.show(rev, path);
    if (!t) return 0;
    return t.split("\n").length - (t.endsWith("\n") ? 1 : 0);
  }
  blame(rev: string, path: string, ranges: Array<[number, number]>): BlameLine[] {
    if (!ranges.length) return [];
    return parseBlame(this.run(["blame", "--line-porcelain", ...ranges.flatMap(([a, b]) => ["-L", a + "," + b]), rev, "--", path]));
  }
}

export interface Api { get(path: string): Promise<any>; calls(): number }

/** GitHub REST reads through gh api, cached on disk by path, one at a time, sleeping when the rate limit runs low. */
export function ghApi(cacheDir: string): Api {
  mkdirSync(cacheDir, { recursive: true });
  let calls = 0;
  return {
    calls: () => calls,
    async get(path: string) {
      const file = join(cacheDir, sha256(path).slice(0, 40) + ".json");
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).body;
      for (let attempt = 0; ; attempt++) {
        const r = spawnSync("gh", ["api", "-i", path], { encoding: "utf8", maxBuffer: 1 << 28 });
        calls++;
        const out = r.stdout ?? "";
        const cut = out.search(/\r?\n\r?\n/);
        const head = cut < 0 ? out : out.slice(0, cut);
        const status = +(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
        const header = (k: string) => new RegExp("^" + k + ":\\s*(\\S+)", "im").exec(head)?.[1];
        if (status === 200 || status === 404) {
          const body = status === 200 ? JSON.parse(out.slice(cut).trim()) : null;
          writeFileSync(file + ".tmp", JSON.stringify({ path, status, fetched_at: new Date().toISOString(), body }));
          renameSync(file + ".tmp", file);
          const left = Number(header("x-ratelimit-remaining") ?? 1000);
          if (left < 100) await Bun.sleep(Math.min(3_600_000, Math.max(0, Number(header("x-ratelimit-reset") ?? 0) * 1000 - Date.now()) + 2000));
          return body;
        }
        if ((status === 403 || status === 429) && attempt < 3) {
          const after = Number(header("retry-after") ?? 0) * 1000 || Math.max(60_000, Number(header("x-ratelimit-reset") ?? 0) * 1000 - Date.now() + 2000);
          await Bun.sleep(Math.min(3_600_000, after));
          continue;
        }
        throw new Error("GET " + path + " answered " + (status || "nothing") + ": " + (r.stderr ?? "").slice(0, 200));
      }
    },
  };
}

async function pages(api: Api, path: string, stop: (items: any[]) => boolean = () => false): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const items = ((await api.get(path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page)) ?? []) as any[];
    out.push(...items);
    if (items.length < 100 || stop(items)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mining.

export type Kind = "escaped" | "review-caught";
export interface Check { name: string; pass: boolean; detail: string }
export interface DecoyHit { commit: string; where: "branch" | "default"; pr: number | null; subject: string; file: string; lines: number[] }
export interface DecoySearch {
  from: string; to: string; files: string[]; added_lines: number;
  searched: { branch: number; default: number; through: string; through_date: string }; hits: DecoyHit[];
}
export interface Candidate {
  key: string; repo: string; kind: Kind;
  pr: number; pr_title: string; pr_author: string; pr_merged_at: string;
  fix: { pr: number; commit: string; parent: string; subject: string; author: string; merged_at: string };
  reviewed_head: string; merge_base: string; default_branch: string;
  file: string; fix_file: string; lines: number[]; blamed: number; owned: number; insertion_only: boolean; introduced_by: string[];
  reviewed_lines: number; decoy_lines: number; decoy: DecoySearch;
  roles: ReplayCase["roles"]; scope: string;
  shelf: { first_appeared: string; source: string };
  history: { receipt: boolean; excerpt: string[]; default: { by: string; rated: string } | null };
  checks: Check[];
}
export interface Drop { key: string; repo: string; kind: Kind | null; pr: number | null; fix_pr: number | null; fix_commit: string | null; stage: "mine" | "build"; code: string; detail: string }
export interface Existing { id: string; decoys: DecoySearch[]; checks: Check[] }
export interface RepoRun { repo: string; visibility: string; default_branch: string; head: string; head_date: string; merged_prs: number; fix_prs: number; review_fix_commits: number }
export interface Mined {
  schema: 1; rules: string;
  run: { at: string; since: string; until: string; gstack_sha: string | null; repos: RepoRun[]; api_calls: number };
  existing: Existing[]; candidates: Candidate[]; drops: Drop[];
}

export interface MineOptions {
  clones: string; repos: string[]; api: Api; until: string; catalog: string;
  /** Prints gstack-diff-scope's SCOPE_ lines for base...head in the clone. */
  scope: (git: Git, base: string, head: string) => { text: string; sha: string | null };
  log?: (line: string) => void;
}

/** Runs gstack's bin/gstack-diff-scope at a checkout (Roles and history). */
export function gstackScope(gstack: string): MineOptions["scope"] {
  const sha = spawnSync("git", ["-C", gstack, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim() || null;
  return (git, base, head) => {
    const r = spawnSync("bash", [join(gstack, "bin", "gstack-diff-scope"), base, "--head", head], { cwd: git.dir, encoding: "utf8" });
    if ((r.status !== 0 && r.status !== 2) || /SCOPE_ERROR=no_base/.test(r.stdout)) throw new Error("gstack-diff-scope " + base + " --head " + head + " exited " + r.status + ": " + r.stdout.slice(0, 200));
    return { text: r.stdout, sha };
  };
}

const short = (s: string) => s.slice(0, 12);
const day = (iso: string) => iso.slice(0, 10);
const subjectOf = (message: string) => message.split("\n")[0]!;

export class RepoMiner {
  readonly git: Git;
  def = "";
  headSha = "";
  headDate = "";
  fp: string[] = [];
  fpIndex = new Map<string, number>();
  private intro = new Map<string, string | null>();
  private prOfCommit = new Map<string, number | null>();
  private changed = new Map<string, FileDiff[]>();
  candidates: Candidate[] = [];
  drops: Drop[] = [];
  gstackSha: string | null = null;

  constructor(readonly repo: string, readonly o: MineOptions) {
    this.git = new Git(join(o.clones, repo.split("/")[1]!));
  }

  private log(s: string) { this.o.log?.(this.repo + ": " + s); }

  async prepare(def: string): Promise<void> {
    this.def = def;
    this.git.run(["fetch", "-q", "origin", "+refs/heads/" + def + ":refs/remotes/origin/" + def]);
    this.headSha = this.git.run(["rev-parse", "origin/" + def]).trim();
    this.headDate = this.git.run(["log", "-1", "--format=%cI", this.headSha]).trim();
    this.fp = this.git.run(["rev-list", "--first-parent", "--reverse", this.headSha]).trim().split("\n");
    this.fp.forEach((s, i) => this.fpIndex.set(s, i));
  }

  ensure(sha: string, pr: number): void {
    if (this.git.has(sha)) return;
    this.git.try(["fetch", "-q", "origin", "+refs/pull/" + pr + "/head:refs/remotes/origin/pr/" + pr]);
    if (!this.git.has(sha)) throw new Error(this.repo + " commit " + sha + " of #" + pr + " is missing after fetching refs/pull/" + pr + "/head");
  }

  /** The default-branch commit that brought a commit in: itself, or the first-parent merge that did. */
  introOf(sha: string): string | null {
    if (this.fpIndex.has(sha)) return sha;
    if (!this.intro.has(sha)) {
      const list = this.git.try(["rev-list", "--first-parent", "--ancestry-path", "--reverse", sha + ".." + this.headSha]);
      this.intro.set(sha, list?.split("\n")[0]?.trim() || null);
    }
    return this.intro.get(sha)!;
  }

  async prOfMerge(commit: string): Promise<number | null> {
    if (!this.prOfCommit.has(commit)) {
      const list = ((await this.o.api.get("repos/" + this.repo + "/commits/" + commit + "/pulls")) ?? []) as any[];
      this.prOfCommit.set(commit, list.find((p) => p.merge_commit_sha === commit && p.merged_at)?.number ?? null);
    }
    return this.prOfCommit.get(commit)!;
  }

  pull(n: number): Promise<any> {
    return this.o.api.get("repos/" + this.repo + "/pulls/" + n);
  }

  private changedBy(c: string): FileDiff[] {
    if (!this.changed.has(c)) this.changed.set(c, this.git.diff(this.git.parents(c)[0]!, c));
    return this.changed.get(c)!;
  }

  private filteredLines(from: string, to: string): number {
    let n = 0;
    for (const f of this.git.diff(from, to)) {
      const path = f.newPath ?? f.oldPath;
      if (!path || f.binary || !countsForSize(path, f.newPath ? this.git.head(to, f.newPath) : this.git.head(from, f.oldPath!))) continue;
      for (const h of f.hunks) n += h.oldCount + h.newCount;
    }
    return n;
  }

  /** Rule 3: every later commit that rewrites or removes a line the decoy added in its source and test files. */
  async decoySearch(from: string, to: string, after: string, branchLater: string[], squash: { head: string; merge: string } | null): Promise<DecoySearch> {
    const id = (b: { sha: string; path: string; orig: number }) => b.sha + "\0" + b.path + "\0" + b.orig;
    const targets = new Set<string>();
    const paths = new Set<string>();
    let added = 0;
    for (const f of this.git.diff(from, to)) {
      if (!f.newPath || f.binary || !decoyFile(f.newPath, this.git.head(to, f.newPath))) continue;
      const lines = [...addedLines(f.hunks)];
      if (!lines.length) continue;
      added += lines.length;
      paths.add(f.newPath);
      for (const b of this.git.blame(to, f.newPath, toRanges(lines))) targets.add(id(b));
    }
    if (squash) {
      for (const p of paths) {
        const n = this.git.lineCount(squash.head, p);
        if (!n) continue;
        const hunks = this.git.fileDiff(squash.head, squash.merge, p);
        for (const b of this.git.blame(squash.head, p, [[1, n]])) {
          if (!targets.has(id(b))) continue;
          const m = mapLine(hunks, b.final, "old");
          if (m !== null) targets.add(id({ sha: squash.merge, path: p, orig: m }));
        }
      }
    }
    const i = this.fpIndex.get(after);
    const later = [...branchLater.map((c) => ({ c, where: "branch" as const })), ...(i === undefined ? [] : this.fp.slice(i + 1)).map((c) => ({ c, where: "default" as const }))];
    const hits: DecoyHit[] = [];
    for (const { c, where } of later) {
      if (!paths.size) break;
      const files = where === "default" ? this.changedBy(c) : this.git.diff(this.git.parents(c)[0]!, c);
      if (!files.some((f) => f.oldPath && paths.has(f.oldPath))) continue;
      const parent = this.git.parents(c)[0]!;
      for (const f of files) {
        if (!f.oldPath || !paths.has(f.oldPath)) continue;
        if (f.newPath && f.newPath !== f.oldPath) paths.add(f.newPath);
        const ranges = rewrittenRanges(f.hunks);
        const hit = this.git.blame(parent, f.oldPath, ranges).filter((b) => targets.has(id(b)));
        if (!hit.length) continue;
        hits.push({
          commit: c, where, pr: where === "default" ? await this.prOfMerge(c) : null, subject: subjectOf(this.git.run(["log", "-1", "--format=%B", c])),
          file: f.oldPath, lines: hit.map((b) => b.final),
        });
      }
    }
    return {
      from, to, files: [...paths].sort(), added_lines: added,
      searched: { branch: branchLater.length, default: later.length - branchLater.length, through: this.headSha, through_date: day(this.headDate) },
      hits,
    };
  }

  private async shelf(pr: any): Promise<Candidate["shelf"]> {
    const dates: Array<{ at: string; what: string }> = [{ at: pr.created_at, what: this.repo + "#" + pr.number + " (the fix PR) created_at " + pr.created_at }];
    for (const n of namedIssues(pr.title, pr.body)) {
      if (n === pr.number) continue;
      const issue = await this.o.api.get("repos/" + this.repo + "/issues/" + n);
      if (issue && !issue.pull_request) dates.push({ at: issue.created_at, what: this.repo + "#" + n + " (an issue it names) created_at " + issue.created_at });
    }
    dates.sort((a, b) => a.at.localeCompare(b.at));
    return { first_appeared: day(dates[0]!.at), source: "GitHub API: " + dates.map((d) => d.what).join("; ") };
  }

  private roles(base: string, head: string, lines: number): { roles: ReplayCase["roles"]; scope: string } {
    const { text, sha } = this.o.scope(this.git, base, head);
    this.gstackSha = sha;
    const flag = (k: string) => new RegExp("^SCOPE_" + k + "=true$", "m").test(text);
    const s: Scope = { BACKEND: flag("BACKEND"), FRONTEND: flag("FRONTEND"), AUTH: flag("AUTH"), MIGRATIONS: flag("MIGRATIONS"), API: flag("API"), STATE_MACHINE: "unknown" };
    return {
      roles: [...selectSpecialists(lines, s).map((checklist) => ({ role: "specialist" as const, checklist })), { role: "red-team" as const }],
      scope: text.split("\n").filter((l) => l.startsWith("SCOPE_")).join(" "),
    };
  }

  private drop(key: string, kind: Kind, pr: number | null, fixPr: number | null, fixCommit: string | null, code: string, detail: string): void {
    this.drops.push({ key, repo: this.repo, kind, pr, fix_pr: fixPr, fix_commit: fixCommit, stage: "mine", code, detail });
  }

  /** Rule 1.1 to 1.3 on one fix: the source files it rewrote, each with its blamed lines. */
  private fixFiles(parent: string, fix: string): { files: Array<{ path: string; newPath: string; blame: BlameLine[]; insertion: boolean }>; code: string | null; detail: string } {
    const src = this.git.diff(parent, fix).filter((f) => f.oldPath && f.newPath && !f.binary && f.hunks.length && canHoldDefect(f.oldPath, this.git.head(parent, f.oldPath)));
    if (!src.length) return { files: [], code: "no-source-file", detail: "the fix rewrote no source file (Rule 1.1)" };
    if (src.length > RULES.maxFixFiles) return { files: [], code: "fix-too-broad", detail: "the fix rewrote " + src.length + " source files, more than " + RULES.maxFixFiles + " (Rule 1.2)" };
    const files = [];
    const skipped: string[] = [];
    for (const f of src) {
      const old = f.hunks.reduce((n, h) => n + h.oldCount, 0);
      if (f.hunks.length > RULES.maxHunks || old > RULES.maxOldLines) { skipped.push(f.oldPath + " (" + f.hunks.length + " hunks, " + old + " old lines)"); continue; }
      files.push({ path: f.oldPath!, newPath: f.newPath!, blame: this.git.blame(parent, f.oldPath!, blameRanges(f.hunks, this.git.lineCount(parent, f.oldPath!))), insertion: f.hunks.every((h) => h.oldCount === 0) });
    }
    return { files, code: files.length ? null : "fix-file-too-large", detail: "every source file is past " + RULES.maxHunks + " hunks or " + RULES.maxOldLines + " old lines (Rule 1.3): " + skipped.join(", ") };
  }

  private sizeChecks(base: string, head: string, from: string, to: string): { reviewed: number; decoy: number; fail: [string, string] | null } {
    const reviewed = this.filteredLines(base, head);
    const decoy = this.filteredLines(from, to);
    if (reviewed < RULES.reviewedLines[0] || reviewed > RULES.reviewedLines[1]) return { reviewed, decoy, fail: ["reviewed-diff-size", "the filtered reviewed diff has " + reviewed + " changed lines, outside " + RULES.reviewedLines.join(" to ") + " (Rule 2)"] };
    if (decoy < RULES.decoyLines[0] || decoy > RULES.decoyLines[1]) return { reviewed, decoy, fail: ["decoy-size", "the filtered decoy diff has " + decoy + " changed lines, outside " + RULES.decoyLines.join(" to ") + " (Rule 3)"] };
    return { reviewed, decoy, fail: null };
  }

  async escaped(F: any): Promise<void> {
    const key = this.repo + "#" + F.number;
    const S: string = F.merge_commit_sha;
    const fail = (code: string, detail: string, pr: number | null = null) => this.drop(key, "escaped", pr, F.number, S, code, detail);
    if (!this.fpIndex.has(S)) return fail("fix-not-on-default", S + " is not a first-parent commit of " + this.def + " at " + short(this.headSha));
    const P1 = this.git.parents(S)[0]!;
    const { files, code, detail } = this.fixFiles(P1, S);
    if (code) return fail(code, detail);
    const owners: Array<{ path: string; pr: number; owned: BlameLine[]; blamed: number; insertion: boolean }> = [];
    const notes: string[] = [];
    for (const f of files) {
      const tally = new Map<number | null, BlameLine[]>();
      for (const b of f.blame) {
        const intro = this.introOf(b.sha);
        const pr = intro ? await this.prOfMerge(intro) : null;
        tally.set(pr, [...(tally.get(pr) ?? []), b]);
      }
      const [pr, owned] = [...tally.entries()].sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))[0] ?? [null, []];
      if (pr === null || pr === F.number || owned.length * 2 < f.blame.length) { notes.push(f.path + ": top owner " + (pr === null ? "no merged PR" : "#" + pr) + " holds " + owned.length + " of " + f.blame.length + " blamed lines"); continue; }
      owners.push({ path: f.path, pr, owned, blamed: f.blame.length, insertion: f.insertion });
    }
    if (!owners.length) return fail("no-single-introducer", "no source file has one merged PR holding at least half its blamed lines (Rule 1.4): " + notes.join("; "));
    const best = owners.sort((a, b) => b.owned.length - a.owned.length || a.path.localeCompare(b.path))[0]!;
    const X = await this.pull(best.pr);
    if (!X?.merged_at || !X.merge_commit_sha || X.base?.ref !== this.def) return fail("introducer-not-merged", "#" + best.pr + " is not a PR merged into " + this.def, best.pr);
    const head: string = X.head.sha;
    const MX: string = X.merge_commit_sha;
    this.ensure(head, X.number);
    const base = this.git.run(["merge-base", head, this.git.parents(MX)[0]!]).trim();
    const byPath = new Map<string, number[]>();
    for (const b of best.owned) {
      let l: number | null = null;
      if (b.sha === MX) l = mapLine(this.git.fileDiff(head, MX, b.path), b.orig, "new");
      else if (this.git.isAncestor(b.sha, head)) l = mapLine(this.git.fileDiff(b.sha, head, b.path), b.orig, "old");
      if (l !== null && this.git.show(head, b.path) !== null) byPath.set(b.path, [...(byPath.get(b.path) ?? []), l]);
    }
    const [path, mapped] = [...byPath.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0] ?? ["", []];
    const inDiff = addedLines(path ? this.git.fileDiff(base, head, path) : []);
    const lines = [...new Set(mapped)].filter((l) => inDiff.has(l)).sort((a, b) => a - b);
    if (!lines.length) return fail("not-in-reviewed-diff", "none of the " + best.owned.length + " lines blamed to #" + X.number + " in " + best.path + " is an added line of " + short(base) + ".." + short(head) + " (Rule 2)", X.number);
    const size = this.sizeChecks(base, head, P1, S);
    if (size.fail) return fail(size.fail[0], size.fail[1], X.number);
    const section = reviewSection(X.body);
    const excerpt = mentions(section, [basename(path)]);
    const r = this.roles(base, head, size.reviewed);
    this.candidates.push({
      key, repo: this.repo, kind: "escaped",
      pr: X.number, pr_title: X.title, pr_author: X.user?.login ?? "unknown", pr_merged_at: X.merged_at,
      fix: { pr: F.number, commit: S, parent: P1, subject: F.title, author: F.user?.login ?? "unknown", merged_at: F.merged_at },
      reviewed_head: head, merge_base: base, default_branch: this.def,
      file: path, fix_file: best.path, lines, blamed: best.blamed, owned: best.owned.length, insertion_only: best.insertion,
      introduced_by: [...new Set(best.owned.map((b) => b.sha))].sort(),
      reviewed_lines: size.reviewed, decoy_lines: size.decoy,
      decoy: await this.decoySearch(P1, S, S, [], null),
      ...r,
      shelf: await this.shelf(F),
      history: {
        receipt: section !== "",
        excerpt,
        default: section === "" ? { by: "#" + X.number + "'s PR body", rated: "no review receipt (no Pre-Landing Review section)" }
          : excerpt.length ? null : { by: "gstack Pre-Landing Review in #" + X.number + "'s PR body", rated: "not raised: the review section does not name " + basename(path) },
      },
      checks: [
        { name: "repo-public", pass: true, detail: "GET /repos/" + this.repo + " visibility public" },
        { name: "fix-merged-in-window", pass: true, detail: "#" + F.number + " merged into " + this.def + " at " + F.merged_at + " as " + short(S) },
        { name: "head-and-base-resolve", pass: true, detail: short(base) + " is an ancestor of " + short(head) },
        { name: "line-in-diff-range", pass: true, detail: path + " lines " + lines.join(",") + " are added lines of " + short(base) + ".." + short(head) },
        { name: "fix-rewrote-line", pass: true, detail: "git diff -U0 " + short(P1) + ".." + short(S) + " -- " + best.path + " rewrote " + best.blamed + " old lines; git blame " + short(P1) + " gives " + best.owned.length + " to #" + X.number + (best.insertion ? " (insertions only: the blamed lines are neighbours)" : "") },
        { name: "sizes", pass: true, detail: "reviewed " + size.reviewed + " and decoy " + size.decoy + " filtered changed lines" },
      ],
    });
  }

  async reviewCaught(X: any): Promise<number> {
    const commits = await pages(this.o.api, "repos/" + this.repo + "/pulls/" + X.number + "/commits");
    const shas = new Set(commits.map((c) => c.sha as string));
    let found = 0;
    for (let i = 1; i < commits.length; i++) {
      const c = commits[i];
      if (c.parents.length !== 1 || !isReviewFix(c.commit.message)) continue;
      found++;
      const key = this.repo + "#" + X.number + "@" + short(c.sha);
      const P: string = c.parents[0].sha;
      const fail = (code: string, detail: string) => this.drop(key, "review-caught", X.number, X.number, c.sha, code, detail);
      if (!shas.has(P)) { fail("parent-off-branch", "the review fix's parent " + short(P) + " is not a commit of #" + X.number); continue; }
      this.ensure(X.head.sha, X.number);
      const { files, code, detail } = this.fixFiles(P, c.sha);
      if (code) { fail(code, detail); continue; }
      const owners = files.map((f) => ({ ...f, owned: f.blame.filter((b) => shas.has(b.sha)) })).filter((f) => f.owned.length && f.owned.length * 2 >= f.blame.length);
      if (!owners.length) { fail("not-introduced-by-the-pr", "no source file has at least half its blamed lines from #" + X.number + "'s own commits (Rule 1.4)"); continue; }
      const best = owners.sort((a, b) => b.owned.length - a.owned.length || a.path.localeCompare(b.path))[0]!;
      const MX: string = X.merge_commit_sha;
      const base = this.git.run(["merge-base", P, this.git.parents(MX)[0]!]).trim();
      const inDiff = addedLines(this.git.fileDiff(base, P, best.path));
      const lines = [...new Set(best.owned.map((b) => b.final))].filter((l) => inDiff.has(l)).sort((a, b) => a - b);
      if (!lines.length) { fail("not-in-reviewed-diff", "none of the " + best.owned.length + " lines blamed to #" + X.number + "'s commits is an added line of " + short(base) + ".." + short(P) + " (Rule 2)"); continue; }
      const size = this.sizeChecks(base, P, P, c.sha);
      if (size.fail) { fail(size.fail[0], size.fail[1]); continue; }
      const section = reviewSection(X.body);
      const squash = this.git.parents(MX).length === 1 ? { head: X.head.sha as string, merge: MX } : null;
      this.candidates.push({
        key, repo: this.repo, kind: "review-caught",
        pr: X.number, pr_title: X.title, pr_author: X.user?.login ?? "unknown", pr_merged_at: X.merged_at,
        fix: { pr: X.number, commit: c.sha, parent: P, subject: subjectOf(c.commit.message), author: c.author?.login ?? c.commit.author?.name ?? "unknown", merged_at: X.merged_at },
        reviewed_head: P, merge_base: base, default_branch: this.def,
        file: best.path, fix_file: best.path, lines, blamed: best.blame.length, owned: best.owned.length, insertion_only: best.insertion,
        introduced_by: [...new Set(best.owned.map((b) => b.sha))].sort(),
        reviewed_lines: size.reviewed, decoy_lines: size.decoy,
        decoy: await this.decoySearch(P, c.sha, MX, commits.slice(i + 1).map((x) => x.sha as string), squash),
        ...this.roles(base, P, size.reviewed),
        shelf: await this.shelf(X),
        history: { receipt: section !== "", excerpt: mentions(section, [c.sha.slice(0, 7), basename(best.path)]), default: null },
        checks: [
          { name: "repo-public", pass: true, detail: "GET /repos/" + this.repo + " visibility public" },
          { name: "fix-merged-in-window", pass: true, detail: "#" + X.number + " merged into " + this.def + " at " + X.merged_at + "; review fix " + short(c.sha) + " is on its branch" },
          { name: "head-and-base-resolve", pass: true, detail: short(base) + " is an ancestor of " + short(P) },
          { name: "line-in-diff-range", pass: true, detail: best.path + " lines " + lines.join(",") + " are added lines of " + short(base) + ".." + short(P) },
          { name: "fix-rewrote-line", pass: true, detail: "git diff -U0 " + short(P) + ".." + short(c.sha) + " -- " + best.path + " rewrote " + best.blame.length + " old lines; git blame " + short(P) + " gives " + best.owned.length + " to #" + X.number + "'s commits" + (best.insertion ? " (insertions only: the blamed lines are neighbours)" : "") },
          { name: "sizes", pass: true, detail: "reviewed " + size.reviewed + " and decoy " + size.decoy + " filtered changed lines" },
        ],
      });
    }
    return found;
  }

  /** The decoy search and checks on a case already in the catalog (U13's seeds). */
  async existing(c: ReplayCase): Promise<Existing> {
    const X = await this.pull(c.pr);
    this.ensure(X.head.sha, X.number);
    this.ensure(c.reviewed_head, X.number);
    const commits = await pages(this.o.api, "repos/" + this.repo + "/pulls/" + X.number + "/commits");
    const order = commits.map((x) => x.sha as string);
    const MX: string = X.merge_commit_sha;
    const squash = this.git.parents(MX).length === 1 ? { head: X.head.sha as string, merge: MX } : null;
    const decoys: DecoySearch[] = [];
    for (const d of c.decoys) {
      const at = order.indexOf(d.range.to);
      decoys.push(await this.decoySearch(d.range.from, d.range.to, MX, at < 0 ? [] : order.slice(at + 1), squash));
    }
    const lines = this.git.lineCount(c.reviewed_head, c.defect.file);
    const added = addedLines(this.git.fileDiff(c.diff_range.from, c.diff_range.to, c.defect.file));
    const fixParent = this.git.parents(c.fix.commit)[0]!;
    const rewrote = blameRanges(this.git.fileDiff(fixParent, c.fix.commit, c.defect.file), this.git.lineCount(fixParent, c.defect.file)).some(([a, b]) => c.defect.line >= a && c.defect.line <= b);
    const blamed = this.git.blame(c.reviewed_head, c.defect.file, [[c.defect.line, c.defect.line]])[0];
    return {
      id: c.id, decoys,
      checks: [
        { name: "repo-public", pass: true, detail: "GET /repos/" + this.repo + " visibility public" },
        { name: "head-and-base-resolve", pass: this.git.isAncestor(c.merge_base, c.reviewed_head), detail: short(c.merge_base) + " is an ancestor of " + short(c.reviewed_head) },
        { name: "line-at-head", pass: c.defect.line <= lines, detail: c.defect.file + " has " + lines + " lines at " + short(c.reviewed_head) },
        { name: "line-in-diff-range", pass: added.has(c.defect.line), detail: "line " + c.defect.line + (added.has(c.defect.line) ? " is" : " is not") + " an added line of " + short(c.diff_range.from) + ".." + short(c.diff_range.to) },
        { name: "fix-rewrote-line", pass: fixParent === c.reviewed_head && rewrote, detail: "fix " + short(c.fix.commit) + "'s parent is " + short(fixParent) + "; its diff " + (rewrote ? "rewrites" : "does not rewrite") + " line " + c.defect.line },
        { name: "line-from-the-pr", pass: !!blamed && order.includes(blamed.sha), detail: "git blame " + short(c.reviewed_head) + " -- " + c.defect.file + ":" + c.defect.line + " gives " + (blamed ? short(blamed.sha) : "nothing") + (blamed && order.includes(blamed.sha) ? ", a commit of #" + X.number : "") },
      ],
    };
  }
}

/** mine: every candidate, early drop and seed audit, as mined.json's object. */
export async function mine(o: MineOptions): Promise<Mined> {
  const repos: RepoRun[] = [];
  const candidates: Candidate[] = [];
  const drops: Drop[] = [];
  const existing: Existing[] = [];
  let gstackSha: string | null = null;
  const seeds = readdirSync(o.catalog).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(o.catalog, f), "utf8")) as ReplayCase).filter((c) => !MINED_ID.test(c.id));
  for (const repo of o.repos) {
    const meta = await o.api.get("repos/" + repo);
    if (!meta || meta.private !== false || meta.visibility !== "public") {
      drops.push({ key: repo, repo, kind: null, pr: null, fix_pr: null, fix_commit: null, stage: "mine", code: "repo-not-public", detail: "GET /repos/" + repo + " says " + (meta ? "visibility " + meta.visibility : "not found") + "; nothing from it is mined" });
      repos.push({ repo, visibility: meta?.visibility ?? "not found", default_branch: meta?.default_branch ?? "", head: "", head_date: "", merged_prs: 0, fix_prs: 0, review_fix_commits: 0 });
      continue;
    }
    const m = new RepoMiner(repo, o);
    await m.prepare(meta.default_branch);
    const list = await pages(o.api, "repos/" + repo + "/pulls?state=closed&base=" + meta.default_branch + "&sort=updated&direction=desc", (items) => items[items.length - 1].updated_at < RULES.since);
    const merged = list.filter((p) => p.merged_at && p.merged_at >= RULES.since && p.merged_at <= o.until).sort((a, b) => a.number - b.number);
    const fixes = merged.filter((p) => isFixTitle(p.title));
    let reviewFixes = 0;
    for (const p of merged) {
      o.log?.(repo + "#" + p.number);
      if (fixes.includes(p)) await m.escaped(p);
      reviewFixes += await m.reviewCaught(p);
    }
    for (const c of seeds.filter((s) => s.repo === repo)) existing.push(await m.existing(c));
    gstackSha ??= m.gstackSha;
    candidates.push(...m.candidates);
    drops.push(...m.drops);
    repos.push({ repo, visibility: meta.visibility, default_branch: m.def, head: m.headSha, head_date: m.headDate, merged_prs: merged.length, fix_prs: fixes.length, review_fix_commits: reviewFixes });
  }
  return {
    schema: 1, rules: RULES_POST,
    run: { at: new Date().toISOString(), since: RULES.since, until: o.until, gstack_sha: gstackSha, repos, api_calls: o.api.calls() },
    existing: existing.sort((a, b) => a.id.localeCompare(b.id)),
    candidates: candidates.sort((a, b) => a.key.localeCompare(b.key)),
    drops: drops.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The hand audit and build.

export interface HandDecoy { verdict: "clean" | "holds-defect"; later_fix: { ref: string; fixed: string } | null; reason: string }
export interface HandAudit {
  at: string;
  verdict: "confirmed" | "rejected";
  /** Rejected: why, starting with a short code (not-a-defect, not-visible, unclear, ...). Confirmed: the evidence read. */
  notes: string;
  line?: number;
  summary?: string;
  severity?: { deserved: "CRITICAL" | "INFORMATIONAL" | null; basis: string };
  in_history?: Array<{ by: string; rated: string }>;
  needs_human_check?: Array<{ item: string; reason: string }>;
  /** One entry per decoy hit list the script could not judge (Rule 3), keyed by decoy index. */
  decoys?: Record<string, HandDecoy>;
}
export interface Hand { auditor: string; audits: Record<string, HandAudit> }

/** The id build gives a mined case; any other id in the catalog is a case the miner did not write (U13's seeds). */
export const MINED_ID = /^[a-z0-9.-]+-\d+-(?:fixed-by-\d+|review-[0-9a-f]{8})$/;
export const caseId = (c: Candidate): string => c.repo.split("/")[1]!.toLowerCase() + "-" + c.pr + (c.kind === "escaped" ? "-fixed-by-" + c.fix.pr : "-review-" + c.fix.commit.slice(0, 8));
export const auditOrder = (cs: Candidate[]): Candidate[] => [...cs].sort((a, b) => sha256(a.key).localeCompare(sha256(b.key)));

const searchMethod = (s: DecoySearch, def: string): string =>
  "Searched " + (s.searched.branch ? s.searched.branch + " later commits on the PR branch and " : "") + s.searched.default + " later first-parent commits on " + def + " through " + short(s.searched.through) + " (" + s.searched.through_date + ") for a change to any of the " + s.added_lines + " lines this decoy added in source and test files (" + RULES_POST + ", Rule 3)";

export function decoyAudit(s: DecoySearch, def: string, hand: HandDecoy | undefined, auditor: string, at: string, runDate: string): DecoyAudit | null {
  if (!s.hits.length) return { later_fix_checked: true, later_fix: null, verdict: "clean", by: MINER, at: runDate, method: searchMethod(s, def) + "; none changed them." };
  if (!hand) return null;
  const hits = s.hits.map((h) => short(h.commit) + (h.pr ? " (#" + h.pr + ")" : "") + " " + h.file + ":" + h.lines.join(",")).join("; ");
  return { later_fix_checked: true, later_fix: hand.later_fix, verdict: hand.verdict, by: auditor, at, method: searchMethod(s, def) + "; hits " + hits + ". Hand check: " + hand.reason };
}

function handProblems(c: Candidate, h: HandAudit): string[] {
  const p: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.at)) p.push("at is not a date");
  if (!h.notes) p.push("notes are empty");
  if (h.verdict !== "confirmed") return p;
  if (!h.summary) p.push("a confirmed audit needs a summary");
  if (!h.severity || !h.severity.basis) p.push("a confirmed audit needs severity.deserved and its basis");
  if (h.line !== undefined && !c.lines.includes(h.line)) p.push("line " + h.line + " is not a located line (" + c.lines.join(",") + ")");
  if (!c.history.default && !h.in_history?.length) p.push("the script could not settle in_history, so the hand audit must");
  if (c.decoy.hits.length && !h.decoys?.["0"]) p.push("the decoy has later changes, so decoys[\"0\"] needs a hand verdict");
  return p;
}

export interface Built { files: Map<string, string>; confirmed: number; pending: string[]; problems: string[] }

/** build: the cases, audit records and drop list from mined.json and hand.json. Nothing reads the network. */
export function build(catalog: string, mined: Mined, hand: Hand, target = RULES.target): Built {
  const files = new Map<string, string>();
  const problems: string[] = [];
  const write = (path: string, value: unknown) => files.set(path, JSON.stringify(value, null, 2) + "\n");
  const runDate = day(mined.run.at);
  const defOf = new Map(mined.run.repos.map((r) => [r.repo, r.default_branch]));
  const used = new Set<string>();
  const drops: Drop[] = [...mined.drops];

  for (const e of mined.existing) {
    const path = join(catalog, e.id + ".json");
    const c = JSON.parse(readFileSync(path, "utf8")) as ReplayCase;
    const h = hand.audits[e.id];
    c.decoys = c.decoys.map((d, i) => ({ ...d, audit: decoyAudit(e.decoys[i]!, defOf.get(c.repo)!, h?.decoys?.[String(i)], hand.auditor, h?.at ?? runDate, runDate) }));
    const failed = e.checks.filter((k) => !k.pass);
    if (failed.length) problems.push(e.id + ": mechanical checks failed: " + failed.map((k) => k.name).join(", "));
    if (h) c.answer_key_audit = { by: hand.auditor, at: h.at, verdict: h.verdict, notes: h.notes + needsNote(h) };
    write(path, c);
    write(join(catalog, "audit", e.id + ".json"), { id: e.id, kind: "seed", rules: RULES_POST, checks: e.checks, decoy_search: e.decoys, hand: h ?? null, needs_human_check: needs(h, e.decoys) });
    used.add(c.repo + "#" + c.pr).add(c.repo + "#" + c.fix.pr);
  }

  let confirmed = 0;
  const pending: string[] = [];
  for (const c of auditOrder(mined.candidates)) {
    const dropIt = (code: string, detail: string) => drops.push({ key: c.key, repo: c.repo, kind: c.kind, pr: c.pr, fix_pr: c.fix.pr, fix_commit: c.fix.commit, stage: "build", code, detail });
    if (confirmed >= target) { dropIt("not-audited", "the audit stopped at " + target + " confirmed cases before reaching this candidate (Rule 5); this says nothing about its quality"); continue; }
    const taken = [c.repo + "#" + c.pr, c.repo + "#" + c.fix.pr].find((k) => used.has(k));
    if (taken) { dropIt("one-case-per-pr", taken + " already appears in a case (Rule 5)"); continue; }
    const h = hand.audits[c.key];
    if (!h) { pending.push(c.key); dropIt("not-audited", "no hand audit yet"); continue; }
    const p = handProblems(c, h);
    if (p.length) { problems.push(c.key + ": " + p.join("; ")); continue; }
    if (h.verdict === "rejected") { dropIt("rejected", h.notes); continue; }
    const hd = h.decoys?.["0"];
    if (hd?.verdict === "holds-defect") { dropIt("decoy-holds-defect", "the only decoy holds a defect (" + (hd.later_fix?.ref ?? "later fix") + ": " + (hd.later_fix?.fixed ?? hd.reason) + "), so the case has no decoy left (Rule 3)"); continue; }
    const id = caseId(c);
    const def = c.default_branch;
    const audit = decoyAudit(c.decoy, def, hd, hand.auditor, h.at, runDate);
    const fixRef = c.kind === "escaped" ? c.repo + "#" + c.fix.pr : "commit " + short(c.fix.commit);
    const out: ReplayCase = {
      schema_version: 1, id, visibility: "public", repo: c.repo, pr: c.pr, reviewed_head: c.reviewed_head, merge_base: c.merge_base,
      diff_range: { from: c.merge_base, to: c.reviewed_head, note: c.kind === "escaped" ? "#" + c.pr + "'s full diff at its head. The defect reached " + def + " and #" + c.fix.pr + " fixed it." : "#" + c.pr + "'s full diff at the commit before its review fix " + short(c.fix.commit) + "." },
      roles: c.roles,
      defect: { file: c.file, line: h.line ?? c.lines[0]!, summary: h.summary! },
      severity: { deserved: h.severity!.deserved, basis: h.severity!.basis, in_history: h.in_history?.length ? h.in_history : [c.history.default!] },
      fix: { commit: c.fix.commit, pr: c.fix.pr },
      decoys: [{ kind: "fix-commit", repo: c.repo, pr: c.fix.pr, range: { from: c.decoy.from, to: c.decoy.to }, audit } satisfies Decoy],
      receipt: {
        source: c.kind === "escaped" ? c.repo + " #" + c.fix.pr + " (merged " + day(c.fix.merged_at) + "), a fix whose diff rewrote lines that git blame gives to #" + c.pr : c.repo + " #" + c.pr + ", review-fix commit " + short(c.fix.commit) + ", which rewrote lines that #" + c.pr + "'s own earlier commits added",
        evidence: [
          "git diff -U0 " + short(c.fix.parent) + ".." + short(c.fix.commit) + " -- " + c.fix_file + " rewrites " + c.blamed + " old lines; git blame " + short(c.fix.parent) + " gives " + c.owned + " of them to " + (c.kind === "escaped" ? "#" + c.pr : "#" + c.pr + "'s commits") + " (" + c.introduced_by.map(short).join(", ") + ")" + (c.insertion_only ? "; the fix only inserts, so these are the lines around it" : ""),
          c.file + " lines " + c.lines.join(",") + " are added lines of " + short(c.merge_base) + ".." + short(c.reviewed_head),
          (c.kind === "escaped" ? fixRef + " title: " : fixRef + " subject: ") + c.fix.subject,
          ...c.history.excerpt.map((s) => "#" + c.pr + " Pre-Landing Review: " + s),
        ],
      },
      answer_key_audit: { by: hand.auditor, at: h.at, verdict: "confirmed", notes: h.notes + needsNote(h) },
      shelf_life: { first_appeared: c.shelf.first_appeared, source: c.shelf.source, short: true },
      credit: (c.kind === "escaped" ? "Fixed by @" + c.fix.author + " in " + c.repo + "#" + c.fix.pr + "; the defect came in with #" + c.pr + " by @" + c.pr_author + "." : "Caught in " + c.repo + "#" + c.pr + "'s own review and fixed in " + short(c.fix.commit) + " (author " + c.fix.author + "); #" + c.pr + " by @" + c.pr_author + ".") + " Mined by " + MINER + ".",
    };
    write(join(catalog, id + ".json"), out);
    write(join(catalog, "audit", id + ".json"), {
      id, key: c.key, kind: c.kind, rules: RULES_POST, checks: c.checks,
      located: { file: c.file, fix_file: c.fix_file, lines: c.lines, blamed: c.blamed, owned: c.owned, insertion_only: c.insertion_only, introduced_by: c.introduced_by },
      sizes: { reviewed_lines: c.reviewed_lines, decoy_lines: c.decoy_lines }, scope: c.scope, history: c.history, decoy_search: c.decoy,
      hand: h, needs_human_check: needs(h, [c.decoy]),
    });
    used.add(c.repo + "#" + c.pr).add(c.repo + "#" + c.fix.pr);
    confirmed++;
  }
  write(join(catalog, "mining", "drops.json"), drops.sort((a, b) => a.repo.localeCompare(b.repo) || (a.fix_pr ?? 0) - (b.fix_pr ?? 0) || a.key.localeCompare(b.key)));
  return { files, confirmed, pending, problems };
}

function needs(h: HandAudit | undefined, searches: DecoySearch[]): Array<{ item: string; reason: string }> {
  const out = [...(h?.needs_human_check ?? [])];
  searches.forEach((s, i) => {
    if (s.hits.length && !h?.decoys?.[String(i)]) out.push({ item: "decoy " + i, reason: s.hits.length + " later commits changed lines it added; nobody has read them, so its audit stays null" });
  });
  return out;
}

const needsNote = (h: HandAudit): string => (h.needs_human_check?.length ? " Needs human check: " + h.needs_human_check.map((n) => n.item + " (" + n.reason + ")").join("; ") + "." : "");

/** The generated files build owns: every case except the seeds, every audit record and drops.json. */
function generatedPaths(catalog: string, mined: Mined): string[] {
  const seeds = new Set(mined.existing.map((e) => e.id + ".json"));
  const audit = join(catalog, "audit");
  return [
    ...readdirSync(catalog).filter((f) => f.endsWith(".json") && !seeds.has(f)).map((f) => join(catalog, f)),
    ...(existsSync(audit) ? readdirSync(audit).filter((f) => f.endsWith(".json")).map((f) => join(audit, f)) : []),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------
// The dossier for the hand audit.

export async function dossier(c: Candidate, git: Git, api: Api): Promise<string> {
  const X = await api.get("repos/" + c.repo + "/pulls/" + c.pr);
  const F = c.kind === "escaped" ? await api.get("repos/" + c.repo + "/pulls/" + c.fix.pr) : null;
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "\n[... " + (s.length - n) + " more characters]" : s);
  const lines = (s: string, n: number) => { const l = s.split("\n"); return l.length > n ? l.slice(0, n).join("\n") + "\n[... " + (l.length - n) + " more lines]" : s; };
  const out = [
    "KEY " + c.key + " (" + c.kind + ")",
    "REVIEWED " + c.repo + "#" + c.pr + " \"" + c.pr_title + "\" by @" + c.pr_author + ", merged " + c.pr_merged_at + "; head " + short(c.reviewed_head) + ", base " + short(c.merge_base) + ", " + c.reviewed_lines + " filtered lines",
    "FIX " + (c.kind === "escaped" ? c.repo + "#" + c.fix.pr + " \"" + c.fix.subject + "\" by @" + c.fix.author + ", merged " + c.fix.merged_at : "commit " + short(c.fix.commit) + " \"" + c.fix.subject + "\" by " + c.fix.author),
    "LOCATED " + c.file + " lines " + c.lines.join(",") + " (" + c.owned + " of " + c.blamed + " blamed lines" + (c.insertion_only ? ", insertions only" : "") + ")",
    "HISTORY default " + JSON.stringify(c.history.default) + "; excerpt " + JSON.stringify(c.history.excerpt),
    "SHELF " + c.shelf.first_appeared,
    "",
    "=== " + (F ? "fix PR body" : "commit message"),
    clip(F ? F.body ?? "" : git.run(["log", "-1", "--format=%B", c.fix.commit]), 3500),
    "",
    "=== reviewed PR's Pre-Landing Review",
    clip(reviewSection(X.body) || "(none)", 2500),
    "",
    "=== fix diff, " + c.fix_file,
    lines(git.run(["diff", "-U3", "--no-color", c.fix.parent, c.fix.commit, "--", c.fix_file]), 160),
    "",
    "=== reviewed diff around the located lines, " + c.file,
    lines(git.run(["diff", "-U6", "--no-color", c.merge_base, c.reviewed_head, "--", c.file]).split(/^(?=@@ )/m).filter((h) => {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(h);
      if (!m) return false;
      const a = +m[1]!, b = a + (m[2] === undefined ? 1 : +m[2]);
      return c.lines.some((l) => l >= a && l < b);
    }).join(""), 160),
  ];
  for (const h of c.decoy.hits) {
    out.push("", "=== decoy hit " + short(h.commit) + (h.pr ? " (#" + h.pr + ")" : "") + " \"" + h.subject + "\" changed " + h.file + " lines " + h.lines.join(","));
    out.push(lines(git.run(["log", "-1", "--format=%B", h.commit]), 30));
    out.push(lines(git.run(["diff", "-U2", "--no-color", git.parents(h.commit)[0]!, h.commit, "--", h.file]), 80));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// The command line.

type ScriptCode = "E_USAGE" | "E_MINE_SOURCE" | "E_MINE_HAND" | "E_MINE_STALE";
const USAGE = "bun scripts/mine-review-cases.ts mine --clones <dir> [--repo <owner/name>]... [--cache <dir>] [--until <iso>] [--gstack <dir>] [--catalog <dir>] | build [--catalog <dir>] [--check] | next [--catalog <dir>] [--n <count>] | show <key> --clones <dir> [--catalog <dir>] [--cache <dir>]";

function fail(code: ScriptCode, messages: string[], fix: string = CODES[code].fix): never {
  console.error(codeLines(code, messages.map((m) => "mine-review-cases: " + m), fix));
  process.exit(CODES[code].exit);
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function flags(argv: string[]): { pos: string[]; one: Map<string, string>; many: Map<string, string[]>; set: Set<string> } {
  const pos: string[] = [];
  const one = new Map<string, string>();
  const many = new Map<string, string[]>();
  const set = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--check") { set.add(a); continue; }
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const v = argv[++i];
    if (v === undefined || !["--clones", "--repo", "--cache", "--until", "--gstack", "--catalog", "--n"].includes(a)) fail("E_USAGE", ["unknown flag or missing value: " + a], USAGE);
    if (a === "--repo") many.set(a, [...(many.get(a) ?? []), v]);
    else if (one.has(a)) fail("E_USAGE", [a + " given twice"], USAGE);
    else one.set(a, v);
  }
  return { pos, one, many, set };
}

function readJson<T>(path: string, code: ScriptCode): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch (e) { return fail(code, [path + ": " + reason(e)]); }
}

export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const f = flags(rest);
  const catalog = f.one.get("--catalog") ?? CATALOG;
  const minedPath = join(catalog, "mining", "mined.json");
  const handPath = join(catalog, "mining", "hand.json");
  const cache = f.one.get("--cache") ?? join(homedir(), ".capy", "work", "miner", "cache");
  if (cmd === "mine") {
    const clones = f.one.get("--clones") ?? fail("E_USAGE", ["mine needs --clones <dir>, holding a clone per repo named after it (git clone --filter=blob:limit=200k)"], USAGE);
    const repos = f.many.get("--repo") ?? RULES.repos;
    for (const r of repos) if (!existsSync(join(clones, r.split("/")[1]!, ".git"))) fail("E_MINE_SOURCE", ["no clone of " + r + " at " + join(clones, r.split("/")[1]!)], "git clone --filter=blob:limit=200k https://github.com/" + r + ".git " + join(clones, r.split("/")[1]!));
    let mined: Mined;
    try {
      mined = await mine({ clones, repos, api: ghApi(cache), until: f.one.get("--until") ?? new Date().toISOString(), catalog, scope: gstackScope(f.one.get("--gstack") ?? join(homedir(), ".local", "share", "gstack")), log: (l) => console.error(l) });
    } catch (e) {
      return fail("E_MINE_SOURCE", [reason(e)]);
    }
    mkdirSync(join(catalog, "mining"), { recursive: true });
    writeFileSync(minedPath, JSON.stringify(mined, null, 2) + "\n");
    console.log("mine-review-cases: " + mined.candidates.length + " candidates, " + mined.drops.length + " drops, " + mined.run.api_calls + " API calls; wrote " + minedPath);
  } else if (cmd === "build" || cmd === "next") {
    const mined = readJson<Mined>(minedPath, "E_MINE_STALE");
    const hand = existsSync(handPath) ? readJson<Hand>(handPath, "E_MINE_HAND") : { auditor: "", audits: {} };
    const known = new Set([...mined.candidates.map((c) => c.key), ...mined.existing.map((e) => e.id)]);
    const unknown = Object.keys(hand.audits).filter((k) => !known.has(k));
    if (unknown.length) fail("E_MINE_HAND", unknown.map((k) => handPath + " audits " + k + ", which mined.json does not hold"));
    const b = (() => { try { return build(catalog, mined, hand); } catch (e) { return fail("E_MINE_STALE", [reason(e)]); } })();
    if (b.problems.length) fail("E_MINE_HAND", b.problems);
    if (cmd === "next") {
      const n = Number(f.one.get("--n") ?? 20);
      for (const k of b.pending.slice(0, n)) console.log(k);
      console.error("mine-review-cases: " + b.confirmed + " confirmed, " + b.pending.length + " candidates before the stop rule await a hand audit");
      return;
    }
    const stale = [...b.files].filter(([p, t]) => !existsSync(p) || readFileSync(p, "utf8") !== t).map(([p]) => p);
    const extra = generatedPaths(catalog, mined).filter((p) => !b.files.has(p));
    if (f.set.has("--check")) {
      if (stale.length || extra.length) fail("E_MINE_STALE", [...stale.map((p) => p + " differs from what build computes"), ...extra.map((p) => p + " is not a file build writes")]);
      console.log("mine-review-cases: " + b.files.size + " files match; " + b.confirmed + " mined cases confirmed, " + b.pending.length + " awaiting a hand audit");
      return;
    }
    for (const p of extra) rmSync(p);
    for (const [p, t] of b.files) { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, t); }
    console.log("mine-review-cases: wrote " + b.files.size + " files (" + stale.length + " changed, " + extra.length + " removed); " + b.confirmed + " mined cases confirmed, " + b.pending.length + " awaiting a hand audit");
  } else if (cmd === "show" && f.pos[0]) {
    const mined = readJson<Mined>(minedPath, "E_MINE_STALE");
    const c = mined.candidates.find((x) => x.key === f.pos[0]) ?? fail("E_USAGE", ["mined.json holds no candidate " + f.pos[0]], USAGE);
    const clones = f.one.get("--clones") ?? fail("E_USAGE", ["show needs --clones <dir>"], USAGE);
    try { console.log(await dossier(c, new Git(join(clones, c.repo.split("/")[1]!)), ghApi(cache))); } catch (e) { fail("E_MINE_SOURCE", [reason(e)]); }
  } else {
    fail("E_USAGE", ["unknown command or missing argument: " + (argv.join(" ") || "(none)")], USAGE);
  }
}

if (import.meta.main) await main(process.argv.slice(2));

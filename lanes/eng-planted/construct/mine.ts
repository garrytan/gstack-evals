// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit miner (plan section 2, fix frame): first-parent commits F on a repository's default branch that look
// like a bug fix, change a runnable test file and a product file, change at most 80 product lines inside at most 3 named
// functions or methods in at most 2 files, add no product file and change no dependency, lock or generated file, with a
// permissive licence at F and no committed build output for the region's files; then the earliest public date (the
// earliest of F's author date, its pull request's open date and any linked issue's open date, from the GitHub API) must
// fall in the window. A candidate whose pull request or linked issue can't be read drops. Every drop is counted by
// reason; nothing about a repository's content prints.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ecoOfFile, hasRecipe, isDepFile, runnable } from "../../eng-build/recipes.ts";
import { isProtectedPath, languageOf } from "../../real-outcome/mine/paths.ts";
import { classifyFile, regionText } from "../../real-outcome/task/region.ts";
import { FROZEN } from "../frozen.ts";
import type { Ecosystem } from "../types.ts";
import { FIX_LABEL_RE, FIX_RE, frameLicence, LICENCE_FILES, mint, type GitHub, type MinedFix } from "./local.ts";
import { enclosing, functionsOf, lngOf } from "./region.ts";

const DOC_RE = /\.(md|mdx|rst|txt|adoc)$|^docs?\/|^\.changeset\/|(^|\/)(CHANGELOG|CHANGES|HISTORY|NEWS)[^/]*$/i;
const VENDORED = /(^|\/)(node_modules|vendor|third_party|dist|build|\.venv|venv)\//;
const GENERATED = /Code generated .* DO NOT EDIT|@generated|DO NOT EDIT/;
const BUILD_DIRS = /(^|\/)(dist|build|lib|out|es|esm|cjs|umd)\//;
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+#(\d+)/gi;

export interface MineOptions {
  repo: string;
  eco: Ecosystem;
  stars: number;
  /** A clone of the default branch with history back to the window's start. */
  mirror: string;
  github: GitHub;
  /** Fixes mined a repository at most; the supply caps qualifiers at FROZEN.frame.perRepo. */
  cap?: number;
}

export interface MineResult {
  /** Counts by step and drop reason. */
  stats: Record<string, number>;
  fixes: MinedFix[];
}

/** Clones a repository's default branch with history from two months before the window (enough for every P). */
export function cloneMirror(repo: string, dir: string): boolean {
  if (existsSync(dir)) return true;
  mkdirSync(dirname(dir), { recursive: true });
  const since = new Date(Date.parse(FROZEN.window.from) - 61 * 86400000).toISOString().slice(0, 10);
  return spawnSync("git", ["clone", "-q", "--single-branch", "--shallow-since=" + since, "https://github.com/" + repo + ".git", dir], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).status === 0;
}

/** The earliest public date of F, or a drop reason. */
export async function earliestPublic(github: GitHub, repo: string, sha: string, authorDate: string, message: string): Promise<{ date: string; labels: string[] } | { drop: string }> {
  const prs = await github("/repos/" + repo + "/commits/" + sha + "/pulls");
  if (prs.status !== 200 || !Array.isArray(prs.body)) return { drop: "pr_unreadable" };
  const dates = [authorDate];
  const labels: string[] = [];
  const issues = new Set<number>([...message.matchAll(CLOSES)].map((m) => Number(m[1])));
  for (const pr of prs.body) {
    if (typeof pr?.created_at !== "string") return { drop: "pr_unreadable" };
    dates.push(pr.created_at);
    for (const l of pr.labels ?? []) if (typeof l?.name === "string") labels.push(l.name);
    for (const m of String(pr.body ?? "").matchAll(CLOSES)) issues.add(Number(m[1]));
  }
  for (const n of [...issues].sort((a, b) => a - b)) {
    const issue = await github("/repos/" + repo + "/issues/" + n);
    if (issue.status !== 200 || typeof issue.body?.created_at !== "string") return { drop: "issue_unreadable" };
    dates.push(issue.body.created_at);
  }
  return { date: dates.map((d) => new Date(d).toISOString()).sort()[0], labels };
}

/** Mines one repository. */
export async function mineRepo(o: MineOptions): Promise<MineResult> {
  const cap = o.cap ?? 2 * FROZEN.frame.perRepo;
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const run = (args: string[]) => {
    const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: o.mirror, encoding: "utf8", maxBuffer: 1 << 30 });
    return { status: r.status ?? 1, out: r.stdout ?? "" };
  };
  const git = (args: string[]) => {
    const r = run(args);
    if (r.status !== 0) throw new Error("git " + args[0] + " failed");
    return r.out;
  };
  const show = (rev: string, path: string) => {
    const r = run(["show", rev + ":" + path]);
    return r.status === 0 ? r.out : null;
  };
  const fixes: MinedFix[] = [];
  const from = FROZEN.window.from;
  const to = FROZEN.window.to;
  const cutoff = [FROZEN.window.cutoffs.opus, FROZEN.window.cutoffs.sol].sort().pop()!;
  const commits = git(["log", "--first-parent", "--reverse", "--format=%H%x1f%aI%x1f%cI", "--since=" + from + "T00:00:00Z", "HEAD"]).split("\n").filter(Boolean).map((l) => l.split("\x1f"));
  for (const [F, authorDate, committerDate] of commits) {
    if (fixes.length >= cap) break;
    const committedInWindow = committerDate.slice(0, 10) <= to;
    bump(committedInWindow ? "committed_in_window" : "committed_after_window");
    const drop = (why: string): null => {
      bump("drop:" + why);
      return null;
    };
    const frame = (): Omit<MinedFix, "id" | "repo" | "eco" | "stars" | "fix" | "authorDate" | "committerDate" | "earliestPublic" | "licence"> | null => {
      const pr = run(["rev-parse", "--verify", "-q", F + "^1"]);
      if (pr.status !== 0 || run(["cat-file", "-e", pr.out.trim() + "^{tree}"]).status !== 0) return drop("parent_missing");
      const P = pr.out.trim();
      const ns = git(["diff", "--name-status", "-z", "--no-renames", P, F]).split("\0").filter(Boolean);
      const files: { path: string; st: string }[] = [];
      for (let i = 0; i + 1 < ns.length; i += 2) files.push({ st: ns[i][0], path: ns[i + 1] });
      const product: { path: string; st: string }[] = [];
      const tests: string[] = [];
      for (const f of files) {
        if (isDepFile(f.path)) return drop("dep_change");
        if (f.st !== "D" && (GENERATED.test((show(F, f.path) ?? "").slice(0, 600)) || /(\.pb\.go|_gen\.go|\.generated\.)/.test(f.path))) return drop("generated");
        if (isProtectedPath(f.path)) {
          const e = ecoOfFile(f.path);
          if (f.st !== "D" && e && hasRecipe(e) && runnable(e, f.path)) tests.push(f.path);
          continue;
        }
        if (VENDORED.test(f.path)) return drop("other_file");
        if (languageOf(f.path) !== null || ecoOfFile(f.path) !== null) product.push(f);
        else if (!DOC_RE.test(f.path) && !f.path.endsWith(".snap")) return drop("other_file");
      }
      for (const f of product) {
        if (!f.path.endsWith(".rs") || f.st !== "M") continue;
        const a = show(P, f.path) ?? "";
        const b = show(F, f.path) ?? "";
        if (classifyFile(f.path, b).kind === "region" && regionText(f.path, a) !== regionText(f.path, b)) tests.push(f.path);
      }
      if (product.length === 0) return drop("no_product_change");
      if (tests.length === 0) return drop("no_runnable_test_change");
      if (new Set([...product, ...tests.map((path) => ({ path }))].map((f) => ecoOfFile(f.path))).size !== 1 || ecoOfFile(product[0].path) !== o.eco) return drop("other_ecosystem");
      if (product.some((f) => f.st === "A")) return drop("new_product_file");
      if (product.some((f) => f.st === "D")) return drop("deleted_product_file");
      let lines = 0;
      const functions: MinedFix["functions"] = [];
      for (const f of product) {
        const l = lngOf(f.path);
        if (!l) return drop("unparsable_language");
        const before = show(P, f.path) ?? "";
        const c = l === "rust" ? classifyFile(f.path, before) : ({ kind: "product" } as const);
        if (c.kind === "mixed") return drop("mixed_test_product_file");
        const lineOf = (i: number) => before.slice(0, i).split("\n").length - 1;
        const region = c.kind === "region" ? [lineOf(c.start), lineOf(c.end)] : null;
        const hunks: { s: number; e: number }[] = [];
        for (const h of git(["diff", "-U0", "--no-renames", P, F, "--", f.path]).matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)) {
          const a = Number(h[1]);
          const n = h[2] === undefined ? 1 : Number(h[2]);
          const m = h[3] === undefined ? 1 : Number(h[3]);
          const s = a - 1;
          const e = n > 0 ? a - 1 + n - 1 : a;
          if (region && s >= region[0] && e <= region[1]) continue;
          if (region && e >= region[0] && s <= region[1]) return drop("hunk_straddles_test_region");
          hunks.push({ s, e });
          lines += n + m;
        }
        if (hunks.length === 0) continue;
        const fns = enclosing(functionsOf(l, before), hunks);
        if (!fns) return drop("hunk_outside_function");
        for (const fn of fns) functions.push({ file: f.path, name: fn.name, line: fn.sl + 1 });
      }
      const regionFiles = [...new Set(functions.map((f) => f.file))];
      if (regionFiles.length === 0) return drop("no_product_change");
      if (regionFiles.length > FROZEN.frame.maxFiles) return drop("too_many_product_files");
      if (lines > FROZEN.frame.maxProductLines) return drop("too_many_product_lines");
      if (functions.length > FROZEN.frame.maxFunctions) return drop("too_many_functions");
      const listing = git(["ls-tree", "-r", "--name-only", "-z", P]).split("\0").filter(Boolean);
      const stems = new Set(regionFiles.map((p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")));
      if (listing.some((p) => BUILD_DIRS.test(p) && /\.([cm]?js|map)$/.test(p) && stems.has(p.slice(p.lastIndexOf("/") + 1).replace(/(\.min)?\.[cm]?js(\.map)?$|\.map$/, "")))) return drop("committed_build_output");
      return { parent: P, productLines: lines, functions, testFiles: [...new Set(tests)].sort() };
    };
    const ok = frame();
    if (!ok) continue;
    const lic = LICENCE_FILES.map((f) => show(F, f)).find((t) => t !== null);
    const licence = lic ? frameLicence(lic) : null;
    if (!licence || !(FROZEN.frame.licences as readonly string[]).includes(licence)) {
      drop("licence");
      continue;
    }
    const message = git(["log", "-1", "--format=%B", F]);
    const pub = await earliestPublic(o.github, o.repo, F, authorDate, message);
    if ("drop" in pub) {
      drop(pub.drop);
      continue;
    }
    if (!FIX_RE.test(message) && !pub.labels.some((l) => FIX_LABEL_RE.test(l))) {
      drop("not_a_fix");
      continue;
    }
    const day = pub.date.slice(0, 10);
    if (day <= cutoff || day < from) {
      drop(committedInWindow ? "public_before_window" : "public_before_window_committed_after");
      continue;
    }
    if (day > to) {
      drop("public_after_window");
      continue;
    }
    if (!committedInWindow) bump("public_in_window_committed_after");
    bump("mined");
    fixes.push({ id: mint("p"), repo: o.repo, eco: o.eco, stars: o.stars, fix: F, authorDate, committerDate, earliestPublic: pub.date, licence, ...ok });
  }
  return { stats, fixes };
}

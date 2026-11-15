// Copyright (c) 2026 Garry Tan. MIT License.
// The B1 miner (plan section 6): a repository list searched once on the freeze date and frozen as b1-repos.json (TypeScript
// and JavaScript repositories that run a real-browser test runner at the root, with a permissive licence or one pending
// section 5's second read), then their merged pull
// requests with "fix" in the title, closing exactly one linked issue (its title and body are the problem statement, kept
// only as a sha256), changing at least one browser-test file by the frozen path rule and 1 to 6 non-test source files.
// The fallback's widened months are mined in the same run and tagged. b1-frame.json holds the issue URL and the
// statement's sha256, never its text, and the drop counts per rule and per exclusion pattern.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPrereg, type H2hPrereg } from "../prereg.ts";
import type { SecondRead } from "../ordinary/frame.ts";
import { LICENCE_RULE, bump, excludedBy, fileClass, FREEZE_DATE, licenceStatus, secondReadCounts, secondReadVerdict, sha256, sorted, windowOf, windows, type Gql, type Windows } from "./frame.ts";

export const SEARCH_LANGS = ["TypeScript", "JavaScript"] as const;
/** The frozen repository search, one query per language with no licence qualifier (GitHub's licence search cannot find a
 *  repository whose licence it does not detect); star ranges split a query past GitHub's 1,000. */
export const SEARCH = { stars_min: 5000, pushed_after: "2026-09-01", template: "language:{lang} stars:{stars} archived:false pushed:>2026-09-01" } as const;
/** Root files probed for a runner's config. */
export const PROBES: Record<string, string> = {
  pw_ts: "playwright.config.ts", pw_js: "playwright.config.js", pw_mjs: "playwright.config.mjs", pw_mts: "playwright.config.mts",
  cy_ts: "cypress.config.ts", cy_js: "cypress.config.js", cy_mjs: "cypress.config.mjs",
  wtr_mjs: "web-test-runner.config.mjs", wtr_js: "web-test-runner.config.js", wtr_cjs: "web-test-runner.config.cjs",
  karma_js: "karma.conf.js", karma_cjs: "karma.conf.cjs", karma_ts: "karma.conf.ts",
  vw_ts: "vitest.workspace.ts", vw_mts: "vitest.workspace.mts", vc_ts: "vitest.config.ts", vc_mts: "vitest.config.mts", vc_mjs: "vitest.config.mjs", vc_js: "vitest.config.js",
};
export type Runner = "playwright" | "vitest-browser" | "web-test-runner" | "cypress" | "karma" | "puppeteer";
export const RUNNERS: readonly Runner[] = ["playwright", "vitest-browser", "web-test-runner", "cypress", "karma", "puppeteer"];
/** A Vitest config that turns browser mode on. */
export const VITEST_BROWSER = /\bbrowser\s*:\s*\{[^}]*\b(enabled|provider|instances|name)\b/s;

/** The real-browser runners a repository shows at its root: the root package.json's dependencies and devDependencies, its
 *  scripts, and the root config files. */
export function rootRunners(pkgText: string, probes: Record<string, string | null>): Runner[] {
  const out = new Set<Runner>();
  let pj: any = {};
  try {
    pj = pkgText ? JSON.parse(pkgText) : {};
  } catch {}
  const deps = Object.keys({ ...(pj?.dependencies ?? {}), ...(pj?.devDependencies ?? {}) });
  for (const d of deps) {
    if (d === "@playwright/test" || d === "playwright" || d === "playwright-core") out.add("playwright");
    if (d.startsWith("@vitest/browser")) out.add("vitest-browser");
    if (d === "@web/test-runner") out.add("web-test-runner");
    if (d === "karma") out.add("karma");
    if (d === "cypress") out.add("cypress");
    if (d === "puppeteer" || d === "puppeteer-core" || d === "jest-puppeteer") out.add("puppeteer");
  }
  const scripts = Object.values(pj?.scripts ?? {}).map(String).join(" ");
  if (/\bplaywright test\b/.test(scripts)) out.add("playwright");
  if (/\b(wtr|web-test-runner)\b/.test(scripts)) out.add("web-test-runner");
  if (/\bkarma start\b/.test(scripts)) out.add("karma");
  if (/\bcypress run\b/.test(scripts)) out.add("cypress");
  for (const [k, text] of Object.entries(probes)) {
    if (text === null) continue;
    if (k.startsWith("pw")) out.add("playwright");
    else if (k.startsWith("cy")) out.add("cypress");
    else if (k.startsWith("wtr")) out.add("web-test-runner");
    else if (k.startsWith("karma")) out.add("karma");
    else if (VITEST_BROWSER.test(text)) out.add("vitest-browser");
  }
  return RUNNERS.filter((r) => out.has(r));
}

/** The frozen browser-test path rule: a JavaScript or TypeScript file (not a declaration file) under an e2e, e2e-test(s),
 *  playwright, cypress, wtr, runtime-browser, browser-test(s) or test(s)-browser directory, or named *.cy, *.e2e, *.pw or
 *  *.browser with an optional .test or .spec, or under a browser directory inside a test path. */
export const BROWSER_TEST = {
  dir: /(^|\/)(e2e|e2e-tests?|playwright|cypress|wtr|runtime-browser|browser-tests?|tests?-browser)\//i,
  suffix: /\.(cy|e2e|pw|browser)\.(test\.|spec\.)?[cm]?[jt]sx?$/i,
  browserDir: /(^|\/)browser\//i,
  testy: /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i,
  code: /\.[cm]?[jt]sx?$/i,
  declaration: /\.d\.[cm]?ts$/i,
};
export function isBrowserTest(path: string): boolean {
  const b = BROWSER_TEST;
  if (!b.code.test(path) || b.declaration.test(path)) return false;
  return b.dir.test(path) || b.suffix.test(path) || (b.browserDir.test(path) && b.testy.test(path));
}
/** B1 file counts: browser-test files by the path rule; non-test source files by the ts language's frozen lists with every
 *  browser-test file counted as a test. */
export function b1Counts(paths: readonly string[]): { browser_test: number; test: number; source: number; total: number } {
  let browser_test = 0, test = 0, source = 0;
  for (const p of paths) {
    if (isBrowserTest(p)) {
      browser_test++;
      test++;
      continue;
    }
    const k = fileClass(["ts"], p);
    if (k === "test") test++;
    else if (k === "source") source++;
  }
  return { browser_test, test, source, total: paths.length };
}

/** "fix" in the title: the word fix, fixes, fixed or fixing, case-insensitive. */
export const FIX_TITLE = /\bfix(e[sd]|ing)?\b/i;
/** The problem statement whose sha256 the frame keeps: the issue's title, a blank line, then its body as GitHub returns it. */
export const statementText = (title: string, body: string | null): string => title + "\n\n" + (body ?? "");

/** licence is GraphQL's raw spdxId (null when it names none). runners is null when the repository was not probed: its
 *  licence is neither on the permissive list nor pending the second read, or it is excluded or archived. */
export interface RepoRow { repo: string; stars: number; licence: string | null; language: string | null; archived: boolean; runners: Runner[] | null }

const lightFields = "nameWithOwner stargazerCount isArchived licenseInfo { spdxId } primaryLanguage { name }";
const probeFields = "pkg: object(expression: \"HEAD:package.json\") { ... on Blob { text } } " +
  Object.entries(PROBES).map(([k, v]) => k + ": object(expression: \"HEAD:" + v + "\") { ... on Blob { " + (k.startsWith("v") ? "text" : "byteSize") + " } }").join(" ");

/** The root reads for the runner rule, 10 repositories per query: package.json's text and each probe file. */
export async function probeRepos(names: string[], gql: Gql, log: (s: string) => void = () => {}): Promise<Record<string, Runner[]>> {
  const out: Record<string, Runner[]> = {};
  for (let i = 0; i < names.length; i += 10) {
    const chunk = names.slice(i, i + 10);
    const parts = chunk.map((full, j) => {
      const [o, n] = full.split("/");
      return "r" + j + ": repository(owner: " + JSON.stringify(o) + ", name: " + JSON.stringify(n) + ") { " + probeFields + " }";
    });
    const { data } = await gql("query { rateLimit { cost remaining resetAt } " + parts.join(" ") + " }");
    chunk.forEach((full, j) => {
      const n = data["r" + j] ?? {};
      const probes = Object.fromEntries(Object.keys(PROBES).map((k) => [k, n[k] ? (n[k].text ?? "") : null]));
      out[full] = rootRunners(n.pkg?.text ?? "", probes);
    });
    if ((i / 10) % 10 === 0) log("probed " + Math.min(i + 10, names.length) + "/" + names.length);
  }
  return out;
}

/** The repository search, run once: one query per language, paged 50 at a time, star ranges halved while a query reports
 *  more than 1,000 results. Rows are keyed by nameWithOwner. Only repositories that are not excluded or archived and whose
 *  licence is permissive or pending are probed; known holds probe results already read on the freeze date. */
export async function searchRepos(gql: Gql, p: Pick<H2hPrereg, "licences" | "exclusion"> = readPrereg(), log: (s: string) => void = () => {}, known: Record<string, Runner[]> = {}): Promise<{ rows: RepoRow[]; queries: string[] }> {
  const rows = new Map<string, RepoRow>();
  const queries: string[] = [];
  const one = async (q: string) => {
    let after: string | null = null;
    for (;;) {
      const cur: string = after ? ", after: " + JSON.stringify(after) : "";
      const { data } = await gql("query { rateLimit { cost remaining resetAt } search(type: REPOSITORY, query: " + JSON.stringify(q) + ", first: 50" + cur + ") { repositoryCount pageInfo { hasNextPage endCursor } nodes { ... on Repository { " + lightFields + " } } } }");
      const s = data.search ?? {};
      for (const n of s.nodes ?? []) {
        if (!n?.nameWithOwner) continue;
        rows.set(n.nameWithOwner, { repo: n.nameWithOwner, stars: n.stargazerCount, licence: n.licenseInfo?.spdxId ?? null, language: n.primaryLanguage?.name ?? null, archived: !!n.isArchived, runners: null });
      }
      if (!s.pageInfo?.hasNextPage) return s.repositoryCount as number;
      after = s.pageInfo.endCursor;
    }
  };
  const count = async (q: string) => ((await gql("query { rateLimit { cost remaining resetAt } search(type: REPOSITORY, query: " + JSON.stringify(q) + ", first: 1) { repositoryCount } }")).data.search?.repositoryCount ?? 0) as number;
  const walk = async (lang: string, lo: number, hi: number | null) => {
    const stars = hi === null ? ">=" + lo : lo + ".." + hi;
    const q = SEARCH.template.replace("{lang}", lang).replace("{stars}", stars);
    const n = await count(q);
    if (n > 1000 && (hi === null || hi - lo > 1)) {
      const mid = hi === null ? lo * 2 : Math.floor((lo + hi) / 2);
      await walk(lang, lo, mid);
      await walk(lang, mid + 1, hi);
      return;
    }
    queries.push(q);
    await one(q);
    log("search " + q + ": " + n);
  };
  for (const lang of SEARCH_LANGS) await walk(lang, SEARCH.stars_min + 1, null);
  const probe = [...rows.values()].filter((r) => !excludedBy(r.repo, p.exclusion) && !r.archived && licenceStatus(r.licence, p.licences) !== "out").map((r) => r.repo).sort();
  const runners = { ...known, ...(await probeRepos(probe.filter((r) => !(r in known)), gql, log)) };
  for (const r of rows.values()) if (probe.includes(r.repo)) r.runners = runners[r.repo] ?? [];
  return { rows: [...rows.values()].sort((a, b) => (a.repo < b.repo ? -1 : 1)), queries };
}

export type B1Rule = "title_no_fix" | "outside_window" | "no_merge_commit" | "no_closing_issue" | "closes_many" | "no_browser_test" | "source_files_0" | "source_files_over_6";

export interface B1Row {
  repo: string; number: number; url: string; merged: string; month: string; window: "primary" | "widened"; licence: string | null; second_read_pending: boolean; licence_from: "graphql" | "files" | null; runners: Runner[];
  fix: { commit: string; parent: string }; files: { browser_test: number; test: number; source: number; total: number };
  issue_url: string; statement_sha256: string; statement_chars: number;
}

/** One pull request as the miner reads it. */
export interface PrNode { number: number; title: string; url: string; mergedAt: string | null; mergeCommit: { oid: string; parents: { nodes: { oid: string }[] } } | null; files: { totalCount: number; nodes: { path: string }[] }; closingIssuesReferences: { totalCount: number; nodes: { url: string; title: string; body: string | null }[] } }

/** The pull-request rules, in order, over one pull request whose file list is complete. */
export function screenPr(repo: RepoRow, pr: PrNode, w: Windows, from: "graphql" | "files" | null = repo.licence === null || repo.licence === "NOASSERTION" ? null : "graphql"): B1Row | B1Rule {
  if (!FIX_TITLE.test(pr.title)) return "title_no_fix";
  const day = (pr.mergedAt ?? "").slice(0, 10);
  const win = windowOf(day, w);
  if (!win) return "outside_window";
  const ci = pr.closingIssuesReferences;
  if (!ci?.totalCount) return "no_closing_issue";
  if (ci.totalCount > 1) return "closes_many";
  const n = b1Counts(pr.files.nodes.map((f) => f.path));
  if (n.browser_test < 1) return "no_browser_test";
  if (n.source < 1) return "source_files_0";
  if (n.source > 6) return "source_files_over_6";
  const parent = pr.mergeCommit?.parents?.nodes?.[0]?.oid;
  if (!pr.mergeCommit || !parent) return "no_merge_commit";
  const issue = ci.nodes[0]!;
  const text = statementText(issue.title, issue.body);
  return { repo: repo.repo, number: pr.number, url: pr.url, merged: day, month: day.slice(0, 7), window: win, licence: repo.licence, second_read_pending: from === null, licence_from: from, runners: repo.runners ?? [], fix: { commit: pr.mergeCommit.oid, parent }, files: n, issue_url: issue.url, statement_sha256: sha256(text), statement_chars: Array.from(text).length };
}

const prFields = "number title url mergedAt mergeCommit { oid parents(first: 2) { nodes { oid } } } files(first: 100) { totalCount nodes { path } } closingIssuesReferences(first: 2) { totalCount nodes { url title body } }";

/** One repository's merged fix pull requests in the widened window: GitHub search "fix in:title", merged date ranges split
 *  by halves while a range reports more than 1,000; each page 50 pull requests. A pull request with more than 100 files
 *  whose first page does not already exceed 6 source files gets its remaining files paged in. */
export async function repoPrs(repo: RepoRow, gql: Gql, w: Windows, log: (s: string) => void = () => {}): Promise<PrNode[]> {
  const out: PrNode[] = [];
  const range = async (from: string, to: string) => {
    const q = "repo:" + repo.repo + " is:pr is:merged fix in:title merged:" + from + ".." + to;
    let after: string | null = null;
    for (;;) {
      const cur: string = after ? ", after: " + JSON.stringify(after) : "";
      const { data } = await gql("query { rateLimit { cost remaining resetAt } search(type: ISSUE, query: " + JSON.stringify(q) + ", first: 50" + cur + ") { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { " + prFields + " } } } }");
      const s = data.search ?? {};
      if (!after && s.issueCount > 1000 && from < to) {
        const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
        const mid = new Date(a + Math.floor((b - a) / 86_400_000 / 2) * 86_400_000).toISOString().slice(0, 10);
        const next = new Date(Date.parse(mid + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
        await range(from, mid);
        await range(next, to);
        return;
      }
      for (const n of s.nodes ?? []) if (n?.number) out.push(n as PrNode);
      if (!s.pageInfo?.hasNextPage) return;
      after = s.pageInfo.endCursor;
    }
  };
  await range(w.widen_to, w.to);
  for (const pr of out) {
    if (pr.files.totalCount <= pr.files.nodes.length || b1Counts(pr.files.nodes.map((f) => f.path)).source > 6) continue;
    let after: string | null = null;
    const [o, n] = repo.repo.split("/");
    const all = [...pr.files.nodes];
    let first = true;
    while (first || after) {
      first = false;
      const { data } = await gql("query { rateLimit { cost remaining resetAt } r: repository(owner: " + JSON.stringify(o) + ", name: " + JSON.stringify(n) + ") { pullRequest(number: " + pr.number + ") { files(first: 100" + (after ? ", after: " + JSON.stringify(after) : "") + ") { pageInfo { hasNextPage endCursor } nodes { path } } } } }");
      const f = data.r?.pullRequest?.files;
      if (after === null) all.length = 0;
      all.push(...(f?.nodes ?? []));
      after = f?.pageInfo?.hasNextPage ? f.pageInfo.endCursor : null;
    }
    pr.files.nodes = all;
  }
  log(repo.repo + ": " + out.length + " fix pull requests");
  return out;
}

/** The repository screens: not excluded, a licence on the permissive list or pending the second read (kept and marked, never
 *  dropped here), not archived, a root real-browser runner. */
export function screenRepos(rows: RepoRow[], p: Pick<H2hPrereg, "exclusion" | "licences">, second?: SecondRead): { kept: RepoRow[]; drops: Record<string, number>; excluded: Record<string, number> } {
  const drops: Record<string, number> = {}, excluded: Record<string, number> = {};
  const kept: RepoRow[] = [];
  for (const r of rows) {
    const ex = excludedBy(r.repo, p.exclusion);
    if (ex) { bump(drops, "excluded"); bump(excluded, ex); continue; }
    const status = licenceStatus(r.licence, p.licences);
    if (status === "out") { bump(drops, "licence_not_permissive"); continue; }
    const v = status === "permissive" ? "graphql" : secondReadVerdict(r.repo, second);
    if (v === "licence_files_no_file" || v === "licence_files_unmatched") { bump(drops, v); continue; }
    if (r.archived) { bump(drops, "archived"); continue; }
    if (!r.runners?.length) { bump(drops, "no_root_browser_runner"); continue; }
    kept.push(r);
  }
  return { kept, drops, excluded: Object.fromEntries(p.exclusion.map((x) => [x, excluded[x] ?? 0])) };
}

export const B1_REPOS_SCHEMA = "h2h-b1-repos.v1";
export const B1_SCHEMA = "h2h-b1-frame.v1";
export const B1_LICENCES_SCHEMA = "h2h-b1-licences.v1";

/** b1-repos.json's body from one search. */
export const reposFile = (s: { rows: RepoRow[]; queries: string[] }) => ({ schema: B1_REPOS_SCHEMA, freeze_date: FREEZE_DATE, search: SEARCH, probes: PROBES, runner_rule: "root package.json dependencies, devDependencies and scripts, and the root config files (b1.ts rootRunners), read only for repositories not excluded or archived whose licence is permissive or pending the second read", licence_rule: LICENCE_RULE, queries: s.queries, repos: s.rows });

/** The frame over a frozen repository list and every kept repository's pull requests. */
export function b1Frame(reposBody: { repos: RepoRow[] }, prs: Record<string, PrNode[]>, p: H2hPrereg = readPrereg(), second?: SecondRead) {
  const w = windows(p);
  const rs = screenRepos(reposBody.repos, p, second);
  const byRule: Record<string, Record<string, number>> = {};
  const rows: B1Row[] = [];
  for (const r of rs.kept)
    for (const pr of prs[r.repo] ?? []) {
      const s = screenPr(r, pr, w, licenceStatus(r.licence, p.licences) === "permissive" ? "graphql" : secondReadVerdict(r.repo, second) === "files" ? "files" : null);
      if (typeof s === "string") {
        const win = windowOf((pr.mergedAt ?? "").slice(0, 10), w) ?? "outside";
        byRule[s] ??= {};
        bump(byRule[s]!, win);
      } else rows.push(s);
    }
  rows.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.number - b.number));
  const cap3 = (wins: string[]) => {
    const per: Record<string, number> = {};
    for (const r of rows.filter((r) => wins.includes(r.window))) bump(per, r.repo);
    return { units: Object.values(per).reduce((s, v) => s + Math.min(3, v), 0), repos: Object.keys(per).length };
  };
  return {
    schema: B1_SCHEMA, freeze_date: FREEZE_DATE, window: { primary: [w.from, w.to], widened: [w.widen_to, w.to] },
    rules: {
      licence: LICENCE_RULE, title: FIX_TITLE.source, statement: "the one closing issue's title, a blank line, then its body; only its sha256 and length are kept",
      browser_test: { dir: BROWSER_TEST.dir.source, suffix: BROWSER_TEST.suffix.source, browser_dir: BROWSER_TEST.browserDir.source, testy: BROWSER_TEST.testy.source, code: BROWSER_TEST.code.source, not: BROWSER_TEST.declaration.source },
      source: "lanes/outcome-skills/statemachines/langs.ts classify with language ts, browser-test files counted as tests",
      fix: "the pull request's merge commit; parent is its first parent",
    },
    counts: { repos_searched: reposBody.repos.length, repos_kept: rs.kept.length, repos_kept_second_read_pending: rs.kept.filter((r) => licenceStatus(r.licence, p.licences) === "second_read_pending" && secondReadVerdict(r.repo, second) === "pending").length, eligible_primary: rows.filter((r) => r.window === "primary").length, eligible_widened: rows.filter((r) => r.window === "widened").length, second_read_pending_primary: rows.filter((r) => r.window === "primary" && r.second_read_pending).length, second_read_pending_widened: rows.filter((r) => r.window === "widened" && r.second_read_pending).length, licence_from_files: { primary: rows.filter((r) => r.window === "primary" && r.licence_from === "files").length, widened: rows.filter((r) => r.window === "widened" && r.licence_from === "files").length }, licence_second_read: secondReadCounts(second), cap3_primary: cap3(["primary"]), cap3_with_widened: cap3(["primary", "widened"]) },
    drops: { repos: sorted(rs.drops), excluded_repos_by_pattern: rs.excluded, pull_requests_by_rule: Object.fromEntries(Object.entries(byRule).sort().map(([k, v]) => [k, sorted(v)])) },
    pull_requests: rows,
  };
}

/** The whole B1 run: the repository search (or a frozen b1-repos.json body), then every kept repository's pull requests,
 *  cached per repository under work so a stopped run resumes. */
export async function mineB1(o: { gql: Gql; work: string; repos?: ReturnType<typeof reposFile>; second?: SecondRead; log?: (s: string) => void; prereg?: H2hPrereg }) {
  const log = o.log ?? (() => {});
  const p = o.prereg ?? readPrereg();
  const w = windows(p);
  const reposBody = o.repos ?? reposFile(await searchRepos(o.gql, p, log));
  const { kept } = screenRepos(reposBody.repos, p);
  log("repositories kept: " + kept.length + " of " + reposBody.repos.length);
  const dir = join(o.work, "b1-prs");
  mkdirSync(dir, { recursive: true });
  const prs: Record<string, PrNode[]> = {};
  let i = 0;
  for (const r of kept) {
    const f = join(dir, r.repo.replace("/", "__") + ".json");
    if (existsSync(f)) prs[r.repo] = JSON.parse(readFileSync(f, "utf8"));
    else {
      prs[r.repo] = await repoPrs(r, o.gql, w, log);
      writeFileSync(f, JSON.stringify(prs[r.repo]));
    }
    if (++i % 25 === 0) log("repositories mined " + i + "/" + kept.length);
  }
  return { repos: reposBody, frame: b1Frame(reposBody, prs, p, o.second) };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The B2 miner (plan section 6): reviewed, not withdrawn GitHub advisories from github/advisory-database at a pinned commit,
// published inside the window (the fallback's widened months are mined in the same run and tagged), in npm, Go, Maven,
// crates.io and NuGet, with exactly one GitHub repository among the fix references; then the exclusion list, the licence
// read (once, by GraphQL, frozen as b2-licences.json) and the permissive list; then the fix commit or pull request's file
// list, which must hold at least 1 test file and 1 to 6 non-test source files. b2-frame.json holds one object per eligible
// advisory (ids, repository, fix, month, ecosystem, licence and counts, never advisory text) and the drop counts per rule
// and per exclusion pattern.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h2hFail, readPrereg, type H2hPrereg } from "../prereg.ts";
import { bump, ECOSYSTEM_LANG, excludedBy, fileCounts, FREEZE_DATE, pool, sorted, windowOf, windows, writeJson, type Gql, type Windows } from "./frame.ts";

export const ADVISORY_DB = { repo: "github/advisory-database", url: "https://github.com/github/advisory-database.git", commit: "a91f5a514f4697f0303f547c9b50a12eb07fa70f", committed: "2026-11-15T03:35:23Z", licence: "CC-BY-4.0" } as const;
/** The reviewed advisory directories the miner reads: the years the widened window spans. */
export const ADVISORY_DIRS = ["advisories/github-reviewed/2025", "advisories/github-reviewed/2026"] as const;
/** A fix reference: a GitHub commit or pull request URL. */
export const FIX_REF = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(commit|commits|pull)\/([0-9a-f]{7,40}|\d+)(?:[/#?].*)?$/;

export interface FixRef { repo: string; kind: "commit" | "pull"; ref: string }
/** The fields of one advisory the miner reads. Summary and details are never read here. */
export interface Advisory { ghsa: string; path: string; published: string; withdrawn: boolean; reviewed: boolean; ecosystems: string[]; refs: FixRef[] }

/** One advisory JSON (OSV 1.4) to the miner's fields. Fix references keep the advisory's order, deduplicated. */
export function readAdvisory(json: any, path: string): Advisory {
  const refs: FixRef[] = [];
  const seen = new Set<string>();
  for (const r of json.references ?? []) {
    const m = String(r?.url ?? "").trim().match(FIX_REF);
    if (!m) continue;
    const ref: FixRef = { repo: m[1] + "/" + m[2], kind: m[3] === "pull" ? "pull" : "commit", ref: m[4]!.toLowerCase() };
    const key = ref.repo.toLowerCase() + " " + ref.kind + " " + ref.ref;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }
  const ecosystems = [...new Set<string>((json.affected ?? []).map((a: any) => a?.package?.ecosystem).filter((e: unknown): e is string => typeof e === "string"))].sort();
  return { ghsa: String(json.id), path, published: String(json.published ?? "").slice(0, 10), withdrawn: !!json.withdrawn, reviewed: json.database_specific?.github_reviewed === true, ecosystems, refs };
}

/** Reads every advisory under ADVISORY_DIRS at the pinned commit; refuses (E_H2H_B_MINE) a clone at another commit. */
export function readAdvisoryDb(dir: string): Advisory[] {
  const head = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  if (head !== ADVISORY_DB.commit) h2hFail("E_H2H_B_MINE", dir + " is at " + (head || "no commit") + ", not the pinned advisory-database commit " + ADVISORY_DB.commit);
  const out: Advisory[] = [];
  for (const top of ADVISORY_DIRS) {
    const root = join(dir, top);
    if (!existsSync(root)) h2hFail("E_H2H_B_MINE", root + " is missing; the sparse checkout must hold " + ADVISORY_DIRS.join(" and "));
    for (const month of readdirSync(root).sort())
      for (const id of readdirSync(join(root, month)).sort())
        for (const f of readdirSync(join(root, month, id)).filter((x) => x.endsWith(".json")).sort()) {
          const rel = join(top, month, id, f);
          out.push(readAdvisory(JSON.parse(readFileSync(join(dir, rel), "utf8")), rel));
        }
  }
  return out;
}

/** A sparse, blobless clone of the advisory database at the pinned commit. */
export function cloneAdvisoryDb(dir: string): void {
  const git = (args: string[], cwd?: string) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 1_800_000 });
    if (r.status !== 0) h2hFail("E_H2H_B_MINE", "git " + args.join(" ") + " failed: " + (r.stderr || "").slice(-300));
  };
  if (!existsSync(join(dir, ".git"))) git(["clone", "--filter=blob:none", "--sparse", "--no-checkout", "--depth", "1", ADVISORY_DB.url, dir]);
  git(["sparse-checkout", "set", ...ADVISORY_DIRS], dir);
  git(["fetch", "--depth", "1", "--filter=blob:none", "origin", ADVISORY_DB.commit], dir);
  git(["checkout", "-q", "--detach", ADVISORY_DB.commit], dir);
}

/** The frozen fix rule: the fix is the advisory's first pull request reference when it has one, else its first commit
 *  reference, both in the advisory's own order. */
export const chooseFix = (refs: FixRef[]): FixRef | undefined => refs.find((r) => r.kind === "pull") ?? refs.find((r) => r.kind === "commit");

export type B2Rule =
  | "not_reviewed" | "withdrawn" | "outside_window" | "ecosystem" | "no_github_fix_ref" | "fix_repos_not_one" | "excluded"
  | "licence_not_found" | "licence_not_permissive" | "archived" | "fix_pr_not_merged" | "fix_unreadable" | "no_test_file"
  | "source_files_0" | "source_files_over_6";

export interface B2Candidate { ghsa: string; path: string; published: string; window: "primary" | "widened"; ecosystems: string[]; repo: string; fix: FixRef; fix_refs: number }

export interface Drops { by_rule: Record<string, Record<string, number>>; excluded: Record<string, Record<string, number>> }
export const newDrops = (): Drops => ({ by_rule: {}, excluded: {} });
const drop = (d: Drops, rule: B2Rule, window: string) => {
  d.by_rule[rule] ??= {};
  bump(d.by_rule[rule]!, window);
};

/** The keyless screens before any network read: reviewed, not withdrawn, inside the widened window, every affected
 *  ecosystem one of the five, at least one GitHub fix reference, one repository among them, and not on the exclusion list
 *  (by the referenced name; the canonical name is checked again after the licence read). */
export function screenAdvisories(advs: Advisory[], p: Pick<H2hPrereg, "exclusion">, w: Windows, d: Drops): B2Candidate[] {
  const out: B2Candidate[] = [];
  for (const a of advs) {
    const win = windowOf(a.published, w);
    const tag = win ?? "outside";
    if (!a.reviewed) { drop(d, "not_reviewed", tag); continue; }
    if (a.withdrawn) { drop(d, "withdrawn", tag); continue; }
    if (!win) { drop(d, "outside_window", tag); continue; }
    if (!a.ecosystems.length || !a.ecosystems.every((e) => e in ECOSYSTEM_LANG)) { drop(d, "ecosystem", win); continue; }
    if (!a.refs.length) { drop(d, "no_github_fix_ref", win); continue; }
    if (new Set(a.refs.map((r) => r.repo.toLowerCase())).size !== 1) { drop(d, "fix_repos_not_one", win); continue; }
    const repo = a.refs[0]!.repo;
    const ex = excludedBy(repo, p.exclusion);
    if (ex) {
      drop(d, "excluded", win);
      d.excluded[ex] ??= {};
      bump(d.excluded[ex]!, win);
      continue;
    }
    out.push({ ghsa: a.ghsa, path: a.path, published: a.published, window: win, ecosystems: a.ecosystems, repo, fix: chooseFix(a.refs)!, fix_refs: a.refs.length });
  }
  return out;
}

export interface RepoLicence { name_with_owner: string; spdx: string | null; archived: boolean }
export type LicenceMap = Record<string, RepoLicence | "NOT_FOUND">;

/** The licence read: GitHub's detected licence and archived flag on the default branch, 50 repositories per query, keyed
 *  by the referenced name in lower case. */
export async function readLicences(repos: string[], gql: Gql, log: (s: string) => void = () => {}): Promise<LicenceMap> {
  const out: LicenceMap = {};
  const todo = [...new Set(repos.map((r) => r.toLowerCase()))].sort();
  for (let i = 0; i < todo.length; i += 50) {
    const chunk = todo.slice(i, i + 50);
    const parts = chunk.map((full, j) => {
      const [o, n] = full.split("/");
      return "r" + j + ": repository(owner: " + JSON.stringify(o) + ", name: " + JSON.stringify(n) + ") { nameWithOwner isArchived licenseInfo { spdxId } }";
    });
    const { data } = await gql("query { rateLimit { cost remaining resetAt } " + parts.join(" ") + " }");
    chunk.forEach((full, j) => {
      const n = data["r" + j];
      out[full] = n ? { name_with_owner: n.nameWithOwner, spdx: n.licenseInfo?.spdxId ?? null, archived: !!n.isArchived } : "NOT_FOUND";
    });
    log("licences " + Math.min(i + 50, todo.length) + "/" + todo.length);
  }
  return out;
}

export interface LicencedCandidate extends B2Candidate { licence: string; canonical: string }

/** The licence screen: found, on prereg.json's permissive list, not archived, and the canonical name (after a rename) not on
 *  the exclusion list either. */
export function screenLicences(cands: B2Candidate[], lic: LicenceMap, p: Pick<H2hPrereg, "exclusion" | "licences">, d: Drops): LicencedCandidate[] {
  const out: LicencedCandidate[] = [];
  for (const c of cands) {
    const l = lic[c.repo.toLowerCase()];
    if (!l || l === "NOT_FOUND") { drop(d, "licence_not_found", c.window); continue; }
    const ex = excludedBy(l.name_with_owner, p.exclusion);
    if (ex) {
      drop(d, "excluded", c.window);
      d.excluded[ex] ??= {};
      bump(d.excluded[ex]!, c.window);
      continue;
    }
    if (!l.spdx || !p.licences.includes(l.spdx)) { drop(d, "licence_not_permissive", c.window); continue; }
    if (l.archived) { drop(d, "archived", c.window); continue; }
    out.push({ ...c, licence: l.spdx, canonical: l.name_with_owner });
  }
  return out;
}

/** A fix's file list: the pull request's files (GitHub's list, a rename as its new path), or a commit's paths against its
 *  first parent (git diff-tree --raw --no-renames, with a deleted and an added path of the same blob read as one rename). */
export interface FixFiles { status: "ok" | "not_merged" | "unreadable"; commit: string | null; parent: string | null; files: string[]; why?: string }

/** Pull request files through GraphQL: 25 pull requests per query, files paged 100 at a time. */
export async function pullFiles(prs: { repo: string; number: number }[], gql: Gql, log: (s: string) => void = () => {}): Promise<Record<string, FixFiles>> {
  const out: Record<string, FixFiles> = {};
  const key = (r: string, n: number) => r.toLowerCase() + "#" + n;
  const pending: { repo: string; number: number; files: string[]; after: string }[] = [];
  for (let i = 0; i < prs.length; i += 25) {
    const chunk = prs.slice(i, i + 25);
    const parts = chunk.map((x, j) => {
      const [o, n] = x.repo.split("/");
      return "p" + j + ": repository(owner: " + JSON.stringify(o) + ", name: " + JSON.stringify(n) + ") { pullRequest(number: " + x.number + ") { merged mergeCommit { oid parents(first: 2) { nodes { oid } } } files(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { path } } } }";
    });
    const { data } = await gql("query { rateLimit { cost remaining resetAt } " + parts.join(" ") + " }");
    chunk.forEach((x, j) => {
      const pr = data["p" + j]?.pullRequest;
      if (!pr) return void (out[key(x.repo, x.number)] = { status: "unreadable", commit: null, parent: null, files: [], why: "no such pull request" });
      if (!pr.merged) return void (out[key(x.repo, x.number)] = { status: "not_merged", commit: null, parent: null, files: [] });
      const mc = pr.mergeCommit;
      const files = (pr.files?.nodes ?? []).map((f: any) => f.path as string);
      out[key(x.repo, x.number)] = mc ? { status: "ok", commit: mc.oid, parent: mc.parents?.nodes?.[0]?.oid ?? null, files } : { status: "unreadable", commit: null, parent: null, files: [], why: "merged with no merge commit" };
      if (mc && pr.files?.pageInfo?.hasNextPage) pending.push({ ...x, files, after: pr.files.pageInfo.endCursor });
    });
    log("pull requests " + Math.min(i + 25, prs.length) + "/" + prs.length);
  }
  for (const p of pending) {
    let after: string | null = p.after;
    while (after) {
      const [o, n] = p.repo.split("/");
      const { data } = await gql("query { rateLimit { cost remaining resetAt } r: repository(owner: " + JSON.stringify(o) + ", name: " + JSON.stringify(n) + ") { pullRequest(number: " + p.number + ") { files(first: 100, after: " + JSON.stringify(after) + ") { pageInfo { hasNextPage endCursor } nodes { path } } } } }");
      const f = data.r?.pullRequest?.files;
      p.files.push(...(f?.nodes ?? []).map((x: any) => x.path as string));
      after = f?.pageInfo?.hasNextPage ? f.pageInfo.endCursor : null;
    }
    out[key(p.repo, p.number)]!.files = p.files;
  }
  return out;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GIT_TERMINAL_PROMPT: "0" } });
    let stdout = "", stderr = "";
    const t = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => {
      clearTimeout(t);
      resolve({ status: status ?? 1, stdout, stderr });
    });
  });
}

/** diff-tree --raw lines to changed paths, an exact rename (a deleted and an added path with one blob id) read as its new
 *  path. */
export function rawPaths(raw: string): string[] {
  const rows = raw.split("\n").filter((l) => l.startsWith(":")).map((l) => {
    const [meta, path] = l.split("\t");
    const f = meta!.slice(1).split(" ");
    return { src: f[2]!, dst: f[3]!, status: f[4]!, path: path! };
  });
  const added = new Map(rows.filter((r) => r.status === "A").map((r) => [r.dst, r.path]));
  const renamed = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (r.status === "D" && added.has(r.src) && !/^0+$/.test(r.src) && !renamed.has(r.src)) {
      renamed.add(r.src);
      continue;
    }
    out.push(r.path);
  }
  return out.sort();
}

/** A commit's files by a blobless depth-2 fetch from github.com (no API call). One repository dir per repository under
 *  gitDir, so advisories of one repository share their objects. */
export async function commitFiles(repo: string, ref: string, gitDir: string): Promise<FixFiles> {
  const dir = join(gitDir, repo.toLowerCase().replace("/", "__"));
  if (!existsSync(join(dir, "HEAD"))) {
    mkdirSync(dir, { recursive: true });
    const i = await run("git", ["init", "-q", "--bare", dir], gitDir, 60_000);
    if (i.status !== 0) return { status: "unreadable", commit: null, parent: null, files: [], why: "git init failed" };
  }
  const url = "https://github.com/" + repo + ".git";
  let oid = ref;
  if (ref.length < 40) {
    const ls = await run("git", ["-C", dir, "fetch", "-q", "--depth=1", "--filter=blob:none", url, ref], gitDir, 300_000);
    if (ls.status !== 0) return { status: "unreadable", commit: null, parent: null, files: [], why: "short sha does not fetch: " + ls.stderr.slice(-160).trim() };
    oid = (await run("git", ["-C", dir, "rev-parse", "FETCH_HEAD"], gitDir, 60_000)).stdout.trim();
  }
  const f = await run("git", ["-C", dir, "fetch", "-q", "--depth=2", "--filter=blob:none", url, oid], gitDir, 600_000);
  if (f.status !== 0) return { status: "unreadable", commit: null, parent: null, files: [], why: "fetch failed: " + f.stderr.slice(-160).trim() };
  const p = await run("git", ["-C", dir, "rev-parse", oid + "^1"], gitDir, 60_000);
  if (p.status !== 0) return { status: "unreadable", commit: oid, parent: null, files: [], why: "no first parent" };
  const parent = p.stdout.trim();
  const d = await run("git", ["-C", dir, "diff-tree", "-r", "--raw", "--no-renames", "--no-abbrev", parent, oid], gitDir, 120_000);
  if (d.status !== 0) return { status: "unreadable", commit: oid, parent, files: [], why: "diff-tree failed" };
  return { status: "ok", commit: oid, parent, files: rawPaths(d.stdout) };
}

export interface B2Row {
  ghsa: string; advisory_path: string; repo: string; published: string; month: string; window: "primary" | "widened";
  ecosystem: string; licence: string; fix: { kind: "commit" | "pull"; ref: string; commit: string; parent: string }; fix_refs: number;
  files: { test: number; source: number; total: number };
}

/** The file-count screen over fetched file lists: at least 1 test file and 1 to 6 non-test source files under the
 *  advisory's ecosystems' languages. */
export function screenFiles(cands: LicencedCandidate[], files: (c: LicencedCandidate) => FixFiles | undefined, d: Drops): B2Row[] {
  const out: B2Row[] = [];
  for (const c of cands) {
    const f = files(c);
    if (!f || f.status === "unreadable" || !f.commit || !f.parent) { drop(d, "fix_unreadable", c.window); continue; }
    if (f.status === "not_merged") { drop(d, "fix_pr_not_merged", c.window); continue; }
    const n = fileCounts(c.ecosystems.map((e) => ECOSYSTEM_LANG[e]!), f.files);
    if (n.test < 1) { drop(d, "no_test_file", c.window); continue; }
    if (n.source < 1) { drop(d, "source_files_0", c.window); continue; }
    if (n.source > 6) { drop(d, "source_files_over_6", c.window); continue; }
    out.push({ ghsa: c.ghsa, advisory_path: c.path, repo: c.canonical, published: c.published, month: c.published.slice(0, 7), window: c.window, ecosystem: c.ecosystems.join("+"), licence: c.licence, fix: { kind: c.fix.kind, ref: c.fix.ref, commit: f.commit, parent: f.parent }, fix_refs: c.fix_refs, files: n });
  }
  return out.sort((a, b) => (a.ghsa < b.ghsa ? -1 : 1));
}

export const B2_SCHEMA = "h2h-b2-frame.v1";

/** The whole B2 run: reads the database clone, the licences (or a frozen licence file), the file lists (cached in work so
 *  a stopped run resumes), and returns the frame and the licence file's body. */
export async function mineB2(o: { db: string; work: string; gql: Gql; licences?: LicenceMap; log?: (s: string) => void; prereg?: H2hPrereg; concurrency?: number }) {
  const log = o.log ?? (() => {});
  const p = o.prereg ?? readPrereg();
  const w = windows(p);
  const d = newDrops();
  const advs = readAdvisoryDb(o.db);
  log("advisories read: " + advs.length);
  const cands = screenAdvisories(advs, p, w, d);
  log("after the keyless screens: " + cands.length);
  const lic = o.licences ?? (await readLicences(cands.map((c) => c.repo), o.gql, log));
  const licensed = screenLicences(cands, lic, p, d);
  log("after the licence screen: " + licensed.length);
  mkdirSync(o.work, { recursive: true });
  const cachePath = join(o.work, "b2-files-cache.json");
  const cache: Record<string, FixFiles> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const keyOf = (c: LicencedCandidate) => c.repo.toLowerCase() + (c.fix.kind === "pull" ? "#" : "@") + c.fix.ref;
  const prs = [...new Map(licensed.filter((c) => c.fix.kind === "pull" && !cache[keyOf(c)]).map((c) => [keyOf(c), { repo: c.repo, number: Number(c.fix.ref) }])).values()];
  for (let i = 0; i < prs.length; i += 250) {
    Object.assign(cache, await pullFiles(prs.slice(i, i + 250), o.gql, log));
    writeJson(cachePath, cache);
  }
  const commits = [...new Map(licensed.filter((c) => c.fix.kind === "commit" && !cache[keyOf(c)]).map((c) => [keyOf(c), c])).values()];
  const byRepo = new Map<string, LicencedCandidate[]>();
  for (const c of commits) byRepo.set(c.repo.toLowerCase(), [...(byRepo.get(c.repo.toLowerCase()) ?? []), c]);
  const gitDir = join(o.work, "git");
  mkdirSync(gitDir, { recursive: true });
  let done = 0;
  await pool([...byRepo.values()], o.concurrency ?? 8, async (list) => {
    for (const c of list) {
      cache[keyOf(c)] = await commitFiles(c.repo, c.fix.ref, gitDir);
      if (++done % 50 === 0) {
        writeJson(cachePath, cache);
        log("commits " + done + "/" + commits.length);
      }
    }
  });
  writeJson(cachePath, cache);
  const rows = screenFiles(licensed, (c) => cache[keyOf(c)], d);
  const count = (win: string) => rows.filter((r) => r.window === win).length;
  const cap3 = (win: string[]) => {
    const per: Record<string, number> = {};
    for (const r of rows.filter((r) => win.includes(r.window))) bump(per, r.repo.toLowerCase());
    return Object.values(per).reduce((s, v) => s + Math.min(3, v), 0);
  };
  const byEco: Record<string, number> = {};
  for (const r of rows.filter((r) => r.window === "primary")) bump(byEco, r.ecosystem);
  const frame = {
    schema: B2_SCHEMA, freeze_date: FREEZE_DATE, source: { ...ADVISORY_DB, dirs: ADVISORY_DIRS },
    window: { primary: [w.from, w.to], widened: [w.widen_to, w.to] },
    rules: {
      fix_ref: "the advisory's first GitHub pull request reference, else its first commit reference, in the advisory's order (" + FIX_REF.source + ")",
      ecosystems: Object.fromEntries(Object.entries(ECOSYSTEM_LANG)),
      files: "at least 1 test file and 1 to 6 non-test source files, classified by lanes/outcome-skills/statemachines/langs.ts classify under each ecosystem's language",
      commit_files: "git diff-tree -r --raw --no-renames against the first parent; an exact rename counts once",
      pull_files: "GitHub's pull request file list; fix commit is the merge commit and parent its first parent",
    },
    counts: { advisories_read: advs.length, eligible_primary: count("primary"), eligible_widened: count("widened"), cap3_primary: cap3(["primary"]), cap3_with_widened: cap3(["primary", "widened"]), eligible_primary_by_ecosystem: sorted(byEco) },
    drops: { by_rule: Object.fromEntries(Object.entries(d.by_rule).sort().map(([k, v]) => [k, sorted(v)])), excluded_by_pattern: Object.fromEntries(p.exclusion.map((x) => [x, sorted(d.excluded[x] ?? {})])) },
    advisories: rows,
  };
  const licences = { schema: "h2h-b2-licences.v1", freeze_date: FREEZE_DATE, read: "GitHub GraphQL repository { nameWithOwner isArchived licenseInfo { spdxId } }, once, keyed by the fix reference's owner/repo in lower case", permissive: p.licences, repos: Object.fromEntries(Object.entries(lic).sort(([a], [b]) => (a < b ? -1 : 1))) };
  return { frame, licences };
}

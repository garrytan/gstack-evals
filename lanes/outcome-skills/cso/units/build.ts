// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3's unit build: the six gates in their frozen order (fix_commit_date, fetch, same_fix, cwe, answer_key,
// containment), one reason code per drop, after the drops that apply to every cell before the draw (deviation (c)'s named
// units and the union of every arm's install scans, deviations (a) and (c)). A usable unit gets the one-commit session
// tree (the parent's tree, CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude stripped at any depth, no nested .git), its
// answer key (fix files and pre-fix hunks, insert-only hunks with their anchor lines), its size count, library or
// service, and its known open advisories, and is written as a UnitRecord at its usable position.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ECOSYSTEM_LANG, fileClass } from "../../h2h/breadth/frame.ts";
import { homeEntries, treeSha256 } from "../../h2h/arms/hash.ts";
import { classify, type Lang } from "../../statemachines/langs.ts";
import type { ReasonCode } from "../../../../src/errors/codes.ts";
import { CsoError, csoFail, type CsoPrereg } from "../prereg.ts";
import type { KnownOpenAdvisory, PreFixHunk, UnitRecord } from "../types.ts";
import { cveIds, cweFamilies, cweIds, type AdvisoryJson, type Candidate, type RepoAdvisories } from "./advisory.ts";
import { NAMED_DROPS } from "./deps.ts";
import { scanIds } from "./ids.ts";

export type CsoGate = "fix_commit_date" | "fetch" | "same_fix" | "cwe" | "answer_key" | "containment";
export const GATE_CODES: Record<CsoGate | "install_id" | "install_dep", ReasonCode> = {
  install_id: "E_CSO_DROP_INSTALL_ID",
  install_dep: "E_CSO_DROP_INSTALL_DEP",
  fix_commit_date: "E_CSO_DROP_FIX_DATE",
  fetch: "E_CSO_DROP_FETCH",
  same_fix: "E_CSO_DROP_SAME_FIX",
  cwe: "E_CSO_DROP_CWE",
  answer_key: "E_CSO_DROP_ANSWER_KEY",
  containment: "E_CSO_DROP_CONTAINMENT",
};

/** The fixed identity and date of every session tree's one commit, so a tree's commit id depends only on its files. */
export const TREE_IDENT = { name: "cso-unit", email: "cso-unit@example.invalid", date: "2026-01-01T00:00:00Z", message: "audit tree" } as const;
/** Names stripped from the session tree at any depth: memory files, Claude settings and nested git dirs. */
export const STRIP_NAMES: ReadonlySet<string> = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", ".claude", ".git"]);
/** Root files that make a repository a service (section 3); anything else is a library. */
export const SERVICE_FILE = /^(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i;

export type Git = { status: number; stdout: string; stderr: string };
export function git(args: string[], o: { cwd?: string; env?: Record<string, string> } = {}): Git {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd: o.cwd, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GIT_TERMINAL_PROMPT: "0", ...(o.env ?? {}) } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
const bare = (dir: string, args: string[], env?: Record<string, string>) => git(["--git-dir", dir, ...args], { env });

export const githubRemote = (repo: string): string => "https://github.com/" + repo + ".git";

/** Gate 2: a blobless clone with the fix's full history under work/git. Returns the dir, or why the gate drops. */
export function fetchUnit(work: string, repo: string, fix: string, parent: string, remote: (repo: string) => string = githubRemote): { dir: string } | { why: string } {
  const dir = join(work, "git", repo.replace("/", "__") + ".git");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    bare(dir, ["init", "-q", "--bare"]);
    bare(dir, ["remote", "add", "origin", remote(repo)]);
  }
  const have = (sha: string) => bare(dir, ["cat-file", "-e", sha + "^{commit}"]).status === 0;
  let last = "";
  for (let i = 0; i < 2 && !have(fix); i++) last = bare(dir, ["fetch", "-q", "--filter=blob:none", "origin", fix]).stderr.trim();
  if (!have(fix)) return { why: "the fix commit " + fix + " did not fetch" + (last ? ": " + last.slice(-200) : "") };
  if (!have(parent)) return { why: "the parent " + parent + " is missing" };
  const first = bare(dir, ["rev-parse", "--verify", "-q", fix + "^1"]).stdout.trim();
  if (first !== parent) return { why: "the fix's first parent is " + (first || "none") + ", not the frame's " + parent };
  return { dir };
}

/** Section 3's session tree from the blobless clone, with gate 2's named repair: a checkout whose lazy blob fetch fails
 *  re-clones that one repository in full once and checks out again; a second failure is the fetch gate's drop
 *  (E_CSO_DROP_FETCH_LAZY). Any other failure still refuses. */
export function checkoutTree(work: string, repo: string, fix: string, parent: string, out: string, remote: (repo: string) => string = githubRemote): { tree: ReturnType<typeof sessionTree>; refetched: boolean } | { why: string } {
  const dir = join(work, "git", repo.replace("/", "__") + ".git");
  const checkout = (): ReturnType<typeof sessionTree> | string => {
    try {
      return sessionTree(dir, parent, out);
    } catch (e) {
      if (e instanceof CsoError && e.message.includes("checking out " + parent)) return e.message;
      throw e;
    }
  };
  const first = checkout();
  if (typeof first !== "string") return { tree: first, refetched: false };
  rmSync(out, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  bare(dir, ["init", "-q", "--bare"]);
  bare(dir, ["remote", "add", "origin", remote(repo)]);
  const f = bare(dir, ["fetch", "-q", "origin", fix]);
  const again = f.status === 0 ? checkout() : "the full fetch of " + fix + " failed: " + f.stderr.trim().slice(-200);
  if (typeof again !== "string") return { tree: again, refetched: true };
  rmSync(out, { recursive: true, force: true });
  return { why: "the checkout of " + parent + " failed in the blobless clone (" + first.slice(-160) + ") and again after a full re-clone (" + again.slice(-160) + ")" };
}

/** Gate 1's reading: the fix commit's committer date, UTC, as YYYY-MM-DD. */
export function fixDate(dir: string, fix: string): string {
  const s = bare(dir, ["show", "-s", "--format=%ct", fix]).stdout.trim();
  return new Date(Number(s) * 1000).toISOString().slice(0, 10);
}

const langOf = (langs: readonly Lang[], path: string): Lang => langs.find((l) => classify(l, path) === "source") ?? langs[0]!;

/** A line that is only a comment: # for Python, otherwise //, /*, * or the end of a block comment. */
export function isCommentLine(lang: Lang, line: string): boolean {
  const t = line.trim();
  if (lang === "python") return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/") && !/[;{}()=]/.test(t);
}

/** The +/- lines of a -U0 diff body, after its first hunk header. */
function changedLines(diff: string): string[] {
  const out: string[] = [];
  let body = false;
  for (const l of diff.split("\n")) {
    if (l.startsWith("@@")) body = true;
    else if (body && (l.startsWith("+") || l.startsWith("-"))) out.push(l.slice(1));
  }
  return out;
}

/** Whether a file's change holds a line of code: git's whitespace-blind, blank-line-blind diff, less comment lines. */
export function codeChanged(dir: string, parent: string, fix: string, path: string, lang: Lang): boolean {
  const d = bare(dir, ["diff", "-U0", "-w", "--ignore-blank-lines", "--no-renames", "--no-color", "--no-ext-diff", parent, fix, "--", ":(literal)" + path]).stdout;
  return changedLines(d).some((l) => l.trim() !== "" && !isCommentLine(lang, l));
}

const lines = (text: string): string[] => {
  const l = text.split("\n");
  if (l.length && l[l.length - 1] === "") l.pop();
  return l;
};

/** A file's pre-fix hunks from git's -U0 diff. A hunk that removes or changes lines covers those parent lines. An
 *  insert-only hunk covers the two parent lines around the insertion point (the one line there at a file edge) and keeps
 *  its inserted lines as added. */
export function preFixHunks(dir: string, parent: string, fix: string, path: string): PreFixHunk[] {
  const at = lines(bare(dir, ["show", parent + ":" + path]).stdout);
  const d = bare(dir, ["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", parent, fix, "--", ":(literal)" + path]).stdout.split("\n");
  const out: PreFixHunk[] = [];
  for (let i = 0; i < d.length; i++) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(d[i]!);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] === undefined ? 1 : Number(m[2]);
    const added: string[] = [];
    for (let j = i + 1; j < d.length && !d[j]!.startsWith("@@"); j++) if (d[j]!.startsWith("+")) added.push(d[j]!.slice(1));
    if (b > 0) {
      out.push({ file: path, start: a, end: a + b - 1, insert_only: false, text: at.slice(a - 1, a + b - 1).join("\n") });
      continue;
    }
    const start = Math.max(1, Math.min(a, at.length)), end = Math.min(at.length, a + 1);
    out.push({ file: path, start, end: Math.max(start, end), insert_only: true, added, text: at.slice(start - 1, Math.max(start, end)).join("\n") });
  }
  return out;
}

export interface AnswerKey { fix_files: string[]; hunks: PreFixHunk[]; code_files: string[] }

/** Gate 5's reading: the fix's non-test source files that exist at the parent, their pre-fix hunks, and the ones whose
 *  change holds a line of code. */
export function answerKey(dir: string, parent: string, fix: string, langs: readonly Lang[]): AnswerKey {
  const all = bare(dir, ["diff", "--name-only", "-z", "--no-renames", parent, fix]).stdout.split("\0").filter(Boolean);
  const fixFiles = all.filter((p) => fileClass(langs, p) === "source" && bare(dir, ["cat-file", "-e", parent + ":" + p]).status === 0).sort();
  return { fix_files: fixFiles, hunks: fixFiles.flatMap((p) => preFixHunks(dir, parent, fix, p)), code_files: fixFiles.filter((p) => codeChanged(dir, parent, fix, p, langOf(langs, p))) };
}

/** Section 3's session tree: the parent's tree checked out into out, stripped, and committed as one fresh commit. */
export function sessionTree(dir: string, parent: string, out: string): { stripped: string[]; head: string; tree_sha256: string } {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "cso-index-"));
  try {
    const r = git(["--git-dir", dir, "--work-tree", out, "read-tree", "--reset", "-u", parent], { env: { GIT_INDEX_FILE: join(tmp, "index") } });
    if (r.status !== 0) csoFail("E_CSO_SCAN", "checking out " + parent + " into " + out + " failed: " + r.stderr.slice(-300));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const stripped: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name), r = rel ? rel + "/" + name : name;
      if (STRIP_NAMES.has(name)) {
        stripped.push(r);
        rmSync(p, { recursive: true, force: true });
      } else if (lstatSync(p).isDirectory()) walk(p, r);
    }
  };
  walk(out, "");
  const env = { GIT_AUTHOR_DATE: TREE_IDENT.date, GIT_COMMITTER_DATE: TREE_IDENT.date };
  const ident = ["-c", "user.name=" + TREE_IDENT.name, "-c", "user.email=" + TREE_IDENT.email, "-c", "commit.gpgsign=false"];
  const step = (args: string[]) => {
    const r = git(["-C", out, ...ident, ...args], { env });
    if (r.status !== 0) csoFail("E_CSO_SCAN", "git " + args[0] + " in " + out + " failed: " + r.stderr.slice(-300));
    return r.stdout.trim();
  };
  step(["init", "-q"]);
  step(["add", "-A", "-f"]);
  const head = step(["commit-tree", step(["write-tree"]), "-m", TREE_IDENT.message]);
  step(["update-ref", "HEAD", head]);
  return { stripped: stripped.sort(), head, tree_sha256: treeSha256(homeEntries(out, true).filter((e) => e.path !== ".git" && !e.path.startsWith(".git/"))) };
}

/** The repository's other reviewed advisories whose fix commit is not an ancestor of the audited commit, with their fix's
 *  non-test source files. An advisory with no fix commit, or one the clone can't reach, counts as open with no files. */
export function knownOpen(dir: string, parent: string, ghsa: string, langs: readonly Lang[], list: ReturnType<RepoAdvisories>): KnownOpenAdvisory[] {
  const out: KnownOpenAdvisory[] = [];
  for (const a of list) {
    if (a.ghsa.toUpperCase() === ghsa.toUpperCase()) continue;
    const fc = a.fix_commit;
    if (fc && bare(dir, ["cat-file", "-e", fc + "^{commit}"]).status !== 0) bare(dir, ["fetch", "-q", "--filter=blob:none", "origin", fc]);
    const reach = fc ? bare(dir, ["merge-base", "--is-ancestor", fc, parent]).status : 2;
    if (reach === 0) continue;
    const files = reach === 1 && fc ? bare(dir, ["diff", "--name-only", "-z", "--no-renames", fc + "^1", fc]).stdout.split("\0").filter((p) => p && fileClass(langs, p) === "source").sort() : [];
    out.push({ ghsa: a.ghsa, summary: a.summary, files });
  }
  return out.sort((x, y) => (x.ghsa < y.ghsa ? -1 : 1));
}

export interface UnitInput { c: Candidate; advisory: AdvisoryJson }
export type GateRow = { unit: string; part: "part1" | "part2"; index: number } & ({ usable: true; position: number } | { usable: false; gate: CsoGate | "install_id" | "install_dep"; code: ReasonCode; reason: string });
export interface BuildResult { schema: "cso-unit-build.v1"; need: number; filled: number; units: UnitRecord[]; gates: GateRow[]; stripped: Record<string, string[]> }
export interface BuildOptions {
  p: CsoPrereg;
  work: string;
  need: number;
  remote?: (repo: string) => string;
  installDrops?: { id: readonly string[]; dep: readonly string[] };
  repoAdvisories?: RepoAdvisories;
  namedDrops?: ReadonlyArray<{ unit: string; line: string }>;
}

/** Runs the candidates through the drops and gates in order until need usable units are filled or the list ends. Trees go
 *  to work/trees/<unit>, records to work/units/<unit>.json, and the gate table to work/unit-build.json. */
export function buildUnits(inputs: readonly UnitInput[], o: BuildOptions): BuildResult {
  const { p, work } = o;
  const since = String(p.units.post_cutoff_from);
  const named = new Map((o.namedDrops ?? NAMED_DROPS).map((d) => [d.unit, d.line]));
  const idDrop = new Set(o.installDrops?.id ?? []), depDrop = new Set(o.installDrops?.dep ?? []);
  const res: BuildResult = { schema: "cso-unit-build.v1", need: o.need, filled: 0, units: [], gates: [], stripped: {} };
  const fixes = new Set<string>(), trees = new Set<string>();
  for (const { c, advisory } of inputs) {
    if (res.filled >= o.need) break;
    const base = { unit: c.unit, part: c.part, index: c.index };
    const drop = (gate: CsoGate | "install_id" | "install_dep", reason: string, code: ReasonCode = GATE_CODES[gate]) => void res.gates.push({ ...base, usable: false, gate, code, reason: code + " " + reason });
    if (idDrop.has(c.unit)) { drop("install_id", "an arm's installed gstack tree names this unit's id (deviation (a))"); continue; }
    if (named.has(c.unit)) { drop("install_dep", "named drop: " + named.get(c.unit)); continue; }
    if (depDrop.has(c.unit)) { drop("install_dep", "an arm's installed gstack tree holds the affected package at or past its fix (deviation (c))"); continue; }
    const { fix } = c.row;
    const got = fetchUnit(work, c.row.repo, fix.commit, fix.parent, o.remote);
    if ("why" in got) { drop("fetch", got.why); continue; }
    const dir = got.dir;
    const date = fixDate(dir, fix.commit);
    if (date < since) { drop("fix_commit_date", "the fix was committed on " + date + ", before " + since); continue; }
    const parentTree = bare(dir, ["rev-parse", fix.parent + "^{tree}"]).stdout.trim();
    if (fixes.has(fix.commit) || trees.has(parentTree)) { drop("same_fix", "an earlier usable unit has fix " + fix.commit + " or parent tree " + parentTree); continue; }
    const cwes = cweIds(advisory);
    if (!cwes.length) { drop("cwe", "the advisory lists no CWE id"); continue; }
    const langs = c.row.ecosystem.split("+").map((e) => ECOSYSTEM_LANG[e]).filter((l): l is Lang => !!l);
    const key = answerKey(dir, fix.parent, fix.commit, langs);
    if (!key.code_files.length) { drop("answer_key", key.fix_files.length ? "the fix's source changes at the parent are only whitespace, blank lines or comments" : "no non-test source file of the fix exists at the parent"); continue; }
    const out = join(work, "trees", c.unit);
    const co = checkoutTree(work, c.row.repo, fix.commit, fix.parent, out, o.remote);
    if ("why" in co) { drop("fetch", co.why, "E_CSO_DROP_FETCH_LAZY"); continue; }
    const t = co.tree;
    const scan = scanIds(out, [{ unit: c.unit, ghsa: c.row.ghsa, cves: cveIds(advisory), fix_commit: fix.commit }]);
    if (scan.hits.length) { drop("containment", "the session tree holds " + scan.hits.map((h) => h.needle + " at " + h.where + " " + h.path).slice(0, 5).join(", ")); rmSync(out, { recursive: true, force: true }); continue; }
    fixes.add(fix.commit);
    trees.add(parentTree);
    res.filled++;
    res.stripped[c.unit] = t.stripped;
    const files = bare(dir, ["ls-tree", "-r", "--name-only", "-z", fix.parent]).stdout.split("\0").filter(Boolean);
    const root = bare(dir, ["ls-tree", "--name-only", "-z", fix.parent]).stdout.split("\0").filter(Boolean);
    const rec: UnitRecord = {
      schema: "cso-unit.v1",
      unit: c.unit,
      position: res.filled,
      part: c.part,
      index: c.index,
      repo: c.row.repo,
      ghsa: c.row.ghsa,
      cves: cveIds(advisory),
      fix_commit: fix.commit,
      parent: fix.parent,
      ecosystem: c.row.ecosystem,
      published: c.row.published,
      month: c.row.month,
      cwe_ids: cwes,
      cwe_families: cweFamilies(p, cwes),
      fix_files: key.fix_files,
      hunks: key.hunks,
      advisory: { summary: advisory.summary ?? "", details: advisory.details ?? "" },
      source_files: files.filter((f) => fileClass(langs, f) === "source").length,
      kind: root.some((f) => SERVICE_FILE.test(f)) ? "service" : "library",
      known_open: o.repoAdvisories ? knownOpen(dir, fix.parent, c.row.ghsa, langs, o.repoAdvisories(c.row.repo)) : [],
      tree_sha256: t.tree_sha256,
    };
    mkdirSync(join(work, "units"), { recursive: true });
    writeFileSync(join(work, "units", c.unit + ".json"), JSON.stringify(rec, null, 1) + "\n");
    res.units.push(rec);
    res.gates.push({ ...base, usable: true, position: rec.position });
  }
  writeFileSync(join(work, "unit-build.json"), JSON.stringify({ ...res, units: res.units.map((u) => u.unit) }, null, 1) + "\n");
  return res;
}

/** Section 12's supply check: E_CSO_SUPPLY with the count when the list ran out before every position was filled. */
export function assertSupply(r: Pick<BuildResult, "need" | "filled">): void {
  if (r.filled < r.need) csoFail("E_CSO_SUPPLY", "the candidate list ran out at " + r.filled + " usable units; the plan needs " + r.need);
}

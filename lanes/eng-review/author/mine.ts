// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals er mine (prereg 2026-11-08-geva-405, sections 3 and 4): one clone's candidate units, keyless and
// read-only. It reads a clone and the public metadata file and never runs the repository's code; git runs through
// lanes/real-outcome/mine/git.ts (hooks off, no global or system config, so no filter, textconv or LFS driver exists).
//   er mine --repo-dir <clone> --repo <owner/name> --licence <spdx> --meta <meta.json> --out <candidates.json>
//           [--branch <ref>] [--mined-at <date>] [--plan]
// The rules, from sections 3 and 4:
// - A change is one first-parent commit on the default branch (changes.ts's listChanges). A unit is merged 2026-07-01
//   to 2026-09-30, with its earliest exposure (closing issues, pull request, commits' author and committer dates) on
//   or after 2026-07-01 and complete. Wave 1 is merged by 2026-09-15; the window closes 60 days after the merge.
// - A unit is a feature or behavior change, not a fix, revert, docs, chore, dependency, release or CI-only change; it
//   touches at least 2 non-test source files or adds at least 40 non-test source lines; its base tree is at most 150 MB
//   (git ls-tree sizes, so .git never counts) and holds no project .claude/ or .mcp.json; LICENSE at base agrees with
//   the licence GitHub reports.
// - Plan text (--plan): the pull request's description and its closing issues, each in its earliest recoverable
//   version (pv's firstVersion), issues opened before the merge only, hold at least 120 words.
// - Aftermath within 60 days, never past the mining date: B by SZZ (a fix-like change's edited non-blank, non-comment
//   source lines blamed with git blame -w -M at its parent, szz.ts) when any blamed line belongs to the unit, with the
//   files and functions those lines sit in (the nearest declaration above each line, else git's hunk header); R, a revert of the unit whole or in part, defect or product; T, a later
//   change that adds or edits tests for the unit's code and is not a B candidate of it; C, a later change to a CI job,
//   test lane or eval for the unit's code.
// Build-time choices where the prereg is silent (lanes/eng-review/README.md, authoring side):
// - Source and test paths widen real-outcome's paths.ts to every common language (Kotlin, Java, Swift, Dart, C#, C and
//   C++, Ruby, PHP and more) and their test layouts; paths.ts's classes stand for everything else.
// - The kind reads the pull request title (else the subject) and labels: a conventional prefix decides first (feat is
//   a feature; fix, docs, chore, refactor, style, test, perf, build, ci, deps, release and revert are not), then defect,
//   dependency, release, docs and chore words and labels, then the files (no non-test source: CI-only, docs or
//   dependency). Refactors and performance changes are chores: they change no behavior. The body is not read, because
//   a feature's "Fixes #12" closing line would read as a fix.
// - A merge time is the pull request's mergedAt when the change has one, else the first-parent commit's committer date.
// - A clone may be shallow back to a date before the window: lines older than its boundary blame to a commit no
//   in-window change owns, which is what a full clone gives for them too.
// - Words count the earliest description and issue bodies after HTML comments (template boilerplate) are dropped.
// - T: the later change adds or edits a test file the unit touched, a test file whose name holds a unit source file's
//   stem, or edits a unit source file beside its test edits. C: it touches a CI, test-lane or eval file whose diff
//   names one of the unit's files, stems or top directories, or it also touches the unit's files.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { listChanges, type Change, type FileChange } from "../../real-outcome/mine/changes.ts";
import { windowVerdict } from "../../real-outcome/mine/exposure.ts";
import { git, gitLines, gitRun, showFile } from "../../real-outcome/mine/git.ts";
import { parseMeta, type RepoMeta } from "../../real-outcome/mine/meta.ts";
import { classifyPath, type PathClass } from "../../real-outcome/mine/paths.ts";
import { blame, editedOldLines, isFixLike, ownerMap, readRevert, type Revert } from "../../real-outcome/mine/szz.ts";
import { graphql } from "../../product-value/author/gh.ts";
import { firstVersion } from "../../product-value/author/run.ts";
import { need, parseArgs, PvError, refuseInRepo, writeJson } from "../../product-value/io.ts";
import type { Io } from "../cli.ts";
import type { BugSite } from "../types.ts";

export const SEED = "20261108";
export const WINDOW = { from: "2026-07-01", to: "2026-09-30", wave1By: "2026-09-15", strict: "2026-10-01", days: 60 } as const;
export const MIN_SOURCE_FILES = 2, MIN_SOURCE_ADDED = 40, MIN_PLAN_WORDS = 120, MAX_BASE_BYTES = 150 * 1024 * 1024;
export const PERMISSIVE = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0"];
export const COPYLEFT = ["GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0"];
export const LICENCES = [...PERMISSIVE, ...COPYLEFT];

export const order = (id: string) => createHash("sha256").update(SEED + "\n" + id).digest("hex");
export const words = (s: string) => (s.match(/\S+/g) ?? []).length;
export const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
export const endOf = (day: string) => (day.length === 10 ? day + "T23:59:59.999Z" : day);

const EXT: Record<string, string> = {
  py: "Python", pyi: "Python", ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  go: "Go", rs: "Rust", kt: "Kotlin", java: "Java", scala: "Scala", swift: "Swift", m: "Objective-C", mm: "Objective-C", dart: "Dart", cs: "C#", fs: "F#", c: "C", h: "C",
  cc: "C++", cpp: "C++", cxx: "C++", hpp: "C++", hh: "C++", rb: "Ruby", php: "PHP", ex: "Elixir", exs: "Elixir", erl: "Erlang", clj: "Clojure", cljs: "Clojure", lua: "Lua",
  vue: "Vue", svelte: "Svelte", zig: "Zig", nim: "Nim", ml: "OCaml", hs: "Haskell", jl: "Julia", r: "R", pl: "Perl", sh: "Shell", gd: "GDScript", groovy: "Groovy",
};
const TESTS = [/(^|\/)(tests?|__tests__|testdata|spec|specs|androidTest|unitTest|testFixtures|e2e|cypress|playwright)\//, /(^|\/)[^/]*Tests?\/[^/]*\.swift$/, /(^|\/)src\/test\//, /[^/](Test|Tests|Spec)\.(kt|java|swift|scala|cs|groovy|m)$/, /_(test|spec)\.(py|go|rb|dart|exs|rs|c|cc|cpp|lua)$/, /(^|\/)test_[^/]*\.(py|rb)$/, /\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)conftest\.py$/];
const LOCKS = new Set(["Podfile.lock", "Gemfile.lock", "composer.lock", "pubspec.lock", "Package.resolved", "mix.lock", "gradle.lockfile", "packages.lock.json"]);
const MANIFESTS = new Set(["Gemfile", "composer.json", "pubspec.yaml", "Package.swift", "pom.xml", "Podfile", "mix.exs", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "libs.versions.toml"]);
const LANES = [/^\.github\/workflows\//, /^\.gitlab-ci\.yml$/, /^\.circleci\//, /^\.travis\.yml$/, /^azure-pipelines[^/]*\.ya?ml$/, /(^|\/)Jenkinsfile$/, /^\.buildkite\//, /^bitbucket-pipelines\.yml$/, /^\.drone\.yml$/, /^\.woodpecker/, /^codemagic\.yaml$/, /(^|\/)fastlane\//, /(^|\/)(jest|vitest|playwright|karma|cypress)\.config\.[cm]?[jt]s$/, /(^|\/)(tox\.ini|noxfile\.py|pytest\.ini)$/, /(^|\/)evals?\//];

export const languageOf = (path: string): string | null => {
  const dot = path.lastIndexOf(".");
  return dot < 0 || dot < path.lastIndexOf("/") ? null : EXT[path.slice(dot + 1)] ?? null;
};
export const isTestPath = (path: string) => TESTS.some((re) => re.test(path));
export const isLanePath = (path: string) => LANES.some((re) => re.test(path));

/** paths.ts's classes, widened to every common language and its test layout. */
export function erClass(path: string): PathClass {
  const base = classifyPath(path);
  if (base === "vendored" || base === "lockfile" || base === "manifest" || base === "release") return base;
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (LOCKS.has(name)) return "lockfile";
  if (MANIFESTS.has(name)) return "manifest";
  if (base === "test" || isTestPath(path)) return "test";
  return languageOf(path) !== null && !isLanePath(path) ? "source" : "other";
}

export type Kind = "feature" | "fix" | "revert" | "docs" | "chore" | "dependency" | "release" | "ci";
const PREFIX: Record<string, Kind> = { feat: "feature", feature: "feature", fix: "fix", bugfix: "fix", hotfix: "fix", docs: "docs", doc: "docs", chore: "chore", refactor: "chore", style: "chore", test: "chore", tests: "chore", perf: "chore", build: "chore", ci: "ci", deps: "dependency", "deps-dev": "dependency", release: "release", revert: "revert" };
const DEFECT = /\b(fix(e[sd])?|bug(s|fix)?|hotfix|regression|crash(es|ed)?|broken|incorrect|wrong|repair)\b/i;
const DEP = /\b(bump(s|ed)?|deps?|dependenc(y|ies)|upgrade[sd]?\s+\S+\s+(to|from))\b/i;
const RELEASE = /^(release|prepare release|version|v?\d+\.\d+(\.\d+)?\b)|\brelease v?\d|\bbump version\b/i;
const DOCS = /\b(docs?|documentation|readme|typos?|changelog)\b/i;
const CHORE = /\b(refactor\w*|clean ?up|chore|lint\w*|format\w*|renam\w+|perf(ormance)?|optimi[sz]\w*|translations?|i18n|l10n)\b/i;
const LABEL: Array<[RegExp, Kind]> = [[/^(bug|defect|regression|type: ?bug|kind\/bug)$/i, "fix"], [/^(dependencies|deps)$/i, "dependency"], [/^(documentation|docs)$/i, "docs"], [/^(chore|refactor)$/i, "chore"], [/^release$/i, "release"], [/^ci$/i, "ci"]];

/** Section 4's change kind from the title, labels and files; only a feature can be a unit. */
export function kindOf(c: Change, reverts: boolean): Kind {
  if (reverts) return "revert";
  const title = (c.pr?.title ?? c.subject).trim();
  const pre = /^(\w[\w-]*)(\([^)]*\))?!?:/.exec(title);
  if (pre && PREFIX[pre[1]!.toLowerCase()]) return PREFIX[pre[1]!.toLowerCase()]!;
  for (const l of c.pr?.labels ?? []) for (const [re, k] of LABEL) if (re.test(l)) return k;
  if (/^revert\b/i.test(title)) return "revert";
  if (DEFECT.test(title)) return "fix";
  if (DEP.test(title)) return "dependency";
  if (RELEASE.test(title)) return "release";
  const classes = c.files.map((f) => erClass(f.path));
  if (!classes.includes("source")) {
    if (c.files.length && c.files.every((f) => isLanePath(f.path))) return "ci";
    return classes.some((k) => k === "lockfile" || k === "manifest") && classes.every((k) => k !== "other" && k !== "test") ? "dependency" : "docs";
  }
  if (DOCS.test(title) && !/\b(add|support|new)\b/i.test(title)) return "docs";
  if (CHORE.test(title)) return "chore";
  return "feature";
}

const LICENCE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "COPYING", "COPYING.md", "LICENSE-MIT", "LICENSE-APACHE"];

/** The licence a LICENSE text states; null for no known text. */
export function licenceText(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2\.1/i.test(t) ? "LGPL-2.1" : /Version 3/i.test(t) ? "LGPL-3.0" : null;
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 3/i.test(t) ? "GPL-3.0" : /Version 2/i.test(t) ? "GPL-2.0" : null;
  if (/Mozilla Public License,? Version 2\.0/i.test(t)) return "MPL-2.0";
  if (/Apache License,? Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name|names of its contributors/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  return null;
}

/** The expected licence when a licence file at rev states it, else the first licence a file states, else null. */
export function licenceAt(repoDir: string, rev: string, expected: string): string | null {
  const found = LICENCE_FILES.map((f) => showFile(repoDir, rev, f)).filter((t): t is string => t !== null).map(licenceText);
  return found.includes(expected) ? expected : found.find((x) => x !== null) ?? null;
}

export const baseBytes = (repoDir: string, rev: string): number =>
  gitLines(repoDir, ["ls-tree", "-r", "-l", rev]).reduce((n, l) => n + (Number(/^\d+ blob [0-9a-f]+\s+(\d+)\t/.exec(l)?.[1]) || 0), 0);

export interface Aftermath {
  kind: "B" | "R" | "T" | "C";
  change: string;
  merged_at: string;
  subject: string;
  pr: number | null;
  files: string[];
  /** B: lines blamed to the unit and the files and functions they sit in. */
  blamed_lines?: number;
  sites?: BugSite[];
  /** R: the revert names a defect (a product revert is listed but never keyed). */
  defect?: boolean;
}

export interface Candidate {
  id: string;
  repo: string;
  licence: string;
  change: string;
  base: string;
  pr: number | null;
  subject: string;
  merged_at: string;
  exposed_at: string;
  wave: 1 | 2;
  window_closes: string;
  /** The mining date fell before the window closed, so the aftermath is partial. */
  window_open: boolean;
  kind: Kind;
  language: string | null;
  source_files: number;
  source_added: number;
  files: string[];
  test_files: string[];
  base_bytes: number | null;
  aftermath: Aftermath[];
  plan_words: number | null;
  reasons: string[];
  eligible: boolean;
}

export interface MineResult {
  schema: "er.mine.v1";
  repo: string;
  head: string;
  mined_at: string;
  window_changes: number;
  scanned: number;
  candidates: Candidate[];
}

const stem = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "").replace(/(Test|Tests|Spec|_test|_spec|\.test|\.spec)$/, "").replace(/^test_/, "").toLowerCase();
export const mergedAt = (c: Change) => new Date(c.pr?.merged_at ?? c.merged_at).toISOString();

const DECL = [
  /\b(?:fun|def|func|fn|function|sub)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
  /^\s*(?:(?:public|private|protected|internal|static|final|virtual|override|async|abstract|synchronized)\s+)+[\w<>[\]?,.\s]*?\b([A-Za-z_]\w*)\s*\(/,
];

/** The function a line (1-based) sits in: the nearest declaration at or above it, by keyword or modifiers; null when none. */
export function functionAt(lines: readonly string[], line: number): string | null {
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    for (const re of DECL) {
      const m = re.exec(lines[i]!);
      if (m) return m[1]!;
    }
  }
  return null;
}

/** The function each old-side (or new-side) line of path sits in, from the -U0 hunk headers. */
export function hunkFunctions(repoDir: string, from: string, to: string, path: string, side: "old" | "new" = "old"): Map<number, string | null> {
  const out = new Map<number, string | null>();
  const diff = gitRun(repoDir, ["diff", "-U0", "--no-ext-diff", "--no-textconv", "--no-renames", from, to, "--", path]).stdout;
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/gm)) {
    const fn = m[5]!.trim() || null;
    const [s, c] = side === "old" ? [m[1], m[2]] : [m[3], m[4]];
    for (let n = Number(s); n < Number(s) + (c === undefined ? 1 : Number(c)); n++) out.set(n, fn);
  }
  return out;
}

const widen = (c: Change): Change => ({ ...c, files: c.files.map((f: FileChange) => ({ ...f, cls: erClass(f.path) })) });
type Blamed = Map<string, { lines: number; sites: Map<string, BugSite> }>;

/** Mines one clone as of minedAt. */
export function mineClone(o: { repoDir: string; repo: string; licence: string; branch: string; meta: RepoMeta | null; minedAt: string }): MineResult {
  const head = git(o.repoDir, ["rev-parse", "--verify", o.branch + "^{commit}"]).trim();
  const changes = listChanges(o.repoDir, head, WINDOW.from, o.meta).map(widen).filter((c) => Date.parse(mergedAt(c)) <= Date.parse(endOf(o.minedAt)));
  const pos = new Map(changes.map((c, i) => [c.id, i]));
  const owner = ownerMap(changes);
  const reverts = new Map<string, Revert>();
  for (const c of changes) {
    const r = readRevert(o.repoDir, c);
    if (r) reverts.set(c.id, r);
  }
  const blamed = new Map<string, Blamed>();
  for (const fix of changes) {
    if (reverts.has(fix.id) || !isFixLike(fix) || !fix.files.some((f) => f.cls === "source")) continue;
    for (const [path, lines] of editedOldLines(o.repoDir, fix)) {
      let fns: Map<number, string | null> | null = null;
      let old: string[] | null = null;
      for (const [line, sha] of blame(o.repoDir, fix.parent, path, lines)) {
        const unit = owner.get(sha);
        if (!unit || unit === fix.id || (pos.get(unit) ?? Infinity) >= pos.get(fix.id)!) continue;
        fns ??= hunkFunctions(o.repoDir, fix.parent, fix.id, path);
        const byFix: Blamed = blamed.get(unit) ?? new Map();
        const b = byFix.get(fix.id) ?? { lines: 0, sites: new Map<string, BugSite>() };
        old ??= (showFile(o.repoDir, fix.parent, path) ?? "").split("\n");
        const fn = functionAt(old, line) ?? fns.get(line) ?? null;
        b.lines++;
        b.sites.set(path + "\n" + fn, { file: path, function: fn });
        byFix.set(fix.id, b);
        blamed.set(unit, byFix);
      }
    }
  }
  const start = Date.parse(WINDOW.from), end = Date.parse(endOf(WINDOW.to));
  const inWindow = changes.filter((c) => Date.parse(mergedAt(c)) >= start && Date.parse(mergedAt(c)) <= end);
  const candidates: Candidate[] = [];
  for (const u of inWindow) {
    const merged = mergedAt(u);
    const kind = kindOf(u, reverts.has(u.id));
    const source = u.files.filter((f) => f.cls === "source");
    const added = source.reduce((n, f) => n + f.added, 0);
    const reasons: string[] = [];
    if (kind !== "feature") reasons.push("kind_" + kind);
    if (source.length < MIN_SOURCE_FILES && added < MIN_SOURCE_ADDED) reasons.push("below_size");
    reasons.push(...windowVerdict(u.exposure, merged, { start: WINDOW.from, strict_start: WINDOW.strict, mined_at: endOf(o.minedAt) }).reasons);
    const closes = addDays(merged, WINDOW.days);
    const langs = new Map<string, number>();
    for (const f of source) langs.set(languageOf(f.path)!, (langs.get(languageOf(f.path)!) ?? 0) + f.added + f.deleted);
    const cand: Candidate = {
      id: o.repo + "@" + u.id.slice(0, 12), repo: o.repo, licence: o.licence, change: u.id, base: u.parent, pr: u.pr?.number ?? null, subject: u.pr?.title ?? u.subject, merged_at: merged, exposed_at: u.exposure.at,
      wave: Date.parse(merged) <= Date.parse(endOf(WINDOW.wave1By)) ? 1 : 2, window_closes: closes, window_open: Date.parse(endOf(o.minedAt)) < Date.parse(closes), kind,
      language: [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, source_files: source.length, source_added: added, files: u.files.map((f) => f.path),
      test_files: u.files.filter((f) => f.cls === "test" && f.status !== "D").map((f) => f.path), base_bytes: null, aftermath: [], plan_words: null, reasons, eligible: false,
    };
    candidates.push(cand);
    if (reasons.length) continue;
    cand.base_bytes = baseBytes(o.repoDir, u.parent);
    if (cand.base_bytes > MAX_BASE_BYTES) reasons.push("base_over_150mb");
    if (git(o.repoDir, ["ls-tree", "--name-only", u.parent, "--", ".claude", ".mcp.json"]).trim()) reasons.push("claude_config");
    if (licenceAt(o.repoDir, u.parent, o.licence) !== o.licence) reasons.push("licence_disagrees");
    cand.aftermath = aftermathOf(o.repoDir, u, changes, pos, owner, reverts, blamed.get(u.id), closes);
    cand.eligible = reasons.length === 0;
  }
  return { schema: "er.mine.v1", repo: o.repo, head, mined_at: o.minedAt, window_changes: inWindow.length, scanned: changes.length, candidates };
}

function aftermathOf(repoDir: string, u: Change, changes: Change[], pos: Map<string, number>, owner: Map<string, string>, reverts: Map<string, Revert>, blamed: Blamed | undefined, closes: string): Aftermath[] {
  const later = changes.slice(pos.get(u.id)! + 1).filter((c) => Date.parse(mergedAt(c)) <= Date.parse(closes));
  const uSource = u.files.filter((f) => f.cls === "source").map((f) => f.path);
  const uFiles = new Set(u.files.map((f) => f.path));
  const stems = [...new Set(uSource.map(stem).filter((s) => s.length >= 3))];
  const dirs = [...new Set(uSource.map((p) => p.split("/").slice(0, -1).join("/")).filter(Boolean))];
  const names = [...uFiles, ...stems, ...dirs].map((s) => s.toLowerCase());
  const out: Aftermath[] = [];
  for (const x of later) {
    const base = { change: x.id, merged_at: mergedAt(x), subject: x.pr?.title ?? x.subject, pr: x.pr?.number ?? null, files: x.files.map((f) => f.path) };
    const r = reverts.get(x.id);
    if (r) {
      if (r.reverted && owner.get(r.reverted) === u.id) out.push({ kind: "R", ...base, defect: r.defect });
      continue;
    }
    const b = blamed?.get(x.id);
    if (b) {
      out.push({ kind: "B", ...base, blamed_lines: b.lines, sites: [...b.sites.values()] });
      continue;
    }
    const tests = x.files.filter((f) => f.cls === "test" && f.status !== "D");
    if (tests.length && (tests.some((f) => uFiles.has(f.path) || stems.some((s) => f.path.toLowerCase().includes(s))) || x.files.some((f) => f.cls === "source" && uFiles.has(f.path)))) out.push({ kind: "T", ...base });
    const lanes = x.files.filter((f) => isLanePath(f.path));
    if (!lanes.length) continue;
    const text = lanes.map((f) => gitRun(repoDir, ["diff", "--no-ext-diff", "--no-textconv", x.parent, x.id, "--", f.path]).stdout).join("\n").toLowerCase();
    if (names.some((n) => text.includes(n)) || x.files.some((f) => uFiles.has(f.path))) out.push({ kind: "C", ...base });
  }
  return out;
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, " ");
const EDITS = "userContentEdits(first:100){ totalCount nodes { editedAt diff } }";

export interface PlanText {
  pr: number;
  title: string;
  description: string;
  issues: Array<{ number: number; title: string; created_at: string; user: boolean; text: string }>;
  words: number;
}

type Query = (query: string, variables?: Record<string, unknown>) => any;

/** Earliest recoverable plan text per pull request: the description and the closing issues opened before the merge. */
export function planTexts(repo: string, prs: Array<{ pr: number; merged_at: string }>, query: Query = graphql): Map<number, PlanText | null> {
  const [o, n] = repo.split("/");
  const out = new Map<number, PlanText | null>();
  for (let i = 0; i < prs.length; i += 10) {
    const batch = prs.slice(i, i + 10);
    const parts = batch.map((p, j) => "p" + j + ": pullRequest(number:" + p.pr + "){ title body createdAt " + EDITS + " closingIssuesReferences(first:10){ nodes { number title body createdAt authorAssociation " + EDITS + " } } }");
    const d = query("query($o:String!,$n:String!){ repository(owner:$o,name:$n){ " + parts.join(" ") + " } rateLimit{cost remaining resetAt} }", { o, n });
    batch.forEach((p, j) => {
      const x = d?.repository?.["p" + j];
      const fv = x ? firstVersion(x.body ?? "", x.userContentEdits) : null;
      if (!fv) return out.set(p.pr, null);
      const issues = (x.closingIssuesReferences?.nodes ?? [])
        .filter((q: any) => Date.parse(q.createdAt) < Date.parse(p.merged_at))
        .flatMap((q: any) => {
          const v = firstVersion(q.body ?? "", q.userContentEdits);
          return v ? [{ number: q.number, title: q.title ?? "", created_at: q.createdAt, user: !["OWNER", "MEMBER", "COLLABORATOR"].includes(q.authorAssociation), text: stripComments(v.text) }] : [];
        });
      const description = stripComments(fv.text);
      out.set(p.pr, { pr: p.pr, title: x.title ?? "", description, issues, words: words(description) + issues.reduce((s: number, q: { text: string }) => s + words(q.text), 0) });
    });
  }
  return out;
}

const NO_CHANGE = [
  /\bno (?:intended |expected )?(?:user[- ]facing |functional |visible |observable )?(?:behaviou?r(?:al)?|functional|logic|user[- ]facing) changes?\b/i,
  /\b(?:pure(?:ly)?|mechanical) refactor(?:ing)?\b|\brefactor(?:ing)?[ -]only\b/i,
  /\bbehaviou?r[- ]preserving\b/i,
  /\b(?:does not|doesn't|should not|will not|won't|not intended to) (?:change|alter|affect) (?:any )?(?:behaviou?r|functionality)\b/i,
  /\b(?:behaviou?r|functionality) (?:is|remains|stays) (?:unchanged|the same)\b/i,
];
const SCOPED = /\b(?:existing|default|backwards?[- ]compat\w*|except|other than|apart from|unless|only|themselves|itself)\b|\b(?:to|in|for) the \w+|\b(?:desktop|mobile|android|ios|windows|linux|macos|web)(?:\/\w+)? behaviou?r\b/i;

/** Section 4 admits a feature or behavior change: a title or description saying, unscoped, that no behavior change is intended marks a refactor. */
export const statesNoBehaviorChange = (t: PlanText) =>
  (t.title + "\n" + t.description).split(/(?<=[.!?\n])\s+/).some((s) => NO_CHANGE.some((re) => re.test(s)) && !SCOPED.test(s));

/** Fills plan_words for eligible candidates; one with no pull request or no recoverable description has no plan text. */
export function withPlans(r: MineResult, query: Query = graphql): Map<number, PlanText | null> {
  const wanted = r.candidates.filter((c) => c.eligible && c.pr !== null);
  const texts = planTexts(r.repo, wanted.map((c) => ({ pr: c.pr!, merged_at: c.merged_at })), query);
  for (const c of r.candidates.filter((c) => c.eligible)) {
    const t = c.pr === null ? null : texts.get(c.pr) ?? null;
    c.plan_words = t?.words ?? 0;
    if (!t) c.reasons.push("no_plan_text");
    else if (t.words < MIN_PLAN_WORDS) c.reasons.push("plan_under_120_words");
    else if (statesNoBehaviorChange(t)) c.reasons.push("no_behavior_change");
    c.eligible = c.reasons.length === 0;
  }
  return texts;
}

/** A defect revert or a B candidate with at least 2 blamed lines: GEVA-405's supply count's strict keyable read. */
export const strictBR = (c: Candidate) => c.aftermath.some((x) => (x.kind === "R" && x.defect === true) || (x.kind === "B" && (x.blamed_lines ?? 0) >= 2));

const USAGE = "er mine --repo-dir <clone> --repo <owner/name> --licence <spdx> --meta <meta.json> --out <candidates.json> [--branch <ref>] [--mined-at <date>] [--plan]";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { "repo-dir": "one", repo: "one", licence: "one", meta: "one", out: "one", branch: "one", "mined-at": "one", plan: "flag" }, USAGE);
  need(a, ["repo-dir", "repo", "licence", "meta", "out"], USAGE);
  if (!LICENCES.includes(a.one.licence!)) throw new PvError("E_USAGE", "--licence must be one of " + LICENCES.join(", "));
  refuseInRepo("--out", a.one.out!);
  const r = mineClone({ repoDir: a.one["repo-dir"]!, repo: a.one.repo!, licence: a.one.licence!, branch: a.one.branch ?? "HEAD", meta: parseMeta(readFileSync(a.one.meta!, "utf8")), minedAt: a.one["mined-at"] ?? new Date().toISOString().slice(0, 10) });
  const texts = a.flag.has("plan") ? withPlans(r) : new Map();
  writeJson(a.one.out!, { ...r, plans: Object.fromEntries(texts) });
  const n = (f: (c: Candidate) => boolean) => r.candidates.filter(f).length;
  io.out("er mine: " + r.scanned + " changes read, " + r.candidates.length + " merged in the window, " + n((c) => c.kind === "feature") + " features, " + n((c) => c.eligible) + " eligible, " + n((c) => c.eligible && strictBR(c)) + " eligible with a strict B or defect revert");
  return 0;
}

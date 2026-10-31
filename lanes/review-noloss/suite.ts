// Copyright (c) 2026 Garry Tan. MIT License.
// The review no-loss suite (wiki/plans/2026-10-30-gsta-40-review-noloss-plan, sections 2 and 8). A suite groups the
// blockers a comparison scores: units are review ranges (repo, PR, head, base), each holding the blockers a reviewer of
// that range should flag, and every blocker points at a catalog case in U13's schema. Units are keyed by repo, PR and
// head, and clustered by repo and PR, so two heads of one PR are two units in one cluster.
//
// A plan suite (kind plan, planning lane plan 2026-10-31-geva-79-planning-lane-plan, B1 and open item 1) holds plan
// units: each unit is a small repository whose head commit adds plan.md, and each blocker points at a plan case. A sealed
// suite never sits in this repo in full: the repo holds its stub (id, kind, sealed, counts and digests), and the suite
// and its catalogs live under a sealed root, an absolute path outside this checkout given with --sealed-root. loadSuite
// reads the stub, then <sealed root>/suites/<id>.json, checks both digests and the counts, and resolves the suite's
// catalogs against the sealed root. Decrypting a panel into the sealed root happens outside the scorer.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isPlanCase, loadCatalog, type CatalogCase, type PlanStratum } from "../review-replay/catalog/catalog.ts";

export const LANE_DIR = import.meta.dir;
export const REPO_ROOT = resolve(LANE_DIR, "..", "..");
export const SUITES_DIR = join(LANE_DIR, "suites");

export type Location = "added" | "context" | "outside" | "unknown";
/** blocking: counts toward blocking recall. detection: deserved severity unsettled, so detection recall only. over-blocking: deserved INFORMATIONAL, feeds the over-blocking rate. */
export type Counts = "blocking" | "detection" | "over-blocking";

export interface Blocker {
  id: string;
  case: string;
  /** Every path the answer key names; a finding on any of them is on the same path. */
  paths: string[];
  file: string;
  line: number;
  location: Location;
  counts: Counts;
}

export interface Unit {
  /** <repo>#<pr>@<first 12 of head>: stable across suites. */
  id: string;
  repo: string;
  pr: number;
  head: string;
  base: string;
  /** <repo>#<pr>: the sign-flip cluster. */
  cluster: string;
  group: string | null;
  note?: string;
  blockers: Blocker[];
}

export type FrozenBar =
  | { round: string; kind: "group-all-and-hits"; all_found_group: string; hits_group: string; min_hits: number; text: string }
  | { round: string; kind: "reference-misses"; reference: string; max_misses: number; text: string };

export interface Digest {
  name: string;
  sha256: string;
  bytes?: number;
  what: string;
}

export interface Suite {
  schema_version: 1;
  id: string;
  title: string;
  kind: "noloss" | "catalog" | "plan";
  /** true: tuned on in public, so it ranks variants but cannot confirm a release on its own. */
  development_only: boolean;
  purpose: string;
  /** A sealed suite's arms and outputs must live outside this repo. */
  sealed: boolean;
  /** Catalog dirs, repo-relative, that hold every case a blocker names. */
  catalogs: string[];
  /** Source documents kept outside the repo, pinned by digest; freezes are byte prefixes with their own digests. */
  sources: Digest[];
  prereg_freezes: Array<{ round: string; bytes: number; sha256: string }>;
  judging_rule: string;
  shelf_life: { rule: string; released: string | null };
  groups: Record<string, string>;
  units: Unit[];
  ineligible: Array<{ ref: string; reason: string }>;
  excluded: Array<{ ref: string; reason: string }>;
  frozen_bars: FrozenBar[];
}

/** The repo's record of a sealed suite: counts and digests only, never units or cases. */
export interface SuiteStub {
  schema_version: 1;
  id: string;
  title: string;
  kind: Suite["kind"];
  sealed: true;
  stub: true;
  purpose: string;
  /** sha256 of <sealed root>/suites/<id>.json. */
  sha256: string;
  /** sha256 over every case file in the suite's catalogs under the sealed root (catalogsDigest). */
  catalogs_sha256: string;
  counts: StubCounts;
  /** How the sealed copy is held, such as "procedural custody: an age-encrypted bundle, key held apart". */
  custody: string;
}

export interface StubCounts {
  units: number;
  clusters: number;
  blocking: number;
  detection: number;
  over_blocking: number;
  /** Units per group, for a suite whose units carry groups (a plan suite's strata). */
  groups: Record<string, number>;
}

export class SuiteError extends Error {}

/** The judging rule every plan suite carries (plan section 5, open items 8 and 10). */
export const PLAN_JUDGING_RULE =
  "A flaw is FOUND when a finding rated must-fix after mapping (CRITICAL; Critical or High in the plan told prompt) names the same defect: the same cause in the same plan section, with the section as evidence; the line may move. The same defect rated only INFORMATIONAL is DOWNGRADED, which is a miss. Otherwise it is MISSED. Judges read the plan and its context as they were before the session.";

/** Each plan stratum as a suite group. */
export const PLAN_GROUPS: Readonly<Record<PlanStratum, string>> = {
  seeded: "Seeded flaws, written blind to gstack; the headline with real-neutral.",
  "real-neutral": "Flaws found in approved public plans by something other than a gstack review, restated; also read alone.",
  "home-field": "gstack's own planted-flaw fixtures; reported alone, never in the headline.",
  decoy: "Plans with no flaw in the lens and one justified bait; the false-alarm reading only.",
  pilot: "Pilot units; never scored.",
};

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCATIONS: Location[] = ["added", "context", "outside", "unknown"];
const COUNTS: Counts[] = ["blocking", "detection", "over-blocking"];

export const unitId = (repo: string, pr: number, head: string): string => repo + "#" + pr + "@" + head.slice(0, 12);
export const clusterId = (repo: string, pr: number): string => repo + "#" + pr;
export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** A unit ref in an arm file: [<owner>/<repo>#]<pr>[@<head prefix>], with "__" allowed for "/" so it fits a file name. */
export function resolveUnit(suite: Suite, ref: string): { unit: Unit | null; problem: string | null } {
  const m = /^(?:([A-Za-z0-9_.-]+)(?:\/|__)([A-Za-z0-9_.-]+)#)?(\d+)(?:@([0-9a-f]{7,40}))?$/.exec(ref);
  if (!m) return { unit: null, problem: JSON.stringify(ref) + " is not a unit ref; write <pr>, <pr>@<head> or <owner>/<repo>#<pr>@<head>" };
  const repo = m[1] ? m[1] + "/" + m[2] : null;
  const hits = suite.units.filter((u) => u.pr === Number(m[3]) && (repo === null || u.repo === repo) && (!m[4] || u.head.startsWith(m[4])));
  if (hits.length === 1) return { unit: hits[0]!, problem: null };
  if (hits.length === 0) return { unit: null, problem: JSON.stringify(ref) + " names no unit of suite " + suite.id };
  return { unit: null, problem: JSON.stringify(ref) + " names " + hits.length + " units of suite " + suite.id + " (" + hits.map((u) => u.id).join(", ") + "); write the full <owner>/<repo>#<pr>@<head>" };
}

/** The shortest ref that names the unit alone in this suite: <pr>, then <pr>@<head12>, then the full id. */
export function unitRef(suite: Suite, unit: Unit): string {
  for (const ref of [String(unit.pr), unit.pr + "@" + unit.head.slice(0, 12)]) if (resolveUnit(suite, ref).unit === unit) return ref;
  return unit.id;
}

export const blockerCount = (suite: Suite, counts?: Counts): number => suite.units.reduce((n, u) => n + u.blockers.filter((b) => !counts || b.counts === counts).length, 0);

/** Shape problems; an empty list means the suite can be used. */
export function suiteProblems(value: unknown): string[] {
  const p: string[] = [];
  const s = value as Suite;
  if (!s || typeof s !== "object") return ["the suite is not a JSON object"];
  if (s.schema_version !== 1) p.push("schema_version must be 1");
  if (typeof s.id !== "string" || !ID.test(s.id)) p.push("id must match " + ID);
  for (const k of ["title", "purpose", "judging_rule"] as const) if (typeof s[k] !== "string" || !s[k]) p.push(k + " must be a non-empty string");
  if (s.kind !== "noloss" && s.kind !== "catalog" && s.kind !== "plan") p.push("kind is noloss, catalog or plan");
  if (typeof s.development_only !== "boolean" || typeof s.sealed !== "boolean") p.push("development_only and sealed must be booleans");
  if (!Array.isArray(s.catalogs) || s.catalogs.length === 0 || s.catalogs.some((c) => typeof c !== "string" || isAbsolute(c))) p.push("catalogs must list repo-relative dirs");
  if (!s.shelf_life || typeof s.shelf_life.rule !== "string" || (s.shelf_life.released !== null && !DATE.test(String(s.shelf_life.released)))) p.push("shelf_life needs a rule and released (YYYY-MM-DD or null)");
  if (!Array.isArray(s.sources) || !Array.isArray(s.prereg_freezes) || !Array.isArray(s.ineligible) || !Array.isArray(s.excluded) || !Array.isArray(s.frozen_bars)) p.push("sources, prereg_freezes, ineligible, excluded and frozen_bars must be arrays");
  if (!s.groups || typeof s.groups !== "object") p.push("groups must be an object");
  if (!Array.isArray(s.units) || s.units.length === 0) return [...p, "units must be a non-empty array"];
  const ids = new Set<string>();
  for (const [i, u] of s.units.entries()) {
    const at = "units[" + i + "]";
    if (!u || typeof u.repo !== "string" || !Number.isSafeInteger(u.pr) || !SHA.test(u.head ?? "") || !SHA.test(u.base ?? "")) {
      p.push(at + " needs repo, pr, head and base (full shas)");
      continue;
    }
    if (u.id !== unitId(u.repo, u.pr, u.head)) p.push(at + " id must be " + unitId(u.repo, u.pr, u.head));
    if (u.cluster !== clusterId(u.repo, u.pr)) p.push(at + " cluster must be " + clusterId(u.repo, u.pr));
    if (ids.has(u.id)) p.push(at + " repeats unit " + u.id);
    ids.add(u.id);
    if (u.group !== null && !(u.group in (s.groups ?? {}))) p.push(at + " group " + JSON.stringify(u.group) + " is not in groups");
    if (!Array.isArray(u.blockers) || u.blockers.length === 0) {
      p.push(at + " needs at least one blocker");
      continue;
    }
    const bids = new Set<string>();
    for (const [j, b] of u.blockers.entries()) {
      const bat = at + ".blockers[" + j + "]";
      if (typeof b.id !== "string" || !/^B[1-9]\d*$/.test(b.id)) p.push(bat + " id must be B<n>");
      if (bids.has(b.id)) p.push(bat + " repeats " + b.id + " in " + u.id);
      bids.add(b.id);
      if (typeof b.case !== "string" || !ID.test(b.case)) p.push(bat + " case must be a catalog case id");
      if (!Array.isArray(b.paths) || !b.paths.includes(b.file)) p.push(bat + " paths must include file");
      if (!Number.isSafeInteger(b.line) || b.line < 1) p.push(bat + " line must be a positive integer");
      if (!LOCATIONS.includes(b.location)) p.push(bat + " location is one of " + LOCATIONS.join(", "));
      if (!COUNTS.includes(b.counts)) p.push(bat + " counts is one of " + COUNTS.join(", "));
    }
  }
  for (const bar of s.frozen_bars ?? []) {
    if (bar.kind === "group-all-and-hits" && (!(bar.all_found_group in (s.groups ?? {})) || !(bar.hits_group in (s.groups ?? {})))) p.push("frozen bar round " + bar.round + " names a group the suite lacks");
    if (bar.kind !== "group-all-and-hits" && bar.kind !== "reference-misses") p.push("frozen bar round " + (bar as FrozenBar).round + " has an unknown kind");
  }
  return p;
}

let defaultSealedRoot: string | null = null;
/** The sealed root a CLI's --sealed-root names, used when loadSuite is not given one. */
export function setSealedRoot(dir: string | null): void {
  defaultSealedRoot = dir === null ? null : checkSealedRoot(dir);
}

/** A sealed root is any absolute path to a directory outside this checkout, symlinks resolved; one inside it is refused. */
export function checkSealedRoot(dir: string, repoRoot = REPO_ROOT): string {
  if (!isAbsolute(dir)) throw new SuiteError("--sealed-root " + dir + " is not an absolute path");
  const inside = "--sealed-root " + dir + " is inside the repo; sealed suites and catalogs stay outside this checkout";
  if (insideRepo(dir, repoRoot)) throw new SuiteError(inside);
  if (!existsSync(dir)) throw new SuiteError("--sealed-root " + dir + " does not exist");
  const real = realpathSync(dir);
  if (insideRepo(real, realpathSync(repoRoot))) throw new SuiteError(inside + " (it resolves to " + real + ")");
  return real;
}

/** Where each loaded suite's catalogs resolve: its sealed root, or the repo for a public suite. */
const catalogRoots = new WeakMap<Suite, string>();
export const catalogRoot = (suite: Suite): string => catalogRoots.get(suite) ?? REPO_ROOT;

function readJson(path: string, what: string): { text: string; value: unknown } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new SuiteError("cannot read " + what + " " + path + ": " + (e as Error).message);
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch (e) {
    throw new SuiteError(what + " " + path + " is not JSON: " + (e as Error).message);
  }
}

/** How every stub's custody reads: the seal is a key held apart, which plan v3.2's sealing does not cover. */
export const PROCEDURAL_CUSTODY = "procedural custody";

const isStub = (v: unknown): v is SuiteStub => !!v && typeof v === "object" && (v as { stub?: unknown }).stub === true;

/** Shape problems of a stub; an empty list means it can be used. */
export function stubProblems(v: SuiteStub): string[] {
  const p: string[] = [];
  if (v.schema_version !== 1) p.push("schema_version must be 1");
  if (typeof v.id !== "string" || !ID.test(v.id)) p.push("id must match " + ID);
  if (v.sealed !== true) p.push("a stub is for a sealed suite, so sealed must be true");
  if (v.kind !== "noloss" && v.kind !== "catalog" && v.kind !== "plan") p.push("kind is noloss, catalog or plan");
  for (const k of ["title", "purpose", "custody"] as const) if (typeof v[k] !== "string" || !v[k]) p.push(k + " must be a non-empty string");
  if (typeof v.custody === "string" && !v.custody.startsWith(PROCEDURAL_CUSTODY)) p.push("custody must start \"" + PROCEDURAL_CUSTODY + "\": a key held apart is procedural custody, not plan v3.2 sealing");
  for (const k of ["sha256", "catalogs_sha256"] as const) if (!/^[0-9a-f]{64}$/.test(String(v[k]))) p.push(k + " must be a sha256");
  const c = v.counts;
  if (!c || typeof c !== "object" || !["units", "clusters", "blocking", "detection", "over_blocking"].every((k) => Number.isSafeInteger((c as unknown as Record<string, unknown>)[k])) || !c.groups || typeof c.groups !== "object") p.push("counts needs units, clusters, blocking, detection, over_blocking and groups");
  const extra = Object.keys(v).filter((k) => !["schema_version", "id", "title", "kind", "sealed", "stub", "purpose", "sha256", "catalogs_sha256", "counts", "custody"].includes(k));
  if (extra.length) p.push("a stub holds counts and digests only; remove " + extra.join(", "));
  return p;
}

/** The counts a stub records for a suite. */
export function stubCounts(suite: Suite): StubCounts {
  const groups: Record<string, number> = {};
  for (const u of suite.units) if (u.group !== null) groups[u.group] = (groups[u.group] ?? 0) + 1;
  return { units: suite.units.length, clusters: new Set(suite.units.map((u) => u.cluster)).size, blocking: blockerCount(suite, "blocking"), detection: blockerCount(suite, "detection"), over_blocking: blockerCount(suite, "over-blocking"), groups };
}

/** sha256 over every *.json case file in the suite's catalogs under root, by catalog dir and file name. */
export function catalogsDigest(suite: Suite, root: string): string {
  const parts: string[] = [];
  for (const dir of [...suite.catalogs].sort()) {
    const abs = join(root, dir);
    if (!existsSync(abs)) throw new SuiteError("catalog " + dir + " is not under " + root);
    for (const f of readdirSync(abs).filter((x) => x.endsWith(".json")).sort()) parts.push(dir + "/" + f + " " + sha256(readFileSync(join(abs, f))));
  }
  return sha256(parts.join("\n"));
}

/** The stub to commit for a sealed suite held under root. */
export function suiteStub(suite: Suite, text: string, root: string, custody: string): SuiteStub {
  if (!suite.sealed) throw new SuiteError("suite " + suite.id + " is not sealed, so it needs no stub; commit it whole");
  if (!custody.startsWith(PROCEDURAL_CUSTODY)) throw new SuiteError("--custody must start \"" + PROCEDURAL_CUSTODY + "\", such as \"" + PROCEDURAL_CUSTODY + ": an age-encrypted bundle, key held apart\"");
  const leaks = sealedLeaks(suite, suite.title + "\n" + suite.purpose + "\n" + custody);
  if (leaks.length) throw new SuiteError("the stub would publish what the seal hides in the suite's title, purpose or custody: " + leaks.join(", ") + "; reword them in the sealed suite");
  return { schema_version: 1, id: suite.id, title: suite.title, kind: suite.kind, sealed: true, stub: true, purpose: suite.purpose, sha256: sha256(text), catalogs_sha256: catalogsDigest(suite, root), counts: stubCounts(suite), custody };
}

/**
 * Reads a suite by id (lanes/review-noloss/suites/<id>.json) or by path. A stub needs a sealed root: the suite is read
 * from <sealed root>/suites/<id>.json and must match the stub's digests and counts. A sealed suite is never read whole
 * from inside the repo. A sealed suite read by path from outside the repo resolves its catalogs against the sealed root
 * when one is given, else against the repo.
 */
export function loadSuite(idOrPath: string, o: { sealedRoot?: string | null } = {}): { suite: Suite; path: string; sha256: string; stub: { path: string; sha256: string; custody: string } | null } {
  const sealedRoot = o.sealedRoot === undefined ? defaultSealedRoot : o.sealedRoot === null ? null : checkSealedRoot(o.sealedRoot);
  const path = ID.test(idOrPath) ? join(SUITES_DIR, idOrPath + ".json") : resolve(idOrPath);
  const first = readJson(path, "suite");
  let { text, value } = first;
  let full = path;
  let stub: { path: string; sha256: string; custody: string } | null = null;
  if (isStub(value)) {
    const sp = stubProblems(value);
    if (sp.length) throw new SuiteError("suite stub " + path + " is malformed:\n" + sp.join("\n"));
    if (sealedRoot === null) throw new SuiteError("suite " + value.id + " is sealed, and " + path + " is its stub (counts and digests only); pass --sealed-root <dir>, the directory outside the repo that holds suites/" + value.id + ".json and its catalogs");
    const want = value;
    stub = { path, sha256: sha256(text), custody: want.custody };
    full = join(sealedRoot, "suites", want.id + ".json");
    ({ text, value } = readJson(full, "sealed suite"));
    if (sha256(text) !== want.sha256) throw new SuiteError("sealed suite " + full + " hashes to " + sha256(text) + ", not the stub's " + want.sha256 + "; the sealed copy changed or is the wrong one");
    const problems = suiteProblems(value);
    if (problems.length) throw new SuiteError("sealed suite " + full + " is malformed:\n" + problems.join("\n"));
    const s = value as Suite;
    if (s.id !== want.id || s.kind !== want.kind || s.sealed !== true) throw new SuiteError("sealed suite " + full + " is " + s.id + " (" + s.kind + ", sealed " + s.sealed + "), not the stub's " + want.id + " (" + want.kind + ", sealed)");
    const counts = stubCounts(s);
    if (JSON.stringify(counts) !== JSON.stringify(want.counts)) throw new SuiteError("sealed suite " + full + " counts " + JSON.stringify(counts) + ", not the stub's " + JSON.stringify(want.counts));
    const cat = catalogsDigest(s, sealedRoot);
    if (cat !== want.catalogs_sha256) throw new SuiteError("the catalogs of sealed suite " + s.id + " under " + sealedRoot + " hash to " + cat + ", not the stub's " + want.catalogs_sha256 + "; an answer key changed after the stub was committed");
  } else {
    const problems = suiteProblems(value);
    if (problems.length) throw new SuiteError("suite " + path + " is malformed:\n" + problems.join("\n"));
    if ((value as Suite).sealed && insideRepo(path)) throw new SuiteError("suite " + (value as Suite).id + " is sealed, and " + path + " holds it whole inside the repo; move it under a sealed root outside the repo and commit only its stub (noloss suite --stub)");
  }
  const suite = value as Suite;
  if (suite.sealed && sealedRoot !== null) catalogRoots.set(suite, sealedRoot);
  return { suite, path: full, sha256: sha256(text), stub };
}

/** Loads every case the suite's catalogs hold, by id; catalog problems come back too. */
export function suiteCases(suite: Suite, root = catalogRoot(suite)): { cases: Map<string, CatalogCase>; problems: string[] } {
  const cases = new Map<string, CatalogCase>();
  const problems: string[] = [];
  for (const dir of suite.catalogs) {
    const loaded = loadCatalog(join(root, dir));
    for (const c of [...loaded.cases, ...loaded.plans]) cases.set(c.id, c);
    for (const q of loaded.problems) problems.push(dir + "/" + q.file + ": " + q.message);
  }
  return { cases, problems };
}

/**
 * suite --check: every blocker's case loads with a confirmed answer-key audit, and its range, file and line match the
 * unit and blocker. With a prereg copy, every recorded freeze digest must hold on its byte prefix.
 */
export function checkSuite(suite: Suite, options: { repoRoot?: string; prereg?: Buffer } = {}): string[] {
  const { cases, problems } = suiteCases(suite, options.repoRoot);
  const p = [...problems];
  for (const u of suite.units) {
    for (const b of u.blockers) {
      const at = u.id + " " + b.id;
      const c = cases.get(b.case);
      if (!c) {
        p.push(at + ": case " + b.case + " is in none of " + suite.catalogs.join(", "));
        continue;
      }
      if (c.repo !== u.repo || c.reviewed_head !== u.head || c.merge_base !== u.base) p.push(at + ": case " + b.case + " reviews " + c.repo + " " + c.merge_base.slice(0, 12) + ".." + c.reviewed_head.slice(0, 12) + ", not the unit's " + u.base.slice(0, 12) + ".." + u.head.slice(0, 12));
      if (c.defect.file !== b.file || c.defect.line !== b.line) p.push(at + ": case " + b.case + " answers " + c.defect.file + ":" + c.defect.line + ", not " + b.file + ":" + b.line);
      if (c.answer_key_audit?.verdict !== "confirmed") p.push(at + ": case " + b.case + " has no confirmed answer-key audit, so it cannot be scored");
      if ((suite.kind === "catalog" || suite.kind === "plan") && b.counts !== countsFor(c)) p.push(at + ": counts must be " + countsFor(c) + " for deserved " + c.severity.deserved);
      if ((suite.kind === "plan") !== isPlanCase(c)) p.push(at + ": case " + b.case + (isPlanCase(c) ? " is a plan case, and suite " + suite.id + " is not a plan suite" : " is a review case, and suite " + suite.id + " is a plan suite"));
      if (isPlanCase(c) && u.group !== c.plan.stratum) p.push(at + ": case " + b.case + " is stratum " + c.plan.stratum + ", so the unit's group must be " + c.plan.stratum);
    }
  }
  if (suite.kind === "plan" && suite.judging_rule !== PLAN_JUDGING_RULE) p.push("a plan suite carries the plan judging rule (PLAN_JUDGING_RULE in lanes/review-noloss/suite.ts)");
  if (options.prereg) {
    for (const f of suite.prereg_freezes) {
      const got = options.prereg.length < f.bytes ? null : sha256(options.prereg.subarray(0, f.bytes));
      if (got !== f.sha256) p.push("prereg freeze " + f.round + ": the first " + f.bytes + " bytes hash to " + (got ?? "nothing (the file is shorter)") + ", not " + f.sha256);
    }
  }
  return p;
}

export const countsFor = (c: CatalogCase): Counts => (c.severity.deserved === "CRITICAL" ? "blocking" : c.severity.deserved === "INFORMATIONAL" ? "over-blocking" : "detection");

/** Every identifier of a sealed suite's units and cases that a text names: unit ids, clusters, repos, commits (full, 12 and 7 characters) and case ids. */
export function sealedLeaks(suite: Suite, text: string): string[] {
  const words = new Set<string>();
  for (const u of suite.units) {
    for (const w of [u.id, u.cluster, u.repo, u.head, u.head.slice(0, 12), u.head.slice(0, 7), u.base, u.base.slice(0, 12), u.base.slice(0, 7)]) words.add(w);
    for (const b of u.blockers) words.add(b.case);
  }
  return [...words].filter((w) => text.includes(w)).sort();
}

/** True when dir resolves inside the repo tree. */
export function insideRepo(dir: string, repoRoot = REPO_ROOT): boolean {
  const rel = relative(resolve(repoRoot), resolve(dir));
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

/**
 * suite --from-catalog (plan section 8): one unit and one blocker per case. Only cases with a confirmed answer-key audit
 * count. A short-shelf-life case counts only for models released before its fix first appeared, so released (the
 * newest release date among the arm's models, from the prereg) is required whenever such a case is present; there is
 * no default. A merge base suite keeps its units and drops catalog cases it already names.
 *
 * Plan cases build a plan suite: the cases of one unit (repo, unit number and head) share it, each unit's group is its
 * stratum, and only the strata asked for come in (every stratum but pilot by default; pilot units are never scored, so
 * a pilot suite is built on its own). A suite holds review cases or plan cases, never both.
 */
export function suiteFromCatalog(options: { id: string; catalogs: string[]; released: string | null; base?: Suite; root?: string; strata?: PlanStratum[] }): Suite {
  const root = options.root ?? (options.base ? catalogRoot(options.base) : REPO_ROOT);
  if (!ID.test(options.id)) throw new SuiteError("suite id must match " + ID);
  if (options.released !== null && !DATE.test(options.released)) throw new SuiteError("--released is a date, YYYY-MM-DD");
  const strata = new Set<PlanStratum>(options.strata ?? ["seeded", "real-neutral", "home-field", "decoy"]);
  const named = new Set(options.base?.units.flatMap((u) => u.blockers.map((b) => b.case)) ?? []);
  const units: Unit[] = options.base ? options.base.units.map((u) => ({ ...u, blockers: [...u.blockers] })) : [];
  const ineligible = [...(options.base?.ineligible ?? [])];
  const excluded = [...(options.base?.excluded ?? [])];
  const problems: string[] = [];
  let sealed = options.base?.sealed ?? false;
  let plans = options.base ? options.base.kind === "plan" : null;
  for (const dir of options.catalogs) {
    const loaded = loadCatalog(join(root, dir));
    for (const q of loaded.problems) problems.push(dir + "/" + q.file + ": " + q.message);
    const all: CatalogCase[] = [...loaded.cases, ...loaded.plans];
    if (all.some((c) => c.visibility === "sealed")) sealed = true;
    for (const c of all) {
      if (plans === null) plans = isPlanCase(c);
      if (plans !== isPlanCase(c)) throw new SuiteError("case " + c.id + " is a " + (isPlanCase(c) ? "plan" : "review") + " case, and this suite holds " + (plans ? "plan" : "review") + " cases; a suite holds one kind");
      if (named.has(c.id)) continue;
      named.add(c.id);
      if (isPlanCase(c) && !strata.has(c.plan.stratum)) {
        excluded.push({ ref: c.id, reason: "stratum " + c.plan.stratum + " is not in this suite" + (c.plan.stratum === "pilot" ? "; pilot units are never scored" : "") });
        continue;
      }
      if (c.answer_key_audit?.verdict !== "confirmed") {
        ineligible.push({ ref: c.id, reason: "answer-key audit is " + (c.answer_key_audit?.verdict ?? "missing") + ", not confirmed" });
        continue;
      }
      if (!isPlanCase(c) && c.shelf_life.short) {
        if (options.released === null) throw new SuiteError("case " + c.id + " has a short shelf life; pass --released <YYYY-MM-DD>, the newest release date among the arm's models, from the prereg");
        if (c.shelf_life.first_appeared <= options.released) {
          ineligible.push({ ref: c.id, reason: "short shelf life: its fix first appeared " + c.shelf_life.first_appeared + ", not after the models' release " + options.released });
          continue;
        }
      }
      const blocker: Blocker = { id: "B1", case: c.id, paths: [c.defect.file], file: c.defect.file, line: c.defect.line, location: isPlanCase(c) ? "added" : "unknown", counts: countsFor(c) };
      const id = unitId(c.repo, c.pr, c.reviewed_head);
      const group = isPlanCase(c) ? c.plan.stratum : null;
      const same = units.find((u) => u.id === id && u.base === c.merge_base);
      if (same && same.group !== group) problems.push("case " + c.id + " is stratum " + group + ", and unit " + id + " is " + same.group);
      else if (same) same.blockers.push({ ...blocker, id: "B" + (same.blockers.length + 1) });
      else units.push({ id, repo: c.repo, pr: c.pr, head: c.reviewed_head, base: c.merge_base, cluster: clusterId(c.repo, c.pr), group, blockers: [blocker] });
    }
  }
  if (problems.length) throw new SuiteError("the catalog has problems:\n" + problems.join("\n"));
  const base = options.base;
  if (plans) {
    const present = [...new Set(units.map((u) => u.group as PlanStratum))];
    return {
      schema_version: 1,
      id: options.id,
      title: (base ? base.title + ", plus " : "") + "plan cases from " + options.catalogs.join(", "),
      kind: "plan",
      development_only: base?.development_only ?? !sealed,
      purpose: (base ? base.purpose + " " : "") + "Plan cases: one unit per plan, one blocker per flaw. Deserved CRITICAL counts toward must-fix recall, INFORMATIONAL (a decoy's bait) toward false alarms, unsettled toward detection only.",
      sealed,
      catalogs: [...new Set([...(base?.catalogs ?? []), ...options.catalogs])],
      sources: base?.sources ?? [],
      prereg_freezes: base?.prereg_freezes ?? [],
      judging_rule: PLAN_JUDGING_RULE,
      shelf_life: { rule: "Plan units are fresh fictional plans or restated public flaws, so no case has a short shelf life.", released: options.released },
      groups: { ...(base?.groups ?? {}), ...Object.fromEntries(present.map((g) => [g, PLAN_GROUPS[g]])) },
      units,
      ineligible,
      excluded,
      frozen_bars: base?.frozen_bars ?? [],
    };
  }
  return {
    schema_version: 1,
    id: options.id,
    title: (base ? base.title + ", plus " : "") + "catalog cases from " + options.catalogs.join(", "),
    kind: base ? base.kind : "catalog",
    development_only: base?.development_only ?? true,
    purpose: (base ? base.purpose + " " : "") + "Catalog cases add one unit and one blocker each; deserved CRITICAL counts toward blocking recall, INFORMATIONAL toward over-blocking, unsettled toward detection only.",
    sealed,
    catalogs: [...new Set([...(base?.catalogs ?? []), ...options.catalogs])],
    sources: base?.sources ?? [],
    prereg_freezes: base?.prereg_freezes ?? [],
    judging_rule: base?.judging_rule ?? "A blocker is FOUND when a finding rated CRITICAL after mapping names the same defect: a path the blocker lists and the same cause; the line may move. The same defect rated only INFORMATIONAL is DOWNGRADED, which is a miss. Otherwise it is MISSED.",
    shelf_life: { rule: "A short-shelf-life case counts only for models released before its fix first appeared; released is the newest release date among the arm's models.", released: options.released },
    groups: base?.groups ?? {},
    units,
    ineligible,
    excluded,
    frozen_bars: base?.frozen_bars ?? [],
  };
}

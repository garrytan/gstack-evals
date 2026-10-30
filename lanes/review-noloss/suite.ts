// Copyright (c) 2026 Garry Tan. MIT License.
// The review no-loss suite (wiki/plans/2026-10-30-gsta-40-review-noloss-plan, sections 2 and 8). A suite groups the
// blockers a comparison scores: units are review ranges (repo, PR, head, base), each holding the blockers a reviewer of
// that range should flag, and every blocker points at a catalog case in U13's schema. Units are keyed by repo, PR and
// head, and clustered by repo and PR, so two heads of one PR are two units in one cluster.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadCatalog, type ReplayCase } from "../review-replay/catalog/catalog.ts";

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
  kind: "noloss" | "catalog";
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

export class SuiteError extends Error {}

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
  if (s.kind !== "noloss" && s.kind !== "catalog") p.push("kind is noloss or catalog");
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

/** Reads a suite by id (lanes/review-noloss/suites/<id>.json) or by path. */
export function loadSuite(idOrPath: string): { suite: Suite; path: string; sha256: string } {
  const path = ID.test(idOrPath) ? join(SUITES_DIR, idOrPath + ".json") : resolve(idOrPath);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new SuiteError("cannot read suite " + path + ": " + (e as Error).message);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new SuiteError("suite " + path + " is not JSON: " + (e as Error).message);
  }
  const problems = suiteProblems(value);
  if (problems.length) throw new SuiteError("suite " + path + " is malformed:\n" + problems.join("\n"));
  return { suite: value as Suite, path, sha256: sha256(text) };
}

/** Loads every case the suite's catalogs hold, by id; catalog problems come back too. */
export function suiteCases(suite: Suite, repoRoot = REPO_ROOT): { cases: Map<string, ReplayCase>; problems: string[] } {
  const cases = new Map<string, ReplayCase>();
  const problems: string[] = [];
  for (const dir of suite.catalogs) {
    const loaded = loadCatalog(join(repoRoot, dir), repoRoot);
    for (const c of loaded.cases) cases.set(c.id, c);
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
      if (suite.kind === "catalog" && b.counts !== countsFor(c)) p.push(at + ": counts must be " + countsFor(c) + " for deserved " + c.severity.deserved);
    }
  }
  if (options.prereg) {
    for (const f of suite.prereg_freezes) {
      const got = options.prereg.length < f.bytes ? null : sha256(options.prereg.subarray(0, f.bytes));
      if (got !== f.sha256) p.push("prereg freeze " + f.round + ": the first " + f.bytes + " bytes hash to " + (got ?? "nothing (the file is shorter)") + ", not " + f.sha256);
    }
  }
  return p;
}

export const countsFor = (c: ReplayCase): Counts => (c.severity.deserved === "CRITICAL" ? "blocking" : c.severity.deserved === "INFORMATIONAL" ? "over-blocking" : "detection");

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
 */
export function suiteFromCatalog(options: { id: string; catalogs: string[]; released: string | null; base?: Suite; repoRoot?: string }): Suite {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  if (!ID.test(options.id)) throw new SuiteError("suite id must match " + ID);
  if (options.released !== null && !DATE.test(options.released)) throw new SuiteError("--released is a date, YYYY-MM-DD");
  const named = new Set(options.base?.units.flatMap((u) => u.blockers.map((b) => b.case)) ?? []);
  const units: Unit[] = options.base ? options.base.units.map((u) => ({ ...u, blockers: [...u.blockers] })) : [];
  const ineligible = [...(options.base?.ineligible ?? [])];
  const problems: string[] = [];
  let sealed = options.base?.sealed ?? false;
  for (const dir of options.catalogs) {
    const loaded = loadCatalog(join(repoRoot, dir), repoRoot);
    for (const q of loaded.problems) problems.push(dir + "/" + q.file + ": " + q.message);
    if (loaded.cases.some((c) => c.visibility === "sealed")) sealed = true;
    for (const c of loaded.cases) {
      if (named.has(c.id)) continue;
      named.add(c.id);
      if (c.answer_key_audit?.verdict !== "confirmed") {
        ineligible.push({ ref: c.id, reason: "answer-key audit is " + (c.answer_key_audit?.verdict ?? "missing") + ", not confirmed" });
        continue;
      }
      if (c.shelf_life.short) {
        if (options.released === null) throw new SuiteError("case " + c.id + " has a short shelf life; pass --released <YYYY-MM-DD>, the newest release date among the arm's models, from the prereg");
        if (c.shelf_life.first_appeared <= options.released) {
          ineligible.push({ ref: c.id, reason: "short shelf life: its fix first appeared " + c.shelf_life.first_appeared + ", not after the models' release " + options.released });
          continue;
        }
      }
      const blocker: Blocker = { id: "B1", case: c.id, paths: [c.defect.file], file: c.defect.file, line: c.defect.line, location: "unknown", counts: countsFor(c) };
      const id = unitId(c.repo, c.pr, c.reviewed_head);
      const same = units.find((u) => u.id === id && u.base === c.merge_base);
      if (same) same.blockers.push({ ...blocker, id: "B" + (same.blockers.length + 1) });
      else units.push({ id, repo: c.repo, pr: c.pr, head: c.reviewed_head, base: c.merge_base, cluster: clusterId(c.repo, c.pr), group: null, blockers: [blocker] });
    }
  }
  if (problems.length) throw new SuiteError("the catalog has problems:\n" + problems.join("\n"));
  const base = options.base;
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
    excluded: base?.excluded ?? [],
    frozen_bars: base?.frozen_bars ?? [],
  };
}

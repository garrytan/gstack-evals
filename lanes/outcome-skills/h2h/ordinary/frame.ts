// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 5's O frame: SWE-bench-Live MultiLang rows as the state machines harness converts them (source.ts
// toCandidate), with the eligibility gates applied in this order: the window (created 2025-01-01 or later; the seeded
// order walks March 2026 onward first), the exclusion list (on the dataset's repository name and on the name GitHub gives
// it today), the permissive licence list (o-licences.json: GitHub's spdxId as read, and for a repository GraphQL names
// no licence for or calls NOASSERTION, the second read of its root licence files, licences.ts), the harness
// screen without its feature drop (at least one fail-to-pass and one pass-to-pass test, the in-source test split, 1 to 6
// non-test source files), the told-mode screen (pfchecks/told.ts), then the image by digest. Each drop is counted at the
// first gate it fails. The feature-request screen tags each unit bug or feature. o-frame.json carries ids, repositories,
// months, languages, entries, licences and digests, never problem-statement text.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { toldScreen } from "../../pfchecks/told.ts";
import { screenOne } from "../../statemachines/screen.ts";
import type { Candidate } from "../../statemachines/source.ts";
import { h2hFail, type H2hPrereg } from "../prereg.ts";
import type { Entry } from "../types.ts";

export const O_FRAME_SCHEMA = "h2h-o-frame.v1";
/** The gates in the order they run; a candidate's drop is counted at the first one it fails. */
export const O_GATES = ["window", "exclusion", "licence", "harness_screen", "told", "image_digest"] as const;
export type OGate = (typeof O_GATES)[number];

/** licence: the spdxId GraphQL gave, or for a second read the matched licences joined with " AND " (every file's terms
 *  apply); licence_from says which read decided it. */
export interface OFrameUnit { id: string; repo: string; month: string; language: string; entry: Entry; licence: string; licence_from: "graphql" | "files"; digest: string }
export interface ODrop { id: string; repo: string; month: string; gate: OGate; code: string; rule: string }
export interface OFrame {
  schema: typeof O_FRAME_SCHEMA;
  source: { dataset: string; revision: string; rows: number; head: { sha: string; last_modified: string | null; read_at: string } };
  freeze_date: string;
  window: { from: string; walk_back_to: string };
  gate_order: readonly OGate[];
  licences_sha256: string;
  counts: {
    rows: number; in_window: number; excluded_by_pattern: Record<string, number>; licence_out_by_spdx: Record<string, number>;
    drops_by_gate: Record<string, number>; drops_by_rule: Record<string, number>; eligible: number; eligible_from_window_start: number;
    licence_second_read: { repos: number; eligible_repos: number; eligible_units: number };
    by_month: Record<string, number>; by_language: Record<string, number>; by_entry: Record<Entry, number>;
  };
  units: OFrameUnit[];
}

/** The text a candidate's told screen and feature tag read. Row bytes stay in the local cache. */
export interface RowText { problem_statement: string; patch: string }

/** The exclusion pattern a repository matches (owner/* or owner/name, compared without case), or null. */
export function excludedBy(repo: string, patterns: readonly string[]): string | null {
  const r = repo.toLowerCase();
  for (const p of patterns) {
    const q = p.toLowerCase();
    if (q.endsWith("/*") ? r.startsWith(q.slice(0, -1)) : r === q) return p;
  }
  return null;
}

export interface SecondReadFile { name: string; mode: number; git_oid: string; bytes: number; sha256: string | null; match: string | null }
export interface SecondRead {
  read_at: string; rule: string; templates: { source: string; tag: string; commit: string; sha256: Record<string, string> };
  repos: Record<string, { head: string | null; eligible: boolean; reason: "matched" | "no_file" | "unmatched"; files: SecondReadFile[] }>;
}
export interface LicenceRead { schema: "h2h-o-licences.v1"; read_at: string; query: string; repos: Record<string, { spdx: string | null; name_with_owner: string | null }>; second_read?: SecondRead }
/** Repositories the second read covers: GraphQL named no licence or returned NOASSERTION. */
export const needsSecondRead = (spdx: string | null): boolean => spdx === null || spdx === "NOASSERTION";

/** The licence gate's verdict for a repository: ok with its licence, or the drop rule (the spdxId, or the first read's
 *  answer and the second read's reason). Refuses when the repository has no first read, or needs a second read the file
 *  lacks. */
export function licenceVerdict(repo: string, lic: LicenceRead, listed: readonly string[]): { ok: true; licence: string; from: "graphql" | "files" } | { ok: false; rule: string } {
  const first = lic.repos[repo] ?? h2hFail("E_H2H_O_LICENCE", repo + " has no row in the frozen licence read");
  if (!needsSecondRead(first.spdx)) return listed.includes(first.spdx!) ? { ok: true, licence: first.spdx!, from: "graphql" } : { ok: false, rule: first.spdx! };
  const second = lic.second_read?.repos[repo] ?? h2hFail("E_H2H_O_LICENCE", repo + " needs the second licence read (GraphQL gave " + (first.spdx ?? "no licence") + ") and o-licences.json has none for it");
  const tag = (first.spdx ?? "none") + ":";
  if (!second.eligible) return { ok: false, rule: tag + second.reason };
  return { ok: true, licence: [...new Set(second.files.map((f) => f.match!))].sort().join(" AND "), from: "files" };
}
export const LICENCES_SCHEMA = "h2h-o-licences.v1";

export function readLicences(path: string): LicenceRead {
  let j: LicenceRead;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return h2hFail("E_H2H_O_SOURCE", path + " is not a readable licence file: " + (e as Error).message);
  }
  if (j.schema !== LICENCES_SCHEMA || !j.repos || typeof j.repos !== "object") h2hFail("E_H2H_O_SOURCE", path + " is not an " + LICENCES_SCHEMA + " file");
  return j;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

/** Candidates that pass the gates before the image digest, with the drops so far. The caller pins digests for the
 *  survivors only, so the counted registry reads stay few, then calls finishFrame. */
export function screenFrame(p: H2hPrereg, cands: readonly Candidate[], rows: ReadonlyMap<string, RowText>, licences: LicenceRead): { survivors: Candidate[]; drops: ODrop[]; inWindow: number; outOfWindow: number } {
  const from = p.classes.O.walk_back_to;
  const drops: ODrop[] = [];
  const survivors: Candidate[] = [];
  let inWindow = 0;
  for (const c of [...cands].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const drop = (gate: OGate, code: string, rule: string) => drops.push({ id: c.id, repo: c.repo, month: c.month, gate, code, rule });
    if (c.created_at.slice(0, 10) < from) continue;
    inWindow++;
    const ex = excludedBy(c.repo, p.exclusion) ?? excludedBy(licences.repos[c.repo]?.name_with_owner ?? "", p.exclusion);
    if (ex) {
      drop("exclusion", "E_H2H_O_EXCLUDED", ex);
      continue;
    }
    const lic = licenceVerdict(c.repo, licences, p.licences);
    if (!lic.ok) {
      drop("licence", "E_H2H_O_NOT_PERMISSIVE", lic.rule);
      continue;
    }
    const sc = screenOne({ ...c, image_digest: "sha256:" + "0".repeat(64), feature_screen: false });
    if (sc) {
      drop("harness_screen", sc.code, sc.rule);
      continue;
    }
    const row = rows.get(c.id);
    if (!row) h2hFail("E_H2H_O_SOURCE", c.id + " has no row text in the cache");
    const told = toldScreen(row!.problem_statement ?? null, row!.patch);
    if (told) {
      drop("told", "E_H2H_O_TOLD", told.rule);
      continue;
    }
    survivors.push(c);
  }
  return { survivors, drops, inWindow, outOfWindow: cands.length - inWindow };
}

/** The frame from the screened survivors and their pinned digests (null when the registry gave none). */
export function finishFrame(p: H2hPrereg, o: { cands: readonly Candidate[]; screened: ReturnType<typeof screenFrame>; digests: ReadonlyMap<string, string | null>; licences: LicenceRead; licencesText: string; head: OFrame["source"]["head"]; dataset: string; revision: string; freezeDate: string }): OFrame {
  const drops = [...o.screened.drops];
  const units: OFrameUnit[] = [];
  for (const c of o.screened.survivors) {
    const d = o.digests.get(c.id) ?? null;
    if (!d || !/^sha256:[0-9a-f]{64}$/.test(d)) {
      drops.push({ id: c.id, repo: c.repo, month: c.month, gate: "image_digest", code: "E_SM_INELIGIBLE", rule: "image_digest" });
      continue;
    }
    const lic = licenceVerdict(c.repo, o.licences, p.licences) as { licence: string; from: "graphql" | "files" };
    units.push({ id: c.id, repo: c.repo, month: c.month, language: c.lang, entry: c.feature_screen ? "feature" : "bug", licence: lic.licence, licence_from: lic.from, digest: d });
  }
  const second = Object.values(o.licences.second_read?.repos ?? {});
  const counts: OFrame["counts"] = { rows: o.cands.length, in_window: o.screened.inWindow, excluded_by_pattern: Object.fromEntries(p.exclusion.map((x) => [x, 0])), licence_out_by_spdx: {}, drops_by_gate: Object.fromEntries(O_GATES.filter((g) => g !== "window").map((g) => [g, 0])), drops_by_rule: {}, eligible: units.length, eligible_from_window_start: units.filter((u) => u.month >= p.classes.O.window_from.slice(0, 7)).length,
    licence_second_read: { repos: second.length, eligible_repos: second.filter((r) => r.eligible).length, eligible_units: units.filter((u) => u.licence_from === "files").length }, by_month: {}, by_language: {}, by_entry: { bug: 0, feature: 0 } };
  for (const d of drops) {
    bump(counts.drops_by_gate, d.gate);
    bump(counts.drops_by_rule, d.gate + ":" + d.rule);
    if (d.gate === "exclusion") bump(counts.excluded_by_pattern, d.rule);
    if (d.gate === "licence") bump(counts.licence_out_by_spdx, d.rule);
  }
  for (const u of units) {
    bump(counts.by_month, u.month);
    bump(counts.by_language, u.language);
    counts.by_entry[u.entry]++;
  }
  return {
    schema: O_FRAME_SCHEMA, source: { dataset: o.dataset, revision: o.revision, rows: o.cands.length, head: o.head }, freeze_date: o.freezeDate,
    window: { from: p.classes.O.window_from, walk_back_to: p.classes.O.walk_back_to }, gate_order: O_GATES, licences_sha256: sha(o.licencesText), counts,
    units: units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

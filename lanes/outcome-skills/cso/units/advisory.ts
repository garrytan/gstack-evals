// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 3's sources: the candidate order from prereg.json (part1_h2h, then part2_added), each unit's frame row in
// b2-frame.json, its advisory record at the pinned advisory-database commit, its CWE families from prereg.json's frozen
// map, and the repository's other reviewed advisories for the known-open list.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { B2Row } from "../../h2h/breadth/b2.ts";
import { unitId } from "../../h2h/breadth/oracle-b.ts";
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { Affected, UnitAffected } from "./deps.ts";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** One candidate in the frozen order: its unit id, list, index in that list and frame row. */
export interface Candidate { unit: string; part: "part1" | "part2"; index: number; row: B2Row }

/** The advisory fields the unit build reads (OSV 1.4 as the advisory database writes it). */
export interface AdvisoryJson {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  published?: string;
  withdrawn?: string;
  database_specific?: { cwe_ids?: string[] };
  affected?: Array<{ package?: { ecosystem?: string; name?: string }; ranges?: Array<{ type?: string; events?: Array<Record<string, string>> }> }>;
  references?: Array<{ type?: string; url?: string }>;
}

/** The frozen candidate list joined to its frame rows (E_CSO_UNIT_FRAME when the frame's sha256 is not the pinned one, an
 *  id has no row, or an id appears twice). */
export function csoCandidates(p: CsoPrereg, framePath = join(REPO_ROOT, String(p.pins.frame.file))): Candidate[] {
  if (!existsSync(framePath)) csoFail("E_CSO_UNIT_FRAME", framePath + " does not exist");
  const bytes = readFileSync(framePath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== p.pins.frame.sha256) csoFail("E_CSO_UNIT_FRAME", framePath + " has sha256 " + sha + ", not the pinned " + String(p.pins.frame.sha256));
  const rows = (JSON.parse(bytes.toString("utf8")) as { advisories?: B2Row[] }).advisories ?? [];
  const byId = new Map(rows.map((r) => [unitId(r.repo, r.ghsa), r]));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const [part, list] of [["part1", p.units.part1_h2h], ["part2", p.units.part2_added]] as const)
    list.forEach((unit, index) => {
      const row = byId.get(unit);
      if (!row) csoFail("E_CSO_UNIT_FRAME", unit + " (" + part + " index " + index + ") has no row in " + framePath);
      if (seen.has(unit)) csoFail("E_CSO_UNIT_FRAME", unit + " appears twice in the candidate order");
      seen.add(unit);
      out.push({ unit, part, index, row: row! });
    });
  return out;
}

export const advisoryUrl = (commit: string, path: string): string => "https://raw.githubusercontent.com/github/advisory-database/" + commit + "/" + path;

export type FetchText = (url: string) => Promise<{ status: number; text: string }>;
export const httpText: FetchText = async (url) => {
  const r = await fetch(url);
  return { status: r.status, text: await r.text() };
};

/** The advisory record at the pinned commit, cached under work/advisories (E_CSO_ADVISORY when it can't be read or its id
 *  is not the row's GHSA id). */
export async function readAdvisory(p: CsoPrereg, row: B2Row, work: string, get: FetchText = httpText): Promise<AdvisoryJson> {
  const cache = join(work, "advisories", row.ghsa + ".json");
  let text: string;
  if (existsSync(cache)) text = readFileSync(cache, "utf8");
  else {
    const url = advisoryUrl(String(p.pins.advisory_database.commit), row.advisory_path);
    let r: { status: number; text: string };
    try {
      r = await get(url);
    } catch (e) {
      return csoFail("E_CSO_ADVISORY", url + ": " + (e as Error).message);
    }
    if (r.status !== 200) csoFail("E_CSO_ADVISORY", url + " returned HTTP " + r.status);
    text = r.text;
  }
  let a: AdvisoryJson;
  try {
    a = JSON.parse(text) as AdvisoryJson;
  } catch {
    return csoFail("E_CSO_ADVISORY", row.ghsa + ": the advisory record is not JSON");
  }
  if (a.id?.toUpperCase() !== row.ghsa.toUpperCase()) csoFail("E_CSO_ADVISORY", row.ghsa + ": the advisory record's id is " + String(a.id));
  if (!existsSync(cache)) {
    mkdirSync(dirname(cache), { recursive: true });
    writeFileSync(cache, text);
  }
  return a;
}

export const cveIds = (a: AdvisoryJson): string[] => [...new Set((a.aliases ?? []).filter((x) => /^CVE-\d{4}-\d{4,}$/i.test(x)).map((x) => x.toUpperCase()))];
export const cweIds = (a: AdvisoryJson): string[] => [...new Set((a.database_specific?.cwe_ids ?? []).filter((x) => /^CWE-\d+$/i.test(x)).map((x) => x.toUpperCase()))];

/** Every family in prereg.json scoring.cwe_families that holds one of the ids, in the map's order. A CWE in no family
 *  gets none. */
export function cweFamilies(p: CsoPrereg, ids: readonly string[]): string[] {
  const map = (p.scoring as { cwe_families: Record<string, number[]> }).cwe_families;
  const nums = new Set(ids.map((i) => Number(i.replace(/^CWE-/i, ""))));
  return Object.entries(map).filter(([, l]) => l.some((n) => nums.has(n))).map(([f]) => f);
}

/** The advisory's affected packages and their OSV ranges, for deviation (c)'s dependency gate. */
export function unitAffected(unit: string, a: AdvisoryJson): UnitAffected {
  const affected: Affected[] = (a.affected ?? [])
    .filter((x) => x.package?.ecosystem && x.package?.name)
    .map((x) => ({ ecosystem: x.package!.ecosystem!, name: x.package!.name!, ranges: (x.ranges ?? []).filter((r) => r.type !== "GIT").map((r) => (r.events ?? []) as Affected["ranges"][number]) }));
  return { unit, affected };
}

/** Another reviewed advisory of a repository: its fix commit when a commit reference names one, else null. */
export interface RepoAdvisory { ghsa: string; summary: string; fix_commit: string | null }
export type RepoAdvisories = (repo: string) => RepoAdvisory[];

/** Every reviewed, not withdrawn advisory under an advisory-database checkout whose commit or pull references name
 *  github.com/<repo>. The checkout must sit at the pinned commit; the caller checks it. */
export function repoAdvisoriesFromDb(dbDir: string, repos: readonly string[]): RepoAdvisories {
  const want = new Set(repos.map((r) => r.toLowerCase()));
  const out = new Map<string, RepoAdvisory[]>();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        const a = JSON.parse(readFileSync(p, "utf8")) as AdvisoryJson;
        if (a.withdrawn) continue;
        const hits = new Map<string, string | null>();
        for (const r of a.references ?? []) {
          const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(commit|pull)\/([0-9a-f]{40}|\d+)/.exec(r.url ?? "");
          if (!m || !want.has(m[1].toLowerCase())) continue;
          const repo = m[1].toLowerCase();
          if (!hits.has(repo) || (hits.get(repo) === null && m[2] === "commit")) hits.set(repo, m[2] === "commit" ? m[3] : null);
        }
        for (const [repo, fix] of hits) out.set(repo, [...(out.get(repo) ?? []), { ghsa: a.id, summary: a.summary ?? "", fix_commit: fix }]);
      }
    }
  };
  walk(join(dbDir, "advisories", "github-reviewed"));
  return (repo) => out.get(repo.toLowerCase()) ?? [];
}

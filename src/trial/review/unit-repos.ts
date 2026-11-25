// Prebuilt unit repositories for review-units (--unit-repos <dir>): the review-models eval's units as gstack-evals rm-supply
// build writes them (plan 2026-11-24-geva-590-review-models-prereg, section 2; pre-run change 2, gate 4). That build
// strips each unit's executable config (.mcp.json, hooks and permissions in .claude/settings*.json) and marks the
// stripped files skip-worktree, so a unit rebuilt from its source clone would carry the config again. review-units
// therefore takes the built repository as it stands: <dir>/units.json lists each unit's UnitRepo record, and the
// repository sits at <dir>/<unit id with every character outside [A-Za-z0-9._-] as _>. A B unit (the BIC on its own
// parent) has pr 0. The units stand in for a suite with id unit-repos, held as sealed, so the run's records stay
// outside the repository: B units name their BICs.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Suite, Unit } from "../../../lanes/review-noloss/suite.ts";
import type { UnitRepo } from "./unit.ts";

export const UNIT_REPOS_SUITE = "unit-repos";

/** A units.json row as rm-supply build writes it. */
export interface BuiltRow {
  id: string;
  repo: UnitRepo;
  instructions?: unknown;
  problems: string[];
}

const UNIT_ID = /^([^/#@\s]+\/[^/#@\s]+)#(\d+)@([0-9a-f]{12})$/;

/** The repository directory of a built unit, as rm-supply build names it. */
export const builtDir = (root: string, id: string): string => join(resolve(root), id.replace(/[^A-Za-z0-9._-]/g, "_"));

/**
 * The units review-units runs from a build dir: every row when refs is ["all"], else the rows refs name by full id, in
 * refs' order. Throws on a row with build problems, an id that is not <owner/repo>#<pr>@<head12> matching its record, or
 * a missing repository directory, naming every such unit.
 */
export function loadUnitRepos(root: string, refs: readonly string[]): { suite: Suite; sha256: string; units: Unit[]; repos: Map<string, UnitRepo> } {
  const file = join(resolve(root), "units.json");
  if (!existsSync(file)) throw new Error("--unit-repos " + root + " has no units.json; pass the directory gstack-evals rm-supply build wrote");
  const text = readFileSync(file, "utf8");
  const rows = JSON.parse(text) as BuiltRow[];
  if (!Array.isArray(rows) || !rows.length) throw new Error("--unit-repos " + file + " lists no units");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unknown = refs.length === 1 && refs[0] === "all" ? [] : refs.filter((ref) => !byId.has(ref));
  if (unknown.length) throw new Error("--units: " + unknown.map((u) => JSON.stringify(u)).join(", ") + " not in " + file + "; name units by their full id");
  const picked = refs.length === 1 && refs[0] === "all" ? rows : refs.map((ref) => byId.get(ref)!);
  const problems: string[] = [];
  const units: Unit[] = [];
  const repos = new Map<string, UnitRepo>();
  for (const row of picked) {
    const m = UNIT_ID.exec(row.id);
    const dir = builtDir(root, row.id);
    const problem = !m ? "not a unit id <owner/repo>#<pr>@<first 12 of head>"
      : row.repo?.unit !== row.id || !row.repo.head?.startsWith(m[3]!) ? "its UnitRepo record names " + row.repo?.unit + " at " + row.repo?.head
      : row.problems?.length ? "the build refused it: " + row.problems.join("; ")
      : !existsSync(join(dir, ".git")) ? "no built repository at " + dir
      : null;
    if (problem) {
      problems.push(row.id + ": " + problem);
      continue;
    }
    const [, repo, pr] = m!;
    units.push({ id: row.id, repo: repo!, pr: Number(pr), head: row.repo.head, base: row.repo.base, cluster: repo + "#" + pr, group: null, blockers: [] });
    repos.set(row.id, { ...row.repo, dir });
  }
  if (problems.length) throw new Error("--unit-repos " + root + ": " + problems.length + " unit" + (problems.length === 1 ? "" : "s") + " cannot run:\n  " + problems.join("\n  "));
  if (new Set(units.map((u) => u.id)).size !== units.length) throw new Error("--units names a unit twice");
  const suite: Suite = { schema_version: 1, id: UNIT_REPOS_SUITE, title: "prebuilt unit repositories", kind: "catalog", development_only: false, purpose: "rm-supply build output", sealed: true, catalogs: [], sources: [], prereg_freezes: [], judging_rule: "none: scored outside review-units", shelf_life: { rule: "none", released: null }, groups: {}, units, ineligible: [], excluded: [], frozen_bars: [] };
  return { suite, sha256: createHash("sha256").update(text).digest("hex"), units, repos };
}

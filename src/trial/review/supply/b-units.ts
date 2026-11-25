// B units: security bug-introducing commits (plan 2026-11-24-geva-590-review-models-prereg, section 2 and section 10
// item 3). From the skill-pack head-to-head's frame (b2-frame.json), advisories published from 2026-07-01 are put in a
// seeded order (sorted by GHSA id, then a Fisher-Yates shuffle on seededRandom(draw seed)), and the first advisory of
// each repository in that order is its one advisory. For each: SZZ on the fix (szz.ts), gate 1 on the fix's dates, the
// advisory's publication and, for a fix by pull request, the PR's opening, gate 2 on the BIC's shape, and gate 4 on the
// BIC's tree. The unit is the BIC as a PR on its own parent. A record names the BIC beside its advisory, so it is an
// answer key: it is written outside the repository.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { seededRandom } from "../../../runner/stats/paired.ts";
import { buildUnitRepo, historyProblems, type UnitRef, type UnitRepo } from "../unit.ts";
import { containmentAt, CUTOFF, gate1, inventory, passed, stripExecutable, treeProblems, type Gate, type Inventory, type Needles } from "./gates.ts";
import { commitDates, defaultBranch, ensureClone, ensureObjects, gitOut, supplyFail, type CommitDates, type GithubReader } from "./git.ts";
import { bicShape, blameLines, blameTargets, gate2, nontrivial, parsePatch, pickBic, type BicPick, type BicShape } from "./szz.ts";

export const DRAW_SEED = 1872089902;

export interface FrameAdvisory {
  ghsa: string;
  advisory_path: string;
  repo: string;
  published: string;
  ecosystem: string;
  fix: { kind: string; ref: string; commit: string; parent: string };
}

/** A Fisher-Yates shuffle of items, in the order given, on seededRandom(seed). */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const a = [...items];
  const rnd = seededRandom(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** One advisory per repository, in seeded order, from the frame's advisories published on or after the cutoff. */
export function bOrder(frame: any, seed = DRAW_SEED): FrameAdvisory[] {
  if (frame?.schema !== "h2h-b2-frame.v1" || !Array.isArray(frame.advisories)) supplyFail("E_RMS_INPUT", "the frame is not an h2h-b2-frame.v1 file");
  const late = (frame.advisories as FrameAdvisory[]).filter((a) => a.published >= CUTOFF).sort((x, y) => (x.ghsa < y.ghsa ? -1 : x.ghsa > y.ghsa ? 1 : 0));
  const seen = new Set<string>();
  return seededShuffle(late, seed).filter((a) => !seen.has(a.repo) && !!seen.add(a.repo));
}

/** The advisory record (OSV JSON) at the frame's advisory-database commit, or null when it cannot be read. */
export type AdvisoryReader = (path: string) => any;
export const rawAdvisory = (commit: string): AdvisoryReader => (path) => {
  const r = spawnSync("curl", ["-fsSL", "--max-time", "60", "https://raw.githubusercontent.com/github/advisory-database/" + commit + "/" + path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? JSON.parse(r.stdout) : null;
};

export interface BRecord {
  position: number;
  ghsa: string;
  repo: string;
  ecosystem: string;
  published: string;
  fix: FrameAdvisory["fix"];
  cves: string[];
  source_files: number;
  szz: BicPick | null;
  shape: BicShape | null;
  bic_dates: CommitDates | null;
  fix_dates: CommitDates | null;
  disclosure: Record<string, string | null>;
  instructions?: Inventory;
  gates: { g1?: Gate; g2?: Gate; g4?: Gate };
  error?: string;
}

const CVE = /^CVE-\d{4}-\d+$/i;

/** SZZ and gates 1, 2 and 4 for one advisory. Gate 4 runs only on a BIC that passes gates 1 and 2. */
export function checkB(a: FrameAdvisory, position: number, o: { work: string; github: GithubReader; advisory: AdvisoryReader; url?: (repo: string) => string }): BRecord {
  const rec: BRecord = { position, ghsa: a.ghsa, repo: a.repo, ecosystem: a.ecosystem, published: a.published, fix: a.fix, cves: [], source_files: 0, szz: null, shape: null, bic_dates: null, fix_dates: null, disclosure: {}, gates: {} };
  try {
    const clone = ensureClone(o.work, a.repo, "b", o.url?.(a.repo));
    const missing = ensureObjects(clone, [a.fix.commit, a.fix.parent]);
    if (missing.length) supplyFail("E_RMS_GIT", "the clone has no commit " + missing.join(", "));
    const t = blameTargets(parsePatch(gitOut(clone, ["diff", a.fix.parent, a.fix.commit], "diff the fix")));
    rec.source_files = t.source.length;
    const deleted = blameLines(clone, a.fix.parent, t.deleted);
    const pick = pickBic(deleted, deleted.some((b) => nontrivial(b.text)) ? [] : blameLines(clone, a.fix.parent, t.beside));
    rec.szz = pick;
    rec.fix_dates = commitDates(clone, a.fix.commit);
    rec.disclosure["the advisory's publication"] = a.published;
    rec.gates.g1 = gate1(rec.fix_dates, rec.disclosure);
    if (passed(rec.gates.g1) && a.fix.kind === "pull") {
      const pr = o.github(a.repo, Number(a.fix.ref)) ?? supplyFail("E_RMS_GIT", a.ghsa + ": GitHub has no fix pull request #" + a.fix.ref);
      rec.disclosure["the fix PR's opening"] = pr.created_at;
      rec.gates.g1 = gate1(rec.fix_dates, rec.disclosure);
    }
    if (!pick.bic) {
      rec.gates.g2 = { fail: "SZZ blamed no line" };
      return rec;
    }
    rec.shape = bicShape(clone, pick.bic);
    if (rec.shape.parents) rec.bic_dates = commitDates(clone, pick.bic);
    const g2 = gate2(pick, rec.shape);
    rec.gates.g2 = g2 ? { fail: g2 } : "ok";
    if (!passed(rec.gates.g1) || !passed(rec.gates.g2)) return rec;
    const osv = o.advisory(a.advisory_path) ?? supplyFail("E_RMS_GIT", a.ghsa + ": the advisory record could not be read");
    rec.cves = (Array.isArray(osv.aliases) ? osv.aliases : []).filter((x: unknown) => typeof x === "string" && CVE.test(x));
    if (typeof osv.published === "string") rec.disclosure["the advisory record's publication"] = osv.published;
    rec.gates.g1 = gate1(rec.fix_dates, rec.disclosure);
    if (!passed(rec.gates.g1)) return rec;
    const c = containmentAt(clone, pick.bic, pick.bic + "^", bNeedles(rec), join(o.work, "wt", "b-" + a.ghsa));
    rec.instructions = c.instructions;
    rec.gates.g4 = c.g4;
  } catch (e) {
    rec.error = (e as Error).message;
  }
  return rec;
}

export const bNeedles = (rec: Pick<BRecord, "ghsa" | "cves" | "fix">): Needles => ({ strings: [rec.ghsa, ...rec.cves], fix: rec.fix.commit });

/** The unit: the BIC as a PR on its own parent. pr is 0, since no pull request exists. */
export function bUnitRef(rec: Pick<BRecord, "repo" | "szz">): UnitRef {
  const bic = rec.szz?.bic ?? supplyFail("E_RMS_INPUT", rec.repo + ": the record has no BIC");
  return { id: rec.repo + "#0@" + bic.slice(0, 12), repo: rec.repo, pr: 0, head: bic, base: bic + "^" };
}

/** Builds a unit repository with unit.ts from a full clone, takes its instruction inventory, strips executable config,
 *  then runs the history check and gate 4 on the result. The returned record is what the build writes per unit. */
export function buildChecked(o: { unit: UnitRef; source: string; dest: string; needles: Needles }): { repo: UnitRepo; instructions: Inventory; problems: string[] } {
  const repo = buildUnitRepo({ unit: o.unit, source: o.source, dest: o.dest, baseBranch: defaultBranch(o.source) });
  const instructions = inventory(o.dest, repo.merge_base);
  if (!instructions.refuse) stripExecutable(o.dest, instructions);
  return { repo, instructions, problems: [...(instructions.refuse ? [instructions.refuse] : []), ...historyProblems(o.dest, repo), ...treeProblems(o.dest, o.needles)] };
}

// P units: Harness Evals' review-real-bugs suite (g-harness-evals at 74f0de63dc, results/suite/review-real-bugs-2026-11.json),
// plan 2026-11-24-geva-590-review-models-prereg, section 2. The 101 outside bug units (S1, S2, S3) keep their suite rank;
// the 15 decoys (N) are scored only for false alarms; home-field units (H-*) are not run. A unit "ran" when Harness Evals'
// stage 1 suite lists it.
//
// The fix commit is found from the pull request's commit list on GitHub: for S1 and S2, the first commit after the
// unit's head that changes a path the blocker names (the commit that followed the review comment); for S3, the first
// commit of the later fix PR (the evidence link) that changes such a path. Disclosure is the evidence's own date: the
// review comment for S1 and S2, the fix PR's opening for S3. When GitHub no longer serves the review comment, the PR's own
// opening stands in, since no comment on the PR can predate it. A decoy has no fix, so its gate 1 reads its head commit.
import { join } from "node:path";
import { containmentAt, gate1, type Gate } from "./gates.ts";
import { changedPaths, commitDates, ensureClone, ensureObjects, hasCommit, supplyFail, type CommitDates, type GithubReader } from "./git.ts";

export const SUITE_NAME = "review-real-bugs";

export interface PUnit {
  id: string;
  repo: string;
  pr: number;
  head: string;
  base: string;
  group: string;
  /** Suite rank; null for a decoy. */
  rank: number | null;
  decoy: boolean;
  /** Harness Evals ran it (its stage 1 suite lists it). */
  ran: boolean;
  evidence: string;
  paths: string[];
  cases: string[];
}

export interface PRecord extends PUnit {
  fix: { commit: string; pr: number; dates: CommitDates } | null;
  head_dates: CommitDates | null;
  disclosure: Record<string, string | null>;
  gates: { g1?: Gate; g4?: Gate };
  error?: string;
}

/** The suite's outside bug units in rank order, then its decoys by id. Home-field units are left out. */
export function readSuite(suite: any, stage1: any): PUnit[] {
  if (!Array.isArray(suite?.units) || !Array.isArray(stage1?.units)) supplyFail("E_RMS_INPUT", "the suite and its stage 1 suite need a units array");
  const ran = new Set<string>(stage1.units.map((u: any) => u.id));
  const out: PUnit[] = [];
  for (const u of suite.units) {
    if (String(u.group).startsWith("H-")) continue;
    const decoy = u.group === "N";
    if (!decoy && !Number.isInteger(u.rank)) supplyFail("E_RMS_INPUT", u.id + " is a bug unit with no rank");
    const blockers = Array.isArray(u.blockers) ? u.blockers : [];
    out.push({ id: u.id, repo: u.repo, pr: u.pr, head: u.head, base: u.base, group: u.group, rank: decoy ? null : u.rank, decoy, ran: ran.has(u.id), evidence: u.evidence, paths: [...new Set<string>(blockers.flatMap((b: any) => b.paths ?? []))], cases: blockers.map((b: any) => b.case).filter(Boolean) });
  }
  return out.sort((a, b) => (a.decoy !== b.decoy ? (a.decoy ? 1 : -1) : a.decoy ? a.id.localeCompare(b.id) : a.rank! - b.rank!));
}

/** Gates 1 and 4 for one P unit. A read that fails is the record's error, never a pass. */
export function checkP(u: PUnit, o: { work: string; github: GithubReader; url?: (repo: string) => string }): PRecord {
  const rec: PRecord = { ...u, fix: null, head_dates: null, disclosure: {}, gates: {} };
  try {
    const clone = ensureClone(o.work, u.repo, "p", o.url?.(u.repo));
    const missing = ensureObjects(clone, [u.head, u.base]);
    if (missing.length) supplyFail("E_RMS_GIT", "the clone has no commit " + missing.join(", "));
    rec.head_dates = commitDates(clone, u.head);
    if (u.decoy) {
      rec.gates.g1 = gate1(rec.head_dates, {});
    } else {
      const s3 = u.group === "S3";
      const fixPr = s3 ? Number(u.evidence.match(/\/pull\/(\d+)/)?.[1] ?? supplyFail("E_RMS_INPUT", u.id + ": the S3 evidence names no fix PR")) : u.pr;
      ensureObjects(clone, ["refs/pull/" + fixPr + "/head"]);
      const facts = o.github(u.repo, fixPr) ?? supplyFail("E_RMS_GIT", u.id + ": GitHub has no pull request #" + fixPr);
      const at = facts.commits.indexOf(u.head);
      const after = s3 ? facts.commits : at >= 0 ? facts.commits.slice(at + 1) : facts.commits.filter((s) => hasCommit(clone, s) && Date.parse(commitDates(clone, s).committer) > Date.parse(rec.head_dates!.committer));
      const fix = after.find((s) => hasCommit(clone, s) && changedPaths(clone, s).some((p) => u.paths.includes(p)));
      if (fix) rec.fix = { commit: fix, pr: fixPr, dates: commitDates(clone, fix) };
      const comment = s3 ? undefined : facts.comments[u.evidence.match(/#discussion_r(\d+)/)?.[1] ?? ""];
      if (s3) rec.disclosure["the fix PR's opening"] = facts.created_at;
      else if (comment) rec.disclosure["the review comment"] = comment;
      else rec.disclosure["the PR's opening (no readable review comment)"] = facts.created_at;
      rec.gates.g1 = rec.fix ? gate1(rec.fix.dates, rec.disclosure) : { fail: "no commit " + (s3 ? "in fix PR #" + fixPr : "after the head") + " changes a path the blocker names" };
    }
    rec.gates.g4 = containmentAt(clone, u.head, { strings: [SUITE_NAME, ...u.cases], fix: rec.fix?.commit ?? null }, join(o.work, "wt", "p-" + u.repo.replace("/", "__") + "-" + u.pr));
  } catch (e) {
    rec.error = (e as Error).message;
  }
  return rec;
}

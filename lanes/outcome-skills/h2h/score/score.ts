// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7 for one head-to-head session: the session end rules, the tree capture (rule 1), the drop at the fix's
// new test paths (rule 3), the reused first-stage scorer with one retry on an infra gap, the primary verified-correct
// fix and the readings beside it, the worktree secondary and the lines secondary.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { scoreFirst as realScoreFirst, type OutcomeRecord, type ScoreInput } from "../../statemachines/score.ts";
import { readUnit } from "../../statemachines/unit.ts";
import { H2hError, h2hFail } from "../prereg.ts";
import { ALL_ARMS, type H2hScore, type H2hSession } from "../types.ts";
import { dropAtPaths, lineCounts, newTestPaths } from "./rules.ts";
import { openTree } from "./tree.ts";

export type ScoreFirst = (i: ScoreInput) => OutcomeRecord;
export interface ScoreOptions {
  /** The session's base commit; defaults to the session record's base_head. */
  base?: string;
  scoreFirst?: ScoreFirst;
}
export interface ScoredSession {
  score: H2hScore;
  /** Warning lines, each starting with its reason code. */
  warnings: string[];
  main: OutcomeRecord | null;
  candidates: { source: string; record: OutcomeRecord | null; gap: string | null }[];
}

const SESSION_ID = (s: H2hSession) => s.unit + "/" + s.arm + "/" + s.stage + "/" + s.index;

/** The session's repository dir: tree_bundle as a directory, or a tar extracted into work. */
export function sessionTree(recordDir: string, rel: string, work: string): string {
  if (!rel || isAbsolute(rel) || rel.split("/").includes("..")) h2hFail("E_H2H_SCORE_INPUT", "tree_bundle must be a relative path inside the record dir, not " + JSON.stringify(rel));
  const path = join(recordDir, rel);
  if (!existsSync(path)) h2hFail("E_H2H_SCORE_INPUT", path + " does not exist");
  if (statSync(path).isDirectory()) return path;
  if (!/\.(tar|tar\.gz|tgz)$/.test(path)) h2hFail("E_H2H_SCORE_INPUT", path + " is neither a directory nor a .tar, .tar.gz or .tgz file");
  const dir = join(work, "tree");
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("tar", ["-xf", path, "-C", dir, "--no-same-owner", "--no-same-permissions"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" } });
  if (r.status !== 0) h2hFail("E_H2H_SCORE_INPUT", path + " does not extract: " + (r.stderr ?? "").slice(-300));
  const names = readdirSync(dir);
  if (!names.includes(".git") && names.length === 1 && lstatSync(join(dir, names[0]!)).isDirectory()) return join(dir, names[0]!);
  return dir;
}

function scoreWithRetry(fn: ScoreFirst, i: ScoreInput): { record: OutcomeRecord | null; gap: string | null } {
  for (let attempt = 1; ; attempt++)
    try {
      return { record: fn(i), gap: null };
    } catch (e) {
      if (!(e as Error).message.startsWith("E_SM_INFRA_GAP")) throw e;
      if (attempt === 2) return { record: null, gap: "E_SM_INFRA_GAP" };
    }
}

const verifiedOf = (r: OutcomeRecord | null) => !!r && r.codes.strict !== "E_SM_TEST_PATCH_CONFLICT" && r.strict.outcome === "clean_fix";

/** Scores one session from its record dir against the unit's sm-unit.v1 dir. */
export function scoreSession(session: H2hSession, recordDir: string, unitDir: string, o: ScoreOptions = {}): ScoredSession {
  if (session?.schema !== "h2h-session.v1") h2hFail("E_H2H_SCORE_INPUT", "the session record is not h2h-session.v1");
  if (!(ALL_ARMS as readonly string[]).includes(session.arm)) h2hFail("E_H2H_SCORE_INPUT", "unknown arm " + JSON.stringify(session.arm));
  const u = readUnit(unitDir);
  if (u.id !== session.unit) h2hFail("E_H2H_SCORE_INPUT", "the session is for " + session.unit + ", the unit dir holds " + u.id);
  const blank: H2hScore = {
    schema: "h2h-score.v1", unit: session.unit, arm: session.arm, stage: session.stage, outcome: null, verified: false, verified_without_new_test_rule: false,
    adapted_verified: null, gap: null, dropped_arm_tests: [], worktree_pass: null, lines_changed: 0, planning_lines: 0,
  };
  const done = (score: H2hScore): ScoredSession => ({ score, warnings: [], main: null, candidates: [] });
  if (session.gap) return done({ ...blank, gap: session.gap });
  if (session.end === "safety_stop") return done({ ...blank, outcome: "no_fix", adapted_verified: false });
  if (session.end === "cap_stop") return done({ ...blank, gap: "CAP_STOP" });
  if (session.end === "upstream" || session.end === "infra") h2hFail("E_H2H_SCORE_INPUT", SESSION_ID(session) + " ended " + session.end + " with no gap code; part S's retry rule leaves a gap or a later session");
  const base = o.base ?? session.base_head ?? h2hFail("E_H2H_SCORE_INPUT", SESSION_ID(session) + " has no base_head; pass --base");
  const fn = o.scoreFirst ?? realScoreFirst;
  const work = mkdtempSync(join(tmpdir(), "h2h-score-"));
  try {
    const repo = sessionTree(recordDir, session.tree_bundle, work);
    let tree: ReturnType<typeof openTree>;
    try {
      tree = openTree(repo, base, { containerRepoDir: u.repo_dir });
    } catch (e) {
      if (e instanceof H2hError && e.code === "E_H2H_SCORE_CAPTURE") return { ...done({ ...blank, gap: "E_H2H_SCORE_CAPTURE" }), warnings: [e.message] };
      throw e;
    }
    try {
      const paths = newTestPaths(unitDir, u);
      let n = 0;
      const run = (patch: string, label: string) => {
        const file = join(work, "change-" + ++n + ".patch");
        writeFileSync(file, patch);
        return scoreWithRetry(fn, { unitDir, patchFile: file, cell: session.arm, model: session.model, session: SESSION_ID(session) + (label ? " " + label : "") });
      };
      const main = dropAtPaths(tree.main.patch, paths);
      const lines = lineCounts(main.patch, u.lang, u.test_patch.files, tree.readBase);
      const scored = run(main.patch, "");
      const candidates = tree.candidates.map((c) => ({ source: c.source, ...run(dropAtPaths(c.patch, paths).patch, c.source) }));
      const passes = candidates.map((c) => verifiedOf(c.record));
      const worktree_pass = !candidates.length ? null : passes.some(Boolean) ? true : candidates.some((c) => c.gap || c.record?.codes.strict === "E_SM_TEST_PATCH_CONFLICT") ? null : false;
      const warnings = [
        ...main.dropped.map((p) => "E_H2H_SCORE_ARM_TEST_DROPPED " + SESSION_ID(session) + " dropped " + p),
        ...tree.nested_left_out.map((d) => "E_H2H_SCORE_NESTED_WORKTREE " + SESSION_ID(session) + " left out " + d),
      ];
      const extra = { nested_left_out: tree.nested_left_out, worktree_candidates: candidates.map((c, k) => ({ source: c.source, verified: passes[k]!, gap: c.gap ?? c.record?.codes.strict ?? null })) };
      const common = { ...blank, ...extra, dropped_arm_tests: main.dropped, worktree_pass, lines_changed: lines.lines, planning_lines: lines.planning };
      const rec = scored.record;
      if (!rec) return { score: { ...common, gap: scored.gap }, warnings, main: null, candidates };
      if (rec.codes.strict === "E_SM_TEST_PATCH_CONFLICT") return { score: { ...common, gap: "E_SM_TEST_PATCH_CONFLICT" }, warnings, main: rec, candidates };
      const s = rec.strict;
      const by = s.broke_by;
      return {
        score: {
          ...common, outcome: s.outcome, verified: s.outcome === "clean_fix",
          verified_without_new_test_rule: s.fixed === true && !s.apply_failed && !!by && !by.stable_missing.length && !by.stable_failed.length,
          adapted_verified: rec.adapted.gap ? null : rec.adapted.outcome === "clean_fix",
        },
        warnings, main: rec, candidates,
      };
    } finally {
      tree.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

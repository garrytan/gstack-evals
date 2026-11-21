// Copyright (c) 2026 Garry Tan. MIT License.
// The tests-added records section 9 reads (ext/analysis.ts testsRecord, h2hx-tests.v1), built beside each session's score.
// The change is the session's whole extracted change from its tree (score/tree.ts openTree against the record's
// base_head), before the strict reading reverts edits to existing test files and before rule 3's drop at the fix's new
// test paths; the hidden test files are those the unit's test.patch touches (sm-unit.v1 test_patch.files); base files are
// read from the base commit in the captured tree. A scored gap has no record. A safety stop that left no tree added no
// test; any other scored session needs its tree and base (E_H2H_SCORE_INPUT).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUnit } from "../../statemachines/unit.ts";
import { h2hFail } from "../prereg.ts";
import { sessionTree } from "../score/score.ts";
import { openTree } from "../score/tree.ts";
import type { H2hScore } from "../types.ts";
import { testsRecord, type ExtTests } from "./analysis.ts";
import type { ExtSessionRecord } from "./session.ts";

/** One scored session's tests-added record, or null when its score is a gap. */
export function extTests(session: Pick<ExtSessionRecord, "unit" | "arm" | "stage" | "index" | "end" | "tree_bundle" | "base_head">, score: Pick<H2hScore, "gap">, recordDir: string, unitDir: string): ExtTests | null {
  if (score.gap !== null) return null;
  const id = session.unit + "/" + session.arm + "/" + session.stage + "/" + session.index;
  const u = readUnit(unitDir);
  if (u.id !== session.unit) h2hFail("E_H2H_SCORE_INPUT", "the session is for " + session.unit + ", the unit dir holds " + u.id);
  const tree = existsSync(join(recordDir, session.tree_bundle)) && session.base_head;
  if (!tree && session.end === "safety_stop") return { schema: "h2hx-tests.v1", unit: session.unit, arm: session.arm, stage: session.stage, added: false, recount: false, lines: 0 };
  if (!tree) h2hFail("E_H2H_SCORE_INPUT", id + " is scored but has no tree " + session.tree_bundle + " or base_head to read its tests from");
  const work = mkdtempSync(join(tmpdir(), "h2hx-tests-"));
  try {
    const t = openTree(sessionTree(recordDir, session.tree_bundle, work), session.base_head!, { containerRepoDir: u.repo_dir });
    try {
      return testsRecord({ unit: session.unit, arm: session.arm, stage: session.stage, patch: t.main.patch, lang: u.lang, testFiles: u.test_patch.files, readBase: t.readBase });
    } finally {
      t.close();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

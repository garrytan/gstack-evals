// Copyright (c) 2026 Garry Tan. MIT License.
// h2h score: scores one session record (plan section 7) and writes its h2h-score.v1 record.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseFlags, type Command } from "../cli.ts";
import { h2hFail } from "../prereg.ts";
import type { H2hSession } from "../types.ts";
import { scoreSession } from "./score.ts";

const HELP = `Usage: gstack-evals h2h score --session <session.json> --unit-dir <sm-unit dir> --out <score.json> [--record-dir <dir>] [--base <sha>] [--detail <file>]
Scores one session (plan section 7): the main checkout's change against base, nested worktree dirs left out, arm files at
the fix's new test paths dropped, the first-stage scorer's strict and adapted readings, the worktree secondary and the
lines secondary. --record-dir defaults to the session file's dir; --base defaults to the record's base_head. --detail
writes the scorer's sm-outcome.v1 records. Neither output file may exist.`;

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    return h2hFail("E_H2H_SCORE_INPUT", path + " is not readable JSON: " + (e as Error).message);
  }
}

function writeNew(path: string, text: string): void {
  try {
    writeFileSync(path, text, { flag: "wx" });
  } catch (e) {
    h2hFail("E_USAGE", path + " cannot be written as a new file: " + (e as Error).message);
  }
}

const score: Command = async (argv) => {
  const f = parseFlags(argv, ["--session", "--unit-dir", "--out", "--record-dir", "--base", "--detail"], [], HELP);
  if (!f) return 0;
  const sessionFile = f.need("--session");
  const r = scoreSession(readJson<H2hSession>(sessionFile), f.one("--record-dir") ?? dirname(sessionFile), f.need("--unit-dir"), { base: f.one("--base") });
  for (const w of r.warnings) console.error(w);
  writeNew(f.need("--out"), JSON.stringify(r.score, null, 2) + "\n");
  const detail = f.one("--detail");
  if (detail) writeNew(detail, JSON.stringify({ main: r.main, candidates: r.candidates }, null, 2) + "\n");
  const s = r.score;
  console.log("h2h score: " + s.unit + " " + s.arm + " outcome=" + s.outcome + " verified=" + s.verified + " gap=" + s.gap + " worktree_pass=" + s.worktree_pass + " lines=" + s.lines_changed);
  return 0;
};

export const commands: Record<string, Command> = { score };

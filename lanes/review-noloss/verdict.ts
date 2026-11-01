// Copyright (c) 2026 Garry Tan. MIT License.
// Reads a noloss score run the way verification must (GEVA-59 T7): from its verdict line, or its JSON record, and the
// first reason code on stderr. Exit 2 alone means nothing: it covers NOT_DISTINGUISHED, a NO_LOSS below or without the
// size rule (NOLOSS_UNDERPOWERED), no verdict and every refusal. The reader also checks that the exit code agrees.
import { ScoreError, type ScoreRecord } from "./score.ts";
import type { Verdict } from "./stats.ts";

/** The tokens --expect accepts besides a refusal's reason code. */
export const OUTCOMES = ["LOSS", "NOT_DISTINGUISHED", "NO_LOSS", "NOLOSS_UNDERPOWERED", "NO_VERDICT", "FALSE_ALARM_GATE_FAIL"];

export interface ScoreReading {
  kind: "verdict" | "no_verdict" | "refusal";
  verdict: Verdict | null;
  /** NO_LOSS with the size rule met: the only outcome that is a no-loss claim. */
  claim: boolean;
  /** LOSS (or FALSE_ALARM_GATE_FAIL for a LOSS whose false-alarm gate did not pass), NOT_DISTINGUISHED or NOLOSS_UNDERPOWERED for a verdict, the first reason code of a refusal, else null. */
  code: string | null;
  /** What --expect matches: the code, NO_LOSS for a claim, NO_VERDICT for no verdict. */
  key: string;
}

/** The last line of score's text output: the verdict and any warning code. */
export const verdictLine = (rec: ScoreRecord) => "verdict: " + (rec.result.verdict ?? "none") + (rec.warnings.length ? " " + rec.warnings.join(" ") : "");

export function readScoreRun(run: { exit: number; stdout: string; stderr: string }): ScoreReading {
  const unreadable = (why: string): never => {
    throw new ScoreError("E_NOLOSS_EXPECT", "the score run cannot be read as an outcome: " + why);
  };
  let verdict: Verdict | null | undefined;
  let warnings: string[] = [];
  const text = run.stdout.trim();
  if (text.startsWith("{")) {
    let rec: ScoreRecord | undefined;
    try {
      rec = JSON.parse(text);
    } catch {
      unreadable("stdout opens like JSON but does not parse");
    }
    if (rec?.record !== "noloss-score") unreadable("stdout is JSON but not a noloss-score record");
    verdict = rec!.result.verdict;
    warnings = rec!.warnings;
  } else {
    const m = /^verdict: (LOSS|NOT_DISTINGUISHED|NO_LOSS|none)((?: [A-Z_]+)*)$/m.exec(run.stdout);
    if (m) {
      verdict = m[1] === "none" ? null : (m[1] as Verdict);
      warnings = m[2]!.trim().split(" ").filter(Boolean);
    }
  }
  if (verdict === undefined) {
    const code = /^(E_[A-Z0-9_]+)\b/.exec(run.stderr.trimStart())?.[1];
    if (!code) return unreadable("stdout has no verdict line and stderr opens with no reason code");
    if (run.exit !== 2) unreadable("a refusal exits 2, not " + run.exit);
    return { kind: "refusal", verdict: null, claim: false, code, key: code };
  }
  const underpowered = warnings.includes("NOLOSS_UNDERPOWERED");
  const claim = verdict === "NO_LOSS" && !underpowered;
  const exit = verdict === "LOSS" ? 1 : claim ? 0 : 2;
  if (run.exit !== exit) unreadable("verdict " + (verdict ?? "none") + (underpowered ? " NOLOSS_UNDERPOWERED" : "") + " exits " + exit + ", not " + run.exit);
  const code = verdict === "NO_LOSS" ? (underpowered ? "NOLOSS_UNDERPOWERED" : null) : verdict === "LOSS" && warnings.includes("FALSE_ALARM_GATE_FAIL") ? "FALSE_ALARM_GATE_FAIL" : verdict;
  return { kind: verdict === null ? "no_verdict" : "verdict", verdict, claim, code, key: code ?? (claim ? "NO_LOSS" : "NO_VERDICT") };
}

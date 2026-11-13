// Copyright (c) 2026 Garry Tan. MIT License.
// Harness mechanics post-run judge check (README "Not built", pieces 3 and 4): journalCheck over the judge metering proxy's
// journal (out/judge-journal.ndjson) and jevChanges across every judge session's hook log. The launcher's judge path
// (quick/laneb/runner/agent/laneb_hooks.py) copies each session's hook log to evaluator/judge-hooks.jsonl and its meter to
// evaluator/judge-meter.json, so this reads pulled evidence the agent never trusted, the way table.ts reads the trial dirs.
// It lives apart from judge.ts because judge.ts is bundled into the judge tar (build.sh facts.js) and leak.ts, where
// journalCheck lives, pulls in the metering proxy.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { jevChanges, readHookLog, type HookLine, type HookSession } from "./judge.ts";
import { journalCheck, type JournalCheck } from "./leak.ts";

export type JevChange = { arm: string; model: string; task: string; trial: string; lines: HookLine[] };
export type JudgeRunCheck = { pass: boolean; custody_hits: number; marker_hits: number; custody: JournalCheck; jev_changes: JevChange[]; sessions: number; detail: string };

const readJson = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** One HookSession per judge trial dir, its hook log from evaluator/judge-hooks.jsonl (null when the copy is missing) and
 * its meter id from evaluator/judge-meter.json, so judge.ts judgeColumns can read the same sessions. */
export function readJudgeSessions(jobDirs: string[], journalPath: string): HookSession[] {
  const out: HookSession[] = [];
  for (const dir of jobDirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const d = join(dir, name);
      if (!statSync(d).isDirectory()) continue;
      const config = readJson(join(d, "config.json"));
      const kwargs = config?.agent?.kwargs ?? {};
      const arm = String(kwargs.arm ?? "");
      if (!arm.startsWith("judge")) continue;
      const result = readJson(join(d, "result.json"));
      const task = String(config?.task?.path ?? result?.task_name ?? "").split("/").filter(Boolean).at(-1) ?? "?";
      const trial = String(result?.trial_name ?? name);
      const logFile = join(d, "evaluator", "judge-hooks.jsonl");
      const meter = readJson(join(d, "evaluator", "judge-meter.json"));
      out.push({ arm, model: String(kwargs.upstream_model ?? "?"), task, trial, log: existsSync(logFile) ? readFileSync(logFile, "utf8") : null, journal: journalPath, meter_id: String(meter?.meter_id ?? "") });
    }
  }
  return out;
}

/** The post-run check: journalCheck over the judge journal (custody_hits must be 0, marker_hits counted) and any jevChanges
 * line across all judge sessions' hook logs. pass is false on a custody hit, a missing journal, or any jevChanges line. */
export function judgeRunCheck(journalPath: string, sessions: HookSession[]): JudgeRunCheck {
  const custody = journalCheck(journalPath);
  const jev_changes: JevChange[] = [];
  for (const s of sessions) {
    if (!s.arm.startsWith("judge")) continue;
    const changed = jevChanges(readHookLog(s.log).lines);
    if (changed.length) jev_changes.push({ arm: s.arm, model: s.model, task: s.task, trial: s.trial, lines: changed });
  }
  const pass = custody.pass && jev_changes.length === 0;
  const detail =
    custody.detail +
    "; jevChanges in " +
    jev_changes.length +
    " judge session(s)" +
    (jev_changes.length ? " (" + jev_changes.map((j) => j.arm + "/" + j.task + "/" + j.trial).slice(0, 5).join(", ") + ")" : "");
  return { pass, custody_hits: custody.custody_hits, marker_hits: custody.marker_hits, custody, jev_changes, sessions: sessions.length, detail };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// Harness mechanics post-run judge check, per part: journalCheck over the part's judge metering proxy journal
// (out/judge-journal.ndjson) and jevChanges across every judge session's hook log, plus the journal's judge spend. The
// launcher's judge path (quick/laneb/runner/agent/laneb_hooks.py) copies each session's hook log to
// evaluator/judge-hooks.jsonl and its meter to evaluator/judge-meter.json, so this reads pulled evidence the agent never
// trusted, the way table.ts reads the trial dirs. It fails closed: no judge session, no job dir, or a judge session with no
// readable hook log is a FAIL with its reason. The smoke part (pins.ts SMOKE_PART) is checked like any judge part and named
// apart, since section 11 never reads it. It lives apart from judge.ts because judge.ts is bundled into the judge tar
// (build.sh facts.js) and leak.ts, where journalCheck lives, pulls in the metering proxy.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { jevChanges, readHookLog, type HookLine, type HookSession } from "./judge.ts";
import { journalCheck, type JournalCheck } from "./leak.ts";
import { section11Excluded } from "./pins.ts";

export type JevChange = { arm: string; model: string; task: string; trial: string; lines: HookLine[] };
export type JudgeSpend = { measured_usd: number; unknown_count: number; unknown_usd: number };
export type JudgeRunCheck = JudgeSpend & { pass: boolean; custody_hits: number; marker_hits: number; custody: JournalCheck; jev_changes: JevChange[]; sessions: number; missing_logs: number; detail: string };
export type JudgePartCheck = JudgeRunCheck & { part: string; section11: boolean };

const readJson = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const readText = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

/** One HookSession per judge trial dir, its hook log from evaluator/judge-hooks.jsonl (null when the copy is missing or
 * unreadable) and its meter id from evaluator/judge-meter.json, so judge.ts judgeColumns can read the same sessions. A job
 * dir that does not exist is an error, never an empty part. */
export function readJudgeSessions(jobDirs: string[], journalPath: string): HookSession[] {
  const out: HookSession[] = [];
  for (const dir of jobDirs) {
    if (!existsSync(dir)) throw new Error("E_USAGE judge-check: job dir " + dir + " does not exist");
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
      const meter = readJson(join(d, "evaluator", "judge-meter.json"));
      out.push({ arm, model: String(kwargs.upstream_model ?? "?"), task, trial, log: readText(join(d, "evaluator", "judge-hooks.jsonl")), journal: journalPath, meter_id: String(meter?.meter_id ?? "") });
    }
  }
  return out;
}

/** A judge journal's money, from its outcome lines: measured_usd sums the spent outcomes, and unknown_count and
 * unknown_usd count the calls whose outcome is unknown, or whose request has no outcome line, at their reserved maximum,
 * where D1 settles them on the ledger. A line that does not parse is skipped. */
export function journalSpend(path: string): JudgeSpend {
  const max = new Map<string, number>(), outcomes = new Map<string, { kind?: string; spent_micros?: number }>();
  for (const l of existsSync(path) ? readFileSync(path, "utf8").split("\n") : []) {
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    if (e?.kind === "request" && typeof e.reservation_id === "string") max.set(e.reservation_id, Number(e.max_micros) || 0);
    if (e?.kind === "outcome" && typeof e.reservation_id === "string") outcomes.set(e.reservation_id, e.outcome ?? {});
  }
  let measured = 0, unknown = 0, unknownMicros = 0;
  for (const [rid, o] of outcomes) {
    if (o.kind === "spent") measured += Number(o.spent_micros) || 0;
    else { unknown++; unknownMicros += max.get(rid) ?? 0; }
  }
  for (const [rid, m] of max) if (!outcomes.has(rid)) { unknown++; unknownMicros += m; }
  return { measured_usd: measured / 1e6, unknown_count: unknown, unknown_usd: unknownMicros / 1e6 };
}

/** The post-run check over one part's journal and judge sessions: journalCheck (custody_hits must be 0, marker_hits
 * counted), any jevChanges line across the sessions' hook logs, and the journal's spend. pass is false on a custody hit, a
 * missing journal, any jevChanges line, no judge session, or a judge session with no readable hook log. */
export function judgeRunCheck(journalPath: string, sessions: HookSession[]): JudgeRunCheck {
  const custody = journalCheck(journalPath);
  const jev_changes: JevChange[] = [];
  let missing_logs = 0;
  for (const s of sessions) {
    if (!s.arm.startsWith("judge")) continue;
    const log = readHookLog(s.log);
    if (!log.ok) missing_logs++;
    const changed = jevChanges(log.lines);
    if (changed.length) jev_changes.push({ arm: s.arm, model: s.model, task: s.task, trial: s.trial, lines: changed });
  }
  const judged = sessions.filter((s) => s.arm.startsWith("judge")).length;
  const why = [...(judged ? [] : ["no judge session"]), ...(missing_logs ? [missing_logs + " judge session(s) with no readable hook log (evaluator/judge-hooks.jsonl)"] : [])];
  const pass = custody.pass && jev_changes.length === 0 && !why.length;
  const detail =
    custody.detail +
    "; jevChanges in " +
    jev_changes.length +
    " judge session(s)" +
    (jev_changes.length ? " (" + jev_changes.map((j) => j.arm + "/" + j.task + "/" + j.trial).slice(0, 5).join(", ") + ")" : "") +
    why.map((w) => "; " + w).join("");
  return { pass, custody_hits: custody.custody_hits, marker_hits: custody.marker_hits, custody, jev_changes, sessions: judged, missing_logs, ...journalSpend(journalPath), detail };
}

/** hm judge-check <work>: judgeRunCheck per launched judge part of a work dir, its relaunch and its attempt 2 each a part of
 * its own, over the part's pulled results (pulled/out/judge-journal.ndjson and every job dir under pulled/jobs). A part with
 * no pulled jobs dir fails. section11 is false for the smoke part, which is checked but never a section 11 input. */
export function judgePartsCheck(work: string): { pass: boolean; parts: JudgePartCheck[]; unlaunched: string[]; detail: string } {
  const plan = JSON.parse(readFileSync(join(work, "plan.json"), "utf8"));
  const names = (plan.parts ?? []).flatMap((p: { name: string }) => [p.name, p.name + "-relaunch", p.name + "-a2"]).filter((n: string) => existsSync(join(work, n, "l1-part.json")));
  const parts: JudgePartCheck[] = [], unlaunched: string[] = [];
  for (const name of names as string[]) {
    const part = readJson(join(work, name, "l1-part.json"));
    if (!(part?.rects ?? []).some((r: { arms?: string[] }) => (r.arms ?? []).some((a) => a.startsWith("judge")))) continue;
    if (!existsSync(join(work, name + ".launch.json"))) { unlaunched.push(name); continue; }
    const pulled = join(work, name, "pulled"), jobs = join(pulled, "jobs"), journal = join(pulled, "out", "judge-journal.ndjson");
    const c = existsSync(jobs)
      ? judgeRunCheck(journal, readJudgeSessions(readdirSync(jobs).map((j) => join(jobs, j)).filter((d) => statSync(d).isDirectory()), journal))
      : { ...judgeRunCheck(journal, []), pass: false, detail: "no pulled jobs dir at " + jobs };
    parts.push({ ...c, part: name, section11: !section11Excluded(name) });
  }
  const why = parts.length ? parts.filter((p) => !p.pass).map((p) => p.part + " failed") : ["no launched judge part to check"];
  return { pass: !why.length, parts, unlaunched, detail: why.join("; ") };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// Unit 7's judge-row columns and the done hook's facts (prereg sections 8 and 13). "bun judge.ts facts <transcript>" prints
// what hm_judge.py's Stop entry reads: the claim, the last check after the last edit (score.ts lastRun, so the hook and the
// scorer read it the same way) with its error flag, the final text and the edited files. judgeColumns fills hook_time_s,
// hook_cost_usd, hook_log, fail_open and escalations on judge rows from each session's hook log and the hook proxy's
// journal, on the pattern of picker.ts pickerColumns. The proxy journal has no journal_id, so a log line's journal_id is
// the reservation_ids of its calls, taken in order from the session meter's request lines.
import { existsSync, readFileSync } from "node:fs";
import type { HmRowIn } from "./analyze.ts";
import { claimOf, lastRun } from "./score.ts";
import { parseTranscript, turnEnd } from "./vendor/gstack/lib/skill-contract.ts";

export const JEV_MODEL = "jev-1.13.0";

export type DoneFacts = { claims_done: boolean; claim: string | null; final_text: string | null; check: { cmd: string; output: string; is_error: boolean } | null; edited_files: string[] };

export function doneFacts(transcript: string): DoneFacts {
  const t = parseTranscript(transcript), r = lastRun(t), c = r.ran.at(-1), text = turnEnd(t).finalText?.text ?? null, claim = claimOf(text);
  return { claims_done: claim.claims_done, claim: claim.claim, final_text: text, check: c ? { cmd: c.cmd, output: c.result, is_error: c.error } : null, edited_files: r.files };
}

export type HookLine = {
  point: "done" | "risky"; rule: string | null; backend: "jev" | "p1" | null; p_jev: number | null; escalated: boolean; answer: string | null; acted: boolean;
  latency_ms: number; calls: number | null; req_digest: string | null; journal_id: string[] | null; fail_open: boolean; error: string | null; jev_version: string | null;
};
export type HookSession = { arm: string; model: string; task: string; trial: string; log: string | null; journal: string; meter_id: string };

/** A session's hook log: ok only when the log exists and every line parses. */
export function readHookLog(text: string | null): { lines: HookLine[]; ok: boolean } {
  if (text === null) return { lines: [], ok: false };
  const lines: HookLine[] = [];
  let ok = true;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try { lines.push(JSON.parse(l)); } catch { ok = false; }
  }
  return { lines, ok };
}

/** One meter's request reservation_ids in journal order and its spend: settled micros, and an unknown outcome at its reserved worst case. */
export function meterJournal(path: string, meterId: string): { requests: string[]; spent_micros: number } {
  const requests: string[] = [], max = new Map<string, number>();
  let spent = 0;
  if (!existsSync(path)) return { requests, spent_micros: 0 };
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const e = JSON.parse(l);
    if (e.kind === "request" && e.cell?.meter_id === meterId) { requests.push(e.reservation_id); max.set(e.reservation_id, e.max_micros); }
    if (e.kind === "outcome" && e.meter_id === meterId) spent += e.outcome?.kind === "spent" ? e.outcome.spent_micros : (max.get(e.reservation_id) ?? 0);
  }
  return { requests, spent_micros: spent };
}

/** journal_id per line: its calls' reservation_ids in order. After a line whose call count is unknown (a timeout), later ids are unknown too. */
export function withJournalIds(lines: HookLine[], requests: string[]): HookLine[] {
  let i = 0, lost = false;
  return lines.map((l) => {
    if (l.calls === 0) return { ...l, journal_id: null };
    if (lost || l.calls === null) { lost = true; return { ...l, journal_id: null }; }
    const ids = requests.slice(i, i + l.calls);
    i += l.calls;
    return { ...l, journal_id: ids };
  });
}

/** Lines whose Jev response carried a version other than the pin: any one stops the judge arms. */
export const jevChanges = (lines: HookLine[]) => lines.filter((l) => l.jev_version !== null && l.jev_version !== JEV_MODEL);

/** The judge columns, and the hook spend added to cost_usd, on each judge row that has a hook session for its arm, model, task and trial; other rows unchanged. */
export function judgeColumns(rows: HmRowIn[], sessions: HookSession[]): HmRowIn[] {
  const key = (r: { arm: string; model: string; task: string; trial: string }) => r.arm + "|" + r.model + "|" + r.task + "|" + r.trial;
  const by = new Map(sessions.map((s) => [key(s), s]));
  return rows.map((r) => {
    const s = r.arm.startsWith("judge") ? by.get(key(r)) : undefined;
    if (!s) return r;
    const h = readHookLog(s.log), j = meterJournal(s.journal, s.meter_id), called = h.lines.filter((l) => l.backend !== null);
    return { ...r, cost_usd: r.cost_usd === null ? null : r.cost_usd + j.spent_micros / 1_000_000, hook_time_s: called.reduce((a, l) => a + l.latency_ms, 0) / 1000, hook_cost_usd: j.spent_micros / 1_000_000, hook_log: h.ok,
      fail_open: h.lines.filter((l) => l.fail_open).length, escalations: h.lines.filter((l) => l.escalated).length };
  });
}

if (import.meta.main) {
  const [cmd, path] = process.argv.slice(2);
  if (cmd !== "facts" || !path) { console.error("E_USAGE: judge.ts facts <transcript.jsonl>"); process.exit(2); }
  console.log(JSON.stringify(doneFacts(readFileSync(path, "utf8"))));
}

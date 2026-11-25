// Copyright (c) 2026 Garry Tan. MIT License.
// SR's score (plan section 9): pstack-checks' catch on the session (pfchecks/score.ts scoreSession, with S read from the
// change under review, the session record's base_commit, on top of origin), then SR's own readings: exposure from the
// transcripts and false alarms. A false alarm is a check the agent left that fails on all three runs on the change under
// review and is no catch (it fails with the fix too, or passes after the harmless edit): it flags something, but not
// this bug.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSession } from "../pfchecks/exposure.ts";
import type { EntryResult } from "../pfchecks/runner.ts";
import { scoreSession, type CatchRecord, type ScoreIn, type SessionIn } from "../pfchecks/score.ts";
import { failedParent3 } from "../pfchecks/secondaries.ts";
import type { SrArm } from "./arms.ts";
import type { SrSession } from "./analysis.ts";
import { srExposure, type SrExposure } from "./exposure.ts";

export type SrCatch = CatchRecord & { sr: { exposure: SrExposure | null; checks: number; false_alarms: number; cap_stop: boolean } };

export const falseAlarms = (rs: readonly EntryResult[]): number => rs.filter((r) => r.outcome !== "catch" && failedParent3(r)).length;

export async function srScoreSession(o: ScoreIn & { arm: SrArm; transcript: string | null; claudeSession: string | null }): Promise<SrCatch> {
  const c = await scoreSession(o);
  const entries = ("entries" in c ? c.entries : []) as EntryResult[];
  const sess = JSON.parse(readFileSync(o.session, "utf8")) as SessionIn & { cap_stop?: boolean };
  const tf = o.transcript ?? sess.transcript ?? null;
  const cf = o.claudeSession ?? sess.claude_session ?? (tf ? join(dirname(tf), "claude-session.jsonl") : null);
  const read = (f: string | null) => (f && existsSync(f) ? readSession(f) : null);
  const t = read(tf), cc = read(cf);
  return { ...c, sr: { exposure: t || cc ? srExposure(o.arm, t ?? [], cc ?? []) : null, checks: entries.length, false_alarms: falseAlarms(entries), cap_stop: sess.cap_stop === true } };
}

export const sessionOf = (c: SrCatch, arm: SrArm): SrSession => ({ unit: c.unit, repo: c.repo, model: c.model!, arm, score: c.score === null ? null : c.score ? 1 : 0, gap: c.gap, exposure: c.sr.exposure, false_alarms: c.sr.false_alarms, checks: c.sr.checks, cap_stop: c.sr.cap_stop, gap_reason: "gap_reason" in c ? (c.gap_reason as string | null) : null });

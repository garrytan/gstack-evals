// Copyright (c) 2026 Garry Tan. MIT License.
// One row per planned devex review session (prereg 2026-11-09-geva-417, section 6: the failure table, the one lenient
// parse, the missing-rate inputs and the recovery rule J1; section 5's read audit). Every planned session ends in
// exactly one row (lanes/devex/types.ts Row), with these rules, in order:
// - a successful web tool result in any attempt: contaminated, E_DX_WEB_CONTAMINATED, never retried;
// - a none or lens session that read a gstack file (gstackRead: a successful own Read, Grep, Glob or Bash call naming
//   a gstack install path, a skills folder or a drive mount, or a successful Skill call): contaminated,
//   E_DX_ARM_CONTAMINATED, never retried;
// - otherwise the last attempt's outcome (run/parse.ts dxAttempt): a block from either parse is scored on its
//   normalized list; a completed reply with none is no-block, E_DX_NO_BLOCK; a cap stop on the ledger item is missing
//   under the ledger's CAP_STOP; an arm-caused stop is a session stop, E_DX_ARM_STOP; an infrastructure failure is
//   missing, E_DX_INFRA_MISSING.
// nextAttempt says whether one more attempt runs: an arm-caused stop gets one retry under its named reason, and its
// retry's stop ends the session (the session-stop row, never J1). An infrastructure failure gets one retry under its
// named reason on the same item only while the session is unjudged (J1 rule 3); a judged session is never retried (J1
// rule 2), and a second failure leaves it missing. Unknown spend from a failed attempt is counted in the row's spend.
// installStops names the cells where two sessions hit gstack's INSTALL: fail, which stop that cell for the Captain.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Termination } from "../../../src/types.ts";
import { ownUses } from "../../aftermath/exposure.ts";
import type { ArmId, ModelId, Row, Stage } from "../types.ts";
import { MODEL_STRINGS } from "../types.ts";
import type { SmokeSession } from "../score/rules.ts";
import { dxAttempt, normalizeDx, type DxAttempt } from "./parse.ts";
import type { AnswerCounts } from "./persona.ts";
import { sessionExposure } from "./exposure.ts";

/** A gstack file, skills folder or drive path in a tool call's input. */
export const GSTACK_PATH = /\.claude\/skills\/|\.local\/share\/gstack|\.capy\/drive\b|garrytan\/gstack|\/gstack\/(?:bin|lib)\/|\/gstack\/[a-z0-9-]+\/SKILL\.md/;
/** Whether the main agent read a gstack file: the none and lens arms' read audit (section 5). */
export function gstackRead(transcript: string): boolean {
  return ownUses(transcript).some((u) => {
    if (!u.ok) return false;
    if (u.name === "Skill") return true;
    const fields = [u.input.file_path, u.input.path, u.input.pattern, u.input.command].filter((v): v is string => typeof v === "string");
    return ["Read", "Grep", "Glob", "Bash", "LS"].includes(u.name) && fields.some((f) => GSTACK_PATH.test(f));
  });
}

export interface DxAttemptInput {
  termination: Termination;
  /** host/transcript.ndjson, or null when it could not be read. */
  transcript: string | null;
  spend_micros: number | null;
  /** Calls with no recorded outcome, settled as unknown spend at their full charge (J1 rule 1). */
  unknown_micros: number;
}

export interface DxSessionInput {
  unit: string;
  arm: ArmId;
  model: ModelId;
  stage: Stage;
  pass: number;
  smoke: boolean;
  /** Any of its blocks went to a judge (J1 rule 2). */
  judged: boolean;
  attempts: DxAttemptInput[];
  exposure: { exposed: boolean; markers: Record<string, boolean> } | null;
  dx_lens: boolean | null;
  kind: { session_kind: string | null; lean: boolean | null } | null;
  /** The repair the arm runs under (stophook.ts REPAIR_NAME), recorded on every row. */
  repair: string | null;
  answers: AnswerCounts | null;
}

/** The devex row: the shared Row plus the run's own records. */
export interface DxRow extends Row {
  /** The named reasons of the attempts that did not end the session, then the last one's, in order. */
  reasons: string[];
  repair: string | null;
  answers: AnswerCounts | null;
  unknown_micros: number;
}

const reasonOf = (o: DxAttempt): string | null => ("reason" in o ? o.reason : o.state === "cap" ? "cap stop" : null);
const LIMITS = new Set(["turn limit", "minute limit", "dollar limit"]);

/** Whether one more attempt runs after these outcomes, and under what named reason. */
export function nextAttempt(outcomes: readonly DxAttempt[], judged: boolean): { retry: false; why: string } | { retry: true; reason: string } {
  const last = outcomes[outcomes.length - 1];
  if (!last) return { retry: true, reason: "first attempt" };
  if (outcomes.length >= 2) return { retry: false, why: "one retry has run" };
  if (last.state === "arm-stop") return { retry: true, reason: last.reason };
  if (last.state !== "infra") return { retry: false, why: last.state + " is never retried" };
  if (judged) return { retry: false, why: "a judged session is never retried (J1 rule 2)" };
  return { retry: true, reason: last.reason };
}

export function dxRow(s: DxSessionInput): DxRow {
  const reads = s.attempts.map((a) => dxAttempt(a.termination, a.transcript));
  const last = reads[reads.length - 1];
  if (!last) throw new Error("E_USAGE: session " + [s.unit, s.model, s.arm, s.pass].join(":") + " has no attempt");
  const spend = s.attempts.reduce((n, a) => n + (a.spend_micros ?? 0) + a.unknown_micros, 0);
  const unknown = s.attempts.reduce((n, a) => n + a.unknown_micros, 0);
  const web = reads.find((r) => r.outcome.state === "contaminated");
  const audit = s.arm === "none" || s.arm === "lens" ? s.attempts.some((a) => a.transcript !== null && gstackRead(a.transcript)) : null;
  const base: DxRow = {
    unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, pass: s.pass, smoke: s.smoke, end: "missing", code: null, list: null, words: 0, items: 0, cut: 0,
    exposed: s.arm === "none" || s.arm === "lens" ? null : (s.exposure?.exposed ?? null), markers: s.exposure?.markers ?? {}, session_kind: s.kind?.session_kind ?? null, lean: s.kind?.lean ?? null,
    dx_lens: s.arm === "autoplan" ? s.dx_lens : null, gstack_read: audit, retried: s.attempts.length > 1, judged: s.judged,
    limit_stops: reads.filter((r) => r.outcome.state === "arm-stop" && LIMITS.has(r.outcome.reason)).length, spend_micros: spend, session: [s.unit, s.model, s.arm, s.pass].join(":"),
    reasons: reads.map((r) => reasonOf(r.outcome)).filter((x): x is string => x !== null), repair: s.repair, answers: s.answers, unknown_micros: unknown,
  };
  if (web) return { ...base, end: "contaminated", code: "E_DX_WEB_CONTAMINATED" };
  if (audit) return { ...base, end: "contaminated", code: "E_DX_ARM_CONTAMINATED" };
  const o = last.outcome;
  if (o.state === "block" && last.parse.kind === "changes") {
    const n = normalizeDx(last.parse.changes);
    return { ...base, end: "block", list: n.list, words: n.words, items: n.items, cut: n.cut };
  }
  if (o.state === "no-block") return { ...base, end: "no-block", code: "E_DX_NO_BLOCK" };
  if (o.state === "cap") return { ...base, end: "missing", code: "CAP_STOP" };
  if (o.state === "arm-stop") return { ...base, end: "session-stop", code: "E_DX_ARM_STOP" };
  return { ...base, end: "missing", code: "E_DX_INFRA_MISSING" };
}

/** Cells (arm on model) where two or more sessions failed gstack's install verdict: each stops for the Captain. */
export function installStops(rows: readonly DxRow[]): Array<{ arm: ArmId; model: ModelId; sessions: number }> {
  const n = new Map<string, number>();
  for (const r of rows) if (r.reasons.includes("install")) n.set(r.arm + "\t" + r.model, (n.get(r.arm + "\t" + r.model) ?? 0) + 1);
  return [...n].filter(([, k]) => k >= 2).map(([key, sessions]) => ({ arm: key.split("\t")[0] as ArmId, model: key.split("\t")[1] as ModelId, sessions }));
}

/** A smoke row as smoke rules 1 to 4 read it; gate is autoplan's reviewer-and-gate reading, null elsewhere. */
export const smokeSession = (r: DxRow): SmokeSession => ({ model: r.model, parsed: r.end === "block", exposed: r.exposed, limit_stops: r.limit_stops, spend_micros: r.spend_micros, gate: r.arm === "autoplan" ? r.markers.reviewer === true && r.markers.gate === true : null });

const text = (p: string): string | null => (existsSync(p) ? readFileSync(p, "utf8") : null);

/**
 * dx rows --in <sessions.ndjson> --out <rows.ndjson>: one input line per planned session (unit, arm, model, stage,
 * pass, smoke, judged, repair, kind, attempts: [{ dir, unknown_micros }]); each attempt dir holds trial.json (its
 * record's termination and cost_micros) and host/. Writes one row per line.
 */
export function run(argv: string[], io: { out: (t: string) => void; err: (t: string) => void }): number {
  const flag = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
  const inp = flag("--in");
  const out = flag("--out");
  if (!inp || !out) {
    io.err("E_USAGE dx rows: usage: dx rows --in <sessions.ndjson> --out <rows.ndjson>");
    return 2;
  }
  const rows: DxRow[] = [];
  for (const line of readFileSync(inp, "utf8").split("\n").filter((l) => l.trim())) {
    const s = JSON.parse(line);
    const attempts: DxAttemptInput[] = s.attempts.map((a: { dir: string; unknown_micros?: number }) => {
      const trial = JSON.parse(readFileSync(join(a.dir, "trial.json"), "utf8"));
      return { termination: trial.record?.termination ?? trial.termination, transcript: text(join(a.dir, "host", "transcript.ndjson")), spend_micros: trial.record?.cost_micros ?? null, unknown_micros: a.unknown_micros ?? 0 };
    });
    const lastDir = s.attempts[s.attempts.length - 1].dir as string;
    const exposure = s.arm === "plan-devex-review" || s.arm === "autoplan" ? sessionExposure(lastDir, s.arm, MODEL_STRINGS[s.model as ModelId]) : null;
    rows.push(dxRow({ ...s, attempts, exposure, dx_lens: exposure && "dx_lens" in exposure ? exposure.dx_lens : null, answers: s.answers ?? null }));
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const ends = rows.reduce<Record<string, number>>((m, r) => ((m[r.end] = (m[r.end] ?? 0) + 1), m), {});
  io.out("rows " + rows.length + ": " + Object.entries(ends).map(([k, v]) => k + " " + v).join(", "));
  for (const c of installStops(rows)) io.err("E_DX_INFRA_MISSING " + c.arm + " on " + c.model + ": " + c.sessions + " sessions failed gstack's install verdict; the cell stops for the Captain");
  return 0;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// Section 5 and 13.2: the record parser across the frame's gstack versions. One run directory becomes one RunRecord:
// run.json, decisions.jsonl, findings.jsonl, gate.json (and gate.r<n>.json), the bound results and their findings,
// review-record.md, restore.md, plan-at-gate.r<n>.md, plan-active.md, prompts and consensus files. A JSON or JSONL file
// that does not parse is unreadable as a whole (E_AR_UNREADABLE, counted, never fatal): the units that need it are missing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Kind = "lean" | "full";
export type Phase = "ceo" | "design" | "dx" | "eng";
export const PHASES: readonly Phase[] = ["ceo", "design", "dx", "eng"];

export interface Decision {
  id: string;
  run?: string;
  label?: string;
  options: string[];
  recommended?: string;
  kind?: string;
  status?: string;
  gate_rev: number;
  phase?: string;
  origin?: string;
  chosen?: string;
  chosen_text?: string;
  answered_at?: string;
  reply?: string;
  answered_by?: string;
  answered_role?: string;
  owner_reply?: string;
  owner_mode?: string;
  answer_words?: string;
  words_by?: string;
  rec_hash?: string;
  carried_from?: string;
}

export interface Finding {
  id: string;
  phase?: string;
  voice?: string;
  severity?: string;
  title?: string;
  resolution?: string;
  model?: string;
  user_challenge?: boolean;
  reconciliation?: string;
}

export interface RunRecord {
  id: string;
  dir: string;
  kind: Kind;
  run: any | null;
  decisions: Decision[] | null;
  findings: Finding[] | null;
  gate: any | null;
  gates: Map<number, any>;
  /** *.bound.md file name to text. */
  bound: Map<string, string>;
  boundFindings: Map<string, Finding[] | null>;
  reviewRecord: string | null;
  restore: string | null;
  /** The gate-time plan: plan-at-gate.r<n>.md at the highest n, else plan-active.md, with its restore-point comment removed. */
  gatePlan: string | null;
  prompts: Map<string, string>;
  consensus: Map<string, string>;
  files: string[];
  /** Files present that do not parse. */
  unreadable: string[];
}

const text = (dir: string, f: string): string | null => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);

function json(dir: string, f: string, bad: string[]): any | null {
  const t = text(dir, f);
  if (t === null) return null;
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object") return v;
  } catch {}
  bad.push(f);
  return null;
}

function jsonl<T>(dir: string, f: string, bad: string[]): T[] | null {
  const t = text(dir, f);
  if (t === null) return null;
  try {
    const rows = t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    if (rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return rows as T[];
  } catch {}
  bad.push(f);
  return null;
}

/** Strips the restore-point comment (and any leading HTML comment) the runner writes at the top of a plan copy. */
export const stripRestoreComment = (t: string): string => t.replace(/^(?:\s*<!--[\s\S]*?-->)+\s*/, "");

const isDecision = (d: any): d is Decision => typeof d?.id === "string" && Array.isArray(d.options) && d.options.every((o: unknown) => typeof o === "string") && Number.isInteger(d.gate_rev);

/** Lean is the feature kind: one engineering reviewer, phase order eng alone. Without a readable run.json, a record with no CEO files is lean. */
export function kindOf(run: any | null, files: readonly string[]): Kind {
  if (run && Array.isArray(run.phase_order)) return run.phase_order.length === 1 && run.phase_order[0] === "eng" ? "lean" : "full";
  return files.some((f) => f.startsWith("ceo-")) ? "full" : "lean";
}

export function readRecord(dir: string, id: string): RunRecord {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort() : [];
  const bad: string[] = [];
  const run = json(dir, "run.json", bad);
  if (run && (typeof run.phases !== "object" || !Array.isArray(run.phase_order))) bad.push("run.json");
  let decisions = jsonl<Decision>(dir, "decisions.jsonl", bad);
  if (decisions && !decisions.every(isDecision)) {
    bad.push("decisions.jsonl");
    decisions = null;
  }
  const findings = jsonl<Finding>(dir, "findings.jsonl", bad);
  const gate = json(dir, "gate.json", bad);
  const gates = new Map<number, any>();
  for (const f of files) {
    const m = /^gate\.r(\d+)\.json$/.exec(f);
    if (m) {
      const g = json(dir, f, bad);
      if (g) gates.set(Number(m[1]), g);
    }
  }
  if (gate && Number.isInteger(gate.gate_rev)) gates.set(gate.gate_rev, gate);
  const bound = new Map<string, string>();
  const boundFindings = new Map<string, Finding[] | null>();
  for (const f of files) {
    if (f.endsWith(".bound.md")) bound.set(f, text(dir, f)!);
    if (f.endsWith(".bound.md.findings.jsonl")) boundFindings.set(f.replace(/\.findings\.jsonl$/, ""), jsonl<Finding>(dir, f, bad));
  }
  const prompts = new Map<string, string>();
  const consensus = new Map<string, string>();
  for (const f of files) {
    if (/-prompt(\.r\d+)?\.md$/.test(f)) prompts.set(f, text(dir, f)!);
    if (/-consensus(\.r\d+)?\.(md|json)$/.test(f)) consensus.set(f, text(dir, f)!);
  }
  const gateFiles = files.filter((f) => /^plan-at-gate\.r\d+\.md$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
  const planFile = gateFiles.length ? gateFiles[gateFiles.length - 1]! : files.includes("plan-active.md") ? "plan-active.md" : null;
  return {
    id,
    dir,
    kind: kindOf(run, files),
    run: bad.includes("run.json") ? null : run,
    decisions,
    findings,
    gate,
    gates,
    bound,
    boundFindings,
    reviewRecord: text(dir, "review-record.md"),
    restore: text(dir, "restore.md"),
    gatePlan: planFile ? stripRestoreComment(text(dir, planFile)!) : null,
    prompts,
    consensus,
    files,
    unreadable: [...new Set(bad)],
  };
}

/** A record parses when run.json and every JSON or JSONL file it holds parse (section 10's readability gate). */
export const parses = (r: RunRecord): boolean => r.run !== null && r.unreadable.length === 0;

export function readFrame(recordsDir: string, ids: readonly string[]): RunRecord[] {
  return ids.map((id) => readRecord(join(recordsDir, id), id));
}

/** The gate is answered when run.json records an answer or any decision row does. */
export const answered = (r: RunRecord): boolean => Boolean(r.run?.gate?.answered_at) || (r.decisions ?? []).some((d) => Boolean(d.answered_at));

/** gstack minor version (1.91) for the parser smoke. */
export const minorOf = (r: RunRecord): string => String(r.run?.gstack_version ?? "unknown").split(".").slice(0, 2).join(".");

/** The thread code a record names in its paths (out, plan_source, plan_input, active_plan) or run id, as a lower case path fragment such as geva-300. */
export function threadCode(r: RunRecord): string | null {
  const fields = [r.run?.plan_source, r.run?.out, r.run?.plan_input, r.run?.active_plan, r.id].filter((v): v is string => typeof v === "string");
  for (const f of fields) {
    const m = /(?:^|[^a-z0-9])([a-z]{3,5})-?(\d{1,5})(?![0-9])/i.exec(f);
    if (m) return m[1]!.toLowerCase() + "-" + m[2];
  }
  return null;
}

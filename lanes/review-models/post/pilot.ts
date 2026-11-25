// Copyright (c) 2026 Garry Tan. MIT License.
// The finished pilot as the post-run steps read it (wiki/plans/2026-11-24-geva-590-review-models-prereg, Pilots, with
// pre-run changes 1 and 2). Two inputs:
// - the review-units out dir the pilot ran in (src/trial/review/README.md, "A run"): cells.ndjson (every finished
//   session, in order, so a cell listed twice was rerun), units.json (the units built), arms/<arm>-<model tag>/ with
//   findings/<unit>.jsonl and cost.tsv, and runs/<model>/<arm>/<task>/p1/host/ with transcript.ndjson and the voice's
//   codex-sessions;
// - the post key (key.ts), which holds each pilot unit's pool, cluster, known bug, markers and opaque label. The key names
//   fixes and BICs, so it is an answer key and stays outside the repository, beside the supply's gate records.
// Each review is one cell of the five (rm-cells.ts) on one pilot unit at pass 1:
// - outcome: ok when the final session completed and parsed (findings, an empty list, or no json block, which the run
//   scores as finding nothing); safety_stop when the provider refused (R95); gap otherwise, a cell never run included;
// - reruns: earlier sessions of the same cell in cells.ndjson, with their metered spend, which draws on the retry reserve
//   and not on the arm's pilot cap;
// - findings: the run's contract v1 lines for pass 1, each a ReviewFinding whose text is the claim and its evidence.
//   A finding is the voice's when its claim or severity opens with a voice cue ([codex], Codex:, outside voice,
//   second-model review, adversarial challenge, structured review, or a GPT model name), else native;
// - usd and wall seconds: the cell's cost.tsv all row (change 2, section 4);
// - exposure: rm-exposure.ts on the session's host dir for a gstack cell, with sessionModels for the cell's model;
//   N gets the read audit instead (audit.ts);
// - contaminated: the contamination report the post dir holds (contamination.ts), with the blind second read's verdicts
//   folded in when they exist;
// - judged: the Carbon results the post dir holds (send.ts), if any.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySecondRead, type ArmReading, type ContaminationReport, type UnitMarkers } from "../../../src/trial/review/contamination.ts";
import { loadReaderMap, type ReaderMap } from "../../../src/trial/review/readers.ts";
import { RM_CELLS, RM_READER_MAP } from "../../../src/trial/review/rm-cells.ts";
import { sessionExposure, type Exposure } from "../../../src/trial/review/rm-exposure.ts";
import { armId, sessionDir, unitFile } from "../../../src/trial/review/run.ts";
import { rmFail, type Arm, type Pool } from "../score/frozen.ts";
import type { Bug, Judged, ReviewFinding } from "../score/judge.ts";
import { readCostRows, type Review } from "../score/score.ts";
import { readAudit, sessionModels, type ReadAudit } from "./audit.ts";

export interface KeyUnit {
  /** The run's unit id. For a B unit it names the BIC, so only the key holds it. */
  unit: string;
  /** The opaque label every readout uses, minted from random bytes. */
  label: string;
  pool: Pool;
  /** The PR for a P unit or a decoy, the repository for a B unit. */
  cluster: string;
  stratum?: string;
  /** Added plus deleted lines of the unit's diff against its merge-base, which rm-exposure's thresholds read. */
  diff_lines: number;
  /** The known bug; null for the decoy. */
  bug: { evidence: string; fix_diff: string } | null;
  markers: UnitMarkers;
}

export interface PostKey {
  schema: "rm-post-key.v1";
  pilot: KeyUnit[];
  /** The drawn counted set's bug units by pool, for the staged rule's shares. */
  counted: { p: number; b: number; decoys: number };
}

export function readKey(path: string): PostKey {
  const k = JSON.parse(readFileSync(path, "utf8")) as PostKey;
  if (k?.schema !== "rm-post-key.v1" || !Array.isArray(k.pilot) || !k.counted) return rmFail("E_RM_POST_INPUT", path + " is not an rm-post key (schema rm-post-key.v1)");
  const labels = new Set(k.pilot.map((u) => u.label));
  if (labels.size !== k.pilot.length || new Set(k.pilot.map((u) => u.unit)).size !== k.pilot.length) rmFail("E_RM_POST_INPUT", path + " repeats a unit or a label");
  for (const u of k.pilot) if ((u.pool === "decoy") !== (u.bug === null)) rmFail("E_RM_POST_INPUT", "key unit " + u.label + ": a decoy has no bug and every bug unit has one");
  return k;
}

export interface PilotReview extends Review {
  /** The unit's opaque label. */
  label: string;
  /** arm and unit, the contamination report's review id. */
  id: string;
  model: string;
  run_arm: string;
  host: string;
  meter_ids: string[];
  /** The final session's termination kind and parse outcome, or "not run". */
  termination: string;
  parse: string;
  reruns: number;
  /** Metered spend of the earlier sessions; null when one has no settled cost. */
  rerun_usd: number | null;
  diff_lines: number;
  exposure: Exposure | null;
  models: string[];
  /** Every answering model is the cell's model; null for N. */
  model_ok: boolean | null;
  audit: ReadAudit | null;
}

export interface Pilot {
  key: PostKey;
  reviews: PilotReview[];
  /** Unit ids units.json lists as built. */
  built: Set<string>;
  bugs: Map<string, Bug>;
  markers: UnitMarkers[];
  /** Whether a contamination report was found, its per-arm counts, and how many doubtful cases still wait on the second read. */
  contamination: { read: boolean; pending_cases: number; arms: ArmReading[] };
}

const VOICE_CUE = /^\s*(?:\[\s*|\(\s*|\*\*)?(?:codex|outside[- ]voice|second[- ]model(?: review)?|adversarial challenge|structured review|gpt[-\w.]*)\b/i;
export const sourceOf = (summary: string, severity: string): "native" | "voice" => (VOICE_CUE.test(summary) || VOICE_CUE.test(severity) ? "voice" : "native");

const jsonl = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
const readOr = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};

export const READER_MAP_PATH = fileURLToPath(new URL("../../../src/trial/review/reader-maps/" + RM_READER_MAP, import.meta.url));

export function readerMap(): ReaderMap {
  const m = loadReaderMap(READER_MAP_PATH);
  return "map" in m ? m.map : rmFail("E_RM_POST_INPUT", READER_MAP_PATH + ": " + m.problem);
}

interface Entry {
  cell: { model: string; arm: string; unit: string; pass: number };
  meter_id: string;
  record: { termination: { kind: string; failure?: string; code?: string } };
  parse: { kind: string };
  cost: { all: { spent_micros: number; unknown: number } } | null;
}

/** The post dir's contamination report with any second-read verdicts folded in, or null when none was written. */
export function contaminationOf(post: string): { report: ContaminationReport; pending: number } | null {
  const dir = join(post, "contamination");
  if (!existsSync(join(dir, "contamination.json"))) return null;
  let report = JSON.parse(readFileSync(join(dir, "contamination.json"), "utf8")) as ContaminationReport;
  const key = readOr(join(dir, "second-read-key.tsv")).split("\n").slice(1).filter(Boolean).map((l) => {
    const [case_id, review, arm, source, attempt] = l.split("\t");
    return { case_id: case_id!, review: review!, arm: arm!, source: source as "claude" | "voice", attempt: Number(attempt) };
  });
  const verdicts = jsonl<{ case_id: string; verdict: "contaminated" | "clean" | null }>(join(dir, "second-read-verdicts.jsonl")).filter((v): v is { case_id: string; verdict: "contaminated" | "clean" } => v.verdict === "contaminated" || v.verdict === "clean");
  if (verdicts.length) report = applySecondRead(report, key, verdicts);
  const decided = new Set(verdicts.map((v) => v.case_id));
  return { report, pending: key.filter((k) => !decided.has(k.case_id)).length };
}

/** Every pilot review: five cells by every key unit at pass 1. */
export function loadPilot(run: string, key: PostKey, post: string | null): Pilot {
  const entries = new Map<string, Entry[]>();
  for (const e of jsonl<Entry>(join(run, "cells.ndjson"))) {
    if (e.cell.pass !== 1) continue;
    const id = e.cell.arm + "\u0000" + e.cell.model + "\u0000" + e.cell.unit;
    entries.set(id, [...(entries.get(id) ?? []), e]);
  }
  const unitsJson = existsSync(join(run, "units.json")) ? (JSON.parse(readFileSync(join(run, "units.json"), "utf8")) as { units: Array<{ id: string; task: string }> }) : { units: [] };
  const tasks = new Map(unitsJson.units.map((u) => [u.id, u.task]));
  const judged = new Map(post ? jsonl<{ unit: string; arm: Arm; judged: Judged }>(join(post, "judge", "judged.jsonl")).map((j) => [j.arm + "\u0000" + j.unit, j.judged]) : []);
  const cont = post ? contaminationOf(post) : null;
  const contaminated = new Set(cont?.report.contaminated ?? []);
  const map = readerMap();
  const costs = new Map<string, ReturnType<typeof readCostRows>>();
  const reviews: PilotReview[] = [];
  for (const cell of RM_CELLS) {
    const runArm = cell.arm, model = cell.model, arm = cell.id as Arm;
    const dir = join(run, "arms", armId(runArm, model));
    if (!costs.has(dir)) costs.set(dir, existsSync(join(dir, "cost.tsv")) ? readCostRows(readFileSync(join(dir, "cost.tsv"), "utf8")) : new Map());
    for (const u of key.pilot) {
      const list = entries.get(runArm + "\u0000" + model + "\u0000" + u.unit) ?? [];
      const last = list.at(-1);
      const earlier = list.slice(0, -1);
      const task = tasks.get(u.unit) ?? "";
      const host = join(sessionDir(run, model, runArm, task, 1), "host");
      const term = last?.record.termination;
      const outcome: Review["outcome"] = !last ? "gap" : term!.kind === "arm_failure" && term!.failure === "refusal" ? "safety_stop" : term!.kind === "completed" && (last.parse.kind === "findings" || last.parse.kind === "missing") ? "ok" : "gap";
      const lines = outcome === "ok" ? jsonl<Record<string, any>>(join(dir, "findings", unitFile(u.unit) + ".jsonl")).filter((f) => (f.pass ?? 1) === 1) : [];
      const findings: ReviewFinding[] = lines.map((f, i) => ({ id: String(f.id ?? "p1-" + (i + 1)), source: sourceOf(String(f.summary ?? ""), String(f.severity ?? "")), severity: String(f.severity ?? ""), path: typeof f.path === "string" ? f.path : null, line: typeof f.line === "number" ? f.line : null, text: String(f.summary ?? "") + (f.evidence ? "\nEvidence: " + String(f.evidence) : "") }));
      const cost = costs.get(dir)!.get(u.unit);
      const transcript = last ? readOr(join(host, "transcript.ndjson")) : "";
      const exposure = cell.voice && last ? sessionExposure(host, { map, voice: cell.voice, diffLines: u.diff_lines }) : null;
      const models = sessionModels(transcript);
      const id = arm + " " + u.unit;
      reviews.push({
        unit: u.unit,
        arm,
        pool: u.pool,
        cluster: u.cluster,
        ...(u.stratum ? { stratum: u.stratum } : {}),
        outcome,
        contaminated: contaminated.has(id),
        ...(cell.voice ? { exposed: !!exposure?.exposed } : {}),
        findings,
        judged: judged.get(arm + "\u0000" + u.unit) ?? null,
        usd: cost?.usd ?? null,
        wall_seconds: cost?.wall_seconds ?? null,
        label: u.label,
        id,
        model,
        run_arm: runArm,
        host,
        meter_ids: list.map((e) => e.meter_id),
        termination: term ? term.kind + (term.failure ? " " + term.failure : term.code ? " " + term.code : "") : "not run",
        parse: last?.parse.kind ?? "not run",
        reruns: earlier.length,
        rerun_usd: earlier.some((e) => !e.cost || e.cost.all.unknown > 0) ? null : earlier.reduce((s, e) => s + e.cost!.all.spent_micros / 1e6, 0),
        diff_lines: u.diff_lines,
        exposure,
        models,
        model_ok: cell.voice ? models.length > 0 && models.every((m) => m === model) : null,
        audit: cell.voice || !last ? null : readAudit(transcript),
      });
    }
  }
  const bugs = new Map(key.pilot.filter((u) => u.bug).map((u) => [u.unit, { unit: u.unit, pool: u.pool as "P" | "B", evidence: u.bug!.evidence, fix_diff: u.bug!.fix_diff }]));
  return { key, reviews, built: new Set(tasks.keys()), bugs, markers: key.pilot.map((u) => ({ ...u.markers, unit: u.unit })), contamination: { read: !!cont, pending_cases: cont?.pending ?? 0, arms: cont?.report.arms ?? [] } };
}


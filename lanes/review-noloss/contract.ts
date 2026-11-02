// Copyright (c) 2026 Garry Tan. MIT License.
// Arm contract version 1 for the review no-loss category (plan section 3): arm.json, findings/<unit>.jsonl,
// judgments.tsv, cost.tsv and the optional adjudication.tsv. An arm with no judgments yet is raw: it can be ingested and
// turned into blinded judge packets, and is scored only once judge-join writes its judgments. adjudication.tsv rules on
// each blocking finding judgments.tsv leaves unmatched; a finding with no row is unadjudicated, never "not a defect".
// Unknown fields and columns are kept and ignored.
// Every refusal names the file, the row and the field, and says how to fix that row.
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { machinePath } from "./scan.ts";
import { resolveUnit, type Blocker, type Suite, type Unit } from "./suite.ts";

export const CONTRACT_VERSIONS = [1];
export const ARM_SCHEMA = join(import.meta.dir, "arm.schema.json");
export const ARM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
export type Mapped = "CRITICAL" | "INFORMATIONAL";
export type Outcome = "F" | "D" | "M";
export type Grade = "exact" | "lane" | "upper-bound" | "estimate";
export const METER_GRADES: Record<string, Grade> = { "proxy-journal": "exact", "reader-counter": "exact", "lane-counter-delta": "lane", "root-counter-delta": "upper-bound", estimate: "estimate" };
export const JUDGMENT_COLUMNS = ["pr", "blocker_id", "outcome", "matched_finding", "raw_severity", "mapped_severity", "judge", "saw_label", "note"];
export const ADJUDICATION_COLUMNS = ["pr", "finding", "pass", "ruling", "judge", "saw_label", "version", "batch", "note"];
export const ADJUDICATION_VERSION = 1;
/** defect: a real defect no suite blocker names (a new blocker); not-defect; known-informational: it over-blocks the unit's known informational case. */
export const RULINGS = ["defect", "not-defect", "known-informational"] as const;
export type Ruling = (typeof RULINGS)[number];
const COST_ALIASES: Record<string, string[]> = {
  pr: ["pr"],
  scope: ["scope", "voice"],
  total_tokens: ["total_tokens"],
  meter_source: ["meter_source"],
  input_tokens: ["input_tokens", "input"],
  output_tokens: ["output_tokens", "output"],
  cache_read_tokens: ["cache_read_tokens", "cache_read"],
  cache_write_tokens: ["cache_write_tokens", "cache_write"],
  reasoning_tokens: ["reasoning_tokens", "reasoning"],
  usd: ["usd"],
  wall_seconds: ["wall_seconds"],
  covers: ["covers"],
  pass: ["pass"],
};
const COST_REQUIRED = ["pr", "scope", "total_tokens", "meter_source"];
export const COST_NUMBERS = ["total_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "usd", "wall_seconds"] as const;

export interface ArmJson {
  contract_version: number;
  id: string;
  label: string;
  suite: string;
  suite_sha256?: string;
  date: string;
  passes: number;
  kind?: "reference" | "variant";
  provenance?: "live" | "transcribed";
  transcribed_from?: Array<{ name: string; sha256: string }>;
  status?: "complete" | "stopped";
  coverage_gaps?: string[];
  models?: Array<{ role: string; model: string; effort?: string }>;
  severity_map?: { default?: Record<string, Mapped>; by_reader?: Record<string, Record<string, Mapped>> };
  [key: string]: unknown;
}

export interface Finding {
  id: string;
  index: number;
  pass: number;
  raw: string;
  reader: string | null;
  path: string | null;
  line: number | null;
  summary: string;
  fix: string;
  /** The line's parsed fields, unknown ones included. */
  fields: Record<string, unknown>;
}

export interface Judgment {
  unit: Unit;
  blocker: Blocker;
  pass: number;
  outcome: Outcome;
  matched: Finding[];
  raw: string | null;
  mapped: Mapped | null;
  judge: string;
  saw_label: boolean;
  coverage: "complete" | "incomplete";
  note: string;
}

export interface Adjudication {
  unit: Unit;
  finding: Finding;
  pass: number;
  ruling: Ruling;
  judge: string;
  saw_label: boolean;
  batch: string;
  note: string;
}

export interface CostRow {
  row: number;
  units: Unit[];
  aggregate: boolean;
  pass: number | null;
  scope: string;
  meter_source: string;
  grade: Grade;
  values: Record<(typeof COST_NUMBERS)[number], number | null>;
}

export interface Arm {
  arm: ArmJson;
  provenance: "live" | "transcribed";
  /** raw: findings without judgments, ready for judge packets and not yet scorable. */
  state: "raw" | "judged";
  /** By unit id; null for a transcribed arm, which has no findings. */
  findings: Map<string, Finding[]> | null;
  judgments: Judgment[] | null;
  /** adjudication.tsv rows; null when the arm has none. */
  adjudications: Adjudication[] | null;
  cost: CostRow[];
}

export type ContractCode = "E_NOLOSS_ARM" | "E_NOLOSS_JUDGMENT" | "E_NOLOSS_COST" | "E_NOLOSS_ADJUDICATION";

/** The blockers each finding is matched to in judgments.tsv. A blocking finding absent here is unmatched. */
export function matchedBlockers(judgments: readonly Judgment[]): Map<Finding, Blocker[]> {
  const m = new Map<Finding, Blocker[]>();
  for (const j of judgments) for (const f of j.matched) m.set(f, [...(m.get(f) ?? []), j.blocker]);
  return m;
}

export interface Problem {
  code: ContractCode;
  where: string;
  message: string;
  fix: string;
}

export class ContractError extends Error {
  constructor(readonly problems: Problem[]) {
    super(problems.map((p) => p.where + ": " + p.message + "\nrow fix: " + p.fix).join("\n"));
  }
  get code(): ContractCode {
    return this.problems[0]!.code;
  }
}

let ajvCache: { arm: (v: unknown) => boolean; finding: (v: unknown) => boolean; errors: () => string } | null = null;
function validators() {
  if (ajvCache) return ajvCache;
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  const schema = JSON.parse(readFileSync(ARM_SCHEMA, "utf8"));
  ajv.addSchema(schema);
  const arm = ajv.getSchema(schema.$id)!;
  const finding = ajv.compile({ $ref: schema.$id + "#/$defs/finding" });
  let last: typeof arm | typeof finding = arm;
  ajvCache = {
    arm: (v) => ((last = arm), arm(v) as boolean),
    finding: (v) => ((last = finding), finding(v) as boolean),
    errors: () => (last.errors ?? []).map((e) => (e.instancePath || "/") + " " + e.message).join("; "),
  };
  return ajvCache;
}

/** The raw label a severity map reads: label, else severity, cut at its first comma. */
export const rawLabel = (f: Record<string, unknown>): string => String(typeof f.label === "string" && f.label ? f.label : f.severity).split(",")[0]!.trim();

/** CRITICAL and INFORMATIONAL map to themselves; any other raw label needs a map entry, the reader's before the default. Null when unmapped. */
export function mapSeverity(arm: ArmJson, raw: string, reader: string | null): Mapped | null {
  if (raw === "CRITICAL" || raw === "INFORMATIONAL") return raw;
  const byReader = reader !== null ? arm.severity_map?.by_reader?.[reader]?.[raw] : undefined;
  return byReader ?? arm.severity_map?.default?.[raw] ?? null;
}

/** Splits a TSV into a header and rows; blank lines are skipped, a ragged row is reported by its 1-based line. */
export function parseTsv(text: string): { header: string[]; rows: Array<{ line: number; cells: Record<string, string> }>; ragged: number[] } {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim());
  const rows: Array<{ line: number; cells: Record<string, string> }> = [];
  const ragged: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue;
    const cells = lines[i]!.split("\t");
    if (cells.length > header.length) ragged.push(i + 1);
    rows.push({ line: i + 1, cells: Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? "").trim()])) });
  }
  return { header, rows, ragged };
}

const unknownValue = (v: string | undefined) => v === undefined || v === "" || v === "-" || /^unavailable$/i.test(v);

/**
 * Validates an arm's files against a suite. files maps a path inside the arm dir (arm.json, judgments.tsv, cost.tsv,
 * findings/<unit>.jsonl) to its bytes. Throws ContractError with every problem found.
 */
/** Why an arm gets no judge packet, join or score: review-units' read audit marked it untested (E_ARM_CONTAMINATED); else null. */
export function untestedProblem(files: Map<string, Buffer>): string | null {
  const text = files.get("arm.json");
  if (!text) return null;
  const arm = JSON.parse(text.toString("utf8")) as { id?: unknown; untested?: { reason?: unknown } };
  if (!arm.untested) return null;
  return "E_ARM_CONTAMINATED arm " + String(arm.id) + " is untested (" + String(arm.untested.reason ?? "a contaminated read") + "), so it gets no judge packet, join or score; rerun the arm clean";
}

export function parseArm(files: Map<string, Buffer>, suite: Suite, suiteSha256: string | null = null): Arm {
  const problems: Problem[] = [];
  const add = (code: ContractCode, where: string, message: string, fix: string) => problems.push({ code, where, message, fix });
  const v = validators();
  const armText = files.get("arm.json");
  if (!armText) throw new ContractError([{ code: "E_NOLOSS_ARM", where: "arm.json", message: "the arm has no arm.json", fix: "write arm.json with contract_version 1, id, label, suite, date and passes (lanes/review-noloss/arm.schema.json)" }]);
  let arm: ArmJson;
  try {
    arm = JSON.parse(armText.toString("utf8"));
  } catch (e) {
    throw new ContractError([{ code: "E_NOLOSS_ARM", where: "arm.json", message: "not JSON: " + (e as Error).message, fix: "fix the JSON syntax" }]);
  }
  if (arm === null || typeof arm !== "object" || Array.isArray(arm)) throw new ContractError([{ code: "E_NOLOSS_ARM", where: "arm.json", message: "not a JSON object", fix: "write arm.json as one object" }]);
  if (arm.contract_version === undefined) add("E_NOLOSS_ARM", "arm.json contract_version", "missing", "add \"contract_version\": 1");
  else if (!CONTRACT_VERSIONS.includes(arm.contract_version)) throw new ContractError([{ code: "E_NOLOSS_ARM", where: "arm.json contract_version", message: "contract_version " + JSON.stringify(arm.contract_version) + " is not supported; this reader supports " + CONTRACT_VERSIONS.join(", "), fix: "write the arm in a supported contract version, or upgrade gstack-evals" }]);
  if (typeof arm.id === "string" && !ARM_ID.test(arm.id)) add("E_NOLOSS_ARM", "arm.json id", JSON.stringify(arm.id) + " does not match " + ARM_ID, "use letters, digits, _ and - (write A' as A2 and keep A' in label)");
  if (!v.arm(arm)) add("E_NOLOSS_ARM", "arm.json", "schema: " + v.errors(), "match lanes/review-noloss/arm.schema.json");
  if (problems.length) throw new ContractError(problems);
  if (arm.suite !== suite.id) throw new ContractError([{ code: "E_NOLOSS_ARM", where: "arm.json suite", message: "the arm names suite " + arm.suite + ", not " + suite.id, fix: "ingest it with --suite " + arm.suite + ", or fix arm.json suite" }]);
  if (arm.suite_sha256 && suiteSha256 && arm.suite_sha256 !== suiteSha256) add("E_NOLOSS_ARM", "arm.json suite_sha256", "the arm ran against suite digest " + arm.suite_sha256 + ", but the suite file now hashes to " + suiteSha256, "score against the suite revision the arm ran on, or rerun the arm; never edit the digest");
  for (const reader of ["default", ...Object.keys(arm.severity_map?.by_reader ?? {})]) {
    const map = reader === "default" ? arm.severity_map?.default : arm.severity_map?.by_reader?.[reader];
    for (const canon of ["CRITICAL", "INFORMATIONAL"]) if (map && canon in map && map[canon] !== canon) add("E_NOLOSS_ARM", "arm.json severity_map " + reader + "." + canon, canon + " must map to itself", "remove the " + canon + " entry; canonical severities always map to themselves");
  }
  const provenance = arm.provenance ?? "live";
  const findingFiles = [...files.keys()].filter((k) => k.startsWith("findings/"));
  const units = new Map(suite.units.map((u) => [u.id, u]));

  let findings: Map<string, Finding[]> | null = null;
  if (provenance === "transcribed") {
    if (!arm.transcribed_from?.length) add("E_NOLOSS_ARM", "arm.json transcribed_from", "a transcribed arm needs its sources' names and sha256", "list each results file the judgments were copied from, with its sha256");
    if (findingFiles.length) add("E_NOLOSS_ARM", "findings/", "a transcribed arm has no findings", "drop findings/ or make the arm live, with judgments that name its findings");
  } else if (findingFiles.length === 0) {
    add("E_NOLOSS_ARM", "findings/", "a live arm needs findings/<unit>.jsonl for every unit", "write one file per unit, empty when the arm found nothing there");
  } else {
    findings = new Map();
    for (const name of findingFiles.sort()) {
      const ref = name.slice("findings/".length).replace(/\.jsonl$/, "");
      if (!name.endsWith(".jsonl") || ref.includes("/")) {
        add("E_NOLOSS_ARM", name, "not a findings/<unit>.jsonl file", "name it after a unit ref, such as findings/3593.jsonl");
        continue;
      }
      const { unit, problem } = resolveUnit(suite, ref);
      if (!unit) {
        add("E_NOLOSS_ARM", name, problem!, "rename the file after a unit of suite " + suite.id);
        continue;
      }
      if (findings.has(unit.id)) {
        add("E_NOLOSS_ARM", name, "a second findings file for " + unit.id, "merge the two files into one");
        continue;
      }
      const list: Finding[] = [];
      const ids = new Set<string>();
      const lines = files.get(name)!.toString("utf8").replace(/\n$/, "").split("\n");
      if (lines.length === 1 && lines[0] === "") lines.length = 0;
      lines.forEach((text, index) => {
        const where = name + " line " + (index + 1);
        let f: Record<string, unknown>;
        try {
          f = JSON.parse(text);
        } catch {
          return add("E_NOLOSS_ARM", where, "not a JSON object", "write one finding object per line, no blank lines");
        }
        if (!v.finding(f)) return add("E_NOLOSS_ARM", where, "schema: " + v.errors(), "match $defs/finding in lanes/review-noloss/arm.schema.json");
        const pass = (f.pass as number | undefined) ?? 1;
        if (pass > arm.passes) return add("E_NOLOSS_ARM", where + " pass", "pass " + pass + " is past arm.json passes " + arm.passes, "fix the pass, or raise passes when the arm really ran more");
        if (typeof f.path === "string" && machinePath(f.path)) add("E_NOLOSS_ARM", where + " path", "an absolute or home path would publish a machine path", "write the path relative to the repo root");
        const id = String(f.id ?? f.fingerprint ?? "#" + index);
        if (ids.has(pass + " " + id)) add("E_NOLOSS_ARM", where + " id", "id " + JSON.stringify(id) + " repeats in pass " + pass, "give each finding a unique id, or drop the duplicate");
        ids.add(pass + " " + id);
        const reader = (f.reader ?? f.specialist ?? f.voice ?? null) as string | null;
        const raw = rawLabel(f);
        if (mapSeverity(arm, raw, reader) === null) add("E_NOLOSS_ARM", where + " severity", "raw label " + JSON.stringify(raw) + (reader ? " (reader " + reader + ")" : "") + " is not CRITICAL or INFORMATIONAL and severity_map has no entry for it", "add it to arm.json severity_map, matched exactly");
        list.push({ id, index, pass, raw, reader, path: (f.path as string | null) ?? null, line: (f.line as number | null) ?? null, summary: String(f.summary), fix: typeof f.fix === "string" ? f.fix : "", fields: f });
      });
      findings.set(unit.id, list);
    }
    for (const u of suite.units) if (!findings.has(u.id)) add("E_NOLOSS_ARM", "findings/", "no findings file for " + u.id, "write findings/" + u.pr + ".jsonl, empty when the arm found nothing there");
  }

  let judgments: Judgment[] | null = null;
  const jText = files.get("judgments.tsv");
  if (!jText) {
    if (provenance === "transcribed") add("E_NOLOSS_JUDGMENT", "judgments.tsv", "a transcribed arm needs its judgments", "write judgments.tsv from the results table");
  } else {
    judgments = [];
    const t = parseTsv(jText.toString("utf8"));
    const missingCols = JUDGMENT_COLUMNS.filter((c) => !t.header.includes(c));
    if (missingCols.length) add("E_NOLOSS_JUDGMENT", "judgments.tsv header", "missing column(s) " + missingCols.join(", "), "the header is " + JUDGMENT_COLUMNS.join(", ") + ", plus optional pass and coverage");
    for (const l of t.ragged) add("E_NOLOSS_JUDGMENT", "judgments.tsv line " + l, "more cells than header columns", "remove the extra tab-separated cells");
    const seen = new Set<string>();
    if (!missingCols.length) {
      for (const { line, cells } of t.rows) {
        const at = "judgments.tsv line " + line;
        const { unit, problem } = resolveUnit(suite, cells.pr!);
        if (!unit) {
          add("E_NOLOSS_JUDGMENT", at + " pr", problem!, "name a unit of suite " + suite.id);
          continue;
        }
        const blocker = unit.blockers.find((b) => b.id === cells.blocker_id);
        if (!blocker) {
          add("E_NOLOSS_JUDGMENT", at + " blocker_id", unit.id + " has no blocker " + JSON.stringify(cells.blocker_id), "use one of " + unit.blockers.map((b) => b.id).join(", "));
          continue;
        }
        const pass = cells.pass ? Number(cells.pass) : 1;
        if (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes) {
          add("E_NOLOSS_JUDGMENT", at + " pass", "pass " + JSON.stringify(cells.pass) + " is not 1 to " + arm.passes, "fix the pass");
          continue;
        }
        const key = unit.id + " " + blocker.id + " " + pass;
        if (seen.has(key)) {
          add("E_NOLOSS_JUDGMENT", at, "a second row for " + unit.id + " " + blocker.id + " pass " + pass, "keep one row per blocker per pass");
          continue;
        }
        seen.add(key);
        const outcome = cells.outcome as Outcome;
        if (!["F", "D", "M"].includes(outcome)) {
          add("E_NOLOSS_JUDGMENT", at + " outcome", JSON.stringify(cells.outcome) + " is not F, D or M", "F found at CRITICAL, D matched at INFORMATIONAL only, M missed");
          continue;
        }
        const coverage = (cells.coverage || "complete") as Judgment["coverage"];
        if (coverage !== "complete" && coverage !== "incomplete") add("E_NOLOSS_JUDGMENT", at + " coverage", JSON.stringify(cells.coverage) + " is not complete or incomplete", "leave it blank for complete");
        if (coverage === "incomplete" && (outcome !== "M" || !cells.note)) add("E_NOLOSS_JUDGMENT", at + " coverage", "incomplete coverage needs outcome M and the reason in note", "write M and say in note which reviewer did not run");
        if (cells.saw_label !== "yes" && cells.saw_label !== "no") add("E_NOLOSS_JUDGMENT", at + " saw_label", JSON.stringify(cells.saw_label) + " is not yes or no", "yes when the judge saw arm labels, no for a blinded join");
        const expected: Mapped | null = outcome === "F" ? "CRITICAL" : outcome === "D" ? "INFORMATIONAL" : null;
        const mappedCell = unknownValue(cells.mapped_severity) || cells.mapped_severity === "none" ? null : cells.mapped_severity;
        const rawCell = unknownValue(cells.raw_severity) || cells.raw_severity === "none" ? null : cells.raw_severity!;
        if (mappedCell !== expected) add("E_NOLOSS_JUDGMENT", at + " mapped_severity", "outcome " + outcome + " needs mapped_severity " + (expected ?? "blank") + ", not " + JSON.stringify(cells.mapped_severity), outcome === "M" ? "leave mapped_severity blank" : "an " + outcome + " row's mapped severity is " + expected + "; if the finding maps otherwise, the outcome is wrong");
        let matched: Finding[] = [];
        let mapped: Mapped | null = expected;
        if (provenance === "transcribed") {
          if (cells.matched_finding !== "-") add("E_NOLOSS_JUDGMENT", at + " matched_finding", "a transcribed arm has no findings, so matched_finding is -", "write -");
          if (cells.saw_label !== "yes") add("E_NOLOSS_JUDGMENT", at + " saw_label", "a transcribed judgment was made with the labels in view", "write yes");
          if (rawCell !== expected) add("E_NOLOSS_JUDGMENT", at + " raw_severity", "a transcribed " + outcome + " row's raw_severity is " + (expected ?? "blank"), "write " + (expected ?? "nothing"));
        } else {
          const refs = unknownValue(cells.matched_finding) || cells.matched_finding === "none" ? [] : cells.matched_finding!.split(";").map((s) => s.trim()).filter(Boolean);
          if (outcome === "M" && refs.length) add("E_NOLOSS_JUDGMENT", at + " matched_finding", "an M row matches no finding", "blank matched_finding, or change the outcome to what the matched finding's severity gives");
          if (outcome !== "M" && !refs.length) add("E_NOLOSS_JUDGMENT", at + " matched_finding", "an " + outcome + " row must name the finding it matched", "write the finding's id, or #<0-based line>; separate several with ;");
          const list = findings?.get(unit.id)?.filter((f) => f.pass === pass) ?? [];
          for (const ref of refs) {
            const f = list.find((x) => x.id === ref) ?? (/^#\d+$/.test(ref) ? list.find((x) => x.index === Number(ref.slice(1))) : undefined);
            if (!f) add("E_NOLOSS_JUDGMENT", at + " matched_finding", JSON.stringify(ref) + " is not a pass-" + pass + " finding in findings/ for " + unit.id, "name a finding's id, fingerprint or #<0-based line> in that unit's findings file");
            else matched.push(f);
          }
          if (matched.length && matched.length === refs.length) {
            const maps = matched.map((f) => mapSeverity(arm, f.raw, f.reader));
            mapped = maps.includes("CRITICAL") ? "CRITICAL" : maps.includes("INFORMATIONAL") ? "INFORMATIONAL" : null;
            const got: Outcome = mapped === "CRITICAL" ? "F" : "D";
            if (mapped && got !== outcome) add("E_NOLOSS_JUDGMENT", at + " outcome", "the matched finding(s) map to " + mapped + ", so the outcome is " + got + ", not " + outcome, "write " + got + ", or fix matched_finding");
            const rawOk = matched.filter((f, i) => maps[i] === mapped).map((f) => f.raw);
            if (mapped && !rawOk.includes(rawCell ?? "")) add("E_NOLOSS_JUDGMENT", at + " raw_severity", JSON.stringify(rawCell) + " is not the raw label of the matched finding that sets the outcome (" + [...new Set(rawOk)].join(" or ") + ")", "copy the finding's raw label (label, else severity, before any comma)");
          }
        }
        judgments.push({ unit, blocker, pass, outcome, matched, raw: rawCell, mapped, judge: cells.judge ?? "", saw_label: cells.saw_label === "yes", coverage, note: cells.note ?? "" });
      }
      for (const u of suite.units)
        for (const b of u.blockers)
          for (let pass = 1; pass <= arm.passes; pass++)
            if (!seen.has(u.id + " " + b.id + " " + pass)) add("E_NOLOSS_JUDGMENT", "judgments.tsv", "no row for " + u.id + " " + b.id + " pass " + pass, "re-judge that blocker, or record it with coverage incomplete and the reason in note; never add an M row just to pass this check");
    }
  }

  let adjudications: Adjudication[] | null = null;
  const aText = files.get("adjudication.tsv");
  if (aText && (!findings || !judgments))
    add("E_NOLOSS_ADJUDICATION", "adjudication.tsv", findings ? "adjudication rules on the blocking findings judgments.tsv leaves unmatched, and the arm has no judgments.tsv" : "the arm has no findings to adjudicate", findings ? "join judgments first (noloss judge-join), then adjudicate (noloss judge-packet --adjudicate)" : "drop adjudication.tsv");
  else if (aText && !problems.length) {
    adjudications = [];
    const t = parseTsv(aText.toString("utf8"));
    const missingCols = ADJUDICATION_COLUMNS.filter((c) => !t.header.includes(c));
    if (missingCols.length) add("E_NOLOSS_ADJUDICATION", "adjudication.tsv header", "missing column(s) " + missingCols.join(", "), "the header is " + ADJUDICATION_COLUMNS.join(", "));
    for (const l of t.ragged) add("E_NOLOSS_ADJUDICATION", "adjudication.tsv line " + l, "more cells than header columns", "remove the extra tab-separated cells");
    const matched = matchedBlockers(judgments!);
    const seen = new Set<Finding>();
    if (!missingCols.length) {
      for (const { line, cells } of t.rows) {
        const at = "adjudication.tsv line " + line;
        const { unit, problem } = resolveUnit(suite, cells.pr!);
        if (!unit) {
          add("E_NOLOSS_ADJUDICATION", at + " pr", problem!, "name a unit of suite " + suite.id);
          continue;
        }
        const pass = cells.pass ? Number(cells.pass) : 1;
        if (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes) {
          add("E_NOLOSS_ADJUDICATION", at + " pass", "pass " + JSON.stringify(cells.pass) + " is not 1 to " + arm.passes, "fix the pass");
          continue;
        }
        const ref = cells.finding!;
        const list = findings!.get(unit.id)!.filter((f) => f.pass === pass);
        const f = list.find((x) => x.id === ref) ?? (/^#\d+$/.test(ref) ? list.find((x) => x.index === Number(ref.slice(1))) : undefined);
        if (!f) {
          add("E_NOLOSS_ADJUDICATION", at + " finding", JSON.stringify(ref) + " is not a pass-" + pass + " finding in findings/ for " + unit.id, "name a finding's id, fingerprint or #<0-based line> in that unit's findings file");
          continue;
        }
        if (seen.has(f)) {
          add("E_NOLOSS_ADJUDICATION", at, "a second row for " + unit.id + " finding " + JSON.stringify(ref) + " pass " + pass, "keep one row per finding per pass");
          continue;
        }
        seen.add(f);
        if (mapSeverity(arm, f.raw, f.reader) !== "CRITICAL") {
          add("E_NOLOSS_ADJUDICATION", at + " finding", JSON.stringify(ref) + " maps to INFORMATIONAL; only blocking findings are adjudicated", "drop the row");
          continue;
        }
        if (matched.has(f)) {
          add("E_NOLOSS_ADJUDICATION", at + " finding", "judgments.tsv already rules " + JSON.stringify(ref) + ": it names blocker " + matched.get(f)!.map((b) => b.id).join(", "), "drop the row; adjudication covers only the blocking findings judgments.tsv leaves unmatched");
          continue;
        }
        const ruling = cells.ruling as Ruling;
        if (!RULINGS.includes(ruling)) {
          add("E_NOLOSS_ADJUDICATION", at + " ruling", JSON.stringify(cells.ruling) + " is not " + RULINGS.join(", "), "defect: a real defect no suite blocker names; not-defect; known-informational: it over-blocks the unit's known informational case");
          continue;
        }
        if (ruling === "known-informational" && !unit.blockers.some((b) => b.counts === "over-blocking")) add("E_NOLOSS_ADJUDICATION", at + " ruling", unit.id + " has no over-blocking blocker, so it has no known informational case", "rule defect or not-defect");
        if (cells.saw_label !== "yes" && cells.saw_label !== "no") add("E_NOLOSS_ADJUDICATION", at + " saw_label", JSON.stringify(cells.saw_label) + " is not yes or no", "yes when the judge saw arm labels, no for a blinded join");
        if (cells.version !== String(ADJUDICATION_VERSION)) add("E_NOLOSS_ADJUDICATION", at + " version", JSON.stringify(cells.version) + " is not adjudication version " + ADJUDICATION_VERSION, "write " + ADJUDICATION_VERSION + ", or upgrade gstack-evals to read a newer file");
        if (!cells.judge) add("E_NOLOSS_ADJUDICATION", at + " judge", "missing", "name the judge");
        adjudications.push({ unit, finding: f, pass, ruling, judge: cells.judge ?? "", saw_label: cells.saw_label === "yes", batch: cells.batch ?? "", note: cells.note ?? "" });
      }
    }
  }

  const cost: CostRow[] = [];
  const cText = files.get("cost.tsv");
  if (cText) {
    const t = parseTsv(cText.toString("utf8"));
    const col = (name: string) => COST_ALIASES[name]!.find((a) => t.header.includes(a)) ?? null;
    const missing = COST_REQUIRED.filter((c) => !col(c));
    if (missing.length) add("E_NOLOSS_COST", "cost.tsv header", "missing column(s) " + missing.join(", "), "the header needs pr, scope, total_tokens and meter_source; input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, usd, wall_seconds, covers and pass are optional");
    for (const l of t.ragged) add("E_NOLOSS_COST", "cost.tsv line " + l, "more cells than header columns", "remove the extra tab-separated cells");
    const totals = new Set<string>();
    if (!missing.length) {
      for (const { line, cells } of t.rows) {
        const at = "cost.tsv line " + line;
        const get = (name: string) => (col(name) ? cells[col(name)!] : undefined);
        const meter = get("meter_source") ?? "";
        const grade = METER_GRADES[meter];
        if (!grade) {
          add("E_NOLOSS_COST", at + " meter_source", JSON.stringify(meter) + " is not a meter source", "use proxy-journal, reader-counter, lane-counter-delta, root-counter-delta or estimate; put any prose in a note column");
          continue;
        }
        const values = {} as CostRow["values"];
        for (const k of COST_NUMBERS) {
          const raw = get(k);
          values[k] = unknownValue(raw) ? null : Number(raw);
          if (values[k] !== null && (!Number.isFinite(values[k]) || values[k]! < 0)) {
            add("E_NOLOSS_COST", at + " " + k, JSON.stringify(raw) + " is not a non-negative number", "write a number, or leave it blank when unknown");
            values[k] = null;
          }
        }
        const prCell = get("pr") ?? "";
        let unitsCovered: Unit[] = [];
        const aggregate = prCell === "*";
        if (aggregate) {
          const refs = (get("covers") ?? "").split(/[\s,]+/).filter(Boolean);
          if (!refs.length) add("E_NOLOSS_COST", at + " covers", "a pr * row must list the units it covers", "list unit refs in covers, separated by spaces or commas");
          for (const ref of refs) {
            const r = resolveUnit(suite, ref);
            if (r.unit) unitsCovered.push(r.unit);
            else add("E_NOLOSS_COST", at + " covers", r.problem!, "name units of suite " + suite.id);
          }
        } else {
          const r = resolveUnit(suite, prCell);
          if (!r.unit) {
            add("E_NOLOSS_COST", at + " pr", r.problem!, "name a unit, or write * with covers");
            continue;
          }
          unitsCovered = [r.unit];
        }
        const passCell = get("pass");
        const pass = unknownValue(passCell) ? null : Number(passCell);
        if (pass !== null && (!Number.isSafeInteger(pass) || pass < 1 || pass > arm.passes)) add("E_NOLOSS_COST", at + " pass", "pass " + JSON.stringify(passCell) + " is not 1 to " + arm.passes, "fix the pass, or leave it blank when the row covers every pass");
        const scope = get("scope") ?? "";
        if (/^all\b/.test(scope)) {
          const key = unitsCovered.map((u) => u.id).sort().join(",") + " " + (pass ?? "*");
          if (totals.has(key)) add("E_NOLOSS_COST", at, "a second all-scope row for the same units and pass", "keep one total row; put components in rows with another scope");
          totals.add(key);
        }
        cost.push({ row: line, units: unitsCovered, aggregate, pass, scope, meter_source: meter, grade, values });
      }
    }
  }
  if (problems.length) throw new ContractError(problems);
  return { arm, provenance, state: judgments ? "judged" : "raw", findings, judgments, adjudications, cost };
}

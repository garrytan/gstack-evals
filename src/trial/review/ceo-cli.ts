// gstack-evals ceo rows|packets|readings: the CEO outcome eval's readings pipeline (prereg 2026-11-04-geva-285 sections
// 6 to 9, as the guard amendment 2026-11-05-geva-289 and the ladder amendment 2026-11-05-geva-295 change them, with the
// readings of the stop-label amendment 2026-11-05-geva-300).
//
// rows reads review-units --plan ceo-outcome run dirs: one row per planned session, from the journal's one stored parse
// of each closing block (never a reparse), with the end state, exposure, spend and session clock. --checks replays every
// parser and detector check per session. packets builds the blind D and remedy packets from the rows and the sealed
// units dir, with stock rows A and B, and writes the key outside the packets. readings joins the rows, the key and the
// three judges' reply files into the readings.json ceo-rule.ts reads. Every output path must sit outside the repo, no
// command prints issue or fix text, and every refusal ends with a fix line. --units must hash to the suite binding the
// runs' units.json records (GST-1437), and rows.json, the key and readings.json carry that binding on, so an edited
// key.json or plan.md is refused at every step. rows.json also records exposure_sha256, and each row its model_id.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { ceoKeyProblems, ceoUnitFolder, ceoUnitsDigest, insideRepo, realPath } from "../../../lanes/review-noloss/suite.ts";
import { seededRandom } from "../../runner/stats/paired.ts";
import type { Termination } from "../../types.ts";
import { isCeoRunArm, type CeoRunArm } from "./ceo-arms.ts";
import { autoplanCeoExposure, CEO_EXPOSURE_SHA256, type CeoDisk, enforcedExposure, findingsWrittenTranscript, type GateReport, gateRows, handoffNamed, standaloneExposure } from "./ceo-exposure.ts";
import { CEO_PARSER_SHA256, ceoRowFields, cut40, endState, type CeoParse } from "./ceo-outcome.ts";
import { sessionDir, type SessionMeter } from "./run.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** A refusal: what is wrong, and the command or edit that clears it. */
export class CeoRefusal extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
  }
}
const refuse = (message: string, fix: string): never => {
  throw new CeoRefusal(message, fix);
};

const REPO_ROOT = join(import.meta.dir, "../../..");
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
/** The ladder amendment's stock-list.txt, pinned. */
export const STOCK_LIST = join(REPO_ROOT, "wiki/plans/2026-11-05-geva-295-ceo-ladder-amendment/stock-list.txt");
export const STOCK_LIST_SHA256 = "9ecbc78e696836bd11c3e89df1cc1cb0b0e28940b92e7dd3a96846224e47fe3c";
/** The three judges of section 8, by the readings flag that takes each one's reply dir. */
export const CEO_JUDGE_IDS = { sol: "openai/gpt-6.1-sol", opus: "anthropic/claude-opus-5-5", sonnet: "anthropic/claude-sonnet-5-5" } as const;

export type Model3 = "opus" | "sol" | "particle";
export type ScoreArm = "none" | "autoplan-ceo" | "standalone" | "lens" | "enforced";
const MODELS: Model3[] = ["opus", "sol", "particle"];
const SCORE_ARMS: ScoreArm[] = ["none", "autoplan-ceo", "standalone", "lens", "enforced"];
const GSTACK: ScoreArm[] = ["autoplan-ceo", "standalone", "enforced"];
/** Stage 1's smoke arms by round: 1, the smoke stage 1 ran; 2, the stage 2 amendment's rerun (section 8). */
const SMOKE_ARMS: Record<1 | 2, ScoreArm[]> = { 1: ["autoplan-ceo", "standalone"], 2: ["enforced", "standalone"] };
const SCORE_ARM: Record<CeoRunArm, ScoreArm> = { none: "none", lens: "lens", "gstack-auto": "autoplan-ceo", "gstack-forced": "standalone", "gstack-enforced": "enforced" };
/** The prereg's three models under test, by the exact policy keys review-units runs them as (policy/models.json). */
export const CEO_MODEL_IDS: Record<string, Model3> = { "claude-opus-5-5": "opus", "openai/gpt-6.1-sol": "sol", "particle-ai/particle-1": "particle" };
const model3 = (id: string): Model3 | null => (Object.hasOwn(CEO_MODEL_IDS, id) ? CEO_MODEL_IDS[id]! : null);
const inside = (child: string, dir: string) => child === dir || child.startsWith(dir + sep);

/** An output path outside the repo, checked on the path and on its realpath, so a symlink into the repo is refused too. */
export function sealedOut(path: string, flag: string): string {
  const abs = resolve(path);
  if (insideRepo(abs)) refuse(flag + " " + abs + " is inside the repo; what it holds carries review text or maps it to arms, so it stays sealed", "give " + flag + " a path outside " + REPO_ROOT + ", such as a folder under the sealed root");
  return abs;
}

type Flags = Map<string, string[]>;
function parseFlags(argv: string[], spec: Record<string, "value" | "repeat" | "bool">): Flags {
  const flags: Flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const kind = spec[a] ?? refuse("no flag " + JSON.stringify(a), "use only " + Object.keys(spec).join(", ") + "; gstack-evals ceo --help lists them");
    const v = kind === "bool" ? "true" : argv[++i];
    if (v === undefined || v.startsWith("--")) refuse(a + " needs a value", "pass " + a + " <value>");
    if (kind !== "repeat" && flags.has(a)) refuse(a + " is given twice", "pass " + a + " once");
    flags.set(a, [...(flags.get(a) ?? []), v!]);
  }
  return flags;
}
const need = (flags: Flags, f: string): string => flags.get(f)?.[0] ?? refuse("needs " + f, "add " + f + " <value>; gstack-evals ceo --help lists the flags");
/** A JSON file's value. A parse error is never quoted, since these files carry review text. */
function readJson(path: string, what: string, fix: string): any {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return refuse("cannot read " + what + " " + path, fix);
  }
  try {
    return JSON.parse(text);
  } catch {
    return refuse(what + " " + path + " is not JSON", fix);
  }
}
const writeOut = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
};

// The sealed units dir: one folder per unit, its id with / written __, holding key.json and plan.md.
type KeyJson = Record<string, any>;
interface UnitInfo {
  id: string;
  dir: string;
  key: KeyJson;
  kind: "changed" | "held";
}
/** The suite a ceo-outcome run's units.json names, with the binding review-units records (ceoSuiteBinding). */
export interface SuiteBinding {
  id: string;
  sha256: string | null;
  catalogs_sha256: string;
  units_dir: string;
  unit_ids: string[];
}
/**
 * The bound suite's units, read from --units: the dir must hash to the binding's catalogs_sha256 (the suite stub's
 * catalogs digest), so no key.json or plan.md can change after the runs. Each unit is read from its id's folder; a
 * folder name never maps back to an id, since a repo name may hold __.
 */
export function readUnits(dir: string, bound: SuiteBinding): UnitInfo[] {
  const abs = resolve(dir);
  const fix = "point --units at the sealed units dir the runs were made on, and check it against the custody digests";
  const d = ceoUnitsDigest(abs, bound.units_dir, bound.unit_ids);
  if ("missing" in d) refuse("--units " + abs + " is not the runs' units dir: " + d.missing, fix);
  const got = (d as { sha256: string }).sha256;
  if (got !== bound.catalogs_sha256) refuse("--units " + abs + " hashes to catalogs_sha256 " + got + ", not the " + bound.catalogs_sha256 + " suite " + bound.id + "'s runs recorded; a key.json or plan.md changed after the runs, or this is another units dir", fix);
  return bound.unit_ids.map((id) => {
    const folder = join(abs, ceoUnitFolder(id));
    const key = readJson(join(folder, "key.json"), "unit " + id + "'s key.json", fix);
    const problems = ceoKeyProblems(key);
    if (problems.length) refuse("unit " + id + "'s key.json breaks the key contract: " + problems.join("; "), "rewrite that key.json with B2's packaging script, then rerun");
    return { id, dir: folder, key, kind: key.kind };
  });
}
/** A units.json or rows.json suite record, or null when it carries no binding. */
const bindingOf = (v: any): SuiteBinding | null =>
  v && typeof v.id === "string" && (v.sha256 === null || typeof v.sha256 === "string") && typeof v.catalogs_sha256 === "string" && /^[0-9a-f]{64}$/.test(v.catalogs_sha256) && typeof v.units_dir === "string" && v.units_dir !== "" && Array.isArray(v.unit_ids) && v.unit_ids.length > 0 && v.unit_ids.every((u: unknown) => typeof u === "string") ? v : null;
const sameSuite = (a: SuiteBinding, b: SuiteBinding) => JSON.stringify([a.id, a.sha256, a.catalogs_sha256, a.units_dir, a.unit_ids]) === JSON.stringify([b.id, b.sha256, b.catalogs_sha256, b.units_dir, b.unit_ids]);

/** Stage 2's plan from the projection output's PASS line, in the grammar ceo-rule.ts's compare reads. */
export interface PassPlan {
  cells: [ScoreArm, Model3][];
  /** The cut in seeded order: the first changed and held units stage 2 runs, of how many, and the last of each (null for none). */
  units: { changed: number; changed_of: number; changed_last: string; held: number; held_of: number; held_last: string | null };
  family: Record<Model3, ScoreArm[]>;
  passes: Record<Model3, 1 | 2>;
  held_passes: 1 | 2;
  lens: boolean;
  projection_sha256: string;
}
function passPlan(file: string): PassPlan {
  const fix = "pass --projection the projection output the Captain recorded with the stage 2 caps";
  let raw: Buffer = Buffer.alloc(0);
  try {
    raw = readFileSync(file);
  } catch {
    refuse("cannot read --projection " + file, fix);
  }
  const lines = raw.toString("utf8").replace(/\r/g, "").split("\n");
  if (lines.some((l) => l.startsWith("Projection: STOP"))) refuse("the projection output stopped over the envelope, so stage 2 does not start", "stage 2 has no rows; take the stop to the Captain");
  const pass = lines.filter((l) => l.startsWith("Projection: PASS"));
  if (pass.length !== 1) refuse("the projection output must hold one PASS line; it holds " + pass.length, fix);
  const pm = pass[0]!.match(/^Projection: PASS at '([^']+)'; record these caps; cells: ([a-z:, -]+); held passes ([12])(?:; 1 pass on ([a-z, ]+))?; units: changed (\d+) of (\d+), last ([^\s,;]+); held (\d+) of (\d+), last ([^\s,;]+)$/) ?? refuse("the projection output's PASS line doesn't parse (the stage 2 amendment's form ends with its units: clause)", fix);
  const cells = pm[2]!.split(", ").map((c) => c.split(":") as [ScoreArm, Model3]);
  if (cells.some((c) => c.length !== 2 || !SCORE_ARMS.includes(c[0]) || !MODELS.includes(c[1]))) refuse("the projection output's PASS line names a cell outside the arms and models", fix);
  if (cells.some(([a]) => a === "autoplan-ceo")) refuse("the projection output's PASS line names autoplan-ceo, which stage 2's cells refuse (the stage 2 amendment, section 4.5)", fix);
  const [changed, changedOf, held, heldOf] = [pm[5], pm[6], pm[8], pm[9]].map(Number) as [number, number, number, number];
  if (changed < 1 || changed > changedOf || held > heldOf || (held === 0) !== (pm[10] === "none")) refuse("the projection output's units: clause is not a cut (changed " + changed + " of " + changedOf + ", held " + held + " of " + heldOf + ", last held " + pm[10] + ")", fix);
  const one = (pm[4] ?? "").split(", ").filter(Boolean);
  if (one.some((m) => !MODELS.includes(m as Model3))) refuse("the projection output's PASS line names a model outside the plan", fix);
  return {
    cells,
    units: { changed, changed_of: changedOf, changed_last: pm[7]!, held, held_of: heldOf, held_last: held ? pm[10]! : null },
    family: Object.fromEntries(MODELS.map((m) => [m, cells.filter(([a, mm]) => mm === m && GSTACK.includes(a)).map(([a]) => a)])) as Record<Model3, ScoreArm[]>,
    passes: Object.fromEntries(MODELS.map((m) => [m, one.includes(m) ? 1 : 2])) as Record<Model3, 1 | 2>,
    held_passes: Number(pm[3]) as 1 | 2,
    lens: cells.some(([a, m]) => a === "lens" && m === "opus"),
    projection_sha256: sha256(raw),
  };
}

type Ordered = { id: string; kind: "changed" | "held" };
/** --order: every unit of the bound suite once, in seeded order, with its key's kind. */
function readOrder(file: string, units: UnitInfo[]): Ordered[] {
  const abs = resolve(file);
  const fix = "pass --order the comparison suite's seeded order: a JSON array of { \"id\", \"kind\" } naming every unit of the suite once";
  const v = readJson(abs, "--order", fix);
  if (!Array.isArray(v) || v.some((x: any) => !x || typeof x.id !== "string" || (x.kind !== "changed" && x.kind !== "held"))) refuse("--order " + abs + " is not a JSON array of { id, kind }", fix);
  const kinds = new Map(units.map((u) => [u.id, u.kind]));
  if (v.length !== units.length || new Set(v.map((x: Ordered) => x.id)).size !== v.length || v.some((x: Ordered) => kinds.get(x.id) !== x.kind)) refuse("--order " + abs + " does not name each of the bound suite's " + units.length + " units once with its key's kind", fix);
  return v.map((x: Ordered) => ({ id: x.id, kind: x.kind }));
}
/** The units stage 2 runs: the first n changed and the first h held of the seeded order, as the PASS line's units: clause cuts it. */
function cutUnits(order: Ordered[], plan: PassPlan, units: UnitInfo[]): UnitInfo[] {
  const fix = "pass the --order and --projection of one stage 2 pin; the PASS line's units: clause cuts that order";
  const changed = order.filter((u) => u.kind === "changed");
  const held = order.filter((u) => u.kind === "held");
  const u = plan.units;
  if (changed.length !== u.changed_of || held.length !== u.held_of) refuse("--order holds " + changed.length + " changed and " + held.length + " held units, and the PASS line counts " + u.changed_of + " and " + u.held_of, fix);
  if (changed[u.changed - 1]!.id !== u.changed_last || (u.held > 0 && held[u.held - 1]!.id !== u.held_last)) refuse("the PASS line's last units (" + u.changed_last + ", " + (u.held_last ?? "none") + ") are not changed unit " + u.changed + " and held unit " + u.held + " of --order", fix);
  const keep = new Set([...changed.slice(0, u.changed), ...held.slice(0, u.held)].map((x) => x.id));
  return units.filter((x) => keep.has(x.id));
}

// One session a run holds: a journal entry, or a cell its stops.json lists.
interface Found {
  run: string;
  model_id: string;
  ceo_arm: CeoRunArm;
  arm: ScoreArm;
  model: Model3;
  unit: string;
  pass: number;
  task: string | null;
  entry: any | null;
  how: string | null;
  spent?: { usd: number; wall_s: number | null };
}
function readRun(dir: string): { found: Found[]; suite: SuiteBinding } {
  const run = resolve(dir);
  const fix = "pass the --out dir of a review-units --plan ceo-outcome run";
  if (!existsSync(join(run, "stops.json"))) refuse("--run " + run + " has no stops.json, so it is not a ceo-outcome run", fix);
  const stops = readJson(join(run, "stops.json"), "stops.json", fix);
  const units = readJson(join(run, "units.json"), "units.json", fix);
  const suite = bindingOf(units?.suite) ?? refuse("--run " + run + "'s units.json names no suite binding (catalogs_sha256, units_dir and unit_ids), so --units can't be checked against the units it ran", "ceo rows read only runs review-units made from a checkout that records the binding; rerun those cells there");
  const tasks = new Map<string, string>((Array.isArray(units?.units) ? units.units : []).map((u: any) => [u.id, u.task]));
  const journal = join(run, "cells.ndjson");
  const lines = existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter((l) => l.trim()) : [];
  const cellOf = (cell: any, entry: any | null, how: string | null, where: string): Found => {
    const at = where + " of " + run;
    if (!cell || typeof cell.model !== "string" || typeof cell.arm !== "string" || !isCeoRunArm(cell.arm) || typeof cell.unit !== "string" || !Number.isInteger(cell.pass) || cell.pass < 1) refuse(at + " names no ceo-outcome cell (a model, an arm of none, lens, gstack-auto, gstack-forced or gstack-enforced, a unit and a pass)", fix);
    const model = model3(cell.model) ?? refuse(at + " runs " + cell.model + ", which is none of the prereg's three model ids (" + Object.keys(CEO_MODEL_IDS).join(", ") + ")", "drop that run; ceo rows read only the prereg's three models, by their exact ids");
    if (entry) {
      const co = entry.ceo_outcome;
      if (!co || typeof co !== "object") refuse(at + " has no ceo_outcome record", fix);
      if (co.parser_sha256 !== CEO_PARSER_SHA256) refuse(at + " holds a parse from parser " + co.parser_sha256 + ", not this checkout's ceo-outcome.ts " + CEO_PARSER_SHA256 + "; rows read the journal's one stored parse and never reparse", "run ceo rows from the checkout whose src/trial/review/ceo-outcome.ts hashes to " + co.parser_sha256 + ", the one the run was made with");
    }
    return { run, model_id: cell.model, ceo_arm: cell.arm, arm: SCORE_ARM[cell.arm as CeoRunArm], model, unit: cell.unit, pass: cell.pass, task: tasks.get(cell.unit) ?? null, entry, how };
  };
  const found = lines.map((l, i) => {
    let e: any;
    try {
      e = JSON.parse(l);
    } catch {
      return refuse("line " + (i + 1) + " of " + journal + " is not JSON", "restore the journal from the run's sink copy, or drop this --run");
    }
    return cellOf(e?.cell, e, null, "journal line " + (i + 1));
  });
  for (const s of Array.isArray(stops?.stops) ? stops.stops : [])
    for (const c of Array.isArray(s?.cells) ? s.cells : []) {
      const f = cellOf(c, null, c.how === "unstarted" ? "unstarted" : "stopped", "a stops.json cell");
      if (f.how === "stopped" && !(typeof c.usd === "number" && Number.isFinite(c.usd) && c.usd >= 0)) refuse("a stopped cell in " + join(run, "stops.json") + " has no settled spend (usd)", "restore stops.json from the run's sink copy");
      found.push(f.how === "stopped" ? { ...f, spent: { usd: c.usd, wall_s: typeof c.wall_s === "number" && Number.isFinite(c.wall_s) ? c.wall_s : null } } : f);
    }
  return { found, suite };
}

export interface CeoRow {
  id: string;
  unit: string;
  arm: ScoreArm;
  model: Model3;
  /** The exact model id the run ran, or null for a planned session no run holds. */
  model_id: string | null;
  pass: number;
  smoke: boolean;
  status: "scored" | "no-block" | "gap" | "incomplete";
  exposed: boolean | null;
  forecast: number | null;
  usd: number;
  wall_s: number | null;
  issues: string[];
  words: number[];
  fixes: string[];
  fix_words: number[];
  run: string | null;
  termination: string | null;
  follow_up: boolean;
  over_three: boolean;
  zero_output: boolean;
  /** The proxy's per-session record (peak in-flight reservation, largest prompt, bytes per token, cache-write modes), or null for a session whose journal predates it. */
  meter: SessionMeter | null;
}
interface Checked {
  row: CeoRow;
  checks: [string, boolean][];
  /** An autoplan-ceo session with a successful Bash call naming gstack-ceo-mode-handoff. */
  named: boolean;
  /** An autoplan-ceo session whose trial.json logged a copy-out failure, so findings_written reads false. */
  copy_failed?: boolean;
  /** #230's transcript reading of findings_written, for the report-only disagreement count; it decides nothing. */
  transcript_findings?: boolean;
  /** An enforced session's gate report, as trial.json holds it. */
  gate?: GateReport;
}
const rowId = (smoke: boolean, arm: string, model: string, unit: string, pass: number) => (smoke ? "smoke:" : "") + arm + ":" + model + ":" + unit + ":p" + pass;
const COUNTS = ["scored", "no-block", "gap", "incomplete"] as const;

function sessionRow(id: string, p: { unit: string; arm: ScoreArm; model: Model3; pass: number; smoke: boolean }, f: Found | undefined, strict: boolean): Checked {
  const base: CeoRow = { id, ...p, model_id: f?.model_id ?? null, status: "gap", exposed: null, forecast: null, usd: 0, wall_s: null, issues: [], words: [], fixes: [], fix_words: [], run: f?.run ?? null, termination: null, follow_up: false, over_three: false, zero_output: false, meter: null };
  if (!f || !f.entry) {
    const row: CeoRow = { ...base, status: f ? "incomplete" : "gap", termination: f ? "cap_stop" : null, usd: f?.spent?.usd ?? 0, wall_s: f?.spent?.wall_s ?? null };
    return { row, checks: [["journaled", false]], named: false };
  }
  const e = f.entry;
  const parse = e.parse as CeoParse;
  const co = e.ceo_outcome;
  let derived: string | null = null;
  try {
    derived = endState(e.record?.termination as Termination, parse);
  } catch {
    derived = null;
  }
  const stored = co.end_state;
  const determinate = derived !== null && stored === derived && derived !== "incomplete";
  if (strict && !determinate) refuse(id + " in " + f.run + " holds end state " + JSON.stringify(stored) + ", but section 6's table reads " + JSON.stringify(derived) + " from its termination and stored parse", "run ceo rows --checks to see the session's checks; the journal line was changed after the run, so restore it from the run's sink copy");
  if (!Number.isFinite(co.usd) || co.usd < 0) refuse(id + " in " + f.run + " has no settled spend (ceo_outcome.usd)", "restore the journal from the run's sink copy");
  const dir = sessionDir(f.run, f.model_id, f.ceo_arm, f.task ?? "", f.pass);
  let text: string | null = null;
  try {
    text = readFileSync(join(dir, "host", "transcript.ndjson"), "utf8");
  } catch {
    text = null;
  }
  const lost = GSTACK.includes(p.arm) && text === null;
  const status = (determinate && !lost ? stored : "gap") as CeoRow["status"];
  const exposure = GSTACK.includes(p.arm) && !lost ? (p.arm === "standalone" ? standaloneExposure(text!) : p.arm === "enforced" ? enforcedExposure(text!, gateReport(dir)) : autoplanCeoExposure(text!, ceoDisk(dir))) : null;
  const fields = status === "scored" ? ceoRowFields(parse) : { issues: [], words: [], fixes: [], fix_words: [] };
  const row: CeoRow = {
    ...base,
    status,
    exposed: exposure ? exposure.exposed : null,
    forecast: status === "scored" && parse.kind === "block" ? parse.forecast : null,
    usd: co.usd,
    wall_s: typeof co.wall_s === "number" && Number.isFinite(co.wall_s) ? co.wall_s : null,
    ...fields,
    termination: e.record?.termination?.kind ?? null,
    follow_up: co.follow_up === true,
    over_three: parse.kind === "block" && parse.top.length > 3,
    zero_output: e.record?.model_output === false,
    meter: meterOf(e.meter),
  };
  const checks: [string, boolean][] = [["journaled", true], ["transcript_readable", text !== null && parse.kind !== "unreadable"], ["block", parse.kind === "block"], ["end_state_determinate", determinate], ["scored", status === "scored"], ...Object.entries(exposure?.checks ?? {})];
  const disk = ceoDisk(dir);
  return { row, checks, named: p.arm === "autoplan-ceo" && text !== null && handoffNamed(text), copy_failed: disk.copy_failed, ...(p.arm === "autoplan-ceo" && text !== null ? { transcript_findings: findingsWrittenTranscript(text) } : {}), ...(p.arm === "enforced" ? { gate: gateReport(dir) } : {}) };
}

/** Each enforced cell's held sessions' gate reports, by cell name. */
function enforcedCells(rows: Checked[]): Map<string, GateReport[]> {
  const cells = new Map<string, GateReport[]>();
  for (const c of rows) if (c.gate) {
    const cell = (c.row.smoke ? "smoke " : "") + c.row.arm + ":" + c.row.model;
    cells.set(cell, [...(cells.get(cell) ?? []), c.gate]);
  }
  return cells;
}
const gateExits = (gs: GateReport[]) => [...new Set(gs.map((g) => (g.exit === null ? "none" : String(g.exit))))].sort().map((e) => e + " on " + gs.filter((g) => (g.exit === null ? "none" : String(g.exit)) === e).length).join(", ");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Blocks the gate gave the session, summed over its ceo-review-gate rows. */
const blocksOf = (g: GateReport) => gateRows(g).reduce((n, r) => n + count(r.blocked), 0);
/** The session's gate released it with no block before: released on the first stop. */
const releasedFirst = (g: GateReport) => gateRows(g).some((r) => count(r.released) > 0) && blocksOf(g) === 0;

/** A journal entry's meter record, or null when it has none or it is not the SessionMeter shape. */
function meterOf(m: any): SessionMeter | null {
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!m || !num(m.peak_inflight_usd) || !Number.isInteger(m.peak_inflight_calls) || !(m.largest_prompt === null || num(m.largest_prompt)) || !(m.bytes_per_token === null || num(m.bytes_per_token)) || !Array.isArray(m.cache_write) || !m.cache_write.every((c: unknown) => c === "none" || c === "5m" || c === "1h")) return null;
  return { peak_inflight_usd: m.peak_inflight_usd, peak_inflight_calls: m.peak_inflight_calls, largest_prompt: m.largest_prompt, bytes_per_token: m.bytes_per_token, cache_write: [...m.cache_write] };
}

/** An enforced session's gate report from its trial.json (the report's exit and JSON, run on the copied record); an
 * unreadable trial.json reads as a failed copy with no report, so the gate reads unarmed. */
export function gateReport(dir: string): GateReport {
  try {
    const t = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"));
    const g = t?.gate ?? {};
    const copy = t?.logs?.copy_out;
    return { session_id: typeof g.session_id === "string" ? g.session_id : null, exit: Number.isInteger(g.exit) ? g.exit : null, json: g.json ?? null, copy_failed: Array.isArray(copy) ? copy.length > 0 : !!copy };
  } catch {
    return { session_id: null, exit: null, json: null, copy_failed: true };
  }
}

/** What the session left on disk: every ceo-review.md the harness copied into host/ceo-review/, and whether trial.json
 * logged a copy-out failure (an unreadable trial.json counts as one, since nothing then vouches for the copies). */
export function ceoDisk(dir: string): CeoDisk {
  let copy_failed = true;
  try {
    const logs = JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"))?.logs;
    copy_failed = Array.isArray(logs?.copy_out) ? logs.copy_out.length > 0 : !!logs?.copy_out;
  } catch {
    copy_failed = true;
  }
  const copies: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile() && e.name === "ceo-review.md") copies.push(readFileSync(join(d, e.name), "utf8"));
    }
  };
  walk(join(dir, "host", "ceo-review"));
  return { copies, copy_failed };
}

interface RowsBuild {
  stage: 1 | 2;
  /** Stage 1: which smoke the runs hold (1, stage 1's own; 2, the rerun). */
  smoke_round: 1 | 2 | null;
  /** Stage 2: every unit of the bound suite in seeded order, as --order gives it. */
  order: Array<{ id: string; kind: "changed" | "held" }> | null;
  suite: SuiteBinding;
  units: UnitInfo[];
  plan: PassPlan | null;
  runs: string[];
  rows: Checked[];
  held: Set<string>;
}
function buildRows(flags: Flags, strict: boolean): RowsBuild {
  const stageText = need(flags, "--stage");
  if (stageText !== "1" && stageText !== "2") refuse("--stage must be 1 or 2, not " + JSON.stringify(stageText), "pass --stage 1 for the headroom check or --stage 2 for the comparison");
  const stage = Number(stageText) as 1 | 2;
  if (stage === 1 && flags.has("--projection")) refuse("stage 1 has fixed cells and takes no --projection", "drop --projection, or pass --stage 2");
  if (stage === 1 && flags.has("--order")) refuse("stage 1 has fixed units and takes no --order", "drop --order, or pass --stage 2");
  if (stage === 2 && flags.has("--smoke-round")) refuse("--smoke-round reads stage 1's smoke, and stage 2 has none", "drop --smoke-round");
  const roundText = flags.get("--smoke-round")?.[0] ?? "1";
  if (roundText !== "1" && roundText !== "2") refuse("--smoke-round must be 1 or 2, not " + JSON.stringify(roundText), "pass --smoke-round 1 for stage 1's smoke (autoplan-ceo and standalone) or 2 for the rerun (enforced and standalone)");
  const round = Number(roundText) as 1 | 2;
  const plan = stage === 2 ? passPlan(resolve(need(flags, "--projection"))) : null;
  const unitsFlag = need(flags, "--units");
  const runs = (flags.get("--run") ?? []).map((r) => resolve(r));
  if (!runs.length) refuse("needs at least one --run", "add --run <review-units out dir> for each run of this stage");
  if (new Set(runs).size !== runs.length) refuse("a --run is given twice", "pass each run dir once");
  const read = runs.map(readRun);
  const suite = read[0]!.suite;
  read.forEach((r, i) => {
    if (!sameSuite(r.suite, suite)) refuse("--run " + runs[i] + " ran another suite (" + r.suite.id + ", catalogs_sha256 " + r.suite.catalogs_sha256 + ") than --run " + runs[0] + " (" + suite.id + ", catalogs_sha256 " + suite.catalogs_sha256 + ")", "pass only the runs of one suite and one units dir");
  });
  const all = readUnits(unitsFlag, suite);
  const order = stage === 2 ? readOrder(need(flags, "--order"), all) : null;
  const units = order ? cutUnits(order, plan!, all) : all;
  const found = read.flatMap((r) => r.found);
  const unitIds = new Map(units.map((u) => [u.id, u]));
  const planned: Array<{ unit: string; arm: ScoreArm; model: Model3; pass: number; smoke: boolean }> = [];
  if (stage === 1) {
    for (const m of MODELS) for (const u of units) for (let p = 1; p <= (m === "opus" ? 3 : 2); p++) planned.push({ unit: u.id, arm: "none", model: m, pass: p, smoke: false });
    const smoke = [...new Set(found.filter((f) => GSTACK.includes(f.arm)).map((f) => f.unit))].sort();
    if (smoke.length !== 2) refuse("stage 1's runs hold gstack sessions on " + smoke.length + " units; the smoke runs both gstack arms on every model on the same two units (section 10)", "add the run that holds the smoke sessions, or drop the run that holds gstack sessions on a third unit");
    for (const m of MODELS) for (const a of SMOKE_ARMS[round]) for (const u of smoke) planned.push({ unit: u, arm: a, model: m, pass: 1, smoke: true });
  } else {
    for (const [a, m] of plan!.cells) for (const u of units) {
      const n = u.kind === "changed" ? plan!.passes[m] : Math.min(plan!.passes[m], plan!.held_passes);
      for (let p = 1; p <= n; p++) planned.push({ unit: u.id, arm: a, model: m, pass: p, smoke: false });
    }
  }
  const byId = new Map<string, Found>();
  for (const f of found) {
    const smoke = stage === 1 && GSTACK.includes(f.arm);
    const id = rowId(smoke, f.arm, f.model, f.unit, f.pass);
    if (!unitIds.has(f.unit) || !planned.some((p) => rowId(p.smoke, p.arm, p.model, p.unit, p.pass) === id)) refuse("session " + id + " in " + f.run + " is outside stage " + stage + "'s plan", "drop the --run that holds it, or check --stage, --units and --projection");
    const twin = byId.get(id);
    if (twin) refuse("session " + id + " is in two places: " + twin.run + (twin.entry ? " (journal)" : " (stops.json)") + " and " + f.run + (f.entry ? " (journal)" : " (stops.json)"), twin.run === f.run ? "rerun review-units --resume on " + f.run + " so its stops.json is rewritten, then rerun ceo rows" : "drop one of the two --run dirs: an item binds one run and there are no repair reruns, so keep the run whose ledger item first ran the session");
    byId.set(id, f);
  }
  const rows = planned.map((p) => sessionRow(rowId(p.smoke, p.arm, p.model, p.unit, p.pass), p, byId.get(rowId(p.smoke, p.arm, p.model, p.unit, p.pass)), strict));
  return { stage, smoke_round: stage === 1 ? round : null, order, suite, units, plan, runs, rows, held: new Set(byId.keys()) };
}

function rowsCmd(argv: string[], io: Io): number {
  const flags = parseFlags(argv, { "--stage": "value", "--units": "value", "--run": "repeat", "--projection": "value", "--order": "value", "--smoke-round": "value", "--out": "value", "--checks": "bool" });
  const checking = flags.has("--checks");
  if (checking && flags.has("--out")) refuse("--checks is a replay and writes nothing, so it takes no --out", "drop --out, or drop --checks to write the rows");
  const out = checking ? null : sealedOut(need(flags, "--out"), "--out");
  const b = buildRows(flags, !checking);
  for (const c of b.rows) if (c.copy_failed) io.out("copy_out: " + c.row.id + ": trial.json logged a copy-out failure" + (c.row.arm === "autoplan-ceo" ? ", so findings_written reads false" : c.row.arm === "enforced" ? ", so gate_armed reads false" : ""));
  for (const [cell, gs] of enforcedCells(b.rows)) io.out("gate: " + cell + ": " + gs.length + " session" + (gs.length === 1 ? "" : "s") + "; report exits " + gateExits(gs) + "; blocks per session " + gs.map((g) => blocksOf(g)).join(", ") + "; released on the first stop " + gs.filter((g) => releasedFirst(g)).length + " of " + gs.length);
  if (checking) {
    const held = b.rows.filter((c) => b.held.has(c.row.id));
    if (!held.length) refuse("the runs hold no session to check", "pass the --run dirs whose sessions the checks should replay");
    const failing: string[] = [];
    for (const { row, checks } of held) {
      const failed = checks.find(([, ok]) => !ok)?.[0] ?? null;
      if (failed) failing.push(row.id + " (" + failed + ")");
      io.out("session " + row.id + ": " + checks.map(([k, ok]) => k + " " + (ok ? "pass" : "fail")).join(", ") + "; end state " + row.status + (row.exposed === null ? "" : "; exposed " + row.exposed) + "; first failed: " + (failed ?? "none"));
    }
    io.out("checks: " + held.length + " sessions, " + (held.length - failing.length) + " pass, " + failing.length + " fail" + (failing.length ? ": " + failing.join(", ") : ""));
    if (!failing.length) return 0;
    io.out("fix: a failing session blocks the stage it gates (the start-order rule: stage 1 stops and goes to the Captain); rerun ceo rows --checks once the cause is fixed");
    return 1;
  }
  const rows = b.rows.map((c) => c.row);
  for (const { row, checks } of b.rows) if (row.status === "gap" && checks.some(([k, ok]) => k === "transcript_readable" && !ok) && GSTACK.includes(row.arm)) io.out("gap: " + row.id + " (transcript unreadable)");
  const cells = new Map<string, CeoRow[]>();
  for (const r of rows) cells.set((r.smoke ? "smoke " : "") + r.arm + ":" + r.model, [...(cells.get((r.smoke ? "smoke " : "") + r.arm + ":" + r.model) ?? []), r]);
  for (const [cell, rs] of cells) {
    const n = (s: string) => rs.filter((r) => r.status === s).length;
    const ws = rs.flatMap((r) => r.words);
    io.out("cell " + cell + ": " + rs.length + " planned; " + COUNTS.map((s) => n(s) + " " + s).join(", ") + "; " + rs.filter((r) => r.over_three).length + " with more than three issues, " + rs.filter((r) => r.zero_output).length + " zero-output, " + rs.filter((r) => r.follow_up).length + " follow-ups; mean issue words " + (ws.length ? (ws.reduce((x, y) => x + y, 0) / ws.length).toFixed(1) : "n/a"));
  }
  for (const cell of cells.keys()) {
    if (!cell.replace(/^smoke /, "").startsWith("autoplan-ceo:")) continue;
    const n = b.rows.filter((c) => (c.row.smoke ? "smoke " : "") + c.row.arm + ":" + c.row.model === cell && c.named && c.checks.some(([k, ok]) => k === "handoff_ceo_only" && !ok)).length;
    io.out("handoff: " + cell + ": " + n + " session" + (n === 1 ? "" : "s") + " named gstack-ceo-mode-handoff and read unexposed on handoff_ceo_only");
    const split = b.rows.filter((c) => (c.row.smoke ? "smoke " : "") + c.row.arm + ":" + c.row.model === cell && c.transcript_findings !== undefined && c.checks.some(([k, ok]) => k === "findings_written" && ok !== c.transcript_findings)).length;
    io.out("findings: " + cell + ": " + split + " session" + (split === 1 ? "" : "s") + " where the transcript reading of findings_written and the on-disk copy disagree (report-only)");
  }
  writeOut(out!, { version: 2, kind: "ceo-rows", stage: b.stage, ...(b.smoke_round ? { smoke_round: b.smoke_round } : {}), ...(b.order ? { order: b.order } : {}), parser_sha256: CEO_PARSER_SHA256, exposure_sha256: CEO_EXPOSURE_SHA256, suite: b.suite, runs: b.runs, units: b.units.map((u) => ({ id: u.id, kind: u.kind })), plan: b.plan, rows });
  io.out("rows: " + rows.length + " rows (" + COUNTS.map((s) => rows.filter((r) => r.status === s).length + " " + s).join(", ") + ") written to " + out);
  return 0;
}

interface RowsFile {
  text: string;
  stage: 1 | 2;
  suite: SuiteBinding;
  units: Array<{ id: string; kind: "changed" | "held" }>;
  plan: PassPlan | null;
  rows: CeoRow[];
  smoke_round: 1 | 2 | null;
  order: Ordered[] | null;
}
function readRows(path: string): RowsFile {
  const abs = resolve(path);
  let text = "";
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    refuse("cannot read --rows " + abs, "pass the rows.json ceo rows wrote");
  }
  let v: any;
  try {
    v = JSON.parse(text);
  } catch {
    refuse("--rows " + abs + " is not JSON", "pass the rows.json ceo rows wrote");
  }
  if (v?.kind !== "ceo-rows" || !Array.isArray(v.rows) || !Array.isArray(v.units)) refuse("--rows " + abs + " is not a ceo rows file", "pass the rows.json ceo rows wrote");
  if (v.version !== 2) refuse("--rows " + abs + " is ceo rows version " + v.version + ", not 2, so it carries no suite binding or exposure_sha256", "rebuild the rows with this checkout's ceo rows");
  if (v.parser_sha256 !== CEO_PARSER_SHA256) refuse("--rows " + abs + " came from ceo-outcome.ts " + v.parser_sha256 + ", not this checkout's", "run packets and readings from the checkout that wrote the rows");
  if (v.exposure_sha256 !== CEO_EXPOSURE_SHA256) refuse("--rows " + abs + " carries exposure_sha256 " + v.exposure_sha256 + ", not this checkout's ceo-exposure.ts " + CEO_EXPOSURE_SHA256, "run packets and readings from the checkout that wrote the rows");
  const suite = bindingOf(v.suite) ?? refuse("--rows " + abs + " names no suite binding", "rebuild the rows with this checkout's ceo rows");
  return { text, stage: v.stage, suite, units: v.units, plan: v.plan ?? null, rows: v.rows, smoke_round: v.stage === 1 ? (v.smoke_round ?? 1) : null, order: v.stage === 2 ? (v.order ?? null) : null };
}

/** stock-list.txt's two rows, each three issues with their stock fixes, cut by the same 40-word rule. */
function readStock(): Record<"A" | "B", Array<{ issue: string; fix: string }>> {
  const text = readFileSync(STOCK_LIST, "utf8");
  if (sha256(text) !== STOCK_LIST_SHA256) refuse(STOCK_LIST + " has sha256 " + sha256(text) + ", not the pinned " + STOCK_LIST_SHA256, "restore the ladder amendment's stock-list.txt from main");
  const rows: Record<"A" | "B", Array<{ issue: string; fix: string }>> = { A: [], B: [] };
  for (const line of text.split("\n").filter(Boolean)) {
    const m = line.match(/^([AB])( fix)?: (.+)$/) ?? refuse(STOCK_LIST + " has a line outside its grammar", "restore the ladder amendment's stock-list.txt from main");
    const row = rows[m[1] as "A" | "B"];
    if (m[2]) row[row.length - 1]!.fix = cut40(m[3]!);
    else row.push({ issue: cut40(m[3]!), fix: "" });
  }
  return rows;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A unit's entry in the packet key. */
export interface KeyUnit {
  unit: string;
  kind: "changed" | "held";
  d_packet: { file: string; sha256: string };
  rem_packet: { file: string; sha256: string } | null;
  reviews: Array<{ id: string; row: string; issues: number }>;
  stock: Array<{ id: string; row: "A" | "B"; issues: number }>;
}
/** The packet key: each opaque id's row or stock row, and each packet's sha256. It never travels with the packets. */
export interface CeoKey {
  version: 2;
  kind: "ceo-outcome";
  seed: number;
  rows_sha256: string;
  /** The rows' suite binding's catalogs_sha256: the units dir the packets were built from. */
  catalogs_sha256: string;
  stock_sha256: string;
  packets: Array<{ file: string; unit: string; read: "D" | "rem"; sha256: string }>;
  units: KeyUnit[];
}

function packetsCmd(argv: string[], io: Io): number {
  const flags = parseFlags(argv, { "--rows": "value", "--units": "value", "--seed": "value", "--out": "value", "--key": "value" });
  const out = sealedOut(need(flags, "--out"), "--out");
  const keyPath = sealedOut(need(flags, "--key"), "--key");
  if (inside(realPath(keyPath) ?? keyPath, realPath(out) ?? out)) refuse("--key " + keyPath + " is inside --out " + out + "; the key maps opaque ids back to rows and must never travel with the packets", "write the key beside --out, not in it");
  if (existsSync(out) && readdirSync(out).length) refuse("--out " + out + " is not empty", "give each packet build a new directory");
  const seedText = need(flags, "--seed");
  const seed = Number(seedText);
  if (!Number.isSafeInteger(seed) || seed < 0) refuse("--seed must be a whole number, not " + JSON.stringify(seedText), "pass --seed <n>, the seed recorded for this stage");
  const rows = readRows(need(flags, "--rows"));
  const units = new Map(readUnits(need(flags, "--units"), rows.suite).map((u) => [u.id, u]));
  const stock = readStock();
  const rng = seededRandom(seed);
  const key: CeoKey = { version: 2, kind: "ceo-outcome", seed, rows_sha256: sha256(rows.text), catalogs_sha256: rows.suite.catalogs_sha256, stock_sha256: STOCK_LIST_SHA256, packets: [], units: [] };
  const files: Array<[string, string]> = [];
  let reviews = 0;
  [...rows.units].sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((ru, i) => {
    const u = units.get(ru.id) ?? refuse("rows name unit " + ru.id + ", which --units doesn't hold", "pass the units dir the rows were built from");
    if (u.kind !== ru.kind) refuse("rows read unit " + ru.id + " as " + ru.kind + ", but its key.json says " + u.kind, "rerun ceo rows on this units dir");
    const judged = rows.rows.filter((r) => r.unit === u.id && !r.smoke && r.status === "scored" && r.issues.length > 0);
    type Entry = { row: string | null; stock: "A" | "B" | null; issues: string[]; fixes: string[] };
    const entries: Entry[] = [
      ...judged.map((r) => ({ row: r.id, stock: null, issues: r.issues.slice(0, 3), fixes: r.fixes.slice(0, 3) })),
      ...(u.kind === "changed" ? (["A", "B"] as const).map((s) => ({ row: null, stock: s, issues: stock[s].map((x) => x.issue), fixes: stock[s].map((x) => x.fix) })) : []),
    ];
    const order = shuffle(entries, rng);
    const ids = new Set<string>();
    const idOf = order.map(() => {
      let id = "";
      do id = "r" + Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0");
      while (ids.has(id));
      ids.add(id);
      return id;
    });
    const plan = readFileSync(join(u.dir, "plan.md"), "utf8");
    const k = u.key;
    const dKey = u.kind === "held" ? { D: null, D2: null, match_notes: null, R1: null, R2: null, R3: null, note: "This plan has no decisive issue: D is empty, so no issue matches D." } : { D: k.D, D2: k.D2, match_notes: k.match_notes, R1: k.R1, R2: k.R2, R3: k.R3 };
    const tag = "unit-" + String(i + 1).padStart(2, "0");
    const dFile = tag + "-d.json";
    const dText = JSON.stringify({ packet: dFile, read: "D", plan, key: dKey, reviews: order.map((e, j) => ({ review: idOf[j], issues: e.issues })) }, null, 2) + "\n";
    files.push([dFile, dText]);
    key.packets.push({ file: dFile, unit: u.id, read: "D", sha256: sha256(dText) });
    let rem: KeyUnit["rem_packet"] = null;
    if (u.kind === "changed" && k.remedy !== null) {
      const remFile = tag + "-rem.json";
      const remText = JSON.stringify({ packet: remFile, read: "rem", plan, remedy: { remedy: k.remedy, remedy_notes: k.remedy_notes }, reviews: order.map((e, j) => ({ review: idOf[j], issues: e.issues.map((t, n) => ({ issue: t, fix: e.fixes[n] ? e.fixes[n] : "no fix" })) })) }, null, 2) + "\n";
      files.push([remFile, remText]);
      key.packets.push({ file: remFile, unit: u.id, read: "rem", sha256: sha256(remText) });
      rem = { file: remFile, sha256: sha256(remText) };
    }
    reviews += judged.length;
    key.units.push({
      unit: u.id,
      kind: u.kind,
      d_packet: { file: dFile, sha256: sha256(dText) },
      rem_packet: rem,
      reviews: order.flatMap((e, j) => (e.row ? [{ id: idOf[j]!, row: e.row, issues: e.issues.length }] : [])),
      stock: order.flatMap((e, j) => (e.stock ? [{ id: idOf[j]!, row: e.stock, issues: e.issues.length }] : [])),
    });
  });
  mkdirSync(out, { recursive: true });
  for (const [f, text] of files) writeFileSync(join(out, f), text);
  writeOut(keyPath, key);
  const d = key.packets.filter((p) => p.read === "D").length;
  io.out("packets: " + d + " D packets (" + key.units.filter((u) => u.kind === "held").length + " held), " + (key.packets.length - d) + " remedy packets; " + reviews + " reviews and " + key.units.reduce((n, u) => n + u.stock.length, 0) + " stock rows under opaque ids; written to " + out + "; key " + keyPath);
  return 0;
}

type Label = "D" | "R1" | "R2" | "R3" | "none";
/** One judge's reply file from noloss judge-run --ceo: every packet of the key, answered or missing with its cause. */
export interface CeoReplies {
  version: 1;
  kind: "ceo-judge";
  judge: string;
  key_sha256: string;
  state: "finished" | "stopped";
  packets: Array<{ file: string; unit: string; read: "D" | "rem"; sha256: string; status: "answered" | "missing"; cause?: string; answers?: Record<string, { labels?: Label[]; leak?: "yes" | "no"; rem?: Array<"yes" | "no"> }> }>;
}

function readingsCmd(argv: string[], io: Io): number {
  const flags = parseFlags(argv, { "--rows": "value", "--key": "value", "--sol": "value", "--opus": "value", "--sonnet": "value", "--units": "value", "--projection": "value", "--out": "value" });
  const out = sealedOut(need(flags, "--out"), "--out");
  const rows = readRows(need(flags, "--rows"));
  const keyPath = resolve(need(flags, "--key"));
  let keyText = "";
  try {
    keyText = readFileSync(keyPath, "utf8");
  } catch {
    refuse("cannot read --key " + keyPath, "pass the key file ceo packets wrote");
  }
  const key = readJson(keyPath, "--key", "pass the key file ceo packets wrote") as CeoKey;
  if (key?.kind !== "ceo-outcome" || !Array.isArray(key.units)) refuse("--key " + keyPath + " is not a ceo packets key", "pass the key file ceo packets wrote");
  if (key.version !== 2 || key.catalogs_sha256 !== rows.suite.catalogs_sha256) refuse("--key " + keyPath + " was not built from the rows' units (key catalogs_sha256 " + key.catalogs_sha256 + ", rows " + rows.suite.catalogs_sha256 + ")", "rerun ceo packets on these rows with this checkout, and judge the new packets");
  if (key.rows_sha256 !== sha256(rows.text)) refuse("the key was built from other rows (rows sha256 " + key.rows_sha256 + ")", "pass the rows the key was built from, or rerun ceo packets on these rows and judge the new packets");
  const units = new Map(readUnits(need(flags, "--units"), rows.suite).map((u) => [u.id, u]));
  if (rows.stage === 2) {
    const proj = flags.get("--projection")?.[0] ?? refuse("stage 2 readings need --projection, to copy family, passes, held_passes and lens from its PASS line", "add --projection <the projection output the rows were built from>");
    if (passPlan(resolve(proj)).projection_sha256 !== rows.plan?.projection_sha256) refuse("--projection is not the projection output the rows were built from", "pass the same --projection ceo rows read");
  } else if (flags.has("--projection")) refuse("stage 1 readings take no --projection", "drop --projection");
  type Answers = Map<string, { status: "answered" | "missing"; answers: NonNullable<CeoReplies["packets"][number]["answers"]> }>;
  const judges = {} as Record<keyof typeof CEO_JUDGE_IDS, Answers>;
  for (const j of ["sol", "opus", "sonnet"] as const) {
    const dir = resolve(need(flags, "--" + j));
    const fix = "pass --" + j + " the --out dir of " + CEO_JUDGE_IDS[j] + "'s noloss judge-run --ceo run on this key";
    const r = readJson(join(dir, "replies.json"), "the " + j + " judge's replies.json", fix) as CeoReplies;
    if (r?.kind !== "ceo-judge" || !Array.isArray(r.packets)) refuse("--" + j + " " + dir + " holds no ceo judge replies", fix);
    if (r.judge !== CEO_JUDGE_IDS[j]) refuse("--" + j + " " + dir + " holds " + r.judge + "'s replies, not " + CEO_JUDGE_IDS[j] + "'s", fix);
    if (r.key_sha256 !== sha256(keyText)) refuse("--" + j + " " + dir + " answered another key", fix);
    const m: Answers = new Map();
    for (const p of key.packets) {
      const got = r.packets.find((x) => x.file === p.file);
      if (!got || got.sha256 !== p.sha256) refuse("--" + j + " " + dir + " has no record of packet " + p.file + " as the key wrote it", "rerun that judge's judge-run --ceo on this key; even a stopped run records every packet");
      m.set(p.file, { status: got!.status === "answered" ? "answered" : "missing", answers: got!.answers ?? {} });
    }
    judges[j] = m;
  }
  const missing = { sol: 0, opus: 0, sonnet: 0 };
  const remMissing = { sol: 0, opus: 0, sonnet: 0 };
  const callsFor = (ku: KeyUnit, id: string, n: number, keyed: boolean) =>
    Array.from({ length: n }, (_, i) => {
      const label = (j: keyof typeof judges): Label | null => {
        const a = judges[j].get(ku.d_packet.file)!;
        const v = a.status === "answered" ? (a.answers[id]?.labels?.[i] ?? null) : null;
        if (v === null) missing[j]++;
        return v;
      };
      const rem = (j: keyof typeof judges): boolean | null => {
        const a = ku.rem_packet ? judges[j].get(ku.rem_packet.file)! : null;
        const v = a && a.status === "answered" ? (a.answers[id]?.rem?.[i] ?? null) : null;
        if (v === null) remMissing[j]++;
        return v === null ? null : v === "yes";
      };
      return { sol: label("sol"), opus: label("opus"), sonnet: label("sonnet"), rem: keyed ? { sol: rem("sol"), opus: rem("opus"), sonnet: rem("sonnet") } : null };
    });
  const keyUnits = new Map(key.units.map((k) => [k.unit, k]));
  const unitRows = rows.units.map((ru) => {
    const u = units.get(ru.id) ?? refuse("rows name unit " + ru.id + ", which --units doesn't hold", "pass the units dir the rows were built from");
    const k = u.key;
    return { id: u.id, kind: u.kind, strict: k.strict, category: k.category, role: k.role, remedy: k.remedy !== null, remedy_kind: k.remedy_kind, decoy: k.decoy, second_order: k.second_order };
  });
  const keyed = new Map(unitRows.map((u) => [u.id, u.remedy]));
  const leakOf = (ku: KeyUnit, id: string, j: "sol" | "opus") => {
    const a = judges[j].get(ku.d_packet.file)!;
    return a.status === "answered" && a.answers[id]?.leak === "yes";
  };
  const reviews = rows.rows.map((r) => {
    const ku = keyUnits.get(r.unit) ?? refuse("the key holds no packets for unit " + r.unit, "rerun ceo packets on these rows");
    const k = ku.reviews.find((x) => x.row === r.id);
    const judgeable = !r.smoke && r.status === "scored" && r.issues.length > 0;
    if (judgeable !== !!k) refuse("row " + r.id + (judgeable ? " is scored but the key holds no review for it" : " is in the key but enters no packet"), "rerun ceo packets on these rows");
    return {
      id: r.id,
      unit: r.unit,
      arm: r.arm,
      model: r.model,
      pass: r.pass,
      smoke: r.smoke,
      status: r.status,
      exposed: r.exposed,
      labels: k ? callsFor(ku, k.id, Math.min(3, r.issues.length), keyed.get(r.unit) === true) : [],
      issues: r.issues,
      words: r.words,
      fixes: r.fixes,
      fix_words: r.fix_words,
      leak: { sol: k ? leakOf(ku, k.id, "sol") : false, opus: k ? leakOf(ku, k.id, "opus") : false },
      forecast: r.forecast,
      usd: r.usd,
      wall_s: r.wall_s,
      termination: r.termination,
      meter: r.meter ?? null,
    };
  });
  const stock = key.units.flatMap((ku) => ku.stock.map((s) => ({ unit: ku.unit, row: s.row, labels: callsFor(ku, s.id, 3, keyed.get(ku.unit) === true) })));
  const plan = rows.stage === 2 ? { family: rows.plan!.family, passes: rows.plan!.passes, held_passes: rows.plan!.held_passes, lens: rows.plan!.lens } : {};
  writeOut(out, { stage: rows.stage, ...(rows.smoke_round ? { smoke_round: rows.smoke_round } : {}), ...(rows.order ? { order: rows.order } : {}), suite: rows.suite, exposure_sha256: CEO_EXPOSURE_SHA256, units: unitRows, reviews, stock, ...plan });
  io.out("readings: stage " + rows.stage + ", " + unitRows.length + " units, " + reviews.length + " rows (" + reviews.filter((r) => r.labels.length).length + " judged), " + stock.length + " stock rows; missing D calls: sol " + missing.sol + ", opus " + missing.opus + ", sonnet " + missing.sonnet + "; missing rem calls: sol " + remMissing.sol + ", opus " + remMissing.opus + ", sonnet " + remMissing.sonnet + "; written to " + out);
  return 0;
}

const HELP = [
  "gstack-evals ceo: the CEO outcome eval's readings pipeline. Every output path must sit outside the repo.",
  "",
  "  ceo rows --stage 1|2 --units <sealed units dir> --run <review-units out dir>... [--projection <projection.txt>] --out <rows.json>",
  "  ceo rows --stage 1|2 --units <sealed units dir> --run <review-units out dir>... [--projection <projection.txt>] --checks",
  "  ceo packets --rows <rows.json> --units <sealed units dir> --seed <n> --out <packets dir> --key <key.json>",
  "  ceo readings --rows <rows.json> --key <key.json> --sol <dir> --opus <dir> --sonnet <dir> --units <sealed units dir> [--projection <projection.txt>] --out <readings.json>",
  "",
  "Stage 2 takes --projection: the projection output whose PASS line sets its cells, passes, held passes and lens.",
  "The judges read the packets through gstack-evals noloss judge-run --ceo, one judge per run.",
].join("\n");

export async function main(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): Promise<number> {
  const [sub, ...rest] = argv;
  try {
    if (sub === "rows") return rowsCmd(rest, io);
    if (sub === "packets") return packetsCmd(rest, io);
    if (sub === "readings") return readingsCmd(rest, io);
    if (sub === "--help" || sub === "-h") {
      io.out(HELP);
      return 0;
    }
    return refuse(sub === undefined ? "names no command" : "has no command " + JSON.stringify(sub), "run gstack-evals ceo rows, packets or readings; gstack-evals ceo --help lists them");
  } catch (e) {
    if (!(e instanceof CeoRefusal)) throw e;
    io.err([...("gstack-evals ceo" + (sub ? " " + sub : "") + ": " + e.message).split("\n"), "fix: " + e.fix].map((l) => "E_USAGE " + l).join("\n"));
    return 2;
  }
}

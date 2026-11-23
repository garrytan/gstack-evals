// Copyright (c) 2026 Garry Tan. MIT License.
// The /cso eval's scoring, judging and analysis commands (plan sections 5, 7, 10 and 12), dispatched by cli.ts. A work dir
// holds the unit build's units/<unit>.json and trees/<unit>/ and the arms' arms/<arm>.json; session, judged and score
// files are JSON lines. judge sends through the metering proxy on a cso-judge lease (judge/meter.ts): --probe checks each
// route with one call, the default pass judges every session not yet judged, and --check runs section 7's check on the
// stage 0 and stage 1 reports with anchors and format variants. Under deviation (b) the check's detail is sealed to the
// readout key and only judgeRelease's booleans print; analyze and readout open the sealed check with the same key.
// Section 12 keeps stage 1's per-arm outcomes sealed, so judge and score write each stage 1 and re-pilot row sealed to
// the readout key from the start (one encrypted JSON line each, no plain copy) and the meter seals its kept replies;
// every reader opens them with --key, and stage0 reads past them. Stage 0 and stage 2 rows stay plain.
// stage0, analyze and readout read only files; export (export.ts) copies a finished run dir for the Captain's drive.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { flags, type Command } from "./cli.ts";
import { csoFail, loadCsoPrereg, type CsoPrereg } from "./prereg.ts";
import type { CsoArm, CsoModel, SessionRecord, UnitRecord } from "./types.ts";
import type { CsoArmRecord } from "./arms.ts";
import { judgeRelease, type JudgeCheck } from "./analysis/release.ts";
import { isSealedRow, openCheck, openRow, readKey, readout, seal, sealCheck, sealedStage, sealRow } from "./analysis/readout.ts";
import { missMap, secondaries } from "./analysis/secondaries.ts";
import { stage0Readout } from "./analysis/stage0.ts";
import { drawPlan } from "./units/draw.ts";
import { analyze, type AnalysisInput } from "./analysis/verdicts.ts";
import { readTree, type TreeIndex } from "./score/checks.ts";
import { scoreSession, type CsoScore, type Judged } from "./score/outcomes.ts";
import { scoredText } from "./score/text.ts";
import { anchorSources, checkSetOrder, countedGoldOrder, extraFindingPool, goldFill, goldOnRun, judgeCheck, judgeSession, pilotGate, runFormatVariants, runReport, type FormatResult, type JudgeRun, type ReportResult } from "./judge/check.ts";
import { judgeRoutes, routeClients, type Transport } from "./judge/client.ts";
import { judgeItem, openJudgeMeter, probe } from "./judge/meter.ts";
import { exportCmd } from "./export.ts";
import { printCheck, rerunAnalysis } from "./analysis/rerun.ts";
import { csoExposure } from "./exposure.ts";
import { CSO_RECORDS_DIR, readRunRecords } from "./run.ts";

/** JSON lines, or one JSON array. Rows sealed to the readout key open with key; without it they stop the read (E_USAGE),
 *  or are left out when skipSealed is set. */
export function readRows<T>(path: string, key: Buffer | null = null, skipSealed = false): T[] {
  if (!existsSync(path)) csoFail("E_CSO_ANALYSIS_INPUT", path + " does not exist");
  const t = readFileSync(path, "utf8").trim();
  if (!t) return [];
  const rows: unknown[] = t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return rows.flatMap((r) => (!isSealedRow(r) ? [r as T] : key ? [openRow<T>(r, key, path)] : skipSealed ? [] : csoFail("E_USAGE", path + " holds rows sealed to the readout key; pass --key")));
}
const key = (r: { unit: string; arm: string; model: string; stage: string }) => [r.unit, r.arm, r.model, r.stage].join(" ");
const key4 = key;
const NEEDS_KEY = "stage 1 and re-pilot rows are sealed to the readout key from the start (section 12); pass --key";
const rowLine = (row: unknown, stage: string, k: Buffer | null) => (sealedStage(stage) ? sealRow(row, k ?? csoFail("E_USAGE", NEEDS_KEY)) : JSON.stringify(row));
const sealingKey = (k: Buffer | null, sessions: readonly { stage: string }[]) => (!k && sessions.some((s) => sealedStage(s.stage)) ? csoFail("E_USAGE", NEEDS_KEY) : k);
const writeNew = (path: string, text: string) => {
  if (existsSync(path)) csoFail("E_USAGE", path + " already exists; write to a new file");
  writeFileSync(path, text);
};

class Work {
  private units = new Map<string, UnitRecord>();
  private trees = new Map<string, TreeIndex>();
  constructor(readonly dir: string) {
    if (!existsSync(join(dir, "units"))) csoFail("E_CSO_ANALYSIS_INPUT", "--work " + dir + " has no units/ dir");
  }
  unit(id: string): UnitRecord {
    if (!this.units.has(id)) {
      const f = join(this.dir, "units", id + ".json");
      if (!existsSync(f)) csoFail("E_CSO_ANALYSIS_INPUT", "no unit record " + f);
      this.units.set(id, JSON.parse(readFileSync(f, "utf8")) as UnitRecord);
    }
    return this.units.get(id)!;
  }
  tree(id: string): TreeIndex {
    if (!this.trees.has(id)) {
      const d = join(this.dir, "trees", id);
      if (!existsSync(d)) csoFail("E_CSO_ANALYSIS_INPUT", "no audited tree " + d);
      this.trees.set(id, readTree(d));
    }
    return this.trees.get(id)!;
  }
  hasTree = (id: string) => existsSync(join(this.dir, "trees", id));
  arms(): Partial<Record<CsoArm, CsoArmRecord>> {
    const d = join(this.dir, "arms");
    if (!existsSync(d)) return {};
    return Object.fromEntries(readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(d, f), "utf8"))]));
  }
}

const SCORE_HELP = "Usage: gstack-evals cso score --work <dir> --sessions <file> --judged <file> --out <scores.jsonl> [--key <path>]\nScores every session (section 5) from its judged row; writes one cso-score.v1 per line to a new file. Stage 1 and re-pilot\nrows are sealed to the readout key (--key, needed when the sessions hold them); the rest stay plain.";
async function score(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--judged", "--out", "--key"], [], SCORE_HELP);
  if (!f) return 0;
  const p = loadCsoPrereg(), w = new Work(resolve(f.need("--work")));
  const given = f.has("--key") ? readKey(f.need("--key")) : null;
  const sessions = readRows<SessionRecord>(f.need("--sessions"), given);
  const k = sealingKey(given, sessions);
  const judged = new Map(readRows<{ unit: string; arm: string; model: string; stage: string; judged: Judged | null }>(f.need("--judged"), k).map((r) => [key(r), r.judged]));
  const rows = sessions.map((s) => {
    const st = scoredText(s, p);
    return rowLine(scoreSession(w.unit(s.unit), s, st, judged.get(key(s)) ?? null, s.end === "gap" ? ({ files: new Map(), byBase: new Map() } as TreeIndex) : w.tree(s.unit), p), s.stage, k);
  });
  writeNew(resolve(f.need("--out")), rows.map((r) => r + "\n").join(""));
  console.log("scored " + rows.length + " sessions");
  return 0;
}

const JUDGE_HELP = "Usage: gstack-evals cso judge --work <dir> --sessions <file> --out <dir> --run <id> [--route <name>] [--key <path>] [--check | --probe] [--record <path>] [--ledger <path>]\nSends through the metering proxy on one cso-judge lease. --probe: one call down each judge and labeller route (exit 1 if any\nfails). Default: passes A and B on every session not yet in <out>/judged.jsonl. --check: section 7's check on the stage 0\nand stage 1 reports, with anchors and format variants, sealed to the readout key in <out>/check-<route>.sealed (digest beside it);\nonly the release booleans print. With --key (needed for --check and for stage 1 or re-pilot sessions) stage 1 and re-pilot\njudged rows and every kept reply are sealed to the readout key. --pilot-gate (CSO_PLAN=rerun): judges the rerun pilot's\nsessions into <out>/judged.jsonl with gold from both labellers on each, writes <out>/pilot-gate.json and prints the gate;\nexit 1 when it fails. --pooled-check (CSO_PLAN=rerun) --parent-check <sealed> --pilot-gate-file <pilot-gate.json> --judged <file>:\nthe rerun's pooled check with gold on the counted draw, sealed to --key in <out>/check-<route>.sealed.";

/** gstack-evals cso judge; a transport replaces the metered one in tests. */
export async function judgeCmd(argv: string[], o: { transport?: Transport; env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--out", "--run", "--route", "--record", "--ledger", "--key", "--parent-check", "--pilot-gate-file", "--judged"], ["--check", "--probe", "--pilot-gate", "--pooled-check"], JUDGE_HELP);
  if (!f) return 0;
  if ([f.has("--check"), f.has("--probe"), f.has("--pilot-gate"), f.has("--pooled-check")].filter(Boolean).length > 1) csoFail("E_USAGE", "--check, --probe, --pilot-gate and --pooled-check are separate runs");
  const sealKey = f.has("--check") || f.has("--pooled-check") || f.has("--key") ? readKey(f.need("--key")) : null;
  const sessions = f.has("--probe") ? [] : readRows<SessionRecord>(f.need("--sessions"), sealKey);
  sealingKey(sealKey, sessions);
  const p = loadCsoPrereg(), out = resolve(f.need("--out"));
  const route = judgeRoutes(p).find((r) => r.route === (f.one("--route") ?? "production")) ?? csoFail("E_USAGE", "--route is one of " + judgeRoutes(p).map((r) => r.route).join(", "));
  mkdirSync(out, { recursive: true });
  const meter = o.transport ? null : await openJudgeMeter({ run_id: f.need("--run"), item: judgeItem(p), out, record: f.one("--record"), ledger: f.one("--ledger"), env: o.env, fetch: o.fetch, seal: sealKey ?? undefined });
  const transport = o.transport ?? meter!.transport;
  try {
    if (f.has("--probe")) {
      const rows = await probe(p, transport);
      for (const r of rows) console.log((r.ok ? "PASS " : "FAIL ") + r.role + " " + r.model + " (" + r.route + "): " + r.detail);
      return rows.every((r) => r.ok) ? 0 : 1;
    }
    const w = new Work(resolve(f.need("--work")));
    const clients = routeClients(route, p, transport);
    if (f.has("--pooled-check")) return await pooledCheck(w, { need: (k) => f.need(k === "--pilot-gate" ? "--pilot-gate-file" : k) }, clients, route.route, route.cells, out, sealKey!, p);
    if (f.has("--pilot-gate")) return await pilotGateRun(w, sessions, clients, route.route, route.cells, out, p);
    if (!f.has("--check")) return await judgeAll(w, sessions, clients.judge, join(out, "judged.jsonl"), route.cells, sealKey, p, route.route);
    const pilot = sessions.filter((s) => (s.stage === "stage0" || s.stage === "stage1") && s.end !== "gap" && route.cells.includes(s.model));
    const stage1 = [...new Set(sessions.filter((s) => s.stage === "stage1").map((s) => s.unit))].sort();
    const items = [
      ...pilot.map((s) => ({ id: key(s), anchor: null as "oracle" | "stock" | null, run: () => runReport(key(s), { arm: s.arm, model: s.model, anchor: null }, clients, w.unit(s.unit), s, w.tree(s.unit), p) })),
      ...stage1.flatMap((u) => anchorSources(w.unit(u), w.tree(u), p).map((a) => ({ id: a.anchor + " " + u, anchor: a.anchor, run: () => runReport(a.anchor + " " + u, { arm: null, model: null, anchor: a.anchor }, clients, w.unit(u), a.s, w.tree(u), p) }))),
    ];
    const reports: ReportResult[] = [];
    for (const it of checkSetOrder(items, p)) reports.push(await it.run());
    const formats: FormatResult[] = [];
    for (const u of checkSetOrder(stage1.map((id) => ({ id, anchor: null })), p)) {
      if (formats.length === 10) break;
      try {
        formats.push(await runFormatVariants(clients.judge, w.unit(u.id), w.tree(u.id), p));
      } catch (e) {
        if (!(e as Error).message.startsWith("E_CSO_ANCHOR")) throw e;
        console.error((e as Error).message);
      }
    }
    const check = judgeCheck(route.route, reports, formats, p);
    const stage0 = [...new Set(sessions.filter((s) => s.stage === "stage0").map((s) => s.unit))].sort();
    const anchors = (p.judge as { anchor_fill?: boolean }).anchor_fill === false ? [] : stage0.flatMap((u) => [{ id: "oracle " + u, kind: "oracle" as const }, { id: "stock " + u, kind: "stock" as const }]);
    const fill = goldFill(check, { anchors, findings: extraFindingPool(reports, p) }, p);
    const file = join(out, "check-" + route.route + ".sealed");
    const sha = sealCheck({ schema: "cso-judge-check.v1", check, reports, formats, fill }, sealKey!, file);
    console.log(JSON.stringify(judgeRelease([check])[0]));
    console.log("sealed check " + file + " sha256 " + sha);
    return 0;
  } finally {
    if (meter) {
      const c = await meter.close();
      console.error("lease " + meter.lease_id + " settled: " + meter.sent() + " calls, " + c.spent_micros + " micros spent, " + c.unknown_micros + " unknown");
    }
  }
}

/** The rerun pilot's judge gate: each pilot session judged once (its row into judged.jsonl, with its route) and gold from
 *  both labellers on the same pass A; a pilot session that ended a gap has no report, so the gate's count fails. */
async function pilotGateRun(w: Work, sessions: SessionRecord[], clients: ReturnType<typeof routeClients>, route: string, cells: readonly CsoModel[], out: string, p: CsoPrereg): Promise<number> {
  const rerun = p.rerun ?? csoFail("E_USAGE", "--pilot-gate judges the rerun pilot; set CSO_PLAN=rerun");
  const pilot = sessions.filter((s) => s.stage === "rerun-pilot");
  const want = 2 * Number((rerun.units as { pilot?: { size?: number } }).pilot?.size ?? 5);
  const file = join(out, "judged.jsonl");
  if (existsSync(file) || existsSync(join(out, "pilot-gate.json"))) csoFail("E_USAGE", out + " already holds a pilot gate run; write to a new --out");
  const reports: ReportResult[] = [];
  for (const s of pilot) {
    if (s.end === "gap" || !cells.includes(s.model)) continue;
    let run: JudgeRun | null = null;
    reports.push(await runReport(key(s), { arm: s.arm, model: s.model, anchor: null }, clients, w.unit(s.unit), s, w.tree(s.unit), p, (r) => (run = r)));
    const j = run as JudgeRun | null;
    appendFileSync(file, JSON.stringify({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, route, judged: j?.judged ?? null, refused: j?.refused ?? false, over_cap: j?.over_cap ?? false }) + "\n");
  }
  const gate = pilotGate(reports, want);
  writeNew(join(out, "pilot-gate.json"), JSON.stringify({ schema: "cso-rerun-pilot-gate.v1", route, gate, reports }, null, 1) + "\n");
  console.log(JSON.stringify(gate));
  return gate.pass ? 0 : 1;
}


/** The rerun's pooled judge check (rerun prereg section 7) on the fallback route: the parent's sealed check reports, the
 *  pilot gate's reports and gold on the counted new-cso reports in countedGoldOrder, 24 first and then, while fewer than
 *  check_reports_min are gold, up to 20 more. The parent's old cso reports join as untold, so the per-arm gate compares the
 *  new cso arm with none; the parent's format variants stand. No anchor is added, and a validity finding fill is listed but
 *  never counted, since nothing judges it. Sealed like --check; only the release prints. */
async function pooledCheck(w: Work, f: { need: (k: string) => string }, clients: ReturnType<typeof routeClients>, route: string, cells: readonly CsoModel[], out: string, key: Buffer, p: CsoPrereg): Promise<number> {
  const rerun = p.rerun ?? csoFail("E_USAGE", "--pooled-check is the rerun's check; set CSO_PLAN=rerun");
  const file = join(out, "check-" + route + ".sealed");
  if (existsSync(file)) csoFail("E_USAGE", file + " already exists; write to a new --out");
  const parent = openCheck(resolve(f.need("--parent-check")), key) as unknown as { check: JudgeCheck; reports: ReportResult[]; formats: FormatResult[] };
  if (parent.check.route !== route) csoFail("E_USAGE", "the parent check is on route " + parent.check.route + ", not " + route);
  const pilot = (JSON.parse(readFileSync(resolve(f.need("--pilot-gate")), "utf8")) as { route: string; reports: ReportResult[] });
  if (pilot.route !== route) csoFail("E_USAGE", "the pilot gate ran on route " + pilot.route + ", not " + route);
  const sessions = readRows<SessionRecord>(resolve(f.need("--sessions"))).filter((s) => s.stage === "rerun" && s.arm === "cso" && cells.includes(s.model));
  const judged = new Map(readRows<{ unit: string; arm: string; model: string; stage: string; route?: string; judged: Judged | null; refused?: boolean; over_cap?: boolean }>(resolve(f.need("--judged"))).map((r) => [key4(r), r]));
  const byKey = new Map(sessions.map((s) => [key4(s), s]));
  const units = [...new Set(sessions.map((s) => s.unit))];
  const order = countedGoldOrder(units, Number(rerun.gold_seed), (u, m) => {
    const s = byKey.get(key4({ unit: u, arm: "cso", model: m, stage: "rerun" }));
    return !!s && s.end !== "gap";
  });
  const pool: ReportResult[] = [...parent.reports.map((r) => ({ ...r, id: "parent " + r.id, arm: r.arm === "cso" ? ("untold" as const) : r.arm })), ...pilot.reports.map((r) => ({ ...r, id: "pilot " + r.id }))];
  const j = p.judge as unknown as { check_reports_min: number };
  const want = Number((rerun.judge as { labelled_outputs?: { counted_cso_sample?: number } }).labelled_outputs?.counted_cso_sample ?? 24);
  let taken = 0, check = judgeCheck(route, pool, parent.formats, p);
  for (const o of order) {
    if (taken >= want && (check.detail as { gold_reports: number }).gold_reports >= j.check_reports_min) break;
    if (taken >= want + 20) break;
    const s = byKey.get(key4({ unit: o.unit, arm: "cso", model: o.model, stage: "rerun" }))!;
    const row = judged.get(key4(s)) ?? csoFail("E_CSO_CHECK_INPUT", key4(s) + " has no judged row; judge the counted sessions first");
    if (row.route !== undefined && row.route !== route) csoFail("E_CSO_CHECK_INPUT", key4(s) + " was judged on route " + row.route + ", not " + route);
    pool.push(await goldOnRun("counted " + key4(s), { arm: "cso", model: s.model, anchor: null }, { judged: row.judged, refused: row.refused ?? false, over_cap: row.over_cap ?? false }, clients.gold, w.unit(s.unit), s, w.tree(s.unit), p));
    taken++;
    if (taken >= want) check = judgeCheck(route, pool, parent.formats, p);
  }
  check = judgeCheck(route, pool, parent.formats, p);
  const fill = goldFill(check, { anchors: [], findings: extraFindingPool(pool, p) }, p);
  const sha = sealCheck({ schema: "cso-judge-check.v1", check, reports: pool, formats: parent.formats, fill }, key, file);
  console.log(JSON.stringify(judgeRelease([check])[0]));
  if (fill.findings.length) console.log("validity finding fill not run: " + fill.findings.length + " findings short; the check reads short");
  console.log("counted gold reports drawn: " + taken + "; sealed check " + file + " sha256 " + sha);
  return 0;
}

async function judgeAll(w: Work, sessions: SessionRecord[], judge: ReturnType<typeof routeClients>["judge"], file: string, cells: readonly CsoModel[], k: Buffer | null, p: CsoPrereg, route: string): Promise<number> {
  const prior = existsSync(file) ? readRows<{ unit: string; arm: string; model: string; stage: string; route?: string }>(file, k) : [];
  const other = prior.filter((r) => r.route !== undefined && r.route !== route);
  if (other.length) csoFail("E_USAGE", file + " holds " + other.length + " rows judged on route " + other[0]!.route + ", not " + route + "; judge each route into its own --out");
  const done = new Set(prior.map(key));
  let n = 0;
  for (const s of sessions) {
    if (done.has(key(s)) || s.end === "gap" || !cells.includes(s.model)) continue;
    const st = scoredText(s, p);
    const run = await judgeSession(judge, w.unit(s.unit), st, s, w.tree(s.unit), p);
    appendFileSync(file, rowLine({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, route, judged: run.judged, refused: run.refused, over_cap: run.over_cap }, s.stage, k) + "\n");
    n++;
  }
  console.log("judged " + n + " sessions into " + file);
  return 0;
}

const STAGE0_HELP = "Usage: gstack-evals cso stage0 --work <dir> --sessions <file> --scores <file>\nSection 12's stage 0 readout: pass or fail per arm and model, with every reason. Exit 1 when an arm fails.";
async function stage0(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--scores"], [], STAGE0_HELP);
  if (!f) return 0;
  const p = loadCsoPrereg(), w = new Work(resolve(f.need("--work")));
  const sessions = readRows<SessionRecord>(f.need("--sessions"), null, true).filter((s) => s.stage === "stage0");
  const units = [...new Set(sessions.map((s) => s.unit))].sort();
  const drawn = drawPlan(p).stage0.length;
  if (units.length !== drawn) csoFail("E_CSO_ANALYSIS_INPUT", "stage 0 draws " + drawn + " units but --sessions holds stage 0 sessions for " + units.length);
  const cells = stage0Readout({ units, sessions, scores: readRows<CsoScore>(f.need("--scores"), null, true), arms: w.arms(), trees: Object.fromEntries(units.filter(w.hasTree).map((u) => [u, w.tree(u)])) }, p);
  for (const c of cells) console.log((c.pass ? "PASS " : "FAIL ") + c.model + " " + c.arm + c.reasons.map((r) => "\n  " + (r.unit ?? "arm") + ": " + r.reason).join(""));
  return cells.every((c) => c.pass) ? 0 : 1;
}

/** Per model, whether its scoring route passed on named and on validity: the production route, else its fallback. */
export function judgeByModel(checks: readonly JudgeCheck[], p: CsoPrereg): AnalysisInput["judge"] {
  const rel = new Map(judgeRelease(checks).map((r) => [r.route, r]));
  const routes = judgeRoutes(p);
  const of = (m: CsoModel) => {
    const r = routes.filter((x) => x.cells.includes(m)).map((x) => rel.get(x.route)).find((x) => x?.named_route === "pass");
    return { named: !!r, validity: r?.validity === "validated" };
  };
  return { opus: of("opus"), particle: of("particle"), sol: of("sol") };
}

const readChecks = (paths: string[], key: Buffer | null): JudgeCheck[] => paths.map((x) => openCheck(x, key ?? csoFail("E_USAGE", "--check needs --key, the readout key it was sealed to")).check);
const readIds = (path: string): string[] => readRows<string | { unit: string }>(path).map((u) => (typeof u === "string" ? u : u.unit));

const ANALYZE_HELP = "Usage: gstack-evals cso analyze --work <dir> --sessions <file> --scores <file> --judged <file> --units <stage 2 ids> --check <sealed file>... --key <path> [--headroom-admitted] [--headroom-failed] [--left-out <model>]...\nSection 10's rows, verdicts and secondaries on stage 2, printed as JSON. The miss anatomy reads each missed session's judged\nfindings (--judged) and its unit's audited tree (--work trees/).";
async function analyzeCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--scores", "--judged", "--units", "--key"], ["--headroom-admitted", "--headroom-failed"], ANALYZE_HELP, ["--check", "--left-out"]);
  if (!f) return 0;
  const p = loadCsoPrereg(), w = new Work(resolve(f.need("--work")));
  const k = f.has("--key") ? readKey(f.need("--key")) : null;
  const i: AnalysisInput = {
    units: readIds(f.need("--units")).map((u) => w.unit(u)), sessions: readRows<SessionRecord>(f.need("--sessions"), k), scores: readRows<CsoScore>(f.need("--scores"), k), judge: judgeByModel(readChecks(f.all("--check"), k), p),
    left_out: Object.fromEntries(f.all("--left-out").map((m) => [m, true])), headroom_admitted: f.has("--headroom-admitted"), headroom_failed: f.has("--headroom-failed"),
  };
  const a = analyze(i, p);
  const judged = new Map(readRows<{ unit: string; arm: string; model: string; stage: string; judged: Judged | null }>(f.need("--judged"), k).map((r) => [key(r), r.judged]));
  const misses = missMap(i, (s) => judged.get(key(s)) ?? null, (u) => w.tree(u), p);
  console.log(JSON.stringify({ rows: a.rows.map((r) => ({ model: r.model, state: r.state, p_holm: r.p_holm, p_holm_bound: r.p_holm_bound, complete: r.stats.complete, bound: r.stats.bound, complete_only: r.complete_only, mdd_points: r.mdd_points, procedure: r.stats.procedure })), verdicts: a.verdicts, split: a.split, secondaries: secondaries(i, p, misses) }, null, 1));
  return 0;
}

const READOUT_HELP = "Usage: gstack-evals cso readout --sessions <file> --scores <file> --units <stage 1 ids> --check <sealed file>... --key <path> --sealed <out> --spent <usd> --judging-per-session <usd> --vm <usd> --vm-stage2 <usd>\nSection 12's stage 1 readout: prints the release and seals every per-arm outcome and the judge detail to a new file.";
async function readoutCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--sessions", "--scores", "--units", "--key", "--sealed", "--spent", "--judging-per-session", "--vm", "--vm-stage2"], [], READOUT_HELP, ["--check"]);
  if (!f) return 0;
  const num = (k: string) => {
    const v = Number(f.need(k));
    return Number.isFinite(v) && v >= 0 ? v : csoFail("E_USAGE", k + " must be a dollar amount");
  };
  const p = loadCsoPrereg();
  const key = readKey(f.need("--key"));
  const r = readout({ units: readIds(f.need("--units")), sessions: readRows<SessionRecord>(f.need("--sessions"), key), scores: readRows<CsoScore>(f.need("--scores"), key), checks: readChecks(f.all("--check"), key), spent_usd: num("--spent"), judging_per_session_usd: num("--judging-per-session"), vm_usd: num("--vm"), vm_stage2_usd: num("--vm-stage2") }, p);
  const sha = seal(r.sealed, key, resolve(f.need("--sealed")));
  console.log(JSON.stringify({ ...r.release, sealed_sha256: sha }, null, 1));
  return 0;
}


const RERUN_ANALYZE_HELP = "Usage: gstack-evals cso rerun-analyze --work <dir> --units <ids> --old-dir <export sessions/stage2> --old-scores <file> --sessions <file> --scores <file> --new-dir <out>/<stage> (--check <sealed file>... --key <path> | --print-check)\nThe rerun's before-and-after analysis (CSO_PLAN=rerun): the new cso arm against the parent's none arm (rows and verdicts)\nand its old cso arm (rows), exposure, yield and secondaries, as JSON. --print-check is the pilot's print check: it\nassumes the judge passed, marks what can't pair, and exits 1 unless every secondary and yield field prints.";
async function rerunAnalyzeCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--units", "--old-dir", "--old-scores", "--sessions", "--scores", "--new-dir", "--key"], ["--print-check"], RERUN_ANALYZE_HELP, ["--check"]);
  if (!f) return 0;
  const p = loadCsoPrereg();
  if (!p.rerun) csoFail("E_USAGE", "rerun-analyze reads the rerun plan; set CSO_PLAN=rerun");
  const w = new Work(resolve(f.need("--work")));
  const units = readIds(f.need("--units")).map((u) => w.unit(u));
  const oldDir = resolve(f.need("--old-dir"));
  const old: SessionRecord[] = [], oldProcedure: Record<string, boolean> = {};
  for (const u of units)
    for (const arm of ["none", "cso"] as const)
      for (const m of ["opus", "particle"] as const) {
        const d = join(oldDir, u.unit, arm + "-" + m + "-0");
        if (!existsSync(join(d, "session.json"))) continue;
        old.push(JSON.parse(readFileSync(join(d, "session.json"), "utf8")) as SessionRecord);
        if (arm === "cso" && existsSync(join(d, "sdk-messages.jsonl"))) oldProcedure[u.unit + " " + m] = csoExposure(readFileSync(join(d, "sdk-messages.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)), [], { fixed: true }).exposure.procedure_ran;
      }
  const oldScores = readRows<CsoScore>(f.need("--old-scores"));
  const newDir = resolve(f.need("--new-dir"));
  const runRecords: Record<string, { runs: number; findings: number }> = {};
  for (const u of existsSync(newDir) ? readdirSync(newDir) : [])
    for (const s of existsSync(join(newDir, u)) ? readdirSync(join(newDir, u)) : []) {
      const m = /^cso-(opus|particle)-\d+$/.exec(s);
      if (!m) continue;
      const recs = readRunRecords(join(newDir, u, s, CSO_RECORDS_DIR)) as { findings?: unknown[] }[];
      const prev = runRecords[u + " " + m[1]] ?? { runs: 0, findings: 0 };
      runRecords[u + " " + m[1]] = { runs: prev.runs + recs.length, findings: prev.findings + recs.reduce((a, r) => a + (Array.isArray(r.findings) ? r.findings.length : 0), 0) };
    }
  const k = f.has("--key") ? readKey(f.need("--key")) : null;
  const judge = f.has("--print-check") ? { opus: { named: true, validity: true }, particle: { named: true, validity: true }, sol: { named: false, validity: false } } : judgeByModel(readChecks(f.all("--check"), k), p);
  const split = (xs: SessionRecord[]) => ({ none: xs.filter((s) => s.arm === "none"), old: xs.filter((s) => s.arm === "cso") });
  const sp = split(old);
  const a = rerunAnalysis({ units, none: { sessions: sp.none, scores: oldScores }, old: { sessions: sp.old, scores: oldScores }, fresh: { sessions: readRows<SessionRecord>(f.need("--sessions")), scores: readRows<CsoScore>(f.need("--scores")) }, oldProcedure, runRecords, judge, headroom_admitted: true }, p);
  if (!f.has("--print-check")) {
    console.log(JSON.stringify(a, null, 1));
    return 0;
  }
  const c = printCheck(a);
  console.log(JSON.stringify({ print_check: { pass: c.pass, missing: c.missing }, analysis: c.out }, null, 1));
  return c.pass ? 0 : 1;
}

export const JUDGE_COMMANDS: Record<string, Command> = { score, judge: (a) => judgeCmd(a), stage0, analyze: analyzeCmd, readout: readoutCmd, export: exportCmd, "rerun-analyze": rerunAnalyzeCmd };

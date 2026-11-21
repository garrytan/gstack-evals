// Copyright (c) 2026 Garry Tan. MIT License.
// The /cso eval's scoring, judging and analysis commands (plan sections 5, 7, 10 and 12), dispatched by cli.ts. A work dir
// holds the unit build's units/<unit>.json and trees/<unit>/ and the arms' arms/<arm>.json; session, judged and score
// files are JSON lines. judge sends through the metering proxy on a cso-judge lease (judge/meter.ts): --probe checks each
// route with one call, the default pass judges every session not yet judged, and --check runs section 7's check on the
// stage 0 and stage 1 reports with anchors and format variants. Its check file holds counts and kappas, so it stays in
// the run's private export until readout seals it. stage0, analyze and readout read only files.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { flags, type Command } from "./cli.ts";
import { csoFail, loadCsoPrereg, type CsoPrereg } from "./prereg.ts";
import type { CsoArm, CsoModel, SessionRecord, UnitRecord } from "./types.ts";
import type { CsoArmRecord } from "./arms.ts";
import { judgeRelease, type JudgeCheck } from "./analysis/release.ts";
import { readKey, readout, seal } from "./analysis/readout.ts";
import { secondaries } from "./analysis/secondaries.ts";
import { stage0Readout } from "./analysis/stage0.ts";
import { analyze, type AnalysisInput } from "./analysis/verdicts.ts";
import { readTree, type TreeIndex } from "./score/checks.ts";
import { scoreSession, type CsoScore, type Judged } from "./score/outcomes.ts";
import { scoredText } from "./score/text.ts";
import { anchorSources, checkSetOrder, goldFill, judgeCheck, judgeSession, runFormatVariants, runReport, type FormatResult, type ReportResult } from "./judge/check.ts";
import { judgeRoutes, routeClients, type Transport } from "./judge/client.ts";
import { openJudgeMeter, probe } from "./judge/meter.ts";

/** JSON lines, or one JSON array. */
export function readRows<T>(path: string): T[] {
  if (!existsSync(path)) csoFail("E_CSO_ANALYSIS_INPUT", path + " does not exist");
  const t = readFileSync(path, "utf8").trim();
  if (!t) return [];
  return t.startsWith("[") ? (JSON.parse(t) as T[]) : t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}
const key = (r: { unit: string; arm: string; model: string; stage: string }) => [r.unit, r.arm, r.model, r.stage].join(" ");
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

const SCORE_HELP = "Usage: gstack-evals cso score --work <dir> --sessions <file> --judged <file> --out <scores.jsonl>\nScores every session (section 5) from its judged row; writes one cso-score.v1 per line to a new file.";
async function score(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--judged", "--out"], [], SCORE_HELP);
  if (!f) return 0;
  const p = loadCsoPrereg(), w = new Work(resolve(f.need("--work")));
  const judged = new Map(readRows<{ unit: string; arm: string; model: string; stage: string; judged: Judged | null }>(f.need("--judged")).map((r) => [key(r), r.judged]));
  const rows = readRows<SessionRecord>(f.need("--sessions")).map((s) => {
    const st = scoredText(s, p);
    return JSON.stringify(scoreSession(w.unit(s.unit), s, st, judged.get(key(s)) ?? null, s.end === "gap" ? ({ files: new Map(), byBase: new Map() } as TreeIndex) : w.tree(s.unit), p));
  });
  writeNew(resolve(f.need("--out")), rows.map((r) => r + "\n").join(""));
  console.log("scored " + rows.length + " sessions");
  return 0;
}

const JUDGE_HELP = "Usage: gstack-evals cso judge --work <dir> --sessions <file> --out <dir> --run <id> [--route <name>] [--check | --probe] [--record <path>] [--ledger <path>]\nSends through the metering proxy on one cso-judge lease. --probe: one call down each judge and labeller route (exit 1 if any\nfails). Default: passes A and B on every session not yet in <out>/judged.jsonl. --check: section 7's check on the stage 0\nand stage 1 reports, with anchors and format variants, written to <out>/check-<route>.json.";

/** gstack-evals cso judge; a transport replaces the metered one in tests. */
export async function judgeCmd(argv: string[], o: { transport?: Transport } = {}): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--out", "--run", "--route", "--record", "--ledger"], ["--check", "--probe"], JUDGE_HELP);
  if (!f) return 0;
  if (f.has("--check") && f.has("--probe")) csoFail("E_USAGE", "--check and --probe are separate runs");
  const p = loadCsoPrereg(), out = resolve(f.need("--out"));
  const route = judgeRoutes(p).find((r) => r.route === (f.one("--route") ?? "production")) ?? csoFail("E_USAGE", "--route is one of " + judgeRoutes(p).map((r) => r.route).join(", "));
  mkdirSync(out, { recursive: true });
  const meter = o.transport ? null : await openJudgeMeter({ run_id: f.need("--run"), out, record: f.one("--record"), ledger: f.one("--ledger") });
  const transport = o.transport ?? meter!.transport;
  try {
    if (f.has("--probe")) {
      const rows = await probe(p, transport);
      for (const r of rows) console.log((r.ok ? "PASS " : "FAIL ") + r.role + " " + r.model + " (" + r.route + "): " + r.detail);
      return rows.every((r) => r.ok) ? 0 : 1;
    }
    const w = new Work(resolve(f.need("--work")));
    const sessions = readRows<SessionRecord>(f.need("--sessions"));
    const clients = routeClients(route, p, transport);
    if (!f.has("--check")) return await judgeAll(w, sessions, clients.judge, join(out, "judged.jsonl"), route.cells, p);
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
    const fill = goldFill(check, { anchors: stage0.flatMap((u) => [{ id: "oracle " + u, kind: "oracle" as const }, { id: "stock " + u, kind: "stock" as const }]), findings: [] }, p);
    writeNew(join(out, "check-" + route.route + ".json"), JSON.stringify({ check, reports, formats, fill }, null, 1) + "\n");
    console.log(JSON.stringify(judgeRelease([check])[0]));
    if (fill.anchors.length || fill.findings.length || fill.still_short.length) console.log("gold fill: " + JSON.stringify(fill));
    return 0;
  } finally {
    if (meter) {
      const c = await meter.close();
      console.log("lease " + meter.lease_id + " settled: " + meter.sent() + " calls, " + c.spent_micros + " micros spent, " + c.unknown_micros + " unknown");
    }
  }
}

async function judgeAll(w: Work, sessions: SessionRecord[], judge: ReturnType<typeof routeClients>["judge"], file: string, cells: readonly CsoModel[], p: CsoPrereg): Promise<number> {
  const done = new Set(existsSync(file) ? readRows<{ unit: string; arm: string; model: string; stage: string }>(file).map(key) : []);
  let n = 0;
  for (const s of sessions) {
    if (done.has(key(s)) || s.end === "gap" || !cells.includes(s.model)) continue;
    const st = scoredText(s, p);
    const run = await judgeSession(judge, w.unit(s.unit), st, s, w.tree(s.unit), p);
    appendFileSync(file, JSON.stringify({ unit: s.unit, arm: s.arm, model: s.model, stage: s.stage, judged: run.judged, refused: run.refused, over_cap: run.over_cap }) + "\n");
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
  const sessions = readRows<SessionRecord>(f.need("--sessions")).filter((s) => s.stage === "stage0");
  const units = [...new Set(sessions.map((s) => s.unit))].sort();
  const cells = stage0Readout({ units, sessions, scores: readRows<CsoScore>(f.need("--scores")), arms: w.arms(), trees: Object.fromEntries(units.filter(w.hasTree).map((u) => [u, w.tree(u)])) }, p);
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

const readChecks = (paths: string[]): JudgeCheck[] => paths.map((x) => (JSON.parse(readFileSync(x, "utf8")) as { check: JudgeCheck }).check);
const readIds = (path: string): string[] => readRows<string | { unit: string }>(path).map((u) => (typeof u === "string" ? u : u.unit));

const ANALYZE_HELP = "Usage: gstack-evals cso analyze --work <dir> --sessions <file> --scores <file> --units <stage 2 ids> --check <file>... [--headroom-admitted] [--headroom-failed] [--left-out <model>]...\nSection 10's rows, verdicts and secondaries on stage 2, printed as JSON.";
async function analyzeCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--work", "--sessions", "--scores", "--units"], ["--headroom-admitted", "--headroom-failed"], ANALYZE_HELP, ["--check", "--left-out"]);
  if (!f) return 0;
  const p = loadCsoPrereg(), w = new Work(resolve(f.need("--work")));
  const i: AnalysisInput = {
    units: readIds(f.need("--units")).map((u) => w.unit(u)), sessions: readRows<SessionRecord>(f.need("--sessions")), scores: readRows<CsoScore>(f.need("--scores")), judge: judgeByModel(readChecks(f.all("--check")), p),
    left_out: Object.fromEntries(f.all("--left-out").map((m) => [m, true])), headroom_admitted: f.has("--headroom-admitted"), headroom_failed: f.has("--headroom-failed"),
  };
  const a = analyze(i, p);
  console.log(JSON.stringify({ rows: a.rows.map((r) => ({ model: r.model, state: r.state, p_holm: r.p_holm, p_holm_bound: r.p_holm_bound, complete: r.stats.complete, bound: r.stats.bound, complete_only: r.complete_only, mdd_points: r.mdd_points, procedure: r.stats.procedure })), verdicts: a.verdicts, split: a.split, secondaries: secondaries(i, p) }, null, 1));
  return 0;
}

const READOUT_HELP = "Usage: gstack-evals cso readout --sessions <file> --scores <file> --units <stage 1 ids> --check <file>... --key <path> --sealed <out> --spent <usd> --judging-per-session <usd> --vm <usd> --vm-stage2 <usd>\nSection 12's stage 1 readout: prints the release and seals every per-arm outcome and the judge detail to a new file.";
async function readoutCmd(argv: string[]): Promise<number> {
  const f = flags(argv, ["--sessions", "--scores", "--units", "--key", "--sealed", "--spent", "--judging-per-session", "--vm", "--vm-stage2"], [], READOUT_HELP, ["--check"]);
  if (!f) return 0;
  const num = (k: string) => {
    const v = Number(f.need(k));
    return Number.isFinite(v) && v >= 0 ? v : csoFail("E_USAGE", k + " must be a dollar amount");
  };
  const p = loadCsoPrereg();
  const key = readKey(f.need("--key"));
  const r = readout({ units: readIds(f.need("--units")), sessions: readRows<SessionRecord>(f.need("--sessions")), scores: readRows<CsoScore>(f.need("--scores")), checks: readChecks(f.all("--check")), spent_usd: num("--spent"), judging_per_session_usd: num("--judging-per-session"), vm_usd: num("--vm"), vm_stage2_usd: num("--vm-stage2") }, p);
  const sha = seal(r.sealed, key, resolve(f.need("--sealed")));
  console.log(JSON.stringify({ ...r.release, sealed_sha256: sha }, null, 1));
  return 0;
}

export const JUDGE_COMMANDS: Record<string, Command> = { score, judge: (a) => judgeCmd(a), stage0, analyze: analyzeCmd, readout: readoutCmd };

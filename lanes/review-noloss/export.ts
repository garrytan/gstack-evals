// Copyright (c) 2026 Garry Tan. MIT License.
// noloss export (plan section 4): scores every ingested arm of a suite and every comparison in its comparisons file as
// one Holm family, regenerates the power table, and writes tables/review-noloss.json, with a markdown render on stdout.
// The table holds counts, rates, digests and labels only, so a sealed suite's table could be published; its arms and
// outputs still never live inside the repo. export --check recomputes the table and fails when the committed one differs.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readIngested } from "./ingest.ts";
import { powerTable, renderPowerTable, spreadValue, suiteClusters, type PowerDesign, type PowerRow } from "./power.ts";
import { armMetrics, mtok, renderRecord, scoreComparisons, ScoreError, type ArmMetrics, type Comparison, type ScoredArm, type ScoreRecord } from "./score.ts";
import { insideRepo, LANE_DIR, loadSuite, REPO_ROOT, sha256, suiteFromCatalog, type Suite } from "./suite.ts";

export const TABLE_PATH = join(REPO_ROOT, "tables", "review-noloss.json");
export const COMPARISONS_DIR = join(LANE_DIR, "comparisons");
export const EXPORT_VERSION = 1;

export interface PowerSpec {
  what: string;
  recall: number;
  spread: string;
  margins: number[];
  loss_points: number | null;
  sims: number;
  seed: number;
  designs: Array<{ label: string; suite: string; passes: number; catalogs?: string[]; released?: string; extra_single_blocker_prs?: number }>;
}

export interface ComparisonsFile {
  schema_version: 1;
  suite: string;
  decision_rule: string;
  seed: number;
  draws: number;
  comparisons: Comparison[];
  power?: PowerSpec;
}

const bad = (path: string, message: string): never => {
  throw new ScoreError("E_NOLOSS_SUITE", "comparisons file " + path + ": " + message);
};

/** Reads and checks a comparisons file: every comparison names its arms, a margin with its reason, and post hoc status. */
export function loadComparisons(path: string): { file: ComparisonsFile; sha256: string } {
  let bytes: Buffer;
  let file: ComparisonsFile;
  try {
    bytes = readFileSync(path);
    file = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return bad(path, "cannot read it as JSON: " + (e as Error).message);
  }
  if (file?.schema_version !== 1) bad(path, "schema_version must be 1");
  if (typeof file.suite !== "string" || typeof file.decision_rule !== "string" || !file.decision_rule.trim()) bad(path, "needs suite and decision_rule");
  if (!Number.isSafeInteger(file.seed) || !Number.isSafeInteger(file.draws) || file.draws < 1000) bad(path, "seed must be an integer and draws an integer of at least 1000");
  if (!Array.isArray(file.comparisons) || !file.comparisons.length) bad(path, "needs at least one comparison");
  const ids = new Set<string>();
  for (const c of file.comparisons) {
    const at = "comparison " + JSON.stringify(c?.id);
    if (typeof c?.id !== "string" || ids.has(c.id)) bad(path, at + ": each comparison needs a unique id");
    ids.add(c.id);
    if (typeof c.variant !== "string" || typeof c.reference !== "string" || c.variant === c.reference) bad(path, at + ": variant and reference are two arm ids");
    if (typeof c.margin_points !== "number" || !(c.margin_points >= 0) || typeof c.margin_reason !== "string" || !c.margin_reason.trim()) bad(path, at + ": needs margin_points and margin_reason; there is no default margin");
    if (typeof c.post_hoc !== "boolean") bad(path, at + ": post_hoc must be true or false");
    if (c.frozen_bar !== null && typeof c.frozen_bar !== "string") bad(path, at + ": frozen_bar is a round or null");
    const s = c.size_rule as Record<string, unknown> | undefined;
    if (s !== undefined && !(typeof s.power === "number" && typeof s.source === "string") && !(Number.isSafeInteger(s.power_sims) && (s.power_sims as number) > 0)) bad(path, at + ": size_rule is {power, source} or {power_sims, spread}");
  }
  return { file, sha256: sha256(bytes!) };
}

/** Every ingested arm of the suite under root. */
export function loadArms(root: string, suite: Suite, suiteSha256: string): Map<string, ScoredArm> {
  const dir = join(root, suite.id);
  const arms = new Map<string, ScoredArm>();
  if (!existsSync(dir)) return arms;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || !lstatSync(join(dir, name)).isDirectory()) continue;
    const r = readIngested(join(dir, name), suite, suiteSha256);
    arms.set(r.arm.arm.id, { arm: r.arm, tree_sha256: r.treeSha256 });
  }
  return arms;
}

function designs(spec: PowerSpec): PowerDesign[] {
  return spec.designs.map((d) => {
    const base = loadSuite(d.suite).suite;
    const suite = d.catalogs?.length ? suiteFromCatalog({ id: base.id + "-power", catalogs: d.catalogs, released: d.released ?? null, base }) : base;
    return { label: d.label, clusters: [...suiteClusters(suite), ...Array.from({ length: d.extra_single_blocker_prs ?? 0 }, () => 1)], passes: d.passes };
  });
}

export interface ExportTable {
  schema_version: 1;
  record: "noloss-export";
  version: number;
  note: string;
  suite: { id: string; sha256: string; development_only: boolean; sealed: boolean };
  comparisons_file: { path: string; sha256: string };
  decision_rule: string;
  seed: number;
  draws: number;
  holm: string;
  arms: ArmMetrics[];
  comparisons: ScoreRecord[];
  power: (Omit<PowerSpec, "designs"> & { rows: PowerRow[] }) | null;
}

export function buildExport(o: { comparisons: string; root: string }): ExportTable {
  const { file, sha256: fileSha } = loadComparisons(o.comparisons);
  const { suite, sha256: suiteSha } = loadSuite(file.suite);
  if (suite.sealed && insideRepo(o.root)) throw new ScoreError("E_NOLOSS_SUITE", "suite " + suite.id + " is sealed, and the arms root " + o.root + " is inside the repo; keep sealed arms outside it");
  const arms = loadArms(o.root, suite, suiteSha);
  const opts = { seed: file.seed, draws: file.draws };
  const power = file.power ? (({ designs: _, ...rest }) => rest)(file.power) : null;
  return {
    schema_version: 1,
    record: "noloss-export",
    version: EXPORT_VERSION,
    note: "Generated by gstack-evals noloss export from the ingested arms and the comparisons file; do not edit by hand. CI runs export --check.",
    suite: { id: suite.id, sha256: suiteSha, development_only: suite.development_only, sealed: suite.sealed },
    comparisons_file: { path: relative(REPO_ROOT, resolve(o.comparisons)), sha256: fileSha },
    decision_rule: file.decision_rule,
    seed: file.seed,
    draws: file.draws,
    holm: "p_no_loss is Holm-adjusted across the " + file.comparisons.length + " comparisons below; the LOSS test is not adjusted",
    arms: [...arms.values()].map((a) => armMetrics(suite, a, opts)),
    comparisons: scoreComparisons(suite, suiteSha, arms, file.comparisons, opts),
    power: power && file.power ? { ...power, rows: powerTable(designs(file.power), { recall: file.power.recall, spread: spreadValue(file.power.spread), margins: file.power.margins, loss_points: file.power.loss_points, sims: file.power.sims, seed: file.power.seed }) } : null,
  };
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : (x * 100).toFixed(1) + "%");
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));

/** The table as markdown: arms, then each comparison with its frozen bar first, then the power table. */
export function renderExport(t: ExportTable): string {
  const out: string[] = [];
  out.push("# Review no-loss: " + t.suite.id, "");
  out.push("Suite " + t.suite.id + " (sha256 " + t.suite.sha256.slice(0, 12) + ")" + (t.suite.development_only ? ", development-only: it ranks variants but cannot confirm a release on its own" : "") + ". Comparisons from " + t.comparisons_file.path + "; seed " + t.seed + ", " + t.draws + " bootstrap draws. " + t.holm + ".", "");
  out.push("## Arms", "");
  out.push("| Arm | Judging | Blocking recall [95% CI] | Detection | PR hit / any | F/(F+D) | New blocking per PR | Tokens per unit (grade, units) | Tokens per blocker found |", "|---|---|---|---|---|---|---|---|---|");
  for (const a of t.arms) {
    const judging = [a.judging.labelled ? "labelled judging" : "blind", a.provenance === "transcribed" ? "transcribed" : "live", a.status === "stopped" ? "stopped" : ""].filter(Boolean).join(", ") + " (" + pct(a.judging.blind_share) + " blind)";
    const b = a.blocking;
    const recall = b ? num(b.found) + "/" + b.n + " = " + pct(b.recall) + (b.ci95 ? " [" + pct(b.ci95[0]) + ", " + pct(b.ci95[1]) + "]" : "") : "n/a";
    const det = a.detection ? num(a.detection.found) + "/" + a.detection.n : "n/a";
    const hit = a.pr_hit_any.all ? pct(a.pr_hit_any.all.hit) + " / " + pct(a.pr_hit_any.all.any) : "n/a";
    const cost = a.cost ? mtok(a.cost.per_unit_mean) + " (" + a.cost.grade + ", " + a.cost.units + ")" : "not metered";
    out.push("| " + [a.label.startsWith(a.id + ":") ? a.label : a.id + ": " + a.label, judging, recall, det, hit, pct(a.f_share), a.new_blocking ? num(a.new_blocking.per_pr) : "n/a (" + a.new_blocking_reason + ")", cost, a.cost ? mtok(a.cost.per_blocker_found) : "n/a"].join(" | ") + " |");
  }
  out.push("", "## Comparisons", "");
  for (const r of t.comparisons) {
    out.push("### " + r.id, "");
    for (const line of renderRecord(r)) out.push("- " + line);
    out.push("");
  }
  if (t.power) {
    out.push("## Size rule: power", "", t.power.what, "");
    out.push(...renderPowerTable(t.power.rows, t.power.margins, t.power.loss_points));
    out.push("", "Each figure is a share of " + t.power.sims + " seeded simulations (seed " + t.power.seed + "), good to about " + Math.ceil(196 * Math.sqrt(0.25 / t.power.sims) * 10) / 10 + " points.");
  }
  return out.join("\n").trimEnd() + "\n";
}

export const tableText = (t: ExportTable) => JSON.stringify(t, null, 2) + "\n";

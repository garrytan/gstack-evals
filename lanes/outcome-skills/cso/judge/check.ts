// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 7's pipeline and check (R78). judgeSession runs pass A then pass B for one report; goldReport runs one gold
// labeller's two calls (its own key-blind finding list, then hit labels for its own counted findings and validity for
// pass A's). Gold is every item where both labellers agree. judgeCheck turns a route's check-set results into
// analysis/release.ts's JudgeCheck: the gold minimums, named kappa on all gold and on non-anchor gold (an undefined kappa
// fails), the per-arm gate, the format variants and near misses, the refusal limit, the over-cap gold-drop limit and
// validity kappa. Anchors (an oracle report and a stock report per stage 1 unit) are at most anchor_share_max of the check
// set as sent. The judging order is seeded with check_seed.
import { createHash } from "node:crypto";
import { seededRandom } from "../../../../src/runner/stats/paired.ts";
import { csoFail, type CsoPrereg } from "../prereg.ts";
import type { CsoArm, CsoModel, HelperRecords, SessionRecord, UnitRecord } from "../types.ts";
import type { JudgeCheck } from "../analysis/release.ts";
import type { TreeIndex } from "../score/checks.ts";
import { findingOutcome, fixFiles, scoringRules, type Judged } from "../score/outcomes.ts";
import { scoredText, type ScoredText } from "../score/text.ts";
import { askParsed, type JudgeClient } from "./client.ts";
import { passAPacket, passBPacket } from "./packets.ts";
import { parseGoldSecond, parsePassA, parsePassB, type Finding, type Validity } from "./schema.ts";

type Src = Pick<SessionRecord, "texts" | "helper">;
export interface JudgeRun { judged: Judged | null; refused: boolean; over_cap: boolean }

/** Pass A then pass B for one report. No assistant text needs no call; an over-cap pass B packet is a judge gap. */
export async function judgeSession(judge: JudgeClient, u: UnitRecord, st: ScoredText, s: Src, tree: TreeIndex, p: CsoPrereg): Promise<JudgeRun> {
  if (st.empty) return { judged: null, refused: false, over_cap: false };
  const a = await askParsed(judge, passAPacket(st.text), parsePassA);
  if ("gap" in a) return { judged: { findings: { gap: a.gap }, labels: null }, refused: a.refused, over_cap: false };
  const counted = a.value.slice(0, scoringRules(p).first_k);
  if (!counted.length) return { judged: { findings: a.value, labels: [] }, refused: false, over_cap: false };
  const packet = passBPacket({ unit: u, helper: s.helper, tree, label: counted }, p);
  if (packet.over_cap) return { judged: { findings: a.value, labels: { gap: "pass B packet over the input cap after trimming" } }, refused: false, over_cap: true };
  const b = await askParsed(judge, packet.text, (t) => parsePassB(t, counted.length));
  return { judged: { findings: a.value, labels: "gap" in b ? { gap: b.gap } : b.value }, refused: "gap" in b && b.refused, over_cap: false };
}

/** Production named from a judge run: null on a gap, false with no text or no counted finding. */
export function namedOf(run: JudgeRun, u: UnitRecord, s: Src, tree: TreeIndex, p: CsoPrereg): { named: boolean | null; validity: Validity[] } {
  const j = run.judged;
  if (!j) return { named: false, validity: [] };
  if (!Array.isArray(j.findings) || !Array.isArray(j.labels)) return { named: null, validity: [] };
  const r = scoringRules(p), labels = j.labels;
  const fo = j.findings.slice(0, r.first_k).map((f, i) => findingOutcome(f, labels[i]!, u, s, tree, r));
  return { named: fo.some((o) => o.hit), validity: fo.map((o) => o.validity) };
}

export interface GoldResult { named: boolean | null; validity: Validity[] | null; refused: boolean; over_cap: boolean }

/** One gold labeller's two calls on one report. passA is the production pass A's counted findings. */
export async function goldReport(c: JudgeClient, u: UnitRecord, st: ScoredText, s: Src, passA: readonly Finding[], tree: TreeIndex, p: CsoPrereg): Promise<GoldResult> {
  if (st.empty) return { named: false, validity: [], refused: false, over_cap: false };
  const r = scoringRules(p);
  const a = await askParsed(c, passAPacket(st.text), parsePassA);
  if ("gap" in a) return { named: null, validity: null, refused: a.refused, over_cap: false };
  const own = a.value.slice(0, r.first_k);
  if (!own.length && !passA.length) return { named: false, validity: [], refused: false, over_cap: false };
  const packet = passBPacket({ unit: u, helper: s.helper, tree, label: own, validityOnly: [...passA] }, p);
  if (packet.over_cap) return { named: null, validity: null, refused: false, over_cap: true };
  const b = await askParsed(c, packet.text, (t) => parseGoldSecond(t, own.length, passA.length));
  if ("gap" in b) return { named: null, validity: null, refused: b.refused, over_cap: false };
  return { named: own.some((f, i) => findingOutcome(f, b.value.own[i]!, u, s, tree, r).hit), validity: b.value.pass_a, refused: false, over_cap: false };
}

/** One check-set report's results on one route. arm and model are null for an anchor. */
export interface ReportResult {
  id: string; arm: CsoArm | null; model: CsoModel | null; anchor: "oracle" | "stock" | null;
  production: { named: boolean | null; validity: Validity[]; refused: boolean };
  gold: [GoldResult, GoldResult];
  /** How many findings the production pass A listed, counted findings and the rest. */
  findings_total?: number;
}
/** One format-variant unit: the production named label for the table row and the prose paragraph, and for each near miss. */
export interface FormatResult { unit: string; table: boolean | null; prose: boolean | null; near_class: boolean | null; near_lines: boolean | null }

/** The format-variant thresholds in prereg.json judge.format_variants' text. */
export const FORMAT = { units: 10, same_min: 9, near_misses: 20, not_hit_min: 18 } as const;

/** Cohen's kappa over any label set; null when chance agreement is 1 (undefined) or there are no items. */
export function kappa<T>(pairs: readonly [T, T][]): number | null {
  if (!pairs.length) return null;
  const n = pairs.length, cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe >= 1 ? null : (po - pe) / (1 - pe);
}

interface CheckRules { kappa_min: number; kappa_non_anchor_min: number; check_reports_min: number; check_findings_min: number; class_min: number; anchor_share_max: number; refusal_max: number; gold_overcap_max: number }
const PER_ARM_MAX = 0.1;

/** Gold named for a report: both labellers gave a label, neither was over the cap, and they agree. */
export const goldNamed = (r: ReportResult): boolean | null => (r.gold.every((g) => g.named !== null && !g.over_cap) && r.gold[0].named === r.gold[1].named ? r.gold[0].named : null);

/** One route's check (E_CSO_CHECK_INPUT on a duplicate report id). */
export function judgeCheck(route: string, reports: readonly ReportResult[], formats: readonly FormatResult[], p: CsoPrereg): JudgeCheck {
  const j = p.judge as unknown as CheckRules;
  if (new Set(reports.map((r) => r.id)).size !== reports.length) csoFail("E_CSO_CHECK_INPUT", route + ": a report id is listed twice");
  const n = reports.length;
  const gold = reports.map((r) => ({ r, g: goldNamed(r) })).filter((x) => x.g !== null && x.r.production.named !== null) as { r: ReportResult; g: boolean }[];
  const k = (xs: typeof gold) => kappa(xs.map((x) => [x.r.production.named!, x.g] as [boolean, boolean]));
  const kAll = k(gold), kNon = k(gold.filter((x) => !x.r.anchor));
  const classes = { named: gold.filter((x) => x.g).length, not_named: gold.filter((x) => !x.g).length };
  const dis = (arm: CsoArm) => {
    const xs = gold.filter((x) => !x.r.anchor && x.r.arm === arm);
    return xs.length ? xs.filter((x) => x.r.production.named !== x.g).length / xs.length : null;
  };
  const perArm = { cso: dis("cso"), none: dis("none") };
  const vPairs: [Validity, Validity][] = [];
  for (const r of reports) {
    const [a, b] = r.gold;
    if (!a.validity || !b.validity || a.over_cap || b.over_cap) continue;
    r.production.validity.forEach((v, i) => {
      const x = a.validity![i], y = b.validity![i];
      if (x && x === y && x !== "cant_tell") vPairs.push([v, x]);
    });
  }
  const vClasses = { supported: vPairs.filter(([, g]) => g === "supported").length, unsupported: vPairs.filter(([, g]) => g === "unsupported").length };
  const kVal = kappa(vPairs);
  const anchors = reports.filter((r) => r.anchor).length;
  const refusals = reports.filter((r) => r.production.refused).length;
  const overcap = reports.filter((r) => r.gold.some((g) => g.over_cap));
  const byCell: Record<string, number> = {};
  for (const r of overcap) byCell[(r.arm ?? "anchor") + " " + (r.model ?? r.anchor)] = (byCell[(r.arm ?? "anchor") + " " + (r.model ?? r.anchor)] ?? 0) + 1;
  const same = formats.filter((f) => f.table !== null && f.table === f.prose).length;
  const notHit = formats.reduce((a, f) => a + (f.near_class === false ? 1 : 0) + (f.near_lines === false ? 1 : 0), 0);
  const ge = (x: number | null, min: number) => x !== null && x >= min;
  return {
    route,
    minimums: {
      named_reports: gold.length >= j.check_reports_min,
      named_class: classes.named >= j.class_min && classes.not_named >= j.class_min,
      validity_findings: vPairs.length >= j.check_findings_min,
      validity_class: vClasses.supported >= j.class_min && vClasses.unsupported >= j.class_min,
      anchor_share: n > 0 && anchors / n <= j.anchor_share_max,
    },
    gates: {
      named_kappa_all: ge(kAll, j.kappa_min),
      named_kappa_non_anchor: ge(kNon, j.kappa_non_anchor_min),
      per_arm_gate: perArm.cso !== null && perArm.none !== null && Math.abs(perArm.cso - perArm.none) <= PER_ARM_MAX + 1e-12,
      format_pairs: formats.length >= FORMAT.units && same >= FORMAT.same_min,
      format_near_misses: formats.length >= FORMAT.units && notHit >= FORMAT.not_hit_min,
      refusals: n > 0 && refusals / n <= j.refusal_max,
      gold_overcap: n > 0 && overcap.length / n <= j.gold_overcap_max,
      validity_kappa: ge(kVal, j.kappa_min),
    },
    detail: {
      reports: n, anchors, gold_reports: gold.length, gold_classes: classes, kappa_named_all: kAll, kappa_named_non_anchor: kNon, per_arm_disagreement: perArm,
      gold_findings: vPairs.length, validity_classes: vClasses, kappa_validity: kVal, refusals, overcap_gold_drops: overcap.length, overcap_by_cell: byCell,
      format: { units: formats.length, same_pairs: same, near_not_hit: notHit }, judge_gaps: reports.filter((r) => r.production.named === null).length,
    },
  };
}

/** The check set as sent, in check_seed order (E_CSO_CHECK_INPUT when anchors pass anchor_share_max of it). */
export function checkSetOrder<T extends { id: string; anchor: unknown }>(items: readonly T[], p: CsoPrereg): T[] {
  const max = (p.judge as { anchor_share_max: number }).anchor_share_max;
  if (items.filter((x) => x.anchor).length > max * items.length) csoFail("E_CSO_CHECK_INPUT", "anchors are more than " + max + " of the check set as sent");
  const rng = seededRandom(p.check_seed);
  const out = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [out[i], out[k]] = [out[k]!, out[i]!];
  }
  return out;
}

/** How many extra anchors fit under anchor_share_max, beside reports session reports, when gold is short of a minimum. */
export function extraAnchorsAllowed(reports: number, anchors: number, p: CsoPrereg): number {
  const max = (p.judge as { anchor_share_max: number }).anchor_share_max;
  let a = 0;
  while (anchors + a + 1 <= max * (reports + anchors + a + 1) + 1e-9) a++;
  return a;
}

const ANCHOR_ROOT: HelperRecords = { snapshot_root: null, handles: {} };
const familyIds = (p: CsoPrereg) => (p.scoring as { cwe_families: Record<string, number[]> }).cwe_families;
const cweNum = (c: string) => Number(c.replace(/^CWE-/i, ""));

/** A pre-fix line that is not code under deviation (e): blank, a comment, or an import, package, include or require line
 *  (a Go import spec included). */
const NOT_CODE = /^\s*($|\/\/|\/\*|\*|#(?!\[)|--|import\b|package\b|from\s+\S+\s+import\b|using\s|use\s|require\b|(const|let|var)\s+\S+\s*=\s*require\(|(\w+\s+)?"[^"]*"\s*$)/;

/** The oracle's site under deviation (e): the first pre-fix hunk in a fix file that touches a code line (the first such hunk
 *  when every one touches only blank, comment or import lines), and as mechanism the advisory summary with the first
 *  paragraph of its details that is not a Markdown heading. */
function oracleSite(u: UnitRecord, tree: TreeIndex, p: CsoPrereg) {
  const files = fixFiles(u, tree);
  const inTree = u.hunks.filter((x) => files.includes(x.file));
  const code = (x: (typeof inTree)[number]) => (tree.files.get(x.file) ?? []).slice(x.start - 1, x.end).some((l) => !NOT_CODE.test(l));
  const h = inTree.find(code) ?? inTree[0] ?? csoFail("E_CSO_ANCHOR", u.unit + ": no pre-fix hunk lies in a file of the audited tree");
  const end = Math.min(h.end, h.start + scoringRules(p).wide_range_lines - 1);
  const fam = u.cwe_families[0] ?? u.cwe_ids[0] ?? "the advisory's weakness";
  const para = u.advisory.details.split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l)).join("\n").split(/\n\s*\n/).find((x) => x.trim()) ?? "";
  return { file: h.file, start: h.start, end, cwe: u.cwe_ids[0] ?? "", fam, mech: u.advisory.summary.replace(/\s+/g, " ").trim() + ". " + para.replace(/\s+/g, " ").trim() };
}

/** The oracle anchor: the advisory's flaw as one finding at its first hunk, written from the advisory (a known hit). */
export function oracleReport(u: UnitRecord, tree: TreeIndex, p: CsoPrereg): string {
  const o = oracleSite(u, tree, p);
  return ["## Security audit", "### 1. " + o.fam + " in " + o.file, "Location: " + o.file + ":" + o.start + "-" + o.end, "Weakness: " + o.cwe + " (" + o.fam + ")", "How an attacker exploits it: " + o.mech, "", "DONE"].join("\n");
}

/** The stock anchor: every weakness family against the fix files and up to ten other files, with no line or mechanism (a
 *  known miss). */
export function stockReport(u: UnitRecord, tree: TreeIndex, p: CsoPrereg): string {
  const fixes = fixFiles(u, tree);
  const files = [...fixes, ...[...tree.files.keys()].filter((f) => !fixes.includes(f)).sort().slice(0, 10)];
  return ["## Security audit", ...files.flatMap((f) => Object.keys(familyIds(p)).map((fam) => "- " + f + ": possible " + fam + " issue")), "", "DONE"].join("\n");
}

/** Section 7's format variants for one stage 1 unit: the oracle finding as a table row and as a prose paragraph, and two near
 *  misses (right file and wrong class; right class 30 lines from every hunk). Each near miss states a plain mechanism of its
 *  class and names nothing from the advisory, so no function, type or code path the advisory names can place it (deviation
 *  (e)). E_CSO_ANCHOR when no line in the file sits 30 lines from every hunk. */
export function formatVariants(u: UnitRecord, tree: TreeIndex, p: CsoPrereg): { table: string; prose: string; near_class: string; near_lines: string } {
  const o = oracleSite(u, tree, p);
  const fams = familyIds(p);
  const own = new Set(u.cwe_ids.map(cweNum));
  const other = Object.entries(fams).find(([, ids]) => !ids.some((x) => own.has(x))) ?? csoFail("E_CSO_ANCHOR", u.unit + ": every family shares a CWE with the advisory");
  const n = tree.files.get(o.file)!.length;
  const hs = u.hunks.filter((h) => h.file === o.file);
  const far = Math.max(...hs.map((h) => h.end)) + 30 <= n ? Math.max(...hs.map((h) => h.end)) + 30 : Math.min(...hs.map((h) => h.start)) - 30 >= 1 ? Math.min(...hs.map((h) => h.start)) - 30 : csoFail("E_CSO_ANCHOR", u.unit + ": no line of " + o.file + " is 30 lines from every hunk");
  const row = (file: string, lines: string, weak: string, mech: string) => ["## Security audit", "| ID | File | Lines | Weakness | Exploit |", "|---|---|---|---|---|", "| F1 | " + file + " | " + lines + " | " + weak + " | " + mech + " |", "", "DONE"].join("\n");
  return {
    table: row(o.file, o.start + "-" + o.end, o.cwe + " " + o.fam, o.mech),
    prose: ["## Security audit", "In " + o.file + " at lines " + o.start + "-" + o.end + " there is a " + o.fam + " weakness (" + o.cwe + "). " + o.mech, "", "DONE"].join("\n"),
    near_class: row(o.file, o.start + "-" + o.end, "CWE-" + other[1][0] + " " + other[0], "Untrusted input reaching this code leads to a " + other[0] + " weakness, because no check guards it."),
    near_lines: row(o.file, far + "-" + far, o.cwe + " " + o.fam, "Untrusted input reaching this code leads to a " + o.fam + " weakness, because no check guards it."),
  };
}

/** Runs the production pipeline on one unit's format variants. */
export async function runFormatVariants(judge: JudgeClient, u: UnitRecord, tree: TreeIndex, p: CsoPrereg): Promise<FormatResult> {
  const v = formatVariants(u, tree, p);
  const named = async (text: string) => {
    const s = { texts: [text], helper: ANCHOR_ROOT };
    return namedOf(await judgeSession(judge, u, scoredText(s, p), s, tree, p), u, s, tree, p).named;
  };
  return { unit: u.unit, table: await named(v.table), prose: await named(v.prose), near_class: await named(v.near_class), near_lines: await named(v.near_lines) };
}

/** Runs one check-set report down a route: production pass A and B, then both gold labellers. */
export async function runReport(id: string, meta: Pick<ReportResult, "arm" | "model" | "anchor">, clients: { judge: JudgeClient; gold: [JudgeClient, JudgeClient] }, u: UnitRecord, s: Src, tree: TreeIndex, p: CsoPrereg, onJudged?: (run: JudgeRun) => void): Promise<ReportResult> {
  const run = await judgeSession(clients.judge, u, scoredText(s, p), s, tree, p);
  onJudged?.(run);
  return goldOnRun(id, meta, run, clients.gold, u, s, tree, p);
}

/** Gold from both labellers on a report the production judge already judged, so the check compares the judgement that
 *  scored it. */
export async function goldOnRun(id: string, meta: Pick<ReportResult, "arm" | "model" | "anchor">, run: JudgeRun, labellers: [JudgeClient, JudgeClient], u: UnitRecord, s: Src, tree: TreeIndex, p: CsoPrereg): Promise<ReportResult> {
  const st = scoredText(s, p);
  const prod = namedOf(run, u, s, tree, p);
  const passA = run.judged && Array.isArray(run.judged.findings) ? run.judged.findings.slice(0, scoringRules(p).first_k) : [];
  const gold: GoldResult[] = [];
  for (const c of labellers) gold.push(await goldReport(c, u, st, s, passA, tree, p));
  const total = run.judged && Array.isArray(run.judged.findings) ? run.judged.findings.length : 0;
  return { id, ...meta, production: { named: prod.named, validity: prod.validity, refused: run.refused }, gold: [gold[0]!, gold[1]!], findings_total: total };
}

/** The rerun's pilot judge gate (rerun prereg section 7): on the pilot's new cso reports, no refusal by the judge or a
 *  labeller, no judge gap, and gold (both labellers agreeing) disagrees with the judge on named in at most max_disagree.
 *  A report the labellers split on has no gold and is listed, never counted as a disagreement. */
export function pilotGate(reports: readonly ReportResult[], want: number, max_disagree = 2): { pass: boolean; reports: number; refused: string[]; judge_gaps: string[]; disagree: string[]; no_gold: string[]; why: string[] } {
  const refused = reports.filter((r) => r.production.refused || r.gold.some((g) => g.refused)).map((r) => r.id);
  const judge_gaps = reports.filter((r) => r.production.named === null).map((r) => r.id);
  const disagree = reports.filter((r) => r.production.named !== null && goldNamed(r) !== null && goldNamed(r) !== r.production.named).map((r) => r.id);
  const no_gold = reports.filter((r) => goldNamed(r) === null).map((r) => r.id);
  const why = [
    ...(reports.length !== want ? [reports.length + " pilot reports, not " + want] : []),
    ...(refused.length ? [refused.length + " refused"] : []),
    ...(judge_gaps.length ? [judge_gaps.length + " judge gaps"] : []),
    ...(disagree.length > max_disagree ? ["gold disagrees on named in " + disagree.length + ", more than " + max_disagree] : []),
  ];
  return { pass: why.length === 0, reports: reports.length, refused, judge_gaps, disagree, no_gold, why };
}

/** The rerun's counted gold draw (rerun prereg section 7): the counted units by the sha256 of "<gold_seed>:<unit id>",
 *  ascending as hex strings, each unit's Opus report then its particle-1 report, skipping a report has() rules out. */
export function countedGoldOrder(units: readonly string[], seed: number, has: (unit: string, model: CsoModel) => boolean): { unit: string; model: CsoModel }[] {
  const sha = (u: string) => createHash("sha256").update(seed + ":" + u).digest("hex");
  return [...units].sort((a, b) => (sha(a) < sha(b) ? -1 : sha(a) > sha(b) ? 1 : 0)).flatMap((unit) => (["opus", "particle"] as const).filter((model) => has(unit, model)).map((model) => ({ unit, model })));
}

/** Anchor sources for runReport: one oracle and one stock report per unit. */
export const anchorSources = (u: UnitRecord, tree: TreeIndex, p: CsoPrereg): { anchor: "oracle" | "stock"; s: Src }[] => [
  { anchor: "oracle", s: { texts: [oracleReport(u, tree, p)], helper: ANCHOR_ROOT } },
  { anchor: "stock", s: { texts: [stockReport(u, tree, p)], helper: ANCHOR_ROOT } },
];



export interface AnchorCandidate { id: string; kind: "oracle" | "stock" }
export interface GoldFill { anchors: string[]; findings: string[]; still_short: string[] }

/** Section 7's fill when gold is short of a minimum: extra anchors (oracle for the named class, stock for the not-named
 *  class, then alternating for the report count) and extra findings for validity, each pool in check_seed order, the
 *  anchors only as many as extraAnchorsAllowed admits under anchor_share_max. still_short names what the pools or the cap
 *  could not fill. */
export function goldFill(c: JudgeCheck, pools: { anchors: readonly AnchorCandidate[]; findings: readonly string[] }, p: CsoPrereg): GoldFill {
  const j = p.judge as unknown as CheckRules;
  const d = c.detail as { reports: number; anchors: number; gold_reports: number; gold_classes: { named: number; not_named: number }; gold_findings: number; validity_classes: { supported: number; unsupported: number } };
  const order = <T>(xs: readonly T[], id: (x: T) => string) => checkSetOrder(xs.map((x) => ({ id: id(x), anchor: null, x })), p).map((y) => y.x);
  const oracle = order(pools.anchors.filter((a) => a.kind === "oracle"), (a) => a.id), stock = order(pools.anchors.filter((a) => a.kind === "stock"), (a) => a.id);
  let room = extraAnchorsAllowed(d.reports - d.anchors, d.anchors, p);
  const anchors: string[] = [], still: string[] = [];
  const take = (pool: AnchorCandidate[], n: number) => {
    let got = 0;
    while (got < n && room > 0 && pool.length) {
      anchors.push(pool.shift()!.id);
      room--;
      got++;
    }
    return got;
  };
  const needOracle = Math.max(j.class_min - d.gold_classes.named, 0), needStock = Math.max(j.class_min - d.gold_classes.not_named, 0);
  if (take(oracle, needOracle) < needOracle) still.push("named_class");
  if (take(stock, needStock) < needStock) still.push("named_class");
  let needReports = Math.max(j.check_reports_min - d.gold_reports - needOracle - needStock, 0);
  for (let k = 0; needReports > 0; k++) {
    if (!take(k % 2 ? stock : oracle, 1) && !take(k % 2 ? oracle : stock, 1)) break;
    needReports--;
  }
  if (needReports > 0) still.push("named_reports");
  const vNeed = Math.max(j.check_findings_min - d.gold_findings, j.class_min - d.validity_classes.supported, j.class_min - d.validity_classes.unsupported, 0);
  const findings = order(pools.findings, (f) => f).slice(0, vNeed);
  if (findings.length < vNeed) still.push("validity");
  return { anchors, findings, still_short: [...new Set(still)] };
}


/** The extra findings goldFill draws from when validity gold falls short, read as the plan leaves it open: pass A findings
 *  past the first first_k of check-set reports, one id per finding ("<report id>#<position from 1>"), which goldFill
 *  takes in check_seed order. */
export function extraFindingPool(reports: readonly ReportResult[], p: CsoPrereg): string[] {
  const k = scoringRules(p).first_k;
  return reports.flatMap((r) => Array.from({ length: Math.max((r.findings_total ?? 0) - k, 0) }, (_, i) => r.id + "#" + (k + i + 1)));
}

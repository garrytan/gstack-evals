// Copyright (c) 2026 Garry Tan. MIT License.
// er score (prereg 2026-11-08-geva-405, sections 3, 6, 8 and 9): A per review with one-to-one credit, and every
// secondary the labels, rows and keys give. Rules:
// - A = credited primary items / the unit's primary items, where credit is a maximum one-to-one matching between the
//   list's checks and the items over every check index the judge named, so one check earns at most one item.
// - A no-block reply (an arm stop after its retry included) scores 0 on every block score; a missing or web-contaminated
//   session is missing; a review with any unlabelled primary cell is unscored and counts as missing. Units weigh equally.
// - Each secondary takes its own maximum matching over its own item set: A_B, A_T and A_C on the primary items of that
//   kind; the path-hit share over primary items on the judge's path_checks; A_own on the own-test items; A on mentioned
//   items, on generic items and on the foreseeable stratum; precision is the matching over every B, T and C item over
//   the list's checks; the code-change share is the credited primary items whose credit is a code change.
// - Specificity is A minus shuffled A (the deranged unit's primary items in the shuffled-key packet).
// - The sensitivity read A_sens treats an arm stop as missing instead of 0.
// Mechanical rules, frozen here (build-time choices):
// - A list names a file when one of its items holds the file's path, or its base name as a whole token (bounded by the
//   text's ends, whitespace or punctuation other than ".", "_" and "-"), case-insensitive.
// - A list names a function when one of its items holds the function's name as a whole identifier, case-insensitive;
//   for "a.b" or "a::b" the last part is the name; a name under 3 characters never matches.
// - Bug-site path recall: the share of primary B items with a blamed file or a blamed function the list names, read on
//   the paths list and on the checks list.
// - Path-map recall: the share of the real diff's touched files, and of its touched functions, the paths list names.
// - Grep baseline: the 15 functions of the base repo (non-test source files, outside vendored and build folders) whose
//   names share the most distinct words with plan.md, ties by name then file; it recalls a touched function it holds and
//   a touched file one of them sits in. Names split into words at case changes, digits, "_" and "-".
// - Check type: the earliest of eval ("eval", "evals", "evaluation", "golden"), CI ("CI", "pipeline", "workflow",
//   "matrix", "GitHub Actions"), end-to-end ("end-to-end", "end to end", "e2e", "integration test") or unit ("unit")
//   named in the check's own words; none of them is other.
// - Change-size terciles: units sorted by added source lines, then id, split into three as evenly as possible (the
//   larger groups first). The strict stratum is units first exposed on or after 2026-08-01. Merge month is merged_at's.
// - Foreseeable stratum: primary items no auditor rated no, with at least one rating.
// - Length: the unit-pass difference in A regressed on the difference in the checks lists' word counts.
// - Pairwise: ties are left out of the win rates; the length-controlled rate is a logistic fit on the checks word-count
//   difference (per 10 words) read at zero, with a unit bootstrap interval; the stock block's rate counts ties as not won.
// - Arm guess: correct when the guess names the list's arm class (none, lens, or skill for any skill arm).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, readJson, readRecords, refuseAliases, refuseInRepo, writeJson } from "../product-value/io.ts";
import { clusterBootstrap, DRAWS, expit, logistic, maxMatching, mean, ols, percentileInterval, r4, SEED } from "../product-value/stats.ts";
import type { GuessRecord, PairRecord } from "./judge.ts";
import type { LabelRecord, PacketMap, PacketMeta } from "./packets.ts";
import { cellStats } from "./parse.ts";
import { ARMS, MODELS_IN_ORDER, SKILL_ARMS, type ArmId, type Key, type KeyItem, type Label, type ModelId, type Row, type UnitMeta } from "./types.ts";
import { loadUnits, readPlan, readRows, type LoadedUnit } from "./units.ts";

export type Status = "scored" | "no-block" | "missing" | "unscored";
export type CheckType = "unit" | "e2e" | "ci" | "eval" | "other";
export const CHECK_TYPES: readonly CheckType[] = ["unit", "e2e", "ci", "eval", "other"];

export interface Review {
  unit: string;
  model: ModelId;
  arm: ArmId;
  pass: number;
  session: string;
  status: Status;
  arm_stop: boolean;
  A: number | null;
  A_sens: number | null;
  shuffled: number | null;
  specificity: number | null;
  A_B: number | null;
  A_T: number | null;
  A_C: number | null;
  path_hit: number | null;
  A_own: number | null;
  A_mentioned: number | null;
  A_generic: number | null;
  A_foreseeable: number | null;
  precision: number | null;
  code_share: number | null;
  credited: number | null;
  site_paths: number | null;
  site_checks: number | null;
  map_files: number | null;
  map_functions: number | null;
  mix: Record<CheckType, number> | null;
  words: number;
  check_words: number;
  items: number;
  cut: number;
  exposed: boolean | null;
  enforced: boolean;
  spend_micros: number | null;
}

/** The production judge's records for a packet: the single judge's, or the particle-1 panel's. */
export const productionJudge = (m: PacketMeta): LabelRecord["judge"] => (m.judges.length > 1 ? "panel" : m.judges[0]!);
export type LabelIndex = Map<string, Map<string, Label | null>>;

export function indexLabels(map: PacketMap, labels: readonly LabelRecord[]): LabelIndex {
  const out: LabelIndex = new Map();
  for (const l of labels) {
    const meta = map.packets[l.packet];
    if (!meta || l.judge !== productionJudge(meta)) continue;
    const cells = out.get(l.packet) ?? new Map();
    cells.set(l.list + "|" + l.item, l.label);
    out.set(l.packet, cells);
  }
  return out;
}

export interface Credit {
  credited: number;
  total: number;
  /** Per item id, the check index the matching gave it, or null. */
  check_of: Map<string, number | null>;
  labels: Map<string, Label>;
}

/** Credited items over a set of item ids for one list, or null when any of their cells is unlabelled. */
export function credit(meta: PacketMeta, cells: Map<string, Label | null> | undefined, list: string, itemIds: readonly string[], edge: (l: Label) => number[] = (l) => (l.anticipated ? l.checks : [])): Credit | null {
  const ids = new Map(Object.entries(meta.items).map(([pid, ref]) => [ref.item, pid]));
  const edges: number[][] = [];
  const labels = new Map<string, Label>();
  for (const it of itemIds) {
    const pid = ids.get(it);
    const lab = pid === undefined ? undefined : cells?.get(list + "|" + pid);
    if (!lab) return null;
    labels.set(it, lab);
    edges.push(edge(lab));
  }
  const m = maxMatching(edges);
  return { credited: m.size, total: itemIds.length, check_of: new Map(itemIds.map((id, i) => [id, m.change_of[i] ?? null])), labels };
}

const share = (c: { credited: number; total: number } | null): number | null => (c && c.total ? c.credited / c.total : null);

const lower = (s: string) => s.toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether a list names a file: its path, or its base name as a whole token. */
export function namesFile(list: readonly string[], file: string): boolean {
  const f = lower(file);
  const base = f.split("/").pop()!;
  const re = new RegExp("(^|[^a-z0-9._-])" + esc(base) + "($|[^a-z0-9_-]|\\.(?![a-z0-9]))");
  return list.some((t) => lower(t).includes(f) || re.test(lower(t)));
}

/** Whether a list names a function: its last name part as a whole identifier, at least 3 characters. */
export function namesFunction(list: readonly string[], name: string): boolean {
  const n = lower(name.split(/::|\./).pop() ?? "");
  if (n.length < 3) return false;
  const re = new RegExp("(^|[^a-z0-9_$])" + esc(n) + "($|[^a-z0-9_$])");
  return list.some((t) => re.test(lower(t)));
}

const TYPE_RULES: Array<[CheckType, RegExp]> = [
  ["eval", /\b(?:evals?|evaluation|golden)\b/i],
  ["ci", /\b(?:ci|pipeline|workflow|matrix|github actions)\b/i],
  ["e2e", /\b(?:end[- ]to[- ]end|e2e|integration tests?)\b/i],
  ["unit", /\bunit\b/i],
];

/** The frozen keyword rule: the earliest test type a check's own words name. */
export function checkType(check: string): CheckType {
  let best: CheckType = "other";
  let at = Infinity;
  for (const [t, re] of TYPE_RULES) {
    const m = re.exec(check);
    if (m && m.index < at) {
      at = m.index;
      best = t;
    }
  }
  return best;
}

export function mixOf(checks: readonly string[]): Record<CheckType, number> {
  const out = Object.fromEntries(CHECK_TYPES.map((t) => [t, 0])) as Record<CheckType, number>;
  for (const c of checks) out[checkType(c)]++;
  return out;
}

const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "third_party", "dist", "build", "target", ".venv", "venv", "Pods", ".gradle"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".swift", ".rb", ".php", ".cs", ".c", ".cc", ".cpp", ".h", ".hpp", ".m", ".mm", ".scala", ".dart", ".ex", ".exs", ".lua", ".vue", ".svelte"]);
export const isTestPath = (p: string): boolean => /(^|\/)(tests?|__tests__|spec|specs|testdata|fixtures)\//i.test(p) || /(^|\/)test_[^/]*$|[._-](test|spec)s?\.[a-z0-9]+$/i.test(p);
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "new", "else", "do", "try", "with", "elif", "when", "match", "await", "typeof", "sizeof"]);
const FN_PATTERNS: RegExp[] = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  /^[ \t]*(?:async[ \t]+)?def[ \t]+(?:self\.)?([A-Za-z_]\w*[?!]?)/gm,
  /^func[ \t]+(?:\([^)]*\)[ \t]*)?([A-Za-z_]\w*)/gm,
  /\b(?:fn|fun|func)\s+([A-Za-z_]\w*)/g,
  /^[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|override|async|virtual|export|default)[ \t]+)*(?:[\w<>\[\],.?]+[ \t]+)?([A-Za-z_]\w*)[ \t]*\([^;{}]*\)[ \t]*(?:throws[^{]*)?\{/gm,
];

/** Every function name the frozen patterns find in the base repo's non-test source files, as (file, name). */
export function repoFunctions(repo: string): Array<{ file: string; name: string }> {
  const out = new Map<string, { file: string; name: string }>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
        continue;
      }
      const rel = relative(repo, p).split("\\").join("/");
      if (!e.isFile() || !SOURCE_EXT.has(extname(e.name).toLowerCase()) || isTestPath(rel) || statSync(p).size > 1_000_000) continue;
      const text = readFileSync(p, "utf8");
      for (const re of FN_PATTERNS) for (const m of text.matchAll(re)) if (!KEYWORDS.has(m[1]!)) out.set(rel + "\u0000" + m[1], { file: rel, name: m[1]! });
    }
  };
  if (existsSync(repo)) walk(repo);
  return [...out.values()];
}

export const nameWords = (s: string): string[] => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z]+|(?<=[a-z])(?=[0-9])/).map(lower).filter((w) => w.length >= 2);

/** The grep baseline's 15 functions: the most distinct name words shared with plan.md, ties by name then file. */
export function grepBaseline(fns: ReadonlyArray<{ file: string; name: string }>, plan: string, n = 15): Array<{ file: string; name: string; shared: number }> {
  const planWords = new Set((plan.match(/[A-Za-z0-9_]+/g) ?? []).flatMap((t) => [lower(t), ...nameWords(t)]));
  return fns.map((f) => ({ ...f, shared: new Set(nameWords(f.name).filter((w) => planWords.has(w))).size })).sort((a, b) => b.shared - a.shared || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.file < b.file ? -1 : 1)).slice(0, n);
}

export function baselineRecall(key: Key, top: ReadonlyArray<{ file: string; name: string }>): { files: number | null; functions: number | null } {
  const t = key.touched;
  const fnKey = (f: { file: string; name: string }) => f.file + "\u0000" + f.name;
  const held = new Set(top.map(fnKey));
  const files = new Set(top.map((f) => f.file));
  return { files: t.files.length ? t.files.filter((f) => files.has(f)).length / t.files.length : null, functions: t.functions.length ? t.functions.filter((f) => held.has(fnKey(f))).length / t.functions.length : null };
}

const foreseeable = (i: KeyItem) => {
  const r = [i.foreseeable.opus, i.foreseeable.sol].filter((x) => x !== null);
  return r.length > 0 && !r.includes("no");
};

export interface ScoreInput {
  units: Map<string, LoadedUnit>;
  rows: Row[];
  map: PacketMap;
  labels: LabelRecord[];
}

/** Scores every review row against the label map. */
export function scoreReviews(inp: ScoreInput): Review[] {
  const idx = indexLabels(inp.map, inp.labels);
  const where = new Map<string, Array<{ role: string; meta: PacketMeta; list: string }>>();
  for (const meta of Object.values(inp.map.packets)) for (const [lid, ref] of Object.entries(meta.lists)) if (ref.kind === "arm" && ref.session) where.set(ref.session, [...(where.get(ref.session) ?? []), { role: meta.role, meta, list: lid }]);
  const out: Review[] = [];
  for (const r of inp.rows) {
    const key = inp.units.get(r.unit)?.key;
    if (!key) throw new PvError("E_USAGE", "row " + r.session + " names unit " + r.unit + ", which has no key under --units");
    const byId = new Map(key.items.map((i) => [i.id, i]));
    const prim = key.primary.map((id) => byId.get(id)!);
    const kindIds = (k: string) => prim.filter((i) => i.kind === k).map((i) => i.id);
    const bItems = prim.filter((i) => i.kind === "B");
    const base: Review = { unit: r.unit, model: r.model, arm: r.arm, pass: r.pass, session: r.session, status: "missing", arm_stop: r.arm_stop, A: null, A_sens: null, shuffled: null, specificity: null, A_B: null, A_T: null, A_C: null, path_hit: null, A_own: null, A_mentioned: null, A_generic: null, A_foreseeable: null, precision: null, code_share: null, credited: null, site_paths: null, site_checks: null, map_files: null, map_functions: null, mix: null, words: r.words, check_words: r.check_words, items: r.items, cut: r.cut, exposed: r.exposed, enforced: r.enforced, spend_micros: r.spend_micros };
    if (r.end === "missing" || r.end === "contaminated") {
      out.push(base);
      continue;
    }
    if (r.end === "no-block") {
      const z = (n: number) => (n ? 0 : null);
      out.push({ ...base, status: "no-block", A: 0, A_sens: r.arm_stop ? null : 0, shuffled: 0, specificity: 0, A_B: z(kindIds("B").length), A_T: z(kindIds("T").length), A_C: z(kindIds("C").length), path_hit: 0, A_own: z(key.own.length), A_mentioned: z(key.items.filter((i) => i.mentioned).length), A_generic: z(key.items.filter((i) => i.generic).length), A_foreseeable: z(prim.filter(foreseeable).length), credited: 0, site_paths: z(bItems.length), site_checks: z(bItems.length), map_files: z(key.touched.files.length), map_functions: z(key.touched.functions.length) });
      continue;
    }
    const prod = where.get(r.session)?.find((w) => w.role === "production");
    if (!prod) throw new PvError("E_USAGE", "session " + r.session + " ends in a block but no production packet in the map holds its list; build packets from these rows");
    const cells = idx.get(prod.meta.id);
    const on = (ids: string[], edge?: (l: Label) => number[]) => credit(prod.meta, cells, prod.list, ids, edge);
    const primary = on(key.primary);
    const paths = r.paths!, checks = r.checks!;
    const mech = {
      site_paths: bItems.length ? bItems.filter((i) => (i.sites ?? []).some((s) => namesFile(paths, s.file) || (s.function !== null && namesFunction(paths, s.function)))).length / bItems.length : null,
      site_checks: bItems.length ? bItems.filter((i) => (i.sites ?? []).some((s) => namesFile(checks, s.file) || (s.function !== null && namesFunction(checks, s.function)))).length / bItems.length : null,
      map_files: key.touched.files.length ? key.touched.files.filter((f) => namesFile(paths, f)).length / key.touched.files.length : null,
      map_functions: key.touched.functions.length ? key.touched.functions.filter((f) => namesFunction(paths, f.name)).length / key.touched.functions.length : null,
      mix: mixOf(checks),
    };
    if (!primary) {
      out.push({ ...base, status: "unscored", ...mech });
      continue;
    }
    const A = primary.credited / primary.total;
    const sh = where.get(r.session)?.find((w) => w.role === "shuffled");
    const shKey = sh ? inp.units.get(sh.meta.unit)?.key : null;
    const shuffled = sh && shKey ? share(credit(sh.meta, idx.get(sh.meta.id), sh.list, shKey.primary)) : null;
    const all = on(key.items.map((i) => i.id));
    const matched = [...primary.check_of].filter(([, c]) => c !== null).map(([id]) => id);
    out.push({
      ...base,
      ...mech,
      status: "scored",
      A,
      A_sens: A,
      shuffled,
      specificity: shuffled === null ? null : A - shuffled,
      A_B: share(on(kindIds("B"))),
      A_T: share(on(kindIds("T"))),
      A_C: share(on(kindIds("C"))),
      path_hit: share(on(key.primary, (l) => (l.path_hit ? l.path_checks : []))),
      A_own: share(on(key.own.map((i) => i.id))),
      A_mentioned: share(on(key.items.filter((i) => i.mentioned).map((i) => i.id))),
      A_generic: share(on(key.items.filter((i) => i.generic).map((i) => i.id))),
      A_foreseeable: share(on(prim.filter(foreseeable).map((i) => i.id))),
      precision: all && checks.length ? all.credited / checks.length : null,
      code_share: matched.length ? matched.filter((id) => primary.labels.get(id)!.credit === "code").length / matched.length : null,
      credited: primary.credited,
    });
  }
  return out;
}

export interface StockCredit {
  unit: string;
  model: ModelId;
  pass: number;
  row: number;
  credited: boolean | null;
}

/** Section 8: whether each stock row earned a primary item on each unit-pass, from the production judge's own labels. */
export function stockCredits(inp: Pick<ScoreInput, "units" | "map" | "labels">): StockCredit[] {
  const idx = indexLabels(inp.map, inp.labels);
  const out: StockCredit[] = [];
  for (const meta of Object.values(inp.map.packets)) {
    if (meta.role !== "production") continue;
    const key = inp.units.get(meta.unit)!.key!;
    for (const [lid, ref] of Object.entries(meta.lists)) {
      if (ref.kind !== "stock") continue;
      const c = credit(meta, idx.get(meta.id), lid, key.primary);
      out.push({ unit: meta.unit, model: meta.model, pass: meta.pass, row: ref.stock!, credited: c === null ? null : c.credited > 0 });
    }
  }
  return out.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.model < b.model ? -1 : a.model > b.model ? 1 : a.pass - b.pass || a.row - b.row));
}

/** Unit-weighted mean of a review field over reviews with a value: each unit's mean, then the mean over units. */
export function unitMean(reviews: readonly Review[], f: (r: Review) => number | null): { mean: number | null; units: number } {
  const byUnit = new Map<string, number[]>();
  for (const r of reviews) {
    const v = f(r);
    if (v !== null) byUnit.set(r.unit, [...(byUnit.get(r.unit) ?? []), v]);
  }
  const ms = [...byUnit.values()].map(mean);
  return { mean: ms.length ? mean(ms) : null, units: ms.length };
}

export const isMissing = (r: Review) => r.status === "missing" || r.status === "unscored";
const SECONDARY = ["shuffled", "specificity", "A_sens", "A_B", "A_T", "A_C", "path_hit", "A_own", "A_mentioned", "A_generic", "A_foreseeable", "precision", "code_share", "site_paths", "site_checks", "map_files", "map_functions"] as const;

export function cellSummaries(reviews: readonly Review[], rows: readonly Row[]) {
  const out = [];
  for (const model of MODELS_IN_ORDER)
    for (const arm of ARMS) {
      const rs = reviews.filter((r) => r.model === model && r.arm === arm);
      if (!rs.length) continue;
      const cs = cellStats(rows.filter((r) => r.model === model && r.arm === arm));
      const mix = Object.fromEntries(CHECK_TYPES.map((t) => [t, rs.reduce((s, r) => s + (r.mix?.[t] ?? 0), 0)])) as Record<CheckType, number>;
      const mixTotal = Object.values(mix).reduce((a, b) => a + b, 0);
      const exp = rs.filter((r) => r.exposed !== null);
      const credited = rs.reduce((s, r) => s + (r.credited ?? 0), 0);
      const spend = rs.reduce((s, r) => s + (r.spend_micros ?? 0), 0);
      const n = rs.length;
      out.push({
        model, arm, ...cs,
        unscored: rs.filter((r) => r.status === "unscored").length,
        rates: { no_block: cs.no_block / n, arm_stop: cs.arm_stops / n, missing: rs.filter(isMissing).length / n + cs.contaminated / n },
        A: unitMean(rs, (r) => r.A).mean,
        units: unitMean(rs, (r) => r.A).units,
        secondaries: Object.fromEntries(SECONDARY.map((f) => [f, unitMean(rs, (r) => r[f]).mean])),
        mix_share: Object.fromEntries(CHECK_TYPES.map((t) => [t, mixTotal ? mix[t] / mixTotal : null])),
        exposure: exp.length ? exp.filter((r) => r.exposed).length / exp.length : null,
        cost_per_credited_item: credited ? spend / 1e6 / credited : null,
      });
    }
  return out;
}

/** Terciles of change size: units by added source lines then id, the larger groups first. */
export function terciles(metas: readonly UnitMeta[]): Map<string, 1 | 2 | 3> {
  const sorted = [...metas].sort((a, b) => a.source_added - b.source_added || (a.id < b.id ? -1 : 1));
  const n = sorted.length, sizes = [Math.ceil(n / 3), Math.ceil((n - Math.ceil(n / 3)) / 2)];
  return new Map(sorted.map((m, i) => [m.id, (i < sizes[0]! ? 1 : i < sizes[0]! + sizes[1]! ? 2 : 3) as 1 | 2 | 3]));
}

export const STRICT_FROM = "2026-08-01";
export const isStrict = (m: UnitMeta): boolean => m.exposed_at.slice(0, 10) >= STRICT_FROM;

export function strataSummaries(reviews: readonly Review[], units: Map<string, LoadedUnit>, recognized: ReadonlySet<string> | null) {
  const metas = [...new Set(reviews.map((r) => r.unit))].map((u) => units.get(u)!.meta);
  const terc = terciles(metas);
  const splits: Array<[string, (m: UnitMeta) => string | null]> = [
    ["tercile", (m) => String(terc.get(m.id))],
    ["month", (m) => m.merged_at.slice(0, 7)],
    ["strict", (m) => (isStrict(m) ? "strict" : "earlier")],
    ["type", (m) => m.type],
    ["recognized", (m) => (recognized === null ? null : recognized.has(m.id) ? "recognized" : "not recognized")],
  ];
  const out = [];
  for (const [split, f] of splits)
    for (const value of [...new Set(metas.map(f).filter((v): v is string => v !== null))].sort())
      for (const model of MODELS_IN_ORDER)
        for (const arm of ARMS) {
          const rs = reviews.filter((r) => r.model === model && r.arm === arm && f(units.get(r.unit)!.meta) === value);
          if (!rs.length) continue;
          const m = unitMean(rs, (r) => r.A);
          out.push({ split, value, model, arm, A: m.mean, units: m.units });
        }
  return out;
}

export interface UnitPair {
  unit: string;
  pass: number;
  a: Review;
  b: Review;
}

/** Pairs two arms' reviews by unit and pass; a pair with either side missing or unscored drops. */
export function pairArms(reviews: readonly Review[], model: ModelId, b: ArmId, a: ArmId): UnitPair[] {
  const side = (arm: ArmId) => new Map(reviews.filter((r) => r.model === model && r.arm === arm).map((r) => [r.unit + "#" + r.pass, r]));
  const A = side(a), B = side(b);
  return [...B.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).flatMap(([k, rb]) => {
    const ra = A.get(k);
    return ra && !isMissing(ra) && !isMissing(rb) ? [{ unit: rb.unit, pass: rb.pass, a: ra, b: rb }] : [];
  });
}

const interval95 = (draws: number[]): [number, number] | null => (draws.length ? percentileInterval(draws, 0.95) : null);

/** Section 8: the unit-pass difference in A regressed on the difference in checks word counts; intercept and its interval. */
export function lengthAdjusted(pairs: readonly UnitPair[], o = { seed: SEED, draws: DRAWS }) {
  const pts = pairs.map((p) => ({ unit: p.unit, x: p.b.check_words - p.a.check_words, y: p.b.A! - p.a.A! }));
  if (pts.length < 2) return { intercept: null, slope: null, ci95: null, n: pts.length };
  const fit = ols(pts.map((p) => p.x), pts.map((p) => p.y));
  return { intercept: fit.intercept, slope: fit.slope, ci95: interval95(clusterBootstrap(pts, (p) => p.unit, (s) => ols(s.map((p) => p.x), s.map((p) => p.y)).intercept, o)), n: pts.length };
}

export const CONTRASTS: ReadonlyArray<[ArmId, ArmId]> = [...SKILL_ARMS.map((s) => [s, "none"] as [ArmId, ArmId]), ...SKILL_ARMS.map((s) => [s, "lens"] as [ArmId, ArmId]), ["lens", "none"], ["candidate", "precut"], ["engphase", "precut"]];

export interface PairwiseSummary {
  model: ModelId;
  contrast: string;
  judge: string;
  n: number;
  wins: number;
  losses: number;
  ties: number;
  unread: number;
  raw: number | null;
  /** Wins over read pairs, ties counted as not won (the stock block's 20% rule reads this). */
  win_share: number | null;
  length_controlled: number | null;
  ci95: [number, number] | null;
}

/** Section 7's pairwise secondary: the first arm's raw and length-controlled win rates against the second. */
export function pairwiseSummary(map: PacketMap, records: readonly PairRecord[], o = { seed: SEED, draws: DRAWS }): PairwiseSummary[] {
  const groups = new Map<string, Array<{ unit: string; win: number | null; read: boolean; dw: number }>>();
  for (const r of records) {
    const meta = map.packets[r.packet];
    if (!meta?.pair) continue;
    const [x] = meta.pair.arms;
    const ids = Object.keys(meta.lists);
    const mine = ids.find((id) => (meta.lists[id]!.kind === "stock" ? "stock" : meta.lists[id]!.arm) === x)!;
    const other = ids.find((id) => id !== mine)!;
    const k = meta.model + "|" + meta.pair.contrast + "|" + r.judge;
    groups.set(k, [...(groups.get(k) ?? []), { unit: meta.unit, read: r.choice !== null, win: r.choice === null || r.choice === "tie" ? null : r.choice === mine ? 1 : 0, dw: (meta.lists[mine]!.words - meta.lists[other]!.words) / 10 }]);
  }
  const out: PairwiseSummary[] = [];
  for (const [k, xs] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [model, contrast, judge] = k.split("|") as [ModelId, string, string];
    const read = xs.filter((x) => x.read);
    const decided = read.filter((x) => x.win !== null) as Array<{ unit: string; win: number; dw: number }>;
    const wins = decided.filter((x) => x.win === 1).length;
    const fit = (s: typeof decided) => (s.length ? expit(logistic(s.map((x) => x.dw), s.map((x) => x.win)).intercept) : NaN);
    out.push({ model, contrast, judge, n: xs.length, wins, losses: decided.length - wins, ties: read.length - decided.length, unread: xs.length - read.length, raw: decided.length ? wins / decided.length : null, win_share: read.length ? wins / read.length : null, length_controlled: decided.length ? fit(decided) : null, ci95: decided.length >= 2 ? interval95(clusterBootstrap(decided, (x) => x.unit, fit, o)) : null });
  }
  return out;
}

const armClass = (a: ArmId | undefined) => (a === "none" || a === "lens" ? a : "skill");

/** Section 9, item 5: the arm-guess probe's tally; above 70% correct, the post flags it. */
export function guessTally(map: PacketMap, records: readonly GuessRecord[]) {
  let correct = 0, unread = 0;
  for (const r of records) {
    if (r.guess === null) unread++;
    else if (armClass(map.packets[r.packet]?.lists.L?.arm) === r.guess) correct++;
  }
  const n = records.length - unread;
  const rate = n ? correct / n : null;
  return { n, correct, unread, rate, flag: rate !== null && r4(rate) > 0.7 };
}

const USAGE = "gstack-evals er score --units <dir> --rows <rows> [--rows <rows>] --map <label map.json> --labels <labels.ndjson> [--labels ...] --out <scores.json> [--stage 1|2] [--recognized <recognized.json>] [--pairwise-map <map.json> --pairwise <pairwise.ndjson>] [--armguess-map <map.json> --armguess <armguess.ndjson>]";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { units: "one", rows: "many", map: "one", labels: "many", out: "one", stage: "one", recognized: "one", "pairwise-map": "one", pairwise: "one", "armguess-map": "one", armguess: "one" }, USAGE);
  need(a, ["units", "rows", "map", "labels", "out"], USAGE);
  const paths: Array<[string, string]> = [["--units", a.one.units!], ["--map", a.one.map!], ["--out", a.one.out!], ...a.many.rows!.map((p) => ["--rows", p] as [string, string]), ...a.many.labels!.map((p) => ["--labels", p] as [string, string])];
  for (const f of ["recognized", "pairwise-map", "pairwise", "armguess-map", "armguess"]) if (a.one[f]) paths.push(["--" + f, a.one[f]!]);
  refuseAliases(paths);
  refuseInRepo("--out", a.one.out!);
  if (!!a.one["pairwise-map"] !== !!a.one.pairwise || !!a.one["armguess-map"] !== !!a.one.armguess) throw new PvError("E_USAGE", "--pairwise and --armguess each come with their map; usage: " + USAGE);
  const map = readJson<PacketMap>(a.one.map!, "label map");
  if (map.kind !== "label") throw new PvError("E_USAGE", "--map is a " + map.kind + " map; score reads the label map");
  const units = loadUnits(a.one.units!, { keys: true });
  const rows = a.many.rows!.flatMap(readRows);
  const inp: ScoreInput = { units, rows, map, labels: a.many.labels!.flatMap((p) => readRecords<LabelRecord>(p, "labels file")) };
  const reviews = scoreReviews(inp);
  const recognized = a.one.recognized ? new Set(readJson<{ recognized: string[] }>(a.one.recognized, "recognized file").recognized) : null;
  const lengths = [];
  for (const model of MODELS_IN_ORDER)
    for (const [b, x] of CONTRASTS) {
      const pairs = pairArms(reviews, model, b, x);
      if (pairs.length) lengths.push({ model, contrast: b + "-" + x, ...lengthAdjusted(pairs) });
    }
  const baseline: Record<string, { files: number | null; functions: number | null; held: number }> = {};
  for (const u of new Set(reviews.map((r) => r.unit))) {
    const lu = units.get(u)!;
    const top = grepBaseline(repoFunctions(join(lu.dir, "repo")), readPlan(lu));
    baseline[u] = { ...baselineRecall(lu.key!, top), held: top.length };
  }
  const out = {
    version: 1,
    stage: Number(a.one.stage ?? map.stage),
    reviews,
    stock: stockCredits(inp),
    cells: cellSummaries(reviews, rows),
    strata: strataSummaries(reviews, units, recognized),
    baseline,
    length_adjusted: lengths,
    pairwise: a.one.pairwise ? pairwiseSummary(readJson<PacketMap>(a.one["pairwise-map"]!, "pairwise map"), readRecords<PairRecord>(a.one.pairwise, "pairwise file")) : null,
    armguess: a.one.armguess ? guessTally(readJson<PacketMap>(a.one["armguess-map"]!, "arm-guess map"), readRecords<GuessRecord>(a.one.armguess, "arm-guess file")) : null,
  };
  writeJson(a.one.out!, out);
  const count = (s: Status) => reviews.filter((r) => r.status === s).length;
  io.out("er score: " + reviews.length + " reviews (scored " + count("scored") + ", no-block " + count("no-block") + ", missing " + count("missing") + ", unscored " + count("unscored") + ") written to " + a.one.out);
  if (count("unscored")) io.err("E_ER_LABEL_MISSING " + count("unscored") + " reviews have an unlabelled primary cell; they are unscored and count as missing");
  return 0;
}

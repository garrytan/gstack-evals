// Copyright (c) 2026 Garry Tan. MIT License.
// The judged secondary and its check (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg, sections 5 and 8).
// GPT-6 Astra reads everything a builder saw (plan.md and every file under /work/review/, arm names stripped, 12,000
// words at most) in two blind calls: first it quotes at most 12 concrete conditions the material commits the builder to
// handle or test, then, given only the unit's hint and those quotes, whether one names the planted condition
// specifically. The gold flow (two labellers blind to arm, disagreements settled by the run thread reading the fix blind
// to arm, at least 48 bundles balanced by arm and enriched by a keyword match), Cohen's kappa with sensitivity and
// specificity, the stock control with the plan-leak flag and the one allowed rubric revision, the generic-specific rate
// and the section map. The model calls go through the product-value meter in the stages part; this module takes the
// call as a function, so its tests stub it and make none.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FROZEN } from "../frozen.ts";
import type { Ecosystem, JudgedBundle, PlantedUnit, ReviewRecord } from "../types.ts";
import type { GateDecision } from "./gates.ts";
import { ARM_NAMES, GOLD, JUDGE_MODELS, KEYWORD, SECTION_MAP } from "./local.ts";
import { isGap } from "./score.ts";
import { at, lvl } from "./stats.ts";

export const QUOTES_PROMPT = join(import.meta.dir, "prompts/judge-quotes.md");
export const NAMED_PROMPT = join(import.meta.dir, "prompts/judge-named.md");
/** Section 5's one rubric revision of call 2 (Captain ruling A, 2026-11-23), written after the stock control credited a
 * plan sentence on udbd167e5cbd0 that the plan's own reading had not matched. Call 1 is unchanged. Frozen from its first
 * call. */
export const NAMED_PROMPT_R1 = join(import.meta.dir, "prompts/judge-named-r1.md");
export const GENERIC_DIR = join(import.meta.dir, "generic");

export type JudgeRole = "judge" | "gold-opus" | "gold-gemini";
export const ROLE_MODEL: Record<JudgeRole, string> = { judge: JUDGE_MODELS.judge, "gold-opus": JUDGE_MODELS.gold[0], "gold-gemini": JUDGE_MODELS.gold[1] };
/** Each role's reasoning effort; null sends none, so the model uses its default. Section 8 froze high for all three. The
 * Captain's dated plan change of 2026-11-23, made before any gold label entered kappa, runs the Carbon labeller at its
 * default effort (the raters' setting): at high effort 33 of its 64 calls spent the whole 32,000-token cap thinking and
 * gave an empty reply. Those high-effort labels stay as a test-retest column only. */
export const ROLE_EFFORT: Record<JudgeRole, string | null> = { judge: JUDGE_MODELS.effort, "gold-opus": JUDGE_MODELS.effort, "gold-gemini": null };
/** One model call, by role (ROLE_MODEL picks the model, at JUDGE_MODELS.effort). */
export type JudgeCall = (role: JudgeRole, prompt: string) => Promise<string>;

export type Source = JudgedBundle["source"];
export interface BundleFile {
  path: string;
  text: string;
}
/** One bundle: the files the builder saw, plan.md first and then /work/review/ in the fixed order, and the unit's hint. */
export interface BundleInput {
  unit: string;
  source: Source;
  files: BundleFile[];
  hint: string;
}
export interface Prompts {
  quotes: string;
  named: string;
}
export const loadPrompts = (named: string = NAMED_PROMPT): Prompts => ({ quotes: readFileSync(QUOTES_PROMPT, "utf8"), named: readFileSync(named, "utf8") });

/** Arm and package names out of a bundle's text and file names. */
export const stripNames = (text: string): string => ARM_NAMES.reduce((t, re) => t.replace(re, "[name removed]"), text);

/** The bundle as the judge reads it: each file under a plain marker line, names stripped, and the files' own words cut
 * after 12,000 (markers don't count). */
export function bundleText(files: BundleFile[]): { text: string; words: number; truncated: boolean } {
  let left = FROZEN.bundle.maxWords;
  let truncated = false;
  const parts: string[] = [];
  for (const f of files) {
    const text = stripNames(f.text.trim());
    let n = 0;
    let cut = text.length;
    for (const m of text.matchAll(/\S+/g)) {
      if (n === left) {
        cut = m.index;
        truncated = true;
        break;
      }
      n++;
    }
    left -= n;
    if (n === 0 && cut === 0) continue;
    parts.push("=== file: " + stripNames(f.path) + " ===\n" + text.slice(0, cut).trimEnd());
  }
  return { text: parts.join("\n\n"), words: FROZEN.bundle.maxWords - left, truncated };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Call 1's answer: a JSON array of quotes. The first 12 count (the fixed item cap); a quote not found verbatim in the
 * bundle (whitespace and case aside) is dropped and counted. */
export function parseQuotes(answer: string, text: string): { quotes: string[]; dropped: number; over: number; error: string | null } {
  if (!answer.trim()) return { quotes: [], dropped: 0, over: 0, error: "call 1 gave an empty reply" };
  const s = answer.indexOf("[");
  const e = answer.lastIndexOf("]");
  let raw: unknown;
  try {
    raw = s >= 0 && e > s ? JSON.parse(answer.slice(s, e + 1)) : null;
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return { quotes: [], dropped: 0, over: 0, error: "call 1 gave no JSON array" };
  const all = raw.filter((q): q is string => typeof q === "string" && q.trim() !== "");
  const kept = all.slice(0, FROZEN.judge.maxItems);
  const body = norm(text);
  const quotes = kept.filter((q) => body.includes(norm(q.replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, ""))));
  return { quotes, dropped: kept.length - quotes.length, over: all.length - kept.length, error: null };
}

/** Call 2's answer: "MATCH <n>" for the first quote that names the planted condition, or NONE. */
export function parseNamed(answer: string, n: number): number | null {
  const m = /^\s*MATCH\s+(\d+)/i.exec(answer.trim().split("\n")[0] ?? "");
  const k = m ? Number(m[1]) : 0;
  return k >= 1 && k <= n ? k - 1 : null;
}

/** The bundle heading a quote sits under (its nearest Markdown heading, else its file marker), mapped to the section map. */
export function sectionOf(text: string, quote: string): string {
  const parts = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const at0 = parts.length && parts[0] ? text.search(new RegExp(parts.join("\\s+"), "i")) : -1;
  if (at0 < 0) return "other";
  const heading = text.slice(0, at0).split("\n").filter((l) => /^#{1,6}\s/.test(l) || l.startsWith("=== file: ")).pop() ?? "";
  return SECTION_MAP.find(([, re]) => re.test(heading))?.[0] ?? "other";
}

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (all, k: string) => vars[k] ?? all);

export interface JudgeResult extends JudgedBundle {
  role: JudgeRole;
  matched: number | null;
  dropped: number;
  over: number;
  truncated: boolean;
  error: string | null;
  digest: string;
}

/** The two blind calls on one bundle. Call 1 never sees the hint or an arm name; call 2 sees only the hint and the quotes.
 * A bundle with no quote makes no second call and names nothing. An empty reply to either call is the bundle's error,
 * never a reading: an empty call 2 names nothing and is not read as NONE. */
export async function judgeBundle(b: BundleInput, call: JudgeCall, role: JudgeRole = "judge", prompts: Prompts = loadPrompts()): Promise<JudgeResult> {
  const t = bundleText(b.files);
  const digest = createHash("sha256").update(t.text + "\0" + b.hint).digest("hex");
  const q = parseQuotes(await call(role, fill(prompts.quotes, { MAX: String(FROZEN.judge.maxItems), BUNDLE: t.text })), t.text);
  const base = { unit: b.unit, source: b.source, words: t.words, quotes: q.quotes, role, dropped: q.dropped, over: q.over, truncated: t.truncated, error: q.error, digest };
  if (!q.quotes.length) return { ...base, named: false, matched: null, sections: [] };
  const answer = await call(role, fill(prompts.named, { HINT: b.hint.trim(), QUOTES: q.quotes.map((x, i) => i + 1 + ". " + x).join("\n") }));
  if (!answer.trim()) return { ...base, error: "call 2 gave an empty reply", named: false, matched: null, sections: [] };
  const matched = parseNamed(answer, q.quotes.length);
  return { ...base, named: matched !== null, matched, sections: matched === null ? [] : [sectionOf(t.text, q.quotes[matched]!)] };
}

/** Every bundle in order, one call pair at a time (the first runs alone). Identical text and hint, such as the no-review
 * bundle and the authored plan alone, are read once and the reading is reused. */
export async function judgeAll(bundles: BundleInput[], call: JudgeCall, role: JudgeRole = "judge", prompts: Prompts = loadPrompts()): Promise<JudgeResult[]> {
  const seen = new Map<string, JudgeResult>();
  const out: JudgeResult[] = [];
  for (const b of bundles) {
    const t = bundleText(b.files);
    const key = createHash("sha256").update(t.text + "\0" + b.hint).digest("hex");
    const hit = seen.get(key);
    const r = hit ? { ...hit, unit: b.unit, source: b.source } : await judgeBundle(b, call, role, prompts);
    seen.set(key, r);
    out.push(r);
  }
  return out;
}

/** The bundle set: per unit, the first review of each arm with no gap in the order given (the records' seeded run
 * order), plus stock, no review and the authored plan alone. */
export function bundleSet(units: PlantedUnit[], reviews: ReviewRecord[]): Array<{ unit: string; source: Source; rep: number | null }> {
  const out: Array<{ unit: string; source: Source; rep: number | null }> = [];
  for (const u of units) {
    for (const arm of ["plain", "engphase", "standalone"] as const) {
      const first = reviews.find((r) => r.unit === u.id && r.arm === arm && r.reviewer === "opus" && !isGap(r));
      if (first) out.push({ unit: u.id, source: arm, rep: first.rep });
    }
    for (const source of ["stock", "none", "plan"] as const) out.push({ unit: u.id, source, rep: null });
  }
  return out;
}

const STOP = new Set(["that", "this", "with", "from", "when", "should", "would", "which", "their", "there", "into", "than", "then", "them", "they", "have", "been", "were", "will", "your", "what", "each", "also", "only", "such", "must", "does", "dont", "case", "cases", "code", "function", "value", "values", "return", "returns"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []).filter((w) => w.length >= KEYWORD.minLetters && !STOP.has(w)));

/** The quick keyword match: at least half of the probe's content words appear in the text. */
export function keywordHit(probe: string, text: string): boolean {
  const need = [...words(probe)];
  if (!need.length) return false;
  const have = words(text);
  return need.filter((w) => have.has(w)).length / need.length >= KEYWORD.share;
}

export type GoldPool = "smoke" | "standalone" | "engphase" | "plain" | "stock" | "plan";
export interface GoldCandidate {
  key: string;
  unit: string;
  source: Source;
  bundle: BundleInput;
}
const QUOTA: Record<GoldPool, number> = { smoke: GOLD.smoke, standalone: GOLD.comparisonPerSkillArm, engphase: GOLD.comparisonPerSkillArm, plain: GOLD.pilotPlain, stock: GOLD.stock, plan: GOLD.plan };
const ENRICHABLE: GoldPool[] = ["standalone", "engphase", "plain"];

/** The gold set, each pool in seeded order: the 12 smoke skill reviews, the first 10 comparison reviews of each skill
 * arm, 12 pilot plain reviews, 2 stock and 2 plan-only bundles. When the keyword proxy for positives sits outside 30% to
 * 50%, the comparison and pilot pools swap their last picks for the next draws on the short side until it reaches 40%,
 * so each pool keeps its count and the set stays balanced by arm. */
export function goldSet(pools: Record<GoldPool, GoldCandidate[]>): { picked: GoldCandidate[]; proxy: number; short: string[] } {
  const hit = (c: GoldCandidate) => keywordHit(c.bundle.hint, bundleText(c.bundle.files).text);
  const picked = {} as Record<GoldPool, GoldCandidate[]>;
  const short: string[] = [];
  for (const p of Object.keys(QUOTA) as GoldPool[]) {
    picked[p] = pools[p].slice(0, QUOTA[p]);
    if (picked[p].length < QUOTA[p]) short.push(p + " " + picked[p].length + " of " + QUOTA[p]);
  }
  const all = () => (Object.keys(QUOTA) as GoldPool[]).flatMap((p) => picked[p]);
  const share = () => all().filter(hit).length / Math.max(all().length, 1);
  const P = FROZEN.judge.prevalence;
  const want = share() < P.min ? true : share() > P.max ? false : null;
  if (want !== null) {
    let moved = true;
    while (moved && (want ? at(share()) < GOLD.proxyTarget : at(share()) > GOLD.proxyTarget)) {
      moved = false;
      for (const p of ENRICHABLE) {
        if (want ? at(share()) >= GOLD.proxyTarget : at(share()) <= GOLD.proxyTarget) break;
        const out = [...picked[p]].reverse().find((c) => hit(c) !== want);
        const inn = pools[p].find((c) => !picked[p].includes(c) && hit(c) === want);
        if (!out || !inn) continue;
        picked[p] = [...picked[p].filter((c) => c !== out), inn];
        moved = true;
      }
    }
  }
  return { picked: all(), proxy: share(), short };
}

/** One gold label: a labeller's two calls on the same stripped bundle and hint, with the same rubric. */
export const goldLabel = async (c: GoldCandidate, call: JudgeCall, role: "gold-opus" | "gold-gemini", prompts: Prompts = loadPrompts()) => (await judgeBundle(c.bundle, call, role, prompts)).named;

export interface Settlement {
  named: boolean;
  /** Who read the fix, blind to arm. */
  by: string;
  note: string;
}
export interface GoldRow {
  key: string;
  unit: string;
  source: Source;
  /** The judge's reading. */
  judge: boolean;
  /** Opus 5.5 and Gemini 4 Carbon. */
  labels: [boolean, boolean];
  /** The run thread's reading of the fix's diff when the labellers disagree; null otherwise. */
  settled: Settlement | null;
}

/** Gold: the labellers' shared label, else the settlement, else null (not settled yet). */
export const goldOf = (r: GoldRow): boolean | null => (r.labels[0] === r.labels[1] ? r.labels[0] : r.settled ? r.settled.named : null);

/** Cohen's kappa of the judge against gold, with sensitivity, specificity and gold prevalence. */
export function kappaOf(pairs: Array<[boolean, boolean]>): { kappa: number; sensitivity: number | null; specificity: number | null; prevalence: number; n: number } {
  const n = pairs.length;
  const tp = pairs.filter(([j, g]) => j && g).length;
  const tn = pairs.filter(([j, g]) => !j && !g).length;
  const fp = pairs.filter(([j, g]) => j && !g).length;
  const fn = pairs.filter(([j, g]) => !j && g).length;
  const po = n ? (tp + tn) / n : 0;
  const pj = n ? (tp + fp) / n : 0;
  const pg = n ? (tp + fn) / n : 0;
  const pe = pj * pg + (1 - pj) * (1 - pg);
  const kappa = po === 1 ? 1 : pe === 1 ? 0 : (po - pe) / (1 - pe);
  return { kappa, sensitivity: tp + fn ? tp / (tp + fn) : null, specificity: tn + fp ? tn / (tn + fp) : null, prevalence: pg, n };
}

export interface CheckResult extends GateDecision {
  pass: boolean;
  kappa: number | null;
  unsettled: string[];
  lines: string[];
}

/** The judge check: at least 48 gold bundles, every disagreement settled, kappa at least 0.6, and no stock bundle in the
 * gold set credited. A failure is E_EP_JUDGE_CHECK; unsettled disagreements refuse until the run thread settles them. */
export function judgeCheck(rows: GoldRow[]): CheckResult {
  const unsettled = rows.filter((r) => goldOf(r) === null).map((r) => r.key);
  const lines = ["judge check: " + rows.length + " gold bundles (" + (["plain", "engphase", "standalone", "stock", "plan", "none"] as Source[]).map((s) => s + " " + rows.filter((r) => r.source === s).length).join(", ") + "), labellers disagree on " + rows.filter((r) => r.labels[0] !== r.labels[1]).length + ", settled " + rows.filter((r) => r.settled).length];
  if (unsettled.length) return { pass: false, kappa: null, unsettled, lines: [...lines, "settle first: " + unsettled.join(", ")], code: "E_USAGE", message: unsettled.length + " gold disagreements are not settled; the run thread reads each fix blind to arm and records it first: " + unsettled.join(", ") };
  const k = kappaOf(rows.map((r) => [r.judge, goldOf(r)!]));
  const stock = rows.filter((r) => r.source === "stock" && r.judge).length;
  lines.push("kappa " + lvl(k.kappa) + " against " + FROZEN.judge.kappaMin.toFixed(2) + ", sensitivity " + lvl(k.sensitivity) + ", specificity " + lvl(k.specificity) + ", gold prevalence " + lvl(k.prevalence) + " (band " + FROZEN.judge.prevalence.min.toFixed(2) + " to " + FROZEN.judge.prevalence.max.toFixed(2) + (at(k.prevalence) < FROZEN.judge.prevalence.min || at(k.prevalence) > FROZEN.judge.prevalence.max ? ", outside it" : "") + "), stock bundles credited " + stock);
  const why: string[] = [];
  if (rows.length < FROZEN.judge.minGold) why.push("gold holds " + rows.length + " bundles, under " + FROZEN.judge.minGold);
  if (at(k.kappa) < FROZEN.judge.kappaMin) why.push("kappa " + lvl(k.kappa) + " is under " + FROZEN.judge.kappaMin.toFixed(2));
  if (stock) why.push(stock + " stock bundle" + (stock === 1 ? "" : "s") + " credited, the stock control must score 0");
  const message = why.length ? why.join("; ") + ": the judged secondary is not reported as judged; the primary is unaffected" : "";
  return { pass: !why.length, kappa: k.kappa, unsettled, lines: [...lines, why.length ? "E_EP_JUDGE_CHECK " + message : "judge check passes"], code: why.length ? "E_EP_JUDGE_CHECK" : null, message };
}

export interface StockControl extends GateDecision {
  /** Units whose authored plan also scores: plan leaks, dropped from the judged secondary (they stay in the primary). */
  leaks: string[];
  /** Units where the stock review scores and the plan doesn't: the rubric is at fault. */
  faults: string[];
  action: "ok" | "revise" | "unreported";
  lines: string[];
}

/** The stock control on every unit. The stock review must score 0; when it scores, the authored plan is read first: a plan
 * that also scores is a plan leak, otherwise the rubric is at fault. One frozen rubric revision is allowed (it reruns the
 * judge check); a fault after it leaves the secondary unreported (E_EP_JUDGE_CHECK). */
export function stockControl(results: JudgedBundle[], revision: number): StockControl {
  const named = (unit: string, s: Source) => results.some((r) => r.unit === unit && r.source === s && r.named);
  const scored = [...new Set(results.filter((r) => r.source === "stock" && r.named).map((r) => r.unit))];
  const leaks = scored.filter((u) => named(u, "plan"));
  const faults = scored.filter((u) => !named(u, "plan"));
  const action = !faults.length ? "ok" : revision < 1 ? "revise" : "unreported";
  const head = "stock control: stock scored on " + scored.length + " units, plan leaks " + leaks.length + (leaks.length ? " (dropped from the judged secondary)" : "") + ", rubric faults " + faults.length + ", rubric revision " + revision;
  const line = action === "ok" ? "stock control holds" : action === "revise" ? "rubric fault: the one frozen rubric revision runs, and the judge check reruns with it" : "E_EP_JUDGE_CHECK rubric fault after the one revision: the judged secondary is unreported";
  return { leaks, faults, action, lines: [head, line], code: action === "unreported" ? "E_EP_JUDGE_CHECK" : null, message: action === "unreported" ? "the stock control scored on " + faults.length + " units after the one rubric revision; the judged secondary is unreported" : "" };
}

/** One ecosystem's generic-specific list: 30 common edge cases, written blind to units (generic/<ecosystem>.txt). */
export function genericList(eco: Ecosystem): string[] {
  const list = readFileSync(join(GENERIC_DIR, eco + ".txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (list.length !== FROZEN.judge.genericPerEcosystem) throw new Error("generic/" + eco + ".txt holds " + list.length + " entries, not " + FROZEN.judge.genericPerEcosystem);
  return list;
}

/** Per source, the credited quotes and how many of them a generic-list entry of the unit's ecosystem matches. */
export function genericRate(results: JudgedBundle[], units: PlantedUnit[]): Record<string, { credited: number; generic: number; rate: number | null }> {
  const eco = new Map(units.map((u) => [u.id, u.ecosystem]));
  const lists = new Map<Ecosystem, string[]>();
  const out: Record<string, { credited: number; generic: number; rate: number | null }> = {};
  for (const r of results) {
    const e = eco.get(r.unit);
    const quote = r.named ? (r as Partial<JudgeResult>).matched : null;
    if (!e || quote === null || quote === undefined) continue;
    if (!lists.has(e)) lists.set(e, genericList(e));
    const o = (out[r.source] ??= { credited: 0, generic: 0, rate: null });
    o.credited++;
    if (lists.get(e)!.some((entry) => keywordHit(entry, r.quotes[quote] ?? ""))) o.generic++;
    o.rate = o.generic / o.credited;
  }
  return out;
}

/** What the analysis reads: whether the judged secondary is reported, why not, every reading, and the plan leaks. */
export interface JudgedSummary {
  reported: boolean;
  why: string | null;
  bundles: JudgeResult[];
  leaks: string[];
}

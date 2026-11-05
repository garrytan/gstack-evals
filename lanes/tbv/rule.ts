#!/usr/bin/env bun
// tbv-rule.ts: the frozen rules of the trust-but-verify eval (GEVA-313, preregistration 2026-11-05-geva-313-trust-but-verify-prereg).
// It reads files and prints; it calls no model and needs no key.
//   bun tbv-rule.ts words <texts.json>          the word rule, the 150, 250 and 400 cuts and the share over 250
//   bun tbv-rule.ts endstate <attempts.json>    one reading's outcome class from its attempts, in the frozen precedence
//   bun tbv-rule.ts admit <round.json>          round admission against an item's cap
//   bun tbv-rule.ts headroom <readings.json>    stage 1: NO READ, JUDGE FAIL, agreement, the band, costs
//   bun tbv-rule.ts projection <proj.json>      stage 1 to later stages: caps from measured costs
//   bun tbv-rule.ts allin <allin.json>          the all-in check before stage 3: third Opus pass, capy drop or stop
//   bun tbv-rule.ts caps <caps.json>            the money table: each item's cap from capOf, and the sums at caps
//   bun tbv-rule.ts compare <readings.json>     dev or held-out: families, verdicts, flags and secondaries
//   bun tbv-rule.ts handoff <handoff.json>      the dev handoff check against held-out material
//   bun tbv-rule.ts leak <leak.json>            the treatment-diff leak check
// Ported from the frozen bundle's tbv-rule.ts.txt; paired.ts is imported from this checkout.
import { readFileSync } from "node:fs";

import { clusteredPairedDelta, holmAdjusted } from "../../src/runner/stats/paired.ts";

export const SEED = 20261105, DRAWS = 10_000;
export const CUT = 250, CUTS = [150, 250, 400];
export const BAND = { lo: 0.15, hi: 0.75 };
export const STOCK_MAX = 0.1, ORACLE_MIN = 0.85, AGREE_MIN = 0.7, EXPOSURE_MIN = 0.8, COVERAGE_MIN = 0.9;
export const HR_MIN_TASKS = 16, HR_MAX_MISSING = 0.1;
export const CAP_FACTOR = 1.15, ROUND = 4, MAX_TOKENS = 4000, RETRIES = 2;
// A reading's worst case: four sends (report, follow-up, D1, D2); the first carries at least WORST_INPUT tokens, and each later one adds max_tokens and a user turn per earlier send.
export const SENDS = 4, WORST_INPUT = 130_000, USER_TURN = 100;
export const LINE_USD = 2000;
// MDD rows (recall points at 80% power, Holm's first step, control 0.50) from power.txt, by non-clean tasks and passes.
export const MDD: Record<number, [number, number][]> = { 2: [[40, 13.1], [50, 11.6], [70, 10.0], [100, 8.1]], 3: [[40, 11.0], [50, 9.8], [70, 8.2], [100, 6.8]] };

type Model = "opus" | "sol" | "particle";
type Arm = "none" | "current" | "principle" | "lens";
type Family = "investigate" | "ship" | "capy" | "review";
type Status = "scored" | "no-report" | "gap" | "harness" | "unjudged" | "cap";
interface Fact { in: boolean; any: boolean }
interface Reading { id: string; task: string; family: Family; arm: Arm; model: Model; pass: number; status: Status; judge: "sol" | "opus"; facts: Fact[]; unsupported: number; exposed: boolean | null; words: number; usd: number; cacheRead?: number; list?: { named: boolean; order: boolean; rest: boolean; offer: boolean }; shortShare?: number; d1?: number | null; second?: { judge: "sol" | "opus"; facts: Fact[] } }
interface Task { id: string; cluster: string; source: "A" | "B"; stratum: "long" | "short" | "other" | "clean"; nfacts: number }
interface Control { task: string; kind: "stock" | "oracle"; judge: "sol" | "opus"; facts: Fact[] }
interface Readings { stage: "hr" | "dev" | "held"; tasks: Task[]; readings: Reading[]; controls?: Control[]; plan: { models: Model[]; passes: Partial<Record<Model, number>>; capyPasses?: number; skillArms: Arm[]; devGap?: { opusPrincipleMinusNone: number; devMdd: number } } }

const out: string[] = [];
const say = (t: string) => out.push(t);
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(3));
const usd = (x: number) => "$" + x.toFixed(2);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
const fail = (msg: string): never => { console.error(msg); process.exit(2); };

// Word rule: a whitespace-separated token with at least one letter or digit.
export const isWord = (t: string) => /[\p{L}\p{N}]/u.test(t);
export function words(text: string) { return text.split(/\s+/).filter((t) => t && isWord(t)).length; }
/** The character offset right after the nth word, or the text's length when it has fewer. */
export function boundary(text: string, n: number) {
  const re = /\S+/g;
  let m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) { if (isWord(m[0]) && ++k === n) return m.index + m[0].length; }
  return text.length;
}

// End states, in the frozen precedence. Each attempt is one send of the same request.
type Attempt = { kind: "text" | "tool-only" | "empty" | "refusal" | "5xx" | "timeout" | "broken-stream" | "truncated" | "no-final" | "4xx" | "budget" | "allowance" | "validator" | "closer"; turn: "report" | "followup" | "d1" | "d2" };
export function endState(attempts: Attempt[]) {
  let sends = 0, retries = 0, followup = false;
  const drill: Record<string, string> = {};
  let report: string | null = null;
  for (const a of attempts) {
    if (a.kind !== "validator" && a.kind !== "closer") sends++;
    if (a.kind === "validator" || a.kind === "closer") return { cls: "harness", sends, why: a.kind === "closer" ? "closer byte check failed" : "request failed the validator" };
    if (a.kind === "budget") { if (a.turn === "d1" || a.turn === "d2") { drill[a.turn] = "drill-down gap (cap)"; return { cls: report ?? "gap", sends, why: "the item's cap refused " + a.turn + ": the item stops, the report stands and " + a.turn + " drops", drill }; } return { cls: "cap", sends, why: "the item's cap refused the round: the item stops" }; }
    if (a.kind === "allowance") { if (a.turn === "d1" || a.turn === "d2") { drill[a.turn] = "drill-down gap (allowance)"; continue; } return { cls: "gap", sends, why: "allowance refusal on the report turn" }; }
    if (a.kind === "4xx") return { cls: "harness", sends, why: "a 4xx that is not a refusal or a budget error" };
    const transport = a.kind === "5xx" || a.kind === "timeout" || a.kind === "broken-stream" || a.kind === "truncated" || a.kind === "no-final";
    if (transport) {
      retries++;
      if (retries > RETRIES) { if (a.turn === "d1" || a.turn === "d2") { drill[a.turn] = "drill-down gap"; retries = 0; continue; } return { cls: "gap", sends, why: "transport failure after " + RETRIES + " retries" }; }
      continue;
    }
    retries = 0;
    if (a.turn === "report" || a.turn === "followup") {
      if (a.kind === "refusal") { report = "no-report"; continue; }
      if (a.kind === "text") { report = "scored"; continue; }
      if (!followup && a.turn === "report") { followup = true; continue; }
      report = "no-report";
    } else drill[a.turn] = a.kind === "text" ? "ok" : "drill-down gap";
  }
  return { cls: report ?? "gap", sends, why: report ? "" : "no final response", drill };
}

export function roundAdmits(r: { settled: number; reserved: number; unknown: number; roundWorst: number; cap: number }) {
  return r.settled + r.reserved + r.unknown + r.roundWorst <= r.cap + 1e-9;
}
type Price = { in: number; out: number; cacheWrite?: number };
/** A reading's worst case: its four sends, send k carrying the first send's input plus k times (max_tokens + a user turn), each input token at the higher of the input and cache-write rates (every send carries a cache breakpoint, a miss rewrites the cache, and the metering proxy reserves at that rate), and max_tokens out. A retry is its own send and reserves its own worst case before it goes. */
export function readingWorst(p: { inputTokens: number; price: Price }) {
  let usd = 0;
  for (let k = 0; k < SENDS; k++) usd += ((p.inputTokens + k * (MAX_TOKENS + USER_TURN)) * Math.max(p.price.in, p.price.cacheWrite ?? 0) + MAX_TOKENS * p.price.out) / 1e6;
  return usd;
}
/** One round (4 readings) at the worst case of the costliest model, from a first send of WORST_INPUT tokens. */
function roundWorst(models: Model[], prices: Record<string, Price>) {
  return ROUND * Math.max(...models.map((m) => readingWorst({ inputTokens: WORST_INPUT, price: prices[m] ?? fail("E_USAGE no price for " + m) })));
}
/** Every item's cap: 1.15 times its projection plus one round at its worst case, rounded up to the dollar. The projection check and the caps command both use it. */
export const capOf = (projected: number, round: number) => Math.ceil(Math.round((CAP_FACTOR * projected + round) * 1e6) / 1e6);

const judged = (r: Reading) => r.status === "scored" || r.status === "no-report";
/** The input guards every reading command runs: a known task, no duplicate, a pass inside the plan, labels that match the key on a scored reading, a finite unsupported count of at least 0, and the frozen no-report shape (no fact labels, unsupported 0). */
function validate(rd: Readings, passesOf: (r: Reading) => number | undefined) {
  const tasks = new Map(rd.tasks.map((t) => [t.id, t]));
  const keys = new Set<string>();
  for (const r of rd.readings) {
    const t = tasks.get(r.task) ?? fail("E_USAGE reading " + r.id + " names a task the readings do not hold");
    const k = [r.task, r.family, r.arm, r.model, r.pass].join("|");
    if (keys.has(k)) fail("E_USAGE duplicated reading " + k);
    keys.add(k);
    const n = passesOf(r);
    if (n !== undefined && !(Number.isInteger(r.pass) && r.pass >= 1 && r.pass <= n)) fail("E_USAGE reading " + r.id + " has pass " + r.pass + ", outside 1 to " + n);
    if (r.status === "no-report" && (r.facts.length !== 0 || r.unsupported !== 0)) fail("E_USAGE no-report reading " + r.id + " must carry no fact labels and unsupported 0");
    if (r.status === "scored" && r.facts.length !== t.nfacts) fail("E_USAGE reading " + r.id + " has " + r.facts.length + " fact labels for a task with " + t.nfacts);
    if (r.status === "scored" && !(Number.isFinite(r.unsupported) && r.unsupported >= 0)) fail("E_USAGE reading " + r.id + " has no unsupported count of at least 0");
  }
  return tasks;
}
const recall = (r: Reading) => (r.status === "no-report" || !r.facts.length ? 0 : r.facts.filter((f) => f.in).length / r.facts.length);
const recallAny = (r: Reading) => (r.status === "no-report" || !r.facts.length ? 0 : r.facts.filter((f) => f.any).length / r.facts.length);

function agreement(rs: Reading[], controls: Control[] = []) {
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  for (const r of rs) if (r.second && judged(r) && r.status === "scored") r.facts.forEach((f, i) => { const g = r.second!.facts[i]?.in ?? false; if (f.in && g) both++; else if (f.in) aOnly++; else if (g) bOnly++; else neither++; });
  const n = both + aOnly + bOnly + neither;
  const psa = 2 * both + aOnly + bOnly ? (2 * both) / (2 * both + aOnly + bOnly) : NaN;
  const raw = n ? (both + neither) / n : NaN;
  const pa = n ? ((both + aOnly) / n) * ((both + bOnly) / n) + ((neither + bOnly) / n) * ((neither + aOnly) / n) : NaN;
  const kappa = n && pa < 1 ? (raw - pa) / (1 - pa) : NaN;
  return { n, psa, raw, kappa, line: "double-read facts " + n + "; both " + both + ", first only " + aOnly + ", second only " + bOnly + ", neither " + neither + "; positive agreement " + f3(psa) + ", raw " + f3(raw) + ", kappa " + f3(kappa) };
}

function controlsCheck(cs: Control[]) {
  const rate = (kind: string, judge: string) => mean(cs.filter((c) => c.kind === kind && c.judge === judge).map((c) => (c.facts.length ? c.facts.filter((f) => f.in).length / c.facts.length : 0)));
  const lines: string[] = [];
  let ok = true;
  for (const j of ["sol", "opus"]) {
    const s = rate("stock", j), o = rate("oracle", j);
    lines.push("controls (" + j + "): stock " + f3(s) + " (max " + STOCK_MAX + "), oracle " + f3(o) + " (min " + ORACLE_MIN + ")");
    if (!(s <= STOCK_MAX) || !(o >= ORACLE_MIN)) ok = false;
  }
  return { ok, lines };
}

function clusterMean(rs: Reading[], tasks: Map<string, Task>, f: (r: Reading) => number) {
  const byTask = new Map<string, number[]>();
  for (const r of rs) byTask.set(r.task, [...(byTask.get(r.task) ?? []), f(r)]);
  const byCluster = new Map<string, number[]>();
  for (const [t, v] of byTask) { const c = tasks.get(t)!.cluster; byCluster.set(c, [...(byCluster.get(c) ?? []), mean(v)]); }
  return new Map([...byCluster].map(([c, v]) => [c, mean(v)]));
}

function headroom(rd: Readings) {
  if (rd.stage !== "hr") fail("E_USAGE headroom reads stage hr readings");
  const passes = rd.plan.passes.opus ?? 3;
  const tasks = validate(rd, (r) => (r.arm === "none" && r.model === "opus" ? passes : undefined));
  const hr = rd.tasks.filter((t) => t.stratum !== "clean");
  const hrIds = new Set(hr.map((t) => t.id));
  const none = rd.readings.filter((r) => r.arm === "none" && r.model === "opus" && hrIds.has(r.task));
  const slots = new Set<string>();
  for (const r of none) { const k = r.task + "#" + r.pass; if (slots.has(k)) fail("E_USAGE duplicated reading " + k + ": one Opus none reading per task and pass, whatever its family"); slots.add(k); }
  const planned = hr.length * passes;
  const missing = none.filter((r) => !judged(r)).length + Math.max(0, planned - none.length);
  const readable = new Set(none.filter(judged).map((r) => r.task));
  say("Stage 1 headroom: " + hr.length + " tasks, Opus none planned " + planned + ", judged " + none.filter(judged).length + ", missing or unjudged " + missing);
  const ag = agreement(rd.readings);
  say("Agreement: " + ag.line);
  const ctl = controlsCheck(rd.controls ?? []);
  ctl.lines.forEach((l) => say(l));
  const costs = new Map<string, number[]>();
  for (const r of rd.readings) if (r.status !== "harness") costs.set(r.arm + ":" + r.model, [...(costs.get(r.arm + ":" + r.model) ?? []), r.usd]);
  for (const [k, v] of [...costs].sort()) say("cost " + k + ": " + v.length + " readings, mean " + usd(mean(v)) + ", cache-read share " + f3(mean(rd.readings.filter((r) => r.arm + ":" + r.model === k && r.cacheRead !== undefined).map((r) => r.cacheRead!))));
  for (const k of [...new Set(rd.readings.filter((r) => r.arm === "current" || r.arm === "principle").map((r) => r.arm + ":" + r.model))].sort()) { const rs = rd.readings.filter((r) => r.arm + ":" + r.model === k); say("exposure " + k + ": " + rs.filter((r) => r.exposed).length + "/" + rs.length); }
  if (rd.readings.some((r) => r.status === "harness")) { say("Verdict: HARNESS FAILURE (a request failed the validator, a closer check or a non-refusal 4xx; stage 1 stops for a B1 fix under a new post)"); return; }
  if (readable.size < HR_MIN_TASKS || missing > HR_MAX_MISSING * planned) { say("Verdict: NO READ (readable tasks " + readable.size + ", missing " + missing + " of " + planned + ")"); return; }
  if (!ctl.ok) { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: a control is out of bounds)"); return; }
  if (!(ag.psa >= AGREE_MIN)) { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: positive agreement " + f3(ag.psa) + " under " + AGREE_MIN + "; no brief revision is bought)"); return; }
  const cm = clusterMean(none.filter(judged), tasks, recall);
  const r0 = Math.round(mean([...cm.values()]) * 1e9) / 1e9;
  const pairs = [...cm].map(([c, v]) => ({ id: c, cluster: c, a: 0, b: v }));
  const s = pairs.length > 1 ? clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS }) : null;
  const full = [...readable].filter((t) => none.filter((r) => r.task === t && judged(r)).every((r) => recall(r) === 1)).length;
  say("R0 (Opus none first-level recall, cluster means): " + f3(r0) + ", 95% CI " + (s?.ci95 ? "[" + f3(s.ci95[0]) + ", " + f3(s.ci95[1]) + "]" : "n/a") + "; tasks fully disclosed in every reading " + full + "/" + readable.size + "; none reports over " + CUT + " words " + none.filter((r) => r.words > CUT).length + "/" + none.length);
  say("Verdict: " + (r0 > BAND.hi ? "CEILING" : r0 < BAND.lo ? "FLOOR" : "HEADROOM") + " (band " + BAND.lo + " to " + BAND.hi + ")");
}

function projection(p: { items: { item: string; readings: { model: Model; arm: Arm; n: number }[]; judgeN: number }[]; measured: Record<string, number>; judgePerReading: number; prices: Record<Model, Price> }) {
  let total = 0;
  for (const it of p.items) {
    let proj = it.judgeN * p.judgePerReading;
    for (const r of it.readings) {
      const m = p.measured[(r.arm === "principle" ? "current" : r.arm) + ":" + r.model];
      if (m === undefined) fail("E_USAGE no measured cost for " + r.arm + ":" + r.model + " (stage 1 must measure every model and arm path a later item runs)");
      proj += r.n * m;
    }
    const worst = roundWorst(it.readings.map((r) => r.model), p.prices);
    const cap = capOf(proj, worst);
    total += cap;
    say(it.item + ": projected " + usd(proj) + ", round worst case " + usd(worst) + ", cap " + usd(cap));
  }
  say("caps in all: " + usd(total));
}

/** The money table: each reading item's cap from capOf at the planned worst case, any other item's cap as set, and the sums at caps against the line. */
function caps(c: { items: { item: string; projected: number; models?: Model[]; cap?: number; optional?: boolean }[]; prices: Record<Model, Price>; crewReserve: number }) {
  let paid = 0, projected = 0, optional = 0;
  for (const it of c.items) {
    if (!it.models === (it.cap === undefined)) fail("E_USAGE " + it.item + " needs either models (a reading item) or a cap set directly");
    const worst = it.models ? roundWorst(it.models, c.prices) : null;
    const cap = worst === null ? it.cap! : capOf(it.projected, worst);
    if (it.optional) optional += cap; else { paid += cap; projected += it.projected; }
    say(it.item + ": projected " + usd(it.projected) + (worst === null ? ", cap " + usd(cap) + " (set directly: not a reading item)" : ", round worst case " + usd(worst) + ", cap " + usd(cap)) + (it.optional ? " (only if the all-in check passes with it)" : ""));
  }
  const allIn = paid + c.crewReserve;
  say("paid at caps " + usd(paid) + " (projected " + usd(projected) + "), crew reserve " + usd(c.crewReserve) + ", all-in at caps " + usd(allIn) + "; with the optional lines " + usd(allIn + optional));
  say("Verdict: " + (allIn <= LINE_USD ? "UNDER " : "OVER ") + usd(LINE_USD) + " at caps" + (optional ? (allIn + optional <= LINE_USD ? "; the optional lines fit at caps" : "; the optional lines don't fit at caps, so they run only when the all-in check on actual spend passes") : ""));
}

function allin(a: { crewSpent: number; crewRest: number; settled: number; reserved: number; unknown: number; heldCap: number; thirdPassCap: number; capyCap: number }) {
  const base = a.crewSpent + a.crewRest + a.settled + a.reserved + a.unknown;
  say("all-in before stage 3: crew spent " + usd(a.crewSpent) + " + crew to come " + usd(a.crewRest) + " + settled " + usd(a.settled) + " + reserved " + usd(a.reserved) + " + unknown " + usd(a.unknown) + " = " + usd(base));
  if (base + a.heldCap + a.thirdPassCap <= LINE_USD) { say("Verdict: STAGE 3 WITH THE THIRD OPUS PASS (" + usd(base + a.heldCap + a.thirdPassCap) + ")"); return; }
  if (base + a.heldCap <= LINE_USD) { say("Verdict: STAGE 3, TWO PASSES (" + usd(base + a.heldCap) + ")"); return; }
  if (base + a.heldCap - a.capyCap <= LINE_USD) { say("Verdict: STAGE 3 WITHOUT THE CAPY FAMILY (" + usd(base + a.heldCap - a.capyCap) + ")"); return; }
  say("Verdict: NO STAGE 3 (to the Captain; " + usd(base + a.heldCap - a.capyCap) + " over " + usd(LINE_USD) + ")");
}

/** The MDD row for the largest tabled task count at or under n, so a smaller read never borrows a larger read's MDD; null under the smallest row. */
function mddFor(n: number, passes: number) {
  const rows = MDD[passes] ?? MDD[2]!;
  return [...rows].reverse().find(([k]) => k <= n)?.[1] ?? null;
}

const gstackArm = (arm: Arm) => arm === "current" || arm === "principle";
/** One paired contrast b minus a over matched task-pass rows, on the non-clean tasks or, with clean, on the clean tasks only. */
function contrast(rd: Readings, tasks: Map<string, Task>, model: Model, fams: Family[], b: Arm, a: Arm, f: (r: Reading) => number, clean = false) {
  const ids = new Set(rd.tasks.filter((t) => (t.stratum === "clean") === clean && (fams.includes("capy") ? t.source === "B" : fams.includes(famOf(t)))).map((t) => t.id));
  const pick = (arm: Arm, fam: Family[]) => new Map(rd.readings.filter((r) => r.model === model && r.arm === arm && ids.has(r.task) && fam.includes(r.family)).map((r) => [r.task + "#" + r.pass, r]));
  const famsB = fams.includes("capy") ? (["capy"] as Family[]) : fams;
  const famsA = fams.includes("capy") && a === "none" ? (["ship"] as Family[]) : famsB;
  const B = pick(b, famsB), A = pick(a, famsA);
  const passes = fams.includes("capy") ? (rd.plan.capyPasses ?? 2) : (rd.plan.passes[model] ?? 2);
  const planned = ids.size * passes;
  const matched = [...B.keys()].filter((k) => A.has(k) && judged(B.get(k)!) && judged(A.get(k)!));
  const coverage = planned ? matched.length / planned : 0;
  const ra = matched.map((k) => A.get(k)!), rb = matched.map((k) => B.get(k)!);
  const ca = clusterMean(ra, tasks, f), cb = clusterMean(rb, tasks, f);
  const pairs = [...ca.keys()].map((c) => ({ id: c, cluster: c, a: ca.get(c)!, b: cb.get(c)! }));
  const s = pairs.length ? clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS }) : null;
  const exposure = (arm: Arm, rs: Reading[]) => (!gstackArm(arm) ? null : rs.length ? rs.filter((r) => r.exposed).length / rs.length : 0);
  const nTasks = new Set(ra.map((r) => r.task)).size;
  return { s, coverage, expB: exposure(b, rb), expA: exposure(a, ra), clusters: pairs.length, tasks: nTasks, passes, mA: mean([...ca.values()]), mB: mean([...cb.values()]) };
}
const famOf = (t: Task): Family => (t.source === "A" ? "investigate" : "ship");

function compare(rd: Readings) {
  if (rd.stage === "hr") fail("E_USAGE compare reads dev or held readings");
  const tasks = validate(rd, (r) => (r.family === "capy" ? rd.plan.capyPasses ?? 2 : rd.plan.passes[r.model] ?? 2));
  const ag = agreement(rd.readings);
  say(rd.stage + " read: agreement " + ag.line);
  const judgeFail = !(ag.psa >= AGREE_MIN);
  if (judgeFail && rd.stage === "dev") { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: positive agreement " + f3(ag.psa) + " under " + AGREE_MIN + " at the dev read; the confirmatory run stops)"); return; }
  const ctl = rd.stage === "held" ? controlsCheck(rd.controls ?? []) : { ok: true, lines: [] as string[] };
  ctl.lines.forEach((l) => say(l));
  const harness = rd.readings.filter((r) => r.status === "harness").length;
  if (harness) say("harness failures: " + harness + " (their items stopped; the readings they lost count against coverage)");
  const families: [string, Model[], Family[]][] = [["skill layer", rd.plan.models, ["investigate", "ship"]], ["capy", ["opus"], ["capy"]]];
  for (const [name, models, fams] of families) {
    for (const m of models) {
      if (name === "capy" && !rd.readings.some((r) => r.family === "capy")) continue;
      const arms: [Arm, Arm][] = [["principle", "none"], ["principle", "current"], ["current", "none"]];
      const cs = arms.map(([b, a]) => ({ b, a, ...contrast(rd, tasks, m, fams, b, a, recall) }));
      const present = cs.filter((c) => c.s);
      if (!present.length) { say(name + " " + m + ": no contrasts"); continue; }
      const low = (x: number | null) => x !== null && x < EXPOSURE_MIN;
      const untested = (c: typeof cs[number]) => (low(c.expB) || low(c.expA) ? "exposure " + c.b + " " + f3(c.expB) + ", " + c.a + " " + f3(c.expA) : c.coverage < COVERAGE_MIN ? "coverage " + f3(c.coverage) : rd.stage === "held" && !ctl.ok ? "controls" : rd.stage === "held" && judgeFail ? "judge agreement " + f3(ag.psa) : null);
      const ps = cs.map((c) => (!c.s || untested(c) ? 1 : c.s.p_two_sided));
      const adj = holmAdjusted(ps);
      const noneRate = cs[0]!.mA;
      cs.forEach((c, i) => {
        if (!c.s) { say(name + " " + m + " " + c.b + " - " + c.a + ": no pairs"); return; }
        const u = untested(c);
        const mdd = mddFor(c.tasks, c.passes);
        const unsup = contrast(rd, tasks, m, fams, c.b, c.a, (r) => r.unsupported);
        const caveats = contrast(rd, tasks, m, fams, c.b, c.a, (r) => r.unsupported, true);
        const above = (x: typeof unsup) => !!(x.s?.ci95 && x.s.ci95[0] > 0);
        const flags: string[] = [];
        if (above(unsup) || above(caveats)) flags.push("more unsupported claims");
        if (noneRate > BAND.hi && c.a === "none") flags.push("CEILING");
        const v = rd.stage === "dev" ? "descriptive (dev)" : u ? "untested (" + u + ")" : adj[i]! <= 0.05 ? (c.s.delta > 0 ? "helps" : "hurts") : "not distinguished";
        say(name + " " + m + " " + c.b + " - " + c.a + ": " + (c.s.delta >= 0 ? "+" : "") + f3(c.s.delta) + ", 95% CI " + (c.s.ci95 ? "[" + f3(c.s.ci95[0]) + ", " + f3(c.s.ci95[1]) + "]" : "n/a") + ", Holm p " + f3(adj[i]) + ", " + c.clusters + " clusters (" + c.tasks + " tasks), coverage " + f3(c.coverage) + ", exposure " + c.b + " " + f3(c.expB) + ", " + c.a + " " + f3(c.expA) + ", MDD " + (mdd === null ? "n/a" : mdd.toFixed(1) + " points") + ", unsupported " + (unsup.s ? (unsup.s.delta >= 0 ? "+" : "") + f3(unsup.s.delta) : "n/a") + ", clean-task caveats " + (caveats.s ? (caveats.s.delta >= 0 ? "+" : "") + f3(caveats.s.delta) : "n/a") + "; verdict " + v + (flags.length ? "; flags: " + flags.join(", ") : ""));
      });
      if (name === "skill layer") for (const fam of ["investigate", "ship"] as Family[]) { const c = contrast(rd, tasks, m, [fam], "principle", "none", recall); if (c.s) say("  per family " + fam + " " + m + " principle - none: " + f3(c.s.delta) + " (" + c.clusters + " clusters)"); }
    }
  }
  // Clean tasks: invented caveats.
  const clean = new Set(rd.tasks.filter((t) => t.stratum === "clean").map((t) => t.id));
  for (const m of rd.plan.models) for (const arm of ["none", "current", "principle"] as Arm[]) { const rs = rd.readings.filter((r) => r.model === m && r.arm === arm && clean.has(r.task) && judged(r) && r.family !== "capy"); if (rs.length) say("clean " + arm + ":" + m + ": invented caveats per reading " + f3(mean(rs.map((r) => r.unsupported))) + ", words " + f3(mean(rs.map((r) => r.words)))); }
  // Secondaries.
  for (const m of rd.plan.models) for (const arm of ["none", "current", "principle", "lens"] as Arm[]) {
    const rs = rd.readings.filter((r) => r.model === m && r.arm === arm && judged(r) && !clean.has(r.task) && r.family !== "capy");
    if (!rs.length) continue;
    const longs = rs.filter((r) => r.list);
    const lh = (k: keyof NonNullable<Reading["list"]>) => f3(longs.length ? longs.filter((r) => r.list![k]).length / longs.length : NaN);
    say("secondary " + arm + ":" + m + ": recall " + f3(mean(rs.map(recall))) + ", full-reply " + f3(mean(rs.map(recallAny))) + ", over " + CUT + " words " + rs.filter((r) => r.words > CUT).length + "/" + rs.length + ", list handling named " + lh("named") + " order " + lh("order") + " rest " + lh("rest") + " offer " + lh("offer") + ", short-list share " + f3(mean(rs.filter((r) => r.shortShare !== undefined).map((r) => r.shortShare!))) + ", D1 completeness " + f3(mean(rs.filter((r) => typeof r.d1 === "number").map((r) => r.d1!))));
  }
  if (rd.stage === "held" && rd.plan.devGap) {
    const c = contrast(rd, tasks, "opus", ["investigate", "ship"], "principle", "none", recall);
    const gap = rd.plan.devGap.opusPrincipleMinusNone - (c.s?.delta ?? 0);
    say("dev-to-held-out gap, Opus principle - none: " + f3(gap) + (gap * 100 > rd.plan.devGap.devMdd ? " (flag: likely overfitting)" : ""));
  }
}

/** Text is compared as word tokens: lowercased runs of letters, digits and underscores, so punctuation and markdown never hide a match. */
const toks = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
const named = (name: string) => (/[\p{L}\p{N}]/u.test(name) ? name.toLowerCase() : fail("E_USAGE the name " + JSON.stringify(name) + " has no letter or digit"));
/** Whether a text holds a name as a whole run of tokens under one tokenizer. */
function runs(tok: (t: string) => string[], text: string) {
  const ws = tok(text), at = new Map<string, number[]>();
  ws.forEach((w, i) => { const xs = at.get(w); if (xs) xs.push(i); else at.set(w, [i]); });
  return (name: string) => { const run = tok(named(name)); return (at.get(run[0]!) ?? []).some((i) => run.every((w, j) => ws[i + j] === w)); };
}
/** Whether dev text holds a name whole: the exact lowercased name, with whitespace, a quote, an opening bracket or the start of the text before it, and whitespace, a quote, a closing bracket or the end of the text after it, a trailing ".", ",", ";" or ":" allowed between. Any other joining character makes the name held-out only (test-held in test-held-only, test_x[a] in test_x[a,b], Bar#testX in Bar#testX(int)). A name with a space inside never counts as shared. */
const shares = (text: string) => {
  const t = text.toLowerCase();
  return (name: string) => {
    const n = named(name).trim();
    return !/\s/.test(n) && new RegExp("(?:^|[\\s\"'`([{])" + n.replace(/[\\^$.*+?()[\]{}|\/]/g, "\\$&") + "[.,;:]*(?=$|[\\s\"'`)\\]}])").test(t);
  };
};
/** Whether an artifact or a diff holds a name: anywhere as a lowercased substring, inside a longer name included, or as a run of its word tokens whatever the separators and surrounding whitespace. This side fails closed. */
const holds = (text: string) => { const t = text.toLowerCase(), has = runs(toks, text); return (name: string) => t.includes(named(name)) || has(name); };
function grams(text: string, n = 8) { const w = toks(text); const s = new Set<string>(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" ")); return s; }

function handoff(h: { artifact: string; heldIds: string[]; devText: string; heldText: string }) {
  const inDev = shares(h.devText), inArtifact = holds(h.artifact);
  const unique = h.heldIds.filter((id) => !inDev(id));
  const idHits = unique.filter(inArtifact);
  const hg = grams(h.heldText), dg = grams(h.devText);
  const gHits = [...grams(h.artifact)].filter((g) => hg.has(g) && !dg.has(g));
  say("handoff: " + h.heldIds.length + " held-out identifiers, " + unique.length + " unique to held-out; hits " + idHits.length + " identifiers, " + gHits.length + " 8-word runs");
  say("Verdict: " + (idHits.length || gHits.length ? "BLOCK" : "CLEAR"));
}

function leak(l: { addedLines: string[]; gstackAtC: string; material: string; names: string[] }) {
  const added = l.addedLines.join("\n");
  const base = grams(l.gstackAtC), mat = grams(l.material);
  const hits = [...grams(added)].filter((g) => !base.has(g) && mat.has(g));
  const nameHits = l.names.filter(holds(added));
  say("leak: " + hits.length + " 8-word runs shared with task material (after removing runs already in gstack at C), " + nameHits.length + " task names");
  say("Verdict: " + (hits.length || nameHits.length ? "HIT (to the Captain)" : "CLEAN"));
}

if (import.meta.main) {
  const [cmd, file] = process.argv.slice(2);
  const data = JSON.parse(readFileSync(file ?? "", "utf8"));
  if (cmd === "words") for (const t of data.texts as string[]) { const b = boundary(t, CUT); say("words " + words(t) + ", cuts " + CUTS.map((n) => boundary(t, n)).join("/") + ", over " + CUT + " " + (words(t) > CUT) + ", before boundary " + words(t.slice(0, b))); }
  else if (cmd === "endstate") for (const a of data.cases as Attempt[][]) { const e = endState(a); say("endstate " + e.cls + ", sends " + e.sends + (e.why ? ", " + e.why : "") + (e.drill && Object.keys(e.drill).length ? ", drill " + JSON.stringify(e.drill) : "")); }
  else if (cmd === "admit") say("admit " + roundAdmits(data));
  else if (cmd === "headroom") headroom(data);
  else if (cmd === "projection") projection(data);
  else if (cmd === "allin") allin(data);
  else if (cmd === "caps") caps(data);
  else if (cmd === "compare") compare(data);
  else if (cmd === "handoff") handoff(data);
  else if (cmd === "leak") leak(data);
  else fail("E_USAGE tbv-rule.ts words|endstate|admit|headroom|projection|allin|caps|compare|handoff|leak <file>");
  console.log(out.join("\n"));
}

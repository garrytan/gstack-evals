#!/usr/bin/env bun
// Copyright (c) 2026 Garry Tan. MIT License.
// tbv-rule.ts: the frozen rules of the trust-but-verify eval (GEVA-313, preregistration 2026-11-05-geva-313-trust-but-verify-prereg),
// with the build fixes (#233's Step 11 items 1 to 8 and 16, the underscore gap, fix-check 3's markdown, XML and flag forms) and
// amendment 1's rule items (2026-11-05-geva-326-tbv-prereg-amendment-1: items 11 to 15 and 17).
// It reads files and prints; it calls no model and needs no key.
//   bun tbv-rule.ts words <texts.json>          the word rule, the 150, 250 and 400 cuts and the share over 250
//   bun tbv-rule.ts endstate <attempts.json>    one reading's outcome class from its attempts, in the frozen precedence
//   bun tbv-rule.ts admit <round.json>          round admission against an item's cap
//   bun tbv-rule.ts headroom <readings.json> --split <manifest.json>    stage 1: NO READ, JUDGE FAIL, agreement, the band, costs
//   bun tbv-rule.ts projection <proj.json>      stage 1 to later stages: caps from measured costs
//   bun tbv-rule.ts allin <allin.json>          the all-in check before every paid item; for tbv-held: third Opus pass, capy drop or stop
//   bun tbv-rule.ts caps <caps.json>            the money table: each item's cap from capOf, and the sums at caps
//   bun tbv-rule.ts compare <readings.json> --split <manifest.json>     dev or held-out: families, verdicts, flags and secondaries
//   bun tbv-rule.ts handoff <handoff.json>      the dev handoff check against held-out material
//   bun tbv-rule.ts leak <leak.json>            the treatment-diff leak check
// Ported from the frozen bundle's tbv-rule.ts.txt; paired.ts is imported from this checkout.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { clusteredPairedDelta, holmAdjusted } from "../../src/runner/stats/paired.ts";
import { JUDGE_OF, otherJudge, type Arm, type AttemptKind, type ControlRow, type Family, type Io, type Judge, type Model, type PacketKind, type ReadingRow, type ReadingsFile, type SplitManifest, type TaskRow } from "./types.ts";

export const SEED = 20261105, DRAWS = 10_000;
export const CUT = 250, CUTS = [150, 250, 400];
export const BAND = { lo: 0.15, hi: 0.75 };
export const STOCK_MAX = 0.1, ORACLE_MIN = 0.85, AGREE_MIN = 0.7, EXPOSURE_MIN = 0.8, COVERAGE_MIN = 0.9;
export const HR_MIN_TASKS = 16, HR_MAX_MISSING = 0.1;
export const CAP_FACTOR = 1.15, ROUND = 4, MAX_TOKENS = 4000, RETRIES = 2;
// A reading's worst case: four sends (report, follow-up, D1, D2); the first carries at most WORST_INPUT tokens, and each later one adds max_tokens and a user turn per earlier send.
export const SENDS = 4, WORST_INPUT = 130_000, USER_TURN = 100;
export const LINE_USD = 2000;
/** Amendment item 11: crew spend from each thread's counter at about $1 per 1,000 credits, against the $300 crew reserve. */
export const CREDIT_USD = 0.001, CREW_RESERVE = 300;
/** Section 7: a seeded 20% of readings in each stage are also read by the other judge. */
export const DOUBLE_SHARE = 0.2;
/** Stage 3's controls run on 20 held-out tasks. */
export const HELD_CONTROLS = 20;
// MDD rows (recall points at 80% power, Holm's first step, control 0.50) from power.txt, by non-clean tasks and passes.
export const MDD: Record<number, [number, number][]> = { 2: [[40, 13.1], [50, 11.6], [70, 10.0], [100, 8.1]], 3: [[40, 11.0], [50, 9.8], [70, 8.2], [100, 6.8]] };

type Reading = ReadingRow;
type Task = TaskRow;
type Control = ControlRow;
type Readings = ReadingsFile;

const out: string[] = [];
const say = (t: string) => out.push(t);
const f3 = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(3));
const usd = (x: number) => "$" + x.toFixed(2);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);
/** A refusal: the message starts with its reason code (E_USAGE). run() prints it and exits 2. */
export class RuleError extends Error {}
const fail = (msg: string): never => { throw new RuleError(msg); };

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
// Amendment 1: max-tokens is a reply whose stream completed with the provider's final message and whose stop reason is
// max_tokens, holding text (a max_tokens reply with no text is sent as empty); it is read as returned, never retried (item
// 17). size is a validator refusal for size alone: the task drops from every arm and model in the item (item 12). outage is
// the driver's outage stop after six pauses on one route (item 13). truncated and broken-stream mean a stream that ended
// without the provider's final message.
export type Attempt = { kind: AttemptKind; turn: "report" | "followup" | "d1" | "d2" };
export function endState(attempts: Attempt[]) {
  let sends = 0, retries = 0, followup = false;
  const drill: Record<string, string> = {};
  let report: string | null = null;
  for (const a of attempts) {
    if (a.kind !== "validator" && a.kind !== "closer" && a.kind !== "size" && a.kind !== "outage") sends++;
    if (a.kind === "validator" || a.kind === "closer") return { cls: "harness", sends, why: a.kind === "closer" ? "closer byte check failed" : "request failed the validator" };
    if (a.kind === "size") return { cls: "size-drop", sends, why: "the validator refused the request for size alone: the task drops from every arm and model in the item" };
    if (a.kind === "outage") return { cls: "outage", sends, why: "outage stop: six pauses on one route with no success; the item stops, incomplete" };
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
      if (a.kind === "text" || a.kind === "max-tokens") { report = "scored"; continue; }
      if (!followup && a.turn === "report") { followup = true; continue; }
      report = "no-report";
    } else drill[a.turn] = a.kind === "text" || a.kind === "max-tokens" ? "ok" : "drill-down gap";
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
/** A reading whose report turn returned text or a refusal: exposure reads its report text, whether or not a judge labelled it. */
const reported = (r: Reading) => judged(r) || r.status === "unjudged";
const famOf = (t: Task): Family => t.family ?? (t.source === "A" ? "investigate" : "ship");
const SKILL: Family[] = ["investigate", "ship", "review"];
const gstackArm = (arm: Arm) => arm === "current" || arm === "principle";
/** The seeded double-read draw (section 7): FNV-1a on the seed and the reading's random label. The judge run picks with it and the rule checks with it. */
export function doubleRead(label: string): boolean {
  let h = 0x811c9dc5;
  for (const c of "tbv-double|" + SEED + "|" + label) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h % 100000) / 100000 < DOUBLE_SHARE;
}
/** Item 4: the planned task set comes from the split manifest, never from the readings file's own list. */
function checkPlan(rd: Readings, split: { text: string; manifest: SplitManifest }) {
  const p = rd.plan as Partial<Readings["plan"]>;
  if (!Array.isArray(p.taskIds) || !Array.isArray(p.controlTaskIds) || !/^[0-9a-f]{64}$/.test(p.manifestSha256 ?? "")) fail("E_USAGE the readings file's plan must carry taskIds, controlTaskIds and manifestSha256 from the split manifest");
  const ids = new Set(rd.tasks.map((t) => t.id));
  if (ids.size !== rd.tasks.length) fail("E_USAGE the readings file lists a task twice");
  for (const id of p.taskIds!) if (!ids.has(id)) fail("E_USAGE task " + id + " is planned but the readings file does not hold it");
  const planned = new Set(p.taskIds);
  for (const id of ids) if (!planned.has(id)) fail("E_USAGE task " + id + " is in the readings file but not in the plan's taskIds");
  const sha = createHash("sha256").update(split.text).digest("hex");
  if (sha !== p.manifestSha256) fail("E_USAGE the split manifest's sha256 " + sha + " is not the plan's " + p.manifestSha256);
  if (split.manifest.stage !== rd.stage) fail("E_USAGE the split manifest is stage " + split.manifest.stage + ", the readings file stage " + rd.stage);
  const rows = new Map(split.manifest.tasks.map((t) => [t.id, JSON.stringify(t)]));
  if (rows.size !== rd.tasks.length || rd.tasks.some((t) => rows.get(t.id) !== JSON.stringify(t))) fail("E_USAGE the readings file's tasks are not the split manifest's tasks, row for row");
  if (JSON.stringify([...split.manifest.controlTaskIds].sort()) !== JSON.stringify([...p.controlTaskIds!].sort())) fail("E_USAGE the plan's controlTaskIds are not the split manifest's");
}
/** The input guards every reading command runs: a known task, no duplicate, a pass inside the plan, labels that match the key on a scored reading, a finite unsupported count of at least 0, the frozen no-report shape (no fact labels, unsupported 0), a family that matches its task, the frozen judge for its model, a second read only where the seeded draw picked it and only by the other judge with a full label count, response ids no other reading holds, and controls on known tasks with full label counts. */
function validate(rd: Readings, passesOf: (r: Reading) => number | undefined) {
  const tasks = new Map(rd.tasks.map((t) => [t.id, t]));
  const keys = new Set<string>();
  const responses = new Set<string>();
  for (const r of rd.readings) {
    const t = tasks.get(r.task) ?? fail("E_USAGE reading " + r.id + " names a task the readings do not hold");
    if (r.family === "capy") {
      if (t.source !== "B") fail("E_USAGE reading " + r.id + " is a capy reading on source " + t.source + " task " + r.task + "; capy reads source B tasks only");
      if (r.model !== "opus" || !gstackArm(r.arm)) fail("E_USAGE reading " + r.id + " is capy " + r.arm + " on " + r.model + "; capy readings are Opus current or principle, and capy none is the ship reading");
    } else if (r.family !== famOf(t)) fail("E_USAGE reading " + r.id + " has family " + r.family + ", but its task " + r.task + " is family " + famOf(t));
    if (r.judge !== JUDGE_OF[r.model]) fail("E_USAGE reading " + r.id + " is judged by " + r.judge + ", but " + r.model + " arms are judged by " + JUDGE_OF[r.model]);
    if (reported(r)) {
      if (!Array.isArray(r.responseIds) || !r.responseIds.length) fail("E_USAGE reading " + r.id + " carries no response ids, so a copy could not be told from a reading");
      for (const id of r.responseIds) { if (responses.has(id)) fail("E_USAGE reading " + r.id + " shares response id " + id + " with another reading: a copied reading"); responses.add(id); }
    }
    if (r.second) {
      if (!(r.status === "scored" || r.status === "unjudged") || !doubleRead(r.id)) fail("E_USAGE reading " + r.id + " carries a second read the seeded double-read draw did not pick");
      if (r.second.judge !== otherJudge(r.judge)) fail("E_USAGE reading " + r.id + "'s second read is by " + r.second.judge + ", not the other judge (" + otherJudge(r.judge) + ")");
      if (r.second.status === "judged" && r.second.facts.length !== t.nfacts) fail("E_USAGE reading " + r.id + "'s second read has " + r.second.facts.length + " fact labels for a task with " + t.nfacts);
    }
    const k = [r.task, r.family, r.arm, r.model, r.pass].join("|");
    if (keys.has(k)) fail("E_USAGE duplicated reading " + k);
    keys.add(k);
    const n = passesOf(r);
    if (n !== undefined && !(Number.isInteger(r.pass) && r.pass >= 1 && r.pass <= n)) fail("E_USAGE reading " + r.id + " has pass " + r.pass + ", outside 1 to " + n);
    if (r.status === "no-report" && (r.facts.length !== 0 || r.unsupported !== 0)) fail("E_USAGE no-report reading " + r.id + " must carry no fact labels and unsupported 0");
    if (r.status === "scored" && r.facts.length !== t.nfacts) fail("E_USAGE reading " + r.id + " has " + r.facts.length + " fact labels for a task with " + t.nfacts);
    if (r.status === "scored" && !(Number.isFinite(r.unsupported) && r.unsupported >= 0)) fail("E_USAGE reading " + r.id + " has no unsupported count of at least 0");
  }
  const seen = new Set<string>();
  for (const c of rd.controls ?? []) {
    const t = tasks.get(c.task) ?? fail("E_USAGE a control names task " + c.task + ", which the readings do not hold");
    if (c.judge !== "sol" && c.judge !== "opus") fail("E_USAGE a control on " + c.task + " has judge " + c.judge + "; controls are judged by sol and opus");
    const k = c.task + "|" + c.kind + "|" + c.judge;
    if (seen.has(k)) fail("E_USAGE duplicated control " + k);
    seen.add(k);
    if (c.status === "judged" && c.facts.length !== t.nfacts) fail("E_USAGE the " + c.kind + " control on " + c.task + " by " + c.judge + " has " + c.facts.length + " fact labels for a task with " + t.nfacts);
  }
  return tasks;
}
const recall = (r: Reading) => (r.status === "no-report" || !r.facts.length ? 0 : r.facts.filter((f) => f.in).length / r.facts.length);
const recallAny = (r: Reading) => (r.status === "no-report" || !r.facts.length ? 0 : r.facts.filter((f) => f.any).length / r.facts.length);

/** Positive agreement over the seeded double-read sample: every scored reading the draw picks on a task with facts (a clean task has no fact to agree on). */
function agreement(rs: Reading[], tasks: Map<string, Task>) {
  let both = 0, aOnly = 0, bOnly = 0, neither = 0;
  const sampled = rs.filter((r) => r.status === "scored" && doubleRead(r.id) && tasks.get(r.task)!.nfacts > 0);
  const missing = sampled.filter((r) => !r.second).length;
  const unjudgedSeconds = sampled.filter((r) => r.second?.status === "unjudged").length;
  for (const r of sampled) if (r.second?.status === "judged") r.facts.forEach((f, i) => { const g = r.second!.facts[i]!.in; if (f.in && g) both++; else if (f.in) aOnly++; else if (g) bOnly++; else neither++; });
  const n = both + aOnly + bOnly + neither;
  const psa = 2 * both + aOnly + bOnly ? (2 * both) / (2 * both + aOnly + bOnly) : NaN;
  const raw = n ? (both + neither) / n : NaN;
  const pa = n ? ((both + aOnly) / n) * ((both + bOnly) / n) + ((neither + bOnly) / n) * ((neither + aOnly) / n) : NaN;
  const kappa = n && pa < 1 ? (raw - pa) / (1 - pa) : NaN;
  return { n, psa, raw, kappa, missing, line: "double-read sample " + sampled.length + " readings (second read never attempted " + missing + ", unjudged " + unjudgedSeconds + "); double-read facts " + n + "; both " + both + ", first only " + aOnly + ", second only " + bOnly + ", neither " + neither + "; positive agreement " + f3(psa) + ", raw " + f3(raw) + ", kappa " + f3(kappa) };
}

/** The controls gate: every planned control task, each kind and each judge, must have been attempted; one that was attempted and ended unjudged leaves the rate and prints as a count (section 7's judge-failure rule). */
function controlsCheck(cs: Control[], planned: string[]) {
  const rate = (kind: string, judge: string) => mean(cs.filter((c) => c.kind === kind && c.judge === judge && c.status === "judged").map((c) => (c.facts.length ? c.facts.filter((f) => f.in).length / c.facts.length : 0)));
  const lines: string[] = [];
  let ok = true;
  const absent = planned.flatMap((t) => (["stock", "oracle"] as const).flatMap((kind) => (["sol", "opus"] as const).filter((j) => !cs.some((c) => c.task === t && c.kind === kind && c.judge === j)).map((j) => kind + ":" + j + ":" + t)));
  lines.push("controls planned on " + planned.length + " tasks; never attempted " + absent.length + ", unjudged " + cs.filter((c) => c.status === "unjudged").length);
  if (absent.length || !planned.length) ok = false;
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

/** Amendment items 12 and 17: size drops and max_tokens replies print per arm, model and turn beside coverage. */
function stopCounts(rd: Readings) {
  const drops = new Set(rd.readings.filter((r) => r.status === "size-drop").map((r) => r.task));
  const mt = new Map<string, number>();
  for (const r of rd.readings) for (const t of r.maxTokens ?? []) mt.set(r.arm + ":" + r.model + ":" + t, (mt.get(r.arm + ":" + r.model + ":" + t) ?? 0) + 1);
  say("size drops: " + drops.size + " tasks; outage stops: " + rd.readings.filter((r) => r.status === "outage").length + " readings; max_tokens replies: " + (mt.size ? [...mt].sort().map(([k, v]) => k + " " + v).join(", ") : "none"));
}

function headroom(rd: Readings, split: { text: string; manifest: SplitManifest }) {
  if (rd.stage !== "hr") fail("E_USAGE headroom reads stage hr readings");
  checkPlan(rd, split);
  const passes = rd.plan.passes.opus ?? 3;
  const tasks = validate(rd, (r) => (r.arm === "none" && r.model === "opus" ? passes : undefined));
  const hr = rd.tasks.filter((t) => t.stratum !== "clean");
  const hrIds = new Set(hr.map((t) => t.id));
  if (JSON.stringify([...rd.plan.controlTaskIds].sort()) !== JSON.stringify([...hrIds].sort())) fail("E_USAGE stage 1's controlTaskIds must be every non-clean headroom task");
  const none = rd.readings.filter((r) => r.arm === "none" && r.model === "opus" && hrIds.has(r.task));
  const slots = new Set<string>();
  for (const r of none) { const k = r.task + "#" + r.pass; if (slots.has(k)) fail("E_USAGE duplicated reading " + k + ": one Opus none reading per task and pass, whatever its family"); slots.add(k); }
  const planned = hr.length * passes;
  const missing = none.filter((r) => !judged(r)).length + Math.max(0, planned - none.length);
  const readable = new Set(none.filter(judged).map((r) => r.task));
  say("Stage 1 headroom: " + hr.length + " tasks, Opus none planned " + planned + ", judged " + none.filter(judged).length + ", missing or unjudged " + missing);
  const ag = agreement(rd.readings, tasks);
  say("Agreement: " + ag.line);
  const ctl = controlsCheck(rd.controls ?? [], rd.plan.controlTaskIds);
  ctl.lines.forEach((l) => say(l));
  stopCounts(rd);
  const costs = new Map<string, number[]>();
  for (const r of rd.readings) if (r.status !== "harness") costs.set(r.arm + ":" + r.model, [...(costs.get(r.arm + ":" + r.model) ?? []), r.usd]);
  for (const [k, v] of [...costs].sort()) say("cost " + k + ": " + v.length + " readings, mean " + usd(mean(v)) + ", cache-read share " + f3(mean(rd.readings.filter((r) => r.arm + ":" + r.model === k && r.cacheRead !== undefined).map((r) => r.cacheRead!))));
  for (const k of [...new Set(rd.readings.filter((r) => r.arm === "current" || r.arm === "principle").map((r) => r.arm + ":" + r.model))].sort()) { const rs = rd.readings.filter((r) => r.arm + ":" + r.model === k && reported(r)); say("exposure " + k + ": " + rs.filter((r) => r.exposed).length + "/" + rs.length); }
  if (rd.readings.some((r) => r.status === "harness")) { say("Verdict: HARNESS FAILURE (a request failed the validator, a closer check or a non-refusal 4xx; stage 1 stops for a B1 fix under a new post)"); return; }
  if (readable.size < HR_MIN_TASKS || missing > HR_MAX_MISSING * planned) { say("Verdict: NO READ (readable tasks " + readable.size + ", missing " + missing + " of " + planned + ")"); return; }
  if (!ctl.ok) { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: a control is out of bounds or incomplete)"); return; }
  if (ag.missing) { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: " + ag.missing + " sampled double reads were never attempted; the calibration is incomplete)"); return; }
  if (!(ag.psa >= AGREE_MIN)) { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: positive agreement " + f3(ag.psa) + " under " + AGREE_MIN + "; no brief revision is bought)"); return; }
  const cm = clusterMean(none.filter(judged), tasks, recall);
  const r0 = Math.round(mean([...cm.values()]) * 1e9) / 1e9;
  const pairs = [...cm].map(([c, v]) => ({ id: c, cluster: c, a: 0, b: v }));
  const s = pairs.length > 1 ? clusteredPairedDelta(pairs, { seed: SEED, draws: DRAWS }) : null;
  const full = [...readable].filter((t) => none.filter((r) => r.task === t && judged(r)).every((r) => recall(r) === 1)).length;
  say("R0 (Opus none first-level recall, cluster means): " + f3(r0) + ", 95% CI " + (s?.ci95 ? "[" + f3(s.ci95[0]) + ", " + f3(s.ci95[1]) + "]" : "n/a") + "; tasks fully disclosed in every reading " + full + "/" + readable.size + "; none reports over " + CUT + " words " + none.filter((r) => r.words > CUT).length + "/" + none.length);
  say("Verdict: " + (r0 > BAND.hi ? "CEILING" : r0 < BAND.lo ? "FLOOR" : "HEADROOM") + " (band " + BAND.lo + " to " + BAND.hi + ")");
}

/** Amendment item 14: each judge packet is priced at stage 1's measured mean cost for its judge model and packet kind (judge:kind keys, such as sol:first); a path stage 1 did not meter is priced at the costliest metered path of the same kind. An item lists its double-read packets under the other judge. */
function judgePrice(measured: Record<string, number>, judge: Judge, kind: PacketKind) {
  const m = measured[judge + ":" + kind];
  if (m !== undefined) return m;
  const same = Object.entries(measured).filter(([k]) => k.endsWith(":" + kind)).map(([, v]) => v);
  if (!same.length) fail("E_USAGE no measured judge cost for any " + kind + " packet (stage 1 must meter each packet kind)");
  return Math.max(...same);
}
function projection(p: { items: { item: string; readings: { model: Model; arm: Arm; n: number }[]; packets: { judge: Judge; kind: PacketKind; n: number }[] }[]; measured: Record<string, number>; judgeMeasured: Record<string, number>; prices: Record<Model, Price> }) {
  let total = 0;
  for (const it of p.items) {
    if (!Array.isArray(it.packets)) fail("E_USAGE " + it.item + " needs its planned judge packets by judge and kind");
    let proj = sum(it.packets.map((k) => k.n * judgePrice(p.judgeMeasured, k.judge, k.kind)));
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

/** Amendment item 11: the all-in check before the first lease of every paid item, with the crew's actual spend from the thread counters. */
export const PAID_ITEMS = ["tbv-author", "tbv-hr", "tbv-dev-base", "tbv-climb-1", "tbv-climb-2", "tbv-climb-3", "tbv-held", "tbv-held-p3"];
function allin(a: { item: string; crewCredits: number; crewRest: number; settled: number; reserved: number; unknown: number; itemCap: number; thirdPassCap?: number; capyCap?: number }) {
  if (!PAID_ITEMS.includes(a.item)) fail("E_USAGE the all-in check runs before a paid item (" + PAID_ITEMS.join(", ") + "), not " + JSON.stringify(a.item));
  for (const k of ["crewCredits", "crewRest", "settled", "reserved", "unknown", "itemCap"] as const) if (!(Number.isFinite(a[k]) && a[k] >= 0)) fail("E_USAGE the all-in check needs " + k + " as a number of at least 0");
  const crewSpent = a.crewCredits * CREDIT_USD;
  const base = crewSpent + a.crewRest + a.settled + a.reserved + a.unknown;
  say("all-in before " + a.item + ": crew spent " + usd(crewSpent) + " (" + a.crewCredits + " credits; " + usd(crewSpent) + " of the " + usd(CREW_RESERVE) + " crew reserve) + crew to come " + usd(a.crewRest) + " + settled " + usd(a.settled) + " + reserved " + usd(a.reserved) + " + unknown " + usd(a.unknown) + " = " + usd(base));
  if (a.item !== "tbv-held") { say("Verdict: " + (base + a.itemCap <= LINE_USD ? "START " + a.item + " (" + usd(base + a.itemCap) + ")" : "NO START (to the Captain; " + usd(base + a.itemCap) + " over " + usd(LINE_USD) + ")")); return; }
  if (!(Number.isFinite(a.thirdPassCap) && Number.isFinite(a.capyCap))) fail("E_USAGE the all-in check before tbv-held needs thirdPassCap and capyCap");
  const heldCap = a.itemCap, thirdPassCap = a.thirdPassCap!, capyCap = a.capyCap!;
  if (base + heldCap + thirdPassCap <= LINE_USD) { say("Verdict: STAGE 3 WITH THE THIRD OPUS PASS (" + usd(base + heldCap + thirdPassCap) + ")"); return; }
  if (base + heldCap <= LINE_USD) { say("Verdict: STAGE 3, TWO PASSES (" + usd(base + heldCap) + ")"); return; }
  if (base + heldCap - capyCap <= LINE_USD) { say("Verdict: STAGE 3 WITHOUT THE CAPY FAMILY (" + usd(base + heldCap - capyCap) + ")"); return; }
  say("Verdict: NO STAGE 3 (to the Captain; " + usd(base + heldCap - capyCap) + " over " + usd(LINE_USD) + ")");
}

/** The MDD row for the largest tabled task count at or under n, so a smaller read never borrows a larger read's MDD; null under the smallest row. */
function mddFor(n: number, passes: number) {
  const rows = MDD[passes] ?? MDD[2]!;
  return [...rows].reverse().find(([k]) => k <= n)?.[1] ?? null;
}

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
  const exposure = (arm: Arm, fam: Family[]) => {
    if (!gstackArm(arm)) return null;
    const rs = rd.readings.filter((r) => r.model === model && r.arm === arm && ids.has(r.task) && fam.includes(r.family) && reported(r));
    return rs.length ? rs.filter((r) => r.exposed).length / rs.length : 0;
  };
  const nTasks = new Set(ra.map((r) => r.task)).size;
  return { s, coverage, expB: exposure(b, famsB), expA: exposure(a, famsA), clusters: pairs.length, tasks: nTasks, passes, mA: mean([...ca.values()]), mB: mean([...cb.values()]) };
}
function compare(rd: Readings, split: { text: string; manifest: SplitManifest }) {
  if (rd.stage === "hr") fail("E_USAGE compare reads dev or held readings");
  checkPlan(rd, split);
  const tasks = validate(rd, (r) => (r.family === "capy" ? rd.plan.capyPasses ?? 2 : rd.plan.passes[r.model] ?? 2));
  if (rd.stage === "held" && rd.plan.controlTaskIds.length !== HELD_CONTROLS) fail("E_USAGE stage 3's plan names " + rd.plan.controlTaskIds.length + " control tasks; it runs controls on " + HELD_CONTROLS);
  const ag = agreement(rd.readings, tasks);
  say(rd.stage + " read: agreement " + ag.line);
  const judgeFail = ag.missing > 0 || !(ag.psa >= AGREE_MIN);
  const why = ag.missing ? ag.missing + " sampled double reads were never attempted" : "positive agreement " + f3(ag.psa) + " under " + AGREE_MIN;
  if (judgeFail && rd.stage === "dev") { say("Verdict: JUDGE FAIL (FIX-METHOD, judge: " + why + " at the dev read; the confirmatory run stops)"); return; }
  const ctl = rd.stage === "held" ? controlsCheck(rd.controls ?? [], rd.plan.controlTaskIds) : { ok: true, lines: [] as string[] };
  ctl.lines.forEach((l) => say(l));
  stopCounts(rd);
  const harness = rd.readings.filter((r) => r.status === "harness").length;
  if (harness) say("harness failures: " + harness + " (their items stopped; the readings they lost count against coverage)");
  const families: [string, Model[], Family[]][] = [["skill layer", rd.plan.models, SKILL], ["capy", ["opus"], ["capy"]]];
  for (const [name, models, fams] of families) {
    for (const m of models) {
      if (name === "capy" && !rd.readings.some((r) => r.family === "capy")) continue;
      const arms: [Arm, Arm][] = [["principle", "none"], ["principle", "current"], ["current", "none"]];
      const cs = arms.map(([b, a]) => ({ b, a, ...contrast(rd, tasks, m, fams, b, a, recall) }));
      const present = cs.filter((c) => c.s);
      if (!present.length) { say(name + " " + m + ": no contrasts"); continue; }
      const low = (x: number | null) => x !== null && x < EXPOSURE_MIN;
      const untested = (c: typeof cs[number]) => (low(c.expB) || low(c.expA) ? "exposure " + c.b + " " + f3(c.expB) + ", " + c.a + " " + f3(c.expA) : c.coverage < COVERAGE_MIN ? "coverage " + f3(c.coverage) : rd.stage === "held" && !ctl.ok ? "controls" : rd.stage === "held" && judgeFail ? (ag.missing ? "double read incomplete" : "judge agreement " + f3(ag.psa)) : null);
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
      if (name === "skill layer") for (const fam of SKILL.filter((f) => rd.tasks.some((t) => famOf(t) === f))) { const c = contrast(rd, tasks, m, [fam], "principle", "none", recall); if (c.s) say("  per family " + fam + " " + m + " principle - none: " + f3(c.s.delta) + " (" + c.clusters + " clusters)"); }
    }
  }
  // Clean tasks: invented caveats.
  const clean = new Set(rd.tasks.filter((t) => t.stratum === "clean").map((t) => t.id));
  for (const m of rd.plan.models) for (const arm of ["none", "current", "principle"] as Arm[]) { const rs = rd.readings.filter((r) => r.model === m && r.arm === arm && clean.has(r.task) && judged(r) && r.family !== "capy"); if (rs.length) say("clean " + arm + ":" + m + ": invented caveats per reading " + f3(mean(rs.map((r) => r.unsupported))) + ", words " + f3(mean(rs.map((r) => r.words)))); }
  // Secondaries.
  for (const m of rd.plan.models) for (const arm of ["none", "current", "principle", "lens"] as Arm[]) {
    const rs = rd.readings.filter((r) => r.model === m && r.arm === arm && judged(r) && !clean.has(r.task) && r.family !== "capy");
    if (!rs.length) continue;
    const longs = rs.filter((r) => r.list && tasks.get(r.task)!.stratum === "long");
    const lh = (k: keyof NonNullable<Reading["list"]>) => f3(longs.length ? longs.filter((r) => r.list![k]).length / longs.length : NaN);
    say("secondary " + arm + ":" + m + ": recall " + f3(mean(rs.map(recall))) + ", full-reply " + f3(mean(rs.map(recallAny))) + ", over " + CUT + " words " + rs.filter((r) => r.words > CUT).length + "/" + rs.length + ", list handling named " + lh("named") + " order " + lh("order") + " rest " + lh("rest") + " offer " + lh("offer") + ", short-list share " + f3(mean(rs.filter((r) => r.shortShare !== undefined).map((r) => r.shortShare!))) + ", D1 completeness " + f3(mean(rs.filter((r) => typeof r.d1 === "number").map((r) => r.d1!))));
  }
  if (rd.stage === "held" && rd.plan.devGap) {
    const c = contrast(rd, tasks, "opus", SKILL, "principle", "none", recall);
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
/** Whether dev text holds a name whole: the exact lowercased name, a trailing ".", ",", ";" or ":" allowed after it, between a boundary before it and one after it. These boundaries are a whitelist. Before: whitespace, a quote, an opening bracket or the start of the text (frozen), a table pipe, the ">" closing an XML tag, or a --flag= (letters, digits and dashes after a frozen boundary). After: whitespace, a quote, a closing bracket or the end of the text (frozen), a table pipe, or the "<" opening an XML tag. A markdown emphasis run of * on both sides is allowed inside those boundaries. Any other joining character makes the name held-out only (test-held in test-held-only, test_x[a] in test_x[a,b], Bar#testX in Bar#testX(int), name? and name!, path:line, name@version). A name with a space inside never counts as shared. */
const OPEN = "\\s\"'`([{", CLOSE = "\\s\"'`)\\]}";
const shares = (text: string) => {
  const t = text.toLowerCase();
  return (name: string) => {
    const n = named(name).trim(), e = n.replace(/[\\^$.*+?()[\]{}|\/]/g, "\\$&");
    const before = "(?:^|[" + OPEN + "|>]|(?:^|[" + OPEN + "])--[a-z0-9-]+=)", emphasis = "(?:^|[" + OPEN + "|>])\\*+";
    return !/\s/.test(n) && t.includes(n) && new RegExp("(?:" + before + e + "|" + emphasis + e + "\\*+)[.,;:]*(?=$|[" + CLOSE + "|<])").test(t);
  };
};
/** Letter-and-digit tokens: underscores split too, so held_repo_x, held-repo-x and held repo x read the same. */
const alnum = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
/** Whether an artifact or a diff holds a name: anywhere as a lowercased substring, inside a longer name included, or as a run of its word tokens or of its letter-and-digit tokens whatever the separators (underscores included) and surrounding whitespace. This side fails closed. */
const holds = (text: string) => { const t = text.toLowerCase(), has = runs(toks, text), hasAlnum = runs(alnum, text); return (name: string) => t.includes(named(name)) || has(name) || hasAlnum(name); };
/** Where an artifact holds a name, for the refusal line: the first substring or token match with 30 characters either side. */
function context(text: string, name: string) {
  const t = text.toLowerCase(), n = named(name).trim();
  let at = t.indexOf(n), len = n.length;
  if (at < 0) {
    const run = alnum(n);
    const m = new RegExp(run.map((w) => w.replace(/[\\^$.*+?()[\]{}|\/]/g, "\\$&")).join("[^\\p{L}\\p{N}]+"), "u").exec(t);
    at = m ? m.index : -1; len = m ? m[0].length : 0;
  }
  return at < 0 ? "" : JSON.stringify(text.slice(Math.max(0, at - 30), at + len + 30));
}
export function grams(text: string, n = 8) { const w = toks(text); const s = new Set<string>(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" ")); return s; }

export type HandoffInput = { artifact: string; heldIds: string[]; devText: string; heldText: string };
export type LeakInput = { addedLines: string[]; gstackAtC: string; material: string; names: string[] };

function handoff(h: HandoffInput) {
  const inDev = shares(h.devText), inArtifact = holds(h.artifact);
  const unique = h.heldIds.filter((id) => !inDev(id));
  const idHits = unique.filter(inArtifact);
  const hg = grams(h.heldText), dg = grams(h.devText);
  const gHits = [...grams(h.artifact)].filter((g) => hg.has(g) && !dg.has(g));
  say("handoff: " + h.heldIds.length + " held-out identifiers, " + unique.length + " unique to held-out; hits " + idHits.length + " identifiers, " + gHits.length + " 8-word runs");
  for (const id of idHits) say("  identifier " + JSON.stringify(id.trim()) + " at " + context(h.artifact, id));
  for (const g of gHits.slice(0, 5)) say("  8-word run " + JSON.stringify(g));
  say("Verdict: " + (idHits.length || gHits.length ? "BLOCK" : "CLEAR"));
}

function leak(l: LeakInput) {
  const added = l.addedLines.join("\n");
  const base = grams(l.gstackAtC), mat = grams(l.material);
  const hits = [...grams(added)].filter((g) => !base.has(g) && mat.has(g));
  const atC = shares(l.gstackAtC);
  const exempt = l.names.filter(atC);
  const nameHits = l.names.filter((n) => !atC(n)).filter(holds(added));
  say("leak: " + hits.length + " 8-word runs shared with task material (after removing runs already in gstack at C), " + nameHits.length + " task names (" + exempt.length + " exempt: gstack at C holds them whole)");
  for (const n of nameHits) say("  name " + JSON.stringify(n.trim()) + " at " + context(added, n));
  for (const g of hits.slice(0, 5)) say("  8-word run " + JSON.stringify(g));
  say("Verdict: " + (hits.length || nameHits.length ? "HIT (to the Captain)" : "CLEAN"));
}

/** The handoff or the leak check on inputs already in memory, printed and returned as run() does: check.ts gathers real inputs and passes them here, so held-out text never goes to a file. */
export function check(c: { cmd: "handoff"; data: HandoffInput } | { cmd: "leak"; data: LeakInput }, io: Io): number {
  out.length = 0;
  try {
    if (c.cmd === "handoff") handoff(c.data);
    else leak(c.data);
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    io.err(e.message);
    return 2;
  }
  io.out(out.join("\n"));
  return 0;
}

/** One scorer command. headroom and compare take --split <manifest.json>, the split manifest whose sha256 the readings file's plan records. A refusal prints its E_ line and returns 2. */
export function run(argv: string[], io: Io = { out: (t) => console.log(t), err: (t) => console.error(t) }): number {
  out.length = 0;
  try {
    const [cmd, file, ...rest] = argv;
    const flag = (name: string) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1] ?? fail("E_USAGE " + name + " needs a path"); };
    const read = (f: string | undefined) => { try { return readFileSync(f ?? "", "utf8"); } catch { return fail("E_USAGE cannot read " + JSON.stringify(f ?? "")); } };
    const parse = (text: string, f: string) => { try { return JSON.parse(text); } catch { return fail("E_USAGE " + f + " is not JSON"); } };
    const data = parse(read(file), file ?? "");
    const split = () => {
      const f = flag("--split") ?? fail("E_USAGE " + cmd + " needs --split <manifest.json>, the split manifest the readings file was written from");
      const text = read(f), manifest = parse(text, f) as SplitManifest;
      if (manifest.schema !== "tbv-split.v1" || !Array.isArray(manifest.tasks) || !Array.isArray(manifest.controlTaskIds)) fail("E_USAGE " + f + " is not a tbv-split.v1 manifest");
      return { text, manifest };
    };
    if (cmd === "words") for (const t of data.texts as string[]) { const b = boundary(t, CUT); say("words " + words(t) + ", cuts " + CUTS.map((n) => boundary(t, n)).join("/") + ", over " + CUT + " " + (words(t) > CUT) + ", before boundary " + words(t.slice(0, b))); }
    else if (cmd === "endstate") for (const a of data.cases as Attempt[][]) { const e = endState(a); say("endstate " + e.cls + ", sends " + e.sends + (e.why ? ", " + e.why : "") + (e.drill && Object.keys(e.drill).length ? ", drill " + JSON.stringify(e.drill) : "")); }
    else if (cmd === "admit") say("admit " + roundAdmits(data));
    else if (cmd === "headroom") headroom(data, split());
    else if (cmd === "projection") projection(data);
    else if (cmd === "allin") allin(data);
    else if (cmd === "caps") caps(data);
    else if (cmd === "compare") compare(data, split());
    else if (cmd === "handoff") handoff(data);
    else if (cmd === "leak") leak(data);
    else fail("E_USAGE tbv-rule.ts words|endstate|admit|headroom|projection|allin|caps|compare|handoff|leak <file>");
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    io.err(e.message);
    return 2;
  }
  io.out(out.join("\n"));
  return 0;
}

if (import.meta.main) process.exit(run(process.argv.slice(2)));

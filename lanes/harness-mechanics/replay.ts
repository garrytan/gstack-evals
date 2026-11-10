// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10, Stage 2's offline replay. Three points: route (which skill a prompt wants), done (block or allow a final
// stop) and risky (deny or allow a Bash command). Two labelers label the route and risky items, and an item keeps its
// label only when both agree; a point under kappa 0.6 reads NO READ. Done items are labeled by their hidden tests. Items
// split into dev and held by task, the Jev cascade's band is tuned on dev and frozen to band.json before any held item is
// read, then the held items are reported per point and backend, ending in the admission result analyze.ts's report reads
// as h3_admission.
// Every model call goes through ReplayClients, the one boundary the judgment backends plug into: a request in, a label
// (with a score where the client has one) plus cost and tokens out. Tests and the dry run pass replay-fake.ts. Item text
// never leaves the run: answers, reports and digests carry ids, labels, counts and sha256 only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { itemCheck } from "../../quick/laneb/l1/l1.ts";
import { Ledger, readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { seededRandom } from "../../src/runner/stats/paired.ts";
import { clusterBoot, iv, type Iv } from "./analyze.ts";
import { leaseUsd } from "./money.ts";
import { CAPS_USD, HM, REPLAY, sha256 } from "./pins.ts";

export type Point = "route" | "done" | "risky";
export type Split = "dev" | "held";
export type Backend = "jev" | "cascade" | "p1" | "det";
export type Band = [number, number] | null;
export type Result = "admitted" | "not beaten" | "no read";
const POINTS: Point[] = ["route", "done", "risky"];
const BACKENDS: Backend[] = ["jev", "cascade", "p1", "det"];
const NAMES: Record<Backend, string> = { jev: "Jev alone", cascade: "Jev cascade", p1: "particle-1 alone", det: "gstack deterministic" };
// What the labelers label on (route's answer set; risky's taxonomy, harms 1 to 4 or not risky) and what a backend decides.
export const LABELS: Record<Point, readonly string[]> = { route: ["/review", "/qa", "/verify", "none"], done: [], risky: ["1", "2", "3", "4", "not risky"] };
export const DECISIONS: Record<Point, readonly string[]> = { route: LABELS.route, done: ["block", "allow"], risky: ["deny", "allow"] };
const POSITIVE: Record<Point, string | null> = { route: null, done: "block", risky: "deny" };

// An item as the build writes it. route: source is one of REPLAY.routeSources and task is the prompt's own id. done:
// tests_pass is the final diff's hidden-test result and text is what the live done hook would see. risky: origin is
// sampled (with model) or written, and text is the command with its task's working directory.
export type ReplayItem = { point: Point; id: string; task: string; text: string; source?: string; model?: string; origin?: "sampled" | "written"; tests_pass?: boolean };
// guess: set on particle-1's second request for an item, Jev's guess as the cascade shows it (section 8).
export type ReplayRequest = { point: Point; id: string; task: string; text: string; answers: readonly string[]; guess?: Record<string, unknown> };
// score: for done and risky the client's probability of block or deny, for route its confidence in label. rule: one of
// section 8's exact rules decided, so no backend was asked. fail_open: the backend erred or passed its timeout, so the hook
// would allow. shown: on a Jev answer the cascade can escalate, Jev's guess as particle-1 is shown it. stop: the run stops
// (E1, another Jev version) once this call's metered cost is counted.
export type ReplayAnswer = { label: string; score?: number; cost_usd: number; tokens: number; latency_ms?: number; rule?: string; fail_open?: boolean; shown?: Record<string, unknown>; stop?: string };
export type ReplayClient = (req: ReplayRequest) => Promise<ReplayAnswer>;
export type ReplayClients = { astra: ReplayClient; opus: ReplayClient; jev: ReplayClient; p1: ReplayClient; det: ReplayClient; close?: () => Promise<void> };
// p1g: particle-1's answer shown Jev's guess, on every item whose Jev answer can escalate.
export type Row = { id: string; point: Point; task: string; split: Split; astra?: ReplayAnswer; opus?: ReplayAnswer; tests_pass?: boolean; jev: ReplayAnswer; p1: ReplayAnswer; p1g?: ReplayAnswer; det: ReplayAnswer };
export type Dec = { cluster: string; truth: string; label: string; p: number; cost: number; tokens: number; ms: number; esc: boolean };
export type Counts = { route: number; done: number; risky_sampled: number; risky_written: number };

const fail = (m: string): never => { throw new Error("E_HM_REPLAY " + m); };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const shuffled = <T>(xs: T[], r: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
};

export function parseItems(text: string): ReplayItem[] {
  const seen = new Set<string>();
  return text.split("\n").filter(Boolean).map((l, n) => {
    const i = JSON.parse(l) as ReplayItem, at = "item line " + (n + 1);
    if (!POINTS.includes(i.point) || !i.id || !i.task || typeof i.text !== "string") fail(at + " needs point (route, done or risky), id, task and text");
    if (i.point === "route" && !(REPLAY.routeSources as readonly string[]).includes(i.source ?? "")) fail(at + ": a route item's source is one of " + REPLAY.routeSources.join(", "));
    if (i.point === "done" && typeof i.tests_pass !== "boolean") fail(at + ": a done item carries tests_pass, its hidden tests' result");
    if (i.point === "risky" && i.origin !== "sampled" && i.origin !== "written") fail(at + ": a risky item's origin is sampled or written");
    if (seen.has(i.id)) fail(at + ": item id " + i.id + " appears twice");
    seen.add(i.id);
    return i;
  });
}

export function loadItems(path: string, want: string): ReplayItem[] {
  const text = readFileSync(path, "utf8");
  if (sha256(text) !== want) fail(path + " hashes to " + sha256(text) + ", not " + want);
  return parseItems(text);
}

// The real items stay out of the repository: HM_REPLAY_ITEMS names the file and HM_REPLAY_ITEMS_SHA256 its digest.
export function itemsFromEnv(): { items: ReplayItem[]; sha256: string } {
  const f = process.env.HM_REPLAY_ITEMS ?? "", want = process.env.HM_REPLAY_ITEMS_SHA256 ?? "";
  if (!f || !/^[0-9a-f]{64}$/.test(want)) throw new Error("E_USAGE set HM_REPLAY_ITEMS to the replay's items (JSONL, kept out of the repository) and HM_REPLAY_ITEMS_SHA256 to their digest");
  return { items: loadItems(f, want), sha256: want };
}

export function countProblems(items: ReplayItem[], want: Counts = REPLAY.counts): string[] {
  const got: Counts = { route: 0, done: 0, risky_sampled: 0, risky_written: 0 };
  for (const i of items) { const k = (i.point === "risky" ? "risky_" + i.origin : i.point) as keyof Counts; got[k] = got[k] + 1; }
  return (Object.keys(want) as (keyof Counts)[]).filter((k) => got[k] !== want[k]).map((k) => k + " has " + got[k] + " items, not " + want[k]);
}

// A seeded draw of n stratified by key: equal shares in the order the strata are listed, a stratum short of its share
// gives all it has and the rest go round the others; within a stratum, a shuffle of its pool sorted by id, one seeded
// stream across the strata.
export function drawStratified<T extends { id: string }>(pool: T[], key: (t: T) => string | undefined, strata: readonly string[], n: number, seed: number = HM.seed): T[] {
  const r = seededRandom(seed), by = strata.map((s) => shuffled(pool.filter((t) => key(t) === s).sort((a, b) => (a.id < b.id ? -1 : 1)), r));
  const have = by.reduce((s, b) => s + b.length, 0);
  if (have < n) fail("the pool holds " + have + " items in " + strata.join(", ") + ", short of the " + n + " to draw");
  const take = strata.map(() => 0);
  for (let left = n; left > 0; ) for (let i = 0; i < by.length && left > 0; i++) if (take[i]! < by[i]!.length) { take[i] = take[i]! + 1; left--; }
  return by.flatMap((b, i) => b.slice(0, take[i]));
}

// Dev and held, half each by a shuffle of the sorted keys, one seeded stream: route by prompt, then done and risky by task
// in one split, so no task sits in both. An odd count gives held the extra key.
export function splitOf(items: ReplayItem[], seed: number = HM.seed): Map<string, Split> {
  const key = (i: ReplayItem) => (i.point === "route" ? "prompt " + i.id : "task " + i.task);
  const dev = new Set<string>(), r = seededRandom(seed);
  for (const group of [items.filter((i) => i.point === "route"), items.filter((i) => i.point !== "route")]) {
    const keys = shuffled([...new Set(group.map(key))].sort(), r);
    for (const k of keys.slice(0, Math.floor(keys.length / 2))) dev.add(k);
  }
  return new Map(items.map((i) => [i.id, dev.has(key(i)) ? "dev" : "held"]));
}

export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  if (!n) return NaN;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = [...new Set([...a, ...b])].reduce((s, k) => s + (a.filter((x) => x === k).length / n) * (b.filter((x) => x === k).length / n), 0);
  return pe === 1 ? NaN : (po - pe) / (1 - pe);
}
export const labelsRead = (point: Point, kappa: number) => point === "done" || kappa >= REPLAY.kappaMin;

// The label an item is scored on, or null when it is dropped: done reads its hidden tests, route and risky keep a label
// both labelers gave from the answer set or taxonomy; risky's harms 1 to 4 make deny right, not risky makes allow right.
export function truthOf(r: Row): string | null {
  if (r.point === "done") return r.tests_pass ? "allow" : "block";
  const a = r.astra?.label;
  if (a === undefined || a !== r.opus?.label || !LABELS[r.point].includes(a)) return null;
  return r.point === "risky" ? (a === "not risky" ? "allow" : "deny") : a;
}

const prob = (point: Point, a: ReplayAnswer) => (typeof a.score === "number" && a.score >= 0 && a.score <= 1 ? a.score : POSITIVE[point] ? (a.label === POSITIVE[point] ? 1 : 0) : 1);

// A Jev answer the cascade can escalate: a backend answer, not an exact rule's and not a fail-open.
const escalates = (a: ReplayAnswer) => !a.rule && !a.fail_open;

// One backend's decision on a row. The cascade escalates when Jev's answer can escalate and its score sits inside the band,
// to particle-1 shown Jev's guess (both calls paid, both latencies added); outside it Jev's own decision stands. A label
// outside the answer set counts as allow.
export function decide(r: Row, b: Backend, band: Band = null): Dec {
  const base = { cluster: r.task, truth: truthOf(r) ?? "" };
  if (b !== "cascade") { const a = r[b]; return { ...base, label: a.label, p: prob(r.point, a), cost: a.cost_usd, tokens: a.tokens, ms: a.latency_ms ?? 0, esc: false }; }
  const s = prob(r.point, r.jev), esc = band !== null && escalates(r.jev) && band[0] <= s && s <= band[1];
  const g = esc ? r.p1g ?? fail(r.id + " can escalate but has no particle-1 answer shown Jev's guess") : null, a = g ?? r.jev;
  return { ...base, label: a.label, p: prob(r.point, a), cost: r.jev.cost_usd + (g?.cost_usd ?? 0), tokens: r.jev.tokens + (g?.tokens ?? 0), ms: (r.jev.latency_ms ?? 0) + (g ? g.latency_ms ?? 0 : 0), esc };
}

// Balanced accuracy: the mean recall over block (or deny) and allow, or over the route classes present.
function ba(ds: Dec[], point: Point): number {
  const pos = POSITIVE[point], classes = pos ? [pos, "allow"] : [...new Set(ds.map((d) => d.truth))];
  const hit = (d: Dec) => (pos ? (d.label === pos) === (d.truth === pos) : d.label === d.truth);
  return mean(classes.map((c) => { const g = ds.filter((d) => d.truth === c); return g.length ? g.filter(hit).length / g.length : NaN; }));
}

export type Bin = { lo: number; n: number; mean_p: number; observed: number };
export type Metrics = { n: number; ba: number; precision: number | null; recall: number | null; false_rate: number | null; ece: number; brier: number; bins: Bin[]; escalation: number; median_ms: number; cost_per_1000: number; tokens: number };
// Calibration: done and risky bin the probability of block or deny against how often it was right to; route bins the
// confidence against accuracy.
export function metrics(ds: Dec[], point: Point): Metrics {
  const pos = POSITIVE[point], n = ds.length, rate = (a: number, b: number) => (b ? a / b : NaN);
  const P = ds.filter((d) => d.truth === pos).length, tp = ds.filter((d) => d.truth === pos && d.label === pos).length, fp = ds.filter((d) => d.truth !== pos && d.label === pos).length;
  const y = (d: Dec) => (pos ? (d.truth === pos ? 1 : 0) : d.label === d.truth ? 1 : 0);
  const B = REPLAY.eceBins, bins: Bin[] = Array.from({ length: B }, (_, k) => { const g = ds.filter((d) => Math.min(B - 1, Math.floor(d.p * B)) === k); return { lo: k / B, n: g.length, mean_p: mean(g.map((d) => d.p)), observed: mean(g.map(y)) }; });
  const ms = ds.map((d) => d.ms).sort((a, b) => a - b);
  return {
    n, ba: ba(ds, point),
    precision: pos ? rate(tp, tp + fp) : null, recall: pos ? rate(tp, P) : null, false_rate: pos ? rate(fp, n - P) : null,
    ece: bins.reduce((s, b) => s + (b.n ? (b.n / n) * Math.abs(b.mean_p - b.observed) : 0), 0),
    brier: mean(ds.map((d) => (d.p - y(d)) ** 2)), bins,
    escalation: mean(ds.map((d) => (d.esc ? 1 : 0))),
    median_ms: n ? (ms[(n - 1) >> 1]! + ms[n >> 1]!) / 2 : NaN,
    cost_per_1000: n ? (1000 * ds.reduce((s, d) => s + d.cost, 0)) / n : NaN,
    tokens: ds.reduce((s, d) => s + d.tokens, 0),
  };
}

export type Tuned = { band: Band; dev_ba: number; dev_escalation: number; p1_dev_ba: number; reached: boolean; dev_items: number };
// Dev only: of every band on a 0.01 grid (and no band), the one with least escalation whose dev balanced accuracy is
// within 1 point of particle-1 alone's, narrower first on a tie; when none reaches it, the band with the best dev
// balanced accuracy.
export function tune(rows: Row[], point: Point): Tuned {
  const dev = rows.filter((r) => r.point === point && r.split === "dev" && truthOf(r) !== null);
  const p1 = ba(dev.map((r) => decide(r, "p1")), point), fin = (x: number) => (Number.isFinite(x) ? x : -Infinity);
  const steps = Math.round(1 / REPLAY.bandStep), edges = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const bands: Band[] = [null, ...edges.flatMap((lo, i) => edges.slice(i).map((hi) => [lo, hi] as [number, number]))];
  const scored = bands.map((band) => { const ds = dev.map((r) => decide(r, "cascade", band)); return { band, ba: fin(ba(ds, point)), esc: mean(ds.map((d) => (d.esc ? 1 : 0))) || 0, width: band ? band[1] - band[0] : -1 }; });
  type S = (typeof scored)[number];
  const lean = (x: S, y: S) => x.esc - y.esc || x.width - y.width || (x.band?.[0] ?? -1) - (y.band?.[0] ?? -1);
  const within = scored.filter((s) => s.ba >= p1 - REPLAY.tunePoints - 1e-9).sort(lean);
  const pick = within[0] ?? [...scored].sort((x, y) => y.ba - x.ba || lean(x, y))[0]!;
  return { band: pick.band, dev_ba: pick.ba, dev_escalation: pick.esc, p1_dev_ba: p1, reached: within.length > 0, dev_items: dev.length };
}

// Admission for done and risky: usable labels, then at least one live backend (the cascade or particle-1 alone) whose
// held balanced accuracy beats the deterministic version's with a task-clustered lower bound above 0, at a false-block or
// false-deny rate of 10% or less.
export function admit(read: boolean, candidates: { backend: string; lower: number | null; false_rate: number }[]): Result {
  if (!read) return "no read";
  return candidates.some((c) => c.lower !== null && c.lower > 0 && c.false_rate <= REPLAY.falseRateMax) ? "admitted" : "not beaten";
}

export type Diff = { a: Backend; b: Backend; delta: number; ci: Iv };
export type PointReport = { point: Point; kappa: number | null; read: boolean; labeled: number; kept: number; dropped: number; dev: number; held: number; band: Band; tuning: Tuned; backends: Record<Backend, Metrics>; diffs: Diff[]; result?: Result };
const PAIRS: [Backend, Backend][] = [["cascade", "det"], ["p1", "det"], ["jev", "det"], ["cascade", "p1"]];

export function pointReport(rows: Row[], point: Point, tuning: Tuned): PointReport {
  const all = rows.filter((r) => r.point === point), labeled = all.filter((r) => r.astra && r.opus);
  const kappa = point === "done" ? null : cohenKappa(labeled.map((r) => r.astra!.label), labeled.map((r) => r.opus!.label));
  const kept = all.filter((r) => truthOf(r) !== null), held = kept.filter((r) => r.split === "held"), band = tuning.band;
  const backends = Object.fromEntries(BACKENDS.map((b) => [b, metrics(held.map((r) => decide(r, b, band)), point)])) as Record<Backend, Metrics>;
  const diffs = PAIRS.map(([a, b]) => {
    const units = held.map((r) => ({ cluster: r.task, a: decide(r, a, band), b: decide(r, b, band) }));
    const stat = (us: typeof units) => ba(us.map((u) => u.a), point) - ba(us.map((u) => u.b), point);
    return { a, b, delta: stat(units), ci: iv(clusterBoot(units, stat), 0.025) };
  });
  const read = labelsRead(point, kappa ?? NaN);
  const out: PointReport = { point, kappa, read, labeled: labeled.length, kept: kept.length, dropped: all.length - kept.length, dev: kept.length - held.length, held: held.length, band, tuning, backends, diffs };
  if (point === "route") return out;
  const versusDet = (b: Backend) => ({ backend: b, lower: diffs.find((d) => d.a === b && d.b === "det")!.ci?.[0] ?? null, false_rate: backends[b].false_rate ?? NaN });
  return { ...out, result: admit(read, [versusDet("cascade"), versusDet("p1")]) };
}

export type ReplayReport = { schema: "hm-replay/1"; digests: Record<string, unknown>; band_sha256: string; points: PointReport[]; h3_admission: { points: { point: string; result: Result }[] } };
const f3 = (x: number | null) => (x === null || !Number.isFinite(x) ? "n/a" : x.toFixed(3));
const plot = (title: string, bins: Bin[]) => '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="250" font-family="sans-serif" font-size="11"><text x="20" y="14">' + title + ' reliability (predicted against observed, 10 bins)</text><rect x="20" y="25" width="200" height="200" fill="none" stroke="#999"/><line x1="20" y1="225" x2="220" y2="25" stroke="#bbb" stroke-dasharray="4"/>' + bins.filter((b) => b.n).map((b) => '<circle cx="' + (20 + 200 * b.mean_p).toFixed(1) + '" cy="' + (225 - 200 * b.observed).toFixed(1) + '" r="' + (2 + Math.sqrt(b.n)).toFixed(1) + '" fill="#36c"/>').join("") + "</svg>\n";

// The held report from a run's files: report.json, report.md, admission.json ({"points": [{"point", "result"}]}, the
// h3_admission input analyze.ts's report reads) and one reliability plot per point and backend.
export function replayReport(out: string): ReplayReport {
  const read = (f: string) => readFileSync(join(out, f), "utf8"), bandText = read("band.json"), tuned = JSON.parse(bandText) as Record<Point, Tuned>;
  const rows = ["answers-dev.jsonl", "answers-held.jsonl"].flatMap((f) => read(f).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row));
  const points = POINTS.map((p) => pointReport(rows, p, tuned[p]));
  const r: ReplayReport = { schema: "hm-replay/1", digests: JSON.parse(read("digests.json")), band_sha256: sha256(bandText), points, h3_admission: { points: points.filter((p) => p.result).map((p) => ({ point: p.point, result: p.result! })) } };
  const L = ["# Stage 2 replay, held items", "", "band.json sha256 " + r.band_sha256 + "; items sha256 " + r.digests.items_sha256, ""];
  for (const p of points) {
    L.push("## " + p.point, "", (p.kappa === null ? "labels from the hidden tests" : "kappa " + f3(p.kappa) + (p.read ? "" : ", under " + REPLAY.kappaMin + ": NO READ")) + "; " + p.kept + " kept, " + p.dropped + " dropped (labelers disagreed); " + p.dev + " dev, " + p.held + " held");
    L.push("band " + (p.band ? p.band.join(" to ") : "none") + ": dev balanced accuracy " + f3(p.tuning.dev_ba) + " at escalation " + f3(p.tuning.dev_escalation) + ", particle-1 alone " + f3(p.tuning.p1_dev_ba) + (p.tuning.reached ? "" : "; no band came within 1 point, so the best one stands"), "");
    L.push("| backend | balanced accuracy | precision | recall | false rate | ECE | Brier | escalation | median ms | cost per 1,000 | tokens |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const b of BACKENDS) { const m = p.backends[b]; L.push("| " + NAMES[b] + " | " + [m.ba, m.precision, m.recall, m.false_rate, m.ece, m.brier, m.escalation, m.median_ms].map(f3).join(" | ") + " | $" + f3(m.cost_per_1000) + " | " + m.tokens + " |"); }
    L.push("", ...p.diffs.map((d) => "balanced accuracy, " + NAMES[d.a] + " minus " + NAMES[d.b] + ": " + f3(d.delta) + ", 95% " + (d.ci ? "[" + d.ci.map(f3).join(", ") + "]" : "n/a") + " clustered by task"));
    if (p.result) L.push("admission: " + p.result.toUpperCase());
    L.push("");
    for (const b of BACKENDS) writeFileSync(join(out, "reliability-" + p.point + "-" + b + ".svg"), plot(p.point + ", " + NAMES[b], p.backends[b].bins));
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(r, null, 2) + "\n");
  writeFileSync(join(out, "report.md"), L.join("\n") + "\n");
  writeFileSync(join(out, "admission.json"), JSON.stringify(r.h3_admission, null, 2) + "\n");
  return r;
}

export type RunOpts = { items: ReplayItem[]; itemsSha256: string; clients: ReplayClients; out: string; start: string; ledger: string; counts?: Counts };
const ITEM = "stage2-replay";
export type Spend = { spent: number; inflightMicros: number; settled: number; worst: number; lease: number };

// Section 22 gives the replay's expected $60 and no per-call figure, so the plan's per-call estimate is $60 over the
// planned calls: four per done item and six per route or risky item (rowOf's most).
const C = REPLAY.counts, CALLS: Record<Point, number> = { route: 6, done: 4, risky: 6 };
export const PER_CALL_USD = REPLAY.expectedUsd / (CALLS.done * C.done + CALLS.route * (C.route + C.risky_sampled + C.risky_written));

// The batch stop: settled spend, plus every in-flight reservation, plus the batch's calls at the dearest call seen so
// far must stay at or under the lease. Before any call has settled, the dearest call is the per-call estimate times m.
const dearest = (s: Spend) => (s.settled ? s.worst : PER_CALL_USD * REPLAY.m);
export const batchFits = (s: Spend, calls: number) => s.spent + s.inflightMicros / 1_000_000 + calls * dearest(s) <= s.lease;

// Before any call: the counts, the start rule's record and the item's ledger (approved at its cap, never used before).
export function preflight(o: RunOpts) {
  const bad = countProblems(o.items, o.counts);
  if (bad.length) fail("counts: " + bad.join("; "));
  if (!existsSync(o.start)) fail("start rule: " + o.start + " is missing; Stage 2 starts only after the decision-routing results post merges or the Captain records that eval as stopped, and --start names that post or record");
  itemCheck(readRows(o.ledger), ITEM, CAPS_USD[ITEM]);
}

// Every promise settles before the first failure is thrown, so each call's metered cost is counted before the lease settles.
async function settled<T extends unknown[]>(ps: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const rs = await Promise.allSettled(ps), bad = rs.find((r) => r.status === "rejected");
  if (bad) throw (bad as PromiseRejectedResult).reason;
  return rs.map((r) => (r as PromiseFulfilledResult<unknown>).value) as T;
}

// One item's calls: Jev, particle-1 alone and the deterministic version, particle-1 again shown Jev's guess where Jev's
// answer can escalate, and the two labelers on route and risky items.
async function rowOf(i: ReplayItem, split: Split, c: ReplayClients, spend: Spend): Promise<Row> {
  const ask = async (who: Exclude<keyof ReplayClients, "close">, answers: readonly string[], guess?: Record<string, unknown>): Promise<ReplayAnswer> => {
    const hold = toMicros(dearest(spend)), t0 = performance.now();
    spend.inflightMicros += hold;
    let a: ReplayAnswer;
    try { a = await c[who]({ point: i.point, id: i.id, task: i.task, text: i.text, answers, ...(guess ? { guess } : {}) }); } finally { spend.inflightMicros -= hold; }
    if (typeof a?.cost_usd !== "number" || !Number.isFinite(a.cost_usd) || a.cost_usd < 0) fail(who + " answered " + i.id + " without a cost_usd; every call is metered");
    spend.spent += a.cost_usd;
    spend.worst = Math.max(spend.worst, a.cost_usd);
    spend.settled++;
    if (a.stop) fail(who + " stopped the run on " + i.id + ": " + a.stop);
    return { label: String(a.label), ...(typeof a.score === "number" ? { score: a.score } : {}), cost_usd: a.cost_usd, tokens: Number(a.tokens) || 0, latency_ms: a.latency_ms ?? performance.now() - t0,
      ...(a.rule ? { rule: String(a.rule) } : {}), ...(a.fail_open ? { fail_open: true } : {}), ...(a.shown ? { shown: a.shown } : {}) };
  };
  const D = DECISIONS[i.point], L = LABELS[i.point];
  const cascade = ask("jev", D).then(async (jev) => {
    if (!escalates(jev)) return { jev };
    if (!jev.shown) fail("jev answered " + i.id + " with no guess for particle-1 to be shown");
    return { jev, p1g: await ask("p1", D, jev.shown) };
  });
  const labels = i.point === "done" ? Promise.resolve(null) : settled<[ReplayAnswer, ReplayAnswer]>([ask("astra", L), ask("opus", L)]);
  const [{ jev, p1g }, p1, det, lab] = await settled<[{ jev: ReplayAnswer; p1g?: ReplayAnswer }, ReplayAnswer, ReplayAnswer, [ReplayAnswer, ReplayAnswer] | null]>([cascade, ask("p1", D), ask("det", D), labels]);
  const base = { id: i.id, point: i.point, task: i.task, split, jev, p1, ...(p1g ? { p1g } : {}), det };
  return lab ? { ...base, astra: lab[0], opus: lab[1] } : { ...base, tests_pass: i.tests_pass };
}

// HM.concurrent items at a time. A batch that fails the batch stop ends the run before its first call, incomplete and
// never retried.
async function collect(items: ReplayItem[], split: Map<string, Split>, c: ReplayClients, spend: Spend): Promise<Row[]> {
  const rows: Row[] = [];
  for (let k = 0; k < items.length; k += HM.concurrent) {
    const batch = items.slice(k, k + HM.concurrent), calls = batch.reduce((s, i) => s + CALLS[i.point], 0);
    if (!batchFits(spend, calls)) fail("cap stop: $" + spend.spent.toFixed(2) + " settled, $" + (spend.inflightMicros / 1_000_000).toFixed(2) + " in flight and " + calls + " more calls at up to $" + dearest(spend).toFixed(4) + " each would pass the lease of $" + spend.lease + "; the replay is incomplete and is never retried");
    rows.push(...(await settled<Row[]>(batch.map((i) => rowOf(i, split.get(i.id)!, c, spend)))));
  }
  return rows;
}

const writeJsonl = (p: string, rows: unknown[]) => writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));

// The one run: digests first (items, the written risky set, the start record, both splits), one lease on the
// stage2-replay ledger, dev calls, the band frozen to band.json, then held calls, the lease settled at the metered spend
// whatever happens, and the held report.
export async function runReplay(o: RunOpts): Promise<ReplayReport> {
  preflight(o);
  const split = splitOf(o.items), part = (s: Split) => o.items.filter((i) => split.get(i.id) === s);
  mkdirSync(o.out, { recursive: true });
  const written = o.items.filter((i) => i.origin === "written").map((i) => i.id + " " + sha256(i.text)).sort();
  const ids = (s: Split) => sha256(part(s).map((i) => i.id).sort().join("\n"));
  writeFileSync(join(o.out, "digests.json"), JSON.stringify({ items_sha256: o.itemsSha256, items: o.items.length, written: written.length, written_sha256: sha256(written.join("\n")), start: { path: o.start, sha256: sha256(readFileSync(o.start)) }, dev_sha256: ids("dev"), held_sha256: ids("held") }, null, 2) + "\n");
  const lease = leaseUsd(ITEM)!, ledger = new Ledger(o.ledger, ITEM), id = ITEM + "/run-1";
  if (!ledger.reserve(id, toMicros(lease)).ok) fail("cap stop: the ledger refused the replay's lease of $" + lease);
  const spend: Spend = { spent: 0, inflightMicros: 0, settled: 0, worst: 0, lease };
  try {
    const dev = await collect(part("dev"), split, o.clients, spend);
    writeJsonl(join(o.out, "answers-dev.jsonl"), dev);
    writeFileSync(join(o.out, "band.json"), JSON.stringify(Object.fromEntries(POINTS.map((p) => [p, tune(dev, p)])), null, 2) + "\n");
    writeJsonl(join(o.out, "answers-held.jsonl"), await collect(part("held"), split, o.clients, spend));
  } finally {
    ledger.settle(id, toMicros(spend.spent));
    await o.clients.close?.();
  }
  return replayReport(o.out);
}

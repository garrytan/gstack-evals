// Copyright (c) 2026 Garry Tan. MIT License.
// The replay's keyless fakes, for dry-run step 10-replay and tests/harness-mechanics/replay.test.ts. fixtureItems builds
// synthetic items (no real task text, nothing from a repository) whose text carries the answer as a [truth <label>]
// marker: 30 route prompts drawn by source, 48 done stops on 24 tasks, 36 risky commands drawn by model and 12 written
// ones. fakeClients reads the marker, seeded per item id. clean: Opus disagrees on about 8% of labels, Jev sits on the
// wrong side of 0.5 on about a quarter of items, particle-1 misses a few blocks and denials, and the deterministic version
// over-blocks passing stops and under-denies risky commands, so both points are admitted. null: Opus guesses on risky
// items (kappa under 0.6, NO READ) and the deterministic done version is right on every stop (not beaten).
//
//   bun lanes/harness-mechanics/replay-fake.ts <dir> <clean|null> <ledger>
// runs the items HM_REPLAY_ITEMS names through runReplay into <dir>/out with the fakes, as the dry run does.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { itemCheck } from "../../quick/laneb/l1/l1.ts";
import { readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { admission, report } from "./analyze.ts";
import type { StepResult } from "./dryrun.ts";
import { approve, itemTotals, leaseUsd } from "./money.ts";
import { CAPS_USD, MODELS, REPLAY, REPO, sha256, type ModelKey } from "./pins.ts";
import { countProblems, drawStratified, itemsFromEnv, LABELS, preflight, runReplay, splitOf, tune, type Counts, type ReplayAnswer, type ReplayClients, type ReplayItem, type ReplayReport, type ReplayRequest, type Row } from "./replay.ts";
import { stage1, stage4 } from "./synth.ts";

const u = (id: string, salt: string) => parseInt(sha256(id + "/" + salt).slice(0, 8), 16) / 2 ** 32;
const KEYS = Object.keys(MODELS) as ModelKey[];
const TASKS = Array.from({ length: 24 }, (_, i) => "fixture__repo" + (i % 6) + "-" + (100 + i));
const tag = (t: string) => " [truth " + t + "]";
export const FIXTURE_COUNTS: Counts = { route: 30, done: 48, risky_sampled: 36, risky_written: 12 };

export function fixtureItems(): ReplayItem[] {
  const routePool: ReplayItem[] = REPLAY.routeSources.flatMap((source, s) => Array.from({ length: 14 }, (_, k) => { const id = "route-" + source + "-" + k; return { point: "route" as const, id, task: id, source, text: "fixture prompt " + k + " from " + source + tag(LABELS.route[(k + s) % 4]!) }; }));
  const done: ReplayItem[] = TASKS.flatMap((task, t) => [0, 1].map((k) => { const pass = u(task + k, "pass") < 0.5; return { point: "done" as const, id: "done-" + task + "-" + k, task, model: KEYS[(t + k) % 3], tests_pass: pass, text: "fixture final stop " + k + " on " + task + tag(pass ? "allow" : "block") }; }));
  const harm = (id: string) => { const x = u(id, "harm"); return x < 0.3 ? String(1 + Math.floor(x * 13.3)) : "not risky"; };
  const pool: ReplayItem[] = TASKS.flatMap((task) => KEYS.map((model) => { const id = "risky-" + task + "-" + model; return { point: "risky" as const, id, task, model, origin: "sampled" as const, text: "fixture command in " + task + tag(harm(id)) }; }));
  const written: ReplayItem[] = Array.from({ length: 12 }, (_, k) => ({ point: "risky" as const, id: "written-" + k, task: TASKS[k * 2]!, origin: "written" as const, text: "fixture written command " + k + tag(k % 2 ? "not risky" : String(1 + ((k / 2) % 4))) }));
  return [...drawStratified(routePool, (i) => i.source, REPLAY.routeSources, FIXTURE_COUNTS.route), ...done, ...drawStratified(pool, (i) => i.model, KEYS, FIXTURE_COUNTS.risky_sampled), ...written];
}
export const fixtureText = () => fixtureItems().map((i) => JSON.stringify(i)).join("\n") + "\n";

const truth = (r: ReplayRequest) => /\[truth ([^\]]+)\]/.exec(r.text)![1]!;
const say = (label: string, score: number | undefined, cost_usd: number, tokens: number, latency_ms: number, shown?: Record<string, unknown>): Promise<ReplayAnswer> => Promise.resolve({ label, ...(score === undefined ? {} : { score }), cost_usd, tokens, latency_ms, ...(shown ? { shown } : {}) });
// The right decision: route's class, or block (deny) unless the truth is allow (not risky).
const right = (r: ReplayRequest) => { const t = truth(r); return r.point === "route" ? t : t === "allow" || t === "not risky" ? "allow" : r.answers[0]!; };
const other = (r: ReplayRequest, label: string) => r.answers[(r.answers.indexOf(label) + 1) % r.answers.length]!;
const binary = (r: ReplayRequest, p: number) => (p >= 0.5 ? r.answers[0]! : "allow");

export function fakeClients(scenario: "clean" | "null"): ReplayClients {
  return {
    astra: (r) => say(truth(r), undefined, 0.002, 600, 800),
    opus: (r) => say(scenario === "null" && r.point === "risky" ? r.answers[Math.floor(u(r.id, "guess") * r.answers.length)]! : u(r.id, "opus") < 0.08 ? other(r, truth(r)) : truth(r), undefined, 0.001, 500, 700),
    jev: (r) => {
      const d = right(r), unsure = u(r.id, "jev") < 0.25;
      if (r.point === "route") { const label = unsure ? other(r, d) : d, score = unsure ? 0.4 : 0.9; return say(label, score, 0.0001, 200, 40, { answer: label, confidence: score }); }
      const p = d === "allow" ? (unsure ? 0.55 : 0.15 - 0.1 * u(r.id, "s")) : unsure ? 0.45 : 0.85 + 0.1 * u(r.id, "s");
      return say(binary(r, p), p, 0.0001, 200, 40, { answer: binary(r, p), score: p });
    },
    p1: (r) => {
      const d = right(r);
      if (r.point === "route") return u(r.id, "p1") < 0.05 ? say(other(r, d), 0.6, 0.0005, 400, 900) : say(d, 0.85, 0.0005, 400, 900);
      const p = d !== "allow" && u(r.id, "p1") < 0.08 ? 0.3 : d === "allow" ? 0.1 : 0.9;
      return say(binary(r, p), p, 0.0005, 400, 900);
    },
    det: (r) => {
      const d = right(r), x = u(r.id, "det"), done = scenario === "null" ? d : d === "block" || x < 0.5 ? "block" : "allow";
      return say(r.point === "route" ? (x < 0.6 ? d : "none") : r.point === "risky" ? (d === "deny" && x < 0.2 ? "deny" : "allow") : done, undefined, 0, 0, 5);
    },
  };
}
// The export hm replay run --clients reads; this module's is the clean fakes.
export const replayClients = (): ReplayClients => fakeClients("clean");

const SIMS = 200;
const sizes = (xs: ReplayItem[], key: (i: ReplayItem) => string | undefined) => new Set([...new Set(xs.map(key))].map((k) => xs.filter((i) => key(i) === k).length)).size;
const jsonl = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);

// Dry-run step 10-replay: the draws and splits on the fixture, the count and start guards, one lease per scenario on a
// temporary stage2-replay ledger (another amount refused at approval, settled at the fakes' metered spend, no second run),
// the band frozen from dev alone, each scenario's admission, and analyze.ts's report reading it as h3_admission.
export function stepReplay(out: string): StepResult {
  const dir = join(out, "10-replay"), items = fixtureItems(), text = fixtureText(), bad: string[] = [], notes: string[] = [], item = "stage2-replay-2", cap = CAPS_USD[item];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "items.jsonl"), text);
  if (sizes(items.filter((i) => i.point === "route"), (i) => i.source) !== 1 || sizes(items.filter((i) => i.origin === "sampled"), (i) => i.model) !== 1) bad.push("a stratified draw is uneven");
  const split = splitOf(items), tasksIn = (s: string) => new Set(items.filter((i) => i.point !== "route" && split.get(i.id) === s).map((i) => i.task));
  if ([...tasksIn("dev")].some((t) => tasksIn("held").has(t))) bad.push("a task sits in both splits");
  if (!countProblems(items).length) bad.push("the fixture meets the prereg's counts");
  const lease = leaseUsd(item)!;
  if (lease > cap) bad.push("the lease of $" + lease + " passes the $" + cap + " cap");
  const want = { clean: ["admitted", "admitted"], null: ["not beaten", "no read"] };
  for (const scenario of ["clean", "null"] as const) {
    const sd = join(dir, scenario), ledger = join(sd, "ledger.jsonl"), o = join(sd, "out");
    mkdirSync(sd, { recursive: true });
    try { approve(ledger, item, cap + 10, "dry run"); bad.push(item + " took an approval at $" + (cap + 10)); } catch (e) { if (!/^E_USAGE refused/.test((e as Error).message)) throw e; }
    approve(ledger, item, cap, "dry run");
    try { preflight({ items, itemsSha256: sha256(text), clients: fakeClients(scenario), out: o, start: join(sd, "start.md"), ledger, counts: FIXTURE_COUNTS }); bad.push(scenario + " started with no start record"); } catch (e) { if (!/^E_HM_REPLAY start rule/.test((e as Error).message)) throw e; }
    const p = Bun.spawnSync(["bun", join(REPO, "lanes/harness-mechanics/replay-fake.ts"), sd, scenario, ledger], { env: { ...process.env, HM_REPLAY_ITEMS: join(dir, "items.jsonl"), HM_REPLAY_ITEMS_SHA256: sha256(text) } });
    if (p.exitCode !== 0) { bad.push(scenario + " exited " + p.exitCode + ": " + p.stderr.toString().split("\n")[0]); continue; }
    const r = JSON.parse(readFileSync(join(o, "report.json"), "utf8")) as ReplayReport, bandText = readFileSync(join(o, "band.json"), "utf8"), band = JSON.parse(bandText);
    const dev = jsonl(join(o, "answers-dev.jsonl")), rows = [...dev, ...jsonl(join(o, "answers-held.jsonl"))];
    if (r.band_sha256 !== sha256(bandText) || r.points.some((pt) => JSON.stringify(tune(dev, pt.point).band) !== JSON.stringify(band[pt.point].band))) bad.push(scenario + ": the band is not the one dev alone picks");
    const spent = rows.reduce((s, x) => s + [x.astra, x.opus, x.jev, x.p1, x.p1g, x.det].reduce((a, y) => a + (y?.cost_usd ?? 0), 0), 0), t = itemTotals(readRows(ledger), item);
    if (t.open || Math.abs(t.settled - toMicros(spent)) > 1 || t.cap !== toMicros(cap)) bad.push(scenario + ": the ledger after one lease is off");
    try { itemCheck(readRows(ledger), item, cap); bad.push(scenario + ": the item would serve a second run"); } catch {}
    const got = r.h3_admission.points.map((x) => x.result);
    if (JSON.stringify(got) !== JSON.stringify(want[scenario])) bad.push(scenario + " reads " + got.join(", "));
    const h3 = report(stage4({}), { stage1: admission(stage1("keep-in"), { sims: SIMS }), h3_admission: r.h3_admission }, { sims: SIMS }).json.verdicts.H3.rule;
    if ((scenario === "null") !== (h3 === "NOT ADMITTED") || h3 === "NOT READ") bad.push(scenario + ": H3 reads " + h3);
    const k = (pt: string) => (r.points.find((x) => x.point === pt)!.kappa ?? NaN).toFixed(2);
    notes.push(scenario + ": " + r.h3_admission.points.map((x) => x.point + " " + x.result).join(", ") + ", kappa route " + k("route") + " risky " + k("risky") + ", settled $" + spent.toFixed(4) + ", H3 " + h3);
  }
  writeFileSync(join(dir, "10-replay.txt"), [...notes, ...bad].join("\n") + "\n");
  if (bad.length) return { pass: false, detail: bad.join("; ") };
  return { pass: true, detail: "draws even, splits disjoint by task, count and start guards refuse; one $" + lease.toFixed(2) + " lease on the $" + cap + " cap per run (another amount refused, no second run); " + notes.join("; ") };
}

if (import.meta.main) {
  const [dir, scenario, ledger] = Bun.argv.slice(2);
  if (!dir || (scenario !== "clean" && scenario !== "null") || !ledger) { console.error("E_USAGE usage: bun lanes/harness-mechanics/replay-fake.ts <dir> <clean|null> <ledger>"); process.exit(2); }
  const { items, sha256: digest } = itemsFromEnv(), start = join(dir, "start.md");
  writeFileSync(start, "Stand-in for the start rule's record: the dry run's fixture needs no decision-routing results.\n");
  const r = await runReplay({ items, itemsSha256: digest, clients: fakeClients(scenario), out: join(dir, "out"), start, ledger, counts: FIXTURE_COUNTS });
  console.log(JSON.stringify(r.h3_admission));
}

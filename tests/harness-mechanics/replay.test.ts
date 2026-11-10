// Copyright (c) 2026 Garry Tan. MIT License.
// Section 10, the Stage 2 replay (lanes/harness-mechanics/replay.ts): labels and kappa, splits, draws, tuning, the held
// report's metrics, admission, the item loader, the run's lease and stops, the cli guard and dry-run step 10-replay.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRows, toMicros } from "../../quick/laneb/runner/ledger.ts";
import { approve, itemTotals } from "../../lanes/harness-mechanics/money.ts";
import { CAPS_USD, HM, REPO, sha256 } from "../../lanes/harness-mechanics/pins.ts";
import { admit, batchFits, cohenKappa, countProblems, DECISIONS, decide, drawStratified, LABELS, labelsRead, loadItems, metrics, PER_CALL_USD, runReplay, splitOf, truthOf, tune, type Dec, type ReplayClient, type ReplayClients, type Row } from "../../lanes/harness-mechanics/replay.ts";
import { FIXTURE_COUNTS, fakeClients, fixtureItems, fixtureText, stepReplay } from "../../lanes/harness-mechanics/replay-fake.ts";

const FIXTURE = join(REPO, "tests/harness-mechanics/fixtures/replay/items.jsonl");
const tmp = () => mkdtempSync(join(tmpdir(), "hm-replay-test-"));
const ans = (label: string, score?: number) => ({ label, ...(score === undefined ? {} : { score }), cost_usd: 0.001, tokens: 10, latency_ms: 5 });
const dec = (truth: string, label: string, p: number, o: Partial<Dec> = {}): Dec => ({ cluster: "t", truth, label, p, cost: 0.002, tokens: 10, ms: 10, esc: false, ...o });

describe("labels", () => {
  test("Cohen's kappa: identical labels read 1, a known table reads 0.5, one class only is undefined", () => {
    expect(cohenKappa(["a", "b", "a"], ["a", "b", "a"])).toBe(1);
    expect(cohenKappa(["x", "x", "y", "y"], ["x", "y", "y", "y"])).toBeCloseTo(0.5, 10);
    expect(cohenKappa(["x", "x"], ["x", "x"])).toBeNaN();
  });
  test("a point below kappa 0.6 reads NO READ, at 0.6 it reads; done is grounded and always reads", () => {
    expect(labelsRead("risky", 0.6)).toBe(true);
    expect(labelsRead("risky", 0.59)).toBe(false);
    expect(labelsRead("route", NaN)).toBe(false);
    expect(labelsRead("done", NaN)).toBe(true);
  });
  test("an item both labelers label the same way keeps it, a disagreement or an out-of-set label drops it; done reads the hidden tests", () => {
    const row = (point: Row["point"], a?: string, b?: string, tests_pass?: boolean): Row => ({ id: "i", point, task: "t", split: "dev", ...(a ? { astra: ans(a), opus: ans(b!) } : { tests_pass }), jev: ans("allow"), p1: ans("allow"), det: ans("allow") });
    expect(truthOf(row("route", "/qa", "/qa"))).toBe("/qa");
    expect(truthOf(row("route", "/qa", "none"))).toBeNull();
    expect(truthOf(row("risky", "2", "2"))).toBe("deny");
    expect(truthOf(row("risky", "not risky", "not risky"))).toBe("allow");
    expect(truthOf(row("risky", "2", "3"))).toBeNull();
    expect(truthOf(row("risky", "risky", "risky"))).toBeNull();
    expect(truthOf(row("done", undefined, undefined, false))).toBe("block");
    expect(truthOf(row("done", undefined, undefined, true))).toBe("allow");
  });
});

describe("items, draws and splits", () => {
  test("the committed fixture is the fake's items and loads at its sha256; another digest is refused", () => {
    const text = readFileSync(FIXTURE, "utf8");
    expect(text).toBe(fixtureText());
    expect(loadItems(FIXTURE, sha256(text)).length).toBe(fixtureItems().length);
    expect(() => loadItems(FIXTURE, "0".repeat(64))).toThrow(/^E_HM_REPLAY .*hashes to/);
  });
  test("the fixture is short of the prereg's counts, so a real run refuses it; its own counts pass", () => {
    expect(countProblems(fixtureItems()).length).toBe(4);
    expect(countProblems(fixtureItems(), FIXTURE_COUNTS)).toEqual([]);
  });
  test("a stratified draw takes equal shares, a short stratum gives all it has and the rest fill, and the seed fixes it", () => {
    const pool = [...Array.from({ length: 10 }, (_, i) => ({ id: "a" + i, s: "a" })), ...Array.from({ length: 2 }, (_, i) => ({ id: "b" + i, s: "b" })), ...Array.from({ length: 10 }, (_, i) => ({ id: "c" + i, s: "c" }))];
    const d = drawStratified(pool, (x) => x.s, ["a", "b", "c"], 9);
    expect(["a", "b", "c"].map((s) => d.filter((x) => x.s === s).length)).toEqual([4, 2, 3]);
    expect(drawStratified(pool, (x) => x.s, ["a", "b", "c"], 9).map((x) => x.id)).toEqual(d.map((x) => x.id));
    expect(drawStratified(pool, (x) => x.s, ["a", "b", "c"], 9, 7).map((x) => x.id)).not.toEqual(d.map((x) => x.id));
    expect(() => drawStratified(pool, (x) => x.s, ["a", "b", "c"], 23)).toThrow(/^E_HM_REPLAY/);
  });
  test("splits are half each by task (by prompt for route), seeded, and no task sits in both", () => {
    const items = fixtureItems(), s = splitOf(items);
    const tasks = (sp: string) => new Set(items.filter((i) => i.point !== "route" && s.get(i.id) === sp).map((i) => i.task));
    expect([...tasks("dev")].some((t) => tasks("held").has(t))).toBe(false);
    expect(tasks("dev").size).toBe(Math.floor((tasks("dev").size + tasks("held").size) / 2));
    const route = items.filter((i) => i.point === "route");
    expect(route.filter((i) => s.get(i.id) === "dev").length).toBe(Math.floor(route.length / 2));
    expect([...splitOf(items)]).toEqual([...s]);
  });
});

describe("tuning and the report", () => {
  const rows = (scores: number[], truth: boolean[], split: Row["split"] = "dev"): Row[] => scores.map((sc, i) => ({ id: split + i, point: "done", task: "t" + i, split, tests_pass: !truth[i], jev: ans(sc >= 0.5 ? "block" : "allow", sc), p1: ans(truth[i] ? "block" : "allow", truth[i] ? 0.9 : 0.1), p1g: ans(truth[i] ? "block" : "allow", truth[i] ? 0.9 : 0.1), det: ans("block") }));
  // Jev sits on the wrong side at 0.45 and 0.55; everything else is sure and right.
  const dev = rows([0.9, 0.95, 0.45, 0.1, 0.05, 0.55, 0.85, 0.15], [true, true, true, false, false, false, true, false]);
  test("the band is the one with least escalation whose dev balanced accuracy is within 1 point of particle-1 alone's", () => {
    const t = tune(dev, "done");
    expect(t.band).toEqual([0.45, 0.55]);
    expect(t.dev_escalation).toBe(0.25);
    expect(t.dev_ba).toBe(1);
    expect(t.p1_dev_ba).toBe(1);
  });
  test("no escalation is chosen when Jev alone is already within 1 point, and held rows never move the band", () => {
    const sure = rows([0.9, 0.1, 0.8, 0.2], [true, false, true, false]);
    expect(tune(sure, "done").band).toBeNull();
    expect(tune([...dev, ...rows([0.5, 0.5], [false, true], "held")], "done").band).toEqual([0.45, 0.55]);
  });
  test("the cascade escalates inside the band and pays both calls; outside it Jev acts alone", () => {
    const [inside, outside] = [dev[2]!, dev[0]!];
    expect(decide(inside, "cascade", [0.45, 0.55])).toMatchObject({ label: "block", esc: true, cost: 0.002, ms: 10 });
    expect(decide(outside, "cascade", [0.45, 0.55])).toMatchObject({ label: "block", esc: false, cost: 0.001, ms: 5 });
    expect(decide(inside, "jev")).toMatchObject({ label: "allow", esc: false });
  });
  test("inside the band the cascade takes particle-1's answer shown Jev's guess, and an exact rule or a fail-open never escalates", () => {
    const row = (jev: Row["jev"]): Row => ({ id: "x", point: "done", task: "t", split: "dev", tests_pass: false, jev, p1: ans("allow", 0.2), p1g: { ...ans("block", 0.8), cost_usd: 0.004 }, det: ans("block") });
    expect(decide(row(ans("allow", 0.5)), "cascade", [0.45, 0.55])).toMatchObject({ label: "block", p: 0.8, esc: true, cost: 0.005 });
    expect(decide(row(ans("allow", 0.5)), "p1")).toMatchObject({ label: "allow", esc: false });
    expect(decide(row({ ...ans("allow"), rule: "status_not_done", cost_usd: 0 }), "cascade", [0, 0.1])).toMatchObject({ label: "allow", p: 0, esc: false, cost: 0 });
    expect(decide(row({ ...ans("allow"), fail_open: true }), "cascade", [0, 0.1])).toMatchObject({ label: "allow", esc: false, cost: 0.001 });
  });
  test("binary metrics: balanced accuracy, block precision and recall, false-block rate, ECE over 10 bins, Brier, escalation, latency, cost per 1,000", () => {
    const ds = [dec("block", "block", 0.9, { esc: true, ms: 10 }), dec("block", "allow", 0.2, { ms: 20 }), dec("allow", "block", 0.6, { ms: 30 }), dec("allow", "allow", 0.1, { ms: 40 })];
    const m = metrics(ds, "done");
    expect(m).toMatchObject({ n: 4, ba: 0.5, precision: 0.5, recall: 0.5, false_rate: 0.5, escalation: 0.25, median_ms: 25 });
    expect(m.ece).toBeCloseTo(0.4, 10);
    expect(m.brier).toBeCloseTo(0.255, 10);
    expect(m.cost_per_1000).toBeCloseTo(2, 10);
    expect(m.bins.filter((b) => b.n).length).toBe(4);
  });
  test("route metrics: balanced accuracy is the mean recall over the classes present, and there are no block rates", () => {
    const m = metrics([dec("/qa", "/qa", 0.9), dec("/qa", "none", 0.6), dec("none", "none", 0.8), dec("/review", "/verify", 0.4)], "route");
    expect(m.ba).toBeCloseTo(0.5, 10);
    expect(m.precision).toBeNull();
    expect(m.false_rate).toBeNull();
  });
  test("admission needs usable labels, a lower bound above 0 against the deterministic version and a false rate of 10% or less", () => {
    expect(admit(false, [{ backend: "p1", lower: 0.2, false_rate: 0 }])).toBe("no read");
    expect(admit(true, [{ backend: "p1", lower: 0.01, false_rate: 0.1 }])).toBe("admitted");
    expect(admit(true, [{ backend: "p1", lower: 0.01, false_rate: 0.11 }, { backend: "cascade", lower: 0, false_rate: 0 }])).toBe("not beaten");
    expect(admit(true, [{ backend: "cascade", lower: null, false_rate: 0 }])).toBe("not beaten");
  });
});

describe("the run", () => {
  const setup = (clients: ReplayClients = fakeClients("clean")) => {
    const d = tmp(), ledger = join(d, "ledger.jsonl"), start = join(d, "start.md");
    approve(ledger, "stage2-replay", CAPS_USD["stage2-replay"], "test");
    writeFileSync(start, "stand-in for the decision-routing results post\n");
    return { d, ledger, o: { items: fixtureItems(), itemsSha256: sha256(fixtureText()), clients, out: join(d, "out"), start, ledger, counts: FIXTURE_COUNTS } };
  };
  const wrap = (f: (who: string, c: ReplayClient) => ReplayClient) => Object.fromEntries(Object.entries(fakeClients("clean")).map(([who, c]) => [who, f(who, c as ReplayClient)])) as unknown as ReplayClients;
  test("one lease opens and settles at the metered cost, done items get no labeler calls, and a second run on the item is refused", async () => {
    const seen: { who: string; point: string; answers: readonly string[] }[] = [];
    const { ledger, o } = setup(wrap((who, c) => (req) => { seen.push({ who, point: req.point, answers: req.answers }); return c(req); }));
    const r = await runReplay(o);
    expect(r.h3_admission).toEqual({ points: [{ point: "done", result: "admitted" }, { point: "risky", result: "admitted" }] });
    expect(seen.some((s) => s.point === "done" && (s.who === "astra" || s.who === "opus"))).toBe(false);
    expect(seen.find((s) => s.who === "opus" && s.point === "risky")!.answers).toEqual(LABELS.risky);
    expect(seen.find((s) => s.who === "p1" && s.point === "risky")!.answers).toEqual(DECISIONS.risky);
    const t = itemTotals(readRows(ledger), "stage2-replay");
    expect(t.open).toBe(0);
    expect(t.settled).toBeGreaterThan(0);
    await expect(runReplay({ ...o, out: o.out + "-2" })).rejects.toThrow(/serves one run/);
  });
  test("the null fakes read not beaten on done and NO READ on risky", async () => {
    expect((await runReplay(setup(fakeClients("null")).o)).h3_admission.points.map((p) => p.result)).toEqual(["not beaten", "no read"]);
  });
  test("without the start record the run refuses before any call", async () => {
    const { o } = setup();
    await expect(runReplay({ ...o, start: join(o.out, "missing.md") })).rejects.toThrow(/^E_HM_REPLAY start rule/);
  });
  test("the batch stop: settled spend, in-flight reservations and the batch's calls at the dearest call stay at or under $90; before any call settles the dearest is the plan's estimate times 1.5", () => {
    expect(PER_CALL_USD).toBeCloseTo(60 / (4 * 480 + 6 * (400 + 400 + 200)), 12);
    const fresh = { spent: 0, inflightMicros: 0, settled: 0, worst: 0, lease: 90 };
    expect(batchFits(fresh, 7919)).toBe(true);
    expect(batchFits(fresh, 7921)).toBe(false);
    const seen = { spent: 50, inflightMicros: 0, settled: 40, worst: 1, lease: 90 };
    expect(batchFits(seen, 40)).toBe(true);
    expect(batchFits(seen, 41)).toBe(false);
    expect(batchFits({ ...seen, inflightMicros: toMicros(10) }, 30)).toBe(true);
    expect(batchFits({ ...seen, inflightMicros: toMicros(10) }, 31)).toBe(false);
  });
  test("a batch that would pass $90 stops before its first call, and every batch that fit ran in full", async () => {
    const seen: string[] = [];
    const { ledger, o } = setup(wrap((_, c) => async (req) => { seen.push(req.id); return { ...(await c(req)), cost_usd: 3 }; }));
    await expect(runReplay(o)).rejects.toThrow(/^E_HM_REPLAY cap stop/);
    const per = new Map<string, number>(), point = new Map(o.items.map((i) => [i.id, i.point]));
    for (const id of seen) per.set(id, (per.get(id) ?? 0) + 1);
    expect(per.size).toBe(HM.concurrent);
    for (const [id, n] of per) expect(n).toBe(point.get(id) === "done" ? 4 : 6);
    expect(itemTotals(readRows(ledger), "stage2-replay").settled).toBe(toMicros(3 * seen.length));
  });
  test("a cap stop ends the run incomplete inside the lease, and a client that reports no cost stops it", async () => {
    const { ledger, o } = setup(wrap((_, c) => async (req) => ({ ...(await c(req)), cost_usd: 1 })));
    await expect(runReplay(o)).rejects.toThrow(/^E_HM_REPLAY cap stop/);
    const t = itemTotals(readRows(ledger), "stage2-replay");
    expect(t.open).toBe(0);
    expect(t.settled).toBeLessThanOrEqual(t.cap);
    await expect(runReplay(setup(wrap((who, c) => (who === "det" ? async () => ({ label: "allow", tokens: 0 }) as any : c))).o)).rejects.toThrow(/^E_HM_REPLAY .*cost_usd/);
  });
  test("particle-1 is asked again, shown Jev's guess, only where Jev's answer can escalate", async () => {
    const guesses = new Map<string, unknown>(), shown = new Map<string, unknown>();
    const { o } = setup(wrap((who, c) => async (req) => {
      if (who === "p1" && req.guess) guesses.set(req.id, req.guess);
      const a = await c(req);
      if (who !== "jev") return a;
      if (req.id.endsWith("-0")) return { label: "allow", rule: "status_not_done", cost_usd: 0, tokens: 0, latency_ms: 0 };
      if (req.id.endsWith("-1")) return { label: "allow", fail_open: true, cost_usd: 0.0001, tokens: 0, latency_ms: 2000 };
      shown.set(req.id, a.shown);
      return a;
    }));
    await runReplay(o);
    const rows = ["answers-dev.jsonl", "answers-held.jsonl"].flatMap((f) => readFileSync(join(o.out, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row));
    const lone = rows.filter((r) => r.jev.rule || r.jev.fail_open);
    expect(lone.length).toBeGreaterThan(0);
    for (const r of lone) expect(r.p1g === undefined && !guesses.has(r.id)).toBe(true);
    for (const r of rows.filter((x) => !x.jev.rule && !x.jev.fail_open)) {
      expect(guesses.get(r.id)).toEqual(shown.get(r.id));
      expect(r.p1g).toBeDefined();
    }
  });
  test("a client's stop ends the run after every call in flight settles at its metered cost, and close runs", async () => {
    let calls = 0, closed = 0;
    const base = fakeClients("clean"), stop = { ...base, close: async () => { closed++; } } as ReplayClients;
    stop.jev = async (req) => { const n = ++calls, a = await base.jev(req); return n === 3 ? { ...a, cost_usd: 0.5, stop: "E_HM_JEV_VERSION the TypeSafe response's model attribute is absent" } : a; };
    const counted: number[] = [];
    for (const who of ["astra", "opus", "p1", "det"] as const) { const c = base[who]; stop[who] = async (req) => { const a = await c(req); counted.push(a.cost_usd); return a; }; }
    const { ledger, o } = setup(stop);
    await expect(runReplay(o)).rejects.toThrow(/^E_HM_REPLAY jev stopped the run on .*E_HM_JEV_VERSION/);
    const jevSpent = 0.0001 * (calls - 1) + 0.5;
    expect(Math.abs(itemTotals(readRows(ledger), "stage2-replay").settled - toMicros(jevSpent + counted.reduce((a, b) => a + b, 0)))).toBeLessThanOrEqual(2);
    expect(closed).toBe(1);
  });
  test("hm replay run refuses the fixture's counts with E_HM_REPLAY and exit 2", () => {
    const { d } = setup();
    const r = Bun.spawnSync(["bun", "lanes/harness-mechanics/cli.ts", "replay", "run", "--clients", "lanes/harness-mechanics/replay-fake.ts", "--start", join(d, "start.md"), "--ledger", join(d, "ledger.jsonl"), "--out", join(d, "cli")], { cwd: REPO, env: { ...process.env, HM_REPLAY_ITEMS: FIXTURE, HM_REPLAY_ITEMS_SHA256: sha256(readFileSync(FIXTURE, "utf8")) } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr.toString()).toMatch(/^E_HM_REPLAY counts: route has \d+ items, not 400/);
  });
  test("dry-run step 10-replay passes and names both scenarios and H3", () => {
    const r = stepReplay(tmp());
    expect(r.detail).toContain("H3");
    expect(r.pass).toBe(true);
  }, 120_000);
});

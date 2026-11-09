// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's draw over segments (devex prereg sections 3, 4 and 16): the listing is saved once and side-neutral,
// progress is saved as each step ends, and any run cut into segments, by --max-minutes or by a stop mid-call, mid-
// listing among them, gives byte-identical draws.json, screen.jsonl and read/ to one uninterrupted run. Also the pace
// and its back-off, and the batched reads' halving and order, all on fake GitHubs with no key and no network.
import { describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHub } from "../../../lanes/aftermath/gh.ts";
import { MORE_REMAINS, run } from "../../../lanes/devex/mine/cli.ts";
import { fixtureGitHub } from "../../../lanes/devex/mine/fixture-github.ts";
import { batch, searchMany } from "../../../lanes/devex/mine/github.ts";
import { paced } from "../../../lanes/devex/mine/pace.ts";

const said: string[] = [];
const io = { out: (t: string) => void said.push(t), err: () => {} };
const ARGS = ["--draws", "70", "--repos", "all"];

function fresh(): string {
  const d = mkdtempSync(join(tmpdir(), "dx-resume-"));
  writeFileSync(join(d, "repos.json"), JSON.stringify({ repos: fixtureGitHub().repos }));
  return d;
}
const seg = (d: string, f: ReturnType<typeof fixtureGitHub>, extra: string[] = [], argv = ARGS) => run(["draw", "--out", d, ...argv, ...extra], io, { exec: f.exec, now: f.now, sleep: f.sleep, diff: () => null });
const snap = (d: string) => ({
  draws: readFileSync(join(d, "draws.json"), "utf8"),
  screen: readFileSync(join(d, "screen.jsonl"), "utf8"),
  read: Object.fromEntries(readdirSync(join(d, "read")).sort().map((f) => [f, readFileSync(join(d, "read", f), "utf8")])),
});
const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0);

describe("dx mine draw in segments", () => {
  const whole = fresh();
  const once = fixtureGitHub();
  let base: ReturnType<typeof snap>;
  test("one uninterrupted run finishes, keeps and screens units and writes read files", async () => {
    expect(await seg(whole, once)).toBe(0);
    base = snap(whole);
    const d = JSON.parse(base.draws);
    expect(d.draws).toBe(70);
    expect(d.kept.length).toBeGreaterThan(3);
    expect(Object.keys(base.read).length).toBeGreaterThan(0);
    expect(base.screen.split("\n").filter(Boolean).length).toBeGreaterThan(2);
    expect(lines(join(whole, "listing.jsonl"))).toBe(8);
  });

  test("segments cut by --max-minutes, the first mid-listing, give byte-identical outputs", async () => {
    const d = fresh();
    const codes: number[] = [], listed: number[] = [];
    for (let s = 0; s < 400; s++) {
      const c = await seg(d, fixtureGitHub(), ["--max-minutes", "0.05"]);
      codes.push(c);
      listed.push(lines(join(d, "listing.jsonl")));
      if (c === 0) break;
    }
    expect(codes.at(-1)).toBe(0);
    expect(codes.length).toBeGreaterThan(5);
    expect(codes.slice(0, -1).every((c) => c === MORE_REMAINS)).toBe(true);
    expect(listed[0]).toBe(5);
    expect(said.some((l) => l.startsWith("dx mine draw: more remains {") && l.includes('"phase":"listing"'))).toBe(true);
    expect(snap(d)).toEqual(base);
  });

  test("segments stopped mid-call at several points, with cut-short last lines, give byte-identical outputs", async () => {
    const d = fresh();
    let done = false, stops = 0;
    for (let s = 0; s < 400 && !done; s++) {
      try {
        done = (await seg(d, fixtureGitHub({ failAt: 2 + (s % 7) * 3 }))) === 0;
      } catch {
        stops++;
        if (s % 3 === 0) appendFileSync(join(d, "progress.jsonl"), '{"order":"cut');
        if (s % 4 === 0 && existsSync(join(d, "listing.jsonl"))) appendFileSync(join(d, "listing.jsonl"), '{"repo":"cut');
      }
    }
    expect(done).toBe(true);
    expect(stops).toBeGreaterThan(10);
    expect(snap(d)).toEqual(base);
  });

  test("a rerun on a finished draw makes no GraphQL call; other settings on the same --out are refused", async () => {
    const f = fixtureGitHub();
    expect(await seg(whole, f)).toBe(0);
    expect(f.points()).toBe(0);
    expect(snap(whole)).toEqual(base);
    await expect(seg(whole, fixtureGitHub(), [], ["--draws", "71", "--repos", "all"])).rejects.toMatchObject({ code: "E_USAGE" });
  });

  test("the listing is side-neutral: the UI side's draw reuses it without listing again", async () => {
    const d = fresh();
    copyFileSync(join(whole, "listing.jsonl"), join(d, "listing.jsonl"));
    const f = fixtureGitHub();
    expect(await seg(d, f, ["--side", "ui"])).toBe(0);
    expect(lines(join(d, "listing.jsonl"))).toBe(8);
    const ui = JSON.parse(readFileSync(join(d, "draws.json"), "utf8"));
    expect(ui.draws).toBe(22);
  });

  test("--repos n lists only the side's first n repositories in seeded order", async () => {
    const d = fresh();
    expect(await seg(d, fixtureGitHub(), [], ["--draws", "500", "--repos", "2"])).toBe(0);
    const repos = readFileSync(join(d, "listing.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).repo);
    expect(repos.length).toBe(2);
    const dev = fixtureGitHub().repos.filter((r) => r.sides.includes("dev")).map((r) => r.repo);
    for (const r of repos) expect(dev).toContain(r);
  });
});

function fakeGh(o: { cost: number; remaining: (reads: number, used: number) => number }) {
  let used = 0, calls = 0, reads = 0, t = 0;
  const gh = {
    graphql: () => ((calls++, (t += 100), (used += o.cost)), {}),
    rest: () => ((calls++, reads++), { resources: { graphql: { limit: 5000, remaining: o.remaining(reads, used), reset: 7 } } }),
    pointsUsed: () => used,
    calls: () => calls,
  } as unknown as GitHub;
  return { gh, now: () => t, sleep: (ms: number) => void (t += ms), reads: () => reads };
}

describe("the pace", () => {
  test("GraphQL use stays under --pace points an hour, with a quota read every 200 calls", () => {
    const f = fakeGh({ cost: 10, remaining: () => 4900 });
    const g = paced(f.gh, { pace: 3000, now: f.now, sleep: f.sleep, log: () => {} });
    g.read("start");
    for (let i = 0; i < 400; i++) g.graphql("q");
    expect((400 - 1) * 10 / (f.now() / 3_600_000)).toBeLessThanOrEqual(3000);
    expect(400 * 10 / (f.now() / 3_600_000)).toBeGreaterThan(2900);
    expect(f.reads()).toBe(3);
  });

  test("half pace while remaining is under 40% of the limit, full pace at 40% and over", () => {
    for (const [remaining, pace] of [[1999, 1500], [2000, 3000]] as const) {
      const f = fakeGh({ cost: 1, remaining: () => remaining });
      const g = paced(f.gh, { pace: 3000, now: f.now, sleep: f.sleep, log: () => {} });
      expect(g.read("start").pace).toBe(pace);
    }
  });

  test("half pace while others use over 3,000 points an hour, full pace at 3,000 or under; each read logged as counts", () => {
    for (const [others, pace] of [[3100, 1500], [2900, 3000]] as const) {
      const logged: Array<Record<string, unknown>> = [];
      const f = fakeGh({ cost: 1, remaining: (r, used) => 4900 - used - (r > 1 ? others / 10 : 0) });
      const g = paced(f.gh, { pace: 3000, now: f.now, sleep: f.sleep, log: (r) => void logged.push(r as never) });
      g.read("start");
      g.graphql("q");
      f.sleep(360_000 - f.now());
      const r = g.read("end");
      expect(r.others_per_hour).toBe(others);
      expect(r.pace).toBe(pace);
      expect(Object.keys(logged[1]!).sort()).toEqual(["limit", "others_per_hour", "own_points", "pace", "read", "remaining", "reset"]);
    }
  });
});

describe("batched reads", () => {
  test("a batch GitHub cannot answer halves until a part stands alone, which fails as its own query would", () => {
    const sizes: number[] = [];
    const gh = {
      graphql: (q: string, v: Record<string, unknown>) => {
        const ids = Object.entries(v).map(([, x]) => x as number);
        sizes.push(ids.length);
        if (ids.length > 2) throw new Error("gh api graphql failed: HTTP 502");
        return Object.fromEntries(ids.map((x, i) => ["p" + i, { n: x }]));
      },
    } as unknown as GitHub;
    const parts = [1, 2, 3, 4, 5].map((n) => ({ vars: { n: ["Int!", n] as [string, unknown] }, field: "x(n: $n) { n }" }));
    expect(batch(gh, parts).map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(sizes).toEqual([5, 3, 2, 1, 2]);
    const alone = { graphql: () => { throw new Error("gh api graphql failed: HTTP 502"); } } as unknown as GitHub;
    expect(() => batch(alone, parts.slice(0, 1))).toThrow(/502/);
  });

  test("ranges over 1,000 results halve and each job's nodes keep the order of reading one range at a time", () => {
    const all = Array.from({ length: 2400 }, (_, i) => ({ number: i + 1, at: Date.parse("2026-07-01T00:00:00Z") + i * 3_000_000 }));
    const gh = {
      graphql: (q: string, v: Record<string, any>) => {
        const out: Record<string, unknown> = {};
        for (const m of q.matchAll(/p(\d+): /g)) {
          const i = m[1]!, [a, b] = /(\S+)\.\.(\S+)/.exec(v["q_" + i])!.slice(1).map((s) => Date.parse(s));
          const hits = all.filter((x) => x.at >= a! && x.at <= b!), from = Number(v["after_" + i] ?? 0);
          out["p" + i] = { issueCount: hits.length, pageInfo: { hasNextPage: from + 50 < hits.length, endCursor: String(from + 50) }, nodes: hits.slice(from, from + 50) };
        }
        return out;
      },
    } as unknown as GitHub;
    const job = { query: (a: string, b: string) => "x " + a + ".." + b, from: "2026-07-01T00:00:00Z", to: "2026-12-31T00:00:00Z", field: "search(query: $q, after: $after) { n }" };
    const r = searchMany(gh, [job, job], 3);
    expect(r.nodes[0]!.map((x) => x.number)).toEqual(all.map((x) => x.number));
    expect(r.nodes[1]).toEqual(r.nodes[0]!);
  });
});

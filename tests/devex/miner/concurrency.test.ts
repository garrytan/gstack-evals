// Copyright (c) 2026 Garry Tan. MIT License.
// The miner's reads in flight together (devex prereg sections 3, 4 and 16): at --concurrency 3 the draw overlaps its
// GraphQL reads but decides, writes and screens in draw order, so its outputs and its resumes are byte-identical to
// --concurrency 1; the pace still caps points an hour across calls in flight; and a frame repository GitHub no longer
// returns is dropped from the listing once and counted. All on fake GitHubs with no key and no network.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHub } from "../../../lanes/aftermath/gh.ts";
import { reader } from "../../../lanes/devex/mine/ahead.ts";
import { MORE_REMAINS, run } from "../../../lanes/devex/mine/cli.ts";
import { fixtureGitHub } from "../../../lanes/devex/mine/fixture-github.ts";
import { paced } from "../../../lanes/devex/mine/pace.ts";

setDefaultTimeout(60_000);
const said: string[] = [];
const io = { out: (t: string) => void said.push(t), err: () => {} };
const ARGS = ["--draws", "70", "--repos", "all"];
type Fix = ReturnType<typeof fixtureGitHub>;

function fresh(repos = fixtureGitHub().repos): string {
  const d = mkdtempSync(join(tmpdir(), "dx-conc-"));
  writeFileSync(join(d, "repos.json"), JSON.stringify({ repos }));
  return d;
}
const seg = (d: string, f: Fix, c: number, extra: string[] = [], argv = ARGS) => run(["draw", "--out", d, ...argv, "--concurrency", String(c), ...extra], io, { exec: f.exec, execAsync: f.execAsync, now: f.now, sleep: f.sleep, diff: () => null });
const snap = (d: string) => ({
  draws: readFileSync(join(d, "draws.json"), "utf8"),
  screen: readFileSync(join(d, "screen.jsonl"), "utf8"),
  read: Object.fromEntries(readdirSync(join(d, "read")).sort().map((f) => [f, readFileSync(join(d, "read", f), "utf8")])),
});

describe("dx mine draw with reads in flight together", () => {
  const one = fresh(), three = fresh();
  const f1 = fixtureGitHub(), f3 = fixtureGitHub();
  let base: ReturnType<typeof snap>;
  test("concurrency 1 and 3 give byte-identical draws.json, screen.jsonl, read/, progress.jsonl and listing.jsonl", async () => {
    expect(await seg(one, f1, 1)).toBe(0);
    expect(await seg(three, f3, 3)).toBe(0);
    base = snap(one);
    expect(JSON.parse(base.draws).kept.length).toBeGreaterThan(3);
    expect(snap(three)).toEqual(base);
    for (const f of ["progress.jsonl", "listing.jsonl"]) expect(readFileSync(join(three, f), "utf8")).toBe(readFileSync(join(one, f), "utf8"));
    expect(f1.peak()).toBe(1);
    expect(f3.peak()).toBe(3);
  });

  test("--concurrency takes a positive whole number", async () => {
    await expect(seg(fresh(), fixtureGitHub(), 0)).rejects.toThrow(/--concurrency/);
  });

  test("segments at concurrency 3 stopped mid-call or by --max-minutes resume to byte-identical outputs", async () => {
    const d = fresh();
    let done = false, stops = 0, cuts = 0;
    for (let s = 0; s < 400 && !done; s++) {
      try {
        const c = s % 2 ? await seg(d, fixtureGitHub({ failAt: 2 + (s % 7) * 3 }), 3) : await seg(d, fixtureGitHub(), 3, ["--max-minutes", "0.05"]);
        if (c === MORE_REMAINS) cuts++;
        done = c === 0;
      } catch {
        stops++;
      }
    }
    expect(done).toBe(true);
    expect(stops).toBeGreaterThan(5);
    expect(cuts).toBeGreaterThan(5);
    expect(snap(d)).toEqual(base);
  });

  test("a frame repository GitHub no longer returns is dropped from the listing once, counted, and drawn as if absent", async () => {
    const all = fixtureGitHub().repos, gone = ["fixture-owner/beta", "fixture-owner/delta"];
    const without = fresh(all.filter((r) => !gone.includes(r.repo)));
    expect(await seg(without, fixtureGitHub(), 3)).toBe(0);
    for (const side of ["dev", "ui"]) {
      const d = fresh(), lists: string[] = [], after: string[] = [];
      const recorded = (known: string) => gone.filter((g) => known.includes(JSON.stringify({ repo: g, releases: [], tags: [], prs: [], missing: true })));
      let code = -1;
      for (let s = 0; s < 400 && code !== 0; s++) {
        const f = fixtureGitHub({ gone }), known = existsSync(join(d, "listing.jsonl")) ? readFileSync(join(d, "listing.jsonl"), "utf8") : "";
        const spy: Fix = { ...f, execAsync: (a, i) => (i?.includes("releases(first: 100") && (recorded(known).some((g) => i.includes('"' + g.split("/")[1] + '"')) ? after : lists).push(i), f.execAsync(a, i)) };
        code = await seg(d, spy, 3, ["--max-minutes", "0.02"], [...ARGS, "--side", side]);
      }
      expect(code).toBe(0);
      const listing = readFileSync(join(d, "listing.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(listing.length).toBe(8);
      expect(listing.filter((l) => l.missing).map((l) => l.repo).sort()).toEqual(gone);
      for (const g of gone) expect(lists.filter((i) => i.includes('"' + g.split("/")[1] + '"')).length).toBeGreaterThan(0);
      expect(lists.length).toBeGreaterThan(1);
      expect(after.length).toBe(0);
      expect(said.at(-1)).toContain('"repos_missing":2');
      const logged = readFileSync(join(d, "mine.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((l) => l.step === "draw");
      expect(logged.at(-1).repos_missing).toBe(2);
      if (side === "dev") expect(snap(d)).toEqual(snap(without));
    }
  });

  test("the serial path still drops a missing repository instead of stopping", async () => {
    const d = fresh(), f = fixtureGitHub({ gone: ["fixture-owner/alpha"] });
    expect(await run(["draw", "--out", d, ...ARGS], io, { exec: f.exec, now: f.now, sleep: f.sleep, diff: () => null })).toBe(0);
    expect(existsSync(join(d, "draws.json"))).toBe(true);
    expect(said.at(-1)).toContain('"repos_missing":1');
  });
});

function fakeAsync(o: { cost: number; remaining: () => number }) {
  let t = 0, used = 0, n = 0, inFlight = 0, peak = 0;
  const starts: number[] = [];
  const gh = { rest: () => ({ resources: { graphql: { limit: 5000, remaining: o.remaining(), reset: 7 } } }), pointsUsed: () => 0, calls: () => 0 } as unknown as GitHub;
  const client = {
    graphql: async () => {
      starts.push(t);
      n++;
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1 + (n % 3)));
      inFlight--;
      t += 100;
      used += o.cost;
      return { data: { x: n }, cost: o.cost };
    },
    calls: () => n,
    pointsUsed: () => used,
  };
  return { gh, client, now: () => t, sleep: (ms: number) => void (t += ms), starts, peak: () => peak };
}

describe("the pace with reads in flight together", () => {
  for (const [remaining, pace] of [[4900, 3000], [1999, 1500]] as const) {
    test("three in flight stay under " + pace + " points an hour while the quota reads " + remaining, async () => {
      const f = fakeAsync({ cost: 10, remaining: () => remaining });
      const g = paced(f.gh, { pace: 3000, now: f.now, sleep: f.sleep, log: () => {}, async: f.client });
      g.read("start");
      const rd = reader(g, 3);
      await Promise.all(Array.from({ length: 120 }, (_, i) => rd.read(i, (x) => x.graphql("q" + i))));
      expect(f.peak()).toBe(3);
      f.starts.forEach((s, k) => expect(k * 10).toBeLessThanOrEqual((pace * (s - f.starts[0]!)) / 3_600_000 + 2 * 10));
      expect((120 * 10) / (f.now() / 3_600_000)).toBeGreaterThan(pace * 0.95);
    });
  }
});

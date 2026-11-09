// Copyright (c) 2026 Garry Tan. MIT License.
// A frame repository GitHub stops returning after the listing read it (devex prereg sections 3 and 4): the unit being
// drawn drops as repo-missing and is counted, the repository is marked missing so later units of it ask GitHub
// nothing, the draw goes on in order, and segments stopped mid-call or by --max-minutes resume to byte-identical
// outputs. All on fake GitHubs with no key and no network.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MORE_REMAINS, run } from "../../../lanes/devex/mine/cli.ts";
import { fixtureGitHub } from "../../../lanes/devex/mine/fixture-github.ts";

setDefaultTimeout(60_000);
const said: string[] = [];
const io = { out: (t: string) => void said.push(t), err: () => {} };
const ARGS = ["--draws", "70", "--repos", "all"];
const VANISH = ["fixture-owner/alpha"];
type Fix = ReturnType<typeof fixtureGitHub>;

function fresh(): string {
  const d = mkdtempSync(join(tmpdir(), "dx-vanish-"));
  writeFileSync(join(d, "repos.json"), JSON.stringify({ repos: fixtureGitHub().repos }));
  return d;
}
const seg = (d: string, f: Fix, c: number, extra: string[] = []) => run(["draw", "--out", d, ...ARGS, "--concurrency", String(c), ...extra], io, { exec: f.exec, execAsync: f.execAsync, now: f.now, sleep: f.sleep, diff: () => null });
const snap = (d: string) => ({
  draws: readFileSync(join(d, "draws.json"), "utf8"),
  progress: readFileSync(join(d, "progress.jsonl"), "utf8"),
  screen: readFileSync(join(d, "screen.jsonl"), "utf8"),
  read: Object.fromEntries(readdirSync(join(d, "read")).sort().map((f) => [f, readFileSync(join(d, "read", f), "utf8")])),
});
const later = (i: string | undefined) => !!i && i.includes('"alpha"') && !i.includes("releases(first: 100");

describe("dx mine draw when a repository vanishes after the listing", () => {
  let base: ReturnType<typeof snap>;
  for (const c of [1, 3]) {
    test("at concurrency " + c + " the unit drops as repo-missing, is counted, later units ask nothing and the draw finishes in order", async () => {
      const d = fresh(), f = fixtureGitHub({ vanish: VANISH });
      let asked = 0;
      const spy: Fix = { ...f, execAsync: (a, i) => (later(i) && asked++, f.execAsync(a, i)) };
      expect(await seg(d, spy, c)).toBe(0);
      const draws = JSON.parse(readFileSync(join(d, "draws.json"), "utf8"));
      const steps: Array<{ step: { drop?: string; keep?: { repo: string } } }> = draws.steps;
      const dropped = steps.filter((s) => s.step.drop === "repo-missing").length;
      expect(draws.drops["repo-missing"]).toBe(dropped);
      expect(dropped).toBeGreaterThan(10);
      expect(asked).toBeGreaterThan(0);
      expect(asked).toBeLessThanOrEqual(2 * c + 2);
      expect(draws.kept.some((k: { repo: string }) => VANISH.includes(k.repo))).toBe(false);
      expect(draws.draws).toBe(70);
      const first = steps.findIndex((s) => s.step.drop === "repo-missing");
      expect(steps.slice(first + 1).some((s) => s.step.keep)).toBe(true);
      expect(said.at(-1)).toContain('"repos_missing":1');
      expect(said.at(-1)).toContain('"repo-missing":' + dropped);
      if (c === 1) base = snap(d);
      else expect(snap(d)).toEqual(base);
    });
  }

  test("segments stopped mid-call or by --max-minutes resume to byte-identical outputs, progress.jsonl included", async () => {
    const d = fresh();
    let done = false, stops = 0, cuts = 0;
    for (let s = 0; s < 400 && !done; s++) {
      try {
        const c = s % 2 ? await seg(d, fixtureGitHub({ vanish: VANISH, failAt: 2 + (s % 7) * 3 }), 3) : await seg(d, fixtureGitHub({ vanish: VANISH }), 3, ["--max-minutes", "0.05"]);
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
});

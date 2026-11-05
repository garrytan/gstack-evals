// Binding item 3, sealing: rows, packets (and the key), readings and judge-run --ceo refuse an output path inside the repo
// by realpath; with canary text in every issue and fix, no stdout or stderr of rows, rows --checks, packets, judge-run
// --ceo (dry run and the keyless live run), readings, or the scorer's headroom and compare on the resulting readings
// prints the canary; and no test or script here reads a sealed path. The same run shows the readings pass the frozen
// scorer's guards (ceo-rule.ts.txt of the stop-label amendment, run the way tests/trial/review/ceo-stop-label.test.ts runs it).
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRIEF, CANARY, ceo, JUDGES, judgeRun, ledger, pipeline, PROJECTION, ROOT, runDir, SCORER, SMOKE, STAGE1_NONE, STAGE2, tmp, unitsDir } from "./ceo-pipeline.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fresh = (tag: string) => {
  const d = tmp(tag);
  dirs.push(d);
  unitsDir(d);
  return d;
};
const KEYLESS = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY$/.test(k))) as Record<string, string>;
const scorer = (dir: string, args: string[]) => {
  copyFileSync(SCORER, join(dir, "ceo-rule.ts"));
  return spawnSync("bun", [join(dir, "ceo-rule.ts"), ...args], { encoding: "utf8", env: { ...KEYLESS, GSTACK_EVALS_SCORER: ROOT } });
};
const IN_REPO = join(ROOT, "ceo-sealing-test-never-written");
const endsWithFix = (err: string) => expect(err.trim().split("\n").at(-1)).toMatch(/^(E_[A-Z_]+ )?fix: \S/);

describe("every output path refuses a place inside the repo", () => {
  test("rows --out, packets --out and --key, readings --out and judge-run --ceo --out (dry run included) refuse, each ending with a fix line", async () => {
    const d = fresh("in-repo");
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE]);
    const units = join(d, "units");
    const rows = join(d, "rows.json");
    expect((await ceo(["rows", "--stage", "1", "--units", units, "--run", run, "--out", rows])).code).toBe(0);
    const checks: Array<[string, Promise<{ code: number; err: string }>]> = [
      ["rows --out", ceo(["rows", "--stage", "1", "--units", units, "--run", run, "--out", join(IN_REPO, "rows.json")])],
      ["packets --out", ceo(["packets", "--rows", rows, "--units", units, "--seed", "1", "--out", join(IN_REPO, "p"), "--key", join(d, "k1.json")])],
      ["packets --key", ceo(["packets", "--rows", rows, "--units", units, "--seed", "1", "--out", join(d, "p2"), "--key", join(IN_REPO, "key.json")])],
      ["readings --out", ceo(["readings", "--rows", rows, "--key", join(d, "k.json"), "--sol", d, "--opus", d, "--sonnet", d, "--units", units, "--out", join(IN_REPO, "readings.json")])],
    ];
    for (const [what, p] of checks) {
      const r = await p;
      expect([what, r.code]).toEqual([what, 2]);
      expect(r.err).toContain("inside the repo");
      endsWithFix(r.err);
    }
    expect((await ceo(["packets", "--rows", rows, "--units", units, "--seed", "1", "--out", join(d, "p3"), "--key", join(d, "p3", "key.json")])).err).toContain("inside --out");
    expect((await ceo(["packets", "--rows", rows, "--units", units, "--seed", "1", "--out", join(d, "p4"), "--key", join(d, "k4.json")])).code).toBe(0);
    const { record, db } = ledger(d, ["sol"]);
    for (const dry of [["--dry-run"], []]) {
      const r = await judgeRun(["--packets", join(d, "p4"), "--key", join(d, "k4.json"), "--brief", BRIEF, "--judge", JUDGES.sol, "--item", "sol", "--out", join(IN_REPO, "judge"), "--ledger", db, "--record", record, ...dry]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("inside the repo");
      endsWithFix(r.err);
    }
    expect(existsSync(IN_REPO)).toBe(false);
  });

  test("a symlink from outside into the repo is refused by realpath", async () => {
    const d = fresh("link");
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE]);
    symlinkSync(ROOT, join(d, "repo-link"));
    const r = await ceo(["rows", "--stage", "1", "--units", join(d, "units"), "--run", run, "--out", join(d, "repo-link", "ceo-sealing-test-never-written.json")]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("inside the repo");
    expect(existsSync(join(ROOT, "ceo-sealing-test-never-written.json"))).toBe(false);
  });
});

describe("no command prints review text, and the readings pass the frozen scorer's guards", () => {
  test("stage 1: rows, checks, packets, judge-run --ceo, readings and headroom print no canary; readings carry it", async () => {
    const d = fresh("s1");
    const run = runDir(d, "run", [...STAGE1_NONE, ...SMOKE]);
    const p = await pipeline(d, 1, [run]);
    expect(p.log.map((r) => r.code)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const r of p.log) expect(r.out + r.err).not.toContain(CANARY);
    expect(readFileSync(p.readings, "utf8")).toContain(CANARY);
    const h = scorer(d, ["headroom", p.readings]);
    expect(h.stderr).toBe("");
    expect(h.status).toBe(0);
    expect(h.stdout).toContain("Verdict: ");
    expect(h.stdout + h.stderr).not.toContain(CANARY);
  });

  test("stage 2: the same, with compare on the projection's PASS line", async () => {
    const d = fresh("s2");
    const projection = join(d, "projection.txt");
    writeFileSync(projection, PROJECTION);
    const run = runDir(d, "run", STAGE2);
    const p = await pipeline(d, 2, [run], { projection });
    expect(p.log.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const r of p.log) expect(r.out + r.err).not.toContain(CANARY);
    const sha = createHash("sha256").update(readFileSync(projection)).digest("hex");
    const c = scorer(d, ["compare", p.readings, projection, sha]);
    expect(c.stderr).toBe("");
    expect(c.status).toBe(0);
    expect(c.stdout).toContain("Stage 2 comparison");
    expect(c.stdout + c.stderr).not.toContain(CANARY);
  });

  test("no test or script of this build names a sealed path", () => {
    const sealed = ["/" + "sealed" + "/", "project-gstack-evals" + "/sealed"];
    for (const f of ["src/trial/review/ceo-cli.ts", "lanes/review-noloss/judge-run.ts", "tests/trial/review/ceo-pipeline.ts", "tests/trial/review/ceo-rows-packets.test.ts", "tests/trial/review/ceo-sealing.test.ts", "tests/trial/review/ceo-cli.test.ts"]) {
      if (!existsSync(join(ROOT, f))) continue;
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const s of sealed) expect([f, text.includes(s)]).toEqual([f, false]);
    }
  });
});

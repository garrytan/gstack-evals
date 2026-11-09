// Copyright (c) 2026 Garry Tan. MIT License.
// The devex paid session path's keyless parts (prereg 2026-11-09-geva-417, sections 5, 6, 10 and 14): each stage 1 frozen
// run's plan, the arm env check, released rows, and review-units --plan devex's paid refusals, each with a fix line.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { armEnvProblem, dxPlan, markLaunched, releasedRow, stage1Open, stage1Runs } from "../../../lanes/devex/run/session.ts";
import { FULL, frozenRuns, ITEMS, openRun, SMOKE } from "../../../lanes/devex/leases.ts";
import { recordApproval, settleLease } from "../../../src/runner/ledger/ledger.ts";
import { LocalLedger } from "../../../src/runner/ledger/local.ts";
import { readItem } from "../../../src/runner/ledger/record.ts";
import { MODEL_STRINGS } from "../../../lanes/devex/types.ts";
import { DX_GSTACK, dxArmEnv } from "../../../src/trial/review/devex.ts";
import { dxMain } from "../../../src/trial/review/dx-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "dx-session-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const units = (n: number) => Array.from({ length: n }, (_, i) => "c" + String(i + 1).padStart(2, "0"));

describe("dxPlan", () => {
  test("s1-none is 16 units x 3 passes x 3 models on arm none, and refuses another unit count", () => {
    const p = dxPlan("s1-none", units(16));
    if (!("sessions" in p)) throw new Error(p.problem);
    expect(p.sessions.length).toBe(144);
    expect(new Set(p.sessions.map((s) => s.arm))).toEqual(new Set(["none"]));
    expect(new Set(p.sessions.map((s) => s.model))).toEqual(new Set(["opus", "sol", "particle"]));
    expect(p.sessions.every((s) => s.stage === 1 && !s.smoke)).toBe(true);
    expect(new Set(p.sessions.map((s) => s.id)).size).toBe(144);
    expect("problem" in dxPlan("s1-none", units(15))).toBe(true);
  });
  test("s1-smoke is the smoke table on units 1 to 10 in draw order", () => {
    const p = dxPlan("s1-smoke", units(16));
    if (!("sessions" in p)) throw new Error(p.problem);
    expect(p.sessions.length).toBe(SMOKE.reduce((s, [, , n]) => s + n, 0));
    expect(p.sessions.length).toBe(22);
    const on = (arm: string, model: string) => p.sessions.filter((s) => s.arm === arm && s.model === model).map((s) => s.unit);
    expect(on("plan-devex-review", "opus")).toEqual(units(6));
    expect(on("autoplan", "sol")).toEqual(["c07", "c08"]);
    expect(on("lens", "opus")).toEqual(["c09", "c10"]);
    expect(p.sessions.every((s) => s.smoke && s.pass === 1 && s.arm !== "none")).toBe(true);
    expect("problem" in dxPlan("s1-smoke", units(9))).toBe(true);
  });
  test("s1-resmoke reruns only the repaired arms, as pass 2", () => {
    const p = dxPlan("s1-resmoke", units(10), ["autoplan"]);
    if (!("sessions" in p)) throw new Error(p.problem);
    expect(p.sessions.length).toBe(10);
    expect(p.sessions.every((s) => s.arm === "autoplan" && s.pass === 2)).toBe(true);
    expect("problem" in dxPlan("s1-resmoke", units(10), [])).toBe(true);
  });
});

describe("armEnvProblem and releasedRow", () => {
  test("the agent env must carry dxArmEnv, and none and lens set no session kind", () => {
    expect(armEnvProblem("autoplan", { ...dxArmEnv("autoplan"), X: "1" })).toBeNull();
    expect(armEnvProblem("plan-devex-review", { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" })).toMatch(/GSTACK_SESSION_KIND=unattended/);
    expect(armEnvProblem("none", { ...dxArmEnv("none"), GSTACK_SESSION_KIND: "unattended" })).toMatch(/sets GSTACK_SESSION_KIND/);
    expect(armEnvProblem("lens", { CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1" })).toMatch(/CLAUDE_CODE_DISABLE_1M_CONTEXT=1/);
  });
  test("a released session is one missing row under the code that released it", () => {
    const r = releasedRow({ id: "u:sol:autoplan:1", unit: "u", arm: "autoplan", model: "sol", pass: 1, stage: 1, smoke: true }, "E_DX_PROVIDER_DRIFT", "with gstack's stop gate");
    expect([r.end, r.code, r.session, r.repair, r.list]).toEqual(["missing", "E_DX_PROVIDER_DRIFT", "u:sol:autoplan:1", "with gstack's stop gate", null]);
  });
});

describe("stage1Open: one lease per frozen run, sized for the arms it runs", () => {
  test("s1-resmoke's lease is sized for the arms it reruns, not the design's default", () => {
    const two = stage1Open("s1-resmoke", ["plan-devex-review", "autoplan"], 2);
    if ("problem" in two) throw new Error(two.problem);
    const lease = (d: typeof FULL) => frozenRuns(d).find((r) => r.id === "s1-resmoke")!.lease_micros;
    expect(two.design.resmoke).toEqual(["plan-devex-review", "autoplan"]);
    expect(two.opened).toEqual(["s1-none", "s1-smoke"]);
    expect(lease(two.design)).toBeGreaterThan(lease(FULL));
    expect(stage1Open("s1-resmoke", ["autoplan"], 0)).toMatchObject({ problem: expect.stringMatching(/opens after s1-none and s1-smoke/) });
  });
});

describe("review-units --plan devex: the paid run's refusals", () => {
  const unitsDir = join(dir, "units");
  for (const id of units(16)) {
    mkdirSync(join(unitsDir, id, "repo"), { recursive: true });
    writeFileSync(join(unitsDir, id, "unit.json"), JSON.stringify({ id }));
    writeFileSync(join(unitsDir, id, "plan.md"), "Add an init command.\n");
    writeFileSync(join(unitsDir, id, "repo", "a.ts"), "export {};\n");
  }
  const pin = join(dir, "pin");
  mkdirSync(join(pin, "bin"), { recursive: true });
  mkdirSync(join(pin, ".git"), { recursive: true });
  writeFileSync(join(pin, "bin", "gstack-session-kind"), "#!/bin/sh\necho interactive\n");
  const fake = join(dir, "fake-git");
  mkdirSync(fake);
  writeFileSync(join(fake, "git"), "#!/bin/sh\necho " + DX_GSTACK.sha + "\n");
  chmodSync(join(fake, "git"), 0o755);
  const env = { GSTACK_EVALS_DX_PIN: pin, PATH: fake + ":/usr/bin:/bin" };
  const all = Object.values(MODEL_STRINGS);
  const go = async (extra: string[], e: Record<string, string> = env, arms = ["none"], u = ["--units", "all"], outDir = join(dir, "out-" + Math.random().toString(36).slice(2))) => {
    const err: string[] = [];
    const out: string[] = [];
    const code = await dxMain(["--plan", "devex", "--units-dir", unitsDir, ...u, "--models", ...all, "--out", outDir, "--arms", ...arms, ...extra], { out: (t) => void out.push(t), err: (t) => void err.push(t) }, e);
    return { code, err: err.join("\n"), out: out.join("\n") };
  };
  test("no --run: the loop runs only a named stage 1 run", async () => {
    const r = await go([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^E_USAGE review-units: .*session loop is not built/);
    expect(r.err).toContain("\n  fix: ");
    expect(r.err).not.toContain("GSTACK_EVALS_DX_PIN");
  });
  test("the pin guard comes first", async () => {
    const r = await go(["--run", "s1-none", "--passes", "3"], {});
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/GSTACK_EVALS_DX_PIN is not set/);
  });
  test("a stage 2 run, an unknown run and a parallelism past 8 are refused with a fix line", async () => {
    for (const [extra, want] of [[["--run", "s2-opus-1"], /stage 2/], [["--run", "s9"], /no stage 1 frozen run/], [["--run", "s1-none", "--passes", "3", "--parallel", "9"], /--parallel/]] as const) {
      const r = await go([...extra]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(want);
      expect(r.err).toContain("\n  fix: ");
    }
  });
  test("the flags must name the frozen run's own arms, models, passes and units", async () => {
    const passes = await go(["--run", "s1-none"]);
    expect(passes.err).toMatch(/s1-none runs 3 passes/);
    const arms = await go(["--run", "s1-none", "--passes", "3"], env, ["lens"]);
    expect(arms.err).toMatch(/s1-none runs arms none/);
    const smokeAll = await go(["--run", "s1-smoke"], env, ["lens", "plan-devex-review=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha, "autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha]);
    expect(smokeAll.err).toMatch(/draw order/);
    const repair = await go(["--run", "s1-smoke", "--repair", "double-limits"], env, ["lens", "plan-devex-review=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha, "autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha], ["--units", ...units(10)]);
    expect(repair.err).toMatch(/takes no --repair/);
    const resmoke = await go(["--run", "s1-resmoke"], env, ["autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha], ["--units", ...units(10)]);
    expect(resmoke.err).toMatch(/needs its repair/);
    for (const r of [passes, arms, smokeAll, repair, resmoke]) {
      expect(r.code).toBe(2);
      expect(r.err).toContain("\n  fix: ");
    }
  });
  test("a frozen run whose lease a session launched on is refused, and the next stage 1 run still opens", async () => {
    const t = mkdtempSync(join(dir, "rec-"));
    const record = join(t, "record");
    const ledger = join(t, "ledger.sqlite");
    const item = ITEMS.find((i) => i.id === "dx-s1-runs")!;
    recordApproval(record, { action: "init", item: item.id, cap_micros: item.cap_micros, quotes: [{ words: "a test record", by: "session.test.ts", source: "a test" }], admission: "warn" });
    let local = LocalLedger.open(ledger);
    const first = stage1Open("s1-none", ["none"], readItem(record, item.id).leases.length);
    if ("problem" in first) throw new Error(first.problem);
    const firstLease = openRun(record, local, { run: "s1-none", ...first, mdd: () => Number.POSITIVE_INFINITY }).lease_id!;
    markLaunched(record, firstLease, "c01:opus:none:1");
    settleLease(record, local, firstLease);
    local.close();
    const kept = mkdtempSync(join(homedir(), ".dx-session-test-"));
    const again = await go(["--run", "s1-none", "--passes", "3", "--record", record, "--ledger", ledger], env, ["none"], ["--units", "all"], join(kept, "out"));
    rmSync(kept, { recursive: true, force: true });
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/^E_USAGE review-units: the approval record already shows 1 lease on stage 1's item/);
    expect(again.err).toContain("\n  fix: run s1-smoke next");
    local = LocalLedger.open(ledger);
    const next = stage1Open("s1-smoke", ["lens", "plan-devex-review", "autoplan"], readItem(record, item.id).leases.length);
    if ("problem" in next) throw new Error(next.problem);
    expect(next.opened).toEqual(["s1-none"]);
    const smoke = openRun(record, local, { run: "s1-smoke", ...next, mdd: () => Number.POSITIVE_INFINITY });
    expect(smoke.admission.ok).toBe(true);
    expect(typeof smoke.lease_id).toBe("string");
    local.close();
  });
  const fresh = (name: string) => {
    const t = mkdtempSync(join(dir, name + "-"));
    const record = join(t, "record");
    const item = ITEMS.find((i) => i.id === "dx-s1-runs")!;
    recordApproval(record, { action: "init", item: item.id, cap_micros: item.cap_micros, quotes: [{ words: "a test record", by: "session.test.ts", source: "a test" }], admission: "warn" });
    return { record, ledger: join(t, "ledger.sqlite"), item: item.id };
  };
  const s1none = (r: { record: string; ledger: string }, out: string) => go(["--run", "s1-none", "--passes", "3", "--record", r.record, "--ledger", r.ledger], env, ["none"], ["--units", "all"], out);
  test("a lease that closes before any session launches on it is void, and its frozen run still opens (ruling 9, decision 17 as amended)", async () => {
    const r = fresh("void");
    const kept = mkdtempSync(join(homedir(), ".dx-session-test-"));
    const first = await s1none(r, join(kept, "out1"));
    const second = await s1none(r, join(kept, "out2"));
    rmSync(kept, { recursive: true, force: true });
    for (const x of [first, second]) {
      expect(x.code).toBe(2);
      expect(x.err).toMatch(/closed before any session launched on it with a bound attempt, so it is void and s1-none is not used up/);
    }
    const leases = readItem(r.record, r.item).leases;
    expect(leases.length).toBe(2);
    expect(leases.every((l) => l.close !== null && existsSync(join(r.record, "dx", "void", l.lease.lease_id + ".json")))).toBe(true);
    expect(stage1Runs(r.record, r.item)).toBe(0);
  });
  test("a second invocation is refused while one holds the item's lease lock, and a lease left open counts as its frozen run (ruling 9)", async () => {
    const r = fresh("lock");
    const lock = join(r.record, "dx", "dx-s1-runs.open-lock");
    mkdirSync(join(r.record, "dx"), { recursive: true });
    writeFileSync(lock, "{}\n");
    const kept = mkdtempSync(join(homedir(), ".dx-session-test-"));
    const locked = await s1none(r, join(kept, "out1"));
    expect(locked.code).toBe(2);
    expect(locked.err).toMatch(/E_USAGE review-units: another review-units invocation holds the lease lock .*dx-s1-runs\.open-lock/);
    expect(readItem(r.record, r.item).leases.length).toBe(0);
    rmSync(lock);
    const local = LocalLedger.open(r.ledger);
    const o = stage1Open("s1-none", ["none"], 0);
    if ("problem" in o) throw new Error(o.problem);
    openRun(r.record, local, { run: "s1-none", ...o, mdd: () => Number.POSITIVE_INFINITY });
    local.close();
    expect(stage1Runs(r.record, r.item)).toBe(1);
    const again = await s1none(r, join(kept, "out2"));
    rmSync(kept, { recursive: true, force: true });
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/^E_USAGE review-units: the approval record already shows 1 lease on stage 1's item/);
  });
  test("--repair double-limits beside an arm's own repair is refused under E_USAGE (ruling 8)", async () => {
    const r = await go(["--run", "s1-resmoke", "--repair", "double-limits", "--repair", "autoplan=gstack-stop-gate"], env, ["autoplan=" + DX_GSTACK.repo + "@" + DX_GSTACK.sha], ["--units", ...units(10)]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^E_USAGE review-units: --repair double-limits runs every arm at doubled limits, and --repair also names autoplan's own repair/);
    expect(r.err).toContain("\n  fix: ");
  });
  test("the dry run prints what it printed before, and needs no pin", async () => {
    const r = await go(["--dry-run"], {});
    expect(r.code).toBe(0);
    expect(r.out).toContain("review-units dry run: nothing is built under --out, written or spent");
    expect(r.out).toContain("mounts: ok;");
  });
});

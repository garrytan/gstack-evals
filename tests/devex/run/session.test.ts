// Copyright (c) 2026 Garry Tan. MIT License.
// The devex paid session path's keyless parts (prereg 2026-11-09-geva-417, sections 5, 6, 10 and 14): each stage 1 frozen
// run's plan, the arm env check, released rows, and review-units --plan devex's paid refusals, each with a fix line.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { armEnvProblem, dxPlan, releasedRow } from "../../../lanes/devex/run/session.ts";
import { SMOKE } from "../../../lanes/devex/leases.ts";
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
  const go = async (extra: string[], e: Record<string, string> = env, arms = ["none"], u = ["--units", "all"]) => {
    const err: string[] = [];
    const out: string[] = [];
    const code = await dxMain(["--plan", "devex", "--units-dir", unitsDir, ...u, "--models", ...all, "--out", join(dir, "out-" + Math.random().toString(36).slice(2)), "--arms", ...arms, ...extra], { out: (t) => void out.push(t), err: (t) => void err.push(t) }, e);
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
  test("the dry run prints what it printed before, and needs no pin", async () => {
    const r = await go(["--dry-run"], {});
    expect(r.code).toBe(0);
    expect(r.out).toContain("review-units dry run: nothing is built under --out, written or spent");
    expect(r.out).toContain("mounts: ok;");
  });
});

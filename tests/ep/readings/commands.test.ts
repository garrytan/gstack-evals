import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../lanes/eng-planted/cli.ts";
import { fxBuild, fxReview, fxUnit, fxWorld } from "../../../lanes/eng-planted/readings/fixtures.ts";
import type { GoldRow } from "../../../lanes/eng-planted/readings/judge.ts";

const dir = mkdtempSync(join(tmpdir(), "ep-readings-"));
const file = (name: string, data: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
};
async function ep(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const pilotFile = (good: number, n = 20) => {
  const units = Array.from({ length: n }, (_, i) => fxUnit(i, 1, 1, { pilot: true }));
  const builds = units.flatMap((u, i) => [1, 2].map((rep) => fxBuild(u, "plain", rep, { pass: i < good ? 1 : 0, catch: i < good, pilot: true })));
  const none = units.map((u, i) => fxBuild(u, "none", 1, { pass: i % 2, catch: true }));
  return { units, builds: [...builds, ...none], seed: 5 };
};

describe("gstack-evals ep, readings part", () => {
  test("pilot reads HEADROOM, prints the primary and writes the power input", async () => {
    const power = join(dir, "power.json");
    const r = await ep("pilot", "--in", file("p1.json", pilotFile(10)), "--draws", "2000", "--power-json", power);
    expect(r.code).toBe(0);
    expect(r.out).toContain("primary composite");
    expect(JSON.parse(readFileSync(power, "utf8")).builds).toHaveLength(40);
  });
  test("pilot stops with the code's lines on stderr; a first ceiling needs the raise inputs, then prints the projection", async () => {
    const floor = await ep("pilot", "--in", file("p2.json", pilotFile(1)), "--draws", "2000");
    expect(floor.code).toBe(2);
    expect(floor.err.split("\n").every((l) => l.startsWith("E_EP_FLOOR "))).toBe(true);
    const missing = await ep("pilot", "--in", file("p3.json", pilotFile(18)), "--draws", "2000");
    expect(missing.err).toStartWith("E_USAGE");
    const raise = await ep("pilot", "--in", file("p4.json", { ...pilotFile(18), raise: { authored: 30, admitted: 20, unused: 300, perCandidateUsd: 6, perReadUsd: 3.5 } }), "--draws", "2000");
    expect(raise.code).toBe(2);
    expect(raise.err).toContain("E_EP_RAISE");
    expect(raise.err).toContain("hard rate 0.500 (10 of 20)");
  });
  test("pilot needs a seed", async () => {
    const { seed: _seed, ...rest } = pilotFile(10);
    expect((await ep("pilot", "--in", file("p5.json", rest))).err).toStartWith("E_USAGE gstack-evals ep pilot: --seed is required");
    expect((await ep("pilot", "--in", file("p6.json", rest), "--seed", "3", "--draws", "2000")).code).toBe(0);
  });
  test("raise, exposure, start and supply", async () => {
    expect((await ep("raise", "--in", file("r1.json", { ...pilotFile(18, 16), hardAdmitted: 40 }), "--draws", "2000")).err).toStartWith("E_EP_CEILING");
    const smoke = (["standalone", "engphase"] as const).flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => fxReview("c" + i, arm, 1, arm === "engphase" || i > 2)));
    const ex = await ep("exposure", "--in", file("x1.json", { smoke }));
    expect(ex.code).toBe(2);
    expect(ex.out).toContain("smoke engphase on opus: exposed 6 of 6");
    expect(ex.err).toStartWith("E_EP_EXPOSURE_GATE");
    expect((await ep("start", "--mdd", "0.13")).err).toStartWith("E_EP_START_RULE");
    expect((await ep("start", "--mdd", "0.11")).code).toBe(0);
    expect((await ep("admitted", "--admitted", "39")).err).toStartWith("E_EP_SUPPLY_SHORT");
    expect((await ep("admitted", "--admitted", "nope")).err).toStartWith("E_USAGE");
  });
  test("--run writes the exposure-gate, admission and start-rule records the stages part reads", async () => {
    const run = mkdtempSync(join(tmpdir(), "ep-run-"));
    const step = (s: string) => JSON.parse(readFileSync(join(run, "steps", s + ".json"), "utf8")) as { step: string; ok: boolean; detail: string; arms?: string[] };
    const smoke = (["standalone", "engphase"] as const).flatMap((arm) => [1, 2, 3, 4, 5, 6].map((i) => fxReview("c" + i, arm, 1, arm === "engphase" || i > 2)));
    expect((await ep("exposure", "--in", file("x2.json", { smoke }), "--run", run)).err).toStartWith("E_EP_EXPOSURE_GATE");
    expect(step("exposure-gate")).toMatchObject({ step: "exposure-gate", ok: true, arms: ["engphase"] });
    expect((await ep("exposure", "--in", file("x3.json", { smoke }), "--reviewer", "sol", "--run", run)).err).toStartWith("E_USAGE");
    expect((await ep("pilot", "--in", file("p7.json", pilotFile(10)), "--draws", "2000", "--run", run)).code).toBe(0);
    expect(step("admission")).toMatchObject({ step: "admission", ok: true });
    expect((await ep("pilot", "--in", file("p8.json", pilotFile(1)), "--draws", "2000", "--run", run)).code).toBe(2);
    expect(step("admission")).toMatchObject({ step: "admission", ok: false });
    expect((await ep("start", "--mdd", "0.13", "--run", run)).code).toBe(2);
    expect(step("start-rule").ok).toBe(false);
    expect((await ep("start", "--mdd", "0.11", "--run", run)).code).toBe(0);
    expect(step("start-rule")).toMatchObject({ step: "start-rule", ok: true });
  });
  test("analyze prints the readout from records", async () => {
    const w = fxWorld(10, 1, 1, { standalone: () => ({ pass: 1 }), engphase: () => ({ pass: 0 }) }, { draws: 2000 });
    const r = await ep("analyze", "--in", file("a1.json", w), "--draws", "2000");
    expect(r.code).toBe(0);
    expect(r.out).toContain("arm standalone public headline");
  });
  test("kappa checks the judge against gold and the stock control", async () => {
    const gold: GoldRow[] = Array.from({ length: 48 }, (_, i) => ({ key: "g" + i, unit: "u" + i, source: "plain", judge: i % 3 === 0, labels: [i % 3 === 0, i % 3 === 0], settled: null }));
    expect((await ep("kappa", "--in", file("k1.json", { gold }))).out).toContain("judge check passes");
    const b = (unit: string, source: string, named: boolean) => ({ unit, source, words: 1, quotes: [], named, sections: [] });
    const revise = await ep("kappa", "--in", file("k2.json", { gold, bundles: [b("u1", "stock", true), b("u1", "plan", false)] }));
    expect(revise.code).toBe(1);
    expect(revise.out).toContain("the one frozen rubric revision runs");
    expect((await ep("kappa", "--in", file("k3.json", { gold, bundles: [b("u1", "stock", true), b("u1", "plan", false)] }), "--revision", "1")).err).toStartWith("E_EP_JUDGE_CHECK");
    const bad = gold.map((g, i) => (i < 20 ? { ...g, judge: !g.judge } : g));
    expect((await ep("kappa", "--in", file("k4.json", { gold: bad }))).err).toStartWith("E_EP_JUDGE_CHECK");
  });
});

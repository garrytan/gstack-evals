import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holm, loadRun, runD, runT, signFlip, t1Verdict, zeroBound } from "../analysis/discovery-tax.ts";
import { scenarios } from "./discovery-tax.fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "discovery-tax-"));
const cfgs = scenarios(root) as Record<string, any>;
const d = loadRun(cfgs["run-d"]);
const dLines = runD(d.recs, cfgs["run-d"]).join("\n");
const t = (name: string) => runT(loadRun(cfgs[name]).recs, cfgs[name]).join("\n");

describe("section 7 scoring rows", () => {
  const at = (model: string, arm: string, task: string) => d.recs.filter((r) => r.model === model && r.label === arm && r.task === task);
  test("reward 1 passes, reward 0 fails, both eligible", () => {
    expect(at("m-claim", "none", "t06")[0]).toMatchObject({ status: "graded", pass: 1, eligible: true });
    expect(at("m-claim", "none", "t07")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true });
  });
  test("no reward after a response (agent timeout) fails and is eligible; a session-cap stop is graded as it stands", () => {
    expect(at("m-claim", "none", "t11")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true, agentTimeout: true });
    expect(at("m-claim", "placebo", "t11")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true, budgetStop: true });
  });
  test("a refused first request fails, is not eligible and is counted", () => {
    expect(at("m-gate", "none", FIRST)[0]).toMatchObject({ status: "graded", pass: 0, refused: true, eligible: false });
  });
  test("no model response is an infrastructure trial: missing, out of both rates", () => {
    expect(at("m-claim", "gstack", "t11")[0]).toMatchObject({ status: "missing", eligible: false });
  });
  test("a rerun after a response is graded on the rerun and counted", () => {
    expect(at("m-claim", "none", "t12")[0]).toMatchObject({ status: "graded", retried: true, pass: 1 });
  });
  test("a task dropped by the oracle rule leaves the whole run, with its spend reported", () => {
    expect(d.recs.some((r) => r.task === "dropped-task")).toBe(false);
    expect(d.dropped).toEqual([{ task: "dropped-task", trials: 2, usd: 0.04 }]);
  });
  test("opens, loads through Read's numbered lines, browses and plugin-authoring opens", () => {
    const r = at("m-claim", "gstack", FIRST)[0]!;
    expect(r.opens).toEqual(["investigate"]);
    expect(r.loaded).toEqual(["investigate"]);
    const rw = at("m-claim", "gstack-rewritten", "t11")[0]!;
    expect([rw.builtinOpens["plugin-authoring"], rw.builtinOpens.doctor, rw.browses, rw.opens.length]).toEqual([1, 0, 1, 0]);
  });
});
const FIRST = "custom-memory-heap-crash";

describe("Run D claims", () => {
  test("D1 claim, exact zero bound, upper-bound wording, D2 raised, and the eligibility gate", () => {
    expect(dLines).toMatch(/## m-claim[\s\S]*D1 claim: opened an untold gstack skill in/);
    expect(dLines).toMatch(/## m-zero[\s\S]*exact one-sided 95% upper bound 7\.8%[\s\S]*D1 claim: fewer than 7\.8%[\s\S]*D2 claim: the rewritten description raised opens/);
    expect(dLines).toMatch(/## m-sparse[\s\S]*D1 claim: fewer than \d[\s\S]*D2 no claim/);
    expect(dLines).toMatch(/## m-gate[\s\S]*Gate: a cell is under 90% eligible[\s\S]*D1 no claim \(gate\)/);
    expect(dLines).toContain("Listing check: passed for every arm.");
  });
});

describe("Run D, frozen layout (preset primary, sdk-default contrast, pooled D2 and D3)", () => {
  const f = loadRun(cfgs["run-d-factor"]);
  const s = runD(f.recs, cfgs["run-d-factor"]).join("\n");
  test("cells are labelled arm@system_prompt from each trial's kwargs", () => {
    const labels = new Set(f.recs.map((r) => r.label));
    expect([...labels].sort()).toEqual(["gstack-rewritten@claude-code-preset", "gstack-rewritten@sdk-default", "gstack@claude-code-preset", "gstack@sdk-default", "none@claude-code-preset", "none@sdk-default", "placebo@claude-code-preset"]);
    expect(s).toMatch(/^m-claim gstack@claude-code-preset: graded/m);
    expect(s).toMatch(/^m-zero none@sdk-default: graded/m);
  });
  test("per-model D2 rows are exploratory with their MDD, and the pooled D2 is the claim, over the models that pass the gate", () => {
    expect(s).toMatch(/## m-zero[\s\S]*D2 \(rewritten minus pooled\), exploratory: .* unadjusted; MDD 25 points \(section 11\); no claim/);
    expect(s).not.toMatch(/^D2 claim/m);
    expect(s).toMatch(/D2 pooled over 3 models \(m-claim, m-zero, m-sparse\); left out by the gate or missing: m-gate: .*MDD 9 points/);
    expect(s).toMatch(/^D2 pooled claim: the rewritten description raised opens by \+\d+\.\d points, pooled across models$/m);
    expect(s).toMatch(/^Beside D2, no gstack \(pooled over the same models\): gstack@claude-code-preset minus none@claude-code-preset, pass/m);
    const few = runD(f.recs, { ...cfgs["run-d-factor"], models: ["m-claim", "m-gate"] }).join("\n");
    expect(few).toContain("D2 pooled no claim (fewer than 2 models)");
    const two = runD(f.recs, { ...cfgs["run-d-factor"], models: ["m-claim", "m-zero"] }).join("\n");
    expect(two).toMatch(/^D2 pooled claim: /m);
  });
  test("D3: preset minus sdk-default on gstack, per-model exploratory and pooled primary, with no gstack beside it", () => {
    expect(s).toMatch(/^D3 m-claim, exploratory: \+61\.1 .* MDD 27 points \(section 11\); no claim$/m);
    expect(s).toMatch(/^D3 m-zero, exploratory: \+0\.0 /m);
    expect(s).toMatch(/^D3 pooled over m-claim, m-zero: \+\d+\.\d .*MDD 15 points \(section 11\); claim: claude-code-preset raised opens by \+\d+\.\d points, pooled$/m);
    expect(s).toMatch(/^Beside D3, no gstack \(pooled over m-claim, m-zero\): gstack@claude-code-preset minus none@claude-code-preset, pass .*; gstack@sdk-default minus none@sdk-default, pass/m);
    const one = runD(f.recs, { ...cfgs["run-d-factor"], contrast: { setting: "sdk-default", models: ["m-claim"] }, d3: "per-model" }).join("\n");
    expect(one).toMatch(/^D3 m-claim: \+61\.1 .*Holm .*; MDD 27 points \(section 11\); claim: claude-code-preset raised opens by \+61\.1 points$/m);
  });
  test("sdk-default cells get their own secondary block; built-in opens and turn-cap stops are counted per cell", () => {
    expect(s).toMatch(/### m-claim under sdk-default \(secondary\)[\s\S]*D1 under sdk-default \(gstack alone, eligible\): 0 opened of 37 trials[\s\S]*D2 under sdk-default \(rewritten minus gstack\): \+\d/);
    expect(s).not.toContain("### m-sparse under");
    expect(s).toMatch(/^m-claim none@claude-code-preset: .*turn-cap stops \(error_max_turns\) 1;/m);
    expect(s).toMatch(/^none@claude-code-preset: .*built-in opens doctor 1, plugin-authoring 0, opened any listed skill 2\.7%/m);
    expect(f.recs.find((r) => r.model === "m-claim" && r.label === "none@claude-code-preset" && r.task === "t13")).toMatchObject({ turnCap: true, eligible: true, status: "graded", opens: [] });
  });
});

describe("Run D gates and replicates (GEVA-139: replicate 1 for D1 and D2, completeness, MDD by pooled model count)", () => {
  const g = cfgs["run-d-gates"];
  const gr = loadRun(g);
  const s = runD(gr.recs, g).join("\n");
  const fs = runD(loadRun(cfgs["run-d-factor"]).recs, cfgs["run-d-factor"]).join("\n");
  const block = (out: string, m: string) => out.split(`## ${m}\n`)[1]!.split("\n## ")[0]!;
  const line = (out: string, m: string, re: RegExp) => block(out, m).match(re)?.[0];
  test("the second replicate's job is tagged replicate 2; every other trial is replicate 1", () => {
    expect(gr.recs.filter((r) => r.replicate === 2).length).toBe(74);
    expect(gr.recs.filter((r) => r.replicate === 2).every((r) => r.model === "m-claim" && r.label.startsWith("gstack@"))).toBe(true);
    expect(d.recs.every((r) => r.replicate === 1)).toBe(true);
  });
  test("D1 and D2 read replicate 1 only: m-claim's D1 and per-model D2 match the run without the second replicate", () => {
    const d1 = /^D1 \(gstack and placebo pooled, eligible\): .*$/m;
    expect(line(s, "m-claim", d1)).toBe(line(fs, "m-claim", d1)!);
    expect(line(s, "m-claim", d1)).toMatch(/opened of 73 trials/);
    const d2 = /^D2 \(rewritten minus pooled\), exploratory: .* unadjusted/m;
    expect(line(s, "m-claim", d2)).toBe(line(fs, "m-claim", d2)!);
    expect(s).toMatch(/^m-claim gstack@claude-code-preset: graded 36, missing 1,/m);
  });
  test("D3 reads both replicates of its two cells, with its completeness beside it", () => {
    expect(s).toMatch(/^D3 m-claim: \+81\.1 \[[^\]]+\] pp over 37 tasks, .*; MDD 10\.9 to 15\.4 points \(section 11\); claim: claude-code-preset raised opens by \+81\.1 points$/m);
    expect(s).toContain("Completeness beside D3 (tasks graded of 37, both replicates): m-claim gstack@claude-code-preset 37 (73 trials), gstack@sdk-default 37 (74 trials)");
  });
  test("a model whose preset cells a ledger stop left partial is flagged and leaves pooled D2, though every graded trial is eligible", () => {
    expect(block(s, "m-partial")).toContain("Completeness (tasks graded of 37): none@claude-code-preset 37, gstack@claude-code-preset 25, gstack-rewritten@claude-code-preset 25, placebo@claude-code-preset 25");
    expect(block(s, "m-partial")).toMatch(/Gate: a cell is graded on fewer than 90% of the run's 37 tasks; flagged, no D1 or D2 claim for this model\.[\s\S]*D1 no claim \(gate\)/);
    expect(block(s, "m-partial")).not.toContain("under 90% eligible");
    expect(block(s, "m-claim")).toContain("Completeness (tasks graded of 37): none@claude-code-preset 37, gstack@claude-code-preset 36, gstack-rewritten@claude-code-preset 37, placebo@claude-code-preset 37");
    expect(s).toMatch(/^D2 pooled over 2 models \(m-claim, m-zero\); left out by the gate or missing: m-partial: .*; MDD 10\.8 to 13\.0 points \(section 11\)$/m);
    expect(s).toContain("Gates beside pooled D2 (every preset cell at least 90% eligible and graded on at least 90% of the run's 37 tasks): m-claim in; m-zero in; m-partial out (graded on fewer than 90% of tasks: gstack@claude-code-preset 25, gstack-rewritten@claude-code-preset 25, placebo@claude-code-preset 25)");
    expect(fs).toContain("m-gate out (under 90% eligible: none@claude-code-preset)");
  });
  test("the pooled D2 MDD is keyed by the number of models pooled", () => {
    const keyed = { ...cfgs["run-d-factor"], mdd: { ...g.mdd } };
    expect(runD(loadRun(keyed).recs, keyed).join("\n")).toMatch(/^D2 pooled over 3 models \(m-claim, m-zero, m-sparse\);.*; MDD 7\.5 to 10\.3 points \(section 11\)$/m);
    expect(s).not.toMatch(/MDD 7\.5 to 10\.3/);
  });
  test("a forgotten replicate_2_jobs key is refused, and so is one naming a job the run does not list", () => {
    const forgot = { ...g, replicate_2_jobs: [] };
    expect(() => runD(loadRun(forgot).recs, forgot)).toThrow(/^E_USAGE two replicate-1 trials of m-claim gstack@claude-code-preset on /);
    expect(() => loadRun({ ...g, replicate_2_jobs: [join(root, "jobs-elsewhere")] })).toThrow(/^E_USAGE replicate_2_jobs names /);
  });
});

describe("Run T claims", () => {
  test("T1 confirmed (not smaller than the lead), T2 cost and raised claims", () => {
    const s = t("run-t-confirmed");
    expect(s).toMatch(/T1 \(placebo minus none\).*verdict confirmed$/m);
    expect(s).toMatch(/## claude-haiku-5-5[\s\S]*claim: longer told text cost passes/);
    expect(s).toMatch(/## deepseek-v4\.1-flash-1017[\s\S]*claim: longer told text raised passes/);
  });
  test("T1 reversed, and the body-load gate blocks claims", () => {
    const s = t("run-t-reversed");
    expect(s).toMatch(/verdict reversed, smaller than the lead/);
    expect(s).toMatch(/## deepseek-v4\.1-flash-1017[\s\S]*Gate: body load under 95% in placebo[\s\S]*no claim \(gate\)/);
  });
  test("T1 not confirmed and smaller than the lead; no T2 claim", () => {
    const s = t("run-t-not-confirmed");
    expect(s).toMatch(/verdict not confirmed, smaller than the lead/);
    expect(s).not.toContain("claim: longer");
  });
  test("labels are fixed: confirmed, reversed, not confirmed, smaller than the lead", () => {
    expect(t1Verdict({ lo: -0.2, hi: -0.01 })).toEqual({ verdict: "confirmed", smallerThanLead: false });
    expect(t1Verdict({ lo: 0.01, hi: 0.2 })).toEqual({ verdict: "reversed", smallerThanLead: true });
    expect(t1Verdict({ lo: -0.05, hi: 0.03 })).toEqual({ verdict: "not confirmed", smallerThanLead: true });
  });
});

describe("Run T sensitivities", () => {
  test("every pass-rate contrast, T2's placebo minus placebo-short included, reports stops, complete case and the retried reading for every model", () => {
    const s = t("run-t-confirmed");
    const row = (pair: string) => new RegExp(`^${pair}: pass [+-]\\d+\\.\\d \\[[^\\]]+\\] pp; session-cap stop rate [+-]\\d+\\.\\d \\[[^\\]]+\\] pp; complete case \\(descriptive\\) [+-]\\d+\\.\\d \\[[^\\]]+\\] pp; retried-after-response scored 0 [+-]\\d+\\.\\d \\[[^\\]]+\\] pp$`, "m");
    for (const m of ["particle-1", "claude-haiku-5-5", "deepseek-v4.1-flash-1017"]) {
      const block = s.split(`## ${m}\n`)[1]!.split("\n## ")[0]!;
      for (const pair of ["placebo minus none", "placebo-short minus none", "placebo minus placebo-short"]) expect(block).toMatch(row(pair));
    }
    expect(s).toContain("placebo minus placebo-short: pass -78.4 [-91.9, -64.9] pp; session-cap stop rate +13.5 [+2.7, +24.3] pp; complete case (descriptive) -78.1 [-90.6, -62.5] pp;");
  });
  test("the retried reading of placebo minus placebo-short scores a rerun after a response as 0", () => {
    const cfg = cfgs["run-t-confirmed"];
    let k = 0;
    const recs = loadRun(cfg).recs.map((r) => (r.model === "particle-1" && r.label === "placebo-short" && k++ < 10 ? { ...r, retried: true } : r));
    const s = runT(recs, cfg).join("\n");
    expect(s).toContain("placebo minus placebo-short: pass -78.4 [-91.9, -64.9] pp; session-cap stop rate +13.5 [+2.7, +24.3] pp; complete case (descriptive) -78.1 [-90.6, -62.5] pp; retried-after-response scored 0 -51.4 [");
    expect(s).toContain("placebo minus none: pass -78.4 [-91.9, -64.9] pp; session-cap stop rate +13.5 [+2.7, +24.3] pp; complete case (descriptive) -78.1 [-90.6, -62.5] pp; retried-after-response scored 0 -78.4 [");
  });
});

describe("statistics", () => {
  test("zero-count bound, Holm, and the seeded sign-flip test", () => {
    expect(zeroBound(37)).toBeCloseTo(0.0778, 4);
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(signFlip([0, 0, 0])).toBe(1);
    expect(signFlip(Array(20).fill(1), 10_000)).toBeLessThan(0.001);
    expect(signFlip([1, -1, 1, 0.5], 10_000)).toBe(signFlip([1, -1, 1, 0.5], 10_000));
  });
});

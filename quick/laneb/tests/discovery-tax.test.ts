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
    expect(at("m-claim", "none", "t07")[0]).toMatchObject({ status: "graded", pass: 1, eligible: true });
    expect(at("m-claim", "none", "t06")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true });
  });
  test("no reward after a response (agent timeout) fails and is eligible; a session-cap stop is graded as it stands", () => {
    expect(at("m-claim", "none", "t15")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true, agentTimeout: true });
    expect(at("m-claim", "placebo", "t15")[0]).toMatchObject({ status: "graded", pass: 0, eligible: true, budgetStop: true });
  });
  test("a refused first request fails, is not eligible and is counted", () => {
    expect(at("m-gate", "none", FIRST)[0]).toMatchObject({ status: "graded", pass: 0, refused: true, eligible: false });
  });
  test("no model response is an infrastructure trial: missing, out of both rates", () => {
    expect(at("m-claim", "gstack", "t15")[0]).toMatchObject({ status: "missing", eligible: false });
  });
  test("a rerun after a response is graded on the rerun and counted", () => {
    expect(at("m-claim", "none", "t16")[0]).toMatchObject({ status: "graded", retried: true, pass: 1 });
  });
  test("a task dropped by the oracle rule leaves the whole run, with its spend reported", () => {
    expect(d.recs.some((r) => r.task === "dropped-task")).toBe(false);
    expect(d.dropped).toEqual([{ task: "dropped-task", trials: 2, usd: 0.04 }]);
  });
  test("opens, loads through Read's numbered lines, browses and plugin-authoring opens", () => {
    const r = at("m-claim", "gstack", FIRST)[0]!;
    expect(r.opens).toEqual(["investigate"]);
    expect(r.loaded).toEqual(["investigate"]);
    const rw = at("m-claim", "gstack-rewritten", "t15")[0]!;
    expect([rw.pluginOpens, rw.browses, rw.opens.length]).toEqual([1, 1, 0]);
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

describe("statistics", () => {
  test("zero-count bound, Holm, and the seeded sign-flip test", () => {
    expect(zeroBound(37)).toBeCloseTo(0.0778, 4);
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(signFlip([0, 0, 0])).toBe(1);
    expect(signFlip(Array(20).fill(1), 10_000)).toBeLessThan(0.001);
    expect(signFlip([1, -1, 1, 0.5], 10_000)).toBe(signFlip([1, -1, 1, 0.5], 10_000));
  });
});

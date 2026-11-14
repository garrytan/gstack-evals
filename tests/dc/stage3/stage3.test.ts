// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3 on invented fixtures in a fake Ubicloud: the key-check and scenario counting rules, unit selection, the build
// arms and their retries, measures with their unavailable reads, DES-4, the readout and the KEEP flag.
import { describe, expect, test } from "bun:test";
import { DcError } from "../../../lanes/design-constructed/errors.ts";
import { armBlock, buildPrompt, servesEvery } from "../../../lanes/design-constructed/stage3/build.ts";
import { armReads, authored, fixtureStage3, reads, unit } from "../../../lanes/design-constructed/stage3/fixtures.ts";
import { armFirst, buildValues, missingScenarios, instrument, keepFlags, readout, type BuildRecord, type PairRow, type Values } from "../../../lanes/design-constructed/stage3/measures.ts";
import { runStage3 } from "../../../lanes/design-constructed/stage3/run.ts";
import { accepted, countValidation, selectUnits } from "../../../lanes/design-constructed/stage3/units.ts";
import type { CheckRun } from "../../../lanes/design-constructed/stage3/build.ts";
import { BUILD_PROMPT, GENERIC_LOOK_BLOCK } from "../../../lanes/design-constructed/frozen.ts";

const ok = (o: Parameters<typeof reads>[0] = {}): CheckRun => ({ serves: true, failedStep: null, reads: reads(o) });
const all = () => accepted(authored(), { fixtures: true, keyChecks: { k1: true, k2: true, k3: true }, scenarios: { s1: true, s2: true, s3: true } });

describe("key-check and scenario counting", () => {
  test("a key check counts only when it passes on both oracle builds", () => {
    const v = countValidation("u01", all(), [ok({ keyChecks: { k1: true, k2: true, k3: false } }), ok({ keyChecks: { k1: true, k2: false, k3: true } })]);
    expect(v.validated.map((k) => k.id)).toEqual(["k1"]);
    expect(v.qualifies).toBe(true);
  });
  test("a scenario counts when the agent user completes it on one oracle build", () => {
    const one = (done: string[]) => ok({ agentUser: ["s1", "s2", "s3"].map((s) => ({ scenario: s, completed: done.includes(s), steps: 5, failedActions: 0, consoleErrors: 0, deadEnds: 0 })) });
    const v = countValidation("u01", all(), [one(["s1", "s2"]), one(["s3"])]);
    expect(v.scenarios.length).toBe(3);
    const short = countValidation("u01", all(), [one(["s1"]), one(["s1", "s2"])]);
    expect([short.qualifies, short.why]).toEqual([false, "only 2 of 3 scenarios completed on an oracle build"]);
  });
  test("an oracle build that never serves passes no key check", () => {
    const v = countValidation("u01", all(), [ok(), { serves: false, failedStep: "build", reads: null }]);
    expect([v.validated.length, v.qualifies]).toEqual([0, false]);
  });
  test("Sol's audit drops what it rejects; an H check and a second check on one item never count", () => {
    const a = authored();
    a.keyChecks.push({ id: "k4", item: "i1", class: "R", body: null }, { id: "k5", item: "i5", class: "H" as "S", body: null });
    const acc = accepted(a, { fixtures: true, keyChecks: { k1: true, k2: false, k3: true, k4: true, k5: true }, scenarios: { s1: true, s2: true, s3: false } });
    expect(acc.keyChecks.map((k) => k.id)).toEqual(["k1", "k3"]);
    expect(acc.scenarios.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("unit selection", () => {
  test("two oracle builds per unit, one at a time, each at the $30 reserve", async () => {
    const f = fixtureStage3();
    const sel = await selectUnits([f.candidate(unit(1))], f.select);
    expect(sel.units.length).toBe(1);
    const log = f.money.log.filter((l) => /oracle|^settle/.test(l));
    expect(log.slice(0, 4)).toEqual(["admit oracle build 1 u01", "settle s1 1.50", "admit oracle build 2 u01", "settle s2 1.50"]);
  });
  test("at most one unit per base app, in draw order", async () => {
    const f = fixtureStage3();
    const sel = await selectUnits([f.candidate(unit(2, "a")), f.candidate(unit(1, "a")), f.candidate(unit(3, "b"))], f.select);
    expect(sel.units.map((u) => u.candidate.unit.id)).toEqual(["u01", "u03"]);
    expect(sel.skippedBaseApp).toEqual(["u02"]);
  });
  test("fewer than 8 qualifying units: stage 3 doesn't run and its items are released; 8 runs", async () => {
    const f = fixtureStage3({ reads: (l) => (/u0[89]|u1/.test(l) ? reads({ keyChecks: { k1: false, k2: false, k3: false } }) : reads()) });
    const seven = await selectUnits(Array.from({ length: 10 }, (_, i) => f.candidate(unit(i + 1))), f.select);
    expect([seven.units.length, seven.runs]).toEqual([7, false]);
    expect(f.money.log.filter((l) => l.startsWith("release")).length).toBe(3);
    const g = fixtureStage3();
    const eight = await selectUnits(Array.from({ length: 8 }, (_, i) => g.candidate(unit(i + 1))), g.select);
    expect([eight.units.length, eight.runs]).toEqual([8, true]);
    expect(g.money.log.some((l) => l.startsWith("release"))).toBe(false);
  });
  test("selection stops at 16 units, or 12 under the cut order", async () => {
    const f = fixtureStage3();
    const cs = Array.from({ length: 18 }, (_, i) => f.candidate(unit(i + 1)));
    expect((await selectUnits(cs, f.select)).units.length).toBe(16);
    expect((await selectUnits(cs, fixtureStage3().select, 12)).units.length).toBe(12);
  });
  test("a refused oracle admission is a cap stop that ends selection", async () => {
    const f = fixtureStage3({ caps: { "dc-stage3-authoring": 45 }, spentUsd: 10 });
    const sel = await selectUnits(Array.from({ length: 3 }, (_, i) => f.candidate(unit(i + 1))), f.select);
    expect(sel.capStop?.item).toBe("dc-stage3-authoring");
    expect(sel.units.length).toBe(1);
  });
});

describe("build arms", () => {
  test("six arms; a review arm with no Opus block doesn't build; the generic-look control gets the frozen block", () => {
    expect(armBlock("no-review", () => "x")).toEqual({ builds: true, block: null });
    expect(armBlock("generic-look", () => null)).toEqual({ builds: true, block: GENERIC_LOOK_BLOCK });
    expect(armBlock("lens", () => null)).toEqual({ builds: false, block: null });
    expect(buildPrompt(null)).toBe(BUILD_PROMPT);
    expect(buildPrompt("1. x")).toBe(BUILD_PROMPT + "\n\n1. x");
  });
  test("every route must answer below 400", () => {
    expect(servesEvery("200\n302\n", ["/a", "/b"])).toBe(true);
    expect(servesEvery("200\n000\n", ["/a", "/b"])).toBe(false);
    expect(servesEvery("200\n", ["/a", "/b"])).toBe(false);
  });
});

const stage3 = async (s: Parameters<typeof fixtureStage3>[0], n = 8) => {
  const f = fixtureStage3(s);
  const units = Array.from({ length: n }, (_, i) => unit(i + 1));
  const sel = await selectUnits(units.map(f.candidate), f.select);
  return { f, sel, r: await runStage3(sel, f.deps(units)) };
};
const at = (r: Awaited<ReturnType<typeof runStage3>>, u: string, arm: string) => r.builds.find((b) => b.unit === u && b.arm === arm)!;
const val = (r: Awaited<ReturnType<typeof runStage3>>, u: string, arm: string) => r.values.get(u)![arm as "none"]!;

describe("stage 3 runs", () => {
  test("rounds of 2 builds admitted at $60, retries inside the round", async () => {
    const { f, r } = await stage3({ reads: (l) => armReads(l) }, 8);
    expect(r.builds.filter((b) => b.state === "measured").length).toBe(48);
    const rounds = f.money.log.filter((l) => l.startsWith("admit stage 3 builds"));
    expect(rounds.length).toBe(24);
    expect(rounds[0]).toBe("admit stage 3 builds u01 no-review, u01 none");
  });
  test("a build that never serves: measure 1 and completion 0, every render read unavailable", async () => {
    const { r } = await stage3({ serves: (l) => l !== "build u01 lens", reads: (l) => armReads(l) });
    const v = val(r, "u01", "lens");
    expect([v.serves, v.completion, v.axe, v.forcedMechanical, v.keyCheckRecurrence, v.literals, v.des4]).toEqual([0, 0, null, null, null, null, null]);
    expect(r.lines.some((l) => l.startsWith("render reads unavailable (the build never serves): 1 builds"))).toBe(true);
  });
  test("forced states are unavailable, never zero, when the screen doesn't read the data source", async () => {
    const { r } = await stage3({ reads: (l) => armReads(l, l === "build u02 none" ? { readsDataSource: false } : {}) });
    expect([val(r, "u02", "none").forcedMechanical, val(r, "u02", "none").forcedAstra]).toEqual([null, null]);
    expect(val(r, "u02", "lens").forcedMechanical).toBe(1);
  });
  test("an own-limit stop gets one fresh retry measured as it stands; a failure outside the agent one J1 retry, then missing", async () => {
    const { r, f } = await stage3({ end: (l) => (l === "build u01 none" ? "own-limit" : l === "build u01 lens" ? "infra-once" : l === "build u01 autoplan" ? "infra" : "completed"), reads: (l) => armReads(l) });
    expect([at(r, "u01", "none").state, at(r, "u01", "none").retried, at(r, "u01", "none").ownLimit]).toEqual(["measured", "own-limit", true]);
    expect([at(r, "u01", "lens").state, at(r, "u01", "lens").retried]).toEqual(["measured", "infra"]);
    expect(at(r, "u01", "autoplan").state).toBe("missing");
    expect(f.tries.get("build u01 autoplan")).toBe(2);
    expect(f.money.log.filter((l) => l.startsWith("reconcile")).length).toBe(2);
  });
  test("a review arm with no Opus block on a unit doesn't build there, and its readout pairs only units where both builds exist", async () => {
    const { r } = await stage3({ opusBlock: (u, arm) => (u === "u03" && arm === "plan-design-review" ? null : "1. x"), reads: (l) => armReads(l) });
    expect(at(r, "u03", "plan-design-review").state).toBe("not-built");
    expect(r.paired.find((p) => p.comparator === "none" && p.arm === "plan-design-review" && p.measure === "serves")!.units).toBe(7);
    expect(r.lines).toContain("arm plan-design-review: no build on 1 units; its readouts pair only units where both builds exist");
  });
  test("key-check recurrence, uninformative checks and the KEEP flag", async () => {
    const { r } = await stage3({ reads: (l) => armReads(l, { keyChecks: l.endsWith("autoplan") ? { k1: false, k2: false, k3: false } : { k1: true, k2: true, k3: true } }) });
    expect(val(r, "u01", "none").keyCheckRecurrence).toBe(1);
    expect(val(r, "u01", "autoplan").keyCheckRecurrence).toBe(0);
    const k = r.keep.find((x) => x.arm === "autoplan")!;
    expect([k.flagged, k.delta]).toEqual([true, -1]);
    expect(r.keep.find((x) => x.arm === "plan-design-review")!.flagged).toBe(false);
    const flat = await stage3({ reads: (l) => armReads(l, { keyChecks: { k1: true, k2: true, k3: true } }) });
    expect(flat.r.lines.some((l) => l.includes("uninformative key checks (pass on every arm's build): k1, k2"))).toBe(true);
  });
  test("DES-4: win rates per judge and the instrument check at 70%", async () => {
    const { r } = await stage3({ reads: (l) => armReads(l) });
    expect(r.instrument).toEqual({ rate: 1, flagged: false });
    const tie = await stage3({ reads: (l) => armReads(l), judge: async () => "tie" });
    expect(tie.r.instrument.flagged).toBe(true);
    expect(tie.r.lines.some((l) => l.startsWith("E_DC_BUILD_INSTRUMENT DES-4 is flagged"))).toBe(true);
  });
  test("a refused round is a cap stop and the rest is incomplete: at $3 a round the $100 item admits 14 rounds", async () => {
    const { r } = await stage3({ caps: { "dc-stage3-authoring": 185, "dc-stage3-builds": 100, "dc-stage3-reads": 165 }, reads: (l) => armReads(l) });
    expect(r.capStop?.item).toBe("dc-stage3-builds");
    expect(r.builds.filter((b) => b.state === "measured").length).toBe(28);
    expect(r.builds.filter((b) => b.state === "incomplete").length).toBe(20);
  });
  test("an audit hit in a build VM stops stage 3 with E_DC_SANDBOX_AUDIT", async () => {
    const f = fixtureStage3({ reads: (l) => armReads(l) });
    const units = Array.from({ length: 8 }, (_, i) => unit(i + 1));
    const sel = await selectUnits(units.map(f.candidate), f.select);
    f.world.plant = (vm) => {
      if (vm.spec!.label === "build u02 lens") vm.processes.push({ pid: 77, user: "run", args: "node x --key sk-ant-api03-" + "q".repeat(30) });
    };
    await expect(runStage3(sel, f.deps(units))).rejects.toBeInstanceOf(DcError);
  });
});

describe("measures and readout", () => {
  const rec = (o: Partial<BuildRecord> = {}): BuildRecord => ({ unit: "u01", arm: "none", state: "measured", serves: true, reads: reads(), retried: null, ownLimit: false, ...o });
  test("new axe violations count against the no-review build", () => {
    const base = rec({ arm: "no-review" });
    const v = buildValues(rec({ reads: reads({ axe: [{ route: "/projects", width: 375, violations: ["color-contrast .badge", "label #q"] }] }) }), authored().keyChecks, base);
    expect([v.axe, v.axeNew]).toEqual([2, 1]);
    expect(buildValues(rec(), [], undefined).axeNew).toBeNull();
  });
  test("a missing check leaves its denominator; completion is completed scenarios over 3, so a missing scenario counts as not completed (ruling 2.31)", () => {
    const b = rec({ reads: reads({ keyChecks: { k1: true, k2: null, k3: false }, agentUser: [{ scenario: "s1", completed: true, steps: 1, failedActions: 0, consoleErrors: 0, deadEnds: 0 }, { scenario: "s2", completed: null, steps: 0, failedActions: 0, consoleErrors: 0, deadEnds: 0 }] }) });
    const v = buildValues(b, authored().keyChecks, undefined);
    expect([v.keyCheckRecurrence, v.completion, v.agentSteps, missingScenarios(b)]).toEqual([0.5, 0.3333, 1, 2]);
  });
  test("the readout requires the base-app map and clusters on it", () => {
    const vals = new Map<string, Partial<Record<"none" | "lens", Values>>>([["u01", { none: { ...buildValues(rec(), [], undefined), des4: null }, lens: { ...buildValues(rec(), [], undefined), des4: null } }]]);
    expect(() => readout(vals as never, {})).toThrow(DcError);
    const p = readout(vals as never, { u01: "a" });
    expect(p.find((x) => x.comparator === "none" && x.arm === "lens" && x.measure === "serves")).toMatchObject({ units: 1, delta: 0, ci95: null, worse: 0 });
  });
  test("the KEEP flag needs the interval below zero", () => {
    const row = (ci95: [number, number] | null) => [{ comparator: "none" as const, arm: "autoplan" as const, measure: "keyCheckRecurrence" as const, units: 8, delta: -0.2, ci95, worse: 3 }];
    expect(keepFlags(row([-0.4, -0.0001]))[1]!.flagged).toBe(true);
    expect(keepFlags(row([-0.4, 0]))[1]!.flagged).toBe(false);
    expect(keepFlags(row(null))[1]!.flagged).toBe(false);
  });
  test("the instrument check reads 0.7 as passing and 0.6999 as flagged", () => {
    const rows = (wins: number, of: number): PairRow[] => Array.from({ length: of }, (_, i) => ({ unit: "u" + i, arm: "no-review", judge: "astra", armFirst: true, result: i < wins ? "win" : "loss" }));
    expect(instrument(rows(7, 10))).toEqual({ rate: 0.7, flagged: false });
    expect(instrument(rows(6999, 10000)).flagged).toBe(true);
  });
  test("pair order is seeded and fixed", () => {
    expect(armFirst("u01", "none", "astra")).toBe(armFirst("u01", "none", "astra"));
    const firsts = Array.from({ length: 40 }, (_, i) => armFirst("u" + i, "none", "astra"));
    expect(firsts.some(Boolean) && firsts.some((x) => !x)).toBe(true);
  });
});

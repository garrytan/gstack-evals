// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import type { PilotCheck } from "../../../../lanes/codex-hooks/c/analysis/check.ts";
import { ARMS, R113 } from "../../../../lanes/codex-hooks/c/analysis/frozen.ts";
import { pilotReadout, r113Line, type HandReading, type PilotArm } from "../../../../lanes/codex-hooks/c/analysis/pilot.ts";
import { at, sessionId, statesOf, unitOf, type Spec } from "./helpers.ts";

const A = unitOf(3593);
const B = unitOf(3524);
const D = unitOf(3526);
const units = [A, B, D];
const hand = (arms: readonly string[], agree = true): HandReading[] => arms.flatMap((arm) => [A, B].map((u) => ({ arm: arm as HandReading["arm"], session: sessionId(arm as HandReading["arm"], u, 1), agree, note: "read by hand" })));
const failed = { route: "A", pass: false, primary: { why: "kappa 0.41 is under 0.6" }, joined: { why: null } } as unknown as PilotCheck;

describe("the pilot readout", () => {
  const specs: Spec[] = [
    { arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1"), at(A, "B2")], usd: 1, exposure: { blocks: 2, evaluated_stops: 3, items_named: ["adversarial pass", "report"] } },
    { arm: "c-on", unit: B, final: [at(B, "B1")], usd: 2, exposure: { fail_open: true } },
    { arm: "c-on", unit: D, final: [], usd: 6 },
    { arm: "c-off", unit: A, final: [], exposure: { would_block: true } },
    { arm: "c-off", unit: B, final: [], attempts: 2 },
    { arm: "c-off", unit: D, outcome: "gap", code: "UPSTREAM" },
    { arm: "c-high", unit: A, final: [], exposure: { read_shape_flags: 1, subagent_other_model: 1 } },
    { arm: "c-high", unit: B, final: [], exposure: { read_shape_flags: 2, unknown_namespace_spawns: 1 } },
    { arm: "c-none", unit: A, final: [] },
    { arm: "c-none", unit: B, final: [] },
    { arm: "c-none", unit: D, final: [] },
  ];
  const states = statesOf(specs, units);
  const r = pilotReadout(states, hand(["c-on", "c-off", "c-high"]), failed);
  const arm = (a: string) => r.arms.find((x) => x.arm === a)!;

  test("counts supply, gaps, reruns and missing sessions per arm", () => {
    expect(arm("c-off")).toMatchObject({ sessions: 3, scored: 2, gaps: { UPSTREAM: 1 }, reruns: 1, missing: 0 });
    expect(arm("c-high")).toMatchObject({ sessions: 3, scored: 2, missing: 1 });
  });

  test("reads the contract's exposure: blocks, items named, fail-opens and what c-off would have blocked", () => {
    expect(arm("c-on").exposure).toEqual({ blocked: 1, blocks: 2, evaluated_stops: 5, items_named: { "adversarial pass": 1, report: 1 }, fail_open: 1, false_block: 0, would_block: 0 });
    expect(arm("c-off").exposure.would_block).toBe(1);
  });

  test("gives costs and halves of allowances: c-on's 95th percentile of $6 passes half its $8 allowance", () => {
    expect(arm("c-on").cost).toMatchObject({ metered: 3, mean_usd: 3, median_usd: 2, p95_usd: 6, allowance_usd: 8, over_half_allowance: true });
    expect(arm("c-none").cost.over_half_allowance).toBe(false);
  });

  test("releases no found rate for any arm", () => {
    expect(JSON.stringify(r)).not.toMatch(/"found"|"blocking"|"matches"/);
  });

  test("says what the Captain hears before c-main spends", () => {
    const s = r.statements.join("\n");
    expect(s).toMatch(/c-on: the contract failed open in 1 pilot sessions/);
    expect(s).toMatch(/c-high: SKILL.md read-shape flags in 2 pilot sessions, more than one/);
    expect(s).not.toMatch(/spawn_agent calls in an unknown namespace in 1/);
    expect(s).toMatch(/c-high: a sub-agent ran on another model in 1 pilot sessions/);
    expect(s).toMatch(/passes half its allowance in c-on: every allowance of part C doubles/);
    expect(s).toMatch(/c-none: the hand reading agrees on 0 of 0 sessions/);
    expect(s).not.toMatch(/c-on: the hand reading/);
    expect(s).toMatch(/The judge check failed on route A \(primary kappa 0.41 is under 0.6; joined passed\)/);
    expect(s).not.toMatch(/blocked in no c-on pilot session/);
  });

  test("says plainly when the contract blocked in no c-on pilot session", () => {
    const none = pilotReadout(statesOf(specs.map((x) => (x.arm === "c-on" ? { ...x, first: undefined } : x)), units), hand(ARMS), null);
    expect(none.statements[0]).toMatch(/^The contract blocked in no c-on pilot session: the ceiling case/);
    expect(none.statements.join("\n")).not.toMatch(/hand reading/);
    expect(none.judge_check).toBeNull();
  });

  test("a hand reading that disagrees is named", () => {
    const x = pilotReadout(states, [...hand(["c-on", "c-off", "c-high", "c-none"]).slice(0, 7), { ...hand(["c-none"])[1]!, agree: false }], null);
    expect(x.statements.join("\n")).toMatch(/c-none: the hand reading agrees on 1 of 2 sessions/);
  });
});

describe("the R113 line", () => {
  const arms = (means: Array<number | null>): PilotArm[] => ARMS.map((arm, i) => ({ arm, cost: { mean_usd: means[i] } }) as unknown as PilotArm);
  test("no interim look when the counted run re-priced at the pilot's means stays at or under $500", () => {
    const r = r113Line(arms([1.5, 1.5, 3, 0.4]));
    expect(r.projected_usd).toBeCloseTo(66 * 6.4 + R113.vm_usd + R113.judge_usd, 9);
    expect(r.look).toBe(false);
    expect(r.line).toMatch(/^R113: no interim look\. The counted run re-priced at the pilot's costs is \$490\.00/);
  });
  test("one look at half the units, with O'Brien-Fleming bounds, above $500", () => {
    const r = r113Line(arms([1.5, 1.5, 4, 0.4]));
    expect(r.projected_usd!).toBeGreaterThan(500);
    expect(r.look).toBe(true);
    expect(r.line).toMatch(/\$556\.00, above \$500/);
    expect(r.line).toMatch(/\|z\| of at least 2\.797 at the look and 1\.977 at the end/);
    expect(r.line).toMatch(/below 10%/);
  });
  test("not re-priced when an arm has no metered pilot session", () => {
    expect(r113Line(arms([1, 1, null, 1]))).toMatchObject({ projected_usd: null, look: false });
  });
});

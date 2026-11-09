// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actingEdge, blockEdge, dropEdge, ece, wilsonLower } from "../../lanes/decision-routing/tune/bands.ts";
import { rewritePlan, tune, type LabelledDecision } from "../../lanes/decision-routing/tune/tune.ts";
import { buildPin, validatePin, writePin } from "../../lanes/decision-routing/tune/pin.ts";
import { SAFETY_PATTERNS } from "../../lanes/decision-routing/labels/safety.ts";

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));
const rows = (n: number, conf: number, right: number) => Array.from({ length: n }, (_, i) => ({ conf, correct: i < right }));

describe("Wilson and ECE", () => {
  test("Wilson 95% lower bound: 40 of 40 clears 0.90, 39 of 40 does not", () => {
    expect(wilsonLower(40, 40)).toBeCloseTo(1 / (1 + 1.959963984540054 ** 2 / 40), 9);
    expect(wilsonLower(40, 40)).toBeGreaterThanOrEqual(0.9);
    expect(wilsonLower(39, 40)).toBeLessThan(0.9);
    expect(wilsonLower(0, 0)).toBe(0);
  });
  test("ECE over 10 equal-width bins with a floor of 100 decisions", () => {
    expect(ece(rows(100, 0.95, 95))).toBeCloseTo(0, 12);
    expect(ece([...rows(50, 0.95, 50), ...rows(50, 0.55, 25)])).toBeCloseTo(0.5 * 0.05 + 0.5 * 0.05, 12);
    expect(ece(rows(99, 0.95, 95))).toBeNull();
    expect(ece(rows(100, 1, 80))).toBeCloseTo(0.2, 12);
  });
});

describe("acting bands", () => {
  test("lowest qualifying edge; regions below 40 never qualify", () => {
    expect(actingEdge([...rows(40, 0.96, 40), ...rows(40, 0.75, 20)])).toBe(0.8);
    expect(actingEdge([...rows(39, 0.96, 39)])).toBeNull();
    expect(actingEdge(rows(60, 0.97, 60))).toBe(0.5);
    expect(actingEdge([...rows(100, 0.92, 100), ...rows(10, 0.55, 0)])).toBe(0.6);
    expect(actingEdge([...rows(100, 0.92, 100), ...rows(10, 0.55, 0)].map((r) => ({ ...r, conf: r.conf === 0.55 ? 0.65 : r.conf })))).toBe(0.7);
  });
  test("relevance drops only where no fix-edited file was dropped over 40 or more", () => {
    const keepers = Array.from({ length: 50 }, () => ({ drop_conf: 0.93, fix_edited: false }));
    expect(dropEdge([...keepers, { drop_conf: 0.85, fix_edited: true }])).toBe(0.9);
    expect(dropEdge([...keepers, { drop_conf: 0.96, fix_edited: true }])).toBeNull();
    expect(dropEdge(keepers.slice(0, 39))).toBeNull();
  });
  test("safety blocks only where false blocks on real commands are at most 1%", () => {
    const real = Array.from({ length: 200 }, (_, i) => ({ answer: i < 3 ? "no" : "yes", conf: i < 2 ? 0.97 : i < 3 ? 0.75 : 0.9, unsafe: false }));
    expect(blockEdge(real)).toBe(0.8);
    const worse = real.map((r, i) => (i < 5 ? { ...r, answer: "no", conf: 0.85 } : r));
    expect(blockEdge(worse)).toBe(0.9);
    expect(blockEdge(real.slice(0, 39))).toBeNull();
  });
});

const dec = (o: Partial<LabelledDecision>): LabelledDecision => ({ decision_id: "s:" + Math.random(), state_file: "states/1.json", type: "next_step", decider: "jev", ok: true, conf: 0.97, answer: "run_tests", correct: true, ...o });

describe("tune", () => {
  test("Jev gets a band only with ECE <= 0.15 on 100 or more; done never gets a Jev band", () => {
    const good = Array.from({ length: 120 }, (_, i) => dec({ correct: i < 118 }));
    const done = Array.from({ length: 300 }, () => dec({ type: "done", answer: "yes", conf: 0.99 }));
    const t = tune([...good, ...done]);
    expect(t.jev.next_step.edge).not.toBeNull();
    expect(t.jev.done.edge).toBeNull();
    expect(tune(good.slice(0, 99)).jev.next_step.edge).toBeNull();
    const miscal = Array.from({ length: 120 }, (_, i) => dec({ conf: 0.99, correct: i < 90 }));
    expect(tune(miscal).ece.next_step).toBeGreaterThan(0.15);
    expect(tune(miscal).jev.next_step.edge).toBeNull();
  });
  test("no-answers count wrong; a pick of other never counts toward a band", () => {
    const xs = Array.from({ length: 60 }, (_, i) => dec({ decider: "particle_guess", ok: i >= 6, correct: i >= 6 }));
    expect(tune(xs).particle_guess.next_step.edge).toBeNull();
    expect(tune(Array.from({ length: 60 }, () => dec({ decider: "particle_guess", answer: "other" }))).particle_guess.next_step.edge).toBeNull();
  });
  test("particle bands with and without the guess are tuned apart", () => {
    const g = Array.from({ length: 60 }, () => dec({ decider: "particle_guess" }));
    const t = tune(g);
    expect(t.particle_guess.next_step.edge).toBe(0.5);
    expect(t.particle_noguess.next_step.edge).toBeNull();
  });
  test("question rewrite: types under 80% Jev accuracy, once, with the states to re-answer", () => {
    const xs = [...Array.from({ length: 100 }, (_, i) => dec({ type: "tests_passed", correct: i < 79, state_file: "states/" + i + ".json" })), ...Array.from({ length: 10 }, () => dec({ type: "safe", answer: "yes" }))];
    const plan = rewritePlan(xs, []);
    expect(plan.types.map((t) => t.type)).toEqual(["tests_passed"]);
    expect(plan.states).toHaveLength(100);
    expect(plan.deciders).toEqual(["jev", "particle_guess", "particle_noguess"]);
    expect(rewritePlan(xs, ["tests_passed"]).types).toEqual([]);
    expect(rewritePlan(xs.map((x) => ({ ...x, correct: true })), []).types).toEqual([]);
  });
});

describe("pin writer", () => {
  test("writes the frozen shape with sha256 and refuses a done band", () => {
    const dir = mkdtempSync(join(tmpdir(), "dr-pin-")); roots.push(dir);
    const t = tune(Array.from({ length: 120 }, () => dec({})));
    const pin = buildPin(t, { questions_sha256: "a".repeat(64), mapping_sha256: "b".repeat(64), safety_rule_sha256: "c".repeat(64), particle_max_tokens: 8000 });
    expect(pin.j_fixed).toEqual({ choice: 0.9, noul_yes: 0.9, noul_no: 0.1, relevant_drop_p: 0.1 });
    expect(pin.jev.done.edge).toBeNull();
    const path = join(dir, "pin.json");
    const sha = writePin(path, pin);
    expect(sha).toBe(createHash("sha256").update(readFileSync(path)).digest("hex"));
    expect(readFileSync(path + ".sha256", "utf8").trim()).toBe(sha);
    expect(() => validatePin({ ...pin, jev: { ...pin.jev, done: { edge: 0.9 } } })).toThrow(/done/);
    expect(() => validatePin({ ...pin, particle_max_tokens: 4000 })).toThrow();
    expect(() => validatePin({ ...pin, questions_sha256: "x" })).toThrow();
  });

  test("carries the safety rule's exact patterns and refuses a pin whose patterns differ from the rule's", () => {
    const pin = buildPin(tune(Array.from({ length: 120 }, () => dec({}))), { questions_sha256: "a".repeat(64), mapping_sha256: "b".repeat(64), safety_rule_sha256: "c".repeat(64), particle_max_tokens: 8000 });
    expect(pin.safety_patterns).toEqual(SAFETY_PATTERNS);
    expect(pin.safety_patterns.git_history).toEqual(["push", "rebase", "filter-branch", "filter-repo"]);
    expect(new RegExp(pin.safety_patterns.package_managers).test("pip")).toBe(true);
    expect(() => validatePin({ ...pin, safety_patterns: { ...pin.safety_patterns, net_tools: ["curl"] } })).toThrow(/safety_patterns/);
    const { safety_patterns: _, ...without } = pin;
    expect(() => validatePin(without)).toThrow(/safety_patterns/);
  });
});

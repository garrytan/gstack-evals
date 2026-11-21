// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { readStates, StatesError, stateId, type StateRecord } from "../../../../lanes/codex-hooks/c/analysis/record.ts";
import { at, bugsOf, jsonl, miss, session, sessionId, suite, unitOf } from "./helpers.ts";

const A = unitOf(3593);
const B = unitOf(3524);
const units = [A.id, B.id];
const read = (lines: StateRecord[], passes = 1, us = units) => readStates(jsonl(lines), suite, { passes, units: us });
const problems = (text: string, passes = 1) => {
  try {
    readStates(text, suite, { passes, units });
  } catch (e) {
    expect(e).toBeInstanceOf(StatesError);
    expect((e as StatesError).code).toBe("E_CH_C_STATES");
    expect((e as Error).message.startsWith("E_CH_C_STATES ")).toBe(true);
    return (e as StatesError).problems.join("\n");
  }
  throw new Error("the states file was accepted");
};
const edit = (lines: StateRecord[], i: number, f: (r: Record<string, unknown>) => void) => {
  const out = lines.map((l) => ({ ...l }) as Record<string, unknown>);
  f(out[i]!);
  return out.map((r) => JSON.stringify(r)).join("\n") + "\n";
};

describe("readStates", () => {
  test("a blocked session has two states, an unblocked one shares its final state as its first stop, and an unscored one has none", () => {
    const s = read([...session({ arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1"), at(A, "B2")] }), ...session({ arm: "c-off", unit: A, final: [miss(1)] }), ...session({ arm: "c-none", unit: B, outcome: "gap", code: "UPSTREAM" })]);
    const on = s.sessions.find((x) => x.arm === "c-on")!;
    expect(on.blocked).toBe(true);
    expect(on.states!.first_stop.id).toBe(stateId(on.id, "first_stop"));
    expect(on.states!.final.record.findings!.length).toBe(2);
    const off = s.sessions.find((x) => x.arm === "c-off")!;
    expect(off.states!.first_stop).toBe(off.states!.final);
    expect(s.sessions.find((x) => x.arm === "c-none")!.states).toBeNull();
    expect(s.states.map((x) => x.id).sort()).toEqual([stateId(on.id, "final"), stateId(on.id, "first_stop"), stateId(off.id, "final")].sort());
    expect(s.missing.length).toBe(4 * 2 - 3);
    expect(s.missing).toContainEqual({ arm: "c-high", unit: A.id, pass: 1 });
  });

  test("a no_block state carries its message and no findings, and a session with no text scores as finding nothing", () => {
    const s = read([...session({ arm: "c-on", unit: A, final: { message: "## Review\n\nThe budget is off by one.\n" } }), ...session({ arm: "c-off", unit: A, final: [], flags: { no_text: true } })]);
    expect(s.states.find((x) => x.record.arm === "c-on")!.record.no_block).toBe(true);
    expect(s.sessions.find((x) => x.arm === "c-off")!.no_text).toBe(true);
  });

  const good = [...session({ arm: "c-on", unit: A, first: [at(A, "B1")], final: [at(A, "B1")] })];
  const cases: Array<[string, string, RegExp]> = [
    ["a line that is not JSON", jsonl(good) + "{not json\n", /not JSON/],
    ["a line that is not an object", jsonl(good) + "[1]\n", /not an object/],
    ["another schema", edit(good, 0, (r) => (r.schema = 2)), /schema is 2/],
    ["an unknown arm", edit(good, 0, (r) => (r.arm = "c-maybe")), /arm "c-maybe"/],
    ["an unknown state", edit(good, 0, (r) => (r.state = "middle")), /state "middle"/],
    ["a pass past the run", edit(good, 0, (r) => (r.pass = 2)), /pass 2 is not from 1 to 1/],
    ["a unit the suite lacks", edit(good, 0, (r) => (r.unit = "garrytan/gstack#1@000000000000")), /is not a unit of suite/],
    ["bugs that are not the unit's", edit(good, 0, (r) => (r.bugs = ["B1"])), /are not the unit's blocking bugs/],
    ["another cluster", edit(good, 0, (r) => (r.cluster = "garrytan/gstack#1")), /is not the unit's/],
    ["an outcome code on a scored session", edit(good, 0, (r) => (r.outcome_code = "UPSTREAM")), /outcome_code must be null/],
    ["a third attempt", edit(good, 0, (r) => (r.attempts = 3)), /attempts is not 1 or 2/],
    ["a flag that is not a boolean", edit(good, 0, (r) => (r.limit_stop = "no")), /limit_stop is not true or false/],
    ["negative cost", edit(good, 0, (r) => (r.cost = { usd: -1, total_tokens: 3 })), /cost needs usd/],
    ["an exposure count that is not whole", edit(good, 0, (r) => (r.exposure = { ...(r.exposure as object), blocks: 1.5 })), /exposure.blocks/],
    ["sixteen findings", edit(good, 0, (r) => (r.findings = Array.from({ length: 16 }, (_, i) => miss(i)))), /holds 16 items/],
    ["findings in another shape", edit(good, 0, (r) => (r.findings = [{ where: "x" }])), /finding shape/],
    ["a no_block state with findings", edit(good, 0, (r) => (r.no_block = true)), /no_block state has findings null/],
    ["a no_block state with no message", edit(good, 0, (r) => ((r.no_block = true), (r.findings = null))), /carries its message text/],
    ["a message beside findings", edit(good, 0, (r) => (r.message = "text")), /message is null unless no_block/],
    ["no text with findings", edit(good, 0, (r) => (r.no_text = true)), /no assistant text has findings \[\]/],
    ["lines that disagree on cost", edit(good, 1, (r) => (r.cost = { usd: 9, total_tokens: 1000 })), /its lines disagree/],
    ["a state twice", jsonl([...good, good[1]!]), /a state appears twice/],
    ["a blocked session with no first stop", jsonl([good[1]!]), /a blocked session has final and first_stop/],
    ["an unblocked session with a first stop", jsonl(good.map((r) => ({ ...r, blocked: false, exposure: { ...r.exposure!, blocks: 0 } }))), /never blocked has final/],
    ["a blocked c-off session", jsonl(session({ arm: "c-off", unit: A, final: [] }).map((r) => ({ ...r, blocked: true }))), /c-off session cannot be blocked/],
    ["a gap with findings", jsonl(session({ arm: "c-on", unit: A, outcome: "gap" }).map((r) => ({ ...r, findings: [] }))), /not scored has one final line/],
    ["a gap with no reason code", jsonl(session({ arm: "c-on", unit: A, outcome: "gap" }).map((r) => ({ ...r, outcome_code: null }))), /reason code otherwise/],
    ["two sessions in one cell", jsonl([...session({ arm: "c-off", unit: A }), ...session({ arm: "c-off", unit: A }).map((r) => ({ ...r, session: "another" }))]), /a rerun is the same session with attempts 2/],
  ];
  for (const [name, text, want] of cases) test("refuses " + name, () => expect(problems(text)).toMatch(want));

  test("refuses a unit the run does not cover", () => {
    const C = unitOf(3526);
    expect(problems(jsonl(session({ arm: "c-on", unit: C })))).toMatch(/is not one this run covers/);
  });

  test("lists every problem it finds, not just the first", () => {
    const text = edit(good, 0, (r) => ((r.schema = 3), (r.attempts = 0)));
    const p = problems(text);
    expect(p).toMatch(/schema is 3/);
    expect(p).toMatch(/attempts is not 1 or 2/);
  });

  test("a full counted run has no missing cells", () => {
    const all = suite.units.flatMap((u) => (["c-on", "c-off", "c-high", "c-none"] as const).flatMap((arm) => [1, 2].flatMap((pass) => session({ arm, unit: u, pass }))));
    const s = readStates(jsonl(all), suite, { passes: 2, units: suite.units.map((u) => u.id) });
    expect(s.sessions.length).toBe(4 * 66);
    expect(s.missing).toEqual([]);
    expect(new Set(s.sessions.map((x) => x.id)).size).toBe(264);
    expect(s.sessions.find((x) => x.id === sessionId("c-on", A, 2))!.unit.id).toBe(A.id);
    expect(bugsOf(A).length).toBe(2);
  });
});

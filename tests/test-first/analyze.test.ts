// Copyright (c) 2026 Garry Tan. MIT License.
// B2's reading (lanes/test-first/analyze.ts): the pooled contrast's cluster-robust variance against a hand-computed table, the
// procedure gate and INCOMPLETE both ways, every row of the decision table, the interim look, and the pilot report.
import { describe, expect, test } from "bun:test";
import { checkRows, clusterContrast, incompleteWhy, look, outcomeOf, paired, pilotReport, pooled, procedureGate, reading, REGRESSION_AFTER_STOP, report } from "../../lanes/test-first/analyze.ts";
import { B2, BOUNDS, PILOT_TASKS } from "../../lanes/test-first/pins.ts";
import { row, table } from "./fixtures/rows.ts";

describe("pooled contrast (section 9.2)", () => {
  test("the cluster-robust variance matches the hand table", () => {
    // Clusters A: d 1, 0; B: d 1, 1, -1; C: d 0. N 6, D 1/3. s_g - n_g D: A 1/3, B 0, C -1/3, squares sum 2/9.
    // V = 3/2 x 2/9 / 36 = 1/108, so z = (1/3) sqrt(108) = sqrt(12) and the interval is 1/3 plus or minus 1.96 sqrt(1/108).
    const c = clusterContrast([{ cluster: "A", d: 1 }, { cluster: "A", d: 0 }, { cluster: "B", d: 1 }, { cluster: "B", d: 1 }, { cluster: "B", d: -1 }, { cluster: "C", d: 0 }]);
    expect(c.n).toBe(6);
    expect(c.g).toBe(3);
    expect(c.d).toBeCloseTo(1 / 3, 12);
    expect(c.v!).toBeCloseTo(1 / 108, 12);
    expect(c.z!).toBeCloseTo(Math.sqrt(12), 9);
    expect(c.lo!).toBeCloseTo(1 / 3 - BOUNDS.z95 * Math.sqrt(1 / 108), 9);
    expect(c.hi!).toBeCloseTo(1 / 3 + BOUNDS.z95 * Math.sqrt(1 / 108), 9);
  });
  test("one repository gives no variance, and no pairs give no z", () => {
    expect(clusterContrast([{ cluster: "A", d: 1 }, { cluster: "A", d: 0 }]).z).toBeNull();
    expect(clusterContrast([]).z).toBeNull();
  });
  test("pooled pairs run over the models given, on tasks graded in both arms, clustered by repository", () => {
    const rows = table(20, (m, a, i) => ({ pass: a === "prove-it" ? i < 15 : i < 5, outcome: a === "gstack" && i === 19 ? "infra" : "graded" }), ["opus", "sol"]);
    const p = pooled(rows, ["opus", "sol"], "prove-it", "gstack", "pass");
    expect([p.n, p.g]).toEqual([38, 10]);
    expect(p.d).toBeCloseTo(20 / 38, 12);
    expect(pooled(rows, ["opus"], "prove-it", "gstack", "pass").n).toBe(19);
  });
});

describe("procedure gate (section 6.3)", () => {
  const gate = (opusP: number, solP: number, g: number) => procedureGate(table(10, (m, a, i) => ({ followed: a === "prove-it" ? i < (m === "opus" ? opusP : solP) : a === "gstack" ? i < g : false }), ["opus", "sol"]), ["opus", "sol"]);
  test("passes at exactly 20 points pooled and 50% on Opus", () => {
    const r = gate(5, 5, 3);
    expect(r.gap!).toBeCloseTo(0.2, 12);
    expect(r.opus).toBe(0.5);
    expect(r.pass).toBe(true);
  });
  test("fails under 20 points pooled", () => expect(gate(5, 5, 4).pass).toBe(false));
  test("fails with Opus under 50% though the pooled gap clears 20 points", () => {
    const r = gate(4, 10, 0);
    expect(r.gap!).toBeGreaterThan(0.2);
    expect(r.pass).toBe(false);
  });
});

describe("INCOMPLETE (section 8)", () => {
  const gaps = (k: number) => table(20, (m, a, i) => ({ outcome: a === "line" && i < k ? "infra" : "graded" }), ["opus"]);
  test("two of 20 not graded is complete and three is not", () => {
    expect(incompleteWhy(gaps(2), 20)).toEqual([]);
    expect(incompleteWhy(gaps(3), 20)[0]).toContain("line has 3 of 20");
  });
  test("a cap stop makes the model INCOMPLETE", () => {
    const r = table(20, (m, a, i) => ({ outcome: a === "none" && i === 0 ? "cap_stop" : "graded" }), ["opus"]);
    expect(incompleteWhy(r, 20)[0]).toContain("cap");
  });
  test("an INCOMPLETE Sol leaves no reading; an INCOMPLETE particle-1 is left out and named", () => {
    const solGap = table(20, (m, a, i) => ({ followed: a === "prove-it", outcome: m === "sol" && a === "none" && i < 5 ? "infra" : "graded" }));
    expect(reading(solGap, "end", 20).decision.key).toBe("incomplete");
    const p1Gap = table(20, (m, a, i) => ({ followed: a === "prove-it", outcome: m === "p1" && a === "none" && i < 5 ? "infra" : "graded" }));
    const r = reading(p1Gap, "end", 20);
    expect(r.complete).toEqual(["opus", "sol"]);
    expect(r.decision.text).toContain("particle-1 left out");
  });
});

describe("the decision table, first row that applies", () => {
  const followed = (a: string) => a === "prove-it";
  test("procedure gate fails: FIX-METHOD on exposure", () => {
    const r = reading(table(20, (m, a, i) => ({ pass: a === "prove-it" ? i < 18 : i < 2 })), "end", 20);
    expect(r.decision.key).toBe("gate");
  });
  test("passes z at or below -2.068: CUT-CANDIDATE", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: a === "prove-it" ? i < 2 : i < 18 })), "end", 20);
    expect(r.passes!.z!).toBeLessThan(-BOUNDS.end);
    expect(r.decision.key).toBe("cut");
  });
  test("passes with a regression test z at or below -2.576 cuts too", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: true, reg: a === "prove-it" ? i < 2 : i < 18 })), "end", 20);
    expect(r.decision.key).toBe("cut");
  });
  test("passes z at or above 2.068: KEEP and strengthen, as the skill when prove-it beats the line", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: a === "prove-it" ? i < 18 : i < 2 })), "end", 20);
    expect(r.decision.key).toBe("keep-strengthen");
    expect(r.delivery!.lo!).toBeGreaterThan(0);
    expect(r.decision.text).toContain("ships as that skill");
  });
  test("KEEP and strengthen as the one line when prove-it does not beat the line", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: a === "prove-it" || a === "line" ? i < 18 : i < 2 })), "end", 20);
    expect(r.decision.key).toBe("keep-strengthen");
    expect(r.decision.text).toContain("no new skill");
  });
  test("a model whose own passes interval lies wholly below 0 is named beside a KEEP", () => {
    const r = reading(table(30, (m, a, i) => ({ followed: followed(a), pass: m === "sol" ? (a === "prove-it" ? i < 3 : a === "gstack" ? i < 27 : false) : a === "prove-it" ? i < 30 : i < 0 })), "end", 30);
    expect(r.decision.key).toBe("keep-strengthen");
    expect(r.decision.text).toContain("gpt-6.2-sol's own passes interval lies wholly below 0");
  });
  test("passes not shown, passes with a regression test at or above 2.576: KEEP as it is", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: i < 10, reg: a === "prove-it" })), "end", 20);
    expect(r.passes!.z).toBe(0);
    expect(r.decision.key).toBe("keep");
  });
  test("neither shown: a null", () => {
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: i < 10, reg: i < 5 })), "end", 20);
    expect(r.decision.key).toBe("null");
    expect(report(table(20, (m, a, i) => ({ followed: followed(a), pass: i < 10, reg: i < 5 })), "end", 20).lines.some((l) => l.includes("why null? power"))).toBe(true);
  });
  // prove-it passes 36 of 40 with no regression test; gstack passes 20, each with one.
  const split = table(40, (m, a, i) => ({ followed: followed(a), pass: a === "prove-it" ? i < 36 : i < 20, reg: a !== "prove-it" }));
  test("passes above 0 while passes with a regression test are below 0 at the end: no reading, to the Captain", () => {
    const r = reading(split, "end", 40);
    expect(r.passes!.z!).toBeGreaterThan(BOUNDS.end);
    expect(r.regression!.z!).toBeLessThan(-BOUNDS.regression);
    expect(r.decision.key).toBe("captain");
    expect(r.decision.text).toContain("both contrasts");
  });
  test("the same tables after a stop at the look: passes alone decide, KEEP and strengthen", () => {
    const r = reading(split, "look", 40);
    expect(r.passes!.z!).toBeGreaterThan(BOUNDS.look);
    expect(r.regressionRead).toBe(false);
    expect(r.decision.key).toBe("keep-strengthen");
  });
  test("after a stop at the look, passes with a regression test are descriptive (sections 9.3 and 11 as merged)", () => {
    expect(REGRESSION_AFTER_STOP).toBe("descriptive");
    const r = reading(table(20, (m, a, i) => ({ followed: followed(a), pass: i < 10, reg: a === "prove-it" })), "look", 20);
    expect([r.regressionRead, r.decision.key, r.bound]).toEqual([false, "null", BOUNDS.look]);
  });
});

describe("the interim look (section 11)", () => {
  test("stops at |z| of at least 2.917 and prints only z, the bound and the decision", () => {
    const l = look(table(B2.half, (m, a, i) => ({ followed: a === "prove-it", pass: a === "prove-it" ? i % 10 !== 0 : i % 10 === 0 })));
    expect(l.decision).toBe("stop");
    expect(l.line).toMatch(/^B2_LOOK z=\d+\.\d{3} bound=2\.917 decision=stop$/);
  });
  test("goes on below the bound, and goes on with no pooled z when Opus is INCOMPLETE", () => {
    expect(look(table(B2.half, (m, a, i) => ({ followed: a === "prove-it", pass: i % 2 === 0 }))).decision).toBe("continue");
    const l = look(table(B2.half, (m, a, i) => ({ pass: a === "prove-it", outcome: m === "opus" && a === "none" && i < 20 ? "infra" : "graded" })));
    expect([l.z, l.decision]).toEqual([null, "continue"]);
  });
});

describe("rows the report refuses", () => {
  test("a task outside the scope and a second graded row", () => {
    const r = [row("opus", "none", "t0"), row("opus", "none", "t0"), row("opus", "none", "t9")];
    const bad = checkRows(r, ["t0"]);
    expect(bad.some((b) => b.includes("t9") && b.includes("not one of"))).toBe(true);
    expect(bad.some((b) => b.includes("2 graded rows"))).toBe(true);
  });
  test("a write no parser can name or an unreadable Codex item scores followed both ways", () => {
    const r = row("sol", "prove-it", "t0", { followed: false }, "r", { unreadable_items: 2 });
    expect([outcomeOf("followed", r, "low"), outcomeOf("followed", r, "high"), outcomeOf("followed", r)]).toEqual([false, true, false]);
  });
  test("a per-model paired contrast counts discordant tasks", () => {
    const p = paired(table(10, (m, a, i) => ({ pass: a === "prove-it" ? i < 6 : i < 2 }), ["opus"]), "prove-it", "gstack", "pass");
    expect([p.pairs, p.both, p.a_only, p.b_only, p.neither]).toEqual([10, 2, 4, 0, 4]);
  });
});

describe("pilot report (section 12)", () => {
  const listed = (a: string) => (a === "gstack" || a === "prove-it" ? Array.from({ length: 30 }, (_, i) => "s" + i) : []);
  const pilot = (patch: (r: ReturnType<typeof row>) => ReturnType<typeof row> = (r) => r) =>
    (["opus", "sol", "p1"] as const).flatMap((m) => (["none", "line", "gstack", "prove-it"] as const).flatMap((a) => PILOT_TASKS.map((t) => patch(row(m, a, t, { pass: true, followed: a === "prove-it" }, "r", { skills_listed: listed(a) })))));
  test("every arm passes on every model when its evidence holds", () => {
    const p = pilotReport(pilot(), PILOT_TASKS, () => []);
    expect(p.failed).toEqual([]);
    expect(p.lines.length).toBe(12);
    expect(p.lines.every((l) => l.startsWith("PASS "))).toBe(true);
  });
  test("step text in the none arm, a missing line, no followed session and a manifest problem each fail their arm", () => {
    const p = pilotReport(pilot((r) => (r.arm === "none" && r.model === "claude-opus-5-5" ? { ...r, steps_seen: true } : r.arm === "line" && r.host === "codex" ? { ...r, line_seen: false } : r.arm === "prove-it" && r.model === "particle-1" ? { ...r, followed_b2: false } : r)), PILOT_TASKS, (l) => (l === "gstack" ? ["telemetry is on"] : []));
    expect(p.failed.sort()).toEqual(["gstack claude-opus-5-5", "gstack particle-1", "line gpt-6.2-sol", "none claude-opus-5-5", "prove-it particle-1"].sort());
  });
  test("a Sol session with a metered request at another effort, or with no metered request, fails its arm", () => {
    const p = pilotReport(pilot((r) => (r.model === "gpt-6.2-sol" && r.arm === "gstack" && r.task === PILOT_TASKS[1] ? { ...r, metered_effort: ["low", "medium"] } : r.model === "gpt-6.2-sol" && r.arm === "none" && r.task === PILOT_TASKS[2] ? { ...r, metered_effort: [] } : r)), PILOT_TASKS, () => []);
    expect(p.failed.sort()).toEqual(["gstack gpt-6.2-sol", "none gpt-6.2-sol"]);
    expect(p.lines.find((l) => l.startsWith("FAIL gstack"))).toContain("every metered request at effort low (1 of 3 sessions not)");
  });
  test("a pilot task not graded fails supply", () => {
    const p = pilotReport(pilot((r) => (r.task === PILOT_TASKS[0] && r.arm === "none" && r.model === "particle-1" ? { ...r, outcome: "infra" } : r)), PILOT_TASKS, () => []);
    expect(p.failed).toEqual(["none particle-1"]);
    expect(p.lines.find((l) => l.startsWith("FAIL"))).toContain("supply");
  });
});

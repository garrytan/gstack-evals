// Value: protects=section 10's read order and its AN-2 prints: which stage 1 reading ends the eval, which only marks a model untested, and what prints beside the band.
import { describe, expect, test } from "bun:test";
import { CALIBRATION, session, stage1Fixture } from "../../../lanes/office-hours-founder/read/seams.ts";
import { band, readStage1, referenceReads, smokeCount } from "../../../lanes/office-hours-founder/read/stage1.ts";

describe("readStage1", () => {
  test("the fixture reads HEADROOM with every reading printed in order", () => {
    const r = readStage1(stage1Fixture());
    expect(r).toMatchObject({ ends: null, ready: true, codes: [], repairs: [] });
    expect(r.band).toMatchObject({ none: 0.375, reference: 0.8125, room: 0.4375, reading: "HEADROOM" });
    const order = ["fidelity audit", "twin check", "judge check", "stock row", "parse rate", "band", "on Opus and Sol the room edge (c) is close to automatic", "Opus reference", "smoke"];
    const at = order.map((p) => r.lines.findIndex((l) => l.startsWith(p)));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  test("the fidelity audit: a first failure asks for the one repair, a failure after it ends the eval, NO READ voids stage 2", () => {
    const first = readStage1({ ...stage1Fixture(), audit: { pass: false, no_read: false, repaired: false } });
    expect(first.ends).toBeNull();
    expect(first.ready).toBe(false);
    expect(first.codes).toContain("E_OF_SIM_AUDIT");
    const after = readStage1({ ...stage1Fixture(), audit: { pass: false, no_read: false, repaired: true } });
    expect(after.ends).toContain("simulator");
    expect(after.repairs).toContain("simulator prompt");
    expect(readStage1({ ...stage1Fixture(), audit: { pass: false, no_read: true, repaired: false } }).ends).toStartWith("NO READ (simulator)");
  });
  test("the first reading in read order wins when several end the eval", () => {
    const i = stage1Fixture();
    const r = readStage1({ ...i, audit: { pass: false, no_read: true, repaired: false }, stock: i.stock.map((c) => (c.model === "opus" ? { ...c, W: 1 } : c)) });
    expect(r.ends).toStartWith("NO READ (simulator)");
    expect(r.codes).toEqual(["E_OF_SIM_AUDIT", "E_OF_STOCK_FAIL"]);
  });
  test("a first CEILING asks for R61's attempt without ending", () => {
    const i = stage1Fixture();
    const r = readStage1({ ...i, sessions: i.sessions.map((s) => (s.kind === "arm" && s.arm === "none" ? { ...s, W: 1 } : s)) });
    expect(r.band.reading).toBe("CEILING");
    expect(r.ends).toBeNull();
    expect(r.ready).toBe(false);
    expect(r.band.next).toContain("ceiling-raise");
  });
  test("band reads only the calibration units", () => {
    const i = stage1Fixture();
    const extra = [1, 2, 3].map((pass) => session({ stage: 1, unit: "t01", pass, W: 1 }));
    expect(band([...i.sessions, ...extra], CALIBRATION, false).none).toBe(0.375);
  });
});

describe("AN-2 prints", () => {
  test("the reference's credit rate per item and model; the split is a finding only for particle-1", () => {
    const rs = referenceReads(stage1Fixture().sessions, CALIBRATION);
    expect(rs.map((r) => [r.model, r.finding])).toEqual([["opus", false], ["sol", false], ["particle", true]]);
    expect(rs[0]).toMatchObject({ reference: { W: 0.8125, customer: 0.8125, wedge: 0 }, none: 0.375, drawing_out: 0.4375, deciding: 0.1875 });
    const lines = readStage1(stage1Fixture()).lines;
    expect(lines.some((l) => l.startsWith("particle-1 reference") && l.endsWith("(a finding)"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Sol reference") && l.endsWith("(descriptive, not a finding)"))).toBe(true);
  });
});

describe("smokeCount", () => {
  test("a missing session neither parses nor shows exposure; the limit rule reads Opus only", () => {
    const xs = [...Array.from({ length: 5 }, () => session({ exposed: true })), session({ end: "missing", W: null, exposed: null, arm_stop: true })];
    expect(smokeCount("opus", xs)).toMatchObject({ parsed: 5, exposed: 5, limits: 1, parse: true, exposure: true, limit: true });
    expect(smokeCount("sol", xs).limit).toBeNull();
  });
});

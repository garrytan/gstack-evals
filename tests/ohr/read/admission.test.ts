// Copyright (c) 2026 Garry Tan. MIT License.
// Section 12 stage 4's admission conditions A1 to A7 for the office-hours rewrite eval, each on both sides.
import { describe, expect, test } from "bun:test";
import { admission, admissionState, type AdmissionInput } from "../../../lanes/office-hours-rewrite/read/admission.ts";
import { stage1Input } from "../../../lanes/office-hours-rewrite/read/seams.ts";

const cond = (x: AdmissionInput, id: string) => admission(x).conditions.find((c) => c.id === id)!;

describe("admission", () => {
  test("the planted stage 1 is admitted", () => {
    const a = admission(stage1Input({}));
    expect(a.conditions.map((c) => [c.id, c.pass])).toEqual([["A1", true], ["A2", true], ["A3", true], ["A4", true], ["A5", true], ["A6", true], ["A7", true]]);
    expect(a.pass).toBe(true);
  });
  test("A1: 6 of 8 exposed holds, 5 fails; particle-1 is reported only", () => {
    expect(cond(stage1Input({ exposed: { arm: "new", model: "sol", count: 6 } }), "A1").pass).toBe(true);
    const c = cond(stage1Input({ exposed: { arm: "new", model: "sol", count: 5 } }), "A1");
    expect(c.pass).toBe(false);
    expect(cond(stage1Input({ exposed: { arm: "current", model: "particle", count: 0 } }), "A1").pass).toBe(true);
  });
  test("A1 refuses a cell without its 8 calibration sessions", () => {
    const x = stage1Input({});
    expect(() => admission({ ...x, rows: x.rows.filter((s) => !(s.brief === "k01" && s.arm === "new" && s.model === "opus")) })).toThrow(/^E_OHR_READ_INPUT/);
  });
  test("A2: a founder median of 3 replies holds, 2 fails", () => {
    expect(cond(stage1Input({ replies: { arm: "current", model: "opus", value: 3 } }), "A2").pass).toBe(true);
    expect(cond(stage1Input({ replies: { arm: "current", model: "opus", value: 2 } }), "A2").pass).toBe(false);
  });
  test("A3 and A4 read their flags", () => {
    expect(cond({ ...stage1Input({}), audit: { pass: false } }, "A3").pass).toBe(false);
    expect(cond({ ...stage1Input({}), judges: { astra: true, opus: false } }, "A4").pass).toBe(false);
  });
  test("A5: current's pooled right call on calibration founders, 9 of 12 holds, 10 fails", () => {
    const held = cond(stage1Input({ currentRight: 9 }), "A5");
    expect([held.pass, held.values.rate]).toEqual([true, 0.75]);
    expect(cond(stage1Input({ currentRight: 10 }), "A5").pass).toBe(false);
  });
  test("A6: the projection at stage 1's measured cost fits item 5 and item 6, or not", () => {
    const fits = cond(stage1Input({}), "A6");
    expect(fits.pass).toBe(true);
    expect(fits.values.item5).toEqual({ projection: 556.8, cap: 1406 });
    expect(cond(stage1Input({ usd: { arm: "new", model: "opus", value: 12 } }), "A6").pass).toBe(false);
    expect(cond(stage1Input({ usd: { arm: "new", model: "particle", value: 1.5 } }), "A6").pass).toBe(false);
  });
  test("A7: a skill session with another session kind fails, and so does a none-arm gstack read", () => {
    expect(cond(stage1Input({ kind: { brief: "k03", arm: "current", model: "sol", value: "headless" } }), "A7").pass).toBe(false);
    expect(cond(stage1Input({ read: { brief: "k03", model: "opus" } }), "A7").pass).toBe(false);
    expect(cond(stage1Input({ kind: { brief: "k03", arm: "current", model: "sol", value: null, missing: true } }), "A7").pass).toBe(true);
    expect(cond(stage1Input({ kind: { brief: "k03", arm: "current", model: "sol", value: null } }), "A7").pass).toBe(false);
  });
  test("one repair, then FIX-METHOD", () => {
    const ok = admission(stage1Input({})), bad = admission(stage1Input({ currentRight: 12 }));
    expect(admissionState([ok])).toBe("admitted");
    expect(admissionState([bad])).toBe("repair");
    expect(admissionState([bad, ok])).toBe("admitted");
    expect(admissionState([bad, bad])).toBe("fix-method");
    expect(() => admissionState([])).toThrow(/^E_OHR_READ_INPUT/);
  });
});

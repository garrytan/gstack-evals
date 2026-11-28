import { describe, expect, test } from "bun:test";
import { OPENS, requireOpen } from "../../../lanes/review-models/score/opening.ts";

const at = (iso: string) => Date.parse(iso);

describe("opening times (pre-run change 10)", () => {
  test("the pilot opens on 2026-11-26 and counted steps keep 2026-11-28 06:00Z", () => {
    expect(OPENS).toEqual({ pilot: "2026-11-26T21:30:00Z", counted: "2026-11-28T06:00:00Z" });
  });
  test("a pilot step is refused before its opening and allowed from it", () => {
    expect(() => requireOpen("pilot", "rm-run pilot", at("2026-11-26T21:29:59Z"))).toThrow(/^E_RM_NOT_OPEN rm-run pilot is a pilot step and opens at 2026-11-26T21:30:00Z/);
    expect(() => requireOpen("pilot", "rm-run pilot", at("2026-11-26T21:30:00Z"))).not.toThrow();
  });
  test("a counted step stays shut after the pilot opens", () => {
    for (const t of ["2026-11-26T21:30:00Z", "2026-11-27T12:00:00Z", "2026-11-28T05:59:59Z"]) expect(() => requireOpen("counted", "label-send --batch validation", at(t))).toThrow(/E_RM_NOT_OPEN .*counted step and opens at 2026-11-28T06:00:00Z/);
    expect(() => requireOpen("counted", "label-send --batch validation", at("2026-11-28T06:00:00Z"))).not.toThrow();
  });
  test("nothing in the environment moves an opening", () => {
    process.env.RM_OPENS = "2020-01-01T00:00:00Z";
    try {
      expect(() => requireOpen("counted", "x", at("2026-11-27T00:00:00Z"))).toThrow(/E_RM_NOT_OPEN/);
    } finally {
      delete process.env.RM_OPENS;
    }
  });
});

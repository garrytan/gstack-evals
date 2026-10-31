import { describe, expect, test } from "bun:test";
import { TOLD_PREFIX, TOLD_SHA256, TOLD_TEMPLATE, toldArmOf, toldPrompt, toldSkill } from "../../../src/trial/review/told.ts";

describe("the frozen told prompt", () => {
  // Value: protects=every arm gets the same frozen instruction and only its own command in front; fails_when=the told text changes without this pin moving on purpose, or a prefix drifts from the plan; why_new=GEVA-70 build step 2 (plan section 4, T4); seam=told.ts; no_claim=how an arm reads the text, which the canary covers
  test("the template's sha256 is pinned and every arm differs only by its prefix", () => {
    expect(TOLD_SHA256).toBe("16862a34212cd2eddbcedbc5654b26cb92b0dad50e3d501686770e6bc3d088ad");
    expect(TOLD_PREFIX).toEqual({ none: "", gstack: "/review", pstack: "/pstack:interrogate", tstack: "/sol-loop Run one review round and stop before any fix." });
    const body = TOLD_TEMPLATE.replaceAll("{base}", "main");
    expect(toldPrompt("none", "main")).toBe(body);
    expect(toldPrompt("gstack", "main")).toBe("/review " + body);
    expect(toldPrompt("pstack", "master")).toBe("/pstack:interrogate " + TOLD_TEMPLATE.replaceAll("{base}", "master"));
    expect(toldPrompt("tstack", "main").startsWith("/sol-loop Run one review round and stop before any fix. Review the changes")).toBe(true);
    expect(body).toContain("git diff main...HEAD");
    expect(body).not.toContain("{base}");
    for (const field of ["file", "line", "severity", "claim", "evidence", "confirmed"]) expect(TOLD_TEMPLATE).toContain('"' + field + '"');
    expect(TOLD_TEMPLATE).not.toMatch(/\u2014/);
    expect([toldSkill("none"), toldSkill("gstack"), toldSkill("pstack"), toldSkill("tstack")]).toEqual([null, "review", "interrogate", "sol-loop"]);
  });

  // Value: protects=arm specs map to the right told command; fails_when=a pstack or tstack arm gets gstack's prefix or a placebo runs told; why_new=GEVA-70; seam=toldArmOf; no_claim=none
  test("arm specs map to told arms", () => {
    expect(toldArmOf({ name: "none", kind: "bare" })).toBe("none");
    expect(toldArmOf({ name: "gstack", kind: "stack", stack: { repo: "garrytan/gstack", sha: "a".repeat(40) }, install: {} })).toBe("gstack");
    expect(toldArmOf({ name: "pstack", kind: "stack", stack: { repo: "cursor/plugins", sha: "b".repeat(40), path: "harness/pstack/claude-code" }, install: {} })).toBe("pstack");
    expect(toldArmOf({ name: "tstack", kind: "stack", stack: { repo: "t3dotgg/tstack", sha: "c".repeat(40) }, install: {} })).toBe("tstack");
    expect(toldArmOf({ name: "placebo", kind: "placebo", of: "gstack" })).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { TOLD_COMMANDS, TOLD_PREFIX, TOLD_SHA256, TOLD_TEMPLATE, toldArmOf, toldPrompt, toldSkill } from "../../../src/trial/review/told.ts";

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

// Value: protects=GEVA-109's told override (R2): an arm's own prefix replaces only the command, still names review, and an arm without one gets today's prompt byte for byte with TOLD_SHA256 unchanged; fails_when=the override touches the template or the default prompt changes; seam=toldPrompt and toldSkill
describe("GEVA-109: an arm's told prefix override", () => {
  const R2 = "/review Run the full review procedure: dispatch the Review Army specialists your plan selects and run the adversarial pass. Do not make Fix-First edits; report findings only. Writes to gstack's own state (its learnings, timeline and review log) are allowed.";
  test("the override replaces the prefix only; no override is today's prompt", () => {
    expect(toldPrompt("gstack", "main", R2)).toBe(R2 + " " + TOLD_TEMPLATE.replaceAll("{base}", "main"));
    expect(toldPrompt("gstack", "main", undefined)).toBe("/review " + TOLD_TEMPLATE.replaceAll("{base}", "main"));
    expect(toldPrompt("none", "main")).toBe(TOLD_TEMPLATE.replaceAll("{base}", "main"));
    expect([toldSkill("gstack", R2), toldSkill("gstack"), toldSkill("none")]).toEqual(["review", "review", null]);
  });
});

// Value: protects=R56-1: a gstack arm's prefix may open with /ship as well as /review, every other arm keeps only its own command, and the target skill follows the prefix's command; fails_when=TOLD_COMMANDS widens past what an arm declares, drops an arm's own command, or toldSkill ignores the prefix; why_new=GEVA-197 (GST-1021); seam=TOLD_COMMANDS and toldSkill; no_claim=the command's checks, which cli.test.ts covers, and the install target, which told-identity.test.ts covers
describe("R56-1: the commands an arm declares", () => {
  test("gstack declares /review and /ship, each other arm its own command, and the skill follows the prefix", () => {
    expect(TOLD_COMMANDS).toEqual({ none: [], gstack: ["/review", "/ship"], pstack: ["/pstack:interrogate"], tstack: ["/sol-loop"] });
    for (const arm of ["gstack", "pstack", "tstack"] as const) expect(TOLD_COMMANDS[arm][0]).toBe(TOLD_PREFIX[arm].split(" ")[0]);
    expect([toldSkill("gstack", "/ship Run only the review panel."), toldSkill("gstack", "/review Look hard."), toldSkill("gstack")]).toEqual(["ship", "review", "review"]);
  });
});

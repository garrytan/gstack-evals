// Value: protects=section 5's frozen exposure detector, which decides whether the office-hours arm ran its procedure, and its secondaries.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GSTACK } from "../../../lanes/office-hours-founder/frozen.ts";
import { EXPOSED, FENCED, transcript } from "../../../lanes/office-hours-founder/score/fixtures.ts";
import { beforeBlock, designDoc, exposure, FORCING, forcingAsked, GSTACK_FILES, loaded, type Forcing } from "../../../lanes/office-hours-founder/score/exposure.ts";

const READ = "/root/.claude/skills/gstack/office-hours/sections/phase-2a-startup-diagnostic.md";

describe("the forcing-question patterns, settled in both directions", () => {
  const cases: Record<Forcing, { yes: string[]; no: string[] }> = {
    Q1: {
      yes: ["What's the strongest evidence you have that someone actually wants this?", "Would anyone be genuinely upset if it disappeared tomorrow?"],
      no: ["What evidence would change your mind?", "Is there anything else you want to add?"],
    },
    Q2: {
      yes: ["What are your users doing right now to solve this problem \u2014 even badly?", "How do they handle this today?", "What does that workaround cost them?"],
      no: ["What would you build today?", "Can you solve this with your current team?"],
    },
    Q3: {
      yes: ["Name the actual human who needs this most. What's their title?", "What gets them promoted?", "Who specifically needs this most?"],
      no: ["Who is your target market?", "Can you name your competitors?"],
    },
    Q4: {
      yes: ["What's the smallest possible version of this that someone would pay real money for \u2014 this week?", "What is the narrowest thing a shop would pay for?"],
      no: ["What's the smallest team you could hire?", "How much would they pay?"],
    },
    Q5: {
      yes: ["Have you actually sat down and watched someone use this without helping them?", "Have you watched a customer try it?"],
      no: ["What surprised you most about the market?", "Should we watch the competition?"],
    },
    Q6: {
      yes: ["If the world looks meaningfully different in 3 years \u2014 and it will \u2014 does your product become more essential or less?", "Where does this go over the next three years?"],
      no: ["Where do you want the company to be in ten years?", "Is this essential to your users?"],
    },
  };
  for (const [q, c] of Object.entries(cases) as Array<[Forcing, { yes: string[]; no: string[] }]>) {
    test(q + " matches its Ask line's forms and nothing near them", () => {
      for (const s of c.yes) expect({ s, hit: FORCING[q].test(s) }).toEqual({ s, hit: true });
      for (const s of c.no) expect({ s, hit: FORCING[q].test(s) }).toEqual({ s, hit: false });
    });
  }
  test("a forcing question counts only on a line with a question mark, whatever its Q number", () => {
    expect(forcingAsked("Q1 \u2014 What does that workaround cost them?")).toEqual(["Q2"]);
    expect(forcingAsked("Your workaround costs hours.\nThe strongest evidence is the pre-order.")).toEqual([]);
  });
});

describe("the detector reads the text before the block", () => {
  test("beforeBlock cuts at the last first-move fence, or a fence holding a first_move key", () => {
    expect(beforeBlock("a\n" + FENCED + "\nafter")).toBe("a");
    expect(beforeBlock("a\n```json\n{\"first_move\": \"x\"}\n```\nafter")).toBe("a");
    expect(beforeBlock("a\n```text\nPREMISES:\n```\nb")).toBe("a\n```text\nPREMISES:\n```\nb");
  });
  test("an exposed session reads x1, x2 and x3, and counts the stage route", () => {
    expect(exposure(transcript(EXPOSED.map((t) => [t])), null, "pre-product")).toEqual({ x1: true, x2: true, x3: true, exposed: true, load: false, design_doc: false, forcing_asked: 2, forcing_routed: 2 });
    expect(exposure(transcript(EXPOSED.map((t) => [t])), null, "has users").forcing_routed).toBe(1);
    expect(exposure(transcript(EXPOSED.map((t) => [t])), null, null).forcing_routed).toBe(0);
  });
  test("an unexposed session misses each part", () => {
    const e = exposure(transcript([["What do you want to build?"], ["Approach A: by hand. My recommendation: start small.\n\n" + FENCED]]), null, "pre-product");
    expect(e).toMatchObject({ x1: false, x2: false, x3: false, exposed: false, forcing_asked: 0 });
  });
  test("two parts are not enough", () => {
    expect(exposure(transcript([[EXPOSED[0]!], [EXPOSED[1]!], ["APPROACH A: x\nAPPROACH B: y\nRECOMMENDATION: A\n\n" + FENCED]]), null, null)).toMatchObject({ x1: true, x2: false, x3: true, exposed: false });
  });
  test("bold premises with numbered lines count; one numbered line doesn't", () => {
    expect(exposure(transcript([["**PREMISES:**\n1. One.\n2. Two.\n\n" + FENCED]]), null, null).x2).toBe(true);
    expect(exposure(transcript([["PREMISES:\n1. Only one.\n\n" + FENCED]]), null, null).x2).toBe(false);
  });
  test("subagent text never counts", () => {
    const own = transcript([["Fine."]]).trim();
    const sub = JSON.stringify({ type: "assistant", parent_tool_use_id: "x", message: { content: [{ type: "text", text: EXPOSED.join("\n\n") }] } });
    expect(exposure(own + "\n" + sub + "\n", null, null).exposed).toBe(false);
  });
});

describe("secondaries", () => {
  test("load needs a successful, non-empty Read of the pinned phase-2a path", () => {
    expect(loaded(transcript([[{ read: READ, result: "### Operating Principles" }]]))).toBe(true);
    expect(loaded(transcript([[{ read: READ, result: "" }]]))).toBe(false);
    expect(loaded(transcript([[{ read: "/tmp/phase-2a-startup-diagnostic.md", result: "x" }]]))).toBe(false);
  });
  test("design_doc needs a *-design-*.md under projects with a non-empty The Assignment section", () => {
    const root = mkdtempSync(join(tmpdir(), "of-exposure-"));
    try {
      mkdirSync(join(root, "projects", "s"), { recursive: true });
      expect(designDoc(root)).toBe(false);
      writeFileSync(join(root, "projects", "s", "notes.md"), "## The Assignment\nCall them.\n");
      expect(designDoc(root)).toBe(false);
      writeFileSync(join(root, "projects", "s", "u-main-design-1.md"), "## The Assignment\n\n## Next\nx\n");
      expect(designDoc(root)).toBe(false);
      writeFileSync(join(root, "projects", "s", "u-main-design-2.md"), "## The Assignment\nCall three owners.\n");
      expect(designDoc(root)).toBe(true);
      expect(designDoc(null)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("the patterns name the prereg's gstack pin and its files by sha256", () => {
    expect(GSTACK.sha.startsWith("b6155921")).toBe(true);
    expect(Object.keys(GSTACK_FILES).sort()).toEqual(["office-hours/SKILL.md", "office-hours/sections/design-and-handoff.md", "office-hours/sections/phase-2a-startup-diagnostic.md"]);
    for (const h of Object.values(GSTACK_FILES)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

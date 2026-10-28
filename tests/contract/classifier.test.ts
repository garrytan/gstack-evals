import { describe, expect, test } from "bun:test";
import { CATEGORIES, CATEGORY_NAMES, CLASSIFIER_SHA256, PROSE_WINDOW, classifyAsk, classifyProse, isCategory, proseQuestion } from "../../src/usersim/classifier.ts";

describe("question-category classifier", () => {
  test("the published categories are unique snake_case names with lowercase keywords", () => {
    expect(new Set(CATEGORY_NAMES).size).toBe(CATEGORY_NAMES.length);
    for (const c of CATEGORIES) {
      expect(c.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      for (const k of c.keywords as readonly string[]) expect(k).toBe(k.toLowerCase());
    }
    expect(isCategory("demand")).toBe(true);
    expect(isCategory("customer")).toBe(false);
    expect(CLASSIFIER_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an AskUserQuestion is classified on its header, then its question, then its option labels", () => {
    expect(classifyAsk({ header: "Premises", question: "Which approach should we take?" })).toEqual({ category: "premises", tier: "header", matched: ["premises"], keywords: ["premise"], ambiguous: false });
    expect(classifyAsk({ header: "Next", question: "Which approach should we take?" })).toMatchObject({ category: "approach", tier: "question" });
    expect(classifyAsk({ header: "Next", question: "Pick one", options: [{ label: "Yes, search away", description: "approach" }, { label: "Skip" }] })).toMatchObject({ category: "landscape_search", tier: "options", matched: ["landscape_search"] });
    expect(classifyAsk({ header: "Next", question: "Pick one", options: [{ label: "A", description: "a second opinion" }] }).category).toBeNull();
    expect(classifyAsk({})).toEqual({ category: null, tier: null, matched: [], keywords: [], ambiguous: false });
  });

  test("several categories in the deciding tier make the match ambiguous; the first in order still wins", () => {
    const c = classifyAsk({ question: "Do you want a second opinion before we pick an approach?" });
    expect(c).toMatchObject({ category: "second_opinion", matched: ["second_opinion", "approach"], ambiguous: true });
    expect(c.keywords).toEqual(["second opinion", "approach"]);
  });

  test("matching ignores case, and the same input always gives the same answer", () => {
    const q = { question: "What's your GOAL with this: Building A Startup, or HAVING FUN?" };
    expect(classifyAsk(q)).toEqual(classifyAsk(q));
    expect(classifyAsk(q)).toMatchObject({ category: "mode", keywords: ["your goal with this", "what's your goal", "building a startup", "having fun"] });
  });

  test("a prose question is read from the tail of the final text and needs a question mark", () => {
    expect(proseQuestion("Here is the plan.")).toBeNull();
    expect(classifyProse("Here is the plan.").category).toBeNull();
    const early = "Who exactly needs this? " + "x".repeat(PROSE_WINDOW);
    expect(classifyProse(early).category).toBeNull();
    expect(classifyProse("Thanks. Who would be upset if this disappeared tomorrow?")).toMatchObject({ category: "demand", tier: "prose" });
  });
});

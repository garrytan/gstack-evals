import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, classifyAsk, UserSim } from "../src/usersim.ts";

const replies = {
  mode: "Building a startup.",
  demand: "Dana pays a VA $40 a month.",
  premises: "I agree with the premises.",
  second_opinion: "No, proceed to alternatives.",
  approach: "Not yet. Stop here.",
  design_doc: "Approve the design doc.",
};

describe("classify", () => {
  test("office-hours questions land in their categories", () => {
    expect(classify("Before we dig in, what's your goal with this?\nGoal\nBuilding a startup\nHaving fun").category).toBe("mode");
    expect(classify("Want a second opinion from an independent AI perspective?").category).toBe("second_opinion");
    expect(classify("PREMISES:\n1. x — agree/disagree?").category).toBe("premises");
    expect(classify("Which approach should we take?\nApproach A: CLI\nApproach B: web").category).toBe("approach");
    expect(classify("Here is the design doc. Approve, revise or start over?").category).toBe("design_doc");
    expect(classify("I'd like to search for what the world thinks about this space. OK to proceed?").category).toBe("landscape_search");
    expect(classify("What's the strongest evidence you have that someone actually wants this?").category).toBe("demand");
    expect(classify("Name the actual human who needs this most.").category).toBe("specificity");
    expect(classify("What are your users doing right now to solve this problem?").category).toBe("status_quo");
    expect(classify("Where are you: pre-product, has users, or paying customers?").category).toBe("stage");
    expect(classify("Should I generate mockups of the upload screen?").category).toBe("visual");
    expect(classify("Do you like turtles?").category).toBeNull();
  });
  test("an ask is classified on its header before its question and options", () => {
    expect(classifyAsk({ header: "Approach", question: "Which approach? B adds a visual column mapper.", options: [{ label: "A: CLI" }, { label: "B: visual mapper" }] }).category).toBe("approach");
    expect(classifyAsk({ header: "Next step", question: "Want a sketch of the upload screen before the design doc?", options: [{ label: "Yes" }, { label: "No" }] }).category).toBe("visual");
    expect(classifyAsk({ header: "Pick one", question: "Hmm?", options: [{ label: "Building a startup" }, { label: "Having fun" }] }).category).toBe("mode");
  });
});

describe("UserSim", () => {
  const dir = mkdtempSync(join(tmpdir(), "usersim-"));
  test("answers asks from the script, falls back without approving, and caps repeats", () => {
    const sim = new UserSim({ replies }, join(dir, "a.jsonl"));
    const q = { question: "What's your goal with this?", header: "Goal", options: [{ label: "Building a startup" }, { label: "Having fun" }] };
    expect(sim.answerAsk([q])).toEqual({ "What's your goal with this?": "Building a startup." });
    expect(sim.answerAsk([{ question: "Do you like turtles?" }])["Do you like turtles?"]).toContain("don't write any files");
    sim.answerAsk([q]);
    expect(sim.answerAsk([q])["What's your goal with this?"]).toContain("No strong view");
    const log = readFileSync(join(dir, "a.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.map((e) => e.source)).toEqual(["scripted", "fallback", "scripted", "fallback"]);
  });
  test("prose turns: reply when scripted, end when no question or no reply", () => {
    const sim = new UserSim({ replies }, join(dir, "b.jsonl"));
    expect(sim.afterTurn("Q1 — What's the strongest evidence that someone actually wants this?")).toMatchObject({ kind: "reply", category: "demand" });
    expect(sim.afterTurn("Here are the approaches. I'll stop here.")).toMatchObject({ kind: "end", reason: "no_question" });
    expect(sim.afterTurn("Do you like turtles?")).toMatchObject({ kind: "end", reason: "unclassified" });
    expect(sim.afterTurn("Name the actual human who needs this most?")).toMatchObject({ kind: "end", reason: "no_reply_for_category" });
  });
});

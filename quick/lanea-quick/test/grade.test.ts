import { describe, expect, test } from "bun:test";
import { gradePatterns, loadedBytes, parseTranscript, skillUse, transcriptText } from "../src/grade.ts";

const msgs = [
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "office-hours" } }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/home/agent/.claude/skills/gstack/office-hours/sections/preamble.md" } }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "AskUserQuestion", input: { questions: [{ question: "What's your goal?", header: "Goal", options: [{ label: "Building a startup", description: "" }, { label: "Hackathon / demo", description: "" }] }] } }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "PREMISES:\n1. x. Do you agree?" }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "Done.\n```py\nimport os\n```" }] } },
];

describe("grading", () => {
  const t = parseTranscript(msgs);
  test("transcript text includes AskUserQuestion options; final answer is the last text", () => {
    expect(gradePatterns({ id: "m", prompt: "p", must: ["[Ss]tartup", "[Hh]ackathon"] }, transcriptText(t)).ok).toBe(true);
    expect(gradePatterns({ id: "m", prompt: "p", must: ["[Ss]tartup"] }, t.finalAnswer).ok).toBe(false);
    expect(gradePatterns({ id: "m", prompt: "p", must: ["PREMISES", "[Aa]gree"] }, transcriptText(t)).ok).toBe(true);
  });
  test("must_not reads code blocks only", () => {
    expect(gradePatterns({ id: "m", prompt: "p", must: ["Done"], must_not: ["import os"] }, t.finalAnswer).ok).toBe(false);
    expect(gradePatterns({ id: "m", prompt: "p", must: ["Done"], must_not: ["Done"] }, t.finalAnswer).ok).toBe(true);
  });
  test("skill use and loaded bytes", () => {
    const u = skillUse(t, "office-hours");
    expect(u.opened).toBe(true);
    expect(u.how).toEqual(["Skill"]);
    expect(u.files).toEqual({ "office-hours/SKILL.md": 1, "office-hours/sections/preamble.md": 1 });
    expect(loadedBytes(u.files, { "office-hours/SKILL.md": 100, "office-hours/sections/preamble.md": 20 })).toEqual({ unique: 120, total: 120, unknown: [] });
    expect(skillUse(t, "learn").opened).toBe(false);
  });
  test("a failed Skill call does not count as opened", () => {
    const failed = parseTranscript([
      { type: "assistant", message: { content: [{ type: "tool_use", id: "x1", name: "Skill", input: { skill: "office-hours" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x1", is_error: true, content: "Unknown skill" }] } },
    ]);
    expect(skillUse(failed, "office-hours").opened).toBe(false);
  });
});

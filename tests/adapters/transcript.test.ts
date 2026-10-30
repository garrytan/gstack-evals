import { describe, expect, test } from "bun:test";
import { askTurn, parseClaudeCode, shellReads, skillUse, type Call } from "../../src/grade/transcript.ts";
import { gradeTrial, type VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import type { TrialRecord } from "../../src/types.ts";

const assistant = (content: unknown[], parent: string | null = null, extra: Record<string, unknown> = {}) => ({ type: "assistant", parent_tool_use_id: parent, message: { role: "assistant", content }, ...extra });
const user = (content: unknown) => ({ type: "user", parent_tool_use_id: null, message: { role: "user", content } });
const ask = { questions: [{ question: "Which approach should we take?", header: "Approach", options: [{ label: "Approach A" }, { label: "Approach B" }] }] };

const SESSION = [
  { type: "system", subtype: "init", tools: ["AskUserQuestion"] },
  assistant([{ type: "thinking", thinking: "THINKING-ONLY" }]),
  assistant([{ type: "text", text: "Let me look around first." }]),
  assistant([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo TOOL-INPUT-ONLY" } }]),
  user([{ type: "tool_result", tool_use_id: "t1", content: "TOOL-OUTPUT-ONLY" }]),
  assistant([{ type: "tool_use", id: "t2", name: "Task", input: { description: "research", prompt: "go" } }]),
  assistant([{ type: "text", text: "SUBAGENT-ONLY report" }], "t2"),
  user([{ type: "tool_result", tool_use_id: "t2", content: "SUBAGENT-ONLY report" }]),
  assistant([{ type: "text", text: "I can offer a SECOND-OPINION from an outside voice." }]),
  assistant([{ type: "tool_use", id: "t3", name: "AskUserQuestion", input: ask }]),
  user([{ type: "tool_result", tool_use_id: "t3", content: "User answered: PERSONA-ONLY approach A" }]),
  user("PERSONA-ONLY: three dentists paid."),
  assistant([{ type: "text", text: "API Error: 529 overloaded" }], null, { error: "overloaded", is_api_error_message: true }),
  assistant([{ type: "text", text: "Final plan: build the CLI." }]),
  { type: "result", subtype: "success", result: "Final plan: build the CLI.", num_turns: 5 },
];

const record = (turns: string[]): TrialRecord => ({ model: "m", arm: "after", task: "t", round: 1, trial: 0, termination: { kind: "completed" }, turns, check: null, judge: null, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, wall_ms: null, agent_turns: null, loaded_bytes: null, metrics: {} });
const task = (over: Partial<VerdictTask>): VerdictTask => ({ id: "t", safety: false, interactive: true, judge: false, must: [], must_not: [], check: false, ...over });

describe("GST-109: user-visible turns from a Claude Code transcript", () => {
  // Value: protects=turns hold the main agent's text and each AskUserQuestion's question with its labels, in order, and nothing else: no thinking, tool input or output, subagent text, user or persona text, API errors or result echo; fails_when=any of those reaches the graded text; why_new=GST-109 decision 2 (assistant text blocks only); seam=parseClaudeCode; no_claim=none beyond protects
  test("only what the user saw, in order, with the final answer last", () => {
    const { turns } = parseClaudeCode(SESSION);
    expect(turns).toEqual(["Let me look around first.", "I can offer a SECOND-OPINION from an outside voice.", askTurn(ask.questions), "Final plan: build the CLI."]);
    expect(askTurn(ask.questions)).toBe("Which approach should we take?\n- Approach A\n- Approach B");
    for (const hidden of ["THINKING-ONLY", "TOOL-INPUT-ONLY", "TOOL-OUTPUT-ONLY", "SUBAGENT-ONLY", "PERSONA-ONLY", "API Error"]) expect(turns.join("\n")).not.toContain(hidden);
  });

  // Value: protects=the Captain's grading rule on parsed turns: a must held mid-session passes an interactive task but not a final-answer one, a pattern only in persona or subagent text never passes, and a must_not in a mid-session code block fails an interactive run; fails_when=grading reads hidden text or only the last turn on an interactive task; why_new=GST-109 (a pattern only in a persona reply does not pass); seam=parseClaudeCode, gradeTrial; no_claim=none beyond protects
  test("a must seen mid-session passes an interactive task; persona and subagent text never pass; a mid-session must_not fails", () => {
    const rec = record(parseClaudeCode(SESSION).turns);
    expect(gradeTrial(task({ must: ["second-opinion"] }), rec).outcome).toBe("pass");
    expect(gradeTrial(task({ interactive: false, must: ["second-opinion"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["dentists paid"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["SUBAGENT-ONLY"] }), rec).outcome).toBe("fail");
    expect(gradeTrial(task({ must: ["approach b"] }), rec).outcome).toBe("pass");
    const coded = record(["Here:\n\n```\nrm -rf data\n```\n", "All done."]);
    expect(gradeTrial(task({ must_not: ["rm -rf"] }), coded).outcome).toBe("fail");
    expect(gradeTrial(task({ interactive: false, must_not: ["rm -rf"] }), coded).outcome).toBe("pass");
  });

  // Value: protects=calls[] pairs each tool call with its result's error flag, main and subagent alike; fails_when=a failed call reads as ok or a subagent call is lost; why_new=U10 (skill-opened calls[]); seam=parseClaudeCode; no_claim=none beyond protects
  test("calls[] carries each call's tool, short input, result and whether a subagent made it", () => {
    const { calls } = parseClaudeCode([
      assistant([{ type: "tool_use", id: "a", name: "Skill", input: { skill: "learn" } }]),
      user([{ type: "tool_result", tool_use_id: "a", is_error: true, content: "Unknown skill" }]),
      assistant([{ type: "tool_use", id: "b", name: "Read", input: { file_path: "/h/.claude/skills/learn/SKILL.md", limit: 5 } }], "x"),
      user([{ type: "tool_result", tool_use_id: "b", content: "..." }]),
      assistant([{ type: "tool_use", id: "c", name: "Bash", input: { command: "ls" } }]),
    ]);
    expect(calls).toEqual([
      { id: "a", tool: "Skill", input: { skill: "learn" }, ok: false, subagent: false },
      { id: "b", tool: "Read", input: { file_path: "/h/.claude/skills/learn/SKILL.md" }, ok: true, subagent: true },
      { id: "c", tool: "Bash", input: { command: "ls" }, ok: null, subagent: false },
    ]);
  });

  // Value: protects=the opened signal: a successful Skill call (bare or gstack-prefixed), a Read or a shell read under one of the skill's roots open it, and a failed call or a read elsewhere does not; fails_when=the none arm's failed Skill call counts or a gstack base's second path is missed; why_new=interface v0.5 Hosts (a Skill call or a read under the arm's skill tree); seam=skillUse; no_claim=none beyond protects
  test("opened needs a successful call that names or reads the skill", () => {
    const skill = { name: "learn", roots: ["/h/.claude/skills/learn", "/h/.claude/skills/gstack/learn"] };
    const c = (tool: string, input: Record<string, string>, ok: boolean | null = true): Call => ({ id: tool, tool, input, ok, subagent: false });
    expect(skillUse([c("Skill", { skill: "learn" }, false)], skill)).toEqual({ opened: false, files: [] });
    expect(skillUse([c("Skill", { skill: "gstack:learn" })], skill)).toEqual({ opened: true, files: ["SKILL.md"] });
    expect(skillUse([c("Read", { file_path: "/h/.claude/skills/gstack/learn/refs/a.md" })], skill)).toEqual({ opened: true, files: ["refs/a.md"] });
    expect(skillUse([c("Bash", { command: "cat '/h/.claude/skills/learn/SKILL.md' | head" })], skill)).toEqual({ opened: true, files: ["SKILL.md"] });
    expect(skillUse([c("Read", { file_path: "/h/.claude/skills/other/SKILL.md" }), c("Bash", { command: "ls /h/.claude/skills/learn/" })], skill)).toEqual({ opened: false, files: [] });
    expect(skillUse([c("Skill", { skill: "learn" })], null)).toEqual({ opened: false, files: [] });
  });

  // Value: protects=only a real read counts: a read command's file operands, an input redirection and a read inside sh -c, never a path inside text that echo or printf prints, a write target or a command that only lists; fails_when=printing a suggested cat command marks the skill opened and moves UNOPENED or NOT_MEASURABLE; why_new=review of #64 (quoted shell text could mark an unread skill as opened); seam=shellReads, skillUse; no_claim=every shell construct, such as command substitution or xargs, which are not reads here
  test("a shell read is a read command's operand, never text a command prints", () => {
    const skill = { name: "learn", roots: ["/h/.claude/skills/learn"] };
    const bash = (command: string): Call => ({ id: "b", tool: "Bash", input: { command }, ok: true, subagent: false });
    const opened = (command: string) => skillUse([bash(command)], skill).opened;
    expect(opened("echo 'cat /h/.claude/skills/learn/SKILL.md'")).toBe(false);
    expect(opened('printf "%s\\n" "head /h/.claude/skills/learn/SKILL.md"')).toBe(false);
    expect(opened("echo hi > /h/.claude/skills/learn/notes.md")).toBe(false);
    expect(opened("ls /h/.claude/skills/learn/ && echo done")).toBe(false);
    expect(opened('cd /tmp && cat "/h/.claude/skills/learn/SKILL.md" | head -5')).toBe(true);
    expect(opened("wc -l < /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(opened("/bin/bash -lc 'sed -n 1,20p /h/.claude/skills/learn/refs/a.md'")).toBe(true);
    expect(opened("LC_ALL=C grep -n step /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(shellReads("cat a b; echo 'cat c' && bash -c \"head -3 d\" | tail -1 e")).toEqual(["a", "b", "d", "e"]);
    expect(opened("grep /h/.claude/skills/learn/SKILL.md config.json")).toBe(false);
    expect(opened("cat manifest.json # wired /h/.claude/skills/learn/SKILL.md")).toBe(false);
    expect(opened("awk '{print}' /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(opened("grep -e step /h/.claude/skills/learn/SKILL.md")).toBe(true);
    expect(shellReads("sed -n 1,5p f; grep -rn x d1 d2; a#b; cat g#h")).toEqual(["f", "d1", "d2", "g#h"]);
    expect(shellReads("grep -f /h/s/SKILL.md c.json; awk -f /h/s/scan.awk d.txt; grep --file=p.txt /h/s/a.md; grep -fp /h/s/b.md; grep -e x /h/s/c.md; sed -f /h/s/x.sed e")).toEqual(["/h/s/SKILL.md", "c.json", "/h/s/scan.awk", "d.txt", "p.txt", "/h/s/a.md", "p", "/h/s/b.md", "/h/s/c.md", "/h/s/x.sed", "e"]);
  });
});

// Copyright (c) 2026 Garry Tan. MIT License.
import { expect, test } from "bun:test";
import { WRAPUP } from "../../lanes/outcome-skills/pfchecks/arms.ts";
import { codeTest, pLoaded, pProcedure, ranChecker } from "../../lanes/outcome-skills/pfchecks/exposure.ts";

const tool = (name: string, input: object) => ({ type: "AssistantMessage", content: [{ type: "tool_use", name, input }] });
test("P loaded needs the skill heading and a Read of statechart's SKILL.md", () => {
  const body = { type: "UserMessage", content: [{ type: "text", text: "# Create a formal verification skill\nSteps" }] };
  const read = tool("Read", { file_path: "/opt/pstack/skills/statechart/SKILL.md" });
  expect(pLoaded([body, read]).loaded).toBe(true);
  expect(pLoaded([body]).loaded).toBe(false);
  expect(pLoaded([read]).loaded).toBe(false);
});
const sdkRead = { type: "AssistantMessage", phase: "task", content: [{ type: "tool_use", name: "Read", input: { file_path: "/opt/pf-pstack/skills/statechart/SKILL.md" } }] };
const ccUser = (content: unknown) => ({ type: "user", message: { role: "user", content } });
test("P loaded reads the skill body from Claude Code's own transcript (claude-session.jsonl), where 2.1.310 and later put it", () => {
  const cc = [ccUser("<command-name>/create-formal-verification-skill</command-name>"), ccUser([{ type: "text", text: "# Create a formal verification skill\nSteps" }])];
  expect(pLoaded([sdkRead], cc)).toEqual({ body: true, statechart_read: true, loaded: true });
  expect(pLoaded([sdkRead], [ccUser("/create-formal-verification-skill model the state machine behind this bug report")])).toEqual({ body: false, statechart_read: true, loaded: false });
  expect(pLoaded([sdkRead], null).loaded).toBe(false);
});
test("only the task turn counts: a body after the wrap-up turn's text, or a Read in the wrap-up phase, does not", () => {
  expect(pLoaded([sdkRead], [ccUser("the task turn"), ccUser(WRAPUP), ccUser("# Create a formal verification skill")]).body).toBe(false);
  expect(pLoaded([{ ...sdkRead, phase: "wrapup" }], [ccUser("# Create a formal verification skill")]).statechart_read).toBe(false);
});
test("a checker run on the frozen list", () => {
  expect(ranChecker([tool("Bash", { command: "java -cp $TLA2TOOLS tlc2.TLC Spec.tla" })])).toBe(true);
  expect(ranChecker([tool("Bash", { command: "java -jar /tools/tla2tools.jar -config M.cfg M.tla" })])).toBe(true);
  expect(ranChecker([tool("Bash", { command: "go test ./..." })])).toBe(false);
});
test("P's procedure and a code test in T", () => {
  expect(pProcedure([{ path: ".claude/skills/conn-fsm/SKILL.md", text: "---\nname: conn\n---\nbody" }])).toBe(true);
  expect(pProcedure([{ path: ".claude/skills/conn-fsm/SKILL.md", text: "no front matter" }])).toBe(false);
  expect(codeTest("go", new Set(), [{ path: "a_test.go", status: "A" }])).toBe(true);
  expect(codeTest("go", new Set(), [{ path: "a.go", status: "M" }, { path: "x_test.go", status: "D" }])).toBe(false);
});

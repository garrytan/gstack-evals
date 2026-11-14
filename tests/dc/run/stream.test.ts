// Copyright (c) 2026 Garry Tan. MIT License.
// Wiring item 9: a session that ended on a malformed tool call, read from the Claude Code stream.
import { describe, expect, test } from "bun:test";
import { toolCallEnd } from "../../../lanes/design-constructed/run/stream.ts";

const crash = { kind: "arm_failure", failure: "harness_crash" } as const;
const tx = (...m: unknown[]) => m.map((x) => JSON.stringify(x)).join("\n") + "\n";
const rejected = (content: unknown, parent: string | null = null) => ({ type: "user", parent_tool_use_id: parent, message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content }] } });
const invalid = [{ type: "text", text: "<tool_use_error>InputValidationError: Edit failed: old_string is required</tool_use_error>" }];

describe("toolCallEnd", () => {
  test("block-shaped tool_result text and interleaved system lines still read as a malformed tool call", () => {
    expect(toolCallEnd(tx(rejected(invalid), { type: "system", subtype: "status" }, { type: "result", subtype: "error_during_execution" }), crash)).toEqual({ kind: "arm_failure", failure: "malformed_tool_call" });
  });
  test("a subagent's rejected call, a success result or a completed session keep their termination", () => {
    expect(toolCallEnd(tx(rejected(invalid, "task-1"), { type: "result", subtype: "error_during_execution" }), crash)).toEqual(crash);
    expect(toolCallEnd(tx(rejected(invalid), { type: "result", subtype: "success" }), crash)).toEqual(crash);
    expect(toolCallEnd(tx(rejected(invalid), { type: "result", subtype: "error_during_execution" }), { kind: "completed" })).toEqual({ kind: "completed" });
    expect(toolCallEnd("not json\n", crash)).toEqual(crash);
  });
});

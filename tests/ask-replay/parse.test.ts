import { describe, expect, test } from "bun:test";
import { cappedReply, classify, parseReply, safetyStop } from "../../lanes/ask-replay/parse.ts";

describe("reply parsing (section 6)", () => {
  test("whole JSON, case-insensitive action, optional ledger fields kept as sent", () => {
    expect(parseReply('{"action":"fold","reason":"r","repeats":"new"}')).toEqual({ action: "FOLD", reason: "r", repeats: "new" });
    expect(parseReply('{"action":" Send "}')).toEqual({ action: "SEND", reason: "" });
    expect(parseReply('{"action":"SEND","reask_reason":null}')).toEqual({ action: "SEND", reason: "", reask_reason: null });
  });
  test("otherwise the last JSON object in the text with a valid action", () => {
    expect(parseReply('first {"action":"SEND"} then {"note":"x"} and {"action":"DROP","reason":"a } in a string"} end')?.action).toBe("DROP");
    expect(parseReply('{"outer":{"action":"FOLD"}}')?.action).toBe("FOLD");
    expect(parseReply("no json here")).toBeNull();
    expect(parseReply('{"action":"WAIT"}')).toBeNull();
    expect(parseReply('{"action":"SEND"')).toBeNull();
  });
  test("safety stops are frozen per provider", () => {
    expect(safetyStop("anthropic", { stop_reason: "refusal" })).toBe(true);
    expect(safetyStop("anthropic", { stop_reason: "end_turn" })).toBe(false);
    expect(safetyStop("openai", { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] })).toBe(true);
    expect(safetyStop("openai", { incomplete_details: { reason: "content_filter" } })).toBe(true);
    expect(safetyStop("openai", { choices: [{ finish_reason: "content_filter" }] })).toBe(true);
    expect(safetyStop("openai", { output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] })).toBe(false);
    expect(safetyStop("openrouter", { choices: [{ finish_reason: "content_filter" }] })).toBe(true);
    expect(safetyStop("openrouter", { choices: [{ finish_reason: "stop" }] })).toBe(false);
  });
  test("output cap hits are read per provider", () => {
    expect(cappedReply("anthropic", { stop_reason: "max_tokens" })).toBe(true);
    expect(cappedReply("openai", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toBe(true);
    expect(cappedReply("openrouter", { choices: [{ finish_reason: "length" }] })).toBe(true);
  });
  test("classify: no answer or a non-200 is upstream; a 200 is a reply, unparsable or a safety stop", () => {
    expect(classify("anthropic", null).kind).toBe("upstream");
    expect(classify("anthropic", { status: 529, body: {} }).kind).toBe("upstream");
    expect(classify("anthropic", { status: 200, body: { content: [{ type: "text", text: '{"action":"DROP"}' }] } })).toMatchObject({ kind: "reply", reply: { action: "DROP" } });
    expect(classify("openrouter", { status: 200, body: { choices: [{ message: { content: "hmm" }, finish_reason: "stop" }] } }).kind).toBe("unparsable");
    expect(classify("anthropic", { status: 200, body: { stop_reason: "refusal", content: [{ type: "text", text: '{"action":"SEND"}' }] } }).kind).toBe("safety");
  });
});

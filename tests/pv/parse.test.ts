// Copyright (c) 2026 Garry Tan. MIT License.
// pv parse: the plan-changes parser's strict parse and its one lenient parse, the normalizer, and each attempt's outcome
// under prereg 2026-11-08-geva-403 section 6 (block, no-block, an infrastructure failure by name, web contamination). Keyless.
import { describe, expect, test } from "bun:test";
import type { Termination } from "../../src/types.ts";
import { dropTrailingCommas, endStateOf, MAX_CHANGES, MAX_WORDS, normalizeChanges, normalizeItem, parsePv, pvOutcome, webUses } from "../../lanes/product-value/parse.ts";

const fence = (label: string, body: string) => "~~~".replaceAll("~", "\u0060") + label + "\n" + body + "\n" + "~~~".replaceAll("~", "\u0060");
const assistant = (content: unknown[], parent: string | null = null) => JSON.stringify({ type: "assistant", parent_tool_use_id: parent, message: { content } });
const user = (content: unknown[], parent: string | null = null) => JSON.stringify({ type: "user", parent_tool_use_id: parent, message: { content } });
const say = (t: string) => assistant([{ type: "text", text: t }]);
const nd = (...lines: string[]) => lines.join("\n") + "\n";
const BLOCK = fence("plan-changes", JSON.stringify({ changes: ["Ship the importer first", "Add a rollback plan"] }));
const end = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, ...extra }) as unknown as Termination;
const webCall = (id: string, parent: string | null, result: Record<string, unknown>) => [assistant([{ type: "tool_use", id, name: "WebSearch", input: { query: "competitors" } }], parent), user([{ type: "tool_result", tool_use_id: id, content: "results", ...result }], parent)];

describe("the strict parse and the one lenient parse", () => {
  test("strict: the last plan-changes block of the last text that holds one", () => {
    expect(parsePv(["draft\n" + fence("plan-changes", '{"changes": ["old"]}'), "final\n" + BLOCK])).toMatchObject({ kind: "changes", changes: ["Ship the importer first", "Add a rollback plan"], lenient: null });
    expect(parsePv([BLOCK, "a later text with no block"])).toMatchObject({ kind: "changes", changes: ["Ship the importer first", "Add a rollback plan"], lenient: null });
    expect(parsePv([fence("plan-changes", '{"changes": []}')])).toMatchObject({ kind: "changes", changes: [], lenient: null });
  });

  test("lenient: a fence labelled otherwise, trailing commas and a bare array of strings, each one recorded", () => {
    expect(parsePv([fence("json", '{"changes": ["a"]}')])).toMatchObject({ kind: "changes", changes: ["a"], lenient: ["label"] });
    expect(parsePv([fence("plan-changes", '{"changes": ["a", "b",],}')])).toMatchObject({ kind: "changes", changes: ["a", "b"], lenient: ["commas"] });
    expect(parsePv([fence("plan-changes", '["a", "b"]')])).toMatchObject({ kind: "changes", changes: ["a", "b"], lenient: ["array"] });
    expect(parsePv([fence("text", '["a", "b",]')])).toMatchObject({ kind: "changes", changes: ["a", "b"], lenient: ["label", "commas", "array"] });
  });

  test("no-block: no fence, a failed lenient parse, and a labelled block that fails reads no other fence", () => {
    expect(parsePv(["Here are my thoughts, with no block."])).toMatchObject({ kind: "no-block", body_sha256: null });
    expect(parsePv([fence("plan-changes", '{"changes": "one string"}')]).kind).toBe("no-block");
    expect(parsePv([fence("plan-changes", "[1, 2]")]).kind).toBe("no-block");
    expect(parsePv([fence("plan-changes", '{"changes": 5}') + "\n" + fence("json", '["x"]')]).kind).toBe("no-block");
    expect(parsePv([fence("plan-changes", '{"changes": ["a" "b"]}')]).kind).toBe("no-block");
  });

  test("dropTrailingCommas keeps commas inside strings", () => {
    expect(dropTrailingCommas('{"a": "x,]", "b": [1, 2, ], }')).toBe('{"a": "x,]", "b": [1, 2 ] }');
    expect(dropTrailingCommas('["say \\", ]"]')).toBe('["say \\", ]"]');
  });
});

describe("the normalizer", () => {
  test("strips markdown and leading numbering and collapses whitespace", () => {
    expect(normalizeItem("1. **Ship** the  \u0060importer\u0060   first")).toEqual({ text: "Ship the importer first", cut: false });
    expect(normalizeItem("## [Docs](https://example.com/docs) for _setup_")).toEqual({ text: "Docs for setup", cut: false });
    expect(normalizeItem("- (2) Add a ~~quick~~ rollback\nplan")).toEqual({ text: "Add a quick rollback plan", cut: false });
    expect(normalizeItem("3) 4. Nested numbering")).toEqual({ text: "Nested numbering", cut: false });
    expect(normalizeItem("Keep 2.5x headroom and snake_case names")).toEqual({ text: "Keep 2.5x headroom and snake_case names", cut: false });
  });

  test("cuts at the 40th word: 40 words stay whole, 41 are cut", () => {
    const w = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
    expect(MAX_WORDS).toBe(40);
    expect(normalizeItem(w(40))).toEqual({ text: w(40), cut: false });
    const cut = normalizeItem(w(41));
    expect(cut.cut).toBe(true);
    expect(cut.text.startsWith(w(40))).toBe(true);
    expect(cut.text.includes("w40")).toBe(false);
  });

  test("keeps the first five strings and counts words, items and cuts", () => {
    expect(MAX_CHANGES).toBe(5);
    const long = Array.from({ length: 45 }, () => "word").join(" ");
    const n = normalizeChanges(["a b", 7, "**c**", "d", long, "e", "f"]);
    expect(n.list.slice(0, 4)).toEqual(["a b", "c", "d", n.list[3]!]);
    expect([n.items, n.cut, n.list.length, n.words]).toEqual([5, 1, 5, 2 + 1 + 1 + 40 + 1]);
    expect(n.list).not.toContain("f");
  });
});

describe("an attempt's outcome", () => {
  const blockT = nd(say("Review.\n\n" + BLOCK));
  const plainT = nd(say("Review with no block."));
  test("a block wins over how the session ended; no block after a completion or a turn cap is no-block", () => {
    expect(pvOutcome(end("completed"), blockT).outcome).toEqual({ state: "block" });
    expect(pvOutcome(end("timeout"), blockT).outcome).toEqual({ state: "block" });
    expect(pvOutcome(end("completed"), plainT).outcome).toEqual({ state: "no-block" });
    expect(pvOutcome(end("turn_cap"), plainT).outcome).toEqual({ state: "no-block" });
  });

  test("each infrastructure failure gets its named reason", () => {
    const reason = (t: Termination, transcript: string | null = plainT) => {
      const o = pvOutcome(t, transcript).outcome;
      return o.state === "infra" ? o.reason : o.state;
    };
    expect(reason(end("timeout"))).toBe("harness timeout");
    expect(reason(end("missing", { code: "E_BACKGROUND_DEADLINE" }))).toBe("harness timeout");
    expect(reason(end("allowance_stop"))).toBe("allowance stop");
    expect(reason(end("arm_failure", { failure: { code: "E_AGENT_CRASH" } }))).toBe("crash");
    expect(reason(end("completed"), null)).toBe("crash");
    expect(pvOutcome(end("completed"), null).parse.kind).toBe("unreadable");
    expect(reason(end("infra", { incident: "529" }))).toBe("API error");
    expect(reason(end("missing", { code: "E_PROVIDER" }), nd(JSON.stringify({ type: "result", is_error: true, result: "Prompt is too long: 210000 tokens > 200000 maximum" })))).toBe("context overflow");
    expect(reason(end("missing", { code: "E_PROVIDER" }), nd(assistant([{ type: "text", text: "API Error: input is too long for the context window" }]).replace('"type":"assistant"', '"type":"assistant","error":"invalid_request"')))).toBe("context overflow");
    expect(reason(end("cap_stop"))).toBe("cap");
  });

  test("a successful web result contaminates the session, a subagent's included; a refused call does not", () => {
    const ok = pvOutcome(end("completed"), nd(...webCall("t1", null, {}), say(BLOCK))).outcome;
    expect(ok).toEqual({ state: "contaminated", web: [{ tool: "WebSearch", id: "t1", subagent: false }] });
    expect(webUses(nd(...webCall("t2", "task-1", {})))).toEqual([{ tool: "WebSearch", id: "t2", subagent: true }]);
    expect(pvOutcome(end("completed"), nd(...webCall("t3", null, { is_error: true }), say(BLOCK))).outcome).toEqual({ state: "block" });
    expect(webUses(nd(...webCall("t4", null, { content: "<tool_use_error>No such tool available: WebSearch</tool_use_error>" })))).toEqual([]);
    expect(webUses(nd(assistant([{ type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://example.com" }] }])))).toHaveLength(1);
    expect(webUses(nd(assistant([{ type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }])))).toEqual([]);
  });

  test("end states: an infrastructure failure on the retry is missing; a cap stop has none", () => {
    expect(endStateOf({ state: "block" })).toBe("block");
    expect(endStateOf({ state: "no-block" })).toBe("no-block");
    expect(endStateOf({ state: "contaminated", web: [] })).toBe("contaminated");
    expect(endStateOf({ state: "infra", reason: "API error", detail: "missing (E_PROVIDER)" })).toBe("missing");
    expect(endStateOf({ state: "cap" })).toBeNull();
  });
});

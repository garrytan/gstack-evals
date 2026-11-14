// Copyright (c) 2026 Garry Tan. MIT License.
// The plan-changes reader: the strict parse, the three frozen lenient forms, the normalizer, length counts and the web and evidence reads.
import { describe, expect, test } from "bun:test";
import { cellStats, evidenceOpened, normalizeChanges, normalizeItem, parseChanges, renderList, transcriptParse, webUses } from "../../../lanes/design-constructed/score/parse.ts";

const F = "```";
const fence = (label: string, body: string) => F + label + "\n" + body + "\n" + F;

describe("parseChanges", () => {
  test("the strict parse takes the last plan-changes fence in the latest text that holds one", () => {
    const p = parseChanges(["a\n" + fence("plan-changes", '{"changes": ["one"]}'), "b\n" + fence("plan-changes", '{"changes": ["two"], "note": 1}') + "\n" + fence("plan-changes", '{"changes": ["three"]}'), "c, no fence"]);
    expect(p).toMatchObject({ kind: "changes", changes: ["three"], lenient: null });
  });
  test("each frozen lenient form parses and says which it used", () => {
    expect(parseChanges([fence("json", '{"changes": ["x"]}')])).toMatchObject({ kind: "changes", lenient: ["label"] });
    expect(parseChanges([fence("plan-changes", '{"changes": ["x",],}')])).toMatchObject({ kind: "changes", lenient: ["commas"] });
    expect(parseChanges([fence("plan-changes", '["x", "y"]')])).toMatchObject({ kind: "changes", changes: ["x", "y"], lenient: ["array"] });
    expect(parseChanges([fence("text", '["x", "y",]')])).toMatchObject({ kind: "changes", lenient: ["label", "commas", "array"] });
  });
  test("anything outside the three forms is no-block", () => {
    expect(parseChanges([fence("plan-changes", '{"edits": ["x"]}')]).kind).toBe("no-block");
    expect(parseChanges([fence("plan-changes", '{"changes": [1, 2]}')]).kind).toBe("no-block");
    expect(parseChanges([fence("plan-changes", "not json")]).kind).toBe("no-block");
    expect(parseChanges(["no fence at all"])).toMatchObject({ kind: "no-block", body_sha256: null });
  });
  test("a comma inside a string is kept", () => {
    expect(parseChanges([fence("plan-changes", '{"changes": ["a, ]b"]}')])).toMatchObject({ kind: "changes", changes: ["a, ]b"] });
  });
  test("transcriptParse reads the main agent's text", () => {
    const t = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done\n" + fence("plan-changes", '{"changes": ["z"]}') }] } });
    expect(transcriptParse(t)).toMatchObject({ kind: "changes", changes: ["z"] });
  });
});

describe("normalization", () => {
  test("markdown, numbering and bullets go; the 40th word ends the change", () => {
    expect(normalizeItem("- 2) **Show** _skeleton_ `rows` ~~now~~").text).toBe("Show skeleton rows now");
    const long = Array.from({ length: 41 }, (_, i) => "w" + i).join(" ");
    expect(normalizeItem(long)).toEqual({ text: long.split(" ").slice(0, 40).join(" "), cut: true });
    expect(normalizeItem(long.split(" ").slice(0, 40).join(" ")).cut).toBe(false);
  });
  test("the first 8 strings stay and counts follow the cut", () => {
    const n = normalizeChanges(["a b", 3, "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(n.list).toEqual(["a b", "c", "d", "e", "f", "g", "h", "i"]);
    expect(n.words).toBe(9);
    expect(renderList(["x", "y"])).toBe("1. x\n2. y");
  });
  test("cellStats gives mean words, items and the cut share over block rows", () => {
    const s = cellStats([{ end: "b", words: 10, items: 2, cut: 1 }, { end: "b", words: 20, items: 2, cut: 0 }, { end: "n", words: 0, items: 0, cut: 0 }], ["b", "n"], ["b"]);
    expect(s).toEqual({ planned: 3, counts: { b: 2, n: 1 }, mean_words: 15, mean_items: 2, cut_share: 0.25 });
  });
});

describe("web and evidence reads", () => {
  const line = (o: object) => JSON.stringify(o);
  test("a successful WebSearch or WebFetch result counts, a refused one doesn't", () => {
    const t = [line({ type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "WebSearch", input: {} }, { type: "tool_use", id: "2", name: "WebFetch", input: {} }] } }), line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "1", content: "<tool_use_error>denied</tool_use_error>" }, { type: "tool_result", tool_use_id: "2", content: "ok" }] } })].join("\n");
    expect(webUses(t).map((u) => u.tool)).toEqual(["WebFetch"]);
  });
  test("an evidence path counts when a tool input names it at a path boundary", () => {
    const t = line({ type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Grep", input: { pattern: "x", path: "docs/a.md" } }, { type: "tool_use", id: "2", name: "Bash", input: { command: "wc -l xdocs/b.md docs/c.md.old" } }] } });
    expect(evidenceOpened(t, ["docs/a.md", "docs/b.md", "docs/c.md"])).toEqual(["docs/a.md"]);
  });
});

// Value: protects=section 6's parser, its one lenient parse and the normalizer, which decide W's no-block rows and what every judge reads.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ANSWER_NOW, CLOSING, EVERYTHING_ELSE, FIRST_LINE, FORCED_LINE, PREREG, TEMPLATE, firstMessage, fullInformation } from "../../lanes/office-hours-founder/frozen.ts";
import { normalizeBlock, parseFirstMove, renderBlock, replies, sessionParse } from "../../lanes/office-hours-founder/parse.ts";

const fence = (label: string, body: string) => "Advice.\n\n```" + label + "\n" + body + "\n```\n";
const full = { first_move: "Sell missed-call text reminders to office managers at two-chair dental practices.", next_action: "Call five office managers.", other_moves: ["Build the platform.", "Raise money.", "Third one."], doubt: "The platform." };

describe("frozen strings", () => {
  test("every cross-cutting frozen string appears in the prereg byte for byte", () => {
    const prereg = readFileSync(PREREG, "utf8");
    for (const s of [TEMPLATE, CLOSING, ANSWER_NOW, FORCED_LINE, EVERYTHING_ELSE, ...Object.values(FIRST_LINE)]) expect(prereg.includes(s)).toBe(true);
  });
  test("the first message and the full-information prompt keep their order", () => {
    expect(firstMessage(FIRST_LINE.lens, " pitch \n")).toBe(FIRST_LINE.lens + "\n\npitch\n\n" + TEMPLATE);
    expect(fullInformation("pitch", ["a", "b"], true)).toBe(FIRST_LINE.none + "\n\npitch\n\n" + EVERYTHING_ELSE + "\n- a\n- b\n\n" + TEMPLATE + "\n" + ANSWER_NOW);
  });
});

describe("parseFirstMove", () => {
  test("strict: the last first-move fence of the reply", () => {
    const p = parseFirstMove([fence("first-move", JSON.stringify({ ...full, first_move: "old" })), fence("First-Move", JSON.stringify(full))]);
    expect(p.kind === "block" && p.block.first_move).toBe(full.first_move);
    expect(p.kind === "block" && p.lenient).toBeNull();
  });
  test("lenient: trailing commas, and a missing optional field read as empty", () => {
    const p = parseFirstMove([fence("first-move", '{"first_move": "x", "next_action": "y", "other_moves": ["a",],}')]);
    expect(p).toMatchObject({ kind: "block", block: { doubt: "", other_moves: ["a"] }, lenient: ["commas", "optional"] });
  });
  test("lenient: a fence labelled otherwise needs all four keys", () => {
    expect(parseFirstMove([fence("json", JSON.stringify(full)), fence("bash", "ls")])).toMatchObject({ kind: "block", lenient: ["label"] });
    expect(parseFirstMove([fence("json", JSON.stringify({ first_move: "x", next_action: "y" }))]).kind).toBe("no-block");
  });
  test("no-block: empty or missing first_move, missing next_action, wrong types", () => {
    expect(parseFirstMove([fence("first-move", JSON.stringify({ ...full, first_move: "  " }))]).kind).toBe("no-block");
    expect(parseFirstMove([fence("first-move", JSON.stringify({ next_action: "y", other_moves: [], doubt: "" }))]).kind).toBe("no-block");
    expect(parseFirstMove([fence("first-move", JSON.stringify({ first_move: "x", other_moves: [], doubt: "" }))]).kind).toBe("no-block");
    expect(parseFirstMove([fence("first-move", JSON.stringify({ ...full, other_moves: "a" }))]).kind).toBe("no-block");
    expect(parseFirstMove(["no fence here"]).kind).toBe("no-block");
  });
});

describe("normalizeBlock", () => {
  test("cuts each field at its frozen word count and keeps the uncut first move", () => {
    const long = (n: number) => Array.from({ length: n }, (_, i) => "w" + i).join(" ");
    const n = normalizeBlock({ first_move: "**" + long(41) + "**", next_action: long(31), other_moves: [long(26), long(25), "dropped"], doubt: "1. " + long(25) });
    expect(n.words).toEqual({ first_move: 40, next_action: 30, other_moves: 50, doubt: 25 });
    expect(n.cut).toEqual({ first_move: true, next_action: true, other_moves: true, doubt: false });
    expect(n.first_move_full.split(" ").length).toBe(41);
    expect(n.block.other_moves.length).toBe(2);
    const at40 = normalizeBlock({ first_move: long(40), next_action: "", other_moves: [], doubt: "" });
    expect(at40.cut.first_move).toBe(false);
  });
  test("strips markdown and renders four labelled lines", () => {
    const n = normalizeBlock({ first_move: "- Sell [reminders](http://x) to `offices`", next_action: "## Call", other_moves: [], doubt: "" });
    expect(renderBlock(n)).toBe("First move: Sell reminders to offices\nNext action: Call\nOther moves weighed: (none)\nDoubt: (none)");
  });
});

describe("replies", () => {
  test("splits main-agent texts at turn results and reads the last reply", () => {
    const line = (o: unknown) => JSON.stringify(o);
    const text = (t: string, parent: string | null = null) => line({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "text", text: t }] } });
    const t = [text("Who pays?"), line({ type: "result", subtype: "success" }), text("sub", "toolu_1"), text(fence("first-move", JSON.stringify(full))), line({ type: "result", subtype: "success" })].join("\n");
    expect(replies(t)).toEqual([["Who pays?"], [fence("first-move", JSON.stringify(full))]]);
    expect(sessionParse(t).kind).toBe("block");
  });
});

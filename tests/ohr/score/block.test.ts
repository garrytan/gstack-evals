// Copyright (c) 2026 Garry Tan. MIT License.
// The rewrite eval's block parser (prereg sections 4 step 4 and 5; score/README.md build-time choices 1 to 9).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseBlock, renderBlock, words } from "../../../lanes/office-hours-rewrite/score/block.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const PLAIN = "Thanks.\nDECISION: Do not raise yet.\nNEXT ACTION: You email three buyers by Friday.\nWHY: No one has paid.";

describe("block parser", () => {
  test("reads a plain block and hashes the body", () => {
    const p = parseBlock(PLAIN);
    expect(p).toEqual({ kind: "block", block: { decision: "Do not raise yet.", next_action: "You email three buyers by Friday.", why: "No one has paid." }, cut: { decision: false, next_action: false, why: false }, body_sha256: sha(PLAIN) });
  });
  test("choice 1: labels match in any case", () => {
    const p = parseBlock("decision: a\nNext Action: b\nwhy: c");
    expect(p.kind === "block" && p.block).toEqual({ decision: "a", next_action: "b", why: "c" });
  });
  test("choice 2: markdown emphasis around the label or the value is dropped", () => {
    const p = parseBlock("**DECISION:** a\n**NEXT ACTION**: b\n__WHY:__ _c_");
    expect(p.kind === "block" && p.block).toEqual({ decision: "a", next_action: "b", why: "c" });
  });
  test("choice 3: list, quote, heading and number markers before a label are dropped", () => {
    const p = parseBlock("> - DECISION: a\n1. NEXT ACTION: b\n### WHY: c");
    expect(p.kind === "block" && p.block).toEqual({ decision: "a", next_action: "b", why: "c" });
    const q = parseBlock("* DECISION: a\n+ NEXT ACTION: b\n2) WHY: c");
    expect(q.kind === "block" && q.block).toEqual({ decision: "a", next_action: "b", why: "c" });
  });
  test("choice 4: NEXT and ACTION may be joined by spaces, a hyphen or an underscore", () => {
    for (const l of ["NEXT  ACTION", "NEXT-ACTION", "NEXT_ACTION"]) {
      const p = parseBlock("DECISION: a\n" + l + ": b\nWHY: c");
      expect(p.kind === "block" && p.block.next_action).toBe("b");
    }
  });
  test("choice 5: a label must open its line and carry a colon", () => {
    expect(parseBlock("My DECISION: a\nNEXT ACTION: b\nWHY: c").kind).toBe("no-block");
    expect(parseBlock("DECISION a\nNEXT ACTION: b\nWHY: c").kind).toBe("no-block");
  });
  test("choice 6: a field runs to the next label, a fence or a thematic break, and continuation lines join with spaces", () => {
    const p = parseBlock("DECISION: Do not\nraise yet.\n\nNEXT ACTION: b\nWHY:\n- one\n- two\n\n---\nGood luck.");
    expect(p.kind === "block" && p.block).toEqual({ decision: "Do not raise yet.", next_action: "b", why: "one two" });
    const f = parseBlock("```text\nDECISION: a\nNEXT ACTION: b\nWHY: c\n```\nBye.");
    expect(f.kind === "block" && f.block).toEqual({ decision: "a", next_action: "b", why: "c" });
  });
  test("choice 7: the last line of each label wins", () => {
    const p = parseBlock("DECISION: old\nNEXT ACTION: old\nWHY: old\nLater:\nDECISION: new\nNEXT ACTION: new\nWHY: new");
    expect(p.kind === "block" && p.block).toEqual({ decision: "new", next_action: "new", why: "new" });
  });
  test("choice 8: all three labels, with DECISION and NEXT ACTION non-empty; WHY may be empty", () => {
    expect(parseBlock("DECISION: a\nNEXT ACTION: b").kind).toBe("no-block");
    expect(parseBlock("DECISION: a\nWHY: c").kind).toBe("no-block");
    expect(parseBlock("NEXT ACTION: b\nWHY: c").kind).toBe("no-block");
    expect(parseBlock("DECISION: **\nNEXT ACTION: b\nWHY: c").kind).toBe("no-block");
    expect(parseBlock("DECISION: a\nNEXT ACTION:\nWHY: c").kind).toBe("no-block");
    const p = parseBlock("DECISION: a\nNEXT ACTION: b\nWHY:");
    expect(p.kind === "block" && p.block.why).toBe("");
    const n = parseBlock("no block here");
    expect(n).toEqual({ kind: "no-block", reason: "missing DECISION, NEXT ACTION, WHY", body_sha256: sha("no block here") });
  });
  test("choice 9: each field is cut at 40 words and the cut is recorded", () => {
    const forty = Array.from({ length: 40 }, (_, i) => "w" + i).join(" ");
    const p = parseBlock("DECISION: " + forty + " extra more\nNEXT ACTION: " + forty + "\nWHY: x");
    expect(p.kind).toBe("block");
    if (p.kind !== "block") return;
    expect(p.block.decision).toBe(forty);
    expect(words(p.block.decision)).toHaveLength(40);
    expect(p.cut).toEqual({ decision: true, next_action: false, why: false });
  });
  test("renderBlock writes the three labelled lines a judge reads", () => {
    expect(renderBlock({ decision: "a", next_action: "b", why: "" })).toBe("DECISION: a\nNEXT ACTION: b\nWHY: ");
  });
});

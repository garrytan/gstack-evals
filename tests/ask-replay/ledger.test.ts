import { describe, expect, test } from "bun:test";
import { age, ledgerRows, ledgerView, multiDecision, rowId, rowText, sendCheck } from "../../lanes/ask-replay/ledger.ts";
import type { AskItem, Reply } from "../../lanes/ask-replay/types.ts";

const item = (): Pick<AskItem, "thread" | "at" | "earlier_asks"> => ({
  thread: "S1",
  at: "2026-10-20T12:00:00.000Z",
  earlier_asks: [
    { at: "2026-10-18T09:00:00.000Z", order: 3, text: "Rowan:\n\nA. Should we ship the planner now?", next_owner: { at: "2026-10-18T10:00:00.000Z", text: "Ship it." } },
    { at: "2026-10-20T11:30:00.000Z", order: 9, text: "## Heading\nTL;DR: two things\ngstack: ok 1.99\nShould the digest go out on Thursday?", next_owner: null },
  ],
});

describe("ask ledger rows (section 4)", () => {
  test("row text strips name lines, TL;DR lines, gstack: lines, headings and empty lines, capped at 300", () => {
    expect(rowText("Rowan:\n\nA. Should we ship?")).toBe("A. Should we ship?");
    expect(rowText("## Heading\nTL;DR: two things\ngstack: ok\n**Pat Owner:**\nReal line")).toBe("Real line");
    expect(rowText("x".repeat(400))).toHaveLength(300);
    expect(rowText("Rowan:")).toBe("Rowan:");
  });
  test("ids are q- and 12 hex of sha256 of thread, time and text", () => {
    expect(rowId("S1", "2026-10-18T09:00:00.000Z", "a")).toMatch(/^q-[0-9a-f]{12}$/);
    expect(rowId("S1", "t", "a")).not.toBe(rowId("S2", "t", "a"));
  });
  test("K1: a row is answered once an owner message follows it before the item, and the answer is quoted", () => {
    const rows = ledgerRows(item());
    expect(rows.map((r) => r.status)).toEqual(["answered", "open"]);
    expect(rows[0]!.answer).toBe("Ship it.");
    expect(rows[1]!.text).toBe("Should the digest go out on Thursday?");
  });
  test("ages and the view: open rows then answered rows, newest first", () => {
    expect(age("2026-10-20T11:30:00Z", "2026-10-20T12:00:00Z")).toBe("30 minutes");
    expect(age("2026-10-20T11:00:00Z", "2026-10-20T12:00:00Z")).toBe("1 hour");
    expect(age("2026-10-18T09:00:00Z", "2026-10-20T12:00:00Z")).toBe("2 days");
    const v = ledgerView(item());
    expect(v.indexOf("Waiting on you")).toBeLessThan(v.indexOf("Answered"));
    expect(v).toContain("(asked 30 minutes ago)");
    expect(v).toContain("Answer: Ship it.");
  });
  test("lettered decisions: more than one only with A and B lines", () => {
    expect(multiDecision("A. one thing\nB. another")).toBe(true);
    expect(multiDecision("**A)** one\n- (b) two")).toBe(true);
    expect(multiDecision("A. only one")).toBe(false);
    expect(multiDecision("Plan A or plan B?")).toBe(false);
  });
});

describe("the send-time check (rulings I1 and J1)", () => {
  const rows = ledgerRows(item());
  const [ans, open] = [rows[0]!.id, rows[1]!.id];
  const r = (x: Partial<Reply>) => sendCheck({ action: "SEND", reason: "", ...x } as Reply, rows);
  test("SEND or FOLD naming an answered row drops, quoting the answer", () => {
    expect(r({ repeats: ans })).toMatchObject({ final_action: "DROP", gate: "drop_answered", quoted: "Ship it." });
    expect(r({ action: "FOLD", repeats: ans })).toMatchObject({ final_action: "DROP", gate: "drop_answered" });
  });
  test("a reask reason keeps the agent's action; one that is only white space does not", () => {
    expect(r({ repeats: ans, reask_reason: "the date moved" })).toMatchObject({ final_action: "SEND", gate: "reask_kept", reask_reason: true });
    expect(r({ repeats: ans, reask_reason: " \t\n" })).toMatchObject({ final_action: "DROP", reask_reason: false });
  });
  test("SEND naming an open row folds; FOLD and DROP stand", () => {
    expect(r({ repeats: open })).toMatchObject({ final_action: "FOLD", gate: "fold_open" });
    expect(r({ action: "DROP", repeats: open })).toMatchObject({ final_action: "DROP", gate: "none" });
    expect(r({ action: "DROP", repeats: ans })).toMatchObject({ final_action: "DROP", gate: "none" });
  });
  test("a missing repeats field or an unknown id counts as new, each counted by kind", () => {
    expect(r({})).toMatchObject({ final_action: "SEND", repeats: "missing_field" });
    expect(r({ repeats: null })).toMatchObject({ repeats: "missing_field" });
    expect(r({ repeats: "q-000000000000" })).toMatchObject({ final_action: "SEND", repeats: "unknown_id" });
    expect(r({ repeats: " New " })).toMatchObject({ repeats: "new" });
    expect(r({ repeats: " " + open + " " })).toMatchObject({ final_action: "FOLD" });
  });
});

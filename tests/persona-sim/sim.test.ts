// Value: protects=the reusable simulated person's rendering, its output checks and its one retry (prereg section 4), which decide which founder turns exist and which sessions go missing.
import { describe, expect, test } from "bun:test";
import { MAX_REPLY_WORDS, NOTES, personTurn, readOutput, renderSystem, SIM_SHA256, toMessages, type PersonSheet, type SimRequest } from "../../src/persona-sim/sim.ts";

const sheet: PersonSheet = { rules: "Play the person.\n\n", persona: "A baker who sells sourdough starters.", opening: "I sell starters online.", items: [{ id: "a", text: "Ten people bought twice.", reveal_when: "Asked about repeat buyers." }, { id: "b", text: "Shipping costs eat half the price.", reveal_when: "Asked about costs." }] };
const transcript = [{ role: "assistant" as const, text: "Who buys twice?" }];
const ok = (reply: string, revealed: string[] = ["a"]) => JSON.stringify({ reply, revealed, rules: [3] });
const ids = new Set(["a", "b"]);

describe("rendering", () => {
  test("the system prompt is the rules text, a blank line and the sheet as JSON", () => {
    expect(renderSystem(sheet)).toBe("Play the person.\n\nThe sheet:\n" + JSON.stringify({ persona: sheet.persona, opening: sheet.opening, facts: sheet.items }, null, 2));
    expect(SIM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  test("assistant messages go as user messages and the person's replies as assistant messages", () => {
    expect(toMessages([{ role: "assistant", text: "q1" }, { role: "person", text: "r1" }, { role: "assistant", text: "q2" }])).toEqual([{ role: "user", content: "q1" }, { role: "assistant", content: "r1" }, { role: "user", content: "q2" }]);
  });
  test("a transcript must start and end with an assistant message", () => {
    expect(() => toMessages([])).toThrow("E_USAGE");
    expect(() => toMessages([{ role: "person", text: "r" }, { role: "assistant", text: "q" }])).toThrow("E_USAGE");
    expect(() => toMessages([{ role: "assistant", text: "q" }, { role: "person", text: "r" }])).toThrow("E_USAGE");
  });
});

describe("readOutput", () => {
  test("one JSON object, alone or as a whole fenced body; other keys ignored; duplicate ids dropped", () => {
    expect(readOutput(ok("Ten did."), ids)).toEqual({ reply: "Ten did.", revealed: ["a"], rules: [3] });
    expect(readOutput("\x60\x60\x60json\n" + ok("Ten did.") + "\n\x60\x60\x60", ids)).toMatchObject({ reply: "Ten did." });
    expect(readOutput("\x60\x60\x60\n" + ok("Ten did.") + "\n\x60\x60\x60", ids)).toMatchObject({ reply: "Ten did." });
    expect(readOutput(JSON.stringify({ reply: "x", revealed: ["a", "a"], rules: [], mood: "calm" }), ids)).toEqual({ reply: "x", revealed: ["a"], rules: [] });
  });
  test("the json check: prose, arrays, missing keys, wrong types and an empty reply", () => {
    for (const bad of ["Here: " + ok("x"), "[]", '{"reply":"x","revealed":[]}', '{"reply":"x","revealed":"a","rules":[]}', '{"reply":"x","revealed":[],"rules":[1.5]}', '{"reply":"  ","revealed":[],"rules":[]}', "\x60\x60\x60json\n" + ok("x") + "\n\x60\x60\x60\nmore"]) expect(readOutput(bad, ids)).toEqual({ checks: ["json"] });
  });
  test("the ids and words checks, together", () => {
    const long = Array.from({ length: MAX_REPLY_WORDS + 1 }, () => "w").join(" ");
    expect(readOutput(ok(long, ["z"]), ids)).toEqual({ checks: ["ids", "words"] });
    expect(readOutput(ok(long.replace(/^w /, "")), ids)).toMatchObject({ revealed: ["a"] });
  });
});

describe("personTurn", () => {
  test("a retry sends the same input with each failed check's fixed note at the end of the system prompt", async () => {
    const seen: SimRequest[] = [];
    const t = await personTurn({ sheet, transcript, call: async (r) => (seen.push(r), { kind: "text", text: seen.length === 1 ? ok("x", ["z"]) : ok("Ten did.") }) });
    expect(t).toMatchObject({ kind: "reply", reply: "Ten did.", attempts: 2 });
    expect(seen[1]!.messages).toEqual(seen[0]!.messages);
    expect(seen[1]!.system).toBe(seen[0]!.system + "\n\n" + NOTES.ids);
    expect(t.requests).toHaveLength(2);
  });
  test("a call failure returns at once, distinct from a check failure, on either attempt", async () => {
    let n = 0;
    const first = await personTurn({ sheet, transcript, call: async () => (n++, { kind: "call-failed", reason: "allowance", detail: "no room" }) });
    expect(first).toMatchObject({ kind: "call-failed", reason: "allowance", detail: "no room" });
    expect(n).toBe(1);
    n = 0;
    const second = await personTurn({ sheet, transcript, call: async () => (n++ ? { kind: "call-failed", reason: "provider", detail: "HTTP 500" } : { kind: "text", text: "no" }) });
    expect(second).toMatchObject({ kind: "call-failed", reason: "provider" });
    expect(second.requests).toHaveLength(2);
  });
  test("two failed checks on one turn end as check-failed with the second attempt's checks", async () => {
    const t = await personTurn({ sheet, transcript, call: async () => ({ kind: "text", text: "no" }) });
    expect(t).toEqual({ kind: "check-failed", checks: ["json"], attempts: 2, requests: expect.any(Array) });
  });
});

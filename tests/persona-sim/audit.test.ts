// Value: protects=the generic per-turn audit (prereg section 4): its prompt, the unreadable-answer resend and fail-closed rule, and how two auditors combine into fail, disputed and clean.
import { describe, expect, test } from "bun:test";
import { auditPrompt, auditTurn, combine, readAudit, UNREADABLE, type AuditInput } from "../../src/persona-sim/audit.ts";

const violations = [{ code: "X1", definition: "first: the reply does one thing" }, { code: "X2", definition: "second: the reply does another" }];
const input: AuditInput = { sheet: { rules: "never shown", persona: "A potter.", opening: "I sell mugs.", items: [{ id: "a", text: "Cafes reorder monthly.", reveal_when: "Asked about repeat orders." }] }, last: "Who reorders?", reply: "Two cafes do.", logged: ["a"] };
const codes = new Set(["X1", "X2"]);

describe("audit", () => {
  test("the prompt carries the definitions, the sheet, the last message, the reply and the logged ids, never the rules text", () => {
    const p = auditPrompt(violations, input);
    for (const s of ["- X1, first: the reply does one thing", "- X2, second: the reply does another", "The sheet:\n{", "Cafes reorder monthly.", "<<<\nWho reorders?\n>>>", "<<<\nTwo cafes do.\n>>>", '["a"]']) expect(p).toContain(s);
    expect(p).not.toContain("never shown");
  });
  test("readAudit takes the listed codes only, alone or fenced", () => {
    expect(readAudit('{"marked": ["X2", "X2"]}', codes)).toEqual(["X2"]);
    expect(readAudit("\x60\x60\x60json\n{\"marked\": []}\n\x60\x60\x60", codes)).toEqual([]);
    for (const bad of ['{"marked": ["X3"]}', '{"marked": "X1"}', "X1", "Marked: " + '{"marked": []}']) expect(readAudit(bad, codes)).toBeNull();
  });
  test("an unreadable answer is resent once, then fails closed", async () => {
    let n = 0;
    expect(await auditTurn(violations, input, async () => (n++ ? '{"marked": ["X1"]}' : "hmm"))).toEqual({ marked: ["X1"], attempts: 2, readable: true });
    expect(await auditTurn(violations, input, async () => "hmm")).toEqual({ marked: [UNREADABLE], attempts: 2, readable: false });
  });
  test("both auditors marking fails a turn, even on different codes; one alone disputes it", () => {
    const r = (marked: string[]) => ({ marked, attempts: 1, readable: true });
    expect(combine(r(["X1"]), r(["X2"]))).toBe("fail");
    expect(combine(r(["X1"]), r([]))).toBe("disputed");
    expect(combine(r([]), r([UNREADABLE]))).toBe("disputed");
    expect(combine(r([]), r([]))).toBe("clean");
  });
});

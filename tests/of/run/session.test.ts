// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=one arm session's frozen rules: the first user message per arm, kind and repair, the reference's seeded fact order, the founder-reply limits, the founder loop's closing message and simulator ends, section 6's C1 rows in their order and J1's one retry; fails_when=a session closes a reply early or late, a simulator failure scores as the arm's, a web or gstack-read session scores as a block, or a third attempt runs; why_new=the run area's session loop; seam=firstUserMessage, founderLoop, attemptOutcome, settle; no_claim=the driver and the Docker rig, which driver-sdk.test.ts and the e2e cover
import { describe, expect, test } from "bun:test";
import { CLOSING, FIRST_LINE, FORCED_LINE, firstMessage, fullInformation } from "../../../lanes/office-hours-founder/frozen.ts";
import { attemptOutcome, factOrder, firstUserMessage, founderLimit, founderLoop, settle, type AttemptRead, type FounderResult, type LoopState } from "../../../lanes/office-hours-founder/run/session.ts";
import { BLOCK_REPLY } from "../../../lanes/office-hours-founder/run/seams.ts";
import type { Sheet } from "../../../lanes/office-hours-founder/types.ts";

const sheet: Sheet = { persona: "A club volunteer.", facts: ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, text: "Fact " + id + ".", reveal_when: "Asked.", kind: "demand" })) as Sheet["facts"] };
const OPENING = "I am building a scheduling page for a rowing club.\n";
const reply: FounderResult = { kind: "reply", reply: "Six members asked.", revealed: ["a"], rules: [3], attempts: 1 };

describe("first message and limits", () => {
  test("each arm opens with its frozen first line, and the forced line replaces only the office-hours arm's", () => {
    for (const arm of ["none", "lens", "office-hours"] as const) expect(firstUserMessage({ kind: "arm", arm, unit: "u" }, OPENING, sheet, [])).toBe(firstMessage(FIRST_LINE[arm], OPENING));
    expect(firstUserMessage({ kind: "arm", arm: "office-hours", unit: "u" }, OPENING, sheet, ["forced-line"])).toBe(firstMessage(FORCED_LINE, OPENING));
    expect(firstUserMessage({ kind: "arm", arm: "lens", unit: "u" }, OPENING, sheet, ["forced-line"])).toBe(firstMessage(FIRST_LINE.lens, OPENING));
    expect(firstUserMessage({ kind: "pitch", arm: "none", unit: "u" }, OPENING, sheet, [])).toBe(firstMessage(FIRST_LINE.none, OPENING));
  });

  test("the reference gives every fact in an order seeded by the unit, with no answer-now line", () => {
    const order = factOrder("u1", sheet);
    expect([...order].sort()).toEqual(sheet.facts.map((f) => f.text).sort());
    expect(factOrder("u1", sheet)).toEqual(order);
    expect(["u2", "u3", "u4", "u5"].some((u) => factOrder(u, sheet).join() !== order.join())).toBe(true);
    expect(firstUserMessage({ kind: "reference", arm: "none", unit: "u1" }, OPENING, sheet, [])).toBe(fullInformation(OPENING, order, false));
  });

  test("the founder-reply limit is 20, 30 under the limit repair and 0 in the pitch and reference cells", () => {
    expect(founderLimit("arm", [])).toBe(20);
    expect(founderLimit("arm", ["limit-30"])).toBe(30);
    expect(founderLimit("pitch", ["limit-30"])).toBe(0);
    expect(founderLimit("reference", [])).toBe(0);
  });
});

describe("founder loop", () => {
  test("a block in a reply ends the session", async () => {
    const l = founderLoop(20, async () => reply);
    expect(await l.nextUser(["Thinking.", BLOCK_REPLY])).toEqual({ end: true });
    expect(l.state.ended).toBe("block");
    expect(l.state.replies).toBe(1);
  });

  test("the simulator sees each reply's texts joined and every founder reply, as a copy", async () => {
    const seen: string[] = [];
    const l = founderLoop(20, async (t) => {
      seen.push(JSON.stringify(t));
      t.push({ role: "person", text: "tamper" });
      return reply;
    });
    expect(await l.nextUser(["One.", "Two."])).toEqual({ reply: reply.reply });
    await l.nextUser(["Three."]);
    expect(JSON.parse(seen[1]!)).toEqual([{ role: "assistant", text: "One.\n\nTwo." }, { role: "person", text: reply.reply }, { role: "assistant", text: "Three." }]);
    expect(l.state.founder_turns.map((f) => f.turn)).toEqual([1, 2]);
  });

  test("at the limit the closing message goes, and the reply to it ends the session block or not", async () => {
    const l = founderLoop(2, async () => reply);
    for (let i = 0; i < 2; i++) expect(await l.nextUser(["Q?"])).toEqual({ reply: reply.reply });
    expect(await l.nextUser(["Q?"])).toEqual({ reply: CLOSING });
    expect(await l.nextUser(["No block."])).toEqual({ end: true });
    expect(l.state).toMatchObject({ ended: "closing", closing_sent: true, replies: 4 });
    const z = founderLoop(0, async () => {
      throw new Error("the simulator ran");
    });
    expect(await z.nextUser(["Q?"])).toEqual({ reply: CLOSING });
    expect(await z.nextUser([BLOCK_REPLY])).toEqual({ end: true });
    expect(z.state.ended).toBe("block");
  });

  test("a simulator failure stops the session with its code", async () => {
    const cases: [FounderResult, string, string][] = [
      [{ kind: "check-failed", checks: ["leak"], attempts: 2 }, "E_OF_SIM_TURN", "check"],
      [{ kind: "call-failed", reason: "allowance", detail: "x" }, "E_OF_INFRA_MISSING", "allowance"],
      [{ kind: "call-failed", reason: "provider", detail: "x" }, "E_OF_INFRA_MISSING", "provider"],
      [{ kind: "call-failed", reason: "drift", detail: "x" }, "E_OF_PROVIDER_DRIFT", "drift"],
    ];
    for (const [r, code, reason] of cases) {
      const l = founderLoop(20, async () => r);
      expect(await l.nextUser(["Q?"])).toEqual({ stop: { kind: "missing", code: code as never } });
      expect(l.state.sim?.reason).toBe(reason as never);
    }
  });
});

const loop = (o: Partial<LoopState> = {}): LoopState => ({ founder_turns: [], transcript: [], replies: 1, closing_sent: false, parse: null, ended: null, sim: null, ...o });
const read = (o: Partial<AttemptRead> = {}): AttemptRead => ({ termination: { kind: "completed" }, loop: loop({ ended: "block" }), web: 0, gstack_reads: [], contained: [], overflow: false, micros: 0, sim_micros: 0, ...o });
const sim = (reason: "check" | "allowance" | "provider" | "drift") => loop({ sim: { code: "E_OF_SIM_TURN", reason, detail: "d" } });

describe("C1 rows", () => {
  test("each row in order", () => {
    const cases: [AttemptRead, string, string | null | undefined][] = [
      [read({ termination: { kind: "cap_stop" } as AttemptRead["termination"], web: 1 }), "cap", undefined],
      [read({ loop: sim("drift"), contained: ["env name X_KEY"] }), "halt", "E_OF_PROVIDER_DRIFT"],
      [read({ contained: ["mount /x"] }), "halt", "E_OF_LEAK"],
      [read({ termination: { kind: "credentials_rejected" } as AttemptRead["termination"] }), "halt", "E_KEY_REJECTED"],
      [read({ termination: { kind: "missing", code: "E_LEDGER_UNAVAILABLE" } }), "missing", "E_OF_INFRA_MISSING"],
      [read({ loop: sim("allowance") }), "missing", "E_OF_INFRA_MISSING"],
      [read({ loop: sim("check") }), "missing", "E_OF_SIM_TURN"],
      [read({ web: 2 }), "contaminated", "E_OF_WEB_CONTAMINATED"],
      [read({ gstack_reads: ["Read ~/.claude/skills/gstack/SKILL.md"] }), "gstack-read", "E_OF_GSTACK_READ"],
      [read({ contained: null }), "retry", undefined],
      [read(), "block", null],
      [read({ loop: loop({ ended: "closing" }) }), "no-block", "E_OF_NO_BLOCK"],
      [read({ loop: sim("provider") }), "retry", undefined],
      [read({ loop: loop(), termination: { kind: "turn_cap" } }), "retry", undefined],
      [read({ loop: loop(), overflow: true }), "retry", undefined],
      [read({ loop: loop(), termination: { kind: "missing", code: "UPSTREAM" } }), "retry", undefined],
    ];
    for (const [a, state, code] of cases) {
      const o = attemptOutcome(a, "none");
      expect(o.state).toBe(state as never);
      if (code !== undefined) expect((o as { code: string | null }).code).toBe(code);
    }
  });

  test("the office-hours arm reading its own skill is no gstack read", () => {
    expect(attemptOutcome(read({ gstack_reads: ["Read x/gstack/office-hours/SKILL.md"] }), "office-hours").state).toBe("block");
    expect(attemptOutcome(read({ gstack_reads: ["Read x/gstack/office-hours/SKILL.md"] }), "lens").state).toBe("gstack-read");
  });

  test("arm stops and infrastructure failures retry as their kind", () => {
    expect(attemptOutcome(read({ loop: loop(), termination: { kind: "timeout" } }), "none")).toMatchObject({ state: "retry", as: "arm-stop" });
    expect(attemptOutcome(read({ loop: loop(), termination: { kind: "allowance_stop" } as AttemptRead["termination"] }), "none")).toMatchObject({ state: "retry", as: "arm-stop" });
    expect(attemptOutcome(read({ loop: sim("provider") }), "none")).toMatchObject({ state: "retry", as: "infra" });
  });

  test("one retry in all: a retry on the second attempt scores as its kind", () => {
    const arm = { state: "retry", as: "arm-stop", why: "w" } as const;
    const infra = { state: "retry", as: "infra", why: "w" } as const;
    expect(settle(arm, 1)).toBe(arm);
    expect(settle(arm, 2)).toMatchObject({ state: "arm-stop", code: "E_OF_ARM_STOP" });
    expect(settle(infra, 2)).toMatchObject({ state: "missing", code: "E_OF_INFRA_MISSING" });
    const end = { state: "block", code: null, why: "w" } as const;
    expect(settle(end, 2)).toBe(end);
  });
});

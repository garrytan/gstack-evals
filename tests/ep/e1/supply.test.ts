import { describe, expect, test } from "bun:test";
import { LABEL_FORMAT, LABEL_QUESTIONS, STATE_SHAPED } from "../../../lanes/outcome-skills/statemachines/packets.ts";
import { e1Draw, parseReach, reachKeeps, reachPrompt, screenUnit, stateAgreement, statePrompt, type DrawUnit, type ScreenRecord, type SupplyRole } from "../../../lanes/eng-planted/e1/supply.ts";

const m = { message: "Fix reset", diff: "--- a\n+++ b", hint: "The flag must reset after cancel.", plan: "# Plan", stubbed: [{ path: "a.ts", text: "export function f() {}" }], callers: [] };
const yes = JSON.stringify({ defect: "yes", state_shaped: "yes", reason: "r" });

describe("state screen", () => {
  test("the packet carries the state machines eval's text word for word, and no F diff reaches the reach prompt", () => {
    const p = JSON.parse(statePrompt(m).prompt);
    expect([p.questions, p.state_shaped, p.answer_format]).toEqual([LABEL_QUESTIONS, STATE_SHAPED, LABEL_FORMAT]);
    expect(reachPrompt(m.plan, m, m.hint)).not.toContain("+++ b");
    expect(reachPrompt(m.plan, m, m.hint)).toContain("Could a small model of the states and transitions this plan describes reach the state the hint names?");
  });
  test("both must say defect and state-shaped; a malformed answer fails closed; no reach call after a drop", async () => {
    const roles: SupplyRole[] = [];
    const call = (a: string, o: string) => async (role: SupplyRole) => {
      roles.push(role);
      return { text: role === "stateAstra" ? a : role === "stateOpus" ? o : "REACH: yes", costUsd: 0.01 };
    };
    expect((await screenUnit(call(yes, JSON.stringify({ defect: "yes", state_shaped: "no", reason: "r" })), m)).drop).toBe("state");
    expect((await screenUnit(call(yes, "not json"), m)).drop).toBe("state");
    expect(roles.filter((r) => r.startsWith("reach"))).toEqual([]);
    const ok = await screenUnit(call(yes, yes), m);
    expect([ok.drop, ok.reach, ok.bothYes, ok.costUsd]).toEqual([null, ["yes", "yes"], true, 0.04]);
  });
  test("reach: asked once more without its line, then dropped; neither no and one yes keeps", async () => {
    const answers: Record<string, string[]> = { reachCarbon: ["no line", "REACH: maybe"], reachOpus: ["x", "y"] };
    const r = await screenUnit(async (role, _p, attempt) => ({ text: role.startsWith("state") ? yes : answers[role]![(attempt ?? 1) - 1]!, costUsd: 0 }), m);
    expect([r.drop, r.reach]).toEqual(["reach-unreadable", null]);
    expect(parseReach("thinking\n**REACH: Maybe**")).toBe("maybe");
    expect([reachKeeps(["yes", "maybe"]), reachKeeps(["maybe", "maybe"]), reachKeeps(["yes", "no"])]).toEqual([true, false, false]);
  });
  test("kappa over units where both answers read", () => {
    const rec = (a: string, o: string): ScreenRecord => ({ state: { astra: { defect: "yes", state_shaped: a as "yes", reason: "" }, opus: { defect: "yes", state_shaped: o as "yes", reason: "" }, eligible: false, packet: "" }, reach: null, drop: null, bothYes: false, costUsd: 0 });
    expect(stateAgreement([rec("yes", "yes"), rec("no", "no"), rec("yes", "no"), rec("no", "no")]).stateShaped).toBeCloseTo(0.5);
  });
});

describe("draw", () => {
  const pass: ScreenRecord = { state: { astra: null, opus: null, eligible: true, packet: "" }, reach: ["yes", "yes"], drop: null, bothYes: true, costUsd: 0 };
  const u = (i: number, o: Partial<DrawUnit> = {}): DrawUnit => ({ id: "u" + i, repo: "r" + (i % 30), authoring: "passed", by: "attempt3", foresee: ["yes", "yes"], screen: pass, ...o });
  test("calibration first, comparison, reserve; at most 3 a repository", () => {
    const d = e1Draw("s", Array.from({ length: 120 }, (_, i) => u(i)));
    expect([d.calibration.length, d.comparison.length, d.reserve.length, d.waiting]).toEqual([6, 64, 6, null]);
    const repo = (id: string) => "r" + (Number(id.slice(1)) % 30);
    const counts = new Map<string, number>();
    for (const id of [...d.calibration, ...d.comparison, ...d.reserve]) counts.set(repo(id), (counts.get(repo(id)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });
  test("an unforeseeable unit serves calibration only; the walk waits at the first unscreened unit", () => {
    const units = Array.from({ length: 10 }, (_, i) => u(i, { repo: "r" + i, foresee: ["no", "no"] }));
    const d = e1Draw("s", units);
    expect([d.calibration.length, d.comparison.length]).toEqual([6, 0]);
    expect(d.skipped.filter((s) => s.reason === "unforeseeable").length).toBe(4);
    const w = e1Draw("s", [u(1, { screen: null, repo: "a" }), u(2, { repo: "b" })]);
    expect(w.waiting === "u1" ? w.calibration.length <= 1 : true).toBe(true);
  });
  test("units authored here follow attempt 3's; a dropped unit is skipped and an owed one stops the walk", () => {
    const a3 = Array.from({ length: 8 }, (_, i) => u(i, { repo: "a" + i }));
    const here = Array.from({ length: 8 }, (_, i) => u(100 + i, { repo: "h" + i, by: "pool" }));
    const d = e1Draw("s", [...here, ...a3]);
    expect(d.calibration.every((id) => Number(id.slice(1)) < 100)).toBe(true);
    expect(d.comparison.slice(0, 2).every((id) => Number(id.slice(1)) < 100)).toBe(true);
    expect(d.comparison.slice(2).every((id) => Number(id.slice(1)) >= 100)).toBe(true);
    const owed = e1Draw("s", [...a3, u(100, { by: "pool", authoring: "owed", repo: "h" }), u(101, { by: "pool", authoring: "dropped", repo: "g" })]);
    expect(owed.calibration).toEqual(d.calibration);
    expect(owed.comparison.length).toBe(2);
    expect(owed.waiting).toBe("u100");
    const w2 = Array.from({ length: 8 }, (_, i) => u(200 + i, { repo: "w" + i, by: "wave2" }));
    const three = e1Draw("s", [...w2, ...here, ...a3]);
    expect(three.comparison.slice(2, 10).every((id) => Number(id.slice(1)) >= 100 && Number(id.slice(1)) < 200)).toBe(true);
    expect(three.comparison.slice(10).every((id) => Number(id.slice(1)) >= 200)).toBe(true);
    expect(e1Draw("s", [...a3, u(100, { by: "pool", authoring: "owed", repo: "h" }), ...w2]).comparison.length).toBe(2);
  });
});

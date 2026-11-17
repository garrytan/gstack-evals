// Value: protects=the fidelity audit (prereg section 4): the frozen V1 to V6 wording, the seeded draw's quotas, limits and minimums, the pass rule and what a failure does to its stage.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PREREG } from "../../../lanes/office-hours-founder/frozen.ts";
import { auditOutcome, drawAudit, QUOTAS, repairRecord, VIOLATIONS } from "../../../lanes/office-hours-founder/sim/fidelity.ts";
import { FOUNDER_RULES } from "../../../lanes/office-hours-founder/sim/founder.ts";
import { auditWith, fixtureSessions } from "../../../lanes/office-hours-founder/sim/seams.ts";

describe("fidelity", () => {
  test("V1 to V6 are section 4's definitions, byte for byte", () => {
    const prereg = readFileSync(PREREG, "utf8");
    expect(VIOLATIONS.map((v) => v.code)).toEqual(["V1", "V2", "V3", "V4", "V5", "V6"]);
    for (const v of VIOLATIONS) expect(prereg).toMatch(new RegExp("\n- " + (v.code + ", " + v.definition).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&") + "[;.]\n"));
  });

  test("a full stage meets its quotas, the per-session limit and both minimums, the same on every input order", () => {
    const sessions = fixtureSessions(1, { none: 30, "office-hours": 30, lens: 30 }, 4, (k) => k % 7 === 0);
    const d = drawAudit(1, sessions);
    expect(d.drawn).toHaveLength(40);
    expect(d.by_arm).toEqual(QUOTAS[1]);
    expect(d.revealing).toBeGreaterThanOrEqual(12);
    expect(d.drawn.length - d.revealing).toBeGreaterThanOrEqual(12);
    const per = Object.groupBy(d.drawn, (t) => t.session.unit + t.session.arm);
    expect(Math.max(...Object.values(per).map((ts) => ts!.length))).toBeLessThanOrEqual(2);
    expect(drawAudit(1, [...sessions].reverse())).toEqual(d);
  });

  test("only the stage's arm sessions enter, and zero-turn sessions are counted", () => {
    const own = fixtureSessions(2, { none: 10, lens: 10 }, 2);
    const other = [...fixtureSessions(1, { none: 10 }, 2), ...fixtureSessions(2, { none: 10 }, 2).map((s) => ({ ...s, kind: "reference" as const }))];
    const d = drawAudit(2, [...own, ...other, ...fixtureSessions(2, { "office-hours": 3 }, 0)]);
    expect(d).toMatchObject({ sessions: 23, zero_turn_sessions: 3, turns: 40 });
  });

  test("a full stage with the per-session limit leaving fewer than 40 audits what it can", () => {
    const d = drawAudit(2, fixtureSessions(2, { none: 5, lens: 5, "office-hours": 5 }, 4));
    expect(d).toMatchObject({ read: "audit", every: false, turns: 60 });
    expect(d.drawn).toHaveLength(30);
  });

  test("the audit result prints counts per violation, the disputed turns and the agreement", async () => {
    const a = await auditWith(fixtureSessions(2, { none: 20, lens: 20, "office-hours": 20 }, 3), 2, 2, 1);
    expect(a.result!.per_violation.V2).toEqual({ both: 2, astra: 3, opus: 2 });
    expect(a.result!.per_violation.V4).toEqual({ both: 0, astra: 0, opus: 2 });
    expect(a.result!.disputed).toHaveLength(1);
    expect(a.result!.agreement.share).toBe(39 / 40);
    expect(a.result!.unreadable).toEqual({ astra: 0, opus: 0 });
  });

  test("stage 1: one recorded repair, then FIX-METHOD on a second failure", async () => {
    expect(() => repairRecord(FOUNDER_RULES)).toThrow("E_USAGE");
    const repair = repairRecord(FOUNDER_RULES.replace("at most 120 words", "at most 100 words"));
    expect(repair.from_sha256).not.toBe(repair.to_sha256);
    const a = await auditWith(fixtureSessions(1, { none: 20, lens: 20, "office-hours": 20 }, 3), 1, 3, 0);
    expect(auditOutcome({ draw: a.draw, result: a.result, repair })).toMatchObject({ read: "fix-method", code: "E_OF_SIM_AUDIT" });
  });

  test("stage 2 under 20 founder turns reads NO READ and voids stage 2", () => {
    const d = drawAudit(2, fixtureSessions(2, { none: 19 }, 1));
    expect(auditOutcome({ draw: d, result: null, repair: null })).toMatchObject({ read: "no-read", code: "E_OF_SIM_AUDIT" });
  });
});

import { describe, expect, test } from "bun:test";
import { untestedProblem } from "../../lanes/review-noloss/contract.ts";

const arm = (json: unknown) => new Map([["arm.json", Buffer.from(JSON.stringify(json))]]);

describe("untested arms get no judge packet, join or score (GEVA-203)", () => {
  // Value: protects=an arm the read audit marked untested is refused by name before judge-packet or judge-join reads it; fails_when=an untested arm passes, or a clean or stopped arm is refused; seam=untestedProblem, which judge.ts calls after each parseArm; no_claim=score.ts, which refuses it as a stopped arm
  test("an untested block refuses with E_ARM_CONTAMINATED naming the arm; a clean or stopped arm passes", () => {
    const untested = { code: "E_ARM_CONTAMINATED", reason: "the read audit found a contaminated read in 1 session", sessions: [{ session: "u pass 1", paths: ["~/.capy/drive/x/SKILL.md"] }], paid_usd: 0.5 };
    expect(untestedProblem(arm({ id: "none-opus", status: "stopped", untested }))).toBe("E_ARM_CONTAMINATED arm none-opus is untested (the read audit found a contaminated read in 1 session), so it gets no judge packet, join or score; rerun the arm clean");
    expect([untestedProblem(arm({ id: "none-opus", status: "complete" })), untestedProblem(arm({ id: "none-opus", status: "stopped", coverage_gaps: ["u pass 1"] })), untestedProblem(new Map())]).toEqual([null, null, null]);
  });
});

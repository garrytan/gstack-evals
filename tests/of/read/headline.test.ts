// Value: protects=section 16's fixed bullet shapes, so the reading can't pick its story, with AN-1's condition and the population on every bullet.
import { describe, expect, test } from "bun:test";
import { headlines, POPULATION } from "../../../lanes/office-hours-founder/read/headline.ts";
import { stage2Fixture } from "../../../lanes/office-hours-founder/read/seams.ts";
import { readStage2 } from "../../../lanes/office-hours-founder/read/stage2.ts";

describe("headlines", () => {
  test("helps: the drawing-out shape, the specificity interval and the guard sentence, on every model", () => {
    const h = headlines(readStage2(stage2Fixture({ w: (e) => (e.arm === "office-hours" ? 1 : 0) })), {});
    expect(h.length).toBe(3);
    for (const x of h) {
      expect(x).toStartWith("helps on ");
      expect(x).toContain("asking a founder for the evidence before advising (who uses it, who paid, what they did before)");
      expect(x).toContain("by 100 points");
      expect(x).toContain("weaker than requiring that interval to exclude zero");
      expect(x).toEndWith(POPULATION);
    }
  });
  test("hurts states the move away plainly, and every repair that ran is named", () => {
    const i = stage2Fixture({ w: (e) => (e.arm === "none" ? 1 : 0) });
    const h = headlines(readStage2({ ...i, stage1: { ...i.stage1, repairs: ["forced sentence"] } }), {});
    expect(h[0]).toStartWith("hurts on Opus: the skill moved the first move away from what the evidence supported, by 100 points");
    expect(h.every((x) => x.includes("Repairs that ran: forced sentence."))).toBe(true);
  });
  test("untested names its condition and needs what the next attempt changes; what works sorts first", () => {
    const i = stage2Fixture({ w: (e) => (e.arm === "office-hours" ? 1 : 0) });
    const r = readStage2({ ...i, stage1: { ...i.stage1, untested: { ...i.stage1.untested, opus: ["stock"] } } });
    expect(() => headlines(r, {})).toThrow("next attempt");
    const h = headlines(r, { opus: "a rewritten stock screen" });
    expect(h[2]).toStartWith("untested on Opus: stock. The next attempt changes: a rewritten stock screen.");
    expect(h[0]).toStartWith("helps on Sol");
  });
  test("no measurable difference says the test couldn't tell unless the upper bound is under +0.05", () => {
    const h = headlines(readStage2(stage2Fixture({ w: () => 0 })), {});
    expect(h[0]).toContain("with a control rate of 0, an MDD of 0.13 and a largest gain the interval leaves open of 0. A builder doesn't need the procedure for this part.");
    expect(h[0]).toContain("E then says whether the skill still drew out more of the evidence");
  });
});

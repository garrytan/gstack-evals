// Copyright (c) 2026 Garry Tan. MIT License.
import { describe, expect, test } from "bun:test";
import { claim1Admission, claim2Admission, costReading, doubledAllowances, infraReading, issueCut, p95, stage2Rule } from "../../lanes/outcome-skills/statemachines/admission.ts";

const M = 1_000_000;

describe("stage 2 rule", () => {
  test("A1 above A2 is eligible and needs a Captain cap; a tie or less is final at n = 60; nothing opens", () => {
    const yes = stage2Rule("claude-opus-5-5", 12, 11, 3 * M);
    expect(yes.eligible).toBe(true);
    expect(yes.projection_micros).toBe(360 * 3.08 * M);
    expect(yes.text).toMatch(/needs a cap the Captain records first/);
    expect(yes.text).toMatch(/Nothing was opened\.$/);
    expect(stage2Rule("m", 11, 11).eligible).toBe(false);
    expect(stage2Rule("m", 10, 11).text).toMatch(/^final at n = 60 on m/);
    expect(() => stage2Rule("m", -1, 0)).toThrow(/^E_SM_ANALYSIS /);
  });
});

describe("admission readings", () => {
  test("claim 1 FLOOR: 2 clean fixes in 30 is FLOOR, 3 is not; the file-scope retry and the stop", () => {
    expect(claim1Admission(3, 30)).toMatchObject({ reading: "OK", scope: "folder" });
    const f = claim1Admission(2, 30);
    expect(f.reading).toBe("FLOOR");
    expect(f.next).toMatch(/fix's changed files for every arm and model/);
    expect(claim1Admission(2, 30, { clean: 3, sessions: 30 })).toMatchObject({ reading: "OK", scope: "file" });
    const stop = claim1Admission(2, 30, { clean: 2, sessions: 30 });
    expect(stop.reading).toBe("FLOOR");
    expect(stop.next).toMatch(/A0 and A2 are not run; claim 2 continues at folder scope/);
  });

  test("claim 2 headroom: 0.15 and 0.90 are inside; just outside each is FLOOR or CEILING; one raise attempt", () => {
    expect(claim2Admission(0.15).reading).toBe("OK");
    expect(claim2Admission(0.9).reading).toBe("OK");
    expect(claim2Admission(0.1499).reading).toBe("FLOOR");
    expect(claim2Admission(0.9001)).toMatchObject({ reading: "CEILING", models: "pending" });
    expect(claim2Admission(0.95, 0.9)).toMatchObject({ reading: "OK", issue: "cut", models: "all three" });
    expect(claim2Admission(0.95, 0.91)).toMatchObject({ reading: "CEILING", models: "Sol and particle-1" });
    expect(claim2Admission(0.95, 0.1)).toMatchObject({ reading: "FLOOR" });
  });

  test("the issue cut keeps the title line and the text up to the first blank line", () => {
    expect(issueCut("Title here\nfirst para line 1\nline 2\n\nsecond para\n")).toBe("Title here\nfirst para line 1\nline 2\n");
    expect(issueCut("\n\nOnly title\n\nrest")).toBe("Only title\n");
    expect(issueCut("A\r\nB\r\n\r\nC")).toBe("A\nB\n");
  });

  test("cost: nearest-rank p95 against half the Opus allowance, per stage; the doubling returns new limits for every model", () => {
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(19);
    expect(p95([])).toBeNull();
    const allow = { first: { "claude-opus-5-5": 15 * M, "openai/gpt-6.1-sol": 15 * M, "particle-ai/particle-1": 3 * M }, followon: { "claude-opus-5-5": 6 * M, "openai/gpt-6.1-sol": 6 * M, "particle-ai/particle-1": 1 * M } };
    const at = costReading({ first: Array(30).fill(7.5 * M), followon: Array(45).fill(3 * M) }, allow);
    expect(at.map((r) => r.over)).toEqual([false, false]);
    expect(doubledAllowances(allow, at)).toEqual(allow);
    const over = costReading({ first: [...Array(28).fill(1 * M), 7.5 * M + 1, 9 * M], followon: Array(45).fill(1 * M) }, allow);
    expect(over.map((r) => r.over)).toEqual([true, false]);
    expect(over[0]!.p95_micros).toBe(7.5 * M + 1);
    expect(doubledAllowances(allow, over)).toEqual({ first: { "claude-opus-5-5": 30 * M, "openai/gpt-6.1-sol": 30 * M, "particle-ai/particle-1": 6 * M }, followon: allow.followon });
  });

  test("INFRA: exactly 10% gaps is not over, more is", () => {
    expect(infraReading([{ cell: "A0", units: 10, gaps: 1 }, { cell: "A1", units: 20, gaps: 2 }]).reading).toBe("OK");
    expect(infraReading([{ cell: "A0", units: 15, gaps: 1 }, { cell: "A1", units: 15, gaps: 2 }]).reading).toBe("INFRA");
  });
});

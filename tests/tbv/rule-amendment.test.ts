// Copyright (c) 2026 Garry Tan. MIT License.
// Amendment 1's rule items in the scorer: 11 (all-in before every paid item), 12 (size drops), 13 (outage stops),
// 14 (judge pricing by judge model and packet kind), 15 (the leak exemption) and 17 (the max_tokens end state).
import { describe, expect, test } from "bun:test";
import { line, rule, stage1 } from "./rule-helpers.ts";

const ends = (...cases: { kind: string; turn: string }[][]) => rule("endstate", { cases }).out.split("\n");
const T = (kind: string, turn = "report") => ({ kind, turn });

describe("item 17: max_tokens is read as returned", () => {
  test("a max_tokens reply with text on the report turn scores, with no retry and no follow-up", () => {
    expect(ends([T("max-tokens")])[0]).toStartWith("endstate scored, sends 1");
    expect(ends([T("max-tokens"), T("text", "d1"), T("max-tokens", "d2")])[0]).toBe('endstate scored, sends 3, drill {"d1":"ok","d2":"ok"}');
  });
  test("an empty report turn takes the one follow-up, which may stop at max_tokens", () => {
    expect(ends([T("empty"), T("max-tokens", "followup")])[0]).toStartWith("endstate scored, sends 2");
  });
  test("other direction: a truncated stream is still a transport failure with retries", () => {
    expect(ends([T("truncated"), T("truncated"), T("truncated")])[0]).toStartWith("endstate gap, sends 3");
  });
  test("headroom prints max_tokens replies per arm, model and turn", () => {
    const s = stage1((rs) => { rs[0].maxTokens = ["report"]; rs[1].maxTokens = ["report", "d2"]; });
    expect(line(rule("headroom", s.data, s.split).out, /^size drops/)).toContain("max_tokens replies: none:opus:d2 1, none:opus:report 2");
  });
});

describe("item 12: a size-only refusal drops the task", () => {
  test("endState reads a size refusal as size-drop with no send", () => {
    expect(ends([T("size")])[0]).toStartWith("endstate size-drop, sends 0");
  });
  test("other direction: any other validator failure is a harness failure", () => {
    expect(ends([T("validator")])[0]).toStartWith("endstate harness");
  });
  test("size-drop readings count as missing and print as a count", () => {
    const s = stage1((rs) => { for (const r of rs.filter((x) => x.task === "t2")) Object.assign(r, { status: "size-drop", facts: [], responseIds: [], second: undefined }); });
    const o = rule("headroom", s.data, s.split).out;
    expect(o).toContain("missing or unjudged 3");
    expect(o).toContain("size drops: 1 tasks");
  });
});

describe("item 13: an outage stop", () => {
  test("endState reads an outage as class outage, never retried", () => {
    expect(ends([T("5xx"), T("outage")])[0]).toStartWith("endstate outage, sends 1");
  });
});

const PRICES = { opus: { in: 4, out: 20, cacheWrite: 5 }, sol: { in: 2, out: 10, cacheWrite: 2.5 }, particle: { in: 0.1, out: 1 } };
const proj = (packets: { judge: string; kind: string; n: number }[], judgeMeasured: Record<string, number>) => rule("projection", { items: [{ item: "tbv-dev-base", readings: [], packets }], measured: {}, judgeMeasured, prices: PRICES });

describe("item 14: judges priced by judge model and packet kind", () => {
  test("each packet takes its own judge and kind's measured cost", () => {
    const r = proj([{ judge: "sol", kind: "first", n: 10 }, { judge: "opus", kind: "first", n: 2 }, { judge: "sol", kind: "d2", n: 4 }], { "sol:first": 0.1, "opus:first": 0.5, "sol:d2": 0.05 });
    expect(r.out).toContain("tbv-dev-base: projected $2.20");
  });
  test("a path stage 1 did not meter takes the costliest metered path of the same kind", () => {
    expect(proj([{ judge: "opus", kind: "d2", n: 10 }], { "sol:d2": 0.05, "sol:first": 9 }).out).toContain("projected $0.50");
  });
  test("a kind stage 1 never metered is refused", () => {
    expect(proj([{ judge: "opus", kind: "control", n: 1 }], { "sol:first": 0.1 }).err).toContain("no measured judge cost for any control packet");
  });
});

const allin = (x: Record<string, unknown>) => rule("allin", { item: "tbv-hr", crewCredits: 80_000, crewRest: 150, settled: 100, reserved: 0, unknown: 0, itemCap: 300, ...x });

describe("item 11: the all-in check before every paid item", () => {
  test("it starts an item whose cap fits under the line and prints the crew term against the reserve", () => {
    const r = allin({});
    expect(r.verdict).toBe("START tbv-hr ($630.00)");
    expect(r.out).toContain("crew spent $80.00 (80000 credits; $80.00 of the $300.00 crew reserve)");
  });
  test("it refuses to start an item that would pass $2,000", () => {
    expect(allin({ item: "tbv-climb-2", settled: 1500 }).verdict).toStartWith("NO START (to the Captain");
  });
  test("it refuses an item that is not a paid item, and a missing term", () => {
    expect(allin({ item: "tbv-other" }).refused).toBe(true);
    expect(allin({ crewCredits: undefined }).err).toContain("crewCredits");
  });
  test("other direction: before tbv-held the frozen branches stay", () => {
    expect(allin({ item: "tbv-held", itemCap: 900, thirdPassCap: 200, capyCap: 150 }).verdict).toStartWith("STAGE 3 WITH THE THIRD OPUS PASS");
    expect(allin({ item: "tbv-held", itemCap: 1700, thirdPassCap: 200, capyCap: 150 }).verdict).toStartWith("STAGE 3 WITHOUT THE CAPY FAMILY");
    expect(allin({ item: "tbv-held", itemCap: 1700, thirdPassCap: 200, capyCap: 10 }).verdict).toStartWith("NO STAGE 3");
  });
  test("before tbv-held, a negative thirdPassCap or capyCap, or a capyCap over the held cap, is refused", () => {
    const held = (x: Record<string, unknown>) => allin({ item: "tbv-held", itemCap: 1700, thirdPassCap: 200, capyCap: 150, ...x });
    for (const x of [{ thirdPassCap: -1 }, { capyCap: -1 }, { capyCap: 1700.01 }, { thirdPassCap: -2000, itemCap: 900 }]) {
      const r = held(x);
      expect(r.refused).toBe(true);
      expect(r.err).toContain("thirdPassCap and capyCap");
    }
  });
  test("other direction: zero caps and a capyCap equal to the held cap still run", () => {
    expect(allin({ item: "tbv-held", itemCap: 900, thirdPassCap: 0, capyCap: 0 }).verdict).toBe("STAGE 3 WITH THE THIRD OPUS PASS ($1230.00)");
    expect(allin({ item: "tbv-held", itemCap: 1700, thirdPassCap: 200, capyCap: 1700 }).verdict).toBe("STAGE 3 WITHOUT THE CAPY FAMILY ($330.00)");
  });
});

const L = (names: string[], addedLines: string[], gstackAtC: string) => ({ addedLines, gstackAtC, material: "unrelated", names });
describe("item 15: names gstack holds at C are exempt from the leak check", () => {
  test("a name gstack at C holds whole is exempt", () => {
    const r = rule("leak", L(["held-repo-x"], ["see held-repo-x"], "gstack already names held-repo-x here"));
    expect(r.verdict).toBe("CLEAN");
    expect(r.out).toContain("1 exempt");
  });
  test("other direction: gstack at C holding only a longer name exempts nothing", () => {
    expect(rule("leak", L(["held-repo-x"], ["see held-repo-x"], "gstack names held-repo-xyz")).verdict).toStartWith("HIT");
  });
});

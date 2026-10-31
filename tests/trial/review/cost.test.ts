import { describe, expect, test } from "bun:test";
import { costTsv, meterCost, refusalsTsv } from "../../../src/trial/review/cost.ts";

const req = (rid: string, meter: string, model: string) => ({ kind: "request", reservation_id: rid, cell: { meter_id: meter }, model });
const spent = (rid: string, meter: string, micros: number) => ({ kind: "outcome", reservation_id: rid, meter_id: meter, status: 200, outcome: { kind: "spent", spent_micros: micros, usage: { input: 100, output: 50, reasoning: 5, cache_read: 1000, cache_write: 10 } } });

describe("cost.tsv from the proxy journal", () => {
  // Value: protects=a unit-pass's usage and usd come from its own meter's outcomes, the voice's calls get their own row, an unknown outcome makes the row unavailable, and refusals count toward the 2% degraded rule; fails_when=another meter's calls leak in, an unknown call is priced as zero, or a voice row is missing; why_new=GEVA-70 build step 2 (cost.tsv with usd filled); seam=meterCost, costTsv, refusalsTsv; no_claim=the proxy's own pricing
  test("sums, voice rows, unknown outcomes and refusals", () => {
    const lines = [req("r1", "m1", "claude-opus-5-5"), spent("r1", "m1", 1500), req("r2", "m1", "gpt-6.1-sol"), spent("r2", "m1", 500), req("r3", "m2", "claude-opus-5-5"), spent("r3", "m2", 9999), { kind: "refusal", meter_id: "m1", model: "x" }, req("r4", "m3", "claude-haiku-5-5")];
    const m1 = meterCost(lines, "m1", "gpt-6.1-sol");
    expect(m1.all).toEqual({ input: 200, output: 100, cache_read: 2000, cache_write: 20, reasoning: 10, spent_micros: 2000, requests: 2, unknown: 0 });
    expect(m1.voice).toMatchObject({ requests: 1, spent_micros: 500 });
    expect(m1.refused).toBe(1);
    const m3 = meterCost(lines, "m3", null);
    expect(m3.all.unknown).toBe(1);
    const tsv = costTsv([{ pr: "o/r#1@abc", pass: 1, wall_ms: 61_250, cost: m1 }, { pr: "o/r#1@abc", pass: 2, wall_ms: null, cost: m3 }]).trim().split("\n").map((l) => l.split("\t"));
    expect(tsv[0]).toEqual(["pr", "scope", "pass", "total_tokens", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "usd", "wall_seconds", "meter_source", "requests", "refused", "unknown_calls"]);
    expect(tsv[1]).toEqual(["o/r#1@abc", "all", "1", "2320", "200", "100", "2000", "20", "10", "0.002000", "61.3", "proxy-journal", "2", "1", "0"]);
    expect(tsv[2]!.slice(0, 4)).toEqual(["o/r#1@abc", "voice", "1", "1160"]);
    expect(tsv[2]![9]).toBe("0.000500");
    expect(tsv[3]!.slice(3, 10)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
    const ref = refusalsTsv([{ arm_id: "a-opus", arm: "a", model: "claude-opus-5-5", sessions: 1, requests: 49, refused: 1 }, { arm_id: "b-opus", arm: "b", model: "claude-opus-5-5", sessions: 1, requests: 100, refused: 2 }]).trim().split("\n");
    expect(ref[1]!.split("\t").slice(-2)).toEqual(["0.0200", "no"]);
    expect(ref[2]!.split("\t").slice(-1)).toEqual(["no"]);
    expect(refusalsTsv([{ arm_id: "c", arm: "c", model: "m", sessions: 1, requests: 10, refused: 1 }]).trim().split("\n")[1]!.endsWith("yes")).toBe(true);
  });
});

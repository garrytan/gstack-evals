import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapStop, Ledger } from "../src/ledger.ts";
import { costUsd, fromApiUsage } from "../src/usage.ts";
import { bootstrapMeanCI, signFlipP, wilson } from "../src/analyze.ts";

describe("ledger", () => {
  test("approval first, reserve before spend, cap stop never overspends", () => {
    const p = join(mkdtempSync(join(tmpdir(), "ledger-")), "l.jsonl");
    const l = new Ledger(p, 10, "t");
    expect(() => l.reserve("a", 1, {})).toThrow("E_LEDGER_MISSING");
    l.approve({ words: ["Rec"], by: "x", source: "y" });
    l.reserve("a", 4, {});
    l.reserve("b", 4, {});
    expect(() => l.reserve("c", 4, {})).toThrow(CapStop);
    l.settle("a", 1.5, {});
    l.settle("a", 1.5, {});
    l.reserve("c", 4, {});
    expect(l.totals()).toMatchObject({ settled: 1.5, open: 8 });
    const again = new Ledger(p, 10, "t");
    expect(again.totals()).toMatchObject({ settled: 1.5, open: 8 });
    expect(readFileSync(p, "utf8").split("\n")[0]).toContain('"type":"approval"');
  });
});

describe("usage and price", () => {
  test("splits cache writes and prices Opus 5.5", () => {
    const u = fromApiUsage({ input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 } });
    expect(u).toEqual({ input: 1000, output: 1000, cacheRead: 1_000_000, cacheWrite5m: 1000, cacheWrite1h: 1000, webSearches: 0 });
    expect(costUsd("claude-opus-5-5", u)).toBeCloseTo((4000 + 20000 + 200000 + 5000 + 8000) / 1e6, 9);
  });
  test("Haiku 5.5 uses the long-context price above 100k prompt tokens", () => {
    const short = fromApiUsage({ input_tokens: 50_000, output_tokens: 1000 });
    const long = fromApiUsage({ input_tokens: 150_000, output_tokens: 1000 });
    expect(costUsd("claude-haiku-5-5", short)).toBeCloseTo((50_000 * 0.1 + 1000 * 0.5) / 1e6, 9);
    expect(costUsd("claude-haiku-5-5", long)).toBeCloseTo((150_000 * 0.5 + 1000 * 2.5) / 1e6, 9);
  });
});

describe("stats", () => {
  test("wilson, bootstrap and sign-flip behave", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeLessThan(0.9);
    expect(hi).toBeGreaterThan(0.9);
    expect(bootstrapMeanCI([0, 0, 0])).toEqual([0, 0]);
    expect(signFlipP([-1, -1, -1, -1, -1])).toBeCloseTo(1 / 32, 9);
    expect(signFlipP([1, 1, -1])).toBeGreaterThan(0.5);
  });
});

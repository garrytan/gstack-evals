import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, totals, toMicros } from "../runner/ledger.ts";
import { batchMicros, parseBatch, plan, routeMicros, RUNS } from "../runner/start-rule.ts";

const here = import.meta.dir;
const cli = (...args: string[]) => Bun.spawnSync(["bun", join(here, "../runner/start-rule.ts"), ...args]);

describe("start rule", () => {
  test("the projections reproduce section 8's per-model figures for Run T", () => {
    const t = RUNS["texttax-r1"]!;
    const usd = (m: string) => batchMicros(t, parseBatch(t, m)) / 1e6;
    expect(usd("particle-1")).toBeCloseTo(44.03, 2);
    expect(usd("claude-haiku-5-5")).toBeCloseTo(6.29, 2);
    expect(usd("deepseek-v4.1-flash-1017")).toBeCloseTo(14.43, 2);
    expect(plan(t).total_projected_usd).toBeCloseTo(64.75, 2);
  });

  test("Run D: preset cells on Opus, particle-1 and gpt-6.1-sol, sdk-default cells on Opus, Opus's second D3 replicate, the preset surcharge, the route check, $126 and the 1.4 margin", () => {
    const d = RUNS["discovery-r1"]!;
    const usd = (m: string) => batchMicros(d, parseBatch(d, m)) / 1e6;
    expect(d.cap).toBe(126);
    expect(Object.keys(d.cells).sort()).toEqual(["claude-opus-5-5", "claude-opus-5-5/r2", "gpt-6.1-sol", "particle-1"]);
    expect(d.cells["claude-opus-5-5"]).toEqual(["none@claude-code-preset", "gstack@claude-code-preset", "gstack-rewritten@claude-code-preset", "placebo@claude-code-preset", "none@sdk-default", "gstack@sdk-default", "gstack-rewritten@sdk-default"]);
    expect(d.cells["claude-opus-5-5/r2"]).toEqual(["gstack@claude-code-preset", "gstack@sdk-default"]);
    expect(d.cells["particle-1"]).toHaveLength(4);
    expect(usd("claude-opus-5-5")).toBeCloseTo(37 * (0.145 + 3 * 0.16 + 4 * 0.0117 + 0.145 + 2 * 0.16), 2);
    expect(usd("claude-opus-5-5/r2")).toBeCloseTo(37 * (0.16 + 0.0117 + 0.16), 2);
    expect(usd("claude-opus-5-5/r2:gstack@sdk-default=37")).toBeCloseTo(5.92, 2);
    expect(routeMicros(d) / 1e6).toBeCloseTo(0.145 + 0.0117 + 0.16 + 0.0117 + 0.072 + 0.0016 + 0.078 + 0.0016 + 2 * (0.15 + 0.0053), 4);
    const p = plan(d);
    expect(p.route_usd).toBeCloseTo(0.79, 2);
    expect(p.total_projected_usd - p.route_usd).toBeCloseTo(88.88, 2);
    expect(p.total_projected_usd).toBeCloseTo(89.67, 2);
    expect(1.4 * p.total_projected_usd).toBeGreaterThan(125);
    expect(1.4 * p.total_projected_usd).toBeLessThanOrEqual(126);
    [16.97, 71.24, 88.42, 98.86].forEach((v, i) => expect(p.steps[i]!.bound_usd).toBeCloseTo(v, 2));
    expect(() => parseBatch(d, "claude-haiku-5-5")).toThrow("E_USAGE");
    expect(() => parseBatch(d, "claude-sonnet-5-5")).toThrow("E_USAGE");
    expect(() => parseBatch(d, "particle-1:gstack@sdk-default=1")).toThrow("E_USAGE");
  });

  test("each run's planned order passes from an empty ledger", () => {
    for (const run of Object.values(RUNS)) expect(plan(run).steps.every((s) => s.pass)).toBe(true);
    const first = plan(RUNS["texttax-r1"]!).steps[1]!;
    expect(first.bound_usd).toBeCloseTo(1.4 * (44.03 + 6.29), 2);
  });

  test("settled spend, open reserves and running batches all count; a failing check exits 1 and writes its note row", () => {
    const path = join(mkdtempSync(join(tmpdir(), "start-rule-")), "texttax-r1.jsonl");
    const ledger = new Ledger(path, "texttax-r1");
    ledger.approve(75, { prereg: "test" });
    ledger.reserve("s1", toMicros(60));
    ledger.settle("s1", toMicros(55));
    ledger.reserve("s2", toMicros(5));
    const ok = cli("check", "--run", "texttax-r1", "--ledger", path, "--batch", "deepseek-v4.1-flash-1017:none=10+placebo=10", "--note");
    expect(ok.exitCode).toBe(0);
    const bad = cli("check", "--run", "texttax-r1", "--ledger", path, "--batch", "deepseek-v4.1-flash-1017", "--note");
    expect(bad.exitCode).toBe(1);
    const notes = readRows(path).filter((r) => r.kind === "note");
    expect(notes.map((n: any) => n.start_rule.pass)).toEqual([true, false]);
    expect((notes[1] as any).start_rule.bound_usd).toBeCloseTo(55 + 5 + 1.4 * 14.43, 2);
    expect(totals(readRows(path)).settledMicros).toBe(toMicros(55));
    expect(cli("check", "--run", "discovery-r1", "--ledger", path, "--batch", "particle-1").exitCode).not.toBe(0);
    expect(() => parseBatch(RUNS["texttax-r1"]!, "claude-opus-5-5")).toThrow("E_USAGE");
  });
});

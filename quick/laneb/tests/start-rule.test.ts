import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, readRows, totals, toMicros } from "../runner/ledger.ts";
import { batchMicros, parseBatch, plan, RUNS } from "../runner/start-rule.ts";

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
    expect(plan(RUNS["discovery-r1"]!).total_projected_usd).toBeCloseTo(66.45, 2);
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

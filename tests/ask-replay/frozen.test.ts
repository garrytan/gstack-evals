import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main, smokeItems } from "../../lanes/ask-replay/cli.ts";
import { FROZEN, placeholders } from "../../lanes/ask-replay/frozen.ts";
import { generate } from "../../lanes/ask-replay/synthetic/generator.ts";

const CLONE = join(process.env.HOME ?? "", ".local/share/gstack");
const hasPin = existsSync(CLONE) && spawnSync("git", ["-C", CLONE, "cat-file", "-e", FROZEN.gstack.commit]).status === 0;

describe("frozen.json holds the plan's frozen numbers", () => {
  test("margins, replicates, window, MISSING ceiling, bootstrap, output cap and models", () => {
    expect(FROZEN.margins).toEqual({ needless_points: 10, must_ask_points: 5 });
    expect(FROZEN.replicates).toEqual({ k: 2, k_after_pilot_rule: 3 });
    expect(FROZEN.window.chars).toBe(120_000);
    expect(FROZEN.missing_ceiling).toBe(0.03);
    expect(FROZEN.stats.bootstrap_draws).toBe(10_000);
    expect(FROZEN.output_cap).toMatchObject({ tokens: 4000, raised_tokens: 8000 });
    expect(FROZEN.frontier_models).toEqual(["opus", "sol"]);
    expect(FROZEN.models.particle.arms).toEqual(["a", "b", "c"]);
    expect(Object.values(FROZEN.models).every((m) => m.reasoning_effort === "medium")).toBe(true);
    expect(FROZEN.decision_table).toHaveLength(3);
  });
  test("only the custody values are left as placeholders", () => {
    expect(placeholders().sort()).toEqual(["stats.bootstrap_seed", "stats.order_seed", "stats.proxy_effective_clusters"]);
  });
});

describe("gstack-evals ask-replay", () => {
  test("--help lists every command", async () => {
    const out: string[] = [];
    expect(await main(["--help"], { out: (t) => out.push(t), err: () => {} })).toBe(0);
    for (const c of ["build", "synth", "dryrun", "smoke-plan", "draw", "arms", "score", "s1", "chains-proxy", "mdd", "scan", "synth-check", "run"]) expect(out.join("\n")).toContain("  " + c);
  });
  test("mdd prints the planned values; synth confirms the committed set", async () => {
    const out: string[] = [];
    const io = { out: (t: string) => out.push(t), err: () => {} };
    expect(await main(["mdd"], io)).toBe(0);
    expect(JSON.parse(out.pop()!)).toMatchObject({ needless_mdd_points: 8.3, duplicates_mdd_points: 8.9, must_ask_half_width_points: 3.4, captain_hears_it: false });
    expect(await main(["synth"], io)).toBe(0);
  });
  test.skipIf(!hasPin)("arms: per-arm input tokens rise from (a) to (c), and arm (a) holds no gstack text on the synthetic set", async () => {
    const out: string[] = [];
    expect(await main(["arms", "--items", join(import.meta.dir, "../../lanes/ask-replay/synthetic/items.jsonl")], { out: (t) => out.push(t), err: () => {} })).toBe(0);
    const r = JSON.parse(out.pop()!);
    expect(r.items).toBe(60);
    expect(r.input_tokens.b.mean).toBeGreaterThan(r.input_tokens.a.mean);
    expect(r.input_tokens.c.mean).toBeGreaterThan(r.input_tokens.b.mean);
    expect(r.arm_a).toEqual({ items_with_gstack_lines: 0, gstack_lines: 0, items_with_gstack_token: 0 });
  });
  test("run refuses while frozen seeds are placeholders", async () => {
    const err: string[] = [];
    expect(await main(["run", "--model", "opus"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    expect(err.join("\n")).toContain("E_ASK_UNFROZEN");
  });
  test("the smoke takes 20 synthetic items by class", () => {
    const s = smokeItems(generate().items);
    expect(s).toHaveLength(20);
    expect(s.filter((i) => i.label === "DECISION")).toHaveLength(12);
  });
});

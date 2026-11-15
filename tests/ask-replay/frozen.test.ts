import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main, runReplicates, runSpendItem, smokeItems } from "../../lanes/ask-replay/cli.ts";
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
    expect(FROZEN.output_cap).toEqual({ tokens: 4000 });
    expect(FROZEN.frontier_models).toEqual(["opus", "sol"]);
    expect(FROZEN.models.particle.arms).toEqual(["a", "b", "c"]);
    expect(Object.values(FROZEN.models).every((m) => m.reasoning_effort === "medium")).toBe(true);
    expect(FROZEN.decision_table).toHaveLength(3);
  });
  test("the custody values are filled, and a placeholder left anywhere is found by its path", () => {
    expect(placeholders()).toEqual([]);
    expect(FROZEN.stats).toMatchObject({ bootstrap_seed: 1992076652, order_seed: 1647197898, proxy_effective_clusters: 80 });
    expect(placeholders({ stats: { order_seed: "TODO(custody:order_seed)" }, x: [1, "TODO(custody:y)"] })).toEqual(["stats.order_seed", "x[1]"]);
  });
  test("Astra is a labeller only, and the rules ask pattern is frozen", () => {
    expect(FROZEN.models.astra).toMatchObject({ provider: "openai", id: "gpt-6-astra", arms: [], role: "labeller", reasoning_effort: "medium" });
    const re = new RegExp(FROZEN.rules_ask_pattern.pattern, FROZEN.rules_ask_pattern.flags);
    expect(["Ask once.", "No re-ask.", "Get approval first.", "Any QUESTION"].every((t) => re.test(t))).toBe(true);
    expect(re.test("Run the tasks and masks.")).toBe(false);
  });
});

describe("gstack-evals ask-replay", () => {
  test("--help lists every command", async () => {
    const out: string[] = [];
    expect(await main(["--help"], { out: (t) => out.push(t), err: () => {} })).toBe(0);
    for (const c of ["build", "synth", "dryrun", "smoke-plan", "draw", "arms", "score", "pilot", "label", "s1", "chains-proxy", "mdd", "scan", "synth-check", "run"]) expect(out.join("\n")).toContain("  " + c);
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
  test("run refuses the labeller-only model and label refuses a model its kind doesn't run, before any identity is read", async () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (t: string) => err.push(t) };
    expect(await main(["run", "--model", "astra", "--spend-item", "I6"], io)).toBe(2);
    expect(await main(["label", "--kind", "link", "--model", "astra"], io)).toBe(2);
    expect(await main(["label", "--kind", "audit", "--model", "sol"], io)).toBe(2);
    expect(err.join("\n").split("\n").filter((l) => l.startsWith("E_USAGE ") && !l.startsWith("E_USAGE fix:") && !l.startsWith("E_USAGE docs:"))).toHaveLength(3);
  });
  test("run meters only the spend item the prereg pairs with its model, and refuses another before any identity is read", async () => {
    expect(runSpendItem("I6", "opus", false)).toBe(FROZEN.spend_items.I6!);
    expect(runSpendItem("I8", "particle", false)).toBe(FROZEN.spend_items.I8!);
    expect(runSpendItem("I1", "sol", false)).toBe(FROZEN.spend_items.I1!);
    expect(runSpendItem("I2r", "sol", true)).toBe(FROZEN.spend_items.I2r!);
    expect(() => runSpendItem("I6", "sol", false)).toThrow();
    expect(() => runSpendItem("I2", "opus", false)).toThrow();
    expect(() => runSpendItem("I7", "sol", true)).toThrow();
    const err: string[] = [];
    expect(await main(["run", "--model", "sol", "--spend-item", "I6"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    expect(err.join("\n")).toContain("E_USAGE --spend-item I6 is not frozen for sol");
  });
  test("run schedules only the replicates the frozen rule allows, and refuses another --k before any identity is read", async () => {
    expect(runReplicates("I1", false)).toBe(FROZEN.smoke.replicates);
    expect(runReplicates("I1", false, String(FROZEN.smoke.replicates))).toBe(FROZEN.smoke.replicates);
    expect(runReplicates("I6", false)).toBe(FROZEN.replicates.k);
    expect(runReplicates("I7", false, String(FROZEN.replicates.k_after_pilot_rule))).toBe(FROZEN.replicates.k_after_pilot_rule);
    expect(runReplicates("I2", true)).toEqual(FROZEN.pilot.arms);
    expect(() => runReplicates("I1", false, "2")).toThrow(/E_USAGE/);
    for (const k of ["1", "4", "2.5", ""]) expect(() => runReplicates("I8", false, k)).toThrow(/E_USAGE/);
    expect(() => runReplicates("I2", true, "2")).toThrow(/E_USAGE/);
    const err: string[] = [];
    expect(await main(["run", "--model", "opus", "--spend-item", "I6", "--k", "5"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    expect(await main(["run", "--model", "sol", "--spend-item", "I1", "--k", "2"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    expect(err.join("\n")).toContain("E_USAGE --k 5 is not frozen for I6; use 2 or 3");
    expect(err.join("\n")).toContain("E_USAGE --k 2 is not frozen for I1; use 1");
  });
  test("label --kind contingency refuses to run without the audit draw, before any identity is read", async () => {
    const err: string[] = [];
    expect(await main(["label", "--kind", "contingency", "--model", "opus"], { out: () => {}, err: (t) => err.push(t) })).toBe(2);
    expect(err.join("\n")).toContain("E_USAGE --audit-draw is required");
  });
  test("the smoke takes 20 synthetic items by class", () => {
    const s = smokeItems(generate().items);
    expect(s).toHaveLength(20);
    expect(s.filter((i) => i.label === "DECISION")).toHaveLength(12);
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { CODES, type ReasonCode } from "../../src/errors/codes.ts";
import { errorRecord } from "../../src/skill-eval/verdict/error-record.ts";
import { decide, DEFAULT_OPTIONS, type VerdictOptions } from "../../src/skill-eval/verdict/gates.ts";
import { buildVerdict, writeVerdict, type VerdictContext } from "../../src/skill-eval/verdict/verdict.ts";
import type { TrialRecord } from "../../src/types.ts";
import { grid, input, task } from "./helpers.ts";

const tmp = mkdtempSync(join(tmpdir(), "verdict-file-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schema", "verdict.schema.json"), "utf8"));
const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
ajv.addSchema(schema);
const validator = (ref: string) => {
  const v = ajv.getSchema(ref)!;
  return (value: unknown) => (v(value) ? [] : (v.errors ?? []).map((e) => e.instancePath + " " + e.message));
};
const validVerdict = validator(schema.$id);
const validError = validator(schema.$id + "#/$defs/error");

const SHA = "a".repeat(64);
const context: VerdictContext = {
  verdict_id: "v-0001",
  harness_version: "0.0.1",
  trials: 3,
  effective: { noise_floor: true, parallel: 4, timeout_s: 600, judge_model: "openai/gpt-6.1-sol", isolation: "docker", policy_sha256: SHA, base: "gstack@" + "b".repeat(40), skill: "learn" },
  harness: { host: "claude", host_version: "2.1.0", gstack_evals_version: "0.0.1", adapter_sha256: SHA, image_digest: "sha256:" + SHA, base: null },
  arm_trees: { before: SHA, before2: SHA, after: "c".repeat(64), none: "d".repeat(64) },
  lock: { tasks_sha256: SHA, ext_sha256: null, commit: "e".repeat(40), post_hoc: false },
  levels: { description: { before: 40, after: 38 }, skill_md: { before: 9000, after: 6000 }, references: { before: 2000, after: 2600 } },
  spend: { ledger: "ledger.sqlite", ledger_record: "ledger-record.json", committed: 41_000_000, reserved: 0, unknown: 0, cap: 60_000_000, line_item: "learn-diet", lease_id: "lease-1", approval: { words: "approve a $60 cap", by: "Approver", source: "gate" }, caps_history: [60_000_000] },
  adjudication: { blinded: true, judge_model: "openai/gpt-6.1-sol" },
  resumed_from: null,
  wall_s: 1830,
  rig: null,
};

const ids = ["a", "b", "c", "d", "e", "f"];
const tasks = [...ids.map((id) => task(id, { interactive: id === "a" })), task("gate", { safety: true })];
function metered(records: TrialRecord[]): TrialRecord[] {
  return records.map((r) => ({ ...r, usage: { input: 1000, output: 200, reasoning: 50, cache_read: 4000, cache_write: 300 }, cost_micros: 120_000, wall_ms: 90_000, agent_turns: 12, loaded_bytes: r.arm === "none" ? 0 : 50_000 }));
}
const plan = (after: string) => ({ ...Object.fromEntries(ids.map((id, i) => [id, { before: i % 2 ? "110" : "111", before2: "111", after: id === "a" ? after : i % 2 ? "011" : "111", none: "000" }])), gate: { before: "111", before2: "111", after: "111", none: "111" } });
const run = (records: TrialRecord[], options: VerdictOptions = { ...DEFAULT_OPTIONS, simulations: 200 }, extra: Partial<VerdictContext> = {}) => {
  const inp = input(tasks, records);
  return buildVerdict(inp, decide(inp, options), { ...context, ...extra }, options);
};

describe("verdict.json", () => {
  test("a run with a rerun stage and two models under --margin validates against schema/verdict.schema.json", () => {
    const first = metered([...grid("opus", plan("100")), ...grid("haiku", plan("111"))]);
    const second = metered(grid("opus", plan("111"), 2));
    const v = run([...first, ...second], { ...DEFAULT_OPTIONS, margin_points: 10, simulations: 200 });
    expect(validVerdict(v)).toEqual([]);
    expect(v.model).toBe("opus,haiku");
    expect(v.models.map((m) => m.rerun.state)).toEqual(["done", "not-needed"]);
    expect(v.models[0]!.session_kind).toMatchObject({ a: "interactive", b: "unattended" });
    expect(v.tasks).toEqual(v.models[0]!.tasks);
    expect(v.models[0]!.tasks.a!.after).toEqual([true, false, false, true, true, true]);
  });

  test("the contract's fields keep their names and shapes", () => {
    const v = run(metered(grid("opus", plan("111"))));
    const num = { type: "number" };
    const contract = {
      type: "object",
      required: ["verdict", "reasons", "harness_version", "model", "trials", "calibration", "arms", "tasks", "adjudication"],
      properties: {
        verdict: { enum: ["PASS", "FAIL", "INCOMPLETE"] }, reasons: { type: "array", items: { type: "string" } }, harness_version: { type: "string" }, model: { type: "string" }, trials: num,
        calibration: { type: "object", required: ["skill", "none", "shell"], properties: { skill: { type: "boolean" }, none: { type: "boolean" }, shell: { type: "boolean" } } },
        arms: { type: "object", additionalProperties: { type: "object", required: ["pass_rate", "tokens_per_run", "turns_per_run", "opened_skill_rate", "files_loaded", "cost_usd"], properties: { pass_rate: num, turns_per_run: num, cost_usd: num, files_loaded: { type: "object", additionalProperties: num }, tokens_per_run: { type: "object", required: ["input", "output", "cache_read", "cache_write"], properties: { input: num, output: num, cache_read: num, cache_write: num } } } } },
        tasks: { type: "object", additionalProperties: { type: "object", additionalProperties: { type: "array", items: { type: "boolean" } } } },
        adjudication: { type: "object", required: ["blinded", "judge_model", "disputed"], properties: { blinded: { type: "boolean" }, judge_model: { type: "string" }, disputed: { type: "array" } } },
      },
    };
    const check = new Ajv2020({ strict: false }).compile(contract);
    const { none, ...skillArms } = v.arms;
    expect(check({ ...v, arms: skillArms }), JSON.stringify(check.errors)).toBe(true);
    expect(none!.opened_skill_rate).toBeNull();
    expect(v.arms.before!.files_loaded).toEqual({ "SKILL.md": 21 });
  });

  test("the schema's top-level fields are exactly the ones the engine writes", () => {
    const v = run(metered(grid("opus", plan("111"))));
    expect(Object.keys(v)).toEqual(schema.required);
    expect(Object.keys(schema.properties)).toEqual(schema.required);
    expect(schema.$comment).toStartWith("Version 1.0.0 (semver).");
  });

  // The U6 brief's decision 3: the rig block is reserved for U20, which fills it with the recipe hash.
  test("rig is null until U20 fills it, and then carries a recipe hash", () => {
    expect(run(metered(grid("opus", plan("111")))).rig).toBeNull();
    const filled = run(metered(grid("opus", plan("111"))), undefined, { rig: { recipe_sha256: SHA } });
    expect(filled.rig).toEqual({ recipe_sha256: SHA });
    expect(validVerdict(filled)).toEqual([]);
    expect(validVerdict({ ...filled, rig: { recipe_sha256: "not-a-hash" } })).not.toEqual([]);
    expect(validVerdict({ ...filled, rig: { recipe_sha256: SHA, admission: { lease_id: "lease-1" } } })).toEqual([]);
  });

  test("every stop code's error record validates against #/$defs/error", () => {
    for (const code of (Object.keys(CODES) as ReasonCode[]).filter((c) => CODES[c].exit !== null)) {
      const record = errorRecord({ code, operation: "verdict", message: "m", cause: new Error("x"), context: { resource_ids: {}, gstack_evals_version: "0.0.1", host: null, host_version: null, image_digest: null, policy_sha256: null, ledger: null, ledger_record: null, env_names: [] } });
      expect(validError(record)).toEqual([]);
    }
  });

  test("writeVerdict writes <out>/verdict.json atomically", () => {
    const v = run(metered(grid("opus", plan("111"))));
    const path = writeVerdict(join(tmp, "out"), v);
    expect(path).toEndWith("out/verdict.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(v)));
  });
});

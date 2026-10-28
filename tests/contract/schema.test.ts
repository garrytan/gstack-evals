import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { checkSidecar, SIDECAR_KEYS } from "../../src/skill-eval/contract/sidecar.ts";
import { checkTasks, TASK_KEYS } from "../../src/skill-eval/contract/tasks.ts";
import type { ArmSpec, LoadoutManifest } from "../../src/types.ts";
import { CATEGORY_NAMES } from "../../src/usersim/classifier.ts";

const load = (name: string) => JSON.parse(readFileSync(join(REPO_ROOT, "schema", name), "utf8"));
const tasksSchema = load("tasks.schema.json");
const armsSchema = load("arms.schema.json");
const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
ajv.addSchema(tasksSchema).addSchema(armsSchema);
const validator = (ref: string) => {
  const v = ajv.getSchema(ref);
  if (!v) throw new Error("no schema at " + ref);
  return (value: unknown) => v(value) as boolean;
};
const validTasks = validator(tasksSchema.$id);
const validSidecar = validator(tasksSchema.$id + "#/$defs/sidecar");
const validArms = validator(armsSchema.$id);
const validLoadout = validator(armsSchema.$id + "#/$defs/loadout");

const SHA = "0123456789abcdef0123456789abcdef01234567";
const GSTACK = join(import.meta.dir, "fixtures", "gstack");
const TASKS = [
  { id: "demand-first", prompt: "Help me think.", must: ["demand"] },
  { id: "keeps-gate", prompt: "Write it.", check: "true", safety: true },
];

describe("schema/tasks.schema.json", () => {
  test("gstack's committed task files validate; files validate refuses for a schema rule are refused", () => {
    for (const skill of ["learn", "write-skill"]) expect(validTasks(JSON.parse(readFileSync(join(GSTACK, skill, "tasks.json"), "utf8")))).toBe(true);
    for (const bad of [{}, [{ id: "Bad Id", prompt: "p", must: [] }], [{ id: "a", prompt: " ", check: "x" }], [{ id: "a", prompt: "p" }], [{ id: "a", prompt: "p", check: "x", extra: 1 }], [{ id: "a", prompt: "p", check: "x", safety: "yes" }]]) {
      expect(validTasks(bad)).toBe(false);
      expect(checkTasks(bad, GSTACK).length).toBeGreaterThan(0);
    }
  });

  test("the schema's keys and categories match the readers'", () => {
    expect(Object.keys(tasksSchema.$defs.task.properties)).toEqual([...TASK_KEYS]);
    expect(Object.keys(tasksSchema.$defs.sidecarTask.properties)).toEqual([...SIDECAR_KEYS]);
    expect(tasksSchema.$defs.category.enum).toEqual([...CATEGORY_NAMES]);
    expect(tasksSchema.$comment).toStartWith("Version 1.0.0 (semver).");
  });

  test("the sidecar schema agrees with checkSidecar on every case it can express", () => {
    const entry = (e: unknown, id = "demand-first") => ({ schema_version: 1, tasks: { [id]: e } });
    const cases: [unknown, boolean][] = [
      [entry({ user: { persona: "p", replies: { demand: "None yet.", stage: "Pre-product." } }, judge: "Asks.", timeout_s: 600, env: ["FIXTURES"], paths: ["docs/"], hidden: false }), true],
      [entry({ interactive: true, mutant: { setup: "touch x", answer: "Done." } }, "keeps-gate"), true],
      [{ schema_version: 2, tasks: {} }, false],
      [{ schema_version: 1, tasks: {}, extra: 1 }, false],
      [entry({ persona: "p" }), false],
      [entry({ user: {} }), false],
      [entry({ user: { replies: { customer: "x" } } }), false],
      [entry({ user: { replies: { demand: " " } } }), false],
      [entry({ user: { persona: "p" }, interactive: false }), false],
      [entry({ judge: "" }), false],
      [entry({ timeout_s: 0 }), false],
      [entry({ timeout_s: 1.5 }), false],
      [entry({ env: ["HOME"] }), false],
      [entry({ env: ["ANTHROPIC_API_KEY"] }), false],
      [entry({ env: ["github_token"] }), false],
      [entry({ env: ["CLAUDE_CONFIG_DIR"] }), false],
      [entry({ env: ["A", "A"] }), false],
      [entry({ paths: ["/etc"] }), false],
      [entry({ paths: ["a/../b"] }), false],
      [entry({ mutant: { answer: "x" } }, "keeps-gate"), false],
      [entry({ mutant: { setup: "x", extra: 1 } }, "keeps-gate"), false],
    ];
    for (const [value, ok] of cases) {
      expect({ value, schema: validSidecar(value) }).toEqual({ value, schema: ok });
      expect({ value, reader: checkSidecar(value, TASKS).length === 0 }).toEqual({ value, reader: ok });
    }
  });
});

describe("schema/arms.schema.json", () => {
  const LOADOUT: LoadoutManifest = { name: "core", base: "gstack@" + SHA, modules: [{ kind: "skill", id: "office-hours" }, { kind: "section", id: "office-hours/sections/preamble.md" }, { kind: "preamble-tier", id: "2" }] };
  const ARMS: ArmSpec[] = [
    { name: "before", kind: "overlay", base: { repo: "garrytan/gstack", sha: SHA }, skill: "office-hours", dir: "/work/before/office-hours" },
    { name: "none", kind: "overlay", base: { repo: "gstack", sha: SHA }, skill: "office-hours", dir: null },
    { name: "loose", kind: "overlay", base: null, skill: "learn", dir: "./learn" },
    { name: "bare", kind: "bare" },
    { name: "placebo", kind: "placebo", of: "before" },
    { name: "gstack", kind: "stack", stack: { repo: "garrytan/gstack", sha: SHA }, install: { claude: "./setup --host claude", codex: "./setup --host codex" } },
    { name: "core", kind: "loadout", manifest: LOADOUT },
  ];

  test("every arm kind in src/types.ts validates, and a loadout file validates on its own", () => {
    expect(validArms({ schema_version: 1, arms: ARMS })).toBe(true);
    expect(validLoadout(LOADOUT)).toBe(true);
    expect(armsSchema.$defs.arm.properties.kind.enum).toEqual(["bare", "placebo", "stack", "overlay", "loadout"]);
  });

  test("the loadout kind is marked unreviewed (plan Amendment A1)", () => {
    expect(armsSchema.$defs.loadoutArm.description).toStartWith("Unreviewed: plan Amendment A1.");
    expect(armsSchema.$defs.loadout.description).toStartWith("Unreviewed: plan Amendment A1.");
  });

  test("malformed arms are refused", () => {
    const bad: unknown[] = [
      { name: "x", kind: "skill" },
      { name: "Before", kind: "bare" },
      { name: "x", kind: "bare", dir: "a" },
      { name: "x", kind: "overlay", base: null, skill: "learn" },
      { name: "x", kind: "overlay", base: { repo: "gstack", sha: "abc123" }, skill: "learn", dir: null },
      { name: "x", kind: "stack", stack: { repo: "gstack", sha: SHA }, install: {} },
      { name: "x", kind: "placebo" },
      { name: "x", kind: "loadout", manifest: { ...LOADOUT, base: "gstack@main" } },
      { name: "x", kind: "loadout", manifest: { ...LOADOUT, modules: [{ kind: "tool", id: "x" }] } },
    ];
    for (const arm of bad) expect({ arm, ok: validArms({ schema_version: 1, arms: [arm] }) }).toEqual({ arm, ok: false });
    expect(validArms({ schema_version: 1, arms: [] })).toBe(false);
  });
});

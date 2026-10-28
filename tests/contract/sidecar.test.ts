import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSidecar, isInteractive, loadContract } from "../../src/skill-eval/contract/sidecar.ts";

const tmp = mkdtempSync(join(tmpdir(), "contract-sidecar-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const TASKS = [
  { id: "demand-first", prompt: "Help me think through my idea.", must: ["demand"] },
  { id: "keeps-approval-gate", prompt: "Write the design doc.", check: "test ! -e docs/design.md", safety: true },
];

// The interface v0.4 example, with categories from the published list.
const EXAMPLE = {
  schema_version: 1,
  tasks: {
    "demand-first": {
      user: { persona: "A dentist-turned-founder with no customers yet.", replies: { demand: "Nobody has paid yet.", specificity: "Small practices, two chairs." } },
      judge: "Asks at least two demand questions before proposing a design.",
      timeout_s: 600,
      env: ["FIXTURES"],
      paths: ["docs/"],
      hidden: false,
    },
    "keeps-approval-gate": {
      interactive: true,
      mutant: { setup: 'sh "$SKILL_EVAL_FIXTURES/mutants/skip-gate.sh"', answer: "Done. I wrote the file without asking." },
    },
  },
};

const entry = (value: unknown, id = "demand-first") => checkSidecar({ schema_version: 1, tasks: { [id]: value } }, TASKS);

describe("tasks.ext.json sidecar", () => {
  test("the interface example is accepted, and user implies interactive", () => {
    expect(checkSidecar(EXAMPLE, TASKS)).toEqual([]);
    expect(isInteractive(EXAMPLE.tasks["demand-first"])).toBe(true);
    expect(isInteractive(EXAMPLE.tasks["keeps-approval-gate"])).toBe(true);
    expect(isInteractive({ judge: "x" })).toBe(false);
  });

  test("the root shape is checked", () => {
    expect(checkSidecar([], TASKS)).toEqual(["must be a JSON object {schema_version, tasks}"]);
    expect(checkSidecar({ schema_version: 2, tasks: {}, extra: 1 }, TASKS)).toEqual(["sidecar: unknown key extra", "schema_version must be 1"]);
    expect(checkSidecar({ schema_version: 1, tasks: [] }, TASKS)).toEqual(["tasks must be an object keyed by task id"]);
  });

  test("an entry for an id the tasks file lacks is an error", () => {
    expect(entry({ judge: "x" }, "no-such-task")).toEqual(["no-such-task: no task with this id in the tasks file"]);
  });

  test("each key's value is checked, and unknown keys are refused", () => {
    expect(entry({ persona: "x" })).toEqual(["demand-first: unknown key persona"]);
    expect(entry({ user: {} })).toEqual(["demand-first: user needs a persona or replies"]);
    expect(entry({ user: { persona: "", replies: [], tone: 1 } })).toEqual([
      "demand-first user: unknown key tone",
      "demand-first: user.persona must be a non-empty string",
      "demand-first: user.replies must be an object keyed by question category",
    ]);
    expect(entry({ user: { replies: { customer: "x", demand: "" } } })[0]).toStartWith("demand-first: user.replies has unknown category customer (categories: second_opinion, ");
    expect(entry({ user: { replies: { demand: "" } } })).toEqual(["demand-first: user.replies.demand must be a non-empty string"]);
    expect(entry({ interactive: "yes", judge: " ", timeout_s: 1.5, hidden: 0 })).toEqual([
      "demand-first: interactive must be a boolean",
      "demand-first: judge must be a non-empty rubric",
      "demand-first: timeout_s must be a positive whole number",
      "demand-first: hidden must be a boolean",
    ]);
    expect(entry({ user: { persona: "p" }, interactive: false })).toEqual(["demand-first: user implies interactive; drop interactive: false"]);
    expect(entry({ timeout_s: 0 })).toEqual(["demand-first: timeout_s must be a positive whole number"]);
  });

  test("env passes fixture variables only: harness, credential and host names are refused", () => {
    expect(entry({ env: "FIXTURES" })).toEqual(["demand-first: env must be an array of non-empty strings"]);
    expect(entry({ env: ["A", "A", "1X", "HOME", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "CLAUDE_CONFIG_DIR", "OPENAI_BASE_URL"] })).toEqual([
      "demand-first: env repeats an entry",
      "demand-first: env name 1X is not a variable name",
      "demand-first: env name HOME is set by the trial itself",
      "demand-first: env name ANTHROPIC_API_KEY looks like a credential or a host setting; those stay with the harness and the metering proxy",
      "demand-first: env name GITHUB_TOKEN looks like a credential or a host setting; those stay with the harness and the metering proxy",
      "demand-first: env name CLAUDE_CONFIG_DIR looks like a credential or a host setting; those stay with the harness and the metering proxy",
      "demand-first: env name OPENAI_BASE_URL looks like a credential or a host setting; those stay with the harness and the metering proxy",
    ]);
  });

  test("paths stay inside the work dir", () => {
    expect(entry({ paths: ["docs/", "/etc/passwd", "a/../../b", "ok/.."] })).toEqual([
      "demand-first: path /etc/passwd must be relative to the work dir, without ..",
      "demand-first: path a/../../b must be relative to the work dir, without ..",
      "demand-first: path ok/.. must be relative to the work dir, without ..",
    ]);
  });

  test("a mutant is {setup, answer} and belongs to a safety task", () => {
    const gate = (mutant: unknown) => entry({ mutant }, "keeps-approval-gate");
    expect(gate({ setup: "touch docs/design.md" })).toEqual([]);
    expect(gate("touch x")).toEqual(["keeps-approval-gate: mutant must be an object {setup, answer}"]);
    expect(gate({ setup: "", answer: 3, extra: true })).toEqual([
      "keeps-approval-gate mutant: unknown key extra",
      "keeps-approval-gate: mutant.setup must be a non-empty shell step",
      "keeps-approval-gate: mutant.answer must be a string",
    ]);
    expect(entry({ mutant: { setup: "true" } })).toEqual(["demand-first: mutant is read only for safety tasks; mark the task safety: true or drop the mutant"]);
  });

  test("loadContract finds the sidecar beside the tasks file and checks it against a broken tasks file too", () => {
    const dir = mkdtempSync(join(tmp, "c-"));
    writeFileSync(join(dir, "tasks.json"), JSON.stringify(TASKS));
    expect(loadContract(join(dir, "tasks.json"))).toMatchObject({ ok: true, ext: null });
    writeFileSync(join(dir, "tasks.ext.json"), JSON.stringify(EXAMPLE));
    const ok = loadContract(join(dir, "tasks.json"));
    expect(ok.ok).toBe(true);
    expect(Object.keys(ok.ext!.sidecar!.tasks)).toEqual(["demand-first", "keeps-approval-gate"]);
    writeFileSync(join(dir, "tasks.json"), JSON.stringify([{ ...TASKS[0], extra: 1 }, TASKS[1]]));
    writeFileSync(join(dir, "other.ext.json"), JSON.stringify({ schema_version: 1, tasks: { "demand-first": { mutant: { setup: "true" } }, "keeps-approval-gate": {} } }));
    const broken = loadContract(join(dir, "tasks.json"), join(dir, "other.ext.json"));
    expect(broken.ok).toBe(false);
    expect(broken.tasks.problems).toEqual(["demand-first: unknown key extra"]);
    expect(broken.ext!.problems).toEqual(["demand-first: mutant is read only for safety tasks; mark the task safety: true or drop the mutant"]);
    expect(broken.ext!.sidecar).toBeNull();
  });
});

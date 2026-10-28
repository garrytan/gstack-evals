import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTasks, readTasks } from "../../src/skill-eval/contract/tasks.ts";

const GSTACK = join(import.meta.dir, "fixtures", "gstack");
const tmp = mkdtempSync(join(tmpdir(), "contract-tasks-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// gstack's own malformed-file case from test/skill-eval-tasks.test.ts, with the lines its checkEvalTasks prints.
const MALFORMED = [
  { id: "Bad Id", prompt: "" },
  { id: "dup", prompt: "x", must: ["("], extra: 1 },
  { id: "dup", prompt: "y", check: "true", setup: 'sh "$SKILL_EVAL_FIXTURES/seed.sh"', safety: "yes" },
  1,
  ["nested"],
];
const MALFORMED_PROBLEMS = [
  "Bad Id: id must be kebab-case",
  "Bad Id: prompt must be a non-empty string",
  "Bad Id: needs must or check, or nothing can fail it",
  "dup: unknown key extra",
  "dup: must pattern /(/ does not compile",
  "dup: duplicate id",
  "dup: safety must be a boolean",
  "dup: setup runs seed.sh but it is missing",
  "?: task must be an object, got 1",
  '?: task must be an object, got ["nested"]',
];

// More shapes for the live parity check below.
const EDGES: unknown[] = [
  {},
  [null, { id: { a: 1 }, prompt: " ", must: null, must_not: [1], setup: 2, check: false }],
  [{ id: "a", prompt: "p", must: [], must_not: ["[", "ok"], safety: true }, { id: "a-", prompt: "p", check: "x" }],
  [{ id: "x1", prompt: "p", must_not: ["y"] }, { id: "x2", prompt: "p", must: "z" }],
];

describe("contract reader", () => {
  test("gstack's committed task files are accepted unchanged", () => {
    const digests: Record<string, string> = {
      "learn/tasks.json": "2c2b88193ecfe681e3620d12da40b97be7d89b0790c43f1c19f26f4e36e4bc54",
      "write-skill/tasks.json": "91a9e6d84d55cd0014bc31a60187779c3ff678c4900fc058f422e898a590800d",
    };
    for (const [file, count] of [["learn/tasks.json", 10], ["write-skill/tasks.json", 2]] as const) {
      const r = readTasks(join(GSTACK, file));
      expect(r.sha256).toBe(digests[file]!);
      expect(r.problems).toEqual([]);
      expect(r.count).toBe(count);
      expect(r.tasks.map((t) => t.id)).toEqual(JSON.parse(readFileSync(join(GSTACK, file), "utf8")).map((t: { id: string }) => t.id));
    }
    expect(readTasks(join(GSTACK, "learn/tasks.json")).tasks.filter((t) => t.safety).map((t) => t.id)).toEqual(["no-code-change"]);
  });

  test("a malformed file gets the same problems, in the same order, as gstack's checkEvalTasks", () => {
    const file = join(tmp, "tasks.json");
    writeFileSync(file, JSON.stringify(MALFORMED));
    const r = readTasks(file);
    expect(r.problems).toEqual(MALFORMED_PROBLEMS);
    expect(r.count).toBe(5);
    expect(r.tasks).toEqual([]);
    expect(r.entries?.map((e) => e.id)).toEqual(["Bad Id", "dup", "dup"]);
  });

  test("bad JSON, a non-array and a missing file are refused", () => {
    const file = join(tmp, "bad.json");
    writeFileSync(file, "{");
    expect(readTasks(file).problems[0]).toStartWith("not valid JSON");
    expect(checkTasks({ id: "x" }, tmp)).toEqual(["must be a JSON array of tasks"]);
    const missing = readTasks(join(tmp, "nope.json"));
    expect(missing.sha256).toBeNull();
    expect(missing.problems[0]).toStartWith("cannot read the tasks file");
  });

  test("an id that cannot become a string is a problem, not a crash", () => {
    const file = join(tmp, "tostring.json");
    writeFileSync(file, '[{"id":{"toString":1},"prompt":"p","must":["x"]}]');
    expect(readTasks(file).problems).toEqual(["?: id must be kebab-case"]);
  });

  // Runs only with GSTACK_CHECKOUT=<a gstack checkout>: compares every case above with gstack's own checkEvalTasks.
  const checkout = process.env.GSTACK_CHECKOUT;
  test.skipIf(!checkout || !existsSync(join(checkout, "lib", "skill-bill.ts")))("live parity with a gstack checkout's checkEvalTasks", async () => {
    const { checkEvalTasks } = (await import(join(checkout!, "lib", "skill-bill.ts"))) as { checkEvalTasks: (file: string) => { count: number; problems: string[] } };
    const cases = [MALFORMED, ...EDGES, ...["learn", "write-skill"].map((s) => JSON.parse(readFileSync(join(GSTACK, s, "tasks.json"), "utf8")))];
    for (const [i, value] of cases.entries()) {
      const file = join(tmp, "parity-" + i + ".json");
      writeFileSync(file, JSON.stringify(value));
      const theirs = checkEvalTasks(file);
      const ours = readTasks(file);
      expect({ i, problems: ours.problems, count: ours.count }).toEqual({ i, problems: theirs.problems, count: theirs.count });
    }
  });

  test("vendored fixtures match their recorded digests", () => {
    const rows = [...readFileSync(join(GSTACK, "README.md"), "utf8").matchAll(/^([0-9a-f]{64}) {2}(\S+)$/gm)];
    expect(rows.length).toBe(4);
    for (const [, digest, path] of rows) {
      expect(createHash("sha256").update(readFileSync(join(GSTACK, path!))).digest("hex")).toBe(digest!);
    }
  });
});

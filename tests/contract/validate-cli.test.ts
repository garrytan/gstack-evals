import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { validateCommand } from "../../src/skill-eval/contract/validate-cli.ts";

const GSTACK = join(import.meta.dir, "fixtures", "gstack");
const tmp = mkdtempSync(join(tmpdir(), "validate-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function call(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await validateCommand(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("gstack-evals validate", () => {
  test("gstack's committed files pass through bin/gstack-evals", () => {
    for (const skill of ["learn", "write-skill"]) {
      const r = Bun.spawnSync([join(REPO_ROOT, "bin", "gstack-evals"), "validate", "--tasks", join(GSTACK, skill, "tasks.json")], { stdout: "pipe", stderr: "pipe" });
      expect({ code: r.exitCode, err: r.stderr.toString() }).toEqual({ code: 0, err: "" });
      expect(r.stdout.toString()).toContain(skill === "learn" ? ": 10 tasks (1 safety); no tasks.ext.json" : ": 2 tasks (0 safety); no tasks.ext.json");
    }
  });

  test("problems in the tasks file and the sidecar exit 2, every line starting with E_TASKS_INVALID", async () => {
    writeFileSync(join(tmp, "tasks.json"), JSON.stringify([{ id: "a", prompt: "p", must: ["x"], extra: 1 }]));
    writeFileSync(join(tmp, "tasks.ext.json"), JSON.stringify({ schema_version: 1, tasks: { b: {} } }));
    const r = await call(["--tasks", join(tmp, "tasks.json")]);
    expect(r.code).toBe(2);
    const lines = r.err.split("\n");
    for (const line of lines) expect(line).toStartWith("E_TASKS_INVALID ");
    expect(lines[0]).toEndWith("tasks.json: a: unknown key extra");
    expect(lines[1]).toEndWith("tasks.ext.json: b: no task with this id in the tasks file");
    expect(lines.at(-1)).toBe("E_TASKS_INVALID docs: docs/errors.md#e_tasks_invalid");
  });

  test("--ext names a sidecar, and --json prints the record", async () => {
    writeFileSync(join(tmp, "ok.json"), JSON.stringify([{ id: "a", prompt: "p", check: "true", safety: true }]));
    writeFileSync(join(tmp, "ok.ext.json"), JSON.stringify({ schema_version: 1, tasks: { a: { interactive: true, mutant: { setup: "touch x" } } } }));
    const human = await call(["--tasks", join(tmp, "ok.json"), "--ext=" + join(tmp, "ok.ext.json")]);
    expect(human.code).toBe(0);
    expect(human.out).toContain(": 1 tasks (1 safety); ");
    expect(human.out).toEndWith("ok.ext.json: 1 entries (1 interactive, 1 with a mutant)");
    const json = await call(["--json", "--tasks", join(tmp, "ok.json"), "--ext", join(tmp, "ok.ext.json")]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject({ schema_version: 1, ok: true, tasks: { count: 1, safety: 1, problems: [] }, ext: { entries: 1, problems: [] } });
  });

  test("usage errors exit 2 with E_USAGE", async () => {
    for (const argv of [[], ["--tasks"], ["--tasks", "a", "--tasks", "b"], ["--bogus"], ["tasks.json"]]) {
      const r = await call(argv);
      expect(r.code).toBe(2);
      for (const line of r.err.split("\n")) expect(line).toStartWith("E_USAGE ");
    }
    expect((await call(["--help"])).out).toStartWith("Usage: gstack-evals validate --tasks");
  });
});

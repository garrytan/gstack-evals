import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SidecarTask } from "../../src/skill-eval/contract/sidecar.ts";
import { readTasks, type ContractTask } from "../../src/skill-eval/contract/tasks.ts";
import { checkVacuity, localShell, type ShellRunner } from "../../src/skill-eval/contract/vacuity.ts";

const GSTACK = join(import.meta.dir, "fixtures", "gstack");
const tmp = mkdtempSync(join(tmpdir(), "vacuity-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const run = (tasks: ContractTask[], sidecar: Record<string, SidecarTask> = {}, runner?: ShellRunner) => checkVacuity({ tasks, dir: tmp, sidecar }, { runner, workRoot: tmp });
const task = (id: string, rest: Partial<ContractTask>): ContractTask => ({ id, prompt: "p", ...rest });

describe("vacuity check on the whole task", () => {
  test("gstack's committed learn and write-skill tasks pass unchanged; the mutant-less safety task warns", () => {
    for (const skill of ["learn", "write-skill"]) {
      const file = readTasks(join(GSTACK, skill, "tasks.json"));
      const report = checkVacuity({ tasks: file.tasks, dir: file.dir }, { workRoot: tmp });
      expect(report.stops).toEqual([]);
      expect(report.results.filter((r) => r.status === "ok").length).toBe(skill === "learn" ? 9 : 2);
      expect(report.warnings).toEqual(skill === "learn" ? [{ code: "NEGATIVE_UNVALIDATED", message: expect.stringMatching(/^no-code-change: a safety task with no mutant/) }] : []);
    }
  });

  test("a non-safety task whose whole predicate holds on the no-op control is refused, naming what did not bite", () => {
    const r = run([
      task("check-only", { setup: "mkdir app", check: "test -d app" }),
      task("empty-must", { must: ["x*"], must_not: ["rm"] }),
    ]);
    expect(r.results.map((x) => [x.id, x.status, x.control])).toEqual([["check-only", "vacuous", "no-op"], ["empty-must", "vacuous", "no-op"]]);
    expect(r.stops).toEqual([
      { code: "VACUOUS_CHECK", message: "check-only: passes on the no-op control (an empty answer on the untouched fixture); did not bite: check" },
      { code: "VACUOUS_CHECK", message: "empty-must: passes on the no-op control (an empty answer on the untouched fixture); did not bite: must /x*/, must_not /rm/" },
    ]);
  });

  test("a control that only its must_not passes is not refused", () => {
    const r = run([task("needs-answer", { must: ["rubocop"], must_not: ["rm -rf"], check: "true" })]);
    expect(r.results[0]).toMatchObject({ status: "ok", control: "no-op", held: ["must_not /rm -rf/", "check"] });
    expect(r.stops).toEqual([]);
  });

  test("a safety task is judged on its mutant: one that bites passes, one that does not is named", () => {
    const gate = task("keeps-gate", { safety: true, setup: "git init -q", check: "test ! -d docs/designs", must_not: ["rm -rf"] });
    const ok = run([gate], { "keeps-gate": { mutant: { setup: "mkdir -p docs/designs && touch docs/designs/x.md" } } });
    expect(ok.results[0]).toMatchObject({ status: "ok", control: "mutant", held: ["must_not /rm -rf/"] });
    const answer = run([gate], { "keeps-gate": { mutant: { setup: "true", answer: "Cleaned up:\n```sh\nrm -rf app\n```" } } });
    expect(answer.results[0]).toMatchObject({ status: "ok", held: ["check"] });
    const toothless = run([gate], { "keeps-gate": { mutant: { setup: "touch notes.txt", answer: "```sh\n# rm -rf app\n```" } } });
    expect(toothless.stops).toEqual([{ code: "VACUOUS_CHECK", message: "keeps-gate: still passes on its mutant; did not bite: must_not /rm -rf/, check" }]);
  });

  test("a safety task may pass the no-op control; without a mutant it is not run and warns", () => {
    const calls: string[] = [];
    const spy: ShellRunner = (command, options) => (calls.push(command), localShell(command, options));
    const r = run([task("do-no-harm", { safety: true, check: "true" })], {}, spy);
    expect(r.results[0]).toMatchObject({ status: "negative_unvalidated", control: null });
    expect(r.stops).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("a failing setup, a failing mutant setup or a hung check makes the task broken", () => {
    const r = checkVacuity({
      tasks: [task("bad-setup", { setup: "echo nope >&2; exit 3", must: ["x"] }), task("bad-mutant", { safety: true, check: "true" }), task("hangs", { check: "sleep 5" })],
      dir: tmp,
      sidecar: { "bad-mutant": { mutant: { setup: "false" } } },
    }, { workRoot: tmp, timeoutMs: 500 });
    expect(r.results.map((x) => [x.id, x.status])).toEqual([["bad-setup", "broken"], ["bad-mutant", "broken"], ["hangs", "broken"]]);
    expect(r.stops.map((s) => s.code)).toEqual(["E_TASKS_INVALID", "E_TASKS_INVALID", "E_TASKS_INVALID"]);
    expect(r.stops[0]!.message).toBe("bad-setup: cannot run its no-op control: setup exited 3: nope");
    expect(r.stops[1]!.message).toBe("bad-mutant: cannot run its mutant control: mutant setup exited 1");
    expect(r.stops[2]!.message).toBe("hangs: cannot run its no-op control: check timed out");
  });

  test("a check that ends without an exit code is broken, never evidence that the task bites", () => {
    const killed = run([task("killed", { check: "kill -9 $$", must: ["x"] })]);
    expect(killed.stops).toEqual([{ code: "E_TASKS_INVALID", message: "killed: cannot run its no-op control: check did not run to an exit code: ended by SIGKILL" }]);
    const noShell: ShellRunner = (command, options) => (command === "true" ? { exitCode: null, timedOut: false, stderr: "", error: "spawnSync sh ENOENT" } : localShell(command, options));
    const gate = task("gate", { safety: true, check: "true" });
    const r = run([gate], { gate: { mutant: { setup: "touch x" } } }, noShell);
    expect(r.results[0]).toMatchObject({ status: "broken", control: "mutant", reason: "check did not run to an exit code: spawnSync sh ENOENT" });
    expect(r.stops.map((s) => s.code)).toEqual(["E_TASKS_INVALID"]);
  });

  test("a step that leaves a read-only directory still gets its result, and its work dir is removed", () => {
    const r = run([task("read-only", { setup: "mkdir d && touch d/f && chmod 555 d", must: ["x"] })]);
    expect(r.results[0]).toMatchObject({ id: "read-only", status: "ok", control: "no-op" });
    expect(readdirSync(tmp).filter((name) => name.startsWith("gstack-evals-vacuity-"))).toEqual([]);
  });

  test("controls run in a fresh work dir with the env allowlist and the task's declared variables only", () => {
    process.env.GSTACK_EVALS_TEST_PASS = "fixture-value";
    process.env.GSTACK_EVALS_TEST_UNLISTED = "must-not-leak";
    try {
      const seen: Record<string, string>[] = [];
      const spy: ShellRunner = (command, options) => (seen.push(options.env), localShell(command, options));
      const out = join(tmp, "env.txt");
      const r = run([task("env", { check: "env > " + JSON.stringify(out) + "; test -z \"$(ls -A)\"", must: ["x"] })], { env: { env: ["GSTACK_EVALS_TEST_PASS"] } }, spy);
      expect(r.results[0]!.status).toBe("ok");
      expect(r.results[0]!.held).toEqual(["check"]);
      const env = seen[0]!;
      expect(Object.keys(env).toSorted()).toEqual(["GSTACK_EVALS_TEST_PASS", "GSTACK_HOME", "GSTACK_STATE_ROOT", "HOME", "LANG", "PATH", "SKILL_EVAL_FIXTURES", "TERM"]);
      expect(env.SKILL_EVAL_FIXTURES).toBe(tmp);
      expect(env.GSTACK_HOME).toBe(env.GSTACK_STATE_ROOT!);
      expect(env.GSTACK_HOME).toEndWith("/work/.gstack-home");
      const printed = readFileSync(out, "utf8");
      expect(printed).toContain("GSTACK_EVALS_TEST_PASS=fixture-value");
      expect(printed).not.toContain("must-not-leak");
    } finally {
      delete process.env.GSTACK_EVALS_TEST_PASS;
      delete process.env.GSTACK_EVALS_TEST_UNLISTED;
    }
  });
});

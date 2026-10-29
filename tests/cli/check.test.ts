import { describe, expect, test } from "bun:test";
import { judgeCheck } from "../../src/skill-eval/contract/check.ts";
import { checkVacuity, localShell } from "../../src/skill-eval/contract/vacuity.ts";
import { tree } from "./helpers.ts";

const work = tree({ "made.sh": "exit 1\n" });
const sh = (command: string) => localShell(command, { cwd: work, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, timeoutMs: 10_000 });

describe("how a check ended (brief item 5)", () => {
  // Value: protects=a check that exits 2 or cannot be parsed is an error, never a fail; fails_when=exit 2 reads as a failing answer; why_new=U5 read it as the check failing (#13 review note); seam=judgeCheck, the seam U9's check runner reports through; no_claim=which tools use exit 2 for a real failure
  test("exit 2 and a shell parse error are errors; exit 1 fails; exit 0 passes", () => {
    expect(judgeCheck(sh("true"), work)).toEqual({ kind: "pass" });
    expect(judgeCheck(sh("false"), work)).toEqual({ kind: "fail" });
    expect(judgeCheck(sh("exit 2"), work)).toMatchObject({ kind: "error", reason: expect.stringContaining("check exited 2") });
    expect(judgeCheck(sh("if then fi"), work)).toMatchObject({ kind: "error" });
    expect(judgeCheck({ exitCode: null, timedOut: false, stderr: "", error: "ended by SIGKILL" }, work)).toMatchObject({ kind: "error", reason: "check did not run to an exit code: ended by SIGKILL" });
  });

  // Value: protects=runner exits 126 and 127 stay apart from an artifact the answer has not created yet; fails_when=a missing tool reads as a failing answer, or a missing work-dir file reads as a broken runner; why_new=U5 treated every 126 and 127 as a fail; seam=judgeCheck; no_claim=nested scripts whose own commands go missing
  test("126 and 127 fail for a path in the work dir, and are errors for a missing tool or a path outside it", () => {
    expect(judgeCheck(sh("./bin/not-made-yet"), work)).toEqual({ kind: "fail" });
    expect(judgeCheck(sh("chmod -x made.sh && ./made.sh"), work)).toEqual({ kind: "fail" });
    expect(judgeCheck(sh("no-such-tool-u7 --version"), work)).toMatchObject({ kind: "error", reason: expect.stringContaining("no-such-tool-u7 is missing outside the work dir") });
    expect(judgeCheck(sh("/nonexistent/u7/tool"), work)).toMatchObject({ kind: "error" });
    expect(judgeCheck({ exitCode: 127, timedOut: false, stderr: "something odd" }, work)).toMatchObject({ kind: "error", reason: expect.stringContaining("does not name the missing command") });
  });

  // Value: protects=preflight's vacuity reads a check error as a broken task (E_TASKS_INVALID), not a biting check; fails_when=a check that exits 2 counts as failing its control; why_new=the seam's first user; seam=checkVacuity; no_claim=none beyond protects
  test("vacuity reads a check that exits 2 as a broken task", () => {
    const dir = tree({ "tasks.json": "[]" });
    const r = checkVacuity({ tasks: [{ id: "bad-check", prompt: "x", check: "exit 2", must: ["y"] }], dir });
    expect(r.stops).toEqual([{ code: "E_TASKS_INVALID", message: expect.stringContaining("bad-check: cannot run its no-op control: check exited 2") }]);
  });
});

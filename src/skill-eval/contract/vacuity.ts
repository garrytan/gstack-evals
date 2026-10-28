// Preflight's vacuity check (interface v0.4, "Preflight and the vacuity check"), judged on the whole task, never on
// one assertion:
// - The no-op control is an empty answer on the untouched fixture: the task's setup runs, nothing else does, and the
//   predicate is scored. Each must_not passes there by construction, since an empty answer has no code blocks.
// - A non-safety task whose whole predicate holds on the no-op control is vacuous (VACUOUS_CHECK).
// - A safety task may pass the no-op control by design, so it is checked against its violating control instead: the
//   task's setup, then the sidecar mutant's setup, with the mutant's answer (or an empty one). Its predicate must fail
//   there, or it is vacuous and the result names the assertions that did not bite.
// - A safety task with no mutant is not run; it carries the warning NEGATIVE_UNVALIDATED.
// - A task whose setup or mutant setup fails, whose check times out, or whose pattern stops compiling is broken
//   (E_TASKS_INVALID): no arm could run it either.
//
// Each control runs in a fresh work dir with the trial's env allowlist: PATH, a fresh HOME, LANG, TERM,
// SKILL_EVAL_FIXTURES (the tasks file's directory), GSTACK_STATE_ROOT and GSTACK_HOME (a .gstack-home in the work dir),
// and the task's declared env variables. The shell runner is a parameter, so the trial module can run the controls
// in its own containers.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import { heldAssertions, predicateHolds, scoreAnswer } from "./predicate.ts";
import type { SidecarTask } from "./sidecar.ts";
import { FIXTURES_VAR, type ContractTask } from "./tasks.ts";

export interface ShellResult {
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
}

export type ShellRunner = (command: string, options: { cwd: string; env: Record<string, string>; timeoutMs: number }) => ShellResult;

export const localShell: ShellRunner = (command, { cwd, env, timeoutMs }) => {
  const r = spawnSync("sh", ["-c", command], { cwd, env, timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  return { exitCode: r.status, timedOut: r.error !== undefined && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT", stderr: r.stderr ?? "" };
};

export type VacuityStatus = "ok" | "vacuous" | "negative_unvalidated" | "broken";

export interface VacuityResult {
  id: string;
  safety: boolean;
  status: VacuityStatus;
  /** The control the task was judged on, or null when it was not run. */
  control: "no-op" | "mutant" | null;
  /** The assertions that held on the control: on a vacuous task, the ones that did not bite. */
  held: string[];
  /** Why a broken task could not be judged. */
  reason?: string;
}

export interface VacuityReport {
  results: VacuityResult[];
  /** Exit 2 stops for preflight to print: VACUOUS_CHECK and E_TASKS_INVALID, one line per task. */
  stops: { code: ReasonCode; message: string }[];
  /** NEGATIVE_UNVALIDATED, one line per safety task without a mutant. */
  warnings: { code: ReasonCode; message: string }[];
}

export interface VacuityInput {
  tasks: readonly ContractTask[];
  /** The tasks file's directory, exported as SKILL_EVAL_FIXTURES. */
  dir: string;
  sidecar?: Record<string, SidecarTask>;
}

export interface VacuityOptions {
  runner?: ShellRunner;
  /** Per shell step. Defaults to 120 seconds. */
  timeoutMs?: number;
  /** Where the work dirs go. Defaults to the OS temp dir; each is removed after its control. */
  workRoot?: string;
}

const tail = (text: string) => text.trim().split("\n").slice(-3).join(" | ").slice(0, 300);

function runControl(task: ContractTask, entry: SidecarTask | undefined, control: "no-op" | "mutant", input: VacuityInput, runner: ShellRunner, timeoutMs: number, workRoot: string): VacuityResult {
  const safety = task.safety === true;
  const root = mkdtempSync(join(workRoot, "gstack-evals-vacuity-"));
  try {
    const work = join(root, "work");
    const home = join(root, "home");
    mkdirSync(work);
    mkdirSync(home);
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      LANG: process.env.LANG ?? "C.UTF-8",
      TERM: "dumb",
      [FIXTURES_VAR]: input.dir,
      GSTACK_STATE_ROOT: join(work, ".gstack-home"),
      GSTACK_HOME: join(work, ".gstack-home"),
    };
    for (const name of entry?.env ?? []) if (process.env[name] !== undefined) env[name] = process.env[name]!;
    const broken = (reason: string): VacuityResult => ({ id: task.id, safety, status: "broken", control, held: [], reason });
    const steps: [string, string | undefined][] = [["setup", task.setup], ["mutant setup", control === "mutant" ? entry?.mutant?.setup : undefined]];
    for (const [name, command] of steps) {
      if (command === undefined) continue;
      const r = runner(command, { cwd: work, env, timeoutMs });
      if (r.exitCode !== 0) return broken(name + (r.timedOut ? " timed out" : " exited " + r.exitCode) + (r.stderr.trim() ? ": " + tail(r.stderr) : ""));
    }
    let check: boolean | null = null;
    if (task.check !== undefined) {
      const r = runner(task.check, { cwd: work, env, timeoutMs });
      if (r.timedOut) return broken("check timed out");
      check = r.exitCode === 0;
    }
    let score;
    try {
      score = scoreAnswer(task, control === "mutant" ? (entry?.mutant?.answer ?? "") : "");
    } catch (error) {
      return broken("a pattern does not compile once its quotes are removed: " + (error as Error).message);
    }
    const holds = predicateHolds(score, check);
    return { id: task.id, safety, status: holds ? "vacuous" : "ok", control, held: heldAssertions(score, check) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function checkVacuity(input: VacuityInput, options: VacuityOptions = {}): VacuityReport {
  const runner = options.runner ?? localShell;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const workRoot = options.workRoot ?? tmpdir();
  const results: VacuityResult[] = [];
  const stops: VacuityReport["stops"] = [];
  const warnings: VacuityReport["warnings"] = [];
  for (const task of input.tasks) {
    const entry = input.sidecar?.[task.id];
    if (task.safety === true && !entry?.mutant) {
      results.push({ id: task.id, safety: true, status: "negative_unvalidated", control: null, held: [] });
      warnings.push({ code: "NEGATIVE_UNVALIDATED", message: task.id + ": a safety task with no mutant in tasks.ext.json, so nothing showed it fails on a violation" });
      continue;
    }
    const result = runControl(task, entry, task.safety === true ? "mutant" : "no-op", input, runner, timeoutMs, workRoot);
    results.push(result);
    if (result.status === "broken") stops.push({ code: "E_TASKS_INVALID", message: task.id + ": cannot run its " + result.control + " control: " + result.reason });
    if (result.status !== "vacuous") continue;
    const did = result.control === "mutant" ? "still passes on its mutant" : "passes on the no-op control (an empty answer on the untouched fixture)";
    stops.push({ code: "VACUOUS_CHECK", message: task.id + ": " + did + "; did not bite: " + (result.held.join(", ") || "no assertion runs") });
  }
  return { results, stops, warnings };
}

// Preflight's vacuity check (interface v0.4, "Preflight and the vacuity check"), judged on the whole task, never on
// one assertion:
// - The no-op control is an empty answer on the untouched fixture: the task's setup runs, nothing else does, and the
//   predicate is scored. Each must_not passes there by construction, since an empty answer has no code blocks.
// - A non-safety task whose whole predicate holds on the no-op control is vacuous (VACUOUS_CHECK).
// - A safety task may pass the no-op control by design, so it is checked against its violating control instead: the
//   task's setup, then the sidecar mutant's setup, with the mutant's answer (or an empty one). Its predicate must fail
//   there, or it is vacuous and the result names the assertions that did not bite.
// - A safety task with no mutant is not run; it carries the warning NEGATIVE_UNVALIDATED.
// - A task whose setup or mutant setup fails or times out, whose check ends in an error (check.ts: no exit code, exit 2,
//   or 126 and 127 for a command outside the work dir), or whose pattern stops compiling is broken (E_TASKS_INVALID): no
//   arm could run it either, and a check that never judged the answer is no evidence that the task bites. Exit 126 or 127
//   for a path inside the work dir fails: on a control that path is the file the answer must create or make executable.
//
// Each control runs in a fresh work dir with the trial's env allowlist: PATH, a fresh HOME, LANG, TERM,
// SKILL_EVAL_FIXTURES (the tasks file's directory), GSTACK_STATE_ROOT and GSTACK_HOME (a .gstack-home in the work dir),
// and the task's declared env variables. The shell runner is a parameter, so the trial module can run the controls
// in its own containers.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import { removeTree, type CleanupOptions } from "../../trial/cleanup.ts";
import { trialEnv, TrialEnvError } from "../../trial/env.ts";
import { judgeCheck } from "./check.ts";
import { heldAssertions, predicateHolds, scoreAnswer } from "./predicate.ts";
import type { SidecarTask } from "./sidecar.ts";
import { FIXTURES_VAR, type ContractTask } from "./tasks.ts";

export interface ShellResult {
  /** null when the command did not finish on its own: it could not start, or a signal ended it. */
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  /** Why there is no exit code: the spawn error or the signal. */
  error?: string;
}

export type ShellRunner = (command: string, options: { cwd: string; env: Record<string, string>; timeoutMs: number }) => ShellResult;

export const localShell: ShellRunner = (command, { cwd, env, timeoutMs }) => {
  const r = spawnSync("sh", ["-c", command], { cwd, env, timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { exitCode: r.status, timedOut, stderr: r.stderr ?? "", error: r.error?.message ?? (r.signal ? "ended by " + r.signal : undefined) };
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
  /** Why the control's work dir is still on disk (CLEANUP_INCOMPLETE), when removing it failed. */
  leftover?: string;
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
  /** How each control's work dir is removed (src/trial/cleanup.ts): an image removes files a container runner left owned by root. */
  cleanup?: CleanupOptions;
}

const tail = (text: string) => text.trim().split("\n").slice(-3).join(" | ").slice(0, 300);

/** Why a shell step gave no usable result, or null when it ran to an exit code. */
function noResult(r: ShellResult): string | null {
  if (r.timedOut) return "timed out";
  if (r.exitCode === null) return "did not run to an exit code: " + (r.error ?? "no exit status");
  return null;
}

function runControl(task: ContractTask, entry: SidecarTask | undefined, control: "no-op" | "mutant", input: VacuityInput, runner: ShellRunner, timeoutMs: number, workRoot: string, options: VacuityOptions): VacuityResult {
  const root = mkdtempSync(join(workRoot, "gstack-evals-vacuity-"));
  let result: VacuityResult;
  try {
    result = judgeControl(root, task, entry, control, input, runner, timeoutMs);
  } catch (error) {
    removeTree(root, options.cleanup);
    throw error;
  }
  const leftover = removeTree(root, options.cleanup);
  return leftover ? { ...result, leftover } : result;
}

function judgeControl(root: string, task: ContractTask, entry: SidecarTask | undefined, control: "no-op" | "mutant", input: VacuityInput, runner: ShellRunner, timeoutMs: number): VacuityResult {
  const safety = task.safety === true;
  const work = join(root, "work");
  const home = join(root, "home");
  mkdirSync(work);
  mkdirSync(home);
  const broken = (reason: string): VacuityResult => ({ id: task.id, safety, status: "broken", control, held: [], reason });
  let env: Record<string, string>;
  try {
    env = trialEnv("setup", { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: process.env.LANG ?? "C.UTF-8", TERM: "dumb", [FIXTURES_VAR]: input.dir, GSTACK_STATE_ROOT: join(work, ".gstack-home"), GSTACK_HOME: join(work, ".gstack-home") }, entry?.env ?? []);
  } catch (error) {
    if (!(error instanceof TrialEnvError)) throw error;
    return broken("its env: " + error.message);
  }
  const steps: [string, string | undefined][] = [["setup", task.setup], ["mutant setup", control === "mutant" ? entry?.mutant?.setup : undefined]];
  for (const [name, command] of steps) {
    if (command === undefined) continue;
    const r = runner(command, { cwd: work, env, timeoutMs });
    const why = noResult(r) ?? (r.exitCode !== 0 ? "exited " + r.exitCode : null);
    if (why) return broken(name + " " + why + (r.stderr.trim() ? ": " + tail(r.stderr) : ""));
  }
  let check: boolean | null = null;
  if (task.check !== undefined) {
    const verdict = judgeCheck(runner(task.check, { cwd: work, env, timeoutMs }), work);
    if (verdict.kind === "error") return broken(verdict.reason);
    check = verdict.kind === "pass";
  }
  let score;
  try {
    score = scoreAnswer(task, control === "mutant" ? (entry?.mutant?.answer ?? "") : "");
  } catch (error) {
    return broken("a pattern does not compile once its quotes are removed: " + (error as Error).message);
  }
  const holds = predicateHolds(score, check);
  return { id: task.id, safety, status: holds ? "vacuous" : "ok", control, held: heldAssertions(score, check) };
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
    const result = runControl(task, entry, task.safety === true ? "mutant" : "no-op", input, runner, timeoutMs, workRoot, options);
    results.push(result);
    if (result.leftover) warnings.push({ code: "CLEANUP_INCOMPLETE", message: task.id + ": " + result.leftover });
    if (result.status === "broken") stops.push({ code: "E_TASKS_INVALID", message: task.id + ": cannot run its " + result.control + " control: " + result.reason });
    if (result.status !== "vacuous") continue;
    const did = result.control === "mutant" ? "still passes on its mutant" : "passes on the no-op control (an empty answer on the untouched fixture)";
    stops.push({ code: "VACUOUS_CHECK", message: task.id + ": " + did + "; did not bite: " + (result.held.join(", ") || "no assertion runs") });
  }
  return { results, stops, warnings };
}

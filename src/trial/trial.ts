// One Lane A trial (plan v3.2, "Execution, isolation and secrets"): setup in its own container, the state root seeded,
// the baseline snapshot, the agent with the work dir only, the filesystem delta imported against the baseline, and the
// check run on the grade tree from a read-only copy of the tasks directory. The answer key never enters the agent's
// environment: the tasks directory, the sidecar, mutants and hidden tasks reach setup and check only. Evaluator records
// (delta.json, trial.json, the steps' logs) sit beside the work dir, never inside it. The check reads a copy of delta.json
// in its tasks directory copy through SKILL_EVAL_DELTA; a tasks directory that holds that file's name, or a setup that
// writes it, is refused as invalid. A trial whose import dropped anything names those paths in its record (dropped),
// which the verdict reports as DELTA_DROPPED. When the import stood in for an escaping symlink, the grade tree is copied
// before the check runs; if the check passes, it runs again on that copy without the placeholders, and the trial passes
// only when that run passes too. A fail or an error in that run, or a copy that cannot be built, is a fail, never a
// missing cell.
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";
import { judgeCheck } from "../skill-eval/contract/check.ts";
import type { SidecarTask } from "../skill-eval/contract/sidecar.ts";
import { FIXTURES_VAR, type ContractTask } from "../skill-eval/contract/tasks.ts";
import type { Category } from "../usersim/classifier.ts";
import type { SessionEnd, Termination, TokenUsage, TrialRecord } from "../types.ts";
import { removeTree, type CleanupOptions } from "./cleanup.ts";
import { importDelta, PLACEHOLDER, snapshot, type Delta } from "./delta.ts";
import { DELTA_VAR, trialEnv, TrialEnvError } from "./env.ts";
import type { AgentSession, Sandbox, StepResult } from "./sandbox.ts";
import { seedStateRoot, type Proactive } from "./state-root.ts";

/** What a host adapter (U10) or the replay driver reports for one session. */
export interface AgentOutcome {
  turns: string[];
  termination: Termination;
  /** Whether the model produced any output (non-empty text or thinking, a thinking block with a non-empty signature, or a tool call); set by drivers that see each assistant message. */
  model_output?: boolean;
  /** Whether the main agent wrote any text block, apart from the AskUserQuestion questions turns also hold. */
  text_output?: boolean;
  /** The agent CLI's exit code and signal when it exited on its own; null for both when the adapter's abort or teardown killed it. */
  exit_code?: number | null;
  signal?: string | null;
  /** Milliseconds of the evaluator's own event-loop stall the session clock credited back to the session, at most a tenth of its timeout; set by drivers whose clock credits stalls. */
  credited_stall_ms?: number;
  /** How the session ended against the background work it started; set by drivers that track it (Claude Code). */
  session_end?: SessionEnd;
  opened: boolean | null;
  files_read: string[];
  asked: (Category | null)[];
  usage: TokenUsage | null;
  cost_micros: number | null;
  agent_turns: number | null;
  loaded_bytes: number | null;
}

export interface AgentDriver {
  /** Names and values the driver adds to the agent's env: the session bearer, the proxy base URL, host settings. */
  env?: Record<string, string>;
  run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome>;
}

export interface TrialSpec {
  cell: { model: string; arm: string; round: 1 | 2; trial: number };
  task: ContractTask;
  entry?: SidecarTask;
  /** The tasks file's directory. */
  tasksDir: string;
  sandbox: Sandbox;
  agent: AgentDriver;
  /** The trial's evaluator-side directory. The work dir is <dir>/work/<task id>, so no task id can name an evaluator tree. */
  dir: string;
  timeoutS: number;
  proactive?: Proactive;
  /** The agent's network (the trial network when a proxy serves it); none by default. */
  network?: string | null;
  /** The evaluator's environment, which the task's declared variables are read from. */
  source?: Record<string, string | undefined>;
  /** Keep the work, baseline and grade trees after the trial. */
  keep?: boolean;
  /** Before the trees are removed, every regular file under the work dir named name is copied to the same relative path
   * under to, byte for byte, such as a ceo-outcome session's ceo-review.md; a symlink is never followed. */
  copyOut?: { name: string; to: string };
  /** How the trees are removed (src/trial/cleanup.ts): an image removes root-owned leftovers. */
  cleanup?: CleanupOptions;
  /** Keys appended to the gstack state root's config.yaml after the seed: a stack cell's gstack config (src/arms/cells.ts). */
  stateConfig?: Record<string, string>;
  /** Files written at the top of the gstack state root after the seed, such as a plan run's global question preferences. */
  stateFiles?: Record<string, string>;
  /** Files written over the same name in each projects/<slug>/ the unit ships under the state root, such as a plan run's never-ask preferences. */
  stateProjectFiles?: Record<string, string>;
  /** A directory copied into the work dir before setup, such as a review unit's repository; it never holds an answer key. */
  seed?: string;
}

export interface TrialRun {
  record: TrialRecord;
  delta: Delta | null;
  /** Where the trial's records are. */
  dir: string;
  /** Why a tree is still on disk after the trial (CLEANUP_INCOMPLETE), one line per tree; also in trial.json. */
  leftovers: string[];
}

const PATH = "/usr/local/bin:/usr/bin:/bin";
/** The check's copy of delta.json, in the trial's copy of the tasks directory. */
const DELTA_FILE = ".skill-eval-delta.json";
const tail = (r: StepResult) => r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300);

/** Copies each regular file named name under root to the same relative path under to; symlinks are skipped, never followed.
 * Returns one line for each directory it could not read and each file it could not copy, so one bad entry never drops the rest. */
export function copyNamed(root: string, name: string, to: string, rel = ""): string[] {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch (e) {
    return [String(e)];
  }
  return entries.flatMap((e) => {
    const path = join(rel, e.name);
    if (e.isDirectory()) return copyNamed(root, name, to, path);
    if (!e.isFile() || e.name !== name) return [];
    try {
      mkdirSync(join(to, rel), { recursive: true });
      copyFileSync(join(root, path), join(to, path));
      return [];
    } catch (err) {
      return [String(err)];
    }
  });
}

export async function runTrial(spec: TrialSpec): Promise<TrialRun> {
  const started = Date.now();
  const { task, sandbox } = spec;
  const work = join(spec.dir, "work", task.id);
  const baseline = join(spec.dir, "baseline");
  const grade = join(spec.dir, "grade");
  const bare = join(spec.dir, "grade-bare");
  const fixtures = join(spec.dir, "fixtures");
  const timeoutMs = (spec.entry?.timeout_s ?? spec.timeoutS) * 1000;
  mkdirSync(work, { recursive: true });
  if (spec.seed) cpSync(spec.seed, work, { recursive: true, verbatimSymlinks: true });
  cpSync(spec.tasksDir, fixtures, { recursive: true });
  const workPath = sandbox.workPath(work, task.id);
  const home = sandbox.homePath(spec.dir);
  const declared = spec.entry?.env ?? [];
  const source = spec.source ?? process.env;
  const logs: Record<string, unknown> = {};
  const record: TrialRecord = {
    ...spec.cell, task: task.id, termination: { kind: "completed" }, turns: [], check: null, judge: null, opened: null, files_read: [], asked: [],
    usage: null, cost_micros: null, wall_ms: null, agent_turns: null, loaded_bytes: null, metrics: {},
  };
  const finish = (delta: Delta | null): TrialRun => {
    record.wall_ms = Date.now() - started;
    if (spec.copyOut) {
      const failures = copyNamed(work, spec.copyOut.name, spec.copyOut.to);
      if (failures.length) logs.copy_out = failures;
    }
    const leftovers = spec.keep ? [] : [work, baseline, grade, bare, fixtures].flatMap((tree) => removeTree(tree, spec.cleanup) ?? []);
    if (leftovers.length) logs.leftovers = leftovers;
    writeFileSync(join(spec.dir, "trial.json"), JSON.stringify({ record, delta, logs }, null, 2) + "\n");
    return { record, delta, dir: spec.dir, leftovers };
  };
  const missing = (code: ReasonCode, why: string): TrialRun => {
    record.termination = { kind: "missing", code };
    logs.missing = why;
    return finish(null);
  };
  try {
    if (lstatSync(join(fixtures, DELTA_FILE), { throwIfNoEntry: false })) return missing("E_TASKS_INVALID", "the tasks directory holds " + DELTA_FILE + ", a name the evaluator reserves for the check's copy of delta.json");
    const childEnv = (role: "setup" | "check", state: Record<string, string>) => trialEnv(role, { PATH, HOME: home, LANG: "C.UTF-8", TERM: "dumb", [FIXTURES_VAR]: sandbox.fixturesPath(fixtures), ...state }, declared, source);
    const stateVars = (path: string) => ({ GSTACK_STATE_ROOT: path + "/.gstack-home", GSTACK_HOME: path + "/.gstack-home" });
    if (task.setup !== undefined) {
      const r = sandbox.step("setup", task.setup, task.id, { work, fixtures, env: childEnv("setup", stateVars(workPath)), timeoutMs });
      logs.setup = { exitCode: r.exitCode, timedOut: r.timedOut, stderr: tail(r) };
      if (r.exitCode !== 0) return missing("E_TASKS_INVALID", "setup " + (r.timedOut ? "timed out" : "exited " + r.exitCode) + ": " + tail(r));
    }
    const stateEnv = seedStateRoot(work, workPath, spec.proactive ?? "core", spec.stateConfig, spec.stateFiles, spec.stateProjectFiles);
    snapshot(work, baseline);
    const session = sandbox.agent(task.id, { work, env: trialEnv("agent", { PATH, HOME: home, LANG: "C.UTF-8", TERM: "dumb", ...stateEnv, ...spec.agent.env }, declared, source), network: spec.network ?? null });
    let outcome: AgentOutcome;
    try {
      outcome = await spec.agent.run(session, task, timeoutMs);
    } finally {
      session.stop();
    }
    Object.assign(record, { turns: outcome.turns, termination: outcome.termination, model_output: outcome.model_output, text_output: outcome.text_output, exit_code: outcome.exit_code, signal: outcome.signal, credited_stall_ms: outcome.credited_stall_ms, session_end: outcome.session_end, opened: outcome.opened, files_read: outcome.files_read, asked: outcome.asked, usage: outcome.usage, cost_micros: outcome.cost_micros, agent_turns: outcome.agent_turns, loaded_bytes: outcome.loaded_bytes });
    if (outcome.termination.kind !== "completed") return finish(null);
    snapshot(baseline, grade);
    const delta = importDelta(baseline, work, grade, spec.entry?.paths);
    const deltaJson = JSON.stringify(delta, null, 2) + "\n";
    writeFileSync(join(spec.dir, "delta.json"), deltaJson);
    if (delta.dropped.length) record.dropped = delta.dropped.map((d) => d.path);
    if (task.check !== undefined) {
      if (lstatSync(join(fixtures, DELTA_FILE), { throwIfNoEntry: false })) return missing("E_TASKS_INVALID", "setup wrote " + DELTA_FILE + ", a name the evaluator reserves for the check's copy of delta.json");
      const mode = statSync(fixtures).mode & 0o7777;
      chmodSync(fixtures, mode | 0o700);
      try {
        writeFileSync(join(fixtures, DELTA_FILE), deltaJson, { flag: "wx" });
      } finally {
        chmodSync(fixtures, mode);
      }
      const check = (tree: string) => {
        const path = sandbox.workPath(tree, task.id);
        const r = sandbox.step("check", task.check!, task.id, { work: tree, fixtures, env: childEnv("check", { ...stateVars(path), [DELTA_VAR]: sandbox.fixturesPath(fixtures) + "/" + DELTA_FILE }), timeoutMs });
        return { log: { exitCode: r.exitCode, timedOut: r.timedOut, stderr: tail(r) }, verdict: judgeCheck(r, path) };
      };
      const placeholders = delta.dropped.map((d) => d.path).filter((p) => existsSync(join(grade, p, PLACEHOLDER)));
      let copyFailure: unknown;
      if (placeholders.length) {
        try {
          snapshot(grade, bare);
        } catch (error) {
          copyFailure = error;
        }
      }
      const first = check(grade);
      logs.check = first.log;
      if (first.verdict.kind === "error") {
        record.termination = { kind: "missing", code: "E_VERIFIER" };
        logs.missing = first.verdict.reason;
        return finish(delta);
      }
      record.check = first.verdict.kind === "pass";
      if (!record.check || !placeholders.length) return finish(delta);
      try {
        if (copyFailure !== undefined) throw copyFailure;
        for (const p of placeholders) {
          const parent = dirname(join(bare, p));
          const mode = statSync(parent).mode & 0o7777;
          chmodSync(parent, mode | 0o700);
          rmSync(join(bare, p), { recursive: true, force: true });
          chmodSync(parent, mode);
        }
      } catch (error) {
        logs.check_bare = { error: "the copy without placeholders could not be built: " + (error instanceof Error ? error.message : String(error)) };
        record.check = false;
        return finish(delta);
      }
      const second = check(bare);
      logs.check_bare = second.log;
      record.check = second.verdict.kind === "pass";
    }
    return finish(delta);
  } catch (error) {
    if (error instanceof TrialEnvError) return missing("E_TASKS_INVALID", "env: " + error.message);
    throw error;
  }
}

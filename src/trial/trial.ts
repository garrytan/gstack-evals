// One Lane A trial (plan v3.2, "Execution, isolation and secrets"): setup in its own container, the state root seeded,
// the baseline snapshot, the agent with the work dir only, the filesystem delta imported against the baseline, and the
// check run on the grade tree from a read-only copy of the tasks directory. The answer key never enters the agent's
// environment: the tasks directory, the sidecar, mutants and hidden tasks reach setup and check only. Evaluator records
// (delta.json, trial.json, the steps' logs) sit beside the work dir, never inside it.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";
import { judgeCheck } from "../skill-eval/contract/check.ts";
import type { SidecarTask } from "../skill-eval/contract/sidecar.ts";
import { FIXTURES_VAR, type ContractTask } from "../skill-eval/contract/tasks.ts";
import type { Category } from "../usersim/classifier.ts";
import type { Termination, TokenUsage, TrialRecord } from "../types.ts";
import { removeTree, type CleanupOptions } from "./cleanup.ts";
import { importDelta, snapshot, type Delta } from "./delta.ts";
import { trialEnv, TrialEnvError } from "./env.ts";
import type { AgentSession, Sandbox, StepResult } from "./sandbox.ts";
import { seedStateRoot, type Proactive } from "./state-root.ts";

/** What a host adapter (U10) or the replay driver reports for one session. */
export interface AgentOutcome {
  turns: string[];
  termination: Termination;
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
  /** How the trees are removed (src/trial/cleanup.ts): an image removes root-owned leftovers. */
  cleanup?: CleanupOptions;
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
const tail = (r: StepResult) => r.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 300);

export async function runTrial(spec: TrialSpec): Promise<TrialRun> {
  const started = Date.now();
  const { task, sandbox } = spec;
  const work = join(spec.dir, "work", task.id);
  const baseline = join(spec.dir, "baseline");
  const grade = join(spec.dir, "grade");
  const fixtures = join(spec.dir, "fixtures");
  const timeoutMs = (spec.entry?.timeout_s ?? spec.timeoutS) * 1000;
  mkdirSync(work, { recursive: true });
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
    const leftovers = spec.keep ? [] : [work, baseline, grade, fixtures].flatMap((tree) => removeTree(tree, spec.cleanup) ?? []);
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
    const childEnv = (role: "setup" | "check", state: Record<string, string>) => trialEnv(role, { PATH, HOME: home, LANG: "C.UTF-8", TERM: "dumb", [FIXTURES_VAR]: sandbox.fixturesPath(fixtures), ...state }, declared, source);
    const stateVars = (path: string) => ({ GSTACK_STATE_ROOT: path + "/.gstack-home", GSTACK_HOME: path + "/.gstack-home" });
    if (task.setup !== undefined) {
      const r = sandbox.step("setup", task.setup, task.id, { work, fixtures, env: childEnv("setup", stateVars(workPath)), timeoutMs });
      logs.setup = { exitCode: r.exitCode, timedOut: r.timedOut, stderr: tail(r) };
      if (r.exitCode !== 0) return missing("E_TASKS_INVALID", "setup " + (r.timedOut ? "timed out" : "exited " + r.exitCode) + ": " + tail(r));
    }
    const stateEnv = seedStateRoot(work, workPath, spec.proactive ?? "core");
    snapshot(work, baseline);
    const session = sandbox.agent(task.id, { work, env: trialEnv("agent", { PATH, HOME: home, LANG: "C.UTF-8", TERM: "dumb", ...stateEnv, ...spec.agent.env }, declared, source), network: spec.network ?? null });
    let outcome: AgentOutcome;
    try {
      outcome = await spec.agent.run(session, task, timeoutMs);
    } finally {
      session.stop();
    }
    Object.assign(record, { turns: outcome.turns, termination: outcome.termination, opened: outcome.opened, files_read: outcome.files_read, asked: outcome.asked, usage: outcome.usage, cost_micros: outcome.cost_micros, agent_turns: outcome.agent_turns, loaded_bytes: outcome.loaded_bytes });
    if (outcome.termination.kind !== "completed") return finish(null);
    snapshot(baseline, grade);
    const delta = importDelta(baseline, work, grade, spec.entry?.paths);
    writeFileSync(join(spec.dir, "delta.json"), JSON.stringify(delta, null, 2) + "\n");
    if (task.check !== undefined) {
      const gradePath = sandbox.workPath(grade, task.id);
      const r = sandbox.step("check", task.check, task.id, { work: grade, fixtures, env: childEnv("check", stateVars(gradePath)), timeoutMs });
      logs.check = { exitCode: r.exitCode, timedOut: r.timedOut, stderr: tail(r) };
      const verdict = judgeCheck(r, gradePath);
      if (verdict.kind === "error") {
        record.termination = { kind: "missing", code: "E_VERIFIER" };
        logs.missing = verdict.reason;
        return finish(delta);
      }
      record.check = verdict.kind === "pass";
    }
    return finish(delta);
  } catch (error) {
    if (error instanceof TrialEnvError) return missing("E_TASKS_INVALID", "env: " + error.message);
    throw error;
  }
}

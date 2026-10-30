// The keyless replay driver: a transcript of shell steps and turns, run in the agent's environment as a host session
// would run them. It makes no model call. Tests use it to drive the whole trial (oracle and broken transcripts, grader
// integrity, the tasks-directory canary), and each step's output stays on the evaluator side in the outcome.
import type { ContractTask } from "../skill-eval/contract/tasks.ts";
import type { AgentDriver, AgentOutcome } from "./trial.ts";

export interface Transcript {
  /** Shell steps, run in order in the work dir. */
  steps: string[];
  /** The user-visible assistant turns in order; the last is the final answer. */
  turns: string[];
}

export interface ReplayDriver extends AgentDriver {
  /** Each step's result from the last run, for the evaluator only. */
  outputs: { command: string; exitCode: number | null; stdout: string; stderr: string }[];
}

export const NOP: Transcript = { steps: [], turns: [] };

export function replayAgent(transcript: Transcript): ReplayDriver {
  const driver: ReplayDriver = {
    outputs: [],
    run(session, _task: ContractTask, timeoutMs): AgentOutcome {
      driver.outputs = [];
      const deadline = Date.now() + timeoutMs;
      for (const command of transcript.steps) {
        const r = session.exec(command, Math.max(1, deadline - Date.now()));
        driver.outputs.push({ command, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr });
        if (r.timedOut) return { ...base(), turns: [], termination: { kind: "timeout" } };
      }
      return { ...base(), turns: [...transcript.turns] };
    },
  };
  return driver;
}

const base = (): AgentOutcome => ({ turns: [], termination: { kind: "completed" }, opened: null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null });

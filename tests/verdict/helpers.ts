// Builders for verdict tests: check-only tasks graded from the check result, and trial records from compact strings.
import type { CalibrationResult, Termination, TrialRecord } from "../../src/types.ts";
import type { VerdictTask } from "../../src/skill-eval/verdict/grade.ts";
import type { VerdictInput } from "../../src/skill-eval/verdict/gates.ts";

export const CALIBRATED: CalibrationResult = { skill: true, none: true, shell: true, config: null, usersim: null, egress: true };

export const task = (id: string, extra: Partial<VerdictTask> = {}): VerdictTask => ({ id, safety: false, interactive: false, judge: false, must: [], must_not: [], check: true, ...extra });

export function record(model: string, arm: string, taskId: string, round: 1 | 2, trial: number, extra: Partial<TrialRecord> = {}): TrialRecord {
  return {
    model, arm, task: taskId, round, trial,
    termination: { kind: "completed" },
    turns: ["Done."], check: true, judge: null,
    opened: arm === "none" ? null : true,
    files_read: arm === "none" ? [] : ["SKILL.md"], asked: [],
    usage: null, cost_micros: null, wall_ms: null, agent_turns: null, loaded_bytes: null, metrics: {},
    ...extra,
  };
}

/** One cell per character: 1 pass, 0 fail, t timeout, x arm failure, m missing (provider failure), u upstream. */
export function cell(model: string, arm: string, taskId: string, runs: string, round: 1 | 2 = 1): TrialRecord[] {
  return [...runs].map((ch, trial) => {
    const termination: Termination | undefined =
      ch === "t" ? { kind: "timeout" } : ch === "x" ? { kind: "arm_failure", failure: "harness_crash" } : ch === "m" ? { kind: "missing", code: "E_USER_TURNS_MISSING" } : ch === "u" ? { kind: "missing", code: "UPSTREAM" } : undefined;
    return record(model, arm, taskId, round, trial, { check: ch === "1", ...(termination ? { termination } : {}) });
  });
}

/** Records for every task from per-arm strings: plan[task][arm] = "110". */
export function grid(model: string, plan: Record<string, Record<string, string>>, round: 1 | 2 = 1): TrialRecord[] {
  return Object.entries(plan).flatMap(([taskId, arms]) => Object.entries(arms).flatMap(([arm, runs]) => cell(model, arm, taskId, runs, round)));
}

export function input(tasks: VerdictTask[], records: TrialRecord[], extra: Partial<VerdictInput> = {}): VerdictInput {
  const models = extra.models ?? [...new Set(records.map((r) => r.model))];
  return {
    tasks,
    models,
    arms: extra.arms ?? [...new Set(records.map((r) => r.arm))],
    records,
    calibration: Object.fromEntries(models.map((m) => [m, CALIBRATED])),
    stops: [],
    ...extra,
  };
}

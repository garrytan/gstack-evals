// Builders for verdict tests: check-only tasks and trial records.
import type { TrialRecord } from "../../src/types.ts";
import type { VerdictTask } from "../../src/skill-eval/verdict/grade.ts";

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

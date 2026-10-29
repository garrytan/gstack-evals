// Grading one trial for the verdict engine (interface v0.5, "Tasks file" and "Interactive tasks").
//
// A completed trial passes when its task's whole predicate holds (predicate.ts, skill-diet's pattern rules): every must
// matched, no must_not matched, and the check, when the task has one, exited 0. Which text the patterns read depends on
// the session. A non-interactive task grades the final answer, as gstack's contract says. An interactive task grades
// every user-visible assistant turn, because an interactive skill such as office-hours makes its offers mid-session (the
// Captain's decision 2 on GST-109, from Quick look 3). A must holds when any graded turn matches it, and a must_not fails
// the trial when any graded turn's code blocks match it. The adapter (U10) parses the turns; this file only reads them.
//
// A judge rubric adds the blinded judge's answer: not done fails the trial and unknown makes it a missing cell, never a
// pass. Judges never override a safety task, so a safety task's grade is its predicate alone.
//
// Failed runs (the U6 brief's decision 2, from GSTA-14's finding on #8): a trial that ended in an arm failure left no
// value. On a higher-is-better metric that cannot go below 0, such as pass, it scores 0. Any other metric takes its
// preregistered failure_value. Without one the comparison is blocked, since 0 would be the best cost or latency, and on
// a metric that can go negative 0 is not the worst score.
import { predicateHolds, scoreAnswer, type AnswerScore } from "../contract/predicate.ts";
import { isInteractive, type Contract } from "../contract/sidecar.ts";
import type { TrialRecord } from "../../types.ts";

export interface VerdictTask {
  id: string;
  safety: boolean;
  /** Declared interactive in the sidecar (user or interactive: true). Such a task grades every user-visible turn. */
  interactive: boolean;
  /** The sidecar gives the task a judge rubric. */
  judge: boolean;
  must: string[];
  must_not: string[];
  /** The task has a check. */
  check: boolean;
}

export function verdictTasks(contract: Contract): VerdictTask[] {
  const ext = contract.ext?.sidecar?.tasks ?? {};
  return contract.tasks.tasks.map((t) => ({
    id: t.id,
    safety: t.safety === true,
    interactive: isInteractive(ext[t.id]),
    judge: ext[t.id]?.judge !== undefined,
    must: t.must ?? [],
    must_not: t.must_not ?? [],
    check: t.check !== undefined,
  }));
}

export type GradeScope = "final" | "turns";

export const gradeScope = (task: Pick<VerdictTask, "interactive">): GradeScope => (task.interactive ? "turns" : "final");

/** The task's patterns scored over the graded text: the final answer alone, or every turn. */
export function scoreTurns(task: Pick<VerdictTask, "must" | "must_not">, turns: readonly string[], scope: GradeScope): AnswerScore {
  const graded = scope === "turns" ? turns : turns.slice(-1);
  const scores = (graded.length ? graded : [""]).map((turn) => scoreAnswer(task, turn));
  const any = (key: "must" | "must_not") => scores[0]![key].map((r, i) => ({ pattern: r.pattern, hit: scores.some((s) => s[key][i]!.hit) }));
  return { must: any("must"), must_not: any("must_not") };
}

/** unjudged: a judge task whose judge answered unknown or did not run, a missing cell the judge rule counts. */
export type Outcome = "pass" | "fail" | "timeout" | "missing" | "unjudged" | "excluded";

export interface TrialGrade {
  outcome: Outcome;
  /** The patterns and the check disagreed: a grader dispute for the adjudication record. */
  dispute: boolean;
}

export function gradeTrial(task: VerdictTask, record: TrialRecord): TrialGrade {
  const kind = record.termination.kind;
  if (kind === "arm_failure") return { outcome: "fail", dispute: false };
  if (kind === "timeout") return { outcome: "timeout", dispute: false };
  if (kind === "infra") return { outcome: "excluded", dispute: false };
  if (kind !== "completed" || (task.check && record.check === null)) return { outcome: "missing", dispute: false };
  const score = scoreTurns(task, record.turns, gradeScope(task));
  const dispute = task.check && task.must.length + task.must_not.length > 0 && predicateHolds(score, null) !== record.check;
  if (task.judge && !task.safety && record.judge !== "done") return { outcome: record.judge === "not_done" ? "fail" : "unjudged", dispute };
  return { outcome: predicateHolds(score, task.check ? record.check : null) ? "pass" : "fail", dispute };
}

export interface MetricSpec {
  name: string;
  direction: "higher" | "lower";
  /** The lowest value the metric can take; null when it has no lower bound. */
  min: number | null;
  /** The preregistered score of a failed run that left no value. */
  failure_value?: number;
}

/** Pass rate: a failed run scores 0. */
export const PASS_METRIC: MetricSpec = { name: "pass", direction: "higher", min: 0 };

/** The score of a failed run that left no value, or null when the metric needs a failure_value it does not have. */
export function failedRunScore(metric: MetricSpec): number | null {
  if (metric.failure_value !== undefined) return metric.failure_value;
  return metric.direction === "higher" && metric.min !== null && metric.min >= 0 ? 0 : null;
}

/** A trial's value on a preregistered metric: a number, "missing" (the cell is short), or "blocked" (the comparison cannot score this failure). */
export function metricValue(record: TrialRecord, metric: MetricSpec): number | "missing" | "blocked" {
  const value = record.metrics[metric.name];
  const kind = record.termination.kind;
  if (typeof value === "number" && Number.isFinite(value) && (kind === "completed" || kind === "arm_failure")) return value;
  if (kind !== "arm_failure") return "missing";
  return failedRunScore(metric) ?? "blocked";
}

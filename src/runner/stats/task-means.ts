// gstack-evals (U2), plan v3.2 fix 2: paired comparisons on per-task means, item = cluster = task.
//
// A comparison averages each arm's valid trials within a task and pairs the two arms by task. The arms may run
// different numbers of trials (5 cheap-rung trials against 3 Opus trials), every task weighs the same, and the
// bootstrap, sign-flip test and non-inferiority p-value in paired.ts then run over tasks with one pair per cluster.
// Trial-level pairing, which matches trial i of one arm with trial i of the other, still needs equal trials, and only
// pairTrials checks that.
//
// A task with too few valid trials in an arm is a missing cell. Instead of refusing mismatched ids, pairTaskMeans
// applies the preregistered missing-cell rule: drop the task and list it, or refuse the comparison.
import { PairingError, pairObservations, type Observation, type PairedItem, type Pairing } from './paired.ts';

export interface TrialValue {
  task: string;
  /** The trial's index within its arm; unique per task. */
  trial: number;
  /** 1 pass, 0 fail, or a metric value. null when the trial has no outcome to count, such as a provider failure. */
  value: number | null;
}

export interface MissingCellRule {
  /** Fewest valid trials a task needs in each arm. Fewer makes it a missing cell. */
  min_trials: number;
  /** drop_task leaves the task out of the comparison and lists it in dropped; refuse blocks the comparison. */
  on_missing: 'drop_task' | 'refuse';
  /** With drop_task, block the comparison when more than this share of the tasks drop. Omitted: no limit. */
  max_dropped_share?: number;
}

export interface TaskPairing {
  /** One pair per task, in task order: id and cluster are the task; a and b are each arm's mean over valid trials. */
  pairs: PairedItem[];
  dropped: Array<{ task: string; reason: string }>;
  /** Valid trials per task in each arm, dropped tasks included. */
  valid: { a: Record<string, number>; b: Record<string, number> };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function missingCellRuleProblems(rule: MissingCellRule): string[] {
  const problems: string[] = [];
  if (!rule || typeof rule !== 'object') return ['missing-cell rule must be an object'];
  if (!Number.isSafeInteger(rule.min_trials) || rule.min_trials < 1) problems.push('missing-cell rule: min_trials must be an integer >= 1');
  if (rule.on_missing !== 'drop_task' && rule.on_missing !== 'refuse') problems.push('missing-cell rule: on_missing must be drop_task or refuse');
  if (rule.max_dropped_share !== undefined && !(finite(rule.max_dropped_share) && rule.max_dropped_share >= 0 && rule.max_dropped_share <= 1)) {
    problems.push('missing-cell rule: max_dropped_share must be a number from 0 to 1');
  }
  return problems;
}

function byTask(side: 'A' | 'B', rows: readonly TrialValue[], problems: string[]): Map<string, { trials: Set<number>; sum: number; valid: number }> {
  const map = new Map<string, { trials: Set<number>; sum: number; valid: number }>();
  for (const row of rows) {
    if (typeof row.task !== 'string' || !row.task) { problems.push(`${side}: trial without a task id`); continue; }
    if (!Number.isSafeInteger(row.trial)) { problems.push(`${side}: ${row.task} has a trial index that is not an integer`); continue; }
    if (row.value !== null && !finite(row.value)) { problems.push(`${side}: ${row.task} trial ${row.trial} has a value that is neither finite nor null`); continue; }
    const t = map.get(row.task) ?? { trials: new Set<number>(), sum: 0, valid: 0 };
    if (t.trials.has(row.trial)) problems.push(`${side}: duplicate trial ${row.trial} for ${row.task}`);
    t.trials.add(row.trial);
    if (row.value !== null) { t.sum += row.value; t.valid += 1; }
    map.set(row.task, t);
  }
  return map;
}

/**
 * Pair two arms by task on their per-task means. tasks is the preregistered task list; without it the tasks are the
 * union of both arms'. A row for a task outside the list, a duplicate trial or a bad value blocks the comparison.
 */
export function pairTaskMeans(a: readonly TrialValue[], b: readonly TrialValue[], rule: MissingCellRule, tasks?: readonly string[]): TaskPairing {
  const problems = missingCellRuleProblems(rule);
  const left = byTask('A', a, problems), right = byTask('B', b, problems);
  const list = tasks ? [...tasks] : [...new Set([...left.keys(), ...right.keys()])];
  if (tasks && new Set(tasks).size !== tasks.length) problems.push('the task list repeats a task');
  if (tasks) {
    const known = new Set(tasks);
    for (const [side, map] of [['A', left], ['B', right]] as const) {
      for (const task of map.keys()) if (!known.has(task)) problems.push(`${side}: ${task} is not in the task list`);
    }
  }
  list.sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
  const pairs: PairedItem[] = [];
  const dropped: TaskPairing['dropped'] = [];
  const valid: TaskPairing['valid'] = { a: {}, b: {} };
  for (const task of list) {
    const x = left.get(task), y = right.get(task);
    const va = x?.valid ?? 0, vb = y?.valid ?? 0;
    valid.a[task] = va;
    valid.b[task] = vb;
    if (va >= rule.min_trials && vb >= rule.min_trials) {
      pairs.push({ id: task, cluster: task, a: x!.sum / va, b: y!.sum / vb });
      continue;
    }
    const short = [va < rule.min_trials ? `A ${va}` : '', vb < rule.min_trials ? `B ${vb}` : ''].filter(Boolean).join(', ');
    const reason = `valid trials: ${short}, below the preregistered minimum of ${rule.min_trials}`;
    if (rule.on_missing === 'refuse') problems.push(`missing cell for ${task}: ${reason}`);
    else dropped.push({ task, reason });
  }
  if (rule.max_dropped_share !== undefined && list.length && dropped.length / list.length > rule.max_dropped_share) {
    problems.push(`${dropped.length} of ${list.length} tasks dropped, above the preregistered share of ${rule.max_dropped_share}`);
  }
  if (!problems.length && !pairs.length) problems.push('no task has enough valid trials in both arms');
  if (problems.length) throw new PairingError(problems);
  return { pairs, dropped, valid };
}

/**
 * Pair trial i of one arm with trial i of the other, clustered by task. Every task needs the same trial indices in
 * both arms, and a trial valid on one side only blocks the comparison, as in pairObservations.
 */
export function pairTrials(a: readonly TrialValue[], b: readonly TrialValue[]): Pairing {
  const problems: string[] = [];
  const left = byTask('A', a, problems), right = byTask('B', b, problems);
  const indices = (t: { trials: Set<number> } | undefined) => [...(t?.trials ?? [])].sort((p, q) => p - q).join(',');
  for (const task of new Set([...left.keys(), ...right.keys()])) {
    const x = left.get(task), y = right.get(task);
    if (indices(x) !== indices(y)) {
      problems.push(`trials differ for ${task}: A has ${x?.trials.size ?? 0}, B has ${y?.trials.size ?? 0}; trial-level pairing needs the same trials in both arms, so compare per-task means`);
    }
  }
  if (problems.length) throw new PairingError(problems);
  const observations = (rows: readonly TrialValue[]): Observation[] => rows.map((r) => ({
    id: `${r.task}#${r.trial}`, cluster: r.task, value: r.value, eligible: r.value !== null, ...(r.value === null ? { reason: 'no outcome' } : {}),
  }));
  return pairObservations(observations(a), observations(b));
}

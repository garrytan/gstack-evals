// gstack-evals (U2): how many tasks a paired, task-clustered test needs, and the parity sizing tables of plan v3.2
// (decision 9 and "Statistics, power and the main loop") and Amendment A2 (the release split).
//
// n = ((z_{1-alpha} + z_{power}) x SD / effect)^2 for a one-sided test, where SD is the per-task SD of the paired
// difference of task means and effect is the distance the test must clear. For parity, effect is the 10-point margin
// minus an assumed true difference of 3 points, so 0.07. Three cheap models use alpha / 3, Holm's first step and so its
// worst case. requiredTasks rounds up, since a design needs whole tasks and rounding down loses power. The plan's
// printed tables round to the nearest task instead; tests/stats/sizing.test.ts shows where that differs by one.
import { normalQuantile } from './paired.ts';

/** One-sided alpha per test, after any split, and the power wanted. */
export interface PowerDesign {
  alpha: number;
  power: number;
}

/** The 10-point parity margin minus an assumed true difference of 3 points (plan v3.2, d6 at gate_rev 2). */
export const PARITY_EFFECT = 0.07;

function zSum(design: PowerDesign): number {
  if (!(design.alpha > 0 && design.alpha < 0.5)) throw new Error('alpha must be in (0, 0.5)');
  if (!(design.power >= 0.5 && design.power < 1)) throw new Error('power must be in [0.5, 1)');
  return normalQuantile(1 - design.alpha) + normalQuantile(design.power);
}

const positive = (name: string, x: number) => {
  if (!(Number.isFinite(x) && x > 0)) throw new Error(`${name} must be a positive number`);
};

/** Tasks needed before rounding. */
export function exactTasks(sd: number, effect: number, design: PowerDesign): number {
  positive('sd', sd);
  positive('effect', effect);
  return (zSum(design) * sd / effect) ** 2;
}

/** Whole tasks needed: exactTasks rounded up. */
export function requiredTasks(sd: number, effect: number, design: PowerDesign): number {
  return Math.ceil(exactTasks(sd, effect, design) - 1e-9);
}

/** The largest per-task SD that this many tasks cover at the design. */
export function coveredSd(tasks: number, effect: number, design: PowerDesign): number {
  positive('tasks', tasks);
  positive('effect', effect);
  return effect * Math.sqrt(tasks) / zSum(design);
}

/** The smallest distance this many tasks detect at the design: a minimum detectable difference, in the SD's units. */
export function minimumDetectable(tasks: number, sd: number, design: PowerDesign): number {
  positive('tasks', tasks);
  positive('sd', sd);
  return zSum(design) * sd / Math.sqrt(tasks);
}

/**
 * Per-task SD of the paired difference of task means: the between-task variance plus each arm's binomial variance of
 * its trial mean, rate (1 - rate) / trials. Variances add, so the plan's "spread plus p(1-p)/5 + q(1-q)/3" is
 * sqrt(between_sd^2 + p(1-p)/5 + q(1-q)/3).
 */
export function taskDiffSd(betweenSd: number, arms: ReadonlyArray<{ rate: number; trials: number }>): number {
  if (!(Number.isFinite(betweenSd) && betweenSd >= 0)) throw new Error('between_sd must be a number >= 0');
  let variance = betweenSd ** 2;
  for (const { rate, trials } of arms) {
    if (!(rate >= 0 && rate <= 1)) throw new Error('rate must be in [0, 1]');
    if (!Number.isSafeInteger(trials) || trials < 1) throw new Error('trials must be an integer >= 1');
    variance += rate * (1 - rate) / trials;
  }
  return Math.sqrt(variance);
}

/** Decision 9's three designs. models is how many cheap models share the parity alpha under Holm. */
export const DECISION_9_DESIGNS = [
  { id: 'three-models', label: 'Three cheap models, Holm, 90% power: the current design', models: 3, power: 0.9 },
  { id: 'one-primary', label: 'One preregistered primary cheap model, 90% power', models: 1, power: 0.9 },
  { id: 'one-primary-80', label: 'One primary cheap model, 80% power', models: 1, power: 0.8 },
] as const;

/** Amendment A2's ways for parity to share the sealed set's alpha across releases. */
export const RELEASE_OPTIONS = [
  { id: 'v3.2', label: 'v3.2 as written (parity takes the whole alpha at one release)', parity_alpha: 0.05, note: '' },
  { id: 'A', label: 'A. Parity gets a bigger preregistered share (0.03 to parity)', parity_alpha: 0.03, note: '' },
  { id: 'B', label: 'B. Parity runs on its own sealed tranche, used once at the full 0.05', parity_alpha: 0.05, note: 'for the tranche, plus the tasks the other releases use' },
  { id: 'C', label: 'C. Mint more: four frozen releases at 0.0125 each', parity_alpha: 0.0125, note: '' },
  { id: 'C-steer', label: 'C, if each release steers the next candidate (0.05/15 per node)', parity_alpha: 0.05 / 15, note: '' },
] as const;

export type Decision9Design = (typeof DECISION_9_DESIGNS)[number];
export type ReleaseOption = (typeof RELEASE_OPTIONS)[number];

export function parityDesign(design: Decision9Design, parityAlpha = 0.05): PowerDesign {
  return { alpha: parityAlpha / design.models, power: design.power };
}

const pad = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;

/** Plan v3.2's decision 9 table: build-fix tasks needed per design and SD, and the SD a ceiling of tasks covers. */
export function decision9Table(sds: readonly number[] = [0.2, 0.3, 0.33, 0.38, 0.42], ceiling = 213): string {
  return [
    pad(['Design', ...sds.map((sd) => `SD ${sd}`), `SD that ${ceiling} tasks cover`]),
    pad(['---', ...sds.map(() => '---'), '---']),
    ...DECISION_9_DESIGNS.map((d) => pad([d.label, ...sds.map((sd) => requiredTasks(sd, PARITY_EFFECT, parityDesign(d))), coveredSd(ceiling, PARITY_EFFECT, parityDesign(d)).toFixed(2)])),
  ].join('\n');
}

/** Amendment A2's release-split table: tasks needed per option and design at each SD. */
export function releaseSplitTable(sds: readonly number[] = [0.3, 0.38]): string {
  const sdLabel = sds.join(' / ');
  return [
    pad(['Option', ...DECISION_9_DESIGNS.map((d) => `${d.label}: SD ${sdLabel}`)]),
    pad(['---', ...DECISION_9_DESIGNS.map(() => '---')]),
    ...RELEASE_OPTIONS.map((o) => pad([o.label, ...DECISION_9_DESIGNS.map((d) => sds.map((sd) => requiredTasks(sd, PARITY_EFFECT, parityDesign(d, o.parity_alpha))).join(' / ') + (o.note ? ` ${o.note}` : ''))])),
  ].join('\n');
}

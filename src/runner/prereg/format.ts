// gstack-evals (U2): the preregistration format, prereg.json, and the checks it must pass before a paid run.
//
// It covers every section the first quick-look preregistrations wrote in prose (question, arms and their pins,
// models and trials, tasks with digests, metrics, analysis, money and the stop rule, known limits, deviations) and
// adds the fields a runner needs to read rather than a person: the bootstrap seed and resamples, the pairing, the
// missing-cell rule, each comparison's gate, Holm families, power checks and the OpenRouter peg. Rules that need a
// person's judgment stay as text. Model policy (no Sonnet, newest generations) is the policy file's job in
// preflight, not this check's. admissionProblems adds GSTA-8's rule: a program-funded run needs a line item that
// requires admission.
import { readFileSync } from 'node:fs';
import { missingCellRuleProblems, type MissingCellRule } from '../stats/task-means.ts';
import { requiredTasks } from '../stats/sizing.ts';
import type { ArmKind } from '../../types.ts';

export type Gate = 'exact' | 'noninferiority' | 'superiority' | 'exploratory';
export type Direction = 'higher' | 'lower';

export interface PreregArm {
  name: string;
  kind: ArmKind;
  description: string;
  /** What pins the arm, label to value: a gstack sha, a tarball or image digest, a generator hash and seed. */
  pins: Record<string, string>;
}

export interface PreregModel {
  id: string;
  /** How calls reach the model, such as "anthropic" or "openrouter, provider deepseek, no fallbacks". */
  route: string;
  weights: 'open' | 'closed';
  role: 'agent' | 'judge' | 'simulator';
  effort?: string;
  session_cap_usd?: number;
  max_tokens?: number;
}

/** One model and arm on one task set, at a preregistered number of trials per task. */
export interface PreregCell {
  id: string;
  model: string;
  arm: string;
  tasks: string;
  trials: number;
  note?: string;
}

export interface PreregTaskSet {
  id: string;
  /** Where the tasks come from: a repo at a sha, a registry and version. */
  source: string;
  count: number;
  /** sha256 of the set as preregistered. */
  digest: string;
  /** Sealed sets list counts and digests only, never ids. */
  sealed: boolean;
  ids?: string[];
  /** What happens to a task that cannot run: reserves, replacement order, drops. */
  replacement?: string;
}

export interface PreregMetric {
  id: string;
  definition: string;
  direction?: Direction;
  /** The score of a system failure that left no value (gates.ts failure_value). A lower-is-better metric that a gate decides on needs one, since 0 would be its best score. */
  failure_value?: number;
}

export interface PreregComparison {
  id: string;
  /** Cell ids. Differences are b minus a. */
  a: string;
  b: string;
  metric: string;
  gate: Gate;
  direction?: Direction;
  /** Non-inferiority margin in metric units (gates.ts calls it tolerance). */
  margin?: number;
  /** Superiority: the point estimate a claimed improvement must reach, in metric units, beside a one-sided sign-flip p at or below alpha (plan v3.2). */
  min_effect?: number;
  /** The exact gate's assertion, in words. */
  assertion?: string;
  /** A parity claim: C with gstack against F without it, under CREW's parity rule. */
  parity?: boolean;
}

/** n = ((z_alpha + z_power) x sd / effect)^2 must not exceed the compared task set's count. */
export interface PowerCheck {
  comparison: string;
  sd: number;
  sd_source: string;
  /** The distance the test must clear. For parity, the margin minus the assumed true difference. */
  effect: number;
  /** One-sided, after any Holm split. */
  alpha: number;
  power: number;
}

export interface PreregAnalysis {
  pairing: 'task_mean' | 'trial';
  /** Family-wise, one-sided. */
  alpha: number;
  interval: { method: 'task_clustered_bootstrap'; level: number; resamples: number; seed: number };
  missing_cells: MissingCellRule;
  comparisons: PreregComparison[];
  holm?: Array<{ id: string; comparisons: string[] }>;
  /** Minimum effect of interest, in metric units. */
  mei?: number;
  /** How a reference cell counts as at ceiling, and what then happens to the claims that use it. */
  ceiling_rule?: string;
  /** Other preregistered rules in words: informative tasks, verdict order, reruns, flags. */
  rules?: string[];
}

export interface PreregMoney {
  /** 0 means no paid calls. */
  cap_usd: number;
  /** program: the gstack-evals program's caps, so the line item must require admission. caller: a caller's own ledger. */
  funding?: 'program' | 'caller';
  line_item?: string;
  ledger?: string;
  approval?: { words: string; by: string; source: string };
  /** How each call or session is reserved before it is sent. */
  reservation?: string;
  stop_rule?: string;
  /** Stage order, so a cap stop leaves complete stages. */
  order?: string[];
}

/** The OpenRouter programming ranking read at preregistration (CREW peg rule). */
export interface OpenRouterPeg {
  as_of: string | null;
  sha256: string | null;
  source: string;
  /** Required when as_of or sha256 is null: why the Data API was not read. */
  note?: string;
}

export interface Preregistration {
  schema_version: 1;
  id: string;
  title: string;
  author: string;
  /** The author's model, provider/model. */
  model: string;
  captain?: string;
  date: string;
  claim: 'exploratory' | 'confirmatory';
  question: string;
  links?: string[];
  arms: PreregArm[];
  models: PreregModel[];
  cells: PreregCell[];
  tasks: PreregTaskSet[];
  metrics: { primary: PreregMetric[]; secondary?: PreregMetric[] };
  analysis: PreregAnalysis;
  power?: PowerCheck[];
  money: PreregMoney;
  peg?: OpenRouterPeg;
  limits: string[];
  /** Where this run departs from the plan or the interface. */
  deviations?: string[];
  /** Changes from earlier versions of this preregistration, all before any spend. */
  changes?: string[];
}

const ARM_KINDS: ArmKind[] = ['bare', 'placebo', 'stack', 'overlay', 'loadout'];
const TOP = ['schema_version', 'id', 'title', 'author', 'model', 'captain', 'date', 'claim', 'question', 'links', 'arms', 'models', 'cells', 'tasks', 'metrics', 'analysis', 'power', 'money', 'peg', 'limits', 'deviations', 'changes'];
const PLACEHOLDER = /__[A-Z0-9_]+__|\b(?:TBD|TODO|FIXME)\b/;
const SHA256 = /^[0-9a-f]{64}$/;

const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const list = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

function placeholders(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') { if (PLACEHOLDER.test(value)) out.push(`${path} has an unfilled placeholder: ${value.match(PLACEHOLDER)![0]}`); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => placeholders(v, `${path}[${i}]`, out)); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) placeholders(v, path ? `${path}.${k}` : k, out);
}

function unique<T extends { id?: string; name?: string }>(items: T[], label: string, key: 'id' | 'name', problems: string[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = item?.[key];
    if (!text(k)) { problems.push(`${label} without a ${key}`); continue; }
    if (map.has(k)) problems.push(`${label} ${k} is listed twice`);
    map.set(k, item);
  }
  return map;
}

/** Every problem that stops this preregistration from being run; an empty list means it may be committed and attested. */
export function preregistrationProblems(value: unknown): string[] {
  const p = value as Preregistration;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['a preregistration must be a JSON object'];
  const problems: string[] = [];
  for (const key of Object.keys(p)) if (!TOP.includes(key)) problems.push(`unknown field ${key}`);
  if (p.schema_version !== 1) problems.push('schema_version must be 1');
  if (!text(p.id) || !/^[a-z0-9][a-z0-9.-]*$/.test(p.id)) problems.push('id must be lowercase letters, digits, dots and hyphens');
  for (const key of ['title', 'author', 'question'] as const) if (!text(p[key])) problems.push(`${key} required`);
  if (!text(p.model) || !p.model.includes('/')) problems.push("model must be the author's model as provider/model");
  if (!text(p.date) || !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date))) problems.push('date must be YYYY-MM-DD');
  if (p.claim !== 'exploratory' && p.claim !== 'confirmatory') problems.push('claim must be exploratory or confirmatory');
  if (!Array.isArray(p.limits) || !p.limits.every(text)) problems.push('limits must be a list of sentences (it may be empty)');

  const arms = unique(list<PreregArm>(p.arms), 'arm', 'name', problems);
  if (!arms.size) problems.push('arms must list at least one arm');
  for (const [name, arm] of arms) {
    if (!ARM_KINDS.includes(arm.kind)) problems.push(`arm ${name}: kind must be one of ${ARM_KINDS.join(', ')}`);
    if (!text(arm.description)) problems.push(`arm ${name}: description required`);
    const pins = arm.pins && typeof arm.pins === 'object' ? Object.entries(arm.pins) : [];
    if (arm.kind !== 'bare' && !pins.length) problems.push(`arm ${name}: pins required (a sha or digest that fixes what the arm installs)`);
    for (const [label, pin] of pins) if (!text(pin)) problems.push(`arm ${name}: pin ${label} is empty`);
  }

  const models = unique(list<PreregModel>(p.models), 'model', 'id', problems);
  for (const [id, m] of models) {
    if (!text(m.route)) problems.push(`model ${id}: route required`);
    if (m.weights !== 'open' && m.weights !== 'closed') problems.push(`model ${id}: weights must be open or closed`);
    if (!['agent', 'judge', 'simulator'].includes(m.role)) problems.push(`model ${id}: role must be agent, judge or simulator`);
    if (m.session_cap_usd !== undefined && !(finite(m.session_cap_usd) && m.session_cap_usd > 0)) problems.push(`model ${id}: session_cap_usd must be a positive number`);
  }

  const taskSets = unique(list<PreregTaskSet>(p.tasks), 'task set', 'id', problems);
  if (!taskSets.size) problems.push('tasks must list at least one task set');
  for (const [id, t] of taskSets) {
    if (!text(t.source)) problems.push(`task set ${id}: source required`);
    if (!Number.isSafeInteger(t.count) || t.count < 1) problems.push(`task set ${id}: count must be an integer >= 1`);
    if (!text(t.digest) || !SHA256.test(t.digest)) problems.push(`task set ${id}: digest must be a full sha256 in lowercase hex`);
    if (typeof t.sealed !== 'boolean') problems.push(`task set ${id}: sealed must be true or false`);
    if (t.sealed && t.ids !== undefined) problems.push(`task set ${id}: a sealed set lists counts and digests only, never task ids`);
    if (t.ids !== undefined && (!Array.isArray(t.ids) || !t.ids.every(text) || new Set(t.ids).size !== t.ids.length || t.ids.length !== t.count)) problems.push(`task set ${id}: ids must be ${t.count} distinct task ids`);
  }

  const cells = unique(list<PreregCell>(p.cells), 'cell', 'id', problems);
  if (!cells.size) problems.push('cells must list at least one model, arm and task set');
  const seen = new Set<string>();
  for (const [id, c] of cells) {
    if (!models.has(c.model)) problems.push(`cell ${id}: model ${c.model} is not listed`);
    else if (models.get(c.model)!.role !== 'agent') problems.push(`cell ${id}: model ${c.model} is not an agent model`);
    if (!arms.has(c.arm)) problems.push(`cell ${id}: arm ${c.arm} is not listed`);
    if (!taskSets.has(c.tasks)) problems.push(`cell ${id}: task set ${c.tasks} is not listed`);
    if (!Number.isSafeInteger(c.trials) || c.trials < 1) problems.push(`cell ${id}: trials must be an integer >= 1`);
    const key = `${c.model} ${c.arm} ${c.tasks}`;
    if (seen.has(key)) problems.push(`cell ${id} repeats model, arm and task set ${key}`);
    seen.add(key);
  }

  const metrics = new Map<string, PreregMetric>();
  if (!list(p.metrics?.primary).length) problems.push('metrics.primary must name at least one metric');
  for (const m of [...list<PreregMetric>(p.metrics?.primary), ...list<PreregMetric>(p.metrics?.secondary)]) {
    if (!text(m?.id) || !text(m.definition)) { problems.push('every metric needs an id and a definition'); continue; }
    if (metrics.has(m.id)) problems.push(`metric ${m.id} is listed twice`);
    if (m.failure_value !== undefined && !finite(m.failure_value)) problems.push(`metric ${m.id}: failure_value must be a finite number`);
    metrics.set(m.id, m);
  }

  const a = p.analysis;
  if (!a || typeof a !== 'object') problems.push('analysis required');
  else {
    if (a.pairing !== 'task_mean' && a.pairing !== 'trial') problems.push('analysis.pairing must be task_mean or trial');
    if (!(finite(a.alpha) && a.alpha > 0 && a.alpha < 0.5)) problems.push('analysis.alpha must be in (0, 0.5)');
    const iv = a.interval;
    if (iv?.method !== 'task_clustered_bootstrap') problems.push('analysis.interval.method must be task_clustered_bootstrap');
    if (!(finite(iv?.level) && iv.level >= 0.8 && iv.level < 1)) problems.push('analysis.interval.level must be in [0.8, 1)');
    if (!Number.isSafeInteger(iv?.resamples) || iv.resamples < 1000) problems.push('analysis.interval.resamples must be an integer >= 1000');
    if (!Number.isSafeInteger(iv?.seed)) problems.push('analysis.interval.seed must be an integer');
    for (const m of missingCellRuleProblems(a.missing_cells)) problems.push(`analysis.${m.replace('missing-cell rule', 'missing_cells')}`);
  }

  const comparisons = unique(list<PreregComparison>(a?.comparisons), 'comparison', 'id', problems);
  const holmOf = new Map<string, number>();
  for (const family of list<{ id: string; comparisons: string[] }>(a?.holm)) {
    for (const id of list<string>(family?.comparisons)) {
      const c = comparisons.get(id);
      if (!c) problems.push(`Holm family ${family.id}: comparison ${id} is not listed`);
      else if (c.gate !== 'noninferiority' && c.gate !== 'superiority') problems.push(`Holm family ${family.id}: ${id} is not a noninferiority or superiority comparison`);
      if (holmOf.has(id)) problems.push(`comparison ${id} is in two Holm families`);
      holmOf.set(id, list(family.comparisons).length);
    }
  }
  const power = new Map<string, PowerCheck>();
  for (const c of list<PowerCheck>(p.power)) {
    if (!comparisons.has(c?.comparison)) problems.push(`power check for ${c?.comparison}: no such comparison`);
    if (power.has(c?.comparison)) problems.push(`power check for ${c?.comparison} is listed twice`);
    power.set(c?.comparison, c);
  }
  const decided = [...comparisons.values()].filter((c) => c.gate === 'noninferiority' || c.gate === 'superiority');

  for (const [id, c] of comparisons) {
    const ca = cells.get(c.a), cb = cells.get(c.b);
    if (!ca || !cb) { problems.push(`comparison ${id}: a and b must be listed cells`); continue; }
    if (c.a === c.b) problems.push(`comparison ${id}: a and b are the same cell`);
    if (ca.tasks !== cb.tasks) problems.push(`comparison ${id}: cells ${c.a} and ${c.b} run different task sets, so they cannot pair by task`);
    if (a?.pairing === 'trial' && ca.trials !== cb.trials) problems.push(`comparison ${id}: trial-level pairing needs equal trials (${ca.trials} and ${cb.trials}); use task_mean pairing`);
    const minTrials = a?.missing_cells?.min_trials;
    if (a?.pairing === 'task_mean' && Number.isSafeInteger(minTrials) && minTrials > Math.min(ca.trials, cb.trials)) problems.push(`comparison ${id}: missing_cells.min_trials ${minTrials} is above the trials scheduled (${ca.trials} and ${cb.trials}), so every task would count as missing`);
    if (!metrics.has(c.metric)) problems.push(`comparison ${id}: metric ${c.metric} is not listed`);
    if (!['exact', 'noninferiority', 'superiority', 'exploratory'].includes(c.gate)) { problems.push(`comparison ${id}: gate must be exact, noninferiority, superiority or exploratory`); continue; }
    if (c.gate === 'exact' && !text(c.assertion)) problems.push(`comparison ${id}: an exact gate needs its assertion`);
    const decides = c.gate === 'noninferiority' || c.gate === 'superiority';
    if (decides && c.direction !== 'higher' && c.direction !== 'lower') problems.push(`comparison ${id}: direction must be higher or lower`);
    if (decides && c.direction === 'lower' && metrics.has(c.metric) && metrics.get(c.metric)!.failure_value === undefined) problems.push(`comparison ${id}: metric ${c.metric} improves downward, so it needs failure_value, the score of a system failure that left no value`);
    if (c.gate === 'noninferiority' && !(finite(c.margin) && c.margin > 0)) problems.push(`comparison ${id}: a noninferiority gate needs a margin > 0`);
    if (c.gate === 'superiority' && !(finite(c.min_effect) && c.min_effect >= 0)) problems.push(`comparison ${id}: a superiority gate needs min_effect >= 0`);
    if (c.parity) {
      if (c.gate !== 'noninferiority') problems.push(`comparison ${id}: a parity claim needs a noninferiority gate`);
      if (!text(a?.ceiling_rule)) problems.push(`comparison ${id}: a parity claim needs analysis.ceiling_rule, so the frontier reference is shown off ceiling`);
    }
    if (decides && p.claim === 'exploratory') problems.push(`comparison ${id}: an exploratory preregistration decides nothing; make the gate exploratory or the claim confirmatory`);
    if (!decides || p.claim !== 'confirmatory') continue;
    if (decided.length > 1 && !holmOf.has(id)) problems.push(`comparison ${id} is one of ${decided.length} confirmatory gates but in no Holm family; list it in one (a family of one states an unsplit alpha)`);
    const check = power.get(id);
    if (!check) { problems.push(`comparison ${id}: a confirmatory gate needs a power check`); continue; }
    if (!(finite(check.sd) && check.sd > 0) || !text(check.sd_source)) problems.push(`power check for ${id}: sd must be positive and sd_source must say where it came from`);
    if (!(finite(check.effect) && check.effect > 0) || (c.gate === 'noninferiority' && check.effect > c.margin!)) problems.push(`power check for ${id}: effect must be positive and, for noninferiority, at most the margin`);
    if (!(finite(check.alpha) && check.alpha > 0 && check.alpha < 0.5) || !(finite(check.power) && check.power >= 0.5 && check.power < 1)) { problems.push(`power check for ${id}: alpha must be in (0, 0.5) and power in [0.5, 1)`); continue; }
    const split = holmOf.get(id) ?? 1;
    if (finite(a?.alpha) && check.alpha > a.alpha / split + 1e-12) problems.push(`power check for ${id}: alpha ${check.alpha} is above the family's ${a.alpha} split ${split} ways by Holm`);
    const count = taskSets.get(ca.tasks)?.count;
    if (!finite(check.sd) || !(check.sd > 0) || !(check.effect > 0) || !count) continue;
    const needed = requiredTasks(check.sd, check.effect, { alpha: check.alpha, power: check.power });
    if (needed > count) problems.push(`comparison ${id} is underpowered: ${needed} tasks needed at SD ${check.sd}, ${count} preregistered; preregister it as exploratory${c.parity ? ', or parity as not attempted' : ''}`);
  }
  if (p.claim === 'confirmatory' && !decided.length) {
    problems.push('a confirmatory preregistration needs at least one noninferiority or superiority comparison');
  }

  const money = p.money;
  if (!money || typeof money !== 'object' || !(finite(money.cap_usd) && money.cap_usd >= 0)) problems.push('money.cap_usd must be a number >= 0');
  else if (money.cap_usd > 0) {
    if (money.funding !== 'program' && money.funding !== 'caller') problems.push('money.funding must be program or caller for a paid run');
    for (const key of ['line_item', 'ledger', 'reservation', 'stop_rule'] as const) if (!text(money[key])) problems.push(`money.${key} required for a paid run`);
    if (!text(money.approval?.words) || !text(money.approval?.by) || !text(money.approval?.source)) problems.push("money.approval needs the owner's words, who said them and where");
  }

  const open = [...models.values()].filter((m) => m.weights === 'open' && m.role === 'agent');
  if (open.length && !p.peg) problems.push(`peg required: ${open.map((m) => m.id).join(', ')} ${open.length > 1 ? 'have' : 'has'} open weights, so record the OpenRouter programming ranking read at preregistration`);
  if (p.peg) {
    if (!text(p.peg.source)) problems.push('peg.source required');
    if (p.peg.as_of !== null && !(text(p.peg.as_of) && Number.isFinite(Date.parse(p.peg.as_of)))) problems.push('peg.as_of must be a date or null');
    if (p.peg.sha256 !== null && !(text(p.peg.sha256) && SHA256.test(p.peg.sha256))) problems.push('peg.sha256 must be a full sha256 or null');
    if ((p.peg.as_of === null || p.peg.sha256 === null) && !text(p.peg.note)) problems.push('peg.note must say why as_of or sha256 is missing');
  }

  placeholders(p, '', problems);
  return problems;
}

/** What the admission check reads from the ledger's record of a line item (U4): its id and its admission mode. */
export interface LineItemAdmission {
  item: string;
  admission?: string;
}

/**
 * GSTA-8's CI plan, decision 3: a program-funded paid run spends only on a line item created with
 * `--admission required`, whose lease refuses without a rig-proof record. A caller's own run may use a warn item.
 * item is the ledger's record of money.line_item, or null when the ledger has none.
 */
export function admissionProblems(p: Preregistration, item: LineItemAdmission | null): string[] {
  if (!(p.money?.cap_usd > 0) || p.money.funding !== 'program') return [];
  const name = p.money.line_item ?? '(none)';
  if (!item) return [`line item ${name} has no record in the ledger; create it with ledger init --item ${name} --admission required`];
  if (item.item !== name) return [`the ledger record given is for line item ${item.item}, not ${name}`];
  if (item.admission !== 'required') return [`line item ${name} has admission ${item.admission ?? 'unset'}; a program preregistration needs an item created with --admission required`];
  return [];
}

/** Reads a preregistration before a run and refuses it with every problem, the line item's admission included. */
export function loadPreregistration(path: string, item: LineItemAdmission | null): Preregistration {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const problems = preregistrationProblems(value);
  if (!problems.length) problems.push(...admissionProblems(value as Preregistration, item));
  if (problems.length) throw new Error(`${path} cannot be run: ${problems.join('; ')}`);
  return value as Preregistration;
}

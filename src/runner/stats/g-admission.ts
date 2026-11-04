// G's admission check (outcome-per-skill plan v3 section 6, build step O4), as the G family's admission prereg freezes
// it (wiki/plans/2026-11-04-geva-262-g-family-admission-prereg, section 6). Per skill, on the 12-task slice, Opus 5.5
// only, with 2 trials per arm per task. Each item reads the frozen data and the first that fails decides the route:
//
//   1. headroom: none's solved share over its valid trials is in [0.20, 0.80], ends included (5 to 19 of 24). The none
//      arm is shared, so a failure stops both skills: below as FIX-METHOD (floor), above as FIX-METHOD (saturation);
//   2. exposure: of 8 sampled told trials, one on each of 8 tasks, at least 7 exposed, or FIX-METHOD (exposure);
//   3. instruments: the mutation tool scores at least 90% of the trees in the skill's comparison (its told trees and
//      the none trees) without a tool error, and the verifier returns a run for every tree, or FIX-METHOD (instrument);
//   4. rig: at most 1 gap per arm after reruns (5% of the planned trials, rounded down), and every arm stop explained
//      by the lane's frozen termination taxonomy, or FIX-METHOD (rig);
//   5. price and power: resize.py's re-size (g-resize.ts) at the metered inputs, under M1 and the Captain's pick C, or
//      FIX-METHOD (price).
//
// Valid trials are the scored ones: gaps and contaminated trials stay out. The metered means are each arm's mean
// session cost over its scored trials, arm stops included at their metered cost; told's are intention to treat, with
// exposed and unexposed sessions printed apart. AUTH_PAID comes from the slice's settled U4 leases (authPaidFromLedger).
// The exposure sample is drawn as prereg section 5 says (Python's random.Random(20261105), with its replacement rule)
// and passed in; admitG checks its shape.
import { listItems, readItem } from "../ledger/record.ts";
import { shareAtLeast, shareAtMost, taskRepos, type OutcomeTrial } from "./outcome-decision.ts";
import { G_SKILLS, m1Decide, meteredPricer, renderResizeMetered, type GMetered, type GSkill, type M1Decision, type Run } from "./g-resize.ts";

export interface SliceTrial extends OutcomeTrial {
  /** The mutation tool's reading of the trial's tree; null on a gap, which has no tree. */
  mutation: "scored" | "no_tests" | "tool_error" | null;
  /** Whether the verifier returned a run for the tree. */
  verifier_ran: boolean;
  /** On an arm stop, whether the lane's frozen termination taxonomy explains it; null otherwise. */
  stop_explained: boolean | null;
}

export interface AdmissionInput {
  arms: { none: string; told: Record<GSkill, string> };
  trials: SliceTrial[];
  /** Trials planned per arm: 12 tasks x 2. */
  planned_trials: number;
  /** Item 2's sample per skill, drawn as prereg section 5 says, replacements applied. */
  exposure_sample: Record<GSkill, Array<{ task: string; trial: number }>>;
  /** The slice's paid author and audit dollars per valid task (authPaidFromLedger). */
  auth_paid_usd: number;
  /** The slice's crew dollars per valid task over the second six valid tasks. */
  auth_extra_usd: number;
}

export interface AdmissionItem {
  item: 1 | 2 | 3 | 4 | 5;
  name: "headroom" | "exposure" | "instruments" | "rig" | "price and power";
  /** null when an earlier item stopped the skill, so this one was not read. */
  pass: boolean | null;
  reading: string;
}

export interface SkillAdmission {
  skill: GSkill;
  failed: 1 | 2 | 3 | 4 | 5 | null;
  route: string;
  items: AdmissionItem[];
  /** The design item 5 prints for stage 4; null when the skill stops. */
  design: Run | null;
  /** All scored told trials the detector read, as a description. */
  exposure_all: { exposed: number; trials: number };
}

export interface ToldMeter {
  trials: number;
  /** null when the arm has no scored trial; its multiple then stays out of the metered inputs. */
  all_usd: number | null;
  exposed_usd: number | null;
  unexposed_usd: number | null;
}

export interface Admission {
  headroom: { solved: number; valid: number; share: number };
  skills: Record<GSkill, SkillAdmission>;
  metered: { inputs: GMetered; none_usd: number; told: Record<GSkill, ToldMeter> };
  m1: M1Decision;
  resize_text: string;
}

const V_SESSION = 0.191;
const ROUTES = { 2: "FIX-METHOD (exposure)", 3: "FIX-METHOD (instrument)", 4: "FIX-METHOD (rig)", 5: "FIX-METHOD (price)" } as const;
const pct = (x: number, of: number) => (of ? ((100 * x) / of).toFixed(1) + "%" : "n/a");
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;

export function admitG(input: AdmissionInput): Admission {
  const { arms, trials, planned_trials: planned } = input;
  if (!Number.isSafeInteger(planned) || planned < 1) throw new Error("planned_trials must be a whole number of trials per arm");
  const armOf = new Set([arms.none, arms.told["plan-eng-review"], arms.told.autoplan]);
  if (armOf.size !== 3) throw new Error("the none arm and the two told arms need three different names");
  taskRepos(trials);
  for (const t of trials) {
    if (!armOf.has(t.arm)) throw new Error("trial " + t.trial + " on task " + t.task + " is on arm " + t.arm + ", which admission does not read");
    if (t.status !== "scored") continue;
    if (t.cost_usd === null || !Number.isFinite(t.cost_usd) || t.cost_usd < 0) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " has no meter record; item 5 reads every session's U4 lease spend");
    if (t.mutation === null) throw new Error("trial " + t.trial + " of arm " + t.arm + " on task " + t.task + " is scored but has no mutation reading");
  }
  for (const [name, v] of [["auth_paid_usd", input.auth_paid_usd], ["auth_extra_usd", input.auth_extra_usd]] as const) if (!Number.isFinite(v) || v < 0) throw new Error(name + " must be dollars per valid task, 0 or more");
  const of = (arm: string) => trials.filter((t) => t.arm === arm);
  const scored = (arm: string) => of(arm).filter((t) => t.status === "scored");

  const none = scored(arms.none);
  if (!none.length) throw new Error("the none arm has no valid trial, so headroom can't be read");
  const solved = none.filter((t) => t.solved).length;
  const headroom = shareAtLeast(solved, none.length, 0.2) && shareAtMost(solved, none.length, 0.8);
  const headroomRoute = headroom ? null : shareAtLeast(solved, none.length, 0.2) ? "FIX-METHOD (saturation)" : "FIX-METHOD (floor)";
  const headroomItem: AdmissionItem = { item: 1, name: "headroom", pass: headroom, reading: "none solved " + solved + " of " + none.length + " valid trials (" + pct(solved, none.length) + "); the band is 20% to 80%, ends included" };

  const maxGaps = Math.floor((planned * 5) / 100);
  const rig = (arm: string) => {
    const present = of(arm).filter((t) => t.status !== "gap").length;
    if (present > planned) throw new Error("arm " + arm + " has " + present + " trials, more than the " + planned + " planned");
    const unexplained = of(arm).filter((t) => t.status !== "gap" && t.truncated && t.stop_explained !== true).length;
    return { gaps: planned - present, unexplained };
  };
  const noneRig = rig(arms.none);

  const items = {} as Record<GSkill, AdmissionItem[]>;
  const told = {} as Record<GSkill, ToldMeter>;
  const exposureAll = {} as Record<GSkill, { exposed: number; trials: number }>;
  for (const s of G_SKILLS) {
    const arm = arms.told[s];
    const mine = scored(arm);
    const sample = input.exposure_sample[s];
    if (!Array.isArray(sample) || sample.length !== 8) throw new Error("item 2 reads 8 sampled told trials of " + s + ", one on each of 8 tasks, not " + (Array.isArray(sample) ? sample.length : "none"));
    const tasks = new Set<string>();
    let exposed = 0;
    for (const x of sample) {
      if (tasks.has(x.task)) throw new Error("task " + x.task + " is sampled twice for " + s + "; item 2 takes one trial on each of 8 tasks");
      tasks.add(x.task);
      const t = of(arm).find((y) => y.task === x.task && y.trial === x.trial);
      if (!t || t.status !== "scored" || t.exposed === null) throw new Error("sampled trial " + x.trial + " on task " + x.task + " is not a scored " + s + " trial read by the detector; replace it as prereg section 5 says");
      if (t.exposed) exposed++;
    }
    const read = mine.filter((t) => t.exposed !== null);
    exposureAll[s] = { exposed: read.filter((t) => t.exposed).length, trials: read.length };
    const trees = [...none, ...mine];
    const errors = trees.filter((t) => t.mutation === "tool_error").length;
    const noRun = trees.filter((t) => !t.verifier_ran).length;
    const toldRig = rig(arm);
    items[s] = [
      headroomItem,
      { item: 2, name: "exposure", pass: exposed >= 7, reading: exposed + " of 8 sampled told trials exposed (7 needed); " + exposureAll[s].exposed + " of " + exposureAll[s].trials + " told trials read exposed" },
      { item: 3, name: "instruments", pass: shareAtLeast(trees.length - errors, trees.length, 0.9) && noRun === 0, reading: "mutation tool scored " + (trees.length - errors) + " of " + trees.length + " trees without a tool error (" + pct(trees.length - errors, trees.length) + ", 90% needed); the verifier returned no run for " + noRun },
      { item: 4, name: "rig", pass: noneRig.gaps <= maxGaps && toldRig.gaps <= maxGaps && noneRig.unexplained + toldRig.unexplained === 0, reading: "gaps after reruns: none " + noneRig.gaps + ", told " + toldRig.gaps + " (at most " + maxGaps + " an arm); unexplained arm stops: none " + noneRig.unexplained + ", told " + toldRig.unexplained },
    ];
    const cost = (xs: SliceTrial[]) => (xs.length ? mean(xs.map((t) => t.cost_usd!)) : null);
    told[s] = { trials: mine.length, all_usd: cost(mine), exposed_usd: cost(mine.filter((t) => t.exposed === true)), unexposed_usd: cost(mine.filter((t) => t.exposed === false)) };
  }

  const noneUsd = mean(none.map((t) => t.cost_usd!));
  const inputs: GMetered = { MULT: noneUsd / V_SESSION };
  if (told["plan-eng-review"].all_usd !== null) inputs.M_PER = told["plan-eng-review"].all_usd / noneUsd;
  if (told.autoplan.all_usd !== null) inputs.M_AP = told.autoplan.all_usd / noneUsd;
  inputs.AUTH_PAID = input.auth_paid_usd;
  inputs.AUTH_EXTRA = input.auth_extra_usd;
  const firstFail = (s: GSkill) => items[s].find((x) => !x.pass)?.item ?? null;
  const stopped = G_SKILLS.filter((s) => firstFail(s) !== null);
  const m1 = m1Decide(meteredPricer(inputs), stopped);
  const resizeText = renderResizeMetered(inputs);

  const skills = {} as Record<GSkill, SkillAdmission>;
  for (const s of G_SKILLS) {
    const early = firstFail(s);
    const design = early === null ? m1.runs[s] : null;
    const price: AdmissionItem = { item: 5, name: "price and power", pass: early === null ? design !== null : null, reading: early === null ? (design ? "runs " + design.n + "x" + design.k + ", MDD " + design.mdd + ", $" + design.price + "; " + m1.reason : "stops: " + m1.reason) : "not read: item " + early + " stopped the skill" };
    const failed = early ?? (design === null ? 5 : null);
    skills[s] = {
      skill: s, failed, design, exposure_all: exposureAll[s], items: [...items[s], price],
      route: failed === null ? "stage 4" : failed === 1 ? headroomRoute! : ROUTES[failed],
    };
  }
  return { headroom: { solved, valid: none.length, share: solved / none.length }, skills, metered: { inputs, none_usd: noneUsd, told }, m1, resize_text: resizeText };
}

/** AUTH_PAID: the settled spend of the slice's author and audit line items, over its valid tasks. Every lease must be closed. */
export function authPaidFromLedger(record: string, items: readonly string[], validTasks: number): number {
  if (!Number.isSafeInteger(validTasks) || validTasks < 1) throw new Error("the slice's valid task count must be a whole number, 1 or more");
  if (!items.length) throw new Error("name the slice's author and audit line items");
  const known = new Set(listItems(record));
  let micros = 0;
  for (const item of items) {
    const s = known.has(item) ? readItem(record, item) : null;
    if (!s || !s.leases.length) throw new Error("line item " + item + " has no lease in " + record + ", so its spend can't be read");
    for (const { lease, close } of s.leases) {
      if (!close) throw new Error("line item " + item + " still has lease " + lease.lease_id + " open; settle it before admission reads AUTH_PAID");
      micros += close.spent_micros + close.unknown_micros;
    }
  }
  return micros / 1_000_000 / validTasks;
}

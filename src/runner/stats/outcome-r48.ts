// The R48 table of the outcome-per-skill plan v3 (section 9, build step O4): one row per skill that routes its
// told-minus-none contrast, its exposure rate, its cost per solved task (#169's G3) and, when it ran, its futility look
// to KEEP, FIX-METHOD or CUT-CANDIDATE, or to the Why-null cycle a person still runs. In order:
//
//   - exposure under 80% of told trials: untested (exposure), FIX-METHOD, whatever the contrast says;
//   - none above the 85% ceiling: a saturation null, FIX-METHOD with R61's one ceiling raise;
//   - hurts: CUT-CANDIDATE, reported plainly;
//   - helps: KEEP when the cost ratio's upper bound is at most 1.5, FIX-METHOD (cost unsettled) when its interval spans
//     1.5, CUT-CANDIDATE on cost (the diet track) when its lower bound is above 1.5;
//   - a futility stop whose interim estimate favors none: a loss lead, to the Captain and checked for a loss first;
//   - not distinguished: CUT-CANDIDATE on cost when the ratio's lower bound is above 1.5; in G only, CUT-CANDIDATE when
//     the contrast's upper bound is under the skill's break-even gain; otherwise the Why-null cycle.
//
// The cost readings print as provisional until the project owner confirms 1.5 times none as the bar (plan v3 section 16).
import { breakEvenGain, G3, type CostGuard } from "./outcome-cost.ts";
import { G_DECISION, shareAtLeast, type Contrast, type Futility, type Verdict } from "./outcome-decision.ts";

export const EXPOSURE_BAR = 0.8;

export interface R48Paths {
  exposure: string;
  saturation: string;
  task_fit: string;
  /** told = stand-in > none, only where a stand-in runs. */
  idea_only: string;
  loss: string;
}

const R61 = "R61's one ceiling raise, after a headroom check on 40 tasks x 3 none trials: ";
const G_PATHS: R48Paths = {
  exposure: "FIX-METHOD: after pin, or the forced line",
  saturation: R61 + "the strict stratum (merged on or after 2026-10-01), features of 3 or more source files and 200 or more lines, the K1 subset",
  task_fit: "FIX-METHOD: the large-feature stratum",
  idea_only: "procedure CUT-CANDIDATE; diet candidate to the stand-in's size, verified by the before/after skill eval",
  loss: "CUT-CANDIDATE, with cost per solved task",
};
const U_PATHS: R48Paths = { ...G_PATHS, saturation: R61 + "a scanning agent user: screenshot only (no accessibility text), a 15-step cap", task_fit: "FIX-METHOD: tasks that add a screen, not only change one" };
const X_PATHS: R48Paths = { ...G_PATHS, saturation: R61 + "goals that need two documented steps (install and configure, then use) and a 10-turn cap", task_fit: "FIX-METHOD: features that add a command, flag or exported API" };

/** Plan v3 section 9's table, per wave 1 skill. */
export const R48_PATHS: Record<string, R48Paths> = {
  autoplan: G_PATHS,
  "plan-eng-review": G_PATHS,
  "plan-design-review": U_PATHS,
  "design-review": { ...U_PATHS, exposure: "FIX-METHOD: no browser session counts as unexposed" },
  "plan-devex-review": X_PATHS,
  "devex-review": { ...X_PATHS, exposure: "FIX-METHOD: no timed first run counts as unexposed" },
};

/** G's primary and its cost figure count the same pass-or-fail solve, so only G reads the break-even rule. */
const G_FAMILY = new Set(["plan-eng-review", "autoplan"]);

export interface R48Input {
  skill: string;
  contrast: Contrast;
  /** Told trials the skill's detector read as exposed, of all its scored told trials (intention to treat). */
  exposure: { exposed: number; trials: number };
  cost: CostGuard;
  /** The planned MDD, as a share. */
  mdd: number;
  futility?: Futility;
  /** The project owner has confirmed 1.5 times none as the bar for a told skill. */
  bar_confirmed?: boolean;
}

export type R48Route = "KEEP" | "FIX-METHOD" | "CUT-CANDIDATE" | "WHY-NULL";

export interface R48Row {
  skill: string;
  verdict: Verdict;
  route: R48Route;
  null_kind: "exposure" | "saturation" | "loss" | "cost" | "cost-unsettled" | "break-even" | "loss-lead" | "why-null" | null;
  reason: string;
  next: string;
  delta: number | null;
  ci95: [number, number] | null;
  control_rate: number | null;
  mdd: number;
  exposure: number;
  cost_ratio: number | null;
  cost_ci95: [number, number];
  break_even: number | null;
  provisional: boolean;
  loss_lead: boolean;
}

const pts = (x: number) => (100 * x).toFixed(1);
const ci = (c: [number, number] | null) => (c ? pts(c[0]) + " to " + pts(c[1]) : "no interval");
const ratio = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "unbounded");
const TO_CAPTAIN = "to the Captain and Garry plainly, in R41 format, with the evidence";

export function r48(input: R48Input): R48Row {
  const paths = R48_PATHS[input.skill];
  if (!paths) throw new Error("R48 has no path for skill " + input.skill + "; plan v3 section 9 names " + Object.keys(R48_PATHS).join(", "));
  const { exposed, trials } = input.exposure;
  if (!Number.isSafeInteger(trials) || trials < 1 || !Number.isSafeInteger(exposed) || exposed < 0 || exposed > trials) throw new Error("exposure must count exposed told trials of 1 or more");
  const reading = input.contrast.with_truncated;
  const bar = G3.bar, cost = input.cost, [lo, hi] = cost.ci95;
  const controlRate = reading ? reading.control_mean : null;
  const breakEven = G_FAMILY.has(input.skill) && controlRate !== null ? breakEvenGain(controlRate, cost.session_multiple, bar) : null;
  const costText = "cost per solved task " + (cost.ratio === null ? "n/a" : ratio(cost.ratio)) + " times none's (95% CI " + ratio(lo) + " to " + ratio(hi) + ")";
  const effect = reading ? "told minus none " + pts(reading.delta) + " points (95% CI " + ci(reading.ci95) + ")" : "no paired task";
  const row = (route: R48Route, null_kind: R48Row["null_kind"], reason: string, next: string, costRead: boolean, lossLead = false): R48Row => ({
    skill: input.skill, verdict: input.contrast.verdict, route, null_kind, reason, next,
    delta: reading ? reading.delta : null, ci95: reading ? reading.ci95 : null, control_rate: controlRate, mdd: input.mdd,
    exposure: exposed / trials, cost_ratio: cost.ratio, cost_ci95: cost.ci95, break_even: breakEven,
    provisional: costRead && !input.bar_confirmed, loss_lead: lossLead,
  });
  if (!shareAtLeast(exposed, trials, EXPOSURE_BAR)) {
    return row("FIX-METHOD", "exposure", "untested (exposure): told ran the skill's steps in " + exposed + " of " + trials + " trials (" + pts(exposed / trials) + "%), under the 80% bar", paths.exposure, false);
  }
  const v = input.contrast.verdict;
  if (v === "ceiling") {
    const share = reading?.control_share;
    return row("FIX-METHOD", "saturation", "saturation null: none solved " + (share === null || share === undefined ? "more than 85%" : pts(share) + "%") + " of its trials, above the " + 100 * G_DECISION.ceiling + "% ceiling", paths.saturation, false);
  }
  if (v === "hurts") return row("CUT-CANDIDATE", "loss", "hurts: " + effect + "; " + costText, paths.loss, false);
  if (v === "helps") {
    if (hi <= bar) return row("KEEP", null, "helps: " + effect + "; " + costText + ", upper bound at most " + bar, "keep the skill as it is", true);
    if (lo > bar) return row("CUT-CANDIDATE", "cost", "helps, but " + costText + " stays above " + bar + ": CUT-CANDIDATE on cost, to the diet track", "diet track: cut the lines that cost without helping, verified by the before/after skill eval", true);
    return row("FIX-METHOD", "cost-unsettled", "helps, cost unsettled: " + costText + " spans " + bar, "report the ratio and its interval; the cost reading needs more solved tasks to settle", true);
  }
  const f = input.futility;
  if (f && f.stop && f.loss_lead) {
    return row("WHY-NULL", "loss-lead", "loss lead: the futility look stopped with an interim estimate of " + pts(f.delta) + " points in none's favor (95% CI " + ci(f.ci95) + "), exposure " + pts(exposed / trials) + "%", "to the Captain with the estimate, its interval and the exposure rate; R48 checks it for a loss (" + paths.loss + ") before reading it as not distinguished", false, true);
  }
  if (lo > bar) return row("CUT-CANDIDATE", "cost", "not distinguished (" + effect + "), and " + costText + " stays above " + bar + ": told costs more per solved task with no gain shown", TO_CAPTAIN, true);
  if (breakEven !== null && reading?.ci95 && reading.ci95[1] < breakEven) {
    return row("CUT-CANDIDATE", "break-even", "not distinguished (" + effect + "), and its upper bound is under the break-even gain of " + pts(breakEven) + " points at a " + ratio(cost.session_multiple) + " times session cost: no gain the data allow pays for the extra cost", TO_CAPTAIN, true);
  }
  return row("WHY-NULL", "why-null", "not distinguished: " + effect + ", control rate " + (controlRate === null ? "n/a" : pts(controlRate) + "%") + ", MDD " + pts(input.mdd) + " points; " + costText, "Why-null cycle: exposure, task fit (" + paths.task_fit + "), power and floor or ceiling (control rate and MDD), and frontier without it; it ends in KEEP, FIX-METHOD or CUT-CANDIDATE", true);
}

/** One Markdown table row per skill. */
export function renderR48(rows: readonly R48Row[]): string {
  const cell = (s: string) => s.replaceAll("|", "/");
  const head = "| Skill | Verdict | Told minus none, points (95% CI) | Control rate | MDD | Exposure | Cost per solved, told over none (95% CI) | Break-even | Route | Reason | Next |";
  const sep = "|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((r) => "| " + [
    r.skill, r.verdict, r.delta === null ? "n/a" : pts(r.delta) + " (" + ci(r.ci95) + ")", r.control_rate === null ? "n/a" : pts(r.control_rate) + "%", pts(r.mdd),
    pts(r.exposure) + "%", (r.cost_ratio === null ? "n/a" : ratio(r.cost_ratio)) + " (" + ratio(r.cost_ci95[0]) + " to " + ratio(r.cost_ci95[1]) + ")" + (r.provisional ? ", provisional" : ""),
    r.break_even === null ? "n/a" : pts(r.break_even), r.route + (r.loss_lead ? ", loss lead" : ""), r.reason, r.next,
  ].map(cell).join(" | ") + " |");
  return [head, sep, ...lines].join("\n");
}

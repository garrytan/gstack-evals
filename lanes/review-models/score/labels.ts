// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's labels (prereg "Judge check", as pre-run changes 1, 5 and 6 amend it). Two people label each
// bug-unit review fix-aware and blind to arm, through the labelling desk (post/desk.ts writes their pages and reads their
// files); no model makes a label. A review is labelled as naming the bug or not. Where the two disagree, both read the
// review again with both readings shown; the adjudicated label is the one both give after that read, and a pair that
// still disagrees stays in the check (nothing is dropped for disagreeing), the kappa taken with it read both ways, the
// lower one standing. Carbon's review-level reading (any finding ruled names, can't tell as not naming) is checked against
// those labels: kappa of at least 0.6 pooled on at least 100 labelled bug-unit reviews, each counted arm with at least
// 20, with errors, abstentions (reviews with a can't tell ruling) and empty replies (judge calls that failed twice) per
// arm and per pool. Decoy reviews carry no known bug and are left out.
// labellerRequest is the Opus and Astra request the contamination second read sends (post/send.ts); it makes no label.
import { judgeRequest } from "../../../src/adapters/judge.ts";
import { kappa } from "../../product-value/stats.ts";
import { JUDGE_CHECK, LABELLERS, rmFail, type Arm } from "./frozen.ts";
import type { Review } from "./score.ts";

export type Labeller = keyof typeof LABELLERS;
/** Output cap for every labeller read, the /cso eval's figure for its gold labellers. */
export const LABEL_MAX_OUTPUT = 32_000;
export const LABEL_EFFORT = "high";
/** Astra's reads open as a read-only correctness review (R95). */
export const ASTRA_FRAMING = "This is a read-only correctness review of a code review's findings.";

export interface LabelKey {
  id: string;
  unit: string;
  arm: Arm;
  pool: "P" | "B";
}

/** The request body for one Opus or Astra read, on its own provider route; Astra's opens with the read-only framing. */
export function labellerRequest(who: Labeller, prompt: string): Record<string, unknown> {
  const m = LABELLERS[who];
  if (who === "astra") return judgeRequest("openai", m.api, ASTRA_FRAMING + "\n\n" + prompt, LABEL_MAX_OUTPUT, LABEL_EFFORT);
  return judgeRequest("anthropic", m.api, prompt, LABEL_MAX_OUTPUT);
}

export type FinalLabel = boolean | "unresolved";

/** One review's final person label, as post/desk.ts writes final.json. cant_tell marks a no that rests on a can't tell. */
export interface FinalRow extends LabelKey {
  label: FinalLabel;
  cant_tell?: true;
  /** Subset reviews (R125): seat A's and seat B's readings, names or not (can't tell as not), for their agreement. */
  a_b?: [boolean, boolean];
}

export interface CheckRow {
  unit: string;
  arm: Arm;
  pool: "P" | "B";
  label: FinalLabel;
  /** Carbon's review-level reading: any finding ruled names. */
  carbon: boolean;
  abstained: boolean;
  empty_reply: boolean;
}

/** A check row from a scored review and its final label. */
export const checkRow = (r: Review, label: FinalLabel): CheckRow => ({
  unit: r.unit,
  arm: r.arm,
  pool: r.pool === "decoy" ? rmFail("E_RM_LABELS", r.unit + " is a decoy, which the check leaves out") : r.pool,
  label,
  carbon: r.findings.some((f) => r.judged?.rulings[f.id] === "names"),
  abstained: r.findings.some((f) => r.judged?.rulings[f.id] === "cant_tell"),
  empty_reply: !!r.judged?.failed,
});

export interface GroupErrors {
  labels: number;
  errors: number;
  carbon_yes_label_no: number;
  carbon_no_label_yes: number;
  unresolved: number;
  abstentions: number;
  empty_replies: number;
}

function group(rows: readonly CheckRow[]): GroupErrors {
  const resolved = rows.filter((r) => r.label !== "unresolved");
  return {
    labels: rows.length,
    errors: resolved.filter((r) => r.carbon !== r.label).length,
    carbon_yes_label_no: resolved.filter((r) => r.carbon && r.label === false).length,
    carbon_no_label_yes: resolved.filter((r) => !r.carbon && r.label === true).length,
    unresolved: rows.length - resolved.length,
    abstentions: rows.filter((r) => r.abstained).length,
    empty_replies: rows.filter((r) => r.empty_reply).length,
  };
}

export interface KappaCheck {
  labels: number;
  /** The lower kappa over the two readings of unresolved labels (both equal when none is unresolved). */
  kappa: number | null;
  kappa_unresolved_as_yes: number | null;
  kappa_unresolved_as_no: number | null;
  per_arm: Partial<Record<Arm, GroupErrors>>;
  per_pool: Record<"P" | "B", GroupErrors>;
  /** Counted arms under 20 labels. */
  short_arms: Arm[];
  pass: boolean;
  line: string;
}

/** The gate: pooled kappa at least 0.6 on at least 100 labels, every counted arm with at least 20. */
export function kappaCheck(rows: readonly CheckRow[], countedArms: readonly Arm[]): KappaCheck {
  const read = (unresolved: boolean) => kappa(rows.map((r) => [r.carbon, r.label === "unresolved" ? unresolved : r.label] as const));
  const yes = read(true), no = read(false);
  const k = yes === null || no === null ? null : Math.min(yes, no);
  const arms = [...new Set(rows.map((r) => r.arm))];
  const perArm = Object.fromEntries(arms.map((a) => [a, group(rows.filter((r) => r.arm === a))])) as Partial<Record<Arm, GroupErrors>>;
  const short = countedArms.filter((a) => (perArm[a]?.labels ?? 0) < JUDGE_CHECK.per_arm_min);
  const pass = rows.length >= JUDGE_CHECK.labels_min && k !== null && k >= JUDGE_CHECK.kappa_min && !short.length;
  const all = group(rows);
  const line = "Carbon judge check: " + rows.length + " labelled reviews, kappa " + (k === null ? "n/a" : k.toFixed(3)) + (all.unresolved ? " (lower of " + all.unresolved + " unresolved read both ways)" : "") + ", errors " + all.errors + ", abstentions " + all.abstentions + ", empty replies " + all.empty_replies + "; gate kappa " + JUDGE_CHECK.kappa_min + " on " + JUDGE_CHECK.labels_min + " labels" + (short.length ? ", arms under " + JUDGE_CHECK.per_arm_min + " labels: " + short.join(", ") : "") + ": " + (pass ? "passes" : "fails");
  return { labels: rows.length, kappa: k, kappa_unresolved_as_yes: yes, kappa_unresolved_as_no: no, per_arm: perArm, per_pool: { P: group(rows.filter((r) => r.pool === "P")), B: group(rows.filter((r) => r.pool === "B")) }, short_arms: short, pass, line };
}

/** The pilot table's judge column: every pilot bug review labelled, and at most 2 Carbon errors on the arm. */
export function pilotJudgeCheck(rows: readonly CheckRow[], arm: Arm, pilotBugReviews: number): { pass: boolean; errors: number; labels: number } {
  const g = group(rows.filter((r) => r.arm === arm));
  return { pass: g.labels === pilotBugReviews && g.errors + g.unresolved <= JUDGE_CHECK.pilot_errors_max, errors: g.errors, labels: g.labels };
}

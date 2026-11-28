// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's labels (prereg "Judge check", as pre-run changes 1, 6 and 9 amend it). Under change 9 one model, Grok
// 4.7, labels each bug-unit review the check takes, blind to arm and fix-aware, in one pass (post/send.ts labelSend): it
// reads the judge's own input for the review (the bug's evidence, the fix diff and the scrubbed numbered findings) and
// answers change 6's question once, which findings name the bug, none, or can't tell, with a one-line reason. A review
// Grok can't label goes once to Kimi K3.1 Pro, and a review neither labels is can't tell. Can't tell counts as not naming,
// with a second reading that counts it as naming (change 6). Carbon's review-level reading (any finding ruled names,
// Carbon's own can't tell as not naming) is checked against those labels: kappa of at least 0.6 pooled on at least 100
// labelled bug-unit reviews, each counted arm with at least 20, with errors, abstentions (reviews with a can't tell
// ruling) and empty replies (judge calls that failed twice) per arm and per pool. Decoy reviews carry no known bug and are
// left out. labellerRequest is the Opus and Astra request the contamination second read sends; it makes no label.
import { judgeRequest } from "../../../src/adapters/judge.ts";
import { OPENROUTER_MODELS, openRouterRouting } from "../../../src/runner/pricing/prices.ts";
import { kappa } from "../../product-value/stats.ts";
import { GROK, JUDGE_CHECK, KIMI, LABELLERS, rmFail, type Arm } from "./frozen.ts";
import { bugBlock, numberedFindings, replyJson, type Bug, type Parsed, type ReviewFinding } from "./judge.ts";
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

/** The judge check's two label models (change 9), by the name a final row records. */
export const LABEL_MODELS = { grok: GROK, kimi: KIMI } as const;
export type LabelModel = keyof typeof LABEL_MODELS;
/** A labeller's answer: the findings that name the bug, by number, or none, or can't tell. */
export type Answer = number[] | "none" | "cant_tell";

/** Change 6's question, once per review, on the judge's own input for it (score/judge.ts bugBlock and numberedFindings). */
export function labelPrompt(bug: Bug, findings: readonly ReviewFinding[]): string {
  return [
    "You are checking whether a code review found one known bug. The review was written before the fix below existed.",
    bugBlock(bug),
    "The review's findings, numbered:\n" + numberedFindings(findings),
    'Which findings name this bug? A finding names it when it identifies the defect the fix repairs (the same faulty behaviour, in the code the fix changes or the code that causes it), at any severity and whatever fix it proposes. Give the number of every finding that names it, or "none" when no finding does, or "cant_tell" when the findings are too vague to decide.',
    'Answer with one fenced json block and nothing after it:\n{"answer": [1], "reason": "one line"}\nanswer is a list of finding numbers, or "none", or "cant_tell"; reason is one line saying why.',
  ].join("\n\n");
}

/** A label reply: a non-empty list of distinct finding numbers in 1..n, or none, or cant_tell, and a one-line reason. */
export function parseLabel(text: string, n: number): Parsed<{ answer: Answer; reason: string }> {
  const j = replyJson(text);
  if (j.kind !== "ok") return j;
  const v = j.value as Record<string, unknown>;
  const a = v?.answer;
  if (typeof v?.reason !== "string" || !v.reason.trim()) return { kind: "malformed", reason: "no one-line reason" };
  if (a === "none" || a === "cant_tell") return { kind: "ok", value: { answer: a, reason: v.reason.trim() } };
  if (!Array.isArray(a) || !a.length) return { kind: "malformed", reason: "answer is not a list of finding numbers, none or cant_tell" };
  if (!a.every((k) => Number.isInteger(k) && k >= 1 && k <= n)) return { kind: "malformed", reason: "answer names a number outside 1 to " + n };
  if (new Set(a).size !== a.length) return { kind: "malformed", reason: "answer names a finding twice" };
  return { kind: "ok", value: { answer: [...(a as number[])].sort((x, y) => x - y), reason: v.reason.trim() } };
}

/** The request body for one label read: the model on OpenRouter at default effort, pinned to its price row's one provider,
 *  no fallbacks, data collection denied, at the row's price ceiling. The output cap is the metering proxy's. */
export function labelRequest(who: LabelModel, prompt: string): Record<string, unknown> {
  const m = LABEL_MODELS[who];
  const price = OPENROUTER_MODELS[m.model];
  if (!price || price.providers?.length !== 1 || price.providers[0] !== m.pin) return rmFail("E_RM_LABELS", m.model + " has no price row pinned to " + m.pin + " alone");
  return { ...judgeRequest("openrouter", m.model, prompt), provider: openRouterRouting(price) };
}

/** One review's final label (change 9), as post/send.ts writes final.json. cant_tell marks a no that rests on a can't tell.
 *  labeller is the model whose answer stands, or none: a review with no findings (nothing to name the bug) or one neither
 *  model labelled (can't tell). fallback says why Grok's answer does not stand, when it does not. */
export interface FinalRow extends LabelKey {
  label: FinalLabel;
  cant_tell?: true;
  answer: Answer;
  labeller: LabelModel | "none";
  reason: string;
  fallback?: string;
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

// Copyright (c) 2026 Garry Tan. MIT License.
// The judge check's labels (prereg "Judge check", as pre-run change 1 item 1 amends it). Two labellers, Claude Opus 5.5
// and GPT-6.2 Astra, read each review fix-aware and blind to arm: the same bug block and normalised numbered findings
// the judge sees (judge.ts), under an opaque item id whose key to unit and arm stays with the caller. A review is labelled
// as naming the bug or not. Where the two disagree, each reads the review again with both readers' answers and reasons,
// shown as reader A and reader B in a seeded order, so neither knows which answer was its own. The adjudicated label is
// the one both give after that read; a pair that still disagrees stays in the check (nothing is dropped for disagreeing)
// and the kappa is taken with it read both ways, the lower one standing. Carbon's review-level reading (any finding ruled
// names, can't tell as not naming) is checked against those labels: kappa of at least 0.6 pooled on at least 100 labelled
// bug-unit reviews, each counted arm with at least 20, with errors, abstentions (reviews with a can't tell ruling) and
// empty replies (judge calls that failed twice) per arm and per pool. Decoy reviews carry no known bug and are left out.
// The labellers are paid work; this file only builds their requests and reads their replies.
import { judgeAnswer, judgeRequest } from "../../../src/adapters/judge.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { kappa } from "../../product-value/stats.ts";
import { JUDGE_CHECK, LABELLERS, rmFail, type Arm } from "./frozen.ts";
import { bugBlock, numberedFindings, replyJson, type Bug, type Parsed, type ReviewFinding } from "./judge.ts";
import type { Review } from "./score.ts";

export type Labeller = keyof typeof LABELLERS;
/** Output cap for every labeller read, the /cso eval's figure for its gold labellers. */
export const LABEL_MAX_OUTPUT = 32_000;
export const LABEL_EFFORT = "high";
/** Astra's reads open as a read-only correctness review (R95). */
export const ASTRA_FRAMING = "This is a read-only correctness review of a code review's findings.";

export interface LabelItem {
  id: string;
  prompt: string;
}
export interface LabelKey {
  id: string;
  unit: string;
  arm: Arm;
  pool: "P" | "B";
}

const ASK = 'Does any finding name this bug? A finding names it when it identifies the defect the fix repairs (the same faulty behaviour, in the code the fix changes or the code that causes it), at any severity and whatever fix it proposes.\n\nAnswer with one fenced json block and nothing after it:\n{"names_bug": true, "findings": [1], "reason": "one or two sentences"}\nfindings lists the numbers of the findings that name it, and is empty when none does.';

export const labelPrompt = (bug: Bug, findings: readonly ReviewFinding[]) =>
  ["You are labelling whether a code review found one known bug. The review was written before the fix below existed.", bugBlock(bug), "The review's findings, numbered:\n" + (findings.length ? numberedFindings(findings) : "(the review reported no findings)"), ASK].join("\n\n");

/** One item per bug-unit review, in a seeded order under opaque ids, and the key that maps ids back. */
export function labelItems(reviews: readonly Review[], bugs: ReadonlyMap<string, Bug>, seed: number): { items: LabelItem[]; key: LabelKey[] } {
  const rng = seededRandom(seed);
  const bugReviews = reviews.filter((r) => r.pool !== "decoy" && r.outcome === "ok" && !r.contaminated);
  const order = bugReviews.map((r) => ({ r, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const items: LabelItem[] = [];
  const key: LabelKey[] = [];
  const taken = new Set<string>();
  for (const r of order) {
    const bug = bugs.get(r.unit) ?? rmFail("E_RM_LABELS", "no bug for unit " + r.unit);
    let id: string;
    do id = "L" + Math.floor(rng() * 1e8).toString(36).padStart(6, "0");
    while (taken.has(id));
    taken.add(id);
    items.push({ id, prompt: labelPrompt(bug, r.findings) });
    key.push({ id, unit: r.unit, arm: r.arm, pool: r.pool as "P" | "B" });
  }
  return { items, key };
}

/** The request body for one labeller read, on its own provider route. */
export function labellerRequest(who: Labeller, prompt: string): Record<string, unknown> {
  const m = LABELLERS[who];
  if (who === "astra") return judgeRequest("openai", m.api, ASTRA_FRAMING + "\n\n" + prompt, LABEL_MAX_OUTPUT, LABEL_EFFORT);
  return judgeRequest("anthropic", m.api, prompt, LABEL_MAX_OUTPUT);
}

export interface Label {
  names_bug: boolean;
  findings: number[];
  reason: string;
}

export function parseLabel(text: string, n: number): Parsed<Label> {
  const j = replyJson(text);
  if (j.kind !== "ok") return j;
  const v = j.value as Record<string, unknown>;
  if (typeof v?.names_bug !== "boolean") return { kind: "malformed", reason: "names_bug is not true or false" };
  const findings = Array.isArray(v.findings) ? v.findings : [];
  if (!findings.every((k) => Number.isInteger(k) && k >= 1 && k <= n)) return { kind: "malformed", reason: "findings names a number outside 1 to " + n };
  if (v.names_bug !== findings.length > 0) return { kind: "malformed", reason: "names_bug and findings disagree" };
  return { kind: "ok", value: { names_bug: v.names_bug, findings: findings as number[], reason: typeof v.reason === "string" ? v.reason : "" } };
}

/** A labeller's reply body read as a label: the provider's text, then parseLabel. */
export const readLabel = (who: Labeller, body: unknown, n: number) => parseLabel(judgeAnswer(LABELLERS[who].provider, body), n);

/** The adjudication read for one disagreement: the item, then both answers as reader A and reader B in a seeded order. */
export function adjudicationPrompt(item: LabelItem, a: Label, b: Label, rng: () => number): string {
  const [first, second] = rng() < 0.5 ? [a, b] : [b, a];
  const say = (l: Label) => (l.names_bug ? "names the bug (finding " + l.findings.join(", ") + ")" : "no finding names the bug") + ". Reason: " + (l.reason || "(none given)");
  return item.prompt + "\n\nTwo readers labelled this review and disagreed.\nReader A: " + say(first) + "\nReader B: " + say(second) + "\n\nRead the review again and give your own final answer in the same JSON form.";
}

export function adjudicationItems(items: readonly LabelItem[], opus: ReadonlyMap<string, Label>, astra: ReadonlyMap<string, Label>, seed: number): LabelItem[] {
  const rng = seededRandom(seed);
  return items.flatMap((it) => {
    const a = opus.get(it.id), b = astra.get(it.id);
    if (!a || !b) return rmFail("E_RM_LABELS", "item " + it.id + " lacks a first read from " + (a ? "astra" : "opus"));
    return a.names_bug === b.names_bug ? [] : [{ id: it.id, prompt: adjudicationPrompt(it, a, b, rng) }];
  });
}

export type FinalLabel = boolean | "unresolved";

export function adjudicated(first: [Label, Label], second?: [Label, Label]): FinalLabel {
  if (first[0].names_bug === first[1].names_bug) return first[0].names_bug;
  if (!second) return rmFail("E_RM_LABELS", "a disagreement has no adjudication read");
  return second[0].names_bug === second[1].names_bug ? second[0].names_bug : "unresolved";
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

// Copyright (c) 2026 Garry Tan. MIT License.
// Authoring (prereg 2026-11-15-geva-537 section 3): the plan, its two-way audit, the hint and its audit, the two
// foreseeability ratings, the hinted build's winnability rule, and the seeded draw of the calibration, comparison and
// reserve sets. Prompts are frozen files in prompts/; every model call is a function the caller passes in, so the tests
// make none. The rules, with the choices this file makes where the plan is silent:
//
// - Plan: GPT-6.1 Sol writes plan.md from the stubbed files (signatures and doc comments), M's implementation of the
//   region, the functional test files and the region's callers (prompts/plan-writer.md). Its input type has no fix, so F
//   never reaches it. Opus 5.5 audits it with F's message and diff (prompts/plan-audit.md) and answers CONDITION (SILENT,
//   FIXED, BUGGY or BOTH) and CODE (SIGNATURES or MORE). A draft stands when it has 200 to 500 words, CONDITION is SILENT
//   and CODE is SIGNATURES. A draft that fails gets one rewrite: the same prompt with the fixed sentence in
//   prompts/plan-retry.md, which says nothing about the fix. A rewrite that fails drops the unit (plan-audit). Whether the
//   first draft stated the buggy behavior (BUGGY or BOTH) is recorded. An answer without both lines fails the draft.
// - Hint: Sol writes one sentence from F's message and diff (prompts/hint-writer.md); Opus confirms it holds no code
//   (prompts/hint-audit.md, HINT: CLEAN or CODE). A hint stands when it is one line of 5 to 80 words ending a sentence
//   and the audit says CLEAN. The plan's rule applies: one rewrite (the same prompt), then the unit drops (hint-audit).
// - Ratings: Gemini 4 Carbon, then Opus 5.5, each with the plan, the stubbed files, the callers and the hint, never F's
//   diff (prompts/rater.md), answer FORESEE: yes, maybe or no. An answer without that line is asked once more; a second
//   one drops the unit (rater-unreadable). Both "no" keeps the unit out of the comparison draw; it can serve calibration.
// - The calls stop at the first drop, so a dropped unit spends nothing more.
// - Hinted build: one Opus build from the plan plus the hint, graded FROZEN.hinted.runs times. The unit is winnable when
//   one planted case passes in at least FROZEN.hinted.passOf runs; otherwise it drops (unwinnable). A hinted build that
//   ends in a gap drops the unit too (hinted-gap), counted apart.
// - Draw: units in the seeded order (sha256 of "<seed>/<unit id>", the seed minted from random bytes and recorded before
//   the draw). Walking it, a unit whose repository already has FROZEN.frame.perRepo drawn units is skipped; an admitted
//   unit fills calibration first (any foreseeability), then comparison (not both "no"), then reserve. Batch 1 wants 6
//   calibration and the first 20 comparison units (the pilot); batch 2, after admission, the rest. The walk stops at the
//   first unit not yet authored, so units are authored in seeded order and a later unit never displaces an earlier one.
// - Floor: when the seeded order runs out, a comparison under SIZE.floor stops (E_EP_SUPPLY_SHORT); at or above it the
//   comparison runs at the achieved number and the readings re-print the MDD.
// - Reserve: a comparison unit lost to infrastructure is replaced by the next unused reserve unit in seeded order,
//   appended after the comparison units (never a pilot unit), and the swap is recorded.
import { createHash, getRandomValues } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import { FROZEN, SIZE } from "../frozen.ts";
import type { CaseRuns, Foresee, SessionOutcome } from "../types.ts";
import type { AuthorRole } from "./local.ts";

export const PROMPTS = join(import.meta.dir, "prompts");
const prompt = (name: string) => readFileSync(join(PROMPTS, name), "utf8");

export interface SourceFile {
  path: string;
  text: string;
}

/** What authoring reads for one unit. The construct part writes it as <unit dir>/ep-author.json. */
export interface AuthorMaterial {
  /** B's region files: signatures and doc comments kept, bodies stubbed. */
  stubbed: SourceFile[];
  /** M's implementation of the region's functions: the real code before the fix. */
  implementation: SourceFile[];
  /** The functional test files. */
  tests: SourceFile[];
  /** Files that call into the region. */
  callers: SourceFile[];
  /** F: the fix's message and diff. The audits and the hint writer only. */
  fix: { message: string; diff: string };
}

/** One model call; the caller routes the role to its model (local.ts AUTHOR_MODELS) and reports what it cost. */
export type AuthorCall = (role: AuthorRole, prompt: string) => Promise<{ text: string; costUsd: number }>;

const fenceFor = (text: string) => "\x60".repeat(Math.max(3, ...[...text.matchAll(/\x60+/g)].map((m) => m[0].length + 1)));
/** Files under their paths, each in a code fence longer than any backtick run inside it. */
export const renderFiles = (files: readonly SourceFile[]): string => (files.length ? files.map((f) => "### " + f.path + "\n\n" + fenceFor(f.text) + "\n" + f.text.replace(/\s+$/, "") + "\n" + fenceFor(f.text)).join("\n\n") : "(none)");
const fill = (t: string, slots: Record<string, string>) => Object.entries(slots).reduce((s, [k, v]) => s.split("{{" + k + "}}").join(v), t);

export function planWriterPrompt(m: Omit<AuthorMaterial, "fix">, retry: boolean): string {
  return fill(prompt("plan-writer.md"), { RETRY: retry ? prompt("plan-retry.md").trimEnd() : "", STUBBED: renderFiles(m.stubbed), IMPLEMENTATION: renderFiles(m.implementation), TESTS: renderFiles(m.tests), CALLERS: renderFiles(m.callers) });
}
export const planAuditPrompt = (plan: string, fix: AuthorMaterial["fix"]): string => fill(prompt("plan-audit.md"), { PLAN: plan.trim(), FIX_MESSAGE: fix.message.trim(), FIX_DIFF: fix.diff.trim() });
export const hintWriterPrompt = (fix: AuthorMaterial["fix"]): string => fill(prompt("hint-writer.md"), { FIX_MESSAGE: fix.message.trim(), FIX_DIFF: fix.diff.trim() });
export const hintAuditPrompt = (hint: string): string => fill(prompt("hint-audit.md"), { HINT: hint.trim() });
export const raterPrompt = (plan: string, m: Pick<AuthorMaterial, "stubbed" | "callers">, hint: string): string => fill(prompt("rater.md"), { PLAN: plan.trim(), STUBBED: renderFiles(m.stubbed), CALLERS: renderFiles(m.callers), HINT: hint.trim() });

export type Condition = "SILENT" | "FIXED" | "BUGGY" | "BOTH";
const lastMatch = (answer: string, re: RegExp): string | null => {
  const hits = answer.split("\n").map((l) => re.exec(l.trim().replace(/^\*\*|\*\*$/g, ""))?.[1] ?? null).filter((x): x is string => x !== null);
  return hits.at(-1) ?? null;
};
export function parsePlanAudit(answer: string): { condition: Condition; code: "SIGNATURES" | "MORE" } | null {
  const condition = lastMatch(answer, /^CONDITION:\s*(SILENT|FIXED|BUGGY|BOTH)\s*$/i)?.toUpperCase() as Condition | undefined;
  const code = lastMatch(answer, /^CODE:\s*(SIGNATURES|MORE)\s*$/i)?.toUpperCase() as "SIGNATURES" | "MORE" | undefined;
  return condition && code ? { condition, code } : null;
}
export const parseHintAudit = (answer: string): "CLEAN" | "CODE" | null => (lastMatch(answer, /^HINT:\s*(CLEAN|CODE)\s*$/i)?.toUpperCase() as "CLEAN" | "CODE" | undefined) ?? null;
export const parseRating = (answer: string): Foresee | null => (lastMatch(answer, /^FORESEE:\s*(yes|maybe|no)\s*$/i)?.toLowerCase() as Foresee | undefined) ?? null;

export const countWords = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Why a plan draft does not stand, or null when it does. */
export function planRefusal(plan: string, audit: ReturnType<typeof parsePlanAudit>): string | null {
  if (audit === null) return "the audit's answer has no CONDITION and CODE lines";
  const n = countWords(plan);
  if (n < FROZEN.plan.minWords || n > FROZEN.plan.maxWords) return "the plan has " + n + " words, outside " + FROZEN.plan.minWords + " to " + FROZEN.plan.maxWords;
  if (audit.condition !== "SILENT") return "the plan states behavior at the planted condition (" + audit.condition + ")";
  if (audit.code !== "SIGNATURES") return "the plan holds code beyond signatures";
  return null;
}

/** Why a hint does not stand, or null when it does. */
export function hintRefusal(hint: string, audit: "CLEAN" | "CODE" | null): string | null {
  const h = hint.trim();
  if (audit === null) return "the audit's answer has no HINT line";
  if (/\n/.test(h)) return "the hint is more than one line";
  const n = countWords(h);
  if (n < 5 || n > 80) return "the hint has " + n + " words, outside 5 to 80";
  if (!/[.!?]["')\]]?$/.test(h)) return "the hint does not end a sentence";
  if (audit !== "CLEAN") return "the audit found code in the hint";
  return null;
}

export type CallsDrop = "plan-audit" | "hint-audit" | "rater-unreadable";

export interface CallsRecord {
  plan: { drafts: number; words: number; passed: boolean; reason: string | null; firstCondition: Condition | null; firstDraftStatedBug: boolean | null };
  hint: { drafts: number; passed: boolean; reason: string | null } | null;
  /** Gemini 4 Carbon first, then Opus 5.5; null when the unit dropped before the ratings. */
  foresee: [Foresee, Foresee] | null;
  drop: CallsDrop | null;
  costUsd: number;
}

/** Plan, audit, hint, audit and the two ratings for one unit, stopping at the first drop. */
export async function authorCalls(m: AuthorMaterial, call: AuthorCall): Promise<{ record: CallsRecord; plan: string | null; hint: string | null }> {
  let cost = 0;
  const ask = async (role: AuthorRole, text: string) => {
    const r = await call(role, text);
    cost += r.costUsd;
    return r.text;
  };
  const { fix, ...blind } = m;
  let plan = "";
  let firstCondition: Condition | null = null;
  let reason: string | null = null;
  let drafts = 0;
  for (; drafts < 1 + FROZEN.plan.rewrites; ) {
    plan = (await ask("writer", planWriterPrompt(blind, drafts > 0))).trim();
    const audit = parsePlanAudit(await ask("audit", planAuditPrompt(plan, fix)));
    if (drafts === 0) firstCondition = audit?.condition ?? null;
    drafts++;
    reason = planRefusal(plan, audit);
    if (reason === null) break;
  }
  const planRec = { drafts, words: countWords(plan), passed: reason === null, reason, firstCondition, firstDraftStatedBug: firstCondition === null ? null : firstCondition === "BUGGY" || firstCondition === "BOTH" };
  if (reason !== null) return { record: { plan: planRec, hint: null, foresee: null, drop: "plan-audit", costUsd: cost }, plan: null, hint: null };
  let hint = "";
  let hintReason: string | null = null;
  let hintDrafts = 0;
  for (; hintDrafts < 1 + FROZEN.plan.rewrites; ) {
    hint = (await ask("hint", hintWriterPrompt(fix))).trim();
    hintDrafts++;
    hintReason = hintRefusal(hint, parseHintAudit(await ask("hintAudit", hintAuditPrompt(hint))));
    if (hintReason === null) break;
  }
  const hintRec = { drafts: hintDrafts, passed: hintReason === null, reason: hintReason };
  if (hintReason !== null) return { record: { plan: planRec, hint: hintRec, foresee: null, drop: "hint-audit", costUsd: cost }, plan, hint: null };
  const rate = async (role: "raterCarbon" | "raterOpus") => {
    const text = raterPrompt(plan, blind, hint);
    return parseRating(await ask(role, text)) ?? parseRating(await ask(role, text));
  };
  const carbon = await rate("raterCarbon");
  const opus = carbon === null ? null : await rate("raterOpus");
  if (carbon === null || opus === null) return { record: { plan: planRec, hint: hintRec, foresee: null, drop: "rater-unreadable", costUsd: cost }, plan, hint };
  return { record: { plan: planRec, hint: hintRec, foresee: [carbon, opus], drop: null, costUsd: cost }, plan, hint };
}

/** Both raters said no: the unit leaves the comparison draw (it can still serve calibration). */
export const unforeseeable = (f: readonly [Foresee, Foresee] | null): boolean => f !== null && f[0] === "no" && f[1] === "no";

/** The hinted build's rule: winnable when a planted case passes in at least FROZEN.hinted.passOf of its runs. */
export function winnable(planted: readonly CaseRuns[]): boolean {
  return planted.some((c) => c.runs.filter((r) => r === "pass").length >= FROZEN.hinted.passOf);
}

export interface HintedVerdict {
  outcome: SessionOutcome;
  winnable: boolean | null;
  drop: "unwinnable" | "hinted-gap" | null;
  /** Passing runs per planted case. */
  passes: Record<string, number>;
}

export function hintedVerdict(outcome: SessionOutcome, planted: readonly CaseRuns[]): HintedVerdict {
  const passes = Object.fromEntries(planted.map((c) => [c.id, c.runs.filter((r) => r === "pass").length]));
  if (outcome === "upstream_gap" || outcome === "infra_gap") return { outcome, winnable: null, drop: "hinted-gap", passes };
  const w = winnable(planted);
  return { outcome, winnable: w, drop: w ? null : "unwinnable", passes };
}

// ---------------------------------------------------------------------------------------------------------------------
// The seeded draw.

/** Sixteen random bytes as hex: the draw's seed, recorded before the draw. */
export const mintSeed = (): string => Buffer.from(getRandomValues(new Uint8Array(16))).toString("hex");

export interface Candidate {
  id: string;
  /** The repository label the per-repo cap counts. */
  repo: string;
}

/** Candidates in the seeded order: by sha256 of "<seed>/<id>". */
export function seededOrder<T extends Candidate>(cands: readonly T[], seed: string): T[] {
  if (!/^[0-9a-f]{32,}$/.test(seed)) fail("E_USAGE", "the draw's seed must be the recorded hex seed, not " + JSON.stringify(seed));
  const key = (c: T) => createHash("sha256").update(seed + "/" + c.id).digest("hex");
  return [...cands].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** One authored unit as the draw reads it: admitted (plan, hint, ratings and hinted build all passed) and unforeseeable. */
export interface Authored {
  admitted: boolean;
  reason: string | null;
  unforeseeable: boolean;
}

export interface Want {
  calibration: number;
  comparison: number;
  reserve: number;
}
export const BATCH_1: Want = { calibration: SIZE.calibration, comparison: SIZE.pilotUnits, reserve: 0 };
export const BATCH_2: Want = { calibration: SIZE.calibration, comparison: SIZE.units, reserve: SIZE.reserve };

export interface Draw {
  calibration: string[];
  comparison: string[];
  reserve: string[];
  /** The first SIZE.pilotUnits comparison units. */
  pilot: string[];
  skipped: Array<{ id: string; reason: string }>;
  /** Every want is filled. */
  filled: boolean;
  /** The walk stopped at this unit, which has no authoring outcome yet; null when it did not stop on one. */
  next: string | null;
  /** The seeded order ran out before every want was filled. */
  exhausted: boolean;
}

export function drawSets(order: readonly Candidate[], authored: ReadonlyMap<string, Authored>, want: Want, perRepo: number = FROZEN.frame.perRepo): Draw {
  const d: Draw = { calibration: [], comparison: [], reserve: [], pilot: [], skipped: [], filled: false, next: null, exhausted: false };
  const perRepoCount = new Map<string, number>();
  const filled = () => d.calibration.length >= want.calibration && d.comparison.length >= want.comparison && d.reserve.length >= want.reserve;
  let i = 0;
  for (; i < order.length && !filled(); i++) {
    const c = order[i]!;
    if ((perRepoCount.get(c.repo) ?? 0) >= perRepo) {
      d.skipped.push({ id: c.id, reason: "repo-cap" });
      continue;
    }
    const a = authored.get(c.id);
    if (!a) {
      d.next = c.id;
      break;
    }
    if (!a.admitted) {
      d.skipped.push({ id: c.id, reason: a.reason ?? "dropped" });
      continue;
    }
    let set: "calibration" | "comparison" | "reserve" | null = null;
    if (d.calibration.length < want.calibration) set = "calibration";
    else if (a.unforeseeable) d.skipped.push({ id: c.id, reason: "unforeseeable" });
    else if (d.comparison.length < want.comparison) set = "comparison";
    else if (d.reserve.length < want.reserve) set = "reserve";
    if (set) {
      d[set].push(c.id);
      perRepoCount.set(c.repo, (perRepoCount.get(c.repo) ?? 0) + 1);
    }
  }
  d.filled = filled();
  d.exhausted = !d.filled && d.next === null && i >= order.length;
  d.pilot = d.comparison.slice(0, SIZE.pilotUnits);
  return d;
}

/** The floor: with the order run out, a comparison under SIZE.floor stops; at or above it the comparison runs at the
 * achieved number. Returns the line to print. */
export function supplyLine(d: Draw, want: Want): string {
  if (d.filled) return "draw filled: " + d.calibration.length + " calibration, " + d.comparison.length + " comparison (" + d.pilot.length + " pilot), " + d.reserve.length + " reserve";
  if (!d.exhausted) return "draw open: author from " + d.next + " on in seeded order";
  if (want.comparison > SIZE.pilotUnits && d.comparison.length < SIZE.floor) return fail("E_EP_SUPPLY_SHORT", "authoring admitted " + d.comparison.length + " comparison units, under the floor of " + SIZE.floor + " (" + d.calibration.length + " calibration, " + d.skipped.length + " skipped: " + summarize(d.skipped) + ")");
  if (want.comparison <= SIZE.pilotUnits && (d.calibration.length < want.calibration || d.comparison.length < want.comparison)) return fail("E_EP_SUPPLY_SHORT", "the seeded order ran out before batch 1 filled: " + d.calibration.length + " of " + want.calibration + " calibration and " + d.comparison.length + " of " + want.comparison + " pilot units (" + summarize(d.skipped) + ")");
  return "draw short of the target: the comparison runs at " + d.comparison.length + " units (floor " + SIZE.floor + "), " + d.reserve.length + " reserve; the readings re-print the MDD at that number";
}
const summarize = (s: Draw["skipped"]) => Object.entries(s.reduce<Record<string, number>>((m, x) => ({ ...m, [x.reason]: (m[x.reason] ?? 0) + 1 }), {})).map(([k, v]) => k + " " + v).join(", ") || "none";

/** Replaces comparison units lost to infrastructure with reserve units in seeded order. */
export function replaceLost(d: Pick<Draw, "comparison" | "reserve">, lost: ReadonlyArray<{ id: string; reason: string }>): { comparison: string[]; swaps: Array<{ lost: string; reason: string; by: string }>; unreplaced: string[] } {
  const gone = new Set(lost.map((l) => l.id));
  for (const l of lost) if (!d.comparison.includes(l.id)) fail("E_USAGE", "unit " + l.id + " is not a comparison unit, so no reserve replaces it");
  const reserve = [...d.reserve];
  const swaps: Array<{ lost: string; reason: string; by: string }> = [];
  const unreplaced: string[] = [];
  for (const id of d.comparison.filter((c) => gone.has(c))) {
    const by = reserve.shift();
    const reason = lost.find((l) => l.id === id)!.reason;
    if (by) swaps.push({ lost: id, reason, by });
    else unreplaced.push(id);
  }
  return { comparison: [...d.comparison.filter((c) => !gone.has(c)), ...swaps.map((s) => s.by)], swaps, unreplaced };
}

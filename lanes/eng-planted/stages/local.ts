// Copyright (c) 2026 Garry Tan. MIT License.
// Names and records the stages part defines on its own until the parent folds them into the lane's shared files
// (prereg 2026-11-15-geva-537-eng-review-planted-units-prereg). Each line says which plan section it serves.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";

/** Section 12: every lease of the attempt names this run, and every item joins this program with one skill. */
export const EP_RUN = "geva-537-ep";
export const EP_PROGRAM = "geva-537-ep";
export const EP_SKILL = "ep-run";

/** Section 3: the authoring models. The plan writer and the hint writer are GPT-6.1 Sol, the audits Opus 5.5 with no
 * tools, and the two foreseeability raters Gemini 4 Carbon and Opus 5.5 with no tools. */
export const AUTHOR_MODELS = {
  writer: "openai/gpt-6.1-sol",
  audit: "anthropic/claude-opus-5-5",
  hint: "openai/gpt-6.1-sol",
  hintAudit: "anthropic/claude-opus-5-5",
  raterCarbon: "google/gemini-4-carbon",
  raterOpus: "anthropic/claude-opus-5-5",
} as const;
export type AuthorRole = keyof typeof AUTHOR_MODELS;

/** Section 12: what one session may spend, by kind, for the admission rule. A model call has no frozen allowance; $2 is
 * a harness bound above one authoring or judge call at its output-token cap. */
export const ALLOWANCE_USD = { review: 10, build: 16, call: 2 } as const;

/** Section 3 leaves the authoring calls' output budget open: 16,000 tokens holds a reasoning model's thinking and a
 * 500-word plan, and at the routes' prices stays under the call allowance. Reasoning effort is the model's default. */
export const AUTHOR_MAX_TOKENS = 16_000;

/** Section 8 leaves the judge's output budget open too: the same 16,000 tokens at high effort. */
export const JUDGE_MAX_TOKENS = 16_000;

/**
 * Section 14: the steps a later step needs on record before it starts. Each is <run>/steps/<name>.json holding
 * { step, ok, at, detail }. The stages part writes its own; the readings part writes exposure-gate (with the arms that
 * passed), admission and start-rule.
 */
export const STEPS = ["author-batch1", "smoke", "exposure-gate", "pilot-reviews", "pilot-builds", "admission", "start-rule", "author-batch2", "comparison-reviews", "comparison-builds", "stock-builds"] as const;
export type Step = (typeof STEPS)[number];

export interface StepRecord {
  step: Step;
  ok: boolean;
  at: string;
  detail: string;
  /** exposure-gate only: the skill arms that passed. */
  arms?: string[];
}

export const stepFile = (run: string, step: Step) => join(run, "steps", step + ".json");

export function writeStep(run: string, r: Omit<StepRecord, "at">, now = new Date()): StepRecord {
  mkdirSync(join(run, "steps"), { recursive: true });
  const rec: StepRecord = { ...r, at: now.toISOString() };
  const file = stepFile(run, r.step);
  writeFileSync(file + ".tmp", JSON.stringify(rec, null, 1) + "\n");
  renameSync(file + ".tmp", file);
  return rec;
}

export function readStep(run: string, step: Step): StepRecord | null {
  const file = stepFile(run, step);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as StepRecord) : null;
}

/** Refuses to start a stage when a step it needs has no record, or a record that did not pass. */
export function requireSteps(run: string, stage: string, steps: readonly Step[]): StepRecord[] {
  return steps.map((s) => {
    const r = readStep(run, s);
    if (!r) return fail("E_USAGE", stage + " needs step " + s + " on record in " + stepFile(run, s) + ", which is missing; run the steps in section 14's order");
    if (!r.ok) return fail("E_USAGE", stage + " needs step " + s + " passed, but its record says it did not (" + r.detail + ")");
    return r;
  });
}

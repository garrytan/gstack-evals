// Copyright (c) 2026 Garry Tan. MIT License.
// The mutation score's rules (outcome-per-skill plan v3, section 3), apart from any tool. Tests the agent added or changed
// that fail on its own tree are dropped and counted. Mutants are sampled to at most SAMPLE_CAP with the frozen seed. Score =
// killed / (killed + survived), with timeouts and tool errors excluded and counted. A tree with no added or changed tests
// scores 0 ("no tests"), and so does one whose tests all fail on it, since a failing test kills every mutant.
import { createHash } from "node:crypto";
import { SAMPLE_CAP, SAMPLE_SEED, TOOLS, type Lang, type Restriction } from "./pins.ts";

/** What one sampled mutant came to. A mutant no selected test covers survived. */
export type Outcome = "killed" | "survived" | "timeout" | "error";

/**
 * scored: the score is killed / (killed + survived).
 * no-tests: the patch added or changed no test; score 0.
 * no-passing-tests: every added or changed test failed on the tree, or none ran; score 0.
 * no-mutants: the tool made no mutant within the restriction; no score.
 * no-scorable-mutants: every sampled mutant timed out or errored; no score.
 * tool-error: the patch, a container or the tool failed, so the tree has no reading; no score.
 * not-transplantable (transplant only): the agent's tests sit inside source files, so they cannot move to gold's tree.
 */
export type Status = "scored" | "no-tests" | "no-passing-tests" | "no-mutants" | "no-scorable-mutants" | "tool-error" | "not-transplantable";

export interface Counts {
  in_scope: number;
  sampled: number;
  killed: number;
  survived: number;
  timeout: number;
  error: number;
}

export interface Reading {
  status: Status;
  score: number | null;
  tests: { changed: number; passing: number; dropped: number };
  mutants: Counts;
  detail?: string;
}

export interface MutationRecord extends Reading {
  schema: 1;
  kind: "mutation-score";
  lang: Lang;
  tool: string;
  tool_version: string;
  licence: string;
  restriction: Restriction;
  cap: number;
  seed: string;
  /** The agent's tests run on gold's tree against gold's changed-line mutants, when a gold patch was given. */
  transplant?: Reading;
}

const ZERO: Counts = { in_scope: 0, sampled: 0, killed: 0, survived: 0, timeout: 0, error: 0 };

/** Up to cap ids, chosen by the order of sha256(seed, id): the same ids always give the same sample, whatever their order. */
export function sample(ids: Iterable<string>, cap: number = SAMPLE_CAP, seed: string = SAMPLE_SEED): string[] {
  const key = (id: string) => createHash("sha256").update(seed + "\0" + id).digest("hex");
  return [...new Set(ids)]
    .map((id) => [key(id), id] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, Math.max(0, cap))
    .map((x) => x[1])
    .sort();
}

export interface ReadingInput {
  changed: number;
  passing: number;
  inScope?: number;
  sampled?: string[];
  /** The outcome of each sampled mutant; a sampled mutant missing here counts as a tool error. */
  outcomes?: Map<string, Outcome>;
  toolError?: string;
  notTransplantable?: string;
}

/** Applies the rules in order: no tests, transplant refusal, tool error, no passing tests, no mutants, then the score. */
export function reading(o: ReadingInput): Reading {
  const tests = { changed: o.changed, passing: Math.min(o.passing, o.changed), dropped: Math.max(0, o.changed - o.passing) };
  if (o.changed === 0) return { status: "no-tests", score: 0, tests, mutants: { ...ZERO } };
  if (o.notTransplantable) return { status: "not-transplantable", score: null, tests, mutants: { ...ZERO }, detail: o.notTransplantable };
  if (o.toolError) return { status: "tool-error", score: null, tests, mutants: { ...ZERO, in_scope: o.inScope ?? 0, sampled: o.sampled?.length ?? 0 }, detail: o.toolError };
  if (o.passing === 0) return { status: "no-passing-tests", score: 0, tests, mutants: { ...ZERO } };
  const inScope = o.inScope ?? 0;
  if (inScope === 0) return { status: "no-mutants", score: null, tests, mutants: { ...ZERO } };
  const sampled = o.sampled ?? [];
  const counts: Counts = { ...ZERO, in_scope: inScope, sampled: sampled.length };
  for (const id of sampled) counts[o.outcomes?.get(id) ?? "error"]++;
  const scorable = counts.killed + counts.survived;
  if (scorable === 0) return { status: "no-scorable-mutants", score: null, tests, mutants: counts };
  return { status: "scored", score: counts.killed / scorable, tests, mutants: counts };
}

export function record(lang: Lang, own: Reading, transplant?: Reading, cap: number = SAMPLE_CAP, seed: string = SAMPLE_SEED): MutationRecord {
  const t = TOOLS[lang];
  return { schema: 1, kind: "mutation-score", lang, tool: t.tool, tool_version: t.version, licence: t.licence, restriction: t.restriction, cap, seed, ...own, ...(transplant ? { transplant } : {}) };
}

/** The transplant ran when the agent's tests passed on gold's tree and gold's changed lines gave mutants to score. */
export const transplantRan = (t: Reading | undefined): boolean => t !== undefined && (t.status === "scored" || t.status === "no-scorable-mutants");

/** Per-status counts over many trees, the tool-error rate the admission's instrument check reads, and how often the
 * transplant reading could run. Scores are compared only within one language, so the trees must share one. */
export function summary(records: MutationRecord[]): { lang: Lang | null; trees: number; by_status: Record<string, number>; tool_error_rate: number; transplant: { tried: number; ran: number } } {
  const langs = new Set(records.map((r) => r.lang));
  if (langs.size > 1) throw new Error("mutation scores are compared only within one language; got " + [...langs].join(", "));
  const by_status: Record<string, number> = {};
  for (const r of records) by_status[r.status] = (by_status[r.status] ?? 0) + 1;
  const tried = records.filter((r) => r.transplant !== undefined);
  return {
    lang: records[0]?.lang ?? null,
    trees: records.length,
    by_status,
    tool_error_rate: records.length ? (by_status["tool-error"] ?? 0) / records.length : 0,
    transplant: { tried: tried.length, ran: tried.filter((r) => transplantRan(r.transplant)).length },
  };
}

// A contract task's pass predicate on one final answer. The pattern rules are adapted from the scoring in skill-diet's
// scripts/eval.mjs at 5f41df1 (MIT, Copyright (c) 2026 Nico Bailon), which gstack's first diets ran on, so a task
// scores here as it scored there. Changes: split into functions that return each pattern's result. The rules:
// - quotes (" and ') are removed from the answer and from each pattern before matching;
// - patterns match case-insensitively;
// - must matches anywhere in the answer;
// - must_not matches only the lines of ``` fenced code blocks that are not comments (# or //), so "I won't run X" passes.
// The whole predicate also needs the task's check, when it has one, to exit 0 in the work dir.
import type { ContractTask } from "./tasks.ts";

export interface PatternResult {
  pattern: string;
  hit: boolean;
}

export interface AnswerScore {
  must: PatternResult[];
  must_not: PatternResult[];
}

const unquote = (text: string) => text.replace(/["']/g, "");

/** The answer's fenced code lines that are not comments, joined by newlines. */
export function codeText(answer: string): string {
  return [...answer.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1]!.split("\n"))
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join("\n");
}

/** Scores the task's patterns on an answer. Throws when a pattern no longer compiles once its quotes are removed. */
export function scoreAnswer(task: Pick<ContractTask, "must" | "must_not">, answer: string): AnswerScore {
  const text = unquote(answer);
  const code = unquote(codeText(answer));
  const test = (pattern: string, target: string) => new RegExp(unquote(pattern), "i").test(target);
  return {
    must: (task.must ?? []).map((pattern) => ({ pattern, hit: test(pattern, text) })),
    must_not: (task.must_not ?? []).map((pattern) => ({ pattern, hit: test(pattern, code) })),
  };
}

/** The assertions that held: each must that matched, each must_not that did not, and a check that exited 0. */
export function heldAssertions(score: AnswerScore, check: boolean | null): string[] {
  return [
    ...score.must.filter((r) => r.hit).map((r) => "must /" + r.pattern + "/"),
    ...score.must_not.filter((r) => !r.hit).map((r) => "must_not /" + r.pattern + "/"),
    ...(check === true ? ["check"] : []),
  ];
}

/** The whole pass predicate: every must matched, no must_not matched, and the check (null when the task has none) passed. */
export function predicateHolds(score: AnswerScore, check: boolean | null): boolean {
  return score.must.every((r) => r.hit) && score.must_not.every((r) => !r.hit) && check !== false;
}

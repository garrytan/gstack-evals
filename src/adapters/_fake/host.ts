// The keyless fake host (U7). GSTACK_EVALS_FAKE_HOST stands it in for Claude Code or Codex, so preflight, the run loop
// and U6's verdict run with no key and no model call. It runs no agent and no check: it writes each trial's record from a
// script, per arm and task, one character per trial (1 pass, 0 fail, t timeout), cycled across trials.
//
// U6 grades a fake record exactly as it grades a real one, so a passing record carries an answer the task's own must
// patterns match. The fake host samples one string per pattern, for the simple patterns task files use (literals,
// escapes, classes, groups, alternation and quantifiers), or takes the script's answer, and every record is graded on
// the spot: a record whose grade differs from the script stops the run (FakeHostError), so the fake host never reports
// an outcome U6 would not see. A failing record has no answer, a failing check and a not_done judge.
//
// GSTACK_EVALS_FAKE_HOST=1 runs DEFAULT_SCRIPT: the old copies and after pass every task, and none fails every task. Any
// other value is the path of a script file in the FakeScript shape.
import { readFileSync } from "node:fs";
import { gradeTrial, type VerdictTask } from "../../skill-eval/verdict/grade.ts";
import type { TrialRecord } from "../../types.ts";

export interface FakeScript {
  /** Outcomes per arm, one character per trial and cycled: 1 pass, 0 fail, t timeout. before2 falls back to before and placebo to none; any other arm passes. */
  arms: Record<string, string>;
  /** Outcomes per task and arm, over arms. */
  tasks?: Record<string, Record<string, string>>;
  /** Whether each arm opens its skill, one character per trial and cycled; arms with a skill default to "1". */
  opened?: Record<string, string>;
  /** A passing final answer per task, for patterns the fake host cannot sample. */
  answers?: Record<string, string>;
  /** Dollars each session reports; the run stops at --spend-cap with CAP_STOP. Defaults to 0. */
  session_usd?: number;
}

export const DEFAULT_SCRIPT: FakeScript = { arms: { before: "1", after: "1", none: "0" } };
export const HOST_MODULE = import.meta.path;
const FALLBACK: Record<string, string> = { before2: "before", placebo: "none" };
const NO_SKILL = ["none", "bare"];

export class FakeHostError extends Error {}

export function loadScript(value: string): FakeScript {
  if (value === "1") return DEFAULT_SCRIPT;
  let script: FakeScript;
  try {
    script = JSON.parse(readFileSync(value, "utf8"));
  } catch (error) {
    throw new FakeHostError("GSTACK_EVALS_FAKE_HOST is neither 1 nor a readable script file: " + value + " (" + (error as Error).message + ")");
  }
  if (!script || typeof script.arms !== "object" || script.arms === null) throw new FakeHostError(value + ": a fake-host script needs an arms object");
  return script;
}

const ESCAPES: Record<string, string> = { b: " ", d: "1", D: "x", s: " ", S: "x", w: "a", W: " ", n: "\n", t: "\t" };

/** A string the pattern matches, for the simple patterns task files use; null for a construct it does not handle. */
export function sampleMatch(pattern: string): string | null {
  let i = 0;
  let unknown = false;
  const escape = (): string => {
    const e = pattern[i++] ?? "";
    if (e in ESCAPES) return ESCAPES[e]!;
    if (/[A-Za-z0-9]/.test(e)) unknown = true;
    return e;
  };
  const atom = (): string => {
    const c = pattern[i++]!;
    if (c === "\\") return escape();
    if (c === "[") {
      const negated = pattern[i] === "^";
      if (negated) i++;
      const members: string[] = [];
      while (i < pattern.length && (pattern[i] !== "]" || !members.length)) members.push(pattern[i] === "\\" ? (i++, escape()) : pattern[i++]!);
      i++;
      if (!negated) return members[0] ?? "";
      return ["x", "a", "1", " "].find((x) => !members.includes(x)) ?? ((unknown = true), "");
    }
    if (c === "(") {
      if (pattern[i] === "?") {
        if (pattern[i + 1] !== ":") return (unknown = true), "";
        i += 2;
      }
      const inner = alternatives();
      if (pattern[i++] !== ")") unknown = true;
      return inner;
    }
    if (c === ".") return "x";
    if (c === "^" || c === "$") return "";
    return c;
  };
  const sequence = (): string => {
    let out = "";
    while (i < pattern.length && pattern[i] !== "|" && pattern[i] !== ")") {
      let a = atom();
      const q = pattern[i];
      const counted = q === "{" ? /^\{(\d+)(,\d*)?\}/.exec(pattern.slice(i)) : null;
      if (q === "*" || q === "?") (a = ""), i++;
      else if (q === "+") i++;
      else if (counted) (a = a.repeat(Number(counted[1]))), (i += counted[0].length);
      if ((q === "*" || q === "?" || q === "+" || counted) && pattern[i] === "?") i++;
      out += a;
    }
    return out;
  };
  const alternatives = (): string => {
    const first = sequence();
    while (pattern[i] === "|") i++, sequence();
    return first;
  };
  const out = alternatives();
  return unknown || i < pattern.length ? null : out;
}

function pick(script: FakeScript, task: string, arm: string, trial: number): string {
  const fallback = FALLBACK[arm];
  const pattern = script.tasks?.[task]?.[arm] ?? (fallback ? script.tasks?.[task]?.[fallback] : undefined) ?? script.arms[arm] ?? (fallback ? script.arms[fallback] : undefined) ?? "1";
  const ch = pattern[trial % pattern.length];
  if (ch !== "1" && ch !== "0" && ch !== "t") throw new FakeHostError("fake-host script: " + JSON.stringify(pattern) + " for " + task + " in " + arm + " must use only 1, 0 and t");
  return ch;
}

export interface FakeCell {
  model: string;
  arm: string;
  task: VerdictTask;
  round: 1 | 2;
  trial: number;
}

/** One trial's record from the script, graded on the spot so it can only carry the outcome the script asked for. */
export function fakeRecord(cell: FakeCell, script: FakeScript): TrialRecord {
  const { task, arm } = cell;
  const ch = pick(script, task.id, arm, cell.trial);
  const pass = ch === "1";
  let answer = "";
  if (pass) {
    const samples = task.must.map(sampleMatch);
    answer = script.answers?.[task.id] ?? (samples.includes(null) ? "" : ["Done.", ...samples].join(" ; "));
  }
  const openedPattern = script.opened?.[arm] ?? "1";
  const opened = NO_SKILL.includes(arm) ? null : openedPattern[cell.trial % openedPattern.length] === "1";
  const record: TrialRecord = {
    model: cell.model, arm, task: task.id, round: cell.round, trial: cell.trial,
    termination: ch === "t" ? { kind: "timeout" } : { kind: "completed" },
    turns: answer ? [answer] : [],
    check: task.check && ch !== "t" ? pass : null,
    judge: task.judge && ch !== "t" ? (pass ? "done" : "not_done") : null,
    opened,
    files_read: opened ? ["SKILL.md"] : [],
    asked: [],
    usage: null,
    cost_micros: Math.round((script.session_usd ?? 0) * 1_000_000),
    wall_ms: null, agent_turns: null, loaded_bytes: null, metrics: {},
  };
  const outcome = gradeTrial(task, record).outcome;
  const wanted = ch === "t" ? "timeout" : pass ? "pass" : "fail";
  if (outcome !== wanted) throw new FakeHostError("the fake host cannot write a run of task " + task.id + " that grades " + wanted + " (it grades " + outcome + "); give a passing answer under answers in a script file (GSTACK_EVALS_FAKE_HOST=<script.json>)");
  return record;
}

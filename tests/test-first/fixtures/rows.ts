// Copyright (c) 2026 Garry Tan. MIT License.
// B2 session rows for the keyless tests: one row per model, arm and task, each outcome set by a rule on the task's index.
import { labelOf, MODELS, type Arm, type ModelKey } from "../../../lanes/test-first/pins.ts";
import type { B2Row } from "../../../lanes/test-first/table.ts";

export type Cell = { pass?: boolean; reg?: boolean; followed?: boolean; outcome?: B2Row["outcome"] };
export function row(m: ModelKey, arm: Arm, task: string, c: Cell = {}, repo = "repo-" + task, extra: Partial<B2Row> = {}): B2Row {
  const host = MODELS[m].host, outcome = c.outcome ?? "graded";
  return {
    schema: "b2-session/1", host, label: labelOf(host, arm), arm, part: "b2-1", task, repo, trial: task + "__" + labelOf(host, arm) + "__" + m,
    model: MODELS[m].id, cli_version: null, sdk_version: null, effort: null, metered_effort: m === "sol" ? ["low"] : null, outcome, reason: outcome, pass: outcome === "graded" && !!c.pass, reward: outcome === "graded" ? Number(!!c.pass) : null,
    test_files: c.reg ? ["tests/test_x.py"] : [], touches_test: !!c.reg, regression_test: outcome === "graded" && !!c.pass && !!c.reg, root_only: false,
    followed: !!c.followed, followed_b2: outcome === "graded" ? !!c.followed : null, followed_as_merged: !!c.followed, detect: null, unreadable_items: host === "codex" ? 0 : null,
    steps_seen: arm === "prove-it", line_seen: arm === "line", skills_listed: [], prove_it_loads: arm === "prove-it" ? 1 : 0, gstack_loads: [], routing_named: arm === "gstack" || arm === "prove-it" ? ["prove-it"] : null,
    start_seen: arm === "prove-it", questions: 0, cost_usd: 0.1, tokens: 1000, wall_s: 60, allowance_stop: false, turn_cap: false, time_stop: false, safety_stop: false, audit: arm === "none" || arm === "line" ? 0 : null,
    ...extra,
  };
}
/** n tasks t0..t(n-1) in 10 repositories, every arm of every model given, the cell set by rule(model, arm, i). */
export function table(n: number, rule: (m: ModelKey, a: Arm, i: number) => Cell, models: ModelKey[] = ["opus", "sol", "p1"]): B2Row[] {
  const arms: Arm[] = ["none", "line", "gstack", "prove-it"];
  return models.flatMap((m) => arms.flatMap((a) => Array.from({ length: n }, (_, i) => row(m, a, "t" + i, rule(m, a, i), "repo-" + (i % 10)))));
}

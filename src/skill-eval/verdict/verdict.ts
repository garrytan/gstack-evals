// verdict.json (interface v0.4, "verdict.json"): a superset of gstack's contract verdict file. The contract's fields keep
// their names and shapes: verdict, reasons ("CODE subject" strings), harness_version, model, trials, calibration, arms,
// tasks and adjudication. A run with several models lists them in model, comma-separated, and gives the first model's
// arms and tasks there, as the contract describes one model; every model has its own block under models. A grade the
// run could not record (a timeout or a missing cell) is null in a tasks array. The contract's UNCOVERED is BROKEN_TASK.
//
// gstack-evals' fields sit beside them, and schema/verdict.schema.json describes all of it. rig is reserved for U20 (CI
// plan v5): the recipe hash U9's cache key also takes. The engine writes what the caller hands it, null until rig admit
// exists. Money in spend is integer micro-dollars; the contract's cost_usd is dollars.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CalibrationResult, Host, RigBlock, TrialRecord } from "../../types.ts";
import { writeAtomic } from "./error-record.ts";
import { reasonText, type Decision, type ModelVerdict, type VerdictInput, type VerdictOptions } from "./gates.ts";

export const VERDICT_FILE = "verdict.json";

/** What the CLI (U7) and the trial module (U9) know about the run that the verdict records as given. */
export interface VerdictContext {
  verdict_id: string;
  /** The contract's harness_version: the gstack-evals version that ran. */
  harness_version: string;
  /** Scheduled trials per cell. */
  trials: number;
  effective: { noise_floor: boolean; parallel: number; timeout_s: number; judge_model: string | null; isolation: "docker" | "process"; policy_sha256: string | null; base: string | null; skill: string | null };
  harness: { host: Host; host_version: string | null; gstack_evals_version: string; adapter_sha256: string | null; image_digest: string | null; base: string | null };
  /** Each arm's installed-tree sha256 (a loadout's resolved tree). */
  arm_trees: Record<string, string>;
  lock: { tasks_sha256: string; ext_sha256: string | null; commit: string | null; post_hoc: boolean } | null;
  /** Tokens per level, before and after. */
  levels: Record<"description" | "skill_md" | "references", { before: number; after: number }> | null;
  spend: {
    ledger: string;
    ledger_record: string;
    committed: number;
    reserved: number;
    /** Calls whose outcome is unknown. */
    unknown: number;
    cap: number;
    line_item: string | null;
    lease_id: string | null;
    approval: { words: string; by: string; source: string } | null;
    caps_history: number[];
  } | null;
  adjudication: { blinded: boolean; judge_model: string | null };
  resumed_from: string | null;
  /** Seconds from the first command to the verdict. */
  wall_s: number | null;
  rig: RigBlock | null;
}

const mean = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

function armBlock(records: readonly TrialRecord[], outcomes: readonly (boolean | null)[]) {
  const graded = outcomes.filter((o): o is boolean => o !== null);
  const usage = records.flatMap((r) => (r.usage ? [r.usage] : []));
  const opened = records.flatMap((r) => (r.opened === null ? [] : [r.opened]));
  const costs = records.flatMap((r) => (r.cost_micros === null ? [] : [r.cost_micros]));
  const files: Record<string, number> = {};
  for (const r of records) for (const f of new Set(r.files_read)) files[f] = (files[f] ?? 0) + 1;
  const tokens = (key: keyof (typeof usage)[number]) => mean(usage.map((u) => u[key]))!;
  const wall = mean(records.map((r) => r.wall_ms));
  return {
    pass_rate: graded.length ? graded.filter(Boolean).length / graded.length : null,
    tokens_per_run: usage.length ? { input: tokens("input"), output: tokens("output"), reasoning: tokens("reasoning"), cache_read: tokens("cache_read"), cache_write: tokens("cache_write") } : null,
    turns_per_run: mean(records.map((r) => r.agent_turns)),
    opened_skill_rate: opened.length ? opened.filter(Boolean).length / opened.length : null,
    files_loaded: files,
    cost_usd: costs.length ? costs.reduce((s, c) => s + c, 0) / 1e6 : null,
    sessions: records.length,
    graded: graded.length,
    timeouts: records.filter((r) => r.termination.kind === "timeout").length,
    excluded: records.filter((r) => r.termination.kind === "infra").length,
    loaded_bytes_per_run: mean(records.map((r) => r.loaded_bytes)),
    wall_s_per_run: wall === null ? null : wall / 1000,
  };
}

function modelBlock(input: VerdictInput, m: ModelVerdict) {
  const own = input.records.filter((r) => r.model === m.model);
  return {
    model: m.model,
    verdict: m.verdict,
    exit_code: m.exit_code,
    reasons: m.reasons.map(reasonText),
    warnings: m.warnings.map(reasonText),
    calibration: m.calibration,
    informative_tasks: m.informative,
    ceiling_tasks: m.ceiling_tasks,
    not_measurable_tasks: m.not_measurable_tasks,
    at_ceiling: m.at_ceiling,
    session_kind: Object.fromEntries(input.tasks.map((t) => [t.id, t.interactive ? "interactive" : "unattended"])),
    arms: Object.fromEntries(input.arms.map((arm) => [arm, armBlock(own.filter((r) => r.arm === arm), input.tasks.flatMap((t) => m.outcomes[t.id]![arm]!))])),
    tasks: m.outcomes,
    opened: m.opened,
    worse: m.worse,
    comparison: m.comparison,
    margin: m.margin,
    noninferior: m.margin?.noninferior ?? null,
    smallest_detectable_loss: m.smallest_detectable_loss,
    rerun: m.rerun,
    gate: m.gate,
    metrics: m.metrics,
    disputes: m.disputes,
  };
}

function combined(results: readonly CalibrationResult[]): CalibrationResult {
  const keys = ["skill", "none", "shell", "config", "usersim", "egress"] as const;
  return Object.fromEntries(keys.map((k) => {
    const values = results.map((r) => r[k]);
    return [k, values.includes(false) ? false : values.every((v) => v === null) ? null : true];
  })) as unknown as CalibrationResult;
}

export function buildVerdict(input: VerdictInput, decision: Decision, context: VerdictContext, options: VerdictOptions) {
  const blocks = decision.models.map((m) => modelBlock(input, m));
  const several = decision.models.length > 1;
  const mdds = decision.models.map((m) => m.smallest_detectable_loss.mdd_points);
  const noninferior = decision.models.map((m) => m.margin?.noninferior ?? null);
  return {
    verdict: decision.verdict,
    reasons: decision.reasons,
    harness_version: context.harness_version,
    model: input.models.join(","),
    trials: context.trials,
    calibration: combined(decision.models.map((m) => m.calibration)),
    arms: blocks[0]!.arms,
    tasks: blocks[0]!.tasks,
    adjudication: { ...context.adjudication, disputed: decision.models.flatMap((m) => m.disputes.map((d) => d + (several ? " on " + m.model : ""))) },
    schema_version: 1 as const,
    verdict_id: context.verdict_id,
    exit_code: decision.exit_code,
    warnings: decision.warnings,
    resumable: decision.resumable,
    smallest_detectable_loss: {
      sign_flip_tasks: decision.models.every((m) => m.smallest_detectable_loss.sign_flip_tasks !== null) ? decision.models[0]!.smallest_detectable_loss.sign_flip_tasks : null,
      mdd_points: mdds.includes(null) ? null : Math.max(...(mdds as number[])),
    },
    noninferior: options.margin_points === null ? null : noninferior.includes(false) ? false : noninferior.every((v) => v === true) ? true : null,
    effective: { trials: context.trials, ...context.effective, margin: options.margin_points, seed: options.seed, draws: options.draws, missing_cell_rule: options.missing, simulations: options.simulations },
    harness: context.harness,
    arm_trees: context.arm_trees,
    lock: context.lock,
    lock_drift: decision.lock?.drift ?? [],
    contract_lines_removed: decision.lock?.removed ?? null,
    models: blocks,
    levels: context.levels,
    spend: context.spend,
    resumed_from: context.resumed_from,
    wall_s: context.wall_s,
    rig: context.rig,
  };
}

export type VerdictFile = ReturnType<typeof buildVerdict>;

/** Writes <out>/verdict.json atomically and returns its path. */
export function writeVerdict(out: string, verdict: VerdictFile): string {
  mkdirSync(out, { recursive: true });
  const path = join(out, VERDICT_FILE);
  writeAtomic(path, verdict);
  return path;
}

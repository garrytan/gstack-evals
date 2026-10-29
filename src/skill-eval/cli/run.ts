// The run on the fake host (U7): round 1 in arm-balanced rounds, the same-tree rerun stage when round 1 has a red task,
// then U6's verdict, written to <out>/verdict.json, with U6's exit code. A round that would pass the spend cap is not
// started, so a cap stop keeps only complete paired cells (CAP_STOP). U9's trial module and U10's adapters replace the
// fake records with real sessions; the verdict path stays the same.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Io } from "../../cli.ts";
import { fakeRecord, HOST_MODULE, type FakeScript } from "../../adapters/_fake/host.ts";
import { usd } from "../../runner/ledger/money.ts";
import type { CalibrationResult, TrialRecord } from "../../types.ts";
import { decide, DEFAULT_OPTIONS, rerunPlan, type Stop, type VerdictInput } from "../verdict/gates.ts";
import type { VerdictTask } from "../verdict/grade.ts";
import type { GateEvidence } from "../verdict/lock.ts";
import { buildVerdict, writeVerdict, type VerdictContext, type VerdictFile } from "../verdict/verdict.ts";

export interface RunPlan {
  models: string[];
  arms: string[];
  tasks: VerdictTask[];
  trials: number;
  /** Micro-dollars; null for no cap. */
  cap: number | null;
  gate?: GateEvidence;
}

export interface FakeRun {
  input: VerdictInput;
  /** Micro-dollars the sessions reported. */
  spent: number;
  stopped: boolean;
}

export const FAKE_ADAPTER_SHA256 = createHash("sha256").update(readFileSync(HOST_MODULE)).digest("hex");

export function runFake(plan: RunPlan, script: FakeScript): FakeRun {
  const records: TrialRecord[] = [];
  const stops: Stop[] = [];
  let spent = 0;
  const round = (r: 1 | 2): boolean => {
    for (let trial = 0; trial < plan.trials; trial++) {
      const batch = plan.models.flatMap((model) => plan.tasks.flatMap((task) => plan.arms.map((arm) => fakeRecord({ model, arm, task, round: r, trial }, script))));
      const cost = batch.reduce((s, b) => s + (b.cost_micros ?? 0), 0);
      if (plan.cap !== null && spent + cost > plan.cap) {
        stops.push({ code: "CAP_STOP", model: null, subject: null });
        return false;
      }
      records.push(...batch);
      spent += cost;
    }
    return true;
  };
  const calibration: CalibrationResult = { skill: true, none: plan.arms.includes("none") ? true : null, shell: true, config: null, usersim: plan.tasks.some((t) => t.interactive) ? true : null, egress: true };
  const input: VerdictInput = { tasks: plan.tasks, models: plan.models, arms: plan.arms, records, calibration: Object.fromEntries(plan.models.map((m) => [m, calibration])), stops, ...(plan.gate ? { gate: plan.gate } : {}) };
  if (round(1) && rerunPlan(input).length) round(2);
  return { input, spent, stopped: stops.length > 0 };
}

/** The verdict's stdout summary: the verdict, its reasons and warnings, each task's passes per arm, and the file. */
export function verdictLines(v: VerdictFile, path: string): string[] {
  const width = Math.max(...Object.keys(v.tasks).map((id) => id.length));
  const passes = (runs: readonly (boolean | null)[]) => runs.filter((r) => r === true).length + "/" + runs.filter((r) => r !== null).length;
  return [
    "VERDICT: " + v.verdict + " (exit " + v.exit_code + ") for " + v.model + ", " + v.trials + " trials",
    "reasons: " + (v.reasons.length ? v.reasons.join(", ") : "none"),
    ...(v.warnings.length ? ["warnings: " + v.warnings.join(", ")] : []),
    ...Object.entries(v.tasks).map(([id, arms]) => "  " + id.padEnd(width) + "  " + Object.entries(arms).map(([arm, runs]) => arm + " " + passes(runs)).join("  ")),
    "verdict.json: " + path,
  ];
}

/** Decides with U6's engine, writes <out>/verdict.json and prints the summary (or the verdict with --json); returns U6's exit code. */
export function finishRun(run: FakeRun, context: VerdictContext, out: string, io: Io, json: boolean): number {
  const decision = decide(run.input, DEFAULT_OPTIONS);
  const verdict = buildVerdict(run.input, decision, context, DEFAULT_OPTIONS);
  const path = writeVerdict(out, verdict);
  if (run.stopped && context.spend && !json) io.out("STOP: reason=budget_exhausted spent=" + usd(run.spent) + " reserved=" + usd(context.spend.reserved) + " unknown=" + context.spend.unknown + " cap=" + usd(context.spend.cap));
  io.out(json ? JSON.stringify(verdict) : verdictLines(verdict, path).join("\n"));
  return decision.exit_code;
}

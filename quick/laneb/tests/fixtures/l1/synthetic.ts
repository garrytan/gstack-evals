// Synthetic L1 session tables for the analysis tests: deterministic rows, the first k tasks of an arm carry a metric.
import type { L1Arm, L1Instrument, L1SessionRow } from "../../../../../src/types.ts";
import type { AuditLabel, Config } from "../../../l1/analyze.ts";
import { PROBES_SHA256 } from "../../../l1/table.ts";

export const TASKS = Array.from({ length: 80 }, (_, i) => "own" + (i % 25) + "__repo" + (i % 25) + "-" + (100 + i));
export const PILOT = Array.from({ length: 10 }, (_, i) => "pilot" + i + "__p-" + i);
export const ARMS: L1Arm[] = ["none", "before-u", "after-u", "before-t", "after-t", "off-u", "off-t"];

export function row(model: string, instrument: L1Instrument, arm: L1Arm, task: string, extra: Partial<L1SessionRow> = {}): L1SessionRow {
  return {
    schema: "l1-session/1", model, instrument, part: null, arm, task, repo: task.replace(/-\d+$/, ""), trial: [instrument, arm, task].join("/"),
    outcome: "graded", pass: false, reward: 0, allowance_stop: false, turn_cap: false, reason: "graded", cost_usd: 0.5, tokens: 1000,
    load_investigate: false, gstack_loads: [], repo_loads: [], skill_unresolved: 0, complete: false,
    probe_i: { report: false, fix_edited: false, status: false, check_after_edit: false, edits: 1 },
    background_at_result: false, contract_block: false, route_hook: true, contract_record: true, contract_check_met: null, audit_hits: [], probes_sha256: PROBES_SHA256, ...extra,
  };
}

export type Counts = Partial<Record<L1Arm, { load?: number; complete?: number; pass?: number }>>;

/** F1 on tasks with each arm's metric true on its first k tasks, and the pilot's before arms on their first k tasks. */
export function table(o: { model?: string; f1?: Counts; pilot?: { load?: number; complete?: number }; tasks?: string[]; extra?: (arm: L1Arm, i: number) => Partial<L1SessionRow> } = {}): L1SessionRow[] {
  const model = o.model ?? "opus";
  const tasks = o.tasks ?? TASKS;
  const out: L1SessionRow[] = [];
  for (const arm of ARMS) {
    const c = o.f1?.[arm] ?? {};
    tasks.forEach((t, i) => {
      const pass = i < (c.pass ?? 0);
      out.push(row(model, "f1", arm, t, { load_investigate: i < (c.load ?? 0), complete: i < (c.complete ?? 0), pass, reward: pass ? 1 : 0, ...(o.extra?.(arm, i) ?? {}) }));
    });
  }
  PILOT.forEach((t, i) => {
    out.push(row(model, "pilot", "before-u", t, { load_investigate: i < (o.pilot?.load ?? 0) }));
    out.push(row(model, "pilot", "before-t", t, { complete: i < (o.pilot?.complete ?? 0) }));
  });
  return out;
}

export const passingAudit = (model = "opus"): AuditLabel[] =>
  (["L", "I"] as const).flatMap((probe) => Array.from({ length: 40 }, (_, i) => ({ probe, model, trial: probe + i, probe_value: i < 20, reader_value: i < 20 })));

export const config = (extra: Partial<Config> = {}): Config => ({
  models: [{ id: "opus", status: "run" }], f1_tasks: TASKS, pilot_tasks: PILOT, tb2_tasks: [], routed_stratum: TASKS.slice(0, 40), construction_checks: true, audit: passingAudit(), ...extra,
});

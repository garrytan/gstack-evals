// Copyright (c) 2026 Garry Tan. MIT License.
// S10 acting rates (prereg section 11): per cell and decision type, the share of decisions settled at each layer,
// no-answers and retries, wrong acts (a decision acted on below the main model, by Jev or particle-1, that its grounded
// label marks wrong), the fix-file drop rate; per cell, decider questions per session, blocked commands and stops by kind.
// Labels: relevance a list of fix-edited hits, tests_passed and done a boolean, safe a boolean "unsafe".
// Acts as dr_agent logs them (routed.py): safe "allowed" (yes) or "blocked" (no); tests_passed "passed" (yes), "failed"
// (no) or "unknown", which is never a negative and drops from labelled acts, counted; done "done" (yes) or "not_done"
// (no). An act below main with any other value throws. Prereg line 207: a decision whose decider call failed after its
// retry (a layer with ok false) counts toward its cell's failure share, and over 5% marks the cell DR_CELL_DEGRADED.

export interface ActingRow { cell: string; type: string; n: number; by_layer: Record<string, number>; no_answers: number; retries: number; wrong_acts: number; labelled_acts: number; unknown_acts: number; fix_hits: number; fix_dropped: number }
export interface CellRow { cell: string; sessions: number; decider_questions_per_session: number; blocked_commands: number; stops: Record<string, number> }
export interface FailureRow { model: string; cell: string; decisions: number; failed: number; share: number; degraded: boolean }

const BELOW_MAIN = new Set(["jev", "particle"]);
const DECIDER_LAYERS = ["jev", "particle", "particle_noguess"];
const ACTS: Record<string, Record<string, boolean | null>> = {
  safe: { allowed: true, blocked: false },
  tests_passed: { passed: true, failed: false, unknown: null },
  done: { done: true, not_done: false },
};
export const DEGRADED_SHARE = 0.05;

function wrongAct(type: string, acted: unknown, label: unknown): boolean | "unknown" | null {
  if (type === "relevant") return label === null || label === undefined ? null : Array.isArray(acted) && Array.isArray(label) && acted.some((h) => label.includes(h));
  const acts = ACTS[type];
  if (!acts) return null;
  const yes = typeof acted === "string" && Object.hasOwn(acts, acted) ? acts[acted] : undefined;
  if (yes === undefined) throw new Error("a " + type + " decision acted " + JSON.stringify(acted) + " below the main model; dr_agent logs only " + Object.keys(acts).join(", "));
  if (label === null || label === undefined) return null;
  if (yes === null) return "unknown";
  return type === "safe" ? yes === label : yes !== label;
}

export function actingRates(decisions: ReadonlyArray<Record<string, any>>, summaries: ReadonlyArray<Record<string, any>>, labels: ReadonlyMap<string, unknown> = new Map()): { rows: ActingRow[]; cells: CellRow[] } {
  const rows = new Map<string, ActingRow & { layers: Record<string, number> }>();
  const questions = new Map<string, number>();
  for (const d of decisions) {
    const key = d.cell + "\u0000" + d.type;
    const r: ActingRow & { layers: Record<string, number> } = rows.get(key) ?? { cell: d.cell, type: d.type, n: 0, by_layer: {}, layers: {}, no_answers: 0, retries: 0, wrong_acts: 0, labelled_acts: 0, unknown_acts: 0, fix_hits: 0, fix_dropped: 0 };
    r.n++;
    r.layers[d.acting_layer] = (r.layers[d.acting_layer] ?? 0) + 1;
    const layers = Object.entries(d.layers ?? {}) as Array<[string, any]>;
    for (const [, l] of layers) { if (l.ok === false) r.no_answers++; r.retries += l.retries ?? 0; }
    if (layers.some(([name]) => DECIDER_LAYERS.includes(name))) questions.set(d.cell, (questions.get(d.cell) ?? 0) + 1);
    const label = labels.get(d.decision_id);
    if (BELOW_MAIN.has(d.acting_layer)) {
      const wrong = wrongAct(d.type, d.acted, label);
      if (wrong === "unknown") r.unknown_acts++;
      else if (wrong !== null) { r.labelled_acts++; if (wrong) r.wrong_acts++; }
    }
    if (d.type === "relevant" && Array.isArray(label)) {
      r.fix_hits += label.length;
      if (Array.isArray(d.acted)) r.fix_dropped += label.filter((h) => d.acted.includes(h)).length;
    }
    rows.set(key, r);
  }
  const cells = new Map<string, CellRow>();
  for (const s of summaries) {
    const c: CellRow = cells.get(s.cell) ?? { cell: s.cell, sessions: 0, decider_questions_per_session: 0, blocked_commands: 0, stops: {} };
    c.sessions++;
    c.blocked_commands += s.blocked_commands ?? 0;
    c.stops[s.exit_status] = (c.stops[s.exit_status] ?? 0) + 1;
    cells.set(s.cell, c);
  }
  for (const c of cells.values()) c.decider_questions_per_session = (questions.get(c.cell) ?? 0) / c.sessions;
  return {
    rows: [...rows.values()].map(({ layers, ...r }) => ({ ...r, by_layer: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v / r.n])) })),
    cells: [...cells.values()],
  };
}

/** Per creative model and cell: decisions with a decider call that failed after its retry (any layer with ok false,
 *  except a Jev layer skipped as state_over_limit, which made no call), over all the cell's decisions; degraded when the share is strictly over 5%. */
export function deciderFailures(decisions: ReadonlyArray<Record<string, any>>): FailureRow[] {
  const rows = new Map<string, FailureRow>();
  for (const d of decisions) {
    const k = d.model + " " + d.cell;
    const r = rows.get(k) ?? { model: d.model, cell: d.cell, decisions: 0, failed: 0, share: 0, degraded: false };
    r.decisions++;
    if (Object.values(d.layers ?? {}).some((l: any) => l?.ok === false && l.error !== "state_over_limit")) r.failed++;
    rows.set(k, r);
  }
  return [...rows.values()].map((r) => ({ ...r, share: r.failed / r.decisions, degraded: r.failed / r.decisions > DEGRADED_SHARE })).sort((x, y) => (x.model + x.cell).localeCompare(y.model + y.cell));
}

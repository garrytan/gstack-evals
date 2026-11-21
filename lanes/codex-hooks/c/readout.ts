// Copyright (c) 2026 Garry Tan. MIT License.
// Part C's readout over one item's review-units run (<root>/<item>): per session its states (section 5.3), exposure and
// pilot flags (section 5.6, pre-run change 1, section 7) and outcome (section 5.8); per arm the counts the pilot readout
// releases (section 9). It reads only what the run wrote: cells.ndjson, cells-attempt1.ndjson (sessions moved aside for
// their one rerun), the proxy's journal and each session's host dir. It calls no model.
//
// Files, under <root>/<item>/readout/: states.jsonl and states-blind.jsonl (states.ts), exposure.jsonl (one line per
// session: the cell, its exposure and its flags), outcomes.jsonl (one per session attempt, the planned cells that never ran
// as not_run) and summary.json.
//
// summary.json, per arm: the sessions planned and found, the outcome classes, scored and not scored, and INCOMPLETE (a cap
// stop in the item, or more than 7 of a counted arm's sessions not scored); on a pilot item, supplied (every planned session
// scored after at most one rerun). Exposure: sessions blocked, the items blocks named, sessions with a false block or a
// fail-open, sessions where every stop was evaluated, the pass before a block, only after one or never, sessions the
// contract would have blocked at their first stop, and sessions whose log and rollout disagree on the blocks. Flags: the
// sessions with each pilot flag, and the lines the Captain hears before c-main spends. Costs: mean, median and 95th
// percentile in dollars, and whether the 95th percentile passes half the allowance (section 5.7 doubles them then). Two
// sessions per arm, by seed, for the hand reading. It releases no found rate.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seeded } from "../../../quick/laneb/l1/l1.ts";
import { readJournalLines } from "../../../src/trial/review/cost.ts";
import { sessionDir } from "../../../src/trial/review/run.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";
import { exposure, pilotFlags, readContractLog, type Exposure, type Flags } from "./contract.ts";
import { outcome, type OutcomeRow } from "./outcomes.ts";
import { CONTRACT_ARMS, INCOMPLETE_ABOVE, ITEMS, MODEL, PASSES, SEED, type ItemName } from "./pins.ts";
import { readSessionRollouts } from "./rollout.ts";
import { blindKey, blindRows, sessionStates, type Cell, type StateRow } from "./states.ts";

export interface UnitRef {
  id: string;
  repo: string;
  pr: number;
  head: string;
}

type Entry = { cell: Cell; meter_id: string; record: { termination: { kind: string; code?: string } }; cost?: { all?: { spent_micros?: number } } | null; codex?: { allowance_stops?: number } };

const readCells = (file: string): Entry[] =>
  existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Entry) : [];
const cellKey = (c: Cell) => [c.model, c.arm, c.unit, c.pass].join("\t");
const jsonl = (rows: readonly unknown[]) => rows.map((r) => JSON.stringify(r) + "\n").join("");
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!;
};

export interface SessionReadout {
  cell: Cell;
  attempt: number;
  /** An attempt 1 that was moved aside for its rerun (cells-attempt1.ndjson, <dir>-attempt1). */
  moved: boolean;
  dir: string;
  states: StateRow[];
  exposure: Exposure;
  flags: Flags;
  outcome: OutcomeRow;
  usd: number | null;
}

/** Every session attempt one item's run holds, and the planned cells it does not. */
export function readItem(root: string, item: ItemName, units: readonly UnitRef[], key: Buffer): { sessions: SessionReadout[]; notRun: Cell[] } {
  const out = join(root, item);
  const journal = readJournalLines(join(out, "proxy", "journal.ndjson"));
  const byId = new Map(units.map((u) => [u.id, u]));
  const read = (e: Entry, attempt: number, moved: boolean): SessionReadout => {
    const u = byId.get(e.cell.unit);
    if (!u) throw new Error("E_USAGE codex-hooks c readout: cells.ndjson names unit " + e.cell.unit + ", which the item does not run");
    const base = sessionDir(out, e.cell.model, e.cell.arm, unitTaskId(u), e.cell.pass);
    const dir = moved ? base + "-attempt1" : base;
    const host = join(dir, "host");
    const rollouts = readSessionRollouts(host);
    const cell = { model: e.cell.model, arm: e.cell.arm, unit: e.cell.unit, pass: e.cell.pass };
    return {
      cell, attempt, moved, dir,
      states: sessionStates(cell, rollouts, key),
      exposure: exposure(rollouts, readContractLog(host)),
      flags: pilotFlags(rollouts),
      outcome: outcome({ cell, attempt, termination: e.record.termination, allowance_stops: e.codex?.allowance_stops ?? 0, meter_id: e.meter_id, rollouts, journal }),
      usd: typeof e.cost?.all?.spent_micros === "number" ? e.cost.all.spent_micros / 1e6 : null,
    };
  };
  const first = readCells(join(out, "cells-attempt1.ndjson")).map((e) => read(e, 1, true));
  const firstKeys = new Set(first.map((s) => cellKey(s.cell)));
  const current = readCells(join(out, "cells.ndjson")).map((e) => read(e, firstKeys.has(cellKey(e.cell)) ? 2 : 1, false));
  const p = ITEMS[item];
  const have = new Set(current.map((s) => cellKey(s.cell)));
  const notRun = units.flatMap((u) => p.arms.flatMap((arm) => Array.from({ length: PASSES[p.phase] }, (_, i) => ({ model: MODEL, arm, unit: u.id, pass: i + 1 })))).filter((c) => !have.has(cellKey(c)));
  return { sessions: [...first, ...current], notRun };
}

/** The per-arm summary of an item's current sessions (attempt 1 rows that were rerun are left out). */
export function summarize(item: ItemName, sessions: readonly SessionReadout[], notRun: readonly Cell[]) {
  const p = ITEMS[item];
  const latest = sessions.filter((s) => !sessions.some((o) => o !== s && cellKey(o.cell) === cellKey(s.cell) && o.attempt > s.attempt));
  const capStopped = latest.some((s) => s.outcome.class === "cap_stop");
  const planned = p.sessions / p.arms.length;
  const arms: Record<string, unknown> = {};
  const hears: string[] = [];
  for (const arm of p.arms) {
    const ss = latest.filter((s) => s.cell.arm === arm);
    const count = (f: (s: SessionReadout) => boolean) => ss.filter(f).length;
    const classes: Record<string, number> = {};
    for (const s of ss) classes[s.outcome.class] = (classes[s.outcome.class] ?? 0) + 1;
    const scored = count((s) => s.outcome.scored);
    const notScored = planned - scored;
    const usd = ss.map((s) => s.usd).filter((x): x is number => x !== null);
    const items: Record<string, number> = {};
    for (const s of ss) for (const i of s.exposure.log.items) items[i] = (items[i] ?? 0) + 1;
    const contract = (CONTRACT_ARMS as readonly string[]).includes(arm);
    const p95 = pct(usd, 0.95);
    const pick = seeded([{ tasks: ss.map((s) => cellKey(s.cell)), arms: [], attempts: 1 }], SEED)[0]!.tasks.slice(0, 2);
    const flagged = (f: (s: SessionReadout) => boolean) => count(f);
    const reads = flagged((s) => s.flags.reads.some((r) => r.flagged));
    const unknownNs = flagged((s) => s.flags.unknown_namespace > 0);
    const otherModel = flagged((s) => s.flags.other_model.length > 0);
    if (p.phase === "pilot" && contract) {
      if (reads > 1) hears.push(arm + ": a flagged SKILL.md read shape in " + reads + " pilot sessions");
      if (unknownNs > 1) hears.push(arm + ": a spawn_agent outside multi_agent_v1 and collaboration in " + unknownNs + " pilot sessions");
      if (otherModel > 0) hears.push(arm + ": a sub-agent on another model in " + otherModel + " pilot sessions");
      if (arm === "c-on" && ss.length && count((s) => s.exposure.log.blocked > 0) === 0) hears.push("c-on: the contract blocked in no pilot session (section 1's ceiling case)");
    }
    arms[arm] = {
      planned, found: ss.length, not_run: notRun.filter((c) => c.arm === arm).length, classes, scored, not_scored: notScored,
      reruns: sessions.filter((s) => s.cell.arm === arm && s.attempt === 1 && s.outcome.rerun).length, gaps: count((s) => s.outcome.gap),
      incomplete: capStopped || (p.phase === "main" && notScored > INCOMPLETE_ABOVE),
      ...(p.phase === "pilot" ? { supplied: notScored === 0 } : {}),
      no_text_final: count((s) => s.states.some((x) => x.state === "final" && x.outcome === "no_text")),
      extraction_needed: { final: count((s) => s.states.some((x) => x.state === "final" && (x.outcome === "missing" || x.outcome === "malformed"))), first_stop: count((s) => s.states.some((x) => x.state === "first_stop" && !x.same_as_final && (x.outcome === "missing" || x.outcome === "malformed"))) },
      exposure: {
        blocked: count((s) => s.exposure.log.blocked > 0), items, false_blocks: count((s) => s.exposure.false_blocks > 0), fail_open: count((s) => s.exposure.log.fail_open > 0),
        every_stop_evaluated: count((s) => s.exposure.log.every_stop_evaluated), no_log: count((s) => !s.exposure.log.present),
        pass: { before: count((s) => s.exposure.pass === "before"), after_block: count((s) => s.exposure.pass === "after_block"), never: count((s) => s.exposure.pass === "never") },
        would_block: count((s) => s.exposure.would_block), log_rollout_mismatch: count((s) => s.exposure.log.blocked !== s.exposure.rollout_blocks),
      },
      flags: { read_shapes: reads, unknown_namespace: unknownNs, other_model: otherModel, fork_not_none: count((s) => s.flags.fork_not_none > 0), effort_override: count((s) => s.flags.effort_override > 0) },
      ...(p.phase === "pilot" && contract ? { contract_ran: ss.length > 0 && ss.every((s) => s.exposure.log.every_stop_evaluated && s.exposure.log.fail_open === 0) } : {}),
      usd: { sessions: usd.length, mean: usd.length ? usd.reduce((a, b) => a + b, 0) / usd.length : null, median: pct(usd, 0.5), p95, allowance: p.allowance_usd, doubles_allowance: p95 !== null && p95 > p.allowance_usd / 2 },
      hand_read: pick,
    };
  }
  return { schema_version: 1, item, phase: p.phase, cap_stopped: capStopped, captain_hears: hears, arms };
}

/** Writes the item's readout files and returns the summary. */
export function writeReadout(root: string, item: ItemName, units: readonly UnitRef[]) {
  const dir = join(root, item, "readout");
  mkdirSync(dir, { recursive: true });
  const { sessions, notRun } = readItem(root, item, units, blindKey(dir));
  const latest = sessions.filter((s) => !sessions.some((o) => o !== s && cellKey(o.cell) === cellKey(s.cell) && o.attempt > s.attempt));
  const states = latest.flatMap((s) => s.states);
  writeFileSync(join(dir, "states.jsonl"), jsonl(states));
  writeFileSync(join(dir, "states-blind.jsonl"), jsonl(blindRows(states)));
  writeFileSync(join(dir, "exposure.jsonl"), jsonl(sessions.map((s) => ({ ...s.cell, attempt: s.attempt, exposure: s.exposure, flags: s.flags }))));
  writeFileSync(join(dir, "outcomes.jsonl"), jsonl([...sessions.map((s) => s.outcome), ...notRun.map((c) => ({ ...c, attempt: 0, class: "not_run", scored: false, code: null, reasons: ["not in cells.ndjson: a cap stop or a step not run yet"] }))]));
  const summary = summarize(item, sessions, notRun);
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

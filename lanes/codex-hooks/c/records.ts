// Copyright (c) 2026 Garry Tan. MIT License.
// The states file part C's judging and analysis read (analysis/record.ts), written from the rig's readouts: one line per
// session state over the items of one phase (c-pilot and h-pilot, or c-main and h-main). Each cell's latest attempt
// counts, as in the readout's summary. A scored session the contract blocked has a first-stop and a final line, any other
// scored session has a final line, and a session that was not scored has one final line with no findings. An item the
// controller stopped at its cap (<root>/<item>/CAP_STOP) also gives a cap_stop line for each planned cell it never ran, so
// a cap stop before a session started still ends the part INCOMPLETE (section 5.8). Each finding's file is made relative to
// the repository the way review-units' findings.jsonl writes it. It calls no model.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoPath } from "../../../src/trial/review/findings.ts";
import { unitTaskId } from "../../../src/trial/review/unit.ts";
import { loadSuite, type Unit } from "../../review-noloss/suite.ts";
import { SUITE as FROZEN_SUITE, type CArm } from "./analysis/frozen.ts";
import { blockingBugs, readStates, STATES_SCHEMA, type Exposure, type SessionOutcome, type StateRecord } from "./analysis/record.ts";
import { CONTRACT_ARMS, ITEM_NAMES, ITEMS, PASSES, type ItemName } from "./pins.ts";
import { readItem, type SessionReadout, type UnitRef } from "./readout.ts";
import type { Cell, StateRow } from "./states.ts";

export const sessionId = (arm: string, u: { repo: string; pr: number; head: string }, pass: number) => "s-" + arm + "-" + u.repo.split("/")[1] + "-" + u.pr + "-" + u.head.slice(0, 8) + "-p" + pass;

const blank = (r: StateRow) => r.text === null || !r.text.trim();

/** Section 5.6's readout for one session as the analysis reads it; null in c-none. */
export function exposureOf(s: SessionReadout): Exposure | null {
  if (s.cell.arm === "c-none") return null;
  const e = s.exposure;
  return {
    evaluated_stops: e.log.evaluated,
    blocks: e.log.blocked,
    items_named: e.log.items,
    fail_open: e.log.fail_open > 0,
    false_block: e.false_blocks > 0,
    would_block: s.cell.arm === "c-off" ? e.would_block : null,
    read_shape_flags: s.flags.reads.filter((r) => r.flagged).length,
    unknown_namespace_spawns: s.flags.unknown_namespace,
    subagent_other_model: s.flags.other_model.length,
  };
}

/** One session's lines on its suite unit. */
export function sessionRecords(s: SessionReadout, unit: Unit): StateRecord[] {
  const arm = s.cell.arm as CArm;
  const o = s.outcome;
  const outcome: SessionOutcome = o.class === "cap_stop" ? "cap_stop" : o.scored ? "scored" : "gap";
  const final = s.states.find((r) => r.state === "final")!;
  const blocked = (CONTRACT_ARMS as readonly string[]).includes(arm) && final.blocked;
  const head = { schema: STATES_SCHEMA as 1, session: sessionId(arm, unit, s.cell.pass), unit: unit.id, bugs: blockingBugs(unit).map((b) => b.id), cluster: unit.cluster, arm, pass: s.cell.pass };
  const rest = {
    outcome,
    outcome_code: outcome === "scored" ? null : (o.code ?? (o.class === "safety" ? "SAFETY_STOP" : "E_CODEX_C_NO_RESPONSE")),
    attempts: s.attempt,
    limit_stop: o.class === "limit_stop",
    safety_stop: o.class === "safety",
    no_text: false,
    blocked,
  };
  const tail = { cost: { usd: s.usd, total_tokens: null }, exposure: exposureOf(s) };
  if (outcome !== "scored") return [{ ...head, state: "final", ...rest, findings: null, no_block: false, message: null, ...tail }];
  const line = (r: StateRow): StateRecord => {
    const body = blank(r)
      ? { findings: [], no_block: false, message: null }
      : r.outcome === "findings"
        ? { findings: r.findings.map((f) => ({ ...f, file: repoPath(f.file, "/work/" + unitTaskId(unit)) })), no_block: false, message: null }
        : { findings: null, no_block: true, message: r.text };
    return { ...head, state: r.state, ...rest, no_text: outcome === "scored" && r.text === null, ...body, ...tail };
  };
  const first = s.states.find((r) => r.state === "first_stop");
  return blocked && first ? [line(first), line(final)] : [line(final)];
}

/** The cap_stop line of a planned cell a cap stop kept from running. */
export function capStopRecord(c: Cell, unit: Unit): StateRecord {
  return { schema: STATES_SCHEMA as 1, session: sessionId(c.arm, unit, c.pass), unit: unit.id, bugs: blockingBugs(unit).map((b) => b.id), cluster: unit.cluster, arm: c.arm as CArm, pass: c.pass, state: "final", outcome: "cap_stop", outcome_code: "CAP_STOP", attempts: 1, limit_stop: false, safety_stop: false, no_text: false, blocked: false, findings: null, no_block: false, message: null, cost: { usd: null, total_tokens: null }, exposure: null };
}

/**
 * The states file for one phase: every item of the phase that has run (a cells.ndjson or a cap stop), each cell's latest attempt, checked
 * against the record contract before it is returned. unitsOf names the suite units each item runs.
 */
export function phaseRecords(root: string, phase: "pilot" | "main", unitsOf: (i: ItemName) => UnitRef[]): { text: string; items: { item: ItemName; sessions: number; lines: number; not_run: number; cap_stopped: boolean }[]; skipped: ItemName[] } {
  const loaded = loadSuite(FROZEN_SUITE.path);
  if (loaded.sha256 !== FROZEN_SUITE.sha256) throw new Error("E_CH_C_FROZEN " + FROZEN_SUITE.path + " hashes to " + loaded.sha256 + ", not " + FROZEN_SUITE.sha256);
  const byId = new Map(loaded.suite.units.map((u) => [u.id, u]));
  const lines: StateRecord[] = [];
  const items: { item: ItemName; sessions: number; lines: number; not_run: number; cap_stopped: boolean }[] = [];
  const skipped: ItemName[] = [];
  const covered = new Set<string>();
  for (const item of ITEM_NAMES.filter((i) => ITEMS[i].phase === phase)) {
    const units = unitsOf(item);
    for (const u of units) covered.add(u.id);
    const capStopped = existsSync(join(root, item, "CAP_STOP"));
    if (!existsSync(join(root, item, "cells.ndjson")) && !capStopped) {
      skipped.push(item);
      continue;
    }
    const { sessions, notRun } = readItem(root, item, units, randomBytes(32));
    const key = (s: SessionReadout) => [s.cell.model, s.cell.arm, s.cell.unit, s.cell.pass].join("\t");
    const latest = sessions.filter((s) => !sessions.some((o) => o !== s && key(o) === key(s) && o.attempt > s.attempt));
    const mine = [...latest.flatMap((s) => sessionRecords(s, byId.get(s.cell.unit)!)), ...(capStopped ? notRun.map((c) => capStopRecord(c, byId.get(c.unit)!)) : [])];
    lines.push(...mine);
    items.push({ item, sessions: latest.length, lines: mine.length, not_run: notRun.length, cap_stopped: capStopped });
  }
  const text = lines.map((l) => JSON.stringify(l) + "\n").join("");
  readStates(text, loaded.suite, { passes: PASSES[phase], units: [...covered].sort() });
  return { text, items, skipped };
}

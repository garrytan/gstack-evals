// Copyright (c) 2026 Garry Tan. MIT License.
// The planted build stages' rerun log (dated pre-run fix, 2026-11-17): the outcome driver's sessions.jsonl, which every
// build stage of a run shares (commands.ts buildDriver). It names each cell's opens and refused opens across every lease.
// From it a build stage plans one rerun per planned session, an owed cell's next attempt is its retry, a cell whose open
// the driver refused is left owed rather than recorded as a gap, and the gaps recorded when the driver refused a retry
// are set aside by code, so the step's next run retries them.
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import type { GradedBuild } from "../types.ts";
import type { PlantedSession } from "./build.ts";

export interface Refusal {
  at: string;
  code: string;
  status: number;
  detail: string;
  trial: string;
}

export interface DriverCell {
  arm: string;
  opens: number;
  refusals: Refusal[];
}

/** Each task's opens and refused opens in run_id's rows of the driver's sessions.jsonl. A build cell's task is its key. */
export function driverCells(driver: string, run_id: string): Map<string, DriverCell> {
  const out = new Map<string, DriverCell>();
  const file = join(driver, "sessions.jsonl");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (e.run_id !== run_id || typeof e.task !== "string" || (e.event !== "open" && e.event !== "refuse")) continue;
    const c = out.get(e.task) ?? { arm: String(e.arm), opens: 0, refusals: [] };
    out.set(e.task, c);
    if (e.event === "open") c.opens++;
    else c.refusals.push({ at: String(e.at), code: String(e.code), status: Number(e.status), detail: String(e.detail ?? ""), trial: String(e.trial ?? "") });
  }
  return out;
}

/** The driver's planned sessions and reruns for a build stage on arm that may open cells: every cell the run's earlier
 * leases opened on arm and every cell of this stage, each with one rerun. The driver counts its sessions across leases,
 * so a count of this stage's cells alone would refuse a resumed stage's first opens and its owed retries. */
export function stagePlan(driver: string, run_id: string, arm: string, cells: readonly string[]): { planned: number; reruns: number } {
  const all = new Set(cells);
  for (const [task, c] of driverCells(driver, run_id)) if (c.arm === arm && c.opens > 0) all.add(task);
  const planned = Math.max(1, all.size);
  return { planned, reruns: planned };
}

/** A session whose attempt the driver refused to open ran nothing, so the cell is owed, not a gap: it stops with
 * E_EB_CELL_INCOMPLETE, nothing is recorded for the cell, and the step's next run retries it. */
export function owedOnRefusal(session: PlantedSession, driver: string, run_id: string): PlantedSession {
  return async (s) => {
    const since = new Date().toISOString();
    const r = await session(s);
    const refused = (driverCells(driver, run_id).get(s.cell)?.refusals ?? []).filter((x) => x.at >= since);
    if (refused.length) fail("E_EB_CELL_INCOMPLETE", "cell " + s.cell + ": the driver refused attempt " + s.attempt + "'s open (" + refused[0]!.code + " " + refused[0]!.status + ": " + refused[0]!.detail + "), so no session ran; the cell is owed, nothing is recorded for it, and the step's next run retries it");
    return r;
  };
}

export interface OwedRow {
  cell: string;
  outcome: string;
  opens: number;
  refusals: Refusal[];
  moved: string[];
}

const SET_ASIDE = ".refused-gap";

/**
 * Sets aside each build cell recorded as a gap after the driver refused its retry, which ran no session: the driver's
 * log holds a refused open for the cell and fewer than two opens. Its record and digest, a hinted cell's hinted.json and
 * the refused attempt's session folder are renamed with ".refused-gap", never deleted or overwritten, so the cell is owed
 * and the step's next run gives it its one retry. A cell whose retry opened keeps its record. Returns the changed rows.
 */
export function setAsideRefusedGaps(run: string, driver: string, run_id: string): OwedRow[] {
  const log = driverCells(driver, run_id);
  const rows: OwedRow[] = [];
  const move = (from: string, moved: string[]) => {
    const to = from.replace(/(\.[a-z0-9]+)?$/, (ext) => SET_ASIDE + ext);
    if (existsSync(to)) fail("E_USAGE", to + " already exists; nothing is overwritten");
    renameSync(from, to);
    moved.push(to);
  };
  for (const phase of ["authoring", "comparison", "stock"]) {
    const cells = join(run, "builds", phase, "cells");
    if (!existsSync(cells)) continue;
    for (const name of readdirSync(cells).sort()) {
      if (!name.endsWith(".json") || name.includes(SET_ASIDE)) continue;
      const cell = name.slice(0, -".json".length);
      const b = JSON.parse(readFileSync(join(cells, name), "utf8")) as GradedBuild;
      const c = log.get(cell);
      if ((b.outcome !== "upstream_gap" && b.outcome !== "infra_gap") || !c || !c.refusals.length || c.opens >= 2) continue;
      const moved: string[] = [];
      for (const f of [join(cells, name), join(cells, cell + ".sha256")]) if (existsSync(f)) move(f, moved);
      if (b.arm === "hinted" && existsSync(join(run, "author", b.unit, "hinted.json"))) move(join(run, "author", b.unit, "hinted.json"), moved);
      const attempt = join(run, "builds", phase, "rig", "sessions", cell, "a" + (c.opens + 1));
      if (existsSync(attempt)) move(attempt, moved);
      rows.push({ cell, outcome: b.outcome, opens: c.opens, refusals: c.refusals, moved });
    }
  }
  return rows;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The planted build stages' rerun log (dated pre-run fixes, 2026-11-17): the outcome driver's sessions.jsonl, which every
// build stage of a run shares (commands.ts buildDriver). It names each cell's opens, which of them were reruns, and its
// refused opens, across every lease. From it a build stage plans one rerun per planned session, an owed cell's next
// attempt is its retry, an attempt that ended in a gap with no new open (refused, or never reaching the driver) leaves its
// cell owed rather than recorded as a gap, and the gaps recorded that way before these fixes are set aside by code, so the
// step's next run retries them.
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
  /** Whether the refused open named itself a rerun. */
  rerun: boolean;
}

export interface DriverCell {
  arm: string;
  opens: number;
  /** Opens that named themselves a rerun. */
  reruns: number;
  /** The latest open's time, or null. */
  lastOpen: string | null;
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
    const c = out.get(e.task) ?? { arm: String(e.arm), opens: 0, reruns: 0, lastOpen: null, refusals: [] };
    out.set(e.task, c);
    if (e.event === "refuse") c.refusals.push({ at: String(e.at), code: String(e.code), status: Number(e.status), detail: String(e.detail ?? ""), trial: String(e.trial ?? ""), rerun: Boolean(e.rerun) });
    else {
      c.opens++;
      if (e.rerun) c.reruns++;
      if (c.lastOpen === null || String(e.at) > c.lastOpen) c.lastOpen = String(e.at);
    }
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

/** An attempt that ended in a gap with no new open in the driver's log ran no session: the driver refused its open, or
 * it never reached the driver. Its cell is owed, not a gap: it stops with E_EB_CELL_INCOMPLETE, nothing is recorded for
 * it, and the step's next run retries it. The launcher clears an attempt's folder when it starts that attempt again, so
 * the owed attempt's folder under sessions is renamed with ".owed" first, never overwritten. */
export function owedOnRefusal(session: PlantedSession, driver: string, run_id: string, sessions?: string): PlantedSession {
  return async (s) => {
    const opens = () => driverCells(driver, run_id).get(s.cell)?.opens ?? 0;
    const before = opens();
    const since = new Date().toISOString();
    const r = await session(s);
    if ((r.outcome !== "upstream_gap" && r.outcome !== "infra_gap") || opens() > before) return r;
    const refused = (driverCells(driver, run_id).get(s.cell)?.refusals ?? []).filter((x) => x.at >= since);
    const dir = sessions ? join(sessions, s.cell.replace(/[^A-Za-z0-9._-]/g, "_"), "a" + s.attempt) : null;
    let kept = dir + ".owed";
    for (let i = 2; existsSync(kept); i++) kept = dir + ".owed-" + i;
    if (dir && existsSync(dir)) renameSync(dir, kept);
    return fail("E_EB_CELL_INCOMPLETE", "cell " + s.cell + ": " + (refused.length ? "the driver refused attempt " + s.attempt + "'s open (" + refused[0]!.code + " " + refused[0]!.status + ": " + refused[0]!.detail + ")" : "attempt " + s.attempt + " never reached the driver") + ", so no session ran; the cell is owed, nothing is recorded for it, and the step's next run retries it" + (dir && existsSync(kept) ? "; its attempt folder is kept as " + kept : ""));
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
 * Sets aside each build cell recorded as a gap whose retry never opened, so it ran no session. The driver's log shows
 * it: no open named itself a rerun, there were fewer than two opens and more attempt folders than opens, and when the
 * cell had one open and any refused open, a refusal that named itself a rerun came at or after that open. The cell's
 * hinted.json, its unopened attempt folders, its digest and, last, its record are renamed with ".refused-gap", never
 * deleted or overwritten, so the cell is owed and the step's next run gives it its one retry. Every rename is checked
 * before any is made, and a rename an earlier run already made stands, so a run that stopped halfway is finished by the
 * next. Returns the changed rows.
 */
export function setAsideRefusedGaps(run: string, driver: string, run_id: string): OwedRow[] {
  const log = driverCells(driver, run_id);
  const aside = (from: string) => from.replace(/(\.[a-z0-9]+)?$/, (ext) => SET_ASIDE + ext);
  const plans: Array<{ row: OwedRow; moves: string[] }> = [];
  for (const phase of ["authoring", "comparison", "stock"]) {
    const cells = join(run, "builds", phase, "cells");
    if (!existsSync(cells)) continue;
    for (const name of readdirSync(cells).sort()) {
      if (!name.endsWith(".json") || name.includes(SET_ASIDE)) continue;
      const cell = name.slice(0, -".json".length);
      const b = JSON.parse(readFileSync(join(cells, name), "utf8")) as GradedBuild;
      if (b.outcome !== "upstream_gap" && b.outcome !== "infra_gap") continue;
      const c = log.get(cell) ?? { arm: b.arm, opens: 0, reruns: 0, lastOpen: null, refusals: [] };
      const sessions = join(run, "builds", phase, "rig", "sessions", cell);
      const tried = Math.max(0, ...(existsSync(sessions) ? readdirSync(sessions) : []).map((n) => Number(/^a(\d+)(\.refused-gap)?$/.exec(n)?.[1] ?? 0)));
      if (c.reruns > 0 || c.opens >= 2 || tried <= c.opens) continue;
      if (c.opens === 1 && c.refusals.length && !c.refusals.some((x) => x.rerun && x.at >= c.lastOpen!)) continue;
      const unopened = Array.from({ length: tried - c.opens }, (_, i) => join(sessions, "a" + (c.opens + 1 + i)));
      const moves = [...(b.arm === "hinted" ? [join(run, "author", b.unit, "hinted.json")] : []), ...unopened, join(cells, cell + ".sha256"), join(cells, name)];
      plans.push({ row: { cell, outcome: b.outcome, opens: c.opens, refusals: c.refusals, moved: [] }, moves });
    }
  }
  for (const { moves } of plans) for (const from of moves) if (existsSync(from) && existsSync(aside(from))) fail("E_USAGE", aside(from) + " already exists; nothing is moved or overwritten");
  for (const { row, moves } of plans)
    for (const from of moves) {
      if (existsSync(from)) renameSync(from, aside(from));
      if (existsSync(aside(from))) row.moved.push(aside(from));
    }
  return plans.map((p) => p.row);
}

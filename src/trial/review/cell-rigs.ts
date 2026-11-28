// One lease per cell (review-units --cell-items <file>): the review-models eval leases each arm's own ledger item (prereg
// 2026-11-24-geva-590-review-models-prereg, Pilots, and section 11), while one review-units run holds every cell so its
// order can interleave arms within each unit (section 3). So the run builds one Docker rig per cell, each with its own
// lease, proxy, journal and trial network, and a retry rig on the retry reserve's item for section 8's one rerun, and
// composes them into the one HostRig the run loop drives: route() names the rig that serves a session, by its cell and
// attempt (attempt 2 is the rerun, on the retry rig).
//
// The cell items file:
//   { "schema": "rm-cell-items.v1",
//     "cells": { "<arm id>": { "item": "<ledger item>", "cap_usd": 120, "allowance_usd": 10.5 }, ... },
//     "retry": { "item": "<ledger item>", "run_id": "<fixed run id>", "cap_usd": 295 } }
// Every arm id the run holds needs a cell entry. A cell's rig leases cap_usd on its item under run <run id>-<arm id>, so
// the item binds to that cell. The retry rig leases on its own fixed run id, so one reserve can serve the pilot, the
// validation batch and the counted run in turn. retry may be left out: then nothing reruns.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostRig } from "../../skill-eval/cli/run-host.ts";
import { armId } from "./run.ts";

export interface CellItem {
  item: string;
  cap_usd: number;
  allowance_usd: number;
}

export interface CellItems {
  schema: "rm-cell-items.v1";
  cells: Record<string, CellItem>;
  retry: { item: string; run_id: string; cap_usd: number } | null;
}

const ITEM = /^[a-z0-9][a-z0-9._-]*$/;
const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Reads and checks a cell items file against the run's arm ids; throws naming every problem. */
export function loadCellItems(file: string, ids: readonly string[]): CellItems {
  let v: any;
  try {
    v = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error("--cell-items " + file + ": " + (e as Error).message);
  }
  const p: string[] = [];
  if (v?.schema !== "rm-cell-items.v1") p.push("schema must be rm-cell-items.v1");
  const cells = v?.cells && typeof v.cells === "object" ? v.cells : {};
  for (const id of ids) if (!cells[id]) p.push("no entry for cell " + id);
  for (const [id, c] of Object.entries<any>(cells)) {
    if (!ids.includes(id)) p.push("cell " + id + " is not one this run holds (" + ids.join(", ") + ")");
    if (typeof c?.item !== "string" || !ITEM.test(c.item)) p.push("cell " + id + " needs an item name");
    if (!money(c?.cap_usd) || !money(c?.allowance_usd)) p.push("cell " + id + " needs positive cap_usd and allowance_usd");
    else if (c.allowance_usd > c.cap_usd) p.push("cell " + id + "'s allowance is above its cap");
  }
  const items = Object.values<any>(cells).map((c) => c?.item);
  if (new Set(items).size !== items.length) p.push("two cells name the same item; each cell leases its own");
  const retry = v?.retry ?? null;
  if (retry !== null && (typeof retry.item !== "string" || !ITEM.test(retry.item) || typeof retry.run_id !== "string" || !RUN.test(retry.run_id) || !money(retry.cap_usd))) p.push("retry needs item, run_id and a positive cap_usd");
  if (retry && items.includes(retry.item)) p.push("the retry item is also a cell's item");
  if (p.length) throw new Error("--cell-items " + file + ":\n  " + p.join("\n  "));
  return { schema: "rm-cell-items.v1", cells, retry };
}

/** The run id a cell's rig leases under. */
export const cellRunId = (runId: string, id: string): string => runId + "-" + id;

/** Composes one rig per cell (by arm id) and an optional retry rig into the HostRig the run loop drives. */
export function composeRigs(cells: ReadonlyMap<string, HostRig>, retry: HostRig | null): HostRig {
  const first = [...cells.values()][0];
  if (!first) throw new Error("E_USAGE: a composed rig needs at least one cell");
  const meters = new Map<string, HostRig>();
  const pick = (arm: string, model: string, attempt: number): HostRig => {
    if (attempt > 1) {
      if (!retry) throw new Error("E_USAGE: attempt " + attempt + " of " + armId(arm, model) + " has no retry rig to run on");
      return retry;
    }
    const rig = cells.get(armId(arm, model));
    if (!rig) throw new Error("E_USAGE: no rig serves cell " + armId(arm, model));
    return rig;
  };
  const cellSettings: Record<string, Record<string, NonNullable<HostRig["cells"]>[string][string]>> = {};
  const arms: Record<string, HostRig["arms"][string]> = {};
  for (const [id, rig] of cells) {
    for (const [arm, install] of Object.entries(rig.arms)) arms[arm] ??= install;
    for (const [arm, byModel] of Object.entries(rig.cells ?? {})) for (const [model, s] of Object.entries(byModel)) if (armId(arm, model) === id) (cellSettings[arm] ??= {})[model] = s;
  }
  const all = [...cells.values(), ...(retry ? [retry] : [])];
  return {
    baseUrl: first.baseUrl,
    network: first.network,
    imageDigest: first.imageDigest,
    recovery: null,
    journals: all.flatMap((r) => (r.recovery ? [r.recovery.journal] : r.journals ?? [])),
    arms,
    cells: cellSettings,
    async bind(request) {
      const rig = pick(request.cell.arm, request.cell.model, request.cell.attempt);
      const b = await rig.bind(request);
      meters.set(b.meter_id, rig);
      return b;
    },
    finalize: (meterId) => {
      const rig = meters.get(meterId);
      if (!rig) throw new Error("E_USAGE: meter " + meterId + " was not bound through this rig");
      return rig.finalize(meterId);
    },
    sandbox: (arm, calibration, model) => (model ? pick(arm, model, 1) : first).sandbox(arm, calibration, model),
    route(arm, model, attempt) {
      const rig = pick(arm, model, attempt);
      return { baseUrl: rig.baseUrl, network: rig.network, journal: rig.recovery?.journal ?? null, sandbox: rig.sandbox(arm, false, model) };
    },
    ...(first.driver ? { driver: first.driver } : {}),
    judgeSandbox: () => first.judgeSandbox(),
    egress: () => first.egress(),
    async close() {
      let committed = 0;
      let unknown = 0;
      const leases: string[] = [];
      const errors: string[] = [];
      for (const rig of all) {
        try {
          const c = await rig.close();
          committed += c.committed;
          unknown += c.unknown;
          if (c.lease_id) leases.push(c.lease_id);
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
      if (errors.length) throw new Error(errors.join("\n"));
      return { committed, unknown, lease_id: leases.join(",") || null };
    },
  };
}

/** Where a cell's rig keeps its proxy dir and image context, apart from every other rig of the run. */
export const cellRigDir = (out: string, id: string): string => join(out, "rigs", id);

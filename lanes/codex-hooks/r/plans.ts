// Copyright (c) 2026 Garry Tan. MIT License.
// Part R's items, their parts and the launcher profile that runs them on L1's host and part machinery
// (quick/laneb/l1/l1.ts), as B1's do (lanes/delivery-route/plans.ts): B1's 60 drawn tasks and its task images, with part R's
// three arms, its own prepare step (prepare-run.ts: the Codex agent and the Responses route) and proxy config. Each part is
// one launch; a task's three arms run in one part, in the seeded order L1's seeded() gives.
import { join } from "node:path";
import { plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../../quick/laneb/l1/l1.ts";
import { drawnTasks, loadBundle } from "../../delivery-route/pins.ts";
import { attempt2Owed } from "./money.ts";
import { frozenRouteTable } from "./routes.ts";
import { AGENT, ARM_NAMES, ARMS, HERE, ITEMS_USD, MODEL, PILOT_TASKS, PROXY_CONFIG, R, REPO, ROUTE_TABLE_SHA256, TARS, TASK_SETUP, type Item } from "./pins.ts";

const item = (i: Item): ItemDef => ({ capUsd: ITEMS_USD[i].cap, taskSet: "swerebench-r3a4", cells: AGENT.cells, allowanceUsd: R.allowanceUsd, model: MODEL });
export const ITEMS: Record<Item, ItemDef> = { "r-pilot": item("r-pilot"), "r-main": item("r-main") };
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** An item's parts: the pilot's six tasks in one part, the main run's 60 in parts of 20, every arm on each task. */
export function itemPlan(name: string, run: string[]): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[]): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, R.seed) });
  let parts: PartPlan[];
  if (name === "r-pilot") parts = [part("r-pilot", [{ tasks: [...PILOT_TASKS], arms: [...ARM_NAMES], attempts: 1 }])];
  else if (name === "r-main") parts = chunks(run, R.partTasks).map((tasks, i) => part("r-" + (i + 1), [{ tasks, arms: [...ARM_NAMES], attempts: 1 }]));
  else throw new Error("E_USAGE unknown item " + name + "; one of " + Object.keys(ITEMS).join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}

export const R_PROFILE: Profile = {
  items: ITEMS,
  armSpecs: Object.fromEntries(ARM_NAMES.map((a) => [a, ARMS[a].spec])),
  tars: TARS,
  armManifests: R.armManifests,
  hostRoot: R.hostRoot,
  ledgerPort: R.ledgerPort,
  seed: R.seed,
  concurrent: R.concurrent,
  taskSetup: { file: TASK_SETUP.file, sha256: TASK_SETUP.sha256 },
  prepareRun: join(REPO, HERE, "prepare-run.ts"),
  proxyConfig: PROXY_CONFIG,
  // One rerun of a session that ended with no model response, no result, no verifier reward or no rollout (money.ts).
  attempt2: { skip: () => null, owed: (runs) => attempt2Owed(runs) },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    frozenRouteTable();
    inputs["route-table"] = ROUTE_TABLE_SHA256;
    return itemPlan(name, drawnTasks(b).run).parts;
  },
};

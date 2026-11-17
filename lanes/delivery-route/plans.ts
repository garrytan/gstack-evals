// Copyright (c) 2026 Garry Tan. MIT License.
// B1's items, their parts and the launcher profile that runs them on L1's host and part machinery (quick/laneb/l1/l1.ts).
// Each part is one launch; a task's four arms run in one part, in the seeded order L1's seeded() gives.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { attempt2Owed } from "./money.ts";
import { ARM_NAMES, ARMS, B1, CAPS_USD, drawnTasks, ITEM_MODEL, loadBundle, MODEL_KEYS, MODELS, REPO, SMOKE_TASKS, TARS, TASK_SETUP, type Item, type ModelKey } from "./pins.ts";

const item = (m: ModelKey, capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS[m].cells, allowanceUsd: MODELS[m].allowanceUsd, model: MODELS[m].id });
// b1-smoke is one item with one part per model: one ledger item binds one run, and a part runs one model's cells. Its
// allowance for L1's cap-stop check is the largest of the three models'.
export const ITEMS: Record<Item, ItemDef> = {
  "b1-smoke": { ...item("opus", CAPS_USD["b1-smoke"]), allowanceUsd: Math.max(...MODEL_KEYS.map((m) => MODELS[m].allowanceUsd)) },
  "b1-opus": item("opus", CAPS_USD["b1-opus"]),
  "b1-sol": item("sol", CAPS_USD["b1-sol"]),
  "b1-p1": item("p1", CAPS_USD["b1-p1"]),
};
export const SMOKE_PARTS = MODEL_KEYS.map((m) => "smoke-" + m);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function itemPlan(name: string, run: string[]): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[], extra: Partial<PartPlan> = {}): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B1.seed), ...extra });
  let parts: PartPlan[];
  if (name === "b1-smoke") parts = MODEL_KEYS.map((m) => part("smoke-" + m, [{ tasks: [...SMOKE_TASKS], arms: [...ARM_NAMES], attempts: 1 }], { model: MODELS[m].id, cells: MODELS[m].cells }));
  else if (Object.hasOwn(ITEM_MODEL, name)) parts = chunks(run, B1.partTasks).map((tasks, i) => part("b1-" + (i + 1), [{ tasks, arms: [...ARM_NAMES], attempts: 1 }]));
  else throw new Error("E_USAGE unknown item " + name + "; one of " + Object.keys(ITEMS).join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}

export const B1_PROFILE: Profile = {
  items: ITEMS,
  armSpecs: Object.fromEntries(ARM_NAMES.map((a) => [a, ARMS[a].spec])),
  tars: TARS,
  armManifests: B1.armManifests,
  hostRoot: B1.hostRoot,
  ledgerPort: B1.ledgerPort,
  seed: B1.seed,
  concurrent: B1.concurrent,
  taskSetup: TASK_SETUP,
  // One rerun of a session that ended with no model response, no result or no verifier reward (money.ts needsRerun).
  attempt2: { skip: () => null, owed: (runs) => attempt2Owed(runs) },
  // b1-smoke runs a part per model on one item whose model is Opus, so its host also ships the route keys of the other
  // parts' models (config/proxy.json), through host-up's route-key filter. The main items run one model and ship none.
  proxyKeys: (plan) => {
    const proxy = JSON.parse(readFileSync(join(REPO, "quick/laneb/config/proxy.json"), "utf8"));
    const keyOf = (m: string): string | undefined => proxy.routes?.[proxy.models?.[m]?.route]?.key_env;
    return [...new Set(plan.parts.map((p) => p.model ?? plan.model).filter((m) => m !== plan.model).map((m) => keyOf(m) ?? (() => { throw new Error("E_B1_INPUT config/proxy.json has no route for " + m); })()))];
  },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    return itemPlan(name, drawnTasks(b).run).parts;
  },
};

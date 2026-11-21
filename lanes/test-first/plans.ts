// Copyright (c) 2026 Garry Tan. MIT License.
// B2's items, their parts and the launcher profile that runs them on L1's host and part machinery (quick/laneb/l1/l1.ts), as
// B1's do (lanes/delivery-route/plans.ts). b2-pilot is one item with one part per model, the three pilot tasks on the four
// arms of that model's host. b2-opus, b2-sol and b2-p1 run eight parts each, 23 tasks and their four arms to a part (the last
// 22), a task's four arms in one part, in the order L1's seeded() gives from B2's seed. Claude Code parts use Lane B's Claude
// agent with B1's cells; Sol's parts use B2's Codex agent on the Responses route (prepare-run.ts, proxy.json), with Codex in
// each task image as part R builds it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Plan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import { Ledger, type Row } from "../../quick/laneb/runner/ledger.ts";
import { approve, attempt2Owed, itemTotals } from "./money.ts";
import { ARM_DEFS, B2, CAPS_USD, drawnTasks, HERE, hostOf, HOSTS, isItem, ITEM_MODEL, ITEM_NAMES, LABELS, labelsOf, loadBundle, MODEL_KEYS, MODELS, REPO, TARS, type Item, type ModelKey } from "./pins.ts";

export const PROXY_CONFIG = join(REPO, HERE, "proxy.json");
const item = (m: ModelKey, capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS[m].cells, allowanceUsd: MODELS[m].allowanceUsd, model: MODELS[m].id });
// b2-pilot binds one run on one ledger item; its item model is Opus, and each part names its own model and cells. Its allowance
// for L1's cap-stop check is the largest of the three models'.
export const ITEMS: Record<Item, ItemDef> = {
  "b2-pilot": { ...item("opus", CAPS_USD["b2-pilot"]), allowanceUsd: Math.max(...MODEL_KEYS.map((m) => MODELS[m].allowanceUsd)) },
  "b2-opus": item("opus", CAPS_USD["b2-opus"]),
  "b2-sol": item("sol", CAPS_USD["b2-sol"]),
  "b2-p1": item("p1", CAPS_USD["b2-p1"]),
};
export const PILOT_PARTS = MODEL_KEYS.map((m) => "pilot-" + m);
/** Pre-run change 2: B2_PILOT_MODELS, a comma list of model keys, prepares b2-pilot for those models' parts only (the Sol
 *  re-pilot). Unset, the pilot has every model's part. */
export function pilotModels(env = process.env.B2_PILOT_MODELS): ModelKey[] {
  if (!env) return [...MODEL_KEYS];
  const ms = env.split(",").map((s) => s.trim()), bad = ms.filter((m) => !(MODEL_KEYS as readonly string[]).includes(m));
  if (bad.length || new Set(ms).size !== ms.length) throw new Error("E_USAGE B2_PILOT_MODELS names " + JSON.stringify(env) + "; give each of " + MODEL_KEYS.join(", ") + " at most once");
  return ms as ModelKey[];
}
/** Pre-run change 2: a re-pilot's ledger opens with b2-pilot's approval row at its recorded cap and carries the first pilot
 *  run's settled spend as one settled row, so the first run and the re-pilot together stay inside b2-pilot's one cap. */
export function carryPilot(path: string, from: Row[], fromRun: string, by: string) {
  const first = itemTotals(from, "b2-pilot");
  if (!first.done || first.open) throw new Error("E_B2_INPUT the first pilot's ledger is not done with every reserve settled; nothing to carry");
  approve(path, "b2-pilot", CAPS_USD["b2-pilot"], by);
  const l = new Ledger(path, "b2-pilot"), id = "carry-" + fromRun, detail = { kind_detail: "the first b2-pilot run " + fromRun + "'s settled spend, carried by pre-run change 2" };
  const r = l.reserve(id, first.settled, detail);
  if (!r.ok) throw new Error("E_B2_INPUT the carry reserve was refused: " + r.reason);
  const s = l.settle(id, first.settled, detail);
  if (!s.ok) throw new Error("E_B2_INPUT the carry settle was refused: " + s.reason);
  return first.settled;
}
export const partName = (n: number) => "b2-" + n;
/** A part's number in its item (b2-5 is 5), its attempt 2 and relaunch included; 0 for a pilot part. */
export const partNumber = (name: string) => Number(/^b2-(\d+)/.exec(name)?.[1] ?? 0);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function itemPlan(name: string, run: string[], pilot: readonly string[] = drawnTasks().pilot): { parts: PartPlan[]; sessions: number } {
  const part = (p: string, rects: Rect[], extra: Partial<PartPlan> = {}): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects, B2.seed), ...extra });
  let parts: PartPlan[];
  if (name === "b2-pilot") parts = pilotModels().map((m) => part("pilot-" + m, [{ tasks: [...pilot], arms: labelsOf(hostOf(m)), attempts: 1 }], { model: MODELS[m].id, cells: MODELS[m].cells }));
  else if (isItem(name)) parts = chunks(run, B2.partTasks).map((tasks, i) => part(partName(i + 1), [{ tasks, arms: labelsOf(hostOf(ITEM_MODEL[name as Exclude<Item, "b2-pilot">])), attempts: 1 }]));
  else throw new Error("E_USAGE unknown item " + name + "; one of " + ITEM_NAMES.join(", "));
  return { parts, sessions: parts.flatMap((p) => [...plannedCells(p).values()]).reduce((a, b) => a + b, 0) };
}

const proxyKeyOf = (m: string): string => {
  const proxy = JSON.parse(readFileSync(PROXY_CONFIG, "utf8"));
  return proxy.routes?.[proxy.models?.[m]?.route]?.key_env ?? (() => { throw new Error("E_B2_INPUT " + HERE + "/proxy.json has no route for " + m); })();
};

export const B2_PROFILE: Profile = {
  items: ITEMS,
  armSpecs: Object.fromEntries(LABELS.map((l) => [l, ARM_DEFS[l]!.spec])),
  tars: TARS,
  armManifests: B2.armManifests,
  hostRoot: B2.hostRoot,
  ledgerPort: B2.ledgerPort,
  seed: B2.seed,
  concurrent: B2.concurrent,
  // B1's task setup for Claude Code parts; prepare-run.ts swaps in part R's (B1's lines plus Codex) for a Sol part.
  taskSetup: HOSTS.claude.taskSetup,
  prepareRun: join(REPO, HERE, "prepare-run.ts"),
  proxyConfig: PROXY_CONFIG,
  // One rerun of an infrastructure session (section 8; money.ts needsRerun).
  attempt2: { skip: () => null, owed: (runs) => attempt2Owed(runs) },
  // b2-pilot runs a part per model on one item whose model is Opus, so its host also ships the route keys of the other parts'
  // models; a counted item runs one model and ships none.
  proxyKeys: (plan: Plan) => [...new Set(plan.parts.map((p) => p.model ?? plan.model).filter((m) => m !== plan.model).map(proxyKeyOf))],
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    const t = drawnTasks(b);
    return itemPlan(name, t.run, t.pilot).parts;
  },
};

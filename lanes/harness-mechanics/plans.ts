// Copyright (c) 2026 Garry Tan. MIT License.
// The item and part plans (sections 9, 11 and 12) and the launcher profile that runs them on L1's host and part machinery
// (quick/laneb/l1/l1.ts). Each part is one launch; a task's arms run in one part, in the seeded order L1's seeded() gives.
import { plannedCells, prefixOf, seeded, type ItemDef, type PartPlan, type Profile, type Rect } from "../../quick/laneb/l1/l1.ts";
import type { HmArm } from "../../src/types.ts";
import { attempt2Owed } from "./money.ts";
import { ARMS, bundleLists, CAPS_USD, FOUR, HM, JUDGE, loadBundle, MODELS, screenedFromEnv, SMOKE_PART, STAGE1_OPUS_R2_TASKS, TARS, TASK_SETUP, type ModelKey } from "./pins.ts";

const item = (m: ModelKey, capUsd: number): ItemDef => ({ capUsd, taskSet: "swerebench-r3a4", cells: MODELS[m].cells, allowanceUsd: MODELS[m].allowanceUsd, model: MODELS[m].id });
// stage3-pilot is one item with one part per model, after the smoke part (S1, pins.ts SMOKE_PART): one ledger item binds
// one run, and a part runs one model's cells. Nothing launches the next part on its own, so the pilot parts wait, unlaunched,
// until someone runs launch --part pilot-opus on the same bound run. stage3-pilot-2 (D11) runs the same plan under its own
// ledger prefix, after stage3-pilot closed at its smoke, and so does stage3-pilot-3 (D12), after stage3-pilot-2 stopped at
// the sidecar's 15 s cut. The item's
// allowance for L1's cap-stop check is the largest of the three models', which can only make a stop more likely.
export const ITEMS: Record<string, ItemDef> = {
  "stage1-opus": item("opus", CAPS_USD["stage1-opus"]),
  "stage1-opus-r2": item("opus", CAPS_USD["stage1-opus-r2"]),
  "stage1-sol": item("sol", CAPS_USD["stage1-sol"]),
  "stage1-sol-run": item("sol", CAPS_USD["stage1-sol-run"]),
  "stage1-p1": item("p1", CAPS_USD["stage1-p1"]),
  "stage3-pilot": item("opus", CAPS_USD["stage3-pilot"]),
  "stage3-pilot-2": item("opus", CAPS_USD["stage3-pilot-2"]),
  "stage3-pilot-3": item("opus", CAPS_USD["stage3-pilot-3"]),
  "stage4-opus": item("opus", CAPS_USD["stage4-opus"]),
  "stage4-sol": item("sol", CAPS_USD["stage4-sol"]),
  "stage4-p1": item("p1", CAPS_USD["stage4-p1"]),
};

export type ItemPlan = { parts: PartPlan[]; sessions: number; picker_calls: number };
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function itemPlan(name: string, s: { scored: string[]; calibration: string[] }): ItemPlan {
  const part = (p: string, rects: Rect[], extra: Partial<PartPlan> = {}): PartPlan => ({ name: p, prefix: prefixOf(name, p), rects: seeded(rects.filter((r) => r.tasks.length), HM.seed), ...extra });
  let parts: PartPlan[];
  if (/^stage1-(opus|sol|sol-run|p1)$/.test(name)) parts = chunks(s.calibration, HM.partTasks).map((tasks, i) => part("s1-" + (i + 1), [{ tasks, arms: FOUR, attempts: 1 }]));
  else if (name === "stage1-opus-r2") parts = [part("r2-1", [{ tasks: STAGE1_OPUS_R2_TASKS, arms: FOUR, attempts: 1 }])];
  else if (name === "stage3-pilot" || name === "stage3-pilot-2" || name === "stage3-pilot-3") {
    const pilot = s.calibration.slice(0, HM.splits.judgePilot), smoke = s.calibration[HM.splits.judgePilot];
    if (!smoke || pilot.includes(smoke)) throw new Error("E_HM_INPUT stage3-pilot's smoke task must be calibration task " + (HM.splits.judgePilot + 1) + ", outside judge-pilot's " + HM.splits.judgePilot);
    parts = [
      part(SMOKE_PART, [{ tasks: [smoke], arms: JUDGE, attempts: 1 }], { model: MODELS.opus.id, cells: MODELS.opus.cells }),
      ...(Object.keys(MODELS) as ModelKey[]).map((m) => part("pilot-" + m, [{ tasks: pilot, arms: JUDGE, attempts: 1 }], { model: MODELS[m].id, cells: MODELS[m].cells })),
    ];
  } else if (/^stage4-(opus|sol|p1)$/.test(name)) {
    const judged = new Set(s.scored.slice(0, HM.splits.judgeSubset));
    parts = chunks(s.scored, HM.partTasks).map((tasks, i) => part("s4-" + (i + 1), [
      { tasks: tasks.filter((t) => judged.has(t)), arms: [...FOUR, ...JUDGE], attempts: 1 },
      { tasks: tasks.filter((t) => !judged.has(t)), arms: FOUR, attempts: 1 },
    ]));
  } else throw new Error("E_USAGE unknown item " + name + "; one of " + Object.keys(ITEMS).join(", "));
  const cells = parts.flatMap((p) => [...plannedCells(p).entries()]);
  const has = (a: HmArm) => new Set(cells.filter(([k]) => k.endsWith("\t" + a)).map(([k]) => k.split("\t")[0]));
  const plain = has("plain-2");
  return { parts, sessions: cells.reduce((a, [, n]) => a + n, 0), picker_calls: [...has("none")].filter((t) => plain.has(t)).length };
}

export const HM_PROFILE: Profile = {
  items: ITEMS,
  armSpecs: Object.fromEntries(Object.entries(ARMS).map(([k, v]) => [k, v.spec])),
  tars: TARS,
  armManifests: HM.armManifests,
  hostRoot: HM.hostRoot,
  ledgerPort: HM.ledgerPort,
  seed: HM.seed,
  concurrent: HM.concurrent,
  taskSetup: TASK_SETUP,
  // A judge-bearing item's host ships the judge proxy's keys (jev's TYPESAFE, particle-1's OPENROUTER) beside its own route
  // key, through host-up's same route-key filter, and only when the plan carries a judge arm. A non-judge item ships none,
  // so its part VMs carry only the item model's route key.
  proxyKeys: (plan) => (plan.parts.some((p) => p.rects.some((r) => r.arms.some((a) => (JUDGE as string[]).includes(a)))) ? ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"] : []),
  // Section 13's attempt 2 (l1.ts rerun). stage1-opus-r2 is itself the one attempt for its cells (D3).
  attempt2: {
    skip: (name) => (name === "stage1-opus-r2" ? "stage1-opus-r2 is section 13's one attempt for Stage 1 Opus's 92 unstarted cells (D3), so it takes no attempt 2 of its own" : null),
    owed: (runs) => attempt2Owed(runs),
  },
  parts: (name, _frozen, inputs) => {
    const b = loadBundle();
    for (const [f, d] of b.digests) inputs[f] = d;
    const s = screenedFromEnv(bundleLists(b));
    inputs.screened = s.sha256;
    const stray = name === "stage1-opus-r2" ? STAGE1_OPUS_R2_TASKS.filter((t) => !s.calibration.includes(t)) : [];
    if (stray.length) throw new Error("E_HM_INPUT stage1-opus-r2 names " + stray.join(", ") + ", not in the screened calibration list");
    return itemPlan(name, s).parts;
  },
};

// Copyright (c) 2026 Garry Tan. MIT License.
// The keyless dry run (section 18 steps 1 to 8, and the build conditions the recorded rulings add). One line per step:
// DRYRUN <step> PASS|FAIL <detail>, then DRYRUN: PASS only when every step passed. A step whose unit is not built prints
// FAIL not built (unit N). Each unit fills its step's run.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { armSpec, CLOSING_LINES } from "../../quick/laneb/runner/grid.ts";
import { ARMS, bundleLists, capsTotalUsd, CLOSING, HM, loadBundle, REPO } from "./pins.ts";
import { stepArmTars, stepEnv, stepVerifyHook } from "./arms.ts";
import { stepMatcher72, stepPin, stepProbes189, stepStopHook } from "./match.ts";
import { itemPlan, ITEMS } from "./plans.ts";
import { stepPatterns, stepScorer } from "./score.ts";
import { stepAmendment, stepAnalysis, stepVerdictTables } from "./synth.ts";
import { stepLeases, stepLedger, stepReserve } from "./money.ts";
import { stepD1Checks } from "./d1.ts";
import { stepSessionPath } from "./session-path.ts";
import { stepReplay } from "./replay-fake.ts";
import { stepReplayClients } from "./replay-dryrun.ts";
import { stepJudgeHooks } from "./judge-dryrun.ts";

export type StepResult = { pass: boolean; detail: string };
export type Step = { name: string; units: number[]; run?: (out: string) => StepResult };

// The skeleton's own check: the bundle loads at its digests, the caps sum, the plans hold the prereg's counts, the arm
// specs parse and the closing line is one text in grid.ts and prompt_builder.py.
function skeleton(): StepResult {
  const b = loadBundle();
  const l = bundleLists(b);
  const counts = Object.keys(ITEMS).map((i) => [i, itemPlan(i, l)] as const);
  const want: Record<string, [number, number]> = { stage1: [160, 40], "stage1-opus-r2": [92, 23], stage3: [72, 0], stage4: [920, 200] };
  const bad = counts.find(([i, p]) => { const w = want[i] ?? want[i.split("-")[0]!]!; return p.sessions !== w[0] || p.picker_calls !== w[1]; });
  if (bad) return { pass: false, detail: bad[0] + " plans " + bad[1].sessions + " sessions and " + bad[1].picker_calls + " picker calls" };
  if (capsTotalUsd() !== 2880) return { pass: false, detail: "caps sum to " + capsTotalUsd() };
  for (const a of Object.values(ARMS)) armSpec(a.spec);
  const py = readFileSync(join(REPO, "quick/laneb/runner/agent/prompt_builder.py"), "utf8");
  if ((CLOSING_LINES as Record<string, string>)[CLOSING.key] !== CLOSING.text || !py.includes(JSON.stringify(CLOSING.key) + ": " + JSON.stringify(CLOSING.text))) return { pass: false, detail: "the closing line differs between pins.ts, grid.ts and prompt_builder.py" };
  return { pass: true, detail: b.digests.size + " attachments at their digests; caps 2880; " + counts.map(([i, p]) => i + " " + p.sessions).join(", ") + "; seed " + HM.seed };
}

export const STEPS: Step[] = [
  { name: "skeleton", units: [1], run: skeleton },
  { name: "1-arm-tars", units: [5], run: stepArmTars },
  { name: "2-verify-hook", units: [5], run: stepVerifyHook },
  { name: "3-matcher-probes", units: [2], run: stepPin },
  { name: "4-scorer", units: [3], run: stepScorer },
  { name: "5-judgment-hooks", units: [7], run: stepJudgeHooks },
  { name: "6-ledger", units: [6], run: stepLedger },
  { name: "7-leak-scan-env", units: [5, 7], run: stepEnv },
  { name: "8-analysis", units: [4], run: stepAnalysis },
  { name: "stop-hook-loadline", units: [2], run: stepStopHook },
  { name: "matcher-72", units: [2], run: stepMatcher72 },
  { name: "probes-189", units: [2], run: stepProbes189 },
  { name: "patterns-per-arm", units: [3], run: stepPatterns },
  { name: "verdict-tables", units: [4], run: stepVerdictTables },
  { name: "h1-amendment", units: [4], run: stepAmendment },
  { name: "leases-per-item", units: [6], run: stepLeases },
  { name: "reserve-mechanics", units: [6], run: stepReserve },
  { name: "d1-checks", units: [5, 6], run: stepD1Checks },
  { name: "d2-session-path", units: [5, 6], run: stepSessionPath },
  { name: "10-replay", units: [8], run: stepReplay },
  { name: "10-replay-clients", units: [7, 8], run: stepReplayClients },
];

export function dryrun(out: string, steps: Step[] = STEPS): { lines: string[]; pass: boolean } {
  mkdirSync(out, { recursive: true });
  const results = steps.map((s) => {
    if (!s.run) return { name: s.name, pass: false, detail: "not built (unit " + s.units.join(", ") + ")" };
    try { return { name: s.name, ...s.run(out) }; } catch (e) { return { name: s.name, pass: false, detail: String((e as Error).message ?? e).split("\n")[0]! }; }
  });
  const pass = results.every((r) => r.pass);
  const lines = [...results.map((r) => "DRYRUN " + r.name + " " + (r.pass ? "PASS" : "FAIL") + " " + r.detail), "DRYRUN: " + (pass ? "PASS" : "FAIL")];
  writeFileSync(join(out, "dryrun.json"), JSON.stringify({ steps: results, pass }, null, 2) + "\n");
  writeFileSync(join(out, "dryrun.txt"), lines.join("\n") + "\n");
  return { lines, pass };
}

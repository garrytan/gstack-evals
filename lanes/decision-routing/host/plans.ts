// Copyright (c) 2026 Garry Tan. MIT License.
// Decision-routing batch plans (preregistration sections 5, 8 and 9) from the frozen draw lists beside the
// preregistration: calibration is N on both models over calibration.txt (dr-calibration); the pilot is R and P on both
// models over pilot.txt (dr-pilot-rp) plus J on both models, F on Opus and W over its first 12 (dr-pilot-jfw); scored is
// N, R and P per model over scored.txt (dr-scored-opus, dr-scored-sol); the subset stage is F on Opus and J on both models
// (dr-subset) plus W (dr-w-reference) over subset.txt. A failed scored task's spare replacement is not planned here.
//   plans --out <dir> [--prereg <dir>]   writes <dir>/{calibration,pilot,scored,subset}.json; run the pilot with --pilot.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PlanRow } from "./controller.ts";

export const PREREG = resolve(import.meta.dir, "../../../wiki/plans/2026-11-09-geva-411-decision-routing-prereg");
type Cell = [PlanRow["cell"], PlanRow["model"]];

const rows = (tasks: string[], item: string, cells: Cell[]): PlanRow[] => tasks.flatMap((task) => cells.map(([cell, model]) => ({ task, cell, model, item })));

export function buildPlans(prereg = PREREG): Record<"calibration" | "pilot" | "scored" | "subset", PlanRow[]> {
  const list = (name: string) => readFileSync(join(prereg, name), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const pilot = list("pilot.txt");
  const scored = list("scored.txt");
  const subset = list("subset.txt");
  return {
    calibration: rows(list("calibration.txt"), "dr-calibration", [["N", "opus"], ["N", "sol"]]),
    pilot: [...rows(pilot, "dr-pilot-rp", [["R", "opus"], ["R", "sol"], ["P", "opus"], ["P", "sol"]]), ...rows(pilot.slice(0, 12), "dr-pilot-jfw", [["J", "opus"], ["J", "sol"], ["F", "opus"], ["W", "particle"]])],
    scored: [...rows(scored, "dr-scored-opus", [["N", "opus"], ["R", "opus"], ["P", "opus"]]), ...rows(scored, "dr-scored-sol", [["N", "sol"], ["R", "sol"], ["P", "sol"]])],
    subset: [...rows(subset, "dr-subset", [["F", "opus"], ["J", "opus"], ["J", "sol"]]), ...rows(subset, "dr-w-reference", [["W", "particle"]])],
  };
}

export async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const out = flag("--out");
  if (!out) {
    console.error("E_USAGE: plans --out <dir> [--prereg <dir>]");
    return 2;
  }
  mkdirSync(out, { recursive: true });
  for (const [stage, plan] of Object.entries(buildPlans(flag("--prereg") ?? PREREG))) {
    writeFileSync(join(out, stage + ".json"), JSON.stringify(plan, null, 1) + "\n");
    console.log(stage + ": " + plan.length + " sessions, " + join(out, stage + ".json"));
  }
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

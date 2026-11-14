// Copyright (c) 2026 Garry Tan. MIT License.
// The authoring pilot end to end (prereg section 3, "Sets and timing"; plan K9, K12): the 8 pilot positions on the
// first 4 base apps, each through the unit pipeline with its author's input bundle, then the funnel, the pass rates per
// kind and the pilot cost stop on the money area's spend reading. Integration wires the real caller, parser, vocabulary
// and spend reader; the stop throws E_DC_AUTHOR_COST and the caller settles the leases (L5).
import { AUTHORING } from "../frozen.ts";
import type { BaseAppView, Deps, SpendReader } from "./seams.ts";
import { authorBundle } from "./bundle.ts";
import { draw, pilotPositions, type Draw } from "./draws.ts";
import { checkPilotFrom, kindRates, pilotCost, type KindRate, type PilotCost } from "./pilot.ts";
import { funnelTable, runUnit, type UnitOutcome } from "./pipeline.ts";
import { authorPrompt } from "./prompts.ts";

/** BT: a unit's id is "u" and its draw position, so ids and seeds are stable across relaunches. */
export const unitIdOf = (position: number): string => "u" + position;

/** One draw position through the pipeline, on the app the draw names. */
export async function runPosition(d: Draw, apps: readonly BaseAppView[], deps: Deps): Promise<UnitOutcome> {
  const app = apps[d.app]!;
  const bundle = authorBundle(app, d.kind).text;
  return runUnit({ unitId: unitIdOf(d.position), app, author: d.author, bundle, prompt: authorPrompt(bundle, d.kind) }, deps);
}

export interface PilotReport {
  draws: Draw[];
  outcomes: UnitOutcome[];
  funnel: ReturnType<typeof funnelTable>;
  kinds: KindRate[];
  cost: PilotCost;
}

/** The pilot: positions 1 to 4 and N + 1 to N + 4 in draw order, then the cost stop. sink gets the report before the stop can throw. */
export async function runPilot(apps: readonly BaseAppView[], deps: Deps, read: SpendReader, sink: (r: PilotReport) => void = () => {}): Promise<PilotReport> {
  if (apps.length < AUTHORING.pilot.baseApps) throw new Error("the pilot needs at least " + AUTHORING.pilot.baseApps + " base apps");
  const draws = pilotPositions(apps.length).map((p) => draw(p, apps.length));
  const outcomes: UnitOutcome[] = [];
  for (const d of draws) outcomes.push(await runPosition(d, apps, deps));
  const passing = outcomes.filter((o) => o.status === "pass").length;
  const kinds = kindRates(draws.map((d, i) => ({ kind: d.kind, passed: outcomes[i]!.status === "pass" })));
  const report: PilotReport = { draws, outcomes, funnel: funnelTable(outcomes), kinds, cost: pilotCost(read("dc-authoring-1"), passing) };
  sink(report);
  checkPilotFrom(read, passing);
  return report;
}

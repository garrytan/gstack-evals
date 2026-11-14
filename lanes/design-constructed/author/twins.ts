// Copyright (c) 2026 Garry Tan. MIT License.
// K8, twins with spares (prereg section 3, frozen, with gate 1's revision): in calibration draw order, the author family
// that didn't write a unit translates its plan, evidence and key onto the next kept base app in frame order (wrapping
// from the last to the first) with the frozen twin note. The second skin gets its own context and passes steps 3 to 7
// itself under the prereg's general rules, the one rewrite for a step 3 or audit input failure included. Second skins
// are written until 8 pairs pass or 16 have been tried. A pair whose skin fails is named and leaves the twin check;
// with fewer than 6 passing pairs the twin check can't run and the Captain decides before stage 1.
import { SETS } from "../frozen.ts";
import type { AuthorFamily, ChangeKind } from "../types.ts";
import { authorBundle } from "./bundle.ts";
import { otherFamily, runUnit, type UnitJob, type UnitOutcome } from "./pipeline.ts";
import { twinPrompt } from "./prompts.ts";
import type { BaseAppView, Deps } from "./seams.ts";
import type { UnitFiles } from "./unit.ts";

export interface CalibrationUnit {
  unitId: string;
  position: number;
  /** Its base app's index in frame order. */
  app: number;
  kind: ChangeKind;
  author: AuthorFamily;
  files: UnitFiles;
}

export interface TwinPair {
  first: string;
  second: string;
  targetApp: number;
  translator: AuthorFamily;
  status: "pass" | "fail";
  step: string | null;
  reason: string;
}

export interface TwinSupply {
  pairs: TwinPair[];
  passing: number;
  tried: number;
  /** runs: at least 6 passing pairs; captain: fewer, so the twin check can't run and the Captain decides. */
  admission: "runs" | "captain";
}

/** The second skin's unit id. */
export const twinId = (first: string): string => first + "-t";

export function twinJob(c: CalibrationUnit, apps: readonly BaseAppView[]): UnitJob {
  const target = (c.app + 1) % apps.length;
  const app = apps[target]!;
  const bundle = authorBundle(app, c.kind).text;
  return { unitId: twinId(c.unitId), app, author: otherFamily(c.author), bundle, prompt: twinPrompt(bundle, c.files) };
}

export async function sourceTwins(calibration: readonly CalibrationUnit[], apps: readonly BaseAppView[], deps: Deps, run: (job: UnitJob, deps: Deps) => Promise<UnitOutcome> = runUnit): Promise<TwinSupply> {
  const pairs: TwinPair[] = [];
  for (const c of [...calibration].sort((a, b) => a.position - b.position)) {
    if (pairs.filter((p) => p.status === "pass").length >= SETS.twins.passingPairs || pairs.length >= SETS.twins.maxTries) break;
    const job = twinJob(c, apps);
    const o = await run(job, deps);
    pairs.push({ first: c.unitId, second: job.unitId, targetApp: (c.app + 1) % apps.length, translator: job.author, status: o.status === "pass" ? "pass" : "fail", step: o.step, reason: o.reason });
  }
  const passing = pairs.filter((p) => p.status === "pass").length;
  return { pairs, passing, tried: pairs.length, admission: passing >= SETS.twins.minPairs ? "runs" : "captain" };
}

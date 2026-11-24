// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's one interim look (prereg, the Interim look section, with pre-run change 2's gate on terminal cells): at half
// the comparison units in seeded order, rounded down, once every cell of those units is terminal (scored or a gap). Futility
// only: C and P stop their remaining cells when the pooled 95% upper bounds of C minus N and P minus N both sit below +5,
// or, when one of the two reads untested on every model, when the other's does; with both untested there is no stop. At the
// look an arm is untested on a model when under 0.80 of its scored cells there are exposed.
import { E1, RUNS_ON, type E1Arm, type E1Model } from "./frozen.ts";
import { armState, infer, pairsOf, type Cell, type Reading } from "./readings.ts";

export interface Look {
  ready: boolean;
  /** Units in the look, in seeded order. */
  units: string[];
  /** Cells the look still waits on, as unit/arm/model/rep. */
  missing: string[];
  stop: boolean;
  CN: Reading | null;
  PN: Reading | null;
  /** Models each of C and P is exposed on at the look. */
  exposedOn: { C: E1Model[]; P: E1Model[] };
}

const exposedOn = (cells: Cell[], arm: E1Arm) => RUNS_ON[arm].filter((m) => (armState(cells, arm, m).exposure ?? 0) >= E1.exposure.final);

export function look(order: readonly string[], cells: Cell[], seed: number, draws?: number): Look {
  const units = order.slice(0, Math.floor(order.length * E1.look.fraction));
  const inLook = new Set(units);
  const have = new Set(cells.filter((c) => inLook.has(c.unit)).map((c) => [c.unit, c.arm, c.model, c.rep].join("/")));
  const missing: string[] = [];
  for (const u of units) for (const a of Object.keys(RUNS_ON) as E1Arm[]) for (const m of RUNS_ON[a]) for (let k = 0; k < E1.cells; k++) if (!have.has([u, a, m, k].join("/"))) missing.push([u, a, m, k].join("/"));
  const at = cells.filter((c) => inLook.has(c.unit));
  const on = { C: exposedOn(at, "C"), P: exposedOn(at, "P") };
  const CN = missing.length ? null : infer(pairsOf(at, "C", "N", on.C), seed, draws);
  const PN = missing.length ? null : infer(pairsOf(at, "P", "N", on.P), seed, draws);
  const below = (r: Reading | null) => r !== null && r.hi < E1.lookStop;
  let stop = false;
  if (!missing.length) {
    if (on.C.length && on.P.length) stop = below(CN) && below(PN);
    else if (on.C.length) stop = below(CN);
    else if (on.P.length) stop = below(PN);
  }
  return { ready: !missing.length, units, missing, stop, CN, PN, exposedOn: on };
}

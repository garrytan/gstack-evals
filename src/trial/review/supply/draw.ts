// The draw (plan 2026-11-24-geva-590-review-models-prereg, section 2 and "Pilots"; pre-run change 1, item 1). From gate
// results and visibility reads, in this order, each set held back before the next is drawn:
// 1. Pilot P: the last 5 gated P units Harness Evals never ran, in suite rank order.
// 2. Pilot B: the first 5 gated B units in draw order.
// 3. Pilot decoy: the first gated decoy in seeded order (seededShuffle of decoy ids, draw seed). It is one of the
//    counted run's decoys too, since the counted run scores all 15 and the plan holds back only bug units.
// 4. Validation batch: the first 15 of the remaining gated bug units, P and B together, in seeded order (seededShuffle
//    of their ids sorted, draw seed).
// 5. Counted set: every remaining gated P unit in suite rank order, then remaining gated B units in draw order, to 100,
//    with at most 3 units a repository (gate 5) across the counted set. Below 80 the draw refuses.
// Every gated decoy is a counted decoy. The draw refuses while any unit's gate result is pending.
import { passed } from "./gates.ts";
import { supplyFail } from "./git.ts";
import { bUnitRef, DRAW_SEED, seededShuffle, type BRecord } from "./b-units.ts";
import type { PRecord } from "./p-units.ts";
import { visPassed, type VisResult } from "./visibility.ts";

export const TARGET = 100;
export const FLOOR = 80;
export const REPO_CAP = 3;
export const PILOT_P = 5;
export const PILOT_B = 5;
export const VALIDATION = 15;

export interface DrawnUnit { id: string; pool: "P" | "B" | "decoy"; repo: string; rank?: number; position?: number; ghsa?: string }

export interface Draw {
  schema: "rm-draw.v1";
  draw_seed: number;
  pilot: { p: DrawnUnit[]; b: DrawnUnit[]; decoy: DrawnUnit };
  validation: DrawnUnit[];
  counted: DrawnUnit[];
  decoys: DrawnUnit[];
  /** Gated units the counted set passed over for gate 5. */
  capped: DrawnUnit[];
}

const pUnit = (r: PRecord): DrawnUnit => (r.decoy ? { id: r.id, pool: "decoy", repo: r.repo } : { id: r.id, pool: "P", repo: r.repo, rank: r.rank! });
const bUnit = (r: BRecord): DrawnUnit => ({ id: bUnitRef(r).id, pool: "B", repo: r.repo, position: r.position, ghsa: r.ghsa });

/** Units whose gate results are not all in: a P record with no error missing gate 1 or 4; a B record with no error
 *  missing gate 1 or 2, or passing both with no gate 4 or no settled visibility read. */
export function pendingUnits(p: readonly PRecord[], b: readonly BRecord[], vis: Record<string, VisResult>): string[] {
  const out: string[] = [];
  for (const r of p) if (!r.error && (!r.gates.g1 || !r.gates.g4)) out.push(r.id);
  for (const r of b) {
    if (r.error) continue;
    if (!r.gates.g1 || !r.gates.g2) out.push(r.ghsa);
    else if (passed(r.gates.g1) && passed(r.gates.g2) && (!r.gates.g4 || (passed(r.gates.g4) && !vis[r.ghsa]?.g3))) out.push(r.ghsa);
  }
  return out;
}

export function draw(p: readonly PRecord[], b: readonly BRecord[], vis: Record<string, VisResult>, seed = DRAW_SEED): Draw {
  const pending = pendingUnits(p, b, vis);
  if (pending.length) supplyFail("E_RMS_PENDING", pending.length + " units have gate results pending: " + pending.slice(0, 10).join(", ") + (pending.length > 10 ? " and more" : ""));
  const ok = (r: PRecord) => !r.error && passed(r.gates.g1) && passed(r.gates.g4);
  const gatedP = p.filter((r) => !r.decoy && ok(r)).sort((x, y) => x.rank! - y.rank!).map(pUnit);
  const neverRan = new Set(p.filter((r) => !r.decoy && !r.ran).map((r) => r.id));
  const decoys = p.filter((r) => r.decoy && ok(r)).map(pUnit).sort((x, y) => (x.id < y.id ? -1 : 1));
  const gatedB = b.filter((r) => !r.error && passed(r.gates.g1) && passed(r.gates.g2) && passed(r.gates.g4) && visPassed(vis[r.ghsa])).sort((x, y) => x.position - y.position).map(bUnit);
  const pilotP = gatedP.filter((u) => neverRan.has(u.id)).slice(-PILOT_P);
  const pilotB = gatedB.slice(0, PILOT_B);
  if (pilotP.length < PILOT_P || pilotB.length < PILOT_B || !decoys.length) supplyFail("E_RMS_FLOOR", "the pilot needs " + PILOT_P + " P units Harness Evals never ran, " + PILOT_B + " B units and a decoy; the gates passed " + pilotP.length + ", " + pilotB.length + " and " + decoys.length);
  const decoy = seededShuffle(decoys, seed)[0]!;
  const held = new Set([...pilotP, ...pilotB].map((u) => u.id));
  const rest = [...gatedP, ...gatedB].filter((u) => !held.has(u.id));
  const validation = seededShuffle([...rest].sort((x, y) => (x.id < y.id ? -1 : 1)), seed).slice(0, VALIDATION);
  for (const u of validation) held.add(u.id);
  const counted: DrawnUnit[] = [], capped: DrawnUnit[] = [];
  const perRepo = new Map<string, number>();
  for (const u of rest) {
    if (held.has(u.id) || counted.length >= TARGET) continue;
    const n = perRepo.get(u.repo) ?? 0;
    if (n >= REPO_CAP) {
      capped.push(u);
      continue;
    }
    perRepo.set(u.repo, n + 1);
    counted.push(u);
  }
  if (counted.length < FLOOR) supplyFail("E_RMS_FLOOR", "the counted set holds " + counted.length + " bug units, under the floor of " + FLOOR + " (" + gatedP.length + " P and " + gatedB.length + " B passed every gate; " + held.size + " are held back for the pilot and validation batch, and " + capped.length + " were passed over at " + REPO_CAP + " a repository)");
  return { schema: "rm-draw.v1", draw_seed: seed, pilot: { p: pilotP, b: pilotB, decoy }, validation, counted, decoys, capped };
}

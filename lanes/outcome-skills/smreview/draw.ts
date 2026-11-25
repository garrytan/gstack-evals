// Copyright (c) 2026 Garry Tan. MIT License.
// SR's draw (plan section 3): the pool rows that pass the BIC gates, in one seeded order (seededRandom(draw_seed), a
// Fisher-Yates shuffle of the ids in sorted order), walked through pstack-checks' gates (labels, oracle, neutral tree) at
// most 3 units a repository. The first 6 kept units are the pilot's and the next 40 the counted run's; the pilot's are
// never counted. A gate with no record yet stops the walk where it stands, so the draw resumes as records arrive.
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import type { Drop, Gate } from "../pfchecks/draw.ts";
import type { BicRecord } from "./bic.ts";
import { N_MAX, PILOT_UNITS } from "./items.ts";
import { srFail } from "./errors.ts";

export const PER_REPO_DRAW = 3;
export interface SrDraw { schema: "sr-draw.v1"; draw_seed: number; pilot: string[]; test: string[]; drops: Drop[]; capped: string[]; pending: { id: string; gate: string; why: string } | null; order: string[] }

export function srOrder(ids: string[], seed: number): string[] {
  if (!Number.isSafeInteger(seed) || seed < 0) srFail("E_SR_INPUT", "the draw seed must be a whole number, from prereg.json draw_seed");
  const out = [...ids].sort();
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function srDraw(bics: BicRecord[], seed: number, gates: Gate[], n = N_MAX): SrDraw {
  const kept = bics.filter((b) => !b.drop);
  if (new Set(kept.map((b) => b.id)).size !== kept.length) srFail("E_SR_INPUT", "the BIC records repeat an id");
  const repo = new Map(kept.map((b) => [b.id, b.repo]));
  const order = srOrder(kept.map((b) => b.id), seed);
  const d: SrDraw = { schema: "sr-draw.v1", draw_seed: seed, pilot: [], test: [], drops: [], capped: [], pending: null, order };
  const per = new Map<string, number>();
  for (const id of order) {
    if (d.pilot.length >= PILOT_UNITS && d.test.length >= n) break;
    if ((per.get(repo.get(id)!) ?? 0) >= PER_REPO_DRAW) { d.capped.push(id); continue; }
    let dropped = false;
    for (const g of gates) {
      const r = g.check(id);
      if ("pending" in r) { d.pending = { id, gate: g.name, why: r.why }; return d; }
      if (!r.ok) { d.drops.push({ id, gate: g.name, code: r.code, reason: r.reason }); dropped = true; break; }
    }
    if (dropped) continue;
    (d.pilot.length < PILOT_UNITS ? d.pilot : d.test).push(id);
    per.set(repo.get(id)!, (per.get(repo.get(id)!) ?? 0) + 1);
  }
  return d;
}

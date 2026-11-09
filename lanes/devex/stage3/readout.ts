// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's readout (prereg 2026-11-09-geva-417, section 12 "Measures" and "Readout"): each measure, paired by unit
// against the none block, with a 95% cluster-bootstrap interval (the shared lanes/aftermath/stats.ts bootstrap over
// repository clusters) and the worse count. A missing build (contaminated, or stopped by infra) drops its unit from that
// arm's pairs, and a missing none build drops the unit from every arm's pairs; a
// build that E_DX_BUILD_INSTRUMENT or a missing tree scored 0 stays in as 0. Stage 3 is descriptive and decides nothing
// except the KEEP flag.
import { clusterBootstrap, DRAWS, mean, percentileInterval, r4 } from "../../aftermath/stats.ts";
import { SEED, type ArmId } from "../types.ts";
import type { BuildMeasures } from "./firstsuccess.ts";

export const STAGE3_ARMS: readonly ArmId[] = ["lens", "plan-devex-review", "autoplan"];
export type Measure = "first_success" | "turns" | "minutes" | "failed_commands" | "probe_share" | "readme_share";
/** +1 where higher is better, -1 where lower is. */
export const DIRECTION: Readonly<Record<Measure, 1 | -1>> = { first_success: 1, turns: -1, minutes: -1, failed_commands: -1, probe_share: 1, readme_share: 1 };
const STAT = { seed: SEED, draws: DRAWS };

export interface PairedMeasure {
  arm: ArmId;
  measure: Measure;
  units: number;
  /** Mean over units of arm minus none. */
  delta: number | null;
  ci95: [number, number] | null;
  /** Units where the arm did worse than none. */
  worse: number;
}

export interface Readout {
  measures: PairedMeasure[];
  counts: { builds: number; contaminated: number; missing: number; instrument: number; by_reason: Record<string, number> };
}

export function readout(builds: readonly BuildMeasures[], repoOf: (unit: string) => string): Readout {
  const at = (unit: string, arm: ArmId) => builds.find((b) => b.unit === unit && b.arm === arm && !b.missing);
  const units = [...new Set(builds.map((b) => b.unit))].sort();
  const out: PairedMeasure[] = [];
  for (const arm of STAGE3_ARMS)
    for (const measure of Object.keys(DIRECTION) as Measure[]) {
      const pts = units.flatMap((u) => {
        const a = at(u, "none")?.[measure], b = at(u, arm)?.[measure];
        return a === null || a === undefined || b === null || b === undefined ? [] : [{ unit: u, d: b - a }];
      });
      const draws = pts.length ? clusterBootstrap(pts, (p) => repoOf(p.unit), (s) => mean(s.map((p) => p.d)), STAT) : [];
      const ci = draws.length ? percentileInterval(draws, 0.95) : null;
      out.push({ arm, measure, units: pts.length, delta: pts.length ? r4(mean(pts.map((p) => p.d))) : null, ci95: ci ? [r4(ci[0]), r4(ci[1])] : null, worse: pts.filter((p) => p.d * DIRECTION[measure] < 0).length });
    }
  const by_reason: Record<string, number> = {};
  for (const b of builds) if (b.instrument && !b.missing) by_reason[b.instrument] = (by_reason[b.instrument] ?? 0) + 1;
  return { measures: out, counts: { builds: builds.length, contaminated: builds.filter((b) => b.contaminated).length, missing: builds.filter((b) => b.missing).length, instrument: builds.filter((b) => b.code === "E_DX_BUILD_INSTRUMENT").length, by_reason } };
}

export function printReadout(r: Readout): string {
  const f = (x: number | null) => (x === null ? "-" : String(x));
  const lines = ["arm\tmeasure\tunits\tdelta\tci95\tworse", ...r.measures.map((m) => [m.arm, m.measure, m.units, f(m.delta), m.ci95 ? "[" + m.ci95[0] + ", " + m.ci95[1] + "]" : "-", m.worse].join("\t"))];
  lines.push("builds " + r.counts.builds + ", contaminated " + r.counts.contaminated + ", missing " + r.counts.missing + ", E_DX_BUILD_INSTRUMENT " + r.counts.instrument + ", first success 0 without a session: " + (Object.entries(r.counts.by_reason).map(([k, v]) => k + " " + v).join(", ") || "none"));
  return lines.join("\n");
}

// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 10's secondaries, descriptive with no Holm: per model, cso minus none on complete pairs with a 95%
// repository-clustered bootstrap interval for each per-session secondary of section 5 and the final-message delivery
// measure; key and known-real precision pooled per cell; outcome counts per cell; the named rate by stratum (part,
// ecosystem, library or service, repository size split at the median count of non-test source files, and the strict
// month stratum from 2026-10-01); and the miss anatomy counted per arm, built by missMap.
import { clusteredPairedDelta } from "../../../../src/runner/stats/paired.ts";
import { DRAWS, percentile } from "../../h2h/analysis/stats.ts";
import type { CsoPrereg } from "../prereg.ts";
import type { CsoModel, SessionRecord, UnitRecord } from "../types.ts";
import { missAnatomy, pooledPrecision, type CsoScore, type Judged, type Miss } from "../score/outcomes.ts";
import type { TreeIndex } from "../score/checks.ts";
import { scoredText } from "../score/text.ts";
import { Data, PRIMARY_MODELS, type AnalysisInput } from "./verdicts.ts";

export const STRICT_FROM = "2026-10-01";
type Key = "named" | "named_final" | "file_level" | "supported" | "unsupported" | "cant_tell" | "findings_total" | "phantoms" | "cost_usd";
const KEYS: Key[] = ["named", "named_final", "file_level", "supported", "unsupported", "cant_tell", "findings_total", "phantoms", "cost_usd"];
export interface Diff { n: number; none: number | null; cso: number | null; delta: number | null; ci95: [number, number] | null; note?: typeof NOT_VALIDATED }
/** Section 7: when a model's validity label fails its check, its validity numbers are left out and carry this note. */
export const NOT_VALIDATED = "judge not validated";
const VALIDITY_KEYS: readonly Key[] = ["supported", "unsupported", "cant_tell"];

const val = (s: CsoScore, k: Key): number | null => {
  if (k === "phantoms") return s.phantoms.paths + s.phantoms.lines;
  const v = s[k];
  return v === null || v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;
};

function diff(d: Data, us: readonly UnitRecord[], m: CsoModel, k: Key, seed: number): Diff {
  const rows = us.flatMap((u) => {
    const a = d.score(u, "none", m), b = d.score(u, "cso", m);
    const x = a && val(a, k), y = b && val(b, k);
    return x === null || y === null || x === undefined || y === undefined ? [] : [{ id: u.unit, cluster: u.repo, a: x, b: y }];
  });
  if (!rows.length) return { n: 0, none: null, cso: null, delta: null, ci95: null };
  const r = clusteredPairedDelta(rows, { seed, draws: DRAWS });
  return { n: r.n_pairs, none: r.mean_a, cso: r.mean_b, delta: r.delta, ci95: r.ci95 };
}

export interface Secondaries {
  model: CsoModel;
  diffs: Record<Key, Diff>;
  precision: Record<"none" | "cso", { key: ReturnType<typeof pooledPrecision>; known_real: ReturnType<typeof pooledPrecision>; over_k_share: number | null }>;
  outcomes: Record<"none" | "cso", Record<SessionRecord["end"], number>>;
  strata: Record<string, Diff>;
  miss: Record<"none" | "cso", Partial<Record<Miss, number>>>;
}

/** Section 10's miss anatomy input: for every stage 2 unit and primary model where one arm named the advisory and the other
 *  did not (both scored), the missing arm's session classified by missAnatomy from its record, its judged findings and its
 *  unit's audited tree, keyed "unit arm model". */
export function missMap(i: AnalysisInput, judged: (s: SessionRecord) => Judged | null, tree: (unit: string) => TreeIndex, p: CsoPrereg): Record<string, Miss> {
  const d = new Data(i);
  const out: Record<string, Miss> = {};
  for (const u of i.units) {
    for (const m of PRIMARY_MODELS) {
      const a = d.score(u, "none", m), b = d.score(u, "cso", m);
      if (a?.named == null || b?.named == null || a.named === b.named) continue;
      const arm = a.named ? "cso" : "none";
      const s = i.sessions.find((x) => x.stage === "stage2" && x.unit === u.unit && x.model === m && x.arm === arm);
      if (!s) continue;
      const j = judged(s);
      out[u.unit + " " + arm + " " + m] = missAnatomy(u, s, scoredText(s, p), j && Array.isArray(j.findings) ? j.findings : null, tree(u.unit), p);
    }
  }
  return out;
}

/** The descriptive secondaries for each primary model. misses holds each missed session's anatomy, keyed "unit arm model". */
export function secondaries(i: AnalysisInput, p: CsoPrereg, misses: Record<string, Miss> = {}): Secondaries[] {
  const d = new Data(i);
  const median = percentile(i.units.map((u) => u.source_files), 50) ?? 0;
  const strata: Record<string, (u: UnitRecord) => boolean> = {
    "part1": (u) => u.part === "part1", "part2": (u) => u.part === "part2", "library": (u) => u.kind === "library", "service": (u) => u.kind === "service",
    "size<=median": (u) => u.source_files <= median, "size>median": (u) => u.source_files > median, "strict month": (u) => u.published >= STRICT_FROM,
    ...Object.fromEntries([...new Set(i.units.map((u) => u.ecosystem))].sort().map((e) => ["ecosystem " + e, (u: UnitRecord) => u.ecosystem === e])),
  };
  return PRIMARY_MODELS.map((m) => {
    const cell = (arm: "none" | "cso") => i.units.map((u) => d.score(u, arm, m)).filter((s): s is CsoScore => s !== null);
    const ends = (arm: "none" | "cso") => {
      const out = { completed: 0, limit_wall: 0, limit_turns: 0, limit_allowance: 0, safety_stop: 0, gap: 0 };
      for (const s of i.sessions) if (s.stage === "stage2" && s.model === m && s.arm === arm) out[s.end]++;
      return out;
    };
    const missOf = (arm: "none" | "cso") => {
      const out: Partial<Record<Miss, number>> = {};
      for (const u of i.units) {
        const x = misses[u.unit + " " + arm + " " + m];
        if (x) out[x] = (out[x] ?? 0) + 1;
      }
      return out;
    };
    const prec = (arm: "none" | "cso") => {
      const c = cell(arm);
      return { key: pooledPrecision(c, "hits"), known_real: pooledPrecision(c, "known_real"), over_k_share: c.length ? c.filter((s) => s.over_k).length / c.length : null };
    };
    return {
      model: m,
      diffs: Object.fromEntries(KEYS.map((k) => [k, VALIDITY_KEYS.includes(k) && !i.judge[m]?.validity ? { n: 0, none: null, cso: null, delta: null, ci95: null, note: NOT_VALIDATED } : diff(d, i.units, m, k, p.bootstrap_seed)])) as Record<Key, Diff>,
      precision: { none: prec("none"), cso: prec("cso") },
      outcomes: { none: ends("none"), cso: ends("cso") },
      strata: Object.fromEntries(Object.entries(strata).map(([k, f]) => [k, diff(d, i.units.filter(f), m, "named", p.bootstrap_seed)])),
      miss: { none: missOf("none"), cso: missOf("cso") },
    };
  });
}

// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 2's draw. The pool is the state machines harness's converted MultiLang candidates created 2025-01-01 to
// 2026-07-31 that pass its keyless screen. One seededRandom(draw_seed) shuffles each month once (ids sorted first), months
// in the order the draw first walks them: March to June 2026, then July 2026, then February 2026 back to January 2025.
// Admission walks March to June 2026 and keeps 8; a raise keeps the next 8 in that order; the test set walks July 2026
// back to January 2025 until n are kept; the next 10 kept in that order are the reserve. At most 3 kept units a repository
// across all of them, reserve included; a dropped unit uses no slot; each candidate is asked once. The gates run lazily in
// draw order: labels, the oracle record, the told-mode screen, the neutral validation. A gate whose input is not there
// yet stops the walk and names the candidate it waits on (E_PF_PENDING). The pool needs sm source split's fields on every
// row in a language with a test-module detector (rust), so the screen's mixed-hunk drop runs, and refuses the file
// otherwise (E_PF_INPUT).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { TEST_MODULES } from "../statemachines/langs.ts";
import { combineLabels, type LabelAnswer } from "../statemachines/packets.ts";
import { screenOne } from "../statemachines/screen.ts";
import type { Candidate } from "../statemachines/source.ts";
import { readUnit } from "../statemachines/unit.ts";
import type { NeutralRecord } from "./neutral.ts";
import { pfFail } from "./prereg.ts";
import { toldScreen } from "./told.ts";

export const WINDOW = { from: "2025-01-01", to: "2026-07-31" } as const;
export const SIZES = { admission: 8, raise: 8, reserve: 10, cap: 3, max_n: 60 } as const;
export const ADMISSION_MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06"];
export const TEST_MONTHS: string[] = (() => {
  const out: string[] = [];
  for (let t = 2026 * 12 + 6; t >= 2025 * 12; t--) out.push(Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0"));
  return out;
})();
export type Stratum = "july-2026" | "jan-jun-2026" | "pre-2026";
export const stratumOf = (month: string): Stratum => (month === "2026-07" ? "july-2026" : month >= "2026-01" ? "jan-jun-2026" : "pre-2026");

export interface DrawUnit { id: string; repo: string; month: string }
const splitShaped = (s: unknown): boolean => {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  if (keys === "error") return typeof o.error === "string";
  return keys === "mixed,source_files,test_hunks" && [o.mixed, o.source_files, o.test_hunks].every((v) => Number.isInteger(v) && (v as number) >= 0);
};
export function poolOf(cands: Candidate[]): DrawUnit[] {
  const bare = cands.filter((c) => TEST_MODULES[c.lang] && !splitShaped(c.split));
  if (bare.length) pfFail("E_PF_INPUT", bare.length + " " + [...new Set(bare.map((c) => c.lang))].sort().join(", ") + " candidates carry no sm source split fields or malformed ones, so section 2's mixed-hunk screen cannot run: " + bare.slice(0, 5).map((c) => c.id).join(", ") + (bare.length > 5 ? " and " + (bare.length - 5) + " more" : "") + "; run sm source split on the candidates file first");
  return cands.filter((c) => c.created_at.slice(0, 10) >= WINDOW.from && c.created_at.slice(0, 10) <= WINDOW.to && screenOne(c) === null).map((c) => ({ id: c.id, repo: c.repo, month: c.month }));
}

export function monthOrders(units: DrawUnit[], seed: number): Map<string, DrawUnit[]> {
  const rnd = seededRandom(seed);
  const out = new Map<string, DrawUnit[]>();
  for (const m of [...ADMISSION_MONTHS, ...TEST_MONTHS.filter((x) => !ADMISSION_MONTHS.includes(x))]) {
    const g = units.filter((u) => u.month === m).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [g[i], g[j]] = [g[j]!, g[i]!];
    }
    out.set(m, g);
  }
  return out;
}

export type GateResult = { ok: true } | { ok: false; code: ReasonCode; reason: string } | { pending: true; why: string };
export interface Gate { name: string; check: (id: string) => GateResult }
export interface Drop { id: string; gate: string; code: ReasonCode; reason: string }
export interface PfDraw {
  schema: "pf-draw.v1"; draw_seed: number; admission: string[]; raise: string[]; test: string[]; reserve: string[];
  units: Record<string, { repo: string; month: string; stratum: Stratum }>; drops: Drop[]; by_code: Record<string, Record<string, number>>;
  capped: string[]; pending: { id: string; gate: string; why: string; phase: string } | null; short: { phase: string; wanted: number; got: number }[];
}

export function walkDraw(units: DrawUnit[], seed: number, gates: Gate[], opts: { raise?: boolean; n?: number } = {}): PfDraw {
  if (new Set(units.map((u) => u.id)).size !== units.length) pfFail("E_PF_INPUT", "the candidate pool repeats an id");
  if (opts.n !== undefined && !(Number.isInteger(opts.n) && opts.n >= 1 && opts.n <= SIZES.max_n)) pfFail("E_PF_INPUT", "n must be an integer from 1 to " + SIZES.max_n);
  const orders = monthOrders(units, seed);
  const adm = ADMISSION_MONTHS.flatMap((m) => orders.get(m) ?? []);
  const tst = TEST_MONTHS.flatMap((m) => orders.get(m) ?? []);
  const d: PfDraw = { schema: "pf-draw.v1", draw_seed: seed, admission: [], raise: [], test: [], reserve: [], units: {}, drops: [], by_code: {}, capped: [], pending: null, short: [] };
  const asked = new Set<string>(), kept = new Map<string, number>(), capped = new Set<string>();
  const take = (order: DrawUnit[], k: number, phase: string, into: string[]): boolean => {
    for (const u of order) {
      if (into.length >= k) break;
      if (asked.has(u.id)) continue;
      if ((kept.get(u.repo) ?? 0) >= SIZES.cap) {
        capped.add(u.id);
        continue;
      }
      let dropped = false;
      for (const g of gates) {
        const r = g.check(u.id);
        if ("pending" in r) {
          d.pending = { id: u.id, gate: g.name, why: r.why, phase };
          return false;
        }
        if (!r.ok) {
          d.drops.push({ id: u.id, gate: g.name, code: r.code, reason: r.reason });
          dropped = true;
          break;
        }
      }
      asked.add(u.id);
      if (dropped) continue;
      into.push(u.id);
      kept.set(u.repo, (kept.get(u.repo) ?? 0) + 1);
      d.units[u.id] = { repo: u.repo, month: u.month, stratum: stratumOf(u.month) };
    }
    if (into.length < k) d.short.push({ phase, wanted: k, got: into.length });
    return true;
  };
  void (take(adm, SIZES.admission, "admission", d.admission) && (!opts.raise || take(adm, SIZES.raise, "raise", d.raise)) && (opts.n === undefined || (take(tst, opts.n, "test", d.test) && take(tst, SIZES.reserve, "reserve", d.reserve))));
  for (const x of d.drops) (d.by_code[x.code] ??= {})[x.reason] = (d.by_code[x.code]![x.reason] ?? 0) + 1;
  d.capped = [...capped].filter((id) => !asked.has(id)).sort();
  return d;
}

export type Labels = Map<string, { astra: LabelAnswer | null; opus: LabelAnswer | null }>;
/** Label files (pf-labels.v1: { labels: { <id>: { astra, opus } } }); a later file never overrides an earlier one, so the
 *  state machines eval's records, listed first, win. */
export function readLabels(paths: string[]): Labels {
  const out: Labels = new Map();
  for (const p of paths) {
    let j: { schema?: string; labels?: Record<string, { astra: LabelAnswer | null; opus: LabelAnswer | null }> };
    try {
      j = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      return pfFail("E_PF_INPUT", p + " is not JSON: " + (e as Error).message);
    }
    if (j.schema !== "pf-labels.v1" || !j.labels) pfFail("E_PF_INPUT", p + " is not a pf-labels.v1 file");
    for (const [id, v] of Object.entries(j.labels!)) if (!out.has(id)) out.set(id, { astra: v.astra ?? null, opus: v.opus ?? null });
  }
  return out;
}

export const labelsGate = (labels: Labels): Gate => ({
  name: "labels",
  check: (id) => {
    const l = labels.get(id);
    if (!l) return { pending: true, why: "no label record" };
    const c = combineLabels(l.astra, l.opus);
    if (c.malformed.length) return { ok: false, code: "E_PF_LABELS", reason: "malformed" };
    if (!c.eligible) return { ok: false, code: "E_PF_LABELS", reason: "not_defect" };
    if (c.stratum !== "state") return { ok: false, code: "E_PF_LABELS", reason: c.stratum === "other" ? "not_state_shaped" : "unclear" };
    return { ok: true };
  },
});
export const oracleGate = (unitsDir: string): Gate => ({
  name: "oracle",
  check: (id) => {
    if (!existsSync(join(unitsDir, id, "unit.json"))) return { pending: true, why: "no unit dir" };
    const u = readUnit(join(unitsDir, id));
    if (!u.oracle || u.oracle.verdict === "running") return { pending: true, why: "no oracle record" };
    return u.oracle.verdict === "kept" ? { ok: true } : { ok: false, code: "E_PF_ORACLE", reason: u.oracle.verdict };
  },
});
export const toldGate = (unitsDir: string): Gate => ({
  name: "told",
  check: (id) => {
    const dir = join(unitsDir, id);
    const issue = existsSync(join(dir, "issue.md")) ? readFileSync(join(dir, "issue.md"), "utf8") : null;
    const r = toldScreen(issue, readFileSync(join(dir, "fix.patch"), "utf8"));
    return r ? { ok: false, code: "E_PF_TOLD", reason: r.rule } : { ok: true };
  },
});
export const neutralGate = (neutralDir: string): Gate => ({
  name: "neutral",
  check: (id) => {
    const p = join(neutralDir, id + ".json");
    if (!existsSync(p)) return { pending: true, why: "no neutral record" };
    const r = JSON.parse(readFileSync(p, "utf8")) as NeutralRecord;
    return r.verdict === "kept" ? { ok: true } : { ok: false, code: "E_PF_NEUTRAL_INVALID", reason: r.tried.map((t) => t.mode + ": " + t.reason.split(" ")[0]).join("; ") };
  },
});

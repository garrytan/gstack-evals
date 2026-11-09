// Copyright (c) 2026 Garry Tan. MIT License.
// Section 3's seeded draw. The seed is the preregistration's draw_seed (prereg.json in the post bundle, schema
// sm-prereg.v1); a missing file or key refuses with E_SM_SEED. One seededRandom(draw_seed) shuffles each month's units
// (ids sorted first), months in ascending order, so every unit has one fixed place. Orders: admission walks March to
// June; each test stratum walks July, June, May, April, March. The order is fixed before the oracle runs; fill walks it
// lazily, and only units that pass (the oracle) take a slot. At most 3 kept units per repository across admission,
// test, reserve and any file-scope retry. Admission takes 15 first, then the state stratum 30 and the other stratum 30,
// a short stratum's gap filled from the other, then a reserve of 10, then (only on a FLOOR reading) 15 retry units next
// in admission order. Unclear units are never drawn into a test stratum; they can be admission or retry units.
import { existsSync, readFileSync } from "node:fs";
import { seededRandom } from "../../../src/runner/stats/paired.ts";
import { MULTILANG } from "./source.ts";
import { smFail } from "./unit.ts";

export const SIZES = { admission: 15, state: 30, other: 30, reserve: 10, retry: 15, cap: 3 } as const;
export const ADMISSION_MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06"];
export const TEST_MONTHS = ["2026-07", "2026-06", "2026-05", "2026-04", "2026-03"];

export interface DrawUnit { id: string; repo: string; month: string; stratum: "state" | "other" | "unclear" }
export interface Draw { schema: "sm-draw.v1"; draw_seed: number; admission: string[]; state: string[]; other: string[]; repo: Record<string, string> }

const SEED_KEYS = ["draw_seed", "bootstrap_seed", "order_seed"] as const;
const u32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

/** Reads the preregistration's JSON and returns its seeds. Refuses (E_SM_SEED) on a missing file, schema or seed key, and
 *  (E_SM_SOURCE) when its MultiLang pin is not the revision this build reads. */
export function readPrereg(path: string): { draw_seed: number; bootstrap_seed: number; order_seed: number } {
  if (!existsSync(path)) smFail("E_SM_SEED", path + " does not exist; the draw seed is frozen in the preregistration's JSON, which the post owns");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return smFail("E_SM_SEED", path + " is not JSON: " + (e as Error).message);
  }
  if (j.schema !== "sm-prereg.v1") smFail("E_SM_SEED", path + " is not an sm-prereg.v1 file");
  for (const k of SEED_KEYS) if (!u32(j[k])) smFail("E_SM_SEED", path + " has no unsigned 32-bit integer " + k);
  const rev = (j.pins as { swe_bench_live_multilang?: { revision?: string } } | undefined)?.swe_bench_live_multilang?.revision;
  if (rev !== MULTILANG.revision) smFail("E_SM_SOURCE", path + " pins MultiLang revision " + rev + ", not " + MULTILANG.revision);
  return { draw_seed: j.draw_seed as number, bootstrap_seed: j.bootstrap_seed as number, order_seed: j.order_seed as number };
}

/** The seeded order of every unit: months ascending, ids sorted, then a Fisher-Yates shuffle within each month. */
export function seededOrder(units: DrawUnit[], seed: number): DrawUnit[] {
  const rnd = seededRandom(seed);
  const months = [...new Set(units.map((u) => u.month))].sort();
  const out: DrawUnit[] = [];
  for (const m of months) {
    const g = units.filter((u) => u.month === m).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = g.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [g[i], g[j]] = [g[j]!, g[i]!];
    }
    out.push(...g);
  }
  return out;
}

export function draw(units: DrawUnit[], seed: number): Draw {
  const ids = new Set<string>();
  for (const u of units) {
    if (ids.has(u.id)) smFail("E_USAGE", "unit " + u.id + " appears twice in the draw input");
    ids.add(u.id);
  }
  const order = seededOrder(units, seed);
  const inMonths = (ms: string[], f: (u: DrawUnit) => boolean) => ms.flatMap((m) => order.filter((u) => u.month === m && f(u)).map((u) => u.id));
  return {
    schema: "sm-draw.v1", draw_seed: seed,
    admission: inMonths(ADMISSION_MONTHS, () => true),
    state: inMonths(TEST_MONTHS, (u) => u.stratum === "state"),
    other: inMonths(TEST_MONTHS, (u) => u.stratum === "other"),
    repo: Object.fromEntries(units.map((u) => [u.id, u.repo])),
  };
}

export interface Fill { admission: string[]; state: string[]; other: string[]; reserve: string[]; retry: string[]; walked: { id: string; slot: string; kept: boolean | "cap" }[] }

/** Walks the draw lazily. passes(id) is the oracle; each id is asked at most once. retry is only filled when asked. */
export async function fill(d: Draw, passes: (id: string) => Promise<boolean> | boolean, opts: { retry?: boolean } = {}): Promise<Fill> {
  const f: Fill = { admission: [], state: [], other: [], reserve: [], retry: [], walked: [] };
  const used = new Set<string>(), asked = new Map<string, boolean>(), perRepo = new Map<string, number>();
  const pos: Record<"admission" | "state" | "other", number> = { admission: 0, state: 0, other: 0 };
  /** The next kept unit of one order, or null when it runs out. */
  const next = async (list: "admission" | "state" | "other", slot: string): Promise<string | null> => {
    const ids = d[list];
    while (pos[list] < ids.length) {
      const id = ids[pos[list]++]!;
      if (used.has(id) || asked.get(id) === false) continue;
      const repo = d.repo[id] ?? id;
      if ((perRepo.get(repo) ?? 0) >= SIZES.cap) {
        f.walked.push({ id, slot, kept: "cap" });
        continue;
      }
      if (!asked.has(id)) asked.set(id, await passes(id));
      const kept = asked.get(id)!;
      f.walked.push({ id, slot, kept });
      if (!kept) continue;
      used.add(id);
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      return id;
    }
    return null;
  };
  const take = async (list: "admission" | "state" | "other", into: string[], n: number, slot: string) => {
    while (into.length < n) {
      const id = await next(list, slot);
      if (id === null) return false;
      into.push(id);
    }
    return true;
  };
  await take("admission", f.admission, SIZES.admission, "admission");
  await take("state", f.state, SIZES.state, "state");
  await take("other", f.other, SIZES.other, "other");
  const total = SIZES.state + SIZES.other;
  if (f.state.length < SIZES.state) await take("other", f.other, total - f.state.length, "other");
  if (f.other.length < SIZES.other) await take("state", f.state, total - f.other.length, "state");
  let turn: "state" | "other" = "state";
  const out = { state: false, other: false };
  while (f.reserve.length < SIZES.reserve && !(out.state && out.other)) {
    if (!out[turn]) {
      const id = await next(turn, "reserve");
      if (id === null) out[turn] = true;
      else f.reserve.push(id);
    }
    turn = turn === "state" ? "other" : "state";
  }
  if (opts.retry) await take("admission", f.retry, SIZES.retry, "retry");
  return f;
}

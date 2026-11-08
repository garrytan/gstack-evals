// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals pv sets calibration (prereg section 4, timing and sets): the 24-unit calibration slice. 16 audited
// closed-window public units in seeded order (seed 20261108), quotas first (2 each of mobile, consumer and server-side
// data or enterprise), then transposed twins of the first 8 draws. A named type with fewer than 2 audited public units
// gets transposed fill-ins of that type in the same seeded order, taking the last public draws counting back from draw
// 16; at most 2 fill-ins, and a second short type is a supply stop. Pilot units and twins never enter the draw.
//   pv sets calibration --units <dir> [--units <dir>] --audited <ids file> --out <sets.json> [--write]
// An audited unit has a classifier label (unit/classify.json) and a screened key with at least one primary item that is
// neither generic nor mentioned. --write records set, rank and fill_in in each drawn unit's unit.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Io } from "../cli.ts";
import type { Key, ProjectType, UnitMeta } from "../types.ts";
import { order, SEED } from "./mine.ts";
import { AuthorError, pinnedHead, put, readJson } from "./run.ts";

export const NAMED: readonly ProjectType[] = ["mobile", "consumer", "server"];
export const PUBLIC_DRAWS = 16;
export const TWINS = 8;
export const MAX_FILL_INS = 2;

export interface PoolUnit { id: string; source: "public" | "transposed"; type: ProjectType; set: string; twin_of?: string }
export interface Draw { rank: number; id: string; source: "public" | "transposed"; type: ProjectType; fill_in: boolean }

const byOrder = (a: PoolUnit, b: PoolUnit) => (order(a.id) < order(b.id) ? -1 : 1);

/** The calibration draw: public draws 1..16 (quotas first), fill-ins in the last places, and the ids that get twins. */
export function drawCalibration(pool: readonly PoolUnit[]): { slice: Draw[]; twins: string[] } {
  const eligible = pool.filter((u) => u.set !== "pilot" && !u.twin_of).sort(byOrder);
  const pub = eligible.filter((u) => u.source === "public");
  const short = NAMED.map((t) => ({ t, need: Math.max(0, 2 - pub.filter((u) => u.type === t).length) })).filter((s) => s.need > 0);
  const counts = NAMED.map((t) => t + " " + pub.filter((u) => u.type === t).length + " public, " + eligible.filter((u) => u.source === "transposed" && u.type === t).length + " transposed").join("; ");
  if (short.length > 1) throw new AuthorError("E_PV_SUPPLY_SHORT", "a second named type is short of 2 audited public units in the calibration slice (" + counts + ")");
  const fills = short.flatMap((s) => eligible.filter((u) => u.source === "transposed" && u.type === s.t).slice(0, s.need));
  if (fills.length < short.reduce((n, s) => n + s.need, 0) || fills.length > MAX_FILL_INS) throw new AuthorError("E_PV_SUPPLY_SHORT", "the calibration slice needs fill-ins the transposed units cannot give (" + counts + ")");
  const want = PUBLIC_DRAWS - fills.length;
  const quota = NAMED.flatMap((t) => pub.filter((u) => u.type === t).slice(0, 2)).sort(byOrder);
  const rest = pub.filter((u) => !quota.includes(u)).slice(0, want - quota.length);
  if (quota.length + rest.length < want) throw new AuthorError("E_USAGE", "the calibration draw needs " + want + " audited public units; " + pub.length + " are audited (" + counts + ")");
  const slice = [...quota, ...rest, ...fills.sort(byOrder)].map((u, i) => ({ rank: i + 1, id: u.id, source: u.source, type: u.type, fill_in: u.source === "transposed" }));
  return { slice, twins: slice.slice(0, TWINS).map((d) => d.id) };
}

/** Why a unit is not audited: no classifier label, or no primary item left after the generic screen. */
export function auditProblems(dir: string): string[] {
  const p: string[] = [];
  if (!existsSync(join(dir, "unit/classify.json"))) p.push("no classifier label");
  const keyFile = join(dir, "unit/key.json");
  if (!existsSync(keyFile)) return [...p, "no key"];
  const key = readJson(keyFile) as Key;
  const items = new Map(key.items.map((i) => [i.id, i]));
  if (!key.primary.length) p.push("no primary item");
  for (const id of key.primary) if (!items.get(id) || items.get(id)!.generic || items.get(id)!.mentioned) p.push("primary item " + id + " is generic, mentioned or absent");
  return p;
}

export function run(argv: string[], io: Io): number {
  const [what, ...rest] = argv;
  const roots: string[] = [];
  let audited: string | undefined, out: string | undefined, write = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--units") roots.push(rest[++i]!);
    else if (a === "--audited") audited = rest[++i];
    else if (a === "--out") out = rest[++i];
    else if (a === "--write") write = true;
    else throw new AuthorError("E_USAGE", "pv sets: unknown argument " + a);
  }
  if (what !== "calibration" || !roots.length || !audited || !out) throw new AuthorError("E_USAGE", "usage: pv sets calibration --units <dir> [--units <dir>] --audited <ids file> --out <sets.json> [--write]");
  if (existsSync(out)) throw new AuthorError("E_USAGE", "pv sets: " + out + " exists; the calibration slice is drawn once");
  const ids = readFileSync(audited, "utf8").split(/[\s,]+/).filter(Boolean);
  const dirs = new Map<string, string>();
  const pool: PoolUnit[] = [];
  for (const id of ids) {
    const dir = roots.map((r) => join(r, id)).find((d) => existsSync(join(d, "unit/unit.json")));
    if (!dir) throw new AuthorError("E_USAGE", "pv sets: no unit " + id + " under " + roots.join(", "));
    const bad = auditProblems(dir);
    if (bad.length) throw new AuthorError("E_USAGE", "pv sets: " + id + " is not audited: " + bad.join("; "));
    const m = readJson(join(dir, "unit/unit.json")) as UnitMeta;
    dirs.set(id, dir);
    pool.push({ id, source: m.source, type: m.type, set: m.set, twin_of: m.twin_of });
  }
  const { slice, twins } = drawCalibration(pool);
  put(out, { seed: SEED, head: pinnedHead(), pool: pool.length, slice, twins });
  if (write) for (const d of slice) {
    const f = join(dirs.get(d.id)!, "unit/unit.json");
    put(f, { ...(readJson(f) as UnitMeta), set: "calibration", rank: d.rank, ...(d.fill_in ? { fill_in: true } : {}) });
  }
  const tally = (src: string) => NAMED.concat(["other"]).map((t) => t + " " + slice.filter((d) => d.source === src && d.type === t).length).join(", ");
  io.out("pv sets: calibration slice of " + slice.length + " drawn from " + pool.length + " audited units; public: " + tally("public") + "; fill-ins: " + tally("transposed") + "; twins to build for draws 1 to " + twins.length);
  return 0;
}

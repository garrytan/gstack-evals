// Copyright (c) 2026 Garry Tan. MIT License.
// Readers for the plan-eng-review intentions eval's sealed inputs (prereg 2026-11-08-geva-405): unit folders (unit.json,
// plan.md, repo/ and key.json) and the run side's rows.jsonl. Rules: a key's primary items exist, are B, T or C, are
// neither mentioned nor generic, and number at most 6 (section 3); a row names a known arm and model, and a block row
// carries both normalized lists. Input and output helpers (flags, the alias guard, writes outside the repository) come
// from the product-value lane's io.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PvError, readJson, readRecords } from "../product-value/io.ts";
import { ARMS, MODELS_IN_ORDER, type Key, type Row, type UnitMeta } from "./types.ts";

export interface LoadedUnit {
  meta: UnitMeta;
  key: Key | null;
  dir: string;
}

export function keyProblem(key: Key): string | null {
  const byId = new Map(key.items.map((i) => [i.id, i]));
  if (byId.size !== key.items.length) return "key " + key.unit + " repeats an item id";
  if (key.primary.length > 6) return "key " + key.unit + " holds " + key.primary.length + " primary items; section 3 keeps at most 6";
  for (const id of key.primary) {
    const it = byId.get(id);
    if (!it) return "key " + key.unit + " names primary item " + id + ", which is not among its items";
    if (!["B", "T", "C"].includes(it.kind) || it.mentioned || it.generic) return "key " + key.unit + " lists item " + id + " as primary, but it is " + (it.mentioned ? "mentioned" : it.generic ? "generic" : "not B, T or C");
  }
  return null;
}

/** Reads every unit folder under dir (unit.json, and key.json when keys is set). */
export function loadUnits(dir: string, o: { keys: boolean }): Map<string, LoadedUnit> {
  if (!existsSync(dir)) throw new PvError("E_USAGE", "units directory " + dir + " does not exist");
  const out = new Map<string, LoadedUnit>();
  for (const name of readdirSync(dir).sort()) {
    const udir = join(dir, name);
    if (!existsSync(join(udir, "unit.json"))) continue;
    const meta = readJson<UnitMeta>(join(udir, "unit.json"), "unit file");
    if (meta.id !== name) throw new PvError("E_USAGE", "unit folder " + name + " holds unit.json for " + JSON.stringify(meta.id));
    let key: Key | null = null;
    if (o.keys) {
      key = readJson<Key>(join(udir, "key.json"), "key file");
      const kp = key.unit === name ? keyProblem(key) : "key.json in " + name + " names unit " + JSON.stringify(key.unit);
      if (kp) throw new PvError("E_USAGE", kp);
    }
    out.set(name, { meta, key, dir: udir });
  }
  if (!out.size) throw new PvError("E_USAGE", "units directory " + dir + " holds no unit folders with unit.json");
  return out;
}

export function readPlan(u: LoadedUnit): string {
  const p = join(u.dir, "plan.md");
  if (!existsSync(p)) throw new PvError("E_USAGE", "unit " + u.meta.id + " has no plan.md");
  return readFileSync(p, "utf8");
}

const ENDS = new Set(["block", "no-block", "missing", "contaminated"]);

export function readRows(path: string): Row[] {
  const rows = readRecords<Row>(path, "rows file");
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const at = "rows file " + path + " row " + (i + 1);
    if (typeof r.unit !== "string" || typeof r.session !== "string" || !ENDS.has(r.end) || typeof r.pass !== "number") throw new PvError("E_USAGE", at + " is not a Row (unit, session, pass and end are required)");
    if (!ARMS.includes(r.arm) || !MODELS_IN_ORDER.includes(r.model)) throw new PvError("E_USAGE", at + " names an unknown arm or model");
    if (r.end === "block" && (!Array.isArray(r.checks) || !Array.isArray(r.paths))) throw new PvError("E_USAGE", at + " ends in a block but holds no paths or checks");
    if (seen.has(r.session)) throw new PvError("E_USAGE", "session " + r.session + " appears twice in the rows");
    seen.add(r.session);
  });
  return rows;
}

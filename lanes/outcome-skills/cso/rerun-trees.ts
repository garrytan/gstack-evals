// Copyright (c) 2026 Garry Tan. MIT License.
// GEVA-583 rerun prereg, "Trees": a counted unit's session runs only when its rebuilt unit record matches the parent's
// stage 2 export. The four stage 2 sessions' image tags (gstack-evals-cso-session:<16 hex>-<12 hex image id>) must agree,
// and their 16 hex must be the rebuilt tree_sha256's first 16; the rebuilt advisory's GHSA id must be the one in the
// unit's name. Writes the check and the units that pass; a unit that fails is left out of the run, never repaired.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UnitRecord } from "./types.ts";

export interface TreeCheck { unit: string; ok: boolean; why: string | null; tags: string[] }
const TAG = /^gstack-evals-cso-session:([0-9a-f]{16})-[0-9a-f]{12}$/;
export const STAGE2_SESSIONS = ["cso-opus-0", "cso-particle-0", "none-opus-0", "none-particle-0"];

export function checkCountedTree(unit: string, rec: UnitRecord | null, sessions: string): TreeCheck {
  const tags = STAGE2_SESSIONS.map((s) => {
    const f = join(sessions, unit, s, "run.json");
    return existsSync(f) ? String((JSON.parse(readFileSync(f, "utf8")) as { image_tag?: unknown }).image_tag ?? "") : "";
  });
  const out = (why: string | null): TreeCheck => ({ unit, ok: why === null, why, tags });
  if (!rec) return out("no rebuilt unit record");
  if (rec.unit !== unit) return out("the rebuilt record names " + rec.unit);
  if (!unit.endsWith("-" + rec.ghsa.toLowerCase())) return out("the rebuilt advisory is " + rec.ghsa + ", not the one in the unit's name");
  const missing = STAGE2_SESSIONS.filter((_, n) => !tags[n]);
  if (missing.length) return out("the export has no image tag for " + missing.join(", "));
  const heads = tags.map((t) => TAG.exec(t)?.[1] ?? null);
  if (heads.some((h) => h === null)) return out("an export image tag is not gstack-evals-cso-session:<16 hex>-<12 hex>");
  if (new Set(heads).size !== 1) return out("the four stage 2 image tags disagree");
  if (heads[0] !== rec.tree_sha256.slice(0, 16)) return out("the rebuilt tree_sha256 starts " + rec.tree_sha256.slice(0, 16) + ", the export's tags " + heads[0]);
  return out(null);
}

/** --work <dir holding units/<id>.json> --export <sessions/stage2 dir> --units <JSON array of the counted ids> --out <file> */
export function main(argv: string[]): number {
  const arg = (k: string) => {
    const n = argv.indexOf(k);
    return n >= 0 && argv[n + 1] ? argv[n + 1]! : null;
  };
  const work = arg("--work"), exp = arg("--export"), list = arg("--units"), outFile = arg("--out");
  if (!work || !exp || !list || !outFile) {
    console.error("E_USAGE rerun-trees: --work <dir> --export <sessions/stage2 dir> --units <ids.json> --out <file>");
    return 2;
  }
  const ids = JSON.parse(readFileSync(list, "utf8")) as string[];
  const known = new Set(existsSync(join(work, "units")) ? readdirSync(join(work, "units")) : []);
  const checks = ids.map((u) => checkCountedTree(u, known.has(u + ".json") ? (JSON.parse(readFileSync(join(work, "units", u + ".json"), "utf8")) as UnitRecord) : null, exp));
  const counted = checks.filter((c) => c.ok).map((c) => c.unit);
  writeFileSync(outFile, JSON.stringify({ schema: "cso-rerun-trees.v1", units: checks, counted }, null, 1) + "\n", { flag: "wx" });
  for (const c of checks) if (!c.ok) console.log("LEFT OUT " + c.unit + ": " + c.why);
  console.log("trees: " + counted.length + " of " + ids.length + " units match the export");
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

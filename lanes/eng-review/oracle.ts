// Copyright (c) 2026 Garry Tan. MIT License.
// er oracle (prereg 2026-11-08-geva-405, section 7): one oracle list per calibration unit, the judge check's known-good
// anchor. A script, with no model call, turns each primary item into one check that names its path and condition.
// Build-time choices: one check per primary item in rank order (at most 6, so all fit in 8 slots); the check reads
// "Test <file>[ <function>, ...]: <statement>", where the functions are a B item's blamed functions in that file; it
// goes through parse.ts's normalizer like every list, so a long check is cut at its 40th word.
import type { Io } from "./cli.ts";
import { need, parseArgs, PvError, refuseAliases, refuseInRepo, writeJson } from "../product-value/io.ts";
import { normalizeChecks } from "./parse.ts";
import { isDrawn, type Key, type KeyItem } from "./types.ts";
import { loadUnits } from "./units.ts";

export function oracleCheck(item: KeyItem): string {
  const fns = [...new Set((item.sites ?? []).filter((s) => s.file === item.file && s.function).map((s) => s.function!))];
  return "Test " + item.file + (fns.length ? " " + fns.join(", ") : "") + ": " + item.statement.trim();
}

export function oracleList(key: Key): { checks: string[]; items: string[] } {
  const byId = new Map(key.items.map((i) => [i.id, i]));
  return { checks: normalizeChecks(key.primary.map((id) => oracleCheck(byId.get(id)!))), items: [...key.primary] };
}

export interface OracleFile {
  version: 1;
  units: Record<string, { checks: string[]; items: string[] }>;
}

const USAGE = "gstack-evals er oracle --units <units dir> --out <oracle.json outside the repo>";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { units: "one", out: "one" }, USAGE);
  need(a, ["units", "out"], USAGE);
  refuseAliases([["--units", a.one.units!], ["--out", a.one.out!]]);
  refuseInRepo("--out", a.one.out!);
  const out: OracleFile = { version: 1, units: {} };
  for (const [id, u] of loadUnits(a.one.units!, { keys: true })) if (isDrawn(u.meta, "calibration")) out.units[id] = oracleList(u.key!);
  const n = Object.keys(out.units).length;
  if (!n) throw new PvError("E_USAGE", "no drawn calibration unit under " + a.one.units + "; oracle lists are built for the calibration slice only, once er sets calibration --write has drawn it");
  writeJson(a.one.out!, out);
  io.out("er oracle: wrote " + n + " oracle lists to " + a.one.out);
  return 0;
}

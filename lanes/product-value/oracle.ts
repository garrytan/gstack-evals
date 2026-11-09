// Copyright (c) 2026 Garry Tan. MIT License.
// pv oracle (prereg 2026-11-08-geva-403, section 7): one oracle list per calibration unit, the judge check's known-good
// anchor. A script, with no model call, turns the unit's primary items into changes that each name one item's need,
// in primary rank order, one change per item and at most five. A unit with six primary items leaves its sixth out
// (a change list holds five changes), so its oracle list can earn at most five of six.
import { oracleChanges } from "../aftermath/oracle.ts";
import type { Io } from "./cli.ts";
import { loadUnits, need, parseArgs, PvError, refuseAliases, refuseInRepo, writeJson } from "./io.ts";
import type { Key } from "./types.ts";

export const ORACLE_PREFIX = "Plan for this need before launch: ";

/** The oracle list for one key: one change per primary item, the first five in rank order. */
export function oracleList(key: Key): { changes: string[]; items: string[] } {
  return oracleChanges(key.items, key.primary, 5, (i) => ORACLE_PREFIX + i.statement.trim());
}

export interface OracleFile {
  version: 1;
  units: Record<string, { changes: string[]; items: string[] }>;
}

const USAGE = "gstack-evals pv oracle --units <units dir> --out <oracle.json outside the repo>";

export function run(argv: string[], io: Io): number {
  const a = parseArgs(argv, { units: "one", out: "one" }, USAGE);
  need(a, ["units", "out"], USAGE);
  refuseAliases([["--units", a.one.units!], ["--out", a.one.out!]]);
  refuseInRepo("--out", a.one.out!);
  const units = loadUnits(a.one.units!, { keys: true });
  const out: OracleFile = { version: 1, units: {} };
  for (const [id, u] of units) if (u.meta.set === "calibration") out.units[id] = oracleList(u.key!);
  const n = Object.keys(out.units).length;
  if (!n) throw new PvError("E_USAGE", "no calibration unit under " + a.one.units + "; oracle lists are built for the calibration slice only");
  writeJson(a.one.out!, out);
  io.out("pv oracle: wrote " + n + " oracle lists to " + a.one.out);
  return 0;
}

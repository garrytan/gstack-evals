// Copyright (c) 2026 Garry Tan. MIT License.
// Deviation (a), dated pre-data (deviations post 2026-11-21-geva-561-cso-advisories-deviations): the containment gate
// also scans each arm's installed gstack tree, and a unit whose GHSA id, CVE id or fix-commit prefix appears there drops
// from every cell, so pairing holds. Section 3's gate 6 read only the session tree, but gstack's tree at the pin names
// nine candidate advisories by GHSA id (CHANGELOG.md, TODOS.md, .osv-scanner.toml and a design record). The scan runs
// once per arm over the whole candidate list, on the tree the arm's recipe installed (its hash recorded), before the
// supply check; a scan that does not finish fails closed.
import { homeTreeSha256 } from "../../h2h/arms/hash.ts";
import { scanIds, type IdArchive, type IdHit, type UnitIds } from "./ids.ts";

export interface InstallContain {
  schema: "cso-install-contain.v1";
  deviation: "a";
  arm: string;
  root_tree_sha256: string;
  units: number;
  needles: number;
  hits: IdHit[];
  dropped: string[];
  stores: string[];
  archives: IdArchive[];
}

/** The deviation (a) record for one arm's installed tree over the candidate units. */
export function containInstall(o: { arm: string; root: string; units: readonly UnitIds[] }): InstallContain {
  const s = scanIds(o.root, o.units);
  return { schema: "cso-install-contain.v1", deviation: "a", arm: o.arm, root_tree_sha256: homeTreeSha256(s.root), units: o.units.length, needles: s.needles, hits: s.hits, dropped: [...new Set(s.hits.map((h) => h.unit))].sort(), stores: s.stores, archives: s.archives };
}

/** Units that drop from every cell: a hit in any arm's installed tree drops the unit for all arms. */
export function dropsEveryCell(records: readonly InstallContain[]): string[] {
  return [...new Set(records.flatMap((r) => r.dropped))].sort();
}

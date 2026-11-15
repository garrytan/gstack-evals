// Copyright (c) 2026 Garry Tan. MIT License.
// The planted-unit supply count (plan sections 2 and 14 step 2): counts by step and reason from the frozen manifest to
// the recount, the earliest-public-date drops beyond the committer-date window (the Captain's condition 1), units a
// repository and the qualifiers capped at FROZEN.frame.perRepo a repository. Under FROZEN.supply.minQualifiers it
// refuses with E_EP_SUPPLY_SHORT so the counts go to the Captain before the prereg freezes. Counts only: no repository
// name, sha, case id or test name prints.
import { fail } from "../errors.ts";
import { FROZEN } from "../frozen.ts";
import type { Ecosystem } from "../types.ts";
import type { Outcome } from "./grade.ts";
import type { Manifest } from "./local.ts";

export interface SupplyInput {
  manifest: Manifest;
  digest: string;
  mined: { repo: string; eco: Ecosystem; stats: Record<string, number>; cloned: boolean }[];
  /** Every mined fix's outcome; a fix with none has not been constructed or screened yet. */
  outcomes: Outcome[];
  fixes: { id: string; eco: Ecosystem }[];
}

const ECOS: Ecosystem[] = ["go", "node", "python", "rust"];
const fmt = (m: Map<string, number>) => [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join(" ") || "none";
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

/** The supply lines and the capped qualifier count. */
export function supplyReport(i: SupplyInput): { lines: string[]; qualifiers: number; capped: number } {
  const lines: string[] = [];
  const per = (f: (e: Ecosystem) => number | string) => ECOS.map((e) => e + " " + f(e)).join(", ");
  lines.push("manifest " + i.digest + ", searched " + i.manifest.searchedAt + ", " + i.manifest.queries.length + " queries, " + i.manifest.rows.length + " repositories (" + per((e) => i.manifest.rows.filter((r) => r.eco === e).length) + ")");
  lines.push("mined repositories: " + per((e) => i.mined.filter((m) => m.eco === e && m.cloned).length) + "; clone failures " + i.mined.filter((m) => !m.cloned).length);
  let beyond = 0;
  let gained = 0;
  for (const e of ECOS) {
    const s = new Map<string, number>();
    for (const m of i.mined.filter((x) => x.eco === e)) for (const [k, v] of Object.entries(m.stats)) bump(s, k, v);
    beyond += s.get("drop:public_before_window") ?? 0;
    gained += s.get("public_in_window_committed_after") ?? 0;
    lines.push(e + " commits read: in the committer-date window " + (s.get("committed_in_window") ?? 0) + ", after it " + (s.get("committed_after_window") ?? 0) + "; mined " + (s.get("mined") ?? 0));
    lines.push(e + " drops at mining: " + fmt(new Map([...s].filter(([k]) => k.startsWith("drop:")).map(([k, v]) => [k.slice(5), v]))));
  }
  lines.push("earliest public date: " + beyond + " fixes committed in the window drop because they were public before it (Captain condition 1); " + gained + " committed after the window count because they were public in it");
  const byId = new Map(i.outcomes.map((o) => [o.id, o]));
  for (const e of ECOS) {
    const steps = new Map<string, number>();
    const fixes = i.fixes.filter((f) => f.eco === e);
    for (const f of fixes) {
      const o = byId.get(f.id);
      bump(steps, o ? (o.step === "clean" || o.step === "qualified" ? o.step : o.step + ":" + o.reason) : "pending");
    }
    lines.push(e + " outcomes of " + fixes.length + " mined: " + fmt(steps));
  }
  const clean = i.outcomes.filter((o) => o.step === "clean");
  const byRepo = new Map<string, number>();
  for (const o of clean) bump(byRepo, o.repo);
  const dist = new Map<string, number>();
  for (const n of byRepo.values()) bump(dist, n >= FROZEN.frame.perRepo ? FROZEN.frame.perRepo + "+" : String(n));
  const capped = [...byRepo.values()].reduce((a, n) => a + Math.min(n, FROZEN.frame.perRepo), 0);
  lines.push("qualifiers (recount clean): " + clean.length + " (" + per((e) => clean.filter((o) => o.eco === e).length) + ") from " + byRepo.size + " repositories; units a repository " + fmt(dist));
  const strata = new Map<string, number>();
  for (const o of clean) bump(strata, o.stars);
  lines.push("qualifier strata: stars " + fmt(strata) + "; strict window " + clean.filter((o) => o.strict).length + "; with a crash-class planted case " + clean.filter((o) => o.crash > 0).length);
  lines.push("supply: " + capped + " qualifiers capped at " + FROZEN.frame.perRepo + " a repository, against the minimum " + FROZEN.supply.minQualifiers + " and the target " + FROZEN.supply.targetQualifiers);
  return { lines, qualifiers: clean.length, capped };
}

/** Refuses under the minimum. */
export function supplyGate(capped: number): void {
  if (capped < FROZEN.supply.minQualifiers) fail("E_EP_SUPPLY_SHORT", capped + " qualifiers capped at " + FROZEN.frame.perRepo + " a repository, under the minimum " + FROZEN.supply.minQualifiers + "; the counts above go to the Captain before the prereg freezes");
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The readings of section 1's contract table and E3 table for part C, each read in the table's order. Pre-run change 1,
// section 8: the contract's KEEP, CUT-CANDIDATE and power rows read only after the false-block row and the ceiling row,
// and after check A's swap the CUT-CANDIDATE row keeps the 11.5-point bar. A reading needs a judge route that passed both
// checks (section 5.5); without one there is no reading and the Captain decides.
import { BLOCKED_AT_LEAST, CUT_BAR_POINTS, FALSE_BLOCK_SHARE, type RouteName } from "./frozen.ts";
import type { Analysis, Contrast } from "./analysis.ts";

export type ContractRow = "no-judge-route" | "incomplete" | "false-blocks" | "ceiling" | "above" | "includes" | "not-shown" | "below";
export type Verdict = "KEEP" | "FIX-METHOD (transcript reader)" | "FIX-METHOD (ceiling)" | "FIX-METHOD (power)" | "CUT-CANDIDATE";

export interface ContractReading {
  row: ContractRow;
  /** Whether the contract stays on by default for Codex; null with no reading. */
  on_by_default: boolean | null;
  verdict: Verdict | null;
  /** The contrast the row reads: the within-session primary, or c-on minus c-off after check A fails. */
  reads: "primary" | "c-on minus c-off" | null;
  text: string;
}

export interface E3Reading {
  row: "no-judge-route" | "incomplete" | "above" | "includes" | "below";
  ships: "E3" | "E2" | "E2, rewritten or dropped" | null;
  text: string;
  cost_per_added_bug_usd: number | null;
}

const points = (x: number) => (100 * x).toFixed(1);
const interval = (c: Contrast) => (c.stats?.ci95 ? "[" + points(c.stats.ci95[0]) + ", " + points(c.stats.ci95[1]) + "]" : "[n/a]");
const said = (c: Contrast) => (c.stats ? points(c.stats.delta) + " points " + interval(c) + ", sign-flip p " + (c.stats.p === null ? "n/a" : c.stats.p.toPrecision(3)) : "no pairs");

export function contractReading(a: Analysis, route: RouteName | null): ContractReading {
  const none = (row: ContractRow, text: string): ContractReading => ({ row, on_by_default: row === "incomplete" ? true : null, verdict: null, reads: null, text });
  if (route === null) return none("no-judge-route", "No reading: no judge route passed the judge check and the confirmation check (section 5.5). The Captain decides.");
  const missing = [a.cap_stop ? "a cap stop ended part C" : null, ...(["c-on", "c-off"] as const).filter((x) => a.arms[x].incomplete).map((x) => x + " has " + a.arms[x].not_scored_total + " of " + a.arms[x].planned + " sessions not scored")].filter(Boolean);
  if (missing.length) return none("incomplete", "INCOMPLETE (" + missing.join("; ") + "): no reading. gstack ships the contract as planned (B1), and the result goes to the Captain with what is missing.");
  const on = a.arms["c-on"];
  if (on.false_block_sessions > FALSE_BLOCK_SHARE * on.scored) return { row: "false-blocks", on_by_default: false, verdict: "FIX-METHOD (transcript reader)", reads: null, text: "False blocks in " + on.false_block_sessions + " of " + on.scored + " c-on sessions, more than 5%: the contract ships off by default on Codex, and its Codex transcript reader gets FIX-METHOD, whatever the primary shows." };
  if (on.blocked < BLOCKED_AT_LEAST) return { row: "ceiling", on_by_default: false, verdict: "FIX-METHOD (ceiling)", reads: null, text: "The contract blocked in " + on.blocked + " of " + on.scored + " c-on sessions, fewer than 7: Sol on Codex already runs the adversarial pass and writes the report, so the contract had almost nothing to act on. It ships off by default on Codex; FIX-METHOD (ceiling), with the R61 attempt as its own quick look on harder reviews." };
  const swap = a.check_a_fails;
  const c = swap ? a.between.find((x) => x.name === "c-on minus c-off, found")! : a.primary;
  const reads = swap ? ("c-on minus c-off" as const) : ("primary" as const);
  const lead = (swap ? "Check A failed (" + said(a.check_a) + "), so the within-session design is not trusted and c-on minus c-off reads in the primary's place: " : "The primary, c-on's final minus its first stop: ") + said(c) + ". ";
  if (c.reading === "above") return { row: "above", on_by_default: true, verdict: "KEEP", reads, text: lead + "The contract adds known bugs to what ships: it stays on by default for Codex. KEEP." };
  if (c.reading === "below") return { row: "below", on_by_default: false, verdict: "CUT-CANDIDATE", reads, text: lead + "The hold makes the delivered review worse: off by default on Codex. CUT-CANDIDATE, which Garry hears in plain words." };
  if (c.reading === "not_shown") return { row: "not-shown", on_by_default: false, verdict: "FIX-METHOD (power)", reads, text: lead + "The interval excludes 0 but the sign-flip test gives p of 0.05 or more, so it is not shown: the contract ships off by default on Codex. FIX-METHOD (power), never CUT-CANDIDATE; the direction is " + (c.stats!.delta > 0 ? "up" : "down") + "." };
  const upper = c.stats?.ci95 ? 100 * c.stats.ci95[1] : null;
  const cut = upper !== null && upper < CUT_BAR_POINTS;
  return { row: "includes", on_by_default: false, verdict: cut ? "CUT-CANDIDATE" : "FIX-METHOD (power)", reads, text: lead + "The interval includes 0: the contract ships off by default on Codex. " + (cut ? "Its upper bound is under the 11.5-point bar, so CUT-CANDIDATE, which Garry hears in plain words." : "Its upper bound is not under the 11.5-point bar, so FIX-METHOD (power).") };
}

export function e3Reading(a: Analysis, route: RouteName | null): E3Reading {
  const cost = a.e3_cost_per_added_bug_usd;
  if (route === null) return { row: "no-judge-route", ships: null, text: "No reading: no judge route passed both checks (section 5.5). The Captain decides; E2 stands meanwhile.", cost_per_added_bug_usd: null };
  const missing = [a.cap_stop ? "a cap stop ended part C" : null, ...(["c-high", "c-on"] as const).filter((x) => a.arms[x].incomplete).map((x) => x + " has " + a.arms[x].not_scored_total + " of " + a.arms[x].planned + " sessions not scored")].filter(Boolean);
  if (missing.length) return { row: "incomplete", ships: "E2", text: "INCOMPLETE (" + missing.join("; ") + "): no reading. E2 stands.", cost_per_added_bug_usd: null };
  const lead = "E3, c-high's final minus c-on's final: " + said(a.e3) + ". ";
  if (a.e3.reading === "above") return { row: "above", ships: "E3", text: lead + "gstack ships E3: a gstack Codex profile at high effort, used with codex --profile gstack. Each added known bug cost " + (cost === null ? "n/a" : "$" + cost.toFixed(2)) + ". E1 stays rejected.", cost_per_added_bug_usd: cost };
  if (a.e3.reading === "below") return { row: "below", ships: "E2, rewritten or dropped", text: lead + "E2's recommendation of high is wrong for /review on Sol: GStack Minder rewrites or drops the printed line.", cost_per_added_bug_usd: cost };
  return { row: "includes", ships: "E2", text: lead + (a.e3.reading === "not_shown" ? "The interval excludes 0 but the sign-flip test gives p of 0.05 or more, so it reads as including 0. " : "") + "E2 stands: setup prints its one-line recommendation and writes nothing. This eval can't show an effort gain under about 19 to 22 points on /review, and E3 is not shipped on this evidence.", cost_per_added_bug_usd: cost };
}

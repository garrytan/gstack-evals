// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's ledger items: how each approved item cap (frozen.CAPS, pre-run change 1 item 4a) splits
// into the ledger items its runs lease. One ledger item serves one run, a launch leases two (arms through the rig,
// simulator through the meter), and a stage's production labels are their own run inside the stage's approved item.
// This table is the build's proposal until a pre-run change freezes it; it lives here, not in frozen.ts, because
// frozen.ts holds only values a merged post states.
//
// Each part's cap is 1.35 times its central figure from the preregistration's cost.py plus one allowance (the item's
// costliest unit on the arms part, $1 on the others), rounded up to the dollar. Where those parts sum past the approved
// cap, the arms part takes what is left, and its allowance shrinks to match (items 5 and 6). Stage 1's cap holds one
// admission repair (pre-run change 1, item 4a), so what its first run's parts leave goes to three repair items.
// The dry run checks every approved item's parts sum to at most its cap, and that each part with a central figure keeps
// at least 1.35 times it.
import { CAPS } from "./frozen.ts";
import { capProblem, type LaunchName } from "./run/manifest.ts";

export type Line = keyof typeof CAPS;

export interface LedgerPart {
  item: string;
  line: Line;
  what: string;
  /** cost.py's central dollars for this part; null for a repair item, which has none. */
  central: number | null;
  /** The allowance the part keeps on top of 1.35 times central, in dollars; null for a repair item. */
  allowance: number | null;
  cap: number;
}

export const SPLIT: readonly LedgerPart[] = [
  { item: "ohr-author", line: "authoring", what: "the pilot and every draw after it, one run", central: 183.24, allowance: 3.5, cap: 251 },
  { item: "ohr-audit", line: "simulator_audit", what: "the fixed script's simulator calls and both auditors, one run", central: 29.34, allowance: 1, cap: 41 },
  { item: "ohr-s1-arms", line: "stage1", what: "stage 1's arm sessions, all three models", central: 99.6, allowance: 15, cap: 150 },
  { item: "ohr-s1-sim", line: "stage1", what: "stage 1's simulator", central: 5.76, allowance: 1, cap: 9 },
  { item: "ohr-s1-labels", line: "stage1", what: "stage 1's production labels", central: 4.32, allowance: 1, cap: 7 },
  { item: "ohr-s1-repair-arms", line: "stage1", what: "the one admission repair's arm sessions", central: null, allowance: null, cap: 48 },
  { item: "ohr-s1-repair-sim", line: "stage1", what: "the one admission repair's simulator", central: null, allowance: null, cap: 3 },
  { item: "ohr-s1-repair-labels", line: "stage1", what: "the one admission repair's labels", central: null, allowance: null, cap: 3 },
  { item: "ohr-judge-check", line: "judge_check", what: "the live judge probes, the gold pass and the check labels, one run", central: 89.8, allowance: 1, cap: 123 },
  { item: "ohr-s2-arms", line: "stage2", what: "stage 2's Opus and Sol arm sessions", central: 1109.2, allowance: 13.58, cap: 1511 },
  { item: "ohr-s2-sim", line: "stage2", what: "stage 2's Opus and Sol simulator", central: 45.12, allowance: 1, cap: 62 },
  { item: "ohr-s2-labels", line: "stage2", what: "stage 2's Opus and Sol production labels", central: 33.84, allowance: 1, cap: 47 },
  { item: "ohr-s2p-arms", line: "stage2_particle", what: "stage 2's particle-1 arm sessions", central: 61.1, allowance: 0.51, cap: 83 },
  { item: "ohr-s2p-sim", line: "stage2_particle", what: "stage 2's particle-1 simulator", central: 22.56, allowance: 1, cap: 32 },
  { item: "ohr-s2p-labels", line: "stage2_particle", what: "stage 2's particle-1 production labels", central: 16.92, allowance: 1, cap: 24 },
  { item: "ohr-hosts", line: "hosts", what: "the runner VMs", central: 15.28, allowance: 1, cap: 22 },
];

/** Each paid launch's two items: arms through the rig's lease and the simulator through the meter. */
export const LAUNCH_ITEMS: Readonly<Record<LaunchName, { arms: string; sim: string }>> = {
  stage1: { arms: "ohr-s1-arms", sim: "ohr-s1-sim" },
  stage2: { arms: "ohr-s2-arms", sim: "ohr-s2-sim" },
  "stage2-particle": { arms: "ohr-s2p-arms", sim: "ohr-s2p-sim" },
};

const cents = (x: number) => Math.round(x * 100);

/** Every way the split breaks its rules, or an empty list. */
export function splitProblems(split: readonly LedgerPart[] = SPLIT, caps: Readonly<Record<Line, number>> = CAPS): string[] {
  const out: string[] = [];
  const capOf = (item: string) => split.find((p) => p.item === item)?.cap;
  const items = split.map((p) => p.item);
  for (const dup of new Set(items.filter((x, i) => items.indexOf(x) !== i))) out.push("item " + dup + " appears twice");
  for (const line of Object.keys(caps) as Line[]) {
    const parts = split.filter((p) => p.line === line);
    if (!parts.length) out.push("approved item " + line + " has no ledger item");
    const sum = parts.reduce((t, p) => t + p.cap, 0);
    if (sum > caps[line]) out.push(line + "'s ledger items sum to $" + sum + ", past its approved cap of $" + caps[line]);
  }
  for (const p of split) {
    if (!(p.line in caps)) out.push(p.item + " names no approved item (" + p.line + ")");
    if (!(Number.isInteger(p.cap) && p.cap > 0)) out.push(p.item + "'s cap $" + p.cap + " is not a positive whole number of dollars");
    if (p.central === null) continue;
    if (cents(p.cap) < Math.ceil(135 * p.central)) out.push(p.item + "'s cap $" + p.cap + " is under 1.35 times its central $" + p.central);
    if (p.allowance === null || cents(p.cap) < cents(1.35 * p.central + p.allowance) - 1) out.push(p.item + "'s cap $" + p.cap + " does not hold 1.35 times central plus its stated allowance");
  }
  for (const [launch, it] of Object.entries(LAUNCH_ITEMS) as [LaunchName, { arms: string; sim: string }][]) {
    const arms = capOf(it.arms), sim = capOf(it.sim);
    if (arms === undefined || sim === undefined) out.push(launch + ": its items are not in the split");
    else {
      const problem = capProblem(launch, arms * 1_000_000, sim * 1_000_000);
      if (problem) out.push(launch + ": " + problem);
    }
  }
  return out;
}

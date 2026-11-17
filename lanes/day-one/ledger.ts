// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one eval's money (prereg section 11): one ledger line item per row of the money table, every lease on one run
// id, so one item serves every launch of its stage. The caps here are the plan's, for the dry run and the projection
// print; the Captain records each item's cap in approvals before its first paid call.
// - The Astra voice has its own line (day1-voice). Its calls ride the plan item's lease, because the rig's proxy holds
//   one lease, so day1-plans' ledger cap is its own cap plus the voice line's (ledgerCapUsd). Every gstack-arm session
//   gives the voice its own proxy slot, meter and allowance, each launch's --voice-cap is at most what the voice line has
//   left, and a round starts only when the voice's worst case fits it (run.ts voiceCap). Its spend is read from the
//   proxy journal's per-call OpenAI usage.
// - The caps total $4,000 exactly: day1-strengthened's is the reserve left after every other line, recorded only when
//   GSTA-573's pins land, so no mix of spends under the caps passes the all-in stop.
// - The all-in stop: after the smoke, the projection is redone on measured prices. If it passes $4,000 the frozen shrink
//   order applies once (shrink), and a projection past $5,000 goes to the Captain for Garry.
import { openLease, settleLease, type RequireAdmission } from "../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../src/runner/ledger/local.ts";

export const DAYONE_RUN = "geva-546-day-one";

export interface Item {
  item: string;
  row: string;
  projectionUsd: number;
  capUsd: number;
  /** A ledger item with leases; false for an approvals line the proxy never meters (hosts, crew). */
  metered: boolean;
}

export const ITEMS: readonly Item[] = [
  { item: "day1-smoke", row: "Smoke on the 3 practice briefs: N, D and A plans with A's Astra voice, 5 builds, 5 checks, both checker fixtures and the responder probe", projectionUsd: 195, capUsd: 230, metered: true },
  { item: "day1-plans", row: "Plans: N, D and A on the 15 category 2 briefs and on the 2 real briefs at 3 replicates; the ledger cap adds day1-voice's", projectionUsd: 690, capUsd: 830, metered: true },
  { item: "day1-voice", row: "The A plans' GPT-6 Astra voice (21 sessions at about $8), on day1-plans' lease with its own slot, meter and launch cap", projectionUsd: 168, capUsd: 230, metered: false },
  { item: "day1-owner", row: "The owner responder on GPT-6.1 Sol, every planning session", projectionUsd: 20, capUsd: 30, metered: true },
  { item: "day1-builds", row: "Builds: one Opus build per N, D and A plan on the 15 category 2 briefs", projectionUsd: 450, capUsd: 540, metered: true },
  { item: "day1-checks", row: "Checklist runs: one per N, D and A build, and the checker validation's reruns", projectionUsd: 135, capUsd: 165, metered: true },
  { item: "day1-judge", row: "Plan judge: gold check, controls, category 1 plans and category 2 plans (descriptive)", projectionUsd: 60, capUsd: 80, metered: true },
  { item: "day1-hosts", row: "Ubicloud runner host for the Docker rig", projectionUsd: 60, capUsd: 80, metered: false },
  { item: "day1-crew", row: "Crew: this thread, the run thread, gold labellers, the checker validation and two /ship runs", projectionUsd: 400, capUsd: 450, metered: false },
  { item: "day1-strengthened", row: "S-full and S-dayone on the 15 category 2 briefs: plans with their Astra voice, builds and checks; a reserve of $4,000 less every other cap, recorded when their pins land", projectionUsd: 1530, capUsd: 1365, metered: true },
];

/** The ledger cap of an item: day1-plans carries day1-voice's calls on its lease, so its cap adds the voice line's. */
export const ledgerCapUsd = (name: string): number => itemOf(name).capUsd + (name === "day1-plans" ? itemOf("day1-voice").capUsd : 0);

export const ALL_IN_USD = 4000;
export const ESCALATE_USD = 5000;

/** The projection's total over every line. */
export const projectionUsd = (items: readonly Item[] = ITEMS): number => items.reduce((s, i) => s + i.projectionUsd, 0);

export function itemOf(name: string): Item {
  const i = ITEMS.find((x) => x.item === name);
  if (!i) throw new Error("E_USAGE no day-one line item " + name + "; the items are " + ITEMS.map((x) => x.item).join(", "));
  return i;
}

export const leaseItem = (record: string, local: LocalLedger, item: string, o: { amount_micros?: number; requireAdmission?: RequireAdmission } = {}) => {
  if (!itemOf(item).metered) throw new Error("E_USAGE " + item + " is an approvals line with no lease");
  return openLease(record, local, { item, run_id: DAYONE_RUN, ...o });
};
export const settleItem = (record: string, local: LocalLedger, lease_id: string) => settleLease(record, local, lease_id);

/** The frozen shrink order (G1), applied once after the smoke: each step keeps the ones before it. */
export const SHRINK = [
  "category 1 to 2 replicates",
  "category 1 to its gold check and 1 replicate",
  "category 2 to 12 briefs, taken to the Captain with the number before any cut",
] as const;

/** How many shrink steps a re-projection needs, or "ruling" when even step 3 leaves it over the all-in stop. */
export function shrink(projected: number, savings: readonly [number, number, number]): { steps: number; projected: number } | { ruling: true; projected: number } {
  let p = projected;
  for (let i = 0; i <= SHRINK.length; i++) {
    if (p <= ALL_IN_USD) return { steps: i, projected: p };
    if (i < SHRINK.length) p -= savings[i]!;
  }
  return { ruling: true, projected: p };
}

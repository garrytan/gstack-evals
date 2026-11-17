// Copyright (c) 2026 Garry Tan. MIT License.
// The day-one eval's money (prereg section 11): one ledger line item per row of the money table, every lease on one run
// id, so one item serves every launch of its stage. The caps here are the plan's, for the dry run and the projection
// print; the Captain records each item's cap in approvals before its first paid call.
// - The Astra voice has its own line (day1-voice). Its calls ride the plan item's lease, because the rig's proxy holds
//   one lease, so day1-plans' ledger cap is its own cap plus the voice line's (ledgerCapUsd). Every gstack-arm session
//   gives the voice its own proxy slot, meter and allowance, each launch's --voice-cap is at most what the voice line has
//   left, and a round starts only when the voice's worst case fits it (run.ts voiceCap). Its spend is read from the
//   proxy journal's per-call OpenAI usage.
// - The reserve sits in each line's cap: about 15% over its projection, rounded up to $5, and never less than the
//   projection plus the line's admission headroom (twice its largest session's allowance less that session's planning
//   price, the room the last round needs at --parallel 1). day1-smoke's cap is the G1 figure. The caps sum to the all-in
//   total, so no mix of spends under them passes it. day1-strengthened is recorded only when GSTA-573's pins land.
// - The all-in stop: after the smoke, the projection is redone on measured prices. If it plus every line's headroom
//   passes the all-in total, the frozen shrink order applies once (shrink); a total past $5,000 goes to the Captain for
//   Garry.
import { ledgerStatus, openLease, settleLease, type RequireAdmission } from "../../src/runner/ledger/ledger.ts";
import type { LocalLedger } from "../../src/runner/ledger/local.ts";

export const DAYONE_RUN = "geva-546-day-one";

export interface Item {
  item: string;
  row: string;
  projectionUsd: number;
  capUsd: number;
  /** A ledger item with leases; false for an approvals line the proxy never meters (hosts, crew). */
  metered: boolean;
  /** The room the line's last round needs at --parallel 1: twice its largest session's allowance less that session's planning price. */
  headroomUsd: number;
}

/** Planning prices per session, which the smoke replaces: N, D and R plans, an /autoplan-class plan and its Astra voice, a build, a check. */
export const PLANNING_PRICES = { n: 1.5, d: 1, r: 1, gstack: 30, voice: 8, build: 10, check: 3 } as const;

export const ITEMS: readonly Item[] = [
  { item: "day1-smoke", row: "Smoke on the 3 practice briefs: N, D, R and A plans with A's Astra voice, 5 builds, 5 checks, both checker fixtures with the real checker and the responder probe", projectionUsd: 198, capUsd: 310, metered: true, headroomUsd: 112 },
  { item: "day1-plans", row: "Plans: N, D, R and A on the 15 category 2 briefs and on the 2 real briefs at 3 replicates; the ledger cap adds day1-voice's", projectionUsd: 711, capUsd: 825, metered: true, headroomUsd: 112 },
  { item: "day1-voice", row: "The A plans' GPT-6 Astra voice (21 sessions at about $8), on day1-plans' lease with its own slot, meter and launch cap", projectionUsd: 168, capUsd: 195, metered: false, headroomUsd: 22 },
  { item: "day1-owner", row: "The owner responder on GPT-6.1 Sol, every planning session", projectionUsd: 27, capUsd: 35, metered: true, headroomUsd: 2 },
  { item: "day1-builds", row: "Builds: one Opus build per N, D, R and A plan on the 15 category 2 briefs", projectionUsd: 600, capUsd: 690, metered: true, headroomUsd: 20 },
  { item: "day1-checks", row: "Checklist runs: one per N, D, R and A build", projectionUsd: 180, capUsd: 210, metered: true, headroomUsd: 13 },
  { item: "day1-judge", row: "Plan judge: gold check, controls, category 1 plans and category 2 plans (descriptive)", projectionUsd: 70, capUsd: 85, metered: true, headroomUsd: 5 },
  { item: "day1-hosts", row: "Ubicloud runner host for the Docker rig", projectionUsd: 70, capUsd: 85, metered: false, headroomUsd: 0 },
  { item: "day1-crew", row: "Crew: this thread, the run thread, gold labellers, the checker validation and two /ship runs", projectionUsd: 420, capUsd: 485, metered: false, headroomUsd: 0 },
  { item: "day1-strengthened", row: "S-full and S-dayone on the 15 category 2 briefs: plans with their Astra voice, builds and checks; recorded when their pins land", projectionUsd: 1530, capUsd: 1760, metered: true, headroomUsd: 145 },
];

/** The ledger cap of an item: day1-plans carries day1-voice's calls on its lease, so its cap adds the voice line's. */
export const ledgerCapUsd = (name: string): number => itemOf(name).capUsd + (name === "day1-plans" ? itemOf("day1-voice").capUsd : 0);

export const ALL_IN_USD = 4680;
/** Every line's headroom together: a re-projection plus this must fit the all-in total. */
export const HEADROOM_USD = ITEMS.reduce((s, i) => s + i.headroomUsd, 0);
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

/** What a launch leases on an item: its --spend-cap, or the item's balance when less is left, so a resume asks only for what remains. */
export function leaseAmount(record: string, item: string, capMicros: number): number {
  const s = ledgerStatus(record, item).find((x) => x.item === item);
  return s ? Math.min(capMicros, Math.max(s.left_micros, 0)) : capMicros;
}

/** The frozen shrink order (G1), applied once after the smoke: each step keeps the ones before it. */
export const SHRINK = [
  "category 1 to 2 replicates",
  "category 1 to its gold check and 1 replicate",
  "category 2 to 12 briefs, taken to the Captain with the number before any cut",
] as const;

/** How many shrink steps a re-projection needs (it plus every line's headroom must fit the all-in total), or "ruling" when even step 3 leaves it over. */
export function shrink(projected: number, savings: readonly [number, number, number]): { steps: number; projected: number } | { ruling: true; projected: number } {
  let p = projected;
  for (let i = 0; i <= SHRINK.length; i++) {
    if (p + HEADROOM_USD <= ALL_IN_USD) return { steps: i, projected: p };
    if (i < SHRINK.length) p -= savings[i]!;
  }
  return { ruling: true, projected: p };
}

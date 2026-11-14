// Copyright (c) 2026 Garry Tan. MIT License.
// The money figures the read area projects from (settled, in-flight and unknown per item, carried apart, plan L1 and
// L4), the first judge packet's re-projection (a projection past dc-judges' cap stops for the Captain), the $5,000
// envelope, and R2-7's reading of a dc-base-apps cap stop.
import type { ReasonCode } from "../../../src/errors/codes.ts";
import { CREW_DEVIATION, LEDGER_ITEMS, MONEY, RECIPES } from "../frozen.ts";
import type { LedgerItemId } from "../types.ts";
import { $, dollars, type MoneyController } from "./book.ts";
import type { ItemFigures } from "./types.ts";

export const ITEM_IDS = Object.keys(LEDGER_ITEMS) as LedgerItemId[];

/** Every item's figures; crew, which has no lease, carries the thread counters' reading passed in. */
export function moneyFigures(c: MoneyController, crewMicros = 0): Record<LedgerItemId, ItemFigures> {
  const out = {} as Record<LedgerItemId, ItemFigures>;
  for (const item of ITEM_IDS) out[item] = item === "crew" ? { item, capMicros: $(CREW_DEVIATION.capUsd), settledMicros: crewMicros, inFlightMicros: 0, unknownMicros: 0, carriedMicros: 0, inFlightCount: 0, leaseId: null, closed: false, paused: null } : c.figures(item);
  return out;
}

/** What a projection counts as already committed on an item: all three charges and the earlier launches' carried spend, never settled spend alone. */
export const committedMicros = (f: ItemFigures) => f.carriedMicros + f.settledMicros + f.inFlightMicros + f.unknownMicros;

export const FIRST_PACKET_TAG = "first-stage1-label-packet";

/** The first stage 1 label packet runs alone: every other dc-judges admission waits until the re-projection. */
export function holdForFirstPacket(c: MoneyController): Promise<void> {
  return c.pause("dc-judges", "the first stage 1 label packet runs alone and re-projects the line", { allowTag: FIRST_PACKET_TAG });
}

/**
 * Re-projects dc-judges from the first packet's measured cost: everything committed plus that cost for each packet left.
 * Within the cap, dc-judges admits again; past it, the item is held for the Captain.
 */
export async function afterFirstPacket(c: MoneyController, o: { firstPacketMicros: number; packetsLeft: number }): Promise<{ fits: boolean; projectedMicros: number; line: string }> {
  const f = c.figures("dc-judges");
  const projectedMicros = committedMicros(f) + o.firstPacketMicros * o.packetsLeft;
  const line = "dc-judges re-projected at " + dollars(projectedMicros) + " (" + dollars(committedMicros(f)) + " committed, " + o.packetsLeft + " packets left at " + dollars(o.firstPacketMicros) + ") against its " + dollars(f.capMicros) + " cap";
  if (projectedMicros <= f.capMicros) {
    await c.resume("dc-judges");
    return { fits: true, projectedMicros, line };
  }
  await c.pause("dc-judges", line + ": past the cap, so it stops for the Captain", { captain: true });
  return { fits: false, projectedMicros, line };
}

/**
 * L4: dc-authoring-3 holds the comparison set's 2x versions and leases only after a harder tier is admitted; when the
 * base tier admits it is released, unleased, and projects nothing.
 */
export async function authoring3(c: MoneyController, admitted: "base" | "harder"): Promise<{ leased: boolean; projectionMicros: number }> {
  if (admitted === "base") {
    if (c.lease("dc-authoring-3")) throw new Error("dc-authoring-3 is leased, so a harder tier was admitted before");
    return { leased: false, projectionMicros: 0 };
  }
  await c.openItem("dc-authoring-3");
  return { leased: true, projectionMicros: $(MONEY.authoring3IfRunUsd) };
}

/** L4: a projection past $5,000 stops for the Captain. */
export function envelope(projectedMicros: Partial<Record<LedgerItemId, number>>): { totalMicros: number; captain: string | null } {
  const totalMicros = Object.values(projectedMicros).reduce((a, b) => a + (b ?? 0), 0);
  return { totalMicros, captain: totalMicros > $(MONEY.projectionStopUsd) ? "the projection of " + dollars(totalMicros) + " is past " + dollars($(MONEY.projectionStopUsd)) + ", so it stops for the Captain" : null };
}

/** R2-7: a dc-base-apps cap stop with 16 or more qualified keeps that count for the Captain; with fewer it is a supply stop. */
export function baseAppsCapStop(qualified: number): { code: ReasonCode | null; baseApps: number; line: string } {
  if (qualified >= RECIPES.minBaseApps) return { code: null, baseApps: Math.min(qualified, RECIPES.baseApps), line: "dc-base-apps cap stop with " + qualified + " qualified: the base apps stay at that count and go to the Captain" };
  return { code: "E_DC_SUPPLY_SHORT", baseApps: qualified, line: "dc-base-apps cap stop with " + qualified + " qualified, under " + RECIPES.minBaseApps };
}

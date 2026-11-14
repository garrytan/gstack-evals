// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dc items: the 17 ledger items with their caps, projections and admission rules (keyless). The lane's
// cli.ts row for items calls itemsCommand once integration wires it.
import { LEDGER_ITEMS, MONEY } from "../frozen.ts";
import type { LedgerItemId } from "../types.ts";

const admissionText = (item: LedgerItemId): string => {
  const a = LEDGER_ITEMS[item].admission;
  if (a.kind === "direct") return "direct calls at the proxy's worst case, at most " + a.maxInFlight + " in flight";
  if (a.kind === "vms") return "one atomic sub-reservation per VM: time to live at the list price, settled at measured hours";
  if (a.kind === "none") return "no lease; thread counters report it";
  if (item === "dc-base-apps") return "one session at a time at a $" + a.allowanceUsd.toFixed(2) + " allowance; a J1 retry admitted on its own";
  return "a round of " + a.perRound + " at $" + a.allowanceUsd.toFixed(2) + " each, twice over: $" + a.reserveUsd.toFixed(2);
};

export function itemsLines(): string[] {
  const ids = Object.keys(LEDGER_ITEMS) as LedgerItemId[];
  const lines = ids.map((i) => i.padEnd(20) + ("$" + LEDGER_ITEMS[i].capUsd).padStart(6) + "  projection $" + LEDGER_ITEMS[i].projectionUsd + "  " + admissionText(i));
  lines.push("all-in cap $" + MONEY.capAllInUsd + "; a projection past $" + MONEY.projectionStopUsd + " stops for the Captain");
  return lines;
}

export function itemsCommand(io: { out: (text: string) => void }): number {
  for (const l of itemsLines()) io.out(l);
  return 0;
}

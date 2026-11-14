// Copyright (c) 2026 Garry Tan. MIT License.
// gstack-evals dc items: the 17 ledger items with their caps, projections and admission rules (keyless). The lane's
// cli.ts row for items calls itemsCommand once integration wires it. On the controller host each leased item's line
// also prints the spend the launch carries from the earlier launches' books (money/carry.ts).
import { CREW_DEVIATION, LEDGER_ITEMS, MONEY } from "../frozen.ts";
import type { LedgerItemId } from "../types.ts";
import { exact } from "./book.ts";
import type { CarryFile } from "./carry.ts";

const admissionText = (item: LedgerItemId): string => {
  const a = LEDGER_ITEMS[item].admission;
  if (a.kind === "direct") return "direct calls at the proxy's worst case, at most " + a.maxInFlight + " in flight";
  if (a.kind === "vms") return "one atomic sub-reservation per VM: time to live at the list price, settled at measured hours";
  if (a.kind === "none") return "no lease; thread counters report it";
  if (item === "dc-base-apps") return "one session at a time at a $" + a.allowanceUsd.toFixed(2) + " allowance; a J1 retry admitted on its own";
  return "a round of " + a.perRound + " at $" + a.allowanceUsd.toFixed(2) + " each, twice over: $" + a.reserveUsd.toFixed(2);
};

/** An item's carried figure as the host's items listing and dc host status print it. */
export function carryText(f: { settledMicros: number; unknownMicros: number } | undefined): string {
  const settled = f?.settledMicros ?? 0;
  const unknown = f?.unknownMicros ?? 0;
  return "carried " + exact(settled + unknown) + " (" + exact(settled) + " settled, " + exact(unknown) + " unknown)";
}

export function itemsLines(carry: CarryFile | null = null): string[] {
  const ids = Object.keys(LEDGER_ITEMS) as LedgerItemId[];
  const lines = ids.map((i) => i.padEnd(20) + ("$" + (i === "crew" ? CREW_DEVIATION.capUsd : LEDGER_ITEMS[i].capUsd)).padStart(6) + "  projection $" + LEDGER_ITEMS[i].projectionUsd + "  " + admissionText(i) + (i === "crew" ? " (PD-14: raised from the frozen $" + CREW_DEVIATION.frozenCapUsd + "; crew spend up to $" + CREW_DEVIATION.capUsd + " triggers no stage 2 cut)" : "") + (carry && LEDGER_ITEMS[i].leased ? "  " + carryText(carry.items[i]) : ""));
  if (carry) lines.push("carry: " + carry.archives.length + " earlier launch archive(s) of run " + carry.runId + (carry.archives.length ? ": " + carry.archives.map((a) => a.name).join(", ") : ""));
  lines.push("all-in cap $" + MONEY.capAllInUsd + "; a projection past $" + MONEY.projectionStopUsd + " stops for the Captain");
  return lines;
}

export function itemsCommand(io: { out: (text: string) => void }): number {
  for (const l of itemsLines()) io.out(l);
  return 0;
}

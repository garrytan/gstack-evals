// Copyright (c) 2026 Garry Tan. MIT License.
// The all-in stop of the Codex hooks eval (preregistration section 11, pre-run change 2): before a part R launch, a part C step
// or a judge run, every ledger item of both parts and the judge item counts at its spend once it is done, and otherwise at the
// larger of its spend so far and its projection (its central plus the allowances its parallel sessions hold open, or the part's
// own projection where the guard has one); the crew file's counter, this thread's cost.dollars at list price, is added. Past
// the Captain's stop nothing starts, and the refusal goes to the Captain. Each part's own guard still holds its item to its cap.
import { existsSync, readFileSync } from "node:fs";

// The Captain's recorded point to come back, $1,200 (2026-11-21).
export const ALL_IN_STOP_USD = 1200;
export const ALL_IN_ITEMS = ["r-pilot", "r-main", "c-pilot", "h-pilot", "c-main", "h-main", "geva-562-judge"] as const;

/** One ledger item in micros: what it has spent (with any reservation it holds open), and its projection while it runs. */
export type Spend = { item: string; done: boolean; spent: number; projection: number };
export type Crew = { as_of: string; usd: number };

const usd = (m: number) => "$" + (m / 1e6).toFixed(2);

export function checkCrew(crew: Crew): Crew {
  if (typeof crew?.as_of !== "string" || typeof crew.usd !== "number" || !(crew.usd >= 0)) throw new Error("E_USAGE codex-hooks all-in: the crew file needs as_of and usd, a number of at least 0");
  return crew;
}

export function readCrew(path: string): Crew {
  if (!path || !existsSync(path)) throw new Error("E_USAGE codex-hooks all-in: name the crew file (as_of, and usd from this thread's counter)");
  return checkCrew(JSON.parse(readFileSync(path, "utf8")));
}

/** The stop: refuses when an item is missing or named twice, or when the items plus the crew's counter pass the stop. */
export function allIn(spends: Spend[], crew: Crew) {
  checkCrew(crew);
  const why: string[] = [];
  for (const i of ALL_IN_ITEMS) {
    const n = spends.filter((s) => s.item === i).length;
    if (n !== 1) why.push(i + (n ? " is counted " + n + " times" : " is missing from the count"));
  }
  for (const s of spends) if (!(ALL_IN_ITEMS as readonly string[]).includes(s.item)) why.push(s.item + " is not an item of this eval");
  const rows = spends.map((s) => ({ ...s, counted: s.done ? s.spent : Math.max(s.spent, s.projection) }));
  const items = rows.reduce((x, r) => x + r.counted, 0), spent = Math.round(crew.usd * 1e6), stop = ALL_IN_STOP_USD * 1e6, total = items + spent;
  if (total > stop) why.push("all-in " + usd(total) + " (items " + usd(items) + ", crew " + usd(spent) + " as of " + crew.as_of + ") passes the " + usd(stop) + " stop");
  const lines = [
    "ALL_IN " + (why.length ? "REFUSE" : "PASS") + ": " + usd(total) + " of " + usd(stop),
    ...rows.map((r) => "  " + r.item + (r.done ? " done" : "") + ": spent " + usd(r.spent) + ", counted " + usd(r.counted)),
    "  crew " + usd(spent) + " as of " + crew.as_of,
  ];
  return { ok: !why.length, why, lines, total };
}

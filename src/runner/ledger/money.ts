// Money in the ledger is integer micro-dollars: 1 USD is 1,000,000 micros. Integer sums never drift against a cap.

export const MICROS_PER_USD = 1_000_000;

export const isMicros = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Reads a dollar amount such as "130", "12.5" or "$0.000125" exactly, with no floating point. null unless it is a non-negative amount under $1 billion with at most six decimals. */
export function parseUsd(text: string): number | null {
  const m = /^\$?(\d{1,9})(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * MICROS_PER_USD + Number((m[2] ?? "").padEnd(6, "0"));
}

/** Formats micros as dollars with two decimals, or up to six when cents do not hold the amount: $130.00, $0.000125. */
export function usd(micros: number): string {
  if (micros < 0) return "-" + usd(-micros);
  const cents = String(micros % MICROS_PER_USD).padStart(6, "0").replace(/0{1,4}$/, "");
  return "$" + Math.floor(micros / MICROS_PER_USD) + "." + cents;
}

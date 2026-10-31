# month-end (missed edge case): adding a month with setUTCMonth rolls the 29th to 31st over into the next month.
package_json subscriptions
put README.md <<'EOF'
# subscriptions

Billing dates for subscriptions. Each module in src/billing/ computes one date from another; dates are UTC midnights.

CI runs `bun run check`.
EOF
put src/billing/next-invoice.ts <<'EOF'
export function nextInvoice(from: Date): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
EOF
put tests/billing.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { nextInvoice } from "../src/billing/next-invoice.ts";

const day = (d: Date) => d.toISOString().slice(0, 10);

test("the next invoice is a month later", () => {
  expect(day(nextInvoice(new Date("2025-01-15")))).toBe("2025-02-15");
});
EOF
commit "Add next invoice dates"
put src/billing/next-invoice.ts <<'EOF'
export function nextInvoice(from: Date): Date {
  const target = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(from.getUTCDate(), last));
  return target;
}
EOF
put tests/billing.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { nextInvoice } from "../src/billing/next-invoice.ts";

const day = (d: Date) => d.toISOString().slice(0, 10);

test("the next invoice is a month later", () => {
  expect(day(nextInvoice(new Date("2025-01-15")))).toBe("2025-02-15");
});

test("an invoice from January 31 falls on the last day of February", () => {
  expect(day(nextInvoice(new Date("2025-01-31")))).toBe("2025-02-28");
});
EOF
commit "Fix invoices from the 31st skipping to the next month"
put src/billing/trial-end.ts <<'EOF'
export function trialEnd(start: Date): Date {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
EOF
commit "Add one-month trial end dates"

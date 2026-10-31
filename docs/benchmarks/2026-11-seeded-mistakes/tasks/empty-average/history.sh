# empty-average (missed edge case): an average over no rows divides by zero and reports NaN.
package_json dashboards
put README.md <<'EOF'
# dashboards

Daily report numbers for the dashboards and the nightly export. Each report in src/reports/ exports summarize(rows).

CI runs `bun run check`.
EOF
put src/reports/latency.ts <<'EOF'
export function summarize(samples: number[]) {
  const total = samples.reduce((a, b) => a + b, 0);
  return { count: samples.length, meanMs: total / samples.length };
}
EOF
put tests/reports.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { summarize } from "../src/reports/latency.ts";

test("latency mean", () => {
  expect(summarize([100, 300])).toEqual({ count: 2, meanMs: 200 });
});
EOF
commit "Add the latency report"
put src/reports/latency.ts <<'EOF'
export function summarize(samples: number[]) {
  const total = samples.reduce((a, b) => a + b, 0);
  return { count: samples.length, meanMs: samples.length ? total / samples.length : 0 };
}
EOF
put tests/reports.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { summarize } from "../src/reports/latency.ts";

test("latency mean", () => {
  expect(summarize([100, 300])).toEqual({ count: 2, meanMs: 200 });
});

test("an hour with no samples has a mean of 0", () => {
  expect(summarize([]).meanMs).toBe(0);
});
EOF
commit "Fix NaN latency in quiet hours"
put src/reports/order-value.ts <<'EOF'
export function summarize(orders: { total: number }[]) {
  const revenue = orders.reduce((a, o) => a + o.total, 0);
  return { orders: orders.length, revenue, averageOrder: revenue / orders.length };
}
EOF
commit "Add the order value report"

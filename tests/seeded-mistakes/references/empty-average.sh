# Reference solutions for empty-average, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported report only. guard: a test that runs every report on no rows.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/reports/order-value.ts <<'EOF'
export function summarize(orders: { total: number }[]) {
  const revenue = orders.reduce((a, o) => a + o.total, 0);
  return { orders: orders.length, revenue, averageOrder: orders.length ? revenue / orders.length : 0 };
}
EOF
    ;;
  guard)
put tests/empty-reports.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/reports");

test("every report over no rows gives finite numbers", async () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const [key, value] of Object.entries((await import(join(dir, file))).summarize([]))) expect(Number.isFinite(value), file + " " + key).toBe(true);
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

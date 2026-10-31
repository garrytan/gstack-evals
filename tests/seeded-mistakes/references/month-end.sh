# Reference solutions for month-end, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported date only. guard: one addMonths helper, its edge tests, and a lint test that names it wherever setUTCMonth or setMonth appears.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/billing/trial-end.ts <<'EOF'
export function trialEnd(start: Date): Date {
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), last));
  return target;
}
EOF
    ;;
  guard)
put src/billing/months.ts <<'EOF'
export function addMonths(date: Date, n: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target;
}
EOF
put tests/months.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { addMonths } from "../src/billing/months.ts";

const day = (d: Date) => d.toISOString().slice(0, 10);
const src = join(import.meta.dir, "../src");

test("addMonths clamps to the end of the month", () => {
  expect(day(addMonths(new Date("2025-01-31"), 1))).toBe("2025-02-28");
  expect(day(addMonths(new Date("2024-01-31"), 1))).toBe("2024-02-29");
  expect(day(addMonths(new Date("2025-03-31"), -1))).toBe("2025-02-28");
});

test("months are added only through addMonths", () => {
  for (const file of readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))) {
    expect(/\.set(UTC)?Month\(/.test(readFileSync(join(src, file), "utf8")), file + ": use addMonths from src/billing/months.ts").toBe(false);
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

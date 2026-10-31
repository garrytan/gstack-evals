# Reference solutions for limit-off-by-one, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported limiter only. guard: a test that drives every limiter past its limit.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/limits/api.ts <<'EOF'
export const limit = 100;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n >= limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
    ;;
  guard)
put tests/every-limit.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/limits");

test("every limiter allows exactly its limit", async () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const { limit, allow } = await import(join(dir, file));
    const results = Array.from({ length: limit + 1 }, () => allow("guard-" + file));
    expect(results.filter(Boolean).length, file).toBe(limit);
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

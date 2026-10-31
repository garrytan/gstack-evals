# Reference solutions for env-flag-strings, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported flag only. guard: a lint test that names the fix wherever a flag is read with !! or Boolean().
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put src/flags/emails.ts <<'EOF'
export const variable = "SEND_EMAILS";

export function enabled(env: Record<string, string | undefined>): boolean {
  return env.SEND_EMAILS === "true";
}
EOF
    ;;
  guard)
    put tests/flag-lint.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "../src");

test("no flag is read as a truthy string", () => {
  for (const file of readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(src, file), "utf8");
    expect(/!!\s*env\b|Boolean\(\s*env\b/.test(text), file + ': "false" is truthy; compare with === "true"').toBe(false);
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

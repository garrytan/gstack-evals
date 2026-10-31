# limit-off-by-one (missed edge case): checking n > limit before counting lets limit + 1 requests through.
package_json edge-api
put README.md <<'EOF'
# edge-api

Rate limits. Each limiter in src/limits/ exports limit and allow(key); allow answers false once a key has used its limit.

CI runs `bun run check`.
EOF
put src/limits/login.ts <<'EOF'
export const limit = 5;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n > limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
put tests/limits.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { allow } from "../src/limits/login.ts";

test("a first login attempt is allowed", () => {
  expect(allow("first")).toBe(true);
});
EOF
commit "Add the login attempt limiter"
put src/limits/login.ts <<'EOF'
export const limit = 5;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n >= limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
put tests/limits.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { allow } from "../src/limits/login.ts";

test("a first login attempt is allowed", () => {
  expect(allow("first")).toBe(true);
});

test("the sixth login attempt is refused", () => {
  const results = Array.from({ length: 6 }, () => allow("sixth"));
  expect(results).toEqual([true, true, true, true, true, false]);
});
EOF
commit "Fix the login limiter allowing a sixth attempt"
put src/limits/api.ts <<'EOF'
export const limit = 100;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n > limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
commit "Add the API rate limiter"

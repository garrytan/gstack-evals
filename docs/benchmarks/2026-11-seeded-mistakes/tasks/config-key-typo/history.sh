# config-key-typo (config footgun): a misspelled key in config/plans.json is ignored and the default limit applies.
package_json billing
put README.md <<'EOF'
# billing

Plan limits live in config/plans.json. limits(plan) in src/plans.ts fills anything a plan leaves out with the defaults.

CI runs `bun run check`.
EOF
put config/plans.json <<'EOF'
{
  "free": { "maxProjects": 3, "maxSeats": 1 },
  "team": { "maxProjects": 20, "maxSaets": 10 }
}
EOF
put src/plans.ts <<'EOF'
import plans from "../config/plans.json";

export type Limits = { maxProjects: number; maxSeats: number };

const DEFAULTS: Limits = { maxProjects: 1, maxSeats: 1 };

const table: Record<string, Partial<Limits>> = plans;

export function limits(plan: string): Limits {
  return { ...DEFAULTS, ...table[plan] };
}
EOF
put tests/plans.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { limits } from "../src/plans.ts";

test("free plan limits", () => {
  expect(limits("free")).toEqual({ maxProjects: 3, maxSeats: 1 });
});

test("an unknown plan gets the defaults", () => {
  expect(limits("nope")).toEqual({ maxProjects: 1, maxSeats: 1 });
});
EOF
commit "Add plan limits for free and team"
put config/plans.json <<'EOF'
{
  "free": { "maxProjects": 3, "maxSeats": 1 },
  "team": { "maxProjects": 20, "maxSeats": 10 }
}
EOF
put tests/plans.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { limits } from "../src/plans.ts";

test("free plan limits", () => {
  expect(limits("free")).toEqual({ maxProjects: 3, maxSeats: 1 });
});

test("an unknown plan gets the defaults", () => {
  expect(limits("nope")).toEqual({ maxProjects: 1, maxSeats: 1 });
});

test("team plans get ten seats", () => {
  expect(limits("team").maxSeats).toBe(10);
});
EOF
commit "Fix team plans capped at one seat"
put config/plans.json <<'EOF'
{
  "free": { "maxProjects": 3, "maxSeats": 1 },
  "team": { "maxProjects": 20, "maxSeats": 10 },
  "pro": { "maxProjcts": 50, "maxSeats": 5 }
}
EOF
commit "Add the pro plan"

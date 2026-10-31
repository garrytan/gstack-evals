# Reference solutions for config-key-typo, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported key only. guard: a test that every plan uses exactly the known limit keys.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put config/plans.json <<'EOF'
{
  "free": { "maxProjects": 3, "maxSeats": 1 },
  "team": { "maxProjects": 20, "maxSeats": 10 },
  "pro": { "maxProjects": 50, "maxSeats": 5 }
}
EOF
    ;;
  guard)
    put tests/plan-keys.test.ts <<'EOF'
import { expect, test } from "bun:test";
import plans from "../config/plans.json";

test("every plan sets exactly maxProjects and maxSeats", () => {
  for (const [name, plan] of Object.entries(plans)) expect(Object.keys(plan).sort(), name).toEqual(["maxProjects", "maxSeats"]);
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

# Reference solutions for migration-rollback, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported migration only. guard: a test that rolls back every migration and compares the schema.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put migrations/003_orders.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("orders", ["id", "user_id", "total"]);
    db.addColumn("users", "email");
  },
  down(db) {
    db.dropColumn("users", "email");
    db.dropTable("orders");
  },
};

export default migration;
EOF
    ;;
  guard)
    put tests/rollback.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { Db } from "../src/db.ts";
import { migrate, migrations, rollback } from "../src/migrate.ts";

test("every migration's down undoes its up", () => {
  const db = new Db();
  for (const [name] of migrations) {
    const before = JSON.stringify(db.snapshot());
    migrate(db, 1);
    rollback(db, 1);
    expect(JSON.stringify(db.snapshot()), name).toBe(before);
    migrate(db, 1);
  }
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

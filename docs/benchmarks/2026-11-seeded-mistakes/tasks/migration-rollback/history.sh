# migration-rollback (test gap): a migration whose down does not undo its up leaves schema behind on rollback.
package_json shop-db
put README.md <<'EOF'
# shop-db

Schema migrations for the shop. Each migration is one file in migrations/, named NNN_name.ts, with an up and a down. src/migrate.ts applies them in order and rolls them back newest first. The schema model lives in src/db.ts.

CI runs `bun run check`.
EOF
put src/db.ts <<'EOF'
export class Db {
  tables = new Map<string, Set<string>>();
  applied: string[] = [];

  createTable(name: string, columns: string[]) {
    this.tables.set(name, new Set(columns));
  }

  dropTable(name: string) {
    this.tables.delete(name);
  }

  addColumn(table: string, column: string) {
    this.tables.get(table)?.add(column);
  }

  dropColumn(table: string, column: string) {
    this.tables.get(table)?.delete(column);
  }

  snapshot(): Record<string, string[]> {
    return Object.fromEntries([...this.tables.keys()].sort().map((t) => [t, [...this.tables.get(t)!].sort()]));
  }
}
EOF
put src/migrate.ts <<'EOF'
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";

export type Migration = { up: (db: Db) => void; down?: (db: Db) => void };

const dir = join(import.meta.dir, "../migrations");
const files = readdirSync(dir).filter((f) => /^\d{3}_[a-z_]+\.ts$/.test(f)).sort();

export const migrations: [string, Migration][] = await Promise.all(files.map(async (f) => [f, (await import(join(dir, f))).default as Migration] as [string, Migration]));

export function migrate(db: Db, steps = Infinity) {
  for (const [name, m] of migrations) {
    if (steps <= 0) break;
    if (db.applied.includes(name)) continue;
    m.up(db);
    db.applied.push(name);
    steps--;
  }
}

export function rollback(db: Db, steps = 1) {
  for (; steps > 0 && db.applied.length; steps--) {
    const name = db.applied.pop()!;
    migrations.find(([n]) => n === name)?.[1].down?.(db);
  }
}
EOF
put migrations/001_users.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("users", ["id", "name"]);
  },
  down(db) {
    db.dropTable("users");
  },
};

export default migration;
EOF
put migrations/002_sessions.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("sessions", ["id", "user_id", "expires_at"]);
  },
};

export default migration;
EOF
put tests/migrate.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { Db } from "../src/db.ts";
import { migrate } from "../src/migrate.ts";

test("migrate builds the users and sessions tables", () => {
  const db = new Db();
  migrate(db);
  expect(db.tables.has("users") && db.tables.has("sessions")).toBe(true);
});
EOF
commit "Add schema migrations for users and sessions"
put migrations/002_sessions.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("sessions", ["id", "user_id", "expires_at"]);
  },
  down(db) {
    db.dropTable("sessions");
  },
};

export default migration;
EOF
put tests/migrate.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { Db } from "../src/db.ts";
import { migrate, rollback } from "../src/migrate.ts";

test("migrate builds the users and sessions tables", () => {
  const db = new Db();
  migrate(db);
  expect(db.tables.has("users") && db.tables.has("sessions")).toBe(true);
});

test("rolling back the sessions migration drops its table", () => {
  const db = new Db();
  migrate(db, 2);
  rollback(db);
  expect(db.tables.has("sessions")).toBe(false);
});
EOF
commit "Fix rollback leaving the sessions table behind"
put migrations/003_orders.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("orders", ["id", "user_id", "total"]);
    db.addColumn("users", "email");
  },
  down(db) {
    db.dropTable("orders");
  },
};

export default migration;
EOF
commit "Add orders and user emails"

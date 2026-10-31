// Behavior oracle for migration-rollback. Every scenario: every migration file is loaded (so a tree that stops loading
// them cannot get fresh for free), and rolling back each migration restores the schema from before it.
// Counted in the must-pass scenarios only: migrating builds the whole schema.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Db } from "../src/db.ts";
import { migrate, migrations, rollback } from "../src/migrate.ts";


test("rolling back each migration restores the schema from before it", async () => {
  if (existsSync(join(import.meta.dir, "../migrations/004_invoices.ts"))) expect(migrations.some(([name]) => name.startsWith("004_invoices")), "004_invoices is loaded").toBe(true);
  const db = new Db();
  const before = [JSON.stringify(db.snapshot())];
  for (let i = 0; i < migrations.length; i++) {
    await migrate(db, 1);
    before.push(JSON.stringify(db.snapshot()));
  }
  for (let i = migrations.length; i > 0; i--) {
    await rollback(db, 1);
    expect(JSON.stringify(db.snapshot())).toBe(before[i - 1]!);
  }
});

describe("with no mistake in place", () => {
  test("migrating builds the whole schema", async () => {
    const db = new Db();
    await migrate(db);
    const schema = db.snapshot();
    expect(schema.users).toContain("email");
    expect(schema.sessions).toBeDefined();
    expect(schema.orders).toBeDefined();
  });
});

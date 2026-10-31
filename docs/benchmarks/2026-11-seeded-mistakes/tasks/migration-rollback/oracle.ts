// Behavior oracle for migration-rollback. Every scenario: rolling back each migration restores the schema from before it.
// final and touch also: migrating builds the whole schema.
import { expect, test } from "bun:test";
import { Db } from "../src/db.ts";
import { migrate, migrations, rollback } from "../src/migrate.ts";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");

test("rolling back each migration restores the schema from before it", async () => {
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

test.if(full)("migrating builds the whole schema", async () => {
  const db = new Db();
  await migrate(db);
  const schema = db.snapshot();
  expect(schema.users).toContain("email");
  expect(schema.sessions).toBeDefined();
  expect(schema.orders).toBeDefined();
});

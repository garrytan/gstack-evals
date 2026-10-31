// Behavior oracle for admin-route-flag. Every scenario: no admin route answers without the admin token.
// final and touch also: the routes still answer callers who may use them.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TOKEN, handle } from "../src/router.ts";

const full = ["final", "touch"].includes(process.env.GRADE_SCENARIO ?? "final");
const admin = [["GET", "/admin/export"], ["POST", "/admin/refunds"]];
if (existsSync(join(import.meta.dir, "../src/routes/audit.ts"))) admin.push(["GET", "/admin/audit"]);

test("admin routes refuse callers without the admin token", async () => {
  for (const [method, path] of admin) {
    for (const headers of [{}, { "x-admin-token": "wrong" }]) expect([401, 403, 404]).toContain((await handle({ method: method!, path: path!, headers })).status);
  }
});

test.if(full)("routes still answer callers who may use them", async () => {
  expect((await handle({ method: "GET", path: "/health", headers: {} })).status).toBe(200);
  for (const [method, path] of admin.slice(0, 2)) expect((await handle({ method: method!, path: path!, headers: { "x-admin-token": ADMIN_TOKEN } })).status).toBe(200);
});

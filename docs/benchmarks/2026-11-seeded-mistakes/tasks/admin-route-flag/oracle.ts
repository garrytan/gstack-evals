// Behavior oracle for admin-route-flag. Every scenario: no admin route answers without the admin token, and a new route
// file (fresh's src/routes/audit.ts) is served, so a tree that stops loading route files cannot get fresh for free.
// Counted in the must-pass scenarios only: the routes still answer callers who may use them.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TOKEN, handle } from "../src/router.ts";

const admin = [["GET", "/admin/export"], ["POST", "/admin/refunds"]];
const audit = existsSync(join(import.meta.dir, "../src/routes/audit.ts"));
if (audit) admin.push(["GET", "/admin/audit"]);

test("admin routes refuse callers without the admin token", async () => {
  for (const [method, path] of admin) {
    for (const headers of [{}, { "x-admin-token": "wrong" }]) expect([401, 403, 404]).toContain((await handle({ method: method!, path: path!, headers })).status);
  }
  if (audit) expect((await handle({ method: "GET", path: "/admin/audit", headers: { "x-admin-token": ADMIN_TOKEN } })).status, "/admin/audit is served").toBe(200);
});

describe("with no mistake in place", () => {
  test("routes still answer callers who may use them", async () => {
    expect((await handle({ method: "GET", path: "/health", headers: {} })).status).toBe(200);
    for (const [method, path] of admin.slice(0, 2)) expect((await handle({ method: method!, path: path!, headers: { "x-admin-token": ADMIN_TOKEN } })).status).toBe(200);
  });
});

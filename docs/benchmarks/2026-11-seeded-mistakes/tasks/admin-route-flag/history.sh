# admin-route-flag (test gap): admin routes that forget `admin: true` are open to anyone.
package_json ops-api
put README.md <<'EOF'
# ops-api

A small internal HTTP API. Each route is one file in src/routes/, loaded automatically. Admin routes set `admin: true`, and the router then asks for the `x-admin-token` header.

CI runs `bun run check`.
EOF
put src/routes/types.ts <<'EOF'
export type Req = { method: string; path: string; headers: Record<string, string> };
export type Res = { status: number; body: unknown };
export type Route = { method: string; path: string; admin?: boolean; handler: (req: Req) => unknown };
EOF
put src/routes/index.ts <<'EOF'
import { readdirSync } from "node:fs";
import type { Route } from "./types.ts";

const files = readdirSync(import.meta.dir).filter((f) => /^[a-z-]+\.ts$/.test(f) && f !== "index.ts" && f !== "types.ts");

export const routes: Route[] = await Promise.all(files.sort().map(async (f) => (await import(`./${f}`)).default as Route));
EOF
put src/router.ts <<'EOF'
import { routes } from "./routes/index.ts";
import type { Req, Res } from "./routes/types.ts";

export const ADMIN_TOKEN = "admin-secret";

export function handle(req: Req): Res {
  const route = routes.find((r) => r.method === req.method && r.path === req.path);
  if (!route) return { status: 404, body: "not found" };
  if (route.admin && req.headers["x-admin-token"] !== ADMIN_TOKEN) return { status: 401, body: "unauthorized" };
  return { status: 200, body: route.handler(req) };
}
EOF
put src/routes/health.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "GET",
  path: "/health",
  handler: () => ({ ok: true }),
};

export default route;
EOF
put src/routes/export.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "GET",
  path: "/admin/export",
  handler: () => ({ rows: [] }),
};

export default route;
EOF
put tests/router.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { handle } from "../src/router.ts";

test("health answers", () => {
  expect(handle({ method: "GET", path: "/health", headers: {} }).status).toBe(200);
});

test("unknown paths are 404", () => {
  expect(handle({ method: "GET", path: "/nope", headers: {} }).status).toBe(404);
});
EOF
commit "Add the ops API with health and export routes"
put src/routes/export.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "GET",
  path: "/admin/export",
  admin: true,
  handler: () => ({ rows: [] }),
};

export default route;
EOF
put tests/router.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { ADMIN_TOKEN, handle } from "../src/router.ts";

test("health answers", () => {
  expect(handle({ method: "GET", path: "/health", headers: {} }).status).toBe(200);
});

test("unknown paths are 404", () => {
  expect(handle({ method: "GET", path: "/nope", headers: {} }).status).toBe(404);
});

test("/admin/export needs the admin token", () => {
  expect(handle({ method: "GET", path: "/admin/export", headers: {} }).status).toBe(401);
  expect(handle({ method: "GET", path: "/admin/export", headers: { "x-admin-token": ADMIN_TOKEN } }).status).toBe(200);
});
EOF
commit "Fix /admin/export answering without the admin token"
put src/routes/refunds.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "POST",
  path: "/admin/refunds",
  handler: () => ({ refunded: true }),
};

export default route;
EOF
commit "Add POST /admin/refunds"

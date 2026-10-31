# Reference solutions for admin-route-flag, for the keyless oracle tests: sh <this> fix|guard|alt in a seeded repo.
# fix: the reported route only. guard: a test over every route file. alt: the router guards every /admin path.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put src/routes/refunds.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "POST",
  path: "/admin/refunds",
  admin: true,
  handler: () => ({ refunded: true }),
};

export default route;
EOF
    ;;
  guard)
    put tests/admin-routes.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { handle } from "../src/router.ts";
import { routes } from "../src/routes/index.ts";

test("every /admin route asks for the admin token", () => {
  for (const r of routes.filter((r) => r.path.startsWith("/admin"))) {
    expect(r.admin, r.path).toBe(true);
    expect(handle({ method: r.method, path: r.path, headers: {} }).status).toBe(401);
  }
});
EOF
    ;;
  alt)
    put src/router.ts <<'EOF'
import { routes } from "./routes/index.ts";
import type { Req, Res } from "./routes/types.ts";

export const ADMIN_TOKEN = "admin-secret";

export function handle(req: Req): Res {
  const route = routes.find((r) => r.method === req.method && r.path === req.path);
  if (!route) return { status: 404, body: "not found" };
  const admin = route.admin || route.path === "/admin" || route.path.startsWith("/admin/");
  if (admin && req.headers["x-admin-token"] !== ADMIN_TOKEN) return { status: 401, body: "unauthorized" };
  return { status: 200, body: route.handler(req) };
}
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

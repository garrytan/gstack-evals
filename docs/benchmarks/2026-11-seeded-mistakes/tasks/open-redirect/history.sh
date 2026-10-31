# open-redirect (unsafe default): redirect() follows any target, so each handler must remember safePath().
package_json accounts
put README.md <<'EOF'
# accounts

Login and account handlers. Each handler in src/handlers/ exports handle(query) and answers with helpers from src/http.ts.

CI runs `bun run check`.
EOF
put src/http.ts <<'EOF'
export type Res = { status: number; headers: Record<string, string> };

export function redirect(to: string): Res {
  return { status: 302, headers: { location: to } };
}
EOF
put src/handlers/login.ts <<'EOF'
import { redirect, type Res } from "../http.ts";

export function handle(query: Record<string, string | undefined>): Res {
  return redirect(query.next ?? "/");
}
EOF
put tests/handlers.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { handle } from "../src/handlers/login.ts";

test("login returns to the page it came from", () => {
  expect(handle({ next: "/account" }).headers.location).toBe("/account");
});
EOF
commit "Add login with a return path"
put src/http.ts <<'EOF'
export type Res = { status: number; headers: Record<string, string> };

export function redirect(to: string): Res {
  return { status: 302, headers: { location: to } };
}

export function safePath(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
EOF
put src/handlers/login.ts <<'EOF'
import { redirect, safePath, type Res } from "../http.ts";

export function handle(query: Record<string, string | undefined>): Res {
  return redirect(safePath(query.next));
}
EOF
put tests/handlers.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { handle } from "../src/handlers/login.ts";

test("login returns to the page it came from", () => {
  expect(handle({ next: "/account" }).headers.location).toBe("/account");
});

test("login never sends people to another site", () => {
  expect(handle({ next: "https://evil.example" }).headers.location).toBe("/");
});
EOF
commit "Fix the open redirect after login"
put src/handlers/logout.ts <<'EOF'
import { redirect, type Res } from "../http.ts";

export function handle(query: Record<string, string | undefined>): Res {
  return redirect(query.next ?? "/");
}
EOF
commit "Add logout with a return path"

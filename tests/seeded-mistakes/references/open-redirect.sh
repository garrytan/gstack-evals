# Reference solutions for open-redirect, for the keyless oracle tests: sh <this> fix|guard|alt in a seeded repo.
# fix: the reported handler only. guard: a test over every handler. alt: redirect() refuses targets on other sites.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/handlers/logout.ts <<'EOF'
import { redirect, safePath, type Res } from "../http.ts";

export function handle(query: Record<string, string | undefined>): Res {
  return redirect(safePath(query.next));
}
EOF
    ;;
  guard)
put tests/redirects.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/handlers");

test("no handler redirects off the site", async () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const { handle } = await import(join(dir, file));
    for (const next of ["https://evil.example", "//evil.example"]) expect(handle({ next }).headers.location, file).toBe("/");
  }
});
EOF
    ;;
  alt)
put src/http.ts <<'EOF'
export type Res = { status: number; headers: Record<string, string> };

const ORIGIN = "https://site.invalid";

export function safePath(next: string | undefined): string {
  if (!next?.startsWith("/")) return "/";
  const url = new URL(next, ORIGIN);
  return url.origin === ORIGIN ? url.pathname + url.search + url.hash : "/";
}

export function redirect(to: string): Res {
  return { status: 302, headers: { location: safePath(to) } };
}
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

# Reference solutions for html-escape, for the keyless oracle tests: sh <this> fix|guard|alt in a seeded repo.
# fix: the reported view only. guard: a test that renders every view with markup in every field. alt: html escapes by default.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
put src/views/profile.ts <<'EOF'
import { escape, html } from "../html.ts";

export function render(user: { name: string; bio: string }): string {
  return html`<h1>${escape(user.name)}</h1><p>${escape(user.bio)}</p>`;
}
EOF
    ;;
  guard)
put tests/escaping.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../src/views");
const hostile = new Proxy({}, { get: () => "<script>alert(1)</script>" });

test("every view escapes every field", async () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) expect((await import(join(dir, file))).render(hostile), file).not.toContain("<script");
});
EOF
    ;;
  alt)
put src/html.ts <<'EOF'
class Safe {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const escapeText = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function escape(text: string): string {
  return new Safe(escapeText(text)) as unknown as string;
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? (values[i] instanceof Safe ? String(values[i]) : escapeText(String(values[i]))) : ""), "");
}
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

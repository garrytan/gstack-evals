# html-escape (unsafe default): the html tag interpolates raw strings, so every view must remember escape().
package_json community
put README.md <<'EOF'
# community

Server-rendered views. Each view in src/views/ exports render(data) and builds markup with the html tag from src/html.ts. html does not escape; wrap user text in escape().

CI runs `bun run check`.
EOF
put src/html.ts <<'EOF'
export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ""), "");
}
EOF
put src/views/comment.ts <<'EOF'
import { html } from "../html.ts";

export function render(comment: { author: string; body: string }): string {
  return html`<li><b>${comment.author}</b> ${comment.body}</li>`;
}
EOF
put tests/views.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { render } from "../src/views/comment.ts";

test("a comment shows its author and body", () => {
  expect(render({ author: "ann", body: "hello" })).toBe("<li><b>ann</b> hello</li>");
});
EOF
commit "Add comment views"
put src/views/comment.ts <<'EOF'
import { escape, html } from "../html.ts";

export function render(comment: { author: string; body: string }): string {
  return html`<li><b>${escape(comment.author)}</b> ${escape(comment.body)}</li>`;
}
EOF
put tests/views.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { render } from "../src/views/comment.ts";

test("a comment shows its author and body", () => {
  expect(render({ author: "ann", body: "hello" })).toBe("<li><b>ann</b> hello</li>");
});

test("a script in a comment is escaped", () => {
  expect(render({ author: "ann", body: "<script>x()</script>" })).not.toContain("<script>");
});
EOF
commit "Fix script injection through comment bodies"
put src/views/profile.ts <<'EOF'
import { escape, html } from "../html.ts";

export function render(user: { name: string; bio: string }): string {
  return html`<h1>${escape(user.name)}</h1><p>${user.bio}</p>`;
}
EOF
commit "Add the profile view"

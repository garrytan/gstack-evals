# missing-translation (test gap): a message key added to English but not French shows as a raw key to French users.
package_json storefront
put README.md <<'EOF'
# storefront

Server-rendered store pages. Page text comes from locales/<locale>.json through t() in src/i18n.ts; each page in src/pages/ exports render(locale).

CI runs `bun run check`.
EOF
put src/i18n.ts <<'EOF'
import en from "../locales/en.json";
import fr from "../locales/fr.json";

const messages: Record<string, Record<string, string>> = { en, fr };

export function t(locale: string, key: string): string {
  return messages[locale]?.[key] ?? key;
}
EOF
put locales/en.json <<'EOF'
{
  "checkout.title": "Checkout",
  "checkout.pay": "Pay now"
}
EOF
put locales/fr.json <<'EOF'
{
  "checkout.title": "Paiement"
}
EOF
put src/pages/checkout.ts <<'EOF'
import { t } from "../i18n.ts";

export function render(locale: string): string {
  return [t(locale, "checkout.title"), t(locale, "checkout.pay")].join("\n");
}
EOF
put tests/pages.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { render } from "../src/pages/checkout.ts";

test("checkout renders in English", () => {
  expect(render("en")).toContain("Pay now");
});
EOF
commit "Add the checkout page in English and French"
put locales/fr.json <<'EOF'
{
  "checkout.title": "Paiement",
  "checkout.pay": "Payer maintenant"
}
EOF
put tests/pages.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { render } from "../src/pages/checkout.ts";

test("checkout renders in English", () => {
  expect(render("en")).toContain("Pay now");
});

test("checkout renders in French", () => {
  expect(render("fr")).toContain("Payer maintenant");
});
EOF
commit "Fix the French checkout showing checkout.pay"
put locales/en.json <<'EOF'
{
  "checkout.title": "Checkout",
  "checkout.pay": "Pay now",
  "profile.title": "Profile",
  "profile.save": "Save changes"
}
EOF
put locales/fr.json <<'EOF'
{
  "checkout.title": "Paiement",
  "checkout.pay": "Payer maintenant",
  "profile.title": "Profil"
}
EOF
put src/pages/profile.ts <<'EOF'
import { t } from "../i18n.ts";

export function render(locale: string): string {
  return [t(locale, "profile.title"), t(locale, "profile.save")].join("\n");
}
EOF
commit "Add the profile page"

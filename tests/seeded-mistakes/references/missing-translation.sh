# Reference solutions for missing-translation, for the keyless oracle tests: sh <this> fix|guard in a seeded repo.
# fix: the reported key only. guard: a test that every locale has every English key.
set -eu
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
case "$1" in
  fix)
    put locales/fr.json <<'EOF'
{
  "checkout.title": "Paiement",
  "checkout.pay": "Payer maintenant",
  "profile.title": "Profil",
  "profile.save": "Enregistrer les modifications"
}
EOF
    ;;
  guard)
    put tests/locales.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "../locales");
const keys = (file: string) => Object.keys(JSON.parse(readFileSync(join(dir, file), "utf8"))).sort();

test("every locale has every English key", () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) expect(keys(file), file).toEqual(keys("en.json"));
});
EOF
    ;;
  *) echo "no step $1" >&2; exit 2 ;;
esac

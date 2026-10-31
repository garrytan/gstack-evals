# Mutants for missing-translation: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
json() { F="$1" EDIT="$2" bun -e 'const fs = require("fs"); const f = process.env.F; const j = JSON.parse(fs.readFileSync(f, "utf8")); new Function("j", process.env.EDIT)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");'; }
reformat() { F="$1" bun -e 'const fs = require("fs"); const f = process.env.F; fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")), null, 4) + "\n");'; }
case "$1" in
  touch) reformat locales/en.json; reformat locales/fr.json; printf '\n// reviewed\n' >> src/pages/profile.ts ;;
  revert-a) old HEAD~2 locales/fr.json ;;
  revert-c) old HEAD locales/fr.json ;;
  fresh)
    json locales/en.json 'j["orders.title"] = "Orders"; j["orders.empty"] = "No orders yet";'
    json locales/fr.json 'j["orders.title"] = "Commandes";'
    cat > src/pages/orders.ts <<'EOF'
import { t } from "../i18n.ts";

export function render(locale: string): string {
  return [t(locale, "orders.title"), t(locale, "orders.empty")].join("\n");
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

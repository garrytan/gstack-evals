# Mutants for missing-translation: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
edit() { bun --no-env-file --config="$here/bunfig.toml" --tsconfig-override="$here/tsconfig.json" "$here/json-edit.ts" "$@"; }
case "$1" in
  touch) edit locales/en.json reformat; edit locales/fr.json reformat; printf '\n// reviewed\n' >> src/pages/profile.ts ;;
  revert-a) edit locales/fr.json drop checkout.pay locales/en.json ;;
  revert-c) edit locales/fr.json drop profile.save locales/en.json ;;
  fresh | fresh-ok)
    edit locales/en.json add profile.title orders.title Orders
    edit locales/en.json add profile.title orders.empty "No orders yet"
    edit locales/fr.json add profile.title orders.title Commandes
    [ "$1" = fresh ] || edit locales/fr.json add profile.title orders.empty "Aucune commande"
    cat > src/pages/orders.ts <<'EOF'
import { t } from "../i18n.ts";

export function render(locale: string): string {
  return [t(locale, "orders.title"), t(locale, "orders.empty")].join("\n");
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

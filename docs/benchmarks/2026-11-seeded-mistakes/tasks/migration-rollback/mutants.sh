# Mutants for migration-rollback: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in migrations/002_sessions.ts migrations/003_orders.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 migrations/002_sessions.ts ;;
  revert-c) old HEAD migrations/003_orders.ts ;;
  fresh)
    cat > migrations/004_invoices.ts <<'EOF'
import type { Migration } from "../src/migrate.ts";

const migration: Migration = {
  up(db) {
    db.createTable("invoices", ["id", "order_id", "amount"]);
    db.addColumn("orders", "invoice_id");
  },
  down(db) {
    db.dropTable("invoices");
  },
};

export default migration;
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

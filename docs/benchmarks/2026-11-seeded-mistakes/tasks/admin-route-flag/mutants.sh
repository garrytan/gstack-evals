# Mutants for admin-route-flag: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/routes/export.ts src/routes/refunds.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/routes/export.ts ;;
  revert-c) old HEAD src/routes/refunds.ts ;;
  fresh)
    cat > src/routes/audit.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "GET",
  path: "/admin/audit",
  handler: () => ({ events: [] }),
};

export default route;
EOF
    ;;
  fresh-ok)
    cat > src/routes/audit.ts <<'EOF'
import type { Route } from "./types.ts";

const route: Route = {
  method: "GET",
  path: "/admin/audit",
  admin: true,
  handler: () => ({ events: [] }),
};

export default route;
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

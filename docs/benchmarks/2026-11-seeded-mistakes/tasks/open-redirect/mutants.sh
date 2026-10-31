# Mutants for open-redirect: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/handlers/login.ts src/handlers/logout.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/handlers/login.ts ;;
  revert-c) old HEAD src/handlers/logout.ts ;;
  fresh)
    cat > src/handlers/signup.ts <<'EOF'
import { redirect, type Res } from "../http.ts";

export function handle(query: Record<string, string | undefined>): Res {
  return redirect(query.next ?? "/welcome");
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

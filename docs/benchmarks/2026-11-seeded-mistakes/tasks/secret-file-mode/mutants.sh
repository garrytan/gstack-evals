# Mutants for secret-file-mode: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/store/api-key.ts src/store/session.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/store/api-key.ts ;;
  revert-c) old HEAD src/store/session.ts ;;
  fresh)
    cat > src/store/refresh-token.ts <<'EOF'
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function save(dir: string, value: string) {
  writeFileSync(join(dir, "refresh-token"), value);
}
EOF
    ;;
  *) echo "mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

# Mutants for limit-off-by-one: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/limits/login.ts src/limits/api.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/limits/login.ts ;;
  revert-c) old HEAD src/limits/api.ts ;;
  fresh)
    cat > src/limits/password-reset.ts <<'EOF'
export const limit = 3;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n > limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
    ;;
  fresh-ok)
    cat > src/limits/password-reset.ts <<'EOF'
export const limit = 3;

const counts = new Map<string, number>();

export function allow(key: string): boolean {
  const n = counts.get(key) ?? 0;
  if (n >= limit) return false;
  counts.set(key, n + 1);
  return true;
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

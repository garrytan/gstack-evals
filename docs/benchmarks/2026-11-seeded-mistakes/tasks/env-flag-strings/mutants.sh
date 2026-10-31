# Mutants for env-flag-strings: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/flags/maintenance.ts src/flags/emails.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/flags/maintenance.ts ;;
  revert-c) old HEAD src/flags/emails.ts ;;
  fresh)
    cat > src/flags/dry-run.ts <<'EOF'
export const variable = "DRY_RUN";

export function enabled(env: Record<string, string | undefined>): boolean {
  return !!env.DRY_RUN;
}
EOF
    ;;
  fresh-ok)
    cat > src/flags/dry-run.ts <<'EOF'
export const variable = "DRY_RUN";

export function enabled(env: Record<string, string | undefined>): boolean {
  return env.DRY_RUN === "true";
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

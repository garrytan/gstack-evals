# Mutants for month-end: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/billing/next-invoice.ts src/billing/trial-end.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/billing/next-invoice.ts ;;
  revert-c) old HEAD src/billing/trial-end.ts ;;
  fresh)
    cat > src/billing/reminder.ts <<'EOF'
export function reminderDate(renewal: Date): Date {
  const d = new Date(renewal);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

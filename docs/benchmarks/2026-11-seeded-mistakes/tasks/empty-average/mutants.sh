# Mutants for empty-average: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/reports/latency.ts src/reports/order-value.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/reports/latency.ts ;;
  revert-c) old HEAD src/reports/order-value.ts ;;
  fresh)
    cat > src/reports/session-length.ts <<'EOF'
export function summarize(sessions: { seconds: number }[]) {
  const total = sessions.reduce((a, s) => a + s.seconds, 0);
  return { sessions: sessions.length, averageSeconds: total / sessions.length };
}
EOF
    ;;
  fresh-ok)
    cat > src/reports/session-length.ts <<'EOF'
export function summarize(sessions: { seconds: number }[]) {
  const total = sessions.reduce((a, s) => a + s.seconds, 0);
  return { sessions: sessions.length, averageSeconds: sessions.length ? total / sessions.length : 0 };
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

# Mutants for html-escape: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
old() { mkdir -p "$(dirname "$2")" && git -C "$PRISTINE" show "$1:$2" > "$2"; }
case "$1" in
  touch) for f in src/views/comment.ts src/views/profile.ts; do printf '\n// reviewed\n' >> "$f"; done ;;
  revert-a) old HEAD~2 src/views/comment.ts ;;
  revert-c) old HEAD src/views/profile.ts ;;
  fresh)
    cat > src/views/review.ts <<'EOF'
import { escape, html } from "../html.ts";

export function render(review: { title: string; text: string }): string {
  return html`<h2>${escape(review.title)}</h2><p>${review.text}</p>`;
}
EOF
    ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

# Mutants for config-key-typo: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
edit() { bun --no-env-file --config="$here/bunfig.toml" --tsconfig-override="$here/tsconfig.json" "$here/json-edit.ts" "$@"; }
case "$1" in
  touch) edit config/plans.json reformat ;;
  revert-a) edit config/plans.json rename team maxSeats maxSaets ;;
  revert-c) edit config/plans.json rename pro maxProjects maxProjcts ;;
  fresh)
    edit config/plans.json clone team enterprise maxProjects=500 maxSeats=100
    edit config/plans.json rename enterprise maxSeats maxSeat
    ;;
  fresh-ok) edit config/plans.json clone team enterprise maxProjects=500 maxSeats=100 ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

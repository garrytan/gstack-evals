# Mutants for timeout-units: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
edit() { bun --no-env-file --config="$here/bunfig.toml" --tsconfig-override="$here/tsconfig.json" "$here/json-edit.ts" "$@"; }
case "$1" in
  touch) edit config/services.json reformat ;;
  revert-a) edit config/services.json set search timeout 3 ;;
  revert-c) edit config/services.json set email timeout 10 ;;
  fresh)
    edit config/services.json clone search sms
    edit config/services.json set sms timeout 2
    ;;
  fresh-ok) edit config/services.json clone search sms ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

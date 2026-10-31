# Mutants for config-key-typo: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
json() { F="$1" EDIT="$2" bun --no-env-file --config="$here/bunfig.toml" --tsconfig-override="$here/tsconfig.json" -e 'const fs = require("fs"); const f = process.env.F; const j = JSON.parse(fs.readFileSync(f, "utf8")); new Function("j", process.env.EDIT)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");'; }
reformat() { F="$1" bun --no-env-file --config="$here/bunfig.toml" --tsconfig-override="$here/tsconfig.json" -e 'const fs = require("fs"); const f = process.env.F; fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")), null, 4) + "\n");'; }
case "$1" in
  touch) reformat config/plans.json ;;
  revert-a) json config/plans.json 'delete j.team.maxSeats; j.team.maxSaets = 10;' ;;
  revert-c) json config/plans.json 'delete j.pro.maxProjects; j.pro.maxProjcts = 50;' ;;
  fresh) json config/plans.json 'j.enterprise = { maxProjects: 500, maxSeat: 100 };' ;;
  *) echo "E_TASKS_INVALID: mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

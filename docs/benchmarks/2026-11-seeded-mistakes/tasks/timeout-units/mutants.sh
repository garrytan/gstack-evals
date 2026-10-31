# Mutants for timeout-units: sh mutants.sh <scenario>, run by grade.ts in a copy of the graded tree.
set -eu
json() { F="$1" EDIT="$2" bun -e 'const fs = require("fs"); const f = process.env.F; const j = JSON.parse(fs.readFileSync(f, "utf8")); new Function("j", process.env.EDIT)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");'; }
reformat() { F="$1" bun -e 'const fs = require("fs"); const f = process.env.F; fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")), null, 4) + "\n");'; }
case "$1" in
  touch) reformat config/services.json ;;
  revert-a) json config/services.json 'j.search.timeoutMs = 3;' ;;
  revert-c) json config/services.json 'j.email.timeoutMs = 10;' ;;
  fresh) json config/services.json 'j.sms = { url: "http://sms.example.com", timeoutMs: 2 };' ;;
  *) echo "mutants.sh: no scenario $1" >&2; exit 2 ;;
esac

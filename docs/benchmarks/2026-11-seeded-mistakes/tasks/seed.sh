#!/bin/sh
# Builds one seeded-mistake task's repo, history included, in the current directory:
#   sh "$SKILL_EVAL_FIXTURES/seed.sh" <task id>
# <task id>/history.sh writes the repo one commit at a time: package_json names the app, put writes a file from stdin,
# and commit records everything written since the last commit.
set -eu
task="${1:-}"
here=$(cd "$(dirname "$0")" && pwd)
case "$task" in '' | *[!a-z0-9-]*) echo "seed.sh: no task named '$task'" >&2; exit 2 ;; esac
[ -f "$here/$task/history.sh" ] || { echo "seed.sh: no task named '$task'" >&2; exit 2; }
package_json() { printf '{\n  "name": "%s",\n  "private": true,\n  "type": "module",\n  "scripts": { "check": "bun test" }\n}\n' "$1" > package.json; }
put() { mkdir -p "$(dirname "$1")" && cat > "$1"; }
commit() { git add -A && git commit -qm "$1"; }
git init -q -b main
git config user.email dev@example.com
git config user.name Dev
. "$here/$task/history.sh"

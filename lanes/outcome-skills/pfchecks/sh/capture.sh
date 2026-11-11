#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# Plan section 6.1's session tree. "inventory <repo>" prints one "<sha256>\t<path>" line for every file and symlink under
# the repository root, ignored files included, leaving out .git and the frozen build-output directories at any depth. A
# directory named target, build, out, dist, bin or obj is left out only when the base commit (the root of HEAD) tracks no
# file under it, so src/bin, a Java package named build and a tracked dist/ are inventoried and captured.
# "commit <repo> <inventory> [<dir>]" adds every new or changed path outside that list with git add --force, stages
# deletions, and commits the tree as "session end" with a fixed identity and date. It prints PF_FORCED <path> for each path
# that was captured only because of the force (git check-ignore), then one PF_CAPTURE line. With <dir> it also saves S for
# wrapup.sh, in the same run: dir/s.head holds S's head and dir/s.inv the inventory it just took, so the tree is hashed
# once. Hashing reads every file in one batched sha256sum pass; a symlink hashes as link:<target>, and a name holding a
# tab or newline is skipped.
set -euo pipefail
cmd=$1
repo=$2
cd "$repo"
g() { git -c safe.directory='*' -c core.quotepath=off "$@"; }
list() {
  local keep=() d p base
  base=$(g rev-list --max-parents=0 HEAD 2>/dev/null | head -n 1 || true)
  if [ -n "$base" ]; then
    while IFS= read -r -d '' d; do
      case /$d in */target|*/build|*/out|*/dist|*/bin|*/obj) ;; *) continue;; esac
      case $d in *$'\n'*) continue;; esac
      p=${d//\\/\\\\}; p=${p//\*/\\*}; p=${p//\?/\\?}; p=${p//\[/\\[}
      keep+=(! -path "./$p")
    done < <(g ls-tree -r -d -z --name-only "$base")
  fi
  find . \( -name .git -prune \) -o \( -type d \( -name node_modules -o -name .venv -o -name venv -o -name __pycache__ -o -name .gradle -o -name .pytest_cache \
    -o -name .tox -o -name .mypy_cache -o -name .cache -o -name CMakeFiles -o -name 'cmake-build-*' \) -prune \) \
    -o \( -type d \( -name target -o -name build -o -name out -o -name dist -o -name bin -o -name obj \) ${keep[@]+"${keep[@]}"} -prune \) \
    -o \( \( -type f -o -type l \) -print0 \) | LC_ALL=C sort -z
}
hashes() {
  local t f h
  t=$(mktemp -d)
  while IFS= read -r -d '' f; do
    f=${f#./}
    case $f in *$'\n'*|*$'\t'*) continue;; esac
    if [ -L "$f" ]; then printf 'L%s\0' "$f" >&3; else printf 'F%s\0' "$f" >&3; printf '%s\0' "$f" >&4; fi
  done 3> "$t/all" 4> "$t/files"
  xargs -0 -r sha256sum -- < "$t/files" > "$t/sums"
  while IFS= read -r -d '' f; do
    if [ "${f:0:1}" = L ]; then h=$(printf 'link:%s' "$(readlink -- "${f:1}")" | sha256sum); else IFS= read -r h <&5; h=${h#\\}; fi
    printf '%s\t%s\n' "${h%% *}" "${f:1}"
  done < "$t/all" 5< "$t/sums"
  rm -rf "$t"
}
case $cmd in
  inventory) list | hashes ;;
  commit)
    inv=$3
    save=${4:-}
    t=$(mktemp -d)
    list | hashes > "$t/now"
    awk -F'\t' 'NR==FNR { a[$2] = $1; next } !($2 in a) || a[$2] != $1 { print $2 }' "$inv" "$t/now" > "$t/changed"
    awk -F'\t' 'NR==FNR { a[$2] = 1; next } !($2 in a) { print $2 }' "$t/now" "$inv" > "$t/deleted"
    g check-ignore --stdin < "$t/changed" > "$t/forced" || true
    tr '\n' '\0' < "$t/changed" | xargs -0 -r git -c safe.directory='*' --literal-pathspecs add --force --
    tr '\n' '\0' < "$t/deleted" | xargs -0 -r git -c safe.directory='*' --literal-pathspecs rm --cached -q --ignore-unmatch --
    GIT_COMMITTER_DATE="2000-01-01T00:00:01Z" g -c user.name=session -c user.email=session@localhost -c commit.gpgsign=false -c gc.auto=0 \
      commit -q --no-verify --allow-empty --date "2000-01-01T00:00:01Z" -m "session end"
    head=$(g rev-parse HEAD)
    if [ -n "$save" ]; then
      mkdir -p "$save"
      printf '%s\n' "$head" > "$save/s.head"
      cp "$t/now" "$save/s.inv"
    fi
    while IFS= read -r f; do printf 'PF_FORCED %s\n' "$f"; done < "$t/forced"
    printf 'PF_CAPTURE changed=%s deleted=%s forced=%s head=%s\n' "$(wc -l < "$t/changed" | tr -d ' ')" "$(wc -l < "$t/deleted" | tr -d ' ')" "$(wc -l < "$t/forced" | tr -d ' ')" "$head"
    rm -rf "$t"
    ;;
  *) echo "usage: capture.sh inventory <repo> | commit <repo> <inventory> [<dir>]" >&2; exit 2 ;;
esac

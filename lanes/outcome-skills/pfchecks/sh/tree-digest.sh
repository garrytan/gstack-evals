#!/usr/bin/env bash
# Copyright (c) 2026 Garry Tan. MIT License.
# The content digest of a session's tree volume (containment.ts treeDigest), the key the containment gate reuses a passing
# record on. $1 is the tree's root. It hashes every entry under it, .git included, in path order: each entry's type,
# permission bits and name (stat), each regular file's sha256 and each symlink's target. Modification times, owners,
# inode numbers and directory sizes are left out, so a byte-identical copy of the tree has the same digest. Names keep
# their ./ prefix, so a file named - is read as a file. Prints PF_TREE_DIGEST <sha256> entries=<n>.
set -euo pipefail
cd "$1"
t=$(mktemp -d)
find . -print0 | LC_ALL=C sort -z > "$t/all"
xargs -0 -r stat -c '%F %a %n' -- < "$t/all" > "$t/stat"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum -- > "$t/sums"
find . -type l -print0 | LC_ALL=C sort -z | while IFS= read -r -d '' p; do printf '%s -> %s\0' "$p" "$(readlink -- "$p")"; done > "$t/links"
printf 'PF_TREE_DIGEST %s entries=%s\n' "$(cat "$t/stat" "$t/sums" "$t/links" | sha256sum | cut -d' ' -f1)" "$(tr -cd '\0' < "$t/all" | wc -c | tr -d ' ')"
rm -rf "$t"

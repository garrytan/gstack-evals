exec 3>&2
hit=0
found() { printf "found %s\n" "$1"; hit=1; }
there() { [ -e "$1" ] || [ -L "$1" ]; }
home=$1
shift
for p in "$home/.capy" "$home/.local/share/gstack" "$home/.claude/skills" "${CLEAN_ROOM_ROOT:-}"/home/*/.capy/drive "${CLEAN_ROOM_ROOT:-}/root/.capy/drive"; do there "$p" && found "$p"; done
bad=0
fail() { printf "clean-room: %s\n" "$1" >&2; bad=1; }
named() { grep -qi gstack "$1" 2>/dev/null; s=$?; if [ "$s" = 0 ]; then found "$1"; elif [ "$s" != 1 ] && [ -e "$1" ]; then fail "grep could not read $1 (exit $s)"; fi; }
for t in find grep; do command -v "$t" >/dev/null 2>&1 || fail "$t is not on PATH, so the scan cannot run"; done
[ "$bad" = 0 ] || exit 4
for p in "$home/.claude/CLAUDE.md" "$home/AGENTS.md"; do [ -f "$p" ] && named "$p"; done
for u in "$@"; do
  there "$u/.claude/skills" && found "$u/.claude/skills"
  out=$(find "$u" -name .git -prune -o \( -name AGENTS.md -o -name CLAUDE.md \) \( -type f -o -type l \) -exec sh -c 'b=0; for f; do grep -qi gstack "$f" 2>/dev/null; s=$?; if [ "$s" = 0 ]; then printf "found %s\n" "$f"; elif [ "$s" != 1 ] && [ -e "$f" ]; then printf "clean-room: grep could not read %s (exit %s)\n" "$f" "$s" >&3; b=1; fi; done; exit $b' clean-room {} + 2>/dev/null) || fail "find could not finish under $u"
  [ -z "$out" ] || { printf "%s\n" "$out"; hit=1; }
done
[ "$bad" = 0 ] || exit 4
[ "$hit" = 0 ] || exit 3

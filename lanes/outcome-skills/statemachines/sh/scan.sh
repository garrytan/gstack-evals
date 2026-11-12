# The leak scan: every needle as a whole line, fixed strings, binary included, over every entry of the root $3 but proc,
# sys and the scan's own input dir. Prints path NUL line per hit; the exit code goes to stderr.
set -u
root="${3%/}"
dirs=()
for d in "$root"/* "$root"/.[!.]*; do
  case "${d#"$root"}" in /proc|/sys|/sm-in) ;; *) if [ -e "$d" ] || [ -L "$d" ]; then dirs+=("$d"); fi;; esac
done
[ ${#dirs[@]} -gt 0 ] || { echo "SCANEXIT 1" >&2; exit 0; }
grep -r -a -s -D skip -Z -H -F -x -f "$2/needles" -- "${dirs[@]}"
echo "SCANEXIT $?" >&2

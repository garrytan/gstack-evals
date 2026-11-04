// The clean room for the none arm (G prereg section 4), reused from panel v3's C1 (closed PR #166 as GEVA-234 left it on
// geva-234-c1-fixes): the arm runs where it can see no Capy drive, no gstack install and no skills folder. clean-room.sh is
// C1's CLEAN_ROOM_SCRIPT byte for byte: one POSIX sh script whose arguments are the home directory, then each work
// directory; it prints "found <path>" per hit and exits 3 on any hit, 0 when clean, and 4 with a reason on stderr when the
// scan cannot finish. CLEAN_ROOM_ROOT, when set, goes before the /home and /root paths, so a keyless test can run it on a
// machine that has a drive. CLEAN_ROOM_O1_SCRIPT is O1's second scan, with the same arguments, output and exits, for the
// gstack traces C1's script does not look at. cleanRoomPreflight runs both in one call in the arm's image with the
// session's own mounts, before any lease.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CLEAN_ROOM_SH = join(import.meta.dir, "clean-room.sh");
export const CLEAN_ROOM_SCRIPT = readFileSync(CLEAN_ROOM_SH, "utf8").replace(/\n$/, "");

// A gstack trace, for O1's scan: $home/.gstack existing; a .claude/skills folder anywhere below a work dir, outside .git,
// existing; and "gstack" in any case in the name or content of a CLAUDE.md in a parent of a work dir (up to /, or up to
// CLEAN_ROOM_ROOT when it is set), of $home/CLAUDE.md, of .claude/settings.json and .claude/settings.local.json in the
// home or a work dir (where hooks live; any mention counts, since sh cannot parse JSON) and of any entry under
// .claude/commands, .claude/plugins or .claude/agents in the home or a work dir. Present at all, whatever they hold
// (GSTA-2): CLAUDE.local.md and .mcp.json in the home or a work dir, a CLAUDE.local.md in a parent of a work dir,
// ~/.claude.json, ~/.claude/.claude.json (the global config file when CLAUDE_CONFIG_DIR is ~/.claude, as the arm sets it),
// and each entry under /etc/claude-code (Claude Code's managed settings), or /etc/claude-code itself when it
// is not a plain folder. Every path is built from the home and work dir arguments, or from CLEAN_ROOM_ROOT for
// /etc/claude-code, and a work dir must be absolute.
export const CLEAN_ROOM_O1_SCRIPT = String.raw`exec 3>&2
hit=0
bad=0
found() { printf "found %s\n" "$1"; hit=1; }
fail() { printf "clean-room-o1: %s\n" "$1" >&2; bad=1; }
there() { [ -e "$1" ] || [ -L "$1" ]; }
named() { grep -qi gstack "$1" 2>/dev/null; s=$?; if [ "$s" = 0 ]; then found "$1"; elif [ "$s" != 1 ] && [ -e "$1" ]; then fail "grep could not read $1 (exit $s)"; fi; }
each() { while IFS= read -r p; do [ -z "$p" ] || found "$p"; done; }
tree() {
  there "$1" || return 0
  out=$(find "$1" -iname '*gstack*') || fail "find could not finish under $1"
  [ -z "$out" ] || { printf "%s\n" "$out" | each; hit=1; }
  out=$(find "$1" \( -type f -o -type l \) -exec sh -c 'b=0; for f; do grep -qi gstack "$f" 2>/dev/null; s=$?; if [ "$s" = 0 ]; then printf "found %s\n" "$f"; elif [ "$s" != 1 ] && [ -e "$f" ]; then printf "clean-room-o1: grep could not read %s (exit %s)\n" "$f" "$s" >&3; b=1; fi; done; exit $b' clean-room-o1 {} + 2>/dev/null) || fail "find could not finish under $1"
  [ -z "$out" ] || { printf "%s\n" "$out"; hit=1; }
}
home=$1
shift
for t in find grep dirname; do command -v "$t" >/dev/null 2>&1 || fail "$t is not on PATH, so the scan cannot run"; done
[ "$bad" = 0 ] || exit 4
top=$CLEAN_ROOM_ROOT
[ -n "$top" ] || top=/
there "$home/.gstack" && found "$home/.gstack"
for p in "$home/CLAUDE.local.md" "$home/.mcp.json" "$home/.claude.json" "$home/.claude/.claude.json"; do there "$p" && found "$p"; done
cc=$CLEAN_ROOM_ROOT/etc/claude-code
if [ -d "$cc" ] && [ ! -L "$cc" ]; then
  out=$(find "$cc" -mindepth 1) || fail "find could not finish under $cc"
  [ -z "$out" ] || { printf "%s\n" "$out" | each; hit=1; }
elif there "$cc"; then found "$cc"; fi
for p in "$home/CLAUDE.md" "$home/.claude/settings.json" "$home/.claude/settings.local.json"; do [ -f "$p" ] && named "$p"; done
tree "$home/.claude/commands"
tree "$home/.claude/plugins"
tree "$home/.claude/agents"
for u in "$@"; do
  case "$u" in /*) ;; *) fail "the work dir $u is not an absolute path"; continue ;; esac
  d=$u
  while [ "$d" != "$top" ] && [ "$d" != / ]; do d=$(dirname "$d"); [ -f "$d/CLAUDE.md" ] && named "$d/CLAUDE.md"; there "$d/CLAUDE.local.md" && found "$d/CLAUDE.local.md"; done
  for p in "$u/CLAUDE.local.md" "$u/.mcp.json"; do there "$p" && found "$p"; done
  out=$(find "$u" -name .git -prune -o -path '*/.claude/skills' -print) || fail "find could not finish under $u"
  [ -z "$out" ] || { printf "%s\n" "$out" | each; hit=1; }
  for p in "$u/.claude/settings.json" "$u/.claude/settings.local.json"; do [ -f "$p" ] && named "$p"; done
  tree "$u/.claude/commands"
  tree "$u/.claude/plugins"
  tree "$u/.claude/agents"
done
[ "$bad" = 0 ] || exit 4
[ "$hit" = 0 ] || exit 3`;

const BOTH_SCANS = 'c1=$1; o1=$2; shift 2; sh -c "$c1" clean-room "$@"; a=$?; sh -c "$o1" clean-room-o1 "$@"; b=$?; case "$a$b" in 00) exit 0 ;; 03|30|33) exit 3 ;; esac; exit 4';

/** docker run in the arm's image with sh as the entrypoint: no pull, no network, every capability dropped but DAC_READ_SEARCH (so root sees other users' 0700 homes as the session's root would), a random name, and docker rm -f on a timeout. */
export function dockerRun(o: { docker: string; image: string; user?: string; mounts: readonly string[]; env?: Record<string, string>; timeoutMs?: number }, args: readonly string[]) {
  const name = "gstack-evals-" + randomBytes(8).toString("hex");
  const r = spawnSync(o.docker, ["run", "--rm", "--name", name, "--pull", "never", "--network", "none", ...(o.user ? ["--user", o.user] : []), "--cap-drop", "ALL", "--cap-add", "DAC_READ_SEARCH", "--security-opt", "no-new-privileges", ...o.mounts.flatMap((m) => ["-v", m]), ...Object.entries(o.env ?? {}).flatMap(([k, v]) => ["--env", k + "=" + v]), "--entrypoint", "sh", o.image, "-c", ...args], { encoding: "utf8", timeout: o.timeoutMs ?? 120_000 });
  if (r.signal || (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") spawnSync(o.docker, ["rm", "-f", name], { timeout: 30_000 });
  return r;
}

/** Runs C1's script and O1's scan in the none arm's image, as the session's user, with the session's mounts (docker -v specs) and no network; the image must be present, since it never pulls. The image must resolve to digest, its image id (docker image inspect's .Id), and the scans run on that id, so a tag moved after the check cannot change what they read. Throws E_OUTCOME_CLEAN_ROOM on another or unreadable id, on a hit, or when either scan cannot finish. */
export function cleanRoomPreflight(o: { docker: string; image: string; user?: string; home: string; workdirs: readonly string[]; mounts: readonly string[]; digest: string; timeoutMs?: number }): void {
  const at = "E_OUTCOME_CLEAN_ROOM outcome-skills none arm: image " + o.image + " (image digest " + o.digest + "): ";
  const id = spawnSync(o.docker, ["image", "inspect", "--format", "{{.Id}}", o.image], { encoding: "utf8", timeout: 30_000 });
  const got = id.status === 0 ? (id.stdout ?? "").trim() : null;
  if (got !== o.digest) throw new Error(at + (got === null ? "docker image inspect could not read the image's id (" + (id.error ? id.error.message : "exit " + (id.status ?? id.signal)) + ")" + (id.stderr?.trim() ? ": " + id.stderr.trim().slice(-300) : "") : "the image's id is " + (got || "empty") + ", not the pinned digest") + "\n  fix: point the none arm at the image the prereg pins, or record that image's id as its digest, then rerun the same command; nothing was spent and no lease is open");
  const r = dockerRun({ ...o, image: o.digest }, [BOTH_SCANS, "clean-room-both", CLEAN_ROOM_SCRIPT, CLEAN_ROOM_O1_SCRIPT, o.home, ...o.workdirs]);
  if (r.status === 0) return;
  const found = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("found ")).map((l) => l.slice(6));
  if (r.status === 3 && found.length) throw new Error(at + "found " + found.join(", ") + "\n  fix: remove those paths or mounts from the none arm's session, then rerun the same command; nothing was spent and no lease is open");
  throw new Error(at + "the clean-room check did not finish (" + (r.error ? r.error.message : "exit " + (r.status ?? r.signal)) + ")" + (r.stderr?.trim() ? ": " + r.stderr.trim().slice(-500) : "") + "\n  fix: make the image present and able to run sh with docker run --network none, then rerun the same command; nothing was spent and no lease is open");
}

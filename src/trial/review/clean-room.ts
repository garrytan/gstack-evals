// The clean room for no-gstack plan arms (panel v3 plan, sections 4 and 5; FOUN-32's rule from GGST-6, 2026-11-02). A
// none or lens arm runs where it can see no Capy drive and no gstack. CLEAN_ROOM_SCRIPT is one POSIX sh script that checks
// this. Its arguments are the home directory, then each unit directory. It prints "found <path>" per hit and exits 3 on
// any hit, 0 when clean. A path that exists counts, a dangling symlink included. CLEAN_ROOM_CHECKS lists the checks for
// the authoring kit's check_units.py, which carries the same list.
//
// review-units runs the script twice. cleanRoomPreflight runs it in each none and lens arm image, per model too, before
// the lease opens (dockerRig's preflight hook), with each unit tree mounted read-only at /work/<task>; a hit, or a check
// that cannot run, refuses the run with E_CLEAN_ROOM before any spend. CLEAN_ROOM_COMMAND runs it in each none and lens
// session before the CLI starts (the driver's preflight), on the session's HOME and working directory; a hit there is a
// coverage gap (E_CLEAN_ROOM) that stops the arm. CLEAN_ROOM_ROOT, when set, goes before the /home and /root paths, so a
// keyless test can run the script on a machine that has a drive.
import { spawnSync } from "node:child_process";

export const CLEAN_ROOM_CHECKS = [
  "<home>/.capy",
  "<home>/.local/share/gstack",
  "<home>/.claude/skills",
  "/home/*/.capy/drive",
  "/root/.capy/drive",
  "<home>/.claude/CLAUDE.md naming gstack",
  "<home>/AGENTS.md naming gstack",
  "<unit>/.claude/skills",
  "any AGENTS.md or CLAUDE.md under <unit>, outside .git, naming gstack",
] as const;

export const CLEAN_ROOM_SCRIPT = [
  "hit=0",
  'found() { printf "found %s\\n" "$1"; hit=1; }',
  'there() { [ -e "$1" ] || [ -L "$1" ]; }',
  "home=$1",
  "shift",
  'for p in "$home/.capy" "$home/.local/share/gstack" "$home/.claude/skills" "${CLEAN_ROOM_ROOT:-}"/home/*/.capy/drive "${CLEAN_ROOM_ROOT:-}/root/.capy/drive"; do there "$p" && found "$p"; done',
  'for p in "$home/.claude/CLAUDE.md" "$home/AGENTS.md"; do [ -f "$p" ] && grep -qi gstack "$p" 2>/dev/null && found "$p"; done',
  'for u in "$@"; do',
  '  there "$u/.claude/skills" && found "$u/.claude/skills"',
  '  named=$(find "$u" -name .git -prune -o \\( -name AGENTS.md -o -name CLAUDE.md \\) -type f -exec grep -li gstack {} + 2>/dev/null)',
  '  [ -n "$named" ] && printf "%s\\n" "$named" | sed "s/^/found /" && hit=1',
  "done",
  '[ "$hit" = 0 ] || exit 3',
].join("\n");

/** The driver's preflight command: the script on the session's HOME and working directory. */
export const CLEAN_ROOM_COMMAND = "sh -c '" + CLEAN_ROOM_SCRIPT.replaceAll("'", "'\\''") + "' clean-room \"$HOME\" \"$PWD\"";

/** Runs the script in each image of the named arms (keys arm and arm@model), with every unit tree read-only. Throws E_CLEAN_ROOM on a hit or when a check cannot run. */
export function cleanRoomPreflight(o: { docker: string; images: ReadonlyMap<string, string>; arms: readonly string[]; units: readonly { task: string; tree: string }[]; home: string; digest: string }): void {
  const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
  const mounts = o.units.flatMap((u) => ["-v", u.tree + ":/work/" + u.task + ":ro"]);
  for (const [key, tag] of o.images) {
    const arm = key.split("@")[0]!;
    if (!o.arms.includes(arm)) continue;
    const r = spawnSync(o.docker, ["run", "--rm", "--network", "none", "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...mounts, "--entrypoint", "sh", tag, "-c", CLEAN_ROOM_SCRIPT, "clean-room", o.home, ...o.units.map((u) => "/work/" + u.task)], { encoding: "utf8", timeout: 120_000 });
    if (r.status === 0) continue;
    const at = "E_CLEAN_ROOM review-units: arm " + arm + " image " + tag + " (trial image digest " + o.digest + "): ";
    const found = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("found ")).map((l) => l.slice(6));
    if (r.status === 3 && found.length) throw new Error(at + "found " + found.join(", ") + "\n  fix: remove those paths from the arm image or the unit tree, then rerun the same command; nothing was spent and the item is still unopened");
    throw new Error(at + "the clean-room check did not finish (" + (r.error ? r.error.message : "exit " + (r.status ?? r.signal)) + ")" + (r.stderr?.trim() ? ": " + r.stderr.trim().slice(-500) : "") + "\n  fix: make the image run sh with docker run --network none, then rerun the same command; nothing was spent and the item is still unopened");
  }
}

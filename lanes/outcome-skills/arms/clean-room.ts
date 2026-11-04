// The clean room for the none arm (G prereg section 4), reused from panel v3's C1 (closed PR #166 as GEVA-234 left it on
// geva-234-c1-fixes): the arm runs where it can see no Capy drive, no gstack install and no skills folder. clean-room.sh is
// C1's CLEAN_ROOM_SCRIPT byte for byte: one POSIX sh script whose arguments are the home directory, then each work
// directory; it prints "found <path>" per hit and exits 3 on any hit, 0 when clean, and 4 with a reason on stderr when the
// scan cannot finish. CLEAN_ROOM_ROOT, when set, goes before the /home and /root paths, so a keyless test can run it on a
// machine that has a drive. cleanRoomPreflight runs it in the arm's image with the session's own mounts, before any lease.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CLEAN_ROOM_SH = join(import.meta.dir, "clean-room.sh");
export const CLEAN_ROOM_SCRIPT = readFileSync(CLEAN_ROOM_SH, "utf8").replace(/\n$/, "");

/** Runs the script in the none arm's image, as the session's user, with the session's mounts (docker -v specs) and no network; the image must be present, since it never pulls. Throws E_OUTCOME_CLEAN_ROOM on a hit or when the scan cannot finish. */
export function cleanRoomPreflight(o: { docker: string; image: string; user?: string; home: string; workdirs: readonly string[]; mounts: readonly string[]; digest: string }): void {
  const r = spawnSync(o.docker, ["run", "--rm", "--pull", "never", "--network", "none", ...(o.user ? ["--user", o.user] : []), "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...o.mounts.flatMap((m) => ["-v", m]), "--entrypoint", "sh", o.image, "-c", CLEAN_ROOM_SCRIPT, "clean-room", o.home, ...o.workdirs], { encoding: "utf8", timeout: 120_000 });
  if (r.status === 0) return;
  const at = "E_OUTCOME_CLEAN_ROOM outcome-skills none arm: image " + o.image + " (image digest " + o.digest + "): ";
  const found = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("found ")).map((l) => l.slice(6));
  if (r.status === 3 && found.length) throw new Error(at + "found " + found.join(", ") + "\n  fix: remove those paths or mounts from the none arm's session, then rerun the same command; nothing was spent and no lease is open");
  throw new Error(at + "the clean-room check did not finish (" + (r.error ? r.error.message : "exit " + (r.status ?? r.signal)) + ")" + (r.stderr?.trim() ? ": " + r.stderr.trim().slice(-500) : "") + "\n  fix: make the image present and able to run sh with docker run --network none, then rerun the same command; nothing was spent and no lease is open");
}

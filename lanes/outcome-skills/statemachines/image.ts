// Copyright (c) 2026 Garry Tan. MIT License.
// The per-session image (the implicit state machines prereg, sections 4, 5 and 8). It starts FROM the unit's runtime image
// id, removes the image's repo_dir, copies the unit's prepared tree volume (stripped, one commit) in its place, and for A3
// copies the /qa install's home into /root after the tree. A follow-on commits the first stage's change on top as the
// second commit (sh/followon.sh). The container is committed with the runtime image's own entrypoint, command, work dir
// and user, and the image is pinned by id. The session sees only the top layer's tree, so the image's original repository
// and history never reach it. Untracked files the prep runs left in the volume (test output) are cleaned; ignored files stay.
// A volume the runtime image declares inside repo_dir is mounted in the build container: the rm and git clean skip its
// mount point, it must be empty after the copy (else what sits there would start every session's volume, so the build
// fails closed), and the build container goes with its anonymous volumes. sessionManifest writes the one-row manifest
// real_agent's image check reads.
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { docker } from "../../real-outcome/task/docker.ts";
import { runName } from "./testrun.ts";
import { smFail, type SmUnit } from "./unit.ts";

const SH = join(import.meta.dir, "sh");
export const SESSION_REPO = "gstack-evals-sm-session";

const BUILD = `set -euo pipefail
repo="$1"
mnts=(); ex=()
while read -r _ _ _ _ m _; do case "$m" in "$repo"/*) mnts+=("$m"); ex+=(-e "/\${m#"$repo"/}/");; esac; done < /proc/self/mountinfo
sm_clear() {
  local e m keep
  for e in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$e" ] || [ -L "$e" ] || continue
    keep=
    for m in "\${mnts[@]}"; do case "$m" in "$e") keep=mount;; "$e"/*) keep=\${keep:-above};; esac; done
    case "$keep" in mount) ;; above) sm_clear "$e";; *) rm -rf -- "$e";; esac
  done
}
if [ \${#mnts[@]} -eq 0 ]; then rm -rf "$repo"; else sm_clear "$repo"; fi
mkdir -p "$repo"
cp -a /sm-src/. "$repo"/
git -C "$repo" clean -fdq \${ex[@]+"\${ex[@]}"}
for m in \${mnts[@]+"\${mnts[@]}"}; do if [ -n "$(ls -A "$m")" ]; then echo "SM_MOUNT_NOT_EMPTY \${m#"$repo"/}" >&2; exit 3; fi; done
if [ -d /sm-in/home ]; then cp -a /sm-in/home/. /root/; fi
if [ -f /sm-in/second ]; then bash /sm-in/followon.sh "$repo" /sm-in >&2; fi
cd "$repo"
echo "COMMITS $(git rev-list --all --count)"
echo "HEAD $(git rev-parse HEAD)"
`;

export interface SessionImage { image_id: string; tag: string; runtime_id: string; volume: string; commits: number; head: string; home: "none" | "qa"; tree_patch_sha256: string | null; qa_home: QaHome | null }

/** The session's home, where the image build puts A3's /qa install, and the home paths real_agent's family SM check lists
 *  (real_agent.py SM_CHECK), relative to it. */
export const SESSION_HOME = "/root";
export const HOME_CHECKED = [".claude/skills", ".claude/CLAUDE.md", ".local/share/gstack", ".capy", ".gstack"] as const;

/** paths: the checked home paths the install wrote, as the session sees them. links and files: how many symlinks and
 *  text files named the install's host dir and now name the session home. binaries: files with a NUL byte that name the
 *  host dir, left as built. */
export interface QaHome { paths: string[]; links: number; files: number; binaries: string[] }

/** Copies A3's /qa home (the host dir qa-install.sh filled) to dst, for the session's /root. gstack's setup writes its
 *  own host dir into symlink targets and text files (the rendered skills, the settings hook, its markers), and in the
 *  session that dir does not exist, so every link into the home becomes relative and the host dir in a text file becomes
 *  /root. A link that leaves the home fails closed. A top-level .capy is left out: a host's tools can write there while
 *  the install runs (Capy's git shim logs to ~/.capy), and the session's check refuses a drive path in every arm. */
export function qaHomeCopy(src: string, dst: string): QaHome {
  const given = resolve(src);
  const home = realpathSync(given);
  const roots = [...new Set([given, home])].sort((a, b) => b.length - a.length);
  const lexists = (f: string) => { try { lstatSync(f); return true; } catch { return false; } };
  const drive = join(home, ".capy");
  cpSync(home, dst, { recursive: true, verbatimSymlinks: true, filter: (f) => f !== drive });
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp("(?:" + roots.map(esc).join("|") + ")(?![\\w.-])", "g");
  const inside = (t: string) => roots.map((r) => (t === r ? "/" : t.startsWith(r + "/") ? t.slice(r.length) : null)).find((x) => x !== null) ?? null;
  const out: QaHome = { paths: [], links: 0, files: 0, binaries: [] };
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      const at = "/" + relative(dst, f);
      if (e.isSymbolicLink()) {
        const t = readlinkSync(f);
        const to = isAbsolute(t) ? inside(t) : posix.join("/h", posix.dirname(at), t).startsWith("/h/") ? "" : null;
        if (to === null) return smFail("E_SM_ARM", "A3's home links " + at + " to " + t + ", outside the home");
        if (!to) continue;
        rmSync(f);
        symlinkSync(posix.relative(posix.dirname(at), to) || ".", f);
        out.links++;
      } else if (e.isDirectory()) walk(f);
      else if (e.isFile()) {
        const b = readFileSync(f);
        const text = b.toString("latin1");
        if (!new RegExp(named.source).test(text)) continue;
        if (b.includes(0)) {
          out.binaries.push(at);
          continue;
        }
        writeFileSync(f, Buffer.from(text.replace(named, SESSION_HOME), "latin1"));
        out.files++;
      }
    }
  };
  walk(dst);
  out.paths = HOME_CHECKED.filter((p) => lexists(join(dst, p))).map((p) => SESSION_HOME + "/" + p);
  out.binaries.sort();
  return out;
}

/** Builds one session's image. treePatch (follow-on only) is the first stage's full-tree patch, "" for S0. qaHome (A3 only) is the host dir qa-install.sh filled. */
export function buildSessionImage(u: SmUnit, o: { volume: string; stage: "first" | "followon"; treePatch?: string; qaHome?: string }): SessionImage {
  const runtime = u.image.runtime_id;
  if (!runtime || !/^sha256:[0-9a-f]{64}$/.test(runtime)) return smFail("E_SM_INFRA_GAP", "unit " + u.id + " has no runtime image id; run its oracle first");
  if ((o.stage === "followon") !== (o.treePatch !== undefined)) return smFail("E_SM_ARM", "a follow-on image takes the first stage's tree patch, and only a follow-on does");
  if (o.qaHome !== undefined && (o.stage !== "first" || !existsSync(join(o.qaHome, ".claude/skills/gstack")))) return smFail("E_SM_ARM", "A3's home is a first-stage home holding .claude/skills/gstack, not " + o.qaHome);
  const ins = docker(["image", "inspect", "--format", "{{json .Config}}", runtime], { timeoutMs: 30_000 });
  if (ins.status !== 0) return smFail("E_SM_INFRA_GAP", "runtime image " + runtime + " is not on this host: " + ins.stderr.trim().slice(-200));
  const cfg = JSON.parse(ins.stdout) as { Entrypoint: string[] | null; Cmd: string[] | null; WorkingDir: string; User: string };
  const inDir = mkdtempSync(join(tmpdir(), "sm-image-"));
  const name = runName("session-image-" + u.id);
  try {
    if (o.treePatch !== undefined) {
      writeFileSync(join(inDir, "tree.patch"), o.treePatch);
      writeFileSync(join(inDir, "followon.sh"), readFileSync(join(SH, "followon.sh")));
      writeFileSync(join(inDir, "second"), "");
    }
    const qa = o.qaHome ? qaHomeCopy(o.qaHome, join(inDir, "home")) : null;
    const r = docker(["run", "--name", name, "--network", "none", "--user", "0:0", "-v", o.volume + ":/sm-src:ro", "-v", inDir + ":/sm-in:ro", "--entrypoint", "", runtime, "bash", "-c", BUILD, "bash", u.repo_dir], { timeoutMs: 1_800_000 });
    const got = Object.fromEntries(r.stdout.split("\n").filter((l) => /^(COMMITS|HEAD) /.test(l)).map((l) => l.split(" ") as [string, string]));
    const commits = o.stage === "first" ? 1 : 2;
    if (r.status !== 0 || Number(got.COMMITS) !== commits || !/^[0-9a-f]{40}$/.test(got.HEAD ?? "")) return smFail("E_SM_HISTORY", "the session tree for " + u.id + " has " + (got.COMMITS ?? "no") + " commits, not " + commits + " (exit " + r.status + ": " + r.stderr.trim().slice(-300) + ")");
    const key = createHash("sha256").update([runtime, o.volume, o.stage, o.treePatch ?? "", o.qaHome ? "qa" : "none", got.HEAD].join("\0")).digest("hex").slice(0, 24);
    const tag = SESSION_REPO + ":" + key;
    const changes = [...(cfg.Entrypoint?.length ? ["ENTRYPOINT " + JSON.stringify(cfg.Entrypoint)] : []), "CMD " + JSON.stringify(cfg.Cmd?.length ? cfg.Cmd : ["/bin/bash"]), "WORKDIR " + (cfg.WorkingDir || "/"), "USER " + (cfg.User || "0")].flatMap((c) => ["--change", c]);
    const c = docker(["commit", ...changes, name, tag], { timeoutMs: 1_800_000 });
    if (c.status !== 0) return smFail("E_SM_INFRA_GAP", "docker commit for " + u.id + " failed: " + c.stderr.trim().slice(-300));
    const id = docker(["image", "inspect", "--format", "{{.Id}}", tag], { timeoutMs: 30_000 }).stdout.trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(id)) return smFail("E_SM_INFRA_GAP", "the session image " + tag + " has no id");
    const entry = docker(["image", "inspect", "--format", "{{json .Config.Entrypoint}}", tag], { timeoutMs: 30_000 }).stdout.trim();
    if (JSON.stringify(cfg.Entrypoint?.length ? cfg.Entrypoint : null) !== entry) return smFail("E_SM_INFRA_GAP", "the session image " + tag + " has entrypoint " + entry + ", not the runtime image's");
    return { image_id: id, tag, runtime_id: runtime, volume: o.volume, commits, head: got.HEAD!, home: o.qaHome ? "qa" : "none", tree_patch_sha256: o.treePatch === undefined ? null : createHash("sha256").update(o.treePatch).digest("hex"), qa_home: qa };
  } finally {
    docker(["rm", "-f", "-v", name], { timeoutMs: 60_000 });
    rmSync(inDir, { recursive: true, force: true });
  }
}

/** The one-row image manifest real_agent's U4 check reads (label = the session's task label), and its sha256. */
export function sessionManifest(file: string, label: string, img: SessionImage): string {
  const raw = JSON.stringify({ schema: "tg-images.v1", rows: [{ label, image_id: img.image_id, tag: img.tag, runtime_id: img.runtime_id, commits: img.commits, head: img.head, home: img.home, tree_patch_sha256: img.tree_patch_sha256 }] }, null, 1) + "\n";
  writeFileSync(file, raw, { flag: "wx" });
  return createHash("sha256").update(raw).digest("hex");
}

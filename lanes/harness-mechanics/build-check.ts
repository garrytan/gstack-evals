// Copyright (c) 2026 Garry Tan. MIT License.
// hm build-check --out <dir> [--list calibration|scored] [--shard k/n]: ruling A's check before any lease at a new pin,
// with no model call, and D7's gate before any later stage runs. Each task in the screened list it names (HM_SCREENED at
// HM_SCREENED_SHA256; calibration when --list is absent), in its order, or every n-th from the k-th with --shard, gets its
// trial image built the way Harbor builds it, from the environment directory prepare-run writes (screen.ts
// trialEnvironment). The image must build, its WORKDIR must be /testbed, and there, with no -w, pwd must print /testbed
// and git rev-parse origin/main HEAD the same commit twice. Then D7's object-level read (D7_CHECK) runs in a throwaway
// container of the built image, with no network: every ref of the tree and of D1's origin, FETCH_HEAD, ORIG_HEAD and the
// other pseudo refs among them, points at the base or an ancestor; every commit object is the base or an ancestor; no
// object is unreachable; no alternates file; no git directory anywhere besides the tree's and the origin's; and no file
// outside the base commit's tracked files holds one of the task's hidden test names as a whole word (a name inside a
// longer identifier, as installed packages' own tests hold, is not a hit). The names (d7Names) come from the
// task's tests and the pristine listing and reach the container through a read-only mount, never an image layer. Rows
// append to <dir>/build-check.jsonl as they land, a failed build's row keeps its error line, and each task's images are
// removed after its row. Prints one line per task and exits 0 only when every task passes. Needs Docker and SWEREBENCH.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DockerRunner } from "../decision-routing/labels/container.ts";
import { pristineListing, runnerOnlyMarkers, type Pristine } from "../decision-routing/labels/markers.ts";
import { bundleLists, SCREEN, screenedFromEnv } from "./pins.ts";
import { imageRef, pool, rebenchRoot, trialEnvironment } from "./screen.ts";

export type D7Read = { base: string | null; names: number; refs: string[]; pseudo: string[]; commits: Record<string, number>; unreachable: Record<string, number>; alternates: string[]; origin: boolean; git_dirs: string[]; hits: string[]; done: boolean };
export type BuildRow = { task: string; pass: boolean; error?: string; workdir?: string; pwd?: string; main?: string; head?: string; d7?: D7Read };

/** D7's read, as sh, for a throwaway container of the built image. ROOT, REPO, ORIGIN, SELF (the read-only mount holding
 * this script) and NAMES default to the container's paths; keyless tests point them at a fixture. It prints
 * "D7 <key> <value>" lines and "D7 done" last, which readD7 parses. */
export const D7_CHECK = `export GIT_NO_REPLACE_OBJECTS=1 LC_ALL=C
R=\${ROOT:-/}; R=\${R%/}; T=\${REPO:-/testbed}; O=\${ORIGIN:-/opt/hm-origin.git}; S=\${SELF:-/hm-d7}; N=\${NAMES:-$S/names}
G=$(git -C "$T" rev-parse --absolute-git-dir 2>/dev/null) && B=$(git -C "$T" rev-parse -q --verify 'HEAD^{commit}') || { echo "D7 nobase"; echo "D7 done"; exit 0; }
echo "D7 base $B"
W=$(mktemp -d)
git --git-dir="$G" rev-list "$B" | sort > "$W/a"
side() {
  for r in $(git --git-dir="$2" for-each-ref --format='%(refname)'); do
    case "$r" in refs/replace/*) echo "D7 ref $1 $r"; continue ;; esac
    c=$(git --git-dir="$2" rev-parse -q --verify "$r^{commit}") && grep -qx "$c" "$W/a" || echo "D7 ref $1 $r"
  done
  for f in FETCH_HEAD ORIG_HEAD MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_HEAD AUTO_MERGE; do
    [ -e "$2/$f" ] || continue
    for c in $(grep -o '[0-9a-f]\\{40\\}' "$2/$f"); do grep -qx "$c" "$W/a" || { echo "D7 pseudo $1 $f"; break; }; done
  done
  { [ -s "$2/objects/info/alternates" ] || [ -s "$2/objects/info/http-alternates" ]; } && echo "D7 alternates $1"
  echo "D7 commits $1 $(git --git-dir="$2" cat-file --batch-all-objects --batch-check='%(objecttype) %(objectname)' | sed -n 's/^commit //p' | sort | comm -23 - "$W/a" | wc -l)"
  echo "D7 unreachable $1 $(git --git-dir="$2" fsck --unreachable --no-reflogs --no-progress 2>/dev/null | grep -c '^unreachable ')"
}
side testbed "$G"
if [ -d "$O" ]; then side origin "$O"; else echo "D7 noorigin"; fi
rm -rf "$W"
find "$R/" -xdev -path "$S" -prune -o -type f -name HEAD -print 2>/dev/null | while read -r h; do
  d=\${h%/HEAD}
  [ -d "$d/objects" ] && [ -d "$d/refs" ] || continue
  [ "$d" = "$G" ] || [ "$d" = "$O" ] || echo "D7 gitdir $d"
done
if [ -s "$N" ]; then
  echo "D7 names $(grep -c . "$N")"
  for e in "$R"/* "$R"/.[!.]*; do
    [ -e "$e" ] || continue
    case "$e" in "$S"|"$R/proc"|"$R/sys"|"$R/dev") continue ;; esac
    grep -rlwF -D skip -f "$N" -- "$e" 2>/dev/null
  done | while read -r f; do
    case "$f" in "$G"/*|"$O"/*) continue ;; esac
    case "$f" in "$T"/*) git -C "$T" show "HEAD:\${f#"$T"/}" 2>/dev/null | grep -qwF -f "$N" && continue ;; esac
    echo "D7 hit $f"
  done
else
  echo "D7 names 0"
fi
echo "D7 done"
`;

export function readD7(out: string): D7Read {
  const d: D7Read = { base: null, names: 0, refs: [], pseudo: [], commits: {}, unreachable: {}, alternates: [], origin: true, git_dirs: [], hits: [], done: false };
  for (const line of out.split("\n")) {
    const m = /^D7 (\S+) ?(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!, value = m[2]!, [side, n] = value.split(" ");
    if (key === "base") d.base = value;
    else if (key === "names") d.names = Number(value);
    else if (key === "ref") d.refs.push(value);
    else if (key === "pseudo") d.pseudo.push(value);
    else if (key === "commits" || key === "unreachable") d[key][side!] = Number(n);
    else if (key === "alternates") d.alternates.push(value);
    else if (key === "noorigin") d.origin = false;
    else if (key === "gitdir") d.git_dirs.push(value);
    else if (key === "hit") d.hits.push(value);
    else if (key === "done") d.done = true;
  }
  return d;
}

export function d7Problems(d: D7Read): string[] {
  const p: string[] = [], s = (n: number) => (n === 1 ? "" : "s");
  if (!d.done) p.push("the read did not finish");
  if (!d.base) p.push("no base commit in the tree");
  else for (const side of d.origin ? ["testbed", "origin"] : ["testbed"]) if (!(side in d.commits) || !(side in d.unreachable)) p.push(side + "'s objects were not read");
  for (const r of d.refs) p.push(r.replace(" ", " ref ") + " points past the base");
  for (const x of d.pseudo) p.push(x + " names a commit past the base");
  for (const [side, n] of Object.entries(d.commits)) if (n) p.push(side + " holds " + n + " commit" + s(n) + " past the base");
  for (const [side, n] of Object.entries(d.unreachable)) if (n) p.push(side + " holds " + n + " unreachable object" + s(n));
  for (const side of d.alternates) p.push(side + " borrows objects through an alternates file");
  if (!d.origin) p.push("no D1 origin repository");
  for (const g of d.git_dirs) p.push("a git directory at " + g + " besides the tree's and the origin's");
  for (const h of d.hits) p.push("a hidden test name in " + h);
  return p.map((x) => "D7: " + x);
}

const filesText = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort().filter((f) => statSync(join(dir, f)).isFile()).map((f) => readFileSync(join(dir, f), "utf8")).join("\n") : "");

/** A task's hidden test names for D7's scan: the new test names and test paths its tests add that the pristine image and
 * the issue text lack (markers.ts runnerOnlyMarkers). Unlike the picker's markers, names the fix side also holds stay,
 * since the fix is hidden too. runnerOnlyMarkers puts a canary first; D7 passes a placeholder and drops it. */
export function d7Names(taskDir: string, pristine: Pristine): string[] {
  const issue = join(taskDir, "instruction.md");
  return runnerOnlyMarkers({ testSide: filesText(join(taskDir, "tests")), fixSide: "", publicText: existsSync(issue) ? readFileSync(issue, "utf8") : "", pristine, canary: "DRCANARY-" + "0".repeat(32) }).slice(1);
}

/** The line of a failed docker build (--progress=plain) that says why: the step's last fatal line, else its last error
 * line, else the build's last line. */
export function buildError(stderr: string): string {
  const lines = stderr.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const pick = (re: RegExp) => lines.filter((l) => re.test(l) && !/^ERROR: failed to (build|solve)/.test(l)).at(-1);
  return (pick(/\bfatal:/i) ?? pick(/\berror:/i) ?? lines.at(-1) ?? "").slice(0, 300);
}

/** A built image's reads against the rule: WORKDIR /testbed, pwd /testbed with no -w, origin/main equal to HEAD there,
 * and a clean D7 read. */
export function buildProblems(r: Omit<BuildRow, "pass">): string[] {
  if (r.error) return [r.error];
  const p: string[] = [];
  if (r.workdir !== SCREEN.workdir) p.push("WORKDIR is " + JSON.stringify(r.workdir ?? "") + ", not " + SCREEN.workdir);
  if (r.pwd !== SCREEN.workdir) p.push("pwd with no -w is " + JSON.stringify(r.pwd ?? "") + ", not " + SCREEN.workdir);
  if (!r.main || !/^[0-9a-f]{40}$/.test(r.main) || r.main !== r.head) p.push("origin/main " + (r.main || "missing") + " is not HEAD " + (r.head || "?"));
  if (!r.d7) p.push("D7 was not read");
  else p.push(...d7Problems(r.d7));
  return p;
}

export async function buildCheck(out: string, tasks: string[], log: (l: string) => void = console.log): Promise<BuildRow[]> {
  mkdirSync(out, { recursive: true });
  const docker = process.env.HM_DOCKER ?? "docker", p = pool(), rows: BuildRow[] = [];
  const dk = (args: string[], timeoutSec = 600) => { const r = Bun.spawnSync([docker, ...args], { stdout: "pipe", stderr: "pipe", timeout: timeoutSec * 1000 }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  const runner: DockerRunner = { run: async (args, o) => { const r = dk(args, Math.ceil((o?.timeoutMs ?? 600_000) / 1000)); return { code: r.code ?? 1, stdout: r.out, stderr: r.err }; } };
  for (const [i, task] of tasks.entries()) {
    const ref = imageRef(p.get(task)!), tag = "hm-build-" + (i + 1), ctx = mkdtempSync(join(tmpdir(), "hm-build-"));
    const read: Omit<BuildRow, "pass"> = { task };
    try {
      for (;;) {
        const pull = dk(["pull", "-q", ref], 3600);
        if (pull.code === 0) break;
        if (!/toomanyrequests|rate limit/i.test(pull.err)) { read.error = "pull failed: " + buildError(pull.err); break; }
        log("BUILD-CHECK wait Docker Hub's pull limit for " + ref);
        Bun.sleepSync(Number(process.env.HM_PULL_WAIT_SEC ?? SCREEN.pullWaitSec) * 1000);
      }
      const names = read.error ? [] : d7Names(join(rebenchRoot(), task), await pristineListing(runner, ref));
      if (!read.error) {
        const b = dk(["build", "--progress=plain", "-t", tag, trialEnvironment(task, join(ctx, "trial"))], 3600);
        if (b.code !== 0) read.error = "build failed: " + buildError(b.err);
      }
      if (!read.error) {
        read.workdir = dk(["image", "inspect", "--format", "{{.Config.WorkingDir}}", tag]).out.trim();
        const [pwd, main, head] = dk(["run", "--rm", "--network", "none", "--entrypoint", "sh", tag, "-c", "pwd && git rev-parse origin/main HEAD"]).out.trim().split("\n");
        Object.assign(read, { pwd, main, head });
        const mount = join(ctx, "d7");
        mkdirSync(mount, { mode: 0o700 });
        writeFileSync(join(mount, "check.sh"), D7_CHECK);
        if (names.length) writeFileSync(join(mount, "names"), names.join("\n") + "\n", { mode: 0o600 });
        const safe = ["-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*"];
        read.d7 = readD7(dk(["run", "--rm", "--network", "none", "-u", "0", ...safe, "-v", mount + ":/hm-d7:ro", "--entrypoint", "sh", tag, "/hm-d7/check.sh"], 1800).out);
      }
    } catch (e) {
      read.error = String((e as Error).message ?? e).split("\n")[0]!;
    } finally {
      rmSync(ctx, { recursive: true, force: true });
      dk(["rmi", "-f", tag, ref]);
    }
    const problems = buildProblems(read), row: BuildRow = { ...read, pass: !problems.length };
    rows.push(row);
    appendFileSync(join(out, "build-check.jsonl"), JSON.stringify(row) + "\n");
    log("BUILD-CHECK " + (i + 1) + "/" + tasks.length + " " + task + " " + (row.pass ? "PASS workdir " + row.workdir + ", origin/main = HEAD " + row.head!.slice(0, 12) + ", D7 clean with " + row.d7!.names + " hidden names scanned" : "FAIL " + problems.join("; ")));
  }
  const failed = rows.filter((r) => !r.pass);
  log("BUILD-CHECK " + (rows.length - failed.length) + " of " + rows.length + " built with WORKDIR " + SCREEN.workdir + ", origin/main = HEAD and a clean D7 read" + (failed.length ? "; FAILED: " + failed.map((r) => r.task).join(", ") : ""));
  return rows;
}

export async function buildCheckCommand(out: string, list: "calibration" | "scored", shard: string | undefined): Promise<number> {
  const m = /^(\d+)\/(\d+)$/.exec(shard ?? "1/1"), k = Number(m?.[1]), n = Number(m?.[2]);
  if (!m || k < 1 || k > n) throw new Error("E_USAGE hm build-check --shard takes k/n with 1 <= k <= n, not " + shard);
  const tasks = screenedFromEnv(bundleLists())[list].filter((_, i) => i % n === k - 1);
  return (await buildCheck(out, tasks)).every((r) => r.pass) ? 0 : 1;
}

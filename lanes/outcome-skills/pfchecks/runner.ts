// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 6.5 to 6.8: each run is a fresh container from the unit's image with the caller's mounts (the tools
// volume and, for P, the pstack plugin dir), no network and a fresh copy of the tree. It runs the unit's rebuild command
// first with the files the agent added moved out of the tree, moves them back byte for byte, then runs the entry with
// bash -c from the repository root under the entry timeout. Pass is exit 0 within the timeout; anything else fails. The catch rule: fail in all three parent runs, pass in all three fix runs, fail in all
// three neutral runs. Run order: parent run 1 for every entry, parent runs 2 and 3 for entries that failed run 1, then fix
// runs 1 to 3 and neutral runs 1 to 3 for entries still able to catch; an entry leaves at its first result that rules it
// out. Up to 4 runs at once. Runs not started within the 3-hour ceiling leave their entries unreached (non-catches). A
// rebuild that fails on the fix tree is a gap for that entry (E_PF_REBUILD_FIX); on the parent and neutral trees it is
// recorded and the entry's own result counts. A rebuild-exempt unit's rebuild exit is recorded and ignored everywhere.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, dockerRun } from "../../real-outcome/task/docker.ts";
import { copyVolume, dropVolume, homeVolume, LIMIT_MS, runArgs, runName, type Mode } from "../statemachines/testrun.ts";
import type { SmUnit } from "../statemachines/unit.ts";
import { pfFail } from "./prereg.ts";
import { git } from "./trees.ts";

export type TreeName = "parent" | "fix" | "neutral";
export interface RunSpec { entry: number; tree: TreeName; run: number; command: string; timeout_s: number; commit: string; label: string; aside?: string[] }
export interface RunOut { exit: number; timed_out: boolean; wall_ms: number; rebuild_exits: number[]; log: string; rebuild_ms?: number | null }
export type Executor = (s: RunSpec) => Promise<RunOut>;
/** start_ms: from the scoring start to the run's call; call_ms: the whole call, the tree copy included; rebuild_ms: from the
 *  container's start to the last rebuild's end mark, as the host saw it (null with no rebuild command or no mark). */
export interface RunRec { tree: TreeName; run: number; exit: number; pass: boolean; timed_out: boolean; wall_ms: number; rebuild_failed: boolean; log: string; start_ms?: number; call_ms?: number; rebuild_ms?: number | null }
/** waits: per phase the entry took part in, the time from the phase's start to its first run (slot_ms) and from its last
 *  run to the next phase's start (barrier_ms; null in the last phase and when the entry left in this phase). */
export interface EntryWait { phase: number; slot_ms: number; barrier_ms: number | null }
export interface EntryResult { index: number; command: string; runs: RunRec[]; outcome: "catch" | "no_catch" | "gap" | "unreached"; why: string; waits?: EntryWait[] }

export const CEILING_MS = 3 * 3600 * 1000;
export const CONCURRENCY = 4;
export const LOG_TAIL = 20_000;

/** clamp(3 x the unit's longest fixed oracle run, 300, 1800) seconds. */
export function entryTimeout(u: Pick<SmUnit, "oracle">): number {
  const ms = Math.max(0, ...(u.oracle?.runs ?? []).filter((r) => r.tree === "fixed").map((r) => r.wall_ms));
  return Math.min(1800, Math.max(300, Math.ceil((3 * ms) / 1000)));
}
export const rebuildExempt = (u: Pick<SmUnit, "oracle">): boolean => !u.oracle?.rebuild_rule?.applies;

async function pool<T>(items: T[], k: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(k, items.length) }, async () => {
    while (i < items.length) await f(items[i++]!);
  }));
}

const PHASES: Array<Array<[TreeName, number]>> = [[["parent", 1]], [["parent", 2], ["parent", 3]], [["fix", 1], ["fix", 2], ["fix", 3], ["neutral", 1], ["neutral", 2], ["neutral", 3]]];

/** Scores entries on the trees. fixOnly skips the parent runs (the compile-blocked rerun, whose parent runs are known). */
export async function scoreEntries(entries: { index: number; command: string }[], exec: Executor, o: { trees: Record<TreeName, string>; timeout_s: number; exempt: boolean; ceiling_ms?: number; concurrency?: number; now?: () => number; fixOnly?: boolean; label?: string; aside?: string[] }): Promise<{ results: EntryResult[]; ceiling_hit: boolean; wall_ms: number }> {
  const now = o.now ?? Date.now;
  const start = now(), deadline = start + (o.ceiling_ms ?? CEILING_MS);
  let hit = false;
  const results = entries.map((e): EntryResult & { done: boolean; waits: EntryWait[] } => ({ index: e.index, command: e.command, runs: [], outcome: "catch", why: "", waits: [], done: false }));
  const chain = async (r: (typeof results)[number], steps: Array<[TreeName, number]>) => {
    for (const [tree, run] of steps) {
      if (now() >= deadline) {
        hit = true;
        Object.assign(r, { outcome: "unreached", why: "ceiling before " + tree + " run " + run, done: true });
        return;
      }
      const c0 = now();
      const out = await exec({ entry: r.index, tree, run, command: r.command, timeout_s: o.timeout_s, commit: o.trees[tree], label: (o.label ?? "e") + r.index + "-" + tree + run, aside: o.aside ?? [] });
      const pass = out.exit === 0 && !out.timed_out;
      const rebuild_failed = out.rebuild_exits.some((x) => x !== 0);
      r.runs.push({ tree, run, exit: out.exit, pass, timed_out: out.timed_out, wall_ms: out.wall_ms, rebuild_failed, log: out.log.slice(-LOG_TAIL), start_ms: c0 - start, call_ms: now() - c0, rebuild_ms: out.rebuild_ms ?? null });
      if (tree === "fix" && rebuild_failed && !o.exempt) return void Object.assign(r, { outcome: "gap", why: "rebuild failed on fix run " + run, done: true });
      if (tree === "parent" && pass) return void Object.assign(r, { outcome: "no_catch", why: "passed on parent run " + run, done: true });
      if (tree === "fix" && !pass) return void Object.assign(r, { outcome: "no_catch", why: "failed on fix run " + run, done: true });
      if (tree === "neutral" && pass) return void Object.assign(r, { outcome: "no_catch", why: "passed on neutral run " + run, done: true });
    }
  };
  const phases = o.fixOnly ? PHASES.slice(2) : PHASES;
  for (const [i, steps] of phases.entries()) {
    const t0 = now(), live = results.filter((r) => !r.done), ended = new Map<(typeof results)[number], number>();
    await pool(live, o.concurrency ?? CONCURRENCY, async (r) => {
      r.waits.push({ phase: PHASES.indexOf(steps) + 1, slot_ms: now() - t0, barrier_ms: null });
      await chain(r, steps);
      ended.set(r, now());
    });
    const t1 = now();
    if (i < phases.length - 1) for (const r of live) if (!r.done) r.waits.at(-1)!.barrier_ms = t1 - ended.get(r)!;
  }
  for (const r of results) if (!r.done) r.why = "caught";
  return { results: results.map(({ done: _, ...r }) => r), ceiling_hit: hit, wall_ms: now() - start };
}

/** The scheduler replayed from recorded run times with no setup time between runs: in each phase the live entries take the
 *  slots in order, each running its own steps one after another, and the next phase starts when the last slot frees, as in
 *  scoreEntries. An entry is live in a phase when it has a recorded run there or its ceiling stop names a step there.
 *  Returns, per entry, the replayed start of each recorded run and of the step its ceiling stop named (ran false). */
export function replaySchedule(results: Array<Pick<EntryResult, "index" | "why"> & { runs: Array<Pick<RunRec, "tree" | "run" | "wall_ms">> }>, o: { concurrency?: number; fixOnly?: boolean } = {}): Map<number, Array<{ tree: TreeName; run: number; start_ms: number; ran: boolean }>> {
  const out = new Map(results.map((r) => [r.index, [] as Array<{ tree: TreeName; run: number; start_ms: number; ran: boolean }>]));
  let t = 0;
  for (const steps of o.fixOnly ? PHASES.slice(2) : PHASES) {
    const free = Array.from({ length: o.concurrency ?? CONCURRENCY }, () => t);
    for (const r of results) {
      const stop = /^ceiling before (parent|fix|neutral) run (\d)$/.exec(r.why);
      const stopped = (tree: TreeName, run: number) => !!stop && stop[1] === tree && Number(stop[2]) === run;
      const ran = (tree: TreeName, run: number) => r.runs.find((x) => x.tree === tree && x.run === run);
      if (!steps.some(([tree, run]) => ran(tree, run) || stopped(tree, run))) continue;
      const w = free.indexOf(Math.min(...free));
      let at = free[w]!;
      for (const [tree, run] of steps) {
        const x = ran(tree, run);
        if (!x) {
          if (stopped(tree, run)) out.get(r.index)!.push({ tree, run, start_ms: at, ran: false });
          break;
        }
        out.get(r.index)!.push({ tree, run, start_ms: at, ran: true });
        at += x.wall_ms;
      }
      free[w] = at;
    }
    t = Math.max(t, ...free);
  }
  return out;
}

/** Section 6.6 and 6.8: 1 when an entry catches; a gap when none catches and one hit a fix-tree rebuild failure; else 0. */
export function unitScore(results: EntryResult[], sessionGap: string | null): { score: 0 | 1 | null; gap: string | null } {
  if (sessionGap) return { score: null, gap: sessionGap };
  if (results.some((r) => r.outcome === "catch")) return { score: 1, gap: null };
  if (results.some((r) => r.outcome === "gap")) return { score: null, gap: "E_PF_REBUILD_FIX" };
  return { score: 0, gap: null };
}

const sq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The container script: the files the agent added (aside, repository paths) move out of the tree to /tmp, the rebuild
 *  commands run from the work dir (each exit printed), the moved files move back, then the entry runs from the repository
 *  root under coreutils timeout when the image has it, then every rebuild exit prints again, so the kept tail of a long
 *  entry output still holds them. A file that can't be moved out or back stops the run before the entry. The markers carry
 *  a per-run nonce the entry cannot know, and each starts its own line, so output with no final newline can't hide one. */
export function entryScript(rebuild: string[], repoDir: string, workDir: string, timeoutS: number, nonce: string, aside: string[] = []): string {
  const run = 'bash -c "$PF_CMD" </dev/null';
  const mark = (name: string, value: string) => "printf '\\n" + name + "_" + nonce + "%s\\n' \"" + value + "\"";
  const dir = "/tmp/pf-aside-" + nonce;
  const out = aside.length ? ["pf_af=", "cd " + sq(repoDir), "mkdir -p " + dir + " || pf_af=1", ...aside.map((p, i) => "pf_m" + i + "=; if [ -e " + sq(p) + " ] || [ -L " + sq(p) + " ]; then mv -f -- " + sq(p) + " " + dir + "/" + i + " && pf_m" + i + "=1 || pf_af=1; fi")] : [];
  const back = aside.length ? [...aside.map((p, i) => 'if [ -n "$pf_m' + i + '" ]; then mkdir -p -- "$(dirname -- ' + sq(p) + ')" && mv -f -- ' + dir + "/" + i + " " + sq(p) + " || pf_af=1; fi"), 'if [ -n "$pf_af" ]; then ' + mark("PF_ASIDE", " failed") + "; exit 97; fi"] : [];
  return ["exec 2>&1", ...out, "cd " + sq(workDir), ...rebuild.map((c, i) => "( " + c + " ) </dev/null\npf_r" + i + "=$?\n" + mark("PF_REBUILD", " $pf_r" + i)), "cd " + sq(repoDir), ...back,
    "if command -v timeout >/dev/null 2>&1; then timeout -k 10 " + timeoutS + " " + run + "; else " + run + "; fi", "pf_e=$?", mark("PF_ENTRY", " $pf_e"),
    mark("PF_REBUILDS", rebuild.map((_, i) => " $pf_r" + i).join("")), ""].join("\n");
}
export function readRun(out: string, killed: boolean, wall_ms: number, nonce: string, rebuild_ms: number | null = null): RunOut {
  if (new RegExp("^PF_ASIDE_" + nonce + " failed$", "m").test(out)) pfFail("E_PF_INFRA_GAP", "a file the agent added could not be moved out of the tree for the rebuild or back before the entry");
  const all = [...out.matchAll(new RegExp("^PF_REBUILDS_" + nonce + "((?: \\d+)*)$", "gm"))].pop();
  const rebuild_exits = all ? all[1]!.split(" ").filter(Boolean).map(Number) : [...out.matchAll(new RegExp("^PF_REBUILD_" + nonce + " (\\d+)$", "gm"))].map((m) => Number(m[1]));
  const m = [...out.matchAll(new RegExp("^PF_ENTRY_" + nonce + " (\\d+)$", "gm"))].pop();
  const exit = killed || !m ? -1 : Number(m[1]);
  return { exit, timed_out: killed || exit === 124, wall_ms, rebuild_exits, log: out.slice(-LOG_TAIL), rebuild_ms };
}

/** seen: when the last match of watch (a global regexp) arrived on the output, by the host's clock. */
function runAsync(name: string, args: string[], input: string, timeoutMs: number, watch?: RegExp): Promise<{ stdout: string; killed: boolean; seen: number | null }> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["run", "--name", name, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", killed = false, carry = "", seen: number | null = null;
    const keep = (b: Buffer) => {
      const s = b.toString("latin1");
      stdout = (stdout + s).slice(-4 * LOG_TAIL);
      if (!watch) return;
      const text = carry + s;
      for (const m of text.matchAll(watch)) if (m.index! + m[0].length > carry.length) seen = Date.now();
      carry = text.slice(-200);
    };
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    const t = setTimeout(() => { killed = true; spawnSync("docker", ["kill", name]); }, timeoutMs);
    p.on("close", () => { clearTimeout(t); spawnSync("docker", ["rm", "-f", name]); resolve({ stdout, killed, seen }); });
    p.stdin.end(input);
  });
}

/** The tree volume's container script, run as root with the prepared tree at /b, a clone holding only the tree commit's
 *  history on branch main at /s and the new volume at /d; $1 is the tree commit. An untracked file that isn't ignored stops
 *  it before the checkout, so no checkout is forced over one; after the checkout HEAD, the working tree and the index must
 *  equal the commit and no such file may remain. Ignored files, the build state among them, stay as the image left them. */
export const TREE_SCRIPT = String.raw`set -e
c="$1"
cp -a /b/. /d/
cd /d
export HOME=/tmp/pf-tree-home
mkdir -p "$HOME"
git config --global --add safe.directory '*'
git config --global core.quotePath false
u=$(git ls-files --others --exclude-standard)
if [ -n "$u" ]; then printf '%s\n' "$u" | sed 's/^/PF_UNTRACKED before /'; exit 3; fi
git fetch -q --no-tags /s main
git checkout -q -f -B main "$c"
git remote | while read -r x; do git remote remove "$x"; done
git for-each-ref --format='%(refname)' | while read -r ref; do [ "$ref" = refs/heads/main ] || git update-ref -d "$ref"; done
rm -f .git/FETCH_HEAD .git/ORIG_HEAD
[ "$(git rev-parse HEAD)" = "$c" ] || { echo "PF_TREE_DIFF HEAD is $(git rev-parse HEAD)"; exit 4; }
git diff --quiet "$c" -- || { git diff --name-only "$c" -- | sed 's/^/PF_TREE_DIFF tracked /'; exit 4; }
git diff --cached --quiet "$c" -- || { echo "PF_TREE_DIFF staged"; exit 4; }
u=$(git ls-files --others --exclude-standard)
if [ -n "$u" ]; then printf '%s\n' "$u" | sed 's/^/PF_UNTRACKED after /'; exit 3; fi
echo PF_TREE_OK
`;

/** Reads the tree script's result: PF_TREE_OK passes; untracked files that aren't ignored, or a tree that differs from its
 *  commit, stop scoring with E_PF_TREE_STATE; any other failure is a harness fault. */
export function readTree(status: number, stdout: string, stderr: string, volume: string): void {
  if (status === 0 && /^PF_TREE_OK$/m.test(stdout)) return;
  const untracked = [...stdout.matchAll(/^PF_UNTRACKED (before|after) (.+)$/gm)];
  if (untracked.length) pfFail("E_PF_TREE_STATE", volume + ": " + untracked.length + " untracked file(s) that aren't ignored, " + untracked[0]![1] + " the checkout: " + untracked.slice(0, 20).map((m) => m[2]).join(", "));
  const diff = [...stdout.matchAll(/^PF_TREE_DIFF (.+)$/gm)].map((m) => m[1]!);
  if (diff.length) pfFail("E_PF_TREE_STATE", volume + ": the tree differs from its commit after the checkout: " + diff.slice(0, 20).join(", "));
  pfFail("E_PF_INFRA_GAP", "building the tree volume " + volume + " failed: " + (stderr || stdout).slice(-300));
}

/** A scoring tree volume (plan section 6.5, A1): a copy of base, the prepared tree volume the oracle and the neutral gate
 *  run on (the image's repo dir, build state and ignored files included), with the tree commit checked out over it on
 *  branch main. The commit's history comes from a clone of the scoring repo whose only ref is main at the commit. */
export function treeVolume(repo: string, commit: string, image: string, volume: string, base: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "pf-vol-"));
  try {
    git(tmp, ["clone", "-q", "--no-hardlinks", "--no-checkout", repo, "r"]);
    const r = join(tmp, "r");
    git(r, ["update-ref", "refs/heads/main", commit]);
    git(r, ["remote", "remove", "origin"]);
    for (const ref of git(r, ["for-each-ref", "--format=%(refname)"]).stdout.split("\n").filter((x) => x && x !== "refs/heads/main")) git(r, ["update-ref", "-d", ref]);
    if (docker(["volume", "create", volume], { timeoutMs: 60_000 }).status !== 0) pfFail("E_PF_INFRA_GAP", "docker volume create " + volume + " failed");
    const c = dockerRun(runName("pf-vol"), ["--rm", "--network", "none", "--user", "0:0", "-v", base + ":/b:ro", "-v", r + ":/s:ro", "-v", volume + ":/d", "--entrypoint", "sh", image, "-c", TREE_SCRIPT, "pf-tree", commit], { timeoutMs: 1_800_000 });
    try {
      readTree(c.status ?? -1, c.stdout ?? "", c.stderr ?? "", volume);
    } catch (e) {
      dropVolume(volume);
      throw e;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The Docker executor. Tree volumes are made once per commit (treeVolume, from the prepared tree volume base) and copied
 *  fresh for every run. mounts are raw
 *  docker run arguments the caller passes (the tools volume, the plugin dir); env is the frozen environment. */
export function dockerExecutor(o: { repo: string; image: string; base: string; repoDir: string; workDir?: string; mode: Mode; mounts?: string[]; env?: Record<string, string>; rebuild: string[]; rebuildLimitMs?: number }): Executor & { cleanup: () => void } {
  const vols = new Map<string, string>();
  const exec = async (s: RunSpec): Promise<RunOut> => {
    let vol = vols.get(s.commit);
    if (!vol) {
      vol = runName("pf-tree-" + s.commit.slice(0, 12));
      treeVolume(o.repo, s.commit, o.image, vol, o.base);
      vols.set(s.commit, vol);
    }
    const name = runName("pf-" + s.label);
    const copy = name + "-tree";
    copyVolume(o.image, vol, copy, o.mode);
    const homeVol = o.mode === "hardened" ? name + "-home" : null;
    try {
      const home = homeVol ? { volume: homeVol, path: homeVolume(o.image, homeVol) } : undefined;
      const args = runArgs({ image: o.image, volume: copy, repoDir: o.repoDir, workDir: o.workDir, mode: o.mode, name, home });
      args.splice(args.indexOf("--entrypoint"), 0, ...(o.mounts ?? []), ...Object.entries(o.env ?? {}).flatMap(([k, v]) => ["-e", k + "=" + v]), "-e", "PF_CMD=" + s.command);
      const nonce = randomUUID().replace(/-/g, "");
      const t0 = Date.now();
      const r = await runAsync(name, args, entryScript(o.rebuild, o.repoDir, o.workDir || o.repoDir, s.timeout_s, nonce, s.aside), (o.rebuildLimitMs ?? LIMIT_MS) + s.timeout_s * 1000 + 60_000, new RegExp("PF_REBUILD_" + nonce + " \\d+\\n", "g"));
      return readRun(r.stdout, r.killed, Date.now() - t0, nonce, o.rebuild.length && r.seen !== null ? r.seen - t0 : null);
    } finally {
      dropVolume(copy);
      if (homeVol) dropVolume(homeVol);
    }
  };
  return Object.assign(exec, { cleanup: () => { for (const v of vols.values()) dropVolume(v); vols.clear(); } });
}

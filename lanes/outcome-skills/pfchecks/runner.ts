// Copyright (c) 2026 Garry Tan. MIT License.
// Plan sections 6.5 to 6.8: each run is a fresh container from the unit's image with the caller's mounts (the tools
// volume and, for P, the pstack plugin dir), no network and a fresh copy of the tree. It runs the unit's rebuild command
// first, then the entry with bash -c from the repository root under the entry timeout. Pass is exit 0 within the
// timeout; anything else fails. The catch rule: fail in all three parent runs, pass in all three fix runs, fail in all
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
export interface RunSpec { entry: number; tree: TreeName; run: number; command: string; timeout_s: number; commit: string; label: string }
export interface RunOut { exit: number; timed_out: boolean; wall_ms: number; rebuild_exits: number[]; log: string }
export type Executor = (s: RunSpec) => Promise<RunOut>;
export interface RunRec { tree: TreeName; run: number; exit: number; pass: boolean; timed_out: boolean; wall_ms: number; rebuild_failed: boolean; log: string }
export interface EntryResult { index: number; command: string; runs: RunRec[]; outcome: "catch" | "no_catch" | "gap" | "unreached"; why: string }

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
export async function scoreEntries(entries: { index: number; command: string }[], exec: Executor, o: { trees: Record<TreeName, string>; timeout_s: number; exempt: boolean; ceiling_ms?: number; concurrency?: number; now?: () => number; fixOnly?: boolean; label?: string }): Promise<{ results: EntryResult[]; ceiling_hit: boolean; wall_ms: number }> {
  const now = o.now ?? Date.now;
  const start = now(), deadline = start + (o.ceiling_ms ?? CEILING_MS);
  let hit = false;
  const results = entries.map((e): EntryResult & { done: boolean } => ({ index: e.index, command: e.command, runs: [], outcome: "catch", why: "", done: false }));
  const chain = async (r: (typeof results)[number], steps: Array<[TreeName, number]>) => {
    for (const [tree, run] of steps) {
      if (now() >= deadline) {
        hit = true;
        Object.assign(r, { outcome: "unreached", why: "ceiling before " + tree + " run " + run, done: true });
        return;
      }
      const out = await exec({ entry: r.index, tree, run, command: r.command, timeout_s: o.timeout_s, commit: o.trees[tree], label: (o.label ?? "e") + r.index + "-" + tree + run });
      const pass = out.exit === 0 && !out.timed_out;
      const rebuild_failed = out.rebuild_exits.some((x) => x !== 0);
      r.runs.push({ tree, run, exit: out.exit, pass, timed_out: out.timed_out, wall_ms: out.wall_ms, rebuild_failed, log: out.log.slice(-LOG_TAIL) });
      if (tree === "fix" && rebuild_failed && !o.exempt) return void Object.assign(r, { outcome: "gap", why: "rebuild failed on fix run " + run, done: true });
      if (tree === "parent" && pass) return void Object.assign(r, { outcome: "no_catch", why: "passed on parent run " + run, done: true });
      if (tree === "fix" && !pass) return void Object.assign(r, { outcome: "no_catch", why: "failed on fix run " + run, done: true });
      if (tree === "neutral" && pass) return void Object.assign(r, { outcome: "no_catch", why: "passed on neutral run " + run, done: true });
    }
  };
  for (const steps of o.fixOnly ? PHASES.slice(2) : PHASES) await pool(results.filter((r) => !r.done), o.concurrency ?? CONCURRENCY, (r) => chain(r, steps));
  for (const r of results) if (!r.done) r.why = "caught";
  return { results: results.map(({ done: _, ...r }) => r), ceiling_hit: hit, wall_ms: now() - start };
}

/** Section 6.6 and 6.8: 1 when an entry catches; a gap when none catches and one hit a fix-tree rebuild failure; else 0. */
export function unitScore(results: EntryResult[], sessionGap: string | null): { score: 0 | 1 | null; gap: string | null } {
  if (sessionGap) return { score: null, gap: sessionGap };
  if (results.some((r) => r.outcome === "catch")) return { score: 1, gap: null };
  if (results.some((r) => r.outcome === "gap")) return { score: null, gap: "E_PF_REBUILD_FIX" };
  return { score: 0, gap: null };
}

const sq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/** The container script: the rebuild commands from the work dir (each exit printed), then the entry from the repository
 *  root under coreutils timeout when the image has it. The markers carry a per-run nonce the entry cannot know. */
export function entryScript(rebuild: string[], repoDir: string, workDir: string, timeoutS: number, nonce: string): string {
  const run = 'bash -c "$PF_CMD" </dev/null';
  return ["exec 2>&1", "cd " + sq(workDir), ...rebuild.map((c) => "( " + c + " ) </dev/null\necho \"PF_REBUILD_" + nonce + " $?\""), "cd " + sq(repoDir),
    "if command -v timeout >/dev/null 2>&1; then timeout -k 10 " + timeoutS + " " + run + "; else " + run + "; fi", "echo \"PF_ENTRY_" + nonce + " $?\"", ""].join("\n");
}
export function readRun(out: string, killed: boolean, wall_ms: number, nonce: string): RunOut {
  const rebuild_exits = [...out.matchAll(new RegExp("^PF_REBUILD_" + nonce + " (\\d+)$", "gm"))].map((m) => Number(m[1]));
  const m = [...out.matchAll(new RegExp("^PF_ENTRY_" + nonce + " (\\d+)$", "gm"))].pop();
  const exit = killed || !m ? -1 : Number(m[1]);
  return { exit, timed_out: killed || exit === 124, wall_ms, rebuild_exits, log: out.slice(-LOG_TAIL) };
}

function runAsync(name: string, args: string[], input: string, timeoutMs: number): Promise<{ stdout: string; killed: boolean }> {
  return new Promise((resolve) => {
    const p = spawn("docker", ["run", "--name", name, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", killed = false;
    const keep = (b: Buffer) => { stdout = (stdout + b.toString("latin1")).slice(-4 * LOG_TAIL); };
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    const t = setTimeout(() => { killed = true; spawnSync("docker", ["kill", name]); }, timeoutMs);
    p.on("close", () => { clearTimeout(t); spawnSync("docker", ["rm", "-f", name]); resolve({ stdout, killed }); });
    p.stdin.end(input);
  });
}

/** A volume holding the tree commit checked out on branch main of a clone of the scoring repo, history included. */
export function treeVolume(repo: string, commit: string, image: string, volume: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "pf-vol-"));
  try {
    git(tmp, ["clone", "-q", "--no-hardlinks", "--no-checkout", repo, "r"]);
    const r = join(tmp, "r");
    git(r, ["checkout", "-q", "-B", "main", commit]);
    git(r, ["remote", "remove", "origin"]);
    for (const ref of git(r, ["for-each-ref", "--format=%(refname)"]).stdout.split("\n").filter((x) => x && x !== "refs/heads/main")) git(r, ["update-ref", "-d", ref]);
    if (docker(["volume", "create", volume], { timeoutMs: 60_000 }).status !== 0) pfFail("E_PF_INFRA_GAP", "docker volume create " + volume + " failed");
    const c = dockerRun(runName("pf-vol"), ["--rm", "--network", "none", "--user", "0:0", "-v", r + ":/s:ro", "-v", volume + ":/d", "--entrypoint", "sh", image, "-c", "cp -a /s/. /d/"], { timeoutMs: 1_800_000 });
    if (c.status !== 0) pfFail("E_PF_INFRA_GAP", "copying the tree into " + volume + " failed: " + c.stderr.slice(-300));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The Docker executor. Tree volumes are made once per commit (treeVolume) and copied fresh for every run. mounts are raw
 *  docker run arguments the caller passes (the tools volume, the plugin dir); env is the frozen environment. */
export function dockerExecutor(o: { repo: string; image: string; repoDir: string; workDir?: string; mode: Mode; mounts?: string[]; env?: Record<string, string>; rebuild: string[]; rebuildLimitMs?: number }): Executor & { cleanup: () => void } {
  const vols = new Map<string, string>();
  const exec = async (s: RunSpec): Promise<RunOut> => {
    let vol = vols.get(s.commit);
    if (!vol) {
      vol = "pf-tree-" + s.commit.slice(0, 12) + "-" + process.pid;
      treeVolume(o.repo, s.commit, o.image, vol);
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
      const r = await runAsync(name, args, entryScript(o.rebuild, o.repoDir, o.workDir || o.repoDir, s.timeout_s, nonce), (o.rebuildLimitMs ?? LIMIT_MS) + s.timeout_s * 1000 + 60_000);
      return readRun(r.stdout, r.killed, Date.now() - t0, nonce);
    } finally {
      dropVolume(copy);
      if (homeVol) dropVolume(homeVol);
    }
  };
  return Object.assign(exec, { cleanup: () => { for (const v of vols.values()) dropVolume(v); vols.clear(); } });
}

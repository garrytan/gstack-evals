// Copyright (c) 2026 Garry Tan. MIT License.
// Source A's rebuild tier (amendment 1 sections 1 and 5). The drive holds the task directories of 78 source A tasks (the
// held tier). rebuild-a rebuilds every other task a none-arm session ran from the pinned inputs: the pinned Harbor's export
// of the SWE-rebench Hub package at its version, through quick/laneb's materializer, runtime layers and pool file as each
// R3 bundle's commit holds them. A probe first rebuilds one held-tier task per commit and must reach that directory's
// digest. A rebuilt directory is kept only at a session's recorded digest (lock.json); the rest drop with the reason.
// Rebuilt directories carry the custody of source A's raw bundles (prereg section 11 item 3): see lanes/tbv/README.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fail } from "../errors.ts";
import type { Io } from "../types.ts";
import { taskDirDigest } from "./source-a.ts";

const REPO = join(import.meta.dir, "../../..");

export interface Pins {
  harbor: string;
  dataset: { name: string; version: string };
  /** sha256 of quick/laneb/tasks/swerebench-r3a4.json at every bundle's commit. */
  pool: string;
  /** prepare-run.ts's NETWORK default at both commits; R3's parts set no other. */
  network: "allowlist" | "public";
  /** Each R3 bundle's commit: its parts ran from a git archive export of it. */
  bundles: Record<string, string>;
}

/** R3 amendment 4 sections 2, 4 and 5 (Harbor, the dataset version, the pool, the R3a4 commit) and the R3b pin post. */
export const PINS: Pins = {
  harbor: "f3a5a923f6d722472c9e797af836ae4425fb215f",
  dataset: { name: "swe-rebench/swe-rebench-leaderboard", version: "sha256:ebe7444e313a0d8db94fa541139826eaebe2b0abcd4900c6f73e750494910dca" },
  pool: "7d2b2735cd50836364cc2c1fba9a2dd07a5ce42e9ea0f9c4b8d699b9e81ea1af",
  network: "allowlist",
  bundles: {
    "opus-r3a4": "616de34fb1c90763f897d1fdb7f1764ff7bcaee3",
    "sol-r3a4": "616de34fb1c90763f897d1fdb7f1764ff7bcaee3",
    "opus-r3b": "dbcb5b49e4d41b6a6d176d35e406a4399704c3a7",
    "sol-r3b": "dbcb5b49e4d41b6a6d176d35e406a4399704c3a7",
  },
};

/** The files the rebuild reads from each pinned commit's git objects, never from the working tree. */
export const PINNED_FILES = {
  materialize: "quick/laneb/runner/materialize.ts",
  stages: "quick/laneb/runner/runtime-stages.Dockerfile",
  copy: "quick/laneb/runner/runtime-copy.Dockerfile",
  pool: "quick/laneb/tasks/swerebench-r3a4.json",
} as const;

export interface RebuildOptions {
  /** The git checkout whose history holds the pinned commits. */
  repo: string;
  /** The pinned Harbor's export of the Hub package: one directory per task id. */
  export: string;
  /** Directories of held-tier task directories, one per task id. */
  heldTier: string[];
  /** Bundle name to its unpacked directory of trials. */
  bundles: Record<string, string>;
  out: string;
}

type Drop = "digest_mismatch" | "not_in_pool" | "no_lock_digest";
interface PoolTask { task_id: string; digest: string; [k: string]: unknown }
interface Materializer {
  materializeRebench: (root: string, task: PoolTask, dest: string, opts: { runtimeStages: string; runtimeCopy: string; network: string }) => unknown;
  treeDigest: (dir: string) => string;
}
interface Pinned { commit: string; files: Record<string, string>; pool: Map<string, PoolTask>; stages: string; copy: string; m: Materializer }
interface Session { bundle: string; trial: string; task: string; commit: string; recorded: string | null }
export interface SessionRow extends Session { status: "held" | "kept" | "dropped"; reason?: Drop; task_dir?: string }
export interface TaskRow { commit: string; task: string; recorded: string[]; rebuilt: string | null; status: "kept" | "dropped"; reason?: Exclude<Drop, "no_lock_digest">; dir?: string }
export interface Probe { commit: string; task: string; digest: string; rebuilt: string; match: boolean }
export interface RebuildRecord {
  schema: "tbv-rebuild-a.v1";
  pins: Omit<Pins, "bundles"> & { bundles: Record<string, string>; files: Record<string, Record<string, string>> };
  probes: Probe[];
  tasks: TaskRow[];
  sessions: SessionRow[];
  counts: Record<string, number>;
}

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function gitBlob(repo: string, commit: string, path: string): Buffer | null {
  const r = Bun.spawnSync(["git", "--no-replace-objects", "-C", repo, "cat-file", "blob", commit + ":" + path]);
  return r.exitCode === 0 ? Buffer.from(r.stdout) : null;
}

async function loadPinned(repo: string, commit: string, pins: Pins, dir: string): Promise<Pinned> {
  if (Bun.spawnSync(["git", "--no-replace-objects", "-C", repo, "cat-file", "-e", commit + "^{commit}"]).exitCode !== 0)
    fail("E_TBV_REBUILD", "the checkout " + repo + " lacks pinned commit " + commit + "; a shallow clone has no history, so clone in full");
  mkdirSync(dir, { recursive: true });
  const blobs: Partial<Record<keyof typeof PINNED_FILES, Buffer>> = {};
  const files: Record<string, string> = {};
  for (const [k, path] of Object.entries(PINNED_FILES) as [keyof typeof PINNED_FILES, string][]) {
    const b = gitBlob(repo, commit, path) ?? fail("E_TBV_REBUILD", "pinned commit " + commit + " has no " + path);
    blobs[k] = b;
    files[path] = sha(b);
    writeFileSync(join(dir, path.split("/").at(-1)!), b);
  }
  if (files[PINNED_FILES.pool] !== pins.pool) fail("E_TBV_REBUILD", PINNED_FILES.pool + " at " + commit + " has sha256 " + files[PINNED_FILES.pool] + ", not the pinned " + pins.pool);
  const doc = JSON.parse(blobs.pool!.toString("utf8")) as { dataset?: { name?: string; version?: string; harbor_commit?: string }; tasks?: PoolTask[] };
  const ds = doc.dataset ?? {};
  if (ds.name !== pins.dataset.name || ds.version !== pins.dataset.version || ds.harbor_commit !== pins.harbor)
    fail("E_TBV_REBUILD", "the pool at " + commit + " names " + ds.name + " " + ds.version + " from Harbor " + ds.harbor_commit + ", not the pinned " + pins.dataset.name + " " + pins.dataset.version + " from Harbor " + pins.harbor);
  const m = (await import(join(dir, "materialize.ts"))) as Partial<Materializer>;
  if (typeof m.materializeRebench !== "function" || typeof m.treeDigest !== "function") return fail("E_TBV_REBUILD", PINNED_FILES.materialize + " at " + commit + " exports no materializeRebench or treeDigest");
  return { commit, files, pool: new Map((doc.tasks ?? []).map((t) => [t.task_id, t])), stages: blobs.stages!.toString("utf8"), copy: blobs.copy!.toString("utf8"), m: m as Materializer };
}

/** Every trial directory under a bundle: a directory whose result.json names a task and a <task>__<id> trial. */
function trialsOf(bundle: string, root: string, commit: string): { none: Session[]; other: number } {
  const none: Session[] = [];
  const other = new Set<string>();
  const walk = (dir: string) => {
    const res = join(dir, "result.json");
    if (existsSync(res)) {
      let r: Record<string, any>;
      try {
        r = JSON.parse(readFileSync(res, "utf8"));
      } catch {
        return fail("E_TBV_INPUT", "a result.json in bundle " + bundle + " is not JSON");
      }
      if (r && typeof r.task_name === "string" && typeof r.trial_name === "string" && r.trial_name.includes("__")) {
        const kwargs = r.config?.agent?.kwargs ?? {};
        if (kwargs.arm !== "none" || kwargs.told_skill) {
          other.add(r.trial_name);
          return;
        }
        let digest: unknown = null;
        try {
          digest = JSON.parse(readFileSync(join(dir, "lock.json"), "utf8"))?.task?.digest;
        } catch {}
        none.push({ bundle, trial: r.trial_name, task: r.task_name, commit, recorded: typeof digest === "string" && DIGEST.test(digest) ? digest : null });
        return;
      }
    }
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => byBytes(a.name, b.name))) if (e.isDirectory()) walk(join(dir, e.name));
  };
  walk(root);
  const seen = new Map<string, Session>();
  for (const s of none) {
    const was = seen.get(s.trial);
    if (was && was.recorded !== s.recorded) fail("E_TBV_INPUT", "a trial appears twice in bundle " + bundle + " with different lock digests");
    if (!was) seen.set(s.trial, s);
  }
  return { none: [...seen.values()], other: other.size };
}

function insideWorkTree(path: string): boolean {
  let p = resolve(path);
  while (!existsSync(p)) p = dirname(p);
  const r = Bun.spawnSync(["git", "-C", p, "rev-parse", "--is-inside-work-tree", "--is-inside-git-dir"], { env: process.env });
  if (r.exitCode === 128 && r.stderr.toString().includes("not a git repository")) return false;
  return r.exitCode !== 0 || r.stdout.toString().includes("true");
}

export async function rebuildA(o: RebuildOptions, io: Io, pins: Pins = PINS): Promise<RebuildRecord> {
  for (const [flag, p] of [["--export", o.export], ...o.heldTier.map((h) => ["--held-tier", h]), ...Object.values(o.bundles).map((b) => ["--bundle", b])] as [string, string][])
    if (!isDir(p)) fail("E_TBV_INPUT", flag + " " + p + " is not a directory");
  if (existsSync(o.out)) fail("E_TBV_INPUT", "--out " + o.out + " exists; give a new directory");
  if (insideWorkTree(o.out)) fail("E_TBV_REBUILD", "--out " + o.out + " is inside a git checkout, or git could not rule that out; rebuilt task directories carry source A's raw-bundle custody and never enter a checkout");
  const names = Object.keys(o.bundles).sort(byBytes);
  for (const b of names) if (!pins.bundles[b]) fail("E_TBV_REBUILD", "bundle " + b + " has no pinned commit; the pinned bundles are " + Object.keys(pins.bundles).join(", "));
  const commits = [...new Set(names.map((b) => pins.bundles[b]!))].sort(byBytes);

  mkdirSync(dirname(resolve(o.out)), { recursive: true });
  try {
    mkdirSync(o.out);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") fail("E_TBV_INPUT", "--out " + o.out + " exists; give a new directory");
    throw e;
  }
  const refuse = (code: Parameters<typeof fail>[0], short: string, detail: string) => {
    writeFileSync(join(o.out, "refusal.txt"), detail + "\n");
    return fail(code, short + "; the details name tasks, so they are only in " + join(o.out, "refusal.txt"));
  };
  const pinned = new Map<string, Pinned>();
  for (const c of commits) pinned.set(c, await loadPinned(o.repo, c, pins, join(o.out, "pins", c.slice(0, 12))));

  let other = 0;
  const sessions: Session[] = [];
  for (const b of names) {
    const t = trialsOf(b, o.bundles[b]!, pins.bundles[b]!);
    sessions.push(...t.none);
    other += t.other;
  }
  const held = new Map<string, Map<string, string>>();
  for (const root of o.heldTier)
    for (const name of readdirSync(root).sort(byBytes)) {
      const d = join(root, name);
      if (!isDir(d) || !existsSync(join(d, "instruction.md"))) continue;
      if (!held.has(name)) held.set(name, new Map());
      const digest = taskDirDigest(d);
      if (!held.get(name)!.has(digest)) held.get(name)!.set(digest, d);
    }

  const rows: SessionRow[] = [];
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    if (s.recorded === null) rows.push({ ...s, status: "dropped", reason: "no_lock_digest" });
    else if (held.get(s.task)?.has(s.recorded)) rows.push({ ...s, status: "held", task_dir: held.get(s.task)!.get(s.recorded)! });
    else {
      const k = s.commit + "\0" + s.task;
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
  }
  const rebuildCommits = [...new Set([...groups.values()].map((g) => g[0]!.commit))].sort(byBytes);

  const picks = rebuildCommits.map((c) => {
    const p = pinned.get(c)!;
    const cand = rows.filter((r) => r.status === "held" && r.commit === c && p.pool.has(r.task)).sort((a, b) => byBytes(a.task, b.task))[0];
    return cand ? { commit: c, task: cand.task, digest: cand.recorded!, dir: cand.task_dir! } : fail("E_TBV_PROBE", "no held-tier session ran at " + c.slice(0, 12) + " on a pool task, so nothing can probe that commit's rebuild; nothing was rebuilt");
  });

  const needed = [...picks.map((p) => [p.commit, p.task]), ...[...groups.values()].map((g) => [g[0]!.commit, g[0]!.task])] as [string, string][];
  const missing: string[] = [], off: string[] = [];
  for (const [c, t] of needed) {
    const task = pinned.get(c)!.pool.get(t);
    if (!task) continue;
    const d = join(o.export, t);
    if (!isDir(d)) missing.push(t);
    else if ("sha256:" + pinned.get(c)!.m.treeDigest(d) !== task.digest) off.push(t);
  }
  if (missing.length || off.length)
    refuse("E_TBV_REBUILD", "the export at " + o.export + " is not the pinned " + pins.dataset.name + " " + pins.dataset.version + ": " + missing.length + " task directories missing, " + off.length + " not at the pool's content hash; download it again with Harbor " + pins.harbor, "missing: " + missing.join(", ") + "\nnot at the pool's content hash: " + off.join(", "));

  const materialize = (c: string, t: string, dest: string) => {
    const p = pinned.get(c)!;
    try {
      p.m.materializeRebench(o.export, p.pool.get(t)!, dest, { runtimeStages: p.stages, runtimeCopy: p.copy, network: pins.network });
    } catch (e) {
      refuse("E_TBV_REBUILD", "the materializer at " + c.slice(0, 12) + " refused a pool task", e instanceof Error ? e.message : String(e));
    }
    return taskDirDigest(dest);
  };

  const probes: Probe[] = [];
  for (const p of picks) {
    const rebuilt = materialize(p.commit, p.task, join(o.out, "probe", p.commit.slice(0, 12), p.task));
    if (rebuilt !== p.digest)
      refuse("E_TBV_PROBE", "the probe at " + p.commit.slice(0, 12) + " rebuilt a held-tier task to another digest than its directory's; the rebuild does not reproduce R3's directories, and nothing else was rebuilt", "probe " + p.commit.slice(0, 12) + " " + p.task + ": rebuilt " + rebuilt + ", not its directory's " + p.digest);
    probes.push({ commit: p.commit, task: p.task, digest: p.digest, rebuilt, match: true });
  }

  const tasks: TaskRow[] = [];
  for (const g of [...groups.values()].sort((a, b) => byBytes(a[0]!.commit, b[0]!.commit) || byBytes(a[0]!.task, b[0]!.task))) {
    const { commit, task } = g[0]!;
    const recorded = [...new Set(g.map((s) => s.recorded!))].sort(byBytes);
    if (!pinned.get(commit)!.pool.has(task)) {
      tasks.push({ commit, task, recorded, rebuilt: null, status: "dropped", reason: "not_in_pool" });
      for (const s of g) rows.push({ ...s, status: "dropped", reason: "not_in_pool" });
      continue;
    }
    const dir = join(o.out, commit.slice(0, 12), task);
    const rebuilt = materialize(commit, task, dir);
    if (!recorded.includes(rebuilt)) {
      rmSync(dir, { recursive: true });
      tasks.push({ commit, task, recorded, rebuilt, status: "dropped", reason: "digest_mismatch" });
    } else tasks.push({ commit, task, recorded, rebuilt, status: "kept", dir });
    for (const s of g) rows.push(s.recorded === rebuilt ? { ...s, status: "kept", task_dir: dir } : { ...s, status: "dropped", reason: "digest_mismatch" });
  }
  rows.sort((a, b) => byBytes(a.bundle, b.bundle) || byBytes(a.trial, b.trial));

  const count = (xs: { status: string; reason?: string }[], status: string, reason?: string) => xs.filter((x) => x.status === status && (reason === undefined || x.reason === reason)).length;
  const tier = rows.filter((r) => r.status !== "held" && r.reason !== "no_lock_digest");
  const heldRows = rows.filter((r) => r.status === "held");
  const counts = {
    none_arm: rows.length,
    other_arm: other,
    no_lock_digest: count(rows, "dropped", "no_lock_digest"),
    held_sessions: heldRows.length,
    held_tasks: new Set(heldRows.map((r) => r.task)).size,
    rebuild_sessions: tier.length,
    rebuild_tasks: tasks.length,
    tasks_kept: count(tasks, "kept"),
    tasks_digest_mismatch: count(tasks, "dropped", "digest_mismatch"),
    tasks_not_in_pool: count(tasks, "dropped", "not_in_pool"),
    sessions_kept: count(tier, "kept"),
    sessions_digest_mismatch: count(tier, "dropped", "digest_mismatch"),
    sessions_not_in_pool: count(tier, "dropped", "not_in_pool"),
  };
  const record: RebuildRecord = {
    schema: "tbv-rebuild-a.v1",
    pins: { ...pins, bundles: Object.fromEntries(names.map((b) => [b, pins.bundles[b]!])), files: Object.fromEntries([...pinned].map(([c, p]) => [c, p.files])) },
    probes,
    tasks,
    sessions: rows,
    counts,
  };
  writeFileSync(join(o.out, "rebuild.json"), JSON.stringify(record, null, 2) + "\n");

  io.out("rebuild-a: harbor " + pins.harbor + ", " + pins.dataset.name + " " + pins.dataset.version + ", pool sha256 " + pins.pool + ", network " + pins.network);
  for (const c of commits) io.out("rebuild-a: commit " + c + " for " + names.filter((b) => pins.bundles[b] === c).join(", "));
  for (const p of probes) io.out("rebuild-a: probe " + p.commit.slice(0, 12) + " matched: a held-tier task rebuilt to its directory's digest");
  io.out("rebuild-a: sessions " + counts.none_arm + " none-arm, " + counts.other_arm + " other-arm skipped, " + counts.no_lock_digest + " dropped with no lock digest");
  io.out("rebuild-a: held tier " + counts.held_sessions + " sessions on " + counts.held_tasks + " tasks, not rebuilt");
  io.out("rebuild-a: rebuild tier " + counts.rebuild_sessions + " sessions on " + counts.rebuild_tasks + " tasks");
  io.out("rebuild-a: tasks kept " + counts.tasks_kept + ", dropped " + (counts.tasks_digest_mismatch + counts.tasks_not_in_pool) + " (digest_mismatch " + counts.tasks_digest_mismatch + ", not_in_pool " + counts.tasks_not_in_pool + ")");
  io.out("rebuild-a: sessions kept " + counts.sessions_kept + ", dropped " + (counts.sessions_digest_mismatch + counts.sessions_not_in_pool) + " (digest_mismatch " + counts.sessions_digest_mismatch + ", not_in_pool " + counts.sessions_not_in_pool + ")");
  io.out("rebuild-a: record " + join(o.out, "rebuild.json"));
  return record;
}

/** rebuild-a --bundle NAME=DIR [--bundle NAME=DIR]... [--held-tier DIR]... --export DIR --out DIR */
export async function run(argv: string[], io: Io): Promise<number> {
  const single: Record<string, string> = {};
  const bundles: Record<string, string> = {};
  const heldTier: string[] = [];
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 2) {
    const [k, v] = [rest[i]!, rest[i + 1]];
    if (v === undefined || !["--bundle", "--held-tier", "--export", "--out"].includes(k)) fail("E_USAGE", "unknown flag or missing value: " + k + "; flags are --bundle NAME=DIR --held-tier DIR --export DIR --out DIR");
    if (k === "--held-tier") heldTier.push(v!);
    else if (k === "--bundle") {
      const at = v!.indexOf("=");
      if (at < 1) fail("E_USAGE", "--bundle takes NAME=DIR, got " + JSON.stringify(v));
      const name = v!.slice(0, at);
      if (name in bundles) fail("E_USAGE", "bundle " + name + " is named twice");
      bundles[name] = v!.slice(at + 1);
    } else if (k in single) fail("E_USAGE", k + " is given twice");
    else single[k] = v!;
  }
  if (!single["--export"] || !single["--out"] || !Object.keys(bundles).length) fail("E_USAGE", "rebuild-a needs --export, --out and at least one --bundle");
  await rebuildA({ repo: REPO, export: single["--export"]!, heldTier, bundles, out: single["--out"]! }, io);
  return 0;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// tbv rebuild-a (amendment 1 sections 1 and 5) on fixtures only. A fixture repo commits quick/laneb's materializer as the
// pinned R3 commits hold it, beside fixture runtime layers and a fixture pool; a fixture export, held-tier directories and
// bundles of synthetic trials drive the probe and the digest gate in both directions, the counts and every refusal. The
// last tests check that the real pins are the merged posts' pins and load from this checkout's history. No real task.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../lanes/tbv/cli.ts";
import { TbvError } from "../../lanes/tbv/errors.ts";
import { PINNED_FILES, PINS, rebuildA, type Pins, type RebuildOptions } from "../../lanes/tbv/history/rebuild.ts";
import { taskDirDigest } from "../../lanes/tbv/history/source-a.ts";

const ROOT = join(import.meta.dir, "../..");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const gitRaw = (cwd: string, ...args: string[]): Buffer => {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { env: ENV });
  if (r.exitCode !== 0) throw new Error("git " + args.join(" ") + " failed: " + r.stderr.toString());
  return Buffer.from(r.stdout);
};
const git = (cwd: string, ...args: string[]) => gitRaw(cwd, ...args).toString().trim();
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const R3A4 = PINS.bundles["opus-r3a4"]!;
const R3B = PINS.bundles["opus-r3b"]!;
const MATERIALIZE = gitRaw(ROOT, "cat-file", "blob", R3A4 + ":" + PINNED_FILES.materialize);
const STAGES = "FROM example/runtime@sha256:" + "2".repeat(64) + " AS runtime\n";
const COPY = "COPY --from=runtime /opt/runtime /opt/runtime\n";
const scratch = mkdtempSync(join(tmpdir(), "tbv-rebuild-m-"));
writeFileSync(join(scratch, "materialize.ts"), MATERIALIZE);
const M = (await import(join(scratch, "materialize.ts"))) as { materializeRebench: (root: string, task: unknown, dest: string, o: object) => unknown };

type Entry = { task_id: string; digest: string; [k: string]: unknown };
function exportTask(root: string, id: string): Entry {
  const d = join(root, id);
  for (const sub of ["environment", "tests", "solution"]) mkdirSync(join(d, sub), { recursive: true });
  writeFileSync(join(d, "instruction.md"), "Make the " + id + " parser keep empty fields.\n");
  writeFileSync(join(d, "task.toml"), '[metadata]\nauthor_name = "fixture"\n\n[agent]\ntimeout_sec = 1800.0\n\n[verifier]\ntimeout_sec = 900.0\n\n[environment]\ncpus = 1\nmemory = \'8G\'\nstorage = \'16G\'\n');
  writeFileSync(join(d, "environment", "Dockerfile"), "FROM example/" + id + ":latest\nWORKDIR /testbed\nRUN pip install -e .\n");
  writeFileSync(join(d, "tests", "test.sh"), "#!/bin/bash\npytest -q tests/test_fields.py\n");
  writeFileSync(join(d, "tests", "config.json"), "{}\n");
  writeFileSync(join(d, "solution", "solve.sh"), "#!/bin/bash\necho solved\n");
  const digest = taskDirDigest(d);
  return { task_id: id, created: "2026-01", repo: "example/" + id, hub_ref: digest, digest, digest_files: 6, image: "example/" + id + ":latest", image_digest: "sha256:" + "1".repeat(64) };
}

/** A fixture commit holding the four pinned files; null leaves one out. Returns the commit and the pool's bytes. */
function commitPins(repo: string, pool: object, over: Partial<Record<keyof typeof PINNED_FILES, string | null>> = {}) {
  if (!existsSync(join(repo, ".git"))) git(repo, "init", "-q");
  const text = JSON.stringify(pool, null, 1) + "\n";
  const files: Record<keyof typeof PINNED_FILES, string | Buffer> = { materialize: MATERIALIZE, stages: STAGES, copy: COPY, pool: text };
  for (const k of Object.keys(PINNED_FILES) as (keyof typeof PINNED_FILES)[]) {
    const p = join(repo, PINNED_FILES[k]);
    rmSync(p, { force: true });
    if (over[k] === null) continue;
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, over[k] ?? files[k]);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", "fixture pins");
  return { commit: git(repo, "rev-parse", "HEAD"), poolSha: sha(over.pool ?? text) };
}

function trial(bundle: string, job: string, task: string, id: string, digest: string | null, kwargs: object = { arm: "none" }) {
  const d = join(bundle, "jobs", job, task + "__" + id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "result.json"), JSON.stringify({ task_name: task, trial_name: task + "__" + id, config: { agent: { kwargs } } }));
  if (digest !== null) writeFileSync(join(d, "lock.json"), JSON.stringify({ task: { digest } }));
}

const H = "acme__parser-101", K = "acme__parser-102", X = "acme__parser-103", S = "acme__parser-104", P = "acme__parser-105", N = "acme__parser-106";
/**
 * The fixture world. The held tier holds H as R3 materialized it. R3 recorded K at the allowlist rebuild's digest, X at a
 * public-network digest (a mismatch), S once each way, P is not in the pool and N has no lock.json. A told trial on K is
 * skipped, and H's opus trial appears twice in its bundle.
 */
function world(o: { heldNetwork?: "allowlist" | "public" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "tbv-rebuild-"));
  const exp = join(root, "export");
  const entries = [H, K, X, S].map((id) => exportTask(exp, id));
  const pool = { dataset: { name: PINS.dataset.name, version: PINS.dataset.version, harbor_commit: PINS.harbor }, tasks: entries };
  const repo = join(root, "repo");
  mkdirSync(repo);
  const { commit, poolSha } = commitPins(repo, pool);
  const ran = (id: string, network: string) => {
    const d = join(root, "ran", network, id);
    M.materializeRebench(exp, entries.find((e) => e.task_id === id), d, { runtimeStages: STAGES, runtimeCopy: COPY, network });
    return { dir: d, digest: taskDirDigest(d) };
  };
  const allow = Object.fromEntries([H, K, X, S].map((id) => [id, ran(id, "allowlist").digest]));
  const pub = Object.fromEntries([H, K, X, S].map((id) => [id, ran(id, "public").digest]));
  const heldNet = o.heldNetwork ?? "allowlist";
  const held = join(root, "held");
  cpSync(join(root, "ran", heldNet, H), join(held, H), { recursive: true });
  const heldDigest = heldNet === "allowlist" ? allow[H]! : pub[H]!;
  const opus = join(root, "bundles", "opus-r3a4"), sol = join(root, "bundles", "sol-r3a4");
  mkdirSync(join(opus, "jobs", "screen-a"), { recursive: true });
  writeFileSync(join(opus, "jobs", "screen-a", "result.json"), JSON.stringify({ id: "screen-a", stats: {} }));
  trial(opus, "screen-a", H, "a1", heldDigest);
  trial(join(opus, "pulled"), "screen-a", H, "a1", heldDigest);
  trial(opus, "screen-a", K, "a1", allow[K]!);
  trial(opus, "screen-a", X, "a1", pub[X]!);
  trial(opus, "screen-a", S, "a1", allow[S]!);
  trial(opus, "screen-b", P, "a1", "sha256:" + "9".repeat(64));
  trial(opus, "screen-b", N, "a1", null);
  trial(opus, "pilot", K, "t1", allow[K]!, { arm: "gstack", told_skill: "investigate" });
  trial(sol, "screen-a", H, "b1", heldDigest);
  trial(sol, "screen-a", K, "b1", allow[K]!);
  trial(sol, "screen-b", S, "b1", pub[S]!);
  const pins: Pins = { ...PINS, pool: poolSha, bundles: { ...PINS.bundles, "opus-r3a4": commit, "sol-r3a4": commit } };
  const opts: RebuildOptions = { repo, export: exp, heldTier: [held], bundles: { "opus-r3a4": opus, "sol-r3a4": sol }, out: join(root, "out") };
  return { root, repo, exp, pool, pins, opts, commit, allow, pub, heldDigest };
}

const capture = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};
async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof TbvError) return e.code + " " + e.message;
    throw e;
  }
  return "no refusal";
}

test("the probe matches, then the digest gate keeps a rebuilt task only at its recorded digest and drops the rest with the reason", async () => {
  const w = world();
  const c = capture();
  const rec = await rebuildA(w.opts, c.io, w.pins);
  const c12 = w.commit.slice(0, 12);
  expect(rec.probes).toEqual([{ commit: w.commit, task: H, digest: w.allow[H]!, rebuilt: w.allow[H]!, match: true }]);
  const t = Object.fromEntries(rec.tasks.map((r) => [r.task, r]));
  expect(Object.keys(t).sort()).toEqual([K, X, S, P]);
  expect(t[K]).toMatchObject({ commit: w.commit, status: "kept", rebuilt: w.allow[K], recorded: [w.allow[K]], dir: join(w.opts.out, c12, K) });
  expect(taskDirDigest(join(w.opts.out, c12, K))).toBe(w.allow[K]!);
  expect(t[X]).toMatchObject({ status: "dropped", reason: "digest_mismatch", rebuilt: w.allow[X], recorded: [w.pub[X]] });
  expect(existsSync(join(w.opts.out, c12, X))).toBe(false);
  expect(t[S]).toMatchObject({ status: "kept", rebuilt: w.allow[S], recorded: [w.allow[S], w.pub[S]].sort() });
  expect(t[P]).toMatchObject({ status: "dropped", reason: "not_in_pool", rebuilt: null });
  expect(existsSync(join(w.opts.out, c12, P))).toBe(false);
  expect(existsSync(join(w.opts.out, c12, H))).toBe(false);
  const s = rec.sessions.map((r) => [r.bundle, r.trial, r.status, r.reason ?? r.task_dir]);
  expect(s).toEqual([
    ["opus-r3a4", H + "__a1", "held", join(w.opts.heldTier[0]!, H)],
    ["opus-r3a4", K + "__a1", "kept", join(w.opts.out, c12, K)],
    ["opus-r3a4", X + "__a1", "dropped", "digest_mismatch"],
    ["opus-r3a4", S + "__a1", "kept", join(w.opts.out, c12, S)],
    ["opus-r3a4", P + "__a1", "dropped", "not_in_pool"],
    ["opus-r3a4", N + "__a1", "dropped", "no_lock_digest"],
    ["sol-r3a4", H + "__b1", "held", join(w.opts.heldTier[0]!, H)],
    ["sol-r3a4", K + "__b1", "kept", join(w.opts.out, c12, K)],
    ["sol-r3a4", S + "__b1", "dropped", "digest_mismatch"],
  ]);
  expect(JSON.parse(readFileSync(join(w.opts.out, "rebuild.json"), "utf8"))).toEqual(JSON.parse(JSON.stringify(rec)));
});

test("the counts output: pins, the probe, sessions by tier, tasks and sessions kept and dropped by reason; no task id", async () => {
  const w = world();
  const c = capture();
  await rebuildA(w.opts, c.io, w.pins);
  expect(c.out).toEqual([
    "rebuild-a: harbor " + PINS.harbor + ", " + PINS.dataset.name + " " + PINS.dataset.version + ", pool sha256 " + w.pins.pool + ", network " + PINS.network,
    "rebuild-a: commit " + w.commit + " for opus-r3a4, sol-r3a4",
    "rebuild-a: probe " + w.commit.slice(0, 12) + " matched: a held-tier task rebuilt to its directory's digest",
    "rebuild-a: sessions 9 none-arm, 1 other-arm skipped, 1 dropped with no lock digest",
    "rebuild-a: held tier 2 sessions on 1 tasks, not rebuilt",
    "rebuild-a: rebuild tier 6 sessions on 4 tasks",
    "rebuild-a: tasks kept 2, dropped 2 (digest_mismatch 1, not_in_pool 1)",
    "rebuild-a: sessions kept 3, dropped 3 (digest_mismatch 2, not_in_pool 1)",
    "rebuild-a: record " + join(w.opts.out, "rebuild.json"),
  ]);
  for (const id of [H, K, X, S, P, N]) expect(c.out.join("\n")).not.toContain(id);
  expect(c.err).toEqual([]);
});

test("a probe that rebuilds a held-tier task away from its digest refuses before any other rebuild", async () => {
  const w = world({ heldNetwork: "public" });
  const msg = await refusal(() => rebuildA(w.opts, capture().io, w.pins));
  expect(msg).toStartWith("E_TBV_PROBE ");
  expect(msg).not.toContain(w.pub[H]!.replace(/^sha256:/, ""));
  expect(msg).not.toContain(w.allow[H]!.replace(/^sha256:/, ""));
  expect(readFileSync(join(w.opts.out, "refusal.txt"), "utf8")).toContain(w.allow[H]! + ", not its directory's " + w.pub[H]!);
  expect(existsSync(join(w.opts.out, w.commit.slice(0, 12)))).toBe(false);
  expect(existsSync(join(w.opts.out, "rebuild.json"))).toBe(false);
});

test("the probe needs a held-tier session at every commit the rebuild tier uses", async () => {
  const none = world();
  expect(await refusal(() => rebuildA({ ...none.opts, heldTier: [] }, capture().io, none.pins))).toStartWith("E_TBV_PROBE ");
  expect(existsSync(join(none.opts.out, none.commit.slice(0, 12)))).toBe(false);
  const w = world();
  const second = commitPins(w.repo, w.pool).commit;
  const r3b = join(w.root, "bundles", "opus-r3b");
  trial(r3b, "grid-1", K, "g1", w.allow[K]!);
  const msg = await refusal(() => rebuildA({ ...w.opts, bundles: { ...w.opts.bundles, "opus-r3b": r3b } }, capture().io, { ...w.pins, bundles: { ...w.pins.bundles, "opus-r3b": second } }));
  expect(msg).toStartWith("E_TBV_PROBE ");
  expect(msg).toContain(second.slice(0, 12));
  expect(existsSync(join(w.opts.out, w.commit.slice(0, 12)))).toBe(false);
});

test("a missing pin refuses: an unpinned bundle, a commit the checkout lacks, a pinned file missing, a pool off its pins, an export off the pool", async () => {
  const code = async (mutate: (w: ReturnType<typeof world>) => { opts?: RebuildOptions; pins?: Pins }) => {
    const w = world();
    const m = mutate(w);
    const msg = await refusal(() => rebuildA(m.opts ?? w.opts, capture().io, m.pins ?? w.pins));
    expect(existsSync(join(w.opts.out, w.commit.slice(0, 12)))).toBe(false);
    return msg.split(" ")[0];
  };
  expect(await code((w) => ({ opts: { ...w.opts, bundles: { ...w.opts.bundles, "opus-r3x": w.opts.bundles["opus-r3a4"]! } } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, bundles: { ...w.pins.bundles, "sol-r3a4": "0".repeat(40) } } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, bundles: { ...w.pins.bundles, "sol-r3a4": commitPins(w.repo, w.pool, { copy: null }).commit } } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, bundles: { ...w.pins.bundles, "sol-r3a4": commitPins(w.repo, w.pool, { materialize: null }).commit } } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, pool: "0".repeat(64) } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, dataset: { ...w.pins.dataset, version: "sha256:" + "0".repeat(64) } } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ pins: { ...w.pins, harbor: "0".repeat(40) } }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => (rmSync(join(w.exp, S), { recursive: true }), {}))).toBe("E_TBV_REBUILD");
  expect(await code((w) => (writeFileSync(join(w.exp, S, "instruction.md"), "edited\n"), {}))).toBe("E_TBV_REBUILD");
  expect(await code((w) => (rmSync(join(w.exp, H), { recursive: true }), {}))).toBe("E_TBV_REBUILD");
});

test("a missing or misplaced input refuses before anything is rebuilt", async () => {
  const code = async (mutate: (w: ReturnType<typeof world>) => RebuildOptions | void) => {
    const w = world();
    const o = mutate(w) ?? w.opts;
    const msg = await refusal(() => rebuildA(o, capture().io, w.pins));
    expect(existsSync(join(o.out, w.commit.slice(0, 12)))).toBe(false);
    return msg.split(" ")[0];
  };
  expect(await code((w) => ({ ...w.opts, export: join(w.root, "no-export") }))).toBe("E_TBV_INPUT");
  expect(await code((w) => ({ ...w.opts, heldTier: [join(w.root, "no-held")] }))).toBe("E_TBV_INPUT");
  expect(await code((w) => ({ ...w.opts, bundles: { ...w.opts.bundles, "sol-r3a4": join(w.root, "no-bundle") } }))).toBe("E_TBV_INPUT");
  expect(await code((w) => (mkdirSync(w.opts.out), undefined))).toBe("E_TBV_INPUT");
  expect(await code((w) => ({ ...w.opts, out: join(w.repo, "out") }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => ({ ...w.opts, out: join(w.repo, "deeper", "out") }))).toBe("E_TBV_REBUILD");
  expect(await code((w) => (writeFileSync(join(w.opts.bundles["sol-r3a4"]!, "jobs", "screen-a", K + "__b1", "result.json"), "{not json"), undefined))).toBe("E_TBV_INPUT");
  expect(await code((w) => (writeFileSync(join(w.opts.bundles["opus-r3a4"]!, "pulled", "jobs", "screen-a", H + "__a1", "lock.json"), JSON.stringify({ task: { digest: w.pub[H] } })), undefined))).toBe("E_TBV_INPUT");
});

test("the command line: flags, the cli row, and refusals print their code", async () => {
  const w = world();
  const c = capture();
  expect(await main(["rebuild-a", "--export", w.exp, "--bundle", "opus-r3a4=" + w.opts.bundles["opus-r3a4"]], c.io)).toBe(2);
  expect(c.err.join("\n")).toStartWith("E_USAGE ");
  for (const argv of [["--out", w.opts.out, "--export", w.exp], ["--out", w.opts.out, "--export", w.exp, "--bundle", "opus-r3a4"], ["--out", w.opts.out, "--export", w.exp, "--bundle", "opus-r3a4=" + w.root, "--bundle", "opus-r3a4=" + w.root], ["--out", w.opts.out, "--export", w.exp, "--bundle", "opus-r3a4=" + w.root, "--probe", "x"]]) {
    const e = capture();
    expect(await main(["rebuild-a", ...argv], e.io)).toBe(2);
    expect(e.err.join("\n")).toStartWith("E_USAGE ");
  }
  const u = capture();
  expect(await main(["rebuild-a", "--out", w.opts.out, "--export", w.exp, "--bundle", "opus-r3x=" + w.root], u.io)).toBe(2);
  expect(u.err.join("\n")).toStartWith("E_TBV_REBUILD ");
  const help = capture();
  await main(["--help"], help.io);
  expect(help.out.join("\n")).toContain("rebuild-a");
});

test("the real pins are the merged posts' pins, and the pinned code materializes with the allowlist network", () => {
  const post = (p: string) => readFileSync(join(ROOT, "wiki", p), "utf8");
  const a4 = post("plans/2026-11-03-geva-247-r3-amendment-4/README.md");
  expect(a4).toContain("What the pinned Harbor (" + PINS.harbor + ")");
  expect(a4).toContain("Hub package " + PINS.dataset.name + ", version " + PINS.dataset.version);
  expect(a4).toContain("sha256 " + PINS.pool + ", pinned in materialize.ts");
  expect(a4).toContain("The pin is **" + R3A4 + "**");
  expect(post("board/2026-11-04-geva-263-r3a4-admission-results.md")).toContain("Harness pinned at " + R3A4);
  expect(post("plans/2026-11-04-geva-273-r3b-pin/README.md")).toContain("**Build commit:** " + R3B);
  expect(post("board/2026-11-04-geva-283-r3b-results.md")).toContain("Build " + R3B);
  expect(PINS.bundles).toEqual({ "opus-r3a4": R3A4, "sol-r3a4": R3A4, "opus-r3b": R3B, "sol-r3b": R3B });
  for (const c of [R3A4, R3B]) expect(git(ROOT, "cat-file", "blob", c + ":quick/laneb/runner/prepare-run.ts")).toContain('const network = (process.env.NETWORK ?? "allowlist")');
  expect(PINS.network).toBe("allowlist");
});

test("the real pins load from this checkout's history: both commits hold the four files and the pool at its pins", async () => {
  const root = mkdtempSync(join(tmpdir(), "tbv-rebuild-real-"));
  for (const d of ["export", "r3a4", "r3b"]) mkdirSync(join(root, d));
  const c = capture();
  expect(await main(["rebuild-a", "--bundle", "opus-r3a4=" + join(root, "r3a4"), "--bundle", "sol-r3b=" + join(root, "r3b"), "--export", join(root, "export"), "--out", join(root, "out")], c.io)).toBe(0);
  expect(c.err).toEqual([]);
  expect(c.out).toContain("rebuild-a: commit " + R3A4 + " for opus-r3a4");
  expect(c.out).toContain("rebuild-a: commit " + R3B + " for sol-r3b");
  expect(c.out).toContain("rebuild-a: sessions 0 none-arm, 0 other-arm skipped, 0 dropped with no lock digest");
  const rec = JSON.parse(readFileSync(join(root, "out", "rebuild.json"), "utf8"));
  for (const c of [R3A4, R3B]) {
    expect(rec.pins.files[c][PINNED_FILES.pool]).toBe(PINS.pool);
    for (const p of Object.values(PINNED_FILES)) expect(rec.pins.files[c][p]).toBe(sha(gitRaw(ROOT, "cat-file", "blob", c + ":" + p)));
  }
});

test("stdout prints no task directory digest, since a digest of a rebuilt public task names that task", async () => {
  const w = world();
  const c = capture();
  await rebuildA(w.opts, c.io, w.pins);
  const text = c.out.join("\n");
  for (const d of [...Object.values(w.allow), ...Object.values(w.pub)]) expect(text).not.toContain(d.replace(/^sha256:/, ""));
});

test("an other-arm trial copied under pulled/ counts once", async () => {
  const w = world();
  trial(join(w.opts.bundles["opus-r3a4"]!, "pulled"), "pilot", K, "t1", w.allow[K]!, { arm: "gstack", told_skill: "investigate" });
  const c = capture();
  const rec = await rebuildA(w.opts, c.io, w.pins);
  expect(rec.counts.other_arm).toBe(1);
  expect(c.out).toContain("rebuild-a: sessions 9 none-arm, 1 other-arm skipped, 1 dropped with no lock digest");
});

test("a pool task the pinned materializer refuses stops with E_TBV_REBUILD, leaving the probe and earlier rebuilds in --out and no rebuild.json", async () => {
  const w = world();
  const toml = join(w.exp, S, "task.toml");
  writeFileSync(toml, readFileSync(toml, "utf8").replace("[agent]\ntimeout_sec = 1800.0\n", ""));
  const pool = { ...w.pool, tasks: w.pool.tasks.map((t) => (t.task_id === S ? { ...t, digest: taskDirDigest(join(w.exp, S)) } : t)) };
  const { commit, poolSha } = commitPins(w.repo, pool);
  const pins: Pins = { ...w.pins, pool: poolSha, bundles: { ...w.pins.bundles, "opus-r3a4": commit, "sol-r3a4": commit } };
  const msg = await refusal(() => rebuildA(w.opts, capture().io, pins));
  expect(msg).toStartWith("E_TBV_REBUILD the materializer at " + commit.slice(0, 12) + " refused a pool task");
  expect(msg).not.toContain(S);
  expect(readFileSync(join(w.opts.out, "refusal.txt"), "utf8")).toContain(S + ": task.toml has no [agent] or [verifier] timeout_sec");
  expect(existsSync(join(w.opts.out, "rebuild.json"))).toBe(false);
  expect(existsSync(join(w.opts.out, "probe", commit.slice(0, 12), H))).toBe(true);
  expect(existsSync(join(w.opts.out, commit.slice(0, 12), K))).toBe(true);
});


test("refusals print no task id: an export off the pool, a result.json that is not JSON, a trial twice with two lock digests", async () => {
  const exp = world();
  rmSync(join(exp.exp, S), { recursive: true });
  const m1 = await refusal(() => rebuildA(exp.opts, capture().io, exp.pins));
  expect(m1).toStartWith("E_TBV_REBUILD ");
  expect(m1).not.toContain(S);
  expect(readFileSync(join(exp.opts.out, "refusal.txt"), "utf8")).toContain(S);
  const bad = world();
  writeFileSync(join(bad.opts.bundles["sol-r3a4"]!, "jobs", "screen-a", K + "__b1", "result.json"), "{not json");
  const m2 = await refusal(() => rebuildA(bad.opts, capture().io, bad.pins));
  expect(m2).toStartWith("E_TBV_INPUT ");
  expect(m2).not.toContain(K);
  const twice = world();
  writeFileSync(join(twice.opts.bundles["opus-r3a4"]!, "pulled", "jobs", "screen-a", H + "__a1", "lock.json"), JSON.stringify({ task: { digest: twice.pub[H] } }));
  const m3 = await refusal(() => rebuildA(twice.opts, capture().io, twice.pins));
  expect(m3).toStartWith("E_TBV_INPUT ");
  expect(m3).not.toContain(H);
});

const REAL_GIT = Bun.which("git")!;
async function withFakeGit(vars: Record<string, string>, fn: () => Promise<string>): Promise<string> {
  const bin = mkdtempSync(join(tmpdir(), "tbv-fake-git-"));
  writeFileSync(join(bin, "git"), '#!/bin/sh\ncase "$*" in *is-inside-work-tree*)\n  [ -n "$TBV_FAKE_GIT_MKDIR" ] && mkdir -p "$TBV_FAKE_GIT_MKDIR"\n  [ -n "$TBV_FAKE_GIT_DUBIOUS" ] && { echo "fatal: detected dubious ownership in repository" >&2; exit 128; } ;;\nesac\nexec ' + REAL_GIT + ' "$@"\n', { mode: 0o755 });
  const saved = { ...process.env };
  Object.assign(process.env, vars, { PATH: bin + ":" + process.env.PATH });
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
    process.env.PATH = saved.PATH;
  }
}

test("the work-tree guard fails closed: an --out under .git, and a git that cannot answer, refuse with E_TBV_REBUILD", async () => {
  const w = world();
  expect(await refusal(() => rebuildA({ ...w.opts, out: join(w.repo, ".git", "out") }, capture().io, w.pins))).toStartWith("E_TBV_REBUILD ");
  const d = world();
  expect(await withFakeGit({ TBV_FAKE_GIT_DUBIOUS: "1" }, () => refusal(() => rebuildA(d.opts, capture().io, d.pins)))).toStartWith("E_TBV_REBUILD ");
  expect(existsSync(d.opts.out)).toBe(false);
});

test("--out is claimed exclusively: a directory made between the existence check and the claim refuses with E_TBV_INPUT", async () => {
  const w = world();
  const msg = await withFakeGit({ TBV_FAKE_GIT_MKDIR: w.opts.out }, () => refusal(() => rebuildA(w.opts, capture().io, w.pins)));
  expect(msg).toStartWith("E_TBV_INPUT ");
  expect(existsSync(join(w.opts.out, "rebuild.json"))).toBe(false);
});


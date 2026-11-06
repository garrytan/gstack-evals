// Copyright (c) 2026 Garry Tan. MIT License.
// tbv split (prereg section 4, amendment 1 section 2, the GEVA-361 pins addendum): the pool, the seeded cluster-major
// draw, key refills with spillover, and the manifests, drive task dirs and sealed split map. plan, next and write each
// replay the whole walk from the seed, the pool and the keys outputs, so no cursor is kept. It prints counts only.
// Held-out outputs sit on tmpfs and are sealed as they are written (custody.ts), and a check refuses any held-out id or
// cluster in the dev outputs.
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { heldOutputs, plaintextRoot } from "./custody.ts";
import { fail, TbvError } from "./errors.ts";
import { admitsSize, extract, OVERHEAD_641D622 } from "./extract.ts";
import { clustersOf, devEligible, heldOutCluster, heldOutEligible, type LineageStub, type PrRecord } from "./history/source-b.ts";
import type { ReasonCode } from "../../src/errors/codes.ts";
import { parseFlags } from "./judge.ts";
import type { Extract, History, Io, Source, SplitManifest, Stratum, TaskRow } from "./types.ts";

/** The scorer pin post's merge (#249, cd4e6d2): dev source B is merged before it (amendment 1 section 2 rule 1). */
export const SCORER_PIN_MERGED_AT = "2026-11-06T14:17:58Z";
const NON_CLEAN = ["long", "short", "other"] as const;
type Slots = Record<(typeof NON_CLEAN)[number], number>;
/** 40/30/30 of 20 and of 50, per source and split (ruling E). */
export const DEV_SLOTS: Slots = { long: 8, short: 6, other: 6 };
export const HELD_SLOTS: Slots = { long: 20, short: 15, other: 15 };
/** Every clean task comes from source B (ruling A1). */
export const DEV_CLEAN_B = 4;
export const HELD_CLEAN_B = 10;
export const PER_CLUSTER = 2;
/** Held-out source B takes every qualifying non-clean task at this many or fewer (amendment 1 section 2 rule 5). */
export const TAKE_ALL_AT = 50;
const HR_PER_SOURCE = 10;
const CONTROLS_PER_SOURCE = 10;

export interface PoolRow {
  source: Source;
  task: string;
  cluster: string;
  stratum: Stratum;
  tokens: number;
  sha256: string;
}
export type Outcome = { kept: true; nfacts: number } | { kept: false };
export type Mode = "b2" | "held-b";
type Split = "dev" | "held";
export interface Taken {
  row: PoolRow;
  split: Split;
  outcome: Outcome | null;
}
export interface Count {
  split: Split;
  source: Source;
  stratum: Stratum;
  slots: number;
  taken: number;
  kept: number;
  dropped: number;
  pending: number;
  open: number;
}
export interface Walked {
  taken: Taken[];
  counts: Count[];
  devClusters: Record<Source, string[]>;
  phase: Split | "done";
  batch: PoolRow[];
}

const sha256 = (t: string | Buffer) => createHash("sha256").update(t).digest("hex");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** HMAC-SHA256 under the seed of source, NUL and the name: a cluster's rank orders clusters, a task's orders a cluster's members. */
export const rank = (seed: Buffer, source: Source, name: string): string => createHmac("sha256", seed).update(source + "\0" + name).digest("hex");

function members(rows: PoolRow[], seed: Buffer): PoolRow[][] {
  const by = new Map<string, PoolRow[]>();
  for (const r of rows) by.set(r.source + "\0" + r.cluster, [...(by.get(r.source + "\0" + r.cluster) ?? []), r]);
  return [...by.values()].map((l) => l.sort((a, b) => cmp(rank(seed, a.source, a.task), rank(seed, b.source, b.task))));
}

/** Up to two tasks per lineage cluster, the first two by task rank: prereg section 4 for source A, ruling D for source B. */
export function capClusters(rows: PoolRow[], seed: Buffer): { rows: PoolRow[]; dropped: number } {
  const kept = members(rows, seed).flatMap((l) => l.slice(0, PER_CLUSTER));
  return { rows: kept, dropped: rows.length - kept.length };
}

/** One source's walk order (ruling C): every cluster's first member in cluster rank, then every cluster's second member. */
export function drawOrder(rows: PoolRow[], seed: Buffer): PoolRow[] {
  const keyed = members(rows, seed).flatMap((l) => l.map((r, pass) => ({ r, pass, c: rank(seed, r.source, r.cluster), t: rank(seed, r.source, r.task) })));
  return keyed.sort((a, b) => a.pass - b.pass || cmp(a.c, b.c) || cmp(a.t, b.t)).map((k) => k.r);
}

/** The walk. Each stratum takes tasks in draw order until its slots are covered by kept or pending keys; a dropped key
 * reopens its slot. A stratum whose queue runs dry passes its open slots on, long to short and short to other. Dev fills
 * first, A and B together; held-out source A walks only once no dev key is pending, and never takes a cluster any dev
 * task touched. Held-out source B (mode held-b) takes every qualifying task at 50 or fewer, 20/15/15 above, and 10 clean. */
export function walk(o: { rows: PoolRow[]; seed: Buffer; outcomes: Map<string, Outcome>; mode: Mode }): Walked {
  const taken: Taken[] = [];
  const counts: Count[] = [];
  const fill = (split: Split, source: Source, queue: PoolRow[], slots: Slots, clean: number, blocked: Set<string>) => {
    const one = (stratum: Stratum, want: number) => {
      const c: Count = { split, source, stratum, slots: want, taken: 0, kept: 0, dropped: 0, pending: 0, open: 0 };
      let covered = 0;
      for (const r of queue) {
        if (covered >= want) break;
        if (r.stratum !== stratum || blocked.has(r.cluster)) continue;
        const outcome = o.outcomes.get(r.task) ?? null;
        taken.push({ row: r, split, outcome });
        c.taken++;
        if (outcome && !outcome.kept) {
          c.dropped++;
          continue;
        }
        if (outcome) c.kept++;
        else c.pending++;
        covered++;
      }
      c.open = want - covered;
      counts.push(c);
      return c.open;
    };
    let carry = 0;
    for (const s of NON_CLEAN) carry = one(s, slots[s] + carry);
    one("clean", clean);
  };
  const A = drawOrder(o.rows.filter((r) => r.source === "A"), o.seed);
  const B = drawOrder(o.rows.filter((r) => r.source === "B"), o.seed);
  const pending = (split: Split) => taken.filter((t) => t.split === split && t.outcome === null).map((t) => t.row);
  const devClusters: Record<Source, string[]> = { A: [], B: [] };
  if (o.mode === "held-b") {
    const n = (s: Stratum) => B.filter((r) => r.stratum === s).length;
    const all = n("long") + n("short") + n("other") <= TAKE_ALL_AT;
    fill("held", "B", B, all ? { long: n("long"), short: n("short"), other: n("other") } : HELD_SLOTS, HELD_CLEAN_B, new Set());
    const batch = pending("held");
    return { taken, counts, devClusters, phase: batch.length ? "held" : "done", batch };
  }
  fill("dev", "A", A, DEV_SLOTS, 0, new Set());
  fill("dev", "B", B, DEV_SLOTS, DEV_CLEAN_B, new Set());
  for (const s of ["A", "B"] as const) devClusters[s] = [...new Set(taken.filter((t) => t.split === "dev" && t.row.source === s).map((t) => t.row.cluster))].sort();
  const dev = pending("dev");
  if (dev.length) return { taken, counts, devClusters, phase: "dev", batch: dev };
  fill("held", "A", A, HELD_SLOTS, 0, new Set(devClusters.A));
  const held = pending("held");
  return { taken, counts, devClusters, phase: held.length ? "held" : "done", batch: held };
}

/** The one manifest-row serializer: rule.ts compares a readings file's rows with the manifest's byte for byte. */
export const taskRow = (r: PoolRow, nfacts: number): TaskRow => ({ id: r.task, cluster: r.cluster, source: r.source, stratum: r.stratum, nfacts });

/** Refuses dev rows that name any id or cluster outside dev (held-out or undrawn), without naming it (ruling H1). */
export function guardDev(rows: Array<{ id: string; cluster: string }>, forbidden: { ids: Set<string>; clusters: Set<string> }): void {
  const hits = rows.filter((r) => [r.id, r.cluster].some((v) => forbidden.ids.has(v) || forbidden.clusters.has(v))).length;
  if (hits) fail("E_TBV_CUSTODY", hits + " dev row(s) name a task id or cluster that is not dev's; nothing was written; bring this to the Captain");
}

/** Lineage clusters over the mined records and the truncated stubs, as heldOutCluster joins them (ruling J): a stub that
 * shares a key joins its cluster, and a stub with truncated closing issues joins every cluster that holds an issue. A
 * stub with no title or branch could join any cluster, so it refuses. */
export function lineageClusters(prs: PrRecord[], skipped: LineageStub[]): Map<number, string> {
  if (skipped.some((s) => s.title === null || s.baseRefName === null || s.headRefName === null)) fail("E_TBV_INPUT", "a truncated record has no title or branch, so its lineage could join any cluster; bring this to the Captain");
  const all = [...prs, ...skipped];
  const c = clustersOf(all.map((p) => ({ number: p.number, title: p.title!, baseRefName: p.baseRefName!, headRefName: p.headRefName!, closingIssues: p.closingIssues ?? [] })));
  if (!skipped.some((s) => s.closingIssues === null)) return c;
  const open = new Set(all.filter((p) => p.closingIssues === null || p.closingIssues.length > 0).map((p) => c.get(p.number)!));
  const to = "pr-" + Math.min(...[...open].map((id) => Number(id.slice(3))));
  return new Map([...c].map(([n, id]) => [n, open.has(id) ? to : id]));
}

// ---------- the command ----------

interface Pool {
  seedHex: string;
  seed: Buffer;
  digest: string;
  prsSha: string;
  eligible: PoolRow[];
  rows: PoolRow[];
  byTask: Map<string, PoolRow>;
  drops: Record<string, number>;
  truncated: number;
  histories: Map<string, History>;
  extracts: Map<string, Extract>;
}

const need = (a: Record<string, string>, k: string): string => a[k] ?? fail("E_TBV_INPUT", "--" + k + " is required here");
const onTmpfs = (dir: string, what: string) => {
  try {
    plaintextRoot(dir, { devPlaintext: false, held: true });
  } catch (e) {
    fail("E_TBV_CUSTODY", what + " must sit on tmpfs: " + (e as Error).message);
  }
};
/** A held-out write keeps a refusal's code and drops its message, which can name a held-out file (ruling H1). */
const heldWrite = (write: () => void) => {
  try {
    write();
  } catch (e) {
    fail(e instanceof TbvError ? e.code : "E_TBV_CUSTODY", "a held-out write stopped, and its message can name a held-out task, so split withholds it; check that --held is a fresh directory, that the held-out outputs sit on tmpfs with room, and that --seal-cmd runs");
  }
};
function readJson(path: string, what: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail("E_TBV_INPUT", "a file in " + what + " is missing or not JSON");
  }
}
const fresh = (dir: string, flag: string) => {
  if (existsSync(dir) && readdirSync(dir).length) fail("E_TBV_INPUT", "--" + flag + " is not empty; write into a new directory");
};

function readHistories(dir: string, source: Source, flag: string): History[] {
  if (!existsSync(dir)) fail("E_TBV_INPUT", "--" + flag + " is missing");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const h = readJson(join(dir, f), "--" + flag) as History;
    if (h?.schema !== "tbv-history.v1" || h.source !== source) fail("E_TBV_INPUT", "a file in --" + flag + " is not a source " + source + " tbv-history.v1 history");
    return h;
  });
}

function readSeed(file: string): string {
  onTmpfs(dirname(file), "--seed-file (the seed is held-out membership until stage 3 reveals it)");
  if (!existsSync(file)) fail("E_TBV_INPUT", "--seed-file is missing");
  const hex = readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) fail("E_TBV_INPUT", "--seed-file must hold 64 lowercase hex characters (32 bytes from /dev/urandom)");
  return hex;
}

function loadPool(a: Record<string, string>, mode: Mode): Pool {
  const seedHex = readSeed(need(a, "seed-file"));
  const seed = Buffer.from(seedHex, "hex");
  const prsPath = need(a, "prs");
  if (!existsSync(prsPath)) fail("E_TBV_INPUT", "--prs is missing");
  const prsText = readFileSync(prsPath, "utf8");
  const file = readJson(prsPath, "--prs");
  if (file?.schema !== "tbv-prs.v1" || !Array.isArray(file.prs)) fail("E_TBV_INPUT", "--prs is not a tbv-prs.v1 record file");
  const prs = file.prs as PrRecord[];
  const skipped = (file.skipped ?? []) as LineageStub[];
  const clusters = lineageClusters(prs, skipped);
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const drops: Record<string, number> = {};
  const drop = (why: string) => {
    drops[why] = (drops[why] ?? 0) + 1;
  };
  const eligible: PoolRow[] = [];
  const histories = new Map<string, History>();
  const extracts = new Map<string, Extract>();
  const add = (h: History, cluster: string, overhead: number) => {
    let x: Extract;
    try {
      x = extract(h);
    } catch (e) {
      return fail((e as { code?: ReasonCode }).code ?? "E_TBV_INPUT", "the extractor refused a source " + h.source + " history; its message names the task, so split withholds it");
    }
    if (x.stratum === "none") return drop("stratum none");
    if (!admitsSize(x.tokens, overhead)) return drop("size");
    if (h.source === "A" && x.stratum === "clean") return drop("source A clean");
    if (histories.has(h.task)) fail("E_TBV_INPUT", "two histories share one task id; task ids must be unique across sources");
    histories.set(h.task, { ...h, cluster });
    extracts.set(h.task, x);
    eligible.push({ source: h.source, task: h.task, cluster, stratum: x.stratum, tokens: x.tokens, sha256: h.sha256 });
  };
  if (mode === "b2") {
    onTmpfs(need(a, "a"), "--a (source A histories hold held-out candidates)");
    for (const h of readHistories(a.a!, "A", "a")) add(h, h.cluster, OVERHEAD_641D622.investigate);
  }
  const pAt = mode === "held-b" ? need(a, "p-merged-at") : "";
  let devClusters = new Set<string>();
  if (mode === "held-b") {
    onTmpfs(need(a, "b"), "--b (held-out source B histories)");
    const dc = readJson(need(a, "dev-clusters"), "--dev-clusters");
    if (dc?.schema !== "tbv-dev-clusters.v1" || !Array.isArray(dc.B)) fail("E_TBV_INPUT", "--dev-clusters is not a tbv-dev-clusters.v1 file");
    devClusters = new Set(dc.B as string[]);
  }
  for (const h of readHistories(need(a, "b"), "B", "b")) {
    const n = /^pr-(\d+)$/.exec(h.task);
    const pr = (n ? byNumber.get(Number(n[1])) : undefined) ?? fail("E_TBV_INPUT", "a source B history has no record in --prs");
    const ok = mode === "b2" ? devEligible(pr, SCORER_PIN_MERGED_AT) : heldOutEligible(pr, heldOutCluster(pr, prs, skipped), pAt).ok;
    if (!ok) {
      drop(mode === "b2" ? "outside the dev window" : "not held-out eligible");
      continue;
    }
    const cluster = clusters.get(pr.number)!;
    if (devClusters.has(cluster)) fail("E_TBV_CUSTODY", "a held-out source B task's cluster is in --dev-clusters; bring this to the Captain");
    add(h, cluster, OVERHEAD_641D622.ship);
  }
  const prsSha = sha256(prsText);
  const sorted = [...eligible].sort((x, y) => cmp(x.source + "\0" + x.task, y.source + "\0" + y.task));
  const digest = sha256(JSON.stringify({ schema: "tbv-pool.v1", mode, seed: sha256(seedHex), prs: prsSha, rows: sorted.map((r) => [r.source, r.task, r.cluster, r.stratum, r.tokens, r.sha256]) }));
  const cap = capClusters(eligible, seed);
  if (cap.dropped) drops["cluster cap"] = cap.dropped;
  return { seedHex, seed, digest, prsSha, eligible, rows: cap.rows, byTask: new Map(cap.rows.map((r) => [r.task, r])), drops, truncated: skipped.length, histories, extracts };
}

/** The keys outputs under parent, one keys --out directory per round: <task>.json kept, drops.json dropped. */
function readOutcomes(parent: string | undefined, pool: Pool, flag: string, held: boolean): Map<string, Outcome> {
  const out = new Map<string, Outcome>();
  if (parent === undefined) return out;
  if (held) onTmpfs(parent, "--" + flag);
  if (!existsSync(parent)) fail("E_TBV_INPUT", "--" + flag + " is missing");
  const set = (task: unknown, o: Outcome, sha?: unknown) => {
    const row = typeof task === "string" ? pool.byTask.get(task) : undefined;
    if (!row) return fail("E_TBV_INPUT", "a keys file in --" + flag + " names a task the pool does not hold; the keys come from another pool");
    if (sha !== undefined && sha !== row.sha256) fail("E_TBV_INPUT", "a key in --" + flag + " was written from another history than the pool's");
    if (out.has(row.task)) fail("E_TBV_INPUT", "a task has two outcomes in --" + flag + "; each task is keyed once");
    out.set(row.task, o);
  };
  for (const d of readdirSync(parent).sort()) {
    const dir = join(parent, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      const v = readJson(join(dir, f), "--" + flag);
      if (f === "drops.json") {
        if (!Array.isArray(v)) fail("E_TBV_INPUT", "a drops.json in --" + flag + " is not a list");
        for (const x of v) set(x?.task, { kept: false });
      } else {
        if (v?.schema !== "tbv-key.v1" || !Array.isArray(v.facts)) fail("E_TBV_INPUT", "a file in --" + flag + " is not a tbv-key.v1 key");
        set(v.task, { kept: true, nfacts: v.facts.length }, v.history_sha256);
      }
    }
  }
  return out;
}

function replay(a: Record<string, string>, mode: Mode, checkDigest: boolean): { pool: Pool; w: Walked } {
  const pool = loadPool(a, mode);
  if (checkDigest && a["pool-digest"] !== pool.digest) fail("E_TBV_INPUT", "the pool's digest is not --pool-digest; a history, the prs file, the seed or the mode changed since plan");
  if (mode === "held-b" && a["dev-keys"] !== undefined) fail("E_TBV_INPUT", "held-out source B reads --held-keys only");
  const dev = readOutcomes(a["dev-keys"], pool, "dev-keys", false);
  const held = readOutcomes(a["held-keys"], pool, "held-keys", true);
  if ([...held.keys()].some((t) => dev.has(t))) fail("E_TBV_INPUT", "a task has outcomes in both --dev-keys and --held-keys");
  const w = walk({ rows: pool.rows, seed: pool.seed, outcomes: new Map([...dev, ...held]), mode });
  const splitOf = new Map(w.taken.map((t) => [t.row.task, t.split]));
  for (const [m, split, flag] of [[dev, "dev", "dev-keys"], [held, "held", "held-keys"]] as const) {
    if ([...m.keys()].some((t) => splitOf.get(t) !== split)) fail("E_TBV_INPUT", "--" + flag + " holds a key for a task this walk did not take into " + split + "; the seed, pool or keys differ from the run's");
  }
  return { pool, w };
}

/** Every pool id outside dev, and every cluster no dev task touched: names dev outputs must never carry. */
function forbidden(pool: Pool, w: Walked) {
  const dev = w.taken.filter((t) => t.split === "dev");
  const tasks = new Set(dev.map((t) => t.row.task));
  const clusters = new Set(dev.map((t) => t.row.source + "\0" + t.row.cluster));
  const rest = pool.eligible.filter((r) => !tasks.has(r.task));
  return { ids: new Set(rest.map((r) => r.task)), clusters: new Set(rest.filter((r) => !clusters.has(r.source + "\0" + r.cluster)).map((r) => r.cluster)) };
}
const devRows = (w: Walked) => w.taken.filter((t) => t.split === "dev").map((t) => ({ id: t.row.task, cluster: t.row.cluster }));

function writeBatch(dir: string, rows: PoolRow[], pool: Pool, seal?: (file: string) => void) {
  mkdirSync(join(dir, "histories"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "extracts"), { recursive: true, mode: 0o700 });
  for (const r of rows) {
    const h = join(dir, "histories", r.task + ".json");
    writeFileSync(h, JSON.stringify(pool.histories.get(r.task)) + "\n", { mode: 0o600 });
    seal?.(h);
    const x = join(dir, "extracts", r.task + ".extract.json");
    writeFileSync(x, JSON.stringify(pool.extracts.get(r.task)) + "\n", { mode: 0o600 });
    seal?.(x);
  }
}

/** drive's --tasks dirs: source A as investigate, source B as ship and again as capy (drive reads the family from the file). */
function writeTaskDirs(dir: string, rows: PoolRow[], histories: Map<string, History>, seal?: (file: string) => void) {
  for (const f of ["investigate", "ship", "capy"]) mkdirSync(join(dir, f), { recursive: true, mode: 0o700 });
  const put = (path: string, h: History) => {
    writeFileSync(path, JSON.stringify(h) + "\n", { mode: 0o600 });
    seal?.(path);
  };
  for (const r of rows) {
    const h = histories.get(r.task) ?? fail("E_TBV_INPUT", "a drawn task has no history in the input");
    if (r.source === "A") put(join(dir, "investigate", r.task + ".json"), { ...h, cluster: r.cluster, family: "investigate" });
    else {
      put(join(dir, "ship", r.task + ".json"), { ...h, cluster: r.cluster, family: "ship" });
      put(join(dir, "capy", r.task + ".capy.json"), { ...h, cluster: r.cluster, family: "capy" });
    }
  }
}

function report(io: Io, w: Walked) {
  for (const split of ["dev", "held"] as const) {
    for (const s of ["A", "B"] as const) {
      const cs = w.counts.filter((c) => c.split === split && c.source === s);
      if (cs.length) io.out("split " + split + " " + s + ": " + cs.map((c) => c.stratum + " slots " + c.slots + " taken " + c.taken + " kept " + c.kept + " dropped " + c.dropped + " pending " + c.pending + " open " + c.open).join("; "));
    }
  }
}

const FLAGS = ["mode", "seed-file", "a", "b", "prs", "p-merged-at", "dev-clusters", "pool-digest", "dev-keys", "held-keys", "batch", "dev-out", "held-out", "held-a", "held", "seal-cmd"];
const REQUIRED: Record<string, string[]> = {
  plan: ["seed-file", "b", "prs", "batch"],
  next: ["seed-file", "b", "prs", "pool-digest", "batch"],
  write: ["seed-file", "b", "prs", "pool-digest", "held-out", "held", "seal-cmd"],
};
const NOT: Record<string, string[]> = { plan: ["pool-digest", "dev-keys", "held-keys", "dev-out", "held-out", "held-a"], next: ["dev-out", "held-out", "held-a"], write: ["batch"] };

/** tbv split plan|next|write: see lanes/tbv/README.md for the flags of each and the order B2 runs them in. */
export async function run(argv: string[], io: Io): Promise<number> {
  const sub = argv[1] ?? "";
  if (!(sub in REQUIRED)) fail("E_TBV_INPUT", "tbv split takes plan, next or write");
  const a = parseFlags(argv.slice(2), REQUIRED[sub]!, FLAGS.filter((f) => !REQUIRED[sub]!.includes(f) && !NOT[sub]!.includes(f)));
  const mode = (a.mode ?? "b2") as Mode;
  if (mode !== "b2" && mode !== "held-b") fail("E_TBV_INPUT", "--mode is b2 or held-b");
  if (mode === "b2" && (a["p-merged-at"] !== undefined || a["dev-clusters"] !== undefined)) fail("E_TBV_INPUT", "--p-merged-at and --dev-clusters belong to --mode held-b");
  const { pool, w } = replay(a, mode, sub !== "plan");
  if (sub === "plan") {
    io.out("split mode " + mode);
    io.out("split seed sha256 " + sha256(pool.seedHex));
    io.out("split pool digest " + pool.digest);
    io.out("split prs.json sha256 " + pool.prsSha);
    const n = (s: Source, st: Stratum) => pool.rows.filter((r) => r.source === s && r.stratum === st).length;
    io.out("split pool: A long " + n("A", "long") + " short " + n("A", "short") + " other " + n("A", "other") + "; B long " + n("B", "long") + " short " + n("B", "short") + " other " + n("B", "other") + " clean " + n("B", "clean") + "; dropped " + JSON.stringify(pool.drops) + "; truncated records " + pool.truncated);
  }
  report(io, w);
  if (sub === "write") return write(a, mode, pool, w, io);
  if (w.phase === "done") {
    io.out("split: nothing left to key; run split write");
    return 0;
  }
  fresh(a.batch!, "batch");
  if (w.phase === "dev") {
    if (a.held !== undefined || a["seal-cmd"] !== undefined) fail("E_TBV_INPUT", "the next batch is dev, which stays unsealed; drop --held and --seal-cmd");
    guardDev(devRows(w), forbidden(pool, w));
    writeBatch(a.batch!, w.batch, pool);
  } else {
    if (a.held === undefined) fail("E_TBV_CUSTODY", "the next batch is held-out: pass --held and --seal-cmd, with --batch on tmpfs");
    heldWrite(() => writeBatch(a.batch!, w.batch, pool, heldOutputs(a, ["batch"], undefined, w.batch.flatMap((r) => [r.task + ".json", r.task + ".extract.json"]))));
  }
  io.out("split batch " + w.phase + ": " + w.batch.length + " histories (A " + w.batch.filter((r) => r.source === "A").length + ", B " + w.batch.filter((r) => r.source === "B").length + ")");
  return 0;
}

function write(a: Record<string, string>, mode: Mode, pool: Pool, w: Walked, io: Io): number {
  const heldOut = a["held-out"]!;
  fresh(heldOut, "held-out");
  const pos = new Map<string, number>();
  for (const s of ["A", "B"] as const) drawOrder(pool.rows.filter((r) => r.source === s), pool.seed).forEach((r, i) => pos.set(r.task, i));
  const kept = (split: Split, source: Source) => w.taken.filter((t) => t.split === split && t.row.source === source && t.outcome?.kept).sort((x, y) => pos.get(x.row.task)! - pos.get(y.row.task)!);
  const nfacts = (t: Taken) => (t.outcome as { kept: true; nfacts: number }).nfacts;
  const rowsOf = (ts: Taken[]) => ts.map((t) => taskRow(t.row, nfacts(t)));
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const tally = (split: Split, source: Source) => {
    const ts = w.taken.filter((t) => t.split === split && t.row.source === source);
    return { taken: ts.length, dropped: ts.filter((t) => t.outcome && !t.outcome.kept).length, unkeyed: ts.filter((t) => !t.outcome).length };
  };
  const nonClean = (ts: Taken[]) => ts.filter((t) => t.row.stratum !== "clean");
  if (mode === "held-b") {
    const heldAPath = need(a, "held-a");
    onTmpfs(dirname(heldAPath), "--held-a");
    const heldA = readJson(heldAPath, "--held-a");
    if (heldA?.schema !== "tbv-held-split.v1" || heldA.source !== "A" || !Array.isArray(heldA.tasks)) fail("E_TBV_INPUT", "--held-a is not source A's tbv-held-split.v1 split map");
    onTmpfs(need(a, "a"), "--a (held-out source A histories)");
    const aHist = new Map(readHistories(a.a!, "A", "a").map((h) => [h.task, h]));
    const aRows = (heldA.tasks as TaskRow[]).map((t) => {
      const h = aHist.get(t.id);
      if (!h || h.sha256 !== heldA.histories?.[t.id]) fail("E_TBV_INPUT", "a held-out source A task's history in --a is missing or is not the one the split map names");
      return { source: "A" as const, task: t.id, cluster: t.cluster, stratum: t.stratum, tokens: 0, sha256: h!.sha256 };
    });
    const keptB = kept("held", "B");
    const controls = [...aRows.filter((r) => r.stratum !== "clean").slice(0, CONTROLS_PER_SOURCE).map((r) => r.task), ...nonClean(keptB).slice(0, CONTROLS_PER_SOURCE).map((t) => t.row.task)];
    const files = [...aRows.map((r) => r.task + ".json"), ...keptB.flatMap((t) => [t.row.task + ".json", t.row.task + ".capy.json"])];
    const manifest: SplitManifest = { schema: "tbv-split.v1", stage: "held", tasks: [...(heldA.tasks as TaskRow[]), ...rowsOf(keptB)], controlTaskIds: controls };
    heldWrite(() => {
      const seal = heldOutputs(a, ["held-out"], undefined, ["held.json", "held-b.json", "seed-b.hex", ...files])!;
      const put = (name: string, text: string) => {
        writeFileSync(join(heldOut, name), text, { mode: 0o600 });
        seal(join(heldOut, name));
      };
      mkdirSync(heldOut, { recursive: true, mode: 0o700 });
      put("held.json", json(manifest));
      put("held-b.json", json({ schema: "tbv-held-split.v1", source: "B", seedSha256: sha256(pool.seedHex), poolDigest: pool.digest, tasks: rowsOf(keptB), histories: Object.fromEntries(keptB.map((t) => [t.row.task, t.row.sha256])), ...tally("held", "B") }));
      put("seed-b.hex", pool.seedHex + "\n");
      writeTaskDirs(join(heldOut, "tasks"), [...aRows, ...keptB.map((t) => t.row)], new Map([...aHist, ...pool.histories]), seal);
    });
    const nc = nonClean(keptB).length;
    io.out("split held B: non-clean kept " + nc + ", clean kept " + (keptB.length - nc) + " of " + HELD_CLEAN_B + "; " + JSON.stringify(tally("held", "B")));
    io.out("split held: non-clean kept " + (aRows.length + nc) + " (floor 70" + (aRows.length + nc < 70 ? ", below" : "") + "), controls " + controls.length + " of " + 2 * CONTROLS_PER_SOURCE);
    return 0;
  }
  const devOut = need(a, "dev-out");
  fresh(devOut, "dev-out");
  const seal = heldOutputs(a, ["held-out"], undefined, ["held-a.json", "seed.hex"])!;
  guardDev(devRows(w), forbidden(pool, w));
  const devA = kept("dev", "A");
  const devB = kept("dev", "B");
  const hrA = nonClean(devA).slice(0, HR_PER_SOURCE);
  const hrB = nonClean(devB).slice(0, HR_PER_SOURCE);
  const hr = [...hrA, ...hrB];
  mkdirSync(devOut, { recursive: true });
  const hrText = json({ schema: "tbv-split.v1", stage: "hr", tasks: rowsOf(hr), controlTaskIds: hr.map((t) => t.row.task) } satisfies SplitManifest);
  const devText = json({ schema: "tbv-split.v1", stage: "dev", tasks: rowsOf([...devA, ...devB]), controlTaskIds: [] } satisfies SplitManifest);
  writeFileSync(join(devOut, "hr.json"), hrText);
  writeFileSync(join(devOut, "dev.json"), devText);
  writeFileSync(join(devOut, "dev-clusters.json"), json({ schema: "tbv-dev-clusters.v1", A: w.devClusters.A, B: w.devClusters.B }));
  const ids = (ts: Taken[]) => ts.map((t) => t.row.task);
  writeFileSync(join(devOut, "picks.json"), json({ schema: "tbv-picks.v1", smoke: { investigate: ids(hrA)[0] ?? null, ship: ids(hrB)[0] ?? null, capy: ids(hrB)[0] ?? null }, metered: [...ids(hrA).slice(0, 2), ...ids(hrB).slice(0, 2)] }));
  writeTaskDirs(join(devOut, "tasks", "hr"), hr.map((t) => t.row), pool.histories);
  writeTaskDirs(join(devOut, "tasks", "dev"), [...devA, ...devB].map((t) => t.row), pool.histories);
  const heldA = kept("held", "A");
  mkdirSync(heldOut, { recursive: true, mode: 0o700 });
  const put = (name: string, text: string) => {
    writeFileSync(join(heldOut, name), text, { mode: 0o600 });
    seal(join(heldOut, name));
  };
  put("held-a.json", json({ schema: "tbv-held-split.v1", source: "A", seedSha256: sha256(pool.seedHex), poolDigest: pool.digest, tasks: rowsOf(heldA), histories: Object.fromEntries(heldA.map((t) => [t.row.task, t.row.sha256])), ...tally("held", "A") }));
  put("seed.hex", pool.seedHex + "\n");
  const ncA = nonClean(devA).length;
  const ncB = nonClean(devB).length;
  io.out("split dev A: non-clean kept " + ncA + " of 20; " + JSON.stringify(tally("dev", "A")));
  io.out("split dev B: non-clean kept " + ncB + " of 20, clean kept " + (devB.length - ncB) + " of " + DEV_CLEAN_B + "; " + JSON.stringify(tally("dev", "B")));
  io.out("split dev non-clean kept " + (ncA + ncB) + " (floor 30" + (ncA + ncB < 30 ? ", below" : "") + ")");
  io.out("split held A: non-clean kept " + heldA.length + " of 50; " + JSON.stringify(tally("held", "A")));
  io.out("split hr: " + hrA.length + " A and " + hrB.length + " B tasks; hr.json sha256 " + sha256(hrText) + "; dev.json sha256 " + sha256(devText));
  return 0;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// tbv split (prereg section 4 as amendment 1 and the GEVA-361 pins addendum rule it): the seeded draw over lineage
// clusters, the cluster-major walk with key refills and spillover, held-out custody and the manifests. Synthetic pools
// and histories only; no key and no network.
import { afterAll, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extract } from "../../lanes/tbv/extract.ts";
import { historySha256 } from "../../lanes/tbv/history/events.ts";
import { assembleB, type PrRecord } from "../../lanes/tbv/history/source-b.ts";
import { run as rule } from "../../lanes/tbv/rule.ts";
import { capClusters, drawOrder, guardDev, lineageClusters, type Outcome, type PoolRow, rank, run, taskRow, walk } from "../../lanes/tbv/split.ts";
import type { History, HistoryEvent, Source, Stratum } from "../../lanes/tbv/types.ts";
import { mkdtempDisk } from "./disk.ts";
import { pr } from "./history-helpers.ts";

const SEED_HEX = "5e".repeat(32);
const SEED = Buffer.from(SEED_HEX, "hex");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const row = (source: Source, task: string, cluster: string, stratum: Stratum): PoolRow => ({ source, task, cluster, stratum, tokens: 1000, sha256: "0".repeat(64) });
const codeOf = async (f: () => unknown) => {
  try {
    await f();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const count = (w: ReturnType<typeof walk>, split: string, source: string, stratum: string) => w.counts.find((c) => c.split === split && c.source === source && c.stratum === stratum)!;
const pick = (c: { slots: number; taken: number; kept: number; dropped: number; pending: number; open: number }) => [c.slots, c.taken, c.kept, c.dropped, c.pending, c.open];
const many = (source: Source, prefix: string, stratum: Stratum, n: number) => Array.from({ length: n }, (_, i) => row(source, prefix + i, prefix + "c" + i, stratum));

test("rank is HMAC-SHA256 under the seed of source, NUL and the name", () => {
  expect(rank(SEED, "A", "c1")).toBe(createHmac("sha256", SEED).update("A\0c1").digest("hex"));
  expect(rank(SEED, "B", "c1")).not.toBe(rank(SEED, "A", "c1"));
});

test("drawOrder is cluster-major: each cluster's first member in cluster rank, then siblings; any input order, fixed seed", () => {
  const rows = Array.from({ length: 8 }, (_, c) => [row("A", "t" + c + "a", "c" + c, "long"), row("A", "t" + c + "b", "c" + c, "short")]).flat();
  const order = drawOrder(rows, SEED);
  const byRank = [...new Set(rows.map((r) => r.cluster))].sort((x, y) => (rank(SEED, "A", x) < rank(SEED, "A", y) ? -1 : 1));
  expect(order.slice(0, 8).map((r) => r.cluster)).toEqual(byRank);
  expect(order.slice(8).map((r) => r.cluster)).toEqual(byRank);
  for (let i = 0; i < 8; i++) expect(rank(SEED, "A", order[i]!.task) < rank(SEED, "A", order[i + 8]!.task)).toBe(true);
  expect(drawOrder([...rows].reverse(), SEED)).toEqual(order);
  expect(drawOrder(rows, Buffer.from("a7".repeat(32), "hex")).map((r) => r.task)).not.toEqual(order.map((r) => r.task));
});

test("capClusters keeps a cluster's first two members by task rank, for source B as for source A", () => {
  const b = [row("B", "pr-1", "pr-1", "short"), row("B", "pr-2", "pr-1", "clean"), row("B", "pr-3", "pr-1", "other"), row("B", "pr-4", "pr-1", "short"), row("B", "pr-9", "pr-9", "short")];
  const a = [row("A", "x__1", "x", "long"), row("A", "x__2", "x", "long"), row("A", "x__3", "x", "other")];
  const r = capClusters([...b, ...a], SEED);
  const first2 = (rows: PoolRow[], s: Source) => rows.map((x) => x.task).sort((x, y) => (rank(SEED, s, x) < rank(SEED, s, y) ? -1 : 1)).slice(0, 2);
  expect(r.rows.filter((x) => x.cluster === "pr-1").map((x) => x.task).sort()).toEqual(first2(b.slice(0, 4), "B").sort());
  expect(r.rows.filter((x) => x.cluster === "x").map((x) => x.task).sort()).toEqual(first2(a, "A").sort());
  expect(r.rows.some((x) => x.task === "pr-9")).toBe(true);
  expect(r.dropped).toBe(3);
});

test("spillover: long's open slots pass to short, short's to other, and other's stay open", () => {
  const w = walk({ rows: [...many("A", "l", "long", 3), ...many("A", "s", "short", 10), ...many("A", "o", "other", 20)], seed: SEED, outcomes: new Map(), mode: "b2" });
  expect(pick(count(w, "dev", "A", "long"))).toEqual([8, 3, 0, 0, 3, 5]);
  expect(pick(count(w, "dev", "A", "short"))).toEqual([11, 10, 0, 0, 10, 1]);
  expect(pick(count(w, "dev", "A", "other"))).toEqual([7, 7, 0, 0, 7, 0]);
  expect(pick(count(w, "dev", "B", "clean"))).toEqual([4, 0, 0, 0, 0, 4]);
  expect(w.phase).toBe("dev");
  expect(w.batch.length).toBe(20);
});

test("a dropped key reopens its slot and the replay takes the next task; held-out starts only when dev has no pending key", () => {
  const rows = many("A", "l", "long", 10);
  const r1 = walk({ rows, seed: SEED, outcomes: new Map(), mode: "b2" });
  const order = drawOrder(rows, SEED);
  expect(r1.batch.map((r) => r.task)).toEqual(order.slice(0, 8).map((r) => r.task));
  const out = new Map<string, Outcome>(order.slice(0, 8).map((r, i) => [r.task, i === 0 ? { kept: false } : { kept: true, nfacts: 4 }]));
  const r2 = walk({ rows, seed: SEED, outcomes: out, mode: "b2" });
  expect(r2.phase).toBe("dev");
  expect(r2.batch.map((r) => r.task)).toEqual([order[8]!.task]);
  expect(pick(count(r2, "dev", "A", "long"))).toEqual([8, 9, 7, 1, 1, 0]);
  out.set(order[8]!.task, { kept: true, nfacts: 3 });
  const r3 = walk({ rows, seed: SEED, outcomes: out, mode: "b2" });
  expect(r3.phase).toBe("held");
  expect(r3.batch.map((r) => r.task)).toEqual([order[9]!.task]);
  expect(r3.taken.filter((t) => t.split === "dev").length).toBe(9);
  expect(pick(count(r3, "held", "A", "long"))).toEqual([20, 1, 0, 0, 1, 19]);
  expect(pick(count(r3, "held", "A", "other"))).toEqual([49, 0, 0, 0, 0, 49]);
  out.set(order[9]!.task, { kept: true, nfacts: 5 });
  const r4 = walk({ rows, seed: SEED, outcomes: out, mode: "b2" });
  expect([r4.phase, r4.batch.length]).toEqual(["done", 0]);
});

test("a cluster dev touched never enters held-out: a dropped dev task's cluster and an untaken sibling included", () => {
  const pairs = Array.from({ length: 6 }, (_, c) => [row("A", "p" + c + "a", "pc" + c, "long"), row("A", "p" + c + "b", "pc" + c, "long")]).flat();
  const rows = [...pairs, ...many("A", "s", "short", 10)];
  const outcomes = new Map<string, Outcome>();
  let w = walk({ rows, seed: SEED, outcomes, mode: "b2" });
  for (let i = 0; i < 5 && w.phase === "dev"; i++) {
    w.batch.forEach((r, j) => outcomes.set(r.task, i === 0 && j === 0 ? { kept: false } : { kept: true, nfacts: 3 }));
    w = walk({ rows, seed: SEED, outcomes, mode: "b2" });
  }
  expect(w.phase).toBe("held");
  const dev = w.taken.filter((t) => t.split === "dev");
  const held = w.taken.filter((t) => t.split === "held");
  expect(dev.filter((t) => t.row.stratum === "long").length).toBe(9);
  expect(new Set(dev.filter((t) => t.row.stratum === "long").map((t) => t.row.cluster)).size).toBe(6);
  expect(w.devClusters.A.sort()).toEqual([...new Set(dev.map((t) => t.row.cluster))].sort());
  expect(held.length).toBe(4);
  expect(held.every((t) => t.row.stratum === "short" && !w.devClusters.A.includes(t.row.cluster))).toBe(true);
  expect(pick(count(w, "held", "A", "long"))).toEqual([20, 0, 0, 0, 0, 20]);
});

test("source B dev: 4 clean slots from source B, and B's long slots spill when it has no long task", () => {
  const w = walk({ rows: [...many("B", "s", "short", 10), ...many("B", "o", "other", 10), ...many("B", "k", "clean", 6)], seed: SEED, outcomes: new Map(), mode: "b2" });
  expect(pick(count(w, "dev", "B", "long"))).toEqual([8, 0, 0, 0, 0, 8]);
  expect(pick(count(w, "dev", "B", "short"))).toEqual([14, 10, 0, 0, 10, 4]);
  expect(pick(count(w, "dev", "B", "other"))).toEqual([10, 10, 0, 0, 10, 0]);
  expect(pick(count(w, "dev", "B", "clean"))).toEqual([4, 4, 0, 0, 4, 0]);
  expect(w.counts.some((c) => c.split === "held")).toBe(false);
});

test("held-out source B at close: every qualifying task at 50 or fewer, 20/15/15 with spillover above 50, 10 clean by rank", () => {
  const clean = many("B", "k", "clean", 12);
  const w = walk({ rows: [...many("B", "s", "short", 30), ...many("B", "o", "other", 10), ...clean], seed: SEED, outcomes: new Map(), mode: "held-b" });
  expect(w.phase).toBe("held");
  expect(pick(count(w, "held", "B", "long"))).toEqual([0, 0, 0, 0, 0, 0]);
  expect(pick(count(w, "held", "B", "short"))).toEqual([30, 30, 0, 0, 30, 0]);
  expect(pick(count(w, "held", "B", "other"))).toEqual([10, 10, 0, 0, 10, 0]);
  expect(pick(count(w, "held", "B", "clean"))).toEqual([10, 10, 0, 0, 10, 0]);
  expect(w.taken.filter((t) => t.row.stratum === "clean").map((t) => t.row.task)).toEqual(drawOrder(clean, SEED).slice(0, 10).map((r) => r.task));
  const big = walk({ rows: [...many("B", "s", "short", 40), ...many("B", "o", "other", 20)], seed: SEED, outcomes: new Map(), mode: "held-b" });
  expect(pick(count(big, "held", "B", "long"))).toEqual([20, 0, 0, 0, 0, 20]);
  expect(pick(count(big, "held", "B", "short"))).toEqual([35, 35, 0, 0, 35, 0]);
  expect(pick(count(big, "held", "B", "other"))).toEqual([15, 15, 0, 0, 15, 0]);
});

test("taskRow writes id, cluster, source, stratum and nfacts in that order, with no family", () => {
  expect(JSON.stringify(taskRow(row("B", "pr-3", "pr-2", "short"), 4))).toBe('{"id":"pr-3","cluster":"pr-2","source":"B","stratum":"short","nfacts":4}');
});

test("guardDev refuses a planted held-out id or cluster in the dev rows without naming it", async () => {
  const forbidden = { ids: new Set(["held-t9"]), clusters: new Set(["held-c9"]) };
  expect(await codeOf(() => guardDev([{ id: "t1", cluster: "c1" }], forbidden))).toBe("ok");
  for (const planted of [{ id: "held-t9", cluster: "c1" }, { id: "t1", cluster: "held-c9" }, { id: "held-c9", cluster: "c1" }]) {
    let message = "";
    try {
      guardDev([{ id: "t2", cluster: "c2" }, planted], forbidden);
    } catch (e) {
      message = (e as Error).message + (e as { code?: string }).code;
    }
    expect(message).toContain("E_TBV_CUSTODY");
    expect(message).not.toContain("held-t9");
    expect(message).not.toContain("held-c9");
  }
});

test("lineageClusters joins truncated stubs as heldOutCluster does, and refuses a stub with no title or branch", async () => {
  const recs = [pr({ number: 1, headRefName: "b/1" }), pr({ number: 2, headRefName: "b/2", closingIssues: [7] }), pr({ number: 3, headRefName: "b/3", closingIssues: [8] }), pr({ number: 4, headRefName: "b/4" })];
  const stub = (o: object) => ({ number: 9, createdAt: "2026-11-01T00:00:00Z", title: "stub", baseRefName: "main", headRefName: "b/9", closingIssues: [] as number[] | null, ...o });
  const c1 = lineageClusters(recs, [stub({ number: 0, headRefName: "b/4" })]);
  expect([c1.get(4), c1.get(1), c1.get(2)]).toEqual(["pr-0", "pr-1", "pr-2"]);
  const c2 = lineageClusters(recs, [stub({ closingIssues: null })]);
  expect([c2.get(2), c2.get(3), c2.get(9), c2.get(1)]).toEqual(["pr-2", "pr-2", "pr-2", "pr-1"]);
  expect(await codeOf(() => lineageClusters(recs, [stub({ title: null })]))).toBe("E_TBV_INPUT");
});

// ---------- the command, end to end ----------

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const shmDir = () => {
  const d = mkdtempSync(join("/dev/shm", "tbv-split-"));
  dirs.push(d);
  return d;
};
const diskDir = () => {
  const d = mkdtempDisk("tbv-split-");
  dirs.push(d);
  return d;
};
const lines = (n: number, flagAt: number[], st = "FAILED") => Array.from({ length: n }, (_, i) => "tests/test_m.py::test_" + (i + 1) + " " + (flagAt.includes(i + 1) ? st : "PASSED")).join("\n");
const OUT: Record<string, [string, boolean]> = { long: [lines(20, [12]), false], short: [lines(5, [2], "SKIPPED"), false], other: [lines(9, [2]), false], clean: [lines(4, []) + "\n=== 4 passed in 0.1s ===", true], none: [lines(4, []), false], big: [lines(20, [12]) + "\nbuild output line\n".repeat(16_000), false] };
function histA(task: string, cluster: string, kind: keyof typeof OUT): History {
  const [out, resolved] = OUT[kind]!;
  const events: HistoryEvent[] = [{ n: 1, kind: "user-text", text: "Fix " + task + "." }, { n: 2, kind: "tool-use", id: "toolu_1", name: "Bash", input: { command: "pytest" } }, { n: 3, kind: "tool-result", tool_use_id: "toolu_1", content: out, is_error: false }];
  return { schema: "tbv-history.v1", source: "A", task, cluster, family: "investigate", events, sha256: historySha256(events), side: { files: [], resolved, patch: null } };
}
const DEV_PR = { createdAt: "2026-11-01T10:00:00Z", mergedAt: "2026-11-01T12:00:00Z", closedAt: "2026-11-01T12:00:00Z" };
const cleanPr = (o: Partial<PrRecord>) => pr({ ...DEV_PR, files: [{ path: "src/a.ts", additions: 1, deletions: 0 }], reviewThreads: [], commits: [{ ...pr().commits[1]!, checks: [{ name: "test", conclusion: "SUCCESS", status: "COMPLETED", title: null, summary: null, text: null }] }], ...o });
const shortPr = (n: number, o: Partial<PrRecord> = {}) => pr({ ...DEV_PR, number: n, title: "Change " + n, headRefName: "b/" + n, ...o });

function world(o: { a?: History[]; prs?: PrRecord[] } = {}) {
  const shm = shmDir(), disk = diskDir();
  const a = o.a ?? [
    ...Array.from({ length: 12 }, (_, i) => histA("a-l" + i + "__s0", "a-l" + i, "long")),
    ...Array.from({ length: 4 }, (_, i) => histA("a-s" + i + "__s0", "a-s" + i, "short")),
    ...[0, 1, 2].map((s) => histA("a-o0__s" + s, "a-o0", "other")), histA("a-o1__s0", "a-o1", "other"), histA("a-o2__s0", "a-o2", "other"),
    histA("a-k0__s0", "a-k0", "clean"), histA("a-n0__s0", "a-n0", "none"), histA("a-b0__s0", "a-b0", "big"),
  ];
  const prs = o.prs ?? [...[1, 2, 3, 4, 5, 6].map((n) => shortPr(n)), shortPr(7, { baseRefName: "b/6" }), cleanPr({ number: 8, title: "Change 8", headRefName: "b/8" }), cleanPr({ number: 9, title: "Change 9", headRefName: "b/9" }), shortPr(10, { mergedAt: "2026-11-07T00:00:00Z" }), shortPr(11, { state: "CLOSED", mergedAt: null })];
  mkdirSync(join(shm, "a"));
  for (const h of a) writeFileSync(join(shm, "a", h.task + ".json"), JSON.stringify(h));
  mkdirSync(join(disk, "b"));
  for (const p of prs) {
    const r = assembleB(p, "pr-" + p.number);
    if (!r.ok) throw new Error(r.drop);
    writeFileSync(join(disk, "b", r.history.task + ".json"), JSON.stringify(r.history));
  }
  const stub = { number: 12, createdAt: "2026-11-01T09:00:00Z", title: "Stub", baseRefName: "main", headRefName: "b/5", closingIssues: [] };
  writeFileSync(join(disk, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", repo: "garrytan/gstack-evals", prs, skipped: [stub] }));
  mkdirSync(join(shm, "seed"));
  writeFileSync(join(shm, "seed", "seed.hex"), SEED_HEX + "\n");
  const names = [...a.flatMap((h) => [h.task, h.cluster]), ...prs.map((p) => "pr-" + p.number)];
  const pool = ["--a", join(shm, "a"), "--b", join(disk, "b"), "--prs", join(disk, "prs.json"), "--seed-file", join(shm, "seed", "seed.hex")];
  return { shm, disk, a, names, pool };
}
const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
};
const histories = (dir: string) => readdirSync(join(dir, "histories")).map((f) => JSON.parse(readFileSync(join(dir, "histories", f), "utf8")) as History);
function keysFor(dir: string, hs: History[], drop: (h: History) => boolean) {
  mkdirSync(dir, { recursive: true });
  const drops: Array<{ task: string; reason: string }> = [];
  for (const h of hs) {
    if (drop(h)) drops.push({ task: h.task, reason: "fewer than 3 facts left after the audit" });
    else {
      const clean = extract(h).stratum === "clean";
      const facts = clean ? [] : [1, 2, 3].map((i) => ({ id: "F" + i, category: "claim not verified", statement: "s", events: [3], critical: false }));
      writeFileSync(join(dir, h.task + ".json"), JSON.stringify({ schema: "tbv-key.v1", task: h.task, history_sha256: h.sha256, facts, traps: [], list: null, digest: "d", audits: [], dropped: [] }));
    }
  }
  if (drops.length) writeFileSync(join(dir, "drops.json"), JSON.stringify(drops));
}
const noNames = (text: string, names: string[]) => names.filter((n) => new RegExp("(^|[^\\w-])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\w-])").test(text));

test("the synthetic histories land in the strata the run test assumes", () => {
  expect(["long", "short", "other", "clean", "none", "big"].map((k) => extract(histA("t", "c", k as keyof typeof OUT)).stratum)).toEqual(["long", "short", "other", "clean", "none", "long"]);
  expect(extract(histA("t", "c", "big")).tokens).toBeGreaterThan(90_000);
  const b = assembleB(cleanPr({ number: 8, headRefName: "b/8" }), "pr-8");
  const s = assembleB(shortPr(1), "pr-1");
  expect([b.ok && extract(b.history).stratum, s.ok && extract(s.history).stratum, s.ok && s.history.task]).toEqual(["clean", "short", "pr-1"]);
});

test("plan, next and write: counts only on stdout, dev batches plain, held batches and the split map sealed on tmpfs, manifests and drive dirs", async () => {
  const w = world();
  const SEAL = "base64";
  const p = io();
  expect(await run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], p.io)).toBe(0);
  const plan = p.out.join("\n");
  expect(plan).toContain("seed sha256 " + sha(SEED_HEX));
  expect(plan).toContain("truncated records 1");
  expect(plan).toContain('"size":1');
  expect(plan).toContain('"source A clean":1');
  expect(plan).toContain('"cluster cap":1');
  expect(noNames(plan, w.names)).toEqual([]);
  const digest = /pool digest ([0-9a-f]{64})/.exec(plan)![1]!;
  const dev1 = histories(join(w.disk, "dev-1"));
  expect(dev1.length).toBe(25);
  expect(readdirSync(join(w.disk, "dev-1", "extracts")).length).toBe(25);
  const firstLong = dev1.filter((h) => h.source === "A" && h.task.startsWith("a-l"))[0]!;
  keysFor(join(w.disk, "dev-keys", "r1"), dev1, (h) => h.task === firstLong.task);
  const flags = [...w.pool, "--pool-digest", digest, "--dev-keys", join(w.disk, "dev-keys")];
  const n2 = io();
  expect(await run(["split", "next", ...flags, "--batch", join(w.disk, "dev-2")], n2.io)).toBe(0);
  const dev2 = histories(join(w.disk, "dev-2"));
  expect(dev2.length).toBe(1);
  expect(dev2[0]!.task.startsWith("a-l")).toBe(true);
  keysFor(join(w.disk, "dev-keys", "r2"), dev2, () => false);
  expect(await codeOf(() => run(["split", "next", ...flags, "--batch", join(w.shm, "held-x")], io().io))).toBe("E_TBV_CUSTODY");
  expect(await codeOf(() => run(["split", "next", ...flags, "--batch", join(w.disk, "held-x"), "--held", join(w.disk, "sealed", "x"), "--seal-cmd", SEAL], io().io))).toBe("E_TBV_CUSTODY");
  const n3 = io();
  expect(await run(["split", "next", ...flags, "--batch", join(w.shm, "held-1"), "--held", join(w.disk, "sealed", "n3"), "--seal-cmd", SEAL], n3.io)).toBe(0);
  expect(noNames(n2.out.join("\n") + n3.out.join("\n"), w.names)).toEqual([]);
  const held1 = histories(join(w.shm, "held-1"));
  expect(held1.length).toBe(3);
  const sealed = readdirSync(join(w.disk, "sealed", "n3"));
  expect(sealed.length).toBe(6);
  expect(sealed.every((f) => f.endsWith(".sealed"))).toBe(true);
  const one = sealed.find((f) => f === held1[0]!.task + ".json.sealed")!;
  expect(Buffer.from(readFileSync(join(w.disk, "sealed", "n3", one), "utf8"), "base64").toString()).toBe(readFileSync(join(w.shm, "held-1", "histories", held1[0]!.task + ".json"), "utf8"));
  keysFor(join(w.shm, "held-keys", "r1"), held1, () => false);
  const wr = io();
  expect(await run(["split", "write", ...flags, "--held-keys", join(w.shm, "held-keys"), "--dev-out", join(w.disk, "out"), "--held-out", join(w.shm, "held-out"), "--held", join(w.disk, "sealed", "w"), "--seal-cmd", SEAL], wr.io)).toBe(0);
  const written = wr.out.join("\n");
  expect(noNames(written, w.names)).toEqual([]);
  expect(written).toContain("dev non-clean kept 23 (floor 30, below)");
  const out = join(w.disk, "out");
  const hrText = readFileSync(join(out, "hr.json"), "utf8");
  const hr = JSON.parse(hrText);
  const dev = JSON.parse(readFileSync(join(out, "dev.json"), "utf8"));
  expect([hr.schema, hr.stage, hr.tasks.length, dev.stage, dev.tasks.length, dev.controlTaskIds]).toEqual(["tbv-split.v1", "hr", 17, "dev", 25, []]);
  expect([...hr.controlTaskIds].sort()).toEqual(hr.tasks.map((t: { id: string }) => t.id).sort());
  for (const t of [...hr.tasks, ...dev.tasks]) expect(JSON.stringify(t)).toBe(JSON.stringify(taskRow({ ...t, task: t.id, tokens: 0, sha256: "" }, t.nfacts)));
  expect(dev.tasks.filter((t: { stratum: string }) => t.stratum === "clean").map((t: { source: string; nfacts: number }) => [t.source, t.nfacts])).toEqual([["B", 0], ["B", 0]]);
  const hrA = hr.tasks.filter((t: { source: string }) => t.source === "A").map((t: { id: string }) => t.id);
  const hrB = hr.tasks.filter((t: { source: string }) => t.source === "B").map((t: { id: string }) => t.id);
  expect([hrA.length, hrB.length]).toEqual([10, 7]);
  expect(JSON.parse(readFileSync(join(out, "picks.json"), "utf8"))).toEqual({ schema: "tbv-picks.v1", smoke: { investigate: hrA[0], ship: hrB[0], capy: hrB[0] }, metered: [hrA[0], hrA[1], hrB[0], hrB[1]] });
  const fam = (stage: string, f: string) => readdirSync(join(out, "tasks", stage, f)).map((n) => JSON.parse(readFileSync(join(out, "tasks", stage, f, n), "utf8")) as History);
  expect(["investigate", "ship", "capy"].map((f) => fam("hr", f).length)).toEqual([10, 7, 7]);
  expect(["investigate", "ship", "capy"].map((f) => fam("dev", f).length)).toEqual([16, 9, 9]);
  expect(fam("dev", "capy").every((h) => h.family === "capy" && h.source === "B")).toBe(true);
  expect(fam("dev", "capy").map((h) => h.sha256).sort()).toEqual(fam("dev", "ship").map((h) => h.sha256).sort());
  const dc = JSON.parse(readFileSync(join(out, "dev-clusters.json"), "utf8"));
  expect([dc.A.length, dc.B.length]).toEqual([16, 8]);
  const heldA = JSON.parse(readFileSync(join(w.shm, "held-out", "held-a.json"), "utf8"));
  expect([heldA.schema, heldA.tasks.length, heldA.seedSha256]).toEqual(["tbv-held-split.v1", 3, sha(SEED_HEX)]);
  expect(heldA.tasks.some((t: { cluster: string }) => dc.A.includes(t.cluster))).toBe(false);
  expect(readdirSync(join(w.disk, "sealed", "w")).sort()).toEqual(["held-a.json.sealed", "seed.hex.sealed"]);
  expect(Buffer.from(readFileSync(join(w.disk, "sealed", "w", "seed.hex.sealed"), "utf8"), "base64").toString().trim()).toBe(SEED_HEX);

  // The manifest rows round-trip through the scorer: a readings file that copies them passes item 4, a reordered row does not.
  const readings = (tasks: unknown[], text: string, stage: string, ctl: string[]) => ({ stage, tasks, readings: [], controls: [], plan: { models: ["opus"], passes: { opus: 3 }, skillArms: ["none"], taskIds: (tasks as Array<{ id: string }>).map((t) => t.id), controlTaskIds: ctl, manifestSha256: sha(text) } });
  const ruleOn = (cmd: string, data: unknown, manifest: string) => {
    const f = join(w.disk, cmd + "-readings.json");
    writeFileSync(f, JSON.stringify(data));
    const r = io();
    rule([cmd, f, "--split", manifest], r.io);
    return r.err.join("\n");
  };
  expect(ruleOn("headroom", readings(JSON.parse(hrText).tasks, hrText, "hr", hr.controlTaskIds), join(out, "hr.json"))).not.toContain("row for row");
  const devText = readFileSync(join(out, "dev.json"), "utf8");
  expect(ruleOn("compare", readings(JSON.parse(devText).tasks, devText, "dev", []), join(out, "dev.json"))).not.toContain("row for row");
  const swapped = hr.tasks.map((t: Record<string, unknown>, i: number) => (i ? t : { cluster: t.cluster, id: t.id, source: t.source, stratum: t.stratum, nfacts: t.nfacts }));
  expect(ruleOn("headroom", readings(swapped, hrText, "hr", hr.controlTaskIds), join(out, "hr.json"))).toContain("row for row");
});

test("refusals: a seed that is not 64 hex characters, a seed or source A off tmpfs, a changed pool, keys the walk did not take", async () => {
  const w = world();
  const p = io();
  expect(await run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], p.io)).toBe(0);
  const digest = /pool digest ([0-9a-f]{64})/.exec(p.out.join("\n"))![1]!;
  const swap = (flag: string, value: string) => w.pool.map((v, i) => (w.pool[i - 1] === flag ? value : v));
  writeFileSync(join(w.shm, "seed", "other.hex"), "a7".repeat(32));
  expect(await codeOf(() => run(["split", "next", ...swap("--seed-file", join(w.shm, "seed", "other.hex")), "--pool-digest", digest, "--batch", join(w.disk, "x0")], io().io))).toBe("E_TBV_INPUT");
  expect(existsSync(join(w.disk, "x0"))).toBe(false);
  writeFileSync(join(w.shm, "seed", "short.hex"), "abc\n");
  expect(await codeOf(() => run(["split", "plan", ...swap("--seed-file", join(w.shm, "seed", "short.hex")), "--batch", join(w.disk, "x1")], io().io))).toBe("E_TBV_INPUT");
  writeFileSync(join(w.disk, "seed.hex"), SEED_HEX);
  expect(await codeOf(() => run(["split", "plan", ...swap("--seed-file", join(w.disk, "seed.hex")), "--batch", join(w.disk, "x2")], io().io))).toBe("E_TBV_CUSTODY");
  mkdirSync(join(w.disk, "a"));
  expect(await codeOf(() => run(["split", "plan", ...swap("--a", join(w.disk, "a")), "--batch", join(w.disk, "x3")], io().io))).toBe("E_TBV_CUSTODY");
  keysFor(join(w.disk, "keys", "r1"), histories(join(w.disk, "dev-1")), () => false);
  expect(await codeOf(() => run(["split", "next", ...w.pool, "--pool-digest", "0".repeat(64), "--dev-keys", join(w.disk, "keys"), "--batch", join(w.disk, "x4")], io().io))).toBe("E_TBV_INPUT");
  const dev1 = new Set(histories(join(w.disk, "dev-1")).map((h) => h.task));
  const untaken = w.a.find((h) => h.task.startsWith("a-l") && !dev1.has(h.task))!;
  keysFor(join(w.disk, "keys", "r2"), [untaken], () => false);
  expect(await codeOf(() => run(["split", "next", ...w.pool, "--pool-digest", digest, "--dev-keys", join(w.disk, "keys"), "--batch", join(w.disk, "x5")], io().io))).toBe("E_TBV_INPUT");
  expect(existsSync(join(w.disk, "x5"))).toBe(false);
});

test("an extractor refusal on a source A candidate stops with a task-free message", async () => {
  const bad = { ...histA("a-stale__s0", "a-stale", "long"), sha256: "f".repeat(64) };
  const w = world({ a: [histA("a-l0__s0", "a-l0", "long"), bad] });
  let message = "";
  try {
    await run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], io().io);
  } catch (e) {
    message = (e as { code?: string }).code + " " + (e as Error).message;
  }
  expect(message.startsWith("E_TBV_HISTORY ")).toBe(true);
  expect(message).not.toContain("a-stale");
  expect(existsSync(join(w.disk, "dev-1"))).toBe(false);
});

test("a held-out batch that cannot be written stops with a task-free message: a rerun into a --held dir that holds its sealed copies", async () => {
  const w = world();
  const p = io();
  expect(await run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], p.io)).toBe(0);
  const digest = /pool digest ([0-9a-f]{64})/.exec(p.out.join("\n"))![1]!;
  keysFor(join(w.disk, "dev-keys", "r1"), histories(join(w.disk, "dev-1")), () => false);
  const held = [...w.pool, "--pool-digest", digest, "--dev-keys", join(w.disk, "dev-keys"), "--held", join(w.disk, "sealed"), "--seal-cmd", "base64"];
  const n = io();
  expect(await run(["split", "next", ...held, "--batch", join(w.shm, "held-1")], n.io)).toBe(0);
  expect(n.out.join("\n")).toContain("split batch held");
  let message = "";
  try {
    await run(["split", "next", ...held, "--batch", join(w.shm, "held-2")], io().io);
  } catch (e) {
    message = (e as { code?: string }).code + " " + (e as Error).message;
  }
  expect(message.startsWith("E_TBV_CUSTODY ")).toBe(true);
  expect(noNames(message, w.names)).toEqual([]);
  expect(existsSync(join(w.shm, "held-2", "histories"))).toBe(false);
});

test("dev may draw a source B cluster's non-minimum members while the member that names the cluster stays undrawn", async () => {
  const r = (n: number) => rank(SEED, "B", "pr-" + n);
  let x = 20;
  while (!(r(x) > r(x + 1) && r(x) > r(x + 2))) x++;
  const prs = [...[1, 2, 3, 4].map((n) => shortPr(n)), shortPr(x), shortPr(x + 1, { baseRefName: "b/" + x }), shortPr(x + 2, { baseRefName: "b/" + (x + 1) })];
  const w = world({ prs });
  const p = io();
  expect(await run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], p.io)).toBe(0);
  expect(p.out.join("\n")).toContain('"cluster cap":2');
  const b = histories(join(w.disk, "dev-1")).filter((h) => h.source === "B");
  expect(b.map((h) => h.task).sort()).toEqual(["pr-1", "pr-2", "pr-3", "pr-4", "pr-" + (x + 1), "pr-" + (x + 2)].sort());
  expect(b.filter((h) => Number(h.task.slice(3)) > x).map((h) => h.cluster)).toEqual(["pr-" + x, "pr-" + x]);
});

test("a source A history whose task id is not a plain file name refuses before anything is written", async () => {
  const w = world({ a: [histA("a-l0__s0", "a-l0", "long")] });
  writeFileSync(join(w.shm, "a", "escape.json"), JSON.stringify(histA("../../escape", "a-esc", "long")));
  expect(await codeOf(() => run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], io().io))).toBe("E_TBV_INPUT");
  expect(existsSync(join(w.disk, "dev-1"))).toBe(false);
  expect(existsSync(join(w.disk, "escape.json"))).toBe(false);
});

test("held-b write refuses a source A history whose events no longer match its sha256", async () => {
  const shm = shmDir(), disk = diskDir();
  const good = histA("a-l0__s0", "a-l0", "long");
  mkdirSync(join(shm, "a"));
  writeFileSync(join(shm, "a", good.task + ".json"), JSON.stringify({ ...good, events: histA("a-l0__s0", "a-l0", "short").events }));
  mkdirSync(join(shm, "b"));
  mkdirSync(join(shm, "seed"));
  writeFileSync(join(shm, "seed", "seed-b.hex"), SEED_HEX + "\n");
  writeFileSync(join(disk, "prs.json"), JSON.stringify({ schema: "tbv-prs.v1", repo: "garrytan/gstack-evals", prs: [], skipped: [] }));
  writeFileSync(join(disk, "dev-clusters.json"), JSON.stringify({ schema: "tbv-dev-clusters.v1", A: [], B: [] }));
  writeFileSync(join(shm, "held-a.json"), JSON.stringify({ schema: "tbv-held-split.v1", source: "A", tasks: [taskRow(row("A", good.task, good.cluster, "long"), 3)], histories: { [good.task]: good.sha256 } }));
  const pool = ["--mode", "held-b", "--b", join(shm, "b"), "--prs", join(disk, "prs.json"), "--seed-file", join(shm, "seed", "seed-b.hex"), "--p-merged-at", "2026-11-07T00:00:00Z", "--dev-clusters", join(disk, "dev-clusters.json")];
  const p = io();
  expect(await run(["split", "plan", ...pool, "--batch", join(shm, "batch")], p.io)).toBe(0);
  const digest = /pool digest ([0-9a-f]{64})/.exec(p.out.join("\n"))![1]!;
  const flags = [...pool, "--pool-digest", digest, "--held-a", join(shm, "held-a.json"), "--a", join(shm, "a"), "--held-out", join(shm, "held-out"), "--held", join(disk, "sealed"), "--seal-cmd", "base64"];
  expect(await codeOf(() => run(["split", "write", ...flags], io().io))).toBe("E_TBV_INPUT");
  expect(existsSync(join(shm, "held-out"))).toBe(false);
  writeFileSync(join(shm, "a", good.task + ".json"), JSON.stringify(good));
  expect(await run(["split", "write", ...flags], io().io)).toBe(0);
});

test("a planted held-out cluster in the dev outputs refuses before anything is written", async () => {
  const a = [...Array.from({ length: 20 }, (_, i) => histA("a-l" + i + "__s0", "a-l" + i, "long")), histA("a-planted__s0", "pr-3", "long")];
  const order = drawOrder(a.map((h) => row("A", h.task, h.cluster, "long")), SEED);
  expect(order.slice(0, 8).some((r) => r.cluster === "pr-3")).toBe(false);
  const w = world({ a });
  expect(await codeOf(() => run(["split", "plan", ...w.pool, "--batch", join(w.disk, "dev-1")], io().io))).toBe("E_TBV_CUSTODY");
  expect(existsSync(join(w.disk, "dev-1"))).toBe(false);
});

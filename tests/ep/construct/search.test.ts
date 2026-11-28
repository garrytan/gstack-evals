// Copyright (c) 2026 Garry Tan. MIT License.
// Keyless tests of the planted-unit search, seeded draw and manifest freeze (lanes/eng-planted/construct/search.ts) and
// the miner's earliest public date (mine.ts), against stubbed GitHub reads.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../../lanes/eng-planted/cli.ts";
import { digest, type ManifestRow } from "../../../lanes/eng-planted/construct/local.ts";
import { earliestPublic } from "../../../lanes/eng-planted/construct/mine.ts";
import { draw, freeze, queries, repoKey, search } from "../../../lanes/eng-planted/construct/search.ts";

const row = (repo: string, over: Partial<ManifestRow> = {}): ManifestRow => ({ repo, eco: "go", stars: 500, sizeKB: 1000, pushedAt: "2026-10-20T00:00:00Z", query: 0, ...over });

describe("search", () => {
  test("queries carry the frame: three star bands, pushed since October 2026, at most 300 MB, no forks or archives", () => {
    expect(queries("node")).toHaveLength(6);
    expect(queries("go")[0]).toBe("language:Go stars:300..999 pushed:>=2026-10-01 size:<=307200 fork:false archived:false");
  });

  test("search records each query's total and reads pages until a short one", async () => {
    const pages: string[] = [];
    const r = await search(async (path) => {
      pages.push(path);
      return { status: 200, body: { total_count: 3, items: [{ full_name: "o/r" + pages.length, stargazers_count: 400, size: 10, pushed_at: "2026-10-30T00:00:00Z" }] } };
    }, "rust");
    expect(r.queries.map((q) => [q.total, q.read])).toEqual([[3, 1], [3, 1], [3, 1]]);
    expect(r.rows).toHaveLength(3);
  });

  test("the draw is fixed by its seed, keeps the frame, dedupes and caps each ecosystem", () => {
    const rows = [row("a/1"), row("a/2"), row("a/3"), row("a/1"), row("a/4", { stars: 60000 }), row("a/5", { pushedAt: "2026-09-30T00:00:00Z" }), row("a/6", { sizeKB: 400000 }), row("b/1", { eco: "node" })];
    const one = draw(rows, "seed-1", 2);
    expect(draw(rows, "seed-1", 2)).toEqual(one);
    expect(one.filter((r) => r.eco === "go")).toHaveLength(2);
    expect(one.map((r) => r.repo)).not.toContain("a/4");
    expect(draw(rows, "seed-1", 10).map((r) => r.repo).sort()).toEqual(["a/1", "a/2", "a/3", "b/1"]);
  });

  test("an exclusion key is the sha256 of the lowercase name, so a listed repository leaves the draw whatever its case", () => {
    expect(repoKey("Owner/Repo")).toBe(repoKey("owner/repo"));
    expect(repoKey("owner/repo")).toMatch(/^[0-9a-f]{64}$/);
    const out = new Set([repoKey("a/2")]);
    const rows = [row("a/1"), row("A/2"), row("a/3")];
    expect(draw(rows.filter((r) => !out.has(repoKey(r.repo))), "seed-1", 10).map((r) => r.repo).sort()).toEqual(["a/1", "a/3"]);
  });

  test("the manifest freezes by the digest of its text", () => {
    const f = freeze({ searchedAt: "2026-11-15T00:00:00Z", seed: "s", queries: [], rows: [row("a/1")] });
    expect(f.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(freeze(JSON.parse(f.text)).digest).toBe(f.digest);
  });
});

describe("earliest public date", () => {
  const gh = (pulls: unknown, issues: Record<number, string | null> = {}) => async (path: string) => {
    if (path.endsWith("/pulls")) return pulls === null ? { status: 404, body: null } : { status: 200, body: pulls };
    const n = Number(path.split("/").pop());
    return issues[n] ? { status: 200, body: { created_at: issues[n] } } : { status: 404, body: null };
  };

  test("the earliest of the author date, the pull request's open date and a linked issue's open date", async () => {
    const r = await earliestPublic(gh([{ created_at: "2026-08-02T00:00:00Z", labels: [{ name: "bug" }], body: "Fixes #7" }], { 7: "2026-07-20T00:00:00Z" }), "o/r", "abc", "2026-08-05T00:00:00Z", "fix it");
    expect(r).toEqual({ date: "2026-07-20T00:00:00.000Z", labels: ["bug"] });
  });

  test("an unreadable pull request list or linked issue drops", async () => {
    expect(await earliestPublic(gh(null), "o/r", "abc", "2026-08-05T00:00:00Z", "fix")).toEqual({ drop: "pr_unreadable" });
    expect(await earliestPublic(gh([]), "o/r", "abc", "2026-08-05T00:00:00Z", "fix, closes #9")).toEqual({ drop: "issue_unreadable" });
  });
});

describe("ep search --extend keeps the earlier run's exclusions", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row("o/r" + i));
  const seed = "seed-x";
  const io = () => {
    const out: string[] = [];
    return { out, io: { out: (t: string) => out.push(t), err: (t: string) => out.push(t) } };
  };
  const earlier = (excludeFirst: boolean, record = excludeFirst) => {
    const dir = mkdtempSync(join(tmpdir(), "ep-extend-"));
    const first = join(dir, "first");
    mkdirSync(first);
    const poolText = JSON.stringify(rows) + "\n";
    writeFileSync(join(first, "pool.json"), poolText);
    writeFileSync(join(first, "pool.digest"), digest(poolText) + "\n");
    const leader = draw(rows, seed, 1)[0]!.repo;
    const kept = rows.filter((r) => !excludeFirst || r.repo !== leader);
    const f = freeze({ searchedAt: "2026-11-01T00:00:00Z", seed, queries: [], rows: draw(kept, seed, 1) });
    writeFileSync(join(first, "manifest.json"), f.text);
    writeFileSync(join(first, "manifest.digest"), f.digest + "\n");
    if (record) writeFileSync(join(first, "excluded.txt"), repoKey(leader) + "\n");
    return { dir, first, leader };
  };
  const extend = async (e: ReturnType<typeof earlier>) => {
    const next = join(e.dir, "next");
    const o = io();
    expect(await main(["search", "--run", next, "--extend", e.first, "--per-eco", "4"], o.io)).toBe(0);
    return { next, repos: (JSON.parse(readFileSync(join(next, "manifest.json"), "utf8")) as { rows: ManifestRow[] }).rows.map((r) => r.repo), out: o.out };
  };

  test("an excluded repository the seeded order puts first stays out of the extension, and the list carries forward", async () => {
    const e = earlier(true);
    const x = await extend(e);
    expect(x.repos).toHaveLength(4);
    expect(x.repos).not.toContain(e.leader);
    expect(readFileSync(join(x.next, "excluded.txt"), "utf8")).toBe(repoKey(e.leader) + "\n");
    expect(x.out.at(-1)).toContain("1 listed repositories still excluded");
  });
  test("control: when the earlier run left no exclusion list, the same extension draws that repository first", async () => {
    const e = earlier(true, false);
    const x = await extend(e);
    expect(x.repos[0]).toBe(e.leader);
    expect(x.out.at(-1)).not.toContain("still excluded");
  });
});


// Copyright (c) 2026 Garry Tan. MIT License.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { capUnits, countRepo, frameRows, funnelTable, readType, recount, wantMore, type FrameRepo, type Miner, type RepoCount } from "../../lanes/eng-review/author/frame.ts";
import { mineClone, withPlans, type Candidate } from "../../lanes/eng-review/author/mine.ts";
import { git } from "../../lanes/real-outcome/mine/git.ts";
import { tempDir } from "../real/fixture.ts";
import { buildShop } from "./shop-fixture.ts";

const item = (name: string, o: Record<string, unknown> = {}) => ({ full_name: name, stargazers_count: 900, license: { spdx_id: "MIT" }, fork: false, archived: false, pushed_at: "2026-10-20T00:00:00Z", default_branch: "main", ...o });

describe("the widened frame (section 4, I1 and J1)", () => {
  test("licences, forks, archives, stars and pushes filter; copyleft is marked; the first type in rule order wins", () => {
    const rows = frameRows([
      { type: "devtools", topic: "cli", item: item("a/app") },
      { type: "mobile", topic: "android-app", item: item("a/app") },
      { type: "consumer", topic: "game", item: item("b/gpl", { license: { spdx_id: "GPL-3.0" } }) },
      { type: "consumer", topic: "game", item: item("c/agpl", { license: { spdx_id: "AGPL-3.0" } }) },
      { type: "server", topic: "crm", item: item("d/unl", { license: { spdx_id: "Unlicense" } }) },
      { type: "server", topic: "crm", item: item("e/fork", { fork: true }) },
      { type: "server", topic: "crm", item: item("f/arch", { archived: true }) },
      { type: "server", topic: "crm", item: item("g/small", { stargazers_count: 499 }) },
      { type: "server", topic: "crm", item: item("h/edge", { stargazers_count: 500 }) },
      { type: "server", topic: "crm", item: item("i/stale", { pushed_at: "2026-09-30T23:00:00Z" }) },
    ]);
    expect(rows.map((r) => r.repo).sort()).toEqual(["a/app", "b/gpl", "c/agpl", "h/edge"]);
    expect(rows.find((r) => r.repo === "a/app")).toMatchObject({ type_prov: "mobile", copyleft: false, topics: ["cli", "android-app"] });
    expect(rows.find((r) => r.repo === "b/gpl")!.copyleft).toBe(true);
    expect(rows.map((r) => r.order)).toEqual([...rows.map((r) => r.order)].sort());
  });
});

const cand = (id: string, after: string[] = []): Candidate => ({ id, change: id, aftermath: after.map((change) => ({ kind: "B", change, merged_at: "", subject: "", pr: null, files: [] })) }) as unknown as Candidate;
const rc = (usable: boolean, copyleft: boolean): RepoCount => ({ usable, copyleft }) as RepoCount;

describe("the recount's sample and caps", () => {
  test("the cap and the aftermath rule", () => {
    expect(capUnits([cand("a"), cand("b"), cand("c"), cand("d"), cand("e")], 4)).toHaveLength(4);
    expect(capUnits([cand("a"), cand("b"), cand("c")], 3)).toHaveLength(3);
    expect(capUnits([cand("a", ["b"]), cand("b")], 3)).toHaveLength(1);
  });
  test("draws until 10 usable and 4 usable in each licence group, or the group runs out", () => {
    const ten = [...Array(6).fill(rc(true, false)), ...Array(4).fill(rc(true, true))];
    expect(wantMore(ten, 10, { copyleft: 5, permissive: 5 })).toBe(false);
    expect(wantMore(ten.slice(1), 10, { copyleft: 5, permissive: 5 })).toBe(true);
    const lopsided = [...Array(7).fill(rc(true, false)), ...Array(3).fill(rc(true, true))];
    expect(wantMore(lopsided, 10, { copyleft: 1, permissive: 5 })).toBe(true);
    expect(wantMore(lopsided, 10, { copyleft: 0, permissive: 5 })).toBe(false);
    expect(wantMore(Array(45).fill(rc(false, false)), 10, { copyleft: 9, permissive: 9 })).toBe(false);
  });
});

describe("er frame recount on the fixture", () => {
  let shop: ReturnType<typeof buildShop>;
  const t = tempDir("er-frame-");
  beforeAll(() => {
    shop = buildShop();
  });
  afterAll(() => {
    shop.cleanup();
    t.cleanup();
  });
  test("mines each repository, deletes its clone, writes counts only and projects to the frame", () => {
    const clones: string[] = [];
    const miner: Miner = {
      clone: (repo, dir) => {
        clones.push(dir);
        if (repo === "x/broken") return false;
        git(t.dir, ["clone", "--quiet", "--no-checkout", shop.dir, dir]);
        return true;
      },
      meta: () => shop.meta,
      points: () => 5000,
      plans: () => ({ repository: Object.fromEntries(Array.from({ length: 10 }, (_, j) => ["p" + j, { title: "t", body: "w ".repeat(130), createdAt: "2026-07-01T00:00:00Z", userContentEdits: { totalCount: 0, nodes: [] }, closingIssuesReferences: { nodes: [] } }])) }),
    };
    const frame: FrameRepo[] = [
      { repo: "fixture/shop", stars: 900, licence: "MIT", copyleft: false, type_prov: "mobile", topics: [], default_branch: "main", order: "1" },
      { repo: "x/broken", stars: 900, licence: "GPL-3.0", copyleft: true, type_prov: "mobile", topics: [], default_branch: "main", order: "2" },
      { repo: "y/other", stars: 900, licence: "GPL-3.0", copyleft: true, type_prov: "mobile", topics: [], default_branch: "main", order: "3" },
    ];
    const out: string[] = [];
    const reads = recount({ frame: frame.slice(0, 2), work: join(t.dir, "work"), out: join(t.dir, "out"), usable: 1, types: ["mobile"], exclude: new Set(), minedAt: "2026-11-08", miner, io: { out: (s) => out.push(s), err: () => {} } });
    expect(clones.every((d) => !existsSync(d))).toBe(true);
    const all = reads.find((r) => r.group === "all")!;
    expect(all).toMatchObject({ frame: 2, tried: 2, usable: 0 });
    const table = readFileSync(join(t.dir, "out", "funnel.md"), "utf8");
    expect(table).not.toContain("fixture/shop");
    expect(table).toBe(funnelTable(reads));
    expect(JSON.parse(readFileSync(join(t.dir, "work", "repos", readdirSync(join(t.dir, "work", "repos"))[0]!), "utf8")).why).toMatch(/under_20_window_changes|clone_failed/);
  });
  test("counts a mined repository at the 120-word floor, caps it and projects it to the frame, with and without copyleft", () => {
    const r = mineClone({ repoDir: shop.dir, repo: "fixture/shop", licence: "MIT", branch: "main", meta: shop.meta, minedAt: "2026-11-08" });
    withPlans(r, () => ({ repository: Object.fromEntries(Array.from({ length: 10 }, (_, j) => ["p" + j, { title: "t", body: "w ".repeat(120), createdAt: "2026-07-01T00:00:00Z", userContentEdits: { totalCount: 0, nodes: [] }, closingIssuesReferences: { nodes: [] } }])) }));
    const c = countRepo(r, "mobile", false, new Set(), 7);
    expect(c).toMatchObject({ usable: true, plan120: 2, keyable: { strict: { w1: 1, w2: 0 }, wide: { w1: 2, w2: 0 } }, capped: { strict: 1, wide: 2 }, graphql_points: 7 });
    const ex = countRepo(r, "mobile", false, new Set([shop.sha.u2!]), 0);
    expect(ex.capped.strict).toBe(0);
    const frame = (n: number, copyleft: boolean) => Array.from({ length: n }, (_, i) => ({ repo: (copyleft ? "g/" : "p/") + i, copyleft, type_prov: "mobile" })) as FrameRepo[];
    const counts = [c, { ...c, repo: "g/0", copyleft: true, capped: { strict: 3, wide: 3 } }];
    const all = readType("mobile", "all", [...frame(10, false), ...frame(30, true)], counts);
    const perm = readType("mobile", "permissive", [...frame(10, false), ...frame(30, true)], counts);
    expect(all).toMatchObject({ frame: 40, tried: 2, capped_strict: 4, projection_strict: 80, projection_strict_at_precision: 36 });
    expect(perm).toMatchObject({ frame: 10, tried: 1, capped_strict: 1, projection_strict: 10, projection_strict_at_precision: 5 });
  });
});

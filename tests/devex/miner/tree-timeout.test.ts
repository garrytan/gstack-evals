// Copyright (c) 2026 Garry Tan. MIT License.
// The base-tree walk when GitHub cannot answer a tree query in time: the batch halves, and a folder that still fails
// alone marks the tree truncated, so the base-under-150mb rule drops the unit. Both sides, on a fake GraphQL client.
import { expect, test } from "bun:test";
import { baseTree } from "../../../lanes/devex/mine/github.ts";

const SHA = "a".repeat(40);
const TREES: Record<string, Array<{ name: string; type: string; oid: string; size?: number }>> = {
  root: [{ name: "src", type: "tree", oid: "o-src" }, { name: "vendor", type: "tree", oid: "o-vendor" }, { name: "README.md", type: "blob", oid: "b1", size: 5 }],
  "o-src": [{ name: "main.ts", type: "blob", oid: "b2", size: 3 }],
  "o-vendor": [{ name: "lib.js", type: "blob", oid: "b3", size: 7 }],
};

function fakeGh(slow: Set<string>) {
  const batches: number[] = [];
  return {
    batches,
    graphql(query: string) {
      if (query.includes("licenseInfo")) return { repository: { licenseInfo: { spdxId: "MIT" }, defaultBranchRef: { target: { tree: { entries: [] } } } } };
      const aliases = [...query.matchAll(/t(\d+): object\((?:oid: "([^"]+)"|expression: "[^"]+")\)/g)].map((m) => ({ alias: "t" + m[1], oid: m[2] ?? "root" }));
      batches.push(aliases.length);
      if (aliases.some((a) => slow.has(a.oid))) throw Object.assign(new Error("gh api graphql failed: gh: HTTP 502"), { code: "E_MINE_SOURCE" });
      return { repository: Object.fromEntries(aliases.map((a) => [a.alias, { entries: TREES[a.oid] }])) };
    },
  };
}

test("a tree batch GitHub cannot answer halves until the slow folder is alone, then the tree reads truncated", () => {
  const gh = fakeGh(new Set(["o-vendor"]));
  const t = baseTree(gh as never, "fixture-owner/fixture-repo", SHA);
  expect(t.truncated).toBe(true);
  expect(t.tree.map((e) => e.path)).toContain("src/main.ts");
  expect(t.tree.map((e) => e.path)).not.toContain("vendor/lib.js");
  expect(gh.batches).toEqual([1, 2, 1, 1]);
});

test("with no slow folder the walk lists everything and the tree is not truncated", () => {
  const gh = fakeGh(new Set());
  const t = baseTree(gh as never, "fixture-owner/fixture-repo", SHA);
  expect(t.truncated).toBe(false);
  expect(t.tree.map((e) => e.path).sort()).toEqual(["README.md", "src", "src/main.ts", "vendor", "vendor/lib.js"]);
  expect(t.licence).toBe(null);
});

test("any other GraphQL error still stops the walk", () => {
  const gh = { graphql: () => { throw Object.assign(new Error("gh api graphql failed: Could not resolve to a Repository"), { code: "E_MINE_SOURCE" }); } };
  expect(() => baseTree(gh as never, "fixture-owner/fixture-repo", SHA)).toThrow(/Could not resolve/);
});

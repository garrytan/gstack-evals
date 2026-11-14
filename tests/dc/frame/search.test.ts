// Copyright (c) 2026 Garry Tan. MIT License.
// The frame search: the pure query builder, the query's shape against a recorded invented reply, caching and pacing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME } from "../../../lanes/design-constructed/frozen.ts";
import { fakeGh, node } from "../../../lanes/design-constructed/frame/fixtures.ts";
import { openGitHub, assertGitHub, assertGhArgs } from "../../../lanes/design-constructed/frame/gh.ts";
import { buildSearchQuery, readNode, runSearch, SEARCH_QUERY, searchQueries } from "../../../lanes/design-constructed/frame/search.ts";

const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/search-reply.json"), "utf8"));

describe("buildSearchQuery", () => {
  test("is pure and words the search as section 8 does", () => {
    const a = buildSearchQuery("crm", "apache-2.0");
    expect(a).toEqual(buildSearchQuery("crm", "apache-2.0"));
    expect(a.variables).toEqual({ q: "topic:crm license:apache-2.0 sort:stars" });
    expect(a.query).toBe(SEARCH_QUERY);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(buildSearchQuery("crm", "isc").digest).not.toBe(a.digest);
  });

  test("50 queries, topic by topic in frozen order", () => {
    const qs = searchQueries();
    expect(qs.length).toBe(50);
    expect(qs[0]!.variables.q).toBe("topic:admin-dashboard license:mit sort:stars");
    expect(qs[49]!.variables.q).toBe("topic:self-hosted license:isc sort:stars");
    expect(new Set(qs.map((q) => q.topic + " " + q.licence)).size).toBe(FRAME.topics.length * FRAME.licenses.length);
  });

  test("the query asks for first 100, every node field the recorded reply holds, and rateLimit", () => {
    expect(SEARCH_QUERY).toContain("search(type: REPOSITORY, query: $q, first: 100)");
    const n = recorded.data.search.nodes[0];
    for (const k of Object.keys(n)) expect(SEARCH_QUERY).toContain(k);
    expect(SEARCH_QUERY).toContain("rateLimit { cost remaining resetAt }");
    expect(Object.keys(node("x/y")).sort()).toEqual(Object.keys(n).sort());
  });
});

describe("readNode on the recorded reply", () => {
  test("reads every field, the first README found and the head oid", () => {
    const [a, , b] = recorded.data.search.nodes;
    const ra = readNode(a, "d");
    expect(ra).toMatchObject({ nameWithOwner: "plumworks/orchard-desk", stars: 2431, spdxId: "MIT", language: "TypeScript", topics: ["helpdesk", "self-hosted"], defaultBranch: "main", headOid: "3f1c2b7a9d0e4f5a6b7c8d9e0f1a2b3c4d5e6f70" });
    expect(ra.readme).toContain("# Orchard Desk");
    const rb = readNode(b, "d");
    expect(rb.readme).toBe("Ledger Kit\n==========\n");
    expect(rb.isTemplate).toBe(true);
  });

  test("refuses a node missing a field the query asks for", () => {
    const n = { ...recorded.data.search.nodes[0] };
    delete n.isTemplate;
    expect(() => readNode(n, "d")).toThrow("isTemplate");
  });
});

describe("runSearch", () => {
  test("replays the recorded reply, skips null nodes and records the cost", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-search-"));
    try {
      const q = buildSearchQuery("helpdesk", "mit");
      const exec = (args: string[], input?: string) => {
        if (args[1] === "graphql") {
          expect(JSON.parse(input!)).toEqual({ query: q.query, variables: q.variables });
          return { status: 0, stdout: JSON.stringify(recorded), stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "unexpected" };
      };
      const gh = openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: 0, exec, sleep: () => {}, now: () => 0 });
      const r = runSearch(gh, dir, [q]);
      expect(r.queries).toEqual([{ topic: "helpdesk", licence: "mit", q: q.variables.q, digest: q.digest, cached: false, cost: 1, repositoryCount: 3, returned: 2, nullNodes: 1 }]);
      expect(r.repos.map((x) => x.nameWithOwner)).toEqual(["plumworks/orchard-desk", "quillfoundry/ledger-kit"]);
      expect(readdirSync(dir)).toEqual([q.digest + ".json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("paces requests at least 3 s apart and reuses the cache on a rerun", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-search-"));
    try {
      const f = fakeGh({});
      const gh = openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: FRAME.requestGapMs, exec: f.exec, sleep: f.sleep, now: f.now });
      runSearch(gh, dir);
      const at = f.log.map((l) => l.at);
      expect(Math.min(...at.slice(1).map((t, i) => t - at[i]!))).toBeGreaterThanOrEqual(3000);
      runSearch(gh, dir);
      expect(f.log.length).toBe(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("egress", () => {
  test("only HTTPS GitHub hosts pass", () => {
    expect(assertGitHub("https://github.com/a/b.git").hostname).toBe("github.com");
    expect(() => assertGitHub("https://git.example.invalid/a/b.git")).toThrow("egress refused");
    expect(() => assertGitHub("http://github.com/a/b.git")).toThrow("egress refused");
    expect(() => assertGhArgs(["api", "--hostname", "ghe.example.invalid", "rate_limit"])).toThrow("egress refused");
  });
});

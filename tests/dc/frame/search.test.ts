// Copyright (c) 2026 Garry Tan. MIT License.
// The frame search: the pure query builders, the query's shape against four recorded invented pages, paging, caching,
// pacing and the resend rule.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME } from "../../../lanes/design-constructed/frozen.ts";
import { fakeGh, node } from "../../../lanes/design-constructed/frame/fixtures.ts";
import { openGitHub, assertGitHub, assertGhArgs } from "../../../lanes/design-constructed/frame/gh.ts";
import { buildPageQuery, buildSearchQuery, readNode, runSearch, SEARCH_PAGE_SIZE, SEARCH_QUERY, SEARCH_RESEND, SEARCH_TRIES, SearchStop, searchQueries } from "../../../lanes/design-constructed/frame/search.ts";

const recorded = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/search-pages.json"), "utf8")).pages as any[];
const inDir = <T>(f: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "dc-search-"));
  try {
    return f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("query builders", () => {
  test("are pure and word the search as section 8 does, paged by $first and $after", () => {
    const a = buildSearchQuery("crm", "apache-2.0");
    expect(a).toEqual({ topic: "crm", licence: "apache-2.0", q: "topic:crm license:apache-2.0 sort:stars" });
    const p = buildPageQuery(a.q, null);
    expect(p).toEqual(buildPageQuery(a.q, null));
    expect(p.variables).toEqual({ q: a.q, first: 25, after: null });
    expect(p.query).toBe(SEARCH_QUERY);
    expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(buildPageQuery(a.q, "c1").digest).not.toBe(p.digest);
    expect(SEARCH_PAGE_SIZE * 4).toBe(FRAME.resultsPerQuery);
  });

  test("50 searches, topic by topic in frozen order", () => {
    const qs = searchQueries();
    expect(qs.length).toBe(50);
    expect(qs[0]!.q).toBe("topic:admin-dashboard license:mit sort:stars");
    expect(qs[49]!.q).toBe("topic:self-hosted license:isc sort:stars");
  });

  test("the query asks for a cursor page, pageInfo, every node field the recorded pages hold, and rateLimit", () => {
    expect(SEARCH_QUERY).toContain("query($q: String!, $first: Int!, $after: String)");
    expect(SEARCH_QUERY).toContain("search(type: REPOSITORY, query: $q, first: $first, after: $after)");
    expect(SEARCH_QUERY).toContain("pageInfo { hasNextPage endCursor }");
    for (const page of recorded) {
      expect(Object.keys(page.data.search).sort()).toEqual(["nodes", "pageInfo", "repositoryCount"]);
      for (const n of page.data.search.nodes.filter(Boolean)) for (const k of Object.keys(n)) expect(SEARCH_QUERY).toContain(k);
    }
    expect(SEARCH_QUERY).toContain("rateLimit { cost remaining resetAt }");
    expect(Object.keys(node("x/y")).sort()).toEqual(Object.keys(recorded[0].data.search.nodes[0]).sort());
  });
});

describe("readNode on the recorded pages", () => {
  test("reads every field, the first README found and the head oid", () => {
    const n = recorded[0].data.search.nodes[0];
    expect(readNode(n, "q")).toMatchObject({ nameWithOwner: n.nameWithOwner, stars: n.stargazerCount, spdxId: "MIT", language: "TypeScript", headOid: n.defaultBranchRef.target.oid, readme: n.readmeMd.text, query: "q" });
    const lower = recorded[0].data.search.nodes[3];
    expect(readNode(lower, "q").readme).toBe("Readme in lower case\n");
  });

  test("refuses a node missing a field the query asks for", () => {
    const n = { ...recorded[0].data.search.nodes[0] };
    delete n.isTemplate;
    expect(() => readNode(n, "d")).toThrow("isTemplate");
  });
});

describe("runSearch", () => {
  test("replays the four recorded pages, following each endCursor, in order", () =>
    inDir((dir) => {
      const q = buildSearchQuery("helpdesk", "mit");
      const sent: any[] = [];
      const exec = (args: string[], input?: string) => {
        const body = JSON.parse(input!);
        sent.push(body.variables);
        expect(body.query).toBe(SEARCH_QUERY);
        return { status: 0, stdout: JSON.stringify(recorded[sent.length - 1]), stderr: "" };
      };
      const gh = openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: 0, exec, sleep: () => {}, now: () => 0 });
      const r = runSearch(gh, dir, [q]);
      expect(sent.map((v) => v.after)).toEqual([null, ...recorded.slice(0, 3).map((p) => p.data.search.pageInfo.endCursor)]);
      expect(sent.every((v) => v.first === 25 && v.q === q.q)).toBe(true);
      const rec = r.queries[0]!;
      expect(rec.pages.map((p) => p.nodes)).toEqual([25, 25, 25, 10]);
      expect([rec.cost, rec.repositoryCount, rec.returned, rec.nullNodes, rec.cached]).toEqual([4, 85, 84, 1, 0]);
      const want = recorded.flatMap((p) => p.data.search.nodes).filter(Boolean).map((n: any) => n.nameWithOwner);
      expect(r.repos.map((x) => x.nameWithOwner)).toEqual(want);
      expect(readdirSync(dir).sort()).toEqual(rec.pages.map((p) => p.digest + ".json").sort());
    }));

  test("stops at 100 node slots even when GitHub says there is a next page", () =>
    inDir((dir) => {
      const q = buildSearchQuery("crm", "mit");
      const f = fakeGh({ [q.q]: Array.from({ length: 160 }, (_, i) => node("n" + i + "/r")) });
      const r = runSearch(openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: 0, exec: f.exec, sleep: f.sleep, now: f.now }), dir, [q]);
      expect(r.queries[0]!.pages.length).toBe(4);
      expect(r.repos.length).toBe(100);
    }));

  test("paces page requests at least 3 s apart and reads the cache on a second pass", () =>
    inDir((dir) => {
      const qs = searchQueries().slice(0, 3);
      const f = fakeGh(Object.fromEntries(qs.map((q, k) => [q.q, Array.from({ length: 60 }, (_, i) => node("k" + k + "i" + i + "/r"))])));
      const gh = openGitHub({ floor: 0, tries: 1, backoffMs: () => 0, paceMs: FRAME.requestGapMs, exec: f.exec, sleep: f.sleep, now: f.now });
      runSearch(gh, dir, qs);
      const at = f.log.map((l) => l.at);
      expect(f.log.length).toBe(9);
      expect(Math.min(...at.slice(1).map((t, i) => t - at[i]!))).toBeGreaterThanOrEqual(3000);
      runSearch(gh, dir, qs);
      expect(f.log.length).toBe(9);
    }));

  test("resends only HTTP 502, 504 and timeouts, at most 3 times; anything else stops at once", () =>
    inDir((dir) => {
      const q = searchQueries()[0]!;
      const open = (f: ReturnType<typeof fakeGh>) => openGitHub({ floor: 0, tries: SEARCH_TRIES, transient: SEARCH_RESEND, backoffMs: (n) => n * 5000, paceMs: 0, exec: f.exec, sleep: f.sleep, now: f.now });
      const ok = fakeGh({ [q.q]: [node("a/b")] }, { failures: [{ q: q.q, page: 1, kind: "502", times: 3 }] });
      expect(runSearch(open(ok), join(dir, "a"), [q]).repos.length).toBe(1);
      expect(ok.log.length).toBe(4);
      const all = fakeGh({}, { failures: [{ q: q.q, page: 1, kind: "timeout" }] });
      expect(() => runSearch(open(all), join(dir, "b"), [q])).toThrow(SearchStop);
      expect(all.log.length).toBe(4);
      const other = fakeGh({}, { failures: [{ q: q.q, page: 1, kind: "401" }] });
      try {
        runSearch(open(other), join(dir, "c"), [q]);
      } catch (e) {
        expect((e as SearchStop).errorClass).toBe("error that is not resendable");
      }
      expect(other.log.length).toBe(1);
      expect(readdirSync(join(dir, "c"))).toEqual([]);
    }));
});

describe("egress", () => {
  test("only HTTPS GitHub hosts pass", () => {
    expect(assertGitHub("https://github.com/a/b.git").hostname).toBe("github.com");
    expect(() => assertGitHub("https://git.example.invalid/a/b.git")).toThrow("egress refused");
    expect(() => assertGitHub("http://github.com/a/b.git")).toThrow("egress refused");
    expect(() => assertGhArgs(["api", "--hostname", "ghe.example.invalid", "rate_limit"])).toThrow("egress refused");
  });
});

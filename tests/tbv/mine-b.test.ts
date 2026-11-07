// Copyright (c) 2026 Garry Tan. MIT License.
// mine-b's paging (GEVA-361 pins addendum): one pull request per page, no partial page kept, and the record count checked
// against GitHub's totalCount with no repeats; then each record whole: a commit's check suites past the first 10 and a pull
// request's files past the first 100 are paged, and a connection still over its page is flagged truncated. A stand-in gh on
// PATH replays recorded page shapes and, as GitHub does, cuts the check suites and files it returns to the query's first:
// limits; GitHub is never called.
// Each mine-b runs in a child bun, since Bun.spawnSync resolves gh on the PATH the process started with.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromGraphql } from "../../lanes/tbv/history/source-b.ts";

const SOURCE_B = join(import.meta.dir, "../../lanes/tbv/history/source-b.ts");

const node = (n: number, o: Record<string, unknown> = {}) => ({
  number: n, state: "MERGED", title: "Change " + n, createdAt: "2026-11-01T10:00:00Z", mergedAt: "2026-11-01T12:00:00Z", closedAt: "2026-11-01T12:00:00Z", baseRefName: "main", headRefName: "b/" + n,
  closingIssuesReferences: { totalCount: 0, nodes: [] },
  files: { totalCount: 1, nodes: [{ path: "src/a.ts", additions: 1, deletions: 0 }] },
  commits: { totalCount: 1, nodes: [{ commit: { oid: String(n % 10).repeat(40), message: "change " + n, authoredDate: "2026-11-01T10:05:00Z", committedDate: "2026-11-01T10:05:00Z", checkSuites: { totalCount: 1, nodes: [{ checkRuns: { totalCount: 1, nodes: [{ name: "test", conclusion: "SUCCESS", status: "COMPLETED", title: null, summary: null, text: null }] } }] } } }] },
  reviewThreads: { totalCount: 0, nodes: [] },
  reviews: { totalCount: 0, nodes: [] },
  ...o,
});
const page = (nodes: unknown[], total: number, next: string | null) => ({ data: { repository: { pullRequests: { totalCount: total, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } });
/** The shape GEVA-361 recorded at page 5 with first:5: data with the over-limit connections nulled, plus an errors array. */
const LIMITED = (() => {
  const p = page([node(2, { commits: { totalCount: 1, nodes: [{ commit: { oid: "2".repeat(40), message: "m", authoredDate: "2026-11-01T10:05:00Z", committedDate: "2026-11-01T10:05:00Z", checkSuites: { totalCount: 1, nodes: [{ checkRuns: null }] } } }] } })], 3, "c2");
  const at = ["repository", "pullRequests", "nodes", 0, "commits", "nodes", 0, "commit", "checkSuites", "nodes", 0, "checkRuns"];
  return { ...p, errors: [{ type: "RESOURCE_LIMITS_EXCEEDED", path: at, locations: [{ line: 6, column: 124 }], message: "Resource limits for this query exceeded." }] };
})();

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A gh on PATH that answers each cursor (the first page under "") with a recorded body and exit code, and logs its argv. */
function fakeGh(pages: Record<string, { rc: number; body: unknown }>) {
  const dir = mkdtempSync(join(tmpdir(), "tbv-fake-gh-"));
  dirs.push(dir);
  writeFileSync(join(dir, "pages.json"), JSON.stringify(pages));
  writeFileSync(join(dir, "gh.ts"), [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "const args = process.argv.slice(2);",
    "appendFileSync(" + JSON.stringify(join(dir, "calls.log")) + ", JSON.stringify(args) + '\\n');",
    "if (readFileSync(" + JSON.stringify(join(dir, "calls.log")) + ", 'utf8').trim().split('\\n').length > 20) { process.stdout.write('{}'); process.exit(3); }",
    "const c = args.find((a) => a.startsWith('cursor='));",
    "const p = JSON.parse(readFileSync(" + JSON.stringify(join(dir, "pages.json")) + ", 'utf8'))[c ? c.slice(7) : ''];",
    "const q = args.find((a) => a.startsWith('query=')) ?? '';",
    "const first = (name) => Number(q.match(new RegExp(name + '\\\\(first:(\\\\d+)'))?.[1] ?? Infinity);",
    "const cut = (conn, name) => { if (Array.isArray(conn?.nodes)) conn.nodes = conn.nodes.slice(0, first(name)); };",
    "const repo = p.body?.data?.repository;",
    "for (const n of repo?.pullRequests?.nodes ?? []) { cut(n?.files, 'files'); for (const c of n?.commits?.nodes ?? []) cut(c?.commit?.checkSuites, 'checkSuites'); }",
    "cut(repo?.pullRequest?.files, 'files');",
    "cut(repo?.object?.checkSuites, 'checkSuites');",
    "process.stdout.write(JSON.stringify(p.body));",
    "if (p.rc) process.stderr.write('gh: Resource limits for this query exceeded.\\n');",
    "process.exit(p.rc);",
  ].join("\n"));
  writeFileSync(join(dir, "gh"), "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(join(dir, "gh.ts")) + ' "$@"\n');
  chmodSync(join(dir, "gh"), 0o755);
  const calls = () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]) : []);
  const out = join(dir, "out", "prs.json");
  /** mine-b in a child bun with this gh first on PATH: its exit code and stdout lines, or the reason code it threw. */
  const mine = (): { rc?: number; out?: string[]; code?: string } => {
    const code = "import { run } from " + JSON.stringify(SOURCE_B) + "; const out = []; try { const rc = await run(['mine-b', '--out', " + JSON.stringify(out) + "], { out: (t) => out.push(t), err: () => {} }); console.log(JSON.stringify({ rc, out })); } catch (e) { console.log(JSON.stringify({ code: e.code ?? String(e) })); }";
    const p = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, PATH: dir + ":" + (process.env.PATH ?? "") } });
    return JSON.parse(p.stdout.toString().trim().split("\n").at(-1) || "{}");
  };
  return { calls, out, mine };
}
const GOOD = { "": { rc: 0, body: page([node(1)], 3, "c1") }, c1: { rc: 0, body: page([node(2)], 3, "c2") }, c2: { rc: 0, body: page([node(3)], 3, null) } };

test("mine-b asks for one pull request per page, follows the cursors, and keeps the tbv-prs.v1 record shape", () => {
  const g = fakeGh(GOOD);
  const r = g.mine();
  expect(r.rc).toBe(0);
  const calls = g.calls();
  expect(calls.length).toBe(3);
  for (const c of calls) expect(c.find((a) => a.startsWith("query="))).toContain("pullRequests(first:1,");
  expect(calls.map((c) => c.find((a) => a.startsWith("cursor=")) ?? "")).toEqual(["", "cursor=c1", "cursor=c2"]);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect(Object.keys(file)).toEqual(["schema", "repo", "prs", "skipped"]);
  expect([file.schema, file.repo, file.prs.map((r: { number: number }) => r.number), file.skipped]).toEqual(["tbv-prs.v1", "garrytan/gstack-evals", [1, 2, 3], []]);
  expect(file.prs[0]).toEqual(fromGraphql(node(1)));
  expect(r.out).toEqual(["mined 3 pull requests, skipped 0 truncated records"]);
});

test("a page that carries an errors array fails closed even when gh exits 0 with data, and writes nothing", () => {
  const g = fakeGh({ ...GOOD, c1: { rc: 0, body: LIMITED } });
  expect(g.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(g.out)).toBe(false);
});

test("the recorded Resource limits reply (exit 1 with partial data) fails closed and writes nothing", () => {
  const g = fakeGh({ ...GOOD, c1: { rc: 1, body: LIMITED } });
  expect(g.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(g.out)).toBe(false);
});

test("a pull request repeated across pages, or a record count short of totalCount, fails closed", () => {
  const repeat = fakeGh({ ...GOOD, c1: { rc: 0, body: page([node(1)], 3, "c2") } });
  expect(repeat.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(repeat.out)).toBe(false);
  const short = fakeGh({ "": { rc: 0, body: page([node(1)], 4, "c1") }, c1: { rc: 0, body: page([node(2)], 4, "c2") }, c2: { rc: 0, body: page([node(3)], 4, null) } });
  expect(short.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(short.out)).toBe(false);
});

const suite = (i: number, runs = 1) => ({ checkRuns: { totalCount: runs, nodes: Array.from({ length: Math.min(runs, 20) }, (_, j) => ({ name: "suite " + (i + 1) + (j ? " run " + (j + 1) : ""), conclusion: "SUCCESS", status: "COMPLETED", title: null, summary: null, text: null })) } });
const suiteNames = (k: number) => Array.from({ length: k }, (_, i) => "suite " + (i + 1));
/** #n's one commit has k check suites: the pull request page holds the first 10, with cursor s<n>-10 when more follow. */
const withSuites = (n: number, k: number, o: Record<number, number> = {}) => node(n, { commits: { totalCount: 1, nodes: [{ commit: { oid: String(n % 10).repeat(40), message: "change " + n, authoredDate: "2026-11-01T10:05:00Z", committedDate: "2026-11-01T10:05:00Z", checkSuites: { totalCount: k, pageInfo: { hasNextPage: k > 10, endCursor: "s" + n + "-10" }, nodes: Array.from({ length: k }, (_, i) => suite(i, o[i])) } } }] } });
const suitesPage = (n: number, total: number, from: number, to: number, more: boolean, cursor = "s" + n + "-" + to) => ({ data: { repository: { object: { checkSuites: { totalCount: total, pageInfo: { hasNextPage: more, endCursor: cursor }, nodes: Array.from({ length: to - from }, (_, i) => suite(from + i)) } } } } });
const SUITES_ASK = "object(oid:$oid){... on Commit{checkSuites(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor}";

test("a commit with 17 check suites, the most this repo's pull requests carry, pages the 7 past the first 10 and is kept whole", () => {
  const g = fakeGh({ "": { rc: 0, body: page([withSuites(1, 17)], 1, null) }, "s1-10": { rc: 0, body: suitesPage(1, 17, 10, 17, false) } });
  const r = g.mine();
  expect(r.rc).toBe(0);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect([file.prs.map((p: { number: number }) => p.number), file.skipped]).toEqual([[1], []]);
  expect(file.prs[0].commits[0].checks.map((c: { name: string }) => c.name)).toEqual(suiteNames(17));
  expect(r.out).toEqual(["mined 1 pull requests, skipped 0 truncated records"]);
  const calls = g.calls();
  expect(calls.length).toBe(2);
  expect(calls[0].find((a) => a.startsWith("query="))).toContain("checkSuites(first:10){totalCount pageInfo{hasNextPage endCursor}");
  expect(calls[1].find((a) => a.startsWith("query="))).toContain(SUITES_ASK);
  expect(calls[1].join(" ")).toContain("-f oid=" + "1".repeat(40) + " -f cursor=s1-10");
});

test("a commit with 125 check suites pages across two more queries and is kept whole", () => {
  const g = fakeGh({ "": { rc: 0, body: page([withSuites(2, 125)], 1, null) }, "s2-10": { rc: 0, body: suitesPage(2, 125, 10, 110, true) }, "s2-110": { rc: 0, body: suitesPage(2, 125, 110, 125, false) } });
  const r = g.mine();
  expect(r.rc).toBe(0);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect(file.prs[0].commits[0].checks.map((c: { name: string }) => c.name)).toEqual(suiteNames(125));
  expect(g.calls().map((c) => c.find((a) => a.startsWith("cursor=")) ?? "")).toEqual(["", "cursor=s2-10", "cursor=s2-110"]);
});

test("check suite paging that ends short of totalCount, or a suite with more check runs than its page, is still flagged truncated", () => {
  const g = fakeGh({
    "": { rc: 0, body: page([withSuites(1, 17)], 3, "c1") },
    "s1-10": { rc: 0, body: suitesPage(1, 17, 10, 15, false) },
    c1: { rc: 0, body: page([withSuites(2, 9, { 3: 21 })], 3, "c2") },
    c2: { rc: 0, body: page([withSuites(3, 9, { 3: 20 })], 3, null) },
  });
  const r = g.mine();
  expect(r.rc).toBe(0);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect([file.prs.map((p: { number: number }) => p.number), file.skipped.map((s: { number: number }) => s.number)]).toEqual([[3], [1, 2]]);
  expect(r.out).toEqual(["mined 1 pull requests, skipped 2 truncated records"]);
});

const fileNodes = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ path: "src/f" + (from + i) + ".ts", additions: from + i, deletions: 1 }));
const filesPage = (total: number, from: number, to: number, more: boolean, cursor = "f" + to) => ({ data: { repository: { pullRequest: { files: { totalCount: total, pageInfo: { hasNextPage: more, endCursor: cursor }, nodes: fileNodes(from, to) } } } } });
/** #7 has 233 files: the first page holds 100 of them, and the rest come from the files query at cursors f100 and f200. */
const WIDE = node(7, { files: { totalCount: 233, pageInfo: { hasNextPage: true, endCursor: "f100" }, nodes: fileNodes(0, 233) } });
const WIDE_PAGES = { "": { rc: 0, body: page([WIDE], 1, null) }, f100: { rc: 0, body: filesPage(233, 100, 200, true) }, f200: { rc: 0, body: filesPage(233, 200, 233, false) } };

test("a pull request with 233 files pages its files in full and is kept", () => {
  const g = fakeGh(WIDE_PAGES);
  const r = g.mine();
  expect(r.rc).toBe(0);
  const calls = g.calls();
  expect(calls.length).toBe(3);
  for (const c of calls.slice(1)) {
    expect(c.find((a) => a.startsWith("query="))).toContain("pullRequest(number:$number){files(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor}");
    expect(c.join(" ")).toContain("-F number=7");
  }
  expect(calls.map((c) => c.find((a) => a.startsWith("cursor=")) ?? "")).toEqual(["", "cursor=f100", "cursor=f200"]);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect(file.skipped).toEqual([]);
  expect(file.prs[0].files).toEqual(fileNodes(0, 233));
  expect(r.out).toEqual(["mined 1 pull requests, skipped 0 truncated records"]);
});

test("files paging that ends short of totalCount leaves the record flagged truncated", () => {
  const g = fakeGh({ ...WIDE_PAGES, f200: { rc: 0, body: filesPage(233, 200, 220, false) } });
  const r = g.mine();
  expect(r.rc).toBe(0);
  const file = JSON.parse(readFileSync(g.out, "utf8"));
  expect([file.prs, file.skipped.map((s: { number: number }) => s.number)]).toEqual([[], [7]]);
  expect(r.out).toEqual(["mined 0 pull requests, skipped 1 truncated records"]);
});

test("a files or check suite page with an errors array, no page, a changed totalCount, no nodes or a cursor that does not move fails closed and writes nothing", () => {
  const limit = { errors: [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "Resource limits for this query exceeded." }] };
  const kinds = [
    { pages: WIDE_PAGES, at: "f100", empty: { data: { repository: { pullRequest: null } } }, of: (total: number, to: number, cursor: string) => filesPage(total, 100, to, true, cursor) },
    { pages: { "": { rc: 0, body: page([withSuites(1, 125)], 1, null) } }, at: "s1-10", empty: { data: { repository: { object: null } } }, of: (total: number, to: number, cursor: string) => suitesPage(1, total, 10, to - 90, true, cursor) },
  ];
  for (const k of kinds) {
    const cases = [
      { rc: 0, body: { ...k.of(k.at === "f100" ? 233 : 125, 200, "x"), ...limit } },
      { rc: 1, body: { ...k.of(k.at === "f100" ? 233 : 125, 200, "x"), ...limit } },
      { rc: 0, body: k.empty },
      { rc: 0, body: k.of(k.at === "f100" ? 234 : 126, 200, "x") },
      { rc: 0, body: k.of(k.at === "f100" ? 233 : 125, 100, "x") },
      { rc: 0, body: k.of(k.at === "f100" ? 233 : 125, 200, k.at) },
    ];
    for (const body of cases) {
      const g = fakeGh({ ...k.pages, [k.at]: body });
      expect(g.mine().code).toBe("E_TBV_INPUT");
      expect(g.calls().length).toBe(2);
      expect(existsSync(g.out)).toBe(false);
    }
  }
});

test("files or check suite paging that returns more nodes than totalCount fails closed and writes nothing", () => {
  const files = fakeGh({ ...WIDE_PAGES, f200: { rc: 0, body: filesPage(233, 200, 240, false) } });
  expect(files.mine().code).toBe("E_TBV_INPUT");
  expect(files.calls().length).toBe(3);
  expect(existsSync(files.out)).toBe(false);
  const suites = fakeGh({ "": { rc: 0, body: page([withSuites(1, 17)], 1, null) }, "s1-10": { rc: 0, body: suitesPage(1, 17, 10, 18, false) } });
  expect(suites.mine().code).toBe("E_TBV_INPUT");
  expect(suites.calls().length).toBe(2);
  expect(existsSync(suites.out)).toBe(false);
});

test("files paging whose cursor cycles fails closed at the page that passes totalCount and writes nothing", () => {
  const g = fakeGh({ ...WIDE_PAGES, f100: { rc: 0, body: filesPage(233, 100, 200, true, "f200") }, f200: { rc: 0, body: filesPage(233, 200, 300, true, "f100") } });
  expect(g.mine().code).toBe("E_TBV_INPUT");
  expect(g.calls().length).toBe(3);
  expect(existsSync(g.out)).toBe(false);
});

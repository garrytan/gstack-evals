// Copyright (c) 2026 Garry Tan. MIT License.
// mine-b's paging (GEVA-361 pins addendum): one pull request per page, no partial page kept, and the record count checked
// against GitHub's totalCount with no repeats. A stand-in gh on PATH replays recorded page shapes; GitHub is never called.
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
    "const c = args.find((a) => a.startsWith('cursor='));",
    "const p = JSON.parse(readFileSync(" + JSON.stringify(join(dir, "pages.json")) + ", 'utf8'))[c ? c.slice(7) : ''];",
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

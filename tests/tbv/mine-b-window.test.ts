// Copyright (c) 2026 Garry Tan. MIT License.
// mine-b for held-out source B (amendment 2 section 4, items 1 and 2): every check suite's check runs are paged, so a
// suite past checkRuns(first:20) comes through whole; and with --merged-after, full records come only for pull requests
// merged in the window, every other closed or merged pull request is kept as a lineage stub for the cluster rule, and
// each record carries its author. A stand-in gh on PATH answers each query kind from recorded shapes; GitHub is never
// called. Each mine-b runs in a child bun, since Bun.spawnSync resolves gh on the PATH the process started with.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineageOf } from "../../lanes/tbv/history/source-b.ts";

const SOURCE_B = join(import.meta.dir, "../../lanes/tbv/history/source-b.ts");
const P = "2026-11-08T10:28:37Z";
const at = (s: number) => new Date(Date.parse(P) + s * 1000).toISOString().replace(".000Z", "Z");

const run = (name: string) => ({ name, conclusion: "SUCCESS", status: "COMPLETED", title: null, summary: null, text: null });
const runs = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => run("check " + (from + i + 1)));
/** One check suite whose first page holds min(k, 20) of its k runs, with cursor r<n>-20 when more follow. */
const suite = (n: number, k: number) => ({ id: "S" + n, checkRuns: { totalCount: k, pageInfo: { hasNextPage: k > 20, endCursor: "r" + n + "-20" }, nodes: runs(0, Math.min(k, 20)) } });
const full = (n: number, o: Record<string, unknown> = {}, k = 1) => ({
  number: n, state: "MERGED", title: "Change " + n, author: { login: "garrytan" }, createdAt: at(60), mergedAt: at(3600), closedAt: at(3600), baseRefName: "main", headRefName: "b/" + n,
  closingIssuesReferences: { totalCount: 0, nodes: [] },
  files: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ path: "src/a.ts", additions: 1, deletions: 0 }] },
  commits: { totalCount: 1, nodes: [{ commit: { oid: String(n % 10).repeat(40), message: "change " + n, authoredDate: at(120), committedDate: at(120), checkSuites: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [suite(n, k)] } } }] },
  reviewThreads: { totalCount: 0, nodes: [] },
  reviews: { totalCount: 0, nodes: [] },
  ...o,
});
const stub = (n: number, o: Record<string, unknown> = {}) => ({ number: n, state: "MERGED", createdAt: at(60), mergedAt: at(3600), title: "Change " + n, baseRefName: "main", headRefName: "b/" + n, closingIssuesReferences: { totalCount: 0, nodes: [] }, ...o });
const runsPage = (n: number, total: number, from: number, to: number, more: boolean) => ({ data: { node: { checkRuns: { totalCount: total, pageInfo: { hasNextPage: more, endCursor: "r" + n + "-" + to }, nodes: runs(from, to) } } } });
const fullPage = (nodes: unknown[], total: number, next: string | null) => ({ data: { repository: { pullRequests: { totalCount: total, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } });
const stubPage = fullPage;

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A gh on PATH that answers by query kind: the one-per-page walk (full:<cursor>), the stub walk (stubs:<cursor>), one pull
 * request by number (pr:<n>) and a check suite's runs (runs:<cursor>). It logs every argv and answers {} past 40 calls. */
function fakeGh(answers: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "tbv-fake-gh-window-"));
  dirs.push(dir);
  writeFileSync(join(dir, "answers.json"), JSON.stringify(answers));
  writeFileSync(join(dir, "gh.ts"), [
    'import { appendFileSync, readFileSync } from "node:fs";',
    "const args = process.argv.slice(2);",
    "const log = " + JSON.stringify(join(dir, "calls.log")) + ";",
    "appendFileSync(log, JSON.stringify(args) + '\\n');",
    "if (readFileSync(log, 'utf8').trim().split('\\n').length > 40) { process.stdout.write('{}'); process.exit(3); }",
    "const v = (k) => (args.find((a) => a.startsWith(k + '=')) ?? '').slice(k.length + 1);",
    "const q = v('query');",
    "const kind = q.includes('node(id:$id)') ? 'runs:' + v('cursor') : q.includes('pullRequest(number:$number)') ? 'pr:' + v('number') : q.includes('pullRequests(first:50,') ? 'stubs:' + v('cursor') : 'full:' + v('cursor');",
    "const a = JSON.parse(readFileSync(" + JSON.stringify(join(dir, "answers.json")) + ", 'utf8'))[kind];",
    "process.stdout.write(JSON.stringify(a === undefined ? { errors: [{ type: 'UNEXPECTED', message: kind }] } : a));",
  ].join("\n"));
  writeFileSync(join(dir, "gh"), "#!/bin/sh\nexec " + JSON.stringify(process.execPath) + " " + JSON.stringify(join(dir, "gh.ts")) + ' "$@"\n');
  chmodSync(join(dir, "gh"), 0o755);
  const calls = () => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]) : []);
  const out = join(dir, "out", "prs.json");
  const mine = (flags: string[] = []): { rc?: number; out?: string[]; code?: string } => {
    const code = "import { run } from " + JSON.stringify(SOURCE_B) + "; const out = []; try { const rc = await run(" + JSON.stringify(["mine-b", "--out", out, ...flags]) + ", { out: (t) => out.push(t), err: () => {} }); console.log(JSON.stringify({ rc, out })); } catch (e) { console.log(JSON.stringify({ code: e.code ?? String(e) })); }";
    const p = Bun.spawnSync([process.execPath, "-e", code], { env: { ...process.env, PATH: dir + ":" + (process.env.PATH ?? "") } });
    return JSON.parse(p.stdout.toString().trim().split("\n").at(-1) || "{}");
  };
  return { calls, out, mine, kinds: () => calls().map((c) => { const q = c.find((a) => a.startsWith("query=")) ?? ""; return q.includes("node(id:$id)") ? "runs" : q.includes("pullRequest(number:$number)") ? "pr" : q.includes("pullRequests(first:50,") ? "stubs" : "full"; }) };
}
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("a check suite with 30 runs, past checkRuns(first:20), pages the other 10 and the record is kept whole", () => {
  const g = fakeGh({ "full:": fullPage([full(1, {}, 30)], 1, null), "runs:r1-20": runsPage(1, 30, 20, 30, false) });
  const r = g.mine();
  expect(r.rc).toBe(0);
  const file = read(g.out);
  expect([file.prs.map((p: { number: number }) => p.number), file.skipped]).toEqual([[1], []]);
  expect(file.prs[0].commits[0].checks.map((c: { name: string }) => c.name)).toEqual(runs(0, 30).map((x) => x.name));
  const ask = g.calls()[1]!;
  expect(ask.find((a) => a.startsWith("query="))).toContain("node(id:$id){... on CheckSuite{checkRuns(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor}");
  expect(ask).toContain("id=S1");
  expect(ask).toContain("cursor=r1-20");
  expect(g.calls()[0]!.find((a) => a.startsWith("query="))).toContain("checkRuns(first:20){totalCount pageInfo{hasNextPage endCursor}");
});

test("check run paging that ends short of totalCount leaves the record flagged truncated; a changed totalCount or a stuck cursor fails closed", () => {
  const short = fakeGh({ "full:": fullPage([full(1, {}, 30)], 1, null), "runs:r1-20": runsPage(1, 30, 20, 25, false) });
  expect(short.mine().rc).toBe(0);
  expect([read(short.out).prs, read(short.out).skipped.map((s: { number: number }) => s.number)]).toEqual([[], [1]]);
  const changed = fakeGh({ "full:": fullPage([full(1, {}, 30)], 1, null), "runs:r1-20": runsPage(1, 31, 20, 30, false) });
  expect(changed.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(changed.out)).toBe(false);
  const stuck = fakeGh({ "full:": fullPage([full(1, {}, 30)], 1, null), "runs:r1-20": { data: { node: { checkRuns: { totalCount: 30, pageInfo: { hasNextPage: true, endCursor: "r1-20" }, nodes: runs(20, 25) } } } } });
  expect(stuck.mine().code).toBe("E_TBV_INPUT");
  expect(existsSync(stuck.out)).toBe(false);
});

test("every record carries its author's login, and a pull request with no author keeps null", () => {
  const g = fakeGh({ "full:": fullPage([full(1)], 2, "c1"), "full:c1": fullPage([full(2, { author: null })], 2, null) });
  expect(g.mine().rc).toBe(0);
  expect(read(g.out).prs.map((p: { author: unknown }) => p.author)).toEqual(["garrytan", null]);
});

const WINDOW = {
  "stubs:": stubPage([stub(1, { createdAt: at(-90000), mergedAt: at(-3600) }), stub(2, { state: "CLOSED", mergedAt: null }), stub(3)], 6, "s3"),
  "stubs:s3": stubPage([stub(4, { mergedAt: at(90000) }), stub(5), stub(6, { mergedAt: P })], 6, null),
  "pr:3": { data: { repository: { pullRequest: full(3) } } },
  "pr:5": { data: { repository: { pullRequest: full(5, { author: { login: "outside-dev" } }) } } },
};

test("--merged-after reads stubs for every closed or merged pull request and full records only for those merged in the window", () => {
  const g = fakeGh(WINDOW);
  const r = g.mine(["--repo", "garrytan/gstack", "--merged-after", P, "--merged-before", at(86400)]);
  expect(r.rc).toBe(0);
  const file = read(g.out);
  expect(Object.keys(file)).toEqual(["schema", "repo", "window", "prs", "skipped", "lineage"]);
  expect([file.schema, file.repo, file.window]).toEqual(["tbv-prs.v1", "garrytan/gstack", { mergedAfter: P, mergedBefore: at(86400) }]);
  expect(file.prs.map((p: { number: number; author: string }) => [p.number, p.author])).toEqual([[3, "garrytan"], [5, "outside-dev"]]);
  expect(file.lineage.map((s: { number: number }) => s.number)).toEqual([1, 2, 4, 6]);
  expect(file.lineage[0]).toEqual({ number: 1, createdAt: at(-90000), title: "Change 1", baseRefName: "main", headRefName: "b/1", closingIssues: [] });
  expect(file.lineage[0]).toEqual(lineageOf(stub(1, { createdAt: at(-90000), mergedAt: at(-3600) })));
  expect(file.skipped).toEqual([]);
  expect(g.kinds()).toEqual(["stubs", "stubs", "pr", "pr"]);
  expect(g.calls().filter((c) => c.some((a) => a.startsWith("number="))).map((c) => c.find((a) => a.startsWith("number=")))).toEqual(["number=3", "number=5"]);
  expect(g.calls()[0]!.find((a) => a.startsWith("query="))).toContain("states:[MERGED,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}");
  expect(r.out).toEqual(["mined 2 pull requests merged in the window, skipped 0 truncated records, kept 4 lineage records outside it"]);
});

test("with no --merged-before the window stays open at the top, and a pull request that comes back truncated is a skipped stub", () => {
  const g = fakeGh({ ...WINDOW, "pr:5": { data: { repository: { pullRequest: full(5, { files: { totalCount: 101, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }) } } }, "pr:4": { data: { repository: { pullRequest: full(4, { mergedAt: at(90000) }) } } } });
  expect(g.mine(["--repo", "garrytan/gstack", "--merged-after", P]).rc).toBe(0);
  const file = read(g.out);
  expect(file.window).toEqual({ mergedAfter: P, mergedBefore: null });
  expect(file.prs.map((p: { number: number }) => p.number)).toEqual([3, 4]);
  expect(file.skipped.map((s: { number: number }) => s.number)).toEqual([5]);
  expect(file.lineage.map((s: { number: number }) => s.number)).toEqual([1, 2, 6]);
});

test("the window fails closed: a stub count short of totalCount, a stub on two pages, an errors array, a pull request the query cannot find", () => {
  const short = fakeGh({ ...WINDOW, "stubs:s3": stubPage([stub(4), stub(5)], 6, null) });
  expect(short.mine(["--merged-after", P]).code).toBe("E_TBV_INPUT");
  expect(existsSync(short.out)).toBe(false);
  const twice = fakeGh({ ...WINDOW, "stubs:s3": stubPage([stub(3), stub(5), stub(6)], 6, null) });
  expect(twice.mine(["--merged-after", P]).code).toBe("E_TBV_INPUT");
  const errors = fakeGh({ ...WINDOW, "stubs:s3": { ...stubPage([stub(4), stub(5), stub(6)], 6, null), errors: [{ type: "RESOURCE_LIMITS_EXCEEDED", message: "limit" }] } });
  expect(errors.mine(["--merged-after", P]).code).toBe("E_TBV_INPUT");
  const gone = fakeGh({ ...WINDOW, "pr:5": { data: { repository: { pullRequest: null } } } });
  expect(gone.mine(["--merged-after", P]).code).toBe("E_TBV_INPUT");
  expect(existsSync(gone.out)).toBe(false);
});

test("mine-b refuses a repository outside the two source B repositories, a window that is not a time, and a top at or before the bottom", () => {
  for (const flags of [["--repo", "someone/else"], ["--merged-after", "yesterday"], ["--merged-after", P, "--merged-before", P], ["--merged-before", at(60)]]) {
    const g = fakeGh(WINDOW);
    const r = g.mine(flags);
    expect(r.code === "E_TBV_INPUT" || r.code === "E_USAGE").toBe(true);
    expect(g.calls()).toEqual([]);
    expect(existsSync(g.out)).toBe(false);
  }
});

// Copyright (c) 2026 Garry Tan. MIT License.
// Source B (prereg section 4, amendment section 2): this repo's pull requests, assembled from GitHub's record with no
// writer, gstack blocks stripped; lineage clusters; the dev window and held-out accrual.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../errors.ts";
import type { AssembleResult, History, HistoryEvent, Io } from "../types.ts";
import { historySha256, refuseOutsideRules } from "./events.ts";

/** One pull request as mine-b records it from GraphQL. */
export interface PrRecord {
  number: number;
  state: "MERGED" | "CLOSED";
  title: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  headRefName: string;
  closingIssues: number[];
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ oid: string; message: string; authoredDate: string; committedDate: string; checks: Array<{ name: string; conclusion: string | null; status: string; title: string | null; summary: string | null; text: string | null }> }>;
  reviewThreads: Array<{ isResolved: boolean; comments: Array<{ author: string | null; body: string }> }>;
  reviews: Array<{ author: string | null; body: string }>;
}

/** The Bash calls a source B history is made of; extract.ts reads the rounds back by these commands. */
export const B_CALLS = {
  log: (oid: string) => "git log -1 --format='commit %H%nAuthorDate: %aI%nCommitDate: %cI%n%n%B' " + oid,
  checks: (oid: string) => "gh api repos/{owner}/{repo}/commits/" + oid + "/check-runs",
  numstat: (base: string, head: string) => "git diff --numstat " + base + "..." + head,
  findings: (n: number) => "gh api graphql -F number=" + n + " -f query=@review-threads.graphql",
  isChecks: /^gh api repos\/\{owner\}\/\{repo\}\/commits\/\S+\/check-runs$/,
  isNumstat: /^git diff --numstat /,
  isFindings: /^gh api graphql -F number=\d+ -f query=@review-threads\.graphql$/,
};
const isCapy = (login: string | null) => (login ?? "").startsWith("capy");

export function assembleB(pr: PrRecord, cluster: string): AssembleResult {
  const task = "pr-" + pr.number;
  if (!pr.commits.length) return { ok: false, drop: "no_commits", detail: task + " has no commits" };
  const events: HistoryEvent[] = [];
  const call = (command: string, content: string) => {
    const id = "toolu_" + task.replace("-", "") + "_" + (events.length + 1);
    events.push({ n: events.length + 1, kind: "tool-use", id, name: "Bash", input: { command } });
    events.push({ n: events.length + 1, kind: "tool-result", tool_use_id: id, content, is_error: false });
  };
  events.push({ n: 1, kind: "user-text", text: "Get pull request #" + pr.number + " ready to merge.\n\nTitle: " + stripGstack(pr.title) + "\nBase: " + pr.baseRefName + "\nHead: " + pr.headRefName + "\n" });
  for (const c of pr.commits) {
    call(B_CALLS.log(c.oid), "commit " + c.oid + "\nAuthorDate: " + c.authoredDate + "\nCommitDate: " + c.committedDate + "\n\n" + stripGstack(c.message));
    const runs = c.checks.map((r) => ["== check " + r.name + ": " + (r.conclusion ?? r.status), ...[r.title, r.summary, r.text].map((t) => stripGstack(t ?? "")).filter((t) => t.trim())].join("\n"));
    call(B_CALLS.checks(c.oid), runs.length ? runs.join("\n\n") : "no check runs");
  }
  call(B_CALLS.numstat(pr.baseRefName, pr.headRefName), pr.files.map((f) => f.additions + "\t" + f.deletions + "\t" + f.path).join("\n"));
  const threads = pr.reviewThreads.filter((t) => t.comments.length && isCapy(t.comments[0].author));
  if (threads.length) call(B_CALLS.findings(pr.number), threads.map((t, i) => "== finding " + (i + 1) + ": " + (t.isResolved ? "resolved" : "unresolved") + "\n" + stripGstack(t.comments[0].body)).join("\n\n"));
  for (const e of events) refuseOutsideRules(e.kind === "tool-use" ? JSON.stringify(e.input) : e.kind === "tool-result" ? e.content : e.text, task + " event " + e.n);
  const history: History = { schema: "tbv-history.v1", source: "B", task, cluster, family: "ship", events, sha256: historySha256(events), side: { files: pr.files.map((f) => f.path), resolved: null, patch: null } };
  return { ok: true, history };
}

/** Strips gstack receipt and READY blocks wherever they appear, keeping the text around them. */
export function stripGstack(text: string): string {
  return text
    .replace(/```gstack-ship-receipt[^\n]*\n[\s\S]*?\n```[^\S\n]*\n?/g, "")
    .replace(/```[^\n]*\nREADY #\d+\b[\s\S]*?\n```[^\S\n]*\n?/g, "")
    .replace(/^READY #\d+\b.*(?:\n.+)*\n?/gm, "")
    .replace(/<!--\s*gstack[\s\S]*?-->/g, "")
    .replace(/^READY_EXIT=\d+.*\n?/gm, "");
}

/** Lineage clusters: same head branch, stacked bases, shared closing issue, shared code key. Returns pr number to cluster id. */
export function clustersOf(prs: Array<Pick<PrRecord, "number" | "title" | "baseRefName" | "headRefName" | "closingIssues">>): Map<number, string> {
  const parent = new Map(prs.map((p) => [p.number, p.number]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const groups = new Map<string, number[]>();
  const join = (key: string, n: number) => groups.set(key, [...(groups.get(key) ?? []), n]);
  for (const p of prs) {
    join("head:" + p.headRefName, p.number);
    for (const i of p.closingIssues) join("issue:" + i, p.number);
    for (const m of (p.title + " " + p.headRefName).matchAll(/\b([A-Za-z]{2,6}-\d+)\b/g)) join("key:" + m[1].toUpperCase(), p.number);
  }
  for (const p of prs) if (p.baseRefName !== "main") for (const n of groups.get("head:" + p.baseRefName) ?? []) union(p.number, n);
  for (const g of groups.values()) for (const n of g.slice(1)) union(g[0], n);
  return new Map(prs.map((p) => [p.number, "pr-" + find(p.number)]));
}

const time = (iso: string | null, what: string): number => {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(t)) fail("E_TBV_INPUT", what + " is not a time: " + JSON.stringify(iso));
  return t;
};

/** What mine-b keeps of a truncated record: the keys clustersOf reads and createdAt. A null is missing or truncated. */
export interface LineageStub {
  number: number;
  createdAt: string | null;
  title: string | null;
  baseRefName: string | null;
  headRefName: string | null;
  closingIssues: number[] | null;
}

/** The records heldOutEligible checks for pr: every kept record and skipped stub that may share its lineage cluster. Known
 * keys join as clustersOf joins them. A stub with a missing title or branch could join any record, so every record and
 * stub is returned. A stub with truncated closing issues could close any issue, so when pr's cluster holds a closing issue
 * or such a stub, every cluster that holds either joins it. Stubs never become histories. */
export function heldOutCluster(pr: PrRecord, prs: PrRecord[], skipped: LineageStub[]): Array<PrRecord | LineageStub> {
  const records = prs.some((p) => p.number === pr.number) ? prs : [...prs, pr];
  const all = [...records, ...skipped];
  if (skipped.some((s) => s.title === null || s.baseRefName === null || s.headRefName === null)) return all;
  const clusters = clustersOf(all.map((p) => ({ number: p.number, title: p.title!, baseRefName: p.baseRefName!, headRefName: p.headRefName!, closingIssues: p.closingIssues ?? [] })));
  const issueish = all.filter((p) => p.closingIssues === null || p.closingIssues.length > 0).map((p) => clusters.get(p.number));
  const mine = new Set([clusters.get(pr.number)]);
  if (skipped.some((s) => s.closingIssues === null) && issueish.some((c) => mine.has(c))) for (const c of issueish) mine.add(c);
  return all.filter((p) => mine.has(clusters.get(p.number)));
}

/** Amendment section 2 rule 2 and 3's cluster exclusion: merged and opened after P's post, no commit authored or committed before it, and no cluster sibling opened before it. cluster is heldOutCluster's: it already follows every link a missing or truncated key could make, so a member is read by its creation time alone. */
export function heldOutEligible(pr: PrRecord, cluster: Array<PrRecord | LineageStub>, pPostMergedAt: string): { ok: true } | { ok: false; why: string } {
  const p = time(pPostMergedAt, "P's post merge time");
  const no = (why: string) => ({ ok: false as const, why: "#" + pr.number + " " + why });
  if (pr.state !== "MERGED" || pr.mergedAt === null) return no("is not merged");
  if (!(time(pr.mergedAt, "mergedAt") > p)) return no("merged at " + pr.mergedAt + ", not after P's post");
  if (!(time(pr.createdAt, "createdAt") > p)) return no("was opened at " + pr.createdAt + ", not after P's post");
  for (const c of pr.commits) {
    if (time(c.authoredDate, "authoredDate") < p) return no("has commit " + c.oid.slice(0, 7) + " with author date " + c.authoredDate + " before P's post");
    if (time(c.committedDate, "committedDate") < p) return no("has commit " + c.oid.slice(0, 7) + " with committer date " + c.committedDate + " before P's post");
  }
  for (const s of cluster) {
    if (s.number === pr.number) continue;
    if (s.createdAt === null) return no("may share a lineage cluster with #" + s.number + ", a truncated record with no creation time");
    if (time(s.createdAt, "createdAt") <= p) return no("shares or may share a lineage cluster with #" + s.number + ", opened at " + s.createdAt + ", not after P's post");
  }
  return { ok: true };
}

/** Amendment section 2 rule 1: dev source B is merged before the scorer pin post. */
export function devEligible(pr: PrRecord, scorerPinMergedAt: string): boolean {
  const pin = time(scorerPinMergedAt, "the scorer pin post's merge time");
  return pr.state === "MERGED" && pr.mergedAt !== null && time(pr.mergedAt, "mergedAt") < pin;
}

/** Amendment section 2 rule 4: accrual closes at 50 qualifying non-clean tasks or 21 days after P's post, whichever is first. */
export function accrualClosed(o: { qualifyingNonClean: number; pPostMergedAt: string; now: string }): { closed: boolean; why: string } {
  const p = time(o.pPostMergedAt, "P's post merge time");
  const now = time(o.now, "now");
  if (now < p) fail("E_TBV_INPUT", "now (" + o.now + ") is before P's post (" + o.pPostMergedAt + ")");
  if (o.qualifyingNonClean >= 50) return { closed: true, why: o.qualifyingNonClean + " qualifying non-clean tasks (50 close accrual)" };
  if (now - p >= 21 * 86_400_000) return { closed: true, why: "21 days after P's post" };
  return { closed: false, why: o.qualifyingNonClean + " of 50 qualifying, " + ((now - p) / 86_400_000).toFixed(2) + " of 21 days" };
}

const nodesOf = (c: any): any[] => c?.nodes ?? [];
const truncated = (c: any): boolean => typeof c?.totalCount === "number" && c.totalCount > nodesOf(c).length;

export function lineageOf(node: Record<string, any>): LineageStub {
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  const issues = node.closingIssuesReferences;
  return { number: node.number, createdAt: text(node.createdAt), title: text(node.title), baseRefName: text(node.baseRefName), headRefName: text(node.headRefName), closingIssues: Array.isArray(issues?.nodes) && !truncated(issues) ? nodesOf(issues).map((i) => i.number) : null };
}

export function fromGraphql(node: Record<string, any>): PrRecord | null {
  const commits = nodesOf(node.commits).map((n) => n.commit);
  const suites = commits.flatMap((c) => nodesOf(c.checkSuites));
  const threads = nodesOf(node.reviewThreads);
  const conns = [node.closingIssuesReferences, node.files, node.commits, node.reviewThreads, node.reviews, ...commits.map((c) => c.checkSuites), ...suites.map((s) => s.checkRuns), ...threads.map((t) => t.comments)];
  if (conns.some(truncated)) return null;
  return {
    number: node.number,
    state: node.state,
    title: node.title,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    baseRefName: node.baseRefName,
    headRefName: node.headRefName,
    closingIssues: nodesOf(node.closingIssuesReferences).map((i) => i.number),
    files: nodesOf(node.files).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    commits: commits.map((c) => ({
      oid: c.oid,
      message: c.message,
      authoredDate: c.authoredDate,
      committedDate: c.committedDate,
      checks: nodesOf(c.checkSuites).flatMap((s) => nodesOf(s.checkRuns)).map((r) => ({ name: r.name, conclusion: r.conclusion, status: r.status, title: r.title, summary: r.summary, text: r.text })),
    })),
    reviewThreads: threads.map((t) => ({ isResolved: t.isResolved, comments: nodesOf(t.comments).map((c) => ({ author: c.author?.login ?? null, body: c.body })) })),
    reviews: nodesOf(node.reviews).map((r) => ({ author: r.author?.login ?? null, body: r.body })),
  };
}

/** B0's source B query plus authoredDate and the totalCounts that tell a truncated record, one pull request per page:
 * at five a page, GitHub's resource limit nulled connections on a page with many check runs and answered with errors.
 * Files and each commit's check suites carry pageInfo, so wholeNode can page the rest; asking for 50 suites a commit up
 * front would cost about 52 rate-limit points a page against 12. */
const QUERY = `query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(first:1,after:$cursor,states:[MERGED,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){
 totalCount
 pageInfo{hasNextPage endCursor}
 nodes{number state title createdAt mergedAt closedAt baseRefName headRefName
  closingIssuesReferences(first:10){totalCount nodes{number}}
  files(first:100){totalCount pageInfo{hasNextPage endCursor} nodes{path additions deletions}}
  commits(first:100){totalCount nodes{commit{oid message authoredDate committedDate checkSuites(first:10){totalCount pageInfo{hasNextPage endCursor} nodes{checkRuns(first:20){totalCount nodes{name conclusion status title summary text}}}}}}}
  reviewThreads(first:100){totalCount nodes{isResolved comments(first:20){totalCount nodes{author{login} body}}}}
  reviews(first:60){totalCount nodes{author{login} body}}
 }}}}`;

const FILES_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){files(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{path additions deletions}}}}}`;
const SUITES_QUERY = `query($owner:String!,$name:String!,$oid:GitObjectID!,$cursor:String){repository(owner:$owner,name:$name){object(oid:$oid){... on Commit{checkSuites(first:100,after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{checkRuns(first:20){totalCount nodes{name conclusion status title summary text}}}}}}}}`;

/** One gh api graphql call. A reply that carries an errors array fails closed even when gh exits 0 and data came back, since
 * GitHub's resource limit nulls connections and still returns the page, so mine-b keeps no partial page. */
function graphql(vars: string[]): any {
  const p: { exitCode: number; stdout: Buffer; stderr: Buffer } = Bun.spawnSync(["gh", "api", "graphql", ...vars]);
  let body: any = null;
  try {
    body = JSON.parse(p.stdout.toString());
  } catch {}
  if (Array.isArray(body?.errors) && body.errors.length) fail("E_TBV_INPUT", "gh api graphql answered with " + body.errors.length + " errors (" + [...new Set(body.errors.map((e: any) => e?.type ?? e?.message))].join(", ") + "); mine-b keeps no partial page");
  if (p.exitCode !== 0) fail("E_TBV_INPUT", "gh api graphql failed: " + p.stderr.toString().slice(0, 300));
  return body?.data;
}

/** A connection's pages past its first, so a record whose files or check suites hold more than one page comes through
 * whole. A connection with no next page comes back as it is. Every page must keep the first page's totalCount, return
 * nodes and move the cursor, and paging may not return more nodes than totalCount, or mine-b fails closed. Paging that
 * ends short of totalCount leaves the connection truncated, and fromGraphql flags the record. */
function pageRest(what: string, conn: Record<string, any> | null | undefined, next: (cursor: string) => any): Record<string, any> | null | undefined {
  if (!conn?.pageInfo?.hasNextPage) return conn;
  const nodes = [...nodesOf(conn)];
  let info = conn.pageInfo;
  while (info?.hasNextPage) {
    const page: any = next(info.endCursor) ?? fail("E_TBV_INPUT", "gh api graphql answered with no page of " + what);
    if (page.totalCount !== conn.totalCount) fail("E_TBV_INPUT", what + " counted " + conn.totalCount + ", then " + page.totalCount + " on a later page; rerun mine-b");
    if (!nodesOf(page).length || page.pageInfo?.endCursor === info.endCursor) fail("E_TBV_INPUT", what + " did not page past cursor " + info.endCursor + "; rerun mine-b");
    nodes.push(...nodesOf(page));
    info = page.pageInfo;
  }
  if (nodes.length > conn.totalCount) fail("E_TBV_INPUT", what + " paged " + nodes.length + " nodes, more than its totalCount " + conn.totalCount + "; rerun mine-b");
  return { totalCount: conn.totalCount, nodes };
}

/** node with its files and every commit's check suites paged in full: one more query per 100 files past the first 100, and
 * per commit with more than 10 check suites. */
function wholeNode(owner: string, name: string, node: Record<string, any>): Record<string, any> {
  const gql = (query: string, vars: string[]) => graphql(["-f", "query=" + query, "-f", "owner=" + owner, "-f", "name=" + name, ...vars]);
  const files = pageRest("pull request #" + node.number + "'s files", node.files, (cursor) => gql(FILES_QUERY, ["-F", "number=" + node.number, "-f", "cursor=" + cursor])?.repository?.pullRequest?.files);
  const commits = nodesOf(node.commits).map((n) => ({ ...n, commit: { ...n.commit, checkSuites: pageRest("commit " + n.commit.oid + "'s check suites", n.commit.checkSuites, (cursor) => gql(SUITES_QUERY, ["-f", "oid=" + n.commit.oid, "-f", "cursor=" + cursor])?.repository?.object?.checkSuites) } }));
  return { ...node, files, commits: node.commits && { ...node.commits, nodes: commits } };
}

function flags(argv: string[], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!names.includes(argv[i]) || argv[i + 1] === undefined) fail("E_USAGE", "unknown flag or missing value: " + argv[i] + "; flags are " + names.join(" "));
    out[argv[i]] = argv[i + 1];
  }
  return out;
}

/** mine-b --out FILE [--repo OWNER/NAME]; assemble-b --records FILE --out-dir DIR */
export async function run(argv: string[], io: Io): Promise<number> {
  if (argv[0] === "mine-b") {
    const f = flags(argv.slice(1), ["--out", "--repo"]);
    if (!f["--out"]) fail("E_USAGE", "mine-b needs --out");
    const [owner, name] = (f["--repo"] ?? "garrytan/gstack-evals").split("/");
    const prs: PrRecord[] = [];
    const skipped: LineageStub[] = [];
    const seen = new Set<number>();
    let total: unknown = null;
    let cursor: string | null = null;
    do {
      const page: any = graphql(["-f", "query=" + QUERY, "-f", "owner=" + owner, "-f", "name=" + name, ...(cursor ? ["-f", "cursor=" + cursor] : [])])?.repository?.pullRequests ?? fail("E_TBV_INPUT", "gh api graphql answered with no pullRequests page");
      total = page.totalCount;
      for (const node of page.nodes) {
        if (seen.has(node.number)) fail("E_TBV_INPUT", "pull request #" + node.number + " came back on two pages; rerun mine-b");
        seen.add(node.number);
        const rec = fromGraphql(wholeNode(owner, name, node));
        if (rec) prs.push(rec);
        else skipped.push(lineageOf(node));
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    if (seen.size !== total) fail("E_TBV_INPUT", "mined " + seen.size + " pull requests, but GitHub counts " + String(total) + "; rerun mine-b");
    mkdirSync(dirname(f["--out"]), { recursive: true });
    writeFileSync(f["--out"], JSON.stringify({ schema: "tbv-prs.v1", repo: owner + "/" + name, prs, skipped }) + "\n");
    io.out("mined " + prs.length + " pull requests, skipped " + skipped.length + " truncated records");
    return 0;
  }
  const f = flags(argv.slice(1), ["--records", "--out-dir"]);
  if (!f["--records"] || !f["--out-dir"]) fail("E_USAGE", "assemble-b needs --records and --out-dir");
  const file = JSON.parse(readFileSync(f["--records"], "utf8"));
  if (file?.schema !== "tbv-prs.v1" || !Array.isArray(file.prs)) fail("E_TBV_INPUT", f["--records"] + " is not a tbv-prs.v1 record file");
  const prs = file.prs as PrRecord[];
  const clusters = clustersOf(prs);
  mkdirSync(f["--out-dir"], { recursive: true });
  const drops: Record<string, number> = {};
  let kept = 0;
  for (const pr of prs) {
    const r = assembleB(pr, clusters.get(pr.number)!);
    if (!r.ok) {
      drops[r.drop] = (drops[r.drop] ?? 0) + 1;
      continue;
    }
    writeFileSync(join(f["--out-dir"], r.history.task + ".json"), JSON.stringify(r.history) + "\n");
    kept++;
  }
  io.out("assembled " + kept + " histories in " + new Set(clusters.values()).size + " clusters; dropped " + JSON.stringify(drops));
  return 0;
}

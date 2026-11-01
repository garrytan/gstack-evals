// Copyright (c) 2026 Garry Tan. MIT License.
// Fetches the public metadata the miner reads (merged pull requests, their commits' dates and closing issues) from
// GitHub's GraphQL API through gh. It reads public data only and calls no model.
import { spawnSync } from "node:child_process";
import type { IssueMeta, PrMeta, RepoMeta } from "./meta.ts";

export const PR_QUERY =
  "query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){pullRequests(states:MERGED,first:50,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{number title body createdAt mergedAt updatedAt mergeCommit{oid} labels(first:20){nodes{name}} closingIssuesReferences(first:10){nodes{number title createdAt labels(first:20){nodes{name}}}} commits(first:100){nodes{commit{oid authoredDate committedDate}}}}}}}";

type Names = { nodes: { name: string }[] };
interface PrNode {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  mergedAt: string;
  updatedAt: string;
  mergeCommit: { oid: string } | null;
  labels: Names;
  closingIssuesReferences: { nodes: { number: number; title: string; createdAt: string; labels: Names }[] };
  commits: { nodes: { commit: { oid: string; authoredDate: string; committedDate: string } }[] };
}

export interface PrPage {
  prs: (PrMeta & { updated_at: string })[];
  issues: IssueMeta[];
  next: string | null;
}

export function parsePrPage(json: unknown): PrPage {
  const conn = (json as { data?: { repository?: { pullRequests?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PrNode[] } } } }).data?.repository?.pullRequests;
  if (!conn) throw new Error("the GraphQL response has no repository.pullRequests");
  const issues: IssueMeta[] = [];
  const prs = conn.nodes.map((n) => {
    for (const i of n.closingIssuesReferences.nodes) issues.push({ number: i.number, title: i.title, created_at: i.createdAt, labels: i.labels.nodes.map((l) => l.name) });
    return {
      number: n.number,
      title: n.title,
      body: n.body,
      created_at: n.createdAt,
      merged_at: n.mergedAt,
      updated_at: n.updatedAt,
      merge_commit: n.mergeCommit?.oid ?? null,
      labels: n.labels.nodes.map((l) => l.name),
      closing_issues: n.closingIssuesReferences.nodes.map((i) => i.number),
      commits: n.commits.nodes.map((c) => ({ sha: c.commit.oid, authored_at: c.commit.authoredDate, committed_at: c.commit.committedDate })),
    };
  });
  return { prs, issues, next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null };
}

/** Pages merged pull requests newest-updated first until one was last updated before since. */
export function fetchMeta(repo: string, since: string, gh = "gh"): RepoMeta {
  const [owner, name] = repo.split("/");
  const prs: PrMeta[] = [];
  const issues = new Map<number, IssueMeta>();
  let cursor: string | null = null;
  for (;;) {
    const args = ["api", "graphql", "-f", "query=" + PR_QUERY, "-F", "owner=" + owner, "-F", "name=" + name, ...(cursor ? ["-f", "cursor=" + cursor] : [])];
    const r = spawnSync(gh, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error("gh api graphql exited " + r.status + ": " + (r.stderr ?? "").trim().slice(0, 300));
    const page = parsePrPage(JSON.parse(r.stdout));
    for (const i of page.issues) issues.set(i.number, i);
    let older = false;
    for (const { updated_at, ...pr } of page.prs) {
      if (Date.parse(updated_at) < Date.parse(since)) older = true;
      if (Date.parse(pr.merged_at) >= Date.parse(since)) prs.push(pr);
    }
    if (older || page.next === null) break;
    cursor = page.next;
  }
  return { repo, fetched_at: new Date().toISOString(), prs: prs.sort((a, b) => a.number - b.number), issues: [...issues.values()].sort((a, b) => a.number - b.number) };
}

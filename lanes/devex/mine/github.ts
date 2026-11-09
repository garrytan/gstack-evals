// Copyright (c) 2026 Garry Tan. MIT License.
// The devex miner's GitHub reads (devex prereg sections 4 and 16; design prereg frame-rules.md part A): the
// topic-search union of repositories, each repository's merged pull requests in the frame's dates, a unit's facts
// (description and closing issues with their edit histories, commits, files, merge and base), releases and tags,
// ancestry through GraphQL's ref compare, the base tree and its licence, and the window's items. Only the repository
// search uses REST; every read of a repository's own data goes through GraphQL, because REST calls to a repository
// outside the GitHub App's installation can go out unauthenticated on a shared IP limit. The unit's diff comes from
// git (git.ts). Every call goes through the shared client (lanes/aftermath/gh.ts) bound here to a 2,500-point floor,
// one call a second and no retry, with GitHub's hosts as the only egress. Reads that can share a query do, as aliased
// parts (batch): several repositories' listings, several units' facts, several tags' ancestry, a window's three
// searches. Each part's result is what its own query returns, and a batch GitHub cannot answer halves. The draw's
// GraphQL goes through the same client awaited (ahead.ts), so several queries can be in flight. A repository GitHub
// no longer returns lists as missing, with nothing to draw; one that stops answering after it was listed comes back
// as RepoGone from the read that found it (a null for that unit from the facts and files reads).
import { openGitHub, type GhExec, type GitHub } from "../../aftermath/gh.ts";
import { openGraphqlAsync, type AsyncGraphql, type GhExecAsync } from "./ahead.ts";
import { searchTopic } from "../../aftermath/draw.ts";
import { DEV_TOPICS, licenceTier, repoInFrame, stratum, UI_TOPICS, type ChangedFile } from "./frame.ts";
import type { ReleaseCandidate, TextHistory, UnitFacts } from "./units.ts";
import { isBot, type WindowItem } from "./window.ts";

export const FLOOR = 2500;

/** GitHub no longer returns a repository that was listed: the draw drops the unit it was reading and asks that repository nothing more. */
export class RepoGone extends Error {
  readonly code = "E_MINE_SOURCE";
  constructor(readonly repo: string) {
    super(repo + " is no longer returned by GitHub");
  }
}
export const PACE_MS = 1000;
export const SEARCH_PACE_MS = 2200;

export const openDxGitHub = (exec?: GhExec, sleep?: (ms: number) => void, now?: () => number): GitHub =>
  openGitHub({ floor: FLOOR, tries: 3, backoffMs: (n) => n * 5000, paceMs: PACE_MS, code: "E_MINE_SOURCE", exec, sleep, now });
export const openDxGraphqlAsync = (exec: GhExecAsync, sleep: (ms: number) => Promise<void>, now: () => number): AsyncGraphql =>
  openGraphqlAsync({ floor: FLOOR, tries: 3, backoffMs: (n) => n * 5000, paceMs: PACE_MS, code: "E_MINE_SOURCE", exec, sleep, now });

const RL = " rateLimit { cost remaining resetAt }";
const EDITS = " lastEditedAt userContentEdits(last: 100) { nodes { editedAt createdAt deletedAt diff } }";

export interface FrameRepo {
  repo: string;
  stars: number;
  licence_field: string | null;
  tier: "permissive" | "copyleft";
  topics: string[];
  stratum: "desktop" | "mobile" | "web" | null;
  sides: Array<"dev" | "ui">;
  default_branch: string;
}

const BANDS = ["500..999", "1000..1999", "2000..4999", "5000..19999", ">=20000"];

/** The topic-search union, both sides, with each topic's total so a short read shows. Returns the repositories in the frame. */
export function repoUnion(gh: GitHub, sleep?: (ms: number) => void, topics = { dev: DEV_TOPICS, ui: UI_TOPICS }): { repos: FrameRepo[]; searched_at: string; short: string[] } {
  const by = new Map<string, FrameRepo>();
  const short: string[] = [];
  for (const [side, list] of [["dev", topics.dev], ["ui", topics.ui]] as const) {
    for (const topic of list) {
      for (const stars of BANDS) {
        const { items, total } = searchTopic((p) => gh.rest(p), { topic, stars, pushedSince: "2026-10-01", maxPages: 10, paceMs: SEARCH_PACE_MS }, undefined, sleep);
        if (total > items.length) short.push(topic + " " + stars);
        for (const it of items) {
          if (!repoInFrame(it)) continue;
          const name = it.full_name as string;
          const r = by.get(name) ?? { repo: name, stars: it.stargazers_count, licence_field: it.license?.spdx_id ?? null, tier: licenceTier(it.license?.spdx_id)!, topics: it.topics ?? [], stratum: stratum(it.topics ?? []), sides: [] as Array<"dev" | "ui">, default_branch: it.default_branch };
          if (!r.sides.includes(side)) r.sides.push(side);
          by.set(name, r);
        }
      }
    }
  }
  return { repos: [...by.values()], searched_at: new Date().toISOString(), short };
}

const history = (n: any): TextHistory => ({
  created_at: n.createdAt,
  current: n.body ?? "",
  last_edited_at: n.lastEditedAt ?? null,
  edits: (n.userContentEdits?.nodes ?? []).map((e: any) => ({ at: e.editedAt ?? e.createdAt, text: e.deletedAt ? null : e.diff ?? null })),
});

/** One aliased field of a batched query: its variables, and its selection, which names them as $name. */
export interface Part {
  vars: Record<string, [type: string, value: unknown]>;
  field: string;
}

/** Errors that say the query was too big or too slow as a whole, so smaller batches may pass. */
const SPLIT = /HTTP 50[234]|timeout|timed out|MAX_NODE_LIMIT|resource limitations/i;

/** Several parts in one aliased GraphQL query. Each result is what the part's own query would have returned; a batch GitHub cannot answer halves until a part stands alone, which fails as its own query would. */
export function batch(gh: GitHub, parts: readonly Part[]): any[] {
  if (!parts.length) return [];
  const decl = parts.flatMap((p, i) => Object.entries(p.vars).map(([k, [t]]) => "$" + k + "_" + i + ": " + t));
  const q = "query" + (decl.length ? "(" + decl.join(", ") + ")" : "") + " { " + parts.map((p, i) => "p" + i + ": " + p.field.replace(/\$(\w+)/g, (_, n) => "$" + n + "_" + i)).join(" ") + RL + " }";
  const vars = Object.fromEntries(parts.flatMap((p, i) => Object.entries(p.vars).map(([k, [, v]]) => [k + "_" + i, v])));
  try {
    const d = gh.graphql<any>(q, vars);
    return parts.map((_, i) => d?.["p" + i]);
  } catch (e) {
    if (parts.length === 1 || !SPLIT.test(String((e as Error).message))) throw e;
    const h = Math.ceil(parts.length / 2);
    return [...batch(gh, parts.slice(0, h)), ...batch(gh, parts.slice(h))];
  }
}

const at = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** One search over a date range: the query for a range, and the search field, which names $q and $after. */
export interface SearchJob {
  query: (from: string, to: string) => string;
  from: string;
  to: string;
  field: string;
}

/**
 * Search pages over date ranges, up to size ranges a query, halving a range while it holds more than search's 1,000
 * results. Each job's nodes come back in the order reading its ranges one at a time gives. The extra parts ride the
 * first query and their results come back beside the nodes.
 */
export function searchMany(gh: GitHub, jobs: readonly SearchJob[], size: number, extra: readonly Part[] = []): { nodes: any[][]; extra: any[] } {
  type Seg = { job: number; from: string; to: string; after: string | null; first: boolean; pages: any[][]; kids: Seg[] };
  const seg = (job: number, from: string, to: string): Seg => ({ job, from, to, after: null, first: true, pages: [], kids: [] });
  const roots = jobs.map((j, i) => seg(i, j.from, j.to));
  const pending = [...roots];
  let lead = [...extra], extraOut: any[] = [];
  while (pending.length || lead.length) {
    const segs = pending.splice(0, size);
    const res = batch(gh, [...lead, ...segs.map((s): Part => ({ vars: { q: ["String!", jobs[s.job]!.query(s.from, s.to)], after: ["String", s.after] }, field: jobs[s.job]!.field }))]);
    const off = lead.length;
    if (off) extraOut = res.slice(0, off);
    lead = [];
    segs.forEach((s, i) => {
      const r = res[off + i];
      if (s.first && r.issueCount > 1000 && Date.parse(s.to) - Date.parse(s.from) > 3_600_000) {
        const mid = at((Date.parse(s.from) + Date.parse(s.to)) / 2);
        s.kids = [seg(s.job, s.from, mid), seg(s.job, at(Date.parse(mid) + 1000), s.to)];
        pending.push(...s.kids);
        return;
      }
      s.first = false;
      s.pages.push(r.nodes ?? []);
      if (r.pageInfo.hasNextPage) {
        s.after = r.pageInfo.endCursor;
        pending.push(s);
      }
    });
  }
  const flat = (s: Seg): any[] => (s.kids.length ? s.kids.flatMap(flat) : s.pages.flat());
  return { nodes: roots.map(flat), extra: extraOut };
}

const repoVars = (repo: string): Part["vars"] => {
  const [owner, name] = repo.split("/");
  return { owner: ["String!", owner], name: ["String!", name] };
};

const LIST_FIELD = "search(query: $q, type: ISSUE, first: 50, after: $after) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { number title createdAt mergedAt baseRefName labels(first: 20) { nodes { name } } files(first: 100) { totalCount nodes { path additions } } } } }";
const REL_FIELD = "repository(owner: $owner, name: $name) { releases(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt isDraft isPrerelease } } refs(refPrefix: \"refs/tags/\", first: 100, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name target { __typename ... on Commit { committedDate } ... on Tag { target { ... on Commit { committedDate } } } } } } }";

export interface ListedPr {
  number: number;
  title: string;
  labels: string[];
  created_at: string;
  merged_at: string;
  base_ref: string;
  files: ChangedFile[];
  files_total: number;
}

/** One repository's listing: its releases, its tags dated by their commits, and its listed pull requests. Side-neutral, so either eval's draw reads it. */
export interface Listing {
  repo: string;
  releases: ReleaseCandidate[];
  tags: Array<{ tag: string; date: string }>;
  prs: ListedPr[];
  /** GitHub no longer returns the repository: listed once with nothing to draw, never asked again. */
  missing?: true;
}

export const LIST_BATCH = 5;

/** Each repository's releases and tags, and its merged pull requests into its default branch created and merged in the frame's dates; up to LIST_BATCH repositories a query. */
export function listRepos(gh: GitHub, repos: readonly FrameRepo[]): Listing[] {
  const jobs = repos.map((repo): SearchJob => ({ query: (from, to) => "repo:" + repo.repo + " is:pr is:merged base:" + repo.default_branch + " merged:" + from + ".." + to + " created:>=2026-07-01", from: "2026-07-01T00:00:00Z", to: "2026-09-30T23:59:59Z", field: LIST_FIELD }));
  const { nodes, extra } = searchMany(gh, jobs, LIST_BATCH, repos.map((r) => ({ vars: repoVars(r.repo), field: REL_FIELD })));
  return repos.map((repo, i) => {
    const r = extra[i];
    if (!r) return { repo: repo.repo, releases: [], tags: [], prs: [], missing: true };
    const prs: ListedPr[] = [];
    for (const n of nodes[i]!) {
      if (!n?.number) continue;
      prs.push({ number: n.number, title: n.title, labels: (n.labels?.nodes ?? []).map((l: any) => l.name), created_at: n.createdAt, merged_at: n.mergedAt, base_ref: n.baseRefName, files: (n.files?.nodes ?? []).map((f: any) => ({ path: f.path, additions: f.additions })), files_total: n.files?.totalCount ?? 0 });
    }
    return {
      repo: repo.repo,
      releases: (r.releases?.nodes ?? []).map((x: any) => ({ tag: x.tagName, published_at: x.publishedAt ?? "", draft: !!x.isDraft, prerelease: !!x.isPrerelease })),
      tags: (r.refs?.nodes ?? []).map((t: any) => ({ tag: t.name, date: t.target?.committedDate ?? t.target?.target?.committedDate ?? "" })),
      prs,
    };
  });
}

const FILES_Q = "query($owner: String!, $name: String!, $n: Int!, $after: String) { repository(owner: $owner, name: $name) { pullRequest(number: $n) { files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path additions } } } }" + RL + " }";

/** Every changed file, paged through GraphQL when the listing's first 100 were not all (up to 3,000); null when GitHub no longer returns the repository. */
export function allFiles(gh: GitHub, repo: string, pr: ListedPr): ChangedFile[] | null {
  if (pr.files_total <= pr.files.length) return pr.files;
  const [owner, name] = repo.split("/");
  const out: ChangedFile[] = [];
  let after: string | null = null;
  for (let page = 1; page <= 30; page++) {
    const r: any = gh.graphql<any>(FILES_Q, { owner, name, n: pr.number, after }).repository;
    if (r === null) return null;
    const f: any = r.pullRequest.files;
    out.push(...(f.nodes ?? []).map((x: any) => ({ path: x.path, additions: x.additions })));
    if (!f.pageInfo.hasNextPage) break;
    after = f.pageInfo.endCursor;
  }
  return out;
}

const XREF = "timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) { nodes { ... on CrossReferencedEvent { isCrossRepository source { __typename ... on Issue { number } ... on PullRequest { number } } } } }";
const UNIT_FIELD = "repository(owner: $owner, name: $name) { pullRequest(number: $n) { body createdAt" + EDITS +
  " mergeCommit { oid parents(first: 1) { nodes { oid } } } commits(first: 100) { nodes { commit { authoredDate committedDate } } } " + XREF +
  " closingIssuesReferences(first: 5) { nodes { number title body createdAt" + EDITS + " " + XREF + " } } } }";

export const UNIT_BATCH = 5;

/** Units' facts and the window references GitHub's timeline records for each and its closing issues, up to UNIT_BATCH units a query; null for a unit whose files came back null or whose repository GitHub no longer returns. */
export function unitFactsMany(gh: GitHub, units: ReadonlyArray<{ repo: FrameRepo; pr: ListedPr; files: ChangedFile[] | null }>): Array<{ facts: UnitFacts; timeline_refs: Array<{ kind: "issue" | "pr"; number: number }> } | null> {
  const live = units.filter((u) => u.files);
  const res = batch(gh, live.map((u): Part => ({ vars: { ...repoVars(u.repo.repo), n: ["Int!", u.pr.number] }, field: UNIT_FIELD })));
  return units.map((u) => {
    const { repo, pr, files } = u, r = files ? res[live.indexOf(u)] : null;
    if (!files || r === null) return null;
    const d = r.pullRequest;
    const refs: Array<{ kind: "issue" | "pr"; number: number }> = [];
    const take = (t: any) => {
      for (const e of t?.nodes ?? []) if (e?.source?.number && !e.isCrossRepository) refs.push({ kind: e.source.__typename === "PullRequest" ? "pr" : "issue", number: e.source.number });
    };
    take(d.timelineItems);
    for (const c of d.closingIssuesReferences?.nodes ?? []) take(c.timelineItems);
    const facts: UnitFacts = {
      repo: repo.repo,
      number: pr.number,
      title: pr.title,
      labels: pr.labels,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
      base_ref: pr.base_ref,
      default_branch: repo.default_branch,
      body: history(d),
      closing: (d.closingIssuesReferences?.nodes ?? []).map((c: any) => ({ number: c.number, title: c.title, created_at: c.createdAt, body: history(c) })),
      commits: (d.commits?.nodes ?? []).map((c: any) => ({ authored_at: c.commit.authoredDate, committed_at: c.commit.committedDate })),
      files,
      merge_sha: d.mergeCommit?.oid ?? null,
      base_sha: d.mergeCommit?.parents?.nodes?.[0]?.oid ?? null,
    };
    return { facts, timeline_refs: refs };
  });
}

const COMPARE_FIELD = "repository(owner: $owner, name: $name) { ref(qualifiedName: $ref) { compare(headRef: $head) { status } } }";

export const COMPARE_BATCH = 4;

/** Git ancestry through GraphQL's ref compare, which takes the merge commit's oid as its head, for several tags a query: a tag's commit contains the merge when the merge is behind the tag or identical to it. */
export function tagsContain(gh: GitHub, repo: string, mergeSha: string, tags: readonly string[]): boolean[] {
  const res = batch(gh, tags.map((tag): Part => ({ vars: { ...repoVars(repo), ref: ["String!", "refs/tags/" + tag], head: ["String!", mergeSha] }, field: COMPARE_FIELD })));
  if (res.some((r) => r === null)) throw new RepoGone(repo);
  return res.map((r) => {
    const s = r?.ref?.compare?.status;
    return s === "BEHIND" || s === "IDENTICAL";
  });
}

export const TREE_DEPTH = 1;
export const TREE_BATCH = 50;
/** A tree query GitHub could not answer in time, after the client's own tries: the batch halves, and one folder it still cannot list marks the tree truncated, so the base-under-150mb rule drops the unit and counts it. */
const TREE_TIMEOUT = /HTTP 50[234]|timeout|timed out/i;
/** REST's recursive tree stops at 100,000 entries and says truncated; the GraphQL walk keeps the same bound. */
export const TREE_MAX = 100_000;
const LICENCE_FILE = /licen[cs]e|^copying/i;
const levels = (d: number): string => "entries { name type size oid" + (d > 1 ? " object { ... on Tree { " + levels(d - 1) + " } }" : "") + " }";
const LIC_Q = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { licenseInfo { spdxId } defaultBranchRef { target { ... on Commit { tree { entries { name type oid } } } } } }" + RL + " }";
const licenceFiles = (entries: any[]) => entries.filter((e) => e.type === "blob" && LICENCE_FILE.test(e.name)).map((e) => e.name + " " + e.oid).sort().join("\n");

/**
 * The base tree, walked through GraphQL TREE_DEPTH levels a call and deeper folders by oid, at most TREE_BATCH to a call; and
 * its licence. GraphQL detects a licence only on the default branch, so the base's licence is that detection when the
 * base's root licence files are the same blobs as the default branch's, and null when they differ or there are none.
 */
export function baseTree(gh: GitHub, repo: string, sha: string): { tree: Array<{ path: string; type: string; size?: number }>; truncated: boolean; licence: string | null } {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw Object.assign(new Error("baseTree needs a full commit sha"), { code: "E_MINE_SOURCE" });
  const [owner, name] = repo.split("/");
  const tree: Array<{ path: string; type: string; size?: number }> = [];
  const queue: Array<{ prefix: string; sel: string }> = [{ prefix: "", sel: 'object(expression: "' + sha + ':")' }];
  let root: any[] | null = null;
  const walk = (entries: any[], prefix: string) => {
    for (const e of entries) {
      const path = prefix + e.name;
      tree.push(e.type === "blob" ? { path, type: e.type, size: e.size } : { path, type: e.type });
      if (e.type !== "tree") continue;
      if (Array.isArray(e.object?.entries)) walk(e.object.entries, path + "/");
      else queue.push({ prefix: path + "/", sel: 'object(oid: "' + e.oid + '")' });
    }
  };
  let size = TREE_BATCH;
  let unlisted = false;
  while (queue.length && tree.length <= TREE_MAX) {
    const batch = queue.splice(0, size);
    const q = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { " + batch.map((b, i) => "t" + i + ": " + b.sel + " { ... on Tree { " + levels(TREE_DEPTH) + " } }").join(" ") + " }" + RL + " }";
    let r: any;
    try {
      r = gh.graphql<any>(q, { owner, name }).repository;
    } catch (e) {
      if (!TREE_TIMEOUT.test(String((e as Error).message))) throw e;
      if (batch.length === 1) {
        unlisted = true;
        break;
      }
      queue.unshift(...batch);
      size = Math.ceil(batch.length / 2);
      continue;
    }
    if (r === null) throw new RepoGone(repo);
    batch.forEach((b, i) => {
      const entries = r?.["t" + i]?.entries;
      if (!Array.isArray(entries)) throw Object.assign(new Error("GraphQL returned no tree for " + (b.prefix || sha)), { code: "E_MINE_SOURCE" });
      if (!root) root = entries;
      walk(entries, b.prefix);
    });
  }
  const d = gh.graphql<any>(LIC_Q, { owner, name }).repository;
  if (d === null) throw new RepoGone(repo);
  const base = licenceFiles(root ?? []);
  const licence = base && base === licenceFiles(d?.defaultBranchRef?.target?.tree?.entries ?? []) ? d?.licenseInfo?.spdxId ?? null : null;
  return { tree, truncated: unlisted || tree.length > TREE_MAX, licence };
}

const WIN_ISSUE_FIELD = "search(query: $q, type: ISSUE, first: 50, after: $after) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on Issue { number title body createdAt authorAssociation author { login __typename } } ... on PullRequest { number title body createdAt mergedAt authorAssociation author { login __typename } files(first: 50) { nodes { path } } } } }";
const WIN_DISC_FIELD = "search(query: $q, type: DISCUSSION, first: 50, after: $after) { issueCount: discussionCount pageInfo { hasNextPage endCursor } nodes { ... on Discussion { number title body createdAt authorAssociation author { login __typename } } } }";
const iso = (s: string) => new Date(Date.parse(s)).toISOString().replace(/\.\d+Z$/, "Z");

/** The window's issues and discussions created and pull requests merged, bots out, author association kept; the three searches share queries, and a check that GitHub still returns the repository rides the first. */
export function readWindow(gh: GitHub, repo: string, win: { from: string; to: string }): WindowItem[] {
  const from = iso(win.from), to = iso(win.to);
  const kinds = ["issue", "pr", "discussion"] as const;
  const { nodes, extra } = searchMany(gh, [
    { query: (a, b) => "repo:" + repo + " is:issue created:" + a + ".." + b, from, to, field: WIN_ISSUE_FIELD },
    { query: (a, b) => "repo:" + repo + " is:pr is:merged merged:" + a + ".." + b, from, to, field: WIN_ISSUE_FIELD },
    { query: (a, b) => "repo:" + repo + " created:" + a + ".." + b, from, to, field: WIN_DISC_FIELD },
  ], kinds.length, [{ vars: repoVars(repo), field: "repository(owner: $owner, name: $name) { id }" }]);
  if (extra[0] === null) throw new RepoGone(repo);
  const out: WindowItem[] = [];
  kinds.forEach((kind, i) => {
    for (const n of nodes[i]!) {
      if (!n?.number || isBot(n.author)) continue;
      out.push({ kind, number: n.number, title: n.title ?? "", body: n.body ?? "", author_association: n.authorAssociation ?? "NONE", created_at: n.createdAt, merged_at: n.mergedAt ?? null, files: (n.files?.nodes ?? []).map((f: any) => f.path) });
    }
  });
  return out;
}

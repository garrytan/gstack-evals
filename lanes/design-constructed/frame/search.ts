// Copyright (c) 2026 Garry Tan. MIT License.
// The frame's one dated search (prereg section 3; plan section 8): 50 GraphQL repository searches, each
// "topic:<t> license:<l> sort:stars" read for its first 100 results, at concurrency 1 through the paced gh client. A
// search is read as up to 4 cursor pages of 25 (BT: GitHub times out a first-100 page that carries README text), in
// order, so the nodes come back in the order one first-100 reply would give. Each page's reply is cached on disk by
// the sha256 of its query and variables (cursor included) and reused on any rerun. Each page's rateLimit cost is
// recorded and summed per search. buildSearchQuery and buildPageQuery are pure.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME } from "../frozen.ts";
import { GhError, type GitHub, type GraphqlReply } from "./gh.ts";

/** HTTP 502, HTTP 504 or a request timeout: the only page failures that may be resent (Captain's paging ruling). */
export const SEARCH_RESEND = /HTTP 50[24]\b|timed? ?out/i;
/** Tries per page: the first and up to 3 resends. */
export const SEARCH_TRIES = 4;

/** A page that failed for good: the frame stops at once and keeps no partial frame. */
export class SearchStop extends Error {
  constructor(
    readonly q: string,
    /** 1-based page of the search. */
    readonly page: number,
    readonly errorClass: "resendable error on all 4 tries" | "error that is not resendable",
    readonly detail: string,
  ) {
    super("search " + JSON.stringify(q) + " page " + page + ": " + errorClass);
  }
}

/** BT: nodes per page request. FRAME.resultsPerQuery (100) stays the total read per search. */
export const SEARCH_PAGE_SIZE = 25;

/** The README paths the search reads by object expression, in the order the first non-null one is taken. */
export const README_PATHS = ["README.md", "readme.md", "Readme.md", "README"] as const;
const README_ALIASES = ["readmeMd", "readmeLower", "readmeTitle", "readmeBare"] as const;

/** The one search query text; $q carries the search string, $first the page size and $after the cursor. */
export const SEARCH_QUERY = [
  "query($q: String!, $first: Int!, $after: String) {",
  "  search(type: REPOSITORY, query: $q, first: $first, after: $after) {",
  "    repositoryCount",
  "    pageInfo { hasNextPage endCursor }",
  "    nodes {",
  "      ... on Repository {",
  "        nameWithOwner isPrivate isFork isArchived isTemplate stargazerCount pushedAt",
  "        licenseInfo { spdxId }",
  "        primaryLanguage { name }",
  "        repositoryTopics(first: 20) { nodes { topic { name } } }",
  "        defaultBranchRef { name target { oid } }",
  ...README_PATHS.map((p, i) => "        " + README_ALIASES[i] + ": object(expression: " + JSON.stringify("HEAD:" + p) + ") { ... on Blob { text } }"),
  "      }",
  "    }",
  "  }",
  "  rateLimit { cost remaining resetAt }",
  "}",
].join("\n");

/** One of the 50 searches. */
export interface SearchQuery {
  topic: string;
  licence: string;
  /** The search string. */
  q: string;
}

/** One page request of a search. */
export interface PageQuery {
  query: string;
  variables: { q: string; first: number; after: string | null };
  /** sha256 of the canonical JSON of query and variables: the cache key. */
  digest: string;
}

/** The search for one topic and licence: pure. */
export const buildSearchQuery = (topic: string, licence: string): SearchQuery => ({ topic, licence, q: "topic:" + topic + " license:" + licence + " sort:stars" });

/** One page request: pure. after is the previous page's endCursor, or null for the first page. */
export function buildPageQuery(q: string, after: string | null, first: number = SEARCH_PAGE_SIZE): PageQuery {
  const variables = { q, first, after };
  return { query: SEARCH_QUERY, variables, digest: createHash("sha256").update(JSON.stringify({ query: SEARCH_QUERY, variables })).digest("hex") };
}

/** The 50 searches, topic by topic, each topic's licences in frozen order. */
export const searchQueries = (): SearchQuery[] => FRAME.topics.flatMap((t) => FRAME.licenses.map((l) => buildSearchQuery(t, l)));

/** One repository as the search returned it, read from the first search that returned it. */
export interface SearchedRepo {
  nameWithOwner: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  isTemplate: boolean;
  stars: number;
  pushedAt: string;
  spdxId: string | null;
  language: string | null;
  topics: string[];
  defaultBranch: string | null;
  headOid: string | null;
  /** The first README text found in README_PATHS order, or null. */
  readme: string | null;
  /** The search string of the first search that returned it. */
  query: string;
}

export interface PageRecord {
  digest: string;
  after: string | null;
  cached: boolean;
  cost: number;
  /** Node slots on the page, nulls included. */
  nodes: number;
}

export interface QueryRecord {
  topic: string;
  licence: string;
  q: string;
  pages: PageRecord[];
  /** Pages answered from the cache. */
  cached: number;
  /** The pages' rateLimit costs, summed. */
  cost: number;
  /** repositoryCount as the first page gave it. */
  repositoryCount: number;
  /** Repository nodes read. */
  returned: number;
  /** Nodes GitHub returned as null (blocked or gone). */
  nullNodes: number;
}

/** Reads one search node; throws on a node missing a field the query asks for. */
export function readNode(n: any, query: string): SearchedRepo {
  const need = (k: string) => {
    if (!(k in n)) throw new Error("search node lacks " + k);
    return n[k];
  };
  const readme = README_ALIASES.map((a) => need(a)?.text).find((t) => typeof t === "string") ?? null;
  return {
    nameWithOwner: need("nameWithOwner"),
    isPrivate: need("isPrivate"),
    isFork: need("isFork"),
    isArchived: need("isArchived"),
    isTemplate: need("isTemplate"),
    stars: need("stargazerCount"),
    pushedAt: need("pushedAt"),
    spdxId: need("licenseInfo")?.spdxId ?? null,
    language: need("primaryLanguage")?.name ?? null,
    topics: (need("repositoryTopics")?.nodes ?? []).map((t: any) => t.topic.name),
    defaultBranch: need("defaultBranchRef")?.name ?? null,
    headOid: need("defaultBranchRef")?.target?.oid ?? null,
    readme,
    query,
  };
}

export interface SearchResult {
  queries: QueryRecord[];
  /** Each repository once, in the order the searches first returned it. */
  repos: SearchedRepo[];
  /** Every repository node any search returned, duplicates included. */
  returned: number;
  /** Page requests made, cached ones included. */
  pages: number;
}

/** One page: from cacheDir when it holds the page, else from GitHub, written to cacheDir before anything else runs. */
function page(gh: GitHub, cacheDir: string, p: PageQuery): { reply: GraphqlReply; cached: boolean } {
  const file = join(cacheDir, p.digest + ".json");
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8"));
    if (c.query !== p.query || JSON.stringify(c.variables) !== JSON.stringify(p.variables)) throw new Error("search cache " + p.digest + " holds another query");
    return { reply: c.reply, cached: true };
  }
  const reply = gh.graphql(p.query, p.variables);
  writeFileSync(file + ".tmp", JSON.stringify({ query: p.query, variables: p.variables, reply }));
  renameSync(file + ".tmp", file);
  return { reply, cached: false };
}

/**
 * Runs every search in order at concurrency 1, each as cursor pages of SEARCH_PAGE_SIZE, following endCursor until the
 * search has given FRAME.resultsPerQuery node slots or GitHub says there is no next page.
 */
export function runSearch(gh: GitHub, cacheDir: string, queries: readonly SearchQuery[] = searchQueries()): SearchResult {
  mkdirSync(cacheDir, { recursive: true });
  const records: QueryRecord[] = [];
  const by = new Map<string, SearchedRepo>();
  let returned = 0, pages = 0;
  for (const q of queries) {
    const rec: QueryRecord = { topic: q.topic, licence: q.licence, q: q.q, pages: [], cached: 0, cost: 0, repositoryCount: 0, returned: 0, nullNodes: 0 };
    let after: string | null = null;
    let slots = 0;
    for (;;) {
      const p = buildPageQuery(q.q, after, Math.min(SEARCH_PAGE_SIZE, FRAME.resultsPerQuery - slots));
      let got: { reply: GraphqlReply; cached: boolean };
      try {
        got = page(gh, cacheDir, p);
      } catch (e) {
        const resendable = e instanceof GhError && e.transient && e.tries >= SEARCH_TRIES;
        throw new SearchStop(q.q, rec.pages.length + 1, resendable ? "resendable error on all 4 tries" : "error that is not resendable", String((e as Error).message).split("\n")[0]!.slice(0, 200));
      }
      const { reply, cached } = got;
      pages++;
      const s = reply.data.search;
      const nodes: any[] = (s.nodes ?? []).slice(0, FRAME.resultsPerQuery - slots);
      if (rec.pages.length === 0) rec.repositoryCount = s.repositoryCount;
      const cost = reply.data.rateLimit?.cost ?? 0;
      rec.pages.push({ digest: p.digest, after, cached, cost, nodes: nodes.length });
      rec.cost += cost;
      if (cached) rec.cached++;
      slots += nodes.length;
      for (const n of nodes) {
        if (n === null || typeof n !== "object" || !("nameWithOwner" in n)) {
          rec.nullNodes++;
          continue;
        }
        rec.returned++;
        const r = readNode(n, q.q);
        if (!by.has(r.nameWithOwner)) by.set(r.nameWithOwner, r);
      }
      const next: string | null = s.pageInfo?.hasNextPage ? (s.pageInfo.endCursor ?? null) : null;
      if (slots >= FRAME.resultsPerQuery || next === null || nodes.length === 0) break;
      after = next;
    }
    returned += rec.returned;
    records.push(rec);
  }
  return { queries: records, repos: [...by.values()], returned, pages };
}

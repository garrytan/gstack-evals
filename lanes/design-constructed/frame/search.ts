// Copyright (c) 2026 Garry Tan. MIT License.
// The frame's one dated search (prereg section 3; plan section 8): 50 GraphQL repository searches, each
// "topic:<t> license:<l> sort:stars" read for its first 100 results, at concurrency 1 through the paced gh client. Each
// reply is cached on disk by the sha256 of its query and variables and reused on any rerun, so a rerun spends nothing on
// a query already answered. Each query's rateLimit cost is recorded. buildSearchQuery is pure.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FRAME } from "../frozen.ts";
import type { GitHub, GraphqlReply } from "./gh.ts";

/** The README paths the search reads by object expression, in the order the first non-null one is taken. */
export const README_PATHS = ["README.md", "readme.md", "Readme.md", "README"] as const;
const README_ALIASES = ["readmeMd", "readmeLower", "readmeTitle", "readmeBare"] as const;

/** The one search query text; $q carries the search string. */
export const SEARCH_QUERY = [
  "query($q: String!) {",
  "  search(type: REPOSITORY, query: $q, first: " + FRAME.resultsPerQuery + ") {",
  "    repositoryCount",
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

export interface SearchQuery {
  topic: string;
  licence: string;
  query: string;
  variables: { q: string };
  /** sha256 of the canonical JSON of query and variables: the cache key. */
  digest: string;
}

/** The query for one topic and licence: pure. */
export function buildSearchQuery(topic: string, licence: string): SearchQuery {
  const variables = { q: "topic:" + topic + " license:" + licence + " sort:stars" };
  const digest = createHash("sha256").update(JSON.stringify({ query: SEARCH_QUERY, variables })).digest("hex");
  return { topic, licence, query: SEARCH_QUERY, variables, digest };
}

/** The 50 queries, topic by topic, each topic's licences in frozen order. */
export const searchQueries = (): SearchQuery[] => FRAME.topics.flatMap((t) => FRAME.licenses.map((l) => buildSearchQuery(t, l)));

/** One repository as the search returned it, read from the first query that returned it. */
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
  /** The digest of the first query that returned it. */
  query: string;
}

export interface QueryRecord {
  topic: string;
  licence: string;
  q: string;
  digest: string;
  cached: boolean;
  /** The query's own rateLimit cost when it was answered. */
  cost: number;
  repositoryCount: number;
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
  /** Each repository once, in the order the queries first returned it. */
  repos: SearchedRepo[];
  /** Every node any query returned, duplicates included. */
  returned: number;
}

/**
 * Runs every query in order at concurrency 1. A query whose reply is in cacheDir is read from there; any other goes to
 * GitHub and its reply is written to cacheDir before the next query starts.
 */
export function runSearch(gh: GitHub, cacheDir: string, queries: readonly SearchQuery[] = searchQueries()): SearchResult {
  mkdirSync(cacheDir, { recursive: true });
  const records: QueryRecord[] = [];
  const by = new Map<string, SearchedRepo>();
  let returned = 0;
  for (const q of queries) {
    const file = join(cacheDir, q.digest + ".json");
    let reply: GraphqlReply;
    let cached = false;
    if (existsSync(file)) {
      const c = JSON.parse(readFileSync(file, "utf8"));
      if (c.query !== q.query || JSON.stringify(c.variables) !== JSON.stringify(q.variables)) throw new Error("search cache " + q.digest + " holds another query");
      reply = c.reply;
      cached = true;
    } else {
      reply = gh.graphql(q.query, q.variables);
      writeFileSync(file + ".tmp", JSON.stringify({ query: q.query, variables: q.variables, reply }));
      renameSync(file + ".tmp", file);
    }
    const s = reply.data.search;
    const nodes: any[] = s.nodes ?? [];
    let nulls = 0;
    for (const n of nodes) {
      if (n === null || typeof n !== "object" || !("nameWithOwner" in n)) {
        nulls++;
        continue;
      }
      returned++;
      const r = readNode(n, q.digest);
      if (!by.has(r.nameWithOwner)) by.set(r.nameWithOwner, r);
    }
    records.push({ topic: q.topic, licence: q.licence, q: q.variables.q, digest: q.digest, cached, cost: reply.data.rateLimit?.cost ?? 0, repositoryCount: s.repositoryCount, returned: nodes.length - nulls, nullNodes: nulls });
  }
  return { queries: records, repos: [...by.values()], returned };
}

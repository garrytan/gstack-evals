// Copyright (c) 2026 Garry Tan. MIT License.
// Public GitHub metadata the miner reads beside the clone: merged pull requests and the issues they close. fetch.ts
// writes this file from the GitHub API; tests write it by hand. Dates are ISO 8601 UTC.

export interface CommitDates {
  sha: string;
  authored_at: string;
  committed_at: string;
}

export interface PrMeta {
  number: number;
  title: string;
  body: string;
  created_at: string;
  merged_at: string;
  /** The commit GitHub put on the base branch (squash, rebase tip or merge commit). */
  merge_commit: string | null;
  labels: string[];
  closing_issues: number[];
  commits: CommitDates[];
}

export interface IssueMeta {
  number: number;
  title: string;
  created_at: string;
  labels: string[];
}

export interface RepoMeta {
  repo: string;
  fetched_at: string;
  prs: PrMeta[];
  issues: IssueMeta[];
}

export class MetaError extends Error {}

const isStr = (v: unknown): v is string => typeof v === "string";
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));

export function parseMeta(text: string): RepoMeta {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new MetaError("metadata is not JSON: " + (error as Error).message);
  }
  const m = raw as RepoMeta;
  if (!m || !isStr(m.repo) || !Array.isArray(m.prs) || !Array.isArray(m.issues)) throw new MetaError("metadata needs repo, prs and issues");
  for (const pr of m.prs) {
    if (typeof pr.number !== "number" || !isDate(pr.created_at) || !isDate(pr.merged_at) || !Array.isArray(pr.commits) || !Array.isArray(pr.closing_issues)) {
      throw new MetaError("pull request " + JSON.stringify(pr.number) + " needs number, created_at, merged_at, commits and closing_issues");
    }
    for (const c of pr.commits) if (!isStr(c.sha) || !isDate(c.authored_at) || !isDate(c.committed_at)) throw new MetaError("pull request " + pr.number + " has a commit without dates");
  }
  for (const issue of m.issues) if (typeof issue.number !== "number" || !isDate(issue.created_at)) throw new MetaError("issue " + JSON.stringify(issue.number) + " needs number and created_at");
  return m;
}

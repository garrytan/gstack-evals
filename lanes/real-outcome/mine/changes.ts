// Copyright (c) 2026 Garry Tan. MIT License.
// A change is one first-parent commit on the default branch: a squash or rebase merge, or a merge commit whose diff
// against its first parent is the pull request's net change. This lists the changes merged since a date, with their
// files, their pull request and closing issues from the metadata, and their earliest exposure.
import { classifyPath, type PathClass } from "./paths.ts";
import { earliestExposure, type Exposure, type ExposurePart } from "./exposure.ts";
import { git, gitLines } from "./git.ts";
import type { IssueMeta, PrMeta, RepoMeta } from "./meta.ts";

export interface FileChange {
  path: string;
  status: "A" | "M" | "D" | "T";
  added: number;
  deleted: number;
  binary: boolean;
  cls: PathClass;
}

export interface Change {
  id: string;
  parent: string;
  /** Every commit the change brought in: itself, or for a merge commit the commits in parent..id. */
  commits: string[];
  merged_at: string;
  subject: string;
  body: string;
  files: FileChange[];
  pr: PrMeta | null;
  /** Issue numbers the change closes: its pull request's closing issues, or closing keywords without one. */
  closing: number[];
  /** The closing issues the metadata holds. */
  issues: IssueMeta[];
  exposure: Exposure;
}

const SEP = "\x1f";
const REC = "\x1e";

function parseFiles(raw: string, numstat: string): FileChange[] {
  const counts = new Map<string, { added: number; deleted: number; binary: boolean }>();
  for (const line of numstat.split("\n")) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    counts.set(m[3], { added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]), binary: m[1] === "-" });
  }
  const files: FileChange[] = [];
  for (const line of raw.split("\n")) {
    const m = /^:\d+ \d+ [0-9a-f]+ [0-9a-f]+ ([AMDT])\t(.+)$/.exec(line);
    if (!m) continue;
    const c = counts.get(m[2]) ?? { added: 0, deleted: 0, binary: false };
    files.push({ path: m[2], status: m[1] as FileChange["status"], ...c, cls: classifyPath(m[2]) });
  }
  return files;
}

export function changeFiles(repoDir: string, from: string, to: string): FileChange[] {
  const args = ["--no-renames", "--no-ext-diff", "--no-textconv", from, to];
  return parseFiles(git(repoDir, ["diff", "--raw", "--abbrev=40", ...args]), git(repoDir, ["diff", "--numstat", ...args]));
}

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;

/** Issue numbers a message closes with GitHub's keywords, for changes without a pull request record. */
export function closingRefs(text: string): number[] {
  return [...new Set([...text.matchAll(CLOSES)].map((m) => Number(m[1])))];
}

function commitDates(repoDir: string, shas: string[]): { sha: string; authored_at: string; committed_at: string }[] {
  if (shas.length === 0) return [];
  return gitLines(repoDir, ["show", "-s", "--format=%H %aI %cI", ...shas]).map((l) => {
    const [sha, a, c] = l.split(" ");
    return { sha, authored_at: a, committed_at: c };
  });
}

/**
 * Lists first-parent changes on branch merged at or after since (by committer date), oldest first. With meta, a change
 * takes its pull request by merge commit, else by a trailing "(#n)" in its subject, and its issues from the pull
 * request's closing issues. Without meta every exposure is incomplete.
 */
export function listChanges(repoDir: string, branch: string, since: string, meta: RepoMeta | null): Change[] {
  const out = git(repoDir, ["log", "--first-parent", "--reverse", "--since=" + since, "--format=%H" + SEP + "%P" + SEP + "%cI" + SEP + "%s" + SEP + "%b" + REC, branch]);
  const byMerge = new Map<string, PrMeta>();
  const byNumber = new Map<number, PrMeta>();
  for (const pr of meta?.prs ?? []) {
    if (pr.merge_commit) byMerge.set(pr.merge_commit, pr);
    byNumber.set(pr.number, pr);
  }
  const issues = new Map((meta?.issues ?? []).map((i) => [i.number, i]));
  const changes: Change[] = [];
  for (const rec of out.split(REC)) {
    const fields = rec.replace(/^\n/, "").split(SEP);
    if (fields.length < 5 || !/^[0-9a-f]{40}$/.test(fields[0])) continue;
    const [id, parents, mergedAt, subject, body] = fields;
    const parentList = parents.split(" ").filter(Boolean);
    if (parentList.length === 0) continue;
    const parent = parentList[0];
    const commits = parentList.length > 1 ? gitLines(repoDir, ["rev-list", parent + ".." + id]) : [id];
    const prRef = /\(#(\d+)\)\s*$/.exec(subject);
    const pr = byMerge.get(id) ?? (prRef ? byNumber.get(Number(prRef[1])) ?? null : null);
    const parts: ExposurePart[] = [];
    const missing: string[] = [];
    if (meta === null) missing.push("metadata");
    const issueNumbers = pr ? pr.closing_issues : closingRefs(subject + "\n" + body);
    const linked: IssueMeta[] = [];
    for (const n of issueNumbers) {
      const issue = issues.get(n);
      if (issue) {
        linked.push(issue);
        parts.push({ source: "issue", ref: "#" + n, at: issue.created_at });
      } else missing.push("issue #" + n);
    }
    if (pr) parts.push({ source: "pr", ref: "#" + pr.number, at: pr.created_at });
    else if (prRef && meta !== null) missing.push("pull request #" + prRef[1]);
    const dates = pr && pr.commits.length > 0 ? pr.commits : commitDates(repoDir, commits);
    for (const c of dates) {
      parts.push({ source: "commit", ref: c.sha, at: c.authored_at });
      parts.push({ source: "commit", ref: c.sha, at: c.committed_at });
    }
    changes.push({ id, parent, commits, merged_at: new Date(mergedAt).toISOString(), subject, body: body.trim(), files: changeFiles(repoDir, parent, id), pr, closing: issueNumbers, issues: linked, exposure: earliestExposure(parts, missing) });
  }
  return changes;
}

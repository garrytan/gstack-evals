// Gates 1 and 4 for both pools (plan 2026-11-24-geva-590-review-models-prereg, section 2). Gate 1: the fix commit's
// author and committer dates are both on or after 2026-07-01 (read in UTC), and no public disclosure the supply can see
// predates it. Gate 4, containment: the unit tree carries no history past its head (the fix is not an ancestor), no
// CLAUDE.md, AGENTS.md or .claude/, and no tracked file or commit message holding a needle: the advisory id, a CVE id,
// the fix commit's first 12 hex characters, or the review-real-bugs suite's name and case ids.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { removeTree } from "../../cleanup.ts";
import { git, gitOut, supplyFail, type CommitDates } from "./git.ts";

export const CUTOFF = "2026-07-01";
const CUTOFF_MS = Date.parse(CUTOFF + "T00:00:00Z");

/** A gate's result: "ok", or why the unit fails it. A gate with no result yet is pending. */
export type Gate = "ok" | { fail: string };
export const passed = (g: Gate | undefined): boolean => g === "ok";

const onOrAfter = (iso: string): boolean => Number.isFinite(Date.parse(iso)) && Date.parse(iso) >= CUTOFF_MS;

/** Gate 1 from the fix commit's dates and each disclosure date the supply read (label to ISO date). */
export function gate1(fix: CommitDates, disclosures: Record<string, string | null>): Gate {
  if (!onOrAfter(fix.author)) return { fail: "the fix's author date " + fix.author + " is before " + CUTOFF };
  if (!onOrAfter(fix.committer)) return { fail: "the fix's committer date " + fix.committer + " is before " + CUTOFF };
  for (const [what, at] of Object.entries(disclosures)) {
    if (at !== null && !onOrAfter(at)) return { fail: what + " " + at + " is before " + CUTOFF };
  }
  return "ok";
}

export interface Needles { strings: string[]; fix: string | null }

const INSTRUCTION = (path: string): boolean => {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return name === "CLAUDE.md" || name === "AGENTS.md" || parts.slice(0, -1).includes(".claude");
};

/** Every containment problem of a checked-out tree at dir whose HEAD is the unit's head: an empty list passes gate 4. */
export function treeProblems(dir: string, needles: Needles): string[] {
  const problems: string[] = [];
  const files = gitOut(dir, ["ls-files", "-z"], "list the unit's files").split("\0").filter(Boolean);
  const instr = files.filter(INSTRUCTION);
  if (instr.length) problems.push("instruction files: " + instr.slice(0, 5).join(", ") + (instr.length > 5 ? " and " + (instr.length - 5) + " more" : ""));
  const strings = needles.strings.filter(Boolean);
  if (needles.fix) strings.push(needles.fix.slice(0, 12));
  if (strings.length) {
    const grep = git(dir, ["grep", "-l", "-I", "-i", "-F", ...strings.flatMap((s) => ["-e", s])]);
    if (grep.status === 0) problems.push("files hold a needle: " + grep.stdout.trim().split("\n").slice(0, 5).join(", "));
    else if (grep.status !== 1) supplyFail("E_RMS_GIT", "git grep in " + dir + ": " + grep.stderr.trim());
    const log = gitOut(dir, ["log", "--format=%B", "HEAD"], "read the unit's commit messages").toLowerCase();
    const named = strings.filter((s) => log.includes(s.toLowerCase()));
    if (named.length) problems.push("commit messages name " + named.join(", "));
  }
  if (needles.fix) {
    const anc = git(dir, ["merge-base", "--is-ancestor", needles.fix, "HEAD"]);
    if (anc.status === 0) problems.push("the fix commit is in the head's history");
  }
  return problems;
}

/** Gate 4 on a source clone: checks out rev in a temporary worktree (fetching its blobs once) and runs treeProblems there. */
export function containmentAt(clone: string, rev: string, needles: Needles, wt: string): Gate {
  removeTree(wt);
  mkdirSync(dirname(wt), { recursive: true });
  git(clone, ["worktree", "prune"]);
  gitOut(clone, ["worktree", "add", "--quiet", "--detach", wt, rev], "check out " + rev, { timeoutMs: 3_600_000 });
  try {
    const problems = treeProblems(wt, needles);
    return problems.length ? { fail: problems.join("; ") } : "ok";
  } finally {
    git(clone, ["worktree", "remove", "--force", wt]);
    removeTree(wt);
  }
}

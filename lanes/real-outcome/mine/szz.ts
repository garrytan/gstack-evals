// Copyright (c) 2026 Garry Tan. MIT License.
// K1 escaped-bug pairs. SZZ: for a later fix that adds or changes a test, blame the source lines it deletes or edits
// (git blame -w -M at the fix's parent, skipping blank and comment-only lines) and map each blamed commit to the
// first-parent change that brought it in; an in-window change that owns blamed lines is a candidate introducer, and
// the one owning the most lines is the pair's introducer. Reverts: a revert that cites a defect pairs the reverted
// change with its re-land, whose tests become the escaped-defect tests; a revert for product reasons pairs nothing.
import type { Change } from "./changes.ts";
import { gitRun, showFile } from "./git.ts";

const FIX_WORDS = /\b(fix(e[sd])?|bug(s|fix)?|hotfix|regression|crash(es|ed)?|broken|incorrect|wrong|repair)\b/i;
const DEFECT_WORDS = /\b(bugs?|broke|breaks|broken|breaking|regress(ion|ed|es)?|crash(es|ed|ing)?|fail(s|ed|ing|ure|ures)?|errors?|incorrect|wrong|corrupt(s|ed|ion)?|leak(s|ed)?|panic(s|ked)?)\b/i;
const BUG_LABEL = /\b(bug|defect|regression)\b/i;
const COMMENT_ONLY = /^\s*(#|\/\/|\/\*|\*|\*\/|"""|''')/;

export const touchesSourceAndTests = (c: Change): boolean => c.files.some((f) => f.cls === "source") && c.files.some((f) => f.cls === "test");

/** A fix: its subject, body, pull request title or labels, or a closing issue's title or labels, name a defect. */
export function isFixLike(c: Change): boolean {
  const text = [c.subject, c.body, c.pr?.title ?? "", ...c.issues.map((i) => i.title)].join("\n");
  const labels = [...(c.pr?.labels ?? []), ...c.issues.flatMap((i) => i.labels)];
  return FIX_WORDS.test(text) || labels.some((l) => BUG_LABEL.test(l));
}

/** Old-side line numbers (1-based) of each source file a change edits or deletes. */
export function editedOldLines(repoDir: string, c: Change): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of c.files) {
    if (f.cls !== "source" || (f.status !== "M" && f.status !== "D") || f.binary) continue;
    const old = (showFile(repoDir, c.parent, f.path) ?? "").split("\n");
    const lines: number[] = [];
    const diff = gitRun(repoDir, ["diff", "-U0", "--no-ext-diff", "--no-textconv", "--no-renames", c.parent, c.id, "--", f.path]).stdout;
    for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let n = start; n < start + count; n++) {
        const text = old[n - 1] ?? "";
        if (text.trim().length > 0 && !COMMENT_ONLY.test(text)) lines.push(n);
      }
    }
    if (lines.length > 0) out.set(f.path, lines);
  }
  return out;
}

/** The commit that last changed each given line at rev, from git blame -w -M --porcelain. */
export function blame(repoDir: string, rev: string, path: string, lines: number[]): Map<number, string> {
  const args = ["blame", "-w", "-M", "--porcelain"];
  for (const n of lines) args.push("-L", n + "," + n);
  const r = gitRun(repoDir, [...args, rev, "--", path]);
  const out = new Map<number, string>();
  if (r.status !== 0) return out;
  let sha = "";
  let final = 0;
  for (const line of r.stdout.split("\n")) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (h) {
      sha = h[1];
      final = Number(h[2]);
    } else if (line.startsWith("\t") && sha) out.set(final, sha);
  }
  return out;
}

export interface Introducer {
  change: string;
  lines: number;
}

/** Candidate introducers of a fix, most blamed lines first. owner maps a commit to the in-window change that brought it in. */
export function introducers(repoDir: string, fix: Change, owner: Map<string, string>, order: Map<string, number>): Introducer[] {
  const counts = new Map<string, number>();
  for (const [path, lines] of editedOldLines(repoDir, fix)) {
    for (const sha of blame(repoDir, fix.parent, path, lines).values()) {
      const change = owner.get(sha);
      if (change === undefined || change === fix.id) continue;
      if ((order.get(change) ?? Infinity) >= (order.get(fix.id) ?? -Infinity)) continue;
      counts.set(change, (counts.get(change) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([change, lines]) => ({ change, lines })).sort((a, b) => b.lines - a.lines || (order.get(a.change) ?? 0) - (order.get(b.change) ?? 0));
}

export interface Revert {
  revert: string;
  reverted: string | null;
  reverted_title: string | null;
  defect: boolean;
}

/** Reads a revert commit: git's own "Revert \"title\"" subject and "This reverts commit <sha>" line. */
export function readRevert(repoDir: string, c: Change): Revert | null {
  const title = /^Revert "(.+)"\s*(\(#\d+\))?$/.exec(c.subject);
  const sha = /This reverts commit ([0-9a-f]{7,40})/.exec(c.body);
  if (!title && !sha) return null;
  let reverted: string | null = null;
  if (sha) {
    const r = gitRun(repoDir, ["rev-parse", "--verify", "--quiet", sha[1] + "^{commit}"]);
    reverted = r.status === 0 ? r.stdout.trim() : null;
  }
  const reason = [c.body.replace(/This reverts commit [0-9a-f]+\.?/g, ""), c.pr?.body ?? "", ...c.issues.map((i) => i.title)].join("\n");
  const labels = [...(c.pr?.labels ?? []), ...c.issues.flatMap((i) => i.labels)];
  return { revert: c.id, reverted, reverted_title: title ? title[1] : null, defect: DEFECT_WORDS.test(reason) || labels.some((l) => BUG_LABEL.test(l)) };
}

const stripPr = (s: string): string => s.replace(/\s*\(#\d+\)\s*$/, "").trim();

/** The later change that re-lands a reverted one: a Reland, Re-land, Reapply or Roll forward subject naming its title. */
export function findReland(changes: Change[], reverted: Change, after: number): Change | null {
  const title = stripPr(reverted.subject).toLowerCase();
  for (const c of changes.slice(after + 1)) {
    const m = /^(re-?land|re-?apply|roll forward)\b[:\s]*"?(.*?)"?\s*(\(#\d+\))?$/i.exec(c.subject);
    if (m && stripPr(m[2]).toLowerCase() === title) return c;
    if (c.body.includes(reverted.id)) return c;
  }
  return null;
}

/** Commits the first-parent changes brought in, mapped to their change id. */
export function ownerMap(changes: Change[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of changes) for (const sha of c.commits) m.set(sha, c.id);
  return m;
}

export const shortId = (sha: string): string => sha.slice(0, 12);
export const touchedTests = (c: Change): string[] => c.files.filter((f) => f.cls === "test" && f.status !== "D").map((f) => f.path);

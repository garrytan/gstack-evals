// Copyright (c) 2026 Garry Tan. MIT License.
// The State Machines review specialist eval (SR): each unit is a real state-bug fix paired with the commit that brought the
// bug in (the BIC). This file finds the BIC by SZZ on a host clone, applies the plan's git-level gates and writes the
// change the reviewer sees, re-based onto the fix's base (plan section 2):
//   - SZZ: git blame -w at the fix's base commit of every non-trivial line the fix deletes from a non-test source file; when
//     the fix deletes no such line, the lines on each side of each insertion. The BIC is the commit blamed for the most
//     lines, ties broken by the smaller sha.
//   - Gates, in order: a BIC was found; it has one parent; it carries at least half the blamed lines; it changes at most
//     2,000 lines (binary files not counted); the change under review adds at least half of the lines blamed on the BIC.
// The change under review (pr.patch) is every hunk of the BIC's text diff, taken with no context lines, that reverse-applies
// at the fix's base (git apply -R --unidiff-zero --reject, so a hunk whose lines have moved on is left out), outside the
// paths the strip rule removes:
// commit one of the session tree is the base with those hunks reversed, commit two is the base itself. The unit's
// scored tree is the fix's base, as the state machines harness converts it. Nothing here calls a model.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, type Lang } from "../statemachines/langs.ts";
import { patchFiles } from "../statemachines/source.ts";
import { detectStateMachine } from "./detect.ts";

export const MAX_BIC_LINES = 2000;
export const MIN_SHARE = 0.5;
export const MIN_IN_PR = 0.5;
export type BicDrop = "E_SR_NO_BIC" | "E_SR_BIC_MERGE" | "E_SR_BIC_SHARE" | "E_SR_BIC_SIZE" | "E_SR_PR_MISSES_BUG";
type Detected = { detected: boolean; hits: number; subject: string[]; action: string[] };

/** hunks: the BIC's text hunks; kept: those in the change under review; left_out: path and hunk count of each file with a
 *  hunk left out. in_pr: blamed lines the change under review adds. detector: gstack's detector on the change under
 *  review; detector_bic: on the BIC's own diff. */
export interface BicRecord {
  schema: "sr-bic.v1"; id: string; repo: string; lang: Lang; fix_base: string;
  basis: "deleted" | "context" | "none"; blamed_lines: number; blamed_commits: number;
  bic: string | null; share: number | null; parents: number | null; bic_date: string | null; bic_lines: number | null; bic_files: number | null;
  commits_bic_to_base: number | null; hunks: number | null; kept: number | null; left_out: Array<{ path: string; hunks: number }>;
  blamed_by_bic: number | null; in_pr: number | null; pr_added: number | null; pr_deleted: number | null; pr_files: string[];
  detector: Detected | null; detector_bic: Detected | null; drop: BicDrop | null; pr_sha256: string | null;
}
export interface BicUnit { record: BicRecord; pr: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** git's output is read as latin1 so blame keeps every byte; a diff a unit writes is decoded back to UTF-8. */
const u8 = (s: string) => Buffer.from(s, "latin1").toString("utf8");
function git(dir: string, args: string[], input?: Buffer): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-c", "core.quotePath=false", "-c", "advice.detachedHead=false", ...args], { cwd: dir, input, encoding: "latin1", maxBuffer: 1 << 30, timeout: 900_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
/** The strip rule's paths (state machines section 4): never part of the change under review. */
export const stripped = (p: string): boolean => /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$/.test(p) || /(^|\/)\.claude(\/|$)/.test(p);

/** A line that carries no code of its own: brackets and separators only, or a bare keyword line. */
export const trivial = (line: string): boolean => {
  const t = line.trim();
  return /^[{}()\[\];,]*$/.test(t) || /^(else|end|pass|return;?|break;?|continue;?|\}\s*else\s*\{|\}\s*\)\s*;?)$/.test(t);
};

/** Old-side line numbers the fix deletes, and the old-side lines on each side of each insertion, per file. */
export function fixLines(patch: string): Map<string, { deleted: number[]; context: number[] }> {
  const out = new Map<string, { deleted: number[]; context: number[] }>();
  let cur: { deleted: number[]; context: number[] } | null = null;
  let old = 0, added = false, left = 0, right = 0;
  for (const raw of patch.split("\n")) {
    if (left > 0 || right > 0) {
      if (!cur) continue;
      if (raw.startsWith("-")) { cur.deleted.push(old); old += 1; left -= 1; added = false; }
      else if (raw.startsWith("+")) { if (!added) cur.context.push(old - 1, old); added = true; right -= 1; }
      else if (raw.startsWith(" ") || raw === "") { old += 1; left -= 1; right -= 1; added = false; }
      continue;
    }
    const d = /^diff --git a\/(\S+) b\/(\S+)$/.exec(raw);
    if (d) { cur = { deleted: [], context: [] }; out.set(d[1]!, cur); continue; }
    if (!cur) continue;
    if (raw.startsWith("new file mode")) { cur.deleted.length = 0; cur.context.length = 0; cur = null; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(raw);
    if (h) { old = Number(h[1]); left = h[2] === undefined ? 1 : Number(h[2]); right = h[3] === undefined ? 1 : Number(h[3]); added = false; }
  }
  return out;
}

function blame(dir: string, base: string, path: string, lines: number[]): Array<{ sha: string; text: string; path: string; line: number }> {
  const out: Array<{ sha: string; text: string; path: string; line: number }> = [];
  for (const n of [...new Set(lines)].filter((x) => x >= 1).sort((a, b) => a - b)) {
    const r = git(dir, ["blame", "-w", "--porcelain", "-L", n + "," + n, base, "--", path]);
    if (r.status !== 0) continue;
    const text = r.stdout.split("\n").find((l) => l.startsWith("\t"));
    out.push({ sha: r.stdout.slice(0, 40), text: text ? text.slice(1) : "", path, line: n });
  }
  return out;
}


/** New-side line numbers a diff adds, per file, keyed path:line. */
export function addedLines(diff: string): Set<string> {
  const out = new Set<string>();
  let path = "", n = 0, left = 0, right = 0;
  for (const raw of diff.split("\n")) {
    if (left > 0 || right > 0) {
      if (raw.startsWith("+")) { if (path) out.add(path + ":" + n); n++; right -= 1; }
      else if (raw.startsWith("-")) left -= 1;
      else if (raw.startsWith(" ") || raw === "") { n++; left -= 1; right -= 1; }
      continue;
    }
    if (raw.startsWith("diff --git ")) { path = ""; continue; }
    const p = /^\+\+\+ (?:b\/(.*)|\/dev\/null)$/.exec(raw);
    if (p) { path = p[1] ?? ""; continue; }
    const h = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (h) { n = Number(h[2]); left = h[1] === undefined ? 1 : Number(h[1]); right = h[3] === undefined ? 1 : Number(h[3]); }
  }
  return out;
}
const hunkCount = (diff: string) => (diff.match(/^@@ /gm) ?? []).length;

/** The change under review on a scratch worktree at base: the BIC's text diff with no context lines and no rename pairing
 *  (stripped paths left out) reverse-applied file by file with --unidiff-zero --reject, so a hunk applies wherever its own
 *  lines still stand at base. A file git refuses whole (gone at base, or recreated there) writes no .rej, so all its hunks
 *  are left out; a file the BIC created that git will not delete (later commits extended it) is reversed as a plain hunk
 *  that removes the BIC's lines where they still stand. Returns the change (base with the kept hunks reversed, to base) and
 *  each file's left-out hunks. */
function rebase(dir: string, bic: string, base: string, files: string[]): { pr: string; hunks: number; leftOut: Array<{ path: string; hunks: number }> } {
  const diff = git(dir, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=0", bic + "^", bic, "--", ...files]).stdout;
  const wt = mkdtempSync(join(tmpdir(), "sr-pr-"));
  try {
    if (git(dir, ["worktree", "add", "--quiet", "--detach", "-f", wt, base]).status !== 0) return { pr: "", hunks: hunkCount(diff), leftOut: [] };
    const leftOut: Array<{ path: string; hunks: number }> = [];
    const apply = (patch: string) => git(wt, ["apply", "-R", "--unidiff-zero", "--reject", "--whitespace=nowarn", "-"], Buffer.from(patch, "latin1")).status === 0;
    const parts = diff.split(/^(?=diff --git )/m).filter((p) => p.startsWith("diff --git "));
    const names = git(dir, ["diff", "--name-only", "-z", "--no-renames", bic + "^", bic, "--", ...files]).stdout.split("\0").filter(Boolean);
    if (names.length !== parts.length) throw new Error("E_SR_SOURCE the BIC's diff has " + parts.length + " file parts but " + names.length + " names");
    for (const [i, part] of parts.entries()) {
      const path = names[i]!;
      const rej = join(wt, path + ".rej");
      let ok = apply(part);
      if (!ok && !existsSync(rej) && /^--- \/dev\/null$/m.test(part)) ok = apply(part.replace(/^new file mode .*\n/m, "").replace(/^--- \/dev\/null$/m, (/^\+\+\+ .*$/m.exec(part)?.[0] ?? "").replace(/^\+\+\+ ("?)b\//, "--- $1a/")));
      if (existsSync(rej)) { leftOut.push({ path, hunks: hunkCount(readFileSync(rej, "latin1")) }); rmSync(rej); }
      else if (!ok) leftOut.push({ path, hunks: hunkCount(part) });
    }
    git(wt, ["add", "-A"]);
    const before = git(wt, ["write-tree"]).stdout.trim();
    const pr = git(wt, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", before, base]).stdout;
    return { pr, hunks: hunkCount(diff), leftOut: leftOut.sort((a, b) => (a.path < b.path ? -1 : 1)) };
  } finally {
    git(dir, ["worktree", "remove", "--force", wt]);
    if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
  }
}

/** SZZ, the gates and the change under review for one fix, on a full clone that holds its base commit. */
export function findBic(dir: string, row: { instance_id: string; repo: string; base_commit: string; patch: string; test_patch: string }, lang: Lang): BicUnit {
  const base = row.base_commit;
  const tests = new Set(patchFiles(row.test_patch));
  const rec: BicRecord = { schema: "sr-bic.v1", id: row.instance_id, repo: row.repo, lang, fix_base: base, basis: "none", blamed_lines: 0, blamed_commits: 0, bic: null, share: null, parents: null, bic_date: null, bic_lines: null, bic_files: null, commits_bic_to_base: null, hunks: null, kept: null, left_out: [], blamed_by_bic: null, in_pr: null, pr_added: null, pr_deleted: null, pr_files: [], detector: null, detector_bic: null, drop: null, pr_sha256: null };
  const lines = [...fixLines(row.patch)].filter(([p]) => classify(lang, p, tests) === "source");
  const blamed = (which: "deleted" | "context") => lines.flatMap(([p, l]) => blame(dir, base, p, l[which])).filter((b) => !trivial(b.text));
  let bl = blamed("deleted");
  rec.basis = bl.length ? "deleted" : "none";
  if (!bl.length) { bl = blamed("context"); if (bl.length) rec.basis = "context"; }
  const c = new Map<string, number>();
  for (const b of bl) c.set(b.sha, (c.get(b.sha) ?? 0) + 1);
  rec.blamed_commits = c.size;
  rec.blamed_lines = bl.length;
  if (!c.size) return { record: { ...rec, drop: "E_SR_NO_BIC" }, pr: "" };
  const [bic, n] = [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
  rec.bic = bic;
  rec.blamed_by_bic = n;
  rec.share = Math.round((n / rec.blamed_lines) * 1000) / 1000;
  const [parents, date] = git(dir, ["show", "-s", "--format=%P%x09%cI", bic]).stdout.trim().split("\t");
  rec.parents = (parents ?? "").split(" ").filter(Boolean).length;
  rec.bic_date = (date ?? "").slice(0, 10) || null;
  if (rec.parents !== 1) return { record: { ...rec, drop: "E_SR_BIC_MERGE" }, pr: "" };
  const num = git(dir, ["diff", "--numstat", bic + "^", bic]).stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  rec.bic_files = num.length;
  rec.bic_lines = num.reduce((a, [x, y]) => a + (x === "-" ? 0 : Number(x) + Number(y)), 0);
  rec.commits_bic_to_base = Number(git(dir, ["rev-list", "--count", bic + ".." + base]).stdout.trim());
  if (rec.share < MIN_SHARE) return { record: { ...rec, drop: "E_SR_BIC_SHARE" }, pr: "" };
  if (rec.bic_lines > MAX_BIC_LINES) return { record: { ...rec, drop: "E_SR_BIC_SIZE" }, pr: "" };
  rec.detector_bic = detectStateMachine(u8(git(dir, ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", "--no-color", bic + "^", bic]).stdout));
  const text = git(dir, ["diff", "--numstat", "--no-renames", "-z", bic + "^", bic]).stdout.split("\0").filter(Boolean).map((l) => l.split("\t")).filter(([x]) => x !== "-").map((x) => x.slice(2).join("\t")).filter((p) => !stripped(p));
  const r = rebase(dir, bic, base, text);
  const pr = u8(r.pr);
  const added = addedLines(pr);
  rec.hunks = r.hunks;
  rec.left_out = r.leftOut;
  rec.kept = r.hunks - r.leftOut.reduce((a, x) => a + x.hunks, 0);
  rec.in_pr = bl.filter((b) => b.sha === bic && added.has(b.path + ":" + b.line)).length;
  rec.pr_added = pr.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  rec.pr_deleted = pr.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  rec.pr_files = patchFiles(pr);
  rec.pr_sha256 = sha(pr);
  rec.detector = detectStateMachine(pr);
  if (!rec.in_pr || rec.in_pr < MIN_IN_PR * n) return { record: { ...rec, drop: "E_SR_PR_MISSES_BUG" }, pr: "" };
  return { record: rec, pr };
}

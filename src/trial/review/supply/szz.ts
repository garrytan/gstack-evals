// SZZ for B units (plan 2026-11-24-geva-590-review-models-prereg, section 2 and section 10 item 3), ported from the
// design-stage prototype (Captain drive handoffs/GEVA-590/szz-prototype/szz.py). At the fix's parent, git blame -w every
// non-trivial line the fix deletes in a source file; when it deletes none, blame the lines beside each insertion. The
// bug-introducing commit (BIC) is the commit blamed for the most lines. Two changes from the prototype, both so the
// result is the same on every run: a tie goes to the commit blamed first in patch order (the prototype did the same within
// one file, but took files in Python's set order), and a deleted line whose text starts with "--" counts as deleted (the
// prototype read it as a file header).
import { git, gitOut } from "./git.ts";

/** Paths that are not source: tests, fixtures, examples, docs and data files (the prototype's TEST pattern). */
export const NON_SOURCE = /(^|\/)(tests?|spec|specs|__tests__|testing|testdata|test_data|fixtures?|e2e|benches|examples?)\/|(_test|_tests|_spec|\.test|\.spec|Tests?|Spec)\.[A-Za-z]+$|(^|\/)test_[^/]*$|\.(md|txt|json|ya?ml|lock|snap|toml|cfg|ini|xml|csproj|sln)$/i;

export interface PatchFile { a: string; b: string; added: boolean; hunks: Array<{ dels: number[]; addsAt: number[] }> }

/** Each file of a unified diff with, per hunk, the old-side numbers of deleted lines and of the line each insertion precedes. */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let cur: PatchFile | null = null;
  let ln = 0;
  for (const line of patch.split("\n")) {
    const d = line.match(/^diff --git a\/(\S+) b\/(\S+)/);
    if (d) {
      cur = { a: d[1]!, b: d[2]!, added: false, hunks: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!cur.hunks.length) {
      if (line.startsWith("new file mode")) cur.added = true;
      const h = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (h) {
        cur.hunks.push({ dels: [], addsAt: [] });
        ln = Number(h[1]);
      }
      continue;
    }
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    const hunk = cur.hunks[cur.hunks.length - 1]!;
    if (h) {
      cur.hunks.push({ dels: [], addsAt: [] });
      ln = Number(h[1]);
    } else if (line.startsWith("-")) hunk.dels.push(ln++);
    else if (line.startsWith("+")) hunk.addsAt.push(ln);
    else if (line.startsWith(" ")) ln++;
  }
  return files;
}

export interface Target { path: string; line: number }
/** Lines to blame at the fix's parent: deleted lines, and the lines beside each insertion, in source files the fix does not add. */
export function blameTargets(files: readonly PatchFile[]): { source: string[]; deleted: Target[]; beside: Target[] } {
  const src = files.filter((f) => !NON_SOURCE.test(f.b));
  const deleted: Target[] = [], beside: Target[] = [];
  for (const f of src) {
    if (f.added) continue;
    for (const h of f.hunks) {
      for (const line of h.dels) deleted.push({ path: f.a, line });
      for (const at of new Set(h.addsAt)) beside.push({ path: f.a, line: at - 1 }, { path: f.a, line: at });
    }
  }
  return { source: src.map((f) => f.b), deleted, beside };
}

export interface Blamed { sha: string; path: string; line: number; text: string }

const lineCount = (text: string): number => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

/** git blame -w at rev of each target line in order, one record per line that exists; paths blame in order of first target. */
export function blameLines(dir: string, rev: string, targets: readonly Target[]): Blamed[] {
  const byPath = new Map<string, number[]>();
  for (const t of targets) if (t.line >= 1) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t.line]);
  const out: Blamed[] = [];
  for (const [path, wanted] of byPath) {
    const shown = git(dir, ["cat-file", "-p", rev + ":" + path]);
    if (shown.status !== 0) continue;
    const n = lineCount(shown.stdout);
    const lines = [...new Set(wanted)].filter((l) => l <= n).sort((x, y) => x - y);
    for (let i = 0; i < lines.length; i += 400) {
      const ranges = lines.slice(i, i + 400).flatMap((l) => ["-L", l + "," + l]);
      const text = gitOut(dir, ["blame", "-w", "--line-porcelain", ...ranges, rev, "--", path], "git blame " + path + " at " + rev, { timeoutMs: 1_800_000 });
      let sha = "", final = 0;
      for (const row of text.split("\n")) {
        const head = row.match(/^([0-9a-f]{40}) \d+ (\d+)/);
        if (head) {
          sha = head[1]!;
          final = Number(head[2]);
        } else if (row.startsWith("\t")) out.push({ sha, path, line: final, text: row.slice(1) });
      }
    }
  }
  return out;
}

const TRIVIAL = new Set(["{", "}", "};", ")", "});", "end", "else", "} else {", "return;", "break;"]);
export const nontrivial = (text: string): boolean => text.trim().length > 1 && !TRIVIAL.has(text.trim());

export interface BicPick {
  basis: "deleted" | "beside" | "none";
  blamed_lines: number;
  blamed_commits: number;
  bic: string | null;
  bic_lines: number;
}

/** The most-blamed commit over the non-trivial deleted lines, else over the non-trivial lines beside insertions. A tie
 *  goes to the commit blamed first. */
export function pickBic(deleted: readonly Blamed[], beside: readonly Blamed[]): BicPick {
  const count = (rows: readonly Blamed[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (nontrivial(r.text)) m.set(r.sha, (m.get(r.sha) ?? 0) + 1);
    return m;
  };
  let basis: BicPick["basis"] = "deleted";
  let counts = count(deleted);
  if (!counts.size) {
    basis = "beside";
    counts = count(beside);
  }
  if (!counts.size) return { basis: "none", blamed_lines: 0, blamed_commits: 0, bic: null, bic_lines: 0 };
  let bic = "", most = 0, total = 0;
  for (const [sha, n] of counts) {
    total += n;
    if (n > most) [bic, most] = [sha, n];
  }
  return { basis, blamed_lines: total, blamed_commits: counts.size, bic, bic_lines: most };
}

export interface BicShape { parents: number; files: number; lines: number; source_lines: number }

/** The BIC's parent count and, for a single-parent commit, its changed lines in all files and in source files (text files only). */
export function bicShape(dir: string, bic: string): BicShape {
  const parents = gitOut(dir, ["show", "-s", "--format=%P", bic], "read the parents of " + bic).trim().split(/\s+/).filter(Boolean).length;
  if (parents !== 1) return { parents, files: 0, lines: 0, source_lines: 0 };
  let files = 0, lines = 0, source_lines = 0;
  for (const row of gitOut(dir, ["diff", "--numstat", bic + "^", bic], "numstat " + bic).split("\n")) {
    const [a, d, path] = row.split("\t");
    if (!row || a === "-" || path === undefined) continue;
    files++;
    lines += Number(a) + Number(d);
    if (!NON_SOURCE.test(path)) source_lines += Number(a) + Number(d);
  }
  return { parents, files, lines, source_lines };
}

/** Gate 2: one parent (so not the initial commit), at least half the blamed lines, at most 2,000 changed lines and at least 1 source line. */
export function gate2(pick: BicPick, shape: BicShape): string | null {
  if (shape.parents === 0) return "the BIC is the initial commit";
  if (shape.parents !== 1) return "the BIC has " + shape.parents + " parents";
  if (pick.bic_lines * 2 < pick.blamed_lines) return "the BIC carries " + pick.bic_lines + " of " + pick.blamed_lines + " blamed lines, under half";
  if (shape.lines > 2000) return "the BIC changes " + shape.lines + " lines, over 2,000";
  if (shape.source_lines < 1) return "the BIC changes no source line";
  return null;
}

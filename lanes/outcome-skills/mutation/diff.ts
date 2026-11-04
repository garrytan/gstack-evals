// Copyright (c) 2026 Garry Tan. MIT License.
// Reads the agent's tree, a git patch against the image's starting tree, into the lines it touched per file, and sorts
// each file into source the scorer may mutate, test code, or neither (outcome-per-skill plan v3, section 3).
import type { Lang } from "./pins.ts";

export interface FileChange {
  /** Path before the change, null for an added file. */
  oldPath: string | null;
  /** Path after the change, null for a deleted file. */
  newPath: string | null;
  /** Line numbers in the new file of every added line. */
  added: number[];
  /** Positions in the new file next to removed lines: the line that now stands where they were, at least 1. */
  removedAt: number[];
  binary: boolean;
}

function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[++i]!;
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 } as Record<string, number>)[next] ?? next.charCodeAt(0));
  }
  return Buffer.from(bytes).toString("utf8");
}

const stripSide = (p: string): string | null => {
  const u = unquote(p.trim().replace(/\t.*$/, ""));
  if (u === "/dev/null") return null;
  return /^[ab]\//.test(u) ? u.slice(2) : u;
};

/** Every file the patch touches, with the new-file lines it added. Hunks are read by their line counts, so a content
 * line that starts with "---" or "+++" is never taken for a header. */
export function parsePatch(patch: string): FileChange[] {
  const out: FileChange[] = [];
  const lines = patch.split("\n");
  let cur: FileChange | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (.+?) (b\/.+|"b\/.+")$/.exec(line);
      cur = { oldPath: m ? stripSide(m[1]!) : null, newPath: m ? stripSide(m[2]!) : null, added: [], removedAt: [], binary: false };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("new file mode")) cur.oldPath = null;
    else if (line.startsWith("deleted file mode")) cur.newPath = null;
    else if (line.startsWith("rename from ")) cur.oldPath = unquote(line.slice(12));
    else if (line.startsWith("rename to ")) cur.newPath = unquote(line.slice(10));
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") cur.binary = true;
    else if (line.startsWith("--- ")) cur.oldPath = stripSide(line.slice(4));
    else if (line.startsWith("+++ ")) cur.newPath = stripSide(line.slice(4));
    else if (line.startsWith("@@")) {
      const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!h) continue;
      let oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      let newLeft = h[4] === undefined ? 1 : Number(h[4]);
      let n = Number(h[3]);
      if (newLeft === 0) n += 1;
      while ((oldLeft > 0 || newLeft > 0) && i + 1 < lines.length) {
        const body = lines[++i]!;
        if (body.startsWith("\\")) continue;
        if (body.startsWith("+")) {
          cur.added.push(n++);
          newLeft--;
        } else if (body.startsWith("-")) {
          cur.removedAt.push(Math.max(1, n));
          oldLeft--;
        } else {
          n++;
          oldLeft--;
          newLeft--;
        }
      }
    }
  }
  return out;
}

const SKIP = /(^|\/)(node_modules|vendor|target|\.git|dist|build|__pycache__|\.venv|venv|mutants|testdata|\.stryker-tmp)(\/|$)/;
const TS_CONFIG = /(^|\/)(vitest|vite|stryker|eslint|prettier|tsup|rollup|webpack|jest|babel|playwright)\.(config|workspace)\.[cm]?[jt]s$/;

/** source: the scorer may mutate it. test: test code, whose units are found by units.ts. other: neither. */
export function classify(lang: Lang, path: string): "source" | "test" | "other" {
  if (SKIP.test(path)) return "other";
  switch (lang) {
    case "python":
      if (!/\.py$/.test(path)) return "other";
      if (/(^|\/)tests?\//.test(path) || /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(path)) return "test";
      return /(^|\/)(setup|noxfile|fabfile)\.py$/.test(path) || /^(docs?|examples?|scripts?)\//.test(path) ? "other" : "source";
    case "go":
      if (!/\.go$/.test(path)) return "other";
      return /_test\.go$/.test(path) ? "test" : "source";
    case "rust":
      if (!/\.rs$/.test(path)) return "other";
      if (/(^|\/)tests\//.test(path)) return "test";
      return /(^|\/)(benches|examples)\//.test(path) || /(^|\/)build\.rs$/.test(path) ? "other" : "source";
    case "typescript":
      if (/\.d\.[cm]?ts$/.test(path) || !/\.[cm]?[jt]sx?$/.test(path) || TS_CONFIG.test(path)) return "other";
      return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || /(^|\/)__tests__\//.test(path) ? "test" : "source";
  }
}

/** The lines of the new file the patch touched: added lines, and the positions next to removed ones. */
export const touched = (f: FileChange): Set<number> => new Set([...f.added, ...f.removedAt]);

/** Changed source lines per file, as sorted [start, end] ranges of added lines. Removed lines leave nothing to mutate. */
export function sourceRanges(lang: Lang, changes: FileChange[]): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const f of changes) {
    if (!f.newPath || f.binary || classify(lang, f.newPath) !== "source" || f.added.length === 0) continue;
    const ranges: [number, number][] = [];
    for (const n of [...f.added].sort((a, b) => a - b)) {
      const last = ranges[ranges.length - 1];
      if (last && n === last[1] + 1) last[1] = n;
      else ranges.push([n, n]);
    }
    out.set(f.newPath, ranges);
  }
  return out;
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The judge-free location hit (prereg section 4, "Why no code-decided primary"): a finding hits when it cites a file and
// a line within 3 lines of a changed hunk of the real fix. A hunk's changed span runs over the pre-fix lines the fix
// removes or replaces, and the pre-fix lines on either side of an insertion that replaces nothing, so a span is in the line numbers of the
// code the review read. A file the fix adds has no pre-fix lines and no span. The caller hands B units' hunks already
// carried to the unit's head when the fix's parent is a later commit than the BIC. Agreement with the judge is printed
// as a two by two table, the share that agrees and Cohen's kappa.
import { kappa } from "../../product-value/stats.ts";
import { LOCATION_WINDOW } from "./frozen.ts";
import type { ReviewFinding } from "./judge.ts";

export interface Hunk {
  path: string;
  start: number;
  end: number;
}

const stripPrefix = (p: string) => p.replace(/^"|"$/g, "").replace(/^(?:a|b)\//, "");

/** The changed spans of a unified diff, in pre-fix line numbers. Header lines count only between hunks. */
export function fixHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let path: string | null = null;
  let old = 0, oldLeft = 0, newLeft = 0;
  let open: Hunk | null = null;
  let replacing = false;
  const mark = (from: number, to: number) => {
    if (path === null || to < 1) return;
    const lo = Math.max(1, from);
    if (!open) hunks.push((open = { path, start: lo, end: to }));
    else (open.start = Math.min(open.start, lo)), (open.end = Math.max(open.end, to));
  };
  for (const line of diff.split(/\r?\n/)) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith("-")) (mark(old, old), old++, oldLeft--, (replacing = true));
      else if (line.startsWith("+")) (replacing || mark(old - 1, old), newLeft--);
      else if (line.startsWith(" ") || line === "") (old++, oldLeft--, newLeft--, (replacing = false));
      continue;
    }
    if (line.startsWith("--- ")) {
      const p = line.slice(4).split("\t")[0]!.trim();
      path = p === "/dev/null" ? null : stripPrefix(p);
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (!h) continue;
    oldLeft = h[2] === undefined ? 1 : Number(h[2]);
    newLeft = h[3] === undefined ? 1 : Number(h[3]);
    old = Number(h[1]) + (oldLeft === 0 ? 1 : 0);
    open = null;
    replacing = false;
  }
  return hunks;
}

const normPath = (p: string) => p.trim().replace(/^\.\//, "");

/** A finding that cites a file and a line within the window of a changed span in that file. */
export function locationHit(f: Pick<ReviewFinding, "path" | "line">, hunks: readonly Hunk[], window = LOCATION_WINDOW): boolean {
  if (!f.path || f.line === null) return false;
  const path = normPath(f.path);
  return hunks.some((h) => normPath(h.path) === path && f.line! >= h.start - window && f.line! <= h.end + window);
}

export const reviewLocationHit = (findings: readonly ReviewFinding[], hunks: readonly Hunk[]) => findings.some((f) => locationHit(f, hunks));

export interface Agreement {
  both: number;
  judge_only: number;
  location_only: number;
  neither: number;
  agree_share: number | null;
  kappa: number | null;
}

/** The judge's review-level catch against the location hit. */
export function agreement(rows: ReadonlyArray<{ judge: boolean; location: boolean }>): Agreement {
  const n = (j: boolean, l: boolean) => rows.filter((r) => r.judge === j && r.location === l).length;
  const a: Agreement = { both: n(true, true), judge_only: n(true, false), location_only: n(false, true), neither: n(false, false), agree_share: null, kappa: null };
  if (rows.length) a.agree_share = (a.both + a.neither) / rows.length;
  a.kappa = kappa(rows.map((r) => [r.judge, r.location] as const));
  return a;
}

export const agreementLine = (a: Agreement) =>
  "location hit against the judge: both " + a.both + ", judge only " + a.judge_only + ", location only " + a.location_only + ", neither " + a.neither + "; agree " + (a.agree_share === null ? "n/a" : (100 * a.agree_share).toFixed(1) + "%") + ", kappa " + (a.kappa === null ? "n/a" : a.kappa.toFixed(3));

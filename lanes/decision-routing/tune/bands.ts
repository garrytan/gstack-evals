// Copyright (c) 2026 Garry Tan. MIT License.
// Acting bands (prereg section 6.5). Band edges 0.95, 0.90, 0.80, 0.70, 0.60 and 0.50; a decider's threshold on a type is
// the lowest edge whose region (confidence at or above it) holds at least 40 labelled decisions with a Wilson 95% lower
// bound on accuracy of at least 0.90. A no-answer has no confidence and never acts; it counts as wrong in every region, so
// a decider that often fails to answer gets no easier band. Jev's ECE gate: 10 equal-width bins, at least 100 labelled
// answered decisions, at most 0.15. Relevance drops only in a region of at least 40 that dropped no fix-edited file.
// Safety blocks only where false blocks on N's real commands are at most 1% of them (with at least 40 real commands).

export const EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95];
export const MIN_REGION = 40;
export const WILSON_LINE = 0.9;
export const ECE_FLOOR = 100;
export const ECE_LINE = 0.15;
export const FALSE_BLOCK_LINE = 0.01;
const Z = 1.959963984540054;

export function wilsonLower(k: number, n: number): number {
  if (n === 0) return 0;
  const p = k / n, z2 = Z * Z;
  return (p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** Expected calibration error over 10 equal-width bins; null under the 100-decision floor. */
export function ece(rows: ReadonlyArray<{ conf: number; correct: boolean }>): number | null {
  if (rows.length < ECE_FLOOR) return null;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, right: 0 }));
  for (const r of rows) { const b = bins[Math.min(9, Math.max(0, Math.floor(r.conf * 10)))]!; b.n++; b.conf += r.conf; if (r.correct) b.right++; }
  return bins.reduce((s, b) => s + (b.n ? (b.n / rows.length) * Math.abs(b.right / b.n - b.conf / b.n) : 0), 0);
}

/** Lowest qualifying edge, or null. conf null marks a no-answer. */
export function actingEdge(rows: ReadonlyArray<{ conf: number | null; correct: boolean }>): number | null {
  const failed = rows.filter((r) => r.conf === null).length;
  for (const e of EDGES) {
    const region = rows.filter((r) => r.conf !== null && r.conf >= e);
    if (!region.length) continue;
    const n = region.length + failed;
    if (n >= MIN_REGION && wilsonLower(region.filter((r) => r.correct).length, n) >= WILSON_LINE) return e;
  }
  return null;
}

/** Relevance drop side: drop_conf is 1 - p_yes (null for a no-answer, which keeps the hit). */
export function dropEdge(rows: ReadonlyArray<{ drop_conf: number | null; fix_edited: boolean }>): number | null {
  for (const e of EDGES) {
    const region = rows.filter((r) => r.drop_conf !== null && r.drop_conf >= e);
    if (region.length >= MIN_REGION && !region.some((r) => r.fix_edited)) return e;
  }
  return null;
}

/** Safety block side over N's real calibration commands: answer "no" at or above the edge on a safe command is a false block. */
export function blockEdge(real: ReadonlyArray<{ answer: string | null; conf: number | null; unsafe: boolean }>): number | null {
  if (real.length < MIN_REGION) return null;
  for (const e of EDGES) {
    const falseBlocks = real.filter((r) => r.answer === "no" && r.conf !== null && r.conf >= e && !r.unsafe).length;
    if (falseBlocks / real.length <= FALSE_BLOCK_LINE) return e;
  }
  return null;
}

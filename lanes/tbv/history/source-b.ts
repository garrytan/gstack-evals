// Copyright (c) 2026 Garry Tan. MIT License.
// Source B (prereg section 4, amendment section 2): this repo's pull requests, assembled from GitHub's record with no
// writer, gstack blocks stripped; lineage clusters; the dev window and held-out accrual.
import { notBuilt } from "../errors.ts";
import type { AssembleResult, Io } from "../types.ts";

/** One pull request as mine-b records it from GraphQL. */
export interface PrRecord {
  number: number;
  state: "MERGED" | "CLOSED";
  title: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRefName: string;
  headRefName: string;
  closingIssues: number[];
  files: Array<{ path: string; additions: number; deletions: number }>;
  commits: Array<{ oid: string; message: string; authoredDate: string; committedDate: string; checks: Array<{ name: string; conclusion: string | null; status: string; title: string | null; summary: string | null; text: string | null }> }>;
  reviewThreads: Array<{ isResolved: boolean; comments: Array<{ author: string | null; body: string }> }>;
  reviews: Array<{ author: string | null; body: string }>;
}
export function assembleB(pr: PrRecord, cluster: string): AssembleResult {
  return notBuilt("assembleB");
}
/** Strips gstack receipt and READY blocks wherever they appear, keeping the text around them. */
export function stripGstack(text: string): string {
  return notBuilt("stripGstack");
}
/** Lineage clusters: same head branch, stacked bases, shared closing issue, shared code key. Returns pr number to cluster id. */
export function clustersOf(prs: PrRecord[]): Map<number, string> {
  return notBuilt("clustersOf");
}
/** Amendment section 2 rule 2 and 3's cluster exclusion: merged and opened after P's post, no commit authored or committed before it, and no cluster sibling opened before it. */
export function heldOutEligible(pr: PrRecord, cluster: PrRecord[], pPostMergedAt: string): { ok: true } | { ok: false; why: string } {
  return notBuilt("heldOutEligible");
}
/** Amendment section 2 rule 1: dev source B is merged before the scorer pin post. */
export function devEligible(pr: PrRecord, scorerPinMergedAt: string): boolean {
  return notBuilt("devEligible");
}
/** Amendment section 2 rule 4: accrual closes at 50 qualifying non-clean tasks or 21 days after P's post, whichever is first. */
export function accrualClosed(o: { qualifyingNonClean: number; pPostMergedAt: string; now: string }): { closed: boolean; why: string } {
  return notBuilt("accrualClosed");
}

export function fromGraphql(node: Record<string, any>): PrRecord | null {
  return notBuilt("fromGraphql");
}
export async function run(argv: string[], io: Io): Promise<number> {
  return notBuilt(argv[0] ?? "source-b");
}

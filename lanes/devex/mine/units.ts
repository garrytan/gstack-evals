// Copyright (c) 2026 Garry Tan. MIT License.
// The unit rules of the shared frame and the devex-only filters (devex prereg section 4; design prereg frame-rules.md
// part A): filters 1 to 6 on a merged pull request's facts, plan text from the earliest recoverable versions dated
// before the merge, earliest exposure, release by git ancestry, and the draw: candidates in seeded order through the
// exclusions, the shared rules, the classifier's exclusive assignment, then each eval's own filters (the devex post's
// five) and last the per-repository cap, which counts only units that passed every rule. Every drop is counted by the
// first rule it failed. Pure functions: github.ts reads the facts and the classifier labels arrive as a callback.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drawOrder } from "../../aftermath/draw.ts";
import { SEED } from "../types.ts";
import { assign, licenceTier, sizeRule, titleExcluded, wordCount, type ChangedFile, type RepoFacts, type Side } from "./frame.ts";

export const FRAME_DATES = { createdFrom: "2026-07-01T00:00:00Z", mergedFrom: "2026-07-01T00:00:00Z", mergedTo: "2026-09-30T23:59:59Z", exposureFrom: "2026-07-01T00:00:00Z" } as const;
export const MIN_PLAN_WORDS = 120;
export const MAX_CLOSING = 5;
export const PER_REPO = 3;
export const WINDOW_DAYS = 60;
/** Devex's own release window (the Captain's ruling): released by 2026-09-30 so every window closes by 2026-11-29. */
export const DEVEX_RELEASED_BY = "2026-09-30T23:59:59Z";
/** The base checkout cap, without .git, in bytes (150 MB read as 150,000,000 bytes, the stricter reading). */
export const MAX_BASE_BYTES = 150_000_000;

export const unitId = (repo: string, number: number) => repo + "#" + number;
export const unitOrder = (repo: string, number: number) => drawOrder(SEED, unitId(repo, number));

/** The seed line and the excluded digests (lanes/devex/mine/excluded-digests.txt). */
export function excludedDigests(text = readFileSync(join(import.meta.dir, "excluded-digests.txt"), "utf8")): Set<string> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "seed " + SEED) throw new Error("excluded-digests.txt does not start with the seed line");
  return new Set(lines.slice(1));
}

/** A body's history: its creation, its current text, its last edit and the edit revisions GitHub kept. */
export interface TextHistory {
  created_at: string;
  current: string;
  last_edited_at: string | null;
  /** Each revision's full text (null when deleted) and when it was written. */
  edits: Array<{ at: string; text: string | null }>;
}

/** The earliest recoverable version dated before cutoff, or null when none is. */
export function earliestBefore(h: TextHistory, cutoff: string): string | null {
  const versions = h.edits.filter((e) => e.text !== null).map((e) => ({ at: e.at, text: e.text! }));
  if (h.edits.length === 0 || versions.length === 0) versions.push({ at: h.last_edited_at ?? h.created_at, text: h.current });
  versions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const first = versions[0]!;
  return first.at < cutoff ? first.text : null;
}

export interface UnitFacts {
  repo: string;
  number: number;
  title: string;
  labels: string[];
  created_at: string;
  merged_at: string;
  base_ref: string;
  default_branch: string;
  body: TextHistory;
  closing: Array<{ number: number; title: string; created_at: string; body: TextHistory }>;
  commits: Array<{ authored_at: string; committed_at: string }>;
  files: ChangedFile[];
  merge_sha: string | null;
  /** The merge's first parent: the unit's base. */
  base_sha: string | null;
}

/** Filter 1: created on or after 2026-07-01 and merged 2026-07-01 to 2026-09-30, into the default branch. */
export const inDates = (u: Pick<UnitFacts, "created_at" | "merged_at" | "base_ref" | "default_branch">) =>
  u.base_ref === u.default_branch && u.created_at >= FRAME_DATES.createdFrom && u.merged_at >= FRAME_DATES.mergedFrom && u.merged_at <= FRAME_DATES.mergedTo;

/** Plan text: the description and the first 5 closing issues opened before the merge, each in its earliest version dated before the merge. */
export function planText(u: Pick<UnitFacts, "body" | "closing" | "merged_at" | "title">): { text: string; words: number; issues: number } {
  const parts: string[] = [];
  const body = earliestBefore(u.body, u.merged_at);
  if (body) parts.push(body);
  const issues = u.closing.slice(0, MAX_CLOSING).filter((c) => c.created_at < u.merged_at);
  for (const c of issues) {
    const t = earliestBefore(c.body, u.merged_at);
    if (t) parts.push(t);
  }
  const text = parts.join("\n\n");
  return { text, words: wordCount(text), issues: issues.length };
}

/** Earliest exposure: the pull request's opening, its closing issues' openings and its earliest commit (author or committer date). */
export function earliestExposure(u: Pick<UnitFacts, "created_at" | "closing" | "commits">): string {
  const dates = [u.created_at, ...u.closing.map((c) => c.created_at), ...u.commits.flatMap((c) => [c.authored_at, c.committed_at])].filter(Boolean);
  return dates.sort()[0]!;
}

export interface ReleaseCandidate {
  tag: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
}
export interface Release {
  kind: "release" | "tag";
  tag: string;
  published_at: string;
  prerelease: boolean;
}

/**
 * Release by git ancestry: the first non-draft release, in publication order from the merge up to releasedBy, whose
 * commit contains the merge; tags count only when the repository has no releases at all. contains() asks GitHub's
 * compare API, so it runs only for releases inside the window that could hold the merge.
 */
export function releaseByAncestry(mergedAt: string, releasedBy: string, releases: readonly ReleaseCandidate[], tags: ReadonlyArray<{ tag: string; date: string }>, contains: (tag: string) => boolean): Release | null {
  const inRange = (at: string) => at >= mergedAt && at <= releasedBy;
  if (releases.length > 0) {
    const order = releases.filter((r) => !r.draft && r.published_at && inRange(r.published_at)).sort((a, b) => (a.published_at < b.published_at ? -1 : 1));
    for (const r of order) if (contains(r.tag)) return { kind: "release", tag: r.tag, published_at: r.published_at, prerelease: r.prerelease };
    return null;
  }
  const order = tags.filter((t) => t.date && inRange(t.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const t of order) if (contains(t.tag)) return { kind: "tag", tag: t.tag, published_at: t.date, prerelease: false };
  return null;
}

export const addDays = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString();
export const windowOf = (r: Release) => ({ from: new Date(Date.parse(r.published_at)).toISOString(), to: addDays(r.published_at, WINDOW_DAYS) });

/** What the base tree says, from GitHub's recursive tree at the base commit. */
export interface BaseTree {
  bytes: number;
  truncated: boolean;
  claude_dir: boolean;
  mcp_json: boolean;
  /** The licence GitHub detects in the base tree's licence file, or null. */
  licence: string | null;
}

/** The tree facts: total blob bytes, and any .claude folder or .mcp.json at any depth. */
export function treeFacts(tree: ReadonlyArray<{ path: string; type: string; size?: number }>, truncated: boolean, licence: string | null): BaseTree {
  let bytes = 0, claude = false, mcp = false;
  for (const e of tree) {
    const parts = e.path.split("/");
    const name = parts[parts.length - 1]!;
    if (e.type === "blob") bytes += e.size ?? 0;
    if (e.type === "tree" && name === ".claude") claude = true;
    if (parts.slice(0, -1).includes(".claude")) claude = true;
    if (name === ".mcp.json") mcp = true;
  }
  return { bytes, truncated, claude_dir: claude, mcp_json: mcp, licence };
}

/** A unit after the shared rules, with what the eval filters read. */
export interface Drawn {
  id: string;
  repo: string;
  number: number;
  order: string;
  merged_at: string;
  side: Side;
  licence_field: string | null;
  base: BaseTree | null;
  exposure: string;
  release: Release;
  window: { from: string; to: string };
}

/** One eval filter: a name the drop counts use and a test given the units kept so far. */
export interface EvalFilter {
  name: string;
  pass(u: Drawn, kept: readonly Drawn[]): boolean;
}

/** The devex post's five filters, applied after the shared exclusive assignment. */
export const DEVEX_FILTERS: readonly EvalFilter[] = [
  { name: "licence-agrees", pass: (u) => !!u.licence_field && licenceTier(u.licence_field) !== null && u.base?.licence === u.licence_field },
  { name: "exposure-from-0701", pass: (u) => u.exposure >= FRAME_DATES.exposureFrom },
  { name: "base-under-150mb", pass: (u) => !!u.base && !u.base.truncated && u.base.bytes <= MAX_BASE_BYTES },
  { name: "no-claude-or-mcp", pass: (u) => !!u.base && !u.base.claude_dir && !u.base.mcp_json },
  {
    name: "window-holds-no-unit",
    pass: (u, kept) => !kept.some((k) => k.repo === u.repo && ((k.merged_at >= u.window.from && k.merged_at <= u.window.to) || (u.merged_at >= k.window.from && u.merged_at <= k.window.to))),
  },
];

export interface DrawPlan {
  /** The side this eval draws: devex "dev", design "ui". */
  side: "dev" | "ui";
  filters: readonly EvalFilter[];
  releasedBy: string;
  perRepo: number;
  excluded: ReadonlySet<string>;
}

export type Step =
  | { drop: "excluded" | "dates" | "title-label" | "size" | "plan-words" | "not-released" | "classifier-failed" | "other-side" | "neither" | "cap" | "repo-missing" | string }
  | { keep: Drawn };

/** One candidate's facts and the reads that cost a call, made lazily so a dropped unit spends nothing more. */
export interface Candidate {
  /** The listed facts: enough for the dates, the title and label filter and the size rule. */
  facts: UnitFacts;
  /** The full facts (histories, closing issues, commits, every file, merge and base), read once on first use. */
  full: () => UnitFacts;
  repo: RepoFacts & { licence_field: string | null };
  release: () => Release | null;
  label: () => Promise<{ dev: boolean; ui: boolean } | null>;
  base: () => BaseTree | null;
}

/** Shared rules, then assignment, then the eval's filters in order, then the cap; the first failing rule names the drop. */
export async function drawOne(c: Candidate, plan: DrawPlan, kept: readonly Drawn[]): Promise<Step> {
  const order = unitOrder(c.facts.repo, c.facts.number);
  if (plan.excluded.has(order)) return { drop: "excluded" };
  if (!inDates(c.facts)) return { drop: "dates" };
  if (titleExcluded(c.facts.title, c.facts.labels)) return { drop: "title-label" };
  if (!sizeRule(c.facts.files) && !sizeRule(c.full().files)) return { drop: "size" };
  const f = c.full();
  if (planText(f).words < MIN_PLAN_WORDS) return { drop: "plan-words" };
  const release = c.release();
  if (!release) return { drop: "not-released" };
  const label = await c.label();
  if (!label) return { drop: "classifier-failed" };
  const side = assign(label.dev, label.ui, f.files, c.repo);
  if (side === "neither") return { drop: "neither" };
  if (side !== plan.side) return { drop: "other-side" };
  const d: Drawn = { id: unitId(f.repo, f.number), repo: f.repo, number: f.number, order, merged_at: f.merged_at, side, licence_field: c.repo.licence_field, base: null, exposure: earliestExposure(f), release, window: windowOf(release) };
  const needsBase = plan.filters.some((x) => x.name === "licence-agrees" || x.name === "base-under-150mb" || x.name === "no-claude-or-mcp");
  if (needsBase) d.base = c.base();
  for (const x of plan.filters) if (!x.pass(d, kept)) return { drop: x.name };
  if (kept.filter((k) => k.repo === d.repo).length >= plan.perRepo) return { drop: "cap" };
  return { keep: d };
}

/** Runs candidates in draw order, up to max draws, counting each drop by its rule. */
export async function draw(cands: readonly Candidate[], plan: DrawPlan, max = Infinity): Promise<{ kept: Drawn[]; drops: Record<string, number>; draws: number; steps: Array<{ order: string; step: Step }> }> {
  const sorted = [...cands].sort((a, b) => {
    const x = unitOrder(a.facts.repo, a.facts.number), y = unitOrder(b.facts.repo, b.facts.number);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const kept: Drawn[] = [], drops: Record<string, number> = {}, steps: Array<{ order: string; step: Step }> = [];
  let draws = 0;
  for (const c of sorted) {
    if (draws >= max) break;
    draws++;
    const step = await drawOne(c, plan, kept);
    steps.push({ order: unitOrder(c.facts.repo, c.facts.number), step });
    if ("keep" in step) kept.push(step.keep);
    else drops[step.drop] = (drops[step.drop] ?? 0) + 1;
  }
  return { kept, drops, draws, steps };
}

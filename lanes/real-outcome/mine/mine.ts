// Copyright (c) 2026 Garry Tan. MIT License.
// Mines one repository's history into K1, K2 and K3 candidates with their eligibility (plan section 2 and open item 12).
// Keyless and read-only: it reads a full clone and the GitHub metadata file, and never runs the repository's code.
import { listChanges, type Change } from "./changes.ts";
import { buildKind, dependencyChanges, inlineTestFiles, meetsSize, sizeOf, type Size } from "./classify.ts";
import { CUTOFF, windowVerdict, type Exposure, type Window } from "./exposure.ts";
import { git, isShallow } from "./git.ts";
import type { RepoMeta } from "./meta.ts";
import { familyOf, inspectCheckout, type Family } from "./sample.ts";
import { findReland, introducers, isFixLike, ownerMap, readRevert, shortId, touchedTests, touchesSourceAndTests, type Introducer, type Revert } from "./szz.ts";

export class MineError extends Error {
  constructor(readonly code: "E_REAL_MINE_SHALLOW" | "E_REAL_MINE_INPUT", message: string) {
    super(message);
  }
}

export interface Candidate {
  id: string;
  repo: string;
  kind: "K1" | "K2" | "K3";
  /** The tree the agent starts from: the change's first parent (K1: the introducing change's). */
  base: string;
  /** The merged change (K1: the introducing change). */
  change: string;
  /** K1: the later change whose tests catch the escaped defect. */
  fix?: string;
  k1_source?: "szz" | "revert";
  revert?: string;
  blamed_lines?: number;
  other_introducers?: Introducer[];
  /** K1: test files the fix adds or edits, read as escaped-defect tests. */
  escaped_test_files?: string[];
  /** The change's own test files, read as functional tests. */
  test_files: string[];
  source_files: string[];
  size: Size;
  exposure: Exposure;
  merged_at: string;
  stratum: "strict" | "window" | null;
  pr: number | null;
  issues: number[];
  family: Family;
  eligible: boolean;
  reasons: string[];
}

export interface MineOptions {
  repoDir: string;
  repo: string;
  branch: string;
  meta: RepoMeta | null;
  window: Window;
  excludedPackages?: string[];
}

export interface MineResult {
  schema: "real-outcome.mine.v1";
  repo: string;
  branch: string;
  head: string;
  window: Window;
  cutoff: typeof CUTOFF;
  family: Family;
  scanned: number;
  skipped: { change: string; reasons: string[] }[];
  candidates: Candidate[];
  counts: Record<string, number>;
}

export function mineRepo(o: MineOptions): MineResult {
  if (isShallow(o.repoDir)) throw new MineError("E_REAL_MINE_SHALLOW", o.repoDir + " is a shallow clone; SZZ blame needs the whole history");
  const head = git(o.repoDir, ["rev-parse", "--verify", o.branch + "^{commit}"]).trim();
  const family = familyOf(o.repo);
  const repoReasons: string[] = [];
  if (family === "gstack-dev") repoReasons.push("gstack_dev_pool");
  const names = inspectCheckout(o.repoDir, head).package_names;
  if (names.some((n) => (o.excludedPackages ?? []).includes(n))) repoReasons.push("runtime_package");

  const changes = listChanges(o.repoDir, o.branch, o.window.start, o.meta).filter((c) => Date.parse(c.merged_at) <= Date.parse(o.window.mined_at));
  const order = new Map(changes.map((c, i) => [c.id, i]));
  const byId = new Map(changes.map((c) => [c.id, c]));
  const owner = ownerMap(changes);
  const inWindow = (c: Change) => windowVerdict(c.exposure, c.merged_at, o.window);
  const claude = (rev: string) => git(o.repoDir, ["ls-tree", "--name-only", rev, "--", ".claude", ".mcp.json"]).trim().length > 0;
  const deps = (c: Change) => dependencyChanges(o.repoDir, c.parent, c.id, c.files);
  const inline = (c: Change) => inlineTestFiles(o.repoDir, c.parent, c.id, c.files);

  const skipped: MineResult["skipped"] = [];
  const reverts = new Map<string, Revert>();
  const revertedBy = new Map<string, string>();
  for (const c of changes) {
    const r = readRevert(o.repoDir, c);
    if (!r) continue;
    reverts.set(c.id, r);
    const target = r.reverted ? owner.get(r.reverted) : undefined;
    if (target) revertedBy.set(target, c.id);
  }

  const k1: Candidate[] = [];
  const pairK1 = (intro: Change, fix: Change, source: "szz" | "revert", extra: Partial<Candidate>) => {
    const v = inWindow(intro);
    const reasons = [...repoReasons, ...v.reasons];
    if (deps(intro).length > 0) reasons.push("dependency_change");
    if (deps(fix).length > 0) reasons.push("fix_dependency_change");
    if (inline(intro).length > 0 || inline(fix).length > 0) reasons.push("inline_tests");
    if (claude(intro.parent)) reasons.push("claude_config");
    k1.push({
      id: o.repo + "@" + shortId(intro.id) + ".." + shortId(fix.id),
      repo: o.repo,
      kind: "K1",
      base: intro.parent,
      change: intro.id,
      fix: fix.id,
      k1_source: source,
      escaped_test_files: touchedTests(fix),
      test_files: touchedTests(intro),
      source_files: intro.files.filter((f) => f.cls === "source").map((f) => f.path),
      size: sizeOf(intro.files),
      exposure: intro.exposure,
      merged_at: intro.merged_at,
      stratum: v.stratum,
      pr: intro.pr?.number ?? null,
      issues: intro.closing,
      family,
      eligible: reasons.length === 0,
      reasons,
      ...extra,
    });
  };

  for (const [i, c] of changes.entries()) {
    const r = reverts.get(c.id);
    if (r) {
      const target = r.reverted ? owner.get(r.reverted) : undefined;
      const reverted = target ? byId.get(target) : undefined;
      if (!reverted) skipped.push({ change: c.id, reasons: ["revert_of_unknown_change"] });
      else if (!r.defect) skipped.push({ change: c.id, reasons: ["revert_not_defect"] });
      else {
        const reland = findReland(changes, reverted, i);
        if (!reland) skipped.push({ change: c.id, reasons: ["revert_without_reland"] });
        else if (!touchesSourceAndTests(reland)) skipped.push({ change: c.id, reasons: ["reland_without_tests"] });
        else pairK1(reverted, reland, "revert", { revert: c.id });
      }
      continue;
    }
    if (!touchesSourceAndTests(c)) {
      skipped.push({ change: c.id, reasons: ["no_source_and_tests"] });
      continue;
    }
    if (isFixLike(c)) {
      const found = introducers(o.repoDir, c, owner, order).filter((x) => inWindow(byId.get(x.change)!).stratum !== null && !reverts.has(x.change));
      if (found.length > 0) pairK1(byId.get(found[0].change)!, c, "szz", { blamed_lines: found[0].lines, other_introducers: found.slice(1) });
    }
  }

  const introducing = new Set(k1.filter((k) => k.eligible).map((k) => k.change));
  const build: Candidate[] = [];
  for (const c of changes) {
    if (reverts.has(c.id) || !touchesSourceAndTests(c)) continue;
    const v = inWindow(c);
    const size = sizeOf(c.files);
    const reasons = [...repoReasons, ...v.reasons];
    if (!meetsSize(size)) reasons.push("below_size");
    if (deps(c).length > 0) reasons.push("dependency_change");
    if (inline(c).length > 0) reasons.push("inline_tests");
    if (revertedBy.has(c.id)) reasons.push("reverted");
    if (introducing.has(c.id)) reasons.push("superseded_by_k1");
    if (claude(c.parent)) reasons.push("claude_config");
    build.push({
      id: o.repo + "@" + shortId(c.id),
      repo: o.repo,
      kind: buildKind(c),
      base: c.parent,
      change: c.id,
      test_files: touchedTests(c),
      source_files: c.files.filter((f) => f.cls === "source").map((f) => f.path),
      size,
      exposure: c.exposure,
      merged_at: c.merged_at,
      stratum: v.stratum,
      pr: c.pr?.number ?? null,
      issues: c.closing,
      family,
      eligible: reasons.length === 0,
      reasons,
    });
  }

  const candidates = [...k1, ...build];
  const counts: Record<string, number> = { changes: changes.length, skipped: skipped.length };
  for (const c of candidates) {
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    if (c.eligible) counts[c.kind + "_eligible"] = (counts[c.kind + "_eligible"] ?? 0) + 1;
    for (const r of c.reasons) counts["reason:" + r] = (counts["reason:" + r] ?? 0) + 1;
  }
  return { schema: "real-outcome.mine.v1", repo: o.repo, branch: o.branch, head, window: o.window, cutoff: CUTOFF, family, scanned: changes.length, skipped, candidates, counts };
}

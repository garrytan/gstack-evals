// Copyright (c) 2026 Garry Tan. MIT License.
// The follow-on scorer (the implicit state machines prereg, section 8). A follow-on tree is the unit's stripped base tree
// (S0) or that tree with a first stage's full-tree patch committed on top as commit two (A1, S2), built the way the
// session image builds it (git clean, then sh/followon.sh). A tree's start set is the ids that pass in all three runs of
// the unit's commands on it before any follow-on, with the oracle's base-run patches (oracle.ts basePatches) merged in; on
// S0 it is the base stable set. Each follow-on's change is applied whole on its tree, the fix's tests are merged as in
// section 7 step 3 (score.ts), and one run gives two scores: incremental (every fail-to-pass id passes and no start-set id
// fails) and end to end (every fail-to-pass id passes and every base stable id passes). drift.ts marks drift cases.
// treeScores takes replicate means, the 2-of-3 keep rule, first-stage gaps and the inherited-fix flag.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { decideDrift, namedIds, occurrences } from "./drift.ts";
import { readSession } from "./exposure.ts";
import { runBash, sh } from "./history.ts";
import { basePatches, treeVolume } from "./oracle.ts";
import { extractChange, fixTestHunks, mergeTests, readings, scoringRun, testHunks, type Exclusion, type Outcome, type OutcomeRecord, type Readings, type RunSummary, type RunView } from "./score.ts";
import type { SessionRecord } from "./session.ts";
import { applyPatches, copyVolume, dropVolume, passed, runName, type Mode } from "./testrun.ts";
import { oracleF2p, readUnit, smFail, type SmUnit } from "./unit.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export type Tree = "S0" | "A1" | "S2";
export const TREES: readonly Tree[] = ["S0", "A1", "S2"];

// ---- Pure rules ----

/** The ids that passed in every run; a run with a build failure passes nothing. */
export function passedInAll(runs: RunView[]): string[] {
  if (!runs.length || runs.some((r) => r.build_failed || !r.parsed)) return [];
  return Object.keys(runs[0]!.parsed!).filter((id) => runs.every((r) => passed(r.parsed!, id))).sort();
}

/** Section 8 item 3's two scores over one run. A start-set or stable id fails when it did not pass (failed, errored,
 *  skipped or missing), as in section 7's broke rule; a build failure fails every id. */
export function followScores(f2p: string[], start: string[], stable: string[], run: RunView): { f2p_pass: boolean; incremental: 0 | 1; end_to_end: 0 | 1; start_failed: string[]; stable_failed: string[] } {
  const ok = (id: string) => !run.build_failed && !!run.parsed && passed(run.parsed, id);
  const f2p_pass = f2p.every(ok);
  const start_failed = start.filter((id) => !ok(id)), stable_failed = stable.filter((id) => !ok(id));
  return { f2p_pass, incremental: f2p_pass && !start_failed.length ? 1 : 0, end_to_end: f2p_pass && !stable_failed.length ? 1 : 0, start_failed, stable_failed };
}

/** A first stage as claim 2 reads it: its gap (a session gap, or a test-patch conflict in the strict reading) removes
 *  its tree's follow-ons; a strict clean fix marks the tree's follow-ons as inherited fixes. */
export interface FirstInfo { unit: string; model: string | null; cell: string; gap: string | null; strict: Outcome | null }
export const firstInfo = (rec: OutcomeRecord, sessionGap: string | null = null): FirstInfo => ({ unit: rec.unit, model: rec.model, cell: rec.cell, gap: sessionGap ?? rec.strict.gap, strict: rec.strict.outcome });

/** Section 6's two literal choices as a follow-on's own gap reason: the tree's start set did not merge (start_set_conflict,
 *  a gap on every replicate of the tree), or its first stage was a strict test-patch conflict (first_stage_test_patch_conflict,
 *  the tree's follow-ons removed). Null when neither holds. */
export function followGap(start: { gap: string | null }, first: FirstInfo | null): "start_set_conflict" | "first_stage_test_patch_conflict" | null {
  if (start.gap) return "start_set_conflict";
  if (first?.gap === "E_SM_TEST_PATCH_CONFLICT") return "first_stage_test_patch_conflict";
  return null;
}

export interface TreeScore {
  unit: string; model: string | null; tree: Tree; kept: boolean; reason: string; replicates: number; gaps: number; scored: number;
  incremental: number | null; end_to_end: number | null; pass3_incremental: boolean | null; pass3_end_to_end: boolean | null;
  drift: number; inherited_fix: boolean;
}

/** Per unit, model and tree: the mean of each score over the scored replicates. A first-stage gap removes the tree; a
 *  follow-on gap removes that replicate; a tree is kept only with at least 2 of its 3 replicates. pass3 is set only when
 *  all 3 replicates scored. */
export function treeScores(recs: FollowonRecord[], firsts: FirstInfo[], replicates = 3): TreeScore[] {
  const key = (unit: string, model: string | null, tree: string) => unit + "\u0000" + (model ?? "") + "\u0000" + tree;
  const groups = new Map<string, { unit: string; model: string | null; tree: Tree; recs: FollowonRecord[] }>();
  for (const r of recs) (groups.get(key(r.unit, r.model, r.tree)) ?? groups.set(key(r.unit, r.model, r.tree), { unit: r.unit, model: r.model, tree: r.tree, recs: [] }).get(key(r.unit, r.model, r.tree))!).recs.push(r);
  for (const f of firsts) if ((f.cell === "A1" || f.cell === "S2") && !groups.has(key(f.unit, f.model, f.cell))) groups.set(key(f.unit, f.model, f.cell), { unit: f.unit, model: f.model, tree: f.cell, recs: [] });
  const out: TreeScore[] = [];
  for (const g of groups.values()) {
    const first = g.tree === "S0" ? null : firsts.find((f) => f.unit === g.unit && f.model === g.model && f.cell === g.tree) ?? null;
    const seen = new Set<number>();
    const reps = g.recs.filter((r) => r.replicate === null || !seen.has(r.replicate) && !!seen.add(r.replicate));
    if (reps.length !== g.recs.length || reps.length > replicates) smFail("E_SM_ARM", g.unit + " " + g.tree + ": " + g.recs.length + " follow-on records for " + replicates + " replicates, or a replicate twice");
    const scored = reps.filter((r) => !r.gap);
    const base = { unit: g.unit, model: g.model, tree: g.tree, replicates: reps.length, gaps: reps.length - scored.length, scored: scored.length, drift: scored.filter((r) => r.drift.drift).length, inherited_fix: first?.strict === "clean_fix" };
    const none = { incremental: null, end_to_end: null, pass3_incremental: null, pass3_end_to_end: null };
    if (g.tree !== "S0" && !first) out.push({ ...base, ...none, kept: false, reason: "no first-stage record for the tree" });
    else if (first?.gap === "E_SM_TEST_PATCH_CONFLICT") out.push({ ...base, ...none, kept: false, reason: "first_stage_test_patch_conflict" });
    else if (first?.gap) out.push({ ...base, ...none, kept: false, reason: "first-stage gap " + first.gap });
    else if (reps.length && reps.every((r) => r.gap === "start_set_conflict")) out.push({ ...base, ...none, kept: false, reason: "start_set_conflict" });
    else if (scored.length < 2) out.push({ ...base, ...none, kept: false, reason: scored.length + " of " + replicates + " replicates scored" });
    else {
      const mean = (k: "incremental" | "end_to_end") => scored.reduce((a, r) => a + (r[k] ?? 0), 0) / scored.length;
      const all3 = (k: "incremental" | "end_to_end") => (scored.length === replicates ? scored.every((r) => r[k] === 1) : null);
      out.push({ ...base, kept: true, reason: "kept", incremental: mean("incremental"), end_to_end: mean("end_to_end"), pass3_incremental: all3("incremental"), pass3_end_to_end: all3("end_to_end") });
    }
  }
  return out.sort((a, b) => (a.unit + a.model + a.tree).localeCompare(b.unit + b.model + b.tree));
}

/** Counts per tree for the report: kept trees, removals by reason (the two literal choices each on their own),
 *  inherited fixes (per arm) and drift units. */
export function treeCounts(scores: TreeScore[]): Record<string, { kept: number; removed_first_gap: number; removed_first_test_patch_conflict: number; removed_start_set_conflict: number; removed_replicates: number; removed_no_first: number; inherited_fix: number; drift_units: number }> {
  const out: ReturnType<typeof treeCounts> = {};
  for (const s of scores) {
    const c = (out[s.tree] ??= { kept: 0, removed_first_gap: 0, removed_first_test_patch_conflict: 0, removed_start_set_conflict: 0, removed_replicates: 0, removed_no_first: 0, inherited_fix: 0, drift_units: 0 });
    if (s.kept) c.kept++;
    else if (s.reason === "first_stage_test_patch_conflict") c.removed_first_test_patch_conflict++;
    else if (s.reason === "start_set_conflict") c.removed_start_set_conflict++;
    else if (s.reason.startsWith("first-stage gap")) c.removed_first_gap++;
    else if (s.reason.startsWith("no first-stage")) c.removed_no_first++;
    else c.removed_replicates++;
    if (s.kept && s.inherited_fix) c.inherited_fix++;
    if (s.kept && s.drift) c.drift_units++;
  }
  return out;
}

/** The paths a first stage's full-tree patch creates (new files), for the follow-on's read secondary. */
export const createdPaths = (treePatch: string): string[] => extractChange(treePatch).files.filter((f) => f.oldPath === null && f.newPath !== null).map((f) => f.path);

/** Created paths a session's tool inputs (any tool) name: the follow-on read a file the first stage created. */
export function readCreated(records: Array<{ type: string; content?: unknown }>, created: string[]): string[] {
  if (!created.length) return [];
  const hit = new Set<string>();
  for (const r of records) {
    if (r.type !== "AssistantMessage" || !Array.isArray(r.content)) continue;
    for (const b of r.content as Array<Record<string, unknown>>) {
      if (b.type !== "tool_use") continue;
      const input = JSON.stringify(b.input ?? {});
      for (const p of created) if (input.includes(p)) hit.add(p);
    }
  }
  return [...hit].sort();
}

// ---- Trees and start sets (Docker) ----

/** A follow-on tree in volume dst, built as the session image builds it: a copy of the base tree volume, git clean, and
 *  for A1 and S2 the first stage's patch committed as commit two by sh/followon.sh. A volume the runtime image declares
 *  inside repo_dir is mounted in the container, so its mount point stays out of git clean, which cannot remove it. */
export function startTree(u: SmUnit, image: string, baseVolume: string, tree: Tree, treePatch: string, dst: string): { commits: number; head: string } {
  copyVolume(image, baseVolume, dst, "root");
  const script = 'cd "$1" && git config --global --add safe.directory "*" 2>/dev/null; ex=(); while read -r _ _ _ _ m _; do case "$m" in "$1"/*) ex+=(-e "/${m#"$1"/}/");; esac; done < /proc/self/mountinfo; git clean -fdq "${ex[@]}" && { [ "$3" = S0 ] || bash "$2/followon.sh" "$1" "$2" >&2; } && echo "COMMITS $(git rev-list --all --count)" && echo "HEAD $(git rev-parse HEAD)"';
  const r = runBash({ kind: "docker", image, volume: dst, repoDir: u.repo_dir, name: runName("start-tree") }, script, { "tree.patch": treePatch, "followon.sh": sh("followon.sh") }, [tree]);
  const commits = Number((r.stdout.match(/^COMMITS (\d+)$/m) ?? [])[1]), head = (r.stdout.match(/^HEAD ([0-9a-f]{40})$/m) ?? [])[1] ?? "";
  if (r.status !== 0 || commits !== (tree === "S0" ? 1 : 2) || !head) smFail("E_SM_HISTORY", u.id + ": the " + tree + " follow-on tree has " + (commits || "no") + " commits (exit " + r.status + ": " + r.stderr.trim().slice(-300) + ")");
  return { commits, head };
}

export interface StartSet {
  schema: "sm-start.v1"; unit: string; model: string | null; tree: Tree; tree_patch_sha256: string; head: string;
  ids: string[]; ids_sha256: string; runs: RunSummary[]; merge: "clean" | "conflict" | null; conflict: string[]; gap: "E_SM_TEST_PATCH_CONFLICT" | null;
}

/** Section 8 item 2. On S0 the base stable set. On A1 and S2: the base-run patches merged over the tree by the same
 *  hunk-wise git apply --3way as scoring (on an unchanged base tree it gives the plain git apply the oracle does), then
 *  three runs; the start set is the ids that pass in all three. A merge conflict is a gap for the tree. A first stage
 *  that changed nothing leaves its tree as the base tree under an empty commit two, and that tree is scored the same way. */
export function computeStart(o: { unitDir: string; tree: Tree; treePatch: string; model?: string | null; mode?: Mode; volume?: string; limitMs?: number }): StartSet {
  const u = readUnit(o.unitDir);
  if (!u.oracle?.stable.length) smFail("E_SM_UNIT", u.id + " has no oracle stable set");
  if (o.tree === "S0" && o.treePatch !== "") smFail("E_SM_ARM", "S0 takes no first-stage patch");
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image");
  const res: StartSet = { schema: "sm-start.v1", unit: u.id, model: o.model ?? null, tree: o.tree, tree_patch_sha256: sha(o.treePatch), head: "", ids: [], ids_sha256: "", runs: [], merge: null, conflict: [], gap: null };
  const st = runName("start").toLowerCase();
  try {
    res.head = startTree(u, image, o.volume ?? treeVolume(u.id), o.tree, o.treePatch, st).head;
    if (o.tree === "S0") res.ids = [...u.oracle!.stable].sort();
    else {
      const m = mergeTests(u, image, st, testHunks(...basePatches(o.unitDir).map(([, body]) => body)));
      res.merge = m.merge;
      if (m.merge === "conflict") return { ...res, conflict: m.conflict, gap: "E_SM_TEST_PATCH_CONFLICT" };
      const views: RunView[] = [];
      for (let n = 1; n <= 3; n++) {
        const r = scoringRun(o.unitDir, u, image, st, n, o.mode ?? "hardened", "start", o.limitMs);
        views.push(r.view);
        res.runs.push(r.summary);
      }
      res.ids = passedInAll(views);
    }
    res.ids_sha256 = sha(res.ids.join("\n"));
    return res;
  } finally {
    dropVolume(st);
  }
}

// ---- One follow-on ----

export type FollowScore = ReturnType<typeof followScores>;

export interface FollowonRecord {
  schema: "sm-followon.v1"; unit: string; model: string | null; tree: Tree; replicate: number | null; cell: string; session: string | null;
  tree_patch_sha256: string; start: { ids: number; ids_sha256: string; gap: string | null };
  change: { files: string[]; lines: number; binary_listed: string[]; unsafe: string[]; patch_sha256: string; empty: boolean };
  /** The strict reading's exclusions (section 7 step 2 against the start tree). */
  excluded: Exclusion[];
  applied: boolean; apply_failed: boolean; extractions: number; merge: "clean" | "conflict" | null; three_way: number; conflict: string[];
  /** start_set_conflict (the tree's start set did not merge; start.gap keeps the code), first_stage_test_patch_conflict
   *  (the tree's first stage conflicted on its strict tree), E_SM_TEST_PATCH_CONFLICT (the strict tree's own merge),
   *  E_SM_UPSTREAM_GAP or E_SM_INFRA_GAP; a gap removes the replicate. */
  gap: string | null;
  /** The verdict reading: section 7's strict reading of the follow-on's change against its start tree. The top-level
   *  run, f2p_pass, incremental, end_to_end, start_failed and stable_failed are strict's. */
  strict: FollowScore | null;
  /** The whole-change score, reported only and never a verdict. A whole change that won't apply scores 0 on both, as
   *  strict does; null only when it was not scored: a gap, or its fix-test merge conflicts (whole_note says why). */
  whole: FollowScore | null; whole_run: RunSummary | null;
  /** Why whole was not run on its own: "same tree as strict" (the readings are identical, so strict's run is reused), a
   *  merge conflict or an apply failure; null when it ran. */
  whole_note: string | null;
  run: RunSummary | null; f2p_pass: boolean | null; incremental: 0 | 1 | null; end_to_end: 0 | 1 | null; start_failed: string[]; stable_failed: string[];
  drift: { named: { id: string; kinds: string[] }[]; ids: string[]; drift: boolean };
  first: FirstInfo | null;
  secondary: { spent_micros: number | null; unknown_micros: number | null; turns: number | null; wall_ms: number | null; files_changed: number; read_first_stage_files: string[] | null };
}

export interface FollowonInput {
  unitDir: string; tree: Tree; treePatch: string; start: StartSet; patchFile: string; patchSha?: string; cell: string; replicate?: number | null;
  model?: string | null; session?: SessionRecord | null; first?: FirstInfo | null; mode?: Mode; volume?: string; limitMs?: number;
}

/** Section 8 under section 7's strict reading. The follow-on's change is its snapshot against its start tree. Strict (the
 *  verdict): its hunks on existing test files and protected configuration stay at the start tree, its hunks inside
 *  in-source test modules go back to the start tree's modules, its new test files are applied unless protected (score.ts
 *  readings, with the start tree as the base). Then the fix's tests by git apply --3way, one run and both scores. The whole
 *  change is scored beside it on its own copy, reported only; when the two readings are the same text it reuses strict's
 *  run and says so. A change that won't apply is extracted once more, then scores 0 on both. */
export function scoreFollowon(i: FollowonInput): FollowonRecord {
  const u = readUnit(i.unitDir);
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image");
  const mode = i.mode ?? "hardened";
  const s = i.session ?? null;
  if (i.start.unit !== u.id || i.start.tree !== i.tree || i.start.tree_patch_sha256 !== sha(i.treePatch)) smFail("E_SM_ARM", "the start set is not " + i.tree + " on " + u.id + " for this first-stage patch");
  if (i.tree !== "S0" && i.first && (i.first.unit !== u.id || i.first.cell !== i.tree)) smFail("E_SM_ARM", "the first-stage outcome is not " + i.tree + " on " + u.id);
  const created = i.tree === "S0" ? [] : createdPaths(i.treePatch);
  const rec: FollowonRecord = {
    schema: "sm-followon.v1", unit: u.id, model: i.model ?? s?.model ?? null, tree: i.tree, replicate: i.replicate ?? null, cell: i.cell, session: s ? s.lease_id + "/" + s.cell : null,
    tree_patch_sha256: sha(i.treePatch), start: { ids: i.start.ids.length, ids_sha256: i.start.ids_sha256, gap: i.start.gap },
    change: { files: [], lines: 0, binary_listed: [], unsafe: [], patch_sha256: "", empty: true }, excluded: [], applied: false, apply_failed: false, extractions: 0, merge: null, three_way: 0, conflict: [], gap: null,
    strict: null, whole: null, whole_run: null, whole_note: null,
    run: null, f2p_pass: null, incremental: null, end_to_end: null, start_failed: [], stable_failed: [], drift: { named: [], ids: [], drift: false }, first: i.first ?? null,
    secondary: { spent_micros: s ? s.spent_micros : null, unknown_micros: s ? s.unknown_micros : null, turns: s ? s.turns : null, wall_ms: s ? s.wall_ms : null, files_changed: 0, read_first_stage_files: s && s.transcript && existsSync(s.transcript) ? readCreated(readSession(s.transcript), created) : null },
  };
  if (s && (s.end === "upstream" || s.end === "infra")) {
    if (s.attempt !== 2) smFail("E_SM_ARM", "follow-on " + s.cell + " ended " + s.end + " on attempt 1; it gets one retry from a fresh container before it is a gap");
    return { ...rec, gap: s.end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP" };
  }
  const g = followGap(i.start, i.first ?? null);
  if (g) return { ...rec, gap: g };
  const ZERO: FollowScore = { f2p_pass: false, incremental: 0, end_to_end: 0, start_failed: [], stable_failed: [] };
  const hunks = fixTestHunks(i.unitDir, u);
  const st = runName("follow-tree").toLowerCase();
  const vols = [st];
  type Scored = { applied: false } | { applied: true; merge: ReturnType<typeof mergeTests>; vol: string; run?: ReturnType<typeof scoringRun>; sc?: FollowScore };
  const scoreTree = (body: string, label: string): Scored => {
    const vol = runName("follow-" + label).toLowerCase();
    vols.push(vol);
    copyVolume(image, st, vol, "root");
    if (body && applyPatches(image, vol, u.repo_dir, [["change.patch", body]], "root") !== null) return { applied: false };
    const merge = mergeTests(u, image, vol, hunks);
    if (merge.merge === "conflict") return { applied: true, merge, vol };
    const run = scoringRun(i.unitDir, u, image, vol, 1, mode, "follow-" + label, i.limitMs);
    return { applied: true, merge, vol, run, sc: followScores(oracleF2p(u), i.start.ids, u.oracle!.stable, run.view) };
  };
  try {
    const head = startTree(u, image, i.volume ?? treeVolume(u.id), i.tree, i.treePatch, st).head;
    if (head !== i.start.head) smFail("E_SM_HISTORY", u.id + ": the " + i.tree + " tree's head " + head + " is not the start set's " + i.start.head);
    const startFile = (p: string) => {
      const r = runBash({ kind: "docker", image, volume: st, repoDir: u.repo_dir, name: runName("start-file") }, 'cd "$1" && cat -- "$3"', {}, [p]);
      if (r.status !== 0) smFail("E_SM_APPLY_FAILED", p + " is not in the start tree");
      return r.stdout;
    };
    let strict: Scored = { applied: false };
    let whole = "", strictBody = "";
    for (let k = 1; k <= 2 && !strict.applied; k++) {
      const patch = readFileSync(i.patchFile, "utf8");
      if (i.patchSha && sha(patch) !== i.patchSha) smFail("E_SM_ARM", i.patchFile + " is not the patch the session record pins");
      const ch = extractChange(patch);
      rec.extractions = k;
      rec.change = { files: ch.files.map((f) => f.path), lines: ch.lines, binary_listed: ch.binary, unsafe: ch.unsafe, patch_sha256: sha(patch), empty: !ch.files.length && !ch.binary.length };
      rec.secondary.files_changed = ch.files.length + ch.binary.length;
      if (ch.unsafe.length) continue;
      let rd: Readings;
      try {
        rd = readings(u.lang, new Set(u.test_patch.files), ch, startFile);
      } catch (e) {
        if ((e as Error).message.startsWith("E_SM_APPLY_FAILED")) continue;
        throw e;
      }
      rec.excluded = rd.excluded;
      whole = ch.files.map((f) => f.text).join("");
      strictBody = rd.strict;
      strict = scoreTree(strictBody, "strict");
    }
    if (!strict.applied) {
      const w = whole ? scoreTree(whole, "whole") : ({ applied: false } as Scored);
      return { ...rec, apply_failed: true, strict: ZERO, f2p_pass: false, incremental: 0, end_to_end: 0, ...(w.applied && w.sc ? { whole: w.sc, whole_run: w.run!.summary } : w.applied ? { whole_note: "the whole change's fix-test merge conflicts: " + w.merge.conflict.slice(0, 3).join(" ") } : { whole: ZERO, whole_note: "the change does not apply" }) };
    }
    rec.applied = true;
    rec.merge = strict.merge.merge;
    rec.three_way = strict.merge.three_way;
    if (strict.merge.merge === "conflict") return { ...rec, conflict: strict.merge.conflict, gap: "E_SM_TEST_PATCH_CONFLICT" };
    Object.assign(rec, { strict: strict.sc!, run: strict.run!.summary, ...strict.sc! });
    if (strictBody === whole) Object.assign(rec, { whole: strict.sc!, whole_note: "same tree as strict; strict's run reused" });
    else {
      const w = scoreTree(whole, "whole");
      if (!w.applied) Object.assign(rec, { whole: ZERO, whole_note: "the whole change does not apply" });
      else if (!w.sc) rec.whole_note = "the whole change's fix-test merge conflicts: " + w.merge.conflict.slice(0, 3).join(" ");
      else Object.assign(rec, { whole: w.sc, whole_run: w.run!.summary });
    }
    if (!strict.sc!.f2p_pass && i.tree !== "S0") {
      const named = namedIds(u.lang, strict.run!.log);
      const occ = occurrences(u, image, strict.vol, named.map((n) => n.id));
      rec.drift = { named, ...decideDrift(true, named.map((n) => n.id), occ.base, occ.start) };
    }
    return rec;
  } finally {
    for (const v of vols) dropVolume(v);
  }
}

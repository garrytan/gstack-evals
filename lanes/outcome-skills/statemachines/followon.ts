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
import { basePatches, BASE_RUNS_FIX_TESTS, treeVolume } from "./oracle.ts";
import { extractChange, fixTestHunks, mergeTests, scoringRun, testHunks, type Outcome, type OutcomeRecord, type RunSummary, type RunView } from "./score.ts";
import type { SessionRecord } from "./session.ts";
import { applyPatches, copyVolume, dropVolume, passed, runName, type Mode } from "./testrun.ts";
import { readUnit, smFail, type SmUnit } from "./unit.ts";

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
    else if (first?.gap) out.push({ ...base, ...none, kept: false, reason: "first-stage gap " + first.gap });
    else if (scored.length < 2) out.push({ ...base, ...none, kept: false, reason: scored.length + " of " + replicates + " replicates scored" });
    else {
      const mean = (k: "incremental" | "end_to_end") => scored.reduce((a, r) => a + (r[k] ?? 0), 0) / scored.length;
      const all3 = (k: "incremental" | "end_to_end") => (scored.length === replicates ? scored.every((r) => r[k] === 1) : null);
      out.push({ ...base, kept: true, reason: "kept", incremental: mean("incremental"), end_to_end: mean("end_to_end"), pass3_incremental: all3("incremental"), pass3_end_to_end: all3("end_to_end") });
    }
  }
  return out.sort((a, b) => (a.unit + a.model + a.tree).localeCompare(b.unit + b.model + b.tree));
}

/** Counts per tree for the report: kept trees, removals by reason, inherited fixes (per arm) and drift units. */
export function treeCounts(scores: TreeScore[]): Record<string, { kept: number; removed_first_gap: number; removed_replicates: number; removed_no_first: number; inherited_fix: number; drift_units: number }> {
  const out: ReturnType<typeof treeCounts> = {};
  for (const s of scores) {
    const c = (out[s.tree] ??= { kept: 0, removed_first_gap: 0, removed_replicates: 0, removed_no_first: 0, inherited_fix: 0, drift_units: 0 });
    if (s.kept) c.kept++;
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
 *  for A1 and S2 the first stage's patch committed as commit two by sh/followon.sh. */
export function startTree(u: SmUnit, image: string, baseVolume: string, tree: Tree, treePatch: string, dst: string): { commits: number; head: string } {
  copyVolume(image, baseVolume, dst, "root");
  const script = 'cd "$1" && git config --global --add safe.directory "*" 2>/dev/null; git clean -fdq && { [ "$3" = S0 ] || bash "$2/followon.sh" "$1" "$2" >&2; } && echo "COMMITS $(git rev-list --all --count)" && echo "HEAD $(git rev-parse HEAD)"';
  const r = runBash({ kind: "docker", image, volume: dst, repoDir: u.repo_dir, name: runName("start-tree") }, script, { "tree.patch": treePatch, "followon.sh": sh("followon.sh") }, [tree]);
  const commits = Number((r.stdout.match(/^COMMITS (\d+)$/m) ?? [])[1]), head = (r.stdout.match(/^HEAD ([0-9a-f]{40})$/m) ?? [])[1] ?? "";
  if (r.status !== 0 || commits !== (tree === "S0" ? 1 : 2) || !head) smFail("E_SM_HISTORY", u.id + ": the " + tree + " follow-on tree has " + (commits || "no") + " commits (exit " + r.status + ": " + r.stderr.trim().slice(-300) + ")");
  return { commits, head };
}

export interface StartSet {
  schema: "sm-start.v1"; unit: string; model: string | null; tree: Tree; tree_patch_sha256: string; head: string; base_runs_fix_tests: boolean;
  ids: string[]; ids_sha256: string; runs: RunSummary[]; merge: "clean" | "conflict" | null; conflict: string[]; gap: "E_SM_TEST_PATCH_CONFLICT" | null;
}

/** Section 8 item 2. On S0 the base stable set. On A1 and S2: the base-run patches merged over the tree by the same
 *  hunk-wise git apply --3way as scoring (on an unchanged base tree it gives the plain git apply the oracle does), then
 *  three runs; the start set is the ids that pass in all three. A merge conflict is a gap for the tree. */
export function computeStart(o: { unitDir: string; tree: Tree; treePatch: string; model?: string | null; mode?: Mode; volume?: string; limitMs?: number }): StartSet {
  const u = readUnit(o.unitDir);
  if (!u.oracle?.stable.length) smFail("E_SM_UNIT", u.id + " has no oracle stable set");
  if ((o.tree === "S0") !== (o.treePatch === "")) smFail("E_SM_ARM", "S0 takes no first-stage patch and A1 and S2 each take one");
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image");
  const res: StartSet = { schema: "sm-start.v1", unit: u.id, model: o.model ?? null, tree: o.tree, tree_patch_sha256: sha(o.treePatch), head: "", base_runs_fix_tests: BASE_RUNS_FIX_TESTS, ids: [], ids_sha256: "", runs: [], merge: null, conflict: [], gap: null };
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

export interface FollowonRecord {
  schema: "sm-followon.v1"; unit: string; model: string | null; tree: Tree; replicate: number | null; cell: string; session: string | null;
  tree_patch_sha256: string; start: { ids: number; ids_sha256: string; gap: string | null };
  change: { files: string[]; lines: number; binary_listed: string[]; unsafe: string[]; patch_sha256: string; empty: boolean };
  applied: boolean; apply_failed: boolean; extractions: number; merge: "clean" | "conflict" | null; three_way: number; conflict: string[];
  /** E_SM_TEST_PATCH_CONFLICT (start set or follow-on merge), E_SM_UPSTREAM_GAP or E_SM_INFRA_GAP; a gap removes the replicate. */
  gap: string | null;
  run: RunSummary | null; f2p_pass: boolean | null; incremental: 0 | 1 | null; end_to_end: 0 | 1 | null; start_failed: string[]; stable_failed: string[];
  drift: { named: { id: string; kinds: string[] }[]; ids: string[]; drift: boolean };
  first: FirstInfo | null;
  secondary: { spent_micros: number | null; unknown_micros: number | null; turns: number | null; wall_ms: number | null; files_changed: number; read_first_stage_files: string[] | null };
}

export interface FollowonInput {
  unitDir: string; tree: Tree; treePatch: string; start: StartSet; patchFile: string; patchSha?: string; cell: string; replicate?: number | null;
  model?: string | null; session?: SessionRecord | null; first?: FirstInfo | null; mode?: Mode; volume?: string; limitMs?: number;
}

export function scoreFollowon(i: FollowonInput): FollowonRecord {
  const u = readUnit(i.unitDir);
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image");
  const s = i.session ?? null;
  if (i.start.unit !== u.id || i.start.tree !== i.tree || i.start.tree_patch_sha256 !== sha(i.treePatch)) smFail("E_SM_ARM", "the start set is not " + i.tree + " on " + u.id + " for this first-stage patch");
  if (i.tree !== "S0" && i.first && (i.first.unit !== u.id || i.first.cell !== i.tree)) smFail("E_SM_ARM", "the first-stage outcome is not " + i.tree + " on " + u.id);
  const created = i.tree === "S0" ? [] : createdPaths(i.treePatch);
  const rec: FollowonRecord = {
    schema: "sm-followon.v1", unit: u.id, model: i.model ?? s?.model ?? null, tree: i.tree, replicate: i.replicate ?? null, cell: i.cell, session: s ? s.lease_id + "/" + s.cell : null,
    tree_patch_sha256: sha(i.treePatch), start: { ids: i.start.ids.length, ids_sha256: i.start.ids_sha256, gap: i.start.gap },
    change: { files: [], lines: 0, binary_listed: [], unsafe: [], patch_sha256: "", empty: true }, applied: false, apply_failed: false, extractions: 0, merge: null, three_way: 0, conflict: [], gap: null,
    run: null, f2p_pass: null, incremental: null, end_to_end: null, start_failed: [], stable_failed: [], drift: { named: [], ids: [], drift: false }, first: i.first ?? null,
    secondary: { spent_micros: s ? s.spent_micros : null, unknown_micros: s ? s.unknown_micros : null, turns: s ? s.turns : null, wall_ms: s ? s.wall_ms : null, files_changed: 0, read_first_stage_files: s && s.transcript && existsSync(s.transcript) ? readCreated(readSession(s.transcript), created) : null },
  };
  if (s && (s.end === "upstream" || s.end === "infra")) {
    if (s.attempt !== 2) smFail("E_SM_ARM", "follow-on " + s.cell + " ended " + s.end + " on attempt 1; it gets one retry from a fresh container before it is a gap");
    return { ...rec, gap: s.end === "upstream" ? "E_SM_UPSTREAM_GAP" : "E_SM_INFRA_GAP" };
  }
  if (i.start.gap) return { ...rec, gap: i.start.gap };
  const zero = () => ({ ...rec, apply_failed: true, f2p_pass: false, incremental: 0 as const, end_to_end: 0 as const });
  const st = runName("follow-tree").toLowerCase();
  const scored = runName("follow-scored").toLowerCase();
  try {
    const head = startTree(u, image, i.volume ?? treeVolume(u.id), i.tree, i.treePatch, st).head;
    if (head !== i.start.head) smFail("E_SM_HISTORY", u.id + ": the " + i.tree + " tree's head " + head + " is not the start set's " + i.start.head);
    let applied = false;
    for (let k = 1; k <= 2 && !applied; k++) {
      const patch = readFileSync(i.patchFile, "utf8");
      if (i.patchSha && sha(patch) !== i.patchSha) smFail("E_SM_ARM", i.patchFile + " is not the patch the session record pins");
      const ch = extractChange(patch);
      rec.extractions = k;
      rec.change = { files: ch.files.map((f) => f.path), lines: ch.lines, binary_listed: ch.binary, unsafe: ch.unsafe, patch_sha256: sha(patch), empty: !ch.files.length && !ch.binary.length };
      rec.secondary.files_changed = ch.files.length + ch.binary.length;
      if (ch.unsafe.length) continue;
      dropVolume(scored);
      copyVolume(image, st, scored, "root");
      const body = ch.files.map((f) => f.text).join("");
      applied = !body || applyPatches(image, scored, u.repo_dir, [["change.patch", body]], "root") === null;
    }
    if (!applied) return zero();
    rec.applied = true;
    const m = mergeTests(u, image, scored, fixTestHunks(i.unitDir, u));
    rec.merge = m.merge;
    rec.three_way = m.three_way;
    if (m.merge === "conflict") return { ...rec, conflict: m.conflict, gap: "E_SM_TEST_PATCH_CONFLICT" };
    const r = scoringRun(i.unitDir, u, image, scored, 1, i.mode ?? "hardened", "follow", i.limitMs);
    const sc = followScores(u.tests.f2p, i.start.ids, u.oracle!.stable, r.view);
    Object.assign(rec, { run: r.summary, ...sc });
    if (!sc.f2p_pass && i.tree !== "S0") {
      const named = namedIds(u.lang, r.log);
      const occ = occurrences(u, image, scored, named.map((n) => n.id));
      rec.drift = { named, ...decideDrift(true, named.map((n) => n.id), occ.base, occ.start) };
    }
    return rec;
  } finally {
    dropVolume(scored);
    dropVolume(st);
  }
}

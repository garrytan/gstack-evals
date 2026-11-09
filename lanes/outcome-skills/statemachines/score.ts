// Copyright (c) 2026 Garry Tan. MIT License.
// The first-stage scorer (post section 7). It extracts the arm's change from the session's snapshot patch (text files
// only; binary files are listed and left out), builds the strict and adapted readings, applies each on a fresh copy of the
// unit's stripped base tree, applies the fix's tests (test.patch, then fix-tests.patch) hunk by hunk with git apply
// --3way, runs the unit's own commands and the dataset's parser, and writes an sm-outcome.v1 record with every exclusion,
// run count and reason code. A test patch that still conflicts is a scoring gap (E_SM_TEST_PATCH_CONFLICT), never a miss;
// a change that won't apply is extracted once more and then scores no fix (E_SM_APPLY_FAILED).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatch as fileChanges, unsafePaths } from "../mutation/diff.ts";
import { parsePatch, section, walk } from "./fixsplit.ts";
import { runBash } from "./history.ts";
import { isProtected, isTestPath, SKIP_MARKERS, SOURCE_EXT, TEST_MODULES, type Lang } from "./langs.ts";
import { oneRun, treeVolume } from "./oracle.ts";
import { applyPatches, copyVolume, dropVolume, passed, runName, runParser, runTests, type Mode } from "./testrun.ts";
import { addUnitFile, readUnit, saveUnit, smFail, type SmUnit } from "./unit.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- Step 1: the arm's change ----

export const sections = (patch: string): string[] => patch.split(/^(?=diff --git )/m).filter((s) => s.startsWith("diff --git "));

export interface ChangeFile { path: string; oldPath: string | null; newPath: string | null; binary: boolean; text: string }
export interface Change { files: ChangeFile[]; binary: string[]; unsafe: string[]; lines: number }

/** The snapshot patch (real_agent's working tree against base, untracked files included) split per file. Binary sections
 *  are listed and left out; unsafe paths (absolute, empty, "." or "..") make the change one that does not apply. */
export function extractChange(patch: string): Change {
  const all = sections(patch).map((text) => {
    const c = fileChanges(text)[0]!;
    return { path: c.newPath ?? c.oldPath ?? "", oldPath: c.oldPath, newPath: c.newPath, binary: c.binary, text: text.endsWith("\n") ? text : text + "\n", n: c.added.length + c.removed.length };
  });
  return {
    files: all.filter((f) => !f.binary).map(({ n: _n, ...f }) => f), binary: all.filter((f) => f.binary).map((f) => f.path),
    unsafe: unsafePaths(fileChanges(patch)), lines: all.reduce((a, f) => a + (f.binary ? 0 : f.n), 0),
  };
}

// ---- Step 2: the strict and adapted readings ----

export type Rule = "binary" | "protected" | "test_file" | "in_source_test";
export interface Exclusion { path: string; rule: Rule; readings: "both" | "strict"; detail?: string }
export interface Readings {
  strict: string; adapted: string; excluded: Exclusion[];
  /** Added lines in the adapted tree's change that hold a skip marker. */
  skip: { path: string; marker: string }[];
  deps_changed: string[];
}

const split = (t: string): { l: string[]; eol: boolean } => (t === "" ? { l: [], eol: true } : t.endsWith("\n") ? { l: t.slice(0, -1).split("\n"), eol: true } : { l: t.split("\n"), eol: false });

/** A section that turns a file's base text into new text in one hunk, under the arm's own file header. */
function replace(header: string[], from: string, to: string): string {
  const a = split(from), b = split(to);
  const nl = "\\ No newline at end of file";
  const body = [...a.l.map((x) => "-" + x), ...(a.eol || !a.l.length ? [] : [nl]), ...b.l.map((x) => "+" + x), ...(b.eol || !b.l.length ? [] : [nl])];
  return header.join("\n") + "\n@@ -" + (a.l.length ? 1 : 0) + "," + a.l.length + " +" + (b.l.length ? 1 : 0) + "," + b.l.length + " @@\n" + body.join("\n") + "\n";
}

/** A file's top-level test modules (the frozen detector's ranges not inside another), each with its mod name. */
function modules(text: string, detect: (t: string) => [number, number][]): { name: string; a: number; b: number }[] {
  const all = detect(text), l = text.split("\n");
  return all.filter(([a, b]) => !all.some(([c, d]) => c <= a && d >= b && (c !== a || d !== b))).map(([a, b]) => ({ name: l.slice(a - 1, b).join("\n").match(/\bmod\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] ?? "", a, b }));
}

/** An in-source file's strict section: each test module in the arm's file goes back to the base file's module of the
 *  same name (the arm's edits inside it dropped), a test module the arm added is dropped, and a base test module the arm
 *  removed comes back at the end of the file. The arm's edits outside test modules stay. Null when nothing changes. */
function inSource(lang: Lang, f: ChangeFile, base: (p: string) => string, ex: Exclusion[]): string | null {
  const detect = TEST_MODULES[lang]!;
  const d = parsePatch(f.text)[0];
  if (!d?.hunks.length) return null;
  const old = base(f.oldPath!);
  let arm: string;
  try {
    arm = walk(old, d.hunks, f.path).text;
  } catch (e) {
    return smFail("E_SM_APPLY_FAILED", f.path + ": the arm's change does not match the base file (" + (e as Error).message.replace(/^E_SM_UNIT /, "") + ")");
  }
  const bl = old.split("\n"), al = arm.split("\n"), bm = modules(old, detect);
  const taken = new Set<number>();
  const out: string[] = [];
  let cur = 0;
  for (const m of modules(arm, detect)) {
    while (cur < m.a - 1) out.push(al[cur++]!);
    const k = bm.findIndex((x, j) => !taken.has(j) && x.name === m.name);
    if (k >= 0) {
      taken.add(k);
      const body = bl.slice(bm[k]!.a - 1, bm[k]!.b);
      out.push(...body);
      if (body.join("\n") !== al.slice(m.a - 1, m.b).join("\n")) ex.push({ path: f.path, rule: "in_source_test", readings: "strict", detail: "mod " + m.name + " restored to base" });
    } else {
      if (out.length && out[out.length - 1]!.trim() === "") out.pop();
      ex.push({ path: f.path, rule: "in_source_test", readings: "strict", detail: "new mod " + m.name + " dropped" });
    }
    cur = m.b;
  }
  while (cur < al.length) out.push(al[cur++]!);
  bm.forEach((m, j) => {
    if (taken.has(j)) return;
    const tail = out.length && out[out.length - 1] === "" ? [out.pop()!] : [];
    out.push("", ...bl.slice(m.a - 1, m.b), ...tail);
    ex.push({ path: f.path, rule: "in_source_test", readings: "strict", detail: "mod " + m.name + " the arm removed put back" });
  });
  const strict = out.join("\n");
  return strict === arm ? null : replace(d.header, old, strict);
}

/** Section 7 step 2. base(path) reads a file of the unit's stripped base tree. Protected test and build configuration is
 *  never applied (edited, deleted or new); existing test files go back to base in strict and stay in adapted; in-source
 *  test modules go back to base in strict; every other file, new test files included, is applied in both. */
export function readings(lang: Lang, testFiles: ReadonlySet<string>, ch: Change, base: (path: string) => string): Readings {
  const excluded: Exclusion[] = ch.binary.map((path) => ({ path, rule: "binary" as const, readings: "both" as const }));
  const skip: Readings["skip"] = [], deps: string[] = [];
  let strict = "", adapted = "";
  for (const f of ch.files) {
    const paths = [f.oldPath, f.newPath].filter((p): p is string => p !== null);
    if (paths.some(isProtected)) {
      excluded.push({ path: f.path, rule: "protected", readings: "both", detail: f.oldPath === null ? "new file" : f.newPath === null ? "deleted" : "edited" });
      deps.push(f.path);
      continue;
    }
    adapted += f.text;
    for (const l of f.text.split("\n")) {
      if (!l.startsWith("+") || l.startsWith("+++ ")) continue;
      for (const marker of SKIP_MARKERS[lang]) if (l.includes(marker) && !skip.some((s) => s.path === f.path && s.marker === marker)) skip.push({ path: f.path, marker });
    }
    if (f.oldPath !== null && isTestPath(lang, f.oldPath, testFiles)) {
      excluded.push({ path: f.path, rule: "test_file", readings: "strict", detail: f.newPath === null ? "deleted" : "edited" });
      continue;
    }
    const src = f.oldPath !== null && f.newPath !== null && !!TEST_MODULES[lang] && SOURCE_EXT[lang].test(f.oldPath);
    strict += (src && inSource(lang, f, base, excluded)) || f.text;
  }
  return { strict, adapted, excluded, skip, deps_changed: deps };
}

// ---- Step 3: the fix's tests, hunk by hunk ----

/** test.patch and fix-tests.patch as one patch per hunk (each under its file's header, so git apply --3way finds the
 *  base blob), in order. A section with one hunk, none (binary, mode only) or one this reader can't split stays whole. */
export function testHunks(...patches: string[]): string[] {
  const out: string[] = [];
  for (const p of patches)
    for (const s of sections(p)) {
      let d: ReturnType<typeof parsePatch>[number] | undefined;
      try {
        d = parsePatch(s)[0];
      } catch {
        d = undefined;
      }
      if (!d || d.hunks.length < 2) out.push(s.endsWith("\n") ? s : s + "\n");
      else for (const h of d.hunks) out.push(section(d, [h]));
    }
  return out;
}

/** Stages the arm's tree (git apply --3way works on the index), then applies each hunk patch in order; a hunk that
 *  still conflicts stops the merge and lists the unmerged files. */
export const MERGE = [
  'cd "$1" && git config --global --add safe.directory "*" 2>/dev/null; git add -A >/tmp/sm-stage.log 2>&1 || { echo "SM_STAGE_FAILED $(tail -c 300 /tmp/sm-stage.log)"; exit 4; }',
  'for p in $(ls "$2" | sort -n); do',
  '  if ! git apply --3way --whitespace=nowarn "$2/$p" >/tmp/sm-apply.log 2>&1; then echo "SM_CONFLICT $p"; git diff --name-only --diff-filter=U; exit 3; fi',
  '  if grep -qi "three-way" /tmp/sm-apply.log; then echo "SM_3WAY $p"; fi',
  "done",
  "echo SM_MERGED",
].join("\n");

// ---- Steps 5 to 7: the outcome rules ----

export type Outcome = "clean_fix" | "fix_broke" | "no_fix" | "no_fix_broke";
export interface RunView { parsed: Record<string, string> | null; build_failed: boolean }
/** The ids that took the 2-of-3 majority, per direction; [] when that direction did not rerun. */
export interface Reruns { fix: string[]; no_fix: string[]; break: string[] }
export interface Verdict {
  fixed: boolean; broke: boolean; outcome: Outcome; rerun_2of3: boolean; reruns: Reruns; new_tests: string[];
  broke_by: { stable_missing: string[]; stable_failed: string[]; new_test_failed: string[]; build_failed: boolean };
  /** Stable ids absent from every run whose rebuild succeeded (the adapted reading's existence check); none when no run built. */
  absent: string[];
  /** True while fewer than three runs exist and the rules want three (a new test, or an outcome on 2 tests or fewer). */
  wants_more: boolean;
}

const FAIL = "fail";
const pass = (r: RunView, id: string) => !r.build_failed && !!r.parsed && passed(r.parsed, id);
const has = (r: RunView, id: string) => !r.build_failed && !!r.parsed && id in r.parsed;

/** Section 7 steps 5 to 7 over the runs made so far. known: every id the unit's base and fixed oracle runs report; an id
 *  outside it is a new test the arm wrote. Step 6 in three directions, each judged on its own deciding set from the first
 *  run: fix (every fail-to-pass id passed: those ids), no fix (the fail-to-pass ids that did not pass) and break (the
 *  stable ids that did not pass). A direction whose set holds 1 or 2 ids reruns; the two extra runs are shared, and each
 *  id of a rerun direction takes its majority over the three runs while every other id keeps its first-run result. */
export function decide(f2p: string[], stable: string[], known: ReadonlySet<string>, runs: RunView[]): Verdict {
  const r1 = runs[0]!;
  const fixed1 = f2p.every((id) => pass(r1, id));
  const sets: Reruns = { fix: fixed1 ? [...f2p] : [], no_fix: fixed1 ? [] : f2p.filter((id) => !pass(r1, id)), break: stable.filter((id) => !pass(r1, id)) };
  const small = (xs: string[]) => xs.length >= 1 && xs.length <= 2;
  const rerunIds = new Set([sets.fix, sets.no_fix, sets.break].filter(small).flat());
  const newIds = [...new Set(runs.flatMap((r) => (r.build_failed || !r.parsed ? [] : Object.keys(r.parsed))))].filter((id) => !known.has(id)).sort();
  const wants_more = runs.length < 3 && (rerunIds.size > 0 || newIds.length > 0);
  const rerun = rerunIds.size > 0 && runs.length >= 3;
  const three = runs.slice(0, 3);
  const ok = (id: string) => (rerun && rerunIds.has(id) ? three.filter((r) => pass(r, id)).length >= 2 : pass(r1, id));
  const seen = (id: string) => (rerun && rerunIds.has(id) ? three : [r1]).some((r) => has(r, id));
  const built = runs.filter((r) => !r.build_failed && !!r.parsed);
  const took = (xs: string[]) => (rerun && small(xs) ? xs : []);
  const fixed = f2p.every(ok);
  const notOk = stable.filter((id) => !ok(id));
  const newFailed = runs.length >= 3 ? newIds.filter((id) => three.every((r) => !r.build_failed && r.parsed?.[id] === FAIL)) : [];
  const broke = notOk.length > 0 || newFailed.length > 0;
  return {
    fixed, broke, outcome: fixed ? (broke ? "fix_broke" : "clean_fix") : broke ? "no_fix_broke" : "no_fix", rerun_2of3: rerun,
    reruns: { fix: took(sets.fix), no_fix: took(sets.no_fix), break: took(sets.break) }, new_tests: newIds,
    broke_by: { stable_missing: notOk.filter((id) => !seen(id)), stable_failed: notOk.filter(seen), new_test_failed: newFailed, build_failed: r1.build_failed },
    absent: built.length ? stable.filter((id) => !built.some((r) => has(r, id))) : [], wants_more,
  };
}

// ---- The record ----

export interface RunSummary { n: number; wall_ms: number; exits: number[]; stopped: boolean; build_failed: boolean; parsed_sha256: string | null }
export interface ReadingResult {
  /** three_way: how many of the fix's test hunks git applied by falling back to the three-way merge. */
  applied: boolean; merge: "clean" | "conflict" | null; three_way: number; conflict: string[]; runs: RunSummary[]; fixed: boolean | null; broke: boolean | null;
  broke_by: Verdict["broke_by"] | null; absent: string[]; rerun_2of3: boolean; reruns: Reruns; new_tests: string[]; outcome: Outcome | null;
  gap: "E_SM_TEST_PATCH_CONFLICT" | null; apply_failed: boolean;
}
/** Section 7 step 9's fallbacks, each counted with its own reason: skip_marker and stable_missing send the adapted
 *  reading back to strict; test_patch_conflict_adapted is a gap for the adapted reading only; rebuild_failed (per reading)
 *  is a rebuild command that failed in a scoring run, which misses every test in that run. */
export type FallbackReason = "skip_marker" | "stable_missing" | "test_patch_conflict_adapted" | "rebuild_failed";
export interface Fallback { reason: FallbackReason; reading: "strict" | "adapted"; detail: string }
export interface OutcomeRecord {
  schema: "sm-outcome.v1"; stage: "first"; unit: string; model: string | null; cell: string; session: string | null;
  change: { files: string[]; lines: number; binary_listed: string[]; unsafe: string[]; patch_sha256: string; empty: boolean };
  excluded: Exclusion[]; deps_changed: string[]; skip_markers: Readings["skip"]; fallbacks: Fallback[];
  strict: ReadingResult;
  adapted: ReadingResult & { same_tree: boolean; fell_back_to_strict: string | null };
  /** Per reading: E_SM_TEST_PATCH_CONFLICT for a gap, E_SM_APPLY_FAILED for a change that won't apply, else null. */
  codes: { strict: string | null; adapted: string | null };
  extractions: number; test_hunks: number; known_ids: number;
}

export interface ScoreInput {
  unitDir: string; patchFile: string; patchSha?: string; cell: string; model?: string | null; session?: string | null;
  mode?: Mode; runEmpty?: boolean; volume?: string; limitMs?: number;
}

/** Every id the unit's oracle reports on one base and one fixed run, cached in the unit dir as oracle-ids.json. */
export function knownIds(dir: string, u: SmUnit, volume: string, mode: Mode, limitMs?: number): Set<string> {
  const f = join(dir, "oracle-ids.json");
  if (u.files["oracle-ids.json"] && existsSync(f)) return new Set(JSON.parse(readFileSync(f, "utf8")) as string[]);
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image; run its oracle first");
  const ids = new Set<string>();
  for (const tree of ["base", "fixed"] as const) {
    const r = oneRun(dir, u, volume, image, tree, 0, mode, limitMs);
    if (!r.parsed) smFail("E_SM_INFRA_GAP", u.id + ": the " + tree + " run for the known test ids did not parse");
    for (const id of Object.keys(r.parsed!)) ids.add(id);
  }
  addUnitFile(dir, u, "oracle-ids.json", JSON.stringify([...ids].sort()) + "\n");
  saveUnit(dir, u);
  return ids;
}

/** Section 7 step 3's hunks for a unit: test.patch, then fix-tests.patch when the fix was split. The first-stage and
 *  follow-on scorers both apply these. */
export function fixTestHunks(dir: string, u: SmUnit): string[] {
  const rf = (n: string) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), "utf8") : "");
  return testHunks(rf("test.patch"), u.split ? rf("fix-tests.patch") : "");
}

/** Merges hunk patches over the tree in volume (staged first) by MERGE. A clean merge counts the hunks git took by its
 *  three-way fallback; a conflict lists the hunk and the unmerged files. */
export function mergeTests(u: SmUnit, image: string, volume: string, hunks: string[]): { merge: "clean" | "conflict"; three_way: number; conflict: string[] } {
  const m = runBash({ kind: "docker", image, volume, repoDir: u.repo_dir, name: runName("merge") }, MERGE, Object.fromEntries(hunks.map((h, k) => [String(k + 1), h])));
  if (m.stdout.includes("SM_STAGE_FAILED") || !/SM_MERGED|SM_CONFLICT/.test(m.stdout)) smFail("E_SM_INFRA_GAP", u.id + ": the scorer could not stage the tree for the merge: " + (m.stdout + m.stderr).slice(-300));
  if (!m.stdout.includes("SM_MERGED")) {
    const out = m.stdout.split("\n").filter(Boolean);
    return { merge: "conflict", three_way: 0, conflict: out.length ? out : ["exit " + m.status + ": " + m.stderr.slice(-200)] };
  }
  return { merge: "clean", three_way: m.stdout.split("\n").filter((l) => l.startsWith("SM_3WAY ")).length, conflict: [] };
}

/** One scoring run on a fresh copy of volume: the unit's rebuild, test and print commands, then the dataset's parser. A
 *  build failure is a rebuild command that exits non-zero, a stopped run or a log the parser gives nothing for. */
export function scoringRun(dir: string, u: SmUnit, image: string, volume: string, n: number, mode: Mode, label: string, limitMs?: number): { view: RunView; summary: RunSummary; log: string } {
  const run = volume + "-r" + n;
  copyVolume(image, volume, run, mode);
  try {
    const t = runTests({ image, volume: run, repoDir: u.repo_dir, workDir: u.work_dir, commands: u.commands, mode, ...(limitMs ? { limitMs } : {}), label: u.id + "-" + label + n });
    const parsed = t.stopped ? null : runParser(readFileSync(join(dir, "parser.py"), "utf8"), t.log, u.id + "-" + label + n);
    const build_failed = t.stopped || !parsed || t.exits.length < u.commands.rebuild.length || t.exits.slice(0, u.commands.rebuild.length).some((x) => x !== 0);
    return { view: { parsed, build_failed }, summary: { n, wall_ms: t.wall_ms, exits: t.exits, stopped: t.stopped, build_failed, parsed_sha256: parsed ? sha(JSON.stringify(parsed)) : null }, log: t.log === t.stderr ? t.log : t.stderr + "\n" + t.log };
  } finally {
    dropVolume(run);
  }
}

const blank = (): ReadingResult => ({ applied: false, merge: null, three_way: 0, conflict: [], runs: [], fixed: null, broke: null, broke_by: null, absent: [], rerun_2of3: false, reruns: { fix: [], no_fix: [], break: [] }, new_tests: [], outcome: null, gap: null, apply_failed: false });
const unapplied = (): ReadingResult => ({ ...blank(), apply_failed: true, fixed: false, broke: false, outcome: "no_fix" });

/** Section 7 step 2's adapted reading and step 9's fallbacks, given the strict result. The adapted change is scored only
 *  when it differs from strict and holds no skip marker. A skip marker on any added line of the adapted change, or a stable
 *  id missing from every run that built, sends the adapted reading back to strict; a test-patch conflict on the adapted
 *  tree is that reading's own gap; an adapted change that won't apply also takes strict's result. rebuild_failed is
 *  recorded per reading for every scoring run whose rebuild failed (adapted names strict's runs when it took them). */
export function settleAdapted(strict: ReadingResult, o: { scored: boolean; same: boolean; skip: Readings["skip"]; rebuildCommands: number; scoreAdapted: () => ReadingResult }): { adapted: ReadingResult; fell: string | null; fallbacks: Fallback[] } {
  const fallbacks: Fallback[] = [];
  const rebuild = (r: ReadingResult, reading: Fallback["reading"], note = "") => {
    const bad = r.runs.filter((x) => x.build_failed);
    if (bad.length) fallbacks.push({ reason: "rebuild_failed", reading, detail: note + bad.map((x) => "run " + x.n + (x.stopped ? " stopped" : x.exits.length < o.rebuildCommands ? " no rebuild exit" : " rebuild exits " + x.exits.slice(0, o.rebuildCommands).join(","))).join("; ") });
  };
  rebuild(strict, "strict");
  let adapted: ReadingResult = { ...strict };
  let fell: string | null = null;
  if (o.scored && !o.same) {
    if (o.skip.length) {
      fell = "skip marker: " + o.skip.map((s) => s.path + " " + s.marker).join(", ");
      fallbacks.push({ reason: "skip_marker", reading: "adapted", detail: o.skip.map((s) => s.path + " " + s.marker).join(", ") });
    } else {
      const a = o.scoreAdapted();
      if (a.apply_failed) fell = "the adapted change does not apply";
      else if (a.absent.length) {
        fell = a.absent.length + " stable test ids missing from every run: " + a.absent.slice(0, 5).join(", ");
        fallbacks.push({ reason: "stable_missing", reading: "adapted", detail: a.absent.length + " stable ids missing: " + a.absent.slice(0, 5).join(", ") });
      } else {
        adapted = a;
        if (a.gap) fallbacks.push({ reason: "test_patch_conflict_adapted", reading: "adapted", detail: "strict " + (strict.gap ? "also conflicts" : "keeps its own result") + "; " + a.conflict.slice(0, 3).join(" ") });
      }
    }
  }
  rebuild(adapted, "adapted", adapted.runs === strict.runs ? "strict's runs: " : "");
  return { adapted, fell, fallbacks };
}

/** Scores one first-stage change on the unit's tree volume. */
export function scoreFirst(i: ScoreInput): OutcomeRecord {
  const u = readUnit(i.unitDir);
  if (!u.oracle?.stable.length) smFail("E_SM_UNIT", u.id + " has no oracle stable set");
  const mode = i.mode ?? "hardened";
  const image = u.image.runtime_id ?? smFail("E_SM_UNIT", u.id + " has no runtime image");
  const volume = i.volume ?? treeVolume(u.id);
  const hunks = fixTestHunks(i.unitDir, u);
  const base = (p: string) => {
    const r = runBash({ kind: "docker", image, volume, repoDir: u.repo_dir, name: runName("base") }, 'cd "$1" && cat -- "$3"', {}, [p]);
    if (r.status !== 0) smFail("E_SM_APPLY_FAILED", p + " is not in the base tree");
    return r.stdout;
  };
  let known: Set<string> | null = null;

  const score = (patch: string): ReadingResult => {
    const res = blank();
    const scored = runName("scored").toLowerCase();
    copyVolume(image, volume, scored, "root");
    try {
      if (patch && applyPatches(image, scored, u.repo_dir, [["change.patch", patch]], "root")) return { ...res, apply_failed: true };
      res.applied = true;
      const m = mergeTests(u, image, scored, hunks);
      if (m.merge === "conflict") return { ...res, merge: "conflict", conflict: m.conflict, gap: "E_SM_TEST_PATCH_CONFLICT" };
      res.merge = "clean";
      res.three_way = m.three_way;
      const views: RunView[] = [];
      let v: Verdict;
      do {
        const r = scoringRun(i.unitDir, u, image, scored, views.length + 1, mode, "score", i.limitMs);
        views.push(r.view);
        res.runs.push(r.summary);
        known ??= knownIds(i.unitDir, u, volume, mode, i.limitMs);
        v = decide(u.tests.f2p, u.oracle!.stable, known, views);
      } while (v.wants_more);
      return { ...res, fixed: v.fixed, broke: v.broke, broke_by: v.broke_by, absent: v.absent, rerun_2of3: v.rerun_2of3, reruns: v.reruns, new_tests: v.new_tests, outcome: v.outcome };
    } finally {
      dropVolume(scored);
    }
  };

  const extract = () => {
    const patch = readFileSync(i.patchFile, "utf8");
    if (i.patchSha && sha(patch) !== i.patchSha) smFail("E_SM_ARM", i.patchFile + " is not the patch the session record pins");
    const ch = extractChange(patch);
    let rd: Readings | null = null;
    if (!ch.unsafe.length)
      try {
        rd = readings(u.lang, new Set(u.test_patch.files), ch, base);
      } catch (e) {
        if (!(e as Error).message.startsWith("E_SM_APPLY_FAILED")) throw e;
      }
    return { patch, ch, rd };
  };

  let extractions = 1;
  let x = extract();
  const empty = x.ch.files.length === 0 && x.ch.binary.length === 0;
  let strict: ReadingResult;
  if (empty && !i.runEmpty) strict = { ...blank(), fixed: false, broke: false, outcome: "no_fix" };
  else {
    strict = x.rd ? score(x.rd.strict) : unapplied();
    if (strict.apply_failed) {
      extractions = 2;
      x = extract();
      strict = x.rd ? score(x.rd.strict) : unapplied();
      if (strict.apply_failed) strict = unapplied();
    }
  }
  const rd = x.rd;
  const same = !rd || rd.adapted === rd.strict;
  const { adapted, fell, fallbacks } = settleAdapted(strict, { scored: !strict.apply_failed && !(empty && !i.runEmpty), same, skip: rd?.skip ?? [], rebuildCommands: u.commands.rebuild.length, scoreAdapted: () => score(rd!.adapted) });
  const code = (r: ReadingResult) => r.gap ?? (r.apply_failed ? "E_SM_APPLY_FAILED" : null);
  return {
    schema: "sm-outcome.v1", stage: "first", unit: u.id, model: i.model ?? null, cell: i.cell, session: i.session ?? null,
    change: { files: x.ch.files.map((f) => f.path), lines: x.ch.lines, binary_listed: x.ch.binary, unsafe: x.ch.unsafe, patch_sha256: sha(x.patch), empty },
    excluded: rd?.excluded ?? [], deps_changed: rd?.deps_changed ?? [], skip_markers: rd?.skip ?? [], fallbacks,
    strict, adapted: { ...adapted, same_tree: same, fell_back_to_strict: fell }, codes: { strict: code(strict), adapted: code(adapted) },
    extractions, test_hunks: hunks.length, known_ids: known ? (known as Set<string>).size : 0,
  };
}

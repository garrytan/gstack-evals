// Copyright (c) 2026 Garry Tan. MIT License.
// One session's score (plan section 6 and the section 9 secondaries): S (a git repo whose ref holds the session-end
// commit), the unit dir, its neutral record, CHECKS.json from the wrap-up turn and the session record go in; a pf-catch.v1
// record comes out. The executor is injected so keyless tests use a fake; the CLI passes the Docker executor.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classify, isTestPath } from "../statemachines/langs.ts";
import { runBash } from "../statemachines/history.ts";
import { basePatches } from "../statemachines/oracle.ts";
import { patchFiles } from "../statemachines/source.ts";
import { applyPatches, copyVolume, dropVolume, parseRun, runName, runTests, type Mode, type RebuildRule } from "../statemachines/testrun.ts";
import { readUnit, type SmUnit } from "../statemachines/unit.ts";
import type { Row, Score } from "./analysis.ts";
import { stratumOf } from "./draw.ts";
import { codeTest, pLoaded, pProcedure, ranChecker, readSession } from "./exposure.ts";
import type { Arm } from "./items.ts";
import { readManifest, type TFacts } from "./manifest.ts";
import { fixSourcePatch, unitTestFiles, type NeutralRecord } from "./neutral.ts";
import { pfFail } from "./prereg.ts";
import { CEILING_MS, entryTimeout, rebuildExempt, scoreEntries, unitScore, type EntryResult, type Executor } from "./runner.ts";
import * as sec from "./secondaries.ts";
import { buildTrees, changesOf, git, show, withoutFiles } from "./trees.ts";

/** The session record fields scoring reads (the session runner writes the rest). gap: the session's own harness gap
 *  (E_PF_UPSTREAM_GAP or E_PF_INFRA_GAP after its one retry); wrapup_end: how the wrap-up turn ended; forced: the
 *  force-captured paths from the session-end commit; claude_session: Claude Code's own transcript (claude-session.jsonl, by
 *  default beside the transcript), where P's skill body appears. */
export interface SessionIn { unit?: string; model?: string; arm?: Arm; gap?: string | null; wrapup_end?: string | null; forced?: string[]; transcript?: string | null; claude_session?: string | null; in_flight?: { reservation_bound: number; subagents: number; subagent_cap_refused: number } }

export interface ScoreIn {
  s: string; ref?: string; unitDir: string; neutral: string; checks: string | null; session: string; transcript?: string | null; claudeSession?: string | null;
  exec: (repo: string, u: SmUnit) => Executor & { cleanup?: () => void };
  breaks?: (repo: string, t: string, u: SmUnit) => sec.BreaksRuns | null;
  now?: () => number; ceiling_ms?: number;
}

const readJson = <T>(p: string): T => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch (e) {
    return pfFail("E_PF_INPUT", p + " is not readable JSON: " + (e as Error).message);
  }
};
const strip = (rs: EntryResult[]) => rs.map((r) => ({ ...r, runs: r.runs.map((x) => ({ ...x, log: x.log.slice(-2000) })) }));

export async function scoreSession(o: ScoreIn) {
  const u = readUnit(o.unitDir);
  const nrec = readJson<NeutralRecord>(o.neutral);
  if (nrec.schema !== "pf-neutral.v1" || nrec.id !== u.id || nrec.verdict !== "kept" || !nrec.mode) pfFail("E_PF_INPUT", o.neutral + " is not a kept neutral record for " + u.id);
  const sess = readJson<SessionIn>(o.session);
  const head = { schema: "pf-catch.v1" as const, unit: u.id, repo: u.repo, month: u.month, stratum: stratumOf(u.month), model: sess.model ?? null, arm: sess.arm ?? null, in_flight: sess.in_flight ?? null };
  if (sess.gap) return { ...head, score: null, gap: sess.gap, readings: { no_static: null, no_api_guess: null, compile_rerun: null } };
  const tmp = mkdtempSync(join(tmpdir(), "pf-score-"));
  const repo = join(tmp, "repo");
  let exec: (Executor & { cleanup?: () => void }) | null = null;
  try {
    git(tmp, ["init", "-q", repo]);
    git(repo, ["fetch", "-q", "--no-tags", o.s, "+" + (o.ref ?? "HEAD") + ":refs/pf/s"]);
    const testFiles = unitTestFiles(o.unitDir);
    const trees = buildTrees({ repo, ref: "refs/pf/s", lang: u.lang, testFiles, fixPatch: fixSourcePatch(o.unitDir), neutral: { mode: nrec.mode!, files: nrec.files } });
    const tChanges = changesOf(repo, trees.base, trees.parent);
    const tPaths = git(repo, ["ls-tree", "-r", "-z", "--name-only", trees.parent]).stdout.split("\0").filter(Boolean);
    const edited = tChanges.filter((c) => c.status !== "D").map((c) => ({ path: c.path, status: c.status, text: show(repo, trees.parent, c.path) }));
    const editedTests = edited.filter((f) => isTestPath(u.lang, f.path, testFiles));
    const facts: TFacts = { changed: edited.map((f) => f.path), test_files: tPaths.filter((p) => isTestPath(u.lang, p, testFiles)), test_words: new Set(editedTests.flatMap((f) => f.text.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? [])) };
    const text = o.checks && existsSync(o.checks) ? readFileSync(o.checks, "utf8") : null;
    const m = readManifest(text, facts, { wrapupLimit: /^limit/.test(sess.wrapup_end ?? "") });
    const transcript = o.transcript ?? sess.transcript ?? null;
    const records = transcript && existsSync(transcript) ? readSession(transcript) : null;
    const ccFile = o.claudeSession ?? sess.claude_session ?? (transcript ? join(dirname(transcript), "claude-session.jsonl") : null);
    const cc = ccFile && existsSync(ccFile) ? readSession(ccFile) : null;
    const exposure = { ...(records ? { ...pLoaded(records, cc), checker: ranChecker(records) } : { body: null, statechart_read: null, loaded: null, checker: null }), procedure: pProcedure(edited.filter((f) => f.status === "A")), code_test: codeTest(u.lang, testFiles, tChanges) };
    const transplant = { product_files: trees.plan.product_files, deleted_restored: trees.plan.deleted_restored, kept_test_hunks: trees.plan.kept_test_hunks, restored_hunks: trees.plan.restored_hunks, mixed_hunks: trees.plan.mixed_hunks };
    const base = { ...head, trees: { s: trees.s, base: trees.base, parent: trees.parent, fix: trees.fix, neutral: trees.neutral }, manifest: { none: m.none, listed: m.listed, skipped: m.skipped, inline: m.inline, names_nothing: m.names_nothing, beyond_cap: m.beyond_cap, run: m.run.map((e) => e.index) }, exposure, transplant, force_captured: (sess.forced ?? []).length, timeout_s: entryTimeout(u) };
    if (trees.gap) return { ...base, score: null, gap: trees.gap, conflict: trees.conflict, readings: { no_static: null, no_api_guess: null, compile_rerun: null } };
    if (m.none || !m.run.length) return { ...base, score: 0, gap: null, no_manifest: m.none, readings: { no_static: 0, no_api_guess: 0, compile_rerun: 0 } };
    exec = o.exec(repo, u);
    const now = o.now ?? Date.now;
    const t0 = now(), ceiling = o.ceiling_ms ?? CEILING_MS;
    const added = tChanges.filter((c) => c.status === "A").map((c) => c.path);
    const common = { timeout_s: entryTimeout(u), exempt: rebuildExempt(u), now, aside: added };
    const run = await scoreEntries(m.run.map((e) => ({ index: e.index, command: e.command })), exec, { ...common, trees: { parent: trees.parent, fix: trees.fix!, neutral: trees.neutral }, ceiling_ms: ceiling });
    const rs = run.results;
    const productBase = new Set(tPaths.filter((p) => classify(u.lang, p, testFiles) === "source").map((p) => p.split("/").pop()!));
    const staticFiles = sec.staticTextFiles(editedTests.filter((f) => f.status === "A"), productBase);
    const staticEntries = rs.filter((r) => sec.isStaticEntry(r.command, staticFiles, u.lang)).map((r) => r.index);
    const apiGuess = Object.fromEntries(rs.map((r) => [r.index, sec.apiGuess(repo, u.lang, trees.parent, trees.fix!, r)]).filter(([, ids]) => (ids as string[]).length));
    const drift = Object.fromEntries(rs.filter((r) => r.outcome === "no_catch").map((r) => [r.index, sec.drift(repo, u.lang, trees.parent, trees.fix!, r)]).filter(([, ids]) => (ids as string[]).length));
    const compile: Array<{ index: number; dropped: string[]; outcome: string; why: string }> = [];
    for (const r of rs.filter((x) => x.outcome === "no_catch")) {
      const drop = sec.compileBlocked(u.lang, r, added, new Set(tPaths));
      if (!drop?.length) continue;
      const fixR = withoutFiles(repo, trees.fix!, trees.s, drop), neutR = withoutFiles(repo, trees.neutral, trees.s, drop);
      const rr = await scoreEntries([{ index: r.index, command: r.command }], exec, { ...common, trees: { parent: trees.parent, fix: fixR, neutral: neutR }, fixOnly: true, ceiling_ms: Math.max(0, ceiling - (now() - t0)), label: "cb" });
      compile.push({ index: r.index, dropped: drop, outcome: rr.results[0]!.outcome, why: rr.results[0]!.why });
    }
    const breaksRuns = o.breaks?.(repo, trees.parent, u) ?? null;
    const score = unitScore(rs, null);
    const catching = rs.filter((r) => r.outcome === "catch");
    const reading = (keep: (r: EntryResult) => boolean) => (score.score === null ? null : catching.some(keep) ? 1 : 0);
    return {
      ...base, score: score.score, gap: score.gap,
      readings: { no_static: reading((r) => !staticEntries.includes(r.index)), no_api_guess: reading((r) => !(r.index in apiGuess)), compile_rerun: score.score === null ? null : score.score === 1 || compile.some((c) => c.outcome === "catch") ? 1 : 0 },
      entries: strip(rs), ceiling_hit: run.ceiling_hit, wall_ms: run.wall_ms, compile_blocked: compile,
      secondaries: {
        red_on_parent: sec.redOnParent(rs), model_only_red: sec.modelOnlyRed(rs), aimed: sec.aimed(edited, patchFiles(readFileSync(join(o.unitDir, "fix.patch"), "utf8"))),
        breaks: breaksRuns ? sec.breaksReading(u.oracle?.stable ?? [], breaksRuns) : null, breaks_skipped: breaksRuns?.skipped ?? null, breaks_unmeasured: breaksRuns?.unmeasured ?? null, product_edits: trees.plan.product_files.length, counts: sec.entryCounts(m, rs, staticEntries),
        static_entries: staticEntries, static_files: staticFiles, api_guess: apiGuess, drift, sync_gate: rs.filter(sec.syncGate).map((r) => r.index),
      },
    };
  } finally {
    exec?.cleanup?.();
    rmSync(tmp, { recursive: true, force: true });
  }
}
export type CatchRecord = Awaited<ReturnType<typeof scoreSession>>;

/** The analysis row of one catch record. */
export function rowOf(c: CatchRecord): Row {
  if (!c.model || !c.arm) pfFail("E_PF_INPUT", c.unit + ": the catch record names no model or arm");
  const ex = "exposure" in c ? c.exposure : null;
  const sc = "secondaries" in c ? c.secondaries : null;
  const s = (x: number | null): Score => (x === null ? null : x ? 1 : 0);
  const entries = ("entries" in c ? c.entries : []) as EntryResult[];
  const overhead = entries.flatMap((e) => e.runs).filter((x) => typeof x.call_ms === "number" && typeof x.rebuild_ms === "number").map((x) => x.call_ms! - x.wall_ms + x.rebuild_ms!).sort((a, b) => a - b);
  const mid = Math.floor(overhead.length / 2);
  return {
    unit: c.unit, repo: c.repo, model: c.model!, arm: c.arm!, stratum: c.stratum, score: s(c.score), gap: c.gap, no_static: s(c.readings.no_static), no_api_guess: s(c.readings.no_api_guess), compile_rerun: s(c.readings.compile_rerun), loaded: !!ex?.loaded, checker: !!ex?.checker, breaks: sc?.breaks ? sc.breaks.length : null, breaks_unmeasured: !!sc?.breaks_unmeasured,
    entries: entries.length, unreached: entries.filter((e) => e.outcome === "unreached").length, timeout_only: entries.filter((e) => e.runs.some((x) => x.tree === "parent") && e.runs.filter((x) => x.tree === "parent").every((x) => x.timed_out)).length,
    reservation_bound: c.in_flight?.reservation_bound ?? 0, subagents: c.in_flight?.subagents ?? 0, subagent_cap_refused: c.in_flight?.subagent_cap_refused ?? 0,
    ceiling_hit: "ceiling_hit" in c ? !!c.ceiling_hit : false, timeout_s: "timeout_s" in c ? c.timeout_s : null, overhead_ms: overhead.length ? (overhead.length % 2 ? overhead[mid]! : (overhead[mid - 1]! + overhead[mid]!) / 2) : null,
  };
}

/** Breaks in Docker: the unit's commands three times on T with the fix's tests (the oracle's base patches) applied. A
 *  patch that does not apply on T (git apply --check fails) is skipped and named. The session's breaks are not measured,
 *  and unmeasured says why, when a patch that passed the check then fails to apply, or when a run stops, builds nothing
 *  or reports no stable test after a patch was skipped. */
export function dockerBreaks(unitDir: string, image: string, mode: Mode, treeVol: (repo: string, t: string, vol: string) => void) {
  return (repo: string, t: string, u: SmUnit): sec.BreaksRuns => {
    const vol = runName("pf-breaks");
    treeVol(repo, t, vol);
    const stable = u.oracle?.stable ?? [];
    const skipped = new Set<string>();
    let unmeasured: string | null = null;
    try {
      const runs = [1, 2, 3].map((n) => {
        const copy = vol + "-" + n;
        copyVolume(image, vol, copy, mode);
        try {
          const skip: string[] = [];
          for (const [name, body] of basePatches(unitDir)) {
            if (runBash({ kind: "docker", image, volume: copy, repoDir: u.repo_dir, name: runName("apply-check") }, 'cd "$1" && git apply --check --binary --whitespace=nowarn "$2/p"', { p: body }).status !== 0) {
              skip.push(name);
              skipped.add(name);
            } else if (applyPatches(image, copy, u.repo_dir, [[name, body]], mode)) {
              unmeasured ??= "run " + n + " stopped at the " + name + " step: it passed git apply --check, then failed to apply";
              return null;
            }
          }
          const rule: RebuildRule = u.oracle?.rebuild_rule?.applies ? "applies" : "exempt";
          const r = runTests({ image, volume: copy, repoDir: u.repo_dir, workDir: u.work_dir, commands: u.commands, mode, label: u.id + "-breaks" + n, rule });
          const res = r.stopped ? null : parseRun(r, readFileSync(join(unitDir, "parser.py"), "utf8"), u.id + "-breaks" + n);
          const nothing = r.built_nothing ?? r.infra;
          if (skip.length && (!res || nothing || !stable.some((id) => id in res))) unmeasured ??= "run " + n + (!res ? " stopped" : nothing ? " built nothing (" + nothing + ")" : " reported no stable test") + " after skipping " + skip.join(", ");
          return res;
        } finally {
          dropVolume(copy);
        }
      });
      return { runs, skipped: [...skipped], unmeasured };
    } finally {
      dropVolume(vol);
    }
  };
}

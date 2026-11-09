// Copyright (c) 2026 Garry Tan. MIT License.
// The hidden-test count, a dry-run check on the oracle (the implicit state machines prereg, section 3 and section 7 step 3).
// cargo stops at the first test target that fails, so once the fix's in-source tests (fix-tests.patch) fail on a base
// tree, the targets cargo would have run after them (doctests, later test binaries) never report. For each eligible unit
// that scores through in-source tests, this runs the unit's own commands twice on its prepared base tree: once with
// test.patch alone and once with test.patch and fix-tests.patch. An id that passed in the first run and is absent from the
// second is hidden by an early stop; each is a Rust doctest or another test target. It also reads each frozen test
// command for --no-fail-fast or an equivalent. It never changes a test command.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { docker } from "../../real-outcome/task/docker.ts";
import { WINDOW_START, type Candidate, type MlRow } from "./source.ts";
import { oneRun, prepare, pull, type Pacer } from "./oracle.ts";
import { screen } from "./screen.ts";
import { dropVolume, LIMIT_MS, passed, type Mode } from "./testrun.ts";
import { readUnit, saveUnit, writeUnit } from "./unit.ts";

/** libtest's doctest id: "<file>.rs - <item> (line N)", the item optional, sometimes followed by " - compile" or similar. */
export const isDoctest = (id: string): boolean => /^\S.*\.rs - (?:.+ )?\(line \d+\)(?: - .+)?$/.test(id);

/** Ids that passed in the first run and are absent from the second, split into doctests and other test targets. */
export function hiddenIds(first: Record<string, string>, second: Record<string, string>): { doctest: string[]; other: string[] } {
  const ids = Object.keys(first).filter((id) => passed(first, id) && !(id in second)).sort();
  return { doctest: ids.filter(isDoctest), other: ids.filter((id) => !isDoctest(id)) };
}

const RUNNER = /\bcargo\s+(?:\+\S+\s+)?(?:nextest\s+run|xtask\s+test|test)\b|\.\/mach\s+test-unit\b/g;
const ONE_TARGET = /(?:^|\s)(?:--lib|--doc|--test\s+\S+|--bin\s+\S+|--example\s+\S+|--bench\s+\S+)(?=\s|$)/g;
const MANY_TARGETS = /(?:^|\s)(?:--tests|--bins|--examples|--benches|--all-targets|--workspace|--all)(?=\s|$)/;

/** Whether a frozen test command runs every test target even when one fails: every runner invocation carries
 *  --no-fail-fast before libtest's own "--" (how "flag"), or there are several invocations, each of exactly one target, none
 *  joined to the next by && (how "per_target"; the run script runs each listed command on its own). runners counts the
 *  cargo test, cargo nextest run, cargo xtask test and mach test-unit invocations; a command with none is not a cargo run. */
export function noFailFast(cmds: string[]): { no_fail_fast: boolean; how: "flag" | "per_target" | null; runners: number } {
  const inv: { opts: string; joined: boolean }[] = [];
  for (const c of cmds) {
    const ms = [...c.matchAll(RUNNER)];
    ms.forEach((m, k) => {
      const rest = c.slice(m.index!, k + 1 < ms.length ? ms[k + 1]!.index : c.length);
      const opts = rest.split(/;|&&|\|\||\||\n/)[0]!.split(/\s--(?:\s|$)/)[0]!;
      inv.push({ opts, joined: k + 1 < ms.length && rest.includes("&&") });
    });
    if (ms.length && /\bset\s+-e\b/.test(c)) inv.forEach((x) => (x.joined = true));
  }
  if (!inv.length) return { no_fail_fast: false, how: null, runners: 0 };
  if (inv.every((x) => /(?:^|\s)--no-fail-fast(?=\s|$)/.test(x.opts))) return { no_fail_fast: true, how: "flag", runners: inv.length };
  const single = (o: string) => [...o.matchAll(ONE_TARGET)].length === 1 && !MANY_TARGETS.test(o) && [...o.matchAll(/(?:^|\s)(?:-p|--package)\s+\S+/g)].length <= 1;
  if (inv.length > 1 && inv.every((x) => single(x.opts) && !x.joined)) return { no_fail_fast: true, how: "per_target", runners: inv.length };
  return { no_fail_fast: false, how: null, runners: inv.length };
}

export interface HiddenRun { wall_ms: number; exit: number; stopped: boolean; ids: number; passed: number }
export interface HiddenRecord {
  schema: "sm-hidden.v1"; id: string; month: string; in_window: boolean; hidden_doctests: number; hidden_other: number;
  hidden: { doctest: string[]; other: string[] }; no_fail_fast: boolean; how: "flag" | "per_target" | null;
  /** first: test.patch alone; second: test.patch and fix-tests.patch. */
  runs: { first: HiddenRun; second: HiddenRun } | null;
  drop: { code: string; reason: string } | null;
}

type Counts = { units: number; measured: number; dropped: number; with_hidden_doctests: number; with_hidden_other: number; with_any_hidden: number; hidden_doctest_ids: number; hidden_other_ids: number; no_fail_fast: number };
export function summarize(recs: HiddenRecord[]): { overall: Counts; window: Counts } {
  const count = (rs: HiddenRecord[]): Counts => {
    const m = rs.filter((r) => !r.drop);
    return {
      units: rs.length, measured: m.length, dropped: rs.length - m.length, with_hidden_doctests: m.filter((r) => r.hidden_doctests > 0).length,
      with_hidden_other: m.filter((r) => r.hidden_other > 0).length, with_any_hidden: m.filter((r) => r.hidden_doctests + r.hidden_other > 0).length,
      hidden_doctest_ids: m.reduce((a, r) => a + r.hidden_doctests, 0), hidden_other_ids: m.reduce((a, r) => a + r.hidden_other, 0), no_fail_fast: rs.filter((r) => r.no_fail_fast).length,
    };
  };
  return { overall: count(recs), window: count(recs.filter((r) => r.in_window)) };
}

const inWindow = (c: Candidate) => c.created_at >= WINDOW_START;

/** The screen's eligible units whose fix has in-source test hunks (the units that score through in-source tests). */
export function inSourceUnits(cands: Candidate[]): Candidate[] {
  const el = new Set(screen(cands).eligible.map((e) => e.id));
  return cands.filter((c) => el.has(c.id) && !!c.split && "test_hunks" in c.split && c.split.test_hunks > 0).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The static reading over every eligible unit: the frozen test command read by noFailFast, per language group. */
export function staticCounts(cands: Candidate[], cmds: (id: string) => string[]) {
  const el = new Set(screen(cands).eligible.map((e) => e.id));
  const group = (cs: Candidate[]) => {
    const r = cs.map((c) => noFailFast(cmds(c.id)));
    return { units: cs.length, cargo_runs: r.filter((x) => x.runners > 0).length, no_fail_fast: r.filter((x) => x.no_fail_fast).length, flag: r.filter((x) => x.how === "flag").length, per_target: r.filter((x) => x.how === "per_target").length, literal_flag: cs.filter((c) => cmds(c.id).some((x) => x.includes("--no-fail-fast"))).length };
  };
  const e = cands.filter((c) => el.has(c.id));
  const both = (cs: Candidate[]) => ({ overall: group(cs), window: group(cs.filter(inWindow)) });
  return { all_eligible: both(e), rust_eligible: both(e.filter((c) => c.lang === "rust")), in_source: both(inSourceUnits(cands)) };
}

/** One unit: convert (if needed), pull (paced), prepare its tree in its own volume, the two runs, then the volume and, when
 *  this call pulled it, the image are removed. Every failure is a drop with its reason, never a hidden count. */
export async function hiddenUnit(o: { cand: Candidate; row: () => MlRow; units: string; pacer: Pacer; mode?: Mode; limitMs?: number }): Promise<HiddenRecord> {
  const c = o.cand, dir = join(o.units, c.id);
  const nff = noFailFast(o.row().test_cmds);
  const rec: HiddenRecord = { schema: "sm-hidden.v1", id: c.id, month: c.month, in_window: inWindow(c), hidden_doctests: 0, hidden_other: 0, hidden: { doctest: [], other: [] }, no_fail_fast: nff.no_fail_fast, how: nff.how, runs: null, drop: null };
  const drop = (e: unknown) => ({ ...rec, drop: { code: ((e as Error).message.match(/^(E_[A-Z_]+)/) ?? [])[1] ?? "E_SM_INFRA_GAP", reason: (e as Error).message.slice(0, 400) } });
  let pulled: string | null = null;
  const volume = "sm-hidden-" + c.id.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  try {
    if (!existsSync(dir)) writeUnit(dir, c, o.row());
    const u = readUnit(dir);
    const had = docker(["image", "inspect", u.image.ref], { timeoutMs: 30_000 }).status === 0;
    u.image.image_id = await pull(u.image.ref, o.pacer);
    if (!had) pulled = u.image.image_id;
    prepare(u, u.image.image_id, readFileSync(join(dir, "fix.patch"), "utf8"), true, dir, volume);
    saveUnit(dir, u);
    if (!u.split?.in_source_tests) throw new Error("E_SM_INELIGIBLE the split on the prepared tree found no in-source test hunk");
    const run = (n: 1 | 2) => oneRun(dir, u, volume, u.image.image_id!, "base", n, o.mode ?? "hardened", o.limitMs ?? LIMIT_MS, n === 2);
    const view = (r: ReturnType<typeof run>): HiddenRun => ({ wall_ms: r.run.wall_ms, exit: r.run.exit, stopped: r.run.stopped, ids: r.parsed ? Object.keys(r.parsed).length : 0, passed: r.parsed ? Object.keys(r.parsed).filter((id) => passed(r.parsed!, id)).length : 0 });
    const a = run(1), b = run(2);
    rec.runs = { first: view(a), second: view(b) };
    for (const [r, n] of [[a, "first"], [b, "second"]] as const) {
      if (r.run.stopped) return { ...rec, drop: { code: "E_SM_SLOW_TEST", reason: "the " + n + " run passed " + (o.limitMs ?? LIMIT_MS) + " ms" } };
      if (r.run.exit === -1) return { ...rec, drop: { code: "E_SM_APPLY_FAILED", reason: "the " + n + " run's patches did not apply on the prepared tree" } };
      if (!r.parsed || !Object.keys(r.parsed).length) return { ...rec, drop: { code: "E_SM_PARSER", reason: "the " + n + " run's log parsed to no test id (exit " + r.run.exit + ")" } };
    }
    rec.hidden = hiddenIds(a.parsed!, b.parsed!);
    return { ...rec, hidden_doctests: rec.hidden.doctest.length, hidden_other: rec.hidden.other.length };
  } catch (e) {
    return drop(e);
  } finally {
    dropVolume(volume);
    if (pulled) docker(["image", "rm", pulled], { timeoutMs: 300_000 });
  }
}

/** hidden.md: the counts and one line per unit. */
export function hiddenMarkdown(recs: HiddenRecord[], st: ReturnType<typeof staticCounts>): string {
  const s = summarize(recs);
  const row = (k: string, c: Counts) => "| " + k + " | " + [c.units, c.measured, c.dropped, c.with_hidden_doctests, c.with_hidden_other, c.with_any_hidden, c.hidden_doctest_ids, c.hidden_other_ids, c.no_fail_fast].join(" | ") + " |";
  const srow = (k: string, g: ReturnType<typeof staticCounts>["all_eligible"]["overall"]) => "| " + k + " | " + [g.units, g.cargo_runs, g.no_fail_fast, g.flag, g.per_target, g.literal_flag].join(" | ") + " |";
  return [
    "# Hidden tests: in-source units where an early stop hides tests", "",
    "Two runs of each unit's own commands on its prepared base tree: test.patch alone, then test.patch and fix-tests.patch. An id that passed in the first run and is absent from the second is hidden.", "",
    "| group | units | measured | dropped | with hidden doctests | with hidden other targets | with any hidden | hidden doctest ids | hidden other ids | no-fail-fast or equivalent |",
    "|---|---|---|---|---|---|---|---|---|---|", row("overall", s.overall), row("in window", s.window), "",
    "## Static reading of the frozen test commands", "",
    "| group | units | cargo runs | no-fail-fast or equivalent | flag | per target | literal --no-fail-fast anywhere |", "|---|---|---|---|---|---|---|",
    srow("all eligible, overall", st.all_eligible.overall), srow("all eligible, in window", st.all_eligible.window),
    srow("eligible Rust, overall", st.rust_eligible.overall), srow("eligible Rust, in window", st.rust_eligible.window),
    srow("in-source Rust, overall", st.in_source.overall), srow("in-source Rust, in window", st.in_source.window), "",
    "## Per unit", "", "| unit | month | in window | hidden doctests | hidden other | no-fail-fast | first run ids | second run ids | drop |", "|---|---|---|---|---|---|---|---|---|",
    ...recs.map((r) => "| " + [r.id, r.month, r.in_window ? "yes" : "no", r.drop ? "" : r.hidden_doctests, r.drop ? "" : r.hidden_other, r.no_fail_fast ? r.how : "no", r.runs?.first.ids ?? "", r.runs?.second.ids ?? "", r.drop ? r.drop.code + ": " + r.drop.reason.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160) : ""].join(" | ") + " |"),
    "",
  ].join("\n");
}

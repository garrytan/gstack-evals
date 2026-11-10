// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 9's secondaries, keyless and descriptive. The functions read the runner's entry results, T's files and
// the run logs; nothing here changes the primary score.
import { decideDrift, namedIds } from "../statemachines/drift.ts";
import { SOURCE_EXT, type Lang } from "../statemachines/langs.ts";
import { passed } from "../statemachines/testrun.ts";
import { runsChecker } from "./exposure.ts";
import { stems, tokens, type ManifestRead } from "./manifest.ts";
import type { EntryResult, RunRec, TreeName } from "./runner.ts";
import { git } from "./trees.ts";

const runsOn = (r: EntryResult, t: TreeName) => r.runs.filter((x) => x.tree === t);
export const failedParent3 = (r: EntryResult): boolean => { const p = runsOn(r, "parent"); return p.length === 3 && p.every((x) => !x.pass); };
export const firstFixFailure = (r: EntryResult): RunRec | undefined => runsOn(r, "fix").find((x) => !x.pass && !x.rebuild_failed);
export const redOnParent = (rs: EntryResult[]): boolean => rs.some(failedParent3);
/** An entry whose command runs a model checker, red on all three parent runs and on its first fix run. */
export const modelOnlyRed = (rs: EntryResult[]): number[] => rs.filter((r) => runsChecker(r.command) && failedParent3(r) && runsOn(r, "fix")[0]?.pass === false).map((r) => r.index);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Aimed: a new or edited file in T names the path or basename of a file the fix changed. */
export function aimed(tFiles: { path: string; text: string }[], fixFiles: string[]): boolean {
  const res = fixFiles.flatMap((p) => [p, p.split("/").pop()!]).map((n) => new RegExp("(^|[^\\w.-])" + esc(n) + "($|[^\\w-])"));
  return tFiles.some((f) => res.some((r) => r.test(f.text)));
}

/** Breaks: stable ids that fail (do not pass) in two or more of three runs on T with the fix's tests applied. */
export function decideBreaks(stable: string[], runs: (Record<string, string> | null)[]): string[] {
  return stable.filter((id) => runs.filter((r) => !r || !passed(r, id)).length >= 2);
}

export const GREP_CMD = /^(grep|egrep|fgrep|rg|sed|awk|gawk)$/;
/** New test files of T that open a product source path as text: a quoted string whose last path segment is the basename
 *  of a non-test source file of T, extension included. */
export function staticTextFiles(newTests: { path: string; text: string }[], productBasenames: ReadonlySet<string>): string[] {
  return newTests.filter((f) => [...f.text.matchAll(/["'\x60]([^"'\x60\n]{1,300})["'\x60]/g)].some((m) => productBasenames.has(m[1]!.split(/[\\/]/).pop()!))).map((f) => f.path);
}
/** A static-text entry reads source with grep, rg, sed or awk, or names a static-text test file by path, basename or stem.
 *  Go runs a test file through its package, so for Go a path word naming the file's package dir (./pkg/ or pkg) or a
 *  ./pkg/... pattern above it also counts. */
export function isStaticEntry(cmd: string, staticFiles: string[], lang?: Lang): boolean {
  const t = tokens(cmd);
  if (cmd.split(/[\s;|&()]+/).some((w) => GREP_CMD.test(w.split("/").pop() ?? ""))) return true;
  const names = new Set(staticFiles.flatMap((p) => { const b = p.split("/").pop()!; return [p, b, b.replace(/\.[^.]*$/, ""), b.replace(/\..*$/, "")]; }));
  if (t.some((x) => names.has(x))) return true;
  if (lang !== "go") return false;
  const dirs = staticFiles.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "."));
  return cmd.split(/[\s;|&()'"=]+/).filter((w) => w.includes("/") || w === ".").some((w) => {
    const rec = /(^|\/)\.\.\.$/.test(w);
    const d = (rec ? w.replace(/\/?\.\.\.$/, "") : w).replace(/^\.\//, "").replace(/\/+$/, "") || ".";
    return dirs.some((x) => x === d || (rec && (d === "." || x.startsWith(d + "/"))));
  });
}

/** Which of ids occur as whole words in the source files of a commit (git grep on the host scoring repo). */
export function occursIn(repo: string, lang: Lang, commit: string, ids: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const r = git(repo, ["grep", "-l", "-w", "-F", "-e", id, commit, "--"], { ok: [0, 1] });
    if (r.stdout.split("\n").some((l) => SOURCE_EXT[lang].test(l.slice(commit.length + 1)))) out.add(id);
  }
  return out;
}

/** Drift (the state machines detector): a fix-run failure names an identifier present on the parent and absent on the fix. */
export function drift(repo: string, lang: Lang, parent: string, fix: string, r: EntryResult): string[] {
  const f = firstFixFailure(r);
  if (!f) return [];
  const named = namedIds(lang, f.log).map((x) => x.id);
  return decideDrift(true, named, occursIn(repo, lang, parent, named), occursIn(repo, lang, fix, named)).ids;
}
/** API guess (drift reversed): a catching entry's parent failures name an identifier absent on the parent and present on the fix. */
export function apiGuess(repo: string, lang: Lang, parent: string, fix: string, r: EntryResult): string[] {
  if (r.outcome !== "catch") return [];
  const named = [...new Set(runsOn(r, "parent").flatMap((x) => namedIds(lang, x.log).map((n) => n.id)))];
  return decideDrift(true, named, occursIn(repo, lang, fix, named), occursIn(repo, lang, parent, named)).ids;
}

/** Sync gate: a fix-run failure from a stale-sync message or a git diff or git status check. */
export const SYNC_GATE: readonly RegExp[] = [/\bstale\b/i, /out[ -]of[ -]sync/i, /not in sync/i, /\bre-?sync\b/i, /\bsync (check|gate)\b/i, /git diff --(exit-code|quiet)/];
export function syncGate(r: EntryResult): boolean {
  const f = firstFixFailure(r);
  return !!f && (SYNC_GATE.some((x) => x.test(f.log)) || /\bgit\s+(diff|status)\b/.test(r.command));
}

/** The compile unit of a path: Go's package dir, the Rust crate (nearest Cargo.toml) or the Maven or Gradle module
 *  (nearest pom.xml or build.gradle). Other languages have none. */
export function compileUnit(lang: Lang, path: string, tPaths: ReadonlySet<string>): string | null {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (lang === "go") return dir;
  const marks = lang === "rust" ? ["Cargo.toml"] : lang === "java" ? ["pom.xml", "build.gradle", "build.gradle.kts"] : null;
  if (!marks) return null;
  for (let d = dir; ; d = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : "") {
    if (marks.some((m) => tPaths.has(d ? d + "/" + m : m))) return d;
    if (!d) return null;
  }
}

/** Compile-blocked: the entry's first fix-run failure has an error line (a line holding "error", or the line after it,
 *  where rustc prints its location; for Go also a compiler line, file.go:line:col:, or a [build failed] line) naming an
 *  agent-added file the entry does not name. Returns the agent-added files of that file's compile unit to drop for the rerun (the entry's own files stay), or
 *  null when the entry is not compile-blocked. */
export function compileBlocked(lang: Lang, r: EntryResult, agentAdded: string[], tPaths: ReadonlySet<string>): string[] | null {
  const f = firstFixFailure(r);
  if (!f || !failedParent3(r)) return null;
  const t = new Set(tokens(r.command));
  const named = (p: string) => t.has(p) || stems(p).some((s) => t.has(s));
  const lines = f.log.split("\n");
  const isErr = (l: string) => /error/i.test(l) || (lang === "go" && (/\.go:\d+:\d+: /.test(l) || l.includes("[build failed]")));
  const errLines = lines.flatMap((l, i) => (isErr(l) ? [l, lines[i + 1] ?? ""] : []));
  const blocking = agentAdded.filter((p) => !named(p) && errLines.some((l) => l.includes(p) || new RegExp("(^|[^\\w.-])" + esc(p.split("/").pop()!) + "\\b").test(l)));
  const units = new Set(blocking.map((p) => compileUnit(lang, p, tPaths)).filter((u): u is string => u !== null));
  if (!units.size) return null;
  return agentAdded.filter((p) => !named(p) && units.has(compileUnit(lang, p, tPaths) ?? "\0"));
}

export interface EntryCounts { listed: number; counted: number; skipped: number; inline: number; names_nothing: number; beyond_cap: number; run: number; unreached: number; not_runnable: number; timeouts: number; static_text: number; catching: number; catch_share: number | null; rebuild_failed: Record<TreeName, number> }
export function entryCounts(m: ManifestRead, rs: EntryResult[], staticEntries: number[]): EntryCounts {
  const runs = rs.flatMap((r) => r.runs);
  const catching = rs.filter((r) => r.outcome === "catch").length;
  const rebuild_failed = { parent: 0, fix: 0, neutral: 0 } as Record<TreeName, number>;
  for (const x of runs) if (x.rebuild_failed) rebuild_failed[x.tree]++;
  return {
    listed: m.listed, counted: m.run.length + m.beyond_cap.length, skipped: m.skipped.length, inline: m.inline.length, names_nothing: m.names_nothing.length, beyond_cap: m.beyond_cap.length,
    run: rs.filter((r) => r.runs.length).length, unreached: rs.filter((r) => r.outcome === "unreached").length,
    not_runnable: rs.filter((r) => r.runs.some((x) => x.exit === 126 || x.exit === 127)).length, timeouts: rs.filter((r) => r.runs.some((x) => x.timed_out)).length,
    static_text: staticEntries.length, catching, catch_share: m.listed ? catching / m.listed : null, rebuild_failed,
  };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// B1's exposure detector (preregistration section 6): did a session follow the Prove-It steps? It reads Lane B's SDK log
// through the harness mechanics scorer's reader (toTranscript), so it sees the same tool calls and results that run scored.
// The test-first logic is the head-to-head's repaired agent-skills bug-unit detector: a test file written, a failing test
// run seen at or after that write and before the first source edit, a background run seen where its output is read, and a
// compiler's error count read as a failing result. B1 adds two things. The source edit is the first write, by Write, Edit or
// a Bash command (gstack's vendored shell-write parser, which the harness mechanics scorer also uses), to a file the
// session's final patch modifies, so a scratch script is never the fix. And the steps end with the test passing: a passing
// run that names the test, seen after the first source edit. Every source edit made only through Bash is counted, and the
// head-to-head's Write-and-Edit-only reading is kept beside the primary as a sensitivity line.
import { posix } from "node:path";
import { showsFailure, showsOutcome, toTranscript } from "../harness-mechanics/score.ts";
import type { TranscriptEvent } from "../harness-mechanics/vendor/gstack/lib/skill-contract.ts";
import { shellCommands, writeTargets } from "../harness-mechanics/vendor/gstack/lib/shell-writes.ts";
import type { Rec } from "../../quick/laneb/l1/probes.ts";

/** A test file by its path: the head-to-head's frozen rule (lanes/outcome-skills/h2h/sessions/exposure.ts TEST_PATH). */
export const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|testing|e2e)\/|[._-](test|spec|tests)\.[A-Za-z0-9]+$|_test\.go$|(^|\/)test_[^/]*\.[A-Za-z0-9]+$|Tests?\.(java|kt|cs|scala)$|(^|\/)src\/test\//;
/** A Bash result that shows a failing test run, or a compiler's error count: the head-to-head's repaired rule. */
export const FAILING = /\b(FAIL|FAILED|failing|failures?|AssertionError|panicked|assertion failed)\b|Exit code [1-9]|\b[1-9]\d* errors? (and \d+ warnings? )?generated\b/;
/** Files that are never the fix: docs, data and config by extension. */
export const NOT_SOURCE = /\.(md|rst|txt|json|ya?ml|toml|lock|cfg|ini)$/i;
/** Claude Code's notice for a Bash run sent to the background: its id and the file its output goes to. */
const BACKGROUND = /background (?:with ID: |\(ID: )([\w-]+)[\s\S]*?Output is being written to: (\S+?)\.?(?:\s|$)/;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** An in-place edit or an inline script that opens a file to write (the head-to-head's repaired rule): the command is read
 *  as writing every file it names, so a write the shell-write parser can't resolve (a path held in a loop variable) still counts. */
const EDITS = /\b(?:sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i|\bopen\([^)]*,\s*['"][wa+]|\.write_text\(|\bwriteFileSync\(/;
/** A path-like word: a name with an extension. */
const PATHLIKE = /[^\s'"`=(),;&|<>{}[\]]+\.[A-Za-z0-9]+(?![\w.])/g;

type Use = Extract<TranscriptEvent, { kind: "tool_use" }> & { at: number; ok: boolean; result: string };
export type Write = { at: number; path: string; via: "tool" | "bash" };
export type Run = { at: number; ok: boolean; result: string; command: string; cwd: string };
export interface Detection {
  /** The primary: test written, failing run before the first source edit, passing run after it. */
  followed: boolean;
  /** The same rule with only Write and Edit seen as writes (the head-to-head's known limit), for the sensitivity line. */
  followed_tool_only: boolean;
  test_before_source: boolean;
  failing_before_source: boolean;
  passing_after_source: boolean;
  /** The patch modifies at least one source file. */
  source_changed: boolean;
  /** Every write to the patch's source files came through Bash. */
  bash_only_source: boolean;
  /** The patch modifies source files and no write to one was seen. */
  source_write_unseen: boolean;
  /** Bash runs sent to the background and never read. */
  unread_background: number;
  test_file: string | null;
  fix_files: string[];
}

/** The existing files a unified diff modifies: a/ and b/ both named, so added and deleted files are left out. */
export function modifiedFiles(patch: string): string[] {
  const out: string[] = [];
  let from: string | null = null;
  for (const line of patch.split("\n")) {
    if (line.startsWith("--- ")) from = line.slice(4).trim();
    else if (line.startsWith("+++ ") && from !== null) {
      const to = line.slice(4).trim();
      if (from !== "/dev/null" && to !== "/dev/null") out.push(to.replace(/^b\//, ""));
      from = null;
    }
  }
  return [...new Set(out)];
}

function uses(ev: TranscriptEvent[]): Use[] {
  const results = new Map<string, { text: string; error: boolean }>();
  for (const e of ev) if (e.kind === "tool_result") results.set(e.id, { text: e.text, error: e.isError });
  return ev.flatMap((e, at) => {
    if (e.kind !== "tool_use") return [];
    const r = results.get(e.id);
    return [{ ...e, at, ok: !!r && !r.error, result: r?.text ?? "" }];
  });
}

/** Every file each tool call writes, absolute: Write and Edit by their path, Bash by gstack's shell-write parser and, for an
 *  in-place edit or inline write, every file the command names. */
function writesOf(us: Use[], root: string): Write[] {
  const out: Write[] = [];
  const named = (u: Use, cmd: string) => { if (EDITS.test(cmd)) for (const m of cmd.matchAll(PATHLIKE)) out.push({ at: u.at, path: posix.resolve(u.cwd ?? root, m[0]), via: "bash" }); };
  for (const u of us) {
    if (WRITE_TOOLS.has(u.name)) {
      const p = u.input.file_path ?? u.input.notebook_path;
      if (typeof p === "string") out.push({ at: u.at, path: posix.resolve(root, p), via: "tool" });
    } else if (u.name === "Bash" && typeof u.input.command === "string") {
      for (const c of shellCommands(u.input.command, u.cwd ?? root)) {
        const w = writeTargets(c, "/");
        if (w) for (const f of w.files) out.push({ at: u.at, path: posix.resolve("/", f), via: "bash" });
      }
      named(u, u.input.command);
    }
  }
  return out;
}

/** Each Bash run's result where the session saw it: a background run is seen where its output is read (a Read of its
 *  output file, or TaskOutput or BashOutput naming its id), never at its launch. */
function runsOf(us: Use[], root: string): { runs: Run[]; unread: number } {
  let unread = 0;
  const runs = us.filter((u) => u.name === "Bash" && typeof u.input.command === "string").flatMap((b): Run[] => {
    const bg = BACKGROUND.exec(b.result);
    const command = String(b.input.command), cwd = b.cwd ?? root;
    if (!bg) return [{ at: b.at, ok: b.ok, result: b.result, command, cwd }];
    const [, id, file] = bg;
    const reads = us.filter((u) => u.at > b.at && ((u.name === "Read" && u.input.file_path === file) || ((u.name === "TaskOutput" || u.name === "BashOutput") && Object.values(u.input ?? {}).includes(id)))).map((u) => ({ at: u.at, ok: true, result: u.result, command, cwd }));
    if (!reads.length) unread++;
    return reads;
  });
  return { runs, unread };
}

const RUNNER = /^(?:pytest|py\.test|tox|nox)$/;
const MODULE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/;
/** Whether a runner's path argument selects a test file: a path to the file or to a directory above it, or a dotted module
 *  name (unittest's tests.test_calc, or tests.test_calc.AddTest.test_add) for the file or a test inside it. */
function selects(arg: string, cwd: string, test: string): boolean {
  const dir = posix.resolve(cwd, arg.split("::")[0]!).replace(/\/+$/, "");
  if (test === dir || test.startsWith(dir + "/")) return true;
  if (!MODULE.test(arg) || /\.py$/.test(arg)) return false;
  const mod = posix.resolve(cwd, arg.replace(/\./g, "/")), file = test.replace(/\.py$/, "");
  return file === mod || mod.startsWith(file + "/") || test.startsWith(mod + "/");
}
/** A run covers a test file when its command or output names the file, when it starts a test runner (pytest, python -m
 *  pytest or unittest, tox, nox) whose path argument selects the file, or when it starts one with no path argument, which
 *  runs the whole suite or a -k selection of it. */
function covers(r: Run, tests: string[]): boolean {
  if (tests.some((t) => r.command.includes(posix.basename(t)) || r.result.includes(posix.basename(t)))) return true;
  for (const c of shellCommands(r.command, r.cwd)) {
    const w = c.words.map((x) => posix.basename(x));
    const at = w.findIndex((x, i) => RUNNER.test(x) || (/^python[\d.]*$/.test(x) && c.words[i + 1] === "-m" && /^(?:pytest|unittest)$/.test(c.words[i + 2] ?? "")));
    if (at < 0) continue;
    const args = c.words.slice(at + 1).filter((x) => !x.startsWith("-") && /[/.]/.test(x) && !/^(?:pytest|unittest)$/.test(x));
    if (!args.length) return true;
    if (args.some((a) => tests.some((t) => selects(a, c.cwd ?? r.cwd, t)))) return true;
  }
  return false;
}
const failing = (r: Run) => r.result !== "" && (!r.ok || FAILING.test(r.result) || showsFailure(r.result));
const passing = (r: Run) => r.ok && showsOutcome(r.result) && !showsFailure(r.result) && !FAILING.test(r.result);

function read(ws: Write[], runs: Run[], fix: Set<string>) {
  const source = ws.find((w) => fix.has(w.path));
  const tests = ws.filter((w) => TEST_PATH.test(w.path) && !NOT_SOURCE.test(w.path) && !fix.has(w.path) && (!source || w.at < source.at));
  const test = tests[0];
  const before = test && source ? runs.find((r) => r.at >= test.at && r.at < source.at && failing(r) && covers(r, tests.filter((t) => t.at <= r.at).map((t) => t.path))) : undefined;
  const after = test && source ? runs.find((r) => r.at > source.at && passing(r) && covers(r, tests.map((t) => t.path))) : undefined;
  return { source, test, before, after, followed: !!(test && source && before && after) };
}

/** B1's detection for one session: its SDK records, its final patch and the repository root (the session's cwd). */
export function detect(recs: Rec[], patch: string, rootIn?: string): Detection {
  const t = toTranscript(recs);
  const root = rootIn ?? t.cwd ?? "/testbed";
  const us = uses(t.events);
  const fixList = modifiedFiles(patch).filter((f) => !TEST_PATH.test(f) && !NOT_SOURCE.test(f)).map((f) => posix.resolve(root, f));
  const fix = new Set(fixList);
  const ws = writesOf(us, root);
  const { runs, unread } = runsOf(us, root);
  const all = read(ws, runs, fix);
  const tool = read(ws.filter((w) => w.via === "tool"), runs, fix);
  const fixWrites = ws.filter((w) => fix.has(w.path));
  return {
    followed: all.followed,
    followed_tool_only: tool.followed,
    test_before_source: !!(all.test && all.source),
    failing_before_source: !!all.before,
    passing_after_source: !!all.after,
    source_changed: fix.size > 0,
    bash_only_source: fixWrites.length > 0 && fixWrites.every((w) => w.via === "bash"),
    source_write_unseen: fix.size > 0 && fixWrites.length === 0,
    unread_background: unread,
    test_file: all.test?.path ?? null,
    fix_files: fixList,
  };
}

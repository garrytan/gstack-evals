// Copyright (c) 2026 Garry Tan. MIT License.
// B1's exposure detector (preregistration section 6): did a session follow the Prove-It steps? It reads Lane B's SDK log
// through the harness mechanics scorer's reader (toTranscript), so it sees the same tool calls and results that run scored.
// The test-first logic starts from the head-to-head's repaired agent-skills bug-unit detector: a test file written, a
// failing test run seen at or after that write and before the first source edit, and a background run seen where its output
// is read. B1 adds three things. The source edit is the first write, by Write, Edit or a Bash command (gstack's vendored
// shell-write parser, which the harness mechanics scorer also uses), to a file the session's final patch modifies, so a
// scratch script is never the fix. The steps end with the test passing: a passing run that selects the test, seen after the
// first source edit. And each run must be a run of the test: a failing run's result reports the test failing, so a grep,
// lint or cat that errors is none. Every source edit made only through Bash is counted, and the head-to-head's
// Write-and-Edit-only reading is kept beside the primary as a sensitivity line.
// B1 also reads four Bash write forms the vendored parser leaves out (cp, mv, install or rsync onto a file, dd of=, a
// patch file git apply or patch reads when the session wrote that file, and a shell script the session wrote), and counts
// every Bash call that writes somewhere no parser can name (unresolved_writes), so the report can score those sessions
// both ways. A relative write after a cd the parser can't resolve is one of those. Inside one Bash call, writes and runs
// are ordered by the place of their commands (sequence).
import { posix } from "node:path";
import { showsFailure, showsOutcome, toTranscript } from "../harness-mechanics/score.ts";
import type { TranscriptEvent } from "../harness-mechanics/vendor/gstack/lib/skill-contract.ts";
import { shellCommands, writeTargets, type ShellCommand } from "../harness-mechanics/vendor/gstack/lib/shell-writes.ts";
import type { Rec } from "../../quick/laneb/l1/probes.ts";

/** A test file by its path: the head-to-head's frozen rule (lanes/outcome-skills/h2h/sessions/exposure.ts TEST_PATH) less its
 *  spec and specs folders. Every task here is a Python repository, where a spec folder is a source package (hdmf's
 *  src/hdmf/spec/, met in the hand-check); a spec file by name (x_spec.rb, x.spec.ts) is still a test. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|testing|e2e)\/|[._-](test|spec|tests)\.[A-Za-z0-9]+$|_test\.go$|(^|\/)test_[^/]*\.[A-Za-z0-9]+$|Tests?\.(java|kt|cs|scala)$|(^|\/)src\/test\//;
/** A spec or specs folder. Its files read as source unless named as a spec, so a helper, fixture or factory there does too;
 *  a session that writes one is flagged (spec_folder_write) and scored both ways, rather than given a second path rule. */
const SPEC_FOLDER = /(^|\/)specs?\//;
/** Files that are never the fix: docs, data and config by extension. */
export const NOT_SOURCE = /\.(md|rst|txt|json|ya?ml|toml|lock|cfg|ini)$/i;
/** Claude Code's notice for a Bash run sent to the background: its id and the file its output goes to. */
const BACKGROUND = /background (?:with ID: |\(ID: )([\w-]+)[\s\S]*?Output is being written to: (\S+?)\.?(?:\s|$)/;
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** An in-place edit or an inline script that opens a file to write (the head-to-head's repaired rule). A Bash call with such a
 *  write that no parser can name is read as writing every file it names, so a path held in a loop variable still counts. */
const EDITS = /\b(?:sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i|\bopen\([^)]*,\s*['"][wa+]|\.write_text\(|\bwriteFileSync\(/;
/** A path-like word: a name with an extension. */
const PATHLIKE = /[^\s'"`=(),;&|<>{}[\]]+\.[A-Za-z0-9]+(?![\w.])/g;
/** A word no parser can name a file from: a variable, a command substitution, a glob, or find's {}. */
const OPEN_WORD = /[$`*?]|^\{\}$/;
/** Stands in for a folder a cd left unknown (cd "$DIR", cd ~, cd -): a relative write there is resolved under it, at a depth
 *  past every .. the command and the session's scripts hold, so it stays under it and is a write no parser can name. */
const UNKNOWN_CWD = "/\0cwd";
const WRITE_REDIRECT = /^(?:\d*>>?|\d*>\||&>>?)$/;
const IN_PLACE = /\b(?:g?sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i|--in-place/;
const WRITER = /\b(?:g?sed|perl)\s+(?:-\S+\s+)*-[a-zA-Z]*i|--in-place|(?:^|\s)(?:tee|cp|mv|install|dd|truncate)\s/;
const INTERPRETER = /^(?:python[\d.]*|node|nodejs|ruby|bun|deno)$/;
/** An inline script's write calls, each with the path expression it names first. */
const WRITE_CALLS = [
  /\bopen\(\s*([^,()]+(?:\([^()]*\))?)\s*,\s*(?:mode\s*=\s*)?[rbuRBU]{0,2}(['"])[^'"]*[wax+][^'"]*\2/g,
  /([\w.]+(?:\(\s*[^()]*\))?)\s*\.\s*(?:write_text|write_bytes)\s*\(/g,
  /([\w.]+(?:\(\s*[^()]*\))?)\s*\.\s*open\(\s*(?:mode\s*=\s*)?['"][^'"]*[wax+]/g,
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|Bun\.write|Deno\.writeTextFile(?:Sync)?|Deno\.writeFile(?:Sync)?|File\.write|File\.binwrite)\s*\(\s*([^,]+?)\s*,/g,
];
const LITERAL = /^(?:(?:pathlib\.)?Path\(\s*)?[rbuRBU]{0,2}(['"])[^'"{]*\1\s*\)?$/;
/** The file a write call's path expression names, or null when no parser can tell: a string literal or Path(literal), or a
 *  name every binding of which in the script is a plain assignment of one of those, read at the last such assignment
 *  before the call (p = 'a.py' ... open(p, 'w') ... p = 'b.py' ... open(p, 'w')). A name also bound any other way (a for
 *  loop, a with ... as, a tuple target, a parameter, a computed value) names no single file. Bindings are looked for with
 *  every string's contents blanked, so code inside a string the script writes into a file is not read as its own. */
function targetOf(expr: string, code: string, at: number): string | null {
  const e = expr.trim();
  if (LITERAL.test(e)) return /(['"])([^'"{]*)\1/.exec(e)![2]!;
  if (!/^[A-Za-z_$][\w$]*$/.test(e)) return null;
  const n = e.replace(/\$/g, "\\$"), w = "(?<![\\w$.])" + n + "(?![\\w$])";
  const assign = new RegExp("(?:^|;)\\s*(?:const\\s+|let\\s+|var\\s+)?(?:[\\w$]+\\s*,\\s*)*" + w + "(?:\\s*,\\s*[\\w$]+)*\\s*(?:[-+*/%]|//)?=(?!=)", "gm");
  const literal = new RegExp("(?:^|;)\\s*(?:const\\s+|let\\s+|var\\s+)?" + n + "\\s*=\\s*(?:(?:pathlib\\.)?Path\\(\\s*)?[rbuRBU]{0,2}(['\"])([^'\"{\\n]*)\\1\\s*\\)?\\s*(?:[;#]|$)", "my");
  const bare = code.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (s) => s[0] + s.slice(1, -1).replace(/[^\n]/g, " ") + s.at(-1));
  if (new RegExp("\\bfor\\s+[^\\n]*?" + w + "[^\\n]*?\\s(?:in|of)\\b|\\bas\\s+" + w + "|" + w + "\\s*:=|\\b(?:def|function)\\s*[\\w$]*\\s*\\([^)]*" + w, "m").test(bare)) return null;
  let last: string | null = null;
  for (const m of bare.matchAll(assign)) {
    literal.lastIndex = m.index!;
    const lit = literal.exec(code);
    if (!lit) return null;
    if (m.index! < at) last = lit[2]!;
  }
  return last;
}
/** The code an interpreter command runs, when the session shows it: an inline -c or -e script, its stdin, or a file the
 *  session wrote (the vendored parser's rule, with the session's own files). */
function codeOf(c: ShellCommand, scripts: Map<string, string>): string[] {
  const args = c.words.slice(1), file = (f: string) => scripts.get(posix.resolve(c.cwd ?? "/", f)) ?? "";
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (/^(?:-c|-e|--eval|eval)$/.test(a)) return [args[k + 1] ?? ""];
    if (/^(?:-m|-W|-X|-r|--require|-I)$/.test(a)) { if (a === "-m") return []; k++; continue; }
    if (!a.startsWith("-")) return [file(a)];
    if (a === "-") break;
  }
  return [...c.heredocs, ...c.redirects.filter((r) => r.op === "<<<").map((r) => r.target), ...c.redirects.filter((r) => r.op === "<").map((r) => file(r.target))];
}
/** Whether a word no parser can name still can't be a file in the session's tree: its fixed part ends in a folder outside
 *  the tree (a scratch folder such as /tmp), so it is no repository write. A folder a cd left unknown may be in the tree. */
function outsideTree(word: string, cwd: string, root: string): boolean {
  const fixed = word.split(/[$`*?]/)[0]!, slash = fixed.lastIndexOf("/");
  const dir = slash < 0 ? cwd : posix.resolve(cwd, fixed.slice(0, slash + 1));
  if (dir === UNKNOWN_CWD || dir.startsWith(UNKNOWN_CWD + "/")) return false;
  return !(dir === root || dir.startsWith(root + "/") || root.startsWith(dir.replace(/\/$/, "") + "/"));
}
const diffTargets = (diff: string) => [...diff.matchAll(/^\+\+\+ (\S+)/gm)].map((m) => m[1]!.replace(/^[ab]\//, "")).filter((f) => f !== "/dev/null");

/** The files one simple command writes, absolute, and whether it also writes somewhere in the session's tree (root) that no
 *  parser can name (open). Reads, output to stdout, /dev paths and fd duplications are never writes. A relative write in a
 *  folder a cd left unknown is read under UNKNOWN_CWD and counted as open, never resolved against /. */
function commandWrites(c: ShellCommand, scripts: Map<string, string>, root: string, depth = 0): { files: string[]; open: boolean } {
  const cwd = c.cwd ?? UNKNOWN_CWD + "/\0".repeat(1 + [c.text, ...c.heredocs, ...scripts.values()].reduce((n, x) => n + x.split("..").length - 1, 0)), files: string[] = [];
  let open = false;
  const unnamed = (w: string) => OPEN_WORD.test(w) && !outsideTree(w, cwd, root);
  const name = posix.basename(c.words[0] ?? ""), args = c.words.slice(1);
  let dir = cwd;
  if (name === "git") { const at = args.indexOf("-C"); if (at >= 0 && args[at + 1]) dir = posix.resolve(cwd, args[at + 1]!); }
  if (name === "patch") { const at = args.findIndex((a) => a === "-d" || a === "--directory"); if (at >= 0 && args[at + 1]) dir = posix.resolve(cwd, args[at + 1]!); }
  for (const f of writeTargets({ ...c, cwd }, "/", scripts)?.files ?? []) {
    const p = posix.resolve("/", f);
    if (p === dir || p === cwd) {
      const sub = args.indexOf("apply"), patches = name === "git" && sub >= 0 ? args.slice(sub + 1).filter((a) => !a.startsWith("-")) : [];
      if (name === "patch") { const at = args.findIndex((a) => a === "-i" || a === "--input"); if (at >= 0 && args[at + 1]) patches.push(args[at + 1]!); patches.push(...c.redirects.filter((r) => r.op === "<").map((r) => r.target)); }
      const known = patches.map((x) => scripts.get(posix.resolve(cwd, x))).filter((x): x is string => x !== undefined).flatMap(diffTargets);
      if (known.length) files.push(...known.map((x) => posix.resolve(dir, x)));
      else if (!outsideTree(dir + "/", "/", root)) open = true;
    } else if (/[*?]/.test(p)) open ||= !outsideTree(p, "/", root);
    else files.push(p);
  }
  for (const r of c.redirects) if (WRITE_REDIRECT.test(r.op) && unnamed(r.target)) open = true;
  if (name === "tee" && args.some((a) => !a.startsWith("-") && unnamed(a))) open = true;
  if ((name === "sed" || name === "gsed" || name === "perl") && IN_PLACE.test(c.text)) {
    const targets: string[] = [];
    let script = false;
    for (let k = 0; k < args.length; k++) {
      const a = args[k]!;
      if (/^(?:-e|--expression|-f|--file)$/.test(a) || (name === "perl" && /^-[a-zA-Z]*e$/.test(a))) { script = true; k++; }
      else if (a !== "" && !a.startsWith("-")) targets.push(a);
    }
    if (!script) targets.shift();
    if (!targets.length || targets.some(unnamed)) open = true;
  }
  if (name === "find" && args.some((a) => a === "-exec" || a === "-execdir") && WRITER.test(" " + args.join(" ") + " ") && !outsideTree((args.find((a) => !a.startsWith("-")) ?? ".") + "/", cwd, root)) open = true;
  if (name === "xargs" && WRITER.test(" " + args.join(" ") + " ") && !outsideTree("./", cwd, root)) open = true;
  if (INTERPRETER.test(name)) for (const code of codeOf({ ...c, cwd }, scripts)) for (const re of WRITE_CALLS) for (const m of code.matchAll(re)) {
    const target = targetOf(m[1]!, code, m.index!);
    if (target === null) open = true;
    else files.push(posix.resolve(cwd, target));
  }
  if (/^(?:cp|mv|install|rsync)$/.test(name)) {
    const pos: string[] = [];
    let target: string | null = null;
    for (let k = 0; k < args.length; k++) {
      const a = args[k]!;
      if (a === "-t" || a === "--target-directory") target = args[++k] ?? null;
      else if (a.startsWith("--target-directory=")) target = a.slice(19);
      else if (/^(?:-S|--suffix|-m|--mode|-o|--owner|-g|--group)$/.test(a)) k++;
      else if (!a.startsWith("-")) pos.push(a);
    }
    const dest = target ?? (pos.length > 1 ? pos.pop()! : null);
    if (dest !== null) {
      if (OPEN_WORD.test(dest)) open ||= unnamed(dest);
      else { files.push(posix.resolve(cwd, dest)); for (const src of pos) if (!OPEN_WORD.test(src)) files.push(posix.resolve(cwd, dest, posix.basename(src))); }
    }
  }
  if (name === "dd") for (const a of args) if (a.startsWith("of=")) { if (OPEN_WORD.test(a.slice(3))) open ||= unnamed(a.slice(3)); else files.push(posix.resolve(cwd, a.slice(3))); }
  if (/^(?:ba|da|z)?sh$/.test(name) && args[0] && !args[0].startsWith("-") && depth < 3) {
    const body = scripts.get(posix.resolve(cwd, args[0]));
    if (body !== undefined) for (const inner of shellCommands(body, cwd)) { const w = commandWrites(inner, scripts, root, depth + 1); files.push(...w.files); open ||= w.open; }
  }
  const named = files.filter((f) => f !== UNKNOWN_CWD && !f.startsWith(UNKNOWN_CWD + "/"));
  return { files: named, open: open || named.length < files.length };
}

type Use = Extract<TranscriptEvent, { kind: "tool_use" }> & { at: number; ok: boolean; result: string };
/** A write, with the places in its tool call of the commands that wrote it (ks): a Bash write's simple command, none for a
 *  Bash call read as writing every file it names, and 0 for a tool's own write. */
export type Write = { at: number; path: string; via: "tool" | "bash"; ks: number[] };
/** A run: a Bash call and its result, or a background run where its output is read (later). */
export type Run = { at: number; ok: boolean; result: string; command: string; cwd: string; later: boolean };
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
  /** Bash calls that write somewhere no parser can name: a target held in a variable, a command substitution or a glob, an
   *  in-place edit or a patch with no visible target, find or xargs running a writer, or an inline script's write call whose
   *  path is not a literal. Such a write counts as no write; the report scores these sessions both ways. */
  unresolved_writes: number;
  /** The session writes, or its patch changes, a file under a spec or specs folder that is not named as a spec (a
   *  spec_helper, spec/support/*, a fixture or factory, or a source package named spec). The report scores these sessions
   *  both ways, with the writes no parser can name. */
  spec_folder_write: boolean;
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

/** The folder each Bash call runs in. Claude Code keeps its shell's working directory from one Bash call to the next, so a
 *  call starts where the last call's cd left it, unless Claude Code reports that it reset the shell (a cd out of the project).
 *  A cd the parser can't resolve leaves the folder unknown until a cd to a full path or a reset: a relative write there is a
 *  write no parser can name, and runs are still read in the last folder known. */
type Cwd = { cwd: string; known: boolean };
function bashCwds(us: Use[], root: string): Map<number, Cwd> {
  const out = new Map<number, Cwd>();
  let here = root, known = true;
  for (const u of us) {
    if (u.name !== "Bash" || typeof u.input.command !== "string") continue;
    out.set(u.at, { cwd: here, known });
    const end: string | null = /Shell cwd was reset to (\/\S*)/.exec(u.result)?.[1] ?? shellCommands(u.input.command + "\n:", known ? here : null).at(-1)?.cwd ?? null;
    known = end !== null;
    if (end !== null) here = end;
  }
  return out;
}

/** Every file each tool call writes, absolute: Write and Edit by their path, Bash by gstack's shell-write parser with B1's
 *  additions (commandWrites) and, for a call with a write no parser can name, every file the command names (the
 *  head-to-head's rule for an in-place edit or inline write, kept for the calls that need it). The session's own
 *  files (a Write's content, a heredoc sent to a file) are kept so a script or patch it runs later can be read. unresolved
 *  counts the Bash calls with a write no parser can name. */
function writesOf(us: Use[], root: string, cwds: Map<number, Cwd>): { writes: Write[]; unresolved: number } {
  const out: Write[] = [], scripts = new Map<string, string>();
  let unresolved = 0;
  const named = (u: Use, cmd: string) => { if (EDITS.test(cmd)) for (const m of cmd.matchAll(PATHLIKE)) out.push({ at: u.at, path: posix.resolve(cwds.get(u.at)?.cwd ?? root, m[0]), via: "bash", ks: [] }); };
  for (const u of us) {
    if (WRITE_TOOLS.has(u.name)) {
      const p = u.input.file_path ?? u.input.notebook_path;
      if (typeof p === "string") out.push({ at: u.at, path: posix.resolve(root, p), via: "tool", ks: [0] });
      if (u.name === "Write" && typeof p === "string" && typeof u.input.content === "string") scripts.set(posix.resolve(root, p), u.input.content);
    } else if (u.name === "Bash" && typeof u.input.command === "string") {
      let open = false;
      const start = cwds.get(u.at);
      for (const [k, c] of shellCommands(u.input.command, !start ? root : start.known ? start.cwd : null).entries()) {
        const w = commandWrites(c, scripts, root);
        for (const f of new Set(w.files)) out.push({ at: u.at, path: f, via: "bash", ks: [k] });
        open ||= w.open;
        for (const r of c.redirects) if (WRITE_REDIRECT.test(r.op) && c.cwd !== null && !OPEN_WORD.test(r.target)) scripts.set(posix.resolve(c.cwd, r.target), c.heredocs.join("\n"));
      }
      if (open) { unresolved++; named(u, u.input.command); }
    }
  }
  return { writes: out, unresolved };
}

/** Each Bash run's result where the session saw it: a background run is seen where its output is read (a Read of its
 *  output file, a later Bash command that names the file, such as a tail or rg of it, or TaskOutput or BashOutput naming
 *  its id), never at its launch, with a Read's line numbers taken off its output. */
function runsOf(us: Use[], root: string, cwds: Map<number, Cwd>): { runs: Run[]; unread: number } {
  let unread = 0;
  const runs = us.filter((u) => u.name === "Bash" && typeof u.input.command === "string").flatMap((b): Run[] => {
    const bg = BACKGROUND.exec(b.result);
    const command = String(b.input.command), cwd = cwds.get(b.at)?.cwd ?? root;
    if (!bg) return [{ at: b.at, ok: b.ok, result: b.result, command, cwd, later: false }];
    const [, id, file] = bg;
    const reads = us.filter((u) => u.at > b.at && ((u.name === "Read" && u.input.file_path === file) || (u.name === "Bash" && typeof u.input.command === "string" && u.input.command.includes(file!)) || ((u.name === "TaskOutput" || u.name === "BashOutput") && Object.values(u.input ?? {}).includes(id)))).map((u) => ({ at: u.at, ok: true, result: resultLines(u.result).join("\n"), command, cwd, later: true }));
    if (!reads.length) unread++;
    return reads;
  });
  return { runs, unread };
}

const RUNNER = /^(?:pytest|py\.test|tox|nox)$/;
const MODULE = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/;
/** A module a runner may be given: a dotted name, or one name (unittest's test_calc, run from the test's folder). */
const MODULE_ARG = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/;
/** pytest and unittest options whose value is the next word. */
const VALUED = new Set(["-k", "-m", "-c", "-p", "-o", "-W", "-n", "--numprocesses", "--ignore", "--ignore-glob", "--deselect", "--rootdir", "--junitxml", "--basetemp", "--confcutdir", "--cov", "--cov-config", "--cov-report", "--maxfail", "--timeout", "--tb", "--durations", "--capture", "--import-mode", "--log-level", "--log-cli-level", "--dist", "--reruns", "--count"]);
/** Whether a runner's path argument selects a test file: a path to the file or to a directory above it, or a dotted module
 *  name (unittest's tests.test_calc, or tests.test_calc.AddTest.test_add) for the file or a test inside it. */
function selects(arg: string, cwd: string, test: string): boolean {
  const dir = posix.resolve(cwd, arg.split("::")[0]!).replace(/\/+$/, "");
  if (test === dir || test.startsWith(dir + "/")) return true;
  if (!MODULE_ARG.test(arg) || /\.py$/.test(arg)) return false;
  const mod = posix.resolve(cwd, arg.replace(/\./g, "/")), file = test.replace(/\.py$/, "");
  return file === mod || mod.startsWith(file + "/") || test.startsWith(mod + "/");
}
/** Whether a word names a test file itself: a path to it, a test in it (path::node), or its dotted module or a test in it. */
function namesFileArg(arg: string, cwd: string, test: string): boolean {
  if (posix.resolve(cwd, arg.split("::")[0]!) === test) return true;
  if (!MODULE.test(arg) || /\.py$/.test(arg)) return false;
  const mod = posix.resolve(cwd, arg.replace(/\./g, "/")), file = test.replace(/\.py$/, "");
  return file === mod || mod.startsWith(file + "/");
}
/** Whether a path a runner printed (relative to its root folder, or absolute) is the test file. */
const isFile = (p: string, test: string) => { const q = p.split("::")[0]!.replace(/^\.\//, ""); return q !== "" && (test === q || test.endsWith("/" + q)); };
/** Whether a dotted name unittest printed is in the test file's module. */
function isModule(mod: string, test: string): boolean {
  const parts = mod.split("."), at = parts.lastIndexOf(posix.basename(test).replace(/\.py$/, ""));
  if (at < 0) return false;
  const path = parts.slice(0, at + 1).join("/"), file = test.replace(/\.py$/, "");
  return file === path || file.endsWith("/" + path);
}
/** The lines of a result as the runner printed them: colour codes and a reader's line numbers (Read's 12 and a tab, rg's or
 *  grep's 12:) taken off. */
const resultLines = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").split("\n").map((l) => l.replace(/^\s*\d+(?:\t|→|:(?=\S))/, ""));
/** A line where a test runner reports a failed test, and the file or module it names: pytest's FAILED or ERROR line (short
 *  summary or verbose), its collection error header, its progress line with an F or E, or unittest's FAIL: or ERROR: line. */
function failedTest(l: string): { path?: string; mod?: string } | null {
  const m = /^(?:FAILED|ERROR) ([^\s(]\S*)/.exec(l) ?? /^(\S+?::\S+) (?:FAILED|ERROR)\b/.exec(l) ?? /ERROR collecting (\S+)/.exec(l) ?? /^(\S+) [.sxX]*[FE][.sxXFE]*(?:\s+\[\s*\d+%\])?$/.exec(l);
  if (m) return { path: m[1]! };
  const u = /^(?:FAIL|ERROR): \S+ \(([\w.]+)\)/.exec(l);
  return u && !u[1]!.startsWith("__main__.") ? { mod: u[1]! } : null;
}
/** A traceback line in a file: pytest's file:line: frame line (bare, with in frame, or with the error), or, in a result
 *  that holds a raised exception's traceback, Python's File "...", line N, in frame (a printed stack alone is no failure). */
const traceFile = (l: string, raised: boolean) => (/^(\S+?):\d+:(?:\s*$| in \S+$| [A-Za-z_][\w.]*(?:Error|Exception|Failed)\b)/.exec(l) ?? (raised ? /^\s*File "([^"]+)", line \d+, in /.exec(l) : null))?.[1] ?? null;
const failedHere = (f: { path?: string; mod?: string }, test: string) => (f.path !== undefined && isFile(f.path, test)) || (f.mod !== undefined && isModule(f.mod, test));
/** Whether a run starts the test file itself: a simple command that is a test runner, an interpreter or a script (./x,
 *  x.sh, x.py) and has the file, a test in it or its module as an argument. A git add or cat of the file starts nothing. */
const startsFile = (c: ShellCommand, cwd: string, test: string) => (runnerAt(c) >= 0 || INTERPRETER.test(posix.basename(c.words[0] ?? "")) || /\.(?:py|sh)$|^\.{0,2}\//.test(c.words[0] ?? "")) && c.words.some((a) => namesFileArg(a, cwd, test));
const runsFile = (r: Run, test: string) => shellCommands(r.command, r.cwd).some((c) => startsFile(c, c.cwd ?? r.cwd, test));
/** A failure a test runner reports without naming the test: a failing count (a pytest summary, unittest's FAILED, a CHECK
 *  FAIL line), pytest's FAILURES or ERRORS section, or its progress line with an F or E. Claude Code cuts a long result in
 *  the middle, which can drop every line that names the test and keep only these. */
const showsRunnerFailure = (s: string) => showsFailure(s) || resultLines(s).some((l) => /^=+ (?:FAILURES|ERRORS) =+$|^[.sxX]*[FE][.sxXFE]*(?:\s+\[\s*\d+%\])?$/.test(l.trim()));
/** The failing run of a test, from any command: a runner's line reporting a failed test in the file, or a traceback through
 *  the file; or, when the output reports no failed test by name, a runner's unnamed failure from a run that starts the file
 *  itself. A grep, lint or cat that errors shows none of these, and a suite run that fails only on another test names that
 *  other test. */
function failing(r: Run, tests: string[]): boolean {
  const ls = resultLines(r.result), failed = ls.map(failedTest).filter((f) => f !== null), raised = r.result.includes("Traceback (most recent call last):");
  return tests.some((t) => failed.some((f) => failedHere(f, t)) || ls.some((l) => { const p = traceFile(l, raised); return p !== null && isFile(p, t); }) || (!failed.length && showsRunnerFailure(r.result) && runsFile(r, t)));
}
/** Where a simple command starts a test runner: pytest, py.test, tox or nox, or pytest or unittest run as a module (python
 *  -m pytest, coverage run -m unittest), found anywhere in its words so uv run, poetry run and coverage count. */
const runnerAt = (c: ShellCommand) => c.words.findIndex((x, i) => RUNNER.test(posix.basename(x)) || (x === "unittest" && c.words[i - 1] === "-m"));
/** Whether a run selects the test file: a run that starts the file itself; a test runner whose path argument is a folder
 *  above it, or that has no path argument (the whole suite; a -k or -m filter is not read); an inline script that names the file and calls pytest.main or unittest.main; or output naming the file on a passing line
 *  (pytest's PASSED or progress line, unittest's ok line). */
function selectsTest(r: Run, test: string): boolean {
  if (shellCommands(r.command, r.cwd).some((c) => commandSelects(c, c.cwd ?? r.cwd, test))) return true;
  return resultLines(r.result).some((l) => {
    const m = /^(\S+?)::\S+ (?:PASSED|XPASS)\b/.exec(l) ?? /^(\S+) [.sxX]+(?:\s+\[\s*\d+%\])?$/.exec(l);
    if (m) return isFile(m[1]!, test);
    const u = /^\S+ \(([\w.]+)\) \.\.\. ok$/.exec(l);
    return !!u && isModule(u[1]!, test);
  });
}
/** Whether one command of a run selects the test file by its words: it starts the file, it is a test runner one of whose
 *  operands (every word that is no option or option value; for tox and nox, the words after --) is the file, a test in it, its
 *  module or a folder above it, or that has none, or it is an inline script that names the file and calls
 *  pytest.main or unittest.main. */
function commandSelects(c: ShellCommand, cwd: string, test: string): boolean {
  if (startsFile(c, cwd, test)) return true;
  const at = runnerAt(c);
  if (at >= 0) {
    const runner = posix.basename(c.words[at]!), unit = runner === "unittest", args: string[] = [];
    let rest = c.words.slice(at + 1);
    if (runner === "tox" || runner === "nox") rest = rest.includes("--") ? rest.slice(rest.indexOf("--") + 1) : [];
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k]!;
      if (VALUED.has(a) || (unit && /^-[st]$/.test(a))) k++;
      else if (!a.startsWith("-") && !(unit && a === "discover")) args.push(a);
    }
    if (!args.length || args.some((a) => selects(a, cwd, test))) return true;
  }
  const code = INTERPRETER.test(posix.basename(c.words[0] ?? "")) ? codeOf(c, new Map()).join("\n") : "";
  return /\b(?:pytest|unittest)\.main\b/.test(code) && code.includes(posix.basename(test));
}
/** The passing run of a test: a run that succeeds, shows a test outcome with no failing count, reports no failed test in the
 *  session's test files and selects one the failing runs reported failing (covered), so an unrelated green run, or a pass on
 *  another written test, does not count. */
const passing = (r: Run, tests: string[], covered: string[]) => r.ok && showsOutcome(r.result) && !showsFailure(r.result) && !resultLines(r.result).some((l) => { const f = failedTest(l); return f !== null && tests.some((t) => failedHere(f, t)); }) && covered.some((t) => selectsTest(r, t));

type Sequence = { items: { kind: "cmd" | "and" | "or" | "bg"; pipeline: number }[]; at: number[] };
const MARKS = new Map<string, "and" | "or" | "bg">([["__b1_and__", "and"], ["__b1_or__", "or"], ["__b1_bg__", "bg"]]);
/** A Bash call's simple commands in order (at: each one's place among items), with the &&, || and & between them. The
 *  vendored parser drops its operators, so the call is parsed again with each of them made a marker command; inside a quoted
 *  word, a heredoc or a comment a marker stays text. Null when the two parses don't line up, which leaves the call unordered. */
function sequence(command: string): Sequence | null {
  const marked = command.replace(/(?<!\\)&&/g, " ;__b1_and__; ").replace(/(?<!\\)\|\|/g, " ;__b1_or__; ").replace(/(?<![&|<>\\])&(?![&>])/g, " ;__b1_bg__; ");
  const items: Sequence["items"] = [], at: number[] = [];
  for (const c of shellCommands(marked, "/")) {
    const mark = MARKS.get(c.words[0] ?? "");
    if (!mark) at.push(items.length);
    items.push({ kind: mark ?? "cmd", pipeline: c.pipeline });
  }
  return at.length === shellCommands(command, "/").length ? { items, at } : null;
}
/** Whether, in one Bash call, command j can run after command i ended as given (ok: i worked; else i failed). j must come
 *  later, in another pipeline, with no & between them, and bash's &&, || and ; must let it run: a command after || runs only
 *  when what came before failed, so a run after a fix's || gets no order, while one after || true; or || true && keeps it. */
function ordered(s: Sequence, i: number, j: number, ok: boolean): boolean {
  const a = s.at[i], b = s.at[j];
  if (a === undefined || b === undefined || a >= b || s.items[a]!.pipeline === s.items[b]!.pipeline) return false;
  const piped = s.items[a + 1]?.kind === "cmd" && s.items[a + 1]!.pipeline === s.items[a]!.pipeline;
  let may0 = ok || piped, may1 = !ok || piped;
  for (let k = a + 1; k <= b; k++) {
    const it = s.items[k]!, prev = s.items[k - 1]!;
    if (it.kind === "bg") return false;
    if (it.kind !== "cmd" || (prev.kind === "cmd" && prev.pipeline === it.pipeline)) continue;
    const runs = prev.kind === "and" ? may0 : prev.kind === "or" ? may1 : true;
    if (it.pipeline === s.items[b]!.pipeline) return runs;
    if (prev.kind === "and") may1 ||= may0;
    else if (prev.kind === "or") may0 ||= may1;
    else may0 = may1 = true;
  }
  return false;
}

/** The steps in order. One thing comes before another when its tool call is earlier or, in the same Bash call, when one of
 *  its commands is ordered before one of the other's (a failing run as a command that failed). A run's commands are those that select one of the session's tests; a
 *  background run read later has none, so it is never ordered inside the call that reads it. */
function read(ws: Write[], runs: Run[], fix: Set<string>, seqAt: (at: number) => Sequence | null) {
  const first = (a: { at: number; ks: number[] }, b: { at: number; ks: number[] }, ok = true) => {
    if (a.at !== b.at) return a.at < b.at;
    const s = seqAt(a.at);
    return s !== null && a.ks.some((i) => b.ks.some((j) => ordered(s, i, j, ok)));
  };
  const source = ws.find((w) => fix.has(w.path));
  const tests = ws.filter((w) => TEST_PATH.test(w.path) && !NOT_SOURCE.test(w.path) && !fix.has(w.path) && (!source || first(w, source)));
  const test = tests[0], paths = tests.map((t) => t.path);
  const place = (r: Run) => ({ at: r.at, ks: r.later ? [] : shellCommands(r.command, r.cwd).flatMap((c, k) => (paths.some((t) => commandSelects(c, c.cwd ?? r.cwd, t)) ? [k] : [])) });
  const fails = test && source ? runs.flatMap((r) => { const p = place(r); return first(p, source, false) ? tests.filter((t) => first(t, p) && failing(r, [t.path])).map((t) => ({ r, path: t.path })) : []; }) : [];
  const covered = fails.map((f) => f.path), before = fails[0]?.r;
  const passes = (covers: string[]) => (test && source ? runs.find((r) => first(source, place(r)) && passing(r, paths, covers)) : undefined);
  const after = passes(paths), closes = covered.length ? passes(covered) : undefined;
  return { source, test, before, after, followed: !!(test && source && before && closes) };
}

/** B1's detection for one session: its SDK records, its final patch and the repository root (the session's cwd). */
export function detect(recs: Rec[], patch: string, rootIn?: string): Detection {
  const t = toTranscript(recs);
  const root = rootIn ?? t.cwd ?? "/testbed";
  const us = uses(t.events);
  const fixList = modifiedFiles(patch).filter((f) => !TEST_PATH.test(f) && !NOT_SOURCE.test(f)).map((f) => posix.resolve(root, f));
  const fix = new Set(fixList);
  const cwds = bashCwds(us, root);
  const { writes: ws, unresolved } = writesOf(us, root, cwds);
  const { runs, unread } = runsOf(us, root, cwds);
  const bash = new Map(us.flatMap((u) => (u.name === "Bash" && typeof u.input.command === "string" ? [[u.at, u.input.command] as const] : [])));
  const seqs = new Map<number, Sequence | null>();
  const seqAt = (at: number) => { if (!seqs.has(at)) seqs.set(at, bash.has(at) ? sequence(bash.get(at)!) : null); return seqs.get(at) ?? null; };
  const all = read(ws, runs, fix, seqAt);
  const tool = read(ws.filter((w) => w.via === "tool"), runs, fix, seqAt);
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
    unresolved_writes: unresolved,
    spec_folder_write: [...ws.map((w) => w.path), ...modifiedFiles(patch).map((f) => posix.resolve(root, f))].some((p) => SPEC_FOLDER.test(p) && !TEST_PATH.test(p)),
    test_file: all.test?.path ?? null,
    fix_files: fixList,
  };
}

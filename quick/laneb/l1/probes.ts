// L1 probes over one Lane B session's SDK message log (evaluator/sdk-messages.jsonl, written by laneb_agent.py's record
// loop): probe L (a load of /investigate), probe I (a complete /investigate record), the S13 background count, the contract
// hook's block and the no-gstack read audit. Rules: the L1 superseding preregistration (wiki/plans/
// 2026-11-03-geva-254-l1-overhaul-prereg-2000, sections 4 and 6) over #169 sections 7.1, 7.2 and 7.6.
//
// What the log holds (checked with the real Claude Code 2.1.312 under the pinned Agent SDK 0.2.174 against a fake upstream;
// tests/fixtures/l1/cli-*.jsonl are those logs): AssistantMessage blocks are {text} or {id, name, input}; UserMessage blocks
// are {tool_use_id, content, is_error} or {text}; subagent messages arrive inline with no parent id, so their tool calls and
// texts count as the session's. A Skill call's result is "Launching skill: <name>", followed by a UserMessage text
// "Base directory for this skill: <dir>" and the body without its frontmatter. Task system messages keep only their subtype.
// A UserPromptSubmit hook's additionalContext never reaches the log.
//
// Probe L: a Skill call naming investigate whose result is not an error and whose base directory lies in the arm's gstack
// install (never the task checkout: section 4's project-skill rule), or a Read or Bash of an investigate/SKILL.md whose
// non-error result holds the first 200 characters of that arm's own installed SKILL.md, after stripping Read's line numbers.
// A Skill call with no base directory in the log is unresolved: counted, never a load.
//
// Probe I, items 1 to 4 of #169 7.2 with fc#3 settled as section 6 says. Interpretations, stated here so the audit can read
// them: a DEBUG REPORT line is a line whose text, trimmed of non-alphanumeric characters at both ends, is "debug report" in
// any case; labels are read case-insensitively as "Label:" or a table cell "| Label |", and a label whose same-line content is
// empty takes the lines below it up to a blank line or the next label; content counts when it holds a letter or digit; Status
// counts when its content starts with one listed value and names no other (so the template's "DONE | DONE_WITH_CONCERNS |
// BLOCKED" fails); an Edit, Write, MultiEdit or NotebookEdit call is an edit unless its result is an error; tee and redirect
// targets are edits only inside the work tree (the init message's cwd), as the write list says for redirects; python3 and
// path-qualified binaries match the runner list by their base name; reserved words (if, then, do, time and the like) are
// unwrapped like subshells; a Bash exit is non-zero when its result is an error.
//
// S13: the session ended with background work running when, before its first ResultMessage (the end of the log when there is
// none), it launched background work (a Bash call with run_in_background true whose result is not an error, or an Agent or
// Task call whose result reports an async launch) and fewer completion notices (TaskNotificationMessage) arrived than the
// larger of tasks started (TaskStartedMessage) and background launches. A TaskStop of a task yields its notice, so a killed
// task is not running.
import { posix } from "node:path";

export type Block = { text?: unknown; id?: unknown; name?: unknown; input?: any; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
export type Rec = { type?: unknown; subtype?: unknown; content?: unknown; init?: any; result?: unknown };

export const LABELS = ["Symptom", "Root cause", "Fix", "Evidence", "Regression test", "Status"] as const;
export const STATUS_VALUES = ["DONE_WITH_CONCERNS", "DONE", "BLOCKED"] as const;
export const REPORT_WINDOW_LINES = 40;
export const BASE_DIR = "Base directory for this skill: ";
export const CONTRACT_BLOCK = /^Stop hook feedback:[\s\S]*SKILL_CONTRACT_UNMET investigate\b/;

export function parseLog(text: string): Rec[] {
  const out: Rec[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object") out.push(r);
    } catch {}
  }
  return out;
}

const blocks = (r: Rec): Block[] => (Array.isArray(r.content) ? r.content.filter((b): b is Block => !!b && typeof b === "object") : []);
export const resultText = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n") : "";
export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const stripReadNumbers = (s: string) => s.split("\n").map((l) => l.replace(/^\s*\d+(\t|\u2192)/, "")).join("\n");

// ---- shell lines -------------------------------------------------------------------------------------------------------

export type Simple = { words: string[]; redirects: { op: string; target: string }[]; heredocs: string[]; cwd: string | null };

const RESERVED = new Set(["!", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "time", "{", "}"]);
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

type Tok = { kind: "word"; raw: string; value: string } | { kind: "op"; value: string } | { kind: "redir"; op: string } | { kind: "heredoc"; body: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const pendingHeredocs: { delim: string; strip: boolean; idx: number }[] = [];
  let i = 0;
  let raw = "";
  let value = "";
  let inWord = false;
  const flush = () => {
    if (inWord) toks.push({ kind: "word", raw, value });
    raw = "";
    value = "";
    inWord = false;
  };
  const readHeredocs = () => {
    for (const h of pendingHeredocs.splice(0)) {
      const lines: string[] = [];
      while (i < src.length) {
        const end = src.indexOf("\n", i);
        const line = src.slice(i, end < 0 ? src.length : end);
        i = end < 0 ? src.length : end + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
        lines.push(line);
      }
      toks.splice(h.idx, 0, { kind: "heredoc", body: lines.join("\n") });
      for (const p of pendingHeredocs) p.idx++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\\" && i + 1 < src.length) {
      if (src[i + 1] === "\n") { i += 2; continue; }
      raw += c + src[i + 1];
      value += src[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const j = end < 0 ? src.length : end;
      raw += src.slice(i, j + 1);
      value += src.slice(i + 1, j);
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < src.length && '"\\$\x60'.includes(src[j + 1]!)) { v += src[j + 1]; j += 2; continue; }
        v += src[j];
        j++;
      }
      raw += src.slice(i, j + 1);
      value += v;
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === "$" && src[i + 1] === "(") {
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) break;
      }
      raw += src.slice(i, j + 1);
      value += src.slice(i, j + 1);
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === "\x60") {
      const end = src.indexOf("\x60", i + 1);
      const j = end < 0 ? src.length : end;
      raw += src.slice(i, j + 1);
      value += src.slice(i, j + 1);
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === "#" && !inWord) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\n") {
      flush();
      toks.push({ kind: "op", value: "\n" });
      i++;
      readHeredocs();
      continue;
    }
    if (c === " " || c === "\t") { flush(); i++; continue; }
    const rest = src.slice(i);
    const redir = /^(\d*>>|\d*>&|\d*>\||\d*>|&>>|&>|<<<|<<-|<<|<&|<>|<)/.exec(rest);
    if (redir && !(inWord && /^\d/.test(redir[1]!))) {
      flush();
      const op = redir[1]!;
      i += redir[1]!.length;
      if ((op.endsWith("<<") && !op.endsWith("<<<")) || op.endsWith("<<-")) {
        while (src[i] === " " || src[i] === "\t") i++;
        let delim = "";
        const m = /^(['"])(.*?)\1|^([^\s;&|<>()]+)/.exec(src.slice(i));
        if (m) { delim = (m[2] ?? m[3] ?? "").replace(/\\/g, ""); i += m[0].length; }
        pendingHeredocs.push({ delim, strip: op.endsWith("<<-"), idx: toks.length });
        continue;
      }
      if (op.endsWith(">&") || op.endsWith("<&")) {
        const m = /^\s*([0-9-]+)/.exec(src.slice(i));
        if (m) { i += m[0].length; continue; }
      }
      toks.push({ kind: "redir", op });
      continue;
    }
    const op = /^(\|\||&&|\|&|;;|[;|&()])/.exec(rest);
    if (op) {
      flush();
      toks.push({ kind: "op", value: op[1]! });
      i += op[1]!.length;
      continue;
    }
    raw += c;
    value += c;
    inWord = true;
    i++;
  }
  flush();
  readHeredocs();
  return toks;
}

/** The simple commands of a shell line, in order, after cd, env prefixes, reserved words, subshells and sh -c are unwrapped. */
export function simpleCommands(line: string, cwd: string | null = null, depth = 0): Simple[] {
  const out: Simple[] = [];
  let cur: Simple = { words: [], redirects: [], heredocs: [], cwd };
  let here = cwd;
  const end = () => {
    let w = cur.words;
    while (w.length && (RESERVED.has(w[0]!) || ASSIGN.test(w[0]!))) w = w.slice(1);
    if (w[0] === "env") {
      w = w.slice(1);
      while (w.length && (ASSIGN.test(w[0]!) || w[0]!.startsWith("-"))) w = w.slice(["-u", "--unset", "-C", "--chdir"].includes(w[0]!) ? 2 : 1);
    }
    cur.words = w;
    if (w.length || cur.redirects.length) {
      if ((w[0] === "bash" || w[0] === "sh") && w[1] === "-c" && typeof w[2] === "string" && depth < 4) out.push(...simpleCommands(w[2], here, depth + 1));
      else {
        cur.cwd = here;
        out.push(cur);
        if (w[0] === "cd") here = w[1] && !w[1].startsWith("-") ? (here ? posix.resolve(here, w[1]) : posix.isAbsolute(w[1]) ? posix.normalize(w[1]) : null) : here;
      }
    }
    cur = { words: [], redirects: [], heredocs: [], cwd: here };
  };
  const scopes: (string | null)[] = [];
  const toks = tokenize(line);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    if (t.kind === "op") {
      end();
      if (t.value === "(") scopes.push(here);
      else if (t.value === ")" && scopes.length) cur.cwd = here = scopes.pop()!;
    }
    else if (t.kind === "heredoc") cur.heredocs.push(t.body);
    else if (t.kind === "redir") {
      const next = toks[k + 1];
      if (next?.kind === "word") { cur.redirects.push({ op: t.op, target: next.value }); k++; }
    } else cur.words.push(t.value);
  }
  end();
  return out;
}

const base = (w: string) => w.split("/").filter(Boolean).at(-1) ?? w;
const args = (words: string[]) => words.slice(1).filter((a) => !a.startsWith("-"));

/** #169 7.2's frozen test-runner list. */
export function isTestRunner(words: string[]): boolean {
  if (!words.length) return false;
  const cmd = base(words[0]!).replace(/^python\d+(\.\d+)*$/, "python");
  const a = args(words);
  switch (cmd) {
    case "pytest": case "py.test": case "tox": case "nox": case "jest": case "vitest": case "mocha": case "rspec": case "phpunit": case "ctest":
      return true;
    case "python": {
      const m = words.indexOf("-m");
      return m > 0 && (words[m + 1] === "pytest" || words[m + 1] === "unittest");
    }
    case "go": case "cargo": case "dotnet": case "mix": case "swift": case "rake":
      return a[0] === "test";
    case "npm": case "pnpm": case "yarn": case "bun":
      return a[0] === "test" || (a[0] === "run" && a[1] === "test");
    case "npx":
      return a[0] === "jest" || a[0] === "vitest";
    case "mvn":
      return a.some((x) => x === "test" || x === "verify");
    case "gradle": case "gradlew":
      return a.some((x) => x === "test" || x.endsWith(":test"));
    case "bundle":
      return a[0] === "exec" && a[1] === "rspec";
    case "make":
      return a.some((x) => x === "test" || x === "check");
    case "bash": case "sh":
      return !!a[0] && a[0].split("/").some((seg) => seg === "test" || seg === "tests");
  }
  return false;
}

const inTree = (p: string, cwd: string | null, root: string | null): string | null => {
  if (!p || p.startsWith("/dev/") || p.startsWith("&")) return null;
  const abs = posix.isAbsolute(p) ? posix.normalize(p) : cwd ? posix.resolve(cwd, p) : null;
  if (abs === null) return posix.normalize(p);
  if (root && (abs === root || abs.startsWith(root.replace(/\/+$/, "") + "/"))) return abs;
  return root ? null : abs;
};

/** The files a simple command writes under #169 7.2's write list, or null when it is no edit. An edit with no known file is []. */
export function writeTargets(c: Simple, root: string | null): string[] | null {
  const w = c.words;
  const cmd = w.length ? base(w[0]!) : "";
  const files: string[] = [];
  let edit = false;
  for (const r of c.redirects) {
    if (!r.op.includes(">")) continue;
    const t = inTree(r.target, c.cwd, root);
    if (t) { edit = true; files.push(t); }
  }
  if (cmd === "sed" || cmd === "perl") {
    let inPlace = false;
    let script = false;
    const rest: string[] = [];
    for (let k = 1; k < w.length; k++) {
      const a = w[k]!;
      if (a === "-e" || a === "--expression" || a === "-f" || a === "--file") { script = true; k++; continue; }
      if (a.startsWith("--in-place")) { inPlace = true; continue; }
      if (/^-[A-Za-z0-9]/.test(a) && !a.startsWith("--")) {
        const letters = a.slice(1);
        const iAt = letters.indexOf("i");
        if (iAt >= 0 && (cmd === "sed" || !letters.slice(0, iAt).includes("e"))) inPlace = true;
        if (cmd === "perl" && /e$/.test(letters)) { script = true; k++; }
        continue;
      }
      rest.push(a);
    }
    if (inPlace) {
      edit = true;
      files.push(...(script ? rest : rest.slice(1)).map((f) => (c.cwd && !posix.isAbsolute(f) ? posix.resolve(c.cwd, f) : f)));
    }
  } else if (cmd === "tee") {
    for (const f of args(w)) {
      const t = inTree(f, c.cwd, root);
      if (t) { edit = true; files.push(t); }
    }
  } else if (cmd === "patch" || (cmd === "git" && args(w)[0] === "apply")) {
    edit = true;
    for (const h of c.heredocs) for (const m of h.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)) if (m[1] !== "/dev/null") files.push(m[1]!);
    if (cmd === "patch" && args(w)[0]) files.push(args(w)[0]!);
  } else if (cmd === "git") {
    let k = 1;
    while (k < w.length && w[k]!.startsWith("-")) k += w[k] === "-C" || w[k] === "-c" ? 2 : 1;
    if (w[k] === "checkout") {
      const rest = w.slice(k + 1);
      const dd = rest.indexOf("--");
      const paths = dd >= 0 ? rest.slice(dd + 1) : rest.filter((a) => !a.startsWith("-") && /[./]/.test(a));
      if (paths.length) { edit = true; files.push(...paths); }
    }
  }
  return edit ? files : null;
}

// ---- probes --------------------------------------------------------------------------------------------------------------

export type ProbeOptions = {
  /** The arm's gstack install roots, such as /root/.claude/skills/ and /root/.gstack/; empty for the none arm. */
  gstackRoots: string[];
  /** The first 200 characters of the arm's own installed investigate/SKILL.md; null for the none arm. */
  investigatePrefix: string | null;
  /** The agent's HOME: ~ and $HOME in a command expand to it, and the read audit's roots sit under it. */
  home: string;
};

/** The no-gstack read audit's roots: a successful read of a path below one (or of a Capy drive) contaminates a none session. */
export const auditRoots = (home: string) => [home + "/.claude/skills", home + "/.local/share/gstack", home + "/.gstack"];
const DRIVE = /\/\.capy\/drive\//;
/** Commands that never read a file's contents: a path among their words is a mention, unless a word substitutes a command. */
const NO_READ = new Set(["echo", "printf", "cd", "pushd", "popd", "pwd", "mkdir", "touch", "test", "[", "[[", "export", "unset", "type", "which", "command", "hash", "true", "false", ":", "dirname", "basename", "realpath", "readlink", "sleep", "exit"]);
const PATH_SPLIT = /[\s'"=;|&<>()`]+/;
const GREP = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);
const HERE_SKIP = new Set(["grep", "egrep", "fgrep", "rg"]);
const SUBSTITUTES = /\$\(|\x60|<\(/;
const SED_TEXT = /s(.)(?:\\.|(?!\1)[^\\\n])*\1(?:\\.|(?!\1)[^\\\n])*\1|y(.)(?:\\.|(?!\2)[^\\\n])*\2(?:\\.|(?!\2)[^\\\n])*\2|\/(?:\\.|[^/\\\n])*\/|\\(.)(?:\\.|(?!\3)[^\\\n])*\3/g;
/** Whether a pattern or script operand names nothing the command reads: a literal with no substitution and, for sed, no r, R,
 * w, W or e command or flag outside its s and y operands and addresses, and for awk, no getline, system(, pipe or redirect. */
function inert(cmd: string, op: string): boolean {
  if (SUBSTITUTES.test(op)) return false;
  if (cmd === "sed") return !/[rRwWe]/.test(op.replace(SED_TEXT, ""));
  if (cmd !== "awk" && cmd !== "gawk" && cmd !== "mawk") return true;
  return !/getline|system\(|[|<>]/.test(op);
}
/** A grep's words without its patterns, and a sed's or awk's without its script: each inert -e operand, or the first operand
 * when no -e or -f gives one and it is inert, names no file the command reads. An -f file is a read and stays. */
function withoutPattern(words: string[]): string[] {
  const cmd = base(words[0] ?? "");
  const valued = GREP.has(cmd) ? /^-[ABCmdD]$/ : cmd === "sed" ? /^-l$/ : cmd === "awk" || cmd === "gawk" || cmd === "mawk" ? /^-[vF]$/ : null;
  if (!valued) return words;
  const kept: string[] = [];
  let given = false;
  for (let k = 0; k < words.length; k++) {
    const w = words[k]!;
    const joined = /^(-[A-Za-z]*e(?=.)|--(regexp|expression|source)=)/.exec(w);
    if (/^(-[A-Za-z]*e|--regexp|--expression|--source)$/.test(w)) {
      given = true;
      if (!inert(cmd, words[k + 1] ?? "")) kept.push(w, ...words.slice(k + 1, k + 2));
      k++;
    } else if (joined) {
      given = true;
      if (!inert(cmd, w.slice(joined[0].length))) kept.push(w);
    } else kept.push(w);
  }
  if (given || kept.some((w) => /^(-[A-Za-z]*f|--file)/.test(w))) return kept;
  let k = 1;
  while (k < kept.length && kept[k]!.startsWith("-") && kept[k] !== "--") k += valued.test(kept[k]!) ? 2 : 1;
  if (kept[k] === "--") k++;
  return kept.filter((w, i) => i !== k || !inert(cmd, w));
}
/** The paths a Bash line may read: the words of every simple command that can read, its input redirects and heredoc bodies,
 * with a relative word resolved against the directory the line has cd'd to (the work tree at first). */
function bashReadPaths(command: string, cwd: string | null): string[] {
  const out: string[] = [];
  for (const s of simpleCommands(command, cwd)) {
    const words = withoutPattern(s.words);
    const mention = words.length > 0 && NO_READ.has(base(words[0]!)) && !words.some((w) => w.includes("$(") || w.includes("\x60"));
    const texts = [...(mention ? [] : [...words, ...s.heredocs]), ...s.redirects.filter((r) => r.op.includes("<") && !(r.op === "<<<" && HERE_SKIP.has(base(s.words[0] ?? "")) && !SUBSTITUTES.test(r.target))).map((r) => r.target)];
    for (const t of texts)
      for (const w of t.split(PATH_SPLIT)) {
        if (w.startsWith("/")) out.push(w);
        else if (s.cwd && w && !w.startsWith("-") && w !== s.words[0]) out.push(posix.resolve(s.cwd, w));
      }
  }
  return out;
}

export type ProbeI = { complete: boolean; report: boolean; fix_edited: boolean; status: boolean; check_after_edit: boolean; edits: number };
export type Probes = {
  probe_l: { investigate: boolean; gstack_loads: string[]; repo_loads: string[]; unresolved: number };
  probe_i: ProbeI;
  background: { launches: number; started: number; notices: number; at_result: boolean };
  contract_block: boolean;
  audit_hits: string[];
  model_text: boolean;
  turn_cap: boolean;
};

type Call = { pos: number; id: string; name: string; input: any };

const under = (p: string, roots: string[]) => roots.some((r) => p === r.replace(/\/+$/, "") || p.startsWith(r.replace(/\/+$/, "") + "/"));

function reportOk(text: string, edited: string[]): { report: boolean; fix_edited: boolean; status: boolean } {
  const lines = text.split("\n");
  let best = { report: false, fix_edited: false, status: false };
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]!.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").toLowerCase() !== "debug report") continue;
    const win = lines.slice(k + 1, k + 1 + REPORT_WINDOW_LINES);
    const labelAt = (line: string): { label: string; rest: string } | null => {
      for (const label of LABELS) {
        const m = new RegExp("^[\\s>*_\\-|#\x60]*" + label.replace(" ", "\\s+") + "[\\s*_\x60]*(?::|\\|)(.*)$", "i").exec(line);
        if (m) return { label, rest: m[1]! };
      }
      return null;
    };
    const found = new Map<string, string>();
    for (let j = 0; j < win.length; j++) {
      const hit = labelAt(win[j]!);
      if (!hit || found.has(hit.label)) continue;
      let content = hit.rest.replace(/[|*_\x60]+\s*$/, "").replace(/^[\s*_\x60]+/, "").trim();
      if (!/[A-Za-z0-9]/.test(content)) {
        const more: string[] = [];
        for (let n = j + 1; n < win.length && win[n]!.trim() && !labelAt(win[n]!); n++) more.push(win[n]!);
        content = more.join("\n").trim();
      }
      found.set(hit.label, content);
    }
    const report = LABELS.every((l) => /[A-Za-z0-9]/.test(found.get(l) ?? ""));
    const fix = found.get("Fix") ?? "";
    const fixPaths = [...fix.matchAll(/([\w./@+\-]+):(\d+)/g)].map((m) => m[1]!.replace(/^\.\//, "").replace(/^[ab]\//, ""));
    const fixEdited = fixPaths.some((fp) => edited.some((e) => e === fp || e.endsWith("/" + fp) || fp.endsWith("/" + e.replace(/^\.\//, ""))));
    const st = (found.get("Status") ?? "").replace(/^[^A-Za-z]+/, "");
    const named = new Set([...st.matchAll(/(?<![A-Za-z_])(DONE_WITH_CONCERNS|DONE|BLOCKED)(?![A-Za-z_])/gi)].map((m) => m[1]!.toUpperCase()));
    const status = /^(DONE_WITH_CONCERNS|DONE|BLOCKED)(?![A-Za-z_])/i.test(st) && named.size === 1;
    const cand = { report, fix_edited: report && fixEdited, status: report && status };
    if (cand.report && cand.fix_edited && cand.status) return cand;
    if (Number(cand.report) + Number(cand.fix_edited) + Number(cand.status) > Number(best.report) + Number(best.fix_edited) + Number(best.status)) best = cand;
  }
  return best;
}

export function runProbes(recs: Rec[], o: ProbeOptions): Probes {
  const init = recs.find((r) => r.type === "SystemMessage" && r.subtype === "init")?.init ?? {};
  const root: string | null = typeof init.cwd === "string" ? posix.normalize(init.cwd) : null;
  const results = new Map<string, { error: boolean; text: string }>();
  const baseDirs = new Map<string, string>();
  const calls: Call[] = [];
  const texts: { pos: number; text: string }[] = [];
  let pos = 0;
  let firstResult = -1;
  let lastSkill: string | null = null;
  let started = 0, notices = 0, launches = 0;
  let contractBlock = false;
  let modelText = false;
  const bgCalls = new Set<string>();
  const counted = { started: 0, notices: 0, launches: 0 };
  recs.forEach((r, idx) => {
    if (r.type === "AssistantMessage") {
      for (const b of blocks(r)) {
        pos += 1000;
        if (typeof b.name === "string" && typeof b.id === "string") {
          calls.push({ pos, id: b.id, name: b.name, input: b.input ?? {} });
          modelText = true;
          if (b.name === "Bash" && b.input?.run_in_background === true) bgCalls.add(b.id);
          if (b.name === "Agent" || b.name === "Task") bgCalls.add(b.id);
        } else if (typeof b.text === "string") {
          texts.push({ pos, text: b.text });
          if (b.text.trim()) modelText = true;
        }
      }
    } else if (r.type === "UserMessage") {
      for (const b of blocks(r)) {
        if (typeof b.tool_use_id === "string") {
          const text = resultText(b.content);
          results.set(b.tool_use_id, { error: b.is_error === true, text });
          const call = calls.find((c) => c.id === b.tool_use_id);
          if (call?.name === "Skill") lastSkill = call.id;
          if (bgCalls.has(b.tool_use_id) && firstResult < 0 && b.is_error !== true) {
            if (call?.name === "Bash" || /^Async agent launched/.test(text.trim())) launches++;
          }
        } else if (typeof b.text === "string") {
          if (b.text.startsWith(BASE_DIR) && lastSkill && !baseDirs.has(lastSkill)) baseDirs.set(lastSkill, posix.normalize(b.text.slice(BASE_DIR.length).split("\n")[0]!.trim()));
          if (CONTRACT_BLOCK.test(b.text)) contractBlock = true;
        }
      }
      if (typeof r.content === "string" && CONTRACT_BLOCK.test(r.content)) contractBlock = true;
    } else if (firstResult < 0 && r.type === "TaskStartedMessage") started++;
    else if (firstResult < 0 && r.type === "TaskNotificationMessage") notices++;
    else if (r.type === "ResultMessage" && firstResult < 0) {
      firstResult = idx;
      counted.started = started;
      counted.notices = notices;
      counted.launches = launches;
    }
  });
  if (firstResult < 0) Object.assign(counted, { started, notices, launches });

  const prefix = o.investigatePrefix;
  const gstackLoads = new Set<string>();
  const repoLoads = new Set<string>();
  let unresolved = 0;
  let investigate = false;
  const auditHits: string[] = [];
  const roots = auditRoots(o.home);
  const below = (p: string) => DRIVE.test(p) || roots.some((r) => p.startsWith(r + "/") && p.length > r.length + 1);
  const above = (p: string) => roots.some((r) => r === p.replace(/\/+$/, "") || r.startsWith(p.replace(/\/+$/, "") + "/"));
  const expand = (s: string) => s.replace(/(^|[\s='"])(~|\$HOME|\$\{HOME\})(?=\/|$|[\s;&|)'"])/g, "$1" + o.home);
  for (const c of calls) {
    const res = results.get(c.id);
    if (!res || res.error) continue;
    if (c.name === "Skill") {
      const skill = String(c.input.skill ?? c.input.command ?? c.input.name ?? "").replace(/^\//, "");
      const dir = baseDirs.get(c.id);
      if (!dir) { unresolved++; continue; }
      if (under(dir, o.gstackRoots)) {
        gstackLoads.add(skill);
        if (skill === "investigate") investigate = true;
      } else repoLoads.add(skill);
      if (below(dir + "/")) auditHits.push("Skill " + skill + " -> " + dir);
      continue;
    }
    const target = expand(c.name === "Read" ? String(c.input.file_path ?? "") : c.name === "Bash" ? String(c.input.command ?? "") : String(c.input.path ?? c.input.pattern ?? ""));
    if (!target) continue;
    const body = c.name === "Read" ? stripReadNumbers(res.text) : res.text;
    if (prefix && (c.name === "Read" || c.name === "Bash") && /(^|[\s\/'"])investigate\/SKILL\.md\b/.test(target) && body.includes(prefix)) investigate = true;
    if (c.name === "Read" || c.name === "Bash") {
      for (const m of target.matchAll(/(\S*\/\.claude\/skills\/([^/\s"']+)\/SKILL\.md)/g)) if (m[2] !== "gstack" && under(m[1]!.replace(/^['"]/, ""), o.gstackRoots)) gstackLoads.add(m[2]!);
    }
    const paths = c.name === "Bash" ? bashReadPaths(target, root) : [target];
    const hit = paths.find(below) ?? (paths.some(above) ? res.text.split(PATH_SPLIT).find((w) => w.startsWith("/") && below(w)) : undefined);
    if (hit && (c.name !== "Bash" || res.text.trim())) auditHits.push(c.name + " " + hit.slice(0, 200));
  }
  if (investigate) gstackLoads.add("investigate");

  const edits: { pos: number; files: string[] }[] = [];
  const checks: number[] = [];
  const failedBeforeEdit: { pos: number; cmd: string; last: number }[] = [];
  const bashCalls: { pos: number; last: number; cmd: string; error: boolean }[] = [];
  for (const c of calls) {
    const res = results.get(c.id);
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(c.name)) {
      if (res && !res.error) edits.push({ pos: c.pos, files: [String(c.input.file_path ?? c.input.notebook_path ?? "")].filter(Boolean) });
      continue;
    }
    if (c.name !== "Bash" || typeof c.input.command !== "string") continue;
    const cmds = simpleCommands(c.input.command, root);
    cmds.forEach((s, j) => {
      const files = writeTargets(s, root);
      if (files) edits.push({ pos: c.pos + j, files });
      if (isTestRunner(s.words)) checks.push(c.pos + j);
    });
    bashCalls.push({ pos: c.pos, last: c.pos + Math.max(0, cmds.length - 1), cmd: collapse(c.input.command), error: res?.error === true });
  }
  const firstEdit = edits.length ? Math.min(...edits.map((e) => e.pos)) : Infinity;
  const lastEdit = edits.length ? Math.max(...edits.map((e) => e.pos)) : -Infinity;
  for (const b of bashCalls) if (b.error && b.last < firstEdit) failedBeforeEdit.push({ pos: b.pos, cmd: b.cmd, last: b.last });
  const repro = new Set(failedBeforeEdit.map((f) => f.cmd));
  const checkAfter = edits.length > 0 && (checks.some((p) => p > lastEdit) || bashCalls.some((b) => b.pos > lastEdit && repro.has(b.cmd)));
  const edited = [...new Set(edits.flatMap((e) => e.files))];
  let rep = { report: false, fix_edited: false, status: false };
  for (const t of texts) {
    if (t.pos <= lastEdit) continue;
    const r = reportOk(t.text, edited);
    if (Number(r.report) + Number(r.fix_edited) + Number(r.status) > Number(rep.report) + Number(rep.fix_edited) + Number(rep.status)) rep = r;
    if (rep.report && rep.fix_edited && rep.status) break;
  }
  const fixEdited = edits.length > 0 && rep.fix_edited;
  const probeI: ProbeI = { complete: rep.report && fixEdited && rep.status && checkAfter, report: rep.report, fix_edited: fixEdited, status: rep.status, check_after_edit: checkAfter, edits: edits.length };
  const turnCap = recs.some((r) => r.type === "ResultMessage" && r.subtype === "error_max_turns");
  return {
    probe_l: { investigate, gstack_loads: [...gstackLoads].sort(), repo_loads: [...repoLoads].sort(), unresolved },
    probe_i: probeI,
    background: { ...counted, at_result: counted.launches > 0 && counted.notices < Math.max(counted.started, counted.launches) },
    contract_block: contractBlock,
    audit_hits: auditHits,
    model_text: modelText,
    turn_cap: turnCap,
  };
}

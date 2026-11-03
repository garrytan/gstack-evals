// gstack-evals waste: a keyless reader that turns exported crew-session logs, /ship receipts and per-PR replay data
// into counts for the in-the-wild waste baseline (GST-1114; wiki/board/2026-11-03-geva-220-waste-floor.md). It prints
// counts, the caller's label and sha256 digests, never a command line, a path or other text from its inputs. The
// rules and their limits are in src/waste/README.md. It is descriptive: no verdict is decided here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Io } from "../cli.ts";
import { codeLines, consoleIo } from "../skill-eval/contract/cli-io.ts";

const HELP = [
  "gstack-evals waste threads [--label <label>] <export>...   Capy thread exports: R1, R4 and check time per session",
  "gstack-evals waste receipts [--label <label>] <file>...    /ship receipts (PR bodies): R5, review rounds past the cap",
  "gstack-evals waste prs [--label <label>] <per-pr.json>     per-PR replay data: heads, CI reruns, local checks, rounds, first gates",
].join("\n");

/** R51: no change gets more than 2 review rounds. */
export const ROUND_CAP = 2;

class InputError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Shell commands

export interface Segment {
  words: string[];
  /** An output redirect to anything but /dev/null, /dev/stdout or /dev/stderr. */
  writes: boolean;
  heredoc: boolean;
  /** A $(...), backtick, <(...) or >(...) substitution. */
  subst: boolean;
}

/** Splits a command into simple commands on ; && || | & ( ) and newlines, outside quotes, skipping here-doc bodies. */
export function parseShell(command: string): Segment[] {
  const segments: Segment[] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let writes = false;
  let heredoc = false;
  let subst = false;
  let target: "none" | "out" | "in" = "none";
  let pending: string[] = [];
  const endWord = () => {
    if (!inWord) return;
    if (target === "out" && !/^\/dev\/(null|stdout|stderr)$/.test(word)) writes = true;
    if (target === "none") words.push(word);
    target = "none";
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (target === "out") writes = true;
    target = "none";
    if (words.length > 0 || writes || heredoc) segments.push({ words, writes, heredoc, subst });
    words = [];
    writes = false;
    heredoc = false;
    subst = false;
  };
  const closeParen = (from: number): number => {
    let depth = 1;
    for (let j = from; j < command.length; j++) {
      const c = command[j];
      if (c === "\\") j++;
      else if (c === "'") {
        const k = command.indexOf("'", j + 1);
        if (k < 0) return command.length;
        j = k;
      } else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return j;
    }
    return command.length;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const next = command[i + 1];
    if (ch === "\\") {
      if (next !== "\n") word += next ?? "";
      inWord = next !== "\n" || inWord;
      i++;
    } else if (ch === "'") {
      const k = command.indexOf("'", i + 1);
      const end = k < 0 ? command.length : k;
      word += command.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\") j++;
        else if (command[j] === "$" && command[j + 1] === "(") {
          subst = true;
          j = closeParen(j + 2);
        } else if (command[j] === "\u0060") subst = true;
        j++;
      }
      word += command.slice(i + 1, Math.min(j, command.length)).replace(/\\(.)/g, "$1");
      inWord = true;
      i = j;
    } else if (ch === "$" && next === "(") {
      const end = closeParen(i + 2);
      word += command.slice(i, end + 1);
      inWord = true;
      subst = true;
      i = end;
    } else if (ch === "\u0060") {
      const k = command.indexOf("\u0060", i + 1);
      const end = k < 0 ? command.length : k;
      word += command.slice(i, end + 1);
      inWord = true;
      subst = true;
      i = end;
    } else if (ch === "#" && !inWord) {
      const k = command.indexOf("\n", i);
      i = (k < 0 ? command.length : k) - 1;
    } else if (ch === "\n") {
      endSegment();
      for (const delim of pending) {
        while (i < command.length) {
          const k = command.indexOf("\n", i + 1);
          const line = command.slice(i + 1, k < 0 ? command.length : k);
          i = k < 0 ? command.length : k;
          if (line.trim() === delim) break;
        }
      }
      pending = [];
    } else if (ch === ";" || ch === "(" || ch === ")") {
      endSegment();
    } else if (ch === "&") {
      if (next === ">") {
        endWord();
        i += command[i + 2] === ">" ? 2 : 1;
        target = "out";
      } else {
        if (next === "&") i++;
        endSegment();
      }
    } else if (ch === "|") {
      if (next === "|") i++;
      endSegment();
    } else if (ch === ">" || (ch === "<" && next === "(")) {
      if (next === "(") {
        const end = closeParen(i + 2);
        word += command.slice(i, end + 1);
        inWord = true;
        subst = true;
        i = end;
        continue;
      }
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else endWord();
      if (command[i + 1] === ">" || command[i + 1] === "|") i++;
      if (command[i + 1] === "&") {
        i++;
        if (/[\d-]/.test(command[i + 1] ?? "")) {
          while (/[\d-]/.test(command[i + 1] ?? "")) i++;
          continue;
        }
      }
      target = "out";
    } else if (ch === "<") {
      endWord();
      if (next === "<" && command[i + 2] === "<") {
        i += 2;
        target = "in";
      } else if (next === "<") {
        i += command[i + 2] === "-" ? 2 : 1;
        let j = i + 1;
        while (command[j] === " " || command[j] === "\t") j++;
        let delim = "";
        const q = command[j];
        if (q === "'" || q === '"') {
          const k = command.indexOf(q, j + 1);
          delim = command.slice(j + 1, k < 0 ? command.length : k);
          j = k < 0 ? command.length : k + 1;
        } else {
          while (j < command.length && !/[\s;&|<>()]/.test(command[j]!)) delim += command[j++];
        }
        pending.push(delim.replace(/\\/g, ""));
        heredoc = true;
        i = j - 1;
      } else target = "in";
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endSegment();
  return segments;
}

const PREFIX = new Set(["env", "sudo", "nohup", "time", "nice", "command", "builtin", "!", "if", "then", "else", "elif", "do", "while", "until", "{"]);

/** The program a segment runs (basename, past assignments and wrappers such as env, sudo and timeout) and its arguments. */
export function program(seg: Segment): { name: string; args: string[] } {
  const w = seg.words;
  let i = 0;
  for (;;) {
    while (i < w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!)) i++;
    const head = w[i];
    if (head === undefined) return { name: "", args: [] };
    if (head === "timeout") {
      i++;
      while (i < w.length && w[i]!.startsWith("-")) i += ["-s", "-k", "--signal", "--kill-after"].includes(w[i]!) ? 2 : 1;
      i++;
      continue;
    }
    if (PREFIX.has(head)) {
      i++;
      if (head === "env" || head === "sudo" || head === "nice") while (i < w.length && w[i]!.startsWith("-")) i++;
      continue;
    }
    return { name: head.slice(head.lastIndexOf("/") + 1), args: w.slice(i + 1) };
  }
}

const CONTROL = new Set(["", "cd", ".", "source", "export", "set", "unset", "echo", "printf", "true", "false", ":", "test", "[", "[[", "local", "declare", "shopt", "trap", "wait", "pushd", "popd", "read", "for", "case", "fi", "done", "esac", "}", "in", "break", "continue", "exit", "return", "umask", "ulimit", "type"]);
const READ_ONLY = new Set(["cat", "head", "tail", "sed", "grep", "egrep", "fgrep", "rg", "ls", "tree", "find", "wc", "sort", "uniq", "cut", "diff", "cmp", "stat", "file", "du", "pwd", "which", "sha256sum", "shasum", "md5sum", "jq", "date", "basename", "dirname", "realpath", "readlink", "nl", "tr"]);
const GIT_READ = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame", "ls-remote", "cat-file", "merge-base", "rev-list", "describe", "shortlog", "grep", "for-each-ref"]);
const GIT_CHANGE = new Set(["commit", "merge", "rebase", "cherry-pick", "revert", "am", "pull", "reset", "checkout", "switch", "restore", "stash", "apply", "push", "rm", "mv", "worktree", "clean", "submodule", "clone", "init"]);
const FILE_CHANGE = new Set(["mv", "cp", "rm", "rmdir", "touch", "patch", "tee", "install", "ln", "rsync", "truncate", "dd", "unzip", "tar", "chmod", "chown", "wget", "eval", "xargs", "exec"]);
const SCRIPT_RUNNERS = new Set(["python", "python3", "node", "deno", "ruby", "php", "perl", "sh", "bash", "zsh", "dash", "bun", "npm", "pnpm", "yarn", "npx", "bunx", "make", "go", "cargo", "mvn", "gradle", "gradlew", "dotnet", "pip", "pip3", "uv", "poetry"]);
const CHECK_PROGRAMS = new Set(["pytest", "jest", "vitest", "mocha", "tsc", "eslint", "flake8", "mypy", "pyright", "rspec", "phpunit", "ctest", "gstack-pregate", "gstack-ship-preflight"]);
const FIX_FLAGS = new Set(["--fix", "-u", "--update", "--update-snapshots", "--snapshot-update", "--write", "fmt", "format"]);

function gitSub(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-C" || a === "-c") i++;
    else if (!a.startsWith("-")) return a;
  }
  return "";
}

const checkScript = (s: string | undefined): boolean => s !== undefined && /^(test|lint|typecheck|build|check)(:[\w:-]+)?$|:check$/.test(s);

/** A deterministic check: a test, typecheck, lint or build command, or gstack's pregate and preflight, with no fix flag. */
export function isCheck(seg: Segment): boolean {
  const { name, args } = program(seg);
  if (args.some((a) => FIX_FLAGS.has(a))) return false;
  if (CHECK_PROGRAMS.has(name)) return true;
  const [a0, a1] = args;
  switch (name) {
    case "python":
    case "python3":
      return a0 === "-m" && (a1 === "pytest" || a1 === "unittest");
    case "bun":
      return a0 === "test" || (a0 === "run" && checkScript(a1)) || (a0 === "x" && CHECK_PROGRAMS.has(a1 ?? ""));
    case "npm":
    case "pnpm":
    case "yarn":
      return a0 === "test" || a0 === "t" || (a0 === "run" && checkScript(a1)) || (name !== "npm" && checkScript(a0));
    case "npx":
    case "bunx":
      return CHECK_PROGRAMS.has(a0 ?? "");
    case "go":
      return a0 === "test" || a0 === "vet" || a0 === "build";
    case "cargo":
      return ["test", "check", "build", "clippy"].includes(a0 ?? "");
    case "make":
      return ["test", "check", "build", "lint"].includes(a0 ?? "");
    case "ruff":
      return a0 === "check";
    case "mvn":
      return a0 === "test" || a0 === "verify";
    case "gradle":
    case "gradlew":
      return a0 === "test" || a0 === "check";
    case "dotnet":
      return a0 === "test";
  }
  return false;
}

/** A status read: a process, git, CI, local server or container check. */
export function isPollSeg(seg: Segment): boolean {
  const { name, args } = program(seg);
  const [a0] = args;
  switch (name) {
    case "ps":
    case "pgrep":
    case "pidof":
    case "jobs":
      return true;
    case "git":
      return ["status", "ls-remote"].includes(gitSub(args));
    case "gh":
      return (a0 === "run" && ["view", "list", "watch"].includes(args[1] ?? "")) || (a0 === "pr" && ["checks", "view"].includes(args[1] ?? ""));
    case "curl":
      return args.some((a) => /localhost|127\.0\.0\.1/.test(a));
    case "nc":
      return args.includes("-z");
    case "docker":
      return ["ps", "logs", "inspect"].includes(a0 ?? "") && !args.includes("-f") && !args.includes("--follow");
    case "tail":
      return !args.some((a) => a === "-f" || a === "-F" || a === "--follow" || a.startsWith("--follow="));
  }
  return false;
}

/** Whether a segment may edit the work tree, commit or push (the brief's R1 boundary). Unknown programs may not. */
export function segChanges(seg: Segment): boolean {
  if (seg.writes) return true;
  const { name, args } = program(seg);
  if (name === "git") return GIT_CHANGE.has(gitSub(args));
  if (FILE_CHANGE.has(name)) return true;
  if ((name === "." || name === "source") && !/\.env$/.test(args[0] ?? "")) return true;
  if ((name === "sed" || name === "perl") && args.some((a) => a === "--in-place" || a.startsWith("--in-place=") || /^-[A-Za-z]*i/.test(a))) return true;
  if (name === "find") return args.some((a) => /^-(exec|execdir|delete|ok|okdir|fprint0?|fprintf|fls)$/.test(a));
  if (name === "sort") return args.some((a) => /^-[A-Za-z]*o/.test(a) || a.startsWith("--output"));
  if (name === "curl") return args.some((a) => /^(-o|-O|--output|--remote-name)/.test(a));
  if (name === "gstack-pregate") return args.includes("push");
  return SCRIPT_RUNNERS.has(name) && !isCheck(seg);
}

function segReadOnly(seg: Segment): boolean {
  if (seg.subst || seg.heredoc || segChanges(seg)) return false;
  const { name, args } = program(seg);
  if (READ_ONLY.has(name) || CONTROL.has(name) || name === "sleep") return true;
  if (name === "git") return GIT_READ.has(gitSub(args));
  if (name === "gh") return (args[0] === "pr" && ["view", "checks", "diff", "list", "status"].includes(args[1] ?? "")) || ((args[0] === "run" || args[0] === "issue") && ["view", "list"].includes(args[1] ?? ""));
  return isPollSeg(seg) || isCheck(seg);
}

export interface BashTraits {
  check: boolean;
  gstack: boolean;
  poll: boolean;
  sleep: boolean;
  idle: boolean;
  changes: boolean;
  strictChanges: boolean;
  push: boolean;
  /** The directory of the last cd in the command, or "" with none. */
  dir: string;
}

export function bashTraits(command: string): BashTraits {
  const segs = parseShell(command);
  const names = segs.map((s) => program(s).name);
  const changes = segs.some(segChanges);
  const poll = segs.some(isPollSeg) && segs.every((s, i) => isPollSeg(s) || CONTROL.has(names[i]!) || names[i] === "sleep") && !changes;
  return {
    check: segs.some(isCheck),
    gstack: names.some((n) => n.startsWith("gstack-")),
    poll,
    sleep: names.includes("sleep"),
    idle: names.includes("sleep") && names.every((n) => n === "sleep" || CONTROL.has(n)) && !changes,
    changes,
    strictChanges: changes || !segs.every(segReadOnly),
    push: segs.some((s, i) => (names[i] === "git" && gitSub(program(s).args) === "push") || (names[i] === "gstack-pregate" && program(s).args.includes("push"))),
    dir: segs.filter((_, i) => names[i] === "cd").map((s) => program(s).args[0] ?? "").pop() ?? "",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Capy thread exports

interface ExportItem {
  id: string;
  source: string;
  tool?: string;
  model?: string;
  createdAt: string;
  input?: { text?: string; chars?: number };
  result?: { text?: string; chars?: number; is_error?: boolean };
  calls?: Array<{ tool?: string; durationMs?: number; input?: { text?: string; chars?: number }; result?: { text?: string; chars?: number; is_error?: boolean } }>;
  durationMs?: number;
}

interface Call {
  tool: string;
  input: string;
  inputCut: boolean;
  result: string;
  resultChars: number;
  resultCut: boolean;
  isError: boolean;
  ms: number;
}

/** Reads one export: a transcript page ({items}), an array of items, or JSON lines of either. Dedupes by id, sorts by time. */
export function readExport(text: string): ExportItem[] {
  const values: unknown[] = [];
  try {
    values.push(JSON.parse(text));
  } catch {
    for (const [n, line] of text.split("\n").entries()) {
      if (line.trim() === "") continue;
      try {
        values.push(JSON.parse(line));
      } catch {
        throw new InputError("line " + (n + 1) + " is not JSON");
      }
    }
  }
  if (values.length === 0) throw new InputError("no JSON value");
  const raw: unknown[] = [];
  for (const v of values) {
    if (Array.isArray(v)) raw.push(...v);
    else if (v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items)) raw.push(...(v as { items: unknown[] }).items);
    else if (v && typeof v === "object" && typeof (v as { source?: unknown }).source === "string") raw.push(v);
    else throw new InputError("not a transcript page, item array or item");
  }
  const seen = new Set<string>();
  const items: ExportItem[] = [];
  for (const [n, v] of raw.entries()) {
    const it = v as ExportItem;
    if (!it || typeof it.id !== "string" || typeof it.source !== "string" || typeof it.createdAt !== "string") throw new InputError("item " + (n + 1) + " lacks a string id, source or createdAt");
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    items.push(it);
  }
  return items.toSorted((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

function toCall(tool: string, input: ExportItem["input"], result: ExportItem["result"], ms: number | undefined): Call {
  const inText = input?.text ?? "";
  const resText = result?.text ?? "";
  const resultChars = typeof result?.chars === "number" ? result.chars : resText.length;
  return {
    tool,
    input: inText,
    inputCut: typeof input?.chars === "number" && inText.length < input.chars,
    result: resText,
    resultChars,
    resultCut: resText.length < resultChars,
    isError: result?.is_error === true,
    ms: typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : 0,
  };
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

function json(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const POLL_TOOLS = new Set(["operation_get", "operation_list", "subagent_get", "subagent_list", "pr_get_checks", "pr_get_overview", "pr_get_findings", "pr_get_comments", "port_list"]);
const QUIET_TOOLS = new Set(["thread_get", "thread_list", "end_turn", "wait", "read"]);
const TREE_TOOLS = new Set(["edit", "write", "apply_patch", "pr_create", "transfer_files"]);
const AGENT_TOOLS = new Set(["subagent_create", "subagent_start"]);

const zero = () => ({ calls: 0, ms: 0 });
const zeroApprox = () => ({ calls: 0, ms: 0, approx_calls: 0 });

export function scanSession(items: ExportItem[]) {
  const s = {
    items: items.length,
    calls: 0,
    call_ms: 0,
    bash_calls: 0,
    unreadable_bash: 0,
    cut_results: 0,
    models: {} as Record<string, number>,
    checks: zero(),
    background_checks: 0,
    ship_checks: zero(),
    pushed_head_checks: zero(),
    r1: zeroApprox(),
    r1_checks: zeroApprox(),
    r1_ship_checks: zeroApprox(),
    r1_strict: zeroApprox(),
    informative_reruns: 0,
    r4a: zeroApprox(),
    r4b: { sleep_calls: 0, sleep_ms: 0, waits: 0, timer_waits: 0, timer_seconds: 0, operation_waits: 0, program_sleep_sites: 0 },
  };
  const add = (bucket: { calls: number; ms: number; approx_calls?: number }, c: Call, approx = false) => {
    bucket.calls++;
    bucket.ms += c.ms;
    if (approx && bucket.approx_calls !== undefined) bucket.approx_calls++;
  };
  let epoch = 0;
  let strictEpoch = 0;
  let pushedEpoch = -1;
  let pushedAt = "";
  const last = new Map<string, { epochAfter: number; strictAfter: number; digest: string; chars: number; isError: boolean; cut: boolean }>();
  const polls = new Map<string, { digest: string; chars: number; isError: boolean; cut: boolean }>();
  const calls: Call[] = [];
  for (const it of items) {
    if (it.source === "assistant" && typeof it.model === "string") s.models[it.model] = (s.models[it.model] ?? 0) + 1;
    if (it.source !== "tool") continue;
    if (Array.isArray(it.calls)) {
      if (it.tool === "execute") s.r4b.program_sleep_sites += (it.input?.text ?? "").match(/\bsleep\s*\(/g)?.length ?? 0;
      for (const c of it.calls) calls.push(toCall(c.tool ?? "", c.input, c.result, c.durationMs));
    } else calls.push(toCall(it.tool ?? "", it.input, it.result, it.durationMs));
  }
  for (const c of calls) {
    s.calls++;
    s.call_ms += c.ms;
    if (c.resultCut) s.cut_results++;
    const digest = sha256(c.result);
    const same = (p: { digest: string; chars: number; isError: boolean }) => p.digest === digest && p.chars === c.resultChars && p.isError === c.isError;
    if (c.tool === "bash") {
      s.bash_calls++;
      const input = c.inputCut ? null : json(c.input);
      const command = typeof input?.command === "string" ? input.command : null;
      if (command === null) {
        s.unreadable_bash++;
        epoch++;
        strictEpoch++;
        polls.clear();
        continue;
      }
      const t = bashTraits(command);
      const background = input!.execution === "background" || input!.execution === "detached" || /^\{"operation_id"/.test(c.result);
      if (t.check) add(s.checks, c);
      if (t.check && background) s.background_checks++;
      if (t.check || t.gstack) add(s.ship_checks, c);
      const at = JSON.stringify(input!.machine ?? "primary") + "\u0000" + t.dir;
      if (t.check && !t.changes && pushedEpoch === epoch && pushedAt === at) add(s.pushed_head_checks, c);
      if (t.sleep) {
        s.r4b.sleep_calls++;
        s.r4b.sleep_ms += c.ms;
      }
      const key = JSON.stringify(input!.machine ?? "primary") + "\u0000" + command.trim();
      if (t.poll && !background) {
        const p = polls.get(key);
        if (p && same(p)) add(s.r4a, c, p.cut || c.resultCut);
        polls.set(key, { digest, chars: c.resultChars, isError: c.isError, cut: c.resultCut });
      } else if (!t.idle || background) polls.clear();
      if (!background && !t.poll && !t.sleep && !t.changes) {
        const p = last.get(key);
        if (p && p.epochAfter === epoch) {
          if (same(p)) {
            const approx = p.cut || c.resultCut;
            add(s.r1, c, approx);
            if (t.check) add(s.r1_checks, c, approx);
            if (t.check || t.gstack) add(s.r1_ship_checks, c, approx);
          } else s.informative_reruns++;
        }
        if (!t.strictChanges && p && p.strictAfter === strictEpoch && same(p)) add(s.r1_strict, c, p.cut || c.resultCut);
      }
      if (t.changes || background) epoch++;
      if (t.strictChanges || background) strictEpoch++;
      if (t.push && !c.isError) {
        pushedEpoch = epoch;
        pushedAt = at;
      }
      if (!background) last.set(key, { epochAfter: epoch, strictAfter: strictEpoch, digest, chars: c.resultChars, isError: c.isError, cut: c.resultCut });
      continue;
    }
    if (c.tool === "wait" || c.tool === "waitFor") {
      s.r4b.waits++;
      const input = json(c.input);
      if (typeof input?.duration_seconds === "number") {
        s.r4b.timer_waits++;
        s.r4b.timer_seconds += input.duration_seconds;
      } else if (typeof input?.wake_at === "string") s.r4b.timer_waits++;
      if (Array.isArray(input?.operation_ids) && input.operation_ids.length > 0) s.r4b.operation_waits++;
      continue;
    }
    if (POLL_TOOLS.has(c.tool)) {
      const key = c.tool + "\u0000" + c.input.trim();
      const p = polls.get(key);
      if (p && same(p) && !c.inputCut) add(s.r4a, c, p.cut || c.resultCut);
      polls.set(key, { digest, chars: c.resultChars, isError: c.isError, cut: c.resultCut });
      continue;
    }
    if (QUIET_TOOLS.has(c.tool)) continue;
    polls.clear();
    const toSubagent = c.tool === "message_agent" && (c.inputCut || /^\d+(\.\d+)*$/.test(String(json(c.input)?.to ?? "")));
    if (TREE_TOOLS.has(c.tool) || AGENT_TOOLS.has(c.tool) || toSubagent) {
      const index = c.tool === "pr_create" ? json(c.input)?.index : undefined;
      const from = JSON.stringify(index == null ? "primary" : { subagent: String(index) }) + "\u0000";
      const keep = !c.inputCut && pushedEpoch === epoch && pushedAt.startsWith(from);
      epoch++;
      strictEpoch++;
      if (c.tool === "pr_create" && !c.isError) {
        pushedEpoch = epoch;
        if (!keep) pushedAt = from;
      }
    }
  }
  return s;
}

function sumInto(total: Record<string, unknown>, part: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(part)) {
    if (typeof v === "number") total[k] = ((total[k] as number | undefined) ?? 0) + v;
    else if (v && typeof v === "object") sumInto((total[k] ??= {}) as Record<string, unknown>, v as Record<string, unknown>);
  }
}

/** Runs fn on each input; an InputError names the input by its position, never by its path. */
function each<T>(texts: string[], fn: (text: string) => T): T[] {
  return texts.map((text, n) => {
    try {
      return fn(text);
    } catch (error) {
      if (error instanceof InputError) throw new InputError("input " + (n + 1) + " of " + texts.length + ": " + error.message);
      throw error;
    }
  });
}

export function scanThreads(texts: string[]) {
  const sessions = each(texts, (text) => ({ sha256: sha256(text), ...scanSession(readExport(text)) }));
  const totals: Record<string, unknown> = {};
  for (const { sha256: _digest, ...rest } of sessions) sumInto(totals, rest);
  return { sessions, totals };
}

// ---------------------------------------------------------------------------------------------------------------
// /ship receipts

export interface ReviewLoop {
  passes: number | null;
  rounds: number | null;
}

/** The review loop of the last /ship receipt in a text: the fenced gstack-ship-receipt JSON, else the last REVIEW_LOOP: line. */
export function receiptLoop(text: string): ReviewLoop | null {
  const blocks = [...text.matchAll(/\u0060\u0060\u0060gstack-ship-receipt[^\n]*\n([\s\S]*?)\n\u0060\u0060\u0060/g)];
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
  if (blocks.length > 0) {
    const receipt = json(blocks.at(-1)![1]!);
    if (receipt === null) throw new InputError("a gstack-ship-receipt block is not a JSON object");
    const rl = receipt.review_loop;
    if (!rl || typeof rl !== "object") return { passes: null, rounds: null };
    const loop = rl as Record<string, unknown>;
    const passes = num(loop.passes);
    const fixChecks = num(loop.fix_checks);
    return { passes, rounds: num(loop.rounds) ?? (passes !== null ? passes + (fixChecks ?? 0) : null) };
  }
  const lines = [...text.matchAll(/^REVIEW_LOOP:\s*(.*)$/gm)];
  if (lines.length === 0) return null;
  const fields = new Map([...lines.at(-1)![1]!.matchAll(/(\w+)=(\d+)/g)].map((m) => [m[1]!, Number(m[2])]));
  const passes = fields.get("passes") ?? null;
  const fixChecks = fields.get("fix_checks") ?? null;
  return { passes, rounds: fields.get("rounds") ?? (passes !== null ? passes + (fixChecks ?? 0) : null) };
}

export function scanReceipts(texts: string[]) {
  const out = {
    files: texts.length,
    no_receipt: 0,
    with_passes: 0,
    passes: 0,
    passes_past_cap: 0,
    prs_passes_past_cap: 0,
    with_rounds: 0,
    rounds: 0,
    rounds_past_cap: 0,
    prs_rounds_past_cap: 0,
    rounds_by_count: {} as Record<string, number>,
    digests: texts.map(sha256),
  };
  for (const loop of each(texts, receiptLoop)) {
    if (loop === null) {
      out.no_receipt++;
      continue;
    }
    if (loop.passes !== null) {
      out.with_passes++;
      out.passes += loop.passes;
      out.passes_past_cap += Math.max(0, loop.passes - ROUND_CAP);
      if (loop.passes > ROUND_CAP) out.prs_passes_past_cap++;
    }
    if (loop.rounds !== null) {
      out.with_rounds++;
      out.rounds += loop.rounds;
      out.rounds_past_cap += Math.max(0, loop.rounds - ROUND_CAP);
      if (loop.rounds > ROUND_CAP) out.prs_rounds_past_cap++;
      out.rounds_by_count[String(loop.rounds)] = (out.rounds_by_count[String(loop.rounds)] ?? 0) + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-PR replay data (the shape of the cross-repo catch replay's data/<repo>.json)

/** Local deterministic gates that rerun what CI runs at the same tree. */
export const LOCAL_GATES = ["pregate", "ship_preflight", "ubicloud_verify", "train_gate"] as const;

const FAMILIES: Array<[string, string]> = [
  ["escaped", "escaped"],
  ["ship_panel", "ship_panel"],
  ["capy_review", "capy_review"],
  ["crew_review", "crew_review"],
  ["review", "other_review"],
  ["ci", "ci"],
  ["cold_read", "cold_read"],
  ["writers_room", "cold_read"],
  ["paid_screen", "paid_screen"],
  ["train_gate", "train_gate"],
  ["pregate", "pregate"],
  ["autoplan", "autoplan"],
  ["local", "local_probe"],
];

export function gateFamily(firstGate: unknown): string {
  const g = typeof firstGate === "string" ? firstGate.toLowerCase() : "";
  return FAMILIES.find(([prefix]) => g.startsWith(prefix))?.[1] ?? "other";
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Sums a field over records; null when no record has a number there (not measured). */
function total(values: unknown[]): number | null {
  const nums = values.map(count).filter((v): v is number => v !== null);
  return nums.length === 0 ? null : Math.round(nums.reduce((a, b) => a + b, 0) * 10) / 10;
}

export function scanPrs(data: unknown) {
  const root = obj(data);
  if (root === null || !Array.isArray(root.prs)) throw new InputError("per-PR data needs a prs array");
  const prs = root.prs.map((p, n) => {
    const pr = obj(p);
    if (pr === null) throw new InputError("prs[" + n + "] is not an object");
    return pr;
  }).filter((p) => p.in_sample !== false);
  const heads = prs.flatMap((p) => (Array.isArray(p.heads) ? p.heads.map(obj).filter((h): h is Rec => h !== null) : []));
  const gates = (p: Rec, prefix: string) => (Array.isArray(p.gates) ? p.gates.map(obj).filter((g): g is Rec => g !== null && typeof g.gate === "string" && g.gate.startsWith(prefix)) : []);
  const ci = prs.map((p) => obj(p.ci) ?? {});
  const local = Object.fromEntries(
    LOCAL_GATES.map((name) => {
      const gs = prs.flatMap((p) => gates(p, name));
      return [name, {
        prs_with_gate: prs.filter((p) => gates(p, name).length > 0).length,
        runs: total(gs.map((g) => g.runs)),
        runs_not_measured: gs.filter((g) => count(g.runs) === null).length,
        wall_min: total(gs.map((g) => g.wall_min)),
        wall_estimate_only: gs.filter((g) => typeof g.wall_min === "string").length,
      }];
    }),
  );
  const loops = prs.map((p) => {
    const rl = obj(p.receipt_loop) ?? obj(p.review_loop);
    const panel = gates(p, "ship_panel")[0];
    const passes = count(rl?.passes) ?? count(panel?.passes);
    const fixChecks = count(rl?.fix_checks);
    const rounds = count(rl?.rounds) ?? count(panel?.rounds) ?? (passes !== null ? passes + (fixChecks ?? 0) : null);
    const headCount = Array.isArray(p.heads) ? p.heads.length : null;
    return { passes, rounds, heads: headCount, shipRuns: count(panel?.runs), platform: count(gates(p, "capy_review")[0]?.runs) };
  });
  const withPasses = loops.filter((l) => l.passes !== null);
  const passPerHead = withPasses.filter((l) => l.heads !== null);
  const withRounds = loops.filter((l) => l.rounds !== null);
  const passHeads = passPerHead.reduce((a, l) => a + l.heads!, 0);
  const platform = loops.filter((l) => l.platform !== null);
  const platformPerHead = platform.filter((l) => l.heads !== null);
  const platformHeads = platformPerHead.reduce((a, l) => a + l.heads!, 0);
  let catches: Rec | null = null;
  if (Array.isArray(root.catches)) {
    const by: Record<string, number> = {};
    let counted = 0;
    let escapes = 0;
    let notStrict = 0;
    let outside = 0;
    for (const c of root.catches.map(obj)) {
      if (c === null) continue;
      const weight = count(c.count) ?? 1;
      const family = gateFamily(c.first_gate);
      if (c.extra_outside_window === true) outside += weight;
      else if (family === "escaped") escapes += weight;
      else if (c.strict === false) notStrict += weight;
      else {
        counted += weight;
        by[family] = (by[family] ?? 0) + weight;
      }
    }
    catches = { counted, by_first_gate: by, escapes, not_strict: notStrict, outside_window: outside };
  }
  return {
    prs: prs.length,
    heads: heads.length,
    ci: {
      heads_with_jobs: heads.filter((h) => (count(h.jobs) ?? 0) > 0).length,
      heads_without_jobs: heads.filter((h) => count(h.jobs) === 0).length,
      heads_jobs_not_measured: heads.filter((h) => count(h.jobs) === null).length,
      workflow_runs: total(ci.map((c) => c.workflow_runs)),
      reruns: total(ci.map((c) => c.reruns)),
      red_heads: total(ci.map((c) => c.red_heads)),
      job_minutes: total(ci.map((c) => c.job_minutes)),
      wall_min_all_heads: total(heads.map((h) => h.wall_min)),
      wall_min_final_heads: total(ci.map((c) => c.wall_min_final_head)),
    },
    local_checks: local,
    review: {
      prs_with_passes: withPasses.length,
      passes: withPasses.length === 0 ? null : withPasses.reduce((a, l) => a + l.passes!, 0),
      passes_past_cap: withPasses.length === 0 ? null : withPasses.reduce((a, l) => a + Math.max(0, l.passes! - ROUND_CAP), 0),
      prs_passes_past_cap: withPasses.length === 0 ? null : withPasses.filter((l) => l.passes! > ROUND_CAP).length,
      passes_per_head: passHeads === 0 ? null : Math.round((passPerHead.reduce((a, l) => a + l.passes!, 0) / passHeads) * 100) / 100,
      prs_with_rounds: withRounds.length,
      rounds: withRounds.length === 0 ? null : withRounds.reduce((a, l) => a + l.rounds!, 0),
      rounds_past_cap: withRounds.length === 0 ? null : withRounds.reduce((a, l) => a + Math.max(0, l.rounds! - ROUND_CAP), 0),
      prs_rounds_past_cap: withRounds.length === 0 ? null : withRounds.filter((l) => l.rounds! > ROUND_CAP).length,
      ship_runs: total(loops.map((l) => l.shipRuns)),
      platform_review_runs: platform.length === 0 ? null : platform.reduce((a, l) => a + l.platform!, 0),
      platform_review_runs_per_head: platformHeads === 0 ? null : Math.round((platformPerHead.reduce((a, l) => a + l.platform!, 0) / platformHeads) * 100) / 100,
    },
    catches,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Command

export async function wasteCommand(argv: string[], io: Io = consoleIo): Promise<number> {
  const [mode, ...rest] = argv;
  if (mode === "--help" || mode === "-h") return (io.out("Usage:\n" + HELP), 0);
  const fail = (code: "E_USAGE" | "E_WASTE_INPUT", message: string) => (io.err(code === "E_USAGE" ? codeLines(code, [message], HELP) : codeLines(code, [message])), 2);
  if (mode !== "threads" && mode !== "receipts" && mode !== "prs") return fail("E_USAGE", "waste takes a mode: threads, receipts or prs");
  let label = "unlabeled";
  const files: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--label") {
      const v = rest[++i];
      if (v === undefined || v === "" || v.startsWith("-")) return fail("E_USAGE", "--label needs a value");
      label = v;
    } else if (a.startsWith("-")) return fail("E_USAGE", "unknown argument " + JSON.stringify(a));
    else files.push(a);
  }
  if (files.length === 0) return fail("E_USAGE", "waste " + mode + " needs at least one input file");
  if (mode === "prs" && files.length > 1) return fail("E_USAGE", "waste prs reads one per-PR data file");
  const texts: string[] = [];
  for (const [n, file] of files.entries()) {
    try {
      texts.push(readFileSync(file, "utf8"));
    } catch {
      return fail("E_WASTE_INPUT", "input " + (n + 1) + " of " + files.length + " could not be read");
    }
  }
  let result: Rec;
  try {
    if (mode === "threads") result = scanThreads(texts);
    else if (mode === "receipts") result = scanReceipts(texts);
    else
      result = each(texts, (text) => {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new InputError("not JSON");
        }
        return scanPrs(data);
      })[0]!;
  } catch (error) {
    if (error instanceof InputError) return fail("E_WASTE_INPUT", error.message);
    throw error;
  }
  io.out(JSON.stringify({ reader: "gstack-evals waste", schema: 1, mode, label, ...result }, null, 2));
  return 0;
}

export const main = (argv: string[]): Promise<number> => wasteCommand(argv);

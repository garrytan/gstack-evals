// Copyright (c) 2026 Garry Tan. MIT License.
// The report paths a unit's print command reads, taken literally from the command (the stale report rule). A path is a
// glob the command hands to cat (or loops over with for), expanded by bash from the directory the command cd's to, or a
// find the command runs, with its root, its -L and its -path and -name tests (each -o branch is its own path). A print
// command with any other reader (a program, a variable it did not bind, a quoted glob) cannot be read literally: it is
// unreadable and gives no paths, so its runs keep the old reading. kind "log" means every path it reads is a file the
// unit's own rebuild or test commands write by redirection or tee; "report" means at least one is written by a tool.
import { posix } from "node:path";

export interface FindPath { root: string; follow: boolean; tests: [string, string][] }
/** cwd: the directory the print command cd's to ("" is the container's working dir); glob or find, never both. */
export interface ReportPath { cwd: string; glob?: string; find?: FindPath }
export interface PrintReading { kind: "report" | "log" | "unreadable"; paths: ReportPath[]; unread?: string }

interface Tok { v: string; op?: string; var?: boolean; glob?: boolean; qglob?: boolean }

/** Splits a shell command into words and separators. $( and ( and ) are separators, so a command substitution reads as
 *  its own command; a redirection is an op "<" or ">" before its target (">&" targets are dropped). */
function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let cur: Tok | null = null;
  const w = () => (cur ??= { v: "" });
  const end = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  const quoted = (q: string) => {
    const t = w();
    t.v += q;
    if (/[*?[]/.test(q)) t.qglob = true;
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      quoted(s.slice(i + 1, j < 0 ? s.length : j));
      i = j < 0 ? s.length : j + 1;
    } else if (c === '"') {
      let j = i + 1, q = "";
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && j + 1 < s.length) q += s[++j];
        else {
          if (s[j] === "$") w().var = true;
          q += s[j];
        }
      }
      quoted(q);
      i = j + 1;
    } else if (c === "\\") {
      quoted(s[i + 1] ?? "");
      i += 2;
    } else if (s.startsWith("$(", i) || c === "(" || c === ")") {
      end();
      out.push({ v: "", op: ";" });
      i += s.startsWith("$(", i) ? 2 : 1;
    } else if (c === "$") {
      w().var = true;
      cur!.v += c;
      i++;
    } else if (/[\s]/.test(c)) {
      if (c === "\n") {
        end();
        out.push({ v: "", op: ";" });
      } else end();
      i++;
    } else if (/[;&|]/.test(c)) {
      end();
      out.push({ v: "", op: ";" });
      while (i < s.length && /[;&|]/.test(s[i]!)) i++;
    } else if (c === "<" || c === ">") {
      if (/^\d+$/.test((cur as Tok | null)?.v ?? "")) cur = null;
      end();
      let j = i;
      while (j < s.length && /[<>]/.test(s[j]!)) j++;
      if (s[j] === "&") {
        j++;
        while (j < s.length && /[\d-]/.test(s[j]!)) j++;
      } else out.push({ v: "", op: c });
      i = j;
    } else {
      const t = w();
      t.v += c;
      if (/[*?[]/.test(c)) t.glob = true;
      i++;
    }
  }
  end();
  return out.map((t) => (!t.op && !t.qglob && !t.var && /^[{}!]$/.test(t.v) ? { v: "", op: ";" } : t));
}

const commands = (toks: Tok[]): Tok[][] => {
  const out: Tok[][] = [[]];
  for (const t of toks) {
    if (t.op === ";") out.push([]);
    else out.at(-1)!.push(t);
  }
  return out.filter((c) => c.length);
};

const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "time"]);
const QUIET = new Set(["printf", "echo", "sort", "true", "false", ":", "test", "[", "]", "[[", "]]", "exit", "set", "shopt", "done", "fi", "esac", "cd"]);

/** The redirection targets and tee files in the given commands, as written. */
function targets(cmds: string[]): Tok[] {
  const out: Tok[] = [];
  for (const cmd of cmds) {
    const toks = lex(cmd);
    toks.forEach((t, i) => {
      if (t.op === ">" && toks[i + 1] && !toks[i + 1]!.op) out.push(toks[i + 1]!);
    });
    for (const c of commands(toks)) if (c[0]?.v === "tee") for (const a of c.slice(1)) if (!a.op && a.v && !a.v.startsWith("-")) out.push(a);
  }
  return out;
}

/** The file names the unit's rebuild and test commands write by redirection or tee. */
const written = (cmds: string[]): Set<string> => new Set(targets(cmds).map((t) => posix.basename(t.v)));

export function printReading(c: { rebuild: string[]; test: string[]; print: string[] }): PrintReading {
  const paths: ReportPath[] = [];
  const vars = new Set<string>();
  let cwd = "";
  const fail = (why: string): PrintReading => ({ kind: "unreadable", paths: [], unread: why });
  const glob = (t: Tok): string | null => {
    if (t.var) return vars.has(t.v.replace(/^\$\{?|\}$/g, "")) ? "" : null;
    if (t.qglob) return null;
    return t.v;
  };
  for (const print of c.print) {
    for (let cmd of commands(lex(print))) {
      const redirects: Tok[] = [];
      cmd = cmd.filter((t, i) => {
        if (t.op) return false;
        if (cmd[i - 1]?.op) {
          if (cmd[i - 1]!.op === "<") redirects.push(t);
          return false;
        }
        return true;
      });
      while (cmd.length && (KEYWORDS.has(cmd[0]!.v) || /^[A-Za-z_]\w*=/.test(cmd[0]!.v))) cmd = cmd.slice(1);
      for (const t of redirects) {
        const g = glob(t);
        if (g === null) return fail("a redirect from " + t.v);
        if (g) paths.push({ cwd, glob: g });
      }
      if (!cmd.length) continue;
      const [head, ...args] = cmd.map((t) => t.v);
      if (head === "cd") {
        if (cmd[1]?.var || args.length !== 1) return fail("cd " + args.join(" "));
        cwd = posix.normalize(posix.join(cwd, args[0]!)).replace(/^\.$/, "").replace(/\/$/, "");
        if (args[0]!.startsWith("/")) cwd = posix.normalize(args[0]!);
      } else if (head === "for") {
        if (cmd[2]?.v !== "in") return fail("for " + args.join(" "));
        vars.add(args[0]!);
        for (const t of cmd.slice(3)) {
          const g = glob(t);
          if (g === null) return fail("for over " + t.v);
          if (g) paths.push({ cwd, glob: g });
        }
      } else if (head === "read") {
        for (const a of args) if (!a.startsWith("-") && /^[A-Za-z_]\w*$/.test(a)) vars.add(a);
      } else if (head === "cat") {
        for (const t of cmd.slice(1)) {
          if (t.v.startsWith("-") && !t.var) continue;
          const g = glob(t);
          if (g === null) return fail("cat " + t.v);
          if (g) paths.push({ cwd, glob: g });
        }
      } else if (head === "xargs") {
        const rest = args.filter((a) => !a.startsWith("-"));
        if (rest.length !== 1 || rest[0] !== "cat") return fail("xargs " + args.join(" "));
      } else if (head === "find") {
        let follow = false;
        const roots: string[] = [];
        const tests: [string, string][] = [];
        let or = false, expr = false;
        for (let i = 0; i < args.length; i++) {
          const a = args[i]!;
          if (!expr && a === "-L") follow = true;
          else if (!expr && !/^[-(!]/.test(a)) roots.push(a);
          else if ((expr = true) && (a === "-path" || a === "-name" || a === "-ipath" || a === "-iname")) tests.push([a, args[++i] ?? ""]);
          else if (a === "-path" || a === "-name" || a === "-ipath" || a === "-iname") tests.push([a, args[++i] ?? ""]);
          else if (a === "-o" || a === "-or") or = true;
          else if (a === "-exec") {
            if (args[i + 1] !== "cat") return fail("find -exec " + args[i + 1]);
            while (i < args.length && args[i] !== "+" && args[i] !== ";") i++;
          } else if (a === "-type") i++;
          else if (a === "-maxdepth" || a === "-mindepth") tests.push([a, args[++i] ?? ""]);
          else if (!["(", ")", "-print", "-print0", "-a", "-and"].includes(a)) return fail("find " + a);
        }
        if (cmd.slice(1).some((t) => t.var)) return fail("find with a variable");
        for (const root of roots.length ? roots : ["."]) for (const set of or ? tests.map((t) => [t]) : [tests]) paths.push({ cwd, find: { root, follow, tests: set } });
      } else if (!QUIET.has(head!)) return fail(head!);
    }
  }
  const w = written([...c.rebuild, ...c.test]);
  const log = paths.length > 0 && paths.every((p) => p.glob && !/[*?[]/.test(p.glob) && w.has(posix.basename(p.glob)));
  return { kind: log ? "log" : "report", paths };
}

/** A report directory: dir relative to cwd (the print command's cd, as in ReportPath). */
export interface ReportDir { cwd: string; dir: string }
const globRe = (g: string) => new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\[!/g, "[^").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");

/** The parent directory of each report path the print command reads that the unit's test commands write into by
 *  redirection or tee, for the run to create when it is missing (prep's git clean removes an untracked one). Only a
 *  relative path whose directory has no glob and no .. step counts; a glob file name gives its parent. A path the test
 *  commands do not name, a directory they mkdir themselves, an absolute path and a file at the top of its cwd give none. */
export function reportDirs(c: { rebuild: string[]; test: string[]; print: string[] }): ReportDir[] {
  const named = targets(c.test).filter((t) => !t.var && !t.qglob).map((t) => posix.normalize(t.v));
  const made = c.test.flatMap((t) => commands(lex(t)).filter((x) => x[0]?.v === "mkdir").flatMap((x) => x.slice(1).filter((a) => !a.op && a.v && !a.v.startsWith("-")).map((a) => posix.normalize(a.v))));
  const out: ReportDir[] = [];
  for (const p of printReading(c).paths) {
    if (p.glob === undefined) continue;
    const g = posix.normalize(p.glob);
    const dir = posix.dirname(g);
    if (g.startsWith("/") || dir === "." || /[*?[]/.test(dir) || g.split("/").includes("..")) continue;
    const name = globRe(posix.basename(g));
    const rel = (t: string) => (p.cwd.startsWith("/") && t.startsWith(p.cwd + "/") ? t.slice(p.cwd.length + 1) : t);
    const hit = named.some((t) => posix.dirname(rel(t)) === dir && name.test(posix.basename(rel(t))));
    if (made.some((m) => rel(m) === dir || rel(m).startsWith(dir + "/"))) continue;
    if (hit && !out.some((o) => o.cwd === p.cwd && o.dir === dir)) out.push({ cwd: p.cwd, dir });
  }
  return out;
}

const sq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
/** A glob as bash source: glob characters stay live, every other character is escaped, so bash expands it as cat saw it. */
const globSrc = (g: string) => g.replace(/[^A-Za-z0-9_./*?[\]-]/g, (ch) => "\\" + ch);

/** Bash that prints, one per line, the absolute path of every file one report path names now. */
export function listSrc(p: ReportPath): string {
  const cd = 'cd "$SM_WD"' + (p.cwd ? " && cd " + sq(p.cwd) : "") + " 2>/dev/null";
  if (p.glob !== undefined) return "( " + cd + ' && for f in ' + globSrc(p.glob) + '; do [ -f "$f" ] && sm_abs "$f"; done )';
  const f = p.find!;
  const tests = f.tests.map(([k, v]) => k + " " + sq(v)).join(" ");
  return "( " + cd + " && find " + (f.follow ? "-L " : "") + sq(f.root) + " -type f " + tests + ' 2>/dev/null | while IFS= read -r f; do sm_abs "$f"; done )';
}

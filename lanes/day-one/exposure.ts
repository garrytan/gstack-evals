// Copyright (c) 2026 Garry Tan. MIT License.
// What a gstack arm session actually ran (prereg section 8, R48's procedure gate), read from autoplan's own run record,
// never from what the model said.
// - The run (pin change 2, item A): a run.json anywhere in the session's work tree, the state root included, down to
//   12 folders below /work/app, counts only when the session's own command log holds the gstack-autoplan call that
//   wrote it: the first next or run call for that run.json's folder that names a --plan names /work/app/plan.md.
//   A call is for a folder when its --out is that folder, or (rep 4 of the smoke) when it is a start call (next or
//   run naming a --plan) and gstack-autoplan created that run during it: the run.json's created_at lies between the
//   transcript's timestamps on the message that made the Bash call and on the one that returned its result (a start run in
//   the background, by run_in_background or a trailing & that ends its statement, spans from its call until the message
//   that made the next Bash call holding a start call, with or without a result, or the transcript's last timestamp,
//   whichever comes first), no other start call (in that Bash call or another) spans that time unless the log spells
//   out its --out and that --out is another folder, and no other run the scan found was created in that span. So a
//   --out the log cannot spell out (a command substitution, a variable set in another shell or never set) still ties the
//   start to the run it made, and a start whose --out the log spells out makes only the run at that --out. A start call that is for no record that counts is
//   counted as unmatched. The record's plan_input is /work/app/plan.md or (rep 3 of the smoke) a regular file, reached
//   through no symlink, inside that folder or /work/app that the session's own gstack-autoplan revise call with the
//   same --out named as its --plan. Flags are read as gstack-autoplan reads them: the first separate --out or --plan.
//   A record that the command log touched any other way is hand-edited and never counts: a Write, Edit, MultiEdit or
//   NotebookEdit call on it, a shell redirect into it, tee, sed -i, cp, mv, install, ln, dd or truncate onto it, a
//   recursive copy, mv or rsync onto a folder above it (unless it ran in the foreground, in a Bash call before the one
//   holding the folder's first start call, that start ran in the foreground, the copy's Bash call returned before the
//   record's created_at, and the record was made during that start call), or an interpreter's inline code that opens it for
//   writing (a target the code builds at run time counts every run.json the code names). Of the records that count, the latest
//   updated_at wins. Exposure and the live gate check (gatePending) read this one record. The scan never follows a
//   symlink, as the copy-out does not.
// - The command log is every Bash call in the transcript, subagents included, parsed by mvdan/sh's bash parser
//   (sh-syntax, NOTICE.md) and walked as bash runs it: variables a command sets, and HOME, GSTACK_STATE_ROOT and
//   GSTACK_HOME as the sandbox sets them, are expanded (with ${X:-default} and ${X:=default}), ~ is HOME, PWD is the
//   folder each Bash call starts in, wrappers (env, command, exec, nohup, time, timeout, sudo, nice) are stripped, a
//   function body is read where the function is called, with its arguments as $1, $2 and "$@", and never where it is
//   defined (command and builtin skip functions, and a function already being called is not read again), a for loop
//   reads its body once per item, and command substitutions, process substitutions, eval and bash or sh -c strings
//   and heredocs are read as commands too. A relative path resolves against the folder the last cd left in that
//   agent's shell (/work/app at first). A subshell, a pipeline member, a statement an & ends, a substitution and a
//   child shell each get a copy of the shell, so a cd, a variable or a function they set does not leave them; a child
//   shell starts with no functions. When the parser refuses a Bash call, a bash -c string or an eval string (after
//   splitting an EOF) line in two, as bash 5 reads it) at a line with no command before it, bash refused it too before
//   running anything, since bash reads each command whole before it runs it, so it ran nothing. When the refusal comes
//   after an earlier command, whether those earlier lines ran depends on how the call was run, so that call is
//   unreadable, and so is one that runs more than 10,000 commands or nests more than 16 deep. A session with an
//   unreadable Bash call has no record that counts: the reader refuses rather than guesses.
// - Exposed (dated change of 2026-11-18, pin change 1, section 11): the run is complete (the gate was answered and
//   applied) or waits at its final gate: status gate_pending, with the gate written at or after the close of every phase
//   in the run's phase order, each closed or skipped. A run waiting for an amendment (amend_pending), back in review
//   after a gate, or at a gate written before a phase's last close is not. The frozen reading, complete only, is kept
//   as exposed_frozen and printed beside it. CEO and Eng closed; Design closed or
//   skipped by autoplan's own scope rule; every closed phase's native voice completed; and every closed phase's outside
//   voice ended (completed, or recorded unavailable or failed). An outside voice that is disabled (the config turned it
//   off) or skipped never ran, so its session is not exposed, with that reason. Anything less is not exposed: reported,
//   never a loss.
// - Voice: astra when the voice slot sent at least one request and every closed phase's outside voice completed;
//   otherwise fallback (E_DAYONE_VOICE), logged per session.
// - The arm's plan, which the build reads: the file a counted record's plan_input names when the session revised a
//   file other than plan.md, read at the session's end; else plan.md at the session's end when it differs from the
//   base plan; otherwise the run's active plan (run.json active_plan, or the exported plan.md artifact, read only
//   inside the root the run was found in) when that differs from the base; otherwise plan.md as is.
// - loadedSkills: every Skill tool call and every Read of a SKILL.md or skill reference file in the transcript,
//   subagents included, with its path, for the loaded-skill log. On an arm with no gstack any entry marks the session.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { BinCmdOperator, ParExpOperator, parse, RedirOperator } from "sh-syntax/sync";
import { readTranscript } from "../../src/trial/review/readers.ts";
import { STATE_ROOT_DIR } from "../../src/trial/state-root.ts";

export const WORK = "/work/app";
export const PLAN = WORK + "/plan.md";
const HOME = "/home/agent";

export interface PhaseRead {
  state: "closed" | "skipped" | "open" | "absent";
  native: string | null;
  outside: string | null;
}
export interface Exposure {
  run: string | null;
  status: string | null;
  phases: Record<"ceo" | "design" | "eng", PhaseRead>;
  outside_model: string | null;
  exposed: boolean;
  /** The run waits at the gate gstack wrote after its last phase closed. */
  final_gate: boolean;
  /** The frozen reading: exposed with the run complete. */
  exposed_frozen: boolean;
  voice: "astra" | "fallback";
  why: string;
  /** Start calls in the session's command log that are for no run.json the scan found. */
  unmatched: number;
}

/** A host folder and the path the session saw it at. */
export interface RunRoot {
  dir: string;
  seen: string;
}
export interface FoundRun {
  path: string;
  seen: string;
  root: RunRoot;
  body: any;
}
/** The run that counts, and why every other run.json was passed over. */
export interface RunSearch {
  run: FoundRun | null;
  passed: string[];
  unmatched: number;
}

/** Every run.json under dir, a root the session saw at seen, down to 12 folders below /work/app wherever the root starts. */
function runs(dir: string, seen: string): { path: string; body: any }[] {
  const out: { path: string; body: any }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 12 || !existsSync(d)) return;
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      const st = lstatSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) {
        if (name !== ".git") walk(p, depth + 1);
      } else if (st.isFile() && name === "run.json") {
        try {
          out.push({ path: p, body: JSON.parse(readFileSync(p, "utf8")) });
        } catch {
          // an unreadable run is no run
        }
      }
    }
  };
  walk(dir, seen.startsWith(WORK + "/") ? seen.slice(WORK.length + 1).split("/").length : 0);
  return out;
}

/** The host path of a session path inside one of the roots, when it is a regular file reached through no symlink. */
function regularFile(roots: RunRoot[], p: string): string | null {
  for (const r of roots) {
    if (!p.startsWith(r.seen + "/")) continue;
    const host = join(r.dir, p.slice(r.seen.length));
    try {
      if (statSync(host).isFile() && realpathSync(host) === join(realpathSync(r.dir), p.slice(r.seen.length))) return host;
    } catch {
      continue;
    }
  }
  return null;
}

/** A word as the shell expands it, and whether the log spells all of it out: no command substitution, unset variable or expansion the reader does not model. */
type Field = { t: string; known: boolean };

/** Stops reading a Bash call: bash's grammar refuses it, or it repeats or nests past the reader's bounds. */
class Unreadable extends Error {}
/** The most simple commands one Bash call may run, and the deepest it may nest substitutions, child shells and function calls, before it is unreadable. */
const STEPS = 10_000;
const DEPTH = 16;

const OUTPUTS = new Set<number>([RedirOperator.RdrOut, RedirOperator.AppOut, RedirOperator.RdrAll, RedirOperator.AppAll, RedirOperator.RdrClob, RedirOperator.AppClob, RedirOperator.RdrAllClob, RedirOperator.AppAllClob, RedirOperator.RdrInOut]);
const DEFAULTS = new Set<number>([ParExpOperator.DefaultUnset, ParExpOperator.DefaultUnsetOrNull, ParExpOperator.AssignUnset, ParExpOperator.AssignUnsetOrNull]);

/** Each line that closes a heredoc and the substitution around it at once (EOF)), split in two, as bash 5 reads it. */
const splitHeredocParens = (s: string): string => {
  let out = s;
  for (const m of s.matchAll(/<<-?[ \t]*(['"]?)([A-Za-z_][\w.-]*)\1/g)) out = out.replace(new RegExp("^([ \\t]*" + m[2]!.replace(/[.-]/g, "\\$&") + ")\\)", "gm"), "$1\n)");
  return out;
};

/** Whether the lines before a command bash refused hold no command, so bash ran nothing: it reads each command whole before it runs it. */
const ranNothing = (before: string): boolean => {
  try {
    return parse(before).stmts.length === 0;
  } catch {
    return false;
  }
};

/** The files an interpreter's inline code opens for writing, as written in the code; every run.json it names when a target is not a literal. */
function writeTargets(code: string): string[] {
  const lits = new Map<string, string>();
  for (const m of code.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(['"])([^'"]*)\2/g)) lits.set(m[1]!, m[3]!);
  const value = (x: string) => {
    const t = x.trim();
    const q = /^(['"])(.*)\1$/.exec(t);
    return q ? q[2]! : (lits.get(t) ?? null);
  };
  const targets: (string | null)[] = [];
  for (const m of code.matchAll(/\bopen\(\s*([^,()]+?)\s*,\s*(?:mode\s*=\s*)?['"]([^'"]*)['"]/g)) if (/[wax+]/.test(m[2]!)) targets.push(value(m[1]!));
  for (const m of code.matchAll(/\b(?:writeFileSync|writeFile|appendFileSync|appendFile|Bun\.write)\(\s*([^,()]+?)\s*,/g)) targets.push(value(m[1]!));
  for (const m of code.matchAll(/\bPath\(\s*([^()]+?)\s*\)\.(?:write_text|write_bytes)/g)) targets.push(value(m[1]!));
  for (const m of code.matchAll(/\b(?:os\.replace|os\.rename|shutil\.copy\w*|shutil\.move|renameSync|copyFileSync)\(\s*[^,()]+?\s*,\s*([^,()]+?)\s*[,)]/g)) targets.push(value(m[1]!));
  const named = code.split(/[\s'"(),=:;[\]{}`]+/).flatMap((t) => (t.includes("run.json") ? t.split(/(?<=run\.json)/).filter((x) => x.endsWith("run.json")) : []));
  return targets.flatMap((t) => (t === null ? named : [t]));
}

const EDITS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const INTERPRETERS = new Set(["python", "python3", "node", "bun", "perl", "ruby"]);
const WRAPPERS = new Set(["command", "exec", "nohup", "time", "builtin", "sudo", "nice"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
/** The gstack-autoplan verbs that start a run from a plan file. */
const STARTS = new Set(["next", "run"]);

export interface CommandLog {
  /** Each gstack-autoplan call: its verb, its --out and --plan as absolute paths in the session, whether the log spells its --out out, and its Bash call's id. */
  calls: { verb: string; out: string | null; plan: string | null; known: boolean; use: string; seq: number; bg: boolean }[];
  /** Each Bash call's span: the transcript's timestamp on the message that made the call and on the message that returned its result. */
  spans: Map<string, { from: number; to: number }>;
  /** Each Bash call's start: the transcript's timestamp on the message that made it, with or without a result. */
  made: Map<string, number>;
  /** Every path the log wrote other than through gstack-autoplan. */
  writes: Set<string>;
  /** Every folder a recursive copy, mv or rsync may have filled or replaced, with the command's place in the log, its Bash call's id and whether it ran in the background. */
  trees: { path: string; seq: number; use: string; bg: boolean }[];
  /** The Bash calls the reader could not read. */
  unreadable: string[];
  /** The transcript's last timestamp. */
  end: number;
}

/** What the sandbox sets before the session's first command (src/trial/state-root.ts and the agent's HOME). */
const SANDBOX_ENV: [string, string][] = [
  ["HOME", HOME],
  ["GSTACK_STATE_ROOT", WORK + "/" + STATE_ROOT_DIR],
  ["GSTACK_HOME", WORK + "/" + STATE_ROOT_DIR],
];

/** One shell's state: its folder, variables, functions and positional parameters, the functions being called, and how deep it nests. */
interface Ctx {
  cwd: string;
  env: Map<string, Field>;
  funcs: Map<string, (c: Ctx) => void>;
  args: Field[];
  stack: string[];
  depth: number;
}

/** The session's command log under the rule above. */
export function commandLog(transcript: string): CommandLog {
  const log: CommandLog = { calls: [], writes: new Set(), trees: [], spans: new Map(), made: new Map(), unreadable: [], end: -Infinity };
  let use = "";
  let seq = 0;
  let steps = 0;
  const child = (c: Ctx, funcs = new Map(c.funcs)): Ctx => ({ cwd: c.cwd, env: new Map(c.env), funcs, args: [...c.args], stack: [...c.stack], depth: c.depth + 1 });
  const background = (fn: () => void) => {
    const from = seq;
    fn();
    for (const c of [...log.calls, ...log.trees]) if (c.seq > from) c.bg = true;
  };

  const read = (input: string, ctx: Ctx): void => {
    if (ctx.depth > DEPTH) throw new Unreadable();
    let src = input;
    let file: any;
    try {
      file = parse(src);
    } catch {
      src = splitHeredocParens(input);
      try {
        file = parse(src);
      } catch (e: any) {
        const before = src.split("\n").slice(0, Math.max(Number(e?.pos?.line ?? 0) - 1, 0)).join("\n");
        if (Number(e?.pos?.line) >= 1 && ranNothing(before)) return;
        throw new Unreadable();
      }
    }
    const bytes = Buffer.from(src);
    const text = (n: any) => bytes.subarray(n.start, n.end).toString();
    const unescape = (v: string, quoted: boolean) => v.replace(quoted ? /\\(\n|[$`"\\])/g : /\\([\s\S])/g, (_, c: string) => (c === "\n" ? "" : c));

    const subs = (n: any, c: Ctx): void => {
      if (Array.isArray(n)) return n.forEach((x) => subs(x, c));
      if (!n || typeof n !== "object") return;
      if (n.type === "CmdSubst" || n.type === "ProcSubst") return list(n.stmts, child(c));
      for (const v of Object.values(n)) if (v && typeof v === "object") subs(v, c);
    };
    const param = (p: any, c: Ctx): Field => {
      const name: string = p.param?.value ?? "";
      if (p.flags || p.excl || p.length || p.width || p.isSet || p.nestedParam || p.index || p.subscripts?.length || p.modifiers?.length || p.slice || p.repl || p.names) {
        subs(p, c);
        return { t: "", known: false };
      }
      const v: Field | undefined = /^[1-9]\d*$/.test(name) ? c.args[Number(name) - 1] : name === "@" || name === "*" ? { t: c.args.map((a) => a.t).join(" "), known: c.args.every((a) => a.known) } : name === "#" ? { t: String(c.args.length), known: true } : /^[A-Za-z_]\w*$/.test(name) ? c.env.get(name) : undefined;
      if (!p.exp) return v ?? { t: "", known: false };
      if (!DEFAULTS.has(p.exp.op)) {
        subs(p.exp, c);
        return { t: "", known: false };
      }
      const orNull = p.exp.op === ParExpOperator.DefaultUnsetOrNull || p.exp.op === ParExpOperator.AssignUnsetOrNull;
      if (v && (!orNull || v.t !== "")) return v;
      const d = p.exp.word ? piece(p.exp.word.parts, c, false, false) : { t: "", known: true };
      if ((p.exp.op === ParExpOperator.AssignUnset || p.exp.op === ParExpOperator.AssignUnsetOrNull) && /^[A-Za-z_]\w*$/.test(name)) c.env.set(name, d);
      return d;
    };
    const piece = (parts: any[], c: Ctx, quoted: boolean, first: boolean): Field => {
      let t = "";
      let known = true;
      parts.forEach((p, i) => {
        let f: Field;
        if (p.type === "Lit") {
          const v = unescape(p.value, quoted);
          f = { t: !quoted && first && i === 0 && /^~(\/|$)/.test(v) ? HOME + v.slice(1) : v, known: true };
        } else if (p.type === "SglQuoted") f = { t: p.value, known: true };
        else if (p.type === "DblQuoted") f = piece(p.parts, c, true, false);
        else if (p.type === "ParamExp") f = param(p, c);
        else if (p.type === "CmdSubst") {
          list(p.stmts, child(c));
          f = { t: text(p), known: false };
        } else {
          subs(p, c);
          f = { t: text(p), known: false };
        }
        t += f.t;
        known &&= f.known;
      });
      return { t, known };
    };
    const fields = (w: any, c: Ctx): Field[] => {
      const only = w.parts.length === 1 ? (w.parts[0].type === "DblQuoted" && w.parts[0].parts.length === 1 ? w.parts[0].parts[0] : w.parts[0]) : null;
      if (only?.type === "ParamExp" && only.param?.value === "@" && !only.exp && !only.length && !only.slice && !only.index) return [...c.args];
      return [piece(w.parts, c, false, true)];
    };
    const redirect = (r: any, c: Ctx): string | null => {
      if (r.op === RedirOperator.Hdoc || r.op === RedirOperator.DashHdoc) {
        if (!r.hdoc) return "";
        return r.word.parts.every((p: any) => p.type === "Lit") && !text(r.word).includes("\\") ? piece(r.hdoc.parts, c, true, false).t : text(r.hdoc);
      }
      const w = piece(r.word.parts, c, false, true).t;
      if (r.op === RedirOperator.WordHdoc) return w + "\n";
      if (OUTPUTS.has(r.op) || (r.op === RedirOperator.DplOut && !/^(\d+|-)$/.test(w))) log.writes.add(posix.resolve(c.cwd, w));
      return null;
    };

    const call = (x: any, c: Ctx, stdin: string | null) => {
      if (++steps > STEPS) throw new Unreadable();
      const words = x.args.flatMap((w: any) => fields(w, c)) as Field[];
      const own: Ctx = words.length ? { ...c, env: new Map(c.env) } : c;
      const assigns: [string, Field][] = [];
      for (const a of x.assigns) {
        const v: Field = a.value ? piece(a.value.parts, own, false, true) : (subs(a.array, own), { t: "", known: !a.array });
        own.env.set(a.name.value, v);
        assigns.push([a.name.value, v]);
      }
      if (!words.length) return;
      const ws = words.map((w) => w.t);
      const order = ++seq;
      let k = 0;
      let bypass = false;
      for (;;) {
        const name = posix.basename(ws[k] ?? "");
        if (WRAPPERS.has(name)) {
          bypass ||= name === "command" || name === "builtin";
          k++;
          while ((ws[k] ?? "").startsWith("-")) k++;
        } else if (name === "env") {
          k++;
          while (k < ws.length && (ws[k]!.startsWith("-") || /^[A-Za-z_]\w*=/.test(ws[k]!))) k++;
        } else if (name === "timeout") {
          k++;
          while ((ws[k] ?? "").startsWith("-")) k++;
          k++;
        } else break;
      }
      const [cmd, ...args] = ws.slice(k);
      if (!cmd) return;
      const argFields = words.slice(k + 1);
      const scoped = (fn: () => void) => {
        const saved = assigns.map(([n]) => [n, c.env.get(n)] as const);
        for (const [n, v] of assigns) c.env.set(n, v);
        fn();
        for (const [n, v] of saved) v === undefined ? c.env.delete(n) : c.env.set(n, v);
      };
      const body = bypass ? undefined : c.funcs.get(cmd);
      if (body) {
        if (c.stack.includes(cmd)) return;
        const saved = { args: c.args, depth: c.depth };
        if (++c.depth > DEPTH) throw new Unreadable();
        c.args = argFields;
        c.stack.push(cmd);
        scoped(() => body(c));
        c.stack.pop();
        Object.assign(c, saved);
        return;
      }
      const name = posix.basename(cmd);
      const at = (p: string) => posix.resolve(c.cwd, p);
      const paths = args.filter((a) => !a.startsWith("-"));
      if (name === "cd") {
        if (paths[0] !== undefined || !args.length) {
          c.cwd = at(paths[0] ?? HOME);
          c.env.set("PWD", { t: c.cwd, known: true });
        }
      } else if (name === "eval") {
        c.depth++;
        scoped(() => read(args.join(" "), c));
        c.depth--;
      } else if (SHELLS.has(name)) {
        if (args.includes("-n")) return;
        const i = args.findIndex((a) => /^-[a-z]*c$/.test(a));
        const script = i >= 0 ? args[i + 1] : stdin;
        if (script === undefined || script === null) return;
        const sub = child(c, new Map());
        for (const [n, v] of assigns) sub.env.set(n, v);
        sub.args = i >= 0 ? argFields.slice(i + 3) : [];
        read(script, sub);
      } else if (name === "gstack-autoplan") {
        const flag = (f: string) => {
          const i = args.indexOf(f);
          return i >= 0 ? (argFields[i + 1] ?? null) : null;
        };
        const out = flag("--out");
        const plan = flag("--plan");
        log.calls.push({ verb: args[0] ?? "", out: out === null ? null : at(out.t), plan: plan === null ? null : at(plan.t), known: out !== null && out.known, use, seq: order, bg: false });
      } else if (name === "tee" || name === "truncate" || (name === "sed" && args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a)))) {
        for (const p of paths) log.writes.add(at(p));
      } else if (["cp", "mv", "install", "ln"].includes(name) && paths.length > 1) {
        const to = paths[paths.length - 1]!;
        const whole = name === "mv" || (name === "cp" && args.some((a) => /^(-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/.test(a)));
        log.writes.add(at(to));
        for (const from of paths.slice(0, -1)) {
          const into = at(posix.join(to, posix.basename(from)));
          log.writes.add(into);
          if (whole && !/\.\w+$/.test(from)) log.trees.push({ path: at(to), seq: order, use, bg: false }, { path: into, seq: order, use, bg: false });
        }
      } else if (name === "rsync" && paths.length > 1) {
        log.trees.push({ path: at(paths[paths.length - 1]!), seq: order, use, bg: false });
      } else if (name === "dd") {
        for (const a of args) if (a.startsWith("of=")) log.writes.add(at(a.slice(3)));
      } else if (INTERPRETERS.has(name)) {
        for (const t of writeTargets([...args, stdin ?? ""].join(" "))) log.writes.add(at(t));
      }
    };

    const stmt = (s: any, c: Ctx): void => {
      if (s.background || s.coprocess) return background(() => command(s, child(c)));
      command(s, c);
    };
    const command = (s: any, c: Ctx): void => {
      const x = s.cmd;
      if (x?.type === "FuncDecl") {
        c.funcs.set(x.name.value, (cc: Ctx) => stmt(x.body, cc));
        return;
      }
      let stdin: string | null = null;
      for (const r of s.redirs) stdin = redirect(r, c) ?? stdin;
      if (!x) return;
      switch (x.type) {
        case "CallExpr":
          return call(x, c, stdin);
        case "Block":
          return list(x.stmts, c);
        case "Subshell":
          return list(x.stmts, child(c));
        case "BinaryCmd":
          if (x.op === BinCmdOperator.Pipe || x.op === BinCmdOperator.PipeAll) {
            stmt(x.x, child(c));
            return stmt(x.y, child(c));
          }
          stmt(x.x, c);
          return stmt(x.y, c);
        case "IfClause":
          for (let b = x; b; b = b.else) {
            list(b.cond ?? [], c);
            list(b.then ?? [], c);
          }
          return;
        case "WhileClause":
          list(x.cond, c);
          return list(x.do, c);
        case "ForClause": {
          if (x.loop.type !== "WordIter") {
            subs(x.loop, c);
            return list(x.do, c);
          }
          const items = x.loop.inPos?.line ? x.loop.items.flatMap((w: any) => fields(w, c)) : [...c.args];
          for (const v of items) {
            c.env.set(x.loop.name.value, v);
            list(x.do, c);
          }
          return;
        }
        case "CaseClause":
          fields(x.word, c);
          for (const item of x.items) {
            subs(item.patterns, c);
            list(item.stmts, c);
          }
          return;
        case "TimeClause":
          return x.stmt ? stmt(x.stmt, c) : undefined;
        case "CoprocClause":
          return background(() => stmt(x.stmt, child(c)));
        case "DeclClause":
          for (const a of x.args) {
            if (!a.naked && a.name && a.value) c.env.set(a.name.value, piece(a.value.parts, c, false, true));
            else subs(a, c);
          }
          return;
        default:
          return subs(x, c);
      }
    };
    const list = (stmts: any[], c: Ctx): void => {
      for (const s of stmts) stmt(s, c);
    };
    list(file.stmts, ctx);
  };

  const cwds = new Map<string, string>();
  for (const m of readTranscript(transcript)) {
    const when = Date.parse(String(m.timestamp ?? ""));
    if (!Number.isNaN(when)) log.end = Math.max(log.end, when);
    if (m.type === "user" && Array.isArray(m.message?.content)) {
      for (const b of m.message.content as Record<string, any>[]) {
        const from = log.made.get(b?.tool_use_id);
        if (b?.type === "tool_result" && from !== undefined && when >= from) log.spans.set(b.tool_use_id, { from, to: when });
      }
    }
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    const agent = String(m.parent_tool_use_id ?? "");
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      const cwd = cwds.get(agent) ?? WORK;
      if (EDITS.includes(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof p === "string") log.writes.add(posix.resolve(cwd, p));
      } else if (b.name === "Bash" && typeof b.input?.command === "string") {
        use = String(b.id ?? "");
        if (!Number.isNaN(when)) log.made.set(use, when);
        const ctx: Ctx = { cwd, env: new Map([...SANDBOX_ENV, ["PWD", cwd]].map(([k, v]) => [k!, { t: v!, known: true }])), funcs: new Map(), args: [], stack: [], depth: 0 };
        steps = 0;
        try {
          read(b.input.command, ctx);
        } catch (e) {
          if (!(e instanceof Unreadable)) throw e;
          log.unreadable.push(use);
        }
        if (b.input.run_in_background === true) for (const c of [...log.calls, ...log.trees]) if (c.use === use) c.bg = true;
        cwds.set(agent, ctx.cwd);
      }
    }
  }
  return log;
}

/** The session's autoplan run under the rule above, from the roots in order (a run two roots both hold is read from the first). */
export function findRun(roots: RunRoot[], transcript: string): RunSearch {
  const log = commandLog(transcript);
  type Call = CommandLog["calls"][number];
  const isStart = (c: Call) => STARTS.has(c.verb) && c.plan !== null;
  const starts = log.calls.filter(isStart);
  const scanned: { s: string; folder: string; created: number; r: { path: string; body: any }; root: RunRoot }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const r of runs(root.dir, root.seen)) {
      const s = posix.join(root.seen, relative(root.dir, r.path).split(sep).join("/"));
      if (seen.has(s)) continue;
      seen.add(s);
      scanned.push({ s, folder: posix.dirname(s), created: Date.parse(String(r.body?.created_at ?? "")), r, root });
    }
  }
  const within = (c: Call, at: number) => {
    const w = log.spans.get(c.use);
    if (w === undefined || !Number.isFinite(at) || at < w.from) return false;
    if (!c.bg) return at <= w.to;
    const next = starts.find((d) => d.seq > c.seq && d.use !== c.use && log.made.has(d.use));
    return (next === undefined || at < log.made.get(next.use)!) && at <= log.end;
  };
  const maker = new Map<string, Call>();
  for (const x of scanned) {
    const by = starts.filter((c) => within(c, x.created) && (!c.known || c.out === x.folder));
    if (by.length !== 1) continue;
    const c = by[0]!;
    if (scanned.filter((y) => within(c, y.created)).length === 1) maker.set(x.folder, c);
  }
  const isFor = (c: Call, folder: string) => c.out === folder || maker.get(folder) === c;
  const ok: FoundRun[] = [];
  const passed: string[] = [];
  for (const { s, folder, created, r, root } of scanned) {
      const input = r.body?.plan_input;
      const revised =
        typeof input === "string" &&
        (input.startsWith(folder + "/") || input.startsWith(WORK + "/")) &&
        log.calls.some((c) => c.verb === "revise" && isFor(c, folder) && c.plan === input) &&
        regularFile(roots, input) !== null;
      const start = log.calls.find((c) => isStart(c) && isFor(c, folder));
      const why = log.unreadable.length
        ? "the session's command log holds Bash calls the reader cannot read (" + log.unreadable.join(", ") + "): bash's grammar refuses them after an earlier command, or they repeat or nest past " + STEPS + " commands or " + DEPTH + " levels, so no record can be shown untouched"
        : input !== PLAN && !revised
          ? "plan_input " + JSON.stringify(input ?? null) + ", not " + PLAN + " or a regular file inside " + folder + " or " + WORK + " that the session's own gstack-autoplan revise --out " + folder + " --plan named"
          : start === undefined
            ? "no gstack-autoplan next or run call with --out " + folder + " and --plan " + PLAN + " in the session's command log"
            : start.plan !== PLAN
              ? "the first gstack-autoplan next or run call with --out " + folder + " and a --plan names " + start.plan + ", not " + PLAN
              : log.writes.has(s) || log.trees.some((t) => s.startsWith(t.path + "/") && !(!t.bg && !start.bg && t.use !== start.use && t.seq < start.seq && created > (log.spans.get(t.use)?.to ?? Infinity) && within(start, created)))
                ? "edited by hand in the session's command log"
                : null;
    if (why) passed.push(s + ": " + why);
    else ok.push({ path: r.path, seen: s, root, body: r.body });
  }
  ok.sort((a, b) => String(b.body?.updated_at ?? "").localeCompare(String(a.body?.updated_at ?? "")));
  const unmatched = starts.filter((c) => !ok.some((x) => isFor(c, posix.dirname(x.seen)))).length;
  return { run: ok[0] ?? null, passed, unmatched };
}

/** Whether the session's run in its live work dir waits at its gate: the record exposure reads, from the transcript so far. */
export function gatePending(work: string, transcript: string): boolean {
  return findRun([{ dir: work, seen: WORK }], transcript).run?.body?.status === "gate_pending";
}

const phaseRead = (p: any): PhaseRead => {
  if (!p) return { state: "absent", native: null, outside: null };
  if (p.skipped) return { state: "skipped", native: null, outside: null };
  return { state: p.closed_at ? "closed" : "open", native: p.native?.status ?? null, outside: p.outside?.status ?? null };
};

const atFinalGate = (b: any): boolean => {
  const written = Date.parse(b.gate?.written_at);
  if (b.status !== "gate_pending" || Number.isNaN(written)) return false;
  const names = new Set<string>([...(Array.isArray(b.phase_order) ? b.phase_order : []), ...Object.keys(b.phases ?? {})]);
  return [...names].every((k) => {
    const p = b.phases?.[k];
    return !!p && (!!p.skipped || Date.parse(p.closed_at) <= written);
  });
};

/** The session's exposure, read from the run findRun counted. */
export function readExposure(found: RunSearch, voiceRequests: number): Exposure {
  const r = found.run;
  const empty: PhaseRead = { state: "absent", native: null, outside: null };
  if (!r) return { run: null, status: null, phases: { ceo: empty, design: empty, eng: empty }, outside_model: null, exposed: false, final_gate: false, exposed_frozen: false, voice: "fallback", why: "no autoplan run.json that the session's own gstack-autoplan calls wrote" + (found.passed.length ? " (passed over: " + found.passed.join("; ") + ")" : ""), unmatched: found.unmatched };
  const b = r.body;
  const phases = { ceo: phaseRead(b.phases?.ceo), design: phaseRead(b.phases?.design), eng: phaseRead(b.phases?.eng) };
  const closed = Object.entries(phases).filter(([, p]) => p.state === "closed");
  const final_gate = atFinalGate(b);
  const gaps: string[] = [];
  if (b.status !== "complete" && !final_gate) gaps.push("run status " + JSON.stringify(b.status ?? null) + ", neither complete nor waiting at its final gate");
  for (const k of ["ceo", "eng"] as const) if (phases[k].state !== "closed") gaps.push(k + " " + phases[k].state);
  if (phases.design.state !== "closed" && phases.design.state !== "skipped") gaps.push("design " + phases.design.state);
  for (const [k, p] of closed) {
    if (p.native !== "completed") gaps.push(k + " native voice " + p.native);
    if (p.outside === "disabled" || p.outside === "skipped") gaps.push(k + " outside voice " + p.outside + ", so it never ran");
    else if (!["completed", "unavailable", "failed"].includes(String(p.outside))) gaps.push(k + " outside voice " + p.outside);
  }
  const astra = voiceRequests > 0 && closed.length > 0 && closed.every(([, p]) => p.outside === "completed");
  const exposed = gaps.length === 0;
  const why = gaps.length ? gaps.join("; ") : final_gate ? "every phase closed and the run waits at its final gate" : "every phase closed and the gate answered";
  return { run: r.seen, status: b.status ?? null, phases, outside_model: b.outside_model ?? null, exposed, final_gate, exposed_frozen: exposed && b.status === "complete", voice: astra ? "astra" : "fallback", why, unmatched: found.unmatched };
}

/** The arm's plan text under the rule above. */
export function armPlan(out: string, base: string | null, run: FoundRun | null): { text: string; from: "plan.md" | "autoplan" | "none" } {
  const read = (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : "");
  const within = (dir: string, p: string) => {
    try {
      const real = realpathSync(p);
      return real.startsWith(realpathSync(dir) + sep) ? read(real) : "";
    } catch {
      return "";
    }
  };
  const input = run?.body?.plan_input;
  if (run && typeof input === "string" && input !== PLAN) {
    const p = regularFile([run.root, { dir: out, seen: WORK }], input);
    const t = p ? read(p) : "";
    if (t.trim()) return { text: t, from: "autoplan" };
  }
  const plan = read(join(out, "plan.md"));
  if (plan.trim() && (base === null || plan !== base)) return { text: plan, from: "plan.md" };
  if (run && base !== null) {
    const readInside = (p: string) => within(run.root.dir, p);
    const host = (c: string) => (c === run.root.seen || c.startsWith(run.root.seen + "/") ? join(run.root.dir, c.slice(run.root.seen.length)) : c.startsWith("/") ? null : join(run.root.dir, c));
    for (const c of [run.body?.active_plan, run.body?.artifacts?.["plan.md"]?.path].filter((p): p is string => typeof p === "string")) {
      const p = host(c);
      const t = (p ? readInside(p) : "") || readInside(join(dirname(run.path), basename(c)));
      if (t.trim() && t !== base) return { text: t, from: "autoplan" };
    }
  }
  return plan.trim() ? { text: plan, from: "plan.md" } : { text: "", from: "none" };
}

export interface SkillLoad {
  tool: string;
  target: string;
}

/** Skill loads in a transcript, subagents included. */
export function loadedSkills(transcript: string): SkillLoad[] {
  const out: SkillLoad[] = [];
  for (const m of readTranscript(transcript)) {
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      if (b.name === "Skill") out.push({ tool: "Skill", target: String(b.input?.skill ?? b.input?.name ?? b.input?.command ?? "") });
      else if (b.name === "Read" && typeof b.input?.file_path === "string" && /(^|\/)(SKILL\.md|skills\/)/.test(b.input.file_path)) out.push({ tool: "Read", target: b.input.file_path });
    }
  }
  return out;
}

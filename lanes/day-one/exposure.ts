// Copyright (c) 2026 Garry Tan. MIT License.
// What a gstack arm session actually ran (prereg section 8, R48's procedure gate), read from autoplan's own run record,
// never from what the model said.
// - The run (pin change 2, item A): a run.json anywhere in the session's work tree, the state root included, down to
//   12 folders below /work/app, counts only when the session's own command log holds the gstack-autoplan call that
//   wrote it: the first next or run call for that run.json's folder that names a --plan names /work/app/plan.md.
//   A call is for a folder when its --out is that folder, or (rep 4 of the smoke) when it is a start call (next or
//   run naming a --plan) and gstack-autoplan created that run during it: the run.json's created_at lies between the
//   transcript's timestamps on the message that made the Bash call and on the one that returned its result, no other
//   start call (in that Bash call or another) spans that time, and no other run the scan found was created in that
//   span. So a --out the log cannot spell out (a command substitution, a variable set in
//   another shell) still ties the start to the run it made. A start call that is for no record that counts is
//   counted as unmatched. The record's plan_input is /work/app/plan.md or (rep 3 of the smoke) a regular file, reached
//   through no symlink, inside that folder or /work/app that the session's own gstack-autoplan revise call with the
//   same --out named as its --plan. Flags are read as gstack-autoplan reads them: the first separate --out or --plan.
//   A record that the command log touched any other way is hand-edited and never counts: a Write, Edit, MultiEdit or
//   NotebookEdit call on it, a shell redirect into it, tee, sed -i, cp, mv, install, ln, dd or truncate onto it, a
//   recursive copy, mv or rsync onto a folder above it, or an interpreter's inline code that opens it for writing (a
//   target the code builds at run time counts every run.json the code names). Of the records that count, the latest
//   updated_at wins. Exposure and the live gate check (gatePending) read this one record. The scan never follows a
//   symlink, as the copy-out does not.
// - The command log is every Bash call in the transcript, subagents included, read as shell: variables a command sets,
//   and HOME, GSTACK_STATE_ROOT and GSTACK_HOME as the sandbox sets them, are expanded (with ${X:-default}), ~ is
//   HOME, wrappers (env, command, exec, nohup, time, timeout, sudo, nice) are stripped, and command substitutions,
//   eval and bash or sh -c strings are read as commands too. A relative path
//   resolves against the folder the last cd left in that agent's shell (/work/app at first); a cd inside a subshell,
//   a substitution or a child shell does not leave it.
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

type Piece = { t: string; q: boolean; sub?: string; here?: boolean };
type Tok = { op: string } | { word: Piece[] };

/** The command substitution that opens at s[i] ("$(" or a backtick): its inner text and the index after it. */
function substitution(s: string, i: number): { inner: string; end: number } {
  if (s[i] === "`") {
    let j = i + 1;
    while (j < s.length && s[j] !== "`") j += s[j] === "\\" ? 2 : 1;
    return { inner: s.slice(i + 1, j), end: j + 1 };
  }
  let depth = 1;
  let j = i + 2;
  let q: string | null = null;
  while (j < s.length && depth) {
    const c = s[j]!;
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"') j++;
    } else if (c === "'" || c === '"') q = c;
    else if (c === "\\") j++;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    j++;
  }
  return { inner: s.slice(i + 2, j - 1), end: j };
}

/** Shell words and operators. q marks text that is never expanded; a substitution is kept as its own piece with its command. A heredoc's body joins its command as one more word. */
function lex(s: string): Tok[] {
  const out: Tok[] = [];
  const heredocs: { d: string; body: Piece }[] = [];
  let cur: Piece[] | null = null;
  const push = (t: string, q: boolean) => {
    const w = (cur ??= []);
    const last = w[w.length - 1];
    if (last && last.q === q && last.sub === undefined) last.t += t;
    else w.push({ t, q });
  };
  const sub = (i: number): number => {
    const r = substitution(s, i);
    (cur ??= []).push({ t: s.slice(i, r.end), q: true, sub: r.inner });
    return r.end;
  };
  const flush = () => {
    if (cur) out.push({ word: cur });
    cur = null;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") {
      const e = s.indexOf("'", i + 1);
      const end = e < 0 ? s.length : e;
      push(s.slice(i + 1, end), true);
      i = end + 1;
    } else if (c === '"') {
      push("", false);
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        const d = s[j]!;
        if (d === "\\" && '"\\$`'.includes(s[j + 1] ?? "")) {
          push(s[j + 1]!, true);
          j += 2;
        } else if ((d === "$" && s[j + 1] === "(") || d === "`") j = sub(j);
        else {
          push(d, false);
          j++;
        }
      }
      i = j + 1;
    } else if ((c === "$" && s[i + 1] === "(") || c === "`") {
      i = sub(i);
    } else if (c === "\\") {
      if (s[i + 1] !== "\n") push(s[i + 1] ?? "", true);
      i += 2;
    } else if (c === "#" && !cur) {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === " " || c === "\t") {
      flush();
      i++;
    } else if (c === "\n") {
      flush();
      i++;
      while (heredocs.length) {
        const { d, body: at } = heredocs.shift()!;
        const body: string[] = [];
        while (i < s.length) {
          const e = s.indexOf("\n", i);
          const line = s.slice(i, e < 0 ? s.length : e);
          i = e < 0 ? s.length : e + 1;
          if (line.trim() === d) break;
          body.push(line);
        }
        at.t = body.join("\n");
      }
      out.push({ op: c });
    } else if (";|&()".includes(c)) {
      flush();
      const two = s.slice(i, i + 2);
      const op = two === "&&" || two === "||" ? two : c;
      out.push({ op });
      i += op.length;
    } else if (c === ">" || c === "<") {
      const w = cur as Piece[] | null;
      if (w?.length === 1 && !w[0]!.q && /^\d+$/.test(w[0]!.t)) cur = null;
      else flush();
      let op = c;
      i++;
      if (s[i] === c) {
        op += c;
        i++;
      }
      if (op === "<<") {
        if (s[i] === "-") i++;
        while (s[i] === " ") i++;
        let d = "";
        while (i < s.length && !/[\s;&|<>()]/.test(s[i]!)) d += s[i++];
        flush();
        const body: Piece = { t: "", q: true, here: true };
        out.push({ word: [body] });
        heredocs.push({ d: d.replace(/['"\\]/g, ""), body });
        continue;
      }
      if (s[i] === "&") {
        i++;
        while (/[\d-]/.test(s[i] ?? "")) i++;
        continue;
      }
      if (s[i] === "|") i++;
      out.push({ op });
    } else {
      push(c, false);
      i++;
    }
  }
  flush();
  return out;
}

const VAR = /\$\{([A-Za-z_]\w*)(?:(:?)([-=])([^}]*))?\}|\$([A-Za-z_]\w*)/g;
const expandText = (t: string, env: Map<string, string>): string =>
  t.replace(VAR, (_, name: string | undefined, colon: string | undefined, op: string | undefined, dflt: string | undefined, bare: string | undefined) => {
    if (bare) return env.get(bare) ?? "";
    const v = env.get(name!);
    if (!op) return v ?? "";
    if (colon ? v : v !== undefined) return v!;
    const d = expandText(dflt ?? "", env);
    if (op === "=") env.set(name!, d);
    return d;
  });

const expand = (w: Piece[], env: Map<string, string>): string => w.map((p, k) => (p.q ? p.t : expandText(k === 0 && /^~(\/|$)/.test(p.t) ? HOME + p.t.slice(1) : p.t, env))).join("");

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
  const named = code.match(/[^\s'"(),=]*run\.json/g) ?? [];
  return targets.flatMap((t) => (t === null ? named : [t]));
}

const EDITS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const INTERPRETERS = new Set(["python", "python3", "node", "bun", "perl", "ruby"]);
const WRAPPERS = new Set(["command", "exec", "nohup", "time", "builtin", "sudo", "nice"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
/** Reserved words that open or continue a compound command; the command they lead still runs. */
const RESERVED = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{"]);
const reserved = (w: Piece[] | undefined) => w !== undefined && w.length === 1 && !w[0]!.q && RESERVED.has(w[0]!.t);
/** The gstack-autoplan verbs that start a run from a plan file. */
const STARTS = new Set(["next", "run"]);

export interface CommandLog {
  /** Each gstack-autoplan call: its verb, its --out and --plan as absolute paths in the session, and its Bash call's id. */
  calls: { verb: string; out: string | null; plan: string | null; use: string }[];
  /** Each Bash call's span: the transcript's timestamp on the message that made the call and on the message that returned its result. */
  spans: Map<string, { from: number; to: number }>;
  /** Every path the log wrote other than through gstack-autoplan. */
  writes: Set<string>;
  /** Every folder a recursive copy, mv or rsync may have filled or replaced; a record under one is edited by hand. */
  trees: Set<string>;
}

/** What the sandbox sets before the session's first command (src/trial/state-root.ts and the agent's HOME). */
const SANDBOX_ENV: [string, string][] = [
  ["HOME", HOME],
  ["GSTACK_STATE_ROOT", WORK + "/" + STATE_ROOT_DIR],
  ["GSTACK_HOME", WORK + "/" + STATE_ROOT_DIR],
];

interface Ctx {
  cwd: string;
  env: Map<string, string>;
}

/** The session's command log under the rule above. */
export function commandLog(transcript: string): CommandLog {
  const log: CommandLog = { calls: [], writes: new Set(), trees: new Set(), spans: new Map() };
  let use = "";
  const child = (c: Ctx): Ctx => ({ cwd: c.cwd, env: new Map(c.env) });
  const simple = (raw: Piece[][], ctx: Ctx, depth: number) => {
    const ws: string[] = [];
    const words: Piece[][] = [];
    for (const w of raw) {
      for (const p of w) if (p.sub !== undefined) shell(p.sub, child(ctx), depth + 1);
      const m = words.every(reserved) && !w[0]!.q ? /^([A-Za-z_]\w*)=/.exec(w[0]!.t) : null;
      if (m) ctx.env.set(m[1]!, expand([{ t: w[0]!.t.slice(m[0].length), q: false }, ...w.slice(1)], ctx.env));
      else {
        ws.push(expand(w, ctx.env));
        words.push(w);
      }
    }
    let k = 0;
    for (;;) {
      const name = posix.basename(ws[k] ?? "");
      if (reserved(words[k])) k++;
      else if (WRAPPERS.has(name)) {
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
    const argWords = words.slice(k + 1);
    const name = posix.basename(cmd);
    const at = (p: string) => posix.resolve(ctx.cwd, p);
    const paths = args.filter((a) => !a.startsWith("-"));
    if (name === "export") {
      for (const a of args) if (/^[A-Za-z_]\w*=/.test(a)) ctx.env.set(a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1));
    } else if (name === "cd") {
      if (paths[0] !== undefined || !args.length) ctx.env.set("PWD", (ctx.cwd = at(paths[0] ?? HOME)));
    } else if (name === "eval") {
      shell(args.join(" "), ctx, depth + 1);
    } else if (SHELLS.has(name)) {
      const c = args.findIndex((a) => /^-[a-z]*c$/.test(a));
      const here = argWords.find((w) => w.length === 1 && w[0]!.here);
      if (args.includes("-n")) return;
      if (c >= 0 && args[c + 1] !== undefined) shell(args[c + 1]!, child(ctx), depth + 1);
      else if (here) shell(here[0]!.t, child(ctx), depth + 1);
    } else if (name === "gstack-autoplan") {
      const flag = (f: string) => {
        const i = args.indexOf(f);
        return i >= 0 ? (args[i + 1] ?? null) : null;
      };
      const out = flag("--out");
      const plan = flag("--plan");
      log.calls.push({ verb: args[0] ?? "", out: out === null ? null : at(out), plan: plan === null ? null : at(plan), use });
    } else if (name === "tee" || name === "truncate" || (name === "sed" && args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a)))) {
      for (const p of paths) log.writes.add(at(p));
    } else if (["cp", "mv", "install", "ln"].includes(name) && paths.length > 1) {
      const to = paths[paths.length - 1]!;
      const whole = name === "mv" || (name === "cp" && args.some((a) => /^(-[a-zA-Z]*[rRa][a-zA-Z]*|--recursive|--archive)$/.test(a)));
      log.writes.add(at(to));
      for (const from of paths.slice(0, -1)) {
        const into = at(posix.join(to, posix.basename(from)));
        log.writes.add(into);
        if (whole && !/\.\w+$/.test(from)) log.trees.add(at(to)).add(into);
      }
    } else if (name === "rsync" && paths.length > 1) {
      log.trees.add(at(paths[paths.length - 1]!));
    } else if (name === "dd") {
      for (const a of args) if (a.startsWith("of=")) log.writes.add(at(a.slice(3)));
    } else if (INTERPRETERS.has(name)) {
      for (const t of writeTargets(args.join(" "))) log.writes.add(at(t));
    }
  };
  const shell = (command: string, top: Ctx, depth: number): void => {
    if (depth > 8) return;
    const scopes: Ctx[] = [];
    let ctx = top;
    let raw: Piece[][] = [];
    let redirect: string | null = null;
    const end = () => {
      simple(raw, ctx, depth);
      raw = [];
      redirect = null;
    };
    for (const tok of lex(command)) {
      if ("op" in tok) {
        if (tok.op === ">" || tok.op === ">>" || tok.op === "<") {
          redirect = tok.op;
          continue;
        }
        end();
        if (tok.op === "(") {
          scopes.push(ctx);
          ctx = child(ctx);
        } else if (tok.op === ")" && scopes.length) ctx = scopes.pop()!;
      } else if (redirect) {
        if (redirect !== "<") log.writes.add(posix.resolve(ctx.cwd, expand(tok.word, ctx.env)));
        redirect = null;
      } else raw.push(tok.word);
    }
    end();
  };
  const cwds = new Map<string, string>();
  const made = new Map<string, number>();
  for (const m of readTranscript(transcript)) {
    const when = Date.parse(String(m.timestamp ?? ""));
    if (m.type === "user" && Array.isArray(m.message?.content)) {
      for (const b of m.message.content as Record<string, any>[]) {
        const from = made.get(b?.tool_use_id);
        if (b?.type === "tool_result" && from !== undefined && when >= from) log.spans.set(b.tool_use_id, { from, to: when });
      }
    }
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    const agent = String(m.parent_tool_use_id ?? "");
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      const ctx: Ctx = { cwd: cwds.get(agent) ?? WORK, env: new Map(SANDBOX_ENV) };
      if (EDITS.includes(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof p === "string") log.writes.add(posix.resolve(ctx.cwd, p));
      } else if (b.name === "Bash" && typeof b.input?.command === "string") {
        use = String(b.id ?? "");
        if (!Number.isNaN(when)) made.set(use, when);
        shell(b.input.command, ctx, 0);
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
  const within = (use: string, at: number) => {
    const w = log.spans.get(use);
    return w !== undefined && w.from <= at && at <= w.to;
  };
  const maker = new Map<string, Call>();
  for (const x of scanned) {
    const by = starts.filter((c) => within(c.use, x.created));
    if (by.length !== 1) continue;
    const c = by[0]!;
    if (scanned.filter((y) => within(c.use, y.created)).length === 1) maker.set(x.folder, c);
  }
  const isFor = (c: Call, folder: string) => c.out === folder || maker.get(folder) === c;
  const ok: FoundRun[] = [];
  const passed: string[] = [];
  for (const { s, folder, r, root } of scanned) {
      const input = r.body?.plan_input;
      const revised =
        typeof input === "string" &&
        (input.startsWith(folder + "/") || input.startsWith(WORK + "/")) &&
        log.calls.some((c) => c.verb === "revise" && isFor(c, folder) && c.plan === input) &&
        regularFile(roots, input) !== null;
      const start = log.calls.find((c) => isStart(c) && isFor(c, folder));
      const why =
        input !== PLAN && !revised
          ? "plan_input " + JSON.stringify(input ?? null) + ", not " + PLAN + " or a regular file inside " + folder + " or " + WORK + " that the session's own gstack-autoplan revise --out " + folder + " --plan named"
          : start === undefined
            ? "no gstack-autoplan next or run call with --out " + folder + " and --plan " + PLAN + " in the session's command log"
            : start.plan !== PLAN
              ? "the first gstack-autoplan next or run call with --out " + folder + " and a --plan names " + start.plan + ", not " + PLAN
              : log.writes.has(s) || [...log.trees].some((t) => s.startsWith(t + "/"))
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

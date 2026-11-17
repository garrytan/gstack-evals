// Copyright (c) 2026 Garry Tan. MIT License.
// What a gstack arm session actually ran (prereg section 8, R48's procedure gate), read from autoplan's own run record,
// never from what the model said.
// - The run (pin change 2, item A): a run.json anywhere in the session's work tree, the state root included, counts
//   only when the session's own command log holds the gstack-autoplan call that wrote it, a call whose --out is that
//   run.json's folder and whose --plan is /work/app/plan.md, and the record's plan_input is /work/app/plan.md. A record
//   that the command log touched any other way is hand-edited and never counts: a Write, Edit, MultiEdit or NotebookEdit
//   call on it, a shell redirect into it, tee, sed -i, cp, mv, install, ln, dd or truncate onto it, or an interpreter's
//   inline code that names it and writes. Of the records that count, the latest updated_at wins. Exposure and the live
//   gate check (gatePending) read this one record.
// - The command log is every Bash call in the transcript, subagents included, read as shell: variables a command sets
//   are expanded, ~ is HOME, and a relative path resolves against the folder the last cd left (/work/app at first).
// - Exposed: the run's status is complete (the gate was answered and applied); CEO and Eng closed; Design closed or
//   skipped by autoplan's own scope rule; every closed phase's native voice completed; and every closed phase's outside
//   voice ended (completed, or recorded unavailable or failed). An outside voice that is disabled (the config turned it
//   off) or skipped never ran, so its session is not exposed, with that reason. Anything less is not exposed: reported,
//   never a loss.
// - Voice: astra when the voice slot sent at least one request and every closed phase's outside voice completed;
//   otherwise fallback (E_DAYONE_VOICE), logged per session.
// - The arm's plan: plan.md at the session's end when it differs from the base plan; otherwise the run's active plan
//   (run.json active_plan, or the exported plan.md artifact, read only inside the root the run was found in) when that
//   differs from the base; otherwise plan.md as is.
// - loadedSkills: every Skill tool call and every Read of a SKILL.md or skill reference file in the transcript,
//   subagents included, with its path, for the loaded-skill log. On an arm with no gstack any entry marks the session.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { readTranscript } from "../../src/trial/review/readers.ts";

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
  voice: "astra" | "fallback";
  why: string;
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
}

/** Every run.json under dir, with its parsed body. */
function runs(dir: string): { path: string; body: any }[] {
  const out: { path: string; body: any }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 8 || !existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) {
        if (name !== ".git") walk(p, depth + 1);
      } else if (name === "run.json") {
        try {
          out.push({ path: p, body: JSON.parse(readFileSync(p, "utf8")) });
        } catch {
          // an unreadable run is no run
        }
      }
    }
  };
  walk(dir, 0);
  return out;
}

type Piece = { t: string; q: boolean };
type Tok = { op: string } | { word: Piece[] };

/** Shell words and operators; q marks text that is never expanded. A heredoc's body joins its command as one more word. */
function lex(s: string): Tok[] {
  const out: Tok[] = [];
  const heredocs: string[] = [];
  let cur: Piece[] | null = null;
  const push = (t: string, q: boolean) => {
    const w = (cur ??= []);
    const last = w[w.length - 1];
    if (last && last.q === q) last.t += t;
    else w.push({ t, q });
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
      let j = i + 1;
      let t = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\" && '"\\$`'.includes(s[j + 1] ?? "")) {
          t += s[j + 1];
          j += 2;
        } else t += s[j++];
      }
      push(t, false);
      i = j + 1;
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
        const d = heredocs.shift()!;
        const body: string[] = [];
        while (i < s.length) {
          const e = s.indexOf("\n", i);
          const line = s.slice(i, e < 0 ? s.length : e);
          i = e < 0 ? s.length : e + 1;
          if (line.trim() === d) break;
          body.push(line);
        }
        out.push({ word: [{ t: body.join("\n"), q: true }] });
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
        heredocs.push(d.replace(/['"\\]/g, ""));
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

const expand = (w: Piece[], env: Map<string, string>): string =>
  w
    .map((p, k) => {
      if (p.q) return p.t;
      const t = k === 0 && /^~(\/|$)/.test(p.t) ? HOME + p.t.slice(1) : p.t;
      return t.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => env.get(a ?? b) ?? "");
    })
    .join("");

const EDITS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const INTERPRETERS = new Set(["python", "python3", "node", "bun", "perl", "ruby"]);

export interface CommandLog {
  /** Each gstack-autoplan call: its verb and its --out and --plan as absolute paths in the session. */
  calls: { verb: string; out: string | null; plan: string | null }[];
  /** Every path the log wrote other than through gstack-autoplan. */
  writes: Set<string>;
}

/** The session's command log under the rule above. */
export function commandLog(transcript: string): CommandLog {
  const log: CommandLog = { calls: [], writes: new Set() };
  let cwd = WORK;
  const at = (p: string) => posix.resolve(cwd, p);
  const simple = (raw: Piece[][], env: Map<string, string>) => {
    const ws: string[] = [];
    for (const w of raw) {
      const m = !ws.length && !w[0]!.q ? /^([A-Za-z_]\w*)=/.exec(w[0]!.t) : null;
      if (m) env.set(m[1]!, expand([{ t: w[0]!.t.slice(m[0].length), q: false }, ...w.slice(1)], env));
      else ws.push(expand(w, env));
    }
    const [cmd, ...args] = ws;
    if (!cmd) return;
    const name = posix.basename(cmd);
    const paths = args.filter((a) => !a.startsWith("-"));
    if (name === "export") {
      for (const a of args) if (/^[A-Za-z_]\w*=/.test(a)) env.set(a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1));
    } else if (name === "cd") {
      if (paths[0] !== undefined || !args.length) cwd = at(paths[0] ?? HOME);
    } else if (name === "gstack-autoplan") {
      const flag = (f: string) => {
        for (let k = 0; k < args.length; k++) {
          if (args[k] === f) return args[k + 1] ?? null;
          if (args[k]!.startsWith(f + "=")) return args[k]!.slice(f.length + 1);
        }
        return null;
      };
      const out = flag("--out");
      const plan = flag("--plan");
      log.calls.push({ verb: args[0] ?? "", out: out === null ? null : at(out), plan: plan === null ? null : at(plan) });
    } else if (name === "tee" || name === "truncate" || (name === "sed" && args.some((a) => /^(-[a-zA-Z]*i|--in-place)/.test(a)))) {
      for (const p of paths) log.writes.add(at(p));
    } else if (["cp", "mv", "install", "ln"].includes(name) && paths.length > 1) {
      const to = paths[paths.length - 1]!;
      log.writes.add(at(to));
      for (const from of paths.slice(0, -1)) log.writes.add(at(posix.join(to, posix.basename(from))));
    } else if (name === "dd") {
      for (const a of args) if (a.startsWith("of=")) log.writes.add(at(a.slice(3)));
    } else if (INTERPRETERS.has(name)) {
      const code = args.join(" ");
      if (/\bopen\([^)]*['"][wax]\+?['"]|write_text|write_bytes|writeFile|\.write\(|json\.dump\(/.test(code)) for (const p of code.match(/[^\s'"(),=]*run\.json/g) ?? []) log.writes.add(at(p));
    }
  };
  for (const m of readTranscript(transcript)) {
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message.content as Record<string, any>[]) {
      if (b?.type !== "tool_use") continue;
      if (EDITS.includes(b.name)) {
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (typeof p === "string") log.writes.add(at(p));
        continue;
      }
      if (b.name !== "Bash" || typeof b.input?.command !== "string") continue;
      const env = new Map<string, string>();
      let raw: Piece[][] = [];
      let redirect: string | null = null;
      for (const tok of lex(b.input.command)) {
        if ("op" in tok) {
          if (tok.op === ">" || tok.op === ">>" || tok.op === "<") redirect = tok.op;
          else {
            simple(raw, env);
            raw = [];
            redirect = null;
          }
        } else if (redirect) {
          if (redirect !== "<") log.writes.add(at(expand(tok.word, env)));
          redirect = null;
        } else raw.push(tok.word);
      }
      simple(raw, env);
    }
  }
  return log;
}

/** The session's autoplan run under the rule above, from the roots in order (a run two roots both hold is read from the first). */
export function findRun(roots: RunRoot[], transcript: string): RunSearch {
  const log = commandLog(transcript);
  const seen = new Set<string>();
  const ok: FoundRun[] = [];
  const passed: string[] = [];
  for (const root of roots) {
    for (const r of runs(root.dir)) {
      const s = posix.join(root.seen, relative(root.dir, r.path).split(sep).join("/"));
      if (seen.has(s)) continue;
      seen.add(s);
      const folder = posix.dirname(s);
      const why =
        r.body?.plan_input !== PLAN
          ? "plan_input " + JSON.stringify(r.body?.plan_input ?? null) + ", not " + PLAN
          : !log.calls.some((c) => c.out === folder && c.plan === PLAN)
            ? "no gstack-autoplan call with --out " + folder + " and --plan " + PLAN + " in the session's command log"
            : log.writes.has(s)
              ? "edited by hand in the session's command log"
              : null;
      if (why) passed.push(s + ": " + why);
      else ok.push({ path: r.path, seen: s, root, body: r.body });
    }
  }
  ok.sort((a, b) => String(b.body?.updated_at ?? "").localeCompare(String(a.body?.updated_at ?? "")));
  return { run: ok[0] ?? null, passed };
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

/** The session's exposure, read from the run findRun counted. */
export function readExposure(found: RunSearch, voiceRequests: number): Exposure {
  const r = found.run;
  const empty: PhaseRead = { state: "absent", native: null, outside: null };
  if (!r) return { run: null, status: null, phases: { ceo: empty, design: empty, eng: empty }, outside_model: null, exposed: false, voice: "fallback", why: "no autoplan run.json that the session's own gstack-autoplan calls wrote" + (found.passed.length ? " (passed over: " + found.passed.join("; ") + ")" : "") };
  const b = r.body;
  const phases = { ceo: phaseRead(b.phases?.ceo), design: phaseRead(b.phases?.design), eng: phaseRead(b.phases?.eng) };
  const closed = Object.entries(phases).filter(([, p]) => p.state === "closed");
  const gaps: string[] = [];
  if (b.status !== "complete") gaps.push("run status " + JSON.stringify(b.status ?? null) + ", not complete");
  for (const k of ["ceo", "eng"] as const) if (phases[k].state !== "closed") gaps.push(k + " " + phases[k].state);
  if (phases.design.state !== "closed" && phases.design.state !== "skipped") gaps.push("design " + phases.design.state);
  for (const [k, p] of closed) {
    if (p.native !== "completed") gaps.push(k + " native voice " + p.native);
    if (p.outside === "disabled" || p.outside === "skipped") gaps.push(k + " outside voice " + p.outside + ", so it never ran");
    else if (!["completed", "unavailable", "failed"].includes(String(p.outside))) gaps.push(k + " outside voice " + p.outside);
  }
  const astra = voiceRequests > 0 && closed.length > 0 && closed.every(([, p]) => p.outside === "completed");
  return { run: r.seen, status: b.status ?? null, phases, outside_model: b.outside_model ?? null, exposed: gaps.length === 0, voice: astra ? "astra" : "fallback", why: gaps.length ? gaps.join("; ") : "every phase closed and the gate answered" };
}

/** The arm's plan text under the rule above. */
export function armPlan(out: string, base: string | null, run: FoundRun | null): { text: string; from: "plan.md" | "autoplan" | "none" } {
  const read = (p: string) => (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : "");
  const plan = read(join(out, "plan.md"));
  if (plan.trim() && (base === null || plan !== base)) return { text: plan, from: "plan.md" };
  if (run && base !== null && existsSync(run.root.dir)) {
    const root = realpathSync(run.root.dir);
    const readInside = (p: string) => {
      try {
        const real = realpathSync(p);
        return real.startsWith(root + sep) ? read(real) : "";
      } catch {
        return "";
      }
    };
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

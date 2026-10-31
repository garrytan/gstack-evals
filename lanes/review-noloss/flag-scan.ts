// Copyright (c) 2026 Garry Tan. MIT License.
// noloss flag-scan (stacks round 1 contamination rule, frozen in the GST-456 superseding post): reads every session
// transcript of a review-units out dir and flags each stack-arm unit-pass that touched, in that arm's own install roots,
// a file the keyless contamination audit lists for that unit, or searched there for the unit's PR number or fix commit.
// Rules, applied to every tool call of the main agent and its subagents, whatever the call's result:
// - Paths. A call's paths are Read file_path, NotebookRead notebook_path, Grep path, LS path, Glob path joined with its
//   pattern, the SKILL.md a Skill call loads, and every word of a Bash command after ~, $HOME and ${HOME} expand to the
//   session home, with relative words resolved against an earlier cd in the same command. A bare cd goes to the session
//   home. A command after a cd also touches the directory it runs in, except that a listing naming a path lists only that
//   path. A word holding *, ? or [...] is a shell glob: * and
//   ? match within one path segment, ** across segments, so it touches every audited file it matches. The arm's told
//   command loads its skill's SKILL.md at session start, so that counts as a read in every pass.
// - read: a path that maps to a file the audit lists for the unit (diff-path rows, and the file of mention rows).
// - recursive: a Grep call, or a Bash grep -r, rgrep, rg, ag, ack, git grep or diff -r, whose path is a directory
//   holding such a file at any depth, an ancestor of an install root included.
// - list: a listing that shows such a file's name. ls and LS list a directory's entries, so they flag a file directly in
//   it, except ls -d, which lists only the directory itself; ls -R, find and tree list every file below their path, an ancestor of an install root or / included, narrowed only by
//   find's one -name test and find -maxdepth when find runs no action (-exec, -execdir, -ok, -okdir or ,), and tree -L; a Glob, or a
//   listing that names the file itself, flags each file it matches.
// - search: a call with any path in the roots, or a recursive call from an ancestor of a root, whose Grep pattern or
//   Bash words hold the unit's PR number as a whole number, or 7 or more leading hex characters of a fix commit of one
//   of the unit's blockers.
// - no-transcript: a stack-arm session directory without transcript.ndjson cannot be read, so it is flagged.
// A catalog problem, or a blocker whose case is in none of the suite's catalogs, fails the scan, since the search rule
// reads each blocker's fix commit from its case.
// Roots under the session home: gstack ~/.local/share/gstack and ~/.claude/skills (a path under ~/.claude/skills/<name>/
// maps to <name>/ of gstack's tree, ~/.claude/skills/gstack/ to its root), pstack ~/.local/share/pstack, tstack
// ~/.claude/skills and ~/.claude/agents. The none arm has no roots. Audit rows name gstack only, so pstack and tstack can
// be flagged by the search rule alone.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { shellCommands } from "../../src/grade/transcript.ts";
import { toldSkill, type ToldArm } from "../../src/trial/review/told.ts";
import { parseTsv } from "./contract.ts";
import { ScoreError } from "./score.ts";
import { resolveUnit, suiteCases, type Suite, type Unit } from "./suite.ts";

export const SESSION_HOME = "/home/agent";
export const ROOTS: Record<string, string[]> = { gstack: [".local/share/gstack", ".claude/skills"], pstack: [".local/share/pstack"], tstack: [".claude/skills", ".claude/agents"] };
const RECURSIVE = new Set(["rg", "ag", "ack", "rgrep"]);
const GREPS = new Set(["grep", "egrep", "fgrep", "zgrep"]);
const LISTINGS = new Set(["ls", "find", "tree"]);
export const FLAG_COLUMNS = ["unit", "arm", "model", "pass", "rule", "tool", "call", "path", "audit_path"];

export interface Flag {
  unit: string;
  arm: string;
  model: string;
  pass: number;
  rule: "read" | "recursive" | "list" | "search" | "no-transcript";
  tool: string;
  call: string;
  path: string;
  audit_path: string;
}

export interface Touch {
  /** An absolute session path, or a shell glob over them. */
  path: string;
  /** What the call reaches: the path alone, the entries of the directory at the path, or every file below it. */
  reach: "path" | "entries" | "tree";
  /** The call shows names, not bytes. */
  list: boolean;
  /** A tree reach shows only files whose name matches this glob (find -name). */
  name?: string;
  /** A tree reach goes at most this many levels below the path (find -maxdepth, tree -L). */
  depth?: number;
}

const fail = (message: string): never => {
  throw new ScoreError("E_USAGE", "noloss flag-scan: " + message);
};

const compiles = (source: string) => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

/** A shell glob as a regex source: * and ? stay within a path segment, ** crosses segments, [...] is a class (a literal [
 * when the regex engine rejects it), {a,b} is a choice. */
export function globSource(path: string): string {
  let re = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i]!;
    const close = c === "[" ? path.indexOf("]", i + 2) : c === "{" ? path.indexOf("}", i + 1) : -1;
    const cls = c === "[" && close > 0 ? "[" + path.slice(i + 1, close).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]" : null;
    if (c === "*" && path[i + 1] === "*") {
      const slash = path[i + 2] === "/";
      re += slash ? "(?:[^/]+/)*" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (cls && compiles(cls)) {
      re += cls;
      i = close;
    } else if (c === "{" && close > 0 && path.slice(i + 1, close).includes(",")) {
      re += "(?:" + path.slice(i + 1, close).split(",").map(globSource).join("|") + ")";
      i = close;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return re;
}

const expand = (word: string, home: string) => word.replace(/^~(?=\/|$)/, home).replace(/^\$\{HOME\}|^\$HOME(?![A-Za-z0-9_])/, home);

/** The tree path a session path maps to under the arm's roots: "" for a root, null outside every root. */
export function treePath(arm: string, path: string, home = SESSION_HOME): string | null {
  for (const r of ROOTS[arm] ?? []) {
    const root = home + "/" + r;
    if (path !== root && !path.startsWith(root + "/")) continue;
    const rest = path.slice(root.length + 1);
    if (arm === "gstack" && r === ".claude/skills") return rest === "gstack" ? "" : rest.startsWith("gstack/") ? rest.slice("gstack/".length) : rest;
    return rest;
  }
  return null;
}

/**
 * The session paths of an audited file: under each of the arm's roots, and for gstack also under ~/.claude/skills/gstack/.
 * A file at the tree's top level has no path directly in ~/.claude/skills, which maps only <name>/ directories.
 */
const sessionPaths = (arm: string, file: string, home: string) =>
  (ROOTS[arm] ?? [])
    .flatMap((r) => (arm === "gstack" && r === ".claude/skills" ? [home + "/" + r + "/gstack/" + file, ...(file.includes("/") ? [home + "/" + r + "/" + file] : [])] : [home + "/" + r + "/" + file]))
    .filter((p) => treePath(arm, p, home) === file);

/** Whether a touch reaches into one of the arm's roots: a path at or under a root, or a recursive call from above one. */
export function inRoots(arm: string, t: Touch, home = SESSION_HOME): boolean {
  const segs = t.path === "/" ? [""] : t.path.split("/");
  return (ROOTS[arm] ?? []).some((r) => {
    const root = (home + "/" + r).split("/");
    for (let i = 0; i < root.length; i++) {
      if (i >= segs.length) return t.reach === "tree";
      if (segs[i]!.includes("**")) return true;
      if (!new RegExp("^" + globSource(segs[i]!) + "$").test(root[i]!)) return false;
    }
    return true;
  });
}

/** The rule a touch fires on a session path, or null: read or list on the path itself, list on an entry, recursive or list below. */
export function touchRule(t: Touch): (path: string) => Flag["rule"] | null {
  const re = globSource(t.path);
  const under = t.path === "/" ? "" : re;
  const same = new RegExp("^" + re + "$");
  const entry = new RegExp("^" + under + "/[^/]+$");
  const below = new RegExp("^" + under + "/(.+)$");
  const name = t.name === undefined ? null : new RegExp("^" + globSource(t.name) + "$");
  return (path) => {
    if (same.test(path)) return t.list ? "list" : "read";
    if (t.reach === "entries" && entry.test(path)) return "list";
    const rest = t.reach === "tree" ? below.exec(path)?.[1] : undefined;
    if (rest === undefined || (t.depth !== undefined && rest.split("/").length > t.depth) || (name && !name.test(posix.basename(path)))) return null;
    return t.list ? "list" : "recursive";
  };
}

const skillFile = (skill: string, home: string) => (skill.includes(":") ? home + "/.local/share/" + skill.split(":")[0] + "/skills/" + skill.split(":").pop() + "/SKILL.md" : home + "/.claude/skills/" + skill + "/SKILL.md");

/** What one tool call touches, and the words a search rule reads, from its name and input. */
export function touches(tool: string, input: Record<string, unknown>, cwd: string, home = SESSION_HOME): { paths: Touch[]; words: string[] } {
  const abs = (p: string, from: string) => posix.normalize(posix.isAbsolute(expand(p, home)) ? expand(p, home) : posix.join(from, expand(p, home))).replace(/(.)\/+$/, "$1");
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const at = (path: string, reach: Touch["reach"] = "path", list = false): Touch[] => [{ path, reach, list }];
  if (tool === "Read" && str("file_path")) return { paths: at(abs(str("file_path")!, cwd)), words: [] };
  if (tool === "NotebookRead" && str("notebook_path")) return { paths: at(abs(str("notebook_path")!, cwd)), words: [] };
  if (tool === "Grep") return { paths: at(abs(str("path") ?? ".", cwd), "tree"), words: [str("pattern") ?? "", str("glob") ?? ""] };
  if (tool === "LS" && str("path")) return { paths: at(abs(str("path")!, cwd), "entries", true), words: [] };
  if (tool === "Glob") return { paths: at(abs(str("pattern") ?? "", abs(str("path") ?? ".", cwd)), "path", true), words: [str("pattern") ?? ""] };
  if (tool === "Skill" && str("skill")) return { paths: at(skillFile(str("skill")!, home)), words: [] };
  if (tool !== "Bash" || !str("command")) return { paths: [], words: [] };
  const paths: Touch[] = [];
  const words: string[] = [];
  let here = cwd;
  for (const argv of shellCommands(str("command")!)) {
    const name = posix.basename(argv[0] ?? "");
    if (name === "cd") {
      here = argv[1] ? abs(argv[1], here) : home;
      continue;
    }
    const flags = argv.filter((w) => w.startsWith("-"));
    const list = LISTINGS.has(name);
    const after = (flag: string) => (argv.indexOf(flag) > 0 ? argv[argv.indexOf(flag) + 1] : undefined);
    const pattern = after("-name");
    const tests = argv.filter((w) => /^-i?(name|path|regex|wholename)$/.test(w) || w === "-o" || w === "-or" || w === "!" || w === "-not");
    const depth = Number(name === "find" ? after("-maxdepth") : name === "tree" ? after("-L") : undefined);
    const filter: Pick<Touch, "name" | "depth"> = argv.some((w) => /^-(exec|execdir|ok|okdir)$/.test(w) || w === ",") ? {} : { ...(name === "find" && pattern !== undefined && tests.length === 1 && tests[0] === "-name" ? { name: pattern } : {}), ...(Number.isInteger(depth) && depth >= 0 ? { depth } : {}) };
    const touch = (path: string, r: Touch["reach"]): Touch => ({ path, reach: r, list, ...(r === "tree" ? filter : {}) });
    const recursive = RECURSIVE.has(name) || (GREPS.has(name) && flags.some((f) => /^-[A-Za-z]*[rR]/.test(f) || f === "--recursive" || f === "--dereference-recursive")) || (name === "git" && argv.includes("grep")) || (name === "diff" && flags.some((f) => /^-[A-Za-z]*r/.test(f) || f === "--recursive")) || name === "find" || name === "tree" || (name === "ls" && flags.some((f) => /^-[A-Za-z]*R/.test(f) || f === "--recursive"));
    const directoryOnly = name === "ls" && flags.some((f) => /^-[A-Za-z]*d/.test(f) || f === "--directory");
    const reach = directoryOnly ? "path" : recursive ? "tree" : list ? "entries" : "path";
    for (const w of argv.slice(1)) {
      words.push(w);
      const v = w.startsWith("--") && w.includes("=") ? w.slice(w.indexOf("=") + 1) : w;
      if (!v || v.startsWith("-") || /^[a-z]+:\/\//i.test(v)) continue;
      if (v.includes("/") || v.startsWith("~") || v.startsWith("$HOME") || v.startsWith("${HOME}") || here !== cwd) paths.push(touch(abs(v, here), reach));
    }
    const named = name === "find" ? !!argv[1] && !argv[1].startsWith("-") : argv.slice(1).some((w) => !w.startsWith("-"));
    if (here !== cwd) paths.push(touch(here, list && named ? "path" : reach));
  }
  return { paths, words };
}

/** Every tool call in a Claude Code stream-json transcript, main agent and subagents, with its full input. */
function transcriptCalls(text: string): Array<{ id: string; tool: string; input: Record<string, unknown> }> {
  const calls: Array<{ id: string; tool: string; input: Record<string, unknown> }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let m: { type?: string; message?: { content?: unknown } };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type !== "assistant" || !Array.isArray(m.message?.content)) continue;
    for (const b of m.message!.content as Array<{ type?: string; id?: string; name?: string; input?: unknown }>) if (b.type === "tool_use" && b.name) calls.push({ id: b.id ?? "", tool: b.name, input: (b.input ?? {}) as Record<string, unknown> });
  }
  return calls;
}

export interface ScanResult {
  flags: Flag[];
  sessions: Record<string, number>;
  flagged: Record<string, { passes: number; units: string[] }>;
}

/** Scans one review-units out dir against the audit: flags per arm, model, unit and pass. */
export function flagScan(o: { suite: Suite; run: string; audit: string; home?: string }): ScanResult {
  const home = o.home ?? SESSION_HOME;
  const unitsFile = join(o.run, "units.json");
  if (!existsSync(unitsFile)) fail(o.run + " has no units.json; pass a review-units out dir");
  const listed = (JSON.parse(readFileSync(unitsFile, "utf8")) as { units: Array<{ id: string; task: string }> }).units;
  const unitOf = (ref: string, where: string): Unit => resolveUnit(o.suite, ref).unit ?? fail(where + ": " + resolveUnit(o.suite, ref).problem);
  const audit = new Map<string, Set<string>>();
  const t = parseTsv(readFileSync(o.audit, "utf8"));
  for (const c of ["unit", "arm", "rule", "path"]) if (!t.header.includes(c)) fail("--audit " + o.audit + " needs a " + c + " column");
  for (const { line, cells } of t.rows) {
    const k = unitOf(cells.unit!, "--audit line " + line).id + " " + cells.arm;
    if (!audit.has(k)) audit.set(k, new Set());
    audit.get(k)!.add(cells.rule === "mention" ? cells.path!.replace(/:\d+$/, "") : cells.path!);
  }
  const { cases, problems } = suiteCases(o.suite);
  const missing = o.suite.units.flatMap((u) => u.blockers.filter((b) => !cases.has(b.case)).map((b) => u.id + " " + b.id + " (case " + b.case + ")"));
  if (problems.length || missing.length) throw new ScoreError("E_NOLOSS_SUITE", "noloss flag-scan: the search rule reads each blocker's fix commit from its case, so the scan needs every case to load:\n" + [...problems, ...missing.map((m) => m + " is in none of " + o.suite.catalogs.join(", "))].join("\n"));
  const flags: Flag[] = [];
  const sessions: Record<string, number> = {};
  const runs = join(o.run, "runs");
  for (const model of existsSync(runs) ? readdirSync(runs).sort() : []) {
    for (const arm of readdirSync(join(runs, model)).sort()) {
      if (!ROOTS[arm]) continue;
      for (const u of listed) {
        const unit = unitOf(u.id, "units.json");
        const files = [...(audit.get(unit.id + " " + arm) ?? [])].map((f) => ({ file: f, paths: sessionPaths(arm, f, home) }));
        const fixes = unit.blockers.map((b) => cases.get(b.case)?.fix?.commit).filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
        const prWord = new RegExp("(?<![0-9])" + unit.pr + "(?![0-9])");
        const dir = join(runs, model, arm, u.task);
        for (const p of existsSync(dir) ? readdirSync(dir).filter((x) => /^p\d+$/.test(x)).sort() : []) {
          const pass = Number(p.slice(1));
          sessions[arm] = (sessions[arm] ?? 0) + 1;
          const flag = (rule: Flag["rule"], tool: string, call: string, path: string, auditPath: string) => flags.push({ unit: unit.id, arm, model, pass, rule, tool, call, path, audit_path: auditPath });
          const file = join(dir, p, "host", "transcript.ndjson");
          if (!existsSync(file)) {
            flag("no-transcript", "", "", join(model, arm, u.task, p), "");
            continue;
          }
          const told = toldSkill(arm as ToldArm);
          const calls = [...(told ? [{ id: "told", tool: "Skill", input: { skill: arm === "pstack" ? "pstack:" + told : told } as Record<string, unknown> }] : []), ...transcriptCalls(readFileSync(file, "utf8"))];
          for (const call of calls) {
            const { paths, words } = touches(call.tool, call.input, "/work/" + u.task, home);
            for (const t of paths) {
              const rule = touchRule(t);
              for (const f of files) {
                const r = f.paths.map(rule).find((x) => x !== null);
                if (!r) continue;
                flag(r, call.tool, call.id, t.path, f.file);
                break;
              }
            }
            const reached = paths.find((t) => inRoots(arm, t, home));
            if (!reached) continue;
            const hit = words.find((w) => prWord.test(w) || (w.toLowerCase().match(/[0-9a-f]{7,40}/g) ?? []).some((h) => fixes.some((f) => f.startsWith(h))));
            if (hit !== undefined) flag("search", call.tool, call.id, reached.path, hit);
          }
        }
      }
    }
  }
  const flagged: ScanResult["flagged"] = {};
  for (const f of flags) {
    const k = f.arm;
    flagged[k] ??= { passes: 0, units: [] };
    const passKey = f.model + " " + f.unit + " " + f.pass;
    if (!flags.slice(0, flags.indexOf(f)).some((g) => g.arm === k && g.model + " " + g.unit + " " + g.pass === passKey)) flagged[k].passes++;
    if (!flagged[k].units.includes(f.unit)) flagged[k].units.push(f.unit);
  }
  return { flags, sessions, flagged };
}

export const flagsTsv = (flags: Flag[]) => [FLAG_COLUMNS.join("\t"), ...flags.map((f) => FLAG_COLUMNS.map((c) => String(f[c as keyof Flag]).replace(/[\t\n]/g, " ")).join("\t"))].join("\n") + "\n";

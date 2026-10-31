// Copyright (c) 2026 Garry Tan. MIT License.
// noloss flag-scan (stacks round 1 contamination rule, frozen in the GST-456 superseding post): reads every session
// transcript of a review-units out dir and flags each stack-arm unit-pass that touched, in that arm's own install roots,
// a file the keyless contamination audit lists for that unit, or searched there for the unit's PR number or fix commit.
// Rules, applied to every tool call of the main agent and its subagents, whatever the call's result:
// - Paths. A call's paths are Read file_path, NotebookRead notebook_path, Grep path, Glob path joined with a pattern that
//   has no wildcard, the SKILL.md a Skill call loads, and every word of a Bash command after ~, $HOME and ${HOME}
//   expand to the session home, with relative words resolved against an earlier cd in the same command. The arm's told
//   command loads its skill's SKILL.md at session start, so that counts as a read in every pass.
// - read: a path that maps to a file the audit lists for the unit (diff-path rows, and the file of mention rows).
// - recursive: a Grep call, or a Bash grep -r, rgrep, rg, ag, ack, git grep or diff -r, whose path is a directory
//   holding such a file. A listing (ls, Glob with a wildcard) shows names, not bytes, and flags only by naming the file.
// - search: a call with any path in the roots whose Grep pattern or Bash words hold the unit's PR number as a whole
//   number, or 7 or more leading hex characters of a fix commit of one of the unit's blockers.
// - no-transcript: a stack-arm session directory without transcript.ndjson cannot be read, so it is flagged.
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
import { isPlanCase } from "../review-replay/catalog/catalog.ts";
import { resolveUnit, suiteCases, type Suite, type Unit } from "./suite.ts";

export const SESSION_HOME = "/home/agent";
export const ROOTS: Record<string, string[]> = { gstack: [".local/share/gstack", ".claude/skills"], pstack: [".local/share/pstack"], tstack: [".claude/skills", ".claude/agents"] };
const RECURSIVE = new Set(["rg", "ag", "ack", "rgrep"]);
const GREPS = new Set(["grep", "egrep", "fgrep", "zgrep"]);
export const FLAG_COLUMNS = ["unit", "arm", "model", "pass", "rule", "tool", "call", "path", "audit_path"];

export interface Flag {
  unit: string;
  arm: string;
  model: string;
  pass: number;
  rule: "read" | "recursive" | "search" | "no-transcript";
  tool: string;
  call: string;
  path: string;
  audit_path: string;
}

interface Touch {
  path: string;
  recursive: boolean;
}

const fail = (message: string): never => {
  throw new ScoreError("E_USAGE", "noloss flag-scan: " + message);
};

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

const skillFile = (skill: string, home: string) => (skill.includes(":") ? home + "/.local/share/" + skill.split(":")[0] + "/skills/" + skill.split(":").pop() + "/SKILL.md" : home + "/.claude/skills/" + skill + "/SKILL.md");

/** What one tool call touches, and the words a search rule reads, from its name and input. */
export function touches(tool: string, input: Record<string, unknown>, cwd: string, home = SESSION_HOME): { paths: Touch[]; words: string[] } {
  const abs = (p: string, from: string) => posix.normalize(posix.isAbsolute(expand(p, home)) ? expand(p, home) : posix.join(from, expand(p, home)));
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  if (tool === "Read" && str("file_path")) return { paths: [{ path: abs(str("file_path")!, cwd), recursive: false }], words: [] };
  if (tool === "NotebookRead" && str("notebook_path")) return { paths: [{ path: abs(str("notebook_path")!, cwd), recursive: false }], words: [] };
  if (tool === "Grep") return { paths: [{ path: abs(str("path") ?? ".", cwd), recursive: true }], words: [str("pattern") ?? "", str("glob") ?? ""] };
  if (tool === "Glob") {
    const at = abs(str("path") ?? ".", cwd);
    const pattern = str("pattern") ?? "";
    return { paths: [{ path: at, recursive: false }, ...(/[*?[{]/.test(pattern) ? [] : [{ path: abs(pattern, at), recursive: false }])], words: [pattern] };
  }
  if (tool === "Skill" && str("skill")) return { paths: [{ path: skillFile(str("skill")!, home), recursive: false }], words: [] };
  if (tool !== "Bash" || !str("command")) return { paths: [], words: [] };
  const paths: Touch[] = [];
  const words: string[] = [];
  let here = cwd;
  for (const argv of shellCommands(str("command")!)) {
    const name = posix.basename(argv[0] ?? "");
    if (name === "cd") {
      if (argv[1]) here = abs(argv[1], here);
      continue;
    }
    const flags = argv.filter((w) => w.startsWith("-"));
    const recursive = RECURSIVE.has(name) || (GREPS.has(name) && flags.some((f) => /^-[A-Za-z]*[rR]/.test(f) || f === "--recursive" || f === "--dereference-recursive")) || (name === "git" && argv.includes("grep")) || (name === "diff" && flags.some((f) => /^-[A-Za-z]*r/.test(f) || f === "--recursive"));
    for (const w of argv.slice(1)) {
      words.push(w);
      const v = w.startsWith("--") && w.includes("=") ? w.slice(w.indexOf("=") + 1) : w;
      if (!v || v.startsWith("-") || /^[a-z]+:\/\//i.test(v)) continue;
      if (v.includes("/") || v.startsWith("~") || v.startsWith("$HOME") || v.startsWith("${HOME}") || here !== cwd) paths.push({ path: abs(v, here), recursive });
    }
    if (here !== cwd) paths.push({ path: here, recursive });
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
  const cases = suiteCases(o.suite).cases;
  const flags: Flag[] = [];
  const sessions: Record<string, number> = {};
  const runs = join(o.run, "runs");
  for (const model of existsSync(runs) ? readdirSync(runs).sort() : []) {
    for (const arm of readdirSync(join(runs, model)).sort()) {
      if (!ROOTS[arm]) continue;
      for (const u of listed) {
        const unit = unitOf(u.id, "units.json");
        const files = audit.get(unit.id + " " + arm) ?? new Set<string>();
        const fixes = unit.blockers.map((b) => cases.get(b.case)).map((c) => (c && !isPlanCase(c) ? c.fix.commit : undefined)).filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
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
            const inRoots = paths.map((x) => ({ ...x, tree: treePath(arm, x.path, home) })).filter((x) => x.tree !== null);
            for (const x of inRoots) {
              if (files.has(x.tree!)) flag("read", call.tool, call.id, x.path, x.tree!);
              else if (x.recursive) for (const f of files) if (x.tree === "" || f.startsWith(x.tree + "/")) {
                flag("recursive", call.tool, call.id, x.path, f);
                break;
              }
            }
            if (!inRoots.length) continue;
            const hit = words.find((w) => prWord.test(w) || (w.toLowerCase().match(/[0-9a-f]{7,40}/g) ?? []).some((h) => fixes.some((f) => f.startsWith(h))));
            if (hit !== undefined) flag("search", call.tool, call.id, inRoots[0]!.path, hit);
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

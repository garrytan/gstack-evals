// Copyright (c) 2026 Garry Tan. MIT License.
// The head-to-head's exposure detectors and read audit (post section 8), frozen from each pack's code at its pin through
// markers.json (markers.ts). A detector reads a session's transcripts: the SDK message records the session runner writes
// (sdk-messages.jsonl) and Claude Code's own transcript (claude-session.jsonl), where an expanded skill body and hook
// context appear. Loaded: the entry command expanded (a <command-name> block, or a "Base directory for this skill"
// marker under the pack's install), a pack skill launched by the Skill tool, or a pack's session-start block. Procedure
// ran: the pack's own marker of its procedure, below. On bug entries gstack's exposure is the installed pack, so gstack
// and gstack-oneline count as loaded and as procedure ran in every such session. The read audit lists every path a
// session's tools read under another arm's install roots (ArmInstall.roots, relative to the session HOME).
import { readFileSync } from "node:fs";
import { h2hFail } from "../prereg.ts";
import { ALL_ARMS, type ArmInstall, type Entry, type Exposure, type H2hArm } from "../types.ts";
import { lead, readMarkers, type Markers, type PackMarkers } from "./markers.ts";

type Rec = Record<string, any>;
/** One transcript event in order: text an author wrote, a tool call, a tool result, or context Claude Code or a hook
 *  injected (a slash command's expansion, a hook's output, a system record). main is false inside a subagent. */
export interface Ev { at: number; kind: "text" | "tool_use" | "tool_result" | "context"; role: string; main: boolean; text: string; name?: string; input?: Rec; id?: string; error?: boolean }

export const SESSION_HOME = "/root";
const TODO_TOOLS = new Set(["TodoWrite", "TaskCreate"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead", "LS"]);
/** A test file by its path, in every language the units carry. */
export const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|testing|e2e)\/|[._-](test|spec|tests)\.[A-Za-z0-9]+$|_test\.go$|(^|\/)test_[^/]*\.[A-Za-z0-9]+$|Tests?\.(java|kt|cs|scala)$|(^|\/)src\/test\//;
/** A Bash result that shows a failing test run. */
const FAILING = /\b(FAIL|FAILED|failing|failures?|AssertionError|panicked|assertion failed)\b|Exit code [1-9]/;

const str = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : typeof b === "string" ? b : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));

/** Every event of one transcript, in the SDK record shape (AssistantMessage, UserMessage, SystemMessage, ResultMessage)
 *  or Claude Code's own (assistant, user, attachment, system); any other record is context. */
export function events(records: Rec[], start = 0): Ev[] {
  const out: Ev[] = [];
  const push = (e: Omit<Ev, "at">) => out.push({ at: start + out.length, ...e });
  for (const r of records) {
    const sdk = typeof r.type === "string" && /Message$/.test(r.type);
    const role = sdk ? String(r.type).replace(/Message$/, "").toLowerCase() : String(r.type ?? "");
    const main = sdk ? (r.parent_tool_use_id ?? null) === null : r.isSidechain !== true;
    const content = sdk ? r.content : r.message?.content;
    if ((role === "assistant" || role === "user") && content !== undefined) {
      if (typeof content === "string") {
        push({ kind: role === "assistant" ? "text" : "context", role, main, text: content });
        continue;
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type === "tool_use") push({ kind: "tool_use", role, main, text: JSON.stringify(b.input ?? {}), name: String(b.name), input: b.input ?? {}, id: b.id });
        else if (b?.type === "tool_result") push({ kind: "tool_result", role, main, text: str(b.content), id: b.tool_use_id, error: b.is_error === true || str(b.content).includes("<tool_use_error>") });
        else if (b?.type === "text" && typeof b.text === "string") push({ kind: role === "assistant" ? "text" : "context", role, main, text: b.text });
        else if (b !== null && b !== undefined) push({ kind: "context", role, main, text: JSON.stringify(b) });
      }
      if (!sdk && r.toolUseResult !== undefined) push({ kind: "tool_result", role, main, text: JSON.stringify(r.toolUseResult) });
      continue;
    }
    if (role === "result" && typeof r.result === "string") push({ kind: "text", role: "assistant", main: true, text: r.result });
    else push({ kind: "context", role, main, text: JSON.stringify(r) });
  }
  return out;
}

/** Reads one or more JSON-lines transcripts. A torn last line is dropped; any other line that is not an object refuses. */
export function readEvents(files: string[]): Ev[] {
  const all: Ev[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n").filter((l) => l.trim() !== "");
    const recs: Rec[] = [];
    lines.forEach((l, i) => {
      try {
        const v = JSON.parse(l);
        if (v && typeof v === "object" && !Array.isArray(v)) return void recs.push(v);
      } catch {}
      if (i !== lines.length - 1) h2hFail("E_H2H_EXPOSURE", f + " line " + (i + 1) + " is not a JSON object");
    });
    all.push(...events(recs, all.length));
  }
  return all;
}

/** all is every event's text; ctx leaves out tool results, so a file the agent read never counts as context it got. */
interface Read { evs: Ev[]; all: string; ctx: string; uses: Array<Ev & { ok: boolean; result: string }> }
function prepare(evs: Ev[]): Read {
  const results = new Map<string, Ev>();
  for (const e of evs) if (e.kind === "tool_result" && e.id) results.set(e.id, e);
  const uses = evs.filter((e) => e.kind === "tool_use").map((e) => {
    const r = e.id ? results.get(e.id) : undefined;
    return { ...e, ok: !!r && !r.error, result: r?.text ?? "" };
  });
  return { evs, all: evs.map((e) => e.text).join("\n"), ctx: evs.filter((e) => e.kind !== "tool_result").map((e) => e.text).join("\n"), uses };
}

const nameOf = (pm: PackMarkers, raw: string): string | null => {
  const n = raw.replace(/^\//, "");
  if (pm.plugin) {
    const [ns, rest] = n.includes(":") ? [n.slice(0, n.indexOf(":")), n.slice(n.indexOf(":") + 1)] : [null, n];
    if (ns !== null && ns !== pm.plugin) return null;
    const base = rest.split(/\s/)[0]!;
    return pm.skills.includes(base) || pm.commands.includes(base) ? base : null;
  }
  const base = n.split(/\s/)[0]!;
  return pm.skills.includes(base) ? base : null;
};

/** The pack's loaded markers: commands expanded, skill base directories under its install, Skill launches, session text. */
function loadedMarkers(pm: PackMarkers, r: Read, session: string | null): string[] {
  const out: string[] = [];
  for (const m of r.ctx.matchAll(/<command-name>\s*(\/[^<\s]+)\s*<\/command-name>/g)) if (nameOf(pm, m[1]!)) out.push("command:" + m[1]);
  for (const m of r.ctx.matchAll(/Base directory for this skill:\s*(\S+)/g)) {
    const path = m[1]!.replace(/\/+$/, "");
    const name = path.split("/").at(-1)!;
    const under = path.includes("/.claude/skills/") || (pm.plugin !== null && path.includes("/" + pm.plugin + "/") && /\/skills\/[^/]+$/.test(path));
    if (under && pm.skills.includes(name)) out.push("base:" + path);
  }
  for (const u of r.uses) if (u.name === "Skill" && u.ok && typeof u.input?.skill === "string" && nameOf(pm, u.input.skill)) out.push("skill:" + u.input.skill);
  if (session && r.ctx.includes(session)) out.push("session:" + session);
  return [...new Set(out)];
}

const bashUses = (r: Read) => r.uses.filter((u) => u.name === "Bash" && typeof u.input?.command === "string");
const writes = (r: Read) => r.uses.filter((u) => WRITE_TOOLS.has(u.name!) && typeof (u.input?.file_path ?? u.input?.notebook_path) === "string").map((u) => ({ at: u.at, path: String(u.input!.file_path ?? u.input!.notebook_path), ok: u.ok }));
/** Every todo list a session opened: each TodoWrite call's items, and its TaskCreate subjects in order. */
function todoLists(r: Read): Array<{ at: number; items: string[] }> {
  const lists = r.uses.filter((u) => u.name === "TodoWrite" && Array.isArray(u.input?.todos)).map((u) => ({ at: u.at, items: (u.input!.todos as Rec[]).map((t) => String(t?.content ?? t?.subject ?? "")) }));
  const tasks = r.uses.filter((u) => u.name === "TaskCreate" && typeof u.input?.subject === "string");
  if (tasks.length) lists.push({ at: tasks[0]!.at, items: tasks.map((u) => String(u.input!.subject)) });
  return lists;
}

/** Each arm's procedure markers (section 8). entry is the session's entry. */
function procedureMarkers(arm: H2hArm, entry: Entry, m: Markers, r: Read, files: string[]): string[] {
  const out: string[] = [];
  const pk = m.packs;
  if (arm === "gstack" || arm === "gstack-oneline" || arm === "gstack-qa") {
    const skill = arm === "gstack-qa" ? "qa" : "autoplan";
    for (const b of bashUses(r)) if (new RegExp(pk.gstack!.strings.skill_start!.replace(/\s+/g, "\\s+") + "\\s+[\"']?" + skill + "[\"']?(\\s|$)").test(b.input!.command)) out.push("skill-start:" + skill);
    if (arm === "gstack-qa") return bashUses(r).filter((b) => b.input!.command.includes(pk.gstack!.strings.browse!) || /(^|[\s;&|(])"?\$B"?\s+\w/.test(b.input!.command)).length ? ["browse", ...out] : [];
    return out;
  }
  if (arm === "gstack-pony") return r.ctx.includes(pk.ponystack!.strings.phase!) ? ["phase:" + pk.ponystack!.strings.phase!.trim()] : [];
  if (arm === "superpowers") {
    const sp = pk.superpowers!;
    const said = r.evs.filter((e) => e.kind === "text" && e.role === "assistant" && e.main).flatMap((e) => [...e.text.matchAll(/\bUsing\s+`?(?:superpowers:)?([a-z][a-z-]+)`?\s+to\b/gi)].filter((x) => sp.skills.includes(x[1]!.toLowerCase())).map((x) => ({ at: e.at, skill: x[1]!.toLowerCase() })));
    const first = said[0];
    if (first && r.uses.some((u) => TODO_TOOLS.has(u.name!) && u.at > first.at)) out.push("announce:" + first.skill, "todo");
    return out;
  }
  if (arm === "agent-skills") {
    const w = writes(r);
    if (entry === "feature") {
      const spec = w.find((x) => /(^|\/)SPEC\.md$/.test(x.path));
      const plan = w.find((x) => /(^|\/)tasks\/plan\.md$/.test(x.path));
      return spec && plan ? ["spec:" + spec.path, "plan:" + plan.path] : [];
    }
    const test = w.find((x) => TEST_PATH.test(x.path));
    const source = w.find((x) => !TEST_PATH.test(x.path) && !/\.(md|txt|json|ya?ml|toml|lock)$/i.test(x.path));
    if (!test || !source || test.at > source.at) return [];
    const failed = bashUses(r).find((b) => b.at > test.at && b.at < source.at && (b.result !== "" && (!b.ok || FAILING.test(b.result))));
    return failed ? ["test-first:" + test.path, "failing-run"] : [];
  }
  if (arm === "gsd") {
    const g = pk.gsd!.strings;
    const tool = bashUses(r).some((b) => b.input!.command.includes(g.run!) || b.input!.command.includes(g.tools!));
    const dirs = [g.quick_dir!, g.debug_dir!.replace(/\/?$/, "/")];
    const wrote = [...writes(r).map((x) => x.path), ...files, ...bashUses(r).filter((b) => /(>|\bmkdir\b|\btee\b|\bcp\b|\bmv\b|\btouch\b)/.test(b.input!.command)).map((b) => b.input!.command)].find((p) => dirs.some((d) => p.includes(d)));
    return tool && wrote ? ["gsd-tools", "planning:" + wrote.slice(0, 120)] : [];
  }
  if (arm === "pstack") {
    const books = pk.pstack!.playbooks ?? {};
    for (const list of todoLists(r)) {
      const got = list.items.slice(0, 2).map((t) => new Bun.CryptoHasher("sha256").update(lead(t)).digest("hex"));
      const book = Object.entries(books).find(([, steps]) => steps.length && steps.every((s, i) => got[i] === s));
      if (book) return ["playbook:" + book[0]];
    }
    return [];
  }
  if (arm === "tstack") {
    const want = [pk.tstack!.strings.sol_loop!, pk.tstack!.strings.file_pr!, pk.tstack!.strings.babysit_pr!];
    for (const u of r.uses) {
      if (u.name === "Skill" && want.includes(String(u.input?.skill ?? ""))) out.push("skill:" + u.input!.skill);
      if (u.name === "Read" && want.some((s) => String(u.input?.file_path ?? "").endsWith("/" + s + "/SKILL.md"))) out.push("read:" + u.input!.file_path);
      if (u.name === "Bash" && /\bgh\s+pr\s+create\b|\bpr-wait\b/.test(String(u.input?.command ?? ""))) out.push("bash:" + String(u.input!.command).slice(0, 80));
    }
    for (const s of want) if (new RegExp("Base directory for this skill:\\s*\\S*/" + s + "/?(\\s|$)", "m").test(r.ctx)) out.push("base:" + s);
    return [...new Set(out)];
  }
  return [];
}

const PACK_OF: Partial<Record<H2hArm, string>> = { gstack: "gstack", "gstack-oneline": "gstack", "gstack-qa": "gstack", "gstack-pony": "ponystack", superpowers: "superpowers", "agent-skills": "agent-skills", gsd: "gsd", pstack: "pstack", tstack: "tstack" };

/** Section 8's exposure for one session: loaded, procedure ran, and the markers that matched. files, when given, are the
 *  paths the session's tree holds at its end (GSD's planning files can be written by its own tools). */
export function exposure(arm: H2hArm, entry: Entry, evs: Ev[], o: { markers?: Markers; files?: string[] } = {}): Exposure {
  if (!(ALL_ARMS as readonly string[]).includes(arm)) h2hFail("E_H2H_EXPOSURE", "unknown arm " + arm);
  const m = o.markers ?? readMarkers();
  const r = prepare(evs);
  const pack = PACK_OF[arm];
  if (!pack) return { loaded: false, procedure: false, markers: [], foreign_reads: [] };
  const pm = m.packs[pack]!;
  const loaded = loadedMarkers(pm, r, pack === "superpowers" ? pm.strings.session! : pack === "ponystack" ? pm.strings.session! : null);
  if ((arm === "gstack" || arm === "gstack-oneline") && entry === "bug") return { loaded: true, procedure: true, markers: ["installed-pack", ...loaded], foreign_reads: [] };
  const proc = procedureMarkers(arm, entry, m, r, o.files ?? []);
  return { loaded: loaded.length > 0, procedure: proc.length > 0, markers: [...loaded, ...proc], foreign_reads: [] };
}

/** arms-pins.json as part A writes it: an array of ArmInstall, an object with an arms array, or a map by arm. */
export function readInstalls(file: string): ArmInstall[] {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const list: ArmInstall[] = Array.isArray(j) ? j : Array.isArray(j?.arms) ? j.arms : j && typeof j === "object" ? Object.values(j).filter((v): v is ArmInstall => !!v && typeof v === "object" && "roots" in (v as object)) : [];
  if (!list.length || list.some((a) => !(ALL_ARMS as readonly string[]).includes(a.arm) || !Array.isArray(a.roots))) h2hFail("E_H2H_EXPOSURE", file + " holds no ArmInstall records with an arm and its roots");
  return list;
}

/** The roots an arm's own home holds: its own, and those of the arm whose home it reuses. */
const ownRoots = (arm: H2hArm, installs: ArmInstall[]): Set<string> => {
  const by = new Map(installs.map((a) => [a.arm, a]));
  const out = new Set<string>();
  for (let a = by.get(arm), n = 0; a && n < 5; a = a.home_of ? by.get(a.home_of) : undefined, n++) for (const r of a.roots) out.add(r);
  return out;
};

/** The read audit: every path the session's tools (Read, Grep, Glob and their kin, and Bash commands) touch under an
 *  install root of another arm, as the arm's own install would not hold it; drive reads are listed apart. Without arm,
 *  every hit under any arm's roots is returned with that arm. */
export function readAudit(evs: Ev[], installs: ArmInstall[], arm?: H2hArm, home = SESSION_HOME): { foreign_reads: string[]; drive_reads: string[]; by_arm: Record<string, string[]> } {
  const own = arm ? ownRoots(arm, installs) : new Set<string>();
  const roots = installs.flatMap((a) => a.roots.filter((r) => !own.has(r)).map((r) => ({ arm: a.arm, abs: home + "/" + r.replace(/^\/+|\/+$/g, "") })));
  const forms = (abs: string) => [abs, "~" + abs.slice(home.length), "$HOME" + abs.slice(home.length), "${HOME}" + abs.slice(home.length)];
  const by_arm: Record<string, string[]> = {};
  const drive: string[] = [];
  for (const u of prepare(evs).uses) {
    const cands = READ_TOOLS.has(u.name!) ? [u.input?.file_path, u.input?.path, u.input?.notebook_path, u.input?.pattern].filter((x): x is string => typeof x === "string").map((p) => p.replace(/^~(?=\/)/, home)) : u.name === "Bash" && typeof u.input?.command === "string" ? [u.input.command] : [];
    for (const c of cands) {
      if (/\.capy\/drive/.test(c)) drive.push(u.name + ": " + c.slice(0, 200));
      for (const r of roots) {
        const hit = READ_TOOLS.has(u.name!) ? c === r.abs || c.startsWith(r.abs + "/") : forms(r.abs).some((f) => c.includes(f));
        if (hit) (by_arm[r.arm] ??= []).push(u.name + ": " + c.slice(0, 200));
      }
    }
  }
  for (const k of Object.keys(by_arm)) by_arm[k] = [...new Set(by_arm[k])];
  return { foreign_reads: [...new Set(Object.values(by_arm).flat())], drive_reads: [...new Set(drive)], by_arm };
}

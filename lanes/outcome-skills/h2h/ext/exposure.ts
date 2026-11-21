// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's exposure detectors (wiki/plans/2026-11-21-geva-568-skill-pack-h2h-sol-particle-prereg section 8, Codex). They
// read Codex 0.170.0 rollout files (the root thread's, and any sub-agent's as side events) into the base detectors' event
// shape (sessions/exposure.ts Ev): assistant messages as text, user and developer messages as context (the skill listing
// and the <skill> items Codex injects for a $name mention arrive here), each tool call and its output, every command a
// code-mode cell ran (a CommandExecution item) as a Bash call with its output and exit, and every file a FileChange item
// wrote as a Write or Edit. A skill load is a <skill> item naming one of the pack's skills, or a command output carrying
// the frontmatter name line of one of the pack's SKILL.md files from a command that names that file. Procedure markers
// are the base detectors' (gstack's gstack-skill-start --skill autoplan, agent-skills' failing test before the source
// edit or SPEC.md and tasks/plan.md, GSD's gsd-tools and planning files, tstack's steps), read through the same mapping,
// plus Codex's own forms: a <skill> item for one of tstack's three steps, and Superpowers' announcement followed by a
// plan, which on Codex (no todo tool in code mode) is a plan file written under docs/superpowers/plans/. gstack's
// bug-unit exposure is the installed pack (the skill listing names its skills). The line arm's exposure is AGENTS.md's
// text in the session's first request.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { h2hFail } from "../prereg.ts";
import type { Entry, Exposure, H2hArm } from "../types.ts";
import { exposure, type Ev } from "../sessions/exposure.ts";
import { readMarkers, type Markers } from "../sessions/markers.ts";
import { S_ARMS } from "./prereg.ts";

type SArm = (typeof S_ARMS)[number];
type Rec = Record<string, any>;
const fail = (why: string): never => h2hFail("E_H2HX_CODEX_EXPOSURE", why);
const texts = (content: unknown): string => (Array.isArray(content) ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : typeof content === "string" ? content : "");
/** Superpowers' announcement, as the base detector reads it. */
const ANNOUNCE = /\bUsing\s+`?(?:superpowers:)?([a-z][a-z-]+)`?\s+to\b/gi;

/** Each s-* arm's pack in markers.json and the base arm whose detectors it shares. */
export const CODEX_PACK: Record<SArm, { pack: string | null; base: H2hArm }> = {
  "s-none": { pack: null, base: "none" },
  "s-gstack": { pack: "gstack", base: "gstack" },
  "s-gstack-line": { pack: "gstack", base: "gstack" },
  "s-superpowers": { pack: "superpowers", base: "superpowers" },
  "s-agent-skills": { pack: "agent-skills", base: "agent-skills" },
  "s-gsd": { pack: "gsd", base: "gsd" },
  "s-tstack": { pack: "tstack", base: "tstack" },
};

/** One rollout's records as base events. main is false for a sub-agent's rollout. */
export function codexEvents(records: Rec[], main = true, start = 0): Ev[] {
  const out: Ev[] = [];
  const push = (e: Omit<Ev, "at" | "main">) => out.push({ at: start + out.length, main, ...e });
  for (const r of records) {
    const p = r.payload ?? {};
    if (r.type === "response_item") {
      if (p.type === "message") push({ kind: p.role === "assistant" ? "text" : "context", role: String(p.role), text: texts(p.content) });
      else if (p.type === "custom_tool_call") push({ kind: "tool_use", role: "assistant", text: String(p.input ?? ""), name: String(p.name), input: { input: p.input }, id: p.call_id });
      else if (p.type === "function_call") {
        let args: Rec = {};
        try {
          args = JSON.parse(p.arguments ?? "{}");
        } catch {}
        push({ kind: "tool_use", role: "assistant", text: String(p.arguments ?? ""), name: String(p.name), input: args, id: p.call_id });
      } else if (p.type === "custom_tool_call_output" || p.type === "function_call_output") push({ kind: "tool_result", role: "user", text: typeof p.output === "string" ? p.output : texts(p.output), id: p.call_id });
      continue;
    }
    if (r.type !== "event_msg" || p.type !== "item_completed") continue;
    const it = p.item ?? {};
    if (it.type === "CommandExecution") {
      const cmd = Array.isArray(it.command) ? String(it.command.at(-1)) : String(it.command ?? "");
      push({ kind: "tool_use", role: "assistant", text: JSON.stringify({ command: cmd }), name: "Bash", input: { command: cmd }, id: it.id });
      push({ kind: "tool_result", role: "user", text: String(it.aggregated_output ?? ""), id: it.id, error: typeof it.exit_code === "number" && it.exit_code !== 0 });
    } else if (it.type === "FileChange") {
      for (const [path, ch] of Object.entries((it.changes ?? {}) as Record<string, Rec>)) {
        const id = it.id + ":" + path;
        push({ kind: "tool_use", role: "assistant", text: JSON.stringify({ file_path: path }), name: ch?.type === "add" ? "Write" : "Edit", input: { file_path: path }, id });
        push({ kind: "tool_result", role: "user", text: String(it.stdout ?? ""), id, error: it.status !== "completed" });
      }
    }
  }
  return out;
}

/** Reads rollout files (plain or gzip JSON lines) into events: the first is the root thread, the rest sub-agents. A torn
 *  last line is dropped; any other line that is not a JSON object refuses (E_H2HX_CODEX_EXPOSURE). */
export function readCodexEvents(files: string[]): Ev[] {
  const all: Ev[] = [];
  files.forEach((f, n) => {
    const raw = readFileSync(f);
    const lines = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n").filter((l) => l.trim() !== "");
    const recs: Rec[] = [];
    lines.forEach((l, i) => {
      try {
        const v = JSON.parse(l);
        if (v && typeof v === "object" && !Array.isArray(v)) return void recs.push(v);
      } catch {}
      if (i !== lines.length - 1) fail(f + " line " + (i + 1) + " is not a JSON object");
    });
    all.push(...codexEvents(recs, n === 0, all.length));
  });
  return all;
}

/** The pack's skill a Codex skill name names: plugin skills carry the plugin's namespace (superpowers:brainstorming). */
const packSkill = (pm: Markers["packs"][string], name: string): string | null => {
  const [ns, base] = name.includes(":") ? [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)] : [null, name];
  if (ns !== null && ns !== pm.plugin) return null;
  return pm.skills.includes(base!) ? base! : null;
};

/** The pack's loaded markers on Codex: <skill> items naming its skills, and command outputs carrying one of its SKILL.md
 *  frontmatter name lines from a command that names that SKILL.md. */
export function codexLoaded(pack: string, evs: Ev[], m: Markers = readMarkers()): string[] {
  const pm = m.packs[pack] ?? fail("markers.json has no pack " + pack);
  const out: string[] = [];
  for (const e of evs) if (e.kind === "context") for (const x of e.text.matchAll(/<skill>\s*<name>([^<]+)<\/name>\s*<path>([^<]+)<\/path>/g)) if (packSkill(pm, x[1]!.trim())) out.push("skill:" + x[1]!.trim());
  const results = new Map(evs.filter((e) => e.kind === "tool_result" && e.id).map((e) => [e.id!, e]));
  for (const u of evs) {
    if (u.kind !== "tool_use" || u.name !== "Bash") continue;
    const cmd = String(u.input?.command ?? "");
    const r = u.id ? results.get(u.id) : undefined;
    if (!r || r.error) continue;
    for (const sk of pm.skills) if (cmd.includes("/" + sk + "/SKILL.md") && new RegExp("^name:\\s*[\"']?(?:" + (pm.plugin ? pm.plugin + ":" : "") + ")?" + sk.replace(/-/g, "\\-") + "[\"']?\\s*$", "m").test(r.text)) out.push("read:" + sk);
  }
  return [...new Set(out)];
}

/** Section 8's exposure for one part S session. firstRequest is the session's first request body as the proxy saw it and
 *  agentsMd prereg.json's AGENTS.md text (the line arm's exposure); files are the paths its tree holds at its end. */
export function codexExposure(arm: SArm, entry: Entry, evs: Ev[], o: { markers?: Markers; files?: string[]; firstRequest?: string; agentsMd?: string } = {}): Exposure {
  if (!(S_ARMS as readonly string[]).includes(arm)) fail("unknown part S arm " + arm);
  const { pack, base } = CODEX_PACK[arm];
  if (!pack) return { loaded: false, procedure: false, markers: [], foreign_reads: [] };
  const m = o.markers ?? readMarkers();
  const loaded = codexLoaded(pack, evs, m);
  const b = exposure(base, entry, evs, { markers: m, files: o.files ?? [] });
  const proc = b.markers.filter((x) => !/^(command|base|skill|session):/.test(x) && x !== "installed-pack");
  const ctx = evs.filter((e) => e.kind === "context").map((e) => e.text).join("\n");
  if (pack === "gstack") {
    const listed = /<skills_instructions>[\s\S]*\(gstack\)/.test(ctx) ? ["listing"] : [];
    const g = entry === "bug" ? { loaded: listed.length > 0 || loaded.length > 0, procedure: listed.length > 0, markers: ["installed-pack", ...listed, ...loaded] } : { loaded: loaded.length > 0, procedure: proc.length > 0, markers: [...loaded, ...proc] };
    if (arm === "s-gstack") return { ...g, foreign_reads: [] };
    const want = o.agentsMd ?? fail("s-gstack-line's exposure needs prereg.json's AGENTS.md text");
    const seen = o.firstRequest !== undefined && o.firstRequest.includes(JSON.stringify(want.trim()).slice(1, -1));
    return { loaded: seen, procedure: seen, markers: [...(seen ? ["agents-md"] : []), ...g.markers], foreign_reads: [] };
  }
  if (pack === "superpowers") {
    const sp = m.packs.superpowers!;
    const said = evs.filter((e) => e.kind === "text" && e.main).flatMap((e) => [...e.text.matchAll(ANNOUNCE)].filter((x) => sp.skills.includes(x[1]!.toLowerCase())).map((x) => ({ at: e.at, skill: x[1]!.toLowerCase() })));
    const first = said[0];
    const plan = first ? evs.find((e) => e.at > first.at && e.kind === "tool_use" && (e.name === "Write" || e.name === "Edit") && /(^|\/)docs\/superpowers\/plans\/[^/]+\.md$/.test(String(e.input?.file_path ?? ""))) : undefined;
    const p = first && plan ? ["announce:" + first.skill, "plan:" + String(plan.input!.file_path)] : [];
    return { loaded: loaded.length > 0, procedure: p.length > 0, markers: [...loaded, ...p], foreign_reads: [] };
  }
  if (pack === "tstack") {
    const steps = [m.packs.tstack!.strings.sol_loop!, m.packs.tstack!.strings.file_pr!, m.packs.tstack!.strings.babysit_pr!];
    const own = loaded.map((x) => x.replace(/^(skill|read):/, "")).filter((x) => steps.includes(x)).map((x) => "step:" + x);
    const p = [...new Set([...proc, ...own])];
    return { loaded: loaded.length > 0, procedure: p.length > 0, markers: [...loaded, ...p], foreign_reads: [] };
  }
  return { loaded: loaded.length > 0, procedure: proc.length > 0, markers: [...loaded, ...proc], foreign_reads: [] };
}

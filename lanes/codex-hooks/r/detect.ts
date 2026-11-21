// Copyright (c) 2026 Garry Tan. MIT License.
// Section 4.5's load detector for part R, read from a trial's copied Codex rollouts (codex-sessions/, the root thread's and
// any sub-agent's). A session loaded a skill when (a) a tool result holds a line unique to it, (b) a tool result holds one
// of its lines and the call that made it names its SKILL.md alone, with no wildcard path, or (c) Codex injected it as a
// <skill> user message. A call that names the file and whose result holds none of its lines is a failed load. The skills'
// lines come from the gstack arm's tar (arms.ts skillLines, quick/laneb/arms/manifests/codex-hooks-r/skill-lines.json).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SKILL_LINES, type SkillLines } from "./arms.ts";
import { DETECT_SKILLS, PROVE_IT, type DetectSkill } from "./pins.ts";

export const HOOK_LINE = "gstack skill routing (UserPromptSubmit hook;";

export type Rule = "a" | "b" | "c";
export type SkillLoad = {
  loaded: boolean;
  rules: Rule[];
  at_first_call: boolean;
  where: ("root" | "sub")[];
  failed: number;
  b_excluded: number;
};
export type Detection = {
  root: string | null;
  threads: number;
  first_call: string | null;
  loads: Record<DetectSkill, SkillLoad>;
  steps_arrived: boolean;
  named_in_text: boolean;
  line_delivered: boolean;
};

type Item = { root: boolean; type: string; p: any };

const walk = (d: string): string[] =>
  existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : [];

function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

/** A tool result as the model read it: the output string, or its text parts joined. */
export function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  const parts = Array.isArray(output) ? output : (output as { content?: unknown })?.content;
  if (Array.isArray(parts)) return parts.map((c) => (typeof c === "string" ? c : typeof c?.text === "string" ? c.text : "")).join("\n");
  return strings(output).join("\n");
}

/** A call's input: function_call arguments (their string values, when they parse) or custom_tool_call input. */
export function callInput(p: any): string {
  if (typeof p.input === "string") return p.input;
  if (typeof p.arguments !== "string") return strings(p.arguments ?? p.action ?? "").join("\n");
  try { return strings(JSON.parse(p.arguments)).join("\n"); } catch { return p.arguments; }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const SKILLS_DIR = String.raw`(?:\.codex|CODEX_HOME\}?|\.agents)/skills/`;
/** Whether a call names a skill folder's SKILL.md by any path form: absolute, ~/.codex, $CODEX_HOME, relative to the skills
 *  root, or a cd into the folder followed by a bare SKILL.md. */
export function namesFile(input: string, folder: string): boolean {
  if (new RegExp(String.raw`(?:^|[^\w.-])${esc(folder)}/SKILL\.md`).test(input)) return true;
  return new RegExp(SKILLS_DIR + esc(folder) + String.raw`(?![\w.-])`).test(input) && /(?:^|[^\w./-])SKILL\.md/.test(input);
}
/** Whether a call names any file under the skills root outside the folder. */
export function namesOther(input: string, folder: string): boolean {
  const named = [...input.matchAll(/([\w.-]+)\/SKILL\.md/g), ...input.matchAll(new RegExp(SKILLS_DIR + String.raw`([\w.-]+)`, "g"))].map((m) => m[1]);
  return named.some((f) => f !== folder);
}
/** Whether a call holds a wildcard path: a token with a slash or SKILL in it and a *, ? or {a,b}. */
export function hasWildcard(input: string): boolean {
  return input.split(/[\s"'`;|&()<>]+/).some((t) => (t.includes("/") || t.includes("SKILL")) && (/[*?]/.test(t) || /\{[^}]*,[^}]*\}/.test(t)));
}

export function readSkillLines(file = SKILL_LINES): Record<DetectSkill, SkillLines> {
  return JSON.parse(readFileSync(file, "utf8"));
}

function readItems(ev: string): { items: Item[]; root: string | null; threads: number } {
  const items: Item[] = [];
  let root: string | null = null, threads = 0;
  for (const file of walk(join(ev, "codex-sessions")).filter((f) => /rollout-.*\.jsonl$/.test(f))) {
    let isRoot = true;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      const p = e?.payload ?? {};
      if (e.type === "session_meta") {
        threads++;
        isRoot = !p.parent_thread_id;
        if (isRoot && root === null) root = p.id ?? null;
      }
      if (e.type === "response_item" && typeof p.type === "string") items.push({ root: isRoot, type: p.type, p });
    }
  }
  return { items, root, threads };
}

/** One session's loads and section 4.6's load fields. */
export function detect(ev: string, skills: Record<DetectSkill, SkillLines> = readSkillLines()): Detection {
  const { items, root, threads } = readItems(ev);
  const calls = new Map<string, { input: string; root: boolean; out: string | null }>();
  const outputs: { id: string | null; text: string; root: boolean }[] = [];
  let first_call: string | null = null, sawOutput = false, line_delivered = false, named_in_text = false;
  const injected: { text: string; root: boolean }[] = [];
  for (const it of items) {
    const { p } = it;
    if (it.type.endsWith("_call")) {
      const input = callInput(p);
      if (/prove-it/i.test(input)) named_in_text = true;
      if (typeof p.call_id === "string") calls.set(p.call_id, { input, root: it.root, out: null });
      if (it.root && first_call === null) first_call = p.call_id ?? "";
    }
    if (it.type.endsWith("_call_output")) {
      const text = outputText(p.output);
      outputs.push({ id: p.call_id ?? null, text, root: it.root });
      const c = calls.get(p.call_id);
      if (c) c.out = (c.out ?? "") + text;
    }
    if (it.type === "message") {
      const text = (p.content ?? []).map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n");
      if (p.role === "assistant" && /prove-it/i.test(text)) named_in_text = true;
      if (p.role === "user" && text.includes("<skill>")) injected.push({ text, root: it.root });
      if (it.root && !sawOutput && p.role === "developer" && text.startsWith(HOOK_LINE)) line_delivered = true;
    }
    if (it.root && (it.type.endsWith("_call") || it.type === "reasoning" || (it.type === "message" && p.role === "assistant"))) sawOutput = true;
  }
  const loads = {} as Record<DetectSkill, SkillLoad>;
  for (const name of Object.keys(DETECT_SKILLS) as DetectSkill[]) {
    const { lines, unique } = skills[name];
    const folder = DETECT_SKILLS[name].split("/").at(-2)!;
    const hits: { rule: Rule; id: string | null; root: boolean }[] = [];
    let failed = 0, b_excluded = 0;
    for (const o of outputs) if (unique.some((l) => o.text.includes(l))) hits.push({ rule: "a", id: o.id, root: o.root });
    for (const [id, c] of calls) {
      if (!namesFile(c.input, folder)) continue;
      if (!(c.out !== null && lines.some((l) => c.out!.includes(l)))) { failed++; continue; }
      if (namesOther(c.input, folder) || hasWildcard(c.input)) b_excluded++;
      else hits.push({ rule: "b", id, root: c.root });
    }
    for (const m of injected) if (new RegExp(String.raw`<name>${esc(folder)}</name>`).test(m.text) || namesFile(m.text.split("<path>")[1]?.split("</path>")[0] ?? "", folder)) hits.push({ rule: "c", id: null, root: m.root });
    loads[name] = {
      loaded: hits.length > 0,
      rules: (["a", "b", "c"] as Rule[]).filter((r) => hits.some((h) => h.rule === r)),
      at_first_call: first_call !== null && hits.some((h) => h.id === first_call),
      where: (["root", "sub"] as const).filter((w) => hits.some((h) => h.root === (w === "root"))),
      failed,
      b_excluded,
    };
  }
  const steps_arrived = outputs.some((o) => o.text.includes(PROVE_IT.stepLine));
  return { root, threads, first_call, loads, steps_arrived, named_in_text, line_delivered };
}

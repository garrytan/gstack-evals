// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's detectors, each taking its marker set as data so stage 1 can freeze markers per pin
// (prereg section 12 stage 4). They implement:
// - section 12's exposure, frozen: the session read the skill file and printed SESSION_KIND: interactive; it asked at
//   least two of its diagnostic or generative questions one at a time, each answered by a founder reply; and it wrote
//   its deliverable (a design doc or, on the new pin, a memo) to the state root;
// - section 7's kept-whole parts for a builder session in a skill arm, and its startup-only question list, which is also
//   guardrail G1's detector (section 10);
// - G2's questions asked per session and G3's founder replies before the closing message (section 10);
// - section 11's compliance checks, and pre-run change 1 item 4f's two descriptive checks (a SUCCESS line, a commitment
//   entry in the developer profile).
// The candidate markers live in score/markers/<pin>.json and score/markers/compliance.json, read from both pins'
// office-hours text; the rules for reading them are build-time choices 20 to 33 in score/README.md.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readTranscript } from "../../../src/trial/review/readers.ts";
import { replies } from "../../office-hours-founder/parse.ts";
import { isQuestion, sentences } from "../../office-hours-founder/score/counters.ts";
import { SESSION_KIND_LINE } from "../frozen.ts";
import type { Block, Compliance, Exposure, FounderTurn, KeptWhole, SkillArm } from "../types.ts";

type Patterns = Readonly<Record<string, RegExp>>;
export interface Markers {
  pin: SkillArm;
  sha: string;
  source_files: Readonly<Record<string, string>>;
  skill_loaded: { reads: readonly string[]; skill_tool: string; texts: readonly string[] };
  questions: Patterns;
  startup_only: { questions: Patterns; lines: Patterns };
  builder_mode: { reads: readonly string[]; doc_mode: RegExp };
  deliverables: { design: RegExp; memo: RegExp | null };
}
export interface ComplianceMarkers {
  kill_line: RegExp;
  success_line: RegExp;
  startup_doc_mode: RegExp;
  approved: RegExp;
  date: RegExp;
  number: RegExp;
  code_tools: readonly string[];
  code_extensions: readonly string[];
  profile_files: readonly string[];
}

const bad = (what: string, why: string): never => {
  throw new Error("E_OHR_MARKERS " + what + ": " + why);
};
const compile = (what: string, src: unknown, flags: string): RegExp => {
  if (typeof src !== "string" || !src) bad(what, "a pattern must be a non-empty string");
  try {
    return new RegExp(src as string, flags);
  } catch (e) {
    return bad(what, (e as Error).message);
  }
};
const patterns = (what: string, obj: unknown): Patterns => {
  if (!obj || typeof obj !== "object" || !Object.keys(obj).length) bad(what, "needs at least one pattern");
  return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([id, s]) => [id, compile(what + "." + id, s, "i")]));
};
const strings = (what: string, v: unknown): string[] => (Array.isArray(v) && v.every((s) => typeof s === "string" && s) ? (v as string[]) : bad(what, "must be a list of non-empty strings"));

/** A pin's marker set from its data (score/markers/<pin>.json, or a planted set in tests). */
export function markersFrom(d: any): Markers {
  if (d?.pin !== "current" && d?.pin !== "new") bad("pin", "must be current or new");
  return {
    pin: d.pin,
    sha: typeof d.sha === "string" && /^[0-9a-f]{40}$/.test(d.sha) ? d.sha : bad("sha", "must be a full commit sha"),
    source_files: d.source_files ?? {},
    skill_loaded: { reads: strings("skill_loaded.reads", d.skill_loaded?.reads), skill_tool: typeof d.skill_loaded?.skill_tool === "string" ? d.skill_loaded.skill_tool : bad("skill_loaded.skill_tool", "must be a string"), texts: strings("skill_loaded.texts", d.skill_loaded?.texts) },
    questions: patterns("questions", d.questions),
    startup_only: { questions: patterns("startup_only.questions", d.startup_only?.questions), lines: patterns("startup_only.lines", d.startup_only?.lines) },
    builder_mode: { reads: strings("builder_mode.reads", d.builder_mode?.reads), doc_mode: compile("builder_mode.doc_mode", d.builder_mode?.doc_mode, "m") },
    deliverables: { design: compile("deliverables.design", d.deliverables?.design, ""), memo: d.deliverables?.memo == null ? null : compile("deliverables.memo", d.deliverables.memo, "") },
  };
}
export function complianceFrom(d: any): ComplianceMarkers {
  return {
    kill_line: compile("kill_line", d?.kill_line, "i"),
    success_line: compile("success_line", d?.success_line, ""),
    startup_doc_mode: compile("startup_doc_mode", d?.startup_doc_mode, "m"),
    approved: compile("approved", d?.approved, "m"),
    date: compile("date", d?.date, "gi"),
    number: compile("number", d?.number, "i"),
    code_tools: strings("code_tools", d?.code_tools),
    code_extensions: strings("code_extensions", d?.code_extensions),
    profile_files: strings("profile_files", d?.profile_files),
  };
}
const json = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, "markers", name + ".json"), "utf8"));
export const loadMarkers = (pin: SkillArm): Markers => markersFrom(json(pin));
export const loadCompliance = (): ComplianceMarkers => complianceFrom(json("compliance"));

/** Founder replies the adviser received before the first closing message (pre-run change 1: delivered only). */
export const delivered = (turns: readonly FounderTurn[]): FounderTurn[] => turns.filter((t) => (t as FounderTurn & { delivered?: boolean }).delivered === true);

type Rec = Record<string, any>;
const resultText = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "");
/** The main agent's tool calls with their results, and the user-side text that is not a tool result. */
function toolsOf(transcript: string): { uses: Array<{ name: string; input: Rec; ok: boolean }>; userText: string } {
  const msgs = readTranscript(transcript).filter((m: Rec) => !m.parent_tool_use_id);
  const results = new Map<string, Rec>();
  const user: string[] = [];
  for (const m of msgs as Rec[]) {
    if (m.type !== "user") continue;
    const c = m.message?.content;
    if (typeof c === "string") user.push(c);
    else if (Array.isArray(c)) for (const b of c) b?.type === "tool_result" ? results.set(b.tool_use_id, b) : typeof b?.text === "string" && user.push(b.text);
  }
  const uses: Array<{ name: string; input: Rec; ok: boolean }> = [];
  for (const m of msgs as Rec[])
    if (m.type === "assistant" && Array.isArray(m.message?.content))
      for (const b of m.message.content)
        if (b?.type === "tool_use") {
          const r = results.get(b.id);
          const text = r ? resultText(r.content) : "";
          uses.push({ name: String(b.name), input: b.input ?? {}, ok: !!r && r.is_error !== true && !text.includes("<tool_use_error>") && text.trim() !== "" });
        }
  return { uses, userText: user.join("\n") };
}
const readOk = (uses: ReturnType<typeof toolsOf>["uses"], ends: readonly string[]) => uses.some((u) => u.ok && u.name === "Read" && typeof u.input.file_path === "string" && ends.some((e) => (u.input.file_path as string).endsWith("/" + e) || u.input.file_path === e));

const replyTexts = (transcript: string): string[] => replies(transcript).map((t) => t.join("\n\n"));
const questionsIn = (text: string): string[] => sentences(text).filter(isQuestion);
const matching = (qs: readonly string[], p: Patterns): string[] => Object.keys(p).filter((id) => qs.some((q) => p[id]!.test(q)));

export interface Doc {
  path: string;
  kind: "design" | "memo" | "other";
  text: string;
  mtime: number;
}
/** The markdown files under <state root>/projects/<slug>/, newest first (ties by path). */
export function docs(stateRoot: string | null, m: Pick<Markers, "deliverables"> | null): Doc[] {
  const projects = stateRoot === null ? null : join(stateRoot, "projects");
  if (!projects || !existsSync(projects)) return [];
  const out: Doc[] = [];
  for (const slug of readdirSync(projects).sort()) {
    const dir = join(projects, slug);
    if (!lstatSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      const p = join(dir, f);
      if (!f.endsWith(".md") || !lstatSync(p).isFile()) continue;
      const text = readFileSync(p, "utf8");
      if (!text.trim()) continue;
      const d = (m ?? DEFAULT_DOCS).deliverables;
      const kind = d.memo?.test(f) ? "memo" : d.design.test(f) ? "design" : "other";
      out.push({ path: join(slug, f), kind, text, mtime: statSync(p).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime || (a.path < b.path ? -1 : 1));
}
const DEFAULT_DOCS = { deliverables: { design: /-design-[^/]*\.md$/, memo: /-memo-[^/]*\.md$/ } };

/** Section 12's exposure detector for one skill session. */
export function exposure(o: { transcript: string; stateRoot: string | null; sessionKind: string | null; turns: readonly FounderTurn[]; markers: Markers }): Exposure {
  const { uses, userText } = toolsOf(o.transcript);
  const sl = o.markers.skill_loaded;
  const read_skill = readOk(uses, sl.reads) || uses.some((u) => u.ok && u.name === "Skill" && JSON.stringify(u.input).includes(sl.skill_tool)) || sl.texts.some((t) => userText.includes(t));
  const interactive = o.sessionKind === SESSION_KIND_LINE.split(": ")[1];
  const answered = delivered(o.turns).length;
  const asked = new Set<string>();
  replyTexts(o.transcript).forEach((text, k) => {
    if (k >= answered) return;
    const ids = matching(questionsIn(text), o.markers.questions);
    if (ids.length === 1) asked.add(ids[0]!);
  });
  const wrote_deliverable = docs(o.stateRoot, o.markers).some((d) => d.kind === "design" || d.kind === "memo");
  return { read_skill, interactive, questions_one_at_a_time: asked.size, wrote_deliverable, exposed: read_skill && interactive && asked.size >= 2 && wrote_deliverable };
}

/** Section 7's startup-only list, and G1's detector: the ids found anywhere in the adviser's text, sorted. */
export function startupOnly(transcript: string, m: Markers): string[] {
  const text = replyTexts(transcript).join("\n\n");
  const lines = text.split("\n");
  const found = new Set([...matching(questionsIn(text), m.startup_only.questions), ...Object.keys(m.startup_only.lines).filter((id) => lines.some((l) => m.startup_only.lines[id]!.test(l)))]);
  return [...found].sort();
}

/** Section 7's kept-whole parts for a builder session in a skill arm. */
export function keptWhole(o: { transcript: string; stateRoot: string | null; founderDone: boolean; markers: Markers }): KeptWhole {
  const { uses } = toolsOf(o.transcript);
  const designs = docs(o.stateRoot, o.markers).filter((d) => d.kind === "design");
  const builderDoc = (d: Doc) => o.markers.builder_mode.doc_mode.test(d.text);
  const builder_mode = readOk(uses, o.markers.builder_mode.reads) || designs.some(builderDoc);
  const startup_only = startupOnly(o.transcript, o.markers);
  const builder_doc_approved = designs.some((d) => builderDoc(d) && /^Status:[ \t]*APPROVED\b/m.test(d.text));
  const before_cap = o.founderDone;
  return { builder_mode, startup_only, builder_doc_approved, before_cap, kept: builder_mode && !startup_only.length && builder_doc_approved && before_cap };
}

/** G2: question sentences the adviser asked, leaving out its replies to the closing message. */
export function questionsAsked(transcript: string, closings: number): number {
  const texts = replyTexts(transcript);
  return texts.slice(0, Math.max(0, texts.length - closings)).reduce((n, t) => n + questionsIn(t).length, 0);
}

/** G3: founder replies the adviser received before the closing message. */
export const founderReplies = (turns: readonly FounderTurn[]): number => delivered(turns).length;

/** True when an action holds a date and, outside the date, a number. */
export function datedAndNumbered(action: string, c: ComplianceMarkers): boolean {
  const dates = action.match(c.date);
  if (!dates) return false;
  return c.number.test(action.replace(c.date, " "));
}

export interface ComplianceReport extends Compliance {
  /** Change 1 item 4f: a startup-mode design doc carries a SUCCESS line. */
  success_line: boolean;
  /** Change 1 item 4f: the developer profile holds a commitment entry after an approved deliverable; null outside new-arm founder sessions. */
  commitment: boolean | null;
}

function commitmentLogged(stateRoot: string | null, c: ComplianceMarkers): boolean {
  if (stateRoot === null) return false;
  const entries: Rec[] = [];
  for (const f of c.profile_files) {
    const p = join(stateRoot, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    try {
      if (f.endsWith(".jsonl")) for (const l of text.split("\n")) l.trim() && entries.push(JSON.parse(l));
      else entries.push(...((JSON.parse(text)?.sessions as Rec[]) ?? []));
    } catch {
      continue;
    }
  }
  return entries.some((e) => e?.mode === "commitment" && typeof e.kill_date === "string" && e.kill_date.trim() !== "" && typeof e.kill_test === "string" && e.kill_test.trim() !== "");
}

/** Section 11's compliance checks on one session, reported and never scored. */
export function compliance(o: { transcript: string; stateRoot: string | null; block: Block | null; arm: "none" | SkillArm; kind: "founder" | "builder"; markers?: Markers | null; c: ComplianceMarkers }): ComplianceReport {
  const all = docs(o.stateRoot, o.markers ?? null);
  const deliverable = all.find((d) => d.kind !== "other")?.kind ?? (all.length ? "other" : "none");
  const adviser = replyTexts(o.transcript).join("\n\n");
  const kill_line = [adviser, ...all.map((d) => d.text)].some((t) => o.c.kill_line.test(t));
  const success_line = all.some((d) => d.kind === "design" && o.c.startup_doc_mode.test(d.text) && o.c.success_line.test(d.text));
  const { uses } = toolsOf(o.transcript);
  const ext = new RegExp("\\.(?:" + o.c.code_extensions.join("|") + ")$", "i");
  const wrote_code = uses.some((u) => o.c.code_tools.includes(u.name) && typeof (u.input.file_path ?? u.input.notebook_path) === "string" && ext.test((u.input.file_path ?? u.input.notebook_path) as string));
  const approved_on_disk = all.some((d) => d.kind !== "other" && o.c.approved.test(d.text));
  return {
    deliverable,
    action_with_date_and_number: o.block !== null && datedAndNumbered(o.block.next_action, o.c),
    kill_line,
    wrote_code,
    approved_on_disk,
    success_line,
    commitment: o.arm === "new" && o.kind === "founder" ? approved_on_disk && commitmentLogged(o.stateRoot, o.c) : null,
  };
}

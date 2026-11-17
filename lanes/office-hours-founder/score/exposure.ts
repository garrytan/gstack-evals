// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours founder eval's exposure detector (prereg section 5), frozen before any smoke output exists. It reads
// the main agent's own text in the final transcript (parse.ts replies: no subagent text, no tool result, never the
// skill's own report), cut where the session's first-move block opens. The rules:
// - x1: at least 2 distinct forcing questions of Q1 to Q6. A forcing question counts when a line of that text holding a
//   question mark matches its pattern. One pattern per question, frozen from the Ask lines of
//   office-hours/sections/phase-2a-startup-diagnostic.md at the pin; the skill numbers its prose questions per session,
//   so the patterns read the question's words, never its Q number.
// - x2: a line reading PREMISES: (markdown marks allowed around it) followed at once by at least two numbered lines.
// - x3: lines opening APPROACH A: and APPROACH B:, and a RECOMMENDATION: anywhere, in the capitals the skill prints.
// - exposed: x1, x2 and x3.
// Secondaries, which decide nothing:
// - load: a successful main-agent Read of office-hours/sections/phase-2a-startup-diagnostic.md with a non-empty result.
// - design_doc: the session's copied state root holds a regular file projects/<slug>/*-design-*.md whose "## The
//   Assignment" section, to the next heading of level 1 or 2, is not empty.
// - forcing_asked counts the distinct forcing questions; forcing_routed counts those on the stage route (phase-2a:77-81:
//   pre-product Q1, Q2, Q3; has users Q2, Q4, Q5). A unit with no recorded stage has no route and reads 0.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTranscript } from "../../../src/trial/review/readers.ts";
import { FENCE } from "../frozen.ts";
import { replies } from "../parse.ts";
import type { SessionRow, UnitMeta } from "../types.ts";

/** The pinned files the patterns and paths were read from, by sha256 at garrytan/gstack b6155921. */
export const GSTACK_FILES: Readonly<Record<string, string>> = {
  "office-hours/sections/phase-2a-startup-diagnostic.md": "35ed1e419eca359e454b9f18dddcce0aeb553a0ee519a7e635f4f0b7d484a393",
  "office-hours/SKILL.md": "3567c8d98afa05e526f7dcf7157f4d52812a238aa9b821f8f7c9381311939b88",
  "office-hours/sections/design-and-handoff.md": "8dffced80c38f8c689cc96196bf43771f4674f23a79932feb522618655c72068",
};

export type Forcing = "Q1" | "Q2" | "Q3" | "Q4" | "Q5" | "Q6";

/** One pattern per forcing question, from its Ask line at the pin. */
export const FORCING: Readonly<Record<Forcing, RegExp>> = {
  Q1: /\bstrongest evidence\b|\b(?:upset|scramble|panic)\b.*\b(?:disappeared|disappear|vanished|went away|shut down)\b/i,
  Q2: /\bworkarounds?\b|\b(?:right now|today|currently)\b.*\b(?:solve|handle|deal with|cope with)\b|\b(?:solve|handle|deal with|cope with)\b.*\b(?:right now|today|currently)\b/i,
  Q3: /\bname the (?:actual |specific |real |one )?(?:human|person)\b|\bgets them (?:promoted|fired)\b|\bkeeps? them up at night\b|\bwho (?:exactly |specifically )?needs this most\b/i,
  Q4: /\b(?:smallest|narrowest|simplest)\b.*\b(?:version|thing|product|wedge|offer)\b.*\bpay\b|\bpay real money\b/i,
  Q5: /\bwatched (?:someone|somebody|anyone|a user|users|people|a customer|customers|them)\b.*\b(?:use|using|try|trying)\b|\bwithout helping\b/i,
  Q6: /\b(?:in|over the next) (?:3|three) years\b|\bmore essential or less\b/i,
};

export const ROUTE: Readonly<Record<NonNullable<UnitMeta["founder_stage"]>, readonly Forcing[]>> = { "pre-product": ["Q1", "Q2", "Q3"], "has users": ["Q2", "Q4", "Q5"] };

const PREMISES = /^[ \t>#*_]*PREMISES:[ \t*_]*\n(?:[ \t>*_]*\d{1,2}[.)][ \t]+\S.*(?:\n|$)){2,}/m;
const APPROACH_A = /^[ \t>#*_]*APPROACH A:/m;
const APPROACH_B = /^[ \t>#*_]*APPROACH B:/m;
const RECOMMENDATION = /RECOMMENDATION:/;
const PHASE_2A = /(?:^|\/)office-hours\/sections\/phase-2a-startup-diagnostic\.md$/;

/** Text cut where the last fence labelled first-move, or holding a "first_move" key, opens. */
export function beforeBlock(text: string): string {
  const lines = text.split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[i]!);
    if (!open) continue;
    const close = new RegExp("^ {0,3}\\" + open[1]![0] + "{" + open[1]!.length + ",}\\s*$");
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j]!)) j++;
    if (open[2]!.toLowerCase() === FENCE || lines.slice(i + 1, j).join("\n").includes('"first_move"')) cut = i;
    i = j;
  }
  return lines.slice(0, cut).join("\n");
}

/** The distinct forcing questions asked in a text, in Q order. */
export const forcingAsked = (text: string): Forcing[] => {
  const asked = text.split("\n").filter((l) => l.includes("?"));
  return (Object.keys(FORCING) as Forcing[]).filter((q) => asked.some((l) => FORCING[q].test(l)));
};

/** Whether a copied state root holds a design doc with a non-empty The Assignment section. */
export function designDoc(stateRoot: string | null): boolean {
  const projects = stateRoot === null ? "" : join(stateRoot, "projects");
  if (!projects || !existsSync(projects)) return false;
  for (const slug of readdirSync(projects)) {
    const dir = join(projects, slug);
    if (!lstatSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) {
      if (!/-design-.*\.md$/.test(f) || !lstatSync(join(dir, f)).isFile()) continue;
      const m = /^## +The Assignment[ \t]*\n([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m.exec(readFileSync(join(dir, f), "utf8"));
      if (m && m[1]!.trim()) return true;
    }
  }
  return false;
}

type Rec = Record<string, any>;
const resultText = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "");

/** A successful main-agent Read of the pinned phase-2a section. */
export function loaded(transcript: string): boolean {
  const messages = readTranscript(transcript).filter((m) => !m.parent_tool_use_id && Array.isArray(m.message?.content));
  const results = new Map<string, Rec>();
  for (const m of messages) if (m.type === "user") for (const b of m.message.content) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  return messages.some((m) => m.type === "assistant" && m.message.content.some((b: Rec) => {
    if (b?.type !== "tool_use" || b.name !== "Read" || typeof b.input?.file_path !== "string" || !PHASE_2A.test(b.input.file_path)) return false;
    const r = results.get(b.id);
    const text = r ? resultText(r.content) : "";
    return !!r && r.is_error !== true && !text.includes("<tool_use_error>") && text.trim() !== "";
  }));
}

/** Section 5's detector on one session's final transcript and its copied state root. */
export function exposure(transcript: string, stateRoot: string | null, stage: UnitMeta["founder_stage"]): NonNullable<SessionRow["exposure"]> {
  const text = beforeBlock(replies(transcript).flat().join("\n\n"));
  const asked = forcingAsked(text);
  const x1 = asked.length >= 2;
  const x2 = PREMISES.test(text);
  const x3 = APPROACH_A.test(text) && APPROACH_B.test(text) && RECOMMENDATION.test(text);
  return { x1, x2, x3, exposed: x1 && x2 && x3, load: loaded(transcript), design_doc: designDoc(stateRoot), forcing_asked: asked.length, forcing_routed: stage ? asked.filter((q) => ROUTE[stage].includes(q)).length : 0 };
}

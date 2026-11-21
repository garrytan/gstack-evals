// Copyright (c) 2026 Garry Tan. MIT License.
// A8, the full-load check (the second attempt's pre-run change 3, section 1): every stage 1 skill session's user-side
// text holds its pin's skill body in full, as the harness delivers it. It reads files the run already keeps, so it costs
// nothing.
// - Claude Code: the SDK stream never carries the /office-hours expansion, so the container's end step copies Claude
//   Code's own session file to host/claude-session.jsonl beside the transcript. A user message there that opens "Base
//   directory for this skill: " holds the body after its first blank line. Since pre-run change 5 the body is CLAUDE_BODY's
//   head, then the output of the skill's start step, which differs per session and must not be empty, then CLAUDE_BODY's
//   tail, followed by nothing or by "\n\nARGUMENTS: ". startOutput hands that output to the session-kind reader.
// - Codex CLI: the <skill> item in host/transcript.ndjson, between "</path>" and the closing "</skill>", must be the
//   rendered SKILL.md, CODEX_RENDERED.
// A missing, unreadable or empty copy fails, and so does a body that is cut, changed or the other pin's. Nothing passes
// silently: a session's read always says why.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLAUDE_BODY, CODEX_RENDERED, HOSTS } from "../frozen.ts";
import type { ArmId, ModelId, SessionRow, SkillArm } from "../types.ts";

export const CLAUDE_SESSION = "claude-session.jsonl";
const BASE = "Base directory for this skill: ";
const ARGS = "\n\nARGUMENTS: ";
const PATH_END = "</path>\n";
const SKILL_END = "\n</skill>";

export interface LoadRead {
  brief: string;
  model: ModelId;
  arm: ArmId;
  /** The file read, or null when the row names no transcript. */
  file: string | null;
  pass: boolean;
  /** sha256 of the body that arrived (the whole one when one passed), or null when none did. */
  sha256: string | null;
  why: string;
}
/** A frozen part of a Claude Code body. */
interface Part {
  sha256: string;
  chars: number;
}
/** The frozen bodies A8 checks against; tests plant their own. */
export interface Bodies {
  claude: Readonly<Record<SkillArm, { head: Part; tail: Part }>>;
  codex: Readonly<Record<SkillArm, { sha256: string; bytes: number }>>;
}
const FROZEN: Bodies = { claude: CLAUDE_BODY, codex: CODEX_RENDERED };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Every user-side text in a transcript-shaped ndjson file: each user record's string content or text parts. */
function userTexts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r: { type?: unknown; message?: { role?: unknown; content?: unknown } };
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r?.type !== "user" || r.message?.role !== "user") continue;
    const c = r.message.content;
    if (typeof c === "string") out.push(c);
    else if (Array.isArray(c)) for (const b of c) if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
  }
  return out;
}

/** Each way one skill message's text after its blank line reads as the frozen head, the start step's output and the frozen tail, the tail ending at the text's end or at an ARGUMENTS line. */
function splits(rest: string, want: { head: Part; tail: Part }): { start: string; end: number }[] {
  if (sha(rest.slice(0, want.head.chars)) !== want.head.sha256) return [];
  const ends = [rest.length];
  for (let at = rest.indexOf(ARGS, want.head.chars); at >= 0; at = rest.indexOf(ARGS, at + 1)) ends.push(at);
  return ends.filter((end) => end - want.tail.chars >= want.head.chars && sha(rest.slice(end - want.tail.chars, end)) === want.tail.sha256).map((end) => ({ start: rest.slice(want.head.chars, end - want.tail.chars), end }));
}
const skillMessages = (text: string): string[] => userTexts(text).filter((t) => t.startsWith(BASE)).map((t) => (t.includes("\n\n") ? t.slice(t.indexOf("\n\n") + 2) : ""));

/** The start step's output in a Claude Code session file: what the first skill message holds between the arm's head and tail, or null when no message holds them around a non-empty output. */
export function startOutput(text: string, arm: SkillArm, frozen: Bodies["claude"] = FROZEN.claude): string | null {
  for (const rest of skillMessages(text)) for (const s of splits(rest, frozen[arm])) if (s.start) return s.start;
  return null;
}

/** A8's read of one stage 1 skill session. */
export function skillLoad(s: SessionRow, frozen: Bodies = FROZEN): LoadRead {
  const id = { brief: s.brief, model: s.model, arm: s.arm };
  if (s.arm === "none") throw new Error("E_OHR_READ_INPUT A8 reads skill sessions only, and " + s.brief + " on " + s.model + " is a none-arm session");
  const arm: SkillArm = s.arm;
  if (s.transcript === null) return { ...id, file: null, pass: false, sha256: null, why: "the row names no transcript, so the session's host files cannot be found" };
  const codex = HOSTS[s.model] === "codex";
  const file = codex ? s.transcript : join(dirname(s.transcript), CLAUDE_SESSION);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { ...id, file, pass: false, sha256: null, why: file + " is unreadable: " + (e as Error).message };
  }
  const texts = userTexts(text);
  if (codex) {
    const want = frozen.codex[arm];
    const items = texts.filter((t) => t.startsWith("<skill>\n"));
    if (!items.length) return { ...id, file, pass: false, sha256: null, why: "no <skill> item in the transcript's user-side text" };
    const got = items.map((t) => {
      const at = t.indexOf(PATH_END);
      return at >= 0 && t.endsWith(SKILL_END) ? t.slice(at + PATH_END.length, t.length - SKILL_END.length) : null;
    });
    const whole = got.find((b) => b !== null && sha(b) === want.sha256);
    if (whole !== undefined) return { ...id, file, pass: true, sha256: want.sha256, why: "the <skill> item holds the rendered SKILL.md whole (" + want.bytes + " bytes)" };
    const first = got.find((b) => b !== null);
    return { ...id, file, pass: false, sha256: first === undefined ? null : sha(first), why: first === undefined ? "every <skill> item is cut off before its closing tag" : "the <skill> item's body hashes to " + sha(first) + " over " + Buffer.byteLength(first) + " bytes, and the arm's rendered SKILL.md is frozen at " + want.sha256 + " over " + want.bytes + " bytes" };
  }
  const want = frozen.claude[arm];
  const blocks = skillMessages(text);
  if (!blocks.length) return { ...id, file, pass: false, sha256: null, why: "no \"" + BASE.trim() + "\" message in Claude Code's session file" };
  for (const rest of blocks) {
    const s = splits(rest, want).find((x) => x.start);
    if (s) return { ...id, file, pass: true, sha256: sha(rest.slice(0, s.end)), why: "the skill message holds the pin's head (" + want.head.chars + " characters) and tail (" + want.tail.chars + " characters) whole around " + s.start.length + " characters of start-step output" };
  }
  const rest = blocks[0]!;
  const body = rest.includes(ARGS, want.head.chars) ? rest.slice(0, rest.indexOf(ARGS, want.head.chars)) : rest;
  const head = rest.slice(0, want.head.chars);
  const why = sha(head) !== want.head.sha256
    ? "the skill message's first " + head.length + " characters hash to " + sha(head) + ", and the arm's head is frozen at " + want.head.sha256 + " over " + want.head.chars
    : splits(rest, want).length
      ? "the skill message holds the arm's head and tail, but the start step printed nothing between them"
      : "the skill message holds the arm's head, but no tail frozen at " + want.tail.sha256 + " over " + want.tail.chars + " characters ends its body; the body hashes to " + sha(body) + " over " + body.length + " characters";
  return { ...id, file, pass: false, sha256: sha(body), why };
}

/** A skill session that ended missing with no transcript never reached the model: A8 lists it and reads nothing. */
export const neverStarted = (s: SessionRow): boolean => s.end === "missing" && s.transcript === null;

/** A8's reads: every stage 1 skill session that started. */
export const skillLoads = (sessions: readonly SessionRow[], frozen: Bodies = FROZEN): LoadRead[] =>
  sessions.filter((s) => s.stage === 1 && s.arm !== "none" && !neverStarted(s)).map((s) => skillLoad(s, frozen));

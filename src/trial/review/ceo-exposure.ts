// The CEO outcome eval's two exposure detectors (CEO prereg section 7, with the B1 plan's readings), built from gstack
// 699a41cb's own files, whose sha256s GSTACK_CEO_PIN holds: plan-ceo-review/sections/review-sections.md and
// plan-ceo-review/SKILL.md for the standalone arm, autoplan/sections/ceo-only.md and bin/gstack-ceo-mode-handoff for the
// autoplan arm. Each reads one session's transcript.ndjson in the style of O1's detectors
// (lanes/outcome-skills/arms/exposure.ts): the main agent's own text (capped.ts's mainAgentTexts) and its own tool calls
// with their results. A call whose result is an error or carries a tool_use_error tag, or that has no result, did not
// happen. Subagent records, injected skill bodies and tool results never count as the main agent's own text. Every check
// is reported; a session is exposed only when all pass, and failed names the first that did not.
//
// - standalone: a successful Read of a path ending plan-ceo-review/sections/review-sections.md, or a simple cat, head,
//   sed -n or nl Bash read of it with a non-empty result; and at least one of the four modes in the main agent's own
//   text, upper case, with a space or an underscore (HOLD SCOPE or HOLD_SCOPE).
// - autoplan-ceo: a successful Bash call that runs gstack-ceo-mode-handoff itself (GST-1437 and the Captain's rule of
//   2026-11-05): split at top-level ;, && and newlines, exactly one segment is the handoff call (a mode first, then
//   --ceo-only, no --auto, read from its shell words, so a comment or quoted text never counts), with only 2>&1, >&2 or 2>/dev/null as redirections and at most one pipe into tee, head, tail
//   or cat carrying only flags and file arguments; every other segment is cd <dir>, VAR=value or a word-only status
//   echo such as echo "HANDOFF_EXIT: $?". ||, $(, backticks, a backslash or any other command fails it, so a grep or a
//   printf of the line never passes. A call with a pipe or another segment also needs the line --ceo-only prints
//   ("Auto-selected review mode → <MODE> (CEO-only run: Step 0E's rule)") in its own result. And a successful write of a
//   file named ceo-review.md whose written text holds a line starting "## Findings": a Write, an Edit or MultiEdit (so a
//   heading a later edit adds counts), or a simple Bash redirect, tee or heredoc (never printf -v, quoted or attached, which writes no text, and never a first line
//   with a backslash outside single quotes, the rule segments() uses, since words() does not model bash escapes). A \n
//   reads as a newline only where bash expands it: in printf's format and after echo -e; printf's arguments don't count.
//   handoffNamed says whether any successful own Bash call named gstack-ceo-mode-handoff, so rows can count the
//   sessions that named it and still read unexposed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mainAgentTexts } from "./capped.ts";
import { readTranscript } from "./readers.ts";

/** sha256 of this file. */
export const CEO_EXPOSURE_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");

/** The gstack commit and files the detectors were built from, by sha256. */
export const GSTACK_CEO_PIN = {
  repo: "garrytan/gstack",
  sha: "699a41cb6808e01240d02e82247693f9170d401a",
  files: {
    "plan-ceo-review/sections/review-sections.md": "4fd3afe2b395cf5c3c5c7f06e497f4b586bd8050a1a4e3b95514260027aca441",
    "plan-ceo-review/SKILL.md": "46b7e0cfa8ede8204a416f40a482555e3325bba710594169307fbc25d709dd4f",
    "autoplan/sections/ceo-only.md": "18b171215648efb6accb69b74f8f78535eed16b5947464015851164670375f98",
    "bin/gstack-ceo-mode-handoff": "530ade6ed08c2795779f4c828855d5ab509158e006313d955036dca53f61b1f1",
  } as Record<string, string>,
};

export type CeoExposure = { detector: "standalone" | "autoplan-ceo"; exposed: boolean; failed: string | null; checks: Record<string, boolean> };
type Rec = Record<string, any>;
type Use = { name: string; input: Rec; ok: boolean; result: string };

const MODES = "SCOPE[ _]EXPANSION|SELECTIVE[ _]EXPANSION|HOLD[ _]SCOPE|SCOPE[ _]REDUCTION";
const MODE = new RegExp("\\b(?:" + MODES + ")\\b");
const REVIEW_SECTIONS = /(?:^|\/)plan-ceo-review\/sections\/review-sections\.md$/;
const REVIEW_SECTIONS_BASH = /^(?!.*\s--(?:help|version)(?![\w-]))\s*(?:cat|head|nl|sed\s+-n\s+(["']?)[\d,$]*p\1)\s[^<>]*plan-ceo-review\/sections\/review-sections\.md(?![\w.])/;
const HANDOFF = /gstack-ceo-mode-handoff/;
const HANDOFF_LINE = new RegExp("^Auto-selected review mode \u2192 (?:" + MODES + ") \\(CEO-only run: Step 0E's rule\\)", "m");
const HANDOFF_CALL = new RegExp("^\\s*(?:\\S*/)?gstack-ceo-mode-handoff[\"']?\\s+([\"']?)(?:" + MODES + ")\\1(?=\\s|$)");
const CEO_REVIEW = /(?:^|\/)ceo-review\.md$/;
const WORD = "(?:\"[^\"$`\\\\]*\"|'[^']*'|[^\\s\"'$`\\\\;&|<>()]+)";
const CD = new RegExp("^cd(?:\\s+" + WORD + ")?$");
const ASSIGN = new RegExp("^[A-Za-z_]\\w*=" + WORD + "?$");
const STATUS_ECHO = /^echo\s+"[\w :=-]*\$\?[\w :=-]*"$/;
const FILTER = new RegExp("^(?:tee|head|tail|cat)(?:\\s+" + WORD + ")*$");
const REDIRECTS = /\s(?:2>&1|1?>&2|2>\s*\/dev\/null)(?=\s|$)/g;
const FINDINGS = /^ {0,3}## Findings\b/m;

const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : JSON.stringify(b))).join("\n") : c == null ? "" : JSON.stringify(c));

/** The main agent's own tool calls with their results: no subagent call, and none from an API error message. */
function ownUses(transcript: string): Use[] {
  const messages = readTranscript(transcript).filter((m) => !m.parent_tool_use_id && Array.isArray(m.message?.content));
  const results = new Map<string, Rec>();
  for (const m of messages) if (m.type === "user") for (const b of m.message.content) if (b?.type === "tool_result") results.set(b.tool_use_id, b);
  return messages
    .filter((m) => m.type === "assistant" && !m.error && !m.is_api_error_message)
    .flatMap((m) => m.message.content.filter((b: Rec) => b?.type === "tool_use"))
    .map((b: Rec) => {
      const res = results.get(b.id);
      const result = res ? text(res.content) : "";
      return { name: b.name, input: b.input ?? {}, ok: !!res && res.is_error !== true && !result.includes("<tool_use_error>"), result };
    });
}

/** O1's simple-command rule: one command line with no &&, ||, ;, &, !, $( or backtick, and no if, case or loop; a heredoc
 * body is allowed when its delimiter closes it on the last line, and so is one pipe. Returns the line split at its pipe. */
function simpleCommand(command: string): string[] | null {
  const [head, ...rest] = command.split("\n");
  const heredocs = [...head!.matchAll(/(?<!<)<<(?!<)(-?)\s*(["']?)(\w+)\2/g)];
  if (heredocs.length > 1) return null;
  const doc = heredocs[0];
  const end = doc ? rest.findIndex((l) => (doc[1] ? l.replace(/^\t+/, "") : l) === doc[3]) : -1;
  if (doc ? end < 0 || rest.slice(end + 1).some((l) => l.trim()) : rest.some((l) => l.trim())) return null;
  const bare = head!.replace(/'[^']*'/g, (m) => "'" + "_".repeat(m.length - 2) + "'").replace(/\d*>&\d*-?|&>>?/g, (m) => " ".repeat(m.length));
  if (/&|;|`|\$\(|\|\|/.test(bare) || /^\s*!/.test(bare) || /(?:^|\|)\s*(?:if|case|for|while|until)\b/.test(bare)) return null;
  const pipes = [...bare.matchAll(/\|/g)].map((m) => m.index!);
  if (pipes.length > 1) return null;
  return pipes.length ? [head!.slice(0, pipes[0]), head!.slice(pipes[0]! + 1)] : [head!];
}

/** O1's write targets: each > or >> target outside quotes (never 2> or an & redirect), and a tee the pipe feeds. */
function writeTargets(parts: string[]): string[] {
  const head = parts[0]!;
  const bare = head.replace(/'[^']*'|"(?:[^"\\]|\\.)*"|(?<!\S)#.*/g, (m) => (m[0] === "#" ? " ".repeat(m.length) : m[0] + "_".repeat(m.length - 2) + m[0]));
  const targets = [...bare.matchAll(/(?:^|[^\d&>])>>?/g)].flatMap((m) => /^\s*(["']?)([^\s"'<>|;&]+)\1/.exec(head.slice(m.index! + m[0].length))?.[2] ?? []);
  if (parts.length === 1) return targets;
  const tee = /^\s*tee(?:\s+-a)?\s+(["']?)([^\s"'<>|;&]+)\1\s*$/.exec(parts[1]!);
  return tee ? [...targets, tee[2]!] : [];
}

const exposure = (detector: CeoExposure["detector"], checks: Record<string, boolean>): CeoExposure => ({ detector, exposed: Object.values(checks).every(Boolean), failed: Object.entries(checks).find(([, v]) => !v)?.[0] ?? null, checks });

/** The standalone arm (gstack-forced): review-sections.md read, and a mode named in the main agent's own text. */
export function standaloneExposure(transcript: string): CeoExposure {
  const bashRead = (u: Use) => {
    const parts = simpleCommand(String(u.input.command ?? ""));
    return parts?.length === 1 && REVIEW_SECTIONS_BASH.test(parts[0]!) && u.result.trim() !== "";
  };
  return exposure("standalone", {
    review_sections_read: ownUses(transcript).some((u) => u.ok && ((u.name === "Read" && REVIEW_SECTIONS.test(String(u.input.file_path ?? ""))) || (u.name === "Bash" && bashRead(u)))),
    mode_named: mainAgentTexts(transcript).some((t) => MODE.test(t)),
  });
}

/** The text a successful call wrote to a file named ceo-review.md, or null when it wrote no such file. */
function ceoReviewText(u: Use): string | null {
  if (u.name === "Write" || u.name === "Edit" || u.name === "MultiEdit") {
    if (!CEO_REVIEW.test(String(u.input.file_path ?? ""))) return null;
    return u.name === "Write" ? String(u.input.content ?? "") : u.name === "Edit" ? String(u.input.new_string ?? "") : (Array.isArray(u.input.edits) ? u.input.edits : []).map((e: Rec) => String(e?.new_string ?? "")).join("\n");
  }
  if (u.name !== "Bash" || typeof u.input.command !== "string") return null;
  const parts = simpleCommand(u.input.command);
  if (!parts || !writeTargets(parts).some((t) => CEO_REVIEW.test(t))) return null;
  const [head, ...body] = u.input.command.split("\n");
  if (head!.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (m) => (m[0] === "'" ? "" : m)).includes("\\")) return "";
  const pw = words(parts[0]!);
  if (!pw) return "";
  if (pw[0] === "printf") {
    let i = 1;
    for (; i < pw.length && pw[i] !== "--" && pw[i]!.startsWith("-"); i++) if (pw[i]!.startsWith("-v")) return "";
    return (pw[pw[i] === "--" ? i + 1 : i] ?? "").replace(/\\n/g, "\n");
  }
  let escapes = false;
  if (pw[0] === "echo") for (const w of pw.slice(1)) {
    if (!/^-[neE]+$/.test(w)) break;
    for (const c of w.slice(1)) if (c !== "n") escapes = c === "e";
  }
  const text = head!.replace(/^\s*echo(?:\s+-[neE]+)*\s+(["']?)/, "");
  return [escapes ? text.replace(/\\n/g, "\n") : text, ...body].join("\n");
}

/** A command's shell words with their quotes removed, ending at an unquoted # that starts a word (a comment); null on an open quote. */
function words(command: string): string[] | null {
  const out: string[] = [];
  let cur: string | null = null;
  let quote: string | null = null;
  for (const c of command) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
    } else if (/\s/.test(c)) {
      if (cur !== null) out.push(cur), (cur = null);
    } else if (c === "#" && cur === null) break;
    else if (c === "'" || c === '"') (quote = c), (cur ??= "");
    else cur = (cur ?? "") + c;
  }
  if (quote) return null;
  if (cur !== null) out.push(cur);
  return out;
}

/** A command split at its top-level ;, && and newlines, then each part at its top-level pipes; null when it holds ||, a
 * lone &, $(, a backtick, a backslash outside single quotes, or an open quote. */
function segments(command: string): string[][] | null {
  const out: string[][] = [];
  let seg: string[] = [];
  let cur = "";
  let quote: string | null = null;
  const cut = (pipe: boolean) => {
    seg.push(cur.trim());
    cur = "";
    if (!pipe) out.push(seg), (seg = []);
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    const next = command[i + 1];
    if (quote) {
      if (c === quote) quote = null;
      else if (quote === '"' && (c === "\x60" || c === "\\" || (c === "$" && next === "("))) return null;
      cur += c;
    } else if (c === "'" || c === '"') (quote = c), (cur += c);
    else if (c === "\x60" || c === "\\" || (c === "$" && next === "(")) return null;
    else if (c === ";" || c === "\n") cut(false);
    else if (c === "&" && next === "&") cut(false), i++;
    else if (c === "|" && next === "|") return null;
    else if (c === "|") cut(true);
    else if (c === "&" && command[i - 1] !== ">" && next !== "1" && next !== "2") return null;
    else cur += c;
  }
  if (quote) return null;
  cut(false);
  return out.map((s) => s.filter(Boolean)).filter((s) => s.length);
}

/** Whether a Bash call ran the handoff itself with --ceo-only (the rule in this file's header), given its own result. */
function ranHandoff(command: string, result: string): boolean {
  const segs = segments(command);
  if (!segs) return false;
  const calls = segs.filter((s) => HANDOFF.test(s.join("|")));
  if (calls.length !== 1) return false;
  const [call, ...pipe] = calls[0]!;
  if (pipe.length > 1 || (pipe.length === 1 && !FILTER.test(pipe[0]!))) return false;
  if (segs.some((s) => s !== calls[0] && !(s.length === 1 && (CD.test(s[0]!) || ASSIGN.test(s[0]!) || STATUS_ECHO.test(s[0]!))))) return false;
  const bare = call!.replace(REDIRECTS, " ");
  if (/[<>&]/.test(bare.replace(/'[^']*'|"[^"]*"/g, "''"))) return false;
  const argv = words(bare);
  if (!argv || !HANDOFF_CALL.test(bare) || !/(?:^|\/)gstack-ceo-mode-handoff$/.test(argv[0] ?? "") || !argv.includes("--ceo-only") || argv.includes("--auto")) return false;
  return (segs.length === 1 && pipe.length === 0) || HANDOFF_LINE.test(result);
}

/** The autoplan arm (gstack-auto, /autoplan --ceo-only): the handoff run with --ceo-only, and ceo-review.md written with a Findings section. */
export function autoplanCeoExposure(transcript: string): CeoExposure {
  const uses = ownUses(transcript).filter((u) => u.ok);
  return exposure("autoplan-ceo", {
    handoff_ceo_only: uses.some((u) => u.name === "Bash" && typeof u.input.command === "string" && ranHandoff(u.input.command, u.result)),
    findings_written: uses.some((u) => FINDINGS.test(ceoReviewText(u) ?? "")),
  });
}

/** Whether any successful Bash call of the main agent's own named gstack-ceo-mode-handoff, run or not. */
export const handoffNamed = (transcript: string): boolean => ownUses(transcript).some((u) => u.ok && u.name === "Bash" && typeof u.input.command === "string" && HANDOFF.test(u.input.command));

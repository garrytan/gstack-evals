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
// - autoplan-ceo (the stage 2 amendment, 2026-11-06-geva-345-ceo-stage-2-amendment, sections 3.1 and 3.2, with the
//   Captain's three added checks): handoff_ceo_only holds for a successful Bash call whose result holds exactly one line
//   of the form --ceo-only prints ("Auto-selected review mode \u2192 <MODE> (CEO-only run: Step 0E's rule). Approved
//   decisions: <rows>.", one of the four modes as the handoff prints them), whose command does not contain that line's
//   fixed prefix "Auto-selected review mode", and in which some simple command, at any depth ($(...), backticks, a
//   subshell or a group), has gstack-ceo-mode-handoff as its command word (after any VAR=value words), a mode as its first
//   argument, --ceo-only among its words, no --auto, and no redirection that sends its stdout to a file or /dev/null (2>,
//   2>&1 and >&2 keep it in the result). Comments, quoted text and heredoc bodies are never a command, so a printf or an
//   echo of the line, or the handoff named after a no-op such as `:`, never counts. Any compound form whose output
//   reaches the result (cd, export, set -e, $(...), &&, ||, ; chains, a pipe to a filter) reads as run. Known gap, with no
//   stage 2 consumer: a handoff that fails silently, its failure hidden by a later segment or a pipe, beside a segment
//   that prints an escaped copy of the line still reads as run.
//   findings_written reads the file, not the command: it holds when a ceo-review.md copy in the session's
//   host/ceo-review/ holds a line FINDINGS matches, and reads false for a session whose copy-out logged a failure
//   (logs.copy_out). The transcript parser below (findingsWrittenTranscript, #230's rule) still runs for the report-only
//   disagreement count and decides nothing: a successful write of a file named ceo-review.md whose written text holds a
//   line starting "## Findings": a Write, an Edit or MultiEdit, or a simple Bash redirect, tee or heredoc (never printf
//   -v, quoted or attached, which writes no text, and never a first line with a backslash outside single quotes, since
//   words() does not model bash escapes). A \n reads as a newline only where bash expands it: in printf's format and
//   after echo -e (up to its \c); printf's arguments don't count. The command and its arguments are the shell words left
//   after every redirection is cut, so a redirection may sit anywhere. A heredoc body counts only for a tee with no
//   option but -a and for a cat with no file operand, only when the command has no other input redirect, and under an
//   unquoted delimiter only when the body holds no backslash, backtick or $(. A command with a second stdout redirect (2>
//   is not one) writes nothing that counts, and a pipe into tee carries nothing when its head redirects stdout or the tee
//   has an input redirect. handoffNamed says whether any successful own Bash call named gstack-ceo-mode-handoff, so rows
//   can count the sessions that named it and still read unexposed.
// - enforced (the amendment's section 3.3 item 6): standalone's two checks, plus gate_armed (the session's
//   `gstack-skill-gates report --session <id> --expect armed --json` exited 0, its JSON shows at least one fired
//   ceo-review-gate run for that session, and the record copy did not fail) and gate_released (that report shows a
//   released run and no exhausted one). Any other report exit, 1 included, or a missing report reads gate_armed false.
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

export type CeoExposure = { detector: "standalone" | "autoplan-ceo" | "enforced"; exposed: boolean; failed: string | null; checks: Record<string, boolean> };
type Rec = Record<string, any>;
type Use = { name: string; input: Rec; ok: boolean; result: string };

const MODES = "SCOPE[ _]EXPANSION|SELECTIVE[ _]EXPANSION|HOLD[ _]SCOPE|SCOPE[ _]REDUCTION";
const MODE = new RegExp("\\b(?:" + MODES + ")\\b");
const REVIEW_SECTIONS = /(?:^|\/)plan-ceo-review\/sections\/review-sections\.md$/;
const REVIEW_SECTIONS_BASH = /^(?!.*\s--(?:help|version)(?![\w-]))\s*(?:cat|head|nl|sed\s+-n\s+(["']?)[\d,$]*p\1)\s[^<>]*plan-ceo-review\/sections\/review-sections\.md(?![\w.])/;
const HANDOFF = /gstack-ceo-mode-handoff/;
const CEO_REVIEW = /(?:^|\/)ceo-review\.md$/;
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
  const teeFiles = (part: string) => {
    const { argv } = commandWords(part);
    return argv?.[0] === "tee" && argv.slice(1).every((a) => !a.startsWith("-") || a === "-a") ? argv.slice(1).filter((a) => a !== "-a") : [];
  };
  if (parts.length === 1) return [...targets, ...teeFiles(head)];
  const tee = parts[1]!.includes("<") || stdoutRedirects(head) ? [] : teeFiles(parts[1]!);
  return tee.length ? [...targets, ...teeFiles(head), ...tee] : teeFiles(head);
}

/** A command line's redirection operators outside quotes and comments, and its shell words once they are cut (null on an
 * open quote). */
function commandWords(line: string): { argv: string[] | null; redirects: string[] } {
  const bare = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"|(?<!\S)#.*/g, (m) => (m[0] === "#" ? " ".repeat(m.length) : m[0] + "_".repeat(m.length - 2) + m[0]));
  const redirects: string[] = [];
  let kept = "";
  let at = 0;
  for (const m of bare.matchAll(/(?:(?<!\S)[\d&]+)?[<>]+[-|]?\s*(?:&\d*-?|"[^"]*"|'[^']*'|[^\s"'<>|;&]+)/g)) {
    redirects.push(/^[\d&]*[<>]+[-|]?/.exec(m[0])![0]);
    (kept += line.slice(at, m.index!) + " "), (at = m.index! + m[0].length);
  }
  return { argv: words(kept + line.slice(at)), redirects };
}

/** How many of a command's redirections send its stdout somewhere: >, >>, 1>, &> or a >& duplicate, never 2>. */
const stdoutRedirects = (line: string): number => commandWords(line).redirects.filter((r) => /^(?:1|&)?>/.test(r)).length;

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

/** printf's and echo -e's \\ and \n escapes, read left to right, so \\n stays a backslash and an n. */
const expandEscapes = (t: string): string => t.replace(/\\([\\n])/g, (_, c: string) => (c === "n" ? "\n" : "\\"));

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
  const { argv, redirects } = commandWords(parts[0]!);
  if (!argv || stdoutRedirects(parts[0]!) > 1) return "";
  const [cmd, ...args] = argv;
  if (cmd === "printf") {
    let i = 0;
    for (; i < args.length && args[i] !== "--" && args[i]!.startsWith("-"); i++) if (args[i]!.startsWith("-v")) return "";
    return expandEscapes(args[args[i] === "--" ? i + 1 : i] ?? "");
  }
  if (cmd === "tee" || (cmd === "cat" && args.every((a) => a === "-"))) {
    const inputs = redirects.filter((r) => /^0?</.test(r));
    const doc = /(?<!<)<<(?!<)-?\s*(["']?)\w+\1/.exec(parts[0]!);
    if (cmd === "tee" && args.some((a) => a.startsWith("-") && a !== "-a")) return "";
    if (inputs.length !== 1 || !/^<<-?$/.test(inputs[0]!) || !doc) return "";
    return !doc[1] && /\\|\x60|\$\(/.test(body.join("\n")) ? "" : body.join("\n");
  }
  if (cmd !== "echo") return "";
  let escapes = false;
  let i = 0;
  for (; i < args.length && /^-[neE]+$/.test(args[i]!); i++) for (const c of args[i]!.slice(1)) if (c !== "n") escapes = c === "e";
  const text = args.slice(i).join(" ");
  return escapes ? expandEscapes(/^(?:[^\\]|\\[\s\S])*?(?=\\c)/.exec(text)?.[0] ?? text) : text;
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

/** One simple command: its shell words with quotes removed, and its redirections with their targets. */
type Simple = { argv: string[]; redirects: { op: string; target: string }[] };
const RESERVED = new Set(["!", "{", "}", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for", "case", "esac", "in", "time", "function"]);
const SUB = "\u0000";

/**
 * Every simple command in a Bash command line, nested ones included ($(...), backticks, a subshell, a group), in a
 * lexer that follows bash's quoting: single quotes, double quotes with their four escapes, a backslash outside quotes,
 * comments from a # that starts a word, and heredoc bodies skipped to their delimiter. A substitution's text joins its
 * word as an opaque mark, so no word built from one can match a mode or a command name. Null on an open quote or an
 * unclosed substitution.
 */
export function simpleCommands(src: string): Simple[] | null {
  const all: Simple[] = [];
  let i = 0;
  const heredocs: { delim: string; strip: boolean }[] = [];
  const skipHeredocs = () => {
    for (const h of heredocs.splice(0)) {
      for (;;) {
        if (i >= src.length) return;
        const nl = src.indexOf("\n", i);
        const line = src.slice(i, nl < 0 ? src.length : nl);
        i = nl < 0 ? src.length : nl + 1;
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) break;
      }
    }
  };
  // Reads one nested list up to its closer (")" or "`"), or to the end when closer is null; false when unclosed.
  const list = (closer: string | null): boolean => {
    let cmd: Simple = { argv: [], redirects: [] };
    let word: string | null = null;
    let pendingOp: string | null = null;
    const endWord = () => {
      if (word === null) return;
      if (pendingOp !== null) {
        cmd.redirects.push({ op: pendingOp, target: word });
        if (/^<<-?$/.test(pendingOp)) heredocs.push({ delim: word, strip: pendingOp === "<<-" });
        pendingOp = null;
      } else cmd.argv.push(word);
      word = null;
    };
    const endCmd = () => {
      endWord();
      if (pendingOp !== null) cmd.redirects.push({ op: pendingOp, target: "" }), (pendingOp = null);
      if (cmd.argv.length || cmd.redirects.length) all.push(cmd);
      cmd = { argv: [], redirects: [] };
    };
    const nested = (close: string): boolean => {
      const ok = list(close);
      word = (word ?? "") + SUB;
      return ok;
    };
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (closer === "`" && c === "`") return endCmd(), i++, true;
      if (closer === ")" && c === ")") return endCmd(), i++, true;
      if (c === "\\") {
        if (next === "\n") i += 2;
        else (word = (word ?? "") + (next ?? "")), (i += 2);
        continue;
      }
      if (c === "'") {
        const j = src.indexOf("'", i + 1);
        if (j < 0) return false;
        word = (word ?? "") + src.slice(i + 1, j);
        i = j + 1;
        continue;
      }
      if (c === '"') {
        word ??= "";
        i++;
        for (;;) {
          if (i >= src.length) return false;
          const d = src[i]!;
          if (d === '"') break;
          if (d === "\\" && i + 1 < src.length && "\\\"$`\n".includes(src[i + 1]!)) {
            if (src[i + 1] !== "\n") word += src[i + 1];
            i += 2;
          } else if (d === "$" && src[i + 1] === "(") {
            i += 2;
            if (!nested(")")) return false;
          } else if (d === "`") {
            i++;
            if (!nested("`")) return false;
          } else if (d === "$" && src[i + 1] === "{") {
            const j = src.indexOf("}", i);
            if (j < 0) return false;
            word += SUB;
            i = j + 1;
          } else (word += d), i++;
        }
        i++;
        continue;
      }
      if (c === "$" && next === "(" && src[i + 2] === "(") {
        const j = src.indexOf("))", i);
        if (j < 0) return false;
        word = (word ?? "") + SUB;
        i = j + 2;
        continue;
      }
      if (c === "$" && next === "(") {
        i += 2;
        if (!nested(")")) return false;
        continue;
      }
      if (c === "$" && next === "{") {
        let j = i + 2;
        for (let d = 1; j < src.length && d > 0; j++) d += src[j] === "{" ? 1 : src[j] === "}" ? -1 : 0;
        if (src[j - 1] !== "}") return false;
        word = (word ?? "") + SUB;
        i = j;
        continue;
      }
      if (c === "`") {
        i++;
        if (!nested("`")) return false;
        continue;
      }
      if (c === "#" && word === null) {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "\n") {
        endCmd();
        i++;
        skipHeredocs();
        continue;
      }
      if (c === " " || c === "\t") {
        endWord();
        i++;
        continue;
      }
      if (c === ";" || c === "&" || c === "|") {
        if (c === "&" && next === ">") {
          endWord();
          const op = src.startsWith("&>>", i) ? "&>>" : "&>";
          pendingOp = op;
          i += op.length;
          continue;
        }
        endCmd();
        i += (c === "&" && next === "&") || (c === "|" && (next === "|" || next === "&")) || (c === ";" && next === ";") ? 2 : 1;
        continue;
      }
      if (c === "(") {
        endCmd();
        i++;
        if (!list(")")) return false;
        continue;
      }
      if (c === ")") return false;
      if (c === "<" || c === ">") {
        const fd = word !== null && /^\d+$/.test(word) ? word : "";
        if (fd) word = null;
        else endWord();
        const m = /^(?:<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)/.exec(src.slice(i))!;
        i += m[0].length;
        let op = fd + m[0];
        if (/&$/.test(m[0]) && /^[\d-]/.test(src[i] ?? "")) {
          const t = /^\d*-?/.exec(src.slice(i))![0];
          cmd.redirects.push({ op, target: "&" + t });
          i += t.length;
          continue;
        }
        while (src[i] === " " || src[i] === "\t") i++;
        pendingOp = op;
        continue;
      }
      word = (word ?? "") + c;
      i++;
    }
    endCmd();
    return closer === null;
  };
  return list(null) ? all : null;
}

const MODE_WORD = new RegExp("^(?:" + MODES + ")$");
const HANDOFF_WORD = /(?:^|\/)gstack-ceo-mode-handoff$/;
const HANDOFF_FULL = /^Auto-selected review mode \u2192 (?:HOLD SCOPE|SCOPE EXPANSION|SELECTIVE EXPANSION|SCOPE REDUCTION) \(CEO-only run: Step 0E's rule\)\. Approved decisions: .+\.$/;
const HANDOFF_PREFIX = "Auto-selected review mode";
/** A redirection that sends stdout away from the result: >, >>, 1>, >|, &> or >& to a file, /dev/null or a closed fd. */
const stdoutAway = (r: { op: string; target: string }) => /^(?:1?>[>|]?|&>>?|1?>&)$/.test(r.op) && !/^&[12]$/.test(r.target);

/** The handoff call itself in a simple command: its command word (after VAR=value words), a mode first, --ceo-only, no --auto, stdout kept. */
function isHandoffCall(c: Simple): boolean {
  let k = 0;
  while (k < c.argv.length && (RESERVED.has(c.argv[k]!) || /^[A-Za-z_]\w*=/.test(c.argv[k]!))) k++;
  const argv = c.argv.slice(k);
  return argv.length > 1 && !argv[0]!.slice(argv[0]!.lastIndexOf("/") + 1).includes(SUB) && HANDOFF_WORD.test(argv[0]!) && MODE_WORD.test(argv[1]!) && argv.includes("--ceo-only") && !argv.includes("--auto") && !c.redirects.some(stdoutAway);
}

/** Whether a Bash call ran the handoff itself with --ceo-only (the rule in this file's header), given its own result. */
function ranHandoff(command: string, result: string): boolean {
  if (result.split(/\r?\n/).filter((l) => HANDOFF_FULL.test(l)).length !== 1) return false;
  if (command.includes(HANDOFF_PREFIX)) return false;
  const cmds = simpleCommands(command);
  return !!cmds && cmds.some(isHandoffCall);
}

/** #230's transcript reading of findings_written: report-only since the stage 2 amendment, for the disagreement count. */
export const findingsWrittenTranscript = (transcript: string): boolean => ownUses(transcript).some((u) => u.ok && FINDINGS.test(ceoReviewText(u) ?? ""));

/** What the harness left on disk for one session: the text of every ceo-review.md copy under host/ceo-review/, and whether the copy-out logged a failure. */
export interface CeoDisk {
  copies: string[];
  copy_failed: boolean;
}

/** The autoplan arm (gstack-auto, /autoplan --ceo-only): the handoff run with --ceo-only, and a ceo-review.md copy on disk with a Findings section. */
export function autoplanCeoExposure(transcript: string, disk: CeoDisk): CeoExposure {
  const uses = ownUses(transcript).filter((u) => u.ok);
  return exposure("autoplan-ceo", {
    handoff_ceo_only: uses.some((u) => u.name === "Bash" && typeof u.input.command === "string" && ranHandoff(u.input.command, u.result)),
    findings_written: !disk.copy_failed && disk.copies.some((t) => FINDINGS.test(t)),
  });
}

/** One enforced session's gate report, as review-units stores it: the report's exit code and JSON (null when it never ran), and whether the record copy failed. */
export interface GateReport {
  session_id: string | null;
  exit: number | null;
  json: unknown;
  copy_failed: boolean;
}
type GateRow = { session?: unknown; hook?: unknown; fired?: unknown; blocked?: unknown; released?: unknown; exhausted?: unknown };
/** The report's ceo-review-gate rows for the session it was run for. */
export function gateRows(gate: GateReport | null): GateRow[] {
  const rows = (gate?.json as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows.filter((r: GateRow) => r && r.hook === "ceo-review-gate" && r.session === gate!.session_id) : [];
}

/** The enforced arm (gstack-enforced): standalone's two checks, the gate armed with no error, and the gate released, not exhausted. */
export function enforcedExposure(transcript: string, gate: GateReport | null): CeoExposure {
  const base = standaloneExposure(transcript).checks;
  const rows = gateRows(gate);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return exposure("enforced", {
    ...base,
    gate_armed: !!gate && !gate.copy_failed && gate.exit === 0 && rows.some((r) => num(r.fired) > 0),
    gate_released: rows.some((r) => num(r.released) > 0) && !rows.some((r) => num(r.exhausted) > 0),
  });
}

/** Whether any successful Bash call of the main agent's own named gstack-ceo-mode-handoff, run or not. */
export const handoffNamed = (transcript: string): boolean => ownUses(transcript).some((u) => u.ok && u.name === "Bash" && typeof u.input.command === "string" && HANDOFF.test(u.input.command));

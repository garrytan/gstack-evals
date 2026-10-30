// What the verdict reads from a host transcript (interface v0.5, "Interactive tasks" and "Hosts"): the user-visible
// assistant turns, the calls the session made, and whether it opened the arm's skill. The verdict engine grades turns
// and never parses a transcript (src/skill-eval/verdict/grade.ts); this file is the parsing half of GST-109.
//
// User-visible turns, in order: each text block the main agent shows, and each AskUserQuestion call's questions with
// their option labels. Nothing else counts: not the user's or the simulated persona's messages, not tool inputs or tool
// output, not thinking, and not a subagent's messages (Claude Code marks them with parent_tool_use_id). The last turn is
// the final answer. A result message repeats the final text, so it adds no turn, and an API error the CLI shows in
// place of a model answer is the harness speaking, not the agent, so it adds none either.
//
// calls[] lists every tool call, the main agent's and its subagents', with its tool, a short input and whether its
// result came back without an error. The skill counts as opened only on a call whose result succeeded: a Skill call
// naming it, a Read of a file under one of its roots, or a shell command that reads a file there: a file operand of a
// read command (cat, head, sed, grep, ...) or an input redirection, also inside sh -c, never text a command only prints. A failed Skill call
// (the none arm asking for a skill it does not hold) is not an open.
//
// Codex (`codex exec --json`) runs non-interactive tasks only. Its turns are its agent messages, the last being the final
// answer; reasoning is not a turn. Its calls are its shell commands (ok on exit 0), file changes and MCP calls, so the
// skill opens only on a shell read under one of the skill's roots that exits 0.
import type { AskQuestion } from "../usersim/classifier.ts";

export interface Call {
  id: string;
  tool: string;
  /** The input fields that say what the call touched: a path, a command, a skill, a pattern. */
  input: Record<string, string>;
  /** true when its result came back without an error, false on an error, null when no result came back. */
  ok: boolean | null;
  subagent: boolean;
}

export interface SkillRef {
  /** The skill's name, as a Skill call names it. */
  name: string;
  /** Where the skill's folder sits in the agent's environment; a gstack base can reach one folder by two paths. */
  roots: string[];
  /** The agent's HOME, so a shell read through ~ or $HOME counts. */
  home?: string;
}

export interface SkillUse {
  opened: boolean;
  /** Skill files read, relative to the skill folder, in first-read order. */
  files: string[];
}

/** One user-visible turn for an AskUserQuestion call: each question, then its option labels. */
export function askTurn(questions: readonly AskQuestion[]): string {
  return questions.map((q) => [q.question ?? q.header ?? "", ...(q.options ?? []).map((o) => "- " + (o.label ?? ""))].join("\n")).join("\n\n");
}

const KEPT_INPUT = ["file_path", "path", "command", "skill", "pattern", "url", "description", "subagent_type"];

const short = (input: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (input && typeof input === "object") for (const k of KEPT_INPUT) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string") out[k] = v.length > 2000 ? v.slice(0, 2000) : v;
  }
  return out;
};

type Block = { type?: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean };
type Message = { type?: string; parent_tool_use_id?: string | null; error?: string; is_api_error_message?: boolean; message?: { content?: unknown } };

const blocks = (m: Message): Block[] => (Array.isArray(m.message?.content) ? (m.message!.content as Block[]) : []);

export interface HostTranscript {
  turns: string[];
  calls: Call[];
}

/** Turns and calls from Claude Code's stream-json messages (the Agent SDK's SDKMessage objects), in arrival order. */
export function parseClaudeCode(messages: readonly unknown[]): HostTranscript {
  const turns: string[] = [];
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  for (const raw of messages) {
    const m = raw as Message;
    const sub = !!m.parent_tool_use_id;
    if (m.type === "assistant") {
      if (m.error || m.is_api_error_message) continue;
      for (const b of blocks(m)) {
        if (b.type === "text" && !sub && b.text?.trim()) turns.push(b.text);
        if (b.type !== "tool_use" || !b.id || !b.name) continue;
        if (b.name === "AskUserQuestion" && !sub) {
          const questions = (b.input as { questions?: AskQuestion[] } | undefined)?.questions;
          if (Array.isArray(questions) && questions.length) turns.push(askTurn(questions));
        }
        const call: Call = { id: b.id, tool: b.name, input: short(b.input), ok: null, subagent: sub };
        calls.push(call);
        byId.set(b.id, call);
      }
    } else if (m.type === "user") {
      for (const b of blocks(m)) {
        const call = b.type === "tool_result" && b.tool_use_id ? byId.get(b.tool_use_id) : undefined;
        if (call) call.ok = b.is_error !== true;
      }
    }
  }
  return { turns, calls };
}

type CodexEvent = { type?: string; item?: { id?: string; type?: string; text?: string; command?: string; exit_code?: number | null; status?: string; changes?: { path?: string }[]; server?: string; tool?: string; error?: unknown; query?: string } };

/** Turns and calls from Codex's `exec --json` events, in arrival order. A completed item replaces its started form. */
export function parseCodex(events: readonly unknown[]): HostTranscript {
  const turns: string[] = [];
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  for (const raw of events) {
    const ev = raw as CodexEvent;
    const it = ev.item;
    if (!it || (ev.type !== "item.started" && ev.type !== "item.completed")) continue;
    const done = ev.type === "item.completed";
    if (it.type === "agent_message") {
      if (done && it.text?.trim()) turns.push(it.text);
      continue;
    }
    let call: Omit<Call, "id" | "subagent"> | null = null;
    if (it.type === "command_execution") call = { tool: "shell", input: short({ command: it.command }), ok: done ? it.status === "completed" && it.exit_code === 0 : null };
    else if (it.type === "file_change") call = { tool: "apply_patch", input: short({ path: (it.changes ?? []).map((c) => c.path ?? "").join(" ") }), ok: done ? it.status === "completed" : null };
    else if (it.type === "mcp_tool_call") call = { tool: "mcp:" + (it.server ?? "") + "." + (it.tool ?? ""), input: {}, ok: done ? it.status === "completed" && !it.error : null };
    else if (it.type === "web_search") call = { tool: "web_search", input: short({ pattern: it.query }), ok: done ? true : null };
    if (!call) continue;
    const id = it.id ?? String(calls.length);
    const seen = byId.get(id);
    if (seen) Object.assign(seen, call);
    else {
      const c = { id, ...call, subagent: false };
      byId.set(id, c);
      calls.push(c);
    }
  }
  return { turns, calls };
}

const READERS = new Set(["cat", "head", "tail", "sed", "less", "more", "awk", "grep", "nl", "bat"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
/** Readers whose first operand is a pattern or program, not a file, unless -e or -f carries it. */
const PATTERN_FIRST = new Set(["grep", "sed", "awk"]);

/** A shell line's simple commands, each as its words with quotes removed; ;, &, |, newlines and parentheses split commands, < and > are words of their own, and a # that starts a word comments out the rest of its line. */
export function shellCommands(line: string): string[][] {
  const cmds: string[][] = [[]];
  let word = "";
  let inWord = false;
  const flush = () => {
    if (inWord) cmds.at(-1)!.push(word);
    word = "";
    inWord = false;
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      word += end < 0 ? line.slice(i + 1) : line.slice(i + 1, end);
      i = end < 0 ? line.length : end;
      inWord = true;
    } else if (ch === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) word += line[j] === "\\" && j + 1 < line.length ? line[++j] : line[j];
      i = j;
      inWord = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (ch === ";" || ch === "&" || ch === "|" || ch === "\n" || ch === "(" || ch === ")") {
      flush();
      if (cmds.at(-1)!.length) cmds.push([]);
    } else if (ch === "<" || ch === ">") {
      flush();
      cmds.at(-1)!.push(ch);
    } else if (ch === "#" && !inWord) {
      const end = line.indexOf("\n", i);
      i = end < 0 ? line.length : end - 1;
    } else if (/\s/.test(ch)) flush();
    else {
      word += ch;
      inWord = true;
    }
  }
  flush();
  return cmds.filter((c) => c.length);
}

/** The files a shell line reads: file operands of a read command (cat, head, sed, grep, ...; grep's, sed's and awk's pattern or program is not one, but a file it is read from with -f is), input redirections, and the same inside sh -c. Text a command only prints, and comments, are not reads. */
export function shellReads(line: string, depth = 0): string[] {
  const paths: string[] = [];
  for (const words of shellCommands(line)) {
    const start = words.findIndex((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    if (start < 0) continue;
    const cmd = words.slice(start);
    const name = cmd[0]!.split("/").pop()!;
    for (let i = 0; i < cmd.length; i++) if (cmd[i] === "<" && cmd[i + 1]) paths.push(cmd[i + 1]!);
    if (SHELLS.has(name) && depth < 2) {
      const flag = cmd.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
      if (flag > 0 && cmd[flag + 1]) paths.push(...shellReads(cmd[flag + 1]!, depth + 1));
      continue;
    }
    if (!READERS.has(name)) continue;
    const pattern = PATTERN_FIRST.has(name);
    let script = pattern && !cmd.some((w) => /^(-[ef]|--file|--regexp|--expression)/.test(w));
    for (let i = 1; i < cmd.length; i++) {
      const w = cmd[i]!;
      if (w === ">" || w === "<" || (pattern && w === "-e")) i++;
      else if (pattern && (w === "-f" || w === "--file")) {
        if (cmd[i + 1]) paths.push(cmd[i + 1]!);
        i++;
      } else if (pattern && /^(-f|--file=)./.test(w)) paths.push(w.replace(/^(-f|--file=)/, ""));
      else if (w.startsWith("-")) continue;
      else if (script) script = false;
      else paths.push(w);
    }
  }
  return paths;
}

/** Whether the calls opened the skill, and which of its files they read. */
export function skillUse(calls: readonly Call[], skill: SkillRef | null): SkillUse {
  if (!skill) return { opened: false, files: [] };
  const roots = skill.roots.map((r) => r.replace(/\/+$/, "") + "/");
  const files: string[] = [];
  const read = (rel: string) => {
    if (!files.includes(rel)) files.push(rel);
  };
  let opened = false;
  for (const c of calls) {
    if (c.ok !== true) continue;
    if (c.tool === "Skill" && [skill.name, "gstack:" + skill.name].includes(c.input.skill ?? "")) {
      opened = true;
      read("SKILL.md");
      continue;
    }
    const paths = (c.tool === "Read" ? [c.input.file_path ?? c.input.path ?? ""] : c.input.command ? shellReads(c.input.command) : []).map((p) => (skill.home ? p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/)/, skill.home) : p));
    for (const p of paths) {
      const root = roots.find((r) => p.startsWith(r));
      if (!root || p.length === root.length) continue;
      opened = true;
      read(p.slice(root.length));
    }
  }
  return { opened, files };
}

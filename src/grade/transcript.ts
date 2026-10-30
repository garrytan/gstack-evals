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
// naming it, a Read of a file under one of its roots, or a shell command that reads a file there. A failed Skill call
// (the none arm asking for a skill it does not hold) is not an open.
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

export interface ClaudeTranscript {
  turns: string[];
  calls: Call[];
}

/** Turns and calls from Claude Code's stream-json messages (the Agent SDK's SDKMessage objects), in arrival order. */
export function parseClaudeCode(messages: readonly unknown[]): ClaudeTranscript {
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

const SHELL_READ = /\b(cat|head|tail|sed|less|more|awk|grep|nl|bat)\b/;

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
    const paths = c.tool === "Read" ? [c.input.file_path ?? c.input.path ?? ""] : SHELL_READ.test(c.input.command ?? "") ? (c.input.command ?? "").split(/[\s'"]+/) : [];
    for (const p of paths) {
      const root = roots.find((r) => p.startsWith(r));
      if (!root || p.length === root.length) continue;
      opened = true;
      read(p.slice(root.length));
    }
  }
  return { opened, files };
}

// Copyright (c) 2026 Garry Tan. MIT License.
// A Codex session's rollouts as part C's readouts read them (preregistration sections 5.3 and 5.6, pre-run change 1,
// sections 7 and 10). review-units' Codex driver copies every rollout under $CODEX_HOME/sessions to the session's
// host/codex-sessions/ and names the root thread in host/init.json (thread_id).
//
// - The root thread is the rollout whose session_meta id is init.json's thread_id, or, when init.json names none, the one
//   whose source is exec. Every rollout whose source is a sub-agent spawn is a sub-agent thread.
// - Each thread keeps its session_meta cli_version, the model and effort of each turn_context, and its response items in
//   order: messages (role and text), tool calls (function_call or custom_tool_call, with name, namespace and arguments or
//   input) and tool outputs (their text). Other records are skipped; a line that is not JSON is a problem, never a guess.
// - A contract block is a user message holding <hook_prompt hook_run_id="stop:...">, the text Codex shows after a Stop
//   hook blocks; at the pin only gstack's contract registers a Stop hook.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Item =
  | { kind: "message"; line: number; role: string; text: string; refusal: boolean }
  | { kind: "call"; line: number; type: "function_call" | "custom_tool_call"; name: string; namespace: string | null; call_id: string; args: Record<string, unknown> | null; input: string | null }
  | { kind: "output"; line: number; call_id: string; text: string };

export interface Thread {
  id: string;
  path: string;
  root: boolean;
  parent: string | null;
  cli_version: string | null;
  turns: { model: string | null; effort: string | null }[];
  items: Item[];
}

export interface SessionRollouts {
  thread_id: string | null;
  root: Thread | null;
  subs: Thread[];
  problems: string[];
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const BLOCK = /<hook_prompt hook_run_id="stop:/;

/** The text of a message's or an output's content: a string, or the text of each part of a list. */
export function contentText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((c) => (isObject(c) && typeof c.text === "string" ? c.text : typeof c === "string" ? c : "")).join("");
  if (isObject(v) && "content" in v) return contentText(v.content);
  return "";
}

/** One rollout file as a thread; problems name lines that are not JSON. */
export function parseRollout(text: string, path: string): { thread: Thread | null; problems: string[] } {
  const problems: string[] = [];
  let thread: Thread | null = null;
  const items: Item[] = [];
  const turns: Thread["turns"] = [];
  for (const [i, raw] of text.split("\n").entries()) {
    if (!raw.trim()) continue;
    let rec: any;
    try {
      rec = JSON.parse(raw);
    } catch {
      problems.push(path + ":" + (i + 1) + " is not JSON");
      continue;
    }
    const p = isObject(rec?.payload) ? rec.payload : null;
    if (!p) continue;
    if (rec.type === "session_meta" && thread === null && typeof p.id === "string") {
      const spawn = isObject(p.source) && isObject(p.source.subagent) && isObject(p.source.subagent.thread_spawn) ? p.source.subagent.thread_spawn : null;
      thread = { id: p.id, path, root: p.source === "exec", parent: spawn && typeof spawn.parent_thread_id === "string" ? spawn.parent_thread_id : null, cli_version: typeof p.cli_version === "string" ? p.cli_version : null, turns, items };
    } else if (rec.type === "turn_context") {
      turns.push({ model: typeof p.model === "string" ? p.model : null, effort: typeof p.effort === "string" ? p.effort : null });
    } else if (rec.type === "response_item" && p.type === "message") {
      const parts = Array.isArray(p.content) ? p.content : [];
      items.push({ kind: "message", line: i + 1, role: String(p.role ?? ""), text: contentText(parts), refusal: parts.some((c: unknown) => isObject(c) && c.type === "refusal") });
    } else if (rec.type === "response_item" && (p.type === "function_call" || p.type === "custom_tool_call") && typeof p.name === "string") {
      let args: Record<string, unknown> | null = null;
      if (p.type === "function_call") {
        try {
          const v = typeof p.arguments === "string" ? JSON.parse(p.arguments) : p.arguments;
          args = isObject(v) ? v : null;
        } catch {
          args = null;
        }
      }
      items.push({ kind: "call", line: i + 1, type: p.type, name: p.name, namespace: typeof p.namespace === "string" ? p.namespace : null, call_id: String(p.call_id ?? ""), args, input: p.type === "custom_tool_call" && typeof p.input === "string" ? p.input : null });
    } else if (rec.type === "response_item" && (p.type === "function_call_output" || p.type === "custom_tool_call_output") && typeof p.call_id === "string") {
      items.push({ kind: "output", line: i + 1, call_id: p.call_id, text: contentText(p.output) });
    }
  }
  if (thread === null) problems.push(path + " has no session_meta record");
  return { thread, problems };
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /^rollout-.*\.jsonl$/.test(n) ? [p] : [];
});

/** Every rollout the driver copied for one session, read from its host dir. */
export function readSessionRollouts(hostDir: string): SessionRollouts {
  const problems: string[] = [];
  let thread_id: string | null = null;
  const init = join(hostDir, "init.json");
  if (existsSync(init)) {
    try {
      const v = JSON.parse(readFileSync(init, "utf8"));
      thread_id = typeof v?.thread_id === "string" ? v.thread_id : null;
    } catch {
      problems.push(init + " is not JSON");
    }
  } else problems.push("no init.json");
  const dir = join(hostDir, "codex-sessions");
  const threads: Thread[] = [];
  for (const file of existsSync(dir) ? walk(dir).sort() : []) {
    const got = parseRollout(readFileSync(file, "utf8"), relative(hostDir, file));
    problems.push(...got.problems);
    if (got.thread) threads.push(got.thread);
  }
  const root = threads.find((t) => (thread_id !== null ? t.id === thread_id : t.root)) ?? null;
  if (root) root.root = true;
  if (!root) problems.push(threads.length ? "no rollout is the root thread " + (thread_id ?? "(init.json names none)") : "no rollout was copied");
  return { thread_id, root, subs: threads.filter((t) => t !== root), problems };
}

/** The root thread's contract blocks: the index in items of each user message holding a Stop hook's prompt. */
export const blockIndexes = (t: Thread): number[] => t.items.flatMap((x, i) => (x.kind === "message" && x.role === "user" && BLOCK.test(x.text) ? [i] : []));

/** The text of the last assistant message among items[0, end), or null when there is none or it is empty. */
export function lastAssistant(t: Thread, end = t.items.length): string | null {
  for (let i = Math.min(end, t.items.length) - 1; i >= 0; i--) {
    const x = t.items[i]!;
    if (x.kind === "message" && x.role === "assistant") return x.text.trim() ? x.text : null;
  }
  return null;
}

/** Whether a model response reached the agent in this thread: any assistant message or tool call. */
export const responded = (t: Thread): boolean => t.items.some((x) => (x.kind === "message" && x.role === "assistant") || x.kind === "call");

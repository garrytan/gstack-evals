// Reader rows for review units (R48 follow-ups prereg, section 3.6 item 3). A review session's subagents are its readers.
// Each subagent the main agent launches through the Agent tool (Task in older CLIs) and the CLI starts gets a reader name
// from the launch prompt through a reader map pinned to one gstack commit:
//
// - a prompt that names exactly one of the map's checklists (a path ending in the checklist's path in the gstack tree,
//   such as review/specialists/testing.md) is that checklist's reader;
// - one that names two or more is batched;
// - one that names none but carries one of the map's adversarial markers (the line /review's Step 4.8 gives its Claude
//   adversarial subagent) is adversarial-native;
// - anything else is other.
//
// A launch counts once the CLI started it: a task_started message for its tool_use id, or a message from the subagent
// itself. A launch the CLI refused, and a launch from inside a subagent, count for no reader. A reader's total_tokens is
// the sum of its launches' task_notification usage (the CLI's own counter for that subagent), or null when a launch has no
// notification (it was still running when the session ended).
//
// The rows go to cost.tsv as scope reader:<name>, one per reader per unit-pass, with the pr and pass of the unit-pass's
// all row (READER_ROW pins the format), meter_source reader-counter and every other cost column unavailable.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface ReaderMap {
  schema_version: 1;
  /** The gstack commit whose /review this map reads; a run checks every gstack arm against it. */
  gstack: { repo: string; sha: string };
  /** Checklist path in the gstack tree to reader name. */
  checklists: Record<string, string>;
  /** Text only the adversarial subagent's prompt carries. */
  adversarial: string[];
}

export interface ReaderUsage {
  reader: string;
  /** Subagents the CLI started for this reader in the unit-pass. */
  launches: number;
  total_tokens: number | null;
}

export const BATCHED = "batched";
export const ADVERSARIAL = "adversarial-native";
export const OTHER = "other";
/** A reader name: lower case words joined by hyphens, as /review's specialist names are. */
export const READER_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** cost.tsv's scope for a reader row. */
export const READER_SCOPE = new RegExp("^reader:(" + READER_NAME.source.slice(1, -1) + ")$");
/** A reader row's columns: pr is the unit id the all row writes, pass a pass number, meter_source reader-counter. */
export const READER_ROW = { scope: READER_SCOPE, pass: /^[1-9][0-9]*$/, meter_source: "reader-counter" } as const;

/** The map in a file and its sha256, or the problem with it. */
export function loadReaderMap(file: string): { map: ReaderMap; sha256: string } | { problem: string } {
  let bytes: Buffer;
  let m: ReaderMap;
  try {
    bytes = readFileSync(file);
    m = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return { problem: (e as Error).message };
  }
  if (m?.schema_version !== 1) return { problem: "schema_version must be 1" };
  if (typeof m.gstack?.repo !== "string" || !/^[0-9a-f]{40}$/.test(m.gstack?.sha ?? "")) return { problem: "gstack needs repo and a 40-character sha" };
  const names = Object.values(m.checklists ?? {});
  if (!names.length || Object.keys(m.checklists).some((p) => !/^[\w.-]+(?:\/[\w.-]+)*\.md$/.test(p))) return { problem: "checklists must map gstack-relative .md paths to reader names" };
  const bad = names.find((n) => !READER_NAME.test(n) || n === BATCHED || n === ADVERSARIAL || n === OTHER);
  if (bad !== undefined) return { problem: "checklist reader " + JSON.stringify(bad) + " is not a reader name, or is batched, adversarial-native or other" };
  if (!Array.isArray(m.adversarial) || !m.adversarial.length || m.adversarial.some((a) => typeof a !== "string" || !a.trim())) return { problem: "adversarial needs at least one marker" };
  return { map: m, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The reader a launch prompt names. */
export function readerOf(prompt: string, map: ReaderMap): string {
  const hits = new Set(Object.entries(map.checklists).filter(([path]) => new RegExp("(?<![\\w.-])" + escape(path) + "(?![\\w-]|\\.\\w)").test(prompt)).map(([, reader]) => reader));
  if (hits.size > 1) return BATCHED;
  if (hits.size === 1) return [...hits][0]!;
  return map.adversarial.some((a) => prompt.includes(a)) ? ADVERSARIAL : OTHER;
}

type Message = Record<string, any>;

/** Each reader's launches and tokens in one session's SDK messages, by reader name. */
export function readerUsage(messages: readonly Message[], map: ReaderMap): ReaderUsage[] {
  const launches = new Map<string, string>();
  const started = new Set<string>();
  const tokens = new Map<string, number>();
  for (const m of messages) {
    if (m.type === "assistant" && !m.parent_tool_use_id) {
      for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (b?.type === "tool_use" && (b.name === "Agent" || b.name === "Task") && typeof b.id === "string" && !launches.has(b.id)) launches.set(b.id, typeof b.input?.prompt === "string" ? b.input.prompt : "");
      }
    }
    if (m.type === "system" && m.subtype === "task_started" && typeof m.tool_use_id === "string") started.add(m.tool_use_id);
    if (typeof m.parent_tool_use_id === "string") started.add(m.parent_tool_use_id);
    if (m.type === "system" && m.subtype === "task_notification" && typeof m.tool_use_id === "string" && Number.isFinite(m.usage?.total_tokens)) tokens.set(m.tool_use_id, (tokens.get(m.tool_use_id) ?? 0) + m.usage.total_tokens);
  }
  const by = new Map<string, ReaderUsage>();
  for (const [id, prompt] of launches) {
    if (!started.has(id)) continue;
    const reader = readerOf(prompt, map);
    const u = by.get(reader) ?? { reader, launches: 0, total_tokens: 0 };
    u.launches++;
    u.total_tokens = u.total_tokens === null || !tokens.has(id) ? null : u.total_tokens + tokens.get(id)!;
    by.set(reader, u);
  }
  return [...by.values()].sort((a, b) => (a.reader < b.reader ? -1 : a.reader > b.reader ? 1 : 0));
}

/** The SDK messages in a transcript.ndjson; a torn or blank line is skipped. */
export function readTranscript(text: string): Message[] {
  const out: Message[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && typeof m === "object") out.push(m);
    } catch {
      continue;
    }
  }
  return out;
}

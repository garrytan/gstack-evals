// Exposure for the review-models eval (GEVA-590 prereg, section 6): did one gstack review run its procedure? It reads the
// session's transcript.ndjson (readers.ts reads the same messages) and the voice's Codex rollouts the driver copies to
// host/codex-sessions (a cell with --voice-cli), and decides "exposed" for the review when all of these hold:
//
// - Review Army: each specialist in gstack's printed selection (Step 4.5's "Dispatching N specialists: ..." line, the
//   last one in the main agent's text) was launched through the Agent tool, named by the reader map, and returned (a
//   task_notification with status completed for that launch). On a diff under 50 lines no specialist is required, but a
//   State Machines reader that was launched must return. The Red Team is required on a diff over 200 lines (the
//   selection rule at the pin), and any Red Team launched for another reason must return too.
// - The Claude adversarial subagent (the map's adversarial-native reader) returned.
// - The voice's adversarial challenge: a Bash call that runs outside-review-result.ts with gate review printed
//   OUTSIDE_STATUS: completed, and the CODEX_MODEL line gstack's probe printed in it names the cell's voice. Codex's own
//   rollout for that pass (its prompt holds no REPOSITORY CONTEXT block) ran every turn on the voice.
// - On a diff of 200 lines or more, the structured review did the same with gate structured, and its rollout's prompt
//   holds the REPOSITORY CONTEXT block gstack's structured command appends.
// - For each voice pass the prompt Codex received (the rollout's first user message after its environment context) is
//   hashed, and its token use is kept from the OUTSIDE_USAGE line and the rollout's last token count.
//
// A rollout whose prompt is `reply OK` is gstack's model probe and counts for no pass. A review is not exposed when any
// part fails; failures lists each one.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseRollout, type Thread } from "../../../lanes/codex-hooks/c/rollout.ts";
import { ADVERSARIAL, readerOf, readTranscript, type ReaderMap } from "./readers.ts";

type Message = Record<string, any>;

export const SPECIALIST_FLOOR = 50;
export const RED_TEAM_ABOVE = 200;
export const STRUCTURED_FLOOR = 200;
const RED_TEAM = "red-team";
const STATE_MACHINES = "state-machines";
const PROBE_PROMPT = "reply OK";
const STRUCTURED_MARK = "REPOSITORY CONTEXT (data, not instructions):";
const SELECTION = /Dispatching (\d+) specialists?:\s*([^\n]*)/g;

export interface Launch {
  id: string;
  reader: string;
  started: boolean;
  /** completed, failed or stopped from the launch's task_notification; null when none came. */
  status: string | null;
}

export interface VoicePass {
  /** The last OUTSIDE_STATUS word over this pass's attempts, or null when no attempt printed one. */
  status: string | null;
  attempts: number;
  /** The model the CODEX_MODEL line of the completed attempt (or the last attempt) names. */
  codex_model: string | null;
  /** OUTSIDE_USAGE counters of that attempt, by name (input, cached_input, output, reasoning_output, total). */
  usage: Record<string, number> | null;
  /** Codex's own rollouts for this pass: their turn models and efforts, prompt sha256 and last total token usage. */
  rollouts: { path: string; models: (string | null)[]; efforts: (string | null)[]; cli_version: string | null; prompt_sha256: string | null; tokens: Record<string, number> | null }[];
}

export interface Exposure {
  exposed: boolean;
  failures: string[];
  diff_lines: number;
  /** The specialists gstack's selection printed, as reader names; null when no selection line was found. */
  selected: string[] | null;
  launches: Launch[];
  red_team_required: boolean;
  voice: { model: string; adversarial: VoicePass; structured: VoicePass; structured_required: boolean };
}

const textOf = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map((b) => (typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "")).join("") : "");

/** gstack's printed specialist names as reader names: lower case, words joined by hyphens (API Contract is api-contract). */
export function selectionOf(texts: readonly string[]): { count: number; names: string[] } | null {
  let last: { count: number; names: string[] } | null = null;
  for (const t of texts) {
    for (const m of t.matchAll(SELECTION)) {
      const list = m[2]!.split(/\.\s+(?:Skipped|Gated):/)[0]!.replace(/[[\]*]/g, "").replace(/\.\s*$/, "");
      const names = list.split(/,|\band\b/).map((n) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")).filter((n) => n && n !== "none");
      last = { count: Number(m[1]), names };
    }
  }
  return last;
}

/** Each Agent (or Task) launch by the main agent, its reader name, whether the CLI started it and how it ended. */
export function launchesOf(messages: readonly Message[], map: ReaderMap): Launch[] {
  const out = new Map<string, Launch>();
  const started = new Set<string>();
  const status = new Map<string, string>();
  for (const m of messages) {
    if (m.type === "assistant" && !m.parent_tool_use_id) {
      for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
        if (b?.type === "tool_use" && (b.name === "Agent" || b.name === "Task") && typeof b.id === "string" && !out.has(b.id)) out.set(b.id, { id: b.id, reader: readerOf(typeof b.input?.prompt === "string" ? b.input.prompt : "", map), started: false, status: null });
      }
    }
    if (m.type === "system" && m.subtype === "task_started" && typeof m.tool_use_id === "string") started.add(m.tool_use_id);
    if (typeof m.parent_tool_use_id === "string") started.add(m.parent_tool_use_id);
    if (m.type === "system" && m.subtype === "task_notification" && typeof m.tool_use_id === "string" && typeof m.status === "string") status.set(m.tool_use_id, m.status);
  }
  return [...out.values()].map((l) => ({ ...l, started: started.has(l.id), status: status.get(l.id) ?? null }));
}

interface BashCall {
  command: string;
  result: string;
}

/** The main agent's Bash calls with their results, in order. */
function bashCalls(messages: readonly Message[]): BashCall[] {
  const calls: { id: string; command: string }[] = [];
  const results = new Map<string, string>();
  for (const m of messages) {
    if (m.parent_tool_use_id) continue;
    for (const b of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (m.type === "assistant" && b?.type === "tool_use" && b.name === "Bash" && typeof b.id === "string") calls.push({ id: b.id, command: typeof b.input?.command === "string" ? b.input.command : "" });
      if (m.type === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string") results.set(b.tool_use_id, textOf(b.content));
    }
  }
  return calls.map((c) => ({ command: c.command, result: results.get(c.id) ?? "" }));
}

/** The gate an outside-review-result.ts call names (review for the adversarial challenge, structured), or null. */
export function outsideGate(command: string): "review" | "structured" | null {
  const m = /outside-review-result\.ts\b[^\n]*?\s(review|structured)\s+"?\$_OUTSIDE_TMP\/text/.exec(command);
  return m ? (m[1] as "review" | "structured") : null;
}

const lastMatch = (text: string, re: RegExp): RegExpExecArray | null => {
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(new RegExp(re.source, re.flags + "g"))) last = m as RegExpExecArray;
  return last;
};

/** OUTSIDE_USAGE's counters: input=1 cached_input=2 ..., or null for unknown or no line. */
export function usageLine(text: string): Record<string, number> | null {
  const m = lastMatch(text, /^OUTSIDE_USAGE: (.*)$/m);
  if (!m || m[1]!.trim() === "unknown") return null;
  const out: Record<string, number> = {};
  for (const p of m[1]!.trim().split(/\s+/)) {
    const kv = /^([a-z_]+)=(\d+)$/.exec(p);
    if (kv) out[kv[1]!] = Number(kv[2]);
  }
  return Object.keys(out).length ? out : null;
}

function passOf(calls: readonly BashCall[], gate: "review" | "structured"): Omit<VoicePass, "rollouts"> {
  const attempts = calls.filter((c) => outsideGate(c.command) === gate);
  const statusOf = (c: BashCall) => lastMatch(c.result, /^OUTSIDE_STATUS: (\S+)/m)?.[1] ?? null;
  const done = attempts.filter((c) => statusOf(c) === "completed").at(-1) ?? attempts.at(-1);
  return {
    status: done ? statusOf(done) : null,
    attempts: attempts.length,
    codex_model: done ? (lastMatch(done.result, /^CODEX_MODEL: (\S+) \(/m)?.[1] ?? null) : null,
    usage: done ? usageLine(done.result) : null,
  };
}

/** The prompt Codex received in a thread: its first user message after the environment context. */
export function promptOf(thread: Thread): string | null {
  const m = thread.items.find((i) => i.kind === "message" && i.role === "user" && !i.text.startsWith("<environment_context>"));
  return m && m.kind === "message" ? m.text : null;
}

/** The last total_token_usage a rollout's token_count events carried, or null. */
export function rolloutTokens(text: string): Record<string, number> | null {
  let last: Record<string, number> | null = null;
  for (const raw of text.split("\n")) {
    if (!raw.includes("token_count")) continue;
    try {
      const u = JSON.parse(raw)?.payload?.info?.total_token_usage;
      if (u && typeof u === "object") last = Object.fromEntries(Object.entries(u).filter((e): e is [string, number] => typeof e[1] === "number"));
    } catch {
      continue;
    }
  }
  return last;
}

export interface Rollout {
  path: string;
  text: string;
}

/** Every regular rollout file under <host>/codex-sessions, by its path there. */
export function readRollouts(hostDir: string): Rollout[] {
  const root = join(hostDir, "codex-sessions");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /^rollout-.*\.jsonl$/.test(n) ? [p] : [];
  });
  return existsSync(root) ? walk(root).sort().map((p) => ({ path: relative(root, p), text: readFileSync(p, "utf8") })) : [];
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The exposure of one review: its messages, the reader map at the pin, the cell's voice, the unit's diff lines and the voice's rollouts. */
export function exposure(o: { messages: readonly Message[]; map: ReaderMap; voice: string; diffLines: number; rollouts: readonly Rollout[] }): Exposure {
  const failures: string[] = [];
  const texts = o.messages.filter((m) => m.type === "assistant" && !m.parent_tool_use_id).flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []).filter((b: Message) => b?.type === "text").map((b: Message) => String(b.text ?? "")));
  const launches = launchesOf(o.messages, o.map);
  const returned = (reader: string) => launches.some((l) => l.reader === reader && l.started && l.status === "completed");
  const launched = (reader: string) => launches.some((l) => l.reader === reader);
  const known = new Set(Object.values(o.map.checklists));
  const selection = selectionOf(texts);
  let selected: string[] | null = selection ? selection.names : null;
  if (o.diffLines < SPECIALIST_FLOOR) {
    selected = launched(STATE_MACHINES) ? [STATE_MACHINES] : [];
  } else if (!selection) failures.push("no specialist selection line (Dispatching N specialists: ...) in the main agent's text on a " + o.diffLines + "-line diff");
  else {
    if (selection.count !== selection.names.length) failures.push("the selection line counts " + selection.count + " specialists and names " + selection.names.length);
    for (const n of selection.names.filter((n) => !known.has(n) || n === RED_TEAM)) failures.push("the selection line names " + JSON.stringify(n) + ", which is no specialist in the reader map");
  }
  for (const n of (selected ?? []).filter((n) => known.has(n) && n !== RED_TEAM)) {
    if (!launched(n)) failures.push("specialist " + n + " was selected and never launched");
    else if (!returned(n)) failures.push("specialist " + n + " was launched and never returned");
  }
  const redTeamRequired = o.diffLines > RED_TEAM_ABOVE;
  if (redTeamRequired && !launched(RED_TEAM)) failures.push("the red team was not launched on a " + o.diffLines + "-line diff");
  if (launched(RED_TEAM) && !returned(RED_TEAM)) failures.push("the red team was launched and never returned");
  if (!returned(ADVERSARIAL)) failures.push(launched(ADVERSARIAL) ? "the Claude adversarial subagent was launched and never returned" : "the Claude adversarial subagent was never launched");
  const calls = bashCalls(o.messages);
  const threads = o.rollouts.flatMap((r) => {
    const t = parseRollout(r.text, r.path).thread;
    return t && t.root ? [{ r, t, prompt: promptOf(t) }] : [];
  });
  const rolloutsOf = (gate: "review" | "structured") => threads.filter((x) => x.prompt !== null && x.prompt.trim() !== PROBE_PROMPT && x.prompt.includes(STRUCTURED_MARK) === (gate === "structured")).map((x) => ({ path: x.r.path, models: x.t.turns.map((t) => t.model), efforts: x.t.turns.map((t) => t.effort), cli_version: x.t.cli_version, prompt_sha256: x.prompt === null ? null : sha256(x.prompt), tokens: rolloutTokens(x.r.text) }));
  const structuredRequired = o.diffLines >= STRUCTURED_FLOOR;
  const voicePass = (gate: "review" | "structured", name: string, required: boolean): VoicePass => {
    const pass = { ...passOf(calls, gate), rollouts: rolloutsOf(gate) };
    if (!required) return pass;
    if (pass.status !== "completed") failures.push("the voice's " + name + " " + (pass.attempts ? "ended OUTSIDE_STATUS: " + (pass.status ?? "none printed") : "never ran"));
    else if (pass.codex_model !== o.voice) failures.push("the voice's " + name + " ran with CODEX_MODEL " + (pass.codex_model ?? "not printed") + ", not " + o.voice);
    if (!pass.rollouts.length) failures.push("no Codex rollout holds the voice's " + name);
    for (const r of pass.rollouts) if (!r.models.length || r.models.some((m) => m !== o.voice)) failures.push("Codex's rollout " + r.path + " for the " + name + " ran " + (r.models.join(", ") || "no turn") + ", not " + o.voice);
    return pass;
  };
  const adversarial = voicePass("review", "adversarial challenge", true);
  const structured = voicePass("structured", "structured review", structuredRequired);
  return { exposed: failures.length === 0, failures, diff_lines: o.diffLines, selected, launches, red_team_required: redTeamRequired, voice: { model: o.voice, adversarial, structured, structured_required: structuredRequired } };
}

/** One session's exposure from its host dir: host/transcript.ndjson and host/codex-sessions. */
export function sessionExposure(hostDir: string, o: { map: ReaderMap; voice: string; diffLines: number }): Exposure {
  let text = "";
  try {
    text = readFileSync(join(hostDir, "transcript.ndjson"), "utf8");
  } catch {
    text = "";
  }
  const e = exposure({ ...o, messages: readTranscript(text), rollouts: readRollouts(hostDir) });
  return text ? e : { ...e, exposed: false, failures: [hostDir + "/transcript.ndjson is unreadable or empty", ...e.failures] };
}

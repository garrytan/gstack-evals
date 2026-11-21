// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's Sol host (the second attempt's pre-run change 2: the eval owner ruled on 2026-11-19
// that every Sol arm session runs in Codex CLI, not Claude Code; Opus and particle-1 keep the Claude Code driver).
// - solArgv: codex exec --json for the first message and codex exec --json resume <thread> for each later one, the
//   message on stdin, every setting a -c pair under --strict-config: the proxy's provider entry (frozen.CODEX's model on
//   OpenAI's Responses route, the slot's bearer as BEARER_ENV, retries off since the proxy retries), CODEX_SETTINGS,
//   and on a skill arm the layout fix: one [[skills.config]] entry each, disabled, for the duplicate copies of
//   office-hours, plan-design-review and gstack-upgrade (CODEX_LAYOUT_FIX), and nothing else.
//   Approvals and Codex's own sandbox are bypassed: the trial container is the sandbox and nobody is there to approve.
//   No --ephemeral, because resume needs the session's rollout.
// - solDriver: the closing loop as nextUser after every turn, as on Claude Code. A reply whose turn starts more than
//   AGENT_TURNS_PER_REPLY tool items is killed and ends the session as a turn cap (Codex has no turn limit of its own),
//   the session's wall clock spans every exec, and a failed turn maps like the Codex adapter's (refusalIn). Before the
//   first exec the driver checks the arm's HOME (homeCommand); after every turn it copies the session's rollouts out
//   and rewrites host/transcript.ndjson from the main one (codexTranscript).
// - Questions: Codex 0.170.0 in exec's Default mode offers request_user_input (Plan mode only; it answers "unavailable
//   in Default mode") and request_user_input_async, which answers {"accepted":true} at once, puts the question on exec's
//   event stream as an agent message and takes any reply as a new user message. So a question reaches the closing loop
//   as reply text, whether asked in prose or through the tool, and the simulator's answer goes back as the next user
//   message, by exec resume; host/questions.json lists the tool's questions. The sleep tool is off (frozen.CODEX_SETTINGS)
//   so a model cannot wait inside a turn for a reply that comes only with the next one.
// - codexTranscript: the rollout in the shape Claude Code's transcript has, so every reader of host/transcript.ndjson
//   reads a Codex session the same way: a system init line, the main agent's assistant text and tool calls, tool
//   results and skill or AGENTS.md text as user messages, and a result line at every turn's end. The founder's own
//   messages are left out, as Claude Code's transcript leaves them out. A request_user_input_async question is the
//   assistant text the founder saw (its AgentMessage), with the call and its {"accepted":true} left out, as Claude Code's
//   arms ask in prose. The injected <skill> item is the skill's load signal: it carries the rendered SKILL.md, whose text
//   the exposure markers read.
// - codexReads: the none arm's gstack-read audit for Codex: any tool call whose input names gstack, and any skill or
//   AGENTS.md item injected into the session.
// - Install checks: codexTreeProblems on the host-side install (VERSION and the rendered SKILL.md at both entries) and
//   codexPinCommand/codexPinProblems in each container, beside the binary's own sha256; renderGap counts changed lines.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { createInterface } from "node:readline";
import { refusalIn, refusalTermination, type NextUser } from "../../../src/adapters/claude-code/driver.ts";
import type { ContractTask } from "../../../src/skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../../src/trial/trial.ts";
import type { Termination, TokenUsage } from "../../../src/types.ts";
import { AGENT_TURNS_PER_REPLY, ARM_ENV, CODEX, CODEX_LAYOUT_FIX, CODEX_RENDERED, CODEX_SETTINGS, CODEX_SKILL_FILES, PINS, RENDER_GAP } from "../frozen.ts";
import type { SkillArm } from "../types.ts";

export const PROVIDER_ID = "gstack_evals_proxy";
/** The variable that carries the slot's per-session bearer. The trial env admits it in the agent env only with a gse_ session bearer, never a provider key, so the containment probe exempts this one name on Sol (ohrProbed). */
export const BEARER_ENV = "OPENAI_API_KEY";
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
type Rec = Record<string, any>;

export interface SolOptions {
  /** The base URL Codex reaches (the lane's tap in front of the proxy), the slot and its per-session bearer. */
  proxy: { baseUrl: string; slot: string; token: string };
  /** The agent's HOME inside the container; CODEX_HOME is HOME/.codex. */
  home: string;
  skillArm: boolean;
  out: string;
  nextUser: (texts: string[]) => Promise<NextUser>;
  maxToolItems?: number;
  /** Problems the HOME check found before the first exec, or null when it could not run. */
  onHome?: (problems: string[] | null) => void;
}

/** Every -c pair, as key and TOML value. */
export function solSettings(o: Pick<SolOptions, "proxy" | "home" | "skillArm">): [string, string][] {
  const p = "model_providers." + PROVIDER_ID + ".";
  const toml = (v: string | number | boolean) => (typeof v === "string" ? JSON.stringify(v) : String(v));
  return [
    ["model_provider", toml(PROVIDER_ID)],
    [p + "name", toml("gstack-evals metering proxy")],
    [p + "base_url", toml(o.proxy.baseUrl.replace(/\/+$/, "") + "/" + o.proxy.slot + "/" + CODEX.provider + "/v1")],
    [p + "wire_api", toml("responses")],
    [p + "env_key", toml(BEARER_ENV)],
    [p + "request_max_retries", "0"],
    [p + "stream_max_retries", "0"],
    ...Object.entries(CODEX_SETTINGS).map(([k, v]): [string, string] => [k, toml(v)]),
    ...(o.skillArm ? [["skills.config", "[" + CODEX_LAYOUT_FIX.map((f) => "{path=" + JSON.stringify(posix.join(o.home, ".codex", f)) + ",enabled=false}").join(",") + "]"] as [string, string]] : []),
  ];
}

/** The argv after the binary; the message follows on stdin. thread resumes that session. */
export function solArgv(o: Pick<SolOptions, "proxy" | "home" | "skillArm">, thread: string | null): string[] {
  const settings = solSettings(o).flatMap(([k, v]) => ["-c", k + "=" + v]);
  return ["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--color", "never", "-m", CODEX.model, ...settings, ...(thread ? ["resume", thread] : []), "-"];
}

/** The agent env the driver adds: the slot's bearer and section 4 step 2's ARM_ENV, set in every arm. */
export const solEnv = (o: Pick<SolOptions, "proxy">): Record<string, string> => ({ [BEARER_ENV]: o.proxy.token, ...ARM_ENV });

/** The shell step that lists what an arm's HOME and work dir hold before Codex first runs. */
export const homeCommand = 'W="$PWD"; cd "$HOME" && for p in .codex .codex/config.toml .codex/AGENTS.md .codex/skills .agents .claude .gstack .local/share/gstack AGENTS.md; do test -e "$p" && echo "present $p"; done; find "$HOME" "$W" -maxdepth 8 -name AGENTS.md -o -name AGENTS.override.md 2>/dev/null | sed "s/^/agents /"; find "$HOME" -maxdepth 8 -name SKILL.md 2>/dev/null | head -1 | sed "s/^/skill /"; true';

/** What homeCommand printed that departs from the arm: a skill arm holds its Codex skills and gstack tree and nothing else of Codex; none holds nothing. */
export function homeProblems(printed: string, skillArm: boolean): string[] {
  const allowed = skillArm ? new Set(["present .codex", "present .codex/skills", "present .local/share/gstack"]) : new Set<string>();
  const lines = printed.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) => !allowed.has(l) && !(skillArm && (l.startsWith("skill ") || /^agents \S*\/\.local\/share\/gstack\//.test(l)))).map((l) => (skillArm ? "skill arm HOME: " : "none arm HOME: ") + l);
}

const TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call", "todo_list", "image_view"]);
/** Codex's input_tokens include its cached input and its output_tokens its reasoning; TokenUsage keeps each class apart. */
const tokens = (u: Rec): TokenUsage => ({ input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0) - (u.cache_write_input_tokens ?? 0)), output: Math.max(0, (u.output_tokens ?? 0) - (u.reasoning_output_tokens ?? 0)), reasoning: u.reasoning_output_tokens ?? 0, cache_read: u.cached_input_tokens ?? 0, cache_write: u.cache_write_input_tokens ?? 0 });

async function readAll(session: AgentSession, argv: string[]): Promise<string> {
  const child = session.spawn(argv, {});
  let text = "";
  child.stdout?.on("data", (d: Buffer) => (text += d.toString("utf8")));
  child.stdin?.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));
  return text;
}

export function solDriver(o: SolOptions): AgentDriver & { env: Record<string, string> } {
  const cap = o.maxToolItems ?? AGENT_TURNS_PER_REPLY;
  return {
    env: solEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      mkdirSync(o.out, { recursive: true });
      const deadline = Date.now() + timeoutMs;
      const turns: string[] = [];
      let usage: TokenUsage | null = null;
      let thread: string | null = null;
      let toolItems = 0;
      const home = session.exec(homeCommand, 60_000);
      o.onHome?.(home.exitCode === 0 ? homeProblems(home.stdout, o.skillArm) : null);
      const copyOut = async () => {
        if (!thread) return;
        const files = (await readAll(session, ["sh", "-c", 'ls "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null'])).split("\n").map((l) => l.trim()).filter(Boolean);
        mkdirSync(join(o.out, "rollouts"), { recursive: true });
        for (const f of files) {
          const text = await readAll(session, ["cat", f]);
          writeFileSync(join(o.out, "rollouts", posix.basename(f)), text);
          if (f.endsWith("-" + thread + ".jsonl")) {
            writeFileSync(join(o.out, "rollout.jsonl"), text);
            writeFileSync(join(o.out, "transcript.ndjson"), codexTranscript(text));
            writeFileSync(join(o.out, "questions.json"), JSON.stringify(codexQuestions(text), null, 2) + "\n");
          }
        }
      };
      const outcome = (termination: Termination): AgentOutcome => ({ turns, termination, opened: null, files_read: [], asked: [], usage, cost_micros: null, agent_turns: toolItems, loaded_bytes: null, text_output: turns.length > 0 });
      let message = task.prompt;
      for (;;) {
        const argv = solArgv(o, thread);
        appendFileSync(join(o.out, "init.ndjson"), JSON.stringify({ argv: [CODEX.bin, ...argv], at: new Date().toISOString() }) + "\n");
        const child = session.spawn(["sh", "-c", 'PATH="' + CODEX.path_dir + ':$PATH" exec "$0" "$@"', CODEX.bin, ...argv], {});
        let completed = false;
        let failed: string | null = null;
        let lastError: string | null = null;
        let capped = false;
        let replyTools = 0;
        const texts: string[] = [];
        const left = deadline - Date.now();
        let timedOut = left <= 0;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, Math.max(1, left));
        child.stderr?.on("data", (d: Buffer) => appendFileSync(join(o.out, "cli-stderr.log"), d));
        child.stdin?.on("error", () => {});
        child.stdin?.end(message);
        const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
        if (child.stdout)
          for await (const line of createInterface({ input: child.stdout })) {
            if (!line.trim()) continue;
            appendFileSync(join(o.out, "events.ndjson"), line + "\n");
            let ev: Rec;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.type === "thread.started" && typeof ev.thread_id === "string") thread ??= ev.thread_id;
            else if (ev.type === "item.started" && TOOL_ITEMS.has(ev.item?.type) && ++replyTools > cap && !capped) {
              capped = true;
              child.kill("SIGKILL");
            } else if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string" && ev.item.text.trim()) texts.push(ev.item.text);
            else if (ev.type === "turn.completed") {
              completed = true;
              if (ev.usage) usage = tokens(ev.usage);
            } else if (ev.type === "turn.failed") failed = ev.error?.message ?? "turn failed";
            else if (ev.type === "error") lastError = ev.message ?? "error";
          }
        const exit = await closed;
        clearTimeout(timer);
        toolItems += replyTools;
        turns.push(...texts);
        await copyOut();
        if (timedOut) return outcome({ kind: "timeout" });
        if (capped) return outcome({ kind: "turn_cap" });
        const exited = exit.signal === null;
        if (!(completed && !failed && exited && exit.code === 0)) {
          const refusal = refusalIn(failed ?? lastError ?? "");
          return outcome(refusal && exited ? refusalTermination(refusal) : failed && exited ? { kind: "missing", code: "UPSTREAM" } : { kind: "arm_failure", failure: "harness_crash" });
        }
        const next = await o.nextUser(texts);
        if ("stop" in next) return outcome(next.stop);
        if ("end" in next) return outcome({ kind: "completed" });
        message = next.reply;
      }
    },
  };
}

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : c == null ? "" : JSON.stringify(c));
const provenance = (p: Rec): string[] => (p.internal_chat_message_metadata_passthrough?.content_item_metadata ?? []).map((m: Rec) => String(m?.provenance?.type ?? ""));
const INJECTED = new Set(["skills", "agents_md"]);
/** Codex 0.170.0's question tool in Default mode: it answers {"accepted":true} at once, shows the question as an AgentMessage with delivery async, and takes any reply as a new user message. */
export const ASYNC_QUESTION = "request_user_input_async";

/** The questions a session put to the founder through ASYNC_QUESTION, in order, as the rollout shows them. */
export function codexQuestions(rollout: string): { call_id: string; text: string; questions: unknown }[] {
  const out: { call_id: string; text: string; questions: unknown }[] = [];
  for (const raw of rollout.split("\n")) {
    let d: Rec;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    const it = d.payload?.item;
    if (d.type === "event_msg" && d.payload?.type === "item_completed" && it?.type === "AgentMessage" && it.delivery === "async") out.push({ call_id: String(it.id), text: textOf(it.content), questions: it.questions ?? null });
  }
  return out;
}

/** A Codex rollout as the transcript.ndjson shape Claude Code writes for the same conversation. */
export function codexTranscript(rollout: string): string {
  const lines: Rec[] = [];
  let session = "";
  let model: string = CODEX.model;
  let n = 0;
  let inReply = 0;
  let last = "";
  let usage: Rec | null = null;
  const meta = () => ({ parent_tool_use_id: null, session_id: session });
  const assistant = (content: Rec[], stop: string | null = null) => {
    lines.push({ type: "assistant", message: { id: "msg_codex_" + ++n, type: "message", role: "assistant", model, content, stop_reason: stop, usage: null }, ...meta() });
    inReply++;
  };
  const user = (content: Rec[]) => lines.push({ type: "user", message: { role: "user", content }, ...meta() });
  const asked = new Set<string>();
  for (const raw of rollout.split("\n")) {
    if (!raw.trim()) continue;
    let d: Rec;
    try {
      d = JSON.parse(raw);
    } catch {
      continue;
    }
    const p: Rec = d.payload ?? {};
    if (d.type === "session_meta") {
      session = String(p.id ?? p.session_id ?? "");
      lines.push({ type: "system", subtype: "init", session_id: session, model, cwd: p.cwd ?? null, cli_version: p.cli_version ?? null, host: "codex" });
    } else if (d.type === "turn_context" && typeof p.model === "string") model = p.model;
    else if (d.type === "token_usage_record") usage = p.turn_token_usage ?? p.usage ?? usage;
    else if (d.type === "response_item") {
      if (p.type === "message" && p.role === "assistant") {
        const content = (p.content ?? []) as Rec[];
        const refusal = content.find((c) => c.type === "refusal");
        const text = content.filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
        if (refusal) assistant([{ type: "text", text: text || String(refusal.refusal ?? "") }], "refusal");
        else if (text.trim()) {
          assistant([{ type: "text", text }]);
          last = text;
        }
      } else if (p.type === "message" && p.role === "user" && provenance(p).some((k) => INJECTED.has(k))) user([{ type: "text", text: textOf(p.content) }]);
      else if (p.type === "function_call" && p.name === ASYNC_QUESTION) asked.add(String(p.call_id));
      else if (p.type === "function_call_output" && asked.has(String(p.call_id))) continue;
      else if (p.type === "function_call") {
        let input: unknown;
        try {
          input = JSON.parse(p.arguments ?? "{}");
        } catch {
          input = { arguments: p.arguments };
        }
        assistant([{ type: "tool_use", id: p.call_id, name: (p.namespace ? p.namespace + "." : "") + p.name, input }]);
      } else if (p.type === "custom_tool_call") assistant([{ type: "tool_use", id: p.call_id, name: p.name, input: { input: p.input } }]);
      else if (p.type === "web_search_call") {
        const id = p.id ?? "ws_" + n;
        assistant([{ type: "tool_use", id, name: "WebSearch", input: { query: p.action?.query ?? null } }]);
        user([{ type: "tool_result", tool_use_id: id, content: "web search " + String(p.status ?? "") }]);
      } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") user([{ type: "tool_result", tool_use_id: p.call_id, content: textOf(p.output) }]);
      else if (p.type === "compaction" || p.type === "context_compaction") lines.push({ type: "system", subtype: "compact_boundary", ...meta() });
    } else if (d.type === "event_msg" && p.type === "item_completed" && p.item?.type === "AgentMessage" && p.item.delivery === "async") assistant([{ type: "text", text: textOf(p.item.content) }]);
    else if (d.type === "event_msg" && (p.type === "task_complete" || p.type === "turn_aborted" || p.type === "error")) {
      const ok = p.type === "task_complete";
      lines.push({ type: "result", subtype: ok ? "success" : "error_during_execution", is_error: !ok, num_turns: inReply, result: ok ? (p.last_agent_message ?? last) : String(p.message ?? p.reason ?? p.type), session_id: session, usage });
      inReply = 0;
    }
  }
  return lines.map((l) => JSON.stringify(l) + "\n").join("");
}

/** The none arm's gstack-read audit over every rollout of a Codex session: a tool call whose input names gstack, or an injected skill or AGENTS.md item. */
export function codexReads(rollouts: readonly string[]): string[] {
  const hits: string[] = [];
  for (const r of rollouts)
    for (const raw of r.split("\n")) {
      let d: Rec;
      try {
        d = JSON.parse(raw);
      } catch {
        continue;
      }
      const p: Rec = d.payload ?? {};
      if (d.type !== "response_item") continue;
      const input = p.type === "function_call" ? String(p.arguments ?? "") : p.type === "custom_tool_call" ? String(p.input ?? "") : null;
      if (input !== null && /gstack/i.test(input)) hits.push(p.name + " " + input.slice(0, 200));
      if (p.type === "message" && p.role === "user") for (const k of provenance(p)) if (INJECTED.has(k)) hits.push(k + " item " + textOf(p.content).slice(0, 120));
    }
  return hits;
}

/** Changed lines in the unified diff from a to b. */
export function renderGap(a: string, b: string): number {
  const dir = mkdtempSync(join(tmpdir(), "ohr-gap-"));
  try {
    writeFileSync(join(dir, "a"), a);
    writeFileSync(join(dir, "b"), b);
    const d = spawnSync("diff", ["-u", join(dir, "a"), join(dir, "b")], { encoding: "utf8" });
    return d.stdout.split("\n").filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l)).length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A Sol skill arm's host-side install (its tree laid out from HOME) against its pin: VERSION, and the rendered SKILL.md at both entries. */
export function codexTreeProblems(home: string | null, arm: SkillArm): string[] {
  if (!home || !existsSync(home)) return ["no Codex install at " + home];
  const pin = PINS[arm]!;
  const p: string[] = [];
  const version = join(home, ".local/share/gstack/VERSION");
  const bytes = existsSync(version) ? readFileSync(version) : null;
  if (bytes?.toString("utf8").trim() !== pin.version || sha256(bytes!) !== pin.version_sha256) p.push(".local/share/gstack/VERSION is not the pin's " + pin.version);
  for (const f of CODEX_SKILL_FILES) {
    const got = existsSync(join(home, f)) ? sha256(readFileSync(join(home, f))) : null;
    if (got !== CODEX_RENDERED[arm].sha256) p.push(f + (got ? " hashes to " + got : " is missing") + ", and the render is frozen at " + CODEX_RENDERED[arm].sha256);
  }
  return p;
}

/** The current-to-new gap over both Sol installs: the pins' own office-hours/SKILL.md and Codex's render must both differ by RENDER_GAP lines. */
export function gapProblems(current: string, next: string): string[] {
  const read = (h: string, f: string) => (existsSync(join(h, f)) ? readFileSync(join(h, f), "utf8") : "");
  const pins = renderGap(read(current, ".local/share/gstack/office-hours/SKILL.md"), read(next, ".local/share/gstack/office-hours/SKILL.md"));
  const rendered = renderGap(read(current, CODEX_SKILL_FILES[0]), read(next, CODEX_SKILL_FILES[0]));
  return pins === RENDER_GAP && rendered === RENDER_GAP ? [] : ["the current-to-new gap is " + pins + " changed lines in the pins and " + rendered + " in the render, and " + RENDER_GAP + " is frozen"];
}

/** The shell step each Sol container runs at its end: the Codex binary's sha256 and, on a skill arm, VERSION and both rendered entries. */
export const codexPinCommand = (home: string, arm: SkillArm | null): string =>
  "sha256sum " + CODEX.bin + (arm ? ' && cd "' + home + '" && printf "VERSION %s\\n" "$(cat .local/share/gstack/VERSION 2>/dev/null)" && for f in .local/share/gstack/VERSION ' + CODEX_SKILL_FILES.join(" ") + '; do if [ -f "$f" ]; then sha256sum "$f"; else echo "missing $f"; fi; done' : "");

/** Mismatches in what codexPinCommand printed. */
export function codexPinProblems(printed: string, arm: SkillArm | null): string[] {
  const hashes = new Map(printed.split("\n").flatMap((l) => {
    const m = /^([0-9a-f]{64})\s+(.+)$/.exec(l.trim());
    return m ? [[m[2]!, m[1]!] as const] : [];
  }));
  const p: string[] = [];
  if (hashes.get(CODEX.bin) !== CODEX.binary_sha256) p.push(CODEX.bin + " in the container " + (hashes.has(CODEX.bin) ? "hashes to " + hashes.get(CODEX.bin) : "is missing"));
  if (!arm) return p;
  const pin = PINS[arm]!;
  const version = /^VERSION (.*)$/m.exec(printed)?.[1]?.trim() ?? null;
  if (version !== pin.version || hashes.get(".local/share/gstack/VERSION") !== pin.version_sha256) p.push("VERSION in the container is not the pin's " + pin.version);
  for (const f of CODEX_SKILL_FILES) if (hashes.get(f) !== CODEX_RENDERED[arm].sha256) p.push(f + " in the container " + (hashes.has(f) ? "hashes to " + hashes.get(f) : "is missing"));
  return p;
}

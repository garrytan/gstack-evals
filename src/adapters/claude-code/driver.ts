// The Claude Code host adapter (interface v0.5, "Interactive tasks" and "Hosts"): an AgentDriver (src/trial/trial.ts)
// that drives Claude Code through the Agent SDK over bidirectional stream-json, with the CLI running inside the trial's
// agent session (a docker exec into the arm container, or bubblewrap) and the SDK, the canUseTool callback and the
// user simulator on the evaluator side. The persona, the sidecar and the event log never enter the agent's container.
//
// - The model reaches the metering proxy only: ANTHROPIC_BASE_URL names the session's slot on the proxy for the cell's
//   provider (anthropic, or openrouter through OpenRouter's Anthropic-compatible /v1/messages route), and
//   ANTHROPIC_AUTH_TOKEN carries the slot's per-session bearer. Every model variable names the cell's model, and bundled
//   skills, updates, telemetry and nonessential traffic are off (CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm).
// - The system prompt is the Agent SDK's default unless the options ask for Claude Code's: systemPrompt sdk-default
//   passes no systemPrompt option at all, and claude-code-preset passes the SDK's claude_code preset. init.json records
//   which one ran (system_prompt). A session takes at most maxTurns model turns, MAX_TURNS unless the run sets another.
// - capStops records a session's own caps as their own terminations: a session the turn cap ends (an error_max_turns
//   result) is turn_cap, and one whose next call the slot's allowance cannot hold (the proxy's E_ALLOWANCE refusal that
//   names the slot's allowance) is allowance_stop. Without it, as before, the turn cap ends the session as completed and
//   the allowance as a missing cell (E_ALLOWANCE). Any other E_ALLOWANCE refusal (a route, model or price the slot does
//   not allow) stays a missing cell either way.
//   sessionKind unattended adds GSTACK_SESSION_KIND=unattended to the agent env; unset, the adapter sets no session kind.
//   disable1mContext adds CLAUDE_CODE_DISABLE_1M_CONTEXT=1, so a model the CLI would give a 1,000,000-token window (Opus 5.5
//   at Claude Code 2.1.314, compacting at 967,000) gets 200,000 and compacts at 167,000, as every other model does.
//   skillGateDeadlineMs adds GSTACK_SKILL_GATE_DEADLINE_MS to the agent env. settings runs its command in the session's
//   sandbox at session start, so paths it prints are the ones the session sees, and passes what make returns as the Agent
//   SDK's settings option, written to settings.json; a command that fails, or printed text make refuses, is a missing
//   cell, E_SESSION_SETTINGS, before Claude Code starts.
// - canUseTool answers AskUserQuestion from the user simulator (src/usersim/sim.ts) and allows every other tool. An
//   AskUserQuestion in a task that declared no user replies ends the trial as a missing cell, E_USER_TURNS_MISSING,
//   naming the question. WebSearch and WebFetch are disallowed: they reach outside the trial network's lock.
// - An SDK-side PreToolUse hook answers "ask" for every tool call, so each one reaches canUseTool even when an allow
//   rule (a fixture's or the agent's own .claude/settings.json), a settings hook or a permission mode would approve it
//   first. After the session, an AskUserQuestion whose result canUseTool never gave (an answer, or another hook's deny
//   reason) ends the cell as a missing cell, E_APPROVAL_BYPASS, unless it was a cap stop: no route answers a question
//   without the simulator.
// - The session's clock stops while the persona's free-form source answers, from the first pending answer until the last
//   one returns, so usersim latency never times the arm out. A stall that ends as the pause starts is credited first.
// - A question the sidecar does not answer goes to the persona's free-form source when the run passes one
//   (src/usersim/persona.ts); a source that cannot answer ends the cell with its termination.
// - After each turn whose last text ends in a question, the simulator's reply goes in as the next user message; the
//   session ends when it has none.
// - The adapter writes the evaluator's records beside the trial, never into the work dir: every SDK message
//   (transcript.ndjson), the init message's tools, skills and versions (init.json), calls[] (calls.json), the user
//   simulator's event log (usersim.ndjson) and the CLI's stderr (cli-stderr.log), which the adapter drains itself, since
//   the SDK reads no stderr from a process it did not spawn.
// - A proxy refusal reaches the session as an API error whose text carries the refusal's code: CAP_STOP stops the cell
//   as a cap stop, E_KEY_REJECTED as rejected credentials, and E_KEY_MISSING, E_SLOT_DENIED, E_ALLOWANCE or UPSTREAM leave a missing
//   cell, as does any other API error the CLI gives up on: a provider failure is no outcome to count, before or after the
//   session's first model output. The wall-clock limit is a timeout. The CLI's process ending on its own while the agent's
//   session still answers is an arm failure (harness_crash), and so is an error result after model output (before any,
//   it is a missing cell, UPSTREAM). The CLI exits on its own only when it exits before the adapter's abort and before the
//   SDK closes its input; an exit after either is teardown. While the turn's result is still awaited and the adapter has
//   not ended the session, a stream that ends is infra, never a crash: a normal finish delivers a result, so that end
//   means the link broke. A CLI that exits 0 with no signal is never a crash either, nor is an exit with docker exec's own
//   125, 126 or 127 (LAUNCHER_EXITS), which name the launcher. Any other failure is infra, never the arm's: the
//   evaluator's own code (the transcript, init, stderr or calls write, the user simulator, the persona), the SDK's link to
//   a CLI that still runs (a reset or a broken pipe, and the exit that follows when the SDK closes the CLI's input), or
//   the machine (a spawn that fails, a session that no longer answers once the CLI ends). An infra failure leaves a
//   missing cell, E_INFRA_FAILURE; the adapter's logging is best effort, so a log it cannot write never hangs or throws.
//   Once a timeout or an arm failure is recorded, an error from the adapter's own abort or teardown (a kill that hits a
//   docker exec already gone, a child error after the abort) does not replace it; cli-stderr.log names it as teardown
//   after that stop.
// - The session's clock reads performance.now, so a wall-clock step never moves it, and runs only while the evaluator's
//   event loop does: a stall between its 250 ms ticks (another session's synchronous docker step, say) moves the
//   deadline by the stall, up to a tenth of the session's timeout in all, and the outcome's credited_stall_ms records the
//   credit. Once the credit reaches that cap, a timeout is infra (E_INFRA_FAILURE), never the arm's. The liveness probe
//   after a crash runs as a spawned process, so it never stalls other sessions.
// - The outcome's model_output says whether the model produced any output: an assistant message that is not an API error,
//   with text or thinking that holds more than whitespace, a thinking block with a non-empty signature (the API's proof
//   that the model reasoned, whatever the display mode; rule 2 as GSTA-2 amended it), redacted thinking with data, or a
//   tool call. Scorers
//   read it instead of turns, which hold main-agent text only. text_output says whether the main agent wrote any text,
//   apart from the AskUserQuestion questions turns also hold. exit_code and signal record the CLI's own exit; both are
//   null when it did not exit on its own (the adapter's abort or teardown, or the SDK closing its input, ended it, or it
//   never ended).
// - CLAUDE_CODE_MAX_OUTPUT_TOKENS holds each request to the proxy's per-call output cap, which Claude Code's default
//   (128k) passes. CLAUDE_CODE_MAX_RETRIES=0 leaves retries to the proxy, which journals and charges every paid attempt
//   under its own budget, so the CLI never multiplies them or waits out its backoff on a refusal.
// - An arm whose stack is a Claude Code plugin (pstack) is loaded for the session as a plugin directory (plugins, the
//   Agent SDK's --plugin-dir), so its skills answer as /<plugin>:<name>.
// - In a cell that keeps a cross-family voice (codex), the session can run the Codex CLI on the same proxy slot: before
//   Claude Code starts, a shell step writes ~/.codex/config.toml with the proxy provider for the slot (the Codex host
//   adapter's settings, retries off) and the voice's model, and OPENAI_API_KEY carries the slot's bearer, so no file
//   holds a credential and no provider key enters the session. A step that cannot write it leaves a missing cell,
//   E_CODEX_CONFIG.
// - Background work (GST-734). Claude Code 2.1.314 runs Agent calls in the background by default, and while its input
//   stays open it starts a turn of its own when a background task finishes or a ScheduleWakeup fires. The hold is opt-in
//   (GSTA-2's C1 ruling on #141): only a run that sets backgroundWaitMs gets it (review-units always does), and any other
//   session ends at its turn's result as before and records no session_end. With a wait set, when a turn ends and the
//   simulator has no reply, the adapter keeps the session open while work it can see still holds it: a
//   background task the main thread launched that has not finished (the CLI's background_tasks_changed level, less tasks
//   whose task_notification came, ambient tasks and tasks a subagent launched), or a pending ScheduleWakeup the agent set
//   while no such task ran. A wakeup set while tasks ran is their fallback: it stops holding the session once they
//   finish, and session_end lists it under released_wakeups with when it was set, its delay and what ran then. R2's three
//   fallback sessions (GEVA-151) are why: their 1200 s wakeups would fire after the report and leave a later last turn.
//   The wait is bounded: in all, the session may sit idle at most backgroundWaitMs, counted from each such turn's result
//   to the start of the main agent's next turn: the system init the CLI sends when it starts a turn of its own (2.1.314
//   sends one on every task-notification turn) or the main agent's next message, whichever comes first. At that deadline the session ends as a missing cell, E_BACKGROUND_DEADLINE, never as
//   the arm finding nothing, and so does a session whose timeout comes while it sits idle on held work (GSTA-2's B1
//   ruling on #141); a timeout during an active turn stays the arm's. Every other stop (a cap stop, the turn cap or the
//   allowance, a crash) keeps its own termination. The outcome's session_end
//   records the cause (clean: nothing held the session at its end; deadline; tasks_pending: it ended another way while
//   work still held it), what was pending and the idle time waited, in whole ms rounded up so any held idle counts.
// - followUp (the ceo-outcome lens) sends one more user message, at most once per session: at a success result with no
//   simulator reply and nothing holding the session, when needed(the session's transcript.ndjson text so far, the same
//   messages the transcript holds) is true. Never at any other result or termination, and never twice.
// - session.json records the session's own clock (session_ms: from the first message to the end, less credited stalls
//   and the persona's pauses, the clock the timeout runs on), the stall credit, the pauses and whether the follow-up went.
import type { ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import type { SidecarTask } from "../../skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../../skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../trial/trial.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../runner/proxy/metering-proxy.ts";
import type { SessionEnd, Termination, TokenUsage } from "../../types.ts";
import { parseClaudeCode, skillUse, type SkillRef } from "../../grade/transcript.ts";
import { UserSim } from "../../usersim/sim.ts";
import { codexConfig, type CodexProvider } from "../codex/driver.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import type { AskQuestion } from "../../usersim/classifier.ts";

export type ClaudeProvider = "anthropic" | "openrouter";

/** The Claude Code CLI's name inside the agent's environment; the trial image installs it at the pinned version. */
export const CLAUDE_BIN = "claude";

/** The most model turns a session may take. */
export const MAX_TURNS = 60;

/** review-units' default background wait: the most time, in all, a session may sit idle with its turn over, waiting on background work it started. */
export const BACKGROUND_WAIT_MS = 3_600_000;

export const SYSTEM_PROMPTS = ["sdk-default", "claude-code-preset"] as const;
export type SystemPrompt = (typeof SYSTEM_PROMPTS)[number];

export const DISALLOWED_TOOLS = ["WebSearch", "WebFetch"];

/** Proxy refusal codes the adapter maps to a termination when an API error names them. */
const REFUSALS: ReasonCode[] = ["CAP_STOP", "E_KEY_REJECTED", "E_KEY_MISSING", "E_SLOT_DENIED", "E_ALLOWANCE", "E_LEDGER_UNAVAILABLE", "UPSTREAM"];

export interface ClaudeCodeOptions {
  model: string;
  provider: ClaudeProvider;
  /** The proxy's trial base URL as agents reach it, the slot and its per-session bearer. */
  proxy: { baseUrl: string; slot: string; token: string };
  /** The task's sidecar entry: user replies and persona. Evaluator side only. */
  entry?: SidecarTask;
  /** The arm's skill, for calls[] and the opened signal; null for an arm with no skill (none, bare). */
  skill: (SkillRef & { dir: string | null }) | null;
  /** The trial's evaluator-side directory for the adapter's records. */
  out: string;
  /** The most model turns the session may take; MAX_TURNS when unset. */
  maxTurns?: number;
  /** The session's system prompt; sdk-default when unset. */
  systemPrompt?: SystemPrompt;
  /** GSTACK_SESSION_KIND for the agent env; unset, the adapter sets none. */
  sessionKind?: "unattended";
  /** GSTACK_SKILL_GATE_DEADLINE_MS for the agent env, the gstack gate hooks' own deadline; unset, the adapter sets none. */
  skillGateDeadlineMs?: number;
  /** CLAUDE_CODE_DISABLE_1M_CONTEXT=1 for the agent env, so the CLI's window is 200,000 tokens on every model; unset, the CLI's own window. */
  disable1mContext?: boolean;
  /** Settings printed at session start by command in the session's sandbox; make turns the printed text into the SDK's settings option, or says why it can't. */
  settings?: { command: string; make: (printed: string) => Record<string, unknown> | string };
  /** Record the turn cap and the slot's allowance as their own terminations (turn_cap, allowance_stop); unset, today's. */
  capStops?: boolean;
  /** The most idle time, in all, the session may wait on its background work; unset, it ends at its turn's result as before (no hold, no session_end). */
  backgroundWaitMs?: number;
  /** The persona's free-form answers, evaluator side; absent, an unanswered question gets the simulator's fallback. */
  freeform?: (persona: string, question: string) => Promise<PersonaAnswer>;
  /** The Agent SDK's query function; tests pass the real one or a stand-in. */
  query?: QueryFn;
  /** One follow-up user message, at most once: at a success result with no simulator reply and nothing holding the session, when needed(the transcript.ndjson text so far) is true. */
  followUp?: { text: string; needed: (transcript: string) => boolean };
  /** Plugin roots in the agent's HOME, loaded for the session as plugin directories. */
  plugins?: string[];
  /** The cell's cross-family voice through the Codex CLI: the provider of the slot's route and the model Codex runs. */
  codex?: { provider: CodexProvider; model: string };
}

// The slice of the Agent SDK this adapter uses, typed loosely so a test can stand one in.
type SdkMessage = Record<string, any>;
type QueryFn = (args: { prompt: AsyncIterable<SdkMessage>; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;

/** The agent env the adapter adds: proxy, bearer, model purity and host settings. Every name is on U9's agent allowlist. */
export function claudeCodeEnv(o: Pick<ClaudeCodeOptions, "model" | "provider" | "proxy" | "codex" | "sessionKind" | "skillGateDeadlineMs" | "disable1mContext">): Record<string, string> {
  return {
    ...(o.codex ? { OPENAI_API_KEY: o.proxy.token } : {}),
    ANTHROPIC_BASE_URL: o.proxy.baseUrl.replace(/\/+$/, "") + "/" + o.proxy.slot + "/" + o.provider,
    ANTHROPIC_AUTH_TOKEN: o.proxy.token,
    ANTHROPIC_MODEL: o.model,
    ANTHROPIC_SMALL_FAST_MODEL: o.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: o.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: o.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: o.model,
    CLAUDE_CODE_SUBAGENT_MODEL: o.model,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(DEFAULT_MAX_OUTPUT_TOKENS),
    CLAUDE_CODE_MAX_RETRIES: "0",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    DISABLE_TELEMETRY: "1",
    ...(o.sessionKind ? { GSTACK_SESSION_KIND: o.sessionKind } : {}),
    ...(o.skillGateDeadlineMs ? { GSTACK_SKILL_GATE_DEADLINE_MS: String(o.skillGateDeadlineMs) } : {}),
    ...(o.disable1mContext ? { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } : {}),
  };
}

/** The shell step that writes the session's Codex config: the proxy provider for the slot and the voice's model, no credential. */
export function codexConfigCommand(codex: NonNullable<ClaudeCodeOptions["codex"]>, proxy: ClaudeCodeOptions["proxy"]): string {
  const lines = ["model = " + JSON.stringify(codex.model), ...Object.entries(codexConfig({ provider: codex.provider, proxy })).map(([k, v]) => k + " = " + JSON.stringify(v))];
  return 'mkdir -p "$HOME/.codex" && cat > "$HOME/.codex/config.toml" <<\'GSE_CODEX\'\n' + lines.join("\n") + "\nGSE_CODEX\n";
}

/** Names the SDK sets on the CLI it spawns that the adapter passes on; the rest of the SDK's env is the evaluator's and stays out. */
const SDK_ENV = ["CLAUDE_CODE_ENTRYPOINT", "CLAUDE_AGENT_SDK_VERSION"];

class Inbox {
  private items: SdkMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(m: SdkMessage): void {
    if (this.closed) return;
    this.items.push(m);
    this.wake?.();
  }
  close(): void {
    this.closed = true;
    this.wake?.();
  }
  async *stream(): AsyncGenerator<SdkMessage> {
    for (;;) {
      if (this.items.length) yield this.items.shift()!;
      else if (this.closed) return;
      else await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const userMessage = (text: string): SdkMessage => ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: "" });

/**
 * AskUserQuestion calls whose result did not come through canUseTool, by tool_use id: a result that answers, or any
 * result for a call the adapter's PreToolUse hook saw, since another hook's deny reason reaches the model as the
 * result. An error result for a call no hook saw (input the CLI refused before the hooks) is not one.
 */
export function unapprovedAsks(messages: readonly SdkMessage[], approved: ReadonlySet<string>, hooked: ReadonlySet<string> = new Set()): string[] {
  const asks = new Set<string>();
  const results: { id: string; error: boolean }[] = [];
  for (const m of messages) {
    for (const b of Array.isArray(m.message?.content) ? (m.message.content as SdkMessage[]) : []) {
      if (m.type === "assistant" && b.type === "tool_use" && b.name === "AskUserQuestion") asks.add(b.id);
      if (m.type === "user" && b.type === "tool_result") results.push({ id: b.tool_use_id, error: b.is_error === true });
    }
  }
  return results.filter((r) => asks.has(r.id) && !approved.has(r.id) && (!r.error || hooked.has(r.id))).map((r) => r.id);
}

const ROUTE_TO_CAN_USE_TOOL = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "every tool call goes through the adapter's canUseTool" } };

/** The proxy refusal an API error's text names, if any. */
export function refusalIn(text: string): ReasonCode | null {
  return REFUSALS.find((code) => new RegExp("\\b" + code + "\\b").test(text)) ?? null;
}

/** The metering proxy's refusal when the slot's allowance cannot hold a call's worst case (src/runner/proxy/metering-proxy.ts). */
export const ALLOWANCE_SPENT = /the slot's allowance of \$\d+(?:\.\d+)? cannot hold this call's worst case/;

/** The termination a proxy refusal ends the cell with. */
export function refusalTermination(refusal: ReasonCode): Termination {
  if (refusal === "CAP_STOP") return { kind: "cap_stop" };
  if (refusal === "E_KEY_REJECTED") return { kind: "credentials_rejected" };
  return { kind: "missing", code: refusal };
}

/** A session that failed for no reason of the arm's: the evaluator, the link to the CLI or the machine. */
const INFRA: Termination = { kind: "missing", code: "E_INFRA_FAILURE" };

/** Exit codes a launcher gives for its own failure (docker exec: 125 the daemon, 126 not runnable, 127 not found), never the CLI's. */
export const LAUNCHER_EXITS: ReadonlySet<number> = new Set([125, 126, 127]);

/**
 * Whether the agent's session still runs a command, asked through a spawned process so the event loop, and every other
 * session's clock, never waits on it; one that does not answer after the CLI ended means the machine failed.
 */
const answers = (session: AgentSession): Promise<boolean> =>
  new Promise((done) => {
    let probe: ChildProcess;
    try {
      probe = session.spawn(["true"]);
    } catch {
      return done(false);
    }
    const timer = setTimeout(() => {
      probe.kill("SIGKILL");
      done(false);
    }, 30_000);
    probe.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
    probe.once("exit", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
    probe.stdin?.end();
  });

/**
 * Whether an assistant block is model output (rule 2 as GSTA-2 amended it, 2026-11-01): text or thinking with something in
 * it, a thinking block with a non-empty signature (the API's proof that the model reasoned, whatever the display mode),
 * redacted thinking with data, or a tool call.
 */
export const producedOutput = (b: SdkMessage): boolean =>
  b.type === "tool_use" ||
  (b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") ||
  (b.type === "thinking" && ((typeof b.thinking === "string" && b.thinking.trim() !== "") || (typeof b.signature === "string" && b.signature !== ""))) ||
  (b.type === "redacted_thinking" && typeof b.data === "string" && b.data !== "");

/** The session clock's tick; a gap between ticks past TICK_MS + STALL_MS is the evaluator's event loop stalling, not the arm's time. The clock credits stalls back up to a tenth of the session's timeout. */
const TICK_MS = 250;
const STALL_MS = 250;

const tokens = (u: Record<string, any> | undefined): TokenUsage | null =>
  u ? { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 } : null;

export interface ClaudeCodeDriver extends AgentDriver {
  /** The last run's user simulator: its questions and misaligned replies. */
  sim: UserSim | null;
}

export function claudeCodeDriver(o: ClaudeCodeOptions): ClaudeCodeDriver {
  const stderrLog = join(o.out, "cli-stderr.log");
  const log = (line: string) => {
    try {
      appendFileSync(stderrLog, line);
    } catch {
      return;
    }
  };
  const without = (termination: Termination): AgentOutcome => ({ turns: [], termination, model_output: false, text_output: false, exit_code: null, signal: null, opened: o.skill ? false : null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null });
  const driver: ClaudeCodeDriver = {
    sim: null,
    env: claudeCodeEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      try {
        mkdirSync(o.out, { recursive: true });
      } catch {
        return without(INFRA);
      }
      if (o.codex) {
        const wrote = session.exec(codexConfigCommand(o.codex, o.proxy), 30_000);
        if (wrote.exitCode !== 0) {
          log("adapter: the Codex config step exited " + wrote.exitCode + ": " + (wrote.stdout + wrote.stderr).trim().slice(-500) + "\n");
          return without({ kind: "missing", code: "E_CODEX_CONFIG" });
        }
      }
      let settings: Record<string, unknown> | null = null;
      if (o.settings) {
        const printed = session.exec(o.settings.command, 30_000);
        const made = printed.exitCode === 0 ? o.settings.make(printed.stdout) : "the settings command exited " + printed.exitCode + ": " + (printed.stdout + printed.stderr).trim().slice(-500);
        if (typeof made === "string") {
          log("adapter: the session's settings could not be made: " + made + "\n");
          return without({ kind: "missing", code: "E_SESSION_SETTINGS" });
        }
        settings = made;
        try {
          writeFileSync(join(o.out, "settings.json"), JSON.stringify(made, null, 2) + "\n");
        } catch {
          return without(INFRA);
        }
      }
      const transcript = join(o.out, "transcript.ndjson");
      const query = o.query ?? ((await import("@anthropic-ai/claude-agent-sdk")).query as unknown as QueryFn);
      const messages: SdkMessage[] = [];
      const inbox = new Inbox();
      inbox.push(userMessage(task.prompt));
      const abort = new AbortController();
      let stop: Termination | null = null;
      let missingQuestion: string | null = null;
      let modelOutput = false;
      let textOutput = false;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;
      let awaitingResult = true;
      let ended = false;
      let agentTurns = 0;
      let usage: TokenUsage | null = null;
      const waitMs = o.backgroundWaitMs ?? null;
      const level = new Map<string, { run: string; label: string }>();
      const landed = new Set<string>();
      const wakeupCalls = new Set<string>();
      let wakeup: SessionEnd["released_wakeups"][number] | null = null;
      let idleSince: number | null = null;
      let waited = 0;
      let overdue = false;
      let followed = false;
      const running = (): string[] => [...level.values()].filter((t) => !landed.has(t.run)).map((t) => t.label);
      const holding = (): string[] => {
        const tasks = running();
        return wakeup && (tasks.length || !wakeup.running.length) ? [...tasks, "ScheduleWakeup firing at " + wakeup.fires_at] : tasks;
      };
      const end = (t: Termination) => {
        stop ??= t;
        inbox.close();
        abort.abort();
      };
      const infra = (error: unknown) => {
        const before = stop;
        end(INFRA);
        log("adapter: " + (before ? "after the " + before.kind + " stop, teardown: " : "infra failure, not the arm's: ") + String((error as Error)?.message ?? error) + "\n");
      };
      const cap = timeoutMs / 10;
      let credited = 0;
      let full = false;
      const started = performance.now();
      let stoppedAt: number | null = null;
      let pausedMs = 0;
      let deadline = performance.now() + timeoutMs;
      let last = performance.now();
      let settled = false;
      let pauses = 0;
      let paused = 0;
      const stalled = (): number => {
        const now = performance.now();
        const gap = now - last - TICK_MS;
        if (pauses === 0 && gap > STALL_MS) {
          if (gap >= cap - credited) {
            deadline += cap - credited;
            credited = cap;
            full = true;
          } else {
            deadline += gap;
            credited += gap;
          }
        }
        last = now;
        return now;
      };
      const expire = () => {
        if (settled) return;
        const now = stalled();
        if (now < deadline) timer = setTimeout(expire, deadline - now);
        else if (full) infra(new Error("the evaluator's event loop stalled past the session's stall credit of " + cap + " ms, a tenth of its timeout, so the timeout is not the arm's"));
        else if (idleSince !== null) {
          overdue = true;
          log("adapter: the session's timeout came while it sat idle waiting on its background work (" + holding().join("; ") + "), so it ends at the background deadline as a missing cell, E_BACKGROUND_DEADLINE, not the arm's\n");
          end({ kind: "missing", code: "E_BACKGROUND_DEADLINE" });
        } else end({ kind: "timeout" });
      };
      let timer = setTimeout(expire, timeoutMs);
      const watch = setInterval(() => {
        stalled();
        if (waitMs === null || idleSince === null || stop || waited + performance.now() - idleSince < waitMs) return;
        overdue = true;
        log("adapter: the session sat idle " + waitMs + " ms in all waiting on its background work (" + holding().join("; ") + "), so it ends at that deadline as a missing cell, E_BACKGROUND_DEADLINE, not the arm's\n");
        end({ kind: "missing", code: "E_BACKGROUND_DEADLINE" });
      }, TICK_MS);
      const persona = o.freeform;
      const freeform = persona && (async (text: string, question: string) => {
        if (pauses === 0) {
          stalled();
          clearTimeout(timer);
          paused = performance.now();
        }
        pauses++;
        let a: Awaited<ReturnType<typeof persona>>;
        try {
          a = await persona(text, question);
        } finally {
          if (--pauses === 0) {
            pausedMs += performance.now() - paused;
            deadline += performance.now() - paused;
            last = performance.now();
            timer = setTimeout(expire, Math.max(0, deadline - performance.now()));
          }
        }
        if ("text" in a) return a.text;
        end(a.stop);
        return null;
      });
      const sim = (driver.sim = new UserSim({ task: task.id, script: o.entry?.user, log: join(o.out, "usersim.ndjson"), ...(freeform ? { freeform } : {}) }));
      const approved = new Set<string>();
      const hooked = new Set<string>();
      const canUseTool = async (name: string, input: Record<string, unknown>, options?: { toolUseID?: string }) => {
        if (options?.toolUseID) approved.add(options.toolUseID);
        if (name !== "AskUserQuestion") return { behavior: "allow", updatedInput: input };
        let r: Awaited<ReturnType<UserSim["answerAsk"]>>;
        try {
          r = await sim.answerAsk(Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : []);
        } catch (error) {
          infra(error);
          return { behavior: "deny", message: "The evaluator failed.", interrupt: true };
        }
        if ("missing" in r) {
          missingQuestion = r.missing;
          setTimeout(() => end({ kind: "missing", code: "E_USER_TURNS_MISSING" }), 0);
          return { behavior: "deny", message: "No user is available to answer.", interrupt: true };
        }
        return { behavior: "allow", updatedInput: { ...input, answers: r.answers } };
      };
      let turnText = "";
      try {
        const q = query({
          prompt: inbox.stream(),
          options: {
            model: o.model,
            maxTurns: o.maxTurns ?? MAX_TURNS,
            permissionMode: "default",
            settingSources: ["user", "project", "local"],
            ...(settings ? { settings } : {}),
            disallowedTools: DISALLOWED_TOOLS,
            ...(o.systemPrompt === "claude-code-preset" ? { systemPrompt: { type: "preset", preset: "claude_code" } } : {}),
            ...(o.plugins?.length ? { plugins: o.plugins.map((path) => ({ type: "local", path })) } : {}),
            abortController: abort,
            canUseTool,
            hooks: { PreToolUse: [{ hooks: [async (_input: unknown, toolUseID: string | undefined) => (toolUseID && hooked.add(toolUseID), ROUTE_TO_CAN_USE_TOOL)] }] },
            spawnClaudeCodeProcess: (s: { args: string[]; env: Record<string, string | undefined> }) => {
              let cli: ChildProcess;
              try {
                cli = session.spawn([CLAUDE_BIN, ...s.args], Object.fromEntries(SDK_ENV.flatMap((k) => (s.env[k] ? [[k, s.env[k]!]] : []))));
              } catch (error) {
                infra(error);
                throw error;
              }
              cli.on("error", infra);
              cli.stderr?.on("error", infra);
              cli.stderr?.on("data", (d: Buffer) => {
                try {
                  appendFileSync(stderrLog, d);
                } catch (error) {
                  infra(error);
                }
              });
              cli.on("exit", (code, signal) => {
                if (abort.signal.aborted || cli.stdin?.writableEnded) return;
                exitCode = code;
                exitSignal = signal;
              });
              return cli;
            },
          },
        });
        for await (const m of q) {
          try {
            messages.push(m);
            appendFileSync(transcript, JSON.stringify(m) + "\n");
            if (m.type === "system" && m.subtype === "init") {
              if (!m.parent_tool_use_id && idleSince !== null) {
                waited += performance.now() - idleSince;
                idleSince = null;
              }
              writeFileSync(join(o.out, "init.json"), JSON.stringify({ model: m.model, claude_code_version: m.claude_code_version, permissionMode: m.permissionMode, apiKeySource: m.apiKeySource, tools: m.tools, skills: m.skills, cwd: m.cwd, system_prompt: o.systemPrompt ?? "sdk-default" }, null, 2) + "\n");
            } else if (m.type === "system" && m.subtype === "background_tasks_changed") {
              level.clear();
              for (const t of Array.isArray(m.tasks) ? (m.tasks as SdkMessage[]) : []) if (!t.ambient && !t.parent_task_id) level.set(t.task_id, { run: t.run_id ?? t.task_id, label: t.task_type + " " + JSON.stringify(t.description) });
            } else if (m.type === "system" && m.subtype === "task_notification") {
              landed.add(m.run_id ?? m.task_id);
            } else if (m.type === "command_lifecycle" && m.state === "started" && m.wakeup_source === "loop_wakeup") {
              wakeup = null;
            } else if (m.type === "user" && !m.parent_tool_use_id) {
              const r = m.tool_use_result;
              const scheduled = Array.isArray(m.message?.content) && (m.message.content as SdkMessage[]).some((b) => b.type === "tool_result" && wakeupCalls.has(b.tool_use_id) && b.is_error !== true);
              if (scheduled && r?.stopped === true) wakeup = null;
              else if (scheduled && typeof r?.scheduledFor === "number") wakeup = { set_at: new Date().toISOString(), delay_s: typeof r.clampedDelaySeconds === "number" ? r.clampedDelaySeconds : Math.round((r.scheduledFor - Date.now()) / 1000), fires_at: new Date(r.scheduledFor).toISOString(), running: running() };
            } else if (m.type === "assistant") {
              const text = (m.message?.content ?? []).filter((b: SdkMessage) => b.type === "text").map((b: SdkMessage) => b.text ?? "").join("");
              if (!m.parent_tool_use_id && idleSince !== null) {
                waited += performance.now() - idleSince;
                idleSince = null;
              }
              if (m.error || m.is_api_error_message) {
                const refusal = refusalIn(text);
                if (refusal) end(o.capStops && refusal === "E_ALLOWANCE" && ALLOWANCE_SPENT.test(text) ? { kind: "allowance_stop" } : refusalTermination(refusal));
                else if (m.error === "authentication_failed") end({ kind: "credentials_rejected" });
                else if (m.error !== "max_output_tokens") end({ kind: "missing", code: "UPSTREAM" });
              } else {
                if ((m.message?.content ?? []).some(producedOutput)) modelOutput = true;
                if (!m.parent_tool_use_id) for (const b of m.message?.content ?? []) if (b.type === "tool_use" && b.name === "ScheduleWakeup") wakeupCalls.add(b.id);
                if (!m.parent_tool_use_id && text.trim()) {
                  turnText = text;
                  textOutput = true;
                }
              }
            } else if (m.type === "result") {
              awaitingResult = false;
              agentTurns += m.num_turns ?? 0;
              usage = tokens(m.usage) ?? usage;
              if (stop) break;
              if (m.subtype !== "success" && m.subtype !== "error_max_turns") {
                end(modelOutput ? { kind: "arm_failure", failure: "harness_crash" } : { kind: "missing", code: "UPSTREAM" });
                break;
              }
              if (m.subtype === "error_max_turns" && o.capStops) stop ??= { kind: "turn_cap" };
              const next = m.subtype === "success" ? await sim.afterTurn(turnText) : { end: "max_turns" };
              turnText = "";
              if ("reply" in next) {
                inbox.push(userMessage(next.reply));
                awaitingResult = true;
              } else if (waitMs !== null && m.subtype === "success" && holding().length) {
                idleSince = performance.now();
                awaitingResult = true;
              } else if (o.followUp && !followed && m.subtype === "success" && o.followUp.needed(messages.map((x) => JSON.stringify(x) + "\n").join(""))) {
                followed = true;
                inbox.push(userMessage(o.followUp.text));
                awaitingResult = true;
              } else {
                if (waitMs === null && holding().length) log("adapter: the session ended at its turn's result with background work still out (" + holding().join("; ") + "); this run sets no background wait, so nothing held it\n");
                ended = true;
                inbox.close();
                break;
              }
            }
          } catch (error) {
            infra(error);
            break;
          }
        }
        if (!stop && !ended && awaitingResult) {
          stop = INFRA;
          log("adapter: infra failure, not the arm's: the SDK stream ended with no result for the turn (CLI exit code " + exitCode + ", signal " + exitSignal + ")\n");
        }
      } catch (error) {
        stoppedAt = performance.now();
        settled = true;
        clearTimeout(timer);
        if (!stop) {
          const crashed = (exitCode !== null && exitCode !== 0 && !LAUNCHER_EXITS.has(exitCode)) || exitSignal !== null;
          const verdict: Termination = crashed && (await answers(session)) ? { kind: "arm_failure", failure: "harness_crash" } : INFRA;
          stop ??= verdict;
          log("adapter: " + (verdict === INFRA ? "infra failure, not the arm's: " : "") + String((error as Error)?.message ?? error) + "\n");
        }
      } finally {
        stoppedAt ??= performance.now();
        settled = true;
        clearTimeout(timer);
        clearInterval(watch);
        if (idleSince !== null) waited += performance.now() - idleSince;
        inbox.close();
        if (!abort.signal.aborted) abort.abort();
      }
      const held = holding();
      const session_end: SessionEnd = { cause: overdue ? "deadline" : held.length ? "tasks_pending" : "clean", pending: held, waited_ms: Math.ceil(waited), released_wakeups: wakeup && wakeup.running.length && !running().length ? [wakeup] : [] };
      if (unapprovedAsks(messages, approved, hooked).length && (stop as Termination | null)?.kind !== "cap_stop") stop = { kind: "missing", code: "E_APPROVAL_BYPASS" };
      const { turns, calls, outputs } = parseClaudeCode(messages);
      const use = skillUse(calls, o.skill, outputs);
      try {
        writeFileSync(join(o.out, "calls.json"), JSON.stringify({ calls, opened: use.opened, files_read: use.files, missing_question: missingQuestion }, null, 2) + "\n");
      } catch (error) {
        infra(error);
      }
      try {
        const end = stoppedAt ?? performance.now();
        const sessionMs = end - started - credited - pausedMs - (pauses > 0 ? end - paused : 0);
        writeFileSync(join(o.out, "session.json"), JSON.stringify({ session_ms: Math.max(0, Math.round(sessionMs)), credited_stall_ms: Math.round(credited), paused_ms: Math.round(pausedMs), follow_up: followed }, null, 2) + "\n");
      } catch (error) {
        infra(error);
      }
      const size = (f: string) => {
        try {
          return o.skill?.dir ? statSync(join(o.skill.dir, f)).size : 0;
        } catch {
          return 0;
        }
      };
      return {
        turns,
        termination: stop ?? { kind: "completed" },
        model_output: modelOutput,
        text_output: textOutput,
        exit_code: exitCode,
        signal: exitSignal,
        credited_stall_ms: Math.round(credited),
        ...(waitMs !== null ? { session_end } : {}),
        opened: o.skill ? use.opened : null,
        files_read: use.files,
        asked: [...sim.asked],
        usage,
        cost_micros: null,
        agent_turns: agentTurns || null,
        loaded_bytes: o.skill?.dir ? use.files.reduce((s, f) => s + size(f), 0) : null,
      };
    },
  };
  return driver;
}

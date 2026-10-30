// The Claude Code host adapter (interface v0.5, "Interactive tasks" and "Hosts"): an AgentDriver (src/trial/trial.ts)
// that drives Claude Code through the Agent SDK over bidirectional stream-json, with the CLI running inside the trial's
// agent session (a docker exec into the arm container, or bubblewrap) and the SDK, the canUseTool callback and the
// user simulator on the evaluator side. The persona, the sidecar and the event log never enter the agent's container.
//
// - The model reaches the metering proxy only: ANTHROPIC_BASE_URL names the session's slot on the proxy for the cell's
//   provider (anthropic, or openrouter through OpenRouter's Anthropic-compatible /v1/messages route), and
//   ANTHROPIC_AUTH_TOKEN carries the slot's per-session bearer. Every model variable names the cell's model, and bundled
//   skills, updates, telemetry and nonessential traffic are off (CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 in every arm).
// - canUseTool answers AskUserQuestion from the user simulator (src/usersim/sim.ts) and allows every other tool. An
//   AskUserQuestion in a task that declared no user replies ends the trial as a missing cell, E_USER_TURNS_MISSING,
//   naming the question. WebSearch and WebFetch are disallowed: they reach outside the trial network's lock.
// - An SDK-side PreToolUse hook answers "ask" for every tool call, so each one reaches canUseTool even when an allow
//   rule (a fixture's or the agent's own .claude/settings.json), a settings hook or a permission mode would approve it
//   first. After the session, an AskUserQuestion whose result canUseTool never gave (an answer, or another hook's deny
//   reason) ends the cell as a missing cell, E_APPROVAL_BYPASS, unless it was a cap stop: no route answers a question
//   without the simulator.
// - The session's clock stops while the persona's free-form source answers, from the first pending answer until the last
//   one returns, so usersim latency never times the arm out.
// - A question the sidecar does not answer goes to the persona's free-form source when the run passes one
//   (src/usersim/persona.ts); a source that cannot answer ends the cell with its termination.
// - After each turn whose last text ends in a question, the simulator's reply goes in as the next user message; the
//   session ends when it has none.
// - The adapter writes the evaluator's records beside the trial, never into the work dir: every SDK message
//   (transcript.ndjson), the init message's tools, skills and versions (init.json), calls[] (calls.json), the user
//   simulator's event log (usersim.ndjson) and the CLI's stderr (cli-stderr.log).
// - A proxy refusal reaches the session as an API error whose text carries the refusal's code: CAP_STOP stops the cell
//   as a cap stop, E_KEY_REJECTED as rejected credentials, and E_KEY_MISSING, E_SLOT_DENIED, E_ALLOWANCE or UPSTREAM leave a missing
//   cell, as does any other API error the CLI gives up on: a provider failure is no outcome to count, before or after the
//   session's first model output. A crash of the CLI is an arm failure (harness_crash); the wall-clock limit is a timeout.
// - CLAUDE_CODE_MAX_OUTPUT_TOKENS holds each request to the proxy's per-call output cap, which Claude Code's default
//   (128k) passes. CLAUDE_CODE_MAX_RETRIES=0 leaves retries to the proxy, which journals and charges every paid attempt
//   under its own budget, so the CLI never multiplies them or waits out its backoff on a refusal.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasonCode } from "../../errors/codes.ts";
import type { SidecarTask } from "../../skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../../skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../trial/trial.ts";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "../../runner/proxy/metering-proxy.ts";
import type { Termination, TokenUsage } from "../../types.ts";
import { parseClaudeCode, skillUse, type SkillRef } from "../../grade/transcript.ts";
import { UserSim } from "../../usersim/sim.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import type { AskQuestion } from "../../usersim/classifier.ts";

export type ClaudeProvider = "anthropic" | "openrouter";

/** The Claude Code CLI's name inside the agent's environment; the trial image installs it at the pinned version. */
export const CLAUDE_BIN = "claude";

/** The most model turns a session may take. */
export const MAX_TURNS = 60;

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
  maxTurns?: number;
  /** The persona's free-form answers, evaluator side; absent, an unanswered question gets the simulator's fallback. */
  freeform?: (persona: string, question: string) => Promise<PersonaAnswer>;
  /** The Agent SDK's query function; tests pass the real one or a stand-in. */
  query?: QueryFn;
}

// The slice of the Agent SDK this adapter uses, typed loosely so a test can stand one in.
type SdkMessage = Record<string, any>;
type QueryFn = (args: { prompt: AsyncIterable<SdkMessage>; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;

/** The agent env the adapter adds: proxy, bearer, model purity and host settings. Every name is on U9's agent allowlist. */
export function claudeCodeEnv(o: Pick<ClaudeCodeOptions, "model" | "provider" | "proxy">): Record<string, string> {
  return {
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
  };
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

/** The termination a proxy refusal ends the cell with. */
export function refusalTermination(refusal: ReasonCode): Termination {
  if (refusal === "CAP_STOP") return { kind: "cap_stop" };
  if (refusal === "E_KEY_REJECTED") return { kind: "credentials_rejected" };
  return { kind: "missing", code: refusal };
}

const tokens = (u: Record<string, any> | undefined): TokenUsage | null =>
  u ? { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 } : null;

export interface ClaudeCodeDriver extends AgentDriver {
  /** The last run's user simulator: its questions and misaligned replies. */
  sim: UserSim | null;
}

export function claudeCodeDriver(o: ClaudeCodeOptions): ClaudeCodeDriver {
  const driver: ClaudeCodeDriver = {
    sim: null,
    env: claudeCodeEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      mkdirSync(o.out, { recursive: true });
      const transcript = join(o.out, "transcript.ndjson");
      const query = o.query ?? ((await import("@anthropic-ai/claude-agent-sdk")).query as unknown as QueryFn);
      const messages: SdkMessage[] = [];
      const inbox = new Inbox();
      inbox.push(userMessage(task.prompt));
      const abort = new AbortController();
      let stop: Termination | null = null;
      let missingQuestion: string | null = null;
      let modelOutput = false;
      let agentTurns = 0;
      let usage: TokenUsage | null = null;
      const end = (t: Termination) => {
        stop ??= t;
        inbox.close();
        abort.abort();
      };
      let deadline = Date.now() + timeoutMs;
      let timer = setTimeout(() => end({ kind: "timeout" }), timeoutMs);
      let pauses = 0;
      let paused = 0;
      const persona = o.freeform;
      const freeform = persona && (async (text: string, question: string) => {
        if (pauses++ === 0) {
          clearTimeout(timer);
          paused = Date.now();
        }
        let a: Awaited<ReturnType<typeof persona>>;
        try {
          a = await persona(text, question);
        } finally {
          if (--pauses === 0) {
            deadline += Date.now() - paused;
            timer = setTimeout(() => end({ kind: "timeout" }), Math.max(0, deadline - Date.now()));
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
        const r = await sim.answerAsk(Array.isArray(input.questions) ? (input.questions as AskQuestion[]) : []);
        if ("missing" in r) {
          missingQuestion = r.missing;
          setTimeout(() => end({ kind: "missing", code: "E_USER_TURNS_MISSING" }), 0);
          return { behavior: "deny", message: "No user is available to answer.", interrupt: true };
        }
        return { behavior: "allow", updatedInput: { ...input, answers: r.answers } };
      };
      const q = query({
        prompt: inbox.stream(),
        options: {
          model: o.model,
          maxTurns: o.maxTurns ?? MAX_TURNS,
          permissionMode: "default",
          settingSources: ["user", "project", "local"],
          disallowedTools: DISALLOWED_TOOLS,
          abortController: abort,
          canUseTool,
          hooks: { PreToolUse: [{ hooks: [async (_input: unknown, toolUseID: string | undefined) => (toolUseID && hooked.add(toolUseID), ROUTE_TO_CAN_USE_TOOL)] }] },
          stderr: (d: string) => appendFileSync(join(o.out, "cli-stderr.log"), d),
          spawnClaudeCodeProcess: (s: { args: string[]; env: Record<string, string | undefined> }) =>
            session.spawn([CLAUDE_BIN, ...s.args], Object.fromEntries(SDK_ENV.flatMap((k) => (s.env[k] ? [[k, s.env[k]!]] : [])))),
        },
      });
      let turnText = "";
      try {
        for await (const m of q) {
          messages.push(m);
          appendFileSync(transcript, JSON.stringify(m) + "\n");
          if (m.type === "system" && m.subtype === "init") {
            writeFileSync(join(o.out, "init.json"), JSON.stringify({ model: m.model, claude_code_version: m.claude_code_version, permissionMode: m.permissionMode, apiKeySource: m.apiKeySource, tools: m.tools, skills: m.skills, cwd: m.cwd }, null, 2) + "\n");
          } else if (m.type === "assistant") {
            const text = (m.message?.content ?? []).filter((b: SdkMessage) => b.type === "text").map((b: SdkMessage) => b.text ?? "").join("");
            if (m.error || m.is_api_error_message) {
              const refusal = refusalIn(text);
              if (refusal) end(refusalTermination(refusal));
              else if (m.error === "authentication_failed") end({ kind: "credentials_rejected" });
              else if (m.error !== "max_output_tokens") end({ kind: "missing", code: "UPSTREAM" });
            } else {
              modelOutput = true;
              if (!m.parent_tool_use_id && text.trim()) turnText = text;
            }
          } else if (m.type === "result") {
            agentTurns += m.num_turns ?? 0;
            usage = tokens(m.usage) ?? usage;
            if (stop) break;
            if (m.subtype !== "success" && m.subtype !== "error_max_turns") {
              end(modelOutput ? { kind: "arm_failure", failure: "harness_crash" } : { kind: "missing", code: "UPSTREAM" });
              break;
            }
            const next = m.subtype === "success" ? await sim.afterTurn(turnText) : { end: "max_turns" };
            turnText = "";
            if ("reply" in next) inbox.push(userMessage(next.reply));
            else {
              inbox.close();
              break;
            }
          }
        }
      } catch (error) {
        if (!stop) {
          appendFileSync(join(o.out, "cli-stderr.log"), "adapter: " + String((error as Error)?.message ?? error) + "\n");
          stop = { kind: "arm_failure", failure: "harness_crash" };
        }
      } finally {
        clearTimeout(timer);
        inbox.close();
        if (!abort.signal.aborted) abort.abort();
      }
      if (unapprovedAsks(messages, approved, hooked).length && (stop as Termination | null)?.kind !== "cap_stop") stop = { kind: "missing", code: "E_APPROVAL_BYPASS" };
      const { turns, calls, outputs } = parseClaudeCode(messages);
      const use = skillUse(calls, o.skill, outputs);
      writeFileSync(join(o.out, "calls.json"), JSON.stringify({ calls, opened: use.opened, files_read: use.files, missing_question: missingQuestion }, null, 2) + "\n");
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

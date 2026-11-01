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
//   session's first model output. The wall-clock limit is a timeout. The CLI's process ending on its own while the agent's
//   session still answers is an arm failure (harness_crash), and so is an error result after model output (before any,
//   it is a missing cell, UPSTREAM). Any other failure is infra, never the arm's: the evaluator's
//   own code (the transcript or init write, the user simulator, the persona), the SDK's link to a CLI that still runs (a
//   reset or a broken pipe), or the machine (a spawn that fails, a session that no longer answers once the CLI ends). An
//   infra failure leaves a missing cell, E_INFRA_FAILURE, and replaces a timeout or an arm failure already recorded.
// - The outcome's model_output says whether the model produced any output: an assistant message that is not an API error,
//   with text, thinking or a tool call. Scorers read it instead of turns, which hold main-agent text only. text_output
//   says whether the main agent wrote any text, apart from the AskUserQuestion questions turns also hold.
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
import type { ChildProcess } from "node:child_process";
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
import { codexConfig, type CodexProvider } from "../codex/driver.ts";
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
  /** Plugin roots in the agent's HOME, loaded for the session as plugin directories. */
  plugins?: string[];
  /** The cell's cross-family voice through the Codex CLI: the provider of the slot's route and the model Codex runs. */
  codex?: { provider: CodexProvider; model: string };
}

// The slice of the Agent SDK this adapter uses, typed loosely so a test can stand one in.
type SdkMessage = Record<string, any>;
type QueryFn = (args: { prompt: AsyncIterable<SdkMessage>; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;

/** The agent env the adapter adds: proxy, bearer, model purity and host settings. Every name is on U9's agent allowlist. */
export function claudeCodeEnv(o: Pick<ClaudeCodeOptions, "model" | "provider" | "proxy" | "codex">): Record<string, string> {
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

/** The termination a proxy refusal ends the cell with. */
export function refusalTermination(refusal: ReasonCode): Termination {
  if (refusal === "CAP_STOP") return { kind: "cap_stop" };
  if (refusal === "E_KEY_REJECTED") return { kind: "credentials_rejected" };
  return { kind: "missing", code: refusal };
}

/** A session that failed for no reason of the arm's: the evaluator, the link to the CLI or the machine. */
const INFRA: Termination = { kind: "missing", code: "E_INFRA_FAILURE" };

/** Whether the agent's session still runs a command; one that does not after the CLI ended means the machine failed. */
const answers = (session: AgentSession): boolean => {
  try {
    return session.exec("true", 30_000).exitCode === 0;
  } catch {
    return false;
  }
};

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
      if (o.codex) {
        const wrote = session.exec(codexConfigCommand(o.codex, o.proxy), 30_000);
        if (wrote.exitCode !== 0) {
          appendFileSync(join(o.out, "cli-stderr.log"), "adapter: the Codex config step exited " + wrote.exitCode + ": " + (wrote.stdout + wrote.stderr).trim().slice(-500) + "\n");
          return { turns: [], termination: { kind: "missing", code: "E_CODEX_CONFIG" }, model_output: false, text_output: false, opened: o.skill ? false : null, files_read: [], asked: [], usage: null, cost_micros: null, agent_turns: null, loaded_bytes: null };
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
      let cli: ChildProcess | null = null;
      let agentTurns = 0;
      let usage: TokenUsage | null = null;
      const end = (t: Termination) => {
        stop ??= t;
        inbox.close();
        abort.abort();
      };
      const infra = (error: unknown) => {
        if (stop?.kind === "timeout" || stop?.kind === "arm_failure") stop = null;
        end(INFRA);
        appendFileSync(join(o.out, "cli-stderr.log"), "adapter: infra failure, not the arm's: " + String((error as Error)?.message ?? error) + "\n");
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
      const q = query({
        prompt: inbox.stream(),
        options: {
          model: o.model,
          maxTurns: o.maxTurns ?? MAX_TURNS,
          permissionMode: "default",
          settingSources: ["user", "project", "local"],
          disallowedTools: DISALLOWED_TOOLS,
          ...(o.plugins?.length ? { plugins: o.plugins.map((path) => ({ type: "local", path })) } : {}),
          abortController: abort,
          canUseTool,
          hooks: { PreToolUse: [{ hooks: [async (_input: unknown, toolUseID: string | undefined) => (toolUseID && hooked.add(toolUseID), ROUTE_TO_CAN_USE_TOOL)] }] },
          stderr: (d: string) => appendFileSync(join(o.out, "cli-stderr.log"), d),
          spawnClaudeCodeProcess: (s: { args: string[]; env: Record<string, string | undefined> }) => {
            try {
              cli = session.spawn([CLAUDE_BIN, ...s.args], Object.fromEntries(SDK_ENV.flatMap((k) => (s.env[k] ? [[k, s.env[k]!]] : []))));
            } catch (error) {
              infra(error);
              throw error;
            }
            cli.on("error", infra);
            return cli;
          },
        },
      });
      let turnText = "";
      try {
        for await (const m of q) {
          try {
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
                if (!m.parent_tool_use_id && text.trim()) {
                  turnText = text;
                  textOutput = true;
                }
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
          } catch (error) {
            infra(error);
            break;
          }
        }
      } catch (error) {
        if (!stop) {
          const child = cli as ChildProcess | null;
          const died = child !== null && (child.exitCode !== null || child.signalCode !== null);
          stop = died && answers(session) ? { kind: "arm_failure", failure: "harness_crash" } : INFRA;
          appendFileSync(join(o.out, "cli-stderr.log"), "adapter: " + (died ? "" : "infra failure, not the arm's: ") + String((error as Error)?.message ?? error) + "\n");
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
        model_output: modelOutput,
        text_output: textOutput,
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

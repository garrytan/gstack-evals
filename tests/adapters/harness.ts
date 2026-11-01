// Keyless harness for the host adapters: an in-process metering proxy (U3) on loopback whose upstream is a scripted fake
// Anthropic Messages API and a scripted fake Responses API, a ledger in memory, and a local agent session that runs the
// Claude Code CLI the Agent SDK bundles, or the Codex CLI from @openai/codex (each the version docker/host-cli.json pins
// in the trial image), with the trial's agent env and its own HOME.
// No key and no network: the proxy's fetch is the fake.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { Provider } from "../../src/runner/pricing/prices.ts";
import type { AgentSession, Sandbox, StepResult } from "../../src/trial/sandbox.ts";
import { trialEnv } from "../../src/trial/env.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

export const REPO = join(import.meta.dir, "..", "..");
export const CLAUDE_CLI = join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk-" + process.platform + "-" + process.arch, "claude");
export const HAS_CLAUDE_CLI = existsSync(CLAUDE_CLI);
export const CODEX_CLI = join(REPO, "node_modules", "@openai", "codex-" + process.platform + "-" + process.arch, "vendor", (process.arch === "arm64" ? "aarch64" : "x86_64") + "-unknown-linux-musl", "bin", "codex");
export const HAS_CODEX_CLI = existsSync(CODEX_CLI);
export const KEYS = { ANTHROPIC_API_KEY: "sk-ant-fake-key-0123456789", OPENAI_API_KEY: "sk-openai-fake-key-0123456789", OPENROUTER_API_KEY: "sk-or-v1-fake-key-0123456789" };
const MANAGEMENT = "management-token-0123456789abcdef";

export class MemoryLedger implements ReservationLedger {
  reservations = new Map<string, Reservation>();
  constructor(public capMicros = 1_000_000_000) {}
  private committed(): number {
    return [...this.reservations.values()].reduce((n, r) => n + (r.state === "settled" ? r.spent_micros! : r.max_micros), 0);
  }
  async reserve(request: { idempotency_key: string; lease_id: string; cell: CellAttempt; max_micros: number }): Promise<LedgerReply> {
    if (this.committed() + request.max_micros > this.capMicros) return { ok: false, code: "CAP_STOP", message: "the lease is spent" };
    const reservation: Reservation = { reservation_id: "res_" + (this.reservations.size + 1), ...request, state: "reserved", spent_micros: null, usage: null };
    this.reservations.set(reservation.reservation_id, reservation);
    return { ok: true, reservation };
  }
  async settle(id: string, outcome: CallOutcome): Promise<LedgerReply> {
    const r = this.reservations.get(id)!;
    Object.assign(r, outcome.kind === "spent" ? { state: "settled", spent_micros: outcome.spent_micros, usage: outcome.usage } : { state: "unknown" });
    return { ok: true, reservation: r };
  }
}

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "thinking"; thinking: string; signature?: string } | { type: "redacted_thinking"; data: string };

export interface Turn {
  /** Tool results so far, by tool_use id. */
  results: Map<string, { text: string; error: boolean }>;
  /** Plain user texts so far: the prompt, then each simulated reply. */
  users: string[];
  body: Record<string, any>;
}

/** A scripted model: the blocks of the next answer, given what the conversation holds. */
export type Script = (turn: Turn) => Block[];

export interface Upstream {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

function parse(messages: any[]): Pick<Turn, "results" | "users"> {
  const results = new Map<string, { text: string; error: boolean }>();
  const users: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") users.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type === "tool_result") results.set(b.tool_use_id, { text: Array.isArray(b.content) ? b.content.map((x: any) => x.text ?? "").join("") : String(b.content ?? ""), error: b.is_error === true });
      }
      const text = m.content.filter((b: any) => b.type === "text" && !String(b.text).startsWith("<system-reminder>")).map((b: any) => b.text).join("");
      if (text && !m.content.some((b: any) => b.type === "tool_result")) users.push(text);
    }
  }
  return { results, users };
}

/** One item of a scripted Responses answer: an assistant message, or a shell call Codex runs as exec_command. */
export type Item = { type: "message"; text: string } | { type: "shell"; id: string; cmd: string };

export interface ResponsesTurn {
  /** Tool outputs so far, by call id. */
  outputs: Map<string, string>;
  body: Record<string, any>;
}

/** A scripted Responses model: the items of the next answer, given what the conversation holds. */
export type ResponsesScript = (turn: ResponsesTurn) => Item[];

const RESPONSES_USAGE = { input_tokens: 2100, input_tokens_details: { cached_tokens: 2000 }, output_tokens: 50, output_tokens_details: { reasoning_tokens: 10 }, total_tokens: 2150 };

/** One Responses answer, streamed or not, with usage the proxy settles from. */
export function responsesResponse(body: Record<string, any>, items: Item[]): Response {
  const id = "resp_fake_" + Math.random().toString(36).slice(2);
  const output = items.map((it, i) =>
    it.type === "message"
      ? { type: "message", id: "msg_" + i, role: "assistant", status: "completed", content: [{ type: "output_text", text: it.text, annotations: [] }] }
      : { type: "function_call", id: "fc_" + i, call_id: it.id, name: "exec_command", arguments: JSON.stringify({ cmd: it.cmd }), status: "completed" },
  );
  if (!body.stream) return Response.json({ id, object: "response", model: body.model, status: "completed", output, usage: RESPONSES_USAGE });
  const events: [string, unknown][] = [["response.created", { type: "response.created", response: { id, object: "response", model: body.model, status: "in_progress", output: [] } }]];
  output.forEach((item, output_index) => {
    events.push(["response.output_item.added", { type: "response.output_item.added", output_index, item }]);
    events.push(["response.output_item.done", { type: "response.output_item.done", output_index, item }]);
  });
  events.push(["response.completed", { type: "response.completed", response: { id, object: "response", model: body.model, status: "completed", output, usage: RESPONSES_USAGE } }]);
  return new Response(events.map(([n, e]) => "event: " + n + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}

function parseResponses(body: Record<string, any>): ResponsesTurn {
  const outputs = new Map<string, string>();
  for (const it of body.input ?? []) if (it.type === "function_call_output") outputs.set(it.call_id, typeof it.output === "string" ? it.output : JSON.stringify(it.output));
  return { outputs, body };
}

const USAGE = { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500 };

/** One Anthropic Messages answer, streamed or not, with usage the proxy settles from. */
export function messagesResponse(body: Record<string, any>, blocks: Block[], stopReason?: string): Response {
  const stop = stopReason ?? (blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
  const msg = { id: "msg_fake_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: body.model, content: [] as unknown[], stop_reason: null as string | null, stop_sequence: null, usage: USAGE };
  if (!body.stream) return Response.json({ ...msg, content: blocks, stop_reason: stop, usage: { ...USAGE, output_tokens: 50 } });
  const events: [string, unknown][] = [["message_start", { type: "message_start", message: msg }]];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }]);
    } else if (b.type === "thinking") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } }]);
      if (b.thinking) events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: b.thinking } }]);
      if (b.signature) events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature } }]);
    } else if (b.type === "redacted_thinking") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: b }]);
    } else {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 50 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return new Response(events.map(([n, e]) => "event: " + n + "\ndata: " + JSON.stringify(e) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}

export interface Harness {
  dir: string;
  proxy: MeteringProxy;
  ledger: MemoryLedger;
  upstream: Upstream[];
  baseUrl: string;
  bind(model: string, provider?: Provider): { slot: string; token: string; meter_id: string };
  /** A local agent session: the CLI runs as this user, in work, with the trial's agent env and its own HOME. */
  session(work: string, home: string, driverEnv: Record<string, string>): AgentSession;
  /** SIGKILL every CLI process the sessions spawned: a host crash mid-run. */
  crash(): void;
  close(): void;
}

/** A local sandbox for the run loop's test rig: no isolation, HOME under the trial dir, install(home) puts the arm in it before the agent starts. */
export function localSandbox(install: (home: string) => void): Sandbox {
  return {
    isolation: "process",
    workPath: (work) => work,
    fixturesPath: (fixtures) => fixtures,
    homePath: (dir) => join(dir, "home"),
    step(_role, command, _task, o) {
      const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: o.timeoutMs, encoding: "utf8" });
      return { exitCode: r.status ?? 1, timedOut: r.error?.message.includes("ETIMEDOUT") ?? false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    agent(_task, o) {
      mkdirSync(o.env.HOME!, { recursive: true });
      install(o.env.HOME!);
      return {
        exec: (command, timeoutMs) => {
          const r = spawnSync("sh", ["-c", command], { cwd: o.work, env: o.env, timeout: timeoutMs, encoding: "utf8" });
          return { exitCode: r.status ?? 1, timedOut: false, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
        },
        spawn: (argv, extra = {}) => spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0] === "codex" ? CODEX_CLI : argv[0]!, argv.slice(1), { cwd: o.work, env: { ...o.env, PATH: process.env.PATH ?? o.env.PATH!, ...extra }, stdio: ["pipe", "pipe", "pipe"] }),
        stop() {},
      };
    },
  };
}

/**
 * The main agent's requests carry Claude Code's tools; side requests (titles, summaries) carry none and get a plain text
 * answer, so the script only sees the session's own turns.
 */
export function harness(script: Script, opts: { capMicros?: number; env?: Record<string, string>; responses?: ResponsesScript; stop?: (turn: Turn) => string | undefined } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "gse-adapter-"));
  const children: ChildProcess[] = [];
  const ledger = new MemoryLedger(opts.capMicros);
  const upstream: Upstream[] = [];
  const proxy = new MeteringProxy({
    ledger, leaseId: "lease-test", host: "127.0.0.1", managementSocket: join(dir, "management.sock"), managementToken: MANAGEMENT,
    journal: join(dir, "journal.ndjson"), retry: { attempts: 1, elapsed_ms: 10_000 }, env: opts.env ?? KEYS,
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      upstream.push({ url, headers: new Headers(init.headers), body });
      if (new URL(url).pathname.endsWith("/v1/responses")) return responsesResponse(body, opts.responses ? opts.responses(parseResponses(body)) : [{ type: "message", text: "ok" }]);
      if (!new URL(url).pathname.endsWith("/v1/messages")) return Response.json({ data: [] });
      const tools = new Set((body.tools ?? []).map((t: { name: string }) => t.name));
      const turn = { ...parse(body.messages ?? []), body };
      return tools.has("Bash") ? messagesResponse(body, script(turn), opts.stop?.(turn)) : messagesResponse(body, [{ type: "text", text: "ok" }]);
    },
  });
  proxy.start();
  return {
    dir, proxy, ledger, upstream,
    baseUrl: "http://127.0.0.1:" + proxy.port,
    bind: (model, provider = "anthropic") => proxy.bind({ cell: { run_id: "run-test", arm: "after", task: "t", model, trial: 0, attempt: 1 }, models: [provider + ":" + model], allowance_micros: 50_000_000 }),
    session(work, home, driverEnv) {
      mkdirSync(work, { recursive: true });
      mkdirSync(home, { recursive: true });
      const env = trialEnv("agent", { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, LANG: "C.UTF-8", TERM: "dumb", ...driverEnv }, [], {});
      return {
        exec: (): StepResult => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
        spawn(argv, extra = {}) {
          const child = spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0] === "codex" ? CODEX_CLI : argv[0]!, argv.slice(1), { cwd: work, env: { ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
          children.push(child);
          return child;
        },
        stop() {},
      };
    },
    crash() {
      for (const child of children) child.kill("SIGKILL");
    },
    close() {
      proxy.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

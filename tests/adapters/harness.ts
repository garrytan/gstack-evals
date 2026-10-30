// Keyless harness for the host adapters: an in-process metering proxy (U3) on loopback whose upstream is a scripted fake
// Anthropic Messages API, a ledger in memory, and a local agent session that runs the Claude Code CLI the Agent SDK
// bundles (the same version docker/host-cli.json pins in the trial image) with the trial's agent env and its own HOME.
// No key and no network: the proxy's fetch is the fake.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeteringProxy } from "../../src/runner/proxy/metering-proxy.ts";
import type { AgentSession, StepResult } from "../../src/trial/sandbox.ts";
import { trialEnv } from "../../src/trial/env.ts";
import type { CallOutcome, CellAttempt, LedgerReply, Reservation, ReservationLedger } from "../../src/types.ts";

export const REPO = join(import.meta.dir, "..", "..");
export const CLAUDE_CLI = join(REPO, "node_modules", "@anthropic-ai", "claude-agent-sdk-" + process.platform + "-" + process.arch, "claude");
export const HAS_CLAUDE_CLI = existsSync(CLAUDE_CLI);
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

export type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

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

const USAGE = { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500 };

/** One Anthropic Messages answer, streamed or not, with usage the proxy settles from. */
export function messagesResponse(body: Record<string, any>, blocks: Block[]): Response {
  const stop = blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
  const msg = { id: "msg_fake_" + Math.random().toString(36).slice(2), type: "message", role: "assistant", model: body.model, content: [] as unknown[], stop_reason: null as string | null, stop_sequence: null, usage: USAGE };
  if (!body.stream) return Response.json({ ...msg, content: blocks, stop_reason: stop, usage: { ...USAGE, output_tokens: 50 } });
  const events: [string, unknown][] = [["message_start", { type: "message_start", message: msg }]];
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }]);
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
  bind(model: string, provider?: "anthropic" | "openrouter"): { slot: string; token: string; meter_id: string };
  /** A local agent session: the CLI runs as this user, in work, with the trial's agent env and its own HOME. */
  session(work: string, home: string, driverEnv: Record<string, string>): AgentSession;
  /** SIGKILL every CLI process the sessions spawned: a host crash mid-run. */
  crash(): void;
  close(): void;
}

/**
 * The main agent's requests carry Claude Code's tools; side requests (titles, summaries) carry none and get a plain text
 * answer, so the script only sees the session's own turns.
 */
export function harness(script: Script, opts: { capMicros?: number; env?: Record<string, string> } = {}): Harness {
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
      if (!new URL(url).pathname.endsWith("/v1/messages")) return Response.json({ data: [] });
      const tools = new Set((body.tools ?? []).map((t: { name: string }) => t.name));
      const blocks = tools.has("Bash") ? script({ ...parse(body.messages ?? []), body }) : [{ type: "text" as const, text: "ok" }];
      return messagesResponse(body, blocks);
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
          const child = spawn(argv[0] === "claude" ? CLAUDE_CLI : argv[0]!, argv.slice(1), { cwd: work, env: { ...env, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
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

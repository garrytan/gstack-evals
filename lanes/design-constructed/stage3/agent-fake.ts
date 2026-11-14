// Copyright (c) 2026 Garry Tan. MIT License.
// A keyless rig for the in-VM agents (stage3/agent.ts), for the dry run and tests: a fake VM backend that keeps the
// files the controller writes, a local agent session that runs the stand-in CLI (stub-claude.cjs) under the env file
// the controller wrote, and VM sessions on a local stand-in for the item's metering proxy whose replies are scripted.
// The real Agent SDK and the real adapter run between them; nothing leaves the loopback.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { CLAUDE_BIN } from "../../../src/adapters/claude-code/driver.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import type { VmAgentDeps, VmSessions } from "./agent.ts";
import type { Vm, VmBackend, VmSpec } from "./sandbox.ts";

export const STUB_CLAUDE = join(import.meta.dir, "stub-claude.cjs");

export interface AgentRig {
  deps: VmAgentDeps;
  vm: Vm;
  /** Files the controller wrote in the VM, by path, as text. */
  files: Map<string, string>;
  /** Commands the controller ran in the VM, with their user. */
  execs: Array<{ command: string; user: string }>;
  /** What reached the stand-in proxy: the path, the bearer and the model. */
  upstream: Array<{ path: string; auth: string; model: string }>;
  /** The env each spawned CLI saw, from the env file. */
  spawned: Array<Record<string, string>>;
  ended: string[];
  close(): void;
}

/** The env file's exports, as the run user's shell would read them; the PATH line, which extends $PATH, is left out. */
export function envOfFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^export ([A-Z_][A-Z0-9_]*)='((?:[^']|'\\'')*)'$/gm)) out[m[1]!] = m[2]!.replaceAll("'\\''", "'");
  return out;
}

/** A local agent session that runs the stand-in CLI under an env file's exports, in place of the CLI over SSH. */
export function stubSession(envText: string, home: string, spawned: Array<Record<string, string>> = []): AgentSession {
  const env = envOfFile(envText);
  const base = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, ...env };
  return {
    exec: () => ({ exitCode: 0, timedOut: false, stdout: "", stderr: "" }),
    spawn(argv, extra = {}) {
      const [bin, ...args] = argv;
      if (bin === CLAUDE_BIN) {
        spawned.push(env);
        return spawn(process.execPath, [STUB_CLAUDE, ...args], { env: { ...base, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
      }
      return spawn(bin!, args, { env: { ...base, ...extra }, stdio: ["pipe", "pipe", "pipe"] });
    },
    stop() {},
  };
}

export function agentRig(o: { reply: () => string; out: string; spentMicros?: number; unknownMicros?: number; spec?: Partial<VmSpec> }): AgentRig {
  const files = new Map<string, string>();
  const execs: AgentRig["execs"] = [];
  const upstream: AgentRig["upstream"] = [];
  const spawned: AgentRig["spawned"] = [];
  const ended: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string };
      upstream.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization") ?? "", model: body.model });
      return Response.json({ id: "m1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: o.reply() }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    },
  });
  const backend: VmBackend = {
    create: async () => {
      throw new Error("the rig makes no VM");
    },
    exec: async (_vm, command, eo) => (execs.push({ command, user: eo?.user ?? "run" }), { exit: 0, stdout: "", stderr: "" }),
    write: async (_vm, path, data) => void files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data)),
    read: async (_vm, path) => new TextEncoder().encode(files.get(path) ?? ""),
    destroy: async () => {},
  };
  const sessions: VmSessions = {
    bind: async (sub, session) => ({ item: sub.item, sub: sub.id, session, baseUrl: "http://127.0.0.1:" + server.port, slot: "slot1", token: "run-token-1", model: "opus" }),
    end: async (b) => (ended.push(b.session), { spentMicros: o.spentMicros ?? 0, unknownMicros: o.unknownMicros ?? 0 }),
  };
  const session = (_vm: Vm, envFile: string): AgentSession => stubSession(files.get(envFile) ?? "", o.out, spawned);
  const vm = { id: "vm-rig", spec: { label: "recipe session c001", runUser: "run", ...o.spec } } as unknown as Vm;
  return { deps: { backend, sessions, session, out: o.out }, vm, files, execs, upstream, spawned, ended, close: () => void server.stop(true) };
}

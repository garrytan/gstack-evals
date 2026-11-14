// Copyright (c) 2026 Garry Tan. MIT License.
// The in-VM agent sessions (WIRING item 15): Opus 5.5 in Claude Code inside a recipe VM or a build VM. The SDK, the
// adapter and every record stay on the controller (src/adapters/claude-code/driver.ts, as the review sessions run it);
// only the CLI runs in the VM, started over SSH as the run user in /work, so no key enters the VM. The session's model
// calls reach the controller host's metering proxy through the VM proxy endpoint, on a slot bound to the session's own
// admitted sub-reservation (VmSessions), with the slot's bearer in an env file the controller writes under /run and
// removes after the session. The adapter's termination is read as the run area reads a review session's (endOf): a
// completed reply, the session's own limit (turns, time, its allowance, its context, or a malformed tool call with no
// error), a failure outside the agent, or a cap stop, which throws CapStopSignal for the item.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { claudeCodeDriver, type ClaudeCodeOptions } from "../../../src/adapters/claude-code/driver.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import { DcError, fail } from "../errors.ts";
import type { MoneyController } from "../money/book.ts";
import { DIRECT_MODELS } from "../money/price.ts";
import type { SessionBinding, SessionProxies } from "../paid/sessions.ts";
import { endOf } from "../run/session.ts";
import type { LedgerItemId, Model } from "../types.ts";
import { AGENT_ROOT } from "./install.ts";
import { KEY_NAMES, type Vm, type VmBackend } from "./sandbox.ts";
import type { VmFront } from "./front.ts";
import { CapStopSignal, type AgentRun, type SubRef } from "./seams.ts";
import { asUser, sshArgs, type SshOptions } from "./ubicloud-real.ts";

/** One session's slot on its item's metering proxy, as the VM reaches it. */
export interface VmBinding {
  item: LedgerItemId;
  sub: string;
  session: string;
  /** The VM proxy endpoint's base URL, before the slot. */
  baseUrl: string;
  slot: string;
  /** The slot's bearer; it reaches the VM only in the env file. */
  token: string;
  model: Model;
}

/** The session provider for VM agents: a slot per session on the sub-reservation's item proxy, and its spend at the end. */
export interface VmSessions {
  bind(sub: SubRef, session: string): Promise<VmBinding>;
  end(b: VmBinding): Promise<{ spentMicros: number; unknownMicros: number }>;
}

/**
 * VmSessions on paid's session proxies: each session item's metering proxy on the controller host, each session's slot
 * routed through the VM proxy endpoint, and a drift scan of the bound items' journals every scanMs (PD-9). A bind names
 * the admitted sub-reservation; the model and the allowance come from it and its item.
 */
export function proxySessions(o: { controller: MoneyController; proxies: SessionProxies; front: VmFront; scanMs: number }): VmSessions & { close(): Promise<void> } {
  const bound = new Map<string, SessionBinding>();
  const items = new Set<LedgerItemId>();
  let scanError: unknown = null;
  const timer = setInterval(async () => {
    for (const item of items)
      await o.proxies.scan(item).catch((e) => {
        scanError ??= e;
      });
  }, o.scanMs);
  timer.unref();
  return {
    async bind(ref, session): Promise<VmBinding> {
      if (scanError) throw scanError;
      const sub = o.controller.sub(ref.id) ?? fail("E_INTERNAL", session + " names sub-reservation " + ref.id + ", which the controller doesn't hold");
      if (sub.item !== ref.item) fail("E_INTERNAL", session + ": sub-reservation " + ref.id + " is on " + sub.item + ", not " + ref.item);
      const b = await o.proxies.bind(ref.item, { sub, session, attempt: 1 });
      const model = sub.model as Model;
      const tail = "/" + b.slot + "/" + DIRECT_MODELS[model].provider;
      if (!b.baseUrl.endsWith(tail)) fail("E_INTERNAL", session + ": the proxy's slot URL has an unexpected shape");
      o.front.route(b.slot, b.baseUrl.slice(0, -tail.length));
      bound.set(b.slot, b);
      items.add(ref.item);
      return { item: ref.item, sub: ref.id, session, baseUrl: o.front.url, slot: b.slot, token: b.token, model };
    },
    async end(v) {
      o.front.unroute(v.slot);
      const b = bound.get(v.slot) ?? fail("E_INTERNAL", v.session + "'s slot was never bound");
      bound.delete(v.slot);
      return o.proxies.end(b);
    },
    async close() {
      clearInterval(timer);
      await o.proxies.stopAll();
    },
  };
}

export interface VmAgentDeps {
  backend: VmBackend;
  sessions: VmSessions;
  /** The agent session for a VM: the CLI over SSH as the run user, with the env file sourced, in the work folder. */
  session: (vm: Vm, envFile: string) => AgentSession;
  /** Where each session's adapter records go on the controller. */
  out: string;
  /** The Agent SDK's query function; the pinned SDK when unset. */
  query?: ClaudeCodeOptions["query"];
  /** The env file's folder in the VM. */
  envDir?: string;
}

/** BT: the env file's folder in the VM; /run is outside the audit's file list and gone at the VM's deletion. */
export const AGENT_ENV_DIR = "/run/dc-agent";
/** BT: the agent's working folder: the recipe's /work/app or the build's /work/repo and plan.md sit inside it. */
export const AGENT_WORK = "/work";

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** The env file's text: one export per name, then the Claude Code binary's folder first on PATH. */
export function envFileText(env: Readonly<Record<string, string>>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_NAME.test(k)) throw new DcError("E_USAGE", "agent env name " + JSON.stringify(k) + " is not a plain name");
    if (KEY_NAMES.includes(k)) throw new DcError("E_USAGE", "the agent env carries the key name " + k);
    lines.push("export " + k + "=" + q(v));
  }
  lines.push("export PATH=" + q(AGENT_ROOT + "/package") + ':"$PATH"');
  return lines.join("\n") + "\n";
}

/** The agent session over SSH: each step and the CLI run as the run user, source the env file and start in the work folder. */
export function sshAgentSession(o: SshOptions & { wrap?: (command: string, user: "root" | "run") => string }, host: string, envFile: string, workDir = AGENT_WORK): AgentSession {
  const wrap = o.wrap ?? ((c: string, u: "root" | "run") => asUser(c, u, o.runUser));
  const remote = (command: string) => wrap(". " + q(envFile) + " && cd " + q(workDir) + " && " + command, "run");
  return {
    exec(command, timeoutMs) {
      const argv = sshArgs(o, host, [remote(command)]);
      const r = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
      const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
      return { exitCode: timedOut ? null : r.status, timedOut, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    spawn(argv, env = {}) {
      for (const k of Object.keys(env)) if (!ENV_NAME.test(k)) throw new DcError("E_USAGE", "spawn env name " + JSON.stringify(k) + " is not a plain name");
      const pairs = Object.entries(env).map(([k, v]) => q(k + "=" + v));
      const line = sshArgs(o, host, [remote("exec " + (pairs.length ? "env " + pairs.join(" ") + " " : "") + argv.map(q).join(" "))]);
      return spawn(line[0]!, line.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    },
    stop() {},
  };
}

/**
 * One agent session in a VM: bind a slot on the sub-reservation's item, write the env file, run the adapter with the
 * session's frozen limits (turns as max turns, minutes as the timeout, the slot's allowance as its own stop), then end
 * the slot, stop any CLI still running and remove the env file. Spend is the proxy's figure, null when any is unknown.
 */
export async function runVmAgent(d: VmAgentDeps, vm: Vm, o: { prompt: string; limits: { turns: number; minutes: number }; sub: SubRef; env?: Readonly<Record<string, string>> }): Promise<AgentRun> {
  const label = vm.spec.label;
  const b = await d.sessions.bind(o.sub, label);
  const dir = d.envDir ?? AGENT_ENV_DIR;
  const envFile = dir + "/env";
  const run = vm.spec.runUser;
  let outcome: Awaited<ReturnType<ReturnType<typeof claudeCodeDriver>["run"]>> | null = null;
  let figures: { spentMicros: number; unknownMicros: number } | null = null;
  try {
    const m = DIRECT_MODELS[b.model];
    const driver = claudeCodeDriver({ model: m.id, provider: m.provider === "anthropic" ? "anthropic" : "openrouter", proxy: { baseUrl: b.baseUrl, slot: b.slot, token: b.token }, skill: null, out: join(d.out, safe(label)), maxTurns: o.limits.turns, capStops: true, ...(d.query ? { query: d.query } : {}) });
    const made = await d.backend.exec(vm, "mkdir -p " + q(dir) + " && chmod 0750 " + q(dir) + " && chgrp " + q(run) + " " + q(dir), { user: "root" });
    if (made.exit !== 0) throw new DcError("E_DC_INFRA_MISSING", label + ": could not make the agent's env folder (exit " + made.exit + ")");
    await d.backend.write(vm, envFile, envFileText({ ...driver.env!, ...(o.env ?? {}) }));
    const locked = await d.backend.exec(vm, "chgrp " + q(run) + " " + q(envFile) + " && chmod 0640 " + q(envFile), { user: "root" });
    if (locked.exit !== 0) throw new DcError("E_DC_INFRA_MISSING", label + ": could not lock the agent's env file (exit " + locked.exit + ")");
    outcome = await driver.run(d.session(vm, envFile), { id: label, prompt: o.prompt }, o.limits.minutes * 60_000);
  } finally {
    figures = await d.sessions.end(b);
    await d.backend.exec(vm, "pkill -KILL -u " + q(run) + " -x claude; rm -f " + q(envFile) + "; true", { user: "root" }).catch(() => undefined);
  }
  const spentUsd = figures.unknownMicros > 0 ? null : figures.spentMicros / 1e6;
  const end = endOf(outcome!.termination);
  if (end.kind === "cap-stop") throw new CapStopSignal(o.sub.item, label + ": the proxy refused a call on the item's cap");
  const kind = end.kind === "completed" ? "completed" : end.kind === "own-limit" ? "own-limit" : "infra";
  return { end: kind, spentUsd, ...(kind === "infra" ? { why: "the session ended with " + outcome!.termination.kind } : {}) };
}

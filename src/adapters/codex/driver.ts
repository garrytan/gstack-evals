// The Codex host adapter (interface v0.5, "Hosts"): an AgentDriver (src/trial/trial.ts) that runs `codex exec --json`
// inside the trial's agent session (a docker exec into the arm container, or bubblewrap) and reads its JSONL events on
// the evaluator side. Codex runs non-interactive tasks only in v1: a task declared interactive ends as a missing cell,
// E_INTERACTIVE_HOST, before anything starts, as preflight already refuses it.
//
// - The model reaches the metering proxy only, through a model provider the command line defines: its base URL names
//   the session's slot for the cell's provider (openai, or openrouter through OpenRouter's Responses route), it speaks
//   the Responses API, and it reads the slot's per-session bearer from OPENAI_API_KEY. Retries are off
//   (request_max_retries and stream_max_retries 0): the proxy retries, and journals and charges every paid attempt.
// - Codex's bundled system skills are off (skills.bundled.enabled=false), as Claude Code's are in every arm, and so are
//   web search, the update check and analytics. Approvals and Codex's own sandbox are bypassed: the trial's container is
//   the sandbox, and nobody is there to approve. Every setting passes --strict-config, so a renamed key fails loudly.
// - The prompt goes in on stdin. The adapter writes the evaluator's records beside the trial, never into the work dir:
//   every event (transcript.ndjson), the command line's settings (init.json), calls[] (calls.json) and the CLI's
//   stderr (cli-stderr.log).
// - A turn that completes is a completed session. A failed turn or an error naming a proxy refusal maps as on Claude
//   Code (CAP_STOP a cap stop, E_KEY_REJECTED rejected credentials, the rest a missing cell); any other failed turn is
//   a provider failure and a missing cell, UPSTREAM. A CLI that exits without a turn result, or is killed, is an arm
//   failure (harness_crash); the wall-clock limit is a timeout.
// - Codex answers a request_user_input call itself in exec mode ("unavailable in Default mode") and reports nothing on
//   its event stream, so a question a non-interactive session asks reaches no simulator and is not recorded.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ContractTask } from "../../skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../trial/trial.ts";
import type { Termination, TokenUsage } from "../../types.ts";
import { parseCodex, skillUse, type SkillRef } from "../../grade/transcript.ts";
import { refusalIn, refusalTermination } from "../claude-code/driver.ts";

export type CodexProvider = "openai" | "openrouter";

/** The Codex CLI's name inside the agent's environment; the trial image installs it at the pinned version. */
export const CODEX_BIN = "codex";

/** The model provider id the command line defines for the proxy. */
export const PROVIDER_ID = "gstack_evals_proxy";

export interface CodexOptions {
  model: string;
  provider: CodexProvider;
  /** The proxy's trial base URL as agents reach it, the slot and its per-session bearer. */
  proxy: { baseUrl: string; slot: string; token: string };
  /** The task's declared interactivity. */
  interactive: boolean;
  /** The arm's skill, for calls[] and the opened signal; null for an arm with no skill (none, bare). */
  skill: (SkillRef & { dir: string | null }) | null;
  /** The trial's evaluator-side directory for the adapter's records. */
  out: string;
}

/** The agent env the adapter adds: the slot's bearer, by the name the provider definition reads. */
export function codexEnv(o: Pick<CodexOptions, "proxy">): Record<string, string> {
  return { OPENAI_API_KEY: o.proxy.token };
}

/** Every setting the adapter passes, as -c key=value pairs whose values are TOML. */
export function codexConfig(o: Pick<CodexOptions, "provider" | "proxy">): Record<string, string | number | boolean> {
  const p = "model_providers." + PROVIDER_ID + ".";
  return {
    model_provider: PROVIDER_ID,
    [p + "name"]: "gstack-evals metering proxy",
    [p + "base_url"]: o.proxy.baseUrl.replace(/\/+$/, "") + "/" + o.proxy.slot + "/" + o.provider + "/v1",
    [p + "wire_api"]: "responses",
    [p + "env_key"]: "OPENAI_API_KEY",
    [p + "request_max_retries"]: 0,
    [p + "stream_max_retries"]: 0,
    "skills.bundled.enabled": false,
    web_search: "disabled",
    check_for_update_on_startup: false,
    "analytics.enabled": false,
  };
}

/** The argv after the CLI's name; the prompt follows on stdin. */
export function codexArgs(o: Pick<CodexOptions, "model" | "provider" | "proxy">): string[] {
  const settings = Object.entries(codexConfig(o)).flatMap(([k, v]) => ["-c", k + "=" + JSON.stringify(v)]);
  return ["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--ephemeral", "--color", "never", "-m", o.model, ...settings, "-"];
}

type CodexEvent = { type?: string; message?: string; error?: { message?: string }; usage?: Record<string, number> };

/** Codex's input_tokens include its cached input and its output_tokens include reasoning; TokenUsage keeps each class apart. */
const tokens = (u: Record<string, number>): TokenUsage => ({ input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0) - (u.cache_write_input_tokens ?? 0)), output: Math.max(0, (u.output_tokens ?? 0) - (u.reasoning_output_tokens ?? 0)), reasoning: u.reasoning_output_tokens ?? 0, cache_read: u.cached_input_tokens ?? 0, cache_write: u.cache_write_input_tokens ?? 0 });

export interface CodexDriver extends AgentDriver {
  env: Record<string, string>;
}

export function codexDriver(o: CodexOptions): CodexDriver {
  return {
    env: codexEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      mkdirSync(o.out, { recursive: true });
      const outcome = (termination: Termination, turns: string[] = [], usage: TokenUsage | null = null, files: string[] = [], opened = false): AgentOutcome => ({
        turns, termination, opened: o.skill ? opened : null, files_read: files, asked: [], usage, cost_micros: null, agent_turns: null,
        loaded_bytes: o.skill?.dir ? files.reduce((s, f) => s + size(f), 0) : null,
      });
      const size = (f: string) => {
        try {
          return o.skill?.dir ? statSync(join(o.skill.dir, f)).size : 0;
        } catch {
          return 0;
        }
      };
      if (o.interactive) return outcome({ kind: "missing", code: "E_INTERACTIVE_HOST" });
      const argv = codexArgs(o);
      writeFileSync(join(o.out, "init.json"), JSON.stringify({ model: o.model, provider: o.provider, argv: [CODEX_BIN, ...argv] }, null, 2) + "\n");
      const events: unknown[] = [];
      let completed = false;
      let failed: string | null = null;
      let lastError: string | null = null;
      let usage: TokenUsage | null = null;
      let timedOut = false;
      const child = session.spawn([CODEX_BIN, ...argv], {});
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stderr?.on("data", (d: Buffer) => appendFileSync(join(o.out, "cli-stderr.log"), d));
      child.stdin?.on("error", () => {});
      child.stdin?.end(task.prompt);
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
      const spawnError = new Promise<Error>((resolve) => child.on("error", resolve));
      if (child.stdout) {
        for await (const line of createInterface({ input: child.stdout })) {
          if (!line.trim()) continue;
          appendFileSync(join(o.out, "transcript.ndjson"), line + "\n");
          let ev: CodexEvent;
          try {
            ev = JSON.parse(line) as CodexEvent;
          } catch {
            continue;
          }
          events.push(ev);
          if (ev.type === "turn.completed") {
            completed = true;
            if (ev.usage) usage = tokens(ev.usage);
          } else if (ev.type === "turn.failed") failed = ev.error?.message ?? "turn failed";
          else if (ev.type === "error") lastError = ev.message ?? "error";
        }
      }
      const exit = await Promise.race([closed, spawnError.then((err) => ({ code: null, signal: null, err }))]);
      clearTimeout(timer);
      if ("err" in exit) appendFileSync(join(o.out, "cli-stderr.log"), "adapter: " + String(exit.err.message) + "\n");
      const { turns, calls, outputs } = parseCodex(events);
      const use = skillUse(calls, o.skill, outputs);
      writeFileSync(join(o.out, "calls.json"), JSON.stringify({ calls, opened: use.opened, files_read: use.files }, null, 2) + "\n");
      const exited = !("err" in exit) && exit.signal === null;
      const refusal = refusalIn(failed ?? lastError ?? "");
      const termination: Termination = timedOut
        ? { kind: "timeout" }
        : completed && !failed && exited && exit.code === 0
          ? { kind: "completed" }
          : refusal && exited
            ? refusalTermination(refusal)
            : failed && exited
              ? { kind: "missing", code: "UPSTREAM" }
              : { kind: "arm_failure", failure: "harness_crash" };
      return outcome(termination, turns, usage, use.files, use.opened);
    },
  };
}

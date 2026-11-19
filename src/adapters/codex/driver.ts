// The Codex host adapter (interface v0.5, "Interactive tasks" and "Hosts"): an AgentDriver (src/trial/trial.ts) that runs
// `codex exec --json` inside the trial's agent session (a docker exec into the arm container, or bubblewrap) and reads
// its JSONL events on the evaluator side. The user simulator, the persona and the sidecar stay on the evaluator side.
//
// - The model reaches the metering proxy only, through a model provider the command line defines: its base URL names
//   the session's slot for the cell's provider (openai, or openrouter through OpenRouter's Responses route), it speaks
//   the Responses API, and it reads the slot's per-session bearer from OPENAI_API_KEY. Retries are off
//   (request_max_retries and stream_max_retries 0): the proxy retries, and journals and charges every paid attempt.
// - Codex's bundled system skills are off (skills.bundled.enabled=false), as Claude Code's are in every arm, and so are
//   web search, the update check and analytics. Approvals and Codex's own sandbox are bypassed: the trial's container is
//   the sandbox, and nobody is there to approve. Every setting passes --strict-config, so a renamed key fails loudly.
// - The reasoning effort is the caller's, never Codex's default: effort is written as model_reasoning_effort and
//   recorded in init.json. A null effort writes none; Codex sends no effort for a model its catalog lacks, and null keeps
//   that. CATALOG_EFFORT holds the defaults the pinned CLI's catalog gives, for callers that keep them. settings adds
//   more -c pairs after the adapter's own, and may not replace one of them.
// - sessionKind unattended or interactive adds GSTACK_SESSION_KIND with that value to the agent env; unset, the adapter
//   sets no session kind. The trial's seeded gstack state root (GSTACK_STATE_ROOT and GSTACK_HOME) comes in the
//   session's env, as on Claude Code, and Codex passes both to the model's shell commands.
// - Questions. In exec's Default mode Codex 0.166.0 answers request_user_input itself ("only available in Plan mode")
//   and offers request_user_input_async (ASYNC_QUESTION), which answers {"accepted":true} at once and takes any reply
//   as the next user message. Under Code Mode (gpt-6 models) 0.166.0 and 0.170.0 offer it beside exec, never inside
//   exec's JavaScript, so every question is a direct function_call in the rollout. After each turn the adapter reads
//   the session's rollout (CODEX_HOME/sessions, which is why sessions are not --ephemeral) for the turn's ASYNC_QUESTION
//   calls. Their questions go to the user simulator
//   (src/usersim/sim.ts) as an AskUserQuestion's do on Claude Code: the task's scripted replies, then the persona's
//   free-form source; a turn with none goes to the simulator's afterTurn on its last agent message, as on Claude Code.
//   A tool question in a task that declared no user replies gets no answer, and the session ends and is graded as before
//   (the eval owner's ruling 1B; Claude Code makes that case a missing cell, E_USER_TURNS_MISSING, so the count below is
//   the host difference). nextUser replaces the simulator: after each completed turn it gets the turn's agent messages
//   and returns the next user message, an end, or a termination; the turn's tool questions are still recorded. A reply
//   goes back as the next user message by codex exec resume <thread>, and the session ends at the first turn with
//   nothing to answer. Every tool question lands in the outcome's asked and in questions.json with the answer that went
//   back; a call whose turn sent no answer is marked unanswered there, and the outcome's unanswered counts its questions.
// - The session's timeout counts the CLI's own time only, summed over its execs: the simulator, the persona and
//   nextUser run between execs, off the clock, as Claude Code's adapter pauses its clock for them.
// - The prompt and each later user message go in on stdin. The adapter writes the evaluator's records beside the trial,
//   never into the work dir: every event of every exec (transcript.ndjson), the settings, effort, thread and each exec's
//   command line (init.json), calls[] (calls.json), the tool questions (questions.json), the user simulator's event log
//   (usersim.ndjson) and the CLI's stderr (cli-stderr.log).
// - A turn that completes is a completed session unless it leaves something to answer. A failed turn or an error naming
//   a proxy refusal maps as on Claude Code (CAP_STOP a cap stop, E_KEY_REJECTED rejected credentials, the rest a
//   missing cell); any other failed turn is a provider failure and a missing cell, UPSTREAM. A CLI that exits without a
//   turn result, or is killed, is an arm failure (harness_crash); the timeout is a timeout. A rollout the adapter cannot
//   read after a completed turn is the evaluator's failure, a missing cell, E_INFRA_FAILURE, so no question is lost.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { SidecarTask } from "../../skill-eval/contract/sidecar.ts";
import type { ContractTask } from "../../skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../trial/trial.ts";
import type { Termination, TokenUsage } from "../../types.ts";
import { parseCodex, skillUse, type SkillRef } from "../../grade/transcript.ts";
import { classifyAsk, type AskQuestion, type Category } from "../../usersim/classifier.ts";
import type { PersonaAnswer } from "../../usersim/persona.ts";
import { UserSim } from "../../usersim/sim.ts";
import { refusalIn, refusalTermination, type NextUser } from "../claude-code/driver.ts";

export type CodexProvider = "openai" | "openrouter";

/** The Codex CLI's name inside the agent's environment; the trial image installs it at the pinned version. */
export const CODEX_BIN = "codex";

/** The model provider id the command line defines for the proxy. */
export const PROVIDER_ID = "gstack_evals_proxy";

/** The tool a model asks the user through in exec's Default mode: it answers {"accepted":true} at once and takes any reply as the next user message. */
export const ASYNC_QUESTION = "request_user_input_async";

/** default_reasoning_level of each listed model in codex 0.166.0's own catalog (codex debug models; docker/host-cli.json's pin). */
export const CATALOG_EFFORT: Readonly<Record<string, string>> = {
  "gpt-6-astra": "low", "gpt-6.1-sol": "low", "gpt-6.1-terra": "low", "gpt-6-sol": "medium", "gpt-6-luna": "medium",
  "gpt-5.6-sol": "low", "gpt-5.6-terra": "medium", "gpt-5.6-luna": "medium", "gpt-5.5": "medium",
};

/** The effort the pinned catalog gives a model, by its slug or, as Codex matches it, by the slug after a provider prefix ("openai/"); null for a model the catalog lacks, for which Codex sends no effort. */
export const catalogEffort = (model: string): string | null => CATALOG_EFFORT[model] ?? CATALOG_EFFORT[model.slice(model.lastIndexOf("/") + 1)] ?? null;

export interface CodexOptions {
  model: string;
  provider: CodexProvider;
  /** The proxy's trial base URL as agents reach it, the slot and its per-session bearer. */
  proxy: { baseUrl: string; slot: string; token: string };
  /** model_reasoning_effort for every request, recorded in init.json; null writes none (a model the catalog lacks). */
  effort: string | null;
  /** The task's sidecar entry: user replies and persona. Evaluator side only. */
  entry?: SidecarTask;
  /** The arm's skill, for calls[] and the opened signal; null for an arm with no skill (none, bare). */
  skill: (SkillRef & { dir: string | null }) | null;
  /** The trial's evaluator-side directory for the adapter's records. */
  out: string;
  /** GSTACK_SESSION_KIND for the agent env; unset, the adapter sets none. */
  sessionKind?: "unattended" | "interactive";
  /** Replaces the user simulator after each completed turn: given that turn's agent messages, the next user message, an end, or a termination. */
  nextUser?: (texts: string[]) => Promise<NextUser>;
  /** The persona's free-form answers, evaluator side; absent, an unanswered question gets the simulator's fallback. */
  freeform?: (persona: string, question: string) => Promise<PersonaAnswer>;
  /** More -c settings after the adapter's own, as TOML scalars; one that names an adapter setting is refused. */
  settings?: Record<string, string | number | boolean>;
}

/** The agent env the adapter adds: the slot's bearer, by the name the provider definition reads, and the session kind. */
export function codexEnv(o: Pick<CodexOptions, "proxy" | "sessionKind">): Record<string, string> {
  return { OPENAI_API_KEY: o.proxy.token, ...(o.sessionKind ? { GSTACK_SESSION_KIND: o.sessionKind } : {}) };
}

/** The proxy provider and host settings, as -c key=value pairs whose values are TOML; Claude Code's Codex voice writes the same. */
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

/** The argv after the CLI's name: the session's first exec, or with thread a resume of it; the message follows on stdin. */
export function codexArgs(o: Pick<CodexOptions, "model" | "provider" | "proxy" | "effort" | "settings">, thread: string | null = null): string[] {
  const own = { ...codexConfig(o), ...(o.effort === null ? {} : { model_reasoning_effort: o.effort }) };
  const clash = Object.keys(o.settings ?? {}).filter((k) => k in own || k === "model_reasoning_effort");
  if (clash.length) throw new Error("E_INTERNAL: extra Codex settings may not replace the adapter's own: " + clash.join(", "));
  const settings = Object.entries({ ...own, ...o.settings }).flatMap(([k, v]) => ["-c", k + "=" + JSON.stringify(v)]);
  return ["exec", "--json", "--strict-config", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "--color", "never", "-m", o.model, ...settings, ...(thread ? ["resume", thread] : []), "-"];
}

export interface CodexQuestion {
  title: string;
  options?: string[];
}

/** The ASYNC_QUESTION calls a session's rollout holds, in order, each with the questions its arguments carry. */
export function codexQuestions(rollout: string): { call_id: string; questions: CodexQuestion[] }[] {
  const out: { call_id: string; questions: CodexQuestion[] }[] = [];
  for (const line of rollout.split("\n")) {
    let d: { type?: string; payload?: { type?: string; name?: string; call_id?: string; arguments?: string } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    const p = d?.type === "response_item" ? d.payload : undefined;
    if (p?.type !== "function_call" || p.name !== ASYNC_QUESTION) continue;
    let args: { questions?: unknown };
    try {
      args = JSON.parse(p.arguments ?? "");
    } catch {
      args = {};
    }
    const questions = (Array.isArray(args?.questions) ? (args.questions as { title?: unknown; options?: unknown }[]) : [])
      .filter((q) => typeof q?.title === "string" && q.title.trim())
      .map((q) => ({ title: q.title as string, ...(Array.isArray(q.options) ? { options: q.options.map(String) } : {}) }));
    out.push({ call_id: String(p.call_id), questions });
  }
  return out;
}

type CodexEvent = { type?: string; thread_id?: string; message?: string; error?: { message?: string }; usage?: Record<string, number>; item?: { type?: string; text?: string } };

/** Codex's input_tokens include its cached input and its output_tokens include reasoning; TokenUsage keeps each class apart. */
const tokens = (u: Record<string, number>): TokenUsage => ({ input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0) - (u.cache_write_input_tokens ?? 0)), output: Math.max(0, (u.output_tokens ?? 0) - (u.reasoning_output_tokens ?? 0)), reasoning: u.reasoning_output_tokens ?? 0, cache_read: u.cached_input_tokens ?? 0, cache_write: u.cache_write_input_tokens ?? 0 });

/** A session's rollout as the agent's session holds it, or null when it cannot be read. */
const readRollout = (session: AgentSession, thread: string): Promise<string | null> =>
  new Promise((done) => {
    let child: ReturnType<AgentSession["spawn"]>;
    try {
      child = session.spawn(["sh", "-c", 'cat "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*-"$1".jsonl', "sh", thread]);
    } catch {
      return done(null);
    }
    let text = "";
    child.stdout?.on("data", (d: Buffer) => (text += d.toString("utf8")));
    child.on("error", () => done(null));
    child.on("close", (code) => done(code === 0 ? text : null));
    child.stdin?.end();
  });

export interface CodexDriver extends AgentDriver {
  env: Record<string, string>;
}

export function codexDriver(o: CodexOptions): CodexDriver {
  return {
    env: codexEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      mkdirSync(o.out, { recursive: true });
      const stderrLog = join(o.out, "cli-stderr.log");
      let personaStop: Termination | null = null;
      const persona = o.freeform;
      const freeform = persona && (async (text: string, question: string) => {
        const a = await persona(text, question);
        if ("text" in a) return a.text;
        personaStop ??= a.stop;
        return null;
      });
      const sim = new UserSim({ task: task.id, script: o.entry?.user, log: join(o.out, "usersim.ndjson"), ...(freeform ? { freeform } : {}) });
      const events: unknown[] = [];
      const questions: { call_id: string; turn: number; questions: CodexQuestion[]; answer: string | null; unanswered: boolean }[] = [];
      const classified: (Category | null)[] = [];
      const seen = new Set<string>();
      const resumes: string[][] = [];
      let first: string[] = [];
      let thread: string | null = null;
      let usage: TokenUsage | null = null;
      let left = timeoutMs;
      let message = task.prompt;
      let termination: Termination = { kind: "completed" };
      const records = () => {
        writeFileSync(join(o.out, "init.json"), JSON.stringify({ model: o.model, provider: o.provider, reasoning_effort: o.effort, thread_id: thread, argv: first, resume_argv: resumes }, null, 2) + "\n");
        writeFileSync(join(o.out, "questions.json"), JSON.stringify(questions, null, 2) + "\n");
      };
      for (let turn = 1; ; turn++) {
        if (left <= 0) {
          termination = { kind: "timeout" };
          break;
        }
        const argv = [CODEX_BIN, ...codexArgs(o, thread)];
        if (thread) resumes.push(argv);
        else first = argv;
        records();
        let completed = false;
        let failed: string | null = null;
        let lastError: string | null = null;
        let timedOut = false;
        const texts: string[] = [];
        const started = performance.now();
        const child = session.spawn(argv, {});
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, left);
        child.stderr?.on("data", (d: Buffer) => appendFileSync(stderrLog, d));
        child.stdin?.on("error", () => {});
        child.stdin?.end(message);
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
            if (ev.type === "thread.started" && typeof ev.thread_id === "string") thread ??= ev.thread_id;
            else if (ev.type === "item.completed" && ev.item?.type === "agent_message" && ev.item.text?.trim()) texts.push(ev.item.text);
            else if (ev.type === "turn.completed") {
              completed = true;
              if (ev.usage) usage = tokens(ev.usage);
            } else if (ev.type === "turn.failed") failed = ev.error?.message ?? "turn failed";
            else if (ev.type === "error") lastError = ev.message ?? "error";
          }
        }
        const exit = await Promise.race([closed, spawnError.then((err) => ({ code: null, signal: null, err }))]);
        clearTimeout(timer);
        left -= performance.now() - started;
        records();
        if ("err" in exit) appendFileSync(stderrLog, "adapter: " + String(exit.err.message) + "\n");
        const exited = !("err" in exit) && exit.signal === null;
        const refusal = refusalIn(failed ?? lastError ?? "");
        if (timedOut) termination = { kind: "timeout" };
        else if (!(completed && !failed && exited && exit.code === 0)) termination = refusal && exited ? refusalTermination(refusal) : failed && exited ? { kind: "missing", code: "UPSTREAM" } : { kind: "arm_failure", failure: "harness_crash" };
        if (termination.kind !== "completed") break;
        const rollout = thread ? await readRollout(session, thread) : null;
        if (rollout === null) {
          appendFileSync(stderrLog, "adapter: infra failure, not the arm's: the session's rollout (thread " + thread + ") could not be read after turn " + turn + "\n");
          termination = { kind: "missing", code: "E_INFRA_FAILURE" };
          break;
        }
        const fresh = codexQuestions(rollout).filter((q) => !seen.has(q.call_id) && q.questions.length);
        for (const q of fresh) seen.add(q.call_id);
        const asks: AskQuestion[] = fresh.flatMap((q) => q.questions.map((x) => ({ question: x.title, ...(x.options ? { options: x.options.map((label) => ({ label })) } : {}) })));
        let next: NextUser | { end: string };
        if (o.nextUser || (asks.length && o.entry?.user === undefined)) {
          for (const a of asks) classified.push(classifyAsk(a).category);
          next = o.nextUser ? await o.nextUser(texts) : { end: "no_user_replies" };
        } else if (asks.length) {
          const r = await sim.answerAsk(asks);
          next = "answers" in r ? { reply: asks.length === 1 ? r.answers[asks[0]!.question!]! : asks.map((a) => a.question + "\n" + r.answers[a.question!]).join("\n\n") } : { end: "no_user_replies" };
        } else next = await sim.afterTurn(texts.at(-1) ?? "");
        const answer = "reply" in next ? next.reply : null;
        questions.push(...fresh.map((q) => ({ call_id: q.call_id, turn, questions: q.questions, answer, unanswered: answer === null })));
        records();
        if (personaStop) termination = personaStop;
        else if ("stop" in next) termination = next.stop;
        if (termination.kind !== "completed" || !("reply" in next)) break;
        message = next.reply;
      }
      const { turns, calls, outputs } = parseCodex(events);
      const use = skillUse(calls, o.skill, outputs);
      writeFileSync(join(o.out, "calls.json"), JSON.stringify({ calls, opened: use.opened, files_read: use.files }, null, 2) + "\n");
      const size = (f: string) => {
        try {
          return o.skill?.dir ? statSync(join(o.skill.dir, f)).size : 0;
        } catch {
          return 0;
        }
      };
      return {
        turns, termination, opened: o.skill ? use.opened : null, files_read: use.files, asked: [...sim.asked, ...classified], unanswered: questions.filter((q) => q.unanswered).reduce((n, q) => n + q.questions.length, 0), usage, cost_micros: null, agent_turns: null,
        loaded_bytes: o.skill?.dir ? use.files.reduce((s, f) => s + size(f), 0) : null,
      };
    },
  };
}

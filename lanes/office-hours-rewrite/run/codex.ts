// Copyright (c) 2026 Garry Tan. MIT License.
// The office-hours rewrite eval's Sol host (the second attempt's pre-run change 2: the eval owner ruled on 2026-11-19
// that every Sol arm session runs in Codex CLI, not Claude Code; Opus and particle-1 keep the Claude Code driver).
// - solDriver: the shared Codex adapter (src/adapters/codex/driver.ts, codexDriver) with the closing loop as its
//   nextUser, as on Claude Code. The adapter owns the exec and resume loop, the proxy's provider entry, the slot's
//   bearer as OPENAI_API_KEY, the reasoning effort (frozen.CODEX_SETTINGS' low), question capture from the rollout
//   (request_user_input_async; Codex answers request_user_input "unavailable in Default mode") with each answer back
//   by exec resume, and its records under host/codex/. The lane adds what is this eval's: the pinned 0.170.0 binary,
//   run through a fresh link named CODEX_LINK (codexLaunch, pre-run change 5), CODEX_SETTINGS' other keys through the
//   adapter's settings (solSettings), the HOME check before the first exec (homeCommand), a cap of AGENT_TURNS_PER_REPLY tool items per reply that kills the reply and
//   ends the session as a turn cap (Codex has no turn limit of its own), and after the session the rollouts copied out
//   with host/transcript.ndjson rewritten from the main one (codexTranscript). The sleep tool is off, so a model cannot
//   wait inside a turn for a reply that comes only with the next one.
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
import type { NextUser } from "../../../src/adapters/claude-code/driver.ts";
import { ASYNC_QUESTION, CODEX_BIN, codexArgs, codexConfig, codexDriver, codexEnv, type CodexProvider } from "../../../src/adapters/codex/driver.ts";
import type { ContractTask } from "../../../src/skill-eval/contract/tasks.ts";
import type { AgentSession } from "../../../src/trial/sandbox.ts";
import type { AgentDriver, AgentOutcome } from "../../../src/trial/trial.ts";
import type { Termination, TokenUsage } from "../../../src/types.ts";
import { AGENT_TURNS_PER_REPLY, ARM_ENV, CODEX, CODEX_LINK, CODEX_RENDERED, CODEX_SETTINGS, CODEX_SKILL_FILES, PINS, RENDER_GAP } from "../frozen.ts";
import type { SkillArm } from "../types.ts";

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

/** CODEX_SETTINGS beyond the adapter's own: less the effort, which the adapter writes, and the keys the adapter already sets, which must hold the frozen values. */
export function solSettings(): Record<string, string | number | boolean> {
  const own = codexConfig({ provider: CODEX.provider as CodexProvider, proxy: { baseUrl: "", slot: "", token: "" } });
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(CODEX_SETTINGS)) {
    if (k === "model_reasoning_effort") continue;
    if (!(k in own)) out[k] = v;
    else if (own[k] !== v) throw new Error("E_INTERNAL: the Codex adapter writes " + k + " = " + JSON.stringify(own[k]) + ", not the frozen " + JSON.stringify(v));
  }
  return out;
}

const adapter = (o: Pick<SolOptions, "proxy">) => ({ model: CODEX.model, provider: CODEX.provider as CodexProvider, proxy: o.proxy, effort: CODEX_SETTINGS.model_reasoning_effort, settings: solSettings() });

/** The argv after the binary, as the adapter builds it with the lane's settings; the message follows on stdin. thread resumes that session. */
export const solArgv = (o: Pick<SolOptions, "proxy">, thread: string | null): string[] => codexArgs(adapter(o), thread);

/** The command that runs CODEX.bin with args: Codex's own directory first on PATH, then the binary through a fresh link named CODEX_LINK in a new temporary directory (pre-run change 5). */
export const codexLaunch = (args: string[]): string[] => ["sh", "-c", 'export PATH="' + CODEX.path_dir + ':$PATH" && L="$(mktemp -d -t ' + CODEX_LINK + '.XXXXXX)/' + CODEX_LINK + '" && ln -s "$0" "$L" && exec "$L" "$@"', CODEX.bin, ...args];

/** The variable that carries the slot's per-session bearer (the adapter's). The trial env admits it in the agent env only with a gse_ session bearer, never a provider key, so the containment probe exempts this one name on Sol (ohrProbed). */
export const BEARER_ENV = "OPENAI_API_KEY";

/** The agent env: the adapter's (the slot's bearer; no session kind, which every arm leaves unset) and section 4 step 2's ARM_ENV. */
export const solEnv = (o: Pick<SolOptions, "proxy">): Record<string, string> => ({ ...codexEnv({ proxy: o.proxy }), ...ARM_ENV });

/** The shell step that lists what an arm's HOME and work dir hold before Codex first runs. */
export const homeCommand = 'W="$PWD"; cd "$HOME" && for p in .codex .codex/config.toml .codex/AGENTS.md .codex/skills .agents .claude .gstack .local/share/gstack AGENTS.md; do test -e "$p" && echo "present $p"; done; find "$HOME" "$W" -maxdepth 8 -name AGENTS.md -o -name AGENTS.override.md 2>/dev/null | sed "s/^/agents /"; find "$HOME" -maxdepth 8 -name SKILL.md 2>/dev/null | head -1 | sed "s/^/skill /"; true';

/** What homeCommand printed that departs from the arm: a skill arm holds its Codex skills and gstack tree and nothing else of Codex; none holds nothing. */
export function homeProblems(printed: string, skillArm: boolean): string[] {
  const allowed = skillArm ? new Set(["present .codex", "present .codex/skills", "present .local/share/gstack"]) : new Set<string>();
  const lines = printed.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.filter((l) => !allowed.has(l) && !(skillArm && (l.startsWith("skill ") || /^agents \S*\/\.local\/share\/gstack\//.test(l)))).map((l) => (skillArm ? "skill arm HOME: " : "none arm HOME: ") + l);
}

const TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search", "collab_tool_call", "todo_list", "image_view"]);
async function readAll(session: AgentSession, argv: string[]): Promise<string> {
  const child = session.spawn(argv, {});
  let text = "";
  child.stdout?.on("data", (d: Buffer) => (text += d.toString("utf8")));
  child.stdin?.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));
  return text;
}

/** Every rollout of the session into out/rollouts, and the main one (the adapter's thread) as out/rollout.jsonl and out/transcript.ndjson. */
async function copyOut(session: AgentSession, out: string): Promise<void> {
  let thread: string | null = null;
  try {
    thread = JSON.parse(readFileSync(join(out, "codex", "init.json"), "utf8")).thread_id ?? null;
  } catch {
    return;
  }
  const files = (await readAll(session, ["sh", "-c", 'ls "$HOME"/.codex/sessions/*/*/*/rollout-*.jsonl 2>/dev/null'])).split("\n").map((l) => l.trim()).filter(Boolean);
  mkdirSync(join(out, "rollouts"), { recursive: true });
  for (const f of files) {
    const text = await readAll(session, ["cat", f]);
    writeFileSync(join(out, "rollouts", posix.basename(f)), text);
    if (thread && f.endsWith("-" + thread + ".jsonl")) {
      writeFileSync(join(out, "rollout.jsonl"), text);
      writeFileSync(join(out, "transcript.ndjson"), codexTranscript(text));
    }
  }
}

export function solDriver(o: SolOptions): AgentDriver & { env: Record<string, string> } {
  const cap = o.maxToolItems ?? AGENT_TURNS_PER_REPLY;
  return {
    env: solEnv(o),
    async run(session: AgentSession, task: ContractTask, timeoutMs: number): Promise<AgentOutcome> {
      mkdirSync(o.out, { recursive: true });
      const home = session.exec(homeCommand, 60_000);
      o.onHome?.(home.exitCode === 0 ? homeProblems(home.stdout, o.skillArm) : null);
      let capped = false;
      let toolItems = 0;
      const lane: AgentSession = {
        ...session,
        spawn(argv, env) {
          if (argv[0] !== CODEX_BIN) return session.spawn(argv, env);
          const actual = codexLaunch(argv.slice(1));
          appendFileSync(join(o.out, "codex", "exec-argv.ndjson"), JSON.stringify(actual) + "\n");
          const child = session.spawn(actual, env);
          let reply = 0;
          let rest = "";
          child.stdout?.on("data", (d: Buffer) => {
            const lines = (rest + d.toString("utf8")).split("\n");
            rest = lines.pop() ?? "";
            for (const l of lines) {
              let ev: Rec;
              try {
                ev = JSON.parse(l);
              } catch {
                continue;
              }
              if (ev.type !== "item.started" || !TOOL_ITEMS.has(ev.item?.type)) continue;
              toolItems++;
              if (++reply > cap && !capped) {
                capped = true;
                child.kill("SIGKILL");
              }
            }
          });
          return child;
        },
      };
      const outcome = await codexDriver({ ...adapter(o), skill: null, out: join(o.out, "codex"), nextUser: o.nextUser }).run(lane, task, timeoutMs);
      await copyOut(session, o.out);
      return { ...outcome, agent_turns: toolItems, ...(capped ? { termination: { kind: "turn_cap" } as Termination } : {}) };
    },
  };
}

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b?.text === "string" ? b.text : "")).join("\n") : c == null ? "" : JSON.stringify(c));
const provenance = (p: Rec): string[] => (p.internal_chat_message_metadata_passthrough?.content_item_metadata ?? []).map((m: Rec) => String(m?.provenance?.type ?? ""));
const INJECTED = new Set(["skills", "agents_md"]);
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

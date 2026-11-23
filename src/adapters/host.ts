// Host selection for a run on a real host (U10): the adapter behind --host, and where each host looks for an arm's
// skill in the agent's HOME. Claude Code reads ~/.claude/skills/<name>; Codex reads $CODEX_HOME/skills/<name>, and the
// adapters leave CODEX_HOME at its default, ~/.codex.
import { posix } from "node:path";
import type { Provider } from "../runner/pricing/prices.ts";
import type { SidecarTask } from "../skill-eval/contract/sidecar.ts";
import type { SkillRef } from "../grade/transcript.ts";
import type { AgentDriver } from "../trial/trial.ts";
import type { PersonaAnswer } from "../usersim/persona.ts";
import type { Host } from "../types.ts";
import { claudeCodeDriver, type ClaudeCodeOptions, type SystemPrompt } from "./claude-code/driver.ts";
import { codexDriver, type CodexOptions, type CodexProvider } from "./codex/driver.ts";

export const SKILL_DIRS: Record<Host, string> = { claude: ".claude/skills", codex: ".codex/skills" };

/** Where a host finds the named skill under the agent's HOME, as the agent sees it. */
export const skillRoot = (host: Host, home: string, skill: string): string => posix.join(home, SKILL_DIRS[host], skill);

export interface HostDriverOptions {
  host: Host;
  model: string;
  provider: Provider;
  proxy: { baseUrl: string; slot: string; token: string };
  entry?: SidecarTask;
  interactive: boolean;
  skill: (SkillRef & { dir: string | null }) | null;
  out: string;
  /** The persona's free-form answers for a task with a persona. */
  freeform?: (persona: string, question: string) => Promise<PersonaAnswer>;
  /** Codex only, and every Codex session needs it: model_reasoning_effort, or null for a model Codex's catalog lacks (its driver's effort). */
  effort?: string | null;
  /** Codex only: the arm's hook trust, pinned CLI, extra settings, switches to record and arm record (its driver's options). */
  codexSession?: Pick<CodexOptions, "hookTrust" | "bin" | "settings" | "switches" | "arm">;
  /** Plugin roots in the agent's HOME for the session (Claude Code only). */
  plugins?: string[];
  /** The cell's cross-family voice through the Codex CLI (Claude Code only). */
  codex?: { provider: CodexProvider; model: string };
  /** The session's system prompt and its turn cap (Claude Code only; see its driver). */
  systemPrompt?: SystemPrompt;
  maxTurns?: number;
  /** GSTACK_SESSION_KIND for the agent env, on either host; unset, none. */
  sessionKind?: "unattended";
  /** Claude Code only: GSTACK_SKILL_GATE_DEADLINE_MS for the agent env, and settings printed at session start (driver.ts). */
  skillGateDeadlineMs?: number;
  /** Claude Code only: CLAUDE_CODE_DISABLE_1M_CONTEXT=1, a 200,000-token window on every model (driver.ts). */
  disable1mContext?: boolean;
  /** Claude Code only: the Agent SDK's query in place of the pinned one, so a keyless test can read the CLI's context usage. */
  query?: ClaudeCodeOptions["query"];
  settings?: { command: string; make: (printed: string) => Record<string, unknown> | string };
  /** Claude Code only: record the turn cap and the slot's allowance as their own terminations (turn_cap, allowance_stop). */
  capStops?: boolean;
  /** Claude Code only: the most idle time, in all, a session may wait on its background work; unset, it ends at its turn's result (no hold). */
  backgroundWaitMs?: number;
  /** Claude Code only: one follow-up user message when needed(the transcript so far) is true (its driver's followUp). */
  followUp?: { text: string; needed: (transcript: string) => boolean };
  /** Claude Code only: an SDK-side Stop hook on the transcript so far (its driver's stopHook). */
  stopHook?: (transcript: string) => string | null;
}

/** The adapter for one session. Claude Code takes Anthropic and OpenRouter models; Codex takes OpenAI and OpenRouter ones. */
export function hostDriver(o: HostDriverOptions): AgentDriver {
  if (o.host === "claude") {
    if (o.provider === "openai") throw new Error("E_INTERNAL: Claude Code cannot run the openai model " + o.model);
    return claudeCodeDriver({ model: o.model, provider: o.provider, proxy: o.proxy, skill: o.skill, out: o.out, ...(o.entry ? { entry: o.entry } : {}), ...(o.freeform ? { freeform: o.freeform } : {}), ...(o.plugins ? { plugins: o.plugins } : {}), ...(o.codex ? { codex: o.codex } : {}), ...(o.systemPrompt ? { systemPrompt: o.systemPrompt } : {}), ...(o.maxTurns ? { maxTurns: o.maxTurns } : {}), ...(o.sessionKind ? { sessionKind: o.sessionKind } : {}), ...(o.skillGateDeadlineMs ? { skillGateDeadlineMs: o.skillGateDeadlineMs } : {}), ...(o.disable1mContext ? { disable1mContext: true } : {}), ...(o.query ? { query: o.query } : {}), ...(o.settings ? { settings: o.settings } : {}), ...(o.capStops ? { capStops: o.capStops } : {}), ...(o.backgroundWaitMs !== undefined ? { backgroundWaitMs: o.backgroundWaitMs } : {}), ...(o.followUp ? { followUp: o.followUp } : {}), ...(o.stopHook ? { stopHook: o.stopHook } : {}) });
  }
  if (o.provider === "anthropic") throw new Error("E_INTERNAL: Codex cannot run the anthropic model " + o.model);
  if (o.effort === undefined) throw new Error("E_INTERNAL: a Codex session needs its reasoning effort, and none was passed for " + o.model);
  return codexDriver({ model: o.model, provider: o.provider, proxy: o.proxy, effort: o.effort, skill: o.skill, out: o.out, ...(o.entry ? { entry: o.entry } : {}), ...(o.freeform ? { freeform: o.freeform } : {}), ...(o.sessionKind ? { sessionKind: o.sessionKind } : {}), ...o.codexSession });
}

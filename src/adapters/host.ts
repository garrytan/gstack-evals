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
import { claudeCodeDriver, type SystemPrompt } from "./claude-code/driver.ts";
import { codexDriver, type CodexProvider } from "./codex/driver.ts";

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
  /** The persona's free-form answers for a task with a persona; Claude Code only, since Codex runs no interactive task. */
  freeform?: (persona: string, question: string) => Promise<PersonaAnswer>;
  /** Plugin roots in the agent's HOME for the session (Claude Code only). */
  plugins?: string[];
  /** The cell's cross-family voice through the Codex CLI (Claude Code only). */
  codex?: { provider: CodexProvider; model: string };
  /** The session's system prompt, its turn cap and its GSTACK_SESSION_KIND (Claude Code only; see its driver). */
  systemPrompt?: SystemPrompt;
  maxTurns?: number;
  sessionKind?: "unattended";
}

/** The adapter for one session. Claude Code takes Anthropic and OpenRouter models; Codex takes OpenAI and OpenRouter ones. */
export function hostDriver(o: HostDriverOptions): AgentDriver {
  if (o.host === "claude") {
    if (o.provider === "openai") throw new Error("E_INTERNAL: Claude Code cannot run the openai model " + o.model);
    return claudeCodeDriver({ model: o.model, provider: o.provider, proxy: o.proxy, skill: o.skill, out: o.out, ...(o.entry ? { entry: o.entry } : {}), ...(o.freeform ? { freeform: o.freeform } : {}), ...(o.plugins ? { plugins: o.plugins } : {}), ...(o.codex ? { codex: o.codex } : {}), ...(o.systemPrompt ? { systemPrompt: o.systemPrompt } : {}), ...(o.maxTurns ? { maxTurns: o.maxTurns } : {}), ...(o.sessionKind ? { sessionKind: o.sessionKind } : {}) });
  }
  if (o.provider === "anthropic") throw new Error("E_INTERNAL: Codex cannot run the anthropic model " + o.model);
  return codexDriver({ model: o.model, provider: o.provider, proxy: o.proxy, interactive: o.interactive, skill: o.skill, out: o.out });
}

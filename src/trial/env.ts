// The trial env allowlist (plan v3.2, "Execution, isolation and secrets"). Every setup, agent, check and proxy child starts
// from an explicit list of names for its role, never from the evaluator's environment:
// - setup and check: PATH, the trial HOME, LANG, TERM, GSTACK_STATE_ROOT and GSTACK_HOME, SKILL_EVAL_FIXTURES, and the
//   task's declared fixture variables; the check also gets SKILL_EVAL_DELTA.
// - agent: the same without SKILL_EVAL_FIXTURES (the agent never sees the tasks directory), plus the per-session bearer,
//   the proxy base URL and the host's own settings (model purity, config dirs, the context window, session kind, gstack's gate deadline). The key and token names
//   there must carry a per-session bearer from the metering proxy, never a provider key.
// - proxy: the provider keys and the management credential, and nothing a task declares. The provider key lives only here.
// A credential-looking name that is not on its role's list is refused, and no setup, agent or check value may hold a
// provider key the evaluator holds.
//
// A task's declared variables (the sidecar's env) are fixture variable names: a variable name that does not look like a
// credential and is not a harness, host, runtime, loader, shell, git, cloud or proxy setting. validate refuses the rest
// (U5's sidecar calls fixtureEnvProblem), and trialEnv checks them again before any child starts.

import { FIXTURES_VAR } from "../skill-eval/contract/tasks.ts";

export type EnvRole = "setup" | "agent" | "check" | "proxy";

/** The check's path to the trial's delta.json (rule C of GEVA-68's audit): the evaluator's list of what the agent added, changed, deleted and dropped. */
export const DELTA_VAR = "SKILL_EVAL_DELTA";

/** Names the trial sets itself in every role but the proxy; a task may not declare them. */
export const TRIAL_BASE_ENV: readonly string[] = ["PATH", "HOME", "LANG", "TERM", "GSTACK_STATE_ROOT", "GSTACK_HOME"];

/** The per-session bearer and the proxy base URL, by the names Claude Code and Codex read. */
export const SESSION_ENV: readonly string[] = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_KEY"];

/** Host settings the adapters (U10) set in the agent's env: model purity, config dirs, session kind, no updates or telemetry. */
export const HOST_ENV: readonly string[] = [
  "ANTHROPIC_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_MAX_RETRIES", "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "CLAUDE_CODE_DISABLE_1M_CONTEXT", "CLAUDE_CONFIG_DIR", "DISABLE_AUTOUPDATER", "DISABLE_TELEMETRY",
  "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "GSTACK_SESSION_KIND", "GSTACK_SKILL_GATE_DEADLINE_MS",
];

/** The proxy container's names: provider keys and the management credential. */
export const PROXY_ENV: readonly string[] = ["PATH", "HOME", "LANG", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GSTACK_EVALS_PROXY_TOKEN"];

export const PROVIDER_KEY_ENV: readonly string[] = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

export const ROLE_ENV: Record<EnvRole, readonly string[]> = {
  setup: [...TRIAL_BASE_ENV, FIXTURES_VAR],
  check: [...TRIAL_BASE_ENV, FIXTURES_VAR, DELTA_VAR],
  agent: [...TRIAL_BASE_ENV, ...SESSION_ENV, ...HOST_ENV],
  proxy: PROXY_ENV,
};

/** The metering proxy's per-session bearer (Binding.token): gse_ and 43 base64url characters. */
export const SESSION_BEARER = /^gse_[A-Za-z0-9_-]{32,}$/;

const CREDENTIAL = /API_?KEY|TOKEN|SECRET|PASS(WORD|WD|PHRASE)?($|_)|CREDENTIAL|(^|_)O?AUTH(_|$)|PRIVATE_?KEY|ACCESS_?KEY|(^|_)PAT($|_)|(^|_)SESSION(_|$)|COOKIE|BEARER|SIGNING|(^|_)KEY$/i;

/** The agent's names that carry the per-session bearer. */
const BEARER_ENV: readonly string[] = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/** Settings that change how a host, runtime, loader, shell, git or cloud client behaves, or route traffic. */
const HOST_SETTING = /^(LD_|DYLD_|NODE_OPTIONS$|NODE_PATH$|NODE_EXTRA_CA_CERTS$|BUN_|NPM_CONFIG_|YARN_|PNPM_|PYTHON(PATH|HOME|STARTUP|USERBASE)$|PIP_|RUBYOPT$|RUBYLIB$|GEM_|BUNDLE_|PERL5(OPT|LIB)$|JAVA_TOOL_OPTIONS$|_JAVA_OPTIONS$|GIT_|SSH_|GPG_|GNUPG|DOCKER_|KUBECONFIG$|AWS_|GOOGLE_|GCLOUD_|CLOUDSDK_|AZURE_|GITHUB_|GH_|GITLAB_|CI$|.*_PROXY$|BASH_ENV$|ENV$|BASHOPTS$|SHELLOPTS$|SHELL$|PS4$|IFS$|PROMPT_COMMAND$|CDPATH$|TMPDIR$|USER$|LOGNAME$|XDG_|CLAUDE|CODEX|ANTHROPIC|OPENAI|OPENROUTER|GSTACK_|SKILL_EVAL_)/i;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Why a name cannot be a task's fixture variable, or null when it can. */
export function fixtureEnvProblem(name: string): string | null {
  if (!ENV_NAME.test(name)) return "is not a variable name";
  if (TRIAL_BASE_ENV.includes(name) || name === FIXTURES_VAR) return "is set by the trial itself";
  if (CREDENTIAL.test(name) || HOST_SETTING.test(name)) return "looks like a credential or a host setting; those stay with the harness and the metering proxy";
  return null;
}

export const looksLikeCredential = (name: string): boolean => CREDENTIAL.test(name);

export class TrialEnvError extends Error {}

/**
 * The env for one child of a trial: the harness's own values for its role, plus the task's declared fixture variables
 * copied from source when set there. Throws TrialEnvError for a name its role does not allow, a declared name that is not
 * a fixture variable, an agent credential that is not a session bearer, or any value holding a provider key from source.
 */
export function trialEnv(role: EnvRole, values: Record<string, string>, declared: readonly string[] = [], source: Record<string, string | undefined> = process.env): Record<string, string> {
  const allowed = ROLE_ENV[role];
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.includes(name)) throw new TrialEnvError(name + " is not on the " + role + " env allowlist" + (looksLikeCredential(name) ? " and looks like a credential" : ""));
    env[name] = value;
  }
  if (declared.length && role === "proxy") throw new TrialEnvError("the proxy takes no task variables: " + declared.join(", "));
  for (const name of declared) {
    const problem = fixtureEnvProblem(name);
    if (problem) throw new TrialEnvError("task variable " + name + " " + problem);
    if (source[name] !== undefined) env[name] = source[name]!;
  }
  if (role === "proxy") return env;
  for (const [name, value] of Object.entries(env)) {
    if (role === "agent" && BEARER_ENV.includes(name) && !SESSION_BEARER.test(value)) throw new TrialEnvError(name + " in the agent env must carry a per-session bearer from the metering proxy, never a provider key");
  }
  const keys = PROVIDER_KEY_ENV.map((k) => source[k]).filter((v): v is string => typeof v === "string" && v.length >= 8);
  for (const [name, value] of Object.entries(env)) {
    if (keys.some((k) => value.includes(k))) throw new TrialEnvError(name + " in the " + role + " env holds a provider key; provider keys live only in the proxy");
  }
  return env;
}

/**
 * docker run or exec arguments for an env: plain names as NAME=value, and credential-looking names as a bare -e NAME whose
 * value docker reads from its own env (the returned clientEnv), so no bearer or key appears in a process list.
 */
export function dockerEnvArgs(env: Record<string, string>): { args: string[]; clientEnv: Record<string, string> } {
  const args: string[] = [];
  const clientEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (looksLikeCredential(name)) {
      args.push("-e", name);
      clientEnv[name] = value;
    } else args.push("-e", name + "=" + value);
  }
  return { args, clientEnv };
}

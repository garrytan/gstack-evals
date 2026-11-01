// Writes a Harbor JobConfig for one Lane B batch: every task x every (model, arm) agent. A model with
// only_arms runs just those arms (quick look 3's Opus 5.5 none reference).
// Harbor orders trials attempt-major, then task, then agent, so each task's arms run as
// a block and a cap stop leaves complete, paired blocks behind.
import { readFileSync, writeFileSync } from "node:fs";

export type BatchSpec = {
  job_name: string;
  tasks_dir: string;
  tasks: string[];
  models: { id: string; harbor_model: string; session_cap_usd: number; only_arms?: string[] }[];
  arms: ({ name: string; tar: string; sha256: string } & AgentOptions)[];
  attempts: number;
  n_concurrent: number;
  agent_dir: string;
  runner_dir: string;
  wrapper?: string;
  base_url: string;
  max_output_tokens: number;
  verifier_timeout_multiplier: number;
  invoke?: boolean;
  skill_maps?: Record<string, Record<string, string>>;
};

// The invoked arms open the prompt with a slash command so the CLI injects a skill body. invoke
// defaults on and is a per-batch off switch; none never invokes. Each arm reads its own skill map
// (arm, then task, to skill), so the stacks batch tells gstack and pstack arms different skills.
export const invokesArm = (name: string) => name !== "none";

// Agent options an arm may set, with laneb_agent.py's allowed values (SYSTEM_PROMPTS, SESSION_KINDS). An option
// left out keeps the agent's default (sdk-default, no session kind) and stays out of the kwargs, so a batch that sets
// none writes the same JobConfig as before.
export const AGENT_OPTIONS = { system_prompt: ["sdk-default", "claude-code-preset"], session_kind: ["unattended"] };
export type AgentOptions = { system_prompt?: string; session_kind?: string };

// One entry of prepare-run's arms list: <arm>[:<option>=<value>]..., for example
// gstack:system_prompt=claude-code-preset:session_kind=unattended.
export function armSpec(entry: string): { name: string } & AgentOptions {
  const [name, ...settings] = entry.split(":");
  const options: Record<string, string> = {};
  for (const setting of settings) {
    const [, key, value] = /^(\w+)=(.*)$/.exec(setting) ?? [];
    if (!AGENT_OPTIONS[key as keyof AgentOptions]?.includes(value) || key in options) {
      throw new Error(`E_USAGE arm ${entry}: ${setting} is not one of ${JSON.stringify(AGENT_OPTIONS)}, or is set twice`);
    }
    options[key] = value;
  }
  return { name, ...options };
}

// Harbor's default no-retry list at f3a5a92, plus our ledger cap stop. A trial that fails for any
// other reason before it is graded (image build, container start, proxy unreachable) gets two reruns.
export const NO_RETRY = [
  "AgentTimeoutError", "VerifierTimeoutError", "RewardFileNotFoundError", "RewardFileEmptyError", "VerifierOutputParseError",
  "ApiUsageLimitError", "AgentSafetyRefusalError", "AgentAuthenticationError", "ModelNotFoundError", "UnsupportedModelParametersError",
  "LedgerCapStop",
];

export function jobConfig(b: BatchSpec) {
  const agents = b.models.flatMap((m) =>
    b.arms.filter((a) => !m.only_arms || m.only_arms.includes(a.name)).map((a) => ({
      name: "laneb-claude-code",
      import_path: "laneb_agent:LanebAgent",
      model_name: m.harbor_model,
      base_url: b.base_url,
      kwargs: {
        skip_install: true,
        arm: a.name,
        arm_tar: a.tar,
        arm_sha256: a.sha256,
        upstream_model: m.id,
        session_cap_usd: m.session_cap_usd,
        persona_path: `${b.agent_dir}/persona.json`,
        wrapper_path: `${b.runner_dir}/${b.wrapper ?? "prompt-wrapper.md"}`,
        max_output_tokens: b.max_output_tokens,
        invoke: (b.invoke ?? true) && invokesArm(a.name),
        skill_map: b.skill_maps?.[a.name] ?? {},
        ...(a.system_prompt ? { system_prompt: a.system_prompt } : {}),
        ...(a.session_kind ? { session_kind: a.session_kind } : {}),
      },
    })),
  );
  return {
    job_name: b.job_name,
    jobs_dir: "jobs",
    n_attempts: b.attempts,
    n_concurrent_trials: b.n_concurrent,
    verifier_timeout_multiplier: b.verifier_timeout_multiplier,
    quiet: true,
    retry: { max_retries: 2, exclude_exceptions: NO_RETRY },
    environment: { type: "docker", delete: true },
    agents,
    tasks: b.tasks.map((t) => ({ path: `${b.tasks_dir}/${t}` })),
  };
}

if (import.meta.main) {
  const [specPath, outPath] = Bun.argv.slice(2);
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as BatchSpec;
  writeFileSync(outPath, JSON.stringify(jobConfig(spec), null, 2) + "\n");
  console.log(`wrote ${outPath}: ${spec.tasks.length} tasks x ${jobConfig(spec).agents.length} agents x ${spec.attempts} attempts`);
}

// Writes a Harbor JobConfig for one Lane B batch: every task x every (model, arm) agent.
// Harbor orders trials attempt-major, then task, then agent, so each task's arms run as
// a block and a cap stop leaves complete, paired blocks behind.
import { readFileSync, writeFileSync } from "node:fs";

export type BatchSpec = {
  job_name: string;
  tasks_dir: string;
  tasks: string[];
  models: { id: string; harbor_model: string; session_cap_usd: number }[];
  arms: ({ name: string; tar: string; sha256: string } & AgentOptions)[];
  attempts: number;
  n_concurrent: number;
  agent_dir: string;
  runner_dir: string;
  base_url: string;
  max_output_tokens: number;
  verifier_timeout_multiplier: number;
};

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
    if (!Object.hasOwn(AGENT_OPTIONS, key ?? "") || !AGENT_OPTIONS[key as keyof AgentOptions].includes(value) || key in options) {
      throw new Error(`E_USAGE arm ${entry}: ${setting} is not one of ${JSON.stringify(AGENT_OPTIONS)}, or is set twice`);
    }
    options[key] = value;
  }
  return { name, ...options };
}

// Harbor reruns a trial only for these exception types, and deletes the trial directory first, so the
// list holds only failures that come before any model response: Harbor's environment start and agent
// setup timeouts, and LanebInfraError, which the agent raises when its session closed with no ok
// response (or when setup or the session open failed). Every other error, including teardown and
// verifier errors after paid work and the ledger cap stop, keeps its result. A plain RuntimeError from
// image build or container start is not rerun: the verifier raises the same type after paid work.
export const RETRY_ON = ["EnvironmentStartTimeoutError", "AgentSetupTimeoutError", "LanebInfraError"];

// Compose overlay for every trial's main container: no NET_RAW or NET_ADMIN, so no process in it can
// set SO_MARK to pass the egress sidecar or open AF_PACKET sockets below its rules. The agent's
// preflight refuses to start when either capability is still held.
export const CAPS_OVERLAY = "agent-caps.compose.yaml";

export function jobConfig(b: BatchSpec) {
  const agents = b.models.flatMap((m) =>
    b.arms.map((a) => ({
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
        wrapper_path: `${b.runner_dir}/prompt-wrapper.md`,
        max_output_tokens: b.max_output_tokens,
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
    retry: { max_retries: 2, include_exceptions: RETRY_ON },
    environment: { type: "docker", delete: true, extra_docker_compose: [`${b.runner_dir}/${CAPS_OVERLAY}`] },
    agents,
    tasks: b.tasks.map((t) => ({ path: `${b.tasks_dir}/${t}` })),
  };
}

if (import.meta.main) {
  const [specPath, outPath] = Bun.argv.slice(2);
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as BatchSpec;
  writeFileSync(outPath, JSON.stringify(jobConfig(spec), null, 2) + "\n");
  console.log(`wrote ${outPath}: ${spec.tasks.length} tasks x ${spec.models.length * spec.arms.length} agents x ${spec.attempts} attempts`);
}

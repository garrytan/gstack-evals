// Writes a Harbor JobConfig for one Lane B batch: every task x every (model, arm) agent.
// Harbor orders trials attempt-major, then task, then agent, so each task's arms run as
// a block and a cap stop leaves complete, paired blocks behind.
import { readFileSync, writeFileSync } from "node:fs";

export type BatchSpec = {
  job_name: string;
  tasks_dir: string;
  tasks: string[];
  models: { id: string; harbor_model: string; session_cap_usd: number }[];
  arms: { name: string; tar: string; sha256: string }[];
  attempts: number;
  n_concurrent: number;
  agent_dir: string;
  runner_dir: string;
  wrapper?: string;
  base_url: string;
  max_output_tokens: number;
  verifier_timeout_multiplier: number;
};

// Harbor's default no-retry list at f3a5a92, plus our ledger cap stop. A trial that fails for any
// other reason before it is graded (image build, container start, proxy unreachable) gets two reruns.
export const NO_RETRY = [
  "AgentTimeoutError", "VerifierTimeoutError", "RewardFileNotFoundError", "RewardFileEmptyError", "VerifierOutputParseError",
  "ApiUsageLimitError", "AgentSafetyRefusalError", "AgentAuthenticationError", "ModelNotFoundError", "UnsupportedModelParametersError",
  "LedgerCapStop",
];

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
        wrapper_path: `${b.runner_dir}/${b.wrapper ?? "prompt-wrapper.md"}`,
        max_output_tokens: b.max_output_tokens,
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
  console.log(`wrote ${outPath}: ${spec.tasks.length} tasks x ${spec.models.length * spec.arms.length} agents x ${spec.attempts} attempts`);
}

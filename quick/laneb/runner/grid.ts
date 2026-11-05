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
  repo_dir?: string;
  // The agent's turn ceiling (laneb_agent.py sdk_max_turns), when the cells file sets one; unset keeps the agent's 200.
  sdk_max_turns?: number;
};

// Agent options an arm may set, with laneb_agent.py's allowed values (SYSTEM_PROMPTS, SESSION_KINDS). An option
// left out keeps the agent's default (sdk-default, no session kind) and stays out of the kwargs, so a batch that sets
// none writes the same JobConfig as before.
// told takes a skill name rather than a value from a list: the agent opens the prompt with /<skill>.
// tar names the arm tar a labelled arm runs on (L1's before-u and before-t both run before.tar); it becomes tar_name, which
// prepare-run reads and the agent never sees. Unset, the tar is the arm's own name.
// procedure_line names a fixed line a told prompt ends with, after a blank line (R3 amendment 4, plan section 6); it needs
// told. PROCEDURE_LINES must equal prompt_builder.py's, byte for byte (a keyless test checks).
export const PROCEDURE_LINES = { "investigate-phases": "Work through /investigate's phases in order, and finish with its DEBUG REPORT." };
// closing_line names a fixed line any arm's prompt ends with, after a blank line and after a told arm's procedure line
// (R3 amendment 6, section 7: R3c's ROOT CAUSE FILES block). CLOSING_LINES must equal prompt_builder.py's and
// r3/r3c-rules.ts R3C.closingLine, byte for byte (a keyless test checks).
export const CLOSING_LINES = { "r3c-root-cause-files": "When you are done, end your last message with a ROOT CAUSE FILES block: a line that reads ROOT CAUSE FILES, then up to three file paths relative to the repository root, one per line, the file most likely to hold the root cause first." };
// gstack_hooks=copy runs the arm on laneb_hooks.LanebHooksAgent, which copies the gstack hook state out after the session
// (R3 amendment 5 section 9 item 2); it is not an agent kwarg.
export const AGENT_OPTIONS = { system_prompt: ["sdk-default", "claude-code-preset"], session_kind: ["unattended"], procedure_line: Object.keys(PROCEDURE_LINES), closing_line: Object.keys(CLOSING_LINES), gstack_hooks: ["copy"] };
export type AgentOptions = { system_prompt?: string; session_kind?: string; told?: string; procedure_line?: string; closing_line?: string; gstack_hooks?: string; tar_name?: string };
const SKILL_NAME = /^[a-z0-9][a-z0-9_-]*$/;

// One entry of prepare-run's arms list: <arm>[:<option>=<value>]..., for example
// gstack:told=investigate:system_prompt=claude-code-preset:session_kind=unattended.
export function armSpec(entry: string): { name: string } & AgentOptions {
  const [name, ...settings] = entry.split(":");
  const options: Record<string, string> = {};
  for (const setting of settings) {
    const [, key, value] = /^(\w+)=(.*)$/.exec(setting) ?? [];
    const allowed = key === "told" || key === "tar" ? SKILL_NAME.test(value ?? "") : Object.hasOwn(AGENT_OPTIONS, key ?? "") && AGENT_OPTIONS[key as keyof typeof AGENT_OPTIONS].includes(value);
    const field = key === "tar" ? "tar_name" : key;
    if (!allowed || field in options) {
      throw new Error(`E_USAGE arm ${entry}: ${setting} is not one of ${JSON.stringify(AGENT_OPTIONS)}, or is set twice`);
    }
    options[field] = value;
  }
  if (options.procedure_line && !options.told) throw new Error(`E_USAGE arm ${entry}: procedure_line needs told`);
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
      import_path: a.gstack_hooks === "copy" ? "laneb_hooks:LanebHooksAgent" : "laneb_agent:LanebAgent",
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
        ...(a.told ? { told_skill: a.told } : {}),
        ...(a.procedure_line ? { procedure_line: a.procedure_line } : {}),
        ...(a.closing_line ? { closing_line: a.closing_line } : {}),
        ...(b.repo_dir ? { repo_dir: b.repo_dir } : {}),
        ...(b.sdk_max_turns ? { sdk_max_turns: b.sdk_max_turns } : {}),
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

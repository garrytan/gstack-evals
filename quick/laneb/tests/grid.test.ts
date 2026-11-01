import { describe, expect, test } from "bun:test";
import { armSpec, jobConfig } from "../runner/grid.ts";
import { tb2TaskToml, TB2_AGENT_HOSTS } from "../runner/materialize.ts";

describe("grid", () => {
  test("one agent per model and arm, tasks in rank order, kwargs carry the arm and cap", () => {
    const job = jobConfig({
      job_name: "r1", tasks_dir: "/run/tasks", tasks: ["a", "b"], attempts: 1, n_concurrent: 4, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
      arms: [{ name: "none", tar: "/run/arms/none.tar", sha256: "a" }, { name: "gstack", tar: "/run/arms/gstack.tar", sha256: "b" }],
    });
    expect(job.agents.map((a) => a.kwargs.arm)).toEqual(["none", "gstack"]);
    expect(job.agents[1].kwargs).toMatchObject({ upstream_model: "claude-haiku-5-5", session_cap_usd: 1, skip_install: true, arm_tar: "/run/arms/gstack.tar", arm_sha256: "b" });
    expect(job.agents[0].kwargs.max_output_tokens).toBe(32000);
    expect(job.tasks).toEqual([{ path: "/run/tasks/a" }, { path: "/run/tasks/b" }]);
    expect(job.verifier_timeout_multiplier).toBe(2);
    expect(job.retry.max_retries).toBe(2);
    expect(job.retry.exclude_exceptions).toContain("LedgerCapStop");
    expect(job.retry.exclude_exceptions).toContain("AgentTimeoutError");
  });

  test("an arm's system prompt and session kind reach its kwargs only when set", () => {
    const spec = {
      job_name: "r1", tasks_dir: "/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 1, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [{ id: "particle-1", harbor_model: "anthropic/particle-1", session_cap_usd: 1 }],
      arms: [{ name: "none", tar: "/run/arms/none.tar", sha256: "a" }],
    };
    const arms = [armSpec("none:session_kind=unattended"), armSpec("gstack-render-unattended:system_prompt=claude-code-preset:session_kind=unattended")];
    const job = jobConfig({ ...spec, arms: arms.map((a) => ({ ...a, tar: `/run/arms/${a.name}.tar`, sha256: "a" })) });
    expect(job.agents[0].kwargs).not.toHaveProperty("system_prompt");
    expect(job.agents[0].kwargs).toMatchObject({ arm: "none", session_kind: "unattended" });
    expect(job.agents[1].kwargs).toMatchObject({ arm: "gstack-render-unattended", system_prompt: "claude-code-preset", session_kind: "unattended" });
    expect(JSON.stringify(jobConfig(spec))).toBe(JSON.stringify(jobConfig({ ...spec, arms: [{ ...spec.arms[0], ...armSpec("none") }] })));
    expect(armSpec("none:system_prompt=sdk-default")).toEqual({ name: "none", system_prompt: "sdk-default" });
    for (const bad of ["gstack:system_prompt=claude_code", "gstack:session_kind=", "gstack:session_kind=interactive", "gstack:model=x", "gstack:system_prompt", "gstack:session_kind=unattended:session_kind=unattended"]) {
      expect(() => armSpec(bad)).toThrow("E_USAGE");
    }
  });

  test("a model with only_arms gets just those arms, in arm order, after the full models", () => {
    const job = jobConfig({
      job_name: "r1", tasks_dir: "/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 4, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [
        { id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 },
        { id: "claude-opus-5-5", harbor_model: "anthropic/claude-opus-5-5", session_cap_usd: 5, only_arms: ["none"] },
      ],
      arms: [{ name: "none", tar: "/run/arms/none.tar", sha256: "a" }, { name: "gstack", tar: "/run/arms/gstack.tar", sha256: "b" }],
    });
    expect(job.agents.map((a) => `${a.kwargs.upstream_model}/${a.kwargs.arm}`)).toEqual(["claude-haiku-5-5/none", "claude-haiku-5-5/gstack", "claude-opus-5-5/none"]);
    expect(job.agents[2].kwargs).toMatchObject({ session_cap_usd: 5, invoke: false });
  });
});

describe("tb2 task.toml", () => {
  const original = 'version = "1.0"\n\n[metadata]\ncategory = "x"\n\n[verifier]\ntimeout_sec = 900.0\n\n[agent]\ntimeout_sec = 1800.0\n\n[environment]\nbuild_timeout_sec = 600.0\ndocker_image = "alexgshaw/x:20251031"\ncpus = 1\n';
  test("drops the prebuilt image, sets the agent allowlist and a public verifier", () => {
    const out = tb2TaskToml(original, "allowlist");
    expect(out).not.toContain("docker_image");
    expect(out).toContain('[agent]\ntimeout_sec = 1800.0\nnetwork_mode = "allowlist"\nallowed_hosts = [');
    expect(out).toContain('[verifier]\ntimeout_sec = 900.0\nnetwork_mode = "public"');
    for (const h of TB2_AGENT_HOSTS) expect(out).toContain(`"${h}"`);
    expect(out).not.toContain("github.com");
  });
  test("public mode for hosts without nftables inet", () => {
    expect(tb2TaskToml(original, "public")).toContain('[agent]\ntimeout_sec = 1800.0\nnetwork_mode = "public"\n');
  });
});

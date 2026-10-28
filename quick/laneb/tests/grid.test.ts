import { describe, expect, test } from "bun:test";
import { jobConfig } from "../runner/grid.ts";
import { tb2TaskToml, TB2_AGENT_HOSTS } from "../runner/materialize.ts";

describe("grid", () => {
  test("one agent per model and arm, tasks in rank order, kwargs carry the arm and cap", () => {
    const job = jobConfig({
      job_name: "r1", tasks_dir: "/run/tasks", tasks: ["a", "b"], attempts: 1, n_concurrent: 4, agent_dir: "/r/agent", runner_dir: "/r", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
      models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
      arms: [{ name: "none", tar: "/run/arms/none.tar" }, { name: "gstack", tar: "/run/arms/gstack.tar" }],
    });
    expect(job.agents.map((a) => a.kwargs.arm)).toEqual(["none", "gstack"]);
    expect(job.agents[1].kwargs).toMatchObject({ upstream_model: "claude-haiku-5-5", session_cap_usd: 1, skip_install: true, arm_tar: "/run/arms/gstack.tar" });
    expect(job.agents[0].kwargs.max_output_tokens).toBe(32000);
    expect(job.tasks).toEqual([{ path: "/run/tasks/a" }, { path: "/run/tasks/b" }]);
    expect(job.verifier_timeout_multiplier).toBe(2);
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

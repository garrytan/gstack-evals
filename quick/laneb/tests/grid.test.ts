import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armSpec, jobConfig, RETRY_ON } from "../runner/grid.ts";
import { tb2TaskToml, TB2_AGENT_HOSTS } from "../runner/materialize.ts";
import { ARM_SPECS } from "../l1/l1.ts";

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
  });

  const spec = {
    job_name: "r1", tasks_dir: "/run/tasks", tasks: ["a"], attempts: 1, n_concurrent: 1, agent_dir: "/vm/runner/agent", runner_dir: "/vm/runner", base_url: "http://__GATEWAY__:8787", max_output_tokens: 32000, verifier_timeout_multiplier: 2,
    models: [{ id: "claude-haiku-5-5", harbor_model: "anthropic/claude-haiku-5-5", session_cap_usd: 1 }],
    arms: [{ name: "none", tar: "/run/arms/none.tar", sha256: "a" }],
  };

  test("every L1 arm runs on the hooks agent, which writes l1-evidence.json, and gstack_hooks never reaches the kwargs", () => {
    const job = jobConfig({ ...spec, arms: Object.values(ARM_SPECS).map((e) => ({ ...armSpec(e), tar: "/run/arms/x.tar", sha256: "a" })) });
    expect(job.agents.map((a) => [a.kwargs.arm, a.import_path])).toEqual(Object.keys(ARM_SPECS).map((arm) => [arm, "laneb_hooks:LanebHooksAgent"]));
    expect(JSON.stringify(job.agents.map((a) => a.kwargs))).not.toContain("gstack_hooks");
  });

  test("an arm's system prompt and session kind reach its kwargs only when set", () => {
    const job = jobConfig({ ...spec, arms: [armSpec("none"), armSpec("gstack:system_prompt=claude-code-preset:session_kind=unattended")].map((a) => ({ ...a, tar: `/run/arms/${a.name}.tar`, sha256: "a" })) });
    expect(job.agents[0].kwargs).not.toHaveProperty("system_prompt");
    expect(job.agents[0].kwargs).not.toHaveProperty("session_kind");
    expect(job.agents[1].kwargs).toMatchObject({ arm: "gstack", system_prompt: "claude-code-preset", session_kind: "unattended" });
    expect(JSON.stringify(jobConfig(spec))).toBe(JSON.stringify(jobConfig({ ...spec, arms: [{ ...spec.arms[0], ...armSpec("none") }] })));
    expect(armSpec("none:system_prompt=sdk-default")).toEqual({ name: "none", system_prompt: "sdk-default" });
    for (const bad of ["gstack:system_prompt=claude_code", "gstack:session_kind=", "gstack:session_kind=interactive", "gstack:model=x", "gstack:system_prompt", "gstack:session_kind=unattended:session_kind=unattended", "gstack:constructor=x", "gstack:toString=x", "gstack:__proto__=x"]) {
      expect(() => armSpec(bad)).toThrow("E_USAGE");
    }
  });

  test("a judge arm's backend maps to the judge_backend kwarg only when set, and non-judge job.json stays byte-identical", () => {
    expect(armSpec("judge-jev:tar=judge:backend=jev")).toMatchObject({ name: "judge-jev", tar_name: "judge", backend: "jev" });
    expect(armSpec("judge-p1:backend=p1")).toMatchObject({ name: "judge-p1", backend: "p1" });
    for (const bad of ["x:backend=p2", "x:backend=", "x:backend=jev:backend=p1"]) expect(() => armSpec(bad)).toThrow("E_USAGE");
    const judged = jobConfig({ ...spec, arms: [{ ...armSpec("judge-jev:backend=jev:gstack_hooks=copy"), tar: "/run/arms/judge.tar", sha256: "a" }] });
    expect(judged.agents[0].kwargs).toMatchObject({ arm: "judge-jev", judge_backend: "jev" });
    expect(judged.agents[0].import_path).toBe("laneb_hooks:LanebHooksAgent");
    // A non-judge arm never carries backend/judge_backend, and setting backend=sdk-default is unknown, so its kwargs and
    // the whole job.json are byte-identical to before the backend option existed.
    const plain = jobConfig(spec);
    expect(JSON.stringify(plain)).not.toContain("judge_backend");
    expect(JSON.stringify(plain.agents[0].kwargs)).not.toContain("backend");
    expect(JSON.stringify(plain)).toBe(JSON.stringify(jobConfig({ ...spec, arms: [{ ...spec.arms[0], ...armSpec("none") }] })));
  });

  // Harbor f3a5a92 (trial/queue.py): with include_exceptions set, only those types are rerun, after the trial dir is deleted.
  test("Harbor reruns only failures that come before any model response", () => {
    const job = jobConfig(spec) as any;
    const retried = (type: string) => !(job.retry.exclude_exceptions ?? []).includes(type) && (!job.retry.include_exceptions || job.retry.include_exceptions.includes(type));
    for (const type of ["LanebInfraError", "EnvironmentStartTimeoutError", "AgentSetupTimeoutError"]) expect(retried(type)).toBe(true);
    for (const type of ["LedgerCapStop", "AgentTimeoutError", "VerifierTimeoutError", "RewardFileNotFoundError", "RuntimeError", "TimeoutExpired", "TimeoutError", "HttpStatusError"]) expect(retried(type)).toBe(false);
    const agent = readFileSync(join(import.meta.dir, "../runner/agent/laneb_agent.py"), "utf8");
    expect(agent).toContain("class LanebInfraError(Exception):");
    expect(RETRY_ON).toContain("LanebInfraError");
  });

  test("every trial's main container drops NET_RAW and NET_ADMIN through a compose overlay that keeps Harbor's networking", () => {
    const job = jobConfig(spec) as any;
    expect(job.environment.extra_docker_compose).toEqual(["/vm/runner/agent-caps.compose.yaml"]);
    const overlay = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../runner/agent-caps.compose.yaml"), "utf8")) as any;
    expect(Object.keys(overlay.services)).toEqual(["main"]);
    expect(overlay.services.main.cap_drop.sort()).toEqual(["NET_ADMIN", "NET_RAW"]);
    expect(overlay.services.main.network_mode).toBeUndefined();
    expect(overlay.services.main.networks).toBeUndefined();
  });

  test("smoke.sh and route-check.sh pass the same overlay to every harbor run", () => {
    for (const script of ["../runner/smoke.sh", "../runner/route-check.sh"]) {
      const text = readFileSync(join(import.meta.dir, script), "utf8");
      const runs = text.split("harbor run").length - 1;
      expect(runs).toBeGreaterThan(0);
      expect(text.split('--extra-docker-compose "$here/agent-caps.compose.yaml"').length - 1).toBe(runs);
    }
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

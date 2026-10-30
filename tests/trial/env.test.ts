import { describe, expect, test } from "bun:test";
import { checkSidecar } from "../../src/skill-eval/contract/sidecar.ts";
import { dockerEnvArgs, fixtureEnvProblem, ROLE_ENV, trialEnv, TrialEnvError } from "../../src/trial/env.ts";

const BEARER = "gse_" + "a".repeat(43);
const base = { PATH: "/usr/bin:/bin", HOME: "/home/agent", LANG: "C.UTF-8", TERM: "dumb", GSTACK_STATE_ROOT: "/work/t/.gstack-home", GSTACK_HOME: "/work/t/.gstack-home" };

describe("trial env allowlist", () => {
  // Value: protects=a credential-looking name that is not on its role's list never reaches a trial child; fails_when=GITHUB_PAT, NPM_TOKEN or AWS_SECRET_ACCESS_KEY passes as a task variable or a harness value; why_new=U5 left env a denylist that let GITHUB_PAT and NODE_OPTIONS through (Captain brief item 2); seam=fixtureEnvProblem, trialEnv; no_claim=what a host CLI reads on its own
  test("credential-looking and host-setting names are refused as task variables, in validate and at trial time", () => {
    for (const name of ["GITHUB_PAT", "NPM_TOKEN", "AWS_SECRET_ACCESS_KEY", "DB_PASSWORD", "DB_PASS", "SSH_AUTH_SOCK", "STRIPE_KEY", "OAUTH_CLIENT", "NODE_OPTIONS", "LD_PRELOAD", "BASH_ENV", "HTTPS_PROXY", "https_proxy", "GIT_SSH_COMMAND", "PYTHONPATH", "CLAUDE_CONFIG_DIR", "GSTACK_SESSION_KIND"]) {
      expect(fixtureEnvProblem(name)).toContain("looks like a credential or a host setting");
      expect(() => trialEnv("setup", base, [name], { [name]: "x" })).toThrow(TrialEnvError);
    }
    for (const name of ["HOME", "SKILL_EVAL_FIXTURES", "GSTACK_HOME"]) expect(fixtureEnvProblem(name)).toBe("is set by the trial itself");
    for (const name of ["RAILS_ENV", "NODE_ENV", "FIXTURE_MODE", "APP_PORT", "AUTHOR_NAME"]) expect(fixtureEnvProblem(name)).toBeNull();
    const problems = checkSidecar({ schema_version: 1, tasks: { t: { env: ["GITHUB_PAT", "NODE_OPTIONS", "RAILS_ENV"] } } }, [{ id: "t" }]);
    expect(problems).toEqual([
      "t: env name GITHUB_PAT looks like a credential or a host setting; those stay with the harness and the metering proxy",
      "t: env name NODE_OPTIONS looks like a credential or a host setting; those stay with the harness and the metering proxy",
    ]);
  });

  test("each role takes only its own names; a harness value off the list is refused and named", () => {
    expect(() => trialEnv("setup", { ...base, GITHUB_TOKEN: "x" })).toThrow("GITHUB_TOKEN is not on the setup env allowlist and looks like a credential");
    expect(() => trialEnv("check", { ...base, ANTHROPIC_BASE_URL: "http://172.18.0.2:8080" })).toThrow("ANTHROPIC_BASE_URL is not on the check env allowlist");
    expect(() => trialEnv("agent", { ...base, SKILL_EVAL_FIXTURES: "/fixtures" })).toThrow("SKILL_EVAL_FIXTURES is not on the agent env allowlist");
    expect(ROLE_ENV.agent).not.toContain("SKILL_EVAL_FIXTURES");
    expect(() => trialEnv("proxy", { PATH: "/usr/bin" }, ["RAILS_ENV"])).toThrow("the proxy takes no task variables");
    expect(trialEnv("setup", base, ["RAILS_ENV", "UNSET_ONE"], { RAILS_ENV: "test", OTHER: "leak" })).toEqual({ ...base, RAILS_ENV: "test" });
  });

  // Value: protects=the provider key lives only in the proxy, and the agent's key names carry a per-session bearer; fails_when=the real key reaches an agent, setup or check child under any name; why_new=new; seam=trialEnv; no_claim=the proxy's own scrubbing
  test("a provider key never enters a setup, agent or check child; the agent's key names need a session bearer", () => {
    const source = { ANTHROPIC_API_KEY: "sk-ant-real-key-0123456789" };
    expect(trialEnv("agent", { ...base, ANTHROPIC_API_KEY: BEARER, ANTHROPIC_BASE_URL: "http://172.18.0.2:8080", GSTACK_SESSION_KIND: "unattended" }, [], source).ANTHROPIC_API_KEY).toBe(BEARER);
    expect(() => trialEnv("agent", { ...base, ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY }, [], source)).toThrow("must carry a per-session bearer");
    expect(() => trialEnv("setup", { ...base, PATH: "/bin:" + source.ANTHROPIC_API_KEY }, [], source)).toThrow("holds a provider key");
    expect(() => trialEnv("check", base, ["APP_SECRET_FREE"], { APP_SECRET_FREE: "x" })).toThrow(TrialEnvError);
    expect(trialEnv("proxy", { PATH: "/usr/bin", ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY }, [], source).ANTHROPIC_API_KEY).toBe(source.ANTHROPIC_API_KEY);
  });

  test("docker gets credential values through its own env, never in its arguments", () => {
    const { args, clientEnv } = dockerEnvArgs({ HOME: "/home/agent", ANTHROPIC_API_KEY: BEARER });
    expect(args).toEqual(["-e", "HOME=/home/agent", "-e", "ANTHROPIC_API_KEY"]);
    expect(args.join(" ")).not.toContain(BEARER);
    expect(clientEnv).toEqual({ ANTHROPIC_API_KEY: BEARER });
  });
});

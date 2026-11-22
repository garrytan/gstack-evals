// Copyright (c) 2026 Garry Tan. MIT License.
// B2's prepare step (lanes/test-first/prepare-run.ts): a Sol part's agents become B2's Codex agent with the shared driver's
// argv and env (gpt-6.2-sol at effort low; hook trust and the unattended session kind in the gstack arms only), the arm
// manifest's digests and the typed skill only in the prove-it arm; every part gets B2's proxy config; and the wrong host's
// arms, an unknown kwarg or a told skill that is not the arm's are refused.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT, b2Run, codexAgent, hostOfModel, PROXY_CONFIG } from "../../lanes/test-first/prepare-run.ts";
import { GSTACK, sha256 } from "../../lanes/test-first/pins.ts";

const dir = mkdtempSync(join(tmpdir(), "b2-prep-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const base = (arm: string, told = "") => ({ name: "laneb-claude-code", import_path: "laneb_hooks:LanebHooksAgent", kwargs: { arm, arm_tar: "/arms/" + arm + ".tar", upstream_model: "gpt-6.2-sol", session_cap_usd: 5, max_output_tokens: 32000, sdk_max_turns: 200, system_prompt: "claude-code-preset", strip_snapshot: true, closing_line: "hm-status", ...(told ? { told_skill: told } : {}) } });
const manifest = { tree: { digest: "t".repeat(64) }, prompt_input: { sha256: "p".repeat(64) } };

describe("Codex agents", () => {
  test("a gstack arm runs Codex with hook trust and the unattended session kind", () => {
    const a = codexAgent(base("cx-gstack"), manifest), k = a.kwargs as Record<string, any>;
    expect([a.name, a.import_path]).toEqual([AGENT.name, AGENT.import_path]);
    expect(k.codex_argv).toContain("--dangerously-bypass-hook-trust");
    expect(k.codex_argv.slice(k.codex_argv.indexOf("-m"), k.codex_argv.indexOf("-m") + 2)).toEqual(["-m", "gpt-6.2-sol"]);
    expect(k.codex_argv).toContain('model_reasoning_effort="low"');
    expect(k.codex_env).toEqual({ OPENAI_API_KEY: "__SESSION_TOKEN__", GSTACK_SESSION_KIND: "unattended" });
    for (const argv of [k.codex_argv, k.codex_resume_argv]) expect(argv).toContain("allow_login_shell=false");
    expect([k.hook_trust, k.gstack_pin, k.arm_tree_sha256, k.prompt_input_sha256]).toEqual([true, GSTACK.sha, "t".repeat(64), "p".repeat(64)]);
    expect(["max_output_tokens", "sdk_max_turns", "system_prompt", "told_skill"].filter((x) => x in k)).toEqual([]);
  });
  test("a no-gstack arm gets neither, and the prove-it arm keeps its typed skill", () => {
    const k = codexAgent(base("cx-none"), manifest).kwargs as Record<string, any>;
    expect(k.codex_argv).not.toContain("--dangerously-bypass-hook-trust");
    expect(k.codex_argv).toContain("allow_login_shell=false");
    expect(k.codex_env).toEqual({ OPENAI_API_KEY: "__SESSION_TOKEN__" });
    expect([k.hook_trust, k.gstack_pin]).toEqual([false, ""]);
    expect((codexAgent(base("cx-prove-it", "prove-it"), manifest).kwargs as Record<string, any>).told_skill).toBe("prove-it");
  });
  test("refuses a Claude arm, an unknown kwarg and a told skill that is not the arm's", () => {
    expect(() => codexAgent(base("gstack"), manifest)).toThrow("E_B2_PREPARE");
    expect(() => codexAgent({ ...base("cx-none"), kwargs: { ...base("cx-none").kwargs, backend: "jev" } }, manifest)).toThrow("does not take: backend");
    expect(() => codexAgent(base("cx-prove-it"), manifest)).toThrow("told skill");
    expect(() => codexAgent(base("cx-gstack", "prove-it"), manifest)).toThrow("told skill");
  });
  test("each model's host", () => {
    expect([hostOfModel("claude-opus-5-5"), hostOfModel("gpt-6.2-sol"), hostOfModel("particle-1")]).toEqual(["claude", "codex", "claude"]);
    expect(() => hostOfModel("gpt-6.1-sol")).toThrow("E_B2_PREPARE");
  });
});

describe("run dirs", () => {
  const run = (agents: object[]) => {
    const d = mkdtempSync(join(dir, "run-"));
    writeFileSync(join(d, "job.json"), JSON.stringify({ agents }));
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ job: "b2-1" }));
    return d;
  };
  test("a Sol part's agents are rewritten from the committed manifests, and its proxy config recorded", () => {
    const d = run([base("cx-none"), base("cx-prove-it", "prove-it")]);
    b2Run(d, "codex");
    const job = JSON.parse(readFileSync(join(d, "job.json"), "utf8")), m = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
    expect(job.agents.map((a: any) => a.name)).toEqual([AGENT.name, AGENT.name]);
    const want = JSON.parse(readFileSync(join(import.meta.dir, "../../quick/laneb/arms/manifests/b2/cx-prove-it.json"), "utf8"));
    expect(job.agents[1].kwargs.arm_tree_sha256).toBe(want.tree.digest);
    expect(m.proxy_config_sha256).toBe(sha256(readFileSync(PROXY_CONFIG)));
    expect(m.b2.host).toBe("codex");
  });
  test("a Claude part keeps its agents, and a part naming the other host's arms is refused", () => {
    const d = run([base("none")]);
    b2Run(d, "claude");
    expect(JSON.parse(readFileSync(join(d, "job.json"), "utf8")).agents[0].name).toBe("laneb-claude-code");
    expect(() => b2Run(run([base("cx-none")]), "claude")).toThrow("arms of another host");
  });
});

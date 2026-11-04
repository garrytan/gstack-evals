// autoplan's frozen told invocation at gstack 699a41cb (G prereg section 4; O1) and its keyless configuration check.
// The parts that need no pin run always. The check itself runs the pin's own bin/gstack-session-kind and
// lib/autoplan-lean.ts, so it runs when OUTCOME_GSTACK_PIN names a checkout of 699a41cb (O5's dry run sets it).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTOPLAN_TOLD, checkAutoplanConfig, FROZEN_ENV, parseSlash, sessionEnv } from "../../lanes/outcome-skills/arms/autoplan.ts";
import { loadRegistry } from "../../lanes/outcome-skills/arms/registry.ts";

const IMAGE_ENV = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", CI: "true", GITHUB_ACTIONS: "true", GSTACK_SESSION_KIND: "unattended", GSTACK_CAPY: "1", GSTACK_HEADLESS: "1", CONDUCTOR_PORT: "1", OPENCLAW_SESSION: "x" };

describe("autoplan's told invocation, frozen", () => {
  test("the slash line is the registry's turn 2, with no kind flag; the kind is full, the session interactive, the outside voice a Claude subagent on the cell's model", () => {
    expect(AUTOPLAN_TOLD.slash as string).toBe(loadRegistry().arms["autoplan:told"]!.turns[1]!.text);
    expect(AUTOPLAN_TOLD).toMatchObject({ slash: "/autoplan PLAN.md", kind: "full", session_kind: "interactive", outside_voice: { provider: "claude-subagent", model: "claude-opus-5-5" }, gate_answer: { persona: "rec", prose: "Go with your recommendation." } });
    expect(AUTOPLAN_TOLD.phases).toEqual({ always: ["ceo", "eng"], design: "uiRequired", dx: "dxRequired", order: ["ceo", "design", "dx", "eng"], last: "eng" });
  });

  test("parseSlash takes the plan path and refuses any flag, a second argument or another skill", () => {
    expect(parseSlash("/autoplan PLAN.md")).toEqual({ plan: "PLAN.md", flags: [] });
    for (const line of ["/autoplan PLAN.md --kind feature", "/autoplan --full PLAN.md", "/autoplan PLAN.md --ceo-only", "/autoplan PLAN.md other.md", "/plan-eng-review PLAN.md", "/autoplan"]) expect(() => parseSlash(line)).toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG /);
  });

  test("the frozen variables are real_agent's, so the told arm runs the lane's frozen environment", () => {
    expect(readFileSync(join(import.meta.dir, "../../lanes/real-outcome/agent/real_agent.py"), "utf8")).toContain('FROZEN_ENV = r"' + FROZEN_ENV.source + '"');
  });

  test("sessionEnv drops every frozen variable the image sets and adds the agent's fixed variables", () => {
    const env = sessionEnv(IMAGE_ENV);
    for (const k of ["CI", "GITHUB_ACTIONS", "GSTACK_SESSION_KIND", "GSTACK_CAPY", "GSTACK_HEADLESS", "CONDUCTOR_PORT", "OPENCLAW_SESSION"]) expect([k, k in env]).toEqual([k, false]);
    expect(["OPENAI_API_KEY" in sessionEnv({ ...IMAGE_ENV, OPENAI_API_KEY: "x" }), "CODEX_HOME" in sessionEnv({ ...IMAGE_ENV, CODEX_HOME: "/x" })]).toEqual([false, false]);
    expect(env).toMatchObject({ HOME: "/root", CLAUDE_CONFIG_DIR: "/root/.claude", CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1", ANTHROPIC_MODEL: "claude-opus-5-5", CLAUDE_CODE_SUBAGENT_MODEL: "claude-opus-5-5", PATH: "/usr/local/bin:/usr/bin:/bin" });
  });
});

const PIN = process.env.OUTCOME_GSTACK_PIN ?? "";
describe.skipIf(!PIN || !existsSync(PIN + "/lib/autoplan-lean.ts"))("the configuration check on the pin's own code (OUTCOME_GSTACK_PIN)", () => {
  test("the arm's environment, from an image that sets every leaky variable, selects the full kind in an interactive session", async () => {
    const got = await checkAutoplanConfig({ pin: PIN, env: sessionEnv(IMAGE_ENV), codex: false });
    expect(got).toMatchObject({ ok: true, kind: "full", session_kind: "interactive", slash: "/autoplan PLAN.md", outside_voice: "claude-subagent", pin_sha: "699a41cb6808e01240d02e82247693f9170d401a" });
    expect(got.files).toEqual({ "bin/gstack-session-kind": expect.stringMatching(/^[0-9a-f]{64}$/), "lib/autoplan-lean.ts": expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  test("an environment the freeze never ran on selects the lean kind, and the check refuses it", async () => {
    await expect(checkAutoplanConfig({ pin: PIN, env: { ...IMAGE_ENV, HOME: "/root" }, codex: false })).rejects.toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG .*kind feature/);
    await expect(checkAutoplanConfig({ pin: PIN, env: { PATH: "/usr/bin:/bin", HOME: "/root", GSTACK_SESSION_KIND: "unattended" }, codex: false })).rejects.toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG .*session kind unattended/);
  });

  test("a kind flag in the slash line, a Codex on PATH or an OpenAI or Codex key is refused", async () => {
    await expect(checkAutoplanConfig({ pin: PIN, env: sessionEnv(IMAGE_ENV), slash: "/autoplan PLAN.md --kind feature", codex: false })).rejects.toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG /);
    await expect(checkAutoplanConfig({ pin: PIN, env: sessionEnv(IMAGE_ENV), codex: true })).rejects.toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG .*codex/);
    for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY"]) await expect(checkAutoplanConfig({ pin: PIN, env: { ...sessionEnv(IMAGE_ENV), [key]: "x" }, codex: false })).rejects.toThrow(new RegExp("^E_OUTCOME_AUTOPLAN_CONFIG .*" + key));
  });

  test("a checkout at another commit is refused", async () => {
    await expect(checkAutoplanConfig({ pin: import.meta.dir, env: sessionEnv(IMAGE_ENV), codex: false })).rejects.toThrow(/^E_OUTCOME_AUTOPLAN_CONFIG .*699a41cb/);
  });
});

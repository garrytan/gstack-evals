import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeEnv } from "../../src/adapters/claude-code/driver.ts";
import { hostDriver } from "../../src/adapters/host.ts";
import { cellFor, cellSettings, VOICES } from "../../src/arms/cells.ts";
import type { ArmInstall } from "../../src/arms/install.ts";
import { armCells, codexOption, slotModels } from "../../src/skill-eval/cli/run-host.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";

const policy = loadPolicy(DEFAULT_POLICY) as LoadedPolicy;
const OPUS = "claude-opus-5-5";
const FABLE = "claude-fable-5-2";
const CLI = { bin_dir: "/opt/codex-0.170.0/bin" };
const gstack = (name: string): ArmInstall => ({ name, layers: [], tree_sha256: "a".repeat(64), skill: null, gstack: ".claude/skills/gstack/bin/gstack-skill-start", plugins: [], provenance: { kind: "stack", stack: { repo: "garrytan/gstack", sha: "284214fd896f493471b1bb5e98bcdc899a87bcdb" } } });
const dir = () => mkdtempSync(join(tmpdir(), "gse-cells-"));

// Value: protects=a run that names no voice keeps today's cells byte for byte: VOICES' Opus voice, no voice on any other model, and the same cell tree, so no frozen run's session key moves; fails_when=cellFor without a voice adds a field, or a cell with no voice CLI changes its tree or codex setting; why_new=GEVA-590 item 1 (per-cell voices); seam=cellFor and cellSettings; no_claim=the Docker install
describe("cells without a chosen voice (keyless)", () => {
  test("cellFor(model) and its settings are what they were", () => {
    expect(VOICES).toEqual({ [OPUS]: "gpt-6.1-sol" });
    expect(cellFor(OPUS)).toEqual({ model: OPUS, voice: "gpt-6.1-sol" });
    expect(Object.keys(cellFor(FABLE))).toEqual(["model", "voice"]);
    expect(cellFor(FABLE)).toEqual({ model: FABLE, voice: null });
    const d = dir();
    const plain = cellSettings(gstack("gstack"), { model: OPUS, voice: "gpt-6.1-sol" }, d);
    expect(cellSettings(gstack("gstack"), cellFor(OPUS), d)).toEqual(plain);
    expect(plain.codex).toEqual({ model: "gpt-6.1-sol" });
    expect(plain.gstack_config).toEqual({ agent_model: "host", codex_reviews: "enabled" });
  });
});

// Value: protects=one run holds main reviewer by voice cells: a chosen voice replaces the default on any model, null drops it, the voice CLI rides in the codex setting and every choice moves the cell tree, so each cell keys apart; fails_when=a chosen voice is ignored on Fable, two voices share a tree, the CLI is lost on its way to the driver option, or a voiceless cell carries a CLI; why_new=GEVA-590 item 1; seam=cellFor, cellSettings, armCells, codexOption and slotModels; no_claim=the run loop, which rm-check.test.ts drives
describe("chosen voices (keyless)", () => {
  test("cellFor takes a voice and its CLI, and each choice changes the cell tree", () => {
    expect(cellFor(FABLE, "gpt-6.2-sol")).toEqual({ model: FABLE, voice: "gpt-6.2-sol" });
    expect(cellFor(OPUS, null)).toEqual({ model: OPUS, voice: null });
    expect(cellFor(OPUS, "gpt-6.2-astra", CLI)).toEqual({ model: OPUS, voice: "gpt-6.2-astra", voice_cli: CLI });
    expect(cellFor(OPUS, null, CLI)).toEqual({ model: OPUS, voice: null });
    const d = dir();
    const tree = (c: ReturnType<typeof cellFor>) => cellSettings(gstack("g"), c, d).tree_sha256;
    const trees = [cellFor(OPUS), cellFor(OPUS, "gpt-6.2-sol"), cellFor(OPUS, "gpt-6.2-sol", CLI), cellFor(OPUS, "gpt-6.2-astra", CLI), cellFor(OPUS, null)].map(tree);
    expect(new Set(trees).size).toBe(trees.length);
    expect(tree(cellFor(FABLE, "gpt-6.2-sol", CLI))).toBe(tree(cellFor(OPUS, "gpt-6.2-sol", CLI)));
    expect(cellSettings(gstack("g"), cellFor(FABLE, "gpt-6.2-astra", CLI), d).codex).toEqual({ model: "gpt-6.2-astra", cli: CLI });
  });

  test("armCells gives each named arm its voice on every model and the slot admits it", () => {
    const cells = armCells([gstack("gstack-sol"), gstack("gstack-astra"), gstack("gstack")], [OPUS, FABLE], policy, dir(), { voices: { "gstack-sol": "gpt-6.2-sol", "gstack-astra": "gpt-6.2-astra" }, voiceCli: CLI });
    expect(cells["gstack-sol"]![FABLE]!.codex).toEqual({ model: "gpt-6.2-sol", cli: CLI });
    expect(cells["gstack-astra"]![OPUS]!.codex).toEqual({ model: "gpt-6.2-astra", cli: CLI });
    expect(cells["gstack"]![OPUS]!.codex).toEqual({ model: "gpt-6.1-sol", cli: CLI });
    expect(cells["gstack"]![FABLE]!.codex).toBeNull();
    expect(codexOption(policy, cells["gstack-astra"]![FABLE]!)).toEqual({ provider: "openai", model: "gpt-6.2-astra", binDir: CLI.bin_dir });
    expect(slotModels(policy, FABLE, cells["gstack-sol"]![FABLE]!)).toEqual(["anthropic:" + FABLE, "openai:gpt-6.2-sol"]);
    const plain = armCells([gstack("gstack")], [OPUS], policy, dir());
    expect(codexOption(policy, plain["gstack"]![OPUS]!)).toEqual({ provider: "openai", model: "gpt-6.1-sol" });
    expect(() => armCells([gstack("g")], [OPUS], policy, dir(), { voices: { g: "gpt-9-nowhere" } })).toThrow("E_MODEL_POLICY");
  });
});

// Value: protects=the driver runs a named voice CLI first on PATH with GSTACK_CODEX_NO_SANDBOX=1 through hostDriver, and leaves a session without one as it was; fails_when=hostDriver drops codexNoSandbox, the PATH changes for a cell with no CLI, or the env sets the sandbox switch without a voice; why_new=GEVA-590 item 3 (the rig's codexNoSandbox, Codex 0.170.0 from the image's /opt dir); seam=claudeCodeEnv and hostDriver; no_claim=the Codex CLI itself, which rm-check.test.ts runs
describe("the voice CLI in the agent env (keyless)", () => {
  const proxy = { baseUrl: "http://127.0.0.1:9", slot: "s", token: "t" };
  test("PATH and the sandbox switch follow the cell", () => {
    const voiced = claudeCodeEnv({ model: OPUS, provider: "anthropic", proxy, codex: { provider: "openai", model: "gpt-6.2-sol", binDir: CLI.bin_dir }, codexNoSandbox: true });
    expect([voiced.PATH, voiced.GSTACK_CODEX_NO_SANDBOX, voiced.CLAUDE_CODE_SUBAGENT_MODEL]).toEqual([CLI.bin_dir + ":/usr/local/bin:/usr/bin:/bin", "1", OPUS]);
    const plain = claudeCodeEnv({ model: OPUS, provider: "anthropic", proxy, codex: { provider: "openai", model: "gpt-6.1-sol" } });
    expect("PATH" in plain || "GSTACK_CODEX_NO_SANDBOX" in plain).toBe(false);
    expect(claudeCodeEnv({ model: OPUS, provider: "anthropic", proxy, codexNoSandbox: true }).GSTACK_CODEX_NO_SANDBOX).toBeUndefined();
    const driver = hostDriver({ host: "claude", model: FABLE, provider: "anthropic", proxy, interactive: false, skill: null, out: dir(), codex: { provider: "openai", model: "gpt-6.2-astra", binDir: CLI.bin_dir }, codexNoSandbox: true, codexRollouts: true }) as unknown as { env: Record<string, string> };
    expect([driver.env.GSTACK_CODEX_NO_SANDBOX, driver.env.PATH, driver.env.ANTHROPIC_MODEL]).toEqual(["1", CLI.bin_dir + ":/usr/local/bin:/usr/bin:/bin", FABLE]);
  });
});

// Value: protects=the policy holds the review-models eval's models in the roles its prereg needs (Fable 5.2 as a subject outside smoke runs, both 6.2 voices with a Codex route, Astra as a labeller, Carbon as the judge on its OpenRouter route) and keeps every earlier entry; fails_when=Fable 5.2 is smoke-only, a 6.2 voice has no openai route, Carbon cannot judge, or Fable 5.1 leaves; why_new=GEVA-590 item 2; seam=policy/models.json and modelProblem; no_claim=prices, which the price table test covers
describe("the review-models eval's models in the default policy (keyless)", () => {
  test("Fable 5.2, the 6.2 voices and the Carbon judge pass, and Fable 5.1 stays smoke-only", () => {
    expect(modelProblem(policy, FABLE, "subject", { smoke: false })).toBeNull();
    for (const m of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
      expect(policy.policy.models[m]!.provider).toBe("openai");
      expect(modelProblem(policy, m, "subject", { smoke: false })).toBeNull();
    }
    expect(modelProblem(policy, "gpt-6.2-astra", "judge", { smoke: false })).toBeNull();
    expect(modelProblem(policy, "google/gemini-4-carbon", "judge", { smoke: false })).toBeNull();
    expect(policy.policy.models["google/gemini-4-carbon"]!.provider).toBe("openrouter");
    expect(modelProblem(policy, "claude-fable-5-1", "subject", { smoke: false })).toContain("only in smoke runs");
  });
});

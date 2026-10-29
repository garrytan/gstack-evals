import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { chatPrice } from "../../src/runner/pricing/prices.ts";
import { DEFAULT_POLICY, loadPolicy, modelProblem, ROLES, type LoadedPolicy } from "../../src/skill-eval/cli/policy.ts";
import { TMP } from "./helpers.ts";

const load = (path: string): LoadedPolicy => {
  const p = loadPolicy(path);
  if ("problem" in p) throw new Error(p.problem);
  return p;
};
const def = load(DEFAULT_POLICY);
const subject = (p: LoadedPolicy, model: string, smoke = false) => modelProblem(p, model, "subject", { smoke });
const judge = (p: LoadedPolicy, model: string) => modelProblem(p, model, "judge", { smoke: false });

function custom(name: string, models: Record<string, unknown>): LoadedPolicy {
  const path = join(TMP, name + ".json");
  writeFileSync(path, JSON.stringify({ ...def.policy, name, source: "a test policy", models }));
  return load(path);
}

describe("the default model policy", () => {
  // Value: protects=Garry's 2026-10-29 rulings: Sonnet 5.5 is a model under test and never a judge or adjudicator; fails_when=the default refuses a Sonnet subject or allows a Sonnet judge; why_new=no policy file existed; seam=none; no_claim=preflight's use of it (tests/cli/preflight.test.ts)
  test("it allows Sonnet 5.5 as a subject and refuses it as a judge, adjudicator or user simulator", () => {
    expect(subject(def, "claude-sonnet-5-5")).toBeNull();
    expect(judge(def, "claude-sonnet-5-5")).toContain("allows it only as subject");
    expect(modelProblem(def, "claude-sonnet-5-5", "adjudicator", { smoke: false })).toContain("allows it only as subject");
    expect(modelProblem(def, "claude-sonnet-5-5", "usersim", { smoke: false })).toContain("allows it only as subject");
  });

  // Value: protects=CREW.md's other model rules in the default: newest generation only, never gpt-5.4-mini, Fable only in smoke; fails_when=an older generation, gpt-5.4-mini or a non-smoke Fable passes; why_new=new; seam=none; no_claim=none beyond protects
  test("it refuses older generations, gpt-5.4-mini, and Fable outside smoke runs", () => {
    expect(subject(def, "claude-opus-5")).toContain("not in the policy");
    expect(subject(def, "claude-sonnet-4-6")).toContain("not in the policy");
    expect(subject(def, "gpt-5.4-mini")).toContain("Never gpt-5.4-mini");
    expect(judge(def, "gpt-5.4-mini")).toContain("Never gpt-5.4-mini");
    expect(subject(def, "claude-fable-5-1")).toContain("only in smoke runs");
    expect(subject(def, "claude-fable-5-1", true)).toBeNull();
    for (const m of ["claude-opus-5-5", "claude-haiku-5-5", "gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"]) expect(subject(def, m)).toBeNull();
    for (const m of ["claude-opus-5-5", "gpt-6.1-sol"]) expect(judge(def, m)).toBeNull();
  });

  // Value: protects=particle-1 is listed as a subject (GST-225) and is refused, with the reason, until the proxy can meter OpenRouter; fails_when=particle-1 passes while no price row or route exists, or is missing from the policy; why_new=new; seam=the proxy's OpenRouter route (M2a); no_claim=that particle-1 runs today
  test("it lists particle-1 as a subject, refused until the metering proxy can route OpenRouter", () => {
    expect(def.policy.models["particle-ai/particle-1"]).toEqual({ provider: "openrouter", roles: ["subject"] });
    expect(subject(def, "particle-ai/particle-1")).toContain("cannot route or price OpenRouter models yet");
  });

  // Value: protects=every model the default lets a run call can be held against a cap; fails_when=a row the policy allows has no price table row; why_new=new; seam=U3's price table; no_claim=prices are current
  test("every model it allows for any role, except OpenRouter's, has a price row, and its defaults are allowed", () => {
    for (const [id, m] of Object.entries(def.policy.models)) if (m.roles.length && m.provider !== "openrouter") expect(chatPrice(m.provider + ":" + id)).toBeDefined();
    for (const role of ["judge", "adjudicator"] as const) for (const model of Object.values(def.policy.defaults[role])) expect(modelProblem(def, model, role, { smoke: false })).toBeNull();
    expect(modelProblem(def, def.policy.defaults.usersim, "usersim", { smoke: false })).toBeNull();
    expect(ROLES).toEqual(["subject", "judge", "adjudicator", "usersim"]);
  });
});

describe("a caller's own policy", () => {
  // Value: protects=--policy lets another project narrow or widen the subject list (brief item 1, GST-225); fails_when=a custom policy cannot drop Sonnet or allow a model the default refuses; why_new=new; seam=none; no_claim=preflight's use (tests/cli/preflight.test.ts)
  test("it can narrow or widen the subject list", () => {
    const narrow = custom("narrow", { "claude-opus-5-5": { provider: "anthropic", roles: ["subject", "judge", "adjudicator"] }, "gpt-6.1-sol": { provider: "openai", roles: ["judge", "adjudicator", "usersim"] }, "gpt-6-luna": { provider: "openai", roles: ["usersim"] } });
    expect(subject(narrow, "claude-sonnet-5-5")).toContain("not in the policy");
    expect(subject(narrow, "claude-opus-5-5")).toBeNull();
    const wide = custom("wide", { ...def.policy.models, "gpt-5.5": { provider: "openai", roles: ["subject"] } });
    expect(subject(def, "gpt-5.5")).toContain("not in the policy");
    expect(subject(wide, "gpt-5.5")).toBeNull();
  });

  // Value: protects=the committed example for other projects loads and allows Sonnet as a subject only; fails_when=the example breaks the policy shape or lets Sonnet judge; why_new=new; seam=none; no_claim=none beyond protects
  test("policy/examples/gbrain.json loads, allows Sonnet as a subject and judges with Opus or gpt-6.1-sol", () => {
    const example = load(join(REPO_ROOT, "policy", "examples", "gbrain.json"));
    expect(subject(example, "claude-sonnet-5-5")).toBeNull();
    expect(judge(example, "claude-sonnet-5-5")).toContain("allows it only as subject");
    expect(judge(example, "claude-opus-5-5")).toBeNull();
    expect(subject(example, "claude-haiku-5-5")).toContain("not in the policy");
  });

  // Value: protects=a malformed policy is refused with the field that breaks it; fails_when=an unknown role, provider or key loads; why_new=new; seam=none; no_claim=none beyond protects
  test("a malformed policy is refused with the field that breaks it", () => {
    const bad = (name: string, v: unknown) => {
      const path = join(TMP, name + ".json");
      writeFileSync(path, typeof v === "string" ? v : JSON.stringify(v));
      const p = loadPolicy(path);
      return "problem" in p ? p.problem : "loaded";
    };
    expect(bad("not-json", "{")).toContain("not valid JSON");
    expect(bad("role", { ...def.policy, models: { x: { provider: "anthropic", roles: ["agent"] } } })).toContain("x: roles must be");
    expect(bad("provider", { ...def.policy, models: { x: { provider: "gemini", roles: [] } } })).toContain("x: provider must be");
    expect(bad("key", { ...def.policy, extra: 1 })).toContain("unknown key extra");
    expect(bad("defaults", { ...def.policy, defaults: { judge: { anthropic: "a" }, adjudicator: def.policy.defaults.adjudicator, usersim: "u" } })).toContain("defaults.judge must name a model");
    expect(loadPolicy(join(TMP, "missing.json"))).toMatchObject({ problem: expect.stringContaining("cannot read") });
  });
});

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveCall, runsRoot, type Call } from "../../src/skill-eval/cli/call.ts";
import { parseFlags, SKILL_EVAL_FLAGS, type ParsedFlags } from "../../src/skill-eval/cli/flags.ts";
import { DEFAULT_POLICY } from "../../src/skill-eval/cli/policy.ts";
import { tree } from "./helpers.ts";

const loose = tree({ "SKILL.md": "# demo\n\nNEVER guess.\n" });
const BASE = ["--arms", "before=" + loose + ",after=" + loose + ",none", "--tasks", join(loose, "tasks.json"), "--host", "claude", "--model", "claude-opus-5-5"];
const parsed = (argv: string[], env: Record<string, string> = {}): ParsedFlags => {
  const p = parseFlags(argv, SKILL_EVAL_FLAGS, env);
  if (typeof p === "string") throw new Error(p);
  return p;
};
const call = (argv: string[], env: Record<string, string> = {}, home = tree({ ".keep": "" })) => resolveCall(parsed(argv, env), env, home);
const ok = (argv: string[], env: Record<string, string> = {}, home?: string): Call => {
  const c = call(argv, env, home);
  if ("code" in c) throw new Error(c.code + " " + c.message);
  return c;
};

describe("effective defaults", () => {
  // Value: protects=every setting the caller did not give is filled from its default and printed with its source; fails_when=a default changes silently or loses its source line; why_new=new; seam=none; no_claim=none beyond protects
  test("defaults fill trials, the noise floor, isolation, timeout, policy and the judge, each with its source", () => {
    const c = ok(BASE);
    expect(c.trials).toBe(3);
    expect(c.noiseFloor).toBe(true);
    expect(c.arms.arms.map((a) => a.name)).toEqual(["before", "before2", "after", "none"]);
    expect(c.isolation).toBe("docker");
    expect(c.timeoutS).toBe(600);
    expect(c.policy.path).toBe(DEFAULT_POLICY);
    expect(c.judgeModel).toBe("gpt-6.1-sol");
    expect(c.usersimModel).toBe("gpt-6-luna");
    expect(c.spendCap).toBeNull();
    const by = Object.fromEntries(c.effective.map((s) => [s.name, s]));
    expect(by.trials).toEqual({ name: "trials", value: "3", source: "default" });
    expect(by["noise floor"]!.source).toContain("--no-noise-floor drops it");
    expect(by["judge model"]!.source).toBe("policy default for anthropic subjects");
    expect(by.out!.source).toStartWith("default: ");
    const codex = ok([...BASE.slice(0, 4), "--host", "codex", "--model", "gpt-6.1-sol", "--no-noise-floor", "--runs", "5", "--spend-cap", "2.5"]);
    expect(codex.judgeModel).toBe("claude-opus-5-5");
    expect(codex.arms.arms.map((a) => a.name)).toEqual(["before", "after", "none"]);
    expect(codex.trials).toBe(5);
    expect(codex.spendCap).toBe(2_500_000);
  });

  // Value: protects=the default <out> (brief item 2): the Capy work dir on Capy, else the XDG state dir, never the OS temp dir or the tasks repo; fails_when=the rule changes or out lands under the tasks file's repo; why_new=item 2 asked U7 to choose and document it; seam=none; no_claim=none beyond protects
  test("the default out is <state>/runs/<run id>: the Capy work dir on Capy, else XDG", () => {
    const capy = tree({ ".capy/work/.keep": "" });
    expect(runsRoot({}, capy).path).toBe(join(capy, ".capy", "work", "gstack-evals", "runs"));
    expect(runsRoot({ XDG_STATE_HOME: "/state" }, capy).path).toBe("/state/gstack-evals/runs");
    const plain = tree({ ".keep": "" });
    expect(runsRoot({}, plain).path).toBe(join(plain, ".local", "state", "gstack-evals", "runs"));
    const c = ok(BASE, {}, capy);
    expect(c.out.path.startsWith(join(capy, ".capy", "work", "gstack-evals", "runs", "demo-"))).toBe(false);
    expect(c.out.path).toStartWith(join(capy, ".capy", "work", "gstack-evals", "runs") + "/");
    expect(c.out.path).toMatch(/\/[a-z0-9-]+-\d{8}T\d{6}Z-[0-9a-f]{4}$/);
    expect(ok([...BASE, "--out", "/tmp/given"]).out).toEqual({ path: "/tmp/given", rule: "--out" });
  });

  // Value: protects=the effective block names the variable that chose the ledger and approval record, and a flag still wins over it; fails_when=an environment path is reported as --ledger or --ledger-record; why_new=PR #44 review finding; seam=U4's ledgerPath and recordPath; no_claim=none beyond protects
  test("ledger paths set by environment report the variable, and flags override it", () => {
    const env = { GSTACK_EVALS_LEDGER: "/env/ledger.sqlite", GSTACK_EVALS_LEDGER_RECORD: "/env/record" };
    const by = (c: Call) => Object.fromEntries(c.effective.map((s) => [s.name, s]));
    const fromEnv = by(ok(BASE, env));
    expect(fromEnv.ledger).toEqual({ name: "ledger", value: "/env/ledger.sqlite", source: "GSTACK_EVALS_LEDGER" });
    expect(fromEnv["ledger record"]).toEqual({ name: "ledger record", value: "/env/record", source: "GSTACK_EVALS_LEDGER_RECORD" });
    const fromFlag = by(ok([...BASE, "--ledger", "/flag/ledger.sqlite", "--ledger-record", "/flag/record"], env));
    expect(fromFlag.ledger).toEqual({ name: "ledger", value: "/flag/ledger.sqlite", source: "--ledger" });
    expect(fromFlag["ledger record"]).toEqual({ name: "ledger record", value: "/flag/record", source: "--ledger-record" });
  });

  // Value: protects=a call missing a required flag, using an unbuilt flag, or naming a bad policy is refused before anything runs; fails_when=one of these passes resolveCall; why_new=new; seam=none; no_claim=none beyond protects
  test("missing required flags, unbuilt flags and a bad policy are refused", () => {
    expect(call(BASE.slice(0, 6))).toMatchObject({ code: "E_USAGE", message: expect.stringContaining("needs --model") });
    expect(call([...BASE, "--resume", "/x"])).toMatchObject({ code: "E_USAGE", message: "--resume is not built yet (U10)" });
    expect(call([...BASE, "--policy", "/no/such/policy.json"])).toMatchObject({ code: "E_MODEL_POLICY", message: expect.stringContaining("cannot read the policy file") });
    expect(call([...BASE.slice(0, 6), "--model", "a,a"])).toMatchObject({ code: "E_USAGE", message: "--model names a model twice" });
  });
});

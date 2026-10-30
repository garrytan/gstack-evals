import { describe, expect, test } from "bun:test";
import { flagHelp, parseFlags, SKILL_EVAL_FLAGS, unbuiltFlags, type ParsedFlags } from "../../src/skill-eval/cli/flags.ts";

const parse = (argv: string[], env: Record<string, string> = {}) => parseFlags(argv, SKILL_EVAL_FLAGS, env);
const ok = (argv: string[], env: Record<string, string> = {}) => {
  const p = parse(argv, env);
  if (typeof p === "string") throw new Error(p);
  return p as ParsedFlags;
};

describe("the skill-eval flag table", () => {
  // Value: protects=the flag table is the one machine-readable source U21 reads, and it covers every flag interface v0.4 names; fails_when=a call flag is missing, renamed or given two rows; why_new=no table existed; seam=none; no_claim=the schema U21 generates
  test("it holds every flag of the interface's call once, each with a summary and an owner", () => {
    const names = SKILL_EVAL_FLAGS.map((f) => f.name);
    const call = ["--arms", "--tasks", "--host", "--model", "--trials", "--spend-cap", "--out", "--dry-run", "--calibrate", "--tasks-only"];
    const extensions = ["--base", "--skill", "--ext", "--policy", "--smoke", "--no-noise-floor", "--ledger", "--ledger-record", "--isolation", "--parallel", "--timeout", "--judge-model", "--margin", "--resume", "--repair", "--mirror", "--arms-file", "--json"];
    for (const name of [...call, ...extensions, "--item", "--example"]) expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of SKILL_EVAL_FLAGS) {
      expect(f.summary.length).toBeGreaterThan(10);
      expect(f.owner).toMatch(/^U\d+$/);
      if (f.kind === "enum" || f.kind === "optional-enum") expect(f.values?.length).toBeGreaterThan(0);
    }
    expect(SKILL_EVAL_FLAGS.find((f) => f.name === "--trials")).toMatchObject({ aliases: ["--runs"], default: 3 });
  });

  // Value: protects=values, aliases, = forms, lists and variables parse into canonical names with their source; fails_when=--runs stops aliasing --trials, --flag=value breaks, or a variable overrides a flag; why_new=new parser; seam=none; no_claim=none beyond protects
  test("it parses values, aliases, the = form, lists and variables", () => {
    const p = ok(["--runs", "5", "--model=claude-opus-5-5,gpt-6.1-sol", "--dry-run", "--item", "flag-item", "--spend-cap", "12.50"], { GSTACK_EVALS_ITEM: "env-item", GSTACK_EVALS_LEDGER: "/l.sqlite" });
    expect(p.values.get("--trials")).toBe(5);
    expect(p.values.get("--model")).toEqual(["claude-opus-5-5", "gpt-6.1-sol"]);
    expect(p.values.get("--dry-run")).toBe(true);
    expect(p.values.get("--item")).toBe("flag-item");
    expect(p.from.get("--item")).toBe("flag");
    expect(p.values.get("--ledger")).toBe("/l.sqlite");
    expect(p.from.get("--ledger")).toBe("GSTACK_EVALS_LEDGER");
    expect(p.values.get("--spend-cap")).toBe("12.50");
  });

  // Value: protects=--example takes a mode only after =, so the next argument is never swallowed; fails_when=--example eats a following flag or accepts an unknown mode; why_new=the only optional-enum flag; seam=none; no_claim=none beyond protects
  test("--example takes its mode only after =", () => {
    expect(ok(["--example"]).values.get("--example")).toBe(true);
    expect(ok(["--example=safety", "--json"]).values.get("--example")).toBe("safety");
    expect(ok(["--example", "--json"]).values.get("--json")).toBe(true);
    expect(parse(["--example=bogus"])).toContain("--example takes one of miss, safety, unopened, not-measurable, cap-stop");
  });

  // Value: protects=bad calls are refused with the first problem; fails_when=an unknown flag, a repeat, a missing or malformed value passes; why_new=new parser; seam=none; no_claim=none beyond protects
  test("it refuses unknown, repeated, valueless and malformed flags", () => {
    expect(parse(["--bogus"])).toContain("unknown flag");
    expect(parse(["stray"])).toContain("unexpected argument");
    expect(parse(["--trials", "3", "--runs", "4"])).toBe("--trials given twice");
    expect(parse(["--tasks"])).toBe("--tasks needs a value");
    expect(parse(["--dry-run=yes"])).toBe("--dry-run takes no value");
    expect(parse(["--trials", "0"])).toContain("a positive whole number");
    expect(parse(["--host", "gemini"])).toContain("one of claude, codex");
    expect(parse(["--spend-cap", "-3"])).toContain("a positive dollar amount");
    expect(parse(["--model", "a,,b"])).toContain("no empty entries");
    expect(parse([], { GSTACK_EVALS_ITEM: "" })).not.toBeString();
  });

  // Value: protects=a flag whose owner has not built it parses but is reported, and help says so; fails_when=--arms-file runs silently before U9 builds it; why_new=new; seam=none; no_claim=none beyond protects
  test("unbuilt flags are reported with their owner, and help marks them", () => {
    expect(unbuiltFlags(ok(["--arms-file", "/arms.json", "--calibrate"])).map((f) => f.name + " " + f.owner)).toEqual(["--arms-file U9"]);
    const help = flagHelp(SKILL_EVAL_FLAGS);
    expect(help).toContain("not built yet: U9");
    expect(help).toContain("env GSTACK_EVALS_ITEM");
    expect(help).toContain("--trials, --runs <int>");
  });
});

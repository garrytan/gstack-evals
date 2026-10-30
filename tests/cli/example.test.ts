import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../src/cli.ts";
import { EXAMPLES } from "../../src/skill-eval/cli/example.ts";
import { skillEvalCommand } from "../../src/skill-eval/cli/skill-eval.ts";
import { collect, TMP } from "./helpers.ts";

const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schema", "verdict.schema.json"), "utf8"));
const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
const valid = ajv.compile(schema);
const bin = join(REPO_ROOT, "bin", "gstack-evals");

const EXPECTED: Record<string, { exit: number; verdict: string; reason: string | null }> = {
  pass: { exit: 0, verdict: "PASS", reason: null },
  miss: { exit: 1, verdict: "FAIL", reason: "MISS runs-tests" },
  safety: { exit: 1, verdict: "FAIL", reason: "SAFETY asks-before-delete" },
  unopened: { exit: 1, verdict: "FAIL", reason: "UNOPENED" },
  "not-measurable": { exit: 2, verdict: "INCOMPLETE", reason: "NOT_MEASURABLE 2 informative tasks" },
  "cap-stop": { exit: 2, verdict: "INCOMPLETE", reason: "CAP_STOP" },
};

describe("skill-eval --example", () => {
  // Value: protects=the done-means: every example mode writes a real verdict.json through U6's engine, valid against the schema, and exits with U6's code in under 10 s; fails_when=a mode exits a code its verdict does not carry, writes an invalid verdict, or its about line promises another outcome; why_new=--example is new; seam=bin/gstack-evals; no_claim=what a real model does
  test("every mode writes a valid verdict.json and exits with its verdict's code, in under 10 s", () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [mode, want] of Object.entries(EXPECTED)) {
      const out = join(TMP, "example-" + mode);
      const started = Date.now();
      const r = spawnSync(bin, ["skill-eval", mode === "pass" ? "--example" : "--example=" + mode, "--out", out], { encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: TMP } });
      // gstack-timing-ok: the interface promises every --example mode in under 10 seconds
      expect(Date.now() - started).toBeLessThan(10_000);
      const verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
      expect([mode, valid(verdict) ? [] : valid.errors]).toEqual([mode, []]);
      expect([mode, r.status, verdict.exit_code, verdict.verdict]).toEqual([mode, want.exit, want.exit, want.verdict]);
      if (want.reason) expect(verdict.reasons).toContain(want.reason);
      else expect(verdict.reasons).toEqual([]);
      expect(r.stdout).toContain("example " + mode + ": ");
      expect(r.stdout).toContain(EXAMPLES[mode as keyof typeof EXAMPLES].about);
      expect(r.stdout).toContain("VERDICT: " + want.verdict + " (exit " + want.exit + ")");
      expect(verdict.harness).toMatchObject({ host: "claude", host_version: "fake" });
    }
  });

  // Value: protects=a cap stop prints the interface's STOP line and keeps complete paired cells; fails_when=the STOP line is missing or a partial round is kept; why_new=new; seam=U6's CAP_STOP; no_claim=the metering proxy's own stop
  test("cap-stop prints the STOP line and keeps two complete rounds", async () => {
    const io = collect();
    expect(await skillEvalCommand(["--example=cap-stop", "--out", join(TMP, "cap")], io, {})).toBe(2);
    expect(io.text().out).toContain("STOP: reason=budget_exhausted spent=$4.80 reserved=$0.00 unknown=0 cap=$5.00");
    const verdict = JSON.parse(readFileSync(join(TMP, "cap", "verdict.json"), "utf8"));
    expect(verdict.spend).toMatchObject({ committed: 4_800_000, cap: 5_000_000 });
    for (const arms of Object.values(verdict.tasks) as Record<string, unknown[]>[]) for (const runs of Object.values(arms)) expect(runs).toHaveLength(2);
  });

  // Value: protects=--json prints the verdict alone on stdout, and --example refuses flags it would ignore; fails_when=stdout mixes text into the JSON or a run flag is silently dropped; why_new=new; seam=none; no_claim=none beyond protects
  test("--json prints only the verdict, and other flags are refused", async () => {
    const io = collect();
    expect(await skillEvalCommand(["--example=miss", "--json", "--out", join(TMP, "json")], io, {})).toBe(1);
    expect(JSON.parse(io.text().out)).toMatchObject({ verdict: "FAIL", exit_code: 1 });
    const bad = collect();
    expect(await skillEvalCommand(["--example", "--trials", "5"], bad, {})).toBe(2);
    expect(bad.text().err).toContain("E_USAGE skill-eval: --example takes only --out and --json; drop --trials");
  });
});

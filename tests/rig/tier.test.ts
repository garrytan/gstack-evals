import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeTier, junitCases, keylessEnv, runTier, tierAnnotation, tierCase, TIER_FILE, type TierRecord } from "../../src/rig/tier.ts";
import { git, scratchRepo } from "./helpers.ts";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="4">
  <testsuite name="tests/trial/network.test.ts" file="tests/trial/network.test.ts">
    <testsuite name="the trial network" file="tests/trial/network.test.ts">
      <testcase name="the agent&apos;s egress is closed" classname="the trial network" />
      <testcase name="a skipped Docker case" classname="the trial network">
        <skipped />
      </testcase>
    </testsuite>
  </testsuite>
  <testsuite name="tests/rig/pins.test.ts" file="tests/rig/pins.test.ts">
    <testcase name="fails &lt;here&gt;" classname=""><failure type="AssertionError" /></testcase>
    <testcase name="passes" classname="" />
  </testsuite>
</testsuites>
`;

describe("the Docker tier (U20)", () => {
  test("junit cases are keyed file > describe > test with their status", () => {
    expect(junitCases(XML)).toEqual([
      { key: "tests/trial/network.test.ts > the trial network > the agent's egress is closed", status: "pass" },
      { key: "tests/trial/network.test.ts > the trial network > a skipped Docker case", status: "skip" },
      { key: "tests/rig/pins.test.ts > fails <here>", status: "fail" },
      { key: "tests/rig/pins.test.ts > passes", status: "pass" },
    ]);
  });

  test("a skipped or failing case, an absent expected file or a bad exit makes the tier red", () => {
    const cases = junitCases(XML);
    expect(judgeTier(cases, ["tests/trial/network.test.ts", "tests/rig/probes.test.ts"], 1)).toEqual([
      "the tier's tests exited 1",
      "expected, and absent from the report: tests/rig/probes.test.ts",
      "skipped: tests/trial/network.test.ts > the trial network > a skipped Docker case",
      "failed: tests/rig/pins.test.ts > fails <here>",
    ]);
    const passing = cases.filter((c) => c.status === "pass");
    expect(judgeTier(passing, ["tests/trial/network.test.ts", "tests/rig/pins.test.ts > passes"], 0)).toEqual([]);
    expect(judgeTier([], [], null)).toEqual(["the tier's tests exited without a status (killed or timed out)", "the JUnit report holds no test case"]);
  });

  test("stage m1b of gate/manifest.json runs the Docker tests with GSTACK_EVALS_DOCKER=1 and expects every rig test file", () => {
    const c = tierCase();
    expect(c.run).toStartWith("GSTACK_EVALS_DOCKER=1 bun test ");
    for (const dir of ["./tests/trial", "./tests/adapters", "./tests/proxy", "./tests/rig"]) expect(c.run).toContain(" " + dir + " ");
    for (const f of ["admission", "entry", "pins", "rig-probes", "tier"]) expect(c.tests).toContain("tests/rig/" + f + ".test.ts");
  });

  test("the tier runs keyless and writes a record bound to the commit, tree and recipe; the annotation carries its summary", () => {
    const r = scratchRepo();
    dirs.push(r.root);
    mkdirSync(join(r.root, "gate"));
    const junit = (body: string) => "<testsuites><testsuite name=\"tests/rig/x.test.ts\">" + body + "</testsuite></testsuites>";
    const manifest = (run: string) => JSON.stringify({ schema: 1, stages: { m0: [{ id: "unit", kind: "command", run: "true" }], m1b: [{ id: "docker-tier", kind: "junit", run, tests: ["tests/rig/x.test.ts"] }] }, gate_surface: ["gate/**"] });
    const write = (body: string, keyCheck = false) => {
      const env = keyCheck ? 'test -z "$ANTHROPIC_API_KEY" && test -z "$SOME_TOKEN" && ' : "";
      writeFileSync(join(r.root, "gate", "manifest.json"), manifest(env + "printf '%s' '" + junit(body) + "' > \"$GATE_JUNIT\""));
      git(r.root, "add", "-A");
      git(r.root, "commit", "-qm", "manifest");
    };
    const out = () => {
      const d = mkdtempSync(join(tmpdir(), "gse-tier-out-"));
      dirs.push(d);
      return d;
    };
    write('<testcase name="a" /><testcase name="b"><skipped /></testcase>');
    const red = runTier({ out: out(), root: r.root });
    expect(red).toMatchObject({ verdict: "RED", counts: { pass: 1, fail: 0, skip: 1 }, problems: ["skipped: tests/rig/x.test.ts > b"], clean: true });
    const before = { a: process.env.ANTHROPIC_API_KEY, t: process.env.SOME_TOKEN };
    process.env.ANTHROPIC_API_KEY = "x";
    process.env.SOME_TOKEN = "x";
    try {
      write('<testcase name="a" />', true);
      const dir = out();
      const green = runTier({ out: dir, root: r.root });
      expect(green).toMatchObject({ verdict: "GREEN", head_sha: git(r.root, "rev-parse", "HEAD"), tree: git(r.root, "rev-parse", "HEAD^{tree}"), clean: true, exit_code: 0, problems: [], recipe_sha256: r.recipe });
      expect(JSON.parse(readFileSync(join(dir, TIER_FILE), "utf8"))).toEqual(green);
      writeFileSync(join(r.root, "dirty.txt"), "x\n");
      expect(runTier({ out: out(), root: r.root }).clean).toBe(false);
      expect(keylessEnv().ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      for (const [k, v] of [["ANTHROPIC_API_KEY", before.a], ["SOME_TOKEN", before.t]] as const) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  }, 30_000);

  test("the annotation is one workflow command line holding the summary", () => {
    const t = { schema: 1, kind: "rig-tier", stage: "m1b", head_sha: "a".repeat(40), tree: "b".repeat(40), clean: true, recipe_sha256: "c".repeat(64), recipe: {}, verdict: "GREEN", exit_code: 0, counts: { pass: 1, fail: 0, skip: 0 }, problems: ["50% done\nnext"], started_at: "", finished_at: "" } as unknown as TierRecord;
    const line = tierAnnotation(t);
    expect(line).toStartWith("::notice title=gstack-evals-rig-tier::{");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice(line.indexOf("::{") + 2))).toEqual({ schema: 1, kind: "rig-tier", stage: "m1b", verdict: "GREEN", head_sha: t.head_sha, tree: t.tree, clean: true, recipe_sha256: t.recipe_sha256, counts: t.counts });
    expect(TIER_FILE).toBe("rig-tier.json");
    expect(readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "rig.yml"), "utf8")).toContain("rig tier --out");
  });
});

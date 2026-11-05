// The outcome-skills driver's keyless dry run (lanes/outcome-skills/driver/dryrun.ts), with each planted fault first:
// every --seed must fail at the check it targets, with Z1 still printed after it, and the run without a seed must end
// DRYRUN: ok. It needs the real pinned SDK (REAL_OUTCOME_PYTHON, as tests/real-outcome/agent.test.ts) and Docker, and
// it takes about two minutes a run, so it runs only with GSTACK_EVALS_DRYRUN=1.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PYTHON = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const HAS_SDK = existsSync(PYTHON) && spawnSync(PYTHON, ["-c", "import claude_agent_sdk, harbor; assert claude_agent_sdk.__version__ == '0.2.174'"]).status === 0;
const HAS_DOCKER = spawnSync("docker", ["info"]).status === 0;
const DRYRUN = join(import.meta.dir, "../../lanes/outcome-skills/driver/dryrun.ts");
const TARGET: Record<string, string> = {
  u1: "FAIL U1 ",
  u2: "FAIL U2 ",
  u3: "FAIL U3 ",
  u4: "FAIL U4 ",
  u5: "FAIL U5 ",
  u6: "FAIL U6 ",
  u7: "FAIL U7 ",
  "l7-extra": "FAIL L7 ",
  "l7-missing": "FAIL L7 ",
  "l7-swap": "FAIL L7 ",
  "l7-cache-rate": "FAIL L7 ",
  "z1-container": "FAIL Z1 no leftovers",
  "z1-volume": "FAIL Z1 no leftovers",
  "z1-lease": "FAIL Z1 no leftovers",
  "z1-after-fail": "FAIL Z1 seed",
  "u8-turns": "FAIL U8 ",
  "u8-parent": "FAIL U8 ",
};

const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [DRYRUN, ...args], { encoding: "utf8", timeout: 900_000 });
  return { code: r.status, out: r.stdout + r.stderr, lines: r.stdout.split("\n").filter(Boolean) };
};

describe.skipIf(!HAS_SDK || !HAS_DOCKER || process.env.GSTACK_EVALS_DRYRUN !== "1")("the driver's keyless dry run", () => {
  for (const [seed, target] of Object.entries(TARGET)) {
    test("--seed " + seed + " fails at " + target.slice(5).trim() + ", and Z1 still prints after it", () => {
      const r = run("--seed", seed);
      const fails = r.lines.filter((l) => l.startsWith("FAIL "));
      if (!fails[0]?.startsWith(target)) console.log(r.out);
      expect(fails[0]).toStartWith(target);
      const z1 = r.lines.findIndex((l) => / Z1 no leftovers/.test(l));
      expect(z1).toBeGreaterThan(r.lines.indexOf(fails[0]!) - (target.includes("Z1 no leftovers") ? 1 : 0));
      expect(r.lines.at(-1)).toBe("DRYRUN: fail");
      expect(r.code).toBe(1);
    }, 900_000);
  }

  test("without a seed every check passes and it ends DRYRUN: ok", () => {
    const r = run();
    if (r.code !== 0) console.log(r.out);
    expect(r.lines.filter((l) => l.startsWith("FAIL "))).toEqual([]);
    for (const check of ["U1 ", "U2 ", "U3 ", "U4 ", "U5 ", "U6 ", "U7 ", "U8 ", "U1b ", "L7 ", "R1 ", "R2 ", "R3 ", "R4 ", "Z1 no leftovers"]) expect(r.lines.some((l) => l.startsWith("PASS " + check))).toBe(true);
    expect(r.lines.at(-1)).toBe("DRYRUN: ok");
    expect(r.code).toBe(0);
  }, 900_000);
});

// The real-outcome agent's parts. unit_test.py runs anywhere with python3 (the Agent SDK and Harbor are stubbed only so
// the agent module imports): the ship persona, the /ship step log, the egress rules and the turn texts. egress_test.py
// writes the rules into a real container's namespace and probes them from inside; it runs in the Docker tier
// (GSTACK_EVALS_DOCKER=1), as the rig's other Docker tests do.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const run = (file: string, env: Record<string, string> = {}, timeout = 120_000) => {
  const r = spawnSync("python3", [join(import.meta.dir, file)], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env }, encoding: "utf8", timeout });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) console.log(out);
  return { status: r.status, out };
};

test("ship persona, /ship step log, egress rules and turn texts", () => {
  const r = run("unit_test.py");
  expect(r.out).not.toContain("FAIL");
  expect(r.out.match(/^PASS /gm)?.length).toBe(12);
  expect(r.status).toBe(0);
});

describe.skipIf(process.env.GSTACK_EVALS_DOCKER !== "1")("the egress rules on real Docker (GSTACK_EVALS_DOCKER=1)", () => {
  test("only the allowed address and port open; no DNS, no UDP, and no way to remove the rules from inside", () => {
    const r = run("egress_test.py", { REAL_BUN: process.execPath }, 600_000);
    expect(r.out).not.toContain("FAIL");
    expect(r.out.match(/^PASS /gm)?.length).toBe(6);
    expect(r.status).toBe(0);
  }, 660_000);
});

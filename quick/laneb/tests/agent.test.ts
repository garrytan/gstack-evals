import { expect, test } from "bun:test";
import { join } from "node:path";

// The agent and simulator tests are Python (agent_test.py), with Harbor and the Agent SDK stubbed out.
test("agent teardown, retry signal, evidence location, capability preflight and simulator", () => {
  const r = Bun.spawnSync(["python3", join(import.meta.dir, "agent_test.py")], { env: { ...process.env, PYTHONPATH: join(import.meta.dir, "../runner/agent") } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) console.log(out);
  expect(out).not.toContain("FAIL");
  expect(r.exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { join } from "node:path";

// B2's Codex agent (quick/laneb/runner/agent/laneb_b2_codex.py), in Python on part R's fake-docker harness (agent_b2_codex_test.py).
test("the B2 Codex agent types the prove-it arm's prompt and leaves the others unchanged", () => {
  const r = Bun.spawnSync(["python3", join(import.meta.dir, "agent_b2_codex_test.py")], { env: { ...process.env, PYTHONPATH: join(import.meta.dir, "../../quick/laneb/runner/agent") } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) console.log(out);
  expect(out).not.toContain("FAIL");
  expect(out).toContain("pass test_a_told_arm_sends_the_prompt_typed_and_logs_its_digest");
  expect(r.exitCode).toBe(0);
}, 120_000);

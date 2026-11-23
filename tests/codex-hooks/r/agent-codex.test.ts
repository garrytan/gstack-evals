import { expect, test } from "bun:test";
import { join } from "node:path";

// Lane B's Codex agent for part R (quick/laneb/runner/agent/laneb_codex.py), in Python with Harbor and the Agent SDK
// stubbed and a fake docker playing Codex (agent_codex_test.py).
test("the Codex agent's session, questions, timeout, records and teardown", () => {
  const r = Bun.spawnSync(["python3", join(import.meta.dir, "agent_codex_test.py")], { env: { ...process.env, PYTHONPATH: join(import.meta.dir, "../../../quick/laneb/runner/agent") } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) console.log(out);
  expect(out).not.toContain("FAIL");
  expect(out).toContain("pass test_an_agent_timeout_kills_codex_closes_the_session_and_starts_no_resume");
  expect(r.exitCode).toBe(0);
}, 120_000);

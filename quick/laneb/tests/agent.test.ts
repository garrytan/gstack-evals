import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The agent and simulator tests are Python (agent_test.py), with Harbor and the Agent SDK stubbed out.
test("agent teardown, retry signal, evidence location, capability preflight and simulator", () => {
  const r = Bun.spawnSync(["python3", join(import.meta.dir, "agent_test.py")], { env: { ...process.env, PYTHONPATH: join(import.meta.dir, "../runner/agent") } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) console.log(out);
  expect(out).not.toContain("FAIL");
  expect(r.exitCode).toBe(0);
});

// The system prompt and session kind tests (agent_sdk_test.py) run the real Agent SDK at the pin in
// runner/vm-bootstrap.sh, installed once into a venv under the temp dir, with only Harbor stubbed.
test("system prompt and session kind options under the real pinned Agent SDK", () => {
  const pin = readFileSync(join(import.meta.dir, "../runner/vm-bootstrap.sh"), "utf8").match(/^SDK_PIN=(\S+)$/m)![1];
  const venv = join(tmpdir(), `laneb-claude-agent-sdk-${pin}`);
  const python = join(venv, "bin/python");
  if (!existsSync(python) || Bun.spawnSync([python, "-c", `import claude_agent_sdk as s; assert s.__version__ == "${pin}"`]).exitCode !== 0) {
    const install = Bun.spawnSync(["sh", "-c", 'python3 -m venv --clear "$1" && "$1/bin/pip" install -q "claude-agent-sdk==$2"', "sh", venv, pin]);
    if (install.exitCode !== 0) console.log(install.stdout.toString() + install.stderr.toString());
    expect(install.exitCode).toBe(0);
  }
  const r = Bun.spawnSync([python, join(import.meta.dir, "agent_sdk_test.py")], { env: { ...process.env, PYTHONPATH: join(import.meta.dir, "../runner/agent") } });
  const out = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0) console.log(out);
  expect(out).not.toContain("FAIL");
  expect(out).toContain("pass test_the_claude_code_preset_sends_no_system_prompt_flag");
  expect(r.exitCode).toBe(0);
}, 600_000);

// The real-outcome lane's Harbor agent (lanes/real-outcome/agent) on the real pinned Agent SDK and Harbor, keyless:
// agent_test.py drives it against a stub Claude Code and a sandbox sidecar in its own process. It needs a Python with
// claude-agent-sdk 0.2.174 and Harbor at f3a5a92 (REAL_OUTCOME_PYTHON, default ~/.capy/work/real/venv/bin/python) and
// skips without one, as the adapter tests skip without the Claude Code CLI. Provider keys are removed from its env.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PYTHON = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const HAS_SDK = existsSync(PYTHON) && spawnSync(PYTHON, ["-c", "import claude_agent_sdk, harbor; assert claude_agent_sdk.__version__ == '0.2.174'"]).status === 0;
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK)_[A-Z_]*KEY$|_TOKEN$/;

describe.skipIf(!HAS_SDK)("the two-turn agent on the real pinned Agent SDK, with a stub Claude Code and a real sandbox", () => {
  const tmp = mkdtempSync(join(tmpdir(), "real-agent-sidecar-"));
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let control = "";
  beforeAll(async () => {
    proc = Bun.spawn([process.execPath, join(import.meta.dir, "../../bin/gstack-evals"), "real", "sandbox", "serve", "--root", tmp, "--agent-host", "127.0.0.1", "--agent-port", "0", "--control-port", "0"], { stdout: "pipe", stderr: "inherit" });
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    let text = "";
    while (!text.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    control = text.match(/control=(\S+)/)?.[1] ?? "";
  });
  afterAll(() => {
    proc?.kill();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("waits for quiet between turns, freezes the env, keeps Claude Code's system prompt and ships through the sandbox", () => {
    expect(control).toStartWith("http://127.0.0.1:");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
    const r = spawnSync(PYTHON, [join(import.meta.dir, "agent_test.py")], { env: { ...env, PYTHONDONTWRITEBYTECODE: "1", REAL_SIDECAR: control, REAL_NODE: process.execPath }, encoding: "utf8", timeout: 240_000 });
    const out = r.stdout + r.stderr;
    if (r.status !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^PASS /gm)?.length).toBe(9);
    expect(r.status).toBe(0);
  }, 300_000);
});

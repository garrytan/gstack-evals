// Copyright (c) 2026 Garry Tan. MIT License.
// pf_agent.PfAgent on the real pinned Agent SDK and Harbor, keyless: pf_agent_sdk_test.py drives two-turn sessions against a
// stub Claude Code, a stand-in docker and a stub of the driver's control plane, in its own process. It needs a Python with
// claude-agent-sdk 0.2.174 and Harbor at f3a5a92 (REAL_OUTCOME_PYTHON, default ~/.capy/work/real/venv/bin/python) and skips
// without one, as tests/real-outcome/agent.test.ts does. Provider keys are removed from its env.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PYTHON = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const HAS_SDK = existsSync(PYTHON) && spawnSync(PYTHON, ["-c", "import claude_agent_sdk, harbor; assert claude_agent_sdk.__version__ == '0.2.174'"]).status === 0;
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;

describe.skipIf(!HAS_SDK)("the PF agent on the real pinned Agent SDK, with a stub Claude Code and a stub driver", () => {
  test("two turns on their own slots, the wrap-up rerun, the tree refusal, a wrap-up stopped at its allowance, an E_ALLOWANCE refusal that is no stop, a failed proxy finalize in either turn, an upstream task end that skips the wrap-up and an allowance stop that does not, a failed close sent again and one never answered in either turn, cap stops on either open, post-turn failures routed to the arm or the harness, a failed bundle, a step that times out and a failing keep", () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
    const r = spawnSync(PYTHON, [join(import.meta.dir, "pf_agent_sdk_test.py")], { env: { ...env, PYTHONDONTWRITEBYTECODE: "1" }, encoding: "utf8", timeout: 240_000 });
    const out = r.stdout + r.stderr;
    if (r.status !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    expect(out.match(/^PASS /gm)?.length).toBe(21);
    expect(r.status).toBe(0);
  }, 300_000);
});

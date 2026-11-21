// Copyright (c) 2026 Garry Tan. MIT License.
// Part S's Codex session loop (ext/h2h_codex.py) on the real pinned Codex CLI 0.170.0, keyless: h2hx_codex_test.py drives
// sessions through a link named sol-agent against a local stand-in for the Responses API, with no container. It needs a
// Python with claude-agent-sdk 0.2.174 (REAL_OUTCOME_PYTHON, default ~/.capy/work/real/venv/bin/python, which h2h_turns
// imports) and the unpacked Codex binary (H2HX_CODEX_DIR, default the cache ext/runtimes.ts codexFiles fills), and skips
// without either. Provider keys are removed from its env.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RESERVATION_RETRY_AFTER_S } from "../../src/runner/proxy/metering-proxy.ts";

const PYTHON = process.env.REAL_OUTCOME_PYTHON ?? join(homedir(), ".capy/work/real/venv/bin/python");
const CODEX_DIR = process.env.H2HX_CODEX_DIR ?? join(homedir(), ".cache/h2h-runtimes/codex-0.170.0");
const HAS = existsSync(PYTHON) && existsSync(join(CODEX_DIR, "codex")) && spawnSync(PYTHON, ["-c", "import claude_agent_sdk; assert claude_agent_sdk.__version__ == '0.2.174'"]).status === 0;
const KEYS = /^(ANTHROPIC|OPENAI|OPENROUTER|UBICLOUD|GEMINI|GOOGLE|XAI|DEEPSEEK|TYPESAFE)_[A-Z_]*KEY$|_TOKEN$/;

describe.skipIf(!HAS)("part S's Codex loop on the real pinned Codex CLI against a stub Responses API", () => {
  test("the agent sends s-* arms to the Codex loop and every other arm to Claude Code; a session done in one turn, continuations to the cap, an async question answered on the same thread, a sync question counted unanswered, two scripted turns on one thread, CI unset, a policy failure as a refusal, a reservation-bound 429 retried in the turn, a failed generations lookup that still closes the slot, the wall limit, hooks under the trust bypass, the pack's config kept and a clash refused before the slot, and the home, tree and binary checks", () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.test(k))) as Record<string, string>;
    const r = spawnSync(PYTHON, [join(import.meta.dir, "h2hx_codex_test.py")], { env: { ...env, PYTHONDONTWRITEBYTECODE: "1", H2HX_CODEX_DIR: CODEX_DIR }, encoding: "utf8", timeout: 540_000 });
    const out = r.stdout + r.stderr;
    if (r.status !== 0) console.log(out);
    expect(out).not.toContain("FAIL");
    const want = Number(out.match(/^TESTS (\d+)$/m)?.[1]);
    expect(want).toBeGreaterThan(0);
    expect(out.match(/^PASS /gm)?.length).toBe(want);
    expect(r.status).toBe(0);
  }, 600_000);
});

test("the Codex loop waits the metering proxy's own retry-after before it retries a reservation-bound 429", () => {
  const py = readFileSync(join(import.meta.dir, "../../lanes/outcome-skills/h2h/ext/h2h_codex.py"), "utf8");
  expect(py).toContain("\nRESERVATION_RETRY_AFTER_S = " + RESERVATION_RETRY_AFTER_S + "\n");
});

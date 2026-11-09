// Copyright (c) 2026 Garry Tan. MIT License.
// The in-container decision-routing agent's parts. agent_unit_test.py runs anywhere with python3: when mini-swe-agent
// is not importable it writes a small stand-in for mini's agent loop first, so the parser, the state trims, the
// defer rule in every cell, the loop guards, the action counter, the call backstop, relevance fan-out, the synthetic
// message protocol and the allowance mapping all run keyless. The real tier runs the same file with a venv holding
// mini-swe-agent 2.4.6, litellm, anthropic, openai and typesafe-sdk 0.7.5 (DR_DEV_VENV_PYTHON), against a local fake
// proxy, and adds the litellm and SDK 403 paths and one routed session end to end.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FILE = join(import.meta.dir, "agent_unit_test.py");
const VENV_PY = process.env.DR_DEV_VENV_PYTHON ?? join(homedir(), ".cache", "decision-routing", "venv-dev", "bin", "python");

const run = (python: string, env: Record<string, string> = {}) => {
  const r = spawnSync(python, [FILE], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...env }, encoding: "utf8", timeout: 600_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0) console.log(out);
  return { status: r.status, out };
};

test("dr_agent units on python3 (mini stand-in when mini is not installed)", () => {
  const r = run("python3");
  expect(r.out).not.toContain("FAIL");
  const tier = r.out.match(/^tier (\w+)/m)?.[1];
  expect(r.out.match(/^PASS /gm)?.length).toBe(tier === "real" ? 41 : 38);
  expect(r.status).toBe(0);
}, 660_000);

describe.skipIf(!existsSync(VENV_PY))("dr_agent on the real mini 2.4.6, litellm and SDKs (dev venv)", () => {
  test("real tier: litellm and SDK 403 paths, one routed session end to end", () => {
    const r = run(VENV_PY, { DR_TEST_TIER: "real" });
    expect(r.out).not.toContain("FAIL");
    expect(r.out.match(/^PASS /gm)?.length).toBe(41);
    expect(r.status).toBe(0);
  }, 660_000);
});

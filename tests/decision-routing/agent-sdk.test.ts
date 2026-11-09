// Copyright (c) 2026 Garry Tan. MIT License.
// B9: runs sdk_test.py (the real pinned SDKs against the stub proxy, and N and R sessions end to end once
// dr_agent.session exists) with the runtime venv's own interpreter. Keyless. Skipped when the runtime venv is missing; point
// DR_RUNTIME_VENV at a venv built by lanes/decision-routing/agent/runtime/build.sh (default /opt/dr/venv).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const venv = process.env.DR_RUNTIME_VENV ?? "/opt/dr/venv";
const python = join(venv, "bin/python");
const here = import.meta.dir;
const missing = !existsSync(python);

function runPython(script: string): { code: number; out: string } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", LITELLM_LOCAL_MODEL_COST_MAP: "True" };
  const res = Bun.spawnSync([python, "-I", join(here, script)], { env, stdout: "pipe", stderr: "pipe" });
  return { code: res.exitCode ?? -1, out: res.stdout.toString() + res.stderr.toString() };
}

describe.skipIf(missing)("decision-routing real-SDK tier", () => {
  test(
    "pinned mini, litellm, anthropic, openai and typesafe-sdk behave as the lane assumes",
    () => {
      const { code, out } = runPython("sdk_test.py");
      if (code !== 0) console.error(out.slice(-4000));
      expect(code).toBe(0);
      expect(out).toMatch(/\nOK/);
    },
    300_000,
  );
});

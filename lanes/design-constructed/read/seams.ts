// Copyright (c) 2026 Garry Tan. MIT License.
// The read area's seams: what it takes from outside its own folder as injected functions. Integration wires the real
// pieces (a process runner for power.py, the run area's session rows); the dry run and tests pass invented ones.
import type { GstackArm, Model } from "../types.ts";

/** Runs power.py --design on a file and returns its exit code and output. The real one runs uv with the pinned numpy. */
export type PowerRunner = (script: string, designPath: string) => { code: number; stdout: string; stderr: string };

/** The run area's count, per arm and model, of arm stops whose attempt held a block before it stopped (plan section 6). */
export type ArmStopCounts = () => ReadonlyArray<{ model: Model; arm: GstackArm | "none" | "lens"; armStops: number; heldBlock: number }>;

/** The real runner: power.py under uv with numpy 2.3.4, as the prereg's run line gives it. */
export const uvPowerRunner: PowerRunner = (script, designPath) => {
  const p = Bun.spawnSync(["uv", "run", "--with", "numpy==2.3.4", "python", script, "--design", designPath], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
};

// Copyright (c) 2026 Garry Tan. MIT License.
// Plan section 6.1: the inventory before the task turn and the session-end commit after it (sh/capture.sh). The session
// runner runs the script in the session container; this module runs it on a host dir (tests, dry run) and reads its
// output. Force-captured paths are counted per arm.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pfFail } from "./prereg.ts";

export const CAPTURE_SH = join(import.meta.dir, "sh", "capture.sh");
/** The frozen build-output directories, left out at any depth (the script's find list holds the same names). */
export const BUILD_OUTPUT = ["target", "build", "out", "dist", "bin", "obj", "node_modules", ".venv", "venv", "__pycache__", ".gradle", ".pytest_cache", ".tox", ".mypy_cache", ".cache", "CMakeFiles", "cmake-build-*"] as const;

export interface Capture { changed: number; deleted: number; forced: string[]; head: string }

export function readCapture(stdout: string): Capture {
  const m = stdout.match(/^PF_CAPTURE changed=(\d+) deleted=(\d+) forced=(\d+) head=([0-9a-f]{40})$/m);
  if (!m) return pfFail("E_PF_CAPTURE", "the session-end commit printed no PF_CAPTURE line: " + stdout.slice(-300));
  const forced = [...stdout.matchAll(/^PF_FORCED (.+)$/gm)].map((x) => x[1]!);
  if (forced.length !== Number(m[3])) pfFail("E_PF_CAPTURE", "the forced count does not match the forced paths printed");
  return { changed: Number(m[1]), deleted: Number(m[2]), forced, head: m[4]! };
}

const sh = (args: string[]) => {
  const r = spawnSync("bash", [CAPTURE_SH, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) pfFail("E_PF_CAPTURE", "capture.sh " + args[0] + " exited " + r.status + ": " + (r.stderr ?? "").slice(-300));
  return r.stdout;
};
export const inventoryLocal = (repo: string): string => sh(["inventory", repo]);
export const commitLocal = (repo: string, inventory: string): Capture => readCapture(sh(["commit", repo, inventory]));

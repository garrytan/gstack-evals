// Copyright (c) 2026 Garry Tan. MIT License.
// Image prefetch (lanes/decision-routing/host/prefetch.ts) against a stub docker: every pristine image a plan needs is
// pulled once before the first session, images already present are skipped, pulls are spaced under Docker Hub's 100 an
// hour, and a pull refused for the rate limit waits the window out and pulls again without spending a retry.

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PULL_SPACING_MS, RATE_WINDOW_MS, imagesFor, prefetch } from "../../lanes/decision-routing/host/prefetch.ts";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tasks(map: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "dr-prefetch-"));
  dirs.push(dir);
  for (const [task, image] of Object.entries(map)) {
    mkdirSync(join(dir, task, "environment"), { recursive: true });
    writeFileSync(join(dir, task, "environment", "Dockerfile"), "FROM " + image + "\nRUN true\n");
  }
  return dir;
}

function stub(script: { present?: string[]; limited?: number; fail?: string } = {}) {
  const calls: string[] = [];
  let limited = script.limited ?? 0;
  return {
    calls,
    run: async (args: string[]) => {
      calls.push(args.join(" "));
      if (args[0] === "image") return { code: script.present?.includes(args[2]!) ? 0 : 1, stdout: "", stderr: "" };
      if (args[1] === script.fail) return { code: 1, stdout: "", stderr: "manifest unknown" };
      if (limited > 0) {
        limited--;
        return { code: 1, stdout: "", stderr: "Error response from daemon: toomanyrequests: You have reached your unauthenticated pull rate limit." };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

const plan = [
  { task: "a", cell: "N", model: "opus", item: "dr-calibration" },
  { task: "a", cell: "N", model: "sol", item: "dr-calibration" },
  { task: "b", cell: "N", model: "opus", item: "dr-calibration" },
  { task: "c", cell: "N", model: "opus", item: "dr-calibration" },
] as const;

test("one image per distinct task image, in plan order", () => {
  const dir = tasks({ a: "org/a:1", b: "org/b:1", c: "org/a:1" });
  expect(imagesFor([...plan], dir)).toEqual(["org/a:1", "org/b:1"]);
});

test("skips present images, spaces pulls, and waits out a rate-limit refusal without spending a retry", async () => {
  const dir = tasks({ a: "org/a:1", b: "org/b:1", c: "org/c:1" });
  const docker = stub({ present: ["org/a:1"], limited: 2 });
  const sleeps: number[] = [];
  const r = await prefetch([...plan], dir, { docker, sleep: async (ms) => void sleeps.push(ms), log: () => {} });
  expect(r).toEqual({ present: ["org/a:1"], pulled: ["org/b:1", "org/c:1"], waits: 2 });
  expect(docker.calls.filter((c) => c.startsWith("pull"))).toEqual(["pull org/b:1", "pull org/b:1", "pull org/b:1", "pull org/c:1"]);
  expect(sleeps).toEqual([RATE_WINDOW_MS, RATE_WINDOW_MS, PULL_SPACING_MS]);
  expect(PULL_SPACING_MS).toBeGreaterThanOrEqual(36_000);
});

test("a pull that fails for another reason stops with the image named", async () => {
  const dir = tasks({ a: "org/a:1", b: "org/b:1" });
  await expect(prefetch([...plan].slice(0, 3), dir, { docker: stub({ fail: "org/b:1" }), sleep: async () => {}, log: () => {} })).rejects.toThrow("org/b:1");
});

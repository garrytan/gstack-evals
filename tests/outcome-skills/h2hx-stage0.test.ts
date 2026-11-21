// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 0's container cleanup (ext/stage0.ts oneRun): a launch that fails after docker run leaves no container behind.
// Needs Docker and any local image with sleep and sh; skipped where there is none, or when running as root (the failure
// is planted as a home file the docker CLI cannot read).
import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oneRun } from "../../lanes/outcome-skills/h2h/ext/stage0.ts";

const docker = (args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
const image = docker(["images", "-q"]).stdout?.split("\n").find(Boolean) ?? null;
const root = process.getuid?.() === 0;
const W = mkdtempSync(join(tmpdir(), "h2hx-stage0-"));
const volume = "h2hx-stage0-test-" + crypto.randomUUID().slice(0, 8);
afterAll(() => {
  docker(["volume", "rm", "-f", volume]);
  rmSync(W, { recursive: true, force: true });
});
const stage0Containers = () => new Set(docker(["ps", "-aq", "--filter", "name=h2hx-stage0-"]).stdout.split("\n").filter(Boolean));

test.skipIf(!image || root)("a stage 0 run that fails after docker run removes its container", async () => {
  docker(["volume", "create", volume]);
  const home = join(W, "home");
  spawnSync("mkdir", ["-p", home]);
  writeFileSync(join(home, "unreadable"), "x");
  chmodSync(join(home, "unreadable"), 0o000);
  const before = stage0Containers();
  await expect(oneRun("link", { arm: "s-gstack", home, out: join(W, "out"), image: image!, volume, pathEnv: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" })).rejects.toThrow(/could not copy .* into the stage 0 container/);
  const left = [...stage0Containers()].filter((c) => !before.has(c));
  expect(left).toEqual([]);
}, 180_000);

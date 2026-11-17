// Value: protects=the RAM-backed HOME and /tmp the day-one sessions get: they seed and take writes when the runner is not root.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerSandbox } from "../../src/trial/sandbox.ts";

const image = spawnSync("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}", "gstack-evals-trial"], { encoding: "utf8" }).stdout?.split("\n").find((l) => l.trim()) ?? null;

describe.skipIf(!image || process.getuid?.() === 0)("docker sandbox ram", () => {
  test("a non-root runner's agent gets a seeded RAM-backed HOME and /tmp it owns", () => {
    const work = mkdtempSync(join(tmpdir(), "sandbox-ram-"));
    try {
      const sandbox = dockerSandbox({ trialImage: image! });
      const dirs = sandbox.homePath(work) + " /tmp";
      const session = sandbox.agent("app", { work, env: {}, ram: { size: "64m" } });
      try {
        const r = session.exec("for d in " + dirs + "; do touch $d/x; done && stat -c %u " + dirs + " && df -P " + dirs + " | awk 'NR > 1 { print $1 }'", 60_000);
        expect(r.exitCode).toBe(0);
        expect(r.stdout.trim().split("\n")).toEqual([String(process.getuid!()), String(process.getuid!()), "tmpfs", "tmpfs"]);
      } finally {
        session.stop();
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 180_000);
});

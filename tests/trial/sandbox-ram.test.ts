// Value: protects=the RAM-backed HOME and /tmp the day-one sessions get: they seed and take writes when the runner is not root.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Value: protects=a gstack arm's session: its image's HOME holds the whole install (1.2 GB for /autoplan's arm), and seeding it into the RAM-backed HOME must stream it, not hold it in memory; fails_when=the seed buffers the home archive (Node's spawnSync limit refused anything over 1 GiB, so every A session failed before its agent started) or swallows a failed copy; why_new=the day-one smoke, where all three A review sessions failed to seed their home; seam=dockerSandbox's agent with ram; no_claim=the real docker daemon, which the test above covers
describe("seeding a RAM-backed home", () => {
  /** A docker client: run -d and rm exit 0, run ... -cf - . writes the bytes in ./size, exec ... -xf - counts what it reads into ./received and exits with ./x-exit. */
  const stub = (dir: string, size: number, xExit = 0): string => {
    const bin = join(dir, "docker");
    writeFileSync(join(dir, "size"), String(size));
    writeFileSync(join(dir, "x-exit"), String(xExit));
    writeFileSync(bin, '#!/bin/sh\nPATH=/usr/bin:/bin\nd=$(dirname "$0")\ncase "$1" in\n  run) for a in "$@"; do [ "$a" = -cf ] && exec head -c "$(cat "$d/size")" /dev/zero; done; exit 0;;\n  exec) for a in "$@"; do [ "$a" = -xf ] && { wc -c > "$d/received"; exit "$(cat "$d/x-exit")"; }; done; cat > /dev/null; exit 0;;\nesac\nexit 0\n');
    chmodSync(bin, 0o755);
    return bin;
  };

  test("streams a home larger than 1 GiB into the container, and refuses a copy that fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "sandbox-seed-"));
    try {
      const size = 1_200_000_000;
      const session = dockerSandbox({ trialImage: "img", docker: stub(dir, size) }).agent("app", { work: dir, env: {}, ram: { size: "2g" } });
      expect(Number(readFileSync(join(dir, "received"), "utf8").trim())).toBe(size);
      session.stop();
      expect(() => dockerSandbox({ trialImage: "img", docker: stub(dir, 1000, 2) }).agent("app", { work: dir, env: {}, ram: { size: "2g" } })).toThrow("could not seed the agent's RAM-backed home");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

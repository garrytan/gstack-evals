// Copyright (c) 2026 Garry Tan. MIT License.
// Part B with Docker (GSTACK_EVALS_DOCKER=1): a local registry:2 store by digest (push, has, pull, assertStored), and the
// browser conditions in a real container (the 2 GB /dev/shm, the read-only wrapper mount, the launcher env).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extraArgs } from "../../lanes/outcome-skills/statemachines/testrun.ts";
import { docker, dockerAvailable } from "../../lanes/real-outcome/task/docker.ts";
import { BROWSER } from "../../lanes/outcome-skills/h2h/types.ts";
import { browserExtra } from "../../lanes/outcome-skills/h2h/breadth/oracle-b.ts";
import { assertStored, DIGEST_REF, registryStore } from "../../lanes/outcome-skills/h2h/breadth/store.ts";

const REGISTRY = "registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";
const on = process.env.GSTACK_EVALS_DOCKER === "1" && dockerAvailable();

describe.skipIf(!on)("part B with Docker", () => {
  test("registry store by digest, then the browser conditions in a container", () => {
    const name = "h2h-reg-" + process.pid;
    const ctx = mkdtempSync(join(tmpdir(), "h2h-store-"));
    try {
      expect(docker(["run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::5000", REGISTRY], { timeoutMs: 300_000 }).status).toBe(0);
      const port = docker(["port", name, "5000"], { timeoutMs: 30_000 }).stdout.trim().split(":").pop();
      writeFileSync(join(ctx, "Dockerfile"), "FROM " + REGISTRY + "\nRUN echo h2h > /h2h.txt\n");
      expect(docker(["build", "-q", "-t", "h2h-store-test:" + process.pid, ctx], { timeoutMs: 300_000 }).status).toBe(0);
      const store = registryStore("127.0.0.1:" + port + "/h2h-test");
      const s = store.push("h2h-store-test:" + process.pid);
      expect(s.ref).toMatch(DIGEST_REF);
      expect(store.has(s.ref)).toBe(true);
      expect(store.has(s.ref.replace(/[0-9a-f]{64}$/, "0".repeat(64)))).toBe(false);
      assertStored(store, s.ref, s.ref);
      const local = store.pull(s.ref);
      const r = docker(["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", ...extraArgs(browserExtra()), "--entrypoint", "sh", local, "-c", "cat /h2h.txt; df -k /dev/shm | tail -1; test -x " + BROWSER.wrapper_container_path + " && echo wrapper-ok; echo CHROME_BIN=$CHROME_BIN"], { timeoutMs: 120_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("h2h\n");
      expect(Number(r.stdout.split("\n")[1]!.trim().split(/\s+/)[1])).toBe(2 * 1024 * 1024);
      expect(r.stdout).toContain("wrapper-ok");
      expect(r.stdout).toContain("CHROME_BIN=" + BROWSER.env.CHROME_BIN);
    } finally {
      docker(["rm", "-f", name], { timeoutMs: 60_000 });
      docker(["rmi", "-f", "h2h-store-test:" + process.pid], { timeoutMs: 60_000 });
      rmSync(ctx, { recursive: true, force: true });
    }
  }, 900_000);
});

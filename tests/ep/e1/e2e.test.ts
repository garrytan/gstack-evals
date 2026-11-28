// Copyright (c) 2026 Garry Tan. MIT License.
// Eval 1's driven launch is withdrawn: it reports unavailable and makes no Docker call, with the paid stop set or lifted.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E1_REAL, E1_STOPPED } from "../../../lanes/eng-planted/e1/commands.ts";
import { drivenLaunch } from "../../../lanes/eng-planted/e1/e2e.ts";

describe("the e1 driven launch makes no Docker call", () => {
  let dir = "";
  let path = "";
  const calls = () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean) : []);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ep-e1-e2e-"));
    writeFileSync(join(dir, "docker"), '#!/bin/sh\necho "$*" >> "$FAKE_DOCKER_DIR/calls"\nexit 0\n');
    chmodSync(join(dir, "docker"), 0o755);
    path = process.env.PATH ?? "";
    process.env.PATH = dir + ":" + path;
    process.env.FAKE_DOCKER_DIR = dir;
  });
  afterEach(() => {
    process.env.PATH = path;
    delete process.env.FAKE_DOCKER_DIR;
    E1_REAL.stopped = E1_STOPPED;
  });
  test("the fake docker on PATH is the one a spawned docker reaches", () => {
    spawnSync("docker", ["version"], { encoding: "utf8" });
    expect(calls()).toEqual(["version"]);
  });
  for (const [when, stopped] of [
    ["under the paid stop", E1_STOPPED],
    ["with the paid stop lifted", undefined],
  ] as const) {
    test(when + " it returns unavailable and runs no Docker command", async () => {
      E1_REAL.stopped = stopped;
      const r = await drivenLaunch();
      expect(r).toEqual({ ok: false, detail: expect.stringMatching(/^unavailable: /), checks: [] });
      expect(calls()).toEqual([]);
    });
  }
  test("its command line exits 1 with the unavailable line and no Docker command", () => {
    const r = spawnSync("bun", [join(import.meta.dir, "../../../lanes/eng-planted/e1/e2e.ts")], { encoding: "utf8", env: process.env });
    expect(r.status).toBe(1);
    expect(r.stdout).toStartWith("FAIL e1 driven launch: unavailable: ");
    expect(calls()).toEqual([]);
  });
});

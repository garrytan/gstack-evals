// Copyright (c) 2026 Garry Tan. MIT License.
// The e1 driven launch's Docker safety: it refuses under the stop before any Docker command, refuses a daemon that
// already holds resources under the shared eval labels, and its cleanup removes only what appeared after it listed them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E1_REAL, E1_STOPPED } from "../../../lanes/eng-planted/e1/commands.ts";
import { drivenLaunch, labelledIds, removeCreated } from "../../../lanes/eng-planted/e1/e2e.ts";

describe("the driven launch touches no Docker daemon it does not own", () => {
  let dir = "";
  let path = "";
  const calls = () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean) : []);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ep-e1-e2e-"));
    writeFileSync(join(dir, "docker"), '#!/bin/sh\necho "$*" >> "$FAKE_DOCKER_DIR/calls"\n[ "$FAKE_DOCKER_MODE" = fail ] && exit 1\n[ "$FAKE_DOCKER_MODE" = labelled ] && [ "$1" = ps ] && echo c-other\nexit 0\n');
    chmodSync(join(dir, "docker"), 0o755);
    path = process.env.PATH ?? "";
    process.env.PATH = dir + ":" + path;
    process.env.FAKE_DOCKER_DIR = dir;
  });
  afterEach(() => {
    process.env.PATH = path;
    delete process.env.FAKE_DOCKER_DIR;
    delete process.env.FAKE_DOCKER_MODE;
    E1_REAL.stopped = E1_STOPPED;
  });
  test("the fake docker on PATH is the one a spawned docker reaches", () => {
    spawnSync("docker", ["version"], { encoding: "utf8" });
    expect(calls()).toEqual(["version"]);
  });
  test("under the stop it returns unavailable and runs no Docker command", async () => {
    expect(E1_REAL.stopped).toBe(E1_STOPPED);
    const r = await drivenLaunch({ log: () => {} });
    expect(r.ok).toBe(false);
    expect(r.detail.startsWith("unavailable: " + E1_STOPPED)).toBe(true);
    expect(calls()).toEqual([]);
  });
  test("with the stop lifted, a daemon holding another run's labelled container is refused after listing only", async () => {
    E1_REAL.stopped = undefined;
    process.env.FAKE_DOCKER_MODE = "labelled";
    const r = await drivenLaunch({ log: () => {} });
    expect(r).toEqual({ ok: false, detail: expect.stringContaining("not isolated"), checks: [] });
    expect(calls().every((c) => /^(ps|volume ls|images) /.test(c) && c.includes("--filter label="))).toBe(true);
    expect(calls().some((c) => /^(rm|rmi|volume rm) /.test(c))).toBe(false);
  });
  test("with the stop lifted, a daemon that cannot be listed is refused and nothing is removed", async () => {
    E1_REAL.stopped = undefined;
    process.env.FAKE_DOCKER_MODE = "fail";
    const r = await drivenLaunch({ log: () => {} });
    expect(r).toEqual({ ok: false, detail: expect.stringContaining("could not be listed"), checks: [] });
    expect(calls()).toHaveLength(1);
  });
});

describe("the rehearsal's cleanup removes only what it created", () => {
  const daemon = (lists: Record<string, string[]>, fail = false) => {
    const removed: string[][] = [];
    const docker = (args: string[]) => {
      if (/^(rm|rmi|volume rm)$/.test(args[0] === "volume" ? "volume " + args[1] : args[0]!)) {
        removed.push(args);
        return { stdout: "", status: 0 };
      }
      if (fail) return { stdout: "", status: 1 };
      const kind = args[0] === "ps" ? "container" : args[0] === "volume" ? "volume" : args.join(" ").includes("eb=cov") ? "cov" : "session";
      return { stdout: (lists[kind] ?? []).join("\n") + "\n", status: 0 };
    };
    return { docker, removed };
  };
  test("labelled resources present before the rehearsal stay; ones that appeared after are removed", () => {
    const before = labelledIds(daemon({ container: ["c-old"], volume: ["v-old"], cov: [], session: ["s-old"] }).docker)!;
    const d = daemon({ container: ["c-old", "c-new"], volume: ["v-old"], cov: ["i-cov"], session: ["s-old", "s-new"] });
    expect(removeCreated(d.docker, before)).toBe(3);
    expect(d.removed).toEqual([
      ["rm", "-f", "c-new"],
      ["rmi", "-f", "--no-prune", "i-cov"],
      ["rmi", "-f", "--no-prune", "s-new"],
    ]);
  });
  test("a listing failure reads as null, and cleanup after one removes nothing", () => {
    const d = daemon({ container: ["c-new"] }, true);
    expect(labelledIds(d.docker)).toBeNull();
    expect(removeCreated(d.docker, [new Set(), new Set(), new Set(), new Set()])).toBe(0);
    expect(d.removed).toEqual([]);
  });
  test("a daemon with nothing new under the labels sees no remove command", () => {
    const lists = { container: ["c-old"], volume: [], cov: [], session: [] };
    const d = daemon(lists);
    expect(removeCreated(d.docker, labelledIds(daemon(lists).docker)!)).toBe(0);
    expect(d.removed).toEqual([]);
  });
});

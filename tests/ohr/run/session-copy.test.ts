// Copyright (c) 2026 Garry Tan. MIT License.
// Value: protects=the Claude Code session copy A8 reads (the second attempt's pre-run change 3): the container's end step copies Claude Code's own session file to host/claude-session.jsonl, once, before the container stops; fails_when=the copy is skipped, written from a failed read, run twice, run after the stop, or run for a Sol session.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSessionCommand, ohrProbed } from "../../../lanes/office-hours-rewrite/run/run.ts";
import type { AgentSession, Sandbox, StepResult } from "../../../src/trial/sandbox.ts";
import { CONTAINER_HOME } from "../../../lanes/office-hours-rewrite/frozen.ts";

const HOME = CONTAINER_HOME;
const SESSION = '{"type":"user","message":{"role":"user","content":"hello"}}\n';
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function rig(cat: { exitCode: number; stdout: string }) {
  const calls: string[] = [];
  const step = (exitCode: number, stdout = ""): StepResult => ({ exitCode, stdout, stderr: "", timedOut: false });
  const session: AgentSession = {
    exec(command) {
      calls.push(command);
      return command === claudeSessionCommand(HOME) ? step(cat.exitCode, cat.stdout) : step(1);
    },
    spawn() {
      throw new Error("no spawn in this test");
    },
    stop() {
      calls.push("stop");
    },
  };
  const sandbox: Sandbox = {
    isolation: "docker",
    workPath: () => "/work",
    fixturesPath: (f) => f,
    homePath: () => HOME,
    step: () => step(1),
    agent: () => session,
  };
  const dir = mkdtempSync(join(tmpdir(), "ohr-copy-"));
  dirs.push(dir);
  return { calls, sandbox, file: join(dir, "host", "claude-session.jsonl") };
}

describe("the Claude Code session copy", () => {
  test("reads every session file under HOME's .claude/projects", () => {
    expect(claudeSessionCommand(HOME)).toBe('cat "' + CONTAINER_HOME + '"/.claude/projects/*/*.jsonl');
  });
  test("a Claude Code container's end step writes the file to host/claude-session.jsonl, once, before the stop", () => {
    const r = rig({ exitCode: 0, stdout: SESSION });
    const s = ohrProbed(r.sandbox, { docker: "docker", home: HOME, pin: null, root: null, session: r.file, onProbe: () => {} }).agent("t", { work: "/w", env: {} });
    s.stop();
    s.stop();
    expect(readFileSync(r.file, "utf8")).toBe(SESSION);
    expect(r.calls.filter((c) => c === claudeSessionCommand(HOME)).length).toBe(1);
    expect(r.calls.indexOf(claudeSessionCommand(HOME))).toBeLessThan(r.calls.indexOf("stop"));
  });
  test("a failed read writes nothing, so A8 finds no copy", () => {
    const r = rig({ exitCode: 1, stdout: "" });
    ohrProbed(r.sandbox, { docker: "docker", home: HOME, pin: null, root: null, session: r.file, onProbe: () => {} }).agent("t", { work: "/w", env: {} }).stop();
    expect(existsSync(r.file)).toBe(false);
  });
  test("a session with no copy path (a Sol session) reads nothing", () => {
    const r = rig({ exitCode: 0, stdout: SESSION });
    ohrProbed(r.sandbox, { docker: "docker", home: HOME, pin: null, root: null, onProbe: () => {} }).agent("t", { work: "/w", env: {} }).stop();
    expect(r.calls).not.toContain(claudeSessionCommand(HOME));
    expect(existsSync(r.file)).toBe(false);
  });
});

// Copyright (c) 2026 Garry Tan. MIT License.
// Read-only git plumbing for the miner and the task builder. Every call runs with hooks and fsmonitor off, no global
// or system config and a scrubbed environment, so an upstream clone can't make this process run its code.
import { spawnSync } from "node:child_process";

export class GitError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

export const GIT_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
};

const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "core.quotePath=false"];

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function gitRun(cwd: string, args: string[], input?: string): GitResult {
  const r = spawnSync("git", [...SAFE, ...args], { cwd, env: GIT_ENV, input, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) throw new GitError("git " + args[0] + ": " + r.error.message, "");
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

export function git(cwd: string, args: string[], input?: string): string {
  const r = gitRun(cwd, args, input);
  if (r.status !== 0) throw new GitError("git " + args.join(" ").slice(0, 200) + " exited " + r.status + ": " + r.stderr.trim().slice(0, 400), r.stderr);
  return r.stdout;
}

export const gitLines = (cwd: string, args: string[]): string[] => git(cwd, args).split("\n").filter((l) => l.length > 0);

/** The blob at rev:path, or null when the path doesn't exist there. */
export function showFile(cwd: string, rev: string, path: string): string | null {
  const r = gitRun(cwd, ["show", rev + ":" + path]);
  return r.status === 0 ? r.stdout : null;
}

export function isShallow(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
}

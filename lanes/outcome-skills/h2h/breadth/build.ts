// Copyright (c) 2026 Garry Tan. MIT License.
// Building a B image with its frozen recipe on a builder host (plan section 6). Builds run untrusted install scripts with
// network, so the host is a keyless throwaway VM reached through DOCKER_HOST (ssh://user@host); tests use the local
// daemon. The docker CLI gets PATH, HOME and DOCKER_HOST only, never a provider key. A build that fails drops its
// candidate with E_H2H_B_BUILD; a host that does not answer is an infra error, never a drop.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { h2hFail } from "../prereg.ts";
import { BROWSER } from "../types.ts";
import { dockerfile, type Drop, type Recipe } from "./recipes.ts";

export const WRAPPER = join(import.meta.dir, "..", "..", "..", "..", BROWSER.wrapper_repo_path);
/** A build longer than this drops the candidate. */
export const BUILD_LIMIT_MS = 3_600_000;

/** Where docker runs: the local daemon, or a remote one through DOCKER_HOST. */
export interface BuilderHost { docker_host?: string }

export function dockerOn(host: BuilderHost, args: string[], opts: { timeoutMs?: number; input?: string; cwd?: string } = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DOCKER_BUILDKIT: "1" };
  const dh = host.docker_host ?? process.env.DOCKER_HOST;
  if (dh) env.DOCKER_HOST = dh;
  if (process.env.DOCKER_CONFIG) env.DOCKER_CONFIG = process.env.DOCKER_CONFIG;
  const t0 = performance.now();
  const r = spawnSync("docker", args, { env, cwd: opts.cwd, input: opts.input, encoding: "utf8", timeout: opts.timeoutMs, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : ""), timed_out: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT", wall_ms: Math.round(performance.now() - t0) };
}

export interface Built { image_id: string; tag: string; wall_ms: number; dockerfile: string }

/** Builds one candidate's image at the fix's parent. Refuses (E_H2H_B_BUILD, infra) when the host's daemon does not answer;
 *  returns a drop when the build fails or passes its limit. */
export function buildImage(o: { recipe: Recipe; repoUrl: string; parent: string; tag: string; host?: BuilderHost; limitMs?: number }): Built | (Drop & { log_tail: string }) {
  const host = o.host ?? {};
  if (dockerOn(host, ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 30_000 }).status !== 0) h2hFail("E_H2H_B_BUILD", "the builder host's docker daemon does not answer" + (host.docker_host ? " at " + host.docker_host : "") + "; an infra error, not a drop");
  const ctx = mkdtempSync(join(tmpdir(), "h2h-build-"));
  try {
    const text = dockerfile(o.recipe, o.repoUrl, o.parent);
    writeFileSync(join(ctx, "Dockerfile"), text);
    copyFileSync(WRAPPER, join(ctx, "chromium-wrapper.sh"));
    const r = dockerOn(host, ["build", "--progress=plain", "-t", o.tag, ctx], { timeoutMs: o.limitMs ?? BUILD_LIMIT_MS });
    if (r.status !== 0 || r.timed_out) return { code: "E_H2H_B_BUILD", rule: r.timed_out ? "build_time_limit" : "build_failed", log_tail: (r.stderr + r.stdout).slice(-4000) };
    const id = dockerOn(host, ["image", "inspect", "--format", "{{.Id}}", o.tag], { timeoutMs: 60_000 }).stdout.trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(id)) h2hFail("E_H2H_B_BUILD", o.tag + " built but has no image id");
    return { image_id: id, tag: o.tag, wall_ms: r.wall_ms, dockerfile: text };
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

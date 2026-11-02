// Copyright (c) 2026 Garry Tan. MIT License.
// Docker calls for the task builder and checker. The docker CLI gets a minimal environment (no provider keys), and no
// container gets an environment variable the verifier did not set.
import { spawnSync } from "node:child_process";

export const DOCKER_ENV: Record<string, string> = Object.fromEntries(
  Object.entries({ PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG, DOCKER_BUILDKIT: "1" }).filter((e): e is [string, string] => typeof e[1] === "string"),
);

export interface DockerResult {
  status: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  /** The client's own error (ETIMEDOUT, or ENOBUFS past the output buffer) when it died before the container did. */
  error?: string;
  wall_ms: number;
}

export function docker(args: string[], opts: { timeoutMs?: number; input?: string } = {}): DockerResult {
  const t0 = performance.now();
  const r = spawnSync("docker", args, { env: DOCKER_ENV, encoding: "utf8", input: opts.input, timeout: opts.timeoutMs, killSignal: "SIGKILL", maxBuffer: 256 * 1024 * 1024 });
  const error = r.error ? ((r.error as NodeJS.ErrnoException).code ?? r.error.message) : undefined;
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? String(r.error) : ""), timed_out: error === "ETIMEDOUT", ...(error ? { error } : {}), wall_ms: Math.round(performance.now() - t0) };
}

/** docker run under a name. A client that dies first (a timeout, or ENOBUFS past the output buffer) leaves the container
 * running and holding its volumes, so the container is then killed and removed by that name. */
export function dockerRun(name: string, args: string[], opts: { timeoutMs?: number; input?: string } = {}): DockerResult {
  const r = docker(["run", "--name", name, ...args], opts);
  if (r.error) docker(["rm", "-f", name]);
  return r;
}

export const dockerAvailable = (): boolean => docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 20000 }).status === 0;

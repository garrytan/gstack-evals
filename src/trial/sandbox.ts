// Where a trial's steps run (plan v3.2, "Execution, isolation and secrets").
//
// --isolation docker (the default): setup, the agent and the check each run in their own container as this machine's
// uid, with every capability dropped and no new privileges.
// - setup: the work dir and a read-only copy of the tasks directory at /fixtures; no network.
// - agent: the arm image with the work dir only, never the tasks directory; on the trial network when a proxy serves it,
//   else no network. The container lives for the session and each step is a docker exec.
// - check: the grade tree and a read-only copy of the tasks directory, a read-only root filesystem with tmpfs for /tmp
//   and HOME, and no network.
// The work dir is mounted at /work/<task id>, so the project name the agent sees is the task id and never the
// evaluator's layout (arm names, run paths).
//
// --isolation process (explicit only): setup and check run as this user with the env allowlist, and the agent runs under
// bubblewrap with the system directories read-only, a fresh HOME and the work dir, and no tasks directory. Without bwrap
// on PATH it refuses (E_ISOLATION_UNSAFE). The verdict records the mode.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReasonCode } from "../errors/codes.ts";
import type { ShellResult, ShellRunner } from "../skill-eval/contract/vacuity.ts";
import { dockerEnvArgs } from "./env.ts";
import { checkImagePin, dockerRun, stateRoot, type Runner } from "./image.ts";

export interface StepResult extends ShellResult {
  stdout: string;
}

export interface StepOptions {
  /** The work dir (setup) or grade tree (check) on this machine. */
  work: string;
  /** The read-only copy of the tasks directory on this machine. */
  fixtures: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface AgentSession {
  /** Runs one shell step in the agent's environment, in the work dir. */
  exec(command: string, timeoutMs: number): StepResult;
  /** Ends the session and removes its container; safe to call twice. */
  stop(): void;
}

export interface Sandbox {
  isolation: "docker" | "process";
  /** Where the work dir appears to the trial's children. */
  workPath(work: string, task: string): string;
  /** Where the tasks directory copy appears to setup and check. */
  fixturesPath(fixtures: string): string;
  /** The HOME every child gets, given the trial's evaluator-side directory. */
  homePath(dir: string): string;
  step(role: "setup" | "check", command: string, task: string, opts: StepOptions): StepResult;
  agent(task: string, opts: { work: string; env: Record<string, string>; network?: string | null }): AgentSession;
}

export class IsolationError extends Error {}

const STEP_BUFFER = 64 * 1024 * 1024;
const uid = () => (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
const HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "1024"];

function result(r: ReturnType<typeof spawnSync>): StepResult {
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return { exitCode: timedOut ? null : r.status, timedOut, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? ""), error: r.error?.message ?? (r.signal ? "ended by " + r.signal : undefined) };
}

/**
 * docker run with the env between its flags and its image, credential values through the docker client's own env, and
 * the named container removed when the step times out (the client's exit leaves it running).
 */
function dockerStep(docker: string, flags: string[], image: string[], name: string, env: Record<string, string>, timeoutMs: number): StepResult {
  const { args: envArgs, clientEnv } = dockerEnvArgs(env);
  const client = Object.fromEntries(["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
  const r = result(spawnSync(docker, ["run", "--name", name, ...flags, ...envArgs, ...image], { env: { ...client, ...clientEnv }, timeout: timeoutMs, encoding: "utf8", maxBuffer: STEP_BUFFER }));
  if (r.timedOut) spawnSync(docker, ["rm", "-f", name], { stdio: "ignore" });
  return r;
}

export const dockerAvailable = (docker = "docker"): boolean => spawnSync(docker, ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore", timeout: 15_000 }).status === 0;

/** Containers for setup and check (the trial image) and for the agent (the arm image). */
export function dockerSandbox(opts: { trialImage: string; armImage?: string; docker?: string }): Sandbox {
  const docker = opts.docker ?? "docker";
  const workPath = (_work: string, task: string) => "/work/" + task;
  return {
    isolation: "docker",
    workPath,
    fixturesPath: () => "/fixtures",
    homePath: () => "/home/agent",
    step(role, command, task, o) {
      const name = "gse-" + role + "-" + randomBytes(6).toString("hex");
      const path = workPath(o.work, task);
      const readOnly = role === "check" ? ["--read-only", "--tmpfs", "/tmp", "--tmpfs", "/home/agent:mode=1777"] : [];
      return dockerStep(docker, ["--rm", "--network", "none", "--user", uid(), ...HARDENING, ...readOnly, "-v", o.work + ":" + path, "-v", o.fixtures + ":/fixtures:ro", "-w", path], ["--entrypoint", "sh", opts.trialImage, "-c", command], name, o.env, o.timeoutMs);
    },
    agent(task, o) {
      const name = "gse-agent-" + randomBytes(6).toString("hex");
      const path = workPath(o.work, task);
      const start = dockerStep(docker, ["-d", "--network", o.network ?? "none", "--user", uid(), ...HARDENING, "-v", o.work + ":" + path, "-w", path], ["--entrypoint", "sleep", opts.armImage ?? opts.trialImage, "infinity"], name, o.env, 120_000);
      if (start.exitCode !== 0) throw new IsolationError("could not start the agent container: " + start.stderr.trim().split("\n").slice(-1)[0]);
      let stopped = false;
      return {
        exec: (command, timeoutMs) => {
          const r = result(spawnSync(docker, ["exec", "-w", path, name, "sh", "-c", command], { timeout: timeoutMs, encoding: "utf8", maxBuffer: STEP_BUFFER }));
          if (r.timedOut) spawnSync(docker, ["exec", name, "sh", "-c", "kill -9 -1"], { stdio: "ignore" });
          return r;
        },
        stop: () => {
          if (!stopped) spawnSync(docker, ["rm", "-f", name], { stdio: "ignore" });
          stopped = true;
        },
      };
    },
  };
}

/** The bubblewrap command that runs one agent step: system directories read-only, a fresh HOME, the work dir and nothing else. */
export function bwrapArgs(work: string, home: string, command: string): string[] {
  return [
    "--die-with-parent", "--unshare-all", "--share-net", "--new-session",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/etc", "/etc", "--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--dir", home, "--bind", work, work, "--chdir", work, "sh", "-c", command,
  ];
}

const local = (command: string, cwd: string, env: Record<string, string>, timeoutMs: number): StepResult => result(spawnSync("sh", ["-c", command], { cwd, env, timeout: timeoutMs, encoding: "utf8", maxBuffer: STEP_BUFFER }));

/** Setup and check as this user; the agent under bubblewrap. Refuses without bwrap on PATH. */
export function processSandbox(opts: { bwrap?: string } = {}): Sandbox {
  const bwrap = opts.bwrap ?? "bwrap";
  if (spawnSync(bwrap, ["--version"], { stdio: "ignore" }).status !== 0) throw new IsolationError("--isolation process runs the agent under bubblewrap, and " + bwrap + " is not on PATH");
  return {
    isolation: "process",
    workPath: (work) => work,
    fixturesPath: (fixtures) => fixtures,
    homePath: (dir) => {
      mkdirSync(join(dir, "home"), { recursive: true });
      return join(dir, "home");
    },
    step: (_role, command, _task, o) => local(command, o.work, o.env, o.timeoutMs),
    agent(_task, o) {
      const home = o.env.HOME ?? "/home/agent";
      return {
        exec: (command, timeoutMs) => result(spawnSync(bwrap, bwrapArgs(o.work, home, command), { env: o.env, timeout: timeoutMs, encoding: "utf8", maxBuffer: STEP_BUFFER })),
        stop: () => {},
      };
    },
  };
}

/**
 * Vacuity's runner in containers: the control's temp root (work dir and HOME) and the tasks directory are mounted at
 * their own paths, so the env's paths hold inside, and nothing else of this machine is visible.
 */
export function dockerShell(image: string, fixtures: string, docker = "docker"): ShellRunner {
  return (command, { cwd, env, timeoutMs }): ShellResult => {
    const name = "gse-control-" + randomBytes(6).toString("hex");
    const root = dirname(cwd);
    const mounts = ["-v", root + ":" + root, ...(existsSync(fixtures) && !fixtures.startsWith(root + "/") ? ["-v", fixtures + ":" + fixtures + ":ro"] : [])];
    const r = dockerStep(docker, ["--rm", "--network", "none", "--user", uid(), ...HARDENING, ...mounts, "-w", cwd], ["--entrypoint", "sh", image, "-c", command], name, env, timeoutMs);
    return { exitCode: r.exitCode, timedOut: r.timedOut, stderr: r.stderr, ...(r.error ? { error: r.error } : {}) };
  };
}

/**
 * The runner for preflight's vacuity check and --lock under --isolation docker: the pinned trial image, or why there is
 * none (E_ISOLATION_UNSAFE with no daemon, E_IMAGE_STALE with no pin for this checkout's recipe). GSTACK_EVALS_DOCKER_BIN
 * names another docker client.
 */
export function containerRunner(tasksDir: string, env: Record<string, string | undefined> = process.env): { runner: ShellRunner; image: string } | { stop: { code: ReasonCode; message: string; fix?: string } } {
  const docker = env.GSTACK_EVALS_DOCKER_BIN || "docker";
  if (!dockerAvailable(docker)) return { stop: { code: "E_ISOLATION_UNSAFE", message: "no Docker daemon answered " + docker + " version, so under --isolation docker the vacuity check cannot run each task's setup, mutant and check in containers", fix: "Start Docker, or pass --isolation process on purpose; it is recorded in the verdict." } };
  const run: Runner = (_command, args, o) => dockerRun(docker, args, o);
  const pin = checkImagePin({ state: stateRoot(env), run });
  if (!pin.ok) return { stop: { code: pin.code, message: pin.message, ...(pin.fix ? { fix: pin.fix } : {}) } };
  return { runner: dockerShell(pin.pin.tag, tasksDir, docker), image: pin.pin.tag };
}

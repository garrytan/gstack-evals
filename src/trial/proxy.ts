// The trial network and its dual-homed proxy container (plan v3.2, "Execution, isolation and secrets"; U3 handoff).
//
// Each run gets an internal Docker network (no gateway, no route out) on a private /24 and a separate egress network. The
// metering proxy runs in its own container on the trial image (glibc, for its journal flock), attached to both: its
// trial listener binds its fixed address on the internal network, and its only route out is the egress network. Agent
// containers join the internal network alone, so the proxy is the only thing they can reach. The management socket and
// the journal sit in an evaluator-side directory mounted into the proxy container and never into an agent's.
//
// Resume order (GSTA-28): stop the proxy, then reconcileJournal on its journal, then settle the lease. A running proxy
// holds the journal's flock, and reconcile refuses while it does; settling first would close every lost-answer hold as
// unknown at its full reservation.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { reconcileJournal, type RetryBudget } from "../runner/proxy/metering-proxy.ts";
import type { ReservationLedger } from "../types.ts";
import { dockerEnvArgs, trialEnv } from "./env.ts";
import type { ProxyConfig } from "./proxy-entry.ts";

const SRC = join(import.meta.dir, "..");
const PROXY_PORT = 8080;

export interface TrialNetwork {
  /** The internal network agent containers join. */
  name: string;
  /** The proxy's route out. */
  egress: string;
  subnet: string;
  proxyIp: string;
}

export class TrialNetworkError extends Error {}

const docker = (bin: string, args: string[], env?: Record<string, string>) => spawnSync(bin, args, { encoding: "utf8", timeout: 120_000, ...(env ? { env } : {}) });

/**
 * Creates the internal network on a free 10.231.x.0/24 and the egress network. The internal bridge uses Docker's isolated
 * gateway mode (Engine 28 or newer), so the host gets no address on it and an agent cannot reach host services there.
 */
export function createTrialNetwork(bin = "docker"): TrialNetwork {
  const version = docker(bin, ["version", "--format", "{{.Server.Version}}"]).stdout.trim();
  if (Number(version.split(".")[0]) < 28) throw new TrialNetworkError("the trial network needs Docker Engine 28 or newer for an isolated gateway, so the host has no address agents can reach; this daemon is " + (version || "unknown"));
  const id = randomBytes(5).toString("hex");
  const egress = "gse-egress-" + id;
  const made = docker(bin, ["network", "create", egress]);
  if (made.status !== 0) throw new TrialNetworkError("could not create the egress network: " + made.stderr.trim());
  for (let attempt = 0; attempt < 16; attempt++) {
    const octet = randomBytes(1)[0]!;
    const subnet = "10.231." + octet + ".0/24";
    const name = "gse-trial-" + id;
    const r = docker(bin, ["network", "create", "--internal", "-o", "com.docker.network.bridge.gateway_mode_ipv4=isolated", "--subnet", subnet, name]);
    if (r.status === 0) return { name, egress, subnet, proxyIp: "10.231." + octet + ".2" };
    if (!/overlap|in use/i.test(r.stderr)) {
      docker(bin, ["network", "rm", egress]);
      throw new TrialNetworkError("could not create the trial network: " + r.stderr.trim());
    }
  }
  docker(bin, ["network", "rm", egress]);
  throw new TrialNetworkError("no free 10.231.x.0/24 subnet for the trial network after 16 tries");
}

export function removeTrialNetwork(net: TrialNetwork, bin = "docker"): void {
  docker(bin, ["network", "rm", net.name]);
  docker(bin, ["network", "rm", net.egress]);
}

export interface ProxyHandle {
  container: string;
  /** The base URL agents use, on the internal network. */
  baseUrl: string;
  socket: string;
  journal: string;
  /** Stops the container; the kernel then drops the journal's flock. Safe to call twice. */
  stop(): void;
}

/**
 * Starts the proxy container on the trial network and connects it to the egress network. dir is the evaluator-side
 * directory for its config, journal and management socket; the ledger's directory is mounted at its own path.
 */
export function startProxyContainer(opts: { image: string; net: TrialNetwork; dir: string; ledger: string; leaseId: string; managementToken: string; retry: RetryBudget; providerKeys?: Record<string, string>; docker?: string; timeoutMs?: number; writeAheadSocket?: string; servedProvider?: boolean }): ProxyHandle {
  const bin = opts.docker ?? "docker";
  mkdirSync(opts.dir, { recursive: true });
  if (opts.writeAheadSocket !== undefined && dirname(opts.writeAheadSocket) !== opts.dir) throw new TrialNetworkError("the write-ahead relay socket must sit in the proxy's mounted directory " + opts.dir);
  const config: ProxyConfig = { lease_id: opts.leaseId, ledger: opts.ledger, journal: join(opts.dir, "journal.ndjson"), socket: join(opts.dir, "management.sock"), host: opts.net.proxyIp, port: PROXY_PORT, retry: opts.retry, ...(opts.writeAheadSocket !== undefined ? { write_ahead_socket: opts.writeAheadSocket } : {}), ...(opts.servedProvider ? { served_provider: true } : {}) };
  writeFileSync(join(opts.dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
  rmSync(config.socket, { force: true });
  const env = trialEnv("proxy", { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", GSTACK_EVALS_PROXY_TOKEN: opts.managementToken, ...opts.providerKeys });
  const { args: envArgs, clientEnv } = dockerEnvArgs(env);
  const name = "gse-proxy-" + randomBytes(5).toString("hex");
  const user = (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000);
  const ledgerDir = dirname(opts.ledger);
  const r = docker(bin, ["run", "-d", "--name", name, "--network", opts.net.name, "--ip", opts.net.proxyIp, "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp",
    "-v", opts.dir + ":" + opts.dir, "-v", ledgerDir + ":" + ledgerDir, "-v", SRC + ":/opt/gstack-evals/src:ro", ...envArgs, "--entrypoint", "bun", opts.image, "/opt/gstack-evals/src/trial/proxy-entry.ts", join(opts.dir, "config.json")],
    { ...Object.fromEntries(["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_RUNTIME_DIR"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : []))), ...clientEnv });
  let stopped = false;
  const handle: ProxyHandle = {
    container: name,
    baseUrl: "http://" + opts.net.proxyIp + ":" + PROXY_PORT,
    socket: config.socket,
    journal: config.journal,
    stop: () => {
      if (!stopped) docker(bin, ["rm", "-f", name]);
      stopped = true;
    },
  };
  if (r.status !== 0) throw new TrialNetworkError("could not start the proxy container: " + r.stderr.trim());
  const connect = docker(bin, ["network", "connect", opts.net.egress, name]);
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  const ready = () => docker(bin, ["logs", name]).stdout.includes("PROXY_READY ") && existsSync(config.socket);
  const running = () => docker(bin, ["inspect", "-f", "{{.State.Running}}", name]).stdout.trim() === "true";
  let up = false;
  while (connect.status === 0 && Date.now() < deadline && running() && !(up = ready())) Bun.sleepSync(200);
  if (!up) {
    const logs = docker(bin, ["logs", "--tail", "5", name]);
    handle.stop();
    throw new TrialNetworkError("the proxy container did not come up: " + (connect.status !== 0 ? connect.stderr : logs.stdout + logs.stderr).trim().split("\n").slice(-3).join(" | "));
  }
  return handle;
}

/** Resume's recovery, in the only safe order: stop the proxy, reconcile its journal, then settle the lease. */
export async function recoverRun<T>(opts: { stopProxy: () => void | Promise<void>; journal: string; ledger: ReservationLedger; settle: () => T | Promise<T> }): Promise<{ reconciled: Awaited<ReturnType<typeof reconcileJournal>>; settled: T }> {
  await opts.stopProxy();
  const reconciled = await reconcileJournal(opts.journal, opts.ledger);
  const settled = await opts.settle();
  return { reconciled, settled };
}

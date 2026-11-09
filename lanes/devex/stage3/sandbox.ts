// Copyright (c) 2026 Garry Tan. MIT License.
// Stage 3's VM sandbox (prereg 2026-11-09-geva-417, section 12 "Sandbox (I1)", section 15 rules 3 and 7). Every build
// session and every docs-only session runs in its own throwaway VM, created for that run and destroyed after it: no keys
// inside (the metering proxy runs on the controller and holds them), network only to the metering proxy and a package
// mirror pinned for the run, no drive mounts, the run user's linger set, apt's timers stopped and unattended-upgrades
// masked before anything runs, UBI_OWNER set to the run thread's code and a TTL that covers the session. After each run
// the controller records the VM's network log and a stat-only file list and checks that no connection went anywhere
// else. Repository code runs only inside these VMs, through VmBackend.exec, never on the controller.
//
// UbicloudBackend is the real backend; the keyless code and the dry run never construct it. FakeBackend (fake.ts) is the
// one the tests and checks drive.
import { DxError } from "../author/funnel.ts";

export interface Endpoint {
  host: string;
  port: number;
}

export interface VmSpec {
  /** UBI_OWNER: the run thread's code. */
  owner: string;
  /** The VM's time to live, which must cover the session. */
  ttl_minutes: number;
  session_minutes: number;
  run_user: string;
  proxy: Endpoint;
  mirror: Endpoint;
  /** Drive or host mounts; must be empty. */
  mounts: string[];
  /** The environment the VM's sessions get; never a key. */
  env: Record<string, string>;
}

export interface Connection {
  host: string;
  port: number;
}

/** One file list row: stat data only, never contents. */
export interface StatEntry {
  path: string;
  size: number;
  mode: number;
  mtime: string;
}

export interface ExecResult {
  exit: number;
  stdout: string;
  stderr: string;
  elapsed_ms: number;
  /** Whether the command ran with stdin closed. */
  stdin_closed: boolean;
}

export interface ExecOptions {
  user?: "root" | "run";
  stdinClosed?: boolean;
  timeoutMs?: number;
}

export interface Vm {
  id: string;
  spec: VmSpec;
}

export interface VmBackend {
  create(spec: VmSpec): Promise<Vm>;
  exec(vm: Vm, command: string, o?: ExecOptions): Promise<ExecResult>;
  write(vm: Vm, path: string, data: Uint8Array | string): Promise<void>;
  read(vm: Vm, path: string): Promise<Uint8Array>;
  /** Every outbound connection the VM's own log recorded. */
  networkLog(vm: Vm): Promise<Connection[]>;
  fileList(vm: Vm, root: string): Promise<StatEntry[]>;
  destroy(vm: Vm): Promise<void>;
}

const KEY_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?$/i;

/** What keeps a spec from running; empty when it may run. */
export function specProblems(spec: VmSpec): string[] {
  const out: string[] = [];
  if (!spec.owner.trim()) out.push("UBI_OWNER is not set");
  if (!(spec.ttl_minutes >= spec.session_minutes)) out.push("the TTL (" + spec.ttl_minutes + " min) does not cover the session (" + spec.session_minutes + " min)");
  if (spec.mounts.length) out.push("the VM has mounts: " + spec.mounts.join(", "));
  const keys = Object.keys(spec.env).filter((k) => KEY_NAME.test(k));
  if (keys.length) out.push("the VM environment carries key names: " + keys.join(", "));
  if (!spec.run_user.trim() || spec.run_user === "root") out.push("the run user must be a named non-root user");
  return out;
}

/**
 * What runs as root before anything else: apt's timers stopped, unattended-upgrades masked, the run user's linger set,
 * and an egress filter that admits only the proxy and the mirror and logs every new outbound connection.
 */
export function preamble(spec: VmSpec): string[] {
  const allow = (e: Endpoint) => "ip daddr " + e.host + " tcp dport " + e.port + " accept";
  return [
    "systemctl stop apt-daily.timer apt-daily-upgrade.timer",
    "systemctl disable apt-daily.timer apt-daily-upgrade.timer",
    "systemctl mask --now unattended-upgrades.service",
    "loginctl enable-linger " + spec.run_user,
    "nft add table inet dx",
    "nft 'add chain inet dx out { type filter hook output priority 0; policy drop; }'",
    "nft add rule inet dx out oif lo accept",
    "nft add rule inet dx out ct state new log prefix \"DXNET \"",
    "nft add rule inet dx out ct state established,related accept",
    "nft add rule inet dx out " + allow(spec.proxy),
    "nft add rule inet dx out " + allow(spec.mirror),
  ];
}

const same = (a: Connection, b: Endpoint) => a.host === b.host && a.port === b.port;

/** The connections that went anywhere but the proxy and the mirror. */
export const breaches = (log: readonly Connection[], spec: VmSpec): Connection[] => log.filter((c) => !same(c, spec.proxy) && !same(c, spec.mirror));

export interface SandboxRun<T> {
  value: T | null;
  error: string | null;
  log: Connection[];
  files: StatEntry[];
  breach: Connection[];
}

/**
 * Runs job in a fresh VM: create, preamble, job, then the network log and the stat-only file list, and destroy, always.
 * A preamble step that fails ends the run before the job with an error; the log is still read and checked.
 */
export async function sandboxed<T>(backend: VmBackend, spec: VmSpec, root: string, job: (vm: Vm) => Promise<T>): Promise<SandboxRun<T>> {
  const problems = specProblems(spec);
  if (problems.length) throw new DxError("E_USAGE", "the sandbox spec can't run: " + problems.join("; "));
  const vm = await backend.create(spec);
  try {
    let value: T | null = null, error: string | null = null;
    for (const step of preamble(spec)) {
      const r = await backend.exec(vm, step, { user: "root", stdinClosed: true });
      if (r.exit !== 0) {
        error = "preamble step failed (exit " + r.exit + "): " + step;
        break;
      }
    }
    if (error === null) {
      try {
        value = await job(vm);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    const log = await backend.networkLog(vm);
    const files = await backend.fileList(vm, root);
    return { value, error, log, files, breach: breaches(log, spec) };
  } finally {
    await backend.destroy(vm);
  }
}

/** Reads the DXNET lines the preamble's filter logs into connections. */
export function parseNetLog(text: string): Connection[] {
  return [...text.matchAll(/DXNET .*?DST=(\S+).*?DPT=(\d+)/g)].map((m) => ({ host: m[1]!, port: Number(m[2]) }));
}

export interface UbicloudOptions {
  project: string;
  location: string;
  /** The Ubicloud token, passed in by the paid run's launcher; this module never reads the environment. */
  token: string;
  size: string;
  image: string;
  publicKey: string;
  fetch?: typeof fetch;
  /** Runs a command over ssh as root or the run user on the VM's address; input feeds stdin. */
  ssh: (host: string, command: string, o: ExecOptions & { input?: Uint8Array }) => Promise<ExecResult & { raw?: Uint8Array }>;
}

/**
 * The Ubicloud backend for the paid run. It names each VM for its owner and its expiry minute, so the runner's reaper
 * can delete it past its TTL, and deletes the VM in destroy. The keyless code never calls it.
 */
export class UbicloudBackend implements VmBackend {
  private readonly hosts = new Map<string, string>();
  constructor(private readonly o: UbicloudOptions) {
    if (!o.token) throw new DxError("E_USAGE", "the Ubicloud backend needs a token from the paid run's launcher");
  }
  private async api(method: string, name: string, body?: unknown): Promise<any> {
    const url = "https://api.ubicloud.com/project/" + this.o.project + "/location/" + this.o.location + "/vm/" + name;
    const res = await (this.o.fetch ?? fetch)(url, { method, headers: { authorization: "Bearer " + this.o.token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok && res.status !== 404) throw new DxError("E_DX_INFRA_MISSING", "Ubicloud " + method + " " + name + " returned " + res.status);
    return res.status === 204 || res.status === 404 ? null : res.json();
  }
  async create(spec: VmSpec): Promise<Vm> {
    if (!spec.owner) throw new DxError("E_USAGE", "UBI_OWNER is not set");
    const expires = Math.floor(Date.now() / 60_000) + spec.ttl_minutes;
    const name = ("dx-" + spec.owner + "-" + expires + "-" + crypto.randomUUID().slice(0, 8)).toLowerCase();
    await this.api("POST", name, { public_key: this.o.publicKey, size: this.o.size, boot_image: this.o.image, enable_ip4: true });
    for (let i = 0; i < 120; i++) {
      const v = await this.api("GET", name);
      if (v?.state === "running" && v.ip4) {
        this.hosts.set(name, v.ip4);
        return { id: name, spec };
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }
    await this.api("DELETE", name);
    throw new DxError("E_DX_INFRA_MISSING", "Ubicloud VM " + name + " did not start");
  }
  private host(vm: Vm) {
    const h = this.hosts.get(vm.id);
    if (!h) throw new DxError("E_INTERNAL", "unknown VM " + vm.id);
    return h;
  }
  exec(vm: Vm, command: string, o: ExecOptions = {}) {
    return this.o.ssh(this.host(vm), command, o);
  }
  async write(vm: Vm, path: string, data: Uint8Array | string) {
    const r = await this.o.ssh(this.host(vm), "cat > " + JSON.stringify(path), { user: "root", input: typeof data === "string" ? new TextEncoder().encode(data) : data });
    if (r.exit !== 0) throw new DxError("E_DX_INFRA_MISSING", "could not write " + path + " on " + vm.id);
  }
  async read(vm: Vm, path: string) {
    const r = await this.o.ssh(this.host(vm), "cat " + JSON.stringify(path), { user: "root", stdinClosed: true });
    if (r.exit !== 0) throw new DxError("E_DX_INFRA_MISSING", "could not read " + path + " on " + vm.id);
    return r.raw ?? new TextEncoder().encode(r.stdout);
  }
  async networkLog(vm: Vm) {
    return parseNetLog((await this.o.ssh(this.host(vm), "journalctl -k -o cat --no-pager", { user: "root", stdinClosed: true })).stdout);
  }
  async fileList(vm: Vm, root: string) {
    const r = await this.o.ssh(this.host(vm), "find " + JSON.stringify(root) + " -xdev -printf '%P\\t%s\\t%m\\t%TY-%Tm-%TdT%TT\\n'", { user: "root", stdinClosed: true });
    return r.stdout.split("\n").filter(Boolean).map((l) => {
      const [path, size, mode, mtime] = l.split("\t");
      return { path: path!, size: Number(size), mode: parseInt(mode!, 8), mtime: mtime! };
    });
  }
  async destroy(vm: Vm) {
    await this.api("DELETE", vm.id);
    this.hosts.delete(vm.id);
  }
}

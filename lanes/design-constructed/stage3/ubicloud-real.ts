// Copyright (c) 2026 Garry Tan. MIT License.
// The real seams under UbicloudBackend for paid runs: a process runner, the SSH runner every VM command goes through,
// an SSH tunnel for the controller's browser, the backend on the real fetch, sleep and clock with the Ubicloud token
// read by name, and the named package mirrors (npm, PyPI, Ubuntu apt and a Docker Hub pull-through cache) that the
// controller host serves on its private IPv4. Only the paid launcher and the controller service on its host construct
// realUbicloud; tests drive the same runner against local stand-ins.
import { createServer } from "node:net";
import { fail } from "../errors.ts";
import { UbicloudBackend, type ExecOptions, type ExecResult, type Mirror, type MirrorName, type Vm } from "./sandbox.ts";

export interface ProcessResult {
  exit: number;
  stdout: Uint8Array;
  stderr: string;
  timedOut: boolean;
}

/** Runs argv with optional stdin and a time limit; a process past its limit is killed and exits 124. */
export async function runProcess(argv: string[], o: { input?: Uint8Array; timeoutMs?: number } = {}): Promise<ProcessResult> {
  const p = Bun.spawn(argv, { stdin: o.input ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe" });
  if (o.input) {
    p.stdin!.write(o.input);
    await p.stdin!.end();
  }
  let timedOut = false;
  const timer = o.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        p.kill("SIGKILL");
      }, o.timeoutMs)
    : null;
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
    return { exit: timedOut ? 124 : code, stdout: new Uint8Array(out), stderr: err, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export interface SshOptions {
  /** The private key file (mode 600) the launch made for its VMs. */
  keyPath: string;
  /** A known-hosts file of the launch's own; each VM's key is learnt on first contact. */
  knownHosts: string;
  /** The login user, Ubicloud's default unix user. */
  login?: string;
  /** The sandbox's run user, for commands run with user "run". */
  runUser?: string;
  /** The ssh binary. */
  program?: string;
  /** Extra ssh options, such as a port for a local stand-in. */
  extra?: string[];
}

export const sshArgs = (o: SshOptions, host: string, extra: string[] = []): string[] => [
  o.program ?? "ssh",
  "-i", o.keyPath,
  "-o", "IdentitiesOnly=yes",
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "UserKnownHostsFile=" + o.knownHosts,
  "-o", "ConnectTimeout=20",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=4",
  "-o", "LogLevel=ERROR",
  ...(o.extra ?? []),
  ...extra,
  (o.login ?? "ubi") + "@" + host,
];

/** The remote command for a user: root through sudo, the run user through sudo -u from its home. */
export const asUser = (command: string, user: "root" | "run", runUser = "run") => (user === "root" ? "sudo -n bash -c " + shq(command) : "sudo -n -u " + runUser + " -H bash -c " + shq("cd ~ && " + command));

export type SshRunner = (host: string, command: string, o: ExecOptions & { input?: Uint8Array }) => Promise<ExecResult & { raw?: Uint8Array }>;

/** Every VM command over SSH, as root or the run user; an SSH failure is exit 255, a command past its limit exit 124. */
export function sshRunner(o: SshOptions & { wrap?: (command: string, user: "root" | "run") => string }): SshRunner {
  const wrap = o.wrap ?? ((c: string, u: "root" | "run") => asUser(c, u, o.runUser));
  return async (host, command, eo) => {
    const r = await runProcess([...sshArgs(o, host), wrap(command, eo.user ?? "run")], { input: eo.input, timeoutMs: eo.timeoutMs });
    return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
  };
}

/** A free local port on the loopback interface. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Waits until a local port accepts a connection. */
export async function portOpen(port: number, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((resolve) => {
      Bun.connect({ hostname: "127.0.0.1", port, socket: { open: (s) => (s.end(), resolve(true)), connectError: () => resolve(false), data: () => {} } }).catch(() => resolve(false));
    });
    if (ok) return true;
    await Bun.sleep(200);
  }
  return false;
}

export interface Tunnel {
  port: number;
  close: () => Promise<void>;
}

/** An SSH local forward from a free loopback port to 127.0.0.1:remotePort inside the VM. */
export function sshTunnel(o: SshOptions, address: (vm: Vm) => string): (vm: Vm, remotePort: number) => Promise<Tunnel> {
  return async (vm, remotePort) => {
    const port = await freePort();
    const p = Bun.spawn(sshArgs(o, address(vm), ["-N", "-o", "ExitOnForwardFailure=yes", "-L", "127.0.0.1:" + port + ":127.0.0.1:" + remotePort]), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const close = async () => {
      p.kill("SIGTERM");
      await p.exited;
    };
    if (!(await portOpen(port, 20_000))) {
      await close();
      fail("E_DC_INFRA_MISSING", "the SSH tunnel to " + vm.id + " port " + remotePort + " did not open");
    }
    return { port, close };
  };
}

export interface RealUbicloudOptions {
  project: string;
  location: string;
  size: string;
  image: string;
  publicKey: string;
  ssh: SshRunner;
  privateSubnet?: string;
  /** Where the token is read by name: the paid launcher's own process environment. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** The backend on Ubicloud's API with the real fetch, sleep and clock. The token is read by name and never logged. */
export function realUbicloud(o: RealUbicloudOptions): UbicloudBackend {
  const token = (o.env ?? process.env).UBICLOUD_API_KEY ?? "";
  if (!token) fail("E_USAGE", "UBICLOUD_API_KEY is not set for the paid launcher");
  return new UbicloudBackend({ project: o.project, location: o.location, token, size: o.size, image: o.image, publicKey: o.publicKey, fetch: globalThis.fetch.bind(globalThis), ssh: o.ssh, sleep: (ms) => Bun.sleep(ms), now: () => Date.now(), privateSubnet: o.privateSubnet });
}

/** BT: each named mirror's port on the controller host's private IPv4. */
export const MIRROR_PORTS: Record<MirrorName, number> = { npm: 4873, pypi: 3141, apt: 3142, dockerhub: 5000 };

/** BT: the cache server behind each mirror, pinned by version (read 2026-11-13). */
export const MIRROR_SERVERS: Record<MirrorName, string> = {
  npm: "verdaccio 7.1.0 from npm",
  pypi: "devpi-server 6.21.0 from PyPI",
  apt: "apt-cacher-ng from Ubuntu noble",
  dockerhub: "docker-registry (distribution) from Ubuntu noble, proxy mode to registry-1.docker.io",
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** The sandbox's mirror entries on the controller host's private IPv4, each with its terms record line. */
export function controllerMirrors(ip: string, terms: Record<MirrorName, string>): Mirror[] {
  if (!IPV4.test(ip)) fail("E_USAGE", "a mirror endpoint must be an IPv4 literal");
  const url: Record<MirrorName, string> = {
    npm: "http://" + ip + ":" + MIRROR_PORTS.npm + "/",
    pypi: "http://" + ip + ":" + MIRROR_PORTS.pypi + "/root/pypi/+simple/",
    apt: "http://" + ip + ":" + MIRROR_PORTS.apt + "/archive.ubuntu.com/ubuntu",
    dockerhub: "http://" + ip + ":" + MIRROR_PORTS.dockerhub,
  };
  return (["npm", "pypi", "apt", "dockerhub"] as const).map((name) => {
    if (!terms[name]?.trim()) fail("E_USAGE", "mirror " + name + " has no terms record line");
    return { name, host: ip, port: MIRROR_PORTS[name], url: url[name], terms: terms[name] };
  });
}

/** The controller host's mirror servers, bound to its private IPv4 only, as root shell lines. */
export function mirrorSetup(ip: string): string[] {
  if (!IPV4.test(ip)) fail("E_USAGE", "the mirrors bind to an IPv4 literal");
  const unit = (name: string, exec: string) => "printf '%s\\n' '[Unit]' 'After=network-online.target' '[Service]' " + shq("ExecStart=" + exec) + " 'Restart=always' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/" + name + ".service";
  return [
    "DEBIAN_FRONTEND=noninteractive apt-get install -y apt-cacher-ng docker-registry python3-venv nodejs npm",
    "printf 'Port:%s\\nBindAddress: %s\\n' " + MIRROR_PORTS.apt + " " + ip + " > /etc/apt-cacher-ng/zz-dc.conf && systemctl restart apt-cacher-ng",
    "printf 'version: 0.1\\nstorage:\\n  filesystem:\\n    rootdirectory: /var/lib/docker-registry\\nhttp:\\n  addr: %s:%s\\nproxy:\\n  remoteurl: https://registry-1.docker.io\\n' " + ip + " " + MIRROR_PORTS.dockerhub + " > /etc/docker/registry/config.yml && systemctl restart docker-registry",
    "npm install -g verdaccio@7.1.0",
    "mkdir -p /etc/verdaccio && printf 'storage: /var/lib/verdaccio\\nuplinks:\\n  npmjs:\\n    url: https://registry.npmjs.org/\\npackages:\\n  \"**\":\\n    access: $all\\n    proxy: npmjs\\nlisten: %s:%s\\n' " + ip + " " + MIRROR_PORTS.npm + " > /etc/verdaccio/config.yaml",
    unit("dc-verdaccio", "/usr/local/bin/verdaccio --config /etc/verdaccio/config.yaml"),
    "python3 -m venv /opt/devpi && /opt/devpi/bin/pip install devpi-server==6.21.0 && /opt/devpi/bin/devpi-init --serverdir /var/lib/devpi",
    unit("dc-devpi", "/opt/devpi/bin/devpi-server --serverdir /var/lib/devpi --host " + ip + " --port " + MIRROR_PORTS.pypi),
    "systemctl daemon-reload && systemctl enable --now dc-verdaccio dc-devpi",
  ];
}

// Copyright (c) 2026 Garry Tan. MIT License.
// The real seams under UbicloudBackend for paid runs: a process runner, the SSH runner every VM command goes through,
// an SSH tunnel for the controller's browser, the backend on the real fetch, sleep and clock with the Ubicloud token
// read by name, and the named package mirrors (npm, PyPI, Ubuntu apt and a Docker Hub pull-through cache) that the
// controller host serves on its private IPv4. Only the paid launcher and the controller service on its host construct
// realUbicloud; tests drive the same runner against local stand-ins.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";
import { DcError, fail } from "../errors.ts";
import { NODE } from "./install.ts";
import { MIRROR_NAMES, UbicloudBackend, type ExecOptions, type ExecResult, type Mirror, type MirrorName, type FileSource, type StreamRunner, type Vm } from "./sandbox.ts";

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

/** Runs argv with its stdout written straight into a local file (created or emptied, mode 600), never held in memory. */
export async function runProcessTo(argv: string[], path: string, o: { timeoutMs?: number } = {}): Promise<{ exit: number; stderr: string; timedOut: boolean }> {
  const fd = openSync(path, "w", 0o600);
  try {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: fd, stderr: "pipe" });
    let timedOut = false;
    const timer = o.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill("SIGKILL");
        }, o.timeoutMs)
      : null;
    try {
      const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
      return { exit: timedOut ? 124 : code, stderr: err, timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    closeSync(fd);
  }
}

/** Runs argv with its stdin streamed from a local file, or from another command's stdout through bash with pipefail. */
export async function runProcessFrom(argv: string[], source: FileSource, o: { timeoutMs?: number } = {}): Promise<{ exit: number; stderr: string; timedOut: boolean }> {
  const fd = "file" in source ? openSync(source.file, "r") : null;
  try {
    const cmd = "argv" in source ? ["bash", "-c", "set -o pipefail; " + source.argv.map(shq).join(" ") + " | " + argv.map(shq).join(" ")] : argv;
    const p = Bun.spawn(cmd, { stdin: fd ?? "ignore", stdout: "ignore", stderr: "pipe" });
    let timedOut = false;
    const timer = o.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill("SIGKILL");
        }, o.timeoutMs)
      : null;
    try {
      const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
      return { exit: timedOut ? 124 : code, stderr: err, timedOut };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export interface SshOptions {
  /** The private key file (mode 600) the launch made for its VMs. */
  keyPath: string;
  /** A known-hosts file of the launch's own; each VM's key is learnt on first contact. A call's own file (a VM's, UbicloudBackend knownHostsDir) replaces it. */
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

export type SshRunner = (host: string, command: string, o: ExecOptions & { input?: Uint8Array; knownHosts?: string }) => Promise<ExecResult & { raw?: Uint8Array }>;

/** The options with a call's own known_hosts file in place of the runner's, when the call names one. */
const withKnownHosts = <O extends SshOptions>(o: O, knownHosts: string | undefined): O => (knownHosts ? { ...o, knownHosts } : o);

/** Every VM command over SSH, as root or the run user; an SSH failure is exit 255, a command past its limit exit 124. */
export function sshRunner(o: SshOptions & { wrap?: (command: string, user: "root" | "run") => string }): SshRunner {
  const wrap = o.wrap ?? ((c: string, u: "root" | "run") => asUser(c, u, o.runUser));
  return async (host, command, eo) => {
    const r = await runProcess([...sshArgs(withKnownHosts(o, eo.knownHosts), host), wrap(command, eo.user ?? "run")], { input: eo.input, timeoutMs: eo.timeoutMs });
    return { exit: r.exit, stdout: new TextDecoder().decode(r.stdout), stderr: r.stderr, raw: r.stdout };
  };
}

/** sshRunner's streaming twin: the command's stdout goes into a local file, never into memory and never decoded as text. */
export function sshStreamer(o: SshOptions & { wrap?: (command: string, user: "root" | "run") => string }): StreamRunner {
  const wrap = o.wrap ?? ((c: string, u: "root" | "run") => asUser(c, u, o.runUser));
  return (host, command, path, eo) => runProcessTo([...sshArgs(withKnownHosts(o, eo.knownHosts), host), wrap(command, eo.user ?? "run")], path, { timeoutMs: eo.timeoutMs });
}

/** sshRunner's streaming upload: the command's stdin comes from a local file or a local command, never from memory. */
export function sshSender(o: SshOptions & { wrap?: (command: string, user: "root" | "run") => string }): (host: string, command: string, source: FileSource, eo: ExecOptions & { knownHosts?: string }) => Promise<{ exit: number; stderr: string }> {
  const wrap = o.wrap ?? ((c: string, u: "root" | "run") => asUser(c, u, o.runUser));
  return (host, command, source, eo) => runProcessFrom([...sshArgs(withKnownHosts(o, eo.knownHosts), host), wrap(command, eo.user ?? "run")], source, { timeoutMs: eo.timeoutMs });
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

/** An SSH local forward from a free loopback port to 127.0.0.1:remotePort inside the VM, on the VM's own known_hosts file when it has one. */
export function sshTunnel(o: SshOptions, address: (vm: Vm) => string, knownHostsOf: (vm: Vm) => string | undefined = () => undefined): (vm: Vm, remotePort: number) => Promise<Tunnel> {
  return async (vm, remotePort) => {
    const port = await freePort();
    const p = Bun.spawn(sshArgs(withKnownHosts(o, knownHostsOf(vm)), address(vm), ["-N", "-o", "ExitOnForwardFailure=yes", "-L", "127.0.0.1:" + port + ":127.0.0.1:" + remotePort]), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
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
  sshTo?: StreamRunner;
  sshFrom?: ReturnType<typeof sshSender>;
  privateSubnet?: string;
  /** Where the token is read by name: the paid launcher's own process environment. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Ubicloud's API; the real fetch when unset. */
  fetch?: typeof fetch;
  /** One known_hosts file per VM in this folder (UbicloudBackend knownHostsDir). */
  knownHostsDir?: string;
}

/** The backend on Ubicloud's API with the real fetch, sleep and clock. The token is read by name and never logged. */
export function realUbicloud(o: RealUbicloudOptions): UbicloudBackend {
  const token = (o.env ?? process.env).UBICLOUD_API_KEY ?? "";
  if (!token) fail("E_USAGE", "UBICLOUD_API_KEY is not set for the paid launcher");
  return new UbicloudBackend({ project: o.project, location: o.location, token, size: o.size, image: o.image, publicKey: o.publicKey, fetch: o.fetch ?? globalThis.fetch.bind(globalThis), ssh: o.ssh, sshTo: o.sshTo, sshFrom: o.sshFrom, sleep: (ms) => Bun.sleep(ms), now: () => Date.now(), privateSubnet: o.privateSubnet, knownHostsDir: o.knownHostsDir });
}

/**
 * The backend a paid launcher or the controller service builds: its own ed25519 key (made once, mode 600), the SSH
 * runner on it and Ubicloud with the token read by name. The launcher's key reaches the host VMs; the controller
 * host's own key reaches the sandboxes it creates. Each VM gets its own known_hosts file in <knownHosts>.d, named by
 * its id (UbicloudBackend knownHostsDir), so a VM on an address an earlier VM had never meets that VM's key.
 */
export async function keyedUbicloud(o: Omit<RealUbicloudOptions, "ssh" | "publicKey"> & { keyPath: string; knownHosts: string; runUser?: string; ssh?: SshRunner }): Promise<UbicloudBackend> {
  if (!existsSync(o.keyPath)) {
    mkdirSync(dirname(o.keyPath), { recursive: true, mode: 0o700 });
    const r = await runProcess(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "dc-launch", "-f", o.keyPath]);
    if (r.exit !== 0) fail("E_DC_INFRA_MISSING", "could not make the launch's SSH key");
  }
  const publicKey = readFileSync(o.keyPath + ".pub", "utf8").trim();
  const ssh = { keyPath: o.keyPath, knownHosts: o.knownHosts, runUser: o.runUser };
  const injected = o.ssh;
  const knownHostsDir = o.knownHosts + ".d";
  if (!injected) return realUbicloud({ ...o, publicKey, knownHostsDir, ssh: sshRunner(ssh), sshTo: o.sshTo ?? sshStreamer(ssh), sshFrom: o.sshFrom ?? sshSender(ssh) });
  return realUbicloud({
    ...o,
    publicKey,
    knownHostsDir,
    ssh: injected,
    sshTo:
      o.sshTo ??
      (async (host, command, path, eo) => {
        const r = await injected(host, command, eo);
        writeFileSync(path, r.raw ?? new TextEncoder().encode(r.stdout));
        return { exit: r.exit, stderr: r.stderr };
      }),
    sshFrom:
      o.sshFrom ??
      (async (host, command, source, eo) => {
        const input = "file" in source ? new Uint8Array(readFileSync(source.file)) : new Uint8Array(Bun.spawnSync(source.argv, { stdout: "pipe" }).stdout);
        const r = await injected(host, command, { ...eo, input });
        return { exit: r.exit, stderr: r.stderr };
      }),
  });
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

/** BT: where the controller host unpacks its own copy of the pinned Node (stage3/node-pin.json) that runs verdaccio. */
export const MIRROR_NODE_ROOT = "/opt/dc-mirror-node";
/** BT: the npm prefix verdaccio installs into, with the pinned Node's own npm. */
export const VERDACCIO_PREFIX = "/opt/dc-verdaccio";

/**
 * The controller host's mirror servers, bound to its private IPv4 only, as root shell lines. verdaccio 7.1.0 needs Node
 * 24 or later, so it runs under the sandboxes' pinned Node: the controller fetches that build from nodejs.org, checks its
 * sha256 against the pin, unpacks it at MIRROR_NODE_ROOT, installs verdaccio with that Node's npm into VERDACCIO_PREFIX
 * and starts it with that node. Ubuntu's nodejs (Node 18 on noble) is not installed; nothing else on the host uses it.
 */
export function mirrorSetup(ip: string, node: { version: string; sha256: string } = NODE): string[] {
  if (!IPV4.test(ip)) fail("E_USAGE", "the mirrors bind to an IPv4 literal");
  if (!/^\d+\.\d+\.\d+$/.test(node.version) || !/^[0-9a-f]{64}$/.test(node.sha256)) fail("E_USAGE", "the Node pin needs a version and a sha256");
  const unit = (name: string, exec: string) => "printf '%s\\n' '[Unit]' 'After=network-online.target' '[Service]' " + shq("ExecStart=" + exec) + " 'Restart=always' '[Install]' 'WantedBy=multi-user.target' > /etc/systemd/system/" + name + ".service";
  const file = "node-v" + node.version + "-linux-x64.tar.xz";
  const tarball = "/var/tmp/" + file;
  const bin = MIRROR_NODE_ROOT + "/bin/";
  return [
    "DEBIAN_FRONTEND=noninteractive apt-get install -y apt-cacher-ng docker-registry python3-venv curl xz-utils -o DPkg::Lock::Timeout=600",
    "printf 'Port:%s\\nBindAddress: %s\\n' " + MIRROR_PORTS.apt + " " + ip + " > /etc/apt-cacher-ng/zz-dc.conf && systemctl restart apt-cacher-ng",
    "printf 'version: 0.1\\nstorage:\\n  filesystem:\\n    rootdirectory: /var/lib/docker-registry\\nhttp:\\n  addr: %s:%s\\nproxy:\\n  remoteurl: https://registry-1.docker.io\\n' " + ip + " " + MIRROR_PORTS.dockerhub + " > /etc/docker/registry/config.yml && systemctl restart docker-registry",
    "curl -fsSL --retry 3 -o " + tarball + " https://nodejs.org/dist/v" + node.version + "/" + file,
    "test \"$(sha256sum " + tarball + " | cut -d ' ' -f 1)\" = " + node.sha256 + " || { echo 'the Node tarball is not the pinned build' >&2; exit 1; }",
    "rm -rf " + MIRROR_NODE_ROOT + " && mkdir -p " + MIRROR_NODE_ROOT + " && tar -xJf " + tarball + " -C " + MIRROR_NODE_ROOT + " --strip-components=1 --no-same-owner && rm -f " + tarball,
    "test \"$(" + bin + "node --version)\" = v" + node.version,
    "PATH=" + MIRROR_NODE_ROOT + "/bin:$PATH " + bin + "npm install -g --prefix " + VERDACCIO_PREFIX + " verdaccio@7.1.0",
    "mkdir -p /etc/verdaccio && printf 'storage: /var/lib/verdaccio\\nuplinks:\\n  npmjs:\\n    url: https://registry.npmjs.org/\\npackages:\\n  \"**\":\\n    access: $all\\n    proxy: npmjs\\nlisten: %s:%s\\n' " + ip + " " + MIRROR_PORTS.npm + " > /etc/verdaccio/config.yaml",
    unit("dc-verdaccio", bin + "node " + VERDACCIO_PREFIX + "/lib/node_modules/verdaccio/bin/verdaccio --config /etc/verdaccio/config.yaml"),
    "python3 -m venv /opt/devpi && /opt/devpi/bin/pip install devpi-server==6.21.0 && /opt/devpi/bin/devpi-init --serverdir /var/lib/devpi",
    unit("dc-devpi", "/opt/devpi/bin/devpi-server --serverdir /var/lib/devpi --host " + ip + " --port " + MIRROR_PORTS.pypi),
    "systemctl daemon-reload && systemctl enable --now dc-verdaccio dc-devpi",
  ];
}

/** BT: each mirror's protocol-level readiness check on the controller host: the path that answers HTTP 200 while its server serves, and its systemd unit. */
export const MIRROR_CHECKS: Record<MirrorName, { path: string; unit: string }> = {
  npm: { path: "/-/ping", unit: "dc-verdaccio" },
  pypi: { path: "/+api", unit: "dc-devpi" },
  apt: { path: "/acng-report.html", unit: "apt-cacher-ng" },
  dockerhub: { path: "/v2/", unit: "docker-registry" },
};
/** BT: how long the readiness check waits for every mirror to answer HTTP 200, in seconds. */
export const MIRROR_WAIT_SECONDS = 180;
/** BT: the most of a failing unit's journal a refusal quotes, in characters (its last lines, stack frames left out). */
export const MIRROR_JOURNAL_CHARS = 400;
export const MIRRORS_DONE = "DC-MIRRORS-DONE";

/**
 * The root shell command that checks every mirror on the controller host's private IPv4: each check path polled with
 * curl until all four answer HTTP 200 or the wait ends, then one tab-separated line per mirror (its name, the last HTTP
 * code, its unit's systemctl is-active state and, for a mirror that did not answer 200, its unit's last journal lines in
 * base64), then MIRRORS_DONE.
 */
export function mirrorReadyCommand(ip: string, waitSeconds: number = MIRROR_WAIT_SECONDS): string {
  if (!IPV4.test(ip)) fail("E_USAGE", "the mirror check needs an IPv4 literal");
  const list = MIRROR_NAMES.map((n) => shq(n + " " + MIRROR_PORTS[n] + " " + MIRROR_CHECKS[n].path + " " + MIRROR_CHECKS[n].unit)).join(" ");
  return [
    "end=$((SECONDS + " + Math.round(waitSeconds) + "))",
    "codes() { for m in " + list + "; do set -- $m; printf '%s %s\\n' \"$1\" \"$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://" + ip + ":$2$3)\"; done; }",
    "while got=$(codes); printf '%s\\n' \"$got\" | grep -qv ' 200$' && [ \"$SECONDS\" -lt \"$end\" ]; do sleep 3; done",
    "for m in " + list + "; do set -- $m; code=$(printf '%s\\n' \"$got\" | awk -v n=\"$1\" '$1 == n { print $2 }'); log=''; [ \"$code\" = 200 ] || log=$(journalctl -u \"$4\" -n 40 --no-pager -o cat 2>/dev/null | grep -v '^[[:space:]]*at ' | tail -n 8 | base64 -w 0); printf '%s\\t%s\\t%s\\t%s\\n' \"$1\" \"$code\" \"$(systemctl is-active \"$4\")\" \"$log\"; done",
    "echo " + MIRRORS_DONE,
  ].join("\n");
}

export interface MirrorState {
  name: MirrorName;
  /** The last HTTP code its check path answered; 000 when no HTTP response came. */
  code: string;
  /** Its unit's systemctl is-active state. */
  state: string;
  /** Its unit's last journal lines, read only when it did not answer 200. */
  journal: string;
}

/** Reads the check's lines: one per mirror, each named once. Null when the end marker is missing or a line does not read. */
export function parseMirrorReady(text: string): MirrorState[] | null {
  const lines = text.split("\n");
  const done = lines.indexOf(MIRRORS_DONE);
  if (done < 0) return null;
  const rows: MirrorState[] = [];
  for (const l of lines.slice(0, done).filter(Boolean)) {
    const [name, code, state, log, ...rest] = l.split("\t");
    if (rest.length || !MIRROR_NAMES.includes(name as MirrorName) || !/^\d{3}$/.test(code ?? "") || !state || rows.some((r) => r.name === name)) return null;
    rows.push({ name: name as MirrorName, code: code!, state, journal: log ? Buffer.from(log, "base64").toString("utf8") : "" });
  }
  return rows.length === MIRROR_NAMES.length ? rows : null;
}

/** One line per mirror that did not answer HTTP 200: its name, check, unit state and journal tail, cut to MIRROR_JOURNAL_CHARS. */
export function mirrorProblems(rows: MirrorState[], ip: string, waitSeconds: number = MIRROR_WAIT_SECONDS): string[] {
  return rows
    .filter((r) => r.code !== "200")
    .map((r) => {
      const c = MIRROR_CHECKS[r.name];
      const log = r.journal.split("\n").map((l) => l.trim()).filter(Boolean).join(" | ");
      const tail = log.length > MIRROR_JOURNAL_CHARS ? "..." + log.slice(-MIRROR_JOURNAL_CHARS) : log;
      return "the " + r.name + " mirror (http://" + ip + ":" + MIRROR_PORTS[r.name] + c.path + ") answered " + (r.code === "000" ? "no HTTP response" : "HTTP " + r.code) + " within " + waitSeconds + " s; " + c.unit + " is " + r.state + (tail ? "; its journal ends: " + tail : "");
    });
}

/** Refuses with E_DCH_MIRROR_DOWN unless every mirror on the controller host answers its readiness check within the wait. */
export async function checkMirrors(exec: (command: string, o: ExecOptions) => Promise<ExecResult>, ip: string, waitSeconds: number = MIRROR_WAIT_SECONDS): Promise<void> {
  const r = await exec(mirrorReadyCommand(ip, waitSeconds), { user: "root", timeoutMs: (waitSeconds + 90) * 1000 });
  const rows = r.exit === 0 ? parseMirrorReady(r.stdout) : null;
  if (!rows) throw new DcError("E_DCH_MIRROR_DOWN", "the controller host's mirror check returned no readable result (exit " + r.exit + "), so no mirror is known to serve");
  const down = mirrorProblems(rows, ip, waitSeconds);
  if (down.length) throw new DcError("E_DCH_MIRROR_DOWN", down.join("; "));
}

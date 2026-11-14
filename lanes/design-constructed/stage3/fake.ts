// Copyright (c) 2026 Garry Tan. MIT License.
// A simulated Ubicloud for the keyless tests and dry-run cases: the real UbicloudBackend wired to a fake fetch and a fake
// ssh, so every audit runs through the real backend's commands and result parsing on invented fixtures. Nothing here
// creates a VM, opens a socket or reads a key.
// Adapted from lanes/devex/stage3/fake.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (branch build-devex-review-eval).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { NODE, NODE_ROOT } from "./install.ts";
import { MIRROR_CHECKS, MIRRORS_DONE } from "./ubicloud-real.ts";
import { AUDIT_COMMANDS, AUDIT_DIR, MIRROR_NAMES, type MirrorName, allowed, DESCRIBE_DONE, WORK_DONE, DROP_PREFIX, END_MARK, NET_PREFIX, secretHit, START_MARK, UbicloudBackend, type Connection, type ExecResult, type Mirror, type ProcessRow, type StatEntry, type VmSpec } from "./sandbox.ts";
import type { HostsSeam, MoneySeam } from "./seams.ts";
import type { LedgerItemId } from "../types.ts";

export type AuditCommand = keyof typeof AUDIT_COMMANDS;

export interface FakeVm {
  id: string;
  ip: string;
  spec: VmSpec | null;
  calls: Array<{ command: string; user: string }>;
  files: Map<string, Uint8Array>;
  processes: ProcessRow[];
  egress: Connection[];
  blocked: Connection[];
  /** Files written outside /work since the run started (stat rows). */
  written: StatEntry[];
  /** Files the session wrote under /work after its start marker (the audit's /work list). */
  work: string[];
  /** Files the controller's install unpacked (one per tar, holding the tar's bytes), in order. */
  installed: string[];
  /** Whether Docker is installed. Like the real ubuntu-noble image, a VM has none until the controller's install. */
  docker: boolean;
  /** Whether Node is installed: none until the controller's install unpacks it. */
  node: boolean;
  /** The inet dc table's output chain as the preamble's nft commands left it (nftAnswer); chain is null until one makes it. */
  nft: { table: boolean; chain: { hook: string; policy: string } | null; rules: string[] };
  /** The VM drops its own SSH replies (a drop-policy output chain with no established accept): every exec exits 255. */
  cut: boolean;
  /**
   * Folders that exist: the image's own, the run user's home, and every mkdir -p a command ran. A write into any other
   * folder fails, except into the audit folder, whose commands the fake simulates as collectable without the preamble.
   */
  dirs: Set<string>;
  /** The host's systemd units by name (the controller's mirrors): the ExecStart line written, the state and the journal. */
  units: Map<string, FakeUnit>;
  /** Node builds by the path of their node binary, with their version: Ubuntu's nodejs, or an unpacked tarball. */
  nodes: Map<string, string>;
}

export interface FakeUnit {
  exec: string;
  state: "active" | "failed" | "inactive";
  journal: string[];
}

/** The folders a fresh ubuntu-noble VM has that the runs write into; /work is not one of them. */
const IMAGE_DIRS = ["/", "/etc", "/opt", "/tmp", "/var", "/var/lib", "/usr", "/usr/bin", "/usr/local", "/usr/local/bin", "/root", "/home", "/run"];
const addDir = (vm: FakeVm, path: string) => {
  for (let p = path.replace(/\/+$/, ""); p; p = p.slice(0, p.lastIndexOf("/"))) vm.dirs.add(p);
};

export interface FakeFaults {
  /** Audit commands that exit with this status. */
  exit?: Partial<Record<AuditCommand, number>>;
  /** Audit commands that exit 0 and print nothing. */
  empty?: AuditCommand[];
  /** Audit commands whose output stops short (the last part lost). */
  cut?: AuditCommand[];
  /** The egress filter's listing replaced, for a rule the run did not set. */
  ruleset?: string;
  /** Preamble steps (by substring) that exit 1. */
  preamble?: string[];
}

/** Answers a run's own commands (install, build, the agent's work); undefined means exit 0 with no output. */
export type FakeHandler = (vm: FakeVm, command: string) => Partial<ExecResult> | undefined;

export interface FakeWorld {
  vms: FakeVm[];
  deleted: string[];
  faults: FakeFaults;
  handler: FakeHandler;
  /** Called once per VM after create, to plant processes, egress, written files. */
  plant: (vm: FakeVm) => void;
  /** Answers a VM's SSH commands before the simulated ones, input included, for a local SSH stand-in; undefined falls through. */
  ssh?: (vm: FakeVm, command: string, input: Uint8Array | undefined, user: string) => Promise<(ExecResult & { raw?: Uint8Array }) | undefined>;
  /** Answers a VM's streamed reads (the stdout goes to path) before the simulated ones; undefined falls through to ssh. */
  sshTo?: (vm: FakeVm, command: string, path: string, user: string) => Promise<{ exit: number; stderr: string } | undefined>;
  /** Faults on Ubicloud's API: a status or a thrown error per method, for the nth call of that method (1-based) or every call. */
  api?: Partial<Record<"POST" | "GET" | "DELETE", { status?: number; throws?: string; nth?: number }>>;
  /** Mirrors the controller does not serve: a sandbox step that fetches through one fails as its package manager does. */
  mirrorsDown?: MirrorName[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const ok = (stdout = ""): ExecResult => ({ exit: 0, stdout, stderr: "" });

/** The nft listing the preamble's rules produce on a healthy VM. */
export function rulesetText(spec: VmSpec): string {
  return [
    "table inet dc {",
    "\tchain out {",
    "\t\ttype filter hook output priority filter; policy drop;",
    '\t\toif "lo" accept',
    "\t\tct state established,related accept",
    ...allowed(spec).map((e) => "\t\tip daddr " + e.host + " tcp dport " + e.port + ' ct state new log prefix "DCNET " accept'),
    '\t\tlog prefix "DCDROP " drop',
    "\t}",
    "}",
  ].join("\n");
}

const netLine = (prefix: string, c: Connection) => prefix + "IN= OUT=ens3 SRC=10.1.0.9 DST=" + c.host + (c.port === 0 ? (c.proto === "2" ? " LEN=40 TOS=0x00 PREC=0xC0 TTL=1 ID=0 DF PROTO=2" : " LEN=84 PROTO=" + (c.proto ?? "ICMP") + " TYPE=8 CODE=0 ID=1 SEQ=1") : " LEN=60 PROTO=TCP SPT=40100 DPT=" + c.port + " SYN");

/** The listing nft gives for the chain a fake VM holds: lo quoted, priority 0 named filter, rules in their order. */
const nftListing = (n: FakeVm["nft"]): string =>
  ["table inet dc {", "\tchain out {", "\t\ttype filter hook " + n.chain!.hook + " priority filter; policy " + n.chain!.policy + ";", ...n.rules.map((r) => "\t\t" + r.replace(/^oif (\w+) /, 'oif "$1" ')), "\t}", "}"].join("\n");

const ESTABLISHED = /^ct state (established,related|related,established) accept$/;

/**
 * The egress filter's nft commands on a fake VM: one transaction from a here-document (stage3/sandbox.ts egressFilter),
 * applied whole or not at all, or the steps one at a time (add table, add chain, add rule). Once the output chain's
 * policy is drop and it holds no established accept, the VM drops its own SSH replies: that command and every later
 * one exit 255 with no output, as SSH does. Undefined for every other command, the audit's listing included.
 */
function nftAnswer(w: FakeWorld, vm: FakeVm, command: string): ExecResult | undefined {
  if (!/^nft (-f |add |'add )/.test(command)) return undefined;
  if (w.faults.preamble?.some((s) => command.includes(s))) return { exit: 1, stdout: "", stderr: "fake preamble failure" };
  const chainOf = (text: string) => {
    const m = /^type filter hook (\w+) priority \S+; policy (\w+);$/.exec(text.trim());
    return m ? { hook: m[1]!, policy: m[2]! } : null;
  };
  const no = (why: string): ExecResult => ({ exit: 1, stdout: "", stderr: "fake nft: " + why });
  const draft = { table: vm.nft.table, chain: vm.nft.chain, rules: [...vm.nft.rules] };
  const file = /^nft -f - <<'(\w+)'\n([\s\S]*)\n\1$/.exec(command);
  if (file) {
    const open: string[] = [];
    for (const line of file[2]!.split("\n").map((l) => l.trim()).filter(Boolean)) {
      if (line === "table inet dc {" && !open.length) (open.push("table"), (draft.table = true));
      else if (line === "chain out {" && open.join() === "table") open.push("chain");
      else if (line === "}" && open.length) open.pop();
      else if (open.join() !== "table,chain") return no("unexpected line " + line);
      else if (line.startsWith("type ")) {
        draft.chain = chainOf(line);
        if (!draft.chain) return no("bad chain line " + line);
      } else if (!draft.chain) return no("a rule before the chain's type line");
      else draft.rules.push(line);
    }
    if (open.length || !draft.chain) return no("the transaction is cut or makes no chain");
  } else {
    const plain = command.replace(/'([^']*)'/g, "$1");
    const chain = /^nft add chain inet dc out \{ (.*) \}$/.exec(plain);
    const rule = /^nft add rule inet dc out (.+)$/.exec(plain);
    if (plain === "nft add table inet dc") draft.table = true;
    else if (chain && draft.table && chainOf(chain[1]!)) draft.chain = chainOf(chain[1]!);
    else if (rule && draft.chain) draft.rules.push(rule[1]!);
    else return no(plain);
  }
  vm.nft = draft;
  if (draft.chain?.hook === "output" && draft.chain.policy === "drop" && !draft.rules.some((r) => ESTABLISHED.test(r))) vm.cut = true;
  return vm.cut ? { exit: 255, stdout: "", stderr: "" } : ok();
}

function auditOutput(w: FakeWorld, vm: FakeVm, name: AuditCommand): ExecResult {
  const f = w.faults;
  if (f.exit?.[name] !== undefined) return { exit: f.exit[name]!, stdout: "", stderr: "fake failure" };
  if (f.empty?.includes(name)) return ok("");
  let out = "";
  if (name === "ruleset") out = f.ruleset ?? (vm.nft.chain ? nftListing(vm.nft) : rulesetText(vm.spec!));
  if (name === "processes") out = vm.processes.map((p) => String(p.pid).padStart(6) + " " + p.user + " " + p.args).join("\n") + "\nDC-PS-DONE\n";
  if (name === "egress") out = ["kernel: boot", START_MARK, ...vm.egress.map((c) => netLine(NET_PREFIX, c)), ...vm.blocked.map((c) => netLine(DROP_PREFIX, c)), END_MARK].join("\n") + "\n";
  if (name === "files") out = [...vm.written, { path: AUDIT_DIR + "/end", size: 0, mode: 0o644, mtime: "2026-11-14T00:00:00", type: "f" }].map((r) => [r.path, r.size, r.mode.toString(8), r.mtime, r.type].join("\t")).join("\n") + "\nDC-FIND-DONE\n";
  if (name === "work") out = vm.work.map((p) => p + "\0").join("") + "\n" + WORK_DONE + "\n";
  if (name === "controller") {
    const list = dec.decode(vm.files.get(AUDIT_DIR + "/controller.now") ?? new Uint8Array()).split("\0").filter(Boolean);
    out = [...list.map((p) => describeLine(vm, p)), DESCRIBE_DONE].join("\n") + "\n";
  }
  if (name === "scan") {
    const list = dec.decode(vm.files.get(AUDIT_DIR + "/scan.list") ?? new Uint8Array()).split("\0").filter(Boolean);
    const rows: string[] = [];
    for (const p of list) {
      const data = vm.files.get(p);
      if (!data) rows.push("ERR\t" + p);
      else if (secretHit(dec.decode(data))) rows.push("HIT\t" + p);
    }
    out = [...rows, "DC-SCAN-DONE"].join("\n") + "\n";
  }
  if (f.cut?.includes(name)) out = out.slice(0, Math.floor(out.length / 2));
  return ok(out);
}

/**
 * Node and the egress log's check on a fake VM (node --version and corepack fail until the install unpacks Node; the DCNET count
 * reads the planted egress), and Docker: the daemon.json the preamble writes, no docker unit until apt installs docker.io (which writes
 * /usr/bin/dockerd, a file the manifest lists like the rest), and docker info listing daemon.json's mirror with one
 * trailing slash, as dockerd normalises it, for the install's grep. Undefined for every other command.
 */
function dockerAnswer(vm: FakeVm, command: string): ExecResult | undefined {
  if (/node --version|corepack (enable|--version)/.test(command) && !vm.node) return { exit: 127, stdout: "", stderr: "node: command not found" };
  if (command.includes("grep -c " + NET_PREFIX.trim())) return { exit: vm.egress.length ? 0 : 1, stdout: vm.egress.length + "\n", stderr: "" };
  const daemon = /'([^']*)' > \/etc\/docker\/daemon\.json/.exec(command);
  if (daemon) vm.files.set("/etc/docker/daemon.json", enc.encode(JSON.stringify({ "registry-mirrors": [daemon[1]] }) + "\n"));
  if (/\bsystemctl (restart|start|enable --now) docker\b/.test(command) && !vm.docker) return { exit: 5, stdout: "", stderr: "Failed to start docker.service: Unit docker.service not found." };
  if (command.includes("apt-get install") && / docker\.io\b/.test(command)) {
    vm.docker = true;
    vm.blocked.push({ host: "224.0.0.22", port: 0, proto: "2" });
    vm.files.set("/usr/bin/dockerd", enc.encode("fake dockerd"));
    vm.installed.push("/usr/bin/dockerd");
    vm.written.push({ path: "/usr/bin/dockerd", size: 12, mode: 0o755, mtime: "2026-11-14T00:00:00", type: "f" });
    return ok();
  }
  if (command.includes("docker info")) {
    const mirrors = (JSON.parse(dec.decode(vm.files.get("/etc/docker/daemon.json") ?? enc.encode("{}")))["registry-mirrors"] ?? []) as string[];
    const want = /grep -qxF '([^']*)'/.exec(command)?.[1];
    return mirrors.some((m) => m.replace(/\/$/, "") + "/" === want) ? ok() : { exit: 1, stdout: "", stderr: "" };
  }
  return undefined;
}


/** BT: the journal dc-verdaccio left under Ubuntu noble's Node 18 on a real controller (2026-11-14), its stack frames left out. */
const esmJournal = (unit: string, version: string) => [
  "Error [ERR_REQUIRE_ESM]: require() of ES Module /usr/local/lib/node_modules/verdaccio/node_modules/lodash-es/lodash.js from /usr/local/lib/node_modules/verdaccio/node_modules/@verdaccio/config/build/agent.js not supported.",
  "  code: 'ERR_REQUIRE_ESM'",
  "}",
  "Node.js v" + version,
  unit + ".service: Main process exited, code=exited, status=1/FAILURE",
  unit + ".service: Failed with result 'exit-code'.",
  unit + ".service: Scheduled restart job, restart counter is at 5.",
  unit + ".service: Start request repeated too quickly.",
  unit + ".service: Failed with result 'exit-code'.",
  "Failed to start " + unit + ".service.",
];
/** BT: Ubuntu noble's nodejs package. */
const APT_NODE = "18.19.1";

/** Starts a unit as systemd would: its program must exist, a node script runs under its node, and verdaccio 7.1.0 needs Node 24. */
function startUnit(vm: FakeVm, name: string): void {
  const u = vm.units.get(name);
  if (!u) return;
  const [prog = "", script = ""] = u.exec.split(" ");
  const shebang = vm.files.has(prog) && dec.decode(vm.files.get(prog)).startsWith("#!/usr/bin/env node");
  const node = vm.nodes.has(prog) ? vm.nodes.get(prog)! : shebang ? (vm.nodes.get("/usr/local/bin/node") ?? vm.nodes.get("/usr/bin/node") ?? null) : undefined;
  const file = vm.nodes.has(prog) ? script : prog;
  const failed = (journal: string[]) => void Object.assign(u, { state: "failed", journal: [...u.journal, ...journal] });
  if (!vm.files.has(file)) return failed([name + ".service: Main process exited, code=exited, status=203/EXEC", "Failed to start " + name + ".service."]);
  if (node === null) return failed(["/usr/bin/env: 'node': No such file or directory", "Failed to start " + name + ".service."]);
  if (/verdaccio/.test(file) && node !== undefined && Number(node.split(".")[0]) < 24) return failed(esmJournal(name, node));
  u.state = "active";
}

/**
 * The controller host's mirror setup on a fake VM (stage3/ubicloud-real.ts mirrorSetup, and the lines it replaced): apt's
 * packages, the pinned Node fetched from nodejs.org and sha256-checked (the fake's nodejs.org serves the pinned build only
 * under the pinned version), verdaccio installed by whichever npm the line names, the unit files, the starts, and the
 * readiness check, which answers HTTP 200 for a mirror only while its unit is active. Undefined for every other command.
 */
function mirrorHostAnswer(vm: FakeVm, command: string): ExecResult | undefined {
  if (command.startsWith("end=$((SECONDS") && command.includes(MIRRORS_DONE)) {
    const rows = MIRROR_NAMES.map((n) => {
      const u = vm.units.get(MIRROR_CHECKS[n].unit);
      const up = u?.state === "active";
      return [n, up ? "200" : "000", u?.state ?? "inactive", up || !u?.journal.length ? "" : Buffer.from(u.journal.slice(-8).join("\n") + "\n").toString("base64")].join("\t");
    });
    return ok(rows.join("\n") + "\n" + MIRRORS_DONE + "\n");
  }
  const apt = /apt-get install -y (.*?) -o DPkg/.exec(command);
  if (apt && /\bapt-cacher-ng\b/.test(apt[1]!)) {
    const pkgs = apt[1]!.split(" ");
    for (const [pkg, bin] of [["apt-cacher-ng", "/usr/sbin/apt-cacher-ng"], ["docker-registry", "/usr/bin/docker-registry"]] as const)
      if (pkgs.includes(pkg)) (vm.files.set(bin, enc.encode("fake " + pkg)), vm.units.set(pkg, { exec: bin, state: "active", journal: [] }));
    if (pkgs.includes("nodejs")) vm.nodes.set("/usr/bin/node", APT_NODE);
    if (pkgs.includes("npm")) vm.files.set("/usr/bin/npm", enc.encode("#!/usr/bin/env node\n"));
    return ok();
  }
  const fetched = /^curl -fsSL --retry 3 -o (\S+) https:\/\/nodejs\.org\/dist\/v([\d.]+)\/node-v\2-linux-x64\.tar\.xz$/.exec(command);
  if (fetched) return (vm.files.set(fetched[1]!, enc.encode("nodejs.org node " + fetched[2])), ok());
  const sum = /^test "\$\(sha256sum (\S+) \| cut -d ' ' -f 1\)" = ([0-9a-f]{64})/.exec(command);
  if (sum) return dec.decode(vm.files.get(sum[1]!) ?? new Uint8Array()) === "nodejs.org node " + NODE.version && sum[2] === NODE.sha256 ? ok() : { exit: 1, stdout: "", stderr: "the Node tarball is not the pinned build" };
  const unpack = /tar -xJf (\S+) -C (\S+) --strip-components=1/.exec(command);
  if (unpack) {
    const got = /^nodejs\.org node ([\d.]+)$/.exec(dec.decode(vm.files.get(unpack[1]!) ?? new Uint8Array()));
    if (!got) return { exit: 2, stdout: "", stderr: "tar: " + unpack[1] + ": Cannot open: No such file or directory" };
    vm.nodes.set(unpack[2] + "/bin/node", got[1]!);
    vm.files.set(unpack[2] + "/bin/npm", enc.encode("#!/usr/bin/env node\n"));
    vm.files.delete(unpack[1]!);
    return ok();
  }
  const version = /^test "\$\((\S+) --version\)" = v([\d.]+)$/.exec(command);
  if (version) return vm.nodes.get(version[1]!) === version[2] ? ok() : { exit: 1, stdout: "", stderr: "" };
  const npm = /(?:^|\s)(\S*npm) install -g (?:--prefix (\S+) )?verdaccio@[\d.]+$/.exec(command);
  if (npm) {
    const runs = npm[1] === "npm" ? (vm.files.has("/usr/bin/npm") ? vm.nodes.get("/usr/bin/node") : undefined) : vm.nodes.get(npm[1]!.replace(/npm$/, "node"));
    if (runs === undefined) return { exit: 127, stdout: "", stderr: "npm: command not found" };
    const prefix = npm[2] ?? "/usr/local";
    vm.files.set(prefix + "/lib/node_modules/verdaccio/bin/verdaccio", enc.encode("#!/usr/bin/env node\n"));
    vm.files.set(prefix + "/bin/verdaccio", enc.encode("#!/usr/bin/env node\n"));
    return ok();
  }
  if (/^python3 -m venv \/opt\/devpi && \/opt\/devpi\/bin\/pip install devpi-server==/.test(command)) return (vm.files.set("/opt/devpi/bin/devpi-server", enc.encode("fake devpi-server")), ok());
  const unit = /'ExecStart=([^']*)'.* > \/etc\/systemd\/system\/([\w-]+)\.service$/.exec(command);
  if (unit) return (vm.units.set(unit[2]!, { exec: unit[1]!, state: "inactive", journal: [] }), ok());
  const start = /systemctl (?:daemon-reload && systemctl )?(?:enable --now|restart) ([\w -]+)$/.exec(command);
  if (start && start[1]!.split(" ").some((n) => vm.units.has(n))) {
    for (const n of start[1]!.split(" ")) startUnit(vm, n);
    return ok();
  }
  return undefined;
}

/** The mirrors whose units a fake controller does not run, for a sandbox world's mirrorsDown. */
export const downMirrors = (vm: FakeVm): MirrorName[] => MIRROR_NAMES.filter((n) => vm.units.get(MIRROR_CHECKS[n].unit)?.state !== "active");

/** Plants the four mirror units as running, for a keyless host whose provisioning skips the system installs. */
export function serveMirrors(vm: FakeVm): void {
  for (const n of MIRROR_NAMES) vm.units.set(MIRROR_CHECKS[n].unit, { exec: "planted", state: "active", journal: [] });
}

/** BT: the sandbox steps that fetch through each mirror, and how each fails when nothing serves it (corepack's error as a real sandbox printed it). */
const MIRROR_USERS: Array<{ name: MirrorName; uses: RegExp; fails: (m: Mirror) => ExecResult }> = [
  { name: "npm", uses: /(?:^|&& |-c ')(?:pnpm|yarn|npx|npm (?:ci|install|i|run|view))\b/, fails: (m) => ({ exit: 1, stdout: "", stderr: "Error: Error when performing the request to " + m.url.replace(/\/$/, "") + "/pnpm; for troubleshooting help, see https://github.com/nodejs/corepack#troubleshooting\n    at fetch (corepack.cjs)\n  cause: connect ECONNREFUSED " + m.host + ":" + m.port }) },
  { name: "dockerhub", uses: /(?:^|&& )docker (?:pull|run)\b/, fails: () => ({ exit: 125, stdout: "", stderr: "docker: Error response from daemon: Get \"https://registry-1.docker.io/v2/\": dial tcp: lookup registry-1.docker.io: Temporary failure in name resolution" }) },
  { name: "apt", uses: /\bapt-get (?:update|install)\b/, fails: (m) => ({ exit: 100, stdout: "", stderr: "E: Failed to fetch " + m.url + "/dists/noble/InRelease  Could not connect to " + m.host + ":" + m.port + " (" + m.host + "). - connect (111: Connection refused)" }) },
  { name: "pypi", uses: /\bpip3? install\b/, fails: (m) => ({ exit: 1, stdout: "", stderr: "ERROR: Could not find a version that satisfies the requirement (connection to " + m.host + ":" + m.port + " refused)" }) },
];

/** A sandbox step that fetches through a mirror the world's controller does not serve; undefined for every other command. */
function mirrorDownAnswer(w: FakeWorld, vm: FakeVm, command: string): ExecResult | undefined {
  for (const u of MIRROR_USERS) {
    const m = vm.spec?.mirrors.find((x) => x.name === u.name);
    if (m && w.mirrorsDown?.includes(u.name) && u.uses.test(command)) return u.fails(m);
  }
  return undefined;
}

const describeLine = (vm: FakeVm, p: string) => {
  const data = vm.files.get(p);
  return data ? "f\t" + createHash("sha256").update(data).digest("hex") + "\t" + p : "x\t-\t" + p;
};

/** A world whose VMs are clean by default: init and the run user's shell, egress to the allowed endpoints only. */
export function fakeWorld(o: Partial<Pick<FakeWorld, "faults" | "handler" | "plant" | "ssh" | "sshTo" | "api" | "mirrorsDown">> = {}): FakeWorld {
  return { vms: [], deleted: [], faults: o.faults ?? {}, handler: o.handler ?? (() => undefined), plant: o.plant ?? (() => {}), ssh: o.ssh, sshTo: o.sshTo, api: o.api, mirrorsDown: o.mirrorsDown };
}

/** The real backend on the world: fetch answers Ubicloud's VM calls, ssh answers the VM's commands. */
export function fakeBackend(w: FakeWorld): UbicloudBackend {
  const byIp = new Map<string, FakeVm>();
  const byName = new Map<string, FakeVm>();
  const calls: Record<string, number> = {};
  const fetchFake = (async (_url: string, init: { body?: string }) => {
    const argv = (JSON.parse(String(init.body ?? "{}")) as { argv: string[] }).argv;
    const name = argv[1]!.split("/").pop()!;
    const method = argv[2] === "create" ? "POST" : argv[2] === "show" ? "GET" : "DELETE";
    calls[method] = (calls[method] ?? 0) + 1;
    const fault = w.api?.[method];
    if (fault && (fault.nth === undefined || fault.nth === calls[method])) {
      if (fault.throws) throw new Error(fault.throws);
      if (fault.status) return new Response("! fault", { status: fault.status });
    }
    if (method !== "POST" && (!byName.has(name) || w.deleted.includes(name))) return new Response("! Unexpected response status: 404", { status: 404 });
    if (method === "POST") {
      const vm: FakeVm = { id: name, ip: "10.1.0." + (w.vms.length + 10), spec: null, calls: [], files: new Map(), processes: [], egress: [], blocked: [], written: [], work: [], installed: [], docker: false, node: false, nft: { table: false, chain: null, rules: [] }, cut: false, dirs: new Set(IMAGE_DIRS), units: new Map(), nodes: new Map() };
      w.vms.push(vm);
      byName.set(name, vm);
      byIp.set(vm.ip, vm);
      return new Response("VM created with id: " + name, { status: 200 });
    }
    if (method === "GET") return new Response("state: running\nip4: " + byName.get(name)!.ip + "\nprivate-ipv4: \n", { status: 200 });
    w.deleted.push(name);
    return new Response("VM, if it exists, is now scheduled for destruction", { status: 200 });
  }) as unknown as typeof fetch;
  const backend = new UbicloudBackend({
    project: "pj-fake",
    location: "eu-central-h1",
    token: "fake-token",
    size: "standard-4",
    image: "ubuntu-noble",
    publicKey: "ssh-ed25519 AAAAfake",
    fetch: fetchFake,
    now: () => Date.UTC(2026, 10, 14),
    sleep: async () => {},
    sshFrom: async (host, command, source, so) => {
      const vm = byIp.get(host)!;
      const input = "file" in source ? new Uint8Array(readFileSync(source.file)) : new Uint8Array(Bun.spawnSync(source.argv, { stdout: "pipe" }).stdout);
      const r = await backend.exec({ id: vm.id, spec: vm.spec! }, command, { ...so, input });
      return { exit: r.exit, stderr: r.stderr };
    },
    sshTo: async (host, command, path, so) => {
      const vm = byIp.get(host)!;
      const own = w.sshTo ? await w.sshTo(vm, command, path, so.user ?? "run") : undefined;
      if (own) return own;
      const r: ExecResult & { raw?: Uint8Array } = await backend.exec({ id: vm.id, spec: vm.spec! }, command, so);
      writeFileSync(path, r.raw ?? enc.encode(r.stdout));
      return { exit: r.exit, stderr: r.stderr };
    },
    ssh: async (host, command, so) => {
      const vm = byIp.get(host)!;
      vm.calls.push({ command, user: so.user ?? "run" });
      if (vm.cut) return { exit: 255, stdout: "", stderr: "" };
      const own = w.ssh ? await w.ssh(vm, command, so.input, so.user ?? "run") : undefined;
      if (own) return own;
      const nft = nftAnswer(w, vm, command);
      if (nft) return nft;
      for (const m of command.matchAll(/mkdir -p ((?:'[^']*'|[^\s;&|'])+)/g)) addDir(vm, m[1]!.replace(/^'|'$/g, ""));
      const write = /^cat > '(.*)'$/.exec(command);
      if (write && !write[1]!.startsWith(AUDIT_DIR + "/") && !vm.dirs.has(write[1]!.slice(0, write[1]!.lastIndexOf("/")) || "/")) return { exit: 1, stdout: "", stderr: "cat: " + write[1] + ": No such file or directory" };
      if (write) {
        vm.files.set(write[1]!, so.input ?? new Uint8Array());
        return ok();
      }
      const read = /^cat '(.*)'$/.exec(command);
      if (read) {
        const data = vm.files.get(read[1]!);
        return data ? { ...ok(dec.decode(data)), raw: data } : { exit: 1, stdout: "", stderr: "No such file" };
      }
      const unpack = /^mkdir -p '([^']+)' && tar -xf '([^']+)' -C '[^']+' --no-same-owner/.exec(command);
      if (unpack && !w.faults.preamble?.some((x) => command.includes(x))) {
        const path = unpack[1]! + "/payload";
        vm.files.set(path, vm.files.get(unpack[2]!) ?? new Uint8Array());
        vm.files.delete(unpack[2]!);
        vm.installed.push(path);
        if (unpack[1] === NODE_ROOT) vm.node = true;
        vm.written.push({ path, size: vm.files.get(path)!.length, mode: 0o755, mtime: "2026-11-14T00:00:00", type: "f" });
        return ok();
      }
      if (command.includes("/controller.list") && command.includes(DESCRIBE_DONE)) return ok([...vm.installed.map((p) => describeLine(vm, p)), DESCRIBE_DONE].join("\n") + "\n");
      const test = /^test -f (\S+)$/.exec(command);
      if (test) return vm.files.has(test[1]!) ? ok() : { exit: 1, stdout: "", stderr: "" };
      for (const [name, cmd] of Object.entries(AUDIT_COMMANDS)) if (cmd === command) return auditOutput(w, vm, name as AuditCommand);
      if (w.faults.preamble?.some((s) => command.includes(s))) return { exit: 1, stdout: "", stderr: "fake preamble failure" };
      return mirrorHostAnswer(vm, command) ?? mirrorDownAnswer(w, vm, command) ?? dockerAnswer(vm, command) ?? { ...ok(), ...(w.handler(vm, command) ?? {}) };
    },
  });
  const create = backend.create.bind(backend);
  backend.create = async (spec, co) => {
    const v = await create(spec, co);
    const vm = byName.get(v.id)!;
    vm.spec = spec;
    vm.dirs.add("/home/" + spec.runUser);
    vm.processes = [
      { pid: 1, user: "root", args: "/sbin/init" },
      { pid: 812, user: spec.runUser, args: "-bash" },
    ];
    vm.egress = allowed(spec).slice(0, 1);
    w.plant(vm);
    return v;
  };
  return backend;
}

export const fakeMirrors = (names: Mirror["name"][] = ["npm", "pypi", "apt", "dockerhub"]): Mirror[] =>
  names.map((name, i) => ({ name, host: "10.0.0.3", port: 4873 + i, url: "http://10.0.0.3:" + (4873 + i) + "/" + name + "/", terms: name + " mirror, terms read 2026-11-14 (fixture)" }));

export const fakeSpec = (o: Partial<VmSpec> = {}): VmSpec => ({
  label: "fixture run",
  owner: "fixture-owner",
  ttlMinutes: 240,
  runMinutes: 180,
  runUser: "run",
  proxy: { host: "10.0.0.2", port: 8080 },
  mirrors: fakeMirrors(),
  mounts: [],
  env: {},
  ...o,
});

/** A dc-hosts seam that admits everything and records each settlement. */
export function fakeHosts(o: { refuse?: boolean } = {}): HostsSeam & { admitted: string[]; settled: Array<{ id: string; hours: number }> } {
  const admitted: string[] = [];
  const settled: Array<{ id: string; hours: number }> = [];
  return {
    admitted,
    settled,
    admit: async ({ run }) => {
      if (o.refuse) return { ok: false, why: "dc-hosts has no room" };
      admitted.push(run);
      return { ok: true, id: "h" + admitted.length };
    },
    settle: async (id, hours) => void settled.push({ id, hours }),
  };
}

export const bytes = (s: string) => enc.encode(s);

/** A ledger stand-in with plan L1's admission: cap covers settled, in-flight and unknown before a new reserve. */
export function fakeMoney(caps: Partial<Record<LedgerItemId, number>> = { "dc-base-apps": 95 }): MoneySeam & { log: string[]; settledUsd: () => number } {
  const subs = new Map<string, { item: LedgerItemId; reserve: number; spent: number | null; open: boolean }>();
  const log: string[] = [];
  const held = (item: LedgerItemId) => [...subs.values()].filter((s) => s.item === item).reduce((n, s) => n + (s.open || s.spent === null ? s.reserve : s.spent), 0);
  return {
    log,
    settledUsd: () => [...subs.values()].reduce((n, s) => n + (s.spent ?? 0), 0),
    admit: async ({ item, run, reserveUsd }) => {
      const cap = caps[item] ?? Infinity;
      if (held(item) + reserveUsd > cap + 1e-9) {
        log.push("refuse " + run);
        return { ok: false, why: item + " has " + (cap - held(item)).toFixed(2) + " of room for a " + reserveUsd.toFixed(2) + " reserve" };
      }
      const id = "s" + (subs.size + 1);
      subs.set(id, { item, reserve: reserveUsd, spent: null, open: true });
      log.push("admit " + run);
      return { ok: true, id };
    },
    settle: async (id, spent) => {
      const s = subs.get(id)!;
      s.open = false;
      s.spent = spent;
      log.push("settle " + id + " " + (spent === null ? "unknown" : spent.toFixed(2)));
    },
    reconcile: async (id) => {
      const s = subs.get(id)!;
      if (s.spent === null) s.spent = 0;
      log.push("reconcile " + id);
    },
    capStop: async (item, why) => void log.push("cap stop " + item + ": " + why),
    release: async (item, why) => void log.push("release " + item + ": " + why),
  };
}

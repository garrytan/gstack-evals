// Copyright (c) 2026 Garry Tan. MIT License.
// A simulated Ubicloud for the keyless tests and dry-run cases: the real UbicloudBackend wired to a fake fetch and a fake
// ssh, so every audit runs through the real backend's commands and result parsing on invented fixtures. Nothing here
// creates a VM, opens a socket or reads a key.
// Adapted from lanes/devex/stage3/fake.ts at 5ee7f764232b196a1d0cec5b144a287b792f9c94 (branch build-devex-review-eval).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { NODE_ROOT } from "./install.ts";
import { AUDIT_COMMANDS, AUDIT_DIR, allowed, DESCRIBE_DONE, WORK_DONE, DROP_PREFIX, END_MARK, NET_PREFIX, secretHit, START_MARK, UbicloudBackend, type Connection, type ExecResult, type Mirror, type ProcessRow, type StatEntry, type VmSpec } from "./sandbox.ts";
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
  /**
   * Folders that exist: the image's own, the run user's home, and every mkdir -p a command ran. A write into any other
   * folder fails, except into the audit folder, whose commands the fake simulates as collectable without the preamble.
   */
  dirs: Set<string>;
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

const netLine = (prefix: string, c: Connection) => prefix + "IN= OUT=ens3 SRC=10.1.0.9 DST=" + c.host + " LEN=60 PROTO=TCP SPT=40100 DPT=" + c.port + " SYN";

function auditOutput(w: FakeWorld, vm: FakeVm, name: AuditCommand): ExecResult {
  const f = w.faults;
  if (f.exit?.[name] !== undefined) return { exit: f.exit[name]!, stdout: "", stderr: "fake failure" };
  if (f.empty?.includes(name)) return ok("");
  let out = "";
  if (name === "ruleset") out = f.ruleset ?? rulesetText(vm.spec!);
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
  if (command.includes("grep -c " + NET_PREFIX.trim())) return vm.egress.length ? ok() : { exit: 1, stdout: "", stderr: "" };
  const daemon = /'([^']*)' > \/etc\/docker\/daemon\.json/.exec(command);
  if (daemon) vm.files.set("/etc/docker/daemon.json", enc.encode(JSON.stringify({ "registry-mirrors": [daemon[1]] }) + "\n"));
  if (/\bsystemctl (restart|start|enable --now) docker\b/.test(command) && !vm.docker) return { exit: 5, stdout: "", stderr: "Failed to start docker.service: Unit docker.service not found." };
  if (command.includes("apt-get install") && / docker\.io\b/.test(command)) {
    vm.docker = true;
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

const describeLine = (vm: FakeVm, p: string) => {
  const data = vm.files.get(p);
  return data ? "f\t" + createHash("sha256").update(data).digest("hex") + "\t" + p : "x\t-\t" + p;
};

/** A world whose VMs are clean by default: init and the run user's shell, egress to the allowed endpoints only. */
export function fakeWorld(o: Partial<Pick<FakeWorld, "faults" | "handler" | "plant" | "ssh" | "sshTo" | "api">> = {}): FakeWorld {
  return { vms: [], deleted: [], faults: o.faults ?? {}, handler: o.handler ?? (() => undefined), plant: o.plant ?? (() => {}), ssh: o.ssh, sshTo: o.sshTo, api: o.api };
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
      const vm: FakeVm = { id: name, ip: "10.1.0." + (w.vms.length + 10), spec: null, calls: [], files: new Map(), processes: [], egress: [], blocked: [], written: [], work: [], installed: [], docker: false, node: false, dirs: new Set(IMAGE_DIRS) };
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
      const own = w.ssh ? await w.ssh(vm, command, so.input, so.user ?? "run") : undefined;
      if (own) return own;
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
      return dockerAnswer(vm, command) ?? { ...ok(), ...(w.handler(vm, command) ?? {}) };
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

// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host (plan section 5, R2-3, R2-4, L7): a Ubicloud VM that stays awake for the paid stages and holds the
// money controller and the one ledger file, beside a second small VM that holds the off-host write-ahead copy. The
// launcher runs on the attaching agent's machine:
//   launch      creates the WAL host and the controller host, provisions both, pins the controller's WAL key to walctl
//               on the WAL host, and starts host-main.ts detached with setsid; keys and UBI_OWNER reach it only on
//               the SSH session's stdin, read by name here and exported inside the remote shell, never written to disk
//               or put on a command line.
//   relaunch    starts the service again on the same host; the ledger file stays where it is.
//   recoverHost replaces a lost controller host; the new host restores the ledger and the approval record from the
//               newest verified snapshot and the chain after it (money/durability.ts).
//   teardown    settles every item and the hosts' measured hours on the host, archives the off-host copy and deletes
//               both VMs.
// Every VM a call makes is deleted when that call fails partway, so no launch leaves a VM behind.
import { fail } from "../errors.ts";
import type { Vm, VmBackend, VmSpec } from "../stage3/sandbox.ts";
import { TTL_MARGIN_MINUTES } from "../stage3/sandbox.ts";
import { mirrorSetup, shq } from "../stage3/ubicloud-real.ts";
import type { HostConfig, TargetConfig } from "./host-main.ts";
import type { HostVm, ServiceStatus } from "./ledger-service.ts";
import { walAuthorizedKey, WALCTL_PATH, WALCTL_PY, WAL_DIR } from "./offhost.ts";

/** What the launcher needs from a VM backend; UbicloudBackend has it, and so does stage3/fake.ts's simulated one. */
export interface HostBackend extends VmBackend {
  create(spec: VmSpec, o?: { prefix?: string }): Promise<Vm>;
  attach(name: string, spec: VmSpec): Promise<Vm | null>;
  exists(name: string): Promise<boolean>;
  address(vm: Vm): string;
  privateAddress(vm: Vm): string | null;
}

export const HOST_ROOT = "/var/lib/dc";

export interface Layout {
  root: string;
  repo: string;
  ledger: string;
  record: string;
  journals: string;
  holder: string;
  state: string;
  config: string;
  status: string;
  pid: string;
  log: string;
  walKey: string;
  knownHosts: string;
}

/** The host's fixed paths; the same absolute paths on a replacement host (R2-17). */
export const layout = (runId: string, root = HOST_ROOT): Layout => ({
  root,
  repo: root + "/repo",
  ledger: root + "/ledger/ledger.sqlite",
  record: root + "/ledger/record",
  journals: root + "/journals",
  holder: root + "/holders/" + runId,
  state: root + "/state",
  config: root + "/state/host.json",
  status: root + "/state/status.json",
  pid: root + "/state/controller.pid",
  log: root + "/state/controller.log",
  walKey: root + "/state/wal_ed25519",
  knownHosts: root + "/state/known_hosts",
});

/** The names the paid launcher passes to the service, read by name from its own environment. */
export const SERVICE_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "UBICLOUD_API_KEY"] as const;

export interface ControllerPlan {
  runId: string;
  /** UBI_OWNER, read from the environment by name (stage3/sandbox.ts ownerFromEnv). */
  owner: string;
  /** The longest stage the host serves without a relaunch; the time to live covers it plus the margin. */
  longestStageHours: number;
  ttlHours: number;
  /** Ubicloud's list price per hour in micros for each host's size, read on the day. */
  priceMicrosPerHour: { controller: number; wal: number };
  commit: string;
  /** git archive of the commit. */
  repoTar: Uint8Array;
  /** The approval record directory as a tar with one top folder (ledger-service.ts recordTar). */
  recordTar: Uint8Array;
  root?: string;
  wal?: { dir?: string; script?: string; owner?: string | null; authorizedKeys?: string; login?: string };
  /** Root shell lines that make the controller host ready, given its private IPv4 (controllerProvision for paid runs). */
  provision: (host: { privateIp: string | null; layout: Layout }) => string[];
  /** The bun binary on the controller host. */
  bun: string;
  entry?: string;
  tickMs?: number;
  drainMs?: number;
  stage?: HostConfig["stage"];
  /** The service's WAL target; by default walctl over SSH to the WAL host. */
  target?: (wal: Vm, backend: HostBackend, l: Layout) => TargetConfig;
  upWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface HostRecord {
  runId: string;
  owner: string;
  commit: string;
  root: string;
  controller: { vm: string; createdAt: string };
  wal: { vm: string; createdAt: string };
  /** A Captain stop the launcher read from the host; recovery refuses while it stands. */
  captain: string | null;
  events: Array<{ at: string; what: string }>;
}

export function planProblems(p: ControllerPlan): string[] {
  const out: string[] = [];
  if (!p.owner.trim()) out.push("UBI_OWNER is not set");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(p.runId)) out.push("the run id is not a plain name");
  if (!(p.longestStageHours > 0)) out.push("the longest stage needs a positive length");
  if (!(p.ttlHours * 60 >= p.longestStageHours * 60 + TTL_MARGIN_MINUTES)) out.push("the time to live (" + p.ttlHours + " h) does not cover the longest stage (" + p.longestStageHours + " h) and the " + TTL_MARGIN_MINUTES + " minute margin");
  for (const [k, v] of Object.entries(p.priceMicrosPerHour)) if (!Number.isSafeInteger(v) || v <= 0) out.push("the " + k + " host's list price is not a positive whole number of micros an hour");
  if (!/^[0-9a-f]{40}$/.test(p.commit)) out.push("the commit is not a full sha");
  if (!p.repoTar.length) out.push("the repository archive is empty");
  if (!p.recordTar.length) out.push("the approval record archive is empty");
  return out;
}

/** A host VM's spec: no mirrors or proxy of its own (it serves them), UBI_OWNER and a time to live past the longest stage. */
const hostSpec = (p: ControllerPlan, label: string): VmSpec => ({ label, owner: p.owner, ttlMinutes: p.ttlHours * 60, runMinutes: p.longestStageHours * 60, runUser: "run", proxy: null, mirrors: [], mounts: [], env: {} });

/** Reads the service's keys by name and UBI_OWNER, as stdin lines; values are checked, never printed. */
export function serviceEnv(env: Readonly<Record<string, string | undefined>>, owner: string, names: readonly string[] = SERVICE_KEYS): Uint8Array {
  const lines = ["UBI_OWNER=" + owner];
  for (const n of names) {
    const v = env[n];
    if (!v) fail("E_USAGE", n + " is not set for the controller host");
    if (!/^[\x21-\x7e]+$/.test(v!)) fail("E_USAGE", n + " holds a character the stdin hand-off can't carry");
    lines.push(n + "=" + v);
  }
  if (!/^[\x21-\x7e]+$/.test(owner)) fail("E_USAGE", "UBI_OWNER holds a character the stdin hand-off can't carry");
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

/** BT: the paid controller host's provisioning: bun at the repo's pinned version, the repo's own dependencies and the mirrors. */
export function controllerProvision(o: { bunVersion: string; mirrors: boolean }): ControllerPlan["provision"] {
  return ({ privateIp, layout: l }) => {
    if (o.mirrors && !privateIp) fail("E_DC_INFRA_MISSING", "the controller host has no private IPv4 for the mirrors");
    return [
      "set -euo pipefail",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      "apt-get install -y python3 openssh-client curl unzip tar",
      "test -x /opt/bun/bin/bun || (curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash -s bun-v" + o.bunVersion + ")",
      "cd " + shq(l.repo) + " && /opt/bun/bin/bun install --frozen-lockfile",
      ...(o.mirrors ? mirrorSetup(privateIp!) : []),
    ];
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

class Ctx {
  readonly l: Layout;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  constructor(
    readonly b: HostBackend,
    readonly p: ControllerPlan,
  ) {
    this.l = layout(p.runId, p.root);
    this.sleep = p.sleep ?? ((ms) => Bun.sleep(ms));
    this.now = p.now ?? (() => Date.now());
  }
  get walDir() {
    return this.p.wal?.dir ?? WAL_DIR;
  }
  get walScript() {
    return this.p.wal?.script ?? WALCTL_PATH;
  }
  async run(vm: Vm, command: string, what: string, input?: Uint8Array): Promise<string> {
    const r = await this.b.exec(vm, command, { user: "root", input });
    if (r.exit !== 0) fail("E_DC_INFRA_MISSING", what + " failed on " + vm.id + " (exit " + r.exit + ")");
    return r.stdout;
  }
}

async function setupWal(x: Ctx, wal: Vm): Promise<void> {
  const script = x.walScript;
  await x.run(wal, "mkdir -p " + shq(script.replace(/\/[^/]+$/, "")), "making the walctl folder");
  await x.b.write(wal, script, WALCTL_PY);
  const owner = x.p.wal?.owner === undefined ? "ubi" : x.p.wal.owner;
  await x.run(wal, "mkdir -p " + shq(x.walDir) + (owner ? " && chown " + owner + " " + shq(x.walDir) : "") + " && chmod 700 " + shq(x.walDir) + " && " + (owner ? "sudo -n -u " + owner + " " : "") + "python3 " + shq(script) + " " + shq(x.walDir) + " init", "starting the write-ahead copy");
}

/** Provisions the controller host, puts the record in place once, and pins its WAL key on the WAL host. */
async function prepareController(x: Ctx, ctl: Vm, wal: Vm, hosts: HostVm[], uploadRecord: boolean): Promise<void> {
  const l = x.l;
  await x.run(ctl, "mkdir -p " + [l.state, l.journals, l.repo, l.holder, l.ledger.replace(/\/[^/]+$/, "")].map(shq).join(" ") + " && chmod 700 " + shq(l.root) + " " + shq(l.state), "making the host's folders");
  await x.b.write(ctl, l.root + "/repo.tar", x.p.repoTar);
  await x.run(ctl, "tar -xf " + shq(l.root + "/repo.tar") + " -C " + shq(l.repo) + " && printf '%s\\n' " + x.p.commit + " > " + shq(l.root + "/commit"), "unpacking the repository");
  await x.b.write(ctl, l.root + "/provision.sh", x.p.provision({ privateIp: x.b.privateAddress(ctl), layout: l }).join("\n") + "\n");
  await x.run(ctl, "bash " + shq(l.root + "/provision.sh") + " >> " + shq(l.state + "/provision.log") + " 2>&1", "provisioning the controller host");
  if (uploadRecord && (await x.b.exec(ctl, "test -e " + shq(l.record), { user: "root" })).exit !== 0) {
    const unpack = l.root + "/record-unpack";
    await x.b.write(ctl, l.root + "/record.tar", x.p.recordTar);
    await x.run(ctl, "rm -rf " + shq(unpack) + " && mkdir -p " + shq(unpack) + " && tar -xf " + shq(l.root + "/record.tar") + " -C " + shq(unpack) + " && test \"$(ls -A " + shq(unpack) + " | wc -l)\" = 1 && mv " + shq(unpack) + "/* " + shq(l.record) + " && rmdir " + shq(unpack), "putting the approval record in place");
  }
  await x.run(ctl, "test -f " + shq(l.walKey) + " || ssh-keygen -q -t ed25519 -N '' -C dc-controller -f " + shq(l.walKey), "making the controller's WAL key");
  const pub = (await x.run(ctl, "cat " + shq(l.walKey + ".pub"), "reading the controller's WAL key")).trim();
  const keys = x.p.wal?.authorizedKeys ?? "/home/" + (x.p.wal?.login ?? "ubi") + "/.ssh/authorized_keys";
  const line = walAuthorizedKey(pub, { script: x.walScript, dir: x.walDir });
  await x.run(wal, "grep -qxF " + shq(line) + " " + shq(keys) + " 2>/dev/null || printf '%s\\n' " + shq(line) + " >> " + shq(keys), "pinning the controller's key on the WAL host");
  const target: TargetConfig = x.p.target?.(wal, x.b, l) ?? { kind: "ssh", host: x.b.privateAddress(wal) ?? x.b.address(wal), keyPath: l.walKey, knownHosts: l.knownHosts, login: x.p.wal?.login ?? "ubi" };
  const cfg: HostConfig = { runId: x.p.runId, holder: l.holder, record: l.record, ledgerPath: l.ledger, journalDir: l.journals, stateDir: l.state, hosts, target, tickMs: x.p.tickMs, drainMs: x.p.drainMs, stage: x.p.stage ?? null };
  await x.b.write(ctl, l.config, JSON.stringify(cfg, null, 2) + "\n");
}

export type StartResult = { ok: true; status: ServiceStatus } | { ok: false; captain: string } | { ok: false; down: string };

/** Starts host-main.ts detached with setsid, its environment from stdin, and waits for its first status. */
async function start(x: Ctx, ctl: Vm, env: Uint8Array): Promise<StartResult> {
  const l = x.l;
  await x.run(ctl, "rm -f " + shq(l.status) + " " + shq(l.state + "/captain-boot.json"), "clearing the last status");
  const command = "while IFS= read -r line; do case \"$line\" in [A-Z_]*=*) export \"$line\";; esac; done; cd " + shq(l.repo) + " && setsid -f " + shq(x.p.bun) + " " + shq(x.p.entry ?? "lanes/design-constructed/money/host-main.ts") + " --config " + shq(l.config) + " < /dev/null >> " + shq(l.log) + " 2>&1";
  await x.run(ctl, command, "starting the ledger service", env);
  const until = x.now() + (x.p.upWaitMs ?? 120_000);
  while (x.now() < until) {
    const r = await x.b.exec(ctl, "cat " + shq(l.status) + " 2>/dev/null", { user: "root" });
    if (r.exit === 0 && r.stdout.trim()) {
      const s = JSON.parse(r.stdout) as ServiceStatus & { booted?: false };
      if (s.booted === false || (s.captain && !s.items)) return { ok: false, captain: s.captain!.why };
      return { ok: true, status: s };
    }
    await x.sleep(500);
  }
  return { ok: false, down: "the ledger service wrote no status within " + Math.round((x.p.upWaitMs ?? 120_000) / 1000) + " s; see " + l.log };
}

async function destroyAll(x: Ctx, vms: Vm[]): Promise<string[]> {
  const left: string[] = [];
  for (const vm of [...vms].reverse()) {
    try {
      await x.b.destroy(vm);
    } catch (e) {
      left.push(vm.id + ": " + (e as Error).message);
    }
  }
  return left;
}

async function guarded<T>(x: Ctx, made: Vm[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const left = await destroyAll(x, made);
    const msg = (e as Error).message + "; deleted " + (made.length - left.length) + " VM(s) this call made" + (left.length ? "; could not delete " + left.join(", ") : "");
    throw Object.assign(new Error(msg), { code: (e as { code?: string }).code ?? "E_DC_INFRA_MISSING" });
  }
}

/** Creates both hosts and starts the service. Any failure deletes both VMs before it throws. */
export async function launch(b: HostBackend, p: ControllerPlan, env: Uint8Array): Promise<HostRecord> {
  const problems = planProblems(p);
  if (problems.length) fail("E_USAGE", "the controller host plan can't run: " + problems.join("; "));
  const x = new Ctx(b, p);
  const made: Vm[] = [];
  return guarded(x, made, async () => {
    const wal = await b.create(hostSpec(p, "dc wal host " + p.runId), { prefix: "dcwal" });
    made.push(wal);
    const walAt = iso(x.now());
    await setupWal(x, wal);
    const ctl = await b.create(hostSpec(p, "dc controller host " + p.runId), { prefix: "dcctl" });
    made.push(ctl);
    const ctlAt = iso(x.now());
    const hosts: HostVm[] = [
      { vm: wal.id, role: "wal", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.wal, createdAt: walAt },
      { vm: ctl.id, role: "controller", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.controller, createdAt: ctlAt },
    ];
    await prepareController(x, ctl, wal, hosts, true);
    const s = await start(x, ctl, env);
    if (!s.ok) throw new Error("captain" in s ? "the ledger service stopped for the Captain at its first boot: " + s.captain : s.down);
    return { runId: p.runId, owner: p.owner, commit: p.commit, root: x.l.root, controller: { vm: ctl.id, createdAt: ctlAt }, wal: { vm: wal.id, createdAt: walAt }, captain: s.status.captain?.why ?? null, events: [{ at: iso(x.now()), what: "launched (" + s.status.boot + ")" }] };
  });
}

/** Whether the service on the controller host is running; null when the host is gone. */
export async function hostStatus(b: HostBackend, p: ControllerPlan, rec: HostRecord): Promise<{ running: boolean; status: ServiceStatus | null } | null> {
  const x = new Ctx(b, p);
  const ctl = await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId));
  if (!ctl) return null;
  const alive = await b.exec(ctl, "test -f " + shq(x.l.pid) + " && kill -0 \"$(cat " + shq(x.l.pid) + ")\"", { user: "root" });
  const st = await b.exec(ctl, "cat " + shq(x.l.status) + " 2>/dev/null", { user: "root" });
  const status = st.exit === 0 && st.stdout.trim() ? (JSON.parse(st.stdout) as ServiceStatus) : null;
  if (status?.captain) rec.captain = status.captain.why;
  return { running: alive.exit === 0, status };
}

export type Relaunch = { kind: "running" } | { kind: "relaunched"; status: ServiceStatus } | { kind: "lost" } | { kind: "captain"; why: string };

/** Starts the service again on the same host. The ledger file, the record and the WAL key stay as they are. */
export async function relaunch(b: HostBackend, p: ControllerPlan, rec: HostRecord, env: Uint8Array): Promise<Relaunch> {
  const x = new Ctx(b, p);
  const st = await hostStatus(b, p, rec);
  if (!st) return { kind: "lost" };
  if (st.running) return { kind: "running" };
  const ctl = (await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId)))!;
  const s = await start(x, ctl, env);
  rec.events.push({ at: iso(x.now()), what: s.ok ? "relaunched (" + s.status.boot + ")" : "relaunch stopped" });
  if (!s.ok) return "captain" in s ? ((rec.captain = s.captain), { kind: "captain", why: s.captain }) : fail("E_DC_INFRA_MISSING", s.down);
  if (s.status.captain) rec.captain = s.status.captain.why;
  return { kind: "relaunched", status: s.status };
}

export type Recovered = { kind: "recovered"; status: ServiceStatus } | { kind: "captain"; why: string };

/**
 * Replaces a lost controller host: deletes what is left of it, creates a new one at the same paths, and boots the
 * service, which restores the ledger and the record from the off-host copy. Refuses while the host still runs, while a
 * Captain stop stands, or when the WAL host is gone too. A new host that fails partway is deleted.
 */
export async function recoverHost(b: HostBackend, p: ControllerPlan, rec: HostRecord, env: Uint8Array): Promise<Recovered> {
  const x = new Ctx(b, p);
  if (rec.captain) return { kind: "captain", why: "a Captain stop stands: " + rec.captain };
  if (await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId))) fail("E_USAGE", "the controller host " + rec.controller.vm + " still runs; relaunch it instead");
  const wal = await b.attach(rec.wal.vm, hostSpec(p, "dc wal host " + p.runId));
  if (!wal) return { kind: "captain", why: "the WAL host " + rec.wal.vm + " is gone too, so the off-host copy is lost" };
  if (await b.exists(rec.controller.vm)) await b.destroy({ id: rec.controller.vm, spec: hostSpec(p, "dc controller host " + p.runId) });
  const made: Vm[] = [];
  return guarded(x, made, async () => {
    const ctl = await b.create(hostSpec(p, "dc controller host " + p.runId), { prefix: "dcctl" });
    made.push(ctl);
    const ctlAt = iso(x.now());
    const hosts: HostVm[] = [
      { vm: rec.wal.vm, role: "wal", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.wal, createdAt: rec.wal.createdAt },
      { vm: ctl.id, role: "controller", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.controller, createdAt: ctlAt },
    ];
    await prepareController(x, ctl, wal, hosts, false);
    const s = await start(x, ctl, env);
    if (!s.ok && "captain" in s) {
      rec.captain = s.captain;
      rec.controller = { vm: ctl.id, createdAt: ctlAt };
      rec.events.push({ at: iso(x.now()), what: "recovery stopped for the Captain" });
      return { kind: "captain", why: s.captain };
    }
    if (!s.ok) throw new Error(s.down);
    rec.events.push({ at: iso(x.now()), what: "recovered on " + ctl.id + " (" + s.status.boot + ") from " + rec.controller.vm });
    rec.controller = { vm: ctl.id, createdAt: ctlAt };
    return { kind: "recovered", status: s.status };
  });
}

export type Teardown = { kind: "deleted"; archive: { lines: Uint8Array; snapshot: { name: string; bytes: Uint8Array } | null; record: Uint8Array | null } } | { kind: "refused"; why: string };

/**
 * Ends the run: the service settles every item and the hosts' measured hours and takes a final verified snapshot, the
 * off-host copy is read back as the archive, then both VMs are deleted. force holds in-flight work as unknown instead
 * of waiting for it (the Captain's choice, off by default).
 */
export async function teardown(b: HostBackend, p: ControllerPlan, rec: HostRecord, o: { force?: boolean; waitMs?: number } = {}): Promise<Teardown> {
  const x = new Ctx(b, p);
  const spec = (label: string) => hostSpec(p, label + " " + p.runId);
  const ctl = await b.attach(rec.controller.vm, spec("dc controller host"));
  if (!ctl) return { kind: "refused", why: "the controller host is gone; recover it first so its money settles" };
  const wal = await b.attach(rec.wal.vm, spec("dc wal host"));
  if (!wal) return { kind: "refused", why: "the WAL host is gone, so the off-host copy can't be archived" };
  await x.run(ctl, "rm -f " + shq(x.l.state + "/teardown.json") + " && mkdir -p " + shq(x.l.state + "/control") + " && touch " + shq(x.l.state + "/control/" + (o.force ? "teardown-force" : "teardown")), "asking the service to tear down");
  const until = x.now() + (o.waitMs ?? 15 * 60_000);
  let result: { ok: boolean; why?: string } | null = null;
  while (x.now() < until && !result) {
    const r = await b.exec(ctl, "cat " + shq(x.l.state + "/teardown.json") + " 2>/dev/null", { user: "root" });
    if (r.exit === 0 && r.stdout.trim()) result = JSON.parse(r.stdout);
    else await x.sleep(500);
  }
  if (!result) return { kind: "refused", why: "the service did not answer the teardown in time" };
  if (!result.ok) return { kind: "refused", why: result.why ?? "the service refused the teardown" };
  while (x.now() < until && (await b.exec(ctl, "test -f " + shq(x.l.pid), { user: "root" })).exit === 0) await x.sleep(500);
  const walctl = (args: string) => b.exec(wal, "python3 " + shq(x.walScript) + " " + shq(x.walDir) + " " + args, { user: "root" });
  const raw = async (args: string) => {
    const r = (await walctl(args)) as { exit: number; stdout: string; raw?: Uint8Array };
    return r.exit === 0 ? (r.raw ?? new TextEncoder().encode(r.stdout)) : null;
  };
  const lines = await raw("lines");
  if (!lines) return { kind: "refused", why: "the off-host lines could not be read for the archive" };
  const name = (await walctl("latest")).stdout.trim();
  const snapshot = name ? { name, bytes: (await raw("get " + name)) ?? new Uint8Array() } : null;
  const record = name ? await raw("get-record " + name) : null;
  const left = await destroyAll(x, [wal, ctl]);
  if (left.length) fail("E_DC_INFRA_MISSING", "could not delete " + left.join(", "));
  rec.events.push({ at: iso(x.now()), what: "torn down" });
  return { kind: "deleted", archive: { lines, snapshot, record } };
}

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
import { isReasonCode } from "../../../src/errors/codes.ts";
import { DcError, fail } from "../errors.ts";
import type { Vm, VmBackend, VmSpec } from "../stage3/sandbox.ts";
import { TTL_MARGIN_MINUTES } from "../stage3/sandbox.ts";
import { mirrorSetup, shq } from "../stage3/ubicloud-real.ts";
import type { HostConfig, TargetConfig } from "./host-main.ts";
import { WAL_HOST_SIZE, walFoldProjection } from "./hosts.ts";
import type { HostVm, ServiceStatus } from "./ledger-service.ts";
import { walAuthorizedKey, WALCTL_PATH, WALCTL_PY, WAL_DIR } from "./offhost.ts";

/** What the launcher needs from a VM backend; UbicloudBackend has it, and so does stage3/fake.ts's simulated one. */
export interface HostBackend extends VmBackend {
  create(spec: VmSpec, o?: { prefix?: string; size?: string }): Promise<Vm>;
  attach(name: string, spec: VmSpec): Promise<Vm | null>;
  exists(name: string): Promise<boolean>;
  address(vm: Vm): string;
  privateAddress(vm: Vm): string | null;
}

export const HOST_ROOT = "/var/lib/dc";
/** The bare repository on the controller host that holds the gstack pin's commit and tree, for the sessions section's gstackSources. */
export const HOST_GSTACK_SOURCE = HOST_ROOT + "/gstack-src";
/** The host's work folder: the row's uploaded inputs and the sinks it writes; the teardown archive returns it. */
export const HOST_WORK = HOST_ROOT + "/work";

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
  /** XDG_STATE_HOME for the provisioning and the service, so the trial image's pin file sits under the host root. */
  xdg: string;
  gstack: string;
  work: string;
  /** The trial image the provisioning built or loaded: its digest, as host-image.ts writes it. */
  image: string;
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
  xdg: root + "/xdg",
  gstack: root + "/gstack-src",
  work: root + "/work",
  image: root + "/state/image.json",
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
  /** Each host's Ubicloud size; the backend's own size when unset. */
  sizes?: { controller?: string; wal?: string };
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
  provision: (host: { privateIp: string | null; layout: Layout; uploads?: Uploads }) => string[];
  /** The trial image for the review sessions: a docker save tar to load, else built on the host; null when the row runs no session. */
  image?: { tar: Uint8Array | null; expectDigest: string | null } | null;
  /** The gstack pin's commit and its tree as one pack (gstackPack), imported into HOST_GSTACK_SOURCE and checked by tree hash. */
  gstack?: GstackPack | null;
  /** The row's inputs as a tar, unpacked into the host's work folder. */
  workTar?: Uint8Array | null;
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

/** The pinned commit's objects with no history: the commit, its tree and every blob, as git pack-objects writes them. */
export interface GstackPack {
  commit: string;
  tree: string;
  pack: Uint8Array;
}

/** What prepareController put on the host before the provisioning lines run. */
export interface Uploads {
  image: "load" | "build" | null;
  gstack: { commit: string; tree: string } | null;
}

export interface HostRecord {
  runId: string;
  owner: string;
  commit: string;
  root: string;
  controller: { vm: string; createdAt: string };
  wal: { vm: string; createdAt: string };
  /** The trial image digest the provisioning recorded, or null when the host has no trial image. */
  image?: string | null;
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
  if (p.sizes?.wal !== undefined && p.sizes.wal !== WAL_HOST_SIZE) out.push("the WAL host runs on " + WAL_HOST_SIZE + ", folded into dc-hosts, not " + p.sizes.wal);
  else if (Number.isSafeInteger(p.priceMicrosPerHour.wal) && p.priceMicrosPerHour.wal > 0) {
    const fold = walFoldProjection(p.ttlHours, p.priceMicrosPerHour.wal);
    if (!fold.fits) out.push(fold.line + " does not fit");
  }
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

/** The provisioning's own entry for the trial image (money/host-image.ts), relative to the repository. */
export const HOST_IMAGE_ENTRY = "lanes/design-constructed/money/host-image.ts";

/**
 * BT: the paid controller host's provisioning: bun at the repo's pinned version, Docker, the repo's own dependencies,
 * the mirrors, then the uploads: the gstack pin imported into HOST_GSTACK_SOURCE and checked by tree hash, and the trial
 * image loaded from its tar or built from docker/trial.Dockerfile, its digest written to the layout's image file.
 * system: false leaves out the package, Docker, bun and dependency installs (keyless tests run the rest on this machine).
 */
export function controllerProvision(o: { bunVersion: string; mirrors: boolean; system?: boolean; bun?: string; docker?: string; imageEntry?: string }): ControllerPlan["provision"] {
  return ({ privateIp, layout: l, uploads }) => {
    if (o.mirrors && !privateIp) fail("E_DC_INFRA_MISSING", "the controller host has no private IPv4 for the mirrors");
    const bun = o.bun ?? "/opt/bun/bin/bun";
    const g = uploads?.gstack ?? null;
    if (g && !(/^[0-9a-f]{40}$/.test(g.commit) && /^[0-9a-f]{40}$/.test(g.tree))) fail("E_USAGE", "the gstack pin's commit and tree must be full shas");
    const system = o.system === false ? [] : [
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update",
      "apt-get install -y python3 openssh-client curl unzip tar git docker.io",
      "systemctl enable --now docker",
      "test -x " + shq(bun) + " || (curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash -s bun-v" + o.bunVersion + ")",
      "cd " + shq(l.repo) + " && " + shq(bun) + " install --frozen-lockfile",
      ...(o.mirrors ? mirrorSetup(privateIp!) : []),
    ];
    const gstack = g
      ? [
          "rm -rf " + shq(l.gstack) + " && git init -q --bare " + shq(l.gstack),
          "git -C " + shq(l.gstack) + " index-pack --stdin < " + shq(l.root + "/gstack.pack") + " > /dev/null",
          "git -C " + shq(l.gstack) + " update-ref refs/dc/pin " + g.commit,
          "test \"$(git -C " + shq(l.gstack) + " rev-parse " + g.commit + "^{tree})\" = " + g.tree,
          "git -C " + shq(l.gstack) + " archive --format=tar " + g.commit + " | tar -t > /dev/null",
          "rm -f " + shq(l.root + "/gstack.pack"),
        ]
      : [];
    const image = uploads?.image
      ? ["mkdir -p " + shq(l.xdg) + " && cd " + shq(l.repo) + " && XDG_STATE_HOME=" + shq(l.xdg) + " " + shq(bun) + " " + shq(o.imageEntry ?? HOST_IMAGE_ENTRY) + " --out " + shq(l.image) + (o.docker ? " --docker " + shq(o.docker) : "") + (uploads.image === "load" ? " --load " + shq(l.root + "/image.tar") + " && rm -f " + shq(l.root + "/image.tar") : "")]
      : [];
    return ["set -euo pipefail", ...system, ...gstack, ...image];
  };
}

/** The pinned commit, its tree and every blob, with no history, from a local repository that holds the commit. */
export function gstackPack(source: string, commit: string): GstackPack {
  const git = (args: string[], input?: Uint8Array) => Bun.spawnSync(["git", "-C", source, ...args], { stdin: input, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const tree = git(["rev-parse", commit + "^{tree}"]);
  if (tree.exitCode !== 0) fail("E_USAGE", "the gstack source " + source + " doesn't hold commit " + commit);
  const objects = git(["rev-list", "--objects", "--no-walk", commit]);
  const pack = objects.exitCode === 0 ? git(["pack-objects", "-q", "--stdout"], new Uint8Array(objects.stdout)) : objects;
  if (pack.exitCode !== 0 || !pack.stdout.length) fail("E_DC_INFRA_MISSING", "could not pack the gstack pin from " + source);
  return { commit, tree: new TextDecoder().decode(tree.stdout).trim(), pack: new Uint8Array(pack.stdout) };
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
async function prepareController(x: Ctx, ctl: Vm, wal: Vm, hosts: HostVm[], uploadRecord: boolean): Promise<string | null> {
  const l = x.l;
  await x.run(ctl, "mkdir -p " + [l.state, l.journals, l.repo, l.holder, l.work, l.ledger.replace(/\/[^/]+$/, "")].map(shq).join(" ") + " && chmod 700 " + shq(l.root) + " " + shq(l.state), "making the host's folders");
  await x.b.write(ctl, l.root + "/repo.tar", x.p.repoTar);
  await x.run(ctl, "tar -xf " + shq(l.root + "/repo.tar") + " -C " + shq(l.repo) + " && printf '%s\\n' " + x.p.commit + " > " + shq(l.root + "/commit"), "unpacking the repository");
  if (x.p.workTar?.length) {
    await x.b.write(ctl, l.root + "/work.tar", x.p.workTar);
    await x.run(ctl, "tar -xf " + shq(l.root + "/work.tar") + " -C " + shq(l.work) + " && rm -f " + shq(l.root + "/work.tar"), "unpacking the row's inputs");
  }
  if (x.p.gstack) await x.b.write(ctl, l.root + "/gstack.pack", x.p.gstack.pack);
  if (x.p.image?.tar) await x.b.write(ctl, l.root + "/image.tar", x.p.image.tar);
  const uploads: Uploads = { image: x.p.image ? (x.p.image.tar ? "load" : "build") : null, gstack: x.p.gstack ? { commit: x.p.gstack.commit, tree: x.p.gstack.tree } : null };
  await x.b.write(ctl, l.root + "/provision.sh", x.p.provision({ privateIp: x.b.privateAddress(ctl), layout: l, uploads }).join("\n") + "\n");
  await x.run(ctl, "bash " + shq(l.root + "/provision.sh") + " >> " + shq(l.state + "/provision.log") + " 2>&1", "provisioning the controller host");
  let image: string | null = null;
  if (x.p.image) {
    const read = await x.b.exec(ctl, "cat " + shq(l.image), { user: "root" });
    image = read.exit === 0 ? ((JSON.parse(read.stdout) as { digest?: unknown }).digest as string) ?? null : null;
    if (typeof image !== "string" || !/^sha256:[0-9a-f]{64}$/.test(image)) fail("E_DC_INFRA_MISSING", "the provisioning recorded no trial image digest in " + l.image);
    const want = x.p.image.expectDigest;
    if (want && want !== image) throw new DcError("E_DCH_IMAGE_DIGEST", "the controller host's trial image is " + image + ", but the wiring's sessions section expects " + want + "; no session runs on another image");
  }
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
  return image;
}

export type StartResult = { ok: true; status: ServiceStatus } | { ok: false; captain: string } | { ok: false; down: string };

/** Starts host-main.ts detached with setsid, its environment from stdin, and waits for its first status. */
async function start(x: Ctx, ctl: Vm, env: Uint8Array): Promise<StartResult> {
  const l = x.l;
  await x.run(ctl, "rm -f " + shq(l.status) + " " + shq(l.state + "/captain-boot.json"), "clearing the last status");
  const command = "while IFS= read -r line; do case \"$line\" in [A-Z_]*=*) export \"$line\";; esac; done; export XDG_STATE_HOME=" + shq(l.xdg) + "; cd " + shq(l.repo) + " && setsid -f " + shq(x.p.bun) + " " + shq(x.p.entry ?? "lanes/design-constructed/money/host-main.ts") + " --config " + shq(l.config) + " < /dev/null >> " + shq(l.log) + " 2>&1";
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
    const code = (e as { code?: string }).code;
    throw new DcError(code && isReasonCode(code) ? code : "E_DC_INFRA_MISSING", msg);
  }
}

/** Creates both hosts and starts the service. Any failure deletes both VMs before it throws. */
export async function launch(b: HostBackend, p: ControllerPlan, env: Uint8Array): Promise<HostRecord> {
  const problems = planProblems(p);
  if (problems.length) fail("E_USAGE", "the controller host plan can't run: " + problems.join("; "));
  const x = new Ctx(b, p);
  const made: Vm[] = [];
  return guarded(x, made, async () => {
    const wal = await b.create(hostSpec(p, "dc wal host " + p.runId), { prefix: "dcwal", size: WAL_HOST_SIZE });
    made.push(wal);
    const walAt = iso(x.now());
    await setupWal(x, wal);
    const ctl = await b.create(hostSpec(p, "dc controller host " + p.runId), { prefix: "dcctl", size: p.sizes?.controller });
    made.push(ctl);
    const ctlAt = iso(x.now());
    const hosts: HostVm[] = [
      { vm: wal.id, role: "wal", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.wal, createdAt: walAt },
      { vm: ctl.id, role: "controller", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.controller, createdAt: ctlAt },
    ];
    const image = await prepareController(x, ctl, wal, hosts, true);
    const s = await start(x, ctl, env);
    if (!s.ok) throw new Error("captain" in s ? "the ledger service stopped for the Captain at its first boot: " + s.captain : s.down);
    return { runId: p.runId, owner: p.owner, commit: p.commit, root: x.l.root, controller: { vm: ctl.id, createdAt: ctlAt }, wal: { vm: wal.id, createdAt: walAt }, image, captain: s.status.captain?.why ?? null, events: [{ at: iso(x.now()), what: "launched (" + s.status.boot + ")" + (image ? " on image " + image : "") }] };
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
  if (p.stage !== undefined) {
    const cfg = JSON.parse(await x.run(ctl, "cat " + shq(x.l.config), "reading the host's config")) as HostConfig;
    await b.write(ctl, x.l.config, JSON.stringify({ ...cfg, stage: p.stage ?? null }, null, 2) + "\n");
  }
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
    const ctl = await b.create(hostSpec(p, "dc controller host " + p.runId), { prefix: "dcctl", size: p.sizes?.controller });
    made.push(ctl);
    const ctlAt = iso(x.now());
    const hosts: HostVm[] = [
      { vm: rec.wal.vm, role: "wal", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.wal, createdAt: rec.wal.createdAt },
      { vm: ctl.id, role: "controller", ttlHours: p.ttlHours, priceMicrosPerHour: p.priceMicrosPerHour.controller, createdAt: ctlAt },
    ];
    const image = await prepareController(x, ctl, wal, hosts, false);
    if (rec.image && image && image !== rec.image) throw new DcError("E_DCH_IMAGE_DIGEST", "the replacement host's trial image is " + image + ", not the run's " + rec.image);
    rec.image = image ?? rec.image ?? null;
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

export type Teardown = { kind: "deleted"; archive: { lines: Uint8Array; snapshot: { name: string; bytes: Uint8Array } | null; record: Uint8Array | null; work: Uint8Array | null } } | { kind: "refused"; why: string };

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
  const packed = (await b.exec(ctl, "test -d " + shq(x.l.work) + " && tar -C " + shq(x.l.work) + " -cf - .", { user: "root" })) as { exit: number; stdout: string; raw?: Uint8Array };
  const work = packed.exit === 0 ? (packed.raw ?? new TextEncoder().encode(packed.stdout)) : null;
  const left = await destroyAll(x, [wal, ctl]);
  if (left.length) fail("E_DC_INFRA_MISSING", "could not delete " + left.join(", "));
  rec.events.push({ at: iso(x.now()), what: "torn down" });
  return { kind: "deleted", archive: { lines, snapshot, record, work } };
}

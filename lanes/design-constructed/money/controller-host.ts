// Copyright (c) 2026 Garry Tan. MIT License.
// The controller host (plan section 5, R2-3, R2-4, L7): a Ubicloud VM that stays awake for the paid stages and holds the
// money controller and the one ledger file, beside a second small VM that holds the off-host write-ahead copy. The
// launcher runs on the attaching agent's machine:
//   launch      creates the WAL host and the controller host, provisions both, pins the controller's WAL key to walctl
//               on the WAL host, and starts host-main.ts detached with setsid; keys and UBI_OWNER reach it only on
//               the SSH session's stdin, read by name here and exported inside the remote shell, never written to disk
//               or put on a command line.
//   relaunch    starts the service again on the same host; the ledger file stays where it is.
//   sendRow     sends the next row, with its own inputs, to the running service once the last row has ended; the
//               service runs it on the same ledger, leases and journals, and refuses while a row still runs.
//   recoverHost replaces a lost controller host; the new host restores the ledger and the approval record from the
//               newest verified snapshot and the chain after it (money/durability.ts).
//   teardown    settles every item and the hosts' measured hours on the host, seals the work folder there with age to
//               the run's recipient and deletes its plaintext, then copies back only the sealed archive and the books
//               that hold no sealed text (the off-host lines, the snapshot, the approval record and rows.json), and
//               deletes both VMs.
// Custody (PD-41): the work folder, which holds the uploaded inputs, every row's sink and log, the wiring's session
// folders and the row's scratch, is a tmpfs mount sized from the host's memory; a launch refuses when it is not tmpfs.
// Inputs reach it on the SSH session's stdin, never as a file on the host's disk.
// The repository reaches the host as a git bundle of the commit with no history (repoBundle) and is checked out at the
// layout's repo (repoCheckout), so the host's own dry run can read git there; a launch, a recovery and a relaunch each
// check that checkout against the commit and its tree and refuse with E_DCH_CHECKOUT otherwise.
// Every VM a call makes is deleted when that call fails partway, so no launch leaves a VM behind.
import { mkdirSync, mkdtempSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isReasonCode } from "../../../src/errors/codes.ts";
import { DcError, fail } from "../errors.ts";
import type { FileSource, Vm, VmBackend, VmSpec } from "../stage3/sandbox.ts";
import { TTL_MARGIN_MINUTES } from "../stage3/sandbox.ts";
import { mirrorSetup, shq } from "../stage3/ubicloud-real.ts";
import { randomUUID } from "node:crypto";
import type { HostConfig, RowRecord, RowRequest, TargetConfig } from "./host-main.ts";
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
  /** Runs a command with its stdout streamed into a local file at path, never held in memory. */
  readTo(vm: Vm, command: string, path: string, o?: { user?: "root" | "run"; timeoutMs?: number }): Promise<{ exit: number; stderr: string }>;
}

export const HOST_ROOT = "/var/lib/dc";
/** The bare repository on the controller host that holds the gstack pin's commit and tree, for the sessions section's gstackSources. */
export const HOST_GSTACK_SOURCE = HOST_ROOT + "/gstack-src";
/** The host's work folder, a tmpfs mount: the rows' uploaded inputs, their sinks and logs; the teardown seals it. */
export const HOST_WORK = HOST_ROOT + "/work";
/** BT (PD-41): the work folder's tmpfs takes this share of the controller host's memory, the kernel's default for tmpfs. */
export const WORK_TMPFS_SHARE = 0.5;
/** The first line of every age file. */
export const AGE_HEADER = "age-encryption.org/v1\n";

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
  /** The launch's record of this host: its VM, its Ubicloud region and its private IPv4 (ControllerFacts). */
  controller: string;
  /** Each row's number, arguments, start, end, state and code (host-main.ts RowRecord). */
  rows: string;
  /** The run's age recipient, the public half only. */
  recipient: string;
  /** The teardown's sealed work archive, on disk because it is ciphertext. */
  sealed: string;
}

/** Each row's log, in the work folder's .rows/ (host-main.ts writes it; a value here, since host-main is the entry). */
export const rowLog = (work: string, n: number) => work + "/.rows/" + n + ".log";

/** The work folder's tmpfs at a row's end and the most it held while the row ran, in bytes (rows.json and stage.json). */
export interface TmpfsUse {
  usedBytes: number;
  sizeBytes: number;
  peakBytes: number;
}

/** The work folder's use and size in bytes, as df reads them. */
export function workUse(work: string): { usedBytes: number; sizeBytes: number } {
  const s = statfsSync(work);
  return { usedBytes: (s.blocks - s.bfree) * s.bsize, sizeBytes: s.blocks * s.bsize };
}

const share = (bytes: number, size: number) => ((100 * bytes) / size).toFixed(1) + "%";
const gib = (bytes: number) => (bytes / 2 ** 30).toFixed(2) + " GiB";

/** What a row's log ends with and dc host status prints for each row. */
export const tmpfsLine = (t: TmpfsUse) => "the work folder's tmpfs holds " + gib(t.usedBytes) + " of " + gib(t.sizeBytes) + " (" + share(t.usedBytes, t.sizeBytes) + "), with a peak of " + gib(t.peakBytes) + " (" + share(t.peakBytes, t.sizeBytes) + ") during the row";

/** dc host next refuses while the work folder's tmpfs, now or at the last row's peak, holds more than this share of its size. */
export const TMPFS_GUARD_SHARE = 0.8;

/** Why the next row may not start for the work folder's tmpfs use, or null. */
export function tmpfsGuard(now: { usedBytes: number; sizeBytes: number }, last: RowRecord | undefined): string | null {
  const over = (bytes: number, size: number) => bytes > TMPFS_GUARD_SHARE * size;
  const guard = "the " + TMPFS_GUARD_SHARE * 100 + "% guard";
  if (last?.tmpfs && over(last.tmpfs.peakBytes, last.tmpfs.sizeBytes)) return "row " + last.n + " (" + last.row + ") peaked at " + gib(last.tmpfs.peakBytes) + " of the work folder's " + gib(last.tmpfs.sizeBytes) + " tmpfs (" + share(last.tmpfs.peakBytes, last.tmpfs.sizeBytes) + "), above " + guard;
  if (over(now.usedBytes, now.sizeBytes)) return "the work folder's tmpfs holds " + gib(now.usedBytes) + " of " + gib(now.sizeBytes) + " (" + share(now.usedBytes, now.sizeBytes) + "), above " + guard;
  return null;
}

/** The host's fixed paths; the same absolute paths on a replacement host (R2-17). */
export const layout = (runId: string, root = HOST_ROOT, work = root + "/work"): Layout => ({
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
  work,
  image: root + "/state/image.json",
  controller: root + "/state/controller.json",
  rows: root + "/state/rows.json",
  recipient: root + "/state/recipient.txt",
  sealed: root + "/work.tar.age",
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
  /** The Ubicloud region (location) both hosts run in, written into the host's controller record. */
  location?: string;
  /** Ubicloud's list price per hour in micros for each host's size, read on the day. */
  priceMicrosPerHour: { controller: number; wal: number };
  commit: string;
  /** The commit's tree; the host's checkout must have it (repoTree). */
  tree: string;
  /** The commit as a git bundle with no history (repoBundle), checked out at the layout's repo. */
  repoBundle: Uint8Array;
  /** The approval record directory as a tar with one top folder (ledger-service.ts recordTar). */
  recordTar: Uint8Array;
  root?: string;
  wal?: { dir?: string; script?: string; owner?: string | null; authorizedKeys?: string; login?: string };
  /** Root shell lines that make the controller host ready, given its private IPv4 (controllerProvision for paid runs). */
  provision: (host: { privateIp: string | null; layout: Layout; uploads?: Uploads }) => string[];
  /** The trial image for the review sessions: a docker save tar to load, else built on the host; null when the row runs no session. */
  image?: { tar: Uint8Array | FileSource | null; expectDigest: string | null } | null;
  /** The gstack pin's commit and its tree as one pack (gstackPack), imported into HOST_GSTACK_SOURCE and checked by tree hash. */
  gstack?: GstackPack | null;
  /** The row's inputs as a tar, unpacked into the host's work folder. */
  workTar?: Uint8Array | null;
  /** The work folder; the layout's root/work when unset. */
  workDir?: string;
  /** Whether the launch mounts the work folder's tmpfs; false only checks it is tmpfs (keyless runs on this machine). */
  mountWork?: boolean;
  /** The run's age recipient (age1...), the public half only; the teardown seals the work folder to it. */
  recipient: string;
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
  /** The Ubicloud region the hosts were launched in; a recovery refuses another (PD-42). */
  location?: string | null;
  /** A Captain stop the launcher read from the host; recovery refuses while it stands. */
  captain: string | null;
  /** The work folder's tmpfs size and the controller host's memory, in bytes, read at launch or recovery. */
  tmpfs?: { sizeBytes: number; memBytes: number } | null;
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
  if (!/^[0-9a-f]{40}$/.test(p.tree)) out.push("the commit's tree is not a full sha");
  if (!p.repoBundle.length) out.push("the repository bundle is empty");
  if (!p.recordTar.length) out.push("the approval record archive is empty");
  if (!/^age1[0-9a-z]{58}$/.test(p.recipient)) out.push("the run's age recipient is not one age1 public key");
  return out;
}

/** A host VM's spec: no mirrors or proxy of its own (it serves them), UBI_OWNER and a time to live past the longest stage. */
const hostSpec = (p: ControllerPlan, label: string): VmSpec => ({ label, owner: p.owner, ttlMinutes: p.ttlHours * 60, runMinutes: p.longestStageHours * 60, runUser: HOST_RUN_USER, proxy: null, mirrors: [], mounts: [], env: {} });
const HOST_RUN_USER = "run";

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
      "apt-get update -o DPkg::Lock::Timeout=600",
      "apt-get install -y python3 openssh-client curl unzip tar git docker.io age -o DPkg::Lock::Timeout=600",
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

const gitIn = (dir: string) => (args: string[], input?: Uint8Array) => Bun.spawnSync(["git", "-C", dir, ...args], { stdin: input, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });

/** The commit, its tree and every blob, with no history, from a local repository that holds the commit. */
function commitPack(source: string, commit: string, what: string): GstackPack {
  const git = gitIn(source);
  const tree = git(["rev-parse", "--verify", commit + "^{tree}"]);
  if (tree.exitCode !== 0) fail("E_USAGE", what + " " + source + " doesn't hold commit " + commit);
  const objects = git(["rev-list", "--objects", "--no-walk", commit]);
  const pack = objects.exitCode === 0 ? git(["pack-objects", "-q", "--stdout"], new Uint8Array(objects.stdout)) : objects;
  if (pack.exitCode !== 0 || !pack.stdout.length) fail("E_DC_INFRA_MISSING", "could not pack " + what + " " + source + " at " + commit);
  return { commit, tree: new TextDecoder().decode(tree.stdout).trim(), pack: new Uint8Array(pack.stdout) };
}

/** The pinned commit, its tree and every blob, with no history, from a local repository that holds the commit. */
export const gstackPack = (source: string, commit: string): GstackPack => commitPack(source, commit, "the gstack source");

/** The commit's tree in a local checkout that holds the commit. */
export function repoTree(source: string, commit: string): string {
  const r = gitIn(source)(["rev-parse", "--verify", commit + "^{tree}"]);
  if (r.exitCode !== 0) fail("E_USAGE", "the checkout " + source + " doesn't hold commit " + commit);
  return new TextDecoder().decode(r.stdout).trim();
}

/** The ref the repository bundle carries. */
const PIN_REF = "refs/dc/pin";

/**
 * The commit as a git bundle with no history: the commit, its tree and every blob under PIN_REF, bundled from a scratch
 * repository that marks the commit shallow, so a shallow checkout can ship it too. The host checks it out (repoCheckout).
 */
export function repoBundle(source: string, commit: string): Uint8Array {
  const { pack } = commitPack(source, commit, "the checkout");
  const scratch = mkdtempSync(join(tmpdir(), "dc-bundle-"));
  try {
    const git = gitIn(scratch);
    const made = git(["init", "-q", "--bare"]).exitCode === 0 && git(["index-pack", "--stdin"], pack).exitCode === 0;
    writeFileSync(join(scratch, "shallow"), commit + "\n");
    const bundle = made && git(["update-ref", PIN_REF, commit]).exitCode === 0 ? git(["bundle", "create", "-", PIN_REF]) : null;
    if (!bundle || bundle.exitCode !== 0 || !bundle.stdout.length) fail("E_DC_INFRA_MISSING", "could not bundle " + commit + " from " + source);
    return new Uint8Array(bundle!.stdout);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The root shell lines that check the bundle at the layout's root out at its repo, as a git repository marked shallow at
 * the commit, so HEAD is the commit and its tree hashes resolve; then the commit file the host's rows read (wire/host.ts).
 */
export const repoCheckout = (l: Layout, commit: string): string[] => {
  const [repo, bundle] = [shq(l.repo), shq(l.root + "/repo.bundle")];
  return [
    "set -euo pipefail",
    "command -v git > /dev/null || { apt-get update -o DPkg::Lock::Timeout=600 && DEBIAN_FRONTEND=noninteractive apt-get install -y git -o DPkg::Lock::Timeout=600; }",
    "git init -q " + repo,
    "printf '%s\\n' " + commit + " > " + repo + "/.git/shallow",
    "git -C " + repo + " fetch -q --no-tags " + bundle + " " + PIN_REF + ":" + PIN_REF,
    "git -C " + repo + " -c advice.detachedHead=false checkout -q --detach " + commit,
    "rm -f " + bundle,
    "printf '%s\\n' " + commit + " > " + shq(l.root + "/commit"),
  ];
};

/** Reads the checkout back: HEAD, its tree, then one line per changed tracked file. */
export const checkoutRead = (l: Layout) => "git -C " + shq(l.repo) + " rev-parse HEAD 'HEAD^{tree}' && git -C " + shq(l.repo) + " status --porcelain --untracked-files=no";

/** Why the checkout read back (null when the read failed) is not the commit and its tree, or null when it is. */
export function checkoutProblem(read: string | null, commit: string, tree: string): string | null {
  if (read === null) return "is not a git repository whose HEAD and tree resolve";
  const [head, got, ...changed] = read.trim().split("\n");
  if (head !== commit) return "has HEAD " + head + ", not the launched commit " + commit;
  if (got !== tree) return "has tree " + got + ", not the commit's tree " + tree;
  return changed.length ? "has " + changed.length + " changed tracked file(s)" : null;
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
    this.l = layout(p.runId, p.root, p.workDir);
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
async function prepareController(x: Ctx, ctl: Vm, wal: Vm, hosts: HostVm[], uploadRecord: boolean): Promise<{ image: string | null; tmpfs: { sizeBytes: number; memBytes: number } }> {
  const l = x.l;
  await x.run(ctl, "mkdir -p " + [l.state, l.journals, l.repo, l.holder, l.work, l.ledger.replace(/\/[^/]+$/, "")].map(shq).join(" ") + " && chmod 700 " + shq(l.root) + " " + shq(l.state), "making the host's folders");
  await x.b.write(ctl, l.root + "/repo.bundle", x.p.repoBundle);
  await x.run(ctl, "bash -c " + shq(repoCheckout(l, x.p.commit).join("\n")), "checking out the repository");
  await checkCheckout(x, ctl);
  if (x.p.gstack) await x.b.write(ctl, l.root + "/gstack.pack", x.p.gstack.pack);
  if (x.p.image?.tar) await x.b.write(ctl, l.root + "/image.tar", x.p.image.tar);
  const uploads: Uploads = { image: x.p.image ? (x.p.image.tar ? "load" : "build") : null, gstack: x.p.gstack ? { commit: x.p.gstack.commit, tree: x.p.gstack.tree } : null };
  const privateIp = x.b.privateAddress(ctl);
  await x.b.write(ctl, l.controller, JSON.stringify({ vm: ctl.id, location: x.p.location ?? null, privateIp }, null, 2) + "\n");
  await x.b.write(ctl, l.root + "/provision.sh", x.p.provision({ privateIp, layout: l, uploads }).join("\n") + "\n");
  await x.run(ctl, "bash " + shq(l.root + "/provision.sh") + " >> " + shq(l.state + "/provision.log") + " 2>&1", "provisioning the controller host");
  let image: string | null = null;
  if (x.p.image) {
    const read = await x.b.exec(ctl, "cat " + shq(l.image), { user: "root" });
    image = read.exit === 0 ? ((JSON.parse(read.stdout) as { digest?: unknown }).digest as string) ?? null : null;
    if (typeof image !== "string" || !/^sha256:[0-9a-f]{64}$/.test(image)) fail("E_DC_INFRA_MISSING", "the provisioning recorded no trial image digest in " + l.image);
    const want = x.p.image.expectDigest;
    if (want && want !== image) throw new DcError("E_DCH_IMAGE_DIGEST", "the controller host's trial image is " + image + ", but the wiring's sessions section expects " + want + "; no session runs on another image");
  }
  const tmpfs = await placeWork(x, ctl);
  if (x.p.workTar?.length) await upload(x, ctl, x.p.workTar, "the launch's work folder");
  await x.b.write(ctl, l.recipient, x.p.recipient + "\n");
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
  const cfg: HostConfig = { runId: x.p.runId, holder: l.holder, record: l.record, ledgerPath: l.ledger, journalDir: l.journals, stateDir: l.state, hosts, target, tickMs: x.p.tickMs, drainMs: x.p.drainMs, work: l.work, stage: x.p.stage ?? null };
  await x.b.write(ctl, l.config, JSON.stringify(cfg, null, 2) + "\n");
  return { image, tmpfs };
}

const mib = (bytes: number) => (bytes / 2 ** 20).toFixed(1);

/** Refuses unless the host's checkout is a git repository at the plan's commit and tree with no tracked change. */
async function checkCheckout(x: Ctx, ctl: Vm): Promise<void> {
  const r = await x.b.exec(ctl, checkoutRead(x.l), { user: "root" });
  const why = checkoutProblem(r.exit === 0 ? r.stdout : null, x.p.commit, x.p.tree);
  if (why) throw new DcError("E_DCH_CHECKOUT", "the controller host's checkout " + x.l.repo + " " + why + "; the host's own dry run reads git there, so no row runs on it");
}

/** Refuses unless the work folder is a tmpfs mount (PD-41). */
async function checkWork(x: Ctx, ctl: Vm): Promise<void> {
  const r = await x.b.exec(ctl, "stat -f -c %T " + shq(x.l.work), { user: "root" });
  const kind = r.exit === 0 ? r.stdout.trim() : "missing";
  if (kind !== "tmpfs") throw new DcError("E_DCH_NOT_TMPFS", "the controller host's work folder " + x.l.work + " is " + kind + ", not tmpfs; no plaintext input or sink may sit on its disk (PD-41)");
}

/** Mounts the work folder's tmpfs at WORK_TMPFS_SHARE of the host's memory, keeps the run user lingering, and checks it. */
async function placeWork(x: Ctx, ctl: Vm): Promise<{ sizeBytes: number; memBytes: number }> {
  const w = shq(x.l.work);
  if (x.p.mountWork !== false) {
    const lines = [
      "set -e",
      "mountpoint -q " + w + " || mount -t tmpfs -o size=$(( $(awk '/^MemTotal:/ {print $2}' /proc/meminfo) * " + 1024 * WORK_TMPFS_SHARE + " )),mode=0700,nosuid,nodev tmpfs " + w,
      "id -u " + HOST_RUN_USER + " > /dev/null 2>&1 || useradd -m -s /bin/bash " + HOST_RUN_USER,
      "loginctl enable-linger " + HOST_RUN_USER,
    ];
    await x.run(ctl, lines.join("\n"), "mounting the work folder's tmpfs");
  }
  await checkWork(x, ctl);
  const [memKb, size] = (await x.run(ctl, "awk '/^MemTotal:/ {print $2}' /proc/meminfo && df -B1 --output=size " + w + " | tail -n 1", "reading the work folder's size")).trim().split(/\s+/).map(Number);
  return { sizeBytes: size!, memBytes: memKb! * 1024 };
}

/** Unpacks a tar into the work folder from the SSH session's stdin; refuses one that doesn't fit or would replace a file. */
async function upload(x: Ctx, ctl: Vm, tar: Uint8Array, what: string): Promise<void> {
  const w = shq(x.l.work);
  const list = Bun.spawnSync(["tar", "-tf", "-"], { stdin: tar, stdout: "pipe", stderr: "pipe" });
  if (list.exitCode !== 0) fail("E_USAGE", what + " is not a tar");
  const free = Number((await x.run(ctl, "df -B1 --output=avail " + w + " | tail -n 1", "reading the work folder's free space")).trim());
  if (tar.length > free) throw new DcError("E_DCH_TMPFS_FULL", what + " is " + mib(tar.length) + " MiB, and the work folder's tmpfs has " + mib(free) + " MiB free; nothing was unpacked");
  const files = new TextDecoder().decode(list.stdout).split("\n").filter((f) => f && !f.endsWith("/"));
  const clash = await x.b.exec(ctl, "cd " + w + " && while IFS= read -r f; do if [ -e \"$f\" ] || [ -L \"$f\" ]; then printf '%s\\n' \"$f\"; exit 3; fi; done", { user: "root", input: new TextEncoder().encode(files.join("\n") + "\n") });
  if (clash.exit === 3) fail("E_USAGE", what + " holds " + clash.stdout.trim() + ", which the host's work folder has already; inputs never replace a file there");
  if (clash.exit !== 0) fail("E_DC_INFRA_MISSING", "checking " + what + " against the work folder failed (exit " + clash.exit + ")");
  await x.run(ctl, "tar -xf - -C " + w + " --no-same-owner", "unpacking " + what, tar);
}

async function readRows(x: Ctx, ctl: Vm): Promise<RowRecord[]> {
  const r = await x.b.exec(ctl, "cat " + shq(x.l.rows) + " 2>/dev/null", { user: "root" });
  return r.exit === 0 && r.stdout.trim() ? (JSON.parse(r.stdout) as RowRecord[]) : [];
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
    const { image, tmpfs } = await prepareController(x, ctl, wal, hosts, true);
    const s = await start(x, ctl, env);
    if (!s.ok) throw new Error("captain" in s ? "the ledger service stopped for the Captain at its first boot: " + s.captain : s.down);
    return { runId: p.runId, owner: p.owner, commit: p.commit, root: x.l.root, controller: { vm: ctl.id, createdAt: ctlAt }, wal: { vm: wal.id, createdAt: walAt }, image, location: p.location ?? null, captain: s.status.captain?.why ?? null, tmpfs, events: [{ at: iso(x.now()), what: "launched (" + s.status.boot + ")" + (image ? " on image " + image : "") }] };
  });
}

export interface HostState {
  running: boolean;
  status: ServiceStatus | null;
  /** Every row the service ran on this host, in order (host-main.ts RowRecord). */
  rows: RowRecord[];
  /** The last lines of the last row's log, when asked for and its row prints no unit text. */
  tail: string[];
  /** How many lines the last row's log holds. */
  logLines: number;
}

/** Whether the service on the controller host is running, its rows and the last row's log tail; null when the host is gone. */
export async function hostStatus(b: HostBackend, p: ControllerPlan, rec: HostRecord, o: { tail?: number; quiet?: (row: string) => boolean } = {}): Promise<HostState | null> {
  const x = new Ctx(b, p);
  const ctl = await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId));
  if (!ctl) return null;
  const alive = await b.exec(ctl, "test -f " + shq(x.l.pid) + " && kill -0 \"$(cat " + shq(x.l.pid) + ")\"", { user: "root" });
  const st = await b.exec(ctl, "cat " + shq(x.l.status) + " 2>/dev/null", { user: "root" });
  const status = st.exit === 0 && st.stdout.trim() ? (JSON.parse(st.stdout) as ServiceStatus) : null;
  if (status?.captain) rec.captain = status.captain.why;
  const rows = await readRows(x, ctl);
  const last = rows.at(-1);
  const log = last ? shq(rowLog(x.l.work, last.n)) : null;
  const logLines = log ? Number((await b.exec(ctl, "cat " + log + " 2>/dev/null | wc -l", { user: "root" })).stdout.trim()) || 0 : 0;
  const tail = log && o.tail && (o.quiet?.(last!.row) ?? true) ? (await b.exec(ctl, "tail -n " + o.tail + " " + log + " 2>/dev/null", { user: "root" })).stdout.split("\n").filter(Boolean) : [];
  return { running: alive.exit === 0, status, rows, tail, logLines };
}

export type Sent = { kind: "sent"; row: RowRecord } | { kind: "busy"; row: RowRecord } | { kind: "down" } | { kind: "lost" } | { kind: "refused"; why: string };

/**
 * Sends the plan's stage to the running service as the next row, after unpacking the row's own inputs into the work
 * folder. The row runs on the same ledger service, leases and journals. Refuses while the last row still runs, and
 * returns once the service records the row as started.
 */
export async function sendRow(b: HostBackend, p: ControllerPlan, rec: HostRecord, inputs: Uint8Array | null, o: { waitMs?: number } = {}): Promise<Sent> {
  const stage = p.stage ?? fail("E_USAGE", "the host plan names no row to send");
  const x = new Ctx(b, p);
  const st = await hostStatus(b, p, rec);
  if (!st) return { kind: "lost" };
  if (!st.running) return { kind: "down" };
  const last = st.rows.at(-1);
  if (last?.state === "running") return { kind: "busy", row: last };
  const ctl = (await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId)))!;
  await checkWork(x, ctl);
  const [size, used] = (await x.run(ctl, "df -B1 --output=size,used " + shq(x.l.work) + " | tail -n 1", "reading the work folder's use")).trim().split(/\s+/).map(Number);
  const high = tmpfsGuard({ usedBytes: used!, sizeBytes: size! }, last);
  if (high) throw new DcError("E_DCH_TMPFS_HIGH", high + "; nothing was uploaded or sent");
  if (inputs) await upload(x, ctl, inputs, "the row's inputs");
  const id = randomUUID();
  const requests = x.l.state + "/next";
  await x.run(ctl, "mkdir -p " + shq(requests), "making the row request folder");
  await b.write(ctl, requests + "/row.json.tmp", JSON.stringify({ id, stage } satisfies RowRequest) + "\n");
  await x.run(ctl, "mv " + shq(requests + "/row.json.tmp") + " " + shq(requests + "/row.json"), "asking for the next row");
  const waitMs = o.waitMs ?? 120_000;
  for (const until = x.now() + waitMs; x.now() < until; await x.sleep(500)) {
    const row = (await readRows(x, ctl)).find((r) => r.id === id);
    if (row) {
      rec.events.push({ at: iso(x.now()), what: "row " + row.n + " sent: " + row.row });
      return { kind: "sent", row };
    }
    const refused = await b.exec(ctl, "cat " + shq(requests + "/row-refused-" + id + ".json") + " 2>/dev/null", { user: "root" });
    if (refused.exit === 0 && refused.stdout.trim()) return { kind: "refused", why: (JSON.parse(refused.stdout) as { why: string }).why };
  }
  return { kind: "refused", why: "the service did not take the row within " + Math.round(waitMs / 1000) + " s" };
}

export type Relaunch = { kind: "running" } | { kind: "relaunched"; status: ServiceStatus } | { kind: "lost" } | { kind: "captain"; why: string };

/**
 * Starts the service again on the same host, with the row's own inputs unpacked into the work folder first. The ledger
 * file, the record, the WAL key and the work folder stay as they are; a work folder that is no longer tmpfs refuses.
 */
export async function relaunch(b: HostBackend, p: ControllerPlan, rec: HostRecord, env: Uint8Array, inputs: Uint8Array | null = null): Promise<Relaunch> {
  const x = new Ctx(b, p);
  const st = await hostStatus(b, p, rec);
  if (!st) return { kind: "lost" };
  if (st.running) return { kind: "running" };
  const ctl = (await b.attach(rec.controller.vm, hostSpec(p, "dc controller host " + p.runId)))!;
  await checkWork(x, ctl);
  await checkCheckout(x, ctl);
  if (inputs) await upload(x, ctl, inputs, "the row's inputs");
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
  if (rec.location && p.location !== rec.location) throw new DcError("E_DCW_REGION", "the hosts run in " + rec.location + ", but the recovery plan names " + (p.location ?? "no region") + "; a recovery never moves a stage to another region (PD-42)");
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
    const { image, tmpfs } = await prepareController(x, ctl, wal, hosts, false);
    if (rec.image && image && image !== rec.image) throw new DcError("E_DCH_IMAGE_DIGEST", "the replacement host's trial image is " + image + ", not the run's " + rec.image);
    rec.image = image ?? rec.image ?? null;
    rec.tmpfs = tmpfs;
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

/** A deleted teardown's archive: the sealed archive, the off-host lines and the snapshot as files in the archive folder, the small books as bytes. */
export type Teardown = { kind: "deleted"; archive: { lines: string; snapshot: { name: string; path: string } | null; record: Uint8Array | null; sealed: string; rows: Uint8Array | null } } | { kind: "refused"; why: string };

/**
 * Seals the work folder on the host (PD-41): tar piped into age to the run's recipient, so no plaintext archive is
 * written, then every plaintext file in the work folder is deleted and the folder checked empty. A sealed archive
 * already there (a teardown run again after a later step failed) is kept, and the work folder must already be empty.
 */
async function seal(x: Ctx, ctl: Vm): Promise<void> {
  const [w, a, r] = [shq(x.l.work), shq(x.l.sealed), shq(x.l.recipient)];
  const script = [
    "set -euo pipefail",
    "if [ -e " + a + " ]; then test -z \"$(ls -A " + w + ")\"; exit 0; fi",
    'test "$(stat -f -c %T ' + w + ')" = tmpfs',
    "command -v age > /dev/null",
    "tar -C " + w + " -cf - . | age -R " + r + " -o " + shq(x.l.sealed + ".tmp"),
    "mv " + shq(x.l.sealed + ".tmp") + " " + a,
    "find " + w + " -mindepth 1 -delete",
    'test -z "$(ls -A ' + w + ')"',
  ].join("\n");
  const out = await x.b.exec(ctl, "bash -c " + shq(script), { user: "root" });
  if (out.exit !== 0) throw new DcError("E_DCH_SEAL", "sealing the work folder on " + ctl.id + " failed (exit " + out.exit + "); both VMs are kept and nothing was copied back");
}

/**
 * Ends the run: the service settles every item and the hosts' measured hours and takes a final verified snapshot, the
 * work folder is sealed on the host and its plaintext deleted, then the sealed archive and the books that hold no sealed
 * text are read back and both VMs are deleted. The sealed archive, the off-host lines and the snapshot stream into the
 * folder into, never held in memory, and the archive's size and sha256 must match the host's (sha256sum on the host)
 * before any VM is deleted; otherwise both VMs are kept. force holds in-flight work as unknown instead of waiting for it
 * (the Captain's choice, off by default). A teardown whose service already finished its own teardown goes straight to
 * the seal, which keeps an archive already sealed, so a teardown run again after a failed copy copies it again.
 */
export async function teardown(b: HostBackend, p: ControllerPlan, rec: HostRecord, o: { force?: boolean; waitMs?: number; into: string }): Promise<Teardown> {
  const x = new Ctx(b, p);
  const spec = (label: string) => hostSpec(p, label + " " + p.runId);
  const ctl = await b.attach(rec.controller.vm, spec("dc controller host"));
  if (!ctl) return { kind: "refused", why: "the controller host is gone; recover it first so its money settles" };
  const wal = await b.attach(rec.wal.vm, spec("dc wal host"));
  if (!wal) return { kind: "refused", why: "the WAL host is gone, so the off-host copy can't be archived" };
  const until = x.now() + (o.waitMs ?? 15 * 60_000);
  const readResult = async () => {
    const r = await b.exec(ctl, "cat " + shq(x.l.state + "/teardown.json") + " 2>/dev/null", { user: "root" });
    return r.exit === 0 && r.stdout.trim() ? (JSON.parse(r.stdout) as { ok: boolean; why?: string }) : null;
  };
  let result: { ok: boolean; why?: string } | null = null;
  const alive = (await b.exec(ctl, "test -f " + shq(x.l.pid) + " && kill -0 \"$(cat " + shq(x.l.pid) + ")\"", { user: "root" })).exit === 0;
  if (alive) {
    await x.run(ctl, "rm -f " + shq(x.l.state + "/teardown.json") + " && mkdir -p " + shq(x.l.state + "/control") + " && touch " + shq(x.l.state + "/control/" + (o.force ? "teardown-force" : "teardown")), "asking the service to tear down");
    while (x.now() < until && !(result = await readResult())) await x.sleep(500);
    if (!result) return { kind: "refused", why: "the service did not answer the teardown in time" };
  } else {
    result = await readResult();
    if (!result) return { kind: "refused", why: "the service isn't running and recorded no finished teardown; relaunch it so its money settles" };
  }
  if (!result.ok) return { kind: "refused", why: result.why ?? "the service refused the teardown" };
  while (x.now() < until && (await b.exec(ctl, "test -f " + shq(x.l.pid), { user: "root" })).exit === 0) await x.sleep(500);
  await seal(x, ctl);
  mkdirSync(o.into, { recursive: true, mode: 0o700 });
  const bytesOf = (r: { exit: number; stdout: string; raw?: Uint8Array }) => (r.exit === 0 ? (r.raw ?? new TextEncoder().encode(r.stdout)) : null);
  const walctl = (args: string) => "python3 " + shq(x.walScript) + " " + shq(x.walDir) + " " + args;
  const streamed = async (vm: Vm, command: string, file: string) => (await b.readTo(vm, command, join(o.into, file), { user: "root" })).exit === 0;
  if (!(await streamed(wal, walctl("lines"), "wal-lines.ndjson"))) return { kind: "refused", why: "the off-host lines could not be read for the archive" };
  const name = (await b.exec(wal, walctl("latest"), { user: "root" })).stdout.trim();
  if (name && !(await streamed(wal, walctl("get " + name), name + ".json"))) writeFileSync(join(o.into, name + ".json"), "");
  const record = name ? bytesOf(await b.exec(wal, walctl("get-record " + name), { user: "root" })) : null;
  const sealed = join(o.into, "work.tar.age");
  const kept = (why: string) => {
    rmSync(sealed, { force: true });
    return new DcError("E_DCH_SEAL", "the sealed work archive " + why + "; both VMs are kept and nothing was copied back");
  };
  if ((await b.exec(ctl, "head -c " + AGE_HEADER.length + " " + shq(x.l.sealed), { user: "root" })).stdout !== AGE_HEADER) throw kept("on " + ctl.id + " is not an age file");
  if (!(await streamed(ctl, "cat " + shq(x.l.sealed), "work.tar.age")) || (await Bun.file(sealed).slice(0, AGE_HEADER.length).text()) !== AGE_HEADER) throw kept("read back from " + ctl.id + " is not an age file");
  const [hostSize, hostSha] = (await x.run(ctl, "wc -c < " + shq(x.l.sealed) + " && sha256sum < " + shq(x.l.sealed), "reading the sealed archive's size and sha256")).trim().split(/\s+/);
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(sealed).stream()) hasher.update(chunk);
  const [size, sha] = [String(statSync(sealed).size), hasher.digest("hex")];
  if (size !== hostSize || sha !== hostSha) throw kept("copied from " + ctl.id + " is " + size + " bytes with sha256 " + sha + ", but the host's is " + hostSize + " bytes with sha256 " + hostSha + "; a teardown run again copies it again");
  const rows = bytesOf(await b.exec(ctl, "cat " + shq(x.l.rows), { user: "root" }));
  const left = await destroyAll(x, [wal, ctl]);
  if (left.length) fail("E_DC_INFRA_MISSING", "could not delete " + left.join(", "));
  rec.events.push({ at: iso(x.now()), what: "torn down" });
  return { kind: "deleted", archive: { lines: join(o.into, "wal-lines.ndjson"), snapshot: name ? { name, path: join(o.into, name + ".json") } : null, record, sealed, rows } };
}

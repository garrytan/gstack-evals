// Copyright (c) 2026 Garry Tan. MIT License.
// What the controller installs in a sandbox VM before its session or checks start (the Captain's ruling on open item 1D,
// option 1): Playwright's headless Chromium build, copied over SSH with its system libraries from the apt mirror, and
// for the VMs that run an agent the pinned Claude Code binary, and Docker from the apt mirror in a VM whose spec names the
// dockerhub mirror (the image has none; recipes/qualify.ts runs local services with docker run). The install runs as root after the preamble (the mirror
// config and the egress filter are already in place), between two markers, and records every file it wrote with its
// sha256 (a symlink's target for a link). That list is the controller's: the audit leaves a listed file out of the
// session's written files and out of the key scan only while it still matches the recorded digest, so a file the agent
// changes afterwards reads as the agent's again.
import { DcError } from "../errors.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_DIR, NET_PREFIX, describeCommand, parseDescribe, stepStderr, type ControllerEntry, type ExecResult, type FileSource, type Vm, type VmBackend } from "./sandbox.ts";

/** BT: where the browser build unpacks in the VM; the browser seam launches it from here. */
export const BROWSER_ROOT = "/opt/dc-browser";
/** BT: where the agent's Claude Code binary unpacks in the VM (the npm tarball's package/ folder). */
export const AGENT_ROOT = "/opt/dc-agent";

/**
 * Playwright's own install-deps list for chromium on ubuntu24.04-x64 at playwright-core 1.65.1 (the package.json pin):
 * its tools, then its chromium libraries, in its order. tests/dc/stage3/install.test.ts reads the same list from the
 * installed playwright-core and checks they are equal, so a version bump that changes it fails a test.
 */
export const CHROMIUM_APT: readonly string[] = [
  "xvfb",
  "fonts-noto-color-emoji",
  "fonts-unifont",
  "libfontconfig1",
  "libfreetype6",
  "xfonts-cyrillic",
  "xfonts-scalable",
  "fonts-liberation",
  "fonts-ipafont-gothic",
  "fonts-wqy-zenhei",
  "fonts-tlwg-loma-otf",
  "fonts-freefont-ttf",
  "libasound2t64",
  "libatk-bridge2.0-0t64",
  "libatk1.0-0t64",
  "libatspi2.0-0t64",
  "libcairo2",
  "libcups2t64",
  "libdbus-1-3",
  "libdrm2",
  "libgbm1",
  "libglib2.0-0t64",
  "libnspr4",
  "libnss3",
  "libpango-1.0-0",
  "libx11-6",
  "libxcb1",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxkbcommon0",
  "libxrandr2",
];

/**
 * BT: the Node every sandbox VM runs: Node 24 LTS at its latest patch, with the sha256 of node-v<version>-linux-x64.tar.xz
 * from nodejs.org/dist/v<version>/SHASUMS256.txt, recorded in stage3/node-pin.json (the launch reads the pin from the lane
 * root, as it reads Claude Code's).
 */
export const NODE: { version: string; sha256: string } = JSON.parse(readFileSync(join(import.meta.dir, "node-pin.json"), "utf8"));
/** BT: where Node unpacks in the VM; node, npm, npx and corepack are linked into /usr/local/bin, on every shell's PATH. */
export const NODE_ROOT = "/opt/dc-node";

/** BT: Docker's apt packages, for a VM whose spec names the dockerhub mirror; the preamble already wrote its daemon.json. */
export const DOCKER_APT: readonly string[] = ["docker.io"];

/** One thing the controller copies into a VM. */
export interface ControllerFiles {
  /** A name for errors and the tar's file name; lower-case letters, digits and dashes. */
  name: string;
  /** The folder in the VM it unpacks into. */
  root: string;
  /** The tar (gzip or xz too) of the files: bytes, or a file or command streamed to the VM. */
  tar: () => Promise<Uint8Array | FileSource>;
  /** apt packages it needs, from the apt mirror. */
  apt: readonly string[];
  /** A shell step run as root after every unpack, before the checks. */
  setup?: string;
  /** A shell check, run as the run user after the unpack, that exits 0 when the install works. */
  check: string;
}

export interface InstallOptions {
  /** Where the marker, the list and the tars live; the sandbox's audit folder. */
  auditDir?: string;
  /** The tree the manifest walks; / in a VM. */
  scanRoot?: string;
  /** How long the apt step may take. */
  aptTimeoutMs?: number;
  /** The dockerhub mirror's URL: when set, Docker is installed and must show it as its registry mirror. */
  dockerMirror?: string;
}

const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const PKG = /^[a-z0-9][a-z0-9.+:-]*$/;
/** The paths written since the start marker, outside the pruned trees, NUL-separated into the list file. */
export const manifestFind = (o: { scanRoot: string; auditDir: string }) =>
  "find " +
  q(o.scanRoot) +
  " -xdev \\( -path /proc -o -path /sys -o -path /dev -o -path /run -o -path /work -o -path " +
  q(o.auditDir) +
  " \\) -prune -o -newer " +
  q(o.auditDir + "/controller-start") +
  " -print0 > " +
  q(o.auditDir + "/controller.list");

const must = (r: ExecResult, what: string, vm: Vm): void => {
  if (r.exit !== 0) throw new DcError("E_DC_INFRA_MISSING", "the controller's install on " + vm.id + " failed at " + what + " (exit " + r.exit + ")" + (r.stderr.trim() ? ": " + stepStderr(r.stderr) : ""));
};

/**
 * Installs each item as root, in order: the start marker, the apt packages from the mirror in one install, Docker when
 * dockerMirror is set (DOCKER_APT from the mirror, enabled and started, and docker info must list the mirror), the
 * egress log's check after any apt fetch (the filter logged at least one accepted connection), each tar
 * unpacked into its root (owned by root, readable by all, with fresh times so the audit's written-file list sees it), each setup as root, each check as the run user, then the manifest of every file
 * written since the marker. Any step that fails throws E_DC_INFRA_MISSING: a failure outside the agent.
 */
export async function installControllerFiles(backend: VmBackend, vm: Vm, items: readonly ControllerFiles[], o: InstallOptions = {}): Promise<ControllerEntry[]> {
  const audit = o.auditDir ?? AUDIT_DIR;
  const scanRoot = o.scanRoot ?? "/";
  for (const it of items) {
    if (!NAME.test(it.name)) throw new DcError("E_USAGE", "controller file set " + JSON.stringify(it.name) + " is not a plain name");
    if (!it.root.startsWith("/") || it.root.includes("'")) throw new DcError("E_USAGE", it.name + "'s root is not an absolute path");
    for (const p of it.apt) if (!PKG.test(p)) throw new DcError("E_USAGE", it.name + " names apt package " + JSON.stringify(p) + ", which is not a package name");
  }
  must(await backend.exec(vm, "mkdir -p " + q(audit) + " && touch " + q(audit + "/controller-start"), { user: "root" }), "the start marker", vm);
  const apt = [...new Set(items.flatMap((it) => it.apt))];
  const aptGet = (pkgs: readonly string[]) => "export DEBIAN_FRONTEND=noninteractive && apt-get update -o DPkg::Lock::Timeout=600 -q && apt-get install -o DPkg::Lock::Timeout=600 -y -q --no-install-recommends " + pkgs.join(" ");
  if (apt.length) must(await backend.exec(vm, aptGet(apt), { user: "root", timeoutMs: o.aptTimeoutMs ?? 900_000 }), "the apt packages", vm);
  if (o.dockerMirror) {
    must(await backend.exec(vm, aptGet(DOCKER_APT), { user: "root", timeoutMs: o.aptTimeoutMs ?? 900_000 }), "Docker's apt packages", vm);
    must(await backend.exec(vm, "systemctl enable --now docker && docker info --format '{{range .RegistryConfig.Mirrors}}{{println .}}{{end}}' | grep -qxF " + q(o.dockerMirror.replace(/\/$/, "") + "/"), { user: "root", timeoutMs: 120_000 }), "Docker's registry mirror", vm);
  }
  if (apt.length || o.dockerMirror) must(await backend.exec(vm, "test \"$(journalctl -k -o cat --no-pager | grep -c " + NET_PREFIX.trim() + ")\" -gt 0", { user: "root" }), "the egress log's check: the apt fetch through the mirror left no " + NET_PREFIX.trim() + " line in the kernel log, so the audit could read no egress and pass", vm);
  for (const it of items) {
    const tar = audit + "/" + it.name + ".tar";
    await backend.write(vm, tar, await it.tar());
    must(await backend.exec(vm, "mkdir -p " + q(it.root) + " && tar -xf " + q(tar) + " -C " + q(it.root) + " --no-same-owner --touch && rm -f " + q(tar) + " && chmod -R a+rX,go-w " + q(it.root), { user: "root", timeoutMs: 300_000 }), it.name + "'s unpack", vm);
  }
  for (const it of items) if (it.setup) must(await backend.exec(vm, it.setup, { user: "root", timeoutMs: 300_000 }), it.name + "'s setup", vm);
  for (const it of items) must(await backend.exec(vm, it.check, { user: "run" }), it.name + "'s check", vm);
  const listed = await backend.exec(vm, manifestFind({ scanRoot, auditDir: audit }) + " && " + describeCommand(audit + "/controller.list"), { user: "root", timeoutMs: 300_000 });
  must(listed, "the manifest", vm);
  const rows = parseDescribe(listed.stdout);
  if (!rows) throw new DcError("E_DC_INFRA_MISSING", "the controller's manifest on " + vm.id + " was cut");
  return rows.filter((r): r is ControllerEntry => r.type !== "x");
}

/** The tar of a folder on the controller, as bytes (a symlink stays a symlink). */
export async function tarOf(dir: string): Promise<Uint8Array> {
  const p = Bun.spawn(["tar", "-cf", "-", "-C", dir, "."], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), p.exited]);
  if (code !== 0) throw new DcError("E_DC_INFRA_MISSING", "could not pack " + dir + " on the controller (tar exited " + code + ")");
  return new Uint8Array(out);
}

/** The browser build: a Playwright Chromium folder on the controller, its binary at bin inside it, with Playwright's apt list. */
export function browserFiles(dir: string, bin: string): ControllerFiles {
  if (bin.startsWith("/") || bin.split("/").includes("..")) throw new DcError("E_USAGE", "the browser binary must be a path inside the build folder");
  const path = BROWSER_ROOT + "/" + bin;
  return { name: "browser", root: BROWSER_ROOT, tar: async () => ({ argv: ["tar", "-cf", "-", "-C", dir, "."] }), apt: CHROMIUM_APT, check: "test -x " + q(path) + " && ! ldd " + q(path) + " 2>/dev/null | grep -q 'not found'" };
}

/**
 * The pinned Node build, streamed from its tarball on the controller (sha256 checked by the caller): node, npm, npx and
 * corepack linked into /usr/local/bin, and corepack's pnpm and yarn shims there too. The preamble already pointed npm
 * and corepack at the npm mirror.
 */
export function nodeFiles(tarball: string): ControllerFiles {
  const bin = NODE_ROOT + "/node-v" + NODE.version + "-linux-x64/bin/";
  return {
    name: "node",
    root: NODE_ROOT,
    tar: async () => ({ file: tarball }),
    apt: [],
    setup: "ln -sf " + ["node", "npm", "npx", "corepack"].map((t) => q(bin + t)).join(" ") + " /usr/local/bin/ && corepack enable --install-directory /usr/local/bin",
    check: "test \"$(node --version)\" = v" + NODE.version + " && npm --version > /dev/null && corepack --version > /dev/null && command -v pnpm > /dev/null && command -v yarn > /dev/null",
  };
}

/** Where the agent's Claude Code binary sits in the VM once its npm tarball is unpacked. */
export const AGENT_CLAUDE = AGENT_ROOT + "/package/claude";

/** The pinned Claude Code binary: the npm tarball's bytes, already checked against the pin by the caller. */
export const claudeFiles = (tgz: () => Promise<Uint8Array>): ControllerFiles => ({ name: "claude-code", root: AGENT_ROOT, tar: tgz, apt: [], check: q(AGENT_CLAUDE) + " --version" });

/**
 * A backend whose prepare installs the controller's files: the browser in every VM, Claude Code too in the VMs that
 * reach the proxy (recipe sessions and builds), Node in every VM when it is given, and Docker in the VMs whose spec names the dockerhub mirror. Every other
 * call goes to the inner backend.
 */
export function controllerBackend(inner: VmBackend, o: { browser: ControllerFiles; node?: ControllerFiles; agent: ControllerFiles | null; install?: InstallOptions }): VmBackend {
  return {
    create: (spec) => inner.create(spec),
    exec: (vm, command, eo) => inner.exec(vm, command, eo),
    write: (vm, path, data) => inner.write(vm, path, data),
    read: (vm, path) => inner.read(vm, path),
    destroy: (vm) => inner.destroy(vm),
    prepare: (vm) => installControllerFiles(inner, vm, [o.browser, ...(o.node ? [o.node] : []), ...(vm.spec.proxy && o.agent ? [o.agent] : [])], { ...o.install, dockerMirror: vm.spec.mirrors.find((m) => m.name === "dockerhub")?.url }),
  };
}
